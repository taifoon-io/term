export interface StreamEvent { event: string; id?: string; data: unknown }
export interface StreamRow { at: number; kind: string; chain: string; where: string; summary: string; energy: string; value: string; state: string; tone: 'good' | 'bad' | 'warn' | 'info' | 'quiet' | 'plain'; seq: number | null }
export interface StreamPalette { on: boolean; bold(s: string): string; dim(s: string): string; green(s: string): string; yellow(s: string): string; red(s: string): string; cyan(s: string): string; magenta(s: string): string; blue(s: string): string; gray(s: string): string }
export interface StreamStatus { state: string; rate?: number; total?: number; seq?: number | null; lag?: number | null; idle?: number | null; viewer?: string }
export interface StreamView { event(ev: StreamEvent): void; state(s: string, viewer?: string): void; tick(): void; close(): void; readonly total: number; readonly seq: number | null }
export function streamPalette(on: boolean): StreamPalette;
export function chainName(c: unknown): string;
export function short(h: unknown, wide?: boolean): string;
export function describe(ev: StreamEvent, opts?: { wide?: boolean }): StreamRow;
export function row(r: StreamRow, p?: StreamPalette, opts?: { width?: number }): string;
export function footer(s: StreamStatus, p?: StreamPalette): string;
export function createStreamView(opts: { out: { write(s: string): unknown; columns?: number }; tty: boolean; color: boolean; wide?: boolean; json?: boolean; now?: () => number; width?: number }): StreamView;
export interface StreamFilters { kind: string[]; chain: string[]; venue: string[]; protocol: string[]; actor: string[] }
export function filtersOf(flags?: { kind?: string; kinds?: string; chain?: string; chains?: string; venue?: string; venues?: string; protocol?: string; actor?: string }): StreamFilters;
export function passes(ev: StreamEvent, filters: StreamFilters): boolean;
