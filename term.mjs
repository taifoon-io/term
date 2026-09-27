// @taifoon/term — the step renderer shared by `taifoon up` and `jev run`.
//
// One file, no imports, no dependencies, and nothing happens at import time: every env read, TTY check and write
// is inside a function, so this file can be vendored as-is (a consumer copies it byte for byte and pins its sha256).
//
// The rhythm is the STUDIO terminal on taifoon.io:
//   → [1/5] readiness                                   step()    bold
//   ● GET coord.taifoon.dev/v1/agents/8453/95902/…      call()    before the read
//     ⎿ 200 · 612 ms                                    called()  after it
//   ✓ hireable · 8 ok · 2 missing · 640 ms              ok() / warn() / fail() / skip()   ✓ ! ✗ ·
//     the guide's line                                  say() / note()
//   → calibrated: POST /v1/pools/quote                  next()    and its command, indented, via cmd()
// Colour is on only for a TTY stream without NO_COLOR (FORCE_COLOR overrides both ways) and TERM != dumb.

export const GLYPH = Object.freeze({ ok: '✓', warn: '!', fail: '✗', skip: '·' });
export const SPIN = Object.freeze(['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']);
export const MARKS = Object.freeze(['ok', 'warn', 'fail', 'skip']);

const wrap = (open, close) => (s) => `\u001b[${open}m${s}\u001b[${close}m`;
const plain = (s) => String(s);

/** Whether to colour `stream`, from `env` (both read now, never at import). */
export function colorOn(stream, env) {
  const e = env || {};
  if (e.FORCE_COLOR !== undefined && e.FORCE_COLOR !== '') return e.FORCE_COLOR !== '0' && e.FORCE_COLOR !== 'false';
  if (e.NO_COLOR !== undefined && e.NO_COLOR !== '') return false;
  if (e.TERM === 'dumb') return false;
  return !!(stream && stream.isTTY === true);
}

/** The colour helpers (identity functions when `on` is false). */
export function palette(on) {
  if (!on) return { on: false, bold: plain, dim: plain, green: plain, yellow: plain, red: plain, cyan: plain };
  return { on: true, bold: wrap(1, 22), dim: wrap(2, 22), green: wrap(32, 39), yellow: wrap(33, 39), red: wrap(31, 39), cyan: wrap(36, 39) };
}

/** Remove ANSI colour codes (for tests and for widths). */
export const stripAnsi = (s) => String(s).replace(/\u001b\[[0-9;]*m/g, '');

// ── elapsed time ─────────────────────────────────────────────────────────────────────────────────────────────
/** Milliseconds since `t0` (`now` defaults to Date.now()). */
export const elapsed = (t0, now) => Math.max(0, Math.round((now === undefined ? Date.now() : now) - t0));
/** `640 ms` — the unit every line uses, as the STUDIO terminal prints it. */
export const fmtMs = (ms) => (typeof ms === 'number' && Number.isFinite(ms) ? `${Math.round(ms)} ms` : '— ms');
/** `42 s ago`, `3 min ago`, `2 h ago`, `1 d ago` — the age of a cached step. */
export function fmtAge(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

// ── lines (pure: they return a string without a newline) ─────────────────────────────────────────────────────
const P0 = palette(false);
const tone = (mark, p) => (mark === 'ok' ? p.green : mark === 'warn' ? p.yellow : mark === 'fail' ? p.red : p.dim);

export const stepLine = (n, of, title, p = P0) => p.bold(`→ [${n}/${of}] ${title}`);
export const headLine = (text, p = P0) => p.bold(`→ ${text}`);
export function callLine(method, url, body, p = P0) {
  return `● ${p.bold(method)} ${url}${body !== undefined ? ' ' + p.dim(JSON.stringify(body)) : ''}`;
}
export function calledLine(status, ms, error, p = P0) {
  const t = `⎿ ${status === null || status === undefined ? 'no answer' : status} · ${fmtMs(ms)}${error ? ` · ${error}` : ''}`;
  return '  ' + (error ? p.red(t) : p.dim(t));
}
/** `✓ text · 640 ms · extra` — `mark` is ok | warn | fail | skip. */
export function markLine(mark, text, o = {}, p = P0) {
  const g = GLYPH[mark] || GLYPH.skip;
  const tail = [o.ms !== undefined ? fmtMs(o.ms) : null, o.extra || null].filter(Boolean).join(' · ');
  const body = mark === 'fail' ? p.red(text) : mark === 'skip' ? p.dim(text) : text;
  return `${p.bold(tone(mark, p)(g))} ${body}${tail ? p.dim(` · ${tail}`) : ''}`;
}
export const noteLine = (text, p = P0) => `  ${p.dim(text)}`;
export const sayLine = (text) => `  ${text}`;
export const nextLine = (label, p = P0) => `${p.cyan('→')} ${label}`;
export const cmdLine = (cmd, p = P0) => String(cmd).split('\n').map((l) => `    ${p.dim('$')} ${l}`).join('\n');

// ── the writer ───────────────────────────────────────────────────────────────────────────────────────────────
/**
 * A terminal bound to a stream. Options (all optional; defaults are read when this is called):
 *   out    a writable with .write (default process.stdout)
 *   env    the environment for NO_COLOR / FORCE_COLOR / TERM (default process.env)
 *   color  force colour on or off
 *   quiet  write nothing (for --json runs); the line functions still return their text
 */
export function createTerm(o = {}) {
  const proc = typeof process !== 'undefined' ? process : null;
  const out = o.out || (proc && proc.stdout) || { write() {} };
  const env = o.env || (proc && proc.env) || {};
  const tty = !!out.isTTY;
  const p = palette(o.color === undefined ? colorOn(out, env) : !!o.color);
  const quiet = !!o.quiet;
  let live = null; // the running spinner, cleared before any other line
  const emit = (s) => {
    if (quiet) return s;
    if (live) live.clear();
    out.write(s + '\n');
    if (live) live.draw();
    return s;
  };
  const t = {
    color: p.on, tty, palette: p,
    line: (s = '') => emit(s),
    step: (n, of, title) => emit(stepLine(n, of, title, p)),
    head: (text) => emit(headLine(text, p)),
    call: (method, url, body) => emit(callLine(method, url, body, p)),
    called: (status, ms, error) => emit(calledLine(status, ms, error, p)),
    mark: (mark, text, x) => emit(markLine(mark, text, x, p)),
    ok: (text, x) => emit(markLine('ok', text, x, p)),
    warn: (text, x) => emit(markLine('warn', text, x, p)),
    fail: (text, x) => emit(markLine('fail', text, x, p)),
    skip: (text, x) => emit(markLine('skip', text, x, p)),
    note: (text) => emit(noteLine(text, p)),
    say: (text) => emit(sayLine(text)),
    next: (label) => emit(nextLine(label, p)),
    cmd: (cmd) => emit(cmdLine(cmd, p)),
    info: (text) => emit(p.dim(text)),
    /** one JSON value per line, written even when quiet (that is what --json prints) */
    json: (v) => { out.write(JSON.stringify(v) + '\n'); return v; },
    /** A spinner on its own line; animates only on a colour TTY. stop(line?) clears it and prints `line` if given. */
    spinner(text) {
      if (quiet || !tty || !p.on) return { update() {}, stop: (line) => (line ? emit(line) : undefined) };
      let f = 0; let label = text;
      const s = {
        draw: () => out.write(`${p.dim(SPIN[f % SPIN.length])} ${label}`),
        clear: () => out.write('\r\u001b[2K'),
      };
      live = s; s.draw();
      const timer = setInterval(() => { f++; s.clear(); s.draw(); }, 90);
      if (timer && typeof timer.unref === 'function') timer.unref();
      return {
        update(next) { label = next; },
        stop(line) { clearInterval(timer); s.clear(); if (live === s) live = null; return line ? emit(line) : undefined; },
      };
    },
  };
  return t;
}

// ── the default terminal: process.stdout, created on first use (never at import) ─────────────────────────────
let dflt = null;
const d = () => (dflt || (dflt = createTerm()));
export const step = (n, of, title) => d().step(n, of, title);
export const call = (method, url, body) => d().call(method, url, body);
export const called = (status, ms, error) => d().called(status, ms, error);
export const ok = (text, x) => d().ok(text, x);
export const warn = (text, x) => d().warn(text, x);
export const fail = (text, x) => d().fail(text, x);
export const skip = (text, x) => d().skip(text, x);
export const note = (text) => d().note(text);
export const next = (label) => d().next(label);
export const spinner = (text) => d().spinner(text);
