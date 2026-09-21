/**
 * 评分增强纯函数集合。
 *
 * 这些函数只做确定性计算，不访问网络、不读取全局状态，便于用 Node 内置测试运行器验证。
 * 所有输入字段均为可选：数据缺失时返回 0 修正，绝不把缺失值当成理想条件。
 */

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

export const CLOUD_SEA_ADJUSTMENT_RANGE: ScoreAdjustmentRange = { min: -12, max: 12 };
export const AEROSOL_ADJUSTMENT_RANGE: ScoreAdjustmentRange = { min: -10, max: 6 };
export const HIKING_ADJUSTMENT_RANGE: ScoreAdjustmentRange = { min: -15, max: 5 };

/** 对流层中纬度标准温度递减率 (°C/km) */
const STANDARD_LAPSE_RATE = 6.5;
/** 干绝热递减率 (°C/km)，超过即为超绝热的不稳定层结 */
const DRY_ADIABATIC_LAPSE_RATE = 9.8;
/** 两个采样高度之间至少需要的垂直间距 (m)，过近的温差没有意义 */
const MIN_LEVEL_SEPARATION = 150;
/** 满月天顶附近的最大星空惩罚分 */
const MOONLIGHT_MAX_PENALTY = 30;

const STANDARD_SEA_LEVEL_PRESSURE = 1013.25;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function isFiniteNumber(value: number | undefined | null): value is number {
  return typeof value === 'number' && isFinite(value);
}

function roundTo(value: number, digits: number): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

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
  /**
   * 对流云底高度 (m)。
   * 假设与 observerElevation 同为海平面基准 (AMSL)；官方文档未明确基准，
   * 因此这里不做任何换算，只按同基准直接比较，并在解释中声明该假设。
   * Open-Meteo 在无对流云时会返回 -500 等哨兵值，非正数一律按缺失处理。
   */
  convectiveCloudBase?: number;
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
  /** 云底是否低于观测点；数据不足为 null */
  cloudBaseBelowObserver: boolean | null;
}

interface ProfilePoint {
  height: number;
  temperature: number;
  label: string;
}

/**
 * 云海垂直结构修正：综合地面/925/850 hPa 温度层结、对流云底与阵风。
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

  // Open-Meteo 无对流云时返回 -500 一类的哨兵值，必须按缺失处理，否则会被当成脚下云海
  const cloudBase =
    isFiniteNumber(input.convectiveCloudBase) && input.convectiveCloudBase > 0
      ? input.convectiveCloudBase
      : null;

  let cloudBaseBelowObserver: boolean | null = null;
  if (cloudBase !== null && elevation !== null) {
    const diff = elevation - cloudBase;
    cloudBaseBelowObserver = diff > 50;
    notes.push('云底高度按海平面基准 (AMSL) 与观测点海拔直接比较，未做基准换算');
    if (diff >= 300) {
      delta += 4;
      notes.push(`云底约 ${Math.round(cloudBase)}m，低于观测点约 ${Math.round(diff)}m，可俯瞰云海`);
    } else if (diff > 50) {
      delta += 2;
      notes.push('云底略低于观测点，云海高度贴近视线');
    } else if (diff > -200) {
      notes.push('云底与观测点高度接近，可能置身云雾之中');
    } else {
      delta -= 2;
      notes.push('云底高于观测点，更像头顶低云而非脚下云海');
    }
  } else if (isFiniteNumber(input.convectiveCloudBase) && cloudBase === null) {
    notes.push('数据显示无对流云底（哨兵值），未做云底修正');
  } else {
    notes.push('缺少云底或观测点海拔数据，未做云底修正');
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
    cloudBaseBelowObserver,
  };
}

export interface AerosolInput {
  /** 550nm 气溶胶光学厚度，无量纲 */
  aerosolOpticalDepth?: number;
  /** PM2.5 浓度 (μg/m³) */
  pm2_5?: number;
}

/**
 * 晚霞/朝霞的气溶胶修正：适度气溶胶增强前向散射与红光，过高则是灰霾。
 */
export function evaluateSunsetAerosolAdjustment(input: AerosolInput): ScoreAdjustment {
  const notes: string[] = [];
  let delta = 0;
  let hasData = false;

  if (isFiniteNumber(input.aerosolOpticalDepth)) {
    hasData = true;
    const aod = input.aerosolOpticalDepth;
    if (aod < 0.05) {
      notes.push('大气极洁净（AOD 很低），通透但散射偏弱，霞色偏清淡');
    } else if (aod < 0.15) {
      delta += 2;
      notes.push('轻微气溶胶，利于散射出淡金色霞光');
    } else if (aod <= 0.35) {
      delta += 4;
      notes.push('气溶胶适中，红橙光散射条件理想');
    } else if (aod <= 0.55) {
      notes.push('气溶胶偏高，霞光可能发浑');
    } else if (aod <= 0.8) {
      delta -= 4;
      notes.push('气溶胶浓度高，低空通透度差，霞色发灰');
    } else {
      delta -= 8;
      notes.push('重度气溶胶/灰霾，日落前后天际线易被遮蔽');
    }
  }

  if (isFiniteNumber(input.pm2_5)) {
    hasData = true;
    const pm = input.pm2_5;
    if (pm <= 35) {
      notes.push('PM2.5 优良，能见度基础良好');
    } else if (pm <= 75) {
      delta -= 2;
      notes.push('PM2.5 轻度污染，远景对比度下降');
    } else if (pm <= 115) {
      delta -= 5;
      notes.push('PM2.5 中度污染，霞光饱和度明显受损');
    } else {
      delta -= 8;
      notes.push('PM2.5 重度污染，基本无法形成通透晚霞');
    }
  }

  if (!hasData) {
    notes.push('缺少空气质量数据，未做气溶胶修正');
  }

  return {
    delta: roundTo(clamp(delta, AEROSOL_ADJUSTMENT_RANGE.min, AEROSOL_ADJUSTMENT_RANGE.max), 2),
    notes,
  };
}

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

export interface HikingComfortInput {
  /** 体感温度 (°C) */
  apparentTemperature?: number;
  /** 实际气温 (°C)，体感温度缺失时的回退值 */
  temperature?: number;
  /** 阵风 (km/h) */
  windGusts?: number;
}

/**
 * 徒步体感与阵风修正：体感温度评估热负荷，阵风评估山脊安全。
 */
export function evaluateHikingComfortAdjustment(input: HikingComfortInput): ScoreAdjustment {
  const notes: string[] = [];
  let delta = 0;
  let hasData = false;

  const feels = isFiniteNumber(input.apparentTemperature)
    ? input.apparentTemperature
    : isFiniteNumber(input.temperature)
      ? input.temperature
      : null;

  if (feels !== null) {
    hasData = true;
    if (!isFiniteNumber(input.apparentTemperature)) {
      notes.push('缺少体感温度，使用实际气温近似评估');
    }
    if (feels >= 12 && feels <= 24) {
      delta += 4;
      notes.push(`体感 ${Math.round(feels)}°C，凉爽舒适，适合长距离徒步`);
    } else if ((feels >= 8 && feels < 12) || (feels > 24 && feels <= 27)) {
      delta += 2;
      notes.push(`体感 ${Math.round(feels)}°C，整体尚舒适，注意增减衣物`);
    } else if ((feels >= 3 && feels < 8) || (feels > 27 && feels <= 30)) {
      notes.push(`体感 ${Math.round(feels)}°C，需做好保暖或补水准备`);
    } else if (feels > 30 && feels <= 33) {
      delta -= 4;
      notes.push(`体感 ${Math.round(feels)}°C，热负荷较大，建议避开正午`);
    } else if (feels > 33 && feels <= 36) {
      delta -= 7;
      notes.push(`体感 ${Math.round(feels)}°C，中暑风险升高，缩短行程`);
    } else if (feels > 36) {
      delta -= 10;
      notes.push(`体感 ${Math.round(feels)}°C，高温高湿，不建议户外徒步`);
    } else if (feels < 3 && feels >= -5) {
      delta -= 3;
      notes.push(`体感 ${Math.round(feels)}°C，湿冷体感明显，注意保暖`);
    } else if (feels < -5 && feels >= -15) {
      delta -= 6;
      notes.push(`体感 ${Math.round(feels)}°C，严寒，需专业防寒装备`);
    } else {
      delta -= 9;
      notes.push(`体感 ${Math.round(feels)}°C，极端严寒，存在冻伤风险`);
    }
  } else {
    notes.push('缺少体感温度与气温数据，未做体感修正');
  }

  if (isFiniteNumber(input.windGusts)) {
    hasData = true;
    const gusts = input.windGusts;
    if (gusts >= 60) {
      delta -= 8;
      notes.push(`阵风可达 ${Math.round(gusts)}km/h，山脊与暴露地形有危险`);
    } else if (gusts >= 45) {
      delta -= 5;
      notes.push(`阵风 ${Math.round(gusts)}km/h，需避开裸露山脊`);
    } else if (gusts >= 30) {
      delta -= 3;
      notes.push(`阵风 ${Math.round(gusts)}km/h，行走稳定性下降`);
    } else if (gusts >= 20) {
      delta -= 1;
      notes.push('阵风偏大，注意保暖与帽子固定');
    } else {
      notes.push('风力温和，行进体验良好');
    }
  } else {
    notes.push('缺少阵风数据，未做风力修正');
  }

  if (!hasData) {
    return { delta: 0, notes };
  }

  return {
    delta: roundTo(clamp(delta, HIKING_ADJUSTMENT_RANGE.min, HIKING_ADJUSTMENT_RANGE.max), 2),
    notes,
  };
}
