/* =========================================================================
 * store.js — Central app state + orchestration. Holds the current agent
 * config, the batch of traces from the latest simulation, manual tags, the
 * running metrics history (the flywheel's memory), and applied-fix log.
 * ========================================================================= */
(function (global) {
  "use strict";
  const { SCENARIOS } = global.Scenarios;
  const D = global.Domain;

  const State = {
    config: D.defaultConfig(),
    traces: [],
    metrics: null,
    hotspots: [],
    tags: {},                // traceId -> [tagObjects]
    revealed: {},            // traceId -> bool (root cause unlocked)
    history: [],             // [{version, quality, ...metrics, fixLabel}]
    fixLog: [],              // [{version, layer, label, deltaQuality}]
    versionCounter: 1,
    subscribers: [],
  };

  function emit() { State.subscribers.forEach((fn) => fn(State)); }
  function subscribe(fn) { State.subscribers.push(fn); }

  // Run the full scenario bank (optionally N repeats for volume) through the
  // current config, then score + detect hotspots.
  function simulate(repeats) {
    repeats = repeats || 1;
    const traces = [];
    for (let r = 0; r < repeats; r++)
      for (const s of SCENARIOS)
        traces.push(global.Agent.run(s, State.config, { salt: r ? "r" + r : "" }));
    State.traces = traces;
    State.metrics = global.Evals.evaluate(traces);
    State.hotspots = global.Hotspots.detectHotspots(traces);

    // Record a point in flywheel history. A full config snapshot is kept so
    // the Versions view can diff exactly what changed at each layer. Re-running
    // the SAME version (e.g. pressing "Run" twice) replaces its point rather
    // than appending a duplicate, so history stays one-entry-per-version.
    // Per-scenario pass/fail snapshot (from the base, un-salted trace of each
    // scenario) so the Versions view can show exactly which scenarios flipped
    // pass↔fail when a fix landed.
    const scenarioResults = {};
    for (const s of SCENARIOS) {
      const tr = traces.find((t) => t.scenarioId === s.id); // first = base run
      if (!tr) continue;
      const g = global.Evals.gradeTrace(tr);
      scenarioResults[s.id] = {
        id: s.id, intent: tr.intent, userText: tr.userText,
        answer: tr.answer, pass: g.score >= 0.999, score: g.score,
        failedChecks: Object.entries(g.checks).filter(([, v]) => !v).map(([k]) => k),
        issueLayers: [...new Set(tr.issues.map((i) => i.layer))],
      };
    }

    const point = {
      version: State.config.version,
      config: JSON.parse(JSON.stringify(State.config)),
      quality: State.metrics.quality,
      rates: { ...State.metrics.rates },
      task_success: State.metrics.rates.task_success,
      policy_safety: State.metrics.rates.policy_safety,
      grounding: State.metrics.rates.grounding,
      containment: State.metrics.containment,
      toolErrorRate: State.metrics.toolErrorRate,
      p50: State.metrics.p50,
      p95: State.metrics.p95,
      avgTokens: State.metrics.avgTokens,
      scenarios: scenarioResults,
    };
    const existing = State.history.findIndex((h) => h.version === point.version);
    if (existing >= 0) State.history[existing] = point;
    else State.history.push(point);
    emit();
    return State.metrics;
  }

  function applyFix(hotspot) {
    const prevQuality = State.metrics ? State.metrics.quality : 0;
    const newCfg = global.Hotspots.applyFix(State.config, hotspot);
    State.versionCounter++;
    newCfg.version = "v" + State.versionCounter;
    State.config = newCfg;
    simulate(1);
    const deltaQuality = State.metrics.quality - prevQuality;
    State.fixLog.push({
      version: newCfg.version, layer: hotspot.layer,
      title: hotspot.title, label: hotspot.fix.label, deltaQuality,
    });
    emit();
    return { version: newCfg.version, deltaQuality };
  }

  function resetAgent() {
    State.config = D.defaultConfig();
    State.versionCounter = 1;
    State.traces = []; State.metrics = null; State.hotspots = [];
    State.tags = {}; State.revealed = {}; State.history = []; State.fixLog = [];
    emit();
  }

  // ---- Manual tagging ----
  // A tag can be a plain label or a layer-attributed HYPOTHESIS about what is
  // going wrong. Hypotheses are scored against detected root causes on reveal.
  function addTag(traceId, label, note, layer) {
    const arr = State.tags[traceId] || (State.tags[traceId] = []);
    arr.push({ label, note: note || "", layer: layer || null,
      kind: layer ? "hypothesis" : "label", at: State.versionCounter });
    emit();
  }
  function removeTag(traceId, idx) {
    if (State.tags[traceId]) { State.tags[traceId].splice(idx, 1); emit(); }
  }
  function tagCounts() {
    const counts = {};
    for (const id in State.tags)
      for (const t of State.tags[id]) counts[t.label] = (counts[t.label] || 0) + 1;
    return counts;
  }

  // Reveal the root cause for a trace (unlocks the "Detected issues" section
  // and scores any hypotheses the user recorded).
  function reveal(traceId) { State.revealed[traceId] = true; emit(); }
  function isRevealed(traceId) { return !!State.revealed[traceId]; }

  // Score a hypothesis: did the suspected layer match a detected root cause?
  function scoreHypothesis(trace, layer) {
    const layers = new Set(trace.issues.map((i) => i.layer));
    if (trace.issues.length === 0) return layer == null ? "correct" : "no_issue";
    return layers.has(layer) ? "correct" : "miss";
  }

  // Auto-suggest tags from detected issues (bridges manual → automated).
  function suggestedTags(trace) {
    return [...new Set(trace.issues.map((i) => i.code))];
  }

  // Diff two config snapshots per layer → { layer: [{ key, from, to }] }.
  // `before` may be null (the v1 baseline has nothing before it).
  const LAYERS = ["model", "context", "memory", "harness", "tools"];
  function diffConfigs(before, after) {
    const out = {};
    for (const L of LAYERS) {
      const changes = [];
      const a = (after && after[L]) || {};
      const b = (before && before[L]) || {};
      for (const k of Object.keys(a)) {
        const to = a[k], from = before ? b[k] : undefined;
        if (!before || JSON.stringify(from) !== JSON.stringify(to))
          changes.push({ key: k, from, to, isNew: !before });
      }
      out[L] = changes;
    }
    return out;
  }

  // Build the full version timeline: each entry pairs a history point with the
  // config diff vs the previous version and the metric deltas.
  function versionTimeline() {
    return State.history.map((h, i) => {
      const prev = i > 0 ? State.history[i - 1] : null;
      const fix = State.fixLog.find((f) => f.version === h.version) || null;

      // Scenarios that flipped fail→pass (fixed) or pass→fail (regressed)
      // between the previous version and this one.
      const fixed = [], regressed = [];
      if (prev && prev.scenarios && h.scenarios) {
        for (const id of Object.keys(h.scenarios)) {
          const was = prev.scenarios[id], now = h.scenarios[id];
          if (!was) continue;
          if (!was.pass && now.pass) fixed.push({ before: was, after: now });
          else if (was.pass && !now.pass) regressed.push({ before: was, after: now });
        }
      }

      return {
        ...h,
        index: i,
        prevVersion: prev ? prev.version : null,
        diff: diffConfigs(prev ? prev.config : null, h.config),
        fix,
        qualityDelta: prev ? h.quality - prev.quality : 0,
        fixedScenarios: fixed,
        regressedScenarios: regressed,
      };
    });
  }

  global.Store = {
    State, subscribe, emit, simulate, applyFix, resetAgent,
    addTag, removeTag, tagCounts, suggestedTags,
    reveal, isRevealed, scoreHypothesis,
    diffConfigs, versionTimeline, LAYERS,
  };
})(window);
