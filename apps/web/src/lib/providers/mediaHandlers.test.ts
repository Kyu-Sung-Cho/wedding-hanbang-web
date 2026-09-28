// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSignupConsentServerEvidence } from "@hanbang/shared";
const mocks = vi.hoisted(() => ({ from: vi.fn(), download: vi.fn(), remove: vi.fn(), upload: vi.fn(), auth: vi.fn(), rpc: vi.fn(), serviceRpc: vi.fn(), deleting: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.serviceRpc, storage: { from: () => ({ download: mocks.download, remove: mocks.remove, upload: mocks.upload }) } }) }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: async () => ({ auth: { getUser: mocks.auth }, rpc: mocks.rpc }) }));
vi.mock("@/lib/accountDeletion/communityStorageSaga", () => ({ hasActiveAccountDeletion: mocks.deleting }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimitPersistent: mocks.rate, rateLimitKey: () => "test" }));
vi.mock("./imageProcessing", () => ({ PROVIDER_IMAGE_MAX_BYTES: 5242880, processProviderImage: async () => Buffer.from("webp") }));
import { readProviderMedia, removeProviderMedia, uploadProviderMedia } from "./mediaHandlers";
const owner = "aa000000-0000-4000-8000-000000000001";
const provider = "aa000000-0000-4000-8000-000000000002";
const media = "aa000000-0000-4000-8000-000000000003";
const path = `${owner}/${provider}/${media}.webp`;
const profile = { id: provider, owner_id: owner, approval_status: "approved", publication_status: "published" };
const asset = { id: media, provider_id: provider, storage_path: path, mime_type: "image/webp", status: "ready", created_at: new Date().toISOString() };
const request = () => new Request(`https://hanbang.ai/api/provider/profiles/${provider}/media/${media}`);
let profileRows: unknown[];
let mediaRows: unknown[];
beforeEach(() => {
  vi.clearAllMocks();
  profileRows = [profile, profile]; mediaRows = [asset, { status: "ready" }];
  mocks.from.mockImplementation((table: string) => {
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data: (table === "provider_profiles" ? profileRows : mediaRows).shift(), error: null })) };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); return query;
  });
  mocks.auth.mockResolvedValue({ data: { user: { id: owner, app_metadata: { signup_consent: buildSignupConsentServerEvidence({ termsAgreed: true, privacyAgreed: true, ageOver14Confirmed: true, marketingAgreed: false, consentPolicyVersion: "2026-09-28" }, "2026-09-28T00:00:00.000Z") } } }, error: null });
  mocks.deleting.mockResolvedValue(false); mocks.rate.mockResolvedValue(null);
  mocks.download.mockResolvedValue({ data: new Blob(["webp"]), error: null });
  mocks.remove.mockResolvedValue({ data: [], error: null }); mocks.upload.mockResolvedValue({ data: {}, error: null });
  mocks.rpc.mockResolvedValue({ data: { id: media, storage_path: path }, error: null });
});
describe("공개 상태를 따르는 비공개 사진 전달", () => {
  it("승인·공개 사진만 캐시 없이 제공한다", async () => {
    const response = await readProviderMedia(request(), provider, media);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.auth).not.toHaveBeenCalled();
  });
  it("미공개 사진은 소유자만 미리본다", async () => {
    profileRows = [{ ...profile, publication_status: "draft" }, { ...profile, publication_status: "draft" }];
    expect((await readProviderMedia(request(), provider, media)).status).toBe(200);
    profileRows = [{ ...profile, publication_status: "draft" }]; mediaRows = [asset];
    mocks.auth.mockResolvedValue({ data: { user: { id: "someone-else" } }, error: null });
    expect((await readProviderMedia(request(), provider, media)).status).toBe(404);
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });
  it("정지·삭제중인 프로필은 원본 주소를 알아도 사진을 받지 못한다", async () => {
    profileRows = [{ ...profile, approval_status: "suspended" }];
    expect((await readProviderMedia(request(), provider, media)).status).toBe(404);
    profileRows = [profile]; mediaRows = [asset]; mocks.deleting.mockResolvedValue(true);
    expect((await readProviderMedia(request(), provider, media)).status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("파일을 읽는 동안 비공개 전환되면 응답 bytes를 내보내지 않는다", async () => {
    profileRows = [profile, { ...profile, publication_status: "paused" }];
    expect((await readProviderMedia(request(), provider, media)).status).toBe(404);
    expect(mocks.download).toHaveBeenCalledOnce();
  });
  it("사진 공개 철회 후 Storage 통신이 끊겨도 철회 결과를 유지한다", async () => {
    mocks.remove.mockRejectedValue(new Error("network"));
    const response = await removeProviderMedia(new Request(request().url, { method: "DELETE", headers: { origin: "https://hanbang.ai" } }), provider, media);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ success: true, cleanup_pending: true });
  });
  it("업로드 확정 응답이 유실돼도 이미 ready인 파일을 삭제하지 않는다", async () => {
    mocks.serviceRpc.mockResolvedValueOnce({ data: { ...asset, status: "uploading" }, error: null }).mockResolvedValueOnce({ data: { aborted: false, storage_path: null }, error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "transport-lost" } });
    const form = new FormData(); form.set("file", new File(["photo"], "image.webp", { type: "image/webp" })); form.set("caption", ""); form.set("alt_text", "촬영 사진"); form.set("rights_confirmed", "true");
    const response = await uploadProviderMedia(new Request(request().url, { method: "POST", headers: { origin: "https://hanbang.ai" }, body: form }), provider);
    expect(response.status).toBe(503); expect(mocks.upload).toHaveBeenCalledOnce(); expect(mocks.remove).not.toHaveBeenCalled();
  });
});
