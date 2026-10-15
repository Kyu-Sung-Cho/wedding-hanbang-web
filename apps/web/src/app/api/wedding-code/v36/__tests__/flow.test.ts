// 실제 36문항 HTTP 핸들러와 결과 엔진을 실행한다. SQL 자체 검증은 별도
// PGlite 회귀 검사에서 수행하며, 이 저장소 대체물은 트랜잭션 검증이 아니다.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { createSubmission, type Submission } from "@/lib/weddingCode36";
import { DEFAULT_SHARE_IDS, ITEMS } from "@/constants/weddingCode36";
import { accessHash } from "@/lib/weddingCode36Server/api";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import { POST as submit, PATCH as updateSharing, DELETE as deleteResponse } from "../response/route";
import { POST as pair } from "../pair/route";
import { GET as readReport } from "../couple-report/route";
import { GET as readInvite } from "../invite/route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimitPersistent: vi.fn(() => null), rateLimitKey: vi.fn(() => "v36-test") }));

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const EXPIRES_AT = "2100-01-08T00:00:00.000Z";
const request = (path: string, body: unknown, method = "POST") => new NextRequest(`http://localhost/api/wedding-code/v36/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const payload = (n: number, value: number | null = 3) => ({ ...createSubmission(value, { comparison: true, shareAlias: true }), consent: true, submission_id: uuid(n), access_token: uuid(n + 100_000) });
const reportRequest = (id: string, token: string) => new NextRequest(`http://localhost/api/wedding-code/v36/couple-report?response_id=${id}`, { headers: { "x-wedding-code-access-token": token } });

class Store {
  rows = new Map<string, { id: string; hash: string; submission: Submission }>();
  deleted = new Map<string, { id: string; hash: string }>();
  invites = new Map<string, string[]>();
  calls: { name: string; args: Record<string, unknown> }[] = [];
  fail = false;
  malformed: unknown = undefined;
  next = 1_000_000;
  private own(id: string, hash: string) { return [...this.rows.values()].find(row => row.id === id && row.hash === hash); }
  private linking(id: string, hash: string, token: string | null): Record<string, unknown> {
    if (!this.own(id, hash)) return { error: "unauthorized" };
    const existing = [...this.invites.entries()].find(([, ids]) => ids.includes(id));
    if (existing) return { pairing_status: existing[1].length === 1 ? "waiting" : "paired", invite_token: existing[0] };
    if (token === null) { const generated = uuid(this.next++); this.invites.set(generated, [id]); return { pairing_status: "waiting", invite_token: generated }; }
    const people = this.invites.get(token);
    if (!people) return { error: "invite_not_found" };
    if (people.length === 2) return { pairing_status: "full", invite_token: null };
    people.push(id); return { pairing_status: "paired", invite_token: token };
  }
  async rpc(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args });
    if (this.fail) return { data: null, error: { message: "database unavailable" } };
    if (this.malformed !== undefined) return { data: this.malformed, error: null };
    let data: Record<string, unknown>;
    const id = args.p_response_id as string; const hash = args.p_access_hash as string;
    if (name === "wc36_submit") {
      const key = args.p_submission_id as string; let row = this.rows.get(key); const recovered = Boolean(row);
      const tombstone = this.deleted.get(key);
      if (tombstone) return { data: { error: tombstone.hash === hash ? "deleted" : "unauthorized" }, error: null };
      if (row && row.hash !== hash) return { data: { error: "unauthorized" }, error: null };
      if (!row) { row = { id: uuid(this.next++), hash, submission: structuredClone(args.p_submission as Submission) }; this.rows.set(key, row); }
      const isLinked = [...this.invites.values()].some(ids => ids.includes(row.id));
      let linking = args.p_invite_token || isLinked ? this.linking(row.id, hash, args.p_invite_token as string | null) : { pairing_status: "unpaired", invite_token: null };
      if (["invite_not_found", "self_pair"].includes(String(linking.error))) linking = { pairing_status: "unpaired", invite_token: null, pairing_error: linking.error };
      data = { response_id: row.id, submission: row.submission, expires_at: EXPIRES_AT, recovered, ...linking };
    } else if (name === "wc36_pair") data = this.linking(id, hash, args.p_invite_token as string | null);
    else if (name === "wc36_invite_status") { const ids = this.invites.get(args.p_invite_token as string); data = { status: !ids ? "not_found" : ids.length === 2 ? "full" : "waiting" }; }
    else if (name === "wc36_update_sharing") {
      const row = this.own(id, hash); if (!row) data = { error: "unauthorized" };
      else { row.submission = { ...row.submission, ...args.p_settings as Pick<Submission, "allow_couple_comparison" | "share_alias" | "share_item_ids"> }; data = { submission: row.submission, expires_at: EXPIRES_AT }; }
    } else if (name === "wc36_delete") {
      const entry = [...this.rows.entries()].find(([, row]) => row.id === id && row.hash === hash);
      const tombstone = [...this.deleted.values()].find(row => row.id === id && row.hash === hash);
      if (!entry && !tombstone) data = { error: "unauthorized" };
      else {
        if (entry) {
          this.deleted.set(entry[0], { id, hash }); this.rows.delete(entry[0]);
          for (const [token, members] of this.invites) if (members.includes(id)) this.invites.delete(token);
        }
        data = { deleted: true };
      }
    } else {
      const row = this.own(id, hash);
      const entry = [...this.invites.entries()].find(([, ids]) => ids.includes(id));
      if (!row) data = { error: "unauthorized" };
      else if (!entry) data = { status: "unpaired" };
      else if (entry[1].length === 1) data = { status: "waiting", invite_token: entry[0] };
      else { const other = [...this.rows.values()].find(r => r.id === entry[1].find(value => value !== id)); data = { status: "ready", own_submission: row.submission, partner_submission: other?.submission }; }
    }
    return { data: structuredClone(data), error: null };
  }
}

let store: Store;
beforeEach(() => { store = new Store(); vi.mocked(createAdminClient).mockReset(); vi.mocked(createAdminClient).mockReturnValue({ rpc: store.rpc.bind(store) } as unknown as ReturnType<typeof createAdminClient>); vi.mocked(checkRateLimitPersistent).mockResolvedValue(null); });

async function connected(first = 1, second = 5) {
  const a = payload(1, first); const b = payload(2, second);
  const ra = await (await submit(request("response", a))).json();
  const invite = await (await pair(request("pair", { response_id: ra.id, access_token: a.access_token }))).json();
  const rb = await (await submit(request("response", { ...b, invite_token: invite.coupleToken }))).json();
  return { a, b, ra, rb, invite };
}

describe("36문항 실제 API 흐름", () => {
  it.each([1, 2, 3, 4, 5])("36개 전부 %i점 저장·재시도에서 원본 보존", async value => {
    const body = payload(value, value); const first = await submit(request("response", body));
    const saved = await first.json();
    expect(first.status).toBe(200); expect(first.headers.get("cache-control")).toContain("no-store");
    expect(saved.expiresAt).toBe(EXPIRES_AT);
    expect(Object.values(saved.submission.answers)).toEqual(Array(36).fill(value));
    expect(saved.submission).not.toHaveProperty("access_token");
    expect(store.calls[0].args.p_access_hash).toBe(accessHash(body.access_token));
    const retry = await (await submit(request("response", { ...body, answers: createSubmission(6 - value).answers }))).json();
    expect(retry.id).toBe(saved.id); expect(retry.recovered).toBe(true); expect(retry.submission.answers).toEqual(saved.submission.answers);
  });
  it.each([1, 2, 3, 4, 5].flatMap(a => [1, 2, 3, 4, 5].map(b => [a, b])))("전부 %i점 / 전부 %i점 커플 결과", async (first, second) => {
    const { a, b, ra, rb, invite } = await connected(first, second);
    expect(rb.pairingStatus).toBe("paired");
    const response = await readReport(reportRequest(ra.id, a.access_token)); const report = await response.json();
    expect(response.status).toBe(200); expect(report.status).toBe("ready"); expect(report.viewer).toBe("a");
    expect(report.report.names.a.name).toBe("아직 미정인 수달"); expect(report.report.body.core_cards).toHaveLength(9);
    for (const card of report.report.body.core_cards) {
      expect(card.a_mean).toBe(first); expect(card.b_mean).toBe(second);
      for (const e of card.evidence) { expect(e.a).toBe(first); expect(e.b).toBe(second); expect(e.gap).toBe(Math.abs(first - second)); expect(e.discussion_candidate).toBe(Math.abs(first - second) >= 2); }
    }
    const reversed = await (await readReport(reportRequest(rb.id, b.access_token))).json();
    expect(reversed.report.body.core_cards[0].a_mean).toBe(second);
    const third = await (await submit(request("response", { ...payload(3), invite_token: invite.coupleToken }))).json();
    expect(third.pairingStatus).toBe("full"); expect(third.coupleToken).toBeNull();
  });
  it("초대만 가진 제3자는 결과를 읽을 수 없고 이름·답변도 공개하지 않음", async () => {
    const { a, ra, invite } = await connected();
    expect((await readReport(reportRequest(ra.id, invite.coupleToken))).status).toBe(403);
    expect((await readReport(new NextRequest(`http://localhost/api/wedding-code/v36/couple-report?ct=${invite.coupleToken}`))).status).toBe(403);
    const publicData = await (await readInvite(new NextRequest(`http://localhost/api/wedding-code/v36/invite?token=${invite.coupleToken}`))).json();
    expect(publicData).toEqual({ status: "full" });
    expect((await readReport(reportRequest(ra.id, a.access_token))).headers.get("cache-control")).toBe("private, no-store");
  });
  it("잘못된 초대여도 개인 결과가 저장되고 같은 재시도는 원본 결과를 복구", async () => {
    const body = { ...payload(1, 2), invite_token: uuid(999) };
    const response = await submit(request("response", body)); const saved = await response.json();
    expect(response.status).toBe(200); expect(saved.success).toBe(true); expect(saved.pairingError).toBe("invite_not_found");
    expect(saved.pairingStatus).toBe("unpaired"); expect(saved.coupleToken).toBeNull(); expect(saved.submission.answers.B1).toBe(2);
    const retry = await (await submit(request("response", { ...body, answers: createSubmission(5).answers }))).json();
    expect(retry.id).toBe(saved.id); expect(retry.recovered).toBe(true); expect(retry.submission.answers.B1).toBe(2);
    const newInvite = await (await pair(request("pair", { response_id: saved.id, access_token: body.access_token }))).json();
    expect(newInvite.success).toBe(true); expect(newInvite.pairingStatus).toBe("waiting");
  });
  it("이름 공유만으로 비공개 문항이 열리지 않고 공유 교집합만 비교", async () => {
    const { a, b, ra, rb } = await connected();
    for (const [body, saved, ids] of [[a, ra, ["B1", "N8"]], [b, rb, ["B1", "N9"]]] as const) {
      expect((await updateSharing(request("response", { response_id: saved.id, access_token: body.access_token, allow_couple_comparison: true, share_alias: true, share_item_ids: ids }, "PATCH"))).status).toBe(200);
    }
    const result = await (await readReport(reportRequest(ra.id, a.access_token))).json();
    expect(result.report.names).not.toBeNull(); expect(result.report.body.shared_item_ids).toEqual(["B1"]);
    expect(result.report.body.core_cards).toHaveLength(1); expect(result.report.body.core_cards[0].a_mean).toBeNull();
    expect(result.report.body.single_note_cards).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("missing_reasons"); expect(result).not.toHaveProperty("partner_submission");
  });
  it("비교 철회가 즉시 결과에 반영되고 재제출도 철회를 되돌리지 않음", async () => {
    const { a, ra } = await connected();
    const updated = await (await updateSharing(request("response", { response_id: ra.id, access_token: a.access_token, allow_couple_comparison: false, share_alias: false, share_item_ids: [] }, "PATCH"))).json();
    expect(updated.submission.answers).toEqual(a.answers);
    const report = await (await readReport(reportRequest(ra.id, a.access_token))).json();
    expect(report.report.names).toBeNull(); expect(report.report.body.core_cards).toEqual([]); expect(report.report.body.status).toBe("no_comparison_consent");
    expect((await (await submit(request("response", a))).json()).submission.allow_couple_comparison).toBe(false);
  });
  it("미응답과 이유는 3점으로 채워지거나 상대에게 공개되지 않음", async () => {
    const a = payload(1); a.answers.B1 = null; a.missing_reasons.B1 = "not_answered";
    const ra = await (await submit(request("response", a))).json();
    const link = await (await pair(request("pair", { response_id: ra.id, access_token: a.access_token }))).json();
    await submit(request("response", { ...payload(2), invite_token: link.coupleToken }));
    const report = await (await readReport(reportRequest(ra.id, a.access_token))).json();
    const card = report.report.body.core_cards.find((c: { criterion: string }) => c.criterion === "B");
    expect(card.a_mean).toBeNull(); expect(card.evidence.find((e: { item_id: string }) => e.item_id === "B1").gap).toBeNull();
    expect(JSON.stringify(report)).not.toContain("not_answered");
  });
  it.each([
    { consent: false }, { questionnaire_version: "old" }, { questionnaire_fingerprint: "wrong" },
    { answers: {} }, { access_token: "secret" }, { share_item_ids: ["unknown"] },
    { share_item_ids: ["B1", "B1"] }, { share_alias: "yes" }, { allow_couple_comparison: "yes" },
    { answers: Object.fromEntries(ITEMS.map(item => [item.id, true])) },
  ])("잘못된 입력은 저장 전에 거부: %j", async override => {
    expect((await submit(request("response", { ...payload(1), ...override }))).status).toBe(400); expect(store.rows.size).toBe(0);
  });
  it("서버 오류·잘못된 DB 결과·과대 요청·요청 제한을 성공으로 보이지 않음", async () => {
    store.fail = true; expect((await submit(request("response", payload(1)))).status).toBe(503);
    store.fail = false; store.malformed = { pairing_status: "paired" }; expect((await submit(request("response", payload(1)))).status).toBe(503);
    store.malformed = undefined;
    expect((await submit(request("response", { ...payload(1), junk: "x".repeat(20_000) }))).status).toBe(413);
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(NextResponse.json({ error: "limited" }, { status: 429 }));
    expect((await submit(request("response", payload(1)))).status).toBe(429);
  });
  it("공유 수정에서 답변 주입을 무시하고 알려진 문항만 허용", async () => {
    const { a, ra } = await connected();
    const common = { response_id: ra.id, access_token: a.access_token, allow_couple_comparison: true, share_alias: false };
    expect((await updateSharing(request("response", { ...common, share_item_ids: ["unknown"] }, "PATCH"))).status).toBe(400);
    const updated = await (await updateSharing(request("response", { ...common, share_item_ids: [...DEFAULT_SHARE_IDS], answers: createSubmission(5).answers }, "PATCH"))).json();
    expect(updated.submission.answers).toEqual(a.answers);
    expect(updated.expiresAt).toBe(EXPIRES_AT);
  });
  it.each(["a", "b"])("%s가 삭제하면 비교는 중단하고 상대의 개인 응답은 보존", async side => {
    const { a, b, ra, rb, invite } = await connected();
    const [own, saved, partner, other] = side === "a" ? [a, ra, b, rb] : [b, rb, a, ra];
    const credentials = { response_id: saved.id, access_token: own.access_token };
    const response = await deleteResponse(request("response", credentials, "DELETE"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ success: true, deleted: true });
    expect(store.rows.size).toBe(1); expect(store.invites.size).toBe(0);
    expect((await (await readReport(reportRequest(other.id, partner.access_token))).json()).status).toBe("unpaired");
    expect((await (await readInvite(new NextRequest(`http://localhost/api/wedding-code/v36/invite?token=${invite.coupleToken}`))).json()).status).toBe("not_found");
    expect((await deleteResponse(request("response", credentials, "DELETE"))).status).toBe(200);
    const replay = await submit(request("response", own));
    expect(replay.status).toBe(410); expect((await replay.json()).resultStatus).toBe("deleted");
    expect(store.rows.size).toBe(1);
  });
  it("삭제에 본인 접근 키가 필요하고 잘못된 요청은 자료를 바꾸지 않음", async () => {
    const { a, ra } = await connected();
    expect((await deleteResponse(request("response", { response_id: ra.id }, "DELETE"))).status).toBe(400);
    expect((await deleteResponse(request("response", { response_id: ra.id, access_token: uuid(444) }, "DELETE"))).status).toBe(403);
    expect(store.rows.size).toBe(2); expect(store.invites.size).toBe(1);
    store.fail = true;
    expect((await deleteResponse(request("response", { response_id: ra.id, access_token: a.access_token }, "DELETE"))).status).toBe(503);
    store.fail = false; store.malformed = { deleted: false };
    expect((await deleteResponse(request("response", { response_id: ra.id, access_token: a.access_token }, "DELETE"))).status).toBe(503);
  });
  it("만료된 결과를 성공이나 미응답으로 바꾸지 않고 410으로 알림", async () => {
    store.malformed = { error: "expired" };
    const result = await submit(request("response", payload(777)));
    expect(result.status).toBe(410); expect((await result.json()).resultStatus).toBe("expired");
  });
  it("서버에서 기한을 돌려주지 않으면 저장 성공으로 알리지 않음", async () => {
    const body = payload(1);
    store.malformed = { response_id: uuid(900), submission: createSubmission(3), recovered: false, pairing_status: "unpaired", invite_token: null };
    expect((await submit(request("response", body))).status).toBe(503);
    store.malformed = { submission: createSubmission(3), expires_at: "not-a-date" };
    expect((await updateSharing(request("response", { response_id: uuid(900), access_token: body.access_token, allow_couple_comparison: true, share_alias: false, share_item_ids: [] }, "PATCH"))).status).toBe(503);
  });
});
