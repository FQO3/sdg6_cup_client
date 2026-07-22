/*
 * SDG6 AquaCheck · 水杯端 BLE 固件骨架 (ESP32)
 * ────────────────────────────────────────────────────────────
 * 板子必须为 ESP32（Arduino Uno 无 BLE）。
 * GATT（严格对齐 API_DESIGN.md Part A / client useBle.ts）:
 *   Service           UUID 0xFFE0
 *   Measurement Char  UUID 0xFFE1   Notify   ← 每采样周期主动推送
 * 载荷格式：JSON 文本（与 useBle.parseMeasurement 一致）
 *   {"tds":320,"ph":7.2,"temperature":24.5,"turbidity":1.3,"ec":640}
 *
 * 依赖：ESP32 BLE Arduino（Arduino IDE 板管理内置）
 * TODO：接入真实传感器读数替换 readSensors() 的模拟值
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define SERVICE_UUID        "0000ffe0-0000-1000-8000-00805f9b34fb"
#define MEASUREMENT_UUID    "0000ffe1-0000-1000-8000-00805f9b34fb"

BLECharacteristic* measureChar = nullptr;
bool deviceConnected = false;
const uint32_t SAMPLE_INTERVAL_MS = 700;
uint32_t lastSample = 0;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* s) override { deviceConnected = true; }
  void onDisconnect(BLEServer* s) override {
    deviceConnected = false;
    s->getAdvertising()->start(); // 断开后重新广播，便于重连
  }
};

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
  char buf[128];
  snprintf(buf, sizeof(buf),
    "{\"tds\":%.0f,\"ph\":%.2f,\"temperature\":%.1f,\"turbidity\":%.2f,\"ec\":%.0f}",
    m.tds, m.ph, m.temperature, m.turbidity, m.ec);
  return String(buf);
}

void setup() {
  Serial.begin(115200);

  BLEDevice::init("AquaCup-01");        // 设备名，客户端过滤/显示用
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
