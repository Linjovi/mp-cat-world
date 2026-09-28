import { recipeHref } from './seo'
import type { PeopleRange, RecipeSummary, RecommendItem, ShoppingItem, TipSection, TipSummary } from './types'

export function peopleText(people: PeopleRange | null, style: 'short' | 'range' = 'short'): string {
  if (!people) return ''
  if (people.min === people.max) {
    return style === 'range' ? `${people.min} 人份` : `${people.min}人份`
  }
  return style === 'range' ? `${people.min} ~ ${people.max} 人份` : `${people.min}-${people.max}人份`
}

export function starFlags(difficulty: number): boolean[] {
  return [1, 2, 3, 4, 5].map((star) => star <= difficulty)
}

const THEME: Record<string, string> = {
  vegetable_dish: 'theme-veg',
  meat_dish: 'theme-meat',
  aquatic: 'theme-aqua',
  soup: 'theme-soup',
  staple: 'theme-staple',
  breakfast: 'theme-breakfast',
  dessert: 'theme-sweet',
  drink: 'theme-sweet',
  condiment: 'theme-staple',
  'semi-finished': 'theme-staple',
}

export function categoryTheme(category: string): string {
  return THEME[category] || 'theme-staple'
}

export interface RecipeCardVM extends RecipeSummary {
  favorite: boolean
  peopleText: string
  stars: boolean[]
  theme: string
  showCalories: boolean
  href: string
}

export function toRecipeCard(recipe: RecipeSummary, favoriteIds: Set<string>): RecipeCardVM {
  return {
    ...recipe,
    favorite: favoriteIds.has(recipe.id),
    peopleText: peopleText(recipe.people),
    stars: starFlags(recipe.difficulty),
    theme: categoryTheme(recipe.category),
    showCalories: recipe.calories > 0,
    href: recipeHref(recipe.id),
  }
}

export function toSummary(recipe: RecipeSummary): RecipeSummary {
  return {
    id: recipe.id,
    name: recipe.name,
    category: recipe.category,
    categoryName: recipe.categoryName,
    difficulty: recipe.difficulty,
    calories: recipe.calories,
    summary: recipe.summary,
    people: recipe.people,
  }
}

const ROLE_LABEL: Record<RecommendItem['role'], string> = {
  vegetable: '素菜',
  meat: '荤菜',
  aquatic: '水产',
}

const ROLE_THEME: Record<RecommendItem['role'], string> = {
  vegetable: 'theme-veg',
  meat: 'theme-meat',
  aquatic: 'theme-aqua',
}

export function toRecommendCard(item: RecommendItem) {
  return {
    ...item,
    roleLabel: ROLE_LABEL[item.role] || '荤菜',
    roleTheme: ROLE_THEME[item.role] || 'theme-meat',
    stars: starFlags(item.difficulty),
    showCalories: item.calories > 0,
    href: recipeHref(item.id),
  }
}

export function tipBadge(group: TipSummary['group'] | string) {
  if (group === 'basic') return { label: '常识', theme: 'theme-veg' }
  if (group === 'learn') return { label: '技法', theme: 'theme-meat' }
  if (group === 'advanced') return { label: '进阶', theme: 'theme-soup' }
  return { label: '技巧', theme: 'theme-staple' }
}

export function groupLabel(group: string): string {
  if (group === 'basic') return '厨房常识'
  if (group === 'learn') return '烹饪技法'
  if (group === 'advanced') return '进阶秘诀'
  return '技巧指南'
}

export interface RichPart {
  text: string
  bold: boolean
}

export interface RichLine {
  bullet: boolean
  parts: RichPart[]
}

export function parseBody(body: string): RichLine[] {
  if (!body) return []
  const lines: RichLine[] = []
  body.split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const bullet = trimmed.startsWith('* ') || trimmed.startsWith('- ') || /^\d+\.\s+/.test(trimmed)
    const clean = trimmed.replace(/^(\*|-|\d+\.)\s+/, '')
    const parts = clean
      .split(/(\*\*.*?\*\*)/g)
      .filter((part) => part.length > 0)
      .map((part) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
          return { text: part.slice(2, -2), bold: true }
        }
        return { text: part, bold: false }
      })
    lines.push({ bullet, parts })
  })
  return lines
}

export interface FlatSection {
  key: string
  title: string
  depth: number
  lines: RichLine[]
}

export function flattenSections(sections: TipSection[]): FlatSection[] {
  const acc: FlatSection[] = []
  const walk = (list: TipSection[], depth: number, prefix: string) => {
    list.forEach((section, index) => {
      const key = `${prefix}${index}`
      acc.push({
        key,
        title: section.title,
        depth,
        lines: parseBody(section.body),
      })
      if (section.children && section.children.length > 0) {
        walk(section.children, depth + 1, `${key}-`)
      }
    })
  }
  walk(sections || [], 0, '')
  return acc
}

export interface ShoppingGroup {
  dishName: string
  items: ShoppingItem[]
}

export function groupShopping(list: ShoppingItem[]): ShoppingGroup[] {
  const map = new Map<string, ShoppingItem[]>()
  list.forEach((item) => {
    const bucket = map.get(item.dishName) || []
    bucket.push(item)
    map.set(item.dishName, bucket)
  })
  return Array.from(map.entries()).map(([dishName, items]) => ({ dishName, items }))
}

export function shoppingText(list: ShoppingItem[]): string {
  const lines = ['【HowToCook 备料采购清单】']
  groupShopping(list).forEach((group) => {
    lines.push('')
    lines.push(`📌 ${group.dishName}:`)
    group.items.forEach((item) => {
      lines.push(`  ${item.completed ? '☑' : '☐'} ${item.text}${item.optional ? ' (可选)' : ''}`)
    })
  })
  return lines.join('\n')
}

export function findMinutes(text: string): number | null {
  const match = text.match(/(\d+)(?:\s*[-~到]\s*(\d+))?\s*(?:个)?(?:半)?\s*分钟/)
  if (match) {
    const minutes = parseInt(match[2] || match[1], 10)
    if (minutes > 0 && minutes <= 180) return minutes
  }
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*小时/)
  if (hourMatch) return Math.round(parseFloat(hourMatch[1]) * 60)
  return null
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const remain = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`
}

export function getNavMetrics() {
  const sysInfo = wx.getSystemInfoSync()
  const statusBarHeight = sysInfo.statusBarHeight || 20
  let navBarHeight = 44
  try {
    const menuRect = wx.getMenuButtonBoundingClientRect()
    navBarHeight = (menuRect.top - statusBarHeight) * 2 + menuRect.height
  } catch (error) {
    console.warn('getMenuButtonBoundingClientRect failed', error)
  }
  return { statusBarHeight, navBarHeight }
}

export function readQueryId(raw?: string): string {
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}
