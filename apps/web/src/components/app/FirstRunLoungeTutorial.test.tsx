// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildAmoraFirstHello,
  FIRST_RUN_TUTORIAL_COMPLETED_EVENT,
  FIRST_RUN_TUTORIAL_SESSION_KEY,
  FIRST_RUN_TUTORIAL_VERSION,
} from "@hanbang/shared";
import FirstRunLoungeTutorial, {
  LOUNGE_TUTORIAL_REPLAY_EVENT,
} from "./FirstRunLoungeTutorial";
import { useAuthStore } from "@/stores/authStore";
import type { Profile } from "@/types/database.types";
import {
  consumePendingAmoraFirstHello,
  peekPendingAmoraFirstHello,
  rememberPendingAmoraFirstHello,
  resetAmoraFirstHelloMemory,
} from "@/lib/amora/pendingFirstHello";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const supabase = vi.hoisted(() => ({
  selectResult: { data: {} as unknown, error: null as unknown },
  updates: [] as Array<{ values: Record<string, unknown>; id: string }>,
  updateError: null as unknown,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => supabase.selectResult,
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: async (_column: string, id: string) => {
          supabase.updates.push({ values, id });
          return { error: supabase.updateError };
        },
      }),
    }),
  }),
}));

const PROFILE: Profile = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "지은",
  email: "bride@example.com",
  role: "bride",
  couple_id: "20000000-0000-4000-8000-000000000001",
  avatar_url: null,
  onboarding_completed: true,
  onboarding_step: 5,
  is_admin: false,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
};

/** 투어가 잴 앵커. 없으면 엔진이 모든 스텝을 건너뛴다. */
function mountAnchors() {
  for (const id of ["lounge-focus", "lounge-tools", "lounge-invite", "amora-fab"]) {
    const node = document.createElement("div");
    node.setAttribute("data-tutorial-target", id);
    document.body.appendChild(node);
  }
}

function tutorialDialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}

describe("첫 실행 라운지 안내", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalState: Pick<
    ReturnType<typeof useAuthStore.getState>,
    "profile" | "isDemo" | "journey" | "partner"
  >;

  beforeEach(() => {
    const state = useAuthStore.getState();
    originalState = { profile: state.profile, isDemo: state.isDemo, journey: state.journey, partner: state.partner };
    useAuthStore.setState({ journey: null, partner: null });

    supabase.selectResult = { data: {}, error: null };
    supabase.updates.length = 0;
    supabase.updateError = null;
    sessionStorage.clear();
    localStorage.clear();
    resetAmoraFirstHelloMemory();
    // jsdom에는 scrollIntoView가 없다. 엔진이 앵커를 화면에 올릴 때 부른다.
    Element.prototype.scrollIntoView = vi.fn();
    vi.useFakeTimers();

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    useAuthStore.setState(originalState);
    resetAmoraFirstHelloMemory();
    document.body.replaceChildren();
  });

  async function render() {
    await act(async () => {
      root.render(<FirstRunLoungeTutorial />);
    });
    // 상태 조회(마이크로태스크) → 시작 딜레이 → 앵커 측정 순서로 열린다.
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
  }

  it("온보딩을 마치지 않았으면 뜨지 않는다", async () => {
    useAuthStore.setState({
      profile: { ...PROFILE, onboarding_completed: false },
      isDemo: false,
    });
    mountAnchors();

    await render();

    expect(tutorialDialog()).toBeNull();
    expect(supabase.updates).toHaveLength(0);
  });

  it("이미 본 기록이 있으면 뜨지 않는다", async () => {
    useAuthStore.setState({ profile: PROFILE, isDemo: false });
    supabase.selectResult = {
      data: {
        first_run_tutorial_completed_at: "2026-08-18T00:00:00.000Z",
        first_run_tutorial_version: FIRST_RUN_TUTORIAL_VERSION,
      },
      error: null,
    };
    mountAnchors();

    await render();

    expect(tutorialDialog()).toBeNull();
  });

  it("이미 본 기록이 있어도 사용자가 다시 보기를 요청하면 안내를 다시 연다", async () => {
    useAuthStore.setState({ profile: PROFILE, isDemo: false });
    supabase.selectResult = {
      data: {
        first_run_tutorial_completed_at: "2026-08-18T00:00:00.000Z",
        first_run_tutorial_version: FIRST_RUN_TUTORIAL_VERSION,
      },
      error: null,
    };
    localStorage.setItem("hanbang_first_run_tutorial_done", "true");
    mountAnchors();

    await render();
    expect(tutorialDialog()).toBeNull();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(LOUNGE_TUTORIAL_REPLAY_EVENT));
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    const dialog = tutorialDialog();
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("여기부터 보시면 돼요");
  });

  it("단계를 고르면 그 단계만 띄운다(청첩장 홈: 옛 라운지의 할 일·도구 칸이 없어 초대와 아모라만)", async () => {
    useAuthStore.setState({ profile: PROFILE, isDemo: false });
    mountAnchors();

    await act(async () => {
      root.render(<FirstRunLoungeTutorial stepIds={["lounge-invite", "amora-fab"]} />);
    });
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    const dialog = tutorialDialog();
    expect(dialog?.textContent).toContain("파트너를 부르면 같이 봐요");
    expect(dialog?.textContent).not.toContain("여기부터 보시면 돼요");
  });

  it("컬럼이 아직 없는 응답(42703)에서도 화면이 죽지 않고 '아직 안 봤다'로 뜬다", async () => {
    useAuthStore.setState({ profile: PROFILE, isDemo: false });
    // 마이그레이션 전 배포에서 실제로 오는 오류 모양.
    supabase.selectResult = {
      data: null,
      error: {
        code: "42703",
        message:
          'column profiles.first_run_tutorial_completed_at does not exist',
      },
    };
    mountAnchors();

    await render();

    const dialog = tutorialDialog();
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("여기부터 보시면 돼요");
  });

  it("건너뛰기도 완료로 기록하고 끝났다고 알린다", async () => {
    useAuthStore.setState({ profile: PROFILE, isDemo: false });
    mountAnchors();
    const completed: Event[] = [];
    const listener = (event: Event) => completed.push(event);
    window.addEventListener(FIRST_RUN_TUTORIAL_COMPLETED_EVENT, listener);

    try {
      await render();

      const skip = Array.from(
        document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
      ).find((button) => button.textContent?.includes("건너뛰기"));
      expect(skip).toBeDefined();

      await act(async () => {
        skip?.click();
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(completed).toHaveLength(1);
      expect(supabase.updates).toHaveLength(1);
      expect(supabase.updates[0]?.id).toBe(PROFILE.id);
      expect(
        supabase.updates[0]?.values.first_run_tutorial_version,
      ).toBe(FIRST_RUN_TUTORIAL_VERSION);
      expect(
        typeof supabase.updates[0]?.values.first_run_tutorial_completed_at,
      ).toBe("string");
      expect(tutorialDialog()).toBeNull();
      const hello = buildAmoraFirstHello({ weddingDate: null, preparationStage: null, partnerLinked: false, now: Date.now() });
      expect(container.querySelector('[aria-label="아모라의 첫인사"]')?.textContent).toContain(hello.preview);
      expect(peekPendingAmoraFirstHello({ ownerId: PROFILE.id })?.body).toBe(hello.body);
      expect(container.querySelector('a[href="/wedding/chat"]')).not.toBeNull();
      expect(container.querySelector('button[aria-label="아모라 AI 상담"]')).toBeNull();
    } finally {
      window.removeEventListener(FIRST_RUN_TUTORIAL_COMPLETED_EVENT, listener);
    }
  });

  it("쓰기가 실패해도 화면을 막지 않고, 같은 세션에서 다시 뜨지 않는다", async () => {
    useAuthStore.setState({ profile: PROFILE, isDemo: false });
    supabase.updateError = { code: "42501", message: "permission denied" };
    mountAnchors();

    await render();
    expect(tutorialDialog()).not.toBeNull();

    const skip = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ).find((button) => button.textContent?.includes("건너뛰기"));
    await act(async () => {
      skip?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(tutorialDialog()).toBeNull();
    // 계정에 못 적었어도 이 기기·이 세션은 기억한다.
    expect(sessionStorage.getItem(FIRST_RUN_TUTORIAL_SESSION_KEY)).toBe("1");
  });

  it("이 기기에서 이미 끝냈는데 계정이 비어 있으면, 화면 대신 계정만 맞춘다", async () => {
    // 계정 쓰기가 실패했거나 컬럼이 없는 배포에서 안내를 본 사람이다.
    // 그대로 두면 엔진이 기기 키를 보고 조용히 시작하지 않고, 시작하지 않으니
    // onFinish도 없어서 계정은 영영 "안 봤다"로 남는다 — 안내도 아모라 첫마디도
    // 다시는 안 뜨는데 기록만 비어 있고, 다른 기기에서는 매번 처음부터 다시 본다.
    useAuthStore.setState({ profile: PROFILE, isDemo: false });
    localStorage.setItem("hanbang_first_run_tutorial_done", "1");
    mountAnchors();

    await render();

    // 화면은 건드리지 않는다.
    expect(tutorialDialog()).toBeNull();
    // 계정에는 조용히 적어 둔다.
    expect(supabase.updates).toHaveLength(1);
    expect(supabase.updates[0]?.id).toBe(PROFILE.id);
    expect(supabase.updates[0]?.values).toMatchObject({
      first_run_tutorial_version: FIRST_RUN_TUTORIAL_VERSION,
    });
    expect(
      supabase.updates[0]?.values.first_run_tutorial_completed_at,
    ).toEqual(expect.any(String));
  });

  it("인라인 미리보기를 닫아도 전체 대화가 인사를 받고, 다시 마운트해도 미리보기는 열리지 않는다", async () => {
    useAuthStore.setState({ profile: PROFILE, isDemo: false });
    const hello = { preview: "우리 결혼 준비 이야기부터 나눠요.", body: "함께 준비할 이야기부터 차근차근 들어볼게요." };
    rememberPendingAmoraFirstHello(hello, { ownerId: PROFILE.id });
    await render();
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="아모라 첫인사 미리보기 닫기"]');
    expect(close).not.toBeNull();
    await act(async () => close?.click());
    expect(container.querySelector('[aria-label="아모라의 첫인사"]')).toBeNull();
    expect(peekPendingAmoraFirstHello({ ownerId: PROFILE.id })?.bubbleDismissed).toBe(true);

    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.querySelector('[aria-label="아모라의 첫인사"]')).toBeNull();
    expect(consumePendingAmoraFirstHello({ ownerId: PROFILE.id })).toEqual(hello);
    resetAmoraFirstHelloMemory();
    expect(consumePendingAmoraFirstHello({ ownerId: PROFILE.id })).toBeNull();
  });

  it("같은 계정의 저장된 첫인사는 다시 보여주고, 다른 계정으로 바뀌면 넘겨주지 않는다", async () => {
    useAuthStore.setState({ profile: PROFILE, isDemo: false });
    rememberPendingAmoraFirstHello({ preview: "지은님의 준비 이야기", body: "지은님의 결혼 준비에 대한 첫인사" }, { ownerId: PROFILE.id });
    await render();
    expect(container.textContent).toContain("지은님의 준비 이야기");

    const nextId = "10000000-0000-4000-8000-000000000002";
    await act(async () => useAuthStore.setState({ profile: { ...PROFILE, id: nextId, name: "다른 회원" } }));
    expect(container.querySelector('[aria-label="아모라의 첫인사"]')).toBeNull();
    expect(container.textContent).not.toContain("지은님의 준비 이야기");
    expect(consumePendingAmoraFirstHello({ ownerId: nextId })).toBeNull();
  });

  it("체험 모드에서는 저장된 인사를 표시하거나 완료 이벤트로 새 인사를 만들지 않는다", async () => {
    useAuthStore.setState({ profile: PROFILE, isDemo: true });
    await render();
    await act(async () => window.dispatchEvent(new CustomEvent(FIRST_RUN_TUTORIAL_COMPLETED_EVENT)));
    expect(container.innerHTML).toBe("");
    expect(peekPendingAmoraFirstHello({ ownerId: PROFILE.id })).toBeNull();

    rememberPendingAmoraFirstHello({ preview: "계정의 첫인사", body: "계정의 저장된 첫인사 본문" }, { ownerId: PROFILE.id });
    await render();
    expect(container.innerHTML).toBe("");
    expect(supabase.updates).toHaveLength(0);
  });

  it("완료 이벤트가 중복되어도 닫은 미리보기를 다시 열지 않는다", async () => {
    useAuthStore.setState({ profile: PROFILE, isDemo: false });
    await render();
    await act(async () => window.dispatchEvent(new CustomEvent(FIRST_RUN_TUTORIAL_COMPLETED_EVENT)));
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="아모라 첫인사 미리보기 닫기"]');
    expect(close).not.toBeNull();
    await act(async () => close?.click());
    await act(async () => window.dispatchEvent(new CustomEvent(FIRST_RUN_TUTORIAL_COMPLETED_EVENT)));
    expect(container.querySelector('[aria-label="아모라의 첫인사"]')).toBeNull();
    expect(peekPendingAmoraFirstHello({ ownerId: PROFILE.id })?.bubbleDismissed).toBe(true);
  });

  it("안내 중 바뀐 예식일·준비 단계·연결 상태를 완료 시점에 읽는다", async () => {
    useAuthStore.setState({ profile: PROFILE, isDemo: false });
    await render();
    const journey = {
      id: "journey-1",
      couple_id: PROFILE.couple_id ?? "couple-1",
      wedding_date: "2027-01-25",
      venue: null,
      total_budget: 0,
      progress: {},
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    };
    // 실제 progress JSON에는 카테고리 행과 별도로 온보딩 메타데이터가 들어 있다.
    Reflect.set(journey.progress, "__stage", "venue_booked");
    await act(async () => useAuthStore.setState({
      journey,
      partner: { id: "partner-1", name: "준비 파트너", role: "groom", couple_id: PROFILE.couple_id },
    }));
    await act(async () => window.dispatchEvent(new CustomEvent(FIRST_RUN_TUTORIAL_COMPLETED_EVENT)));
    const hello = buildAmoraFirstHello({ weddingDate: "2027-01-25", preparationStage: "venue_booked", partnerLinked: true, now: Date.now() });
    expect(peekPendingAmoraFirstHello({ ownerId: PROFILE.id })?.body).toBe(hello.body);
    expect(container.querySelector('[aria-label="아모라의 첫인사"]')?.textContent).toContain(hello.preview);
  });

  it("로그아웃하면 미리보기를 지우고 완료 이벤트를 받아도 인사를 만들지 않는다", async () => {
    useAuthStore.setState({ profile: PROFILE, isDemo: false });
    await render();
    await act(async () => window.dispatchEvent(new CustomEvent(FIRST_RUN_TUTORIAL_COMPLETED_EVENT)));
    expect(container.querySelector('[aria-label="아모라의 첫인사"]')).not.toBeNull();
    await act(async () => useAuthStore.setState({ profile: null }));
    expect(container.innerHTML).toBe("");
    await act(async () => window.dispatchEvent(new CustomEvent(FIRST_RUN_TUTORIAL_COMPLETED_EVENT)));
    expect(container.innerHTML).toBe("");
    expect(consumePendingAmoraFirstHello({ ownerId: null })).toBeNull();
  });
});
