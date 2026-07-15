import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  AMORA_ACTIONS_RETIRED_CODE,
  GET,
  POST,
} from "../route";
import { PATCH } from "../[id]/route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

describe("/api/amora/actions retirement boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["GET", () => GET()],
    ["POST", () => POST()],
    ["PATCH", () => PATCH()],
  ])("returns 410 for %s before auth, body parsing, or database access", async (_, invoke) => {
    const request = new Request("http://localhost/api/amora/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "should never be read" }),
    });
    const jsonSpy = vi.spyOn(request, "json");

    const response = await invoke();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      code: AMORA_ACTIONS_RETIRED_CODE,
      error:
        "아모라 행동 기능은 종료되었습니다. 준비 항목은 체크리스트에, 날짜가 있는 약속은 일정에 직접 기록해 주세요.",
    });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("keeps the retired routes free of dormant auth and database paths", () => {
    const collectionSource = readFileSync(resolve(__dirname, "../route.ts"), "utf8");
    const itemSource = readFileSync(resolve(__dirname, "../[id]/route.ts"), "utf8");

    for (const source of [collectionSource, itemSource]) {
      expect(source).not.toContain("createClientFromRequest");
      expect(source).not.toContain("createAdminClient");
      expect(source).not.toContain("actionRepository");
      expect(source).not.toContain(".from(");
      expect(source).not.toContain("request.json");
    }
  });
});
