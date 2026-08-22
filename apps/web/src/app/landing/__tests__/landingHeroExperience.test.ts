// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(process.cwd());
const hero = readFileSync(
  resolve(appRoot, "src/components/landing/redesign/TransformationHero.tsx"),
  "utf8",
);
const content = readFileSync(
  resolve(appRoot, "src/components/landing/redesign/landingContent.ts"),
  "utf8",
);
const displayType = readFileSync(
  resolve(appRoot, "src/components/landing/redesign/landingType.ts"),
  "utf8",
);
/** 헤드라인을 가진 랜딩 섹션 컴포넌트 — 타입·모션 시스템을 함께 지켜야 한다. */
const sectionSources: ReadonlyArray<readonly [string, string]> = [
  "ProblemMirrorSection",
  "PreparationResult",
  "ContinuitySection",
  "SharedPrivateSection",
  "CommunityBridgeSection",
  "TrustEvidenceSection",
  "ClosingAction",
].map((name) => [
  `${name}.tsx`,
  readFileSync(resolve(appRoot, `src/components/landing/redesign/${name}.tsx`), "utf8"),
] as const);

function sourceWindowAround(copy: string, before = 500, after = 260): string {
  const copyIndex = hero.indexOf(copy);
  expect(copyIndex, `새 Hero에서 계약 문구를 찾지 못함: ${copy}`).toBeGreaterThanOrEqual(0);
  return hero.slice(Math.max(0, copyIndex - before), copyIndex + copy.length + after);
}

describe("landing hero product experience contract", () => {
  it("explains the product in plain language before asking for action", () => {
    expect(content).toContain("웨딩한방 · 둘이 함께 관리하는 결혼 준비 공간");
    expect(content).toContain("아모라 · 대화를 정리하는 AI");
    expect(content).toContain("먼저 살펴볼 준비 3가지");
    expect(content, "산출물을 개수로만 말하면 안 된다").not.toMatch(/지금 볼 세 가지가 나와요/u);
    expect(hero, "히어로가 아모라로 이어지지 않는다").toContain("아모라");
    expect(content).toContain("계정을 만들면 아모라가 한 번에 한 가지 변경을 제안하고");
    expect(content).toContain("한 번에 한 가지 변경을 제안하고");
    expect(content).toContain("확인한 변경만 준비 기록에 반영해요");
    expect(content).toContain("아모라와 시작하기");
    expect(hero).toContain("예산");
    expect(hero).toContain("할 일");
    expect(hero).toContain("일정");
    expect(hero).toContain("변경 제안");
    expect(hero).toContain("준비에 반영");
    expect(hero).not.toContain("landingContent.hero.emotionalLine");
  });

  it("keeps the no-login first-step action visible from the smallest breakpoint", () => {
    const startHereCta = sourceWindowAround("type=\"submit\"", 80, 900);

    expect(content).toContain("아모라와 시작하기");
    expect(startHereCta).not.toMatch(/className="[^"]*(?:^|\s)hidden(?:\s|$)[^"]*"/);
    expect(hero).toContain('const amoraStartHref = "/start-here"');
    expect(hero).toContain('id="landing-wedding-date"');
    expect(hero).toContain("로그인·결제 없이 준비 3가지 확인");
    expect(hero).toContain("없어도 시작 가능");
    expect(hero).toContain("첫 날짜 계산은 이 브라우저에서 처리");
    expect(hero).toContain("AI 처리·대화 저장 정책이 적용돼요");
  });

  it("shows one concrete proposal and demonstrates only that applied item without a live AI call", () => {
    const demoSource = hero.slice(hero.indexOf("function ConversationToPlanDemo"));

    expect(hero).toContain('type DemoState = "proposal" | "saved"');
    expect(hero).toContain('useState<DemoState>("proposal")');
    expect(hero).toContain("아모라의 첫 번째 변경 제안");
    expect(hero).toContain("이 일정을 추가할까요?");
    expect(hero).toContain("아직 반영 전");
    expect(hero).toContain("이 일정 반영 예시 보기");
    expect(hero).toContain("각각 별도 제안과 확인이 필요해요");
    expect(hero).not.toContain("세 가지를 찾았어요");
    expect(content).toContain("기능 예시 · 이 화면에서는 실제로 저장되지 않아요");

    for (const forbiddenPersistenceOrNetworkCall of [
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "document.cookie",
      "navigator.sendBeacon",
      "XMLHttpRequest",
      "FormData",
      "fetch(",
      "anthropic",
      "openai",
    ]) {
      expect(demoSource.toLowerCase()).not.toContain(
        forbiddenPersistenceOrNetworkCall.toLowerCase(),
      );
    }
  });

  it("keeps analytics bounded to a non-sensitive source label", () => {
    const captureCalls = [
      ...hero.matchAll(/captureEvent\(\s*"([^"]+)"\s*,\s*\{([\s\S]*?)\}\s*\)/g),
    ];

    expect(captureCalls.length).toBeGreaterThanOrEqual(2);
    for (const [, eventName, payload] of captureCalls) {
      const payloadKeys = [...payload.matchAll(/([A-Za-z_]\w*)\s*:/g)].map(
        (match) => match[1],
      );
      expect(payloadKeys, `${eventName} 이벤트는 source만 전송해야 함`).toEqual(["source"]);
    }
  });

  it("keeps headline and trust-critical copy readable on mobile", () => {
    const h1 = hero.match(/<h1[\s\S]*?<\/h1>/)?.[0] ?? "";
    expect(h1).not.toContain("whitespace-nowrap");

    for (const copy of ["로그인·결제 없이 준비 3가지 확인", "직접 눌러보는 예시"]) {
      const nearbySource = sourceWindowAround(copy);
      expect(nearbySource).not.toMatch(/className="[^"]*\bhidden\b[^"]*"/);
      expect(nearbySource).not.toMatch(/text-\[(?:8|9)px\]/);
    }
  });

  it("leads with the first-visit outcome and keeps the account-beta boundary after the CTA", () => {
    const body = content.match(/^\s*body:\s*"([^"]*)"/mu)?.[1] ?? "";
    const betaBoundary = content.match(/^\s*betaBoundary:\s*"([^"]*)"/mu)?.[1] ?? "";

    // 첫 문단은 "무엇을 넣으면 무엇이 나오는지"만 말한다. 그리고 출력을 **개수가
    // 아니라 이름으로** 말해야 한다 — 이전 문구는 "세 가지"라고만 해서 그 셋이
    // 무엇인지 랜딩 어디에도 없었다.
    expect(body).toContain("먼저 살펴볼 준비 3가지");
    expect(body, "산출물을 개수로만 말하면 안 된다").not.toContain("지금 볼 세 가지가 나와요");
    // 본문은 이 자리에서 되는 것만 말한다. 아모라 연결은 CTA와 폼 안내가 맡는다.
    expect(hero, "히어로가 아모라로 이어지지 않는다").toContain("아모라");
    expect(body).not.toContain("계정 베타");

    // 경계 문구는 사라지지 않는다. 위계만 CTA 아래로 내려간다.
    expect(betaBoundary).toContain("계정을 만들면 아모라가 한 번에 한 가지 변경을 제안하고");
    expect(betaBoundary).toContain("확인한 변경만 준비 기록에 반영해요");
    expect(hero).toContain("landingContent.hero.betaBoundary");
    expect(hero.indexOf("landingContent.hero.body")).toBeLessThan(
      hero.indexOf('type="submit"'),
    );
    expect(hero.indexOf('type="submit"')).toBeLessThan(
      hero.indexOf("landingContent.hero.betaBoundary"),
    );
  });

  it("keeps the headline and the primary action inside the first 320px viewport", () => {
    // 320x568에서 헤드라인부터 기본 CTA까지가 첫 화면 안에 들어와야 한다.
    // 아래 값들은 실측(320px에서 CTA bottom 503 < 568)으로 확인한 여백 예산이라
    // 조용히 되돌아가지 않게 고정한다.
    expect(hero).toContain("gap-8 pb-12 pt-5 sm:gap-11 sm:pb-14 sm:pt-10");
    expect(displayType).toContain("text-[clamp(2.4rem,10.5vw,4.25rem)]");
    expect(hero).toMatch(/<h1[\s\S]*?className=\{`mt-4 \$\{displayHero\}/u);
    expect(hero).not.toContain("pt-8 sm:gap-11");
    expect(displayType).not.toContain("clamp(2.75rem,11vw,4.25rem)");
  });

  it("drives every landing headline from one three-step display scale", () => {
    // 이전에는 8개 섹션이 각자 다른 clamp 곡선·leading·tracking을 썼고, 그 결과
    // 1280px 실측에서 신뢰(72px)·마무리(73.6px)가 H1(68px)보다 커지는 위계 역전이
    // 있었다. 랜딩에서 가장 큰 타입은 언제나 H1이어야 한다.
    const rem = (name: string) => {
      const curve = displayType.match(
        new RegExp(`export const ${name}\\s*=\\s*[\\s\\S]*?clamp\\(([^)]*)\\)`, "u"),
      )?.[1];
      expect(curve, `${name} 곡선을 찾지 못함`).toBeTruthy();
      const max = (curve ?? "").split(",").at(-1)?.trim() ?? "";
      const parsed = Number.parseFloat(max.replace("rem", ""));
      expect(Number.isFinite(parsed), `${name} 최대값 파싱 실패: ${max}`).toBe(true);
      return parsed;
    };

    expect(rem("displaySection")).toBeLessThan(rem("displayHero"));
    expect(rem("displayMuted")).toBeLessThan(rem("displaySection"));

    // 섹션 컴포넌트는 자기만의 곡선을 새로 만들지 않는다.
    for (const [file, source] of sectionSources) {
      const inlineCurves = [...source.matchAll(/text-\[clamp\([^\]]*\)\]/gu)].map((m) => m[0]);
      expect(inlineCurves, `${file}이 인라인 clamp 곡선을 다시 만들었다`).toEqual([]);
      expect(source).toMatch(/\$\{display(Section|Muted)\}/u);
    }

    // 한글 헤드라인 고아 글자 방지. keep-all은 어절 단위로만 끊고, 마지막 줄에
    // 한 어절만 남는 것("… 해야 할 / 일.")은 text-balance가 막는다.
    for (const name of ["displayHero", "displaySection", "displayMuted"]) {
      expect(displayType).toMatch(new RegExp(`export const ${name}[\\s\\S]*?text-balance`, "u"));
    }
  });

  it("actually disables the unlayered animations under prefers-reduced-motion", () => {
    // globals.css는 .animate-fade-in 등을 @layer 밖에서 선언한다. cascade layer
    // 규칙상 layer 밖 선언이 항상 이기므로 Tailwind가 @layer utilities에 넣는
    // `motion-reduce:animate-none`은 이들을 덮지 못한다. 실제 Chrome에서
    // reduced motion인데도 animation-name이 fadeIn으로 남는 것을 확인했다.
    // 따라서 같은 unlayered 위치의 @media 블록으로 꺼야 한다.
    const globals = readFileSync(resolve(appRoot, "src/app/globals.css"), "utf8");
    const reduceBlock = globals.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/u,
    )?.[0];
    expect(reduceBlock, "prefers-reduced-motion 블록을 찾지 못함").toBeTruthy();

    const unlayered = [...globals.matchAll(/^\.([a-zA-Z][\w-]*)\s*\{\n\s*animation:/gmu)]
      .map((m) => m[1])
      .filter((cls) => !cls.startsWith("c6-"));
    expect(unlayered.length, "unlayered animation 클래스를 찾지 못함").toBeGreaterThan(0);

    for (const cls of unlayered) {
      expect(
        reduceBlock ?? "",
        `.${cls}이 prefers-reduced-motion에서 꺼지지 않는다`,
      ).toContain(`.${cls}`);
    }
  });

  it("does not ship motion-reduce classes that target the wrong property", () => {
    // Tailwind v4의 translate-* 유틸리티는 `transform`이 아니라 독립 `translate`
    // 속성을 쓴다. 그래서 `motion-reduce:transform-none`은 아무것도 되돌리지
    // 못하고, group-hover 변형보다 특이도도 낮다. 이동 자체를 `motion-safe:`로
    // 감싸는 것이 유일하게 동작하는 형태다.
    for (const [file, source] of [...sectionSources, ["TransformationHero.tsx", hero] as const]) {
      expect(source, `${file}: motion-reduce:transform-none은 무효 클래스다`)
        .not.toMatch(/className=[^>]*motion-reduce:transform-none/u);
      const moves = [...source.matchAll(/(?<!motion-safe:)group-hover:translate-[xy]-[\w.]+/gu)];
      expect(moves.map((m) => m[0]), `${file}: hover 이동은 motion-safe로 감싼다`).toEqual([]);
    }
  });

  it("keeps landing transitions inside the DESIGN.md motion band", () => {
    // DESIGN.md: micro 80ms / short 160-220ms / medium 300-450ms.
    // Tailwind의 transition-* 기본값은 150ms라 어느 밴드에도 들지 않는다.
    for (const [file, source] of [...sectionSources, ["TransformationHero.tsx", hero] as const]) {
      const bare = [...source.matchAll(/transition-[a-z[][^\s"`]*/gu)]
        .map((m) => m[0])
        .filter((util) => !new RegExp(`${util.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s+duration-`, "u").test(source));
      expect(bare, `${file}에 duration 없는 transition이 남아 있다`).toEqual([]);
    }
  });

  it("keeps the hero compact and prioritizes the result on smaller screens", () => {
    expect(hero).toContain("lg:min-h-[min(720px,calc(100svh-4rem))]");
    expect(hero).not.toContain("lg:min-h-[min(820px");
    expect(hero).toContain('<div className="relative z-10 max-w-[610px]">');
    expect(hero).toContain("md:grid-cols-[0.88fr_1.12fr]");
  });

  it("shows the two-person conversation on mobile, because the H1 promises it", () => {
    // 이전 계약은 대화 컬럼을 `hidden ... md:block`으로 숨겨 히어로를 짧게 유지했다.
    // 그런데 H1이 "둘이 말하면"이라 두 사람이 말하는 장면이 모바일에서 사라지면
    // 첫 화면의 약속과 증거가 어긋난다. 모바일이 주 뷰포트이므로 보이게 하되,
    // 오른쪽 제안 패널과 중복되는 보조 설명만 데스크톱으로 미뤄 길이를 되돌린다.
    expect(hero).not.toContain("hidden border-b border-[#243832]/10");
    expect(hero).toContain("border-b border-[#243832]/10 bg-white px-4 py-4 sm:px-5 md:border-b-0 md:border-r");
    expect(hero).toContain("hidden items-start gap-2.5 border-t border-[#243832]/10 pt-4 md:flex");

    // 대화 자체는 두 사람 이름과 두 발화가 모두 있어야 한다.
    for (const line of ["민지", "현우", "예산은 3천만 원으로 생각하고 있어."]) {
      expect(content, `데모 대화에서 ${line}이 빠졌다`).toContain(line);
    }
  });
});
