import { normalizeAmoraSafetyText } from "./amoraCrisisSafety";

export interface SharedPersonalActionNavigationContext {
  userText: string;
  visibility: string;
  requestKind: string;
  questionScope: string;
  durable: boolean;
  isDemo: boolean;
  hasPriorityAction: boolean;
  hasAttachments: boolean;
}

const NAVIGATION_REPLY = "상단의 ‘나만 (상담)’을 눌러 개인 대화에서 이어가 주세요. 그곳에서 답변 아래 ‘개인 할 일로 저장’을 눌러 내용을 확인한 뒤 저장할 수 있어요.\n\n지금 함께 대화에 보낸 메시지는 상대에게도 보여요. 상담 탭으로 옮겨도 기존 메시지의 공개 범위는 바뀌지 않아요.";

/** 개인 저장의 이동 경로만 묻는 공유 턴에 현재 화면에 실제로 있는 버튼을 안내한다. */
export function getSharedPersonalActionNavigationReply(
  context: SharedPersonalActionNavigationContext,
): string | null {
  if (!context.durable || context.isDemo || context.visibility !== "shared"
    || context.requestKind !== "chat" || context.hasPriorityAction || context.hasAttachments
    || !["W0_wedding_core", "W1_wedding_adjacent"].includes(context.questionScope)) return null;
  const normalized = normalizeAmoraSafetyText(context.userText);
  if (/(?:`{3,}|~{3,})/u.test(normalized)) return null;
  const text = normalized
    .replace(/"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’|`[^`]*`/gu, " ")
    .replace(/^\s*>.*$/gmu, " ")
    .trim();
  if (!/할\s*일/u.test(text)
    || !/(?:개인\s*할\s*일|나만[^.!?\n]{0,40}(?:저장|할\s*일)|할\s*일[^.!?\n]{0,50}나만)/u.test(text)
    || /(?:상대|파트너|친구)(?:방)?(?:의|가\s*저장한)\s*개인\s*할\s*일/u.test(text)) return null;
  const sentences = text.split(/[.!?。\n]+/u).map(value => value.trim()).filter(Boolean);
  const request = sentences.at(-1) ?? "";
  // '어디로 가야 하는지만'이라는 단일 안내 요청만 고정한다. 상담·실행은 기존 경로다.
  const navigation = /(?:어디(?:로|에서|서)|어떤\s*(?:화면|탭|메뉴)|(?:이동|저장)\s*(?:경로|방법))[^.!?\n]{0,35}만\s*(?:알려|안내해|설명해)\s*(?:줘|주세요|줄래(?:요)?|주실래(?:요)?)$/u.exec(request);
  if (!navigation) return null;
  const before = [...sentences.slice(0, -1), request.slice(0, navigation.index)].join("\n");
  // 앞에 별도 조회·변경 부탁이 섞이면 전체 답변을 이동 안내로 덮어쓰지 않는다.
  if (/(?:알려|보여|정리해|비교해|추천해|계산해|조회해|바꿔|옮겨|지워|삭제해|추가해|저장해|완료해)\s*(?:줘|주|줄)/u.test(before)
    || /(?:정리|비교|추천|계산|조회|변경|수정|삭제|추가|저장|완료)하(?:고|면서|되)(?!\s*싶)/u.test(before)) return null;
  return NAVIGATION_REPLY;
}
