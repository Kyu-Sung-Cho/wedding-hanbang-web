// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { START_COPY } from "@hanbang/shared/invitation";
import { landingContent } from "@/components/landing/redesign/landingContent";

import LandingPage, { generateMetadata } from "../page";

vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));

/**
 * 랜딩은 웨딩홀 비교와 상담 문의 보내기를 "곧 열려요" 없이 말하지 않는다.
 *
 * ## 왜 생겼나
 *
 * 2026-11-18 리드 결정: 공개 화면은 오늘 사용자가 할 수 있는 것만 약속한다(CLAUDE.md "사용자에게 보이는
 * 표면에는 오늘 사용자가 직접 재현할 수 있는 것만 쓴다"). 웨딩홀 비교와 상담 문의 보내기는 화면과 흐름은
 * 있지만 운영에 아직 열리지 않았다(홀 자료 0곳, 보내기 스위치 `HALL_INQUIRY_SENDING_ENABLED` 꺼짐).
 * 파운더 디자인 아티팩트의 첫 화면 본문은 "웨딩홀을 찾아 비교하고, 두 분이 고른 곳에 상담 문의까지 해
 * 둘게요" 였다 — 그대로 두면 랜딩의 첫 문장이 없는 기능을 판다. 그래서 그 둘은 "곧 열려요" 꼬리표가
 * 보이는 카드 안에서만 말한다(파운더 요청 원문: "랜딩도 만들어야지 비슷하게", "전체다").
 *
 * ## 무엇을 보나 — 셋 다
 *
 * 1. 첫 화면 정본(`START_COPY`, 앱 시작 화면과 같이 쓴다)과 검색·공유 문구는 그 둘을 아예 말하지 않는다.
 *    꼬리표를 달 자리가 없는 표면이다.
 * 2. 카피 정본(`landingContent`)에서 그 둘을 말하는 문자열은 정해진 자리에만 산다: 곧 열리는 카드
 *    (`today.soonFeatures`), 곧 열리는 단계(`steps.soonItem`), 넓은 화면 그림 설명(`wide.caption`).
 * 3. 렌더된 페이지에서 그 둘을 말하는 글과 그림 대체 글은 `data-landing-soon` 카드 안에만 있고, 그 카드에는
 *    "곧 열려요"가 감추지 않은 채 보인다.
 *
 * 탐지 정규식은 대조군으로 먼저 증명한다 — 옛 아티팩트 문장과 예시 화면 문장은 잡고, 오늘 문장은 놓아준다.
 * 정규식이 고장 나면 아래 세 검사는 모두 빈 통과가 된다.
 *
 * ## 2026-11-18 파운더 결정 D-83 — 꼬리표가 있어도 "대신 보낸다"는 말하지 않는다
 *
 * 문의가 열리면 첫 단계는 아모라가 문의 글을 두 분과 함께 쓰고, 두 분이 자기 휴대폰으로 보낸다(복사, 문자·
 * 카카오톡 열기, 전화). 홀 투어는 업체의 네이버 예약으로 넘긴다. 서비스 이름으로 보내는 일은 나중에, 합의한
 * 업체에만 한다. 그래서 랜딩 어디서도(곧 열리는 카드 안이라도) 아모라나 서비스가 업체에 보낸다고 말하지 않는다
 * ("대신 보내", "보내 드려요", "문의까지 해 둘게요", "편지를 보내요"). 이 규칙에는 꼬리표 예외가 없다.
 */

/** 웨딩홀 비교·찾기, 상담 문의, 문의 글·편지를 말하는 글. */
const CLAIM =
  /웨딩홀[^.?!\n]{0,20}(?:비교|찾)|(?:비교|찾)[^.?!\n]{0,20}웨딩홀|(?<![가-힣])홀[을를]?\s*(?:찾|비교)|상담\s*문의|(?:웨딩홀|업체|고른 곳|담은)[^.?!\n]{0,12}문의|문의\s*(?:편지|글)|(?:보내|보낸|보낼|보냈)[^.?!\n]{0,8}편지|편지[^.?!\n]{0,16}(?:보내|보낸|보낼|보냅|보냈)/u;

/** 업체에 대신 보내거나 문의해 준다는 글(D-83). 곧 열려요 카드 안에서도 안 된다. */
const SEND_ON_BEHALF =
  /대신\s*(?:보내|보낸|보낼|보냈|문의|연락)|(?:보내|문의해|연락해|전해)\s*드(?:려|릴|립)|문의까지\s*해\s*둘|(?:문의|편지|업체|웨딩홀|고른 곳|담은)[^.?!\n]{0,16}(?:보내|보낸|보낼|보냅|보냈)/u;

/** 그 둘을 말해도 되는 카피 자리. 자리를 늘리려면 이 목록부터 고치고, 그 자리에 꼬리표가 붙는지 본다. */
const SOON_COPY_PATHS = [/^today\.soonFeatures\[\d+\]\./u, /^steps\.soonItem\./u, /^wide\.caption$/u];

/** 감추는 조상. 꼬리표가 이 안에 있으면 보이지 않는다. */
const HIDING = '[hidden],[aria-hidden="true"],.hidden,.sr-only,.invisible,.opacity-0';

/** 꼬리표를 달아도 되는 그릇: 카드 한 장·단계 한 줄·그림 한 묶음. 섹션 통째로 덮는 그릇은 안 된다. */
const HOLDER_TAGS = new Set(["LI", "FIGURE", "ARTICLE"]);

const flat = (text: string | null | undefined) => (text ?? "").replace(/\s+/gu, " ").trim();

function landingDocument(): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(createElement(LandingPage)), "text/html");
}

/** 카피 나무의 문자열 잎을 `[경로, 값]` 으로 모은다. */
function copyLeaves(node: unknown, path = ""): Array<[string, string]> {
  if (typeof node === "string") return [[path, node]];
  if (Array.isArray(node)) return node.flatMap((child, index) => copyLeaves(child, `${path}[${index}]`));
  if (node && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>)
      .flatMap(([key, value]) => copyLeaves(value, path ? `${path}.${key}` : key));
  }
  return [];
}

/** 글이 그 둘을 말하는 가장 깊은 요소들. 글이 여러 요소로 쪼개져 있으면 그 부모가 잡힌다. */
function deepestClaims(doc: Document): Element[] {
  return [...doc.body.querySelectorAll("*")].filter((element) => {
    if (element.matches("script, style")) return false;
    if (!CLAIM.test(flat(element.textContent))) return false;
    return ![...element.children].some((child) => CLAIM.test(flat(child.textContent)));
  });
}

/** 그 요소를 덮는 꼬리표 그릇이 규칙을 지키는지. 어긋난 이유를 돌려준다(지키면 null). */
function holderProblem(element: Element, label: string): string | null {
  const holder = element.closest("[data-landing-soon]");
  if (!holder) return "곧 열려요 그릇 밖에 있다";
  if (!HOLDER_TAGS.has(holder.tagName)) return `그릇이 카드 한 장이 아니다(${holder.tagName.toLowerCase()})`;
  if (holder.querySelector("[data-landing-soon]")) return "그릇 안에 또 그릇이 있다";
  if (holder.closest(HIDING)) return "그릇이 감춰져 있다";
  const labels = [...holder.querySelectorAll("*")].filter((node) =>
    flat(node.textContent).includes(label) && ![...node.children].some((child) => flat(child.textContent).includes(label)));
  if (labels.length === 0) return `그릇에 "${label}" 이 없다`;
  if (labels.every((node) => node.closest(HIDING))) return `"${label}" 이 감춰져 있다`;
  return null;
}

describe("곧 열리는 기능을 알아보는 정규식", () => {
  it("옛 아티팩트 문장과 예시 화면 문장을 잡는다", () => {
    for (const claim of [
      "원하는 시기와 지역만 알려주세요. 웨딩홀을 찾아 비교하고, 두 분이 고른 곳에 상담 문의까지 해 둘게요.",
      "좋아요, 홀 찾아 주세요",
      "담은 2곳에 상담 문의하기",
      "조건에 맞는 웨딩홀 3곳을 200명 기준으로 비교해 뒀어요.",
      "승인한 편지를 2곳에 보냈어요",
      "이 편지를 2곳에 보낼까요?",
      "고른 곳에 문의해 둘게요",
      "보내기 전 편지 확인",
      "고른 곳에 물어볼 문의 글은 아모라와 함께 준비해요.",
    ]) {
      expect(claim, `탐지기가 못 잡는다: ${claim}`).toMatch(CLAIM);
    }
  });

  it("대신 보낸다는 문장을 잡고, 함께 준비한다는 문장은 놓아준다(D-83)", () => {
    for (const sending of [
      "원하는 시기와 지역만 알려주세요. 웨딩홀을 찾아 비교하고, 두 분이 고른 곳에 상담 문의까지 해 둘게요.",
      "고른 웨딩홀에 보낼 상담 문의 편지를 먼저 보여 드려요. 승인한 편지만 보내요.",
      "후보를 나란히 보고, 고른 곳에 상담 문의 편지를 보내요.",
      "이 편지를 2곳에 보낼까요?",
      "아침에 비교한 홀 중 두 분이 담은 2곳에 상담 문의를 보냈어요.",
      "업체에 문의해 드릴게요",
      "고른 곳에 문의 글을 대신 보내 드려요.",
    ]) {
      expect(sending, `탐지기가 대신 보내는 문장을 못 잡는다: ${sending}`).toMatch(SEND_ON_BEHALF);
    }
    for (const allowed of [
      "고른 곳에 물어볼 문의 글은 아모라와 함께 준비해요.",
      "후보를 나란히 보고, 고른 곳에 물어볼 문의 글을 아모라와 함께 써요.",
      START_COPY.headingLines[0],
      "가격은 업체가 공개한 것만, 확인한 날짜와 함께 보여 드려요.",
      "예약·결제·계약은 업체와 직접 진행해 주세요.",
    ]) {
      expect(allowed, `탐지기가 허용되는 문장을 잡는다: ${allowed}`).not.toMatch(SEND_ON_BEHALF);
    }
  });

  it("오늘 되는 일을 말하는 문장은 놓아준다", () => {
    for (const today of [
      START_COPY.body,
      landingContent.today.body,
      landingContent.notices.signup,
      "예산·할 일·일정을 바꾸기 전에 아모라가 바꿀 내용을 먼저 보여 드려요.",
      "업체 계약 신청·예약·결제를 중개하지 않아요.",
      "견적 질문 만들기",
      "정책·문의",
    ]) {
      expect(today, `탐지기가 오늘 문장을 잡는다: ${today}`).not.toMatch(CLAIM);
    }
  });
});

describe("랜딩은 곧 열리는 기능을 꼬리표 없이 말하지 않는다", () => {
  it("첫 화면 정본과 검색·공유 문구는 그 둘을 말하지 않는다", () => {
    // 첫 화면(웹 랜딩과 앱 시작 화면)에는 꼬리표를 달 자리가 없다.
    for (const value of Object.values(START_COPY).flat()) {
      expect(value, `첫 화면 정본이 곧 열리는 기능을 말한다: ${value}`).not.toMatch(CLAIM);
    }
    const metadata = generateMetadata();
    for (const value of [metadata.title, metadata.description]) {
      expect(String(value ?? ""), "검색 결과 문구가 곧 열리는 기능을 말한다").not.toMatch(CLAIM);
    }
    expect(String(metadata.description ?? "").length, "검색 설명을 못 읽었다").toBeGreaterThan(40);
  });

  it("카피 정본은 그 둘을 정해진 자리에서만 말한다", () => {
    expect(landingContent.soon.label, "꼬리표 문구가 바뀌었다(리드 결정 2026-11-18)").toBe("곧 열려요");
    const leaves = copyLeaves(landingContent);
    expect(leaves.length, "카피를 못 읽었다").toBeGreaterThan(40);
    const claims = leaves.filter(([, value]) => CLAIM.test(value));
    // 대조군: 곧 열리는 카드가 실제로 그 둘을 말한다. 0건이면 아래 검사는 빈 통과다.
    expect(claims.length, "곧 열리는 자리의 문장을 하나도 못 찾았다").toBeGreaterThanOrEqual(4);
    const misplaced = claims
      .filter(([path]) => !SOON_COPY_PATHS.some((allowed) => allowed.test(path)))
      .map(([path, value]) => `${path}: ${value}`);
    expect(misplaced, "곧 열리는 기능을 말하는 카피가 꼬리표 없는 자리에 있다").toEqual([]);
  });

  it("렌더된 페이지의 글과 대체 글이 '곧 열려요' 카드 안에서만 그 둘을 말한다", () => {
    const doc = landingDocument();
    const label = landingContent.soon.label;

    const texts = deepestClaims(doc);
    // 대조군: 곧 열리는 카드 둘, 단계 하나, 그림 설명 하나가 잡혀야 한다.
    expect(texts.length, "그 둘을 말하는 글을 렌더 결과에서 못 찾았다 — 검사가 아무것도 안 본다").toBeGreaterThanOrEqual(4);
    const textProblems = texts
      .map((element) => [element, holderProblem(element, label)] as const)
      .filter(([, problem]) => problem !== null)
      .map(([element, problem]) => `${problem}: ${flat(element.textContent).slice(0, 60)}`);
    expect(textProblems, "꼬리표 없이 곧 열리는 기능을 말하는 글").toEqual([]);

    const images = [...doc.querySelectorAll("img")].filter((img) => CLAIM.test(img.getAttribute("alt") ?? ""));
    expect(images.length, "그 둘을 보여 주는 예시 화면을 못 찾았다").toBeGreaterThanOrEqual(1);
    const imageProblems = images
      .map((img) => [img, holderProblem(img, label)] as const)
      .filter(([, problem]) => problem !== null)
      .map(([img, problem]) => `${problem}: ${img.getAttribute("alt")}`);
    expect(imageProblems, "꼬리표 없이 곧 열리는 기능을 보여 주는 그림").toEqual([]);
  });

  it("아모라나 서비스가 업체에 대신 보낸다고 어디서도 말하지 않는다 — 곧 열려요 카드 안이라도(D-83)", () => {
    // 첫 화면 정본(앱 시작 화면과 같이 쓴다)과 검색 문구.
    const metadata = generateMetadata();
    for (const value of [...Object.values(START_COPY).flat(), String(metadata.title ?? ""), String(metadata.description ?? "")]) {
      expect(value, `대신 보낸다고 말한다: ${value}`).not.toMatch(SEND_ON_BEHALF);
    }
    // 카피 정본 전부(꼬리표 자리 포함).
    const sendingCopy = copyLeaves(landingContent)
      .filter(([, value]) => SEND_ON_BEHALF.test(value))
      .map(([path, value]) => `${path}: ${value}`);
    expect(sendingCopy, "카피가 대신 보낸다고 말한다").toEqual([]);
    // 렌더된 페이지 전체의 글과 그림 대체 글.
    const doc = landingDocument();
    const text = flat(doc.body.textContent);
    // 2026-11-18 실측 1,793자(공백을 접은 글자 수). 바닥글 고지까지 다 그려졌는지 보는 하한이다.
    expect(text.length, "렌더된 글을 못 읽었다").toBeGreaterThan(1200);
    expect(text, "바닥글까지 그려지지 않았다").toContain(landingContent.footer.copyright);
    expect(text.match(SEND_ON_BEHALF)?.[0], "렌더된 페이지가 대신 보낸다고 말한다").toBeUndefined();
    const alts = [...doc.querySelectorAll("img")].map((img) => img.getAttribute("alt") ?? "").filter((alt) => SEND_ON_BEHALF.test(alt));
    expect(alts, "그림 대체 글이 대신 보낸다고 말한다").toEqual([]);
  });

  it("곧 열리는 카드는 오늘 되는 카드와 따로 있고, 시작 화면에는 없다", () => {
    const doc = landingDocument();
    const holders = [...doc.querySelectorAll("[data-landing-soon]")];
    // 곧 열리는 화면 하나(웨딩홀 비교와 문의 글 준비) + 단계 하나 + 넓은 화면 그림 하나.
    expect(holders.length, "곧 열리는 그릇 수가 달라졌다").toBe(3);
    const startFrame = doc.querySelector('section[aria-labelledby="start-title"]')?.parentElement;
    expect(startFrame, "시작 화면 상자를 못 찾았다").toBeTruthy();
    expect(startFrame!.querySelector("[data-landing-soon]"), "시작 화면에 곧 열리는 기능이 들어갔다").toBeNull();
    expect(CLAIM.test(flat(startFrame!.textContent)), "시작 화면이 곧 열리는 기능을 말한다").toBe(false);
  });
});
