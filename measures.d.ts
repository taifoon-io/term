import type { Measures } from './stream';
export const BARS: string[];
export const RING_CAP: number;
export const SEVERITY: string[];
export function spark(values: (number | null)[]): string;
export function percentile(xs: number[], p: number): number | null;
export function worst(...xs: string[]): string;
export function createMeasures(opts?: { now?: () => number; cap?: number }): Measures;
