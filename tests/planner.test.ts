import { describe, expect, it } from "vitest";
import { generatePlan } from "../src/shared/planner";
import type { DayPlan, MealItem, Plan } from "../src/shared/types";
import { fixtureCategories, meal } from "./fixtures";

describe("generatePlan", () => {
  it("generates home dinners for seven days minus eating-out slots", () => {
    const items = buildItemSet();
    const plan = generatePlan(
      { weekStart: "2026-04-13", eatingOutCount: 2 },
      { categories: fixtureCategories, items, priorPlans: {} }
    );

    expect(plan.days).toHaveLength(7);
    expect(plan.days.filter((day) => day.isEatingOut)).toHaveLength(2);
    expect(plan.days.filter((day) => !day.isEatingOut)).toHaveLength(5);
    for (const day of plan.days.filter((entry) => !entry.isEatingOut)) {
      expect(Object.keys(day.selections).sort()).toEqual(["pulse", "rice", "veggie"]);
    }
  });

  it("excludes disabled items", () => {
    const items = [
      meal("disabled-veg", "veggie", { enabled: false }),
      meal("enabled-veg", "veggie"),
      meal("dal", "pulse"),
      meal("rice", "rice")
    ];

    const plan = generatePlan(
      { weekStart: "2026-04-13", eatingOutCount: 1 },
      { categories: fixtureCategories, items, priorPlans: {} }
    );

    expect(allSelectionIds(plan)).not.toContain("disabled-veg");
    expect(allSelectionIds(plan)).toContain("enabled-veg");
  });

  it("respects cooldowns when alternatives exist", () => {
    const items = [
      meal("recent-veg", "veggie", { cooldownWeeks: 2 }),
      meal("fresh-veg", "veggie"),
      meal("dal", "pulse"),
      meal("rice", "rice")
    ];
    const priorPlan = savedPlanWithSelections("2026-04-06", {
      "2026-04-06": { veggie: "recent-veg" }
    });

    const plan = generatePlan(
      { weekStart: "2026-04-13", eatingOutCount: 1 },
      { categories: fixtureCategories, items, priorPlans: { "2026-04-06": priorPlan } }
    );
    const firstHomeDay = plan.days.find((day) => !day.isEatingOut);

    expect(firstHomeDay?.selections.veggie).toBe("fresh-veg");
  });

  it("reduces repeats from recent saved plans", () => {
    const items = [
      meal("recent-veg", "veggie"),
      meal("fresh-veg", "veggie"),
      meal("dal", "pulse"),
      meal("rice", "rice")
    ];
    const priorPlan = savedPlanWithSelections("2026-04-06", {
      "2026-04-06": { veggie: "recent-veg" }
    });

    const plan = generatePlan(
      { weekStart: "2026-04-13", eatingOutCount: 1 },
      { categories: fixtureCategories, items, priorPlans: { "2026-04-06": priorPlan } }
    );
    const firstHomeDay = plan.days.find((day) => !day.isEatingOut);

    expect(firstHomeDay?.selections.veggie).toBe("fresh-veg");
  });

  it("keeps locked plan entries unchanged during regeneration", () => {
    const items = buildItemSet();
    const lockedDay: DayPlan = {
      date: "2026-04-13",
      isEatingOut: false,
      locked: true,
      selections: { veggie: "veg-locked", pulse: "pulse-locked", rice: "rice-locked" }
    };
    const existingPlan: Plan = {
      weekStart: "2026-04-13",
      eatingOutCount: 1,
      days: [
        lockedDay,
        ...["2026-04-14", "2026-04-15", "2026-04-16", "2026-04-17", "2026-04-18", "2026-04-19"].map(
          (date) => ({ date, isEatingOut: false, locked: false, selections: {} })
        )
      ],
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z"
    };

    const plan = generatePlan(
      { weekStart: "2026-04-13", eatingOutCount: 1, existingPlan },
      { categories: fixtureCategories, items, priorPlans: {} }
    );

    expect(plan.days[0]).toEqual(lockedDay);
  });
});

function buildItemSet(): MealItem[] {
  return [
    meal("veg-1", "veggie", { tags: ["leafy"], effort: "low" }),
    meal("veg-2", "veggie", { tags: ["root"], effort: "medium" }),
    meal("veg-locked", "veggie"),
    meal("pulse-1", "pulse", { tags: ["dal"], effort: "low" }),
    meal("pulse-2", "pulse", { tags: ["beans"], effort: "high" }),
    meal("pulse-locked", "pulse"),
    meal("rice-1", "rice", { tags: ["plain"], effort: "low" }),
    meal("rice-2", "rice", { tags: ["tempered"], effort: "medium" }),
    meal("rice-locked", "rice")
  ];
}

function allSelectionIds(plan: Plan): string[] {
  return plan.days.flatMap((day) => Object.values(day.selections).filter(Boolean) as string[]);
}

function savedPlanWithSelections(weekStart: string, selectionsByDate: Record<string, Record<string, string>>): Plan {
  return {
    weekStart,
    eatingOutCount: 1,
    days: Object.entries(selectionsByDate).map(([date, selections]) => ({
      date,
      isEatingOut: false,
      locked: false,
      selections
    })),
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z"
  };
}
