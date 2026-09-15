/** AI 본문의 내부 도구 프레임만 제거한다. 사용자 메시지나 실행 metadata에는 적용하지 않는다. */
const INTERNAL_KEYS = [
  "total_budget", "total_allocated", "total_spent", "unallocated", "recorded_spend_basis",
  "toolName", "toolInput", "toolOutput", "tool_name", "tool_input", "tool_output",
  "tool_calls", "tool_call_id", "function_call", "client_request_id", "couple_id",
  "sender_id", "state_revision", "pending_action", "sampleCount", "minKrw", "medianKrw", "maxKrw",
  "preview_head", "preview_tail", "allocated_is_set", "custom_categories_omitted",
  // 도구 입력 스키마에만 쓰는 영문 키. 한국어 답변이나 사용자가 요청한 문구에는 나오지 않는다.
  "arguments", "tool_use_id", "call_id", "function_name", "category_key", "item_id", "event_id",
  "action_id", "vendor_id", "booking_id", "product_id", "staff_id", "schedule_scope",
  "allocation_mode", "expected_title", "expected_date", "checklist_confirmed", "not_needed_items",
];
const INTERNAL_KEY_SET = new Set(INTERNAL_KEYS);
const HISTORY_TOOL_NAMES = new Set(["search_nearby_places", "get_market_price"]);
/** 도구 이름 모양. 모든 아모라 도구는 밑줄 하나 이상인 영문 소문자 이름이다. */
const TOOL_NAME = /^(?:functions\.)?[a-z]+(?:_[a-z0-9]+)+$/u;
const INTERNAL_LINE = new RegExp(`^[ \\t]*(?:>[ \\t]*)*["']?(?:${INTERNAL_KEYS.join("|")})["']?\\s*:.*$`, "gmu");
const HISTORY_MARKER = /\[\s*저장된\s*도구\s*결과[^\]\r\n]*(?:\]|(?=\r?\n)|$)/gu;
const INTERNAL_TAG_NAMES = "tool_results?|tool_outputs?|tool_calls?|tool_use|function_calls?|function_results?|invoke|parameter|analysis|reasoning|thinking|think";
const XML_INTERNAL = new RegExp(`<((?:[a-z]+:)?(?:${INTERNAL_TAG_NAMES}))(?=[\\s>/])[^>]*>[\\s\\S]*?(?:<\\/\\1\\s*>|$)`, "giu");
/** 짝을 잃은 여닫는 태그만 남은 경우. */
const ORPHAN_INTERNAL_TAG = new RegExp(`<\\/?(?:[a-z]+:)?(?:${INTERNAL_TAG_NAMES})(?=[\\s>/])[^>]*>`, "giu");
/** 줄 전체가 도구 호출 문법인 경우: `update_budget({...});`, `functions.get_budget_summary()`. */
const CALL_LINE = /(?:^|\n)[ \t]*(?:>[ \t]*)*`?(?:functions\.)?[a-z]+(?:_[a-z0-9]+)+[ \t]*\(/gu;
const CALL_LINE_PREFIX = /(?:^|\n)[ \t]*(?:>[ \t]*)*`?(?:functions\.)?[a-z]+(?:_[a-z0-9]+)+[ \t]*\(/u;
/** 스트리밍 중 아직 괄호가 오지 않은 도구 이름 조각(`update_bu`). */
const PARTIAL_CALL_NAME = /^(?:>[ \t]*)*`?[a-z][a-z0-9_]*(?:\.[a-z0-9_]*)?$/u;
const ROLE_INTERNAL = /\[assistant\/(?:analysis|commentary)[^\]]*\][\s\S]*?(?=\[assistant\/final\]|$)/giu;
const FINAL_ROLE = /\[assistant\/final\]/giu;
const SYSTEM_REMINDER = /\[SYSTEM:\s*이 결과는 프론트엔드에서[^\]]*(?:\]|$)/giu;
const TRUNCATION_MARKER = /\[도구 결과가 길어 중간 일부 생략\]/gu;
const STREAM_OPENING = /[{`<>~]/u;
const INTERNAL_BRACKET_BODY = /^\s*(?:[\[{"']|저장된\s*도구\s*결과|assistant\/(?:analysis|commentary|final)|SYSTEM:\s*이 결과는 프론트엔드에서|도구 결과가 길어 중간 일부 생략)/iu;
const INTERNAL_LINE_PREFIX = new RegExp(INTERNAL_LINE.source, "mu");

export const AMORA_HIDDEN_INTERNAL_TEXT_NOTICE = "답변을 표시하지 못했어요. 다시 요청해 주세요.";

function quotedEnd(text, start) {
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    if (escaped) escaped = false;
    else if (text[index] === "\\") escaped = true;
    else if (text[index] === text[start]) return index + 1;
  }
  return text.length;
}

function containsInternalData(text, depth = 0) {
  try {
    const value = JSON.parse(text);
    if (typeof value === "string" && depth < 3) return containsInternalData(value, depth + 1);
    const pending = [value];
    while (pending.length > 0) {
      const entry = pending.pop();
      if (!entry || typeof entry !== "object") continue;
      // 입력이 객체든 한 번 더 인코딩한 문자열이든 도구 envelope이다.
      if (typeof entry.tool === "string" && (HISTORY_TOOL_NAMES.has(entry.tool)
        || (TOOL_NAME.test(entry.tool)
          && entry.input && (typeof entry.input === "object" || typeof entry.input === "string")))) return true;
      // OpenAI·Anthropic 호출 모양: {"name":"update_budget","arguments":{...}} / {"name":..,"input":..}
      if (typeof entry.name === "string" && TOOL_NAME.test(entry.name)
        && ["arguments", "parameters", "input"].some((key) => Object.prototype.hasOwnProperty.call(entry, key))) return true;
      pending.push(...Object.values(entry));
    }
  } catch { /* 잘린 내부 데이터도 속성 이름으로 식별한다. */ }
  // 문자열 값에 들어 있는 'total_budget: ...'는 내부 속성으로 오인하지 않는다.
  for (let index = 0; index < text.length; index += 1) {
    let token;
    let end;
    if (text[index] === '"' || text[index] === "'") {
      end = quotedEnd(text, index);
      const literal = text.slice(index, end);
      try { token = JSON.parse(literal); } catch { token = literal.slice(1, -1); }
    } else {
      const word = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(text.slice(index));
      if (!word) continue;
      token = word[0];
      end = index + token.length;
    }
    let next = end;
    while (next < text.length && /\s/u.test(text[next])) next += 1;
    if (INTERNAL_KEY_SET.has(token) && text[next] === ":") return true;
    index = end - 1;
  }
  return false;
}

/** 문자열 안의 괄호·이스케이프를 구분한다. 미완성 내부 데이터는 끝까지 숨긴다. */
function structuredEnd(text, start) {
  const stack = [];
  let quote = null;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "{" || char === "[") stack.push(char === "{" ? "}" : "]");
    else if (char === "}" || char === "]") {
      if (stack.pop() !== char) return text.length;
      if (stack.length === 0) return index + 1;
    }
  }
  return text.length;
}

/** 여는 소괄호의 짝을 찾는다. 따옴표 안 괄호는 세지 않는다. 짝이 없으면 끝까지다. */
function callEnd(text, open) {
  const stack = [];
  let quote = null;
  let escaped = false;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "(") stack.push(")");
    else if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if (char === ")" || char === "}" || char === "]") {
      if (stack.pop() !== char) return text.length;
      if (stack.length === 0) return index + 1;
    }
  }
  return text.length;
}

function fenceEnd(text, start) {
  const opening = /^(?<fence>`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/u.exec(text.slice(start));
  if (!opening) return null;
  const fence = opening.groups.fence;
  const closing = new RegExp(`^[ \\t]*${fence[0]}{${fence.length},}[ \\t]*(?:\\r?\\n|$)`, "gmu");
  closing.lastIndex = start + opening[0].length;
  const end = closing.exec(text);
  return end ? end.index + end[0].length : text.length;
}

export function stripAmoraInternalArtifacts(text) {
  if (typeof text !== "string" || !text) return text;
  let cleaned = text.replace(XML_INTERNAL, "").replace(ROLE_INTERNAL, "").replace(FINAL_ROLE, "")
    .replace(SYSTEM_REMINDER, "").replace(TRUNCATION_MARKER, "").replace(ORPHAN_INTERNAL_TAG, "");
  const ranges = [];

  // 줄 전체가 도구 호출일 때만 지운다. 문장 속 괄호(`SDM(스튜디오)`, `1)`)는 이름 모양이 달라 남는다.
  for (const match of cleaned.matchAll(CALL_LINE)) {
    const start = match.index + (match[0].startsWith("\n") ? 1 : 0);
    const end = callEnd(cleaned, match.index + match[0].length - 1);
    const rest = /^[ \t]*;?[ \t]*`?[ \t]*(?=\r?\n|$)/u.exec(cleaned.slice(end));
    if (end >= cleaned.length || rest) ranges.push([start, end + (rest?.[0].length ?? 0)]);
  }

  // 내부 프레임이 코드 블록 안에 있어도 빈 코드 상자를 남기지 않는다.
  const fences = /(?:^|\n)[ \t]{0,3}(`{3,}|~{3,})/gu;
  let fencedUntil = 0;
  for (const match of cleaned.matchAll(fences)) {
    const start = match.index + match[0].lastIndexOf(match[1]);
    if (start < fencedUntil) continue;
    const end = fenceEnd(cleaned, start);
    fencedUntil = end;
    const body = cleaned.slice(start, end);
    if (/\[\s*저장된\s*도구\s*결과/u.test(body) || containsInternalData(body.replace(/^(?:`{3,}|~{3,})[^\r\n]*\r?\n/u, "").replace(/(?:`{3,}|~{3,})\s*$/u, ""))) ranges.push([start, end]);
  }

  for (const match of cleaned.matchAll(HISTORY_MARKER)) {
    let end = match.index + match[0].length;
    let payload = end;
    while (/\s/u.test(cleaned[payload] ?? "") && payload < cleaned.length) payload += 1;
    if (cleaned[payload] === "{" || cleaned[payload] === "[") end = structuredEnd(cleaned, payload);
    else if (cleaned.startsWith("```", payload) || cleaned.startsWith("~~~", payload)) end = fenceEnd(cleaned, payload) ?? end;
    ranges.push([match.index, end]);
  }

  for (let index = 0; index < cleaned.length; index += 1) {
    if (cleaned[index] === '"' && /[\[{\\"]/u.test(cleaned[index + 1] ?? "")) {
      const end = quotedEnd(cleaned, index);
      if (containsInternalData(cleaned.slice(index, end))) ranges.push([index, end]);
      index = end - 1;
      continue;
    }
    if (cleaned[index] !== "{" && cleaned[index] !== "[") continue;
    const end = structuredEnd(cleaned, index);
    if (containsInternalData(cleaned.slice(index, end))) ranges.push([index, end]);
    index = end - 1;
  }
  ranges.sort((left, right) => left[0] - right[0]);
  let cursor = 0;
  let kept = "";
  for (const [start, end] of ranges) {
    if (end <= cursor) continue;
    kept += cleaned.slice(cursor, Math.max(cursor, start));
    cursor = end;
  }
  cleaned = kept + cleaned.slice(cursor);
  cleaned = cleaned.replace(INTERNAL_LINE, "");
  return cleaned === text ? text : cleaned
    .replace(/(?<!`)``(?!`)/gu, "")
    .replace(/(?:^|\n)[ \t]*(`{3,}|~{3,})[^\r\n]*\r?\n[ \t\r\n]*\1[ \t]*(?=\r?\n|$)/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
}

function incompleteInternalLine(text) {
  const start = text.lastIndexOf("\n") + 1;
  const tail = text.slice(start).trim();
  return tail && INTERNAL_KEYS.some((key) => key.startsWith(tail)) ? start : -1;
}

/** 스트리밍 화면 전용: 영문 소문자만 쓰인 미완성 마지막 줄은 도구 이름일 수 있어 줄이 끝날 때까지 보류한다. */
function incompleteCallLine(text) {
  const start = text.lastIndexOf("\n") + 1;
  const tail = text.slice(start).trim();
  return tail && PARTIAL_CALL_NAME.test(tail) ? start : -1;
}

function internalBracketStart(text, includeUnfinished = false) {
  for (const match of text.matchAll(/\[/gu)) {
    const start = match.index;
    const close = text.indexOf("]", start + 1);
    const body = text.slice(start + 1, close < 0 ? undefined : close);
    if (INTERNAL_BRACKET_BODY.test(body) || (includeUnfinished && close < 0)) return start;
  }
  return -1;
}

/** 구조화 구문은 토큰 경계와 관계없이 완료 후 검사한다. 일반 문장은 계속 흘려보낸다. */
export function hasAmoraInternalArtifactPrefix(text) {
  // 미리보기는 완성 문장 단위다. '['만으로 영구 보류하면 뒤에 온 정상 안내도 사라진다.
  return STREAM_OPENING.test(text) || internalBracketStart(text) >= 0
    || INTERNAL_LINE_PREFIX.test(text) || incompleteInternalLine(text) >= 0
    || CALL_LINE_PREFIX.test(text);
}

export function getAmoraVisibleText(text, { streaming = false } = {}) {
  if (typeof text !== "string" || !text) return text;
  // 화면은 미완성 대괄호만 임시 보류하고, 정상 안내로 완성되면 다시 표시한다.
  const starts = streaming ? [text.search(STREAM_OPENING), internalBracketStart(text, true), text.search(INTERNAL_LINE_PREFIX), incompleteInternalLine(text), text.search(CALL_LINE_PREFIX), incompleteCallLine(text)].filter((index) => index >= 0) : [];
  const opening = starts.length > 0 ? Math.min(...starts) : -1;
  const candidate = opening >= 0 ? text.slice(0, opening) : text;
  const visible = stripAmoraInternalArtifacts(candidate);
  if (!streaming && text.trim() && !visible.trim()) return AMORA_HIDDEN_INTERNAL_TEXT_NOTICE;
  return visible;
}
