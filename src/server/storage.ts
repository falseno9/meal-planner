import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Category, MealItem, PlanStore } from "../shared/types";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultDataDir = path.join(rootDir, "data");

export class JsonStore {
  private readonly dataDir: string;

  constructor(dataDir = process.env.MEAL_PLANNER_DATA_DIR ?? defaultDataDir) {
    this.dataDir = dataDir;
  }

  async readCategories(): Promise<Category[]> {
    return this.readJson<Category[]>("categories.json", []);
  }

  async writeCategories(categories: Category[]): Promise<void> {
    await this.writeJson("categories.json", categories);
  }

  async readItems(): Promise<MealItem[]> {
    return this.readJson<MealItem[]>("meal-items.json", []);
  }

  async writeItems(items: MealItem[]): Promise<void> {
    await this.writeJson("meal-items.json", items);
  }

  async readPlans(): Promise<PlanStore> {
    return this.readJson<PlanStore>("plans.json", {});
  }

  async writePlans(plans: PlanStore): Promise<void> {
    await this.writeJson("plans.json", plans);
  }

  private async readJson<T>(fileName: string, fallback: T): Promise<T> {
    try {
      const content = await readFile(path.join(this.dataDir, fileName), "utf8");
      return JSON.parse(content) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await this.writeJson(fileName, fallback);
        return fallback;
      }
      throw error;
    }
  }

  private async writeJson(fileName: string, value: unknown): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(path.join(this.dataDir, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
}
