// 아모라가 맡은 일(D-84, 25장 갈래 4) 앱 쪽 얇은 층. 목록·하나·누르기(맡기기·그만하기·이어서 하기)를 부른다.
//
// 요청은 부르는 쪽이 넘긴 `fetcher` 로 보낸다(`invitationApi.mjs` 와 같은 방식). 앱에서는 시작 시점 사용자에게
// Bearer 를 묶는 `@/lib/api` 의 헬퍼이고(홈 카드와 대화 카드는 401 에 로그아웃하지 않는 `apiFetchForExpectedUserQuiet`),
// 시험에서는 가짜다. 이 파일은 그 밖의 네트워크를 모른다.
//
// 지키는 것:
//   - 응답 읽기는 공유 계약(`@hanbang/shared/amora-tasks`)이 한다. 여기서 모양을 새로 정하지 않는다.
//   - 스위치가 꺼졌거나 표가 아직 없으면 "꺼짐"이다. 화면은 아무것도 그리지 않는다(앱이 DB 보다 먼저 나가도 홈이 깨지지 않는다).
//   - 던지지 않는다. 닿지 않거나 서버가 오류로 답하면 실패로 돌려준다.
//   - 누르기는 사람이 누른 단추만 부른다. 아모라가 스스로 맡거나 그만두지 않는다.

import {
  AMORA_TASK_ID_PATTERN,
  AMORA_TASK_STATUSES,
  parseAmoraTaskDetail,
  parseAmoraTaskList,
} from "@hanbang/shared/amora-tasks";

/** @typedef {import("@hanbang/shared/amora-tasks").AmoraTaskDetail} AmoraTaskDetail */
/** @typedef {import("@hanbang/shared/amora-tasks").AmoraTaskOffer} AmoraTaskOffer */
/** @typedef {import("@hanbang/shared/amora-tasks").AmoraTaskStage} AmoraTaskStage */
/** @typedef {import("@hanbang/shared/amora-tasks").AmoraTaskStatus} AmoraTaskStatus */
/** @typedef {import("@hanbang/shared/amora-tasks").AmoraTaskSummary} AmoraTaskSummary */
/** @typedef {{ visible: boolean, tasks: AmoraTaskSummary[] }} AmoraTaskList */
/** @typedef {(path: string, init: RequestInit) => Promise<Response>} AmoraTaskFetcher */
/** @typedef {"start" | "cancel" | "resume"} AmoraTaskAction */
/** @typedef {{ ok: true, list: AmoraTaskList } | { ok: false, status: number }} AmoraTaskListRead */
/**
 * @typedef {{ kind: "ready", detail: AmoraTaskDetail }
 *   | { kind: "off" }
 *   | { kind: "not_found" }
 *   | { kind: "failed", status: number }} AmoraTaskDetailRead
 */
/**
 * `reply` 는 서버가 준 문장 그대로이고 확인하지 않았다. 화면에는 `amoraTaskGateReply` 를 거친 것만 보인다.
 * @typedef {{ ok: boolean, off: boolean, code: string | null, status: AmoraTaskStatus | null, reply: string | null, httpStatus: number }} AmoraTaskActionResult
 */
/**
 * 대화 카드의 모습. open: 맡기기 단추가 있다. started·cancelled: 진행 보기가 있다.
 * expired·unavailable·limit: 한 줄만 남는다. off: 아무것도 그리지 않는다.
 * @typedef {"open" | "started" | "cancelled" | "expired" | "unavailable" | "limit" | "off"} AmoraTaskOfferPhase
 */
/** @typedef {"dailyTaskLimit" | "offerExpired" | "offerUnavailable" | "startFailed"} AmoraTaskStartFailureCopyKey */
/** @typedef {"offerStarted" | "cancelled" | "offerExpired" | "offerUnavailable" | "dailyTaskLimit"} AmoraTaskOfferPhaseCopyKey */

export const AMORA_TASKS_API_PATH = "/api/amora/tasks";
/** @type {readonly AmoraTaskAction[]} */
export const AMORA_TASK_ACTIONS = Object.freeze(["start", "cancel", "resume"]);
/** 홈에 보이는 줄 수. */
export const AMORA_TASK_HOME_LIMIT = 3;
/** 찾는 중·정리 중인 일이 있을 때 홈이 다시 읽는 간격. */
export const AMORA_TASK_HOME_POLL_MS = 30_000;
/** 찾는 중·정리 중일 때 결과 화면이 다시 읽는 간격. */
export const AMORA_TASK_DETAIL_POLL_MS = 15_000;

// 서버 함수가 돌려주는 결과 이름(`started`, `daily_task_limit` 같은 것)만 받는다. 라우트 오류 이름(대문자)은 버린다.
const RESULT_CODE = /^[a-z_]{1,40}$/u;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * 맡은 일 하나의 API 주소. 모양이 틀린 번호면 null 이고 요청을 보내지 않는다.
 * @param {unknown} taskId
 * @returns {string | null}
 */
export function amoraTaskApiPath(taskId) {
  if (typeof taskId !== "string" || !AMORA_TASK_ID_PATTERN.test(taskId)) return null;
  return `${AMORA_TASKS_API_PATH}/${taskId.toLowerCase()}`;
}

/** 서버가 "꺼짐"이라고 답했는가(스위치가 꺼졌거나 표가 아직 없다). 오류 응답은 꺼짐이 아니다. */
function isSwitchedOff(response, body) {
  return response.ok && isRecord(body) && (body.enabled === false || body.available === false);
}

/** 보내고 본문을 읽는다. 닿지 않았으면 null. 본문이 JSON 이 아니면 body 가 null 이다. */
async function send(fetcher, path, init) {
  let response;
  try {
    response = await fetcher(path, init);
  } catch {
    return null;
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

/**
 * `GET /api/amora/tasks`. 실패하면 `{ ok: false }` 이고 화면은 보던 목록을 그대로 둔다.
 * @param {AmoraTaskFetcher} fetcher
 * @returns {Promise<AmoraTaskListRead>}
 */
export async function fetchAmoraTaskList(fetcher) {
  const sent = await send(fetcher, AMORA_TASKS_API_PATH, { method: "GET" });
  if (!sent) return { ok: false, status: 0 };
  if (!sent.response.ok) return { ok: false, status: sent.response.status };
  return { ok: true, list: parseAmoraTaskList(sent.body) };
}

/**
 * 홈에 보일 줄. 꺼졌으면 비어 있다.
 * @param {AmoraTaskList} list
 * @returns {AmoraTaskSummary[]}
 */
export function homeAmoraTasks(list) {
  return list.visible ? list.tasks.slice(0, AMORA_TASK_HOME_LIMIT) : [];
}

/**
 * 아모라가 지금 일하고 있는 단계인가(찾는 중·정리 중). 이때만 화면이 저절로 다시 읽는다.
 * @param {AmoraTaskStage | null | undefined} stage
 * @returns {boolean}
 */
export function isAmoraTaskWorking(stage) {
  return stage === "searching" || stage === "organizing";
}

/**
 * 목록에 지금 일하는 중인 일이 하나라도 있는가(홈에 안 보이는 줄까지 본다).
 * @param {AmoraTaskList} list
 * @returns {boolean}
 */
export function hasWorkingAmoraTask(list) {
  return list.visible && list.tasks.some((task) => isAmoraTaskWorking(task.stage));
}

/**
 * `GET /api/amora/tasks/:id`.
 * @param {AmoraTaskFetcher} fetcher
 * @param {unknown} taskId
 * @returns {Promise<AmoraTaskDetailRead>}
 */
export async function fetchAmoraTaskDetail(fetcher, taskId) {
  const path = amoraTaskApiPath(taskId);
  if (!path) return { kind: "not_found" };
  const sent = await send(fetcher, path, { method: "GET" });
  if (!sent) return { kind: "failed", status: 0 };
  const { response, body } = sent;
  if (response.status === 404) return { kind: "not_found" };
  if (!response.ok) return { kind: "failed", status: response.status };
  if (isSwitchedOff(response, body)) return { kind: "off" };
  const detail = parseAmoraTaskDetail(body);
  // 다른 일의 답이 오면 그리지 않는다.
  if (!detail || detail.id !== String(taskId).toLowerCase()) return { kind: "failed", status: response.status };
  return { kind: "ready", detail };
}

/**
 * `POST /api/amora/tasks/:id` `{ action }`. 사람이 누른 단추만 부른다.
 * @param {AmoraTaskFetcher} fetcher
 * @param {unknown} taskId
 * @param {unknown} action
 * @returns {Promise<AmoraTaskActionResult>}
 */
export async function postAmoraTaskAction(fetcher, taskId, action) {
  const unsent = { ok: false, off: false, code: null, status: null, reply: null, httpStatus: 0 };
  const path = amoraTaskApiPath(taskId);
  if (!path || typeof action !== "string" || !AMORA_TASK_ACTIONS.includes(/** @type {AmoraTaskAction} */ (action))) {
    return unsent;
  }
  const sent = await send(fetcher, path, { method: "POST", body: JSON.stringify({ action }) });
  if (!sent) return unsent;
  const { response, body } = sent;
  const record = isRecord(body) ? body : {};
  return {
    ok: response.ok && record.ok === true,
    off: isSwitchedOff(response, record),
    code: typeof record.code === "string" && RESULT_CODE.test(record.code) ? record.code : null,
    status: AMORA_TASK_STATUSES.includes(record.status) ? record.status : null,
    reply: typeof record.reply === "string" ? record.reply : null,
    httpStatus: response.status,
  };
}

// 문지기 문장의 한도. 서버(`apps/web/src/lib/amoraTasks/adapters.ts`)도 300자에서 자른다.
const GATE_REPLY_MAX_LENGTH = 300;
// 제어·서식·줄 구분·문단 구분 문자. 하나라도 들었으면 그 문장은 쓰지 않는다(보이지 않는 글자가 문장을 다르게 보이게 한다).
const GATE_REPLY_UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * 문지기가 맡기기를 막았을 때(`gate_blocked`) 카드에 보일 서버 문장. 문지기 담당이 정한 대로 다듬거나 고치지 않고
 * 그대로 돌려준다. 문장이 없거나 비었거나 문자열이 아니면, 300자를 넘거나 제어·서식 문자가 들었으면 null 이고 카드는
 * `offerUnavailable` 로 말한다. 문지기가 막은 결과가 아니면 문장이 있어도 null 이다.
 * @param {Pick<AmoraTaskActionResult, "code" | "reply">} result
 * @returns {string | null}
 */
export function amoraTaskGateReply(result) {
  if (result.code !== "gate_blocked") return null;
  const { reply } = result;
  if (typeof reply !== "string" || reply.trim() === "") return null;
  if (reply.length > GATE_REPLY_MAX_LENGTH || GATE_REPLY_UNSAFE.test(reply)) return null;
  return reply;
}

/**
 * 맡기기가 안 됐을 때 보일 문장(`AMORA_TASK_COPY` 의 이름). 오늘 몫을 다 썼으면 그 말을, 카드가 닫혔으면 닫힌
 * 카드라고, 문지기가 막았으면 맡을 수 없다고 한다(문지기가 준 문장이 `amoraTaskGateReply` 를 지나면 카드는 그 문장을 쓴다).
 * 그 밖(닿지 않음, 서버 오류, 못 찾음)은 잠시 뒤에 다시 누르라고 한다.
 * @param {string | null | undefined} code
 * @returns {AmoraTaskStartFailureCopyKey}
 */
export function amoraTaskStartFailureCopyKey(code) {
  if (code === "daily_task_limit") return "dailyTaskLimit";
  if (code === "offer_expired" || code === "offer_closed") return "offerExpired";
  if (code === "gate_blocked") return "offerUnavailable";
  return "startFailed";
}

/**
 * 맡기기를 누른 뒤의 카드 모습. `retry` 가 true 면 잠시 뒤에 다시 누를 수 있는 실패다(단추가 남고 그 말을 보인다).
 * 이미 맡겨진 카드(`already_started`)도 맡은 것으로 본다(두 사람 중 한 사람이 먼저 눌렀을 수 있다).
 * @param {AmoraTaskActionResult} result
 * @returns {{ phase: AmoraTaskOfferPhase, retry: boolean }}
 */
export function amoraTaskStartOutcome(result) {
  if (result.off) return { phase: "off", retry: false };
  if (result.ok) return { phase: "started", retry: false };
  const key = amoraTaskStartFailureCopyKey(result.code);
  if (key === "dailyTaskLimit") return { phase: "limit", retry: false };
  if (key === "offerExpired") return { phase: "expired", retry: false };
  if (key === "offerUnavailable") return { phase: "unavailable", retry: false };
  return { phase: "open", retry: true };
}

/**
 * @param {Pick<AmoraTaskOffer, "offerExpiresAt">} offer
 * @param {number} nowMs
 */
function offerHasLapsed(offer, nowMs) {
  if (!offer.offerExpiresAt) return false;
  const at = Date.parse(offer.offerExpiresAt);
  return Number.isFinite(at) && at <= nowMs;
}

/**
 * 대화 카드를 그릴 때의 모습. 서버가 준 지금 상태가 이긴다. 못 읽었으면 카드에 적힌 마감 시각만 보고, 지났으면 닫힌 카드다.
 * 못 찾았으면(다른 커플의 카드이거나 지워졌다) 맡을 수 없다고 한다.
 * @param {Pick<AmoraTaskOffer, "offerExpiresAt">} offer
 * @param {AmoraTaskDetailRead} read
 * @param {number} nowMs
 * @returns {AmoraTaskOfferPhase}
 */
export function amoraTaskOfferPhase(offer, read, nowMs) {
  if (read.kind === "off") return "off";
  if (read.kind === "not_found") return "unavailable";
  if (read.kind === "ready") {
    const { status } = read.detail;
    if (status === "offered") return offerHasLapsed(offer, nowMs) ? "expired" : "open";
    if (status === "expired") return "expired";
    if (status === "cancelled") return "cancelled";
    return "started";
  }
  return offerHasLapsed(offer, nowMs) ? "expired" : "open";
}

/**
 * 카드 모습마다 보일 한 줄(`AMORA_TASK_COPY` 의 이름). 맡기기 단추가 있는 모습(open)과 그리지 않는 모습(off)에는 없다.
 * @param {AmoraTaskOfferPhase} phase
 * @returns {AmoraTaskOfferPhaseCopyKey | null}
 */
export function amoraTaskOfferPhaseCopyKey(phase) {
  if (phase === "started") return "offerStarted";
  if (phase === "cancelled") return "cancelled";
  if (phase === "expired") return "offerExpired";
  if (phase === "unavailable") return "offerUnavailable";
  if (phase === "limit") return "dailyTaskLimit";
  return null;
}
