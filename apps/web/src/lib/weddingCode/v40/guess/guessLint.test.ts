/**
 * 「서로 짐작하기」 세트 검사기 시험(빌드 계획 5.3). 검사기 라이브러리(scripts/lib/wedding-code-v41-guess-lint.mjs)와 명령줄을 돌린다.
 *
 * 어휘 문(new-word)은 이 시험을 빨갛게 만들지 않는다. 승인한 어휘 목록(세트 이름.vocab.json)을 얼리는 일은 글을 고친 사람이 아닌 사람이 하고, 그 전에는 새 낱말이
 * 경고로 보고만 된다(console.warn). 낱말·구조 규칙(어휘 문을 뺀 모든 규칙)의 위반은 그대로 빨갛다. 명령줄은 얼리기 전에 종료 코드 1 을 낸다(의도한 것이다).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import * as lintModule from "../../../../../../../scripts/lib/wedding-code-v41-guess-lint.mjs";

interface Violation {
  readonly rule: string;
  readonly path: string;
  readonly message: string;
  readonly text: string;
}
interface SelfTestResult {
  clean: Violation[];
  mutations: { name: string; rule: string; ok: boolean; got: string[] }[];
  blind: { name: string; stillBlind: boolean; got: string[] }[];
  planted: { doc: unknown; rules: string[]; caught: string[] };
  probes: { total: number; missed: string[]; leaves: number };
  falsePositives: { kind: string; text: string; hits: Violation[] }[];
}
interface LintApi {
  lintGuessSet(d: unknown, opts?: { vocab?: readonly string[] }): Violation[];
  lintFile(file: string, vocabPath?: string | null): { d: unknown; V: Violation[]; vocab: string[] | null };
  freezeVocab(d: unknown): string[];
  vocabPathFor(file: string, suffix?: string): string;
  runSelfTest(base: unknown, gate: { vocab: readonly string[] }): SelfTestResult;
  MUTATIONS: readonly unknown[];
  textRules(entry: { path: string; text: string; kind: string; role: string }, flag: (rule: string, path: string, message: string, text?: string) => void): void;
  copyMirrorRules(entry: { path: string; text: string; kind: string; role: string }, flag: (rule: string, path: string, message: string, text?: string) => void, escapeTexts?: Record<string, string>): void;
  collectTexts(d: unknown): { path: string; text: string; kind: string; role: string }[];
}
const lint = lintModule as unknown as LintApi;

const ROOT = join(__dirname, "../../../../../../..");
const SET_PATH = join(ROOT, "docs/wedding-code/2026-10-01_v41_guess_set.json");
const VOCAB_PATH = join(ROOT, "docs/wedding-code/2026-10-01_v41_guess_set.vocab.json");
const PLANTED_PATH = join(__dirname, "guessLintPlanted.json");
const CLI_PATH = join(ROOT, "scripts/wedding-code-v41-guess-lint.mjs");

const base = JSON.parse(readFileSync(SET_PATH, "utf8")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** 음성 대조는 글을 수천 번 다시 검사해서 몇 초가 걸린다. 한 번만 돌려 모든 시험이 나눠 쓴다. */
let selfTestMemo: SelfTestResult | null = null;
function selfTest(): SelfTestResult {
  selfTestMemo ??= lint.runSelfTest(base, { vocab: lint.freezeVocab(base) });
  return selfTestMemo;
}
const SLOW = { timeout: 120_000 } as const;
const md5 = (path: string) => createHash("md5").update(readFileSync(path)).digest("hex");
const rulesOf = (violations: readonly Violation[]) => [...new Set(violations.map((v) => v.rule))];

describe("원천 세트가 규칙을 지킨다", () => {
  it("어휘 문을 뺀 모든 낱말·구조 규칙의 위반이 0 이다", () => {
    const violations = lint.lintGuessSet(base);
    expect(violations.map((v) => `[${v.rule}] ${v.path}: ${v.message}`)).toEqual([]);
  });

  it("승인한 어휘 목록 파일이 세트 옆에 있고 형식이 맞다", () => {
    expect(lint.vocabPathFor(SET_PATH)).toBe(VOCAB_PATH);
    expect(basename(VOCAB_PATH)).toBe("2026-10-01_v41_guess_set.vocab.json");
    expect(existsSync(VOCAB_PATH)).toBe(true);
    const vocab = JSON.parse(readFileSync(VOCAB_PATH, "utf8")) as { schema: string; tokens: string[] };
    expect(vocab.schema).toBe("wedding-code-guess-vocab/1");
    expect(Array.isArray(vocab.tokens)).toBe(true);
    expect(vocab.tokens.length).toBeGreaterThan(100);
  });

  it("어휘 문: 얼리지 않은 새 낱말은 경고로 보고만 하고 빨갛게 만들지 않는다. 다른 규칙의 위반은 하나도 없다", () => {
    const { V, vocab } = lint.lintFile(SET_PATH);
    expect(vocab).not.toBeNull();
    const nonVocab = V.filter((v) => v.rule !== "new-word");
    expect(nonVocab.map((v) => `[${v.rule}] ${v.path}: ${v.message}`)).toEqual([]);
    expect(V.some((v) => v.rule === "vocab-missing")).toBe(false);
    const newWords = V.filter((v) => v.rule === "new-word");
    if (newWords.length > 0) {
      const words = new Set(newWords.map((v) => v.message.split(" ")[0] ?? v.message));
      console.warn(
        `[서로 짐작하기] 승인한 어휘 목록이 아직 새 낱말을 얼리지 않았다(new-word ${newWords.length}건). 글을 고친 사람이 아닌 사람이 읽고 ` +
          `node scripts/wedding-code-v41-guess-lint.mjs --new-words 표를 확인한 뒤 --freeze 를 돌려 목록을 커밋해야 한다(경고 ${words.size}종, 시험은 빨개지지 않는다).`,
      );
    }
    expect(Array.isArray(V)).toBe(true);
  });
});

describe("(a) 규칙 거울: 자리와 기기를 잡는다(계획 A8)", () => {
  const flagsFor = (key: string, text: string, kind = "intro", role = "sentence") => {
    const hits: string[] = [];
    const entry = { path: key, text, kind, role };
    lint.textRules(entry, (rule) => hits.push(rule));
    lint.copyMirrorRules(entry, (rule) => hits.push(rule), base.escapeTexts);
    return hits;
  };

  it("「자리」는 화면 글에서 잡히고 카드와 장면 글(act, cost, stem, caption)에서는 막지 않는다", () => {
    expect(flagsFor("intro", "나란히 놓는 자리가 있어요.")).toContain("pinned-word");
    expect(flagsFor("act", "한 자리에 앉아 골라요.", "act")).not.toContain("pinned-word");
    expect(flagsFor("stem", "한 자리에 앉아 정하는 중이에요. 비슷한 일이면 괜찮아요.", "stem")).not.toContain("pinned-word");
  });

  it("「기기」(공용 기기는 제외), 데이터, 안 맞아요(단추 이름 밖), 번호 라벨, 장면 이름꼴을 잡는다", () => {
    expect(flagsFor("note", "이 기기에는 남지 않아요.", "note")).toContain("pinned-word");
    expect(flagsFor("note", "공용 기기에서는 꺼 주세요.", "note")).not.toContain("pinned-word");
    expect(flagsFor("note", "데이터는 보내지 않아요.", "note")).toContain("pinned-word");
    expect(flagsFor("note", "안 맞는 장면은 넘겨요.", "note")).toContain("pinned-word");
    expect(flagsFor("escape", base.escapeTexts.notmine, "escape", "button")).not.toContain("pinned-word");
    expect(flagsFor("note", "첫 화면부터 시작해요.", "note")).toContain("order-label");
    expect(flagsFor("note", "주제 장면은 없어요.", "note")).toContain("scene-name");
  });

  it("한 묶음 안의 같은 문장은 잡는다", () => {
    const duplicated = JSON.parse(JSON.stringify(base)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    duplicated.emptyState = `${duplicated.emptyState} ${String(duplicated.skipNote).split(". ")[0]}.`;
    expect(rulesOf(lint.lintGuessSet(duplicated))).toContain("bundle-dup");
  });

  it("거울 규칙을 지우면 이 시험이 빨개지도록: 소개 글에 자리를 심은 사본은 pinned-word 로 잡힌다", () => {
    const planted = JSON.parse(JSON.stringify(base)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    planted.intro = String(planted.intro).replace("나란히 놓아요.", "나란히 놓는 자리가 있어요.");
    const hits = lint.lintGuessSet(planted).filter((v) => v.rule === "pinned-word");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].path).toBe("intro");
  });
});

describe("(b) 심은 위반 사본을 전부 잡는다", () => {
  const planted = JSON.parse(readFileSync(PLANTED_PATH, "utf8")) as unknown;
  const vocab = lint.freezeVocab(base);

  it("한 사본에 함께 심은 위반 여덟 개가 모두 잡힌다", () => {
    const hits = rulesOf(lint.lintGuessSet(planted, { vocab }));
    for (const rule of ["digit", "dash", "banned-word", "politeness", "evaluative-word", "causal-word", "ceremony-word", "fallback-missing"]) {
      expect(hits, rule).toContain(rule);
    }
  });

  it("심은 사본이 지금 검사기와 원천에서 다시 만든 것과 같다(낡지 않았다)", SLOW, () => {
    const result = selfTest();
    expect(JSON.parse(JSON.stringify(result.planted.doc))).toEqual(planted);
    expect(result.planted.rules).toHaveLength(8);
    expect(result.planted.caught).toEqual(result.planted.rules);
  });
});

describe("음성 대조 전체(명령줄 --selftest 와 같은 계산)", () => {
  it("원본 사본은 위반이 없다(후보 어휘로 어휘 문을 켜도)", SLOW, () => {
    expect(selfTest().clean).toEqual([]);
  });

  it("심은 위반 변형 전부가 기대한 규칙에서 잡힌다", SLOW, () => {
    const result = selfTest();
    expect(result.mutations.length).toBeGreaterThan(125);
    expect(result.mutations.filter((m) => !m.ok).map((m) => `${m.name} (기대 ${m.rule}, 나온 ${m.got.join(",")})`)).toEqual([]);
  });

  it("새 규칙마다 변형이 있다: 자리, 기기, 데이터, 안 맞, 번호 라벨, 장면 이름, 같은 문장, 세트 글자, 검토 상태, 받는 사람 소개, 줄 없는 장면", SLOW, () => {
    const result = selfTest();
    const rules = new Set(result.mutations.map((m) => m.rule));
    for (const rule of ["pinned-word", "order-label", "scene-name", "bundle-dup", "set-id", "review", "guess-honest", "count-claim"]) expect(rules.has(rule), rule).toBe(true);
    const names = result.mutations.map((m) => m.name).join("\n");
    for (const needle of ["소개 글에 자리", "받는 사람 소개 글에 기기", "소개 글에 데이터", "줄 없는 장면 한 줄", "받는 사람 소개 글", "질문만 보내기에도 들어간다고 읽히는 옛 문장"]) {
      expect(names, needle).toContain(needle);
    }
  });

  it("알려진 한계 둘은 여전히 못 잡는다(한계 문단이 참이다)", SLOW, () => {
    const result = selfTest();
    expect(result.blind).toHaveLength(2);
    expect(result.blind.every((b) => b.stillBlind)).toBe(true);
  });

  it("덮개 시험: 화면에 나가는 글자열마다 규칙 가족별 프로브가 모두 잡힌다", SLOW, () => {
    const result = selfTest();
    expect(result.probes.leaves).toBeGreaterThan(60);
    expect(result.probes.total).toBeGreaterThan(1400);
    expect(result.probes.missed).toEqual([]);
  });

  it("깨끗한 대조(함정 낱말이 든 멀쩡한 글)는 오탐이 없다", SLOW, () => {
    expect(selfTest().falsePositives.map((f) => `${f.kind}: ${f.text}`)).toEqual([]);
  });

  it("수량 말 규칙은 「짐작한 장면」의 한 을 수로 읽지 않고 「여기에」의 기에 를 원인 어미로 읽지 않는다(고친 두 오탐)", () => {
    expect(lint.lintGuessSet(base).filter((v) => v.rule === "count-claim" || v.rule === "causal-word")).toEqual([]);
    const planted = JSON.parse(JSON.stringify(base)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    planted.skipNote = `${planted.skipNote} 세 가지 장면이에요.`;
    expect(rulesOf(lint.lintGuessSet(planted))).toContain("count-claim");
    planted.skipNote = String(base.skipNote);
    planted.tail = "먹기에 좋은 이야기를 혼자 생각해 봐도, 둘이 이야기해 봐도 좋아요.";
    expect(rulesOf(lint.lintGuessSet(planted))).toContain("causal-word");
  });
});

describe("(c) 어휘 목록이 없으면 vocab-missing 이다", () => {
  it("세트 옆에 이름이 맞는 목록이 없으면 위반으로 알린다(문이 조용히 꺼지지 않는다)", () => {
    const dir = mkdtempSync(join(tmpdir(), "guess-lint-"));
    try {
      const file = join(dir, "set.json");
      writeFileSync(file, JSON.stringify(base));
      expect(lint.lintFile(file).V.some((v) => v.rule === "vocab-missing")).toBe(true);
      // 옛 이름(guess_set_vocab.json)의 목록은 찾지 않는다.
      copyFileSync(VOCAB_PATH, join(dir, "guess_set_vocab.json"));
      expect(lint.lintFile(file).V.some((v) => v.rule === "vocab-missing")).toBe(true);
      copyFileSync(VOCAB_PATH, join(dir, "set.vocab.json"));
      expect(lint.lintFile(file).V.some((v) => v.rule === "vocab-missing")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("명령줄", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf8", cwd: ROOT });

  it("기본 실행: 승인한 어휘가 새 낱말을 얼리기 전에는 종료 코드 1 이고 그 이유가 new-word 임을 말한다(얼린 뒤에는 0)", SLOW, () => {
    const result = run();
    const newWords = lint.lintFile(SET_PATH).V.filter((v) => v.rule === "new-word").length;
    expect(result.status).toBe(newWords > 0 ? 1 : 0);
    if (newWords > 0) {
      expect(result.stdout).toContain("종료 코드 1 은 의도한 것이다");
      expect(result.stdout).toContain("--freeze");
      expect(result.stdout).not.toMatch(/^\[(?!new-word)[a-z-]+\]/mu);
    }
  });

  it("--selftest 는 종료 코드 0 이다", SLOW, () => {
    const result = run("--selftest");
    expect(result.status, result.stdout.slice(-400)).toBe(0);
    expect(result.stdout).toContain("회귀 방지 음성 대조 통과");
  });

  it("--new-words 는 승인한 어휘에 없는 낱말을 문장째 낸다", SLOW, () => {
    const result = run("--new-words");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("승인한 어휘에 없는 낱말");
  });

  it("--candidate 와 --freeze 는 세트 옆에만 쓰고 저장소의 목록을 건드리지 않는다. 얼린 뒤에는 종료 코드 0 이다", SLOW, () => {
    const before = md5(VOCAB_PATH);
    const dir = mkdtempSync(join(tmpdir(), "guess-freeze-"));
    try {
      const file = join(dir, "set.json");
      writeFileSync(file, JSON.stringify(base));
      // 저장소의 목록이 이미 얼렸는지와 상관없이 얼리기 전 상태를 만든다: 승인한 낱말이 하나뿐인 목록이다.
      writeFileSync(join(dir, "set.vocab.json"), JSON.stringify({ schema: "wedding-code-guess-vocab/1", tokens: ["가"] }));
      const unfrozen = run(file);
      expect(unfrozen.status).toBe(1);
      expect(unfrozen.stdout).toContain("종료 코드 1 은 의도한 것이다");
      expect(unfrozen.stdout).toMatch(/\[new-word\]/u);
      const candidate = run("--candidate", file);
      expect(candidate.status).toBe(0);
      expect(existsSync(join(dir, "set.vocab.candidate.json"))).toBe(true);
      const frozenBefore = md5(join(dir, "set.vocab.json"));
      const freeze = run("--freeze", file);
      expect(freeze.status).toBe(0);
      expect(md5(join(dir, "set.vocab.json"))).not.toBe(frozenBefore);
      const after = run(file);
      expect(after.status, after.stdout.slice(-300)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(md5(VOCAB_PATH)).toBe(before);
  });

  it("--freeze 는 낱말 규칙 위반이 있으면 목록을 만들지 않고 종료 코드 1 이다", SLOW, () => {
    const dir = mkdtempSync(join(tmpdir(), "guess-freeze-bad-"));
    try {
      const bad = JSON.parse(JSON.stringify(base)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      bad.skipNote = `${bad.skipNote} 3번 해 봐요.`;
      const file = join(dir, "set.json");
      writeFileSync(file, JSON.stringify(bad));
      const result = run("--freeze", file);
      expect(result.status).toBe(1);
      expect(existsSync(join(dir, "set.vocab.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
