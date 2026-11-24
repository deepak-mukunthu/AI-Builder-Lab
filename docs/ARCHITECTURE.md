# 🏗️ Architecture

The lab is intentionally small and dependency-free: plain HTML, CSS, and vanilla
JavaScript loaded as ordered `<script>` tags. There's no bundler, no framework, and
no network calls. This keeps the whole system readable end-to-end and trivially runnable.

## Data flow

```
                       ┌─────────────────────────────────────────────┐
                       │                  Store                       │
                       │  config · traces · metrics · hotspots ·      │
                       │  tags · history · fixLog   (single source)   │
                       └───────────────┬─────────────────────────────┘
                                       │ subscribe / emit
   scenarios.js ──┐                    │
   domain.js ─────┤   simulate()       ▼
                  ├──▶ agent.run() ──▶ traces ──▶ evals.evaluate() ──▶ metrics
                  │                     │                                  │
                  │                     └──▶ hotspots.detect() ──▶ hotspots │
                  │                                                        │
   views.js ◀─────┴──────────── render(state) ◀───────────────────────────┘
       │
   charts.js  (SVG helpers used by views)
       │
   app.js  (routing + event wiring; re-renders on every emit)
```

Every state mutation goes through the **Store**, which notifies subscribers; `app.js`
re-renders the active view. Views are pure `state → HTML string` functions.

## Modules

| File | Responsibility |
|------|----------------|
| `js/domain.js` | The business: product catalog, refund policy, customer profiles, and `defaultConfig()`, the tunable agent config whose knobs the fixes mutate. |
| `js/scenarios.js` | The conversation bank. Each scenario declares `expect` (ground truth) so evals can score objectively. |
| `js/agent.js` | The **layered agent simulator**. `run(scenario, config)` walks the harness → memory → context → model → tools pipeline, emits ordered spans, and lets each layer's config decide whether a seeded defect fires. Returns a Trace. |
| `js/evals.js` | `gradeTrace()` scores one trace against ground truth; `evaluate()` aggregates a batch into rate metrics, latency percentiles, tokens, containment, and the blended Quality Score. |
| `js/hotspots.js` | `detectHotspots()` clusters issues across a batch and ranks by impact; the `PLAYBOOK` maps each failure code to its root-cause layer and a pure `(config) → config'` fix. |
| `js/store.js` | Central state + orchestration: `simulate()`, `applyFix()`, tagging, hypothesis scoring, reveal state, and flywheel history. |
| `js/charts.js` | Hand-rolled SVG: radial gauge, metric bars, sparklines, the flywheel ring, span timelines, and per-layer stacked bars. |
| `js/views.js` | One render function per screen, plus the rich `traceDetail()` workbench. |
| `js/app.js` | Router, sidebar, event wiring, and the live chat pane. |

## The trace model

A **Trace** is the unit of observability. Each `run()` produces:

```js
{
  traceId, scenarioId, configVersion, customer,
  userText, answer, answered, intent, facts,
  spans: [ { id, layer, name, ms, startedAt, payload } ],
  issues: [ { layer, code, detail } ],   // internal; drives evals + hotspots
  totalMs, totalTokens, createdAt
}
```

Spans carry the real artifacts a reviewer needs:

- **`context / window.assemble`**: the assembled prompt blocks (system, catalog slice,
  policy, memory, user), token count, `catalogTopK`, and system-prompt version.
- **`model / generate.intent`**: model name, temperature, prompt tokens, classified intent.
- **`tools / tool.call`**: tool name, arguments, result, and data source (live vs stale).
- **`memory / profile.recall`**: recall hit/miss and the recalled order IDs.
- **`harness / guardrail.refund`**: the window/cap decision when the guardrail is on.

## Determinism

`agent.js` uses a small seeded RNG keyed on `(scenarioId, configVersion, salt)`. The same
inputs always yield the same trace, so:

- Re-simulating after a fix isolates the effect of that fix.
- The demo's version-by-version quality numbers are reproducible.
- There are no flaky evals.

## The fix playbook (closing the loop)

Each entry in `hotspots.js`'s `PLAYBOOK` ties a failure to a layer and a remedy:

```js
price_hallucination: {
  layer: "model", severity: 5,
  title: "Model hallucinates prices",
  why:  "Sampling temperature is high enough that the model overrides tool results.",
  fix:  { label: "Lower temperature 0.9 → 0.2", apply: (c) => { c.model.temperature = 0.2; } },
}
```

`applyFix()` deep-copies the config, runs the `apply` mutation, bumps the version, and
re-simulates. Because fixes are pure config mutations and the simulator is deterministic,
the resulting quality delta is attributable to exactly that change.

## Why a simulator instead of a live LLM

A real agent would call an LLM here. This lab models the **same layered pipeline** an LLM
agent runs through, but deterministically. That trade buys three things essential to a
teaching tool: reproducibility (fair before/after comparisons), zero setup (no API keys or
cost), and pedagogical clarity (each defect maps cleanly to one layer). The concepts
(trace capture, layered attribution, eval-driven metrics, hotspot detection, layered fixes)
transfer directly to a production agent backed by a real model.
