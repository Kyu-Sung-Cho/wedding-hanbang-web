import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import {
  WEDDING_CODE_V06_AXES,
  WEDDING_CODE_V06_QUESTIONS,
  WEDDING_CODE_V06_VERSION,
} from "@/constants/weddingCodeV06";
import { buildWeddingCodeSelfProfile } from "@/lib/weddingCode/scene/selfProfile";
import {
  WEDDING_CODE_V08_QUESTIONS,
  WEDDING_CODE_V08_VERSION,
} from "@/constants/weddingCodeV08";
import {
  WEDDING_CODE_V10_QUESTIONS,
  WEDDING_CODE_V10_VERSION,
} from "@/constants/weddingCodeV10";
import {
  WEDDING_CODE_V11_QUESTIONS,
  WEDDING_CODE_V11_VERSION,
} from "@/constants/weddingCodeV11";
import {
  WEDDING_CODE_V12_QUESTIONS,
  WEDDING_CODE_V12_VERSION,
} from "@/constants/weddingCodeV12";
import { encodeWeddingCodeV06 } from "@/lib/weddingCode/v06/code";
import type { WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";
import { WEDDING_CODE_V20_VERSION } from "@/constants/weddingCodeV20";
import { WEDDING_CODE_V30_VERSION } from "@/constants/weddingCodeV30";
import { WEDDING_CODE_V31_VERSION } from "@/constants/weddingCodeV31";
import WeddingCodePage, { generateMetadata } from "./page";

const LEFT_ISH: WeddingCodeV06Answers = Object.fromEntries(
  WEDDING_CODE_V06_QUESTIONS.map((question) => [question.key, "A"]),
);
const RIGHT_ISH: WeddingCodeV06Answers = Object.fromEntries(
  WEDDING_CODE_V06_QUESTIONS.map((question) => [question.key, "D"]),
);
const V08_LEFT: WeddingCodeV06Answers = Object.fromEntries(
  WEDDING_CODE_V08_QUESTIONS.map((question) => [question.key, "A"]),
);
const V08_RIGHT: WeddingCodeV06Answers = Object.fromEntries(
  WEDDING_CODE_V08_QUESTIONS.map((question) => [question.key, "D"]),
);
/**
 * 문항은 축마다 좌 2 : 우 2이고 선택지 위치도 문항마다 바뀐다. 그래서 같은 보기(A/D)만
 * 열여섯 번 고르면 모든 축이 2:2가 된다. 한쪽으로 몰린 응답을 보려면 축별로 같은 편
 * 선택지를 집어야 한다.
 */
const V08_OTHER_SIDED: WeddingCodeV06Answers = {
  A1: "C", A2: "B", A3: "A", A4: "A", A5: "C",
  B1: "C", B2: "A", B3: "A", B4: "B", B5: "B",
  C1: "C", C2: "B", C3: "A", C4: "A", C5: "B",
  D1: "C", D2: "B", D3: "A", D4: "B", D5: "B",
};
const V08_ONE_SIDED: WeddingCodeV06Answers = {
  A1: "A", A2: "A", A3: "C", A4: "B", A5: "A",
  B1: "A", B2: "B", B3: "C", B4: "A", B5: "A",
  C1: "A", C2: "A", C3: "C", C4: "B", C5: "A",
  D1: "A", D2: "B", D3: "C", D4: "A", D5: "A",
};

async function render(searchParams: { v?: string; a?: string; b?: string }) {
  const element = await WeddingCodePage({ searchParams: Promise.resolve(searchParams) });
  return renderToStaticMarkup(element);
}

describe("웨딩코드 진입 화면", () => {
  /**
   * 답은 fragment(`#`)에 있어서 검색엔진이 볼 수 없다. 그래서 **맨 주소는 색인해야**
   * 「여러 예비부부가 쓰는 도구」가 될 길이 열린다. 반대로 과거 `?a=` 링크에는 누군가의
   * 실제 응답이 query에 들어 있으므로 그 주소만 막는다.
   */
  it("입구는 색인하고 답이 실린 주소만 막는다", async () => {
    const clean = await generateMetadata({ searchParams: Promise.resolve({}) });
    expect(clean.robots).toMatchObject({ index: true, follow: true });
    expect(clean.alternates?.canonical).toBe("/wedding-code");
    expect(clean).toMatchObject({ referrer: "no-referrer" });

    for (const carrying of [{ a: "AACB" }, { b: "AACB" }, { a: "AACB", b: "AACB" }, { a: "" }, { v: WEDDING_CODE_V30_VERSION, a: "broken" }]) {
      const guarded = await generateMetadata({ searchParams: Promise.resolve(carrying) });
      expect(guarded.robots, JSON.stringify(carrying)).toMatchObject({
        index: false,
        follow: false,
      });
    }
  });

  it("코드가 없으면 처음부터 답하는 화면이다", async () => {
    const page = await WeddingCodePage({ searchParams: Promise.resolve({}) });
    expect(page.props.initialEntry).toEqual({ kind: "v31", initial: { partnerDraft: null, partnerCode: null, bothDrafts: null } });
    const html = await render({});
    expect(html).not.toContain("16문장");
    expect(html).toContain("시작하기");
    // 예전의 중단 안내가 남아 있으면 안 된다.
    expect(html).not.toContain("정식 검증을 준비하고 있어요");
    expect(html).not.toContain("답변을 받거나 저장하지 않습니다");
  });

  it("기본 통합판을 판정 언어로 소개하지 않는다", async () => {
    const html = await render({});
    for (const banned of ["점수가", "등급", "궁합이", "유형이에요", "당신은 "]) {
      expect(html, banned).not.toContain(banned);
    }
  });

  it("통합판은 전체 분량과 답의 저장·공유 경계를 시작 전에 밝힌다", async () => {
    const html = await render({});
    const container = document.createElement("div");
    container.innerHTML = html;
    const text = container.textContent ?? "";
    expect(text).toContain("기본 23개 질문");
    expect(text).toContain("결과에서 9개 선택 질문");
    expect(text).toContain("답하는 동안에는 서버나 계정에 보내지 않아요");
    expect(text).toContain("이 브라우저에 자동 저장해 나중에 이어 할 수 있어요");
    expect(text).toContain("공용 기기에서는");
    expect(text).toContain("30일 동안 같은 브라우저");
    expect(text).toContain("결과에서 함께 보기에 동의하면 선택한 답을 7일간 서버에 보관해요");
    expect(text).toContain("내 웨딩코드 시작하기");
  });

  it("명시된 v20 입구의 설명과 개인정보 경계도 유지한다", async () => {
    const html = await render({ v: WEDDING_CODE_V20_VERSION });
    expect(html).toContain("16문장");
    expect(html).toContain("성격검사나 MBTI 공식 검사가 아니에요");
    expect(html).toContain("문장 하나씩 읽고 지금의 나와 가까운 정도");
    expect(html).toContain("지금 답하기 어렵거나 우리 상황에 해당하지 않으면");
    expect(html).toContain("서버에도 저장하지 않아요");
  });

  it("먼저 답한 사람의 코드가 오면 응답 순서를 정확히 알린다", async () => {
    const html = await render({ a: encodeWeddingCodeV06(LEFT_ISH) });
    expect(html).toContain("먼저 답한 사람이 링크를 보냈어요");
    expect(html).toContain("나도 답해보기");
  });

  it("DB 비저장과 URL 노출을 구분해 알린다", async () => {
    const html = await render({ v: WEDDING_CODE_V20_VERSION });
    // 브라우저에는 동의와 상관없이 남기지 않고(새로고침하면 사라짐), 서버에도 저장하지 않는다.
    expect(html).toContain("답은 새로고침하면 사라져요");
    expect(html).toContain("공유 링크에는 답한 내용이 담기니");
    expect(html).not.toContain("답은 저장되지 않아요");
  });

  it("새 기본판의 metadata는 취향·준비 방식·직접 고른 우선순위를 설명한다", async () => {
    for (const search of [{}, { v: WEDDING_CODE_V31_VERSION }, { v: WEDDING_CODE_V30_VERSION }]) {
      const metadata = await generateMetadata({ searchParams: Promise.resolve(search) });
      expect(metadata.title).toContain("원하는 결혼식과 준비 방식");
      expect(metadata.description).toContain("결혼식 취향과 준비 방식");
      expect(metadata.description).toContain("꼭 지키고 싶은 것과 돈을 더 쓰고 싶은 곳");
      expect(metadata.description).not.toMatch(/모든 성향|완벽|정확히|MBTI|16개 문장|32개 문장만/);
    }
    const old = await generateMetadata({ searchParams: Promise.resolve({ v: WEDDING_CODE_V20_VERSION }) });
    expect(old.description).toContain("16개 문장");
  });

  it("query에 중복된 버전이나 새 응답이 오면 복원하지 않는다", async () => {
    const duplicate = await WeddingCodePage({ searchParams: Promise.resolve({ v: [WEDDING_CODE_V30_VERSION, WEDDING_CODE_V30_VERSION] }) });
    expect(renderToStaticMarkup(duplicate)).toContain("이 링크는 열 수 없어요");
    const carried = await render({ v: WEDDING_CODE_V30_VERSION, a: "broken" });
    expect(carried).toContain("이 링크는 열 수 없어요");
    const latest = await render({ v: WEDDING_CODE_V31_VERSION, a: "broken" });
    expect(latest).toContain("이 링크는 열 수 없어요");
  });

  it("v30 주소에서는 40개 원문 판을 유지한다", async () => {
    const html = await render({ v: WEDDING_CODE_V30_VERSION });
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(container.textContent).toContain("전체 40개 질문");
    expect(container.textContent).toContain("32개 문장");
  });

  /**
   * 이 제품에서 제일 나쁜 버그는 고르지도 않은 답이 「상대는 이렇게 답했어요」로 뜨는 것이다.
   * 망가진 코드는 조용히 채우지 말고 처음부터 답하게 해야 한다.
   */
  it("망가진 코드는 상대 답으로 취급하지 않는다", async () => {
    for (const broken of ["ABC", "ZZZZZZZZZZZZZZZZ", "", "----------------"]) {
      const html = await render({ a: broken });
      expect(html, `코드 "${broken}"`).toContain("이 링크는 열 수 없어요");
      expect(html, `코드 "${broken}"`).not.toContain("상대가 먼저 답하고 보냈어요");
    }
  });

  it("두 코드가 다 있으면 차이 지도를 바로 연다", async () => {
    const html = await render({
      a: encodeWeddingCodeV06(LEFT_ISH),
      b: encodeWeddingCodeV06(RIGHT_ISH),
    });
    expect(html).toContain('data-result="couple"');
    expect(html).toContain("갈렸어요");
    expect(html).toContain("누가 맞는지 가리지 않아요");
    expect(html).toContain("먼저 답한 사람");
    expect(html).toContain("나중에 답한 사람");
    expect(html).toContain("둘이 해 볼 것:");
    expect(html).not.toMatch(/최소 세 번|매번 갈려|잡을 때마다/);
    expect(html).not.toContain("상대: “");
    expect(html).not.toContain("나: “");
    expect(html).not.toContain("결과 링크 상대에게 보내기");
  });

  it("명시된 미지원 버전의 답을 현재 문항으로 해석하지 않는다", async () => {
    const html = await render({
      v: "v9-unknown",
      a: encodeWeddingCodeV06(LEFT_ISH),
      b: encodeWeddingCodeV06(RIGHT_ISH),
    });
    expect(html).toContain("이 링크는 열 수 없어요");
    expect(html).not.toContain('data-result="couple"');
  });

  it("명시된 v0.6 링크는 당시 문항으로 정상적으로 연다", async () => {
    const html = await render({
      v: WEDDING_CODE_V06_VERSION,
      a: encodeWeddingCodeV06(LEFT_ISH),
      b: encodeWeddingCodeV06(RIGHT_ISH),
    });
    expect(html).toContain('data-result="couple"');
  });

  it("새 v0.7 링크는 쉬운 문항의 답과 문항별 해결책으로 연다", async () => {
    const html = await render({
      v: WEDDING_CODE_V08_VERSION,
      a: encodeWeddingCodeV06(V08_LEFT, WEDDING_CODE_V08_QUESTIONS),
      b: encodeWeddingCodeV06(V08_RIGHT, WEDDING_CODE_V08_QUESTIONS),
    });

    expect(html).toContain('data-result="couple"');
    expect(html).toContain("맨 아래 총액부터 보고 숨을 한 번 골랐다");
    expect(html).toContain("우리 결혼식이 어떤 하루일지 상상부터 했다");
    expect(html).toContain("최종 금액·받는 사진 수·보정 사진 수");
    expect(html).toContain(`#v=${encodeURIComponent(WEDDING_CODE_V08_VERSION)}`);
    expect(html).not.toContain("스드메 견적서");
  });

  it("차이 지도가 두 사람이 실제로 고른 문장을 인용한다", async () => {
    const html = await render({
      a: encodeWeddingCodeV06(LEFT_ISH),
      b: encodeWeddingCodeV06(RIGHT_ISH),
    });
    // 화면에 뜬 첫 갈림에 대해 A안·D안 문구가 실제로 들어 있어야 한다.
    const shown = WEDDING_CODE_V06_QUESTIONS.filter((question) =>
      html.includes(`data-gap="${question.key}"`),
    );
    expect(shown.length).toBeGreaterThan(0);
    for (const question of shown) {
      const a = question.options.find((option) => option.value === "A")!.label;
      const d = question.options.find((option) => option.value === "D")!.label;
      expect(html, `${question.key} A안`).toContain(a);
      expect(html, `${question.key} D안`).toContain(d);
    }
  });

  it("한쪽 코드만 있으면 차이 지도를 열지 않는다", async () => {
    const html = await render({ b: encodeWeddingCodeV06(RIGHT_ISH) });
    expect(html).not.toContain('data-result="couple"');
  });

  /**
   * 혼자 답한 사람에게 남는 것이 「내가 고른 문장 네 개」뿐이면, 상대에게 링크를 보낼
   * 이유도 자신을 파악했다는 감각도 생기지 않는다. 개인 결과는 축 네 개 전부에 대해
   * 셈·인용·다음 행동을 돌려줘야 한다.
   */
  it("부분 응답 커플 결과에도 연락 지연·맡긴 답을 원문과 같은 수로 남긴다", async () => {
    const first = { B5: "A", B1: "C" } as const;
    const second = { B5: "B", B1: "A" } as const;
    const html = await render({
      v: WEDDING_CODE_V08_VERSION,
      a: encodeWeddingCodeV06(first, WEDDING_CODE_V08_QUESTIONS),
      b: encodeWeddingCodeV06(second, WEDDING_CODE_V08_QUESTIONS),
    });
    expect(html).toContain("각자 이번에 고른 것");
    expect(html).toContain("둘 다 못 받아서 답이 며칠씩 밀렸다");
    expect(html).toContain("정리한 사람이 3곳으로 줄여달라고 했다");
    expect(html).toContain("답을 같은 수만큼 골랐어요");
    // 각자 요약의 셈은 결과 화면 범례와 같은 문장이고, 겪은 일이 섞인 축이라 확인 안내가 붙는다.
    expect(html).toContain("답한 2장면이 T(둘이 같이) 쪽과 O(맡아서 하기) 쪽으로 반반 나뉘었어요. 이 주제의 답에는 겪은 일, 바랐던 일, 내가 한 일이 섞여 있어요.");
    expect(html).not.toContain("함께 보기와 맡기기 답을 같은 수");
    expect(html).not.toContain("반복해서 고른");
  });

  it("커플 결과에 각자 이번에 고른 것이 나란히 남는다", async () => {
    const html = await render({
      v: WEDDING_CODE_V08_VERSION,
      a: encodeWeddingCodeV06(V08_ONE_SIDED, WEDDING_CODE_V08_QUESTIONS),
      b: encodeWeddingCodeV06(V08_RIGHT, WEDDING_CODE_V08_QUESTIONS),
    });
    expect(html).toContain('data-result="self-pair"');
    expect(html).toContain("각자 이번에 고른 것");
    for (const axis of WEDDING_CODE_V06_AXES) {
      expect(html, axis.key).toContain(`data-pair-axis="${axis.key}"`);
    }
    // 셈 문장은 카피 상수가 아니라 실제 응답에서 나와야 한다.
    // 먼저 답한 사람은 모두 한쪽, 나중에 답한 사람(전부 D)은 축마다 양쪽이 섞인다.
    expect(html).toContain("답한 5장면 모두 V(조건 먼저) 쪽이었어요.");
    expect(html).toContain("답한 5장면 중 2장면은 V(조건 먼저), 3장면은 M(분위기 먼저) 쪽이었어요.");
    // 셈 문장 안에서 숫자·영문 바로 뒤에 조사가 붙지 않는다(「1예요」 「M로」).
    const countLines = html.match(/답한 \d장면[^<]*?쪽(?:이었어요|과)[^<]*/g) ?? [];
    expect(countLines.length).toBeGreaterThanOrEqual(8);
    for (const line of countLines) {
      expect(line).not.toMatch(/\d(?!장면)[가-힣]|[A-Za-z][가-힣]/);
    }
  });

  /**
   * 한 사람이 대부분을 건너뛴 경우.
   *
   * 「열여섯 장면 중 2곳에서 갈렸어요」라고 하면 비교하지도 못한 열두 장면을 「같았다」로
   * 세는 것이 된다. 부모님이 안 계시거나 결혼식을 하지 않아 여러 장면을 건너뛴 사람에게
   * 이 문장은 사실이 아니다.
   */
  it("한쪽이 건너뛴 장면은 같았다고 세지 않는다", async () => {
    // 먼저 답한 사람은 앞의 네 장면만 답하고 열두 장면을 건너뛰었다.
    const partial = "AACBA" + "-".repeat(15);
    const html = await render({
      v: WEDDING_CODE_V08_VERSION,
      a: partial,
      b: encodeWeddingCodeV06(V08_RIGHT, WEDDING_CODE_V08_QUESTIONS),
    });

    expect(html).toContain('data-result="couple"');
    expect(html).toContain("함께 답한 5장면");
    expect(html).toContain("건너뛴 15장면은 비교하지 않았어요");
    expect(html).not.toContain("스무 장면 중");

    // 건너뛴 축에는 제목을 붙이지 않는다 — 「…나뉘었어요」와 「답하지 않았어요」가
    // 같이 뜨면 둘 중 하나는 거짓말이다.
    expect(html).toContain("이 주제는 건너뛰었어요.");
    expect(html).not.toContain("이 주제는 아직 답하지 않았어요.");
    // 건너뛴 축에는 갈림·같음 판정도 붙이지 않는다.
    const supportOrderBlock = html.slice(html.indexOf('data-pair-axis="supportOrder"'));
    expect(supportOrderBlock.slice(0, 600)).not.toContain("data-pair-state");
  });

  /**
   * 이름이 코드인데 코드가 없으면 이 제품은 이름값을 못 한다. 다만 코드 옆에 성격
   * 설명이나 궁합 점수가 붙으면 근거 없는 주장을 파는 것이 된다.
   */
  it("커플 결과에 두 사람의 네 글자 코드가 나오되 점수는 없다", async () => {
    const html = await render({
      v: WEDDING_CODE_V08_VERSION,
      a: encodeWeddingCodeV06(V08_ONE_SIDED, WEDDING_CODE_V08_QUESTIONS),
      b: encodeWeddingCodeV06(V08_OTHER_SIDED, WEDDING_CODE_V08_QUESTIONS),
    });

    expect(html).toContain('data-code-pair');
    for (const axis of WEDDING_CODE_V06_AXES) {
      expect(html, axis.key).toContain(`data-code-slot="${axis.key}"`);
    }
    expect(html).toMatch(/data-code-state="(same|different|unknown)"/);
    expect(html).toContain("점수는 매기지 않아요");
    // 궁합·점수·유형 설명이 붙으면 안 된다.
    for (const banned of ["궁합", "점", "잘 맞는", "유형이에요", "당신은 "]) {
      if (banned === "점") continue; // 「점수는 매기지 않아요」 고지에 들어 있다
      expect(html, banned).not.toContain(banned);
    }
    expect(html).not.toMatch(/\d+\s*점|\d+\s*%/);
  });

  it.each([
    { version: WEDDING_CODE_V08_VERSION, questions: WEDDING_CODE_V08_QUESTIONS },
    { version: WEDDING_CODE_V10_VERSION, questions: WEDDING_CODE_V10_QUESTIONS },
    { version: WEDDING_CODE_V11_VERSION, questions: WEDDING_CODE_V11_QUESTIONS },
    { version: WEDDING_CODE_V12_VERSION, questions: WEDDING_CODE_V12_QUESTIONS },
  ])("$version 커플 결과의 네 자리 뜻은 처음부터 펼쳐 보인다", async ({ version, questions }) => {
    const html = await render({
      v: version,
      a: encodeWeddingCodeV06(Object.fromEntries(questions.map(question => [question.key, question.options[0].value])), questions),
      b: encodeWeddingCodeV06(Object.fromEntries(questions.map(question => [question.key, question.options.at(-1)!.value])), questions),
    });
    const container = document.createElement("div");
    container.innerHTML = html;
    const legend = container.querySelector<HTMLDetailsElement>("[data-code-pair] > details");

    expect(legend?.open).toBe(true);
    expect(legend?.querySelector("summary")?.textContent).toBe("자리마다 두 사람 글자 보기");
    const slots = legend?.querySelectorAll("[data-code-slot]");
    expect(slots?.length).toBe(4);
    for (const slot of slots ?? []) {
      expect(slot.textContent).toMatch(/먼저 답한 사람 [A-Za-z]\([^)]+\) · 나중에 답한 사람 [A-Za-z]\([^)]+\)/);
    }
  });

  it.each([
    { version: WEDDING_CODE_V10_VERSION, questions: WEDDING_CODE_V10_QUESTIONS },
    { version: WEDDING_CODE_V11_VERSION, questions: WEDDING_CODE_V11_QUESTIONS },
    { version: WEDDING_CODE_V12_VERSION, questions: WEDDING_CODE_V12_QUESTIONS },
  ])("$version의 같은 답 문자열은 그 판에서 고른 문장을 인용한다", async ({ version, questions }) => {
    const html = await render({ v: version, a: `A${"-".repeat(19)}`, b: `D${"-".repeat(19)}` });
    const container = document.createElement("div");
    container.innerHTML = html;
    const quoted = container.querySelector('[data-compared-scene="A1"]');
    expect(quoted).not.toBeNull();
    for (const value of ["A", "D"]) {
      expect(quoted?.textContent).toContain(questions[0].options.find(option => option.value === value)!.label);
    }
    expect(html).toContain(`#v=${encodeURIComponent(version)}`);
  });

  /**
   * 겹치는 답이 하나도 없는 경우 — 한 사람은 부모님 장면을, 다른 사람은 촬영 장면을
   * 건너뛴 커플이 실제로 여기에 온다. 그때 「방향이 같았어요」는 명백한 거짓이다.
   */
  it("함께 답한 장면이 없으면 방향이 같았다고 하지 않는다", async () => {
    const html = await render({
      v: WEDDING_CODE_V08_VERSION,
      a: `AACBA${"-".repeat(15)}`,
      b: `${"-".repeat(15)}ABCAA`,
    });
    expect(html).toContain("두 사람이 함께 답한 장면이 없어요");
    expect(html).not.toContain("방향이 같았어요");
    expect(html).not.toContain("함께 답한 0장면");
    // 각자 답한 것은 남는다.
    expect(html).toContain('data-result="self-pair"');
  });

  /**
   * 아모라가 두 사람을 상대할 때 제일 위험한 것은 갈린 자리에서 한쪽 값에 맞춰 움직이는
   * 것이다. 그 순간 아모라는 자동으로 한 사람 편이 된다. 갈림은 갈림으로 표시하고,
   * 어느 쪽이 맞다고 말하지 않아야 한다.
   */
  it("두 사람이 갈린 축은 갈림으로 표시하고 편들지 않는다", async () => {
    const html = await render({
      v: WEDDING_CODE_V08_VERSION,
      a: encodeWeddingCodeV06(V08_ONE_SIDED, WEDDING_CODE_V08_QUESTIONS),
      b: encodeWeddingCodeV06(V08_RIGHT, WEDDING_CODE_V08_QUESTIONS),
    });
    expect(html).toContain('data-pair-state=');
    expect(html).toContain('data-pair-state="different"');
    expect(html).toContain("다른 답 있음");
    for (const banned of ["맞는 쪽", "올바른 쪽", "더 나은 쪽", "권장하는 쪽"]) {
      expect(html, banned).not.toContain(banned);
    }
  });

  it("개인 결과에 판정 대신 셈·인용·다음 행동이 남는다", () => {
    const profile = buildWeddingCodeSelfProfile(V08_LEFT, {
      questions: WEDDING_CODE_V08_QUESTIONS,
      axes: WEDDING_CODE_V06_AXES,
    });
    expect(profile.complete).toBe(true);
    expect(profile.axes).toHaveLength(WEDDING_CODE_V06_AXES.length);
    for (const reading of profile.axes) {
      expect(reading.evidence.length).toBeGreaterThan(0);
      expect(reading.tellPartner.length).toBeGreaterThan(0);
      expect(reading.watchOut.length).toBeGreaterThan(0);
      // 인용은 실제 문항의 선택지 문장이어야 한다.
      const labels = WEDDING_CODE_V08_QUESTIONS.flatMap((question) =>
        question.options.map((option) => option.label),
      );
      for (const quote of reading.evidence) {
        expect(labels, quote.label).toContain(quote.label);
      }
    }
  });
});
