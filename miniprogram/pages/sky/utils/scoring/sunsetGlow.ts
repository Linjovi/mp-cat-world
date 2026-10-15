import type { EvaluationFactor, PhenomenonPrediction } from '../../types';
import { shiftTimeString } from '../astronomy';
import type { EvaluationContext, HourSlice, ScoreAdjustment, ScoreAdjustmentRange } from './context';
import { clamp, isFiniteNumber, roundTo } from './number';

/** 气溶胶修正：适中加分，灰霾扣分。有 AOD 时不再叠 PM2.5。 */
export const AEROSOL_ADJUSTMENT_RANGE: ScoreAdjustmentRange = { min: -12, max: 7 };

export interface AerosolInput {
  /** 550nm 气溶胶光学厚度，无量纲 */
  aerosolOpticalDepth?: number;
  /** PM2.5 浓度 (μg/m³)。仅在没有 AOD 时参与扣分。 */
  pm2_5?: number;
}

function lerp(a: number, b: number, fraction: number): number {
  return a + (b - a) * fraction;
}

/** 把 x 从 [x0, x1] 线性映射到 [y0, y1]，并夹在两端之间。 */
function ramp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x1 === x0) return y1;
  return lerp(y0, y1, clamp((x - x0) / (x1 - x0), 0, 1));
}

function lerpOptional(a: number | undefined, b: number | undefined, fraction: number): number | undefined {
  if (!isFiniteNumber(a) && !isFiniteNumber(b)) return undefined;
  if (!isFiniteNumber(a)) return b;
  if (!isFiniteNumber(b)) return a;
  return lerp(a, b, fraction);
}

/**
 * 晚霞气溶胶修正。
 * AOD：0 不加分，约 0.18 最高，0.5 回到 0，再往上连续扣到 -12。
 * 没有 AOD 时，PM2.5 从 35 连续扣到 150。
 */
export function evaluateSunsetAerosolAdjustment(input: AerosolInput): ScoreAdjustment {
  const notes: string[] = [];
  let delta = 0;

  if (isFiniteNumber(input.aerosolOpticalDepth)) {
    const aod = input.aerosolOpticalDepth;
    if (aod <= 0.18) delta = ramp(aod, 0, 0.18, 0, 7);
    else if (aod <= 0.5) delta = ramp(aod, 0.18, 0.5, 7, 0);
    else delta = ramp(aod, 0.5, 1, 0, -12);

    if (aod < 0.08) notes.push('大气很干净，通透但散射偏弱，霞色偏清淡');
    else if (aod <= 0.35) notes.push('气溶胶适中，有利于散射出更深的红光');
    else if (aod <= 0.5) notes.push('气溶胶略高，对霞色影响有限');
    else notes.push('气溶胶偏高，霞色容易发灰发闷');

    if (isFiniteNumber(input.pm2_5) && input.pm2_5 > 75) {
      notes.push(`PM2.5 ${Math.round(input.pm2_5)}，地面颗粒物偏高；评分以 AOD 为准`);
    }
  } else if (isFiniteNumber(input.pm2_5)) {
    const pm = input.pm2_5;
    delta = ramp(pm, 35, 150, 0, -12);
    if (pm <= 35) notes.push('缺少 AOD，PM2.5 优良，未额外加扣分');
    else if (pm <= 75) notes.push('缺少 AOD，按 PM2.5 轻度污染连续扣分');
    else if (pm <= 115) notes.push('缺少 AOD，按 PM2.5 中度污染连续扣分');
    else notes.push('缺少 AOD，PM2.5 重度污染，通透度差');
  } else {
    notes.push('缺少空气质量数据，未做气溶胶修正');
  }

  return {
    delta: roundTo(clamp(delta, AEROSOL_ADJUSTMENT_RANGE.min, AEROSOL_ADJUSTMENT_RANGE.max), 2),
    notes,
  };
}

interface SunsetSample {
  cloudLow: number;
  cloudMid: number;
  cloudHigh: number;
  humidity: number;
  visibilityKm: number;
  aerosolOpticalDepth?: number;
  pm2_5?: number;
  precip: number;
  precipProb: number;
  code: number;
}

function gauss(x: number, mu: number, sigma: number): number {
  return Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));
}

/** 过厚中云轻扣光路，从 65% 开始平滑渐进，满云保留七成六。不要把高云甜点核打穿。 */
function midLid(mid: number): number {
  return ramp(mid, 65, 100, 1, 0.76);
}

function overcastCrush(low: number, mid: number): number {
  return ramp(low, 70, 95, 0, 1) * ramp(mid, 70, 95, 0, 1);
}

function visibilityDelta(km: number): number {
  if (km < 10) return ramp(km, 4, 10, -12, 0);
  return ramp(km, 10, 20, 0, 6);
}

function humidityDelta(humidity: number, visibilityKm: number): number {
  if (humidity < 40) return ramp(humidity, 20, 40, 5, 0);
  if (humidity <= 80 || visibilityKm >= 12) return 0;
  return ramp(humidity, 80, 95, 0, -6);
}

function weatherFactor(sample: SunsetSample): number {
  let factor = 1;
  if (sample.code >= 95) {
    factor *= 0.3;
  } else if (sample.precip > 0.2) {
    factor *= ramp(sample.precip, 0.2, 3, 1, 0.48);
  }
  if (sample.precipProb > 70 && sample.code < 95) {
    factor *= ramp(sample.precipProb, 70, 100, 1, 0.92);
  }
  return factor;
}

function clampSunsetScore(value: number): number {
  return clamp(Math.round(value), 2, 99);
}

/**
 * 一小时光学质量，2–99。
 * 云层用 Afterglow 加法：25 底分 + 高云/中云高斯，晴空停在四十分左右。
 * 低云按比例扣；过厚中云轻扣、阴天再压；通透和降水仍连续修正。
 */
function scoreSunsetOptical(sample: SunsetSample): {
  score: number;
  aerosol: ScoreAdjustment;
  lightBlocked: boolean;
} {
  const low = sample.cloudLow;
  const mid = sample.cloudMid;
  const high = sample.cloudHigh;
  let score = 25 + 48 * gauss(high, 42, 24) + 16 * gauss(mid, 35, 22);
  if (low > 15) score -= 0.75 * (low - 15);
  score *= midLid(mid);
  const crush = overcastCrush(low, mid);
  if (crush > 0) score = lerp(score, Math.min(score, 10), crush);

  score += visibilityDelta(sample.visibilityKm);
  score += humidityDelta(sample.humidity, sample.visibilityKm);
  const aerosol = evaluateSunsetAerosolAdjustment({
    aerosolOpticalDepth: sample.aerosolOpticalDepth,
    pm2_5: sample.pm2_5,
  });
  score += aerosol.delta;
  score *= weatherFactor(sample);

  const lightPath = ramp(low, 15, 70, 1, 0.05) * midLid(mid);
  return {
    score: clampSunsetScore(score),
    aerosol,
    lightBlocked: lightPath < 0.25 || crush > 0.5,
  };
}

function sampleFromHour(hour: HourSlice): SunsetSample {
  return {
    cloudLow: hour.cloudLow,
    cloudMid: hour.cloudMid,
    cloudHigh: hour.cloudHigh,
    humidity: hour.humidity,
    visibilityKm: hour.visibilityKm,
    aerosolOpticalDepth: hour.aod,
    pm2_5: hour.pm2_5,
    precip: hour.precip,
    precipProb: hour.precipProb,
    code: hour.code,
  };
}

/** 把整点预报线性插值到日落时刻，离散的降水和天气码取更近的那个整点。 */
function sampleAtMinute(hours: HourSlice[], targetMinutes: number): SunsetSample {
  const sorted = [...hours].sort((a, b) => a.hourNum - b.hourNum);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  let prev = first;
  let next = first;
  if (targetMinutes <= first.hourNum * 60) {
    prev = first;
    next = first;
  } else if (targetMinutes >= last.hourNum * 60) {
    prev = last;
    next = last;
  } else {
    for (const hour of sorted) {
      if (hour.hourNum * 60 <= targetMinutes) prev = hour;
      if (hour.hourNum * 60 >= targetMinutes) {
        next = hour;
        break;
      }
    }
  }

  const span = next.hourNum * 60 - prev.hourNum * 60;
  const fraction = span === 0 ? 0 : clamp((targetMinutes - prev.hourNum * 60) / span, 0, 1);
  const discrete = fraction >= 0.5 ? next : prev;
  return {
    cloudLow: lerp(prev.cloudLow, next.cloudLow, fraction),
    cloudMid: lerp(prev.cloudMid, next.cloudMid, fraction),
    cloudHigh: lerp(prev.cloudHigh, next.cloudHigh, fraction),
    humidity: lerp(prev.humidity, next.humidity, fraction),
    visibilityKm: lerp(prev.visibilityKm, next.visibilityKm, fraction),
    aerosolOpticalDepth: lerpOptional(prev.aod, next.aod, fraction),
    pm2_5: lerpOptional(prev.pm2_5, next.pm2_5, fraction),
    precip: discrete.precip,
    precipProb: discrete.precipProb,
    code: discrete.code,
  };
}

function viewingWindowMinutes(sample: SunsetSample): number {
  let minutes = 48;
  if (sample.cloudLow > 15) minutes -= (sample.cloudLow - 15) * 0.42;
  minutes += 6 * gauss(sample.cloudHigh, 42, 24);
  const clearHigh = clamp(1 - sample.cloudHigh / 12, 0, 1);
  const clearMid = clamp(1 - sample.cloudMid / 12, 0, 1);
  minutes -= 8 * clearHigh * clearMid;
  return clamp(Math.round(minutes), 10, 50);
}

function sunsetTimeWeight(diffMinutes: number): { weight: number; label: string } {
  const distance = Math.abs(diffMinutes);
  if (distance <= 35) {
    return {
      weight: 1 - (distance / 35) * 0.12,
      label: distance <= 15 ? '火烧云高潮时段' : '夕照熔金爆发期',
    };
  }
  if (distance <= 80) {
    return {
      weight: 0.88 - ((distance - 35) / 45) * 0.38,
      label: diffMinutes > 0 ? '暮色余晖与冷暖对撞' : '夕照暖光斜射期',
    };
  }
  return {
    weight: ramp(distance, 80, 120, 0.5, 0.1),
    label: '非霞光时段',
  };
}

function cloudFactors(sample: SunsetSample, aerosol: ScoreAdjustment, lightBlocked: boolean): EvaluationFactor[] {
  const high = sample.cloudHigh;
  const mid = sample.cloudMid;
  const low = sample.cloudLow;
  const highStatus = high >= 18 && high <= 66 ? 'optimal' : high < 12 || high > 80 ? 'unfavorable' : 'good';
  const midStatus = mid >= 13 && mid <= 57 ? 'optimal' : mid > 80 ? 'unfavorable' : 'good';
  const lowStatus = low <= 15 ? 'optimal' : low <= 40 ? 'good' : 'unfavorable';
  const aerosolValue =
    sample.aerosolOpticalDepth === undefined && sample.pm2_5 === undefined
      ? '数据暂缺'
      : `AOD ${sample.aerosolOpticalDepth === undefined ? '--' : sample.aerosolOpticalDepth.toFixed(2)} · PM2.5 ${
          sample.pm2_5 === undefined ? '--' : Math.round(sample.pm2_5)
        }`;

  return [
    {
      name: '高云幕布',
      value: `高云 ${Math.round(high)}%`,
      status: highStatus,
      hint:
        high >= 18 && high <= 66
          ? '高云覆盖适中，适合承接落日红光'
          : high < 12
            ? '高云很少，晚霞缺少幕布'
            : high < 18
              ? '高云偏薄偏少，晚霞范围相对有限'
              : high > 80
                ? '高云过厚密闭，颜色容易发闷'
                : '高云偏厚，晚霞层次偏深沉',
    },
    {
      name: '中云纹理',
      value: `中云 ${Math.round(mid)}%`,
      status: midStatus,
      hint:
        mid >= 13 && mid <= 57
          ? '中云适量，能给晚霞增加层次'
          : mid > 80
            ? '中云过厚，霞光不容易透出来'
            : mid > 57
              ? '中云偏多，对高空云幕略有遮挡'
              : '中云偏少，纹理有限',
    },
    {
      name: '低云遮挡',
      value: `低云 ${Math.round(low)}%`,
      status: lowStatus,
      hint: lightBlocked
        ? '低云或中云过厚，照向云幕的光基本过不去'
        : low <= 15
          ? '低云少，落日光线更容易照到中高云'
          : low <= 40
            ? '有少量低云，局部可能遮挡视线'
            : '低云偏厚，容易挡住照向云幕的光',
    },
    {
      name: '空气干湿',
      value: `湿度 ${Math.round(sample.humidity)}%`,
      status:
        sample.humidity < 40 ? 'optimal' : sample.humidity <= 80 || sample.visibilityKm >= 12 ? 'good' : 'unfavorable',
      hint:
        sample.humidity < 40
          ? '空气干，色彩更容易保持饱和'
          : sample.humidity <= 80
            ? '湿度适中'
            : sample.visibilityKm >= 12
              ? '空气偏潮，能见度尚可，对霞色影响有限'
              : '空气偏潮且能见度偏差，霞色容易发灰',
    },
    {
      name: '水平能见度',
      value: `${Math.round(sample.visibilityKm)} km`,
      status: sample.visibilityKm >= 20 ? 'optimal' : sample.visibilityKm >= 10 ? 'good' : 'unfavorable',
      hint:
        sample.visibilityKm >= 20
          ? '能见度很好，色彩更干净'
          : sample.visibilityKm >= 10
            ? '能见度尚可，通透度随能见度连续变化'
            : '能见度偏差，霞色会发闷',
    },
    {
      name: '降水与雷暴概率',
      value: `${Math.round(sample.precipProb)}% · ${sample.precip.toFixed(1)}mm`,
      status:
        sample.code >= 95 || sample.precip > 0.2 ? 'unfavorable' : sample.precipProb <= 20 ? 'optimal' : 'good',
      hint:
        sample.code >= 95
          ? '有雷暴，这一小时评分按比例压低'
          : sample.precip > 0.2
            ? '已有降水，晚霞按雨量连续打折'
            : sample.precipProb <= 20
              ? '降水概率低'
              : '有阵雨可能；只有实况降水或雷暴才会明显压分',
    },
    {
      name: '空气通透 / 气溶胶',
      value: aerosolValue,
      status:
        sample.aerosolOpticalDepth === undefined && sample.pm2_5 === undefined
          ? 'moderate'
          : aerosol.delta > 0
            ? 'good'
            : aerosol.delta < 0
              ? 'unfavorable'
              : 'moderate',
      hint:
        sample.aerosolOpticalDepth === undefined && sample.pm2_5 === undefined
          ? '空气质量数据暂缺，晚霞评分未做气溶胶修正'
          : aerosol.notes.join('；'),
    },
  ];
}

/**
 * 晚霞 / 火烧云。
 * 日评分是日落时刻的插值结果，不再取全天最高小时。
 * 逐小时分数仍乘时间权重，用来画时间轴。
 */
export function evaluateSunsetGlow(ctx: EvaluationContext): PhenomenonPrediction {
  const sunsetHHMM = ctx.sunsetTime || '18:20';
  const [setH, setM] = sunsetHHMM.split(':').map(Number);
  const sunsetMinutes = (isNaN(setH) ? 18 : setH) * 60 + (isNaN(setM) ? 20 : setM);
  const sunsetSample = ctx.hourly.length
    ? sampleAtMinute(ctx.hourly, sunsetMinutes)
    : sampleFromHour({
        time: '',
        hourIndex: 0,
        hourNum: 0,
        temp: 0,
        humidity: 50,
        dewPoint: 0,
        precipProb: 0,
        precip: 0,
        code: 0,
        cloudTotal: 0,
        cloudLow: 0,
        cloudMid: 0,
        cloudHigh: 0,
        visibilityKm: 10,
        windSpeed: 0,
      });
  const sunsetOptical = scoreSunsetOptical(sunsetSample);
  const dailyScore = sunsetOptical.score;
  const windowMinutes = viewingWindowMinutes(sunsetSample);

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

  const rawSunsetHourly = ctx.hourly.map((hour) => {
    const diffFromSunset = (hour.hourNum + 0.5) * 60 - sunsetMinutes;
    const optical = scoreSunsetOptical(sampleFromHour(hour));
    const timing = sunsetTimeWeight(diffFromSunset);
    return {
      hour,
      score: clamp(Math.round(optical.score * timing.weight), 0, 99),
      timingLabel: timing.label,
      factors: cloudFactors(sampleFromHour(hour), optical.aerosol, optical.lightBlocked),
    };
  });

  let level: PhenomenonPrediction['level'] = 'poor';
  let levelLabel = '晚霞几率低';
  let levelBadgeColor = 'bg-slate-500/20 text-slate-300 border-slate-600/30';
  let summary = '低云偏厚挡住了照向云幕的光，或高云太少，出现火烧云的概率低。';

  if (dailyScore >= 78) {
    level = 'excellent';
    levelLabel = '绝美火烧云·极佳';
    levelBadgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    summary = `极佳观测期！高云有条件被照亮，低云不挡光路，落日前后容易出现成片火烧云（窗口约${windowMinutes}分钟）。`;
  } else if (dailyScore >= 60) {
    level = 'good';
    levelLabel = '瑰丽晚霞·良好';
    levelBadgeColor = 'bg-orange-500/20 text-orange-300 border-orange-500/40';
    summary = `暮色光影优良，日落时有机会出现暖金与粉紫色云霞（有效窗口约${windowMinutes}分钟）。`;
  } else if (dailyScore >= 40) {
    level = 'moderate';
    levelLabel = '温和夕照·一般';
    levelBadgeColor = 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40';
    summary = `日落时能看到一些暖色，火烧云成片的条件一般（窗口约${windowMinutes}分钟）。`;
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
          ? '低云阻碍小，火烧云演变更从容'
          : '低云偏厚，适合出片的时间更短',
    },
    {
      name: '落日云幕结构',
      value: `高${Math.round(sunsetSample.cloudHigh)}% · 中${Math.round(sunsetSample.cloudMid)}% · 低${Math.round(sunsetSample.cloudLow)}%`,
      status: sunsetOptical.lightBlocked ? 'unfavorable' : sunsetSample.cloudHigh >= 18 ? 'optimal' : 'good',
      hint: sunsetOptical.lightBlocked
        ? '低云或厚中云阻断入射光路，较难形成壮观晚霞'
        : sunsetSample.cloudHigh >= 18 && sunsetSample.cloudHigh <= 66
          ? '高云适量且低云较少，落日斜射光能有效照亮云幕'
          : sunsetSample.cloudHigh < 12
            ? '高云较少，缺少大面积火烧云幕布，以金色地平夕照为主'
            : '高云偏厚密闭，霞光容易显暗发沉',
    },
    {
      name: '大气通透与霞色散射',
      value:
        sunsetSample.aerosolOpticalDepth !== undefined
          ? `能见度 ${Math.round(sunsetSample.visibilityKm)}km · AOD ${sunsetSample.aerosolOpticalDepth.toFixed(2)}`
          : `能见度 ${Math.round(sunsetSample.visibilityKm)}km · ${sunsetSample.pm2_5 !== undefined ? `PM2.5 ${Math.round(sunsetSample.pm2_5)}` : '空气质量暂缺'}`,
      status:
        sunsetOptical.aerosol.delta < 0 || sunsetSample.visibilityKm < 10
          ? 'unfavorable'
          : sunsetOptical.aerosol.delta > 0
            ? 'optimal'
            : 'good',
      hint: sunsetOptical.aerosol.notes.length
        ? sunsetOptical.aerosol.notes.join('；')
        : sunsetSample.visibilityKm >= 15
          ? '能见度良好，霞光通透纯净'
          : '能见度一般，霞色略带灰蒙',
    },
  ];

  const hourlyScores = rawSunsetHourly.map(({ hour, score, timingLabel, factors: hourFactors }) => ({
    hour: hour.time,
    displayHour: `${String(hour.hourNum).padStart(2, '0')}:00`,
    score,
    cloudCover: hour.cloudTotal,
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
    countdownHint: `日落预测时间为 ${sunsetHHMM}，评分取日落时刻的云层和通透度，有效窗口约 ${windowMinutes} 分钟`,
    summary,
    factors,
    photographerTips:
      '晚霞呈现三段阶梯式演变：① 日落前金黄刺眼；② 日落后 5-15 分钟红黄云彩爆裂（火烧云最佳窗口）；③ 日落后 20-35 分钟天空转入冷暖对冲紫粉蓝调。晚霞强烈依赖西向地平线光路，若西方百公里外有远距离厚云可能削弱实际晚霞。请使用三脚架并适度减弱曝光突出色彩饱和。',
    equipmentAdvice: '偏振镜(CPL)、软渐变滤镜(Soft GND0.9)、广角变焦镜头、稳固脚架',
    hourlyScores,
  };
}
