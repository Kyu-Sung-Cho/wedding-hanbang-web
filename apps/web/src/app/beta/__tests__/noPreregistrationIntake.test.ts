// @vitest-environment node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `/beta` 가 개인정보를 받지 않는지 본다.
 *
 * 사전등록 폼은 **동의 절차 없이** 이메일(필수)·이름·예식 예정일·메시지를 받았다.
 * `BetaForm.tsx` 안에 "동의" 라는 글자가 한 번도 없었고, 처리방침 제1조의 수집 항목에도
 * 사전등록이 없었다 — 회원의 수집만 적혀 있었다.
 *
 * 동의 UI 를 만드는 대신 **받는 것을 없앴다**(2026-08-23 파운더 결정). 계정은 승인 없이
 * 지금 바로 만들 수 있어서 대기열에 세울 이유가 없었고, 초기에는 지인에게만 열 계획이라
 * 수집할 명단이 필요하지 않다.
 *
 * 다시 붙이려면 **동의 절차와 처리방침 개정이 함께 와야 한다.** 그래서 이 검사가 있다.
 */
describe("사전등록 수집 면", () => {
  const webRoot = resolve(process.cwd(), "src");
  const betaDir = join(webRoot, "app", "beta");

  it("검사가 실제로 파일을 읽는다", () => {
    // 경로가 틀리면 아래 검사들이 빈 목록을 보며 늘 통과한다.
    expect(existsSync(betaDir), "/beta 폴더를 못 찾았다").toBe(true);
    expect(existsSync(join(betaDir, "page.tsx"))).toBe(true);
  });

  it("사전등록 API 가 없다", () => {
    const route = join(webRoot, "app", "api", "preregister");
    expect(
      existsSync(route),
      "사전등록 API 가 돌아왔다 — 동의 절차와 처리방침 개정이 함께 왔는지 확인하라",
    ).toBe(false);
  });

  it("/beta 어디에도 입력칸이 없다", () => {
    function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return entry === "__tests__" ? [] : walk(full);
        return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
      });
    }

    const files = walk(betaDir);
    expect(files.length).toBeGreaterThan(0);

    const withInputs = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return /<input\b|<textarea\b|type="email"/.test(source);
    });

    expect(
      withInputs.map((file) => file.split(/[\\/]/).slice(-2).join("/")),
      "개인정보를 받는 칸이 다시 생겼다 — 동의 절차 없이 받으면 안 된다",
    ).toEqual([]);
  });

  it("확인 메일 함수도 남아 있지 않다", () => {
    // 부르는 곳이 없는 발신 함수를 남겨 두면 다음 사람이 "이미 있으니 쓰자"가 된다.
    const resend = readFileSync(join(webRoot, "lib", "resend.ts"), "utf8");
    expect(resend).not.toContain("sendPreregistrationEmail");
  });
});
