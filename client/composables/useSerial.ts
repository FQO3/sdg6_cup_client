import { ref, computed } from 'vue'
import type { Metrics } from '~/types/reading'

/**
 * Web Serial 封装 + 多帧聚合（BLE 临时补救方案）
 *
 * ─ 背景：ESP32 的 UART/BLE 链路调试受阻。临时让 Arduino Pro Mini 直接用 USB
 *   串口线连电脑，网页通过 Web Serial API 直接读 Pro Mini 输出的 JSON 行。
 *   数据格式、聚合逻辑与 useBle 完全一致，接口签名也一致，页面可无缝切换。
 *
 * ─ Pro Mini 输出（每行一帧，'\n' 结尾）：
 *     {"tds":320,"ph":7.20,"temperature":25.0,"turbidity":1.30,"ec":640,"wet":true}
 *   以 '#' 开头的调试行会被忽略（与固件约定一致）。
 *
 * ─ 约束：仅 HTTPS / localhost 可用；仅 Chrome / Edge 支持 Web Serial。
 *   波特率需与固件一致（115200）。
 */

const BAUD_RATE = 115200
const WINDOW_SIZE = 3

type MetricKey = keyof Metrics

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

function numericKeys(m: Metrics): MetricKey[] {
  return Object.keys(m).filter(
    (k) => typeof m[k] === 'number' && k !== 'wet',
  ) as MetricKey[]
}

export function useSerial() {
  const supported = ref(
    typeof navigator !== 'undefined' && 'serial' in navigator,
  )
  const connected = ref(false)
  const deviceName = ref<string>('')
  const rawMetrics = ref<Metrics | null>(null)
  const batchedMetrics = ref<Metrics | null>(null)
  const error = ref<string>('')

  // Web Serial 类型在部分 TS 环境未内置，用 any 规避
  let port: any = null
  let reader: any = null

  let keepReading = false

  const frameBuf: Metrics[] = []
  let lineBuf = ''

  async function connect() {
    error.value = ''
    if (!supported.value) {
      error.value = '当前浏览器不支持 Web Serial（请用 Chrome/Edge，且 HTTPS/localhost）'
      return
    }
    frameBuf.length = 0
    lineBuf = ''
    try {
      port = await (navigator as any).serial.requestPort()
      await port!.open({ baudRate: BAUD_RATE })
      deviceName.value = 'Pro Mini (USB Serial)'
      connected.value = true
      keepReading = true
      readLoop()
    } catch (e: any) {
      error.value = e?.message ?? String(e)
    }
  }

  async function readLoop() {
    const decoder = new TextDecoder()
    while (port && port.readable && keepReading) {
      reader = port.readable.getReader()
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (value) ingest(decoder.decode(value, { stream: true }))
        }
      } catch (e: any) {
        if (keepReading) error.value = e?.message ?? String(e)
      } finally {
        reader.releaseLock()
        reader = null
      }
    }
  }

  /** 按 '\n' 切行，逐行解析 */
  function ingest(chunk: string) {
    lineBuf += chunk
    let idx: number
    while ((idx = lineBuf.indexOf('\n')) >= 0) {
      const line = lineBuf.slice(0, idx).trim()
      lineBuf = lineBuf.slice(idx + 1)
      if (line) handleLine(line)
    }
  }

  function handleLine(line: string) {
    if (line[0] !== '{') return // 忽略 '#' 调试行等非 JSON
    const parsed = parseMeasurement(line)
    if (!parsed) return

    rawMetrics.value = parsed
    frameBuf.push(parsed)

    if (frameBuf.length >= WINDOW_SIZE) {
      const batch = frameBuf.slice(-WINDOW_SIZE)
      const keys = numericKeys(parsed)
      const agg = medianOfFrames(batch, keys)
      if (typeof parsed.wet === 'boolean') agg.wet = parsed.wet
      batchedMetrics.value = agg
      frameBuf.splice(0, frameBuf.length - 1)
    }
  }

  function parseMeasurement(text: string): Metrics | null {
    try {
      return JSON.parse(text) as Metrics
    } catch {
      return null
    }
  }

  async function disconnect() {
    keepReading = false
    try {
      if (reader) {
        await reader.cancel().catch(() => {})
      }
      await port?.close().catch(() => {})
    } finally {
      port = null
      reader = null
      connected.value = false
      frameBuf.length = 0
      lineBuf = ''
    }
  }

  const status = computed(() =>
    connected.value ? 'connected' : supported.value ? 'idle' : 'unsupported',
  )

  return {
    supported,
    connected,
    deviceName,
    rawMetrics,
    batchedMetrics,
    error,
    status,
    connect,
    disconnect,
  }
}
