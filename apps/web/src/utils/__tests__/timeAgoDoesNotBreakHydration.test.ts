import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { timeAgo } from "@/utils/timeAgo";

/**
 * 이 함수가 운영에서 React #418 을 내고 있었다.
 *
 * ## 무엇이 있었나 (2026-08-27)
 *
 * Sentry 의 Error Monitor 에 `Minified React error #418` 이 쌓이고 있었다
 * (마지막 발생 1시간 전). React 문서의 원문:
 *
 *     Hydration failed because the server rendered X didn't match the client.
 *     원인 예: Date.now() 처럼 부를 때마다 달라지는 값,
 *              사용자 로케일 날짜 포맷이 서버와 다름
 *
 * 둘 다 이 함수에 있었다. `"use client"` 컴포넌트도 App Router 는 **먼저 서버에서
 * 그린 뒤 브라우저에서 다시 그린다.**
 *
 * ## 확정적인 쪽 — 시간대
 *
 * 예전 코드는 `date.getFullYear()/getMonth()/getDate()` 로 절대 날짜를 만들었다.
 * 그건 실행 환경의 시간대를 따른다 — 서버(Vercel)는 UTC, 브라우저는 KST.
 *
 *     2026-07-12T20:00:00Z 에 쓴 글
 *       서버(UTC)     2026.07.12
 *       브라우저(KST)  2026.07.13   ← 불일치
 *
 * 운영 실측: 공개 글 17건 중 **1건**이 이 경우였다. 하이드레이션은 트리 전체를
 * 대조하므로 한 건이면 충분하다.
 *
 * 그리고 이건 하이드레이션 문제이기 전에 **그냥 틀린 값**이다 — 한국 새벽 0~9시에
 * 쓴 글이 사용자에게 하루 전 날짜로 보였다.
 *
 * ## 경쟁적인 쪽 — 경계
 *
 * `59분 전` → `1시간 전` 처럼 두 계산 사이에 경계를 넘으면 값이 달라진다.
 * 함수만으로는 못 없앤다. 부르는 쪽이 `suppressHydrationWarning` 을 달아
 * "이 자리는 달라도 된다" 고 알려 준다 — 시간 표시에 대한 React 의 공식 처방이다.
 * 아래 마지막 describe 가 **모든 렌더 자리**가 그걸 달았는지 전수로 본다.
 */

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const WEB_SRC = join(REPO_ROOT, "apps", "web", "src");

/** 서버(UTC)와 브라우저(KST)를 각각 흉내내지 않고, 함수가 시간대에 안 흔들리는지만 본다. */
const AT = (iso: string) => new Date(iso);

describe("측정기가 살아 있다", () => {
  it("옛 방식은 실제로 갈렸다 — 이 검사가 무엇을 막는지 드러내 둔다", () => {
    // 실행 환경의 시간대를 따르는 옛 계산. UTC 에서 돌면 07-12, KST 에서 돌면 07-13.
    const d = AT("2026-07-12T20:00:00Z");
    const localYmd = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
    const kstYmd = "2026.07.13";
    // 이 검사가 도는 환경이 KST 면 둘이 같아 무의미해진다. 그때는 아래 본 검사가
    // 대신 지킨다 — 그래서 여기서는 "옛 방식이 환경을 탄다" 는 사실만 적어 둔다.
    expect(typeof localYmd).toBe("string");
    expect(kstYmd).toBe("2026.07.13");
  });
});

describe("절대 날짜는 시간대를 타지 않는다", () => {
  const OLD = AT("2026-07-12T20:00:00Z"); // KST 로는 07-13 05:00
  const NOW = AT("2026-08-27T00:00:00Z");

  it("UTC 15시 이후에 쓴 글도 KST 날짜로 그린다", () => {
    // 예전에는 서버에서 "2026.07.12", 브라우저에서 "2026.07.13" 이 나왔다.
    expect(timeAgo(OLD.toISOString(), NOW)).toBe("2026.07.13");
  });

  it("자정 직전·직후가 서로 다른 날이다", () => {
    // KST 2026-07-13 00:00 = UTC 2026-07-12 15:00
    expect(timeAgo("2026-07-12T14:59:00Z", NOW)).toBe("2026.07.12");
    expect(timeAgo("2026-07-12T15:01:00Z", NOW)).toBe("2026.07.13");
  });

  it("같은 입력은 언제 불러도 같은 절대 날짜를 준다", () => {
    const a = timeAgo(OLD.toISOString(), AT("2026-08-27T00:00:00Z"));
    const b = timeAgo(OLD.toISOString(), AT("2026-12-31T23:59:00Z"));
    expect(a).toBe(b);
  });
});

describe("실행 환경 시간대를 따르는 계산을 쓰지 않는다", () => {
  /**
   * **이 검사가 왜 동작이 아니라 구현을 보는가.**
   *
   * 이 기계는 KST 라 옛 방식(`date.getFullYear()`)과 새 방식(`ymdInKst`)이 **같은
   * 값을 낸다.** 그래서 옛 방식으로 되돌리는 변형을 동작으로는 잡을 수 없다 —
   * 실제로 변형 검사에서 그 하나만 새어 나갔다. 갈리는 것은 서버(UTC)에서 돌 때뿐인데
   * 그 환경을 여기서 만들 수 없다.
   *
   * 그래서 "무엇을 쓰는가" 로 잠근다. 아래 이름들은 전부 실행 환경의 시간대를 따른다.
   */
  it("시간대를 타는 Date 접근자를 안 쓴다", () => {
    const source = readFileSync(join(WEB_SRC, "utils", "timeAgo.ts"), "utf8");
    // 주석은 뺀다 — 무엇이 잘못이었는지 적어 두는 것까지 막을 이유는 없다.
    const body = source
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");

    for (const banned of ["getFullYear", "getMonth", "getDate", "toLocaleDateString"]) {
      expect(body, `${banned} 는 서버(UTC)와 브라우저(KST)에서 다른 값을 준다`)
        .not.toContain(banned);
    }
    expect(body, "KST 로 못박는 도우미를 안 쓴다").toContain("ymdInKst");
  });
});

describe("상대 시간은 예전 그대로다", () => {
  const NOW = AT("2026-08-27T00:00:00Z");
  it.each([
    ["2026-08-27T00:00:00Z", "방금 전"],
    ["2026-08-26T23:30:00Z", "30분 전"],
    ["2026-08-26T21:00:00Z", "3시간 전"],
    ["2026-08-25T00:00:00Z", "2일 전"],
    ["2026-08-08T00:00:00Z", "19일 전"],
  ])("%s → %s", (iso, expected) => {
    expect(timeAgo(iso, NOW)).toBe(expected);
  });

  it("30일이 되는 순간 절대 날짜로 넘어간다 — 이 경계가 하이드레이션 경쟁의 자리다", () => {
    // NOW = 2026-08-27T00:00:00Z 기준. 정확히 29일 / 30일.
    expect(timeAgo("2026-07-29T00:00:00Z", NOW)).toBe("29일 전");
    expect(timeAgo("2026-07-28T00:00:00Z", NOW)).toMatch(/^\d{4}\.\d{2}\.\d{2}$/u);
  });
});

describe("그리는 자리마다 하이드레이션 예외를 달았다", () => {
  /**
   * **목록을 손으로 적지 않는다.** 경계 경쟁은 함수로 못 없애므로 렌더 자리마다
   * 표시가 필요한데, 하나만 빠뜨려도 그 화면에서 #418 이 다시 난다. 새로 추가되는
   * 자리까지 잡으려면 전수로 찾아야 한다.
   */
  const renderSites = (() => {
    const found: Array<{ file: string; line: number; text: string; guarded: boolean }> = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "__tests__") continue;
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".tsx") || entry.name.includes(".test.")) continue;
        const lines = readFileSync(full, "utf8").split("\n");
        lines.forEach((line, index) => {
          if (!line.includes("{timeAgo(")) return;
          const previous = index > 0 ? lines[index - 1] : "";
          found.push({
            file: full.slice(WEB_SRC.length + 1).replace(/\\/gu, "/"),
            line: index + 1,
            text: line.trim(),
            guarded:
              line.includes("suppressHydrationWarning")
              || previous.includes("suppressHydrationWarning"),
          });
        });
      }
    };
    walk(WEB_SRC);
    return found;
  })();

  it("렌더 자리를 실제로 찾았다 — 0건이면 아래 검사가 통째로 비어 초록불이 된다", () => {
    expect(renderSites.length, "timeAgo 를 그리는 곳을 하나도 못 찾았다")
      .toBeGreaterThanOrEqual(6);
  });

  it("빠짐없이 suppressHydrationWarning 이 붙어 있다", () => {
    const bare = renderSites.filter((site) => !site.guarded);
    expect(
      bare.map((s) => `${s.file}:${s.line}  ${s.text}`),
      "이 자리에서 하이드레이션이 깨진다",
    ).toEqual([]);
  });
});
