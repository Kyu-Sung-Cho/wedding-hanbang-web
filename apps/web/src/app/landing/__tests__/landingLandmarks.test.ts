import { describe, expect, it } from "vitest";

import { everyLandingComponent, rendered, renderedSections } from "./landingSource";

/**
 * 랜딩의 랜드마크와 장식이 보조기기에 올바르게 보이는지.
 *
 * ## 왜 생겼나
 *
 * 2026-08-27 실측에서 **섹션 랜드마크 두 개에 이름이 없었다.** 히어로와 마무리는
 * 자기 마크업이라 `Section` 컴포넌트가 자동으로 붙여 주는 `aria-labelledby` 를
 * 못 받았고, 스크린리더 랜드마크 목록에서 그 둘이 "section" 으로만 떴다.
 * 목록으로 건너뛰는 사람에게는 그 자리가 어디인지 알 방법이 없다.
 *
 * 실행 중인 서버로 재면 그 순간의 화면만 보게 되고 CI 에서는 못 돈다.
 * 여기서는 **소스**로 같은 것을 지킨다.
 *
 * ## 이 파일이 지키지 않는 것
 *
 * 색 대비와 실제 포커스 표시는 픽셀을 봐야 알 수 있어 여기서 다루지 않는다.
 * 그건 화면을 띄워 재고, 이 파일은 구조만 본다.
 */

const components = everyLandingComponent();

/** `<section` 을 여는 자리마다 그 여는 태그 전체를 뽑는다. */
function openingSections(source: string): string[] {
  const out: string[] = [];
  const re = /<section\b/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    // 여는 태그가 `>` 로 끝날 때까지. 속성 안의 `>`(예: 화살표 함수)는 없다고 보고
    // 중괄호 깊이를 세어 넘긴다.
    let depth = 0;
    let i = m.index;
    for (; i < source.length; i += 1) {
      const c = source[i];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) break;
    }
    out.push(source.slice(m.index, i + 1));
  }
  return out;
}

describe("랜딩 랜드마크", () => {
  it("모든 <section> 에 이름이 있다", () => {
    // `Section`(notebook.tsx)을 쓰면 자동으로 붙는다. 자기 마크업으로 여는 섹션은
    // 직접 붙여야 한다 — 히어로와 마무리가 그 경우이고, 실제로 빠져 있었다.
    const nameless: string[] = [];
    for (const [file, source] of components) {
      for (const tag of openingSections(source)) {
        const named = /aria-labelledby=/u.test(tag) || /aria-label=/u.test(tag);
        if (!named) nameless.push(`${file}: ${tag.replace(/\s+/gu, " ").slice(0, 70)}`);
      }
    }
    expect(nameless, "이름 없는 섹션 랜드마크").toEqual([]);
  });

  it("aria-labelledby 가 같은 파일 안의 실재하는 id 를 가리킨다", () => {
    // 끊긴 참조는 이름이 없는 것과 같은데, 화면은 멀쩡해 보인다.
    const dangling: string[] = [];
    for (const [file, source] of components) {
      const targets = [...source.matchAll(/aria-labelledby="([^"{}]+)"/gu)].map((m) => m[1]);
      for (const target of targets) {
        if (!source.includes(`id="${target}"`)) {
          dangling.push(`${file}: ${target}`);
        }
      }
    }
    expect(dangling, "가리키는 id 가 없는 aria-labelledby").toEqual([]);
  });

  it("Section 을 쓰는 섹션은 id 를 받는다", () => {
    // `Section` 은 `id` 가 있을 때만 `aria-labelledby` 를 붙인다. id 없이 쓰면
    // 이름 없는 랜드마크가 하나 늘어나는데, 위 검사는 `<section` 리터럴만 보므로
    // 그 경로로는 안 걸린다.
    const idless: string[] = [];
    for (const [file, source] of components) {
      for (const m of source.matchAll(/<Section\b([\s\S]*?)>/gu)) {
        if (!/\bid=/u.test(m[1])) {
          idless.push(`${file}: <Section ${m[1].replace(/\s+/gu, " ").slice(0, 60)}>`);
        }
      }
    }
    expect(idless, "id 없이 쓴 Section — 랜드마크에 이름이 안 붙는다").toEqual([]);
  });

  it("장식 그림은 보조기기에서 숨긴다", () => {
    // 부케·가지·화환은 읽어 줄 내용이 없다. 숨기지 않으면 스크린리더가
    // 의미 없는 그래픽을 하나씩 읽는다.
    const exposed: string[] = [];
    for (const [file, source] of components) {
      for (const m of source.matchAll(/<svg\b([\s\S]*?)>/gu)) {
        const attrs = m[1];
        if (!/aria-hidden="true"/u.test(attrs) && !/\brole=/u.test(attrs)) {
          exposed.push(`${file}: <svg ${attrs.replace(/\s+/gu, " ").slice(0, 60)}>`);
        }
      }
    }
    expect(exposed, "숨기지도 이름 주지도 않은 SVG").toEqual([]);
  });

  it("눌리지 않는 그림 버튼은 노출하지 않는다", () => {
    // ConfirmSection 의 [확인]/[나중에] 는 기능을 보여주는 그림이지 버튼이 아니다.
    // 노출되면 스크린리더 사용자가 "확인" 을 찾아 눌러 보려 한다.
    const confirm = rendered("src/components/landing/redesign/ConfirmSection.tsx");
    const fake = confirm.slice(confirm.indexOf("sample.confirm") - 700, confirm.indexOf("sample.later") + 60);
    expect(fake, "가짜 승인 버튼 자리를 찾지 못했다").toContain("sample.confirm");
    expect(fake, "가짜 버튼이 aria-hidden 없이 노출된다").toContain('aria-hidden="true"');
  });

  it("페이지에 h1 이 하나뿐이다", () => {
    // 섹션 제목은 전부 h2 다. h1 이 둘이면 문서 개요가 두 갈래로 갈린다.
    const h1Owners = components
      .filter(([, source]) => /<h1\b/u.test(source))
      .map(([file]) => file);
    expect(h1Owners, "h1 을 가진 컴포넌트").toEqual(["TransformationHero.tsx"]);

    const hero = rendered("src/components/landing/redesign/TransformationHero.tsx");
    expect((hero.match(/<h1\b/gu) ?? []).length).toBe(1);
  });

  it("본문 바로가기가 <main> 을 가리킨다", () => {
    // 키보드 첫 Tab 이 닿는 곳이다. 가리키는 id 가 없으면 아무 데도 안 간다.
    const page = rendered("src/app/landing/page.tsx");
    expect(page).toContain('href="#main-content"');
    expect(page).toContain('id="main-content"');
    // 링크가 먼저 와야 Tab 순서에서 첫 번째가 된다.
    expect(page.indexOf('href="#main-content"')).toBeLessThan(page.indexOf("<LandingHeader"));
  });

  it("섹션 앵커가 실제로 렌더되는 섹션을 가리킨다", () => {
    // 헤더 내비가 없는 앵커를 가리키면 눌러도 아무 일이 안 일어난다.
    const page = rendered("src/app/landing/page.tsx");
    const content = rendered("src/components/landing/redesign/landingContent.ts");
    const anchors = [...content.matchAll(/href:\s*"#([a-z-]+)"/gu)].map((m) => m[1]);
    expect(anchors.length, "앵커를 하나도 못 찾았다").toBeGreaterThan(0);

    // 앵커가 가리키는 id 는 섹션이 `Section id="..."` 로 만든다.
    const ids = new Set(
      components.flatMap(([, source]) =>
        [...source.matchAll(/id="([a-z-]+)"/gu)].map((m) => m[1]),
      ),
    );
    const dead = anchors.filter((a) => !ids.has(a));
    expect(dead, "가리키는 섹션이 없는 앵커").toEqual([]);

    // 그 섹션들이 실제로 page.tsx 에 그려지는지도 본다 — id 는 있는데 페이지가
    // 그 컴포넌트를 안 그리면 앵커는 여전히 죽는다.
    // 2026-08-29: 여기는 `>= 8` 이었다. 정본 시안으로 다시 지으면서 `<main>` 안이
    // 일곱이 됐다. 숫자만 7로 낮추면 이 줄은 아무것도 지키지 않는다 — 섹션을
    // 하나 지우고 다른 하나를 둘로 쪼개도 통과한다. 그래서 **목록을 고정한다**.
    // 새 섹션을 더하는 것은 자유이고(부분집합 검사), 있던 것을 지우면 깨진다.
    const inMain = renderedSections();
    for (const section of [
      "TransformationHero",
      "AmoraNoteSection",
      "ConfirmSection",
      "CommunitySection",
      "AvailableNowSection",
      "BoundariesSection",
      "ClosingAction",
    ]) {
      expect(inMain, `${section} 이 <main> 에서 사라졌다`).toContain(section);
    }
    expect(page).toContain("<main");
  });
  it("sticky 헤더 위에 overflow 를 얹지 않는다", () => {
    // 2026-08-29 실측: 헤더는 `sticky top-0 z-50` 인데 **안 붙었다.** 2,500px 스크롤
    // 뒤 헤더의 top 이 -2500 이었다 — 7,400px 짜리 랜딩에서 내비가 통째로 사라진다.
    //
    // 원인은 헤더가 아니라 **조상**이다. `page.tsx` 의 래퍼가 `overflow-hidden` 을
    // 갖고 있었고, 조상의 overflow 가 `visible` 이 아니면 그 안의 sticky 는
    // 가장 가까운 스크롤 컨테이너를 그 조상으로 잡아 붙을 자리를 잃는다.
    // 꽃 장식의 음수 오프셋을 자르려고 넣은 것이었는데, 자르는 일은
    // `LandingBloomLayer` 가 자기 상자에서 이미 한다(정본 시안도 그렇게 뒀다).
    //
    // 브라우저 없이 잡을 수 있는 형태로 고정한다: **랜딩 표면에 sticky 가 있다면
    // 페이지 래퍼는 overflow 를 갖지 않는다.**
    const page = rendered("src/app/landing/page.tsx");
    const header = rendered("src/components/landing/redesign/LandingHeader.tsx");

    // 전제 확인 — sticky 가 없어졌다면 이 검사는 지킬 대상이 없다.
    expect(header, "헤더가 더 이상 sticky 가 아니다 — 이 검사의 전제가 깨졌다")
      .toMatch(/sticky/u);

    // 래퍼(=`return (` 뒤 첫 `<div`)의 클래스만 본다. 파일 전체에서 찾으면
    // 섹션 안의 정당한 overflow 까지 잡는다.
    const at = page.indexOf("<div");
    expect(at, "랜딩 래퍼 <div> 를 못 찾았다").toBeGreaterThan(-1);
    const wrapper = page.slice(at, page.indexOf(">", at));
    expect(
      wrapper,
      "래퍼가 overflow 를 가지면 sticky 헤더가 조용히 죽는다. 자르는 일은 "
        + "LandingBloomLayer 가 자기 상자에서 한다.",
    ).not.toMatch(/overflow-(hidden|clip|auto|scroll|x-hidden|y-hidden)/u);

    // 꽃 레이어가 자기 상자에서 자르는지도 함께 본다 — 여기까지 없어지면 래퍼의
    // overflow 를 되돌리고 싶어진다.
    expect(
      rendered("src/components/landing/redesign/LandingBloomLayer.tsx"),
      "꽃 레이어가 스스로 자르지 않는다 — 래퍼에 overflow 를 넣고 싶어진다",
    ).toMatch(/overflow-hidden/u);
  });
});
