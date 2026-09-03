import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { landingContent } from "@/components/landing/redesign/landingContent";

/**
 * 랜딩의 커뮤니티 절은 **거기 사람이 있다고 약속하지 않는다.**
 *
 * ## 왜
 *
 * 2026-08-31 운영 실측: 공개 글 **17개를 쓴 계정이 사실상 셋**이고 전부 내부
 * 계정이다(6/30 하루에 만든 페르소나 8 · 팀 6 · 파운더 3). 바깥 사람이 남긴
 * 것은 역대 댓글 한 건뿐이고, 마지막 글이 34일 전 · 마지막 댓글이 54일 전이다.
 *
 * 그때 랜딩은 이렇게 말하고 있었다:
 *
 *     "같은 달에 결혼하는 사람들이 먼저 겪은 걸 남겨 뒀어요"
 *     "지금 내가 막힌 자리를 두 달 먼저 지난 사람이 거기 있어요"
 *
 * 사용자가 커뮤니티를 열어 30초면 확인하는 자리다. 그리고 같은 랜딩이 연출한
 * 것마다 라벨을 붙인다 — 아모라 답변에 `AI 생성 답변 · 기능 예시`, 예산 카드에
 * `실제 이용 현황이 아니에요`. **네 군데.** 실제로 연출된 유일한 것인 커뮤니티에만
 * 라벨이 없고 거기서만 단정형이었다.
 *
 * ## 이 검사가 막는 것
 *
 * "사람이 있다"를 **단정하는 표현**만 막는다. 구조(분기별 동기방)·주제·읽기 조건은
 * 사실이므로 자유롭게 쓸 수 있다. 사람이 실제로 모이면 그때 이 검사를 의도적으로
 * 바꾸면 된다 — 그 판단을 사람이 하게 만드는 것이 이 검사의 목적이다.
 */

const COMMUNITY_TEXT = [
  // 2026-09-03 시안으로 커뮤니티가 흰 카드 한 장이 됐다. 눈썹과 주제 목록
  // (`eyebrow`·`topicsLead`·`topics`)이 없어지고 제목·본문·고지·링크만 남는다.
  // **읽는 자리가 줄었지 검사가 느슨해진 것이 아니다** — 남은 것이 화면 카피 전부다.
  landingContent.community.title,
  landingContent.community.body,
  landingContent.community.note,
  landingContent.community.cta.label,
  landingContent.community.cohortTag,
].join("\n");

/** 사람이 거기 있다고 단정하는 표현. */
const PROMISES_PEOPLE = [
  "먼저 겪은",
  "먼저 지난",
  "먼저 겪었",
  "사람이 거기 있",
  "선배가 있",
  "사람들이 남겨",
  "사람이 직접 남긴",
  "이야기가 오가",
  "물어보면 답",
];

describe("랜딩 커뮤니티 절은 사람 수를 약속하지 않는다", () => {
  it.each(PROMISES_PEOPLE)("단정 표현이 없다: %s", (phrase) => {
    expect(
      COMMUNITY_TEXT,
      `커뮤니티에 사람이 있다고 단정한다. 운영에 바깥 사람 글이 실제로 생겼는지 먼저 확인할 것: "${phrase}"`,
    ).not.toContain(phrase);
  });

  it("구조와 읽기 조건은 그대로 말한다", () => {
    // 사실인 것까지 지워 버리면 이 절이 아무 정보도 없는 껍데기가 된다.
    expect(COMMUNITY_TEXT).toContain("동기방");
    expect(COMMUNITY_TEXT).toContain("로그인 없이 읽을 수 있어요");
    // 주제 목록(`topics`)이 시안에서 없어졌다. 그 자리를 **분기방 목록**이 대신한다 —
    // 무엇을 모으는지는 본문 한 줄이 말하고, 화면이 보여 주는 것은 갈 수 있는 방들이다.
    expect(landingContent.community.cohorts.length, "분기방이 하나도 없다")
      .toBeGreaterThanOrEqual(3);
  });

  /**
   * `/demo` 는 출시일에 "아직 개발 중"이라고 말하지 않는다. 가격이 미정이라는
   * **사실**은 남긴다 — 없앨 것은 틀이지 사실이 아니다(2026-08-29 파운더 결정).
   */
  it("/demo 가 아직 개발 중이라고 말하지 않는다", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/demo/page.tsx"),
      "utf8",
    );
    for (const framing of ["개발·검증 중", "순차적으로 열립니다", "정식 안내에서"]) {
      expect(source, `출시일에 "아직 정식이 아니다" 틀이 남아 있다: ${framing}`)
        .not.toContain(framing);
    }
    expect(source).toContain("이용 방법과 비용은 아직 정해지지 않았고");
  });
});
