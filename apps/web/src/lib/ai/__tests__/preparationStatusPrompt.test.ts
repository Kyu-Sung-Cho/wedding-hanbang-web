import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

/** 오늘로부터 N일 뒤. 시급성 분기(daysLeft < 120)에 실제로 닿기 위해 필요하다. */
function daysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function prompt(preparationStatus?: unknown, weddingDate: string = FAR_FUTURE) {
  return getWeddingPlannerSystemPrompt({
    weddingDate,
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

// 아래 두 묶음은 §18을 "완료"로 보고한 뒤에 빠져 있던 것이다. 위 테스트들은 예식일을
// 2099년으로 잡아서 시급성 분기(daysLeft < 120)에 애초에 닿지 못했고, 상태를 실제
// 요청 경로에서 읽는지도 확인하지 않았다. 계약과 프롬프트 게이트가 다 있어도 그
// 둘이 비면 기능은 존재하지 않는다.

describe("예식이 코앞일 때의 재촉", () => {
  const SOON = () => daysFromNow(40);

  it("준비 중이면 기한 위험을 알린다 — 이 분기에 실제로 닿는지부터 고정한다", () => {
    expect(prompt("preparing", SOON())).toContain("기한 위험: D-");
  });

  it("멈추거나 접은 사람에게는 기한 위험을 만들지 않는다", () => {
    for (const status of ["paused", "called_off"] as const) {
      const text = prompt(status, SOON());
      expect(text, status).not.toContain("기한 위험");
      // allowsCountdown이 일부러 지운 D-day 숫자를 이 문장이 되살리면 안 된다.
      // 프롬프트에는 "D-85일이네요! ← 로봇"처럼 하지 말라고 박아둔 예시가 있으므로
      // 이 커플의 실제 카운트다운 형식만 본다.
      expect(text, status).not.toMatch(/\(D-\d+\)/u);
      expect(text, status).not.toMatch(/D-\d+인데/u);
    }
  });

  it("재촉하지 말라는 지시와 재촉 문구가 한 프롬프트에 같이 있지 않다", () => {
    const text = prompt("called_off", SOON());
    expect(text).toContain("다음 할 일을 재촉하지 마세요");
    expect(text).not.toContain("미시작");
  });
});

describe("요청 경로가 준비 상태를 실제로 읽는다", () => {
  // 컬럼과 계약이 있어도 라우트가 안 읽으면 전원이 preparing으로 정규화된다.
  // 그러면 위의 모든 게이트가 프로덕션에서 도달 불가능한 죽은 코드가 된다.
  const chatRoute = readFileSync(
    resolve(process.cwd(), "src/app/api/chat/route.ts"),
    "utf8",
  );

  it("profiles에서 preparation_status를 조회한다", () => {
    expect(chatRoute).toMatch(
      /\.from\("profiles"\)[\s\S]{0,400}?\.select\([^)]*preparation_status/u,
    );
  });

  it("조회한 값을 프롬프트 컨텍스트로 넘긴다", () => {
    expect(chatRoute).toMatch(
      /preparationStatus:\s*normalizePreparationStatus\(/u,
    );
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
