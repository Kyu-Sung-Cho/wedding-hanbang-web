import path from "node:path";

import { convertManifest } from "./convert.js";
import { extractManifest, planExtraction } from "./extract.js";
import { resolveIngestStateDirectory } from "./io.js";
import { loadValidated } from "./load.js";
import { scanSources } from "./scan.js";
import { formatIngestStatus, getIngestStatus } from "./status.js";
import { validateManifest } from "./validate.js";

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 뒤에 값이 필요합니다.`);
  return value;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function stateDirectory(args: string[]): string {
  return resolveIngestStateDirectory(optionValue(args, "--state-dir"));
}

function positiveInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label}은 1 이상의 정수여야 합니다.`);
  return parsed;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const stateDir = stateDirectory(args);
  if (command === "scan") {
    const positionalRoot = args.find((argument, index) =>
      !argument.startsWith("--") && (index === 0 || !args[index - 1].startsWith("--"))
    );
    const rootDir = path.resolve(positionalRoot ?? path.join(process.cwd(), "data", "raw"));
    const manifest = await scanSources({
      rootDir,
      stateDir,
      agencyDir: optionValue(args, "--agency-dir"),
      hallDir: optionValue(args, "--hall-dir"),
    });
    print({ command, units: manifest.units.length, manifest: path.join(stateDir, "manifest.json") });
    return;
  }
  if (command === "convert") {
    const manifest = await convertManifest({ stateDir });
    print({ command, status: await getIngestStatus({ stateDir }), units: manifest.units.length });
    return;
  }
  if (command === "extract") {
    const limit = positiveInteger(optionValue(args, "--limit"), "--limit");
    const units = optionValue(args, "--units")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (units && limit) throw new Error("--units와 --limit은 함께 사용할 수 없습니다.");
    const extractOptions = {
      stateDir,
      ...(limit ? { limit } : {}),
      ...(units ? { unitIds: units } : {}),
    };
    if (hasFlag(args, "--plan")) {
      print({ command: "extract-plan", ...(await planExtraction(extractOptions)) });
      return;
    }
    await extractManifest(extractOptions);
    print({ command, status: await getIngestStatus({ stateDir }) });
    return;
  }
  if (command === "validate") {
    await validateManifest({ stateDir });
    print({ command, status: await getIngestStatus({ stateDir }) });
    return;
  }
  if (command === "load") {
    const snapshot = optionValue(args, "--snapshot");
    if (!snapshot) throw new Error("load에는 --snapshot 2026Q3가 필요합니다.");
    const result = await loadValidated({
      stateDir,
      snapshot,
      apply: hasFlag(args, "--apply"),
      confirmProjectRef: optionValue(args, "--confirm-project-ref"),
    });
    print({
      command,
      mode: result.mode,
      snapshot,
      plan: {
        units: result.plan.units.length,
        skipped_units: result.plan.skipped_units.length,
        raw_objects: result.plan.raw_objects.length,
        agency_packages: result.plan.agency_packages.length,
        official_prices: result.plan.official_prices.length,
        dedupe_candidates: result.plan.dedupe_candidates.length,
        ai_ledger_entries: result.plan.ai_ledger.length,
        warnings: result.plan.warnings,
      },
    });
    return;
  }
  if (command === "status") {
    process.stdout.write(`${formatIngestStatus(await getIngestStatus({ stateDir }))}\n`);
    return;
  }

  throw new Error(
    "사용법: pnpm ingest <scan|convert|extract|validate|load|status> [옵션] (extract: --units id1,id2 또는 형식별 층화 --limit N; 기본 8)",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "알 수 없는 ingest 오류";
  process.stderr.write(`ingest 실패: ${message}\n`);
  process.exitCode = 1;
});
