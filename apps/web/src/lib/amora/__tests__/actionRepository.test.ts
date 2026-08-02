import { describe, expect, it } from "vitest";
import { amoraActionToRow, isAmoraActionStorageUnavailable } from "../actionRepository";

describe("isAmoraActionStorageUnavailable", () => {
  it("does not persist a scheme-relative action href", () => {
    const row = amoraActionToRow("couple-id", {
      id: "act_test",
      title: "계약서 확인",
      priority: "medium",
      status: "open",
      source: "chat",
      href: "//attacker.example/path",
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    });

    expect(row.href).toBeNull();
  });

  it("detects missing amora_actions table errors", () => {
    expect(isAmoraActionStorageUnavailable({ code: "42P01", message: "relation does not exist" })).toBe(true);
    expect(
      isAmoraActionStorageUnavailable({
        message: 'relation "public.amora_actions" does not exist',
      })
    ).toBe(true);
    expect(
      isAmoraActionStorageUnavailable({
        code: "PGRST205",
        message: "Could not find the table public.amora_actions in the schema cache",
      })
    ).toBe(true);
  });

  it("does not hide non-storage amora_actions errors", () => {
    expect(
      isAmoraActionStorageUnavailable({
        code: "23514",
        message: 'new row for relation "amora_actions" violates check constraint',
      })
    ).toBe(false);
  });
});
