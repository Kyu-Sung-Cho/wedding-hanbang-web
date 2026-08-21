// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FIRST_RUN_TUTORIAL_COMPLETED_EVENT,
  FIRST_RUN_TUTORIAL_SESSION_KEY,
  FIRST_RUN_TUTORIAL_VERSION,
} from "@hanbang/shared";
import FirstRunLoungeTutorial from "./FirstRunLoungeTutorial";
import { useAuthStore } from "@/stores/authStore";
import type { Profile } from "@/types/database.types";

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
    "profile" | "isDemo"
  >;

  beforeEach(() => {
    const state = useAuthStore.getState();
    originalState = { profile: state.profile, isDemo: state.isDemo };

    supabase.selectResult = { data: {}, error: null };
    supabase.updates.length = 0;
    supabase.updateError = null;
    sessionStorage.clear();
    localStorage.clear();
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
});
