export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function isFiniteNumber(value: number | undefined | null): value is number {
  return typeof value === 'number' && isFinite(value);
}

export function roundTo(value: number, digits: number): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

export function finiteValue(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && isFinite(value) ? value : undefined;
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function peakScore(scores: { score: number }[]): number {
  return scores.reduce((max, item) => Math.max(max, item.score), 0);
}
