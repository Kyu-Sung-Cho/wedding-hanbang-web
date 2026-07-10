import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import {
  WEDDING_CODE_V05_QUESTIONS,
  WEDDING_CODE_V05_SCORING_VERSION,
  WEDDING_CODE_V05_VERSION,
} from "@/constants/weddingCodeV05";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { POST } from "../route";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "wc-response:test"),
}));

const RESPONSE_ID = "123e4567-e89b-42d3-a456-426614174000";
const COUPLE_TOKEN = "223e4567-e89b-42d3-a456-426614174000";
const SUBMISSION_ID = "323e4567-e89b-42d3-a456-426614174000";
const CANONICAL_TOKEN = "423e4567-e89b-42d3-a456-426614174000";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    consent: true,
    submission_id: SUBMISSION_ID,
    form_version: WEDDING_CODE_V05_VERSION,
    scoring_version: WEDDING_CODE_V05_SCORING_VERSION,
    participant_stage: "venue_search",
    answering_mode: "alone",
    quote_status: "none",
    parent_involvement: "low",
    biggest_concern: ["예산·비용"],
    answers: Object.fromEntries(WEDDING_CODE_V05_QUESTIONS.map((question) => [question.key, "A"])),
    stage_flags: {},
    feedback: { feels_like_me: 4 },
    cta_interest: { quote_check_interest: 3 },
    free_text: {},
    duration_ms: 180_000,
    couple_token: COUPLE_TOKEN,
    ...overrides,
  };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/wedding-code/response", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function mockAdmin(options: {
  pairingStatus?: "unpaired" | "waiting" | "paired" | "full";
  coupleToken?: string | null;
  answers?: Record<string, string>;
  recovered?: boolean;
  error?: { message: string } | null;
}) {
  const pairingStatus = options.pairingStatus ?? "waiting";
  const coupleToken = Object.prototype.hasOwnProperty.call(options, "coupleToken")
    ? options.coupleToken
    : pairingStatus === "waiting" || pairingStatus === "paired"
      ? COUPLE_TOKEN
      : null;
  const admin = {
    rpc: vi.fn(() =>
      Promise.resolve({
        data: options.error
          ? null
          : [
              {
                response_id: RESPONSE_ID,
                pairing_status: pairingStatus,
                paired: pairingStatus === "paired",
                recovered: options.recovered ?? false,
                couple_token: coupleToken,
                form_version: WEDDING_CODE_V05_VERSION,
                scoring_version: WEDDING_CODE_V05_SCORING_VERSION,
                participant_stage: "venue_search",
                quote_status: "none",
                answers:
                  options.answers ??
                  Object.fromEntries(
                    WEDDING_CODE_V05_QUESTIONS.map((question) => [question.key, "A"])
                  ),
              },
            ],
        error: options.error ?? null,
      })
    ),
  };
  vi.mocked(createClient).mockReturnValue(admin as unknown as ReturnType<typeof createClient>);
  return admin;
}

describe("/api/wedding-code/response POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects oversized requests before rate limiting or Supabase access", async () => {
    const response = await POST(request({}, { "content-length": String(32 * 1024 + 1) }));
    expect(response.status).toBe(413);
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects stale form and scoring clients instead of mislabeling their rows", async () => {
    const staleForm = await POST(request(validBody({ form_version: "v0.5-candidate.8" })));
    const staleScoring = await POST(request(validBody({ scoring_version: "v0.5-scoring.0" })));

    expect(staleForm.status).toBe(400);
    expect(staleScoring.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed idempotency key before Supabase access", async () => {
    const missing = await POST(request(validBody({ submission_id: undefined })));
    const malformed = await POST(request(validBody({ submission_id: "retry-me" })));

    expect(missing.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("passes explicit versions and validated data to the atomic insert RPC", async () => {
    const admin = mockAdmin({ pairingStatus: "paired" });
    const response = await POST(request(validBody()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      id: RESPONSE_ID,
      paired: true,
      coupleToken: COUPLE_TOKEN,
      pairingStatus: "paired",
      recovered: false,
      formVersion: WEDDING_CODE_V05_VERSION,
      scoringVersion: WEDDING_CODE_V05_SCORING_VERSION,
    });
    expect(admin.rpc).toHaveBeenCalledWith(
      "insert_wedding_code_response",
      expect.objectContaining({
        p_submission_id: SUBMISSION_ID,
        p_form_version: WEDDING_CODE_V05_VERSION,
        p_scoring_version: WEDDING_CODE_V05_SCORING_VERSION,
        p_couple_token: COUPLE_TOKEN,
      })
    );
  });

  it("saves a completed response unpaired and explicitly reports a full token", async () => {
    mockAdmin({ pairingStatus: "full" });
    const response = await POST(request(validBody()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.pairingStatus).toBe("full");
    expect(body.coupleToken).toBeNull();
    expect(body.paired).toBe(false);
  });

  it("returns the database canonical token on an edited or stale-tab retry", async () => {
    const canonicalAnswers = Object.fromEntries(
      WEDDING_CODE_V05_QUESTIONS.map((question) => [question.key, "D"])
    );
    mockAdmin({
      pairingStatus: "paired",
      coupleToken: CANONICAL_TOKEN,
      answers: canonicalAnswers,
      recovered: true,
    });
    const response = await POST(request(validBody()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.coupleToken).toBe(CANONICAL_TOKEN);
    expect(body.paired).toBe(true);
    expect(body.recovered).toBe(true);
    expect(body.answers).toEqual(canonicalAnswers);
  });

  it("fails closed when the atomic insert RPC is unavailable", async () => {
    mockAdmin({ error: { message: "function missing" } });
    const response = await POST(request(validBody()));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.pairingStatus).toBe("error");
  });
});
