export interface StreamEvent { event: string; id?: string; data: unknown }
export interface Genome { entity: string; key: string | null; digest: string | null; stage: string | null; transition: string | null; catalogue: string | null; producer_leaf: string | null; sealed?: boolean }
export interface StreamRow { at: number; kind: string; chain: string; chainId: number | null; where: string; summary: string; energy: string; value: string; state: string; tone: 'good' | 'bad' | 'warn' | 'notice' | 'info' | 'quiet' | 'plain'; seq: number | null; ids: Record<string, string>; genome: Genome | null; components: string[]; latency: number | null; signed: string | boolean | null; grid: number; lane: string | null; lost: boolean; elided: boolean; opened?: unknown }
export interface StreamPalette { on: boolean; bold(s: string): string; dim(s: string): string; green(s: string): string; yellow(s: string): string; red(s: string): string; cyan(s: string): string; magenta(s: string): string; blue(s: string): string; gray(s: string): string }
export interface StreamStatus { state: string; rate?: number; spark?: string; total?: number; seq?: number | null; grid?: number | null; signed?: number | null; lost?: number | null; lag?: number | null; idle?: number | null; viewer?: string }
export interface Master { id: string; name: string; holder: string; persona: string | null; state: string; claimable: boolean; shares: { owner_bps: number; partner: string | null; partner_bps: number; taifoon_bps: number } | null; kind: string }
export interface Entitlement { entitled: boolean; via: string; product: { id: string; name: string; buy: string } }
export interface Snapshot { total: number; rate10: number; rate60: number; grid10: number; grid60: number; signed_share: number; lost_share: number; chains10: Group[]; chains60: Group[]; venues10: Group[]; venues60: Group[]; lanes: { lane: string; behind: number }[]; spark: number[]; peak: number; latency: { p50: number | null; p95: number | null } }
export interface Group { key: string; rate: number; grid_per_s: number; p50: number | null; p95: number | null }
export interface Measures { add(s: { at?: number; chain?: string | null; venue?: string | null; lane?: string | null; kind?: string; grid?: number; signed?: boolean; latency?: number | null; lost?: boolean }): void; lag(lane: string, behind: number): void; snapshot(): Snapshot; readonly size: number }
export interface StreamView { event(ev: StreamEvent): void; header(h: Record<string, unknown>): void; state(s: string, viewer?: string): void; tick(): void; resize(w?: number): void; close(): void; readonly total: number; readonly seq: number | null; readonly measures: Measures; components(): { component: string; events: number; master: Master | null }[] }
export const ELISION_RULE: string;
export const PACKAGE_PRODUCT: { id: string; name: string; buy: string };
export function entitlementOf(standing: unknown): Entitlement;
export function payloadServed(ev: StreamEvent): boolean;
export function elided(ev: StreamEvent, ent: Entitlement | null): boolean;
export function buyHint(ent: Entitlement | null): string;
export function streamPalette(on: boolean): StreamPalette;
export function chainName(c: unknown): string;
export function chainIdOf(c: unknown): number | null;
export function short(h: unknown, shorten?: boolean): string;
export function describe(ev: StreamEvent, opts?: { short?: boolean; wide?: boolean; elide?: boolean }): StreamRow;
export function mastersOf(records: unknown[]): Map<string, unknown>;
export function masterOf(component: string, masters: Map<string, unknown> | null): Master | null;
export function masterCell(row: StreamRow, masters: Map<string, unknown>): { text: string; tone: string; masters: Master[] };
export function row(r: StreamRow, p?: StreamPalette, opts?: { width?: number; masters?: Map<string, unknown> | null; short?: boolean }): string;
export function genomeLine(r: StreamRow, p?: StreamPalette, opts?: { masters?: Map<string, unknown> | null; short?: boolean; hint?: string }): string;
export function footer(s: StreamStatus, p?: StreamPalette): string;
export function statsPanel(snap: Snapshot, p?: StreamPalette, opts?: { width?: number; rows?: number }): string[];
export function mastersTable(components: { component: string; events: number; master: Master | null }[], p?: StreamPalette): string[];
export function filtersOf(flags?: Record<string, unknown>): { kind: string[]; chain: string[]; venue: string[]; protocol: string[]; actor: string[] };
export function passes(ev: StreamEvent, filters: ReturnType<typeof filtersOf>): boolean;
export function spark(values: (number | null)[]): string;
export function createStreamView(opts: { out: { write(s: string): unknown; columns?: number }; tty: boolean; color: boolean; short?: boolean; wide?: boolean; genome?: boolean; masters?: Map<string, unknown> | null; stats?: boolean; json?: boolean; now?: () => number; width?: number; entitlement?: Entitlement | null; opened?: ((ev: StreamEvent) => unknown) | null }): StreamView;
