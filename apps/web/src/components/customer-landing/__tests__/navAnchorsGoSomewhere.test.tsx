import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 상단 내비의 화면 안 앵커가 **실제로 어딘가로 간다.**
 *
 * ## 무엇이 있었나
 *
 * `CustomerNav.handleClick` 은 `preventDefault()` 를 먼저 부르고, 타깃을 못 찾으면
 * 그냥 반환했다. 그래서 `/beta` 와 `/demo` 의 "베타 신청" 버튼은 **눌러도 아무 일도
 * 일어나지 않았다** — `id="cta"` 는 `/about` 에만 있었기 때문이다.
 *
 * 스스로 링크해 둔 곳이 죽어 있는 것은 사용자가 "이 서비스는 고장났다"고 읽는 종류의
 * 실패다. 그런데 오류도 로그도 없어서 아무도 모른다.
 *
 * ## 무엇을 지키나
 *
 * 두 가지다.
 * 1. 내비가 쓰는 `#앵커` 는 **그 앵커를 렌더하는 화면이 저장소에 실재**해야 한다.
 * 2. 못 찾았을 때 **조용히 끝나지 않아야** 한다.
 */
describe("내비의 화면 안 앵커", () => {
  const webRoot = process.cwd();
  const read = (relative: string) => readFileSync(resolve(webRoot, relative), "utf8");

  const NAV = "src/components/customer-landing/CustomerNav.tsx";

  it("측정기가 살아 있다", () => {
    const nav = read(NAV);
    expect(nav.length).toBeGreaterThan(500);
    expect(nav, "내비에 navLinks 가 있어야 합니다").toMatch(/navLinks\s*=/u);
  });

  /** 소스 문자열에서 화면 안 앵커(`#...`)를 뽑는다. 목록을 손으로 적지 않는다. */
  function anchorsFrom(source: string): string[] {
    const at = source.indexOf("navLinks");
    const block = source.slice(at, source.indexOf("];", at));
    return [...block.matchAll(/href:\s*"(#[A-Za-z0-9_-]+)"/gu)].map((m) => m[1]);
  }

  /** 내비가 쓰는 화면 안 앵커들. */
  function anchorsInNav(): string[] {
    return anchorsFrom(read(NAV));
  }

  /**
   * ## 이 검사는 2026-08-29에 자리를 옮겼다 — 지킬 대상이 없어졌다
   *
   * 원래 형태는 `anchorsInNav().length > 0` 이었다. 이유: 앵커가 0개면 **아래 두
   * 검사가 조용히 통과**한다(빈 배열을 도는 루프는 아무것도 단언하지 않는다).
   *
   * 없어진 것: 내비의 **유일한** 화면 안 앵커
   *   `{ href: "#cta", label: "베타 신청", scroll: true }`
   *
   * 왜: 파운더 결정("베타 우리 안할거야 알아둬", CLAUDE.md 2026-08-29)으로
   * `src/app/beta/page.tsx` 와 `src/components/landing/ForBetaCouples.tsx` 가
   * 지워졌다. `id="cta"` 를 렌더하던 곳은 저장소 전체에서 그 둘뿐이었고 지금은
   * **0곳**이다(주석 1건만 남았다). 되살리면 아무 데도 없는 id를 가리킨다 —
   * 이 파일이 원래 막으려던 바로 그 상태다. `/beta` 는 `next.config.ts` 에서
   * `/landing` 으로 308 된다.
   *
   * 즉 지금의 앵커 0개는 **고장이 아니라 설계**다. 옛 형태를 살려 두면 없어진 베타
   * CTA를 되살리라고 요구하는 검사가 된다. 사용자가 잃은 링크는 없다 — 남은 링크
   * 4개는 전부 실재하는 라우트이고, 주 행동(`loginHref`)은 그대로다.
   *
   * ⚠️ **그 라벨을 되돌려도 어떤 베타 가드도 울지 않는다.** 2026-08-29에 실제로
   * 심어서 재 봤다: `{ href: "#cta", label: "베타 신청", scroll: true }` 을 넣고
   * `src/lib/marketing` · `src/app/landing` · 이 디렉터리를 전부 돌렸더니 **베타
   * 문구를 잡은 검사는 0개**였고, 깨진 것은 아래 폴백 검사 하나뿐이었다.
   * 랜딩의 베타 금지들은 `landing/redesign` 디렉터리만 훑기 때문이다. 그래서
   * `publicClaims.test.ts` 의 금지를 공개 표면 전체로 넓혔다 — 그 검사가 이제
   * 이 파일의 라벨도 본다.
   *
   * `CustomerNav` 의 `handleClick`·`SCROLL_ANCHOR_HOME` 은 지금 호출자가 없다
   * (`scroll: true` 인 링크가 0개다). **지우지 마라** — 앵커가 다시 생기는 날
   * 필요한 폴백이고, 아래 검사들이 그날을 위해 남아 있다.
   *
   * 원래 걱정(추출기가 조용히 0을 내는 것)은 그대로 남으므로, 살아 있는 내비 대신
   * **답을 아는 표본**으로 추출기를 잰다.
   */
  it("앵커 추출기가 살아 있다 — 내비의 앵커 0개는 설계다", () => {
    const sample = [
      "const navLinks = [",
      '  { href: "/about", label: "소개", scroll: false },',
      '  { href: "#now", label: "표본", scroll: true },',
      "];",
    ].join(String.fromCharCode(10));
    expect(
      anchorsFrom(sample),
      "추출기가 앵커를 못 뽑습니다 — navLinks 모양이 바뀌었거나 정규식이 낡았습니다",
    ).toEqual(["#now"]);

    expect(
      anchorsInNav(),
      "내비에 화면 안 앵커가 생겼습니다. 위 은퇴 사유를 먼저 읽고, 그 앵커를 렌더하는 "
        + "화면이 실재하는지 확인한 뒤 이 단언을 푸세요.",
    ).toEqual([]);
  });

  it("모든 앵커가 저장소 어딘가에서 실제로 렌더된다", () => {
    // 앵커를 렌더하는 곳을 저장소에서 찾는다. 못 찾으면 그 링크는 영원히 죽어 있다.
    const roots = ["src/app", "src/components"];
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSyncSafe(resolve(webRoot, dir))) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "__tests__") continue;
          walk(rel);
        } else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
          sources.push(read(rel));
        }
      }
    };
    roots.forEach(walk);
    expect(sources.length, "화면 소스를 못 읽었습니다").toBeGreaterThan(50);

    const dead = anchorsInNav().filter((anchor) => {
      const id = anchor.slice(1);
      return !sources.some((src) => src.includes(`id="${id}"`));
    });

    expect(
      dead,
      `내비가 가리키는 앵커가 어디에도 없습니다: ${dead.join(", ")}. `
        + "그 버튼은 눌러도 아무 일이 일어나지 않습니다.",
    ).toEqual([]);
  });

  it("폴백이 보내는 화면에 그 앵커가 실제로 있다", () => {
    // "저장소 어딘가에 있다"만으로는 부족하다. 폴백은 특정 화면으로 보내는데, 그
    // 화면에 앵커가 없으면 이동만 하고 아무 데도 안 간다 — 사용자 눈에는 여전히
    // 아무 일도 안 일어난 것이다. (이 검사가 없을 때 실제로 그 변형을 놓쳤다.)
    const nav = read(NAV);
    const home = /const SCROLL_ANCHOR_HOME = "([^"]+)"/u.exec(nav)?.[1];
    expect(home, "폴백 목적지 상수를 못 찾았습니다").toBeTruthy();

    const page = `src/app${home}/page.tsx`;
    let source = "";
    expect(() => { source = read(page); }, `폴백 목적지 화면이 없습니다: ${page}`).not.toThrow();

    // ⚠️ 2026-08-29: 여기서 `source` 한 장만 보고 있었다. 옛 목적지 `/beta` 는
    // `id="cta"` 를 자기 page.tsx 안에 직접 들고 있어서 그걸로 충분했다. 목적지가
    // `/landing` 으로 바뀌면서 사정이 달라졌다 — `src/app/landing/page.tsx` 가 가진
    // id는 `main-content` **하나뿐**이고, 이 폴백이 노리는 앵커들은 섹션 컴포넌트에
    // 있다(`#now` 는 redesign/AvailableNowSection.tsx, `#trust` 는 BoundariesSection.tsx).
    //
    // 그래서 page.tsx 만 읽으면 **브라우저에서 멀쩡히 동작하는 링크를 죽었다고 부른다.**
    // 메시지가 단정적이라("아무 데도 안 갑니다") 다음 사람은 검사가 아니라 멀쩡한
    // 링크를 지울 가능성이 높다. 지금은 앵커가 0개라 루프가 비어 잠들어 있지만,
    // 앵커를 되살리는 바로 그 순간 터진다.
    //
    // 목적지를 **그 화면이 조립하는 것들**로 판정한다. 로컬 import 를 한 단계 따라간다.
    let composed = source;
    for (const [, spec] of source.matchAll(/from\s+"@\/([^"]+)"/gu)) {
      for (const candidate of [`src/${spec}.tsx`, `src/${spec}/index.tsx`]) {
        try {
          composed += read(candidate);
          break;
        } catch {
          /* 다음 후보 */
        }
      }
    }
    // 수집이 실패하면 이 검사는 page.tsx 한 장으로 되돌아간다 — 조용히 그러지 않게 한다.
    expect(
      composed.length,
      "목적지 화면의 구성 요소를 하나도 못 읽었습니다 — import 모양이 바뀌었는지 보세요",
    ).toBeGreaterThan(source.length);

    for (const anchor of anchorsInNav()) {
      expect(
        composed,
        `폴백이 ${home} 로 보내는데 그 화면(과 그 화면이 조립하는 컴포넌트)에 `
          + `${anchor} 가 없습니다. 이동은 하지만 아무 데도 안 갑니다.`,
      ).toContain(`id="${anchor.slice(1)}"`);
    }
  });

  it("앵커를 못 찾았을 때 조용히 끝나지 않는다", () => {
    const nav = read(NAV);
    const at = nav.indexOf("function handleClick");
    expect(at, "handleClick 을 못 찾았습니다").toBeGreaterThan(-1);

    // 함수 본문만 정확히 떼어낸다. 창을 넓게 잡으면 주변 코드를 집는다.
    const open = nav.indexOf("{", at);
    let depth = 0;
    let end = open;
    for (let i = open; i < nav.length; i += 1) {
      if (nav[i] === "{") depth += 1;
      else if (nav[i] === "}") {
        depth -= 1;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    const body = nav.slice(open, end);

    expect(body, "preventDefault 를 부른다면 대체 경로가 있어야 합니다").toMatch(
      /preventDefault\(\)/u,
    );
    expect(
      body,
      "타깃을 못 찾았을 때 갈 곳이 없습니다. `preventDefault()` 뒤에 그냥 반환하면 "
        + "브라우저 기본 이동까지 막혀 버튼이 완전히 죽습니다.",
    ).toMatch(/window\.location|router\.(push|replace)/u);
  });
});

/** 디렉터리를 읽되 없으면 빈 목록. 테스트가 경로 오타로 조용히 통과하지 않게 위에서 개수를 단언한다. */
function readdirSyncSafe(dir: string): Array<{ name: string; isDirectory: () => boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

describe("데모 화면에서도 정품 로그인으로 보낸다", () => {
  /**
   * 예전에는 `demoMode` 일 때 `/demo/login` 으로 보냈다. 그 화면은 `/login` 의
   * 복제본이었고 **더 나빴다**:
   *
   *   /login       "또는 로그인 없이 체험하기 …"   ← 체험 입구 있음(스위치가 켜져 있을 때)
   *   /demo/login  "INTERNAL DEV" 배지            ← 체험 입구 0개
   *
   * `/price` 와 공시가 상세에서 "먼저 보기" → `/demo` → 상단 "로그인" 두 번이면
   * 닿는 공개 자리였다. 처음 온 사람이 그 화면에서 비밀번호를 넣는다.
   *
   * 변형 검사에서 이 줄을 되돌렸을 때 **아무 검사도 안 깨졌다.**
   */
  it("loginHref 가 demoMode 로 갈리지 않는다", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require("node:path") as typeof import("node:path");
    const source = readFileSync(
      join(__dirname, "..", "CustomerNav.tsx"),
      "utf8",
    );
    const line = source
      .split(String.fromCharCode(10))
      .find((candidate) => candidate.includes("const loginHref"));
    expect(line ?? "", "loginHref 선언이 사라졌다").toContain("loginHref");
    expect(line ?? "", "데모 화면이 다시 복제 로그인으로 간다")
      .not.toContain("demoMode");
    expect(line ?? "").toContain('"/login"');
  });
});
