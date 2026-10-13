import type { EvaluationFactor, PhenomenonPrediction } from '../../types';
import type { EvaluationContext, ScoreAdjustment, ScoreAdjustmentRange } from './context';
import { clamp, clampScore, isFiniteNumber, peakScore, roundTo } from './number';

export const HIKING_ADJUSTMENT_RANGE: ScoreAdjustmentRange = { min: -15, max: 5 };

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
