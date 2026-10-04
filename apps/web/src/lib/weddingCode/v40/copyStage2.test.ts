import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { V40_GUESS_COPY } from "./guess/guessCopy";
import { V40_LETTER_GUESS_COPY } from "./letterGuess/letterGuessCopy";
import { V40_COPY, V40_COPY_SCREENS } from "./copy";

/**
 * 웨딩코드 4.1 단계 2 의 새 문구(서로 짐작하기, 결과 전 글자 고르기)가 기존 문구 시험이 보지 못하는 곳까지 같은 규칙을 지키는지(빌드 계획 9절).
 *
 * copy.test.ts 의 「기기」 검사는 폴더 하나의 직접 파일만 훑어서(하위 폴더를 안 본다) 새 폴더 둘과 생성 상수를 보지 못한다. 기존 시험을 고치지 않고 이 파일이
 * 같은 TypeScript 파서 방식으로 재귀해서 본다. 새 번들 둘이 화면 묶음에 들어갈 때 같은 문장이 겹치지 않는지도 한 번 더 본다.
 * 시험 도구(*.stage2Kit.tsx)와 클라이언트 파일도 화면 글을 낼 수 있어 같이 훑는다.
 */

const SRC_ROOT = resolve(__dirname, "../../..");

/** 소스에서 사용자에게 보일 수 있는 글(문자열, 템플릿 문자열, JSX 글자)을 TypeScript 파서로 뽑는다. 주석은 트리에 없다. */
function sourceTexts(source: string, fileName = "inline.tsx"): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) out.push(node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) out.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** 폴더를 하위 폴더까지 훑어 시험이 아닌 .ts, .tsx 파일의 경로를 모은다. */
function walkSources(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...walkSources(full));
    else if (/\.(ts|tsx)$/u.test(name) && !/\.(test|spec)\./u.test(name) && !/\.d\.ts$/u.test(name)) files.push(full);
  }
  return files;
}

/** 화면 글에 「기기」가 든 문자열(공용 기기만 예외). 코드에서 찾는 눈과 같은 규칙이라 아래 시험이 눈이 멀지 않았는지 심은 글로 본다. */
function deviceWordHits(texts: readonly string[]): string[] {
  return texts.filter((text) => text.replaceAll("공용 기기", "").includes("기기"));
}

/** 새 문구가 들어 있는 소스: 새 폴더 둘(lib, components)을 하위까지, 생성한 세트 자료, 클라이언트의 단계 층과 시험 도구. */
function stage2Sources(): string[] {
  const files = [
    ...walkSources(join(SRC_ROOT, "lib/weddingCode/v40/guess")),
    ...walkSources(join(SRC_ROOT, "lib/weddingCode/v40/letterGuess")),
    ...walkSources(join(SRC_ROOT, "components/wedding-code/v40/guess")),
    ...walkSources(join(SRC_ROOT, "components/wedding-code/v40/letterGuess")),
    join(SRC_ROOT, "constants/weddingCodeV40Guess.ts"),
  ];
  for (const name of readdirSync(join(SRC_ROOT, "app/wedding-code")).sort()) {
    if (/^WeddingCodeV40Client\.stage2.*\.tsx?$/u.test(name) && !/\.(test|spec)\./u.test(name)) files.push(join(SRC_ROOT, "app/wedding-code", name));
  }
  return files;
}

interface Leaf {
  readonly path: string;
  readonly text: string;
  /** 낱말이나 짧은 제목이라 문장 중복 검사에서 빠지는가(키 이름이 label, title 등으로 끝나면 그 아래는 모두 라벨). */
  readonly label: boolean;
}

const LABEL_KEY = /(label|title|heading|button|name|tag|toggle|option|caption|list|badge|mark|column)s?$/i;

/** 문구 묶음의 모든 문자열 잎. copy.test.ts 와 같은 규칙으로 라벨 키 아래는 모두 라벨이다. */
function leavesOf(value: unknown, path: string, label = false): Leaf[] {
  if (typeof value === "string") return [{ path, text: value, label }];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => leavesOf(child, `${path}.${key}`, label || LABEL_KEY.test(key)));
}

/** 문장 하나씩(마침표, 물음표, 느낌표 뒤에서 나눈다). */
function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.?!])\s+/u).map((part) => part.trim()).filter((part) => part !== "");
}

describe("단계 2 문구: 「기기」는 어디에도 없다(저장소는 브라우저 하나다)", () => {
  it("새 폴더 둘과 생성 세트 자료, 단계 층의 문자열과 화면 글에 「이 기기」가 없다(공용 기기만 예외)", () => {
    const files = stage2Sources();
    // 하위 폴더까지 훑는다: 기존 시험의 도우미가 못 보던 파일들이 목록에 들어 있다.
    expect(files.some((file) => file.replaceAll("\\", "/").endsWith("lib/weddingCode/v40/guess/guessCopy.ts"))).toBe(true);
    expect(files.some((file) => file.replaceAll("\\", "/").endsWith("lib/weddingCode/v40/letterGuess/letterGuessCopy.ts"))).toBe(true);
    expect(files.some((file) => file.replaceAll("\\", "/").endsWith("components/wedding-code/v40/guess/CoupleGuessSection.tsx"))).toBe(true);
    expect(files.some((file) => file.replaceAll("\\", "/").endsWith("components/wedding-code/v40/letterGuess/LetterGuessScreen.tsx"))).toBe(true);
    expect(files.some((file) => file.replaceAll("\\", "/").endsWith("constants/weddingCodeV40Guess.ts"))).toBe(true);
    expect(files.some((file) => file.replaceAll("\\", "/").endsWith("app/wedding-code/WeddingCodeV40Client.stage2.tsx"))).toBe(true);
    expect(files.length).toBeGreaterThan(20);
    const hits: string[] = [];
    for (const file of files) {
      for (const text of deviceWordHits(sourceTexts(readFileSync(file, "utf8"), file))) hits.push(`${file.slice(SRC_ROOT.length)}: ${text.slice(0, 60)}`);
    }
    expect(hits).toEqual([]);
  });

  it("문자열을 실제로 뽑고 찾는다(뽑는 눈이 멀어서 초록불이 되지 않는다)", () => {
    const texts = sourceTexts(readFileSync(join(SRC_ROOT, "lib/weddingCode/v40/guess/guessCopy.ts"), "utf8"), "guessCopy.ts");
    expect(texts).toContain(V40_GUESS_COPY.entry.startButton);
    expect(texts).toContain(V40_GUESS_COPY.receiverNote);
    const letterTexts = sourceTexts(readFileSync(join(SRC_ROOT, "lib/weddingCode/v40/letterGuess/letterGuessCopy.ts"), "utf8"), "letterGuessCopy.ts");
    expect(letterTexts).toContain(V40_LETTER_GUESS_COPY.screen.continueButton);
    // 심은 글: 「이 기기」는 잡고, 「공용 기기」는 통과시키며, 주석은 트리에 없어서 잡지 않는다.
    expect(deviceWordHits(sourceTexts('const a = "이 기기에 저장돼요";'))).toEqual(["이 기기에 저장돼요"]);
    expect(deviceWordHits(sourceTexts("const a = `이 ${x} 기기`; const b = `기기 ${x}`;"))).toEqual([" 기기", "기기 "]);
    expect(deviceWordHits(sourceTexts('const a = "공용 기기에서는 저장을 꺼 주세요";'))).toEqual([]);
    expect(deviceWordHits(sourceTexts('// 이 기기\nconst a = "이 브라우저";'))).toEqual([]);
    expect(deviceWordHits(sourceTexts("<p>이 기기</p>"))).toEqual(["이 기기"]);
  });

  it("문구 묶음의 모든 잎에도 「이 기기」가 없다", () => {
    for (const leaf of [...leavesOf(V40_COPY.guess, "guess"), ...leavesOf(V40_COPY.letterGuess, "letterGuess")]) {
      expect(leaf.text.replaceAll("공용 기기", ""), leaf.path).not.toMatch(/기기/u);
    }
  });
});

describe("단계 2 문구: 저장 낱말과 단정형", () => {
  it("저장에 대한 말은 단정하지 않는다: 「닫으면 사라져요」 꼴이 두 묶음에 없다", () => {
    for (const leaf of [...leavesOf(V40_COPY.guess, "guess"), ...leavesOf(V40_COPY.letterGuess, "letterGuess")]) {
      expect(leaf.text, leaf.path).not.toMatch(/닫으면 사라/u);
    }
  });

  it("글자 고르기의 저장 안내 셋은 저장이 정말 되는 상태에서만 「남아요」라고 하고, 서로 짐작하기는 저장하지 않는다고 말한다", () => {
    const { storageOn, storageOff, storageBlocked } = V40_COPY.letterGuess.screen;
    expect(storageOn).toContain("이 브라우저에만 남아요");
    expect(storageOff).not.toMatch(/남아요/u);
    expect(storageBlocked).not.toMatch(/남아요/u);
    expect(storageOff).toContain("저장하지 않아요");
    expect(storageBlocked).toContain("저장하지 않아요");
    expect(V40_COPY.guess.entry.body).toContain("이 브라우저에는 저장하지 않아요");
  });

  it("진입 카드가 부르는 단추 이름은 보내기 블록의 실제 이름과 글자까지 같다", () => {
    expect(V40_COPY.guess.entry.body).toContain(`「${V40_COPY.send.withAnswersOption}」`);
    expect(V40_COPY.guess.entry.doneNote).toContain(`「${V40_COPY.send.withAnswersOption}」`);
    expect(V40_COPY.guess.entry.doneNote).toContain(`「${V40_COPY.send.questionsOnlyOption}」`);
  });

  it("다시 하기와 저장 지우기 확인 창이 먼저 고른 글자도 함께 지워진다고 말하고, 두 문장은 서로 다르다", () => {
    const restart = sentencesOf(V40_COPY.manage.restart.confirmBody).filter((sentence) => sentence.includes("결과를 보기 전에 고른 글자"));
    const clear = sentencesOf(V40_COPY.manage.clear.confirmBody).filter((sentence) => sentence.includes("결과를 보기 전에 고른 글자"));
    expect(restart).toHaveLength(1);
    expect(clear).toHaveLength(1);
    expect(restart[0]).toMatch(/함께 지워져요\.$/u);
    expect(clear[0]).toMatch(/함께 지워져요\.$/u);
    expect(restart[0]).not.toBe(clear[0]);
    // 같은 결과 화면 묶음에 있으므로 한 문장이 두 번 나오지 않아야 한다(기존 문장은 그대로다).
    expect(V40_COPY.manage.restart.confirmBody).toContain("지난번과 비교하는 데 쓰는 결과 글자와 그 세기는 그대로 남아요.");
    expect(V40_COPY.manage.clear.confirmBody).toContain("저장된 답과 지난번 비교용 기록이 지워져요.");
  });
});

describe("단계 2 문구: 화면 묶음", () => {
  it("새 번들 둘은 트랙의 문구 파일이 낸 그대로이고, 매핑된 화면은 계획대로다", () => {
    expect(V40_COPY.guess).toBe(V40_GUESS_COPY);
    expect(V40_COPY.letterGuess).toBe(V40_LETTER_GUESS_COPY);
    expect(V40_COPY_SCREENS.letterGuess).toEqual(["letterGuess", "common", "a11y"]);
    expect(V40_COPY_SCREENS.pairGuess).toEqual(["guess", "common", "a11y"]);
    for (const screen of ["receive", "result", "couple"] as const) expect(V40_COPY_SCREENS[screen]).toContain("guess");
    for (const screen of ["result", "couple"] as const) expect(V40_COPY_SCREENS[screen]).toContain("letterGuess");
    // 질문, 쉬는 카드, 마지막 정리, 시작 화면에는 새 문구가 없다.
    for (const screen of ["intro", "question", "rest", "wrapUp"] as const) {
      expect(V40_COPY_SCREENS[screen] as readonly string[], screen).not.toContain("guess");
      expect(V40_COPY_SCREENS[screen] as readonly string[], screen).not.toContain("letterGuess");
    }
  });

  it("새 번들 둘의 문장이 매핑된 어느 화면 묶음에서도 다른 묶음의 문장과 겹치지 않는다(같은 주의를 두 번 읽히지 않는다)", () => {
    const screens = Object.keys(V40_COPY_SCREENS) as (keyof typeof V40_COPY_SCREENS)[];
    // 낱말이나 제목(키가 끝나는 말)과 서로 바꿔 쓰는 줄은 문장이 아니라서 센다고 하지 않는다(copy.test.ts 와 같은 예외다).
    const alternatives = /^(question\.escapeChosen|send\.message(WithAnswers|QuestionsOnly)$)/u;
    let checked = 0;
    for (const screen of screens) {
      const groups = V40_COPY_SCREENS[screen] as readonly (keyof typeof V40_COPY)[];
      if (!groups.includes("guess") && !groups.includes("letterGuess")) continue;
      const seen = new Map<string, string>();
      for (const group of groups) {
        for (const leaf of leavesOf(V40_COPY[group], group)) {
          if (leaf.label || alternatives.test(leaf.path)) continue;
          for (const sentence of sentencesOf(leaf.text)) {
            const earlier = seen.get(sentence);
            expect(earlier, `${screen}: ${leaf.path} 의 「${sentence}」가 ${earlier} 에도 있다`).toBeUndefined();
            seen.set(sentence, leaf.path);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("심은 중복은 이 검사가 실제로 본다(같은 문장이 두 묶음에 있으면 겹친다고 센다)", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const [group, text] of [["guess.a", "고른 글자는 이 브라우저에만 남아요."], ["letterGuess.b", "먼저 고른 글자는 보이지 않아요. 고른 글자는 이 브라우저에만 남아요."]] as const) {
      for (const sentence of sentencesOf(text)) {
        if (seen.has(sentence)) duplicates.push(sentence);
        seen.set(sentence, group);
      }
    }
    expect(duplicates).toEqual(["고른 글자는 이 브라우저에만 남아요."]);
  });
});
