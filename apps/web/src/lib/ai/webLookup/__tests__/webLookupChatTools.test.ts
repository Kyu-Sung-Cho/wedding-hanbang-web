// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const lookup = vi.hoisted(() => ({
  searchWeb: vi.fn(),
  readPage: vi.fn(),
}));
vi.mock("@/lib/ai/webLookup/amoraWebLookup", () => lookup);

import { executeReadPageTool, executeSearchWebTool, AMORA_WEB_LOOKUP_TOOLS } from "@/lib/ai/tools/webLookupTools";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import {
  blocksToolAfterWebLookupContent,
  clientRendersWebLookupCards,
  createAmoraWebLookupTurnState,
  hasWebLookupContent,
  planAmoraWebLookupTurn,
  toolsAfterWebLookupContent,
} from "@/lib/ai/webLookup/webLookupTurn";

/**
 * 채팅 경로가 찾아보기를 언제 주는지, 도구가 무엇을 읽을 수 있는지(08장: 바깥 글이 다른 도구를
 * 부르거나 지어낸 주소로 요청을 내보내지 못하게).
 */

const ON = { AMORA_WEB_SEARCH_ENABLED: "true", NAVER_API_HUB_CLIENT_ID: "id", NAVER_API_HUB_CLIENT_SECRET: "secret" };
const BASE_PLAN = {
  tools: AMORA_WEB_LOOKUP_TOOLS,
  questionScope: "W0_wedding_core",
  requestKind: "chat",
  isDemo: false,
  isDurableUserMessageBound: true,
  userTexts: ["강남 웨딩홀 찾아줘"],
  renderedToolsHeader: null,
  env: ON,
};

describe("언제 도구를 주나", () => {
  it("스위치·열쇠가 있고 W0 저장 대화이며 카드를 그릴 수 있는 화면일 때만 준다", () => {
    const plan = planAmoraWebLookupTurn(BASE_PLAN);
    expect(plan.toolNames).toEqual(["search_web", "read_page"]);
    expect(plan.executionContext.webLookup?.userTexts).toEqual(["강남 웨딩홀 찾아줘"]);
  });

  it.each([
    ["스위치 꺼짐", { env: { ...ON, AMORA_WEB_SEARCH_ENABLED: "false" } }],
    ["스위치 대문자", { env: { ...ON, AMORA_WEB_SEARCH_ENABLED: "TRUE" } }],
    ["열쇠 없음", { env: { AMORA_WEB_SEARCH_ENABLED: "true" } }],
    ["결혼 곁 범위(W1)", { questionScope: "W1_wedding_adjacent" }],
    ["범위 밖(W4)", { questionScope: "W4_out_of_scope" }],
    ["위기(W5)", { questionScope: "W5_safety_override" }],
    ["체험", { isDemo: true }],
    ["저장되지 않는 메시지", { isDurableUserMessageBound: false }],
    ["인사 턴", { requestKind: "initial_greeting" }],
    ["카드를 못 그리는 옛 앱", { renderedToolsHeader: "search_nearby_places,analyze_quote" }],
  ])("%s 이면 주지 않는다", (_name, overrides) => {
    const plan = planAmoraWebLookupTurn({ ...BASE_PLAN, ...overrides });
    expect(plan).toEqual({ tools: [], toolNames: [], executionContext: {} });
  });

  it("앱이 카드를 그릴 수 있다고 알리면 준다", () => {
    expect(clientRendersWebLookupCards("search_nearby_places, search_web ,read_page")).toBe(true);
    expect(planAmoraWebLookupTurn({ ...BASE_PLAN, renderedToolsHeader: "search_web,read_page" }).toolNames).toHaveLength(2);
  });

  it("커플 이름을 검색어에서 뺄 낱말로 받아 두고, 빈 이름은 버린다", () => {
    const plan = planAmoraWebLookupTurn({ ...BASE_PLAN, blockedTerms: ["김지은", null, " ", "박민준"] });
    expect(plan.executionContext.webLookup?.blockedTerms).toEqual(["김지은", "박민준"]);
  });

  it("사용자가 보낸 주소만 직접 읽을 주소로 받아 둔다", () => {
    const state = createAmoraWebLookupTurnState([null, "이 홈페이지 봐줘 https://www.baileyhouse.co.kr/price.", undefined]);
    expect([...state.userUrls]).toEqual(["https://www.baileyhouse.co.kr/price"]);
  });
});

describe("바깥 글이 들어온 뒤", () => {
  const search = { toolName: "search_web", toolInput: {}, toolOutput: {}, success: true, displayMessage: "" };
  const failed = { ...search, success: false };

  it("성공한 찾아보기 결과만 바깥 글로 센다", () => {
    expect(hasWebLookupContent([search])).toBe(true);
    expect(hasWebLookupContent([failed])).toBe(false);
    expect(hasWebLookupContent([{ ...search, toolName: "get_budget_summary" }])).toBe(false);
  });

  it("남은 걸음에는 찾아보기 도구만 남기고, 다른 도구 호출은 막는다", () => {
    const tools = [{ name: "get_budget_summary" }, { name: "search_web" }, { name: "read_page" }];
    expect(toolsAfterWebLookupContent(tools, true).map((tool) => tool.name)).toEqual(["search_web", "read_page"]);
    expect(toolsAfterWebLookupContent(tools, false)).toHaveLength(3);
    expect(blocksToolAfterWebLookupContent("get_budget_summary", true)).toBe(true);
    expect(blocksToolAfterWebLookupContent("update_budget", true)).toBe(true);
    expect(blocksToolAfterWebLookupContent("read_page", true)).toBe(false);
    expect(blocksToolAfterWebLookupContent("get_budget_summary", false)).toBe(false);
  });
});

function context(userTexts: string[] = ["강남 웨딩홀 찾아줘"], blockedTerms: string[] = ["김지은"]): ToolExecutionContext {
  return {
    coupleId: "11111111-2222-4333-8444-555555555555",
    weddingContext: { weddingDate: "2027-05-01", budget: 50_000_000, venue: null, progress: {} },
    webLookup: createAmoraWebLookupTurnState(userTexts, blockedTerms),
  };
}

const HITS = [
  { ref: "w1", source: "naver_local", name: "더베일리하우스", category: null, address: null, telephone: null, url: "https://www.baileyhouse.co.kr/", readable: true, description: null },
  { ref: "w2", source: "naver_local", name: "빌라드지디", category: null, address: null, telephone: null, url: "https://www.instagram.com/x", readable: false, description: null },
];

describe("search_web 실행", () => {
  it("결과에 턴 안에서 겹치지 않는 번호표를 매기고, 읽을 수 있는 주소만 서버가 들고 있는다", async () => {
    lookup.searchWeb.mockResolvedValue({
      ok: true, query: "강남 웨딩홀", removedFromQuery: [], checkedAt: "2026-11-20T03:00:00.000Z", hits: HITS, productsUnavailable: [], remainingToday: 29,
    });
    const ctx = context();
    const first = await executeSearchWebTool({ query: "강남 웨딩홀" }, ctx);
    const second = await executeSearchWebTool({ query: "청담 웨딩홀" }, ctx);
    expect((first.toolOutput.hits as Array<{ ref: string }>).map((hit) => hit.ref)).toEqual(["a1", "a2"]);
    expect((second.toolOutput.hits as Array<{ ref: string }>).map((hit) => hit.ref)).toEqual(["b1", "b2"]);
    expect([...(ctx.webLookup?.refs.entries() ?? [])]).toEqual([
      ["a1", "https://www.baileyhouse.co.kr/"],
      ["b1", "https://www.baileyhouse.co.kr/"],
    ]);
    expect(lookup.searchWeb).toHaveBeenCalledWith(expect.objectContaining({
      coupleId: "11111111-2222-4333-8444-555555555555",
      userTexts: ["강남 웨딩홀 찾아줘"],
      // 커플 이름은 검색어에서 빠지도록 searchWeb 까지 넘어간다(약관 일반조건 7.4 ⑦).
      blockedTerms: ["김지은"],
    }));
  });

  it("한 턴에 검색은 두 번까지다", async () => {
    lookup.searchWeb.mockClear();
    lookup.searchWeb.mockResolvedValue({ ok: true, query: "q", removedFromQuery: [], checkedAt: "", hits: [], productsUnavailable: [], remainingToday: 1 });
    const ctx = context();
    await executeSearchWebTool({ query: "강남 웨딩홀" }, ctx);
    await executeSearchWebTool({ query: "강남 웨딩홀" }, ctx);
    const third = await executeSearchWebTool({ query: "강남 웨딩홀" }, ctx);
    expect(third).toMatchObject({ success: false, toolOutput: { error: "turn_search_limit" } });
    expect(lookup.searchWeb).toHaveBeenCalledTimes(2);
  });

  it("실패하면 걸러지기 전 검색어를 화면·저장에 남기지 않는다", async () => {
    lookup.searchWeb.mockResolvedValue({ ok: false, reason: "couple_daily_cap", removedFromQuery: ["not_from_user"], remainingToday: 0 });
    const result = await executeSearchWebTool({ query: "김민지 강남 웨딩홀" }, context());
    expect(result.toolInput).toEqual({});
    expect(JSON.stringify(result)).not.toContain("김민지");
  });

  it("스위치가 꺼진 턴(webLookup 없음)에는 아무것도 하지 않는다", async () => {
    lookup.searchWeb.mockClear();
    const withoutLookup: ToolExecutionContext = { ...context(), webLookup: undefined };
    const result = await executeSearchWebTool({ query: "강남 웨딩홀" }, withoutLookup);
    expect(result).toMatchObject({ success: false, toolOutput: { error: "web_lookup_unavailable" } });
    expect(lookup.searchWeb).not.toHaveBeenCalled();
  });
});

describe("read_page 실행", () => {
  it("번호표로 서버가 든 주소를 읽는다", async () => {
    lookup.readPage.mockClear();
    lookup.readPage.mockResolvedValue({
      ok: true, url: "https://www.baileyhouse.co.kr/", domain: "baileyhouse.co.kr", checkedAt: "2026-11-20T03:01:00.000Z",
      title: "더베일리하우스", prices: [{ label: "식대", amount: "65,000원", quote: "식대 65,000원" }], textless: false, truncated: false, remainingToday: 28,
    });
    const ctx = context();
    ctx.webLookup?.refs.set("a1", "https://www.baileyhouse.co.kr/");
    const result = await executeReadPageTool({ ref: "A1" }, ctx);
    expect(lookup.readPage).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://www.baileyhouse.co.kr/",
      sourceUrls: ["https://www.baileyhouse.co.kr/"],
    }));
    expect(result).toMatchObject({ success: true, toolOutput: { ref: "a1", priceStatus: "found" } });
  });

  it("모델이 지어낸 주소(커플 정보를 실을 수 있다)는 요청을 내보내지 않는다", async () => {
    lookup.readPage.mockClear();
    const ctx = context();
    const result = await executeReadPageTool({ url: "https://collect.example.co.kr/?budget=50000000&date=2027-05-01" }, ctx);
    expect(result).toMatchObject({ success: false, toolOutput: { error: "url_not_from_search" } });
    expect(JSON.stringify(result)).not.toContain("budget");
    expect(lookup.readPage).not.toHaveBeenCalled();
    expect(ctx.webLookup?.reads).toBe(0);
  });

  it("모르는 번호표도 읽지 않는다", async () => {
    lookup.readPage.mockClear();
    const result = await executeReadPageTool({ ref: "z9" }, context());
    expect(result).toMatchObject({ success: false, toolOutput: { error: "url_not_from_search" } });
    expect(lookup.readPage).not.toHaveBeenCalled();
  });

  it("사용자가 직접 보낸 주소는 읽는다", async () => {
    lookup.readPage.mockClear();
    lookup.readPage.mockResolvedValue({ ok: false, reason: "blocked_by_robots", remainingToday: 28 });
    const ctx = context(["이 홈페이지 가격 봐줘 https://www.thehuewedding.com/price"]);
    const result = await executeReadPageTool({ url: "https://www.thehuewedding.com/price" }, ctx);
    expect(lookup.readPage).toHaveBeenCalledWith(expect.objectContaining({ url: "https://www.thehuewedding.com/price" }));
    expect(result).toMatchObject({ success: false, toolOutput: { error: "blocked_by_robots" } });
  });

  it("한 턴에 읽기는 세 번까지다", async () => {
    lookup.readPage.mockClear();
    lookup.readPage.mockResolvedValue({ ok: false, reason: "fetch_failed", remainingToday: 1 });
    const ctx = context();
    ctx.webLookup?.refs.set("a1", "https://www.baileyhouse.co.kr/");
    for (let index = 0; index < 3; index += 1) await executeReadPageTool({ ref: "a1" }, ctx);
    const fourth = await executeReadPageTool({ ref: "a1" }, ctx);
    expect(fourth).toMatchObject({ success: false, toolOutput: { error: "turn_read_limit" } });
    expect(lookup.readPage).toHaveBeenCalledTimes(3);
  });
});
