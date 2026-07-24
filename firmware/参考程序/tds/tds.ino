#define TdsSensorPin A1
#define VREF 5.0
#define SCOUNT 30

int analogBuffer[SCOUNT];
int analogBufferTemp[SCOUNT];
int analogBufferIndex = 0, copyIndex = 0;

float averageVoltage = 0;
float ecValue = 0;          // 单位：µS/cm
float temperature = 25.0;   // 温度补偿基准

void setup() {
  Serial.begin(115200);
  pinMode(TdsSensorPin, INPUT);
}

void loop() {
  static unsigned long analogSampleTimepoint = millis();

  // 每 40ms 采样一次
  if (millis() - analogSampleTimepoint > 40U) {
    analogSampleTimepoint = millis();

    analogBuffer[analogBufferIndex] = analogRead(TdsSensorPin);
    analogBufferIndex++;

    if (analogBufferIndex == SCOUNT) {
      analogBufferIndex = 0;
    }
  }

  static unsigned long printTimepoint = millis();

  // 每 800ms 输出一次
  if (millis() - printTimepoint > 800U) {
    printTimepoint = millis();

    for (copyIndex = 0; copyIndex < SCOUNT; copyIndex++) {
      analogBufferTemp[copyIndex] = analogBuffer[copyIndex];
    }

    // 中值滤波并换算电压
    averageVoltage = getMedianNum(analogBufferTemp, SCOUNT) * VREF / 1024.0;

    // 温度补偿至 25℃
    float compensationCoefficient = 1.0 + 0.02 * (temperature - 25.0);
    float compensationVoltage = averageVoltage / compensationCoefficient;

    // EC 换算，单位：µS/cm
    ecValue = 133.42 * compensationVoltage * compensationVoltage * compensationVoltage
            - 255.86 * compensationVoltage * compensationVoltage
            + 857.39 * compensationVoltage;

    Serial.print("EC Value: ");
    Serial.print(ecValue, 0);
    Serial.println(" us/cm");

    // 若要以 mS/cm 显示：
    // Serial.print("EC Value: ");
    // Serial.print(ecValue / 1000.0, 3);
    // Serial.println(" mS/cm");
  }
}

int getMedianNum(int bArray[], int iFilterLen) {
  int bTab[iFilterLen];

  for (byte i = 0; i < iFilterLen; i++) {
    bTab[i] = bArray[i];
  }

  int i, j, bTemp;

  for (j = 0; j < iFilterLen - 1; j++) {
    for (i = 0; i < iFilterLen - j - 1; i++) {
      if (bTab[i] > bTab[i + 1]) {
        bTemp = bTab[i];
        bTab[i] = bTab[i + 1];
        bTab[i + 1] = bTemp;
      }
    }
  }

  if ((iFilterLen & 1) > 0) {
    bTemp = bTab[(iFilterLen - 1) / 2];
  } else {
    bTemp = (bTab[iFilterLen / 2] + bTab[iFilterLen / 2 - 1]) / 2;
  }

  return bTemp;
}