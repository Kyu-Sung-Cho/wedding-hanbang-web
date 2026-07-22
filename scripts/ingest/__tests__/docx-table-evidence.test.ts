import assert from "node:assert/strict";
import test from "node:test";

import {
  DOCX_TABLE_EVIDENCE_VERSION,
  extractDocxTableEvidenceFromXml,
} from "../convert.js";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function cell(text: string, properties = ""): string {
  return `<w:tc>${properties ? `<w:tcPr>${properties}</w:tcPr>` : ""}<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}

function table(vendors: string[]): string {
  return `<w:tbl>${vendors.map((vendor, index) =>
    `<w:tr>${cell(vendor)}${cell(`${(index + 1) * 10}만원`)}</w:tr>`
  ).join("")}</w:tbl>`;
}

function documentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${WORD_NS}"><w:body>${body}</w:body></w:document>`;
}

test("DOCX table evidence preserves three table boundaries and all 19 vendor rows", () => {
  const vendorGroups = [
    Array.from({ length: 6 }, (_, index) => `업체A-${index + 1}`),
    Array.from({ length: 6 }, (_, index) => `업체B-${index + 1}`),
    Array.from({ length: 7 }, (_, index) => `업체C-${index + 1}`),
  ];
  const xml = documentXml(vendorGroups.map(table).join(""));

  const first = extractDocxTableEvidenceFromXml(xml);
  const second = extractDocxTableEvidenceFromXml(xml);

  assert.deepEqual(second, first);
  assert.deepEqual(first.tables, [
    { table: 1, rows: 6, columns: 2 },
    { table: 2, rows: 6, columns: 2 },
    { table: 3, rows: 7, columns: 2 },
  ]);
  assert.equal(first.cells.filter((entry) => entry.text.startsWith("업체")).length, 19);
  assert.equal(first.cells.find((entry) => entry.locator === "table:1!A1")?.text, "업체A-1");
  assert.equal(first.cells.find((entry) => entry.locator === "table:2!A6")?.text, "업체B-6");
  assert.equal(first.cells.find((entry) => entry.locator === "table:3!A7")?.text, "업체C-7");
  assert.match(
    first.evidenceText,
    /^table:1!A1: 업체A-1/u,
  );
  assert.match(first.evidenceText, /table:3!B7: 70만원/u);
});

test("DOCX merged cells retain their starting locator, span, and row columns", () => {
  const xml = documentXml([
    "<w:tbl>",
    `<w:tr>${cell("공통 조건", '<w:gridSpan w:val="2"/>')}</w:tr>`,
    `<w:tr>${cell("유탑 업체")}${cell("120만원", '<w:vMerge w:val="restart"/>')}</w:tr>`,
    "</w:tbl>",
  ].join(""));

  const result = extractDocxTableEvidenceFromXml(xml);

  assert.deepEqual(result.tables, [{ table: 1, rows: 2, columns: 2 }]);
  assert.deepEqual(result.cells.map(({ locator, column_span, vertical_merge }) => ({
    locator,
    column_span,
    vertical_merge,
  })), [
    { locator: "table:1!A1", column_span: 2, vertical_merge: null },
    { locator: "table:1!A2", column_span: 1, vertical_merge: null },
    { locator: "table:1!B2", column_span: 1, vertical_merge: "restart" },
  ]);
  assert.match(result.evidenceText, /(?:^|\n)table:1!A1: 공통 조건(?:\n|$)/u);
  assert.match(result.evidenceText, /(?:^|\n)table:1!B2: 120만원(?:\n|$)/u);

  const workbookCompatibleCells = result.evidenceText
    .split(/\r?\n/u)
    .filter((line) => /^(.+)!([A-Z]+)(\d+):\s*(.+)$/u.test(line));
  assert.ok(workbookCompatibleCells.includes("table:1!A1: 공통 조건"));
  assert.ok(workbookCompatibleCells.includes("table:1!B2: 120만원"));

  const metadata = result.evidenceText
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("[DOCX_CELL_META] "))
    .map((line) => JSON.parse(
      Buffer.from(line.slice("[DOCX_CELL_META] ".length), "base64url").toString("utf8"),
    ));
  assert.deepEqual(metadata, [
    {
      version: DOCX_TABLE_EVIDENCE_VERSION,
      locator: "table:1!A1",
      table: 1,
      row: 1,
      column: 1,
      span: "A1:B1",
      vertical_merge: null,
      empty: false,
    },
    {
      version: DOCX_TABLE_EVIDENCE_VERSION,
      locator: "table:1!B2",
      table: 1,
      row: 2,
      column: 2,
      span: null,
      vertical_merge: "restart",
      empty: false,
    },
  ]);
});
