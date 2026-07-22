import assert from "node:assert/strict";
import test from "node:test";

import { extractDocxTableEvidenceFromXml } from "../convert.js";
import { scanSourceMoneyOccurrences } from "../validate.js";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function cell(text: string): string {
  return `<w:tc>${paragraph(text)}</w:tc>`;
}

function documentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${WORD_NS}"><w:body>${body}</w:body></w:document>`;
}

test("DOCX canonical evidence emits body paragraphs and table cells once in document order", () => {
  const result = extractDocxTableEvidenceFromXml(documentXml([
    paragraph("본문 계약금 100만원"),
    `<w:tbl><w:tr>${cell("표 가격 200만원")}</w:tr></w:tbl>`,
    paragraph("본문 환불금 300만원"),
  ].join("")));

  assert.deepEqual(result.bodyParagraphs, [
    { paragraph: 1, locator: "docx:body:p1", text: "본문 계약금 100만원" },
    { paragraph: 2, locator: "docx:body:p2", text: "본문 환불금 300만원" },
  ]);
  assert.deepEqual(
    result.orderedEntries.map((entry) => entry.kind === "body"
      ? entry.paragraph.locator
      : entry.cell.locator),
    ["docx:body:p1", "table:1!A1", "docx:body:p2"],
  );

  const bodyBeforeTable = result.evidenceText.indexOf("docx:body:p1: 본문 계약금 100만원");
  const table = result.evidenceText.indexOf("table:1!A1: 표 가격 200만원");
  const bodyAfterTable = result.evidenceText.indexOf("docx:body:p2: 본문 환불금 300만원");
  assert.ok(bodyBeforeTable >= 0 && bodyBeforeTable < table && table < bodyAfterTable);
  assert.doesNotMatch(
    result.evidenceText.split(/\r?\n/u)[0] ?? "",
    /^(.+)!([A-Z]+)(\d+):\s*(.+)$/u,
  );

  for (const token of ["100만원", "200만원", "300만원"]) {
    assert.equal(result.evidenceText.split(token).length - 1, 1, `${token} must be authoritative once`);
  }
  assert.deepEqual(
    scanSourceMoneyOccurrences(result.evidenceText).map(({ krw }) => krw),
    [1_000_000, 2_000_000, 3_000_000],
  );
});

test("DOCX table paragraphs never leak into body paragraph evidence", () => {
  const result = extractDocxTableEvidenceFromXml(documentXml([
    paragraph("표 밖 문단"),
    "<w:tbl><w:tr><w:tc><w:p><w:r>"
      + "<w:t>셀 첫 줄 10만원</w:t><w:br/><w:t>셀 둘째 줄</w:t>"
      + "</w:r></w:p></w:tc></w:tr></w:tbl>",
  ].join("")));

  assert.deepEqual(result.bodyParagraphs.map(({ text }) => text), ["표 밖 문단"]);
  assert.equal(result.cells[0]?.text, "셀 첫 줄 10만원\n셀 둘째 줄");
  assert.match(result.evidenceText, /table:1!A1: 셀 첫 줄 10만원<br>셀 둘째 줄/u);
  assert.equal(result.evidenceText.split("10만원").length - 1, 1);
  assert.deepEqual(scanSourceMoneyOccurrences(result.evidenceText).map(({ krw }) => krw), [100_000]);
});
