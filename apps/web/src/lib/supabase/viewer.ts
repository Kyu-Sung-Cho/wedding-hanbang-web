import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * `auth.getUser()` 를 **던지지 않게** 감싼다.
 *
 * 이 함수는 계약상 `{ data, error }` 를 돌려주게 되어 있고 라우트들도 그렇게 쓴다.
 * 그런데 실제로는 던진다 — 세션 저장소를 읽는 단계에서 나는 예외는 반환값이 아니라
 * 예외로 나온다(`lib/supabase/authCookies.ts` 의 base64 디코딩이 그 예다). 라우트의
 * 맨 바깥 `catch` 가 그것을 받아 `500 {"error":"서버 오류가 발생했습니다."}` 로 바꾸므로,
 * **없는 글 주소조차 404 가 아니라 500** 이 된다.
 *
 * 던지는 원인을 하나 고치는 것과 별개로, 이 자리는 앞으로도 던질 수 있다 — 라이브러리
 * 내부이고 우리 손 밖이다. 그래서 원인이 무엇이든 "확인 실패" 라는 **값**으로 바꾼다.
 * 그러면 호출부의 기존 판단(자격 증명을 제시한 요청만 503, 그 외에는 로그아웃 방문자로
 * 취급)이 그대로 살아 있고, 500 만 사라진다.
 *
 * 로그아웃 방문자에게는 여기서도 `error`(AuthSessionMissingError)가 온다. 그것을
 * 어떻게 읽을지는 호출부가 `hasPresentedAuthCredential` 과 함께 정한다 — 이 함수는
 * 그 정책을 바꾸지 않는다.
 */
export type ViewerRead = {
  user: User | null;
  error: unknown;
};

export async function readViewer(
  supabase: Pick<SupabaseClient, "auth">,
): Promise<ViewerRead> {
  try {
    const { data, error } = await supabase.auth.getUser();
    return { user: data?.user ?? null, error: error ?? null };
  } catch (error) {
    // 원문은 돌려주지 않는다 — 호출부는 진위만 보고, 원문에는 내부 식별자가 있다.
    return { user: null, error: new Error("SUPABASE_VIEWER_READ_FAILED", { cause: error }) };
  }
}
