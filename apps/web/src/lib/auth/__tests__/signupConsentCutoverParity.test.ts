import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getSignupConsentAccess } from "@hanbang/shared";

const legacy = {
  created_at: "2025-01-01T00:00:00.000Z",
  user_metadata: { terms_agreed: true, privacy_agreed: true },
};

describe("가입 동의 runtime와 production build의 전환 시각 경계", () => {
  it.each([
    ["2026-01-01T00:00:00.000Z", true],
    ["2026-01-01T12:34:56.789Z", true],
    ["", false],
    ["2026-01-01", false],
    ["2026-01-01T00:00:00Z", false],
    ["2026-01-01T00:00:00.000000Z", false],
    ["2026-01-01T09:00:00.000+09:00", false],
    ["2026-02-30T00:00:00.000Z", false],
    ["2026-13-01T00:00:00.000Z", false],
    ["2999-01-01T00:00:00.000Z", false],
  ] as const)("같은 전환 설정을 양쪽에서 같은 기준으로 판정한다: %s", (cutoff, accepted) => {
    const result = spawnSync(process.execPath, [
      resolve(process.cwd(), "../../scripts/check-amora-production-env.mjs"),
    ], {
      // 실제 서비스 자격증명과 외부 전송 설정을 자식 프로세스에 넘기지 않는다.
      env: { NODE_ENV: "test", PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, SIGNUP_CONSENT_LEGACY_BEFORE: cutoff },
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    const report = JSON.parse(result.stdout);
    expect(report.checks.signupConsentCutoverConfigured).toBe(accepted);
    expect(getSignupConsentAccess(legacy, cutoff)).toBe(accepted ? "legacy_unverified" : "configuration_error");
  });
});
