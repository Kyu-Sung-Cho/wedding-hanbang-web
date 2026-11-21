import { assessAmoraSafetyText } from "@/lib/ai/amoraCrisisClassifier";
import { isAmoraGatekeeperReplyMetadata } from "@/lib/ai/amoraGatekeeperContract";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";

export type AmoraTrustedHistoryVisibility =
  | "shared"
  | "bride_private"
  | "groom_private";

export type AmoraTrustedHistoryRow = {
  id: unknown;
  sender_id: unknown;
  sender_type: unknown;
  role: unknown;
  content: unknown;
  metadata: unknown;
  visibility: unknown;
};

export type SelectAmoraTrustedHistoryInput<T extends AmoraTrustedHistoryRow> = {
  /** Exact database order after the route reverses its newest-first query. */
  oldestFirstRows: readonly T[];
  currentUserMessageId: string;
  visibility: AmoraTrustedHistoryVisibility;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasAllowedVisibility(
  value: unknown,
  requestVisibility: AmoraTrustedHistoryVisibility,
): value is AmoraTrustedHistoryVisibility {
  return value === "shared"
    || (requestVisibility !== "shared" && value === requestVisibility);
}

function isUserRow(row: AmoraTrustedHistoryRow): boolean {
  return typeof row.id === "string"
    && typeof row.sender_id === "string"
    && (row.sender_type === "bride" || row.sender_type === "groom")
    && row.role === "user"
    && typeof row.content === "string"
    && (
      row.metadata === null
      || (isRecord(row.metadata) && row.metadata.target !== "partner")
    );
}

/**
 * 이력에 실어도 되는 범위.
 *
 * W0·W1 은 결혼 대화 본체다. **W4 를 여기에 넣은 이유**(2026-09-03):
 * 한 대화 안에서 결혼 낱말이 하나도 없는 턴 — "나는 친척 관계상 180명은 불러야
 * 한다고 봐", "생각이 완전히 바뀌었어. 제주에서 가족 20명만", "이유는 어머니가
 * 장거리 이동이 어려워서야" — 은 `classifyAmoraQuestionScope` 가 문장 하나만 보고
 * W4 로 판정한다. 예전 규칙은 그 턴을 **그 턴이 끝나는 순간 이후 모든 이력에서
 * 영구히** 지웠고, 스테이징 실측(2026-09-03)에서 두 턴 뒤 "둘의 의견을 중재해줘"
 * 가 신랑 의견을 한 줄도 못 본 채 절충안 0개를 냈다. 요약에서도 방향 전환이
 * 통째로 사라졌다.
 *
 * **여는 것은 이력뿐이다.** 이 목록은 "모델에게 지난 발화를 보여줘도 되는가"만
 * 정한다. 현재 턴의 범위·도구·장기 기억은 `classifyAmoraQuestionScope` 가 현재
 * 입력으로 따로 판정하고, 연결 문맥(`buildAmoraBoundedContinuity`)은 직전 사용자
 * 발화를 자기 신뢰 경계 안에서 다시 분류해 W0/W1 만 받는다. 그래서 W4 가 여기를
 * 지나도 도구나 기억으로 승격되지 않는다.
 *
 * W2(고위험 인접)·W3(정서 돌봄)·W5(안전 우선)는 계속 배제한다. 그 셋은 지워진
 * 자리가 남더라도 모델 입력에서 빼야 하는 범위다.
 */
function isTrustedHistoryScope(scope: unknown): boolean {
  return scope === "W0_wedding_core"
    || scope === "W1_wedding_adjacent"
    || scope === "W4_out_of_scope";
}

function isServerAuthoredAssistantFor(
  row: AmoraTrustedHistoryRow,
  userMessageId: string,
): boolean {
  if (
    row.sender_id !== null
    || row.sender_type !== "ai"
    || row.role !== "assistant"
    || typeof row.content !== "string"
    || !isRecord(row.metadata)
    || row.metadata.target === "partner"
  ) {
    return false;
  }

  // `memory_eligible === true` 요구를 뺐다(2026-09-03).
  //
  // 그 조건은 cedd7a1bf 에서 근거 설명 없이 들어왔고 저장소 어디에도 안전 근거가
  // 적혀 있지 않다. 그리고 그 플래그가 답하는 질문은 이 파일의 질문이 아니다 —
  // `memory_eligible` 은 route.ts 가 `questionScope.allowsLongTermMemory` 로 쓰는
  // **장기 기억 적재 자격**이고(`amoraMemorySourceScope.ts` 가 그 용도로 읽는다),
  // 여기서 물어야 하는 것은 "같은 대화 안에서 모델에게 다시 보여줘도 되는가"다.
  // 둘을 겹쳐 쓰는 바람에 memory_eligible=false 로 저장된 W0 턴("생각이 완전히
  // 바뀌었어. 제주에서 가족 20명만")까지 이력에서 사라졌다.
  //
  // 대신 지켜지는 것: 서버가 쓴 행(sender_id null·sender_type ai·role assistant),
  // 정확한 응답 링크, 상대 대상 아님, 그리고 아래 범위 판정.
  return row.metadata.in_reply_to_user_message_id === userMessageId
    && isTrustedHistoryScope(row.metadata.question_scope)
    // 문지기(D-89)가 막은 턴은 사용자 글과 답을 함께 뺀다. 범위 밖으로 거절한 답은 W4 라
    // 위의 범위 목록을 지나므로 표식으로 따로 본다.
    && !isAmoraGatekeeperReplyMetadata(row.metadata);
}

function isSafeWeddingHistoryUser(row: AmoraTrustedHistoryRow): boolean {
  if (!isUserRow(row) || typeof row.content !== "string") return false;
  const safetyAssessment = assessAmoraSafetyText(row.content);
  const hasActiveAffirmedDisclosure = safetyAssessment.events.some((event) =>
    event.context === "disclosure"
    && event.polarity === "affirmed"
    && (event.temporality === "current" || event.temporality === "impending")
  );
  if (
    (
      safetyAssessment.resolution !== "no_safety_signal"
      && safetyAssessment.resolution !== "inconclusive"
    )
    || hasActiveAffirmedDisclosure
  ) {
    return false;
  }
  // 안전 스크린(위)은 그대로다. 바뀐 것은 **범위 목록뿐**이고, 안전 신호가 있는
  // 문장은 범위와 무관하게 여기서 먼저 끊긴다.
  const questionScope = classifyAmoraQuestionScope({ userText: row.content });
  return isTrustedHistoryScope(questionScope.scope);
}

/**
 * 완결된 쌍(사용자 행 + 그 행에 묶인 서버 작성 아모라 행)과 현재 묶인 사용자 행만
 * 고른다.
 *
 * 2026-09-03 이전 주석은 "Every historical ambiguity is intentionally dropped"
 * 였는데, 그 문장대로 동작한 결과가 결함이었다. 결혼 낱말이 없다는 이유만으로
 * (`W4_out_of_scope`) 지워진 턴들이 그 대화의 **사실**이었고, 스테이징 실측에서
 * 아모라가 신랑의 하객 수·장소 변경·그 이유를 한 줄도 못 본 채 중재를 시도했다.
 *
 * 지금 버리는 것은 "모호한 것 전부"가 아니라 **위험한 것과 증명되지 않은 것**이다:
 * - 안전 신호가 있는 사용자 발화(`assessAmoraSafetyText` 스크린, 활성 고백 포함)
 * - W2·W3·W5 로 판정되는 사용자 발화와 아모라 행
 * - 서버가 쓴 것이 증명되지 않거나 원본 사용자 행에 묶이지 않은 아모라 행
 * - 상대(`target: "partner"`) 대상 행, 다른 공개 범위 행, id 가 중복된 행
 * - 짝이 없는 행(사용자·아모라는 언제나 쌍으로만 통과한다)
 *
 * 이 함수는 **읽기 필터이지 벽이 아니다.** 여기를 지난 행이 도구·장기 기억·연결
 * 문맥 자격을 얻지는 않는다. 그 판정은 각자의 신뢰 경계에서 다시 한다.
 */
export function selectAmoraTrustedHistoryRows<T extends AmoraTrustedHistoryRow>({
  oldestFirstRows,
  currentUserMessageId,
  visibility,
}: SelectAmoraTrustedHistoryInput<T>): T[] {
  const idCounts = new Map<string, number>();
  for (const row of oldestFirstRows) {
    if (typeof row.id !== "string") continue;
    idCounts.set(row.id, (idCounts.get(row.id) ?? 0) + 1);
  }
  const currentIndex = oldestFirstRows.findIndex(
    (row) => row.id === currentUserMessageId,
  );
  if (currentIndex < 0 || idCounts.get(currentUserMessageId) !== 1) return [];

  // 서로 다른 요청의 답변은 교차해 저장될 수 있다. 위치가 아니라 서버가 남긴
  // 원본 질문 연결로 짝을 찾되, 현재 질문 이후의 답변이나 복수 후보는 사용하지 않는다.
  const replyIndexes = new Map<string, number | null>();
  for (let index = 0; index < currentIndex; index += 1) {
    const metadata = oldestFirstRows[index].metadata;
    if (!isRecord(metadata) || typeof metadata.in_reply_to_user_message_id !== "string") continue;
    const sourceId = metadata.in_reply_to_user_message_id;
    replyIndexes.set(sourceId, replyIndexes.has(sourceId) ? null : index);
  }

  const trustedIndexes = new Set<number>();
  for (let index = 0; index < currentIndex; index += 1) {
    const userRow = oldestFirstRows[index];
    if (typeof userRow.id !== "string") continue;
    const assistantIndex = replyIndexes.get(userRow.id);
    if (typeof assistantIndex !== "number" || assistantIndex <= index) continue;
    const assistantRow = oldestFirstRows[assistantIndex];
    if (
      !userRow
      || !assistantRow
      || !isSafeWeddingHistoryUser(userRow)
      || typeof userRow.id !== "string"
      || typeof assistantRow.id !== "string"
      || idCounts.get(userRow.id) !== 1
      || idCounts.get(assistantRow.id) !== 1
      || !hasAllowedVisibility(userRow.visibility, visibility)
      || assistantRow.visibility !== userRow.visibility
      || !isServerAuthoredAssistantFor(assistantRow, userRow.id)
    ) {
      continue;
    }
    trustedIndexes.add(index);
    trustedIndexes.add(assistantIndex);
  }

  const currentRow = oldestFirstRows[currentIndex];
  if (
    currentRow
    && isUserRow(currentRow)
    && hasAllowedVisibility(currentRow.visibility, visibility)
  ) {
    trustedIndexes.add(currentIndex);
  }
  // 검증된 쌍만 남기되 실제 발화·응답 순서를 재작성하지 않는다.
  return oldestFirstRows.filter((_, index) => trustedIndexes.has(index));
}
