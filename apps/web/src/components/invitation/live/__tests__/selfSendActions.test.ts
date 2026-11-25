import { afterEach, describe, expect, it, vi } from "vitest";

import {
  copyText,
  hallSearchHref,
  shareText,
  smsHref,
  smsPlatformOf,
  type SelfSendEnv,
} from "../selfSendActions";

/**
 * 직접 보내기(D-83 1단계) 단추 도우미. 공유 창은 누른 순간에만 열리므로 기다리기 전에 부르는지, 닫은 것(취소)과
 * 실패를 가르는지, 클립보드가 막히면 옛 복사 명령까지 해 보는지, 문자 앱 주소가 글을 한 칸에 온전히 담는지 잰다.
 */

const TEXT = "하나 웨딩홀께\n\n안녕하세요. 12월 5일 상담 되나요? 두 사람 & 부모님\n\n민지와 준호 드림";

type Share = (data: ShareData) => Promise<void>;
type WriteText = (text: string) => Promise<void>;
type ExecCopy = (text: string) => boolean;

function abortError(): DOMException {
  return new DOMException("닫았어요", "AbortError");
}

function notAllowed(): DOMException {
  return new DOMException("허용되지 않았어요", "NotAllowedError");
}

describe("shareText", () => {
  it("공유 창은 부른 그 자리에서(기다리기 전에) 그 글로 연다", () => {
    const share = vi.fn<Share>(async () => undefined);
    const started = shareText(TEXT, { share });
    expect(share).toHaveBeenCalledExactlyOnceWith({ text: TEXT });
    expect(started.sheetOpened).toBe(true);
  });

  it("끝까지 가면 shared 이고 클립보드에는 쓰지 않는다", async () => {
    const writeText = vi.fn<WriteText>(async () => undefined);
    const started = shareText(TEXT, { share: async () => undefined, writeText });
    expect(await started.outcome).toBe("shared");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("사람이 닫으면(AbortError) cancelled 이고 복사하지 않는다", async () => {
    const writeText = vi.fn<WriteText>(async () => undefined);
    const started = shareText(TEXT, { share: async () => Promise.reject(abortError()), writeText });
    expect(await started.outcome).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("다른 까닭으로 실패하면 복사로 넘어간다", async () => {
    const writeText = vi.fn<WriteText>(async () => undefined);
    const started = shareText(TEXT, { share: async () => Promise.reject(notAllowed()), writeText });
    expect(await started.outcome).toBe("copied");
    expect(writeText).toHaveBeenCalledExactlyOnceWith(TEXT);
  });

  it("공유 창이 곧바로 던지면 연 것이 아니고 복사로 넘어간다", async () => {
    const env: SelfSendEnv = {
      share: () => {
        throw new TypeError("지원하지 않아요");
      },
      writeText: async () => undefined,
    };
    const started = shareText(TEXT, env);
    expect(started.sheetOpened).toBe(false);
    expect(await started.outcome).toBe("copied");
  });

  it("공유 창이 없거나 canShare 가 거절·던지면 열지 않고 복사한다", async () => {
    const share = vi.fn<Share>(async () => undefined);
    const writeText = vi.fn<WriteText>(async () => undefined);
    for (const env of [
      { writeText },
      { share, canShare: () => false, writeText },
      {
        share,
        canShare: () => {
          throw new TypeError("모르는 꼴");
        },
        writeText,
      },
    ] satisfies SelfSendEnv[]) {
      const started = shareText(TEXT, env);
      expect(started.sheetOpened).toBe(false);
      expect(await started.outcome).toBe("copied");
    }
    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledTimes(3);
  });
});

describe("copyText", () => {
  it("클립보드에 쓰면 copied 이고 옛 복사 명령은 부르지 않는다", async () => {
    const execCopy = vi.fn<ExecCopy>(() => true);
    expect(await copyText(TEXT, { writeText: async () => undefined, execCopy })).toBe("copied");
    expect(execCopy).not.toHaveBeenCalled();
  });

  it("클립보드가 거절하면 옛 복사 명령으로 한 번 더 해 본다", async () => {
    const execCopy = vi.fn<ExecCopy>(() => true);
    expect(await copyText(TEXT, { writeText: async () => Promise.reject(notAllowed()), execCopy })).toBe("copied");
    expect(execCopy).toHaveBeenCalledExactlyOnceWith(TEXT);
  });

  it("클립보드가 없으면 기다리지 않고 곧바로 옛 복사 명령을 부른다(누른 순간 안에서만 되는 브라우저가 있다)", async () => {
    const execCopy = vi.fn<ExecCopy>(() => true);
    const pending = copyText(TEXT, { execCopy });
    expect(execCopy).toHaveBeenCalledExactlyOnceWith(TEXT);
    expect(await pending).toBe("copied");
  });

  it("둘 다 안 되면 copyFailed 다", async () => {
    expect(await copyText(TEXT, { writeText: async () => Promise.reject(notAllowed()), execCopy: () => false })).toBe("copyFailed");
    expect(await copyText(TEXT, {})).toBe("copyFailed");
  });
});

describe("브라우저의 옛 복사 명령", () => {
  afterEach(() => {
    Reflect.deleteProperty(window.navigator, "clipboard");
    Reflect.deleteProperty(document, "execCommand");
    document.body.innerHTML = "";
  });

  it("보이지 않는 글 칸에 글을 넣어 복사하고, 그 칸을 지우고, 누르던 곳으로 초점을 돌려 놓는다", async () => {
    const before = document.createElement("input");
    document.body.appendChild(before);
    before.focus();
    let copied = "";
    const execCommand = vi.fn<(command: string) => boolean>(() => {
      const area = document.querySelector("textarea");
      copied = area?.value ?? "";
      // 브라우저는 고른 글 칸으로 초점을 옮기기도 한다(jsdom 의 select 는 옮기지 않는다). 그래도 누르던 곳으로 돌아와야 한다.
      area?.focus();
      return true;
    });
    Object.defineProperty(document, "execCommand", { configurable: true, writable: true, value: execCommand });

    expect(await copyText(TEXT)).toBe("copied");
    expect(execCommand).toHaveBeenCalledExactlyOnceWith("copy");
    expect(copied).toBe(TEXT);
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
    expect(document.activeElement).toBe(before);
  });

  it("옛 복사 명령이 던지면 copyFailed 이고 글 칸은 남지 않는다", async () => {
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("지원하지 않아요");
      },
    });
    expect(await copyText(TEXT)).toBe("copyFailed");
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });
});

describe("smsHref · smsPlatformOf · hallSearchHref", () => {
  it("문자 앱 주소는 받는 번호 없이 글만 담고, 줄바꿈·물음표·& 까지 한 칸 안에 부호로 담는다", () => {
    const encoded = encodeURIComponent(TEXT);
    expect(smsHref(TEXT, "android")).toBe(`sms:?body=${encoded}`);
    expect(smsHref(TEXT, "other")).toBe(`sms:?body=${encoded}`);
    expect(smsHref(TEXT, "ios")).toBe(`sms:&body=${encoded}`);
    expect(encoded).not.toMatch(/[\n?&]/);
    expect(decodeURIComponent(smsHref(TEXT, "ios").slice("sms:&body=".length))).toBe(TEXT);
  });

  it("iPhone·iPad·터치되는 맥(iPadOS)은 iOS, 안드로이드는 android, 나머지는 other 다", () => {
    expect(smsPlatformOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15")).toBe("ios");
    expect(smsPlatformOf("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15")).toBe("ios");
    expect(smsPlatformOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 5)).toBe("ios");
    expect(smsPlatformOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 0)).toBe("other");
    expect(smsPlatformOf("Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 Chrome/131.0 Mobile")).toBe("android");
    expect(smsPlatformOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0")).toBe("other");
  });

  it("찾아보기는 웨딩홀 이름으로 찾는 네이버 검색 주소다", () => {
    expect(hallSearchHref("하나 웨딩홀 & 컨벤션")).toBe(
      `https://m.search.naver.com/search.naver?query=${encodeURIComponent("하나 웨딩홀 & 컨벤션")}`,
    );
  });
});
