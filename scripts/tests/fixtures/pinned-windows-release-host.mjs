import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PINNED_WINDOWS_PRODUCTION_TOOLCHAIN } from '../../lib/production-windows-toolchain.mjs';

// 테스트 호스트의 바이트를 독립적으로 확인한다. 운영 검증 결과나 예외를 성공 판정으로 쓰지 않는다.
// 이 판정은 릴리스 인가가 아니다. 실제 컨트롤러가 핀 불일치를 거부하는지 별도로 단정한다.
export async function releaseHostHasPinnedBytes() {
  if (process.platform !== 'win32') return false;
  for (const pin of [PINNED_WINDOWS_PRODUCTION_TOOLCHAIN.git, PINNED_WINDOWS_PRODUCTION_TOOLCHAIN.powershell]) {
    const bytes = await readFile(pin.path).catch(() => null);
    if (!bytes || createHash('sha256').update(bytes).digest('hex').toUpperCase() !== pin.sha256) return false;
  }
  return true;
}
