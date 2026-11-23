/* =========================================================================
 * views.js — Render functions for each page. Pure HTML-string builders that
 * read Store.State + Charts helpers. app.js wires events and re-renders.
 * ========================================================================= */
(function (global) {
  "use strict";
  const S = global.Store, C = global.Charts, D = global.Domain, H = global.Hotspots;
  const esc = C.esc;
  const { SCENARIOS } = global.Scenarios;
  const SCEN = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));

  function pctStr(v) { return Math.round(v * 100) + "%"; }
  function layerPill(layer) {
    return `<span class="pill layer" style="background:${C.LAYER_COLORS[layer]}">${layer}</span>`;
  }

  // Human-readable labels + explanations for every config knob, so version
  // diffs read as plain English instead of raw JSON keys.
  const KNOB_META = {
    "model.name":                 { label: "Model", desc: "The generation model in use." },
    "model.temperature":          { label: "Temperature", desc: "Sampling randomness. High values invite hallucinated numbers." },
    "model.maxOutputTokens":      { label: "Max output tokens", desc: "Upper bound on the model's reply length." },
    "context.systemPromptVersion":{ label: "System prompt", desc: "Which system prompt is loaded (v2 adds a scope guardrail)." },
    "context.catalogTopK":        { label: "Catalog top-K", desc: "How many products are placed in the context window." },
    "context.includePolicy":      { label: "Inject refund policy", desc: "Whether the refund window & cap are given to the model." },
    "context.historyTurns":       { label: "History turns", desc: "How many prior turns are kept in context." },
    "memory.enabled":             { label: "Profile memory", desc: "Whether the agent recalls the customer's saved profile/orders." },
    "memory.recallAccuracy":      { label: "Recall accuracy", desc: "How reliably memory returns the right records." },
    "harness.maxToolCalls":       { label: "Max tool calls", desc: "Tool-call budget per turn." },
    "harness.validateToolArgs":   { label: "Validate tool args", desc: "Whether the harness checks tool arguments before dispatch." },
    "harness.refundGuardrail":    { label: "Refund guardrail", desc: "Whether refunds are gated by the policy (window & cap)." },
    "harness.retryOnToolError":   { label: "Retry on tool error", desc: "Whether the harness retries a failed tool call." },
    "tools.pricingSource":        { label: "Pricing source", desc: "Where prices are read from (live vs stale cache)." },
    "tools.inventorySource":      { label: "Inventory source", desc: "Where stock levels are read from." },
  };
  function knobLabel(layer, key) {
    const m = KNOB_META[layer + "." + key];
    return m ? m.label : key;
  }
  function knobDesc(layer, key) {
    const m = KNOB_META[layer + "." + key];
    return m ? m.desc : "";
  }
  function fmtVal(layer, key, v) {
    if (v === undefined) return "—";
    if (typeof v === "boolean") return v ? "on" : "off";
    if (key === "systemPromptVersion") return "v" + v;
    if (key === "temperature") return String(v);
    if (typeof v === "number" && v > 0 && v < 1) return v; // accuracy etc.
    return String(v);
  }
  // Is a change an improvement (green) or a regression (amber)? Used for arrows.
  function changeTone(layer, key, from, to) {
    const better = {
      "model.temperature": to < from,
      "context.catalogTopK": to > from,
      "context.systemPromptVersion": to > from,
      "context.includePolicy": to === true,
      "memory.enabled": to === true,
      "memory.recallAccuracy": to > from,
      "harness.validateToolArgs": to === true,
      "harness.refundGuardrail": to === true,
      "harness.retryOnToolError": to === true,
      "tools.pricingSource": to === "live",
    }[layer + "." + key];
    return better === undefined ? "neutral" : (better ? "up" : "down");
  }

  // ---------------- OVERVIEW / FLYWHEEL ----------------
  function overview(state) {
    const m = state.metrics;
    const hist = state.history;
    const active = !m ? 0 : (state.fixLog.length ? 3 : (Object.keys(state.tags).length ? 2 : 1));
    const qseries = hist.map((h) => h.quality);
    const firstQ = hist.length ? hist[0].quality : 0;
    const lastQ = hist.length ? hist[hist.length - 1].quality : 0;
    const gain = lastQ - firstQ;

    return `
    <div class="page-head">
      <h2>ShopBot's improvement loop</h2>
      <p>Run ShopBot, measure it, inspect the failures, and fix the worst one. Each fix
         changes one of the five parts (model, context, memory, harness, tools). Then run it
         again and see what the fix bought.</p>
    </div>

    <div class="callout">
      <b>How to use this app:</b> Start at <b>Simulate</b> to generate traces, explore them in
      <b>Traces</b> (tag what looks wrong), then open <b>Hotspots</b> to apply one-click fixes and
      re-simulate. Return here to see the score climb. To build your own assistant from the
      same five parts, open <b>Sandbox</b> at the bottom of the menu.
    </div>

    <div class="grid cols-2">
      <div class="card center">
        <h3>The Loop</h3>
        ${C.flywheel(active)}
        <div class="muted" style="font-size:12px">Current stage highlighted based on your progress.</div>
      </div>
      <div class="card">
        <h3>Agent Quality Over Iterations</h3>
        ${hist.length ? `
          <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px">
            <span class="big mono" style="font-size:34px;color:${C.scoreColor(lastQ)}">${Math.round(lastQ*100)}</span>
            <span class="muted">/ 100 quality score</span>
            ${gain>0?`<span class="delta up">▲ +${Math.round(gain*100)} since v1</span>`:``}
          </div>
          ${C.sparkline(qseries, { color: "#7c9cff", w: 420, h: 90 })}
          <div class="row muted" style="font-size:11px;justify-content:space-between">
            <span>${esc(hist[0].version)}</span><span>${esc(hist[hist.length-1].version)}</span>
          </div>
        ` : `<div class="empty"><div class="big">📈</div>No runs yet.<br>Go to <b>Simulate</b> and press Run.</div>`}
      </div>
    </div>

    ${m ? `
    <div class="grid cols-4" style="margin-top:16px">
      ${kpiTile("Quality", Math.round(m.quality*100), gain, "")}
      ${kpiTile("Task Success", Math.round(m.rates.task_success*100)+"%", null, "")}
      ${kpiTile("Policy Safety", Math.round(m.rates.policy_safety*100)+"%", null, "")}
      ${kpiTile("Containment", Math.round(m.containment*100)+"%", null, "")}
    </div>` : ``}

    ${state.fixLog.length ? `
    <div class="card" style="margin-top:16px">
      <h3>Improvement log: every fix and what it changed</h3>
      <table><thead><tr><th>Version</th><th>Layer</th><th>Fix Applied</th><th>Quality Δ</th></tr></thead>
      <tbody>${state.fixLog.map((f) => `<tr>
        <td class="mono">${esc(f.version)}</td>
        <td>${layerPill(f.layer)}</td>
        <td>${esc(f.label)}</td>
        <td class="mono ${f.deltaQuality>=0?'':''}"><span class="delta ${f.deltaQuality>=0?'up':'down'}">${f.deltaQuality>=0?'▲ +':'▼ '}${Math.round(f.deltaQuality*100)}</span></td>
      </tr>`).join("")}</tbody></table>
    </div>` : ``}`;
  }

  function kpiTile(label, value, delta, suffix) {
    return `<div class="card kpi">
      <div class="lbl">${esc(label)}</div>
      <div class="big">${esc(String(value))}${esc(suffix||"")}</div>
      ${delta!=null && delta!==0 ? `<div class="delta ${delta>0?'up':'down'}">${delta>0?'▲ +':'▼ '}${Math.round(delta*100)}</div>` : `<div class="delta">&nbsp;</div>`}
    </div>`;
  }

  // ---------------- CHAT ----------------
  function chat(state) {
    return `
    <div class="page-head">
      <h2>Talk to the Service Agent</h2>
      <p>ShopBot handles product questions, availability, pricing, orders, and refunds.
         Every message runs the full layered pipeline — the trace is captured just like in production.
         Try the suggested prompts to feel the current version's strengths and bugs.</p>
    </div>
    <div class="grid cols-2">
      <div class="card">
        <h3>Conversation <span class="ver-badge">${esc(state.config.version)}</span></h3>
        <div class="chip-row" id="chatChips">
          ${["Is the Nimbus Speaker in stock?","How much is the Volt Power Bank?",
             "Refund my order ORD-9004 please.","What's the weather in Paris?",
             "Tell me about the Flux Smartwatch."].map((q)=>`<span class="chip">${esc(q)}</span>`).join("")}
        </div>
        <div class="chat">
          <div class="chat-log" id="chatLog"></div>
          <div class="chat-input">
            <input id="chatInput" placeholder="Ask about products, pricing, orders, refunds…" autocomplete="off"/>
            <button class="btn" id="chatSend">Send</button>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>Live Trace of the Last Turn</h3>
        <div class="sub">The exact spans, context window, and tools the agent used.</div>
        <div id="chatTrace"><div class="empty"><div class="big">💬</div>Send a message to see its trace.</div></div>
      </div>
    </div>`;
  }

  // ---------------- SIMULATE ----------------
  function simulate(state) {
    const m = state.metrics;
    return `
    <div class="page-head">
      <h2>Simulate Traffic</h2>
      <p>Run the full scenario bank through the current agent to generate a batch of traces,
         the raw material for finding failures. Increase volume to see how metrics stabilize.</p>
    </div>
    <div class="card">
      <div class="row">
        <div>
          <div class="muted" style="font-size:12px">Agent version</div>
          <div class="mono" style="font-size:20px;color:var(--accent-2)">${esc(state.config.version)}</div>
        </div>
        <div class="divider" style="width:1px;height:40px;background:var(--border);margin:0 6px"></div>
        <div>
          <div class="muted" style="font-size:12px">Scenarios</div>
          <div class="mono" style="font-size:20px">${SCENARIOS.length}</div>
        </div>
        <div>
          <label class="muted" style="font-size:12px;display:block">Repeats (volume)</label>
          <select id="repeats" class="btn ghost sm">
            <option value="1">1× (${SCENARIOS.length} traces)</option>
            <option value="3">3× (${SCENARIOS.length*3} traces)</option>
            <option value="5">5× (${SCENARIOS.length*5} traces)</option>
          </select>
        </div>
        <div class="spacer"></div>
        <button class="btn" id="runSim">▶ Run Simulation</button>
        <button class="btn ghost" id="resetAgent">↺ Reset agent to v1</button>
      </div>
    </div>
    ${m ? `
    <div class="grid cols-4" style="margin-top:16px">
      ${kpiTile("Traces", m.count, null, "")}
      ${kpiTile("p50 latency", m.p50, null, "ms")}
      ${kpiTile("p95 latency", m.p95, null, "ms")}
      ${kpiTile("Avg tokens", Math.round(m.avgTokens), null, "")}
    </div>
    <div class="card" style="margin-top:16px">
      <h3>Trace Batch</h3>
      <div class="sub">Latest ${m.count} traces. Click any row to inspect it in the Trace Explorer.</div>
      ${traceTable(state, state.traces.slice(0, 30))}
    </div>` : `<div class="card" style="margin-top:16px"><div class="empty"><div class="big">🧪</div>Press <b>Run Simulation</b> to generate traces.</div></div>`}`;
  }

  function traceTable(state, traces) {
    return `<table><thead><tr>
      <th>Trace</th><th>Intent</th><th>User said</th><th>Score</th><th>Issues</th><th>Latency</th><th>Tags</th>
    </tr></thead><tbody>
    ${traces.map((tr) => {
      const g = global.Evals.gradeTrace(tr);
      const tags = state.tags[tr.traceId] || [];
      return `<tr class="clickable" data-trace="${esc(tr.traceId)}">
        <td class="mono">${esc(tr.traceId)}</td>
        <td>${esc(tr.intent)}</td>
        <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(tr.userText)}</td>
        <td><span class="pill ${g.score>=0.99?'pass':'fail'}">${Math.round(g.score*100)}%</span></td>
        <td>${tr.issues.length ? `<span class="pill fail">${tr.issues.length}</span>` : `<span class="pill pass">0</span>`}</td>
        <td class="mono">${tr.totalMs}ms</td>
        <td>${tags.length ? `<span class="pill layer" style="background:var(--warn)">${tags.length}🏷</span>` : ''}</td>
      </tr>`;
    }).join("")}
    </tbody></table>`;
  }

  // ---------------- METRICS ----------------
  function metrics(state) {
    const m = state.metrics;
    if (!m) return `<div class="page-head"><h2>Metrics &amp; Evals</h2></div>
      <div class="card"><div class="empty"><div class="big">📊</div>No metrics yet — run a simulation first.</div></div>`;
    const r = m.rates;
    const hist = state.history;
    const evalRows = [
      ["Intent Accuracy", r.intent_accuracy, "Correctly classified the request type."],
      ["Task Success", r.task_success, "Accomplished what the customer wanted."],
      ["Grounding", r.grounding, "Prices/stock grounded in tools — no hallucination."],
      ["Policy Safety", r.policy_safety, "Refunds respected the window & auto-approve cap."],
      ["Scope Adherence", r.scope_adherence, "Stayed within store topics."],
      ["No Redundant Asks", r.no_redundant_ask, "Didn't re-ask info memory should recall."],
    ];
    return `
    <div class="page-head">
      <h2>Metrics &amp; Evals</h2>
      <p>Objective, ground-truth scoring across the batch. Correctness and safety are weighted
         most heavily in the blended Quality Score. Watch these move as you apply fixes.</p>
    </div>
    <div class="grid cols-3">
      <div class="card center"><h3>Quality Score</h3>${C.gauge(m.quality, "blended")}</div>
      <div class="card">
        <h3>Eval Suite</h3>
        <div class="sub">Pass rate per check across ${m.count} traces.</div>
        ${evalRows.map(([l,v]) => C.bar(l, v)).join("")}
      </div>
      <div class="card">
        <h3>Operational</h3>
        ${C.bar("Containment", m.containment, { color: "#57c8b8" })}
        ${C.bar("Tool-error rate", m.toolErrorRate, { color: m.toolErrorRate>0?"#f26d6d":"#3ecf8e" })}
        <div class="divider"></div>
        <div class="kv">
          <span class="k">p50 latency</span><span class="v">${m.p50} ms</span>
          <span class="k">p95 latency</span><span class="v">${m.p95} ms</span>
          <span class="k">Avg tokens/trace</span><span class="v">${Math.round(m.avgTokens)}</span>
        </div>
      </div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h3>What each eval means</h3>
        <table><tbody>${evalRows.map(([l,,d])=>`<tr><td style="width:150px"><b>${esc(l)}</b></td><td class="muted">${esc(d)}</td></tr>`).join("")}</tbody></table>
      </div>
      <div class="card"><h3>Quality trend</h3>
        ${hist.length>1 ? C.sparkline(hist.map(h=>h.quality), { color:"#7c9cff", w:420, h:120 })
          : `<div class="muted">Apply a fix and re-simulate to build a trend.</div>`}
        ${hist.length>1?`<div class="tag-legend">${hist.map(h=>`<span>${esc(h.version)}: ${Math.round(h.quality*100)}</span>`).join("")}</div>`:''}
      </div>
    </div>`;
  }

  // ---------------- TRACES (explorer + tagging) ----------------
  function traces(state) {
    if (!state.traces.length) return `<div class="page-head"><h2>Trace Explorer</h2></div>
      <div class="card"><div class="empty"><div class="big">🔬</div>No traces yet — run a simulation first.</div></div>`;
    const counts = S.tagCounts();
    return `
    <div class="page-head">
      <h2>Trace Explorer &amp; Manual Tagging</h2>
      <p>Pick a trace, read its <b>expected vs actual</b> outcome, then walk the step-by-step
         execution log — every span expands to the raw payload the agent actually saw and produced
         (context window, model params, memory recall, tool args/results, guardrail decisions).
         Form a <b>hypothesis</b> about which layer failed, record it, then <b>reveal the root cause</b>
         to check your work. Confirmed hypotheses feed the automated hotspot detector.</p>
    </div>
    ${Object.keys(counts).length ? `<div class="card" style="margin-bottom:16px"><h3>Your tags so far</h3>
      <div>${Object.entries(counts).map(([l,c])=>`<span class="tag">${esc(l)} <b>×${c}</b></span>`).join("")}</div>
      <div class="muted" style="font-size:12px;margin-top:8px">These are exactly the clusters the Hotspots view detects automatically.</div>
    </div>`:''}
    <div class="grid cols-2">
      <div class="card">
        <h3>Traces</h3>
        <div class="sub">Click a row to open it.</div>
        <div style="max-height:560px;overflow:auto">${traceTable(state, state.traces)}</div>
      </div>
      <div class="card" id="tracePanel">
        <div class="empty"><div class="big">👈</div>Select a trace to inspect &amp; tag it.</div>
      </div>
    </div>`;
  }

  // ---- Human-readable "expected behavior" from a scenario's ground truth.
  function expectedText(scen) {
    if (!scen || !scen.expect) return "Free-form chat — no ground-truth expectation.";
    const e = scen.expect, parts = [];
    if (e.mustDecline) parts.push("Politely decline — this is out of scope.");
    if (e.sku) parts.push("Answer about product " + e.sku + ".");
    if (e.mustMention) parts.push("Response should mention: " + e.mustMention.map((m) => `"${m}"`).join(", ") + ".");
    if (e.inStock === false) parts.push("Should report the item is out of stock.");
    if (e.inStock === true && e.low) parts.push("Should report it's in stock but low.");
    if (e.price != null) parts.push("Correct price is " + D.fmt$(e.price) + ".");
    if (e.canOrder === true) parts.push("Should place the order.");
    if (e.canOrder === false) parts.push("Should refuse the order (out of stock).");
    if (e.refundOK === true) parts.push("Refund should be granted (within policy).");
    if (e.refundOK === false) parts.push("Refund should NOT be auto-granted — " + (e.reason || "policy violation") + ".");
    return parts.join(" ");
  }

  // ---- Render one span as an expandable step with its full raw payload.
  const STEP_LABEL = {
    "session.start": "Harness boots the session",
    "profile.recall": "Memory recalls the customer profile",
    "window.assemble": "Context window is assembled for the model",
    "generate.intent": "Model classifies intent",
    "generate.final": "Model writes the final answer",
    "tool.call": "Tool is invoked",
    "tool.validate": "Harness validates tool arguments",
    "tool.retry": "Harness retries after a tool round-trip",
    "guardrail.refund": "Harness evaluates the refund guardrail",
    "resample": "Model resamples a low-confidence draft",
    "session.end": "Harness closes the session",
  };

  // Turn a span payload into readable key/value rows (context window rendered
  // as prompt blocks; everything else as a kv grid + raw JSON fallback).
  function spanBody(s) {
    const p = s.payload || {};
    let body = "";
    if (s.name === "window.assemble" && p.blocks) {
      body += `<div class="muted" style="font-size:11px;margin-bottom:6px">`+
        `${Number.isFinite(p.tokens) ? p.tokens + " tokens · " : ""}catalog topK=${p.catalogTopK} · system prompt v${p.promptVersion}. `+
        `This is the EXACT text the model saw — if a product or policy is missing here, the model can't use it.</div>`;
      for (const b of p.blocks)
        body += `<div class="ctx-block"><div class="role">${esc(b.role)}</div><pre>${esc(b.text)}</pre></div>`;
      return body;
    }
    if (s.name === "tool.call") {
      return `<div class="kv">
        <span class="k">tool</span><span class="v">${esc(p.tool)}</span>
        <span class="k">arguments</span><span class="v">${esc(JSON.stringify(p.args))}</span>
        <span class="k">result</span><span class="v">${esc(String(p.result))}</span>
        <span class="k">data source</span><span class="v">${esc(p.source)}${p.source==="stale"?' ⚠ (cache, may be outdated)':''}</span>
      </div>`;
    }
    // Generic: render every payload field.
    const rows = Object.entries(p).filter(([k]) => k !== "blocks");
    if (!rows.length) return `<div class="muted" style="font-size:12px">No payload.</div>`;
    body += `<div class="kv">`;
    for (const [k, v] of rows) {
      let val = typeof v === "object" ? JSON.stringify(v) : String(v);
      let flag = "";
      if (k === "temperature" && Number(v) >= 0.7) flag = ' ⚠ (high — invites hallucination)';
      if (k === "enabled" && v === false) flag = ' ⚠ (disabled)';
      if (k === "hit" && v === false) flag = ' ⚠ (recall missed)';
      body += `<span class="k">${esc(k)}</span><span class="v">${esc(val)}${flag}</span>`;
    }
    body += `</div>`;
    return body;
  }

  // Full trace detail (used in Traces panel and Chat trace pane).
  function traceDetail(tr, opts) {
    opts = opts || {};
    const g = global.Evals.gradeTrace(tr);
    const scen = SCEN[tr.scenarioId];
    const state = S.State;
    const tags = state.tags[tr.traceId] || [];
    const revealed = S.isRevealed(tr.traceId) || opts.readOnly;
    const failed = Object.entries(g.checks).filter(([, v]) => !v).map(([k]) => k);

    let html = `<div class="row"><h3 style="margin:0">${esc(tr.traceId)}
      <span class="ver-badge">${esc(tr.configVersion)}</span></h3>
      <div class="spacer"></div>
      <span class="pill ${g.score>=0.99?'pass':'fail'}">${g.score>=0.99?'PASS':'FAIL'} · ${Math.round(g.score*100)}%</span></div>`;

    // ---- Expected vs Actual (the "what's wrong" framing) ----
    html += `<div class="grid cols-2" style="gap:10px;margin-top:12px">
      <div class="ctx-block" style="margin:0"><div class="role">customer asked (${esc(tr.customer)})</div>
        <pre>${esc(tr.userText)}</pre></div>
      <div class="ctx-block" style="margin:0;border-color:var(--accent-2)"><div class="role">expected behavior (ground truth)</div>
        <pre>${esc(expectedText(scen))}</pre></div>
    </div>`;
    html += `<div class="ctx-block" style="border-color:${g.score>=0.99?'var(--ok)':'var(--danger)'}">
      <div class="role">agent actually answered</div><pre>${esc(tr.answer)}</pre></div>`;

    // Failed checks summary (says THAT it failed, not WHY).
    if (failed.length) {
      html += `<div class="callout" style="border-left-color:var(--danger);margin:12px 0 4px">
        <b>${failed.length} eval check${failed.length>1?'s':''} failed:</b>
        ${failed.map((f) => `<span class="pill fail" style="margin:2px">${esc(f)}</span>`).join("")}
        <div class="muted" style="font-size:12px;margin-top:6px">Walk the execution log below to form a hypothesis about which layer caused this — then reveal the root cause.</div>
      </div>`;
    } else {
      html += `<div class="callout" style="border-left-color:var(--ok);margin:12px 0 4px">
        <b>All eval checks passed.</b> <span class="muted">Still worth inspecting how the agent got there.</span></div>`;
    }

    // ---- Full scorecard ----
    html += `<div class="row" style="gap:6px;margin:10px 0 4px">`;
    for (const [k, v] of Object.entries(g.checks))
      html += `<span class="pill ${v?'pass':'fail'}">${esc(k)} ${v?'✓':'✗'}</span>`;
    html += `</div>`;

    // ---- Step-by-step execution log (expandable raw payloads) ----
    html += `<h3 style="margin-top:16px">Execution log
      <span class="muted mono" style="font-size:11px">${tr.spans.length} steps · ${tr.totalMs}ms · ${tr.totalTokens} tok</span></h3>`;
    html += `<div class="sub">Every step the harness ran, in order. Click a step to expand its raw payload — the actual context window, model params, tool args/results, and guardrail decisions.</div>`;
    html += `<div class="steps">`;
    tr.spans.forEach((s, i) => {
      const col = C.LAYER_COLORS[s.layer] || "#888";
      const openByDefault = ["window.assemble", "tool.call", "generate.intent", "guardrail.refund", "profile.recall"].includes(s.name);
      html += `<details class="step" ${openByDefault ? "open" : ""} style="border-left:3px solid ${col}">
        <summary>
          <span class="step-idx">${i+1}</span>
          <span class="pill layer" style="background:${col}">${s.layer}</span>
          <span class="step-name mono">${esc(s.name)}</span>
          <span class="step-desc">${esc(STEP_LABEL[s.name] || "")}</span>
          <span class="spacer"></span>
          <span class="step-ms mono">${s.ms}ms</span>
        </summary>
        <div class="step-body">${spanBody(s)}</div>
      </details>`;
    });
    html += `</div>`;

    // ---- Visual breakdowns ----
    html += `<div class="grid cols-2" style="margin-top:14px;gap:14px">
      <div><h3 style="margin:0 0 6px">Timeline</h3>${C.timeline(tr.spans)}</div>
      <div><h3 style="margin:0 0 6px">Latency by layer</h3>${C.layerStack(tr.spans, "ms")}
        <h3 style="margin:12px 0 6px">Tokens by layer</h3>${C.layerStack(tr.spans, "tokens")}</div>
    </div>`;

    if (opts.readOnly) return html; // Chat pane: no tagging/reveal workflow

    // ---- Hypothesis tagging ----
    html += `<div class="divider"></div>`;
    html += `<h3>Your hypothesis — which layer is at fault?</h3>`;
    html += `<div class="sub">Based on the execution log above, tag the layer you think caused the problem and why. This is the human judgment the improvement loop depends on.</div>`;
    html += `<div class="row" id="layerPick" style="gap:6px;margin:8px 0">`;
    for (const L of H.LAYER_ORDER)
      html += `<button class="btn ghost sm layer-pick" data-layer="${L}"
        style="border-color:${C.LAYER_COLORS[L]};color:${C.LAYER_COLORS[L]}">${L}</button>`;
    html += `<button class="btn ghost sm layer-pick" data-layer="" style="color:var(--muted)">no issue</button>`;
    html += `</div>`;
    html += `<div class="chat-input" style="margin-top:6px">
      <input id="hypNote" placeholder="Why? e.g. 'catalog was cut off before this SKU' or 'temperature too high'"/>
      <button class="btn sm" id="hypAdd" data-trace="${esc(tr.traceId)}">Record hypothesis</button>
    </div>`;
    html += `<div class="muted" style="font-size:11px;margin-top:6px">Selected layer: <span id="pickedLayer" class="mono">none</span></div>`;

    // Existing tags / hypotheses on this trace.
    if (tags.length) {
      html += `<div style="margin-top:10px" id="tagList">`;
      tags.forEach((t, i) => {
        const badge = t.kind === "hypothesis" && t.layer ? layerPill(t.layer) + " " : "";
        let verdict = "";
        if (revealed && t.kind === "hypothesis") {
          const v = S.scoreHypothesis(tr, t.layer);
          verdict = v === "correct" ? ` <span class="pill pass">✓ matched</span>`
            : v === "no_issue" ? ` <span class="pill pass">✓ clean</span>`
            : ` <span class="pill fail">✗ different layer</span>`;
        }
        html += `<span class="tag">${badge}${esc(t.label)}${t.note?`: <span class="muted">${esc(t.note)}</span>`:''}${verdict}
          <span class="x" data-untag="${i}" data-trace="${esc(tr.traceId)}">✕</span></span>`;
      });
      html += `</div>`;
    }

    // ---- Reveal root cause (the payoff) ----
    html += `<div class="divider"></div>`;
    if (!revealed) {
      html += `<div class="row"><h3 style="margin:0">Root cause</h3><div class="spacer"></div>
        <button class="btn warn sm" id="revealBtn" data-trace="${esc(tr.traceId)}">🔍 Reveal detected root cause</button></div>
        <div class="muted" style="font-size:12px;margin-top:6px">Hidden so you can form your own hypothesis first. Reveal to check your work and see what the automated detector found.</div>`;
    } else {
      html += `<h3>Root cause${tags.some(t=>t.kind==="hypothesis")?' — vs your hypothesis':''}</h3>`;
      if (tr.issues.length) {
        for (const iss of tr.issues)
          html += `<div class="ctx-block" style="border-color:var(--danger)">
            ${layerPill(iss.layer)} <span class="mono" style="font-size:11px">${esc(iss.code)}</span>
            <pre style="margin-top:6px">${esc(iss.detail)}</pre></div>`;
        html += `<div class="muted" style="font-size:12px;margin-top:8px">These cluster across traces into ranked
          <b>Hotspots</b>, each with a one-click fix at the responsible layer.</div>`;
      } else {
        html += `<div class="ctx-block" style="border-color:var(--ok)"><pre>No defects detected in this trace — the agent behaved correctly.</pre></div>`;
      }
    }

    return html;
  }

  // ---------------- HOTSPOTS + FIXES ----------------
  function hotspots(state) {
    if (!state.metrics) return `<div class="page-head"><h2>Hotspots &amp; Fixes</h2></div>
      <div class="card"><div class="empty"><div class="big">🎯</div>Run a simulation first to detect hotspots.</div></div>`;
    const hs = state.hotspots;
    const byL = H.byLayer(hs);
    return `
    <div class="page-head">
      <h2>Automated Hotspot Detection &amp; Layered Fixes</h2>
      <p>The system clusters failures across the batch, ranks them by impact (frequency × severity),
         pinpoints the responsible layer, and proposes a concrete fix. Apply one to mutate the agent
         config, auto-re-simulate, and measure the gain.</p>
    </div>

    <div class="card" style="margin-bottom:16px">
      <h3>Layer heat map</h3>
      <div class="sub">Where the problems concentrate right now.</div>
      <div class="grid cols-5" style="grid-template-columns:repeat(5,1fr)">
        ${H.LAYER_ORDER.map((L) => {
          const impact = (byL[L]||[]).reduce((a,h)=>a+h.impact,0);
          const hot = impact>0;
          return `<div class="card center" style="border-top:4px solid ${C.LAYER_COLORS[L]};${hot?'':'opacity:.5'}">
            <div class="lbl" style="text-transform:capitalize">${L}</div>
            <div class="big" style="font-size:24px;color:${hot?C.scoreColor(1-Math.min(1,impact)):'var(--ok)'}">${(byL[L]||[]).length}</div>
            <div class="muted" style="font-size:11px">${hot?'issues':'clean ✓'}</div>
          </div>`;
        }).join("")}
      </div>
    </div>

    ${hs.length ? hs.map((h, i) => `
      <div class="card hot" style="margin-bottom:14px;border-left-color:${C.LAYER_COLORS[h.layer]}">
        <div class="row">
          <div>${layerPill(h.layer)} <b style="font-size:15px">${esc(h.title)}</b></div>
          <div class="spacer"></div>
          <span class="impact">impact ${h.impact.toFixed(2)} · ${h.count} traces · sev ${h.severity}/5</span>
        </div>
        <div class="why">${esc(h.why)}</div>
        <div class="mono" style="font-size:11px;color:var(--muted)">example: ${esc(h.example)}</div>
        <div class="fix-box">
          <div class="row">
            <div><span class="muted" style="font-size:11px">RECOMMENDED FIX</span><br>
              <span class="fx">${esc(h.fix.label)}</span></div>
            <div class="spacer"></div>
            <button class="btn ok sm" data-fix="${i}">Apply fix &amp; re-simulate</button>
          </div>
        </div>
      </div>
    `).join("") : `<div class="card"><div class="empty"><div class="big">🎉</div>
      No hotspots detected. The agent is passing all evals, and every planted problem is fixed.</div></div>`}

    ${state.fixLog.length ? `<div class="card"><h3>Fixes applied</h3>
      <table><thead><tr><th>Version</th><th>Layer</th><th>Fix</th><th>Quality Δ</th></tr></thead><tbody>
      ${state.fixLog.map((f)=>`<tr><td class="mono">${esc(f.version)}</td><td>${layerPill(f.layer)}</td>
        <td>${esc(f.label)}</td><td><span class="delta ${f.deltaQuality>=0?'up':'down'}">${f.deltaQuality>=0?'▲ +':'▼ '}${Math.round(f.deltaQuality*100)}</span></td></tr>`).join("")}
      </tbody></table></div>`:''}`;
  }

  // ---------------- VERSIONS (version-by-version changes) ----------------
  function versions(state) {
    const timeline = S.versionTimeline();
    if (!timeline.length) return `<div class="page-head"><h2>Version History</h2></div>
      <div class="card"><div class="empty"><div class="big">🧬</div>No versions yet — run a simulation, then apply fixes to build a version history.</div></div>`;

    // Metric columns tracked across versions.
    const metricCols = [
      ["Quality", (h) => h.quality, true],
      ["Task success", (h) => h.rates.task_success, true],
      ["Grounding", (h) => h.rates.grounding, true],
      ["Policy safety", (h) => h.rates.policy_safety, true],
      ["Scope", (h) => h.rates.scope_adherence, true],
      ["No re-ask", (h) => h.rates.no_redundant_ask, true],
      ["Containment", (h) => h.containment, true],
      ["Tool errors", (h) => h.toolErrorRate, false],
      ["p95 ms", (h) => h.p95, null],
      ["Tokens", (h) => Math.round(h.avgTokens), null],
    ];

    // --- Compact matrix: metrics × versions, with per-step deltas. ---
    function cell(col, h, prev) {
      const [, get, higherBetter] = col;
      const v = get(h);
      const isRate = higherBetter !== null;
      const disp = isRate ? Math.round(v * 100) + "%" : v;
      let delta = "";
      if (prev) {
        const d = v - get(prev);
        if (Math.abs(d) > (isRate ? 0.001 : 0.5)) {
          const good = higherBetter === null ? null : (higherBetter ? d > 0 : d < 0);
          const cls = good === null ? "" : (good ? "up" : "down");
          const dd = isRate ? (d > 0 ? "+" : "") + Math.round(d * 100) : (d > 0 ? "+" : "") + Math.round(d);
          delta = ` <span class="delta ${cls}" style="font-size:10px">${dd}</span>`;
        }
      }
      return `<td class="mono">${disp}${delta}</td>`;
    }

    let matrix = `<div class="card"><h3>Metrics across versions</h3>
      <div class="sub">Every version the agent has been through. Deltas are vs the previous version.</div>
      <div style="overflow-x:auto"><table><thead><tr><th>Metric</th>
      ${timeline.map((h) => `<th class="mono">${esc(h.version)}</th>`).join("")}</tr></thead><tbody>`;
    for (const col of metricCols) {
      matrix += `<tr><td style="color:var(--muted)">${esc(col[0])}</td>`;
      timeline.forEach((h, i) => { matrix += cell(col, h, i > 0 ? timeline[i - 1] : null); });
      matrix += `</tr>`;
    }
    matrix += `</tbody></table></div></div>`;

    // --- Per-version change cards: what changed at each layer. ---
    const cards = timeline.map((h) => {
      const isBaseline = h.index === 0;
      const changedLayers = H.LAYER_ORDER.filter((L) => h.diff[L] && h.diff[L].length);
      let body = "";

      if (isBaseline) {
        body = `<div class="muted" style="font-size:13px;margin:6px 0 12px">Baseline agent — the starting configuration across all five layers.</div>`;
        body += `<div class="row" style="gap:6px">${H.LAYER_ORDER.map((L) =>
          `<span class="pill layer" style="background:${C.LAYER_COLORS[L]}">${L}</span>`).join("")}</div>`;
      } else {
        if (h.fix) body += `<div class="callout" style="margin:4px 0 12px">
          <b>Fix:</b> ${esc(h.fix.label)} <span class="muted">— targeted the ${esc(h.fix.layer)} layer to resolve “${esc(h.fix.title)}”.</span></div>`;
        // Group changes by layer.
        body += changedLayers.map((L) => `
          <div style="margin:10px 0 4px"><span class="pill layer" style="background:${C.LAYER_COLORS[L]}">${L}</span></div>
          ${h.diff[L].map((ch) => {
            const tone = changeTone(L, ch.key, ch.from, ch.to);
            const arrow = tone === "up" ? "▲" : tone === "down" ? "▼" : "→";
            const toneCls = tone === "up" ? "up" : tone === "down" ? "down" : "";
            return `<div class="chg">
              <div class="chg-head"><b>${esc(knobLabel(L, ch.key))}</b>
                <span class="chg-vals mono">${esc(fmtVal(L, ch.key, ch.from))}
                  <span class="delta ${toneCls}">${arrow}</span>
                  ${esc(fmtVal(L, ch.key, ch.to))}</span></div>
              <div class="chg-desc">${esc(knobDesc(L, ch.key))}</div>
            </div>`;
          }).join("")}
        `).join("");
        if (!changedLayers.length) body += `<div class="muted">Re-run with no config change.</div>`;
      }

      // --- Scenarios this version fixed (fail → pass) ---
      if (!isBaseline && h.fixedScenarios && h.fixedScenarios.length) {
        body += `<div style="margin-top:14px"><h3 style="margin:0 0 4px">
          ✅ Scenarios fixed <span class="muted mono" style="font-size:11px">(${h.fixedScenarios.length} flipped fail → pass)</span></h3>
          <div class="sub" style="margin-bottom:8px">Concrete conversations that this change repaired.</div>`;
        for (const f of h.fixedScenarios) {
          body += `<div class="fixed-scn">
            <div class="fixed-scn-head">
              <span class="pill pass">FIXED</span>
              <span class="mono" style="font-size:11px">${esc(f.after.id)}</span>
              <span class="pill" style="background:var(--track);color:var(--muted)">${esc(f.after.intent)}</span>
              <span class="fixed-scn-q">"${esc(f.after.userText)}"</span>
            </div>
            <div class="ba-grid">
              <div class="ba before"><div class="ba-lbl">before (${esc(h.prevVersion)}) — failed ${f.before.failedChecks.map(esc).join(", ")}</div>
                <div class="ba-ans">${esc(f.before.answer)}</div></div>
              <div class="ba after"><div class="ba-lbl">after (${esc(h.version)}) — passes ✓</div>
                <div class="ba-ans">${esc(f.after.answer)}</div></div>
            </div>
          </div>`;
        }
        body += `</div>`;
      }

      // Preventive fix: config changed but no scenario flipped on this run.
      if (!isBaseline && changedLayers.length &&
          (!h.fixedScenarios || !h.fixedScenarios.length) &&
          (!h.regressedScenarios || !h.regressedScenarios.length)) {
        body += `<div class="callout" style="margin-top:12px;border-left-color:var(--warn)">
          <b>Preventive hardening.</b> No scenario flipped on this run — this defect is
          intermittent (it depends on sampling), so the fix removes a latent failure that
          won't always show in a single pass. It protects quality under real, varied traffic.</div>`;
      }

      // --- Any regressions introduced (pass → fail) ---
      if (!isBaseline && h.regressedScenarios && h.regressedScenarios.length) {
        body += `<div style="margin-top:12px"><h3 style="margin:0 0 4px">⚠️ Regressions
          <span class="muted mono" style="font-size:11px">(${h.regressedScenarios.length} flipped pass → fail)</span></h3>`;
        for (const f of h.regressedScenarios)
          body += `<div class="fixed-scn"><div class="fixed-scn-head">
            <span class="pill fail">REGRESSED</span>
            <span class="mono" style="font-size:11px">${esc(f.after.id)}</span>
            <span class="fixed-scn-q">"${esc(f.after.userText)}"</span></div></div>`;
        body += `</div>`;
      }

      const qd = h.qualityDelta;
      return `<div class="card" style="border-left:4px solid ${isBaseline ? 'var(--border)' : C.LAYER_COLORS[(h.fix && h.fix.layer) || 'context']}">
        <div class="row">
          <h3 style="margin:0">${esc(h.version)}${isBaseline ? ' — baseline' : ''}</h3>
          ${h.prevVersion ? `<span class="muted mono" style="font-size:11px">from ${esc(h.prevVersion)}</span>` : ''}
          <div class="spacer"></div>
          <span class="mono" style="color:${C.scoreColor(h.quality)};font-size:18px">${Math.round(h.quality * 100)}</span>
          <span class="muted" style="font-size:11px">/100</span>
          ${!isBaseline && Math.abs(qd) > 0.001 ? `<span class="delta ${qd >= 0 ? 'up' : 'down'}">${qd >= 0 ? '▲ +' : '▼ '}${Math.round(qd * 100)}</span>` : ''}
        </div>
        ${body}
      </div>`;
    }).join("");

    return `
    <div class="page-head">
      <h2>Version History — what changed, layer by layer</h2>
      <p>Every iteration of the agent, with the exact configuration change at each layer
         (model, context, memory, harness, tools) and how the metrics responded. This is the
         audit trail of the improvement loop: which setting moved, why, and what it bought.</p>
    </div>
    ${matrix}
    <div style="margin-top:16px">${cards}</div>`;
  }

  // ---------------- CONFIG (inspect the agent) ----------------
  function config(state) {
    const c = state.config;
    const def = D.defaultConfig();
    function knobs(layer, obj, defObj) {
      return Object.entries(obj).map(([k, v]) => {
        const changed = JSON.stringify(v) !== JSON.stringify(defObj[k]);
        return `<div class="knob"><span class="kn">${esc(k)}</span>
          <span class="${changed?'changed':''}">${esc(JSON.stringify(v))}${changed?' ✎':''}</span></div>`;
      }).join("");
    }
    return `
    <div class="page-head">
      <h2>Agent Configuration <span class="ver-badge">${esc(c.version)}</span></h2>
      <p>The full harness state across all five layers. Green ✎ values were changed by fixes
         from the original v1. These are the settings the fixes change.</p>
    </div>
    <div class="grid cols-2">
      ${["model","context","memory","harness","tools"].map((L)=>`
        <div class="card"><h3 style="color:${C.LAYER_COLORS[L]};text-transform:capitalize">${L} layer</h3>
          <div class="cfg">${knobs(L, c[L], def[L])}</div>
        </div>`).join("")}
      <div class="card"><h3>System prompt (v${c.context.systemPromptVersion})</h3>
        <div class="ctx-block"><pre>${esc(D.SYSTEM_PROMPTS[c.context.systemPromptVersion])}</pre></div>
      </div>
    </div>`;
  }

  // The Sandbox: build your own assistant from the same five parts. It is a
  // separate app in sandbox/, shown in a frame so it keeps its own state.
  function sandbox() {
    return `
    <div class="page-head"><h2>Sandbox</h2>
      <p>Build your own assistant from the same five parts and test it. It has its own small
      ShopBot, ShopBot mini, with 10 tests. Nothing here changes the agent version or the
      15 scenarios on the other screens. <a href="sandbox/index.html" target="_blank">Open it in its own tab</a>.</p>
    </div>
    <iframe class="sandbox-frame" src="sandbox/index.html" title="Sandbox" scrolling="no"></iframe>`;
  }

  global.Views = { sandbox, overview, chat, simulate, metrics, traces, traceDetail, hotspots, versions, config, traceTable };
})(window);
