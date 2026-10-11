/** 출처 URL의 존재·신뢰성을 보증하지 않는다. 클릭할 수 있는 주소 형식만 검사한다. */
const MAX_REFERENCE_LABEL_CHARS = 2048;
const MAX_REFERENCE_DESTINATION_CHARS = 8192;
const MAX_REFERENCE_SCAN_CHARS = 12000;

export function getSafeAmoraReferenceHref(raw) {
  if (typeof raw !== "string" || !raw || /[\s\\<>"`\u0000-\u001f\u007f\p{Cf}]/u.test(raw)
    || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/iu.test(raw)
    || /%(?![0-9a-f]{2})/iu.test(raw)) return null;
  const internal = raw.startsWith("/") && !raw.startsWith("//");
  if (!internal && !/^https:\/\//iu.test(raw)) return null;
  try {
    if (/[\\\u0000-\u001f\u007f\p{Cf}]/u.test(decodeURIComponent(raw))) return null;
    const url = new globalThis.URL(raw, "https://hanbang.ai");
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (internal && url.origin !== "https://hanbang.ai") return null;
    if (internal || ["hanbang.ai", "www.hanbang.ai"].includes(url.hostname.replace(/\.+$/u, ""))) {
      let path = url.pathname;
      for (let pass = 0; pass < 3 && path.includes("%"); pass += 1) path = decodeURIComponent(path);
      if (path.startsWith("//") || /[\\\u0000-\u001f\u007f\p{Cf}]/u.test(path)) return null;
      const normalizedPath = new globalThis.URL(path, url.origin).pathname;
      if (/^\/(?:api|auth|admin)(?:\/|$)/u.test(normalizedPath)) return null;
    }
    return raw;
  } catch { return null; }
}

/** 잘못된 링크와 이미지 구문은 한 덩어리의 원문으로 남겨 일부 주소만 활성화하지 않는다. */
export function readAmoraReferenceAt(text, index) {
  const first = text[index];
  if (first !== "[" && !(first === "!" && text[index + 1] === "[")) {
    if ((first !== "h" && first !== "H") || /[\p{L}\p{N}_/\\@]/u.test(text[index - 1] ?? "")) return null;
    const raw = text.slice(index).match(/^https:\/\/[^\s<>"`\[\]*]+/iu)?.[0];
    if (!raw) return null;
    let href = raw.replace(/[.,!?;:，。！？]+$/u, "");
    let excessClosing = 0;
    for (const char of href) {
      if (char === ")") excessClosing += 1;
      else if (char === "(") excessClosing -= 1;
    }
    let end = href.length;
    while (end > 0 && excessClosing > 0 && href[end - 1] === ")") { end -= 1; excessClosing -= 1; }
    href = href.slice(0, end);
    const safe = getSafeAmoraReferenceHref(href);
    return safe ? { type: "link", text: href, href: safe, length: href.length }
      : { type: "text", text: raw, length: raw.length };
  }
  const image = first === "!";
  const labelStart = index + (image ? 2 : 1);
  const inert = () => ({ type: "text", text: text.slice(index), length: text.length - index });
  const labelOffset = text.slice(labelStart, labelStart + MAX_REFERENCE_SCAN_CHARS + 2).indexOf("](");
  const labelEnd = labelOffset < 0 ? -1 : labelStart + labelOffset;
  if (labelEnd < labelStart) return image || text.length - labelStart > MAX_REFERENCE_LABEL_CHARS ? inert() : null;
  const unsupportedLabel = labelEnd - labelStart > MAX_REFERENCE_LABEL_CHARS
    || /[\[\]\n]/u.test(text.slice(labelStart, labelEnd));
  let depth = 1;
  let end = labelEnd + 2;
  for (; end < text.length && end - labelEnd <= MAX_REFERENCE_DESTINATION_CHARS; end += 1) {
    if (text[end] === "\n") return inert();
    if (text[end] === "(") depth += 1;
    else if (text[end] === ")" && --depth === 0) break;
  }
  if (depth !== 0) return inert();
  const source = text.slice(index, end + 1);
  const href = image || unsupportedLabel ? null : getSafeAmoraReferenceHref(text.slice(labelEnd + 2, end));
  return href
    ? { type: "link", text: text.slice(labelStart, labelEnd).trim() || href, href, length: source.length }
    : { type: "text", text: source, length: source.length };
}

/** 여러 줄의 불완전 참조를 본문 블록으로 나누기 전에 닫는 괄호까지 추적한다. */
export function getAmoraUnclosedReferenceDepth(text, initialDepth = 0) {
  let depth = initialDepth;
  for (let index = 0; index < text.length; index += 1) {
    if (depth > 0) {
      if (text[index] === "(") depth += 1;
      else if (text[index] === ")") depth -= 1;
      continue;
    }
    if (text[index] === "\\") { index += 1; continue; }
    if (text[index] === "`") {
      let marker = "`";
      while (text[index + marker.length] === "`") marker += "`";
      const end = text.indexOf(marker, index + marker.length);
      index = end >= index + marker.length ? end + marker.length - 1 : index + marker.length - 1;
      continue;
    }
    if (text[index] !== "[" && text[index] !== "!") continue;
    const reference = readAmoraReferenceAt(text, index);
    if (!reference) continue;
    if (reference.type === "text") {
      const destination = reference.text.indexOf("](");
      if (destination >= 0) {
        depth = 1;
        index += destination + 1;
        continue;
      }
    }
    index += reference.length - 1;
  }
  return depth;
}
