/**
 * 영어 위기 판정에서 `groom`·`bride` 가 `husband`·`wife` 와 같게 다뤄진다.
 *
 * 2026-08-29 에 범위 어휘(`WEDDING_CORE_SIGNAL_PATTERN`)에만 영어 결혼 낱말을
 * 넣었다가 되돌렸다. 적대적 검토가 재현한 것:
 *
 *     my husband hits me  ->  W5 안전       (husband 는 위기 주어 목록에 있었다)
 *     my groom hits me    ->  W0 + 기억 ON  (groom 은 없었다)
 *
 *  19문장 중 16건이 그렇게 뒤집혔다. 학대 서술이 결혼 준비 대화가 되고 **두 사람이
 *  함께 보는 장기 기억**에 적재된다.
 *
 * 그 뒤집힘의 원인은 두 목록의 어긋남이었다. 여기서는 **어긋남 자체**를 없앤다 —
 * 결혼 준비 앱에서 `groom`·`bride` 는 가장 먼저 나올 상대다.
 *
 * ## 범위 어휘는 아직 안 넓혔다
 *
 * 이 대칭을 맞춰도 `my groom pushed me` 는 `my husband pushed me` 와 똑같이
 * W4 다(영어 위기 어휘에 `pushed me`·`scared of` 가 없다 — 기존 구멍이다).
 * 그 상태에서 범위 어휘에 `groom` 을 넣으면 groom 쪽만 W0 이 되어 다시 어긋난다.
 * 그래서 범위 영어는 그 구멍을 메운 뒤에 다룬다.
 */
import { describe, expect, it } from "vitest";

import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";

const scope = (userText: string) => classifyAmoraQuestionScope({ userText }).scope;

describe("결혼 역할 낱말이 배우자 낱말과 같게 다뤄진다", () => {
  it.each([
    ["hits me", "안전으로"],
    ["hit me last night", "안전으로"],
    ["is abusive", "안전으로"],
    ["beats me when drunk", "안전으로"],
  ])("%s — %s", (tail) => {
    for (const subject of ["husband", "wife", "groom", "bride"]) {
      expect(scope(`my ${subject} ${tail}`), `my ${subject} ${tail}`)
        .toBe("W5_safety_override");
    }
  });

  it("들러리도 같다", () => {
    for (const subject of ["groomsman", "bridesmaid"]) {
      expect(scope(`my ${subject} hits me`), subject).toBe("W5_safety_override");
    }
  });

  it("남은 구멍은 배우자 쪽과 똑같다 — 새로 만든 것이 아니다", () => {
    // `pushed me`·`scared of` 는 영어 위기 어휘에 없다. 여기서 확인하는 것은
    // **어느 주어에서도 같다**는 것이다. 한쪽만 열리면 그게 위험하다.
    for (const tail of ["pushed me", "threw a glass at me"]) {
      const results = ["husband", "groom", "wife", "bride"]
        .map((s) => scope(`my ${s} ${tail}`));
      expect(new Set(results).size, `${tail}: ${results.join(",")}`).toBe(1);
    }
    const scared = ["husband", "groom"].map((s) => scope(`I am scared of my ${s}`));
    expect(new Set(scared).size).toBe(1);
  });

  it("평범한 결혼 문장을 위기로 만들지 않는다", () => {
    for (const userText of [
      "my groom is planning the honeymoon",
      "my bride picked the dress",
      "my groom and I are choosing a venue",
      "my bridesmaid is helping with invitations",
    ]) {
      expect(scope(userText), userText).not.toBe("W5_safety_override");
    }
  });
});
