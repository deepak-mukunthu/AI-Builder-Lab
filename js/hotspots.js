/* =========================================================================
 * hotspots.js — The "improve" spoke of the flywheel.
 *
 * detectHotspots(): clusters issues across a trace batch, ranks them by
 * impact (frequency × severity), and attaches the concrete FIX that resolves
 * each — pinpointing the layer (model / context / memory / harness / tools)
 * and the exact config mutation. applyFix() mutates a config copy, so the
 * user can re-simulate and watch metrics move.
 * ========================================================================= */
(function (global) {
  "use strict";

  // Catalog of known failure modes → their root-cause layer and remedy.
  // `fix` is a pure function (config)->config' bumping the responsible knob.
  const PLAYBOOK = {
    price_hallucination: {
      layer: "model", severity: 5,
      title: "Model hallucinates prices",
      why: "Sampling temperature is high enough that the model overrides tool " +
           "results with invented numbers.",
      fix: { label: "Lower temperature 0.9 → 0.2", apply: (c) => { c.model.temperature = 0.2; } },
    },
    catalog_truncated: {
      layer: "context", severity: 4,
      title: "Catalog truncated in context window",
      why: "catalogTopK cuts off most SKUs, so valid products look 'not found'.",
      fix: { label: "Raise catalogTopK 3 → full catalog (8)", apply: (c) => { c.context.catalogTopK = 8; } },
    },
    product_not_found: {
      layer: "context", severity: 4,
      title: "Answerable products reported as not found",
      why: "The needed SKU never made it into the assembled context window.",
      fix: { label: "Raise catalogTopK to cover full catalog", apply: (c) => { c.context.catalogTopK = 8; } },
    },
    scope_leak: {
      layer: "context", severity: 3,
      title: "Agent answers out-of-scope questions",
      why: "System prompt v1 has no scope guardrail.",
      fix: { label: "Upgrade system prompt v1 → v2 (scoped)", apply: (c) => { c.context.systemPromptVersion = 2; } },
    },
    unsafe_refund: {
      layer: "harness", severity: 5,
      title: "Unsafe refunds violate policy",
      why: "No harness guardrail and no policy in context, so refunds are issued " +
           "even outside the window or above the auto-approve cap.",
      fix: { label: "Enable refund guardrail + inject policy into context",
             apply: (c) => { c.harness.refundGuardrail = true; c.context.includePolicy = true; } },
    },
    redundant_question: {
      layer: "memory", severity: 3,
      title: "Agent re-asks known customer info",
      why: "Memory is disabled, so the agent can't recall the customer's orders/identity.",
      fix: { label: "Enable customer profile memory", apply: (c) => { c.memory.enabled = true; } },
    },
    recall_miss: {
      layer: "memory", severity: 2,
      title: "Profile recall misses",
      why: "Recall accuracy is below target, dropping known context.",
      fix: { label: "Raise recall accuracy to 0.99", apply: (c) => { c.memory.recallAccuracy = 0.99; } },
    },
    stale_price: {
      layer: "tools", severity: 4,
      title: "Prices served from a stale cache",
      why: "The pricing tool reads a stale cache instead of the live source.",
      fix: { label: "Switch pricing source stale → live", apply: (c) => { c.tools.pricingSource = "live"; } },
    },
    tool_error: {
      layer: "harness", severity: 3,
      title: "Tool calls error on bad arguments",
      why: "The harness dispatches tool calls without validating arguments.",
      fix: { label: "Enable tool-arg validation + retry",
             apply: (c) => { c.harness.validateToolArgs = true; c.harness.retryOnToolError = true; } },
    },
    bad_tool_args_blocked: null, // this is a *recovery*, not a defect — ignore
  };

  const LAYER_ORDER = ["model", "context", "memory", "harness", "tools"];

  function detectHotspots(traces) {
    const buckets = {}; // code -> { code, count, traceIds, examples }
    for (const tr of traces) {
      for (const iss of tr.issues) {
        if (!PLAYBOOK[iss.code]) continue;
        const b = buckets[iss.code] || (buckets[iss.code] =
          { code: iss.code, count: 0, traceIds: [], example: iss.detail });
        b.count++;
        if (b.traceIds.length < 8) b.traceIds.push(tr.traceId);
      }
    }
    const total = traces.length || 1;
    const hotspots = Object.values(buckets).map((b) => {
      const p = PLAYBOOK[b.code];
      const frequency = b.count / total;
      const impact = frequency * p.severity;
      return {
        code: b.code, layer: p.layer, severity: p.severity,
        title: p.title, why: p.why, fix: p.fix,
        count: b.count, frequency, impact,
        traceIds: b.traceIds, example: b.example,
      };
    });
    hotspots.sort((a, b) => b.impact - a.impact);
    return hotspots;
  }

  // Return a deep-ish copy of config with a fix applied and version bumped.
  function applyFix(config, hotspot) {
    const c = JSON.parse(JSON.stringify(config));
    hotspot.fix.apply(c);
    return c;
  }

  // Group hotspots by layer for the flywheel layer view.
  function byLayer(hotspots) {
    const map = {};
    for (const L of LAYER_ORDER) map[L] = [];
    for (const h of hotspots) (map[h.layer] || (map[h.layer] = [])).push(h);
    return map;
  }

  global.Hotspots = { PLAYBOOK, LAYER_ORDER, detectHotspots, applyFix, byLayer };
})(window);
