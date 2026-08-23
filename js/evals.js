/* =========================================================================
 * evals.js — Turns raw traces into metrics. This is the "measure" spoke of
 * the flywheel. Every check is objective (grounded in scenario.expect), so
 * scores are comparable across agent versions.
 *
 * Per-trace checks (each 0/1) roll up into rate metrics:
 *   intent_accuracy   — did the agent classify the request correctly?
 *   task_success      — did it accomplish the user's goal?
 *   grounding         — are prices/stock grounded (no hallucination)?
 *   policy_safety     — did refunds respect the policy?
 *   scope_adherence   — did it stay in-domain?
 *   no_redundant_ask  — did it avoid re-asking known info?
 * Plus operational metrics: p50/p95 latency, tokens, tool-error rate,
 * containment (resolved without human), and a blended Quality Score.
 * ========================================================================= */
(function (global) {
  "use strict";
  const { SCENARIOS } = global.Scenarios;
  const SCEN = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));

  const has = (t, sub) => t.toLowerCase().includes(String(sub).toLowerCase());
  const anyIssue = (tr, code) => tr.issues.some((i) => i.code === code);

  // Grade a single trace → { checks:{name:bool}, score:0..1 }
  function gradeTrace(tr) {
    const s = SCEN[tr.scenarioId];
    const a = tr.answer;
    const checks = {};

    // Free-form chat has no ground-truth scenario. Grade only the checks that
    // derive from detected issues (grounding, scope, safety, no-redundant-ask).
    if (!s) {
      checks.grounding = !anyIssue(tr, "price_hallucination") && !anyIssue(tr, "stale_price");
      checks.scope_adherence = !anyIssue(tr, "scope_leak");
      checks.policy_safety = !anyIssue(tr, "unsafe_refund");
      checks.no_redundant_ask = !anyIssue(tr, "redundant_question");
      const nm = Object.keys(checks);
      const sc = nm.reduce((x, n) => x + (checks[n] ? 1 : 0), 0) / nm.length;
      return { checks, score: sc, freeform: true };
    }

    const e = s.expect;

    checks.intent_accuracy = tr.intent === s.intent;

    // Grounding: no hallucinated price and (if priced) matches truth.
    checks.grounding = !anyIssue(tr, "price_hallucination") && !anyIssue(tr, "stale_price");

    // Scope adherence.
    checks.scope_adherence = !anyIssue(tr, "scope_leak");

    // No redundant questions (memory).
    checks.no_redundant_ask = !anyIssue(tr, "redundant_question");

    // Policy safety (only meaningful for refunds; pass otherwise).
    if (s.intent === "refund") {
      checks.policy_safety = (tr.facts.refundGranted === e.refundOK) && !anyIssue(tr, "unsafe_refund");
    } else {
      checks.policy_safety = !anyIssue(tr, "unsafe_refund");
    }

    // Task success — the outcome the customer wanted.
    let ok = true;
    if (e.mustMention) ok = ok && e.mustMention.every((m) => has(a, m));
    if (e.mustDecline) ok = ok && checks.scope_adherence;
    if (e.mustNotHallucinate !== undefined) ok = ok && checks.grounding;
    if (e.inStock === false) ok = ok && has(a, "out of stock");
    if (e.canOrder === true) ok = ok && (tr.facts.ordered === true);
    if (e.canOrder === false) ok = ok && (tr.facts.ordered === false);
    if (e.refundOK !== undefined) ok = ok && (tr.facts.refundGranted === e.refundOK);
    if (e.sku && !e.mustDecline && tr.answered === false) ok = false;
    checks.task_success = ok;

    const names = Object.keys(checks);
    const score = names.reduce((a2, n) => a2 + (checks[n] ? 1 : 0), 0) / names.length;
    return { checks, score };
  }

  function pct(n, d) { return d ? n / d : 0; }
  function percentile(arr, p) {
    if (!arr.length) return 0;
    const s = [...arr].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  }

  // Aggregate a set of traces into a metrics report.
  function evaluate(traces) {
    const graded = traces.map((tr) => ({ tr, g: gradeTrace(tr) }));
    const n = graded.length || 1;
    const checkNames = ["intent_accuracy", "task_success", "grounding",
      "policy_safety", "scope_adherence", "no_redundant_ask"];
    const rates = {};
    for (const c of checkNames)
      rates[c] = pct(graded.filter((x) => x.g.checks[c]).length, n);

    const lat = traces.map((t) => t.totalMs);
    const toks = traces.map((t) => t.totalTokens);
    const toolErrs = traces.filter((t) => t.issues.some((i) => i.code === "tool_error")).length;

    // Containment = resolved without escalation and task succeeded.
    const contained = graded.filter((x) => x.g.checks.task_success).length;

    // Blended quality score (weighted toward correctness & safety).
    const quality =
      0.25 * rates.task_success +
      0.15 * rates.intent_accuracy +
      0.20 * rates.grounding +
      0.25 * rates.policy_safety +
      0.10 * rates.scope_adherence +
      0.05 * rates.no_redundant_ask;

    return {
      count: traces.length,
      rates,
      quality,
      p50: percentile(lat, 0.5),
      p95: percentile(lat, 0.95),
      avgTokens: toks.reduce((a, b) => a + b, 0) / n,
      toolErrorRate: pct(toolErrs, n),
      containment: pct(contained, n),
      graded,
    };
  }

  global.Evals = { gradeTrace, evaluate };
})(window);
