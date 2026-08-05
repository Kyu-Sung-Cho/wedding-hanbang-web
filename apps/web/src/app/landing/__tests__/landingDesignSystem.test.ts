// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 랜딩 디자인 시스템 계약.
 *
 * 2026-08-05 실측에서 나온 드리프트를 고정한다. 이 파일이 막는 것:
 *  - 토큰에도 DESIGN.md에도 없는 색을 새로 만드는 것
 *  - 같은 기본 행동을 서로 다른 실루엣으로 그리는 것
 *  - 일회성 box-shadow로 elevation을 매번 다시 정하는 것
 *  - 섹션마다 다른 세로 리듬을 쓰는 것
 *  - DESIGN.md 라운드 스케일 밖 값을 쓰는 것
 */

const appRoot = resolve(process.cwd());
const DIR = resolve(appRoot, "src/components/landing/redesign");
const globals = readFileSync(resolve(appRoot, "src/app/globals.css"), "utf8");
const designMd = readFileSync(resolve(appRoot, "../../DESIGN.md"), "utf8");

const components = readdirSync(DIR)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => [f, readFileSync(resolve(DIR, f), "utf8")] as const);

describe("landing design system", () => {
  it("uses no colour that is absent from both the tokens and DESIGN.md", () => {
    const known = (globals + designMd).toUpperCase();
    const strays = new Map<string, string[]>();

    for (const [file, source] of components) {
      for (const match of source.matchAll(/#[0-9A-Fa-f]{6}/gu)) {
        const hex = match[0].toUpperCase();
        if (known.includes(hex)) continue;
        strays.set(hex, [...(strays.get(hex) ?? []), file]);
      }
    }

    expect(
      [...strays.entries()].map(([hex, files]) => `${hex} (${[...new Set(files)].join(", ")})`),
      "새 색을 만들지 말고 globals.css @theme와 DESIGN.md에 먼저 토큰으로 올린다",
    ).toEqual([]);
  });

  it("promotes the two colours the landing had invented into real tokens", () => {
    // 이 둘은 랜딩이 각각 9곳·7곳에서 쓰고 있었는데 어느 출처에도 없었다.
    for (const [token, hex] of [
      ["--color-rose-700", "#7D5753"],
      ["--color-ivory-blush", "#F3E9DD"],
    ]) {
      expect(globals, `${token}이 @theme에 없다`).toContain(`${token}: ${hex}`);
      expect(designMd, `${hex}가 DESIGN.md 팔레트에 기록되지 않았다`).toContain(hex);
    }
  });

  it("draws every primary action from one recipe", () => {
    const type = readFileSync(resolve(DIR, "landingType.ts"), "utf8");
    for (const size of ["primaryActionSm", "primaryActionMd", "primaryActionLg"]) {
      expect(type, `${size}이 없다`).toMatch(new RegExp(`export const ${size}`, "u"));
    }
    // 세 배치가 모두 공유 레시피를 쓴다.
    for (const [file, symbol] of [
      ["LandingHeader.tsx", "primaryActionSm"],
      ["TransformationHero.tsx", "primaryActionMd"],
      ["ClosingAction.tsx", "primaryActionLg"],
    ]) {
      const source = components.find(([name]) => name === file)?.[1] ?? "";
      expect(source, `${file}이 ${symbol}을 쓰지 않는다`).toContain(`\${${symbol}}`);
    }
    // 레시피 밖에서 mauve 버튼을 다시 조립하지 않는다.
    for (const [file, source] of components) {
      const adhoc = [...source.matchAll(/bg-rose-600[^"`]*rounded-|rounded-[^"`\s]*[^"`]*bg-rose-600/gu)];
      expect(adhoc.map((m) => m[0]), `${file}이 기본 행동 버튼을 새로 조립했다`).toEqual([]);
    }
  });

  it("uses only the two elevation tokens, never a one-off shadow", () => {
    expect(globals).toContain("--shadow-raised");
    expect(globals).toContain("--shadow-overlay");
    for (const [file, source] of components) {
      const oneOff = [...source.matchAll(/shadow-\[[^\]]*\]/gu)].map((m) => m[0]);
      expect(oneOff, `${file}에 일회성 그림자가 있다`).toEqual([]);
    }
  });

  it("drives section vertical rhythm from two steps only", () => {
    const type = readFileSync(resolve(DIR, "landingType.ts"), "utf8");
    expect(type).toContain("export const sectionRhythm");
    expect(type).toContain("export const sectionRhythmCompact");

    // 섹션 컴포넌트가 자기만의 py- 조합을 다시 만들지 않는다.
    const sections = [
      "ProblemMirrorSection.tsx",
      "PreparationResult.tsx",
      "ContinuitySection.tsx",
      "SharedPrivateSection.tsx",
      "CommunityBridgeSection.tsx",
      "TrustEvidenceSection.tsx",
      "ClosingAction.tsx",
    ];
    for (const file of sections) {
      const source = components.find(([name]) => name === file)?.[1] ?? "";
      expect(source, `${file}이 리듬 상수를 쓰지 않는다`).toMatch(/\$\{sectionRhythm(Compact)?\}/u);
      // 섹션 규모(py-12 이상)만 본다. 카드·행 내부의 py-4~py-8은 리듬이 아니다.
      const adhoc = [...source.matchAll(/(?<![\w-])(?:sm:|lg:|xl:)?py-(\d+)(?=[\s"`])/gu)]
        .filter((m) => Number(m[1]) >= 12)
        .map((m) => m[0]);
      expect(adhoc, `${file}이 섹션 세로 패딩을 직접 정했다`).toEqual([]);
    }
  });

  it("keeps every fixed type size on the DESIGN.md scale", () => {
    // 스케일: xs12 sm14 base16 lg18 xl20 2xl24 3xl30 4xl36 5xl48.
    // clamp()로 흐르는 디스플레이 타입은 여기서 제외한다 — 그건 landingType.ts의
    // 3단계가 따로 고정한다. 여기서 보는 것은 고정 px 값이다.
    // 도입 시점 실측: 스케일 밖 고정값이 49곳 있었고 13px 20곳·15px 11곳이 최다였다.
    const allowed = new Set([12, 14, 16, 18, 20, 24, 30, 36, 48]);
    const off = new Map<string, string[]>();
    for (const [file, source] of components) {
      for (const m of source.matchAll(/text-\[(\d+)px\]/gu)) {
        const px = Number(m[1]);
        if (allowed.has(px)) continue;
        off.set(`${px}px`, [...(off.get(`${px}px`) ?? []), file]);
      }
    }
    expect(
      [...off.entries()].map(([px, files]) => `${px} (${[...new Set(files)].join(", ")})`),
      "크기로 위계를 만들지 말고 웨이트를 쓴다",
    ).toEqual([]);
  });

  it("actually uses the weight axis instead of leaning on size alone", () => {
    // DESIGN.md Typography: "weight, size, color, spacing으로 위계를 만든다".
    // 도입 전 실측은 semibold 72 + medium 8, bold·light 0이었다. 웨이트가 사실상
    // 하나뿐이면 크기가 유일한 채널이 되고, 그래서 off-scale px가 늘어난다.
    const all = components.map(([, s]) => s).join("\n");
    const count = (w: string) => (all.match(new RegExp(`font-${w}\\b`, "gu")) ?? []).length;
    expect(count("bold"), "bold가 한 번도 쓰이지 않으면 크기가 유일한 위계 채널이 된다")
      .toBeGreaterThanOrEqual(3);
    expect(count("medium")).toBeGreaterThanOrEqual(3);
    expect(count("semibold")).toBeGreaterThanOrEqual(3);
  });

  it("draws every section eyebrow and lede from one shared recipe", () => {
    const type = readFileSync(resolve(DIR, "landingType.ts"), "utf8");
    for (const sym of ["sectionEyebrow", "sectionEyebrowOnDark", "sectionLede", "sectionLedeCompact"]) {
      expect(type, `${sym}이 없다`).toMatch(new RegExp(`export const ${sym}`, "u"));
    }
    // 12px 라벨은 4.5:1이 필요하다. rose-600은 ivory-blush 위에서 4.13:1로 미달했다.
    expect(type).toMatch(/export const sectionEyebrow\s*=[\s\S]*?text-rose-700/u);

    const sections = [
      "ProblemMirrorSection.tsx",
      "PreparationResult.tsx",
      "ContinuitySection.tsx",
      "SharedPrivateSection.tsx",
      "CommunityBridgeSection.tsx",
      "TrustEvidenceSection.tsx",
      "ClosingAction.tsx",
    ];
    for (const file of sections) {
      const source = components.find(([n]) => n === file)?.[1] ?? "";
      // `className={sectionEyebrow}`와 `className={\`... ${sectionEyebrow}\`}` 둘 다 허용한다.
      expect(source.includes("sectionEyebrow"), `${file}이 공유 eyebrow를 쓰지 않는다`).toBe(true);
      expect(source.includes("sectionLede"), `${file}이 공유 lede를 쓰지 않는다`).toBe(true);
    }
  });

  it("draws every standalone secondary link from one recipe", () => {
    const type = readFileSync(resolve(DIR, "landingType.ts"), "utf8");
    expect(type).toMatch(/export const secondaryLink\b/u);
    expect(type).toMatch(/export const secondaryLinkOnDark\b/u);
    // 문장 안에 흐르는 링크는 별도 레시피다 — 44px를 주면 line box가 벌어진다.
    expect(type).toMatch(/export const inlineLink\b/u);

    for (const [file, source] of components) {
      // 밑줄 링크를 레시피 밖에서 다시 조립하지 않는다.
      // hex 형태(`decoration-[#243832]/25`)만 보던 초기 정규식은 `decoration-white/30`을
      // 놓쳤고, 실제로 TrustEvidenceSection이 그 사각지대에서 on-dark 링크를 다시
      // 만들고 있었다. 토큰 이름 형태까지 함께 본다.
      const adhoc = [
        ...source.matchAll(/underline decoration-(?:\[#[0-9A-Fa-f]{6}\]|white|black|current)(?:\/\d+)?/gu),
      ].map((m) => m[0]);
      expect(adhoc, `${file}이 보조 링크를 새로 조립했다`).toEqual([]);
    }
  });

  it("never re-declares the eyebrow type utilities inline", () => {
    // 히어로는 색을 자식 span이 각자 정해서 sectionEyebrow(색 포함)를 쓸 수 없다.
    // 그래도 크기·웨이트·자간은 흩어지면 안 되므로 sectionEyebrowTypography를 쓴다.
    // 이 검사가 없을 때 실제로 히어로가 세 유틸리티를 그대로 인라인 복제하고 있었다.
    const type = readFileSync(resolve(DIR, "landingType.ts"), "utf8");
    expect(type).toMatch(/export const sectionEyebrowTypography\b/u);
    const trio = /text-\[12px\] font-bold tracking-\[0\.01em\]/u;
    for (const [file, source] of components) {
      expect(trio.test(source), `${file}이 eyebrow 타이포를 인라인으로 다시 선언했다`).toBe(false);
    }
  });

  it("keeps the closing CTA ahead of the account-beta conditions", () => {
    // 조건 네 개를 한 덩어리로 버튼 앞에 쌓으면 실측에서 페이지의 마지막 행동이
    // 접힘선 아래 53px(1280) · 266px(390)로 밀렸다. 지우지 않고 나눈 상태를 고정한다.
    //  - 이 버튼이 지금 여는 것을 설명하는 조건(0,1)은 버튼 앞 — P6 이용 전 고지.
    //  - 이 버튼이 열지 않는 계정 베타 조건(2,3)은 버튼 뒤.
    const closing = components.find(([n]) => n === "ClosingAction.tsx")?.[1] ?? "";
    const beforeCta = closing.indexOf("startConditions.slice(0, 2)");
    const ctaIndex = closing.indexOf('source="landing_closing"');
    const afterCta = closing.indexOf("startConditions.slice(2)");

    expect(beforeCta, "버튼 앞 조건 블록이 없다").toBeGreaterThan(-1);
    expect(afterCta, "버튼 뒤 조건 블록이 없다").toBeGreaterThan(-1);
    expect(beforeCta).toBeLessThan(ctaIndex);
    expect(ctaIndex).toBeLessThan(afterCta);

    // 네 조건이 전부 화면에 남아 있어야 한다. 접근성·고지 의무는 위치가 아니라 존재다.
    expect(closing).not.toMatch(/startConditions\.slice\(0,\s*1\)/u);
  });

  it("never puts a 44px touch target inline inside a paragraph", () => {
    // 44px 최소 높이를 문단 안 inline 요소에 주면 line box가 44px로 벌어져
    // 링크가 혼자 줄을 차지한다. WCAG 2.5.8도 문장 안 대상은 크기 요건에서 제외한다.
    for (const [file, source] of components) {
      const paragraphs = [...source.matchAll(/<p\b[\s\S]*?<\/p>/gu)].map((m) => m[0]);
      for (const p of paragraphs) {
        expect(
          /min-h-11|min-h-\[44px\]/u.test(p),
          `${file}: 문단 안 링크에 44px를 주지 말고 문단 밖으로 꺼내거나 inlineLink를 쓴다`,
        ).toBe(false);
      }
    }
  });

  it("keeps structural borders to two alphas per ground", () => {
    // 도입 전에는 3개 역할에 18종의 테두리 토큰이 있었고, #243832의 /10·/12·/14·/16은
    // 합성하면 RGB 4단위 차이라 육안으로 구분되지 않았다.
    const allowed = new Set([
      "border-[#243832]/10", "border-[#243832]/14",
      "border-white/12", "border-white/18",
    ]);
    const structural = new Map<string, string[]>();
    for (const [file, source] of components) {
      for (const m of source.matchAll(/border-(?:\[#243832\]|white)\/\d+/gu)) {
        if (allowed.has(m[0])) continue;
        structural.set(m[0], [...(structural.get(m[0]) ?? []), file]);
      }
    }
    expect(
      [...structural.entries()].map(([t, f]) => `${t} (${[...new Set(f)].join(", ")})`),
      "구조 테두리는 밝은 지면 /10·/14, 어두운 지면 /12·/18만 쓴다",
    ).toEqual([]);
  });

  it("keeps every border radius on the DESIGN.md scale", () => {
    // DESIGN.md: sm 6, md 8, lg 12, xl 16, 2xl 20, 3xl 28, full.
    // Tailwind v4에는 20·28 스텝이 없어 arbitrary 표기가 유일한 방법이다.
    const allowed = new Set([6, 8, 12, 16, 20, 28]);
    for (const [file, source] of components) {
      const off = [...source.matchAll(/rounded(?:-[a-z]{1,2})?-\[(\d+)px\]/gu)]
        .filter((m) => !allowed.has(Number(m[1])))
        .map((m) => m[0]);
      expect(off, `${file}에 스케일 밖 라운드가 있다`).toEqual([]);
    }
  });

  it("reserves the 2px left rule for quoted sources and marks applied results with sage", () => {
    const hero = components.find(([n]) => n === "TransformationHero.tsx")?.[1] ?? "";
    const result = components.find(([n]) => n === "PreparationResult.tsx")?.[1] ?? "";
    // 히어로: 커플이 한 말을 인용 → mauve 규칙선
    expect(hero).toMatch(/<blockquote[^>]*border-l-2 border-\[#A77B74\]/u);
    // 준비 결과: 반영된 기록 → sage(DESIGN.md가 operational states에 배정한 색)
    expect(result).toContain("border-l-2 border-sage-500");
    expect(result, "같은 표시가 출처와 목적지 두 의미로 쓰이면 안 된다")
      .not.toContain("border-l-2 border-[#A77B74]");
  });
});
