// @vitest-environment node

// 15초 후기가 실제로 저장되는지를 화면 밖 두 경계에서 잰다.
//   1) 실제 `POST /api/community/posts` 핸들러(Supabase 클라이언트만 가짜)
//   2) 그 핸들러가 저장 RPC 에 넘긴 payload 를 PGlite 위 실제 `community_create_post_service` 에
// 예전 웹 화면이 보내던 본문과 지금 `buildQuickReviewPostBody` 가 만드는 본문을 둘 다 넣는다.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTOR, createDatabase, setPersona } from "./fixtures/communityPostServiceDatabase";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/community/writeAccess", () => ({
  checkCommunityWriteAccess: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "quick-review-contract"),
}));

import { POST } from "@/app/api/community/posts/route";
import { buildQuickReviewPostBody, type QuickReviewDraft } from "@/lib/community/quickReview";

const KEY = "20000000-0000-4000-8000-00000000000a";

/** 고치기 전 웹 화면(`quick-review/page.tsx`)이 보내던 본문 그대로. */
const LEGACY_WEB_BODY = {
  category: "tour_review",
  title: "라벨르 스튜디오 후기",
  content: "실장님이 친절해요",
  images: [],
  visibility: "public",
  vendor_tags: ["라벨르 스튜디오"],
  tags: ["studio"],
  is_quick_review: true,
  rating: 4,
  ad_disclosure: "general",
};

const draft: QuickReviewDraft = {
  vendorName: "라벨르 스튜디오",
  category: "studio",
  rating: 4,
  review: "실장님이 친절해요",
  images: [],
  adDisclosure: "general",
};

function request(body: unknown, idempotencyKey?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return new NextRequest("http://localhost/api/community/posts", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** 저장 RPC 에 넘어간 payload 를 잡고, 영수증은 성공 모양으로 돌려준다. */
function captureSavePayload() {
  const captured: { payload: Record<string, unknown> | null } = { payload: null };
  const rpc = vi.fn(async (name: string, args: { p_payload: Record<string, unknown> }) => {
    if (name === "community_replay_post_command_service") return { data: null, error: null };
    captured.payload = args.p_payload;
    return {
      data: {
        post: { id: "30000000-0000-4000-8000-000000000001", author_id: ACTOR },
        poll_id: null,
        post_count: 1,
      },
      error: null,
    };
  });
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data: { name: "예비부부" }, error: null })),
      })),
    })),
  }));
  mocks.createAdminClient.mockReturnValue({ rpc, from });
  return { captured, rpc };
}

async function saveInDatabase(payload: Record<string, unknown>) {
  const db = await createDatabase();
  try {
    await setPersona(db, "service_role");
    const result = await db.query<{ receipt: { post: { id: string } } }>(
      `SELECT public.community_create_post_service(
        $1::uuid, $2::uuid, $3::text, $4::jsonb
      ) AS receipt`,
      [ACTOR, KEY, "user-10000000", JSON.stringify(payload)],
    );
    await db.exec("RESET ROLE");
    const stored = await db.query<{
      title: string;
      is_quick_review: boolean;
      rating: number;
      tags: string[];
      vendor_tags: string[];
      ad_disclosure: string;
      sponsorship_detail: string | null;
    }>(
      `SELECT title, is_quick_review, rating, tags, vendor_tags, ad_disclosure, sponsorship_detail
       FROM public.community_posts WHERE id = $1`,
      [result.rows[0]!.receipt.post.id],
    );
    return stored.rows[0];
  } finally {
    await db.exec("RESET ROLE").catch(() => undefined);
    await db.close();
  }
}

describe("15초 후기 저장 계약 — 라우트와 저장 RPC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: ACTOR } } })) },
    });
  });

  it("예전 웹 본문은 요청 키가 없어 라우트가 본문을 읽기 전에 400 으로 거절한다", async () => {
    const { rpc } = captureSavePayload();

    const response = await POST(request(LEGACY_WEB_BODY));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_POST_IDEMPOTENCY_REQUIRED",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("저장 RPC 는 vendor_tags 에 든 업체 이름을 COMMUNITY_POST_PAYLOAD_INVALID 로 거절한다", async () => {
    // 라우트가 걸러 주지 않던 시절 RPC 에 그대로 가던 payload 모양.
    const payload = {
      ...LEGACY_WEB_BODY,
      slides: null,
      cost_data: null,
      sponsorship_detail: null,
      price_data: null,
      poll: null,
    };
    await expect(saveInDatabase(payload)).rejects.toThrow(/COMMUNITY_POST_PAYLOAD_INVALID/u);
  }, 30_000);

  it("요청 키를 붙여도 업체 이름이 든 예전 본문은 RPC 에 닿기 전에 400 으로 돌아온다", async () => {
    const { rpc } = captureSavePayload();

    const response = await POST(request(LEGACY_WEB_BODY, KEY));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "COMMUNITY_POST_VENDOR_TAGS_INVALID",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["일반", { adDisclosure: "general" as const }, null],
    [
      "협찬",
      { adDisclosure: "sponsored" as const, sponsorshipDetail: "  드레스 대여비 1회 지원받음 " },
      "드레스 대여비 1회 지원받음",
    ],
  ])("지금 화면이 만드는 %s 본문은 라우트를 지나 실제 저장 RPC 에서 저장된다", async (_label, disclosure, detail) => {
    const { captured } = captureSavePayload();

    const response = await POST(request(buildQuickReviewPostBody({ ...draft, ...disclosure }), KEY));

    expect(response.status).toBe(201);
    expect(captured.payload).not.toBeNull();
    await expect(saveInDatabase(captured.payload!)).resolves.toEqual({
      title: "라벨르 스튜디오 후기",
      is_quick_review: true,
      rating: 4,
      tags: ["studio"],
      vendor_tags: [],
      ad_disclosure: disclosure.adDisclosure,
      sponsorship_detail: detail,
    });
  }, 30_000);
});
