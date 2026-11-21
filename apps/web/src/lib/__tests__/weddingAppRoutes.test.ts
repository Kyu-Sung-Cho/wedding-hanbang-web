// @vitest-environment node

import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { WEDDING_APP_ROUTES } from "../../../weddingAppRoutes";
import { staticPageRoutes } from "../testing/appPageRoutes";

const APP_DIR = resolve(process.cwd(), "src", "app");
const APP_GROUP_DIR = join(APP_DIR, "(app)");
const PAGE_FILES = ["page.tsx", "page.ts"] as const;

/**
 * `/wedding/<이름>`은 리라이트로 `/<이름>`을 연다. 그 주소를 실제로 여는 페이지가
 * 어느 라우트 그룹에 있든(`(app)`·`(auth)`·`(community)`·최상위) 상관없다.
 * 예전 구현은 `(app)`과 최상위만 봐서 살아 있는 페이지를 orphan으로 오판했다.
 */
const APP_PAGE_ROUTES = staticPageRoutes(APP_DIR);

function hasPage(route: string): boolean {
  return APP_PAGE_ROUTES.has(`/${route}`);
}

/**
 * 동적 세그먼트 자식(`[slug]`·`[id]`·`[category]`)을 가진 **페이지 라우트**의 URL 경로.
 * 이 목록이 곧 "빈 꼬리 슬래시가 닿으면 500이 나는 곳"이다 — 빈 세그먼트가 그 자식의
 * 파라미터로 읽혀 Next 가 값을 못 구한다. 손으로 적지 않고 매번 전수 스캔한다.
 */
function routesWithDynamicChildren(): string[] {
  const found: string[] = [];

  const walk = (dir: string, urlPath: string) => {
    const entries = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    const hasDynamicChild = entries.some((entry) => entry.name.startsWith("["));
    const hasPage = PAGE_FILES.some((file) => existsSync(join(dir, file)));
    if (hasDynamicChild && hasPage) found.push(urlPath || "/");

    for (const entry of entries) {
      if (entry.name.startsWith("[")) continue;
      // 라우트 그룹 `(app)` 과 병렬 슬롯 `@modal` 은 URL 에 붙지 않는다.
      const nested = entry.name.startsWith("(") || entry.name.startsWith("@");
      walk(join(dir, entry.name), nested ? urlPath : `${urlPath}/${entry.name}`);
    }
  };

  walk(APP_DIR, "");
  return found.sort();
}

function appGroupPages(): string[] {
  return readdirSync(APP_GROUP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    // 라우트 그룹((...))과 동적 세그먼트([...])는 고정 주소를 만들지 않는다.
    .filter((entry) => !entry.name.startsWith("(") && !entry.name.startsWith("["))
    .filter((entry) => PAGE_FILES.some((file) => existsSync(join(APP_GROUP_DIR, entry.name, file))))
    .map((entry) => entry.name)
    .sort();
}

// dashboard는 목록에 없는 게 맞다 — next.config가 /wedding/dashboard를 lounge로
// 리다이렉트하므로 rewrite 대상이 아니다.
const REDIRECTED_AWAY = new Set(["dashboard"]);

describe("wedding app route rewrites", () => {
  // 2026-07-26 회귀: 저장 공간 페이지를 만들고 목록에 안 넣어서 /wedding/saved가
  // 통째로 404였다. 링크는 멀쩡해 보여서 눌러 보기 전에는 몰랐다.
  it("exposes every (app) page under /wedding", () => {
    const missing = appGroupPages()
      .filter((segment) => !REDIRECTED_AWAY.has(segment))
      .filter((segment) => !WEDDING_APP_ROUTES.includes(segment as never));

    expect(
      missing,
      `WEDDING_APP_ROUTES 누락: ${missing.join(", ")} — /wedding/<이름>이 404가 된다`,
    ).toEqual([]);
  });

  // 반대 방향. 예전에는 orphan 기대값에 etiquette·market-prices·onboarding을
  // 못 박아 뒀는데, 뒤 두 개는 다른 라우트 그룹에 살아 있는 페이지를 오판한 것이었고
  // (특히 onboarding은 가입 퍼널이다), 그 때문에 실제로 페이지가 사라져도 이 테스트가
  // 통과했다. 이제 예외 없이 "목록의 모든 라우트는 열려야 한다"를 요구한다.
  it("keeps every listed route pointing at a real page", () => {
    const orphans = WEDDING_APP_ROUTES.filter((route) => !hasPage(route));

    expect(
      orphans,
      `대상 없는 리라이트: ${orphans.join(", ")} — 목록에서 빼거나 페이지를 만들 것`,
    ).toEqual([]);
  });

  it("루트 그룹 밖에 있는 페이지도 대상으로 인정한다", () => {
    // 오판의 원인이 된 두 경로를 명시적으로 고정한다.
    expect(hasPage("onboarding")).toBe(true); // (auth)/onboarding
    expect(hasPage("market-prices")).toBe(true); // (community)/market-prices
    // 2026-08-19에 잠시 되살렸다가 25편을 manners로 이관하면서 다시 지웠다. 지금은
    // next.config의 리다이렉트가 `/wedding/etiquette`를 `/wedding/manners`로 넘긴다.
    expect(hasPage("etiquette")).toBe(false);
  });

  /**
   * 2026-08-29 회귀. `:path*` 는 **0개 세그먼트에도** 걸린다. 그래서
   * `source: "/wedding/:route/:path*"` → `destination: "/:route/:path*"` 는
   * `/wedding/manners` 를 `/manners/` 로 넘겼고, RSC 요청이 거기에 `.rsc` 를 붙여
   * `/manners/.rsc` 를 만들었다. 그 경로가 빈 슬러그를 가진 `/manners/[slug]` 로
   * 읽혀 운영이 500 을 냈다("Could not resolve param value for segment: slug").
   * 문서 요청은 `/manners` 로 정규화돼 200 이라 화면으로는 멀쩡해 보였다.
   *
   * **터지는 조건은 목적지 아래에 동적 세그먼트 자식이 있는지 하나다.** 운영 실측
   * (14개 라우트 전수, 인증 게이트 뒤까지): 500 은 `manners`(`[slug]`)·`vendors`
   * (`[id]`) 둘, 나머지 12개는 동적 자식이 없어 200 이었다.
   *
   * ## 이 가드를 두 번 고쳐 쓴 이유
   *
   * 첫 판은 규칙을 `new Map(rules.map(...))` 로 모았다. 그런데 Map 은 **나중 값이
   * 이기고** Next/Vercel 라우팅은 **첫 매치가 이긴다** — 방향이 정반대다. 그래서
   * 가드가 `/market-prices` 의 목적지를 `/wedding/market-prices` 라고 단언하며
   * 통과했는데, 같은 시각 운영 실측은 `307 Location: /price` 였다(next.config.ts 의
   * `/market-prices` 정확 규칙이 생성 블록보다 앞서기 때문). 현실과 반대인 단언은
   * 초록불을 줘도 아무것도 지키지 않는다.
   *
   * 또 첫 판은 금지 대상을 `:path*` 라는 **문자 그대로** 봤다. 그러면 올바른 규칙을
   * 그대로 두고 0개를 허용하는 규칙을 그 **앞에** 하나 더 얹는 변형을 통과시킨다.
   *
   * 그래서 문자열을 세지 않고 **첫 매치 오라클**을 만들어 목적지를 직접 계산한다.
   * 오라클이 맞다는 것은 아래 PRODUCTION_OBSERVED(운영에서 실제로 받은 Location)를
   * 재현하는지로 검증한다 — 오라클이 틀리면 그 단언이 먼저 깨진다.
   */
  describe("빈 꼬리 슬래시 목적지 (2026-08-29 /manners·/vendors RSC 500)", () => {
    type Rule = { source: string; destination: string };

    /** Next 의 source 문법(리터럴 · `:n` · `:n(정규식)` · `:n+` · `:n*`)을 정규식으로. */
    function compile(source: string): { regex: RegExp; params: string[] } {
      const params: string[] = [];
      let pattern = "";
      for (const segment of source.split("/").slice(1)) {
        const m = /^:([A-Za-z0-9_]+)(?:\(([\s\S]*)\))?([*+?])?$/.exec(segment);
        if (!m) {
          pattern += "/" + segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          continue;
        }
        const [, name, custom, modifier] = m;
        params.push(name);
        const body = custom ?? "[^/]+?";
        if (modifier === "*") pattern += `(?:/((?:${body})(?:/(?:${body}))*))?`;
        else if (modifier === "+") pattern += `(?:/((?:${body})(?:/(?:${body}))*))`;
        // `?` 는 0개 또는 1개다 — `*` 와 똑같이 빈 꼬리 슬래시를 만든다. 처음에는 이
        // 분기를 빼먹어 `:path?` 우회를 통째로 놓쳤다(2026-08-29, repro 빌드로 확인).
        else if (modifier === "?") pattern += `(?:/(${body}))?`;
        else pattern += `/(${body})`;
      }
      return { regex: new RegExp(`^${pattern}(?:/)?$`), params };
    }

    function build(destination: string, params: string[], values: Array<string | undefined>): string {
      let out = destination;
      params.forEach((name, i) => {
        out = out.replace(new RegExp(`:${name}(?:\\([^)]*\\))?[*+?]?`, "g"), values[i] ?? "");
      });
      return out;
    }

    /** 배열 순서대로 **첫 매치**를 찾아 실제 목적지를 계산한다. */
    function resolveFirst(rules: Rule[], pathname: string): { rule: Rule; destination: string } | null {
      for (const rule of rules) {
        const { regex, params } = compile(rule.source);
        const m = regex.exec(pathname);
        if (m) return { rule, destination: build(rule.destination, params, m.slice(1)) };
      }
      return null;
    }

    const isExternal = (destination: string) => /^https?:\/\//.test(destination);

    async function loadRules(): Promise<{ redirects: Rule[]; rewrites: Rule[] }> {
      const config = (await import("../../../next.config")).default;
      return {
        redirects: (await config.redirects!()) as unknown as Rule[],
        rewrites: (await config.rewrites!()) as unknown as Rule[],
      };
    }

    // 오라클 자기검증용. 전부 2026-08-29 에 실제로 받은 응답이다.
    // 앞 넷은 운영(https://hanbang.ai)의 `Location` 헤더, 마지막은 같은 규칙을 로컬
    // dev 서버에서 확인한 값이다. **이 값을 코드에 맞추려고 고치지 말 것** — 어긋나면
    // 오라클이나 설정이 틀린 것이지 이 기대값이 틀린 게 아니다.
    //
    // 2026-11-22 한 줄을 뺐다: `["/wedding/community", "/wedding"]`. 값이 틀려서가 아니라 그 규칙을
    // 일부러 지웠기 때문이다(커뮤니티를 닫아 `/wedding/community` 아래가 '닫았어요' 화면이 됐다).
    // 지운 규칙의 옛 관측값을 새 목적지로 고쳐 쓰면 관측이 아닌 값이 되므로 줄을 통째로 뺐다.
    const PRODUCTION_OBSERVED: Array<[string, string]> = [
      ["/market-prices", "/price"],
      ["/wedding/market-prices", "/price"],
      ["/wedding/wedding", "/wedding"],
      ["/etiquette", "/wedding/manners"],
    ];

    it("오라클이 운영에서 실제로 받은 리다이렉트를 재현한다", async () => {
      const { redirects } = await loadRules();

      for (const [input, expected] of PRODUCTION_OBSERVED) {
        const hit = resolveFirst(redirects, input);
        expect(hit?.destination, `${input} 의 첫 매치 목적지`).toBe(expected);
      }
    });

    it("도달 가능한 어떤 경로도 꼬리 슬래시로 끝나는 목적지를 얻지 않는다", async () => {
      const { redirects, rewrites } = await loadRules();

      // 후보 입력: wedding 라우트 양방향 + 동적 자식을 가진 앱 라우트(=500의 조건).
      const candidates = new Set<string>();
      for (const route of WEDDING_APP_ROUTES) {
        candidates.add(`/${route}`);
        candidates.add(`/wedding/${route}`);
      }
      for (const route of routesWithDynamicChildren()) {
        candidates.add(route);
        candidates.add(`/wedding${route}`);
      }

      const broken: string[] = [];
      for (const input of [...candidates].sort()) {
        for (const [lane, rules] of [["redirect", redirects], ["rewrite", rewrites]] as const) {
          const hit = resolveFirst(rules as Rule[], input);
          if (!hit || isExternal(hit.destination)) continue;
          if (hit.destination !== "/" && hit.destination.endsWith("/")) {
            broken.push(`${lane} ${input} → ${hit.destination}  (규칙: ${hit.rule.source})`);
          }
        }
      }

      expect(
        broken,
        `빈 꼬리 슬래시 목적지 — 목적지에 동적 자식이 있으면 RSC 에서 500 이다:\n${broken.join("\n")}`,
      ).toEqual([]);
    });

    // 위 단언은 "도달하는" 경로만 본다. 앞선 규칙에 가려 오늘 안 도는 규칙도 내일
    // 앞 규칙이 지워지면 돈다. 그래서 규칙 하나하나를 **따로 떼어** 0개 세그먼트로
    // 매치시켜 본다. `:path*` 든 `:path(.*)` 든 문법과 무관하게 걸린다.
    it("규칙을 하나씩 떼어 0개 세그먼트로 매치해도 꼬리 슬래시가 안 생긴다", async () => {
      const { redirects, rewrites } = await loadRules();

      const offenders: string[] = [];
      for (const [lane, rules] of [["redirect", redirects], ["rewrite", rewrites]] as const) {
        for (const rule of rules as Rule[]) {
          if (isExternal(rule.destination)) continue;
          // 파라미터 앞까지의 리터럴 접두사 = 0개 세그먼트로 매치될 때의 입력
          const segments = rule.source.split("/").slice(1);
          const firstParam = segments.findIndex((segment) => segment.startsWith(":"));
          if (firstParam === -1) continue; // 파라미터가 없는 정확 규칙
          const literal = "/" + segments.slice(0, firstParam).join("/");
          // 슬래시 없는 판과 있는 판을 **둘 다** 넣는다. `:path(.*)` 는 슬래시 없는
          // 입력에는 매치되지 않지만 `/wedding/manners/` 에는 매치돼 `/manners/` 를
          // 만든다 — 앞판만 재던 첫 검증이 이 우회를 통과시켰다(2026-08-29).
          for (const input of [literal, `${literal}/`]) {
            const hit = resolveFirst([rule], input);
            if (hit && hit.destination !== "/" && hit.destination.endsWith("/")) {
              offenders.push(`${lane} ${rule.source} → ${hit.destination} (입력 ${input})`);
            }
          }
        }
      }

      expect(
        offenders,
        `0개 세그먼트에 걸려 꼬리 슬래시를 만드는 규칙:\n${offenders.join("\n")}`,
      ).toEqual([]);
    });

    it("빈 경로를 잡는 규칙이 실제로 존재한다 (:path+ 만 남기면 404가 된다)", async () => {
      const { redirects, rewrites } = await loadRules();

      for (const route of WEDDING_APP_ROUTES) {
        expect(resolveFirst(redirects, `/${route}`), `/${route} 를 잡는 리다이렉트가 없다`).not.toBeNull();
        expect(
          resolveFirst(rewrites, `/wedding/${route}`),
          `/wedding/${route} 를 잡는 리라이트가 없다`,
        ).not.toBeNull();
      }
    });
  });
});
