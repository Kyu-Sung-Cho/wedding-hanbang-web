import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 테마 안 제목은 **화면에 안 먹는 크기 클래스를 달지 않는다.**
 *
 * ## 무슨 일이 있었나
 *
 * `globals.css`에는 로그인 후 화면과 커뮤니티의 제목 타이포를 통일하는 블록이 있다.
 *
 *   .hanbang-service-theme main h1, .hanbang-community-theme main h1 {
 *     font-size: clamp(...) !important; line-height: 1.25 !important; font-weight: 500 !important;
 *   }
 *
 * `!important`이고 선택자 특정도도 유틸리티(0,1,0)보다 높다. 그래서 컴포넌트가
 * `text-4xl font-light leading-[1.2] tracking-normal`을 써 두어도 **하나도 안 먹는다.**
 * 2026-08-31에 세어 보니 그런 죽은 클래스가 456개였다. 파일에는 36px 얇게라고 적혀
 * 있는데 화면은 25px 보통 굵기로 나오는 상태가 오래 이어졌고, 그 결과
 * "제목 크기가 50종"이라는 집계도 실제 화면과 무관한 숫자였다.
 *
 * 소스와 화면이 다르면 **타이포를 고칠 수가 없다.** 파일을 고쳐도 화면이 안 바뀌니
 * 고친 사람은 자기 수정이 반영됐는지 알 수 없고, 다음 사람은 파일을 믿고 또 쓴다.
 *
 * ## 이 테스트가 지키는 것
 *
 * 테마가 걸리는 트리 안의 `<h1>`~`<h6>`이 크기·굵기·행간·자간 유틸리티를 달지 않을 것.
 * 제목 타이포의 출처는 `globals.css` 한 곳이다. 바꾸고 싶으면 거기서 바꾼다.
 *
 * ## 이 테스트가 지키지 않는 것
 *
 * `globals.css`의 값이 **옳은지**는 보지 않는다. 지금 제목은 4단(h1/h2/h3/h4~h6)뿐이고
 * 시안(`docs/landing/NotebookBest.html`)의 위계와 같지 않다. 그건 값을 정하는 일이고,
 * 이 테스트는 그 값이 **실제로 화면을 결정하도록** 유지하는 역할만 한다.
 */

const WEB_ROOT = process.cwd();
const SOURCE_ROOT = path.join(WEB_ROOT, "src");

/** 테마 클래스가 붙는 두 레이아웃 아래. 나머지 라우트는 블록이 안 걸리므로 대상이 아니다. */
const THEMED_ROUTE_DIRS = ["app/(app)/", "app/(community)/"];

/**
 * 테마 트리 안에 있지만 **테마 밖에서도 렌더되는** 컴포넌트들. 여기 쓰인 크기 클래스는
 * 테마가 안 걸린 화면에서는 실제로 먹으므로 지우면 그 화면이 바뀐다.
 *
 * 목록을 손으로 적지 않고 import 그래프에서 뽑았다 —
 * 테마 밖 라우트가 도달하는 컴포넌트 54개 중 이 트리와 겹치는 것이 아래 9개였다.
 */
const RENDERED_OUTSIDE_THEME = [
  "src/components/app/JourneyRealtimeSync.tsx",
  "src/components/app/Sidebar.tsx",
  "src/components/app/TopNav.tsx",
  "src/components/app/chat/ChatSidePanel.tsx",
  "src/components/community/CommunityAmoraLauncher.tsx",
  "src/components/community/CommunityAuthInitializer.tsx",
  "src/components/community/CommunityNav.tsx",
  "src/components/community/StartHereClient.tsx",
  "src/components/community/Toast.tsx",
];

/**
 * 블록의 선택자는 `main h1`이다 — **`main` 밖 제목은 안 덮는다.**
 * 푸터의 `<h3>`는 운영에서 14px/600으로 나온다(실측). 그래서 랜드마크 안은 세지 않는다.
 */
const LANDMARK = /<(\/?)(footer|header|nav|aside)\b/gi;
const HEADING = /<h[1-6]\b/gi;
const CLASS_NAME = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;

/**
 * 블록이 덮는 네 가지 — font-size · font-weight · line-height · letter-spacing.
 *
 * 정규식 **리터럴**로 쓴다. 같은 저장소에서 `new RegExp(\`...\`)`로 쓴 가드가
 * 템플릿 리터럴에 이스케이프를 먹혀 죽은 채로 통과한 적이 있다.
 *
 * `font-serif-kr` · `font-display`는 블록이 **겨냥하는 선택자**라서 대상이 아니다.
 * `text-[var(--hb-...)]` · `text-center` 같은 색·정렬도 아니다 — 단위가 붙은 것만 크기다.
 */
const DEAD_TYPE_CLASS =
  /(?<![\w:./-])(?:[a-z0-9-]+:)*(?:text-(?:xs|sm|base|lg|xl|[2-9]xl|\[[^\]]*(?:px|rem|em)\])|font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)|tracking-(?:tighter|tight|normal|wide|wider|widest|\[[^\]]*\])|leading-(?:none|tight|snug|normal|relaxed|loose|\[[^\]]*\]|\d+))(?![\w./-])/g;

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collectSourceFiles(full, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

/** 테마 트리 안에서 import 되는 컴포넌트 디렉터리를 읽어낸다(하드코딩하면 낡는다). */
function themeReachableComponentDirs(files: string[]): Set<string> {
  const dirs = new Set<string>();
  for (const file of files) {
    const rel = toPosix(path.relative(WEB_ROOT, file));
    if (!THEMED_ROUTE_DIRS.some((d) => rel.startsWith(`src/${d}`))) continue;
    for (const m of readFileSync(file, "utf8").matchAll(/from "@\/components\/([a-zA-Z-]+)\//g)) {
      dirs.add(m[1]);
    }
  }
  return dirs;
}

const sourceFiles = collectSourceFiles(SOURCE_ROOT).filter((f) => !toPosix(f).includes("/__tests__/"));
const reachableDirs = themeReachableComponentDirs(sourceFiles);

/**
 * `createPortal(x, document.body)`로 그리는 컴포넌트는 DOM 상 **`main` 밖**이다.
 * 이름을 목록에 박는 대신 호출을 본다 — 새 오버레이가 생겨도 자동으로 걸러진다.
 *
 * 실제로 `components/ui/SpotlightTutorial.tsx`가 그렇다. 튜토리얼 오버레이의 `<h3>`는
 * `text-lg leading-snug`이 **살아 있고**, 지우면 화면이 바뀐다.
 */
function portalsToBody(text: string): boolean {
  return text.includes("createPortal") && /createPortal\([\s\S]{0,200}?document\.body/.test(text);
}

function isThemed(file: string): boolean {
  const rel = toPosix(path.relative(WEB_ROOT, file));
  if (RENDERED_OUTSIDE_THEME.includes(rel)) return false;
  if (portalsToBody(readFileSync(file, "utf8"))) return false;
  if (THEMED_ROUTE_DIRS.some((d) => rel.startsWith(`src/${d}`))) return true;
  const m = rel.match(/^src\/components\/([a-zA-Z-]+)\//);
  return Boolean(m && reachableDirs.has(m[1]));
}

type Finding = { file: string; heading: string; dead: string[] };

/** `main` 안 제목의 className 을 모아 죽은 클래스를 찾는다. */
function scan(): { findings: Finding[]; headings: number } {
  const findings: Finding[] = [];
  let headings = 0;

  for (const file of sourceFiles.filter(isThemed)) {
    const text = readFileSync(file, "utf8");
    const events: Array<[number, number]> = [];
    for (const m of text.matchAll(LANDMARK)) events.push([m.index, m[1] ? -1 : 1]);
    for (const m of text.matchAll(HEADING)) events.push([m.index, 0]);
    events.sort((a, b) => a[0] - b[0]);

    let depth = 0;
    for (const [at, kind] of events) {
      if (kind !== 0) { depth += kind; continue; }
      if (depth > 0) continue; // 푸터·헤더 안 — 블록이 안 덮는다
      headings += 1;

      CLASS_NAME.lastIndex = at;
      const m = CLASS_NAME.exec(text);
      if (!m || m.index > at + 3000) continue;
      if (text.slice(at, m.index).includes(">")) continue; // 이 태그의 className 이 아니다

      const value = m[1] ?? m[2] ?? "";
      const dead = value.match(DEAD_TYPE_CLASS);
      if (dead) {
        findings.push({ file: toPosix(path.relative(WEB_ROOT, file)), heading: text.slice(at, at + 3), dead });
      }
    }
  }
  return { findings, headings };
}

describe("테마 안 제목 타이포", () => {
  it("측정기가 살아 있다", () => {
    const { headings } = scan();

    // 스캔이 비면 "죽은 클래스 0개"가 되어 **무조건 통과**한다. 이 저장소에서 그런 식으로
    // 초록불을 낸 가드가 여러 번 있었다. 그래서 세 가지를 함께 확인한다.
    expect(headings, "테마 트리에서 제목을 못 찾았다 — 스캔 경로나 랜드마크 판정이 깨졌다")
      .toBeGreaterThan(120);

    const sample = "font-serif-kr text-2xl font-semibold tracking-tight leading-snug";
    expect(sample.match(DEAD_TYPE_CLASS), "정규식이 죽은 클래스를 못 잡는다")
      .toEqual(["text-2xl", "font-semibold", "tracking-tight", "leading-snug"]);

    const keep = "font-serif-kr font-display text-center text-[var(--hb-text-strong)]";
    expect(keep.match(DEAD_TYPE_CLASS), "정규식이 지우면 안 되는 클래스를 잡는다").toBeNull();
  });

  it("크기·굵기·행간·자간 클래스를 달지 않는다", () => {
    const { findings } = scan();

    const lines = findings.map((f) => `${f.file} ${f.heading}> ${f.dead.join(" ")}`);
    expect(
      lines,
      `테마 안 제목 ${findings.length}곳이 화면에 안 먹는 타이포 클래스를 달고 있습니다. `
        + `globals.css의 제목 블록이 !important로 덮으므로 파일의 값은 무시됩니다 — `
        + `클래스를 지우거나, 정말 다른 크기가 필요하면 globals.css에서 정하세요.`,
    ).toEqual([]);
  });
});
