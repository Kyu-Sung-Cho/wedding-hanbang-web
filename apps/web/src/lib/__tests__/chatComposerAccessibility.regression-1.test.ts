import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression: ISSUE-010 — the main Amora composer exposed an unnamed send
// control, including on the disabled demo screen.
// Found by /qa on 2026-07-12
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-12.md

describe("Amora composer send accessibility regression", () => {
  it("names demo, partner, private, and normal send states", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/app/chat/ChatContent.tsx"),
      "utf8"
    );

    expect(source).toContain('"데모에서는 메시지를 보낼 수 없어요"');
    expect(source).toContain('"상대방에게 메시지 보내기"');
    expect(source).toContain('"아모라에게 비공개 메시지 보내기"');
    expect(source).toContain('"아모라에게 메시지 보내기"');
    expect(source).toMatch(
      /aria-label=\{[\s\S]{0,1500}<Send className="w-4 h-4 sm:w-\[1\.125rem\] sm:h-\[1\.125rem\]" \/>/
    );
  });
});
