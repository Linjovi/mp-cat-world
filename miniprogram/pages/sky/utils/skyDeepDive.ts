import type { PhenomenonType } from '../types';

export interface SkyMetric {
  name: string;
  value: string;
}

export interface SkyLayer {
  title: string;
  pct: number;
  kind: 'high-cloud' | 'mid-cloud' | 'low-cloud' | 'precip' | 'humidity';
}

export interface SkyInsightMeta {
  title: string;
  subtitle: string;
}

export interface SkyHourSource {
  timeStr: string;
  fullTime: string;
  hourNum: number;
  temp: number;
  humidity: number;
  windSpeed: number;
  visibilityKm: number;
  cloudLow: number;
  cloudMid: number;
  cloudHigh: number;
  cloudTotal: number;
  precipProb: number;
  apparentTemp?: number;
  gusts?: number;
}

export interface SkyHourDeepDive extends SkyHourSource {
  metrics: SkyMetric[];
  layers: SkyLayer[];
  readout: string;
}

export function getSkyInsightMeta(tab: PhenomenonType): SkyInsightMeta {
  if (tab === 'travel_weather') {
    return {
      title: '24 小时体感与出行条件剖析',
      subtitle: '降水、体感温湿、风力与能见度逐时对照',
    };
  }
  if (tab === 'cloud_sea') {
    return {
      title: '24 小时立体分层云量深入剖析',
      subtitle: '低空逆温层、中高空云幕与通透度剖析',
    };
  }
  if (tab === 'sunrise' || tab === 'sunrise_glow') {
    return {
      title: '24 小时日出光路与通透度剖析',
      subtitle: '东向低云遮挡、总云量与晨间能见度',
    };
  }
  if (tab === 'sunset_glow') {
    return {
      title: '24 小时晚霞云幕与光路剖析',
      subtitle: '西向低云、中高云画布与空气通透度',
    };
  }
  return {
    title: '24 小时夜间通透度剖析',
    subtitle: '总云量、湿度结露与水平能见度',
  };
}

export function decorateSkyHour(tab: PhenomenonType, hour: SkyHourSource): SkyHourDeepDive {
  const metrics = metricsForTab(tab, hour);
  const layers = layersForTab(tab, hour);
  return {
    ...hour,
    metrics,
    layers,
    readout: readoutForTab(tab, hour),
  };
}

function metricsForTab(tab: PhenomenonType, hour: SkyHourSource): SkyMetric[] {
  if (tab === 'travel_weather') {
    const feels = Math.round(hour.apparentTemp ?? hour.temp);
    const wind =
      hour.gusts === undefined ? `${hour.windSpeed}km/h` : `${Math.round(hour.gusts)}km/h阵风`;
    return [
      { name: '体感', value: `${feels}°C` },
      { name: '降水概率', value: `${hour.precipProb}%` },
      { name: '风力', value: wind },
      { name: '能见度', value: `${hour.visibilityKm}km` },
      { name: '湿度', value: `${hour.humidity}%` },
    ];
  }
  if (tab === 'sunrise' || tab === 'sunrise_glow') {
    return [
      { name: '能见度', value: `${hour.visibilityKm}km` },
      { name: '东向低云', value: `${hour.cloudLow}%` },
      { name: '总云量', value: `${hour.cloudTotal}%` },
      { name: '湿度', value: `${hour.humidity}%` },
      { name: '降水概率', value: `${hour.precipProb}%` },
    ];
  }
  if (tab === 'sunset_glow') {
    const canvas = midHighCanvas(hour);
    return [
      { name: '能见度', value: `${hour.visibilityKm}km` },
      { name: '西向低云', value: `${hour.cloudLow}%` },
      { name: '中高云', value: `${canvas}%` },
      { name: '湿度', value: `${hour.humidity}%` },
      { name: '降水概率', value: `${hour.precipProb}%` },
    ];
  }
  if (tab === 'starry_sky') {
    return [
      { name: '总云量', value: `${hour.cloudTotal}%` },
      { name: '湿度', value: `${hour.humidity}%` },
      { name: '能见度', value: `${hour.visibilityKm}km` },
      { name: '风速', value: `${hour.windSpeed}km/h` },
      { name: '降水概率', value: `${hour.precipProb}%` },
    ];
  }
  return [
    { name: '气温', value: `${hour.temp}°C` },
    { name: '湿度', value: `${hour.humidity}%` },
    { name: '风速', value: `${hour.windSpeed}km/h` },
    { name: '能见度', value: `${hour.visibilityKm}km` },
    { name: '降水概率', value: `${hour.precipProb}%` },
  ];
}

function layersForTab(tab: PhenomenonType, hour: SkyHourSource): SkyLayer[] {
  if (tab === 'travel_weather') {
    return [
      { title: '降水概率', pct: hour.precipProb, kind: 'precip' },
      { title: '相对湿度', pct: hour.humidity, kind: 'humidity' },
    ];
  }
  if (tab === 'sunrise' || tab === 'sunrise_glow') {
    return [
      { title: '东向低云 (挡日轮)', pct: hour.cloudLow, kind: 'low-cloud' },
      { title: '总云量 (天空开阔度)', pct: hour.cloudTotal, kind: 'high-cloud' },
    ];
  }
  if (tab === 'sunset_glow') {
    return [
      { title: '西向低云 (挡光路)', pct: hour.cloudLow, kind: 'low-cloud' },
      { title: '中高云画布 (2000m+)', pct: midHighCanvas(hour), kind: 'mid-cloud' },
    ];
  }
  if (tab === 'starry_sky') {
    return [
      { title: '夜间总云量', pct: hour.cloudTotal, kind: 'high-cloud' },
      { title: '相对湿度 (结露)', pct: hour.humidity, kind: 'humidity' },
    ];
  }
  return [
    { title: '高空云 (>6000m)', pct: hour.cloudHigh, kind: 'high-cloud' },
    { title: '中空云 (2000-6000m)', pct: hour.cloudMid, kind: 'mid-cloud' },
    { title: '低空云 (0-2000m·云海层)', pct: hour.cloudLow, kind: 'low-cloud' },
  ];
}

function readoutForTab(tab: PhenomenonType, hour: SkyHourSource): string {
  if (tab === 'travel_weather') {
    const feels = Math.round(hour.apparentTemp ?? hour.temp);
    const wind =
      hour.gusts === undefined
        ? `风速 ${hour.windSpeed}km/h`
        : `阵风 ${Math.round(hour.gusts)}km/h`;
    return `体感 ${feels}℃，降水概率 ${hour.precipProb}%，${wind}，能见度 ${hour.visibilityKm}km。`;
  }
  if (tab === 'sunrise' || tab === 'sunrise_glow') {
    return `东向低云 ${hour.cloudLow}%，总云量 ${hour.cloudTotal}%，能见度 ${hour.visibilityKm}km。`;
  }
  if (tab === 'sunset_glow') {
    return `西向低云 ${hour.cloudLow}%，中高云画布 ${midHighCanvas(hour)}%，能见度 ${hour.visibilityKm}km。`;
  }
  if (tab === 'starry_sky') {
    return `总云量 ${hour.cloudTotal}%，湿度 ${hour.humidity}%，能见度 ${hour.visibilityKm}km。`;
  }
  return `低云 ${hour.cloudLow}%，湿度 ${hour.humidity}%，中高云 ${midHighCanvas(hour)}%，能见度 ${hour.visibilityKm}km。`;
}

function midHighCanvas(hour: SkyHourSource): number {
  return Math.round((hour.cloudMid + hour.cloudHigh) / 2);
}
