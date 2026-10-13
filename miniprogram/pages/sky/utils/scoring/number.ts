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

/** Open-Meteo 无对流云时返回 -500 等哨兵，非正高度一律视为缺失，避免污染平均。 */
export function usableHeightMeters(value: number | null | undefined): number | undefined {
  const height = finiteValue(value);
  return height !== undefined && height > 0 ? height : undefined;
}
