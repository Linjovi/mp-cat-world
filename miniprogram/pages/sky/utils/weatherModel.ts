import {
  HourlyWeatherData,
  DailyForecastEvaluation,
  PhenomenonPrediction,
  EvaluationFactor,
  WeatherApiResponse,
} from '../types';
import { calculateMoonInfo, formatHourTime, shiftTimeString } from './astronomy';

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
  elevation: number;
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
  }[];
}

/**
 * Filter hourly data for a single day (00:00 to 23:00)
 */
function extractDayHours(
  hourly: HourlyWeatherData,
  targetDate: string
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
  const avgCloudLow = Math.round(sample.reduce((s, h) => s + h.cloudLow, 0) / (sample.length || 1));
  const avgCloudMid = Math.round(sample.reduce((s, h) => s + h.cloudMid, 0) / (sample.length || 1));
  const avgCloudHigh = Math.round(sample.reduce((s, h) => s + h.cloudHigh, 0) / (sample.length || 1));
  const avgWind = Math.round(sample.reduce((s, h) => s + h.windSpeed, 0) / (sample.length || 1));
  const avgPrecipProb = Math.round(sample.reduce((s, h) => s + h.precipProb, 0) / (sample.length || 1));
  const avgDewSpread = Math.round(sample.reduce((s, h) => s + Math.abs(h.temp - h.dewPoint), 0) / (sample.length || 1));

  // Base score algorithm
  let score = 20;

  // 1. Low cloud coverage (ideal is 60% - 95% low cloud layer acting as the cloud sea blanket)
  if (avgCloudLow >= 65 && avgCloudLow <= 95) score += 32;
  else if (avgCloudLow >= 45 && avgCloudLow < 65) score += 22;
  else if (avgCloudLow > 95) score += 18; // slightly thick, but might breach summit
  else if (avgCloudLow >= 25) score += 12;

  // 2. High humidity & small dew point spread (fog / condensation formation)
  if (avgHumidity >= 85) score += 24;
  else if (avgHumidity >= 70) score += 16;
  else if (avgHumidity >= 55) score += 8;

  if (avgDewSpread <= 2.5) score += 12;
  else if (avgDewSpread <= 4.5) score += 6;

  // 3. Mid/High cloud clearance (above the cloud sea, sky must be clear/sunny)
  const overheadCloud = (avgCloudMid + avgCloudHigh) / 2;
  if (overheadCloud <= 25) score += 18;
  else if (overheadCloud <= 50) score += 10;
  else score -= 8; // covered by high overcast

  // 4. Wind stability (calm winds let clouds pool in the valleys, strong wind tears it apart)
  if (avgWind <= 12) score += 10;
  else if (avgWind <= 20) score += 4;
  else if (avgWind > 28) score -= 15;

  // 5. Elevation bonus (cloud seas usually form at 800m - 2000m)
  if (ctx.elevation >= 800) score += 6;
  if (ctx.elevation >= 1300) score += 4;
  if (ctx.elevation < 200) score -= 8; // flat terrain rarely has mountain cloud sea

  // Heavy rain penalty
  // 1. Calculate effective window duration for mountain cloud sea
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

  let windowFactor = 0.90;
  let windowStatus: 'optimal' | 'good' | 'moderate' = 'good';
  let windowLabel = '适中稳定';
  if (windowMinutes >= 150) {
    windowFactor = 0.98;
    windowStatus = 'optimal';
    windowLabel = '绵延充裕';
  } else if (windowMinutes >= 100) {
    windowFactor = 0.90;
    windowStatus = 'good';
    windowLabel = '适中稳定';
  } else if (windowMinutes >= 60) {
    windowFactor = 0.82;
    windowStatus = 'moderate';
    windowLabel = '窗口偏短·消散快';
  } else {
    windowFactor = 0.70;
    windowStatus = 'moderate';
    windowLabel = '稍纵即散';
  }

  const sunriseHHMM = ctx.sunriseTime || '06:00';
  const bestTimeStart = shiftTimeString(sunriseHHMM, -40);
  const bestTimeEnd = shiftTimeString(sunriseHHMM, Math.min(180, windowMinutes));

  // 2. Hourly curve based on atmospheric stability & temperature inversion
  const rawHourlyScores = ctx.hourly.map((h) => {
    let hScore = 20;
    if (h.cloudLow >= 60 && h.cloudLow <= 95) hScore += 30;
    else if (h.cloudLow >= 40) hScore += 18;
    else if (h.cloudLow >= 20) hScore += 8;

    if (h.humidity >= 85) hScore += 24;
    else if (h.humidity >= 70) hScore += 15;
    else if (h.humidity >= 55) hScore += 6;

    const overHead = (h.cloudMid + h.cloudHigh) / 2;
    if (overHead <= 25) hScore += 16;
    else if (overHead <= 50) hScore += 8;

    if (h.windSpeed <= 12) hScore += 10;
    else if (h.windSpeed > 24) hScore -= 12;

    if (ctx.elevation >= 800) hScore += 6;
    if (h.precipProb > 70) hScore -= 20;

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

    let combined = Math.round(hScore * timeFactor);
    combined = Math.max(0, Math.min(100, combined));

    return {
      hour: h.time,
      displayHour: `${String(h.hourNum).padStart(2, '0')}:00`,
      score: combined,
      cloudCover: h.cloudTotal,
      detail: `${timeLabel} (低云${h.cloudLow}% 湿度${h.humidity}%)`,
      isMorningPeak: h.hourNum >= 5 && h.hourNum <= 8,
    };
  });

  const peakMorningScore = Math.max(...rawHourlyScores.map((r) => r.score));

  // 3. Daily score derived from peak morning intensity discounted by window duration factor
  let dailyScore = Math.round(peakMorningScore * windowFactor);
  if (avgPrecipProb > 70) dailyScore = Math.round(dailyScore * 0.75);
  dailyScore = Math.max(0, Math.min(peakMorningScore, dailyScore)); // Never exceed hourly peak

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
      name: '低层云被覆盖度',
      value: `${avgCloudLow}%`,
      status: avgCloudLow >= 60 ? 'optimal' : avgCloudLow >= 35 ? 'good' : 'moderate',
      hint: avgCloudLow >= 60 ? '低云聚集充沛，具备云海厚度' : '低层云量偏少，可能仅有轻雾',
      weightLabel: '核心'
    },
    {
      name: '近地相对湿度',
      value: `${avgHumidity}%`,
      status: avgHumidity >= 80 ? 'optimal' : avgHumidity >= 65 ? 'good' : 'moderate',
      hint: avgHumidity >= 80 ? '湿度接近饱和，极利于水汽凝结' : '水汽略显干燥，凝聚慢',
      weightLabel: '核心'
    },
    {
      name: '逆温层稳定持续窗口',
      value: `约${windowMinutes}分钟 · ${windowLabel} (系数${Math.round(windowFactor * 100)}%)`,
      status: windowStatus,
      hint:
        windowMinutes >= 120
          ? '山谷逆温层稳固，云海漫延从容持久，观赏拍摄容错高'
          : '受风速或升温影响，云海消散较快，建议抢占日出首发窗口',
      weightLabel: '窗口'
    },
    {
      name: '高空晴朗透光度',
      value: `${Math.round(100 - overheadCloud)}%`,
      status: overheadCloud <= 30 ? 'optimal' : overheadCloud <= 60 ? 'good' : 'unfavorable',
      hint: overheadCloud <= 30 ? '头顶碧空万里，蓝天云海对比鲜明' : '中高层有云遮挡部分阳光',
      weightLabel: '关键'
    },
    {
      name: '地形海拔契合度',
      value: ctx.elevation ? `${ctx.elevation} 米` : '未标定',
      status: ctx.elevation >= 800 ? 'optimal' : ctx.elevation >= 400 ? 'good' : 'moderate',
      hint: ctx.elevation >= 800 ? '海拔高于常规逆温凝结层' : '地势较低，建议登至高处眺望',
      weightLabel: '地形'
    }
  ];

  const hourlyScores = rawHourlyScores.map((item) => ({
    hour: item.hour,
    displayHour: item.displayHour,
    score: item.score,
    cloudCover: item.cloudCover,
    detail: item.detail,
  }));

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

  // Sample dawn-to-sunrise window (from 40 min before sunrise to 30 min after sunrise)
  const sunriseHours = ctx.hourly.filter((h) => {
    const hStart = h.hourNum * 60;
    const hEnd = (h.hourNum + 1) * 60;
    return hEnd > sunriseMinutes - 40 && hStart < sunriseMinutes + 35;
  });
  const sample = sunriseHours.length > 0 ? sunriseHours : ctx.hourly.slice(5, 7);

  const avgCloudLow = Math.round(sample.reduce((s, h) => s + h.cloudLow, 0) / (sample.length || 1));
  const avgCloudTotal = Math.round(sample.reduce((s, h) => s + h.cloudTotal, 0) / (sample.length || 1));
  const avgVisibility = Math.round(sample.reduce((s, h) => s + h.visibilityKm, 0) / (sample.length || 1));
  const avgPrecipProb = Math.round(sample.reduce((s, h) => s + h.precipProb, 0) / (sample.length || 1));
  const avgPrecip = sample.reduce((s, h) => s + (h.precip || 0), 0) / (sample.length || 1);
  const avgHumidity = Math.round(sample.reduce((s, h) => s + h.humidity, 0) / (sample.length || 1));

  // 1. East Low Cloud Factor (Weight: 40 pts)
  // Low cloud at eastern horizon is the single most critical factor for seeing the sun disk
  let scoreLowCloud = 40;
  if (avgCloudLow <= 10) {
    scoreLowCloud = 40;
  } else if (avgCloudLow <= 20) {
    scoreLowCloud = 35 + ((20 - avgCloudLow) / 10) * 5;
  } else if (avgCloudLow <= 35) {
    scoreLowCloud = 24 + ((35 - avgCloudLow) / 15) * 11;
  } else if (avgCloudLow <= 50) {
    scoreLowCloud = 12 + ((50 - avgCloudLow) / 15) * 12;
  } else {
    scoreLowCloud = Math.max(0, 12 - (avgCloudLow - 50) * 0.25);
  }

  // 2. Sky Openness & Total Cloud Cover (Weight: 25 pts)
  // Clear blue/open skies are best for seeing the sun disk and dramatic dawn horizon
  let scoreSkyOpenness = 25;
  if (avgCloudTotal <= 15) {
    scoreSkyOpenness = 25;
  } else if (avgCloudTotal <= 35) {
    scoreSkyOpenness = 20 + ((35 - avgCloudTotal) / 20) * 5;
  } else if (avgCloudTotal <= 60) {
    scoreSkyOpenness = 12 + ((60 - avgCloudTotal) / 25) * 8;
  } else if (avgCloudTotal <= 80) {
    scoreSkyOpenness = 4 + ((80 - avgCloudTotal) / 20) * 8;
  } else {
    scoreSkyOpenness = Math.max(0, 4 - (avgCloudTotal - 80) * 0.2);
  }

  // 3. Horizontal Visibility (Weight: 20 pts)
  // High visibility ensures razor-sharp red sun edge and clean horizon
  let scoreVisibility = 20;
  if (avgVisibility >= 20) {
    scoreVisibility = 20;
  } else if (avgVisibility >= 15) {
    scoreVisibility = 16 + ((avgVisibility - 15) / 5) * 4;
  } else if (avgVisibility >= 10) {
    scoreVisibility = 11 + ((avgVisibility - 10) / 5) * 5;
  } else if (avgVisibility >= 5) {
    scoreVisibility = 5 + ((avgVisibility - 5) / 5) * 6;
  } else {
    scoreVisibility = Math.max(0, avgVisibility);
  }

  // 4. Precipitation & Clear Guarantee (Weight: 15 pts)
  let scorePrecip = 15;
  if (avgPrecipProb <= 10 && avgPrecip === 0) {
    scorePrecip = 15;
  } else if (avgPrecipProb <= 25) {
    scorePrecip = 10 + ((25 - avgPrecipProb) / 15) * 5;
  } else if (avgPrecipProb <= 45) {
    scorePrecip = 4 + ((45 - avgPrecipProb) / 20) * 6;
  } else {
    scorePrecip = 0;
  }

  // Base optical score (0 - 100)
  let dailyBaseScore = scoreLowCloud + scoreSkyOpenness + scoreVisibility + scorePrecip;

  // Severe condition penalties
  if (avgPrecipProb > 50 || avgPrecip > 0.2) {
    dailyBaseScore = Math.round(dailyBaseScore * 0.45); // Rain strongly suppresses sunrise viewing
  } else if (avgPrecipProb > 35) {
    dailyBaseScore = Math.round(dailyBaseScore * 0.75);
  }

  // Ground fog / saturated humidity penalty (unless visibility is high or on mountain peaks)
  if (avgHumidity >= 96 && avgVisibility < 8) {
    dailyBaseScore = Math.max(0, dailyBaseScore - 8);
  }

  const finalDailyScore = Math.max(0, Math.min(100, Math.round(dailyBaseScore)));

  // 24-hour hourly score calculation with astronomical solar angle weighting
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
    if (h.precipProb <= 10) hPrecipScore = 15;
    else if (h.precipProb <= 25) hPrecipScore = 10;
    else if (h.precipProb <= 45) hPrecipScore = 4;
    else hPrecipScore = 0;

    let hBase = hLowScore + hOpenScore + hVisScore + hPrecipScore;
    if (h.precipProb > 50 || (h.precip || 0) > 0.2) hBase *= 0.45;

    // Time weighting: Sunrise peak moment
    let timeWeight = 0.08;
    let timingLabel = '非日出时段';

    if (diffFromSunrise >= -25 && diffFromSunrise <= 30) {
      // Prime sunrise window: solar disk crossing the horizon
      timeWeight = 1.0;
      timingLabel = Math.abs(diffFromSunrise) <= 15 ? '红日跃出地平黄金时段' : '破晓出升核心期';
    } else if (diffFromSunrise < -25 && diffFromSunrise >= -75) {
      // Pre-dawn dawn glow & nautical twilight
      const ratio = (-25 - diffFromSunrise) / 50;
      timeWeight = 0.85 - ratio * 0.35;
      timingLabel = '黎明破晓曙光期';
    } else if (diffFromSunrise > 30 && diffFromSunrise <= 90) {
      // Post-sunrise morning golden rays
      const ratio = (diffFromSunrise - 30) / 60;
      timeWeight = 0.70 - ratio * 0.35;
      timingLabel = '旭日晨光初照时段';
    }

    let hFinal = Math.round(hBase * timeWeight);
    hFinal = Math.max(0, Math.min(100, hFinal));

    return {
      h,
      score: hFinal,
      timeWeight,
      timingLabel,
    };
  });

  // Determine Level & Summary
  let level: PhenomenonPrediction['level'] = 'poor';
  let levelLabel = '阴云遮日·较差';
  let levelBadgeColor = 'bg-slate-500/20 text-slate-300 border-slate-600/30';
  let summary = '东向地平低云厚重、阴天或有降水，日出时太阳被厚云完全封死，难见红日破晓。';

  if (finalDailyScore >= 82) {
    level = 'excellent';
    levelLabel = '金轮破晓·极佳';
    levelBadgeColor = 'bg-rose-500/20 text-rose-300 border-rose-500/40';
    summary = `极佳观测日！东方地平线通透无阻，晴空万里。日出时刻将清晰目睹火红圆润的日轮跃出地平线，晨光万道金芒四射！`;
  } else if (finalDailyScore >= 65) {
    level = 'good';
    levelLabel = '红日初升·良好';
    levelBadgeColor = 'bg-orange-500/20 text-orange-300 border-orange-500/40';
    summary = `气象条件良好，东方地平线视线开阔，少量轻云点缀，日轮破晓与天际色彩层次分明，非常适合观赏与拍摄。`;
  } else if (finalDailyScore >= 45) {
    level = 'moderate';
    levelLabel = '云隙见日·一般';
    levelBadgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    summary = `云量偏多或低空有间隙云带，太阳可能在云缝中漏光或稍晚穿透云层露面，地平线瞬间可能受挡。`;
  }

  // Sunrise observation window: 20 mins before sunrise to 25 mins after sunrise
  const bestStart = shiftTimeString(sunriseHHMM, -20);
  const bestEnd = shiftTimeString(sunriseHHMM, 25);

  const factors: EvaluationFactor[] = [
    {
      name: '东向地平通透度 (低云)',
      value: `低云 ${avgCloudLow}%`,
      status: avgCloudLow <= 15 ? 'optimal' : avgCloudLow <= 35 ? 'good' : avgCloudLow <= 50 ? 'moderate' : 'unfavorable',
      hint:
        avgCloudLow <= 15
          ? '东方地平线无低云阻隔，能完整目睹太阳跃出'
          : avgCloudLow <= 35
          ? '有零散低云，日轮可能有轻微云翳穿过'
          : '低空云墙较厚，地平线日出大概率被遮挡',
      weightLabel: '核心 40%'
    },
    {
      name: '天空晴朗开阔度 (总云量)',
      value: `总云量 ${avgCloudTotal}%`,
      status: avgCloudTotal <= 25 ? 'optimal' : avgCloudTotal <= 55 ? 'good' : avgCloudTotal <= 75 ? 'moderate' : 'unfavorable',
      hint:
        avgCloudTotal <= 25
          ? '晴空如洗，日出光芒纯粹无碍'
          : avgCloudTotal <= 55
          ? '晴间多云，有薄云点缀朝晨光彩'
          : '云层密闭，阳光穿透力弱',
      weightLabel: '重要 25%'
    },
    {
      name: '水平大气能见度 (锐度)',
      value: `${avgVisibility} km`,
      status: avgVisibility >= 18 ? 'optimal' : avgVisibility >= 10 ? 'good' : avgVisibility >= 6 ? 'moderate' : 'unfavorable',
      hint:
        avgVisibility >= 18
          ? '大气通透纯净，日轮边缘锐利、剪影分明'
          : avgVisibility >= 10
          ? '视野良好，略有轻微晨霭'
          : '晨雾或霾较重，太阳轮廓模糊泛白',
      weightLabel: '关键 20%'
    },
    {
      name: '降水干扰概率 (保障)',
      value: `${avgPrecipProb}%`,
      status: avgPrecipProb <= 10 ? 'optimal' : avgPrecipProb <= 25 ? 'good' : avgPrecipProb <= 50 ? 'moderate' : 'unfavorable',
      hint: avgPrecipProb <= 10 ? '晴空无雨，观测极度安全稳定' : avgPrecipProb <= 25 ? '降水概率较低，基本无雨' : '有降雨云团，观测风险极高',
      weightLabel: '保障 15%'
    },
    {
      name: '晨间近地水汽 (晨雾消散)',
      value: `湿度 ${avgHumidity}%`,
      status: avgHumidity <= 85 ? 'optimal' : avgHumidity <= 94 ? 'good' : 'moderate',
      hint:
        avgHumidity <= 85
          ? '近地水汽适中，无浓重贴地辐射雾干扰'
          : avgHumidity <= 94
          ? '湿度较高，低洼平原可能形成短暂晨雾'
          : '近地湿度饱和，平原易现浓雾，高山则易伴随云海金顶',
      weightLabel: '参考'
    }
  ];

  const hourlyScores = rawSunriseHourly.map(({ h, score: hScore, timeWeight, timingLabel }) => ({
    hour: h.time,
    displayHour: `${String(h.hourNum).padStart(2, '0')}:00`,
    score: hScore,
    cloudCover: h.cloudTotal,
    detail:
      timeWeight >= 0.5
        ? `${timingLabel} (低云${h.cloudLow}% 总云${h.cloudTotal}% 能见度${h.visibilityKm}km)`
        : `${timingLabel} (日出在${sunriseHHMM})`,
  }));

  return {
    id: 'sunrise',
    title: '红日初升',
    subtitle: '金轮破晓·晨光万道',
    score: finalDailyScore,
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
  const avgVisibility = Math.round(sample.reduce((s, h) => s + h.visibilityKm, 0) / (sample.length || 1));
  const avgPrecipProb = Math.round(sample.reduce((s, h) => s + h.precipProb, 0) / (sample.length || 1));

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

  let windowFactor = 0.95;
  let windowStatus: 'optimal' | 'good' | 'moderate' = 'optimal';
  let windowLabel = '充裕从容';
  if (windowMinutes >= 40) {
    windowFactor = 0.98;
    windowStatus = 'optimal';
    windowLabel = '充裕从容';
  } else if (windowMinutes >= 28) {
    windowFactor = 0.90;
    windowStatus = 'good';
    windowLabel = '标准适宜';
  } else if (windowMinutes >= 18) {
    windowFactor = 0.82;
    windowStatus = 'moderate';
    windowLabel = '偏紧凑·抓拍';
  } else {
    windowFactor = 0.70;
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

    if (h.precipProb > 50) optScore -= 25;
    else if (h.precipProb <= 15) optScore += 5;
    optScore = Math.max(0, Math.min(100, optScore));

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

    return {
      h,
      score: hScore,
      timeWeight,
      timingLabel,
      hScreen,
    };
  });

  const peakHourlyScore = Math.max(...rawSunsetHourly.map((r) => r.score));

  // 3. Daily overall score: derived from Peak Potential discounted by Window Duration Factor
  let dailyScore = Math.round(peakHourlyScore * windowFactor);
  if (avgPrecipProb > 50) dailyScore = Math.round(dailyScore * 0.75);
  dailyScore = Math.max(0, Math.min(peakHourlyScore, dailyScore)); // Never exceed peak hourly score

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
      name: '西向地平光路 (低云遮挡)',
      value: `低云 ${avgCloudLow}%`,
      status: avgCloudLow <= 25 ? 'optimal' : avgCloudLow <= 40 ? 'good' : 'unfavorable',
      hint: avgCloudLow <= 25 ? '落日入射角度完美，无厚重低云遮挡' : '西侧有云遮挡，余晖受阻',
      weightLabel: '核心'
    },
    {
      name: '天幕承载云量 (火烧云层)',
      value: `中高云 ${screenCloud}%`,
      status: screenCloud >= 35 && screenCloud <= 75 ? 'optimal' : 'good',
      hint: screenCloud >= 35 && screenCloud <= 75 ? '中高层卷云/透光高积云，火烧云天幕成型' : '云层较少或过于密实',
      weightLabel: '核心'
    },
    {
      name: '受光观赏窗口时长',
      value: `${windowMinutes}分钟 · ${windowLabel} (系数${Math.round(windowFactor * 100)}%)`,
      status: windowStatus,
      hint:
        windowMinutes >= 35
          ? '西向低云阻碍小，火烧云演变平缓充裕，成片率高'
          : '受西向低云压制，火烧云爆发时段偏短，抓拍需迅速',
      weightLabel: '窗口'
    },
    {
      name: '水平能见度',
      value: `${avgVisibility} km`,
      status: avgVisibility >= 15 ? 'optimal' : avgVisibility >= 8 ? 'good' : 'moderate',
      hint: avgVisibility >= 15 ? '空气通透澄澈，色彩反差与饱和度高' : '存在轻度霾气，色彩略显灰蒙',
      weightLabel: '关键'
    },
    {
      name: '降水与雷暴概率',
      value: `${avgPrecipProb}%`,
      status: avgPrecipProb <= 20 ? 'optimal' : avgPrecipProb <= 45 ? 'good' : 'unfavorable',
      hint: avgPrecipProb <= 20 ? '气压稳定，无降雨云层冲刷' : '有局部阵雨可能',
      weightLabel: '参考'
    }
  ];

  const hourlyScores = rawSunsetHourly.map(({ h, score: hScore, timeWeight, timingLabel, hScreen }) => ({
    hour: h.time,
    displayHour: `${String(h.hourNum).padStart(2, '0')}:00`,
    score: hScore,
    cloudCover: h.cloudTotal,
    detail:
      timeWeight >= 0.5
        ? `${timingLabel} (低云${h.cloudLow}% 中高云${hScreen}%)`
        : `${timingLabel} (日落在${sunsetHHMM})`,
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

  // Night hours: 21:00 to 04:00
  const nightHours = ctx.hourly.filter((h) => h.hourNum >= 21 || h.hourNum <= 4);
  const sample = nightHours.length > 0 ? nightHours : ctx.hourly.filter((h) => h.hourNum >= 20);

  const avgCloudTotal = Math.round(sample.reduce((s, h) => s + h.cloudTotal, 0) / (sample.length || 1));
  const avgHumidity = Math.round(sample.reduce((s, h) => s + h.humidity, 0) / (sample.length || 1));
  const avgVisibility = Math.round(sample.reduce((s, h) => s + h.visibilityKm, 0) / (sample.length || 1));
  const avgWind = Math.round(sample.reduce((s, h) => s + h.windSpeed, 0) / (sample.length || 1));
  const avgPrecipProb = Math.round(sample.reduce((s, h) => s + h.precipProb, 0) / (sample.length || 1));

  let score = 30;

  // 1. Night cloud cover (0% is absolute king for astronomy)
  if (avgCloudTotal <= 10) score += 42;
  else if (avgCloudTotal <= 25) score += 28;
  else if (avgCloudTotal <= 45) score += 12;
  else if (avgCloudTotal <= 70) score -= 10;
  else score -= 35;

  // 2. Moon light interference
  if (moonInfo.illuminationPct <= 15) score += 20; // new moon
  else if (moonInfo.illuminationPct <= 35) score += 12;
  else if (moonInfo.illuminationPct <= 65) score += 0;
  else score -= 18; // full moon washes out Milky Way

  // 3. Humidity (low humidity prevents lens fogging and light scattering)
  if (avgHumidity <= 60) score += 12;
  else if (avgHumidity <= 75) score += 6;
  else score -= 8;

  // 4. Visibility & Transparency
  if (avgVisibility >= 20) score += 12;
  else if (avgVisibility >= 12) score += 6;
  else score -= 10;

  // 5. Elevation advantage (less atmosphere, darker skies)
  if (ctx.elevation >= 1500) score += 8;
  else if (ctx.elevation >= 800) score += 4;

  if (avgWind <= 15) score += 5;
  else if (avgWind > 25) score -= 8;

  if (avgPrecipProb > 30) score -= 25;

  score = Math.max(0, Math.min(100, Math.round(score)));

  // 1. Calculate continuous night clear window hours
  const nightHoursForWindow = ctx.hourly.filter((h) => h.hourNum >= 21 || h.hourNum <= 4);
  const clearNightHours = nightHoursForWindow.filter((h) => h.cloudTotal <= 25 && h.precipProb <= 25).length;
  let windowHours = clearNightHours;
  let windowFactor = 0.90;
  let windowStatus: 'optimal' | 'good' | 'moderate' = 'good';
  let windowLabel = '适中稳定';

  if (windowHours >= 5) {
    windowFactor = 0.98;
    windowStatus = 'optimal';
    windowLabel = '通宵纯黑';
  } else if (windowHours >= 3) {
    windowFactor = 0.90;
    windowStatus = 'good';
    windowLabel = '充裕从容';
  } else if (windowHours >= 1.5) {
    windowFactor = 0.80;
    windowStatus = 'moderate';
    windowLabel = '间歇晴空·抓拍';
  } else {
    windowFactor = 0.65;
    windowStatus = 'moderate';
    windowLabel = '短暂云隙';
  }

  // 2. Hourly scores calculation
  const rawNightHourly = ctx.hourly.map((h) => {
    // Daytime is 0
    if (h.hourNum >= 7 && h.hourNum <= 18) {
      return {
        hour: h.time,
        displayHour: `${String(h.hourNum).padStart(2, '0')}:00`,
        score: 0,
        cloudCover: h.cloudTotal,
        detail: '日间日光漫射 (无法观星)',
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

    if (moonInfo.illuminationPct <= 15) optScore += 20;
    else if (moonInfo.illuminationPct <= 35) optScore += 12;
    else if (moonInfo.illuminationPct <= 65) optScore += 0;
    else optScore -= 18;

    if (h.humidity <= 60) optScore += 12;
    else if (h.humidity <= 75) optScore += 6;
    else optScore -= 8;

    if (h.visibilityKm >= 20) optScore += 12;
    else if (h.visibilityKm >= 12) optScore += 6;
    else optScore -= 10;

    if (ctx.elevation >= 1500) optScore += 8;
    else if (ctx.elevation >= 800) optScore += 4;

    if (h.precipProb > 30) optScore -= 25;

    let hScore = Math.round(optScore * timeMultiplier);
    hScore = Math.max(0, Math.min(100, hScore));

    return {
      hour: h.time,
      displayHour: `${String(h.hourNum).padStart(2, '0')}:00`,
      score: hScore,
      cloudCover: h.cloudTotal,
      detail: `${periodName} (云量${h.cloudTotal}% 湿度${h.humidity}%)`,
    };
  });

  const peakNightScore = Math.max(...rawNightHourly.map((r) => r.score));

  // 3. Daily score derived from peak night condition discounted by window factor
  let dailyScore = Math.round(peakNightScore * windowFactor);
  if (avgPrecipProb > 30) dailyScore = Math.round(dailyScore * 0.75);
  dailyScore = Math.max(0, Math.min(peakNightScore, dailyScore)); // Never exceed peak hourly score

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
  const bortleEst = ctx.elevation > 2000 && dailyScore > 75 ? 'Class 2-3 (极优暗夜)' :
                    ctx.elevation > 800 && dailyScore > 60 ? 'Class 3-4 (乡村郊野)' :
                    dailyScore > 50 ? 'Class 4-5 (城郊交界)' : 'Class 6-7 (光污染显著)';

  const factors: EvaluationFactor[] = [
    {
      name: '夜间总云量 (黑空纯度)',
      value: `${avgCloudTotal}%`,
      status: avgCloudTotal <= 15 ? 'optimal' : avgCloudTotal <= 35 ? 'good' : 'unfavorable',
      hint: avgCloudTotal <= 15 ? '夜空几乎万里无云，恒星无遮挡' : '存在部分低云或中云飘过',
      weightLabel: '核心'
    },
    {
      name: `月相与照度 (${moonInfo.phaseName})`,
      value: `月面亮度 ${moonInfo.illuminationPct}%`,
      status: moonInfo.illuminationPct <= 25 ? 'optimal' : moonInfo.illuminationPct <= 60 ? 'good' : 'unfavorable',
      hint: moonInfo.moonDescription,
      weightLabel: '核心'
    },
    {
      name: '纯黑无云晴空窗口',
      value: `约${windowHours}小时 · ${windowLabel} (系数${Math.round(windowFactor * 100)}%)`,
      status: windowStatus,
      hint:
        windowHours >= 4
          ? '通宵或大半夜纯黑无云，适宜深空深长曝光与整夜星轨'
          : '晴空窗口有限，建议在核心时段提前对焦并紧凑拍摄',
      weightLabel: '窗口'
    },
    {
      name: '夜间相对湿度 (防结露)',
      value: `${avgHumidity}%`,
      status: avgHumidity <= 65 ? 'optimal' : avgHumidity <= 80 ? 'good' : 'unfavorable',
      hint: avgHumidity <= 65 ? '空气干燥，镜头镜片不易结露起雾' : '湿度偏高，务必携带镜头加热带',
      weightLabel: '关键'
    },
    {
      name: '暗空参考等级评估',
      value: bortleEst,
      status: dailyScore >= 70 ? 'optimal' : 'good',
      hint: '结合海拔、光害估算与当前气象环境',
      weightLabel: '指数'
    }
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
  const avgHumidity = Math.round(sample.reduce((sum, h) => sum + h.humidity, 0) / (sample.length || 1));
  const avgWind = Math.round(sample.reduce((sum, h) => sum + h.windSpeed, 0) / (sample.length || 1));
  const maxWind = Math.max(...sample.map((h) => h.windSpeed || 0), 0);
  const avgVis = Math.round(sample.reduce((sum, h) => sum + h.visibilityKm, 0) / (sample.length || 1));
  const avgCloud = Math.round(sample.reduce((sum, h) => sum + h.cloudTotal, 0) / (sample.length || 1));
  const uv = uvIndexMax ?? (avgCloud < 40 ? 5 : 3);

  // Realistic, continuous meteorological scoring (Sum to 100 points maximum, no artificial hard caps or clamps)
  // 1. Precipitation & ground safety (Max 35 points)
  let rainScore = 0;
  if (totalRain === 0 && maxRainProb <= 15) {
    rainScore = 35;
  } else if (totalRain === 0 && maxRainProb <= 30) {
    rainScore = 28;
  } else if (totalRain <= 0.2 && maxRainProb <= 45) {
    rainScore = 20;
  } else if (totalRain <= 1.0 && maxRainProb <= 60) {
    rainScore = 12;
  } else if (totalRain <= 3.0) {
    rainScore = 5;
  } else {
    rainScore = 0;
  }

  // 2. Temperature & humidity thermal comfort for hiking (Max 30 points)
  // Hiking causes significant metabolic heat generation.
  let tempScore = 0;
  let tempStatus: 'optimal' | 'good' | 'moderate' | 'unfavorable' = 'good';
  let tempHint = '';
  if (dailyMaxTemp >= 16 && dailyMaxTemp <= 24 && dailyMinTemp >= 10) {
    tempScore = 30;
    tempStatus = 'optimal';
    tempHint = '人体温润黄金区间，久走不燥、体感极舒适';
  } else if (dailyMaxTemp >= 13 && dailyMaxTemp <= 27) {
    tempScore = 24;
    tempStatus = 'good';
    tempHint = '体感适宜，早晚略有温差，适度增减衣物';
  } else if (dailyMaxTemp >= 28 && dailyMaxTemp <= 30) {
    tempScore = 17;
    tempStatus = 'good';
    tempHint = '气温偏暖热，徒步易出汗，需备足饮水与电解质';
  } else if (dailyMaxTemp >= 31 && dailyMaxTemp <= 33) {
    tempScore = 10;
    tempStatus = 'moderate';
    tempHint = '高温偏闷热，正午登山易中暑脱水，建议避开11-15点高温段';
  } else if (dailyMaxTemp > 33) {
    tempScore = 2;
    tempStatus = 'unfavorable';
    tempHint = '酷暑高温，户外剧烈运动中暑风险极高，不建议长线徒步';
  } else if (dailyMaxTemp < 6) {
    tempScore = 8;
    tempStatus = 'moderate';
    tempHint = '体感严寒，山道有积冰湿滑风险，需专业防寒防滑装备';
  } else {
    tempScore = 18;
    tempStatus = 'good';
    tempHint = '气温微凉，请做好防风保暖';
  }

  // 3. Ultraviolet radiation (UV) load (Max 15 points)
  let uvScore = 0;
  let uvStatus: 'optimal' | 'good' | 'moderate' | 'unfavorable' = 'good';
  let uvHint = '';
  if (uv <= 2) {
    uvScore = 15;
    uvStatus = 'optimal';
    uvHint = '紫外线温和，无灼伤晒伤风险，极为安全舒适';
  } else if (uv <= 4) {
    uvScore = 12;
    uvStatus = 'good';
    uvHint = '紫外线中等，正常佩戴遮阳帽即可';
  } else if (uv <= 6) {
    uvScore = 8;
    uvStatus = 'good';
    uvHint = '紫外线偏强，阳光下久行需涂抹防晒霜并佩戴太阳镜';
  } else if (uv <= 8) {
    uvScore = 4;
    uvStatus = 'moderate';
    uvHint = '强紫外线暴晒！皮肤极易晒伤发红，务必做好物理遮阳与防晒';
  } else {
    uvScore = 0;
    uvStatus = 'unfavorable';
    uvHint = '极强紫外线！无遮挡山脊易灼伤脱皮，严禁长时间烈日暴晒';
  }

  // 4. Wind comfort (Max 10 points)
  let windScore = 0;
  let windStatus: 'optimal' | 'good' | 'moderate' | 'unfavorable' = 'good';
  if (avgWind <= 14 && maxWind <= 22) {
    windScore = 10;
    windStatus = 'optimal';
  } else if (avgWind <= 22) {
    windScore = 7;
    windStatus = 'good';
  } else if (maxWind >= 35 || avgWind > 30) {
    windScore = 0;
    windStatus = 'unfavorable';
  } else {
    windScore = 4;
    windStatus = 'moderate';
  }

  // 5. Air visibility (Max 10 points)
  let visScore = 0;
  let visStatus: 'optimal' | 'good' | 'moderate' = 'good';
  if (avgVis >= 18) {
    visScore = 10;
    visStatus = 'optimal';
  } else if (avgVis >= 10) {
    visScore = 7;
    visStatus = 'good';
  } else if (avgVis >= 5) {
    visScore = 4;
    visStatus = 'moderate';
  } else {
    visScore = 1;
    visStatus = 'moderate';
  }

  // Objective raw sum (0 to 100)
  let score = Math.round(rainScore + tempScore + uvScore + windScore + visScore);
  score = Math.max(0, Math.min(100, score));

  // Factors
  const factors: EvaluationFactor[] = [
    {
      name: '降水风险',
      value:
        totalRain === 0
          ? maxRainProb <= 15
            ? '0% · 全天干爽无雨'
            : `${maxRainProb}% · 偶有阴云但无降水`
          : `${totalRain.toFixed(1)}mm · 有降雨概率`,
      status: totalRain === 0 && maxRainProb <= 20 ? 'optimal' : totalRain <= 0.5 ? 'good' : totalRain <= 2 ? 'moderate' : 'unfavorable',
      hint: totalRain === 0 ? '地面干燥安全，无需携带雨具' : '建议随身备便携折叠雨伞防小雨',
      weightLabel: '核心关键',
    },
    {
      name: '体感温湿',
      value: `${Math.round(dailyMinTemp)}℃ ~ ${Math.round(dailyMaxTemp)}℃ · 湿度${avgHumidity}%`,
      status: tempStatus,
      hint: tempHint,
      weightLabel: '舒适度',
    },
    {
      name: '紫外防晒',
      value: `UV ${uv.toFixed(0)} · ${uv >= 7 ? '强紫外线' : uv >= 4 ? '中等偏强' : '温和舒适'}`,
      status: uvStatus,
      hint: uvHint,
      weightLabel: '户外防晒',
    },
    {
      name: '风力体感',
      value: `${avgWind <= 12 ? '1-2级微风' : avgWind <= 20 ? '3级和风' : '4级微劲风'} (${avgWind} km/h)`,
      status: windStatus,
      hint: avgWind <= 15 ? '和风拂面，适宜草坪露营放风筝与徒步' : '风力稍明显，山脊注意防风防凉',
      weightLabel: '体感轻重',
    },
    {
      name: '空气通透',
      value: `${avgVis} km · ${avgVis >= 20 ? '通透极佳' : avgVis >= 12 ? '通透良好' : '轻度薄雾'}`,
      status: visStatus,
      hint: avgVis >= 15 ? '视野宽广明亮，适宜登高远眺拍摄风光' : '能见度一般，适合近景林道漫步',
      weightLabel: '视野开阔',
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
      hint: '建议洋葱式多层穿搭，便于途中发热时穿脱调节',
      weightLabel: '出行着装',
    },
  ];

  let level: PhenomenonPrediction['level'] = 'poor';
  let levelLabel = '天气欠佳·不宜户外';
  let levelBadgeColor = 'bg-rose-50 text-rose-700 border-rose-200';
  let summary = '受降水、大风或体感不适影响，山地步道湿滑，户外游览体验受限，建议推迟出行或选择室内展馆游览。';

  if (score >= 85) {
    level = 'excellent';
    levelLabel = '黄金徒步·极佳';
    levelBadgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    summary = '气象条件极为理想！气温温润舒适，微风和煦且全天无有效降雨，适宜登山徒步、山野寻幽或露营野餐。';
  } else if (score >= 68) {
    level = 'good';
    levelLabel = '适宜徒步·良好';
    levelBadgeColor = 'bg-sky-50 text-sky-700 border-sky-200';
    summary =
      dailyMaxTemp >= 31
        ? '总体适宜户外活动，但正午前后气温偏高且紫外线强烈，推荐选择清晨或傍晚清凉时段，备足饮水与防晒。'
        : '总体天气较佳，体感温和，适合大部分山地步道与户外徒步路线，早晚略有温差，适宜规划半日或全日徒步。';
  } else if (score >= 50) {
    level = 'moderate';
    levelLabel = '徒步一般·慎行';
    levelBadgeColor = 'bg-amber-50 text-amber-700 border-amber-200';
    summary = '气象条件中等，可能存在偏热、强晒或局部零星小雨风险，山道可能有湿滑路段，建议选择平缓路线并备好防护。';
  }

  // Best time window
  let bestTimeWindow = '全天 08:30 - 17:00 (日间黄金徒步时段)';
  let bestTimeShort = '08:30 - 17:00';
  if (totalRain > 0 && maxRainProb > 40) {
    bestTimeWindow = '上午 08:30 - 12:00 (避开午后降雨时段)';
    bestTimeShort = '08:30 - 12:00';
  } else if (dailyMaxTemp >= 31) {
    bestTimeWindow = '清晨 06:30 - 09:30 · 傍晚 16:30 - 18:30 (正午酷热暴晒·避暑出行)';
    bestTimeShort = '早晚清凉时段';
  }

  // Hourly scores (24 hours) - 实事求是计算每小时气象适宜度
  const rawHikingHourly = ctx.hourly.map((h) => {
    // 1. Rain (0-35)
    let hRain = 35;
    if (h.precip > 2.0 || h.precipProb > 70) hRain = 0;
    else if (h.precip > 0.5 || h.precipProb > 50) hRain = 8;
    else if (h.precipProb > 30) hRain = 18;
    else if (h.precipProb > 15) hRain = 28;

    // 2. Temp (0-30)
    let hTemp = 30;
    if (h.temp >= 16 && h.temp <= 24) hTemp = 30;
    else if (h.temp >= 13 && h.temp <= 27) hTemp = 24;
    else if (h.temp >= 28 && h.temp <= 30) hTemp = 16;
    else if (h.temp >= 31 && h.temp <= 33) hTemp = 8;
    else if (h.temp > 33) hTemp = 2;
    else if (h.temp >= 6 && h.temp < 13) hTemp = 16;
    else hTemp = 6;

    // 3. Daylight & Sun intensity (0-15)
    let hSun = 15;
    if (h.hourNum < 6 || h.hourNum > 19) {
      hSun = 0; // Night hiking has dark, hazardous trails
    } else if (h.hourNum === 6 || h.hourNum === 19) {
      hSun = 8;
    } else if (h.hourNum >= 11 && h.hourNum <= 14 && uv >= 6) {
      hSun = 5; // Midday blazing sun
    } else {
      hSun = 14;
    }

    // 4. Wind (0-10)
    let hWind = 10;
    if (h.windSpeed <= 14) hWind = 10;
    else if (h.windSpeed <= 22) hWind = 7;
    else if (h.windSpeed <= 30) hWind = 3;
    else hWind = 0;

    // 5. Visibility (0-10)
    let hVis = 10;
    if (h.visibilityKm >= 18) hVis = 10;
    else if (h.visibilityKm >= 10) hVis = 7;
    else if (h.visibilityKm >= 5) hVis = 4;
    else hVis = 1;

    let hScore = Math.round(hRain + hTemp + hSun + hWind + hVis);
    hScore = Math.max(0, Math.min(100, hScore));

    return {
      hour: h.time,
      displayHour: `${String(h.hourNum).padStart(2, '0')}:00`,
      score: hScore,
      cloudCover: h.cloudTotal,
      detail: `${Math.round(h.temp)}℃ · ${h.precipProb}%雨率 · ${Math.round(h.windSpeed)}km/h风`,
      isDaytime: h.hourNum >= 7 && h.hourNum <= 18,
    };
  });

  const hourlyScores = rawHikingHourly.map((item) => ({
    hour: item.hour,
    displayHour: item.displayHour,
    score: item.score,
    cloudCover: item.cloudCover,
    detail: item.detail,
  }));

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
export function evaluateForecast(apiData: WeatherApiResponse): DailyForecastEvaluation[] {
  const result: DailyForecastEvaluation[] = [];
  const daily = apiData.daily;
  if (!daily || !daily.time) return result;

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

    const dayHours = extractDayHours(apiData.hourly, dateStr);

    const ctx: EvaluationContext = {
      dateStr,
      sunriseTime: sunriseHHMM,
      sunsetTime: sunsetHHMM,
      elevation: apiData.elevation || 0,
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

    // Pick top phenomenon highlight
    const scores = [
      { name: '出游', score: travelWeatherPred.score, obj: travelWeatherPred },
      { name: '云海', score: cloudSeaPred.score, obj: cloudSeaPred },
      { name: '日出', score: sunrisePred.score, obj: sunrisePred },
      { name: '晚霞', score: sunsetGlowPred.score, obj: sunsetGlowPred },
    ];
    scores.sort((a, b) => b.score - a.score);
    const top = scores[0];

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
