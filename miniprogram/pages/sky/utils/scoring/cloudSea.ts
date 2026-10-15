import type { EvaluationFactor, PhenomenonPrediction } from '../../types';
import type { EvaluationContext, HourSlice, ScoreAdjustment, ScoreAdjustmentRange } from './context';
import { clamp, clampScore, isFiniteNumber, peakScore, roundTo } from './number';

export const CLOUD_SEA_ADJUSTMENT_RANGE: ScoreAdjustmentRange = { min: -12, max: 12 };

/** 对流层中纬度标准温度递减率 (°C/km) */
const STANDARD_LAPSE_RATE = 6.5;
/** 干绝热递减率 (°C/km)，超过即为超绝热的不稳定层结 */
const DRY_ADIABATIC_LAPSE_RATE = 9.8;
/** 两个采样高度之间至少需要的垂直间距 (m)，过近的温差没有意义 */
const MIN_LEVEL_SEPARATION = 150;

const STANDARD_SEA_LEVEL_PRESSURE = 1013.25;

/**
 * 用国际标准大气公式把气压层换算成近似海拔高度 (m)。
 * 925 hPa ≈ 762 m，850 hPa ≈ 1457 m；可传入海平面气压做粗略订正。
 */
export function approximatePressureLevelAltitude(
  pressureHPa: number,
  pressureMsl: number = STANDARD_SEA_LEVEL_PRESSURE
): number {
  const basePressure = isFiniteNumber(pressureMsl) && pressureMsl > 0 ? pressureMsl : STANDARD_SEA_LEVEL_PRESSURE;
  if (!isFiniteNumber(pressureHPa) || pressureHPa <= 0) return 0;
  return 44330 * (1 - Math.pow(pressureHPa / basePressure, 1 / 5.255));
}

export interface CloudSeaVerticalInput {
  /** 2m 气温 (°C) */
  surfaceTemperature?: number;
  temperature925hPa?: number;
  temperature850hPa?: number;
  /** 700hPa 温度，供高海拔观测点使用（925/850 常位于山顶地表以下） */
  temperature700hPa?: number;
  /** 观测点海拔 (m) */
  observerElevation?: number;
  /** 阵风 (km/h) */
  windGusts?: number;
  /** 海平面气压 (hPa)，用于订正气压层高度 */
  pressureMsl?: number;
}

export interface CloudSeaVerticalAdjustment extends ScoreAdjustment {
  /** 是否存在真实逆温（高处比低处暖），正常递减不会被判为逆温 */
  inversionDetected: boolean;
  /** 逆温层内的升温幅度 (°C)，无逆温为 0 */
  inversionStrength: number;
}

interface ProfilePoint {
  height: number;
  temperature: number;
  label: string;
}

/**
 * 云海垂直结构修正：只用观测点及其上方的温度层结，再加上阵风。
 * 云量不在这里判断，低中高云由 evaluateCloudSea 单独计分。
 *
 * 关键点：气压层高度是近似值，且只有位于观测点上方的层次才参与比较，
 * 否则"山下更暖"这种正常的温度递减会被误判成逆温。
 */
export function evaluateCloudSeaVerticalAdjustment(
  input: CloudSeaVerticalInput
): CloudSeaVerticalAdjustment {
  const notes: string[] = [];
  let delta = 0;
  let inversionDetected = false;
  let inversionStrength = 0;

  const elevation = isFiniteNumber(input.observerElevation) ? input.observerElevation : null;
  const height925 = approximatePressureLevelAltitude(925, input.pressureMsl);
  const height850 = approximatePressureLevelAltitude(850, input.pressureMsl);
  const height700 = approximatePressureLevelAltitude(700, input.pressureMsl);

  const candidates: ProfilePoint[] = [];
  // 没有观测点海拔就无法判断哪些气压层位于观测点上方，此时不做任何层结推断
  if (elevation !== null) {
    if (isFiniteNumber(input.surfaceTemperature)) {
      candidates.push({ height: elevation, temperature: input.surfaceTemperature, label: '地面' });
    }
    if (isFiniteNumber(input.temperature925hPa)) {
      candidates.push({ height: height925, temperature: input.temperature925hPa, label: '925hPa' });
    }
    if (isFiniteNumber(input.temperature850hPa)) {
      candidates.push({ height: height850, temperature: input.temperature850hPa, label: '850hPa' });
    }
    if (isFiniteNumber(input.temperature700hPa)) {
      candidates.push({ height: height700, temperature: input.temperature700hPa, label: '700hPa' });
    }
  }

  // 只保留观测点及其上方的层次：位于观测点下方的气压层无法说明山顶的层结
  const baseHeight = elevation !== null ? elevation : Infinity;
  const profile = candidates
    .filter((p) => p.height >= baseHeight - 1)
    .sort((a, b) => a.height - b.height);

  const segments: { lapse: number; deltaT: number; from: ProfilePoint; to: ProfilePoint }[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const lower = profile[i];
    const upper = profile[i + 1];
    const dz = upper.height - lower.height;
    if (dz < MIN_LEVEL_SEPARATION) continue;
    segments.push({
      lapse: (lower.temperature - upper.temperature) / (dz / 1000),
      deltaT: upper.temperature - lower.temperature,
      from: lower,
      to: upper,
    });
  }

  if (elevation === null) {
    notes.push('缺少观测点海拔，无法判断气压层相对高度，未做层结修正');
  } else if (segments.length === 0) {
    notes.push('缺少观测点上方的垂直温度数据，未做层结修正');
  } else {
    let mostStable = segments[0];
    for (const segment of segments) {
      if (segment.lapse < mostStable.lapse) mostStable = segment;
    }

    if (mostStable.lapse < -0.5) {
      inversionDetected = true;
      inversionStrength = roundTo(mostStable.deltaT, 2);
      delta += clamp(2 + inversionStrength * 1.6, 0, 8);
      notes.push(
        `${mostStable.from.label}至${mostStable.to.label}存在逆温（升温 ${roundTo(inversionStrength, 1)}°C），利于低层水汽聚成云海`
      );
    } else if (mostStable.lapse < STANDARD_LAPSE_RATE - 3) {
      delta += 3;
      notes.push('层结偏稳定（温度递减慢于标准大气），低层云不易被打散');
    } else if (mostStable.lapse > DRY_ADIABATIC_LAPSE_RATE) {
      delta -= 3;
      notes.push('层结超绝热不稳定，对流旺盛，云海难以成片');
    } else {
      notes.push('温度随高度正常递减，无逆温信号');
    }
  }

  if (isFiniteNumber(input.windGusts)) {
    const gusts = input.windGusts;
    if (gusts >= 50) {
      delta -= 6;
      notes.push(`阵风可达 ${Math.round(gusts)}km/h，云海极易被吹散`);
    } else if (gusts >= 35) {
      delta -= 4;
      notes.push(`阵风较强（${Math.round(gusts)}km/h），云海维持时间短`);
    } else if (gusts >= 25) {
      delta -= 2;
      notes.push('阵风偏大，云海边缘易翻涌消散');
    } else if (gusts >= 15) {
      delta -= 1;
      notes.push('阵风轻微，对云海影响有限');
    } else {
      notes.push('风力静稳，利于云海稳定停留');
    }
  } else {
    notes.push('缺少阵风数据，未做风力修正');
  }

  return {
    delta: roundTo(clamp(delta, CLOUD_SEA_ADJUSTMENT_RANGE.min, CLOUD_SEA_ADJUSTMENT_RANGE.max), 2),
    notes,
    inversionDetected,
    inversionStrength,
  };
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

const PRESSURE_HUMIDITY_LEVELS = [
  { key: 'rh925', label: '925hPa', pressure: 925 },
  { key: 'rh850', label: '850hPa', pressure: 850 },
  { key: 'rh700', label: '700hPa', pressure: 700 },
] as const;

/** 观测点上下各 200m 内算作同一高度层，再远才分山腰和头顶。 */
const HUMIDITY_LEVEL_MARGIN = 200;

export interface CloudSeaPressureHumidityInput {
  elevation?: number;
  pressureMsl?: number;
  rh925?: number;
  rh850?: number;
  rh700?: number;
}

/**
 * 三层气压湿度一起看：山腰湿、头顶干才加分。
 * 整层都湿只给很小的修正，避免和地面湿度重复把「人在雾里」加成云海。
 */
export function evaluateCloudSeaPressureHumidity(
  input: CloudSeaPressureHumidityInput
): { delta: number; note: string } {
  const present = PRESSURE_HUMIDITY_LEVELS.flatMap((level) => {
    const rh = input[level.key];
    if (!isFiniteNumber(rh)) return [];
    return [
      {
        label: level.label,
        rh,
        height: approximatePressureLevelAltitude(level.pressure, input.pressureMsl),
      },
    ];
  });
  if (present.length === 0) {
    return { delta: 0, note: '气压层湿度数据缺失' };
  }

  const reading = present.map((level) => `${level.label} ${Math.round(level.rh)}%`).join(' · ');
  const elevation = isFiniteNumber(input.elevation) ? input.elevation : null;
  if (elevation === null) {
    const mean = present.reduce((sum, level) => sum + level.rh, 0) / present.length;
    return { delta: columnMoistureDelta(mean), note: reading };
  }

  const below = present.filter((level) => level.height < elevation - HUMIDITY_LEVEL_MARGIN);
  const near = present.filter(
    (level) =>
      level.height >= elevation - HUMIDITY_LEVEL_MARGIN &&
      level.height <= elevation + HUMIDITY_LEVEL_MARGIN
  );
  const above = present.filter((level) => level.height > elevation + HUMIDITY_LEVEL_MARGIN);
  const meanOf = (levels: typeof present) =>
    levels.reduce((sum, level) => sum + level.rh, 0) / levels.length;
  const deckLevels = below.length > 0 ? below : near;
  const overhead = above.length > 0 ? meanOf(above) : undefined;

  if (deckLevels.length === 0) {
    const upper = overhead ?? 0;
    const delta = upper >= 85 ? 1 : upper < 45 ? -2 : 0;
    return {
      delta,
      note: `${reading}。可用气压层都在观测点上方`,
    };
  }

  const deck = meanOf(deckLevels);
  const eye = near.length > 0 ? meanOf(near) : undefined;
  let delta = 0;
  let interpretation = '气压层湿度中等';
  if (deck >= 80 && (eye === undefined || eye <= 75) && (overhead === undefined || overhead <= 60)) {
    delta = 4;
    interpretation = '山腰湿、头顶偏干，水汽贴在观测点下方';
  } else if (deck >= 85 && eye !== undefined && eye >= 85) {
    delta = 1;
    interpretation = '观测高度附近的气压层也偏湿';
  } else if (deck < 50) {
    delta = -3;
    interpretation = '山腰气压层偏干，云海水汽不足';
  } else if (deck >= 70) {
    delta = 1;
    interpretation = '山腰气压层有一定水汽';
  }
  return { delta, note: `${reading}。${interpretation}` };
}

function columnMoistureDelta(mean: number): number {
  if (mean >= 90) return 3;
  if (mean >= 70) return 1;
  if (mean < 45) return -3;
  return 0;
}

/** 气压层湿度只做小幅修正。云量仍以低中高云为准。 */
function boundaryLayerMoisture(h: HourSlice, elevation?: number): { delta: number; note: string } {
  return evaluateCloudSeaPressureHumidity({
    elevation,
    pressureMsl: h.pressureMsl,
    rh925: h.relativeHumidity925,
    rh850: h.relativeHumidity850,
    rh700: h.relativeHumidity700,
  });
}

/** 能见度只加减分，不单独封住云海分数的上下限。 */
export function evaluateCloudSeaVisibility(visibilityKm: number): { delta: number; note: string } {
  if (!isFiniteNumber(visibilityKm)) {
    return { delta: 0, note: '能见度数据缺失' };
  }
  const km = Math.max(0, visibilityKm);
  const shown = String(Math.round(km));
  if (km >= 10) {
    return { delta: 4, note: `能见度 ${shown} km，山顶空气通透` };
  }
  if (km >= 4) {
    return { delta: 2, note: `能见度 ${shown} km` };
  }
  if (km >= 1) {
    return { delta: 0, note: `能见度 ${shown} km` };
  }
  return { delta: -5, note: `能见度 ${shown} km，观测点附近像在雾里` };
}

export interface CloudSeaWindowHour {
  hourNum: number;
  score: number;
}

function formatClockHour(hourNum: number): string {
  return `${String(hourNum).padStart(2, '0')}:00`;
}

/**
 * 最佳窗口取分时高分连成的一段。结束时间是最后一小时的下一小时，
 * 所以 4 点、5 点最高时窗口是 04:00 - 06:00。
 */
export function cloudSeaObservationWindow(hours: CloudSeaWindowHour[]): {
  start: string;
  end: string;
  minutes: number;
} {
  if (hours.length === 0) {
    return { start: '05:00', end: '07:00', minutes: 120 };
  }
  let peakIndex = 0;
  for (let i = 1; i < hours.length; i++) {
    if (hours[i].score > hours[peakIndex].score) peakIndex = i;
  }
  const peak = hours[peakIndex].score;
  const threshold = Math.round(peak * 0.8);
  const beside = (left: number, right: number) => Math.abs(hours[left].hourNum - hours[right].hourNum) === 1;

  let startIndex = peakIndex;
  let endIndex = peakIndex;
  while (startIndex > 0 && beside(startIndex - 1, startIndex) && hours[startIndex - 1].score >= threshold) {
    startIndex--;
  }
  while (
    endIndex < hours.length - 1 &&
    beside(endIndex, endIndex + 1) &&
    hours[endIndex + 1].score >= threshold
  ) {
    endIndex++;
  }

  const maxHours = 6;
  while (endIndex - startIndex + 1 > maxHours) {
    if (peakIndex - startIndex >= endIndex - peakIndex) startIndex++;
    else endIndex--;
  }

  const startHour = hours[startIndex].hourNum;
  const endHour = (hours[endIndex].hourNum + 1) % 24;
  return {
    start: formatClockHour(startHour),
    end: formatClockHour(endHour),
    minutes: (endIndex - startIndex + 1) * 60,
  };
}

/**
 * Evaluate Sea of Clouds (云海)
 */
export function evaluateCloudSea(ctx: EvaluationContext): PhenomenonPrediction {
  const elevation = ctx.elevation;

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

    const moisture = boundaryLayerMoisture(h, elevation);
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
      observerElevation: ctx.elevation,
      windGusts: h.gusts,
      pressureMsl: h.pressureMsl,
    });
    const visibility = evaluateCloudSeaVisibility(h.visibilityKm);
    const combined = clampScore(
      Math.min(
        Math.round(hScore * timeFactor) + hourlyVerticalAdjustment.delta + visibility.delta,
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
          name: '垂直层结 / 阵风',
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
          hint: [...hourlyVerticalAdjustment.notes, moisture.note, visibility.note].join('；'),
        },
      ] as EvaluationFactor[],
    };
  });

  const dailyScore = peakScore(rawHourlyScores);
  const observation = cloudSeaObservationWindow(
    rawHourlyScores.map((hour) => ({
      hourNum: Number(hour.displayHour.slice(0, 2)),
      score: hour.score,
    }))
  );
  const windowMinutes = observation.minutes;
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
  const bestTimeStart = observation.start;
  const bestTimeEnd = observation.end;

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
    bestTimeWindow: `${bestTimeStart} - ${bestTimeEnd} (分时高分时段)`,
    bestTimeShort: `${bestTimeStart} - ${bestTimeEnd}`,
    countdownHint: `高分集中在 ${bestTimeStart} - ${bestTimeEnd}，约 ${windowMinutes} 分钟`,
    summary,
    factors,
    photographerTips: '推荐机位选在海拔 1000m 以上开阔观景台或东向山崖；搭配广角镜头拍壮阔气势，长焦镜头压缩山峰孤岛特写；加装 ND 减光镜可拍摄如丝绢般流动的云瀑慢门。',
    equipmentAdvice: '广角变焦镜头、长焦镜头(70-200mm)、ND1000减光镜、稳固三脚架、保暖冲锋衣',
    hourlyScores,
  };
}
