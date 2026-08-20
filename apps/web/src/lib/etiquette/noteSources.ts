import { MANNERS_PARTS } from "@/lib/manners/data";

/**
 * 체크리스트 항목 안내(`note`)가 어디서 나왔는지 — 예절 안내의 편과 절.
 *
 * **왜 여기 있고 체크리스트 템플릿에 없나.** 예절 안내는 「예물」·「청첩장」 같은 전통 용어를
 * 정당하게 쓴다. 제품 템플릿(`weddingPlanning.ts`)은 반대로 쉬운 말만 쓰기로 했고 그걸
 * 모바일 `productCopy` 테스트가 지킨다. 절 제목을 템플릿에 저장했더니 가이드의 어휘가
 * 제품 파일로 끌려 들어가 그 테스트가 걸렸다 — 테스트가 옳았다. 그래서 매핑을 예절 코드
 * 옆에 둔다. 체크리스트 템플릿이 예절 코퍼스를 알 이유도 없고, 항목에 필드를 늘리지 않으니
 * 저장 payload에 여분 키가 실릴 위험도 사라진다.
 *
 * **왜 절 번호가 아니라 제목인가.** 절에는 안정적인 id가 없고 화면 앵커가 위치
 * 기반(`#section-N`)이라, 번호를 적어 두면 편 중간에 한 절이 들어가는 순간 조용히 다른
 * 곳을 가리킨다. 제목으로 찾으면 제목이 바뀌었을 때 테스트가 시끄럽게 실패한다.
 *
 * 근거 없이 쓴 안내(무엇을 물어보라는 말)는 여기 없다. 참·거짓이 없는 문장이라 댈 근거도 없다.
 */
const NOTE_SOURCES: Readonly<Record<string, { part: string; heading: string }>> = {
  venue_04: { part: "cost-saving", heading: "3. 견적서에서 돈이 새는 자리" },
  venue_06: { part: "cost-saving", heading: "4. 가장 크게 새는 돈 — 취소·변경 위약금" },
  venue_09: { part: "cost-saving", heading: "5. 항목별로 줄일 수 있는 자리 — 숫자 대신 질문 목록" },
  venue_07: { part: "small-wedding", heading: "초대와 안내 — 부르는 쪽이 먼저 정리할 것" },
  studio_09: { part: "cost-saving", heading: "2. 2026년부터 달라진 것 — 가격 공개는 '부탁'이 아니라 '의무'" },
  studio_06: { part: "cost-saving", heading: "2. 2026년부터 달라진 것 — 가격 공개는 '부탁'이 아니라 '의무'" },
  ring_10: { part: "gifts-and-traditions", heading: "예물 — 두 사람이 오래 쓸 것" },
  ring_06: { part: "gifts-and-traditions", heading: "예물 — 두 사람이 오래 쓸 것" },
  snap_05: { part: "photo-manners", heading: "사진을 나누고 올릴 때" },
  housing_04: { part: "home-conversation", heading: "분담 이야기 — 오래된 공식과 요즘" },
  housing_05: { part: "home-conversation", heading: "언제, 어떤 순서로 꺼내나" },
  invitation_03: { part: "invitation-sending", heading: "1. 청첩장에 무엇을 담을지 먼저 정하기" },
  invitation_05: { part: "invitation-sending", heading: "3. 언제부터 보낼까" },
  invitation_06: { part: "invitation-sending", heading: "1. 청첩장에 무엇을 담을지 먼저 정하기" },
  makeup_06: { part: "wedding-day", heading: "두 사람 — 식 전 준비" },
  gift_04: { part: "return-gift", heading: "답례품 고르기" },
  gift_06: { part: "return-gift", heading: "답례품 고르기" },
  pyebaek_05: { part: "traditional-greetings", heading: "미리 확인해 둘 것" },
};

export type NoteSourceLink = {
  href: string;
  partTitle: string;
  heading: string;
};

/** 항목 id로 근거 링크를 찾는다. 편이나 절 제목이 어긋나면 `null`(테스트가 잡는다). */
export function noteSourceLink(itemId: string): NoteSourceLink | null {
  const source = NOTE_SOURCES[itemId];
  if (!source) return null;

  const part = MANNERS_PARTS.find((candidate) => candidate.slug === source.part);
  if (!part) return null;

  const index = part.sections.findIndex((section) => section.heading === source.heading);
  if (index < 0) return null;

  return {
    href: `/manners/${part.slug}#section-${index + 1}`,
    partTitle: part.title,
    heading: source.heading,
  };
}

/** 근거가 적힌 항목 id 전부. 테스트가 전수 검사에 쓴다. */
export function noteSourceItemIds(): string[] {
  return Object.keys(NOTE_SOURCES);
}
