// @vitest-environment jsdom

import { act, createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import MannersIndexPage from "@/app/manners/page";
import MannersLayout from "@/app/manners/layout";
import { generateStaticParams } from "@/app/manners/[slug]/page";
import { MANNERS_CATEGORIES, MANNERS_PARTS } from "@/lib/manners/data";
import { readingMinutesOf } from "@/lib/manners/readingTime";
import MannersPartView from "./MannersPartView";

const text = (value: string | null) => (value ?? "").replace(/\s+/g, " ").trim();
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mountedRoot: Root | undefined;
function mount(element: ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  act(() => { mountedRoot = createRoot(container); mountedRoot.render(element); });
  return container;
}
function searchGuide(container: HTMLElement, value: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="search"][aria-label="가이드 검색"]');
  expect(input, "가이드 검색 입력을 제공한다").not.toBeNull();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function clickButton(container: HTMLElement, name: string) {
  const button = [...container.querySelectorAll("button")].find(element => element.getAttribute("aria-label") === name || element.textContent === name);
  expect(button, `${name} 버튼을 제공한다`).toBeDefined();
  act(() => button!.click());
  return button!;
}
afterEach(() => { act(() => mountedRoot?.unmount()); mountedRoot = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

describe("예절에서 필요한 글과 절을 찾는다", () => {
  it("제목에 없는 본문 키워드도 검색하고, 빈 결과에서 전체 목록으로 돌아온다", () => {
    const container = mount(<MannersIndexPage />);
    searchGuide(container, "봉투");
    expect(container.querySelector('[data-guide-slug="gift-money"]')).not.toBeNull();
    expect(container.querySelector('[data-guide-slug="post-honeymoon-thanks"]')).toBeNull();
    searchGuide(container, "찾을수없는가이드123");
    expect(container.textContent).toContain("찾는 가이드가 없어요");
    expect(container.querySelectorAll("[data-guide-slug]")).toHaveLength(0);
    clickButton(container, "검색과 주제 초기화");
    expect(container.querySelectorAll("[data-guide-slug]")).toHaveLength(25);
  });

  it("주제를 선택한 뒤에도 검색 조건을 함께 적용하고 전체로 복구한다", () => {
    const container = mount(<MannersIndexPage />);
    clickButton(container, "식이 끝난 뒤");
    expect(container.querySelector('[data-guide-slug="post-honeymoon-thanks"]')).not.toBeNull();
    expect(container.querySelector('[data-guide-slug="gift-money"]')).toBeNull();
    searchGuide(container, "신혼여행");
    expect(container.querySelector('[data-guide-slug="post-honeymoon-thanks"]')).not.toBeNull();
    expect([...container.querySelectorAll("button")].find(button => button.textContent === "식이 끝난 뒤")?.getAttribute("aria-pressed")).toBe("true");
    clickButton(container, "검색과 주제 초기화");
    expect(container.querySelectorAll("[data-guide-slug]")).toHaveLength(25);
  });

  it("검색어를 지우거나 초기화해도 키보드 초점이 검색창으로 돌아온다", () => {
    const container = mount(<MannersIndexPage />);
    searchGuide(container, "봉투");
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    container.querySelector<HTMLButtonElement>('button[aria-label="검색어 지우기"]')!.focus();
    clickButton(container, "검색어 지우기");
    expect(document.activeElement).toBe(input);
    clickButton(container, "식이 끝난 뒤");
    container.querySelector<HTMLButtonElement>('button[aria-label="검색과 주제 초기화"]')!.focus();
    clickButton(container, "검색과 주제 초기화");
    expect(document.activeElement).toBe(input);
  });

  it("상단 주의문에만 있는 키워드로도 가이드를 찾는다", () => {
    const container = mount(<MannersIndexPage />);
    searchGuide(container, "식대별");
    expect(container.querySelector('[data-guide-slug="gift-money"]')).not.toBeNull();
  });

  it("타임라인에만 표시된 문구도 검색에 포함한다", () => {
    const part = MANNERS_PARTS.find(item => item.slug === "wedding-day")!;
    const block = part.sections.flatMap(section => section.blocks).find(item => item.kind === "table" && item.timeline);
    if (block?.kind !== "table" || !block.timeline?.length) throw new Error("타임라인이 필요해요.");
    const node = block.timeline[0];
    const originalLabel = node.label;
    try {
      node.label = "검증용동선표시";
      const container = mount(<MannersIndexPage />);
      searchGuide(container, "검증용동선표시");
      expect(container.querySelector('[data-guide-slug="wedding-day"]')).not.toBeNull();
    } finally {
      node.label = originalLabel;
    }
  });

  it("역할을 바꾸면 목차도 공통 절과 선택한 역할만 가리킨다", () => {
    const part = MANNERS_PARTS.find(item => item.slug === "wedding-day")!;
    const container = mount(<MannersPartView part={part} />);
    act(() => container.querySelector<HTMLInputElement>('#wedding-day-role-guest')!.click());
    const toc = container.querySelector<HTMLElement>('nav[aria-label="이 글의 목차"]');
    expect(toc, "원문의 절을 목차로 연결한다").not.toBeNull();
    const links = [...toc!.querySelectorAll('a[href^="#section-"]')].map(a => a.getAttribute("href"));
    const expected = part.sections.flatMap((section, index) => !section.role || section.role === "공통" || section.role === "하객" ? [`#section-${index + 1}`] : []);
    expect(links).toEqual(expected);
    expect(links.length).toBeLessThan(part.sections.length);
    expect(container.querySelectorAll("section[id^='section-']")).toHaveLength(part.sections.length);
    act(() => container.querySelector<HTMLInputElement>('#wedding-day-role-all')!.click());
    expect(toc!.querySelectorAll('a[href^="#section-"]')).toHaveLength(part.sections.length);
  });

  it("같은 절 앵커를 다시 눌러도 해당 절로 이동한다", () => {
    const scroll = vi.fn();
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const part = MANNERS_PARTS.find(item => item.slug === "gift-money")!;
    const container = mount(<MannersPartView part={part} />);
    const target = container.querySelector<HTMLElement>("#section-1")!;
    target.scrollIntoView = scroll;
    const link = container.querySelector<HTMLAnchorElement>('nav[aria-label="이 글의 목차"] a[href="#section-1"]');
    expect(link, "첫 절 목차 링크를 제공한다").not.toBeNull();
    act(() => link!.click());
    act(() => link!.click());
    expect(window.location.hash).toBe("#section-1");
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(target).toBe(document.activeElement);
    vi.unstubAllGlobals();
  });

  it("역할 밖의 절 주소로 들어오면 전체 역할로 되돌려 원문을 보여준다", () => {
    const part = MANNERS_PARTS.find(item => item.slug === "wedding-day")!;
    const container = mount(<MannersPartView part={part} />);
    act(() => container.querySelector<HTMLInputElement>('#wedding-day-role-guest')!.click());
    const hiddenIndex = part.sections.findIndex(section => section.role === "두 사람");
    const target = container.querySelector<HTMLElement>(`#section-${hiddenIndex + 1}`)!;
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    act(() => {
      window.history.replaceState(null, "", `#section-${hiddenIndex + 1}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(container.querySelector<HTMLInputElement>('#wedding-day-role-all')?.checked).toBe(true);
    expect(container.querySelectorAll('nav[aria-label="이 글의 목차"] a')).toHaveLength(part.sections.length);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(target);
  });

  it("목차로 돌아가면 접혀 있던 목차를 열고 초점을 옮긴다", () => {
    const part = MANNERS_PARTS.find(item => item.slug === "gift-money")!;
    const container = mount(<MannersPartView part={part} />);
    const toc = container.querySelector<HTMLDetailsElement>("#manners-toc")!;
    toc.scrollIntoView = vi.fn();
    expect(toc.open).toBe(false);
    act(() => container.querySelector<HTMLAnchorElement>('a[href="#manners-toc"]')!.click());
    expect(toc.open).toBe(true);
    expect(document.activeElement).toBe(toc);
  });
});

describe("예절 HTML 패턴이 검증 원문 전체를 보존한다", () => {
  it.each(MANNERS_PARTS)("$slug의 모든 절·문장·표·근거가 서버 HTML에 남는다", part => {
    const doc = parse(renderToStaticMarkup(createElement(MannersPartView, { part })));
    const pageText = text(doc.body.textContent);
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect(doc.querySelector("h1")?.textContent).toBe(part.title);
    for (const value of [part.subtitle, part.description, part.caveat]) expect(pageText).toContain(text(value));
    expect(pageText).toContain(`예상 읽기 ${readingMinutesOf(part.sections)}분 · ${part.sections.length}개 절`);
    expect(doc.querySelectorAll("section[id^='section-']")).toHaveLength(part.sections.length);

    part.sections.forEach((section, index) => {
      const rendered = doc.getElementById(`section-${index + 1}`);
      expect(rendered).not.toBeNull();
      expect(rendered?.getAttribute("data-role")).toBe(section.role ?? null);
      expect(rendered?.querySelector("h2")?.textContent).toBe(section.heading.replace(/^[0-9]+[.] */, ""));
      const content = text(rendered?.textContent ?? null);
      for (const block of section.blocks) {
        if (block.kind === "paragraph") {
          expect(content).toContain(text(block.text));
          if (block.law) {
            expect([...rendered!.querySelectorAll("details")].some(details => text(details.textContent).includes(text(block.text)))).toBe(true);
          }
        } else if (block.kind === "dialogue") {
          for (const line of block.lines) {
            expect(content).toContain(text(line.say));
            if (line.note) expect(content).toContain(text(line.note));
          }
        } else if (block.kind === "table") {
          const figure = [...rendered!.querySelectorAll("figure")].find(node => text(node.textContent).includes(text(block.title)));
          expect(figure).toBeDefined();
          const figureText = text(figure!.textContent);
          for (const value of [block.title, block.asOf, block.caption, block.limits, ...block.columns, ...block.rows.flat()]) expect(figureText).toContain(text(value));
          // 데스크톱 표와 모바일 행이 각각 원문 값을 가진다. 모바일 발췌 시안의 생략을 복제하지 않는다.
          const desktop = text(figure!.querySelector("table")?.textContent ?? null);
          const mobile = [...figure!.querySelectorAll("dl")].map(node => text(node.textContent)).join(" ");
          for (const cell of block.rows.flat()) {
            expect(desktop).toContain(text(cell));
            expect(mobile).toContain(text(cell));
          }
          if (block.unsourced) expect(figureText).toContain("검증된 가격·통계나 필수 관행을 뜻하지 않습니다");
          for (const ref of block.sourceRefs ?? []) {
            expect([...figure!.querySelectorAll("a")].map(link => link.getAttribute("href"))).toContain(part.sources[ref - 1].url);
          }
          if (block.timeline) {
            const nodes = [...figure!.querySelectorAll("ol > li")];
            expect(nodes).toHaveLength(block.timeline.length);
            block.timeline.forEach((node, i) => {
              expect(text(nodes[i].textContent)).toContain(text(node.at));
              expect(text(nodes[i].textContent)).toContain(text(node.label));
            });
          }
        } else {
          for (const item of block.items) expect(content).toContain(text(item));
        }
      }
    });

    const sources = doc.querySelector("article > footer");
    expect(Boolean(sources)).toBe(part.sources.length > 0);
    for (const source of part.sources) {
      const sourceText = text(sources?.textContent ?? null);
      for (const value of [source.label, source.checkedAt, source.scope, source.supports]) expect(sourceText).toContain(text(value));
      expect([...sources!.querySelectorAll("a")].map(link => link.getAttribute("href"))).toContain(source.url);
    }
    if (!part.sources.length) expect(pageText).toContain("공개 자료 확인 전");
    else {
      const header = doc.querySelector("article > header")!;
      expect(header.textContent).toContain("출처별 확인일은 아래 자료에서 확인해 주세요");
      expect(header.textContent).not.toMatch(/\d{4}-\d{2}-\d{2} 출처 확인/);
      expect(header.querySelector('a[href="#manners-sources"]')).not.toBeNull();
      expect(sources?.getAttribute("id")).toBe("manners-sources");
      expect(sources?.textContent).toContain("각 자료가 뒷받침하는 내용과 범위를 구분했어요");
    }
    expect(doc.querySelectorAll('input[type="checkbox"], [role="progressbar"]')).toHaveLength(0);
    expect(pageText).not.toMatch(/개 절 중.*발췌|읽기 완료|양측.*확정/);

    let previousLevel = 0;
    for (const heading of doc.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
      const level = Number(heading.tagName.slice(1));
      expect(level).toBeLessThanOrEqual(previousLevel + 1);
      previousLevel = level;
    }
  });

  it("keeps every guide and section question reachable even when a checklist is available", () => {
    for (const part of MANNERS_PARTS) {
      const doc = parse(renderToStaticMarkup(createElement(MannersPartView, { part })));
      const hrefs = [...doc.querySelectorAll<HTMLAnchorElement>('a[href*="amoraSource="]')].map(link => link.getAttribute("href"));
      expect(hrefs).toContain(`/wedding/chat?amoraSource=g.${part.slug}`);
      part.sections.forEach((section, index) => {
        const link = doc.getElementById(`section-${index + 1}`)?.querySelector('a[href*="amoraSource="]');
        expect(link?.getAttribute("href")).toBe(`/wedding/chat?amoraSource=g.${part.slug}.section-${index + 1}`);
        expect(link?.getAttribute("aria-label")).toContain(section.heading.replace(/^[0-9]+[.] */, ""));
      });
      expect(doc.body.textContent).toContain("질문 초안을 확인한 뒤 직접 보내요");
      expect(doc.querySelectorAll('a a, button a')).toHaveLength(0);
    }
  });

  it("역할이 있는 원문에만 이름을 가진 라디오를 제공하고 기본은 전체다", () => {
    for (const part of MANNERS_PARTS) {
      const doc = parse(renderToStaticMarkup(createElement(MannersPartView, { part })));
      const radios = [...doc.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
      expect(radios).toHaveLength(part.sections.some(section => section.role) ? 4 : 0);
      for (const radio of radios) {
        expect(doc.querySelector(`label[for="${radio.id}"]`)?.textContent?.trim()).toBeTruthy();
        expect(radio.checked).toBe(radio.value === "all");
      }
    }
  });

  it("절 맨 앞의 법적 근거는 같은 절의 실무 설명을 읽은 뒤 펼칠 수 있다", () => {
    const part = MANNERS_PARTS.find(item => item.slug === "guest-manners")!;
    const [first] = part.sections;
    const law = first.blocks.find(block => block.kind === "paragraph" && block.law);
    const explanation = first.blocks.find(block => block.kind === "paragraph" && !block.law);
    expect(law?.kind).toBe("paragraph");
    expect(explanation?.kind).toBe("paragraph");
    if (law?.kind !== "paragraph" || explanation?.kind !== "paragraph") throw new Error("원문 문단을 찾지 못했어요.");
    const doc = parse(renderToStaticMarkup(createElement(MannersPartView, { part })));
    const section = doc.getElementById("section-1")!;
    const paragraphs = [...section.querySelectorAll("p")];
    const legalText = paragraphs.find(node => text(node.textContent) === text(law.text))!;
    const practicalText = paragraphs.find(node => text(node.textContent) === text(explanation.text))!;
    expect(practicalText).toBeDefined();
    expect(legalText).toBeDefined();
    expect(practicalText.compareDocumentPosition(legalText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(legalText.closest("section")).toBe(practicalText.closest("section"));
    expect(legalText.closest("details")?.querySelector("summary")?.textContent).toContain("법적 근거 자세히 보기");
  });

  it("목록·정적경로·공개 셸이 모든 편과 실행 도구 및 정책으로 연결된다", () => {
    expect(generateStaticParams()).toEqual(MANNERS_PARTS.map(part => ({ slug: part.slug })));
    const doc = parse(renderToStaticMarkup(<MannersLayout><MannersIndexPage /></MannersLayout>));
    const main = doc.querySelector("main")!;
    const hrefs = [...main.querySelectorAll("a")].map(link => link.getAttribute("href"));
    const order = MANNERS_CATEGORIES.flatMap(category => category.slugs);
    expect(hrefs.filter(href => href?.startsWith("/wedding/manners/"))).toEqual(order.map(slug => `/wedding/manners/${slug}`));
    expect(hrefs).toContain("/wedding/checklist");
    expect(hrefs.filter(href => href?.includes("amoraSource="))).toEqual(order.map(slug => `/wedding/chat?amoraSource=g.${slug}`));
    expect(main.querySelectorAll("a a")).toHaveLength(0);
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect(doc.querySelector('[aria-label="정책"]')?.textContent).toContain("개인정보처리방침");
    expect([...doc.querySelectorAll('[aria-label="정책"] a')].map(link => link.getAttribute("href"))).toEqual(["/terms", "/privacy", "/ai-policy"]);
    expect(doc.querySelector('[aria-label="서비스 메뉴"] [aria-current="location"]')?.getAttribute("href")).toBe("/wedding/manners");
    expect(doc.body.textContent).not.toMatch(/로그아웃|D-\d|알림 \d/);
  });
});
