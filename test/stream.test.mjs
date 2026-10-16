// The live stream view: every event of a captured public pipe session decodes to a named row (never "unrecognised", never raw JSON),
// the TTY view is aligned and coloured with a footer, NO_COLOR/non-TTY is NDJSON, and the heartbeat speaks when the stream is quiet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, row, footer, createStreamView, streamPalette, chainName, filtersOf, passes, mastersOf, masterOf, genomeLine, statsPanel, mastersTable, entitlementOf, elided, ELISION_RULE } from '../stream.mjs';

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
  assert.match(r.summary, new RegExp(`^order [A-Za-z]+ → ${ev.data.observed.to} · tx ${ev.data.observed.tx} · block [0-9,]+$`)); // WHOLE by default
  assert.equal(r.energy, '40 mGRID');
  assert.match(describe(ev, { short: true }).summary, /tx 0x[0-9a-f]{4}…[0-9a-f]{4} ·/); // --short is the opt-in
  assert.deepEqual(Object.keys(r.ids).sort(), ['address', 'envelope', 'order_key', 'tx']);
  assert.equal(r.genome.entity, 'order'); assert.equal(r.genome.key, ev.data.envelope.order_key); assert.equal(r.genome.digest, ev.data.envelope.payload_digest); assert.match(r.genome.stage, /→/);
  assert.deepEqual(r.components, [`chain:${ev.data.observed.chain_id}`, 'protocol:across_v3']);
  assert.equal(typeof r.latency, 'number');
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
  assert.match(strip(o.buf), /● live +· +[0-9.]+\/s · [▁▂▃▄▅▆▇█·]+ · +10 events · seq [0-9,]+ · GRID [0-9.]+\/s · signed \d+% · lost \d+% · public; session 120s$/);
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

test('quiet stream: the footer counts the quiet seconds; ONE heartbeat line after a quiet minute, at most every 5 minutes', () => {
  let t = 0; const o = sink(120); const v = createStreamView({ out: o, tty: true, color: false, now: () => t, genome: false });
  v.state('live'); v.event(events[0]); t = 12_000; v.tick();
  assert.match(o.buf, /quiet 12s/); assert.doesNotMatch(o.buf, /still listening/);
  t = 61_000; v.tick(); assert.match(o.buf, /connected, no new events for 61 s; still listening/);
  t = 120_000; const before = o.buf.length; v.tick(); assert.doesNotMatch(o.buf.slice(before), /still listening/);
});

test('entitlement (_ELISION_RULE_v1_): public and free keys see elided ids and a buy hint; a paid key or a served payload sees whole ids', () => {
  const pub = entitlementOf(null); assert.equal(pub.entitled, false); assert.equal(pub.via, 'public');
  assert.equal(entitlementOf({ keys: [{ key: { prefix: 'tfr_free_x' }, tier: 'free' }] }).via, 'free key');
  const paid = entitlementOf({ keys: [{ key: { prefix: 'tfr_x' }, tier: 'paid' }] }); assert.equal(paid.entitled, true);
  const ev = events.find((e) => e.data.observed?.tx);
  assert.equal(elided(ev, pub), true); assert.equal(elided(ev, paid), false);
  assert.equal(elided({ event: 'envelope', data: { ...ev.data, envelope: { ...ev.data.envelope, payload: '{"x":1}' } } }, pub), false); // the pipe served it to this viewer
  const o = sink(160); const v = createStreamView({ out: o, tty: true, color: false, entitlement: pub, now: () => 0 }); v.state('live'); v.event(ev);
  assert.match(strip(o.buf), /tx 0x[0-9a-f]{4}…[0-9a-f]{4} · block/); assert.match(strip(o.buf), /buy access: the Taifoon package \(GET \/v1\/access\)/);
  const o2 = sink(160); const v2 = createStreamView({ out: o2, tty: true, color: false, entitlement: paid, now: () => 0 }); v2.state('live'); v2.event(ev);
  assert.match(strip(o2.buf), new RegExp(`tx ${ev.data.observed.tx} · block`)); assert.doesNotMatch(strip(o2.buf), /buy access/);
  const nd = sink(); const v3 = createStreamView({ out: nd, tty: false, color: false, entitlement: pub }); v3.event(ev);
  assert.equal(JSON.parse(nd.buf).elided, true); assert.match(JSON.parse(nd.buf).buy, /buy access/);
  assert.match(ELISION_RULE, /^entitled:key_tier_in\(paid,plan\)/);
});

test('genome line: entity · key · digest · signature · producer→pipe latency · masters', () => {
  const ev = events.find((e) => e.data.observed?.tx);
  const masters = mastersOf([{ id: 'chain:8453', kind: 'chain', name: 'Base', owner: { persona: 'operator', holder: 'taifoon' }, seat: { state: 'held_by_operator', delegable: true }, shares: { owner_bps: 0, taifoon_bps: 10000 } }, { id: 'protocol:across_v3', kind: 'protocol', name: 'Across', owner: { persona: 'operator', holder: 'taifoon' } }]);
  const r = describe(ev); const g = genomeLine(r, streamPalette(false), { masters });
  assert.match(g, new RegExp(`⌁ order ${ev.data.envelope.order_key} · genome ${ev.data.envelope.payload_digest}`));
  assert.match(g, /\d+ s producer → pipe/);
  if (ev.data.observed.chain_id === 8453) assert.match(g, /chain:8453 → taifoon \(seat claimable\)/);
  assert.equal(masterOf('venue:across_v3', masters).id, 'protocol:across_v3');
  assert.equal(masterOf('chain:8453', masters).claimable, true);
  const rowText = row(r, streamPalette(false), { width: 160, masters });
  if (ev.data.observed.chain_id === 8453) assert.match(rowText, /⚑ taifoon/);
});

test('the stats panel and the masters table render from the measures and the components seen', () => {
  let t = 0; const o = sink(160);
  const masters = mastersOf([{ id: 'protocol:layerzero_v2', kind: 'protocol', name: 'LayerZero V2', owner: { persona: 'operator', holder: 'taifoon' }, seat: { state: 'held_by_operator', delegable: true }, shares: { owner_bps: 0, taifoon_bps: 10000 } }]);
  const v = createStreamView({ out: o, tty: true, color: false, stats: true, masters, now: () => t, genome: false });
  v.state('live'); for (const ev of events.slice(0, 30)) { t += 200; v.event(ev); }
  const txt = strip(o.buf);
  assert.match(txt, /measures +[0-9.]+\/s over 10 s · [0-9.]+\/s over 1 min · GRID [0-9.]+\/s/);
  assert.match(txt, /chain +10 s +1 min +GRID\/s +p50 +p95/); assert.match(txt, /venue \/ protocol/);
  const lines = statsPanel(v.measures.snapshot(), streamPalette(false), { width: 160 }); assert.ok(lines.length >= 3);
  const comps = v.components(); assert.ok(comps.find((c) => c.component === 'protocol:layerzero_v2')?.master?.claimable);
  const table = mastersTable(comps, streamPalette(false)); assert.match(table[0], /component +events +master +seat +shares/); assert.ok(table.some((l) => /protocol:layerzero_v2 .*taifoon .*held by operator · claimable.*owner 0% · taifoon 100%/.test(l)));
  v.resize(100); v.header({ chain_id: 8453, network_name: 'Base', latest_block: 52690244, mini_mmr_root: '0xabc', last_header_age_secs: 3, rate_per_sec: 0.5, status: 'collecting' });
  assert.match(strip(o.buf), /header +base +Base +— +height 52,690,244 · tree 0xabc · age 3 s · 0.50 blk\/s/); // no owner record for chain:8453 in this map: —
});


test('footer and row are pure', () => {
  assert.equal(footer({ state: 'reconnecting', rate: 0, total: 3, seq: 9 }), '◌ reconnecting  ·   0.0/s ·       3 events · seq 9');
  assert.match(row(describe(events[0]), streamPalette(false), { width: 100 }), /^\d\d:\d\d:\d\d  observe /);
});

test('names stay readable, hashes shorten; every chain the pipe observed has a name', () => {
  const ad = describe(events.find((e) => e.data.envelope?.kind === 'advert'));
  assert.match(ad.summary, /to twigster-example/); assert.deepEqual(ad.components, ['chain:offchain'].filter(() => false).concat(['venue:coord']));
  assert.equal(chainName(57073), 'ink'); assert.equal(chainName('eip155:59144'), 'linea');
  assert.match(describe({ event: 'batch', data: { kind: 'batch', seq: 1, at: 1, batch: { batch: 2, leaves: 1, root: '0x00' } } }).summary, /1 leaf ·/);
});

test('the one filter: chain by name or id, protocol, kind, actor; empty passes all', () => {
  const keep = (f) => events.filter((e) => passes(e, filtersOf(f)));
  assert.equal(keep({}).length, events.length);
  assert.ok(keep({ chain: 'base', protocol: 'across_v3' }).every((e) => e.data.observed.chain_id === 8453 && e.data.observed.protocol === 'across_v3'));
  assert.deepEqual(keep({ chain: 'eip155:8453' }).map((e) => e.data.seq), keep({ chain: 'base' }).map((e) => e.data.seq));
  assert.ok(keep({ kind: 'lost' }).length > 0 && keep({ kind: 'lost' }).every((e) => e.data.kind === 'lost'));
  assert.ok(keep({ actor: 'twigster-example' }).length > 0);
});

test('every coord lane decodes to a named row: its lane as the kind, never a JSON dump', () => {
  const lanes = readFileSync(new URL('./fixtures/lanes-sample.sse', import.meta.url), 'utf8').split('\n\n').filter((b) => /^data:/m.test(b)).map((b) => ({
    event: b.match(/^event: (.*)$/m)?.[1] ?? 'message', data: JSON.parse(b.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('')),
  }));
  const kinds = new Set();
  for (const ev of lanes) {
    const r = describe(ev); kinds.add(r.kind);
    assert.equal(r.kind, ev.event);
    assert.ok(r.summary && !/^\{|":/.test(r.summary), `${ev.event}: ${r.summary}`);
  }
  assert.deepEqual([...kinds].sort(), ['action', 'flow', 'hello', 'jev', 'job', 'pool', 'quota', 'root']);
  const pool = describe(lanes.find((e) => e.event === 'pool'));
  assert.match(pool.summary, /^seller 0x[0-9a-f]{40} · [0-9,]+\/[0-9,]+ settled/);
  assert.match(pool.summary, /snapshot$/);
});

// ── the commerce agreement (_ONE_FORMAT_v1_, coord lang/cue/commerce.cue #Agreement) ──
import { amount, agreementOf, agreementElided, agreementLine, legsLine } from '../stream.mjs';
// the generated checker and its vectors live in the monorepo (packages/resale, from coord lang/vectors/agreement.json); the public
// term repo ships without them, so the parity cases run here and a fixture copy of one vector keeps the rendering tests everywhere
const { existsSync } = await import('node:fs');
const MONO = existsSync(new URL('../../resale/runtime/coord-lang/agreement.json', import.meta.url));
const VECTORS = MONO ? JSON.parse(readFileSync(new URL('../../resale/runtime/coord-lang/agreement.json', import.meta.url), 'utf8')) : { cases: [] };
const { agreementView, agreementError } = MONO ? await import('../../resale/runtime/coord-lang/agreement.mjs') : { agreementView: null, agreementError: () => null };
const okCases = VECTORS.cases.filter((c) => c.ok);
const PAID = { schema: 'taifoon.commerce.agreement.v1', feature: 'erc8183-base', hop: 'paid', ref: 'job:8453:erc8183:81877',
  parties: { seller: { id: '0x1111111111111111111111111111111111111111' }, buyer: { id: '0x2222222222222222222222222222222222222222' }, assurer: { id: 'pool:8453:assurance:1' }, evaluator: { id: 'jev:0x5242dE388a846d16641744dEB095eD63990E7be8' } },
  payment: { units: '3024690', asset: 'USDC' },
  legs: [{ leg: 'our_fee', units: '500000', to: 'layer' }, { leg: 'venue_fee', units: '302468', side: 'in', to: 'venue' }, { leg: 'seller_share', units: '2000000', to: 'seller' }, { leg: 'premium', units: '222222', to: 'assurer' }],
  delivered: { what: 'the job deliverable, graded complete', ref: 'deliverable:0xabc' }, vault: { move: 'release', units: '100000', asset: 'USDC', what: "the seller's deposit returned" },
  evidence: { chain: 'eip155:8453', tx: '0x81464f5e6a8b6322e4bec8f609a08e8ec1f1ef11d39e5f5d51e3fa676c5f042a' } };
const paid = MONO ? okCases.find((c) => c.name === 'erc8183-paid-assured').agreement : PAID;

test('the elided agreement is the generated view on every accepted vector (one rule, not two)', { skip: !MONO && 'the vectors live in the monorepo' }, () => {
  assert.deepEqual(paid, PAID, 'the fixture copy is the coord vector erc8183-paid-assured');
  assert.ok(okCases.length >= 5);
  for (const c of okCases) {
    assert.equal(agreementError(c.agreement), null, c.name);
    assert.deepEqual(agreementElided(c.agreement), agreementView(c.agreement, false), c.name);
    assert.deepEqual(agreementElided(c.agreement), c.view, c.name);
  }
});

test('amount reads base units exactly', () => {
  assert.equal(amount('1250000', 'USDC'), '1.25 USDC'); assert.equal(amount('2500', 'USDC'), '0.0025 USDC');
  assert.equal(amount('5', 'GRID'), '5 GRID'); assert.equal(amount('7', 'ZZZ'), '7 ZZZ'); assert.equal(amount('0', 'USDC'), '0 USDC');
  assert.equal(amount('2000000', 'USDC'), '2 USDC'); assert.equal(amount('1270000', 'USDC'), '1.27 USDC');
});

test('an erc8183 job with its agreement: venue column, then job · hop · paid · seller → buyer · tx; the ⚖ line has every leg', () => {
  const ev = { event: 'job', data: { id: '81877', chainId: 8453, venue: 'erc8183', ending: 'Seller paid, deposit returned, premium to the backers.', lane: 'job', ts: 1, agreement: paid } };
  const r = describe(ev);
  assert.equal(r.where, 'erc8183-base');
  assert.equal(r.summary, 'job 81877 · paid 3.02 USDC · 0x1111111111111111111111111111111111111111 → 0x2222222222222222222222222222222222222222 · tx 0x81464f5e6a8b6322e4bec8f609a08e8ec1f1ef11d39e5f5d51e3fa676c5f042a on base');
  assert.equal(r.legs, 'our fee 0.5 → layer · venue fee in 0.3 → venue · seller 2 · premium 0.22 → backers · vault release 0.1 USDC (the seller\'s deposit returned) · delivered the job deliverable, graded complete · assurer pool:8453:assurance:1 · evaluator jev:0x5242dE388a846d16641744dEB095eD63990E7be8');
  assert.equal(r.tone, 'good'); assert.equal(r.ids.tx, paid.evidence.tx);
  const e = describe(ev, { elide: true });
  assert.equal(e.summary, 'job 81877 · paid 3.02 USDC · … → … · tx … on base');
  assert.match(e.legs, /our fee 0\.5 → layer/); assert.equal(e.ids.tx, undefined);
});

test('without an agreement the row keeps today\'s text', () => {
  const plain = describe({ event: 'job', data: { id: '81877', chainId: 8453, ending: 'Seller paid, deposit returned, premium to the backers.', seller: '0x' + 'a'.repeat(40), lane: 'job', ts: 1 } });
  assert.match(plain.summary, /^job 81877 · Seller paid, deposit returned, premium to the backers\./); assert.equal(plain.legs, undefined); assert.equal(plain.agreement, undefined);
});

test('an envelope carrying the agreement (pipe stream) reads the same way; unknowns say why', () => {
  const unk = okCases.find((c) => c.agreement.payment?.unknown) ?? okCases.find((c) => c.agreement.evidence?.unknown);
  const ev = { event: 'envelope', data: { envelope: { id: '0x' + '9'.repeat(64), kind: 'record', state: 'included', from: { venue: 'x' }, to: { venue: 'y', chain: 'eip155:8453' }, economics: { energy: { milli_grid: 12 } }, agreement: paid } } };
  const r = describe(ev);
  assert.equal(r.where, 'erc8183-base'); assert.match(r.summary, /^job 81877 · paid 3\.02 USDC/); assert.match(r.legs, /energy 12 mGRID$/);
  if (unk) { const u = describe({ event: 'job', data: { id: 1, lane: 'job', ts: 1, agreement: unk.agreement } }); assert.match(u.legs, /unknown: /); }
});

test('the view: ⚖ line under the row on a TTY, off with legs:false, the agreement in NDJSON; a grant for the access id opens it', () => {
  const ev = { event: 'job', data: { id: '81877', chainId: 8453, lane: 'job', ts: 1, agreement: { ...paid, access: 'venue:erc8183-base' } } };
  const o = sink(240); const v = createStreamView({ out: o, tty: true, color: false, now: () => 0, genome: false }); v.state('live'); v.event(ev);
  assert.match(strip(o.buf), /\n {10}⚖ our fee 0\.5 → layer/);
  const o2 = sink(240); const v2 = createStreamView({ out: o2, tty: true, color: false, now: () => 0, genome: false, legs: false }); v2.state('live'); v2.event(ev);
  assert.doesNotMatch(strip(o2.buf), /⚖/);
  const nd = sink(); const v3 = createStreamView({ out: nd, tty: false, color: false }); v3.event(ev); assert.equal(JSON.parse(nd.buf).agreement.payment.units, '3024690');
  const pub = entitlementOf(null);
  const o4 = sink(240); const v4 = createStreamView({ out: o4, tty: true, color: false, now: () => 0, genome: false, entitlement: pub }); v4.state('live'); v4.event(ev);
  assert.match(strip(o4.buf), /… → …/);
  const granted = entitlementOf({ keys: [{ tier: 'free', key: {} }], grants: [{ state: 'active', resource: 'venue:erc8183-base' }] });
  const o5 = sink(240); const v5 = createStreamView({ out: o5, tty: true, color: false, now: () => 0, genome: false, entitlement: granted }); v5.state('live'); v5.event(ev);
  assert.match(strip(o5.buf), /0x1111111111111111111111111111111111111111 → 0x2222/);
});

test('the agreement check is drawn inline: ✗ refused with the reason, ○ missing, nothing when ok; NDJSON carries it', { skip: !MONO && 'the checker lives in the monorepo' }, () => {
  const ev = { event: 'job', data: { id: '1', chainId: 8453, lane: 'job', ts: 1, agreement: paid } };
  const bad = { event: 'job', data: { id: '2', chainId: 8453, lane: 'job', ts: 1, agreement: { ...paid, hop: 'shipped' } } };
  const none = { event: 'job', data: { id: '3', chainId: 8453, lane: 'job', ts: 1, venue: 'erc8183' } };
  const check = (e) => { const a = e.data.agreement; if (!a) return { state: 'missing', reason: 'the erc8183 lane carries envelope.agreement' }; const r = agreementError(a); return r ? { state: 'invalid', reason: r } : { state: 'ok' }; };
  const o = sink(240); const v = createStreamView({ out: o, tty: true, color: false, now: () => 0, genome: false, check }); v.state('live'); v.event(ev); v.event(bad); v.event(none);
  const t = strip(o.buf);
  assert.match(t, /✗ agreement refused: hop "shipped" is not one of the twelve/);
  assert.match(t, /○ no agreement: the erc8183 lane carries envelope\.agreement/);
  assert.equal((t.match(/✗|○ no agreement/g) || []).length, 2);
  const nd = sink(); const v2 = createStreamView({ out: nd, tty: false, color: false, check }); v2.event(bad); assert.equal(JSON.parse(nd.buf).agreement_check.state, 'invalid');
});
