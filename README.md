# @taifoon/term

The step renderer behind `taifoon up`, `jev run` and the STUDIO terminal on taifoon.io. One file, no dependencies, and
nothing happens at import. It is safe to copy byte for byte into a package that must stay dependency-free.

```
→ [1/5] readiness
● GET coord.taifoon.dev/v1/agents/8453/95902/readiness
  ⎿ 200 · 612 ms
✓ hireable · 8 ok · 2 missing · 640 ms
```

```js
import { createTerm } from '@taifoon/term';

const t = createTerm();                 // stdout; colour only on a TTY, and never with NO_COLOR
t.step(1, 5, 'readiness');
t.call('GET', 'coord.taifoon.dev/v1/agents/8453/95902/readiness');
t.called(200, 612);
t.ok('hireable · 8 ok · 2 missing', { ms: 640 });
```

Lines: `step`, `call`, `called`, `ok`, `warn`, `fail`, `skip`, `note`, `say`, `next`, `cmd`, `info`, `json` and a
`spinner`. Each has a pure string twin (`stepLine`, `markLine`, `callLine`, …) for tests. `createTerm({ quiet: true })`
writes nothing, for `--json` runs.

MIT.

## The live stream view (`@taifoon/term/stream`, 0.3.0) and its measures (`@taifoon/term/measures`)

The view `taifoon stream` and `taifoon-sdk coord stream` share: one aligned row per event (time · kind · chain · protocol · summary ·
energy), colour by kind and state, a status footer redrawn in place (live / reconnecting, events per second over 10 s, total, last seq,
lag), and a heartbeat line when the stream has been quiet for 10 s. Off a TTY, or with `json: true`, it writes one JSON object per line.

```js
import { createStreamView } from '@taifoon/term/stream';
const v = createStreamView({ out: process.stdout, tty: process.stdout.isTTY, color: true });
v.state('live', 'public');
v.event({ event: 'envelope', data: pipeEvent });   // a /v1/pipe/stream or /v1/stream event
setInterval(() => v.tick(), 1000);                 // the footer and the heartbeat
```

`describe(ev)` → the row's fields (ids, genome, components, latency, signature) and `row()` / `genomeLine()` / `footer()` /
`statsPanel()` / `mastersTable()` → strings are pure, for tests.

Since 0.3.0: ids are WHOLE by default (`short: true` is the opt-in); what a viewer sees is its key's entitlement (`ELISION_RULE`,
`entitlementOf(GET /v1/access/key)`: a bought package opens whole ids and sealed bodies, a public or free viewer sees "…" and a buy
hint); each row carries a genome line (entity · order key · digest · signature · producer→pipe latency · masters); `masters` (a
Map from `mastersOf(GET /v1/owners records)`) adds the owner column (⚑ holder, ○ seat claimable · ● claimed · ◆ ours); `header(h)`
rows for block headers; `stats: true` draws the measures panel (rates per chain and venue over 10 s / 1 min, GRID/s, p50/p95
producer→pipe latency, lag per lane, signed and lost shares); the footer and the panel are redrawn in place without jitter,
`resize(w)` follows the terminal. `@taifoon/term/measures` is the ring behind it: `spark()` is open-mamba's 8-bar sparkline
(crates/mamba-cli/src/loopkit/studio.rs:26-35), the p50/p95 columns follow its histogram buckets (crates/mamba-lake/src/store.rs:447),
and severity orders so the strictest wins (crates/mamba-policy/src/verdict.rs:7-11).

## The commerce agreement (`@taifoon/term/stream`, 0.3.1)

A commerce envelope carries `envelope.agreement` (`taifoon.commerce.agreement.v1`, coord `lang/cue/commerce.cue #Agreement`).
The view reads it in the protocol's order: the venue in the venue column, then `job 81877 · paid 3.02 USDC · seller → buyer ·
via reseller · tx … on base`, and a dim `⚖` line with every leg, the vault move and the energy (`legs: false` hides it). A viewer
without the right sees party ids, the ref and the tx as `…` — the generated `agreementView`, run on the coord vectors in the tests;
an access id the key bought (`grants`) opens that agreement whole. `check(ev)` draws a refused (`✗`) or missing (`○`) agreement inline.
Pure helpers: `amount`, `agreementOf`, `agreementElided`, `agreementLine`, `legsLine`, `checkLine`.
