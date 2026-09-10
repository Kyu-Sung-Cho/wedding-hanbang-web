#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBudgetDecisionCapture } from './lib/amora-budget-decision-backup-collector.mjs';

try {
  const result = await runBudgetDecisionCapture({ argv: process.argv.slice(2),
    repoRoot: resolve(fileURLToPath(new URL('..', import.meta.url))) });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch {
  process.stderr.write('BUDGET_DECISION_CAPTURE_FAILED; incomplete captures must not be restored or used as release evidence.\n');
  process.exitCode = 1;
}
