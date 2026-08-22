import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 단계를 **안 고르고** 19항목 화면에 도착했을 때 화면이 뭐라고 말하는지 본다.
 *
 * ## 왜 이 테스트가 생겼나
 *
 * 온보딩 5단계의 단계 선택을 필수에서 선택으로 바꿨다(#138 기준: "없으면 무엇이
 * 죽는가 × 나중에 받아낼 경로가 살아 있는가" — 단계는 둘 다 통과한다). 그 순간
 * **아무것도 안 고르고 19항목 화면에 도착하는 길**이 열렸는데, 그 화면의 안내문은
 * 두 갈래뿐이라 폴백이 "고른 단계에는 미리 채울 항목이 없어서 비워뒀어요"였다.
 * 고른 적 없는 선택을 고쳤다고 말하게 된 것이다.
 *
 * 타입도 통과했고 기존 테스트 6,664개도 전부 초록이었다. 아무도 이 길을 걷지
 * 않았기 때문이다. 그래서 걷는 테스트를 만든다.
 *
 * ## 왜 화면을 실제로 렌더하나
 *
 * 안내문 문자열만 단위로 검사하면 "그 문자열이 실제로 저 상황에서 나오는가"를
 * 못 본다. 여기서 막으려는 사고가 정확히 그것이다 — 문자열은 멀쩡했고 **도달
 * 경로**가 새로 생긴 것이었다. 그래서 버튼을 눌러서 간다.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("framer-motion", () => ({
  motion: { div: "div", button: "button", span: "span", p: "p" },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/ui/Logo", () => ({ default: () => <span>Hanbang</span> }));
// 페이지는 계정 소유자를 auth 이벤트로도 재확인한다. 이 테스트는 DOM 만 보므로
// 실제 Supabase 클라이언트 대신 구독만 흉내 낸다.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
  }),
}));

import OnboardingPage from "../page";
import { useOnboardingStore } from "@/stores/onboardingStore";

/** 사용자가 고른 적 없는 선택을 고쳤다고 말하는 문구들. */
const CLAIMS_A_CHOICE = ["고른 단계", "선택한 단계"];

/**
 * 화면 내용을 4글자 조각으로 쪼갠다.
 *
 * 낱말로 세지 않는 이유: `textContent`는 요소 경계에서 공백 없이 붙어서 나온다
 * ("Hanbang결혼 준비 시작하기55준비 현황이미 시작한..."). 한국어라 띄어쓰기로
 * 자르면 낱말 하나가 여러 화면에 걸쳐 만들어진다. 조각으로 세면 그 문제가 없다.
 */
function contentGrams(text: string): Set<string> {
  const clean = text.replace(/\s+/gu, " ");
  const grams = new Set<string>();
  for (let i = 0; i + 4 <= clean.length; i += 1) grams.add(clean.slice(i, i + 4));
  return grams;
}

/**
 * 한 스텝이 **처음 보여주는** 내용의 최소량(4글자 조각 개수).
 *
 * ## 이 숫자가 왜 40인가 — 실측
 *
 * 처음에는 "화면 글자가 20자 넘는다 + 앞 스텝과 다르다"로 단언했다. 그걸로
 * 충분한 줄 알았는데, **스텝 3 본문을 통째로 지우고 돌렸더니 5개 테스트가 전부
 * 초록이었다.** 헤더·StepIndicator·버튼만으로 20자를 넘고, 인디케이터 숫자가
 * 2에서 3으로 바뀌니 "앞 스텝과 다르다"도 통과한 것이다. 아무것도 안 지키고 있었다.
 *
 * 그래서 실제로 재봤다(2026-08-21, 이 저장소 기준):
 *
 *   정상   스텝1 149 · 스텝2 82 · 스텝3 186 · 스텝4 367 · 단계 201 · 19항목 336
 *   본문을 지운 스텝3                      9
 *
 * 가장 적은 정상 스텝이 82, 빈 본문이 9다. 40은 그 사이에 넉넉히 들어간다.
 *
 * ## 여기가 깨졌을 때
 *
 * 스텝 본문을 일부러 아주 짧게 만든 게 아니라면 **렌더가 깨진 것이다.** 숫자를
 * 낮추기 전에 화면을 먼저 보라. 정말 짧아진 게 맞으면 위 실측을 다시 뽑고
 * 새 최솟값의 절반쯤으로 다시 잡는다.
 */
const MIN_FRESH = 40;

function clickButtonLabelled(container: HTMLElement, label: string): void {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) {
    const seen = Array.from(container.querySelectorAll("button"))
      .map((candidate) => `"${candidate.textContent?.trim()}"`)
      .join(", ");
    throw new Error(`"${label}" 버튼을 못 찾았습니다. 화면의 버튼: ${seen}`);
  }
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** 단계를 고르지 않은 채 5단계 19항목 화면까지 걸어간다. */
async function walkToChecklistWithoutStage() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        user: { id: "u1", email: "a@b.com" },
        profile: null,
        // 플래그 꺼진 경로 — 6스텝 온보딩이 이쪽이다.
        capabilities: { neutralPreparationSpace: false },
      }),
    })),
  );

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    useOnboardingStore.getState().setStep(5);
  });

  await act(async () => {
    root.render(<OnboardingPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  return { container, root };
}

/**
 * 6스텝을 처음부터 끝까지 **눌러서** 걸어간다. 제출은 하지 않는다.
 *
 * ## 왜
 *
 * 이 화면은 origin/main과 손으로 합쳤다(웹 8헌크, 모바일 12헌크). 타입 검사와 기존
 * 테스트는 전부 통과했지만, 그것들은 스텝을 **눌러본 적이 없다** — 스토어 단위 테스트는
 * `nextStep()`을 직접 부르고, 화면 테스트는 첫 프레임만 본다. 병합 사고가 실제로
 * 나타나는 자리(스텝이 안 넘어감 / 넘어갔는데 화면이 빔 / 두 스텝이 같은 걸 그림)는
 * 그 사이에 있다.
 *
 * ## 왜 브라우저가 아니라 여기인가
 *
 * 이 PC의 로컬 dev는 **운영 Supabase**를 가리킨다. 온보딩은 커플을 만들고 봉인하는
 * 화면이고, 봉인은 트리거가 영구 차단해 되돌릴 수 없다(2026-08-20에 실제로 한 번
 * 갈라졌다). 그래서 진짜 브라우저로 이 흐름을 끝까지 누르지 않는다. 여기서는 fetch를
 * 막아두고 **제출 직전까지만** 걷는다.
 *
 * ## 문구를 단언하지 않는 이유
 *
 * 스텝 제목을 적어두면 카피가 바뀔 때마다 여기가 깨진다. 그건 병합 회귀가 아니다.
 * 대신 "화면이 있는가 · 넘어가는가 · 매 스텝이 서로 다른가"만 본다.
 */
describe("온보딩 6스텝을 눌러서 끝까지 간다", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    act(() => {
      useOnboardingStore.getState().reset();
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("스텝마다 화면이 있고, 다음을 누르면 서로 다른 화면으로 넘어간다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          user: { id: "u1", email: "a@b.com" },
          profile: null,
          capabilities: { neutralPreparationSpace: false },
        }),
      })),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<OnboardingPage />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    /**
     * 각 스텝에서 사용자가 하는 최소 입력. 스토어로 넣는 이유는 이 테스트가 보려는
     * 것이 **입력 위젯**이 아니라 **스텝 전환**이기 때문이다. 위젯은 각자 자기
     * 테스트를 갖고 있다.
     */
    const fillFor: Record<number, () => void> = {
      1: () => useOnboardingStore.getState().setRole("bride"),
      2: () => useOnboardingStore.getState().setCoupleAction("create"),
      3: () => {},
      4: () => {},
    };

    const seen = new Set<string>();

    /** 이 화면이 **처음 보여주는** 내용의 양. 실측값은 아래 MIN_FRESH 주석 참고. */
    const freshCount = (): number => {
      let fresh = 0;
      for (const gram of contentGrams(container.textContent ?? "")) {
        if (!seen.has(gram)) fresh += 1;
      }
      return fresh;
    };
    const remember = (): void => {
      for (const gram of contentGrams(container.textContent ?? "")) seen.add(gram);
    };

    for (let step = 1; step <= 4; step += 1) {
      expect(useOnboardingStore.getState().currentStep).toBe(step);
      expect(
        freshCount(),
        `스텝 ${step}이 새로 보여주는 내용이 거의 없습니다. 본문이 안 그려졌거나 앞 스텝과 같은 것을 그리고 있습니다.`,
      ).toBeGreaterThan(MIN_FRESH);
      remember();

      act(() => fillFor[step]());
      await act(async () => {
        await Promise.resolve();
      });
      clickButtonLabelled(container, "다음");
    }

    // 스텝 5는 화면 두 개(단계 → 19항목)라 번호가 안 올라간다. 그것도 확인한다.
    expect(useOnboardingStore.getState().currentStep).toBe(5);
    expect(freshCount(), "단계 선택 화면이 안 그려졌습니다").toBeGreaterThan(MIN_FRESH);
    remember();

    clickButtonLabelled(container, "다음");
    expect(
      freshCount(),
      "단계 화면에서 다음을 눌렀는데 19항목 화면으로 넘어가지 않았습니다",
    ).toBeGreaterThan(MIN_FRESH);

    // 제출은 하지 않는다 — 운영 DB에 커플을 만드는 버튼이다.
    expect(useOnboardingStore.getState().currentStep).toBe(5);

    act(() => root.unmount());
  });
});

describe("단계를 안 골라도 되는 온보딩", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    act(() => {
      useOnboardingStore.getState().reset();
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("단계를 안 고른 채로도 19항목 화면까지 갈 수 있다", async () => {
    const { container, root } = await walkToChecklistWithoutStage();

    expect(useOnboardingStore.getState().preparationStage).toBeNull();
    // 여기서 막히면 단계는 아직 필수다 — 그러면 이 테스트가 지키려는 것 자체가 없다.
    clickButtonLabelled(container, "다음");

    const text = container.textContent ?? "";
    expect(text).toContain("이미 시작한 게 있으면");

    act(() => root.unmount());
  });

  it("고른 적 없는 선택을 고쳤다고 말하지 않는다", async () => {
    const { container, root } = await walkToChecklistWithoutStage();
    clickButtonLabelled(container, "다음");

    const text = container.textContent ?? "";
    for (const claim of CLAIMS_A_CHOICE) {
      expect(
        text,
        `단계를 안 골랐는데 화면이 "${claim}"이라고 말합니다. 안내문 갈래를 확인하세요.`,
      ).not.toContain(claim);
    }

    act(() => root.unmount());
  });

  // 아래 둘은 반대편이다. 위 두 개만 있으면 안내문을 통째로 지워도 초록이 된다.

  it("제안이 있는 단계를 고르면 그 제안을 근거로 말한다", async () => {
    const { container, root } = await walkToChecklistWithoutStage();

    act(() => {
      // `venue_hunting`은 `suggested`가 비어 있지 않다 — 제안 갈래로 가는 값이다.
      useOnboardingStore.getState().setPreparationStage("venue_hunting");
    });
    await act(async () => {
      await Promise.resolve();
    });

    clickButtonLabelled(container, "다음");

    const text = container.textContent ?? "";
    expect(text).toContain("여기서 확인한 내용만 저장돼요");

    act(() => root.unmount());
  });

  it("제안이 없는 단계를 골랐을 때는 고른 단계를 근거로 말해도 된다", async () => {
    // 이 갈래에서는 "고른 단계"가 **사실이다.** 위 두 테스트가 그 문구를 통째로
    // 금지하는 것처럼 읽히지 않도록 여기서 못을 박는다.
    const { container, root } = await walkToChecklistWithoutStage();

    act(() => {
      // `just_started`의 `suggested`는 비어 있다.
      useOnboardingStore.getState().setPreparationStage("just_started");
    });
    await act(async () => {
      await Promise.resolve();
    });

    clickButtonLabelled(container, "다음");

    const text = container.textContent ?? "";
    expect(text).toContain("고른 단계에는 미리 채울 항목이 없어서");

    act(() => root.unmount());
  });
});
