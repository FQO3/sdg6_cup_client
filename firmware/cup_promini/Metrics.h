/*
 * Metrics.h — 水杯端一帧传感数据结构
 * ────────────────────────────────────────────────
 * 单独放进头文件，确保该类型在 .ino 自动生成的函数原型之前完成声明，
 * 避免出现 "'Metrics' does not name a type" 的编译顺序问题。
 */
#ifndef CUP_PROMINI_METRICS_H
#define CUP_PROMINI_METRICS_H

struct Metrics {
  float tds;
  float ph;
  float temperature;
  float turbidity;
  float ec;
  bool wet;

  // ── 调试原始数据（用于重新拟合曲线，不进入 JSON 帧）──
  int   phAdcRaw;         // pH 引脚中值 ADC (0~1023)
  float phVoltage;        // pH 引脚电压 (V)
  float phRawLevel;       // 库输出的未裁剪 pH

  int   tdsAdcRaw;        // TDS/EC 引脚中值 ADC
  float tdsVoltage;       // TDS/EC 传感器输出电压 (V)

  int   turbidityAdcRaw;  // 浊度引脚中值 ADC
  float turbidityVoltage; // 浊度传感器输出电压 (V)

  int   tempAdcRaw;       // PH4502C To 引脚原始 ADC（诊断用）
};

#endif  // CUP_PROMINI_METRICS_H
