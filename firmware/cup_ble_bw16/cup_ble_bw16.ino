/*
 * SDG6 AquaCheck · 水杯端 BLE 固件 (BW16 / RTL8720DN)
 * ────────────────────────────────────────────────────────────
 * 板子：Realtek Ameba BW16 (RTL8720DN)。使用 Ameba Arduino BLE API，
 *       与 ESP32 版 (cup_ble.ino) 采用不同的 BLE 库，但对外 GATT 契约完全一致。
 *
 * API 来源：ambiot/ambd_arduino 官方 BLEUartService 示例 + BLE 库头文件，
 *   已核对以下标识符真实存在：
 *     BLEService / BLECharacteristic / BLEAdvertData / BLEUUID
 *     setNotifyProperty(bool) · setCCCDCallback(cb) · setBufferLen(len)
 *     setData(uint8_t*, len) · writeString(String) · notify(conn_id)
 *     BLE.init() · configAdvert()->setAdvData()/setScanRspData()
 *     BLE.configServer(n) · BLE.addService() · BLE.beginPeripheral()
 *     BLE.connected(conn_id) · GATT_CLIENT_CHAR_CONFIG_NOTIFY
 *
 * GATT（严格对齐 API_DESIGN.md Part A / client useBle.ts，与 ESP32 版相同）:
 *   Service           UUID 0xFFE0
 *   Measurement Char  UUID 0xFFE1   Notify   ← 每采样周期主动推送
 * 载荷格式：JSON 文本（与 useBle.parseMeasurement 一致）
 *   {"tds":320,"ph":7.2,"temperature":24.5,"turbidity":1.3,"ec":640}
 *
 * 依赖：Ameba Arduino 板管理包（安装后自带 BLEDevice.h 等 Ameba BLE 库）
 *   Arduino IDE → 首选项 → 附加开发板管理器网址：
 *     https://github.com/ambiot/ambd_arduino/raw/master/Arduino_package/package_realtek.com_amebad_index.json
 *   开发板选择：AmebaD ARM (32-bits) Boards → BW16 (RTL8720DN)
 * TODO：接入真实传感器读数替换 readSensors() 的模拟值
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

// 水位检测：两根导线导通 = 高电平 → wet=true（水杯已浸没）
#define WATER_LEVEL_PIN PA27


// CCCD 回调：central 写入 0x2902 时触发，判断是否开启了 Notify
void measureCCCDCallback(BLECharacteristic* chr, uint8_t connID, uint16_t cccd) {
  (void)chr;
  (void)connID;
  notifyEnabled = (cccd & GATT_CLIENT_CHAR_CONFIG_NOTIFY);
  Serial.print("Notify subscription: ");
  Serial.println(notifyEnabled ? "enabled" : "disabled");
}

// TODO: 替换为真实传感器采集 + 标定换算
// struct SensorSample { float tds, ph, temperature, turbidity, ec; };c:\Users\MxzfTn2N8Anx\Desktop\北A\sdg6_cup_client\firmware\cup_ble_bw16\SensorSample.h

SensorSample readSensors() {
  // 示例模拟值；实际接 TDS/pH/温度/浊度模块的 ADC 读数并换算
  SensorSample m;
  // m.tds = 100 + random(0, 500);
  // m.ph = 6.5 + random(0, 200) / 100.0;
  // m.temperature = 18 + random(0, 120) / 10.0;
  // m.turbidity = random(0, 600) / 100.0;
  // m.ec = 200 + random(0, 1000);
  m.tds = 200;
  m.ph = 7.2;
  m.temperature = 20;
  m.turbidity = 200;
  m.ec = 400;
  // 水位检测：两根导线导通=高电平 → 水杯已浸没
  m.wet = (digitalRead(WATER_LEVEL_PIN) == HIGH);
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
  led(255,0,0);

  // 水位检测引脚：外部下拉，导通时被拉高 → HIGH=浸没
  pinMode(WATER_LEVEL_PIN, INPUT);


  Serial.begin(115200);
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
  led(0,255,0);
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
