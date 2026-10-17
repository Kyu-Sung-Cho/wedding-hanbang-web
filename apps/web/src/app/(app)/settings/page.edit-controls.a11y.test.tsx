// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://hanbang.ai/settings" }

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SettingsPage from "./page";
import { useAuthStore } from "@/stores/authStore";
import type { Profile, WeddingJourney } from "@/types/database.types";

vi.mock("@/components/app/TodayOnePreferenceControl", () => ({
  default: () => null,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000001";

const PROFILE: Profile = {
  id: USER_ID,
  name: "하나",
  role: "bride",
  confirmed_role: "bride",
  couple_id: COUPLE_ID,
  avatar_url: null,
  onboarding_completed: true,
  onboarding_step: 0,
  is_admin: false,
  created_at: "2026-08-19T00:00:00.000Z",
  updated_at: "2026-08-19T00:00:00.000Z",
};

const JOURNEY: WeddingJourney = {
  id: "30000000-0000-4000-8000-000000000001",
  couple_id: COUPLE_ID,
  wedding_date: "2027-05-08",
  venue: "한강 근처 식장",
  total_budget: 25_000_000,
  progress: {},
  created_at: "2026-08-19T00:00:00.000Z",
  updated_at: "2026-08-19T00:00:00.000Z",
};

/** 네 칸: 연필 버튼의 이름, 저장·취소 버튼의 이름, 입력의 이름, 연필 id. */
const FIELDS = [
  { key: "name", pencil: "이름 수정", save: "이름 저장", cancel: "이름 수정 취소", input: "이름", id: "settings-edit-name" },
  { key: "date", pencil: "결혼 예정일 수정", save: "결혼 예정일 저장", cancel: "결혼 예정일 수정 취소", input: "결혼 예정일", id: "settings-edit-date" },
  { key: "venue", pencil: "결혼식장 수정", save: "결혼식장 저장", cancel: "결혼식장 수정 취소", input: "결혼식장", id: "settings-edit-venue" },
  { key: "budget", pencil: "설정 예산 수정", save: "설정 예산 저장", cancel: "설정 예산 수정 취소", input: "설정 예산(만원 단위)", id: "settings-edit-budget" },
] as const;

function byLabel<T extends HTMLElement = HTMLButtonElement>(
  container: ParentNode,
  label: string,
): T | null {
  return container.querySelector<T>(`[aria-label="${label}"]`);
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("settings edit controls accessibility", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalState: Pick<
    ReturnType<typeof useAuthStore.getState>,
    "couple" | "partner" | "isDemo" | "journey" | "profile" | "user" | "updateJourney"
  >;

  beforeEach(() => {
    const state = useAuthStore.getState();
    originalState = {
      couple: state.couple,
      partner: state.partner,
      isDemo: state.isDemo,
      journey: state.journey,
      profile: state.profile,
      user: state.user,
      updateJourney: state.updateJourney,
    };
    // 데모 상태면 권한 API 조회가 나가지 않는다. 저장은 updateJourney 를 가로챈다.
    useAuthStore.setState({
      isDemo: true,
      couple: null,
      partner: null,
      user: null,
      profile: PROFILE,
      journey: JOURNEY,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    useAuthStore.setState(originalState);
    document.body.replaceChildren();
  });

  async function renderPage() {
    await act(async () => {
      root.render(<SettingsPage />);
    });
  }

  async function click(element: HTMLElement | null) {
    expect(element, "누를 버튼이 없다").toBeTruthy();
    await act(async () => {
      element!.click();
    });
  }

  it("연필·저장·취소 버튼과 입력 칸이 모두 이름을 갖는다", async () => {
    await renderPage();

    for (const field of FIELDS) {
      const pencil = byLabel(container, field.pencil);
      expect(pencil, `${field.pencil} 버튼에 이름이 없다`).toBeTruthy();
      expect(pencil?.id).toBe(field.id);

      await click(pencil);

      expect(byLabel(container, field.save), `${field.save} 버튼에 이름이 없다`).toBeTruthy();
      expect(byLabel(container, field.cancel), `${field.cancel} 버튼에 이름이 없다`).toBeTruthy();
      expect(
        byLabel<HTMLInputElement>(container, field.input),
        `${field.input} 입력에 이름이 없다`,
      ).toBeTruthy();

      await click(byLabel(container, field.cancel));
    }
  });

  it("취소하면 포커스가 열었던 연필 버튼으로 돌아간다", async () => {
    await renderPage();

    for (const field of FIELDS) {
      await click(byLabel(container, field.pencil));
      const cancel = byLabel(container, field.cancel);
      // 실제 클릭은 누른 버튼에 포커스를 준다. jsdom 의 click() 은 주지 않으므로 먼저 맞춘다.
      cancel?.focus();
      expect(document.activeElement).toBe(cancel);

      await click(cancel);

      expect(document.getElementById(field.id), `${field.id} 가 다시 그려지지 않았다`).toBeTruthy();
      expect(document.activeElement, `${field.cancel} 뒤 포커스가 돌아오지 않았다`).toBe(
        document.getElementById(field.id),
      );
    }
  });

  it("입력 칸에서 Enter 로 저장해도 포커스가 연필 버튼으로 돌아간다", async () => {
    useAuthStore.setState({
      updateJourney: vi.fn(async () => ({ status: "applied" as const, journey: JOURNEY })),
    });
    await renderPage();

    // 식장·예산 입력은 Enter 로 저장된다. 포커스가 있던 입력 칸이 사라지므로 돌려주지 않으면 body 로 빠진다.
    for (const field of FIELDS.filter((item) => item.key === "venue" || item.key === "budget")) {
      await click(byLabel(container, field.pencil));
      const input = byLabel<HTMLInputElement>(container, field.input);
      input?.focus();
      expect(document.activeElement).toBe(input);

      await act(async () => {
        input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });

      expect(document.getElementById(field.id)).toBeTruthy();
      expect(document.activeElement, `${field.input} Enter 저장 뒤 포커스가 돌아오지 않았다`).toBe(
        document.getElementById(field.id),
      );
    }
  });

  it("이름 저장이 성공해도 포커스가 연필 버튼으로 돌아간다", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/profile")) {
        return new Response(JSON.stringify({ profile: { ...PROFILE, name: "새이름" } }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }));
    await renderPage();

    await click(byLabel(container, "이름 수정"));
    await act(async () => {
      setInputValue(byLabel<HTMLInputElement>(container, "이름")!, "새이름");
    });
    const save = byLabel(container, "이름 저장");
    save?.focus();
    await click(save);

    expect(container.textContent).toContain("새이름");
    expect(document.activeElement).toBe(document.getElementById("settings-edit-name"));
  });

  it("저장하는 동안 다른 곳으로 옮긴 포커스는 빼앗지 않는다", async () => {
    let finishSave: (() => void) | undefined;
    useAuthStore.setState({
      updateJourney: vi.fn(
        () =>
          new Promise<{ status: "applied"; journey: WeddingJourney }>((resolve) => {
            finishSave = () => resolve({ status: "applied", journey: JOURNEY });
          }),
      ),
    });
    await renderPage();

    await click(byLabel(container, "결혼 예정일 수정"));
    await click(byLabel(container, "결혼 예정일 저장"));

    // 저장이 끝나기 전에 사용자가 이름 연필 쪽으로 옮겼다.
    const elsewhere = document.getElementById("settings-edit-name");
    elsewhere?.focus();
    expect(document.activeElement).toBe(elsewhere);

    await act(async () => {
      finishSave?.();
    });

    expect(document.getElementById("settings-edit-date")).toBeTruthy();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("이름 저장이 거절되면 오류가 알림 영역으로 읽힌다", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/profile")) {
        return new Response(JSON.stringify({ error: "이미 쓰고 있는 이름이에요." }), { status: 400 });
      }
      return new Response("{}", { status: 404 });
    }));
    await renderPage();

    await click(byLabel(container, "이름 수정"));
    await act(async () => {
      setInputValue(byLabel<HTMLInputElement>(container, "이름")!, "다른이름");
    });
    await click(byLabel(container, "이름 저장"));

    const alerts = [...container.querySelectorAll('[role="alert"]')].map(
      (node) => node.textContent ?? "",
    );
    expect(alerts).toContain("이미 쓰고 있는 이름이에요.");
  });
});
