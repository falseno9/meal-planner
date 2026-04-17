import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  Category,
  CookedBatch,
  DayPlan,
  EffortLevel,
  GroceryLine,
  Ingredient,
  MealItem,
  Plan
} from "../shared/types";
import "./styles.css";

type MealDraft = Omit<MealItem, "id" | "createdAt" | "updatedAt">;
type ActiveView = "planner" | "library";

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
  const [activeView, setActiveView] = useState<ActiveView>("planner");
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MealItem[]>([]);
  const [draft, setDraft] = useState<MealDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(getNextMonday());
  const [monthAnchor, setMonthAnchor] = useState(getMonthStart(getNextMonday()));
  const [eatingOutCount, setEatingOutCount] = useState<1 | 2>(1);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [groceries, setGroceries] = useState<GroceryLine[]>([]);
  const [message, setMessage] = useState("Ready to plan.");
  const [loading, setLoading] = useState(false);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.sortOrder - b.sortOrder),
    [categories]
  );
  const activeCategories = useMemo(() => sortedCategories.filter((category) => category.enabled), [sortedCategories]);
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const monthDays = useMemo(() => buildMonthCells(monthAnchor), [monthAnchor]);
  const itemOptions = useMemo(
    () => [...items].filter((item) => item.enabled).sort((a, b) => a.name.localeCompare(b.name)),
    [items]
  );

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
    const id = uniqueSlug(name, categories.map((category) => category.id));
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
    removeCookedBatchesForItem(itemId);
    if (editingId === itemId) {
      setEditingId(null);
      setDraft({ ...emptyDraft, categoryId: sortedCategories[0]?.id || "" });
    }
    setMessage("Meal deleted.");
  }

  function editMeal(item: MealItem) {
    setActiveView("library");
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
    await loadPlanFor(weekStart);
  }

  async function loadPlanFor(nextWeekStart: string) {
    try {
      const saved = await api<Plan>(`/api/plans/${nextWeekStart}`);
      setPlan(saved);
      setEatingOutCount(saved.eatingOutCount);
      setGroceries(await api<GroceryLine[]>(`/api/plans/${nextWeekStart}/groceries`));
      setMessage("Saved plan loaded.");
    } catch {
      setPlan(null);
      setGroceries([]);
      setMessage("No saved plan for that week yet.");
    }
  }

  function chooseWeek(nextWeekStart: string) {
    setWeekStart(nextWeekStart);
    setMonthAnchor(getMonthStart(nextWeekStart));
    void loadPlanFor(nextWeekStart);
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

  function addCookedBatch(day: DayPlan) {
    if (!plan) return;
    const firstSelection = Object.values(day.selections).find(Boolean);
    if (!firstSelection) {
      setMessage("Choose at least one dinner item before logging cooked food.");
      return;
    }

    const batch: CookedBatch = {
      id: crypto.randomUUID(),
      itemId: firstSelection,
      cookedOn: day.date,
      eatenOnDates: [day.date],
      notes: ""
    };

    setPlan({
      ...plan,
      cookedBatches: [...(plan.cookedBatches ?? []), batch]
    });
    setMessage("Cooked item logged. Add leftover days if it covers more dinners.");
  }

  function updateCookedBatch(batchId: string, patch: Partial<CookedBatch>) {
    if (!plan) return;
    setPlan({
      ...plan,
      cookedBatches: (plan.cookedBatches ?? []).map((batch) => (batch.id === batchId ? { ...batch, ...patch } : batch))
    });
  }

  function removeCookedBatch(batchId: string) {
    if (!plan) return;
    setPlan({
      ...plan,
      cookedBatches: (plan.cookedBatches ?? []).filter((batch) => batch.id !== batchId)
    });
  }

  function removeCookedBatchesForItem(itemId: string) {
    if (!plan) return;
    setPlan({
      ...plan,
      cookedBatches: (plan.cookedBatches ?? []).filter((batch) => batch.itemId !== itemId)
    });
  }

  function toggleBatchDinner(batch: CookedBatch, date: string) {
    const nextDates = batch.eatenOnDates.includes(date)
      ? batch.eatenOnDates.filter((value) => value !== date)
      : [...batch.eatenOnDates, date].sort();
    updateCookedBatch(batch.id, { eatenOnDates: nextDates });
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
        <div className="topbar-actions">
          <nav className="view-tabs" aria-label="Meal planner sections">
            <button
              type="button"
              className={activeView === "planner" ? "tab-active" : "secondary"}
              onClick={() => setActiveView("planner")}
            >
              Planner
            </button>
            <button
              type="button"
              className={activeView === "library" ? "tab-active" : "secondary"}
              onClick={() => setActiveView("library")}
            >
              Meal Library
            </button>
          </nav>
          <p className="status" aria-live="polite">
            {loading ? "Loading..." : message}
          </p>
        </div>
      </header>

      {activeView === "planner" ? (
        <PlannerView
          activeCategories={activeCategories}
          eatingOutCount={eatingOutCount}
          groceries={groceries}
          itemOptions={itemOptions}
          items={items}
          itemsById={itemsById}
          monthAnchor={monthAnchor}
          monthDays={monthDays}
          plan={plan}
          weekStart={weekStart}
          onAddCookedBatch={addCookedBatch}
          onChooseWeek={chooseWeek}
          onGenerate={generate}
          onLoadPlan={loadPlan}
          onMonthChange={setMonthAnchor}
          onRemoveCookedBatch={removeCookedBatch}
          onSavePlan={savePlan}
          onToggleBatchDinner={toggleBatchDinner}
          onUpdateBatch={updateCookedBatch}
          onUpdateDay={updateDay}
          onUpdateEatingOutCount={setEatingOutCount}
          onUpdateSelection={updateSelection}
          onUpdateWeekStart={(nextWeekStart) => {
            setWeekStart(nextWeekStart);
            setMonthAnchor(getMonthStart(nextWeekStart));
          }}
        />
      ) : (
        <LibraryView
          categories={sortedCategories}
          draft={draft}
          editingId={editingId}
          items={items}
          onAddCategory={addCategory}
          onAddIngredient={addIngredient}
          onCancelEdit={() => {
            setEditingId(null);
            setDraft({ ...emptyDraft, categoryId: sortedCategories[0]?.id || "" });
          }}
          onDeleteMeal={deleteMeal}
          onEditMeal={editMeal}
          onRemoveIngredient={removeIngredient}
          onSubmitMeal={submitMeal}
          onUpdateCategory={updateCategory}
          onUpdateDraft={setDraft}
          onUpdateIngredient={updateIngredient}
        />
      )}
    </main>
  );
}

interface PlannerViewProps {
  activeCategories: Category[];
  eatingOutCount: 1 | 2;
  groceries: GroceryLine[];
  itemOptions: MealItem[];
  items: MealItem[];
  itemsById: Map<string, MealItem>;
  monthAnchor: string;
  monthDays: string[];
  plan: Plan | null;
  weekStart: string;
  onAddCookedBatch: (day: DayPlan) => void;
  onChooseWeek: (weekStart: string) => void;
  onGenerate: (regenerate?: boolean) => Promise<void>;
  onLoadPlan: () => Promise<void>;
  onMonthChange: (monthStart: string) => void;
  onRemoveCookedBatch: (batchId: string) => void;
  onSavePlan: () => Promise<void>;
  onToggleBatchDinner: (batch: CookedBatch, date: string) => void;
  onUpdateBatch: (batchId: string, patch: Partial<CookedBatch>) => void;
  onUpdateDay: (date: string, patch: Partial<DayPlan>) => void;
  onUpdateEatingOutCount: (count: 1 | 2) => void;
  onUpdateSelection: (date: string, categoryId: string, itemId: string) => void;
  onUpdateWeekStart: (weekStart: string) => void;
}

function PlannerView(props: PlannerViewProps) {
  const currentMonth = props.monthAnchor.slice(0, 7);
  const weekDates = props.plan?.days.map((day) => day.date) ?? buildWeekDates(props.weekStart);
  const selectedWeek = new Set(buildWeekDates(props.weekStart));

  return (
    <section className="planner-layout">
      <aside className="month-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Month</p>
            <h2>{formatMonth(props.monthAnchor)}</h2>
          </div>
          <div className="compact-actions">
            <button type="button" className="secondary" onClick={() => props.onMonthChange(addMonths(props.monthAnchor, -1))}>
              Prev
            </button>
            <button type="button" className="secondary" onClick={() => props.onMonthChange(addMonths(props.monthAnchor, 1))}>
              Next
            </button>
          </div>
        </div>

        <div className="month-grid" aria-label="Month calendar">
          {dayNames.map((day) => (
            <div key={day} className="month-weekday">
              {day}
            </div>
          ))}
          {props.monthDays.map((date) => {
            const isCurrentMonth = date.startsWith(currentMonth);
            const isSelected = selectedWeek.has(date);
            return (
              <button
                type="button"
                key={date}
                className={`month-day ${isCurrentMonth ? "" : "muted-day"} ${isSelected ? "selected-day" : ""}`}
                onClick={() => props.onChooseWeek(startOfWeekMonday(date))}
              >
                <span>{Number(date.slice(-2))}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="planner-main">
        <div className="planner-controls">
          <label>
            Week Start
            <input type="date" value={props.weekStart} onChange={(event) => props.onUpdateWeekStart(event.target.value)} />
          </label>
          <label>
            Eating Out
            <select
              value={props.eatingOutCount}
              onChange={(event) => props.onUpdateEatingOutCount(Number(event.target.value) as 1 | 2)}
            >
              <option value={1}>1 slot</option>
              <option value={2}>2 slots</option>
            </select>
          </label>
          <button type="button" onClick={() => void props.onGenerate(false)}>
            Generate
          </button>
          <button type="button" className="secondary" onClick={() => void props.onLoadPlan()}>
            Load Saved
          </button>
          <button type="button" className="secondary" disabled={!props.plan} onClick={() => void props.onGenerate(true)}>
            Regenerate Unlocked
          </button>
          <button type="button" disabled={!props.plan} onClick={() => void props.onSavePlan()}>
            Save
          </button>
        </div>

        <div className="week-strip">
          {props.plan?.days.map((day, index) => (
            <DayCard
              key={day.date}
              activeCategories={props.activeCategories}
              batches={props.plan?.cookedBatches ?? []}
              day={day}
              dayName={dayNames[index]}
              itemOptions={props.itemOptions}
              items={props.items}
              itemsById={props.itemsById}
              onAddCookedBatch={props.onAddCookedBatch}
              onUpdateDay={props.onUpdateDay}
              onUpdateSelection={props.onUpdateSelection}
            />
          )) ?? weekDates.map((date, index) => <EmptyDay key={date} date={date} dayName={dayNames[index]} />)}
        </div>

        {props.plan && (
          <CookedBatchPanel
            batches={props.plan.cookedBatches ?? []}
            itemsById={props.itemsById}
            itemOptions={props.itemOptions}
            weekDates={props.plan.days.map((day) => day.date)}
            onRemove={props.onRemoveCookedBatch}
            onToggleDinner={props.onToggleBatchDinner}
            onUpdate={props.onUpdateBatch}
          />
        )}

        <GroceryPanel groceries={props.groceries} />
      </section>
    </section>
  );
}

interface DayCardProps {
  activeCategories: Category[];
  batches: CookedBatch[];
  day: DayPlan;
  dayName: string;
  itemOptions: MealItem[];
  items: MealItem[];
  itemsById: Map<string, MealItem>;
  onAddCookedBatch: (day: DayPlan) => void;
  onUpdateDay: (date: string, patch: Partial<DayPlan>) => void;
  onUpdateSelection: (date: string, categoryId: string, itemId: string) => void;
}

function DayCard(props: DayCardProps) {
  const cookedHere = props.batches.filter((batch) => batch.cookedOn === props.day.date);
  const eatenHere = props.batches.filter((batch) => batch.eatenOnDates.includes(props.day.date));

  return (
    <article className="day-card">
      <div className="day-title">
        <div>
          <h3>{props.dayName}</h3>
          <p>{props.day.date}</p>
        </div>
        <label className="lock-toggle">
          <input
            type="checkbox"
            checked={props.day.locked}
            onChange={(event) => props.onUpdateDay(props.day.date, { locked: event.target.checked })}
          />
          Lock
        </label>
      </div>

      <label className="check-row">
        <input
          type="checkbox"
          checked={props.day.isEatingOut}
          onChange={(event) =>
            props.onUpdateDay(props.day.date, {
              isEatingOut: event.target.checked,
              selections: event.target.checked ? {} : props.day.selections
            })
          }
        />
        Eating out
      </label>

      {!props.day.isEatingOut && (
        <div className="day-selections">
          {props.activeCategories.map((category) => (
            <label key={category.id}>
              {category.name}
              <select
                value={props.day.selections[category.id] ?? ""}
                onChange={(event) => props.onUpdateSelection(props.day.date, category.id, event.target.value)}
              >
                <option value="">No item</option>
                {props.items
                  .filter((item) => item.enabled && item.categoryId === category.id)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          <button type="button" className="secondary" onClick={() => props.onAddCookedBatch(props.day)}>
            Mark Cooked
          </button>
        </div>
      )}

      {(cookedHere.length > 0 || eatenHere.length > 0) && (
        <div className="day-badges">
          {cookedHere.map((batch) => (
            <span key={`cooked-${batch.id}`}>Cooked: {props.itemsById.get(batch.itemId)?.name ?? "Unknown"}</span>
          ))}
          {eatenHere
            .filter((batch) => batch.cookedOn !== props.day.date)
            .map((batch) => (
              <span key={`leftover-${batch.id}`}>Leftover: {props.itemsById.get(batch.itemId)?.name ?? "Unknown"}</span>
            ))}
        </div>
      )}
    </article>
  );
}

function EmptyDay({ date, dayName }: { date: string; dayName: string }) {
  return (
    <article className="day-card empty-day">
      <div className="day-title">
        <div>
          <h3>{dayName}</h3>
          <p>{date}</p>
        </div>
      </div>
      <p>Add a saved plan or generate this week.</p>
    </article>
  );
}

interface CookedBatchPanelProps {
  batches: CookedBatch[];
  itemsById: Map<string, MealItem>;
  itemOptions: MealItem[];
  weekDates: string[];
  onRemove: (batchId: string) => void;
  onToggleDinner: (batch: CookedBatch, date: string) => void;
  onUpdate: (batchId: string, patch: Partial<CookedBatch>) => void;
}

function CookedBatchPanel(props: CookedBatchPanelProps) {
  return (
    <section className="cooked-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Cooked</p>
          <h2>Made Once, Eaten Later</h2>
        </div>
      </div>

      {props.batches.length === 0 ? (
        <p className="empty-state">Use Mark Cooked on a dinner day to track leftovers.</p>
      ) : (
        <div className="batch-list">
          {props.batches.map((batch) => (
            <article key={batch.id} className="batch-row">
              <label>
                Item
                <select value={batch.itemId} onChange={(event) => props.onUpdate(batch.id, { itemId: event.target.value })}>
                  {props.itemOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cooked On
                <input
                  type="date"
                  value={batch.cookedOn}
                  onChange={(event) => props.onUpdate(batch.id, { cookedOn: event.target.value })}
                />
              </label>
              <div className="leftover-days">
                <p>{props.itemsById.get(batch.itemId)?.name ?? "Unknown item"} was eaten on</p>
                <div>
                  {props.weekDates.map((date, index) => (
                    <label key={date} className="mini-check">
                      <input
                        type="checkbox"
                        checked={batch.eatenOnDates.includes(date)}
                        onChange={() => props.onToggleDinner(batch, date)}
                      />
                      {dayNames[index]}
                    </label>
                  ))}
                </div>
              </div>
              <button type="button" className="ghost" onClick={() => props.onRemove(batch.id)}>
                Remove
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function GroceryPanel({ groceries }: { groceries: GroceryLine[] }) {
  return (
    <section className="grocery-panel">
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
    </section>
  );
}

interface LibraryViewProps {
  categories: Category[];
  draft: MealDraft;
  editingId: string | null;
  items: MealItem[];
  onAddCategory: () => void;
  onAddIngredient: () => void;
  onCancelEdit: () => void;
  onDeleteMeal: (itemId: string) => Promise<void>;
  onEditMeal: (item: MealItem) => void;
  onRemoveIngredient: (ingredientId: string) => void;
  onSubmitMeal: (event: React.FormEvent) => Promise<void>;
  onUpdateCategory: (categoryId: string, patch: Partial<Category>) => Promise<void>;
  onUpdateDraft: (draft: MealDraft) => void;
  onUpdateIngredient: (ingredientId: string, patch: Partial<Ingredient>) => void;
}

function LibraryView(props: LibraryViewProps) {
  return (
    <section className="library-layout">
      <div className="library-tools">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Database</p>
            <h2>Meal Library</h2>
          </div>
          <button type="button" onClick={props.onAddCategory}>
            Add Category
          </button>
        </div>

        <div className="category-strip">
          {props.categories.map((category) => (
            <label key={category.id} className="category-pill">
              <input
                type="checkbox"
                checked={category.enabled}
                onChange={(event) => void props.onUpdateCategory(category.id, { enabled: event.target.checked })}
              />
              <input
                value={category.name}
                onChange={(event) => void props.onUpdateCategory(category.id, { name: event.target.value })}
                aria-label={`${category.name} category name`}
              />
            </label>
          ))}
        </div>

        <MealForm {...props} />
      </div>

      <div className="meal-list">
        {props.items.map((item) => (
          <article key={item.id} className="meal-card">
            <div>
              <h3>{item.name}</h3>
              <p>
                {categoryName(item.categoryId, props.categories)} · {item.effort} effort · cooldown {item.cooldownWeeks}
              </p>
              <p>{item.tags.length ? item.tags.join(", ") : "No tags yet"}</p>
            </div>
            <div className="card-actions">
              <button type="button" className="secondary" onClick={() => props.onEditMeal(item)}>
                Edit
              </button>
              <button type="button" className="ghost" onClick={() => void props.onDeleteMeal(item.id)}>
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MealForm(props: LibraryViewProps) {
  const draft = props.draft;

  return (
    <form className="meal-form" onSubmit={props.onSubmitMeal}>
      <div className="form-grid">
        <label>
          Name
          <input value={draft.name} onChange={(event) => props.onUpdateDraft({ ...draft, name: event.target.value })} />
        </label>
        <label>
          Category
          <select
            value={draft.categoryId}
            onChange={(event) => props.onUpdateDraft({ ...draft, categoryId: event.target.value })}
          >
            {props.categories.map((category) => (
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
            onChange={(event) => props.onUpdateDraft({ ...draft, effort: event.target.value as EffortLevel })}
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
            onChange={(event) => props.onUpdateDraft({ ...draft, cooldownWeeks: Number(event.target.value) })}
          />
        </label>
        <label className="wide">
          Tags
          <input
            value={draft.tags.join(", ")}
            placeholder="quick, leafy, comfort"
            onChange={(event) => props.onUpdateDraft({ ...draft, tags: event.target.value.split(",") })}
          />
        </label>
        <label className="wide">
          Notes
          <textarea value={draft.notes} onChange={(event) => props.onUpdateDraft({ ...draft, notes: event.target.value })} />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => props.onUpdateDraft({ ...draft, enabled: event.target.checked })}
          />
          Enabled for planning
        </label>
      </div>

      <div className="ingredients-header">
        <h3>Ingredients</h3>
        <button type="button" onClick={props.onAddIngredient}>
          Add Ingredient
        </button>
      </div>
      <div className="ingredient-list">
        {draft.ingredients.map((ingredient) => (
          <div key={ingredient.id} className="ingredient-row">
            <input
              value={ingredient.name}
              placeholder="Ingredient"
              onChange={(event) => props.onUpdateIngredient(ingredient.id, { name: event.target.value })}
            />
            <input
              type="number"
              min="0"
              step="0.25"
              value={ingredient.quantity}
              placeholder="Qty"
              onChange={(event) => props.onUpdateIngredient(ingredient.id, { quantity: Number(event.target.value) })}
            />
            <input
              value={ingredient.unit}
              placeholder="Unit"
              onChange={(event) => props.onUpdateIngredient(ingredient.id, { unit: event.target.value })}
            />
            <input
              value={ingredient.groceryCategory ?? ""}
              placeholder="Aisle"
              onChange={(event) => props.onUpdateIngredient(ingredient.id, { groceryCategory: event.target.value })}
            />
            <button type="button" className="ghost" onClick={() => props.onRemoveIngredient(ingredient.id)}>
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="form-actions">
        <button type="submit">{props.editingId ? "Update Meal" : "Add Meal"}</button>
        {props.editingId && (
          <button type="button" className="secondary" onClick={props.onCancelEdit}>
            Cancel
          </button>
        )}
      </div>
    </form>
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
  return toIso(date);
}

function buildWeekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

function buildMonthCells(monthStart: string): string[] {
  const firstCell = startOfWeekMonday(monthStart);
  return Array.from({ length: 42 }, (_, index) => addDays(firstCell, index));
}

function startOfWeekMonday(dateIso: string): string {
  const date = fromIso(dateIso);
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(dateIso, offset);
}

function getMonthStart(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`;
}

function addDays(dateIso: string, amount: number): string {
  const date = fromIso(dateIso);
  date.setUTCDate(date.getUTCDate() + amount);
  return toIso(date);
}

function addMonths(monthStart: string, amount: number): string {
  const date = fromIso(monthStart);
  date.setUTCMonth(date.getUTCMonth() + amount);
  date.setUTCDate(1);
  return toIso(date);
}

function fromIso(dateIso: string): Date {
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatMonth(monthStart: string): string {
  return fromIso(monthStart).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}

function categoryName(categoryId: string, categories: Category[]): string {
  return categories.find((category) => category.id === categoryId)?.name ?? categoryId;
}

function uniqueSlug(value: string, existing: string[]): string {
  const base = slugify(value) || "category";
  let next = base;
  let index = 2;
  while (existing.includes(next)) {
    next = `${base}-${index}`;
    index += 1;
  }
  return next;
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
