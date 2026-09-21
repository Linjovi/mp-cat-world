export interface LocationItem {
  id: string;
  name: string;
  admin1?: string;
  admin2?: string;
  country?: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  isCustom?: boolean;
  category?: 'hangzhou' | 'zhejiang' | 'national' | 'custom' | 'mountain' | 'starry' | 'coastal' | 'city';
}

export interface HourlyWeatherData {
  time: string[];
  temperature_2m: number[];
  relative_humidity_2m: number[];
  dew_point_2m?: number[];
  apparent_temperature?: number[];
  precipitation_probability?: number[];
  precipitation?: number[];
  weather_code: number[];
  surface_pressure?: number[];
  cloud_cover: number[];
  cloud_cover_low: number[];
  cloud_cover_mid: number[];
  cloud_cover_high: number[];
  visibility: number[]; // meters
  wind_speed_10m: number[]; // km/h
  wind_direction_10m?: number[];
}

export interface DailyWeatherData {
  time: string[];
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  sunrise: string[];
  sunset: string[];
  daylight_duration?: number[];
  sunshine_duration?: number[];
  uv_index_max?: number[];
}

export interface WeatherApiResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: string;
  hourly: HourlyWeatherData;
  daily: DailyWeatherData;
}

export type PhenomenonType = 'travel_weather' | 'cloud_sea' | 'sunrise' | 'sunrise_glow' | 'sunset_glow' | 'starry_sky';

export type FactorStatus = 'optimal' | 'good' | 'moderate' | 'unfavorable';

export interface EvaluationFactor {
  name: string;
  value: string;
  status: FactorStatus;
  hint: string;
  weightLabel?: string;
}

export interface PhenomenonPrediction {
  id: PhenomenonType;
  title: string;
  subtitle: string;
  score: number; // 0 - 100
  level: 'excellent' | 'good' | 'moderate' | 'poor';
  levelLabel: string;
  levelBadgeColor: string;
  bestTimeWindow: string;
  bestTimeShort: string;
  countdownHint?: string;
  summary: string;
  factors: EvaluationFactor[];
  photographerTips: string;
  equipmentAdvice?: string;
  hourlyScores: {
    hour: string;
    displayHour: string;
    score: number;
    cloudCover: number;
    detail: string;
  }[];
}

export interface MoonInfo {
  phase: number; // 0.0 to 1.0
  phaseName: string;
  illuminationPct: number;
  isGoodForStargazing: boolean;
  moonDescription: string;
}

export interface DailyForecastEvaluation {
  date: string;
  dateLabel: string;
  dayOfWeek: string;
  weatherCode: number;
  weatherDesc: string;
  tempMax: number;
  tempMin: number;
  sunrise: string;
  sunset: string;
  moonInfo: MoonInfo;
  predictions: {
    travel_weather: PhenomenonPrediction;
    cloud_sea: PhenomenonPrediction;
    sunrise: PhenomenonPrediction;
    sunrise_glow: PhenomenonPrediction;
    sunset_glow: PhenomenonPrediction;
    starry_sky: PhenomenonPrediction;
  };
}
