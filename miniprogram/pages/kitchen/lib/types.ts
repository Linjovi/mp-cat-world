export interface Category {
  id: string
  name: string
  count: number
}

export interface PeopleRange {
  min: number
  max: number
}

export interface RecipeSummary {
  id: string
  name: string
  category: string
  categoryName: string
  difficulty: number
  calories: number
  summary: string
  people: PeopleRange | null
}

export interface RecipeListResponse {
  page: number
  pageSize: number
  total: number
  items: RecipeSummary[]
}

export interface Ingredient {
  text: string
  optional: boolean
}

export interface RecipeStep {
  title: string
  items: string[]
}

export interface RelatedRecipe {
  id: string
  name: string
}

export interface RecipeDetail extends RecipeSummary {
  ingredients: Ingredient[]
  tools: string[]
  calculationText: string
  steps: RecipeStep[]
  extras: string[]
  related: RelatedRecipe[]
}

export interface RecommendItem {
  role: 'vegetable' | 'meat' | 'aquatic'
  id: string
  name: string
  difficulty: number
  calories: number
}

export interface RecommendResponse {
  people: number
  vegetableCount: number
  meatCount: number
  items: RecommendItem[]
  warnings: string[]
}

export interface TipSummary {
  id: string
  group: 'basic' | 'learn' | 'advanced'
  name: string
  summary: string
}

export interface TipSection {
  title: string
  level: number
  body: string
  children: TipSection[]
}

export interface TipDetail {
  id: string
  group: 'basic' | 'learn' | 'advanced'
  name: string
  sections: TipSection[]
}

export interface ShoppingItem {
  id: string
  dishName: string
  text: string
  optional: boolean
  completed: boolean
}

export interface ActiveTimer {
  title: string
  totalSeconds: number
  endAt: number
  remainingWhenPaused: number
  isRunning: boolean
}
