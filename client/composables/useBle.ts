import { ref, computed } from 'vue'
import type { Metrics } from '~/types/reading'

/**
 * Web Bluetooth 封装
 * ─ 约束：仅 HTTPS / localhost 可用；仅 Chrome / Edge 支持
 * ─ GATT（见 API_DESIGN.md Part A）:
 *     Service      UUID 0xFFE0
 *     Measurement  UUID 0xFFE1  (Notify)  ← 水杯端主动推
 * ─ measurement 载荷格式按固件约定（此处示例：JSON 字符串 / 或二进制帧）
 */

// 标准 16-bit UUID 展开为 128-bit 形式
const SERVICE_UUID = 0xffe0
const MEASUREMENT_UUID = 0xffe1

export function useBle() {
  const supported = ref(
    typeof navigator !== 'undefined' && 'bluetooth' in navigator,
  )
  const connected = ref(false)
  const deviceName = ref<string>('')
  const metrics = ref<Metrics | null>(null)
  const error = ref<string>('')

  let device: BluetoothDevice | null = null
  let char: BluetoothRemoteGATTCharacteristic | null = null

  async function connect() {
    error.value = ''
    if (!supported.value) {
      error.value = '当前浏览器不支持 Web Bluetooth（请用 Chrome/Edge，且 HTTPS）'
      return
    }
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
        // optionalServices: [SERVICE_UUID],
      })
      deviceName.value = device.name || '未命名设备'
      device.addEventListener('gattserverdisconnected', onDisconnect)

      const server = await device.gatt!.connect()
      const service = await server.getPrimaryService(SERVICE_UUID)
      char = await service.getCharacteristic(MEASUREMENT_UUID)

      await char.startNotifications()
      char.addEventListener('characteristicvaluechanged', onNotify)
      connected.value = true
    } catch (e: any) {
      error.value = e?.message ?? String(e)
    }
  }

  function onNotify(ev: Event) {
    const dv = (ev.target as BluetoothRemoteGATTCharacteristic).value
    if (!dv) return
    metrics.value = parseMeasurement(dv)
  }

  // TODO(固件对齐)：与 cup_ble.ino 的打包格式保持一致
  // 示例按 JSON 文本解析；若固件发二进制帧，改为 dv.getFloat32/getUint16 逐字段读
  function parseMeasurement(dv: DataView): Metrics {
    try {
      const text = new TextDecoder().decode(dv.buffer)
      return JSON.parse(text) as Metrics
    } catch {
      return {}
    }
  }

  function onDisconnect() {
    connected.value = false
  }

  async function disconnect() {
    try {
      if (char) {
        await char.stopNotifications().catch(() => {})
        char.removeEventListener('characteristicvaluechanged', onNotify)
      }
      device?.gatt?.disconnect()
    } finally {
      connected.value = false
    }
  }

  const status = computed(() =>
    connected.value ? 'connected' : supported.value ? 'idle' : 'unsupported',
  )

  return { supported, connected, deviceName, metrics, error, status, connect, disconnect }
}
