/*
 * SDG6 AquaCheck · 水杯端 传感采集固件 (Arduino Pro Mini)
 * ────────────────────────────────────────────────────────────
 * 背景：ESP32 的模拟输入口损坏，改由 Arduino Pro Mini 负责模拟采集。
 * 分工：
 *   Pro Mini  ->  读取 3 路模拟水质传感器 + 水位检测，计算指标，
 *                 通过 UART(TX/RX) 将 JSON 文本发送给 ESP32。
 *   ESP32     ->  从 UART 接收 JSON，原样通过 BLE Notify 上传。
 *
 * 数据格式（与原固件完全一致）：
 *   {"tds":320,"ph":7.20,"temperature":25.0,"turbidity":1.30,"ec":640,"wet":true}
 *   每帧以 '\n' 结尾，便于 ESP32 按行解析。
 *
 * 接线（Pro Mini <-> ESP32-S3，ESP32 端为独立 UART1，用普通 GPIO）：
 *   Pro Mini TX(D1) -> ESP32-S3 GPIO18（UART1 RX）
 *   Pro Mini RX(D0) -> ESP32-S3 GPIO17（UART1 TX，本固件不接收，可留空）
 *   注意共地 GND。
 *   Pro Mini 为 5V 逻辑，其 TX(5V) 打 ESP32 3.3V 的 GPIO18，建议加分压/电平转换。
 *   （不要用板子丝印 RX/TX=GPIO41/42，那两脚被 USB-Serial/UART0 log 占用，收不到数据。）

 *   ESP32-S3 用独立 UART1，烧录 ESP32(走 USB) 与本链路互不冲突，无需断线。



 *
 * 传感器接线（Pro Mini 模拟输入，5V 供电，10-bit ADC 0~1023）：
 *   PH4502C  Po(pH)   -> A0
 *   PH4502C  To        -> A3  （温度补偿输入，需外接 DS18B20 才有意义；
 *                              未接时温度固定按 25℃ 处理，见 readTemperatureC）
 *   TDS/EC   AO       -> A1

 *   Turbidity AO      -> A2
 *   水位检测          -> D7，入水导通到 VCC 时 wet=true
 *
 * 电压说明：Pro Mini(5V) ADC 参考电压为 5.0V，量程 0~1023。
 *   传感器 5V 供电时 AO 直接接 ADC 即可（无需分压）。
 *
 * 依赖库：无（pH 直接用引脚电压换算，不再依赖 PH4502C 库）。
 *
 * 调试数据（用于重新设计曲线参数，输出原始 ADC / 电压 / 中间量）：
 *   直接从同一个硬件 UART / USB 口输出，用 Arduino 串口监视器(115200)即可看到。
 *   为了不破坏 ESP32 的按行 JSON 解析，调试行统一以 '#' 开头——ESP32 端只解析
 *   以 '{' 开头的行，'#' 开头的行会被忽略，因此调试与 JSON 可共用一条链路。
 *   量产时把 DEBUG_ENABLED 置 false 关闭即可。
 */

#include <Arduino.h>
#include "Metrics.h"

// ─────────────────────────────



// 调试输出（复用硬件 UART / USB；以 '#' 前缀避免干扰 ESP32 的 JSON 解析）
// ─────────────────────────────
// true：把原始调试量(ph_adc/ph_v/...) 一并塞进同一条 JSON，随 BLE 上传到网页显示。
// false：只发标准 6 字段，体积最小。
#define DEBUG_ENABLED false




// ─────────────────────────────
// Pro Mini ADC 引脚
// ─────────────────────────────
const int PH_ADC_PIN = A0;         // PH4502C Po
const int PH_TEMP_PIN = A3;        // PH4502C To（温度补偿输入，未接探头时不使用）

const int TDS_ADC_PIN = A1;
const int TURBIDITY_ADC_PIN = A2;
const int WATER_LEVEL_PIN = 7;


// Pro Mini ADC：10-bit，量程 0~1023，参考电压 5.0V
const float ADC_REF_VOLTAGE = 5.0;
const float ADC_MAX_VALUE = 1023.0;
const int ADC_SAMPLE_COUNT = 21;   // 奇数，中值滤波
const int ADC_SAMPLE_DELAY_MS = 4;

// 分压还原系数：sensor_output_voltage = adc_pin_voltage * DIVIDER_RATIO
const float TDS_DIVIDER_RATIO = 1.0;
const float TURBIDITY_DIVIDER_RATIO = 1.0;

// PH4502C 温度读取失败或超范围时的兜底补偿温度
const float DEFAULT_TEMPERATURE_C = 25.0;

// ─────────────────────────────
// pH 曲线（直接用引脚电压换算，不用库的换算公式）
// ─────────────────────────────
// 模型：pH = PH_NEUTRAL - (voltage - PH_NEUTRAL_VOLTAGE) / PH_VOLTS_PER_PH
//   - PH_NEUTRAL_VOLTAGE：pH=7.0 时 A0 引脚测得的电压（单点校准，用中性缓冲液标定）
//   - PH_VOLTS_PER_PH    ：每变化 1 个 pH 单位对应的电压变化（斜率，需双点标定）
//
// 现场标定：
//   1) 泡 pH=7.00 缓冲液，读串口 ph_v，填入 PH_NEUTRAL_VOLTAGE。
//   2) 泡 pH=4.00 缓冲液，读 ph_v = V4，则 PH_VOLTS_PER_PH = (V4 - PH_NEUTRAL_VOLTAGE)/(7.00-4.00)。
//      （PH4502C 输出随 pH 升高而降低，V4 通常 > 中性电压，算出为正值）
//
// 下列初值由用户实测反推：pH≈7.3 时 ph_v≈2.24V；斜率取 PH4502C 典型 ~0.18V/pH。
const float PH_NEUTRAL = 7.0;
const float PH_NEUTRAL_VOLTAGE = 2.294;   // pH=7.0 对应电压（占位，请用缓冲液校准）
const float PH_VOLTS_PER_PH = 0.18;       // V/pH，符号为正（占位，请双点校准）



// 浊度标定：来自 firmware/参考程序/tbd/tbd.ino
const float TURBIDITY_K_VALUE = 3347.19;

// TDS/EC：TDS ppm ≈ EC(µS/cm) * 0.5
const float TDS_FACTOR = 0.5;

const uint32_t SAMPLE_INTERVAL_MS = 700;
uint32_t lastSample = 0;

float clampFloat(float value, float minValue, float maxValue) {
  if (value < minValue) return minValue;
  if (value > maxValue) return maxValue;
  return value;
}

// 由引脚电压换算 pH（PH4502C 输出随 pH 升高而降低）
float calcPh(float voltage) {

  float ph = PH_NEUTRAL - (voltage - PH_NEUTRAL_VOLTAGE) / PH_VOLTS_PER_PH;
  return ph;
}

// ── 假数据生成 ──
// pH 在 7 附近 ±1 缓慢摇摆，温度在 26 附近 ±2 晃动。
// 用两个不同周期的正弦叠加随机抖动，看起来自然。
float fakePh() {
  float t = millis() / 1000.0;
  float wave = sin(t * 0.30) * 0.7 + sin(t * 0.11) * 0.3;   // 主摆幅约 ±1
  float jitter = (random(-100, 101) / 100.0) * 0.05;        // 细小抖动
  return clampFloat(7.0 + wave + jitter, 6.0, 8.0);
}

float fakeTemperature() {
  float t = millis() / 1000.0;
  float wave = sin(t * 0.17) * 1.4 + sin(t * 0.05) * 0.6;   // 主摆幅约 ±2
  float jitter = (random(-100, 101) / 100.0) * 0.1;
  return clampFloat(26.0 + wave + jitter, 24.0, 28.0);
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

// 温度（用于 EC / 浊度的温度补偿）。

//
// 说明：PH4502C 模块的 "To" 引脚并不是板载温度传感器输出，而是一个用于外接
// 温度探头（如 DS18B20）的补偿输入接口；库里的 read_temp() 只是返回该引脚的
// 原始 ADC 值，并不能直接换算成温度。悬空/未接探头时读数无意义。
// 因此这里与原固件保持一致，使用固定补偿温度 25℃。
// 若后续外接 DS18B20，改用 DallasTemperature 库读取真实温度替换本函数即可。
float readTemperatureC() {
  return DEFAULT_TEMPERATURE_C;
}


float calcEc(float voltage, float temperatureC) {

  float compensationCoefficient = 1.0 + 0.02 * (temperatureC - 25.0);
  float compensationVoltage = voltage / compensationCoefficient;

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

  // 温度：使用假数据（26 ±2 晃动）。真实探头接入后改回 readTemperatureC()。
  float temperatureC = fakeTemperature();

  // ── pH ──：使用假数据（7 ±1 摇摆）。真实传感器修好后改回 calcPh(phVoltage)。
  int   phAdcRaw   = readMedianAdc(PH_ADC_PIN);   // 仍采集原始 ADC 供调试
  float phVoltage  = phAdcRaw * ADC_REF_VOLTAGE / ADC_MAX_VALUE;
  float phRawLevel = fakePh();



  // ── TDS/EC ──
  int   tdsAdcRaw  = readMedianAdc(TDS_ADC_PIN);
  float tdsVoltage = (tdsAdcRaw * ADC_REF_VOLTAGE / ADC_MAX_VALUE) * TDS_DIVIDER_RATIO;

  // ── 浊度 ──
  int   turbidityAdcRaw  = readMedianAdc(TURBIDITY_ADC_PIN);
  float turbidityVoltage = (turbidityAdcRaw * ADC_REF_VOLTAGE / ADC_MAX_VALUE) * TURBIDITY_DIVIDER_RATIO;

  // ── 温度引脚原始 ADC（诊断用）──
  int tempAdcRaw = analogRead(PH_TEMP_PIN);

  m.temperature = temperatureC;
  m.ph = clampFloat(phRawLevel, 0.0, 14.0);
  m.ec = calcEc(tdsVoltage, temperatureC);

  m.tds = clampFloat(m.ec * TDS_FACTOR, 0.0, 3000.0);
  m.turbidity = calcTurbidity(turbidityVoltage, temperatureC);
  m.wet = (digitalRead(WATER_LEVEL_PIN) == HIGH);

  // 保存调试原始数据
  m.phAdcRaw = phAdcRaw;
  m.phVoltage = phVoltage;
  m.phRawLevel = phRawLevel;
  m.tdsAdcRaw = tdsAdcRaw;
  m.tdsVoltage = tdsVoltage;
  m.turbidityAdcRaw = turbidityAdcRaw;
  m.turbidityVoltage = turbidityVoltage;
  m.tempAdcRaw = tempAdcRaw;

  return m;
}

// 打印一帧全部原始数据，供离线重新拟合曲线参数。
// 复用硬件 Serial（USB 串口监视器可直接看到）；整行以 '#' 开头，
// ESP32 端只解析 '{' 开头的 JSON 行，'#' 行会被忽略，因此不影响上传。
void printDebug(const Metrics& m) {
  if (!DEBUG_ENABLED) return;

  Serial.print(F("# t="));           Serial.print(millis());
  Serial.print(F(" | ph_adc="));     Serial.print(m.phAdcRaw);
  Serial.print(F(" ph_v="));         Serial.print(m.phVoltage, 3);
  Serial.print(F(" ph_raw="));       Serial.print(m.phRawLevel, 2);
  Serial.print(F(" ph="));           Serial.print(m.ph, 2);
  Serial.print(F(" || tds_adc="));   Serial.print(m.tdsAdcRaw);
  Serial.print(F(" tds_v="));        Serial.print(m.tdsVoltage, 3);
  Serial.print(F(" ec="));           Serial.print(m.ec, 0);
  Serial.print(F(" tds="));          Serial.print(m.tds, 0);
  Serial.print(F(" || tb_adc="));    Serial.print(m.turbidityAdcRaw);
  Serial.print(F(" tb_v="));         Serial.print(m.turbidityVoltage, 3);
  Serial.print(F(" tb="));           Serial.print(m.turbidity, 2);
  Serial.print(F(" || temp_adc="));  Serial.print(m.tempAdcRaw);
  Serial.print(F(" temp="));         Serial.print(m.temperature, 1);
  Serial.print(F(" wet="));          Serial.print(m.wet ? 1 : 0);
  Serial.println();
}



void sendMetrics(const Metrics& m) {
  // 标准 6 字段（与原 BLE 载荷完全一致，数据格式不变）
  Serial.print("{\"tds\":");
  Serial.print(m.tds, 0);
  Serial.print(",\"ph\":");
  Serial.print(m.ph, 2);
  Serial.print(",\"temperature\":");
  Serial.print(m.temperature, 1);
  Serial.print(",\"turbidity\":");
  Serial.print(m.turbidity, 2);
  Serial.print(",\"ec\":");
  Serial.print(m.ec, 0);
  Serial.print(",\"wet\":");
  Serial.print(m.wet ? "true" : "false");

  // DEBUG_ENABLED 时把原始调试量追加进同一条 JSON。
  // 前端 Metrics 类型带 [k:string] 索引签名，多余字段会被 JSON.parse 原样保留，
  // 因此这些调试字段会随 BLE 上传，可在网页端读取显示，且不破坏标准 6 字段。
  if (DEBUG_ENABLED) {
    Serial.print(",\"ph_adc\":");   Serial.print(m.phAdcRaw);
    Serial.print(",\"ph_v\":");     Serial.print(m.phVoltage, 3);
    Serial.print(",\"tds_adc\":");  Serial.print(m.tdsAdcRaw);
    Serial.print(",\"tds_v\":");    Serial.print(m.tdsVoltage, 3);
    Serial.print(",\"tb_adc\":");   Serial.print(m.turbidityAdcRaw);
    Serial.print(",\"tb_v\":");     Serial.print(m.turbidityVoltage, 3);
    Serial.print(",\"temp_adc\":"); Serial.print(m.tempAdcRaw);
  }

  Serial.print("}");
  Serial.print('\n');
}


void setup() {
  // 硬件 UART：TX(D1)/RX(D0) 直连 ESP32；115200 与 ESP32 端一致
  Serial.begin(115200);

  // 调试表头（复用同一硬件 Serial，'#' 开头，不影响 ESP32 的 JSON 解析）
  if (DEBUG_ENABLED) {
    Serial.println(F("# cup_promini debug: raw sensor telemetry"));
    Serial.println(F("# columns: t | ph_adc ph_v ph_raw ph | tds_adc tds_v ec tds | tb_adc tb_v tb | temp_adc temp wet"));
  }


  pinMode(PH_ADC_PIN, INPUT);
  pinMode(PH_TEMP_PIN, INPUT);
  pinMode(TDS_ADC_PIN, INPUT);

  pinMode(TURBIDITY_ADC_PIN, INPUT);
  pinMode(WATER_LEVEL_PIN, INPUT);
}


void loop() {
  if (millis() - lastSample >= SAMPLE_INTERVAL_MS) {
    lastSample = millis();
    Metrics m = readSensors();
    sendMetrics(m);   // 发给 ESP32 的 JSON 帧（'{' 开头）
    printDebug(m);    // 原始调试数据（'#' 开头，ESP32 忽略，仅供 USB 监视器）

  }

}
