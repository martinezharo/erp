import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    CONVEX_BRIDGE_SECRET: v.string(),
  },
});

export default app;
