import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 이 파일이 지키는 계약:
//   "운영에서 500 이 나면 우리에게 알려진다."
// 그 통로는 `log.error` -> `Sentry.captureException` 하나뿐이므로, 그 연결이
// 끊기면 라우트 113 개의 catch 블록이 전부 조용해진다. 그래서 여기서 못 박는다.

const captureException = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

async function loadLog(nodeEnv: string) {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  return (await import("../log")).log;
}

describe("log", () => {
  beforeEach(() => {
    captureException.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("운영에서 error 는 Sentry 로 간다", async () => {
    const log = await loadLog("production");
    const cause = new Error("boom");

    log.error("[api/chat] POST 실패", cause);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][0]).toBe(cause);
  });

  it("운영에서 error 는 어느 경로인지 tag 로 남긴다", async () => {
    const log = await loadLog("production");

    log.error("[api/chat] POST 실패", new Error("boom"));

    const options = captureException.mock.calls[0][1] as {
      tags?: Record<string, string>;
    };
    expect(options.tags?.log_scope).toBe("[api/chat] POST 실패");
  });

  it("payload 는 Sentry 로 보내지 않는다 (extra 자리를 비운다)", async () => {
    const log = await loadLog("production");

    log.error("[api/money POST] supabase", {
      message: "duplicate key value violates unique constraint",
      hint: "예비신부수민 님의 항목",
    });

    const options = captureException.mock.calls[0][1] as Record<string, unknown>;
    expect(options).not.toHaveProperty("extra");
    expect(JSON.stringify(options)).not.toContain("예비신부수민");
  });

  it("tag 에 섞인 식별자는 지운다", async () => {
    const log = await loadLog("production");

    log.error("[api/auth] 초대 실패 person@example.com https://hanbang.ai/x", new Error("e"));

    const tag = (captureException.mock.calls[0][1] as { tags: Record<string, string> })
      .tags.log_scope;
    expect(tag).not.toContain("person@example.com");
    expect(tag).not.toContain("https://hanbang.ai");
  });

  it("Error 가 아닌 payload 면 msg 가 예외 문구가 된다", async () => {
    const log = await loadLog("production");

    log.error("[api/money GET] supabase", { code: "42501" });

    const captured = captureException.mock.calls[0][0] as Error;
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).toBe("[api/money GET] supabase");
  });

  it("서버에서는 콘솔 줄도 남긴다 (Vercel 런타임 로그)", async () => {
    vi.stubGlobal("window", undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = await loadLog("production");

    log.error("[api/events] insert 실패", new Error("boom"));

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("브라우저에서는 콘솔에 내부 오류를 찍지 않는다", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = await loadLog("production");
    expect(typeof window).toBe("object");

    log.error("[client] 실패", new Error("boom"));

    expect(consoleError).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("개발에서는 Sentry 로 보내지 않는다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const log = await loadLog("development");

    log.error("[dev] 실패", new Error("boom"));

    expect(captureException).not.toHaveBeenCalled();
  });

  // warn/info/debug 가 운영에서 no-op 이라는 사실을 못 박는다. 이걸 모르면
  // "운영에서 보고 싶은 것"을 warn 에 넣고 사라지는 사고가 난다.
  it("운영에서 warn·info·debug 는 아무 일도 하지 않는다", async () => {
    vi.stubGlobal("window", undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const consoleDebug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const log = await loadLog("production");

    log.warn("무시됨", { a: 1 });
    log.info("무시됨", { a: 1 });
    log.debug("무시됨", { a: 1 });

    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleInfo).not.toHaveBeenCalled();
    expect(consoleDebug).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });
});

describe("JSON 파싱 실패는 입력을 Sentry 로 실어 나르지 않는다", () => {
  beforeEach(() => { captureException.mockClear(); });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("서버 콘솔에도 파싱 입력과 임의 payload를 남기지 않는다", async () => {
    vi.stubGlobal("window", undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = await loadLog("production");
    let thrown: unknown;
    try {
      JSON.parse("비공개 가족 예산 고민");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SyntaxError);
    log.error("[api/money] POST 실패", thrown);
    log.error("[api/money] DB 실패", { details: "비공개 가족 예산 고민" });

    expect(consoleError).toHaveBeenCalledTimes(2);
    for (const [scope, error] of consoleError.mock.calls) {
      expect(error).toBeInstanceOf(Error);
      expect(`${scope} ${String(error)} ${(error as Error).stack}`)
        .not.toContain("비공개 가족 예산 고민");
    }
    expect(consoleError.mock.calls[0][1]).toBe(captureException.mock.calls[0][0]);
    expect(consoleError.mock.calls[0][1].message).toContain("SyntaxError");
  });

  it("SyntaxError 는 원본 대신 종류만 남긴다", async () => {
    const log = await loadLog("production");
    let thrown: unknown;
    try {
      JSON.parse("예비신부입니다 예산은 5천만원");
    } catch (error) {
      thrown = error;
    }
    // 원본 메시지에 사용자 입력이 실제로 들어 있어야 이 검사에 뜻이 있다.
    expect((thrown as Error).message).toContain("예비신부");

    log.error("[api/money] POST 실패", thrown);

    const captured = captureException.mock.calls[0][0] as Error;
    expect(captured.message).not.toContain("예비신부");
    expect(captured.message).toContain("SyntaxError");
    expect(captured.message).toContain("[api/money] POST 실패");
  });

  it("보통 오류는 그대로 넘긴다", async () => {
    const log = await loadLog("production");
    const original = new Error("connection reset");
    log.error("[api/chat] 실패", original);
    expect(captureException.mock.calls[0][0]).toBe(original);
  });
});
