#!/usr/bin/env node
/**
 * 웨딩코드 4.0 문항 은행 생성기.
 *
 *   node scripts/build-wedding-code-v40-bank.mjs [--source <json>] [--out <ts>] [--final] [--check]
 *
 * 원본 docs/wedding-code/2026-09-29_v40_items.json 을 검사기(scripts/lib/wedding-code-v40-bank-lint.mjs)로 검사하고,
 * 통과하면 apps/web/src/constants/weddingCodeV40Bank.ts 를 만든다. 검사에서 오류가 나면 아무것도 쓰지 않고 1 로 끝난다.
 *
 * placeholder 정책
 *   - 원본 최상위에 placeholder: true 가 있으면 자리표시 은행이다. 기본은 이를 허용하고(검사기의 allowPlaceholder)
 *     생성 파일에 V40_BANK_IS_PLACEHOLDER = true 를 적는다. 구조와 균형 규칙은 그때도 모두 오류다.
 *   - --final 이면 placeholder 가 하나라도 있으면 실패한다(출시용 생성).
 * --check 는 파일을 쓰지 않고 생성 파일이 원본과 같은 내용인지만 본다(다르면 1).
 *
 * 생성 파일의 문항은 검사기가 통과시킨 원본에서 placeholder 필드만 뺀 것이다. 손으로 고치지 않는다.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatReport, lintBank } from "./lib/wedding-code-v40-bank-lint.mjs";
import { DEFAULT_BANK_PATH } from "./lib/wedding-code-v40-ref.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
export const DEFAULT_OUT_PATH = join(ROOT, "apps", "web", "src", "constants", "weddingCodeV40Bank.ts");

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

/** 검사를 통과한 원본에서 생성 파일의 본문을 만든다(순수 함수, 시험이 부른다). */
export function generateBankModule(data, options = {}) {
  const sourceLabel = options.sourceLabel ?? "docs/wedding-code/2026-09-29_v40_items.json";
  const bankPrefix = options.bankPrefix ?? "V40";
  const versionSymbol = options.versionSymbol ?? "WEDDING_CODE_V40_VERSION";
  const versionModule = options.versionModule ?? "@/constants/weddingCodeV40";
  const generatorLabel = options.generatorLabel ?? "scripts/build-wedding-code-v40-bank.mjs";
  const items = data.items.map(({ placeholder, ...rest }) => {
    void placeholder;
    return rest;
  });
  const isPlaceholder = data.placeholder === true;
  const sha = createHash("sha256").update(JSON.stringify({ version: data.version, placeholder: isPlaceholder, items })).digest("hex");
  const lines = [
    "/**",
    " * 자동 생성 파일이다. 고치지 않는다(do not edit).",
    ` * 원본: ${sourceLabel}`,
    ` * 생성기: ${generatorLabel} (검사기 scripts/wedding-code-v40-bank-lint.mjs 를 통과한 원본만 만든다)`,
    " * 문구를 바꾸려면 원본 JSON 을 고치고 생성기를 다시 돌린다. 배치 필드와 극 배열은 lib/weddingCode/v40/layout.ts 와 같아야 한다.",
    " */",
    `import { ${versionSymbol} } from "${versionModule}";`,
    'import type { BankData } from "@/lib/weddingCode/v40/types";',
    "",
    "/** 원본이 자리표시 문구이면 true. 출시 관문은 이 값이 false 일 때만 열린다. */",
    `export const ${bankPrefix}_BANK_IS_PLACEHOLDER: boolean = ${isPlaceholder};`,
    "",
    "/** 원본 내용의 해시(placeholder 필드 제외). 생성 파일이 원본과 같은지 시험이 대조한다. */",
    `export const ${bankPrefix}_BANK_SOURCE_SHA256 = "${sha}";`,
    "",
    "/** 문항 은행 원본(질문 순서 68개). createBank(V40_BANK_DATA) 로 조회 구조를 만든다. */",
    `export const ${bankPrefix}_BANK_DATA: BankData = ${literal({ version: "@@VERSION@@", items }, 0)};`,
    "",
  ];
  return lines.join("\n").replace('"@@VERSION@@"', versionSymbol);
}

function parseArgs(argv) {
  const args = { source: DEFAULT_BANK_PATH, out: DEFAULT_OUT_PATH, final: false, check: false };
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  let data;
  try {
    data = JSON.parse(readFileSync(args.source, "utf8"));
  } catch (error) {
    console.error(`원본을 읽지 못했다: ${args.source}\n${error.message}`);
    process.exit(2);
  }
  const allowPlaceholder = !args.final && data.placeholder === true;
  const result = lintBank(data, { allowPlaceholder });
  if (result.errors.length > 0) {
    console.error(formatReport(result));
    console.error("\n검사를 통과하지 못해 생성하지 않았다.");
    process.exit(1);
  }
  if (allowPlaceholder) console.log(`자리표시 은행이다. 구조와 균형은 통과했고 문구 규칙 경고 ${result.warnings.filter((w) => w.category === "content").length}건, placeholder 경고를 허용했다.`);
  const sourceLabel = relative(ROOT, args.source).replace(/\\/g, "/");
  const text = generateBankModule(data, { sourceLabel: sourceLabel.startsWith("..") ? args.source : sourceLabel });
  if (args.check) {
    const current = existsSync(args.out) ? readFileSync(args.out, "utf8") : null;
    if (current !== text) {
      console.error(`생성 파일이 원본과 다르다: ${args.out}\nnode scripts/build-wedding-code-v40-bank.mjs 로 다시 만든다.`);
      process.exit(1);
    }
    console.log("생성 파일이 원본과 같다.");
    return;
  }
  writeFileSync(args.out, text, "utf8");
  console.log(`쓴 파일: ${relative(ROOT, args.out).replace(/\\/g, "/")} (${data.items.length}개 문항, ${text.length}자)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
