import assert from "node:assert/strict";
import test from "node:test";

import {
  buildScheduleProgressPatch,
  cancelScheduleEventById,
  isActiveScheduleEvent,
  isCancelledScheduleEvent,
  replaceScheduleEventById,
  restoreScheduleEventById,
  validateScheduleEventDraft,
} from "../lib/scheduleMutation.mjs";

const FIRST_EVENT = Object.freeze({
  id: "evt-first",
  date: "2026-08-10",
  title: "첫 번째 일정",
});
const SECOND_EVENT = Object.freeze({
  id: "evt-second",
  date: "2026-08-11",
  title: "두 번째 일정",
});

test("a mobile schedule patch always carries the exact journey revision", () => {
  assert.deepEqual(
    buildScheduleProgressPatch("11111111-1111-4111-8111-111111111111", 7, [FIRST_EVENT]),
    {
      expected_couple_id: "11111111-1111-4111-8111-111111111111",
      expected_revision: 7,
      progress_patch: { __events: [FIRST_EVENT] },
    },
  );

  for (const revision of [-1, 1.5, "7", Number.MAX_SAFE_INTEGER]) {
    assert.throws(
      () => buildScheduleProgressPatch("11111111-1111-4111-8111-111111111111", revision, [FIRST_EVENT]),
      /INVALID_JOURNEY_REVISION/,
    );
  }

  assert.throws(
    () => buildScheduleProgressPatch("11111111-1111-4111-8111-111111111111", 7, [FIRST_EVENT, FIRST_EVENT]),
    /DUPLICATE_SCHEDULE_EVENT_ID/,
  );
  for (const malformed of [
    { id: "missing-title", date: "2026-08-10" },
    { id: "bad-date", date: "2027-02-29", title: "깨진 일정" },
    { id: "blank-title", date: "2026-08-10", title: "  " },
    { ...FIRST_EVENT, momentType: "future\u200bsupported_moment" },
  ]) {
    assert.throws(
      () => buildScheduleProgressPatch("11111111-1111-4111-8111-111111111111", 7, [malformed]),
      /INVALID_SCHEDULE_EVENT/,
    );
  }
});

test("schedule drafts reject impossible dates, malformed times, and oversized text", () => {
  assert.deepEqual(validateScheduleEventDraft({
    date: "2028-02-29",
    title: " 드레스 피팅 ",
    time: "09:30",
    memo: " 준비물 확인 ",
    categoryKey: "드레스",
  }), {
    ok: true,
    value: {
      date: "2028-02-29",
      title: "드레스 피팅",
      time: "09:30",
      memo: "준비물 확인",
      categoryKey: "드레스",
    },
  });

  for (const [field, draft] of [
    ["date", { date: "2027-02-29", title: "일정" }],
    ["date", { date: "0000-01-01", title: "일정" }],
    ["time", { date: "2028-02-29", title: "일정", time: "24:00" }],
    ["title", { date: "2028-02-29", title: "가".repeat(501) }],
    ["memo", { date: "2028-02-29", title: "일정", memo: "가".repeat(2001) }],
  ]) {
    assert.deepEqual(validateScheduleEventDraft(draft), { ok: false, field });
  }
});

test("schedule drafts carry an explicit bounded care moment into the persisted event", () => {
  assert.deepEqual(validateScheduleEventDraft({
    date: "2028-02-29",
    title: "가족과 저녁 식사",
    momentType: "sanggyeonrye",
  }), {
    ok: true,
    value: {
      date: "2028-02-29",
      title: "가족과 저녁 식사",
      momentType: "sanggyeonrye",
    },
  });

  assert.deepEqual(
    validateScheduleEventDraft({
      date: "2028-02-29",
      title: "기존 중요 일정",
      momentType: "future_supported_moment",
    }),
    {
      ok: true,
      value: {
        date: "2028-02-29",
        title: "기존 중요 일정",
        momentType: "future_supported_moment",
      },
    },
  );
  assert.deepEqual(validateScheduleEventDraft({
    date: "2028-02-29",
    title: "일정",
    momentType: "m".repeat(101),
  }), { ok: false, field: "momentType" });
  assert.deepEqual(validateScheduleEventDraft({
    date: "2028-02-29",
    title: "일정",
    momentType: "future\u200bsupported_moment",
  }), { ok: false, field: "momentType" });
});

test("editing targets the stable event id even after a partner reorders the array", () => {
  const replacement = {
    ...FIRST_EVENT,
    title: "수정된 첫 번째 일정",
  };

  assert.deepEqual(
    replaceScheduleEventById([SECOND_EVENT, FIRST_EVENT], FIRST_EVENT.id, replacement),
    {
      status: "updated",
      events: [SECOND_EVENT, replacement],
    },
  );
});

test("missing or duplicate ids fail closed instead of mutating a different event", () => {
  assert.deepEqual(
    replaceScheduleEventById([FIRST_EVENT], "evt-missing", SECOND_EVENT),
    { status: "missing", events: [FIRST_EVENT] },
  );
  assert.deepEqual(
    replaceScheduleEventById([FIRST_EVENT, FIRST_EVENT], FIRST_EVENT.id, SECOND_EVENT),
    { status: "ambiguous", events: [FIRST_EVENT, FIRST_EVENT] },
  );
  assert.equal(
    cancelScheduleEventById(
      [FIRST_EVENT],
      "evt-missing",
      {
        cancelledAt: "2026-08-02T12:30:00.000Z",
        cancelledByProfileId: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
      },
    ).status,
    "missing",
  );
  assert.deepEqual(
    cancelScheduleEventById(
      [FIRST_EVENT, { id: "broken", date: "not-a-date", title: "깨진 일정" }],
      FIRST_EVENT.id,
      {
        cancelledAt: "2026-08-02T12:30:00.000Z",
        cancelledByProfileId: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
      },
    ),
    {
      status: "invalid",
      events: [FIRST_EVENT, { id: "broken", date: "not-a-date", title: "깨진 일정" }],
    },
  );
});

test("cancelling and restoring preserve the stable event and exact audit contract", () => {
  const cancellation = {
    cancelledAt: "2026-08-02T12:30:00.000Z",
    cancelledByProfileId: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
    reason: "일정 변경",
  };
  const cancelled = cancelScheduleEventById(
    [SECOND_EVENT, { ...FIRST_EVENT, status: "completed", createdAt: "2026-08-01T00:00:00.000Z" }],
    FIRST_EVENT.id,
    cancellation,
  );

  assert.equal(cancelled.status, "updated");
  assert.equal(cancelled.events.length, 2);
  assert.deepEqual(cancelled.events[1], {
    ...FIRST_EVENT,
    status: "cancelled",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: cancellation.cancelledAt,
    cancellation,
  });
  assert.equal(isCancelledScheduleEvent(cancelled.events[1]), true);

  const restored = restoreScheduleEventById(
    cancelled.events,
    FIRST_EVENT.id,
    "2026-08-02T13:00:00.000Z",
  );
  assert.equal(restored.status, "updated");
  assert.deepEqual(restored.events[1], {
    ...FIRST_EVENT,
    status: "planned",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T13:00:00.000Z",
  });
});

test("malformed cancellation audit data is rejected before any journey patch", () => {
  const base = {
    ...FIRST_EVENT,
    status: "cancelled",
    updatedAt: "2026-08-02T12:30:00.000Z",
    cancellation: {
      cancelledAt: "2026-08-02T12:30:00.000Z",
      cancelledByProfileId: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
    },
  };

  assert.doesNotThrow(() => buildScheduleProgressPatch("11111111-1111-4111-8111-111111111111", 7, [base]));
  for (const event of [
    { ...base, cancellation: undefined },
    { ...base, cancellation: { ...base.cancellation, unexpected: true } },
    { ...base, cancellation: { ...base.cancellation, cancelledAt: "bad" } },
    { ...base, cancellation: { ...base.cancellation, cancelledByProfileId: "me" } },
    { ...base, cancellation: { ...base.cancellation, reason: "x".repeat(501) } },
    { ...base, updatedAt: "2026-08-02T12:30:00.001Z" },
    { ...FIRST_EVENT, status: "planned", cancellation: base.cancellation },
  ]) {
    assert.throws(
      () => buildScheduleProgressPatch("11111111-1111-4111-8111-111111111111", 7, [event]),
      /INVALID_SCHEDULE_EVENT_CANCELLATION/,
    );
  }
});

test("restore requires an instant strictly after cancellation, including offset equivalents", () => {
  const cancellation = {
    cancelledAt: "2026-08-02T12:30:00.000Z",
    cancelledByProfileId: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
  };
  const cancelled = cancelScheduleEventById(
    [FIRST_EVENT],
    FIRST_EVENT.id,
    cancellation,
  );

  for (const restoredAt of [
    cancellation.cancelledAt,
    "2026-08-02T21:30:00.000+09:00",
    "2026-08-02T12:29:59.999Z",
  ]) {
    const result = restoreScheduleEventById(
      cancelled.events,
      FIRST_EVENT.id,
      restoredAt,
    );
    assert.equal(result.status, "invalid");
    assert.deepEqual(result.events, cancelled.events);
  }

  assert.equal(restoreScheduleEventById(
    cancelled.events,
    FIRST_EVENT.id,
    "2026-08-02T12:30:00.001Z",
  ).status, "updated");
});

test("active schedule consumers exclude cancelled and malformed cancellation states", () => {
  const cancelled = {
    ...FIRST_EVENT,
    status: "cancelled",
    cancellation: {
      cancelledAt: "2026-08-02T12:30:00.000Z",
      cancelledByProfileId: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
    },
  };

  assert.equal(isActiveScheduleEvent(FIRST_EVENT), true);
  assert.equal(isActiveScheduleEvent({ ...FIRST_EVENT, status: "planned" }), true);
  assert.equal(isActiveScheduleEvent({ ...FIRST_EVENT, status: "completed" }), true);
  assert.equal(isActiveScheduleEvent(cancelled), false);
  assert.equal(isActiveScheduleEvent({ ...cancelled, cancellation: undefined }), false);
  assert.equal(isActiveScheduleEvent({ ...FIRST_EVENT, cancellation: cancelled.cancellation }), false);
  for (const malformed of [
    null,
    {},
    { id: "missing-title", date: FIRST_EVENT.date },
    { id: "bad-date", date: "2027-02-29", title: "깨진 일정" },
    { id: "blank-title", date: FIRST_EVENT.date, title: "  " },
  ]) {
    assert.equal(isActiveScheduleEvent(malformed), false);
  }
});
