import { ref, computed } from 'vue'
import type { Metrics } from '~/types/reading'

/**
 * Web Bluetooth 封装 + 多帧聚合
 *
 * ─ 链路角色：BLE 数据入口。不判级（本地不产 WQI/level）。
 *
 * ─ 约束：仅 HTTPS / localhost 可用；仅 Chrome / Edge 支持
 *
 * ─ GATT（见 API_DESIGN.md Part A）:
 *     Service      UUID 0xFFE0
 *     Measurement  UUID 0xFFE1  (Notify)  ← 水杯端主动推
 *
 * ─ 多帧聚合策略：
 *     内部维护一个长度为 3 的滑动缓冲区。
 *     每收满 3 帧 → 逐字段取中位数（天然抗单点异常）→ 更新 batchedMetrics。
 *     同时 rawMetrics 保持最新单帧用于展示。
 *
 * ─ 水位检测（wet）：
 *     固件通过两根导线导通检测水位。高电平 = 水杯已浸没 → 固件 JSON 中发 `wet: true`。
 *     客户端透传此标志。
 */

const SERVICE_UUID = 0xffe0
const MEASUREMENT_UUID = 0xffe1

/** 聚合窗口帧数 */
const WINDOW_SIZE = 3

type MetricKey = keyof Metrics

/** 逐字段中位数聚合（抗单帧异常） */
function medianOfFrames(frames: Metrics[], keys: MetricKey[]): Metrics {
  const result: Metrics = {}
  for (const k of keys) {
    const vals = frames.map((f) => f[k]).filter((v): v is NonNullable<typeof v> => v != null)
    if (vals.length === 0) continue
    const sorted = [...vals].sort((a, b) => (a as number) - (b as number))
    const mid = Math.floor(sorted.length / 2)
    ;(result as Record<string, unknown>)[k] = sorted[mid]
  }
  return result
}

/** 从当前 Metrics 提取数值型字段的 key 列表 */
function numericKeys(m: Metrics): MetricKey[] {
  return Object.keys(m).filter(
    (k) => typeof m[k] === 'number' && k !== 'wet',
  ) as MetricKey[]
}

export function useBle() {
  const supported = ref(
    typeof navigator !== 'undefined' && 'bluetooth' in navigator,
  )
  const connected = ref(false)
  const deviceName = ref<string>('')
  /** 最近一帧原始数据（用于 MetricCard 即时展示） */
  const rawMetrics = ref<Metrics | null>(null)
  /** 每 3 帧中位数聚合结果 → 触发 useEvaluate 调 /evaluate */
  const batchedMetrics = ref<Metrics | null>(null)
  const error = ref<string>('')

  let device: BluetoothDevice | null = null
  let char: BluetoothRemoteGATTCharacteristic | null = null

  // ───── 3 帧缓冲 ─────
  const frameBuf: Metrics[] = []

  async function connect() {
    error.value = ''
    if (!supported.value) {
      error.value = '当前浏览器不支持 Web Bluetooth（请用 Chrome/Edge，且 HTTPS）'
      return
    }
    frameBuf.length = 0
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
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
    const parsed = parseMeasurement(dv)
    if (!parsed) return

    rawMetrics.value = parsed
    frameBuf.push(parsed)

    if (frameBuf.length >= WINDOW_SIZE) {
      // 取最近 WINDOW_SIZE 帧
      const batch = frameBuf.slice(-WINDOW_SIZE)
      const keys = numericKeys(parsed)
      const agg = medianOfFrames(batch, keys)
      // 透传 wet：最近一帧的 wet 覆盖
      if (typeof parsed.wet === 'boolean') agg.wet = parsed.wet
      batchedMetrics.value = agg
      // 保留最后 1 帧防滑动窗口断档
      frameBuf.splice(0, frameBuf.length - 1)
    }
  }

  function parseMeasurement(dv: DataView): Metrics | null {
    try {
      const text = new TextDecoder().decode(dv.buffer)
      return JSON.parse(text) as Metrics
    } catch {
      return null
    }
  }

  function onDisconnect() {
    connected.value = false
    frameBuf.length = 0
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
      frameBuf.length = 0
    }
  }

  const status = computed(() =>
    connected.value ? 'connected' : supported.value ? 'idle' : 'unsupported',
  )

  return {
    supported,
    connected,
    deviceName,
    /** 最新单帧（MetricCard 展示用） */
    rawMetrics,
    /** 每 3 帧中位数聚合（触发 /evaluate 用） */
    batchedMetrics,
    error,
    status,
    connect,
    disconnect,
  }
}
