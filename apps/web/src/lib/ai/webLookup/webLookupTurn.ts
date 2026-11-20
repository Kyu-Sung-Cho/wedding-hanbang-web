import type { AiToolDefinition } from "@/lib/ai/toolDefinition";
import { isAmoraWebLookupAvailable } from "@/lib/ai/webLookup/webLookupConfig";
import { isAmoraWebLookupToolName, SEARCH_WEB_TOOL_NAME } from "@/lib/ai/webLookup/webLookupNames";
import { canonicalWebLookupUrl } from "@/lib/ai/webLookup/webLookupUrlPolicy";
import type { ToolExecutionResult } from "@/types/database.types";

export {
  AMORA_WEB_LOOKUP_TOOL_NAMES,
  isAmoraWebLookupToolName,
  READ_PAGE_TOOL_NAME,
  SEARCH_WEB_TOOL_NAME,
} from "@/lib/ai/webLookup/webLookupNames";

/**
 * 채팅 경로(`app/api/chat/route.ts`)가 찾아보기를 붙이는 자리. 경로에는 부르는 줄만 둔다.
 *
 * 08장 규칙을 경로 쪽에서 지키는 셋:
 *   1. 결혼 핵심 범위(W0)의 저장되는 대화 턴에만 준다. 체험·인사·조율 턴, 범위 밖 턴에는 없다.
 *   2. 바깥 글(검색·읽기 결과)이 들어온 뒤의 걸음에는 찾아보기 도구만 남긴다. 바깥 글이 다른 도구를
 *      부르게 하지 못한다.
 *   3. 바깥 글이 들어온 턴에는 확인 카드(pending_action)를 내지 않는다. 바깥 글이 쓰기를 일으키지
 *      못한다.
 */

/** 한 턴에 검색 두 번, 페이지 읽기 세 번까지. 하루 한도(30회)와 별개다. */
export const MAX_WEB_SEARCHES_PER_TURN = 2;
export const MAX_PAGE_READS_PER_TURN = 3;

export interface AmoraWebLookupTurnState {
  /** 사용자 본인이 친 문장(이번 턴, 그리고 이어 온 앞 턴). 검색어 출처 검사에 쓴다. */
  userTexts: readonly string[];
  /** 사용자가 직접 보낸 주소. `read_page` 가 `url` 로 읽을 수 있는 것은 이것뿐이다. */
  userUrls: Set<string>;
  /** 검색어에서 뺄 커플 이름(약관 일반조건 7.4 ⑦: 이용고객 개인정보를 네이버로 보내지 않는다). */
  blockedTerms: readonly string[];
  /**
   * 이번 턴 검색 결과의 번호표 → 서버가 든 주소. 모델은 네이버 글(주소 포함)을 보지 않으므로
   * `read_page` 에 번호표를 넘기고, 서버가 여기서 주소를 찾는다.
   */
  refs: Map<string, string>;
  searches: number;
  reads: number;
}

const USER_URL_RE = /https?:\/\/[^\s<>"'`)\]}]+/giu;

export function createAmoraWebLookupTurnState(
  userTexts: ReadonlyArray<string | null | undefined>,
  blockedTerms: ReadonlyArray<string | null | undefined> = [],
): AmoraWebLookupTurnState {
  const texts = userTexts.filter((text): text is string => typeof text === "string" && text.trim() !== "");
  const userUrls = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(USER_URL_RE)) {
      const canonical = canonicalWebLookupUrl(match[0].replace(/[.,!?。]+$/u, ""));
      if (canonical) userUrls.add(canonical);
    }
  }
  const names = blockedTerms.filter((term): term is string => typeof term === "string" && term.trim() !== "");
  return { userTexts: texts, userUrls, blockedTerms: names, refs: new Map(), searches: 0, reads: 0 };
}

/** 한 턴의 두 검색이 같은 번호표를 쓰지 않게 앞 글자를 붙인다(첫 검색 a1…, 둘째 b1…). */
export function turnRefPrefix(searchIndex: number): string {
  return String.fromCharCode(0x61 + Math.max(0, Math.min(searchIndex, 25)));
}

export interface AmoraWebLookupTurnPlan {
  /** 이번 턴 모델에게 더하는 도구. 꺼져 있으면 빈 배열이다. */
  tools: AiToolDefinition[];
  /** 실행 상한(질문 범위 천장)에 더할 이름. */
  toolNames: string[];
  /** `executionContext` 에 펼쳐 넣는다. 꺼져 있으면 빈 객체다. */
  executionContext: { webLookup?: AmoraWebLookupTurnState };
}

/**
 * 이 화면이 찾아보기 카드를 그릴 수 있는가. 웹은 헤더를 보내지 않는다(전부 그린다). 앱은 자기가 그릴 수
 * 있는 도구를 `x-hanbang-rendered-tools` 로 알린다.
 *
 * 왜 보나: 모델은 네이버 글을 보지 않으므로 업체 이름은 카드에만 있다. 카드를 못 그리는 옛 앱에 이 도구를
 * 주면 사용자는 "5곳을 찾았어요" 만 보고 이름은 하나도 못 본다. 그런 화면에는 아예 주지 않는다.
 */
export function clientRendersWebLookupCards(renderedToolsHeader: string | null): boolean {
  if (renderedToolsHeader === null) return true;
  return renderedToolsHeader.split(",").map((name) => name.trim()).includes(SEARCH_WEB_TOOL_NAME);
}

export function planAmoraWebLookupTurn(options: {
  tools: readonly AiToolDefinition[];
  questionScope: string;
  requestKind: string;
  isDemo: boolean;
  isDurableUserMessageBound: boolean;
  userTexts: ReadonlyArray<string | null | undefined>;
  /** 검색어에서 뺄 커플 이름. */
  blockedTerms?: ReadonlyArray<string | null | undefined>;
  /** `x-hanbang-rendered-tools` 헤더 값. 없으면 null(웹). */
  renderedToolsHeader: string | null;
  env?: Record<string, string | undefined>;
}): AmoraWebLookupTurnPlan {
  const enabled = isAmoraWebLookupAvailable(options.env)
    && options.questionScope === "W0_wedding_core"
    && options.requestKind === "chat"
    && !options.isDemo
    && options.isDurableUserMessageBound
    && clientRendersWebLookupCards(options.renderedToolsHeader);
  if (!enabled) return { tools: [], toolNames: [], executionContext: {} };
  const tools = options.tools.filter((tool) => isAmoraWebLookupToolName(tool.name));
  return {
    tools,
    toolNames: tools.map((tool) => tool.name),
    executionContext: { webLookup: createAmoraWebLookupTurnState(options.userTexts, options.blockedTerms ?? []) },
  };
}

/** 이번 턴에 바깥 글(찾아보기 결과)이 들어왔는가. 성공한 결과만 센다(실패에는 바깥 글이 없다). */
export function hasWebLookupContent(results: readonly ToolExecutionResult[]): boolean {
  return results.some((result) => isAmoraWebLookupToolName(result.toolName) && result.success);
}

/** 바깥 글이 들어온 뒤의 걸음에 줄 도구. 찾아보기 도구만 남긴다. */
export function toolsAfterWebLookupContent<T extends { name: string }>(tools: readonly T[], contentRead: boolean): T[] {
  return contentRead ? tools.filter((tool) => isAmoraWebLookupToolName(tool.name)) : [...tools];
}

/** 바깥 글이 들어온 뒤에 찾아보기가 아닌 도구 호출이 오면 막는다. */
export function blocksToolAfterWebLookupContent(toolName: string, contentRead: boolean): boolean {
  return contentRead && !isAmoraWebLookupToolName(toolName);
}
