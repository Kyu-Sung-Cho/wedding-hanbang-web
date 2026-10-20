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

function journeyWith(totalBudget: number): WeddingJourney {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    couple_id: COUPLE_ID,
    wedding_date: "2027-05-08",
    venue: "한강 근처 식장",
    total_budget: totalBudget,
    progress: {},
    created_at: "2026-08-19T00:00:00.000Z",
    updated_at: "2026-08-19T00:00:00.000Z",
  };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("settings total budget editing", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalState: Pick<
    ReturnType<typeof useAuthStore.getState>,
    "couple" | "partner" | "isDemo" | "journey" | "profile" | "user" | "updateJourney"
  >;
  let updateJourney: ReturnType<typeof vi.fn>;

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
    updateJourney = vi.fn(async () => ({ status: "applied" as const, journey: journeyWith(0) }));
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

  async function renderWith(totalBudget: number) {
    // 데모 상태면 권한 API 조회가 나가지 않고, 저장은 updateJourney 가로채기로만 본다.
    useAuthStore.setState({
      isDemo: true,
      couple: null,
      partner: null,
      user: null,
      profile: PROFILE,
      journey: journeyWith(totalBudget),
      updateJourney: updateJourney as never,
    });
    await act(async () => {
      root.render(<SettingsPage />);
    });
  }

  /** "설정 예산" 글자를 가진 타일. 연필·입력·저장·취소가 모두 이 안에 있다. */
  function budgetTile(): HTMLElement {
    const label = [...container.querySelectorAll("p")].find(
      (node) => node.textContent === "설정 예산",
    );
    expect(label, "설정 예산 타일이 없다").toBeTruthy();
    return label!.parentElement as HTMLElement;
  }

  async function openEditor() {
    const pencil = budgetTile().querySelector("button");
    expect(pencil, "연필 버튼이 없다").toBeTruthy();
    await act(async () => {
      pencil!.click();
    });
    const input = budgetTile().querySelector<HTMLInputElement>('input[aria-label="설정 예산(만원 단위)"]');
    expect(input, "예산 입력 칸이 열리지 않았다").toBeTruthy();
    return input!;
  }

  async function typeAndSave(input: HTMLInputElement, value: string) {
    await act(async () => {
      setInputValue(input, value);
    });
    const [save] = budgetTile().querySelectorAll("button");
    await act(async () => {
      save.click();
    });
  }

  function alertTexts(): string[] {
    return [...container.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? "");
  }

  it("총예산을 기호 없이 라운지와 같은 표기로 보여 준다", async () => {
    await renderWith(25_000_000);
    expect(budgetTile().textContent).toContain("2,500만원");
    expect(budgetTile().textContent).not.toContain("₩");

    await act(async () => root.unmount());
    root = createRoot(container);
    await renderWith(25_505_000);
    expect(budgetTile().textContent).toContain("2,550만5,000원");
    expect(budgetTile().textContent).not.toContain("₩");
  });

  it("원 단위까지 있는 총예산은 값을 안 바꾸고 저장해도 그대로 남는다", async () => {
    await renderWith(25_505_000);
    const input = await openEditor();
    expect(input.value).toBe("2550.5");

    const [save] = budgetTile().querySelectorAll("button");
    await act(async () => {
      save.click();
    });

    expect(updateJourney).toHaveBeenCalledTimes(1);
    expect(updateJourney).toHaveBeenCalledWith({ total_budget: 25_505_000 });
  });

  it("소수 만원을 직접 넣어도 원 단위로 반올림해 저장한다", async () => {
    await renderWith(25_000_000);
    const input = await openEditor();
    await typeAndSave(input, "3000.5");

    expect(updateJourney).toHaveBeenCalledTimes(1);
    expect(updateJourney).toHaveBeenCalledWith({ total_budget: 30_005_000 });
  });

  it("빈 칸이나 0을 저장하려 하면 이유를 말하고 저장하지 않는다", async () => {
    await renderWith(25_000_000);
    const input = await openEditor();

    await typeAndSave(input, "");
    expect(updateJourney).not.toHaveBeenCalled();
    expect(alertTexts().join(" ")).toMatch(/0보다 크고.*만원/);

    // 다시 입력하면 안내가 걷힌다.
    await act(async () => {
      setInputValue(input, "0");
    });
    expect(alertTexts()).toHaveLength(0);

    const [save] = budgetTile().querySelectorAll("button");
    await act(async () => {
      save.click();
    });
    expect(updateJourney).not.toHaveBeenCalled();
    expect(alertTexts().join(" ")).toMatch(/0보다 크고.*만원/);
  });

  it("예산을 아직 안 정했으면 칸이 0 대신 비어서 열린다", async () => {
    await renderWith(0);
    const input = await openEditor();
    expect(input.value).toBe("");
  });

  it("이름을 비우고 저장하면 이유를 말하고 요청을 보내지 않는다", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(
      async () => new Response("{}", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderWith(25_000_000);

    const namePencil = [...container.querySelectorAll("h2")]
      .find((node) => node.textContent === "하나")
      ?.parentElement?.querySelector("button");
    expect(namePencil, "이름 연필 버튼이 없다").toBeTruthy();
    await act(async () => {
      namePencil!.click();
    });
    const nameInput = container.querySelector<HTMLInputElement>('input[type="text"]');
    expect(nameInput, "이름 입력 칸이 열리지 않았다").toBeTruthy();
    await act(async () => {
      setInputValue(nameInput!, "   ");
    });
    const [save] = nameInput!.parentElement!.querySelectorAll("button");
    await act(async () => {
      save.click();
    });

    const profileCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/profile"));
    expect(profileCalls).toHaveLength(0);
    expect(alertTexts()).toContain("이름을 입력해 주세요.");
  });
});
