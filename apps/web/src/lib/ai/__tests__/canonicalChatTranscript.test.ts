import { describe, expect, it } from "vitest";
import {
  buildCanonicalChatTranscript,
  CanonicalChatTranscriptError,
  type CanonicalChatRow,
} from "../canonicalChatTranscript";

const coupleId = "10000000-0000-4000-8000-000000000001";
const brideId = "20000000-0000-4000-8000-000000000001";
const groomId = "30000000-0000-4000-8000-000000000001";
const currentId = "40000000-0000-4000-8000-000000000003";

function row(overrides: Partial<CanonicalChatRow>): CanonicalChatRow {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    couple_id: coupleId,
    sender_id: brideId,
    sender_type: "bride",
    sender_role: "bride",
    role: "user",
    content: "서버에 저장된 질문",
    metadata: {},
    visibility: "shared",
    created_at: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

function build(rows: CanonicalChatRow[], overrides: Partial<Parameters<typeof buildCanonicalChatTranscript>[0]> = {}) {
  return buildCanonicalChatTranscript({
    rows,
    coupleId,
    currentUserId: brideId,
    currentUserRole: "bride",
    brideId,
    groomId,
    visibility: "shared",
    currentUserMessageId: currentId,
    sharedClearedAt: null,
    privateClearedAt: null,
    maxMessages: 20,
    maxSingleMessageChars: 6_000,
    maxTotalMessageChars: 24_000,
    ...overrides,
  });
}

describe("canonical Amora transcript", () => {
  it("uses only owned server rows and excludes partner-target and forged ownership rows", () => {
    const transcript = build([
      row({ content: "공유 기록", created_at: "2026-07-13T00:00:00.000Z" }),
      row({
        id: "40000000-0000-4000-8000-000000000002",
        sender_id: groomId,
        sender_type: "groom",
        sender_role: "groom",
        content: "상대방에게만 보낸 기록",
        metadata: { target: "partner" },
        created_at: "2026-07-13T00:00:01.000Z",
      }),
      row({
        id: "40000000-0000-4000-8000-000000000099",
        sender_id: groomId,
        sender_type: "bride",
        sender_role: "bride",
        content: "소유권이 위조된 기록",
        created_at: "2026-07-13T00:00:02.000Z",
      }),
      row({
        id: currentId,
        content: "서버가 확인한 현재 질문",
        created_at: "2026-07-13T00:00:03.000Z",
      }),
    ]);

    expect(transcript.messages).toEqual([
      { role: "user", content: "[신부] 공유 기록", id: "40000000-0000-4000-8000-000000000001" },
      { role: "user", content: "[신부] 서버가 확인한 현재 질문", id: currentId },
    ]);
    expect(transcript.currentUserText).toBe("서버가 확인한 현재 질문");
    expect(JSON.stringify(transcript)).not.toContain("상대방에게만");
    expect(JSON.stringify(transcript)).not.toContain("소유권이 위조");
  });

  it("keeps shared, own-private, and partner-private audiences separated", () => {
    const rows = [
      row({ content: "공유", created_at: "2026-07-13T00:00:00.000Z" }),
      row({
        id: "40000000-0000-4000-8000-000000000010",
        content: "신부 비공개",
        visibility: "bride_private",
        created_at: "2026-07-13T00:00:01.000Z",
      }),
      row({
        id: "40000000-0000-4000-8000-000000000011",
        sender_id: groomId,
        sender_type: "groom",
        sender_role: "groom",
        content: "신랑 비공개",
        visibility: "groom_private",
        created_at: "2026-07-13T00:00:02.000Z",
      }),
      row({
        id: currentId,
        content: "현재 비공개 질문",
        visibility: "bride_private",
        created_at: "2026-07-13T00:00:03.000Z",
      }),
    ];

    const transcript = build(rows, { visibility: "bride_private" });
    expect(transcript.messages.map((message) => message.content)).toEqual([
      "[신부] 공유",
      "[신부] 신부 비공개",
      "[신부] 현재 비공개 질문",
    ]);
  });

  it("applies the signed-in user's server clear fences before model context", () => {
    const transcript = build([
      row({ content: "삭제 경계 이전", created_at: "2026-07-13T00:00:00.000Z" }),
      row({ id: currentId, content: "삭제 경계 이후", created_at: "2026-07-13T00:00:02.000Z" }),
    ], { sharedClearedAt: "2026-07-13T00:00:01.000Z" });

    expect(transcript.messages).toEqual([
      { role: "user", content: "[신부] 삭제 경계 이후", id: currentId },
    ]);
  });

  it("fails closed when the requested current message is not owned by the caller", () => {
    expect(() => build([
      row({
        id: currentId,
        sender_id: groomId,
        sender_type: "groom",
        sender_role: "groom",
        content: "다른 사람의 질문",
        created_at: "2026-07-13T00:00:03.000Z",
      }),
    ])).toThrowError(CanonicalChatTranscriptError);
  });
});
