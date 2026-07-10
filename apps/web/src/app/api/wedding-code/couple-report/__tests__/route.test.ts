import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import {
  WEDDING_CODE_V05_QUESTIONS,
  WEDDING_CODE_V05_SCORING_VERSION,
  WEDDING_CODE_V05_VERSION,
} from "@/constants/weddingCodeV05";
import { GET } from "../route";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "wc-couple-report:test"),
}));

type QueryResult = {
  data?: unknown;
  error?: { message: string } | null;
};

class FakeQuery {
  constructor(private readonly result: QueryResult) {}
  select = vi.fn(() => this);
  eq() { return this; }
  order() { return this; }
  limit() { return this; }
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function mockAdmin(result: QueryResult) {
  const query = new FakeQuery(result);
  const admin = {
    from: vi.fn(() => query),
  };
  vi.mocked(createClient).mockReturnValue(admin as unknown as ReturnType<typeof createClient>);
  return { admin, query };
}

function request(ct: string) {
  return new NextRequest(`http://localhost/api/wedding-code/couple-report?ct=${ct}`);
}

function completeAnswers(value: "A" | "B" | "C" | "D") {
  return Object.fromEntries(WEDDING_CODE_V05_QUESTIONS.map((question) => [question.key, value]));
}

describe("/api/wedding-code/couple-report GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an invalid couple token before querying Supabase", async () => {
    const response = await GET(request("not-a-token"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("초대 링크");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns a computed couple report without exposing raw answers", async () => {
    const { query } = mockAdmin({
      data: [
        {
          created_at: "2026-07-08T00:00:00.000Z",
          form_version: WEDDING_CODE_V05_VERSION,
          scoring_version: WEDDING_CODE_V05_SCORING_VERSION,
          answers: completeAnswers("A"),
        },
        {
          created_at: "2026-07-08T00:01:00.000Z",
          form_version: WEDDING_CODE_V05_VERSION,
          scoring_version: WEDDING_CODE_V05_SCORING_VERSION,
          answers: completeAnswers("D"),
        },
      ],
      error: null,
    });

    const response = await GET(request("123e4567-e89b-42d3-a456-426614174000"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.report.titleKo).toContain("준비 방식 겹침도");
    expect(JSON.stringify(body)).not.toContain("\"A1\"");
    expect(query.select).toHaveBeenCalledWith(
      "created_at, form_version, scoring_version, answers"
    );
  });

  it("returns 500 on Supabase read failure", async () => {
    mockAdmin({ data: null, error: { message: "db down" } });

    const response = await GET(request("123e4567-e89b-42d3-a456-426614174000"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain("불러오지");
  });
});

