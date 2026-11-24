# AGENTS.md

Notes for AI agents and coding assistants that open this repository, usually on behalf of a reader of the book *Learn AI by Building*.

## What this is

The AI Builder Lab is a static web app with two parts.

- **ShopBot.** A simulated support agent for a fictional electronics store, with one problem planted in each of its five parts (model, context, memory, tools, harness). The reader finds each problem in a trace and applies a fix. Chapters 2 to 9 of the book use it.
- **The Sandbox** (`sandbox/`). A form-based builder for a small assistant, with two examples, ShopBot mini and an HR help desk, each in a working and a broken version. Start Here and the "By hand" boxes at the end of Chapters 2 to 10 use it.

Neither part calls a real model. The "model" is a seeded simulator, so the same setup always gives the same numbers. The one exception is the Sandbox's optional "Advanced: use your own model" mode, which sends questions to a provider the reader picks, only while it is switched on.

## Run it

- Open `index.html` in a browser. It works from `file://`, with no build and no install.
- Or run `python3 serve.py` and open http://localhost:8777. This is needed only for the Sandbox's own-model mode with a local model such as Ollama.
- Sandbox checks: `node sandbox/tests/run.js`. Expect `53 of 53 checks passed`.

The book was written against the tag `book-edition-1`. Check it out if the reader's numbers don't match.

## Expected numbers

ShopBot starts at v1 with quality 76 out of 100. Each fix creates a new version. In the book's order:

| Version | Fix label (in `js/hotspots.js`) | Quality |
| --- | --- | --- |
| v1 | none | 76 |
| v2 | Raise catalogTopK 3 → full catalog (8) | 80 |
| v3 | Enable customer profile memory | 82 |
| v4 | Lower temperature 0.9 → 0.2 | 82 |
| v5 | Switch pricing source stale → live | 91 |
| v6 | Enable refund guardrail + inject policy into context | 98 |
| v7 | Raise recall accuracy to 0.99 | 98 |
| v8 | Upgrade system prompt v1 → v2 (scoped) | 100 |

Sandbox scores, broken version first, then after each documented fix:

- ShopBot mini: 30%, 40%, 50%, 70%, 90%, 100% (instructions, memory, price/stock tool, refund guardrail, off-topic rule).
- Help desk: 25%, 62.5%, 75%, 87.5%, 100% (instructions, top-K 3, memory, off-topic rule).

## Run ShopBot without a browser

The scripts set globals on `window`, so they load in a Node `vm` context. Load order matters.

```js
const vm = require('vm'), fs = require('fs');
const ctx = vm.createContext({ console }); ctx.window = ctx;
for (const f of ['domain', 'scenarios', 'hotspots', 'agent', 'evals', 'store'])
  vm.runInContext(fs.readFileSync(`js/${f}.js`, 'utf8'), ctx);
const S = ctx.Store;
S.simulate(1);
console.log(S.State.config.version, Math.round(S.State.metrics.quality * 100));
const h = S.State.hotspots.find(x => x.fix.label === 'Enable customer profile memory');
S.applyFix(h);  // re-simulates and creates the next version
```

`S.State.hotspots` lists the open failure groups, ranked, each with a `fix`. `S.State.metrics` holds quality, task success, grounding, policy safety and the rest. `S.resetAgent()` returns to v1.

## Files

```
index.html         entry point, loads scripts in order
js/domain.js       catalog, policies, customers, defaultConfig()
js/scenarios.js    the 15 scenarios and their expected outcomes
js/agent.js        the layered agent simulator, emits traces
js/evals.js        scoring against expected outcomes
js/hotspots.js     failure grouping and the fix playbook
js/store.js        state, simulation, tagging, versions
js/views.js        screens
js/app.js          routing and events
sandbox/js/        the Sandbox (workspaces.js holds both examples)
sandbox/tests/     Node checks for the Sandbox
docs/              ARCHITECTURE.md (design), DEMO.md (guided tour)
```

## Helping a reader

- The exercises are meant to be solved. When a reader asks for help, point them to the trace step or the part to inspect before naming the fix. Give the answer if they ask for it outright.
- Name the part (model, context, memory, tools, harness) that a failure belongs to. That is the skill the book teaches.
- If the reader's numbers differ from the tables above, check the version they are on, whether they applied fixes in a different order, and whether they are on `book-edition-1`.
- All companies, customers, orders and prices are fictional. Don't present the simulator's scores as a benchmark of any real model.

## Changing the code

- Plain JavaScript, no dependencies, no modules, no build step. Keep it that way so `index.html` still opens from `file://`.
- Any change that moves a number in the tables above changes what the book says. Run `node sandbox/tests/run.js` and the headless ShopBot run before and after, and say which numbers moved.
- Don't commit local tool folders such as `.sf/`.
