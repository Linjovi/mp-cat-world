import { MoonInfo } from '../types';

/**
 * Calculate accurate moon phase and illumination percentage for any given date
 */
export function calculateMoonInfo(dateStr: string): MoonInfo {
  const date = new Date(dateStr + 'T12:00:00Z');
  
  // Reference known new moon: 2024-01-11 11:57 UTC
  const refNewMoon = new Date(Date.UTC(2024, 0, 11, 11, 57, 0)).getTime();
  const synodicMonth = 29.53058867; // days
  const diffDays = (date.getTime() - refNewMoon) / (1000 * 60 * 60 * 24);
  
  let phase = (diffDays % synodicMonth) / synodicMonth;
  if (phase < 0) phase += 1;
  
  // Illumination fraction: (1 - cos(angle)) / 2
  const angle = phase * 2 * Math.PI;
  const illuminationPct = Math.round(((1 - Math.cos(angle)) / 2) * 100);
  
  let phaseName = '新月';
  let moonDescription = '月光极弱，全黑夜空，绝佳星空与银河观测期';
  let isGoodForStargazing = true;

  if (phase >= 0.96 || phase < 0.04) {
    phaseName = '新月 (朔)';
    moonDescription = '月光干扰为零，整夜无月光，极佳星空与银河观测期';
    isGoodForStargazing = true;
  } else if (phase >= 0.04 && phase < 0.22) {
    phaseName = '蛾眉月';
    moonDescription = '微弱月牙，前半夜短暂停留后落山，后半夜暗夜环境极佳';
    isGoodForStargazing = true;
  } else if (phase >= 0.22 && phase < 0.28) {
    phaseName = '上弦月';
    moonDescription = '半月挂空，前半夜有月光干扰，午夜落山后适合拍银河';
    isGoodForStargazing = false;
  } else if (phase >= 0.28 && phase < 0.46) {
    phaseName = '盈凸月';
    moonDescription = '大部分夜晚受月光照亮，暗星与银河反差被冲淡';
    isGoodForStargazing = false;
  } else if (phase >= 0.46 && phase < 0.54) {
    phaseName = '满月 (望)';
    moonDescription = '通宵月明星稀，月照大地，难以观测银河，但适合拍摄月色地景';
    isGoodForStargazing = false;
  } else if (phase >= 0.54 && phase < 0.72) {
    phaseName = '亏凸月';
    moonDescription = '前半夜无月光适宜短暂观星，午夜后大月亮升起';
    isGoodForStargazing = false;
  } else if (phase >= 0.72 && phase < 0.78) {
    phaseName = '下弦月';
    moonDescription = '半夜升起，前半夜（日落后至午夜）是极好星空观测窗口';
    isGoodForStargazing = true;
  } else {
    phaseName = '残月';
    moonDescription = '极薄晨月，整夜星空黑暗通透，仅黎明前短暂出现';
    isGoodForStargazing = true;
  }

  return {
    phase,
    phaseName,
    illuminationPct,
    isGoodForStargazing,
    moonDescription,
  };
}

/**
 * Format ISO time into HH:mm
 */
export function formatHourTime(isoString: string): string {
  if (!isoString) return '--:--';
  const parts = isoString.split('T');
  if (parts.length > 1) {
    return parts[1].substring(0, 5);
  }
  return isoString;
}

/**
 * Shift time string by minutes, e.g. "05:40" - 35 min -> "05:05"
 */
export function shiftTimeString(hhmm: string, deltaMinutes: number): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return hhmm;
  
  let totalMin = h * 60 + m + deltaMinutes;
  if (totalMin < 0) totalMin += 24 * 60;
  totalMin = totalMin % (24 * 60);

  const newH = Math.floor(totalMin / 60);
  const newM = totalMin % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}
