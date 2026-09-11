const SCHEDULE_WRITE_TOOLS = new Set(["add_schedule_event", "update_schedule_event"]);
const UNSUPPORTED_FIELDS = new Set(["assignee", "assignee_confirmation", "completion_criteria", "completionCriteria"]);

const MANUAL_SCHEDULE_FIELDS_PATH = "일정 화면에서 ‘일정 추가’를 누르거나 기존 일정을 선택해 수정한 뒤, ‘담당’과 ‘완료 기준’ 입력칸에서 직접 설정해 주세요. 담당 표시는 상대방의 수락을 대신하지 않아요.";
export const SCHEDULE_FIELDS_CAPABILITY_NOTICE = `일정의 담당자와 완료 기준은 아직 아모라에서 설정할 수 없어요. ${MANUAL_SCHEDULE_FIELDS_PATH} 이번 답변으로 일정은 생성하거나 변경하지 않았어요.`;
export const UNSUPPORTED_SCHEDULE_FIELDS_NOTICE = `일정의 담당자와 완료 기준은 아직 아모라에서 설정할 수 없어요. 이 조건을 생략한 확인 카드는 만들지 않았고, 일정도 변경하지 않았어요. ${MANUAL_SCHEDULE_FIELDS_PATH}`;

/** 아직 저장 경로에 없는 의미 있는 필드만 구분한다. 다른 미선언 키의 보정은 유지한다. */
export function hasUnsupportedScheduleFields(tool: string, input: Record<string, unknown>): boolean {
  return SCHEDULE_WRITE_TOOLS.has(tool) && Object.keys(input).some(key => UNSUPPORTED_FIELDS.has(key));
}

function containsUnsupportedProposal(modelText: string): boolean {
  if (modelText.length > 40_000) return false;
  for (const match of modelText.matchAll(/\[pending_action\]([\s\S]*?)\[\/pending_action\]/g)) {
    if (match[1].length > 4_000) continue;
    try {
      const value: unknown = JSON.parse(match[1]);
      if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
      const marker = value as Record<string, unknown>;
      if (typeof marker.tool === "string" && marker.input !== null
        && typeof marker.input === "object" && !Array.isArray(marker.input)
        && hasUnsupportedScheduleFields(marker.tool, marker.input as Record<string, unknown>)) return true;
    } catch { /* 잘못된 표식은 기존 표식 검증기가 거절한다. */ }
  }
  return false;
}

const CHANGE_REQUEST = /(?:(?:추가|등록|저장|수정|변경|설정|반영|기록|지정|배정|삭제|제거)(?:해\s*(?:줘|주세요|주고|주실|줄래|라)|하자|해주세요)|(?:바꿔|고쳐|정해|잡아|옮겨|넣어|맡겨|지워)\s*(?:줘|주세요|주고|줄래))(?=$|[\s,.!?。])/u;
const FIELD_DIRECTIVE = /(?:담당자?|완료\s*기준)(?:은|는|을|를|(?:으)?로|[:：])\s*([^,;。.!?\r\n]*)/gu;
const LEAVE_FIELD_UNCHANGED = /^(?:정하지|설정하지|지정하지|바꾸지|변경하지|건드리지)\s*(?:말|마)|^(?:기존(?:대로|처럼)|그대로)(?:\s*(?:유지|두|놔))|^(?:누구|뭐|무엇|어떻게|어떤)/u;
const WHOLE_SCHEDULE_REMOVAL = /(?:일정|스케줄|캘린더)(?:을|를|은|는)?\s*(?:(?:삭제|제거)해\s*(?:줘|주세요|줄래)|지워\s*(?:줘|주세요|줄래))(?=$|[\s,.!?。])/gu;
const EXISTING_FIELD_DESCRIPTION = /(?:이야|이었어|였어|이에요|예요|이었어요|였어요)$/u;
const SCHEDULE_TOPIC = /(?:일정|스케줄|캘린더)/u;
const FIELD_TOPIC = /(?:담당자?|완료\s*기준)/u;
const CAPABILITY_QUERY = /(?:아모라(?:에서|로)?\s*할\s*수|(?:설정|입력|저장|기록|추가)할\s*수|넣을\s*수|지원(?:하|되|해)|가능(?:한지|한가|해))/u;
const CAPABILITY_REQUEST = /(?:알려\s*(?:줘|주세요)|확인해\s*(?:줘|주세요)|궁금(?:해|합니다)|[?？]|가능(?:해|한가)(?:요)?[.!]?\s*$)/u;
const HYPOTHETICAL_CAPABILITY = /(?:수\s*(?:있|없)(?:다면|으면)|가능하다면|지원한다면|가정)/u;
const UNSUPPORTED_UI_FOLLOWUP = /(?:못\s*(?:넣|저장|설정|입력)|(?:넣|저장|설정|입력)지\s*못|지원하지\s*않)/u;
const UI_LOCATION_QUERY = /(?:(?:어느|어떤)\s*(?:화면|메뉴)|어디(?:에서|서)?[^.!?。\r\n]{0,30}(?:확인|입력|설정)|(?:화면|메뉴)[^.!?。\r\n]{0,20}어디)/u;
const withoutQuotedData = (text: string) => text.normalize("NFKC")
  .replace(/"[^"\r\n]*"|'[^'\r\n]*'|“[^”\r\n]*”|‘[^’\r\n]*’|「[^」\r\n]*」|『[^』\r\n]*』|`[^`\r\n]*`/gu, "인용문");

function asksAboutUnsupportedCapability(text: string, previousUserText: string): boolean {
  if (!/아모라/u.test(text) || !CAPABILITY_REQUEST.test(text)
    || CHANGE_REQUEST.test(text) || HYPOTHETICAL_CAPABILITY.test(text)) return false;
  if (SCHEDULE_TOPIC.test(text) && FIELD_TOPIC.test(text) && CAPABILITY_QUERY.test(text)) return true;
  // 생략된 조건은 현재의 명시적 후속 화면 문의에서만, 같은 대화의 직전 사용자 원문으로 확인한다.
  if (!UNSUPPORTED_UI_FOLLOWUP.test(text) || !/(?:조건|항목|부분)/u.test(text) || !UI_LOCATION_QUERY.test(text)
    || previousUserText.length > 10_000) return false;
  const prior = withoutQuotedData(previousUserText);
  return SCHEDULE_TOPIC.test(prior) && FIELD_TOPIC.test(prior) && !HYPOTHETICAL_CAPABILITY.test(prior);
}

/** 새 일정 변경에 명시한 미지원 조건만 막는다. 상담·조회·인용을 저장 요청으로 승격하지 않는다. */
export function getUnsupportedScheduleFieldsReply(userText: string, modelText = "", previousUserText = ""): string | null {
  if (userText.length > 10_000) return null;
  // 제목·메모에 따옴표로 적은 내용은 데이터다. 닫히지 않은 인용은 조건을 숨기지 않는다.
  const text = withoutQuotedData(userText);
  if (asksAboutUnsupportedCapability(text, previousUserText)) return SCHEDULE_FIELDS_CAPABILITY_NOTICE;
  if (!SCHEDULE_TOPIC.test(text) || !CHANGE_REQUEST.test(text)) return null;
  if (containsUnsupportedProposal(modelText)) return UNSUPPORTED_SCHEDULE_FIELDS_NOTICE;
  // 일정 자체 삭제에 붙인 기존 담당 설명은 새 필드 설정이 아니다. 다른 변경절은 남긴다.
  const withoutWholeRemoval = text.replace(WHOLE_SCHEDULE_REMOVAL, "일정 삭제 요청");
  const onlyWholeRemoval = withoutWholeRemoval !== text && !CHANGE_REQUEST.test(withoutWholeRemoval);
  for (const match of text.matchAll(FIELD_DIRECTIVE)) {
    if (onlyWholeRemoval && EXISTING_FIELD_DESCRIPTION.test(match[1].trim())) continue;
    if (match[1].trim() && !LEAVE_FIELD_UNCHANGED.test(match[1].trim())) return UNSUPPORTED_SCHEDULE_FIELDS_NOTICE;
  }
  return null;
}
