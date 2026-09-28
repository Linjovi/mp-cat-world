import type {
  AirQualityApiResponse,
  LocationItem,
  DailyForecastEvaluation,
  PhenomenonType,
  WeatherApiResponse,
  PhenomenonPrediction,
} from './types';
import {
  PRESET_LOCATIONS,
  getLastActiveLocation,
  setLastActiveLocation,
  getSavedLocations,
  saveLocation,
  removeSavedLocation,
  searchOfflineLocations,
  getMapHistory,
  rememberMapLocation,
  isSameLocation,
} from './utils/locations';
import {
  fetchSkyForecastBundle,
  getCurrentCoordinates,
  chooseLocationOnMap,
} from './utils/api';
import { withCoordinateDisplay } from './utils/coordinateDisplay';
import { evaluateForecast } from './utils/weatherModel';
import { decorateSkyHour, getSkyInsightMeta } from './utils/skyDeepDive';
import { buildSkyPath, parseSkyTab, resolveLocationFromQuery, skyNavTitle } from './utils/seo';

function displayLocations(list: LocationItem[]) {
  return list.map(withCoordinateDisplay);
}

function localDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/** 今日默认选中当前时刻（逐时列表可能不含全部 24 小时，取最接近的一项），其他日期仍取评分最高的小时 */
function resolveDefaultHourIndex(
  hourlyScores: { displayHour: string; score: number }[] | undefined,
  dayDate: string
): number {
  if (!hourlyScores || hourlyScores.length === 0) return 0;

  const now = new Date();
  if (dayDate === localDateStr(now)) {
    const currentHour = now.getHours();
    let nearestIdx = -1;
    let minDiff = Infinity;
    hourlyScores.forEach((h, idx) => {
      const hourNum = parseInt(h.displayHour.split(':')[0], 10);
      if (isNaN(hourNum)) return;
      const diff = Math.abs(hourNum - currentHour);
      if (diff < minDiff) {
        minDiff = diff;
        nearestIdx = idx;
      }
    });
    if (nearestIdx >= 0) return nearestIdx;
  }

  let peakIdx = 0;
  let maxScore = -1;
  hourlyScores.forEach((h, idx) => {
    if (h.score > maxScore) {
      maxScore = h.score;
      peakIdx = idx;
    }
  });
  return peakIdx;
}

/** 深入剖析与 24H 走势共用同一个小时，按显示时刻对齐两份逐时数据 */
function matchSkyHour(skyHoursList: any[], activeHourData: { displayHour: string } | null): any {
  if (!activeHourData || skyHoursList.length === 0) return null;
  const hourNum = parseInt(activeHourData.displayHour.split(':')[0], 10);
  return skyHoursList.find((item) => item.hourNum === hourNum) || null;
}

Page({
  data: {
    currentLocation: withCoordinateDisplay(PRESET_LOCATIONS[0]),
    evaluations: [] as DailyForecastEvaluation[],
    rawApiData: null as WeatherApiResponse | null,
    airQualityData: null as AirQualityApiResponse | null,
    selectedDayIdx: 0,
    activeTab: 'travel_weather' as PhenomenonType,

    // Derived active view data (for convenient WXML data binding)
    currentDay: null as DailyForecastEvaluation | null,
    currentPrediction: null as PhenomenonPrediction | null,
    activeHourIndex: 0,
    activeHourData: null as any,
    hourScrollIntoView: '',

    // UI state
    isLoading: true,
    isLocating: false,
    isPickingOnMap: false,
    errorMsg: null as string | null,
    showTips: false,
    showSkyTimeline: false,

    // Deep dive state (hour is shared with the 24H trend bar)
    skyHoursList: [] as any[],
    activeSkyHourData: null as any,
    skyInsight: {
      title: '24 小时体感与出行条件剖析',
      subtitle: '降水、体感温湿、风力与能见度逐时对照',
    },

    // Location Modal state
    isLocationModalOpen: false,
    locationTab: 'places' as 'places' | 'saved' | 'custom',
    presetCategory: 'hangzhou' as 'hangzhou' | 'zhejiang' | 'national',
    filteredPresets: [] as LocationItem[],
    searchQuery: '',
    hasSearchQuery: false,
    mapHistory: [] as LocationItem[],
    savedLocs: [] as LocationItem[],
    savedIdMap: {} as Record<string, boolean>,
    customName: '',
    customLat: '',
    customLon: '',
    customElev: '',

    // Guide Modal state
    isGuideModalOpen: false,
    guideTopic: 'cloud_sea' as 'cloud_sea' | 'glow' | 'camera',
  },

  onLoad(query: Record<string, string | undefined>) {
    const saved = getSavedLocations();
    const catalog = PRESET_LOCATIONS.concat(saved, getMapHistory());
    const fromQuery = resolveLocationFromQuery(query, catalog);
    const lastLoc = fromQuery || getLastActiveLocation();
    const activeTab = parseSkyTab(query.tab);
    const initialPresets = PRESET_LOCATIONS.filter((p) => p.category === 'hangzhou');

    this.setData({
      currentLocation: withCoordinateDisplay(lastLoc),
      activeTab,
      savedLocs: displayLocations(saved),
      savedIdMap: this.buildSavedIdMap(saved),
      filteredPresets: displayLocations(initialPresets),
    });
    wx.setNavigationBarTitle({ title: skyNavTitle(lastLoc.name, activeTab) });
    this.loadForecast(lastLoc);
  },

  currentSkyPath() {
    return buildSkyPath(this.data.currentLocation, this.data.activeTab);
  },

  onShareAppMessage() {
    const locName = this.data.currentLocation?.name || '';
    return {
      title: locName ? `${locName} 的徒步 · 云海 · 日出晚霞预报` : '出游助手：徒步 · 云海 · 日出晚霞预报',
      path: this.currentSkyPath(),
    };
  },

  onShareTimeline() {
    const locName = this.data.currentLocation?.name || '';
    const path = this.currentSkyPath();
    const query = path.includes('?') ? path.slice(path.indexOf('?') + 1) : '';
    return {
      title: locName ? `${locName} 的徒步 · 云海 · 日出晚霞预报` : '出游助手：徒步 · 云海 · 日出晚霞预报',
      query,
    };
  },

  async loadForecast(loc: LocationItem) {
    this.setData({
      isLoading: true,
      errorMsg: null,
    });

    try {
      const { weather, airQuality } = await fetchSkyForecastBundle(
        loc.latitude,
        loc.longitude,
        loc.elevation
      );
      const evals = evaluateForecast(weather, airQuality);

      setLastActiveLocation(loc);
      wx.setNavigationBarTitle({ title: skyNavTitle(loc.name, this.data.activeTab) });

      this.setData(
        {
          rawApiData: weather,
          airQualityData: airQuality,
          evaluations: evals,
          selectedDayIdx: 0,
          currentLocation: withCoordinateDisplay(loc),
          isLoading: false,
        },
        () => {
          this.updateActiveView();
        }
      );
    } catch (err: any) {
      console.error('loadForecast error:', err);
      this.setData({
        isLoading: false,
        errorMsg: err.message || '获取天气预报失败，请检查网络设置',
      });
    }
  },

  handleRefresh() {
    this.loadForecast(this.data.currentLocation);
  },

  // Update currentDay, currentPrediction, activeHourData, and sky timeline data
  updateActiveView() {
    const { evaluations, selectedDayIdx, activeTab, rawApiData } = this.data;
    if (!evaluations || evaluations.length === 0) return;

    const day = evaluations[selectedDayIdx] || evaluations[0];
    const prediction = day.predictions[activeTab] || day.predictions.travel_weather;

    // Default active hour: current hour for today, peak score hour otherwise
    const defaultHourIdx = resolveDefaultHourIndex(prediction.hourlyScores, day.date);
    const activeHourData = prediction.hourlyScores?.[defaultHourIdx] || null;

    // Prepare sky timeline hours for the target day
    const skyInsight = getSkyInsightMeta(activeTab);
    let skyHoursList: any[] = [];
    if (rawApiData && rawApiData.hourly) {
      const hourly = rawApiData.hourly;
      for (let i = 0; i < hourly.time.length; i++) {
        const t = hourly.time[i];
        if (t.startsWith(day.date)) {
          const hourStr = t.split('T')[1]?.substring(0, 5) || '';
          skyHoursList.push(
            decorateSkyHour(activeTab, {
              timeStr: hourStr,
              fullTime: t,
              hourNum: parseInt(hourStr.split(':')[0], 10),
              temp: Math.round(hourly.temperature_2m[i] ?? 0),
              humidity: Math.round(hourly.relative_humidity_2m[i] ?? 0),
              windSpeed: Math.round(hourly.wind_speed_10m[i] ?? 0),
              visibilityKm: Math.round((hourly.visibility[i] ?? 10000) / 1000),
              cloudLow: Math.round(hourly.cloud_cover_low[i] ?? 0),
              cloudMid: Math.round(hourly.cloud_cover_mid[i] ?? 0),
              cloudHigh: Math.round(hourly.cloud_cover_high[i] ?? 0),
              cloudTotal: Math.round(hourly.cloud_cover[i] ?? 0),
              precipProb: Math.round(hourly.precipitation_probability?.[i] ?? 0),
              apparentTemp:
                hourly.apparent_temperature?.[i] === undefined
                  ? undefined
                  : Math.round(hourly.apparent_temperature[i] as number),
              gusts:
                hourly.wind_gusts_10m?.[i] == null
                  ? undefined
                  : Math.round(hourly.wind_gusts_10m[i] as number),
            })
          );
        }
      }
    }

    this.setData({
      currentDay: day,
      currentPrediction: prediction,
      activeHourIndex: defaultHourIdx,
      activeHourData,
      hourScrollIntoView: activeHourData ? `hour-bar-${defaultHourIdx}` : '',
      skyHoursList,
      activeSkyHourData: matchSkyHour(skyHoursList, activeHourData),
      skyInsight,
    });
  },

  handleSelectDay(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    if (idx !== this.data.selectedDayIdx) {
      this.setData({ selectedDayIdx: idx }, () => {
        this.updateActiveView();
      });
    }
  },

  handleTabChange(e: WechatMiniprogram.TouchEvent) {
    const tab = e.currentTarget.dataset.tab as PhenomenonType;
    if (tab && tab !== this.data.activeTab) {
      this.setData({ activeTab: tab }, () => {
        wx.setNavigationBarTitle({ title: skyNavTitle(this.data.currentLocation?.name, tab) });
        this.updateActiveView();
      });
    }
  },

  handleSelectHour(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const prediction = this.data.currentPrediction;
    if (prediction && prediction.hourlyScores && prediction.hourlyScores[idx]) {
      const activeHourData = prediction.hourlyScores[idx];
      this.setData({
        activeHourIndex: idx,
        activeHourData,
        activeSkyHourData: matchSkyHour(this.data.skyHoursList, activeHourData),
      });
    }
  },

  toggleTips() {
    this.setData({
      showTips: !this.data.showTips,
    });
  },

  toggleSkyTimeline() {
    this.setData({
      showSkyTimeline: !this.data.showSkyTimeline,
    });
  },

  async handleLocateUser() {
    this.setData({ isLocating: true });
    try {
      const coords = await getCurrentCoordinates();
      const loc: LocationItem = {
        id: `gps_${Date.now()}`,
        name: '当前设备位置',
        admin1: '定位点',
        latitude: coords.latitude,
        longitude: coords.longitude,
        isCustom: true,
        category: 'custom',
      };
      this.loadForecast(loc);
    } catch (err: any) {
      wx.showToast({
        title: err.message || '定位获取失败',
        icon: 'none',
      });
    } finally {
      this.setData({ isLocating: false });
    }
  },

  async handleChooseOnMap() {
    if (this.data.isPickingOnMap) return;
    this.setData({ isPickingOnMap: true });
    try {
      const picked = await chooseLocationOnMap();
      if (!picked) return;

      const loc: LocationItem = {
        id: `map_${Date.now()}`,
        name: picked.name || picked.address || '地图选点',
        admin1: picked.address || '地图选点',
        latitude: picked.latitude,
        longitude: picked.longitude,
        isCustom: true,
        category: 'custom',
      };
      const remembered = rememberMapLocation(loc);
      this.setData({ mapHistory: displayLocations(getMapHistory()) });
      this.closeLocationModal();
      this.loadForecast(remembered);
    } catch (err: any) {
      wx.showToast({
        title: err.message || '地图选点失败',
        icon: 'none',
      });
    } finally {
      this.setData({ isPickingOnMap: false });
    }
  },

  // ================= Location Modal Handlers =================

  buildSavedIdMap(list: LocationItem[]) {
    const map: Record<string, boolean> = {};
    list.forEach((item) => {
      map[item.id] = true;
    });
    getMapHistory().forEach((item) => {
      if (list.some((saved) => isSameLocation(saved, item))) {
        map[item.id] = true;
      }
    });
    return map;
  },

  openLocationModal() {
    const saved = getSavedLocations();
    this.setData({
      isLocationModalOpen: true,
      savedLocs: displayLocations(saved),
      savedIdMap: this.buildSavedIdMap(saved),
      searchQuery: '',
      hasSearchQuery: false,
      mapHistory: displayLocations(getMapHistory()),
      filteredPresets: displayLocations(
        PRESET_LOCATIONS.filter((p) => p.category === this.data.presetCategory)
      ),
    });
  },

  closeLocationModal() {
    this.setData({
      isLocationModalOpen: false,
    });
  },

  switchLocationTab(e: WechatMiniprogram.TouchEvent) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ locationTab: tab });
  },

  switchPresetCategory(e: WechatMiniprogram.TouchEvent) {
    const cat = e.currentTarget.dataset.category;
    this.setData({
      presetCategory: cat,
      searchQuery: '',
      hasSearchQuery: false,
    });
    this.refreshPlaceList();
  },

  refreshPlaceList() {
    const q = this.data.searchQuery.trim().toLowerCase();
    const cat = this.data.presetCategory;
    if (!q) {
      this.setData({
        hasSearchQuery: false,
        filteredPresets: displayLocations(PRESET_LOCATIONS.filter((p) => p.category === cat)),
      });
      return;
    }

    this.setData({
      hasSearchQuery: true,
      filteredPresets: displayLocations(
        searchOfflineLocations(q, getMapHistory().concat(getSavedLocations()))
      ),
    });
  },

  handleSelectLocation(e: WechatMiniprogram.TouchEvent) {
    const loc = e.currentTarget.dataset.loc as LocationItem;
    if (loc) {
      this.closeLocationModal();
      this.loadForecast(loc);
    }
  },

  handleToggleSave(e: WechatMiniprogram.TouchEvent) {
    const loc = e.currentTarget.dataset.loc as LocationItem;
    if (!loc) return;
    const saved = getSavedLocations();
    const isSaved = saved.some((x) => isSameLocation(x, loc));

    if (isSaved) {
      const match = saved.find((x) => isSameLocation(x, loc));
      removeSavedLocation(match ? match.id : loc.id);
      wx.showToast({ title: '已取消收藏', icon: 'none' });
    } else {
      saveLocation(loc);
      wx.showToast({ title: '已收藏地点', icon: 'none' });
    }
    const nextSaved = getSavedLocations();
    this.setData({
      savedLocs: displayLocations(nextSaved),
      savedIdMap: this.buildSavedIdMap(nextSaved),
    });
  },

  handleSearchInput(e: WechatMiniprogram.CustomEvent) {
    this.setData({ searchQuery: e.detail.value });
    this.refreshPlaceList();
  },

  handleSearchConfirm() {
    this.refreshPlaceList();
    const q = this.data.searchQuery.trim();
    if (
      q &&
      searchOfflineLocations(q, getMapHistory().concat(getSavedLocations())).length === 0
    ) {
      wx.showToast({
        title: '没有找到该地点，请使用地图选点',
        icon: 'none',
      });
    }
  },

  handleCustomNameInput(e: WechatMiniprogram.CustomEvent) {
    this.setData({ customName: e.detail.value });
  },
  handleCustomLatInput(e: WechatMiniprogram.CustomEvent) {
    this.setData({ customLat: e.detail.value });
  },
  handleCustomLonInput(e: WechatMiniprogram.CustomEvent) {
    this.setData({ customLon: e.detail.value });
  },
  handleCustomElevInput(e: WechatMiniprogram.CustomEvent) {
    this.setData({ customElev: e.detail.value });
  },

  handleSaveCustomLocation() {
    const { customName, customLat, customLon, customElev } = this.data;
    const lat = parseFloat(customLat);
    const lon = parseFloat(customLon);
    const elev = customElev ? parseInt(customElev, 10) : undefined;

    if (!customName.trim()) {
      wx.showToast({ title: '请输入地点名称', icon: 'none' });
      return;
    }
    if (isNaN(lat) || lat < -90 || lat > 90) {
      wx.showToast({ title: '纬度需在 -90 到 90 之间', icon: 'none' });
      return;
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
      wx.showToast({ title: '经度需在 -180 到 180 之间', icon: 'none' });
      return;
    }

    const newLoc: LocationItem = {
      id: `custom_${Date.now()}`,
      name: customName.trim(),
      latitude: lat,
      longitude: lon,
      elevation: elev,
      isCustom: true,
      category: 'custom',
    };

    saveLocation(newLoc);
    this.closeLocationModal();
    this.loadForecast(newLoc);
  },

  // ================= Guide Modal Handlers =================

  openGuideModal() {
    this.setData({ isGuideModalOpen: true });
  },

  closeGuideModal() {
    this.setData({ isGuideModalOpen: false });
  },

  switchGuideTopic(e: WechatMiniprogram.TouchEvent) {
    const topic = e.currentTarget.dataset.topic;
    this.setData({ guideTopic: topic });
  },
});
