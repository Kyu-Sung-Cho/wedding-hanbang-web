import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPdfLayoutTextEvidence,
  PDF_LAYOUT_EVIDENCE_VERSION,
  type PdfPositionedTextPage,
} from "../convert.js";

test("PDF layout evidence is invariant to shuffled page and item input", () => {
  const input: PdfPositionedTextPage[] = [
    {
      page: 2,
      items: [
        { text: "둘째 페이지", x: 20, y: 700.25, width: 42, height: 9 },
      ],
    },
    {
      page: 1,
      items: [
        { text: "68,000원", x: 340.5, y: 710.2, width: 35, height: 8 },
        { text: "식대", x: 110.25, y: 710.6, width: 20, height: 8 },
        { text: "그레이스홀", x: 110.25, y: 735, width: 48, height: 9 },
      ],
    },
  ];
  const shuffled: PdfPositionedTextPage[] = [
    { page: 1, items: [...input[1]!.items].reverse() },
    { page: 2, items: [...input[0]!.items].reverse() },
  ];

  const first = buildPdfLayoutTextEvidence(input);
  const second = buildPdfLayoutTextEvidence(shuffled);

  assert.deepEqual(second, first);
  assert.equal(
    first.orderedText,
    "그레이스홀\n식대\t68,000원\n\n둘째 페이지",
  );

  const firstEvidenceLine = first.evidenceText
    .split("\n")
    .find((line) => line.includes("page=1 row=1"));
  assert.ok(firstEvidenceLine);
  const payload = firstEvidenceLine.slice(firstEvidenceLine.indexOf("] ") + 2);
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    version: number;
    items: Array<{ text: string; x: number; y: number }>;
  };
  assert.equal(decoded.version, PDF_LAYOUT_EVIDENCE_VERSION);
  assert.deepEqual(decoded.items, [{
    column: 1,
    text: "그레이스홀",
    x: 110.25,
    y: 735,
    width: 48,
    height: 9,
  }]);
});
test("PDF row clustering does not transitively connect distinct y anchors", () => {
  const result = buildPdfLayoutTextEvidence([{
    page: 1,
    items: [
      { text: "첫 행 왼쪽", x: 10, y: 100 },
      { text: "첫 행 오른쪽", x: 100, y: 99.4 },
      // This is close to the preceding item but 1.2pt from the fixed row
      // anchor. It must remain a separate visual row.
      { text: "둘째 행", x: 10, y: 98.8 },
    ],
  }]);

  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows.map((row) => row.items.map((item) => item.text)), [
    ["첫 행 왼쪽", "첫 행 오른쪽"],
    ["둘째 행"],
  ]);
  assert.equal(result.orderedText, "첫 행 왼쪽\t첫 행 오른쪽\n둘째 행");
});
