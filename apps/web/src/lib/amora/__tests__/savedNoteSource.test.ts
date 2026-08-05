import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
    expect(source).toMatch(/const content = sourceDecision\.content/u);
    // 클라이언트 본문을 그대로 저장하던 경로가 남아 있으면 안 된다.
    expect(source).not.toMatch(/typeof body\.content === "string"/u);
  });

  it("pins the stored provenance to the verified source id", () => {
    expect(source).toMatch(/message_id: sourceMessageId/u);
  });
});
