import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(() => null),
  createClient: vi.fn(),
  getUser: vi.fn(),
  setDemoCookies: vi.fn(() => true),
}));

vi.mock("@/lib/demoSession", () => ({ setDemoCookies: mocks.setDemoCookies }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitKey: vi.fn(() => "demo-start:test"),
}));

import { POST } from "../route";

/**
 * 로그인 없는 아모라 체험은 **기본이 닫힘**이다 (2026-08-27 파운더 결정).
 *
 * ## 왜 닫았나
 *
 * 운영 실측으로 체험 소스 대화가 **5주간 89턴 · $1.55** 뿐이었고 그 기간
 * 실사용자는 0에 가까웠다 — 데려온 사람의 증거가 없다. 반면 여는 비용은 분명하다:
 * 인증 없이 LLM 을 쓰는 경로가 `/price` 와 공시가 상세 1,053쪽에 링크로 걸리고,
 * 그 대화가 **실사용자와 같은 지갑**을 쓴다.
 *
 * ## 이 파일이 지키는 것
 *
 * 닫는 방법이 **버튼 숨기기 하나뿐이면 닫은 것이 아니다.** 이 주소는 POST 한 번이면
 * 닿는다. 그래서 버튼과 서버를 **둘 다** 잰다. 그리고 릴리스 평가기는 계속 통과해야
 * 한다 — 이 경로가 막혀 운영 대화 평가가 2026-08-03 이후 통째로 멈췄던 적이 있다.
 */

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..", "..", "..", "..");

function browserRequest(): Request {
  return new Request("https://hanbang.ai/api/demo/start", {
    method: "POST",
    headers: { origin: "https://hanbang.ai", "content-type": "application/json" },
  });
}

describe("측정기가 살아 있다", () => {
  beforeEach(() => {
    mocks.checkRateLimit.mockReturnValue(null);
    mocks.createClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.setDemoCookies.mockReturnValue(true);
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("켜면 같은 요청이 통과한다 — 아니면 아래 검사가 무엇을 막는지 알 수 없다", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_TRIAL_ENABLED", "true");
    const response = await POST(browserRequest());
    expect(response.status, "켠 상태에서도 막힌다면 스위치가 아니라 고장이다").toBe(200);
    expect(mocks.setDemoCookies).toHaveBeenCalled();
  });
});

describe("기본값은 닫힘이다", () => {
  beforeEach(() => {
    mocks.checkRateLimit.mockReturnValue(null);
    mocks.createClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.setDemoCookies.mockReturnValue(true);
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("변수를 아예 안 두면 브라우저 요청이 막힌다", async () => {
    const response = await POST(browserRequest());
    expect(response.status).toBe(404);
    expect(mocks.setDemoCookies, "세션 쿠키가 만들어졌다").not.toHaveBeenCalled();
  });

  it.each(["false", "", "1", "TRUE", "yes"])(
    "'%s' 는 켜는 값이 아니다",
    async (value) => {
      vi.stubEnv("NEXT_PUBLIC_DEMO_TRIAL_ENABLED", value);
      const response = await POST(browserRequest());
      expect(response.status, `"${value}" 로 체험이 열렸다`).toBe(404);
    },
  );

  it("막을 때 무엇을 하면 되는지 말한다", async () => {
    const response = await POST(browserRequest());
    const body = await response.json();
    expect(String(body.error), "막고서 다음 행동을 안 알려준다").toMatch(/가입/u);
  });

  it("Supabase 를 부르지도 않는다 — 막는 판단이 그보다 앞선다", async () => {
    await POST(browserRequest());
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("릴리스 평가기는 닫혀 있어도 통과한다", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("평가 토큰 검사가 스위치보다 먼저 판단된다", () => {
    /**
     * 값으로 재려면 64자 비밀값과 HMAC 토큰을 만들어야 하는데, 그건
     * `releaseEvaluationCanStart.test.ts` 가 이미 켜진 상태에서 한다.
     * 여기서는 **순서**만 지킨다 — 스위치 검사가 `evaluation` 을 먼저 계산해서
     * 그 결과를 존중하는 모양인지.
     */
    const source = readFileSync(
      join(REPO_ROOT, "apps", "web", "src", "app", "api", "demo", "start", "route.ts"),
      "utf8",
    );
    const evaluationLine = source.indexOf("const evaluation = isReleaseEvaluationRequest");
    const gateLine = source.indexOf("!evaluation && !isPublicDemoTrialEnabled()");
    expect(evaluationLine, "평가 판정이 사라졌다").toBeGreaterThan(0);
    expect(gateLine, "스위치가 평가 결과를 보지 않는다").toBeGreaterThan(evaluationLine);
  });
});

describe("버튼도 함께 사라진다", () => {
  /**
   * 서버만 막고 버튼을 남기면 사용자는 눌러 보고 실패를 겪는다. 그건 닫는 것이
   * 아니라 고장 낸 것이다. `StartDemoButton` 한 곳이 공개 표면 네 자리를 덮는다.
   */
  it("StartDemoButton 이 스위치를 본다", () => {
    const source = readFileSync(
      join(REPO_ROOT, "apps", "web", "src", "components", "demo", "StartDemoButton.tsx"),
      "utf8",
    );
    expect(source, "버튼이 스위치를 안 본다 — 서버만 막히고 버튼은 남는다")
      .toContain("if (!isPublicDemoTrialEnabled()) return null;");
  });

  it("로그인 화면의 체험 입구도 스위치를 본다", () => {
    const source = readFileSync(
      join(REPO_ROOT, "apps", "web", "src", "app", "(auth)", "login", "page.tsx"),
      "utf8",
    );
    expect(source, "로그인 화면에 체험 버튼이 남는다")
      .toContain("isPublicDemoTrialEnabled()");
  });

  it("`/demo` 설명 페이지는 닫지 않았다 — 비용 없이 같은 값을 준다", () => {
    const source = readFileSync(
      join(REPO_ROOT, "apps", "web", "src", "app", "demo", "page.tsx"),
      "utf8",
    );
    expect(source, "설명 페이지까지 같이 닫혔다").not.toContain("isPublicDemoTrialEnabled");
    expect(source).toContain("무엇을 하지 않는지");
  });
});
