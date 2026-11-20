import { LETTER_COPY, SELF_SEND_COPY, type LetterSelfSend, type LetterSelfSendMessage } from "@hanbang/shared/invitation";
import type { LetterVersionRow, StoredShare } from "./inquiryRepository";
import { LIVE_COPY } from "./liveCopy";

/**
 * 커플이 직접 보내기(D-83 1단계). 저장한 편지 한 판을 받는 곳마다 보낼 글 하나로 엮는다.
 * 이 모듈은 글을 만들기만 한다. 서버는 이 글을 어디에도 내보내지 않고, 보내는 일은 커플이 자기 폰에서 한다.
 *
 * 글은 저장된 판의 값으로만 만든다. 화면에서 고치는 중인 글이나 화면용으로 가린 값으로는 만들지 않는다.
 *   - 받는 곳 이름: 판에 남은 이름(recipient_names)을 쓴다.
 *   - 휴대폰 번호: 글에 넣지 않는다. 화면은 가린 번호만 받아 왔고 그대로 둔다. 켜 두었으면 phoneOmitted 로 알린다.
 *   - 예산: 판에 남긴 값("N만 원" 또는 "아직 정하지 않았어요")을 정해진 한 줄로 옮긴다.
 *   - 이름: 따로 줄을 두지 않는다. 이름을 알려주기로 했으면 맺음말이 이미 두 사람 이름을 담는다.
 *   - 끝 줄: AI 웨딩 비서의 도움을 받아 쓴 문의라고 밝힌다.
 */

/** 예산을 알려주기로 한 판에만 붙는 한 줄. 값이 비어 있으면(DB 가 막지만) 지어내지 않고 줄을 뺀다. */
function budgetLine(share: StoredShare): string | null {
  if (!share.on || !share.value) return null;
  return share.value === LIVE_COPY.letter.budgetUnsetStored
    ? SELF_SEND_COPY.budgetUnsetLine
    : SELF_SEND_COPY.budgetLine(share.value);
}

/** 두 분이 글을 고쳐 인사로 시작했으면 인사를 한 번 더 붙이지 않는다("안녕하세요. 안녕하세요…"가 되지 않게). */
function greeted(body: string): string {
  return /^안녕/.test(body.trimStart()) ? body : `${SELF_SEND_COPY.greeting} ${body}`;
}

function messageText(version: LetterVersionRow, recipientName: string, budget: string | null): string {
  const opening = `${LETTER_COPY.to([recipientName])}\n\n${greeted(version.body)}`;
  const withBudget = budget ? `${opening}\n${budget}` : opening;
  return `${withBudget}\n\n${version.signature}\n${SELF_SEND_COPY.aiNote}`;
}

export function selfSendView(version: LetterVersionRow): LetterSelfSend {
  const budget = budgetLine(version.shares.budget);
  const messages: LetterSelfSendMessage[] = version.recipientHallIds.map((hallId, index) => {
    const name = version.recipientNames[index];
    return { hallId, name, text: messageText(version, name, budget) };
  });
  return {
    versionId: version.id,
    fingerprint: version.fingerprint,
    messages,
    phoneOmitted: version.shares.phone.on,
  };
}
