/*
 * SDG6 AquaCheck · 水杯端 BLE 固件 (BW16 / RTL8720DN)
 * ────────────────────────────────────────────────────────────
 * 板子：Realtek Ameba BW16 (RTL8720DN)。使用 Ameba Arduino BLE API，
 *       与 ESP32 版 (cup_ble.ino) 采用不同的 BLE 库，但对外 GATT 契约完全一致。
 *
 * GATT（严格对齐 API_DESIGN.md Part A / client useBle.ts，与 ESP32 版相同）:
 *   Service           UUID 0xFFE0
 *   Measurement Char  UUID 0xFFE1   Notify   ← 每采样周期主动推送
 * 载荷格式：JSON 文本（与 useBle.parseMeasurement 一致）
 *   {"tds":320,"ph":7.2,"temperature":24.5,"turbidity":1.3,"ec":640,"wet":true}
 *
 * 真实传感器接入：
 *   pH        → PH_ADC_PIN        默认 A0
 *   TDS/EC    → TDS_ADC_PIN       默认 A1
 *   Turbidity → TURBIDITY_ADC_PIN 默认 A2
 *
 * 重要：BW16/RTL8720DN ADC 输入范围按 0~3.3V 处理。若传感器模块 5V 供电且 AO 可能超过
 *       3.3V，必须先用电阻分压再进入 ADC，不能直接接入；也不能接 PWM/数字输出脚。
 */

#include "BLEDevice.h"
#include "SensorSample.h"

#define SERVICE_UUID "0000FFE0-0000-1000-8000-00805F9B34FB"
#define MEASUREMENT_UUID "0000FFE1-0000-1000-8000-00805F9B34FB"
#define PAYLOAD_BUF_SIZE 128

BLEService measureService(SERVICE_UUID);
BLECharacteristic measureChar(MEASUREMENT_UUID);
BLEAdvertData advData;
BLEAdvertData scanData;

// central 是否已开启 Notify 订阅（由 CCCD 回调维护）
bool notifyEnabled = false;

const uint32_t SAMPLE_INTERVAL_MS = 700;
uint32_t lastSample = 0;

int luminance = 255;

// ─────────────────────────────
// 引脚配置：全部必须接 BW16 的 ADC/Analog 输入脚
// 若你实物板丝印/variant 中 A0/A1/A2 不可用，请把下面三个宏替换成实际 ADC 引脚名。
// 已知常见 BW16/Rtlduino variant 中 A2 对应 PB3，可作为 ADC 输入。
// ─────────────────────────────
#define PH_ADC_PIN        A0
#define TDS_ADC_PIN       A1
#define TURBIDITY_ADC_PIN A2

// 水位检测：两根导线导通 = 高电平 → wet=true（水杯已浸没）
#define WATER_LEVEL_PIN PA27

// ─────────────────────────────
// ADC 与分压配置
// Ameba/BW16 按 0~3.3V ADC 输入设计；Arduino analogRead 通常返回 0~1023。
// 若你的板包返回其他范围，只需要改 ADC_MAX_VALUE。
// ─────────────────────────────
const float ADC_REF_VOLTAGE = 3.3;
const float ADC_MAX_VALUE = 1023.0;
const int ADC_SAMPLE_COUNT = 21;   // 奇数，便于中值滤波；3 路 * 21 次约可稳定在 700ms 周期内
const int ADC_SAMPLE_DELAY_MS = 4;

// 分压还原系数：sensor_output_voltage = adc_pin_voltage * DIVIDER_RATIO
// 例：5V 模块 AO 经 10k(上拉到传感器AO) + 20k(下拉GND) 分压进入 ADC，比例为 2/3，
//     则 DIVIDER_RATIO = (10k + 20k) / 20k = 1.5。
// 若模块 3.3V 供电且 AO 不超过 3.3V，可保持 1.0。
const float PH_DIVIDER_RATIO = 1.0;
const float TDS_DIVIDER_RATIO = 1.0;
const float TURBIDITY_DIVIDER_RATIO = 1.0;

// ─────────────────────────────
// 传感器标定参数：来自 firmware/参考程序，并保留现场快速校准入口
// ─────────────────────────────
const float DEFAULT_TEMPERATURE_C = 25.0;  // 当前没有独立温度探头，先用 25℃ 做补偿基准

// pH：参考程序中“pH 7.3 时 PO=2.46V”，斜率约 0.18V/pH，电压越低 pH 越高
const float PH_CAL = 7.30;
const float PH_V_CAL = 2.460;
const float PH_SLOPE = 0.180;

// 浊度：参考程序公式，输出单位 NTU，范围限制 0~3000
const float TURBIDITY_K_VALUE = 3347.19;

// TDS 与 EC：参考程序使用 DFRobot 类 TDS 多项式，EC 单位 µS/cm。
// TDS 常用近似：tds(ppm) = ec(µS/cm) * 0.5；现场可按探头说明改为 0.5~0.7。
const float TDS_FACTOR = 0.5;

// CCCD 回调：central 写入 0x2902 时触发，判断是否开启了 Notify
void measureCCCDCallback(BLECharacteristic* chr, uint8_t connID, uint16_t cccd) {
  (void)chr;
  (void)connID;
  notifyEnabled = (cccd & GATT_CLIENT_CHAR_CONFIG_NOTIFY);
  Serial.print("Notify subscription: ");
  Serial.println(notifyEnabled ? "enabled" : "disabled");
}

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
  raw = clampFloat(raw, 0, ADC_MAX_VALUE);
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

SensorSample readSensors() {
  SensorSample m;

  float temperatureC = DEFAULT_TEMPERATURE_C;
  float phVoltage = readSensorOutputVoltage(PH_ADC_PIN, PH_DIVIDER_RATIO);
  float tdsVoltage = readSensorOutputVoltage(TDS_ADC_PIN, TDS_DIVIDER_RATIO);
  float turbidityVoltage = readSensorOutputVoltage(TURBIDITY_ADC_PIN, TURBIDITY_DIVIDER_RATIO);

  m.temperature = temperatureC;
  m.ph = calcPh(phVoltage);
  m.ec = calcEc(tdsVoltage, temperatureC);
  m.tds = m.ec * TDS_FACTOR;
  m.turbidity = calcTurbidity(turbidityVoltage, temperatureC);

  // 水位检测：两根导线导通=高电平 → 水杯已浸没
  m.wet = (digitalRead(WATER_LEVEL_PIN) == HIGH);

  Serial.print("ADC voltage | pH=");
  Serial.print(phVoltage, 3);
  Serial.print("V TDS=");
  Serial.print(tdsVoltage, 3);
  Serial.print("V Turbidity=");
  Serial.print(turbidityVoltage, 3);
  Serial.println("V");

  return m;
}

String toJson(const SensorSample& m) {
  char buf[PAYLOAD_BUF_SIZE];
  snprintf(buf, sizeof(buf),
           "{\"tds\":%.0f,\"ph\":%.2f,\"temperature\":%.1f,\"turbidity\":%.2f,\"ec\":%.0f,\"wet\":%s}",
           m.tds, m.ph, m.temperature, m.turbidity, m.ec, m.wet ? "true" : "false");
  return String(buf);
}

void setup() {
  pinMode(LED_R, OUTPUT);
  pinMode(LED_G, OUTPUT);
  pinMode(LED_B, OUTPUT);
  led(255, 0, 0);

  pinMode(PH_ADC_PIN, INPUT);
  pinMode(TDS_ADC_PIN, INPUT);
  pinMode(TURBIDITY_ADC_PIN, INPUT);

  // 水位检测引脚：外部下拉，导通时被拉高 → HIGH=浸没
  pinMode(WATER_LEVEL_PIN, INPUT);

  Serial.begin(115200);
  Serial.println("AquaCup BW16 booting with real ADC sensors");

  // 广播：Flags + 设备名放主广播；服务 UUID 放扫描响应，避免 31 字节溢出
  advData.addFlags(GAP_ADTYPE_FLAGS_LIMITED | GAP_ADTYPE_FLAGS_BREDR_NOT_SUPPORTED);
  advData.addCompleteName("AquaCup-01");
  scanData.addCompleteServices(BLEUUID(SERVICE_UUID));

  // Measurement 特征：仅 Notify（对齐 ESP32 版 PROPERTY_NOTIFY）
  measureChar.setNotifyProperty(true);
  measureChar.setCCCDCallback(measureCCCDCallback);
  measureChar.setBufferLen(PAYLOAD_BUF_SIZE);

  measureService.addCharacteristic(measureChar);

  BLE.init();
  BLE.configAdvert()->setAdvData(advData);
  BLE.configAdvert()->setScanRspData(scanData);
  BLE.configServer(1);
  BLE.addService(measureService);

  BLE.beginPeripheral();
  led(0, 255, 0);
  Serial.println("BLE advertising as AquaCup-01");
  delay(200);
}

void loop() {
  led(255, 255, 255);

  // conn_id 0 为首个连接；断开后 Ameba 会自动恢复广播
  if (BLE.connected(0) && notifyEnabled && millis() - lastSample >= SAMPLE_INTERVAL_MS) {
    lastSample = millis();
    String payload = toJson(readSensors());
    measureChar.writeString(payload);  // 写入特征值缓冲
    measureChar.notify(0);             // 向 conn_id 0 推送 Notify
    Serial.println(payload);
  }
  delay(10);
}

void led(int r, int g, int b) {
  analogWrite(LED_R, r * luminance / 255);
  digitalWrite(LED_G, g * luminance / 255);
  analogWrite(LED_B, b * luminance / 255);
}
