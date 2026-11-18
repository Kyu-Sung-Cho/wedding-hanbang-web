// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { landingContent } from "@/components/landing/redesign/landingContent";

import LandingPage from "../page";
import {
  CONTENT_PATH,
  contentBlock,
  everyLandingComponent,
  rendered,
} from "./landingSource";

vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));

/**
 * 고지 문장이 **카피 파일에만** 있고 화면에는 없는 상태를 막는다.
 *
 * ## 왜 생겼나
 *
 * 랜딩 가드 대부분이 "이 문장이 `landingContent.ts` 에 있나" 로 묻는다. 그러면
 * 그 문장을 그리는 `<p>` 를 지워도 통과한다 — 카피 파일이 대신 대답하기 때문이다.
 * 2026-08-27 적대적 검증에서 이 갈래로 17개가 빠져나갔다(그리는 `<p>` 삭제,
 * `{false && …}` 로 감싸기, `hidden` 클래스, 아무도 안 그리는 장식 파일에 참조만 남기기).
 * 그래서 세 가지를 함께 본다:
 *
 *   (1) 카피의 **그 블록**에 글자 그대로 있고
 *   (2) `page.tsx` 가 실제로 그리는 컴포넌트가 그 값을 JSX 로 내보내고
 *   (3) 그 자리가 꺼져 있지 않은가 — `hidden`·`{false &&`·JSX 주석
 *
 * ## 2026-11-17 — 랜딩이 시작 화면 한 장이 됐다
 *
 * 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)로 랜딩의 첫 화면은 앱의
 * '시작' 화면이 됐다. 섹션 아홉이 없어졌고, **법·신뢰 때문에 화면에 있어야 하는 문장은
 * 글자 하나 바꾸지 않고 첫 화면 아래 조용한 바닥글로 옮겼다**(시작 카드 안이 아니다).
 * 어디서 어디로 갔는지:
 *
 *   AI 답변 고지·업체 편 아님·중개 안 함·전문 판단 안 함   BoundariesSection → boundaries.items
 *   요금(현재 무료·향후 미정)                              confirm.note        → notices.pricing
 *   가입 조건                                              closing.note        → notices.signup
 *   개인정보(나만 보는 상담도 처리·저장)                    amoraNote.privacyNote → notices.privacy
 *   가격 출처·기준일·지역 편차                              footer.notice       → footer.notice
 *   AI 정책·개인정보처리방침·이용약관 링크                   footer.columns · boundaries.policyLink
 *
 * **옮기지 않은 것과 이유** — 고지의 대상이 화면에서 없어졌다:
 *
 *   amoraNote.note · noSide.note  "기능을 설명하는 예시 대화예요 …" 예시 대화 카드의 표식이다.
 *                                 예시 대화가 없어졌고, 예시 화면(`/example`)은 맨 위에
 *                                 예시라는 표시를 스스로 단다(`EXAMPLE_COPY.banner`).
 *   availableNow.cards[].note     도구 카드 넷의 설명 고지다. 카드가 없어졌고 바닥글은 도구
 *                                 이름만 링크한다. 각 도구 화면이 자기 고지를 든다.
 *   hero.note                     "아모라는 로그인 후 이용해요 …". 같은 뜻을 notices.signup 이
 *                                 진다("아모라와 … 관리에는 가입이 필요해요").
 *
 * ## 이 파일이 지키지 않는 것
 *
 * 실제 픽셀 가시성(대비·겹침·화면 밖)은 소스로 알 수 없다. 그건 화면을 띄워 잰다.
 */

/** 바닥글이 그리는 컴포넌트. 고지는 전부 여기 산다. */
const OWNER = "LandingFooter.tsx";

/**
 * 화면에서 사라지면 안 되는 고지 — 키 하나에 문장 하나. **글자 그대로** 고정한다.
 * 문장을 고치려면 이 표를 먼저 고쳐야 하고, 그때 리뷰어가 법·신뢰 고지가 바뀐다는 것을 본다.
 */
const DISCLOSURES: ReadonlyArray<{ key: string; text: string; why: string }> = [
  {
    key: "notices.pricing",
    text: "결제 수단 등록 없이 핵심 기능을 바로 써볼 수 있어요. 현재 무료로 이용할 수 있어요. 향후 요금은 아직 정해지지 않았어요.",
    why: "지금은 결제를 요청하지 않고 앞으로의 요금은 정해지지 않았다는 고지(CLAUDE.md 2026-08-29: 베타 틀은 걷어도 이 사실은 남긴다)",
  },
  {
    key: "notices.signup",
    text: "무료 도구는 가입 없이 이용할 수 있어요. 아모라와 예산·할 일·일정 관리에는 가입이 필요해요.",
    why: "무엇이 로그인 없이 열리는지. 시작하기는 로그인이 필요한 경로로 간다",
  },
  {
    key: "notices.privacy",
    text: "나만 보는 상담은 파트너에게 공유되지 않으며, 이어서 볼 수 있도록 개인 상담도 서비스에서 처리·저장돼요.",
    why: "개인정보 고지 — 나만 보는 상담도 서비스가 처리·저장한다",
  },
  {
    key: "footer.notice",
    text:
      "가격 출처: 한국소비자원 참가격, 2025년 11월 공시 기준. "
      + "공시 가격은 기본 조건 기준이라 실제 계약가와 다를 수 있어요. 가격을 공시한 업체만 제공하므로 지역별 등록 업체 수가 달라요. "
      + "업체가 공개한 취소·환불 규정은 원문으로 제공해요. 예약·결제·계약은 업체와 직접 진행해 주세요.",
    why: "가격 출처·기준일·지역 편차·예약은 업체와 직접. 지역 편차 문장을 빼면 사용자가 '우리 지역엔 없네' 를 우리 잘못으로 읽는다",
  },
];

/**
 * 배열 안에 사는 고지 — 하지 않는 것 넷. 카드 한 장을 통째로 지워도 `{item.note}` 는 남아
 * 경로 검사로는 안 잡히므로, 배열 전체를 글자 그대로 고정하고 그 배열을 통째로 그리는지 본다.
 */
const BOUNDARY_ITEMS: ReadonlyArray<{ title: string; note: string }> = [
  {
    title: "업체에 점수·등급·순위를 매기지 않아요",
    note: "공시 가격과 규정은 요약하지 않고 원문으로 제공해요. 광고 상품은 운영하지 않아요.",
  },
  {
    title: "계약 조건을 대신 해석하거나 판단하지 않아요",
    note: "업체 계약 신청·예약·결제를 중개하지 않아요.",
  },
  {
    // AI 기본법 고지. `/ai-policy` 가 같은 것을 공개하고 있어 어긋나면 안 된다.
    title: "아모라의 답변은 AI가 작성해요",
    note: "AI 답변에는 오류가 있을 수 있어요. 계약 금액·취소 조건·중요 날짜는 원문과 업체 안내를 다시 확인해 주세요.",
  },
  {
    title: "법률·의료·금융 판단을 하지 않아요",
    note: "전문적인 판단이 필요한 질문에는 관련 기관을 안내해요.",
  },
];

/** 바닥글에서 늘 닿아야 하는 정책 문서. */
const POLICY_LINKS: ReadonlyArray<readonly [string, string]> = [
  ["이용약관", "/terms"],
  ["개인정보처리방침", "/privacy"],
  ["AI 서비스 정책", "/ai-policy"],
];

/** `landingContent` 안의 블록 순서. `contentBlock` 이 블록을 잘라낼 경계로 쓴다. */
const NEXT_BLOCK: Readonly<Record<string, string | undefined>> = {
  start: "account",
  // 2026-11-18 첫 화면 아래 섹션 카피가 account 와 boundaries 사이에 들어왔다(블록 순서 = 화면 순서).
  account: "soon",
  soon: "today",
  today: "steps",
  steps: "promises",
  promises: "wide",
  wide: "closing",
  closing: "boundaries",
  boundaries: "notices",
  notices: "footer",
  // 마지막 블록. 경계를 주지 않으면 파일 끝까지 본다.
  footer: undefined,
};

function copyOf(block: string): string {
  if (!(block in NEXT_BLOCK)) {
    throw new Error(
      `"${block}" 은 NEXT_BLOCK 에 없습니다. 랜딩 블록이 늘거나 이름이 바뀌었다면 `
        + "이 표부터 고치세요 — 경계가 틀리면 검사가 조용히 넓어집니다.",
    );
  }
  return contentBlock(block, NEXT_BLOCK[block]);
}

function leaf(key: string): string {
  return key.slice(key.lastIndexOf(".") + 1);
}

function block(key: string): string {
  return key.slice(0, key.lastIndexOf("."));
}

/** 키 경로로 실제 값을 읽는다(`notices.pricing` → 문자열). */
function valueAt(key: string): unknown {
  return key.split(".").reduce<unknown>(
    (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
    landingContent,
  );
}

/** 그 컴포넌트가 이 값을 JSX 표현식으로 내보내는가. `{notices.pricing}` · `{pricing}` 을 받는다. */
function rendersValue(text: string, key: string): boolean {
  const tail = leaf(key);
  const owner = block(key).replace(/\./gu, "\\.");
  return [
    new RegExp(`\\{\\s*${owner}\\.${tail}\\s*\\}`, "u"),
    new RegExp(`\\{\\s*[A-Za-z_$][\\w$]*\\.${tail}\\s*\\}`, "u"),
    new RegExp(`\\{\\s*${tail}\\s*\\}`, "u"),
  ].some((pattern) => pattern.test(text));
}

/** 그 값을 내보내는 줄이 꺼져 있는가. */
function switchedOff(text: string, tail: string): string | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!new RegExp(`\\{[^}]*\\b${tail}\\s*\\}`, "u").test(lines[i])) continue;
    // 그 줄과 바로 앞 두 줄을 본다 — 여는 태그가 여러 줄로 쪼개져 있을 수 있다.
    const window = lines.slice(Math.max(0, i - 2), i + 1).join(" ");
    if (/\{\s*false\s*&&/u.test(window)) return "{false && …} 로 꺼져 있다";
    if (/className=\{?["'`][^"'`]*\b(?:hidden|sr-only|invisible)\b/u.test(window)) return "감추는 클래스가 붙어 있다";
  }
  return null;
}

const components = new Map(everyLandingComponent());

function landingDocument(): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(createElement(LandingPage)), "text/html");
}

/** 공백을 하나로 접은 글자. 줄바꿈·들여쓰기가 비교를 흔들지 않게 한다. */
const flat = (text: string | null | undefined) => (text ?? "").replace(/\s+/gu, " ").trim();

describe("고지 문장은 화면에 있다", () => {
  it("모든 고지가 카피의 그 블록에 글자 그대로 있다", () => {
    const missing: string[] = [];
    for (const { key, text, why } of DISCLOSURES) {
      if (valueAt(key) !== text) missing.push(`${key} 가 글자 그대로가 아니다 — ${why}`);
      // 값이 맞아도 다른 블록으로 옮겨 붙였으면 자리가 틀렸다.
      if (!copyOf(block(key)).includes(`${leaf(key)}:`)) missing.push(`${key} 키가 ${block(key)} 블록에 없다`);
    }
    expect(missing, "카피에서 바뀌거나 사라진 고지").toEqual([]);
  });

  it("하지 않는 것 넷이 글자 그대로, 순서 그대로 있다", () => {
    expect(landingContent.boundaries.items).toEqual(BOUNDARY_ITEMS);
    expect(landingContent.boundaries.policyLink).toEqual({
      label: "AI 서비스 정책과 정보 출처 보기",
      href: "/ai-policy",
    });
  });

  it("고지를 그리는 컴포넌트가 page.tsx 에 실제로 그려진다", () => {
    // 카피에 있고 컴포넌트도 그리는데, 그 컴포넌트를 페이지가 안 그리면 화면엔 없다.
    const page = rendered("src/app/landing/page.tsx");
    expect(page, `${OWNER} 를 페이지가 그리지 않는다`).toMatch(/<LandingFooter\s*\/>/u);
  });

  it("그 컴포넌트가 고지 값을 JSX 로 내보내고, 그 자리가 꺼져 있지 않다", () => {
    const footer = components.get(OWNER) ?? "";
    expect(footer.length, `${OWNER} 를 못 읽었다`).toBeGreaterThan(0);
    const problems: string[] = [];
    for (const { key, why } of DISCLOSURES) {
      if (!rendersValue(footer, key)) problems.push(`${OWNER} 가 ${key} 를 그리지 않는다 — ${why}`);
      const off = switchedOff(footer, leaf(key));
      if (off) problems.push(`${OWNER}: ${key} 가 ${off} — ${why}`);
    }
    expect(problems, "카피에만 있고 화면에 없는 고지").toEqual([]);
  });

  it("하지 않는 것 넷을 카피 배열에서 통째로 그린다", () => {
    // `.map` 을 `[].map` 으로 바꾸거나 `.slice(0, 1)` 로 자르면 뒤쪽 항목의 고지가 조용히 사라진다.
    const footer = components.get(OWNER) ?? "";
    expect(footer).toMatch(/boundaries\.items\.map\(/u);
    expect(footer).toMatch(/\{\s*item\.title\s*\}/u);
    expect(footer).toMatch(/\{\s*item\.note\s*\}/u);
    expect(footer, "빈 배열에서 그린다").not.toMatch(/\[\s*\]\s*\.map\(/u);
    expect(footer, "항목을 잘라서 그린다").not.toMatch(/boundaries\.items\s*\.slice\(/u);
    for (const field of ["title", "note"]) {
      expect(switchedOff(footer, field), `item.${field} 가 꺼져 있다`).toBeNull();
    }
  });

  it("고지의 주인이 바닥글 하나뿐이다", () => {
    // 다른 파일에 참조만 남겨 두고 진짜 렌더를 지우는 우회가 있었다.
    const strays: string[] = [];
    for (const [file, text] of components) {
      if (file === OWNER) continue;
      for (const { key } of DISCLOSURES) {
        if (new RegExp(`\\{\\s*${key.replace(/\./gu, "\\.")}\\s*\\}`, "u").test(text)) {
          strays.push(`${file} 도 ${key} 를 그린다`);
        }
      }
      if (/boundaries\.items\.map\(/u.test(text)) strays.push(`${file} 도 boundaries.items 를 그린다`);
    }
    expect(strays, "고지를 두 곳에서 그린다").toEqual([]);
  });

  it("렌더된 페이지의 바닥글에 고지가 글자 그대로 보인다 — 시작 카드 안이 아니다", () => {
    // 소스 대조는 렌더 경로의 실수를 못 본다(예: 다른 값을 그리는 것). 서버 렌더 결과로 확인한다.
    const doc = landingDocument();
    const footer = doc.querySelector("footer");
    expect(footer, "랜딩에 바닥글이 없다").toBeTruthy();
    const footerText = flat(footer?.textContent);
    for (const { key, text } of DISCLOSURES) {
      expect(footerText, `${key} 가 바닥글에 글자 그대로 보이지 않는다`).toContain(flat(text));
    }
    for (const item of BOUNDARY_ITEMS) {
      expect(footerText).toContain(item.title);
      expect(footerText).toContain(item.note);
    }

    // 감추는 조상이 없어야 한다.
    const hiding = '[hidden],[aria-hidden="true"],.hidden,.sr-only,.invisible';
    expect(footer?.closest(hiding), "바닥글이 감춰져 있다").toBeNull();
    for (const node of footer?.querySelectorAll("li, p") ?? []) {
      expect(node.closest(hiding), flat(node.textContent).slice(0, 40)).toBeNull();
    }

    // 시작 카드는 아티팩트 그대로 두고 고지를 얹지 않는다.
    const card = doc.querySelector('section[aria-labelledby="start-title"]');
    expect(card, "시작 카드를 찾지 못했다").toBeTruthy();
    for (const { key, text } of DISCLOSURES) {
      expect(flat(card?.textContent), `${key} 가 시작 카드 안에 들어갔다`).not.toContain(flat(text).slice(0, 20));
    }
    // 바닥글은 첫 화면(main) 뒤에 온다.
    const main = doc.querySelector("main");
    expect(main, "main 이 없다").toBeTruthy();
    expect((main!.compareDocumentPosition(footer!) & 4) === 4, "바닥글이 첫 화면 앞에 있다").toBe(true);
  });

  it("정책 문서 셋이 바닥글에서 실제 주소로 닿는다", () => {
    const footer = landingDocument().querySelector("footer");
    for (const [label, href] of POLICY_LINKS) {
      const link = footer?.querySelector(`a[href="${href}"]`);
      expect(link, `바닥글에 ${href} 링크가 없다`).toBeTruthy();
      expect([...(footer?.querySelectorAll(`a[href="${href}"]`) ?? [])].some((a) => flat(a.textContent) === label),
        `${href} 링크의 이름 "${label}" 이 바뀌었다`).toBe(true);
    }
    // 정책 셋은 한 묶음 안에 있다 — 따로 흩어지면 찾는 사람이 못 찾는다.
    const policyColumn = landingContent.footer.columns.find((column) =>
      column.links.some((link) => link.href === "/terms"));
    expect(policyColumn?.links.map((link) => link.href)).toEqual(
      expect.arrayContaining(POLICY_LINKS.map(([, href]) => href)),
    );
    // 푸터가 목적지를 손으로 적으면 위 단언이 통과하면서 링크는 아무 데도 가지 않는다.
    const footerSource = components.get(OWNER) ?? "";
    expect(footerSource).toContain("href={item.href}");
    expect(footerSource, "바닥글이 목적지를 손으로 적었다").not.toMatch(/href="/u);
  });

  it("화면에 '베타' 라는 틀이 없다", () => {
    // 2026-08-29 파운더 결정: 베타를 하지 않는다(CLAUDE.md). 주석은 `rendered` 가 벗긴다.
    const banned = /베타|사전\s*등록|승인\s*대기/u;
    const hits: string[] = [];
    if (banned.test(rendered(CONTENT_PATH))) hits.push("landingContent.ts");
    for (const [file, text] of components) {
      if (banned.test(text)) hits.push(file);
    }
    if (banned.test(landingDocument().body.textContent ?? "")) hits.push("렌더된 페이지");
    expect(hits, "베타 틀이 화면에 남아 있다").toEqual([]);
  });
});
