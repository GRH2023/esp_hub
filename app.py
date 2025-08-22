# Mainly chatgpt below, but modified to fit our project:

# Subscribes to a broker (Mosquitto)
# Accepts all json payloads from sensor/#
# Sets up a webpage from the java script files 
# Requires paho mqtt lib

import json
import time
import threading
from collections import deque
from pathlib import Path

from flask import Flask, jsonify, send_from_directory
import paho.mqtt.client as mqtt

# ---------- Flask ----------
app = Flask(__name__, static_folder="public", static_url_path="")

# ---------- Config ----------
#Broker IP and port:
MQTT_HOST = "192.168.164.150"
MQTT_PORT = 1883
# sensor subscription setup to sensor/+ to support base sub+different sensors:
TOPIC_FILTER = "sensor/+"

# Sensors added seperately in sensors.json for readability:
SENSORS_PATH = Path(__file__).parent / "sensors.json"
if SENSORS_PATH.exists():
    SENSORS = json.loads(SENSORS_PATH.read_text(encoding="utf-8"))
else:
    SENSORS = [] # if they "pop-up" by themselves


# State: latest + rolling history per id
# latest: { id: {t: wallclock_ms, v: numeric} }
latest = {}
# history: { id: deque([ {t,v}, ... ], maxlen=50) }
history = {s["id"]: deque(maxlen=50) for s in SENSORS}

def now_ms() -> int:
    return int(time.time() * 1000)

def id_from_topic(topic: str) -> str:
    # "sensor/<id>" or "sensor/<id>/something"
    parts = topic.split("/")
    return parts[1] if len(parts) >= 2 else "unknown"

# ---------- MQTT (paho-mqtt 2.x API) ----------
def on_connect(client, userdata, flags, reason_code, properties=None):
    print(f"[MQTT] Connected rc={reason_code}")
    if reason_code == 0:
        client.subscribe(TOPIC_FILTER, qos=0)
        print(f"[MQTT] Subscribed to {TOPIC_FILTER}")
    else:
        print("[MQTT] Connect failed")

def on_message(client, userdata, message):
    sid = id_from_topic(message.topic)

    # Process only base topic "sensor/<id>" (exactly two segments)
    if message.topic.count("/") != 1:
        return

    # Parse JSON
    try:
        j = json.loads(message.payload.decode("utf-8"))
    except Exception as e:
        print("[MQTT] Bad JSON:", e, "topic:", message.topic)
        return

    # 'if sensor==current sensor, then read current, if sensor==photo, then read adc value' etc:
    val = None
    if "current" in j:
        try:
            val = float(j["current"])
        except Exception:
            val = 0.0
    elif "adc" in j:
        try:
            val = int(float(j["adc"]))
        except Exception:
            val = 0
    else:
        return  # return nothing

    # add unknown sensors dynamically
    if sid not in history:
        history[sid] = deque(maxlen=50)
        if all(s["id"] != sid for s in SENSORS):
            SENSORS.append({"id": sid, "name": sid})
            print(f"[MQTT] Discovered new sensor id='{sid}'")

    entry = {"t": now_ms(), "v": val}
    latest[sid] = entry
    history[sid].append(entry)
    # Debug
    # print(f"[MQTT] {sid}: v={val}")

def start_mqtt():
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="hub-subscriber")
    client.on_connect = on_connect
    client.on_message = on_message

    client.reconnect_delay_set(min_delay=1, max_delay=30)
    try:
        print(f"[MQTT] Connecting to {MQTT_HOST}:{MQTT_PORT} ...")
        client.connect(MQTT_HOST, MQTT_PORT, keepalive=30)
    except Exception as e:
        print(f"[MQTT] Initial connect failed: {e}")

    client.loop_start()
    return client

mqtt_client = start_mqtt()

# "API's":
@app.route("/api/sensors")
def api_sensors():
    # List of cards to render: [{id,name}]
    return jsonify([{"id": s["id"], "name": s.get("name", s["id"])} for s in SENSORS])

@app.route("/api/live")
def api_live():
    # Latest values: { id: {t,v}, ... }
    return jsonify(latest)

@app.route("/api/history/<sid>")
def api_history(sid):
    return jsonify(list(history.get(sid, [])))

# ---------- Static (frontend) ----------
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/<path:path>")
def assets(path):
    return send_from_directory(app.static_folder, path)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8443, debug=False)
