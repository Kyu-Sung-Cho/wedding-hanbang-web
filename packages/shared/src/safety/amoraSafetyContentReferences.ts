const EXCLUDED_WEDDING_VIDEO_SCENE_PATTERN = /(?:결혼식\s*)?식전\s*영상(?:에는|에서|에)\s*(?:폭력|자살|자해)(?:\s*(?:이나|나|과|와|및)\s*(?:폭력|자살|자해))*(?:을|를)?\s*다루는\s*장면(?:은|을|들은|들을)\s*(?:넣지\s*않(?:을\s*(?:거(?:야|예요)|계획(?:이야|이에요))|겠(?:어(?:요)?|습니다)|아(?:요)?)|(?:빼|제외해)\s*(?:줘(?:요)?|주세요))(?=$|[\s.!?,])/gu;

// 영상에서 제외할 소재와 제외 행위가 완결된 구절만 가린다.
// 같은 문장 앞뒤의 실제 고백과 포함 계획은 그대로 남겨 기존 안전 판정이 검사한다.
export function withoutAmoraExcludedWeddingVideoScenes(value: string): string {
  return value.replace(EXCLUDED_WEDDING_VIDEO_SCENE_PATTERN, " ");
}
