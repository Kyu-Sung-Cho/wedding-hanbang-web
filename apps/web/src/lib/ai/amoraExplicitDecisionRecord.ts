import { classifyAmoraQuestionScope } from "./amoraQuestionScope";
import { containsPotentialSensitiveData } from "./amoraSensitiveData";

/** 기존 카드의 같은 상태만 재확인한다. 실행 권한이나 새 값을 만들지 않는다. */
export function isUnchangedDecisionRecordAcceptance(text: string, input: Record<string, unknown>): boolean {
  const match = /^(?:(?:응|네|좋아)[.。!]?\s*)?(?:미리보기\s*)?그대로\s*["“”'‘’]?(논의\s*중|미정|확정)["“”'‘’]?(?:으로|로)\s*(?:실제\s*)?저장해\s*(?:줘|주세요)[.。!]?\s*(?:저장\s*후\s*결정\s*보드에\s*반영됐는지\s*확인해서\s*알려\s*(?:줘|주세요)[.。!]?)?$/u.exec(text.normalize("NFKC").trim());
  if (!match) return false;
  const status = match[1].replace(/\s/gu, "");
  return input.status === (status === "논의중" ? "considering" : status === "미정" ? "exploring" : "decided");
}

/** 필드 지정 문법을 파싱한다. 새 카드의 입력으로 쓸 때는 반드시 현재 사용자 원문만 전달한다. */
export function parseExplicitDecisionRecordRequest(text: string): Record<string, unknown> | null {
  const lines = text.trim().split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  if (!/^(?:공유\s*)?결정\s*(?:보드|기록)에\s*(?:저장|추가|기록)(?:해\s*(?:줘|주세요)|하자)[.!。]?$/u.test(lines[0] ?? "")) return null;
  const fields = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const field = /^(?:[-*•]\s*)?(문구|제목|상태|메모)\s*[:：]\s*(.+)$/u.exec(line);
    if (!field) return null;
    const key = field[1] === "문구" ? "제목" : field[1];
    if (fields.has(key)) return null;
    fields.set(key, field[2].trim());
  }
  const title = fields.get("제목");
  const statusLabel = fields.get("상태");
  const status = statusLabel === "논의 중" ? "considering" : statusLabel === "미정" ? "exploring" : statusLabel === "확정" ? "decided" : null;
  const memo = fields.get("메모");
  if (!title || title.length > 160 || !status || (memo !== undefined && memo.length > 1_000)) return null;
  return { title, status, ...(memo !== undefined ? { memo } : {}) };
}

export const LEGACY_DECISION_RECONFIRMATION_NOTICE =
  "이번 요청으로는 아직 저장하지 않았어요. 이전 미리보기는 저장 확인 카드가 아니에요. 저장할 문구와 상태를 다음 형식으로 다시 알려주세요.\n첫 줄에는 ‘결정 보드에 저장해줘.’를 적어주세요.\n다음 줄에는 ‘문구:’ 뒤에 저장할 문장을, 그다음 줄에는 ‘상태:’ 뒤에 미정·논의 중·확정 중 하나를 적어주세요. 메모가 필요하면 다음 줄에 ‘메모:’와 내용을 함께 적어주세요.\n보내주신 내용으로 새 확인 카드를 준비할게요. 새 카드의 내용을 확인한 뒤에만 저장해요.";

/** 산문 값을 새 카드나 실행 권한으로 반환하지 않는다. 재확인 안내가 필요한 모양만 판별한다. */
export function needsLegacyDecisionRecordReconfirmation(userText: string, previousText: string): boolean {
  const lines = previousText.trim().split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  if (lines[0] !== "최종 저장 미리보기입니다.") return false;
  if (lines.at(-1) === "이 내용으로 결정보드에 저장할까요?") lines.pop();
  if (lines.length !== 4) return false;
  // 표시용 라벨만 정규화한다. HTML·코드·값 안의 지시문을 벗겨 새 의미를 만들지 않는다.
  const fields = lines.slice(1).map(line => line.replace(/^[-•]\s+/u, "")
    .replace(/^\*\*(문구|제목|상태|메모)(?:[:：]\*\*|\*\*[:：])\s*/u, "$1: "));
  const preview = parseExplicitDecisionRecordRequest(`결정 보드에 저장해줘.\n${fields.join("\n")}`);
  if (!preview || typeof preview.memo !== "string"
    || !/미리보기/u.test(userText) || !isUnchangedDecisionRecordAcceptance(userText, preview)) return false;
  const sourceText = `${preview.title}\n${preview.memo}`;
  if (containsPotentialSensitiveData(sourceText)) return false;
  // 과거 안전/범위 밖 산문을 현재의 짧은 승낙으로 일반 저장 안내에 덮어쓰지 않는다.
  const scope = classifyAmoraQuestionScope({ userText: sourceText }).scope;
  return scope === "W0_wedding_core" || scope === "W1_wedding_adjacent";
}
