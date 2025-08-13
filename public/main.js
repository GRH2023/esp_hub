// public/main.js
// Adds per-sensor Baseline + %Drop -> auto threshold (computed), with persistence.
// Keeps: per-sensor display config, mA for "current", fixed Y ranges, charts, history, online badge.

// ----- per-sensor display config -----
const SENSOR_CONFIG = {
  // id must match topic "sensor/<id>"
  photo: {
    unit: "",                       // raw ADC counts
    transform: v => Math.round(v),  // display conversion
    yMin: 0,
    yMax: 4096,
    tick: 1000,
    defaultThreshold: 800
  },
  current: {
    unit: " mA",
    transform: v => Math.round(v * 1000), // amps -> mA
    yMin: 300,  // band you expect (edit as you like)
    yMax: 500,
    tick: 25,
    defaultThreshold: 400 // mA
  }
};

// Fallback if an id has no explicit config
const DEFAULT_CFG = {
  unit: "",
  transform: v => v,
  yMin: 0, yMax: 4096, tick: 1000,
  defaultThreshold: 800
};

// ----- state -----
const grid = document.getElementById("grid");
const cards = new Map();     // id -> { DOM refs + per-sensor state }
const histories = new Map(); // id -> [{t,v},...]

const fmt    = t  => new Date(t).toLocaleTimeString();
const cfgFor = id => SENSOR_CONFIG[id] || DEFAULT_CFG;

// localStorage keys
const LS_THR  = id => `threshold:${id}`;       // not strictly needed (derived), but we show it
const LS_BASE = id => `baseline:${id}`;
const LS_DROP = id => `dropPct:${id}`;

// Build one card
function createCard({ id, name }) {
  const cfg = cfgFor(id);

  const el = document.createElement("section");
  el.className = "card";
  el.innerHTML = `
    <h2>${name}</h2>
    <div class="health" data-health>Loading…</div>

    <div class="muted" style="margin-top:6px">Baseline & threshold</div>
    <div class="row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0">
      <label>Baseline:</label>
      <input type="number" data-baseline style="width:90px">
      <span class="muted">${cfg.unit.trim() || ""}</span>
      <button data-setbase type="button">Use current</button>
      <button data-setavg type="button">Use avg(10)</button>
    </div>
    <div class="row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0">
      <label>Allowed drop %:</label>
      <input type="number" data-drop value="10" min="0" max="100" step="1" style="width:70px">
    </div>
    <div class="row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0">
      <label>Threshold (auto):</label>
      <input type="number" data-threshold style="width:90px" readonly>
      <span class="muted">${cfg.unit.trim() || ""}</span>
    </div>

    <div style="margin-top:6px"><span class="badge off" data-status>offline</span></div>
    <div class="value" data-value>–</div>
    <div class="muted" data-updated>never</div>
    <div class="banner" data-banner style="display:none">&#9888; Threshold reached!</div>
    <canvas class="chart" data-chart></canvas>
    <div class="muted" style="margin-top:8px">Last 10</div>
    <ul data-list></ul>
  `;
  grid.appendChild(el);

  const canvas = el.querySelector("[data-chart]");
  const ctx = canvas.getContext("2d");

  // initial state
  // load persisted baseline / drop / (threshold is derived)
  let baseline = Number(localStorage.getItem(LS_BASE(id)));
  if (!Number.isFinite(baseline)) baseline = NaN; // not set yet
  let dropPct = Number(localStorage.getItem(LS_DROP(id)));
  if (!Number.isFinite(dropPct)) dropPct = 10;

  const entry = {
    id, config: cfg,
    root: el,
    value: el.querySelector("[data-value]"),
    updated: el.querySelector("[data-updated]"),
    status: el.querySelector("[data-status]"),
    health: el.querySelector("[data-health]"),
    banner: el.querySelector("[data-banner]"),
    list: el.querySelector("[data-list]"),
    baselineInput: el.querySelector("[data-baseline]"),
    setBaseBtn: el.querySelector("[data-setbase]"),
    setAvgBtn: el.querySelector("[data-setavg]"),
    dropInput: el.querySelector("[data-drop]"),
    thresholdInput: el.querySelector("[data-threshold]"),
    baseline,             // display units (e.g., mA)
    dropPct,              // %
    threshold: cfg.defaultThreshold, // will be recomputed when baseline set
    canvas, ctx
  };

  // prime inputs
  if (Number.isFinite(entry.baseline)) entry.baselineInput.value = String(entry.baseline);
  entry.dropInput.value = String(entry.dropPct);

  // listeners
  entry.baselineInput.addEventListener("input", () => {
    const n = Number(entry.baselineInput.value);
    if (Number.isFinite(n)) {
      entry.baseline = n;
      localStorage.setItem(LS_BASE(id), String(n));
      recomputeThreshold(entry);
    }
  });
  entry.dropInput.addEventListener("input", () => {
    let n = Number(entry.dropInput.value);
    if (!Number.isFinite(n)) return;
    n = Math.max(0, Math.min(100, n));
    entry.dropPct = n;
    localStorage.setItem(LS_DROP(id), String(n));
    recomputeThreshold(entry);
  });
  entry.setBaseBtn.addEventListener("click", () => {
    // use the latest display value if available; else fall back to last history point
    const h = histories.get(id) || [];
    let disp = null;
    if (h.length) disp = cfg.transform(h[h.length - 1].v);
    // if live value was just set, prefer that:
    const liveText = entry.value.textContent;
    const liveNum = parseFloat(liveText);
    if (!isNaN(liveNum)) disp = liveNum;

    if (disp != null) {
      entry.baseline = Math.round(disp); // integer for neat thresholds; remove round if you want decimals
      entry.baselineInput.value = String(entry.baseline);
      localStorage.setItem(LS_BASE(id), String(entry.baseline));
      recomputeThreshold(entry);
    }
  });
  entry.setAvgBtn.addEventListener("click", () => {
    const hist = histories.get(id) || [];
    const last10 = hist.slice(-10);
    if (last10.length) {
      const avg = Math.round(last10.reduce((s,p)=>s + cfg.transform(p.v), 0) / last10.length);
      entry.baseline = avg;
      entry.baselineInput.value = String(avg);
      localStorage.setItem(LS_BASE(id), String(avg));
      recomputeThreshold(entry);
    }
  });

  cards.set(id, entry);

  // On first render, if we already have baseline+drop, compute threshold
  recomputeThreshold(entry);

  // redraw on resize
  window.addEventListener("resize", () => drawChart(entry, histories.get(id) || []));
}

// Compute threshold from baseline & drop; update UI + redraw chart
function recomputeThreshold(c) {
  const haveBase = Number.isFinite(c.baseline);
  if (haveBase && Number.isFinite(c.dropPct)) {
    const thr = Math.round(c.baseline * (1 - c.dropPct / 100));
    c.threshold = thr;
    c.thresholdInput.value = String(thr);
    localStorage.setItem(LS_THR(c.id), String(thr));
  } else {
    // fall back to config default if no baseline yet
    c.threshold = c.config.defaultThreshold;
    c.thresholdInput.value = String(c.threshold);
  }
  drawChart(c, histories.get(c.id) || []);
}

// Online/offline badge + card styling
function setOnline(id, online) {
  const c = cards.get(id); if (!c) return;
  c.status.textContent = online ? "online" : "offline";
  c.status.className = `badge ${online ? "ok" : "off"}`;
  c.root.classList.toggle("offline", !online);
  if (!online) { c.health.textContent = "OFFLINE"; c.root.classList.remove("ok","bad"); }
}

// Update live fields using transformed display units
function setValue(id, entry) {
  const c = cards.get(id); if (!c || !entry) return;
  const show = c.config.transform(entry.v); // transformed display value

  c.value.textContent = `${show}${c.config.unit}`;
  c.updated.textContent = `Updated ${fmt(entry.t)}`;

  // Ensure threshold is computed (in case baseline was just set)
  if (!Number.isFinite(c.threshold)) recomputeThreshold(c);

  c.banner.style.display = show < c.threshold ? "block" : "none";
  updateHealth(id, show);
}

// Health summary uses transformed value
function updateHealth(id, displayVal) {
  const c = cards.get(id); if (!c) return;
  if (displayVal >= c.threshold) {
    c.health.textContent = "Sensor OK";
    c.root.classList.add("ok");
    c.root.classList.remove("bad","offline");
  } else {
    c.health.textContent = "SENSOR NOT OK";
    c.root.classList.add("bad");
    c.root.classList.remove("ok","offline");
  }
}

// History list (transformed)
function renderHistory(id, arr) {
  const c = cards.get(id); if (!c) return;
  c.list.innerHTML = "";
  for (let i = arr.length - 1; i >= 0; i--) {
    const show = c.config.transform(arr[i].v);
    const li = document.createElement("li");
    li.textContent = `${fmt(arr[i].t)}: ${show}${c.config.unit}`;
    c.list.appendChild(li);
  }
}

// Chart with per-sensor yMin/yMax/tick and transform()
function drawChart(cardEls, hist) {
  const { canvas, ctx, config: cfg } = cardEls;
  const DPR = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 300;
  const cssH = canvas.clientHeight || 160;

  if (canvas.width !== Math.floor(cssW * DPR) || canvas.height !== Math.floor(cssH * DPR)) {
    canvas.width = Math.floor(cssW * DPR);
    canvas.height = Math.floor(cssH * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  const W = canvas.width / DPR;
  const H = canvas.height / DPR;

  ctx.clearRect(0, 0, W, H);

  const pad = { l: 50, r: 10, t: 10, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  // axes box
  ctx.strokeStyle = "#ddd";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + plotH);
  ctx.lineTo(pad.l + plotW, pad.t + plotH);
  ctx.stroke();

  if (!hist || hist.length === 0) return;

  const minV = cfg.yMin, maxV = cfg.yMax;
  const n = hist.length;
  const step = n > 1 ? plotW / (n - 1) : plotW;
  const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));

  const toY = displayVal =>
    pad.t + plotH - ((displayVal - minV) / (maxV - minV)) * plotH;

  // gridlines & y ticks
  ctx.strokeStyle = "#eee";
  ctx.fillStyle = "#555";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "right";
  const tick = cfg.tick || 1000;
  for (let yTick = minV; yTick <= maxV + 0.001; yTick += tick) {
    const y = toY(yTick);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + plotW, y); ctx.stroke();
    ctx.fillText(String(Math.round(yTick)), pad.l - 6, y + 4);
  }

  // threshold line (display units)
  if (Number.isFinite(cardEls.threshold) &&
      cardEls.threshold >= minV && cardEls.threshold <= maxV) {
    const yAlarm = toY(cardEls.threshold);
    ctx.strokeStyle = "#b71c1c";
    ctx.setLineDash([4,4]);
    ctx.beginPath();
    ctx.moveTo(pad.l, yAlarm); ctx.lineTo(pad.l + plotW, yAlarm); ctx.stroke();
    ctx.setLineDash([]);
  }

  // series (transform each raw v to display units first)
  ctx.strokeStyle = "#0066cc";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = pad.l + i * step;
    const disp = clamp(cfg.transform(hist[i].v), minV, maxV);
    const y = toY(disp);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // points
  ctx.fillStyle = "#0066cc";
  for (let i = 0; i < n; i++) {
    const x = pad.l + i * step;
    const disp = clamp(cfg.transform(hist[i].v), minV, maxV);
    const y = toY(disp);
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  }

  // time labels (first/last)
  ctx.fillStyle = "#555";
  ctx.textAlign = "center";
  ctx.fillText(new Date(hist[0].t).toLocaleTimeString(), pad.l, pad.t + plotH + 18);
  if (n >= 2) ctx.fillText(new Date(hist[n-1].t).toLocaleTimeString(), pad.l + plotW, pad.t + plotH + 18);
}

// Refresh loop
async function refresh() {
  try {
    const sensors = await fetch("/api/sensors").then(r => r.json());
    if (cards.size === 0) sensors.forEach(createCard);

    const live = await fetch("/api/live").then(r => r.json());

    for (const s of sensors) {
      const isOnline = !!live[s.id];
      setOnline(s.id, isOnline);
      if (isOnline && live[s.id]) setValue(s.id, live[s.id]);

      const hist = await fetch(`/api/history/${s.id}`).then(r => r.json());
      histories.set(s.id, hist);
      renderHistory(s.id, hist);
      drawChart(cards.get(s.id), hist);
    }
  } catch (e) {
    // fail-soft
    // console.warn(e);
  }
}

refresh();
setInterval(refresh, 2000);
