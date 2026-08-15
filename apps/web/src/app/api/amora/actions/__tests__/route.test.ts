import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  createAdminClient: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: mocks.user } })),
    },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/amora/actionRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/amora/actionRepository")>();
  return {
    ...actual,
    insertAmoraActionRecord: mocks.insert,
    updateAmoraActionRecord: mocks.update,
  };
});

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

import { POST } from "../route";
import { PATCH } from "../[id]/route";

const ACTION_ID = "act_deadline_truth";

function jsonRequest(url: string, method: "POST" | "PATCH", body: unknown) {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

describe("Amora action deadline truth boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { id: "11111111-1111-4111-8111-111111111111" };
  });

  it("rejects an impossible create deadline before resolving a couple or writing", async () => {
    const response = await POST(jsonRequest(
      "http://localhost/api/amora/actions",
      "POST",
      { title: "양가에 가능한 날짜 물어보기", due_date: "2026-02-31" },
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("YYYY-MM-DD"),
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects an impossible update deadline before resolving a couple or writing", async () => {
    const response = await PATCH(
      jsonRequest(
        `http://localhost/api/amora/actions/${ACTION_ID}`,
        "PATCH",
        { due_date: "2027-02-29" },
      ),
      { params: Promise.resolve({ id: ACTION_ID }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("YYYY-MM-DD"),
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
