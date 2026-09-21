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
  // Optional fields: the API omits whole arrays and may return null per hour
  wind_gusts_10m?: (number | null)[]; // km/h
  pressure_msl?: (number | null)[]; // hPa
  /**
   * Convective cloud base height in meters, null when there is no convective cloud.
   * Height datum is not documented by the API; consumers treat it as above mean sea
   * level (AMSL) without conversion and must state that assumption.
   */
  convective_cloud_base?: (number | null)[];
  temperature_925hPa?: (number | null)[]; // °C
  temperature_850hPa?: (number | null)[]; // °C
  // 700hPa (~3000m) keeps the profile usable for summits above the 925/850 levels
  temperature_700hPa?: (number | null)[]; // °C
  relative_humidity_925hPa?: (number | null)[]; // %
  relative_humidity_850hPa?: (number | null)[]; // %
  relative_humidity_700hPa?: (number | null)[]; // %
  cloud_cover_925hPa?: (number | null)[]; // %
  cloud_cover_850hPa?: (number | null)[]; // %
  cloud_cover_700hPa?: (number | null)[]; // %
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
  utc_offset_seconds?: number;
  hourly: HourlyWeatherData;
  daily: DailyWeatherData;
}

/** Open-Meteo Air Quality hourly payload (weak dependency, may be missing) */
export interface AirQualityHourlyData {
  time: string[];
  pm2_5?: (number | null)[]; // μg/m³
  pm10?: (number | null)[]; // μg/m³
  aerosol_optical_depth?: (number | null)[]; // 550nm, dimensionless
  us_aqi?: (number | null)[];
}

export interface AirQualityApiResponse {
  latitude: number;
  longitude: number;
  timezone?: string;
  utc_offset_seconds?: number;
  hourly: AirQualityHourlyData;
}

/** Combined loader result: weather is required, air quality degrades to null */
export interface SkyForecastBundle {
  weather: WeatherApiResponse;
  airQuality: AirQualityApiResponse | null;
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
