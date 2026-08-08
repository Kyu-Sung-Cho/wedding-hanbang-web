import { describe, expect, it } from "vitest";
import {
  addEvent,
  cancelEvent,
  getScheduleEventAssigneeLabel,
  getScheduleEventStatus,
  getEvents,
  isValidScheduleYmd,
  MAX_SCHEDULE_EVENTS,
  ScheduleEventCapacityError,
  ScheduleEventValidationError,
  sanitizeUserFacingScheduleMemo,
  restoreEvent,
  updateEvent,
  upsertCategoryEvent,
  upsertMomentEvent,
  type ScheduleEventDraft,
} from "../scheduleEvents";

function validEvent(index: number) {
  return {
    id: `event-${index}`,
    date: "2026-07-17",
    title: `일정 ${index}`,
    momentType: "dress",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("getEvents", () => {
  it("accepts only real Gregorian YYYY-MM-DD dates", () => {
    expect(isValidScheduleYmd("2028-02-29")).toBe(true);
    expect(isValidScheduleYmd("2000-02-29")).toBe(true);
    expect(isValidScheduleYmd("1900-02-29")).toBe(false);
    expect(isValidScheduleYmd("2027-02-29")).toBe(false);
    expect(isValidScheduleYmd("2027-02-31")).toBe(false);
    expect(isValidScheduleYmd("2027-04-31")).toBe(false);
    expect(isValidScheduleYmd("0000-01-01")).toBe(false);
    expect(isValidScheduleYmd("2027-2-01")).toBe(false);
  });

  it("fails closed when the reserved event slot is not an array", () => {
    expect(getEvents({ __events: { poisoned: true } })).toEqual([]);
    expect(getEvents({ __events: "poisoned" })).toEqual([]);
  });

  it("filters non-records and malformed date or momentType fields", () => {
    const valid = validEvent(1);
    expect(getEvents({
      __events: [
        null,
        "not-an-event",
        { ...valid, date: "2026-02-31" },
        { ...valid, momentType: 123 },
        valid,
      ],
    })).toEqual([valid]);
  });

  it("requires every durable field and bounds optional fields", () => {
    const valid = validEvent(2);
    expect(getEvents({
      __events: [
        { ...valid, id: "" },
        { ...valid, title: "   " },
        { ...valid, createdAt: undefined },
        { ...valid, updatedAt: "not-a-timestamp" },
        { ...valid, memo: "m".repeat(2_001) },
        { ...valid, categoryKey: null },
        { ...valid, sourceKey: "s".repeat(201) },
        valid,
      ],
    })).toEqual([valid]);
  });

  it("keeps legacy events compatible and treats a missing status as planned", () => {
    const legacy = validEvent(3);

    expect(getEvents({ __events: [legacy] })).toEqual([legacy]);
    expect(getScheduleEventStatus(legacy)).toBe("planned");
  });

  it("accepts only the exact cancellation contract and never treats it as planned", () => {
    const cancellation = {
      cancelledAt: "2026-08-02T12:30:00.000Z",
      cancelledByProfileId: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
      reason: "일정이 변경됨",
    };
    const cancelled = {
      ...validEvent(31),
      status: "cancelled",
      cancellation,
      updatedAt: cancellation.cancelledAt,
    } as const;

    expect(getEvents({ __events: [cancelled] })).toEqual([cancelled]);
    expect(getScheduleEventStatus(cancelled)).toBe("cancelled");
    expect(getEvents({
      __events: [
        { ...cancelled, cancellation: undefined },
        { ...cancelled, cancellation: { ...cancellation, unexpected: true } },
        { ...cancelled, cancellation: { ...cancellation, cancelledAt: "not-iso" } },
        { ...cancelled, cancellation: { ...cancellation, cancelledByProfileId: "me" } },
        { ...cancelled, cancellation: { ...cancellation, reason: "a".repeat(501) } },
        { ...cancelled, cancellation: { ...cancellation, reason: "unsafe\nreason" } },
        { ...cancelled, updatedAt: "2026-08-02T12:30:00.001Z" },
        { ...validEvent(32), status: "planned", cancellation },
        { ...validEvent(33), status: "completed", cancellation },
      ],
    })).toEqual([]);
  });

  it("accepts canonical execution fields without copying profile names", () => {
    const event = {
      ...validEvent(4),
      status: "completed",
      completionCriteria: "계약서 확인과 예약금 입금까지",
      assignee: {
        kind: "member",
        profileId: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
      },
    } as const;

    expect(getEvents({ __events: [event] })).toEqual([event]);
    expect(JSON.stringify(event.assignee)).not.toContain("지은");
    expect(getScheduleEventStatus(event)).toBe("completed");
  });

  it("accepts a canonical local time and rejects impossible clock values", () => {
    const timed = { ...validEvent(41), time: "09:30" };
    expect(getEvents({ __events: [timed] })).toEqual([timed]);
    expect(getEvents({
      __events: [
        { ...validEvent(42), time: "24:00" },
        { ...validEvent(43), time: "9:30" },
        { ...validEvent(44), time: 930 },
      ],
    })).toEqual([]);

    expect(addEvent({}, {
      date: "2027-05-01",
      title: "시간 있는 일정",
      time: "18:05",
    }).newEvent.time).toBe("18:05");
  });

  it.each([
    { status: "doing" },
    { completionCriteria: "c".repeat(501) },
    { assignee: "me" },
    { assignee: { kind: "member", profileId: "current-user" } },
    { assignee: { kind: "couple", profileId: "unexpected" } },
    { assignee: { kind: "external", label: "  " } },
    { assignee: { kind: "external", label: "가".repeat(81) } },
    { assignee: { kind: "external", label: "가족\u200b담당" } },
    { completionCriteria: "확인\n입금" },
  ] as const)("fails closed on malformed execution fields: %s", (extension) => {
    expect(getEvents({
      __events: [{ ...validEvent(5), ...extension }],
    })).toEqual([]);
  });

  it("bounds attacker-controlled event arrays", () => {
    const events = Array.from(
      { length: MAX_SCHEDULE_EVENTS + 20 },
      (_, index) => validEvent(index),
    );
    expect(getEvents({ __events: events })).toHaveLength(MAX_SCHEDULE_EVENTS);
  });

  it("refuses a new event at the durable 500-event boundary", () => {
    const events = Array.from(
      { length: MAX_SCHEDULE_EVENTS },
      (_, index) => validEvent(index),
    );

    expect(() => addEvent(
      { __events: events },
      { date: "2026-07-18", title: "One too many" },
    )).toThrow(ScheduleEventCapacityError);
    expect(events).toHaveLength(MAX_SCHEDULE_EVENTS);
  });

  it("refuses to mutate an already over-cap array instead of truncating unseen events", () => {
    const events = Array.from(
      { length: MAX_SCHEDULE_EVENTS + 1 },
      (_, index) => ({
        ...validEvent(index),
        ...(index === 0 ? { momentType: "dress_tour", date: "2027-05-01" } : {}),
      }),
    );

    expect(() => upsertMomentEvent(
      { __events: events },
      { momentType: "dress_tour", date: "2027-05-01", title: "Updated" },
    )).toThrow(ScheduleEventCapacityError);
  });

  it.each([
    [{ date: "2027-02-29", title: "Invalid date" }, "date"],
    [{ date: "2027-05-01", title: "   " }, "title"],
    [{ date: "2027-05-01", title: "Valid", memo: "m".repeat(2_001) }, "memo"],
    [{ date: "2027-05-01", title: "Valid", categoryKey: "c".repeat(101) }, "categoryKey"],
    [{ date: "2027-05-01", title: "Valid", time: "24:00" }, "time"],
    [{ date: "2027-05-01", title: "Valid", status: "doing" }, "status"],
    [{
      date: "2027-05-01",
      title: "Valid",
      assignee: { kind: "member", profileId: "partner" },
    }, "assignee"],
  ] as const)("refuses an invalid event draft field: %s", (draft, field) => {
    expect(() => addEvent({}, draft as unknown as ScheduleEventDraft)).toThrow(
      expect.objectContaining<Partial<ScheduleEventValidationError>>({ field }),
    );
  });

  it("stores a member assignment by immutable profile id and preserves it on update", () => {
    const profileId = "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2";
    const { newProgress, newEvent } = addEvent(
      {},
      {
        date: "2027-05-01",
        title: "드레스 최종 확인",
        status: "planned",
        completionCriteria: "수선 결과 확인",
        assignee: { kind: "member", profileId },
      },
    );

    expect(newEvent.assignee).toEqual({ kind: "member", profileId });
    expect(getScheduleEventAssigneeLabel(newEvent.assignee, {
      viewer: { id: profileId, name: "지은" },
      partner: {
        id: "4ed560aa-52e6-47d2-9595-612d0bfe2c7b",
        name: "수현",
      },
    })).toBe("지은 (나)");
    expect(getScheduleEventAssigneeLabel(newEvent.assignee, {
      viewer: {
        id: "4ed560aa-52e6-47d2-9595-612d0bfe2c7b",
        name: "수현",
      },
      partner: { id: profileId, name: "지은" },
    })).toBe("지은 (파트너)");

    const updated = updateEvent(newProgress, newEvent.id, {
      status: "completed",
    });
    expect(getEvents(updated)[0]).toMatchObject({
      assignee: { kind: "member", profileId },
      status: "completed",
      completionCriteria: "수선 결과 확인",
    });
  });

  it("soft-cancels and restores one stable id while preserving audit fields and unrelated progress", () => {
    const first = {
      ...validEvent(61),
      status: "completed" as const,
      memo: "keep me",
    };
    const second = validEvent(62);
    const progress = {
      __events: [first, second],
      unrelated: { status: "in_progress", spent: 123 },
    };
    const cancellation = {
      cancelledAt: "2026-08-02T12:30:00.000Z",
      cancelledByProfileId: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
      reason: "일정 변경",
    };

    const cancelledProgress = cancelEvent(progress, first.id, cancellation);
    expect(cancelledProgress.unrelated).toEqual(progress.unrelated);
    expect(getEvents(cancelledProgress)).toEqual([
      {
        ...first,
        status: "cancelled",
        cancellation,
        createdAt: first.createdAt,
        updatedAt: cancellation.cancelledAt,
      },
      second,
    ]);

    const restoredProgress = restoreEvent(
      cancelledProgress,
      first.id,
      "2026-08-02T13:00:00.000Z",
    );
    expect(getEvents(restoredProgress)[0]).toEqual({
      ...first,
      status: "planned",
      createdAt: first.createdAt,
      updatedAt: "2026-08-02T13:00:00.000Z",
    });
    expect(getEvents(restoredProgress)[0]).not.toHaveProperty("cancellation");
  });

  it("fails closed when a cancel or restore target is missing or duplicated", () => {
    const duplicate = validEvent(71);
    const cancellation = {
      cancelledAt: "2026-08-02T12:30:00.000Z",
      cancelledByProfileId: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
    };

    expect(() => cancelEvent({ __events: [duplicate] }, "missing", cancellation))
      .toThrow(ScheduleEventValidationError);
    expect(() => cancelEvent({ __events: [duplicate, duplicate] }, duplicate.id, cancellation))
      .toThrow(ScheduleEventValidationError);
    expect(() => restoreEvent({ __events: [duplicate] }, duplicate.id, cancellation.cancelledAt))
      .toThrow(ScheduleEventValidationError);
  });

  it("restores only at an instant strictly after the cancellation", () => {
    const event = validEvent(79);
    const cancellation = {
      cancelledAt: "2026-08-02T12:30:00.000Z",
      cancelledByProfileId: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
    };
    const cancelledProgress = cancelEvent(
      { __events: [event] },
      event.id,
      cancellation,
    );

    for (const restoredAt of [
      cancellation.cancelledAt,
      "2026-08-02T21:30:00.000+09:00",
      "2026-08-02T12:29:59.999Z",
    ]) {
      expect(() => restoreEvent(cancelledProgress, event.id, restoredAt))
        .toThrow(ScheduleEventValidationError);
    }

    expect(getEvents(restoreEvent(
      cancelledProgress,
      event.id,
      "2026-08-02T12:30:00.001Z",
    ))[0]).toMatchObject({
      id: event.id,
      status: "planned",
      updatedAt: "2026-08-02T12:30:00.001Z",
    });
  });

  it("never reuses a cancelled category event as an active schedule", () => {
    const cancelled = {
      ...validEvent(81),
      categoryKey: "studio",
      sourceKey: "category:studio",
      status: "cancelled" as const,
      cancellation: {
        cancelledAt: "2026-08-02T12:30:00.000Z",
        cancelledByProfileId: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
      },
      updatedAt: "2026-08-02T12:30:00.000Z",
    };

    const result = upsertCategoryEvent(
      { __events: [cancelled] },
      { date: "2027-05-20", title: "스튜디오", categoryKey: "studio" },
      "스튜디오",
    );

    expect(result.created).toBe(true);
    expect(getEvents(result.newProgress)).toHaveLength(2);
    expect(getScheduleEventStatus(getEvents(result.newProgress)[0])).toBe("cancelled");
    expect(getScheduleEventStatus(result.event)).toBe("planned");
  });

  it("never edits a cancelled moment event when recreating the same moment", () => {
    const cancelled = {
      ...validEvent(82),
      momentType: "sanggyeonrye",
      status: "cancelled" as const,
      cancellation: {
        cancelledAt: "2026-08-02T12:30:00.000Z",
        cancelledByProfileId: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
      },
      updatedAt: "2026-08-02T12:30:00.000Z",
    };

    const result = upsertMomentEvent(
      { __events: [cancelled] },
      {
        date: cancelled.date,
        title: "다시 잡은 상견례",
        momentType: "sanggyeonrye",
      },
    );

    expect(result.created).toBe(true);
    expect(result.event.id).not.toBe(cancelled.id);
    expect(getEvents(result.newProgress)).toHaveLength(2);
    expect(getScheduleEventStatus(getEvents(result.newProgress)[0])).toBe("cancelled");
    expect(getScheduleEventStatus(getEvents(result.newProgress)[1])).toBe("planned");
  });

  it("formats unassigned, couple, external, and disconnected-member labels safely", () => {
    const context = {
      viewer: {
        id: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
        name: "지은",
      },
    };

    expect(getScheduleEventAssigneeLabel(undefined, context)).toBe("담당 미정");
    expect(getScheduleEventAssigneeLabel({ kind: "couple" }, context)).toBe("함께");
    expect(getScheduleEventAssigneeLabel(
      { kind: "external", label: "웨딩 플래너" },
      context,
    )).toBe("외부 · 웨딩 플래너");
    expect(getScheduleEventAssigneeLabel(
      {
        kind: "member",
        profileId: "4ed560aa-52e6-47d2-9595-612d0bfe2c7b",
      },
      context,
    )).toBe("연결이 끊긴 기존 담당자");
  });
});

describe("sanitizeUserFacingScheduleMemo", () => {
  it("removes a legacy booking id while preserving the useful amount", () => {
    expect(sanitizeUserFacingScheduleMemo(
      "예약 자동 등록 · booking 018f4dc8 · 15,000원",
    )).toBe("예약 자동 등록 · 15,000원");
  });

  it("removes a full legacy UUID when there is no suffix", () => {
    expect(sanitizeUserFacingScheduleMemo(
      "예약 자동 등록 · booking 018f4dc8-0ac2-7df5-9f5d-2e8fd1c43b21",
    )).toBe("예약 자동 등록");
  });

  it.each([
    undefined,
    "예약 자동 등록 · 담당자에게 확인",
    "booking 018f4dc8 관련 메모",
    "예약 자동 등록 · booking reference 확인",
  ])("does not rewrite unrelated memo text: %s", (memo) => {
    expect(sanitizeUserFacingScheduleMemo(memo)).toBe(memo);
  });
});
