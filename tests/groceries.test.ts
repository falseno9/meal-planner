import { describe, expect, it } from "vitest";
import { buildGroceryList } from "../src/shared/groceries";
import type { Plan } from "../src/shared/types";
import { meal } from "./fixtures";

describe("buildGroceryList", () => {
  it("combines matching ingredient name and unit pairs", () => {
    const items = [
      meal("saag", "veggie", {
        name: "Saag",
        ingredients: [
          { id: "spinach-1", name: "Spinach", quantity: 2, unit: "bunch", groceryCategory: "Produce" }
        ]
      }),
      meal("dal", "pulse", {
        name: "Dal",
        ingredients: [
          { id: "spinach-2", name: "spinach", quantity: 1, unit: "bunch", groceryCategory: "Produce" }
        ]
      })
    ];

    const groceries = buildGroceryList(planWithSelections(["saag", "dal"]), items);

    expect(groceries).toHaveLength(1);
    expect(groceries[0]).toMatchObject({ name: "Spinach", quantity: 3, unit: "bunch" });
    expect(groceries[0].sources.sort()).toEqual(["Dal", "Saag"]);
  });

  it("keeps different units separate", () => {
    const items = [
      meal("rice-a", "rice", {
        ingredients: [{ id: "rice-cup", name: "Rice", quantity: 2, unit: "cup" }]
      }),
      meal("rice-b", "rice", {
        ingredients: [{ id: "rice-kg", name: "Rice", quantity: 1, unit: "kg" }]
      })
    ];

    const groceries = buildGroceryList(planWithSelections(["rice-a", "rice-b"]), items);

    expect(groceries).toHaveLength(2);
    expect(groceries.map((line) => line.unit).sort()).toEqual(["cup", "kg"]);
  });

  it("ignores meal items without ingredients", () => {
    const groceries = buildGroceryList(planWithSelections(["plain-rice"]), [meal("plain-rice", "rice")]);

    expect(groceries).toEqual([]);
  });
});

function planWithSelections(itemIds: string[]): Plan {
  return {
    weekStart: "2026-04-13",
    eatingOutCount: 1,
    days: [
      {
        date: "2026-04-13",
        isEatingOut: false,
        locked: false,
        selections: Object.fromEntries(itemIds.map((itemId, index) => [`slot-${index}`, itemId]))
      }
    ],
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z"
  };
}
