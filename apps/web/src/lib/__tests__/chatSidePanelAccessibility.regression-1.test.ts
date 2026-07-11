import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression: ISSUE-005 — the open Amora panel exposed an unnamed send button.
// Found by /qa on 2026-07-12
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-12.md

describe("Amora side-panel accessibility regression", () => {
  it("gives the send control a target-specific accessible name", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/app/chat/ChatSidePanel.tsx"),
      "utf8"
    );

    expect(source).toContain(
      'aria-label={messageTarget === "partner" ? "상대방에게 메시지 보내기" : "아모라에게 메시지 보내기"}'
    );
    expect(source).toMatch(
      /aria-label=\{messageTarget[\s\S]{0,600}<Send className="w-4 h-4" \/>/
    );
  });
});
