// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { MANNERS_PARTS } from "../data";
import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";

/**
 * 내용 감사(2026-08-23)에서 고친 것들을 지킨다.
 *
 * 이 파일이 지키는 것은 **소비자가 잃는 것** 순서로 골랐다 — 틀린 법률 조언, 헛걸음,
 * 결혼식에 못 오는 사람, 그 자리에서 상처받는 말.
 */

describe("법률·세무 주장에는 근거가 붙어 있다", () => {
  const giftMoney = MANNERS_PARTS.find((p) => p.slug === "gift-money");

  it("검사가 실제로 그 편을 찾는다", () => {
    expect(giftMoney, "축의금 편이 없다").toBeDefined();
  });

  it("청탁금지법 주장을 지는 출처가 있다", () => {
    // 이 편은 "현금 축의금은 5만원까지" 같은 숫자를 단정한다. 그런데 출처 5건이
    // 전부 언론·소비자원·국어원이었다 — 법률 출처가 0건이었다. 2026-07-17 에
    // 코퍼스가 통째로 삭제된 사유의 절반이 "법률 26건 출처 0건" 이었다.
    const labels = (giftMoney?.sources ?? []).map((s) => s.label).join(" | ");
    expect(labels, "청탁금지법 근거가 없다").toMatch(/청탁금지법|금품수수/);
    expect(labels, "권익위 가액범위 근거가 없다").toMatch(/권익위/);
  });

  it("근거를 못 댄 세금 이야기는 그 한계를 그 자리에서 밝힌다", () => {
    // 지우지 않았다 — 거짓이라는 증거도 없기 때문이다. 다만 다른 서술과 같은
    // 무게로 읽히면 안 된다.
    const text = JSON.stringify(giftMoney);
    expect(text).toContain("증여세");
    expect(
      text,
      "증여세 이야기에 '1차 자료로 확인한 내용이 아니다'라는 단서가 없다",
    ).toContain("공개된 1차 자료로 확인한 내용이 아니라");
  });
});

describe("혼인신고 증인 요건을 깎아 적지 않는다", () => {
  const timeline = MANNERS_PARTS.find((p) => p.slug === "planning-timeline");

  it("성년자 2인의 연서라고 말한다", () => {
    // "증인 두 사람의 서명" 만으로는 미성년자를 데려가거나 따로 받아 가서
    // 접수처에서 돌아온다. 같은 저장소의 다른 두 곳은 이미 정확했다.
    const text = JSON.stringify(timeline);
    expect(text).toContain("성년자인 증인 2인의 연서");
    expect(text).not.toContain("증인 두 사람의 서명이 들어갑니다");
  });
});

describe("예식장을 계약하기 전에 못 오실 분을 확인한다", () => {
  const venue = CATEGORY_CHECKLISTS.find((c) => c.key === "venue");
  const items = venue?.items ?? [];

  it("직접 확인하는 항목에 이동 접근성 안내가 있다", () => {
    // 171항목 전체에 휠체어·계단·엘리베이터가 0건이었다. 계약금을 낸 뒤에는
    // 되돌릴 수 없고, 이건 **참석 가능 여부 자체를 가르는** 유일한 누락이었다.
    // **낱말 하나가 아니라 지시 자체를 본다.** 첫 판은 `/계단/` 만 봤는데,
    // 뜻을 뒤집어도 그 낱말이 남아 있으면 통과했다(변형 시험이 잡음).
    const visit = items.find((i) => i.id === "venue_03");
    expect(visit?.note, "방문 항목에 안내가 없다").toBeTruthy();
    expect(visit?.note, "계단 없이 갈 수 있는지를 묻지 않는다").toContain("계단 없이 갈 수 있는지");
    expect(visit?.note, "방문한 날 직접 걸어보라고 말하지 않는다").toContain("직접 걸어서");
  });

  it("그 안내가 계약금 항목보다 앞에 온다", () => {
    // 뒤에 있으면 못 되돌린다. 배열 순서가 그대로 화면 순서다.
    const visitAt = items.findIndex((i) => i.id === "venue_03");
    const payAt = items.findIndex((i) => i.note?.includes("계약금") || i.label.includes("계약금"));
    expect(visitAt).toBeGreaterThan(-1);
    expect(payAt, "계약금 항목을 못 찾았다").toBeGreaterThan(-1);
    expect(visitAt, "방문 확인이 계약금보다 뒤에 있다").toBeLessThan(payAt);
  });

  it("종교시설 예식에 갈 길이 있다", () => {
    // 체크리스트 171항목에 종교·성당·교회가 0건이었다. 예절 편은 "혼인 교리 교육
    // 기간을 계산에 안 넣어 날짜를 다시 잡는 경우" 를 이미 적어 두었다.
    const shape = items.find((i) => i.id === "venue_01");
    expect(shape?.note).toMatch(/종교시설/);
  });
});

describe("가족 구성을 하나로 전제하지 않는다", () => {
  it("첫인사 대사가 부모 두 분을 전제하지 않는다", () => {
    // 이건 읽고 마는 글이 아니라 **상대 부모 앞에서 소리 내어 말하도록** 설계된
    // 문장이다. 부모가 한 분이거나 다른 분이 키운 사람이 그 자리에 선다.
    const part = MANNERS_PARTS.find((p) => p.slug === "first-family-visit");
    const text = JSON.stringify(part);
    expect(text).toContain("두 분께서 잘 키워주셔서");
    expect(
      text,
      "그 대사 곁에 가족 구성이 다를 수 있다는 안내가 없다",
    ).toContain("한 분만 계시거나 다른 분이 키워주셨다면");
  });

  it("한복 항목이 여쭐 어른이 계신 것을 전제하지 않는다", () => {
    const hanbok = CATEGORY_CHECKLISTS.find((c) => c.key === "hanbok");
    const note = hanbok?.items.find((i) => i.note?.includes("입으실지"))?.note;
    expect(note, "한복 note 를 못 찾았다").toBeTruthy();
    expect(note).toContain("계시면");
  });
});

describe("두 사람이 읽는 글이 한쪽 성별을 독자로 세우지 않는다", () => {
  for (const slug of ["first-holiday", "post-honeymoon-thanks"]) {
    it(`${slug} 이 읽는 사람을 아내로 고정하지 않는다`, () => {
      const part = MANNERS_PARTS.find((p) => p.slug === slug);
      expect(part?.audience, `${slug}: audience 가 couple 이 아니다`).toBe("couple");

      // 섹션 제목이 한쪽 집을 기본값으로 삼으면 남편이 읽을 때 자기 부모를
      // "시부모님" 이라 부르게 된다.
      const headings = (part?.sections ?? []).map((s) => s.heading).join(" | ");
      expect(headings, `${slug}: 섹션 제목이 시댁/친정을 기본값으로 쓴다`)
        .not.toMatch(/^.*(시댁에서 맞는|친정에서 맞는).*$/);

      // 어느 쪽이 어느 집인지 읽는 사람에 따라 바뀐다는 것을 말한다.
      expect(part?.caveat, `${slug}: caveat 이 그 사실을 말하지 않는다`)
        .toContain("읽는 사람에 따라");
    });
  }

  it("관행을 설명하는 문장까지 지우지는 않았다", () => {
    // 일괄 치환하면 "전통적으로는 시댁을 먼저 찾았지만 요즘은…" 같은 **사실 서술**
    // 까지 사라진다. 읽는 사람을 세우는 것과 관행을 적는 것은 다르다.
    const part = MANNERS_PARTS.find((p) => p.slug === "post-honeymoon-thanks");
    expect(JSON.stringify(part)).toContain("전통적으로는 시댁을 먼저 찾았지만");
  });
});

describe("축의금을 언제 이야기할지 체크리스트가 말한다", () => {
  it("초대장 분야에 항목이 있다", () => {
    // 예절 안내가 "예식이 끝난 뒤에 처음 꺼내면 반드시 감정이 상한다" 며 청첩장
    // 발송 전을 시한으로 못 박는데, 그 시한이 걸린 분야에 항목이 없었다.
    const invitation = CATEGORY_CHECKLISTS.find((c) => c.key === "invitation");
    const item = invitation?.items.find((i) => i.label.includes("축의금"));
    expect(item, "축의금 항목이 없다").toBeTruthy();
    // 이 파일은 업계 용어를 쓰지 않는다 — 모바일 `productCopy.test.mjs` 가 "청첩장" 을,
    // 웹 `mvpDirection.test.ts` 가 "양가" 를 막는다. 둘 다 이 상수 파일까지 훑는다.
    expect(item?.note).toContain("초대장");
  });
});

describe("모바일이 못 하는 일을 지연이라 부르지 않는다", () => {
  const mobile = readFileSync(
    resolve(process.cwd(), "..", "mobile", "app", "schedule", "index.tsx"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("요약 표시가 웹과 같은 말을 쓴다", () => {
    // `ddayDeadline` 은 마감이 아니라 화면 정렬용 기본 확인 시점이다. 게다가 이
    // 수에는 예식이 끝나야 할 수 있는 일이 들어간다("빌린 드레스 돌려주기").
    expect(mobile).not.toContain("개 지연`");
    expect(mobile).toContain("기본 확인 시점 지남");
  });

  it("그 표시를 빨간 위험색으로 칠하지 않는다", () => {
    expect(mobile).not.toContain('overdueCount > 0 ? "danger"');
  });
});
