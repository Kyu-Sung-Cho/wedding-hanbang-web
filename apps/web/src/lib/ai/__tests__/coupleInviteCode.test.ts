import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COUPLE_INVITE_CODE_MAX_LENGTH,
  COUPLE_INVITE_CODE_PLACEHOLDER,
  describeCoupleInviteCodeProblem,
  isCoupleInviteCode,
  normalizeCoupleInviteCode,
} from "@hanbang/shared";

// 앱 입력칸이 maxLength={10}이었고 서버가 발급하는 코드는 `WH-` + 12자리 = 15자다.
// 파트너가 보내준 코드를 붙여넣으면 뒤가 잘려 나갔고, 경고 없이 다음 단계로 넘어갔다가
// 온보딩 마지막에서야 "초대 코드가 올바르지 않습니다"를 만났다. 커플 앱에서 파트너
// 연결이 아예 막히는 문제였고 원인은 상수 하나였다.

/** 서버가 실제로 발급하는 모양 — supabase/migrations/20260614110000. */
const REAL_ISSUED_CODE = "WH-A3F91B2C7D40";

describe("서버가 발급한 코드를 받아들인다", () => {
  it("실제 발급 길이(15자)가 잘리지 않는다", () => {
    expect(REAL_ISSUED_CODE).toHaveLength(COUPLE_INVITE_CODE_MAX_LENGTH);
    expect(normalizeCoupleInviteCode(REAL_ISSUED_CODE)).toBe(REAL_ISSUED_CODE);
    expect(isCoupleInviteCode(REAL_ISSUED_CODE)).toBe(true);
    expect(describeCoupleInviteCodeProblem(REAL_ISSUED_CODE)).toBeNull();
  });

  it("예전 형식(짧은 코드)도 계속 받는다", () => {
    // DB 패턴은 6~12자리를 허용한다. 화면이 더 좁게 잡으면 멀쩡한 코드를 거절한다.
    for (const code of ["WH-ABC123", "WH-A3B2C1D4", "WH-123456789012"]) {
      expect(isCoupleInviteCode(code), code).toBe(true);
    }
  });

  it("화면에 보여주는 예시가 실제 발급 길이와 같다", () => {
    // 예시가 9자면 사람이 코드 길이를 오해한다.
    expect(COUPLE_INVITE_CODE_PLACEHOLDER).toHaveLength(COUPLE_INVITE_CODE_MAX_LENGTH);
    expect(isCoupleInviteCode(COUPLE_INVITE_CODE_PLACEHOLDER)).toBe(true);
  });
});

describe("사람이 치는 방식을 견딘다", () => {
  it("소문자·공백·따옴표가 섞여도 파트너 연결을 막지 않는다", () => {
    for (const typed of [
      " wh-a3f91b2c7d40 ",
      "\"WH-A3F91B2C7D40\"",
      "wh-a3f91b2c7d40",
    ]) {
      expect(normalizeCoupleInviteCode(typed), typed).toBe(REAL_ISSUED_CODE);
    }
  });

  it("적대적인 입력에도 던지지 않는다", () => {
    for (const hostile of [null, undefined, 42, {}, []]) {
      expect(() => normalizeCoupleInviteCode(hostile as never)).not.toThrow();
      expect(normalizeCoupleInviteCode(hostile as never)).toBe("");
      expect(isCoupleInviteCode(hostile as never)).toBe(false);
    }
  });
});

describe("틀린 코드는 그 자리에서 말해준다", () => {
  it("형식이 다르면 이유와 예시를 준다", () => {
    const problem = describeCoupleInviteCodeProblem("ABCD1234");
    expect(problem).toContain("파트너가 받은 코드");
    expect(problem).toContain(COUPLE_INVITE_CODE_PLACEHOLDER);
  });

  it("비어 있으면 입력을 요청한다", () => {
    expect(describeCoupleInviteCodeProblem("")).toContain("입력해 주세요");
  });
});

describe("웹과 앱이 같은 규칙을 쓴다", () => {
  // 규칙이 두 곳에 따로 적혀 있었기 때문에 한쪽만 맞았다. 다시 갈라지면 여기서 걸린다.
  const files = [
    "../../apps/mobile/app/onboarding/index.tsx",
    "../../apps/web/src/components/onboarding/CoupleLink.tsx",
  ];

  it.each(files)("%s 가 자기만의 길이 제한이나 형식 검사를 두지 않는다", (relative) => {
    const source = readFileSync(resolve(process.cwd(), "..", "..", relative.replace("../../", "")), "utf8");

    // 길이 제한과 예시를 공유 상수에서 가져온다. (다른 입력칸의 maxLength는 정당하다 —
    // 예컨대 예식일 YYYY-MM-DD는 정확히 10자다.)
    expect(source).toContain("COUPLE_INVITE_CODE_MAX_LENGTH");
    expect(source).toContain("COUPLE_INVITE_CODE_PLACEHOLDER");
    // 형식 정규식을 각자 갖고 있으면 다시 갈라진다.
    expect(source).not.toContain("WH-[A-Z0-9]");
    // 옛 예시(9자)가 남아 있으면 사람이 코드 길이를 오해한다.
    expect(source).not.toContain("WH-ABC123");
    expect(source).not.toContain("WH-A3B2C1\"");
  });
});
