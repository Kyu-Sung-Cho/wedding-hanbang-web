import { existsSync, readdirSync, readFileSync } from "node:fs";
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
 * ## 2026-08-26 — 웹만 모였고 모바일은 안 따라왔다
 *
 * 이 검사가 `apps/web/src` 만 훑었기 때문에 모바일은 넉 달째 제 갈 길을 갔다.
 *
 *     app/(auth)/consent.tsx   계정 삭제 안내가 `support@hanbang.ai` — **메일을 받지 않는 옛 주소**
 *     app/(tabs)/profile.tsx   "고객센터" 가 `mailto:ceo@hanbang.ai`
 *     app/settings/index.tsx   "고객지원 문의" 두 자리가 같은 주소
 *
 * `ceo@hanbang.ai` 는 이 검사가 "사업자 정보 env 테스트 픽스처" 라며 면제한 주소인데,
 * 모바일이 그걸 **사용자 문의 링크**로 쓰고 있었다. 주소 단위 면제가 앱 경계를 넘으면
 * 뜻이 달라진다.
 *
 * 그래서 상수를 `packages/shared` 로 올려 두 앱이 같은 곳을 보게 하고, 이 검사도
 * **웹·모바일·공유를 함께** 훑는다. 한쪽만 지키는 가드는 지키지 않는 것과 같다.
 */
describe("연락처 주소는 한 곳에서만 나온다", () => {
  const repoRoot = resolve(process.cwd(), "..", "..");

  /** 훑는 곳. 앱이 늘면 여기 추가한다 — 빠뜨리면 그 앱이 제 갈 길을 간다. */
  const ROOTS = [
    { label: "web", dir: resolve(process.cwd(), "src") },
    { label: "mobile", dir: join(repoRoot, "apps", "mobile", "app") },
    { label: "mobile-src", dir: join(repoRoot, "apps", "mobile", "src") },
    { label: "shared", dir: join(repoRoot, "packages", "shared", "src") },
  ].filter((root) => existsSync(root.dir));

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
    ["ceo@hanbang.ai", "사업자 정보 env 테스트 픽스처 — **사용자 문의 링크로 쓰지 말 것**"],
  ]);

  /** 상수 자신과 이 검사. 여기에는 연락처가 적혀 있어야 한다. */
  const ALLOWED = new Set([
    "shared:constants/contact.ts",
    // id 는 항상 `/` 로 만든다. 여기서 path.join 을 쓰면 Windows 에서 백슬래시가 되어
    // 영원히 안 맞는다(처음에 그렇게 썼다가 이 파일 자신이 위반으로 잡혔다).
    "web:lib/constants/__tests__/contactAddressIsSingleSourced.test.ts",
  ]);

  function sourceFiles(): Array<{ id: string; text: string }> {
    const out: Array<{ id: string; text: string }> = [];
    for (const root of ROOTS) {
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === "node_modules") continue;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) { walk(full); continue; }
          if (!/\.(ts|tsx)$/.test(entry.name)) continue;
          const label = root.label === "mobile-src" ? "mobile" : root.label;
          out.push({
            id: `${label}:${relative(root.dir, full).split(sep).join("/")}`,
            text: readFileSync(full, "utf8"),
          });
        }
      };
      walk(root.dir);
    }
    return out;
  }

  it("측정기가 살아 있다", () => {
    // 훑는 곳이 줄면 그 앱이 조용히 빠진다. 셋 다 있어야 한다.
    expect(ROOTS.map((r) => r.label)).toContain("mobile");
    expect(ROOTS.map((r) => r.label)).toContain("shared");

    const files = sourceFiles();
    expect(files.length, "소스를 못 읽었습니다").toBeGreaterThan(100);
    expect(
      files.filter((f) => f.id.startsWith("mobile:")).length,
      "모바일 소스를 못 읽었습니다 — 경로가 바뀌었나?",
    ).toBeGreaterThan(20);

    // 상수 파일 자신은 반드시 걸려야 한다 — 안 걸리면 탐지가 죽은 것이다.
    const constantFile = files.find((f) => f.id === "shared:constants/contact.ts");
    expect(constantFile, "공유 상수 파일을 못 찾았습니다").toBeTruthy();
    expect(constantFile?.text).toContain("@hanbang.ai");
  });

  it("두 앱이 같은 주소를 말한다", () => {
    // 웹의 재수출이 끊기면 두 앱이 다른 값을 말할 수 있다.
    expect(CONTACT.email).toBe("contact@hanbang.ai");
  });

  it("상수 밖에서 연락처 주소를 직접 적지 않는다", () => {
    // 주석은 지운다 — 이력을 적어 두는 것까지 막을 이유는 없다. 블록 주석을 통째로
    // 걷어내지 않고 줄 단위로만 지우면 여는 줄만 사라지고 본문이 남는다(전에 당했다).
    const strip = (text: string) =>
      text
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/^[ \t]*\/\/.*$/gmu, "");

    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (ALLOWED.has(file.id)) continue;
      for (const found of strip(file.text).matchAll(/[A-Za-z0-9._-]+@hanbang\.ai/gu)) {
        const address = found[0];
        if (NON_CONTACT_ADDRESSES.has(address)) continue;
        offenders.push(`${file.id} (${address})`);
      }
    }

    expect(
      [...new Set(offenders)],
      "연락처는 CONTACT.email 로만 나와야 합니다",
    ).toEqual([]);
  });

  it("사용자에게 보이는 문의 링크가 면제 주소를 쓰지 않는다", () => {
    // 주소 단위 면제는 앱 경계를 넘으면 뜻이 달라진다. `ceo@` 는 env 픽스처용
    // 면제인데 모바일이 `mailto:` 링크로 썼다(2026-08-26). 그 조합만 따로 막는다.
    const stripComments = (text: string) =>
      text
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/^[ 	]*\/\/.*$/gmu, "");

    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (ALLOWED.has(file.id)) continue;
      const body = stripComments(file.text);
      for (const address of NON_CONTACT_ADDRESSES.keys()) {
        if (address === "noreply@hanbang.ai") continue; // From 주소는 mailto 로 쓰이지 않는다
        if (body.includes(`mailto:${address}`)) {
          offenders.push(`${file.id} (mailto:${address})`);
        }
      }
    }
    expect([...new Set(offenders)], "문의 링크는 CONTACT.email 로만 엽니다").toEqual([]);
  });
});
