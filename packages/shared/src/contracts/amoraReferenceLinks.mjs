/** 출처 URL의 존재·신뢰성을 보증하지 않는다. 클릭할 수 있는 주소 형식만 검사한다. */
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
  const labelOffset = text.slice(labelStart, labelStart + 2049).indexOf("](");
  const labelEnd = labelOffset < 0 ? -1 : labelStart + labelOffset;
  if (labelEnd < labelStart || labelEnd - labelStart > 2048) return null;
  const unsupportedLabel = /[\[\]\n]/u.test(text.slice(labelStart, labelEnd));
  let depth = 1;
  let end = labelEnd + 2;
  const inert = () => ({ type: "text", text: text.slice(index), length: text.length - index });
  for (; end < text.length && end - labelEnd <= 8192; end += 1) {
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
