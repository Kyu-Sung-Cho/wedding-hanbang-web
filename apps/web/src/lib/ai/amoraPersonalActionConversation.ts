import { parsePersonalActionDraftMetadata } from "@hanbang/shared/amora-personal-actions";
import type { AmoraQuestionScopeClassification } from "./amoraQuestionScope";
import type { AiToolDefinition } from "./toolDefinition";
import type { ToolExecutionResult } from "@/types/database.types";
import { normalizeAmoraSafetyText } from "./amoraCrisisSafety";

export const PERSONAL_ACTION_READ_TOOL = "get_personal_actions";
export const PERSONAL_ACTION_DRAFT_TOOL = "prepare_personal_action";
export type PersonalActionStatus = "all" | "open" | "done";
export type PersonalActionConversationConsent = { read: boolean; draft: boolean };

export const PERSONAL_ACTION_CONVERSATION_TOOLS: AiToolDefinition[] = [
  {
    name: PERSONAL_ACTION_READ_TOOL,
    description: "현재 커플의 본인 개인 대화에서 담은 할 일 건수와 개인 목록 바로가기를 확인합니다. 제목·본문은 읽지 않습니다. 개인 목록에는 이전 준비 공간의 본인 항목도 있어 전체 건수와 다를 수 있습니다. 본인이 선택한 현재 항목만 이어서 상담합니다.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["all", "open", "done"] } }, required: ["status"], additionalProperties: false },
  },
  {
    name: PERSONAL_ACTION_DRAFT_TOOL,
    description: "개인 할 일 저장 요청을 제목·내용·마감일 확인 초안으로 만듭니다. 저장하지 않습니다. 요청에 없는 날짜나 사실을 만들지 말고, 사용자가 답변 아래 확인창에서 저장해야 반영됩니다.",
    input_schema: { type: "object", properties: {
      title: { type: "string", minLength: 1, maxLength: 120 },
      description: { type: ["string", "null"], maxLength: 500 },
      dueDate: { type: ["string", "null"], description: "명시된 마감일 YYYY-MM-DD, 미정이면 null" },
    }, required: ["title", "description", "dueDate"], additionalProperties: false },
  },
];

export function personalActionConversationConsent(text: string): PersonalActionConversationConsent {
  // 현재 사용자 요청만 동의로 본다. 과거 대화·모델 주장·도구 인수는 동의가 아니다.
  const personal = /(?:내|제|나의|저의|개인|나만(?:의|\s*볼|\s*보는)?|저만(?:의|\s*볼|\s*보는)?)\s*(?:개인\s*)?할\s*일/u.test(text);
  const refused = /(?:보여|조회|읽|저장|추가|담|등록|만들|확인)[^.!?\n]{0,12}(?:지\s*마|말아|마세요|말고|않아)|(?:조회|저장|추가|등록)\s*(?:금지|취소)/u.test(text)
    || /(?:내|제|나의|저의|개인|나만(?:의|\s*볼|\s*보는)?|저만(?:의|\s*볼|\s*보는)?)\s*(?:개인\s*)?할\s*일(?:은|는|을|를)?\s*(?:말고|제외|빼고|그대로\s*두고)/u.test(text)
    || [...text.matchAll(/(?:친구|상대방|상대|파트너|공유|공동)(?:의)?\s*(?:개인\s*)?할\s*일/gu)]
      .some(match => !/^(?:은|는|을|를)?\s*(?:말고|제외|빼고)/u.test(text.slice(match.index + match[0].length)));
  if (!personal || refused) return { read: false, draft: false };
  // '추가된 걸로 기억하면 안 돼' 같은 상태 설명은 새 초안 요청이 아니다.
  // 기존 일상 요청형은 유지한다. 과거 실행을 말할 때만 별도의 현재 부탁이 필요하다.
  const reportsPriorAction = /(?:저장|추가|등록)(?:이|가|은|는)?\s*(?:안\s*)?(?:된|됐|되었|되지|한|했|하지\s*않|해\s*둔|해\s*놓)/u.test(text);
  const asksAgain = /(?:저장|추가|등록|작성|준비)(?:을|를)?\s*(?:좀\s*)?(?:해\s*(?:줘|주|줄|요)|하자|부탁|요청)|(?:담아|만들어)\s*(?:좀\s*)?(?:줘|주|줄)|초안(?:을|도|만)?\s*(?:줘|주|줄|부탁)/u.test(text)
    || /(?:저장|추가|등록|초안|저장해|추가해|등록해|담아|만들어)\s*[.!。]?$/u.test(text.trim());
  // '저장한 다음 목록 보여줘'는 순서가 있는 부탁이며 과거 실패 보고와 구분한다.
  const asksInSequence = /(?:저장|추가|등록)한\s*(?:다음|뒤|후)(?:에)?\s*(?:(?:목록|결과)(?:을|를|도)?\s*)?(?:보여|읽어|확인해|알려)/u.test(text);
  const draftRequest = /저장|추가|담아|등록|초안|만들어/u.test(text) && (!reportsPriorAction || asksAgain || asksInSequence);
  return {
    read: /보여|조회|목록|확인해|읽어|뭐가|남았|몇\s*개/u.test(text),
    draft: draftRequest,
  };
}

function isExplicitNormalizedPersonalDraftRequest(normalizedText: string): boolean {
  const requestText = normalizedText
    .replace(/"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’|`[^`]*`/gu, "")
    .replace(/^\s*>.*$/gmu, "");
  return !/(?:`{3,}|~{3,})/u.test(normalizedText)
    && personalActionConversationConsent(requestText).draft
    && /(?:내|제|나의|저의|개인|나만(?:의|\s*볼|\s*보는)?|저만(?:의|\s*볼|\s*보는)?)\s*(?:개인\s*)?할\s*일(?:로\s*(?:담을|저장할))?\s*초안[^.!?\n]{0,20}(?:(?:만들어|준비해|작성해|보여)\s*(?:줘|주세요|줄래(?:요)?|주실래(?:요)?)|줘|주세요|부탁해(?:요)?|부탁드립니다)\s*(?:[.!?\n]|$)/u.test(requestText);
}

/** 현재 본인 초안의 직접 부탁만 인정한다. 인용과 다른 과업을 결합하지 않는다. */
export function hasExplicitPersonalActionDraftRequest(text: string): boolean {
  return isExplicitNormalizedPersonalDraftRequest(normalizeAmoraSafetyText(text));
}

export function getPersonalActionDraftToolChoice(input: {
  userText: string; round: number; tools: readonly AiToolDefinition[];
}): { type: "function"; name: typeof PERSONAL_ACTION_DRAFT_TOOL } | undefined {
  if (input.round !== 0
    || !input.tools.some(tool => tool.name === PERSONAL_ACTION_DRAFT_TOOL)) return undefined;
  const normalizedText = normalizeAmoraSafetyText(input.userText);
  if (!isExplicitNormalizedPersonalDraftRequest(normalizedText)) return undefined;
  // 제목이 없는 요청은 질문할 수 있어야 한다. 아래 값은 호출 자격만 확인하며
  // 도구 인수나 저장 값으로 만들지 않는다. 실제 초안은 기존 schema로 검증한다.
  const titleAssignment = normalizedText.match(
    /(?:^|[.!?\n])\s*제목(?:은|을)\s*(?:"([^"\n]{1,120})"|'([^'\n]{1,120})'|“([^”\n]{1,120})”|‘([^’\n]{1,120})’)\s*(?:으)?로\s*해\s*(?:줘|주세요)\s*(?:[.!](?![?!])|$)/u,
  );
  if (!titleAssignment?.slice(1).some(title => title?.trim())
    || titleAssignment.index === undefined) return undefined;
  const titleStart = titleAssignment.index + titleAssignment[0].indexOf("제목");
  for (const quote of normalizedText.matchAll(/"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’|`[^`]*`/gu)) {
    if (quote.index < titleStart && titleStart < quote.index + quote[0].length) return undefined;
  }
  const lineStart = normalizedText.lastIndexOf("\n", titleStart) + 1;
  if (normalizedText.slice(lineStart, titleStart).trimStart().startsWith(">")) return undefined;
  // 바로 앞의 개인 초안 부탁에 붙은 제목만 쓴다. 다른 과업의 제목이면 auto다.
  const beforeTitle = normalizedText.slice(0, titleStart).trimEnd().replace(/[.!?]$/u, "");
  const requestStart = Math.max(...[".", "!", "?", "\n"].map(mark => beforeTitle.lastIndexOf(mark))) + 1;
  if (!isExplicitNormalizedPersonalDraftRequest(beforeTitle.slice(requestStart))) return undefined;
  return { type: "function", name: PERSONAL_ACTION_DRAFT_TOOL };
}

export function selectPersonalActionConversationTools(input: {
  tools: readonly AiToolDefinition[]; userText: string; visibility: string;
  requestKind: string; durable: boolean; scope: AmoraQuestionScopeClassification;
}): AiToolDefinition[] {
  if (!input.durable || input.requestKind !== "chat"
    || !["bride_private", "groom_private"].includes(input.visibility)) return [];
  const scope = input.scope;
  if (scope.scope !== "W0_wedding_core" && scope.scope !== "W1_wedding_adjacent") return [];
  const consent = personalActionConversationConsent(input.userText);
  return input.tools.filter(tool => (tool.name === PERSONAL_ACTION_READ_TOOL && consent.read)
    || (tool.name === PERSONAL_ACTION_DRAFT_TOOL && consent.draft));
}

export function personalActionConversationMetadata(results: readonly ToolExecutionResult[], allowedNames: ReadonlySet<string>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const result of results) {
    if (!result.success || !allowedNames.has(result.toolName)) continue;
    if (result.toolName === PERSONAL_ACTION_DRAFT_TOOL && result.toolOutput.saved === false) {
      const value = result.toolOutput.draft;
      if (value && typeof value === "object" && !Array.isArray(value)
        && Object.keys(value).length === 3 && ["title", "description", "dueDate"].every(key => key in value)) {
        const draft = parsePersonalActionDraftMetadata(value);
        if (draft) metadata.personal_action_draft = draft;
      }
    }
    if (result.toolName === PERSONAL_ACTION_READ_TOOL
      && ["all", "open", "done"].includes(String(result.toolOutput.status))) {
      // 조회 당시 개수도 이력에 재사용하지 않는다. 목록은 열 때마다 다시 읽는다.
      metadata.personal_actions_view = { status: result.toolOutput.status };
    }
  }
  return metadata;
}
