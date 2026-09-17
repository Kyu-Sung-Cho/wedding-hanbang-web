// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WeddingTasteForm from "./WeddingTasteForm";

/**
 * **분위기 질문은 그림으로 고른다 — 사진 없이.**
 *
 * 2026-09-17 팀원 피드백: "이미지로도 나타낼 수 있는 항목이 있으면 좋겠음 (ex. 원하는
 * 예식장 분위기)". 권리가 확인된 결혼 사진이 없어서, 공유 분위기 값(`WEDDING_STYLE_OPTIONS`)
 * 마다 **선으로 그린 장면**을 붙였다. 이 테스트가 지키는 것:
 *
 * - 네 칸이 공유 상수의 순서·라벨 그대로 나오고, 칸마다 숨겨진(aria-hidden) 그림이 있다.
 * - 그림에는 글자 노드가 없다 — 이름은 버튼 라벨이, 설명은 aria-describedby 가 맡는다.
 * - 화면에 쓰이지 않던 설명 줄이 칸 안에 보인다.
 * - 누르면 aria-pressed 가 바뀌고, 둘까지만 고를 수 있다.
 * - **`<img>` 도, 원격 주소도, 박아 넣은 색값도 없다.** 사진을 쓰지 않는다는 결정을
 *   화면에서 확인한다(누군가 "예시 사진 하나만" 넣는 순간 빨개진다).
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

/** 칸 하나의 그림이 제대로 숨겨진, 글자 없는 토큰 색 그림인지 본다. */
function expectDecorativeScene(item: HTMLButtonElement) {
  const scenes = item.querySelectorAll("svg[data-taste-scene]");
  expect(scenes, labelOf(item)).toHaveLength(1);
  const scene = scenes[0];
  expect(scene.getAttribute("aria-hidden")).toBe("true");
  expect(scene.getAttribute("focusable")).toBe("false");
  expect(scene.querySelectorAll("title, desc, text, textPath, foreignObject")).toHaveLength(0);
  expect(scene.textContent).toBe("");
  // 빈 틀만 남은 그림을 그림으로 치지 않는다 — 바탕 한 장 외에 그린 것이 있어야 한다.
  expect(scene.querySelectorAll("path, circle, ellipse, rect").length).toBeGreaterThan(4);
  expect(scene.outerHTML, "색은 토큰 유틸리티로만 칠한다").not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
}

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("분위기 질문의 그림 칸", () => {
  function openMood() {
    const done = vi.fn();
    act(() => root.render(<WeddingTasteForm onComplete={done} />));
    expect(tiles(), "첫 질문(주제)은 글자 버튼 그대로다").toHaveLength(0);
    expect(host.querySelector("svg[data-taste-scene]")).toBeNull();
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

    clickText("다음"); clickText("다음");
    expect(host.textContent).toContain("어느 정도 맞춰보고 싶나요?");
    expect(tiles(), "협의 질문은 글자 버튼 그대로다").toHaveLength(0);
    clickText("내 선택 보기");
    expect(done.mock.calls[0][0].details.venue).toEqual({ status: "answered", values: ["outdoor"] });
  });

  it("다른 세부 질문(사진)은 그림 없이 글자 버튼으로 남는다", () => {
    act(() => root.render(<WeddingTasteForm onComplete={vi.fn()} />));
    clickText("사진"); clickText("다음"); clickText("다음");
    expect(host.textContent).toContain("사진에는 어떤 모습을");
    expect(tiles()).toHaveLength(0);
    expect(host.querySelector("svg[data-taste-scene]")).toBeNull();
    expect([...host.querySelectorAll("button")].some(item => item.textContent === "자연스러운 순간")).toBe(true);
  });
});
