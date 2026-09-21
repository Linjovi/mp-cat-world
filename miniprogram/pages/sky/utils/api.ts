import type {
  AirQualityApiResponse,
  SkyForecastBundle,
  WeatherApiResponse,
} from '../types';

const WEATHER_HOURLY_FIELDS = [
  'temperature_2m',
  'relative_humidity_2m',
  'dew_point_2m',
  'apparent_temperature',
  'precipitation_probability',
  'precipitation',
  'weather_code',
  'surface_pressure',
  'pressure_msl',
  'cloud_cover',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'convective_cloud_base',
  'visibility',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'temperature_925hPa',
  'temperature_850hPa',
  'temperature_700hPa',
  'relative_humidity_925hPa',
  'relative_humidity_850hPa',
  'relative_humidity_700hPa',
  'cloud_cover_925hPa',
  'cloud_cover_850hPa',
  'cloud_cover_700hPa',
].join(',');

const WEATHER_DAILY_FIELDS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'sunrise',
  'sunset',
  'daylight_duration',
  'sunshine_duration',
  'uv_index_max',
].join(',');

const AIR_QUALITY_HOURLY_FIELDS = ['pm2_5', 'aerosol_optical_depth'].join(',');

/** 死海 -430m 到珠峰 8848m 之外的取值视为脏数据，宁可让接口用自带地形高程 */
const MIN_VALID_ELEVATION = -500;
const MAX_VALID_ELEVATION = 9000;

/**
 * Normalize an observation / geocoding altitude for both weather URLs and search results.
 * Sea level (0) and valid depressions are kept; invalid values become undefined.
 */
export function normalizeElevation(elevation?: number): number | undefined {
  if (typeof elevation !== 'number' || !isFinite(elevation)) return undefined;
  const rounded = Math.round(elevation);
  if (rounded < MIN_VALID_ELEVATION || rounded > MAX_VALID_ELEVATION) return undefined;
  return rounded;
}

/**
 * Pure URL builder for the Open-Meteo forecast endpoint.
 * `elevation` is only appended when it is a plausible observation altitude.
 */
export function buildWeatherForecastUrl(
  latitude: number,
  longitude: number,
  elevation?: number
): string {
  const normalizedElevation = normalizeElevation(elevation);
  const elevationParam =
    normalizedElevation === undefined ? '' : `&elevation=${normalizedElevation}`;

  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(4)}` +
    `&longitude=${longitude.toFixed(4)}` +
    `&hourly=${WEATHER_HOURLY_FIELDS}` +
    `&daily=${WEATHER_DAILY_FIELDS}` +
    `&timezone=auto&forecast_days=7${elevationParam}`
  );
}

/** Pure URL builder for the Open-Meteo air quality endpoint (weak dependency) */
export function buildAirQualityForecastUrl(latitude: number, longitude: number): string {
  return (
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude.toFixed(4)}` +
    `&longitude=${longitude.toFixed(4)}` +
    `&hourly=${AIR_QUALITY_HOURLY_FIELDS}` +
    `&timezone=auto&forecast_days=7`
  );
}

/**
 * Fetch 7-day weather forecast with detailed hourly cloud layers and daily sun markers
 */
export function fetchWeatherForecast(
  latitude: number,
  longitude: number,
  elevation?: number
): Promise<WeatherApiResponse> {
  return new Promise((resolve, reject) => {
    const url = buildWeatherForecastUrl(latitude, longitude, elevation);

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

/**
 * Structural guard for the air quality payload. A 200 response can still carry an
 * error body or a trimmed payload, and scoring must never read `hourly.time` blindly.
 */
export function isUsableAirQualityResponse(data: unknown): data is AirQualityApiResponse {
  if (typeof data !== 'object' || data === null) return false;
  const hourly = (data as { hourly?: unknown }).hourly;
  if (typeof hourly !== 'object' || hourly === null) return false;
  return Array.isArray((hourly as { time?: unknown }).time);
}

/**
 * Fetch air quality forecast. This is a weak dependency: any non-200 response,
 * malformed payload or network failure resolves to null so the page can still
 * render weather-only scores.
 */
export function fetchAirQualityForecast(
  latitude: number,
  longitude: number
): Promise<AirQualityApiResponse | null> {
  return new Promise((resolve) => {
    wx.request({
      url: buildAirQualityForecastUrl(latitude, longitude),
      method: 'GET',
      timeout: 15000,
      success: (res) => {
        if (res.statusCode !== 200) {
          console.warn('空气质量接口响应异常:', res.statusCode);
          resolve(null);
        } else if (!isUsableAirQualityResponse(res.data)) {
          console.warn('空气质量接口返回结构不完整，降级为无空气质量数据');
          resolve(null);
        } else {
          resolve(res.data);
        }
      },
      fail: (err) => {
        console.warn('空气质量接口请求失败:', err);
        resolve(null);
      },
    });
  });
}

/**
 * Load weather and air quality in parallel.
 * Weather failure rejects the bundle; air quality failure only degrades to null.
 */
export function fetchSkyForecastBundle(
  latitude: number,
  longitude: number,
  elevation?: number
): Promise<SkyForecastBundle> {
  const weatherPromise = fetchWeatherForecast(latitude, longitude, elevation);
  const airQualityPromise = fetchAirQualityForecast(latitude, longitude).catch((err) => {
    console.warn('空气质量接口异常，降级为无空气质量数据:', err);
    return null;
  });

  return Promise.all([weatherPromise, airQualityPromise]).then(([weather, airQuality]) => ({
    weather,
    airQuality,
  }));
}

export interface MapPickedLocation {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

export function parseMapCoordinate(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

/**
 * Pick a spot on the built-in WeChat map. Covers far more scenic spots than the
 * geocoding search and needs no third-party map key. Resolves null when cancelled.
 */
export function chooseLocationOnMap(): Promise<MapPickedLocation | null> {
  return new Promise((resolve, reject) => {
    wx.chooseLocation({
      success: (res) => {
        resolve({
          name: res.name,
          address: res.address,
          latitude: parseMapCoordinate(res.latitude),
          longitude: parseMapCoordinate(res.longitude),
        });
      },
      fail: (err) => {
        const errMsg = err.errMsg || '';
        if (errMsg.indexOf('cancel') !== -1) {
          resolve(null);
          return;
        }
        if (errMsg.indexOf('auth deny') !== -1 || errMsg.indexOf('auth denied') !== -1) {
          wx.showModal({
            title: '需要定位权限',
            content: '请在小程序设置中允许“使用我的地理位置”，才能在地图上选择观景地点',
            confirmText: '去设置',
            success: (modalRes) => {
              if (modalRes.confirm) {
                wx.openSetting();
              }
            },
          });
          reject(new Error('定位权限未开启'));
          return;
        }
        console.warn('wx.chooseLocation failed:', err);
        reject(new Error(errMsg || '地图选点失败，请稍后重试'));
      },
    });
  });
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
