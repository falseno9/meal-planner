import { createApp } from "./app";

const port = Number(process.env.PORT ?? 3001);

createApp().listen(port, () => {
  console.log(`Meal planner API running on http://localhost:${port}`);
});
