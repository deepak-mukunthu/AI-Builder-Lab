/* =========================================================================
 * domain.js — The business: product catalog, policies, customers, scenarios,
 * and the tunable agent configuration whose defects the flywheel will fix.
 * Everything here is deterministic so before/after comparisons are fair.
 * ========================================================================= */
(function (global) {
  "use strict";

  // ---- Product catalog -------------------------------------------------
  // Note the deliberate ordering: the context layer's default topK=3 will
  // truncate everything after index 2, hiding most of the catalog. That is
  // one of the seeded "context layer" bugs the flywheel discovers.
  const CATALOG = [
    { sku: "AUR-100", name: "Aurora Wireless Headphones", price: 199, stock: 42, category: "audio",
      blurb: "Over-ear ANC headphones, 30h battery." },
    { sku: "NMB-200", name: "Nimbus Bluetooth Speaker", price: 89, stock: 0, category: "audio",
      blurb: "Portable 360° speaker, IPX7 waterproof." },
    { sku: "FLX-300", name: "Flux Smartwatch", price: 149, stock: 8, category: "wearables",
      blurb: "AMOLED fitness watch, GPS, 7-day battery." },
    { sku: "PLS-400", name: "Pulse Earbuds", price: 79, stock: 120, category: "audio",
      blurb: "True-wireless earbuds, adaptive EQ." },
    { sku: "ZEN-500", name: "Zenith Laptop Stand", price: 59, stock: 25, category: "accessories",
      blurb: "Aluminum adjustable stand." },
    { sku: "ORB-600", name: "Orbit Wireless Charger", price: 39, stock: 3, category: "accessories",
      blurb: "15W Qi fast charger." },
    { sku: "VLT-700", name: "Volt Power Bank 20k", price: 69, stock: 60, category: "accessories",
      blurb: "20,000mAh USB-C PD power bank." },
    { sku: "ECH-800", name: "Echo Studio Mic", price: 129, stock: 0, category: "audio",
      blurb: "USB condenser mic for streaming." },
  ];
  const SKU_INDEX = Object.fromEntries(CATALOG.map((p) => [p.sku, p]));

  // ---- Policies --------------------------------------------------------
  const POLICY = {
    refundWindowDays: 30,
    maxAutoRefund: 150,          // above this a human must approve
    restockingCategories: [],    // none
    freeShipThreshold: 75,
  };

  // ---- Known customers (memory layer reads these profiles) -------------
  const CUSTOMERS = {
    "cust-alex": { id: "cust-alex", name: "Alex", tier: "gold",
      orders: [{ id: "ORD-9001", sku: "PLS-400", price: 79, daysAgo: 5 }] },
    "cust-mai":  { id: "cust-mai",  name: "Mai",  tier: "silver",
      orders: [{ id: "ORD-9002", sku: "FLX-300", price: 149, daysAgo: 12 }] },
    "cust-sam":  { id: "cust-sam",  name: "Sam",  tier: "bronze",
      orders: [{ id: "ORD-9003", sku: "ECH-800", price: 129, daysAgo: 45 }] }, // outside window
    "cust-lee":  { id: "cust-lee",  name: "Lee",  tier: "gold",
      orders: [{ id: "ORD-9004", sku: "VLT-700", price: 400, daysAgo: 3 }] },  // above auto-refund cap
  };

  // ---- Intents the agent must serve -----------------------------------
  const INTENTS = ["product_info", "availability", "pricing", "place_order", "refund", "out_of_scope"];

  // ---- The v1 (defective) agent configuration --------------------------
  // Each field maps to a layer; the flywheel's fixes mutate exactly these.
  function defaultConfig() {
    return {
      version: "v1",
      model: {
        name: "svc-agent-mini",
        temperature: 0.9,        // BUG(model): high temp → pricing/number hallucination
        maxOutputTokens: 512,
      },
      context: {
        systemPromptVersion: 1,  // BUG(context): v1 prompt has no scope guardrail
        catalogTopK: 3,          // BUG(context): truncates catalog → "unknown product"
        includePolicy: false,    // BUG(context): refund policy not in window → unsafe refunds
        historyTurns: 6,
      },
      memory: {
        enabled: false,          // BUG(memory): no profile recall → repeats questions
        recallAccuracy: 0.9,
      },
      harness: {
        maxToolCalls: 4,
        validateToolArgs: false, // BUG(harness): bad tool args slip through → tool errors
        refundGuardrail: false,  // BUG(harness): no confirm/policy gate on refunds
        retryOnToolError: false,
      },
      tools: {
        pricingSource: "stale",  // BUG(tools): stale price cache → wrong prices
        inventorySource: "live",
      },
    };
  }

  // System prompt versions (context layer artifact shown in traces).
  const SYSTEM_PROMPTS = {
    1: "You are ShopBot, a helpful store assistant. Answer customer questions.",
    2: "You are ShopBot, a service agent for an electronics store. You may ONLY " +
       "discuss our product catalog, availability, pricing, orders, and refunds. " +
       "If asked anything outside this scope, politely decline and redirect. " +
       "Always ground prices and stock in the provided catalog and never guess. " +
       "For refunds, verify the order and the refund policy before acting.",
  };

  global.Domain = {
    CATALOG, SKU_INDEX, POLICY, CUSTOMERS, INTENTS, SYSTEM_PROMPTS,
    defaultConfig,
    fmt$: (n) => "$" + Number(n).toFixed(0),
  };
})(window);
