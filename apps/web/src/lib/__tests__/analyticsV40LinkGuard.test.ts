import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WEDDING_CODE_V31_VERSION } from "@/constants/weddingCodeV31";
import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";

/**
 * 감사 A34(통계 부분): v4 답 링크를 연 사람의 첫 화면은 서버가 주소의 # 뒤를 못 봐서 v3.1 이었다.
 * 그 v3.1 화면의 조회 이벤트(`wedding_code_intro_viewed`, version v3.1-preferences)가 v4 로 바뀌기 전에 나가 시험 통계에 v3.1 조회가 한 건씩 더 잡혔다.
 * 주소 해시에 v4 표지가 있는데 이벤트의 판이 v4 가 아니면 보내지 않는다.
 */
describe("v4 링크 해시와 어긋난 웨딩코드 통계는 보내지 않는다", () => {
  const capture = vi.fn();
  const V4_HASH = `#v=${WEDDING_CODE_V40_VERSION}&a=0000000000000000000000000000000000000000000000000000000000000000000000`;

  beforeEach(() => {
    vi.resetModules();
    capture.mockReset();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_synthetic_v40_link_guard_test");
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
      callback();
      return 1;
    });
    vi.doMock("posthog-js", () => ({ default: { init: vi.fn(), capture } }));
    window.history.replaceState({}, "", "/wedding-code");
  });

  afterEach(() => {
    vi.doUnmock("posthog-js");
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    window.history.replaceState({}, "", "/");
  });

  async function send(hash: string, event: "wedding_code_intro_viewed" | "wedding_code_started", version: string) {
    window.history.replaceState({}, "", `/wedding-code${hash}`);
    const analytics = await import("../analytics");
    await analytics.loadPostHog();
    analytics.captureWeddingCodeEvent(event, { version });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("v4 링크의 해시가 있는데 이벤트의 판이 v3.1 이면 보내지 않는다(받는 사람의 첫 화면)", async () => {
    await send(V4_HASH, "wedding_code_intro_viewed", WEDDING_CODE_V31_VERSION);
    expect(capture).not.toHaveBeenCalled();
  });

  it("해시 전체가 퍼센트 인코딩되어 와도 같다", async () => {
    await send(`#${encodeURIComponent(V4_HASH.slice(1))}`, "wedding_code_intro_viewed", WEDDING_CODE_V31_VERSION);
    expect(capture).not.toHaveBeenCalled();
  });

  it("같은 해시에서 이벤트의 판이 v4 이면 보낸다", async () => {
    await send(V4_HASH, "wedding_code_intro_viewed", WEDDING_CODE_V40_VERSION);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][0]).toBe("wedding_code_intro_viewed");
  });

  it("해시가 없거나 v3.1 링크이면 v3.1 이벤트를 그대로 보낸다", async () => {
    await send("", "wedding_code_intro_viewed", WEDDING_CODE_V31_VERSION);
    expect(capture).toHaveBeenCalledTimes(1);
    capture.mockReset();
    vi.resetModules();
    await send("#v=v3.1-preferences&a=31_5555555555555555555555555_c00.c00.c00.c00.c02.c00_p_-_p", "wedding_code_started", WEDDING_CODE_V31_VERSION);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("판 이름 값이 통계 파일의 표지와 같다(큰 문구 자료를 초기 번들에 싣지 않으려고 값을 따로 적어 둔 것)", async () => {
    const { eventContradictsV40LinkHash } = await import("../analytics");
    expect(eventContradictsV40LinkHash(`#v=${WEDDING_CODE_V40_VERSION}`, WEDDING_CODE_V31_VERSION)).toBe(true);
    expect(eventContradictsV40LinkHash(`#v=${WEDDING_CODE_V40_VERSION}`, WEDDING_CODE_V40_VERSION)).toBe(false);
    expect(eventContradictsV40LinkHash("", WEDDING_CODE_V31_VERSION)).toBe(false);
    // 판 속성이 아예 없는 이벤트도 v4 링크 해시에서는 v4 것이 아니다.
    expect(eventContradictsV40LinkHash(`#v=${WEDDING_CODE_V40_VERSION}`, undefined)).toBe(true);
  });
});
