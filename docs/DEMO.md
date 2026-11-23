# Guided demo: one turn of the improvement loop

This is a step-by-step walkthrough that takes ShopBot from a broken **v1** to a
near-perfect agent, so you can *feel* how trace data drives improvement. Budget
about 10 minutes. Nothing here is scripted magic — every number is produced by the
deterministic simulator, so you'll see the same results.

---

## 0. Open the lab

```bash
python3 serve.py                 # from the repo root (no-cache dev server)
# visit http://localhost:8777
```

`serve.py` sends no-cache headers, so a plain browser refresh always loads the
latest assets — handy while you're poking around.

You land on the **Home** page. A v1 simulation has already run, so the headline
Quality Score reads around **76 / 100**. That's our starting point.

---

## 1. See the agent misbehave (Chat)

Go to **💬 Chat with Agent** and try the suggested prompts:

- **"How much is the Volt Power Bank?"** — note the price. On v1 it may be *$79*
  (a stale cache adds $10 to the true $69) or a wilder hallucinated number.
- **"Refund my order ORD-9004 please."** — v1 happily refunds a $400 order that is
  **above the $150 auto-approve cap**. That's an unsafe refund.
- **"What's the weather in Paris?"** — v1 answers off-topic instead of declining.

The right pane shows the **full trace of each turn**: the execution log, the exact
context window, model params, and tool calls. This is the same trace you'll dissect next.

---

## 2. Generate a batch (Simulate)

Go to **🧪 Simulate** and press **▶ Run Simulation**. This runs the whole scenario
bank through the current agent and scores every trace. Bump **Repeats** to 3× or 5×
to see the metrics stabilize with more volume.

You'll see KPIs — trace count, p50/p95 latency, tokens — and a table of traces with
scores and issue counts. **Click any red-scored row** to jump into the explorer.

---

## 3. Diagnose like a human (Traces & Tagging)

This is the core "understand your agent" experience. Pick a failing trace, e.g. an
**availability** or **pricing** question that scored below 100%.

**a. Read Expected vs Actual.** The panel shows what the customer asked, the
ground-truth expectation, and what the agent actually said. The failed eval checks are
listed — but *not* the root cause.

**b. Walk the execution log.** Every step expands to its raw payload. Look for:
- **`context / window.assemble`** — the exact text sent to the model. On v1 with
  `catalogTopK=3`, most of the catalog is missing — so a valid product looks "not found."
- **`model / generate.intent`** — check the **temperature** (⚠ flagged when ≥ 0.7).
- **`tools / tool.call`** — check the **data source** (⚠ flagged when it's a stale cache).
- **`memory / profile.recall`** — ⚠ flagged when memory is disabled.
- **`harness / guardrail.refund`** — present only when the refund guardrail is enabled.

**c. Form a hypothesis.** Pick the layer you suspect (Model / Context / Memory /
Harness / Tools) and write your reasoning, then **Record hypothesis**.

**d. Reveal the root cause.** Click **🔍 Reveal detected root cause**. The app shows
the detected issues and scores your hypothesis (✓ matched / ✗ different layer).

> Try this on the **out-of-stock order** scenario: the agent both asks a redundant
> question *and* handles stock. Hypothesize **memory**, then reveal.

---

## 4. Scale detection (Hotspots & Fixes)

Go to **🎯 Hotspots & Fixes**. What you tagged by hand, the system now does across the
whole batch:

- A **layer heat-map** shows where problems concentrate.
- **Hotspots** are ranked by **impact = frequency × severity**, each attributed to a
  layer with a plain-English explanation and a concrete fix.

Click **Apply fix & re-simulate** on the top hotspot. A toast reports the new version
and the quality delta. Keep applying fixes down the list.

Here's the typical progression (yours will match — it's deterministic):

| Version | Fix applied | Layer | Quality |
|---------|-------------|-------|---------|
| v1 | — (baseline) | — | 76 |
| v2 | Raise catalogTopK to full catalog | context | 80 |
| v3 | Enable customer profile memory | memory | 82 |
| v4 | Lower temperature 0.9 → 0.2 | model | 82 |
| v5 | Switch pricing source stale → live | tools | 91 |
| v6 | Enable refund guardrail + inject policy | harness | 98 |
| v7 | Raise recall accuracy | memory | 98 |
| v8 | Upgrade system prompt to scoped v2 | context | 100 |

Notice that fixing context truncation first (v2) *reveals* pricing bugs that were
previously masked — a realistic dynamic where one fix exposes the next hotspot.

---

## 5. Read the audit trail (Version History)

Go to **🧬 Version History**. This is where each fix becomes accountable — not just
"quality went up," but *what changed* and *which conversations it repaired*.

**a. The metrics matrix.** Every metric (quality, task success, grounding, policy
safety, scope, no-re-ask, containment, tool errors, p95, tokens) is a row; each
version is a column, with color-coded per-step deltas. Scan across a row to see when a
given metric finally moved.

**b. Per-layer config diffs.** Each version card lists exactly which knob changed at
which layer, as `from → to` in plain English with a one-line reason. Watch **v6**: a
single fix flips *two* layers — `context.includePolicy` and `harness.refundGuardrail` —
because a safe refund needs both the policy in context *and* the guardrail to enforce it.

**c. Scenarios fixed.** The concrete payoff: the actual conversations that flipped
**fail → pass**, each with its before/after answer side by side. For example:

- **v2** repairs the availability/pricing questions that the truncated catalog broke.
- **v5** repairs the stale-price answers (Volt Power Bank now quotes the live $69).
- **v6** repairs the unsafe $400 refund — it's now correctly held for review.

Versions whose fix is *intermittent* (it hardens against a failure mode without
flipping a specific scenario on this deterministic run — e.g. v4's temperature drop and
v7's recall-accuracy bump) are labeled **preventive hardening** rather than pretending
to be no-ops. Any regression (pass → fail) would be flagged in red here too.

---

## 6. Watch the score climb (Home)

Return to **◎ Home**. The quality trend line now climbs 76 → 100, and the
**Improvement Log** lists every fix with its layer and quality delta. This is the
payoff: a visible, auditable record of data-driven improvement.

---

## 7. Inspect the improved agent (Agent Config)

Go to **⚙ Agent Config**. Every knob changed by a fix is flagged in green with a ✎.
These are the settings the fixes produced, the same config that now scores 100.

---

## 8. Start over

On **🧪 Simulate**, click **↺ Reset agent to v1** to restore the broken agent and run
the loop again — perhaps fixing hotspots in a different order to see how the exposure
dynamics change.

---

## What to take away

- **Traces are the raw material.** You can't improve what you can't see; rich,
  multi-layer traces make failures diagnosable.
- **Manual review builds intuition; automated detection scales it.** The tagging
  workbench and the hotspot detector are the same idea at two scales.
- **Fixes belong to layers.** Attributing a failure to the model vs context vs memory
  vs harness vs tools is what makes the fix precise — and the improvement measurable.
