/** AI 본문의 내부 도구 프레임만 제거한다. 사용자 메시지나 실행 metadata에는 적용하지 않는다. */
const INTERNAL_KEYS = [
  "total_budget", "total_allocated", "total_spent", "unallocated", "recorded_spend_basis",
  "toolName", "toolInput", "toolOutput", "tool_name", "tool_input", "tool_output",
  "tool_calls", "tool_call_id", "function_call", "client_request_id", "couple_id",
  "sender_id", "state_revision", "pending_action", "sampleCount", "minKrw", "medianKrw", "maxKrw",
  "preview_head", "preview_tail", "allocated_is_set", "custom_categories_omitted",
];
const INTERNAL_KEY_SET = new Set(INTERNAL_KEYS);
const HISTORY_TOOL_NAMES = new Set(["search_nearby_places", "get_market_price"]);
const INTERNAL_LINE = new RegExp(`^[ \\t]*(?:>[ \\t]*)*["']?(?:${INTERNAL_KEYS.join("|")})["']?\\s*:.*$`, "gmu");
const HISTORY_MARKER = /\[\s*저장된\s*도구\s*결과[^\]\r\n]*(?:\]|(?=\r?\n)|$)/gu;
const XML_INTERNAL = /<(tool_result|tool_output|function_call|analysis|reasoning)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/giu;
const ROLE_INTERNAL = /\[assistant\/(?:analysis|commentary)[^\]]*\][\s\S]*?(?=\[assistant\/final\]|$)/giu;
const FINAL_ROLE = /\[assistant\/final\]/giu;
const SYSTEM_REMINDER = /\[SYSTEM:\s*이 결과는 프론트엔드에서[^\]]*(?:\]|$)/giu;
const TRUNCATION_MARKER = /\[도구 결과가 길어 중간 일부 생략\]/gu;
const STREAM_OPENING = /[\[{`<>~]/u;
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
      if (typeof entry.tool === "string" && (HISTORY_TOOL_NAMES.has(entry.tool)
        || (/^[a-z]+(?:_[a-z0-9]+)+$/u.test(entry.tool)
          && entry.input && typeof entry.input === "object"))) return true;
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
    .replace(SYSTEM_REMINDER, "").replace(TRUNCATION_MARKER, "");
  const ranges = [];

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

/** 구조화 구문은 토큰 경계와 관계없이 완료 후 검사한다. 일반 문장은 계속 흘려보낸다. */
export function hasAmoraInternalArtifactPrefix(text) {
  return STREAM_OPENING.test(text) || INTERNAL_LINE_PREFIX.test(text) || incompleteInternalLine(text) >= 0;
}

export function getAmoraVisibleText(text, { streaming = false } = {}) {
  if (typeof text !== "string" || !text) return text;
  const starts = streaming ? [text.search(STREAM_OPENING), text.search(INTERNAL_LINE_PREFIX), incompleteInternalLine(text)].filter((index) => index >= 0) : [];
  const opening = starts.length > 0 ? Math.min(...starts) : -1;
  const candidate = opening >= 0 ? text.slice(0, opening) : text;
  const visible = stripAmoraInternalArtifacts(candidate);
  if (!streaming && text.trim() && !visible.trim()) return AMORA_HIDDEN_INTERNAL_TEXT_NOTICE;
  return visible;
}
