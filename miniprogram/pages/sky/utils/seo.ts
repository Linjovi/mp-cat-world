import type { LocationItem, PhenomenonType } from '../types'

const TABS: PhenomenonType[] = [
  'travel_weather',
  'cloud_sea',
  'sunrise',
  'sunrise_glow',
  'sunset_glow',
  'starry_sky',
]

const TAB_LABEL: Record<PhenomenonType, string> = {
  travel_weather: '徒步',
  cloud_sea: '云海',
  sunrise: '日出',
  sunrise_glow: '朝霞',
  sunset_glow: '晚霞',
  starry_sky: '星空',
}

export function parseSkyTab(raw?: string): PhenomenonType {
  return raw && TABS.includes(raw as PhenomenonType) ? (raw as PhenomenonType) : 'travel_weather'
}

function isCatalogLocation(loc: { id?: string }): boolean {
  const id = loc.id || ''
  return Boolean(id) && !/^(gps_|map_|custom_|query_)/.test(id)
}

function decodeQueryValue(raw?: string): string {
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export function buildSkyPath(
  loc: Pick<LocationItem, 'id' | 'name' | 'latitude' | 'longitude' | 'elevation'>,
  tab: PhenomenonType = 'travel_weather'
): string {
  const parts: string[] = []
  if (isCatalogLocation(loc) && loc.id) {
    parts.push(`loc=${encodeURIComponent(loc.id)}`)
  } else {
    parts.push(`lat=${loc.latitude}`)
    parts.push(`lon=${loc.longitude}`)
    if (loc.name) parts.push(`name=${encodeURIComponent(loc.name)}`)
    if (loc.elevation !== undefined) parts.push(`elev=${loc.elevation}`)
  }
  if (tab !== 'travel_weather') parts.push(`tab=${tab}`)
  return `/pages/sky/index?${parts.join('&')}`
}

export function resolveLocationFromQuery(
  query: Record<string, string | undefined>,
  catalog: LocationItem[]
): LocationItem | null {
  const locId = query.loc ? decodeQueryValue(query.loc) : ''
  if (locId) {
    const found = catalog.find((item) => item.id === locId)
    if (found) return found
  }

  const lat = Number.parseFloat(query.lat || '')
  const lon = Number.parseFloat(query.lon || '')
  if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
    const elev = query.elev ? Number.parseInt(query.elev, 10) : undefined
    return {
      id: locId || `query_${lat}_${lon}`,
      name: decodeQueryValue(query.name) || '指定位置',
      latitude: lat,
      longitude: lon,
      elevation: Number.isFinite(elev) ? elev : undefined,
      isCustom: true,
      category: 'custom',
    }
  }

  return null
}

function shortLocationName(name: string): string {
  return name.split('(')[0].replace(/\s+/g, ' ').trim()
}

export function skyNavTitle(locName?: string, tab?: PhenomenonType): string {
  if (!locName) return '呼噜呼噜的出游助手'
  const label = tab ? TAB_LABEL[tab] : '出游'
  return `${shortLocationName(locName)} · ${label}预报`
}
