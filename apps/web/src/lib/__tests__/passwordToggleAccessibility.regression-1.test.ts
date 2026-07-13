import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression: ISSUE-009 — password visibility controls exposed only an 18px
// icon hit area, and reset controls were unnamed and skipped by keyboard focus.
// Found by /qa on 2026-07-12
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-12.md

describe("password visibility control accessibility regression", () => {
  const loginSource = readFileSync(
    join(process.cwd(), "src/app/(auth)/login/page.tsx"),
    "utf8"
  );
  const resetSource = readFileSync(
    join(process.cwd(), "src/app/reset-password/page.tsx"),
    "utf8"
  );

  it("keeps both login visibility controls at a 44px target with names", () => {
    expect(loginSource.match(/h-11 w-11/g)).toHaveLength(2);
    expect(loginSource).toContain('"비밀번호 숨기기" : "비밀번호 보기"');
    expect(loginSource).toContain('"비밀번호 확인 숨기기" : "비밀번호 확인 보기"');
  });

  it("keeps reset visibility controls keyboard reachable and inputs identified", () => {
    expect(resetSource.match(/h-11 w-11/g)).toHaveLength(2);
    expect(resetSource).not.toContain("tabIndex={-1}");
    expect(resetSource).toContain('aria-label={showPassword ? "새 비밀번호 숨기기" : "새 비밀번호 보기"}');
    expect(resetSource).toContain(
      'aria-label={showPasswordConfirm ? "새 비밀번호 확인 숨기기" : "새 비밀번호 확인 보기"}'
    );
    expect(resetSource).toContain('id="new-password"');
    expect(resetSource).toContain('id="new-password-confirm"');
    expect(resetSource.match(/autoComplete="new-password"/g)).toHaveLength(2);
  });
});
