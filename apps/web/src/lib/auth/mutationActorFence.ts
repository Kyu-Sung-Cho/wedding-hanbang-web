import {
  HANBANG_EXPECTED_ACTOR_USER_ID_HEADER,
  HANBANG_MUTATION_CONTRACT_VERSION,
  HANBANG_MUTATION_CONTRACT_VERSION_HEADER,
} from "@hanbang/shared";

const USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export type MutationActorFenceResult =
  | { ok: true; contract: "legacy" | "v2" }
  | {
      ok: false;
      status: 400 | 409 | 426;
      code:
        | "MUTATION_ACTOR_CONTRACT_INVALID"
        | "MUTATION_ACTOR_CHANGED"
        | "CLIENT_UPDATE_REQUIRED";
      message: string;
    };

/**
 * Binds a mutation to the account that owned the initiating screen.
 *
 * Headerless calls remain a deliberate Phase-A compatibility path. They must
 * be removed only after old mobile/web traffic is proven drained; treating an
 * incomplete or unknown header pair as legacy would silently bypass the fence.
 */
export function verifyMutationActorFence(
  headers: Headers,
  authenticatedUserId: string,
  options: { allowLegacy?: boolean } = {},
): MutationActorFenceResult {
  const rawVersion = headers.get(HANBANG_MUTATION_CONTRACT_VERSION_HEADER);
  const rawExpectedActor = headers.get(HANBANG_EXPECTED_ACTOR_USER_ID_HEADER);

  if (rawVersion === null && rawExpectedActor === null) {
    if (options.allowLegacy === false) {
      return {
        ok: false,
        status: 426,
        code: "CLIENT_UPDATE_REQUIRED",
        message: "보안을 위해 앱을 최신 버전으로 업데이트한 뒤 다시 시도해주세요.",
      };
    }
    return { ok: true, contract: "legacy" };
  }

  if (rawVersion !== HANBANG_MUTATION_CONTRACT_VERSION) {
    return {
      ok: false,
      status: 400,
      code: "MUTATION_ACTOR_CONTRACT_INVALID",
      message: "요청의 계정 확인 정보를 다시 확인해주세요.",
    };
  }

  const expectedActor = rawExpectedActor?.trim().toLowerCase() ?? "";
  if (!USER_ID_PATTERN.test(expectedActor)) {
    return {
      ok: false,
      status: 400,
      code: "MUTATION_ACTOR_CONTRACT_INVALID",
      message: "요청의 계정 확인 정보를 다시 확인해주세요.",
    };
  }

  if (expectedActor !== authenticatedUserId.trim().toLowerCase()) {
    return {
      ok: false,
      status: 409,
      code: "MUTATION_ACTOR_CHANGED",
      message: "계정이 바뀌어 저장하지 않았어요. 현재 계정에서 다시 시도해주세요.",
    };
  }

  return { ok: true, contract: "v2" };
}
