import { beforeEach, describe, expect, it, vi } from "vitest";

const adminAuthMock = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  seedGate: vi.fn(),
  getServiceClient: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => adminAuthMock);

type SeedHandler = (request: Request) => Promise<Response>;

const routeCases: Array<{ name: string; load: () => Promise<SeedHandler> }> = [
  {
    name: "seed-vendors POST",
    load: async () => (await import("../seed-vendors/route")).POST,
  },
  {
    name: "seed-vendors PUT",
    load: async () => (await import("../seed-vendors/route")).PUT,
  },
  {
    name: "seed-venues POST",
    load: async () => (await import("../seed-venues/route")).POST,
  },
  {
    name: "seed-studios POST",
    load: async () => (await import("../seed-studios/route")).POST,
  },
  {
    name: "seed-makeup POST",
    load: async () => (await import("../seed-makeup/route")).POST,
  },
];

async function loadAllHandlers() {
  const [vendors, venues, studios, makeup] = await Promise.all([
    import("../seed-vendors/route"),
    import("../seed-venues/route"),
    import("../seed-studios/route"),
    import("../seed-makeup/route"),
  ]);

  return [vendors.POST, vendors.PUT, venues.POST, studios.POST, makeup.POST];
}

describe("admin seed route Supabase client lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    adminAuthMock.getServiceClient.mockImplementation(() => {
      throw new Error("Supabase client must not be created before request gates pass");
    });
  });

  it("imports every seed route without creating a service client", async () => {
    await expect(loadAllHandlers()).resolves.toHaveLength(5);
    expect(adminAuthMock.getServiceClient).not.toHaveBeenCalled();
  });

  it("does not create a service client for unauthorized requests", async () => {
    adminAuthMock.verifyAdmin.mockResolvedValue({ authorized: false });
    const handlers = await loadAllHandlers();

    const responses = await Promise.all(
      handlers.map((handler) => handler(new Request("https://example.test/api/admin/seed")))
    );

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);
    expect(adminAuthMock.seedGate).not.toHaveBeenCalled();
    expect(adminAuthMock.getServiceClient).not.toHaveBeenCalled();
  });

  it("does not create a service client when the production seed gate is closed", async () => {
    adminAuthMock.verifyAdmin.mockResolvedValue({ authorized: true });
    adminAuthMock.seedGate.mockImplementation(
      () => new Response(null, { status: 403 })
    );
    const handlers = await loadAllHandlers();

    const responses = await Promise.all(
      handlers.map((handler) => handler(new Request("https://example.test/api/admin/seed")))
    );

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403]);
    expect(adminAuthMock.seedGate).toHaveBeenCalledTimes(5);
    expect(adminAuthMock.getServiceClient).not.toHaveBeenCalled();
  });

  it.each(routeCases)("creates the client only after auth and seed gates: $name", async ({ load }) => {
    const events: string[] = [];
    adminAuthMock.verifyAdmin.mockImplementation(async () => {
      events.push("verifyAdmin");
      return { authorized: true };
    });
    adminAuthMock.seedGate.mockImplementation(() => {
      events.push("seedGate");
      return null;
    });
    adminAuthMock.getServiceClient.mockImplementation(() => {
      events.push("getServiceClient");
      throw new Error("stop after client creation");
    });
    const handler = await load();

    await expect(
      handler(new Request("https://example.test/api/admin/seed"))
    ).rejects.toThrow("stop after client creation");
    expect(events).toEqual(["verifyAdmin", "seedGate", "getServiceClient"]);
  });
});
