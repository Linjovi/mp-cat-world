import { LocationItem, WeatherApiResponse } from '../types';

/**
 * Fetch 7-day weather forecast with detailed hourly cloud layers and daily sun markers
 */
export function fetchWeatherForecast(
  latitude: number,
  longitude: number
): Promise<WeatherApiResponse> {
  return new Promise((resolve, reject) => {
    const hourlyParams = [
      'temperature_2m',
      'relative_humidity_2m',
      'dew_point_2m',
      'apparent_temperature',
      'precipitation_probability',
      'precipitation',
      'weather_code',
      'surface_pressure',
      'cloud_cover',
      'cloud_cover_low',
      'cloud_cover_mid',
      'cloud_cover_high',
      'visibility',
      'wind_speed_10m',
      'wind_direction_10m',
    ].join(',');

    const dailyParams = [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'sunrise',
      'sunset',
      'daylight_duration',
      'sunshine_duration',
      'uv_index_max',
    ].join(',');

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}&hourly=${hourlyParams}&daily=${dailyParams}&timezone=auto&forecast_days=7`;

    wx.request({
      url,
      method: 'GET',
      timeout: 15000,
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          resolve(res.data as WeatherApiResponse);
        } else {
          reject(new Error(`天气接口响应异常 (${res.statusCode}): 请稍后重试`));
        }
      },
      fail: (err) => {
        console.error('wx.request failed:', err);
        reject(new Error(err.errMsg || '获取天气预报失败，请检查网络设置'));
      },
    });
  });
}

interface GeocodingResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  country?: string;
  admin1?: string;
  admin2?: string;
}

/**
 * Search locations using Open-Meteo Geocoding API (free, supports Chinese & global locations)
 */
export async function searchLocations(query: string): Promise<LocationItem[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const requestGeocoding = (lang: string): Promise<GeocodingResult[]> => {
    return new Promise((resolve) => {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        trimmed
      )}&count=10&language=${lang}&format=json`;

      wx.request({
        url,
        method: 'GET',
        timeout: 10000,
        success: (res) => {
          if (res.statusCode === 200 && res.data) {
            const data = res.data as { results?: GeocodingResult[] };
            resolve(data.results || []);
          } else {
            resolve([]);
          }
        },
        fail: () => {
          resolve([]);
        },
      });
    });
  };

  // Try Chinese first
  let results = await requestGeocoding('zh');

  // Fallback to English if no results found
  if (results.length === 0) {
    results = await requestGeocoding('en');
  }

  return results.map((item) => ({
    id: `geo_${item.id}`,
    name: item.name,
    admin1: item.admin1,
    admin2: item.admin2,
    country: item.country,
    latitude: item.latitude,
    longitude: item.longitude,
    elevation: item.elevation ? Math.round(item.elevation) : undefined,
    isCustom: true,
  }));
}

/**
 * Get current location using WeChat wx.getLocation API
 */
export function getCurrentCoordinates(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      success: (res) => {
        resolve({
          latitude: res.latitude,
          longitude: res.longitude,
        });
      },
      fail: (err) => {
        console.warn('wx.getLocation failed:', err);
        // If permission denied, advise user
        if (err.errMsg && err.errMsg.indexOf('auth deny') !== -1) {
          wx.showModal({
            title: '需要定位权限',
            content: '请在小程序设置中允许“使用我的地理位置”，以便获取您身边的天象气象预报',
            confirmText: '去设置',
            success: (modalRes) => {
              if (modalRes.confirm) {
                wx.openSetting();
              }
            },
          });
          reject(new Error('定位权限未开启'));
        } else {
          reject(new Error(err.errMsg || '获取定位失败，请手动选择地点'));
        }
      },
    });
  });
}
