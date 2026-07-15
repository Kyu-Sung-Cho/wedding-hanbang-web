import { describe, expect, it } from "vitest";

const routes = [
  ["makeup POST", () => import("../seed-makeup/route"), "POST"],
  ["studios POST", () => import("../seed-studios/route"), "POST"],
  ["venues POST", () => import("../seed-venues/route"), "POST"],
  ["vendors POST", () => import("../seed-vendors/route"), "POST"],
  ["vendors PUT", () => import("../seed-vendors/route"), "PUT"],
] as const;

type SeedRouteHandler = (request: Request) => Response | Promise<Response>;

function getHandler(route: object, method: "POST" | "PUT"): SeedRouteHandler {
  const handler = (route as Partial<Record<"POST" | "PUT", SeedRouteHandler>>)[method];
  if (!handler) throw new Error(`missing ${method} seed route handler`);
  return handler;
}

describe("retired synthetic vendor seed routes", () => {
  it.each(routes)("keeps %s permanently unavailable before request processing", async (
    _name,
    loadRoute,
    method,
  ) => {
    const route = await loadRoute();
    const response = await getHandler(route, method)(
      new Request("https://hanbang.ai/api/admin/seed", {
        method,
        headers: {
          authorization: "Bearer must-not-be-read",
          "content-type": "application/json",
        },
        body: "not-json",
      }),
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "합성 업체 시드 경로는 종료되었습니다.",
      code: "synthetic_vendor_seed_retired",
    });
  });
});
