//current meassuremnts
#include <PubSubClient.h>
#include <WiFi.h>
#include "wifi_config.h"  // Your WiFi credentials (ssid, password)

// -------- MQTT / Network --------
const char* mqtt_server = "192.168.164.150"; 
const int mqtt_port = 1883;
const char* mqtt_topic = "sensor/current";
const char* clientBaseID = "ESP32C6_Client_";
String resetStatusMsg = "";
bool waitingForResetAck = false;

// -------- ADC & averaging --------
#define ADC_PIN 34
const int NUM_SAMPLES = 10;  
float samples[NUM_SAMPLES];  // store current in amps
int sampleIndex = 0;
float sumSamples = 0;  
float averageValue = 0.0;
const float shuntResistor = 5.0;  // Ohms

// -------- threshold --------
float percentDrop = 0.0;
float thresholdValue = 0.0;
bool thresholdActive = false;
bool resetRequested = false;
bool thresholdNeedsReset = false;

// -------- timing --------
unsigned long lastPublish = 0;
const unsigned long publishInterval = 2000;  // ms

// -------- MQTT objects --------
WiFiClient espClient;
PubSubClient client(espClient);

// ---------- helpers ----------
void setup_wifi() {
  Serial.print("Connecting to WiFi ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("WiFi connected, IP: ");
  Serial.println(WiFi.localIP());
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg = String((char*)payload, length);
  Serial.print("MQTT msg on ");
  Serial.print(topic);
  Serial.print(": ");
  Serial.println(msg);

  String t = String(topic);

  if (t.endsWith("/set_percent")) {
    float v = msg.toFloat();
    if (v > 0.0 && v <= 100.0) {
      percentDrop = v;
      thresholdActive = true;
      thresholdNeedsReset = true;
      Serial.print("percentDrop set to: ");
      Serial.println(percentDrop);
      resetStatusMsg = "ok";
      waitingForResetAck = false;
      client.publish(mqtt_topic, "ok");
    } else {
      Serial.println("Invalid percent value (0-100 expected).");
    }
  } else if (t.endsWith("/reset_threshold")) {
    resetRequested = true;
  } else if (msg.equalsIgnoreCase("ok") && waitingForResetAck) {
    Serial.println("Reset acknowledged by client.");
    resetStatusMsg = "";
    waitingForResetAck = false;
  }
}

void reconnect() {
  while (!client.connected()) {
    String cli = String(clientBaseID) + String(random(0xffff), HEX);
    Serial.print("Connecting to MQTT broker...");
    if (client.connect(cli.c_str())) {
      Serial.println("connected");
      client.subscribe("sensor/current/cmd/set_percent");
      client.subscribe("sensor/current/cmd/reset_threshold");
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5s");
      delay(5000);
    }
  }
}

float readCurrent() {
  int raw = analogRead(ADC_PIN);
  float voltage = raw * (3.3 / 4095.0);  // 12-bit ADC scale
  return voltage / shuntResistor;        // Ohm's law
}

// ---------- setup & loop ----------
void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  setup_wifi();
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(mqttCallback);

  // Fill initial buffer with current readings
  for (int i = 0; i < NUM_SAMPLES; ++i) {
    float current = readCurrent();
    samples[i] = current;
    sumSamples += current;
    delay(10);
  }
  averageValue = sumSamples / NUM_SAMPLES;
  thresholdNeedsReset = true;
  randomSeed(analogRead(0));

  resetStatusMsg = "set new threshold percentage drop";
  waitingForResetAck = true;
  client.publish(mqtt_topic, resetStatusMsg.c_str());
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  if (resetRequested) {
    Serial.println("Reset button pressed - waiting for new threshold percent...");
    client.publish(mqtt_topic, "set new threshold percentage drop");
    thresholdActive = false;
    resetRequested = false;
    percentDrop = 0.0;
    resetStatusMsg = "set new threshold percentage drop";
    waitingForResetAck = true;
  }

  // Read current and update rolling average
  float current = readCurrent();
  sumSamples = sumSamples - samples[sampleIndex] + current;
  samples[sampleIndex] = current;
  sampleIndex = (sampleIndex + 1) % NUM_SAMPLES;
  averageValue = sumSamples / NUM_SAMPLES;

  if (thresholdActive && thresholdNeedsReset) {
    thresholdValue = averageValue * (1.0 - percentDrop / 100.0);
    thresholdNeedsReset = false;
    Serial.print("Threshold recalculated: ");
    Serial.println(thresholdValue);
  }

unsigned long now = millis();
if (now - lastPublish >= publishInterval) {
  lastPublish = now;

  // Default status
  String statusText = resetStatusMsg;
  String statusColor = "normal";

  // If threshold is active, check for warning
  if (thresholdActive && averageValue < thresholdValue) {
    statusText = "WARNING!";
    statusColor = "red"; // dashboard should interpret this
  }

  // JSON payload
  String payload = "{";
  payload += "\"current\":";
  payload += String(current, 3);
  payload += ",\"avg\":";
  payload += String(averageValue, 3);
  payload += ",\"threshold_active\":";
  payload += thresholdActive ? "true" : "false";
  payload += ",\"threshold\":";
  payload += thresholdActive ? String(thresholdValue, 3) : "null";
  payload += ",\"percentDrop\":";
  payload += String(percentDrop, 2);
  payload += ",\"reset_status\":\"";
  payload += statusText;
  payload += "\",\"status_color\":\"";
  payload += statusColor;
  payload += "\"}";

  if (client.publish(mqtt_topic, payload.c_str())) {
    Serial.print("Published: ");
    Serial.println(payload);
  } else {
    Serial.println("Publish failed");
  }

  // Separate topics
  client.publish("sensor/current/current", String(current, 3).c_str());
  client.publish("sensor/current/avg", String(averageValue, 3).c_str());
  if (thresholdActive) {
    client.publish("sensor/current/threshold", String(thresholdValue, 3).c_str());
  }
}

  delay(50);
}
