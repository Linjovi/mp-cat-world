import type { EvaluationFactor, PhenomenonPrediction } from '../../types';
import { shiftTimeString } from '../astronomy';
import type { EvaluationContext } from './context';
import { hazePenalty } from './haze';
import { peakScore } from './number';

/**
 * Evaluate Sunrise (日出)
 * Based on physical meteorological conditions for viewing sunrise:
 * 1. Eastern horizon low cloud cover (40% weight - core factor, cloud banks block the sun disk)
 * 2. Sky openness & total cloud cover (25% weight - clear skies allow sharp, crisp red sun)
 * 3. Horizontal visibility & air purity (20% weight - Rayleigh scattering & sharp disk contour)
 * 4. Precipitation guarantee (15% weight - rain kills sunrise)
 * 5. Ground moisture & radiation fog reference
 */
export function evaluateSunrise(ctx: EvaluationContext): PhenomenonPrediction {
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
