import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
 * `!important`이고 선택자 특정도도 유틸리티(0,1,0)보다 높다. 그래서 **이 블록이 걸리는 제목**은
 * `text-4xl font-light leading-[1.2] tracking-normal`을 써 두어도 하나도 안 먹는다.
 * 2026-08-31에 그런 죽은 클래스가 416개였다. 파일에는 36px 얇게라고 적혀 있는데 화면은
 * 25px 보통 굵기로 나오는 상태가 오래 이어졌고, "제목 크기가 50종"이라는 집계도
 * 실제 화면과 무관한 숫자였다.
 *
 * ## 이 블록이 걸리지 **않는** 곳 — 여기 클래스는 살아 있다
 *
 * 선택자가 `main h1`이다. `<main>` 밖 제목은 안 덮는다. 그리고 Tailwind v4 preflight가
 * `h1`~`h6`의 `font-size`/`font-weight`를 `inherit`로 리셋하므로, **`main` 밖에서 크기
 * 클래스를 지우면 제목이 본문 크기(16px/400)로 내려앉는다.** 눈에 보이는 회귀다.
 *
 * 2026-08-31에 실제로 그 실수를 했다. 소스에서 `<footer>` 태그 안인지만 봤는데,
 * 푸터를 그리는 `FooterColumn`이 `</footer>` **뒤에** 정의된 헬퍼 함수라 "푸터 밖"으로
 * 세어졌다. 같은 이유로 채팅 사이드 패널 전체(`GlobalChatAssistant` → `ChatSidePanel` →
 * `PendingAmoraActionCard`·`MediationCard`·`ChatBubble`…)와 `TopNav` 아래
 * `NotificationPanel`·`CategoryChecklistModal`도 놓쳤다. 전부 `<main>`의 **형제**다.
 *
 * 그래서 이 테스트는 **파일 이름을 손으로 적지 않는다.** 레이아웃에서 `<main>` 밖 슬롯에
 * 놓이는 컴포넌트를 뿌리로 잡고 import 그래프의 전이 폐포를 계산한다. 상대 경로 import와
 * `import()`도 따라간다 — `@/`만 따라갔다가 위의 여덟 개를 통째로 놓쳤다.
 *
 * ## 이 테스트가 지키지 않는 것
 *
 * `globals.css`의 값이 **옳은지**는 보지 않는다. 지금 제목은 4단(h1/h2/h3/h4~h6)뿐이고
 * 시안(`docs/landing/NotebookBest.html`)의 위계와 같지 않다. 그건 값을 정하는 일이고,
 * 이 테스트는 그 값이 **실제로 화면을 결정하도록** 유지하는 역할만 한다.
 */

const WEB_ROOT = process.cwd();
const SRC = path.join(WEB_ROOT, "src");

/** 테마 클래스(`hanbang-service-theme` / `hanbang-community-theme`)가 붙는 두 라우트 그룹. */
const THEMED_ROUTE_DIRS = ["app/(app)", "app/(community)"];

/**
 * 테마가 **안** 붙는 라우트. 여기서도 렌더되는 컴포넌트의 크기 클래스는 그 화면에서
 * 살아 있으므로 대상에서 뺀다.
 *
 * `app/vendors` 는 갈래가 둘이다. `app/vendors/page.tsx` 는 `AuthenticatedAppShell` 을
 * 거쳐 **테마 셸 안**으로 들어가고(그래서 `AppClientLayout` 이 `/wedding/vendors` 를
 * 특별 취급한다), `app/vendors/[id]/page.tsx` 는 셸 없이 자기 `<main>` 만 그린다.
 * 뒤엣것 때문에 목록에 남긴다 — 앞엣것을 테마 밖으로 세는 것은 **안전한 방향의 오류**다
 * (대상이 좁아질 뿐 회귀를 만들지 않는다). 실제 영향도 0으로 쟀다: 빼면 대상이
 * 102 → 104 로 늘지만 늘어나는 두 파일에 제목이 하나도 없다.
 */
const UNTHEMED_ROUTE_DIRS = [
  "app/(admin)", "app/(auth)", "app/landing", "app/price", "app/manners", "app/about",
  "app/start-here", "app/demo", "app/invite", "app/today", "app/vendors", "app/wedding-code",
  "app/quote", "app/consent", "app/ai-policy", "app/wedding",
];

// 2026-09-06 사용자 승인 HTML: 테마 셸 안이지만 .amora-workspace는 일반 제목
// bridge에서 제외된다. 이 화면의 선언된 크기는 실제로 렌더되므로 지우면 안 된다.
// 2026-09-10 미션의 라운지 통합도 AppClientLayout에서 같은 셸을 사용한다.
// 2026-09-11 승인된 예산·일정 HTML도 .planning-workspace를 사용한다.
// 정확한 라우트에서만 import 폐포를 제외하며 다른 테마 화면은 계속 검사한다.
const CUSTOM_HEADING_ROUTE_DIRS = [
  "app/(app)/chat", "app/(app)/checklist", "app/(app)/lounge",
  "app/(app)/budget", "app/(app)/schedule",
];

/**
 * 두 레이아웃에서 `<main>` **밖**에 놓이는 슬롯. 여기서 시작해 import 를 전이적으로 따라간
 * 것이 전부 "블록이 안 걸리는" 파일이다.
 *
 *   app/(community)/layout.tsx     : `<main>{children}</main>` 앞뒤의 Nav·Toast·Footer·Launcher
 *   app/(app)/AppClientLayout.tsx  : Sidebar·TopNav·banner·AiNoticeFooter·GlobalChatAssistant
 */
const OUTSIDE_MAIN_SLOTS = [
  "app/(community)/layout.tsx",
  "app/(app)/AppClientLayout.tsx",
  // `banner` prop 으로 `<main>` **앞**에 놓인다(AuthenticatedAppShell.tsx:31).
  // 오늘은 제목이 0개라 무해하지만, 슬롯의 성격은 지금 적어 둔다.
  "app/(app)/DemoModeBanner.tsx",
  "components/app/Sidebar.tsx",
  "components/app/TopNav.tsx",
  "components/app/chat/ChatSidePanel.tsx",
  "components/common/AiNoticeFooter.tsx",
  "components/community/CommunityAuthInitializer.tsx",
  "components/community/CommunityNav.tsx",
  "components/community/Toast.tsx",
  "components/community/CommunityAmoraLauncher.tsx",
];

const ROUTE_FILES = new Set([
  "page.tsx", "layout.tsx", "template.tsx", "loading.tsx", "error.tsx", "not-found.tsx", "default.tsx",
]);

/** `@/`·상대 경로·`import()` 를 전부 잡는다. `@/` 만 보면 사이드 패널 자식들을 통째로 놓친다. */
const IMPORT_SPEC = /(?:from\s*|import\s*\(\s*)"([^"]+)"/g;

/**
 * 블록이 덮는 네 가지 — font-size · font-weight · line-height · letter-spacing.
 *
 * 정규식 **리터럴**로 쓴다. 같은 저장소에서 템플릿 리터럴로 만든 가드가 이스케이프를
 * 먹혀 죽은 채로 통과한 적이 있다.
 *
 * `font-serif-kr`·`font-display`는 블록이 **겨냥하는 선택자**라 대상이 아니고,
 * CSS 변수를 담은 색 유틸리티나 `text-center` 같은 정렬도 아니다 — 단위가 붙은 것만
 * 크기다.
 *
 * ⚠️ 이 주석에 **클래스처럼 보이는 문자열을 쓰지 마라.** Tailwind v4 는 소스를 훑어
 * 클래스를 만들기 때문에, 여기 적은 예시가 그대로 CSS 가 된다. 실제로 대괄호 안에
 * 줄임표를 넣은 예시 하나가 파싱 불가능한 규칙을 만들어 **개발 서버를 죽였다**
 * (2026-08-31, 운영 빌드는 통과해서 배포 뒤에야 드러났다).
 *
 * **`!` 가 앞에 붙은 유틸리티(`!text-[22px]`·`md:!text-[24px]`)는 대상이 아니다.**
 * 캐스케이드는 특정도보다 레이어를 먼저 보고, `!important` 선언에서는 레이어 순서가
 * **뒤집힌다** — `@layer utilities` 안의 `!important` 가 레이어 **밖**의 `!important`
 * 를 이긴다. 블록은 레이어 밖이므로 이 유틸리티에는 진다.
 *
 * 추측이 아니라 실측이다. 운영 `/wedding?feed=all` 의 `#community-search-heading` 은
 * 1584px 뷰포트에서 **24px** 로 나온다 — 블록의 clamp(최대 30px)가 아니라
 * `md:!text-[24px]` 값이다. 그것을 지웠다가 되돌렸다.
 */
const DEAD_TYPE_CLASS =
  /(?<![\w:./!-])(?:[a-z0-9-]+:)*(?:text-(?:xs|sm|base|lg|xl|[2-9]xl|\[[^\]]*(?:px|rem|em)\])|font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)|tracking-(?:tighter|tight|normal|wide|wider|widest|\[[^\]]*\])|leading-(?:none|tight|snug|normal|relaxed|loose|\[[^\]]*\]|\d+))(?![\w./-])/g;

const HEADING = /<h[1-6]\b/gi;
const CLASS_NAME = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function resolveSpec(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const suffix of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    const full = base + suffix;
    if (existsSync(full) && statSync(full).isFile()) return toPosix(full);
  }
  return null;
}

function closure(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file) || !existsSync(file) || !statSync(file).isFile()) continue;
    seen.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(IMPORT_SPEC)) {
      const dep = resolveSpec(m[1], file);
      if (dep && !seen.has(dep)) queue.push(dep);
    }
  }
  return seen;
}

function routeEntries(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) routeEntries(full, out);
    else if (ROUTE_FILES.has(name)) out.push(toPosix(full));
  }
  return out;
}

/** `createPortal(x, document.body)` 로 그리면 DOM 상 `main` 밖이다. 호출을 보고 거른다. */
function portalsToBody(text: string): boolean {
  return text.includes("createPortal") && /createPortal\([\s\S]{0,200}?document\.body/.test(text);
}

function targetFiles(): string[] {
  const themed = THEMED_ROUTE_DIRS.flatMap((d) => routeEntries(path.join(SRC, d)));
  const unthemed = [
    ...[...UNTHEMED_ROUTE_DIRS, ...CUSTOM_HEADING_ROUTE_DIRS].flatMap((d) => routeEntries(path.join(SRC, d))),
    ...["app/layout.tsx", "app/page.tsx", "app/error.tsx", "app/not-found.tsx", "app/loading.tsx"]
      .map((f) => toPosix(path.join(SRC, f)))
      .filter((f) => existsSync(f)),
  ];
  const inside = closure(themed);
  const outside = closure(OUTSIDE_MAIN_SLOTS.map((f) => toPosix(path.join(SRC, f))));
  const unthemedClosure = closure(unthemed);

  return [...inside]
    .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx") && !f.includes("/__tests__/"))
    .filter((f) => !outside.has(f) && !unthemedClosure.has(f))
    .filter((f) => !portalsToBody(readFileSync(f, "utf8")))
    .sort();
}

type Finding = { file: string; tag: string; dead: string[] };

function scan(): { findings: Finding[]; headings: number; files: number } {
  const files = targetFiles();
  const findings: Finding[] = [];
  let headings = 0;

  for (const file of files) {
    const text = readFileSync(file, "utf8");

    // 소스에서 `<footer>`·`<header>` 안인지는 보지 않는다. 대상 파일은 정의상 전부
    // 레이아웃의 `<main>` 안에 놓이므로, 그 안의 `<header>`(페이지 자기 히어로)도
    // `main h1` 후손 선택자에 걸린다. 처음엔 랜드마크 안을 건너뛰었는데 그것이
    // moderation·vendor/[name]·ChecklistContent 의 제목을 근거 없이 빼고 있었다.
    // `main` 밖에 진짜로 놓이는 푸터·내비는 **파일 단위 폐포**가 이미 걷어낸다.
    for (const m of text.matchAll(HEADING)) {
      const at = m.index;
      headings += 1;

      CLASS_NAME.lastIndex = at;
      const cm = CLASS_NAME.exec(text);
      if (!cm || cm.index > at + 3000) continue;
      if (text.slice(at, cm.index).includes(">")) continue; // 이 태그의 className 이 아니다

      const dead = (cm[1] ?? cm[2] ?? "").match(DEAD_TYPE_CLASS);
      if (dead) {
        findings.push({ file: toPosix(path.relative(WEB_ROOT, file)), tag: text.slice(at, at + 3), dead });
      }
    }
  }
  return { findings, headings, files: files.length };
}

describe("테마 안 제목 타이포", () => {
  it("keeps the approved Amora and planning HTML headings out of the generic bridge", () => {
    const css = readFileSync(path.join(SRC, "app/globals.css"), "utf8");
    expect(css).toContain(".hanbang-service-theme:not(.amora-workspace):not(.planning-workspace) main h2");
    const files = new Set(targetFiles().map((file) => toPosix(path.relative(WEB_ROOT, file))));
    expect(files.has("src/app/(app)/lounge/page.tsx")).toBe(false);
    expect(files.has("src/components/app/amora-missions/AmoraMissions.tsx")).toBe(false);
    expect(files.has("src/components/app/amora-board/AmoraDecisionBoard.tsx")).toBe(false);
    expect(files.has("src/components/app/checklist/ChecklistContent.tsx")).toBe(false);
    for (const rel of [
      "src/app/(app)/budget/page.tsx",
      "src/app/(app)/schedule/page.tsx",
      "src/components/app/budget/BudgetContent.tsx",
      "src/components/app/budget/BudgetShareChart.tsx",
      "src/components/app/schedule/ScheduleContent.tsx",
      "src/components/app/schedule/CalendarView.tsx",
      "src/components/app/schedule/EventFormModal.tsx",
      "src/components/app/schedule/PreparationTimeline.tsx",
      "src/components/app/schedule/TimelineView.tsx",
    ]) {
      expect(files.has(rel), `${rel} 는 planning 제목 크기를 사용한다`).toBe(false);
    }
    // 승인한 두 라우트를 추가해도 일반 테마 화면까지 검사에서 빠지면 안 된다.
    expect(files.has("src/app/(app)/settings/page.tsx")).toBe(true);
    expect(files.has("src/app/(app)/bookings/page.tsx")).toBe(true);
  });
  it("측정기가 살아 있다", () => {
    const { headings, files } = scan();

    // 스캔이 비면 "죽은 클래스 0개"가 되어 **무조건 통과**한다. 이 저장소에서 그런 식으로
    // 초록불을 낸 가드가 여러 번 있었다. 그래서 넷을 함께 확인한다.
    expect(files, "대상 파일을 못 찾았다 — 라우트 스캔이나 import 해석이 깨졌다")
      .toBeGreaterThan(60);
    expect(headings, "대상에서 제목을 못 찾았다 — 랜드마크 판정이 깨졌다")
      .toBeGreaterThan(120);

    const sample = "font-serif-kr text-2xl font-semibold tracking-tight leading-snug";
    expect(sample.match(DEAD_TYPE_CLASS), "정규식이 죽은 클래스를 못 잡는다")
      .toEqual(["text-2xl", "font-semibold", "tracking-tight", "leading-snug"]);

    const keep = "font-serif-kr font-display text-center text-[var(--hb-text-strong)]";
    expect(keep.match(DEAD_TYPE_CLASS), "정규식이 지우면 안 되는 클래스를 잡는다").toBeNull();

    // `!` 유틸리티는 레이어 안 !important 라 블록을 **이긴다** — 지우면 화면이 바뀐다.
    // 실제로 한 번 지워서 24px 제목을 30px 로 만들 뻔했고, 게다가 `!text-[22px]` 에서
    // `text-[22px]` 만 떼어내 `!` 와 `md:!` 라는 쓰레기 토큰을 남겼다.
    const important = "mt-0.5 font-serif-kr !text-[22px] md:!text-[24px]";
    expect(important.match(DEAD_TYPE_CLASS), "정규식이 ! 유틸리티를 건드린다").toBeNull();
  });

  it("main 밖 컴포넌트를 대상에서 제외한다", () => {
    const files = new Set(targetFiles().map((f) => toPosix(path.relative(WEB_ROOT, f))));

    // 2026-08-31에 실제로 회귀를 만들 뻔한 아홉 개. 폐포 계산이 얕아지면(예: `@/` import만
    // 따라가면) 이것들이 다시 대상에 들어오고, 지우는 순간 제목이 16px/400으로 내려앉는다.
    for (const rel of [
      "src/app/(community)/layout.tsx",
      "src/components/app/chat/PendingAmoraActionCard.tsx",
      "src/components/app/chat/MediationCard.tsx",
      "src/components/app/chat/ChatBubble.tsx",
      "src/components/app/chat/MediationConsentDialog.tsx",
      "src/components/app/chat/AmoraPersonalizationPrompt.tsx",
      "src/components/app/chat/VendorToolCard.tsx",
      "src/components/app/NotificationPanel.tsx",
      "src/components/app/schedule/CategoryChecklistModal.tsx",
    ]) {
      expect(files.has(rel), `${rel} 는 main 밖에서 렌더된다 — 대상에 들어오면 안 된다`).toBe(false);
    }
  });

  it("작은 제목 단에 크기 유틸리티를 얹지 않는다", () => {
    // `hb-h-sm`·`hb-h-eyebrow` 는 크기를 정하는 클래스다. 거기에 유틸리티를 얹으면
    // 둘 중 무엇이 이기는지가 자리마다 갈린다 — 보통 유틸리티는 지고(레이어 안),
    // `!` 유틸리티는 이긴다. DESIGN.md 2026-08-27 규칙("크기를 정하는 CSS 클래스에는
    // 유틸리티 크기를 얹지 않는다")을 제목에도 적용한다.
    const STEP = /(?<![\w-])hb-h-(sm|eyebrow)(?![\w-])/;
    const ANY_TYPE = /(?:[a-z0-9-]+:)*!?(?:text-(?:xs|sm|base|lg|xl|[2-9]xl|\[[^\]]*(?:px|rem|em)\])|font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)|tracking-\S+|leading-\S+)/g;

    const offenders: string[] = [];
    let checked = 0;
    for (const file of targetFiles()) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(CLASS_NAME)) {
        const value = m[1] ?? m[2] ?? "";
        if (!STEP.test(value)) continue;
        checked += 1;
        const stacked = value.match(ANY_TYPE);
        if (stacked) {
          offenders.push(`${toPosix(path.relative(WEB_ROOT, file))} — ${stacked.join(" ")}`);
        }
      }
    }

    expect(checked, "hb-h-sm / hb-h-eyebrow 를 하나도 못 찾았다 — 스캔이 깨졌다")
      .toBeGreaterThan(8);
    expect(offenders, "작은 제목 단 위에 크기 유틸리티가 얹혀 있습니다").toEqual([]);
  });

  it("크기·굵기·행간·자간 클래스를 달지 않는다", () => {
    const { findings } = scan();

    const lines = findings.map((f) => `${f.file} ${f.tag}> ${f.dead.join(" ")}`);
    expect(
      lines,
      `테마 안 제목 ${findings.length}곳이 화면에 안 먹는 타이포 클래스를 달고 있습니다. `
        + `globals.css의 제목 블록이 !important로 덮으므로 파일의 값은 무시됩니다 — `
        + `클래스를 지우거나, 정말 다른 크기가 필요하면 globals.css에서 정하세요.`,
    ).toEqual([]);
  });
});
