// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { invitationPalette, invitationRadius } from "@hanbang/design-tokens";

import LandingPage from "../page";
import {
  APP_ROOT,
  everyLandingComponent,
  landingComponentFiles,
  rendered,
  renderedSections,
  source,
  stripComments,
} from "./landingSource";

vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));

/**
 * 랜딩 디자인 계약.
 *
 * 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)로 랜딩은 앱의 '시작' 화면
 * (`Main.dc.html`, 390×844)이 됐다. 옛 계약(Pretendard 하나 · 종이 팔레트 · 첫 화면에 그림 없음 ·
 * 꽃 SVG 넷 · radial-gradient 금지)은 **새 디자인을 구조적으로 금지**했으므로, 같은 자리에서
 * 새 디자인을 지키도록 다시 썼다:
 *
 *   글꼴   아티팩트의 세 글꼴(고운바탕·Cormorant Garamond·Noto Sans KR)을 next/font 로만 쓴다.
 *   색     `--inv-*` 토큰(디자인 토큰 `invitationPalette` 에서 생성)으로만 칠한다.
 *   사진   첫 화면의 그림은 보케 사진 한 장뿐이다.
 *   값     원본 인라인 스타일 값 그대로(위치·크기·반경·흐림·간격·굵기·줄 높이·자간).
 *
 * 제품 전체에 걸린 단언(Pretendard 글꼴 역할, 그림자 토큰 둘, 승격된 색)은 랜딩 밖도 지키므로
 * 그대로 남겼다. 실제 줄바꿈·겹침·초점 이동은 브라우저 QA 의 몫이다.
 */

const components = everyLandingComponent();
const LANDING_PAGE = "src/app/landing/page.tsx";
const LANDING_OG = "src/app/landing/opengraph-image.tsx";

/** 랜딩이 사용자에게 내보내는 지면 — 컴포넌트 · 페이지 본체 · 공유 카드. */
const surfaces: Array<[string, string]> = [
  ...components,
  ["app/landing/page.tsx", rendered(LANDING_PAGE)],
  ["app/landing/opengraph-image.tsx", rendered(LANDING_OG)],
];

const globals = stripComments(source("src/app/globals.css"));
const layout = stripComments(source("src/app/layout.tsx"));
const designMd = source("../../DESIGN.md");
const startScreen = rendered("src/components/landing/redesign/StartScreen.tsx");

function landingDocument(): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(createElement(LandingPage)), "text/html");
}

/** 파일 안의 모든 문자열·템플릿 리터럴. className 이 어디에 적혔든 한 곳으로 모은다. */
const styleLiterals = (src: string) =>
  [...src.matchAll(/"([^"\n]*)"|`([^`]*)`/gu)].map((m) => m[1] ?? m[2] ?? "");

/** 클래스 문자열을 낱말로 나누고 변형 접두사(`md:` · `hover:` …)를 뗀다. */
const utilities = (className: string) =>
  className.split(/\s+/u).filter(Boolean).map((token) => token.replace(/^(?:[\w-]+:)+/u, "").replace(/^!|!$/gu, ""));

/** 렌더된 요소가 이 클래스들을 전부 갖는가. 빠진 것만 돌려준다. */
const missingClasses = (element: Element | null | undefined, expected: readonly string[]) =>
  expected.filter((token) => !element?.classList.contains(token));

/** WCAG 2.x 상대 휘도 대비. */
const luminance = (hex: string) => {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(parseInt(hex.slice(1, 3), 16))
    + 0.7152 * channel(parseInt(hex.slice(3, 5), 16))
    + 0.0722 * channel(parseInt(hex.slice(5, 7), 16))
  );
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x: number, y: number) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("landing design system", () => {
  it("keeps looking at the start screen the page really renders", () => {
    // 아래 단언들이 도는 대상 자체가 비어 버리면 전부 빈 통과가 된다.
    // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): <main> 은 시작 화면 한 장이다.
    expect(renderedSections(), "<main> 이 시작 화면 한 장이 아니다").toEqual(["StartScreen"]);
    expect(new Set(landingComponentFiles()).has("StartScreen.tsx")).toBe(true);
    expect(startScreen.length, "시작 화면 소스를 못 읽었다").toBeGreaterThan(500);
  });

  it("paints only with the invitation tokens — no literal colour on any landing surface", () => {
    // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 색은 `--inv-*` 로만 칠한다.
    // 옛 판은 종이 팔레트(`--color-paper-*`)만 허락해서 아티팩트의 색을 쓸 수 없었다.
    // 지키는 것은 같다 — 토큰을 지나지 않는 새 색을 지면에 직접 적지 않는다.
    const hexes = surfaces.flatMap(([file, src]) =>
      [...src.matchAll(/#[0-9A-Fa-f]{3,8}(?![0-9A-Fa-f])/gu)].map((m) => `${m[0]} (${file})`));
    expect(hexes, "hex 색을 지면에 적지 말고 디자인 토큰을 거친다").toEqual([]);
    const functions = surfaces.flatMap(([file, src]) =>
      [...src.matchAll(/(?<![\w-])(?:rgba?|hsla?|oklch|lab|color-mix)\(/gu)].map((m) => `${m[0]} (${file})`));
    expect(functions, "색 함수 리터럴을 지면에 적지 말고 토큰을 거친다").toEqual([]);

    // 색을 정하는 유틸리티는 `inv-*` 토큰이거나 초점 고리 토큰이다. 크기·굵기 유틸리티는 색이 아니다.
    // 굵기·변·크기만 정하는 유틸리티는 색이 아니다(`border-t` · `ring-2` · `ring-offset-2` · `text-[13px]`).
    const NOT_A_COLOUR = /^(?:border(?:-[trblxy])?(?:-\d+)?|ring(?:-\d+)?|ring-offset-\d+|outline(?:-none|-\d+)?|shadow-(?:raised|overlay|none)|text-(?:left|center|right|justify|balance|pretty|wrap|nowrap|ellipsis|clip)|text-\[(?:\d+(?:\.\d+)?(?:px|rem|em)|clamp\([^\]]+\))\]|bg-(?:transparent|none|cover|contain|center|no-repeat|fixed))$/u;
    const COLOUR_UTILITY = /^(?:bg|text|border(?:-[trblxy])?|ring-offset|ring|outline|decoration|fill|stroke|from|via|to|divide|shadow|placeholder|caret|accent)-(.+)$/u;
    const offenders: string[] = [];
    const tokensUsed = new Set<string>();
    for (const [file, src] of surfaces) {
      for (const literal of styleLiterals(src)) {
        for (const utility of utilities(literal)) {
          if (NOT_A_COLOUR.test(utility)) continue;
          const m = COLOUR_UTILITY.exec(utility);
          if (!m) continue;
          const value = m[1].replace(/\/\d+$/u, "");
          if (value.startsWith("inv-")) {
            tokensUsed.add(value);
            continue;
          }
          if (value === "[var(--hb-focus-ring)]") continue;
          offenders.push(`${file}: ${utility}`);
        }
      }
    }
    expect(offenders, "inv 토큰이 아닌 색 유틸리티").toEqual([]);

    // 쓴 토큰이 정말 있다 — 없는 토큰을 부르면 색 없이 조용히 넘어간다.
    expect(tokensUsed.size, "inv 토큰을 하나도 못 찾았다 — 표기가 바뀌었다").toBeGreaterThanOrEqual(6);
    const kebab = (key: string) => key.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`);
    const paletteNames = new Set(Object.keys(invitationPalette).map((key) => `inv-${kebab(key)}`));
    for (const token of tokensUsed) {
      expect(paletteNames.has(token), `${token} 은 invitationPalette 에 없다`).toBe(true);
      expect(globals, `${token} 유틸리티가 globals.css @theme 에 없다`).toContain(`--color-${token}: var(--${token});`);
    }

    // 정의되지 않은 변수나 폴백 달린 변수도 같은 사고다.
    for (const [file, src] of surfaces) {
      for (const m of src.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,[^)]*)?\)/gu)) {
        expect(m[2], `${file}: ${m[0]} — var() 폴백은 토큰을 지나지 않는 값이다`).toBeUndefined();
        if (m[1] === "--start-squeeze") continue; // 시작 화면이 자기 상자에서 정하는 길이 변수
        expect(globals, `${file}: ${m[1]} 이 globals.css 에 없다`).toContain(`${m[1]}:`);
      }
    }
  });

  it("no longer carries the retired paper notebook on the landing", () => {
    // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 종이 노트(테이프·펜 밑줄·
    // 꽃 가지·손글씨)는 시작 화면에 없다. 섞여 돌아오면 두 디자인이 한 화면에 선다.
    for (const [file, src] of surfaces) {
      expect(src, `${file}: 종이 팔레트가 돌아왔다`).not.toMatch(/--color-paper-/u);
      expect(src, `${file}: 옛 랜딩 클래스가 돌아왔다`).not.toMatch(/(?<![\w-])landing-(?:root|display|hand|tape|pen|note|circle|bloom|leaf|gyp|stem)(?![\w-])/u);
      expect(src, `${file}: 꽃 장식이 돌아왔다`).not.toMatch(/LandingBloom/u);
      expect(src, `${file}: CSS 그라데이션으로 새 장식을 그린다`).not.toMatch(/(?:radial|linear|conic)-gradient/u);
    }
  });

  it("sets type in the artifact's three next/font families only", () => {
    // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 고운바탕(한글 제목) +
    // Cormorant Garamond(로고·숫자) + Noto Sans KR(본문). 옛 판은 Pretendard 하나만 허락했다.
    for (const [loader, variable] of [
      ["Gowun_Batang", "--font-invitation-serif"],
      ["Cormorant_Garamond", "--font-invitation-numeral"],
      ["Noto_Sans_KR", "--font-invitation-sans"],
    ] as const) {
      expect(layout, `${loader} 를 next/font 로 싣지 않는다`).toContain(loader);
      expect(layout, `${variable} 변수가 없다`).toContain(`variable: "${variable}"`);
    }
    for (const [role, variable] of [
      ["serif", "--font-invitation-serif"],
      ["numeral", "--font-invitation-numeral"],
      ["sans", "--font-invitation-sans"],
    ] as const) {
      expect(globals, `font-inv-${role} 가 next/font 변수를 읽지 않는다`).toMatch(
        new RegExp(String.raw`--font-inv-${role}:\s*var\(${variable}\)`, "u"),
      );
    }

    // 랜딩 지면의 글꼴 유틸리티는 그 셋뿐이다. 임의 글꼴·다른 역할 글꼴을 섞지 않는다.
    const families: string[] = [];
    for (const [file, src] of components.concat([["app/landing/page.tsx", rendered(LANDING_PAGE)]])) {
      for (const literal of styleLiterals(src)) {
        for (const utility of utilities(literal)) {
          if (!/^font-/u.test(utility)) continue;
          if (/^font-(?:normal|medium|semibold|bold|light|thin|black|extrabold|extralight)$/u.test(utility)) continue;
          if (/^font-inv-(?:serif|numeral|sans)$/u.test(utility)) continue;
          families.push(`${file}: ${utility}`);
        }
      }
      expect(src, `${file}: Pretendard 를 다시 부른다`).not.toMatch(/pretendard/iu);
    }
    expect(families, "세 글꼴 밖의 글꼴 유틸리티").toEqual([]);

    // 렌더 결과: 첫 화면은 Noto Sans KR, 제목은 고운바탕, 로고는 Cormorant.
    const doc = landingDocument();
    const h1 = doc.querySelector("h1");
    expect(h1?.closest(".font-inv-sans"), "첫 화면이 Noto Sans KR 위에 있지 않다").toBeTruthy();
    expect(h1?.classList.contains("font-inv-serif"), "제목이 고운바탕이 아니다").toBe(true);
    const wordmark = [...doc.querySelectorAll("main span")].find((span) => span.textContent === "amora");
    expect(wordmark?.classList.contains("font-inv-numeral"), "로고가 Cormorant 가 아니다").toBe(true);
    expect(doc.querySelector("footer")?.classList.contains("font-inv-sans"), "바닥글이 Noto Sans KR 이 아니다").toBe(true);
  });

  it("keeps the product-wide Pretendard roles intact outside the landing", () => {
    // 랜딩 밖(제품 화면)의 계약이라 그대로 남긴다. 랜딩이 세 글꼴로 바뀌었다고 제품 글꼴
    // 역할까지 건드리면 안 된다.
    expect(designMd).toContain("Pretendard");
    const faces = [...globals.matchAll(/@font-face\s*\{([^}]+)\}/gu)].map((match) => match[1]);
    expect(faces).toHaveLength(1);
    expect(faces[0]).toContain('font-family: "Pretendard Variable"');
    expect(faces[0]).toContain("font-weight: 100 900");
    expect(faces[0]).toContain("font-display: swap");
    const path = /url\("([^"]+)"\)/u.exec(faces[0])?.[1];
    expect(path).toBe("/fonts/pretendard/PretendardVariable.woff2");
    const fontPath = resolve(APP_ROOT, "public" + path);
    expect(existsSync(fontPath)).toBe(true);
    expect(readFileSync(fontPath).subarray(0, 4).toString()).toBe("wOF2");
    const rawLayout = source("src/app/layout.tsx");
    expect(rawLayout).toContain(`href="${path}"`);
    expect(rawLayout).toContain('rel="preload"');
    expect(rawLayout).toContain('crossOrigin="anonymous"');
    for (const role of ["sans", "serif", "sans-kr", "serif-kr", "display", "jakarta"]) {
      expect(globals).toContain(`--font-${role}: var(--font-pretendard);`);
    }
    expect(globals).toMatch(/\.amora-workspace,\s*\.planning-workspace\s*\{[^}]*font-family:\s*var\(--font-pretendard\)/u);
  });

  it("shows the one bokeh photo full-bleed behind the start screen", () => {
    // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 첫 화면 바탕은 보케 사진이다.
    // 옛 판은 "히어로에 그림 없음"을 요구했다. 지키는 것을 바꾼다 — 그림은 **그 사진 한 장**이고,
    // 장식이라 읽어 주지 않으며, 화면을 꽉 채운다.
    const photo = "/images/amora/bokeh-blush.webp";
    expect(existsSync(resolve(APP_ROOT, "public" + photo)), "보케 사진 파일이 없다").toBe(true);
    expect(startScreen).toContain(`"${photo}"`);

    const doc = landingDocument();
    const images = [...doc.querySelectorAll("main img, main picture, main video, main image")];
    expect(images, "첫 화면의 그림이 보케 사진 한 장이 아니다").toHaveLength(1);
    const img = images[0] as HTMLImageElement;
    expect(decodeURIComponent(img.getAttribute("src") ?? ""), "보케 사진이 아니다").toContain(photo);
    expect(img.getAttribute("alt"), "장식 사진이 읽힌다").toBe("");
    expect(img.classList.contains("object-cover"), "사진이 화면을 덮지 않는다(cover)").toBe(true);
    expect(img.getAttribute("sizes")).toBe("100vw");
    // next/image 의 fill 은 인라인 높이 100% 라 전역 이미지 높이 규칙(높이 자동)을 이긴다.
    expect(img.getAttribute("style") ?? "", "사진이 상자를 꽉 채우지 않는다").toMatch(/height:\s*100%/u);
    expect(img.getAttribute("loading"), "첫 화면 사진을 늦게 받는다").toBe("eager");

    // 사진은 시작 화면 상자 안에서만 깔린다 — 바탕색은 사진이 오기 전의 #F3E4E1 이다.
    const frame = img.parentElement;
    expect(missingClasses(frame, ["relative", "overflow-hidden", "bg-inv-blush"])).toEqual([]);
    expect(invitationPalette.blush).toBe("#F3E4E1");
  });

  it("matches the artifact values at 390 × 844", () => {
    // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해). `Main.dc.html` 의 인라인
    // 스타일을 그대로 옮겼는지 렌더 결과의 클래스로 본다.
    const doc = landingDocument();
    const card = doc.querySelector('section[aria-labelledby="start-title"]');
    const frame = card?.parentElement;
    // 줄높이는 아티팩트처럼 기본값(normal)이다. 본문 1.6 을 물려받으면 "시작하기" 글자가 1px 위로 뜬다.
    expect(missingClasses(frame, ["relative", "h-[100svh]", "font-inv-sans", "leading-[normal]", "text-inv-ink"])).toEqual([]);

    // 위: 64px 아래, 사이 4px. 로고 40px Cormorant 이탤릭 500 흰색 자간 0.01em,
    // 한 줄 12px 자간 0.08em 흰색 90%.
    const top = frame?.children[1];
    expect(missingClasses(top, ["absolute", "top-0", "flex-col", "items-center", "gap-1", "pt-[calc(64px_-_var(--start-squeeze)*0.4)]"])).toEqual([]);
    const [wordmark, tagline] = [...(top?.children ?? [])];
    expect(wordmark?.textContent).toBe("amora");
    expect(missingClasses(wordmark, ["font-inv-numeral", "text-[40px]", "font-medium", "italic", "tracking-[0.01em]", "text-inv-white"])).toEqual([]);
    expect(tagline?.textContent).toBe("두 사람의 웨딩 비서");
    expect(missingClasses(tagline, ["text-[12px]", "tracking-[0.08em]", "text-inv-white/90"])).toEqual([]);

    // 오브: 위에서 210px, 150px, 차분한 모습.
    const orbRow = frame?.children[2];
    expect(missingClasses(orbRow, ["absolute", "inset-x-0", "top-[calc(210px_-_var(--start-squeeze))]", "flex", "justify-center"])).toEqual([]);
    const orb = orbRow?.querySelector("svg");
    expect(orb?.getAttribute("width")).toBe("150");
    expect(orb?.getAttribute("data-amora-orb")).toBe("calm");

    // 카드: 좌우·아래 12px, 흰색 86%, 24px 흐림, 반경 36px, 안쪽 32·26·22px, 사이 14px.
    expect(missingClasses(card, [
      "absolute", "inset-x-3", "bottom-3", "flex", "flex-col", "gap-3.5", "rounded-[36px]",
      "bg-inv-white/86", "backdrop-blur-[24px]", "px-[26px]", "pt-8", "pb-[22px]",
    ])).toEqual([]);
    expect(invitationRadius.sheet).toBe(36);

    // 제목: 고운바탕 400, 27px(390px 에서), 줄 1.45, 자간 -0.01em. 두 줄.
    const h1 = card?.querySelector("h1");
    expect(missingClasses(h1, ["font-inv-serif", "font-normal", "leading-[1.45]", "tracking-[-0.01em]"])).toEqual([]);
    const size = [...(h1?.classList ?? [])].find((token) => token.startsWith("text-[clamp("));
    expect(size, "제목 크기를 못 찾았다").toBeTruthy();
    const [min, preferred, max] = /clamp\(([\d.]+)px,([\d.]+)vw,([\d.]+)px\)/u.exec(size ?? "")?.slice(1).map(Number) ?? [];
    expect(max, "제목이 27px 을 넘거나 못 미친다").toBe(27);
    // 390px 에서 정확히 27px 이어야 한다 — 6.923vw 는 26.9997px 로 계산돼 한 끗 모자랐다(실측).
    expect(Math.min(max, Math.max(min, (preferred * 390) / 100)), "390px 에서 27px 이 아니다").toBe(27);

    // 본문: 15px 줄 1.7 #4E4852.
    const body = card?.querySelector("p");
    expect(missingClasses(body, ["text-[15px]", "leading-[1.7]", "text-inv-body"])).toEqual([]);
    expect(invitationPalette.body).toBe("#4E4852");

    // 시작하기: 먹색 알약 56px 반경 28px 16px 굵게, 위로 10px 더. 예시: 글자 링크 44px 14px 500.
    const start = card?.querySelector('a[href="/wedding/chat"]');
    expect(missingClasses(start, ["h-14", "rounded-[28px]", "text-[16px]", "font-bold", "bg-inv-ink", "text-inv-white", "mt-2.5"])).toEqual([]);
    const example = card?.querySelector('a[href="/example"]');
    expect(missingClasses(example, ["h-11", "text-[14px]", "font-medium", "text-inv-ink", "hover:text-inv-muted"])).toEqual([]);
    expect(start?.compareDocumentPosition(example!) ?? 0, "예시가 시작하기보다 앞에 있다").toBe(4);
  });

  it("keeps the artifact positions until the viewport is too short, then pulls the top up", () => {
    // 아티팩트 틀은 844px 전화기 화면이고 브라우저의 첫 화면은 그보다 짧다. 시작 화면은 카드를
    // 아래에 붙인 채 위쪽(로고 여백·오브 위치)만 당긴다. 그 식을 그대로 옮겨 숫자로 잰다.
    const squeeze = (height: number, threshold: number) => Math.min(100, Math.max(0, threshold - height));
    expect(startScreen).toContain("[--start-squeeze:clamp(0px,749px_-_100svh,100px)]");
    expect(startScreen).toContain("md:[--start-squeeze:clamp(0px,777px_-_100svh,100px)]");
    expect(startScreen).toContain("min-h-[649px]");
    expect(startScreen).toContain("md:min-h-[677px]");

    // 844px(아티팩트 틀)와 749px 이상에서는 아티팩트 값 그대로다.
    for (const height of [844, 932, 749]) {
      expect(64 - squeeze(height, 749) * 0.4, `${height}px 에서 로고 여백이 64px 이 아니다`).toBe(64);
      expect(210 - squeeze(height, 749), `${height}px 에서 오브가 210px 이 아니다`).toBe(210);
    }
    // 카드(390px 폭에서 약 361px)는 아래 12px 에 붙는다. 그보다 짧은 화면에서도 오브와
    // 카드 사이가 16px 아래로 줄지 않는다. 649px 아래로는 화면이 길어져 같은 배치를 유지한다.
    const CARD = 361;
    for (const height of [748, 720, 700, 667, 649, 600, 560]) {
      const frame = Math.max(height, 649);
      const orbBottom = 210 - squeeze(frame, 749) + 150;
      const cardTop = frame - 12 - CARD;
      expect(cardTop - orbBottom, `${height}px 에서 카드가 오브를 덮는다`).toBeGreaterThanOrEqual(15.9);
      const wordBlockBottom = 64 - squeeze(frame, 749) * 0.4 + 70;
      expect(210 - squeeze(frame, 749) - wordBlockBottom, `${height}px 에서 오브가 로고와 겹친다`).toBeGreaterThanOrEqual(15.9);
    }
  });

  it("adapts to wide screens without a second layout", () => {
    // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 넓은 화면도 같은 구성이다.
    // 사진이 화면 전체를 덮고, 로고·오브는 가운데, 카드는 너비 440px 로 가운데 아래.
    const doc = landingDocument();
    const card = doc.querySelector('section[aria-labelledby="start-title"]');
    expect(missingClasses(card, ["mx-auto", "max-w-[440px]", "md:bottom-10"])).toEqual([]);
    // 넓은 화면에서 다른 구성(여러 단·다른 순서)을 만들지 않는다.
    for (const literal of styleLiterals(startScreen)) {
      expect(literal, "시작 화면이 넓은 화면에서 단을 나눈다").not.toMatch(/(?:^|\s)(?:\w+:)?(?:grid-cols-|columns-|flex-row)/u);
    }
  });

  it("draws every landing action with the shared Button — no hand-made button", () => {
    // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 알약 버튼은 공유 `Button`
    // 하나에서 나온다. 랜딩이 알약을 손으로 다시 칠하면 같은 버튼이 두 벌이 된다.
    for (const [file, src] of components) {
      expect(src, `${file}: 맨 <button> 을 만든다`).not.toMatch(/<button\b/u);
      expect(src, `${file}: role="button" 을 손으로 단다`).not.toMatch(/role="button"/u);
    }
    const tracked = rendered("src/components/landing/redesign/TrackedLandingLink.tsx");
    expect(tracked, "계측 링크가 공유 Button 을 쓰지 않는다").toMatch(/import Button from "@\/components\/ui\/Button"/u);
    for (const file of ["StartScreen.tsx", "LandingAccountActions.tsx"]) {
      const src = components.find(([name]) => name === file)?.[1] ?? "";
      expect(src, `${file}: 알약을 손으로 칠한다`).not.toMatch(/rounded-\[(?:28|22|17)px\]|bg-inv-ink/u);
    }
  });

  it("keeps entry controls keyboard accessible", () => {
    const doc = landingDocument();
    for (const href of ["/wedding/chat", "/example", "/login?redirect=%2Fwedding%2Fchat"]) {
      const link = doc.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
      expect(link, href).toBeTruthy();
      expect(link?.getAttribute("tabindex")).not.toBe("-1");
      expect(link?.getAttribute("aria-disabled")).not.toBe("true");
      expect(link?.className).toMatch(/focus-visible:(?:ring|outline)/u);
      expect(link?.closest('[hidden],[aria-hidden="true"],.hidden,.sr-only'), href).toBeNull();
      // 44px: 알약 56·44 는 상자로, 34 는 보이지 않는 누름 영역으로 채운다.
      const tall = ["h-14", "h-11"].some((token) => link?.classList.contains(token));
      expect(tall || link?.classList.contains("tap-area"), `${href} 의 누름 영역이 44px 보다 작다`).toBe(true);
    }
  });

  it("keeps small copy readable on its surface", () => {
    // 바닥글의 작은 글자(#6B6570)는 바닥(#FBFAF8)에서, 본문(#4E4852)과 먹색은 흰 카드에서
    // 4.5:1 을 넘는다. 사진 위의 흰 로고·한 줄은 아티팩트가 정한 장식 글자라 여기서 재지 않는다.
    for (const [foreground, background] of [
      [invitationPalette.muted, invitationPalette.paper],
      [invitationPalette.body, invitationPalette.white],
      [invitationPalette.ink, invitationPalette.white],
      [invitationPalette.ink, invitationPalette.blush],
    ]) {
      expect(contrast(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses only the two elevation tokens, never a one-off shadow", () => {
    expect(globals).toContain("--shadow-raised");
    expect(globals).toContain("--shadow-overlay");
    for (const [file, src] of surfaces) {
      const oneOff = [...src.matchAll(/(?:drop-)?shadow-\[[^\]]*\]/gu)].map((m) => m[0]);
      expect(oneOff, `${file}에 일회성 그림자가 있다`).toEqual([]);
    }
  });

  it("keeps radii on the artifact scale", () => {
    // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 반경은 아티팩트 값
    // (`invitationRadius`)뿐이다. 옛 판은 제품 눈금(6·8·12…)과 랜딩 예외만 허락했다.
    const allowed = new Set<number>(Object.values(invitationRadius));
    for (const [file, src] of surfaces) {
      const off = [...src.matchAll(/rounded(?:-[a-z]{1,2})?-\[(\d+(?:\.\d+)?)(px|rem)\]/gu)]
        .filter((m) => !allowed.has(m[2] === "px" ? Number(m[1]) : Number(m[1]) * 16))
        .map((m) => m[0]);
      expect(off, file).toEqual([]);
    }
  });

  it("keeps structural borders to the invitation hairlines", () => {
    // 테두리 색은 아티팩트의 가는 선 토큰뿐이다(구역 나눔선·카드 고리·칩 선).
    const allowed = new Set(["inv-divider", "inv-row-line", "inv-ring", "inv-chip-line"]);
    const off: string[] = [];
    for (const [file, src] of surfaces) {
      for (const literal of styleLiterals(src)) {
        for (const utility of utilities(literal)) {
          const m = /^(?:border|divide)(?:-[trblxy])?-(inv-[a-z-]+)(\/\d+)?$/u.exec(utility);
          if (m && (!allowed.has(m[1]) || m[2])) off.push(`${file}: ${utility}`);
        }
      }
    }
    expect(off, "가는 선 토큰 밖의 테두리").toEqual([]);
  });

  it("keeps landing transitions inside the DESIGN.md motion band", () => {
    // DESIGN.md: micro 80ms / short 160-220ms / medium 300-450ms. Tailwind 기본 150ms 는 어느
    // 밴드에도 들지 않는다. 요소별로 본다 — 파일 어딘가에 duration 이 하나 있다고 통과시키지 않는다.
    for (const [file, src] of surfaces) {
      for (const literal of styleLiterals(src)) {
        const transitions = utilities(literal).filter((token) => /^transition(?:-|$)/u.test(token) && token !== "transition-none");
        if (transitions.length === 0) continue;
        expect(utilities(literal).some((token) => /^duration-/u.test(token)), `${file}: duration 없는 전이 "${literal}"`).toBe(true);
      }
    }
  });

  it("stops the orb under reduced motion", () => {
    // 오브는 세 무리가 돌고 빛이 숨 쉰다. 움직임 줄이기 설정이면 멈춰야 한다(globals.css).
    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{[^{}]*\.amora-orb[^{}]*\{\s*animation:\s*none;?\s*\}/u.exec(globals);
    expect(block, "움직임 줄이기에서 오브가 멈추지 않는다").toBeTruthy();
    const doc = landingDocument();
    expect(doc.querySelector("main svg.amora-orb"), "시작 화면 오브가 공유 오브가 아니다").toBeTruthy();
    expect(doc.querySelector("main svg.amora-orb")?.getAttribute("aria-hidden"), "이름이 옆에 있는 오브가 또 읽힌다").toBe("true");
  });

  it("never tries to centre an inline-flex recipe with mx-auto", () => {
    // inline 요소에 auto margin 은 아무 일도 하지 않는다. 가운데 정렬은 부모의 몫이다.
    for (const [file, src] of surfaces) {
      const bad = styleLiterals(src).filter((c: string) => c.includes("mx-auto") && c.includes("inline-flex"));
      expect(bad, `${file}: inline-flex 요소에 mx-auto를 걸었다`).toEqual([]);
    }
  });
});
