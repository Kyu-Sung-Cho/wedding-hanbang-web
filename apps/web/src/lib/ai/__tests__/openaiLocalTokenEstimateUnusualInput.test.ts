// @vitest-environment node
import { describe, expect, it } from "vitest";

import { estimateInputTokensLocally, estimateTextTokensLocally } from "../openai";

/**
 * 계측 장애 때 쓰는 로컬 토큰 추정이 드문 입력에서 아래로 틀리지 않는가 (2026-09-15 2차 검토).
 *
 * 한글 음절을 모두 0.8, 라틴 글자를 모두 0.25로 세면 드문 음절(뷁·쀍, o200k에서 1자 2~3토큰)만
 * 붙여 넣은 20,000자 메시지가 16,000으로 잡혀 실제 40,000 넘는 입력이 64,000 상한을 통과했다.
 * 뜻 없는 긴 영문 묶음도 네 글자당 1토큰으로 적게 셌다.
 *
 * 바이트 단위 BPE 토크나이저는 한 글자를 UTF-8 바이트 수보다 많은 토큰으로 나누지 않는다.
 * 그래서 흔한 음절 밖의 한글은 바이트 수(3)로 세면 위로만 틀린다.
 */

const MAX_MESSAGE_CHARS = 20_000;
const INPUT_LIMIT = 64_000;

/** 결정적 의사 난수: 테스트가 매번 같은 문자열을 만든다. */
function pseudoRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

function randomLetters(length: number, alphabet: string, seed = 7) {
  const next = pseudoRandom(seed);
  return Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join("");
}

describe("로컬 토큰 추정 — 드문 입력", () => {
  it("흔한 음절 표 밖의 한글은 바이트 수만큼 세어 위로 틀린다", () => {
    const rare = "뷁쀍똠햏믜쌰쎼".repeat(Math.ceil(MAX_MESSAGE_CHARS / 7)).slice(0, MAX_MESSAGE_CHARS);
    expect(estimateTextTokensLocally(rare)).toBeGreaterThanOrEqual(Buffer.byteLength(rare, "utf8"));
  });

  it("드문 음절만 붙여 넣은 메시지는 운영 최악 프롬프트와 합쳐 상한을 넘긴다", () => {
    const rare = "뷁".repeat(MAX_MESSAGE_CHARS);
    expect(estimateInputTokensLocally({
      // 운영 최악 커플의 시스템 프롬프트 길이(실측 ~23,000토큰).
      instructions: "가".repeat(48_019),
      input: [{ role: "user", content: rare }],
    })).toBeGreaterThan(INPUT_LIMIT);
  });

  it("뜻 없는 긴 영문 묶음은 네 글자당 한 토큰보다 많이 센다", () => {
    const lower = randomLetters(MAX_MESSAGE_CHARS, "abcdefghijklmnopqrstuvwxyz");
    // o200k 에서 무작위 소문자 20,000자는 13,000토큰 안팎이다.
    expect(estimateTextTokensLocally(lower)).toBeGreaterThanOrEqual(13_000);
    const mixed = randomLetters(MAX_MESSAGE_CHARS, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 11);
    // 대소문자가 섞이면 사전 분할이 대문자 경계마다 끊어 더 많아진다.
    expect(estimateTextTokensLocally(mixed)).toBeGreaterThanOrEqual(10_000);
  });

  describe("정상 입력은 예전 수준을 지킨다", () => {
    it("흔한 한국어 대화는 한글 1자를 1토큰으로 되돌리지 않는다", () => {
      const turn = "웨딩홀 예약금은 보통 얼마예요? 식대는 1인 7만 원 정도로 보고 있어요. ".repeat(450);
      const legacyEstimate = Math.ceil(Buffer.byteLength(turn, "utf8") / 3);
      expect(estimateTextTokensLocally(turn)).toBeLessThanOrEqual(Math.ceil(legacyEstimate * 0.85));
    });

    it("긴 영단어와 흔한 영문 문장은 한 글자 한 토큰 가까이 부풀리지 않는다", () => {
      // 20자 이하 실제 낱말은 그대로 4~6자당 1토큰 기준으로 센다.
      expect(estimateTextTokensLocally("internationalization responsibilities")).toBeLessThanOrEqual(12);
      const sentence = "Save the date for our wedding ceremony and reception. ".repeat(200);
      expect(estimateTextTokensLocally(sentence)).toBeLessThanOrEqual(Math.ceil(sentence.length / 3));
    });

    it("KS X 1001 완성형 음절은 0.8 가중치로 센다", () => {
      expect(estimateTextTokensLocally("가".repeat(3_000))).toBeLessThanOrEqual(2_400);
      expect(estimateTextTokensLocally("봬요 괜찮아요 됐어요".repeat(100))).toBeLessThanOrEqual(Math.ceil(9 * 100 * 0.8) + 300);
    });
  });
});
