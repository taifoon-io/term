// @taifoon/term/stream — the live stream view shared by `taifoon stream` and `taifoon-sdk coord stream`.
//
// Pure renderers plus one small view object. No imports, no dependencies, nothing at import time.
//   18:04:21  observe   base       layerzero_v2     filled · tx 0x9a3c…41f2 · block 37,201,331            40 mGRID
//   18:04:22  ack       —          coord            0x4ea5…37ef by evm ✓                                   —
//   ● live · 1.8/s · 412 events · seq 81,234 · lag 0
// On a TTY: aligned columns, colour by kind and state, a status footer redrawn in place, and a heartbeat line when the stream is
// quiet so it never looks dead. Off a TTY or with json: one JSON object per line ({event, data}), unchanged.

const ESC = (open, close) => (s) => `\u001b[${open}m${s}\u001b[${close}m`;
const ID = (s) => String(s);

/** Colours for the view (identity when off). */
export function streamPalette(on) {
  if (!on) return { on: false, bold: ID, dim: ID, green: ID, yellow: ID, red: ID, cyan: ID, magenta: ID, blue: ID, gray: ID };
  return { on: true, bold: ESC(1, 22), dim: ESC(2, 22), green: ESC(32, 39), yellow: ESC(33, 39), red: ESC(31, 39), cyan: ESC(36, 39), magenta: ESC(35, 39), blue: ESC(34, 39), gray: ESC(90, 39) };
}

const CHAINS = { 0: 'taifoon', taifoon: 'taifoon', offchain: 'offchain', 1: 'ethereum', 10: 'op', 56: 'bnb', 100: 'gnosis', 130: 'unichain', 137: 'polygon', 143: 'monad', 4663: 'robinhood', 5042: 'arc', 8453: 'base', 36927: 'taifoon-dev', 42161: 'arbitrum', 42170: 'arb-nova', 42220: 'celo', 43114: 'avalanche', 421614: 'arb-sepolia', 3692781: 'taifoon' };

/** A chain id or `eip155:<id>` / `solana:…` as a short name. Pure. */
export function chainName(c) {
  if (c == null || c === '') return '—';
  const s = String(c);
  if (s.startsWith('solana')) return 'solana';
  const id = Number(s.replace(/^eip155:/, ''));
  if (CHAINS[s]) return CHAINS[s];
  return Number.isFinite(id) && CHAINS[id] ? CHAINS[id] : s.replace(/^eip155:/, '');
}

/** 0x-hash shortened to 0xabcd…ef12 (whole when `wide`). Pure. */
export function short(h, wide = false) {
  const s = String(h ?? '');
  if (wide || s.length <= 14) return s;
  return s.startsWith('0x') ? `${s.slice(0, 6)}…${s.slice(-4)}` : `${s.slice(0, 6)}…${s.slice(-4)}`;
}

const num = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : String(n));
const energyOf = (e) => {
  const mg = e?.economics?.energy?.milli_grid;
  return typeof mg === 'number' ? `${mg} mGRID` : '';
};
const valueOf = (e) => {
  const v = e?.economics?.value;
  if (!v || v.amount == null) return '';
  return `${v.amount} ${v.asset ?? ''}`.trim();
};

/**
 * One event → the row's fields { time, kind, chain, where, summary, energy, value, state, tone }. Accepts the pipe stream's events
 * (`/v1/pipe/stream`: event = kind, data = taifoon.pipe.event.v1) and the coord stream's lanes (`/v1/stream`: job, action, flow, root,
 * jev, pool, quota, hello). Pure.
 */
export function describe(ev, { wide = false } = {}) {
  const d = ev?.data && typeof ev.data === 'object' ? ev.data : {};
  const atMs = typeof d.at === 'number' ? (d.at > 1e12 ? d.at : d.at * 1000) : typeof d.ts === 'number' ? d.ts : Date.now();
  const kind = String(d.kind ?? ev?.event ?? 'message');
  const row = { at: atMs, kind, chain: '—', where: '', summary: '', energy: '', value: '', state: '', tone: 'plain', seq: typeof d.seq === 'number' ? d.seq : null };
  if (d.envelope || d.observed || ['envelope', 'leaf', 'ack', 'batch', 'lost', 'dropped', 'lag', 'heartbeat'].includes(kind)) {
    const env = d.envelope ?? {};
    const ob = d.observed ?? null;
    row.energy = energyOf(env); row.value = valueOf(env); row.state = env.state ?? '';
    if (kind === 'envelope' || (env.kind && kind !== 'leaf' && kind !== 'ack')) {
      row.kind = env.kind || kind;
      if (ob) {
        row.chain = ob.chain_id ? chainName(ob.chain_id) : chainName(env.from?.chain || env.to?.chain); row.where = ob.protocol || ob.source || 'coord';
        // catalogue "observe:collect:<entity>:observe" names the entity; transition "protocol.<p>/<from>-><to>" the step
        const entity = typeof ob.catalogue === 'string' ? ob.catalogue.split(':')[2] || '' : '';
        const step = typeof ob.transition === 'string' && ob.transition.includes('/') ? ob.transition.split('/').pop().replace('->', ' → ').replace(/@.*$/, '') : ob.to;
        row.summary = [[entity, step].filter(Boolean).join(' '), ob.tx ? `tx ${short(ob.tx, wide)}` : '', ob.block ? `block ${num(ob.block)}` : `key ${ob.key ?? '?'}`].filter(Boolean).join(' · ');
        row.tone = ob.completes ? 'good' : 'info';
      } else {
        row.chain = chainName(env.to?.chain || env.from?.chain); row.where = `${env.from?.venue || '?'} → ${env.to?.venue || '?'}`;
        row.summary = [env.state, env.to?.agent ? `to ${short(env.to.agent, wide)}` : '', env.id ? short(env.id, wide) : ''].filter(Boolean).join(' · ');
        row.tone = /dropped|refused|failed|expired/.test(env.state ?? '') ? 'bad' : /retried|leased/.test(env.state ?? '') ? 'warn' : /acked|delivered|included/.test(env.state ?? '') ? 'good' : 'info';
        if (env.sealed) row.summary += ' · sealed';
      }
    }
    if (kind === 'leaf' && d.leaf) { row.where = d.leaf.protocol || 'pipe'; row.summary = `${d.leaf.from_state} → ${d.leaf.to_state} · leaf ${short(d.leaf.leaf, wide)}${d.leaf.batch != null ? ` · batch ${d.leaf.batch}` : ''}`; row.tone = 'quiet'; }
    if (kind === 'ack' && d.ack) { row.where = d.ack.scheme || 'ack'; row.summary = `${short(d.ack.envelope_id, wide)} by ${d.ack.by || '?'}${d.ack.verified ? ' ✓' : ''}`; row.tone = 'good'; }
    if (kind === 'batch' && d.batch) { row.where = 'pipe'; row.summary = `batch ${num(d.batch.batch)} · ${d.batch.leaves} leaves · root ${short(d.batch.root, wide)}${d.batch.attested ? ' · attested' : ''}${d.batch.pushed ? ' · pushed' : ''}`; row.tone = 'info'; }
    if (kind === 'lost' && d.lost) { row.where = 'pipe'; row.chain = chainName((d.address || '').split('/')[2] || ''); row.summary = `${short(d.lost.envelope_id, wide)} · ${d.lost.reason}${d.lost.will_retry ? ' · will retry' : ''}`; row.tone = 'warn'; }
    if (kind === 'dropped' && d.dropped) { row.where = d.dropped.handler || ''; row.summary = `${short(d.dropped.envelope_id, wide)} · ${d.dropped.reason}`; row.tone = 'bad'; }
    if (kind === 'lag' && d.lag) { row.summary = `${num(d.lag.behind)} behind${d.lag.dropped ? ' · the server cut this subscriber' : ''}`; row.tone = 'warn'; }
    return row;
  }
  // the coord stream's lanes
  if (kind === 'hello') { row.summary = `lanes ${(d.lanes ?? []).join(', ')}`; row.tone = 'quiet'; return row; }
  if (kind === 'action' || d.action) {
    row.kind = 'action'; row.chain = chainName(d.chain_id); row.where = d.entity || d.label || '';
    row.summary = d.message || [d.action, d.tx ? `tx ${short(d.tx, wide)}` : ''].filter(Boolean).join(' · ');
    row.tone = d.action === 'unrecognised' ? 'warn' : 'info'; return row;
  }
  if (kind === 'job' || d.ending !== undefined) {
    row.kind = 'job'; row.chain = chainName(d.chainId ?? d.chain_id); row.where = d.venue || 'erc8183';
    row.summary = [`job ${d.id ?? '?'}`, d.state, d.ending].filter(Boolean).join(' · '); row.tone = 'good'; return row;
  }
  row.summary = (() => { try { const s = JSON.stringify(d); return s.length > 160 ? `${s.slice(0, 157)}…` : s; } catch { return ''; } })();
  row.tone = 'quiet';
  return row;
}

const pad = (s, n) => { const t = String(s); return t.length >= n ? `${t.slice(0, Math.max(0, n - 1))}…` : t + ' '.repeat(n - t.length); };
const hhmmss = (ms) => { const d = new Date(ms); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':'); };

/** One aligned row for a TTY (colour by kind/tone when the palette is on). Pure. */
export function row(r, p = streamPalette(false), { width = 120 } = {}) {
  const toneOf = { good: p.green, bad: p.red, warn: p.yellow, info: p.cyan, quiet: p.dim, plain: ID };
  const kindCol = { observe: p.blue, envelope: p.cyan, settle: p.magenta, release: p.magenta, hire: p.cyan, ack: p.green, leaf: p.gray, batch: p.yellow, dropped: p.red, lost: p.yellow, job: p.green, action: p.blue, record: p.gray };
  const k = (kindCol[r.kind] ?? p.bold)(pad(r.kind, 9));
  const tail = [r.energy, r.value].filter(Boolean).join(' · ');
  const fixed = 8 + 2 + 9 + 1 + 12 + 1 + 18 + 1 + (tail ? tail.length + 2 : 0);
  const sumW = Math.max(20, width - fixed);
  return `${p.dim(hhmmss(r.at))}  ${k} ${p.bold(pad(r.chain, 12))} ${pad(r.where || '', 18)} ${(toneOf[r.tone] ?? ID)(tail ? pad(r.summary, sumW) : r.summary.length > sumW ? pad(r.summary, sumW) : r.summary)}${tail ? `  ${p.dim(tail)}` : ''}`;
}

/** The status footer. Pure. */
export function footer(s, p = streamPalette(false)) {
  const dot = s.state === 'live' ? p.green('●') : s.state === 'reconnecting' ? p.yellow('◌') : s.state === 'closed' ? p.red('■') : p.dim('○');
  const parts = [`${dot} ${s.state}`, `${(s.rate ?? 0).toFixed(1)}/s`, `${num(s.total ?? 0)} events`];
  if (s.seq != null) parts.push(`seq ${num(s.seq)}`);
  if (s.lag != null) parts.push(`lag ${num(s.lag)}`);
  if (s.idle != null && s.idle >= 5) parts.push(`quiet ${s.idle}s`);
  if (s.viewer) parts.push(s.viewer);
  return p.dim(parts.join(' · '));
}

/**
 * The live view. `out` is the stream rows go to; `tty` decides between the aligned, coloured view with a footer redrawn in place and
 * plain NDJSON. Returns { event(ev), state(s, viewer?), tick(), close() }; tick() once a second keeps the footer and the heartbeat.
 */
export function createStreamView({ out, tty, color, wide = false, json = false, now = () => Date.now(), width } = {}) {
  const p = streamPalette(!!(tty && color));
  const W = width ?? (out && out.columns) ?? 120;
  const times = []; let total = 0; let seq = null; let lag = null; let state = 'connecting'; let viewer = ''; let last = now(); let lastBeat = -Infinity;
  const live = tty && !json;
  const clear = () => { if (live) out.write('\r\u001b[2K'); };
  const drawFooter = () => {
    if (!live) return;
    const t = now(); while (times.length && t - times[0] > 10_000) times.shift();
    out.write(footer({ state, rate: times.length / 10, total, seq, lag, idle: Math.floor((t - last) / 1000), viewer }, p));
  };
  return {
    event(ev) {
      const t = now(); times.push(t); total++; last = t;
      const d = ev?.data && typeof ev.data === 'object' ? ev.data : {};
      if (typeof d.seq === 'number') seq = d.seq;
      if (d.lag && typeof d.lag.behind === 'number') lag = d.lag.behind;
      if (!live) { out.write(`${JSON.stringify({ event: ev.event, ...(ev.id ? { id: ev.id } : {}), data: ev.data })}\n`); return; }
      clear(); out.write(`${row(describe(ev, { wide }), p, { width: W })}\n`); drawFooter();
    },
    state(s, v) { state = s; if (v !== undefined) viewer = v; if (live) { clear(); drawFooter(); } },
    tick() {
      if (!live) return;
      const idle = Math.floor((now() - last) / 1000);
      if (idle >= 10 && now() - lastBeat >= 30_000) {
        lastBeat = now(); clear();
        out.write(`${p.dim(`${hhmmss(now())}  ·         ${state === 'live' ? 'connected — no new events for ' + idle + ' s; the pipe is quiet, still listening' : state}`)}\n`);
      }
      clear(); drawFooter();
    },
    close() { if (live) { clear(); drawFooter(); out.write('\n'); } },
    get total() { return total; },
    get seq() { return seq; },
  };
}
