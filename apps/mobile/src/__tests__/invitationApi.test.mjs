// 청첩장 디자인(2026-11-17 파운더 디자인 아티팩트, 원문: 이 디자인 완전 같아야해) 실제 커플 API 층.
//
// `src/lib/invitationApi.mjs` 를 가짜 fetcher 로 직접 부른다. 지키는 것:
//   - 성공·빈 상태·오류·409(편지 판이 바뀜)·보내기 스위치 꺼짐을 화면이 구별할 수 있게 넘긴다. 던지지 않는다.
//   - 응답 모양이 틀리면 그리지 않는다(모르는 화면 이름이 오면 누르는 순간 앱이 멈춘다).
//   - 서버가 받지 않을 값은 보내지 않는다(홀 ID·지문·정렬·조건 칸).
//   - 화면이 하는 판정(편지가 바뀌었나, 저장한 판이 보던 것과 같나, 승인 결과의 한 줄)이 맞다.
import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPARE_SORT_IDS,
  cleanConditionsPatch,
  createInvitationApi,
  firstChatConditionsPatch,
  firstChatYearForMonth,
  isLetterDirty,
  isLetterVersionChanged,
  journeyWithPlan,
  kstYearMonth,
  letterApprovalNotice,
  letterSaveBody,
  letterShareFlags,
  letterStateNotice,
  sameVisibleLetter,
  toggledJourneyPlan,
} from "../lib/invitationApi.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));
const HALL = "aaaaaaaa-1111-4111-8111-111111111111";
const HALL_2 = "bbbbbbbb-2222-4222-8222-222222222222";
const VERSION = "cccccccc-3333-4333-8333-333333333333";
const REPLY = "dddddddd-4444-4444-8444-444444444444";
const FINGERPRINT = "f".repeat(64);

/** 부른 순서대로 답을 돌려주는 가짜 fetcher. 부른 경로·방법·본문을 적는다. */
function fakeFetcher(responses) {
  const calls = [];
  const queue = [...responses];
  const fetcher = async (path, init) => {
    calls.push({ path, method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request ${init.method} ${path}`);
    if (next instanceof Error) throw next;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => {
        if (next.body === undefined) throw new SyntaxError("no body");
        return next.body;
      },
    };
  };
  return { fetcher, calls };
}

const facts = { firstName: "가", secondName: "나", year: 2027, month: 5, day: null, timeLabel: null, venueName: null };
const homeBody = {
  home: {
    people: [{ initial: "가", name: "가" }],
    invitation: facts,
    update: null,
    decisions: [{ id: "a1", title: "합성 할 일", sub: null, owner: { kind: "together" }, target: "letter" }],
  },
  degraded: [],
};

const letterModel = {
  recipients: ["합성 홀"],
  dateLabel: "11. 17",
  body: "합성 편지 본문",
  signature: "가와 나 드림",
  shares: [
    { key: "name", label: "이름", value: "가", on: true },
    { key: "phone", label: "휴대폰 번호", value: "", on: false },
    { key: "budget", label: "예산", value: "아직 정하지 않았다고 알려요", on: false },
  ],
  partnerApprovedName: null,
  backdropPhoto: null,
};
const letterState = {
  letterId: null,
  versionId: VERSION,
  version: 1,
  fingerprint: FINGERPRINT,
  status: "draft",
  approver: { mode: "unset", designatedUserId: null, revision: 0 },
  approvedBy: [],
  waitingFor: ["user-a", "user-b"],
  viewerCanApprove: true,
  viewerIsApprover: true,
  sendingEnabled: false,
  notQueuedReason: null,
  recipients: [{ hallId: HALL, name: "합성 홀" }],
};

test("a home read hands the server's model through untouched and keeps the degraded flag", async () => {
  const { fetcher, calls } = fakeFetcher([{ status: 200, body: { ...homeBody, degraded: ["decisions"] } }]);
  const result = await createInvitationApi(fetcher).home();
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.home, homeBody.home);
  assert.deepEqual(result.data.degraded, ["decisions"]);
  assert.deepEqual(calls, [{ path: "/api/invitation/home", method: "GET", body: undefined }]);
});

test("who did each step travels with the home, and an older server without it reads as no labels", async () => {
  const steps = [{ actor: "operator", text: "업체에 보냈어요" }, { actor: "amora", text: "3곳을 비교했어요" }];
  const withSteps = await createInvitationApi(fakeFetcher([{ status: 200, body: { ...homeBody, updateSteps: steps } }]).fetcher).home();
  assert.deepEqual(withSteps.data.updateSteps, steps);
  const older = await createInvitationApi(fakeFetcher([{ status: 200, body: homeBody }]).fetcher).home();
  assert.deepEqual(older.data.updateSteps, []);
  // 모르는 주어는 그리지 않는다. 담당자의 일을 누구의 일로도 짐작해 붙이지 않는다.
  const unknownActor = await createInvitationApi(fakeFetcher([{ status: 200, body: { ...homeBody, updateSteps: [{ actor: "system", text: "x" }] } }]).fetcher).home();
  assert.equal(unknownActor.reason, "invalid");
});

test("an unknown destination or a malformed model is refused instead of drawn", async () => {
  const unknownTarget = clone(homeBody);
  unknownTarget.home.decisions[0].target = "settings";
  const noOwner = clone(homeBody);
  delete noOwner.home.decisions[0].owner;
  const numberName = clone(homeBody);
  numberName.home.invitation.firstName = 7;
  for (const body of [unknownTarget, noOwner, numberName, { home: null, degraded: [] }, null]) {
    const { fetcher } = fakeFetcher([{ status: 200, body }]);
    const result = await createInvitationApi(fetcher).home();
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid");
  }
});

test("server errors keep their status, code and human sentence; the network never throws through", async () => {
  const api = (responses) => createInvitationApi(fakeFetcher(responses).fetcher);
  const http = await api([{ status: 503, body: { error: "홈을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.", code: "HOME_UNAVAILABLE" } }]).home();
  assert.deepEqual(http, { ok: false, reason: "http", status: 503, code: "HOME_UNAVAILABLE", message: "홈을 불러오지 못했어요. 잠시 후 다시 시도해 주세요." });
  // 본문이 없거나 사람에게 보일 수 없는 문장(제어 문자·너무 긺)이면 문장은 버린다. 화면은 공유 문구로 대신 말한다.
  const noBody = await api([{ status: 500 }]).home();
  assert.deepEqual(noBody, { ok: false, reason: "http", status: 500, code: null, message: null });
  const unsafe = await api([{ status: 400, body: { error: "줄 바꿈", code: "X" } }]).home();
  assert.equal(unsafe.message, null);
  const long = await api([{ status: 400, body: { error: "가".repeat(201), code: "X" } }]).home();
  assert.equal(long.message, null);
  // 요청이 닿지 않았다(앱 API 헬퍼가 던짐: 세션 소유자가 바뀜 등).
  const offline = await api([new Error("API_SESSION_OWNER_MISMATCH")]).home();
  assert.deepEqual(offline, { ok: false, reason: "network", status: 0, code: null, message: null });
});

test("an empty comparison is a real answer: no conditions yet, or no checked halls", async () => {
  const needConditions = { compare: null, missing: ["guests", "region"], sort: "total", pickedCount: 0, sources: [] };
  const noHalls = { compare: { guests: 200, month: 5, halls: [], sourceDateLabel: null }, missing: [], sort: "total", pickedCount: 0, sources: [] };
  for (const body of [needConditions, noHalls]) {
    const { fetcher, calls } = fakeFetcher([{ status: 200, body }]);
    const result = await createInvitationApi(fetcher).halls("total");
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, body);
    assert.equal(calls[0].path, "/api/invitation/halls?sort=total");
  }
  // 정렬은 고를 수 있는 넷만 보낸다.
  assert.deepEqual([...COMPARE_SORT_IDS], ["total", "transit", "minimum", "mood"]);
  const { fetcher, calls } = fakeFetcher([]);
  const refused = await createInvitationApi(fetcher).halls("price; drop");
  assert.equal(refused.reason, "input");
  assert.equal(calls.length, 0);
});

test("shortlist toggles post or delete for a hall id, and refuse anything that is not a hall id", async () => {
  const { fetcher, calls } = fakeFetcher([
    { status: 200, body: { hallId: HALL, picked: true, pickedCount: 1 } },
    { status: 200, body: { hallId: HALL, picked: false, pickedCount: 0 } },
    { status: 409, body: { error: "상담 후보는 10곳까지 담을 수 있어요.", code: "SHORTLIST_FULL" } },
  ]);
  const api = createInvitationApi(fetcher);
  assert.equal((await api.setHallPicked(HALL.toUpperCase(), true)).data.picked, true);
  assert.equal((await api.setHallPicked(HALL, false)).data.pickedCount, 0);
  const full = await api.setHallPicked(HALL_2, true);
  assert.equal(full.status, 409);
  assert.equal(full.code, "SHORTLIST_FULL");
  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ["POST", `/api/invitation/halls/${HALL}/shortlist`],
    ["DELETE", `/api/invitation/halls/${HALL}/shortlist`],
    ["POST", `/api/invitation/halls/${HALL_2}/shortlist`],
  ]);
  for (const bad of ["../letter", `${HALL}/../x`, "", null]) {
    const { fetcher: none, calls: noCalls } = fakeFetcher([]);
    assert.equal((await createInvitationApi(none).setHallPicked(bad, true)).reason, "input");
    assert.equal(noCalls.length, 0);
  }
});

test("a letter approval sends exactly the version and fingerprint, and 409 version-changed is told apart", async () => {
  const approved = {
    result: { status: "approved_not_queued", notQueuedReason: "sending_disabled", queuedCount: 0, duplicateHallIds: [], waitingFor: [] },
    letter: { letter: letterModel, state: { ...letterState, status: "approved_not_queued", notQueuedReason: "sending_disabled" }, missing: [] },
  };
  const { fetcher, calls } = fakeFetcher([
    { status: 200, body: approved },
    { status: 409, body: { error: "편지 내용이 바뀌었어요. 바뀐 편지를 다시 확인해 주세요.", code: "LETTER_VERSION_CHANGED" } },
    { status: 409, body: { error: "받는 홀이 바뀌었어요.", code: "RECIPIENTS_UNAVAILABLE" } },
  ]);
  const api = createInvitationApi(fetcher);
  const ok = await api.approveLetter({ versionId: VERSION, fingerprint: FINGERPRINT, extra: "x" });
  assert.equal(ok.ok, true);
  assert.deepEqual(calls[0], { path: "/api/invitation/letter/approve", method: "POST", body: { versionId: VERSION, fingerprint: FINGERPRINT } });
  // 보내기 스위치가 꺼져 있으면 승인만 저장됐다고 사실대로 말한다.
  assert.deepEqual(letterApprovalNotice(ok.data.result), { kind: "approvedNotSent" });
  const changed = await api.approveLetter({ versionId: VERSION, fingerprint: FINGERPRINT });
  assert.equal(isLetterVersionChanged(changed), true);
  const other409 = await api.approveLetter({ versionId: VERSION, fingerprint: FINGERPRINT });
  assert.equal(isLetterVersionChanged(other409), false);
  assert.equal(isLetterVersionChanged({ ok: true, data: {} }), false);
  // 지문이 아닌 값은 보내지 않는다.
  const { fetcher: none, calls: noCalls } = fakeFetcher([]);
  assert.equal((await createInvitationApi(none).approveLetter({ versionId: VERSION, fingerprint: "abc" })).reason, "input");
  assert.equal((await createInvitationApi(none).approveLetter({ versionId: "v1", fingerprint: FINGERPRINT })).reason, "input");
  assert.equal(noCalls.length, 0);
});

test("every approval outcome maps to the sentence the couple should read", () => {
  const base = { notQueuedReason: null, queuedCount: 0, duplicateHallIds: [], waitingFor: [] };
  assert.deepEqual(letterApprovalNotice({ ...base, status: "queued", queuedCount: 2 }), { kind: "queued", count: 2 });
  assert.deepEqual(letterApprovalNotice({ ...base, status: "queued", duplicateHallIds: [HALL] }), { kind: "alreadySent" });
  assert.deepEqual(letterApprovalNotice({ ...base, status: "approved_not_queued", notQueuedReason: "sending_disabled" }), { kind: "approvedNotSent" });
  assert.deepEqual(letterApprovalNotice({ ...base, status: "approved_not_queued", notQueuedReason: "daily_cap" }), { kind: "dailyCap" });
  assert.deepEqual(letterApprovalNotice({ ...base, status: "approved_not_queued", notQueuedReason: "approver_unavailable" }), { kind: "approverUnavailable" });
  assert.deepEqual(letterApprovalNotice({ ...base, status: "awaiting_approval", waitingFor: ["user-b"] }), { kind: "waiting", userIds: ["user-b"] });
  // 불러온 판이 이미 말해야 하는 것.
  assert.deepEqual(letterStateNotice({ ...letterState, status: "approved_not_queued", notQueuedReason: "sending_disabled" }), { kind: "approvedNotSent" });
  assert.deepEqual(letterStateNotice({ ...letterState, status: "awaiting_approval", approvedBy: ["user-a"], waitingFor: ["user-b"] }), { kind: "waiting", userIds: ["user-b"] });
  assert.equal(letterStateNotice(letterState), null, "아직 아무도 승인하지 않은 초안에는 할 말이 없다");
});

test("a letter edit is saved as a new version with the masked phone left to the server", () => {
  const flags = letterShareFlags(letterModel);
  assert.deepEqual(flags, { name: true, phone: false, budget: false });
  assert.equal(isLetterDirty(letterModel, letterModel.body, flags), false);
  assert.equal(isLetterDirty(letterModel, `${letterModel.body} 추가`, flags), true);
  assert.equal(isLetterDirty(letterModel, letterModel.body, { ...flags, budget: true }), true);
  const body = letterSaveBody(letterState, letterModel, "고친 본문", { name: true, phone: true, budget: true });
  assert.deepEqual(body, {
    letterId: null,
    recipientHallIds: [HALL],
    body: "고친 본문",
    shares: { name: { on: true, value: "가" }, phone: { on: true, value: null }, budget: { on: true } },
  });
  // 이름을 끄면 이름 값을 보내지 않는다.
  assert.deepEqual(letterSaveBody(letterState, letterModel, "본문", { name: false, phone: false, budget: false }).shares.name, { on: false, value: null });
});

test("a saved version that reads differently from what was on screen is not approved silently", () => {
  assert.equal(sameVisibleLetter(letterModel, clone(letterModel)), true);
  assert.equal(sameVisibleLetter(letterModel, { ...letterModel, signature: "합성 맺음말" }), false);
  assert.equal(sameVisibleLetter(letterModel, { ...letterModel, body: "다른 본문" }), false);
  assert.equal(sameVisibleLetter(letterModel, { ...letterModel, recipients: ["합성 홀", "다른 홀"] }), false);
  const phoneOn = { ...letterModel, shares: letterModel.shares.map((share) => (share.key === "phone" ? { ...share, on: true, value: "010-****-1234" } : share)) };
  assert.equal(sameVisibleLetter(letterModel, phoneOn), false);
});

test("letter saves go out only with real hall ids and a body", async () => {
  const { fetcher, calls } = fakeFetcher([{ status: 200, body: { letter: letterModel, state: letterState, missing: [] } }]);
  const api = createInvitationApi(fetcher);
  const saved = await api.saveLetter(letterSaveBody(letterState, letterModel, "본문", { name: true, phone: false, budget: false }));
  assert.equal(saved.ok, true);
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].path, "/api/invitation/letter");
  for (const bad of [
    { recipientHallIds: [], body: "본문", shares: {} },
    { recipientHallIds: ["not-a-hall"], body: "본문", shares: {} },
    { recipientHallIds: [HALL], body: 3, shares: {} },
  ]) {
    assert.equal((await api.saveLetter(bad)).reason, "input");
  }
  assert.equal(calls.length, 1);
});

test("approver choices are sent in the server's shape and nothing else", async () => {
  const response = { setting: { mode: "designated", designatedUserId: HALL, revision: 2 }, members: [{ id: HALL, name: "가", isViewer: true }] };
  const { fetcher, calls } = fakeFetcher([{ status: 200, body: response }, { status: 200, body: { ...response, setting: { mode: "both", designatedUserId: null, revision: 3 } } }]);
  const api = createInvitationApi(fetcher);
  await api.saveApprover({ mode: "designated", designatedUserId: HALL });
  await api.saveApprover({ mode: "both", designatedUserId: HALL });
  assert.deepEqual(calls.map((call) => call.body), [{ mode: "designated", designatedUserId: HALL }, { mode: "both" }]);
  assert.equal((await api.saveApprover({ mode: "designated", designatedUserId: "x" })).reason, "input");
  assert.equal((await api.saveApprover({ mode: "admin" })).reason, "input");
  assert.equal(calls.length, 2);
});

test("a pending approver proposal is read at the boundary, and answered only by its id", async () => {
  const PROPOSAL = "eeeeeeee-5555-4555-8555-555555555555";
  const members = [{ id: HALL, name: "가", isViewer: true }, { id: HALL_2, name: "나", isViewer: false }];
  const setting = { mode: "unset", designatedUserId: null, revision: 1 };
  const pending = { proposalId: PROPOSAL, mode: "designated", designatedUserId: HALL_2, proposedBy: HALL_2, proposedAt: "2026-11-17T03:00:00.000Z", viewerCanRespond: true };
  const { fetcher, calls } = fakeFetcher([
    // 제안 칸이 없는 옛 응답은 제안이 없는 것으로 읽는다.
    { status: 200, body: { setting, members } },
    { status: 200, body: { setting, members, pending } },
    // 모양이 틀린 제안(답할 수 있는지 모름)은 그리지 않는다.
    { status: 200, body: { setting, members, pending: { ...pending, viewerCanRespond: "yes" } } },
    { status: 200, body: { setting, members, pending: { ...pending, proposalId: "not-a-proposal" } } },
    { status: 200, body: { setting, members, pending, outcome: "teleported" } },
    { status: 200, body: { setting: { mode: "designated", designatedUserId: HALL_2, revision: 2 }, members, pending: null, outcome: "confirmed" } },
    { status: 409, body: { error: "제안이 바뀌었어요. 다시 확인해 주세요.", code: "APPROVER_PROPOSAL_CHANGED" } },
  ]);
  const api = createInvitationApi(fetcher);
  const old = await api.approver();
  assert.equal(old.ok, true);
  assert.equal(old.data.pending, null);
  const withProposal = await api.approver();
  assert.deepEqual(withProposal.data.pending, pending);
  assert.equal((await api.approver()).reason, "invalid");
  assert.equal((await api.approver()).reason, "invalid");
  assert.equal((await api.approver()).reason, "invalid");
  const confirmed = await api.confirmApprover(PROPOSAL);
  assert.equal(confirmed.data.outcome, "confirmed");
  assert.equal(confirmed.data.pending, null);
  const changed = await api.declineApprover(PROPOSAL);
  assert.equal(changed.code, "APPROVER_PROPOSAL_CHANGED");
  assert.deepEqual(calls.slice(5), [
    { path: "/api/invitation/approver/confirm", method: "POST", body: { proposalId: PROPOSAL } },
    { path: "/api/invitation/approver/decline", method: "POST", body: { proposalId: PROPOSAL } },
  ]);
  // 제안 ID 가 아니면 보내지 않는다.
  for (const bad of [null, "", "x", 7, { proposalId: PROPOSAL }]) {
    assert.equal((await api.confirmApprover(bad)).reason, "input");
    assert.equal((await api.declineApprover(bad)).reason, "input");
  }
  assert.equal(calls.length, 7);
});

test("a consultation is added to the schedule only for a reply id, and an empty consultation is an answer", async () => {
  const { fetcher, calls } = fakeFetcher([
    { status: 200, body: { consultation: null, replyId: null, inCalendar: false, startsAt: null } },
    { status: 200, body: { added: true, alreadyInCalendar: false, eventId: "evt-1" } },
    { status: 409, body: { error: "확정된 상담 시간만 일정에 넣을 수 있어요.", code: "REPLY_NOT_CONFIRMED" } },
  ]);
  const api = createInvitationApi(fetcher);
  const empty = await api.consultation();
  assert.equal(empty.ok, true);
  assert.equal(empty.data.consultation, null);
  assert.equal((await api.addConsultationToSchedule(REPLY)).data.added, true);
  const notConfirmed = await api.addConsultationToSchedule(REPLY);
  assert.equal(notConfirmed.code, "REPLY_NOT_CONFIRMED");
  assert.deepEqual(calls[1], { path: "/api/invitation/consultation/schedule", method: "POST", body: { replyId: REPLY } });
  assert.equal((await api.addConsultationToSchedule("evt-1")).reason, "input");
  assert.equal(calls.length, 3);
});

test("condition patches only carry the fields the server takes, with year and month together", async () => {
  assert.deepEqual(cleanConditionsPatch({ hopedYear: 2027, hopedMonth: 5, guestCount: 200 }), { hopedYear: 2027, hopedMonth: 5, guestCount: 200 });
  assert.equal(cleanConditionsPatch({ hopedMonth: 5 }), null, "연도 없이 달만 보내지 않는다");
  assert.equal(cleanConditionsPatch({ region: "서울", role: "bride" }), null, "모르는 칸이 있으면 보내지 않는다");
  assert.equal(cleanConditionsPatch({ region: "서울\u0000" }), null);
  assert.equal(cleanConditionsPatch({ guestCount: 1.5 }), null);
  assert.equal(cleanConditionsPatch({}), null);
  const { fetcher, calls } = fakeFetcher([{ status: 200, body: { conditions: { hopedYear: 2027, hopedMonth: 5, region: null, guestCount: 200, timeLabel: null, startStage: "start" }, summary: null, missing: ["region"], weddingDate: null } }]);
  const saved = await createInvitationApi(fetcher).saveConditions({ hopedYear: 2027, hopedMonth: 5, guestCount: 200, startStage: "start" });
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.data.missing, ["region"]);
  assert.deepEqual(calls[0], { path: "/api/invitation/conditions", method: "PATCH", body: { hopedYear: 2027, hopedMonth: 5, guestCount: 200, startStage: "start" } });
});

test("the first chat saves only what the person picked; a fixed wedding date keeps its month", () => {
  const picked = { stage: "researching", month: 5, monthChosen: true, year: 2027, region: null, guests: 150, weddingDateKnown: false };
  assert.deepEqual(firstChatConditionsPatch(picked), { startStage: "researching", hopedYear: 2027, hopedMonth: 5, guestCount: 150 });
  // 되읽은 달(고르지 않음)과 정한 예식일이 있을 때의 달은 보내지 않는다.
  assert.deepEqual(firstChatConditionsPatch({ ...picked, monthChosen: false }), { startStage: "researching", guestCount: 150 });
  assert.deepEqual(firstChatConditionsPatch({ ...picked, weddingDateKnown: true }), { startStage: "researching", guestCount: 150 });
  // 고른 것이 없으면 보낼 것도 없다.
  assert.deepEqual(firstChatConditionsPatch({ stage: null, month: null, monthChosen: false, year: 2027, region: null, guests: null, weddingDateKnown: false }), {});
  assert.deepEqual(firstChatConditionsPatch({ ...picked, region: "서울" }).region, "서울");
});

test("the first chat year is the first year that month is three or more months away, by Korean date", () => {
  const nov2026 = { year: 2026, month: 11 };
  assert.equal(firstChatYearForMonth(12, nov2026), 2027, "다음 달 예식으로 짐작하지 않는다");
  assert.equal(firstChatYearForMonth(3, nov2026), 2027);
  assert.equal(firstChatYearForMonth(11, nov2026), 2027);
  const mar2027 = { year: 2027, month: 3 };
  assert.equal(firstChatYearForMonth(6, mar2027), 2027);
  assert.equal(firstChatYearForMonth(5, mar2027), 2028);
  // 한국 날짜로 읽는다: 2026-11-30 15:00Z 는 한국 12월 1일 0시다.
  assert.deepEqual(kstYearMonth(Date.parse("2026-11-30T15:00:00Z")), { year: 2026, month: 12 });
  assert.deepEqual(kstYearMonth(Date.parse("2026-11-30T14:59:59Z")), { year: 2026, month: 11 });
});

test("journey toggles flip one key without touching the server's done or now rows", () => {
  const plan = { off: ["families"], addOns: [] };
  assert.deepEqual(toggledJourneyPlan(plan, "stage", "families"), { off: [], addOns: [] });
  assert.deepEqual(toggledJourneyPlan(plan, "stage", "honeymoon"), { off: ["families", "honeymoon"], addOns: [] });
  assert.deepEqual(toggledJourneyPlan(plan, "addOn", "rings"), { off: ["families"], addOns: ["rings"] });
  assert.deepEqual(plan, { off: ["families"], addOns: [] }, "원래 계획을 바꾸지 않는다");
  const journey = {
    rows: [
      { key: "conditions", number: "01", title: "조건", sub: "", state: "done", optional: false, off: false },
      { key: "families", number: "04", title: "첫인사", sub: "", state: "next", optional: true, off: true },
      { key: "honeymoon", number: "08", title: "여행", sub: "", state: "next", optional: true, off: false },
    ],
    addOns: [{ key: "rings", button: "넣기", added: false }],
  };
  const next = journeyWithPlan(journey, { off: ["honeymoon"], addOns: ["rings"] });
  assert.deepEqual(next.rows.map((row) => [row.key, row.state, row.off]), [["conditions", "done", false], ["families", "next", false], ["honeymoon", "next", true]]);
  assert.equal(next.addOns[0].added, true);
});

test("a journey plan save and a failed save come back as results, not throws", async () => {
  const { fetcher, calls } = fakeFetcher([{ status: 409, body: { error: "다른 변경이 먼저 저장됐어요.", code: "PLAN_CHANGED" } }]);
  const result = await createInvitationApi(fetcher).saveJourneyPlan({ off: ["families"], addOns: [] });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.deepEqual(calls[0], { path: "/api/invitation/journey-plan", method: "PATCH", body: { off: ["families"], addOns: [] } });
});
