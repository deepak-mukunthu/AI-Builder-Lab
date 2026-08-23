/* =========================================================================
 * scenarios.js — The conversation bank the simulator draws from.
 * Each scenario declares the ground truth so evals can score objectively.
 * ========================================================================= */
(function (global) {
  "use strict";

  // expect: the correct behavior. Used by evals as ground truth.
  //   intent        — what the agent should classify
  //   mustMention    — substrings that must appear in a correct answer
  //   mustNotHallucinate — the answer must not invent a price/stock
  //   refundOK       — for refund intents, whether it should be granted
  const SCENARIOS = [
    { id: "S01", customer: "cust-alex", intent: "product_info",
      user: "Tell me about the Flux Smartwatch.",
      expect: { sku: "FLX-300", mustMention: ["AMOLED", "GPS"] } },

    { id: "S02", customer: "cust-mai", intent: "availability",
      user: "Is the Nimbus Bluetooth Speaker in stock?",
      expect: { sku: "NMB-200", inStock: false, mustMention: ["out of stock"] } },

    { id: "S03", customer: "cust-sam", intent: "availability",
      user: "Do you have the Echo Studio Mic available?",
      expect: { sku: "ECH-800", inStock: false, mustMention: ["out of stock"] } },

    { id: "S04", customer: "cust-lee", intent: "pricing",
      user: "How much is the Volt Power Bank 20k?",
      expect: { sku: "VLT-700", price: 69, mustMention: ["$69"] } },

    { id: "S05", customer: "cust-alex", intent: "pricing",
      user: "What's the price of the Orbit Wireless Charger?",
      expect: { sku: "ORB-600", price: 39, mustMention: ["$39"] } },

    { id: "S06", customer: "cust-mai", intent: "product_info",
      user: "What can you tell me about the Volt Power Bank?",
      expect: { sku: "VLT-700", mustMention: ["20,000mAh"] } },

    { id: "S07", customer: "cust-alex", intent: "place_order",
      user: "I'd like to order the Pulse Earbuds.",
      expect: { sku: "PLS-400", canOrder: true, mustMention: ["order"] } },

    { id: "S08", customer: "cust-sam", intent: "place_order",
      user: "Can I buy the Nimbus Bluetooth Speaker?",
      expect: { sku: "NMB-200", canOrder: false, mustMention: ["out of stock"] } },

    { id: "S09", customer: "cust-alex", intent: "refund",
      user: "I want a refund for my Pulse Earbuds order ORD-9001.",
      expect: { order: "ORD-9001", refundOK: true, amount: 79, mustMention: ["refund"] } },

    { id: "S10", customer: "cust-sam", intent: "refund",
      user: "Please refund order ORD-9003, the Echo Studio Mic.",
      expect: { order: "ORD-9003", refundOK: false, reason: "outside 30-day window",
                mustMention: ["window"] } },

    { id: "S11", customer: "cust-lee", intent: "refund",
      user: "Refund my order ORD-9004 please.",
      expect: { order: "ORD-9004", refundOK: false, reason: "exceeds auto-refund cap; needs human approval",
                mustMention: ["approval"] } },

    { id: "S12", customer: "cust-mai", intent: "out_of_scope",
      user: "What's the weather in Paris today?",
      expect: { mustDecline: true, mustMention: ["can't", "store"] } },

    { id: "S13", customer: "cust-alex", intent: "product_info",
      user: "Details on the Zenith Laptop Stand?",
      expect: { sku: "ZEN-500", mustMention: ["aluminum"] } },

    { id: "S14", customer: "cust-lee", intent: "pricing",
      user: "Price on the Echo Studio Mic?",
      expect: { sku: "ECH-800", price: 129, mustMention: ["$129"] } },

    { id: "S15", customer: "cust-mai", intent: "availability",
      user: "How many Orbit Wireless Chargers are left?",
      expect: { sku: "ORB-600", inStock: true, low: true, mustMention: ["3"] } },
  ];

  global.Scenarios = { SCENARIOS };
})(window);
