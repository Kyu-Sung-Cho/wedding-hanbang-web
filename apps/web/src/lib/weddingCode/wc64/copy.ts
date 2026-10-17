// wc64 화면이 같이 쓰는 '식 없이' 고정 문구. 결과·비교·이해도 화면이 같은 선택을 서로 다른 말로 부르지 않게 한 곳에 둔다
// (2026-10-16 2단계 검토: '식을 안 올려서'·'식을 올리지 않기로 해서'·'식 없이 하기로 해서'가 섞여 있었다).
// 식 계획 선택지 이름이 '식 없이 하려고 해요'라서 결과에서는 늘 '식 없이 하기로 해서'로 부른다.

/** 모든 '식 없이' 까닭 문장의 머리. 이 말 뒤에 무엇을 뺐는지 붙인다. */
export const WC64_NO_CEREMONY_LEAD = "식 없이 하기로 해서" as const;

/** 글자를 비워 둔 까닭(한눈에 보기·글자 장·비교의 빈 자리, `wc64DimSkipReason` "no-ceremony") */
export const WC64_NO_CEREMONY_DIM_TEXT = `${WC64_NO_CEREMONY_LEAD} 이 글자는 비워 뒀어요.` as const;

/** 묶음 문장이 모두 빠져 묻지 않은 까닭(묶음 막대, `wc64FacetSkipReason` "no-ceremony"이고 남은 문장이 없을 때) */
export const WC64_NO_CEREMONY_FACET_TEXT = `${WC64_NO_CEREMONY_LEAD} 이 묶음은 묻지 않았어요` as const;

/** 묶음 문장 중 한쪽만 남아 %를 내지 않은 까닭(`wc64FacetSkipReason` "no-ceremony"이고 한쪽 문장만 남았을 때) */
export const WC64_NO_CEREMONY_FACET_ONE_SIDE_TEXT = `${WC64_NO_CEREMONY_LEAD} 한쪽 문장만 남아 %를 내지 않았어요` as const;

/** 이해도 단계를 묻지 않은 까닭(`Wc64KnowledgeSkipReason` "no-ceremony") */
export const WC64_NO_CEREMONY_KNOWLEDGE_TEXT = `${WC64_NO_CEREMONY_LEAD} 묻지 않았어요` as const;

/** '내 답 전체'에서 묻지 않은 식 관련 문장 수 한 줄 */
export function wc64NoCeremonyNotAskedText(count: number): string {
  return `${WC64_NO_CEREMONY_LEAD} 식 관련 문장 ${count}개는 묻지 않았어요.`;
}
