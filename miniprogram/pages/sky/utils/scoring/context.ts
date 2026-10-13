export interface ScoreAdjustmentRange {
  min: number;
  max: number;
}

export interface ScoreAdjustment {
  /** 分数修正值，已限制在对应区间内 */
  delta: number;
  /** 面向用户的中文解释 */
  notes: string[];
}

export interface EvaluationContext {
  dateStr: string;
  sunriseTime: string; // "05:45"
  sunsetTime: string; // "18:20"
  /** 观测点海拔 (m)，缺失时保持 undefined，绝不退化成海平面 0 */
  elevation?: number;
  latitude: number;
  longitude: number;
  utcOffsetHours?: number;
  hourly: {
    time: string;
    hourIndex: number;
    hourNum: number;
    temp: number;
    humidity: number;
    dewPoint: number;
    precipProb: number;
    precip: number;
    code: number;
    cloudTotal: number;
    cloudLow: number;
    cloudMid: number;
    cloudHigh: number;
    visibilityKm: number;
    windSpeed: number;
    apparentTemp?: number;
    gusts?: number;
    pressureMsl?: number;
    temperature925?: number;
    temperature850?: number;
    temperature700?: number;
    relativeHumidity925?: number;
    relativeHumidity850?: number;
    relativeHumidity700?: number;
    cloud925?: number;
    cloud850?: number;
    cloud700?: number;
    convectiveCloudBase?: number;
    pm2_5?: number;
    aod?: number;
  }[];
}

export type HourSlice = EvaluationContext['hourly'][number];
