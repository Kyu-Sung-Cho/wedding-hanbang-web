// 청첩장 디자인(2026-11-17 파운더 디자인 아티팩트, 원문: 이 디자인 완전 같아야해) 실제 커플 API
// (`/api/invitation/*`)를 부르는 얇은 층.
//
// 요청은 부르는 쪽이 넘긴 `fetcher` 로 보낸다. 앱에서는 Bearer 토큰을 싣고 시작 시점 사용자에게 묶는
// `apiFetchForExpectedUser`(`@/lib/api`)이고, 시험에서는 가짜다. 이 파일은 그 밖의 네트워크를 모른다.
//
// 지키는 것:
//   - 응답은 경계에서 모양을 본다. 화면 컴포넌트가 그대로 그리는 값이라, 모양이 틀리면 그리지 않고
//     불러오지 못한 것으로 다룬다(모르는 화면 이름이 오면 누르는 순간 앱이 멈춘다).
//   - 오류는 서버가 준 HTTP 상태와 `{ error, code }` 를 그대로 넘긴다. 던지지 않는다.
//   - 보내는 값도 경계에서 본다. 서버가 받지 않을 값은 보내지 않는다.
//   - 아모라는 사용자 확인 없이 예산·일정·할 일을 바꾸지 않는다. 여기의 쓰기는 모두 사람이 누른 단추가
//     부른다(조건 저장, 준비 순서 빼기·넣기, 상담 후보 담기, 편지 저장·승인, 상담을 일정에 넣기,
//     붙여 넣은 업체 답에서 고른 날짜를 일정에 넣기).
//   - 직접 보내기(D-83 1단계)의 새 칸(`selfSend`, `replyPaste`)은 켜진 서버만 준다. 칸이 없으면 꺼진 것으로
//     읽고 오늘과 똑같이 그린다. 칸이 있으면 모양을 본다. 붙여 넣은 업체 답은 이 파일을 지나가지 않는다.

export const COMPARE_SORT_IDS = Object.freeze(["total", "transit", "minimum", "mood"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const FINGERPRINT = /^[0-9a-f]{64}$/u;
// 제어·서식 문자와 줄 나눔 문자. 서버의 조건 검사(`conditions.ts` UNSAFE_TEXT)와 같은 범위다.
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const ROUTE_KEYS = new Set(["home", "chat", "journey", "compare", "letter", "status"]);
const MOODS = new Set(["calm", "happy", "working"]);
const SERVER_MESSAGE_MAX = 200;

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value) => typeof value === "string";
const isNullableString = (value) => value === null || typeof value === "string";
const isNullableNumber = (value) => value === null || (typeof value === "number" && Number.isFinite(value));
const isBoolean = (value) => typeof value === "boolean";
const isArrayOf = (value, check) => Array.isArray(value) && value.every(check);
const isRouteKey = (value) => typeof value === "string" && ROUTE_KEYS.has(value);

export function isUuid(value) {
  return typeof value === "string" && UUID.test(value);
}

/** 서버가 사람에게 쓴 오류 문장. 길거나 제어 문자가 섞였으면 쓰지 않는다. */
function serverMessage(body) {
  if (!isRecord(body) || !isString(body.error)) return null;
  const text = body.error.trim();
  if (text.length === 0 || text.length > SERVER_MESSAGE_MAX || CONTROL.test(text)) return null;
  return text;
}

function failure(reason, status, code, message) {
  return { ok: false, reason, status, code, message };
}

// ── 응답 모양 ───────────────────────────────────────────────────────────────

function isFacts(value) {
  return isRecord(value)
    && isNullableString(value.firstName)
    && isNullableString(value.secondName)
    && isNullableNumber(value.year)
    && isNullableNumber(value.month)
    && isNullableNumber(value.day)
    && isNullableString(value.timeLabel)
    && isNullableString(value.venueName);
}

function isUpdate(value) {
  return value === null || (
    isRecord(value)
    && isString(value.timeLabel)
    && MOODS.has(value.mood)
    && isString(value.text)
    && isArrayOf(value.steps, isString)
    && (value.primary === null || (isRecord(value.primary) && isString(value.primary.label) && isRouteKey(value.primary.target)))
  );
}

function isDecision(value) {
  return isRecord(value)
    && isString(value.id)
    && isString(value.title)
    && isNullableString(value.sub)
    && isRecord(value.owner)
    && (value.owner.kind === "together" || (value.owner.kind === "person" && isString(value.owner.name)))
    && (value.target === null || isRouteKey(value.target));
}

export function isHomeModel(value) {
  return isRecord(value)
    && isArrayOf(value.people, (person) => isRecord(person) && isString(person.initial) && isString(person.name))
    && isFacts(value.invitation)
    && isUpdate(value.update)
    && isArrayOf(value.decisions, isDecision);
}

function isConditions(value) {
  return isRecord(value)
    && isNullableNumber(value.hopedYear)
    && isNullableNumber(value.hopedMonth)
    && isNullableString(value.region)
    && isNullableNumber(value.guestCount)
    && isNullableString(value.timeLabel)
    && (value.startStage === null || ["start", "researching", "booked"].includes(value.startStage));
}

export function isJourneyModel(value) {
  return isRecord(value)
    && isArrayOf(value.rows, (row) => isRecord(row)
      && isString(row.key) && isString(row.number) && isString(row.title) && isString(row.sub)
      && ["done", "now", "next"].includes(row.state) && isBoolean(row.optional) && isBoolean(row.off))
    && isArrayOf(value.addOns, (addOn) => isRecord(addOn) && isString(addOn.key) && isString(addOn.button) && isBoolean(addOn.added));
}

function isJourneyPlan(value) {
  return isRecord(value) && isArrayOf(value.off, isString) && isArrayOf(value.addOns, isString);
}

function isHallCard(value) {
  return isRecord(value)
    && isString(value.id) && isString(value.name) && isString(value.area)
    && isNullableString(value.totalManwon)
    && isString(value.meal) && isString(value.rent) && isString(value.minimum) && isBoolean(value.minimumWarn)
    && isString(value.transit) && isNullableString(value.photo) && isNullableString(value.badge)
    && isBoolean(value.picked) && isNullableString(value.status);
}

export function isCompareModel(value) {
  return isRecord(value)
    && typeof value.guests === "number"
    && isNullableNumber(value.month)
    && isArrayOf(value.halls, isHallCard)
    && isNullableString(value.sourceDateLabel);
}

const APPROVER_MODES = Object.freeze(["unset", "designated", "both"]);
const APPROVER_OUTCOMES = new Set(["unchanged", "applied", "proposed", "withdrawn", "confirmed", "declined"]);

function isApproverSetting(value) {
  return isRecord(value)
    && APPROVER_MODES.includes(value.mode)
    && isNullableString(value.designatedUserId)
    && typeof value.revision === "number";
}

/** 상대 확인을 기다리는 승인 방식 제안. 확인·거절할 때 `proposalId` 를 그대로 돌려보낸다. */
function isApproverProposal(value) {
  return isRecord(value)
    && isUuid(value.proposalId)
    && APPROVER_MODES.includes(value.mode)
    && isNullableString(value.designatedUserId)
    && isString(value.proposedBy)
    && isString(value.proposedAt)
    && isBoolean(value.viewerCanRespond);
}

function isLetterModel(value) {
  return isRecord(value)
    && isArrayOf(value.recipients, isString)
    && isString(value.dateLabel)
    && isString(value.body)
    && isString(value.signature)
    && isArrayOf(value.shares, (share) => isRecord(share)
      && ["name", "phone", "budget"].includes(share.key) && isString(share.label) && isString(share.value) && isBoolean(share.on))
    && isNullableString(value.partnerApprovedName)
    && isNullableString(value.backdropPhoto);
}

// 대기열에 넣지 못한 까닭. global_daily_cap(서비스 전체의 하루 상한)은 서버가 처음부터 줄 수 있던 값인데
// 이 목록에 없어서, 그 답이 오면 편지 화면이 "불러오지 못했어요"가 됐다(2026-11-18 고침).
const NOT_QUEUED_REASONS = Object.freeze(["sending_disabled", "daily_cap", "global_daily_cap", "approver_unavailable"]);
const isNotQueuedReason = (value) => value === null || NOT_QUEUED_REASONS.includes(value);

function isLetterState(value) {
  return isRecord(value)
    && isNullableString(value.letterId)
    && isNullableString(value.versionId)
    && isNullableNumber(value.version)
    && isNullableString(value.fingerprint)
    && ["draft", "awaiting_approval", "approved_not_queued", "queued"].includes(value.status)
    && isApproverSetting(value.approver)
    && isArrayOf(value.approvedBy, isString)
    && isArrayOf(value.waitingFor, isString)
    && isBoolean(value.viewerCanApprove)
    && isBoolean(value.viewerIsApprover)
    && isBoolean(value.sendingEnabled)
    && isNotQueuedReason(value.notQueuedReason)
    && isArrayOf(value.recipients, (recipient) => isRecord(recipient) && isString(recipient.hallId) && isString(recipient.name));
}

const isSelfSendMessage = (value) => isRecord(value)
  && isUuid(value.hallId) && isString(value.name) && isString(value.text) && value.text.length > 0;

/**
 * 직접 보내기(D-83 1단계) 글. 저장한 판 하나로 서버가 엮은 것이다. 켜진 서버만 이 칸을 주므로 칸이 없으면
 * 꺼진 것이고, 켜졌지만 저장한 판이 없으면 null 이다. 칸이 있으면 모양을 본다(판·지문으로 화면의 편지와 맞춘다).
 */
function isLetterSelfSend(value) {
  return isRecord(value)
    && isUuid(value.versionId)
    && isString(value.fingerprint) && FINGERPRINT.test(value.fingerprint)
    && isArrayOf(value.messages, isSelfSendMessage)
    && isBoolean(value.phoneOmitted);
}

function isLetterResponse(value) {
  return isRecord(value)
    && (value.letter === null || isLetterModel(value.letter))
    && (value.state === null || isLetterState(value.state))
    && isArrayOf(value.missing, isString)
    && (value.selfSend === undefined || value.selfSend === null || isLetterSelfSend(value.selfSend));
}

/**
 * 받은 답 붙여 넣기(D-83 1단계)에서 고를 웨딩홀과, 붙여 넣은 답으로 일정에 넣은 상담 수(취소한 것은 빼고).
 * 켜진 서버만 주는 칸이다. 그 수는 빈 상담 화면의 첫 줄이 그대로 말하므로 0 이상의 정수만 받는다.
 */
function isReplyPaste(value) {
  return isRecord(value)
    && isArrayOf(value.halls, (hall) => isRecord(hall) && isUuid(hall.hallId) && isString(hall.name))
    && Number.isSafeInteger(value.addedCount) && value.addedCount >= 0;
}

function isConsultationModel(value) {
  return isRecord(value)
    && isString(value.dateLabel) && isString(value.timeLabel) && isString(value.venue) && isString(value.place)
    && isNullableString(value.partnerName) && isNullableString(value.photo)
    && isUpdate(value.update)
    && isArrayOf(value.updateActions, (action) => isRecord(action) && isString(action.label) && ["ink", "outline"].includes(action.tone))
    && isArrayOf(value.questions, isString);
}

const ACTORS = new Set(["amora", "operator", "couple"]);
const isActorLine = (line) => isRecord(line) && ACTORS.has(line.actor) && isString(line.text);

const accept = {
  // `updateSteps`(소식 줄마다 누가 했는지)는 나중에 생긴 칸이다. 없으면 빈 목록으로 읽는다.
  home: (body) => (isRecord(body) && isHomeModel(body.home) && isArrayOf(body.degraded, isString)
    && (body.updateSteps === undefined || isArrayOf(body.updateSteps, isActorLine))
    ? { ...body, updateSteps: body.updateSteps ?? [] }
    : null),
  conditions: (body) => (isRecord(body) && isConditions(body.conditions) && isNullableString(body.summary)
    && isArrayOf(body.missing, isString) && isNullableString(body.weddingDate) ? body : null),
  journey: (body) => (isRecord(body) && isJourneyModel(body.journey) && isJourneyPlan(body.plan) ? body : null),
  halls: (body) => (isRecord(body)
    && (body.compare === null || isCompareModel(body.compare))
    && isArrayOf(body.missing, isString)
    && COMPARE_SORT_IDS.includes(body.sort)
    && typeof body.pickedCount === "number" ? body : null),
  shortlist: (body) => (isRecord(body) && isString(body.hallId) && isBoolean(body.picked) && typeof body.pickedCount === "number" ? body : null),
  // `pending`(상대 확인을 기다리는 제안)과 `outcome`(PUT·확인·거절이 한 일)은 나중에 생긴 칸이다.
  // `pending` 이 없으면 제안이 없는 것으로 읽는다. 모양이 틀린 제안은 그리지 않는다(누가 무엇을 제안했는지 지어내지 않는다).
  approver: (body) => (isRecord(body) && isApproverSetting(body.setting)
    && isArrayOf(body.members, (member) => isRecord(member) && isString(member.id) && isNullableString(member.name) && isBoolean(member.isViewer))
    && (body.pending === undefined || body.pending === null || isApproverProposal(body.pending))
    && (body.outcome === undefined || APPROVER_OUTCOMES.has(body.outcome))
    ? { ...body, pending: body.pending ?? null } : null),
  letter: (body) => (isLetterResponse(body) ? body : null),
  approve: (body) => (isRecord(body)
    && isRecord(body.result)
    && ["awaiting_approval", "approved_not_queued", "queued"].includes(body.result.status)
    && isNotQueuedReason(body.result.notQueuedReason)
    && typeof body.result.queuedCount === "number"
    && isArrayOf(body.result.duplicateHallIds, isString)
    && isArrayOf(body.result.waitingFor, isString)
    && (body.letter === null || isLetterResponse(body.letter)) ? body : null),
  // `replyPaste` 는 직접 보내기가 켜진 서버만 준다. 없으면 붙여 넣기를 그리지 않는다.
  consultation: (body) => (isRecord(body)
    && (body.consultation === null || isConsultationModel(body.consultation))
    && isNullableString(body.replyId)
    && isBoolean(body.inCalendar)
    && isNullableString(body.startsAt)
    && (body.replyPaste === undefined || isReplyPaste(body.replyPaste)) ? body : null),
  schedule: (body) => (isRecord(body) && isBoolean(body.added) && isBoolean(body.alreadyInCalendar) && isString(body.eventId) ? body : null),
};

// ── 보내는 값 ───────────────────────────────────────────────────────────────

const CONDITION_KEYS = new Set(["hopedYear", "hopedMonth", "region", "guestCount", "timeLabel", "startStage"]);

/** 조건 PATCH 본문. 모르는 칸·틀린 모양이 하나라도 있으면 null(보내지 않는다). 연도와 달은 함께 온다. */
export function cleanConditionsPatch(patch) {
  if (!isRecord(patch)) return null;
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.some((key) => !CONDITION_KEYS.has(key))) return null;
  if (("hopedYear" in patch) !== ("hopedMonth" in patch)) return null;
  const integer = (value) => value === null || (typeof value === "number" && Number.isSafeInteger(value));
  if ("hopedYear" in patch && (!integer(patch.hopedYear) || !integer(patch.hopedMonth))) return null;
  if ("guestCount" in patch && !integer(patch.guestCount)) return null;
  for (const key of ["region", "timeLabel"]) {
    if (key in patch && !(patch[key] === null || (isString(patch[key]) && patch[key].trim().length > 0 && !CONTROL.test(patch[key])))) return null;
  }
  if ("startStage" in patch && !(patch.startStage === null || ["start", "researching", "booked"].includes(patch.startStage))) return null;
  return { ...patch };
}

const YMD = /^\d{4}-\d{2}-\d{2}$/u;
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

/** 달력에 있는 날짜의 "YYYY-MM-DD"(2027-02-29 는 아니다). 서버의 일정 날짜 검사와 같은 기준이다. */
export function isScheduleYmd(value) {
  if (typeof value !== "string" || !YMD.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year === 0) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** 24시간제 "HH:MM". */
export function isScheduleTime(value) {
  return typeof value === "string" && HHMM.test(value);
}

/**
 * 붙여 넣은 업체 답으로 상담 일정을 넣는 POST 본문(D-83 1단계). 홀 ID·날짜·시간(있을 때만) 세 칸만 담는다.
 * 붙여 넣은 글은 받지도 싣지도 않는다. 하나라도 틀리면 null(보내지 않는다).
 */
export function pastedScheduleBody(input) {
  if (!isRecord(input) || !isUuid(input.hallId) || !isScheduleYmd(input.date)) return null;
  const hallId = input.hallId.toLowerCase();
  if (input.time === undefined || input.time === null) return { hallId, date: input.date };
  return isScheduleTime(input.time) ? { hallId, date: input.date, time: input.time } : null;
}

// ── 부르기 ──────────────────────────────────────────────────────────────────

async function call(fetcher, path, init, acceptBody) {
  let response;
  try {
    response = await fetcher(path, init);
  } catch {
    return failure("network", 0, null, null);
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const code = isRecord(body) && isString(body.code) ? body.code : null;
    return failure("http", response.status, code, serverMessage(body));
  }
  const data = acceptBody(body);
  return data === null ? failure("invalid", response.status, null, null) : { ok: true, data };
}

const rejected = () => Promise.resolve(failure("input", 0, null, null));
const sendJson = (method, body) => ({ method, body: JSON.stringify(body) });

/**
 * `/api/invitation/*` 묶음. 모든 함수는 `{ ok: true, data }` 이거나
 * `{ ok: false, reason: "network" | "http" | "invalid" | "input", status, code, message }` 를 돌려준다.
 */
export function createInvitationApi(fetcher) {
  return {
    home: () => call(fetcher, "/api/invitation/home", { method: "GET" }, accept.home),
    conditions: () => call(fetcher, "/api/invitation/conditions", { method: "GET" }, accept.conditions),
    saveConditions(patch) {
      const body = cleanConditionsPatch(patch);
      return body ? call(fetcher, "/api/invitation/conditions", sendJson("PATCH", body), accept.conditions) : rejected();
    },
    journey: () => call(fetcher, "/api/invitation/journey", { method: "GET" }, accept.journey),
    saveJourneyPlan(plan) {
      if (!isJourneyPlan(plan)) return rejected();
      return call(fetcher, "/api/invitation/journey-plan", sendJson("PATCH", { off: [...plan.off], addOns: [...plan.addOns] }), accept.journey);
    },
    halls(sort) {
      if (!COMPARE_SORT_IDS.includes(sort)) return rejected();
      return call(fetcher, `/api/invitation/halls?sort=${sort}`, { method: "GET" }, accept.halls);
    },
    setHallPicked(hallId, picked) {
      if (!isUuid(hallId) || !isBoolean(picked)) return rejected();
      return call(fetcher, `/api/invitation/halls/${hallId.toLowerCase()}/shortlist`, { method: picked ? "POST" : "DELETE" }, accept.shortlist);
    },
    approver: () => call(fetcher, "/api/invitation/approver", { method: "GET" }, accept.approver),
    saveApprover(choice) {
      if (!isRecord(choice)) return rejected();
      if (choice.mode === "designated") {
        if (!isUuid(choice.designatedUserId)) return rejected();
        return call(fetcher, "/api/invitation/approver", sendJson("PUT", { mode: "designated", designatedUserId: choice.designatedUserId }), accept.approver);
      }
      if (choice.mode !== "unset" && choice.mode !== "both") return rejected();
      return call(fetcher, "/api/invitation/approver", sendJson("PUT", { mode: choice.mode }), accept.approver);
    },
    /** 상대가 낸 승인 방식 제안을 확인한다(제안한 사람이 아닌 회원만). 그 사이 제안이 바뀌었으면 409. */
    confirmApprover(proposalId) {
      if (!isUuid(proposalId)) return rejected();
      return call(fetcher, "/api/invitation/approver/confirm", sendJson("POST", { proposalId }), accept.approver);
    },
    /** 상대가 낸 승인 방식 제안을 받아들이지 않는다. 지금 방식이 그대로 쓰인다. */
    declineApprover(proposalId) {
      if (!isUuid(proposalId)) return rejected();
      return call(fetcher, "/api/invitation/approver/decline", sendJson("POST", { proposalId }), accept.approver);
    },
    letter: () => call(fetcher, "/api/invitation/letter", { method: "GET" }, accept.letter),
    saveLetter(body) {
      if (!isRecord(body) || !isArrayOf(body.recipientHallIds, isUuid) || body.recipientHallIds.length === 0 || !isString(body.body)) return rejected();
      return call(fetcher, "/api/invitation/letter", sendJson("PUT", body), accept.letter);
    },
    approveLetter(version) {
      if (!isRecord(version) || !isUuid(version.versionId) || !isString(version.fingerprint) || !FINGERPRINT.test(version.fingerprint)) return rejected();
      return call(fetcher, "/api/invitation/letter/approve", sendJson("POST", { versionId: version.versionId, fingerprint: version.fingerprint }), accept.approve);
    },
    consultation: () => call(fetcher, "/api/invitation/consultation", { method: "GET" }, accept.consultation),
    addConsultationToSchedule(replyId) {
      if (!isUuid(replyId)) return rejected();
      return call(fetcher, "/api/invitation/consultation/schedule", sendJson("POST", { replyId }), accept.schedule);
    },
    /** 사람이 고른 날짜(와 시간)로 상담 일정 하나를 넣는다. 기기 밖으로 나가는 것은 홀 ID·날짜·시간뿐이다. */
    addPastedConsultationToSchedule(input) {
      const body = pastedScheduleBody(input);
      return body ? call(fetcher, "/api/invitation/consultation/paste-schedule", sendJson("POST", body), accept.schedule) : rejected();
    },
  };
}

// ── 화면이 쓰는 판정 ────────────────────────────────────────────────────────

export function isLetterVersionChanged(result) {
  return !result.ok && result.status === 409 && result.code === "LETTER_VERSION_CHANGED";
}

/** 준비 순서에서 단계를 빼거나 다시 넣고, 갈래를 넣거나 뺀 다음 계획. 원래 계획은 바꾸지 않는다. */
export function toggledJourneyPlan(plan, kind, key) {
  const flip = (list) => (list.includes(key) ? list.filter((item) => item !== key) : [...list, key]);
  return kind === "stage"
    ? { off: flip(plan.off), addOns: [...plan.addOns] }
    : { off: [...plan.off], addOns: flip(plan.addOns) };
}

/**
 * 서버 답을 기다리는 동안 그릴 준비 순서. 뺀 단계와 넣은 갈래만 계획대로 바꾸고, 단계의 끝남·지금은
 * 서버가 정한 그대로 둔다(그것은 저장된 사실로만 정한다).
 */
export function journeyWithPlan(journey, plan) {
  return {
    rows: journey.rows.map((row) => (row.optional ? { ...row, off: plan.off.includes(row.key) } : row)),
    addOns: journey.addOns.map((addOn) => ({ ...addOn, added: plan.addOns.includes(addOn.key) })),
  };
}

/** 한국 날짜의 연·월. 기기 시간대로 오늘을 읽지 않는다. */
export function kstYearMonth(nowMs) {
  const date = new Date(nowMs + 9 * 60 * 60 * 1000);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/** 첫 대화에서 달만 고를 때의 연도. 그 달이 처음으로 석 달 넘게 남는 해다(첫 대화 카드에 그 연도가 함께 보인다). */
export const FIRST_CHAT_MIN_LEAD_MONTHS = 3;

export function firstChatYearForMonth(month, today) {
  let year = today.year;
  while ((year - today.year) * 12 + (month - today.month) < FIRST_CHAT_MIN_LEAD_MONTHS) year += 1;
  return year;
}

/**
 * 첫 대화의 답으로 조건 PATCH 를 만든다. 사람이 고른 칸만 보낸다(짐작한 값을 저장하지 않는다).
 * 정한 예식일이 있으면 희망 달은 보내지 않는다 — 예식일이 늘 이긴다.
 */
export function firstChatConditionsPatch(answers) {
  const patch = {};
  if (answers.stage) patch.startStage = answers.stage;
  if (answers.month !== null && answers.monthChosen && !answers.weddingDateKnown) {
    patch.hopedYear = answers.year;
    patch.hopedMonth = answers.month;
  }
  if (answers.region) patch.region = answers.region;
  if (answers.guests !== null) patch.guestCount = answers.guests;
  return patch;
}

/** 편지의 알려줄 정보 켜짐 상태. */
export function letterShareFlags(letter) {
  const on = (key) => letter.shares.find((share) => share.key === key)?.on === true;
  return { name: on("name"), phone: on("phone"), budget: on("budget") };
}

/** 화면에서 고친 편지(본문·알려줄 정보)가 서버의 마지막 판과 다른가. */
export function isLetterDirty(letter, body, flags) {
  const saved = letterShareFlags(letter);
  return body !== letter.body || saved.name !== flags.name || saved.phone !== flags.phone || saved.budget !== flags.budget;
}

/** PUT `/api/invitation/letter` 본문. 휴대폰 번호는 가린 값만 받으므로 비워 보내 앞 판의 값을 쓴다. */
export function letterSaveBody(state, letter, body, flags) {
  const nameValue = letter.shares.find((share) => share.key === "name")?.value ?? "";
  return {
    letterId: state.letterId,
    recipientHallIds: state.recipients.map((recipient) => recipient.hallId),
    body,
    shares: {
      name: { on: flags.name, value: flags.name && nameValue.trim() ? nameValue : null },
      phone: { on: flags.phone, value: null },
      budget: { on: flags.budget },
    },
  };
}

/** 두 편지가 사람 눈에 같은가(받는 곳·본문·맺음말·알려줄 정보). 다르면 승인 전에 다시 보여 준다. */
export function sameVisibleLetter(a, b) {
  const shares = (letter) => letter.shares.map((share) => `${share.key}:${share.on ? share.value : ""}`).join("|");
  return a.recipients.join("|") === b.recipients.join("|")
    && a.body === b.body
    && a.signature === b.signature
    && shares(a) === shares(b);
}

/**
 * 승인 결과를 화면의 한 줄로. 보내기 스위치가 꺼져 있으면 승인만 저장됐다는 사실을 그대로 말한다.
 * 돌려주는 값은 문구 키다. 문장은 `LETTER_STATE_COPY` 에 있다.
 */
// 하루 상한은 커플의 것이든 서비스 전체의 것이든 화면에는 같은 말이다(웹 `hitDailyCap` 과 같다).
const hitDailyCap = (reason) => reason === "daily_cap" || reason === "global_daily_cap";

export function letterApprovalNotice(result) {
  if (result.status === "queued") {
    if (result.queuedCount > 0) return { kind: "queued", count: result.queuedCount };
    return result.duplicateHallIds.length > 0 ? { kind: "alreadySent" } : { kind: "queued", count: 0 };
  }
  if (result.status === "approved_not_queued") {
    if (hitDailyCap(result.notQueuedReason)) return { kind: "dailyCap" };
    if (result.notQueuedReason === "approver_unavailable") return { kind: "approverUnavailable" };
    if (result.queuedCount === 0 && result.duplicateHallIds.length > 0 && result.notQueuedReason === null) return { kind: "alreadySent" };
    return { kind: "approvedNotSent" };
  }
  return { kind: "waiting", userIds: [...result.waitingFor] };
}

/** 불러온 편지 상태가 이미 말해야 하는 것(승인했지만 보내지 않은 판, 다른 사람의 승인을 기다리는 판). */
export function letterStateNotice(state) {
  if (state.status === "approved_not_queued") {
    if (hitDailyCap(state.notQueuedReason)) return { kind: "dailyCap" };
    if (state.notQueuedReason === "approver_unavailable") return { kind: "approverUnavailable" };
    return { kind: "approvedNotSent" };
  }
  if (state.status === "awaiting_approval" && state.approvedBy.length > 0) {
    return { kind: "waiting", userIds: [...state.waitingFor] };
  }
  return null;
}

// ── 직접 보내기·받은 답 붙여 넣기(D-83 1단계, 2026-11-18) ────────────────────

/**
 * 편지 시트의 직접 보내기 칸이 보여 줄 것. 서버가 `selfSend` 칸을 주지 않으면 꺼진 것이다(null, 오늘 화면 그대로).
 *   - messages: 화면의 편지가 저장된 판 그대로이고 그 판·지문으로 만든 글일 때만 보낼 글을 준다.
 *   - saveFirst: 고치는 중이다. 저장해야 보낼 글이 나온다.
 *   - beforeSave: 고친 것은 없지만 저장할 수 있다(저장한 판이 없다). 처음 쓰는 초안이거나, 담은 웨딩홀이 바뀌어
 *     서버가 저장한 판을 내렸다(편지는 남고 판·지문이 비었다). 글은 판으로만 엮으니 이때는 보낼 글도 없다.
 *     저장하면 보낼 글이 나온다고 알린다. 시트의 저장 단추가 눌리는 조건(판이 없거나 고쳤다)과 같다.
 *   - askConditions: 편지를 한 번도 저장하지 않았고(편지가 없다) 희망 시기나 하객 수를 모른다. 편지에 넣을 수 있게
 *     먼저 묻는다. 서버는 저장한 편지가 없을 때만 조건으로 초안 글을 다시 만든다. 담은 웨딩홀이 바뀌어 판이 내려간
 *     편지는 저장한 글을 그대로 쓰므로 조건을 알려 줘도 글에 들어가지 않는다. 그래서 그때는 묻지 않는다.
 *     모르는 것만 묻는다: 희망 시기만 모르면 "month", 하객 수만 모르면 "guests", 둘 다 모르면 "both", 물을 것이 없으면 null.
 *   - afterSend: 편지를 저장한 적이 있다(편지 ID 가 있다). 업체 답이 오면 상담 화면에 붙여 넣으라는 줄과 상담 화면
 *     단추를 둔다. 고치는 중이거나 담은 웨딩홀이 바뀌어 판이 내려가 보낼 글이 없어도 둔다. 앞서 보낸 글의 답은 그
 *     사이에도 온다. 보낼 글이 있으면 늘 둔다.
 */
export function letterSelfSendView(response, dirty) {
  if (!isRecord(response) || response.selfSend === undefined) return null;
  const { state, selfSend } = response;
  const matches = !dirty && isRecord(selfSend) && isRecord(state)
    && selfSend.versionId === state.versionId && selfSend.fingerprint === state.fingerprint;
  const unsaved = !isRecord(state) || state.versionId === null;
  const neverSaved = !isRecord(state) || state.letterId === null;
  return {
    messages: matches ? selfSend : null,
    saveFirst: dirty === true,
    beforeSave: dirty !== true && unsaved,
    askConditions: neverSaved ? missingLetterConditions(response.missing) : null,
    afterSend: matches || !neverSaved,
  };
}

/** 편지 글에 넣는 조건 가운데 서버가 모른다고 한 것. 지역은 편지 글에 들어가지 않아 묻지 않는다. */
function missingLetterConditions(missing) {
  if (!isArrayOf(missing, isString)) return null;
  const month = missing.includes("month");
  const guests = missing.includes("guests");
  if (month && guests) return "both";
  if (month) return "month";
  return guests ? "guests" : null;
}

/** 24시간제 "HH:MM" 을 오전·오후와 12시간제 시·분으로. 틀린 값이면 null. */
export function scheduleTimeParts(time) {
  if (!isScheduleTime(time)) return null;
  const hour = Number(time.slice(0, 2));
  return { meridiem: hour < 12 ? "am" : "pm", hour12: hour % 12 === 0 ? 12 : hour % 12, minute: Number(time.slice(3, 5)) };
}

/**
 * 오전·오후를 사람이 고른 시간. 업체가 "2시"라고만 쓴 시간을 읽은 값(짐작)을 사람이 고른 쪽으로 맞춘다.
 * 12시는 오전이면 0시, 오후면 12시다.
 */
export function withMeridiem(time, meridiem) {
  if (!isScheduleTime(time) || (meridiem !== "am" && meridiem !== "pm")) return null;
  const hour = (Number(time.slice(0, 2)) % 12) + (meridiem === "pm" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}${time.slice(2)}`;
}

/** 한국 날짜의 "YYYY-MM-DD". 기기 시간대로 오늘을 읽지 않는다. */
export function kstTodayYmd(nowMs) {
  const date = new Date(nowMs + 9 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
