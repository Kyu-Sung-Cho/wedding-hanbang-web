/**
 * 첫 실행 튜토리얼 — 라운지에 처음 도착한 사람에게 "여기서 뭘 할 수 있는지"를
 * 한 번만 짚어주고, 마지막에 아모라에게 넘긴다.
 *
 * ## 왜 계약을 따로 두는가
 *
 * 튜토리얼 자체는 이미 두 벌 있었다. 앱에는 6슬라이드짜리 AppGuide가, 웹에는
 * 스포트라이트 투어가. 둘 다 완성돼 있었는데 **아무 데서도 실행되지 않았다** —
 * 앱 쪽은 import하는 파일이 0개였고, 웹 쪽은 URL로 도달할 수 없는 라우트에만
 * 붙어 있었다. 만든 사람이 없어서가 아니라, "언제 뜨는가"를 아무도 소유하지
 * 않아서 생긴 일이다.
 *
 * 그래서 화면이 아니라 **조건**을 여기 둔다. 언제 뜨는지, 무엇을 짚는지, 끝났다는
 * 사실을 어디에 적는지 — 이 셋은 웹과 앱이 반드시 같아야 한다.
 *
 * ## 왜 기기가 아니라 계정에 적는가
 *
 * 예전 두 구현은 localStorage와 AsyncStorage에 "봤음"을 적었다. 그러면 폰에서 본
 * 사람이 노트북으로 처음 들어올 때 또 보고, 브라우저 데이터를 지우면 또 본다.
 * 커플 앱은 두 기기를 오가는 게 기본이라 이건 예외가 아니라 일상이다.
 *
 * 그래서 완료 시각은 `profiles.first_run_tutorial_completed_at`에 적는다. 기기
 * 저장소는 "지금 이 세션에서 이미 띄웠다" 정도만 담당한다.
 *
 * ## 버전
 *
 * 기능이 크게 바뀌면 다시 보여줘야 할 수 있다. 그때 컬럼을 비우는 대신 버전을
 * 올린다 — 지운 기록은 되돌릴 수 없지만, 버전은 언제 무엇 때문에 다시 띄웠는지가
 * 남는다.
 */

/** 지금 배포된 튜토리얼의 판. 내용이 크게 바뀔 때만 올린다. */
export const FIRST_RUN_TUTORIAL_VERSION = 1;

/**
 * 튜토리얼이 끝났음을 같은 화면의 다른 조각(아모라 FAB)에게 알리는 이벤트 이름.
 * 웹은 `window.dispatchEvent(new CustomEvent(...))`, 앱은 자체 이벤트 버스가
 * 이 이름을 쓴다.
 *
 * 주의: 예전부터 있던 `hanbang:service-guide-completed`와 다르다. 그건 사용자가
 * 직접 연 6슬라이드 안내가 끝났다는 뜻이라, 첫 실행 사용자에게는 영원히 오지 않는다.
 */
export const FIRST_RUN_TUTORIAL_COMPLETED_EVENT =
  "hanbang:first-run-tutorial-completed" as const;

/** 이번 세션에서 이미 띄웠는지만 기억하는 기기 저장소 키. 완료 사실의 정본이 아니다. */
export const FIRST_RUN_TUTORIAL_SESSION_KEY =
  "@hanbang/first_run_tutorial_shown_session" as const;

export const FIRST_RUN_TUTORIAL_STEP_IDS = [
  "lounge-focus",
  "lounge-tools",
  "lounge-invite",
  "amora-fab",
] as const;

export type FirstRunTutorialStepId =
  (typeof FIRST_RUN_TUTORIAL_STEP_IDS)[number];

export interface FirstRunTutorialStep {
  id: FirstRunTutorialStepId;
  /** 말풍선 제목. */
  title: string;
  /** 한두 줄 설명. 기능 이름이 아니라 "이걸로 뭘 할 수 있는지"를 쓴다. */
  body: string;
  /**
   * 앵커가 화면에 없으면 이 단계를 조용히 건너뛴다. 예: 이미 파트너와 연결된
   * 사람에게는 초대 코드 카드가 없다.
   */
  optional: boolean;
}

/**
 * 웹과 앱이 같은 말을 한다. 앵커 id도 같다 — 플랫폼마다 다른 이름을 쓰면
 * 한쪽 앵커가 사라져도 아무도 모른다.
 */
export const FIRST_RUN_TUTORIAL_STEPS: readonly FirstRunTutorialStep[] = [
  {
    id: "lounge-focus",
    title: "여기부터 보시면 돼요",
    body: "오늘 챙기면 좋을 것 하나를 여기에 올려둬요. 할 일이 많아 보여도, 시작은 늘 한 가지예요.",
    optional: false,
  },
  {
    id: "lounge-tools",
    title: "준비는 여기서 이어가요",
    body: "체크리스트·예산·일정이 한자리에 있어요. 지금 안 눌러도 괜찮아요, 필요할 때 찾아오면 돼요.",
    optional: false,
  },
  {
    id: "lounge-invite",
    title: "파트너를 부르면 같이 봐요",
    body: "초대 코드를 보내면 두 사람이 같은 화면을 봐요. 혼자서도 다 되지만, 같이 보면 두 번 말할 일이 줄어요.",
    optional: true,
  },
  {
    id: "amora-fab",
    title: "막히면 아모라에게",
    body: "무엇부터 할지 모르겠을 때 여기를 누르세요. 안내를 마치면 아모라가 먼저 말을 걸어요.",
    optional: false,
  },
] as const;

/** 프로필에서 읽어야 할 컬럼. select 문자열을 화면마다 따로 적으면 한쪽만 빠진다. */
export const FIRST_RUN_TUTORIAL_COLUMNS =
  "first_run_tutorial_completed_at, first_run_tutorial_version" as const;

/**
 * 이 오류가 "컬럼이 아직 없다"인가.
 *
 * 앱이 마이그레이션보다 먼저 나가는 순간이 반드시 생긴다(웹 배포와 DB 적용은 원자적이지
 * 않고, 앱은 스토어 심사와 OTA 시차가 있다). 그때 이 select는 42703(undefined_column)으로
 * 실패하는데, 그걸 일반 오류로 다루면 첫 화면이 통째로 오류 상태가 된다.
 *
 * 컬럼이 없다 = 아직 아무도 튜토리얼을 끝내지 않았다. 그렇게 읽으면 최악이 "안내를 한 번
 * 더 본다"이고, 이 방향의 실패는 안전하다.
 */
export function isMissingFirstRunTutorialColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "42703") return true;

  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return false;
  return (
    message.includes("first_run_tutorial_completed_at")
    || message.includes("first_run_tutorial_version")
  );
}

export interface FirstRunTutorialState {
  /** 완료 시각(ISO). 아직 안 봤으면 null. */
  completedAt: string | null;
  /** 완료 당시의 판. 지금 판보다 낮으면 다시 보여줄 수 있다. */
  version: number | null;
}

const EMPTY_STATE: FirstRunTutorialState = { completedAt: null, version: null };

/**
 * 프로필 행에서 튜토리얼 상태를 읽는다. 컬럼이 아직 없는 배포(마이그레이션 전)나
 * 값이 이상한 경우 모두 "아직 안 봤다"로 떨어진다.
 *
 * 이 방향의 실패는 안전하다 — 최악이 "튜토리얼을 한 번 더 본다"이고, 반대 방향은
 * "처음 온 사람이 아무 안내도 못 받는다"라서 훨씬 나쁘다.
 */
export function parseFirstRunTutorialState(
  profile: unknown,
): FirstRunTutorialState {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return EMPTY_STATE;
  }
  const row = profile as Record<string, unknown>;
  const completedAt = row.first_run_tutorial_completed_at;
  const version = row.first_run_tutorial_version;

  return {
    completedAt:
      typeof completedAt === "string" && completedAt.length > 0
        ? completedAt
        : null,
    version:
      typeof version === "number" && Number.isFinite(version) ? version : null,
  };
}

/**
 * 지금 이 사람에게 튜토리얼을 띄워야 하는가.
 *
 * 온보딩을 마치지 않은 사람에게는 띄우지 않는다 — 라운지에 아직 보여줄 게 없고,
 * 온보딩 중간에 튜토리얼이 끼어들면 하던 것을 잃는다.
 */
export function shouldShowFirstRunTutorial(input: {
  onboardingCompleted: boolean;
  state: FirstRunTutorialState;
  /** 이번 세션에서 이미 한 번 띄웠는지(기기 저장소). */
  shownThisSession?: boolean;
}): boolean {
  if (!input.onboardingCompleted) return false;
  if (input.shownThisSession) return false;
  if (input.state.completedAt === null) return true;
  return (input.state.version ?? 0) < FIRST_RUN_TUTORIAL_VERSION;
}
