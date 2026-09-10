// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn((destination: string): never => { throw new Error(`redirect:${destination}`); }));
vi.mock("next/navigation", () => ({ redirect }));
import SavedNotesPage from "./page";

describe("기존 저장함 주소 호환", () => {
  it("같은 저장 자료의 새 보드 탭으로 이동한다", () => {
    expect(() => SavedNotesPage()).toThrow("redirect:/wedding/chat/board?view=saved");
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/wedding/chat/board?view=saved");
  });
});
