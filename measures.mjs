// @taifoon/term/measures — the measures behind the stream footer and the --stats panel (_STREAM_MEASURES_v1_).
//
// A bounded ring of samples (one per event: at, chain, venue, lane, kind, grid, signed, latency) answers rates over 10 s and 60 s,
// overall, per chain and per venue; GRID energy per second overall and per chain; lag per lane; the signed share; the lost/dropped
// share; p50/p95 of the producer→pipe latency per protocol; and a sparkline of the last N seconds. Pure but for the clock the caller
// passes in. Borrowed from open-mamba's studio: the 8-step bar sparkline (crates/mamba-cli/src/loopkit/studio.rs:26-35, `spark`:
// ▁▂▃▄▅▆▇█ with · for a missing sample), the p50/p95 columns its lake and API expose through histogram buckets
// (crates/mamba-lake/src/store.rs:447, crates/mamba-api/src/routes.rs:182), and colour by severity ordered so the strictest wins
// (crates/mamba-policy/src/verdict.rs:7-11).

export const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
export const RING_CAP = 4096;

/** values in [0, 1] → one bar each; null → ·  (open-mamba studio.rs:26-35). Pure. */
export function spark(values) {
  return values.map((v) => (v == null || Number.isNaN(v) ? '·' : BARS[Math.min(7, Math.round(Math.max(0, Math.min(1, v)) * 7))])).join('');
}

/** the p-th percentile of a list (nearest rank). Pure. */
export function percentile(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/** Severity, ordered so the strictest wins when several apply (open-mamba verdict.rs:7-11). Pure. */
export const SEVERITY = ['ok', 'info', 'notice', 'warn', 'bad'];
export const worst = (...xs) => xs.reduce((a, b) => (SEVERITY.indexOf(b) > SEVERITY.indexOf(a) ? b : a), 'ok');

/** A new measures ring. `now` is the clock (ms). */
export function createMeasures({ now = () => Date.now(), cap = RING_CAP } = {}) {
  const ring = []; let total = 0; let grid = 0; let signed = 0; let lostOrDropped = 0;
  const lagByLane = new Map();
  const prune = (t) => { while (ring.length && t - ring[0].at > 60_000) ring.shift(); while (ring.length > cap) ring.shift(); };
  /** rate per second of samples passing `pick` over the last `windowMs` */
  const rate = (windowMs, pick = () => true) => { const t = now(); let n = 0; for (let i = ring.length - 1; i >= 0 && t - ring[i].at <= windowMs; i--) if (pick(ring[i])) n++; return n / (windowMs / 1000); };
  const sum = (windowMs, field, pick = () => true) => { const t = now(); let s = 0; for (let i = ring.length - 1; i >= 0 && t - ring[i].at <= windowMs; i--) if (pick(ring[i])) s += ring[i][field] || 0; return s / (windowMs / 1000); };
  const groups = (windowMs, key) => { const t = now(); const m = new Map(); for (let i = ring.length - 1; i >= 0 && t - ring[i].at <= windowMs; i--) { const k = ring[i][key]; if (!k) continue; const g = m.get(k) ?? { n: 0, grid: 0, lat: [] }; g.n++; g.grid += ring[i].grid || 0; if (ring[i].latency != null) g.lat.push(ring[i].latency); m.set(k, g); } return m; };
  return {
    /** one sample: { chain, venue, lane, kind, grid (mGRID), signed, latency (s), lost } */
    add(s) {
      const at = s.at ?? now(); ring.push({ ...s, at }); total++; grid += s.grid || 0; if (s.signed) signed++; if (s.lost) lostOrDropped++; prune(at);
    },
    lag(lane, behind) { lagByLane.set(lane, behind); },
    /** the whole picture, for the footer and the panel. Pure read. */
    snapshot() {
      const t = now(); prune(t);
      const by = (key, w) => [...groups(w, key).entries()].map(([k, g]) => ({ key: k, rate: g.n / (w / 1000), grid_per_s: g.grid / (w / 1000), p50: percentile(g.lat, 50), p95: percentile(g.lat, 95) })).sort((a, b) => b.rate - a.rate);
      // the last 30 s, one bucket a second, scaled to the busiest second
      const buckets = new Array(30).fill(0);
      for (let i = ring.length - 1; i >= 0 && t - ring[i].at <= 30_000; i--) buckets[29 - Math.min(29, Math.floor((t - ring[i].at) / 1000))]++;
      const peak = Math.max(1, ...buckets);
      return {
        total, rate10: rate(10_000), rate60: rate(60_000), grid10: sum(10_000, 'grid'), grid60: sum(60_000, 'grid'),
        signed_share: total ? signed / total : 0, lost_share: total ? lostOrDropped / total : 0,
        chains10: by('chain', 10_000), chains60: by('chain', 60_000), venues10: by('venue', 10_000), venues60: by('venue', 60_000),
        lanes: [...lagByLane.entries()].map(([lane, behind]) => ({ lane, behind })),
        spark: buckets.map((b) => b / peak), peak,
        latency: { p50: percentile(ring.map((r) => r.latency).filter((x) => x != null), 50), p95: percentile(ring.map((r) => r.latency).filter((x) => x != null), 95) },
      };
    },
    get size() { return ring.length; },
  };
}
