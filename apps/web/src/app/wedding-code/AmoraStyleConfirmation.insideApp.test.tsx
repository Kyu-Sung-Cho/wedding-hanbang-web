// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CURRENT_WEDDING_CODE_SCENE_CONFIG } from "@/lib/weddingCode/scene/config";
import { MOBILE_WEB_API_NONCE_PROPERTY } from "@/lib/mobile/mobileAuthenticatedFetch";
import WeddingCodeV06Client from "./WeddingCodeV06Client";
import { cardErrorText } from "./AmoraStyleConfirmation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const NONCE = "8f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";

/**
 * **앱 웹뷰에서는 끝을 못 보는 단락을 보여주지 않는다.**
 *
 * 2026-09-16 에 앱에 웨딩코드 입구를 넣으면서 잡혔다. 결과 화면 끝의 아모라 단락은
 * 로그인하지 않은 사람에게 "로그인하고 고른 내용 확인하기" 버튼과
 * `/settings/amora-style` 링크를 준다. 앱 웹뷰에는 앱의 세션이 없어서
 *
 *   - **앱에 이미 로그인한 사람도** 로그아웃으로 보이고,
 *   - 그 버튼을 누르면 앱이 로그인 필요 경로를 네이티브 화면으로 되돌리는데
 *     (`apps/mobile/app/webview.tsx` 의 `WEB_TO_NATIVE`), 고른 방식을 담은 봉투는
 *     웹뷰에 남아 네이티브가 읽지 못하고, 보던 결과 화면까지 사라진다.
 *
 * 그래서 앱에서는 이 단락을 내린다. 코드·비교·링크 보내기는 그대로 된다.
 *
 * 이 검사는 소스에 특정 문자열이 있는지 묻지 않는다. **실제로 모든 장면을 답해 결과를
 * 띄운 뒤** 그 단락이 DOM 에 있는지 본다 — 조건을 다른 곳으로 옮겨도 계속 잰다.
 */
describe("WeddingCode 아모라 단락 · 앱 웹뷰", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ user: null }), { status: 200 }),
    );
    window.history.replaceState(null, "", "/wedding-code");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    delete (window as { ReactNativeWebView?: unknown }).ReactNativeWebView;
    delete window[MOBILE_WEB_API_NONCE_PROPERTY];
    vi.restoreAllMocks();
  });

  function markAsInsideApp(): void {
    // 앱이 문서보다 먼저 심는 두 가지. 웹뷰 다리와 그 다리의 nonce.
    (window as { ReactNativeWebView?: unknown }).ReactNativeWebView = {
      postMessage: () => undefined,
    };
    window[MOBILE_WEB_API_NONCE_PROPERTY] = NONCE;
  }

  async function answerEveryScene(): Promise<void> {
    const config = CURRENT_WEDDING_CODE_SCENE_CONFIG;
    await act(async () =>
      root.render(
        <WeddingCodeV06Client
          shareOrigin="https://hanbang.ai"
          version={config.version}
          partnerAnswers={null}
          partnerCode={null}
          bothCodes={null}
        />,
      ),
    );
    const clickText = async (text: string) => {
      const button = [...container.querySelectorAll("button")].find((candidate) =>
        candidate.textContent?.includes(text),
      );
      expect(button).toBeDefined();
      await act(async () => button!.click());
    };
    await clickText("시작하기");
    for (const question of config.questions) {
      if (question.key === "D4") {
        await act(async () =>
          container.querySelector<HTMLButtonElement>('[data-option="B"]')!.click(),
        );
        await clickText("다음 문항");
      } else {
        await clickText("이 장면은 건너뛸게요");
      }
    }
    expect(container.querySelector('[data-result="solo"]')).not.toBeNull();
  }

  it("브라우저에서는 그대로 보여준다", async () => {
    await answerEveryScene();
    expect(container.querySelector("[data-amora-proposals]")).not.toBeNull();
    expect(container.textContent).toContain("로그인하고 고른 내용 확인하기");
  });

  it("앱 웹뷰에서는 단락도 링크도 내린다", async () => {
    markAsInsideApp();
    await answerEveryScene();

    expect(container.querySelector("[data-amora-proposals]")).toBeNull();
    expect(container.textContent).not.toContain("로그인하고 고른 내용 확인하기");
    // 앱이 네이티브 설정으로 되돌려 버리는 링크가 남아 있으면 안 된다.
    expect(container.querySelector('a[href^="/settings"]')).toBeNull();
  });

  it("앱 웹뷰에서도 결과와 링크 보내기는 그대로다", async () => {
    markAsInsideApp();
    await answerEveryScene();

    // 입구를 넣은 이유 자체가 이것이다. 단락 하나를 내리느라 본래 기능을 깨면 안 된다.
    expect(container.querySelector('[data-wedding-code="···A"]')).not.toBeNull();
    // 판 이름은 현재 판을 따라간다(판을 올릴 때마다 이 줄이 깨지지 않게).
    const shareUrl = container.querySelector("[data-share-url]")?.getAttribute("data-share-url") ?? "";
    expect(shareUrl.endsWith(`#v=${CURRENT_WEDDING_CODE_SCENE_CONFIG.version}&a=${"-".repeat(18)}B-`), shareUrl).toBe(true);
  });

  it("웹뷰 다리만 있고 앱이 심은 표식이 없으면 앱으로 보지 않는다", async () => {
    // `window.ReactNativeWebView` 는 우리 앱이 아닌 다른 앱의 웹뷰에도 있다.
    // 우리 앱이라는 증거는 문서보다 먼저 심는 nonce 뿐이다. 그것이 없으면
    // 브라우저와 똑같이 다룬다 — 남의 웹뷰가 우리 화면을 깎아내지 못하게.
    (window as { ReactNativeWebView?: unknown }).ReactNativeWebView = {
      postMessage: () => undefined,
    };
    await answerEveryScene();
    expect(container.querySelector("[data-amora-proposals]")).not.toBeNull();
  });

  it("남의 iframe 이 앱인 척해도 내리지 않는다", async () => {
    // 표식은 최상위 문서에만 들어온다. 서브프레임에서 흉내내는 값을 믿으면,
    // 웨딩코드를 품은 아무 페이지나 이 단락을 지울 수 있게 된다.
    markAsInsideApp();
    const top = {} as Window;
    const original = Object.getOwnPropertyDescriptor(window, "top");
    Object.defineProperty(window, "top", { value: top, configurable: true });
    try {
      await answerEveryScene();
      expect(container.querySelector("[data-amora-proposals]")).not.toBeNull();
    } finally {
      if (original) Object.defineProperty(window, "top", original);
      else delete (window as unknown as Record<string, unknown>).top;
    }
  });
});

describe("아모라 설정 카드의 오류 문장", () => {
  it("서버의 합니다체·영문 오류와 속을 드러내는 말은 카드 말투로 바꾼다", () => {
    const friendly = "아모라 설정을 불러오거나 저장하지 못했어요. 잠시 뒤 다시 해 주세요.";
    for (const raw of ["인증이 필요합니다.", "서버 오류", "요청 본문이 너무 큽니다", "Failed to fetch", "저장된 도움 방식을 안전하게 읽지 못했어요."]) {
      expect(cardErrorText(raw), raw).toBe(friendly);
    }
  });

  it("해요체로 쓴 안내는 그대로 보여준다", () => {
    const message = "다른 기기에서 설정이 바뀌었어요. 다시 불러온 뒤 골라 주세요.";
    expect(cardErrorText(message)).toBe(message);
  });
});
