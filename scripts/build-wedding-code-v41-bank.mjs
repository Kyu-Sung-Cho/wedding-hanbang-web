#!/usr/bin/env node
/**
 * v4.1-depth 문항 은행을 고정 원본에서 생성한다.
 * v4.0 은행, 공유 링크, 저장 상태는 수정하지 않는다.
 *
 * node scripts/build-wedding-code-v41-bank.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateBankModule } from "./build-wedding-code-v40-bank.mjs";
import { formatReport, lintBank } from "./lib/wedding-code-v40-bank-lint.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "docs/wedding-code/2026-10-04_v41_items.json");
const outputPath = join(root, "apps/web/src/constants/weddingCodeV41Bank.ts");
const bank = JSON.parse(readFileSync(sourcePath, "utf8"));

if (bank.version !== "v4.1-depth" || bank.placeholder !== false || bank.items?.length !== 68) {
  throw new Error("v4.1-depth 원본 버전, 문항 수 또는 placeholder 상태가 다릅니다.");
}

// 재사용하는 v4 배치·문구 검사기는 v4.0 태그로 고정되어 있어 검사 입력에서만 태그를 대체한다.
// 생성 원본과 출력 해시는 언제나 실제 v4.1-depth 태그를 사용한다.
const report = lintBank({ ...bank, version: "v4.0-tendency" });
if (report.errors.length || report.warnings.length) {
  throw new Error(`v4.1-depth 문항 검사 실패\n${formatReport(report)}`);
}

const generated = generateBankModule(bank, {
  sourceLabel: "docs/wedding-code/2026-10-04_v41_items.json",
  bankPrefix: "V41",
  versionSymbol: "WEDDING_CODE_V41_VERSION",
  versionModule: "@/constants/weddingCodeV41",
  generatorLabel: "scripts/build-wedding-code-v41-bank.mjs",
});

if (process.argv.length > 2 && (process.argv.length !== 3 || process.argv[2] !== "--check")) {
  throw new Error("사용법: node scripts/build-wedding-code-v41-bank.mjs [--check]");
}
if (process.argv[2] === "--check") {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== generated) {
    throw new Error("v4.1-depth 생성 파일이 원본과 다릅니다. 생성기를 다시 실행해 주세요.");
  }
  console.log("v4.1-depth 생성 파일이 원본과 같습니다.");
} else {
  writeFileSync(outputPath, generated, "utf8");
  console.log("v4.1-depth 문항 68개를 생성했습니다.");
}
