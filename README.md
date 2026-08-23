# 🎡 Data Flywheel — Agent Performance Lab

> A self-contained, **zero-setup** visual lab for learning how the *data flywheel*
> turns raw agent telemetry into compounding quality improvements:
> **Simulate → Trace → Tag & Detect → Fix → re-simulate**, with quality climbing on every turn.

No build step. No dependencies. No API keys. Just open `index.html` in a browser.

---

## Why this exists

Everyone says "improve your agent with data," but it's rarely shown *concretely*.
This lab makes the whole loop tangible with a working customer-service agent that ships
**deliberately broken**, six defects seeded across the agent stack. You use the app to:

1. **Simulate** realistic traffic and capture rich, multi-layer traces.
2. **Read the traces like a human reviewer** — the exact context window, model params,
   memory recall, tool calls, and guardrail decisions.
3. **Form a hypothesis** about which layer is at fault and tag it.
4. **Detect hotspots automatically** — failures clustered and ranked by impact.
5. **Apply a one-click fix** at the responsible layer and watch the metrics move.

Applying all recommended fixes takes the agent from **~76 → 100** quality across eight versions.

---

## Quick start

```bash
git clone https://github.com/deepak-mukunthu/data-flywheel-agent-lab.git
cd data-flywheel-agent-lab

# Option A — just open it
open index.html            # macOS  (or double-click the file)

# Option B — serve it (recommended; avoids file:// quirks)
python3 serve.py           # no-cache dev server on http://localhost:8777
# (or: python3 -m http.server 8777)
```

`serve.py` sends no-cache headers, so a normal browser refresh always loads the latest
assets. The app auto-runs one simulation on load, so it opens with data ready to explore.

---

## The agent: "ShopBot"

A customer-service agent for a small electronics store. It handles:

- **Product info** — "Tell me about the Flux Smartwatch."
- **Availability** — "Is the Nimbus Speaker in stock?"
- **Pricing** — "How much is the Volt Power Bank?"
- **Orders** — "Can I buy the Pulse Earbuds?"
- **Refunds** — "Refund my order ORD-9004 please." (respecting a 30-day window and a $150 auto-approve cap)
- **Out-of-scope** — "What's the weather in Paris?" (should decline)

Under the hood it's a **deterministic simulator**: a given (scenario, config) pair always
produces the same trace. That's what makes before/after comparisons honest — fixing a layer
removes exactly the failures that layer caused, and the score moves for a reason you can point at.

---

## The five agent layers (and the bug seeded in each)

Every trace is decomposed into spans from five layers. Each layer has tunable config, and
each seeded defect is fixed by mutating exactly one layer:

| Layer | Responsibility | Seeded v1 defect | The fix |
|-------|---------------|------------------|---------|
| 🔵 **Model** | intent + generation | `temperature 0.9` → hallucinated prices | lower to `0.2` |
| 🟢 **Context** | assembles the prompt window | `catalogTopK=3` truncates the catalog; prompt v1 has no scope guardrail; refund policy not injected | raise topK, upgrade prompt, inject policy |
| 🟠 **Memory** | recalls customer profile | disabled → re-asks info it should know | enable recall |
| 🔴 **Harness** | orchestration & guardrails | no refund guardrail; no tool-arg validation | enable guardrail + validation |
| 🟣 **Tools** | pricing / inventory / orders / refunds | pricing reads a **stale cache** | switch to live source |

---

## The flywheel, screen by screen

| Screen | What it's for |
|--------|---------------|
| **◎ Flywheel** | The loop diagram, quality-over-iterations trend, and the improvement log. |
| **💬 Chat with Agent** | Talk to ShopBot live; the right pane shows the full trace of your last turn. |
| **🧪 Simulate** | Run the scenario bank (1× / 3× / 5× for volume) to generate a batch of traces. |
| **📊 Metrics & Evals** | Objective, ground-truth scoring + operational metrics + a blended Quality Score. |
| **🔬 Traces & Tagging** | The human-review workbench: expected-vs-actual, step-by-step execution log with raw payloads, hypothesis tagging, and reveal-root-cause. |
| **🎯 Hotspots & Fixes** | Clustered failures ranked by impact, a layer heat-map, and one-click layered fixes. |
| **🧬 Version History** | The audit trail: a metrics matrix across all versions, per-layer config diffs, and the concrete before/after scenarios each version fixed. |
| **⚙ Agent Config** | The full harness state across all five layers; values changed by fixes are flagged. |

---

## The metrics

**Quality evals** (objective, grounded in each scenario's expected outcome):

- **Intent Accuracy** — classified the request type correctly
- **Task Success** — accomplished what the customer wanted
- **Grounding** — prices/stock came from tools, not hallucinated
- **Policy Safety** — refunds respected the window and auto-approve cap
- **Scope Adherence** — stayed within store topics
- **No Redundant Asks** — didn't re-ask info memory should recall

**Operational metrics:** p50 / p95 latency, tokens per trace, tool-error rate, containment.

**Quality Score** — a blended 0–100 weighted toward correctness and safety.

---

## The human-review workbench (Traces & Tagging)

This is the heart of the "understand your agent" experience. For any trace you get:

1. **Expected vs Actual** — what the customer asked, the ground-truth expectation, and what
   the agent actually answered — so you see *that* something is wrong before *why*.
2. **Step-by-step execution log** — every span the harness ran, in order, each expandable to
   its **raw payload**: the exact context window text, model name/temperature/tokens, memory
   recall hit/miss, tool arguments & results & data source, and guardrail decisions.
   Suspicious values are flagged (⚠ high temperature, ⚠ stale cache, ⚠ memory disabled).
3. **Hypothesis tagging** — pick the layer you suspect and record your reasoning.
4. **Reveal root cause** — the detected issues stay hidden until you commit a hypothesis,
   then the app scores your guess (✓ matched / ✗ different layer) against what the automated
   detector found.

This mirrors the real workflow: manual review builds intuition, then automated detection scales it.

---

## The audit trail (Version History)

Every fix produces a new agent version, and the **🧬 Version History** page is the record of
what changed and what it bought:

1. **Metrics matrix** — every metric (quality, task success, grounding, policy safety, scope,
   no-re-ask, containment, tool errors, p95, tokens) as a row, one column per version, with
   color-coded per-step deltas.
2. **Per-layer config diffs** — for each version, exactly which knob changed at which layer
   (model / context / memory / harness / tools), shown as `from → to` in plain English with a
   one-line explanation. A single fix can touch more than one layer (e.g. the refund fix flips
   both `context.includePolicy` and `harness.refundGuardrail`).
3. **Scenarios fixed** — the concrete payoff: the actual conversations that flipped
   **fail → pass**, each with a before/after answer. Regressions (pass → fail) are flagged, and
   intermittent fixes that don't happen to flip a scenario on a single run are labeled
   *preventive hardening* rather than pretending to be no-ops.

---

## Suggested demo walkthrough

See **[docs/DEMO.md](docs/DEMO.md)** for a full guided tour. The short version:

1. Open the app → lands on **Flywheel** with a v1 run already done (~76/100).
2. **Metrics** → note low task success and grounding.
3. **Traces** → click a red-scored row, expand the context window, form a hypothesis, reveal the root cause.
4. **Hotspots** → apply the top-ranked fix; watch the toast report the quality delta.
5. **Version History** → see the config diff and the exact scenarios that fix repaired (before/after).
6. Repeat the fixes → return to **Flywheel** to see the trend line climb to 100.
7. **Simulate → Reset agent to v1** to start over.

---

## Architecture

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the full design. At a glance:

```
index.html            # entry point, loads scripts in dependency order
serve.py              # no-cache static dev server
css/styles.css        # dark, dependency-free UI
js/domain.js          # catalog, policies, customers, the tunable agent config
js/scenarios.js       # conversation bank with ground-truth expectations
js/agent.js           # the layered agent simulator (emits traces/spans)
js/evals.js           # ground-truth scoring → metrics
js/hotspots.js        # failure clustering + the fix playbook (root cause → remedy)
js/store.js           # state, simulation, tagging, per-version history + config diffs
js/charts.js          # SVG gauges, bars, sparklines, flywheel, timelines
js/views.js           # per-page render functions
js/app.js             # routing + event wiring
```

Everything is vanilla JavaScript with zero runtime dependencies. Charts are hand-rolled SVG.

---

## Extending it

- **Add a scenario:** append to `SCENARIOS` in `js/scenarios.js` with an `expect` block; evals pick it up automatically.
- **Add a product / customer / policy:** edit `js/domain.js`.
- **Add a failure mode + fix:** add an issue code in `js/agent.js` and a matching entry in the `PLAYBOOK` in `js/hotspots.js`.
- **Tune a layer:** every knob lives in `defaultConfig()` in `js/domain.js`.

---

## License

MIT — see [LICENSE](LICENSE).
