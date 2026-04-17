import express from "express";
import { randomUUID } from "node:crypto";
import { buildGroceryList } from "../shared/groceries";
import { generatePlan } from "../shared/planner";
import type { Category, CookedBatch, GeneratePlanInput, Ingredient, MealItem, Plan } from "../shared/types";
import { JsonStore } from "./storage";

export function createApp(store = new JsonStore()) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/categories", async (_request, response, next) => {
    try {
      response.json(await store.readCategories());
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/categories", async (request, response, next) => {
    try {
      const categories = normalizeCategories(request.body);
      await store.writeCategories(categories);
      response.json(categories);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/items", async (_request, response, next) => {
    try {
      response.json(await store.readItems());
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/items", async (request, response, next) => {
    try {
      const items = await store.readItems();
      const now = new Date().toISOString();
      const item = normalizeMealItem({
        ...request.body,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now
      });
      const updated = [...items, item];
      await store.writeItems(updated);
      response.status(201).json(item);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/items/:id", async (request, response, next) => {
    try {
      const items = await store.readItems();
      const existing = items.find((item) => item.id === request.params.id);
      if (!existing) {
        response.status(404).json({ error: "Meal item not found" });
        return;
      }

      const updatedItem = normalizeMealItem({
        ...existing,
        ...request.body,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString()
      });
      const updated = items.map((item) => (item.id === updatedItem.id ? updatedItem : item));
      await store.writeItems(updated);
      response.json(updatedItem);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/items/:id", async (request, response, next) => {
    try {
      const items = await store.readItems();
      const updated = items.filter((item) => item.id !== request.params.id);
      await store.writeItems(updated);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/plans/generate", async (request, response, next) => {
    try {
      const input = request.body as GeneratePlanInput;
      if (!input.weekStart || ![1, 2].includes(input.eatingOutCount)) {
        response.status(400).json({ error: "weekStart and eatingOutCount are required" });
        return;
      }

      const [categories, items, plans] = await Promise.all([
        store.readCategories(),
        store.readItems(),
        store.readPlans()
      ]);
      const existingPlan = input.existingPlan ?? plans[input.weekStart];
      response.json(
        generatePlan(
          {
            weekStart: input.weekStart,
            eatingOutCount: input.eatingOutCount,
            existingPlan
          },
          { categories, items, priorPlans: plans }
        )
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/plans/:weekStart", async (request, response, next) => {
    try {
      const plans = await store.readPlans();
      const plan = plans[request.params.weekStart];
      if (!plan) {
        response.status(404).json({ error: "Plan not found" });
        return;
      }
      response.json(plan);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/plans/:weekStart", async (request, response, next) => {
    try {
      const plans = await store.readPlans();
      const now = new Date().toISOString();
      const plan = normalizePlan({
        ...request.body,
        weekStart: request.params.weekStart,
        updatedAt: now,
        createdAt: request.body.createdAt ?? plans[request.params.weekStart]?.createdAt ?? now
      });
      const updated = { ...plans, [request.params.weekStart]: plan };
      await store.writePlans(updated);
      response.json(plan);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/plans/:weekStart/groceries", async (request, response, next) => {
    try {
      const [plans, items] = await Promise.all([store.readPlans(), store.readItems()]);
      response.json(buildGroceryList(plans[request.params.weekStart], items));
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error(error);
    response.status(500).json({ error: "Unexpected server error" });
  });

  return app;
}

function normalizeCategories(value: unknown): Category[] {
  if (!Array.isArray(value)) throw new Error("Categories must be an array");
  return value.map((category, index) => ({
    id: String(category.id || slugify(category.name || `category-${index + 1}`)),
    name: String(category.name || "Untitled"),
    enabled: Boolean(category.enabled),
    sortOrder: Number.isFinite(Number(category.sortOrder)) ? Number(category.sortOrder) : index + 1
  }));
}

function normalizeMealItem(value: Partial<MealItem>): MealItem {
  if (!value.name || !value.categoryId) throw new Error("Meal item requires name and categoryId");

  return {
    id: String(value.id || randomUUID()),
    name: String(value.name),
    categoryId: String(value.categoryId),
    enabled: value.enabled ?? true,
    tags: Array.isArray(value.tags) ? value.tags.map(String).filter(Boolean) : [],
    effort: value.effort === "high" || value.effort === "medium" || value.effort === "low" ? value.effort : "medium",
    cooldownWeeks: Math.max(0, Number(value.cooldownWeeks) || 0),
    notes: value.notes ? String(value.notes) : "",
    ingredients: Array.isArray(value.ingredients) ? value.ingredients.map(normalizeIngredient) : [],
    createdAt: value.createdAt ?? new Date().toISOString(),
    updatedAt: value.updatedAt ?? new Date().toISOString()
  };
}

function normalizeIngredient(value: Partial<Ingredient>): Ingredient {
  return {
    id: String(value.id || randomUUID()),
    name: String(value.name || ""),
    quantity: Number(value.quantity) || 0,
    unit: String(value.unit || ""),
    groceryCategory: value.groceryCategory ? String(value.groceryCategory) : "",
    notes: value.notes ? String(value.notes) : ""
  };
}

function normalizePlan(value: Plan): Plan {
  return {
    weekStart: String(value.weekStart),
    eatingOutCount: value.eatingOutCount === 2 ? 2 : 1,
    days: Array.isArray(value.days)
      ? value.days.map((day) => ({
          date: String(day.date),
          isEatingOut: Boolean(day.isEatingOut),
          locked: Boolean(day.locked),
          selections: typeof day.selections === "object" && day.selections ? day.selections : {}
        }))
      : [],
    cookedBatches: Array.isArray(value.cookedBatches) ? value.cookedBatches.map(normalizeCookedBatch) : [],
    createdAt: value.createdAt ?? new Date().toISOString(),
    updatedAt: value.updatedAt ?? new Date().toISOString()
  };
}

function normalizeCookedBatch(value: Partial<CookedBatch>): CookedBatch {
  return {
    id: String(value.id || randomUUID()),
    itemId: String(value.itemId || ""),
    cookedOn: String(value.cookedOn || ""),
    eatenOnDates: Array.isArray(value.eatenOnDates) ? value.eatenOnDates.map(String).filter(Boolean) : [],
    notes: value.notes ? String(value.notes) : ""
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
