// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PREPARATION_STAGE_PROGRESS_KEY } from "@hanbang/shared";
import OnboardingPage from "@/app/(auth)/onboarding/page";
import {
  ONBOARDING_STORAGE_KEY,
  useOnboardingStore,
} from "@/stores/onboardingStore";
import { PROGRESS_CHECKLIST_ITEMS } from "@/types/onboarding.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 초대 코드로 합류하는 사람은 스텝 2에서 바로 제출한다 — 준비 현황 화면을 지나가지
 * 않는다. 그런데 세션 저장소에는 앞서 다른 경로를 둘러보며 남은 단계와 19항목이
 * 그대로 살아 있을 수 있다. 그 값이 제출에 실려 나가면 먼저 시작한 파트너가 적어둔
 * 공유 기록(`couples.progress`)을 덮는다. 그래서 실제로 나가는 페이로드를 본다.
 */
function primeRestoredSession() {
  window.sessionStorage.setItem(
    ONBOARDING_STORAGE_KEY,
    JSON.stringify({
      version: 0,
      state: {
        currentStep: 2,
        role: "bride",
        coupleAction: "join",
        preparationStage: "venue_booked",
        preferences: {
          weddingStyle: null,
          priorities: [],
          budgetTendency: null,
          guestCount: null,
        },
        progressChecklist: PROGRESS_CHECKLIST_ITEMS.map((item) =>
          item.key === "venue"
            ? { ...item, status: "completed", cost: 300 }
            : item.key === "studio"
              ? { ...item, status: "in_progress" }
              : item,
        ),
      },
    }),
  );
}

describe("초대 코드로 합류하는 제출", () => {
  let container: HTMLDivElement;
  let root: Root;
  let requests: { url: string; body: Record<string, unknown> }[];

  beforeEach(() => {
    window.sessionStorage.clear();
    useOnboardingStore.getState().reset();
    requests = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "POST") {
          requests.push({ url, body: JSON.parse(String(init.body)) });
          // 파트너 확인 대기 응답을 쓰면 페이지가 안내만 띄우고 이동하지 않는다.
          // 이 테스트가 보려는 것은 이동이 아니라 나간 페이로드다.
          return {
            ok: true,
            json: async () => ({
              planChange: { status: "pending_partner", summary: "파트너 확인을 기다려요" },
            }),
          } as Response;
        }
        return { ok: true, json: async () => ({ profile: null }) } as Response;
      }),
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("단계도 19항목도 보내지 않는다", async () => {
    primeRestoredSession();

    await act(async () => root.render(<OnboardingPage />));
    await act(async () => {
      useOnboardingStore.getState().setPartnerInviteCode("WH-ABC123");
    });

    const submit = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "파트너와 연결하기",
    );
    expect(submit).toBeTruthy();
    expect(submit?.disabled).toBe(false);

    await act(async () => submit?.click());

    expect(requests).toHaveLength(1);
    const payload = requests[0].body;
    expect(requests[0].url).toBe("/api/onboarding");
    expect(payload.coupleAction).toBe("join");

    const progress = payload.progress as Record<string, unknown>;
    // 커플 공유 데이터라 합류하는 쪽은 아무것도 덮어쓰지 않는다.
    expect(Object.keys(progress)).toEqual(["__preferences"]);
    expect(Object.hasOwn(progress, PREPARATION_STAGE_PROGRESS_KEY)).toBe(false);
    for (const item of PROGRESS_CHECKLIST_ITEMS) {
      expect(Object.hasOwn(progress, item.key)).toBe(false);
    }
  });
});
