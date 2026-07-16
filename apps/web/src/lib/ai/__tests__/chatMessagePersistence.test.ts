import { describe, expect, it, vi } from "vitest";

import {
  AiMessagePersistenceError,
  persistAiMessage,
  type PersistAiMessageParams,
} from "@/lib/ai/chatMessagePersistence";

type QueryResult = {
  data: Array<{
    id: string;
    created_at: string;
    content: string;
    metadata: Record<string, unknown> | null;
    stage_tag: string | null;
    specialist_type: string | null;
    visibility: "shared" | "bride_private" | "groom_private";
  }> | null;
  error: { code?: string; message?: string } | null;
};

function makeAdmin(options: {
  lookups?: QueryResult[];
  inserts?: Array<{
    data: {
      id: string;
      created_at: string;
      content?: string;
      metadata?: Record<string, unknown> | null;
      stage_tag?: string | null;
      specialist_type?: string | null;
      visibility?: "shared" | "bride_private" | "groom_private";
    } | null;
    error: { code?: string; message?: string } | null;
  }>;
}) {
  const lookups = [...(options.lookups ?? [])];
  const inserts = [...(options.inserts ?? [])];
  const insertPayloads: unknown[] = [];

  const admin = {
    from: vi.fn(() => ({
      select: vi.fn(() => {
        const chain = {
          eq: vi.fn(() => chain),
          is: vi.fn(() => chain),
          limit: vi.fn(() =>
            Promise.resolve(
              lookups.shift() ?? { data: [], error: null },
            ),
          ),
        };
        return chain;
      }),
      insert: vi.fn((payload: unknown) => {
        insertPayloads.push(payload);
        return {
          select: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve(
                inserts.shift() ?? {
                  data: null,
                  error: { message: "insert failed" },
                },
              ),
            ),
          })),
        };
      }),
    })),
  };

  return { admin, insertPayloads };
}

const BASE: PersistAiMessageParams = {
  isDemo: false,
  coupleId: "00000000-0000-4000-8000-000000000001",
  cleanText: "저장된 답변",
  clientRequestId: "00000000-0000-4000-8000-000000000002",
  metadata: { senderName: "아모라" },
  stageTag: "venue",
  specialistType: null,
  visibility: "shared",
};

describe("persistAiMessage", () => {
  it("returns an exact existing assistant row without inserting again", async () => {
    const { admin, insertPayloads } = makeAdmin({
      lookups: [{
        data: [{
          id: "message-1",
          created_at: "2026-07-14T00:00:00.000Z",
          content: "기존 답변",
          metadata: { client_request_id: BASE.clientRequestId },
          stage_tag: "planning_0",
          specialist_type: null,
          visibility: "shared",
        }],
        error: null,
      }],
    });

    await expect(persistAiMessage(BASE, admin as never)).resolves.toEqual({
      id: "message-1",
      createdAt: "2026-07-14T00:00:00.000Z",
      content: "기존 답변",
      metadata: { client_request_id: BASE.clientRequestId },
      stageTag: "planning_0",
      specialistType: null,
      visibility: "shared",
      reused: true,
    });
    expect(insertPayloads).toHaveLength(0);
  });

  it("persists the server-controlled assistant shape and idempotency key", async () => {
    const { admin, insertPayloads } = makeAdmin({
      lookups: [{ data: [], error: null }],
      inserts: [{
        data: {
          id: "message-2",
          created_at: "2026-07-14T00:00:01.000Z",
          content: BASE.cleanText,
          metadata: {
            senderName: "아모라",
            client_request_id: BASE.clientRequestId,
            mediation: {
              resolution: "총예산 상한선을 확인해요",
              proposalVersion: "55555555-5555-4555-8555-555555555555",
              rosterFingerprint: "a".repeat(32),
            },
          },
          stage_tag: BASE.stageTag,
          specialist_type: null,
          visibility: "shared",
        },
        error: null,
      }],
    });

    await expect(persistAiMessage(BASE, admin as never)).resolves.toEqual({
      id: "message-2",
      createdAt: "2026-07-14T00:00:01.000Z",
      content: BASE.cleanText,
      metadata: {
        senderName: "아모라",
        client_request_id: BASE.clientRequestId,
        mediation: {
          resolution: "총예산 상한선을 확인해요",
          proposalVersion: "55555555-5555-4555-8555-555555555555",
          rosterFingerprint: "a".repeat(32),
        },
      },
      stageTag: BASE.stageTag,
      specialistType: null,
      visibility: "shared",
      reused: false,
    });
    expect(insertPayloads[0]).toMatchObject({
      sender_id: null,
      sender_type: "ai",
      role: "assistant",
      visibility: "shared",
      metadata: {
        senderName: "아모라",
        client_request_id: BASE.clientRequestId,
      },
    });
  });

  it("fails closed when a duplicate request id belongs to a non-assistant row", async () => {
    const { admin } = makeAdmin({
      lookups: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      inserts: [{
        data: null,
        error: { code: "23505", message: "duplicate key value violates unique constraint" },
      }],
    });

    await expect(persistAiMessage(BASE, admin as never)).rejects.toMatchObject({
      name: "AiMessagePersistenceError",
      code: "AI_MESSAGE_PERSISTENCE_FAILED",
    });
  });

  it("never acknowledges an empty non-demo answer", async () => {
    const { admin } = makeAdmin({});
    await expect(
      persistAiMessage({ ...BASE, cleanText: "   " }, admin as never),
    ).rejects.toBeInstanceOf(AiMessagePersistenceError);
  });

  it("keeps demo replies local without touching production storage", async () => {
    const { admin } = makeAdmin({});
    await expect(
      persistAiMessage({ ...BASE, isDemo: true }, admin as never),
    ).resolves.toEqual({
      id: null,
      createdAt: null,
      content: BASE.cleanText,
      metadata: BASE.metadata,
      stageTag: BASE.stageTag,
      specialistType: BASE.specialistType,
      visibility: BASE.visibility,
      reused: false,
    });
    expect(admin.from).not.toHaveBeenCalled();
  });
});
