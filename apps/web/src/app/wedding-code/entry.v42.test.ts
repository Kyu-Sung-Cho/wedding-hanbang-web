import { describe, expect, it } from "vitest";
import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { WEDDING_CODE_V41_VERSION } from "@/constants/weddingCodeV41";
import { WEDDING_CODE_V42_VERSION } from "@/constants/weddingCodeV42";
import { WEDDING_CODE_V40_BANK } from "@/lib/weddingCode/v40/bank";
import { encodeCode as encodeOld } from "@/lib/weddingCode/v40/codec";
import { encodeGuessCode as encodeOldGuess } from "@/lib/weddingCode/v40/guess/guessLink";
import type { GuessAnswers } from "@/lib/weddingCode/v40/guess/types";
import { fixtureByName } from "@/lib/weddingCode/v40/fixtures";
import { WEDDING_CODE_V42_BANK } from "@/lib/weddingCode/v42/bank";
import { WEDDING_CODE_V41_BANK } from "@/lib/weddingCode/v41/bank";
import { encodeCode as encodePrevious, encodeGuessCode as encodePreviousGuess } from "@/lib/weddingCode/v41/codec";
import { encodeCode, encodeGuessCode } from "@/lib/weddingCode/v42/codec";
import { parseWeddingCodeEntryHash, parseWeddingCodeEntryQuery, weddingCodeEntryHash, weddingCodeRestartSearch } from "./entry";

const first = fixtureByName("swua-example");
const second = fixtureByName("couple-partner");
if (!first || !second) throw new Error("fixture missing");
const oldA = encodeOld(WEDDING_CODE_V40_BANK, first.formBit, first.responses);
const previousA = encodePrevious(WEDDING_CODE_V41_BANK, first.formBit, first.responses);
const newA = encodeCode(WEDDING_CODE_V42_BANK, first.formBit, first.responses);
const newB = encodeCode(WEDDING_CODE_V42_BANK, second.formBit, second.responses);
if (!oldA || !previousA || !newA || !newB) throw new Error("fixture code missing");
const guess: GuessAnswers = { set: "1", slots: [{ self: 0, guess: 1 }, { self: null, guess: null }, { self: null, guess: null }, { self: null, guess: null }, { self: null, guess: null }, { self: null, guess: null }] };

describe("v4.2 진입 exact-version", () => {
  it("질문만 링크와 재시작 주소는 v4.2에 고정된다", () => {
    expect(parseWeddingCodeEntryQuery({ v: WEDDING_CODE_V42_VERSION })).toEqual({ kind: "v42", initial: { partner: null, both: null } });
    expect(weddingCodeRestartSearch("v42")).toBe(`?v=${WEDDING_CODE_V42_VERSION}`);
  });

  it("새 코드로 한 사람과 두 사람을 열고 해시를 왕복한다", () => {
    for (const hash of [
      `#v=${WEDDING_CODE_V42_VERSION}&a=${newA}`,
      `#v=${WEDDING_CODE_V42_VERSION}&a=${newA}&b=${newB}`,
    ]) {
      const entry = parseWeddingCodeEntryHash(hash);
      expect(entry?.kind).toBe("v42");
      expect(entry && weddingCodeEntryHash(entry)).toBe(hash);
    }
  });

  it("옛 코드를 새 판 태그에 넣거나 새 코드를 옛 판 태그에 넣으면 전체 거절한다", () => {
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V42_VERSION}&a=${oldA}`)).toEqual({ kind: "error", version: WEDDING_CODE_V42_VERSION });
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V40_VERSION}&a=${newA}`)).toEqual({ kind: "error", version: WEDDING_CODE_V40_VERSION });
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V42_VERSION}&a=${newA}&b=${oldA}`)).toEqual({ kind: "error", version: WEDDING_CODE_V42_VERSION });
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V42_VERSION}&a=${oldA}&b=${newB}`)).toEqual({ kind: "error", version: WEDDING_CODE_V42_VERSION });
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V42_VERSION}&a=${previousA}`)).toEqual({ kind: "error", version: WEDDING_CODE_V42_VERSION });
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V41_VERSION}&a=${newA}`)).toEqual({ kind: "error", version: WEDDING_CODE_V41_VERSION });
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V42_VERSION}&a=${newA}&b=${previousA}`)).toEqual({ kind: "error", version: WEDDING_CODE_V42_VERSION });
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V41_VERSION}&a=${previousA}`)?.kind).toBe("v41");
  });

  it("옛 ga/gb를 새 판에 섞거나 새 ga/gb를 옛 판에 섞으면 전체 거절한다", () => {
    const oldGuess = encodeOldGuess(guess);
    const newGuess = encodeGuessCode(guess);
    const previousGuess = encodePreviousGuess(guess);
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V42_VERSION}&a=${newA}&ga=${oldGuess}`)).toEqual({ kind: "error", version: WEDDING_CODE_V42_VERSION });
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V42_VERSION}&a=${newA}&b=${newB}&gb=${oldGuess}`)).toEqual({ kind: "error", version: WEDDING_CODE_V42_VERSION });
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V40_VERSION}&a=${oldA}&ga=${newGuess}`)).toEqual({ kind: "error", version: WEDDING_CODE_V40_VERSION });
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V42_VERSION}&a=${newA}&ga=${previousGuess}`)).toEqual({ kind: "error", version: WEDDING_CODE_V42_VERSION });
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V41_VERSION}&a=${previousA}&ga=${newGuess}`)).toEqual({ kind: "error", version: WEDDING_CODE_V41_VERSION });
    const valid = parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V42_VERSION}&a=${newA}&ga=${newGuess}`);
    expect(valid?.kind).toBe("v42");
    expect(valid && weddingCodeEntryHash(valid)).toBe(`#v=${WEDDING_CODE_V42_VERSION}&a=${newA}&ga=${newGuess}`);
  });

  it("답이 쿼리에 오거나 중복되면 복원하지 않는다", () => {
    expect(parseWeddingCodeEntryQuery({ v: WEDDING_CODE_V42_VERSION, a: newA })).toEqual({ kind: "error", version: WEDDING_CODE_V42_VERSION });
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V42_VERSION}&a=${newA}&a=${newA}`)).toEqual({ kind: "error", version: WEDDING_CODE_V42_VERSION });
    expect(parseWeddingCodeEntryQuery({ v: [WEDDING_CODE_V42_VERSION, WEDDING_CODE_V42_VERSION] })).toEqual({ kind: "error", version: WEDDING_CODE_V42_VERSION });
    expect(parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V42_VERSION}&a=${newA}&unexpected=value`)).toEqual({ kind: "error", version: WEDDING_CODE_V42_VERSION });
  });
});
