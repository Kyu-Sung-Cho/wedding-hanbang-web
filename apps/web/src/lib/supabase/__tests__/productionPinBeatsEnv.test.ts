// @vitest-environment node

/**
 * 환경변수가 거짓을 말해도 운영은 운영이다.
 *
 * ## 무엇이 있었나
 *
 * 관문은 "이 목적지가 운영인가"를 `input.productionProjectRef` 로 판단했다. 그런데
 * **그 값을 주는 곳이 목적지를 고르는 환경과 같다.** 로컬 모양으로 잘못 적힌 환경이
 * 진짜 운영 목적지를 "쓰기 확인이 필요 없는 곳"으로 강등시킬 수 있었다.
 *
 * PR #112(2026-08-18)가 짚은 것을 가져왔다. 저장소가 운영 ref 를 직접 갖고, 환경이
 * 무엇을 말하든 그 목록에 있으면 운영으로 본다.
 *
 * 이 저장소에는 실제로 로컬 `pnpm dev` 가 운영 DB 를 가리켜 커플 기록이 상한 이력이
 * 있다. 그 사고를 막는 다른 장치(배포 서버 확인)는 `destinationFence.ts` 에 그대로 있고,
 * 이 핀은 그 앞단에서 "운영인지"를 잘못 판정하는 경로를 막는다.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REPOSITORY_PRODUCTION_PROJECT_REFS,
  verifySupabaseServiceDestination,
} from "@/lib/supabase/destinationFence";

const PRODUCTION_REF = REPOSITORY_PRODUCTION_PROJECT_REFS[0];
const url = `https://${PRODUCTION_REF}.supabase.co`;
const serviceRoleKey = `sb_secret_${"a".repeat(40)}`;

function verify(overrides: Record<string, unknown> = {}) {
  return verifySupabaseServiceDestination({
    url,
    expectedUrl: url,
    expectedProjectRef: PRODUCTION_REF,
    serviceRoleKey,
    access: "operator-write",
    // 환경이 **운영 ref 를 다른 값으로 말한다.** 이것이 이 검사의 요점이다.
    productionProjectRef: "zzzzzzzzzzzzzzzzzzzz",
    ...overrides,
  } as never);
}

describe("환경이 운영 ref 를 다르게 말해도", () => {
  it("쓰기 확인 없이는 막힌다", () => {
    // 핀이 없으면 이 호출이 통과한다 — 운영에 확인 없이 쓴다.
    // 메시지가 아니라 code 로 본다. 문구는 바뀔 수 있고 계약은 code 다.
    let thrown: unknown = null;
    try {
      verify();
    } catch (error) {
      thrown = error;
    }
    expect(thrown, "막지 않았습니다").not.toBeNull();
    expect((thrown as { code?: string }).code).toBe("PRODUCTION_WRITE_CONFIRMATION_REQUIRED");
  });

  it("올바른 확인 문자열이 있으면 통과한다", () => {
    // 막기만 하고 정상 경로를 닫으면 릴리스 절차가 멈춘다.
    expect(() =>
      verify({ productionWriteConfirmation: `OPERATOR_WRITE:${PRODUCTION_REF}` }),
    ).not.toThrow();
  });

  it("읽기는 그대로 열려 있다", () => {
    expect(() => verify({ access: "read" })).not.toThrow();
  });
});

describe("핀 목록이 두 곳에서 갈라지지 않는다", () => {
  it("웹과 scripts 가 같은 ref 를 갖는다", () => {
    // 한쪽만 고치면 다른 경로로 같은 사고가 난다.
    const scriptSource = readFileSync(
      resolve(process.cwd(), "../../scripts/lib/supabase-service-destination.mjs"),
      "utf8",
    );
    for (const ref of REPOSITORY_PRODUCTION_PROJECT_REFS) {
      expect(scriptSource, `scripts 쪽에 ${ref} 가 없습니다`).toContain(ref);
    }
    expect(scriptSource).toContain("REPOSITORY_PRODUCTION_PROJECT_REFS");
  });
});
