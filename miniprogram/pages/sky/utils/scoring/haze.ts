/** 灰霾只扣分：日轮锐度和星空通透度都怕高 PM2.5 / 高 AOD，不像晚霞那样吃适度散射。 */
export function hazePenalty(pm2_5?: number, aod?: number): { delta: number; notes: string[] } {
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
