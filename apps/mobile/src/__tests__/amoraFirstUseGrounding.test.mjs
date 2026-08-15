import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAmoraFirstUseGrounding,
  parseAmoraFirstUseGrounding,
} from "../../../../packages/shared/src/contracts/amoraFirstUseGrounding.mjs";

test("a customer with no planning knowledge gets three concrete things Amora can clarify", () => {
  assert.deepEqual(buildAmoraFirstUseGrounding({
    sourceRevision: 4,
    todayYmd: "2026-08-14",
    weddingDate: null,
    budget: 0,
    venue: null,
    progress: {},
    scheduleEvents: [],
  }), {
    version: 1,
    sourceRevision: 4,
    confirmed: [],
    unknowns: [
      { key: "current_progress", label: "이미 마친 준비와 아직 남은 준비" },
      { key: "wedding_date", label: "결혼식 날짜" },
      { key: "next_schedule", label: "가장 가까운 중요한 일정" },
    ],
  });
});

test("a customer already preparing sees exact saved progress instead of a generic stage label", () => {
  assert.deepEqual(buildAmoraFirstUseGrounding({
    sourceRevision: 9,
    todayYmd: "2026-08-14",
    weddingDate: "2027-05-22",
    budget: 30_000_000,
    venue: "정원홀",
    progress: {
      venue: {
        checklist: [
          { id: "venue_01", label: "원하는 결혼식장 형태 정하기", done: true },
          { id: "venue_02", label: "비교할 장소 후보 정리", done: false },
        ],
      },
    },
    scheduleEvents: [
      { date: "2026-08-10", title: "지난 일정" },
      { date: "2026-08-20", title: "부모님 첫 만남" },
      { date: "2026-09-01", title: "웨딩 사진 촬영" },
    ],
  }), {
    version: 1,
    sourceRevision: 9,
    confirmed: [
      { key: "wedding_date", label: "결혼식 날짜: 2027-05-22" },
      { key: "next_schedule", label: "다음 일정: 2026-08-20 · 부모님 첫 만남" },
      {
        key: "current_progress",
        label: "저장한 체크리스트: 1/2 완료 · 남아 있는 항목: 비교할 장소 후보 정리",
      },
    ],
    unknowns: [],
  });
});

test("personalized facts keep the exact saved budget and a normal joined wedding emoji", () => {
  assert.deepEqual(buildAmoraFirstUseGrounding({
    sourceRevision: 10,
    todayYmd: "2026-08-14",
    weddingDate: null,
    budget: 30_000_000,
    venue: "정원홀",
    progress: {},
    scheduleEvents: [
      { date: "2026-08-20", title: "👰‍♀️ 드레스 피팅" },
    ],
  }), {
    version: 1,
    sourceRevision: 10,
    confirmed: [
      { key: "next_schedule", label: "다음 일정: 2026-08-20 · 👰‍♀️ 드레스 피팅" },
      { key: "total_budget", label: "전체 예산: 30,000,000원" },
      { key: "venue", label: "결혼식장: 정원홀" },
    ],
    unknowns: [
      { key: "current_progress", label: "이미 마친 준비와 아직 남은 준비" },
      { key: "wedding_date", label: "결혼식 날짜" },
    ],
  });
});

test("a completed checklist never invents a remaining preparation item", () => {
  const grounding = buildAmoraFirstUseGrounding({
    sourceRevision: 11,
    todayYmd: "2026-08-14",
    weddingDate: "2027-05-22",
    budget: 0,
    venue: null,
    progress: {
      meeting: {
        checklist: [
          { id: "meeting_01", label: "양쪽 부모님 첫 만남 날짜 조율", done: true },
          { id: "meeting_02", label: "만날 장소 정하고 예약", done: true },
        ],
      },
    },
    scheduleEvents: [],
  });

  assert.deepEqual(
    grounding?.confirmed.find((item) => item.key === "current_progress"),
    { key: "current_progress", label: "저장한 체크리스트: 2/2 완료" },
  );
});

test("only a strict grounding envelope from the same wedding revision reaches the action card", () => {
  const value = {
    version: 1,
    sourceRevision: 9,
    confirmed: [
      { key: "wedding_date", label: "결혼식 날짜: 2027-05-22" },
    ],
    unknowns: [
      { key: "current_progress", label: "이미 마친 준비와 아직 남은 준비" },
    ],
  };

  assert.deepEqual(parseAmoraFirstUseGrounding(value, 9), value);
  assert.equal(parseAmoraFirstUseGrounding(value, 10), null);
  assert.equal(parseAmoraFirstUseGrounding({ ...value, privateNote: "do not leak" }, 9), null);
  assert.equal(parseAmoraFirstUseGrounding({
    ...value,
    confirmed: [{ key: "wedding_date", label: "결혼식 날짜\u202e" }],
  }, 9), null);
});
