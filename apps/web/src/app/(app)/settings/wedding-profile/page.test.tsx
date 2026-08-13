// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProgressItem } from "@/types/database.types";

const mocks = vi.hoisted(() => ({
  journey: {
    progress: {} as Record<string, ProgressItem>,
    state_revision: 7,
  },
  updateJourney: vi.fn(),
  refreshJourney: vi.fn(),
  isDemo: true,
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    journey: mocks.journey,
    updateJourney: mocks.updateJourney,
    refreshJourney: mocks.refreshJourney,
    isDemo: mocks.isDemo,
    user: { id: "viewer-profile-id" },
    profile: { id: "viewer-profile-id" },
  }),
}));

import WeddingProfilePage from "./page";

const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

function createStoredProfile({
  ceremony,
  gathering,
  reviewedAt,
}: {
  ceremony: "yes" | "no" | "undecided";
  gathering: "none" | "family_meal" | "reception" | "undecided";
  reviewedAt: string;
}) {
  return {
    version: 2,
    reviewedAt,
    answers: {
      ceremony,
      gathering,
      legalMarriage: "undecided",
      travel: "undecided",
      housing: "undecided",
      internationalMarriage: null,
      religiousCeremony: null,
      remarriage: null,
      childrenParticipating: null,
      accessibilitySupport: null,
      healthSupport: null,
      petParticipation: null,
      familyTradition: null,
    },
    autoExcludedItemIds: [],
  };
}

describe("WeddingProfilePage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    mocks.journey = { progress: {}, state_revision: 7 };
    mocks.updateJourney.mockReset();
    mocks.refreshJourney.mockReset();
    mocks.isDemo = true;
    mocks.updateJourney.mockResolvedValue({ status: "applied" });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  async function render() {
    await act(async () => root.render(<WeddingProfilePage />));
  }

  it("collects all situation switches without asking for sensitive details", async () => {
    await render();
    for (const label of [
      "예식 여부",
      "축하 식사·모임",
      "법률혼 계획",
      "신혼여행 범위",
      "주거 형태",
      "국제혼인",
      "종교식",
      "재혼",
      "자녀 동반",
      "접근성 지원",
      "건강 지원",
      "반려동물 참여",
      "전통 의례",
    ]) expect(container.textContent).toContain(label);
    expect(container.textContent).toContain("예식과 별개예요. 가장 큰 모임 기준으로 골라 주세요.");
    const ceremony = container.querySelector('input[name="ceremony"]')?.closest("fieldset");
    const gathering = container.querySelector('input[name="gathering"]')?.closest("fieldset");
    expect(ceremony?.nextElementSibling).toBe(gathering);
    expect(container.textContent).toContain("민감한 건강 정보나 가족 사정의 상세 내용은 적지 마세요");
  });

  it("shows a preview and waits for explicit confirmation before saving", async () => {
    await render();
    expect(mocks.updateJourney).not.toHaveBeenCalled();

    const noCeremony = container.querySelector<HTMLInputElement>('input[name="ceremony"][value="no"]');
    await act(async () => noCeremony?.click());
    const preview = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("변경 미리보기"));
    await act(async () => preview?.click());

    expect(mocks.updateJourney).not.toHaveBeenCalled();
    expect(container.textContent).toContain("제외 예정");
    expect(container.textContent).toContain("자동으로 저장되지 않았어요");
    expect(container.textContent).toContain("원하는 드레스 분위기와 편안함 기준 정하기");
    expect(container.textContent).toContain("드레스·예식 정장");

    const confirm = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("확인하고 저장"));
    await act(async () => confirm?.click());
    expect(mocks.updateJourney).toHaveBeenCalledTimes(1);
    const request = mocks.updateJourney.mock.calls[0][0] as { progress: Record<string, unknown> };
    expect(request.progress.__checklist_profile).toMatchObject({
      version: 2,
      answers: { ceremony: "no", gathering: "undecided" },
    });
  });

  it("separates no ceremony from having no celebration gathering", async () => {
    await render();

    await act(async () => {
      container.querySelector<HTMLInputElement>('input[name="ceremony"][value="no"]')?.click();
      container.querySelector<HTMLInputElement>('input[name="gathering"][value="none"]')?.click();
    });
    const preview = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("변경 미리보기"),
    );
    await act(async () => preview?.click());

    expect(container.textContent).toContain("78개");
    expect(container.textContent).toContain("양쪽 초대 범위·동반인·어린이 참석 기준 합의");
    expect(mocks.updateJourney).not.toHaveBeenCalled();
  });

  it("requires a fresh preview when partner data changed after preview", async () => {
    await render();
    const preview = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("변경 미리보기"),
    );
    await act(async () => preview?.click());

    mocks.journey = { progress: {}, state_revision: 8 };
    await render();
    const confirm = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("확인하고 저장"),
    );
    await act(async () => confirm?.click());

    expect(mocks.updateJourney).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("미리보기를 다시 확인");
  });

  it("blocks a dirty draft after a newer situation profile arrives and reloads the latest values", async () => {
    mocks.isDemo = false;
    mocks.journey = {
      state_revision: 7,
      progress: {
        __checklist_profile: createStoredProfile({
          reviewedAt: "2026-08-13T01:00:00.000Z",
          ceremony: "undecided",
          gathering: "undecided",
        }),
      } as unknown as Record<string, ProgressItem>,
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await render();

    await act(async () => {
      container.querySelector<HTMLInputElement>('input[name="ceremony"][value="no"]')?.click();
    });
    mocks.journey = {
      state_revision: 7,
      progress: {
        __checklist_profile: createStoredProfile({
          reviewedAt: "2026-08-13T02:00:00.000Z",
          ceremony: "yes",
          gathering: "family_meal",
        }),
      } as unknown as Record<string, ProgressItem>,
    };
    await render();

    const previewButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("변경 미리보기"),
    );
    await act(async () => previewButton?.click());
    const confirmButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("확인하고 저장"),
    );
    await act(async () => confirmButton?.click());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.updateJourney).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "최신 설정을 다시 불러온 뒤",
    );
    expect(container.querySelector<HTMLInputElement>('input[name="ceremony"][value="no"]')?.checked)
      .toBe(true);

    const reloadButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("최신 설정 다시 불러오기"),
    );
    await act(async () => reloadButton?.click());

    expect(container.querySelector<HTMLInputElement>('input[name="ceremony"][value="yes"]')?.checked)
      .toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name="gathering"][value="family_meal"]')?.checked)
      .toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("최신 설정을 불러왔어요");
  });

  it("syncs an untouched draft when the stored situation profile changes", async () => {
    mocks.journey = {
      state_revision: 7,
      progress: {
        __checklist_profile: createStoredProfile({
          reviewedAt: "2026-08-13T01:00:00.000Z",
          ceremony: "no",
          gathering: "none",
        }),
      } as unknown as Record<string, ProgressItem>,
    };
    await render();
    expect(container.querySelector<HTMLInputElement>('input[name="ceremony"][value="no"]')?.checked)
      .toBe(true);

    mocks.journey = {
      state_revision: 8,
      progress: {
        __checklist_profile: createStoredProfile({
          reviewedAt: "2026-08-13T02:00:00.000Z",
          ceremony: "yes",
          gathering: "family_meal",
        }),
      } as unknown as Record<string, ProgressItem>,
    };
    await render();

    expect(container.querySelector<HTMLInputElement>('input[name="ceremony"][value="yes"]')?.checked)
      .toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name="gathering"][value="family_meal"]')?.checked)
      .toBe(true);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("does not create a new approval request when the stored situation is unchanged", async () => {
    mocks.journey = {
      state_revision: 7,
      progress: {
        __checklist_profile: {
          version: 1,
          reviewedAt: "2026-08-12T08:00:00.000Z",
          answers: {
            ceremony: "undecided",
            legalMarriage: "undecided",
            travel: "undecided",
            housing: "undecided",
            internationalMarriage: null,
            religiousCeremony: null,
            remarriage: null,
            childrenParticipating: null,
            accessibilitySupport: null,
            healthSupport: null,
            petParticipation: null,
            familyTradition: null,
          },
          autoExcludedItemIds: [],
        },
      } as unknown as Record<string, ProgressItem>,
    };
    await render();

    const previewButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("변경 미리보기"),
    );
    await act(async () => previewButton?.click());

    expect(mocks.updateJourney).not.toHaveBeenCalled();
    expect(container.textContent).toContain("저장할 변경이 없어요");
  });

  it("turns a partial legacy situation record into a complete reviewable profile", async () => {
    mocks.journey = {
      state_revision: 7,
      progress: {
        __checklist_profile: {
          version: 1,
          reviewedAt: "legacy-date",
          answers: { ceremony: "yes" },
          autoExcludedItemIds: [],
        },
      } as unknown as Record<string, ProgressItem>,
    };
    await render();

    expect(container.querySelector<HTMLInputElement>('input[name="ceremony"][value="yes"]')?.checked)
      .toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name="legalMarriage"][value="undecided"]')?.checked)
      .toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name="gathering"][value="undecided"]')?.checked)
      .toBe(true);
    const previewButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("변경 미리보기"),
    );
    await act(async () => previewButton?.click());

    expect(container.textContent).toContain("저장 전 확인");
    expect(container.textContent).not.toContain("저장할 변경이 없어요");
    const confirm = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("확인하고 저장"),
    );
    await act(async () => confirm?.click());
    const request = mocks.updateJourney.mock.calls[0][0] as {
      progress: { __checklist_profile: { answers: Record<string, unknown> } };
    };
    expect(request.progress.__checklist_profile).toMatchObject({
      version: 2,
      answers: { ceremony: "yes", gathering: "undecided" },
    });
    expect(Object.keys(request.progress.__checklist_profile.answers)).toHaveLength(13);
  });
});
