import { describe, expect, it } from "vitest";
import {
  getClientSafeToolInput,
  getClientSafeToolResult,
  getModelSafeToolOutput,
  getPersistableToolResults,
  hasEphemeralPlaceSearchResult,
} from "@/lib/ai/placeSearchResultPolicy";
import type { ToolExecutionResult } from "@/types/database.types";

const placeResult: ToolExecutionResult = {
  toolName: "search_nearby_places",
  toolInput: { query: "강남 상견례 식당" },
  toolOutput: {
    places: [{ name: "외부 입력", address: "서울", imageUrl: "https://example.com/a.jpg" }],
    query: "강남 상견례 식당",
  },
  success: true,
  displayMessage: "검색 결과 1곳을 찾았습니다.",
};

const budgetResult: ToolExecutionResult = {
  toolName: "update_budget",
  toolInput: { total_budget: 30_000_000 },
  toolOutput: { total_budget: 30_000_000 },
  success: true,
  displayMessage: "예산을 변경했습니다.",
};

const cancellationResult: ToolExecutionResult = {
  toolName: "cancel_schedule_event",
  toolInput: {
    event_id: "evt_internal",
    expected_title: "드레스 피팅",
    expected_date: "2026-08-20",
  },
  toolOutput: {
    event: {
      id: "evt_internal",
      date: "2026-08-20",
      title: "드레스 피팅",
      memo: "개인 메모",
      status: "cancelled",
      cancellation: {
        cancelledAt: "2026-08-02T03:04:05.000Z",
        cancelledByProfileId: "11111111-1111-4111-8111-111111111111",
        reason: "업체 일정 변경",
      },
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-08-02T03:04:05.000Z",
    },
    previous_event: {
      id: "evt_internal",
      date: "2026-08-20",
      title: "드레스 피팅",
      status: "planned",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
  },
  success: true,
  displayMessage: "일정을 취소 상태로 남겼어요.",
};

const bookingCancellationResult: ToolExecutionResult = {
  toolName: "cancel_booking",
  toolInput: {
    booking_id: "22222222-2222-4222-8222-222222222222",
    confirmed: true,
  },
  toolOutput: {
    bookingId: "22222222-2222-4222-8222-222222222222",
    vendorName: "아모라 테스트 스튜디오",
    productName: "촬영 상담",
    date: "2026-09-10",
    time: "14:00",
    status: "cancelled",
    internalCancellationRecorded: true,
    vendorCancellationStatus: "unconfirmed",
    quotedAmount: 500_000,
    actualAmount: 300_000,
    amountBasis: "actual",
    cancellation: {
      cancelledAt: "2026-08-02T03:04:05.000Z",
      cancelledByProfileId: "33333333-3333-4333-8333-333333333333",
      reason: "일정 변경",
    },
    scheduleCancelled: true,
    completedSchedulePreserved: true,
    recordedSpendPreserved: true,
    refundStatus: "unknown",
    syncedEvent: {
      id: "evt_booking_22222222-2222-4222-8222-222222222222",
      title: "아모라 예약 요청 기록",
      cancellation: {
        cancelledAt: "2026-08-02T03:04:05.000Z",
        cancelledByProfileId: "33333333-3333-4333-8333-333333333333",
      },
    },
    syncedEventId: "evt_booking_22222222-2222-4222-8222-222222222222",
    projectionStatus: "completed",
    fullyApplied: true,
  },
  success: true,
  displayMessage: "아모라 안 예약 기록을 취소 상태로 표시했어요.",
};

describe("place search result policy", () => {
  it("keeps NAVER results out of persisted chat metadata", () => {
    expect(getPersistableToolResults([placeResult, budgetResult])).toEqual([budgetResult]);
  });

  it("sends only a fixed render status to the model", () => {
    const safeOutput = getModelSafeToolOutput(placeResult);
    expect(safeOutput).toEqual({ success: true, status: "rendered_in_client", resultCount: 1 });
    expect(JSON.stringify(safeOutput)).not.toContain("외부 입력");
    expect(JSON.stringify(safeOutput)).not.toContain("강남");
    expect(JSON.stringify(safeOutput)).not.toContain("http");
  });

  // 2026-09-03: 모델이 자기 검색 결과를 한 글자도 못 봐서 "몇 곳 찾았어?" 에 화면을
  // 보라고 되돌리고, 0곳인데 "카드에서 확인해 주세요" 라고 말했다. 우리가 만든 값
  // 셋만 넘긴다 — 제공자 텍스트는 그대로 막는다.
  it("우리가 만든 값(개수·보정한 질의·조회 시각)만 넘기고 제공자 텍스트는 계속 막는다", () => {
    const emptyOutput = getModelSafeToolOutput({
      ...placeResult,
      toolOutput: {
        places: [],
        query: "청주 한정식",
        resultCount: 0,
        effectiveQuery: "청주 한정식",
        searchedAt: "2026-09-03T11:20:00.000Z",
        provider: "api_hub",
      },
    });
    expect(emptyOutput).toEqual({
      success: true,
      status: "rendered_in_client",
      resultCount: 0,
      effectiveQuery: "청주 한정식",
      searchedAt: "2026-09-03T11:20:00.000Z",
    });

    const richOutput = getModelSafeToolOutput({
      ...placeResult,
      toolOutput: {
        places: [
          { name: "외부 입력", address: "서울", imageUrl: "https://example.com/a.jpg" },
          { name: "외부 입력 2", address: "서울", description: "제공자 설명" },
        ],
        query: "강남 상견례 식당",
        resultCount: 2,
        effectiveQuery: "강남 상견례 한정식",
        searchedAt: "2026-09-03T11:20:00.000Z",
        provider: "api_hub",
      },
    });
    expect(richOutput).toEqual({
      success: true,
      status: "rendered_in_client",
      resultCount: 2,
      effectiveQuery: "강남 상견례 한정식",
      searchedAt: "2026-09-03T11:20:00.000Z",
    });
    const serialized = JSON.stringify(richOutput);
    expect(serialized).not.toContain("외부 입력");
    expect(serialized).not.toContain("제공자 설명");
    expect(serialized).not.toContain("http");
    expect(serialized).not.toContain("api_hub");
  });

  it("detects the result that must lock later tool rounds", () => {
    expect(hasEphemeralPlaceSearchResult([placeResult])).toBe(true);
    expect(hasEphemeralPlaceSearchResult([budgetResult])).toBe(false);
  });

  it("keeps the cancellation actor, internal IDs, and memo out of model and chat metadata", () => {
    const modelOutput = getModelSafeToolOutput(cancellationResult);
    const clientResult = getClientSafeToolResult(cancellationResult);
    const persisted = getPersistableToolResults([cancellationResult]);

    expect(clientResult.displayMessage).toBe(cancellationResult.displayMessage);
    expect(clientResult.success).toBe(true);
    for (const value of [modelOutput, clientResult, persisted]) {
      const serialized = JSON.stringify(value);
      expect(serialized).toContain("드레스 피팅");
      expect(serialized).toContain("업체 일정 변경");
      expect(serialized).not.toContain("evt_internal");
      expect(serialized).not.toContain("11111111-1111-4111-8111-111111111111");
      expect(serialized).not.toContain("개인 메모");
    }
  });

  it("keeps booking cancellation actors and internal booking or schedule IDs out of every chat boundary", () => {
    const modelOutput = getModelSafeToolOutput(bookingCancellationResult);
    const clientInput = getClientSafeToolInput(
      bookingCancellationResult.toolName,
      bookingCancellationResult.toolInput,
    );
    const clientResult = getClientSafeToolResult(bookingCancellationResult);
    const persisted = getPersistableToolResults([bookingCancellationResult]);

    expect(clientResult.displayMessage).toBe(bookingCancellationResult.displayMessage);
    expect(clientResult.success).toBe(true);
    expect(clientInput).toEqual({});
    for (const value of [modelOutput, clientResult, persisted]) {
      const serialized = JSON.stringify(value);
      expect(serialized).toContain("아모라 테스트 스튜디오");
      expect(serialized).toContain("일정 변경");
      expect(serialized).toContain("recordedSpendPreserved");
      expect(serialized).toContain("completedSchedulePreserved");
      expect(serialized).not.toContain("22222222-2222-4222-8222-222222222222");
      expect(serialized).not.toContain("33333333-3333-4333-8333-333333333333");
      expect(serialized).not.toContain("evt_booking_");
      expect(serialized).not.toContain('"confirmed":true');
    }
  });

  // 2026-09-03 스테이징: 같은 문장 2회 중 2회차만 toolOutput.resultCount=0 인데 places 는 5곳이었다.
  // 그 값의 출처는 변형 증명이 서빙 중인 트리를 잠깐 고친 측정 오염이었지만, **모델이 화면과 다른
  // 개수를 말할 수 있다**는 것 자체가 계약의 구멍이다. 카드가 그리는 배열과 모델이 듣는 개수는 하나여야 한다.
  it("카드가 그리는 배열과 모델이 듣는 개수가 갈리지 않는다", () => {
    const divergent = getModelSafeToolOutput({
      ...placeResult,
      toolOutput: {
        places: [
          { name: "라마다대전 에이치가든", address: "대전 유성구 계룡로 127", categoryFull: "음식점>뷔페" },
          { name: "정순란출장부페 지점", address: "청주 상당구 무농정로31번길 8-2", categoryFull: "음식점>뷔페" },
          { name: "크리스탈컨벤션뷔페", address: "대전 서구 둔산대로117번길 127", categoryFull: "음식점>뷔페" },
          { name: "송금화출장뷔페", address: "청주 상당구 신송효촌길 120", categoryFull: "음식점>뷔페" },
          { name: "빌라드파티앤", address: "대전 유성구 대덕대로837번길 31", categoryFull: "서비스,산업>장소대여" },
        ],
        query: "대전이나 청주 예식 뷔페",
        resultCount: 0, // 실행기가 개수를 따로 실어 보내도
        effectiveQuery: "대전 예식 뷔페, 청주 예식 뷔페",
        searchedAt: "2026-09-03T10:26:49.652Z",
        provider: "api_hub",
      },
    });
    expect(divergent.resultCount).toBe(5); // 사용자가 5장을 보는 동안 0곳이라 말하지 않는다
    const serialized = JSON.stringify(divergent);
    expect(serialized).not.toContain("라마다"); // 제공자 텍스트 경계는 그대로
    expect(serialized).not.toContain("api_hub");
  });
});
