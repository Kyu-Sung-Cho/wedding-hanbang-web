import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pinnedArtifact } from '../../lib/current-baseline-release-contract.mjs';
import { createProfileRoleHistoricalRepository } from './profile-role-historical-repository.mjs';

// 230 역사 fixture에 이미 검토된 231 원문만 추가한다. 현행 SQL 목록을 줄이지 않는다.
export function createProfileAvatarHistoricalRepository(sourceRoot) {
  const fixture = createProfileRoleHistoricalRepository(sourceRoot);
  try {
    const file = 'supabase/release-contracts/profile-avatar-v1.json';
    const contract = JSON.parse(pinnedArtifact(sourceRoot, { file,
      sha256: 'a8602464739c85dabce2f2a01ec667f6525709db11caa1a2d5f4cf2c790e7a1e' }));
    const pins = [contract.runtime, contract.catalog, contract.catalogFixture, contract.platformPolicy,
      contract.historicalPolicy, ...contract.migrations.map(pin => ({ ...pin, file: `supabase/migrations/${pin.file}` }))];
    for (const pin of pins) pinnedArtifact(sourceRoot, pin);
    for (const path of [file, ...pins.map(pin => pin.file)]) {
      mkdirSync(dirname(join(fixture.root, path)), { recursive: true });
      copyFileSync(join(sourceRoot, path), join(fixture.root, path));
    }
    return fixture;
  } catch (error) { fixture.cleanup(); throw error; }
}
