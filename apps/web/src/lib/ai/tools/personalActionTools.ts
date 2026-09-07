import { parsePersonalActionDraftMetadata } from "@hanbang/shared/amora-personal-actions";
import { PERSONAL_ACTION_DRAFT_TOOL, PERSONAL_ACTION_READ_TOOL, personalActionConversationConsent, type PersonalActionStatus } from "../amoraPersonalActionConversation";
import type { ToolExecutionContext } from "./toolTypes";
import type { ToolExecutionResult } from "@/types/database.types";

export async function executePersonalActionConversationTool(name: string, input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const fail = (code: string): ToolExecutionResult => ({ toolName: name, toolInput: {}, success: false,
    toolOutput: { success: false, error_code: code }, displayMessage: "개인 할 일을 확인하지 못했어요. 개인 대화에서 다시 요청해 주세요." });
  const capability = context.personalActions;
  if (!context.actorProfileId || !capability || !["bride_private", "groom_private"].includes(capability.visibility)) return fail("PERSONAL_ACTION_SCOPE_REQUIRED");
  const consent = personalActionConversationConsent(context.currentUserText ?? "");
  if (name === PERSONAL_ACTION_DRAFT_TOOL) {
    if (!consent.draft) return fail("PERSONAL_ACTION_CONSENT_REQUIRED");
    if (Object.keys(input).length !== 3 || !["title", "description", "dueDate"].every(key => key in input)) return fail("INVALID_PERSONAL_ACTION_DRAFT");
    const draft = parsePersonalActionDraftMetadata(input);
    if (!draft) return fail("INVALID_PERSONAL_ACTION_DRAFT");
    return { toolName: name, toolInput: {}, success: true, toolOutput: { saved: false, requires_confirmation: true, draft }, displayMessage: "개인 할 일 초안이에요. 내용을 확인한 뒤 저장해 주세요." };
  }
  if (name !== PERSONAL_ACTION_READ_TOOL || !consent.read) return fail("PERSONAL_ACTION_CONSENT_REQUIRED");
  if (Object.keys(input).length !== 1 || !["all", "open", "done"].includes(String(input.status))) return fail("INVALID_PERSONAL_ACTION_FILTER");
  try {
    const count = await capability.readCount(input.status as PersonalActionStatus);
    if (!Number.isSafeInteger(count) || count < 0 || count > 300) return fail("PERSONAL_ACTION_READ_UNAVAILABLE");
    return { toolName: name, toolInput: {}, success: true,
      toolOutput: { success: true, status: input.status, count, scope: "current_couple_private_sources", contents_read: false, href: "/chat/personal" },
      displayMessage: "현재 커플의 개인 대화에서 담은 할 일 개수를 확인했어요. 내 개인 목록에는 이전 항목도 있을 수 있어요." };
  } catch { return fail("PERSONAL_ACTION_READ_UNAVAILABLE"); }
}
