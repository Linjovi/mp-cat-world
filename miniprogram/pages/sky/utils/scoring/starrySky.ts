import type { EvaluationFactor, PhenomenonPrediction } from '../../types';
import { calculateMoonInfo } from '../astronomy';
import type { EvaluationContext, HourSlice } from './context';
import { hazePenalty } from './haze';
import { clamp, clampScore, isFiniteNumber, peakScore, roundTo } from './number';

/** 满月天顶附近的最大星空惩罚分 */
const MOONLIGHT_MAX_PENALTY = 30;


export interface MoonlightInput {
  /** 当地时间，形如 'YYYY-MM-DDTHH:mm' */
  isoTime: string;
  latitude: number;
  /** 东经为正 */
  longitude: number;
  /** 月面照度百分比 0-100 */
  illuminationPct: number;
  /** 当地与 UTC 的时差（小时）；缺省按经度近似 */
  utcOffsetHours?: number;
}

export interface MoonlightImpact {
  /** 星空评分应扣除的分值，月亮在地平线下为 0 */
  penalty: number;
  /** 月亮地平高度角（度），地平线下为负 */
  altitudeDeg: number;
  isAboveHorizon: boolean;
  note: string;
}

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

function normalizeDegrees(deg: number): number {
  const result = deg % 360;
  return result < 0 ? result + 360 : result;
}

function sinDeg(deg: number): number {
  return Math.sin(deg * DEG2RAD);
}

function cosDeg(deg: number): number {
  return Math.cos(deg * DEG2RAD);
}

/** 解析当地时间为 UTC 毫秒；失败返回 null */
function parseLocalTimeToUtcMillis(isoTime: string, utcOffsetHours: number): number | null {
  if (typeof isoTime !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(isoTime);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return Date.UTC(year, month - 1, day, hour, minute) - utcOffsetHours * 3600 * 1000;
}

/**
 * 月亮地平高度角的本地天文近似（低精度星历，误差约 0.3°，用于评分足够）。
 */
export function calculateMoonAltitudeDeg(
  isoTime: string,
  latitude: number,
  longitude: number,
  utcOffsetHours?: number
): number | null {
  const offset = isFiniteNumber(utcOffsetHours)
    ? utcOffsetHours
    : clamp(Math.round((isFiniteNumber(longitude) ? longitude : 0) / 15), -12, 14);
  const utcMillis = parseLocalTimeToUtcMillis(isoTime, offset);
  if (utcMillis === null || !isFiniteNumber(latitude) || !isFiniteNumber(longitude)) return null;

  const jd = utcMillis / 86400000 + 2440587.5;
  const d = jd - 2451545.0;
  const t = d / 36525;

  // 月球地心黄经/黄纬（低精度级数，来自天文年历简化式）
  const lambda =
    218.32 +
    481267.8813 * t +
    6.29 * sinDeg(134.9 + 477198.85 * t) -
    1.27 * sinDeg(259.2 - 413335.38 * t) +
    0.66 * sinDeg(235.7 + 890534.23 * t) +
    0.21 * sinDeg(269.9 + 954397.7 * t) -
    0.19 * sinDeg(357.5 + 35999.05 * t) -
    0.11 * sinDeg(186.6 + 966404.05 * t);
  const beta =
    5.13 * sinDeg(93.3 + 483202.03 * t) +
    0.28 * sinDeg(228.2 + 960400.87 * t) -
    0.28 * sinDeg(318.3 + 6003.18 * t) -
    0.17 * sinDeg(217.6 - 407332.2 * t);

  const obliquity = 23.439291 - 0.0130042 * t;

  // 黄道坐标转赤道坐标
  const raRad = Math.atan2(
    sinDeg(lambda) * cosDeg(obliquity) - Math.tan(beta * DEG2RAD) * sinDeg(obliquity),
    cosDeg(lambda)
  );
  const decRad = Math.asin(
    clamp(sinDeg(beta) * cosDeg(obliquity) + cosDeg(beta) * sinDeg(obliquity) * sinDeg(lambda), -1, 1)
  );

  const gmst = 280.46061837 + 360.98564736629 * d;
  const localSiderealTime = normalizeDegrees(gmst + longitude);
  const hourAngle = normalizeDegrees(localSiderealTime - raRad * RAD2DEG);

  const geocentricAlt =
    Math.asin(
      clamp(
        sinDeg(latitude) * Math.sin(decRad) +
          cosDeg(latitude) * Math.cos(decRad) * cosDeg(hourAngle),
        -1,
        1
      )
    ) * RAD2DEG;

  // 月亮距离近，地心高度需扣除约 0.95° 的周日视差
  const topocentricAlt = geocentricAlt - 0.95 * cosDeg(geocentricAlt);
  return roundTo(topocentricAlt, 2);
}

/**
 * 月光对星空观测的影响：地平线以下不产生干扰，高度越高、照度越大惩罚越重。
 */
export function evaluateMoonlightImpact(input: MoonlightInput): MoonlightImpact {
  const altitudeDeg = calculateMoonAltitudeDeg(
    input.isoTime,
    input.latitude,
    input.longitude,
    input.utcOffsetHours
  );

  if (altitudeDeg === null) {
    return {
      penalty: 0,
      altitudeDeg: 0,
      isAboveHorizon: false,
      note: '时间或坐标无效，未计算月光干扰',
    };
  }

  if (altitudeDeg <= 0) {
    return {
      penalty: 0,
      altitudeDeg,
      isAboveHorizon: false,
      note: '月亮位于地平线以下，无月光干扰',
    };
  }

  const illuminationFraction = clamp(
    isFiniteNumber(input.illuminationPct) ? input.illuminationPct / 100 : 0,
    0,
    1
  );
  // 月面亮度随照度非线性增长；低空月亮受大气消光影响明显
  const brightness = Math.pow(illuminationFraction, 1.5);
  const altitudeFactor = Math.sqrt(Math.sin(altitudeDeg * DEG2RAD));
  const penalty = roundTo(MOONLIGHT_MAX_PENALTY * brightness * altitudeFactor, 1);

  return {
    penalty,
    altitudeDeg,
    isAboveHorizon: true,
    note:
      penalty <= 0
        ? '月亮在地平线上，但照度极低，几乎无干扰'
        : `月亮高度约 ${Math.round(altitudeDeg)}°、照度 ${Math.round(illuminationFraction * 100)}%，存在月光干扰`,
  };
}

/**
 * Evaluate Starry Sky & Milky Way (星空 / 银河)
 */
export function evaluateStarrySky(ctx: EvaluationContext): PhenomenonPrediction {
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
