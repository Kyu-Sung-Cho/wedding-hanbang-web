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

  it("keeps attachment removal visible and touch-sized on mobile", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/app/chat/ChatSidePanel.tsx"),
      "utf8"
    );

    expect(source).toContain('aria-label={`${att.fileName} 첨부 삭제`}');
    expect(source).toMatch(
      /aria-label=\{`\$\{att\.fileName\} 첨부 삭제`\}[\s\S]{0,350}h-11 w-11[\s\S]{0,350}opacity-100[\s\S]{0,350}md:opacity-0/
    );
    expect(source).toContain(
      'className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[#795252] to-[#946a6a] shadow-sm"'
    );
  });
});
