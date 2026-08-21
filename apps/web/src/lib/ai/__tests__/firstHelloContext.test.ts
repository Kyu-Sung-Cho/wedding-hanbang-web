import { describe, expect, it } from "vitest";
import { buildAmoraFirstHello } from "@hanbang/shared";

import { buildFirstHelloContextTurn } from "../firstHelloContext";

/**
 * 아모라의 첫마디가 모델에 닿는 조건.
 *
 * 이 규칙이 느슨해지면 **보지도 않은 인사를 모델이 언급**하고, 빡빡해지면 사람이
 * 읽은 인사를 모델만 모른 채 "그래"를 받는다. 양쪽 다 첫 번째 턴을 망친다.
 */

const NOW = Date.UTC(2026, 7, 20);
const SEEN = "2026-08-20T00:00:00.000Z";

describe("첫마디 맥락", () => {
  it("안내를 끝낸 사람의 빈 대화에만 놓는다", () => {
    const turn = buildFirstHelloContextTurn({
      canonicalMessages: [],
      tutorialCompletedAt: SEEN,
      weddingDate: "2026-10-17",
      progress: { __stage: "venue_booked" },
      now: NOW,
    });

    expect(turn).not.toBeNull();
    expect(turn?.role).toBe("assistant");
    // 화면이 보여준 것과 **같은 말**이어야 한다. 다르면 사람과 모델이 다른 인사를 기억한다.
    expect(turn?.content).toBe(
      buildAmoraFirstHello({
        weddingDate: "2026-10-17",
        preparationStage: "venue_booked",
        now: NOW,
      }).body,
    );
  });

  it("안내를 안 본 사람에게는 놓지 않는다", () => {
    // 보지도 않은 인사를 모델이 언급하는 편이, 맥락이 조금 빈 것보다 나쁘다.
    expect(
      buildFirstHelloContextTurn({
        canonicalMessages: [],
        tutorialCompletedAt: null,
        weddingDate: "2026-10-17",
        progress: {},
        now: NOW,
      }),
    ).toBeNull();
  });

  it("아모라가 이미 말한 적 있으면 놓지 않는다", () => {
    // 진짜 이력이 생기면 저절로 멈춘다 — 따로 끄는 플래그를 두지 않는 이유다.
    expect(
      buildFirstHelloContextTurn({
        canonicalMessages: [
          { role: "user", content: "안녕" },
          { role: "assistant", content: "안녕하세요" },
          { role: "user", content: "그래" },
        ],
        tutorialCompletedAt: SEEN,
        weddingDate: "2026-10-17",
        progress: {},
        now: NOW,
      }),
    ).toBeNull();
  });

  it("사용자 메시지만 있는 대화에는 놓는다", () => {
    // 사람이 인사를 읽고 곧바로 답한 상황이 정확히 이 모양이다.
    const turn = buildFirstHelloContextTurn({
      canonicalMessages: [{ role: "user", content: "그래" }],
      tutorialCompletedAt: SEEN,
      weddingDate: null,
      progress: null,
      now: NOW,
    });
    expect(turn).not.toBeNull();
    expect(turn?.content.length).toBeGreaterThan(0);
  });

  it("아는 것이 없어도 없는 사실을 만들지 않는다", () => {
    const turn = buildFirstHelloContextTurn({
      canonicalMessages: [],
      tutorialCompletedAt: SEEN,
      weddingDate: null,
      progress: undefined,
      now: NOW,
    });
    expect(turn?.content).not.toMatch(/\d+일 남았어요/);
    for (const banned of ["플래너", "파트너", "늦으셨", "업체"]) {
      expect(turn?.content).not.toContain(banned);
    }
  });
});
