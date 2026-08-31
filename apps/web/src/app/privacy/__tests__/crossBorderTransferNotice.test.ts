// @vitest-environment node

/**
 * 국외 이전 고지가 실제로 화면에 있는가.
 *
 * ## 무엇이 있었나 (2026-08-28 감사)
 *
 * 처리방침 제5조 말미에 이렇게 적혀 있었다:
 *
 *     "…국외 이전 고지는 준비 중이며 확정되는 대로 이 방침에 반영합니다."
 *
 * 그런데 **이전은 이미 일어나고 있었다.** 운영 응답의 CSP 에
 * `us.i.posthog.com`·`ingest.us.sentry.io` 가 그대로 있고, 운영 데이터베이스는
 * 인도 리전(`ap-south-1`)이다. 준비 중이라고 적어 둔 채 이전하는 것은
 * 개인정보보호법 제28조의8 이 요구하는 **사전** 고지가 아니다.
 *
 * ## 이 검사의 구조적 구멍 (2026-08-31)
 *
 * 첫 판은 **파일 안의 두 표를 서로 대조할 뿐**이었다. 그래서 양쪽에 다 없는
 * 수탁사는 영원히 초록불이었다 — 실제로 Cloudflare 가 그 상태였다. 이용자 요청은
 * 이미 Cloudflare 를 지나가는데(운영 Supabase 응답의 `Server: cloudflare` 와
 * `CF-RAY`, 그리고 봇 확인 위젯의 `challenges.cloudflare.com`) 두 표 어디에도
 * 없으니 대조할 것이 없었다.
 *
 * 그래서 **바깥에서 유도한 목록**을 하나 더 댄다. `next.config.ts` 의 CSP 가
 * 브라우저에게 허용한 외부 호스트가 그 목록이다. 새 외부 서비스를 붙이려면 거의
 * 반드시 CSP 에 호스트를 더해야 하므로, 고지를 빠뜨리면 여기서 걸린다.
 *
 * ### 유도 목록이 못 잡는 것
 *
 * **서버가 직접 부르는 곳은 CSP 에 안 나온다.** OpenAI·Resend·Vercel 이 그렇다.
 * 그 셋은 아래 `SERVER_SIDE_PROCESSORS` 로 계속 손으로 고정한다. 리라이트 목적지
 * (`/sai` → `sai-mu-nine.vercel.app`)도 CSP 호스트가 아니라 이 유도에 안 잡힌다 —
 * 아직 분류하지 않았고, 분류하려면 그 앱이 무엇을 받는지부터 확인해야 한다.
 *
 * ## 소스는 읽고, 설정은 **돌린다**
 *
 * 방침 문구는 파일을 읽어서 본다(화면에 나가는 문구만 — 주석은 "무엇을 지웠는지"
 * 설명해야 하므로 옛 문장을 인용할 수 있어야 한다. 이 저장소에서 주석을 UI 문구로
 * 세어 잘못된 빨간불이 난 이력이 있다). 반면 CSP 는 정규식으로 긁지 않고
 * `next.config.ts` 를 **import 해서 `headers()` 를 실제로 호출한다** — 이 저장소는
 * 주석 제거기가 "https://" 의 슬래시 둘을 잘라 엉뚱하게 실패한 적이 있다.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import nextConfig from "../../../../next.config";

const source = readFileSync(
  resolve(process.cwd(), "src/app/privacy/page.tsx"),
  "utf8",
);

/**
 * 주석을 걷어낸 소스. JSX 주석과 블록 주석 둘 다 지운다.
 * 덜 지우면 잘못된 빨간불이고, 더 지우면 잘못된 초록불이다.
 */
const visible = source
  .replace(/\{\/\*[\s\S]*?\*\/\}/gu, "")
  .replace(/\/\*[\s\S]*?\*\//gu, "");

/**
 * 두 표의 `<tbody>` 만 떼어 낸다.
 *
 * 문서 전체에서 이름을 세면 **표 바깥에 남은 같은 문자열이 대신 답한다.** 이 변경을
 * 만들면서 실측했다 — 부칙에 "Cloudflare, Inc. 추가"라고 한 줄 적었더니 문서 전체
 * 개수가 3 이 되어, 국외 이전표에서 그 행을 통째로 지워도 2 가 남아 통과했다.
 * 그 부칙 문장은 다른 이유로 되돌렸지만 함정은 그대로다 — 제1조에는 지금도
 * "Supabase" 가 한 번 더 나온다. 그래서 표 안에서만 센다.
 */
const tableBodies = visible.match(/<tbody[\s\S]*?<\/tbody>/gu) ?? [];

const tableName = (index: number) => (index === 0 ? "위탁" : "국외 이전");

/** CSP 에 안 나오는(서버가 직접 부르는) 수탁사 — 손으로 고정한다. */
const SERVER_SIDE_PROCESSORS = ["Vercel Inc.", "OpenAI", "Resend, Inc."] as const;

type HostDisclosure = { processor: string } | { notEntrusted: string };

/**
 * CSP 가 브라우저에게 허용한 외부 호스트의 처리 상태.
 *
 * - `processor`: 개인정보 처리를 맡기는 사업자. **두 표에 모두** 있어야 한다.
 * - `notEntrusted`: 표에 넣지 않는 호스트와 그 이유. 이유는 엔지니어링 판단이며
 *   법률 검토를 받은 것이 아니다 — 판단이 바뀌면 여기서 바꾼다.
 *
 * 여기 없는 호스트가 CSP 에 생기면 이 검사가 빨간불이 된다. 그게 요점이다.
 */
const CSP_HOST_DISCLOSURE: Record<string, HostDisclosure> = {
  // 2026-08-31 운영 실측으로 확인한 이전 경로. 근거는 page.tsx 제5조 주석에 있다.
  "challenges.cloudflare.com": { processor: "Cloudflare, Inc." },
  "*.supabase.co": { processor: "Supabase, Inc." },
  "*.supabase.in": { processor: "Supabase, Inc." },
  "*.posthog.com": { processor: "PostHog, Inc." },
  "us.i.posthog.com": { processor: "PostHog, Inc." },
  "*.ingest.sentry.io": { processor: "Functional Software, Inc. (Sentry)" },
  "*.ingest.us.sentry.io": { processor: "Functional Software, Inc. (Sentry)" },

  "hanbang.ai": {
    notEntrusted: "자사 서비스 도메인이다. 외부 사업자가 아니므로 위탁·이전 대상이 아니다.",
  },
  "api.dicebear.com": {
    notEntrusted:
      "next.config.ts 의 CSP 와 이미지 remotePatterns 에만 남아 있고, 이 호스트를 부르는 코드가 저장소에 0건이다(2026-08-31 전수 grep: next.config.ts 와 문서 파일뿐). 부르는 코드가 생기면 이용자 IP 가 나가므로 그때 표에 올린다.",
  },
  "*.pstatic.net": {
    notEntrusted:
      "네이버 장소 검색 결과의 썸네일 CDN 이다(lib/ai/tools/placeSearchTools.ts 가 .pstatic.net 호스트만 통과시킨다). 브라우저가 공개 이미지를 직접 받아 오는 것이라 운영자가 처리를 맡기는 위탁이 아니고, 국내 사업자라 국외 이전표의 대상도 아니다.",
  },
  "fonts.googleapis.com": {
    notEntrusted:
      "/sai 전용 CSP 에만 있다. /sai 는 next.config.ts 의 rewrite 로 별도 앱(sai-mu-nine.vercel.app)에 연결되며 apps/web/src 에서 참조가 0건이다 — 웨딩한방 회원 화면이 아니다.",
  },
  "fonts.gstatic.com": {
    notEntrusted:
      "/sai 전용 CSP 에만 있다. 위 fonts.googleapis.com 과 같은 이유이며 같은 화면에서만 쓰인다.",
  },
  "cdn.jsdelivr.net": {
    notEntrusted:
      "/sai 전용 CSP 에만 있다. 위 fonts.googleapis.com 과 같은 이유이며 같은 화면에서만 쓰인다.",
  },
  "127.0.0.1:*": {
    notEntrusted:
      "/internal/wedding-code-research 로컬 연구 화면 전용 CSP 다. 개발 기기 안에서만 연결되며 외부로 나가지 않는다.",
  },
  "localhost:*": {
    notEntrusted:
      "/internal/wedding-code-research 로컬 연구 화면 전용 CSP 다. 위 127.0.0.1 과 같은 이유이며 같은 화면에서만 쓰인다.",
  },
};

/** next.config.ts 를 실제로 실행해 CSP 문자열을 받는다. */
async function contentSecurityPolicies(): Promise<string[]> {
  const rules = (await nextConfig.headers?.()) ?? [];
  return rules.flatMap((rule) =>
    rule.headers
      .filter((header) => header.key.toLowerCase() === "content-security-policy")
      .map((header) => String(header.value)),
  );
}

/** CSP 에서 외부 호스트 토큰만 뽑는다. `'self'`·`data:`·`blob:` 은 호스트가 아니다. */
function externalHosts(policies: readonly string[]): string[] {
  const hosts = new Set<string>();
  for (const policy of policies) {
    for (const token of policy.split(/[;\s]+/u)) {
      const match = /^(?:https?|wss?):\/\/(.+)$/u.exec(token);
      if (!match) continue;
      hosts.add(match[1].replace(/\/.*$/u, ""));
    }
  }
  return [...hosts].sort();
}

function expectInBothTables(name: string) {
  for (const [index, body] of tableBodies.entries()) {
    expect(
      body.includes(name),
      `${name} 가 ${tableName(index)}표에 없습니다`,
    ).toBe(true);
  }
}

describe("국외 이전 고지", () => {
  it("'준비 중'이라고 말하지 않는다", () => {
    // 이전하면서 고지를 준비 중이라고 적는 것은 그 자체로 위반 상태의 자백이다.
    expect(visible).not.toContain("준비 중이며");
    expect(visible).not.toContain("고지는 준비");
  });

  it("법이 요구하는 항목을 갖는다", () => {
    // 개인정보보호법 제28조의8: 항목·국가·시기와 방법·이전받는 자·목적·
    // 보유기간·거부 방법.
    for (const required of [
      "이전받는 자",
      "이전되는 국가",
      "이전 항목",
      "이전 목적",
      "보유·이용 기간",
      "국외 이전을 원하지 않으시면",
    ]) {
      expect(visible, `필수 항목이 없습니다: ${required}`).toContain(required);
    }
  });

  it("이전 시기와 방법을 밝힌다", () => {
    expect(visible).toMatch(/서비스를 이용하는 시점/u);
    expect(visible).toMatch(/HTTPS/u);
  });

  it("표를 정확히 두 개 갖는다", () => {
    // 아래 검사들이 "두 표에 모두" 를 세려면 표가 정확히 둘이어야 한다.
    // 셋째 표가 생기면 여기서 멈추고 세는 규칙을 다시 정한다.
    expect(tableBodies).toHaveLength(2);
  });

  it("서버가 부르는 수탁사를 두 표에 모두 적는다", () => {
    // CSP 유도로는 안 잡히는 쪽. 표 **안에서만** 센다 — 부칙·본문에 남은 같은
    // 이름이 대신 답하지 않도록.
    for (const processor of SERVER_SIDE_PROCESSORS) {
      expectInBothTables(processor);
    }
  });

  it("데이터베이스 리전을 실제 값으로 밝힌다", () => {
    // 운영 실측(2026-08-28): 프로젝트 slrtobkksjmxgzatjyqb 의 리전은 ap-south-1.
    // 미국만 적으면 사실이 아니다.
    expect(visible).toContain("인도");
  });
});

describe("CSP 가 허용한 외부 호스트에서 유도한 대조", () => {
  it("호스트를 실제로 뽑아낸다", async () => {
    // 추출기가 조용히 0건을 내면 아래 검사가 전부 헛초록불이 된다. 하한을 박는다.
    const policies = await contentSecurityPolicies();
    expect(policies.length).toBeGreaterThanOrEqual(1);

    const hosts = externalHosts(policies);
    expect(hosts.length).toBeGreaterThanOrEqual(10);
    expect(hosts).toContain("challenges.cloudflare.com");
    expect(hosts).toContain("*.supabase.co");
  });

  it("분류되지 않은 외부 호스트가 없다", async () => {
    const hosts = externalHosts(await contentSecurityPolicies());
    const unclassified = hosts.filter((host) => !(host in CSP_HOST_DISCLOSURE));
    expect(
      unclassified,
      `CSP 에 새 외부 호스트가 생겼습니다: ${unclassified.join(", ")}. `
        + "개인정보가 나가면 처리방침 제5조의 두 표에 모두 적고, 나가지 않으면 "
        + "CSP_HOST_DISCLOSURE 에 notEntrusted 이유를 적으세요.",
    ).toEqual([]);
  });

  it("분류표가 실제 CSP 와 붙어 있다", async () => {
    // 호스트가 CSP 에서 빠졌는데 분류만 남으면, 그 이유는 아무것도 지키지 않는다.
    const hosts = new Set(externalHosts(await contentSecurityPolicies()));
    const stale = Object.keys(CSP_HOST_DISCLOSURE).filter((host) => !hosts.has(host));
    expect(stale, `CSP 에 없는 분류가 남아 있습니다: ${stale.join(", ")}`).toEqual([]);
  });

  it("위탁으로 분류한 호스트의 사업자가 두 표에 모두 있다", () => {
    const processors = new Set(
      Object.values(CSP_HOST_DISCLOSURE)
        .filter((entry): entry is { processor: string } => "processor" in entry)
        .map((entry) => entry.processor),
    );
    expect(processors.size).toBeGreaterThanOrEqual(4);

    for (const processor of processors) {
      expectInBothTables(processor);
    }
  });

  it("위탁하지 않는다고 적은 호스트에는 이유가 있다", () => {
    for (const [host, entry] of Object.entries(CSP_HOST_DISCLOSURE)) {
      if (!("notEntrusted" in entry)) continue;
      expect(
        entry.notEntrusted.length,
        `${host} 의 제외 이유가 너무 짧습니다 — 무엇을 확인했는지 적으세요`,
      ).toBeGreaterThanOrEqual(30);
    }
  });
});
