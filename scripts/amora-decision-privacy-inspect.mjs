import { fileURLToPath } from 'node:url';
import { runAmoraDecisionPrivacyInspection } from './lib/amora-decision-privacy-inspector.mjs';

// 이 진입점은 관찰 전용이다. 운영 적용 컨트롤러와 별개이며 SQL·대상 URL을 받지 않는다.
try {
  const result = await runAmoraDecisionPrivacyInspection({
    repoRoot: fileURLToPath(new URL('../', import.meta.url)), argv: process.argv.slice(2),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const code = /^AMORA_INSPECTION_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'AMORA_INSPECTION_UNCONFIRMED';
  process.stderr.write(`${JSON.stringify({ status: 'blocked', code, productionApplyImplemented: false,
    runtimeEvidenceVerified: false, releaseAuthorized: false, remoteWritesPerformed: false })}\n`);
  process.exitCode = 1;
}
