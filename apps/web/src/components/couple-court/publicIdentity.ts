const ADJECTIVES = ["차분한", "다정한", "든든한", "유쾌한", "섬세한", "단단한", "포근한", "솔직한"];
const PLANTS = ["유칼립투스", "라벤더", "동백", "올리브", "세이지", "로즈메리", "미모사", "자스민"];

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A public-post-only pseudonym. It cannot be reversed into a user identity. */
export function publicCourtNickname(publicPostId: string): string {
  const hash = stableHash(publicPostId);
  const adjective = ADJECTIVES[hash % ADJECTIVES.length];
  const plant = PLANTS[Math.floor(hash / ADJECTIVES.length) % PLANTS.length];
  return `${adjective} ${plant} 커플`;
}
