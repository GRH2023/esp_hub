//mainly chatgpt:

const ALARM_THRESHOLD = 800; // manual threshold...
const grid = document.getElementById("grid");
const Y_MIN = 0;
const Y_MAX = 4096;


// keep references per sensor
const cards = new Map();     // id -> { root,value,updated,status,banner,list,canvas,ctx }
const histories = new Map(); // id -> [{t,v},...]

function fmt(t) { return new Date(t).toLocaleTimeString(); }

function createCard({ id, name }) {
  const el = document.createElement("section");
  el.className = "card";
  el.innerHTML = `
    <h2>${name}</h2>
    <div><span class="badge off" data-status>offline</span></div>
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
  const entry = {
    root: el,
    value: el.querySelector("[data-value]"),
    updated: el.querySelector("[data-updated]"),
    status: el.querySelector("[data-status]"),
    banner: el.querySelector("[data-banner]"),
    list: el.querySelector("[data-list]"),
    canvas,
    ctx
  };
  cards.set(id, entry);

  // redraw on resize
  window.addEventListener("resize", () => {
    const hist = histories.get(id) || [];
    drawChart(entry, hist);
  });
}

function setOnline(id, online) {
  const c = cards.get(id); if (!c) return;
  c.status.textContent = online ? "online" : "offline";
  c.status.className = `badge ${online ? "ok" : "off"}`;
}

function setValue(id, entry) {
  const c = cards.get(id); if (!c || !entry) return;
  c.value.textContent = entry.v;
  c.updated.textContent = `Updated ${fmt(entry.t)}`;
  c.banner.style.display = entry.v < ALARM_THRESHOLD ? "block" : "none";
}

function renderHistory(id, arr) {
  const c = cards.get(id); if (!c) return;
  c.list.innerHTML = "";
  for (let i = arr.length - 1; i >= 0; i--) {
    const li = document.createElement("li");
    li.textContent = `${fmt(arr[i].t)}: ${arr[i].v}`;
    c.list.appendChild(li);
  }
}


function drawChart(cardEls, hist) {
  const { canvas, ctx } = cardEls;
  const DPR = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 300;
  const cssH = canvas.clientHeight || 160;

  // size for devicePixelRatio
  if (canvas.width !== Math.floor(cssW * DPR) || canvas.height !== Math.floor(cssH * DPR)) {
    canvas.width = Math.floor(cssW * DPR);
    canvas.height = Math.floor(cssH * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); // draw in CSS pixels
  }
  const W = canvas.width / DPR;
  const H = canvas.height / DPR;

  ctx.clearRect(0, 0, W, H);

  const pad = { l: 44, r: 10, t: 10, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  // axes box
  ctx.strokeStyle = "#ddd";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + plotH);
  ctx.lineTo(pad.l + plotW, pad.t + plotH);
  ctx.stroke();

  // no data yet?
  if (!hist || hist.length === 0) return;

  // FIXED Y scale
  const minV = Y_MIN;
  const maxV = Y_MAX;
  const n = hist.length;
  const step = n > 1 ? plotW / (n - 1) : plotW;
  const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
  const yFor = v => pad.t + plotH - ((clamp(v,minV,maxV) - minV) / (maxV - minV)) * plotH;

  // gridlines & y ticks (every 1000)
  ctx.strokeStyle = "#eee";
  ctx.fillStyle = "#555";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "right";
  for (let yTick = minV; yTick <= maxV; yTick += 1000) {
    const y = yFor(yTick);
    ctx.beginPath();
    ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + plotW, y); ctx.stroke();
    ctx.fillText(String(yTick), pad.l - 6, y + 4);
  }

  // alarm line (only if within range)
  if (ALARM_THRESHOLD >= minV && ALARM_THRESHOLD <= maxV) {
    const yAlarm = yFor(ALARM_THRESHOLD);
    ctx.strokeStyle = "#b71c1c";
    ctx.setLineDash([4,4]);
    ctx.beginPath();
    ctx.moveTo(pad.l, yAlarm);
    ctx.lineTo(pad.l + plotW, yAlarm);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // line
  ctx.strokeStyle = "#0066cc";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = pad.l + i * step;
    const y = yFor(hist[i].v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // points
  ctx.fillStyle = "#0066cc";
  for (let i = 0; i < n; i++) {
    const x = pad.l + i * step;
    const y = yFor(hist[i].v);
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  }

  // x labels (first/last timestamps)
  ctx.fillStyle = "#555";
  ctx.textAlign = "center";
  ctx.fillText(timeLabel(hist[0].t), pad.l, pad.t + plotH + 18);
  if (n >= 2) ctx.fillText(timeLabel(hist[n-1].t), pad.l + plotW, pad.t + plotH + 18);
}


/* -------- charting -------- */
/*
function drawChart(cardEls, hist) {
  const { canvas, ctx } = cardEls;
  // size canvas for devicePixelRatio
  const DPR = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 300;
  const cssH = canvas.clientHeight || 160;
  if (canvas.width !== Math.floor(cssW * DPR) || canvas.height !== Math.floor(cssH * DPR)) {
    canvas.width = Math.floor(cssW * DPR);
    canvas.height = Math.floor(cssH * DPR);
    ctx.setTransform(DPR,0,0,DPR,0,0); // draw in CSS pixels
  }
  const W = canvas.width / DPR;
  const H = canvas.height / DPR;

  ctx.clearRect(0,0,W,H);

  const pad = { l: 40, r: 10, t: 10, b: 24 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  // axes
  ctx.strokeStyle = "#ddd";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + plotH);
  ctx.lineTo(pad.l + plotW, pad.t + plotH);
  ctx.stroke();

  if (!hist || hist.length === 0) return;

  // min/max for y
  let minV = Infinity, maxV = -Infinity;
  for (const h of hist) { if (h.v < minV) minV = h.v; if (h.v > maxV) maxV = h.v; }
  if (minV === maxV) { minV -= 1; maxV += 1; } // avoid zero range

  const n = hist.length;
  const step = n > 1 ? plotW / (n - 1) : plotW;
  const yFor = v => pad.t + plotH - ((v - minV) / (maxV - minV)) * plotH;

  // alarm line
  const yAlarm = yFor(ALARM_THRESHOLD);
  ctx.strokeStyle = "#b71c1c";
  ctx.setLineDash([4,4]);
  ctx.beginPath();
  ctx.moveTo(pad.l, yAlarm);
  ctx.lineTo(pad.l + plotW, yAlarm);
  ctx.stroke();
  ctx.setLineDash([]);

  // line
  ctx.strokeStyle = "#0066cc";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = pad.l + i * step;
    const y = yFor(hist[i].v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // points
  ctx.fillStyle = "#0066cc";
  for (let i = 0; i < n; i++) {
    const x = pad.l + i * step;
    const y = yFor(hist[i].v);
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  }

  // labels
  ctx.fillStyle = "#555";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(String(maxV), pad.l - 6, pad.t + 10);
  ctx.fillText(String(minV), pad.l - 6, pad.t + plotH);

  ctx.textAlign = "center";
  if (n >= 1) ctx.fillText(timeLabel(hist[0].t), pad.l, pad.t + plotH + 18);
  if (n >= 2) ctx.fillText(timeLabel(hist[n-1].t), pad.l + plotW, pad.t + plotH + 18);
}*/

function timeLabel(ms) { return new Date(ms).toLocaleTimeString(); }
/* -------------------------- */

async function refresh() {
  try {
    const sensors = await fetch("/api/sensors").then(r => r.json());
    if (cards.size === 0) sensors.forEach(createCard);

    const live = await fetch("/api/live").then(r => r.json());

    for (const s of sensors) {
      const isOnline = !!live[s.id];
      setOnline(s.id, isOnline);
      if (isOnline) setValue(s.id, live[s.id]);

      const hist = await fetch(`/api/history/${s.id}`).then(r => r.json());
      histories.set(s.id, hist);
      renderHistory(s.id, hist);
      const els = cards.get(s.id);
      drawChart(els, hist);
    }
  } catch (e) {
    // keep last known UI
  }
}

refresh();
setInterval(refresh, 2000);
