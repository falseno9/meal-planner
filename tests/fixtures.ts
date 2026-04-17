import type { Category, EffortLevel, MealItem, Plan } from "../src/shared/types";

export const fixtureCategories: Category[] = [
  { id: "veggie", name: "Veggie", enabled: true, sortOrder: 1 },
  { id: "pulse", name: "Pulse", enabled: true, sortOrder: 2 },
  { id: "rice", name: "Rice", enabled: true, sortOrder: 3 }
];

export function meal(
  id: string,
  categoryId: string,
  options: Partial<MealItem> = {}
): MealItem {
  const now = "2026-04-01T00:00:00.000Z";
  return {
    id,
    name: options.name ?? id,
    categoryId,
    enabled: options.enabled ?? true,
    tags: options.tags ?? [],
    effort: options.effort ?? ("medium" as EffortLevel),
    cooldownWeeks: options.cooldownWeeks ?? 0,
    notes: options.notes ?? "",
    ingredients: options.ingredients ?? [],
    createdAt: options.createdAt ?? now,
    updatedAt: options.updatedAt ?? now
  };
}

export function savedPlan(weekStart: string, itemIdsByDate: Record<string, string[]>): Plan {
  return {
    weekStart,
    eatingOutCount: 1,
    days: Object.entries(itemIdsByDate).map(([date, itemIds]) => ({
      date,
      isEatingOut: false,
      locked: false,
      selections: Object.fromEntries(itemIds.map((itemId, index) => [`category-${index}`, itemId]))
    })),
    cookedBatches: [],
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z"
  };
}
