import { afterEach, describe, expect, it, vi } from "vitest";
import { isAmoraTestUser } from "../amoraTestAccess";

const TEST_USER_ID = "a0000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "a0000000-0000-4000-8000-000000000002";

afterEach(() => vi.unstubAllEnvs());

describe("isAmoraTestUser", () => {
  it("설정이 없거나 비어 있으면 누구도 면제하지 않는다", () => {
    vi.stubEnv("AMORA_TEST_USER_IDS", undefined);
    expect(isAmoraTestUser(TEST_USER_ID)).toBe(false);
    vi.stubEnv("AMORA_TEST_USER_IDS", "  ");
    expect(isAmoraTestUser(TEST_USER_ID)).toBe(false);
  });

  it("쉼표와 줄바꿈으로 구분한 서버 UUID 목록의 정확한 계정만 허용한다", () => {
    vi.stubEnv("AMORA_TEST_USER_IDS", ` ${OTHER_USER_ID},\n${TEST_USER_ID.toUpperCase()} `);
    expect(isAmoraTestUser(TEST_USER_ID)).toBe(true);
    expect(isAmoraTestUser(OTHER_USER_ID)).toBe(true);
    expect(isAmoraTestUser("a0000000-0000-4000-8000-000000000003")).toBe(false);
  });

  it("미인증·부분 일치·이메일·와일드카드로는 면제하지 않는다", () => {
    vi.stubEnv("AMORA_TEST_USER_IDS", `${TEST_USER_ID},*,tester@example.com,invalid`);
    for (const userId of [null, undefined, "", "*", "invalid", "tester@example.com", TEST_USER_ID.slice(0, 30)]) {
      expect(isAmoraTestUser(userId)).toBe(false);
    }
  });

  it("목록에서 제거하면 다음 판정부터 면제가 사라진다", () => {
    vi.stubEnv("AMORA_TEST_USER_IDS", TEST_USER_ID);
    expect(isAmoraTestUser(TEST_USER_ID)).toBe(true);
    vi.stubEnv("AMORA_TEST_USER_IDS", OTHER_USER_ID);
    expect(isAmoraTestUser(TEST_USER_ID)).toBe(false);
  });
});
