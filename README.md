# AI Builder Lab

The companion lab for the book *Learn AI by Building*. It is one web page with two parts:

- **The ShopBot investigation.** A customer-service agent that ships with bugs planted in the parts around its model. You run it, read its traces, find what broke, and fix it one part at a time, from v1 (76/100) to v8 (100/100). Chapters 2 to 9 of the book follow this.
- **The Sandbox.** Build your own small assistant from the same five parts, using forms, and test it. It has two examples, ShopBot mini and an HR help desk, each with a working and a broken version. Start Here and the "Try it in the Sandbox" boxes in the book use this.

No install, no build step, no account and no API key. Everything runs in your browser and nothing is sent anywhere. The one exception is the Sandbox's optional [Use your own model](sandbox/README.md#use-your-own-model-advanced) mode, which sends questions to a provider you choose, only while it is switched on.

## Open it

1. Download the lab. On GitHub, click **Releases**, open **book-edition-1**, and download **Source code (zip)**. Or clone it:

   ```bash
   git clone https://github.com/deepak-mukunthu/AI-Builder-Lab.git
   ```

2. Unzip it and double-click `index.html`. It works straight from the file.

The page opens on the **Home** screen with a v1 run already done. The menu on the left has all nine screens in two groups. **Investigate ShopBot** holds the eight ShopBot screens that Chapters 2 to 9 use. **Build your own** holds the **Sandbox**, where you build and test a small assistant with forms. On the Sandbox screen, the box at the bottom of the menu shows the Sandbox's test score instead of ShopBot's.

If you prefer a local web server, run `python3 serve.py` in the folder and open http://localhost:8777. You need this only for the Sandbox's "Use your own model" mode with a local model such as Ollama, which refuses pages opened from a file.

## The agent: ShopBot

A customer-service agent for a small electronics store. It handles:

- **Product info.** "Tell me about the Flux Smartwatch."
- **Availability.** "Is the Nimbus Speaker in stock?"
- **Pricing.** "How much is the Volt Power Bank?"
- **Orders.** "Can I buy the Pulse Earbuds?"
- **Refunds.** "Refund my order ORD-9004 please." It must respect a 30-day window and a $150 auto-approve cap.
- **Out of scope.** "What's the weather in Paris?" It should decline.

Under the hood it is a **deterministic simulator**. A given scenario and config always produce the same trace. That keeps before-and-after comparisons honest: fixing a part removes exactly the failures that part caused, and the score moves for a reason you can point at.

## The five parts, and the bug planted in each

Every trace is split into spans from five layers. Each layer has its own settings, and each planted defect is fixed by changing exactly one layer:

| Layer | Responsibility | Planted v1 defect | The fix |
|-------|---------------|------------------|---------|
| 🔵 **Model** | intent + generation | `temperature 0.9` → hallucinated prices | lower to `0.2` |
| 🟢 **Context** | assembles the prompt window | `catalogTopK=3` truncates the catalog; prompt v1 has no scope guardrail; refund policy not injected | raise topK, upgrade prompt, inject policy |
| 🟠 **Memory** | recalls customer profile | disabled → re-asks info it should know | enable recall |
| 🔴 **Harness** | orchestration & guardrails | no refund guardrail; no tool-arg validation | enable guardrail + validation |
| 🟣 **Tools** | pricing / inventory / orders / refunds | pricing reads a **stale cache** | switch to live source |

## Screen by screen

| Screen | What it's for |
|--------|---------------|
| **◎ Home** | The loop diagram, the quality trend across versions, and the improvement log. |
| **💬 Chat with Agent** | Talk to ShopBot. The right pane shows the full trace of your last turn. |
| **🧪 Simulate** | Run the 15 scenarios once, 3 times or 5 times to generate a batch of traces. |
| **📊 Metrics & Evals** | Scoring against each scenario's expected outcome, operational metrics, and a blended Quality Score. |
| **🔬 Traces & Tagging** | The review bench: expected vs actual, the step-by-step execution log with raw payloads, hypothesis tagging, and reveal root cause. |
| **🎯 Hotspots & Fixes** | Failures grouped and ranked by impact, a layer heat map, and one-click fixes. |
| **🧬 Version History** | The audit trail: a metrics table across all versions, per-layer config changes, and the scenarios each version fixed. |
| **⚙ Agent Config** | All five layers' settings. Values changed by fixes are flagged. |
| **🧰 Sandbox** | Build and test your own assistant. See [sandbox/README.md](sandbox/README.md). |

## The metrics

**Quality evals**, each checked against the scenario's expected outcome:

- **Intent Accuracy.** Classified the request type correctly.
- **Task Success.** Did what the customer wanted.
- **Grounding.** Prices and stock came from tools, not made up.
- **Policy Safety.** Refunds respected the window and the auto-approve cap.
- **Scope Adherence.** Stayed within store topics.
- **No Redundant Asks.** Didn't re-ask for information memory should recall.

**Operational metrics:** p50 and p95 latency, tokens per trace, tool-error rate, containment.

**Quality Score:** a blended 0 to 100, weighted toward correctness and safety.

## Traces & Tagging

For any trace you get:

1. **Expected vs actual.** What the customer asked, the expected outcome, and what the agent answered, so you see *that* something is wrong before *why*.
2. **Step-by-step execution log.** Every span the harness ran, in order. Each one opens to its **raw payload**: the exact context window, model name and temperature, memory hit or miss, tool arguments, results and data source, and guardrail decisions. Suspicious values are flagged (⚠ high temperature, ⚠ stale cache, ⚠ memory disabled).
3. **Hypothesis tagging.** Pick the layer you suspect and write down why.
4. **Reveal root cause.** The detected issues stay hidden until you commit a guess. Then the app tells you whether your layer matches what the detector found.

Manual review builds intuition first. Automated detection then scales it.

## Version History

Every fix creates a new agent version. The **🧬 Version History** page records what changed and what it bought:

1. **Metrics table.** Every metric as a row and every version as a column, with color-coded changes.
2. **Per-layer config changes.** For each version, which setting changed at which layer, shown as `from → to` with a one-line explanation. One fix can touch more than one layer. The refund fix, for example, flips both `context.includePolicy` and `harness.refundGuardrail`.
3. **Scenarios fixed.** The conversations that flipped from fail to pass, each with a before-and-after answer. Regressions are flagged. A fix that doesn't flip a scenario on a single run is labeled *preventive hardening*.

## Suggested walkthrough

See **[docs/DEMO.md](docs/DEMO.md)** for a full guided tour. The short version:

1. Open the app. It lands on **Home** with a v1 run already done (76/100).
2. **Metrics.** Note the low task success and grounding.
3. **Traces.** Click a red-scored row, open the context window, form a hypothesis, and reveal the root cause.
4. **Hotspots.** Apply the top-ranked fix and read the quality change.
5. **Version History.** See the config change and the scenarios that fix repaired.
6. Repeat the fixes, then return to **Home** to see the trend line climb to 100.
7. **Simulate → Reset agent to v1** to start over.

## Files

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the design of the ShopBot investigation.

```
index.html            entry point, loads scripts in dependency order
serve.py              optional no-cache local server
css/styles.css        dark, dependency-free UI
js/domain.js          catalog, policies, customers, the tunable agent config
js/scenarios.js       the 15 scenarios with expected outcomes
js/agent.js           the layered agent simulator (emits traces and spans)
js/evals.js           scoring against expected outcomes → metrics
js/hotspots.js        failure grouping + the fix playbook (root cause → remedy)
js/store.js           state, simulation, tagging, version history and config changes
js/charts.js          SVG gauges, bars, sparklines, the loop ring, timelines
js/views.js           per-page render functions
js/app.js             routing and event wiring
sandbox/              the Sandbox, a separate page shown in the Sandbox screen
sandbox/tests/run.js  Node checks for the Sandbox: node sandbox/tests/run.js
```

Everything is plain JavaScript with no runtime dependencies. Charts are hand-drawn SVG.

## Extending it

- **Add a scenario:** append to `SCENARIOS` in `js/scenarios.js` with an `expect` block. The evals pick it up.
- **Add a product, customer or policy:** edit `js/domain.js`.
- **Add a failure mode and its fix:** add an issue code in `js/agent.js` and a matching entry in the `PLAYBOOK` in `js/hotspots.js`.
- **Tune a layer:** every setting lives in `defaultConfig()` in `js/domain.js`.

## License

MIT. See [LICENSE](LICENSE).
