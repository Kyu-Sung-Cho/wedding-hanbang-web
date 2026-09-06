import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { DELETE, GET, POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PARTNER_ID = "22222222-2222-4222-8222-222222222222";
const COUPLE_ID = "33333333-3333-4333-8333-333333333333";
const MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const CURRENT_VERSION = "55555555-5555-4555-8555-555555555555";
const OLD_VERSION = "66666666-6666-4666-8666-666666666666";
const RESOLUTION = "총예산 상한선을 함께 확인해요";
const V2_DRAFT = {
  empathy: "요청자가 답답함을 느꼈다고 전했어요.",
  translation: "요청자가 예산 기준을 먼저 정하고 싶다고 전했어요.",
  data: "상대방의 예산 상한은 아직 확인되지 않았어요.",
  resolution: RESOLUTION,
  origin: "user_requested",
  evidenceScope: "requester_summary_only",
  schemaVersion: 2,
} as const;

function query(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "order", "limit"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(async () => result);
  chain.maybeSingle = vi.fn(async () => result);
  chain.then = (
    resolve: (value: typeof result) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function fingerprint(brideId: string, groomId: string) {
  return createHash("md5").update(`${brideId}:${groomId}`, "utf8").digest("hex");
}

describe("GET /api/amora/mediation/accept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["GET", "POST", "DELETE"] as const)(
    "reports a retryable database failure without claiming missing permission or proposal on %s",
    async (method) => {
      const currentRoster = fingerprint(USER_ID, PARTNER_ID);
      const fields = {
        messageId: MESSAGE_ID,
        expectedProposalVersion: CURRENT_VERSION,
        expectedRosterFingerprint: currentRoster,
      };
      for (const failedTable of ["profiles", "chat_messages"]) {
        vi.mocked(createClientFromRequest).mockResolvedValue({
          auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
          from: vi.fn((table: string) => query(table === failedTable
            ? { data: null, error: { code: "08006", message: "SYNTHETIC_PRIVATE_DATABASE_DETAIL" } }
            : { data: { couple_id: COUPLE_ID }, error: null })),
        } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
        const request = new Request(
          "http://localhost/api/amora/mediation/accept"
            + (method === "GET" ? `?${new URLSearchParams(fields)}` : ""),
          method === "GET" ? undefined : {
            method,
            headers: { "Content-Type": "application/json", Origin: "http://localhost" },
            body: JSON.stringify(fields),
          },
        );

        const response = await ({ GET, POST, DELETE }[method])(request);

        expect(response.status, failedTable).toBe(503);
        const payload = await response.json();
        expect(payload.error).toContain("다시 시도");
        expect(JSON.stringify(payload)).not.toContain("SYNTHETIC_PRIVATE_DATABASE_DETAIL");
        expect(createAdminClient).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["profiles", "chat_messages"])(
    "keeps a successful empty %s lookup distinct from database failure",
    async (emptyTable) => {
      const currentRoster = fingerprint(USER_ID, PARTNER_ID);
      vi.mocked(createClientFromRequest).mockResolvedValue({
        auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
        from: vi.fn((table: string) => query({
          data: table === emptyTable ? null : { couple_id: COUPLE_ID },
          error: null,
        })),
      } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

      const response = await GET(new Request(
        `http://localhost/api/amora/mediation/accept?messageId=${MESSAGE_ID}`
          + `&expectedProposalVersion=${CURRENT_VERSION}`
          + `&expectedRosterFingerprint=${currentRoster}`,
      ));

      expect(response.status).toBe(emptyTable === "profiles" ? 403 : 404);
      expect(createAdminClient).not.toHaveBeenCalled();
    },
  );

  it.each(["POST", "DELETE"] as const)(
    "rejects a cross-site %s before parsing or authentication",
    async (method) => {
      const request = new Request("http://localhost/api/amora/mediation/accept", {
        method,
        headers: {
          "Content-Type": "text/plain",
          Origin: "https://evil.example",
          "Sec-Fetch-Site": "cross-site",
        },
        body: JSON.stringify({
          messageId: MESSAGE_ID,
          expectedProposalVersion: CURRENT_VERSION,
          expectedRosterFingerprint: "0".repeat(32),
        }),
      });

      const response = method === "POST" ? await POST(request) : await DELETE(request);

      expect(response.status).toBe(403);
      expect(createClientFromRequest).not.toHaveBeenCalled();
      expect(createAdminClient).not.toHaveBeenCalled();
    },
  );

  it("rejects a provenance-less legacy proposal before opening confirmation", async () => {
    const currentRoster = fingerprint(USER_ID, PARTNER_ID);
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
      from: vi.fn((table: string) => table === "profiles"
        ? query({ data: { couple_id: COUPLE_ID }, error: null })
        : query({
          data: {
            id: MESSAGE_ID,
            sender_type: "ai",
            role: "assistant",
            visibility: "shared",
            metadata: {
              mediation: {
                empathy: "요청자가 답답함을 느꼈다고 전했어요.",
                translation: "요청자가 예산 기준을 먼저 정하고 싶다고 전했어요.",
                data: "상대방의 예산 상한은 아직 확인되지 않았어요.",
                resolution: RESOLUTION,
                proposalVersion: CURRENT_VERSION,
                rosterFingerprint: currentRoster,
              },
            },
          },
          error: null,
        })),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => query({ data: [], error: null })),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await GET(new Request(
      `http://localhost/api/amora/mediation/accept?messageId=${MESSAGE_ID}`
        + `&expectedProposalVersion=${CURRENT_VERSION}`
        + `&expectedRosterFingerprint=${currentRoster}`,
    ));

    expect(response.status).toBe(404);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a v2 proposal when any required mediation field is missing", async () => {
    const currentRoster = fingerprint(USER_ID, PARTNER_ID);
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
      from: vi.fn((table: string) => table === "profiles"
        ? query({ data: { couple_id: COUPLE_ID }, error: null })
        : query({
          data: {
            id: MESSAGE_ID,
            sender_type: "ai",
            role: "assistant",
            visibility: "shared",
            metadata: {
              mediation: {
                ...V2_DRAFT,
                data: undefined,
                proposalVersion: CURRENT_VERSION,
                rosterFingerprint: currentRoster,
              },
            },
          },
          error: null,
        })),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await GET(new Request(
      `http://localhost/api/amora/mediation/accept?messageId=${MESSAGE_ID}`
        + `&expectedProposalVersion=${CURRENT_VERSION}`
        + `&expectedRosterFingerprint=${currentRoster}`,
    ));

    expect(response.status).toBe(404);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("counts only the exact current proposal version and roster", async () => {
    const currentRoster = fingerprint(USER_ID, PARTNER_ID);
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          return query({ data: { couple_id: COUPLE_ID }, error: null });
        }
        return query({
          data: {
            id: MESSAGE_ID,
            sender_type: "ai",
            role: "assistant",
            visibility: "shared",
            metadata: {
              mediation: {
                ...V2_DRAFT,
                proposalVersion: CURRENT_VERSION,
                rosterFingerprint: currentRoster,
              },
            },
          },
          error: null,
        });
      }),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "couples") {
          return query({ data: { bride_id: USER_ID, groom_id: PARTNER_ID }, error: null });
        }
        if (table === "amora_mediation_acceptances") {
          return query({
            data: [
              {
                user_id: USER_ID,
                proposal_resolution: RESOLUTION,
                proposal_version: OLD_VERSION,
                proposal_roster_fingerprint: currentRoster,
              },
              {
                user_id: PARTNER_ID,
                proposal_resolution: RESOLUTION,
                proposal_version: CURRENT_VERSION,
                proposal_roster_fingerprint: "0".repeat(32),
              },
            ],
            error: null,
          });
        }
        return query({
          data: [{
            id: "77777777-7777-4777-8777-777777777777",
            chosen_value: { value: RESOLUTION },
            metadata: {
              proposal_version: OLD_VERSION,
              roster_fingerprint: currentRoster,
            },
          }],
          error: null,
        });
      }),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await GET(new Request(
      `http://localhost/api/amora/mediation/accept?messageId=${MESSAGE_ID}`
        + `&expectedProposalVersion=${CURRENT_VERSION}`
        + `&expectedRosterFingerprint=${currentRoster}`,
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      acceptedCount: 0,
      requiredCount: 2,
      partnerLinked: true,
      completed: false,
    });
  });

  it("rejects a click or status read for a proposal revision no longer displayed by the server", async () => {
    const currentRoster = fingerprint(USER_ID, PARTNER_ID);
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
      from: vi.fn((table: string) => table === "profiles"
        ? query({ data: { couple_id: COUPLE_ID }, error: null })
        : query({
          data: {
            id: MESSAGE_ID,
            sender_type: "ai",
            role: "assistant",
            visibility: "shared",
            metadata: {
              mediation: {
                ...V2_DRAFT,
                proposalVersion: CURRENT_VERSION,
                rosterFingerprint: currentRoster,
              },
            },
          },
          error: null,
        })),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await GET(new Request(
      `http://localhost/api/amora/mediation/accept?messageId=${MESSAGE_ID}`
        + `&expectedProposalVersion=${OLD_VERSION}`
        + `&expectedRosterFingerprint=${currentRoster}`,
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("바뀌었어요") });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("passes the exact displayed revision into the atomic acceptance RPC", async () => {
    const currentRoster = fingerprint(USER_ID, PARTNER_ID);
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
      from: vi.fn((table: string) => table === "profiles"
        ? query({ data: { couple_id: COUPLE_ID }, error: null })
        : query({
          data: {
            id: MESSAGE_ID,
            sender_type: "ai",
            role: "assistant",
            visibility: "shared",
            metadata: {
              mediation: {
                ...V2_DRAFT,
                proposalVersion: CURRENT_VERSION,
                rosterFingerprint: currentRoster,
              },
            },
          },
          error: null,
        })),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
    const rpc = vi.fn(async () => ({
      data: { accepted_count: 1, required_count: 2, completed: false },
      error: null,
    }));
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(new Request("http://localhost/api/amora/mediation/accept", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({
        messageId: MESSAGE_ID,
        expectedProposalVersion: CURRENT_VERSION,
        expectedRosterFingerprint: currentRoster,
      }),
    }));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("accept_amora_mediation", {
      p_couple_id: COUPLE_ID,
      p_message_id: MESSAGE_ID,
      p_user_id: USER_ID,
      p_title: `함께 확인한 합의 · ${RESOLUTION}`,
      p_resolution: RESOLUTION,
      p_expected_proposal_version: CURRENT_VERSION,
      p_expected_roster_fingerprint: currentRoster,
    });
  });
});
