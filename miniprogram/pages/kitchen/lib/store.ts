import type { ActiveTimer, RecipeSummary, ShoppingItem } from './types'
import { formatClock } from './format'

const FAVORITES_KEY = 'howtocook_favorites'
const RECENTS_KEY = 'howtocook_recents'
const SHOPPING_KEY = 'howtocook_shopping'

type Listener = () => void

const dataListeners = new Set<Listener>()
const timerListeners = new Set<Listener>()

let favorites: RecipeSummary[] = readJson<RecipeSummary[]>(FAVORITES_KEY, []).filter(isRecipe)
let recentViews: RecipeSummary[] = readJson<RecipeSummary[]>(RECENTS_KEY, []).filter(isRecipe)
let shoppingList: ShoppingItem[] = readJson<ShoppingItem[]>(SHOPPING_KEY, []).filter(isShoppingItem)
let activeTimer: ActiveTimer | null = null
let timerAlarm = false
let ticker: number | null = null

function readJson<T>(key: string, fallback: T): T {
  try {
    const saved = wx.getStorageSync(key)
    if (!saved) return fallback
    const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved
    return Array.isArray(parsed) ? (parsed as T) : fallback
  } catch {
    return fallback
  }
}

function isRecipe(value: unknown): value is RecipeSummary {
  return Boolean(value && typeof value === 'object' && typeof (value as RecipeSummary).id === 'string' && typeof (value as RecipeSummary).name === 'string')
}

function isShoppingItem(value: unknown): value is ShoppingItem {
  return Boolean(value && typeof value === 'object' && typeof (value as ShoppingItem).id === 'string' && typeof (value as ShoppingItem).text === 'string')
}

function persist(key: string, value: unknown) {
  wx.setStorageSync(key, value)
}

function emitData() {
  dataListeners.forEach((listener) => listener())
}

function emitTimer() {
  timerListeners.forEach((listener) => listener())
}

function remainingSeconds(timer: ActiveTimer): number {
  if (!timer.isRunning) return timer.remainingWhenPaused
  return Math.max(0, Math.round((timer.endAt - Date.now()) / 1000))
}

function ensureTicker() {
  if (ticker !== null) return
  ticker = setInterval(() => {
    if (!activeTimer || !activeTimer.isRunning) return
    if (remainingSeconds(activeTimer) <= 0) {
      activeTimer = {
        ...activeTimer,
        isRunning: false,
        remainingWhenPaused: 0,
      }
      timerAlarm = true
      wx.vibrateLong()
    }
    emitTimer()
  }, 1000) as unknown as number
}

export function subscribe(listener: Listener) {
  dataListeners.add(listener)
  return () => {
    dataListeners.delete(listener)
  }
}

export function subscribeTimer(listener: Listener) {
  timerListeners.add(listener)
  return () => {
    timerListeners.delete(listener)
  }
}

export function getFavorites() {
  return favorites
}

export function favoriteIdSet() {
  return new Set(favorites.map((item) => item.id))
}

export function isFavorite(id: string) {
  return favorites.some((item) => item.id === id)
}

export function toggleFavorite(recipe: RecipeSummary) {
  if (isFavorite(recipe.id)) {
    favorites = favorites.filter((item) => item.id !== recipe.id)
  } else {
    favorites = [recipe, ...favorites.filter((item) => item.id !== recipe.id)]
  }
  persist(FAVORITES_KEY, favorites)
  emitData()
  return isFavorite(recipe.id)
}

export function addRecentView(recipe: RecipeSummary) {
  recentViews = [recipe, ...recentViews.filter((item) => item.id !== recipe.id)].slice(0, 30)
  persist(RECENTS_KEY, recentViews)
  emitData()
}

export function getRecentViews() {
  return recentViews
}

export function getShoppingList() {
  return shoppingList
}

export function addIngredientsToShoppingList(dishName: string, items: { text: string; optional: boolean }[]) {
  const fresh: ShoppingItem[] = []
  items.forEach((item) => {
    const exists = shoppingList.some((saved) => saved.dishName === dishName && saved.text === item.text)
      || fresh.some((saved) => saved.text === item.text)
    if (exists) return
    fresh.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      dishName,
      text: item.text,
      optional: item.optional,
      completed: false,
    })
  })
  if (fresh.length > 0) {
    shoppingList = [...fresh, ...shoppingList]
    persist(SHOPPING_KEY, shoppingList)
    emitData()
  }
  return fresh.length
}

export function toggleShoppingItem(id: string) {
  shoppingList = shoppingList.map((item) => (item.id === id ? { ...item, completed: !item.completed } : item))
  persist(SHOPPING_KEY, shoppingList)
  emitData()
}

export function removeShoppingItem(id: string) {
  shoppingList = shoppingList.filter((item) => item.id !== id)
  persist(SHOPPING_KEY, shoppingList)
  emitData()
}

export function clearShoppingList() {
  shoppingList = []
  persist(SHOPPING_KEY, shoppingList)
  emitData()
}

export function clearCompletedShopping() {
  shoppingList = shoppingList.filter((item) => !item.completed)
  persist(SHOPPING_KEY, shoppingList)
  emitData()
}

export function getTimerView() {
  if (!activeTimer && !timerAlarm) {
    return { visible: false, title: '', clock: '', alarm: false, running: false }
  }
  return {
    visible: true,
    title: activeTimer ? activeTimer.title : '烹饪计时完成',
    clock: timerAlarm ? '时间已到！请注意火候' : formatClock(activeTimer ? remainingSeconds(activeTimer) : 0),
    alarm: timerAlarm,
    running: Boolean(activeTimer && activeTimer.isRunning),
  }
}

export function startTimer(title: string, seconds: number) {
  timerAlarm = false
  activeTimer = {
    title,
    totalSeconds: seconds,
    endAt: Date.now() + seconds * 1000,
    remainingWhenPaused: seconds,
    isRunning: true,
  }
  ensureTicker()
  emitTimer()
}

export function pauseTimer() {
  if (!activeTimer || !activeTimer.isRunning) return
  activeTimer = {
    ...activeTimer,
    isRunning: false,
    remainingWhenPaused: remainingSeconds(activeTimer),
  }
  emitTimer()
}

export function resumeTimer() {
  if (!activeTimer || activeTimer.isRunning || activeTimer.remainingWhenPaused <= 0) return
  activeTimer = {
    ...activeTimer,
    isRunning: true,
    endAt: Date.now() + activeTimer.remainingWhenPaused * 1000,
  }
  ensureTicker()
  emitTimer()
}

export function stopTimer() {
  activeTimer = null
  timerAlarm = false
  emitTimer()
}

export function dismissAlarm() {
  timerAlarm = false
  if (activeTimer && activeTimer.remainingWhenPaused <= 0) activeTimer = null
  emitTimer()
}
