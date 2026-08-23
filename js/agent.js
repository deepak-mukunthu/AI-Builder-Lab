/* =========================================================================
 * agent.js — The service agent, implemented as a deterministic simulator.
 *
 * A real agent would call an LLM; here we model the SAME layered pipeline an
 * LLM agent runs through — Model, Context, Memory, Harness, Tools — and let
 * each layer's CONFIG decide whether a seeded defect fires. This makes the
 * flywheel reproducible: fix a layer's config and the corresponding failures
 * disappear on re-run, so metrics move for a reason you can point at.
 *
 * Output: a Trace with ordered spans (each layer contributes spans carrying
 * tokens, latency, and payloads) plus the final answer and internal facts
 * the evals grade against.
 * ========================================================================= */
(function (global) {
  "use strict";
  const D = global.Domain;
  const { CATALOG, SKU_INDEX, POLICY, CUSTOMERS, SYSTEM_PROMPTS, fmt$ } = D;

  // Tiny seeded RNG so a given (scenario, config) pair is reproducible.
  function rng(seedStr) {
    let h = 2166136261;
    for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
    return () => { h += 0x6D2B79F5; let t = Math.imul(h ^ (h >>> 15), 1 | h);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const approx = (n) => Math.round(n / 4); // ~chars→tokens

  // Match a product mentioned in the user text (naive, like a retriever).
  function findProduct(text) {
    const t = text.toLowerCase();
    let best = null, bestLen = 0;
    for (const p of CATALOG) {
      const words = p.name.toLowerCase().split(/\s+/);
      const hits = words.filter((w) => w.length > 3 && t.includes(w)).length;
      if (hits > bestLen) { bestLen = hits; best = p; }
    }
    return bestLen >= 1 ? best : null;
  }

  function classifyIntent(text) {
    const t = text.toLowerCase();
    if (/(refund|money back|return my)/.test(t)) return "refund";
    if (/(buy|order|purchase|checkout)/.test(t)) return "place_order";
    if (/(in stock|available|how many|left|stock)/.test(t)) return "availability";
    if (/(price|cost|how much|\$)/.test(t)) return "pricing";
    if (/(weather|news|joke|stock market|movie)/.test(t)) return "out_of_scope";
    return "product_info";
  }

  /**
   * Run one scenario through the pipeline.
   * @returns {Trace}
   */
  function run(scenario, config, opts) {
    opts = opts || {};
    const rand = rng(scenario.id + "|" + config.version + "|" + (opts.salt || ""));
    const spans = [];
    let clock = 0;
    const t0 = 1_700_000_000_000; // fixed base so timestamps are stable
    function span(layer, name, payload, ms) {
      const dur = ms != null ? ms : 20 + Math.floor(rand() * 60);
      const s = { id: "sp-" + spans.length, layer, name, ms: dur,
        startedAt: t0 + clock, payload: payload || {} };
      clock += dur;
      spans.push(s);
      return s;
    }

    const cust = CUSTOMERS[scenario.customer];
    const issues = [];        // machine-detected problems (drive hotspots)
    const facts = {};         // ground-able facts for evals

    // ---------------- HARNESS: orchestration begins -------------------
    span("harness", "session.start",
      { customer: cust.id, tier: cust.tier, maxToolCalls: config.harness.maxToolCalls });

    // ---------------- MEMORY: recall customer profile ----------------
    let recalledOrders = [];
    if (config.memory.enabled) {
      const ok = rand() < config.memory.recallAccuracy;
      recalledOrders = ok ? cust.orders : [];
      span("memory", "profile.recall",
        { customer: cust.id, hit: ok, orders: recalledOrders.map((o) => o.id) });
      if (!ok) issues.push({ layer: "memory", code: "recall_miss",
        detail: "Profile recall missed; agent will ask for info it should know." });
    } else {
      span("memory", "profile.recall", { enabled: false, note: "memory disabled — no recall" });
    }

    // ---------------- CONTEXT: assemble the window -------------------
    const sysPrompt = SYSTEM_PROMPTS[config.context.systemPromptVersion];
    const catalogSlice = CATALOG.slice(0, config.context.catalogTopK);
    const contextBlocks = [
      { role: "system", text: sysPrompt },
      { role: "catalog", text: catalogSlice.map((p) =>
          `${p.sku} | ${p.name} | ${fmt$(p.price)} | stock:${p.stock} | ${p.blurb}`).join("\n") },
    ];
    if (config.context.includePolicy) {
      contextBlocks.push({ role: "policy",
        text: `Refund window ${POLICY.refundWindowDays} days. Auto-refund cap ${fmt$(POLICY.maxAutoRefund)}.` });
    }
    if (config.memory.enabled && recalledOrders.length) {
      contextBlocks.push({ role: "memory",
        text: "Known orders: " + recalledOrders.map((o) => `${o.id}(${o.sku})`).join(", ") });
    }
    contextBlocks.push({ role: "user", text: scenario.user });
    const ctxTokens = contextBlocks.reduce((a, b) => a + approx(b.text), 0);
    span("context", "window.assemble",
      { blocks: contextBlocks, tokens: ctxTokens, catalogTopK: config.context.catalogTopK,
        promptVersion: config.context.systemPromptVersion });

    const product = findProduct(scenario.user);
    const inSlice = product ? catalogSlice.some((p) => p.sku === product.sku) : false;
    if (product && !inSlice) {
      issues.push({ layer: "context", code: "catalog_truncated",
        detail: `Product ${product.sku} exists but was cut by catalogTopK=${config.context.catalogTopK}.` });
    }
    // The model can only ground answers on products actually present in the
    // assembled window. A truncated catalog makes real products "invisible".
    const visibleProduct = inSlice ? product : null;

    // ---------------- MODEL: intent + draft reasoning ----------------
    const intent = classifyIntent(scenario.user);
    facts.intent = intent;
    const promptTokens = ctxTokens;
    span("model", "generate.intent",
      { promptTokens, intent, temperature: config.model.temperature,
        model: config.model.name });

    // High temperature introduces numeric hallucination on pricing.
    const hallucinate = config.model.temperature >= 0.7 && rand() < 0.55;

    // ---------------- TOOLS + HARNESS: act on the intent -------------
    let answer = "";
    let answered = true;

    function toolCall(name, args, resultFactory) {
      // Harness optionally validates args before dispatch.
      if (config.harness.validateToolArgs && args && args.__bad) {
        span("harness", "tool.validate", { tool: name, ok: false, args });
        issues.push({ layer: "harness", code: "bad_tool_args_blocked",
          detail: `Harness blocked malformed args to ${name} and recovered.` });
        return resultFactory(true); // recovered path
      }
      const res = resultFactory(false);
      span("tools", "tool.call", { tool: name, args, result: res.summary, source: res.source });
      if (res.error) issues.push({ layer: "harness", code: "tool_error",
        detail: `Tool ${name} errored on unvalidated args.` });
      return res;
    }

    if (intent === "out_of_scope") {
      if (config.context.systemPromptVersion >= 2) {
        answer = "I'm sorry, I can't help with that — I can only assist with our store's " +
          "products, availability, pricing, orders, and refunds.";
      } else {
        // v1 prompt has no guardrail → the model wanders off-scope.
        answer = "Sure! It looks pleasant and mild today. Anyway, back to shopping?";
        issues.push({ layer: "context", code: "scope_leak",
          detail: "No scope guardrail in system prompt v1 — agent answered off-topic." });
      }
    } else if (intent !== "refund" && !visibleProduct) {
      // Either no product matched at all, or it was truncated out of context.
      answer = "I couldn't find that product in our catalog.";
      answered = false;
      if (scenario.expect && scenario.expect.sku)
        issues.push({ layer: "context", code: "product_not_found",
          detail: "Product should be answerable but wasn't surfaced to the model." });
    } else if (intent === "pricing") {
      const t = toolCall("get_price", { sku: product.sku }, () => {
        const stale = config.tools.pricingSource === "stale";
        const shown = stale ? product.price + 10 : product.price; // stale cache is $10 high
        return { summary: fmt$(shown), source: config.tools.pricingSource, price: shown,
          error: false };
      });
      let price = t.price;
      if (hallucinate) { price = product.price + 20 + Math.floor(rand() * 30);
        issues.push({ layer: "model", code: "price_hallucination",
          detail: `Model overrode tool price with an invented figure (${fmt$(price)}).` }); }
      else if (config.tools.pricingSource === "stale") {
        issues.push({ layer: "tools", code: "stale_price",
          detail: `Priced from stale cache (${fmt$(price)} vs true ${fmt$(product.price)}).` });
      }
      facts.priceQuoted = price;
      answer = `The ${product.name} is ${fmt$(price)}.`;
      if (inSlice && product.price >= POLICY.freeShipThreshold)
        answer += " Ships free.";
    } else if (intent === "availability") {
      const t = toolCall("check_inventory", { sku: product.sku }, () => ({
        summary: product.stock > 0 ? `${product.stock} in stock` : "out of stock",
        source: config.tools.inventorySource, stock: product.stock, error: false }));
      facts.stock = t.result;
      if (product.stock === 0) answer = `The ${product.name} is currently out of stock.`;
      else if (product.stock <= 5) answer = `Yes — only ${product.stock} of the ${product.name} left, order soon!`;
      else answer = `Yes, the ${product.name} is in stock (${product.stock} available).`;
    } else if (intent === "product_info") {
      facts.described = product.sku;
      answer = `${product.name}: ${product.blurb} (${fmt$(product.price)})`;
    } else if (intent === "place_order") {
      const inv = toolCall("check_inventory", { sku: product.sku }, () => ({
        summary: product.stock > 0 ? "available" : "out of stock",
        source: "live", stock: product.stock, error: false }));
      if (product.stock <= 0) {
        answer = `Sorry, the ${product.name} is out of stock, so I can't place that order.`;
        facts.ordered = false;
      } else {
        toolCall("create_order", { sku: product.sku, customer: cust.id }, () => ({
          summary: "ORD-NEW", source: "live", error: false }));
        answer = `Done! I've placed your order for the ${product.name} (${fmt$(product.price)}).`;
        facts.ordered = true;
      }
    } else if (intent === "refund") {
      const order = (config.memory.enabled ? recalledOrders : cust.orders)
        .find((o) => scenario.user.toUpperCase().includes(o.id)) || cust.orders[0];
      facts.refundOrder = order.id;
      const withinWindow = order.daysAgo <= POLICY.refundWindowDays;
      const underCap = order.price <= POLICY.maxAutoRefund;

      if (config.harness.refundGuardrail && config.context.includePolicy) {
        // Correct, policy-aware path.
        span("harness", "guardrail.refund",
          { order: order.id, withinWindow, underCap });
        if (!withinWindow) {
          answer = `Order ${order.id} is outside our ${POLICY.refundWindowDays}-day refund window, so I can't refund it automatically.`;
          facts.refundGranted = false;
        } else if (!underCap) {
          answer = `Order ${order.id} is ${fmt$(order.price)}, above the auto-refund cap — I've routed it for human approval.`;
          facts.refundGranted = false;
        } else {
          toolCall("issue_refund", { order: order.id, amount: order.price }, () => ({
            summary: fmt$(order.price), source: "live", error: false }));
          answer = `Refund of ${fmt$(order.price)} for ${order.id} is on its way.`;
          facts.refundGranted = true;
        }
      } else {
        // Unsafe path: no guardrail → refunds everything on request.
        toolCall("issue_refund", { order: order.id, amount: order.price }, () => ({
          summary: fmt$(order.price), source: "live", error: false }));
        answer = `Refund of ${fmt$(order.price)} for ${order.id} is on its way.`;
        facts.refundGranted = true;
        if (!withinWindow || !underCap) issues.push({ layer: "harness", code: "unsafe_refund",
          detail: `Granted a refund that violates policy (order ${order.id}).` });
      }
    }

    // Memory-off tax: agent re-asks for identity it should recall.
    if (!config.memory.enabled && (intent === "refund" || intent === "place_order")) {
      answer = "Can you remind me which order/account this is for? " + answer;
      issues.push({ layer: "memory", code: "redundant_question",
        detail: "Asked for info a recalled profile would have provided." });
    }

    span("model", "generate.final",
      { completionTokens: approx(answer), text: answer });

    // Latency inflations from defects (so p95 responds to fixes).
    if (config.model.temperature >= 0.7) span("model", "resample", { reason: "low-confidence high-temp draft" }, 140);
    if (!config.harness.validateToolArgs && intent === "place_order")
      span("harness", "tool.retry", { reason: "unvalidated args round-trip" }, 90);

    span("harness", "session.end", { spans: spans.length });

    const totalMs = spans.reduce((a, s) => a + s.ms, 0);
    const totalTokens = spans.reduce((a, s) =>
      a + (s.payload.tokens || s.payload.promptTokens || s.payload.completionTokens || 0), 0);

    return {
      traceId: scenario.id + "-" + config.version + (opts.salt ? "-" + opts.salt : ""),
      scenarioId: scenario.id,
      configVersion: config.version,
      customer: cust.id,
      userText: scenario.user,
      answer, answered,
      intent, facts,
      spans,
      issues,               // internal — evals + hotspots derive from these
      totalMs, totalTokens,
      createdAt: t0 + clock,
    };
  }

  global.Agent = { run, classifyIntent, findProduct };
})(window);
