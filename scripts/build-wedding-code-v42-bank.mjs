#!/usr/bin/env node
/** v4.2 문항 원본의 구조·문구를 검사한 뒤 정확한 판으로 생성한다. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateBankModule } from "./build-wedding-code-v40-bank.mjs";
import { formatReport, lintBank } from "./lib/wedding-code-v40-bank-lint.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "docs/wedding-code/2026-10-06_v42_items.json");
const outputPath = join(root, "apps/web/src/constants/weddingCodeV42Bank.ts");
const bank = JSON.parse(readFileSync(sourcePath, "utf8"));
if (bank.version !== "v4.2-depth" || bank.placeholder !== false || bank.items?.length !== 68) {
  throw new Error("v4.2 원본의 판·문항 수·placeholder가 다릅니다.");
}
const report = lintBank({ ...bank, version: "v4.0-tendency" });
if (report.errors.length || report.warnings.length) throw new Error(formatReport(report));
const generated = generateBankModule(bank, {
  sourceLabel: "docs/wedding-code/2026-10-06_v42_items.json",
  bankPrefix: "V42",
  versionSymbol: "WEDDING_CODE_V42_VERSION",
  versionModule: "@/constants/weddingCodeV42",
  generatorLabel: "scripts/build-wedding-code-v42-bank.mjs",
});
if (process.argv.length > 2 && (process.argv.length !== 3 || process.argv[2] !== "--check")) {
  throw new Error("사용법: node scripts/build-wedding-code-v42-bank.mjs [--check]");
}
if (process.argv[2] === "--check") {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== generated) {
    throw new Error("v4.2 생성 파일이 원본과 다릅니다.");
  }
  console.log("v4.2 생성 파일이 원본과 같습니다.");
} else {
  writeFileSync(outputPath, generated, "utf8");
  console.log("v4.2 문항 68개를 생성했습니다.");
}
