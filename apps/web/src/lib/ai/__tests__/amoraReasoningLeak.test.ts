import { describe, expect, it } from "vitest";

import { stripAmoraReasoningPreamble } from "@/lib/ai/amoraReasoningLeak";

/**
 * 2026-08-24 운영 실측 — 아모라가 영어 사고를 그대로 사용자에게 보냈다.
 * 내부 표식(`[신부→상대방]`)까지 포함돼 있었고 DB 에도 저장됐다.
 */

const LEAKED = [
  "We need respond current request.",
  "",
  "User prefix [신부] not direct partner only [신부→상대방] ignored.",
  "",
  "Need query scheduled events first to get ID expected.",
  "",
  "Use tool.",
  "",
  "실제 실행 결과가 확인되지 않아 이 변경은 아직 반영되지 않았어요. 변경할 내용을 확인한 뒤 다시 요청해주세요.",
].join("\n");

describe("모델의 사고 서두는 사용자에게 안 나간다", () => {
  it("운영에서 실제로 새어 나간 응답을 걷어낸다", () => {
    const cleaned = stripAmoraReasoningPreamble(LEAKED);
    expect(cleaned).toBe(
      "실제 실행 결과가 확인되지 않아 이 변경은 아직 반영되지 않았어요. 변경할 내용을 확인한 뒤 다시 요청해주세요.",
    );
    expect(cleaned).not.toContain("We need");
    expect(cleaned).not.toContain("[신부→상대방]");
  });

  it("한국어로 시작하는 평범한 답은 손대지 않는다", () => {
    const normal = "총예산을 5,000만 원으로 바꿀까요?\n\n확인하시면 바로 반영할게요.";
    expect(stripAmoraReasoningPreamble(normal)).toBe(normal);
  });

  it("한 문단짜리 한국어 답도 그대로 둔다", () => {
    const one = "결혼식장 예산은 2,200만 원이에요.";
    expect(stripAmoraReasoningPreamble(one)).toBe(one);
  });

  it("한글이 아예 없으면 손대지 않는다 — 빈 응답을 만들지 않는다", () => {
    const english = "Sorry, something went wrong.\n\nPlease try again.";
    expect(stripAmoraReasoningPreamble(english)).toBe(english);
  });

  it("한국어 문단 뒤의 영어는 남긴다 — 서두만 본다", () => {
    const mixed = "예식장 이름은 이렇게 적어요.\n\nGrand Convention";
    expect(stripAmoraReasoningPreamble(mixed)).toBe(mixed);
  });

  it("빈 문자열·비문자열에 안전하다", () => {
    expect(stripAmoraReasoningPreamble("")).toBe("");
    expect(stripAmoraReasoningPreamble(null as never)).toBe(null);
  });
});
