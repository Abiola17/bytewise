import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { healthResponseSchema } from "@bytewise/shared";
import { createTestApp } from "./helpers";

describe("GET /api/v1/health", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeEach(async () => {
    ctx = await createTestApp();
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("reports server and database status", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/v1/health" });

    expect(res.statusCode).toBe(200);
    const body = healthResponseSchema.parse(res.json());
    expect(body.status).toBe("ok");
    expect(body.database).toBe("ok");
  });

  it("never includes API keys in the response", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/v1/health" });
    for (const key of [ctx.config.env.META_API_KEY, ctx.config.env.BASETEN_API_KEY]) {
      if (key) expect(res.body).not.toContain(key);
    }
  });

  it("returns the shared error format for unknown routes", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/v1/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: "not_found" } });
  });
});
