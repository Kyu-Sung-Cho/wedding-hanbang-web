import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { GET, POST, PATCH, DELETE } from "@/app/api/amora/notes/route";
import {
  evaluateSavedNoteSource,
  type SavedNoteSourceMessage,
} from "../savedNoteSource";

const NOTES_ROUTE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../app/api/amora/notes/route.ts",
);

// P0-3: 저장 노트는 커플 전체가 읽는다. 그런데 생성 API는 클라이언트가 준 임의 본문을
// 그대로 넣고, `messageId`는 선택이며, 있어도 그 메시지를 조회하지 않았다. 그래서
// 개인 상담 내용을 복사해 보내면 출처 없는 커플 공유물로 영구 보존될 수 있었고,
// 원문을 지워도 그 사본은 남았다.
//
// 목표 아키텍처 §6 불변식 5·6·7: 파생물은 canonical source ID에서 서버가 읽고,
// 원본보다 넓은 audience를 가질 수 없으며, 넓히려면 별도 declassification이 필요하다.
// declassification은 아직 없으므로 private → shared는 **거부**가 맞다(fail-closed).
//
// 실제 상담 원문 대신 합성 표식만 사용한다.

const COUPLE = "40000000-0000-4000-8000-0000000000c1";
const OTHER_COUPLE = "40000000-0000-4000-8000-0000000000c2";
const SYNTHETIC_SOURCE_TEXT = "SYNTHETIC-P03-CANONICAL-SOURCE-TEXT";
const SYNTHETIC_FORGED_TEXT = "SYNTHETIC-P03-CLIENT-SUPPLIED-TEXT";

type NoteDbRow = { id: string; content: string; memo: string | null; message_id: string; saved_by: string; created_at: string };
const apiFixture = vi.hoisted(() => ({
  profileError: null as unknown, sourceError: null as unknown, countError: null as unknown,
  existingError: null as unknown, insertError: null as unknown, writeError: null as unknown,
  count: 0 as number | null, existing: null as NoteDbRow | null, inserted: null as NoteDbRow | null,
  insertCalls: 0, existingReads: 0, raceExisting: null as NoteDbRow | null,
  input: null as Record<string, unknown> | null,
  rows: [] as NoteDbRow[],
  currentMemo: null as string | null,
  memoFilter: undefined as string | null | undefined,
  sourceRows: [] as Array<{ id: string; couple_id: string; visibility: string; role?: string; sender_type?: string }>,
  projections: [] as string[],
}));
const NOTE_ID = "50000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "50000000-0000-4000-8000-000000000002";
const USER_ID = "50000000-0000-4000-8000-000000000003";

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
  rpc: async (name: string, values: Record<string, unknown>) => {
    if (name !== "save_own_amora_note") throw new Error("Unexpected notes RPC");
    apiFixture.input = values; apiFixture.existingReads += 1;
    if (apiFixture.existingError) return { data: null, error: { code: "57014" } };
    if (apiFixture.existing) return { data: { note: apiFixture.existing, already_saved: true }, error: null };
    if (apiFixture.countError || apiFixture.count === null) return { data: null, error: { code: "55000" } };
    if (apiFixture.count >= 300) return { data: null, error: { code: "54000" } };
    apiFixture.insertCalls += 1;
    if (apiFixture.raceExisting) { apiFixture.existingReads += 1; return { data: { note: apiFixture.raceExisting, already_saved: true }, error: null }; }
    return { data: apiFixture.inserted ? { note: apiFixture.inserted, already_saved: false } : null, error: apiFixture.insertError };
  },
  from: (table: string) => {
    let operation = "read";
    let limit = 300;
    let cursor: { createdAt: string; id: string } | null = null;
    const filters = new Map<string, unknown>();
    let included: { column: string; values: string[] } | null = null;
    const query = {
      select: (columns?: string, options?: { head?: boolean }) => { apiFixture.projections.push(`${table}:${columns}`); if (options?.head) operation = "count"; return query; },
      eq: (column: string, value: string) => { filters.set(column, value); if (operation === "update" && column === "memo") apiFixture.memoFilter = value; return query; },
      in: (column: string, values: string[]) => { included = { column, values }; return query; },
      is: (column: string, value: null) => { filters.set(column, value); if (operation === "update" && column === "memo") apiFixture.memoFilter = value; return query; }, order: () => query,
      limit: (value: number) => { limit = value; return query; },
      or: (filter: string) => {
        const match = /^created_at\.lt\.([^,]+),and\(created_at\.eq\.[^,]+,id\.lt\.([0-9a-f-]+)\)$/.exec(filter);
        if (!match) throw new Error("Unexpected note cursor filter");
        cursor = { createdAt: match[1], id: match[2] }; return query;
      },
      insert: (values: Record<string, unknown>) => { operation = "insert"; apiFixture.insertCalls += 1; apiFixture.input = values; return query; },
      update: (values: Record<string, unknown>) => { operation = "update"; apiFixture.input = values; return query; },
      delete: () => { operation = "delete"; return query; },
      maybeSingle: async () => {
        if (table === "profiles") return { data: apiFixture.profileError ? null : { couple_id: COUPLE }, error: apiFixture.profileError };
        if (table === "chat_messages") return { data: apiFixture.sourceError ? null : sharedMessage(), error: apiFixture.sourceError };
        if (operation === "insert") {
          if (apiFixture.raceExisting) apiFixture.existing = apiFixture.raceExisting;
          return { data: apiFixture.inserted, error: apiFixture.insertError };
        }
        if (operation === "update") return { data: apiFixture.memoFilter !== undefined && apiFixture.memoFilter !== apiFixture.currentMemo ? null : apiFixture.inserted, error: apiFixture.writeError };
        if (operation === "delete") {
          const row = apiFixture.existing;
          if (apiFixture.writeError) return { data: null, error: apiFixture.writeError };
          if (row && (!filters.has("saved_by") || filters.get("saved_by") === row.saved_by) && (!filters.has("memo") || filters.get("memo") === row.memo)) {
            apiFixture.existing = null; return { data: { id: row.id }, error: null };
          }
          return { data: null, error: null };
        }
        apiFixture.existingReads += 1;
        return { data: apiFixture.existing, error: apiFixture.existingError };
      },
      then: (resolveValue: (value: unknown) => unknown) => Promise.resolve({
        data: table === "chat_messages" ? apiFixture.sourceRows.filter(row => Array.from(filters).every(([key,value]) => row[key as keyof typeof row] === value) && (!included || included.values.includes(row.id))) : operation === "read" ? apiFixture.rows.filter(row => (!included || included.values.includes(row.message_id)) && (!cursor || row.created_at < cursor.createdAt || (row.created_at === cursor.createdAt && row.id < cursor.id))).sort((a,b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).slice(0, limit) : null,
        count: apiFixture.count,
        error: table === "chat_messages" ? apiFixture.sourceError : operation === "count" ? apiFixture.countError : apiFixture.writeError,
      }).then(resolveValue),
    };
    return query;
  },
}) }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimit: () => null, rateLimitKey: () => "synthetic-notes" }));
vi.mock("@/utils/log", () => ({ log: { error: vi.fn() } }));

function noteRow(memo: string | null = null): NoteDbRow {
  return { id: NOTE_ID, content: SYNTHETIC_SOURCE_TEXT, memo, message_id: MESSAGE_ID, saved_by: USER_ID, created_at: "2026-09-06T00:00:00Z" };
}

function noteRequest(method: string, body: Record<string, unknown>) {
  return new Request("https://hanbang.ai/api/amora/notes", {
    method, headers: { authorization: "Bearer synthetic", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("saved note HTTP receipts and retries", () => {
  it("keeps saved answers discoverable in the board and preserves the previous route", () => {
    const board = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../components/app/amora-board/AmoraDecisionBoard.tsx"), "utf8");
    const previousPage = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../app/(app)/saved/page.tsx"), "utf8");
    expect(board).toContain('selectBoard("saved")');
    expect(board).toContain("저장한 답변");
    expect(previousPage).toContain('redirect("/wedding/chat/board?view=saved")');
  });
  beforeEach(() => {
    Object.assign(apiFixture, { profileError: null, sourceError: null, countError: null, existingError: null,
      insertError: null, writeError: null, count: 0, existing: null, inserted: noteRow(),
      insertCalls: 0, existingReads: 0, raceExisting: null, input: null, rows: [], currentMemo: null, memoFilter: undefined,
      sourceRows: [{ id: MESSAGE_ID, couple_id: COUPLE, visibility: "shared" }], projections: [] });
  });

  it.each(["profileError", "sourceError", "countError", "existingError"] as const)("reports %s as an unavailable save instead of a missing source or successful insert", async (key) => {
    apiFixture[key] = { code: "57014" };
    const response = await POST(noteRequest("POST", { messageId: MESSAGE_ID }));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("saved", true);
    expect(apiFixture.insertCalls).toBe(0);
  });

  it("retries a previously saved message even when the note limit has been reached", async () => {
    apiFixture.count = 300; apiFixture.existing = noteRow("original memo");
    const response = await POST(noteRequest("POST", { messageId: MESSAGE_ID, memo: "new memo" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: true, id: NOTE_ID, alreadySaved: true, memo: "original memo", memoApplied: false });
    expect(apiFixture.insertCalls).toBe(0);
  });

  it("returns the actual canonical insert receipt", async () => {
    apiFixture.inserted = noteRow("new memo");
    const response = await POST(noteRequest("POST", { messageId: MESSAGE_ID, memo: "new memo", content: SYNTHETIC_FORGED_TEXT }));
    expect(await response.json()).toMatchObject({ saved: true, id: NOTE_ID, alreadySaved: false, memo: "new memo", memoApplied: true });
    expect(apiFixture.input).toEqual({ p_couple_id: COUPLE, p_message_id: MESSAGE_ID, p_memo: "new memo" });
    expect(JSON.stringify(apiFixture.input)).not.toContain(SYNTHETIC_FORGED_TEXT);
  });

  it("recovers a unique race by reading the persisted note and memo", async () => {
    apiFixture.insertError = { code: "23505" }; apiFixture.inserted = null;
    apiFixture.raceExisting = noteRow("partner memo");
    const response = await POST(noteRequest("POST", { messageId: MESSAGE_ID, memo: "my memo" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: true, id: NOTE_ID, alreadySaved: true, memo: "partner memo", memoApplied: false });
    expect(apiFixture.existingReads).toBe(2);
  });

  it.each([null, { code: "23505" }])("does not claim success without a verified note row (insert error %j)", async (error) => {
    apiFixture.inserted = null; apiFixture.insertError = error;
    const response = await POST(noteRequest("POST", { messageId: MESSAGE_ID }));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("saved", true);
  });

  it("fails closed when an exact note count is unavailable", async () => {
    apiFixture.count = null;
    expect((await POST(noteRequest("POST", { messageId: MESSAGE_ID }))).status).toBe(503);
    expect(apiFixture.insertCalls).toBe(0);
  });
  it("returns a retryable failure instead of saved success when the source lock is busy", async () => {
    apiFixture.insertError = { code: "55P03" }; apiFixture.inserted = null;
    const response = await POST(noteRequest("POST", { messageId: MESSAGE_ID }));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("saved", true);
  });

  it("returns the updated note identity and the stored memo", async () => {
    apiFixture.inserted = noteRow("updated memo");
    const response = await PATCH(noteRequest("PATCH", { id: NOTE_ID, memo: "updated memo", expectedMemo: null }));
    expect(await response.json()).toMatchObject({ updated: true, id: NOTE_ID, memo: "updated memo" });
  });

  it("refuses a versionless memo update without writing over a newer memo", async () => {
    apiFixture.currentMemo = "newer memo";
    apiFixture.inserted = noteRow("stale edit");
    const response = await PATCH(noteRequest("PATCH", { id: NOTE_ID, memo: "stale edit" }));
    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty("updated", true);
    expect(apiFixture.input).toBeNull();
  });

  it.each([7, true, {}, [], "x".repeat(501)])("rejects an invalid memo version without writing: %j", async expectedMemo => {
    const response = await PATCH(noteRequest("PATCH", { id: NOTE_ID, memo: "updated", expectedMemo }));
    expect(response.status).toBe(400);
    expect(apiFixture.input).toBeNull();
  });

  it.each([null, "original memo"])("binds a memo update to the exact previously read value %j", async (expectedMemo) => {
    apiFixture.currentMemo = "partner changed memo";
    const response = await PATCH(noteRequest("PATCH", { id: NOTE_ID, memo: "my new memo", expectedMemo }));
    expect(response.status).toBe(409);
    expect(apiFixture.memoFilter).toBe(expectedMemo);
    expect(await response.json()).not.toHaveProperty("updated", true);
  });
  it("compares an existing memo byte-for-byte instead of trimming its CAS value", async () => {
    apiFixture.currentMemo = " original memo "; apiFixture.inserted = noteRow("updated");
    const response = await PATCH(noteRequest("PATCH", { id: NOTE_ID, memo: "updated", expectedMemo: " original memo " }));
    expect(response.status).toBe(200);
    expect(apiFixture.memoFilter).toBe(" original memo ");
  });

  it.each([null, "old memo", " old memo "])("does not delete a changed memo from stale approval: %j", async expectedMemo => {
    apiFixture.existing = noteRow("new memo");
    const response = await DELETE(noteRequest("DELETE", { id: NOTE_ID, expectedMemo }));
    expect(response.status).toBe(409);
    expect(apiFixture.existing?.memo).toBe("new memo");
    expect(await response.json()).toMatchObject({ code: "SAVED_NOTE_CHANGED" });
  });

  it("keeps delete idempotent and returns the requested identity", async () => {
    const response = await DELETE(noteRequest("DELETE", { id: NOTE_ID, expectedMemo: null }));
    expect(await response.json()).toEqual({ deleted: true, id: NOTE_ID });
  });

  it.each([{}, { expectedMemo: 7 }, { expectedMemo: "x".repeat(501) }])("fails a missing or invalid delete approval closed: %j", async extra => {
    apiFixture.existing = noteRow("keep memo");
    const response = await DELETE(noteRequest("DELETE", { id: NOTE_ID, ...extra }));
    expect(response.status).toBe(400);
    expect(apiFixture.existing?.memo).toBe("keep memo");
    expect(apiFixture.existingReads).toBe(0);
  });

  it.each([null, "exact memo", " exact memo ", "   "])("deletes only the exactly approved memo including null and whitespace: %j", async expectedMemo => {
    apiFixture.existing = noteRow(expectedMemo);
    const response = await DELETE(noteRequest("DELETE", { id: NOTE_ID, expectedMemo }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true, id: NOTE_ID });
    expect(apiFixture.existing).toBeNull();
    expect(apiFixture.existingReads).toBe(0);
  });

  it("does not delete a partner's note or report it as removed", async () => {
    apiFixture.existing = { ...noteRow(), saved_by: "50000000-0000-4000-8000-000000000099" };
    const response = await DELETE(noteRequest("DELETE", { id: NOTE_ID, expectedMemo: null }));
    expect(response.status).toBe(403);
    expect(apiFixture.existing?.id).toBe(NOTE_ID);
    expect(await response.json()).not.toHaveProperty("deleted", true);
  });

  it("returns only shared current-couple identities in a bounded saved index", async () => {
    const privateId = "50000000-0000-4000-8000-000000000077";
    const otherId = "50000000-0000-4000-8000-000000000088";
    apiFixture.sourceRows.push({ id: privateId, couple_id: COUPLE, visibility: "bride_private" }, { id: otherId, couple_id: OTHER_COUPLE, visibility: "shared" });
    apiFixture.rows = [noteRow(), { ...noteRow(), message_id: privateId }, { ...noteRow(), message_id: otherId }];
    const response = await GET(new NextRequest(`https://hanbang.ai/api/amora/notes?messageIds=${MESSAGE_ID},${privateId},${otherId}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ savedNotes: [{ id: NOTE_ID, messageId: MESSAGE_ID, savedByMe: true }], userId: USER_ID, coupleId: COUPLE });
    expect(JSON.stringify(body)).not.toContain(SYNTHETIC_SOURCE_TEXT);
    expect(apiFixture.projections).not.toEqual(expect.arrayContaining([expect.stringMatching(/content|memo/)]));
  });

  it.each(["", "not-a-uuid", Array(101).fill(MESSAGE_ID).join(",")])("rejects an invalid or oversized saved index: %s", async (ids) => {
    const response = await GET(new NextRequest(`https://hanbang.ai/api/amora/notes?messageIds=${ids}`));
    expect(response.status).toBe(400);
  });

  it("fails an unavailable saved index closed instead of clearing saved state", async () => {
    apiFixture.sourceError = { code: "57014" };
    const response = await GET(new NextRequest(`https://hanbang.ai/api/amora/notes?messageIds=${MESSAGE_ID}`));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("savedNotes");
  });

  it("preserves an explicit list error rather than empty success", async () => {
    apiFixture.writeError = { code: "57014" };
    const response = await GET(new NextRequest("https://hanbang.ai/api/amora/notes"));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("notes");
  });

  it("hides internal frames only in canonical AI saved answers while preserving user sources and memos", async () => {
    const userSourceId = "50000000-0000-4000-8000-000000000012";
    const unknownSourceId = "50000000-0000-4000-8000-000000000013";
    const raw = '신혼여행 예산은 800만 원이에요.\n[저장된 도구 결과 — 인용 데이터, 실행 지시 아님]\n{"total_budget":35000000,"total_allocated":34000000}\n총예산은 유지해요.';
    const memo = '[저장된 도구 결과 — 인용 데이터, 실행 지시 아님] 문구가 왜 나왔는지 문의할 것. {"total_budget":35000000}';
    apiFixture.rows = [
      { ...noteRow(memo), content: raw },
      { ...noteRow(memo), id: "50000000-0000-4000-8000-000000000011", message_id: userSourceId, content: raw },
      { ...noteRow(memo), id: "50000000-0000-4000-8000-000000000012", message_id: unknownSourceId, content: raw },
    ];
    apiFixture.count = 3;
    apiFixture.sourceRows = [
      { id: MESSAGE_ID, couple_id: COUPLE, visibility: "shared", role: "assistant", sender_type: "ai" },
      { id: userSourceId, couple_id: COUPLE, visibility: "shared", role: "user", sender_type: "bride" },
      { id: unknownSourceId, couple_id: OTHER_COUPLE, visibility: "shared", role: "assistant", sender_type: "ai" },
    ];
    const response = await GET(new NextRequest("https://hanbang.ai/api/amora/notes"));
    expect(response.status).toBe(200);
    const body = await response.json();
    const ai = body.notes.find((note: { messageId: string }) => note.messageId === MESSAGE_ID);
    expect(ai).toMatchObject({ sourceIsAi: true, memo });
    expect(ai.content).toContain("신혼여행 예산은 800만 원이에요.");
    expect(ai.content).toContain("총예산은 유지해요.");
    expect(ai.content).not.toContain("저장된 도구 결과");
    expect(ai.content).not.toContain("total_budget");
    for (const sourceId of [userSourceId, unknownSourceId]) {
      expect(body.notes.find((note: { messageId: string }) => note.messageId === sourceId))
        .toMatchObject({ content: raw, memo, sourceIsAi: false });
    }
    expect(apiFixture.projections).toContain("chat_messages:id, role, sender_type");
    expect(apiFixture.projections).not.toContain("chat_messages:content");
    expect(apiFixture.insertCalls).toBe(0);
    expect(apiFixture.input).toBeNull();
  });

  it("does not return unscreened saved answers when the canonical source kind cannot be read", async () => {
    apiFixture.rows = [noteRow()];
    apiFixture.count = 1;
    apiFixture.sourceError = { code: "57014" };
    const response = await GET(new NextRequest("https://hanbang.ai/api/amora/notes"));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("notes");
    expect(apiFixture.insertCalls).toBe(0);
  });

  it("pages all long saved notes within the mobile bridge byte ceiling", async () => {
    apiFixture.rows = Array.from({ length: 40 }, (_, index) => ({ ...noteRow(),
      id: `50000000-0000-4000-8000-${String(index).padStart(12,"0")}`,
      content: "\u0001".repeat(4_000), memo: "\u0001".repeat(500),
    }));
    apiFixture.count = 40;
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await GET(new NextRequest(`https://hanbang.ai/api/amora/notes${cursor ? `?cursor=${cursor}` : ""}`));
      expect(response.status).toBe(200);
      expect(Number(response.headers.get("x-hanbang-response-bytes"))).toBeLessThanOrEqual(256 * 1024);
      const body = await response.json();
      expect(body.count).toBe(40);
      expect(body.notes.length).toBeLessThanOrEqual(16);
      ids.push(...body.notes.map((note: {id: string}) => note.id));
      expect(body.next_cursor).not.toBe(cursor === null ? "" : cursor);
      cursor = body.next_cursor;
      expect(ids.length).toBeLessThanOrEqual(40);
    } while (cursor);
    expect(ids).toHaveLength(40);
    expect(new Set(ids).size).toBe(40);
  });
});

function sharedMessage(
  overrides: Partial<SavedNoteSourceMessage> = {},
): SavedNoteSourceMessage {
  return {
    couple_id: COUPLE,
    visibility: "shared",
    content: SYNTHETIC_SOURCE_TEXT,
    ...overrides,
  };
}

describe("evaluateSavedNoteSource", () => {
  it("stores the canonical text, never the text the client sent", () => {
    const decision = evaluateSavedNoteSource({
      message: sharedMessage(),
      requestCoupleId: COUPLE,
    });

    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    // 클라이언트가 무엇을 보냈든 저장되는 것은 서버가 읽은 원문이다.
    expect(decision.content).toBe(SYNTHETIC_SOURCE_TEXT);
    expect(decision.content).not.toContain(SYNTHETIC_FORGED_TEXT);
  });

  it("refuses a note with no canonical source at all", () => {
    const decision = evaluateSavedNoteSource({
      message: null,
      requestCoupleId: COUPLE,
    });
    expect(decision).toEqual({ ok: false, reason: "source_not_found" });
  });

  it("refuses a source that belongs to another couple", () => {
    const decision = evaluateSavedNoteSource({
      message: sharedMessage({ couple_id: OTHER_COUPLE }),
      requestCoupleId: COUPLE,
    });
    expect(decision).toEqual({ ok: false, reason: "source_not_found" });
  });

  it.each(["bride_private", "groom_private"] as const)(
    "refuses to widen a %s source into a couple-visible note",
    (visibility) => {
      const decision = evaluateSavedNoteSource({
        message: sharedMessage({ visibility }),
        requestCoupleId: COUPLE,
      });
      // declassification 경로가 없으므로 조용히 넓히지 않고 거부한다.
      expect(decision).toEqual({ ok: false, reason: "private_source_needs_declassification" });
    },
  );

  it("refuses an unknown visibility instead of assuming it is shared", () => {
    const decision = evaluateSavedNoteSource({
      message: sharedMessage({ visibility: "something_new" as never }),
      requestCoupleId: COUPLE,
    });
    expect(decision.ok).toBe(false);
  });

  it("refuses an empty source body rather than saving a blank note", () => {
    for (const empty of ["", "   ", "\n"]) {
      expect(evaluateSavedNoteSource({
        message: sharedMessage({ content: empty }),
        requestCoupleId: COUPLE,
      })).toEqual({ ok: false, reason: "source_empty" });
    }
  });

  it("survives hostile shapes without throwing", () => {
    for (const hostile of [undefined, 42, "text", [], {}]) {
      expect(() => evaluateSavedNoteSource({
        message: hostile as never,
        requestCoupleId: COUPLE,
      })).not.toThrow();
    }
  });
});

// 검증 함수가 있어도 route가 쓰지 않으면 아무것도 막지 못한다. 배선 자체를 고정한다.
describe("the notes route actually uses the canonical source", () => {
  const source = readFileSync(NOTES_ROUTE_PATH, "utf8");

  it("requires a source message id instead of accepting a free-floating note", () => {
    expect(source).toMatch(/if \(!isUuid\(body\.messageId\)\)/u);
    // 예전처럼 messageId를 선택으로 두면 출처 없는 노트가 다시 생긴다.
    expect(source).not.toMatch(/body\.messageId !== undefined && body\.messageId !== null/u);
  });

  it("reads the canonical message and runs it through the source check", () => {
    expect(source).toMatch(/from\("chat_messages"\)/u);
    expect(source).toMatch(/evaluateSavedNoteSource\(/u);
  });

  it("stores the server-read text, not the body the client sent", () => {
    expect(source).toMatch(/rpc\("save_own_amora_note"/u);
    expect(source).not.toMatch(/\.insert\(/u);
    // 클라이언트 본문을 그대로 저장하던 경로가 남아 있으면 안 된다.
    expect(source).not.toMatch(/typeof body\.content === "string"/u);
  });

  it("pins the stored provenance to the verified source id", () => {
    expect(source).toMatch(/p_message_id: sourceMessageId/u);
  });
});

describe("saved note database source boundary", () => {
  let db: PGlite;
  const migrations = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../supabase/migrations");
  const sharedId = MESSAGE_ID;
  const privateId = "50000000-0000-4000-8000-000000000004";
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA public,auth TO authenticated;
      CREATE TABLE couples(id uuid PRIMARY KEY,bride_id uuid,groom_id uuid);
      CREATE TABLE profiles(id uuid PRIMARY KEY,couple_id uuid,role text);
      CREATE TABLE messages(id uuid PRIMARY KEY);
      CREATE TABLE chat_messages(id uuid PRIMARY KEY,couple_id uuid,visibility text,content text);`);
    const membership = readFileSync(resolve(migrations, "20260716114000_current_couple_membership_privacy_fence.sql"), "utf8")
      .match(/CREATE OR REPLACE FUNCTION public\.is_current_couple_member\([\s\S]*?\$function\$;/)?.[0];
    if (!membership) throw new Error("Current membership SQL not found");
    await db.exec(membership);
    await db.exec(readFileSync(resolve(migrations, "20260726120000_amora_saved_notes.sql"), "utf8"));
    await db.exec(readFileSync(resolve(migrations, "20260727090000_fix_saved_note_message_ref_and_lock_messages.sql"), "utf8"));
    const boundary = readFileSync(resolve(migrations, "20260906090807_amora_saved_notes_canonical_source_boundary.sql"), "utf8");
    if (boundary.trim()) await db.exec(boundary);
    await db.exec(readFileSync(resolve(migrations, "20260906145336_amora_saved_notes_owner_delete.sql"), "utf8"));
  });
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    await db.exec("TRUNCATE amora_saved_notes,chat_messages,profiles,couples,auth.users CASCADE");
    await db.query("INSERT INTO auth.users VALUES ($1)", [USER_ID]);
    await db.query("INSERT INTO couples VALUES ($1,$2,null)", [COUPLE,USER_ID]);
    await db.query("INSERT INTO profiles VALUES ($1,$2,'bride')", [USER_ID,COUPLE]);
    await db.query("INSERT INTO chat_messages VALUES ($1,$2,'shared',$3),($4,$2,'bride_private','SYNTHETIC_PRIVATE')", [sharedId,COUPLE,SYNTHETIC_SOURCE_TEXT,privateId]);
  });
  async function asMember(sql: string, values: unknown[] = [], actor = USER_ID) {
    return db.transaction(async tx => {
      await tx.exec("SET LOCAL ROLE authenticated");
      await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [actor]);
      return tx.query(sql, values);
    });
  }
  it("denies a direct authenticated private-source insertion that bypasses the HTTP check", async () => {
    await expect(asMember("INSERT INTO amora_saved_notes(couple_id,saved_by,message_id,content) VALUES ($1,$2,$3,'SYNTHETIC_PRIVATE')", [COUPLE,USER_ID,privateId])).rejects.toMatchObject({ code: "42501" });
    expect((await db.query("SELECT id FROM amora_saved_notes")).rows).toEqual([]);
  });
  it("does not let a member replace a saved canonical quote through a direct content update", async () => {
    await db.query("INSERT INTO amora_saved_notes(id,couple_id,saved_by,message_id,content) VALUES ($1,$2,$3,$4,$5)", [NOTE_ID,COUPLE,USER_ID,sharedId,SYNTHETIC_SOURCE_TEXT]);
    await expect(asMember("UPDATE amora_saved_notes SET content = 'SYNTHETIC_FORGED' WHERE id = $1", [NOTE_ID])).rejects.toMatchObject({ code: "42501" });
    expect((await db.query<{content: string}>("SELECT content FROM amora_saved_notes")).rows[0].content).toBe(SYNTHETIC_SOURCE_TEXT);
  });

  async function save(source = sharedId, memo: string | null = null, actor = USER_ID) {
    const result = await asMember("SELECT public.save_own_amora_note($1,$2,$3) AS receipt", [COUPLE,source,memo], actor);
    return result.rows[0] as {receipt: {note: NoteDbRow; already_saved: boolean}};
  }
  it("allows shared reading and memo editing but only the saving member can delete", async () => {
    const partner = "50000000-0000-4000-8000-000000000099";
    await db.query("INSERT INTO auth.users VALUES ($1)", [partner]);
    await db.query("INSERT INTO profiles VALUES ($1,$2,'groom')", [partner,COUPLE]);
    await db.query("UPDATE couples SET groom_id=$1 WHERE id=$2", [partner,COUPLE]);
    const { receipt } = await save();
    expect((await asMember("SELECT id FROM amora_saved_notes", [], partner)).rows).toHaveLength(1);
    expect((await asMember("UPDATE amora_saved_notes SET memo='shared edit' WHERE id=$1 RETURNING id", [receipt.note.id], partner)).rows).toHaveLength(1);
    expect((await asMember("DELETE FROM amora_saved_notes WHERE id=$1 RETURNING id", [receipt.note.id], partner)).rows).toHaveLength(0);
    expect((await asMember("DELETE FROM amora_saved_notes WHERE id=$1 RETURNING id", [receipt.note.id])).rows).toHaveLength(1);
  });
  it("does not wait for the clear-acceptance couple or source lock while owning the actor profile", async () => {
    const installed = (await db.query<{prosrc: string}>("SELECT prosrc FROM pg_proc WHERE oid = 'public.save_own_amora_note(uuid,uuid,text)'::regprocedure")).rows[0].prosrc;
    const clearAcceptance = readFileSync(resolve(migrations,"20260714163000_atomic_chat_clear_request.sql"),"utf8");
    // 기존 수락 RPC는 message UPDATE → couple SHARE → profile UPDATE 순서다.
    // 실제 두 연결 실행 대신 설치된 SQL에서 이 대기 순환의 두 간선을 검사한다.
    expect(clearAcceptance).toMatch(/FROM public\.chat_messages AS message[\s\S]*?FOR UPDATE/u);
    expect(clearAcceptance).toMatch(/FROM public\.couples AS couple[\s\S]*?FOR SHARE/u);
    expect(clearAcceptance).toMatch(/FROM public\.profiles AS candidate[\s\S]*?FOR UPDATE/u);
    const coupleLock = installed.match(/FROM public\.couples WHERE id = p_couple_id FOR (UPDATE|SHARE|NO KEY UPDATE|KEY SHARE)( NOWAIT)?;/u);
    // SHARE와 충돌하는 UPDATE라면 수락이 profile을 기다리는 동안 순환한다.
    expect(coupleLock?.[1]).toBe("SHARE");
    const sourceLock = installed.match(/FROM public\.chat_messages WHERE id = p_message_id FOR (UPDATE|SHARE|NO KEY UPDATE|KEY SHARE)( NOWAIT)?;/u);
    // 같은 수락 카드를 저장할 때는 원문 행의 UPDATE를 기다리지 않고 안전하게 재시도한다.
    expect(sourceLock?.[2]).toBe(" NOWAIT");
  });
  it("holds the couple-specific save serialization lock before any profile row lock until commit", async () => {
    const installed = (await db.query<{prosrc: string}>("SELECT prosrc FROM pg_proc WHERE oid = 'public.save_own_amora_note(uuid,uuid,text)'::regprocedure")).rows[0].prosrc;
    const lockIndex = installed.indexOf("pg_advisory_xact_lock(");
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeLessThan(installed.indexOf("FROM public.profiles"));
    await db.transaction(async tx => {
      await tx.exec("SET LOCAL ROLE authenticated");
      await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[USER_ID]);
      await tx.query("SELECT public.save_own_amora_note($1,$2,null)",[COUPLE,sharedId]);
      const locks = await tx.query<{held: boolean}>(`SELECT EXISTS (SELECT 1 FROM pg_locks
        WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted AND mode = 'ExclusiveLock'
          AND objsubid = 1
          AND classid::bigint = ((hashtextextended('hanbang:amora-note-save:' || $1::text,0) >> 32) & 4294967295)
          AND objid::bigint = (hashtextextended('hanbang:amora-note-save:' || $1::text,0) & 4294967295)) AS held`,[COUPLE]);
      expect(locks.rows[0].held).toBe(true);
    });
  });
  it("stores only the current shared canonical text and the authenticated author", async () => {
    const {receipt} = await save(sharedId,"why I saved this");
    expect(receipt.already_saved).toBe(false);
    expect(receipt.note).toMatchObject({ content: SYNTHETIC_SOURCE_TEXT, saved_by: USER_ID, message_id: sharedId, memo: "why I saved this" });
    expect((await asMember("SELECT id FROM amora_saved_notes")).rows).toHaveLength(1);
  });
  it("rejects private and foreign source IDs and a disconnected actor through the RPC", async () => {
    await expect(save(privateId)).rejects.toMatchObject({ code: "42501" });
    await db.query("UPDATE chat_messages SET couple_id = $1 WHERE id = $2", [OTHER_COUPLE,sharedId]);
    await expect(save()).rejects.toMatchObject({ code: "P0002" });
    await db.query("UPDATE profiles SET couple_id = NULL WHERE id = $1", [USER_ID]);
    await expect(save()).rejects.toMatchObject({ code: "42501" });
    expect((await db.query("SELECT id FROM amora_saved_notes")).rows).toEqual([]);
  });
  it("keeps a duplicate at the300-note cap while refusing a new301st note", async () => {
    const original = await save(sharedId,"first memo");
    await db.query("INSERT INTO amora_saved_notes(couple_id,saved_by,content) SELECT $1,$2,'synthetic' FROM generate_series(1,299)", [COUPLE,USER_ID]);
    const retry = await save(sharedId,"different memo");
    expect(retry.receipt).toMatchObject({ already_saved: true, note: { id: original.receipt.note.id, memo: "first memo" } });
    await db.query("UPDATE chat_messages SET visibility = 'shared' WHERE id = $1", [privateId]);
    await expect(save(privateId)).rejects.toMatchObject({ code: "54000" });
    expect((await db.query<{count: number}>("SELECT count(*)::integer AS count FROM amora_saved_notes")).rows[0].count).toBe(300);
  });
  it.each(["😀".repeat(2_001), "A" + "😀".repeat(2_000)])("keeps a Unicode source inside4000 UTF16 units without a broken surrogate", async (source) => {
    await db.query("UPDATE chat_messages SET content = $1 WHERE id = $2", [source,sharedId]);
    const {receipt} = await save();
    const expected = source.slice(0,4_000).replace(/[\uD800-\uDBFF]$/u,"");
    expect(receipt.note.content).toBe(expected);
    expect(receipt.note.content.length).toBeLessThanOrEqual(4_000);
    expect(receipt.note.content).not.toContain("�");
  });
  it("uses the same whitespace trimming as the web preview", async () => {
    await db.query("UPDATE chat_messages SET content = $1 WHERE id = $2", ["\uFEFF\u00A0  synthetic \n\u3000",sharedId]);
    expect((await save(sharedId,"\uFEFF memo \u3000")).receipt.note).toMatchObject({ content: "synthetic", memo: "memo" });
  });
  it("enforces the500 UTF16 memo bound both through the RPC and direct memo updates", async () => {
    await expect(save(sharedId,"😀".repeat(251))).rejects.toMatchObject({ code: "22023" });
    const {receipt} = await save(sharedId,"😀".repeat(250));
    expect(receipt.note.memo?.length).toBe(500);
    await expect(asMember("UPDATE amora_saved_notes SET memo = $1 WHERE id = $2", ["😀".repeat(251),receipt.note.id])).rejects.toMatchObject({ code: "23514" });
  });
  it("preserves shared memo editing and deletion while compare-and-set protects a newer memo", async () => {
    const {receipt} = await save();
    const first = await asMember("UPDATE amora_saved_notes SET memo = 'newer' WHERE id = $1 AND memo IS NULL RETURNING id", [receipt.note.id]);
    expect(first.rows).toHaveLength(1);
    const stale = await asMember("UPDATE amora_saved_notes SET memo = 'stale' WHERE id = $1 AND memo IS NULL RETURNING id", [receipt.note.id]);
    expect(stale.rows).toHaveLength(0);
    expect((await db.query<{memo: string}>("SELECT memo FROM amora_saved_notes")).rows[0].memo).toBe("newer");
    await asMember("DELETE FROM amora_saved_notes WHERE id = $1", [receipt.note.id]);
    expect((await db.query("SELECT id FROM amora_saved_notes")).rows).toEqual([]);
  });
  it("keeps a newer memo when an approved null delete races a shared edit, then requires new exact approval", async () => {
    const {receipt} = await save();
    await asMember("UPDATE amora_saved_notes SET memo = 'new memo' WHERE id = $1", [receipt.note.id]);
    expect((await asMember("DELETE FROM amora_saved_notes WHERE id = $1 AND memo IS NULL RETURNING id", [receipt.note.id])).rows).toHaveLength(0);
    expect((await db.query<{memo:string}>("SELECT memo FROM amora_saved_notes WHERE id=$1", [receipt.note.id])).rows[0].memo).toBe("new memo");
    expect((await asMember("DELETE FROM amora_saved_notes WHERE id = $1 AND memo = $2 RETURNING id", [receipt.note.id, "new memo"])).rows).toHaveLength(1);
  });
  it("keeps source identity immutable and denies non-member and anonymous writes", async () => {
    const {receipt} = await save();
    await expect(asMember("UPDATE amora_saved_notes SET message_id = $1 WHERE id = $2", [privateId,receipt.note.id])).rejects.toMatchObject({ code: "42501" });
    await expect(save(sharedId,null,"")).rejects.toMatchObject({ code: "42501" });
    for (const role of ["anon","service_role"]) {
      await expect(db.transaction(async tx => { await tx.exec(`SET LOCAL ROLE ${role}`); return tx.query("SELECT public.save_own_amora_note($1,$2,null)",[COUPLE,sharedId]); })).rejects.toMatchObject({ code: "42501" });
    }
  });
});
