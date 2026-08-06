import { describe, expect, it } from "vitest";
import {
  allowedCareTopics,
  allowsCelebration,
  allowsCountdown,
  allowsUrgency,
  normalizePreparationStatus,
} from "@hanbang/shared";
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";

// §18: "예식이 연기되거나 취소된 사용자에게 축하 말투와 준비 독촉을 계속하지 않는다.
// 사용자가 원하는 범위에서 알림 정리, 계약 조건 확인, 환급·취소 일정 같은 현실적인
// 다음 행동만 조심스럽게 돕는다."
//
// 결혼이 취소된 사람에게 앱이 "D-42"를 띄우고 축하하는 것은 어떤 버그보다 아프다.

const FAR_FUTURE = "2099-06-15";

function prompt(preparationStatus?: unknown) {
  return getWeddingPlannerSystemPrompt({
    weddingDate: FAR_FUTURE,
    budget: 30_000_000,
    venue: null,
    progress: {},
    brideName: null,
    groomName: null,
    senderName: "테스트",
    bookings: [],
    scheduleEvents: [],
    chatSummaries: [],
    preparationStatus: preparationStatus as never,
  } as never);
}

describe("준비 상태에 따른 카운트다운", () => {
  it("준비 중이면 남은 날짜를 센다", () => {
    expect(prompt("preparing")).toMatch(/\(D-\d+\)/u);
  });

  it("취소한 사람에게는 남은 날짜를 세지 않는다", () => {
    const text = prompt("called_off");
    expect(text).not.toMatch(/\(D-\d+\)/u);
    expect(text).not.toContain("D-Day!");
  });

  it("잠시 멈춘 사람에게도 남은 날짜를 세지 않는다", () => {
    expect(prompt("paused")).not.toMatch(/\(D-\d+\)/u);
  });

  it("상태를 모르면 준비 중으로 본다", () => {
    // 저장 컬럼이 아직 없다. 모르는 상태 때문에 모든 사용자의 준비가 멈춘 것처럼
    // 보이면 안 된다.
    for (const unknown of [undefined, null, "", "wat", 42]) {
      expect(prompt(unknown), String(unknown)).toMatch(/\(D-\d+\)/u);
    }
  });
});

describe("멈춘 사람에게 하는 말", () => {
  it("재촉과 축하를 거두고 정리할 일만 남긴다", () => {
    const text = prompt("called_off");
    expect(text).toContain("남은 날짜를 세거나 축하하거나 다음 할 일을 재촉하지 마세요");
    expect(text).toContain("알림 정리, 계약 조건 확인, 환급·취소 일정");
    expect(text).toContain("이유를 캐묻지 말고");
  });

  it("연기와 취소를 다른 문장으로 말한다", () => {
    expect(prompt("paused")).toContain("잠시 멈춘 상황");
    expect(prompt("called_off")).toContain("이어가는 상황이 아닙니다");
  });

  it("상태를 되돌리는 것도 사용자임을 못박는다", () => {
    // 아모라가 "다시 준비 시작할까요?"로 밀어붙이면 안 된다.
    expect(prompt("called_off")).toContain("아모라가 임의로 준비를 다시 시작하지 마세요");
  });

  it("준비 중인 사람의 프롬프트는 건드리지 않는다", () => {
    expect(prompt("preparing")).not.toContain("준비를 잠시 멈춘 상황");
    expect(prompt("preparing")).not.toContain("이어가는 상황이 아닙니다");
  });
});

describe("상태 계약", () => {
  it("멈춘 상태에서는 카운트다운·재촉·축하가 모두 닫힌다", () => {
    for (const status of ["paused", "called_off"] as const) {
      expect(allowsCountdown(status), status).toBe(false);
      expect(allowsUrgency(status), status).toBe(false);
      // 연기한 사람에게도 축하는 어긋난다.
      expect(allowsCelebration(status), status).toBe(false);
    }
  });

  it("먼저 꺼낼 수 있는 이야기는 정리 세 가지뿐이다", () => {
    expect(allowedCareTopics("called_off")).toEqual([
      "notification_cleanup",
      "contract_terms",
      "refund_and_cancellation_dates",
    ]);
    expect(allowedCareTopics("preparing")).toEqual([]);
  });

  it("알 수 없는 값은 준비 중으로 떨어진다", () => {
    for (const hostile of [null, undefined, 42, {}, [], "PREPARING"]) {
      expect(normalizePreparationStatus(hostile as never)).toBe("preparing");
    }
  });
});
