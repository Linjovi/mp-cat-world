import type {
  AirQualityApiResponse,
  HourlyWeatherData,
  DailyForecastEvaluation,
  WeatherApiResponse,
} from '../types';
import { calculateMoonInfo, formatHourTime } from './astronomy';
import type { EvaluationContext } from './scoring/context';
import { evaluateCloudSea } from './scoring/cloudSea';
import { finiteValue } from './scoring/number';
import { evaluateStarrySky } from './scoring/starrySky';
import { evaluateSunrise } from './scoring/sunrise';
import { evaluateSunsetGlow } from './scoring/sunsetGlow';
import { evaluateTravelWeather } from './scoring/travelWeather';

export { cloudSeaCoverageCeiling } from './scoring/cloudSea';
export { evaluateTravelWeather } from './scoring/travelWeather';

/** 兼容旧名：日出评分即朝霞评分。 */
export const evaluateSunriseGlow = evaluateSunrise;

export interface AlignedAirQualityHour {
  pm2_5: number | undefined;
  aod: number | undefined;
}

/** AQ 与天气只按完全相同的本地 ISO 小时对齐，不做最近邻猜测。 */
export function alignAirQualityToWeatherHours(
  weatherTimes: string[],
  airQuality?: AirQualityApiResponse | null
): AlignedAirQualityHour[] {
  const indexByTime = new Map<string, number>();
  if (airQuality && airQuality.hourly && Array.isArray(airQuality.hourly.time)) {
    airQuality.hourly.time.forEach((time, index) => {
      if (!indexByTime.has(time)) indexByTime.set(time, index);
    });
  }

  return weatherTimes.map((time) => {
    const index = indexByTime.get(time);
    if (index === undefined || !airQuality) {
      return { pm2_5: undefined, aod: undefined };
    }
    return {
      pm2_5: finiteValue(airQuality.hourly.pm2_5?.[index]),
      aod: finiteValue(airQuality.hourly.aerosol_optical_depth?.[index]),
    };
  });
}

// Weather code description dictionary (WMO codes)
export function getWeatherCodeInfo(code: number): { desc: string; icon: string } {
  if (code === 0) return { desc: '晴空万里', icon: 'Sun' };
  if (code === 1) return { desc: '大部分晴朗', icon: 'SunMedium' };
  if (code === 2) return { desc: '局部多云', icon: 'CloudSun' };
  if (code === 3) return { desc: '阴天', icon: 'Cloud' };
  if (code >= 45 && code <= 48) return { desc: '有雾/雾气升腾', icon: 'CloudFog' };
  if (code >= 51 && code <= 55) return { desc: '毛毛细雨', icon: 'CloudDrizzle' };
  if (code >= 61 && code <= 65) return { desc: '雨天', icon: 'CloudRain' };
  if (code >= 71 && code <= 77) return { desc: '雪天', icon: 'CloudSnow' };
  if (code >= 80 && code <= 82) return { desc: '阵雨', icon: 'CloudRain' };
  if (code >= 95) return { desc: '雷阵雨', icon: 'CloudLightning' };
  return { desc: '多云', icon: 'Cloud' };
}

/**
 * Filter hourly data for a single day (00:00 to 23:00)
 */
function extractDayHours(
  hourly: HourlyWeatherData,
  targetDate: string,
  alignedAirQuality: AlignedAirQualityHour[]
): EvaluationContext['hourly'] {
  const result: EvaluationContext['hourly'] = [];
  for (let i = 0; i < hourly.time.length; i++) {
    const t = hourly.time[i];
    if (t.startsWith(targetDate)) {
      const hourNum = parseInt(t.substring(11, 13), 10);
      result.push({
        time: t,
        hourIndex: i,
        hourNum,
        temp: hourly.temperature_2m[i] ?? 15,
        humidity: hourly.relative_humidity_2m[i] ?? 60,
        dewPoint: hourly.dew_point_2m ? hourly.dew_point_2m[i] ?? 10 : (hourly.temperature_2m[i] - 3),
        precipProb: hourly.precipitation_probability ? hourly.precipitation_probability[i] ?? 0 : 0,
        precip: hourly.precipitation ? hourly.precipitation[i] ?? 0 : 0,
        code: hourly.weather_code[i] ?? 0,
        cloudTotal: hourly.cloud_cover[i] ?? 0,
        cloudLow: hourly.cloud_cover_low[i] ?? 0,
        cloudMid: hourly.cloud_cover_mid[i] ?? 0,
        cloudHigh: hourly.cloud_cover_high[i] ?? 0,
        visibilityKm: Math.round((hourly.visibility[i] ?? 10000) / 1000),
        windSpeed: Math.round(hourly.wind_speed_10m[i] ?? 8),
        apparentTemp: finiteValue(hourly.apparent_temperature?.[i]),
        gusts: finiteValue(hourly.wind_gusts_10m?.[i]),
        pressureMsl: finiteValue(hourly.pressure_msl?.[i]),
        temperature925: finiteValue(hourly.temperature_925hPa?.[i]),
        temperature850: finiteValue(hourly.temperature_850hPa?.[i]),
        temperature700: finiteValue(hourly.temperature_700hPa?.[i]),
        relativeHumidity925: finiteValue(hourly.relative_humidity_925hPa?.[i]),
        relativeHumidity850: finiteValue(hourly.relative_humidity_850hPa?.[i]),
        relativeHumidity700: finiteValue(hourly.relative_humidity_700hPa?.[i]),
        pm2_5: alignedAirQuality[i]?.pm2_5,
        aod: alignedAirQuality[i]?.aod,
      });
    }
  }
  return result;
}

/**
 * Main evaluation orchestrator for 7-day forecast
 */
export function evaluateForecast(
  apiData: WeatherApiResponse,
  airQuality?: AirQualityApiResponse | null
): DailyForecastEvaluation[] {
  const result: DailyForecastEvaluation[] = [];
  const daily = apiData.daily;
  if (!daily || !daily.time) return result;
  const alignedAirQuality = alignAirQualityToWeatherHours(apiData.hourly.time, airQuality);

  for (let i = 0; i < daily.time.length; i++) {
    const dateStr = daily.time[i];
    const dateObj = new Date(dateStr + 'T00:00:00');

    // Day of week in Chinese
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const dayOfWeek = days[dateObj.getDay()];

    // Today / Tomorrow label
    const todayStr = new Date().toISOString().split('T')[0];
    let dateLabel = `${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
    if (dateStr === todayStr) {
      dateLabel = '今天';
    }

    const sunriseIso = daily.sunrise ? daily.sunrise[i] : '';
    const sunsetIso = daily.sunset ? daily.sunset[i] : '';
    const sunriseHHMM = formatHourTime(sunriseIso);
    const sunsetHHMM = formatHourTime(sunsetIso);

    const dayHours = extractDayHours(apiData.hourly, dateStr, alignedAirQuality);

    const ctx: EvaluationContext = {
      dateStr,
      sunriseTime: sunriseHHMM,
      sunsetTime: sunsetHHMM,
      elevation: finiteValue(apiData.elevation),
      latitude: apiData.latitude,
      longitude: apiData.longitude,
      utcOffsetHours:
        apiData.utc_offset_seconds === undefined
          ? airQuality?.utc_offset_seconds === undefined
            ? undefined
            : airQuality.utc_offset_seconds / 3600
          : apiData.utc_offset_seconds / 3600,
      hourly: dayHours,
    };

    const tempMax = Math.round(daily.temperature_2m_max[i] ?? 20);
    const tempMin = Math.round(daily.temperature_2m_min[i] ?? 12);
    const uvMax = daily.uv_index_max ? daily.uv_index_max[i] : undefined;

    const travelWeatherPred = evaluateTravelWeather(ctx, tempMax, tempMin, uvMax);
    const cloudSeaPred = evaluateCloudSea(ctx);
    const sunrisePred = evaluateSunrise(ctx);
    const sunsetGlowPred = evaluateSunsetGlow(ctx);
    const starrySkyPred = evaluateStarrySky(ctx);

    const weatherCode = daily.weather_code ? daily.weather_code[i] : 0;
    const weatherInfo = getWeatherCodeInfo(weatherCode);

    result.push({
      date: dateStr,
      dateLabel,
      dayOfWeek,
      weatherCode,
      weatherDesc: weatherInfo.desc,
      tempMax,
      tempMin,
      sunrise: sunriseHHMM,
      sunset: sunsetHHMM,
      moonInfo: calculateMoonInfo(dateStr),
      predictions: {
        travel_weather: travelWeatherPred,
        cloud_sea: cloudSeaPred,
        sunrise: sunrisePred,
        sunrise_glow: sunrisePred,
        sunset_glow: sunsetGlowPred,
        starry_sky: starrySkyPred,
      },
    });
  }

  return result;
}
