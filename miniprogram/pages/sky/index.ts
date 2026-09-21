import {
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
} from './utils/locations';
import { fetchWeatherForecast, searchLocations, getCurrentCoordinates } from './utils/api';
import { evaluateForecast } from './utils/weatherModel';

Page({
  data: {
    // Navigation bar metrics
    statusBarHeight: 20,
    navBarHeight: 44,

    // Core forecasting data
    currentLocation: PRESET_LOCATIONS[0] as LocationItem,
    evaluations: [] as DailyForecastEvaluation[],
    rawApiData: null as WeatherApiResponse | null,
    selectedDayIdx: 0,
    activeTab: 'travel_weather' as PhenomenonType,

    // Derived active view data (for convenient WXML data binding)
    currentDay: null as DailyForecastEvaluation | null,
    currentPrediction: null as PhenomenonPrediction | null,
    activeHourIndex: 0,
    activeHourData: null as any,

    // UI state
    isLoading: true,
    isLocating: false,
    errorMsg: null as string | null,
    showTips: false,
    showSkyTimeline: false,

    // Sky timeline state
    skyHoursList: [] as any[],
    selectedSkyHourIdx: 0,
    activeSkyHourData: null as any,

    // Location Modal state
    isLocationModalOpen: false,
    locationTab: 'places' as 'places' | 'saved' | 'custom',
    presetCategory: 'hangzhou' as 'hangzhou' | 'zhejiang' | 'national',
    filteredPresets: [] as LocationItem[],
    searchQuery: '',
    searchResults: [] as LocationItem[],
    isSearching: false,
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

  onLoad() {
    // 1. Calculate status bar & nav bar height
    try {
      const sysInfo = wx.getSystemInfoSync();
      const statusBarHeight = sysInfo.statusBarHeight || 20;
      let navBarHeight = 44;
      if (wx.getMenuButtonBoundingClientRect) {
        const menuRect = wx.getMenuButtonBoundingClientRect();
        navBarHeight = (menuRect.top - statusBarHeight) * 2 + menuRect.height;
      }
      this.setData({
        statusBarHeight,
        navBarHeight,
      });
    } catch (e) {
      console.warn('getSystemInfoSync failed', e);
    }

    // 2. Load last active location & initial presets
    const lastLoc = getLastActiveLocation();
    const saved = getSavedLocations();
    const initialPresets = PRESET_LOCATIONS.filter((p) => p.category === 'hangzhou');

    this.setData({
      currentLocation: lastLoc,
      savedLocs: saved,
      savedIdMap: this.buildSavedIdMap(saved),
      filteredPresets: initialPresets,
    });

    // 3. Load forecast
    this.loadForecast(lastLoc);
  },

  handleBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  },

  async loadForecast(loc: LocationItem) {
    this.setData({
      isLoading: true,
      errorMsg: null,
    });

    try {
      const data = await fetchWeatherForecast(loc.latitude, loc.longitude);
      const evals = evaluateForecast(data);

      setLastActiveLocation(loc);

      this.setData(
        {
          rawApiData: data,
          evaluations: evals,
          selectedDayIdx: 0,
          currentLocation: loc,
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

    // Default active hour is peak score hour
    let peakIdx = 0;
    let maxScore = -1;
    if (prediction.hourlyScores && prediction.hourlyScores.length > 0) {
      prediction.hourlyScores.forEach((h, idx) => {
        if (h.score > maxScore) {
          maxScore = h.score;
          peakIdx = idx;
        }
      });
    }

    const activeHourData = prediction.hourlyScores?.[peakIdx] || null;

    // Prepare sky timeline hours for the target day
    let skyHoursList: any[] = [];
    if (rawApiData && rawApiData.hourly) {
      const hourly = rawApiData.hourly;
      for (let i = 0; i < hourly.time.length; i++) {
        const t = hourly.time[i];
        if (t.startsWith(day.date)) {
          const hourStr = t.split('T')[1]?.substring(0, 5) || '';
          skyHoursList.push({
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
            precipProb: Math.round(hourly.precipitation_probability[i] ?? 0),
          });
        }
      }
    }

    // Default sky hour index
    let defaultSkyIdx = 8;
    if (activeTab === 'travel_weather') {
      const idx = skyHoursList.findIndex((h) => h.hourNum === 10);
      defaultSkyIdx = idx !== -1 ? idx : 10;
    } else if (activeTab === 'sunrise' || activeTab === 'cloud_sea') {
      const srH = parseInt(day.sunrise.split(':')[0], 10);
      const idx = skyHoursList.findIndex((h) => h.hourNum === srH);
      defaultSkyIdx = idx !== -1 ? idx : 6;
    } else if (activeTab === 'sunset_glow') {
      const ssH = parseInt(day.sunset.split(':')[0], 10);
      const idx = skyHoursList.findIndex((h) => h.hourNum === ssH);
      defaultSkyIdx = idx !== -1 ? idx : 18;
    }
    defaultSkyIdx = Math.max(0, Math.min(skyHoursList.length - 1, defaultSkyIdx));

    this.setData({
      currentDay: day,
      currentPrediction: prediction,
      activeHourIndex: peakIdx,
      activeHourData,
      skyHoursList,
      selectedSkyHourIdx: defaultSkyIdx,
      activeSkyHourData: skyHoursList[defaultSkyIdx] || null,
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
        this.updateActiveView();
      });
    }
  },

  handleSelectHour(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const prediction = this.data.currentPrediction;
    if (prediction && prediction.hourlyScores && prediction.hourlyScores[idx]) {
      this.setData({
        activeHourIndex: idx,
        activeHourData: prediction.hourlyScores[idx],
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

  handleSelectSkyHour(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const item = this.data.skyHoursList[idx];
    if (item) {
      this.setData({
        selectedSkyHourIdx: idx,
        activeSkyHourData: item,
      });
    }
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

  // ================= Location Modal Handlers =================

  buildSavedIdMap(list: LocationItem[]) {
    const map: Record<string, boolean> = {};
    list.forEach((item) => {
      map[item.id] = true;
    });
    return map;
  },

  openLocationModal() {
    const saved = getSavedLocations();
    this.setData({
      isLocationModalOpen: true,
      savedLocs: saved,
      savedIdMap: this.buildSavedIdMap(saved),
      searchQuery: '',
      searchResults: [],
      filteredPresets: PRESET_LOCATIONS.filter((p) => p.category === this.data.presetCategory),
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
      searchResults: [],
    });
    this.refreshPlaceList();
  },

  refreshPlaceList() {
    const q = this.data.searchQuery.trim().toLowerCase();
    const cat = this.data.presetCategory;
    if (!q) {
      this.setData({
        filteredPresets: PRESET_LOCATIONS.filter((p) => p.category === cat),
      });
      return;
    }

    const local = PRESET_LOCATIONS.filter((p) => {
      const haystack = [p.name, p.admin1, p.admin2, p.country]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.indexOf(q) !== -1;
    });

    const remote = this.data.searchResults.filter((r) =>
      !local.some(
        (l) =>
          l.id === r.id ||
          (Math.abs(l.latitude - r.latitude) < 0.01 && Math.abs(l.longitude - r.longitude) < 0.01)
      )
    );

    this.setData({
      filteredPresets: local.concat(remote),
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
    const isSaved = saved.some((x) => x.id === loc.id);

    if (isSaved) {
      removeSavedLocation(loc.id);
      wx.showToast({ title: '已取消收藏', icon: 'none' });
    } else {
      saveLocation(loc);
      wx.showToast({ title: '已收藏地点', icon: 'none' });
    }
    const nextSaved = getSavedLocations();
    this.setData({
      savedLocs: nextSaved,
      savedIdMap: this.buildSavedIdMap(nextSaved),
    });
  },

  handleSearchInput(e: WechatMiniprogram.CustomEvent) {
    this.setData({
      searchQuery: e.detail.value,
      searchResults: e.detail.value ? this.data.searchResults : [],
    });
    this.refreshPlaceList();
  },

  async handleSearch() {
    const q = this.data.searchQuery.trim();
    if (!q) {
      this.setData({ searchResults: [] });
      this.refreshPlaceList();
      return;
    }
    this.setData({ isSearching: true });
    try {
      const res = await searchLocations(q);
      this.setData({
        searchResults: res,
        isSearching: false,
      });
      this.refreshPlaceList();
      if (this.data.filteredPresets.length === 0) {
        wx.showToast({ title: '未找到匹配地点，请尝试其他关键词', icon: 'none' });
      }
    } catch (err: any) {
      this.setData({ isSearching: false });
      wx.showToast({ title: err.message || '检索繁忙，请稍后', icon: 'none' });
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
