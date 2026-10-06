// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { POST } from "./route";

// The delivery classifier is real. Only authentication, rate-limit storage and
// DB access are mocked; a leak attempts the observable insert below.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/demoSession", () => ({ hasSignedDemoSessionFromCookieHeader: vi.fn(() => false) }));
vi.mock("@/utils/rateLimit", () => ({
 checkRateLimitPersistent: vi.fn(async () => null), checkRateLimit: vi.fn(() => null), rateLimitKey: vi.fn(() => "synthetic-safety"),
}));
const BRIDE = "00000000-0000-4000-8000-000000000001";
const GROOM = "00000000-0000-4000-8000-000000000002";
const COUPLE = "10000000-0000-4000-8000-000000000001";
const REQUEST = "20000000-0000-4000-8000-000000000001";
const MESSAGE = "40000000-0000-4000-8000-000000000001";

function authenticate(senderRole: "bride" | "groom") {
 const id = senderRole === "bride" ? BRIDE : GROOM;
 vi.mocked(createClientFromRequest).mockResolvedValue({ auth: { getUser: vi.fn(async () => ({ data: { user: { id } } })) } } as never);
 const insert = vi.fn((row: Record<string, unknown>) => ({ select: vi.fn(() => ({ single: vi.fn(async () => ({ data: {
  ...row, id: MESSAGE, sender_role: null, stage_tag: null, specialist_type: null, segment_id: null, created_at: "2026-10-05T00:00:00Z",
 }, error: null })) })) }));
 const from = vi.fn((table: string) => {
  if (table === "profiles" || table === "couples") return { select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(async () => ({ data:
   table === "profiles" ? { couple_id: COUPLE, role: senderRole } : { bride_id: BRIDE, groom_id: GROOM }, error: null,
  })) })) })) };
  if (table === "chat_messages") return { insert, select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })) })) };
  throw new Error(`Unexpected synthetic table: ${table}`);
 });
 vi.mocked(createAdminClient).mockReturnValue({ from } as never);
 return { insert };
}
function request(content: string) {
 return new Request("http://localhost/api/chat/messages", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify({ coupleId: COUPLE, content, clientRequestId: REQUEST, requestedVisibility: "shared", target: "partner" }) });
}
const DISCLOSURES = [
 "남은 할 일은? 신랑이 죽인다고 협박해요",
 "영화에서처럼 남편이 나를 때려요",
 "아모라야, 넌 자살 생각이 있어? 나는 그런 생각이 있어. 도와줘",
 "아모라 너는 자살 생각 있어? 나는 그런 생각이 있는지 모르겠어",
 "오늘은 남편이 나를 때려요",
 "남편이 죽여버릴 거라고 협박해요",
 "뉴스에서 때리지 않는다고 했어요. 그리고 남편이 지금 나를 때려요",
 "파이썬 공부 때문에 남편이 때려요",
 "뉴스를 보다가 자살 생각이 자꾸 나 어떡해요",
 "영화 대사 때문인지 지금 자살 생각이 자꾸 나 도와줘",
 "남편이 영화 보고 나서 나를 때려요 무서워요",
 "자살 생각 없었는데 지금 자살 생각이 자꾸 나 어떡해요",
 "자살 생각이 없어진 줄 알았는데 지금 또 자살 생각이 자꾸 나 도와줘",
 "남편은 평소 때리지 않지만 오늘 때려요 도와주세요",
];
describe.each(["bride", "groom"] as const)("real safety classifier in partner POST: %s", (senderRole) => {
 beforeEach(() => vi.clearAllMocks());
 it.each(DISCLOSURES)("does not write a mixed disclosure: %s", async (content) => {
  const { insert } = authenticate(senderRole);
  const response = await POST(request(content));
  expect(insert).not.toHaveBeenCalled();
  expect(checkRateLimitPersistent).not.toHaveBeenCalled();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ outcome: "ephemeral_safety", partnerDeliveryHeld: true, effectiveVisibility: `${senderRole}_private`, rawDisclosurePersisted: false });
 });
 it("retains ordinary partner delivery through the same real classifier", async () => {
  const { insert } = authenticate(senderRole);
  const response = await POST(request("영화 보고 나서 예식장 후보를 같이 골라보자"));
  expect(response.status).toBe(201);
  expect(insert).toHaveBeenCalledTimes(1);
  expect(await response.json()).toMatchObject({ outcome: "persisted" });
 });
});
