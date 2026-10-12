import { AMORA_MAX_QUEUED_ACTIONS, type AmoraQueuedAction } from "./amoraPendingAction";
import { isValidScheduleYmd } from "@/utils/scheduleEvents";

const COUNTS: Record<string, number> = { 한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 };
const DATE = "(?:[0-9]{4}년[ \\t]*[0-9]{1,2}월[ \\t]*[0-9]{1,2}일|[0-9]{4}-[0-9]{2}-[0-9]{2})";
const COUNT = "([0-9]{1,2}|한|하나|두|둘|세|셋|네|넷|다섯|여섯|일곱|여덟|아홉|열)";
const ROW = new RegExp(`^([0-9]{1,2})[).]\\s*제목은 ([^\\r\\n]+?),\\s*설명은 ([^\\r\\n]+?),\\s*예정일은 (${DATE})[.。]`);
// 라벨 행은 끝까지 소비해야 마감 뒤의 추가 조건을 버리지 않는다.
const LABELED_ROW = new RegExp(`^([0-9]{1,2})[).][ \\t]*제목[ \\t]*[:：][ \\t]*([^\\r\\n]+?)[ \\t]*/[ \\t]*(?:내용|설명)[ \\t]*[:：][ \\t]*([^\\r\\n]+?)[ \\t]*/[ \\t]*(?:마감|예정일)[ \\t]*[:：][ \\t]*(${DATE})[.。]?[ \\t]*(?:\\r?\\n|$)`);
const ENDING = /^(?:(?:둘 다|모두|전부) 아직 하지 않은 일이야[.。]\s*)?(?:담당자는 정하지 말고 )?저장 전 확인 카드를 보여(?:줘|주세요)[.。]?$/;
const STRUCTURED_REQUEST = /^(?:(?:함께 보는|공유) 할 일(?:에)?\s+\S{1,20}\s*(?:개를|건을)\s*추가해(?:줘|주세요)|(?:아래\s+)?\S{1,20}\s*(?:개를|건을)\s+(?:함께 보는|공유) 할 일에\s*추가해(?:줘|주세요))/;
const PREFIX = new RegExp(`^(?:(?:함께 보는|공유) 할 일(?:에)?\\s+${COUNT}\\s*(?:개를|건을) 추가해(?:줘|주세요)|(?:아래\\s+)?${COUNT}\\s*(?:개를|건을) (?:함께 보는|공유) 할 일에 추가해(?:줘|주세요))[.。]\\s*`);
// 확인 후 저장하겠다는 완결 문장만 허용한다. 임의 서두를 통째로 걷어내지 않는다.
const CONFIRMATION_PREFACE = /^아직 완료하지 않았고,\s*하나씩 내용을 확인하고 저장할게[.。]\s*/;
const DEADLINE_REQUEST = new RegExp(
  `(?:${DATE}|[0-9]{1,2}월[ \\t]*[0-9]{1,2}일)\\s*까지[^,;。.!?\\r\\n]{0,40}(?:끝내|완료해|마쳐|마무리해|처리해|해(?:줘|주세요))`,
  "u",
);

export type ExplicitTaskRequestAssessment =
  | { kind: "ready"; actions: AmoraQueuedAction[] }
  | { kind: "needs_clarification"; text: string };

export function assessExplicitTaskRequest(text: string, modelText = ""): ExplicitTaskRequestAssessment | null {
  if (!STRUCTURED_REQUEST.test(text.trim())) return assessSingleLabeledTask(text, modelText);
  const actions = parseSupportedTaskList(text, modelText);
  return actions ? { kind: "ready", actions } : {
    kind: "needs_clarification",
    text: "할 일 목록의 항목·날짜와 담당·공유·추가 여부 조건을 함께 확정하지 못했어요. 조건을 생략한 확인 카드는 만들지 않았어요. 항목별 내용을 다시 확인해주세요.",
  };
}

/** 사용자가 필드를 직접 쓴 단일 항목은 날짜를 만들어 내지 않고 같은 승인 큐로 보낸다. */
function assessSingleLabeledTask(text: string, modelText: string): ExplicitTaskRequestAssessment | null {
  const quote = /"[^"\r\n]*"|“[^”\r\n]*”|‘[^’\r\n]*’|'[^'\r\n]*'/gu;
  const unquoted = text.replace(quote, "인용값");
  if (!/(?:공유|함께\s*보는)\s*할\s*일/u.test(unquoted)
    || !/제목(?:은|[:：])/u.test(unquoted)
    || !/(?:추가|등록|저장|제안|미리보기|확인\s*카드)/u.test(unquoted)
    || /^\s*(?:예시|가정|친구|회사|업무|["“‘'])/u.test(text)) return null;
  const clarify: ExplicitTaskRequestAssessment = { kind: "needs_clarification", text: "할 일의 제목·설명과 공유·날짜 조건을 함께 확인하지 못했어요. 조건을 생략해서 저장하지 않았어요. 한 항목의 내용을 다시 확인해주세요." };
  if (text.length > 10000 || modelText.length > 40000 || /[\p{Cf}\p{Zl}\p{Zp}]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) return clarify;
  const labeled = (label: string) => [...text.matchAll(new RegExp(`(?:${label})(?:은|는|[:：])\\s*("[^"\\r\\n]*"|“[^”\\r\\n]*”|‘[^’\\r\\n]*’|'[^'\\r\\n]*')`, "gu"))];
  const titles = labeled("제목"), descriptions = labeled("설명|내용");
  if (titles.length !== 1 || descriptions.length > 1) return clarify;
  const title = titles[0][1].slice(1, -1).trim();
  const description = descriptions[0]?.[1].slice(1, -1).trim();
  if (!title || title.length > 120 || (description !== undefined && (!description || description.length > 500))) return clarify;
  // 원문의 남은 절 전체를 읽는다. 담당·시각·취소·추가 조건을 버린 부분 카드는 발급하지 않는다.
  let rest = text.trim().replace(/^\[합성[^\]\r\n]{0,40}QA\]\s*/u, "");
  rest = rest.replace(titles[0][0], "TITLE");
  if (descriptions[0]) rest = rest.replace(descriptions[0][0], "DESCRIPTION");
  const clauses = rest.split(/[,.。!?\r\n]/u).map(part => part.trim()).filter(Boolean);
  const allowed = [
    /^(?:우리\s*(?:결혼\s*준비\s*)?)?(?:공유|함께\s*보는)\s*할\s*일에\s*추가할\s*항목의\s*확인\s*카드를\s*보여(?:줘|주세요)$/u,
    /^TITLE$/u,
    /^DESCRIPTION$/u,
    /^DESCRIPTION인\s*(?:공유|함께\s*보는)\s*할\s*일\s*하나를\s*제안해(?:줘|주세요)$/u,
    /^(?:우리\s*(?:결혼\s*준비\s*)?)?(?:공유|함께\s*보는)\s*할\s*일에\s*TITLE(?:을|를)?\s*(?:추가|등록|저장)해(?:줘|주세요)$/u,
    /^(?:상태(?:는)?\s*)?미완료(?:\s*상태)?$/u,
    /^(?:날짜와\s*업체|날짜|예정일)(?:는)?\s*없음(?:이야|이에요)?$/u,
    /^날짜와\s*업체는\s*넣지\s*말고$/u,
    /^먼저\s*저장할\s*문구와\s*상태의\s*미리보기만\s*보여(?:줘|주세요)$/u,
    /^(?:내가\s*)?승인하기\s*전에는\s*저장하지\s*마$/u,
    /^기존\s*(?:다른\s*)?항목은\s*바꾸지\s*말고\s*아직\s*저장하지\s*마$/u,
    /^기존\s*(?:다른\s*)?항목은\s*바꾸지\s*마$/u,
    /^이\s*시험\s*항목\s*하나만\s*실제\s*추가하는\s*데\s*동의하며\s*기존\s*항목은\s*바꾸지\s*마$/u,
  ];
  if (!clauses.length || clauses.some(clause => !allowed.some(pattern => pattern.test(clause)))) return clarify;
  const input = { title, ...(description !== undefined ? { description } : {}) };
  // 모델 표식이 다른 항목·추가 조건을 주장했다면 이를 조용히 버리지 않는다.
  let invalidModel = false;
  let modelTagCount = 0;
  const remainder = modelText.replace(/\[pending_action\]([\s\S]*?)\[\/pending_action\]/gu, (_tag, payload: string) => {
    modelTagCount += 1;
    try {
      const value: unknown = JSON.parse(payload);
      if (!record(value) || Object.keys(value).sort().join(",") !== "input,tool"
        || value.tool !== "add_amora_action" || !record(value.input)
        || Object.keys(value.input).sort().join(",") !== Object.keys(input).sort().join(",")
        || value.input.title !== title || value.input.description !== description) invalidModel = true;
    } catch { invalidModel = true; }
    return "";
  });
  if (invalidModel || modelTagCount > 1 || /pending[\s_-]*action|"(?:tool|input)"\s*:/iu.test(remainder)) return clarify;
  return { kind: "ready", actions: [{ tool: "add_amora_action", input }] };
}

/** 기존 호출자는 ready 목록만 받는다. route는 assessment로 거절과 무관한 요청을 구분한다. */
export function parseExplicitTaskRequest(text: string, modelText = ""): AmoraQueuedAction[] | null {
  const assessment = assessExplicitTaskRequest(text, modelText);
  return assessment?.kind === "ready" ? assessment.actions : null;
}

function hasUnsupportedTaskDirective(value: string): boolean {
  // 완결된 인용은 할 일의 원문 데이터다. 인용 밖의 실제 지시만 검사한다.
  // 닫히지 않은 따옴표는 제거하지 않으므로 뒤의 조건을 숨길 수 없다.
  const unquoted = value.replace(/"[^"\r\n]*"|'[^'\r\n]*'|“[^”\r\n]*”|‘[^’\r\n]*’|「[^」\r\n]*」|『[^』\r\n]*』/gu, " ");
  if (/(?:제목|설명|내용|예정일|담당자?|우선순위|카테고리|마감(?:일)?|기한|시각|시간)(?:은|는|[:：])/u.test(unquoted)
    || DEADLINE_REQUEST.test(unquoted)
    || /담당자?(?:를|을)\s*.{0,60}(?:(?:지정|배정)해|정해(?:줘|주세요)|맡겨(?:줘|주세요))/u.test(unquoted)
    || /개인\s*(?:상담|할\s*일)|나만\s*(?:보|의)|비공개로|상대(?:방)?(?:에게|한테|는)?.{0,30}(?:숨겨|숨기|안\s*보이|보여주지|보이게\s*하지)/u.test(unquoted)
    || /(?:확인|승인|저장)\s*카드(?:도|는|를|은|을)?\s*(?:만들지|보여주지|내지|띄우지)\s*(?:마|말)/u.test(unquoted)
    || /(?:이|해당|이번|방금)\s*(?:할\s*일|요청|내용|기록|카드).{0,30}(?:저장|추가|등록|수정|반영|적용)(?:은|는|도)?\s*(?:하지\s*(?:마|말|않)|하면\s*안|해서는?\s*안)/u.test(unquoted)
    || /(?:이|해당|이번|방금)\s*(?:할\s*일|요청|내용|기록|카드)(?:은|는|을|를)?\s*(?:취소|제외|보류)해/u.test(unquoted)
    || /(?:오전|오후)?\s*\d{1,2}\s*시(?=\s|$|반|까지|에|부터|\d{1,2}\s*분)|(?:[01]?\d|2[0-3]):[0-5]\d/u.test(unquoted)) return true;
  // "누락하지 말고 식대 확인"·"불필요한 항목은 추가하지 말고 확인"은
  // 작업 내용이다. 별도 절의 저장 금지나 현재 할 일 자체의 취소와 구분한다.
  return unquoted.split(/[,;\/。.!?\r\n]/u).some(part => /^(?:(?:실제로|지금은|아직)\s*)?(?:저장|추가|등록|수정|반영|적용)(?:은|는|도)?\s*(?:하지\s*(?:마|말|않)|하면\s*안|해서는?\s*안|금지)/u.test(part.trim()));
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 필드가 명시된 현재 공유 할 일 목록만 복구한다. 추정·조건 생략 없이 기존 승인 큐로 보낸다. */
function parseSupportedTaskList(text: string, modelText: string): AmoraQueuedAction[] | null {
  if (text.length > 10000 || /[\p{Cf}\p{Zl}\p{Zp}]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) return null;
  const prefix = PREFIX.exec(text.trim());
  if (!prefix) return null;
  const countText = prefix[1] ?? prefix[2];
  const count = COUNTS[countText] ?? Number(countText);
  if (!Number.isInteger(count) || count < 1 || count > AMORA_MAX_QUEUED_ACTIONS) return null;
  let rest = text.trim().slice(prefix[0].length).trim();
  rest = rest.replace(CONFIRMATION_PREFACE, "").trim();
  const actions: AmoraQueuedAction[] = [];
  const keys = new Set<string>();
  for (let index = 1; index <= count; index += 1) {
    const row = ROW.exec(rest) ?? LABELED_ROW.exec(rest);
    if (!row || Number(row[1]) !== index) return null;
    const title = row[2].trim();
    const description = row[3].trim();
    const korean = /^([0-9]{4})년[ \t]*([0-9]{1,2})월[ \t]*([0-9]{1,2})일$/.exec(row[4]);
    const due_date = korean ? `${korean[1]}-${korean[2].padStart(2, "0")}-${korean[3].padStart(2, "0")}` : row[4];
    // 추가 필드·명령처럼 보이는 문구를 제목/설명 안으로 삼켜 버리지 않는다.
    if (!title || title.length > 120 || !description || description.length > 500
      || /[\[\]{}<>]/u.test(`${title}\n${description}`)
      || hasUnsupportedTaskDirective(title) || hasUnsupportedTaskDirective(description)
      || !isValidScheduleYmd(due_date)) return null;
    const input = { title, description, due_date };
    const key = JSON.stringify(input);
    if (keys.has(key)) return null;
    keys.add(key);
    actions.push({ tool: "add_amora_action", input });
    rest = rest.slice(row[0].length).trim();
  }
  if ((rest && !ENDING.test(rest)) || (rest.startsWith("둘 다") && count !== 2)) return null;
  // 모델이 더 많은 조건을 담았다면 여기서 조용히 버리지 않는다. 원문과 같은 일부
  // 표식만 복구 가능하며 그 외에는 기존 표식 검증과 정직한 실패 안내에 맡긴다.
  if (modelText.length > 40000) return null;
  const seen = new Set<string>();
  let invalid = false;
  const remainder = modelText.replace(/\[pending_action\]([\s\S]*?)\[\/pending_action\]/g, (_match, payload: string) => {
    try {
      const value: unknown = JSON.parse(payload);
      if (!record(value) || Object.keys(value).sort().join(",") !== "input,tool"
        || value.tool !== "add_amora_action" || !record(value.input)
        || Object.keys(value.input).sort().join(",") !== "description,due_date,title") invalid = true;
      else {
        const key = JSON.stringify({ title: value.input.title, description: value.input.description, due_date: value.input.due_date });
        if (!keys.has(key) || seen.has(key)) invalid = true;
        seen.add(key);
      }
    } catch { invalid = true; }
    return "";
  });
  if (invalid || /pending[\s_-]*action|"(?:tool|input)"\s*:/i.test(remainder)) return null;
  return actions;
}
