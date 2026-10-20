import Ajv from "ajv";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTool } from "../toolExecutor";
import { selectAmoraTools } from "../amoraToolPolicy";
import { WEDDING_TOOLS } from "../tools";
import type { ToolExecutionContext } from "../tools/toolTypes";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), in: vi.fn(), range: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
const priceTool = WEDDING_TOOLS.find(tool => tool.name === "get_market_price")!;
const validate = new Ajv({ strict: false, coerceTypes: false }).compile(priceTool.input_schema);
const ctx = (currentUserText: string): ToolExecutionContext => ({ coupleId: "synthetic-couple", currentUserText,
  weddingContext: { weddingDate: null, budget: 0, venue: null, progress: {} } });
const ask = (text: string, category: unknown = "hall") => executeTool("get_market_price", { category }, ctx(text));
const offered = (userText: string) => selectAmoraTools({ availableTools: [priceTool], userText, specialistType: "general" }).map(tool => tool.name);
const originalQuestion = "[QA-RETEST-20261018 공시 제공 범위] 신혼여행도 웨딩한방 공시 가격에 자료가 있으면 실제 조회해서 알려줘. 제공하는 분야가 아니면 없다고 분명히 말해줘. 다른 분야의 가격을 대신 쓰거나 추정하지 말고, 예산·일정·기억은 바꾸지 마.";

beforeEach(() => {
  vi.clearAllMocks();
  const builder = { select: mocks.select, eq: mocks.eq, in: mocks.in, range: mocks.range };
  mocks.createAdminClient.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue(builder); mocks.select.mockReturnValue(builder); mocks.eq.mockReturnValue(builder); mocks.in.mockReturnValue(builder);
  mocks.range.mockResolvedValue({ data: [{ price_min_krw: 1000, price_max_krw: 1000, source_label: "kca_tprice", region_code: "seoul_etc", item_name: "가상 홀 대관료" }], error: null });
});

describe("official-price dispatch binds an explicitly unsupported request before any lookup", () => {
  it("rejects the real unsupported-only question even when the provider supplies a schema-valid hall argument", async () => {
    expect(validate({ category: "hall" })).toBe(true);
    const result = await ask(originalQuestion);
    expect(result).toMatchObject({ success: false, toolOutput: { error: "unsupported_price_request" } });
    expect(result.toolOutput).not.toHaveProperty("breakdown");
    expect(result.displayMessage).not.toContain("중간값");
    expect(mocks.createAdminClient).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
    expect(offered(originalQuestion)).toEqual([]);
  });
  it.each(["신혼여행 가격", "신혼 여행 공시 자료", "허니문 가격", "honeymoon official prices", "예물 공시 가격", "결혼반지 공시 자료", "가전 제품 공시 가격", "home appliances price", "신혼집 공시 가격", "신혼여행 식비 자료"])("does not substitute hall for %s", async text => {
    const result = await ask(text);
    expect(result.success).toBe(false); expect(mocks.from).not.toHaveBeenCalled(); expect(offered(text)).toEqual([]);
  });
  it.each(["신혼여행 식대 공시 자료를 알려줘. 다른 분야 가격으로 대신하지 마", "결혼식장 말고 신혼여행 식대 자료만 조회해줘"])("does not promote an unsupported trip's meal cost to hall: %s", async text => {
    const result = await ask(text);
    expect(result.success).toBe(false); expect(mocks.from).not.toHaveBeenCalled(); expect(offered(text)).toEqual([]);
  });
  it.each([
    ["스튜디오 말고 신혼여행 가격", "studio"],
    ["드레스 가격은 빼고 예물만 조회해줘", "dress"],
    ["not studio, honeymoon official price", "studio"],
    ["신혼여행만 궁금해. 메이크업 자료는 필요 없어", "makeup"],
    ["스튜디오와 드레스 말고 신혼여행 공시 가격만 알려줘", "studio"],
    ["스튜디오, 드레스는 빼고 신혼여행만 조회해줘", "studio"],
    ["스튜디오 가격이 아니고 신혼여행 가격만 조회해줘", "studio"],
    ["스튜디오나 드레스 말고 신혼여행 공시 가격만 알려줘", "studio"],
  ])("does not treat an excluded supported category as permission: %s", async (text, category) => {
    const result = await ask(text, category);
    expect(result.success).toBe(false); expect(mocks.from).not.toHaveBeenCalled(); expect(offered(text)).toEqual([]);
  });
  it.each([
    ["신혼여행은 우선이지만 스튜디오 가격도 실제 조회해줘", "studio"],
    ["신혼여행과 웨딩홀 가격은 각각 공시 자료가 있으면 알려줘", "hall"],
    ["예물과 드레스 공시 가격", "dress"],
    ["가전 비용과 헤어·메이크업 공시 가격을 비교해줘", "makeup"],
    ["honeymoon and studio public price", "studio"],
    ["신혼 여행과 스 튜 디 오 가격", "studio"],
    ["신혼여행 예산은 따로 두고 웨딩홀 식대 공시 자료를 확인해줘", "hall"],
  ])("allows the explicitly requested supported part of mixed text: %s", async (text, category) => {
    const result = await ask(text, category);
    expect(result.success).toBe(true); expect(mocks.eq).toHaveBeenCalledWith("price_category", category);
    expect(offered(text)).toEqual(["get_market_price"]);
  });
  it("does not allow a different supported category inside a mixed request", async () => {
    const result = await ask("신혼여행과 스튜디오 가격을 각각 확인해줘", "hall");
    expect(result.success).toBe(false); expect(mocks.from).not.toHaveBeenCalled();
  });
  it("does not let provider arguments replace the server's canonical current question", async () => {
    const result = await executeTool("get_market_price", { category: "hall", currentUserText: "웨딩홀 공시 가격을 조회해줘" }, ctx(originalQuestion));
    expect(result).toMatchObject({ success: false, toolOutput: { error: "unsupported_price_request" } });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
  it("does not substitute a schema-valid hall argument for a pure studio request", async () => {
    const result = await ask("서울 스튜디오 공시 가격과 표본 수를 확인해줘", "hall");
    expect(result.success).toBe(false); expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
  it.each(["studio", "dress", "makeup"])("binds the SDM alias to its supported %s category", async category => {
    for (const text of ["스드메 공시 가격을 알려줘", "신혼여행 말고 스드메 공시 가격만 알려줘"]) {
      const result = await ask(text, category);
      expect(result.success).toBe(true); expect(mocks.eq).toHaveBeenCalledWith("price_category", category);
      expect(offered(text)).toEqual(["get_market_price"]);
    }
  });
  it.each(["스드메 공시 가격을 알려줘", "신혼여행 말고 스드메 공시 가격만 알려줘"])("does not replace the SDM alias with hall: %s", async text => {
    const result = await ask(text, "hall");
    expect(result.success).toBe(false); expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
  it.each(["studio", "dress", "makeup"])("excludes all SDM categories together, including %s", async category => {
    const text = "스드메 말고 신혼여행 가격만 알려줘";
    const result = await ask(text, category);
    expect(result.success).toBe(false); expect(mocks.from).not.toHaveBeenCalled(); expect(offered(text)).toEqual([]);
  });
  it("does not open a price lookup for an excluded SDM alias without a replacement", async () => {
    const text = "스드메 공시 가격은 빼고";
    const result = await ask(text, "studio");
    expect(result.success).toBe(false); expect(mocks.from).not.toHaveBeenCalled(); expect(offered(text)).toEqual([]);
  });
  it("preserves an explicit switch from SDM to hall", async () => {
    const text = "스드메 말고 웨딩홀 공시 가격을 알려줘";
    const result = await ask(text, "hall");
    expect(result.success).toBe(true); expect(mocks.eq).toHaveBeenCalledWith("price_category", "hall");
    expect(offered(text)).toEqual(["get_market_price"]);
  });
  it("does not promote an excluded supported category when no replacement target was named", async () => {
    const result = await ask("스튜디오는 빼고", "studio");
    expect(result.success).toBe(false); expect(mocks.from).not.toHaveBeenCalled(); expect(offered("스튜디오 가격은 빼고")).toEqual([]);
  });
  it("does not allow an excluded hall-item list when the request switches to studio", async () => {
    const result = await ask("식대나 대관료 말고 스튜디오 공시 가격을 확인해줘", "hall");
    expect(result.success).toBe(false); expect(mocks.from).not.toHaveBeenCalled();
    expect(offered("식대나 대관료 말고 스튜디오 공시 가격을 확인해줘")).toEqual(["get_market_price"]);
  });
  it.each([
    ["스튜디오 말고 식대 공시 가격을 확인해줘", "hall"],
    ["드레스 말고 메이크업 공시 가격이 궁금해", "makeup"],
    ["스튜디오 공시 가격과 표본 수를 확인해줘", "studio"],
  ])("preserves an explicitly named supported request or switch: %s", async (text, category) => {
    const result = await ask(text, category);
    expect(result.success).toBe(true); expect(mocks.eq).toHaveBeenCalledWith("price_category", category);
  });
  it.each(["그럼 전국은?", "서울 전체도 확인해줘", "중간값과 표본 수도 알려줘", "대관료는 보통 얼마야?", "식대는 얼마야?", "스튜디오 공시 가격 알려줘"])("preserves an existing valid neutral or supported follow-up: %s", async text => {
    const result = await ask(text, text.includes("스튜디오") ? "studio" : "hall");
    expect(result.success).toBe(true); expect(mocks.from).toHaveBeenCalledWith("v_public_official_prices");
  });
  it.each([undefined, null, "", "honeymoon", "신혼여행", "unknown", [], {}, 42])("keeps malformed or unsupported categories fail-closed without a hall fallback: %s", async category => {
    const input = category === undefined ? {} : { category };
    expect(validate(input)).toBe(false);
    const result = await executeTool("get_market_price", input, ctx(originalQuestion));
    expect(result).toMatchObject({ success: false, toolOutput: { error: "unsupported_category" } });
    expect(mocks.from).not.toHaveBeenCalled(); expect(result.toolOutput).not.toHaveProperty("breakdown");
  });
});
