/*
 * SDG6 AquaCheck · 水杯端 BLE 固件 (ESP32)
 * ────────────────────────────────────────────────────────────
 * 主控：ESP32。三路模拟水质传感器直接接 ESP32 ADC1 引脚。
 *
 * GATT（严格对齐客户端 useBle.ts / 后续 report capture 逻辑）:
 *   Service           UUID 0xFFE0
 *   Measurement Char  UUID 0xFFE1   Notify   ← 每采样周期主动推送
 * 载荷格式：JSON 文本：
 *   {"tds":320,"ph":7.2,"temperature":25.0,"turbidity":1.3,"ec":640,"wet":true}
 *
 * 默认接线：
 *   pH        AO -> GPIO34 / ADC1_CH6
 *   TDS/EC    AO -> GPIO35 / ADC1_CH7
 *   Turbidity AO -> GPIO32 / ADC1_CH4
 *   水位检测      -> GPIO27，外部下拉，入水导通到 3.3V 时 wet=true
 *
 * 重要电压限制：ESP32 ADC 输入不要超过 3.3V。
 * 如果传感器模块 5V 供电且 AO 可能输出 5V，必须先分压再接 ESP32 ADC。
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define SERVICE_UUID        "0000ffe0-0000-1000-8000-00805f9b34fb"
#define MEASUREMENT_UUID    "0000ffe1-0000-1000-8000-00805f9b34fb"
#define PAYLOAD_BUF_SIZE    160

BLECharacteristic* measureChar = nullptr;
bool deviceConnected = false;
const uint32_t SAMPLE_INTERVAL_MS = 700;
uint32_t lastSample = 0;

// ─────────────────────────────
// ESP32 ADC 引脚：优先使用 ADC1，避免 ADC2 与无线功能冲突
// ─────────────────────────────
const int PH_ADC_PIN = 34;         // ADC1_CH6，输入专用脚
const int TDS_ADC_PIN = 35;        // ADC1_CH7，输入专用脚
const int TURBIDITY_ADC_PIN = 32;  // ADC1_CH4
const int WATER_LEVEL_PIN = 27;    // 数字输入，建议外部 10k 下拉

// ESP32 Arduino 默认 12-bit ADC，即 0~4095
const float ADC_REF_VOLTAGE = 3.3;
const float ADC_MAX_VALUE = 4095.0;
const int ADC_SAMPLE_COUNT = 21;   // 奇数，中值滤波
const int ADC_SAMPLE_DELAY_MS = 4;

// 分压还原系数：sensor_output_voltage = adc_pin_voltage * DIVIDER_RATIO
// 若传感器 3.3V 供电且 AO 不超过 3.3V：保持 1.0。
// 若 5V 模块 AO 经 10k + 20k 分压到 ADC：原电压被压到 2/3，应设置为 1.5。
const float PH_DIVIDER_RATIO = 1.0;
const float TDS_DIVIDER_RATIO = 1.0;
const float TURBIDITY_DIVIDER_RATIO = 1.0;

// 当前无独立温度探头，先用 25℃ 作为补偿基准；后续可接 DS18B20/NTC 替换
const float DEFAULT_TEMPERATURE_C = 25.0;

// pH 标定：来自 firmware/参考程序/ph/ph.ino
// pH 7.3 时 PO=2.46V；模块标称 pH 每增加 1，电压下降约 0.18V
const float PH_CAL = 7.30;
const float PH_V_CAL = 2.460;
const float PH_SLOPE = 0.180;

// 浊度标定：来自 firmware/参考程序/tbd/tbd.ino
const float TURBIDITY_K_VALUE = 3347.19;

// TDS/EC：参考 DFRobot 类 TDS 多项式；TDS ppm 常用近似为 EC(µS/cm) * 0.5
const float TDS_FACTOR = 0.5;

struct Metrics {
  float tds;
  float ph;
  float temperature;
  float turbidity;
  float ec;
  bool wet;
};

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* s) override {
    (void)s;
    deviceConnected = true;
  }

  void onDisconnect(BLEServer* s) override {
    deviceConnected = false;
    s->getAdvertising()->start(); // 断开后重新广播，便于重连
  }
};

float clampFloat(float value, float minValue, float maxValue) {
  if (value < minValue) return minValue;
  if (value > maxValue) return maxValue;
  return value;
}

int readMedianAdc(int pin) {
  int values[ADC_SAMPLE_COUNT];

  for (int i = 0; i < ADC_SAMPLE_COUNT; i++) {
    values[i] = analogRead(pin);
    delay(ADC_SAMPLE_DELAY_MS);
  }

  for (int j = 0; j < ADC_SAMPLE_COUNT - 1; j++) {
    for (int i = 0; i < ADC_SAMPLE_COUNT - j - 1; i++) {
      if (values[i] > values[i + 1]) {
        int tmp = values[i];
        values[i] = values[i + 1];
        values[i + 1] = tmp;
      }
    }
  }

  return values[ADC_SAMPLE_COUNT / 2];
}

float readAdcPinVoltage(int pin) {
  int raw = readMedianAdc(pin);
  raw = (int)clampFloat(raw, 0, ADC_MAX_VALUE);
  return raw * ADC_REF_VOLTAGE / ADC_MAX_VALUE;
}

float readSensorOutputVoltage(int pin, float dividerRatio) {
  return readAdcPinVoltage(pin) * dividerRatio;
}

float calcPh(float voltage) {
  // 电压低：更碱，pH 更高；电压高：更酸，pH 更低
  float ph = PH_CAL + (PH_V_CAL - voltage) / PH_SLOPE;
  return clampFloat(ph, 0.0, 14.0);
}

float calcEc(float voltage, float temperatureC) {
  // 温度补偿至 25℃
  float compensationCoefficient = 1.0 + 0.02 * (temperatureC - 25.0);
  float compensationVoltage = voltage / compensationCoefficient;

  // EC 换算，单位：µS/cm
  float ec = 133.42 * compensationVoltage * compensationVoltage * compensationVoltage
           - 255.86 * compensationVoltage * compensationVoltage
           + 857.39 * compensationVoltage;

  return clampFloat(ec, 0.0, 5000.0);
}

float calcTurbidity(float voltage, float temperatureC) {
  float calibratedVoltage = -0.0192 * (temperatureC - 25.0) + voltage;
  float ntu = -865.68 * calibratedVoltage + TURBIDITY_K_VALUE;
  return clampFloat(ntu, 0.0, 3000.0);
}

Metrics readSensors() {
  Metrics m;

  float temperatureC = DEFAULT_TEMPERATURE_C;
  float phVoltage = readSensorOutputVoltage(PH_ADC_PIN, PH_DIVIDER_RATIO);
  float tdsVoltage = readSensorOutputVoltage(TDS_ADC_PIN, TDS_DIVIDER_RATIO);
  float turbidityVoltage = readSensorOutputVoltage(TURBIDITY_ADC_PIN, TURBIDITY_DIVIDER_RATIO);

  m.temperature = temperatureC;
  m.ph = calcPh(phVoltage);
  m.ec = calcEc(tdsVoltage, temperatureC);
  m.tds = clampFloat(m.ec * TDS_FACTOR, 0.0, 3000.0);
  m.turbidity = calcTurbidity(turbidityVoltage, temperatureC);
  m.wet = (digitalRead(WATER_LEVEL_PIN) == HIGH);

  Serial.print("ADC voltage | pH=");
  Serial.print(phVoltage, 3);
  Serial.print("V TDS=");
  Serial.print(tdsVoltage, 3);
  Serial.print("V Turbidity=");
  Serial.print(turbidityVoltage, 3);
  Serial.print("V wet=");
  Serial.println(m.wet ? "true" : "false");

  return m;
}

String toJson(const Metrics& m) {
  char buf[PAYLOAD_BUF_SIZE];
  snprintf(buf, sizeof(buf),
    "{\"tds\":%.0f,\"ph\":%.2f,\"temperature\":%.1f,\"turbidity\":%.2f,\"ec\":%.0f,\"wet\":%s}",
    m.tds, m.ph, m.temperature, m.turbidity, m.ec, m.wet ? "true" : "false");
  return String(buf);
}

void setup() {
  Serial.begin(115200);
  delay(200);

  analogReadResolution(12);
  analogSetPinAttenuation(PH_ADC_PIN, ADC_11db);
  analogSetPinAttenuation(TDS_ADC_PIN, ADC_11db);
  analogSetPinAttenuation(TURBIDITY_ADC_PIN, ADC_11db);

  pinMode(PH_ADC_PIN, INPUT);
  pinMode(TDS_ADC_PIN, INPUT);
  pinMode(TURBIDITY_ADC_PIN, INPUT);
  pinMode(WATER_LEVEL_PIN, INPUT_PULLDOWN);

  BLEDevice::init("AquaCup-01");
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service = server->createService(SERVICE_UUID);
  measureChar = service->createCharacteristic(
      MEASUREMENT_UUID,
      BLECharacteristic::PROPERTY_NOTIFY);
  measureChar->addDescriptor(new BLE2902()); // 允许订阅 Notify
  service->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.println("AquaCup ESP32 booted with real ADC sensors");
  Serial.println("BLE advertising as AquaCup-01");
}

void loop() {
  if (deviceConnected && millis() - lastSample >= SAMPLE_INTERVAL_MS) {
    lastSample = millis();
    String payload = toJson(readSensors());
    measureChar->setValue(payload.c_str());
    measureChar->notify();
    Serial.println(payload);
  }
}
