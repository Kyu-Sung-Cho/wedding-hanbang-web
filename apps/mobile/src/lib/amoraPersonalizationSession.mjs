import {
  AMORA_PERSONALIZATION_FIELD_NAMES,
  AMORA_PERSONALIZATION_SECTIONS,
  DEFAULT_AMORA_PERSONALIZATION,
  isAmoraPersonalizationChanges,
  parseAmoraPersonalizationProfile,
} from "@hanbang/shared/amora-personalization";

// 앱 「아모라 도움 방식」 설정의 상태와 요청. 웹 `useAmoraPersonalization` 과 같은 계약을 쓰되,
// 커플 조건 없이 소유자 한 사람만 본다 — 파트너가 없는 사람도 자기 설정을 확인·수정·삭제한다.

export const AMORA_PERSONALIZATION_PATH = "/api/amora/personalization";
const EXPECTED_OWNER_HEADER = "X-Amora-Expected-Owner";

/** 웹 설정 화면(`settings/amora-style/page.tsx`)과 웹 훅이 쓰는 문장 그대로다. */
export const AMORA_STYLE_COPY = Object.freeze({
  title: "아모라 도움 방식",
  eyebrow: "MY AMORA",
  introTitle: "편한 말투와 도움 순서를 직접 골라요",
  introBody: "설정은 나에게만 보관됩니다. 답변 표현과 제안 순서에만 사용하며 예산·일정·담당자는 확인 없이 바꾸지 않아요.",
  loading: "도움 방식을 불러오는 중...",
  loadFailed: "도움 방식을 불러오지 못했어요.",
  loadUnsafe: "저장된 도움 방식을 안전하게 읽지 못했어요.",
  retry: "다시 불러오기",
  noSavedProfile: "아직 저장한 도움 방식이 없어요",
  savedProfilePrefix: "내 설정 · ",
  savedDateFallback: "직접 확인됨",
  precedence: "현재 질문이 저장값과 다르면 방금 한 말이 우선해요.",
  save: "변경 저장",
  saving: "저장 중...",
  saved: "내 도움 방식으로 저장했어요.",
  saveFailed: "도움 방식을 저장하지 못했어요.",
  saveUnverified: "저장 결과를 안전하게 확인하지 못했어요.",
  resetTrigger: "저장한 도움 방식 모두 지우기",
  resetConfirmBody: "저장한 값만 삭제하고 대화·예산·일정은 그대로 유지해요.",
  resetConfirm: "모두 지우기",
  resetCancel: "취소",
  resetDone: "저장한 도움 방식을 모두 지웠어요.",
  resetFailed: "도움 방식을 초기화하지 못했어요.",
  resetUnverified: "초기화 결과를 확인하지 못했어요.",
});

const empty = (ownerId) => ({
  ownerId,
  status: "idle",
  profile: null,
  draft: null,
  pending: null,
  error: null,
  notice: null,
});

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const samePreferences = (left, right) =>
  AMORA_PERSONALIZATION_FIELD_NAMES.every((field) => left[field] === right[field]);
/** 서버가 5필드 옛 경로로 받지 않도록 6필드를 늘 같은 순서로 채운다. */
const fullPreferences = (preferences) =>
  Object.fromEntries(AMORA_PERSONALIZATION_FIELD_NAMES.map((field) => [field, preferences[field]]));

/**
 * 409 는 서버가 사용자에게 쓴 한국어 안내를 그대로 보여 준다(웹과 같다). 그 밖의 실패는 서버 원문
 * ("서버 오류", 영문 오류)을 옮기지 않고 앱이 정한 문장을 쓴다.
 */
function conflictCopy(payload, fallback) {
  return isRecord(payload)
    && typeof payload.error === "string"
    && payload.error.length <= 200
    && /[가-힣]/u.test(payload.error)
    ? payload.error
    : fallback;
}

async function readPayload(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function formatAmoraPersonalizationDate(value) {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // 웹의 Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" }) 과 같은 표기.
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

export function viewAmoraPersonalization(state) {
  const baseline = state.profile ? state.profile.preferences : DEFAULT_AMORA_PERSONALIZATION;
  const selected = state.draft ?? baseline;
  const dirty = state.draft !== null && !samePreferences(state.draft, baseline);
  const ready = state.status === "ready";
  const idle = ready && state.pending === null;
  return {
    selected,
    dirty,
    showChoices: ready,
    canSelect: idle,
    canSave: idle && dirty,
    showReset: ready && state.profile !== null,
    canReset: idle && state.profile !== null,
    savedLine: state.profile
      ? `${AMORA_STYLE_COPY.savedProfilePrefix}${formatAmoraPersonalizationDate(state.profile.updatedAt) ?? AMORA_STYLE_COPY.savedDateFallback}`
      : AMORA_STYLE_COPY.noSavedProfile,
    saveLabel: state.pending === "save" ? AMORA_STYLE_COPY.saving : AMORA_STYLE_COPY.save,
  };
}

/** 화면이 그리는 칸과 선택지. 글자는 전부 공유 상수에서 온다. */
export function buildAmoraStyleSections(selected) {
  return AMORA_PERSONALIZATION_SECTIONS.map((section) => ({
    key: section.key,
    title: section.title,
    description: section.description,
    choices: section.choices.map((choice) => ({
      value: choice.value,
      label: choice.label,
      description: choice.description,
      selected: selected[section.key] === choice.value,
    })),
  }));
}

/**
 * `request(owner, path, init)` 는 앱에서 `apiFetchForExpectedUser` 다 — 세션 소유자가 `owner` 와
 * 다르면 요청 자체를 보내지 않는다. `readSessionOwner` 는 응답을 반영하기 직전에 지금 세션의
 * 소유자를 다시 읽는다. 계정 전환 알림보다 응답이 먼저 와도 다른 계정 화면에 값을 올리지 않는다.
 */
export function createAmoraPersonalizationSession(request, options = {}) {
  const readSessionOwner = typeof options.readSessionOwner === "function" ? options.readSessionOwner : null;
  let state = empty(options.initialOwnerId ?? null);
  let epoch = 0;
  let sequence = 0;
  const listeners = new Set();
  const emit = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const identity = () => ({ owner: state.ownerId, epoch });
  const current = (token, requestSequence) =>
    token.owner !== null && state.ownerId === token.owner && epoch === token.epoch && sequence === requestSequence;

  /** 'stale' 이면 이미 다른 화면 상태다 — 아무것도 바꾸지 않는다. 'foreign' 이면 결과를 믿지 않는다. */
  const settle = async (token, requestSequence) => {
    if (!current(token, requestSequence)) return "stale";
    if (!readSessionOwner) return "ok";
    let live = null;
    try {
      live = await readSessionOwner();
    } catch {
      live = null;
    }
    if (!current(token, requestSequence)) return "stale";
    return typeof live === "string" && live.toLowerCase() === token.owner.toLowerCase() ? "ok" : "foreign";
  };

  /** 서버의 지금 상태를 모른다. 고를 수 있는 값을 내리고 다시 불러오게 한다. */
  const fail = (message) => emit({ status: "error", profile: null, draft: null, pending: null, notice: null, error: message });

  const send = async (token, method, body) => {
    const init = body === undefined
      ? { method, headers: { [EXPECTED_OWNER_HEADER]: token.owner } }
      : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    const response = await request(token.owner, AMORA_PERSONALIZATION_PATH, init);
    return { response, payload: await readPayload(response) };
  };

  const applyFailure = (response, payload, fallback) => {
    const code = isRecord(payload) ? payload.code : undefined;
    const message = response.status === 409 ? conflictCopy(payload, fallback) : fallback;
    if (code === "PERSONALIZATION_OWNER_MISMATCH") {
      fail(message);
      return;
    }
    if (response.status === 409 && code === "PERSONALIZATION_REVISION_CONFLICT") {
      // 초안은 버리고 서버가 알려 준 현재 값을 저장 상태로 받는다. 다시 보내지 않는다.
      if (hasOwn(payload, "current") && payload.current === null) {
        emit({ status: "ready", profile: null, draft: null, pending: null, notice: null, error: message });
        return;
      }
      const latest = hasOwn(payload, "current") ? parseAmoraPersonalizationProfile(payload.current) : null;
      if (latest) {
        emit({ status: "ready", profile: latest, draft: null, pending: null, notice: null, error: message });
        return;
      }
      fail(message);
      return;
    }
    // PERSONALIZATION_PROFILE_REQUIRED 와 그 밖의 실패: 저장 상태는 그대로, 안내만 보인다.
    emit({ pending: null, notice: null, error: message });
  };

  const load = async () => {
    if (state.pending !== null) return false;
    const token = identity();
    if (!token.owner) {
      emit({ ...empty(null), status: "error", error: AMORA_STYLE_COPY.loadFailed });
      return false;
    }
    const requestSequence = ++sequence;
    emit({ status: "loading", profile: null, draft: null, error: null, notice: null });
    try {
      const { response, payload } = await send(token, "GET");
      const check = await settle(token, requestSequence);
      if (check === "stale") return false;
      if (check === "foreign" || !response.ok) {
        fail(response.status === 409 && check === "ok" ? conflictCopy(payload, AMORA_STYLE_COPY.loadFailed) : AMORA_STYLE_COPY.loadFailed);
        return false;
      }
      const saved = isRecord(payload) && payload.profile === null
        ? null
        : parseAmoraPersonalizationProfile(isRecord(payload) ? payload.profile : undefined);
      if (!saved && !(isRecord(payload) && payload.profile === null)) {
        fail(AMORA_STYLE_COPY.loadUnsafe);
        return false;
      }
      emit({ status: "ready", profile: saved, draft: null, pending: null, error: null, notice: null });
      return true;
    } catch {
      if (current(token, requestSequence)) fail(AMORA_STYLE_COPY.loadFailed);
      return false;
    }
  };

  const select = (key, value) => {
    if (state.status !== "ready" || state.pending !== null || typeof value !== "string") return false;
    const change = { [key]: value };
    if (!isAmoraPersonalizationChanges(change)) return false;
    emit({ draft: { ...viewAmoraPersonalization(state).selected, ...change }, notice: null });
    return true;
  };

  const save = async () => {
    const token = identity();
    const view = viewAmoraPersonalization(state);
    if (!token.owner || !view.canSave) return false;
    const preferences = fullPreferences(view.selected);
    const expectedRevision = state.profile ? state.profile.revision : null;
    const requestSequence = ++sequence;
    emit({ pending: "save", error: null, notice: null });
    try {
      const { response, payload } = await send(token, "PUT", {
        expectedOwnerUserId: token.owner,
        expectedRevision,
        preferences,
      });
      const check = await settle(token, requestSequence);
      if (check === "stale") return false;
      if (check === "foreign") {
        fail(AMORA_STYLE_COPY.saveUnverified);
        return false;
      }
      if (!response.ok) {
        applyFailure(response, payload, AMORA_STYLE_COPY.saveFailed);
        return false;
      }
      const saved = parseAmoraPersonalizationProfile(isRecord(payload) ? payload.profile : undefined);
      // 서버가 돌려준 여섯 값이 보낸 값과 같을 때만 저장했다고 말한다.
      if (!saved || !samePreferences(saved.preferences, preferences)) {
        fail(AMORA_STYLE_COPY.saveUnverified);
        return false;
      }
      emit({ status: "ready", profile: saved, draft: null, pending: null, error: null, notice: AMORA_STYLE_COPY.saved });
      return true;
    } catch {
      if (current(token, requestSequence)) emit({ pending: null, notice: null, error: AMORA_STYLE_COPY.saveFailed });
      return false;
    }
  };

  const reset = async () => {
    const token = identity();
    if (!token.owner || !viewAmoraPersonalization(state).canReset) return false;
    const expectedRevision = state.profile.revision;
    const requestSequence = ++sequence;
    emit({ pending: "reset", error: null, notice: null });
    try {
      const { response, payload } = await send(token, "DELETE", {
        expectedRevision,
        expectedOwnerUserId: token.owner,
      });
      const check = await settle(token, requestSequence);
      if (check === "stale") return false;
      if (check === "foreign") {
        fail(AMORA_STYLE_COPY.resetUnverified);
        return false;
      }
      if (!response.ok) {
        applyFailure(response, payload, AMORA_STYLE_COPY.resetFailed);
        return false;
      }
      if (!isRecord(payload) || payload.deleted !== true || payload.profile !== null) {
        fail(AMORA_STYLE_COPY.resetUnverified);
        return false;
      }
      emit({ status: "ready", profile: null, draft: null, pending: null, error: null, notice: AMORA_STYLE_COPY.resetDone });
      return true;
    } catch {
      if (current(token, requestSequence)) emit({ pending: null, notice: null, error: AMORA_STYLE_COPY.resetFailed });
      return false;
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** 소유자가 실제로 바뀌었을 때만 상태를 비우고 true 를 돌려준다. 토큰 갱신은 초안을 지우지 않는다. */
    setOwner: (ownerId) => {
      const next = typeof ownerId === "string" && ownerId ? ownerId : null;
      if (next === state.ownerId) return false;
      epoch += 1;
      sequence += 1;
      state = empty(next);
      listeners.forEach((listener) => listener());
      return true;
    },
    /**
     * 화면을 떠나면 늦은 응답을 버리고, 다시 붙을 때(개발 StrictMode 포함) 처음부터 불러오게 비운다.
     * 구독은 React(useSyncExternalStore)가 스스로 푼다 — 여기서 지우면 다시 붙은 구독까지 끊길 수 있다.
     */
    dispose: () => {
      epoch += 1;
      sequence += 1;
      state = empty(null);
    },
    load,
    select,
    save,
    reset,
  };
}
