import path from "node:path";

import { convertManifest } from "./convert.js";
import { resolveIngestStateDirectory } from "./io.js";
import {
  LOCAL_DETERMINISTIC_MODEL,
  LOCAL_DETERMINISTIC_PROVIDER_MODE,
} from "./local-extraction-contract.js";
import { extractManifestLocally } from "./local-extraction-runner.js";
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

function hasFlagOrAssignment(args: string[], name: string): boolean {
  return args.some((argument) => argument === name || argument.startsWith(`${name}=`));
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
    const extractOptionsWithValues = new Set([
      "--state-dir",
      "--limit",
      "--units",
      "--approved-plan-sha256",
    ]);
    const extractPositionals = args.filter((argument, index) =>
      !argument.startsWith("--")
      && !extractOptionsWithValues.has(args[index - 1] ?? "")
    );
    const extractOperation = extractPositionals[0];
    if (extractOperation !== undefined && extractOperation !== "local-candidates") {
      throw new Error(`unknown_extract_operation:${extractOperation}`);
    }
    if (extractPositionals.length > (extractOperation ? 1 : 0)) {
      throw new Error(`unknown_extract_operation:${extractPositionals[1]}`);
    }
    const localCandidateMode = extractOperation === "local-candidates";
    const limit = positiveInteger(optionValue(args, "--limit"), "--limit");
    const units = optionValue(args, "--units")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (units && limit) throw new Error("--units와 --limit은 함께 사용할 수 없습니다.");
    if (
      hasFlagOrAssignment(args, "--plan")
      || hasFlagOrAssignment(args, "--paid-openai")
      || hasFlagOrAssignment(args, "--approved-plan-sha256")
    ) {
      throw new Error(
        "paid_openai_cli_disabled: 업체 공시 추출은 로컬 전용이며 유료 OpenAI 실행은 모든 production 진입점에서 차단됩니다.",
      );
    }
    if (localCandidateMode) {
      const { extractLocalCandidates } = await import("./local-candidate.js");
      const result = await extractLocalCandidates({
        stateDir,
        ...(limit ? { limit } : {}),
        ...(units ? { unitIds: units } : {}),
      });
      print({
        command,
        operation: "local-candidates",
        mode: LOCAL_DETERMINISTIC_PROVIDER_MODE,
        model: LOCAL_DETERMINISTIC_MODEL,
        ...result,
      });
      return;
    }
    const extractOptions = {
      stateDir,
      ...(limit ? { limit } : {}),
      ...(units ? { unitIds: units } : {}),
    };
    const result = await extractManifestLocally(extractOptions);
    print({
      command,
      mode: LOCAL_DETERMINISTIC_PROVIDER_MODE,
      model: LOCAL_DETERMINISTIC_MODEL,
      cost_usd: 0,
      selected_units: result.selected_units,
      processed_units: result.processed_units,
      cache_hits: result.cache_hits,
      failed_units: result.failed_units,
      status: await getIngestStatus({ stateDir }),
    });
    return;
  }
  if (command === "validate") {
    await validateManifest({ stateDir });
    print({ command, status: await getIngestStatus({ stateDir }) });
    return;
  }
  if (command === "score") {
    const candidateSourceOption = optionValue(args, "--candidate-source") ?? "paid";
    if (candidateSourceOption !== "paid" && candidateSourceOption !== "local") {
      throw new Error("--candidate-source must be paid or local");
    }
    const candidateSource = candidateSourceOption as "paid" | "local";
    const approvedPaidPlanSha256 = optionValue(args, "--approved-plan-sha256")?.trim();
    if (candidateSource === "paid" && !approvedPaidPlanSha256) {
      throw new Error("--approved-plan-sha256 옵션이 필요합니다.");
    }
    if (candidateSource === "local" && approvedPaidPlanSha256) {
      throw new Error("--candidate-source local cannot be combined with --approved-plan-sha256");
    }
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
      ...(approvedPaidPlanSha256 ? { approvedPaidPlanSha256 } : {}),
      candidateSource,
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
    "사용법: pnpm ingest <scan|convert|extract|validate|score|load|status|paid-execution-domain-init|paid-execution-domain-status> [옵션] (extract는 로컬 결정론적·0원·검수대기 전용)",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "알 수 없는 ingest 오류";
  process.stderr.write(`ingest 실패: ${message}\n`);
  process.exitCode = 1;
});
