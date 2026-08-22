import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { CONTACT } from "../contact";

/**
 * 공개 표면의 연락처 주소가 **한 곳에서만 나온다.**
 *
 * ## 무엇이 있었나
 *
 * 2026-08-22 실측: `CONTACT.email` 상수가 있는데도 **여덟 자리가 주소를 직접 박아**
 * 두고 있었다. 그중 셋이 약관·개인정보 처리방침·AI 고지였다.
 *
 * 상수에는 "이 주소가 메일을 실제로 받는지 확인하라"는 TODO 가 달려 있었고, 확인해 보니
 * **받지 않는 주소였다.** 그런데 상수를 고쳐도 박아 둔 여덟 자리는 옛 주소를 계속
 * 말했을 것이다 — 법정 연락처가 화면마다 다르게 나오는 상태다.
 *
 * ## 무엇을 지키나
 *
 * `@hanbang.ai` 로 끝나는 주소를 소스에 직접 적지 못하게 한다. 연락처는
 * `CONTACT.email` 로만 나와야 한다. 그래야 주소를 바꿀 때 **한 줄만** 고치면 된다.
 */
describe("연락처 주소는 한 곳에서만 나온다", () => {
  const webSrc = resolve(process.cwd(), "src");

  /**
   * 연락 채널이 **아닌** hanbang.ai 주소들. 여기에는 이유를 적는다.
   *
   * 파일이 아니라 **주소**로 가른다. 파일로 가르면 그 파일에 새 연락처가 들어가도
   * 통과하고, 목록도 금세 길어진다.
   */
  const NON_CONTACT_ADDRESSES = new Map([
    ["noreply@hanbang.ai", "발송 전용 From 주소 — 사람이 답장하는 곳이 아니다"],
    ["demo@hanbang.ai", "데모 계정 픽스처"],
    ["admin@hanbang.ai", "관리자 로그인 입력칸의 placeholder"],
    ["ceo@hanbang.ai", "사업자 정보 env 테스트 픽스처"],
  ]);

  /** 상수 자신과 이 검사. 여기에는 연락처가 적혀 있어야 한다. */
  const ALLOWED = new Set([
    join("lib", "constants", "contact.ts"),
    join("lib", "constants", "__tests__", "contactAddressIsSingleSourced.test.ts"),
  ]);

  function sourceFiles(): Array<{ path: string; text: string }> {
    const out: Array<{ path: string; text: string }> = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        out.push({ path: relative(webSrc, full), text: readFileSync(full, "utf8") });
      }
    };
    walk(webSrc);
    return out;
  }

  it("측정기가 살아 있다", () => {
    const files = sourceFiles();
    expect(files.length, "소스를 못 읽었습니다").toBeGreaterThan(100);
    // 상수 파일 자신은 반드시 걸려야 한다 — 안 걸리면 탐지가 죽은 것이다.
    const constantFile = files.find((f) => f.path === join("lib", "constants", "contact.ts"));
    expect(constantFile, "상수 파일을 못 찾았습니다").toBeTruthy();
    expect(constantFile?.text).toContain("@hanbang.ai");
  });

  it("상수 밖에서 연락처 주소를 직접 적지 않는다", () => {
    // 주석은 지운다 — 이력을 적어 두는 것까지 막을 이유는 없다. 블록 주석을 통째로
    // 걷어내지 않고 줄 단위로만 지우면 여는 줄만 사라지고 본문이 남는다(전에 당했다).
    const strip = (text: string) =>
      text
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/^[ 	]*\/\/.*$/gmu, "");

    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (ALLOWED.has(file.path)) continue;
      for (const found of strip(file.text).matchAll(/[A-Za-z0-9._-]+@hanbang\.ai/gu)) {
        const address = found[0];
        if (NON_CONTACT_ADDRESSES.has(address)) continue;
        offenders.push(`${file.path.split(sep).join("/")} (${address})`);
      }
    }

    expect(
      [...new Set(offenders)],
      "연락처 주소가 직접 박혀 있습니다. `CONTACT.email` 을 쓰세요 — 박아 두면 "
        + "주소를 바꿀 때 화면마다 다른 말을 합니다. 연락 채널이 아닌 주소라면 "
        + "NON_CONTACT_ADDRESSES 에 **이유와 함께** 적으세요.",
    ).toEqual([]);
  });

  it("법적 문서가 그 주소를 실제로 보여준다", () => {
    // 반대 방향. 상수만 있고 화면이 안 쓰면 연락처가 사라진 것이다.
    for (const page of ["app/terms/page.tsx", "app/privacy/page.tsx", "app/ai-policy/page.tsx"]) {
      const text = readFileSync(resolve(webSrc, page), "utf8");
      expect(text, `${page} 가 연락처를 안 보여줍니다`).toContain("CONTACT.email");
    }
  });

  it("주소 모양이 성하다", () => {
    expect(CONTACT.email).toMatch(/^[a-z0-9._-]+@hanbang\.ai$/u);
  });
});
