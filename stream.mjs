// @taifoon/term/stream — the live stream view shared by `taifoon stream` and `taifoon-sdk coord stream` (_STREAM_LIVE_v2_).
//
// Pure renderers plus one small view object. No dependencies, nothing at import time.
//   18:04:21  observe   base         across_v3        ⚑ taifoon ○  order Placed → Filled · tx 0x7021…(whole) · block 52,690,244     40 mGRID
//            ⌁ order across_v3:8453:6340240 · genome 0xc54c…(whole) · signed taifoon · 9 s producer → pipe
//   ● live   2.7/s  ▁▂▃▅▇█▆▃▂▁  162 events · seq 106,365 · GRID 0.11/s · signed 100% · lost 0% · public
// Ids and hashes are WHOLE by default (the envelope id and order key are what link a row to everything else); `short: true` is the
// opt-in. Each row carries its genome line (entity · order key · digest · signature · producer→pipe latency) and its masters: the
// owner record of every component it names (chain, protocol, venue, lane) with the seat's claim state. On a TTY the footer and the
// optional stats panel are redrawn in place without jitter (fixed-width fields, one draw per tick or event, resize-aware); off a TTY
// or with json: one JSON object per line.
import { createMeasures, spark, worst } from './measures.mjs';

// ── entitlements (_ELISION_RULE_v1_, owner 2026-10-16): what a viewer sees is driven by its key's purchases, not by a flag ──
// A key that bought the package (tier paid or plan on GET /v1/access/key) sees whole ids, the whole genome and, with its HPKE
// recipient key, sealed bodies opened. A public viewer or a free key sees ids and summaries elided ("…") with a hint naming the
// product — unless the event itself carries its payload (the pipe served it to this viewer: its own envelopes, a public signal).
// `--short` / `--wide` stay display preferences on top. The SDK mirrors this rule byte for byte (coord.entitlements.ELISION_RULE).
export const ELISION_RULE = 'entitled:key_tier_in(paid,plan)|event_payload_served|sealed_opened_with_hpke_key;unentitled:elide_ids_summaries+hint(taifoon.package GET /v1/access)';
export const PACKAGE_PRODUCT = { id: 'taifoon.package', name: 'the Taifoon package', buy: 'GET /v1/access' };
/** The entitlement of a viewer from the answer of GET /v1/access/key (null = keyless). Pure. */
export function entitlementOf(standing) {
  const keys = Array.isArray(standing?.keys) ? standing.keys : [];
  const bought = keys.find((k) => !k?.key?.revoked && !k?.key?.expired && (k?.tier === 'paid' || k?.tier === 'plan'));
  if (bought) return { entitled: true, via: `key ${bought.tier}${bought.plan?.name ? ` (${bought.plan.name})` : ''}`, product: PACKAGE_PRODUCT };
  return { entitled: false, via: keys.length ? 'free key' : 'public', product: PACKAGE_PRODUCT };
}
/** Did the pipe serve this event's payload to the viewer? Pure. */
export const payloadServed = (ev) => { const e = ev?.data?.envelope; return !!(e && typeof e.payload === 'string' && e.payload.length); };
/** Is this event shown elided for this viewer? Pure: the rule above. */
export const elided = (ev, ent) => !(ent?.entitled || payloadServed(ev));
/** The hint under an elided row. Pure. */
export const buyHint = (ent) => `… buy access: ${ent?.product?.name ?? PACKAGE_PRODUCT.name} (${ent?.product?.buy ?? PACKAGE_PRODUCT.buy}) — a key that bought it sees whole ids and bodies`;

const ESC = (open, close) => (s) => `\u001b[${open}m${s}\u001b[${close}m`;
const ID = (s) => String(s);

/** Colours for the view (identity when off). */
export function streamPalette(on) {
  if (!on) return { on: false, bold: ID, dim: ID, green: ID, yellow: ID, red: ID, cyan: ID, magenta: ID, blue: ID, gray: ID };
  return { on: true, bold: ESC(1, 22), dim: ESC(2, 22), green: ESC(32, 39), yellow: ESC(33, 39), red: ESC(31, 39), cyan: ESC(36, 39), magenta: ESC(35, 39), blue: ESC(34, 39), gray: ESC(90, 39) };
}

const CHAINS = { 0: 'taifoon', taifoon: 'taifoon', offchain: 'offchain', 25: 'cronos', 146: 'sonic', 250: 'fantom', 252: 'fraxtal', 324: 'zksync', 480: 'worldchain', 1088: 'metis', 1135: 'lisk', 1284: 'moonbeam', 1285: 'moonriver', 1329: 'sei', 2741: 'abstract', 5000: 'mantle', 8217: 'kaia', 34443: 'mode', 57073: 'ink', 59144: 'linea', 60808: 'bob', 80094: 'berachain', 81457: 'blast', 167000: 'taiko', 534352: 'scroll', 7777777: 'zora', 999: 'hyperevm', 1868: 'soneium', 11155111: 'sepolia', 84532: 'base-sepolia', 1: 'ethereum', 10: 'op', 56: 'bnb', 100: 'gnosis', 130: 'unichain', 137: 'polygon', 143: 'monad', 4663: 'robinhood', 5042: 'arc', 8453: 'base', 36927: 'taifoon-dev', 42161: 'arbitrum', 42170: 'arb-nova', 42220: 'celo', 43114: 'avalanche', 421614: 'arb-sepolia', 3692781: 'taifoon', 196: 'xlayer', 204: 'opbnb', 592: 'astar', 1101: 'polygon-zkevm', 1116: 'core', 1625: 'gravity', 2020: 'ronin', 8217: 'kaia', 42766: 'zkfair', 48900: 'zircuit', 55244: 'superposition', 200: 'solana' };

/** A chain id or `eip155:<id>` / `solana:…` as a short name. Pure. */
export function chainName(c) {
  if (c == null || c === '') return '—';
  const s = String(c);
  if (s.startsWith('solana')) return 'solana';
  const id = Number(s.replace(/^eip155:/, ''));
  if (CHAINS[s]) return CHAINS[s];
  return Number.isFinite(id) && CHAINS[id] ? CHAINS[id] : s.replace(/^eip155:/, '');
}
/** the numeric chain id of a chain field (`eip155:8453` → 8453; a name → null). Pure. */
export function chainIdOf(c) { const s = String(c ?? '').replace(/^eip155:/, ''); const n = Number(s); return Number.isFinite(n) && s !== '' ? n : null; }

/** An id as the view shows it: WHOLE by default; shortened to 0xabcd…ef12 only with `short`. A name is never cut. Pure. */
export function short(h, shorten = false) {
  const s = String(h ?? '');
  if (!shorten || s.length <= 14) return s;
  if (/^0x[0-9a-fA-F]+$/.test(s)) return `${s.slice(0, 6)}…${s.slice(-4)}`;
  return s;
}

const num = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : String(n));
const energyOf = (e) => { const mg = e?.economics?.energy?.milli_grid; return typeof mg === 'number' ? `${mg} mGRID` : ''; };
const gridOf = (e) => { const mg = e?.economics?.energy?.milli_grid; return typeof mg === 'number' ? mg : 0; };
const valueOf = (e) => { const v = e?.economics?.value; if (!v || v.amount == null) return ''; return `${v.amount} ${v.asset ?? ''}`.trim(); };
const join = (...xs) => xs.filter((x) => x !== '' && x != null && x !== false).join(' · ');

/**
 * One event → the row { at, kind, chain, where, summary, energy, value, state, tone, seq, ids, genome, components, latency, signed }.
 * Accepts the pipe stream's events (`/v1/pipe/stream`: event = kind, data = taifoon.pipe.event.v1) and the coord stream's lanes
 * (`/v1/stream`: job, action, flow, root, jev, pool, quota, hello). `short` cuts hashes; by default every id is whole. Pure.
 */
export function describe(ev, { short: sh = false, wide = false, elide = false } = {}) {
  const cut = (sh || elide) && !wide;
  const d = ev?.data && typeof ev.data === 'object' ? ev.data : {};
  const atMs = typeof d.at === 'number' ? (d.at > 1e12 ? d.at : d.at * 1000) : typeof d.ts === 'number' ? d.ts : Date.now();
  const kind = String(d.kind ?? ev?.event ?? 'message');
  const row = { at: atMs, kind, chain: '—', chainId: null, where: '', summary: '', energy: '', value: '', state: '', tone: 'plain', seq: typeof d.seq === 'number' ? d.seq : null,
    ids: {}, genome: null, components: [], latency: null, signed: null, grid: 0, lane: null, lost: false, elided: !!elide };
  const id = (h) => short(h, cut);
  if (d.envelope || d.observed || ['envelope', 'leaf', 'ack', 'batch', 'lost', 'dropped', 'lag', 'heartbeat'].includes(kind)) {
    const env = d.envelope ?? {};
    const ob = d.observed ?? null;
    row.energy = energyOf(env); row.value = valueOf(env); row.state = env.state ?? ''; row.grid = gridOf(env);
    row.signed = env.turbine ? (env.turbine.actor || 'signed') : env.id ? false : null;
    if (env.id) row.ids.envelope = env.id; if (env.order_key) row.ids.order_key = env.order_key; if (d.address) row.ids.address = d.address;
    if (kind === 'envelope' || (env.kind && kind !== 'leaf' && kind !== 'ack')) {
      row.kind = env.kind || kind;
      const venueIn = env.from?.venue; const venueOut = env.to?.venue;
      if (ob) {
        row.chainId = ob.chain_id || chainIdOf(env.from?.chain || env.to?.chain);
        row.chain = ob.chain_id ? chainName(ob.chain_id) : chainName(env.from?.chain || env.to?.chain); row.where = ob.protocol || ob.source || 'coord';
        // catalogue "observe:collect:<entity>:observe" names the entity; transition "protocol.<p>/<from>-><to>" the stage step
        const entity = typeof ob.catalogue === 'string' ? ob.catalogue.split(':')[2] || '' : '';
        const step = typeof ob.transition === 'string' && ob.transition.includes('/') ? ob.transition.split('/').pop().replace('->', ' → ').replace(/@.*$/, '') : ob.to;
        row.summary = join([entity, step].filter(Boolean).join(' '), ob.tx ? `tx ${id(ob.tx)}` : '', ob.block ? `block ${num(ob.block)}` : `key ${ob.key ?? '?'}`);
        row.tone = ob.completes ? 'good' : 'info';
        if (ob.tx) row.ids.tx = ob.tx;
        if (typeof ob.recorded_at === 'number' && typeof d.at === 'number') row.latency = Math.max(0, d.at - ob.recorded_at);
        row.genome = { entity: entity || 'record', key: env.order_key || ob.key || null, digest: env.payload_digest && !/^0x0+$/.test(env.payload_digest) ? env.payload_digest : null, stage: step || null, transition: ob.transition || null, catalogue: ob.catalogue || null, producer_leaf: ob.producer_leaf || null };
        row.components = [row.chainId != null ? `chain:${row.chainId}` : '', ob.protocol ? `protocol:${ob.protocol}` : '', ob.source && ob.source !== ob.protocol ? `protocol:${ob.source}` : ''].filter(Boolean);
      } else {
        row.chainId = chainIdOf(env.to?.chain || env.from?.chain);
        row.chain = chainName(env.to?.chain || env.from?.chain); row.where = `${venueIn || '?'} → ${venueOut || '?'}`;
        row.summary = join(env.state, env.to?.agent ? `to ${env.to.agent}` : '', env.id ? id(env.id) : '');
        row.tone = /dropped|refused|failed|expired/.test(env.state ?? '') ? 'bad' : /retried|leased/.test(env.state ?? '') ? 'warn' : /acked|delivered|included/.test(env.state ?? '') ? 'good' : 'info';
        if (env.sealed) row.summary += ' · sealed';
        row.genome = { entity: env.kind || 'envelope', key: env.order_key || null, digest: env.payload_digest && !/^0x0+$/.test(env.payload_digest) ? env.payload_digest : null, stage: env.state || null, transition: null, catalogue: null, producer_leaf: null, sealed: !!env.sealed };
        row.components = [row.chainId != null ? `chain:${row.chainId}` : '', venueIn ? `venue:${venueIn}` : '', venueOut && venueOut !== venueIn ? `venue:${venueOut}` : ''].filter(Boolean);
      }
    }
    if (kind === 'leaf' && d.leaf) { row.where = d.leaf.protocol || 'pipe'; row.summary = `${d.leaf.from_state} → ${d.leaf.to_state} · leaf ${id(d.leaf.leaf)}${d.leaf.batch != null ? ` · batch ${d.leaf.batch}` : ''}`; row.tone = 'quiet'; row.ids.leaf = d.leaf.leaf; row.components = ['protocol:taifoon_pipe']; }
    if (kind === 'ack' && d.ack) { row.where = d.ack.scheme || 'ack'; row.summary = `${id(d.ack.envelope_id)} by ${d.ack.by || '?'}${d.ack.verified ? ' ✓' : ''}`; row.tone = 'good'; row.ids.envelope = d.ack.envelope_id; row.signed = d.ack.verified ? d.ack.by || 'verified' : false; row.components = ['protocol:taifoon_pipe']; }
    if (kind === 'batch' && d.batch) { row.where = 'pipe'; row.summary = `batch ${num(d.batch.batch)} · ${d.batch.leaves} ${d.batch.leaves === 1 ? 'leaf' : 'leaves'} · root ${id(d.batch.root)}${d.batch.attested ? ' · attested' : ''}${d.batch.pushed ? ' · pushed' : ''}`; row.tone = 'info'; row.ids.root = d.batch.root; row.components = ['protocol:taifoon_pipe']; }
    if (kind === 'lost' && d.lost) { row.where = 'pipe'; row.chain = chainName((d.address || '').split('/')[2] || ''); row.summary = `${id(d.lost.envelope_id)} · ${d.lost.reason}${d.lost.will_retry ? ' · will retry' : ''}`; row.tone = 'warn'; row.ids.envelope = d.lost.envelope_id; row.lost = true; row.components = ['protocol:taifoon_pipe']; }
    if (kind === 'dropped' && d.dropped) { row.where = d.dropped.handler || ''; row.summary = `${id(d.dropped.envelope_id)} · ${d.dropped.reason}`; row.tone = 'bad'; row.ids.envelope = d.dropped.envelope_id; row.lost = true; row.components = ['protocol:taifoon_pipe']; }
    if (kind === 'lag' && d.lag) { row.summary = `${num(d.lag.behind)} behind${d.lag.dropped ? ' · the server cut this subscriber' : ''}`; row.tone = 'warn'; }
    row.lane = 'pipe';
    return row;
  }
  // the coord stream's lanes (/v1/stream): each event names its lane; its own `kind` says seed (the snapshot replayed on connect) or what it is
  const lane = String(d.lane ?? ev?.event ?? kind);
  row.kind = lane; row.lane = lane;
  const seed = d.kind === 'seed';
  const tx = (h) => (h ? `tx ${id(h)}` : '');
  if (d.tx) row.ids.tx = d.tx; if (d.addr) row.ids.address = d.addr; if (d.id && typeof d.id === 'string') row.ids.id = d.id;
  switch (lane) {
    case 'hello': row.summary = `lanes ${(d.lanes ?? []).join(', ')}`; row.tone = 'quiet'; break;
    case 'action':
      row.chainId = d.chain_id ?? null; row.chain = chainName(d.chain_id); row.where = d.entity || d.label || '';
      row.summary = d.message ? String(d.message).replace(/\s·\s+·/g, ' ·').replace(/tx 0x[0-9a-fA-F]{4,}…[0-9a-fA-F]{4}/, d.tx && !cut ? `tx ${d.tx}` : '$&') : join(d.label, d.action, tx(d.tx));
      row.tone = d.action === 'unrecognised' ? 'warn' : 'info';
      row.genome = { entity: d.entity || 'action', key: d.id || null, digest: null, stage: d.action || null, transition: null, catalogue: null, producer_leaf: null };
      row.components = [d.chain_id != null ? `chain:${d.chain_id}` : '', d.label ? `contract:${d.label}` : ''].filter(Boolean); break;
    case 'jev':
      row.chainId = d.chain_id ?? d.subject?.chainId ?? null; row.chain = chainName(row.chainId); row.where = 'jev';
      row.summary = join(d.action || d.kind, d.subject?.label, typeof d.confidence === 'number' ? `conf ${d.confidence.toFixed(2)}` : '', d.anchor?.status === 'ok' ? 'anchored' : d.anchor?.status, tx(d.tx || d.anchor?.tx));
      row.tone = 'good'; row.signed = d.anchor?.status === 'ok' ? 'anchored' : null;
      row.genome = { entity: 'verdict', key: d.subject?.ref || d.id || null, digest: d.digest || null, stage: d.action || d.kind || null, transition: null, catalogue: null, producer_leaf: null };
      row.components = [row.chainId != null ? `chain:${row.chainId}` : '', 'protocol:jev'].filter(Boolean); break;
    case 'job':
      row.chainId = d.chainId ?? d.chain_id ?? null; row.chain = chainName(row.chainId); row.where = d.venue || 'erc8183';
      row.summary = join(`job ${d.id ?? '?'}`, d.state, d.ending, d.seller ? `seller ${d.seller}` : '');
      row.tone = 'good';
      row.genome = { entity: 'job', key: d.id != null ? `${row.chainId}:${d.id}` : null, digest: null, stage: d.state || d.ending || null, transition: null, catalogue: null, producer_leaf: null };
      row.components = [row.chainId != null ? `chain:${row.chainId}` : '', `protocol:${d.venue || 'erc8183'}`].filter(Boolean); break;
    case 'pool':
      row.where = 'pool';
      row.summary = join(d.seller ? `seller ${d.seller}` : '', d.jobs != null ? `${num(d.settled ?? 0)}/${num(d.jobs)} settled` : '', d.cheated ? `${num(d.cheated)} cheated` : '', d.premium_label ? `premium ${d.premium_label}` : '', d.vault ? `vault ${d.vault}` : '');
      row.tone = d.cheated ? 'warn' : 'info';
      row.genome = { entity: 'pool', key: d.seller || null, digest: null, stage: d.vault ? 'vault' : 'record', transition: null, catalogue: null, producer_leaf: null };
      row.components = ['protocol:taifoon_assurance']; break;
    case 'root': {
      const step = /superroot:(\w+)/.exec(String(d.addr ?? ''))?.[1];
      row.chain = 'taifoon'; row.where = 'superroot';
      const root = d.root ? (d.root.startsWith('0x') ? d.root : `0x${d.root}`) : null;
      row.summary = join(step, root ? `root ${id(root)}` : '', d.leaf_count != null ? `${num(d.leaf_count)} leaves` : '', d.chains != null ? `${d.chains} chains` : '');
      row.tone = 'info'; if (root) row.ids.root = root;
      row.genome = { entity: 'superroot', key: d.at ? String(d.at) : null, digest: root, stage: step || null, transition: null, catalogue: null, producer_leaf: null };
      row.components = ['protocol:taifoon_coord']; break;
    }
    case 'flow':
      row.where = 'onboarding';
      row.summary = join(d.live != null ? `${num(d.live)} live flow${d.live === 1 ? '' : 's'}` : '', d.harvest_age_seconds != null ? `harvest ${num(d.harvest_age_seconds)} s old${d.stale ? ' (stale)' : ''}` : '', d.registry_records != null ? `${num(d.registry_records)} agents harvested` : '');
      row.tone = d.stale ? 'warn' : 'info'; row.components = ['protocol:erc8183']; break;
    case 'quota': {
      const f = d.grades?.free ?? d.free; const b = d.grades?.bought;
      row.where = 'quota';
      row.summary = join(f ? `free grades ${f.left}/${f.per_user ?? f.calls} left` : '', b ? `bought ${b.left}` : '', d.price?.grid_per_grade != null ? `${d.price.grid_per_grade} GRID a grade` : '', d.anon_today ? `anonymous today ${num(d.anon_today.used)}/${num(d.anon_today.cap)}` : '');
      row.tone = 'quiet'; row.components = ['protocol:jev']; break;
    }
    case 'header':
      row.chainId = d.chain_id ?? null; row.chain = chainName(d.chain_id); row.where = d.network_name || 'headers';
      row.summary = join(d.latest_block != null ? `height ${num(d.latest_block)}` : '', d.hash ? `hash ${id(d.hash)}` : d.mini_mmr_root ? `tree ${id(d.mini_mmr_root)}` : '', d.last_header_age_secs != null ? `age ${num(d.last_header_age_secs)} s` : '', d.rate_per_sec != null ? `${d.rate_per_sec.toFixed(2)} blk/s` : '', d.status && d.status !== 'collecting' ? d.status : '');
      row.tone = d.last_header_age_secs > 120 ? 'warn' : 'quiet';
      if (d.hash) row.ids.hash = d.hash; if (d.mini_mmr_root) row.ids.root = d.mini_mmr_root;
      row.components = [d.chain_id != null ? `chain:${d.chain_id}` : ''].filter(Boolean); break;
    default: {
      // a lane this view does not know yet: its scalar fields, named, never a JSON dump
      const parts = Object.entries(d).filter(([k, v]) => !['addr', 'lane', 'ts'].includes(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')).slice(0, 5)
        .map(([k, v]) => `${k} ${String(v).slice(0, 80)}`);
      row.summary = parts.join(' · ') || lane; row.tone = 'quiet';
    }
  }
  if (seed) { row.state = 'seed'; row.summary = `${row.summary} · snapshot`; row.tone = 'quiet'; }
  if (typeof d.ts === 'number') row.at = d.ts;
  if (!row.components.length && lane !== 'hello') row.components = [`lane:${lane}`];
  return row;
}

// ── masters: the owner record of every component a row names (_MASTERS_v1_) ─────────────────────────────────────────────
/** the records of GET /v1/owners (or register/ownership.json) as a map id → record; venues map onto protocol records. Pure. */
export function mastersOf(records) {
  const m = new Map();
  for (const r of records ?? []) { if (r?.id) m.set(String(r.id), r); }
  return m;
}
/** one component id → its master { id, holder, persona, state, claimable, shares, name } or null when the register has no record. Pure. */
export function masterOf(component, masters) {
  if (!masters || !component) return null;
  let r = masters.get(component);
  if (!r && component.startsWith('venue:')) r = masters.get(`protocol:${component.slice(6)}`) ?? masters.get(`product:${component.slice(6)}`);
  if (!r) return null;
  const state = r.seat?.state ?? (r.owner?.persona === 'operator' ? 'operator' : 'owned');
  return { id: r.id, name: r.name, holder: r.seat?.claimed_by || r.owner?.holder || '?', persona: r.owner?.persona ?? null, state, claimable: !!(r.seat?.delegable && r.seat.state === 'held_by_operator'), shares: r.shares ?? null, kind: r.kind };
}
const SEAT_GLYPH = { held_by_operator: '○', claimed: '●', ours: '◆', operator: '·', owned: '●' };
/** the master cell of a row: the first component with a record (chain, then protocol); "—" when none. Pure. */
export function masterCell(row, masters) {
  const found = row.components.map((c) => masterOf(c, masters)).filter(Boolean);
  const pick = found.find((m) => m.kind === 'protocol' || m.kind === 'product') ?? found[0];
  if (!pick) return { text: '—', tone: 'quiet', masters: found };
  return { text: `⚑ ${pick.holder} ${SEAT_GLYPH[pick.state] ?? '·'}`, tone: pick.claimable ? 'notice' : 'quiet', masters: found };
}

// ── filters (_STREAM_FILTERS_v1_): the client-side filters of `taifoon stream` and `taifoon-sdk coord stream` ─────────────
const list = (v) => (typeof v === 'string' && v ? v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : []);

/** The filters from the flags (each accepts a comma list). Pure. */
export function filtersOf(f = {}) {
  return {
    kind: [...list(f.kind), ...list(f.kinds)],
    chain: [...list(f.chain), ...list(f.chains)].map((c) => chainName(c).toLowerCase()),
    venue: [...list(f.venue), ...list(f.venues)],
    protocol: list(f.protocol),
    actor: list(f.actor),
  };
}

/** Does one event pass the filters? Pure; an empty filter passes everything. */
export function passes(ev, F) {
  const d = ev?.data && typeof ev.data === 'object' ? ev.data : {};
  const env = d.envelope ?? {}; const ob = d.observed ?? {};
  const kind = String(env.kind || d.kind || ev.event || '').toLowerCase();
  if (F.kind.length && !F.kind.includes(kind) && !F.kind.includes(String(ev.event).toLowerCase())) return false;
  const chain = chainName(ob.chain_id || env.from?.chain || env.to?.chain || d.chain_id || d.chainId || '').toLowerCase();
  if (F.chain.length && !F.chain.includes(chain)) return false;
  const venues = [env.from?.venue, env.to?.venue, ob.source, d.venue].filter(Boolean).map((s) => String(s).toLowerCase());
  if (F.venue.length && !F.venue.some((v) => venues.includes(v))) return false;
  const protocol = String(ob.protocol || d.leaf?.protocol || env.from?.venue || '').toLowerCase();
  if (F.protocol.length && !F.protocol.some((p) => protocol.includes(p))) return false;
  if (F.actor.length) {
    const hay = [env.from?.agent, env.to?.agent, env.from?.address, env.to?.address, d.address, d.actor, d.client, d.provider, d.seller, d.buyer].filter(Boolean).join(' ').toLowerCase();
    if (!F.actor.some((a) => hay.includes(a))) return false;
  }
  return true;
}

// ── rendering ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const pad = (s, n) => { const t = String(s); return t.length >= n ? `${t.slice(0, Math.max(0, n - 1))}…` : t + ' '.repeat(n - t.length); };
const padL = (s, n) => String(s).padStart(n);
const hhmmss = (ms) => { const d = new Date(ms); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':'); };
const TONE = (p) => ({ good: p.green, bad: p.red, warn: p.yellow, notice: p.yellow, info: p.cyan, quiet: p.dim, plain: ID });
const KIND_COLOUR = (p) => ({ observe: p.blue, envelope: p.cyan, settle: p.magenta, release: p.magenta, hire: p.cyan, ack: p.green, leaf: p.gray, batch: p.yellow, dropped: p.red, lost: p.yellow, job: p.green, action: p.blue, record: p.gray, jev: p.magenta, pool: p.green, root: p.blue, header: p.gray, advert: p.cyan });

/** One aligned row for a TTY (colour by kind/tone when the palette is on). Whole ids are never cut; only in `short` mode the summary
 *  is fitted to the width. Pure. */
export function row(r, p = streamPalette(false), { width = 120, masters = null, short: sh = false } = {}) {
  const toneOf = TONE(p);
  const k = (KIND_COLOUR(p)[r.kind] ?? p.bold)(pad(r.kind, 9));
  const tail = [r.energy, r.value].filter(Boolean).join(' · ');
  const m = masters ? masterCell(r, masters) : null;
  const mcol = m ? `${(toneOf[m.tone] ?? ID)(pad(m.text, 16))} ` : '';
  const fixed = 8 + 2 + 9 + 1 + 12 + 1 + 18 + 1 + (m ? 17 : 0) + (tail ? tail.length + 2 : 0);
  const sumW = Math.max(20, width - fixed);
  const summary = sh && r.summary.length > sumW ? pad(r.summary, sumW) : tail ? r.summary.padEnd(Math.max(0, sumW)) : r.summary;
  return `${p.dim(hhmmss(r.at))}  ${k} ${p.bold(pad(r.chain, 12))} ${pad(r.where || '', 18)} ${mcol}${(toneOf[r.tone] ?? ID)(summary)}${tail ? `  ${p.dim(tail)}` : ''}`;
}

/** The genome line under a row: entity · key · digest · signature · producer→pipe latency · masters. Pure; '' when nothing to say. */
export function genomeLine(r, p = streamPalette(false), { masters = null, short: sh = false, hint = '' } = {}) {
  const g = r.genome; if (!g && !Object.keys(r.ids).length && !hint) return '';
  const parts = [];
  if (r.opened) parts.push(`opened ${typeof r.opened === 'string' ? (r.opened.length > 120 ? r.opened.slice(0, 117) + '…' : r.opened) : JSON.stringify(r.opened).slice(0, 120)}`);
  if (g) {
    parts.push(`${g.entity}${g.key ? ` ${g.key}` : ''}`);
    if (g.digest) parts.push(`genome ${short(g.digest, sh)}`);
    if (g.stage && !r.summary.includes(g.stage)) parts.push(g.stage);
    if (g.sealed) parts.push('sealed');
  }
  if (r.ids.envelope && !(g?.key)) parts.push(`envelope ${short(r.ids.envelope, sh)}`);
  else if (r.ids.envelope && r.ids.envelope !== g?.digest) parts.push(`envelope ${short(r.ids.envelope, sh)}`);
  if (r.signed) parts.push(`signed ${r.signed === true ? '' : r.signed}`.trim()); else if (r.signed === false) parts.push('unsigned');
  if (r.latency != null) parts.push(`${num(r.latency)} s producer → pipe`);
  if (masters) {
    const ms = r.components.map((c) => [c, masterOf(c, masters)]).filter(([, m]) => m);
    if (ms.length) parts.push(ms.map(([c, m]) => `${c} → ${m.holder}${m.claimable ? ' (seat claimable)' : m.state === 'claimed' ? ' (claimed)' : m.state === 'ours' ? ' (ours)' : ''}`).join(', '));
  }
  if (hint) parts.push(hint);
  return parts.length ? p.dim(`          ⌁ ${parts.join(' · ')}`) : '';
}

/** The status footer: fixed-width fields so a redraw never jitters. Pure. */
export function footer(s, p = streamPalette(false)) {
  const dot = s.state === 'live' ? p.green('●') : s.state === 'reconnecting' ? p.yellow('◌') : s.state === 'closed' ? p.red('■') : p.dim('○');
  const parts = [`${dot} ${pad(s.state, 13)}`, `${padL((s.rate ?? 0).toFixed(1), 5)}/s`];
  if (s.spark) parts.push(s.spark);
  parts.push(`${padL(num(s.total ?? 0), 7)} events`);
  if (s.seq != null) parts.push(`seq ${num(s.seq)}`);
  if (s.grid != null) parts.push(`GRID ${s.grid.toFixed(2)}/s`);
  if (s.signed != null) parts.push(`signed ${Math.round(s.signed * 100)}%`);
  if (s.lost != null) parts.push(`lost ${Math.round(s.lost * 100)}%`);
  if (s.lag != null) parts.push(`lag ${num(s.lag)}`);
  if (s.idle != null && s.idle >= 5) parts.push(`quiet ${s.idle}s`);
  if (s.viewer) parts.push(s.viewer);
  return p.dim(parts.join(' · '));
}

/** The stats panel (--stats): rates per chain and per venue over 10 s / 1 min, GRID per second, p50/p95 latency, lag per lane. Pure. */
export function statsPanel(snap, p = streamPalette(false), { width = 120, rows = 6 } = {}) {
  const line = (s) => (s.length > width ? s.slice(0, width - 1) + '…' : s);
  const out = [];
  out.push(line(p.bold(`  measures  `) + p.dim(`${snap.rate10.toFixed(2)}/s over 10 s · ${snap.rate60.toFixed(2)}/s over 1 min · GRID ${snap.grid10.toFixed(2)}/s (${snap.grid60.toFixed(2)}/s over 1 min) · signed ${Math.round(snap.signed_share * 100)}% · lost/dropped ${Math.round(snap.lost_share * 100)}% · latency p50 ${snap.latency.p50 ?? '—'} s p95 ${snap.latency.p95 ?? '—'} s`)));
  const col = (title, a10, a60) => {
    const by60 = new Map(a60.map((x) => [x.key, x]));
    const head = `  ${pad(title, 18)}${padL('10 s', 8)}${padL('1 min', 8)}${padL('GRID/s', 9)}${padL('p50', 6)}${padL('p95', 6)}`;
    const lines = [p.dim(head)];
    for (const x of a60.slice(0, rows)) { const t = a10.find((y) => y.key === x.key); const sev = x.p95 != null && x.p95 > 120 ? 'warn' : 'ok'; const paint = sev === 'warn' ? p.yellow : ID;
      lines.push(paint(`  ${pad(x.key, 18)}${padL((t?.rate ?? 0).toFixed(2), 8)}${padL(x.rate.toFixed(2), 8)}${padL(x.grid_per_s.toFixed(2), 9)}${padL(x.p50 ?? '—', 6)}${padL(x.p95 ?? '—', 6)}`)); }
    void by60; return lines;
  };
  const chains = col('chain', snap.chains10, snap.chains60); const venues = col('venue / protocol', snap.venues10, snap.venues60);
  const n = Math.max(chains.length, venues.length); const half = Math.max(58, Math.floor(width / 2) - 1);
  for (let i = 0; i < n; i++) out.push(line(`${pad(chains[i] ?? '', half)}${venues[i] ?? ''}`.replace(/\s+$/, '')));
  if (snap.lanes.length) out.push(line(p.dim(`  lag  ${snap.lanes.map((l) => `${l.lane} ${num(l.behind)}`).join(' · ')}`)));
  return out;
}

/**
 * The live view. `out` is the stream rows go to; `tty` decides between the aligned, coloured view (rows, genome lines, a footer and
 * an optional stats panel redrawn in place) and plain NDJSON. Options: short (cut hashes; whole by default), genome (the genome line,
 * on by default), masters (a Map from mastersOf: the master column and the masters on the genome line), stats (the panel), width.
 * Returns { event(ev), header(h), state(s, viewer?), tick(), resize(w), close(), total, seq, measures, components }.
 */
export function createStreamView({ out, tty, color, short: sh = false, wide = false, genome = true, masters = null, stats = false, json = false, now = () => Date.now(), width, entitlement = null, opened = null } = {}) {
  const p = streamPalette(!!(tty && color));
  let W = width ?? (out && out.columns) ?? 120;
  const live = tty && !json;
  const m = createMeasures({ now });
  let total = 0; let seq = null; let lag = null; let state = 'connecting'; let viewer = ''; let last = now(); let lastBeat = -Infinity; let drawn = 0;
  const seen = new Map(); // component → count
  const shorten = sh && !wide;
  const eraseDrawn = () => { if (!live) return; if (drawn > 1) out.write(`\r\u001b[${drawn - 1}A`); out.write('\r\u001b[J'); drawn = 0; };
  const draw = () => {
    if (!live) return;
    const t = now(); const snap = m.snapshot();
    const lines = stats ? statsPanel(snap, p, { width: W }) : [];
    lines.push(footer({ state, rate: snap.rate10, spark: spark(snap.spark.slice(-12)), total, seq, grid: snap.grid10 / 1000, signed: total ? snap.signed_share : null, lost: total ? snap.lost_share : null, lag, idle: Math.floor((t - last) / 1000), viewer }, p));
    out.write(lines.join('\n')); drawn = lines.length;
  };
  const sample = (r) => {
    m.add({ at: now(), chain: r.chain !== '—' ? r.chain : null, venue: r.where && !r.where.includes('→') ? r.where : (r.where.split('→')[0] || '').trim() || null, lane: r.lane, kind: r.kind, grid: r.grid, signed: !!r.signed, latency: r.latency, lost: r.lost });
    for (const c of r.components) seen.set(c, (seen.get(c) ?? 0) + 1);
  };
  return {
    event(ev) {
      const t = now(); total++; last = t;
      const d = ev?.data && typeof ev.data === 'object' ? ev.data : {};
      if (typeof d.seq === 'number') seq = d.seq;
      if (d.lag && typeof d.lag.behind === 'number') { lag = d.lag.behind; m.lag(String(d.lane ?? 'pipe'), d.lag.behind); }
      const el = entitlement ? elided(ev, entitlement) : false;
      const r = describe(ev, { short: shorten || el, wide: wide && !el });
      if (opened && !el) { const o = opened(ev); if (o) r.opened = o; }
      sample(r);
      if (!live) { out.write(`${JSON.stringify({ event: ev.event, ...(ev.id ? { id: ev.id } : {}), data: ev.data, ...(genome && r.genome ? { genome: r.genome } : {}), ...(masters ? { masters: r.components.map((c) => masterOf(c, masters)).filter(Boolean) } : {}), ...(el ? { elided: true, buy: buyHint(entitlement) } : {}), ...(r.opened ? { opened: r.opened } : {}) })}\n`); return; }
      eraseDrawn();
      const g = genome ? genomeLine(r, p, { masters, short: shorten || el, hint: el ? buyHint(entitlement) : '' }) : '';
      out.write(`${row(r, p, { width: W, masters, short: shorten })}\n${g ? `${g}\n` : ''}`); draw();
    },
    /** a block header as collected (from GET /v1/root/chains or a producer): { chain_id, network_name, latest_block, hash?, mini_mmr_root, last_header_age_secs, rate_per_sec, status } */
    header(h) {
      const ev = { event: 'header', data: { ...h, lane: 'header', ts: now() } };
      if (!live) { out.write(`${JSON.stringify(ev)}\n`); return; }
      eraseDrawn(); out.write(`${row(describe(ev, { short: shorten }), p, { width: W, masters, short: shorten })}\n`); draw();
    },
    state(s, v) { state = s; if (v !== undefined) viewer = v; if (live) { eraseDrawn(); draw(); } },
    tick() {
      if (!live) return;
      const idle = Math.floor((now() - last) / 1000);
      // one line, at most every 5 minutes, only after a whole quiet minute: the footer already says "quiet Ns"
      if (idle >= 60 && now() - lastBeat >= 300_000) {
        lastBeat = now(); eraseDrawn();
        out.write(`${p.dim(`${hhmmss(now())}  ·         ${state === 'live' ? `connected, no new events for ${idle} s; still listening` : state}`)}\n`);
      }
      eraseDrawn(); draw();
    },
    resize(w) { W = w || (out && out.columns) || W; if (live) { eraseDrawn(); draw(); } },
    close() { if (live) { eraseDrawn(); draw(); out.write('\n'); } },
    get total() { return total; },
    get seq() { return seq; },
    get measures() { return m; },
    /** the components the stream named, with counts and masters: the --masters table */
    components() { return [...seen.entries()].map(([c, n]) => ({ component: c, events: n, master: masterOf(c, masters) })).sort((a, b) => b.events - a.events); },
  };
}

/** The --masters table: components × master × claim state. Pure. */
export function mastersTable(components, p = streamPalette(false)) {
  const lines = [p.bold(`  ${pad('component', 32)}${pad('events', 8)}${pad('master', 16)}${pad('seat', 30)}${pad('shares', 26)}`)];
  for (const c of components) {
    const m = c.master;
    const seat = !m ? 'no record' : m.claimable ? 'held by operator · claimable' : m.state === 'claimed' ? `claimed by ${m.holder}` : m.state === 'ours' ? 'ours' : m.state === 'held_by_operator' ? 'held by operator' : m.persona ?? '—';
    const shares = m?.shares ? `owner ${(m.shares.owner_bps / 100).toFixed(0)}% · taifoon ${(m.shares.taifoon_bps / 100).toFixed(0)}%` : '';
    const paint = !m ? p.dim : m.claimable ? p.yellow : ID;
    lines.push(paint(`  ${pad(c.component, 32)}${pad(String(c.events), 8)}${pad(m?.holder ?? '—', 16)}${pad(seat, 30)}${pad(shares, 26)}`));
  }
  return lines;
}
export { spark, worst };
