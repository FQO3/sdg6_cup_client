
float TU=0.0;
float TU_value=0.0;
float TU_calibration=0.0;
float temp_data=25.0;
float K_Value=3347.19;
void setup() {
  Serial.begin(9600); //Baud rate: 9600
}
void loop() {
  int sensorValue = analogRead(A0);// read the input on analog pin 0:
  float TU = sensorValue * (5.0 / 1024.0); // Convert the analog reading (which goes from 0 - 1023) to a voltage (0 - 5V):
  TU_calibration=-0.0192*(temp_data-25)+TU;  
  TU_value=-865.68*TU_calibration + K_Value;
  
  if(TU_value<=0){TU_value=0;}
  if(TU_value>=3000){TU_value=3000;}
  Serial.print("TU Value:");
  Serial.print(TU_value); // print out the value you read:
  Serial.println("NTU");
  delay(25);
}

