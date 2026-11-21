/**
 * 아모라가 맡은 일(D-84, 25장 갈래 4)을 웹과 앱이 같은 말과 같은 규칙으로 읽는 계약.
 *
 * ## 무엇이 여기 있나
 *
 * - 맡은 일의 종류와 상태, 홈에 보이는 네 단계(찾는 중, 정리 중, 확인해 주세요, 끝남)
 * - 화면 문장(D-12 승인 대기). 웹과 앱이 이 상수만 쓴다. 문장을 바꾸면 PR 표도 같이 바꾼다.
 * - 서버 응답을 읽는 함수. **모르는 값은 버린다.** 상태나 종류가 이 목록에 없으면 그 줄을
 *   그리지 않는다. 서버가 새 상태를 먼저 내보내도 옛 앱이 엉뚱한 단계를 그리지 않게 한다.
 *
 * ## 지키는 것
 *
 * - 결과 표의 값은 서버가 저장한 글 그대로다. 여기서 순위나 점수를 만들지 않는다(I14).
 * - 링크는 https 주소만 링크로 준다. 그 밖은 글자로 둔다(08장 H4).
 * - 다음에 할 일은 대화 입력칸에 채워 넣을 글이다. 눌러도 바로 반영되지 않는다.
 *   반영은 대화의 확인 카드를 사람이 누를 때만 일어난다(01장 I1).
 */

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export const AMORA_TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 1차로 맡는 일. 순서는 화면에 보이는 순서다. */
export const AMORA_TASK_KINDS = Object.freeze([
  'hall_candidates',
  'sdm_candidates',
  'quote_compare',
  'todo_deadlines',
  'inquiry_letters',
  'reply_digest',
  'date_candidates',
]);

export const AMORA_TASK_KIND_LABELS = Object.freeze({
  hall_candidates: '웨딩홀 후보 찾기',
  sdm_candidates: '스드메 후보 찾기',
  quote_compare: '받은 견적 비교',
  todo_deadlines: '할 일과 마감 정리',
  inquiry_letters: '업체별 문의 편지 초안',
  reply_digest: '받은 답장 정리',
  date_candidates: '날짜 후보 모으기',
});

/** DB 의 상태 전부. `offered` 는 카드만 나온 상태이고 홈에는 보이지 않는다. */
export const AMORA_TASK_STATUSES = Object.freeze([
  'offered',
  'queued',
  'searching',
  'organizing',
  'needs_review',
  'done',
  'cancelled',
  'expired',
]);

/** 홈에 보이는 네 단계. */
export const AMORA_TASK_STAGES = Object.freeze(['searching', 'organizing', 'needs_review', 'done']);

export const AMORA_TASK_STAGE_LABELS = Object.freeze({
  searching: '찾는 중',
  organizing: '정리 중',
  needs_review: '확인해 주세요',
  done: '끝남',
});

/** 상태를 홈의 단계로 바꾼다. 홈에 보이지 않는 상태는 null. */
export function amoraTaskStage(status) {
  if (status === 'queued' || status === 'searching') return 'searching';
  if (status === 'organizing') return 'organizing';
  if (status === 'needs_review') return 'needs_review';
  if (status === 'done') return 'done';
  return null;
}

/** 멈춘 까닭. 서버가 정한 값만 받는다. */
export const AMORA_TASK_REVIEW_REASONS = Object.freeze([
  'daily_step_limit',
  'daily_search_limit',
  'background_budget',
  'task_step_limit',
  'gate_blocked',
  'needs_input',
  'source_unavailable',
  'failed',
  'stale',
]);

/** 이어서 하기를 보여 줄 수 있는 까닭. 한도와 일시적인 문제만이다. */
export const AMORA_TASK_RESUMABLE_REASONS = Object.freeze([
  'daily_step_limit',
  'daily_search_limit',
  'background_budget',
  'source_unavailable',
  'failed',
]);

/**
 * 화면 문장. D-12 승인 대기다(PR 설명의 표와 같다).
 * 줄표, 겹친 부정, 시스템 말투, 명사형 끝을 쓰지 않는다.
 */
export const AMORA_TASK_COPY = Object.freeze({
  homeTitle: '아모라가 맡은 일',
  homeMore: '모두 보기',
  offerTitle: '이 일을 맡을게요',
  offerBody: '대화를 닫아도 이어서 할게요. 진행은 라운지에서 볼 수 있어요.',
  offerStart: '맡기기',
  offerStarting: '맡기는 중이에요',
  offerStarted: '맡았어요. 라운지에서 진행을 볼 수 있어요.',
  offerOpen: '진행 보기',
  offerExpired: '시간이 지나 닫힌 카드예요. 다시 부탁해 주세요.',
  offerUnavailable: '지금은 이 일을 맡을 수 없어요.',
  startFailed: '맡기지 못했어요. 잠시 뒤에 다시 눌러 주세요.',
  dailyTaskLimit: '오늘 맡을 수 있는 일을 모두 맡겼어요. 내일 다시 부탁해 주세요.',
  resultTableTitle: '같은 기준으로 모은 표',
  resultTableNote: '찾은 결과를 같은 기준으로 모았어요. 순위나 추천은 하지 않았어요.',
  resultSourcesTitle: '출처',
  resultCheckedOn: (ymd) => `${formatKoreanYmd(ymd)} 확인`,
  resultNextTitle: '다음에 할 일',
  resultNextNote: '누르면 대화 입력칸에 글이 채워져요. 보내고 나서 확인 카드를 눌러야 반영돼요.',
  resultNextButton: '대화에서 이어 하기',
  priceUnknown: '업체에 확인해 주세요',
  cancel: '그만하기',
  cancelled: '그만두었어요.',
  resume: '이어서 하기',
  back: '돌아가기',
  empty: '맡긴 일이 아직 없어요. 대화에서 "웨딩홀 후보 찾아 줘"처럼 부탁해 보세요.',
  loadFailed: '맡은 일을 불러오지 못했어요.',
  retry: '다시 불러오기',
  actionFailed: '지금은 처리하지 못했어요. 잠시 뒤에 다시 눌러 주세요.',
  stepsTitle: '지금까지 한 일',
  reviewReasons: Object.freeze({
    daily_step_limit: '오늘 쓸 수 있는 몫을 다 써서 멈췄어요. 내일 이어서 할 수 있어요.',
    daily_search_limit: '오늘 찾아볼 수 있는 횟수를 다 써서 멈췄어요. 내일 이어서 할 수 있어요.',
    background_budget: '오늘은 맡은 일이 많아 쉬어 가고 있어요. 잠시 뒤에 이어서 할 수 있어요.',
    task_step_limit: '생각보다 오래 걸려서 여기까지 정리했어요. 결과를 확인해 주세요.',
    gate_blocked: '이 일은 맡을 수 없어요.',
    needs_input: '더 알아야 할 것이 있어요. 대화에서 알려 주세요.',
    source_unavailable: '찾아볼 곳에 지금 닿지 못해 멈췄어요. 잠시 뒤에 이어서 할 수 있어요.',
    failed: '정리하다 문제가 생겨 멈췄어요. 이어서 해 볼 수 있어요.',
    stale: '오래 멈춰 있어서 닫았어요. 다시 부탁해 주세요.',
  }),
});

export function formatKoreanYmd(ymd) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof ymd === 'string' ? ymd : '');
  if (!match) return '';
  return `${Number(match[1])}년 ${Number(match[2])}월 ${Number(match[3])}일`;
}

/** 앱의 맡은 일 화면 주소. 앱 알림의 deepLink 도 이 모양이다. */
export function amoraTaskAppPath(taskId) {
  if (typeof taskId !== 'string' || !AMORA_TASK_ID_PATTERN.test(taskId)) return null;
  return `/amora-task/${taskId.toLowerCase()}`;
}

/** 웹의 맡은 일 화면 주소(`/wedding/...`). */
export function amoraTaskWebPath(taskId) {
  if (typeof taskId !== 'string' || !AMORA_TASK_ID_PATTERN.test(taskId)) return null;
  return `/wedding/amora-tasks/${taskId.toLowerCase()}`;
}

const MAX_TITLE = 80;
const MAX_CELL = 160;
const MAX_COLUMNS = 8;
const MAX_ROWS = 20;
const MAX_SOURCES = 20;
const MAX_NEXT = 5;
const MAX_STEPS = 30;
const MAX_SUMMARY = 600;
const MAX_PROMPT = 300;
const MAX_LABEL = 60;
const SOURCE_ID = /^[a-z]{1,3}[0-9]{1,3}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

function text(value, max) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(UNSAFE_TEXT, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return [...cleaned].slice(0, max).join('');
}

function isoOrNull(value) {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** https 주소만 링크로 쓴다. 그 밖은 null(글자로만 보인다). */
export function safeAmoraTaskSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  return parsed.toString();
}

function parseSummary(value) {
  if (!object(value)) return null;
  if (typeof value.id !== 'string' || !AMORA_TASK_ID_PATTERN.test(value.id)) return null;
  if (!AMORA_TASK_KINDS.includes(value.kind)) return null;
  if (!AMORA_TASK_STATUSES.includes(value.status)) return null;
  const title = text(value.title, MAX_TITLE);
  if (!title) return null;
  const reviewReason = AMORA_TASK_REVIEW_REASONS.includes(value.reviewReason) ? value.reviewReason : null;
  return {
    id: value.id.toLowerCase(),
    kind: value.kind,
    title,
    status: value.status,
    stage: amoraTaskStage(value.status),
    reviewReason,
    createdAt: isoOrNull(value.createdAt),
    startedAt: isoOrNull(value.startedAt),
    finishedAt: isoOrNull(value.finishedAt),
    updatedAt: isoOrNull(value.updatedAt),
  };
}

/**
 * `GET /api/amora/tasks` 응답을 읽는다.
 * 스위치가 꺼졌거나 표가 아직 없으면 서버는 `{ enabled:false }` 나 `{ available:false }` 를 준다.
 * 그때 화면은 아무것도 그리지 않는다(앱이 DB 보다 먼저 나가도 홈이 깨지지 않는다).
 */
export function parseAmoraTaskList(payload) {
  if (!object(payload)) return { visible: false, tasks: [] };
  if (payload.enabled !== true || payload.available !== true) return { visible: false, tasks: [] };
  const raw = Array.isArray(payload.tasks) ? payload.tasks.slice(0, 20) : [];
  const tasks = raw.map(parseSummary).filter((task) => task !== null && task.stage !== null);
  return { visible: true, tasks };
}

function parseResult(value) {
  if (!object(value)) return null;
  const columns = Array.isArray(value.columns)
    ? value.columns.slice(0, MAX_COLUMNS).map((column) => text(column, MAX_LABEL))
    : [];
  if (columns.length === 0 || columns.some((column) => column === null)) return null;
  const sources = (Array.isArray(value.sources) ? value.sources.slice(0, MAX_SOURCES) : [])
    .map((source) => {
      if (!object(source) || typeof source.id !== 'string' || !SOURCE_ID.test(source.id)) return null;
      const title = text(source.title, MAX_CELL);
      if (!title) return null;
      return {
        id: source.id,
        title,
        url: safeAmoraTaskSourceUrl(source.url),
        checkedOn: typeof source.checkedOn === 'string' && YMD.test(source.checkedOn) ? source.checkedOn : null,
      };
    })
    .filter((source) => source !== null);
  const sourceIds = new Set(sources.map((source) => source.id));
  const rows = (Array.isArray(value.rows) ? value.rows.slice(0, MAX_ROWS) : [])
    .map((row) => {
      if (!object(row) || !Array.isArray(row.cells)) return null;
      const cells = row.cells.slice(0, columns.length).map((cell) => text(cell, MAX_CELL) ?? '');
      while (cells.length < columns.length) cells.push('');
      const ids = Array.isArray(row.sourceIds)
        ? row.sourceIds.filter((id) => typeof id === 'string' && sourceIds.has(id)).slice(0, 6)
        : [];
      return { cells, sourceIds: ids };
    })
    .filter((row) => row !== null && row.cells.some((cell) => cell !== ''));
  const nextActions = (Array.isArray(value.nextActions) ? value.nextActions.slice(0, MAX_NEXT) : [])
    .map((action) => {
      if (!object(action)) return null;
      const label = text(action.label, MAX_LABEL);
      const prompt = text(action.prompt, MAX_PROMPT);
      return label && prompt ? { label, prompt } : null;
    })
    .filter((action) => action !== null);
  return {
    summary: text(value.summary, MAX_SUMMARY),
    columns,
    rows,
    sources,
    nextActions,
  };
}

/** `GET /api/amora/tasks/:id` 응답을 읽는다. 못 읽으면 null. */
export function parseAmoraTaskDetail(payload) {
  if (!object(payload) || payload.enabled !== true || payload.available !== true) return null;
  const summary = parseSummary(payload.task);
  if (!summary) return null;
  const task = payload.task;
  const steps = (Array.isArray(task.steps) ? task.steps.slice(-MAX_STEPS) : [])
    .map((step) => {
      if (!object(step)) return null;
      const label = text(step.label, MAX_LABEL);
      const at = isoOrNull(step.at);
      return label && at ? { label, at } : null;
    })
    .filter((step) => step !== null);
  const resumable = summary.status === 'needs_review'
    && summary.reviewReason !== null
    && AMORA_TASK_RESUMABLE_REASONS.includes(summary.reviewReason);
  const cancellable = summary.status === 'queued'
    || summary.status === 'searching'
    || summary.status === 'organizing'
    || summary.status === 'needs_review';
  return {
    ...summary,
    steps,
    result: parseResult(task.result),
    resumable,
    cancellable,
  };
}

/** 대화 카드(`offer_amora_task` 도구 결과)를 읽는다. 못 읽으면 null. */
export function parseAmoraTaskOffer(toolOutput) {
  if (!object(toolOutput)) return null;
  if (toolOutput.offer_kind !== 'amora_task_offer_v1') return null;
  if (typeof toolOutput.task_id !== 'string' || !AMORA_TASK_ID_PATTERN.test(toolOutput.task_id)) return null;
  if (!AMORA_TASK_KINDS.includes(toolOutput.kind)) return null;
  const title = text(toolOutput.title, MAX_TITLE);
  if (!title) return null;
  const expiresAt = isoOrNull(toolOutput.offer_expires_at);
  const plan = (Array.isArray(toolOutput.plan) ? toolOutput.plan.slice(0, 4) : [])
    .map((line) => text(line, MAX_LABEL))
    .filter((line) => line !== null);
  return {
    taskId: toolOutput.task_id.toLowerCase(),
    kind: toolOutput.kind,
    title,
    plan,
    offerExpiresAt: expiresAt,
  };
}
