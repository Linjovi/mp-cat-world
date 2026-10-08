import type {
  AirQualityApiResponse,
  HourlyWeatherData,
  DailyForecastEvaluation,
  PhenomenonPrediction,
  EvaluationFactor,
  WeatherApiResponse,
} from '../types';
import { calculateMoonInfo, formatHourTime, shiftTimeString } from './astronomy';
import {
  evaluateCloudSeaVerticalAdjustment,
  evaluateHikingComfortAdjustment,
  evaluateMoonlightImpact,
  evaluateSunsetAerosolAdjustment,
} from './scoringEnhancements';

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function describeHikingHour(
  h: {
    hourNum: number;
    precip: number;
    precipProb: number;
    temp: number;
    apparentTemp?: number;
    windSpeed: number;
    gusts?: number;
  },
  score: number
): string {
  if (h.hourNum < 6 || h.hourNum > 19) return '夜间步道视线差，不建议徒步';
  if (h.precip > 2 || h.precipProb > 70) return '降雨风险高，步道易湿滑';
  if (h.precip > 0.5 || h.precipProb > 50) return '可能遇雨，出行宜带雨具';
  const feels = h.apparentTemp ?? h.temp;
  if (h.hourNum >= 11 && h.hourNum <= 14 && feels >= 31) return '正午热负荷高，宜缩短行程';
  if (feels <= 6) return '体感偏冷，注意保暖防滑';
  if (h.windSpeed > 30 || (h.gusts ?? 0) > 40) return '山脊风力偏大，注意防风';
  if (score >= 75) return '体感舒适，适合出行';
  if (score >= 55) return '条件尚可，酌情安排行程';
  return '气象偏弱，建议缩短或改期';
}

function finiteValue(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && isFinite(value) ? value : undefined;
}

/** Open-Meteo 无对流云时返回 -500 等哨兵，非正高度一律视为缺失，避免污染平均。 */
export function usableHeightMeters(value: number | null | undefined): number | undefined {
  const height = finiteValue(value);
  return height !== undefined && height > 0 ? height : undefined;
}

function averageFinite(values: (number | null | undefined)[]): number | undefined {
  const finite = values.filter(
    (value): value is number => typeof value === 'number' && isFinite(value)
  );
  if (finite.length === 0) return undefined;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function peakScore(scores: { score: number }[]): number {
  return scores.reduce((max, item) => Math.max(max, item.score), 0);
}

/**
 * 低云是云海的硬条件：铺不满山谷就不能拿满分。
 * 50% 只是局地碎云/谷雾，上限约 60；80–95% 才允许到 100。
 */
export function cloudSeaCoverageCeiling(cloudLow: number): number {
  if (cloudLow >= 80 && cloudLow <= 95) return 100;
  if (cloudLow >= 70) return 88;
  if (cloudLow >= 65) return 80;
  if (cloudLow >= 55) return 72;
  if (cloudLow >= 45) return 60;
  if (cloudLow >= 25) return 45;
  return 28;
}

type HourSlice = EvaluationContext['hourly'][number];

/** 气压层湿度和云量只做小幅修正，避免和地面湿度、低云重复计太高。 */
function boundaryLayerMoisture(h: HourSlice): { delta: number; note: string } {
  const rh = h.relativeHumidity925 ?? h.relativeHumidity850 ?? h.relativeHumidity700;
  const cloud = h.cloud925 ?? h.cloud850 ?? h.cloud700;
  if (rh === undefined && cloud === undefined) {
    return { delta: 0, note: '气压层湿度与云量数据缺失' };
  }
  let delta = 0;
  const notes: string[] = [];
  if (rh === undefined) {
    notes.push('气压层湿度数据缺失');
  } else if (rh >= 90) {
    delta += 3;
    notes.push(`气压层湿度 ${Math.round(rh)}%，低层水汽充足`);
  } else if (rh >= 70) {
    delta += 1;
    notes.push(`气压层湿度 ${Math.round(rh)}%`);
  } else if (rh < 45) {
    delta -= 3;
    notes.push(`气压层湿度仅 ${Math.round(rh)}%，水汽偏干`);
  } else {
    notes.push(`气压层湿度 ${Math.round(rh)}%`);
  }
  if (cloud === undefined) {
    notes.push('气压层云量数据缺失');
  } else if (cloud >= 70) {
    delta += 2;
    notes.push(`气压层云量 ${Math.round(cloud)}%，云层有厚度`);
  } else if (cloud < 20) {
    delta -= 1;
    notes.push(`气压层云量 ${Math.round(cloud)}%，云层偏薄`);
  } else {
    notes.push(`气压层云量 ${Math.round(cloud)}%`);
  }
  return { delta: Math.max(-4, Math.min(4, delta)), note: notes.join('；') };
}

/** 灰霾只扣分：日轮锐度和星空通透度都怕高 PM2.5 / 高 AOD，不像晚霞那样吃适度散射。 */
function hazePenalty(pm2_5?: number, aod?: number): { delta: number; notes: string[] } {
  if (pm2_5 === undefined && aod === undefined) {
    return { delta: 0, notes: ['空气质量数据暂缺，未做通透修正'] };
  }
  let delta = 0;
  const notes: string[] = [];
  if (pm2_5 !== undefined) {
    if (pm2_5 <= 35) notes.push(`PM2.5 ${Math.round(pm2_5)}，空气较干净`);
    else if (pm2_5 <= 75) {
      delta -= 3;
      notes.push(`PM2.5 ${Math.round(pm2_5)}，轻度灰霾`);
    } else if (pm2_5 <= 115) {
      delta -= 6;
      notes.push(`PM2.5 ${Math.round(pm2_5)}，中度污染，轮廓发软`);
    } else {
      delta -= 10;
      notes.push(`PM2.5 ${Math.round(pm2_5)}，重度灰霾`);
    }
  }
  if (aod !== undefined) {
    if (aod <= 0.35) notes.push(`AOD ${aod.toFixed(2)}，对通透度影响有限`);
    else if (aod <= 0.8) {
      delta -= 4;
      notes.push(`AOD ${aod.toFixed(2)}，低空发蒙`);
    } else {
      delta -= 8;
      notes.push(`AOD ${aod.toFixed(2)}，灰霾明显`);
    }
  }
  return { delta: Math.max(-12, delta), notes };
}

/** 徒步时段的日照负荷：夜间为 0；云量会削弱当日紫外线，避免阴天仍按晴空暴晒扣分。 */
function hikingDaylightUvScore(hourNum: number, uv: number, cloudTotal: number): number {
  if (hourNum < 6 || hourNum > 19) return 0;
  let daylight = 0.85;
  if (hourNum <= 6 || hourNum >= 19) daylight = 0.45;
  else if (hourNum <= 7 || hourNum >= 18) daylight = 0.7;
  else if (hourNum >= 10 && hourNum <= 15) daylight = 1;
  const shade = Math.min(1, Math.max(0, cloudTotal) / 100);
  const effectiveUv = Math.max(0, uv) * (1 - 0.7 * shade) * daylight;
  let points = 8;
  if (effectiveUv <= 2) points = 15;
  else if (effectiveUv <= 4) points = 12;
  else if (effectiveUv <= 6) points = 8;
  else if (effectiveUv <= 8) points = 4;
  else points = 0;
  if (daylight < 1) points = Math.min(points, Math.round(15 * daylight));
  return points;
}

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

interface EvaluationContext {
  dateStr: string;
  sunriseTime: string; // "05:45"
  sunsetTime: string;  // "18:20"
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
        cloud925: finiteValue(hourly.cloud_cover_925hPa?.[i]),
        cloud850: finiteValue(hourly.cloud_cover_850hPa?.[i]),
        cloud700: finiteValue(hourly.cloud_cover_700hPa?.[i]),
        convectiveCloudBase: usableHeightMeters(hourly.convective_cloud_base?.[i]),
        pm2_5: alignedAirQuality[i]?.pm2_5,
        aod: alignedAirQuality[i]?.aod,
      });
    }
  }
  return result;
}

/**
 * Evaluate Sea of Clouds (云海)
 */
function evaluateCloudSea(ctx: EvaluationContext): PhenomenonPrediction {
  // Peak observation hours: early morning 05:00 - 08:30, or late afternoon 16:30 - 18:30
  // Morning hours (5, 6, 7, 8)
  const morningHours = ctx.hourly.filter((h) => h.hourNum >= 5 && h.hourNum <= 8);
  const sample = morningHours.length > 0 ? morningHours : ctx.hourly.slice(5, 9);

  const avgHumidity = Math.round(sample.reduce((s, h) => s + h.humidity, 0) / (sample.length || 1));
  const avgWind = Math.round(sample.reduce((s, h) => s + h.windSpeed, 0) / (sample.length || 1));
  const elevation = ctx.elevation;

  // 稳定窗口是全天尺度的持续时间，不参与总分；总分只取分时最高分
  let windowMinutes = 120;
  if (avgWind <= 12 && avgHumidity >= 80) {
    windowMinutes = 180;
  } else if (avgWind <= 18 && avgHumidity >= 68) {
    windowMinutes = 120;
  } else if (avgWind <= 25) {
    windowMinutes = 75;
  } else {
    windowMinutes = 40;
  }

  let windowStatus: 'optimal' | 'good' | 'moderate' = 'good';
  let windowLabel = '适中稳定';
  if (windowMinutes >= 150) {
    windowStatus = 'optimal';
    windowLabel = '绵延充裕';
  } else if (windowMinutes >= 100) {
    windowStatus = 'good';
    windowLabel = '适中稳定';
  } else if (windowMinutes >= 60) {
    windowStatus = 'moderate';
    windowLabel = '窗口偏短·消散快';
  } else {
    windowStatus = 'moderate';
    windowLabel = '稍纵即散';
  }

  const sunriseHHMM = ctx.sunriseTime || '06:00';
  const bestTimeStart = shiftTimeString(sunriseHHMM, -40);
  const bestTimeEnd = shiftTimeString(sunriseHHMM, Math.min(180, windowMinutes));

  const rawHourlyScores = ctx.hourly.map((h) => {
    let hScore = 8;
    if (h.cloudLow >= 65 && h.cloudLow <= 95) hScore += 32;
    else if (h.cloudLow >= 45 && h.cloudLow < 65) hScore += 18;
    else if (h.cloudLow > 95) hScore += 16;
    else if (h.cloudLow >= 25) hScore += 8;

    if (h.humidity >= 85) hScore += 18;
    else if (h.humidity >= 70) hScore += 12;
    else if (h.humidity >= 55) hScore += 6;

    const dewSpread = Math.abs(h.temp - h.dewPoint);
    if (dewSpread <= 2.5) hScore += 6;
    else if (dewSpread <= 4.5) hScore += 3;

    const overHead = (h.cloudMid + h.cloudHigh) / 2;
    if (overHead <= 25) hScore += 14;
    else if (overHead <= 50) hScore += 8;
    else hScore -= 8;

    if (h.windSpeed <= 12) hScore += 8;
    else if (h.windSpeed <= 20) hScore += 3;
    else if (h.windSpeed > 28) hScore -= 15;

    if (elevation !== undefined) {
      if (elevation >= 800) hScore += 3;
      if (elevation >= 1300) hScore += 2;
      if (elevation < 200) hScore -= 8;
    }

    const raining = h.precip > 1 || h.precipProb > 70 || h.code >= 61;
    if (raining) hScore -= 22;
    else if (h.precip > 0.2 || h.precipProb > 40) hScore -= 10;
    if (h.code >= 45 && h.code <= 48 && h.precipProb <= 30) hScore += 4;

    const moisture = boundaryLayerMoisture(h);
    hScore += moisture.delta;

    let timeFactor = 0.40;
    let timeLabel = '非活跃期';

    if (h.hourNum >= 5 && h.hourNum <= 8) {
      timeFactor = 1.0;
      timeLabel = '清晨逆温稳定期';
    } else if (h.hourNum === 4 || h.hourNum === 9) {
      timeFactor = 0.8;
      timeLabel = '逆温凝聚/渐散';
    } else if (h.hourNum >= 16 && h.hourNum <= 18) {
      timeFactor = 0.70;
      timeLabel = '傍晚山岚冷凝期';
    } else if (h.hourNum >= 11 && h.hourNum <= 15) {
      timeFactor = 0.35;
      timeLabel = '正午对流云消散';
    }

    const hourlyVerticalAdjustment = evaluateCloudSeaVerticalAdjustment({
      surfaceTemperature: h.temp,
      temperature925hPa: h.temperature925,
      temperature850hPa: h.temperature850,
      temperature700hPa: h.temperature700,
      convectiveCloudBase: h.convectiveCloudBase,
      observerElevation: ctx.elevation,
      windGusts: h.gusts,
      pressureMsl: h.pressureMsl,
    });
    const combined = clampScore(
      Math.min(
        Math.round(hScore * timeFactor) + hourlyVerticalAdjustment.delta,
        cloudSeaCoverageCeiling(h.cloudLow)
      )
    );

    return {
      hour: h.time,
      displayHour: `${String(h.hourNum).padStart(2, '0')}:00`,
      score: combined,
      cloudCover: h.cloudTotal,
      detail: timeLabel,
      factors: [
        {
          name: '近地相对湿度',
          value: `${Math.round(h.humidity)}%`,
          status: h.humidity >= 80 ? 'optimal' : h.humidity >= 65 ? 'good' : 'moderate',
          hint: `露点温差 ${dewSpread.toFixed(1)}°C。${
            h.humidity >= 80 ? '湿度接近饱和，利于水汽凝结' : '水汽略干，云海不易铺满'
          }`,
        },
        {
          name: '垂直层结 / 云底 / 阵风',
          value:
            hourlyVerticalAdjustment.delta === 0
              ? '未修正'
              : `${hourlyVerticalAdjustment.delta > 0 ? '+' : ''}${hourlyVerticalAdjustment.delta} 分`,
          status:
            hourlyVerticalAdjustment.delta > 2
              ? 'optimal'
              : hourlyVerticalAdjustment.delta < -2
                ? 'unfavorable'
                : 'moderate',
          hint: [...hourlyVerticalAdjustment.notes, moisture.note].join('；'),
        },
      ] as EvaluationFactor[],
    };
  });

  const dailyScore = peakScore(rawHourlyScores);

  // Determine level
  let level: PhenomenonPrediction['level'] = 'poor';
  let levelLabel = '云海概率低';
  let levelBadgeColor = 'bg-slate-500/20 text-slate-300 border-slate-600/30';
  let summary = '当前气象条件下，低空水汽或凝结高度不足，难以形成漫延的云海大观。';

  if (dailyScore >= 80) {
    level = 'excellent';
    levelLabel = '漫山云海·极佳';
    levelBadgeColor = 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
    summary = `极佳观测期！低空水汽充分饱和汇聚成云浪，高空晴朗通透，山峰如海中仙岛（稳定窗口约${Math.round(windowMinutes / 60 * 10) / 10}小时）。`;
  } else if (dailyScore >= 62) {
    level = 'good';
    levelLabel = '大概率可见·良好';
    levelBadgeColor = 'bg-teal-500/20 text-teal-300 border-teal-500/40';
    summary = `水汽与低空逆温条件较好，清晨山谷易聚集大面积浓雾云浪（稳定窗口约${Math.round(windowMinutes / 60 * 10) / 10}小时），适合提早守候。`;
  } else if (dailyScore >= 45) {
    level = 'moderate';
    levelLabel = '局地散云·一般';
    levelBadgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    summary = `可能出现局地小范围谷地薄雾或流云，规模相对分散（持续窗口约${Math.round(windowMinutes / 60 * 10) / 10}小时），建议结合山地局部地形观测。`;
  }

  const factors: EvaluationFactor[] = [
    {
      name: '逆温层稳定持续窗口',
      value: `约${windowMinutes}分钟 · ${windowLabel}`,
      status: windowStatus,
      hint:
        windowMinutes >= 120
          ? '山谷逆温层稳固，云海漫延从容持久，观赏拍摄容错高'
          : '受风速或升温影响，云海消散较快，建议抢占日出首发窗口',
    },
    {
      name: '地形海拔契合度',
      value: elevation === undefined ? '未标定' : `${elevation} 米`,
      status:
        elevation === undefined
          ? 'moderate'
          : elevation >= 800
            ? 'optimal'
            : elevation >= 400
              ? 'good'
              : 'moderate',
      hint:
        elevation === undefined
          ? '接口未返回观测点海拔，地形贡献未计入'
          : elevation >= 800
            ? '海拔高于常规逆温凝结层'
            : '地势较低，建议登至高处眺望',
    },
  ];

  const hourlyScores = rawHourlyScores;

  return {
    id: 'cloud_sea',
    title: '云海漫延',
    subtitle: '山峦沉浮·翻滚云浪',
    score: dailyScore,
    level,
    levelLabel,
    levelBadgeColor,
    bestTimeWindow: `${bestTimeStart} - ${bestTimeEnd} (清晨日出逆温窗口)`,
    bestTimeShort: `${bestTimeStart} - ${bestTimeEnd}`,
    countdownHint: `最佳观测时段通常为清晨日出逆温层稳定期，持续约 ${windowMinutes} 分钟`,
    summary,
    factors,
    photographerTips: '推荐机位选在海拔 1000m 以上开阔观景台或东向山崖；搭配广角镜头拍壮阔气势，长焦镜头压缩山峰孤岛特写；加装 ND 减光镜可拍摄如丝绢般流动的云瀑慢门。',
    equipmentAdvice: '广角变焦镜头、长焦镜头(70-200mm)、ND1000减光镜、稳固三脚架、保暖冲锋衣',
    hourlyScores,
  };
}

/**
 * Evaluate Sunrise (日出)
 * Based on physical meteorological conditions for viewing sunrise:
 * 1. Eastern horizon low cloud cover (40% weight - core factor, cloud banks block the sun disk)
 * 2. Sky openness & total cloud cover (25% weight - clear skies allow sharp, crisp red sun)
 * 3. Horizontal visibility & air purity (20% weight - Rayleigh scattering & sharp disk contour)
 * 4. Precipitation guarantee (15% weight - rain kills sunrise)
 * 5. Ground moisture & radiation fog reference
 */
function evaluateSunrise(ctx: EvaluationContext): PhenomenonPrediction {
  const sunriseHHMM = ctx.sunriseTime || '06:00';
  const [sH, sM] = sunriseHHMM.split(':').map(Number);
  const sunriseMinutes = (isNaN(sH) ? 6 : sH) * 60 + (isNaN(sM) ? 0 : sM);

  const rawSunriseHourly = ctx.hourly.map((h) => {
    const hMidMinutes = (h.hourNum + 0.5) * 60;
    const diffFromSunrise = hMidMinutes - sunriseMinutes; // distance in minutes to exact sunrise

    // Hourly condition potential
    let hLowScore = 40;
    if (h.cloudLow <= 10) hLowScore = 40;
    else if (h.cloudLow <= 20) hLowScore = 36;
    else if (h.cloudLow <= 35) hLowScore = 26;
    else if (h.cloudLow <= 50) hLowScore = 14;
    else hLowScore = Math.max(0, 14 - (h.cloudLow - 50) * 0.3);

    let hOpenScore = 25;
    if (h.cloudTotal <= 15) hOpenScore = 25;
    else if (h.cloudTotal <= 35) hOpenScore = 21;
    else if (h.cloudTotal <= 60) hOpenScore = 13;
    else if (h.cloudTotal <= 80) hOpenScore = 5;
    else hOpenScore = 0;

    let hVisScore = 20;
    if (h.visibilityKm >= 20) hVisScore = 20;
    else if (h.visibilityKm >= 15) hVisScore = 17;
    else if (h.visibilityKm >= 10) hVisScore = 12;
    else if (h.visibilityKm >= 5) hVisScore = 6;
    else hVisScore = 0;

    let hPrecipScore = 15;
    if (h.precipProb <= 10 && (h.precip || 0) === 0) hPrecipScore = 15;
    else if (h.precipProb <= 25) hPrecipScore = 10;
    else if (h.precipProb <= 45) hPrecipScore = 4;
    else hPrecipScore = 0;

    let hBase = hLowScore + hOpenScore + hVisScore + hPrecipScore;
    const raining =
      h.precipProb > 50 ||
      (h.precip || 0) > 0.2 ||
      (h.code >= 61 && h.code <= 82) ||
      h.code >= 95;
    if (raining) hBase *= 0.45;
    else if (h.precipProb > 35) hBase *= 0.75;
    if (h.humidity >= 96 && h.visibilityKm < 8) hBase = Math.max(0, hBase - 8);
    else if (h.code >= 45 && h.code <= 48 && h.visibilityKm < 10) hBase = Math.max(0, hBase - 6);
    const dewSpread = Math.abs(h.temp - h.dewPoint);
    if (dewSpread <= 1.5 && h.humidity >= 90 && h.visibilityKm < 10) hBase = Math.max(0, hBase - 4);
    const haze = hazePenalty(h.pm2_5, h.aod);
    hBase += haze.delta;

    // Time weighting: Sunrise peak moment
    let timeWeight = 0.08;
    let timingLabel = '非日出时段';

    if (diffFromSunrise >= -25 && diffFromSunrise <= 30) {
      // Prime sunrise window: solar disk crossing the horizon
      timeWeight = 1.0;
      timingLabel = Math.abs(diffFromSunrise) <= 15 ? '红日跃出黄金段' : '破晓出升核心期';
    } else if (diffFromSunrise < -25 && diffFromSunrise >= -75) {
      // Pre-dawn dawn glow & nautical twilight
      const ratio = (-25 - diffFromSunrise) / 50;
      timeWeight = 0.85 - ratio * 0.35;
      timingLabel = '黎明破晓曙光期';
    } else if (diffFromSunrise > 30 && diffFromSunrise <= 90) {
      // Post-sunrise morning golden rays
      const ratio = (diffFromSunrise - 30) / 60;
      timeWeight = 0.70 - ratio * 0.35;
      timingLabel = '晨光初照时间期';
    }

    let hFinal = Math.round(hBase * timeWeight);
    hFinal = Math.max(0, Math.min(100, hFinal));
    const clarityValue =
      h.pm2_5 === undefined && h.aod === undefined
        ? '数据暂缺'
        : `AOD ${h.aod === undefined ? '--' : h.aod.toFixed(2)} · PM2.5 ${
            h.pm2_5 === undefined ? '--' : Math.round(h.pm2_5)
          }`;

    return {
      h,
      score: hFinal,
      timeWeight,
      timingLabel,
      factors: [
        {
          name: '东向地平通透度 (低云)',
          value: `低云 ${Math.round(h.cloudLow)}%`,
          status:
            h.cloudLow <= 15 ? 'optimal' : h.cloudLow <= 35 ? 'good' : h.cloudLow <= 50 ? 'moderate' : 'unfavorable',
          hint:
            h.cloudLow <= 15
              ? '东方地平线无低云阻隔，能完整目睹太阳跃出'
              : h.cloudLow <= 35
                ? '有零散低云，日轮可能有轻微云翳穿过'
                : '低空云墙较厚，地平线日出大概率被遮挡',
        },
        {
          name: '天空晴朗开阔度 (总云量)',
          value: `总云量 ${Math.round(h.cloudTotal)}%`,
          status:
            h.cloudTotal <= 25
              ? 'optimal'
              : h.cloudTotal <= 55
                ? 'good'
                : h.cloudTotal <= 75
                  ? 'moderate'
                  : 'unfavorable',
          hint:
            h.cloudTotal <= 25
              ? '晴空如洗，日出光芒纯粹无碍'
              : h.cloudTotal <= 55
                ? '晴间多云，有薄云点缀朝晨光彩'
                : '云层密闭，阳光穿透力弱',
        },
        {
          name: '水平大气能见度 (锐度)',
          value: `${h.visibilityKm} km`,
          status:
            h.visibilityKm >= 18
              ? 'optimal'
              : h.visibilityKm >= 10
                ? 'good'
                : h.visibilityKm >= 6
                  ? 'moderate'
                  : 'unfavorable',
          hint:
            h.visibilityKm >= 18
              ? '大气通透纯净，日轮边缘锐利、剪影分明'
              : h.visibilityKm >= 10
                ? '视野良好，略有轻微晨霭'
                : '晨雾或霾较重，太阳轮廓模糊泛白',
        },
        {
          name: '降水干扰概率 (保障)',
          value: `${Math.round(h.precipProb)}% · ${h.precip.toFixed(1)}mm`,
          status:
            h.precipProb <= 10 ? 'optimal' : h.precipProb <= 25 ? 'good' : h.precipProb <= 50 ? 'moderate' : 'unfavorable',
          hint:
            h.precipProb <= 10
              ? '晴空无雨，观测极度安全稳定'
              : h.precipProb <= 25
                ? '降水概率较低，基本无雨'
                : '有降雨云团，观测风险极高',
        },
        {
          name: '晨间近地水汽 (晨雾消散)',
          value: `湿度 ${Math.round(h.humidity)}%`,
          status: h.humidity <= 85 ? 'optimal' : h.humidity <= 94 ? 'good' : 'moderate',
          hint: `露点温差 ${dewSpread.toFixed(1)}°C。${
            h.humidity <= 85
              ? '近地水汽适中，无浓重贴地辐射雾干扰'
              : h.humidity <= 94
                ? '湿度较高，低洼平原可能形成短暂晨雾'
                : '近地湿度饱和，平原易现浓雾，高山则易伴随云海金顶'
          }`,
        },
        {
          name: '空气通透',
          value: clarityValue,
          status: haze.delta < -3 ? 'unfavorable' : haze.delta < 0 ? 'moderate' : 'good',
          hint: haze.notes.join('；'),
        },
      ] as EvaluationFactor[],
    };
  });

  const dailyScore = peakScore(rawSunriseHourly);

  // Determine Level & Summary
  let level: PhenomenonPrediction['level'] = 'poor';
  let levelLabel = '阴云遮日·较差';
  let levelBadgeColor = 'bg-slate-500/20 text-slate-300 border-slate-600/30';
  let summary = '东向地平低云厚重、阴天或有降水，日出时太阳被厚云完全封死，难见红日破晓。';

  if (dailyScore >= 82) {
    level = 'excellent';
    levelLabel = '金轮破晓·极佳';
    levelBadgeColor = 'bg-rose-500/20 text-rose-300 border-rose-500/40';
    summary = `极佳观测日！东方地平线通透无阻，晴空万里。日出时刻将清晰目睹火红圆润的日轮跃出地平线，晨光万道金芒四射！`;
  } else if (dailyScore >= 65) {
    level = 'good';
    levelLabel = '红日初升·良好';
    levelBadgeColor = 'bg-orange-500/20 text-orange-300 border-orange-500/40';
    summary = `气象条件良好，东方地平线视线开阔，少量轻云点缀，日轮破晓与天际色彩层次分明，非常适合观赏与拍摄。`;
  } else if (dailyScore >= 45) {
    level = 'moderate';
    levelLabel = '云隙见日·一般';
    levelBadgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    summary = `云量偏多或低空有间隙云带，太阳可能在云缝中漏光或稍晚穿透云层露面，地平线瞬间可能受挡。`;
  }

  // Sunrise observation window: 20 mins before sunrise to 25 mins after sunrise
  const bestStart = shiftTimeString(sunriseHHMM, -20);
  const bestEnd = shiftTimeString(sunriseHHMM, 25);

  const factors: EvaluationFactor[] = [];

  const hourlyScores = rawSunriseHourly.map(({ h, score: hScore, timingLabel, factors: hourFactors }) => ({
    hour: h.time,
    displayHour: `${String(h.hourNum).padStart(2, '0')}:00`,
    score: hScore,
    cloudCover: h.cloudTotal,
    detail: timingLabel,
    factors: hourFactors,
  }));

  return {
    id: 'sunrise',
    title: '红日初升',
    subtitle: '金轮破晓·晨光万道',
    score: dailyScore,
    level,
    levelLabel,
    levelBadgeColor,
    bestTimeWindow: `${bestStart} - ${bestEnd} (破晓至金芒溢染约45分钟)`,
    bestTimeShort: `${bestStart} - ${bestEnd}`,
    countdownHint: `日出精确时间为 ${sunriseHHMM}，建议在 ${bestStart}（提前20分钟）抵达东向开阔机位，静候破晓曙光`,
    summary,
    factors,
    photographerTips: '【日出黄金拍摄三部曲】① 日出前20~10分钟（破晓蓝调）：兼顾天际橙红光弧与地面暗部冷蓝，冷暖对撞极富冲击力；② 日出瞬间（红日跃出）：使用长焦镜头（70-200mm/100-400mm）压缩地景，将太阳拍成饱满“鸭蛋黄”，点测光对准日轮边缘；③ 日出后15分钟（晨光普照）：换用广角（16-35mm）小光圈（f/11-f/16）捕捉阳光穿透晨雾的丁达尔金光与星芒。',
    equipmentAdvice: '长焦变焦镜头(70-200mm/100-400mm)、超广角镜头、稳固三脚架、软渐变灰滤镜(Soft GND0.9)、黑卡、防寒保暖外套、强光手电/头灯',
    hourlyScores,
  };
}

// Backward-compatible alias
export const evaluateSunriseGlow = evaluateSunrise;

/**
 * Evaluate Sunset Glow (晚霞 / 火烧云)
 */
function evaluateSunsetGlow(ctx: EvaluationContext): PhenomenonPrediction {
  const sunsetHHMM = ctx.sunsetTime || '18:20';
  const [setH, setM] = sunsetHHMM.split(':').map(Number);
  const sunsetMinutes = (isNaN(setH) ? 18 : setH) * 60 + (isNaN(setM) ? 20 : setM);

  // Sample dusk hours around sunset (from 25 min before sunset to 40 min after sunset)
  const duskHours = ctx.hourly.filter((h) => {
    const hStart = h.hourNum * 60;
    const hEnd = (h.hourNum + 1) * 60;
    return hEnd > sunsetMinutes - 30 && hStart < sunsetMinutes + 45;
  });
  const sample = duskHours.length > 0 ? duskHours : ctx.hourly.slice(17, 19);

  const avgCloudLow = Math.round(sample.reduce((s, h) => s + h.cloudLow, 0) / (sample.length || 1));
  const avgCloudMid = Math.round(sample.reduce((s, h) => s + h.cloudMid, 0) / (sample.length || 1));
  const avgCloudHigh = Math.round(sample.reduce((s, h) => s + h.cloudHigh, 0) / (sample.length || 1));
  const screenCloud = Math.round((avgCloudMid * 1.1 + avgCloudHigh * 1.1) / 2.2);

  // 24-hour sunset glow timeline with physical solar depression angle weighting
  const peakSunsetMinutes = sunsetMinutes + 12; // optical peak of fire cloud after sunset

  // 1. Calculate effective viewing window duration (in minutes)
  let windowMinutes = 45;
  if (avgCloudLow <= 20) {
    windowMinutes = 48;
  } else if (avgCloudLow <= 35) {
    windowMinutes = 32;
  } else if (avgCloudLow <= 50) {
    windowMinutes = 20;
  } else {
    windowMinutes = 12;
  }

  if (screenCloud >= 35 && screenCloud <= 75) {
    windowMinutes = Math.min(50, windowMinutes + 4);
  } else if (screenCloud < 15 || screenCloud > 85) {
    windowMinutes = Math.max(10, windowMinutes - 8);
  }

  let windowStatus: 'optimal' | 'good' | 'moderate' = 'optimal';
  let windowLabel = '充裕从容';
  if (windowMinutes >= 40) {
    windowStatus = 'optimal';
    windowLabel = '充裕从容';
  } else if (windowMinutes >= 28) {
    windowStatus = 'good';
    windowLabel = '标准适宜';
  } else if (windowMinutes >= 18) {
    windowStatus = 'moderate';
    windowLabel = '偏紧凑·抓拍';
  } else {
    windowStatus = 'moderate';
    windowLabel = '稍纵即逝';
  }

  // 2. Calculate optical conditions for each specific hour
  const rawSunsetHourly = ctx.hourly.map((h) => {
    const hMidMinutes = (h.hourNum + 0.5) * 60;
    const diffFromPeak = hMidMinutes - peakSunsetMinutes; // distance to sunset peak

    let optScore = 25;
    if (h.cloudLow <= 20) optScore += 32;
    else if (h.cloudLow <= 35) optScore += 20;
    else if (h.cloudLow <= 50) optScore += 6;
    else optScore -= 18;

    const hScreen = Math.round((h.cloudMid * 1.1 + h.cloudHigh * 1.1) / 2.2);
    if (hScreen >= 35 && hScreen <= 75) optScore += 34;
    else if (hScreen >= 20 && hScreen < 35) optScore += 18;
    else if (hScreen > 75 && hScreen <= 88) optScore += 10;
    else if (hScreen < 15) optScore += 6;

    if (h.visibilityKm >= 15) optScore += 12;
    else if (h.visibilityKm >= 8) optScore += 6;
    else optScore -= 8;

    if (h.precip > 0.5 || h.precipProb > 50 || h.code >= 95) optScore -= 25;
    else if ((h.code >= 61 && h.code <= 82) || h.precipProb > 30) optScore -= 12;
    else if (h.precipProb <= 15 && (h.precip || 0) === 0) optScore += 5;
    if (h.humidity >= 95 && h.visibilityKm < 8) optScore -= 8;
    const hourlyAerosolAdjustment = evaluateSunsetAerosolAdjustment({
      aerosolOpticalDepth: h.aod,
      pm2_5: h.pm2_5,
    });
    optScore = clampScore(optScore + hourlyAerosolAdjustment.delta);

    // Optical timing weight based on physical solar depression angle
    let timeWeight = 0.10;
    let timingLabel = '非霞光时段';

    if (Math.abs(diffFromPeak) <= 35) {
      // Core fire cloud eruption window (sunset moment & first 20 min post-sunset)
      timeWeight = 1.0 - (Math.abs(diffFromPeak) / 35) * 0.12;
      timingLabel = Math.abs(diffFromPeak) <= 15 ? '火烧云高潮时段' : '夕照熔金爆发期';
    } else if (diffFromPeak > 35 && diffFromPeak <= 80) {
      // Late dusk twilight & blue hour transition
      timeWeight = 0.88 - ((diffFromPeak - 35) / 45) * 0.38;
      timingLabel = '暮色余晖与冷暖对撞';
    } else if (diffFromPeak < -35 && diffFromPeak >= -80) {
      // Pre-sunset golden hour
      timeWeight = 0.88 - ((-35 - diffFromPeak) / 45) * 0.38;
      timingLabel = '夕照暖光斜射期';
    }

    let hScore = Math.round(optScore * timeWeight);
    hScore = Math.max(0, Math.min(100, hScore));
    const aerosolValue =
      h.aod === undefined && h.pm2_5 === undefined
        ? '数据暂缺'
        : `AOD ${h.aod === undefined ? '--' : h.aod.toFixed(2)} · PM2.5 ${
            h.pm2_5 === undefined ? '--' : Math.round(h.pm2_5)
          }`;

    return {
      h,
      score: hScore,
      timeWeight,
      timingLabel,
      hScreen,
      factors: [
        {
          name: '西向地平光路 (低云遮挡)',
          value: `低云 ${Math.round(h.cloudLow)}%`,
          status: h.cloudLow <= 25 ? 'optimal' : h.cloudLow <= 40 ? 'good' : 'unfavorable',
          hint: h.cloudLow <= 25 ? '落日入射角度完美，无厚重低云遮挡' : '西侧有云遮挡，余晖受阻',
        },
        {
          name: '天幕承载云量 (火烧云层)',
          value: `中高云 ${hScreen}%`,
          status: hScreen >= 35 && hScreen <= 75 ? 'optimal' : 'good',
          hint:
            hScreen >= 35 && hScreen <= 75
              ? '中高层卷云/透光高积云，火烧云天幕成型'
              : '云层较少或过于密实',
        },
        {
          name: '水平能见度',
          value: `${h.visibilityKm} km`,
          status: h.visibilityKm >= 15 ? 'optimal' : h.visibilityKm >= 8 ? 'good' : 'moderate',
          hint: h.visibilityKm >= 15 ? '空气通透澄澈，色彩反差与饱和度高' : '存在轻度霾气，色彩略显灰蒙',
        },
        {
          name: '降水与雷暴概率',
          value: `${Math.round(h.precipProb)}% · ${h.precip.toFixed(1)}mm`,
          status: h.precipProb <= 20 ? 'optimal' : h.precipProb <= 45 ? 'good' : 'unfavorable',
          hint:
            h.code >= 95
              ? '有雷暴云团，夕照通道不稳定'
              : h.precipProb <= 20
                ? '气压稳定，无降雨云层冲刷'
                : '有局部阵雨可能',
        },
        {
          name: '空气通透 / 气溶胶',
          value: aerosolValue,
          status:
            h.aod === undefined && h.pm2_5 === undefined
              ? 'moderate'
              : hourlyAerosolAdjustment.delta > 0
                ? 'good'
                : hourlyAerosolAdjustment.delta < 0
                  ? 'unfavorable'
                  : 'moderate',
          hint:
            h.aod === undefined && h.pm2_5 === undefined
              ? '空气质量数据暂缺，晚霞评分未做气溶胶修正'
              : hourlyAerosolAdjustment.notes.join('；'),
        },
      ] as EvaluationFactor[],
    };
  });

  const dailyScore = peakScore(rawSunsetHourly);

  let level: PhenomenonPrediction['level'] = 'poor';
  let levelLabel = '晚霞几率低';
  let levelBadgeColor = 'bg-slate-500/20 text-slate-300 border-slate-600/30';
  let summary = '西面云层过厚封锁夕照通道，或缺乏中高空受光云层，出现火烧云概率低。';

  if (dailyScore >= 78) {
    level = 'excellent';
    levelLabel = '绝美火烧云·极佳';
    levelBadgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    summary = `极佳观测期！具备标准火烧云气象结构，西侧低空开阔，中高云层丰满，落日余晖将烧红半边天（窗口约${windowMinutes}分钟）！`;
  } else if (dailyScore >= 60) {
    level = 'good';
    levelLabel = '瑰丽晚霞·良好';
    levelBadgeColor = 'bg-orange-500/20 text-orange-300 border-orange-500/40';
    summary = `暮色光影优良，日落后将出现温暖浓郁的暖金与粉紫色云霞（有效窗口约${windowMinutes}分钟）。`;
  } else if (dailyScore >= 40) {
    level = 'moderate';
    levelLabel = '温和夕照·一般';
    levelBadgeColor = 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40';
    summary = `局部天空有温和夕阳散射，受云层或窗口限制（约${windowMinutes}分钟），霞光面积相对克制。`;
  }

  const bestStart = shiftTimeString(sunsetHHMM, -Math.min(20, Math.round(windowMinutes * 0.35)));
  const bestEnd = shiftTimeString(sunsetHHMM, Math.max(15, Math.round(windowMinutes * 0.65)));

  const factors: EvaluationFactor[] = [
    {
      name: '受光观赏窗口时长',
      value: `${windowMinutes}分钟 · ${windowLabel}`,
      status: windowStatus,
      hint:
        windowMinutes >= 35
          ? '西向低云阻碍小，火烧云演变平缓充裕，成片率高'
          : '受西向低云压制，火烧云爆发时段偏短，抓拍需迅速',
    },
  ];

  const hourlyScores = rawSunsetHourly.map(({ h, score: hScore, timingLabel, factors: hourFactors }) => ({
    hour: h.time,
    displayHour: `${String(h.hourNum).padStart(2, '0')}:00`,
    score: hScore,
    cloudCover: h.cloudTotal,
    detail: timingLabel,
    factors: hourFactors,
  }));

  return {
    id: 'sunset_glow',
    title: '晚霞暮色',
    subtitle: '夕阳熔金·火烧云卷',
    score: dailyScore,
    level,
    levelLabel,
    levelBadgeColor,
    bestTimeWindow: `${bestStart} - ${bestEnd} (有效窗口约${windowMinutes}分钟)`,
    bestTimeShort: `${bestStart} - ${bestEnd}`,
    countdownHint: `日落预测时间为 ${sunsetHHMM}，有效窗口约 ${windowMinutes} 分钟，日落后15分钟常是火烧云顶峰`,
    summary,
    factors,
    photographerTips: '晚霞呈现三段阶梯式演变：① 日落前金黄刺眼；② 日落后 5-15 分钟红黄云彩爆裂（火烧云最佳窗口）；③ 日落后 20-35 分钟天空转入冷暖对冲紫粉蓝调。请使用三脚架并适度减弱曝光突出色彩饱和。',
    equipmentAdvice: '偏振镜(CPL)、软渐变滤镜(Soft GND0.9)、广角变焦镜头、稳固脚架',
    hourlyScores,
  };
}

/**
 * Evaluate Starry Sky & Milky Way (星空 / 银河)
 */
function evaluateStarrySky(ctx: EvaluationContext): PhenomenonPrediction {
  const moonInfo = calculateMoonInfo(ctx.dateStr);

  const nightHoursForWindow = ctx.hourly.filter((h) => h.hourNum >= 21 || h.hourNum <= 4);
  const clearNightHours = nightHoursForWindow.filter((h) => h.cloudTotal <= 25 && h.precipProb <= 25).length;
  const windowHours = clearNightHours;
  let windowStatus: 'optimal' | 'good' | 'moderate' = 'good';
  let windowLabel = '适中稳定';

  if (windowHours >= 5) {
    windowStatus = 'optimal';
    windowLabel = '通宵纯黑';
  } else if (windowHours >= 3) {
    windowStatus = 'good';
    windowLabel = '充裕从容';
  } else if (windowHours >= 1.5) {
    windowStatus = 'moderate';
    windowLabel = '间歇晴空·抓拍';
  } else {
    windowStatus = 'moderate';
    windowLabel = '短暂云隙';
  }

  const starryHourFactors = (
    h: HourSlice,
    moonlight: ReturnType<typeof evaluateMoonlightImpact>,
    daytime: boolean
  ): EvaluationFactor[] => {
    const haze = hazePenalty(h.pm2_5, h.aod);
    const dewSpread = Math.abs(h.temp - h.dewPoint);
    const clarityValue =
      h.pm2_5 === undefined && h.aod === undefined
        ? `${h.visibilityKm} km`
        : `${h.visibilityKm} km · AOD ${h.aod === undefined ? '--' : h.aod.toFixed(2)} · PM2.5 ${
            h.pm2_5 === undefined ? '--' : Math.round(h.pm2_5)
          }`;
    return [
      {
        name: '夜间总云量 (黑空纯度)',
        value: `${Math.round(h.cloudTotal)}%`,
        status: h.cloudTotal <= 15 ? 'optimal' : h.cloudTotal <= 35 ? 'good' : 'unfavorable',
        hint: h.cloudTotal <= 15 ? '夜空几乎万里无云，恒星无遮挡' : '存在部分低云或中云飘过',
      },
      {
        name: '月光干扰',
        value: daytime
          ? '日间无观星'
          : moonlight.isAboveHorizon
            ? `高度 ${Math.round(moonlight.altitudeDeg)}°`
            : '在地平线下',
        status: daytime
          ? 'moderate'
          : moonlight.penalty === 0
            ? 'optimal'
            : moonlight.penalty <= 10
              ? 'good'
              : 'unfavorable',
        hint: daytime ? '太阳在天上，这一小时不评估月光' : `逐时按月亮高度与照度计算；${moonlight.note}`,
      },
      {
        name: '夜间相对湿度 (防结露)',
        value: `${Math.round(h.humidity)}%`,
        status: h.humidity <= 65 ? 'optimal' : h.humidity <= 80 ? 'good' : 'unfavorable',
        hint: `露点温差 ${dewSpread.toFixed(1)}°C。${
          h.humidity <= 65 ? '空气干燥，镜头镜片不易结露起雾' : '湿度偏高，务必携带镜头加热带'
        }`,
      },
      {
        name: '能见度与气溶胶',
        value: clarityValue,
        status: haze.delta < -3 || h.visibilityKm < 8 ? 'unfavorable' : haze.delta < 0 ? 'moderate' : 'good',
        hint: haze.notes.join('；'),
      },
      {
        name: '降水',
        value: `${Math.round(h.precipProb)}% · ${h.precip.toFixed(1)}mm`,
        status: h.precipProb <= 15 && h.precip === 0 ? 'optimal' : h.precipProb <= 30 ? 'good' : 'unfavorable',
        hint: h.precipProb <= 15 ? '无有效降水，镜头和地平线都干净' : '有降水，星空窗口中断',
      },
      {
        name: '风速',
        value: `${h.windSpeed} km/h`,
        status: h.windSpeed <= 15 ? 'optimal' : h.windSpeed <= 25 ? 'good' : 'unfavorable',
        hint: h.windSpeed <= 15 ? '风力温和，三脚架稳定' : '风大时星点容易拖线',
      },
    ];
  };

  // 2. Hourly scores calculation
  const rawNightHourly = ctx.hourly.map((h) => {
    const moonlight = evaluateMoonlightImpact({
      isoTime: h.time,
      latitude: ctx.latitude,
      longitude: ctx.longitude,
      illuminationPct: moonInfo.illuminationPct,
      utcOffsetHours: ctx.utcOffsetHours,
    });

    // Daytime is 0
    if (h.hourNum >= 7 && h.hourNum <= 18) {
      return {
        hour: h.time,
        displayHour: `${String(h.hourNum).padStart(2, '0')}:00`,
        score: 0,
        cloudCover: h.cloudTotal,
        detail: '日间无法观星',
        factors: starryHourFactors(h, moonlight, true),
      };
    }

    // Twilight transitions
    let timeMultiplier = 0.25;
    let periodName = '暮光/晨昏微光时段';
    if (h.hourNum >= 22 || h.hourNum <= 3) {
      timeMultiplier = 1.0;
      periodName = '天文暗夜纯黑黄金期';
    } else if (h.hourNum === 21 || h.hourNum === 4) {
      timeMultiplier = 0.82;
      periodName = '天文晨昏交界期';
    } else if (h.hourNum === 19 || h.hourNum === 20 || h.hourNum === 5) {
      timeMultiplier = 0.40;
      periodName = '航海暮光期';
    }

    let optScore = 25;
    if (h.cloudTotal <= 10) optScore += 45;
    else if (h.cloudTotal <= 25) optScore += 30;
    else if (h.cloudTotal <= 45) optScore += 12;
    else if (h.cloudTotal <= 70) optScore -= 10;
    else optScore -= 35;

    if (h.humidity <= 60) optScore += 12;
    else if (h.humidity <= 75) optScore += 6;
    else optScore -= 8;

    if (h.visibilityKm >= 20) optScore += 12;
    else if (h.visibilityKm >= 12) optScore += 6;
    else optScore -= 10;

    if (ctx.elevation !== undefined) {
      if (ctx.elevation >= 1500) optScore += 8;
      else if (ctx.elevation >= 800) optScore += 4;
    }

    if (h.windSpeed <= 15) optScore += 5;
    else if (h.windSpeed > 25) optScore -= 8;

    if (h.precip > 0.2 || h.precipProb > 30 || h.code >= 61) optScore -= 25;
    if (h.humidity >= 90 && Math.abs(h.temp - h.dewPoint) <= 1.5) optScore -= 6;
    optScore += hazePenalty(h.pm2_5, h.aod).delta;

    const hScore = clampScore(optScore * timeMultiplier - moonlight.penalty);

    return {
      hour: h.time,
      displayHour: `${String(h.hourNum).padStart(2, '0')}:00`,
      score: hScore,
      cloudCover: h.cloudTotal,
      detail: periodName,
      factors: starryHourFactors(h, moonlight, false),
    };
  });

  const dailyScore = peakScore(rawNightHourly);

  let level: PhenomenonPrediction['level'] = 'poor';
  let levelLabel = '观星条件不佳';
  let levelBadgeColor = 'bg-slate-500/20 text-slate-300 border-slate-600/30';
  let summary = '夜间云量偏厚或受较强月光干扰，星光黯淡，不适宜天文深空或银河拍摄。';

  if (dailyScore >= 80) {
    level = 'excellent';
    levelLabel = '璀璨银河·极佳';
    levelBadgeColor = 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40';
    summary = `顶级暗夜观测窗口！夜空晴朗通透无云，月光干扰极微弱，肉眼可见银河如练、群星闪烁（澄澈窗口约${windowHours}小时）！`;
  } else if (dailyScore >= 60) {
    level = 'good';
    levelLabel = '繁星满天·良好';
    levelBadgeColor = 'bg-purple-500/20 text-purple-300 border-purple-500/40';
    summary = `天象条件较好，夜空透明度高，适合观测主要星座、大三角及拍摄壮观星轨（适宜窗口约${windowHours}小时）。`;
  } else if (dailyScore >= 40) {
    level = 'moderate';
    levelLabel = '偶见亮星·一般';
    levelBadgeColor = 'bg-blue-500/20 text-blue-300 border-blue-500/40';
    summary = `受部分碎云或月光冲刷影响，仅可辨识一二等亮星，暗弱天体能见度受限（适宜窗口约${windowHours}小时）。`;
  }

  // Estimated Bortle scale (rough approximation based on altitude, cloud, moon)
  const nightElevation = ctx.elevation;
  const bortleEst =
    nightElevation !== undefined && nightElevation > 2000 && dailyScore > 75
      ? 'Class 2-3 (极优暗夜)'
      : nightElevation !== undefined && nightElevation > 800 && dailyScore > 60
        ? 'Class 3-4 (乡村郊野)'
        : dailyScore > 50
          ? 'Class 4-5 (城郊交界)'
          : 'Class 6-7 (光污染显著)';

  const factors: EvaluationFactor[] = [
    {
      name: `月相与照度 (${moonInfo.phaseName})`,
      value: `月面亮度 ${moonInfo.illuminationPct}%`,
      status:
        moonInfo.illuminationPct <= 20
          ? 'optimal'
          : moonInfo.illuminationPct <= 50
            ? 'good'
            : 'unfavorable',
      hint: '月相全天不变；各小时月亮高度见 24 小时走势',
    },
    {
      name: '纯黑无云晴空窗口',
      value: `约${windowHours}小时 · ${windowLabel}`,
      status: windowStatus,
      hint:
        windowHours >= 4
          ? '通宵或大半夜纯黑无云，适宜深空深长曝光与整夜星轨'
          : '晴空窗口有限，建议在核心时段提前对焦并紧凑拍摄',
    },
    {
      name: '暗空参考等级评估',
      value: bortleEst,
      status: dailyScore >= 70 ? 'optimal' : 'good',
      hint: '结合海拔、光害估算与当日最佳时次的气象条件',
    },
  ];

  const hourlyScores = rawNightHourly;

  return {
    id: 'starry_sky',
    title: '浩瀚星空',
    subtitle: '银河璀璨·繁星如织',
    score: dailyScore,
    level,
    levelLabel,
    levelBadgeColor,
    bestTimeWindow: `21:30 - 次日04:00 (避开余晖与晨光的天文纯黑期)`,
    bestTimeShort: `21:30 - 04:00`,
    countdownHint: `当前月相：${moonInfo.phaseName} (月照 ${moonInfo.illuminationPct}%)，澄澈窗口约 ${windowHours} 小时`,
    summary,
    factors,
    photographerTips: '银河核心摄影建议：光圈全开(f/1.4 - f/2.8)，快门遵循 500/焦点法则(如 20mm 镜头约 15-20 秒)，ISO 3200-6400；夜间温差大务必携带镜头加热带或暖宝宝防止前组镜片凝结水雾。',
    equipmentAdvice: '大光圈超广角镜头(14-24mm F2.8)、稳固金属三脚架、镜头除雾加热带、红光手电筒(保护暗适应)、保暖防风衣物',
    hourlyScores,
  };
}

/**
 * Evaluate general outdoor travel and outing weather suitability
 */
export function evaluateTravelWeather(
  ctx: EvaluationContext,
  dailyMaxTemp: number,
  dailyMinTemp: number,
  uvIndexMax?: number
): PhenomenonPrediction {
  const daytimeHours = ctx.hourly.filter((h) => h.hourNum >= 7 && h.hourNum <= 18);
  const sample = daytimeHours.length > 0 ? daytimeHours : ctx.hourly;

  const totalRain = sample.reduce((sum, h) => sum + (h.precip || 0), 0);
  const maxRainProb = Math.max(...sample.map((h) => h.precipProb || 0), 0);
  const avgCloud = Math.round(sample.reduce((sum, h) => sum + h.cloudTotal, 0) / (sample.length || 1));
  const uv = uvIndexMax ?? (avgCloud < 40 ? 5 : 3);

  let tempStatus: 'optimal' | 'good' | 'moderate' | 'unfavorable' = 'good';
  let tempHint = '';
  if (dailyMaxTemp >= 16 && dailyMaxTemp <= 24 && dailyMinTemp >= 10) {
    tempStatus = 'optimal';
    tempHint = '人体温润黄金区间，久走不燥、体感极舒适';
  } else if (dailyMaxTemp >= 13 && dailyMaxTemp <= 27) {
    tempStatus = 'good';
    tempHint = '体感适宜，早晚略有温差，适度增减衣物';
  } else if (dailyMaxTemp >= 28 && dailyMaxTemp <= 30) {
    tempStatus = 'good';
    tempHint = '气温偏暖热，徒步易出汗，需备足饮水与电解质';
  } else if (dailyMaxTemp >= 31 && dailyMaxTemp <= 33) {
    tempStatus = 'moderate';
    tempHint = '高温偏闷热，正午登山易中暑脱水，建议避开11-15点高温段';
  } else if (dailyMaxTemp > 33) {
    tempStatus = 'unfavorable';
    tempHint = '酷暑高温，户外剧烈运动中暑风险极高，不建议长线徒步';
  } else if (dailyMaxTemp < 6) {
    tempStatus = 'moderate';
    tempHint = '体感严寒，山道有积冰湿滑风险，需专业防寒防滑装备';
  } else {
    tempStatus = 'good';
    tempHint = '气温微凉，请做好防风保暖';
  }

  let uvStatus: 'optimal' | 'good' | 'moderate' | 'unfavorable' = 'good';
  let uvHint = '';
  if (uv <= 2) {
    uvStatus = 'optimal';
    uvHint = '紫外线温和，无灼伤晒伤风险，极为安全舒适';
  } else if (uv <= 4) {
    uvStatus = 'good';
    uvHint = '紫外线中等，正常佩戴遮阳帽即可';
  } else if (uv <= 6) {
    uvStatus = 'good';
    uvHint = '紫外线偏强，阳光下久行需涂抹防晒霜并佩戴太阳镜';
  } else if (uv <= 8) {
    uvStatus = 'moderate';
    uvHint = '强紫外线暴晒！皮肤极易晒伤发红，务必做好物理遮阳与防晒';
  } else {
    uvStatus = 'unfavorable';
    uvHint = '极强紫外线！无遮挡山脊易灼伤脱皮，严禁长时间烈日暴晒';
  }

  const factors: EvaluationFactor[] = [
    {
      name: '全天气温区间',
      value: `${Math.round(dailyMinTemp)}℃ ~ ${Math.round(dailyMaxTemp)}℃`,
      status: tempStatus,
      hint: tempHint,
    },
    {
      name: '紫外防晒',
      value: `UV ${uv.toFixed(0)} · ${uv >= 7 ? '强紫外线' : uv >= 4 ? '中等偏强' : '温和舒适'}`,
      status: uvStatus,
      hint: uvHint,
    },
    {
      name: '建议着装',
      value:
        dailyMaxTemp >= 28
          ? '速干短袖 / 透气防晒衣'
          : dailyMaxTemp >= 20
            ? '长袖速干T恤 / 轻薄防风外套'
            : dailyMaxTemp >= 14
              ? '长袖衬衫 / 卫衣 + 防风夹克'
              : '保暖打底 + 抓绒内胆 / 软壳冲锋衣',
      status: 'optimal',
      hint: '按全天最高气温准备，途中再按分时体感增减',
    },
  ];

  let bestTimeWindow = '全天 08:30 - 17:00 (日间黄金徒步时段)';
  let bestTimeShort = '08:30 - 17:00';
  if (totalRain > 0 && maxRainProb > 40) {
    bestTimeWindow = '上午 08:30 - 12:00 (避开午后降雨时段)';
    bestTimeShort = '08:30 - 12:00';
  } else if (dailyMaxTemp >= 31) {
    bestTimeWindow = '清晨 06:30 - 09:30 · 傍晚 16:30 - 18:30 (正午酷热暴晒·避暑出行)';
    bestTimeShort = '早晚清凉时段';
  }

  const rawHikingHourly = ctx.hourly.map((h) => {
    let hRain = 35;
    if (h.precip > 2.0 || h.precipProb > 70 || h.code >= 95) hRain = 0;
    else if (h.precip > 0.5 || h.precipProb > 50 || (h.code >= 61 && h.code <= 82)) hRain = 8;
    else if (h.precipProb > 30 || (h.code >= 51 && h.code <= 55)) hRain = 18;
    else if (h.precipProb > 15) hRain = 28;

    let hTemp = 30;
    if (h.temp >= 16 && h.temp <= 24) hTemp = 30;
    else if (h.temp >= 13 && h.temp <= 27) hTemp = 24;
    else if (h.temp >= 28 && h.temp <= 30) hTemp = 16;
    else if (h.temp >= 31 && h.temp <= 33) hTemp = 8;
    else if (h.temp > 33) hTemp = 2;
    else if (h.temp >= 6 && h.temp < 13) hTemp = 16;
    else hTemp = 6;
    if (h.humidity >= 85 && h.temp >= 26) hTemp = Math.max(0, hTemp - 6);
    else if (h.humidity >= 75 && h.temp >= 24) hTemp = Math.max(0, hTemp - 3);
    else if (h.humidity >= 92 && h.temp <= 8) hTemp = Math.max(0, hTemp - 4);

    const hSun = hikingDaylightUvScore(h.hourNum, uv, h.cloudTotal);

    let hWind = 10;
    if (h.windSpeed <= 14) hWind = 10;
    else if (h.windSpeed <= 22) hWind = 7;
    else if (h.windSpeed <= 30) hWind = 3;
    else hWind = 0;

    let hVis = 10;
    if (h.visibilityKm >= 18) hVis = 10;
    else if (h.visibilityKm >= 10) hVis = 7;
    else if (h.visibilityKm >= 5) hVis = 4;
    else hVis = 1;
    if (h.pm2_5 !== undefined && h.pm2_5 > 115) hVis = Math.max(0, hVis - 3);
    else if (h.pm2_5 !== undefined && h.pm2_5 > 75) hVis = Math.max(0, hVis - 2);

    const hourlyComfort = evaluateHikingComfortAdjustment({
      apparentTemperature: h.apparentTemp,
      temperature: h.temp,
      windGusts: h.gusts,
    });
    const comfortDelta = Math.min(2, hourlyComfort.delta);
    let hScore = clampScore(Math.round(hRain + hTemp + hSun + hWind + hVis) + comfortDelta);
    const windLabel = h.windSpeed <= 12 ? '1-2级微风' : h.windSpeed <= 20 ? '3级和风' : '4级及以上';
    const feels = h.apparentTemp === undefined ? undefined : Math.round(h.apparentTemp);

    return {
      hour: h.time,
      displayHour: `${String(h.hourNum).padStart(2, '0')}:00`,
      score: hScore,
      cloudCover: h.cloudTotal,
      detail: describeHikingHour(h, hScore),
      factors: [
        {
          name: '降水风险',
          value: `${Math.round(h.precipProb)}% · ${h.precip.toFixed(1)}mm`,
          status: hRain >= 28 ? 'optimal' : hRain >= 18 ? 'good' : hRain >= 8 ? 'moderate' : 'unfavorable',
          hint: h.precip === 0 && h.precipProb <= 15 ? '这一小时地面干燥' : '可能遇雨，步道易湿滑',
        },
        {
          name: '体感温湿',
          value: `${Math.round(h.temp)}℃ · 湿度${Math.round(h.humidity)}%${
            feels === undefined ? '' : ` · 体感${feels}℃`
          }`,
          status: hTemp >= 24 ? 'optimal' : hTemp >= 16 ? 'good' : hTemp >= 8 ? 'moderate' : 'unfavorable',
          hint:
            h.humidity >= 85 && h.temp >= 26
              ? '闷热，出汗散热差'
              : h.temp >= 16 && h.temp <= 24
                ? '这一小时体感舒适'
                : '注意增减衣物与补水',
        },
        {
          name: '风力体感',
          value: `${windLabel} (${h.windSpeed} km/h)`,
          status: hWind >= 10 ? 'optimal' : hWind >= 7 ? 'good' : hWind >= 3 ? 'moderate' : 'unfavorable',
          hint: h.windSpeed <= 15 ? '和风，步道行走稳定' : '风力偏大，山脊注意防风',
        },
        {
          name: '阵风 / 体感修正',
          value: `${feels === undefined ? '体感温暂缺' : `体感 ${feels}℃`} · ${
            h.gusts === undefined ? '阵风暂缺' : `阵风 ${Math.round(h.gusts)}km/h`
          }`,
          status:
            comfortDelta < -4 ? 'unfavorable' : comfortDelta < 0 ? 'moderate' : comfortDelta > 0 ? 'good' : 'moderate',
          hint: hourlyComfort.notes.join('；'),
        },
        {
          name: '空气通透',
          value: `${h.visibilityKm} km${h.pm2_5 === undefined ? '' : ` · PM2.5 ${Math.round(h.pm2_5)}`}`,
          status: hVis >= 10 ? 'optimal' : hVis >= 7 ? 'good' : 'moderate',
          hint: h.visibilityKm >= 15 ? '视野宽广，适合登高远眺' : '能见度一般，适合近景林道',
        },
      ] as EvaluationFactor[],
    };
  });

  const hourlyScores = rawHikingHourly;
  const score = peakScore(hourlyScores);

  let level: PhenomenonPrediction['level'] = 'poor';
  let levelLabel = '天气欠佳·不宜户外';
  let levelBadgeColor = 'bg-rose-50 text-rose-700 border-rose-200';
  let summary = '受降水、大风或体感不适影响，山地步道湿滑，户外游览体验受限，建议推迟出行或选择室内展馆游览。';

  if (score >= 85) {
    level = 'excellent';
    levelLabel = '黄金徒步·极佳';
    levelBadgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    summary = '最佳时次气象条件极为理想，气温舒适、风力温和且无明显降雨，适合安排在这一小时前后出行。';
  } else if (score >= 68) {
    level = 'good';
    levelLabel = '适宜徒步·良好';
    levelBadgeColor = 'bg-sky-50 text-sky-700 border-sky-200';
    summary =
      dailyMaxTemp >= 31
        ? '最佳时次仍可出行，但全天高温、紫外线强，尽量选在清晨或傍晚，并备足饮水与防晒。'
        : '最佳时次体感温和，适合大部分山地步道；其余小时请对照走势再定出发时间。';
  } else if (score >= 50) {
    level = 'moderate';
    levelLabel = '徒步一般·慎行';
    levelBadgeColor = 'bg-amber-50 text-amber-700 border-amber-200';
    summary = '即使最好的一小时也只是中等条件，可能偏热、强晒或有零星小雨，建议缩短行程并备好防护。';
  }

  return {
    id: 'travel_weather',
    title: '户外徒步指数',
    subtitle: '山野轻徒步·登山步道·户外漫步综合适宜度',
    score,
    level,
    levelLabel,
    levelBadgeColor,
    bestTimeWindow,
    bestTimeShort,
    countdownHint:
      dailyMaxTemp >= 31
        ? `最高气温达 ${Math.round(dailyMaxTemp)}℃，紫外线较强，请尽量选择清晨或傍晚清凉时段出行`
        : totalRain === 0
        ? `全天干爽无雨，气温 ${Math.round(dailyMinTemp)}~${Math.round(dailyMaxTemp)}℃，非常适宜徒步出行`
        : `局部有降水概率，建议随身备伞并留意路面防滑`,
    summary,
    factors,
    photographerTips:
      '【推荐徒步路线类型】：\n1. 绿道休闲慢行：平缓林荫绿道、环湖步道，适合轻松散步与家庭出行。\n2. 森林山野轻徒步：山林溪流步道、竹海幽径，树荫遮蔽率高，体感清凉。\n3. 登高揽胜路线：山顶观景台、峰顶开阔机位，建议提前备好充足饮水与电解质补给。',
    equipmentAdvice:
      dailyMaxTemp >= 30
        ? '防晒遮阳帽、偏光太阳镜、防晒冰袖/防晒衣、2L+便携水壶与电解质粉、排汗速干衣、登山杖'
        : '轻量双肩背包、防晒遮阳帽、偏光太阳镜、防晒喷雾、便携保温水壶、充电宝；早晚备薄防风外套，如有降雨概率携带轻量折叠伞。',
    hourlyScores,
  };
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
