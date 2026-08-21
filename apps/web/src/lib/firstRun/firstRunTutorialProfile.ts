import {
  FIRST_RUN_TUTORIAL_COLUMNS,
  FIRST_RUN_TUTORIAL_VERSION,
  isMissingFirstRunTutorialColumn,
  parseFirstRunTutorialState,
  type FirstRunTutorialState,
} from "@hanbang/shared";

/**
 * 첫 실행 튜토리얼의 "봤다"를 계정에 읽고 쓴다.
 *
 * ## 왜 화면이 아니라 여기인가
 *
 * 이 판정은 "첫 화면을 오류로 만들지 않는다"는 약속이라 렌더링 없이 테스트되어야
 * 한다. 컴포넌트 안에 두면 Supabase를 세운 테스트만 이 규칙을 볼 수 있다.
 *
 * ## 실패를 어느 쪽으로 넘기는가
 *
 * 읽기 실패(마이그레이션 전이라 컬럼이 없거나, 네트워크가 끊겼거나)는 "아직 안 봤다"로
 * 읽는다. 최악이 "안내를 한 번 더 본다"이고, 반대 방향은 "처음 온 사람이 아무 안내도
 * 못 받는다"라 훨씬 나쁘다.
 *
 * 쓰기 실패는 화면을 막지 않는다. 그 세션은 기기 저장소(SpotlightTutorial의
 * storageKey + 세션 키)로 버티고, 다음 기기에서 한 번 더 보는 정도로 끝난다.
 */

const UNSEEN: FirstRunTutorialState = { completedAt: null, version: null };

/**
 * 이 파일이 쓰는 만큼만 적은 Supabase 모양. 클라이언트 전체 타입을 요구하면
 * 테스트가 진짜 클라이언트를 세워야 하고, 그러면 "컬럼이 없을 때"를 재현할 수 없다.
 */
export interface FirstRunTutorialProfileClient {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<{ error: unknown }>;
    };
  };
}

/**
 * 프로필에서 튜토리얼 상태를 읽는다. **어떤 실패에서도 던지지 않는다** —
 * select 하나 때문에 라운지가 오류 화면이 되면 안 된다.
 */
export async function readFirstRunTutorialState(
  client: FirstRunTutorialProfileClient,
  userId: string,
): Promise<FirstRunTutorialState> {
  try {
    const { data, error } = await client
      .from("profiles")
      .select(FIRST_RUN_TUTORIAL_COLUMNS)
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      // 컬럼이 아직 없는 배포(42703)든 다른 오류든, 여기서는 "안 봤다"로 같다.
      // 다만 컬럼 부재는 예상된 상태라 로그도 남기지 않는다.
      if (!isMissingFirstRunTutorialColumn(error)) {
        console.warn("[firstRunTutorial] 상태를 읽지 못했어요");
      }
      return UNSEEN;
    }

    return parseFirstRunTutorialState(data);
  } catch {
    return UNSEEN;
  }
}

/**
 * 완료 시각과 판을 본인 행에 적는다(RLS: profiles_update_own).
 *
 * 새 RPC를 만들지 않는다 — 본인 행 UPDATE 정책이 이미 있고, 여기서 필요한 건
 * 딱 두 컬럼이다. 성공 여부를 돌려주되, 부르는 쪽은 실패해도 화면을 막지 않는다.
 */
export async function markFirstRunTutorialCompleted(
  client: FirstRunTutorialProfileClient,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    const { error } = await client
      .from("profiles")
      .update({
        first_run_tutorial_completed_at: now.toISOString(),
        first_run_tutorial_version: FIRST_RUN_TUTORIAL_VERSION,
      })
      .eq("id", userId);

    return !error;
  } catch {
    return false;
  }
}

/**
 * Supabase 브라우저 클라이언트를 위 모양으로 받아들인다.
 *
 * 왜 캐스팅인가: Supabase의 쿼리 빌더 타입은 제네릭이 깊어서 위 최소 모양과
 * **구조적으로 비교하는 순간** tsc가 "Type instantiation is excessively deep"으로
 * 멈춘다(실제로 그랬다). 실행 시 모양은 동일하므로 경계에서 한 번만 좁힌다.
 */
export function asFirstRunTutorialProfileClient(
  client: unknown,
): FirstRunTutorialProfileClient {
  return client as FirstRunTutorialProfileClient;
}
