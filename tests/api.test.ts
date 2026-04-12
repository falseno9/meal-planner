import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import { JsonStore } from "../src/server/storage";
import { fixtureCategories } from "./fixtures";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "meal-planner-test-"));
  await writeFile(path.join(dataDir, "categories.json"), `${JSON.stringify(fixtureCategories, null, 2)}\n`);
  await writeFile(path.join(dataDir, "meal-items.json"), "[]\n");
  await writeFile(path.join(dataDir, "plans.json"), "{}\n");
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("meal planner API", () => {
  it("creates and updates items, generates and saves a plan, then returns groceries", async () => {
    const app = createApp(new JsonStore(dataDir));

    const created = await request(app)
      .post("/api/items")
      .send({
        name: "Cabbage Poriyal",
        categoryId: "veggie",
        effort: "low",
        cooldownWeeks: 1,
        tags: ["quick"],
        ingredients: [{ name: "Cabbage", quantity: 1, unit: "head", groceryCategory: "Produce" }]
      })
      .expect(201);

    await request(app)
      .put(`/api/items/${created.body.id}`)
      .send({ ...created.body, tags: ["quick", "weekday"] })
      .expect(200)
      .expect((response) => {
        expect(response.body.tags).toEqual(["quick", "weekday"]);
      });

    await request(app).post("/api/items").send({ name: "Dal", categoryId: "pulse" }).expect(201);
    await request(app).post("/api/items").send({ name: "Rice", categoryId: "rice" }).expect(201);

    const generated = await request(app)
      .post("/api/plans/generate")
      .send({ weekStart: "2026-04-13", eatingOutCount: 1 })
      .expect(200);

    await request(app).put("/api/plans/2026-04-13").send(generated.body).expect(200);

    await request(app)
      .get("/api/plans/2026-04-13/groceries")
      .expect(200)
      .expect((response) => {
        expect(response.body).toContainEqual(
          expect.objectContaining({ name: "Cabbage", quantity: expect.any(Number), unit: "head" })
        );
      });
  });
});
