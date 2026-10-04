/**
 * 「서로 짐작하기」 세트 자료 시험(빌드 계획 5.2, 4.11). 원천(docs/wedding-code/2026-10-01_v41_guess_set.json)과 생성 파일(constants/weddingCodeV40Guess.ts)이
 * 같은 내용인지, 허용한 필드만 나갔는지, 세트 글자가 문장과 함께 움직이는지를 본다. 개발 메모가 모든 사용자의 번들로 나가는 일을 막는 것이 이 파일의 핵심이다.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { V40_ESCAPES } from "@/constants/weddingCodeV40";
import {
  V40_GUESS_CONTENT_SHA256,
  V40_GUESS_IS_PLACEHOLDER,
  V40_GUESS_MEANING_SHA256,
  V40_GUESS_REVIEW,
  V40_GUESS_SET,
  V40_GUESS_SET_ID,
  V40_GUESS_TEXT,
} from "@/constants/weddingCodeV40Guess";
import * as builderModule from "../../../../../../../scripts/build-wedding-code-v41-guess.mjs";
import { V40_GUESS_SET_IDS } from "./guessLink";
import { V40_GUESS_SLOT_COUNT } from "./types";

interface BuilderApi {
  pickExport(data: unknown): { setId: string; text: unknown; items: unknown; review: unknown };
  exportHashes(parts: { text: unknown; items: unknown }): { content: string; meaning: string };
  generateGuessModule(data: unknown, options?: { sourceLabel?: string }): string;
}
const builder = builderModule as unknown as BuilderApi;

const ROOT = join(__dirname, "../../../../../../..");
const SOURCE_PATH = join(ROOT, "docs/wedding-code/2026-10-01_v41_guess_set.json");
const GENERATED_PATH = join(ROOT, "apps/web/src/constants/weddingCodeV40Guess.ts");
const BUILDER_PATH = join(ROOT, "scripts/build-wedding-code-v41-guess.mjs");

const source = JSON.parse(readFileSync(SOURCE_PATH, "utf8")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const generatedText = readFileSync(GENERATED_PATH, "utf8");

const sha256 = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * 링크의 고름과 짐작이 무엇을 가리키는지(두 물음, 짐작 안내, 탈출구 이름, 장면 여섯)의 해시를 세트 글자별로 고정하는 표.
 * 이 표의 줄을 바꾸는 것은 허용한다. 단 같은 글자 아래 내용이 바뀌면 이미 나간 링크의 첫째 카드가 다른 문장을 가리키는 조용한 오독이 난다.
 * 그래서 이 시험이 빨개지면 줄을 고치지 말고 새 세트 글자(원본의 setId, types.ts 의 GuessSetId, guessLink.ts 의 V40_GUESS_SET_IDS)를 올리고 새 줄을 더한다.
 * 이 세트는 아직 어두운 진입 뒤에서만 열려 나간 링크가 없으므로, 나가기 전의 고침은 같은 글자에서 표를 다시 맞춰도 된다(출시 뒤에는 그렇지 않다).
 */
const PINNED_MEANING_SHA256: Readonly<Record<string, string>> = {
  // 2026-10-04 문항 점검(장면 여덟 줄 고침)으로 같은 글자 "1" 에서 표를 다시 맞췄다. 이 세트로 나간 링크가 없다(파운더 밖으로 나간 적 없음).
  "1": "2b3b86dc016683d32f2b20fae78a381c40f75cc6739308e501ee4a32ee42432e",
};

function keysOf(value: unknown, prefix = "", out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((entry) => keysOf(entry, `${prefix}[]`, out));
  else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      out.push(prefix === "" ? key : `${prefix}.${key}`);
      keysOf(entry, prefix === "" ? key : `${prefix}.${key}`, out);
    }
  }
  return out;
}

describe("생성 파일이 원천과 같다", () => {
  it("원천에서 다시 만든 본문이 디스크의 생성 파일과 글자까지 같다(생성기를 거치지 않고 손으로 고치면 빨개진다)", () => {
    const regenerated = builder.generateGuessModule(source, { sourceLabel: "docs/wedding-code/2026-10-01_v41_guess_set.json" });
    expect(generatedText).toBe(regenerated);
  });

  it("내보낸 내용 전체의 해시를 이 파일이 따로 계산한 것과 같다", () => {
    expect(sha256({ text: V40_GUESS_TEXT, items: V40_GUESS_SET })).toBe(V40_GUESS_CONTENT_SHA256);
    const meaning = sha256({
      prompts: V40_GUESS_TEXT.prompts,
      guessNote: V40_GUESS_TEXT.guessNote,
      escapeTexts: V40_GUESS_TEXT.escapeTexts,
      items: V40_GUESS_SET,
    });
    expect(meaning).toBe(V40_GUESS_MEANING_SHA256);
    expect(builder.exportHashes({ text: V40_GUESS_TEXT, items: V40_GUESS_SET })).toEqual({ content: V40_GUESS_CONTENT_SHA256, meaning: V40_GUESS_MEANING_SHA256 });
  });

  it("원천의 장면과 문구가 생성 상수에 그대로 들어 있다", () => {
    expect(V40_GUESS_SET.map((item) => item.id)).toEqual(source.items.map((item: { id: string }) => item.id));
    source.items.forEach((item: { caption: string; stem: string; cards: { act: string; cost: string }[] }, index: number) => {
      expect(V40_GUESS_SET[index].caption).toBe(item.caption);
      expect(V40_GUESS_SET[index].stem).toBe(item.stem);
      expect(V40_GUESS_SET[index].cards.map((card) => card.act)).toEqual(item.cards.map((card) => card.act));
      expect(V40_GUESS_SET[index].cards.map((card) => card.cost)).toEqual(item.cards.map((card) => card.cost));
    });
    for (const key of ["title", "intro", "receiverIntro", "skipNote", "guessNote", "unlistedNote", "tail", "emptyState"] as const) {
      expect(V40_GUESS_TEXT[key], key).toBe(source[key]);
    }
    expect(V40_GUESS_TEXT.prompts).toEqual(source.prompts);
    expect(V40_GUESS_TEXT.escapeTexts).toEqual(source.escapeTexts);
    expect(V40_GUESS_TEXT.resultBlock.sub).toBe(source.resultBlock.sub);
    expect(V40_GUESS_TEXT.linkNotices).toEqual({ sendOwn: source.linkNotices.sendOwn, sendCouple: source.linkNotices.sendCouple });
  });
});

describe("허용한 필드만 나간다", () => {
  const FORBIDDEN_KEYS = ["dev", "status", "rules", "topic", "lookSide", "lookSideNote", "whyItDiffers", "costKinds", "fit", "area", "topicLabel", "sides", "receive", "placeholder"];

  it("생성 파일의 객체에는 개발 메모 키와 카드 id 와 받는 화면 문구가 없다", () => {
    const keys = keysOf({ V40_GUESS_SET, V40_GUESS_TEXT });
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.filter((key) => key.split(".").pop() === forbidden), forbidden).toEqual([]);
    }
    // 카드 id(a, b)는 저장 기준 순서의 이름표일 뿐 내보내지 않는다.
    for (const item of V40_GUESS_SET) {
      for (const card of item.cards) expect(Object.keys(card).sort()).toEqual(["act", "cost"]);
    }
  });

  it("생성 파일 본문에도 그 키와 값이 글자로 없다(소스 가드 규칙 1 이 막는 한 글자 대문자 값 포함)", () => {
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(generatedText, forbidden).not.toMatch(new RegExp(`(^|[\\s{,"])${forbidden}"?\\s*:`, "u"));
    }
    expect(generatedText).not.toMatch(/"[A-Z]"/u);
    expect(generatedText).not.toContain("묻지 않고 고르는 쪽이 정성스러워");
    for (const marker of [source.rules.cardText, source.items[0].dev.whyItDiffers, source.items[0].dev.lookSideNote, source.linkNotices.receive, source.status]) {
      expect(generatedText.includes(marker), marker.slice(0, 20)).toBe(false);
    }
  });

  it("허용한 필드 목록과 순서가 정확히 이것이다", () => {
    expect(Object.keys(V40_GUESS_TEXT)).toEqual([
      "title", "intro", "receiverIntro", "skipNote", "prompts", "guessNote", "escapeTexts", "resultBlock", "unlistedNote", "tail", "emptyState", "linkNotices",
    ]);
    expect(Object.keys(V40_GUESS_TEXT.prompts)).toEqual(["self", "guess"]);
    expect(Object.keys(V40_GUESS_TEXT.escapeTexts)).toEqual(["notmine", "skip", "unsure"]);
    expect(Object.keys(V40_GUESS_TEXT.resultBlock)).toEqual(["sub", "rows"]);
    expect(Object.keys(V40_GUESS_TEXT.resultBlock.rows)).toEqual(["meGuessedPartner", "partnerGuessedMe", "firstGuessedSecond", "secondGuessedFirst"]);
    for (const row of Object.values(V40_GUESS_TEXT.resultBlock.rows)) expect(Object.keys(row)).toEqual(["subhead", "actualLabel", "guessLabel"]);
    expect(Object.keys(V40_GUESS_TEXT.linkNotices)).toEqual(["sendOwn", "sendCouple"]);
    for (const item of V40_GUESS_SET) {
      expect(Object.keys(item)).toEqual(["id", "caption", "stem", "cards", "escapes"]);
      expect(Object.keys(item.escapes)).toEqual(["self", "guess"]);
    }
    expect(Object.keys(V40_GUESS_REVIEW)).toEqual(["humanReviewed", "unreviewedItemIds"]);
  });

  it("생성기가 개발 메모를 내보내게 되면 빨개진다: 표지를 심은 원천으로 만든 본문에는 표지가 없다", () => {
    const planted = JSON.parse(JSON.stringify(source)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const MARK = "ZZ표지ZZ";
    planted.status = `${MARK} 상태`;
    planted.rules = { cardText: MARK, extra: MARK };
    planted.linkNotices.receive = `${MARK} 받는 화면`;
    planted.review.note = `${MARK} 검토`;
    planted.extraTop = MARK;
    for (const item of planted.items) {
      item.topic = MARK;
      item.dev = { lookSide: MARK, whyItDiffers: MARK };
      item.extra = MARK;
      for (const card of item.cards) {
        card.id = MARK;
        card.extra = MARK;
      }
    }
    planted.resultBlock.rows.meGuessedPartner.extra = MARK;
    const text = builder.generateGuessModule(planted);
    expect(text).not.toContain(MARK);
    expect(text).not.toContain("ZZ");
  });
});

describe("구조와 세트 글자", () => {
  it("장면은 여섯이고 장면 수 상수와 같으며 카드는 둘씩, 탈출구는 내 답 둘 짐작 하나다", () => {
    expect(V40_GUESS_SET).toHaveLength(6);
    expect(V40_GUESS_SET.length).toBe(V40_GUESS_SLOT_COUNT);
    for (const item of V40_GUESS_SET) {
      expect(item.cards).toHaveLength(2);
      expect(item.escapes).toEqual({ self: ["notmine", "skip"], guess: ["unsure"] });
    }
    expect(new Set(V40_GUESS_SET.map((item) => item.id)).size).toBe(6);
    expect(new Set(V40_GUESS_SET.map((item) => item.caption)).size).toBe(6);
  });

  it("탈출구 이름 셋은 질문 화면의 이름과 같고 건너뛰기는 지금은 넘어갈게요다", () => {
    expect(V40_GUESS_TEXT.escapeTexts.notmine).toBe(V40_ESCAPES.notApplicable);
    expect(V40_GUESS_TEXT.escapeTexts.unsure).toBe(V40_ESCAPES.unsure);
    expect(V40_GUESS_TEXT.escapeTexts.skip).toBe("지금은 넘어갈게요");
  });

  it("렌더 줄 길이: 카드 한 일과 값과 두 문장 합이 검사기 한도 안이다", () => {
    for (const item of V40_GUESS_SET) {
      for (const card of item.cards) {
        expect([...card.act].length, item.id).toBeLessThanOrEqual(34);
        expect([...card.cost].length, item.id).toBeLessThanOrEqual(36);
        expect([...card.act].length + 1 + [...card.cost].length, item.id).toBeLessThanOrEqual(72);
      }
    }
  });

  it("세트 글자: 생성 파일, 원천, 링크 코덱의 지원 목록이 한 글자로 같고 옛 글자를 남기지 않는다", () => {
    expect(source.setId).toBe(V40_GUESS_SET_ID);
    expect(V40_GUESS_SET_IDS).toEqual([V40_GUESS_SET_ID]);
    expect(Object.keys(PINNED_MEANING_SHA256)).toEqual([...V40_GUESS_SET_IDS]);
  });

  it("뜻 해시가 세트 글자별 표와 같다: 장면 문장이나 두 물음이 바뀌면 세트 글자를 올려야 한다", () => {
    expect(V40_GUESS_MEANING_SHA256).toBe(PINNED_MEANING_SHA256[V40_GUESS_SET_ID]);
  });

  it("자리표시 문구가 아니다(출시용 생성이 막는 값)", () => {
    expect(V40_GUESS_IS_PLACEHOLDER).toBe(false);
    const text = builder.generateGuessModule({ ...source, placeholder: true });
    expect(text).toContain("V40_GUESS_IS_PLACEHOLDER: boolean = true;");
  });
});

describe("검토 상태(사람이 읽은 장면이 없다)", () => {
  it("검토를 받지 않은 장면 넷이 데이터에 남아 있고 사람이 읽었다고 하지 않는다", () => {
    expect(V40_GUESS_REVIEW.humanReviewed).toBe(false);
    expect(V40_GUESS_REVIEW.unreviewedItemIds).toHaveLength(4);
    const ids = V40_GUESS_SET.map((item) => item.id);
    for (const id of V40_GUESS_REVIEW.unreviewedItemIds) expect(ids).toContain(id);
    expect(new Set(V40_GUESS_REVIEW.unreviewedItemIds).size).toBe(4);
    expect(V40_GUESS_REVIEW).toEqual({ humanReviewed: source.review.humanReviewed, unreviewedItemIds: source.review.unreviewedItemIds });
  });
});

describe("생성기 명령줄", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [BUILDER_PATH, ...args], { encoding: "utf8", cwd: ROOT });

  it("--check 는 생성 파일이 원천과 같으면 종료 코드 0 이다", { timeout: 60_000 }, () => {
    const result = run("--check");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("생성 파일이 원본과 같다");
  });

  it("규칙 위반이 있는 원천으로는 아무것도 쓰지 않고 종료 코드 1 이다", { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "guess-build-"));
    try {
      const bad = JSON.parse(JSON.stringify(source)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      bad.skipNote = `${bad.skipNote} 3번 해 봐요.`;
      const sourceFile = join(dir, "bad.json");
      const outFile = join(dir, "out.ts");
      writeFileSync(sourceFile, JSON.stringify(bad));
      const result = run("--source", sourceFile, "--out", outFile);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("digit");
      expect(existsSync(outFile)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--check 는 생성 파일이 원천과 다르면 종료 코드 1 이다", { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "guess-build-"));
    try {
      const outFile = join(dir, "out.ts");
      writeFileSync(outFile, "// 손으로 고친 파일\n");
      const result = run("--check", "--out", outFile);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("생성 파일이 원본과 다르다");
      expect(readFileSync(outFile, "utf8")).toBe("// 손으로 고친 파일\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--final 은 사람이 읽지 않은 장면이 남아 있으면 실패한다(출시용 생성이 미검증 세트를 내보내지 않는다)", { timeout: 60_000 }, () => {
    const result = run("--final", "--out", join(tmpdir(), "never-written-guess.ts"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--final");
    expect(result.stderr).toContain("review");
  });
});
