/** 页面展示用经纬度，保留两位小数；计算与请求仍使用原始数值。 */
export function formatCoordinateDisplay(value: number): string {
  if (!Number.isFinite(value)) return '';
  return value.toFixed(2);
}

export function withCoordinateDisplay<T extends { latitude: number; longitude: number }>(
  loc: T
): T & { latitudeDisplay: string; longitudeDisplay: string } {
  return {
    ...loc,
    latitudeDisplay: formatCoordinateDisplay(loc.latitude),
    longitudeDisplay: formatCoordinateDisplay(loc.longitude),
  };
}
