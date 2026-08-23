/* =========================================================================
 * app.js — Controller: routing, rendering, and event wiring. Subscribes to
 * the Store and re-renders the active view on state changes.
 * ========================================================================= */
(function (global) {
  "use strict";
  const S = global.Store, V = global.Views;

  const ROUTES = [
    { id: "overview", label: "Flywheel", icon: "◎" },
    { id: "chat", label: "Chat with Agent", icon: "💬" },
    { id: "simulate", label: "Simulate", icon: "🧪", step: 1 },
    { id: "metrics", label: "Metrics & Evals", icon: "📊", step: 2 },
    { id: "traces", label: "Traces & Tagging", icon: "🔬", step: 3 },
    { id: "hotspots", label: "Hotspots & Fixes", icon: "🎯", step: 4 },
    { id: "config", label: "Agent Config", icon: "⚙" },
  ];

  let current = "overview";
  let selectedTrace = null;      // for Traces panel
  let pickedLayer = null;        // current hypothesis layer selection
  const chatHistory = [];        // {role, text, trace}

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  function renderSidebar() {
    const state = S.State;
    const nav = ROUTES.map((r) => `
      <button data-route="${r.id}" class="${current===r.id?'active':''}">
        ${r.step ? `<span class="step">${r.step}</span>` : `<span style="width:18px;text-align:center">${r.icon}</span>`}
        ${r.label}
      </button>`).join("");
    return `
      <div class="brand">
        <svg class="brand-logo" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="none" stroke="#7c9cff" stroke-width="3" stroke-dasharray="6 5"/><circle cx="20" cy="20" r="6" fill="#57c8b8"/></svg>
        <div><h1>Data Flywheel</h1><small>Agent performance lab</small></div>
      </div>
      <div class="nav">${nav}</div>
      <div class="sidebar-foot">
        Agent version<br><span class="ver-badge">${state.config.version}</span>
        ${state.metrics ? `<div style="margin-top:10px">Quality<br><b class="mono" style="font-size:18px;color:${global.Charts.scoreColor(state.metrics.quality)}">${Math.round(state.metrics.quality*100)}</b>/100</div>`:''}
        <div style="margin-top:10px">${state.traces.length} traces · ${Object.keys(state.tags).length} tagged</div>
      </div>`;
  }

  function renderMain() {
    const state = S.State;
    switch (current) {
      case "overview": return V.overview(state);
      case "chat": return V.chat(state);
      case "simulate": return V.simulate(state);
      case "metrics": return V.metrics(state);
      case "traces": return V.traces(state);
      case "hotspots": return V.hotspots(state);
      case "config": return V.config(state);
      default: return V.overview(state);
    }
  }

  function render() {
    document.getElementById("sidebar").innerHTML = renderSidebar();
    document.getElementById("main").innerHTML = renderMain();
    wire();
    if (current === "chat") { restoreChat(); }
    if (current === "traces" && selectedTrace) openTrace(selectedTrace);
  }

  // ---- Event wiring (delegated per render) ----
  function wire() {
    document.querySelectorAll("[data-route]").forEach((b) =>
      b.onclick = () => { current = b.dataset.route; if (current!=="traces") selectedTrace=null; render(); });

    // Simulate
    const runSim = document.getElementById("runSim");
    if (runSim) runSim.onclick = () => {
      const reps = parseInt(document.getElementById("repeats").value, 10) || 1;
      S.simulate(reps);
      toast(`Ran ${S.State.metrics.count} traces · quality ${Math.round(S.State.metrics.quality*100)}/100`);
    };
    const reset = document.getElementById("resetAgent");
    if (reset) reset.onclick = () => { S.resetAgent(); selectedTrace=null; toast("Agent reset to v1"); };

    // Trace rows → open in explorer
    document.querySelectorAll("[data-trace]").forEach((el) => {
      if (el.tagName === "TR") el.onclick = () => {
        selectedTrace = el.dataset.trace;
        current = "traces"; render();
      };
    });

    // Hotspot fixes
    document.querySelectorAll("[data-fix]").forEach((b) =>
      b.onclick = () => {
        const h = S.State.hotspots[parseInt(b.dataset.fix, 10)];
        const res = S.applyFix(h);
        toast(`Applied ${h.fix.label} → ${res.version} · quality ${res.deltaQuality>=0?'+':''}${Math.round(res.deltaQuality*100)}`);
      });

    // Chat
    const send = document.getElementById("chatSend");
    if (send) {
      const input = document.getElementById("chatInput");
      const doSend = () => {
        const text = input.value.trim(); if (!text) return;
        sendChat(text); input.value = "";
      };
      send.onclick = doSend;
      input.onkeydown = (e) => { if (e.key === "Enter") doSend(); };
      document.querySelectorAll("#chatChips .chip").forEach((c) =>
        c.onclick = () => { input.value = c.textContent; doSend(); });
    }

    wireTagging();
  }

  function wireTagging() {
    // Legacy custom-label tagging (kept for suggested tags on other views).
    const add = document.getElementById("tagAdd");
    if (add) add.onclick = () => {
      const input = document.getElementById("tagInput");
      const v = input.value.trim(); if (!v) return;
      S.addTag(add.dataset.trace, v);
      render();
    };
    document.querySelectorAll("[data-tagcode]").forEach((el) =>
      el.onclick = () => { S.addTag(el.dataset.trace, el.dataset.tagcode); render(); });
    document.querySelectorAll("[data-untag]").forEach((el) =>
      el.onclick = (e) => { e.stopPropagation();
        S.removeTag(el.dataset.trace, parseInt(el.dataset.untag,10)); render(); });

    // Hypothesis layer picker (module-level selection survives across clicks).
    const picks = document.querySelectorAll(".layer-pick");
    if (picks.length) {
      picks.forEach((b) => {
        if (b.dataset.layer === pickedLayer) b.classList.add("picked");
        b.onclick = () => {
          pickedLayer = b.dataset.layer;
          picks.forEach((x) => x.classList.toggle("picked", x.dataset.layer === pickedLayer));
          const lbl = document.getElementById("pickedLayer");
          if (lbl) lbl.textContent = pickedLayer || "no issue";
        };
      });
    }
    const hyp = document.getElementById("hypAdd");
    if (hyp) hyp.onclick = () => {
      const note = (document.getElementById("hypNote").value || "").trim();
      const label = pickedLayer ? "hypothesis: " + pickedLayer : "hypothesis: no issue";
      S.addTag(hyp.dataset.trace, label, note, pickedLayer);
      pickedLayer = null;
      render();
    };

    // Reveal root cause.
    const rev = document.getElementById("revealBtn");
    if (rev) rev.onclick = () => { S.reveal(rev.dataset.trace); render(); };
  }

  function openTrace(traceId) {
    const tr = S.State.traces.find((t) => t.traceId === traceId);
    const panel = document.getElementById("tracePanel");
    if (tr && panel) { panel.innerHTML = V.traceDetail(tr); wireTagging(); }
  }

  // ---- Chat ----
  function sendChat(text) {
    // Build a synthetic scenario so the agent + evals can run on free text.
    const scen = {
      id: "CHAT-" + (chatHistory.filter(m=>m.role==="user").length+1),
      customer: "cust-alex",
      intent: global.Agent.classifyIntent(text),
      user: text,
      expect: {}, // free chat: no ground truth
    };
    const tr = global.Agent.run(scen, S.State.config, { salt: "chat" });
    chatHistory.push({ role: "user", text });
    chatHistory.push({ role: "bot", text: tr.answer, trace: tr });
    renderChatLog();
    showChatTrace(tr);
  }

  function renderChatLog() {
    const log = document.getElementById("chatLog");
    if (!log) return;
    log.innerHTML = chatHistory.map((m) =>
      `<div class="msg ${m.role}">${global.Charts.esc(m.text)}
        ${m.role==="bot"?`<div class="meta">${m.trace.intent} · ${m.trace.totalMs}ms · ${m.trace.issues.length} issue(s)</div>`:''}</div>`).join("");
    log.scrollTop = log.scrollHeight;
  }
  function restoreChat() { renderChatLog(); const last = [...chatHistory].reverse().find(m=>m.role==="bot"); if (last) showChatTrace(last.trace); }
  function showChatTrace(tr) {
    const el = document.getElementById("chatTrace");
    if (el) el.innerHTML = V.traceDetail(tr, { readOnly: true });
  }

  S.subscribe(() => render());
  document.addEventListener("DOMContentLoaded", () => {
    // Auto-run one simulation so the app opens with data to explore.
    S.simulate(1);
    render();
  });
})(window);
