import { afterEach, describe, expect, it, vi } from "vitest";
import { browserShareEnv, isRealClipboardCopy, sendLink, sentEventOf, type ShareEnv, type ShareOutcome } from "./shareActions";

const URL_TEXT = "https://example.test/wedding-code#v=example&a=abc";

function abortError(): DOMException {
  return new DOMException("사용자가 닫았어요", "AbortError");
}

function notAllowed(): DOMException {
  return new DOMException("허용되지 않았어요", "NotAllowedError");
}

describe("sendLink: 공유 창 우선", () => {
  it("공유 창이 끝까지 가면 shared 이고 클립보드에는 쓰지 않는다", async () => {
    const share = vi.fn(async () => undefined);
    const writeText = vi.fn(async () => undefined);
    const outcome = await sendLink({ url: URL_TEXT, text: "같이 해 봐요", title: "제목" }, { share, writeText });
    expect(outcome).toEqual({ kind: "shared" });
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ url: URL_TEXT, text: "같이 해 봐요", title: "제목" });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("보낼 말과 제목이 비어 있으면 주소만 넘긴다", async () => {
    const share = vi.fn(async () => undefined);
    await sendLink({ url: URL_TEXT, text: "   ", title: "" }, { share });
    expect(share).toHaveBeenCalledWith({ url: URL_TEXT });
  });

  it("공유 창은 첫 await 이전에 부른다(사용자 동작 직후에만 열리기 때문이다)", async () => {
    const calls: string[] = [];
    const share = vi.fn(async () => {
      calls.push("share");
    });
    const pending = sendLink({ url: URL_TEXT }, { share });
    calls.push("after-call");
    await pending;
    expect(calls).toEqual(["share", "after-call"]);
  });

  it("canShare 가 거절하면 공유 창을 열지 않고 클립보드로 간다", async () => {
    const share = vi.fn(async () => undefined);
    const canShare = vi.fn(() => false);
    const writeText = vi.fn(async () => undefined);
    const outcome = await sendLink({ url: URL_TEXT }, { share, canShare, writeText });
    expect(outcome).toEqual({ kind: "copied" });
    expect(share).not.toHaveBeenCalled();
    expect(canShare).toHaveBeenCalledTimes(1);
  });

  it("canShare 가 던지면 공유 창이 안 되는 것으로 본다", async () => {
    const share = vi.fn(async () => undefined);
    const canShare = vi.fn(() => {
      throw new TypeError("지원하지 않아요");
    });
    const outcome = await sendLink({ url: URL_TEXT }, { share, canShare });
    expect(share).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: "revealed", reason: "unsupported" });
  });

  it("사람이 공유 창을 닫으면 cancelled 이고 클립보드에도 쓰지 않으며 주소 칸도 열지 않는다", async () => {
    const share = vi.fn(async () => {
      throw abortError();
    });
    const writeText = vi.fn(async () => undefined);
    const outcome = await sendLink({ url: URL_TEXT }, { share, writeText });
    expect(outcome).toEqual({ kind: "cancelled" });
    expect(writeText).not.toHaveBeenCalled();
    expect(sentEventOf(outcome)).toBeNull();
  });
});

describe("sendLink: 클립보드", () => {
  it("공유 창이 없으면 보낼 말과 주소를 줄을 바꿔 클립보드에 쓴다", async () => {
    const writeText = vi.fn(async () => undefined);
    const outcome = await sendLink({ url: URL_TEXT, text: "  같이 해 봐요  " }, { writeText });
    expect(outcome).toEqual({ kind: "copied" });
    expect(writeText).toHaveBeenCalledWith(`같이 해 봐요\n${URL_TEXT}`);
  });

  it("보낼 말이 비면 주소만 쓴다", async () => {
    const writeText = vi.fn(async () => undefined);
    await sendLink({ url: URL_TEXT, text: "" }, { writeText });
    expect(writeText).toHaveBeenCalledWith(URL_TEXT);
  });

  it("공유 창이 다른 까닭으로 실패하면 클립보드로 넘어간다", async () => {
    const share = vi.fn(async () => {
      throw notAllowed();
    });
    const writeText = vi.fn(async () => undefined);
    const outcome = await sendLink({ url: URL_TEXT }, { share, writeText });
    expect(outcome).toEqual({ kind: "copied" });
    expect(share).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("공유 창이 동기로 던져도 클립보드로 넘어간다", async () => {
    const share = vi.fn(() => {
      throw new TypeError("잘못된 자료예요");
    }) as unknown as NonNullable<ShareEnv["share"]>;
    const writeText = vi.fn(async () => undefined);
    expect(await sendLink({ url: URL_TEXT }, { share, writeText })).toEqual({ kind: "copied" });
  });
});

describe("sendLink: 주소 칸", () => {
  it("둘 다 없으면 revealed(unsupported)", async () => {
    expect(await sendLink({ url: URL_TEXT }, {})).toEqual({ kind: "revealed", reason: "unsupported" });
  });

  it("공유 창이 실패하고 클립보드도 거절하면 revealed(failed)", async () => {
    const share = vi.fn(async () => {
      throw notAllowed();
    });
    const writeText = vi.fn(async () => {
      throw notAllowed();
    });
    expect(await sendLink({ url: URL_TEXT }, { share, writeText })).toEqual({ kind: "revealed", reason: "failed" });
  });

  it("클립보드만 있는데 거절하면 revealed(failed)", async () => {
    const writeText = vi.fn(async () => {
      throw notAllowed();
    });
    expect(await sendLink({ url: URL_TEXT }, { writeText })).toEqual({ kind: "revealed", reason: "failed" });
  });

  it("주소가 비어 있으면 던진다", async () => {
    await expect(sendLink({ url: "" }, {})).rejects.toBeInstanceOf(RangeError);
  });
});

describe("사건과 통계 판정", () => {
  const outcomes: readonly ShareOutcome[] = [
    { kind: "shared" },
    { kind: "copied" },
    { kind: "revealed", reason: "unsupported" },
    { kind: "revealed", reason: "failed" },
    { kind: "cancelled" },
  ];

  it("취소만 사건이 아니다", () => {
    expect(outcomes.map((outcome) => sentEventOf(outcome)?.kind ?? null)).toEqual(["shared", "copied", "revealed", "revealed", null]);
  });

  it("실제 클립보드 복사는 copied 하나뿐이다(공유 창을 마친 것과 주소 칸을 연 것은 아니다)", () => {
    expect(outcomes.filter((outcome) => isRealClipboardCopy(outcome)).map((outcome) => outcome.kind)).toEqual(["copied"]);
    expect(isRealClipboardCopy({ kind: "shared" })).toBe(false);
    expect(isRealClipboardCopy({ kind: "revealed" })).toBe(false);
    expect(isRealClipboardCopy({ kind: "copied" })).toBe(true);
  });
});

describe("browserShareEnv: 부를 때마다 브라우저 객체를 읽는다", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "share");
    Reflect.deleteProperty(navigator, "canShare");
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("jsdom 처럼 아무것도 없으면 빈 환경이다", () => {
    const env = browserShareEnv();
    expect(env.share).toBeUndefined();
    expect(env.canShare).toBeUndefined();
    expect(env.writeText).toBeUndefined();
  });

  it("가짜 navigator.share 와 clipboard 를 읽고 navigator 를 this 로 부른다", async () => {
    const share = vi.fn(async () => undefined);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const env = browserShareEnv();
    expect(env.share).toBeTypeOf("function");
    expect(env.writeText).toBeTypeOf("function");
    await env.share?.({ url: URL_TEXT });
    expect(share.mock.contexts[0]).toBe(navigator);
    await env.writeText?.("글");
    expect(writeText).toHaveBeenCalledWith("글");
  });

  it("환경을 넘기지 않으면 sendLink 가 지금 navigator 를 쓴다", async () => {
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    expect(await sendLink({ url: URL_TEXT })).toEqual({ kind: "shared" });
    expect(share).toHaveBeenCalledTimes(1);
  });
});
