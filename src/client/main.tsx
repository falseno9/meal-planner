import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Category, DayPlan, EffortLevel, GroceryLine, Ingredient, MealItem, Plan } from "../shared/types";
import "./styles.css";

type MealDraft = Omit<MealItem, "id" | "createdAt" | "updatedAt">;

const emptyDraft: MealDraft = {
  name: "",
  categoryId: "veggie",
  enabled: true,
  tags: [],
  effort: "medium",
  cooldownWeeks: 1,
  notes: "",
  ingredients: []
};

const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function App() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MealItem[]>([]);
  const [draft, setDraft] = useState<MealDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(getNextMonday());
  const [eatingOutCount, setEatingOutCount] = useState<1 | 2>(1);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [groceries, setGroceries] = useState<GroceryLine[]>([]);
  const [message, setMessage] = useState("Ready to plan.");
  const [loading, setLoading] = useState(false);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.sortOrder - b.sortOrder),
    [categories]
  );
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [categoryData, itemData] = await Promise.all([
        api<Category[]>("/api/categories"),
        api<MealItem[]>("/api/items")
      ]);
      setCategories(categoryData);
      setItems(itemData);
      setDraft((current) => ({
        ...current,
        categoryId: current.categoryId || categoryData[0]?.id || ""
      }));
      setMessage("Meal library loaded.");
    } catch {
      setMessage("Could not load local data. Is the API server running?");
    } finally {
      setLoading(false);
    }
  }

  async function saveCategories(nextCategories: Category[]) {
    const saved = await api<Category[]>("/api/categories", {
      method: "PUT",
      body: JSON.stringify(nextCategories)
    });
    setCategories(saved);
  }

  async function addCategory() {
    const name = window.prompt("New category name");
    if (!name?.trim()) return;
    const id = slugify(name);
    await saveCategories([
      ...sortedCategories,
      {
        id,
        name: name.trim(),
        enabled: true,
        sortOrder: sortedCategories.length + 1
      }
    ]);
  }

  async function updateCategory(categoryId: string, patch: Partial<Category>) {
    await saveCategories(categories.map((category) => (category.id === categoryId ? { ...category, ...patch } : category)));
  }

  async function submitMeal(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.categoryId) {
      setMessage("Name and category are required.");
      return;
    }

    const payload = {
      ...draft,
      name: draft.name.trim(),
      tags: draft.tags.map((tag) => tag.trim()).filter(Boolean),
      ingredients: draft.ingredients.filter((ingredient) => ingredient.name.trim())
    };
    const saved = editingId
      ? await api<MealItem>(`/api/items/${editingId}`, { method: "PUT", body: JSON.stringify(payload) })
      : await api<MealItem>("/api/items", { method: "POST", body: JSON.stringify(payload) });

    setItems(editingId ? items.map((item) => (item.id === saved.id ? saved : item)) : [...items, saved]);
    setDraft({ ...emptyDraft, categoryId: sortedCategories[0]?.id || "" });
    setEditingId(null);
    setMessage(editingId ? "Meal updated." : "Meal added.");
  }

  async function deleteMeal(itemId: string) {
    await api<void>(`/api/items/${itemId}`, { method: "DELETE" });
    setItems(items.filter((item) => item.id !== itemId));
    if (editingId === itemId) {
      setEditingId(null);
      setDraft({ ...emptyDraft, categoryId: sortedCategories[0]?.id || "" });
    }
    setMessage("Meal deleted.");
  }

  function editMeal(item: MealItem) {
    setEditingId(item.id);
    setDraft({
      name: item.name,
      categoryId: item.categoryId,
      enabled: item.enabled,
      tags: item.tags,
      effort: item.effort,
      cooldownWeeks: item.cooldownWeeks,
      notes: item.notes ?? "",
      ingredients: item.ingredients
    });
  }

  async function generate(regenerate = false) {
    const generated = await api<Plan>("/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        weekStart,
        eatingOutCount,
        existingPlan: regenerate ? plan : undefined
      })
    });
    setPlan(generated);
    setGroceries([]);
    setMessage(regenerate ? "Unlocked meals regenerated." : "Week generated.");
  }

  async function savePlan() {
    if (!plan) return;
    const saved = await api<Plan>(`/api/plans/${plan.weekStart}`, {
      method: "PUT",
      body: JSON.stringify(plan)
    });
    setPlan(saved);
    setGroceries(await api<GroceryLine[]>(`/api/plans/${saved.weekStart}/groceries`));
    setMessage("Plan saved and groceries refreshed.");
  }

  async function loadPlan() {
    try {
      const saved = await api<Plan>(`/api/plans/${weekStart}`);
      setPlan(saved);
      setEatingOutCount(saved.eatingOutCount);
      setGroceries(await api<GroceryLine[]>(`/api/plans/${weekStart}/groceries`));
      setMessage("Saved plan loaded.");
    } catch {
      setPlan(null);
      setGroceries([]);
      setMessage("No saved plan for that week yet.");
    }
  }

  function updateDay(date: string, patch: Partial<DayPlan>) {
    if (!plan) return;
    setPlan({
      ...plan,
      days: plan.days.map((day) => (day.date === date ? { ...day, ...patch } : day))
    });
  }

  function updateSelection(date: string, categoryId: string, itemId: string) {
    if (!plan) return;
    setPlan({
      ...plan,
      days: plan.days.map((day) =>
        day.date === date
          ? {
              ...day,
              isEatingOut: false,
              selections: { ...day.selections, [categoryId]: itemId || undefined }
            }
          : day
      )
    });
  }

  function addIngredient() {
    setDraft({
      ...draft,
      ingredients: [
        ...draft.ingredients,
        { id: crypto.randomUUID(), name: "", quantity: 1, unit: "", groceryCategory: "", notes: "" }
      ]
    });
  }

  function updateIngredient(ingredientId: string, patch: Partial<Ingredient>) {
    setDraft({
      ...draft,
      ingredients: draft.ingredients.map((ingredient) =>
        ingredient.id === ingredientId ? { ...ingredient, ...patch } : ingredient
      )
    });
  }

  function removeIngredient(ingredientId: string) {
    setDraft({
      ...draft,
      ingredients: draft.ingredients.filter((ingredient) => ingredient.id !== ingredientId)
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Dinner rhythm</p>
          <h1>Meal Planner</h1>
        </div>
        <p className="status" aria-live="polite">
          {loading ? "Loading..." : message}
        </p>
      </header>

      <section className="workspace">
        <div className="library-pane">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Database</p>
              <h2>Meal Library</h2>
            </div>
            <button type="button" onClick={addCategory}>
              Add Category
            </button>
          </div>

          <div className="category-strip">
            {sortedCategories.map((category) => (
              <label key={category.id} className="category-pill">
                <input
                  type="checkbox"
                  checked={category.enabled}
                  onChange={(event) => void updateCategory(category.id, { enabled: event.target.checked })}
                />
                <input
                  value={category.name}
                  onChange={(event) => void updateCategory(category.id, { name: event.target.value })}
                  aria-label={`${category.name} category name`}
                />
              </label>
            ))}
          </div>

          <form className="meal-form" onSubmit={submitMeal}>
            <div className="form-grid">
              <label>
                Name
                <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </label>
              <label>
                Category
                <select
                  value={draft.categoryId}
                  onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
                >
                  {sortedCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Effort
                <select
                  value={draft.effort}
                  onChange={(event) => setDraft({ ...draft, effort: event.target.value as EffortLevel })}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label>
                Cooldown Weeks
                <input
                  type="number"
                  min="0"
                  value={draft.cooldownWeeks}
                  onChange={(event) => setDraft({ ...draft, cooldownWeeks: Number(event.target.value) })}
                />
              </label>
              <label className="wide">
                Tags
                <input
                  value={draft.tags.join(", ")}
                  placeholder="quick, leafy, comfort"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      tags: event.target.value.split(",")
                    })
                  }
                />
              </label>
              <label className="wide">
                Notes
                <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                />
                Enabled for planning
              </label>
            </div>

            <div className="ingredients-header">
              <h3>Ingredients</h3>
              <button type="button" onClick={addIngredient}>
                Add Ingredient
              </button>
            </div>
            <div className="ingredient-list">
              {draft.ingredients.map((ingredient) => (
                <div key={ingredient.id} className="ingredient-row">
                  <input
                    value={ingredient.name}
                    placeholder="Ingredient"
                    onChange={(event) => updateIngredient(ingredient.id, { name: event.target.value })}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    value={ingredient.quantity}
                    placeholder="Qty"
                    onChange={(event) => updateIngredient(ingredient.id, { quantity: Number(event.target.value) })}
                  />
                  <input
                    value={ingredient.unit}
                    placeholder="Unit"
                    onChange={(event) => updateIngredient(ingredient.id, { unit: event.target.value })}
                  />
                  <input
                    value={ingredient.groceryCategory ?? ""}
                    placeholder="Aisle"
                    onChange={(event) => updateIngredient(ingredient.id, { groceryCategory: event.target.value })}
                  />
                  <button type="button" className="ghost" onClick={() => removeIngredient(ingredient.id)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div className="form-actions">
              <button type="submit">{editingId ? "Update Meal" : "Add Meal"}</button>
              {editingId && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setEditingId(null);
                    setDraft({ ...emptyDraft, categoryId: sortedCategories[0]?.id || "" });
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          <div className="meal-list">
            {items.map((item) => (
              <article key={item.id} className="meal-card">
                <div>
                  <h3>{item.name}</h3>
                  <p>
                    {categoryName(item.categoryId, categories)} · {item.effort} effort · cooldown {item.cooldownWeeks}
                  </p>
                  <p>{item.tags.length ? item.tags.join(", ") : "No tags yet"}</p>
                </div>
                <div className="card-actions">
                  <button type="button" className="secondary" onClick={() => editMeal(item)}>
                    Edit
                  </button>
                  <button type="button" className="ghost" onClick={() => void deleteMeal(item.id)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="planner-pane">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Week</p>
              <h2>Planner</h2>
            </div>
          </div>

          <div className="planner-controls">
            <label>
              Week Start
              <input type="date" value={weekStart} onChange={(event) => setWeekStart(event.target.value)} />
            </label>
            <label>
              Eating Out
              <select
                value={eatingOutCount}
                onChange={(event) => setEatingOutCount(Number(event.target.value) as 1 | 2)}
              >
                <option value={1}>1 slot</option>
                <option value={2}>2 slots</option>
              </select>
            </label>
            <button type="button" onClick={() => void generate(false)}>
              Generate
            </button>
            <button type="button" className="secondary" onClick={() => void loadPlan()}>
              Load Saved
            </button>
            <button type="button" className="secondary" disabled={!plan} onClick={() => void generate(true)}>
              Regenerate Unlocked
            </button>
            <button type="button" disabled={!plan} onClick={() => void savePlan()}>
              Save
            </button>
          </div>

          <div className="week-grid">
            {plan?.days.map((day, index) => (
              <article key={day.date} className="day-card">
                <div className="day-title">
                  <div>
                    <h3>{dayNames[index]}</h3>
                    <p>{day.date}</p>
                  </div>
                  <label className="lock-toggle">
                    <input
                      type="checkbox"
                      checked={day.locked}
                      onChange={(event) => updateDay(day.date, { locked: event.target.checked })}
                    />
                    Lock
                  </label>
                </div>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={day.isEatingOut}
                    onChange={(event) =>
                      updateDay(day.date, {
                        isEatingOut: event.target.checked,
                        selections: event.target.checked ? {} : day.selections
                      })
                    }
                  />
                  Eating out
                </label>
                {!day.isEatingOut && (
                  <div className="day-selections">
                    {sortedCategories
                      .filter((category) => category.enabled)
                      .map((category) => (
                        <label key={category.id}>
                          {category.name}
                          <select
                            value={day.selections[category.id] ?? ""}
                            onChange={(event) => updateSelection(day.date, category.id, event.target.value)}
                          >
                            <option value="">No item</option>
                            {items
                              .filter((item) => item.enabled && item.categoryId === category.id)
                              .map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      ))}
                  </div>
                )}
              </article>
            )) ?? <p className="empty-state">Add a few meals, then generate your week.</p>}
          </div>

          <div className="grocery-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Shopping</p>
                <h2>Grocery List</h2>
              </div>
            </div>
            {groceries.length === 0 ? (
              <p className="empty-state">Save a plan to aggregate ingredients.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>From</th>
                  </tr>
                </thead>
                <tbody>
                  {groceries.map((line) => (
                    <tr key={line.key}>
                      <td>
                        {line.name}
                        {line.groceryCategory ? <span>{line.groceryCategory}</span> : null}
                      </td>
                      <td>
                        {formatQuantity(line.quantity)} {line.unit}
                      </td>
                      <td>{line.sources.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    },
    ...options
  });

  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function getNextMonday(): string {
  const date = new Date();
  const day = date.getDay();
  const offset = day === 0 ? 1 : 8 - day;
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function categoryName(categoryId: string, categories: Category[]): string {
  return categories.find((category) => category.id === categoryId)?.name ?? categoryId;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
