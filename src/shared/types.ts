export type EffortLevel = "low" | "medium" | "high";

export interface Category {
  id: string;
  name: string;
  enabled: boolean;
  sortOrder: number;
}

export interface Ingredient {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  groceryCategory?: string;
  notes?: string;
}

export interface MealItem {
  id: string;
  name: string;
  categoryId: string;
  enabled: boolean;
  tags: string[];
  effort: EffortLevel;
  cooldownWeeks: number;
  notes?: string;
  ingredients: Ingredient[];
  createdAt: string;
  updatedAt: string;
}

export interface DayPlan {
  date: string;
  isEatingOut: boolean;
  locked: boolean;
  selections: Record<string, string | undefined>;
}

export interface CookedBatch {
  id: string;
  itemId: string;
  cookedOn: string;
  eatenOnDates: string[];
  notes?: string;
}

export interface Plan {
  weekStart: string;
  eatingOutCount: 1 | 2;
  days: DayPlan[];
  cookedBatches: CookedBatch[];
  createdAt: string;
  updatedAt: string;
}

export interface GeneratePlanInput {
  weekStart: string;
  eatingOutCount: 1 | 2;
  existingPlan?: Plan;
}

export interface GroceryLine {
  key: string;
  name: string;
  quantity: number;
  unit: string;
  groceryCategory?: string;
  sources: string[];
  notes: string[];
}

export type PlanStore = Record<string, Plan>;
