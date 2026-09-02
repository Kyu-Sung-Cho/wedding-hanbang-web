import { describe, expect, it } from "vitest";

import { readViewer } from "./viewer";

function client(getUser: () => unknown) {
  return { auth: { getUser: getUser as never } } as never;
}

describe("readViewer", () => {
  it("정상 세션은 그대로 통과시킨다", async () => {
    const user = { id: "11111111-1111-4111-8111-111111111111" };
    const result = await readViewer(
      client(async () => ({ data: { user }, error: null })),
    );

    expect(result).toEqual({ user, error: null });
  });

  it("로그아웃 방문자의 '세션 없음' 오류를 값으로 그대로 넘긴다", async () => {
    // 이것을 어떻게 읽을지는 호출부가 `hasPresentedAuthCredential` 과 함께 정한다.
    // 여기서 삼키면 그 판단이 불가능해진다.
    const error = { name: "AuthSessionMissingError", message: "Auth session missing!" };
    const result = await readViewer(
      client(async () => ({ data: { user: null }, error })),
    );

    expect(result).toEqual({ user: null, error });
  });

  /**
   * 이 한 줄이 없어서 커뮤니티 API 가 500 을 냈다. `getUser()` 는 계약상
   * `{ data, error }` 를 돌려주게 되어 있지만 세션 저장소를 읽다 실패하면 던진다.
   */
  it("던지면 예외가 아니라 '확인 실패' 라는 값으로 바꾼다", async () => {
    const result = await readViewer(
      client(async () => {
        throw new Error("Invalid UTF-8 sequence");
      }),
    );

    expect(result.user).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it("던진 원문을 호출부로 돌려주지 않는다", async () => {
    // 원문에는 내부 식별자가 담긴다. 호출부는 진위만 보면 된다.
    const result = await readViewer(
      client(async () => {
        throw new Error("connection string postgres://user:pw@host/db failed");
      }),
    );

    expect((result.error as Error).message).toBe("SUPABASE_VIEWER_READ_FAILED");
    expect(JSON.stringify(result.error)).not.toContain("postgres://");
  });

  it("동기적으로 던지는 구현에도 견딘다", async () => {
    const result = await readViewer(
      client(() => {
        throw new Error("sync throw");
      }),
    );

    expect(result.user).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it("data 가 통째로 비어도 던지지 않는다", async () => {
    const result = await readViewer(client(async () => ({ error: null })));

    expect(result).toEqual({ user: null, error: null });
  });
});
