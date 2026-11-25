import { stripInvisibleChars } from "@/lib/ai/webLookup/webLookupText";
/**
 * 업체 공식 페이지에서 **정해진 칸만** 뽑는다(08장 H5, 11장 K8 "독자가 뽑은 짧은 사실과 출처 주소만").
 *
 * 모델은 페이지 원문을 보지 않는다. 여기서 만든 칸만 간다:
 *   - 페이지 제목(짧게 자르고 기호를 지운 것)
 *   - 가격 줄: 항목 이름(14자) + 금액(쓰인 그대로) + 원문 한 줄(90자, 카드에만)
 *
 * 금액을 찾는 일은 정규식이 한다. 모델이 아니라서 페이지 속 지시문에 흔들리지 않는다. 금액이
 * 없는 페이지는 "업체에 확인해 주세요"다. 가격을 지어내거나 블로그에서 옮기지 않는다(D-85).
 */

export interface WebLookupPriceFact {
  /** 금액 앞의 항목 이름. 예: "1인 식대", "대관료". 모르면 "가격". */
  label: string;
  /** 페이지에 쓰인 그대로의 금액. 예: "65,000원", "300만원", "250~300만원". */
  amount: string;
  /** 금액이 든 원문 한 줄(90자 안). 카드에만 보이고 모델에는 가지 않는다. */
  quote: string;
}

export interface WebLookupPageFacts {
  title: string | null;
  prices: WebLookupPriceFact[];
  /** 글이 거의 없는 페이지(그림·스크립트로만 된 곳)인가. 그러면 가격이 있어도 못 읽는다. */
  textless: boolean;
}

const MAX_TEXT_CHARS = 300_000;
const MAX_PRICE_FACTS = 6;
const QUOTE_MAX_CHARS = 90;
const LABEL_MAX_CHARS = 14;
const TITLE_MAX_CHARS = 60;
const TEXTLESS_THRESHOLD_CHARS = 80;

/** 글자 인코딩을 정해 푼다. 헤더 → `<meta charset>` → UTF-8 순서. 모르는 이름이면 UTF-8. */
export function decodeWebLookupBody(body: Buffer, headerCharset: string | null): string {
  let charset = headerCharset;
  if (!charset) {
    const head = body.subarray(0, 4096).toString("latin1");
    charset = /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_-]+)/iu.exec(head)?.[1]?.toLowerCase() ?? null;
  }
  try {
    return new TextDecoder(charset ?? "utf-8", { fatal: false }).decode(body);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(body);
  }
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", middot: "·", hellip: "…",
  ndash: "-", mdash: "-", lsquo: "'", rsquo: "'", ldquo: "\"", rdquo: "\"", won: "₩", tilde: "~",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/giu, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = parseInt(entity.slice(2), 16);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    }
    if (entity.startsWith("#")) {
      const code = parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** 보이지 않는 제어 문자·방향 바꾸기 문자를 지운다(`promptData` 와 같은 범위). */
function stripInvisible(text: string): string {
  return stripInvisibleChars(text);
}

/**
 * 모델·카드에 실을 짧은 바깥 글을 다듬는다. 줄바꿈과 꺾쇠·대괄호·중괄호·백틱처럼 지시나 표식을
 * 흉내 낼 수 있는 기호를 지우고 자른다. JSON 으로 감싸 보내므로 구조는 깨지지 않는다.
 */
export function sanitizeWebLookupText(value: string, maxChars: number): string {
  const cleaned = stripInvisible(decodeEntities(value))
    .replace(/<[^>]*>/gu, " ")
    .replace(/[<>{}[\]`|\\]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const chars = Array.from(cleaned);
  return chars.length > maxChars ? `${chars.slice(0, maxChars - 1).join("").trim()}…` : cleaned;
}

/** HTML 에서 사람이 읽는 글만 남긴다. 줄 구조는 블록 태그 자리에서 살린다. */
export function htmlToText(html: string): { title: string | null; text: string } {
  const source = html.slice(0, MAX_TEXT_CHARS * 2);
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(source);
  const title = titleMatch ? sanitizeWebLookupText(titleMatch[1], TITLE_MAX_CHARS) || null : null;
  const text = source
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|object|head)\b[\s\S]*?<\/\1\s*>/giu, " ")
    .replace(/<(br|hr)\b[^>]*>/giu, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|dt|dd|table|ul|ol|blockquote|pre)\s*>/giu, "\n")
    .replace(/<(td|th)\b[^>]*>/giu, " ")
    .replace(/<[^>]+>/gu, " ");
  const lines = stripInvisible(decodeEntities(text))
    .split(/\n+/u)
    .map((line) => line.replace(/[ \t 　]+/gu, " ").trim())
    .filter(Boolean);
  return { title, text: lines.join("\n").slice(0, MAX_TEXT_CHARS) };
}

/**
 * 금액. 넷 중 하나다(앞의 것부터 본다):
 *   - `₩65,000`, `₩65000`
 *   - `1억 2천만원`, `1억원` 같은 큰 금액
 *   - `300만원`, `1,300만원`, `6.5만 원`, `250~300만원`
 *   - `65,000원`, `65000원`, `55,000~65,000원` (네 자리 이상. "1원", "500원" 같은 잡음은 거른다)
 *
 * 쉼표가 든 수를 한 덩어리로 읽어야 한다 — 안 그러면 `1,300만원` 을 `300만원` 으로 읽는다.
 */
const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const BIG_NUM = String.raw`(?:\d{1,3}(?:,\d{3})+|\d{4,})`;
const RANGE_SEP = String.raw`\s*(?:~|-|∼|〜|～)\s*`;
const AMOUNT_SOURCE = [
  String.raw`₩\s?${BIG_NUM}`,
  String.raw`${NUM}\s*억(?:\s*${NUM}\s*(?:천\s*)?만)?\s*원?`,
  String.raw`(?:${NUM}\s*(?:만\s*)?${RANGE_SEP})?${NUM}\s*만\s*원`,
  String.raw`(?:${BIG_NUM}\s*원?${RANGE_SEP})?${BIG_NUM}\s*원`,
].join("|");

/** 부를 때마다 새로 만든다. 전역 정규식의 lastIndex 를 두 곳이 나눠 쓰면 끝없이 돈다. */
function amountRegex(): RegExp {
  return new RegExp(AMOUNT_SOURCE, "gu");
}

/** 금액 앞에서 항목 이름을 집는다. 기호와 다른 금액을 지우고 끝에서 두 낱말까지. "1인" 은 남긴다. */
function labelBefore(line: string, index: number): string {
  const before = line.slice(Math.max(0, index - 24), index)
    .replace(/[:：=\-–—·•▶►◆■□○●※()（）[\]{}<>「」『』"'|/\\]/gu, " ")
    .replace(amountRegex(), " ")
    .replace(/\s+/gu, " ")
    .trim();
  const words = before.split(" ").filter((word) => /[\p{L}]/u.test(word));
  const picked = words.slice(-2).join(" ");
  const label = sanitizeWebLookupText(picked, LABEL_MAX_CHARS);
  return label || "가격";
}

function quoteAround(line: string, index: number, length: number): string {
  if (Array.from(line).length <= QUOTE_MAX_CHARS) return sanitizeWebLookupText(line, QUOTE_MAX_CHARS);
  const start = Math.max(0, index - 40);
  const end = Math.min(line.length, index + length + 40);
  const window = `${start > 0 ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`;
  return sanitizeWebLookupText(window, QUOTE_MAX_CHARS);
}

export function extractPriceFacts(text: string): WebLookupPriceFact[] {
  const facts: WebLookupPriceFact[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const amounts = amountRegex();
    for (let match = amounts.exec(line); match !== null; match = amounts.exec(line)) {
      const amount = sanitizeWebLookupText(match[0].replace(/\s+/gu, ""), 24);
      if (!amount) continue;
      const label = labelBefore(line, match.index);
      const key = `${label}|${amount}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({ label, amount, quote: quoteAround(line, match.index, match[0].length) });
      if (facts.length >= MAX_PRICE_FACTS) return facts;
    }
  }
  return facts;
}

export function extractWebLookupPageFacts(body: string, mediaType: string): WebLookupPageFacts {
  const isHtml = mediaType === "text/html" || mediaType === "application/xhtml+xml"
    || (mediaType === "" && /<html|<body|<div/iu.test(body.slice(0, 2048)));
  const { title, text } = isHtml
    ? htmlToText(body)
    : { title: null, text: stripInvisible(body).slice(0, MAX_TEXT_CHARS) };
  return {
    title,
    prices: extractPriceFacts(text),
    textless: text.replace(/\s+/gu, "").length < TEXTLESS_THRESHOLD_CHARS,
  };
}
