import assert from "node:assert/strict";
import test from "node:test";

import {
  mutateScheduleEvent,
  ScheduleEventConflictError,
} from "../src/lib/scheduleEvents.ts";

const Response = globalThis.Response;

const event = {
  id: "evt_mobile_1",
  date: "2026-08-15",
  title: "드레스 가봉",
  time: "14:30",
  createdAt: "2026-07-13T09:00:00.000Z",
  updatedAt: "2026-07-13T09:00:00.000Z",
};

test("mobile schedule add uses the authenticated API boundary and accepts authoritative state", async () => {
  const calls = [];
  const apiFetch = async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify({
      progress: { meeting: { status: "in_progress" }, __events: [event] },
      event,
      eventId: event.id,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await mutateScheduleEvent({ operation: "add", event }, apiFetch);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/journey/schedule-events");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { operation: "add", event });
  assert.deepEqual(result.progress.__events, [event]);
  assert.equal(result.eventId, event.id);
});

test("mobile schedule update sends the stable event id required by the server contract", async () => {
  const calls = [];
  const apiFetch = async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify({
      progress: { __events: [event] },
      event,
      eventId: event.id,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  await mutateScheduleEvent({
    operation: "update",
    eventId: event.id,
    event,
    expectedUpdatedAt: event.updatedAt,
  }, apiFetch);

  assert.deepEqual(JSON.parse(calls[0].options.body), {
    operation: "update",
    eventId: event.id,
    event,
    expectedUpdatedAt: event.updatedAt,
  });
});

test("mobile schedule mutation fails closed when success omits authoritative events", async () => {
  const apiFetch = async () => new Response(JSON.stringify({
    progress: { __events: null },
    event,
    eventId: event.id,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  await assert.rejects(
    mutateScheduleEvent({ operation: "add", event }, apiFetch),
    /저장된 일정 상태를 확인하지 못했습니다/,
  );
});

test("mobile schedule mutation rejects a successful response for a different stable id", async () => {
  const otherEvent = { ...event, id: "evt_mobile_other" };
  const apiFetch = async () => new Response(JSON.stringify({
    progress: { __events: [otherEvent] },
    event: otherEvent,
    eventId: otherEvent.id,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  await assert.rejects(
    mutateScheduleEvent({ operation: "add", event }, apiFetch),
    /저장된 일정 상태를 확인하지 못했습니다/,
  );
});

test("mobile schedule delete sends only the stable id version and confirms removal", async () => {
  const calls = [];
  const apiFetch = async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify({
      progress: { __events: [] },
      event: null,
      eventId: event.id,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await mutateScheduleEvent({
    operation: "delete",
    eventId: event.id,
    expectedUpdatedAt: event.updatedAt,
  }, apiFetch);

  assert.deepEqual(JSON.parse(calls[0].options.body), {
    operation: "delete",
    eventId: event.id,
    expectedUpdatedAt: event.updatedAt,
  });
  assert.equal(result.event, null);
  assert.deepEqual(result.progress.__events, []);
});

test("mobile schedule conflict exposes only validated authoritative state", async () => {
  const latestEvent = {
    ...event,
    title: "파트너가 먼저 바꾼 일정",
    updatedAt: "2026-07-13T09:01:00.000Z",
  };
  const latestProgress = { __events: [latestEvent] };
  const apiFetch = async () => new Response(JSON.stringify({
    error: "다른 기기에서 먼저 변경되었습니다.",
    progress: latestProgress,
  }), {
    status: 409,
    headers: { "Content-Type": "application/json" },
  });

  await assert.rejects(
    mutateScheduleEvent({
      operation: "update",
      eventId: event.id,
      event: { ...event, title: "내 변경" },
      expectedUpdatedAt: event.updatedAt,
    }, apiFetch),
    (error) => {
      assert.ok(error instanceof ScheduleEventConflictError);
      assert.deepEqual(error.progress, latestProgress);
      return true;
    },
  );
});

test("mobile schedule success rejects duplicate stable ids", async () => {
  const apiFetch = async () => new Response(JSON.stringify({
    progress: { __events: [event, { ...event, title: "중복 ID 일정" }] },
    event,
    eventId: event.id,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  await assert.rejects(
    mutateScheduleEvent({ operation: "add", event }, apiFetch),
    /저장된 일정 상태를 확인하지 못했습니다/,
  );
});

test("mobile schedule conflict refuses malformed latest state", async () => {
  const apiFetch = async () => new Response(JSON.stringify({
    error: "다른 기기에서 먼저 변경되었습니다.",
    progress: { __events: [{ ...event, updatedAt: null }] },
  }), {
    status: 409,
    headers: { "Content-Type": "application/json" },
  });

  await assert.rejects(
    mutateScheduleEvent({
      operation: "update",
      eventId: event.id,
      event: { ...event, title: "내 변경" },
      expectedUpdatedAt: event.updatedAt,
    }, apiFetch),
    (error) => {
      assert.equal(error instanceof ScheduleEventConflictError, false);
      assert.match(error.message, /다른 기기에서 먼저 변경/);
      return true;
    },
  );
});
