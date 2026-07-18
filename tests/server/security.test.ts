import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  csrfToken,
  protectMutation,
} from "../../src/server/security.ts";

function createTestApp() {
  const app = Fastify();
  app.addHook("preHandler", protectMutation);
  app.get("/read", async () => ({ ok: true }));
  app.post("/write", async () => ({ ok: true }));
  return app;
}

describe("local API mutation protection", () => {
  it("allows read-only requests without a CSRF token", async () => {
    const app = createTestApp();
    const response = await app.inject({ method: "GET", url: "/read" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });

  it("rejects mutations without the per-process CSRF token", async () => {
    const app = createTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/write",
      headers: { origin: "http://127.0.0.1:4317" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "csrf_token_invalid" });
    await app.close();
  });

  it("rejects a valid token sent from a non-local browser origin", async () => {
    const app = createTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/write",
      headers: {
        origin: "https://attacker.example",
        "x-devtax-csrf": csrfToken,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "origin_not_allowed" });
    await app.close();
  });

  it.each([
    "http://127.0.0.1:4317",
    "http://localhost:4317",
  ])("allows a valid token from local origin %s", async (origin) => {
    const app = createTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/write",
      headers: {
        origin,
        "x-devtax-csrf": csrfToken,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });
});
