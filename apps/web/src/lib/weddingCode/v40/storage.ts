/**
 * 웨딩코드 4.0 이 브라우저 저장(StorageModule, 설계 6절 저장과 수정, README 7절 8, 16, 17항).
 *
 * v3.1 진행 저장(v31LocalProgress)을 본떠 v4 용으로 새로 만들었다. v3.1 모듈은 가져오지 않는다(이전 판 진행 저장은 키 문자열과 savedAt 만 읽는다).
 * 저장소는 인자로 받는 StorageLike 이고, 이 파일이 v4 에서 브라우저 저장소의 이름(window.localStorage)을 부르는 유일한 자리다(계약 문서 9.3절).
 * 클라이언트는 아래 browserStorage() 로 핸들을 받아 이 파일의 함수에 넘기기만 한다. 소스 가드(규칙 5)가 그 밖의 파일이 저장소 이름, 저장소 메서드, 저장 키를
 * 만지는 것을 막고, 이 파일의 시험이 저장소 이름이 browserStorage 안에만 있음을 확인한다.
 * 저장소가 막히거나 가득 차거나 깨진 값을 줘도 던지지 않고 상태 이름(empty, invalid, expired, unavailable, conflict, off)으로 답한다.
 * 받은 링크의 상대 답과 두 사람 결과 화면의 답은 저장하지 않는다(호출자 몫: 본인 답만 넘긴다).
 * 저장하는 것은 폼 비트와 답(문항 68자)과 이어 할 자리뿐이고, 결과 기록에는 글자, 세기, 시각, 폼 비트만 남는다.
 */
import { V40_AXIS_KEYS, V40_STORAGE, V40_UNANSWERED_CHAR, WEDDING_CODE_V40_VERSION, axisOfLetter, isLetter } from "@/constants/weddingCodeV40";
import type {
  AppendResult,
  Bank,
  HistoryAxis,
  HistoryEntry,
  HistoryEnvelope,
  HistoryRead,
  LegacyProgressProbe,
  Letter,
  ProgressEnvelope,
  ProgressRead,
  ProgressSnapshot,
  ProgressWrite,
  PurgeResult,
  Responses,
  StorageLike,
  StrengthBand,
} from "./types";
import type { StorageModule } from "./contract";
import { fromCodeChar, isResponseValueFor, responseAt, toCodeChar } from "./states";

/** 진행 저장 봉투의 스키마 번호. */
const PROGRESS_SCHEMA = 1;
/** 결과 기록 봉투 길이 상한(항목 3건은 1000자 안팎이라 넉넉하게 둔다). */
const MAX_HISTORY_LENGTH = 2048;
/** 이전 판 진행 저장 원문에서 savedAt 을 찾아볼 길이 상한(v3.1 봉투 상한의 두 배). */
const MAX_LEGACY_LENGTH = 4096;

const PROGRESS_KEYS = ["schema", "version", "savedAt", "formBit", "answers", "screen", "cursor", "skippedReviewDone"] as const;
const HISTORY_KEYS = ["schema", "version", "entries"] as const;
const ENTRY_KEYS = ["at", "formBit", "axes"] as const;
const HISTORY_AXIS_KEYS = ["letter", "band", "provisional"] as const;

// ---------------------------------------------------------------------------
// 브라우저 저장소 핸들
// ---------------------------------------------------------------------------

/**
 * 이 브라우저의 저장소 핸들(계약 문서 9.3절). v4 에서 window.localStorage 라는 이름이 나오는 유일한 자리다.
 * 서버 렌더링에는 window 가 없고, 개인정보 보호 모드나 앱 안 브라우저는 저장소에 닿는 것만으로 던지므로 그런 경우는 null 이다(던지지 않는다).
 * 저장소가 막힌 브라우저에서는 루트 레이아웃의 대체 스니펫(lib/browserStorageFallback.ts)이 window.localStorage 를 메모리 객체로 갈아 끼운다.
 * 그 객체는 쓰고 읽어도 탭을 닫으면 사라지므로 진짜 저장소가 아니다. 그걸 그대로 돌려주면 「저장했어요」라고 말하고 새로고침에 답을 잃는다.
 * 그래서 브라우저가 만든 진짜 Storage 만 돌려주고(Object.prototype.toString 이 [object Storage]), 아니면 null 로 답해 저장할 수 없다고 알린다.
 * 받은 핸들은 이 파일의 함수(readProgress, writeProgress, …)에 넘기기만 한다. 핸들에 getItem, setItem, removeItem 을 직접 부르거나 저장 키를 읽으면
 * 끄기의 지우기와 쓰기 뒤 읽어 확인하기를 건너뛰게 되어 소스 가드가 막는다.
 */
export function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    const handle = window.localStorage;
    if (handle === null || handle === undefined) return null;
    return Object.prototype.toString.call(handle) === "[object Storage]" ? handle : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 공통 도우미
// ---------------------------------------------------------------------------

/** 순수 객체(배열과 특수 객체는 아님)인가. */
function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(record);
  return own.length === keys.length && own.every((key) => keys.includes(key));
}

/** 0 이상의 안전한 정수(밀리초 시각)인가. */
function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

type RawRead = { readonly ok: true; readonly raw: string | null } | { readonly ok: false };

/** 키의 원문을 읽는다. 접근이 던지면 ok false, 값이 없으면 raw null. 문자열이 아닌 값은 문자열로 바꿔 검사에서 걸러지게 한다. */
function readRaw(storage: StorageLike, key: string): RawRead {
  try {
    const raw: unknown = storage.getItem(key);
    if (raw === null || raw === undefined) return { ok: true, raw: null };
    return { ok: true, raw: typeof raw === "string" ? raw : String(raw) };
  } catch {
    return { ok: false };
  }
}

/** 쓰고 다시 읽어 같은지 확인한다(저장 안 됐는데 저장됐다고 말하지 않는다). */
function writeVerified(storage: StorageLike, key: string, raw: string): boolean {
  try {
    storage.setItem(key, raw);
  } catch {
    return false;
  }
  const back = readRaw(storage, key);
  return back.ok && back.raw === raw;
}

function removeKey(storage: StorageLike, key: string): boolean {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * 키의 원문이 raw 그대로일 때만 지운다(그 사이 다른 탭이 새로 쓴 값을 지우지 않는다). 이미 비어 있거나 지웠으면 true,
 * 원문이 달라졌거나 접근이 던지면 false. 확인과 지우기 사이는 이어져 있지 않다(브라우저 저장소는 원자적 비교 지우기를 주지 않는다).
 */
function removeIfUnchanged(storage: StorageLike, key: string, raw: string): boolean {
  const current = readRaw(storage, key);
  if (!current.ok) return false;
  if (current.raw === null) return true;
  return current.raw === raw ? removeKey(storage, key) : false;
}

/** 키의 원문이 raw 그대로일 때만 next 로 바꿔 쓴다. 바꿨으면 true. 실패하면 던지지 않고 false(기간이 지난 건을 덜어 내는 최선 노력 정리에 쓴다). */
function rewriteIfUnchanged(storage: StorageLike, key: string, raw: string, next: string): boolean {
  const current = readRaw(storage, key);
  if (!current.ok || current.raw !== raw) return false;
  return writeVerified(storage, key, next);
}

// ---------------------------------------------------------------------------
// 진행 저장
// ---------------------------------------------------------------------------

/**
 * 진행 저장용 문항 68자 표기(README 4절 끝: 링크 코드와 다른 표기). 답하지 않은 문항은 점, 건너뜀은 -, 해당 없음은 _, 나머지는 그 형식의 상태 문자.
 * 상태 문자가 그 형식에 맞지 않는 문항이 하나라도 있으면 null. 체크섬과 폼 비트는 없다.
 */
export function encodeProgressAnswers(bank: Bank, responses: Responses): string | null {
  let out = "";
  for (const item of bank.items) {
    const value = responseAt(responses, item.id);
    if (value === undefined) {
      out += V40_UNANSWERED_CHAR;
      continue;
    }
    if (!isResponseValueFor(item.fmt, value)) return null;
    out += toCodeChar(value);
  }
  return out;
}

/** encodeProgressAnswers 의 역. 길이가 68이 아니거나 위치별로 쓸 수 없는 문자가 있으면 null. 점은 답하지 않은 문항이라 응답에 넣지 않는다. */
export function decodeProgressAnswers(bank: Bank, answers: string): Responses | null {
  if (typeof answers !== "string" || answers.length !== bank.items.length) return null;
  const responses: Record<string, string> = {};
  for (let index = 0; index < bank.items.length; index += 1) {
    const char = answers[index];
    if (char === V40_UNANSWERED_CHAR) continue;
    const value = fromCodeChar(char);
    const item = bank.items[index];
    if (value === null || !isResponseValueFor(item.fmt, value)) return null;
    responses[item.id] = value;
  }
  return responses;
}

/**
 * 진행 저장 읽기(설계 6절 저장과 수정). empty(없음), invalid(형식 위반), expired(마지막 저장부터 30일 지남), unavailable(접근 실패), ready.
 * 봉투는 여덟 키가 정확히 있어야 하고 savedAt 이 지금보다 미래이면 invalid 다. 읽기만으로 저장 기간을 늘리지 않는다.
 * 읽기는 저장소에 아무것도 쓰지 않는다(처리방침: 읽어도 저장된 내용이 바뀌지 않는다. 두 사람 결과 화면이 「나」 표시를 위해 이 함수를 부른다).
 * 그래서 expired 여도 지우지 않는다. 기간이 지난 저장을 실제로 지우는 일은 purgeExpired 가 맡고, 시작 화면이 expired 를 보면 그것을 부른다.
 * invalid 도 지우지 않는다(시계가 어긋났거나 다른 판이 쓴 값일 수 있다: 호출자가 clearProgress 하거나 덮어쓴다).
 * 결과 객체의 raw 는 답 전체를 담고 있으니 다음 쓰기의 expectedRaw 로만 쓰고 기록이나 통계로 보내지 않는다.
 */
export function readProgress(storage: StorageLike, bank: Bank, now: number = Date.now()): ProgressRead {
  const read = readRaw(storage, V40_STORAGE.progressKey);
  if (!read.ok) return { status: "unavailable", raw: null };
  const raw = read.raw;
  if (!isTimestamp(now)) return { status: "invalid", raw };
  if (raw === null) return { status: "empty", raw };
  if (raw.length > V40_STORAGE.maxEnvelopeLength) return { status: "invalid", raw };
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !hasExactKeys(value, PROGRESS_KEYS)) return { status: "invalid", raw };
    if (value.schema !== PROGRESS_SCHEMA || value.version !== WEDDING_CODE_V40_VERSION) return { status: "invalid", raw };
    const { savedAt, formBit, answers, screen, cursor, skippedReviewDone } = value;
    if (!isTimestamp(savedAt) || savedAt > now) return { status: "invalid", raw };
    if (formBit !== 0 && formBit !== 1) return { status: "invalid", raw };
    if (screen !== "questions" && screen !== "result") return { status: "invalid", raw };
    if (typeof cursor !== "number" || !Number.isInteger(cursor) || cursor < 0 || cursor >= bank.items.length) return { status: "invalid", raw };
    if (typeof skippedReviewDone !== "boolean" || typeof answers !== "string") return { status: "invalid", raw };
    const responses = decodeProgressAnswers(bank, answers);
    if (responses === null) return { status: "invalid", raw };
    if (screen === "result" && (answers.includes(V40_UNANSWERED_CHAR) || cursor !== 0)) return { status: "invalid", raw };
    if (now - savedAt >= V40_STORAGE.ttlMs) return { status: "expired", raw };
    return { status: "ready", raw, savedAt, snapshot: { formBit, responses, screen, cursor, skippedReviewDone } };
  } catch {
    return { status: "invalid", raw };
  }
}

/**
 * 진행 저장 쓰기. 호출자는 본인 답만 넘긴다(받은 링크의 상대 답은 넘기지 않는다). 지금 저장된 원문이 expectedRaw 와 다르면 conflict
 * (다른 탭이 쓴 것을 지우지 않으려는 최선 노력의 비교다: 확인과 쓰기 사이에 다른 탭이 쓰면 브라우저 저장소로는 막을 수 없다).
 * 쓴 뒤 다시 읽어 같지 않으면 unavailable(저장 안 됐는데 저장됐다고 말하지 않는다).
 * savedAt 은 이번 쓰기의 시각이라 저장 기간은 마지막 실제 저장부터 센다.
 * 자동 저장이 꺼져 있으면 아무것도 쓰지 않고 off 로 답한다(화면이 선호 확인을 빠뜨려도 끄기 선택을 어기고 공용 브라우저에 답이 남지 않게 하는 마지막 안전장치다).
 * off 는 저장소가 막혔다는 뜻(unavailable)과 다르다: 화면은 「자동 저장을 꺼 두었어요」로 말하고 「저장하지 못했어요」로 말하지 않는다.
 * 모양 검사(invalid)가 선호 확인보다 먼저다.
 */
export function writeProgress(storage: StorageLike, bank: Bank, snapshot: ProgressSnapshot, expectedRaw: string | null, now: number = Date.now()): ProgressWrite {
  if (!isTimestamp(now) || (expectedRaw !== null && typeof expectedRaw !== "string")) return { status: "invalid" };
  if (snapshot === null || typeof snapshot !== "object") return { status: "invalid" };
  const { formBit, screen, cursor, skippedReviewDone } = snapshot;
  if (formBit !== 0 && formBit !== 1) return { status: "invalid" };
  if (screen !== "questions" && screen !== "result") return { status: "invalid" };
  if (typeof cursor !== "number" || !Number.isInteger(cursor) || cursor < 0 || cursor >= bank.items.length) return { status: "invalid" };
  if (typeof skippedReviewDone !== "boolean") return { status: "invalid" };
  const answers = encodeProgressAnswers(bank, snapshot.responses);
  if (answers === null) return { status: "invalid" };
  if (screen === "result" && (answers.includes(V40_UNANSWERED_CHAR) || cursor !== 0)) return { status: "invalid" };
  const envelope: ProgressEnvelope = {
    schema: PROGRESS_SCHEMA,
    version: WEDDING_CODE_V40_VERSION,
    savedAt: now,
    formBit,
    answers,
    screen,
    cursor,
    skippedReviewDone,
  };
  const raw = JSON.stringify(envelope);
  if (raw.length > V40_STORAGE.maxEnvelopeLength) return { status: "invalid" };
  if (readAutosavePreference(storage) === "off") return { status: "off" };
  const current = readRaw(storage, V40_STORAGE.progressKey);
  if (!current.ok) return { status: "unavailable" };
  if (current.raw !== expectedRaw) return { status: "conflict" };
  return writeVerified(storage, V40_STORAGE.progressKey, raw) ? { status: "saved", raw } : { status: "unavailable" };
}

/** 진행 저장 지우기(설계 6절: 켜기, 끄기, 지우기 제공). */
export function clearProgress(storage: StorageLike): { readonly status: "cleared" | "unavailable" } {
  return removeKey(storage, V40_STORAGE.progressKey) ? { status: "cleared" } : { status: "unavailable" };
}

// ---------------------------------------------------------------------------
// 지난번과 비교 기록
// ---------------------------------------------------------------------------

function parseHistoryAxis(value: unknown, index: number): HistoryAxis | null {
  if (!isRecord(value) || !hasExactKeys(value, HISTORY_AXIS_KEYS)) return null;
  const { letter, band, provisional } = value;
  if (typeof provisional !== "boolean") return null;
  let parsedLetter: Letter | null = null;
  if (letter !== null) {
    if (typeof letter !== "string" || !isLetter(letter) || axisOfLetter(letter) !== V40_AXIS_KEYS[index]) return null;
    parsedLetter = letter;
  }
  let parsedBand: StrengthBand | null = null;
  if (band !== null) {
    if (band !== "clear" && band !== "lean" && band !== "even") return null;
    parsedBand = band;
  }
  if ((parsedLetter === null) !== (parsedBand === null)) return null;
  if (provisional && parsedLetter === null) return null;
  // 임시 글자는 두 쪽이 똑같이 나온 동점이라 세기는 언제나 반반이에요(score.ts 동점 5단계). 다른 세기의 임시 글자는 앞뒤가 맞지 않는 기록이다.
  if (provisional && parsedBand !== "even") return null;
  return { letter: parsedLetter, band: parsedBand, provisional };
}

/** 기록 한 건을 엄격하게 읽어 새 객체로 옮긴다(모르는 키가 있으면 거절해 답이 딸려 들어올 수 없다). at 이 now 보다 미래이면 거절. */
function parseEntry(value: unknown, now: number): HistoryEntry | null {
  if (!isRecord(value) || !hasExactKeys(value, ENTRY_KEYS)) return null;
  const { at, formBit, axes } = value;
  if (!isTimestamp(at) || at > now) return null;
  if (formBit !== 0 && formBit !== 1) return null;
  if (!Array.isArray(axes) || axes.length !== V40_AXIS_KEYS.length) return null;
  const parsed = axes.map((axis, index) => parseHistoryAxis(axis, index));
  const [a, b, c, d] = parsed;
  if (!a || !b || !c || !d) return null;
  return { at, formBit, axes: [a, b, c, d] };
}

type HistoryParse = { readonly ok: true; readonly entries: readonly HistoryEntry[] } | { readonly ok: false };

/** 기록 원문을 봉투 규칙대로 읽는다: 키 셋, 스키마, 판 태그, 최대 건수, 최신이 앞(시각이 늘지 않는 순서). */
function parseHistoryRaw(raw: string, now: number): HistoryParse {
  if (raw.length > MAX_HISTORY_LENGTH) return { ok: false };
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !hasExactKeys(value, HISTORY_KEYS)) return { ok: false };
    if (value.schema !== PROGRESS_SCHEMA || value.version !== WEDDING_CODE_V40_VERSION) return { ok: false };
    const list = value.entries;
    if (!Array.isArray(list) || list.length > V40_STORAGE.historyMax) return { ok: false };
    const entries: HistoryEntry[] = [];
    for (const item of list) {
      const entry = parseEntry(item, now);
      if (entry === null) return { ok: false };
      if (entries.length > 0 && entry.at > entries[entries.length - 1].at) return { ok: false };
      entries.push(entry);
    }
    return { ok: true, entries };
  } catch {
    return { ok: false };
  }
}

/**
 * 지난번과 비교 기록 읽기(설계 6절). 30일이 지난 건(now - at >= 기간)은 뺀다. 최신이 앞.
 * 봉투에 건이 없으면 empty, 모두 지났으면 expired, 형식이 어긋나면 invalid, 접근이 던지면 unavailable.
 * 읽기는 저장소에 아무것도 쓰지 않는다. 기간이 지난 건을 저장에서 덜어 내는 일은 purgeExpired 가 맡는다.
 */
export function readHistory(storage: StorageLike, now: number = Date.now()): HistoryRead {
  const read = readRaw(storage, V40_STORAGE.historyKey);
  if (!read.ok) return { status: "unavailable", entries: [] };
  if (!isTimestamp(now)) return { status: "invalid", entries: [] };
  if (read.raw === null) return { status: "empty", entries: [] };
  const parsed = parseHistoryRaw(read.raw, now);
  if (!parsed.ok) return { status: "invalid", entries: [] };
  if (parsed.entries.length === 0) return { status: "empty", entries: [] };
  const fresh = parsed.entries.filter((entry) => now - entry.at < V40_STORAGE.ttlMs);
  return fresh.length === 0 ? { status: "expired", entries: [] } : { status: "ready", entries: fresh };
}

const sameEntry = (a: HistoryEntry, b: HistoryEntry): boolean => a.at === b.at && a.formBit === b.formBit && JSON.stringify(a.axes) === JSON.stringify(b.axes);

/**
 * 기록 한 건 추가(설계 6절). 결과의 글자, 세기, 시각, 폼 비트만 저장하고 답은 저장하지 않는다(모르는 필드는 거절한다).
 * 최신이 앞이고 최대 3건이며 넘치면 가장 오래된 것부터 버린다. 같은 건이 이미 있으면 다시 쓰지 않고 saved 로 답한다.
 * 저장된 기록이 깨졌거나 지났으면 새로 시작한다. 자동 저장이 꺼져 있으면 아무것도 쓰지 않고 off 로 답한다(writeProgress 와 같은 안전장치).
 * 화면은 결과 화면에 들어설 때 한 번만 부른다(이어 하기로 결과 화면을 다시 열거나 다시 그릴 때는 부르지 않는다: 같은 시각의 같은 건만 다시 쓰지 않는다).
 */
export function appendHistory(storage: StorageLike, entry: HistoryEntry, now: number = Date.now()): AppendResult {
  if (!isTimestamp(now)) return { status: "invalid" };
  const parsedEntry = parseEntry(entry, now);
  if (parsedEntry === null) return { status: "invalid" };
  if (readAutosavePreference(storage) === "off") return { status: "off" };
  const read = readRaw(storage, V40_STORAGE.historyKey);
  if (!read.ok) return { status: "unavailable" };
  let existing: readonly HistoryEntry[] = [];
  if (read.raw !== null) {
    const parsed = parseHistoryRaw(read.raw, now);
    if (parsed.ok) existing = parsed.entries.filter((item) => now - item.at < V40_STORAGE.ttlMs);
  }
  if (existing.some((item) => sameEntry(item, parsedEntry))) return { status: "saved" };
  const entries = [parsedEntry, ...existing].sort((a, b) => b.at - a.at).slice(0, V40_STORAGE.historyMax);
  const envelope: HistoryEnvelope = { schema: PROGRESS_SCHEMA, version: WEDDING_CODE_V40_VERSION, entries };
  const raw = JSON.stringify(envelope);
  if (raw.length > MAX_HISTORY_LENGTH) return { status: "invalid" };
  return writeVerified(storage, V40_STORAGE.historyKey, raw) ? { status: "saved" } : { status: "unavailable" };
}

/** 기록 지우기(이 브라우저의 저장 지우기). */
export function clearHistory(storage: StorageLike): { readonly status: "cleared" | "unavailable" } {
  return removeKey(storage, V40_STORAGE.historyKey) ? { status: "cleared" } : { status: "unavailable" };
}

// ---------------------------------------------------------------------------
// 기간이 지난 저장 지우기
// ---------------------------------------------------------------------------

/** 비교 기록에서 기간이 지난 건을 덜어 낸다(모두 지났으면 키를 지우고, 일부만이면 남은 건으로 다시 쓴다). 형식이 깨진 기록은 건드리지 않는다. */
function purgeHistory(storage: StorageLike, now: number): boolean {
  const read = readRaw(storage, V40_STORAGE.historyKey);
  if (!read.ok || read.raw === null) return false;
  const parsed = parseHistoryRaw(read.raw, now);
  if (!parsed.ok || parsed.entries.length === 0) return false;
  const fresh = parsed.entries.filter((entry) => now - entry.at < V40_STORAGE.ttlMs);
  if (fresh.length === parsed.entries.length) return false;
  if (fresh.length === 0) return removeIfUnchanged(storage, V40_STORAGE.historyKey, read.raw);
  const envelope: HistoryEnvelope = { schema: PROGRESS_SCHEMA, version: WEDDING_CODE_V40_VERSION, entries: fresh };
  return rewriteIfUnchanged(storage, V40_STORAGE.historyKey, read.raw, JSON.stringify(envelope));
}

/**
 * 기간이 지난 저장을 저장소에서 실제로 지운다(설계 6절 저장 기간 30일, 계약 밖 확장). readProgress 와 readHistory 는 처리방침대로 아무것도 쓰지 않으므로
 * 지우는 일은 이 함수가 맡는다. 진행 저장은 마지막 저장부터 30일이 지나 expired 로 읽힐 때만 지우고(형식이 깨진 값은 건드리지 않는다),
 * 비교 기록은 기간이 지난 건을 덜어 낸다. 확인한 원문이 그 사이 바뀌었으면(다른 탭이 새로 씀) 그 값은 건드리지 않는다.
 * 시작 화면이 진행 저장을 읽어 expired 를 보면 부른다(시작 화면의 「이전 답은 지워졌어요」 문구가 참이 되려면 부른 뒤에 보여 준다).
 * 두 사람 결과 화면처럼 이 브라우저에 아무것도 쓰지 않기로 한 화면에서는 부르지 않는다. 던지지 않는다.
 */
export function purgeExpired(storage: StorageLike, bank: Bank, now: number = Date.now()): PurgeResult {
  if (!isTimestamp(now)) return { progress: false, history: false };
  const read = readProgress(storage, bank, now);
  const progress = read.status === "expired" && read.raw !== null && removeIfUnchanged(storage, V40_STORAGE.progressKey, read.raw);
  return { progress, history: purgeHistory(storage, now) };
}

// ---------------------------------------------------------------------------
// 자동 저장 선호와 이전 판 진행 저장
// ---------------------------------------------------------------------------

/**
 * 자동 저장 선호(설계 6절, 기본 on). v4 키에 on 이나 off 가 적혀 있으면 그것을 따른다.
 * v4 키가 없거나 다른 값이면 이전 판 키가 off 일 때만 off 로 읽는다(이전 판에서 끈 사람이 v4 에서 처음부터 저장되지 않게).
 */
export function readAutosavePreference(storage: StorageLike): "on" | "off" {
  const own = readRaw(storage, V40_STORAGE.autosaveKey);
  if (own.ok && (own.raw === "on" || own.raw === "off")) return own.raw;
  const legacy = readRaw(storage, V40_STORAGE.legacyV31AutosaveKey);
  return legacy.ok && legacy.raw === "off" ? "off" : "on";
}

/**
 * 자동 저장 선호 쓰기. off 는 v4 진행 저장, v4 기록, 이전 판 진행 저장을 먼저 함께 지우고(같이 쓰는 브라우저에서 끄기는 남기지 않는다는 뜻)
 * 선호를 쓴다. 지우기가 하나라도 안 됐거나 선호가 저장되지 않았으면 unavailable. on 은 선호만 쓴다.
 */
export function writeAutosavePreference(storage: StorageLike, preference: "on" | "off"): { readonly status: "saved" | "unavailable" } {
  if (preference !== "on" && preference !== "off") return { status: "unavailable" };
  let cleared = true;
  if (preference === "off") {
    for (const key of [V40_STORAGE.progressKey, V40_STORAGE.historyKey, V40_STORAGE.legacyV31ProgressKey]) {
      if (!removeKey(storage, key)) cleared = false;
    }
  }
  return writeVerified(storage, V40_STORAGE.autosaveKey, preference) && cleared ? { status: "saved" } : { status: "unavailable" };
}

/** 이전 판 진행 저장 원문에서 savedAt 만 본다. 30일 안이고 미래가 아닌 안전한 정수일 때만 값을 낸다(다른 필드는 보지 않는다). */
function legacySavedAt(raw: string, now: number): number | null {
  if (raw.length > MAX_LEGACY_LENGTH || !isTimestamp(now)) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return null;
    const savedAt = value.savedAt;
    return isTimestamp(savedAt) && savedAt <= now && now - savedAt < V40_STORAGE.ttlMs ? savedAt : null;
  } catch {
    return null;
  }
}

/**
 * 이 브라우저에 이전 판(v3.1) 진행 저장이 있는가(설계 6절 저장과 수정). 키 문자열과 savedAt 만 읽고 v3.1 모듈은 가져오지 않는다.
 * present 는 키에 값이 있다는 뜻이고, savedAt 은 30일 안일 때만 값이 있다. 읽기만 하고 지우지 않는다.
 */
export function probeLegacyV31Progress(storage: StorageLike, now: number = Date.now()): LegacyProgressProbe {
  const read = readRaw(storage, V40_STORAGE.legacyV31ProgressKey);
  if (!read.ok || read.raw === null || read.raw === "") return { present: false, savedAt: null };
  return { present: true, savedAt: legacySavedAt(read.raw, now) };
}

/** 이 파일의 함수를 계약(StorageModule)대로 묶은 객체. 서명이 계약과 어긋나면 여기서 타입 오류가 난다. */
export const storageModule = {
  browserStorage,
  purgeExpired,
  readProgress,
  writeProgress,
  clearProgress,
  encodeProgressAnswers,
  decodeProgressAnswers,
  readHistory,
  appendHistory,
  clearHistory,
  readAutosavePreference,
  writeAutosavePreference,
  probeLegacyV31Progress,
} satisfies StorageModule;
