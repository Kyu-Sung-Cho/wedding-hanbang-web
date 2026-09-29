import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pinnedArtifact } from '../../lib/current-baseline-release-contract.mjs';
import { createWeddingCodePairSessionConflictHistoricalRepository } from './wedding-code-pair-session-conflict-historical-repository.mjs';

// 고정된 239 fixture에 검토한 240 계약의 원문만 추가한다. 현재 SQL 목록을 잘라내지 않는다.
export function createDeletionAuditHistoricalRepository(sourceRoot) {
  const fixture = createWeddingCodePairSessionConflictHistoricalRepository(sourceRoot);
  try {
    const file = 'supabase/release-contracts/account-deletion-audit-nullability-v1.json';
    const contract = JSON.parse(pinnedArtifact(sourceRoot, {
      file, sha256: 'ad50817b53ee069e99b8dcd5b8b5856b5c9691a32d5dd1ff15daccb5a1c4d73a',
    }));
    const pins = [contract.predecessor, contract.predecessorLoader, contract.runtime,
      ...contract.migrations.map(pin => ({ ...pin, file: `supabase/migrations/${pin.file}` }))];
    for (const pin of pins) pinnedArtifact(sourceRoot, pin);
    for (const path of [file, ...pins.map(pin => pin.file)]) {
      mkdirSync(dirname(join(fixture.root, path)), { recursive: true });
      copyFileSync(join(sourceRoot, path), join(fixture.root, path));
    }
    return fixture;
  } catch (error) { fixture.cleanup(); throw error; }
}
