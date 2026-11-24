#!/usr/bin/env node
// Run ShopBot from the command line, without a browser.
//
//   node tools/report.js                  v1 report
//   node tools/report.js --fixes 3        apply the first 3 fixes in the book's order
//   node tools/report.js --all            apply all 7 (v8)
//   node tools/report.js --repeats 5      run each scenario 5 times
//   node tools/report.js --trace S03      print one scenario's trace
//   node tools/report.js --json           machine-readable output
//
// It loads the same js/ files as index.html into a Node vm context,
// so the numbers match the browser exactly.

const vm = require("vm"), fs = require("fs"), path = require("path");

// The fixes in the book's order, v2 to v8, by their playbook labels.
const BOOK_ORDER = [
  "Raise catalogTopK 3 → full catalog (8)",
  "Enable customer profile memory",
  "Lower temperature 0.9 → 0.2",
  "Switch pricing source stale → live",
  "Enable refund guardrail + inject policy into context",
  "Raise recall accuracy to 0.99",
  "Upgrade system prompt v1 → v2 (scoped)",
];

function parseArgs(argv) {
  const a = { fixes: 0, repeats: 1, trace: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--fixes") a.fixes = Number(argv[++i]);
    else if (k === "--all") a.fixes = BOOK_ORDER.length;
    else if (k === "--repeats") a.repeats = Number(argv[++i]);
    else if (k === "--trace") a.trace = String(argv[++i]).toUpperCase();
    else if (k === "--json") a.json = true;
    else if (k === "--help" || k === "-h") a.help = true;
    else throw new Error("unknown option " + k);
  }
  if (!(a.fixes >= 0 && a.fixes <= BOOK_ORDER.length))
    throw new Error("--fixes must be 0 to " + BOOK_ORDER.length);
  if (!(a.repeats >= 1)) throw new Error("--repeats must be 1 or more");
  return a;
}

function loadStore() {
  const root = path.join(__dirname, "..");
  const ctx = vm.createContext({ console });
  ctx.window = ctx;
  for (const f of ["domain", "scenarios", "hotspots", "agent", "evals", "store"]) {
    const file = path.join(root, "js", f + ".js");
    vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  }
  return ctx.Store;
}

// Whole numbers, rounded the way the lab's screens round them.
const pct = x => Math.round(x * 100);

function report(S, args) {
  for (const label of BOOK_ORDER.slice(0, args.fixes)) {
    const h = S.State.hotspots.find(x => x.fix && x.fix.label === label);
    if (!h) throw new Error("no hotspot offers the fix " + JSON.stringify(label));
    S.applyFix(h);
  }
  // applyFix re-simulates at 1x. Run again if more repeats were asked for.
  if (args.repeats > 1) S.simulate(args.repeats);
  const st = S.State, m = st.metrics;
  return {
    version: st.config.version,
    fixesApplied: BOOK_ORDER.slice(0, args.fixes),
    repeats: args.repeats,
    quality: pct(m.quality),
    rates: Object.fromEntries(Object.entries(m.rates).map(([k, v]) => [k, pct(v)])),
    latencyMs: { p50: m.p50, p95: m.p95 },
    avgTokens: Math.round(m.avgTokens),
    scenarios: m.graded.map(({ tr, g }) => ({
      id: tr.scenarioId,
      question: tr.userText,
      answer: tr.answer,
      score: pct(g.score),
      failed: Object.keys(g.checks).filter(k => !g.checks[k]),
    })),
    hotspots: st.hotspots.map(h => ({
      title: h.title, layer: h.layer, count: h.count, fix: h.fix && h.fix.label,
    })),
    trace: args.trace ? traceFor(st, args.trace) : undefined,
  };
}

function traceFor(st, id) {
  const tr = st.traces.find(t => t.scenarioId === id);
  if (!tr) throw new Error("no scenario " + id);
  return {
    id, question: tr.userText, answer: tr.answer, issues: tr.issues,
    spans: tr.spans.map(s => ({ layer: s.layer, name: s.name, payload: s.payload })),
  };
}

function print(r) {
  const out = [];
  out.push(`ShopBot ${r.version}, quality ${r.quality} out of 100` +
           (r.repeats > 1 ? `, ${r.repeats} repeats` : ""));
  for (const [k, v] of Object.entries(r.rates)) out.push(`  ${k.padEnd(18)} ${v}%`);
  out.push(`  latency p50/p95    ${r.latencyMs.p50} / ${r.latencyMs.p95} ms`);
  out.push(`  avg tokens         ${r.avgTokens}`);
  out.push("", "Scenarios that failed a check:");
  const failing = r.scenarios.filter(s => s.failed.length);
  if (!failing.length) out.push("  none");
  for (const s of failing) out.push(`  ${s.id}  ${s.failed.join(", ")}  "${s.question}"`);
  out.push("", "Open hotspots:");
  if (!r.hotspots.length) out.push("  none");
  for (const h of r.hotspots) out.push(`  [${h.layer}] ${h.title} (${h.count})  fix: ${h.fix}`);
  if (r.trace) {
    out.push("", `Trace ${r.trace.id}: "${r.trace.question}"`);
    for (const s of r.trace.spans)
      out.push(`  ${s.layer.padEnd(8)} ${s.name.padEnd(18)} ${JSON.stringify(s.payload)}`);
    out.push(`  answer: ${r.trace.answer}`);
  }
  console.log(out.join("\n"));
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 11)
      .map(l => l.replace(/^\/\/ ?/, "")).join("\n"));
  } else {
    const S = loadStore();
    S.simulate(1);
    const r = report(S, args);
    if (args.json) console.log(JSON.stringify(r, null, 2)); else print(r);
  }
} catch (e) {
  console.error("report.js: " + e.message);
  process.exit(1);
}
