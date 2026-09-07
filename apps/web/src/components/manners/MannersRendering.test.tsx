// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MannersIndexPage from "@/app/manners/page";
import MannersLayout from "@/app/manners/layout";
import { generateStaticParams } from "@/app/manners/[slug]/page";
import { MANNERS_CATEGORIES, MANNERS_PARTS } from "@/lib/manners/data";
import { readingMinutesOf } from "@/lib/manners/readingTime";
import MannersPartView from "./MannersPartView";

const text = (value: string | null) => (value ?? "").replace(/\s+/g, " ").trim();
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

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
          if (block.unsourced) expect(figureText).toContain("공개된 1차 자료를 아직 찾지 못한 표예요.");
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
    expect(doc.querySelectorAll('input[type="checkbox"], [role="progressbar"]')).toHaveLength(0);
    expect(pageText).not.toMatch(/개 절 중.*발췌|읽기 완료|양측.*확정/);

    let previousLevel = 0;
    for (const heading of doc.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
      const level = Number(heading.tagName.slice(1));
      expect(level).toBeLessThanOrEqual(previousLevel + 1);
      previousLevel = level;
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
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect(doc.querySelector('[aria-label="정책"]')?.textContent).toContain("개인정보처리방침");
    expect([...doc.querySelectorAll('[aria-label="정책"] a')].map(link => link.getAttribute("href"))).toEqual(["/terms", "/privacy", "/ai-policy"]);
    expect(doc.querySelector('[aria-label="서비스 메뉴"] [aria-current="location"]')?.getAttribute("href")).toBe("/wedding/manners");
    expect(doc.body.textContent).not.toMatch(/로그아웃|D-\d|알림 \d/);
  });
});
