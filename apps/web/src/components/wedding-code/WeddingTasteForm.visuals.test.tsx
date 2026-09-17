// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WeddingTasteForm from "./WeddingTasteForm";
import { DETAIL_SCENES, MOOD_SCENES, PRIORITY_SCENES } from "./tasteScenes";
import { TASTE_DOMAIN_OPTIONS, TASTE_DOMAIN_QUESTIONS, TASTE_MOOD_OPTIONS, type TasteDomain } from "@/lib/weddingCode/taste";

/**
 * **취향 질문은 그림으로 고른다 — 사진 없이.**
 *
 * 2026-09-17 팀원 피드백: "이미지로도 나타낼 수 있는 항목이 있으면 좋겠음 (ex. 원하는
 * 예식장 분위기)". 권리가 확인된 결혼 사진이 없어서, 공유 분위기 값(`WEDDING_STYLE_OPTIONS`)
 * 마다 **선으로 그린 장면**을 붙였다. 같은 날 파운더가 "그림으로 주는것도 좋네" 라고 해서
 * 첫 질문(주제)과 세부 질문 여섯(공간·사진·입을 옷·식사·사람 수·식순)으로 넓혔다.
 * 피하고 싶은 것(8개)과 협의 질문(추상적인 말)은 글자 버튼으로 남긴다. 이 테스트가 지키는 것:
 *
 * - 그림이 붙은 질문의 **모든 값에 그림이 있고**, 없는 값의 그림은 없다.
 * - 칸이 공유 상수의 순서·라벨 그대로 나오고, 칸마다 숨겨진(aria-hidden) 그림이 있다.
 * - 그림에는 글자 노드가 없다 — 이름은 버튼 라벨이, 설명은 aria-describedby 가 맡는다.
 * - 화면에 쓰이지 않던 설명 줄이 칸 안에 보인다.
 * - 누르면 aria-pressed 가 바뀌고, 고를 수 있는 개수를 넘지 않는다.
 * - **`<img>` 도, 원격 주소도, 박아 넣은 색값도 없다.** 사진을 쓰지 않는다는 결정을
 *   화면에서 확인한다(누군가 "예시 사진 하나만" 넣는 순간 빨개진다).
 * - 그림의 색은 `globals.css` 의 `@theme` 에 있는 토큰으로만 칠한다(오타 난 토큰은 조용히
 *   검정이나 투명으로 그려지므로 여기서 잡는다).
 */

const MOODS = [
  { value: "minimal", label: "간결한 분위기", description: "장식을 줄이고 깔끔하게" },
  { value: "classic", label: "정돈된 격식", description: "차분하고 격식 있게" },
  { value: "fancy", label: "눈에 띄는 연출", description: "장식과 색을 풍성하게" },
  { value: "natural", label: "편안한 분위기", description: "자연 소재처럼 편안하게" },
] as const;
const VENUES = [
  { value: "indoor", label: "실내" },
  { value: "outdoor", label: "야외" },
  { value: "both_spaces", label: "실내와 야외를 함께 쓰는 곳" },
] as const;
const DOMAINS = TASTE_DOMAIN_OPTIONS.map(option => option.value);
const domainLabel = (domain: TasteDomain) => TASTE_DOMAIN_OPTIONS.find(option => option.value === domain)!.label;

let host: HTMLDivElement; let root: Root;
const tiles = () => [...host.querySelectorAll<HTMLButtonElement>("button[data-taste-tile]")];
const labelOf = (item: Element) => item.querySelector("[data-choice-label]")?.textContent?.trim();
const tile = (label: string) => {
  const found = tiles().find(item => labelOf(item) === label);
  expect(found, label).toBeDefined();
  return found!;
};
function clickText(text: string) {
  const button = [...host.querySelectorAll("button")].find(item => (labelOf(item) ?? item.textContent?.trim()) === text);
  expect(button, text).toBeDefined();
  act(() => button!.click());
}
const pressed = () => tiles().filter(item => item.getAttribute("aria-pressed") === "true").map(item => item.dataset.tasteTile);
const tileGrid = () => tiles()[0]?.parentElement;

/**
 * 선택 표시의 체크 아이콘(lucide)은 `xmlns="http://www.w3.org/2000/svg"` 를 속성으로 단다.
 * 내려받는 주소가 아니라 SVG 이름공간 식별자이므로 **이 한 문자열만** 걷어내고 잰다.
 */
const SVG_NAMESPACE_DECLARATION = 'xmlns="http://www.w3.org/2000/svg"';

/** 사진이 아니라 그림이라는 것을 화면 마크업에서 확인한다. */
function expectNoPhotos() {
  expect(host.querySelectorAll("img, picture, source, image, video, iframe, object, embed")).toHaveLength(0);
  const markup = host.innerHTML.split(SVG_NAMESPACE_DECLARATION).join("");
  expect(markup).not.toMatch(/https?:/i);
  expect(markup).not.toMatch(/url\(/i);
  expect(host.querySelectorAll("svg [href], svg use")).toHaveLength(0);
}

/** 그림 하나가 제대로 숨겨진, 글자 없는 토큰 색 그림인지 본다. */
function expectDecorativeSvg(scene: Element, name?: string) {
  expect(scene.getAttribute("aria-hidden"), name).toBe("true");
  expect(scene.getAttribute("focusable"), name).toBe("false");
  expect(scene.querySelectorAll("title, desc, text, textPath, foreignObject"), name).toHaveLength(0);
  expect(scene.textContent, name).toBe("");
  // 빈 틀만 남은 그림을 그림으로 치지 않는다 — 바탕 한 장 외에 그린 것이 있어야 한다.
  expect(scene.querySelectorAll("path, circle, ellipse, rect").length, name).toBeGreaterThan(4);
  expect(scene.outerHTML, `${name}: 색은 토큰 유틸리티로만 칠한다`).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
}

/** 칸 하나의 그림을 본다. */
function expectDecorativeScene(item: HTMLButtonElement) {
  const scenes = item.querySelectorAll("svg[data-taste-scene]");
  expect(scenes, labelOf(item)).toHaveLength(1);
  expectDecorativeSvg(scenes[0], labelOf(item));
}

/** 세부 질문까지 간다 — 첫 질문에서 주제 하나를 고르고, 분위기는 건너뛴다. */
function openDetail(domain: TasteDomain, done = vi.fn()) {
  act(() => root.render(<WeddingTasteForm onComplete={done} />));
  act(() => tile(domainLabel(domain)).click());
  clickText("다음"); clickText("다음");
  expect(host.textContent).toContain(TASTE_DOMAIN_QUESTIONS[domain].question);
  return done;
}

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("그림 묶음이 질문의 값과 맞는다", () => {
  const sortedKeys = (record: object) => Object.keys(record).sort();

  it("분위기·주제 그림은 공유 상수의 값마다 하나씩 있다", () => {
    expect(sortedKeys(MOOD_SCENES)).toEqual(TASTE_MOOD_OPTIONS.map(option => option.value).sort());
    expect(sortedKeys(PRIORITY_SCENES)).toEqual([...DOMAINS].sort());
  });

  it("세부 질문이 있는 주제마다 그림 묶음이 있다", () => {
    expect(sortedKeys(DETAIL_SCENES)).toEqual([...DOMAINS].sort());
    expect(sortedKeys(DETAIL_SCENES)).toEqual(sortedKeys(TASTE_DOMAIN_QUESTIONS));
  });

  it.each(DOMAINS)("%s 질문의 모든 값에 그림이 있고, 없는 값의 그림은 없다", domain => {
    const values = TASTE_DOMAIN_QUESTIONS[domain].options.map(option => option.value);
    expect(sortedKeys(DETAIL_SCENES[domain])).toEqual([...values].sort());
    for (const value of values) expect(typeof (DETAIL_SCENES[domain] as Record<string, unknown>)[value], `${domain}:${value}`).toBe("function");
  });
});

describe("모든 그림이 같은 규칙으로 그려진다", () => {
  const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
  const themeColors = new Set([...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map(match => match[1]));
  const groups: [string, Record<string, () => ReactNode>][] = [
    ["mood", MOOD_SCENES], ["priority", PRIORITY_SCENES],
    ...DOMAINS.map(domain => [domain, DETAIL_SCENES[domain] as Record<string, () => ReactNode>] as [string, Record<string, () => ReactNode>]),
  ];
  const scenes = groups.flatMap(([group, record]) => Object.entries(record).map(([value, draw]): [string, () => ReactNode] => [`${group}:${value}`, draw]));
  const COLOR_CLASS = /^(fill|stroke)-([a-z0-9-]+?)(?:\/(\d{1,3}))?$/;

  it("토큰 목록을 실제로 읽었다", () => {
    expect(themeColors.has("rose-500")).toBe(true);
    expect(themeColors.has("paper-tint")).toBe(true);
    expect(scenes.length).toBeGreaterThanOrEqual(4 + 6 + 3 + 3 + 4 + 3 + 6 + 4);
  });

  it.each(scenes)("%s — 숨김·글자 없음·토큰 색만·굵기 고정", (name, draw) => {
    act(() => root.render(<>{draw()}</>));
    const svgs = host.querySelectorAll("svg");
    expect(svgs, name).toHaveLength(1);
    const scene = svgs[0];
    expect(scene.hasAttribute("data-taste-scene"), name).toBe(true);
    expect(scene.getAttribute("viewBox"), name).toBe("0 0 160 100");
    expect(scene.getAttribute("class"), `${name}: 선 굵기는 칸 크기와 관계없이 같다`).toContain("[vector-effect:non-scaling-stroke]");
    expectDecorativeSvg(scene, name);
    expectNoPhotos();
    expect(scene.querySelectorAll("clipPath, mask, pattern, linearGradient, radialGradient, filter, image, use, style, script, a"), name).toHaveLength(0);

    for (const element of scene.querySelectorAll("*")) {
      const where = `${name} <${element.tagName} ${element.getAttribute("d") ?? ""}>`;
      for (const attribute of ["fill", "stroke", "color", "style", "stop-color"]) expect(element.hasAttribute(attribute), `${where}: ${attribute} 속성 대신 클래스로 칠한다`).toBe(false);
      for (const token of (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)) {
        const match = COLOR_CLASS.exec(token);
        expect(match, `${where}: 그림 안에는 fill-*·stroke-* 토큰 클래스만 쓴다 (${token})`).not.toBeNull();
        if (match![2] !== "none") expect(themeColors.has(match![2]), `${where}: @theme 에 없는 색 ${token}`).toBe(true);
        if (match![3]) expect(Number(match![3]), `${where}: ${token}`).toBeLessThanOrEqual(100);
      }
    }
    // 색 클래스가 자기에게도 조상에게도 없는 도형은 보이지 않는다(뿌리의 fill="none" 만 물려받는다).
    for (const shape of scene.querySelectorAll("path, circle, ellipse, rect")) {
      let painted = false;
      for (let node: Element | null = shape; node && node !== scene; node = node.parentElement) {
        if (/(^|\s)(fill|stroke)-(?!none\b)/.test(node.getAttribute("class") ?? "")) painted = true;
      }
      expect(painted, `${name} <${shape.tagName} ${shape.getAttribute("d") ?? ""}>: 칠하지 않은 도형`).toBe(true);
    }
  });
});

describe("주제 질문의 그림 칸", () => {
  it("여섯 주제를 공유 순서·라벨 그대로 그림과 함께 보여주고 둘까지만 고른다", () => {
    const done = vi.fn();
    act(() => root.render(<WeddingTasteForm onComplete={done} />));
    expect(tiles().map(item => item.dataset.tasteTile)).toEqual(DOMAINS);
    expect(tiles().map(labelOf)).toEqual(TASTE_DOMAIN_OPTIONS.map(option => option.label));
    for (const item of tiles()) {
      expectDecorativeScene(item);
      expect(item.querySelector("[data-choice-description]")).toBeNull();
      expect(item.hasAttribute("aria-describedby")).toBe(false);
    }
    // 여섯 칸은 360px 폰부터 2열, 640px 부터 3열로 놓고, 2열일 때 그림을 2:1 로 낮춘다.
    expect(tileGrid()?.className).toContain("min-[360px]:grid-cols-2");
    expect(tileGrid()?.className).toContain("sm:grid-cols-3");
    expect(tiles()[0].querySelector("svg[data-taste-scene]")?.parentElement?.className).toContain("min-[360px]:aspect-[2/1]");
    expect(host.textContent).toContain("최대 2개");
    expectNoPhotos();

    act(() => tile(domainLabel("meal")).click());
    act(() => tile(domainLabel("attire")).click());
    expect(pressed()).toEqual(["attire", "meal"]);
    expect(tiles().filter(item => item.disabled).map(item => item.dataset.tasteTile)).toEqual(["venue", "photo", "guests", "ceremony"]);
    act(() => tile(domainLabel("venue")).click());
    expect(pressed(), "세 번째는 고를 수 없다").toEqual(["attire", "meal"]);

    // 세부 질문은 고른 순서대로 나온다.
    clickText("다음"); clickText("다음");
    expect(host.textContent).toContain(TASTE_DOMAIN_QUESTIONS.meal.question);
    expect(tiles().map(item => item.dataset.tasteTile)).toEqual(TASTE_DOMAIN_QUESTIONS.meal.options.map(option => option.value));
    clickText("다음");
    expect(host.textContent).toContain(TASTE_DOMAIN_QUESTIONS.attire.question);
    expect(tiles().map(item => item.dataset.tasteTile)).toEqual(TASTE_DOMAIN_QUESTIONS.attire.options.map(option => option.value));
    clickText("다음"); clickText("내 선택 보기");
    expect(done.mock.calls[0][0].priorityDomains).toEqual({ status: "answered", values: ["meal", "attire"] });
  });
});

describe("분위기 질문의 그림 칸", () => {
  function openMood() {
    const done = vi.fn();
    act(() => root.render(<WeddingTasteForm onComplete={done} />));
    expect(tiles().map(item => item.dataset.tasteTile), "첫 질문은 주제 그림 칸이다").toEqual(DOMAINS);
    clickText("다음");
    expect(host.textContent).toContain("원하는 결혼식 분위기는 어떤 쪽인가요?");
    return done;
  }

  it("네 분위기를 공유 순서·라벨 그대로, 칸마다 숨겨진 그림과 함께 보여준다", () => {
    openMood();
    expect(tiles().map(item => item.dataset.tasteTile)).toEqual(MOODS.map(mood => mood.value));
    expect(tiles().map(labelOf)).toEqual(MOODS.map(mood => mood.label));
    for (const item of tiles()) {
      expect(item.tagName).toBe("BUTTON");
      expect(item.type).toBe("button");
      expect(item.className, "키보드 초점이 보인다").toContain("focus-visible:ring-2");
      expectDecorativeScene(item);
    }
    expect(tileGrid()?.className).toContain("min-[360px]:grid-cols-2");
    expect(tileGrid()?.className).not.toContain("sm:grid-cols-3");
    expect(host.textContent).toContain("최대 2개");
    expectNoPhotos();
  });

  it("설명 줄을 칸 안에 보여주고, 이름은 라벨·설명은 aria-describedby 로 읽힌다", () => {
    openMood();
    for (const [index, item] of tiles().entries()) {
      const description = item.querySelectorAll("[data-choice-description]");
      expect(description).toHaveLength(1);
      expect(description[0].textContent).toBe(MOODS[index].description);
      const nameId = item.getAttribute("aria-labelledby");
      const descriptionId = item.getAttribute("aria-describedby");
      expect(nameId && document.getElementById(nameId)?.textContent).toBe(MOODS[index].label);
      expect(descriptionId && document.getElementById(descriptionId)?.textContent).toBe(MOODS[index].description);
      expect(item.contains(document.getElementById(descriptionId!))).toBe(true);
    }
  });

  it("누르면 선택이 바뀌고 둘까지만 고를 수 있으며, 고른 값이 그대로 제출된다", () => {
    const done = openMood();
    expect(pressed()).toEqual([]);
    act(() => tile("간결한 분위기").click());
    act(() => tile("정돈된 격식").click());
    expect(pressed()).toEqual(["minimal", "classic"]);
    expect(tile("눈에 띄는 연출").disabled).toBe(true);
    expect(tile("편안한 분위기").disabled).toBe(true);
    act(() => tile("눈에 띄는 연출").click());
    expect(pressed(), "세 번째는 고를 수 없다").toEqual(["minimal", "classic"]);
    expectNoPhotos();

    act(() => tile("간결한 분위기").click());
    expect(pressed(), "다시 누르면 지운다").toEqual(["classic"]);
    expect(tile("눈에 띄는 연출").disabled).toBe(false);
    act(() => tile("눈에 띄는 연출").click());
    expect(pressed()).toEqual(["classic", "fancy"]);
    for (const item of tiles()) expectDecorativeScene(item);

    clickText("다음"); clickText("내 선택 보기");
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0][0].mood).toEqual({ status: "answered", values: ["classic", "fancy"] });
  });

  it("현재 상태 버튼을 고르면 그림 칸의 선택이 모두 풀린다", () => {
    openMood();
    act(() => tile("편안한 분위기").click());
    expect(pressed()).toEqual(["natural"]);
    clickText("아직 모르겠어요");
    expect(pressed()).toEqual([]);
  });
});

describe("공간 질문의 그림 칸", () => {
  it("실내·야외·함께를 그림으로 보여주고 한 가지만 고른다", () => {
    const done = vi.fn();
    act(() => root.render(<WeddingTasteForm onComplete={done} />));
    clickText("공간·장소"); clickText("다음"); clickText("다음");
    expect(host.textContent).toContain("어떤 공간에서 식을 올리거나");
    expect(tiles().map(item => item.dataset.tasteTile)).toEqual(VENUES.map(venue => venue.value));
    expect(tiles().map(labelOf)).toEqual(VENUES.map(venue => venue.label));
    for (const item of tiles()) {
      expectDecorativeScene(item);
      // 공유 상수에 설명이 없는 선택지에 설명을 지어내지 않는다.
      expect(item.querySelector("[data-choice-description]")).toBeNull();
      expect(item.hasAttribute("aria-describedby")).toBe(false);
    }
    expectNoPhotos();

    act(() => tile("실내").click());
    expect(pressed()).toEqual(["indoor"]);
    act(() => tile("야외").click());
    expect(pressed(), "한 가지만 남는다").toEqual(["outdoor"]);
    expect(tiles().some(item => item.disabled)).toBe(false);
    expectNoPhotos();

    clickText("다음");
    expect(host.textContent).toContain("피하고 싶은 것이");
    expect(tiles(), "피하고 싶은 것은 글자 버튼 그대로다").toHaveLength(0);
    expect(host.querySelector("svg[data-taste-scene]")).toBeNull();
    clickText("다음");
    expect(host.textContent).toContain("어느 정도 맞춰보고 싶나요?");
    expect(tiles(), "협의 질문은 글자 버튼 그대로다").toHaveLength(0);
    expect(host.querySelector("svg[data-taste-scene]")).toBeNull();
    clickText("내 선택 보기");
    expect(done.mock.calls[0][0].details.venue).toEqual({ status: "answered", values: ["outdoor"] });
  });
});

describe("나머지 세부 질문의 그림 칸", () => {
  const layoutFor = (count: number) => count === 6 ? ["min-[360px]:grid-cols-2", "sm:grid-cols-3"] : count === 4 ? ["min-[360px]:grid-cols-2"] : ["sm:grid-cols-3"];

  it.each(DOMAINS.filter(domain => domain !== "venue"))("%s 질문의 값을 공유 순서·라벨 그대로 그림 칸으로 보여준다", domain => {
    openDetail(domain);
    const { options, max } = TASTE_DOMAIN_QUESTIONS[domain];
    expect(tiles().map(item => item.dataset.tasteTile)).toEqual(options.map(option => option.value));
    expect(tiles().map(labelOf)).toEqual(options.map(option => option.label));
    for (const item of tiles()) {
      expectDecorativeScene(item);
      expect(item.querySelector("[data-choice-description]")).toBeNull();
      expect(item.hasAttribute("aria-describedby")).toBe(false);
      expect(item.className, "키보드 초점이 보인다").toContain("focus-visible:ring-2");
    }
    for (const layout of layoutFor(options.length)) expect(tileGrid()?.className).toContain(layout);
    expect(host.textContent).toContain(max === 1 ? "한 가지를 고르거나" : "최대 " + max + "개");
    expectNoPhotos();
  });

  it("사진은 한 가지만 고르고, 고른 값이 그대로 제출된다", () => {
    const done = openDetail("photo");
    const options = TASTE_DOMAIN_QUESTIONS.photo.options;
    act(() => tile(options[0].label).click());
    act(() => tile(options[2].label).click());
    expect(pressed()).toEqual(["both_styles"]);
    expect(tiles().some(item => item.disabled)).toBe(false);
    clickText("다음"); clickText("다음"); clickText("내 선택 보기");
    expect(done.mock.calls[0][0].details.photo).toEqual({ status: "answered", values: ["both_styles"] });
  });

  it.each(["attire", "ceremony"] as const)("%s 는 둘까지만 고르고 세 번째 칸은 잠긴다", domain => {
    const done = openDetail(domain);
    const [first, second, third, fourth] = TASTE_DOMAIN_QUESTIONS[domain].options;
    act(() => tile(fourth.label).click());
    act(() => tile(first.label).click());
    expect(pressed()).toEqual([first.value, fourth.value]);
    expect(tile(second.label).disabled).toBe(true);
    expect(tile(third.label).disabled).toBe(true);
    act(() => tile(third.label).click());
    expect(pressed()).toEqual([first.value, fourth.value]);
    for (const item of tiles()) expectDecorativeScene(item);
    clickText("다음"); clickText("다음"); clickText("내 선택 보기");
    expect(done.mock.calls[0][0].details[domain]).toEqual({ status: "answered", values: [fourth.value, first.value] });
  });

  it("사람 수 여섯 칸은 한 가지만 고르고, 현재 상태 버튼을 누르면 선택이 풀린다", () => {
    const done = openDetail("guests");
    const options = TASTE_DOMAIN_QUESTIONS.guests.options;
    expect(tiles()).toHaveLength(6);
    expect(tiles()[0].querySelector("svg[data-taste-scene]")?.parentElement?.className).toContain("min-[360px]:aspect-[2/1]");
    act(() => tile(options[0].label).click());
    act(() => tile(options[5].label).click());
    expect(pressed()).toEqual([options[5].value]);
    clickText("아직 모르겠어요");
    expect(pressed()).toEqual([]);
    act(() => tile(options[2].label).click());
    clickText("다음"); clickText("다음"); clickText("내 선택 보기");
    expect(done.mock.calls[0][0].details.guests).toEqual({ status: "answered", values: [options[2].value] });
  });
});
