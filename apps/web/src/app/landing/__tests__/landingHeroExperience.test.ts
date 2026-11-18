// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { START_COPY } from "@hanbang/shared/invitation";

import LandingPage from "../page";
import {
  APP_ROOT,
  CONTENT_PATH,
  everyLandingComponent,
  rendered,
  renderedSections,
  source,
  stripComments,
} from "./landingSource";

vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));

/**
 * 시작 화면 경험 계약.
 *
 * 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)로 랜딩의 첫 화면은 앱의
 * '시작' 화면(`Main.dc.html`)이 됐다. 옛 히어로(테이프 이름표·앱 미리보기·세 단계 안내·꽃
 * 장식)와 그 뒤 섹션 여덟을 지키던 단언은 대상이 없어져 지웠다. 남긴 계약:
 *
 *   - 첫 화면의 글자는 앱과 같은 정본(`START_COPY`)에서 오고, 아티팩트 순서 그대로다.
 *   - 시작하기는 로그인을 거쳐 아모라로, 예시 커플로 둘러보기는 로그인 없이 예시 화면으로 간다.
 *   - 첫 화면에 아티팩트에 없는 것을 얹지 않는다(고지는 첫 화면 아래 바닥글이 진다).
 *   - 랜딩은 저장도 네트워크 호출도 하지 않고, 계측은 자리 이름만 싣는다.
 *   - 움직임 줄이기·전이 시간 규칙.
 *
 * ⚠️ 아티팩트의 첫 화면에는 "AI" 라는 말이 없다(한 줄은 "두 사람의 웨딩 비서"). 옛 판은
 * 첫 화면이 아모라를 AI 라고 소개하도록 요구했다. 지금 그 고지는 같은 페이지의 바닥글
 * ("아모라의 답변은 AI가 작성해요")이 진다 — 아래에서 그것이 렌더되는지 본다. 첫 화면에도
 * 둘지는 제품·법무 판단이라 리드에게 넘겼다.
 */

function landingDocument(): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(createElement(LandingPage)), "text/html");
}

const flat = (text: string | null | undefined) => (text ?? "").replace(/\s+/gu, " ").trim();

const everyComponent = everyLandingComponent();
const startScreen = rendered("src/components/landing/redesign/StartScreen.tsx");
const content = rendered(CONTENT_PATH);

/**
 * 화면에서 무엇을 **감추는** 유틸리티 전부. 변형 접두사(`max-sm:`·`min-[360px]:`)와 className
 * 맨 앞에 온 경우까지 잡는다(옛 정규식이 둘 다 놓쳤다).
 */
const HIDING_UTILITY =
  /(?:^|\s)(?:[\w[\]@&().#%/*+~:-]+:)?(?:hidden|invisible|sr-only|opacity-0)(?=\s|$)/u;

/** 한 파일 안의 모든 className 값(문자열·템플릿 리터럴). */
function classValues(text: string): string[] {
  return [...text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/gu)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? "",
  ).concat([...text.matchAll(/^(?:export )?const \w+\s*=\s*\n?\s*["`]([^"`]*)["`]/gmu)].map((m) => m[1]));
}

describe("처음 방문한 사람이 보는 시작 화면", () => {
  it("아티팩트의 글자를 앱과 같은 정본에서 읽어 그대로 그린다", () => {
    const doc = landingDocument();
    const card = doc.querySelector('section[aria-labelledby="start-title"]');
    const h1 = doc.querySelector("h1#start-title");
    expect(h1, "시작 화면 제목이 없다").toBeTruthy();
    expect([...(h1?.querySelectorAll(":scope > span") ?? [])].map((line) => line.textContent))
      .toEqual([...START_COPY.headingLines]);
    expect(flat(card?.querySelector("p")?.textContent)).toBe(START_COPY.body);
    expect(flat(card?.querySelector('a[href="/wedding/chat"]')?.textContent)).toBe(START_COPY.start);
    expect(flat(card?.querySelector('a[href="/example"]')?.textContent)).toBe(START_COPY.example);
    const main = doc.querySelector("main");
    const texts = [...(main?.querySelectorAll("span") ?? [])].map((span) => span.textContent);
    expect(texts).toContain(START_COPY.wordmark);
    expect(texts).toContain(START_COPY.tagline);

    // 문구를 화면 파일에 다시 적지 않는다(SPEC). 다시 적으면 앱과 웹이 갈린다.
    for (const value of [...START_COPY.headingLines, START_COPY.body, START_COPY.tagline, START_COPY.start, START_COPY.example]) {
      for (const [file, text] of [...everyComponent, ["landingContent.ts", content] as const]) {
        expect(text, `${file} 가 START_COPY 문구를 손으로 적었다: ${value}`).not.toContain(value);
      }
    }
    expect(startScreen, "시작 화면이 정본을 읽지 않는다").toMatch(/from "@hanbang\/shared\/invitation"/u);
  });

  it("아티팩트 순서 그대로다: 로고 → 오브 → 제목 → 본문 → 시작하기 → 예시", () => {
    const doc = landingDocument();
    const main = doc.querySelector("main")!;
    const order = [
      [...main.querySelectorAll("span")].find((span) => span.textContent === START_COPY.wordmark),
      main.querySelector("svg.amora-orb"),
      main.querySelector("h1"),
      main.querySelector("h1 + p"),
      main.querySelector('a[href="/wedding/chat"]'),
      main.querySelector('a[href="/example"]'),
    ];
    order.forEach((node, index) => expect(node, `순서 ${index} 를 찾지 못했다`).toBeTruthy());
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & 4, `순서 ${i - 1} → ${i} 가 뒤집혔다`).toBe(4);
    }
  });

  it("시작하기는 로그인을 거쳐 아모라로, 예시 커플은 로그인 없이 예시 화면으로 간다", () => {
    // 시작하기의 목적지는 옛 히어로 1차 버튼과 같다(`/wedding/chat`, 로그인·시작 설정을 거쳐
    // 돌아오는 보호 경로). 예시 커플은 로그인 없이 보는 예시 화면이다(SPEC).
    expect(content).toMatch(/primary:\s*\{\s*href:\s*"\/wedding\/chat"\s*\}/u);
    expect(content).toMatch(/example:\s*\{\s*href:\s*"\/example"\s*\}/u);
    // 로그인이 필요한 목적지는 랜딩에서 미리 받지 않는다(옛 히어로·헤더와 같다).
    const primaryTag = startScreen.slice(startScreen.indexOf("<TrackedLandingLink"), startScreen.indexOf(">", startScreen.indexOf("start.primary.href")));
    expect(primaryTag).toContain("start.primary.href");
    expect(primaryTag, "시작하기가 보호 경로를 미리 받는다").toContain("prefetch={false}");
    // 계측 컴포넌트가 그 값을 정말 `next/link` 까지 넘기는지(공유 Button 의 타입에는 없다).
    // (`rendered` 는 JSX 주석 껍데기로 남는 빈 `{}` 를 걷으므로 뒤쪽 빈 객체는 묻지 않는다.)
    const tracked = rendered("src/components/landing/redesign/TrackedLandingLink.tsx");
    expect(tracked).toMatch(/const linkOptions = prefetch === false \? \{ prefetch \}/u);
    expect(tracked).toMatch(/\{\.\.\.linkOptions\}/u);
  });

  it("첫 화면에 아티팩트에 없는 것을 얹지 않는다", () => {
    // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 시작 화면은 사진·로고·
    // 오브·카드뿐이다. 고지는 바닥글이 지고, 머리줄은 로그인 알약 하나다.
    expect(renderedSections()).toEqual(["StartScreen"]);
    const doc = landingDocument();
    const main = doc.querySelector("main")!;
    expect(main.querySelectorAll("h1")).toHaveLength(1);
    expect(main.querySelectorAll("h2, h3, h4, h5, h6")).toHaveLength(0);
    expect(main.querySelectorAll("a")).toHaveLength(2);
    expect(main.querySelectorAll("button, input, select, textarea, form, details")).toHaveLength(0);
    expect(main.querySelectorAll("p")).toHaveLength(1);
    expect(main.querySelectorAll("section")).toHaveLength(1);
    const header = doc.querySelector("header");
    expect([...(header?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href")))
      .toEqual(["/login?redirect=%2Fwedding%2Fchat"]);
    expect(flat(header?.textContent)).toBe("로그인");
  });

  it("아모라가 AI라는 사실을 같은 페이지가 말한다", () => {
    // 아티팩트의 첫 화면은 "AI" 라고 쓰지 않는다. 그 고지는 바닥글이 진다(머리말 참조).
    const footer = flat(landingDocument().querySelector("footer")?.textContent);
    expect(footer).toContain("아모라의 답변은 AI가 작성해요");
    expect(footer).toContain("AI 답변에는 오류가 있을 수 있어요");
  });

  it("랜딩은 저장도 네트워크 호출도 하지 않는다", () => {
    // 데모가 어디로 옮겨 가도 잡히게 폴더 전체를 센다.
    for (const forbidden of [
      "localStorage", "sessionStorage", "indexedDB", "document.cookie", "navigator.sendBeacon",
      "XMLHttpRequest", "FormData", "fetch(", "anthropic", "openai",
    ]) {
      for (const [file, text] of everyComponent) {
        expect(text.toLowerCase(), `${file}: 랜딩이 ${forbidden}에 손댔다`).not.toContain(forbidden.toLowerCase());
      }
    }
  });

  it("계측은 자리 이름만 싣는다", () => {
    // 옛 검사는 `captureEvent("name", { … })` 리터럴만 읽어 변수로 넘기면 안 보였다.
    // 호출 자체를 세고, 인자를 괄호 맞춤으로 꺼내 객체 리터럴의 키를 본다.
    const calls: Array<{ file: string; args: string[] }> = [];
    for (const [file, text] of everyComponent) {
      let from = 0;
      for (;;) {
        const at = text.indexOf("captureEvent(", from);
        if (at < 0) break;
        from = at + "captureEvent(".length;
        if (/[\w.]/u.test(text[at - 1] ?? "")) continue;
        let i = from;
        let depth = 1;
        let quote = "";
        const parts: string[] = [];
        let current = "";
        while (i < text.length && depth > 0) {
          const c = text[i];
          if (quote) {
            if (c === "\\") {
              current += c + (text[i + 1] ?? "");
              i += 2;
              continue;
            }
            if (c === quote) quote = "";
            current += c;
          } else if (c === '"' || c === "'" || c === "`") {
            quote = c;
            current += c;
          } else if ("({[".includes(c)) {
            depth += 1;
            current += c;
          } else if (")}]".includes(c)) {
            depth -= 1;
            if (depth === 0) break;
            current += c;
          } else if (c === "," && depth === 1) {
            parts.push(current);
            current = "";
          } else {
            current += c;
          }
          i += 1;
        }
        parts.push(current);
        calls.push({ file, args: parts.map((p) => p.trim()).filter((p) => p.length > 0) });
      }
    }
    expect(calls.length, "랜딩 클릭 계측이 통째로 사라졌다").toBeGreaterThanOrEqual(1);
    for (const { file, args } of calls) {
      expect(args.length, `${file}: captureEvent 인자가 2개가 아니다 — ${args.join(" | ")}`).toBe(2);
      expect(args[0], `${file}: 이벤트 이름이 문자열 리터럴이 아니다`).toMatch(/^"[\w.]+"$/u);
      expect(args[1], `${file}: 계측 페이로드가 객체 리터럴이 아니다`).toMatch(/^\{[\s\S]*\}$/u);
      const keys = args[1].slice(1, -1).split(",").map((e) => e.trim()).filter(Boolean)
        .map((e) => (e.split(":")[0] ?? "").trim());
      expect(keys, `${file}의 계측 이벤트는 source만 전송해야 함`).toEqual(["source"]);
    }
  });

  it("제목과 고지가 좁은 화면에서도 읽힌다", () => {
    // 제목은 한 줄로 못 박지 않는다(좁은 폭에서 넘친다). 신뢰 문구는 숨기거나 10px 이하로 줄이지 않는다.
    expect(startScreen.match(/<h1[\s\S]*?<\/h1>/u)?.[0] ?? "", "제목을 찾지 못했다").not.toBe("");
    expect(startScreen.match(/<h1[\s\S]*?<\/h1>/u)?.[0]).not.toContain("whitespace-nowrap");
    for (const [file, text] of everyComponent) {
      for (const value of classValues(text)) {
        expect(value, `${file}: 읽을 수 없는 크기`).not.toMatch(/text-\[(?:\d|10)px\]/u);
      }
    }
    for (const value of classValues(rendered("src/components/landing/redesign/LandingFooter.tsx"))) {
      expect(value, "바닥글이 무언가를 감춘다").not.toMatch(HIDING_UTILITY);
    }
    for (const value of classValues(startScreen)) {
      expect(value, "시작 화면이 무언가를 감춘다").not.toMatch(HIDING_UTILITY);
    }
    // 자기검증: 감추는 유틸리티를 실제로 잡는다.
    expect("hidden lg:block").toMatch(HIDING_UTILITY);
    expect("max-sm:hidden").toMatch(HIDING_UTILITY);
    expect("overflow-hidden").not.toMatch(HIDING_UTILITY);
  });

  it("actually disables the unlayered animations under prefers-reduced-motion", () => {
    // globals.css는 .animate-fade-in 등을 @layer 밖에서 선언한다. layer 밖 선언이 항상 이기므로
    // `motion-reduce:animate-none` 은 이들을 덮지 못한다. 같은 위치의 @media 블록으로 꺼야 한다.
    // 랜딩 밖에도 걸린 전역 규칙이라 그대로 남겼다.
    const globals = readFileSync(resolve(APP_ROOT, "src/app/globals.css"), "utf8");
    const reduceBlock = globals.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/u)?.[0];
    expect(reduceBlock, "prefers-reduced-motion 블록을 찾지 못함").toBeTruthy();
    const unlayered = [...globals.matchAll(/^\.([a-zA-Z][\w-]*)\s*\{\n\s*animation:/gmu)]
      .map((m) => m[1])
      .filter((cls) => !cls.startsWith("c6-"));
    expect(unlayered.length, "unlayered animation 클래스를 찾지 못함").toBeGreaterThan(0);
    for (const cls of unlayered) {
      expect(reduceBlock ?? "", `.${cls}이 prefers-reduced-motion에서 꺼지지 않는다`).toContain(`.${cls}`);
    }
  });

  it("does not ship motion-reduce classes that target the wrong property", () => {
    // Tailwind v4의 translate-* 는 독립 `translate` 속성을 쓴다. `motion-reduce:transform-none` 은
    // 아무것도 되돌리지 못한다. 이동 자체를 `motion-safe:` 로 감싸는 것이 동작하는 형태다.
    for (const [file, text] of everyComponent) {
      for (const value of classValues(text)) {
        expect(value, `${file}: motion-reduce:transform-none은 무효 클래스다`).not.toMatch(/motion-reduce:transform-none/u);
        const moves = [...value.matchAll(/(?<!motion-safe:)group-hover:translate-[xy]-[\w.[\]-]+/gu)];
        expect(moves.map((m) => m[0]), `${file}: hover 이동은 motion-safe로 감싼다`).toEqual([]);
      }
    }
  });

  it("keeps the source helper in charge — no private comment stripper comes back", () => {
    // 이 파일이 자기 `withoutComments` 를 갖고 있던 시절, 그 복사본은 줄 **처음**의 `//` 만
    // 지웠다. 줄 끝 주석 한 줄이면 어떤 계약도 무력화됐다.
    const self = source("src/app/landing/__tests__/landingHeroExperience.test.ts");
    for (const banned of ["withoutComments", "stripLandingComments", "contentBlock"]) {
      expect(self, `${banned} 를 다시 복사하지 마라 — landingSource.ts 를 import 하라`)
        .not.toMatch(new RegExp(`function\\s+${banned}\\b`, "u"));
    }
    expect(self, "공용 도구를 import 하지 않는다").toMatch(/from "\.\/landingSource"/u);
    expect(stripComments("const a = 1; // 예산\n"), "줄 끝 주석이 남는다").not.toContain("예산");
    expect(everyComponent.length, "랜딩 컴포넌트를 하나도 읽지 못했다").toBeGreaterThanOrEqual(5);
  });
});
