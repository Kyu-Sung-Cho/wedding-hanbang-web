import { describe, expect, it } from "vitest";

import {
  getScheduleEventMutationBlockReason,
  SCHEDULE_EVENT_REPAIR_MESSAGE,
} from "./ScheduleContent";

describe("schedule event mutation integrity", () => {
  const validEvent = {
    id: "event-1",
    date: "2027-05-01",
    title: "스튜디오",
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
  };

  it("allows a fully valid stored event array", () => {
    expect(
      getScheduleEventMutationBlockReason({ __events: [validEvent] }),
    ).toBeNull();
  });

  it.each([
    ["a malformed container", { __events: { event: validEvent } }],
    [
      "a rejected legacy event",
      {
        __events: [
          validEvent,
          {
            id: "legacy-event",
            date: "2027-06-01",
            title: "레거시 일정",
          },
        ],
      },
    ],
    [
      "a truncated event array",
      {
        __events: Array.from({ length: 501 }, (_, index) => ({
          ...validEvent,
          id: `event-${index}`,
        })),
      },
    ],
  ])("blocks writes for %s instead of rebuilding a filtered array", (_label, progress) => {
    expect(getScheduleEventMutationBlockReason(progress)).toBe(
      SCHEDULE_EVENT_REPAIR_MESSAGE,
    );
  });
});
