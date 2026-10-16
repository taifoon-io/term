// The live stream view: every event of a captured public pipe session decodes to a named row (never "unrecognised", never raw JSON),
// the TTY view is aligned and coloured with a footer, NO_COLOR/non-TTY is NDJSON, and the heartbeat speaks when the stream is quiet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, row, footer, createStreamView, streamPalette, chainName } from '../stream.mjs';

const strip = (s) => s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
const events = readFileSync(new URL('./fixtures/pipe-sample.sse', import.meta.url), 'utf8').split('\n\n').filter(Boolean).map((b) => ({
  event: b.match(/^event: (.*)$/m)[1], id: b.match(/^id: (.*)$/m)?.[1], data: JSON.parse(b.split('\n').find((l) => l.startsWith('data: ')).slice(6)),
}));
const sink = (columns) => { const o = { buf: '', columns, write(s) { o.buf += s; return true; } }; return o; };

test('every captured event decodes to a kind, a chain and a summary', () => {
  assert.ok(events.length >= 40);
  const kinds = new Set();
  for (const ev of events) {
    const r = describe(ev);
    kinds.add(r.kind);
    assert.ok(r.summary && !r.summary.startsWith('{'), `raw summary for seq ${ev.data.seq}`);
    assert.ok(!/unrecognised/.test(r.summary));
    assert.notEqual(r.chain, '0');
    assert.equal(typeof r.seq, 'number');
  }
  assert.deepEqual([...kinds].sort(), ['advert', 'batch', 'lost', 'observe']);
});

test('an observed bridge fill reads as protocol, transition, tx and block', () => {
  const ev = events.find((e) => e.data.observed?.protocol === 'across_v3' && e.data.observed.tx);
  const r = describe(ev);
  assert.equal(r.kind, 'observe'); assert.equal(r.chain, chainName(ev.data.observed.chain_id)); assert.equal(r.where, 'across_v3');
  assert.match(r.summary, new RegExp(`^order [A-Za-z]+ → ${ev.data.observed.to} · tx 0x[0-9a-f]{4}…[0-9a-f]{4} · block [0-9,]+$`));
  assert.equal(r.energy, '40 mGRID');
  assert.match(describe(ev, { wide: true }).summary, new RegExp(ev.data.observed.tx));
  const sr = describe(events.find((e) => e.data.observed?.protocol === 'superroot'));
  assert.equal(sr.chain, 'taifoon');
});

test('TTY: aligned coloured rows, the footer redrawn in place; NO_COLOR keeps the layout without escapes', () => {
  let t = 1_792_169_877_000; const now = () => t;
  const o = sink(140); const v = createStreamView({ out: o, tty: true, color: true, now });
  v.state('live', 'public; session 120s');
  for (const ev of events.slice(0, 10)) { t += 100; v.event(ev); }
  assert.match(o.buf, /\u001b\[3[0-9]m/);
  const lines = strip(o.buf).split('\n').map((l) => l.split('\r').pop()).filter((l) => /^\d\d:\d\d:\d\d/.test(l));
  assert.equal(lines.length, 10);
  assert.equal(new Set(lines.map((l) => l.slice(0, 20).length)).size, 1);
  assert.ok(lines.every((l) => l.length <= 140 + 40));
  assert.match(strip(o.buf), /● live · [0-9.]+\/s · 10 events · seq [0-9,]+ · public; session 120s$/);
  const plain = sink(140); const pv = createStreamView({ out: plain, tty: true, color: false, now });
  pv.event(events[0]); assert.doesNotMatch(plain.buf, /\u001b\[[0-9;]*m/);
});

test('off a TTY (or --json): one JSON object per line, nothing else', () => {
  const o = sink(); const v = createStreamView({ out: o, tty: false, color: true });
  v.state('live'); for (const ev of events.slice(0, 5)) v.event(ev); v.tick(); v.close();
  const lines = o.buf.trim().split('\n');
  assert.equal(lines.length, 5);
  for (const [i, l] of lines.entries()) { const j = JSON.parse(l); assert.equal(j.event, events[i].event); assert.equal(j.data.seq, events[i].data.seq); }
});

test('quiet stream: a heartbeat line after 10 s, the footer counts the quiet seconds', () => {
  let t = 0; const o = sink(120); const v = createStreamView({ out: o, tty: true, color: false, now: () => t });
  v.state('live'); v.event(events[0]); t = 12_000; v.tick();
  assert.match(o.buf, /connected — no new events for 12 s; the pipe is quiet, still listening/);
  assert.match(o.buf, /quiet 12s/);
  t = 20_000; const before = o.buf.length; v.tick();
  assert.doesNotMatch(o.buf.slice(before), /still listening/); // at most one heartbeat per 30 s
});

test('footer and row are pure', () => {
  assert.equal(footer({ state: 'reconnecting', rate: 0, total: 3, seq: 9 }), '◌ reconnecting · 0.0/s · 3 events · seq 9');
  assert.match(row(describe(events[0]), streamPalette(false), { width: 100 }), /^\d\d:\d\d:\d\d  observe /);
});

test('names stay readable, hashes shorten; every chain the pipe observed has a name', () => {
  const ad = describe(events.find((e) => e.data.envelope?.kind === 'advert'));
  assert.match(ad.summary, /to twigster-example/);
  assert.equal(chainName(57073), 'ink'); assert.equal(chainName('eip155:59144'), 'linea');
  assert.match(describe({ event: 'batch', data: { kind: 'batch', seq: 1, at: 1, batch: { batch: 2, leaves: 1, root: '0x00' } } }).summary, /1 leaf ·/);
});
