import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/app/chat/ChatContent.tsx"),
  "utf8",
);

describe("chat clear trust contract", () => {
  it("describes view reset as hiding retained records, never as safety or deletion", () => {
    expect(source).not.toContain("데이터는 보존되므로 안전합니다");
    expect(source).not.toContain("데이터 보존됨");
    expect(source).not.toContain("(view-reset)");
    expect(source).toContain("서버 기록은 삭제되지 않습니다");
    expect(source).toContain("이전 메시지는 내 화면에서 숨겨집니다");
  });

  it("keeps a failed shared-clear request visible and retryable", () => {
    expect(source).toContain("clearActionError");
    expect(source).toContain('role="alert"');
    expect(source).toContain("setClearActionError(");
    expect(source).toMatch(/if \(!result\.ok\) \{[\s\S]*?setClearActionError\([\s\S]*?return;/);
    expect(source).toMatch(/if \(!result\.ok\)[\s\S]*?return;[\s\S]*?setClearStep\("closed"\)/);
  });
});
