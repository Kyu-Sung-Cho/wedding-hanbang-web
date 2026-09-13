import { copyFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pinnedArtifact } from '../../lib/current-baseline-release-contract.mjs';
import { createExplicitBudgetHistoricalRepository } from './explicit-budget-historical-repository.mjs';

// 고정 228 Git 원문 + 이미 검토된 229 계약/SQL/runtime만 조합한다.
// 현재 migration 목록에서 후속 SQL을 삭제하거나 임의로 필터링하지 않는다.
export function createChatFeedbackHistoricalRepository(sourceRoot) {
  const historical = createExplicitBudgetHistoricalRepository(sourceRoot);
  try {
    const file = 'supabase/release-contracts/chat-feedback-nullability-v1.json';
    const contract = JSON.parse(pinnedArtifact(sourceRoot, { file,
      sha256: '21b1c661a3accddadceb27e8076e11940962a14180ac69d4f6174111e6b0e7ab' }));
    for (const pin of [contract.runtime, ...contract.migrations.map(pin => ({ ...pin, file: `supabase/migrations/${pin.file}` }))])
      pinnedArtifact(sourceRoot, pin);
    for (const pin of [file, contract.runtime.file, ...contract.migrations.map(pin => `supabase/migrations/${pin.file}`)])
      copyFileSync(join(sourceRoot, pin), join(historical.root, pin));
    // 검사하는 코드는 현재 모듈이다. 고정 선행 자료 원문/구현핀을 덮어쓰지 않는다.
    for (const module of readdirSync(join(sourceRoot, 'scripts/lib')).filter(file => file.endsWith('.mjs'))) {
      const target = join(historical.root, 'scripts/lib', module);
      const fixed = JSON.parse(readFileSync(join(sourceRoot, 'supabase/release-contracts/current-baseline-rollout-v1.json'), 'utf8'));
      if (!Object.values(fixed.implementation).some(pin => pin.file === `scripts/lib/${module}`))
        copyFileSync(join(sourceRoot, 'scripts/lib', module), target);
    }
    copyFileSync(join(sourceRoot, 'scripts/supabase-release-fence.mjs'), join(historical.root, 'scripts/supabase-release-fence.mjs'));
    return historical;
  } catch (error) { historical.cleanup(); throw error; }
}
