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
