// @taifoon/term: the vendoring contract (one file, no imports, no import-time effects) and the line shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../term.mjs', import.meta.url));
const SRC = readFileSync(FILE, 'utf8');
const T = await import('../term.mjs');

const sink = (isTTY = false) => { const buf = []; return { isTTY, write: (s) => { buf.push(s); return true; }, text: () => buf.join('') }; };

test('the file has no import statements and no dynamic import or require', () => {
  assert.doesNotMatch(SRC, /^\s*import\s/m);
  assert.doesNotMatch(SRC, /\bimport\s*\(/);
  assert.doesNotMatch(SRC, /\brequire\s*\(/);
});

test('it imports cleanly in a bare node context and writes nothing at import', () => {
  // a fresh node with an empty env, stdout captured: importing must print nothing and not throw
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify('file://' + FILE)});`], { env: {}, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('import does not read process.env or touch stdout (checked with traps)', () => {
  // node's own loader reads process.env once per module job; only reads made from term.mjs count
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    let reads = 0; const env = process.env;
    Object.defineProperty(process, 'env', { get() { if ((new Error().stack || '').includes('term.mjs')) reads++; return env; } });
    const w = process.stdout.write.bind(process.stdout); let writes = 0; process.stdout.write = (...a) => { writes++; return w(...a); };
    await import(${JSON.stringify('file://' + FILE)});
    process.stdout.write = w; w(JSON.stringify({ reads, writes }));`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { reads: 0, writes: 0 });
  // and the trap does catch a read once a function runs
  const r2 = spawnSync(process.execPath, ['--input-type=module', '-e', `
    let reads = 0; const env = process.env;
    Object.defineProperty(process, 'env', { get() { if ((new Error().stack || '').includes('term.mjs')) reads++; return env; } });
    const T = await import(${JSON.stringify('file://' + FILE)}); T.createTerm({ out: { write() {} } });
    process.stdout.write(JSON.stringify({ reads }));`], { encoding: 'utf8' });
  assert.equal(JSON.parse(r2.stdout).reads, 1);
});

test('colour: NO_COLOR, non-TTY, TERM=dumb switch it off; FORCE_COLOR wins', () => {
  assert.equal(T.colorOn({ isTTY: true }, {}), true);
  assert.equal(T.colorOn({ isTTY: false }, {}), false);
  assert.equal(T.colorOn({ isTTY: true }, { NO_COLOR: '1' }), false);
  assert.equal(T.colorOn({ isTTY: true }, { NO_COLOR: '' }), true);
  assert.equal(T.colorOn({ isTTY: true }, { TERM: 'dumb' }), false);
  assert.equal(T.colorOn({ isTTY: false }, { FORCE_COLOR: '1' }), true);
  assert.equal(T.colorOn({ isTTY: true }, { FORCE_COLOR: '0' }), false);
});

test('the lines, plain', () => {
  const s = sink();
  const t = T.createTerm({ out: s, env: {} });
  assert.equal(t.color, false);
  t.step(1, 5, 'readiness');
  t.call('GET', 'coord.taifoon.dev/v1/classes');
  t.called(200, 612.4);
  t.call('POST', 'coord.taifoon.dev/v1/pools/quote', { seller: '0xab', price_usdc: 1 });
  t.called(null, 9000, 'timeout');
  t.ok('hireable · 8 ok', { ms: 640 });
  t.warn('not probed', { ms: 3, extra: 'cached 3 min ago' });
  t.fail('the quote could not be read (502)');
  t.skip('not run');
  t.say('Hireable: the broker can send it a job.');
  t.note('wilson 0.000–0.658 · n 2');
  t.next('calibrated: POST /v1/pools/quote');
  t.cmd("curl -s https://coord.taifoon.dev/v1/classes");
  assert.equal(s.text(), [
    '→ [1/5] readiness',
    '● GET coord.taifoon.dev/v1/classes',
    '  ⎿ 200 · 612 ms',
    '● POST coord.taifoon.dev/v1/pools/quote {"seller":"0xab","price_usdc":1}',
    '  ⎿ no answer · 9000 ms · timeout',
    '✓ hireable · 8 ok · 640 ms',
    '! not probed · 3 ms · cached 3 min ago',
    '✗ the quote could not be read (502)',
    '· not run',
    '  Hireable: the broker can send it a job.',
    '  wilson 0.000–0.658 · n 2',
    '→ calibrated: POST /v1/pools/quote',
    '    $ curl -s https://coord.taifoon.dev/v1/classes',
    '',
  ].join('\n'));
});

test('colour on: glyphs are coloured, stripAnsi gives the plain line back', () => {
  const s = sink(true);
  const t = T.createTerm({ out: s, env: {} });
  assert.equal(t.color, true);
  const line = t.ok('done', { ms: 5 });
  assert.match(line, /\u001b\[32m✓/);
  assert.equal(T.stripAnsi(line), '✓ done · 5 ms');
  assert.match(t.fail('broken'), /\u001b\[31m/);
});

test('quiet writes nothing but json; the spinner is a no-op off a TTY', () => {
  const s = sink();
  const t = T.createTerm({ out: s, env: {}, quiet: true });
  assert.equal(t.ok('x'), '✓ x');
  t.json({ a: 1 });
  const sp = t.spinner('waiting'); sp.update('still'); sp.stop();
  assert.equal(s.text(), '{"a":1}\n');
  const s2 = sink();
  const t2 = T.createTerm({ out: s2, env: {} });
  t2.spinner('waiting').stop('✓ done');
  assert.equal(s2.text(), '✓ done\n');
});

test('the spinner on a colour TTY clears its line before other lines and on stop', () => {
  const s = sink(true);
  const t = T.createTerm({ out: s, env: {} });
  const sp = t.spinner('thinking');
  t.say('a line');
  sp.stop('✓ ok');
  const plain = T.stripAnsi(s.text());
  assert.ok(plain.includes('\r'), 'clears with \\r');
  assert.ok(plain.endsWith('✓ ok\n'));
  assert.ok(plain.includes('  a line\n'));
});

test('elapsed and ages', () => {
  assert.equal(T.fmtMs(640), '640 ms');
  assert.equal(T.fmtMs(undefined), '— ms');
  assert.equal(T.elapsed(1000, 1640.4), 640);
  assert.equal(T.elapsed(2000, 1000), 0);
  assert.equal(T.fmtAge(1000), 'just now');
  assert.equal(T.fmtAge(42_000), '42 s ago');
  assert.equal(T.fmtAge(185_000), '3 min ago');
  assert.equal(T.fmtAge(2 * 3600_000), '2 h ago');
  assert.equal(T.fmtAge(26 * 3600_000), '1 d ago');
});

test('the default-terminal exports exist and are functions', () => {
  for (const k of ['step', 'call', 'called', 'ok', 'warn', 'fail', 'skip', 'note', 'next', 'spinner', 'elapsed', 'fmtMs', 'createTerm']) assert.equal(typeof T[k], 'function', k);
});
