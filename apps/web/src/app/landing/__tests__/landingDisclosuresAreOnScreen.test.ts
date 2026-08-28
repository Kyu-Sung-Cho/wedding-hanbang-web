import { describe, expect, it } from "vitest";

import {
  CONTENT_PATH,
  everyLandingComponent,
  rendered,
  renderedSections,
} from "./landingSource";

/**
 * 고지 문장이 **카피 파일에만** 있고 화면에는 없는 상태를 막는다.
 *
 * ## 왜 생겼나
 *
 * 랜딩 가드 대부분이 "이 문장이 `landingContent.ts` 에 있나" 로 묻는다. 그러면
 * 그 문장을 그리는 `<p>` 를 지워도 통과한다 — 카피 파일이 대신 대답하기 때문이다.
 *
 * 2026-08-27 적대적 검증에서 이 갈래로 17개가 빠져나갔다. 실제로 통과한 것들:
 *
 *   - `NotForVendorsSection` 에서 AI 고지 `<p>` 삭제 → 초록
 *   - `ClosingAction` 에서 "로그인 없이 열려요 / 결제를 요청하지 않아요" 삭제 → 초록
 *   - `ScenesSection` 에서 "궁합 점수를 매기지 않아요" 삭제 → 초록 (CLAUDE.md 금지 대응)
 *   - `AvailableNowSection` 의 `availableNow.map` → `[].map` (카드 6장 소멸) → 초록
 *   - 그리는 `<p>` 를 `{false && <p>…</p>}` 로 감싸기 → 초록
 *   - 그리는 `<p>` 에 `hidden` 클래스 추가 → 초록
 *   - 다른 파일(장식 파일)에 아무도 부르지 않는 컴포넌트를 만들어 참조만 남기기 → 초록
 *
 * ## 무엇을 지키나
 *
 * **법·신뢰 때문에 화면에 있어야 하는 문장**만 본다. 그 문장이
 *
 *   (1) 카피에 있고
 *   (2) `page.tsx` 가 실제로 그리는 컴포넌트가 그 값을 JSX 로 내보내고
 *   (3) 그 자리가 꺼져 있지 않은가 — `hidden`·`{false &&`·`{/* *␣/}`
 *
 * 셋을 함께 본다. 하나만 보면 나머지 둘로 우회된다.
 *
 * ## 이 파일이 지키지 않는 것
 *
 * 실제 픽셀 가시성(대비·겹침·화면 밖)은 소스로 알 수 없다. 그건 화면을 띄워 잰다.
 */

/**
 * 화면에서 사라지면 안 되는 고지.
 *
 * `key` 는 `landingContent` 안의 경로다. 그리는 컴포넌트가 `{경로}` 를 JSX 로
 * 내보내야 한다. `owner` 는 그 일을 하는 컴포넌트 파일이다.
 */
const DISCLOSURES: ReadonlyArray<{ key: string; owner: string; why: string }> = [
  {
    key: "notForVendors.aiNotice",
    owner: "NotForVendorsSection.tsx",
    why: "AI 기본법 — 아모라 답변이 AI 생성물이라는 고지",
  },
  {
    key: "noSide.note",
    owner: "NoSideSection.tsx",
    why: "아모라를 처음 소개하는 자리의 AI 고지",
  },
  {
    key: "privateLane.note",
    owner: "PrivateLaneSection.tsx",
    why: "대화가 저장될 수 있다는 개인정보 고지",
  },
  {
    key: "confirm.note",
    owner: "ConfirmSection.tsx",
    why: "계정 베타 경계 — 비용이 정해지지 않았고 샘플이라는 고지",
  },
  {
    key: "closing.note",
    owner: "ClosingAction.tsx",
    why: "무엇이 로그인 없이 열리는지 · 결제를 요청하지 않는다는 고지",
  },
  {
    key: "footer.notice",
    owner: "LandingFooter.tsx",
    why: "가격 출처·기준일·지역 편차·예약은 업체와 직접이라는 고지",
  },
  {
    key: "scenes.note",
    owner: "ScenesSection.tsx",
    why: "궁합 점수·성격 판정을 하지 않는다는 고지(CLAUDE.md 금지 대응)",
  },
  {
    key: "hero.note",
    owner: "TransformationHero.tsx",
    why: "첫 화면에서 가입이 필요 없다는 것과 답을 저장하지 않는다는 고지",
  },
  {
    key: "notForVendors.priceAside",
    owner: "NotForVendorsSection.tsx",
    why: "공시 가격이 공개 자료이고 출처·시점을 붙였다는 고지",
  },
];

/** `key` 의 마지막 조각. 컴포넌트는 구조분해해서 쓰는 경우가 많다. */
function leaf(key: string): string {
  return key.slice(key.lastIndexOf(".") + 1);
}

/** 그 컴포넌트가 이 값을 JSX 표현식으로 내보내는가. */
function rendersValue(source: string, key: string): boolean {
  const tail = leaf(key);
  const group = key.slice(0, key.lastIndexOf("."));
  // `{notForVendors.aiNotice}` · `{aiNotice}` · `{copy.aiNotice}` 를 모두 받는다.
  const patterns = [
    new RegExp(`\\{\\s*${group}\\.${tail}\\s*\\}`, "u"),
    new RegExp(`\\{\\s*[A-Za-z_$][\\w$]*\\.${tail}\\s*\\}`, "u"),
    new RegExp(`\\{\\s*${tail}\\s*\\}`, "u"),
  ];
  return patterns.some((p) => p.test(source));
}

/** 그 값을 내보내는 줄이 꺼져 있는가. */
function switchedOff(source: string, key: string): string | null {
  const tail = leaf(key);
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!new RegExp(`\\{[^}]*\\b${tail}\\s*\\}`, "u").test(lines[i])) continue;
    // 그 줄과 바로 앞 두 줄을 본다 — 여는 태그가 여러 줄로 쪼개져 있을 수 있다.
    const window = lines.slice(Math.max(0, i - 2), i + 1).join(" ");
    if (/\{\s*false\s*&&/u.test(window)) return "{false && …} 로 꺼져 있다";
    if (/className=\{?["'`][^"'`]*\bhidden\b/u.test(window)) return "hidden 클래스로 감춰져 있다";
  }
  return null;
}

const components = new Map(everyLandingComponent());

describe("고지 문장은 화면에 있다", () => {
  it("모든 고지가 카피에 있다", () => {
    const content = rendered(CONTENT_PATH);
    const missing = DISCLOSURES.filter(({ key }) => {
      const [group, tail] = [key.slice(0, key.lastIndexOf(".")), leaf(key)];
      // `hero: { … note: "…" }` 형태를 확인한다.
      const block = content.slice(content.indexOf(`  ${group}: {`));
      return !block.startsWith(`  ${group}: {`) || !block.includes(`${tail}:`);
    });
    expect(
      missing.map((d) => `${d.key} — ${d.why}`),
      "카피에서 사라진 고지",
    ).toEqual([]);
  });

  it("고지를 그리는 컴포넌트가 page.tsx 에 실제로 그려진다", () => {
    // 카피에 있고 컴포넌트도 그리는데, 그 컴포넌트를 페이지가 안 그리면 화면엔 없다.
    const drawn = new Set(renderedSections().map((s) => `${s}.tsx`));
    // 헤더·푸터는 <main> 밖이라 renderedSections 가 안 센다. 페이지 소스로 확인한다.
    const page = rendered("src/app/landing/page.tsx");
    const orphans = DISCLOSURES.filter(
      ({ owner }) => !drawn.has(owner) && !page.includes(`<${owner.replace(".tsx", "")}`),
    );
    expect(
      orphans.map((d) => `${d.owner} (${d.key})`),
      "페이지가 그리지 않는 컴포넌트가 고지를 들고 있다",
    ).toEqual([]);
  });

  it("그 컴포넌트가 고지 값을 JSX 로 내보낸다", () => {
    const notRendered = DISCLOSURES.filter(({ key, owner }) => {
      const source = components.get(owner);
      return !source || !rendersValue(source, key);
    });
    expect(
      notRendered.map((d) => `${d.owner} 가 ${d.key} 를 그리지 않는다 — ${d.why}`),
      "카피에만 있고 화면에 없는 고지",
    ).toEqual([]);
  });

  it("고지를 그리는 자리가 꺼져 있지 않다", () => {
    const off: string[] = [];
    for (const { key, owner, why } of DISCLOSURES) {
      const source = components.get(owner);
      if (!source) continue;
      const reason = switchedOff(source, key);
      if (reason) off.push(`${owner}: ${key} 가 ${reason} — ${why}`);
    }
    expect(off, "꺼져 있는 고지").toEqual([]);
  });

  it("고지의 주인이 실제로 그 파일 하나뿐이다", () => {
    // 다른 파일에 참조만 남겨 두고 진짜 렌더를 지우는 우회가 있었다
    // (장식 파일에 아무도 부르지 않는 컴포넌트를 만들어 참조만 넣었다).
    // 주인 외의 파일이 같은 값을 그리면 어느 쪽이 화면인지 알 수 없으므로 막는다.
    const strays: string[] = [];
    for (const { key, owner } of DISCLOSURES) {
      for (const [file, source] of components) {
        if (file === owner) continue;
        const tail = leaf(key);
        // 다른 섹션이 우연히 같은 이름의 키를 쓸 수 있으므로 그룹까지 붙은 표기만 본다.
        const group = key.slice(0, key.lastIndexOf("."));
        if (new RegExp(`\\{\\s*${group}\\.${tail}\\s*\\}`, "u").test(source)) {
          strays.push(`${file} 도 ${key} 를 그린다 (주인은 ${owner})`);
        }
      }
    }
    expect(strays, "고지를 두 곳에서 그린다").toEqual([]);
  });

  it("'지금 되는 것' 카드가 배열에서 그려진다", () => {
    // `availableNow.map` 을 `[].map` 으로 바꿔 카드 6장을 통째로 없애도 통과했다.
    const source = components.get("AvailableNowSection.tsx");
    expect(source, "AvailableNowSection 이 없다").toBeTruthy();
    expect(source!, "카드를 카피 배열에서 그리지 않는다").toMatch(
      /availableNow\.map\(/u,
    );
    expect(source!, "빈 배열에서 그린다").not.toMatch(/\[\]\.map\(/u);
  });
});
