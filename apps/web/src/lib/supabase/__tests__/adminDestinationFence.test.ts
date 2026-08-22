import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(() => ({ pinned: true })) }));

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { createAdminClient } from "../admin";
import { verifySupabaseServiceDestination } from "../destinationFence";
import {
  TEST_SUPABASE_PROJECT_REF,
  TEST_SUPABASE_SERVICE_ROLE_KEY,
  TEST_SUPABASE_URL,
} from "@/test/supabaseDestinationEnv";

describe("createAdminClient destination fence", () => {
  beforeEach(() => {
    mocks.createClient.mockClear();
    process.env.NEXT_PUBLIC_SUPABASE_URL = TEST_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = TEST_SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_EXPECTED_URL = TEST_SUPABASE_URL;
    process.env.SUPABASE_EXPECTED_PROJECT_REF = TEST_SUPABASE_PROJECT_REF;
    process.env.SUPABASE_PRODUCTION_PROJECT_REF = "slrtobkksjmxgzatjyqb";
    delete process.env.SUPABASE_PRODUCTION_WRITE_CONFIRM;
    // 개발 PC 를 기본값으로 둔다. 배포된 서버는 그 자리에서 명시적으로 켠다.
    delete process.env.VERCEL;
  });

  it("validates before constructing the privileged SDK client", () => {
    expect(createAdminClient()).toEqual({ pinned: true });
    expect(mocks.createClient).toHaveBeenCalledWith(
      TEST_SUPABASE_URL,
      TEST_SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  });

  it("does not construct an SDK client when the URL is contaminated", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://zyxwvutsrqponmlkjihg.supabase.co";
    expect(() => createAdminClient()).toThrowError(
      expect.objectContaining({ code: "URL_MISMATCH" }),
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("does not construct a production client without the exact write opt-in", () => {
    process.env.SUPABASE_PRODUCTION_PROJECT_REF = TEST_SUPABASE_PROJECT_REF;
    expect(() => createAdminClient()).toThrowError(
      expect.objectContaining({ code: "PRODUCTION_WRITE_CONFIRMATION_REQUIRED" }),
    );
    expect(mocks.createClient).not.toHaveBeenCalled();

    process.env.SUPABASE_PRODUCTION_WRITE_CONFIRM = `RUNTIME_WRITE:${TEST_SUPABASE_PROJECT_REF}`;
    // 확인 문자열만으로는 더 이상 충분하지 않다 — 아래 검사가 그 이유를 적어 둔다.
    process.env.VERCEL = "1";
    expect(createAdminClient()).toEqual({ pinned: true });
    expect(mocks.createClient).toHaveBeenCalledOnce();
  });

  /**
   * 확인 문자열은 **실행 위치를 증명하지 못한다.** 운영 환경변수를 통째로 복사하면
   * 그 문자열도 같이 복사된다. 실제로 그렇게 개발 PC 의 `pnpm dev` 가 운영 DB 를 가리켜
   * 커플 기록이 상한 적이 있다.
   *
   * 이 검사가 옛 계약을 바꾼다 — 전에는 "문자열이 있으면 만들 수 있다" 였다. 그 성질이
   * 사고를 허용했다.
   *
   * `operator-write`(릴리스 절차)에는 걸지 않는다. 그쪽은 사람이 로컬에서 돌리는 것이
   * 정상이고 릴리스 매니페스트가 따로 지킨다.
   */
  it("does not construct a production runtime client off the deployed server", () => {
    process.env.SUPABASE_PRODUCTION_PROJECT_REF = TEST_SUPABASE_PROJECT_REF;
    process.env.SUPABASE_PRODUCTION_WRITE_CONFIRM = `RUNTIME_WRITE:${TEST_SUPABASE_PROJECT_REF}`;
    delete process.env.VERCEL;

    expect(() => createAdminClient()).toThrowError(
      expect.objectContaining({ code: "PRODUCTION_RUNTIME_WRITE_OFF_SERVER" }),
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  /**
   * 새 관문을 넓히면 **릴리스 절차가 막힌다.**
   *
   * 릴리스는 사람이 로컬에서 돌리는 것이 정상이고(`operator-write`), 그쪽은 릴리스
   * 매니페스트와 확인 문자열이 따로 지킨다. 그런데 관문을 `access !== "read"` 로 넓혀도
   * 아무 검사도 실패하지 않았다 — 뮤테이션으로 확인했다. 그러면 **출시 당일에야** 안다.
   *
   * 그래서 반대 방향도 못 박는다.
   */
  it("still allows the operator release path from a local machine", () => {
    expect(() =>
      verifySupabaseServiceDestination({
        url: TEST_SUPABASE_URL,
        serviceRoleKey: TEST_SUPABASE_SERVICE_ROLE_KEY,
        expectedUrl: TEST_SUPABASE_URL,
        expectedProjectRef: TEST_SUPABASE_PROJECT_REF,
        productionProjectRef: TEST_SUPABASE_PROJECT_REF,
        productionWriteConfirmation: `OPERATOR_WRITE:${TEST_SUPABASE_PROJECT_REF}`,
        access: "operator-write",
        // 배포된 서버가 아니다 — 릴리스를 돌리는 사람의 PC 다.
        runningOnDeployedServer: false,
      }),
    ).not.toThrow();
  });

  it("still allows non-production targets off the deployed server", () => {
    // 스테이징·로컬을 향한 쓰기까지 막으면 개발이 통째로 멈춘다.
    process.env.SUPABASE_PRODUCTION_PROJECT_REF = "slrtobkksjmxgzatjyqb";
    delete process.env.VERCEL;

    expect(createAdminClient()).toEqual({ pinned: true });
    expect(mocks.createClient).toHaveBeenCalledOnce();
  });
});
