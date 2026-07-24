const int PH_PIN = A0;

// 你当前实际校准结果：pH 7.3 时 PO = 2.46V
const float PH_CAL = 7.30;
const float V_CAL  = 2.460;

// 模块标称斜率：pH 每增加 1，电压约下降 0.18V
const float SLOPE = 0.180;

float readVoltage() {
  const int N = 30;
  long sum = 0;

  for (int i = 0; i < N; i++) {
    sum += analogRead(PH_PIN);
    delay(20);
  }

  return (sum / (float)N) * 3.3 / 1023.0;
}

void setup() {
  Serial.begin(9600);
}

void loop() {
  float voltage = readVoltage();

  // 电压低：更碱，pH 更高；电压高：更酸，pH 更低
  float ph = PH_CAL + (V_CAL - voltage) / SLOPE;

  Serial.print("Voltage: ");
  Serial.print(voltage, 3);
  Serial.print(" V\tpH: ");
  Serial.println(ph, 2);

  delay(1000);
}