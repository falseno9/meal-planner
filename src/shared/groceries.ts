import type { GroceryLine, MealItem, Plan } from "./types";

export function buildGroceryList(plan: Plan | undefined, items: MealItem[]): GroceryLine[] {
  if (!plan) return [];

  const itemsById = new Map(items.map((item) => [item.id, item]));
  const groceries = new Map<string, GroceryLine>();

  for (const day of plan.days) {
    if (day.isEatingOut) continue;

    for (const itemId of Object.values(day.selections)) {
      if (!itemId) continue;
      const item = itemsById.get(itemId);
      if (!item) continue;

      for (const ingredient of item.ingredients) {
        const normalizedName = ingredient.name.trim().toLowerCase();
        const normalizedUnit = ingredient.unit.trim().toLowerCase();
        if (!normalizedName || !normalizedUnit) continue;

        const key = `${normalizedName}|${normalizedUnit}`;
        const current = groceries.get(key) ?? {
          key,
          name: ingredient.name.trim(),
          quantity: 0,
          unit: ingredient.unit.trim(),
          groceryCategory: ingredient.groceryCategory,
          sources: [],
          notes: []
        };

        current.quantity += Number(ingredient.quantity) || 0;
        if (!current.sources.includes(item.name)) current.sources.push(item.name);
        if (ingredient.notes) current.notes.push(ingredient.notes);
        if (!current.groceryCategory && ingredient.groceryCategory) {
          current.groceryCategory = ingredient.groceryCategory;
        }

        groceries.set(key, current);
      }
    }
  }

  return Array.from(groceries.values()).sort((a, b) => {
    const categorySort = (a.groceryCategory ?? "").localeCompare(b.groceryCategory ?? "");
    if (categorySort !== 0) return categorySort;
    return a.name.localeCompare(b.name);
  });
}
