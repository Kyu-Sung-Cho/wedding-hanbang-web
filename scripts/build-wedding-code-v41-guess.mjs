#!/usr/bin/env node
/**
 * 웨딩코드 4.1 단계 2 「서로 짐작하기」 세트 생성기.
 *
 *   node scripts/build-wedding-code-v41-guess.mjs [--source <json>] [--out <ts>] [--final] [--check]
 *
 * 원천 docs/wedding-code/2026-10-01_v41_guess_set.json 을 검사기(scripts/lib/wedding-code-v41-guess-lint.mjs)의 규칙에 통과시키고,
 * 통과하면 apps/web/src/constants/weddingCodeV40Guess.ts 를 만든다. 규칙 위반이 있으면 아무것도 쓰지 않고 1 로 끝난다.
 *
 * 허용 필드 목록으로만 내보낸다(빌드 계획 5.2). 원천 파일을 통째로 옮기면 개발 메모(dev, rules, status, 장면의 topic, 카드의 id,
 * linkNotices.receive)가 모든 사용자의 번들로 나간다. 내보내는 것: 맨 위의 title, intro, receiverIntro, skipNote, prompts, guessNote, escapeTexts,
 * resultBlock, unlistedNote, tail, emptyState 와 linkNotices.sendOwn, linkNotices.sendCouple, 장면의 id, caption, stem, cards[].act, cards[].cost, escapes.
 * 개발 메모가 아닌 검토 상태(review)는 V40_GUESS_REVIEW 로 따로 나간다(사람이 읽은 장면이 없다는 사실을 화면과 문서가 말할 수 있게).
 *
 * 어휘 문(new-word)과 --final
 *   기본 생성은 낱말 규칙만 본다. 승인한 어휘 목록(.vocab.json)이 아직 새 낱말을 얼리지 않았으면 그 수를 경고로 찍고 생성은 계속한다(얼리는 일은 사람이 한다).
 *   --final(출시용 생성)은 placeholder 가 있거나, 어휘 목록이 얼리지 않았거나, 사람이 읽지 않은 장면(review)이 남아 있으면 실패한다.
 * --check 는 파일을 쓰지 않고 생성 파일이 원천에서 만든 내용과 같은지만 본다(다르면 1).
 *
 * 세트 글자(setId)와 두 해시: 생성 파일의 V40_GUESS_CONTENT_SHA256 은 내보낸 내용 전체의 해시, V40_GUESS_MEANING_SHA256 은 링크의 고름과 짐작이
 * 무엇을 가리키는지를 정하는 부분(두 물음과 안내, 탈출구 이름, 장면 여섯)의 해시다. 뜻 해시가 바뀌면 세트 글자를 올린다(guessData.test.ts 의 표).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lintGuessSet, report, vocabPathFor } from "./lib/wedding-code-v41-guess-lint.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
export const DEFAULT_SOURCE_PATH = join(ROOT, "docs", "wedding-code", "2026-10-01_v41_guess_set.json");
export const DEFAULT_OUT_PATH = join(ROOT, "apps", "web", "src", "constants", "weddingCodeV40Guess.ts");

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** 값을 타입스크립트 리터럴로. 한 줄 리프 객체와 원시 배열은 한 줄에 둔다. */
function literal(value, depth) {
  const pad = "  ".repeat(depth);
  const pad1 = "  ".repeat(depth + 1);
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.every((x) => x === null || typeof x !== "object")) return `[${value.map((x) => literal(x, depth)).join(", ")}]`;
    return `[\n${value.map((x) => `${pad1}${literal(x, depth + 1)},`).join("\n")}\n${pad}]`;
  }
  const entries = Object.entries(value);
  const key = (k) => (IDENT.test(k) ? k : JSON.stringify(k));
  const leaf = entries.every(([, x]) => x === null || typeof x !== "object");
  if (leaf) return `{ ${entries.map(([k, x]) => `${key(k)}: ${literal(x, depth)}`).join(", ")} }`;
  return `{\n${entries.map(([k, x]) => `${pad1}${key(k)}: ${literal(x, depth + 1)},`).join("\n")}\n${pad}}`;
}

const ROW_FORMS = ["meGuessedPartner", "partnerGuessedMe", "firstGuessedSecond", "secondGuessedFirst"];

/** 허용 필드만 정해진 순서로 골라 낸다(순수 함수. 시험이 같은 순서를 따로 구현해 대조한다). */
export function pickExport(data) {
  const items = data.items.map((it) => ({
    id: it.id,
    caption: it.caption,
    stem: it.stem,
    cards: it.cards.map((c) => ({ act: c.act, cost: c.cost })),
    escapes: { self: [...it.escapes.self], guess: [...it.escapes.guess] },
  }));
  const rows = {};
  for (const form of ROW_FORMS) {
    const r = data.resultBlock.rows[form];
    rows[form] = { subhead: r.subhead, actualLabel: r.actualLabel, guessLabel: r.guessLabel };
  }
  const text = {
    title: data.title,
    intro: data.intro,
    receiverIntro: data.receiverIntro,
    skipNote: data.skipNote,
    prompts: { self: data.prompts.self, guess: data.prompts.guess },
    guessNote: data.guessNote,
    escapeTexts: { notmine: data.escapeTexts.notmine, skip: data.escapeTexts.skip, unsure: data.escapeTexts.unsure },
    resultBlock: { sub: data.resultBlock.sub, rows },
    unlistedNote: data.unlistedNote,
    tail: data.tail,
    emptyState: data.emptyState,
    linkNotices: { sendOwn: data.linkNotices.sendOwn, sendCouple: data.linkNotices.sendCouple },
  };
  const review = { humanReviewed: data.review.humanReviewed, unreviewedItemIds: [...data.review.unreviewedItemIds] };
  return { setId: data.setId, text, items, review };
}

const sha256 = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** 내보낸 내용 전체의 해시와, 링크의 고름과 짐작이 가리키는 것을 정하는 부분의 해시(세트 글자별 표가 뒤쪽을 고정한다). */
export function exportHashes({ text, items }) {
  return {
    content: sha256({ text, items }),
    meaning: sha256({ prompts: text.prompts, guessNote: text.guessNote, escapeTexts: text.escapeTexts, items }),
  };
}

/** 검사를 통과한 원천에서 생성 파일의 본문을 만든다(순수 함수, 시험이 부른다). */
export function generateGuessModule(data, options = {}) {
  const sourceLabel = options.sourceLabel ?? "docs/wedding-code/2026-10-01_v41_guess_set.json";
  const { setId, text, items, review } = pickExport(data);
  const hashes = exportHashes({ text, items });
  const isPlaceholder = data.placeholder === true;
  const lines = [
    "/**",
    " * 자동 생성 파일이다. 고치지 않는다(do not edit).",
    ` * 원본: ${sourceLabel}`,
    " * 생성기: scripts/build-wedding-code-v41-guess.mjs (검사기 scripts/lib/wedding-code-v41-guess-lint.mjs 의 규칙을 통과한 원본만 만든다)",
    " * 허용한 필드만 나간다(빌드 계획 5.2). 문구를 바꾸려면 원본 JSON 을 고치고 생성기를 다시 돌린다.",
    " * 장면 문장을 바꾸면 세트 글자를 올리고(원본의 세트 글자와 lib/weddingCode/v40/guess/types.ts 의 GuessSetId, guessLink.ts 의 지원 목록) 시험의 표에 새 줄을 더한다.",
    " * 사람이 읽은 장면은 하나도 없다(V40_GUESS_REVIEW). 화면은 어두운 진입 뒤에서만 열린다.",
    " */",
    'import type { GuessReviewData, GuessSet, GuessSetId, GuessTextData } from "@/lib/weddingCode/v40/guess/types";',
    "",
    "/** 원본이 자리표시 문구이면 true. 출시용 생성(--final)은 이 값이 true 이면 실패한다. */",
    `export const V40_GUESS_IS_PLACEHOLDER: boolean = ${isPlaceholder};`,
    "",
    "/** 링크 ga, gb 의 첫 글자. 이 세트의 문장이 가리키는 장면 여섯의 뜻을 정한 판이다. */",
    `export const V40_GUESS_SET_ID: GuessSetId = ${JSON.stringify(setId)};`,
    "",
    "/** 내보낸 내용 전체의 해시(문구, 장면). 생성 파일이 원본과 같은지 시험이 대조한다. */",
    `export const V40_GUESS_CONTENT_SHA256 = "${hashes.content}";`,
    "",
    "/** 링크의 고름과 짐작이 가리키는 것(두 물음, 짐작 안내, 탈출구 이름, 장면 여섯)의 해시. 바뀌면 세트 글자를 올린다. */",
    `export const V40_GUESS_MEANING_SHA256 = "${hashes.meaning}";`,
    "",
    "/** 사람이 읽은 장면이 없는 동안 humanReviewed 는 false 다. 화면과 문서가 미검증이라고 말할 수 있게 내보낸다. */",
    `export const V40_GUESS_REVIEW: GuessReviewData = ${literal(review, 0)};`,
    "",
    "/** 서로 짐작하기 장면 여섯(저장 기준 순서: cards[0] 이 첫째 카드). */",
    `export const V40_GUESS_SET: GuessSet = ${literal(items, 0)};`,
    "",
    "/** 서로 짐작하기 화면 글(제목, 안내, 두 물음, 탈출구 이름, 두 사람 결과 줄 이름표, 끝 줄, 빈 상태, 보내는 화면 안내 둘). */",
    `export const V40_GUESS_TEXT: GuessTextData = ${literal(text, 0)};`,
    "",
  ];
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = { source: DEFAULT_SOURCE_PATH, out: DEFAULT_OUT_PATH, final: false, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--final") args.final = true;
    else if (a === "--check") args.check = true;
    else if (a === "--source") args.source = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else {
      console.error(`알 수 없는 인자: ${a}`);
      process.exit(2);
    }
  }
  if (!args.source || !args.out) {
    console.error("--source 와 --out 뒤에는 경로가 필요하다.");
    process.exit(2);
  }
  return args;
}

function readVocab(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8")).tokens;
  } catch {
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let data;
  try {
    data = JSON.parse(readFileSync(args.source, "utf8"));
  } catch (error) {
    console.error(`원본을 읽지 못했다: ${args.source}\n${error.message}`);
    process.exit(2);
  }
  const rules = lintGuessSet(data);
  if (rules.length > 0) {
    report(rules, console.error);
    console.error(`\n낱말·구조 규칙 위반 ${rules.length}개가 있어 생성하지 않았다.`);
    process.exit(1);
  }
  const vocab = readVocab(vocabPathFor(args.source));
  const gated = vocab ? lintGuessSet(data, { vocab }) : [];
  const newWords = gated.filter((v) => v.rule === "new-word");
  const frozen = vocab !== null && gated.length === 0;
  if (!frozen) {
    console.warn(
      vocab
        ? `경고: 승인한 어휘 목록이 새 낱말을 얼리지 않았다(new-word ${newWords.length}개). 글을 고친 사람이 아닌 사람이 읽고 scripts/wedding-code-v41-guess-lint.mjs --freeze 를 돌려야 한다. 생성은 계속한다.`
        : "경고: 승인한 어휘 목록 파일이 없다. 생성은 계속하지만 출시용 생성(--final)은 못 한다.",
    );
  }
  if (args.final) {
    const problems = [];
    if (data.placeholder === true) problems.push("원본에 placeholder 가 있다");
    if (!frozen) problems.push("승인한 어휘 목록이 얼려 있지 않다");
    if (data.review.humanReviewed !== true || data.review.unreviewedItemIds.length > 0) problems.push("사람이 읽지 않은 장면이 남아 있다(review)");
    if (problems.length > 0) {
      console.error(`출시용 생성(--final)을 할 수 없다: ${problems.join(", ")}.`);
      process.exit(1);
    }
  }
  const sourceLabel = relative(ROOT, args.source).replace(/\\/g, "/");
  const text = generateGuessModule(data, { sourceLabel: sourceLabel.startsWith("..") ? args.source : sourceLabel });
  if (args.check) {
    const current = existsSync(args.out) ? readFileSync(args.out, "utf8") : null;
    if (current !== text) {
      console.error(`생성 파일이 원본과 다르다: ${args.out}\nnode scripts/build-wedding-code-v41-guess.mjs 로 다시 만든다.`);
      process.exit(1);
    }
    console.log("생성 파일이 원본과 같다.");
    return;
  }
  writeFileSync(args.out, text, "utf8");
  console.log(`쓴 파일: ${relative(ROOT, args.out).replace(/\\/g, "/")} (장면 ${data.items.length}개, ${text.length}자)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
