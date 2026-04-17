import { buildWeekDates, daysBetween } from "./date";
import type { Category, DayPlan, GeneratePlanInput, MealItem, Plan, PlanStore } from "./types";

interface PlannerContext {
  categories: Category[];
  items: MealItem[];
  priorPlans: PlanStore;
}

interface ItemScore {
  item: MealItem;
  score: number;
}

export function generatePlan(input: GeneratePlanInput, context: PlannerContext): Plan {
  const activeCategories = context.categories
    .filter((category) => category.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const itemsByCategory = groupEnabledItemsByCategory(context.items);
  const weekDates = buildWeekDates(input.weekStart);
  const existingDaysByDate = new Map(input.existingPlan?.days.map((day) => [day.date, day]) ?? []);
  const lockedDays = new Set(
    input.existingPlan?.days.filter((day) => day.locked).map((day) => day.date) ?? []
  );
  const eatingOutDates = chooseEatingOutDates(weekDates, input.eatingOutCount, existingDaysByDate);
  const usage = buildInitialUsage(input.existingPlan, lockedDays);
  const now = new Date().toISOString();

  const days: DayPlan[] = weekDates.map((date) => {
    const existingDay = existingDaysByDate.get(date);

    if (existingDay?.locked) {
      addSelectionsToUsage(existingDay, context.items, usage);
      return existingDay;
    }

    if (eatingOutDates.has(date)) {
      return {
        date,
        isEatingOut: true,
        locked: false,
        selections: {}
      };
    }

    const selections: Record<string, string | undefined> = {};

    for (const category of activeCategories) {
      const candidates = itemsByCategory.get(category.id) ?? [];
      const selected = chooseBestItem({
        candidates,
        categoryId: category.id,
        weekStart: input.weekStart,
        priorPlans: context.priorPlans,
        usage
      });

      if (selected) {
        selections[category.id] = selected.id;
        recordUsage(selected, usage);
      }
    }

    return {
      date,
      isEatingOut: false,
      locked: false,
      selections
    };
  });

  return {
    weekStart: input.weekStart,
    eatingOutCount: input.eatingOutCount,
    days,
    cookedBatches: input.existingPlan?.cookedBatches ?? [],
    createdAt: input.existingPlan?.createdAt ?? now,
    updatedAt: now
  };
}

function groupEnabledItemsByCategory(items: MealItem[]): Map<string, MealItem[]> {
  const grouped = new Map<string, MealItem[]>();

  for (const item of items) {
    if (!item.enabled) continue;
    const current = grouped.get(item.categoryId) ?? [];
    current.push(item);
    grouped.set(item.categoryId, current);
  }

  for (const categoryItems of grouped.values()) {
    categoryItems.sort((a, b) => a.name.localeCompare(b.name));
  }

  return grouped;
}

function chooseEatingOutDates(
  weekDates: string[],
  eatingOutCount: 1 | 2,
  existingDaysByDate: Map<string, DayPlan>
): Set<string> {
  const lockedEatingOut = weekDates.filter((date) => {
    const day = existingDaysByDate.get(date);
    return day?.locked && day.isEatingOut;
  });
  const lockedHome = new Set(
    weekDates.filter((date) => {
      const day = existingDaysByDate.get(date);
      return day?.locked && !day.isEatingOut;
    })
  );
  const result = new Set(lockedEatingOut.slice(0, eatingOutCount));
  const preferredIndexes = eatingOutCount === 2 ? [2, 5, 4, 1, 6, 3, 0] : [5, 4, 2, 6, 1, 3, 0];

  for (const index of preferredIndexes) {
    if (result.size >= eatingOutCount) break;
    const date = weekDates[index];
    if (!lockedHome.has(date)) result.add(date);
  }

  return result;
}

interface UsageState {
  itemIds: Set<string>;
  tags: Map<string, number>;
  efforts: Map<string, number>;
}

function buildInitialUsage(existingPlan: Plan | undefined, lockedDays: Set<string>): UsageState {
  const usage: UsageState = {
    itemIds: new Set(),
    tags: new Map(),
    efforts: new Map()
  };

  if (!existingPlan) return usage;
  for (const day of existingPlan.days) {
    if (!lockedDays.has(day.date)) continue;
    for (const itemId of Object.values(day.selections)) {
      if (itemId) usage.itemIds.add(itemId);
    }
  }

  return usage;
}

function addSelectionsToUsage(day: DayPlan, allItems: MealItem[], usage: UsageState): void {
  const byId = new Map(allItems.map((item) => [item.id, item]));
  for (const itemId of Object.values(day.selections)) {
    if (!itemId) continue;
    const item = byId.get(itemId);
    if (item) recordUsage(item, usage);
  }
}

function recordUsage(item: MealItem, usage: UsageState): void {
  usage.itemIds.add(item.id);
  usage.efforts.set(item.effort, (usage.efforts.get(item.effort) ?? 0) + 1);
  for (const tag of item.tags) {
    usage.tags.set(tag.toLowerCase(), (usage.tags.get(tag.toLowerCase()) ?? 0) + 1);
  }
}

interface ChooseBestItemInput {
  candidates: MealItem[];
  categoryId: string;
  weekStart: string;
  priorPlans: PlanStore;
  usage: UsageState;
}

function chooseBestItem(input: ChooseBestItemInput): MealItem | undefined {
  if (input.candidates.length === 0) return undefined;

  const scored = input.candidates.map((item): ItemScore => {
    let score = 100;

    if (input.usage.itemIds.has(item.id)) score -= 45;

    const weeksSinceUse = getWeeksSinceUse(item.id, input.weekStart, input.priorPlans);
    if (weeksSinceUse !== undefined) {
      if (weeksSinceUse < item.cooldownWeeks) score -= 80 - weeksSinceUse * 10;
      score -= Math.max(0, 20 - weeksSinceUse * 4);
    }

    score -= (input.usage.efforts.get(item.effort) ?? 0) * 8;
    for (const tag of item.tags) {
      score -= (input.usage.tags.get(tag.toLowerCase()) ?? 0) * 10;
    }

    score += stableTieBreaker(item.id, input.categoryId) / 1000;

    return { item, score };
  });

  return scored.sort((a, b) => b.score - a.score)[0]?.item;
}

function getWeeksSinceUse(itemId: string, weekStart: string, priorPlans: PlanStore): number | undefined {
  let closestWeeks: number | undefined;

  for (const plan of Object.values(priorPlans)) {
    if (plan.weekStart >= weekStart) continue;

    const used =
      plan.days.some((day) => Object.values(day.selections).includes(itemId)) ||
      (plan.cookedBatches ?? []).some((batch) => batch.itemId === itemId);
    if (!used) continue;

    const weeks = Math.floor(daysBetween(plan.weekStart, weekStart) / 7);
    if (closestWeeks === undefined || weeks < closestWeeks) closestWeeks = weeks;
  }

  return closestWeeks;
}

function stableTieBreaker(value: string, salt: string): number {
  const text = `${salt}:${value}`;
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash % 1000;
}
