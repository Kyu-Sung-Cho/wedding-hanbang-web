import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { MANNERS_PARTS } from "@/lib/manners/data";
import { stripComments } from "../../testing/sourceText";

/**
 * 예절 안내의 경계.
 *
 * 이력이 길어서 한 번 정리해 둔다.
 *   2026-07-17  예절 코퍼스 25편과 렌더러·라우트를 삭제(출처 0건·성별 고정이 사유).
 *   2026-08-11  출처 계약을 통과한 `/manners` 10편을 새로 씀.
 *   2026-08-19  파운더 결정으로 레거시 25편 복원 → 성별·강압 문구 정리 →
 *               **25편을 `/manners` 스키마로 이관**하고 `/etiquette`를 제거.
 *
 * 그래서 지금 예절 안내는 **한 벌**이다. 주제마다 고유 URL을 갖고, 사이트맵에 개별
 * 등재되며, 출처 계약(`mannersSourceContract.test.ts`)이 전부에 걸린다.
 *
 * 이 파일이 지키는 것은 그 통합이 다시 갈라지지 않는 것이다.
 */
const webRoot = process.cwd();
const source = (path: string): string => readFileSync(resolve(webRoot, path), "utf8");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) return sourceFiles(fullPath);
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) return [];
    return [fullPath];
  });
}

describe("예절 안내는 한 벌이다", () => {
  it("25편이 전부 manners 아래에 있다", () => {
    expect(MANNERS_PARTS).toHaveLength(25);
    const legacyNumbers = MANNERS_PARTS.map((part) => part.legacyNumber).sort((a, b) => a - b);
    expect(legacyNumbers).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  // 갈라짐의 재발을 막는 핵심 단언. 두 번째 코퍼스가 생기면 사용자는 "둘 중 뭘 봐야
  // 하지"를 먼저 풀어야 하고, 검색은 둘로 쪼개진다.
  it("두 번째 예절 코퍼스를 만들지 않는다", () => {
    expect(existsSync(resolve(webRoot, "src/constants/etiquetteData.ts"))).toBe(false);
    expect(existsSync(resolve(webRoot, "src/components/app/etiquette"))).toBe(false);
    expect(existsSync(resolve(webRoot, "src/app/(community)/etiquette"))).toBe(false);
  });

  // 옛 주소는 25편을 `?part=N` 한 URL에 담고 있었다. 그 형태로는 검색에 주제별로
  // 잡히지 않는다. 되돌아오지 않게 막고, 대신 리다이렉트가 살아 있는지 본다.
  it("옛 단일 URL 형태로 되돌아가지 않는다", () => {
    // 주석은 대상이 아니다 — 왜 옮겼는지 설명을 남길 수 있어야 한다.
    const offenders = sourceFiles(resolve(webRoot, "src"))
      .filter((file) => /etiquette\?part=|\/etiquette["'`?]/.test(stripComments(readFileSync(file, "utf8"))))
      .map((file) => relative(webRoot, file));
    expect(offenders, `옛 예절 주소 참조가 남았다: ${offenders.join(", ")}`).toEqual([]);

    const config = source("next.config.ts");
    expect(config).toContain('source: "/wedding/etiquette"');
    expect(config).toContain('destination: "/wedding/manners"');
  });

  /**
   * 모바일은 예전에 `https://hanbang.ai/etiquette`를 웹뷰로 열다가, 그 라우트가 지워진 뒤
   * 404를 계속 띄웠다. 그래서 한동안 이 검사는 모바일 소스에서 `etiquette`라는 **단어**를
   * 통째로 금지했다.
   *
   * 2026-08-20에 안내가 복구되면서 사람이 의도해서 링크를 다시 넣었다 — 그게 원래 이
   * 검사가 요구하던 일이다. 그런데 앱 안의 라우트 이름이 `/etiquette`라 단어 금지에
   * 걸렸다. 위험한 것은 이름이 아니라 **죽은 목적지**이므로, 목적지를 본다.
   */
  it("모바일이 죽은 예절 주소를 열지 않는다", () => {
    const mobileRoot = resolve(webRoot, "..", "mobile");
    const mobileSources = [
      ...sourceFiles(resolve(mobileRoot, "app")),
      ...sourceFiles(resolve(mobileRoot, "src")),
    ].filter((file) => !file.includes("__tests__"));

    // 사이트 주소 뒤에 바로 /etiquette를 붙이는 것 — 이것이 404였던 그 주소다.
    const DEAD_DESTINATION = /(hanbang\.ai|\$\{SITE\}|SITE_URL)\/etiquette/;
    const offenders = mobileSources
      .filter((file) => DEAD_DESTINATION.test(stripComments(readFileSync(file, "utf8"))))
      .map((file) => relative(mobileRoot, file));
    expect(offenders, `모바일이 지워진 주소를 연다: ${offenders.join(", ")}`).toEqual([]);

    // 그리고 문은 열려 있어야 한다. 앱에서 안내로 갈 길이 아예 없으면 그것대로 문제다.
    const entry = mobileSources
      .filter((file) => /\/wedding\/manners/.test(readFileSync(file, "utf8")));
    expect(entry.length, "앱에서 예절 안내로 가는 화면이 없다").toBeGreaterThan(0);
  });

  // 아모라는 이 안내를 **읽을 곳으로 가리키기만** 한다. 이관 후에도 출처 없는 표가
  // 남아 있어서(레거시 15편은 전부 unsourced), 근거로 인용하면 안 된다는 전제는 같다.
  it("아모라가 안내를 링크하되 근거로 인용하지는 않는다", () => {
    const prompt = source("src/lib/ai/prompts.ts");

    expect(prompt).toContain("[etiquette:번호]");
    expect(prompt).toContain("## 예절 가이드 링크");
    expect(prompt).toContain("'더 읽을 곳'이지 '근거'가 아닙니다");
    expect(prompt).toContain("금액·기간·법률 수치를 이 가이드에서 가져와 말하지 마세요");

    // 프롬프트가 코퍼스를 통째로 읽어들이지는 않는다 — 번호표만 쓴다.
    expect(prompt).not.toContain("etiquetteData");
    expect(prompt).not.toContain("MANNERS_PARTS");
  });

  // 코퍼스에 출처가 붙는 순간 이 계약문은 거짓이 된다.
  //
  // 2026-08-19 `#114`가 "이 가이드에는 출처 표기가 없습니다"라고 못 박았고, 그때는 참이었다.
  // 그 뒤 `8c6cc139`(2026-08-24)가 10편에 1차 자료 출처 70건을 붙였는데 **계약문은 그대로
  // 남았다.** 그래서 아모라는 사용자가 화면에서 출처를 보며 물어도 "그 숫자는 확인된 기준이
  // 아니다"라고 답하도록 지시받고 있었다 — 제품에서 가장 잘 검증된 자료를 제 입으로 부정한 것이다.
  //
  // 아모라가 본문을 못 보는 것은 설계다(바로 위 검사). 그러니 **숫자를 옮기지 말라는 규칙은
  // 그대로 옳고**, 틀린 것은 "출처가 없다"는 사실 주장 쪽이다. 그 한 줄만 못 박는다.
  it("출처가 붙은 편이 있으면 프롬프트가 '출처가 없다'고 말하지 않는다", () => {
    const sourced = MANNERS_PARTS.filter((part) => part.sources.length > 0);
    // 측정기 자가검증 — 코퍼스에서 출처를 못 읽으면 아래 검사가 조용히 통과한다.
    expect(sourced.length, "출처가 붙은 편을 하나도 못 찾았다 — 이 검사가 죽어 있다").toBeGreaterThan(0);

    const prompt = source("src/lib/ai/prompts.ts");
    expect(
      prompt,
      `1차 자료 출처가 ${sourced.length}편에 붙어 있는데 프롬프트가 "출처 표기가 없다"고 말한다`,
    ).not.toContain("이 가이드에는 출처 표기가 없습니다");

    // 그리고 사용자에게 그 숫자를 부정하라고 시키지 않는다.
    expect(
      prompt,
      "사용자가 화면에서 본 출처 있는 수치를 아모라가 '확인된 기준이 아니다'라고 단정한다",
    ).not.toContain("확인된 기준이 아니라고 말한 뒤");
  });

  it("프롬프트 번호표가 코퍼스와 맞는다", () => {
    const prompt = source("src/lib/ai/prompts.ts");
    const table = prompt.slice(prompt.indexOf("**번호표:**"));
    const promptNumbers = [...table.matchAll(/(\d+):/g)].map((match) => Number(match[1]));

    expect(promptNumbers.length).toBe(25);
    expect(promptNumbers.sort((a, b) => a - b)).toEqual(
      MANNERS_PARTS.map((part) => part.legacyNumber).sort((a, b) => a - b),
    );
  });

  // 사이트맵은 파트를 하나씩 싣는다. 이관의 목적이 여기다 — 주제마다 검색에 잡히는 것.
  it("파트마다 사이트맵에 개별 등재된다", () => {
    const sitemap = source("src/app/sitemap.ts");
    expect(sitemap).toContain("MANNERS_PARTS.map");
    expect(sitemap).toContain("/wedding/manners/${part.slug}");
    expect(sitemap).not.toContain("/etiquette");
  });
});
