import { getAmoraUnclosedReferenceDepth, readAmoraReferenceAt } from "@hanbang/shared/amora-reference-links";

/** Native 본문용 제한된 Markdown. 사용자 원문과 실행 도구에는 적용하지 않는다. */
export function parseAmoraMessageBody(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
    if (fence) {
      const body = [];
      index += 1;
      while (index < lines.length) {
        const end = lines[index].match(/^ {0,3}(`{3,}|~{3,})\s*$/u)?.[1];
        if (end && end[0] === fence[0] && end.length >= fence.length) { index += 1; break; }
        body.push(lines[index++]);
      }
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    let referenceDepth = getAmoraUnclosedReferenceDepth(line);
    if (referenceDepth > 0) {
      const paragraph = [line];
      index += 1;
      while (index < lines.length && referenceDepth > 0) {
        paragraph.push(lines[index]);
        referenceDepth = getAmoraUnclosedReferenceDepth(lines[index++], referenceDepth);
      }
      blocks.push({ type: "paragraph", text: paragraph.join("\n") });
      continue;
    }
    const headers = tableCells(line);
    const divider = tableCells(lines[index + 1] ?? "");
    if (headers && divider && headers.length === divider.length && divider.every((cell) => /^:?-{3,}:?$/u.test(cell))) {
      index += 2;
      const rows = [];
      while (index < lines.length) {
        if (getAmoraUnclosedReferenceDepth(lines[index]) > 0) break;
        const row = tableCells(lines[index]);
        if (!row || row.length !== headers.length) break;
        rows.push(row);
        index += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }
    const heading = line.match(/^ {0,3}#{1,6}\s+(.+)$/u);
    if (heading) { blocks.push({ type: "heading", text: heading[1] }); index += 1; continue; }
    if (/^ {0,3}>/u.test(line)) {
      const quote = [];
      while (index < lines.length && /^ {0,3}>/u.test(lines[index])) {
        if (quote.length > 0 && getAmoraUnclosedReferenceDepth(lines[index]) > 0) break;
        quote.push(lines[index++].replace(/^ {0,3}> ?/u, ""));
      }
      blocks.push({ type: "quote", text: quote.join("\n") });
      continue;
    }
    const list = line.match(/^ {0,3}([-+*]|\d{1,9}[.)])\s+(.+)$/u);
    if (list) { blocks.push({ type: "list", marker: list[1], text: list[2] }); index += 1; continue; }
    // 문단은 원래 줄바꿈을 보존한다. 잘못된 표도 임의로 열/숫자를 버리지 않는다.
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim()
      && getAmoraUnclosedReferenceDepth(lines[index]) === 0
      && !/^ {0,3}(?:>|#{1,6}\s|[-+*]\s|\d{1,9}[.)]\s|`{3,}|~{3,})/u.test(lines[index])
      && !(tableCells(lines[index]) && tableCells(lines[index + 1] ?? "")?.every((cell) => /^:?-{3,}:?$/u.test(cell)))) {
      paragraph.push(lines[index++]);
    }
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

function tableCells(line) {
  const cells = [];
  let cell = "";
  let code = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\" && index + 1 < line.length) { cell += char + line[++index]; continue; }
    const reference = !code ? readAmoraReferenceAt(line, index) : null;
    if (reference) {
      cell += line.slice(index, index + reference.length);
      index += reference.length - 1;
      continue;
    }
    if (char === "`") {
      let marker = char;
      while (line[index + 1] === "`") marker += line[++index];
      if (!code) code = marker;
      else if (code === marker) code = "";
      cell += marker;
    } else if (char === "|" && !code) { cells.push(cell.trim()); cell = ""; }
    else cell += char;
  }
  if (cells.length === 0) return null;
  cells.push(cell.trim());
  if (cells[0] === "" && line.trimStart().startsWith("|")) cells.shift();
  if (cells.at(-1) === "" && line.trimEnd().endsWith("|")) cells.pop();
  return cells.length > 0 ? cells : null;
}

export function parseAmoraInline(text) {
  // 긴 비정상 한 줄도 원문을 버리지는 않는다. 인라인 구문 탐색 비용만 제한한다.
  if (text.length > 12000) return [{ type: "text", text }];
  const parts = [];
  const append = (value) => {
    if (parts.at(-1)?.type === "text") parts.at(-1).text += value;
    else parts.push({ type: "text", text: value });
  };
  for (let index = 0; index < text.length;) {
    const char = text[index];
    if (char === "\\" && /[\\`*_[\]{}()#+.!|>~-]/u.test(text[index + 1] ?? "")) {
      append(text[index + 1]); index += 2; continue;
    }
    const reference = readAmoraReferenceAt(text, index);
    if (reference) {
      if (reference.type === "link") parts.push({ type: "link", text: reference.text, href: reference.href });
      else append(reference.text);
      index += reference.length;
      continue;
    }
    if (char === "`" || char === "*" || char === "_") {
      let marker = char;
      if (char === "`") { while (text[index + marker.length] === char) marker += char; }
      else if (text[index + 1] === char) marker += char;
      const innerWord = /[\p{L}\p{N}]/u.test(text[index - 1] ?? "") && /[\p{L}\p{N}]/u.test(text[index + marker.length] ?? "");
      const end = text.indexOf(marker, index + marker.length);
      const body = text.slice(index + marker.length, end);
      if (!innerWord && end > index + marker.length && (char === "`" || body.trim() === body)) {
        parts.push({ type: char === "`" ? "code" : marker.length === 2 ? "strong" : "emphasis", text: text.slice(index + marker.length, end) });
        index = end + marker.length; continue;
      }
    }
    append(char); index += 1;
  }
  return parts;
}
