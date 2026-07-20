import path from "node:path";

import { convertManifest } from "./convert.js";
import { extractManifest, planExtraction } from "./extract.js";
import { resolveIngestStateDirectory } from "./io.js";
import { loadValidated } from "./load.js";
import { scanSources } from "./scan.js";
import { scoreExtractionAgainstGroundTruth } from "./score.js";
import { formatIngestStatus, getIngestStatus } from "./status.js";
import { validateManifest } from "./validate.js";
import {
  getPaidExecutionDomainStatus,
  initializePaidExecutionDomain,
} from "./paid-execution-domain.js";

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

function requiredOption(args: string[], name: string): string {
  const value = optionValue(args, name)?.trim();
  if (!value) throw new Error(`${name} 옵션이 필요합니다.`);
  return value;
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
      enforcePilotAuthorization: true,
      ...(limit ? { limit } : {}),
      ...(units ? { unitIds: units } : {}),
      ...(optionValue(args, "--approved-plan-sha256")
        ? { approvedPlanSha256: optionValue(args, "--approved-plan-sha256") }
        : {}),
    };
    if (hasFlag(args, "--plan")) {
      if (optionValue(args, "--approved-plan-sha256")) {
        throw new Error("--plan과 --approved-plan-sha256은 함께 사용할 수 없습니다.");
      }
      print({ command: "extract-plan", ...(await planExtraction(extractOptions)) });
      return;
    }
    if (!optionValue(args, "--approved-plan-sha256")) {
      throw new Error("extract --plan이 출력한 --approved-plan-sha256 값이 필요합니다.");
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
  if (command === "score") {
    const units = requiredOption(args, "--units")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const expectedOccurrenceCount = positiveInteger(
      requiredOption(args, "--expected-occurrences"),
      "--expected-occurrences",
    );
    if (!expectedOccurrenceCount) throw new Error("--expected-occurrences가 필요합니다.");
    const report = await scoreExtractionAgainstGroundTruth({
      stateDir,
      unitIds: units,
      approvedPaidPlanSha256: requiredOption(args, "--approved-plan-sha256"),
      groundTruthPath: requiredOption(args, "--ground-truth"),
      expectedGroundTruthSha256: requiredOption(args, "--ground-truth-sha256"),
      expectedOccurrenceCount,
      ...(optionValue(args, "--overlay") ? { overlayPath: optionValue(args, "--overlay") } : {}),
      ...(optionValue(args, "--overlay-sha256")
        ? { expectedOverlaySha256: optionValue(args, "--overlay-sha256") }
        : {}),
      ...(optionValue(args, "--adjudication")
        ? { adjudicationPath: optionValue(args, "--adjudication") }
        : {}),
      ...(optionValue(args, "--adjudication-sha256")
        ? { expectedAdjudicationSha256: optionValue(args, "--adjudication-sha256") }
        : {}),
      ...(optionValue(args, "--non-blocking-units")
        ? {
            nonBlockingUnitIds: optionValue(args, "--non-blocking-units")
              ?.split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          }
        : {}),
      requireValidatedArtifacts: true,
    });
    print({ command, report });
    return;
  }
  if (command === "load") {
    const snapshot = optionValue(args, "--snapshot");
    if (!snapshot) throw new Error("load에는 --snapshot 2026Q3가 필요합니다.");
    if (hasFlag(args, "--apply")) {
      throw new Error("load_apply_blocked_pending_state_aware_batch_runner");
    }
    const result = await loadValidated({
      stateDir,
      snapshot,
      apply: false,
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

  if (command === "paid-execution-domain-init") {
    print({ command, ...(await initializePaidExecutionDomain(stateDir)) });
    return;
  }
  if (command === "paid-execution-domain-status") {
    print({ command, ...(await getPaidExecutionDomainStatus(stateDir)) });
    return;
  }

  throw new Error(
    "사용법: pnpm ingest <scan|convert|extract|validate|score|load|status|paid-execution-domain-init|paid-execution-domain-status> [옵션] (유료 계획 전에 paid-execution-domain-init 1회 필수; extract --plan: 승인 SHA 생성; 실제 extract: --approved-plan-sha256 <sha> 필수)",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "알 수 없는 ingest 오류";
  process.stderr.write(`ingest 실패: ${message}\n`);
  process.exitCode = 1;
});
