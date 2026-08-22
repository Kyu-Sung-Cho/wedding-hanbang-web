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

/**
 * 이 화면은 그리는 즉시 계정 변경을 구독한다(소유자 관문). 구독을 세우지 않으면
 * 진짜 Supabase 클라이언트를 만들려다 렌더에서 죽고, 아래 페이로드 단언은 한 번도
 * 실행되지 않는다. 이 검사가 보려는 것은 나가는 페이로드이므로 구독은 빈 껍데기면 된다.
 */
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
  }),
}));

/** 이 화면의 주인. 아래 세 곳(복원 초안·서버 응답·소유자 관문)이 같은 값을 써야 한다. */
const OWNER_USER_ID = "33333333-3333-4333-8333-333333333333";

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
        // 주인을 적지 않으면 `bindOwner`가 "다른 사람의 초안"으로 보고 초기 상태로
        // 되돌린다. 그러면 아래 단계·19항목이 애초에 사라진 채 검사가 통과한다 —
        // 즉 "합류하는 쪽은 아무것도 덮지 않는다"를 증명하지 못하는 거짓 초록이 된다.
        ownerUserId: OWNER_USER_ID,
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
        // 소유자 관문은 /api/auth/me 의 user.id 로 이 화면의 주인을 정한다.
        // 사람이 없으면 화면이 확인 중 상태에 머물러 제출 버튼 자체가 없다.
        return {
          ok: true,
          json: async () => ({ user: { id: OWNER_USER_ID }, profile: null }),
        } as Response;
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
