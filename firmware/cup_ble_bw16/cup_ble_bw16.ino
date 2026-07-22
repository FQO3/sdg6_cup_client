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

#define SERVICE_UUID        "0000FFE0-0000-1000-8000-00805F9B34FB"
#define MEASUREMENT_UUID    "0000FFE1-0000-1000-8000-00805F9B34FB"
#define PAYLOAD_BUF_SIZE    128

BLEService        measureService(SERVICE_UUID);
BLECharacteristic measureChar(MEASUREMENT_UUID);
BLEAdvertData     advData;
BLEAdvertData     scanData;

// central 是否已开启 Notify 订阅（由 CCCD 回调维护）
bool notifyEnabled = false;

const uint32_t SAMPLE_INTERVAL_MS = 700;
uint32_t lastSample = 0;

// CCCD 回调：central 写入 0x2902 时触发，判断是否开启了 Notify
void measureCCCDCallback(BLECharacteristic* chr, uint8_t connID, uint16_t cccd) {
  (void)chr;
  (void)connID;
  notifyEnabled = (cccd & GATT_CLIENT_CHAR_CONFIG_NOTIFY);
  Serial.print("Notify subscription: ");
  Serial.println(notifyEnabled ? "enabled" : "disabled");
}

// TODO: 替换为真实传感器采集 + 标定换算
struct Metrics { float tds, ph, temperature, turbidity, ec; };

Metrics readSensors() {
  // 示例模拟值；实际接 TDS/pH/温度/浊度模块的 ADC 读数并换算
  Metrics m;
  m.tds         = 100 + random(0, 500);
  m.ph          = 6.5 + random(0, 200) / 100.0;
  m.temperature = 18 + random(0, 120) / 10.0;
  m.turbidity   = random(0, 600) / 100.0;
  m.ec          = 200 + random(0, 1000);
  return m;
}

String toJson(const Metrics& m) {
  char buf[PAYLOAD_BUF_SIZE];
  snprintf(buf, sizeof(buf),
    "{\"tds\":%.0f,\"ph\":%.2f,\"temperature\":%.1f,\"turbidity\":%.2f,\"ec\":%.0f}",
    m.tds, m.ph, m.temperature, m.turbidity, m.ec);
  return String(buf);
}

void setup() {
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
  Serial.println("BLE advertising as AquaCup-01");
}

void loop() {
  // conn_id 0 为首个连接；断开后 Ameba 会自动恢复广播
  if (BLE.connected(0) && notifyEnabled &&
      millis() - lastSample >= SAMPLE_INTERVAL_MS) {
    lastSample = millis();
    String payload = toJson(readSensors());
    measureChar.writeString(payload);   // 写入特征值缓冲
    measureChar.notify(0);              // 向 conn_id 0 推送 Notify
    Serial.println(payload);
  }
  delay(10);
}
