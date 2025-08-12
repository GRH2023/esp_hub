#mainly chatgpt:

import json, threading, time
from collections import deque
from pathlib import Path
from datetime import datetime

from flask import Flask, jsonify, send_from_directory
import requests

POLL_MS = 2000
HISTORY_LEN = 50

app = Flask(__name__, static_folder="public", static_url_path="")
app.config["JSONIFY_PRETTYPRINT_REGULAR"] = False

# Load sensors
SENSORS = json.loads(Path("sensors.json").read_text(encoding="utf-8"))

# State
history = {s["id"]: deque(maxlen=HISTORY_LEN) for s in SENSORS}
latest  = {s["id"]: None for s in SENSORS}

def poll_loop():
    while True:
        for s in SENSORS:
            url = f'{s["base"]}/api/value'
            try:
                r = requests.get(url, timeout=1.5)
                r.raise_for_status()
                j = r.json()  # payload: "value" and "ms"
                val = int(j.get("value", 0))
                t = int(time.time() * 1000)
                entry = {"t": t, "v": val}
                latest[s["id"]] = entry
                history[s["id"]].append(entry)
            except Exception:
                # no handling
                pass
        time.sleep(POLL_MS / 1000)

threading.Thread(target=poll_loop, daemon=True).start()

# API for reads
@app.get("/api/sensors")
def api_sensors():
    return jsonify([{"id": s["id"], "name": s["name"]} for s in SENSORS])

@app.get("/api/history/<sid>")
def api_history(sid):
    arr = list(history.get(sid, []))
    return jsonify(arr[-10:])  # last 10

@app.get("/api/live")
def api_live():
    return jsonify({s["id"]: latest.get(s["id"]) for s in SENSORS})

# ----- Static (PWA) -----
@app.get("/")
def index():
    return send_from_directory("public", "index.html")


"""
@app.get("/manifest.webmanifest")
def manifest():
    return send_from_directory("public", "manifest.webmanifest")
"""
@app.get("/manifest.webmanifest")
def manifest():
    return send_from_directory("public", "manifest.webmanifest"), 200, {
        "Content-Type": "application/manifest+json"
    }



@app.get("/sw.js")
def sw():
    # service worker must be served with correct MIME
    return send_from_directory("public", "sw.js"), 200, {"Content-Type": "application/javascript"}

# Icons passthrough
@app.get("/icon-192.png")
def icon192():
    return send_from_directory("public", "icon-192.png")

@app.get("/icon-512.png")
def icon512():
    return send_from_directory("public", "icon-512.png")

"""
if __name__ == "__main__":
    # Start in HTTP for zero-friction. HTTPS instructions below.
    app.run(host="0.0.0.0", port=8080, debug=False)"""
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8443, debug=False,
            ssl_context=("cert.pem", "key.pem"))