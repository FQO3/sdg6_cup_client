/*
 * SDG6 AquaCheck · 水杯端 BLE 桥接固件 (ESP32-S3-MINI)
 * ────────────────────────────────────────────────────────────
 * 背景：ESP32 的模拟输入口损坏，模拟采集改由 Arduino Pro Mini 完成。
 * 分工：
 *   Pro Mini  ->  读取传感器，计算指标，通过 UART(TX/RX) 发 JSON 行给 ESP32。
 *   ESP32     ->  从 UART 收 JSON 行，原样通过 BLE Notify 上传。
 *
 * GATT（对齐客户端 useBle.ts）:
 *   Service           UUID 0xFFE0
 *   Measurement Char  UUID 0xFFE1   Notify
 * 载荷格式（由 Pro Mini 产生，格式不变）：
 *   {"tds":320,"ph":7.20,"temperature":25.0,"turbidity":1.30,"ec":640,"wet":true}
 *
 * ── 关键坑（ESP32-S3 收不到 Pro Mini 数据的真正原因）──
 *   ESP32-S3 上 Arduino 的 `Serial` 默认是 USB-CDC（走原生 USB 口），
 *   并不是芯片的物理 UART0 RX0/TX0 引脚。如果把 Pro Mini TX 接到丝印 RX0，
 *   用 `Serial.read()` 是永远读不到数据的 —— ESP32 收不到 JSON，就没有任何内容
 *   可以 BLE notify，于是网页能连上却收不到数据。
 *
 *   正解：使用独立硬件串口 UART1（HardwareSerial(1)），映射到两个普通 GPIO
 *   接 Pro Mini。`Serial`(USB-CDC) 空出来专门做调试，两者互不干扰。
 *
 * ── 接线（Pro Mini <-> ESP32-S3）──
 *   Pro Mini TX(D1) -> ESP32-S3 GPIO18 (LINK_RX_PIN)
 *   Pro Mini RX(D0) -> ESP32-S3 GPIO17 (LINK_TX_PIN)  (本固件基本不发，可不接)
 *   GND <-> GND 必须共地。
 *   Pro Mini 是 5V 逻辑，ESP32 是 3.3V：Pro Mini TX(5V) -> ESP32 RX(GPIO18)
 *   建议串 1k + 2k 分压或电平转换，避免长期 5V 打 3.3V 引脚。
 *
 *   为什么不用丝印 RX/TX(GPIO41/42)：那两脚在本板上被 USB-Serial/JTAG 或 UART0
 *   log 占用，映射为 UART1 收不到数据（现象：有心跳但 available 恒为 0）。
 *   改用干净的普通 GPIO18/17。`Serial`(USB-CDC) 继续做调试，互不干扰。



 *
 * ── 调试 ──
 *   USB 线插 ESP32-S3 的 USB 口，串口监视器 115200 可看到 [BOOT]/[NOTIFY]/收到的帧。
 */

#include <Arduino.h>
#include <HardwareSerial.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define SERVICE_UUID        "0000ffe0-0000-1000-8000-00805f9b34fb"
#define MEASUREMENT_UUID    "0000ffe1-0000-1000-8000-00805f9b34fb"
#define PAYLOAD_BUF_SIZE    200

// 与 Pro Mini 的数据链路：独立 UART1，映射到普通 GPIO，避免占用 USB-CDC(Serial)
HardwareSerial LinkSerial(1);
// 注意：S3 板子丝印 RX/TX(GPIO41/42) 常被 USB-Serial/JTAG 或 UART0 log 占用，
// 用作 UART1 时可能收不到数据。改用公认干净的普通 GPIO18/17。
const int LINK_RX_PIN = 18;   // 接 Pro Mini TX(D1)
const int LINK_TX_PIN = 17;   // 接 Pro Mini RX(D0)，可不接



const uint32_t LINK_BAUD = 115200;

// 调试开关：走 USB-CDC(Serial)，与数据链路(UART1)互不干扰
#define DBG_ENABLED 1

BLECharacteristic* measureChar = nullptr;
volatile bool deviceConnected = false;

char lineBuf[PAYLOAD_BUF_SIZE];
size_t lineLen = 0;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* s) override {
    (void)s;
    deviceConnected = true;
#if DBG_ENABLED
    Serial.println("[BLE] client connected");
#endif
  }

  void onDisconnect(BLEServer* s) override {
    deviceConnected = false;
#if DBG_ENABLED
    Serial.println("[BLE] client disconnected, re-advertising");
#endif
    s->getAdvertising()->start();
  }
};

void publishPayload(const char* payload) {
  if (measureChar == nullptr) return;
  if (!deviceConnected) {
#if DBG_ENABLED
    Serial.print("[SKIP no client] ");
    Serial.println(payload);
#endif
    return;
  }
  measureChar->setValue((uint8_t*)payload, strlen(payload));
  measureChar->notify();
#if DBG_ENABLED
  Serial.print("[NOTIFY] ");
  Serial.println(payload);
#endif
}

void handleLine(char* line) {
  while (*line == '\r' || *line == ' ') line++;
  if (*line == '\0') return;

  if (line[0] == '#') {          // Pro Mini 的 '#' 调试行：转到 USB 打印，不上传
#if DBG_ENABLED
    Serial.print("[promini] ");
    Serial.println(line);
#endif
    return;
  }

  if (line[0] != '{') {          // 非 JSON：仅调试打印
#if DBG_ENABLED
    Serial.print("[drop] ");
    Serial.println(line);
#endif
    return;
  }

  publishPayload(line);
}

void pumpUart() {
  while (LinkSerial.available() > 0) {
    char c = (char)LinkSerial.read();

    if (c == '\n') {
      lineBuf[lineLen] = '\0';
      handleLine(lineBuf);
      lineLen = 0;
      continue;
    }

    if (lineLen < PAYLOAD_BUF_SIZE - 1) {
      lineBuf[lineLen++] = c;
    } else {
      lineLen = 0; // 溢出保护
    }
  }
}

void setup() {
  Serial.begin(115200);                 // USB-CDC 调试口
  delay(200);
#if DBG_ENABLED
  Serial.println("\n[BOOT] cup_ble on ESP32-S3, link=UART1 (RX=GPIO18 <- ProMini TX) @115200");



#endif

  // 数据链路 UART1，映射到普通 GPIO
  LinkSerial.begin(LINK_BAUD, SERIAL_8N1, LINK_RX_PIN, LINK_TX_PIN);

  BLEDevice::init("AquaCup-01");

  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service = server->createService(SERVICE_UUID);
  measureChar = service->createCharacteristic(
      MEASUREMENT_UUID,
      BLECharacteristic::PROPERTY_NOTIFY);
  measureChar->addDescriptor(new BLE2902());
  service->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  adv->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
#if DBG_ENABLED
  Serial.println("[BLE] advertising as AquaCup-01 (service 0xFFE0 / char 0xFFE1)");
#endif
}

void loop() {
  pumpUart();

#if DBG_ENABLED
  // 心跳：每秒打印一次 UART1 是否收到过字节，用于区分“没接线” vs “loop 卡死”
  static uint32_t lastBeat = 0;
  if (millis() - lastBeat >= 1000) {

    lastBeat = millis();
    Serial.print("[hb] alive, UART1 available=");
    Serial.println(LinkSerial.available());
  }
#endif
}


