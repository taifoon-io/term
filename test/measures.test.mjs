// _STREAM_MEASURES_v1_: rates over 10 s / 1 min overall, per chain and per venue; GRID per second; signed and lost shares; p50/p95;
// the sparkline shape (open-mamba studio.rs:26-35); a bounded ring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMeasures, spark, percentile, worst } from '../measures.mjs';

test('spark: 8 bars, · for a missing sample (open-mamba studio.rs:26-35)', () => {
  assert.equal(spark([0, 0.5, 1, null]), '▁▅█·');
  assert.equal(spark([]), '');
});

test('percentile: nearest rank; worst: the strictest severity wins', () => {
  assert.equal(percentile([5, 1, 3], 50), 3); assert.equal(percentile([1, 2, 3, 4, 100], 95), 100); assert.equal(percentile([], 50), null);
  assert.equal(worst('ok', 'warn', 'info'), 'warn'); assert.equal(worst(), 'ok');
});

test('rates per window, per chain and per venue; GRID/s; shares; latency percentiles; the ring is bounded', () => {
  let t = 1_000_000; const m = createMeasures({ now: () => t, cap: 50 });
  for (let i = 0; i < 20; i++) { t += 500; m.add({ chain: i % 2 ? 'base' : 'arbitrum', venue: 'across_v3', lane: 'pipe', kind: 'observe', grid: 40, signed: i % 4 === 0, latency: 5 + i, lost: i === 3 }); }
  const s = m.snapshot();
  assert.equal(s.total, 20);
  assert.equal(s.rate10, 2); // 20 samples over the last 10 s at 2/s
  assert.ok(Math.abs(s.rate60 - 20 / 60) < 1e-9);
  assert.equal(s.grid10, 80); // 2/s × 40 mGRID
  assert.equal(s.signed_share, 0.25); assert.equal(s.lost_share, 0.05);
  assert.deepEqual(s.chains10.map((c) => c.key).sort(), ['arbitrum', 'base']);
  assert.equal(s.venues10[0].key, 'across_v3'); assert.equal(s.venues10[0].rate, 2);
  assert.equal(s.latency.p50, 14); assert.equal(s.latency.p95, 23);
  assert.equal(s.spark.length, 30); assert.equal(Math.max(...s.spark), 1);
  for (let i = 0; i < 100; i++) m.add({ chain: 'base', lane: 'pipe' });
  assert.equal(m.size, 50);
  m.lag('pipe', 12); assert.deepEqual(m.snapshot().lanes, [{ lane: 'pipe', behind: 12 }]);
});
