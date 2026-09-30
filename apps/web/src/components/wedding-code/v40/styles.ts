/**
 * 웨딩코드 4.0 입력 컴포넌트가 함께 쓰는 클래스 상수와 아주 작은 도우미.
 *
 * 이 파일은 폴더 안의 다른 빌더도 가져다 쓰므로 이름과 뜻을 바꾸지 않는다.
 * 색은 역할 변수(하이픈 둘로 시작하는 hb 변수)만 쓴다. 색만으로 뜻을 전하지 않으니 선택 표시는 항상 모양(굵은 테두리, 안쪽 표식)과 함께 쓴다.
 *
 * 조합 규칙
 * - card 는 고르지 않았을 때의 모양이고, cardSelected 는 그 위에 덧씌우는 선택 모양이다. 둘은 느낌표(중요) 표시가 붙어 있어 순서와 상관없이 cardSelected 가 이긴다.
 *   쓰는 법: cx(card, selected && cardSelected)
 * - radioMark 와 radioMarkSelected 도 같은 방식이다.
 * - 클래스 예시를 주석에 적지 않는다. 주석의 클래스 모양 글자도 스타일 생성기가 읽어 잘못된 규칙을 만든다.
 */

/** 클래스 이름을 이어 붙인다. 거짓 값과 빈 문자열은 버린다. */
export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === "string" && part !== "").join(" ");
}

// ---------------------------------------------------------------------------
// 낭독기 전용, 초점, 터치 목표
// ---------------------------------------------------------------------------

/** 화면에서는 숨기고 화면 낭독기에는 읽히는 글. 번호나 A/B 라벨을 여기 넣지 않는다. */
export const srOnly = "sr-only";

/** 터치 목표 최소 크기(픽셀). 전역 규칙도 모바일 버튼을 이 크기로 맞춘다. */
export const TOUCH_TARGET_PX = 44;
/** 터치 목표 최소 크기 클래스(높이와 너비 모두 44픽셀). 라디오 칸과 넘기기 단추에 붙인다. */
export const touchTarget = "min-h-11 min-w-11";

/**
 * 키보드 초점 링. 공용 Button 과 같은 링이다.
 * 그림자로 그린 링은 윈도 고대비(forced-colors)에서 사라지므로 투명 윤곽선을 함께 둔다(윤곽선 숨김 유틸리티는 고대비에서만 윤곽선을 되살린다).
 */
export const focusRing =
  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2";

/**
 * 공용 Button 에 얹는 초점 링. Button 은 윤곽선을 그냥 없애서 고대비에서 초점이 안 보이므로, 느낌표(중요)로 이겨서 투명 윤곽선을 되살린다.
 * Button 자체는 이 폴더 밖이라 여기서만 고친다.
 */
export const buttonFocusFix = "focus-visible:outline-hidden!";

// ---------------------------------------------------------------------------
// 카드와 라디오 줄
// ---------------------------------------------------------------------------

/** 카드 바탕(고르지 않은 모양). 테두리 색이 표면과 3대 1 이상 차이 나서 경계가 보인다. */
export const card = "rounded-xl border border-paper-outline bg-[var(--hb-surface-raised)]";
/** 고른 카드. 배경이 바뀌고 테두리가 굵어진다(바깥 테두리 1픽셀에 안쪽 1픽셀을 더해 크기는 그대로). */
export const cardSelected =
  "border-[var(--hb-selected-line)]! bg-[var(--hb-selected-bg)]! shadow-[inset_0_0_0_1px_var(--hb-selected-line)]";

/** 카드 한 장 전체가 라디오인 줄(고르기, 가장·가장 아닌 것의 카드). 앞의 표식과 글을 가로로 놓는다. card 와 함께 쓴다. */
export const radioRow = `flex w-full min-h-12 items-start gap-3 px-4 py-3 text-left text-sm leading-relaxed text-[var(--hb-text-strong)] ${focusRing}`;

/** 라디오 줄 앞의 동그란 표식(고르지 않은 모양). 안쪽에 표식 아이콘을 넣는 자리다. */
export const radioMark =
  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-paper-outline bg-[var(--hb-surface-raised)] text-[var(--hb-on-primary)]";
/** 고른 표식. 채워지고 안쪽에 체크가 보인다(색과 모양 두 가지로 알린다). */
export const radioMarkSelected = "border-[var(--hb-action)]! bg-[var(--hb-action)]!";

// ---------------------------------------------------------------------------
// 글자 모양
// ---------------------------------------------------------------------------

/** 문항 제목(작은 캡션). 번호와 주제 이름은 없다. */
export const captionText = "text-xs font-medium text-[var(--hb-text-muted)]";
/** 앞말(문항의 상황이나 물음). 줄바꿈은 줄 길이를 고르게 맞춘다(마지막 줄에 낱말 하나만 남는 것을 막는다). 지원하지 않는 브라우저에서는 그냥 쓰인다. */
export const stemText = "text-[15px] font-semibold leading-relaxed text-balance text-[var(--hb-text-strong)]";
/** 카드와 보기 안의 글. */
export const bodyText = "text-sm leading-relaxed text-[var(--hb-text-body)]";
/** 형식 안내 한 줄과 넘기기 뒤 안내. */
export const noteText = "text-[13px] leading-relaxed text-[var(--hb-text-muted)]";
/** 다음을 눌렀는데 답이 없을 때처럼 눈에 띄어야 하는 한 줄(색이 아니라 굵기와 글로 알린다). */
export const noticeText = "text-sm font-medium leading-relaxed text-[var(--hb-text-strong)]";
/**
 * 안내 문장을 눈에 띄게 묶는 상자 모양. 다섯 형식이 같은 모양을 써서 「다음」 뒤에 어디를 봐야 하는지가 같다.
 * 글이 있을 때만 붙인다(비어 있는 안내 자리에 붙이면 빈 상자가 보인다). 상자 색만으로 알리지 않고 글이 뜻을 전한다.
 * 왼쪽의 굵은 선은 지나가는 인용 상자(같은 바탕색)와 안내 상자를 가르는 모양이다. 선의 색이 뜻을 전하는 것이 아니라 선이 있다는 것이 안내라는 표시다.
 */
export const noticeBox = "rounded-lg border-l-4 border-[var(--hb-action)] bg-[var(--hb-surface-hover)] px-3 py-2";

// ---------------------------------------------------------------------------
// 이름 규칙
// ---------------------------------------------------------------------------

/**
 * 한 문항 안의 DOM id 규칙. ItemFrame 과 입력 컴포넌트가 같은 접두어로 같은 id 를 계산해 서로를 가리킨다
 * (라디오 그룹의 이름은 앞말 id, 넘기기 단추의 설명은 escapeHelp id 를 가리킨다).
 * 접두어는 화면이 한 화면 안에서 겹치지 않게 준다.
 */
export function itemIds(idPrefix: string) {
  return {
    caption: `${idPrefix}-caption`,
    stem: `${idPrefix}-stem`,
    hint: `${idPrefix}-hint`,
    status: `${idPrefix}-status`,
    escapeHelp: `${idPrefix}-escape-help`,
    question: `${idPrefix}-question`,
    speaker: `${idPrefix}-speaker`,
    quote: `${idPrefix}-quote`,
    groupHelp: `${idPrefix}-group-help`,
    /** 다음을 눌렀는데 이 문항이 덜 채워졌을 때 안내가 들어오는 aria-live 영역. 화면이 이 id 로 첫 미완성 문항을 화면 안으로 스크롤할 수 있다. */
    incomplete: `${idPrefix}-incomplete`,
    /** 두 가지 중 고르기와 자기 선택의 위 카드, 아래 카드 글. 칸의 설명(aria-describedby)이 가리킨다. */
    card0: `${idPrefix}-card-0`,
    card1: `${idPrefix}-card-1`,
  } as const;
}

// ---------------------------------------------------------------------------
// 라디오 그룹 방향키
// ---------------------------------------------------------------------------

/**
 * 라디오 그룹 방향키 규칙(브라우저 기본 라디오 그룹과 같다). 오른쪽과 아래는 다음, 왼쪽과 위는 이전이고 끝에서 반대쪽 끝으로 돈다.
 * 방향키가 아니면 null. index 가 범위 밖이거나 count 가 1 이하여도 null(움직일 곳이 없다).
 */
export function nextRadioIndex(key: string, index: number, count: number): number | null {
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 2 || index < 0 || index >= count) return null;
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index - 1 + count) % count;
  return null;
}
