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

    // Record a point in flywheel history.
    State.history.push({
      version: State.config.version,
      quality: State.metrics.quality,
      task_success: State.metrics.rates.task_success,
      policy_safety: State.metrics.rates.policy_safety,
      grounding: State.metrics.rates.grounding,
      containment: State.metrics.containment,
      p95: State.metrics.p95,
      avgTokens: State.metrics.avgTokens,
    });
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

  global.Store = {
    State, subscribe, emit, simulate, applyFix, resetAgent,
    addTag, removeTag, tagCounts, suggestedTags,
    reveal, isRevealed, scoreHypothesis,
  };
})(window);
