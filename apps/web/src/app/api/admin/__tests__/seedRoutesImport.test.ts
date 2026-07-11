import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const adminAuthMocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  seedGate: vi.fn(),
  getServiceClient: vi.fn(() => {
    throw new Error("service client must not be created before request gates pass");
  }),
}));

vi.mock("@/lib/utils/adminAuth", () => adminAuthMocks);

const routes = [
  ["makeup POST", () => import("../seed-makeup/route"), "POST"],
  ["studios POST", () => import("../seed-studios/route"), "POST"],
  ["venues POST", () => import("../seed-venues/route"), "POST"],
  ["vendors POST", () => import("../seed-vendors/route"), "POST"],
  ["vendors PUT", () => import("../seed-vendors/route"), "PUT"],
] as const;

type SeedRouteHandler = (request: Request) => Promise<Response>;

function getHandler(route: object, method: "POST" | "PUT"): SeedRouteHandler {
  const handler = (route as Partial<Record<"POST" | "PUT", SeedRouteHandler>>)[method];
  if (!handler) throw new Error(`missing ${method} seed route handler`);
  return handler;
}

describe("admin seed route service-client lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminAuthMocks.seedGate.mockReturnValue(null);
  });

  it.each(routes)("imports %s without constructing a service client", async (_name, loadRoute) => {
    await expect(loadRoute()).resolves.toBeDefined();
    expect(adminAuthMocks.getServiceClient).not.toHaveBeenCalled();
  });

  it.each(routes)("keeps %s service client behind authentication", async (_name, loadRoute, method) => {
    adminAuthMocks.verifyAdmin.mockResolvedValue({ authorized: false });
    const route = await loadRoute();

    const response = await getHandler(route, method)(new Request("https://hanbang.ai/api/admin/seed"));

    expect(response.status).toBe(401);
    expect(adminAuthMocks.seedGate).not.toHaveBeenCalled();
    expect(adminAuthMocks.getServiceClient).not.toHaveBeenCalled();
  });

  it.each(routes)("keeps %s service client behind the production seed gate", async (_name, loadRoute, method) => {
    adminAuthMocks.verifyAdmin.mockResolvedValue({ authorized: true });
    adminAuthMocks.seedGate.mockReturnValue(
      NextResponse.json({ error: "seed disabled" }, { status: 403 })
    );
    const route = await loadRoute();

    const response = await getHandler(route, method)(new Request("https://hanbang.ai/api/admin/seed"));

    expect(response.status).toBe(403);
    expect(adminAuthMocks.getServiceClient).not.toHaveBeenCalled();
  });
});
