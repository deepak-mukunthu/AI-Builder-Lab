/* =========================================================================
 * charts.js — Tiny dependency-free SVG chart helpers. Everything the app
 * draws (gauges, bars, sparklines, the flywheel ring, span timelines) lives
 * here so the visuals stay consistent and hackable.
 * ========================================================================= */
(function (global) {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const LAYER_COLORS = {
    model:   "#7c9cff",
    context: "#57c8b8",
    memory:  "#f0a45f",
    harness: "#e07ba8",
    tools:   "#b58cf0",
  };
  function scoreColor(v) { // 0..1 → red→amber→green
    if (v >= 0.85) return "#3ecf8e";
    if (v >= 0.6) return "#f5c451";
    return "#f26d6d";
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Radial gauge for the headline Quality Score.
  function gauge(value, label) {
    const pct = Math.max(0, Math.min(1, value));
    const R = 52, C = 2 * Math.PI * R, off = C * (1 - pct * 0.75);
    const col = scoreColor(pct);
    return `<svg viewBox="0 0 140 130" class="gauge">
      <circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--track)" stroke-width="12"
        stroke-dasharray="${C * 0.75} ${C}" stroke-dashoffset="0"
        transform="rotate(135 70 70)" stroke-linecap="round"/>
      <circle cx="70" cy="70" r="${R}" fill="none" stroke="${col}" stroke-width="12"
        stroke-dasharray="${C} ${C}" stroke-dashoffset="${off}"
        transform="rotate(135 70 70)" stroke-linecap="round"
        style="transition:stroke-dashoffset .6s ease, stroke .6s"/>
      <text x="70" y="66" text-anchor="middle" class="gauge-num" fill="${col}">${Math.round(pct * 100)}</text>
      <text x="70" y="86" text-anchor="middle" class="gauge-unit">/ 100</text>
      <text x="70" y="120" text-anchor="middle" class="gauge-label">${esc(label)}</text>
    </svg>`;
  }

  // Horizontal metric bar row.
  function bar(label, value, opts) {
    opts = opts || {};
    const pct = Math.max(0, Math.min(1, value));
    const col = opts.color || scoreColor(pct);
    const disp = opts.display || Math.round(pct * 100) + "%";
    return `<div class="bar-row">
      <span class="bar-label">${esc(label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${pct * 100}%;background:${col}"></span></span>
      <span class="bar-val">${esc(disp)}</span>
    </div>`;
  }

  // Sparkline from an array of numbers (0..1 normalized inside).
  function sparkline(vals, opts) {
    opts = opts || {};
    if (!vals.length) return "";
    const w = opts.w || 220, h = opts.h || 48, pad = 4;
    const min = Math.min(...vals), max = Math.max(...vals);
    const rng = max - min || 1;
    const pts = vals.map((v, i) => {
      const x = pad + (i / Math.max(1, vals.length - 1)) * (w - 2 * pad);
      const y = h - pad - ((v - min) / rng) * (h - 2 * pad);
      return [x, y];
    });
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const area = d + ` L${pts[pts.length - 1][0].toFixed(1)} ${h - pad} L${pts[0][0].toFixed(1)} ${h - pad} Z`;
    const col = opts.color || "#7c9cff";
    const dots = pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.4" fill="${col}"/>`).join("");
    return `<svg viewBox="0 0 ${w} ${h}" class="spark" preserveAspectRatio="none">
      <path d="${area}" fill="${col}22"/>
      <path d="${d}" fill="none" stroke="${col}" stroke-width="2"/>${dots}
    </svg>`;
  }

  // The flywheel ring: 4 spokes, highlights the active stage.
  function flywheel(activeStage) {
    const stages = ["Simulate", "Trace", "Tag & Detect", "Fix"];
    const cx = 130, cy = 130, R = 92;
    let out = `<svg viewBox="-12 0 284 276" class="wheel">`;
    out += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--track)" stroke-width="2" stroke-dasharray="4 6"/>`;
    stages.forEach((s, i) => {
      const ang = -Math.PI / 2 + (i / stages.length) * 2 * Math.PI;
      const x = cx + R * Math.cos(ang), y = cy + R * Math.sin(ang);
      const active = i === activeStage;
      out += `<g class="wheel-node ${active ? "active" : ""}">
        <circle cx="${x}" cy="${y}" r="${active ? 30 : 24}" fill="${active ? "#7c9cff" : "var(--panel-2)"}"
          stroke="${active ? "#7c9cff" : "var(--border)"}" stroke-width="2"/>
        <text x="${x}" y="${y - 2}" text-anchor="middle" class="wheel-idx" fill="${active ? "#0b0e17" : "var(--muted)"}">${i + 1}</text>
        <text x="${x}" y="${y + 42}" text-anchor="middle" class="wheel-lbl">${esc(s)}</text>
      </g>`;
      // arrow to next
      const ang2 = -Math.PI / 2 + ((i + 0.5) / stages.length) * 2 * Math.PI;
      const ax = cx + (R) * Math.cos(ang2), ay = cy + (R) * Math.sin(ang2);
      out += `<text x="${ax}" y="${ay}" text-anchor="middle" class="wheel-arrow">→</text>`;
    });
    out += `<text x="${cx}" y="${cy - 6}" text-anchor="middle" class="wheel-title">IMPROVE</text>`;
    out += `<text x="${cx}" y="${cy + 14}" text-anchor="middle" class="wheel-title">LOOP</text>`;
    out += `</svg>`;
    return out;
  }

  // Span timeline (waterfall) for a single trace.
  function timeline(spans) {
    const total = spans.reduce((a, s) => a + s.ms, 0) || 1;
    const t0 = spans.length ? spans[0].startedAt : 0;
    let out = `<div class="timeline">`;
    for (const s of spans) {
      const left = ((s.startedAt - t0) / total) * 100;
      const width = Math.max(1.5, (s.ms / total) * 100);
      const col = LAYER_COLORS[s.layer] || "#888";
      out += `<div class="tl-row">
        <span class="tl-layer" style="color:${col}">${esc(s.layer)}</span>
        <span class="tl-name">${esc(s.name)}</span>
        <span class="tl-track">
          <span class="tl-bar" style="left:${left}%;width:${width}%;background:${col}" title="${s.ms}ms"></span>
        </span>
        <span class="tl-ms">${s.ms}ms</span>
      </div>`;
    }
    out += `</div>`;
    return out;
  }

  // Stacked layer-contribution bar (tokens or latency by layer).
  function layerStack(spans, field) {
    const by = {};
    for (const s of spans) {
      const v = field === "ms" ? s.ms
        : (s.payload.tokens || s.payload.promptTokens || s.payload.completionTokens || 0);
      by[s.layer] = (by[s.layer] || 0) + v;
    }
    const total = Object.values(by).reduce((a, b) => a + b, 0) || 1;
    let out = `<div class="stack">`;
    for (const L of global.Hotspots.LAYER_ORDER) {
      if (!by[L]) continue;
      out += `<span class="stack-seg" style="width:${(by[L] / total) * 100}%;background:${LAYER_COLORS[L]}"
        title="${L}: ${by[L]}"></span>`;
    }
    out += `</div><div class="stack-legend">`;
    for (const L of global.Hotspots.LAYER_ORDER)
      if (by[L]) out += `<span><i style="background:${LAYER_COLORS[L]}"></i>${L} ${by[L]}</span>`;
    out += `</div>`;
    return out;
  }

  global.Charts = { LAYER_COLORS, scoreColor, esc, gauge, bar, sparkline, flywheel, timeline, layerStack };
})(window);
