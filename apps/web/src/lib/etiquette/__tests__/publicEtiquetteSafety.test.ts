import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../testing/sourceText";

// 가족 조율 페이지는 2026-07-26에 제거했고, 2026-07-17에는 예절 코퍼스 25파트와
// 그 렌더러를 지웠다. 2026-08-19 파운더 결정으로 **코퍼스·렌더러·라우트를 전부
// 되살렸다.** 그래서 이 파일이 지키는 경계가 바뀌었다.
//
// 지금도 지키는 것:
//   - 아모라 프롬프트에 `[etiquette:번호]` 배선을 다시 넣지 않는다. 이 코퍼스는
//     출처가 없어서(금액 61건 중 출처 1건) AI가 근거로 인용하면 안 된다. 사람이
//     읽는 화면과 AI가 사실로 파는 것은 다른 문제다.
//   - 모바일에서 웹뷰로 `/etiquette`를 열지 않는다. 예전에 그렇게 열다가 라우트가
//     지워진 뒤 404를 계속 띄웠다. 되살아난 지금도 링크는 사람이 의도해서 다시
//     넣어야 한다.
//   - 렌더러가 참고 표를 체크박스 할 일로 바꾸지 않는다(아래 회귀 테스트).
//
// 남은 콘텐츠 위험(성별 고정 서술 24건, 무출처 금액 61건)은 이 가드가 막지 않는다.
// 그건 코퍼스를 고쳐야 하는 일이고, 테스트로 대신할 수 없다.
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

describe("restored etiquette guide", () => {
  it("serves the route again", () => {
    expect(existsSync(resolve(webRoot, "src/app/(community)/etiquette/page.tsx"))).toBe(true);
    expect(existsSync(resolve(webRoot, "src/app/(community)/etiquette/layout.tsx"))).toBe(true);
    expect(existsSync(resolve(webRoot, "src/components/app/etiquette/EtiquetteClient.tsx"))).toBe(true);
    expect(existsSync(resolve(webRoot, "src/components/app/etiquette/EtiquetteSeoContent.tsx"))).toBe(true);
  });

  // 모바일은 예전에 `https://hanbang.ai/etiquette`를 웹뷰로 열다가 라우트가 지워진 뒤
  // 404를 계속 띄웠다. 라우트가 돌아왔다고 링크가 저절로 맞아지는 게 아니다 —
  // 정본 경로(`/wedding/etiquette`)로 사람이 의도해서 다시 넣어야 한다.
  it("leaves no mobile entry pointing at the web route", () => {
    const mobileRoot = resolve(webRoot, "..", "mobile");
    const offenders = [
      ...sourceFiles(resolve(mobileRoot, "app")),
      ...sourceFiles(resolve(mobileRoot, "src")),
    ]
      .filter((file) => !file.includes("__tests__"))
      // 주석은 대상이 아니다 — 왜 지웠는지 설명을 남길 수 있어야 한다.
      .filter((file) => /etiquette/i.test(stripComments(readFileSync(file, "utf8"))))
      .map((file) => relative(mobileRoot, file));

    expect(
      offenders,
      `모바일에 지워진 예절 라우트 참조가 남았다: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps the corpus restored in full", () => {
    const corpus = source("src/constants/etiquetteData.ts");
    expect((corpus.match(/^ {4}number: \d+,$/gm) ?? []).length).toBe(25);
  });

  // 2026-08-19 파운더 결정으로 아모라 배선을 열었다. 다만 이 코퍼스는 금액 61건 중
  // 출처가 1건뿐이라, 아모라가 **읽을 곳으로 안내하는 것**과 **근거로 인용하는 것**은
  // 계속 구분해야 한다. 프롬프트가 그 구분을 잃으면 무출처 수치가 사실로 나간다.
  it("lets Amora link the guide but never cite it as a source", () => {
    const prompt = source("src/lib/ai/prompts.ts");

    // 배선은 열려 있다.
    expect(prompt).toContain("[etiquette:번호]");
    expect(prompt).toContain("## 예절 가이드 링크");

    // 그리고 그 태그가 근거가 아니라는 것을 프롬프트가 직접 말한다.
    expect(prompt).toContain("'더 읽을 곳'이지 '근거'가 아닙니다");
    expect(prompt).toContain("금액·기간·법률 수치를 이 가이드에서 가져와 말하지 마세요");

    // 프롬프트가 코퍼스를 통째로 읽어들이지는 않는다 — 번호표만 쓴다.
    expect(prompt).not.toContain("etiquetteData");
    expect(prompt).not.toContain("ETIQUETTE_PARTS");
  });

  // 태그가 가리키는 번호는 실제 파트여야 한다. 프롬프트의 번호표와 코퍼스가 어긋나면
  // 아모라가 존재하지 않는 챕터를 권하고 화면은 카드를 못 그린다.
  it("keeps the prompt part index in sync with the corpus", () => {
    const prompt = source("src/lib/ai/prompts.ts");
    const table = prompt.slice(prompt.indexOf("**번호표:**"));
    const promptNumbers = [...table.matchAll(/(\d+):/g)].map((match) => Number(match[1]));
    const corpusNumbers = [
      ...source("src/constants/etiquetteData.ts").matchAll(/^ {4}number: (\d+),$/gm),
    ].map((match) => Number(match[1]));

    expect(promptNumbers.length).toBe(25);
    expect(promptNumbers.sort((a, b) => a - b)).toEqual(corpusNumbers.sort((a, b) => a - b));
  });

  // 2026-08-19 회귀 가드. 파서가 제목에 "가이드·분담·기준"이 들어가면 무조건 checklist를
  // 줬고, 그래서 "관계별 축의금 금액 가이드"와 "전통적 분담 기준"이 체크박스 달린 할 일로
  // 렌더됐다. 참고 수치를 실행 지시로 승격시키는 사고라 다시 나면 안 된다.
  it("never renders reference tables as actionable checklists", () => {
    const renderer = source("src/components/app/etiquette/EtiquetteClient.tsx");
    const branch = renderer.match(
      /rawTitle\.includes\("기본"\)[\s\S]*?\n\s*type = "(\w+)";/,
    );
    expect(branch?.[1]).toBe("reference");
    // 참고 블록에는 체크·메모·일정 버튼이 붙지 않는다.
    expect(renderer).toContain('blockType === "reference"');
    expect(renderer).not.toMatch(/canUseActions =[^;]*"reference"/);
  });

  // 파서가 `|`를 몰라서 Part 25 비용표 11줄이 파이프 문자 그대로 노출됐다.
  it("renders markdown tables as tables", () => {
    const renderer = source("src/components/app/etiquette/EtiquetteClient.tsx");
    expect(renderer).toContain('type: "table-row"');
    expect(renderer).toContain("function TableRenderer");
  });
});
