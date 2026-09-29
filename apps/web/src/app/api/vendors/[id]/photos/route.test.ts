// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "11111111-1111-4111-8111-111111111111";
const VENDOR = "22222222-2222-4222-8222-222222222222";
const PHOTO = "https://images.example.invalid/photo.jpg";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), lookup: vi.fn(), insert: vi.fn(), remove: vi.fn(), list: vi.fn(), eq: vi.fn(),
}));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimit: () => null, rateLimitKey: () => "test" }));
vi.mock("@/utils/log", () => ({ log: { error: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: async () => ({
  auth: { getUser: mocks.getUser },
  from: () => ({
    select: () => {
      const query = {
        eq: (...args: unknown[]) => { mocks.eq(...args); return query; },
        maybeSingle: mocks.lookup,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => mocks.list().then(resolve, reject),
      };
      return query;
    },
    insert: mocks.insert,
    delete: () => ({ eq: mocks.remove }),
  }),
}) }));

import { GET, POST } from "./route";

function context(id = VENDOR) { return { params: Promise.resolve({ id }) }; }
function request(photoUrl: string = PHOTO, origin = "https://hanbang.ai") {
  return new Request(`https://hanbang.ai/api/vendors/${VENDOR}/photos`, {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ photoUrl }),
  });
}
function getRequest() { return new Request(`https://hanbang.ai/api/vendors/${VENDOR}/photos`); }
const databaseError = { code: "42501", message: "private database diagnostic" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: OWNER } } });
  mocks.lookup.mockResolvedValue({ data: null, error: null });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.list.mockResolvedValue({ data: [{ photo_url: PHOTO }], error: null });
});

describe("vendor photo like persistence failures", () => {
  it("does not write when the current like cannot be read", async () => {
    mocks.lookup.mockResolvedValue({ data: null, error: databaseError });
    const response = await POST(request(), context());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(databaseError.message);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each(["insert", "delete"])("does not report success when %s fails", async operation => {
    if (operation === "delete") {
      mocks.lookup.mockResolvedValue({ data: { id: "like-id" }, error: null });
      mocks.remove.mockResolvedValue({ error: databaseError });
    } else mocks.insert.mockResolvedValue({ error: databaseError });
    const response = await POST(request(), context());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).not.toHaveProperty("liked");
    expect(JSON.stringify(body)).not.toContain(databaseError.message);
  });

  it.each(["database error", "transport exception"])("does not disguise a failed list as empty: %s", async failure => {
    if (failure === "transport exception") mocks.list.mockRejectedValue(new Error(databaseError.message));
    else mocks.list.mockResolvedValue({ data: null, error: databaseError });
    const response = await GET(getRequest(), context());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).not.toHaveProperty("likedPhotos");
    expect(JSON.stringify(body)).not.toContain(databaseError.message);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });

  it("preserves successful like and unlike responses", async () => {
    const liked = await POST(request(), context());
    expect(liked.status).toBe(200);
    expect(await liked.json()).toEqual({ liked: true });
    expect(mocks.insert).toHaveBeenCalledWith({ user_id: OWNER, vendor_id: VENDOR, photo_url: PHOTO });
    mocks.lookup.mockResolvedValue({ data: { id: "like-id" }, error: null });
    const unliked = await POST(request(), context());
    expect(unliked.status).toBe(200);
    expect(await unliked.json()).toEqual({ liked: false });
    expect(mocks.remove).toHaveBeenCalledWith("id", "like-id");
  });

  it("keeps successful private lists scoped to the authenticated owner and vendor", async () => {
    const response = await GET(getRequest(), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ likedPhotos: [PHOTO] });
    expect(mocks.eq).toHaveBeenCalledWith("user_id", OWNER);
    expect(mocks.eq).toHaveBeenCalledWith("vendor_id", VENDOR);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });

  it("preserves the anonymous read and authenticated mutation contract", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const read = await GET(getRequest(), context());
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ likedPhotos: [] });
    expect((await POST(request(), context())).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each(["http://images.example.invalid/photo.jpg", "https://user:secret@images.example.invalid/photo.jpg"])("rejects an unsafe photo URL: %s", async photo => {
    expect((await POST(request(photo), context())).status).toBe(400);
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it("rejects untrusted origins and malformed vendor IDs before reading likes", async () => {
    expect((await POST(request(PHOTO, "https://untrusted.example.invalid"), context())).status).toBe(403);
    expect((await POST(request(), context("invalid"))).status).toBe(400);
    expect((await GET(getRequest(), context("invalid"))).status).toBe(400);
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
