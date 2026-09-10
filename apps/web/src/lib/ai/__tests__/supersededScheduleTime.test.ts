import { describe, expect, it } from "vitest";
import { isSupersededDecision, type CurrentJourneyFacts } from "../supersededDecisions";

const event = { id: "evt-current", date: "2026-09-14", title: "둘이 예산 확인", time: "19:45" };
const facts: CurrentJourneyFacts = { venue: null, events: [event] };
function receipt(time: unknown) {
  return { category: "schedule", title: "둘이 예산 확인", chosenValue: {
    eventId: "evt-current", after: { date: event.date, title: event.title, time },
  } };
}

describe("schedule time supersession", () => {
  it("drops the old receipt after only the saved time changes", () => {
    expect(isSupersededDecision(receipt("19:30"), facts)).toBe(true);
    expect(isSupersededDecision(receipt("19:45"), facts)).toBe(false);
  });
  it("does not revive a removed time from an old receipt", () => {
    const withoutTime = { ...facts, events: [{ ...event, time: null }] };
    expect(isSupersededDecision(receipt("19:30"), withoutTime)).toBe(true);
  });
  it("does not infer a comparison from an unrecorded legacy time or unobserved current time", () => {
    expect(isSupersededDecision(receipt(undefined), facts)).toBe(false);
    const unknownTime = { ...facts, events: [{ id: event.id, date: event.date, title: event.title }] };
    expect(isSupersededDecision(receipt("19:30"), unknownTime)).toBe(false);
  });
  it("does not treat an invalid receipt clock value as a known previous time", () => {
    for (const time of ["25:00", "19:60", "나중", 1930, null, ""]) {
      expect(isSupersededDecision(receipt(time), facts)).toBe(false);
    }
  });
});
