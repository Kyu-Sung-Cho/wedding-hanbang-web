import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from "react";

/**
 * 웹의 첫 공유 UI 프리미티브.
 *
 * ## 왜 만들었나
 *
 * 2026-08-20 실측: `<button>` 716개 중 정적 className을 가진 521개가 서로 다른 조합
 * **466종**을 쓴다. 그중 **419종(90%)이 딱 한 번씩만** 쓰인다. 3회 이상 반복된 조합은
 * 7종·버튼 22개뿐이다. 색이 흩어진 게 아니라 **버튼을 매번 새로 쓰고 있었다.**
 *
 * 그래서 이 파일의 목적은 "반복을 추출"하는 게 아니라 **어휘를 정하는 것**이다.
 * 반복이 없으니 추출할 것도 없다.
 *
 * ## 색을 리터럴로 박지 않는다
 *
 * 모든 색은 역할 변수(`--hb-*`)로 받는다. 그래야 같은 버튼이 랜딩과 제품 안에서
 * 각자 맞는 색으로 나온다 — `globals.css`의 `!important` 96개가 하던 일을, 덮어쓰기가
 * 아니라 **변수 재정의**로 한다. 컨텍스트별 재정의가 실제로 동작하는 것은 확인했다.
 *
 * ## 접근성은 옵션이 아니라 기본값이다
 *
 * 실측된 결함을 "쓰는 사람이 조심하기"로 두지 않고 타입과 기본값으로 막는다.
 *
 *   - 아이콘 전용 버튼 133개 중 58개에 접근명이 없었다 → `variant="icon"`이면
 *     `label`이 **타입상 필수**다. 빠뜨리면 컴파일이 안 된다.
 *   - 702개 중 포커스 스타일을 가진 것이 52개(7.4%)뿐이었다 → 링을 base에 고정한다.
 *   - `type`을 안 적은 버튼이 188개였다(오늘은 form 밖이라 무해하지만, 언젠가 form
 *     안으로 옮겨지면 조용히 submit 된다) → 기본값을 `"button"`으로 둔다.
 *   - `loading`은 스피너만 돌고 보조기술에는 아무 말도 안 하는 경우가 많았다 →
 *     `aria-busy`와 `disabled`를 함께 건다.
 */

/**
 * 청첩장 디자인(2026-11-17) 변형. 파운더 아티팩트의 알약 버튼을 그대로 옮긴다.
 *
 *   - `ink`     먹색 채움, 흰 글자(시작하기·좋아요, 홀 찾아 주세요·문자로 보내기)
 *   - `soft`    돌빛 채움(고칠게요)
 *   - `outline` 흰 바탕에 가는 테두리(다른 시간 묻기·정렬 칩·빼기)
 *   - `dashed`  점선 테두리(반지와 예물 넣기)
 *   - `glass`   사진 위 반투명 흰 면(캘린더에 있어요)
 *   - `plain`   면 없이 흐린 본문 글자(무엇을 했나요?)
 *   - `text`    면 없이 먹색 글자, 올리면 흐려진다(예시 커플로 둘러보기·나중에 할게요)
 */
type InvitationVariant = "ink" | "soft" | "outline" | "dashed" | "glass" | "plain" | "text";
type Variant = "primary" | "secondary" | "ghost" | "icon" | InvitationVariant;
type PillSize = "pill-56" | "pill-54" | "pill-46" | "pill-44" | "pill-42" | "pill-40" | "pill-38" | "pill-34";
type Size = "sm" | "md" | "lg" | PillSize;
type Weight = "regular" | "medium" | "bold";

const BASE = [
  "inline-flex items-center justify-center gap-2",
  "whitespace-nowrap",
  "transition-[background-color,border-color,color,opacity] duration-200",
  // 포커스 링은 예외 없이 붙는다 — 지금 웹 버튼의 92.6%에 이게 없다.
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2",
  "disabled:cursor-not-allowed disabled:opacity-50",
].join(" ");

const VARIANT: Record<Variant, string> = {
  primary: [
    "bg-[var(--hb-action)] text-[var(--hb-on-primary)]",
    "hover:bg-[var(--hb-action-hover)]",
  ].join(" "),
  secondary: [
    "border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)] text-[var(--hb-text-strong)]",
    "hover:bg-[var(--hb-surface-hover)]",
  ].join(" "),
  ghost: "text-[var(--hb-text-body)] hover:bg-[var(--hb-surface-hover)]",
  icon: "text-[var(--hb-text-muted)] hover:bg-[var(--hb-surface-hover)] hover:text-[var(--hb-text-strong)]",
  // 아래는 청첩장 디자인. 아티팩트는 채운 알약에 올렸을 때의 변화를 두지 않았다(인라인 흰 글자가
  // a:hover 를 이긴다). 글자만 있는 링크만 올리면 흐린 글자색(muted)으로 바뀐다.
  ink: "bg-inv-ink text-inv-white",
  soft: "bg-inv-stone text-inv-ink",
  outline: "border border-inv-chip-line bg-inv-white text-inv-ink",
  dashed: "border border-dashed border-inv-dashed bg-inv-white text-inv-ink",
  glass: "bg-white/90 text-inv-ink",
  plain: "bg-transparent text-inv-body",
  text: "bg-transparent text-inv-ink hover:text-inv-muted",
};

/**
 * 알약 크기. 아티팩트의 높이와 반경(높이의 절반)을 그대로 쓴다. 좌우 여백과 글자 굵기는
 * 자리마다 달라서 크기에 넣지 않는다 — 여백은 `className`, 굵기는 `weight` 로 준다.
 *
 * 44px 보다 낮은 알약은 `tap-area` 로 보이는 상자를 그대로 두고 누르는 영역만 44px 로 넓힌다.
 * `globals.css` 의 모바일 44px 규칙이 레이어 밖에서 `h-*` 를 이겨 상자를 부풀리기 때문이다.
 */
const PILL_SIZE: Record<PillSize, string> = {
  "pill-56": "h-14 rounded-[28px] text-[16px]",
  "pill-54": "h-[54px] rounded-[27px] text-[15px]",
  "pill-46": "h-[46px] rounded-[23px] text-[14px]",
  "pill-44": "h-11 rounded-[22px] text-[14px]",
  "pill-42": "tap-area h-[42px] rounded-[21px] text-[14px]",
  "pill-40": "tap-area h-10 rounded-[20px] text-[13px]",
  "pill-38": "tap-area h-[38px] rounded-[19px] text-[13px]",
  "pill-34": "tap-area h-[34px] rounded-[17px] text-[13px]",
};

const WEIGHT: Record<Weight, string> = {
  regular: "font-normal",
  medium: "font-medium",
  bold: "font-bold",
};

function isPillSize(size: Size): size is PillSize {
  return size.startsWith("pill-");
}

/** 높이는 실측된 지배값을 따른다 — md=44px가 161개로 가장 많고 전역 규칙과도 같다. */
// 반경은 정본 시안을 따른다 — `docs/landing/NotebookBest.html:47,54` 의 `.btn`·`.btn-line`
// 이 둘 다 `border-radius: 6px` 다. 시안 전체에서 pill 은 **버튼에 한 번도 안 쓰인다**
// (999px 은 손그림 동그라미 주석 `.circle` 하나뿐).
//
// ⚠️ 여기 `rounded-full` 이 있었다. 아래 ICON_SIZE 의 원형은 그대로 둔다 — 아이콘
// 버튼은 시안의 `.circle` 과 같은 계열이고, 아바타·배지와 함께 원형이 정본이다.
//
// 높이는 시안의 54px 이 아니라 44px 를 지킨다. `globals.css` 의 44px 탭 규칙이
// 레이어 밖이라 `min-h-*` 를 이기고, 그 규칙이 접근성 계약(2.5.8)을 지고 있다.
type ClassicSize = Exclude<Size, PillSize>;

// `font-semibold` 은 원래 BASE 에 있었다. 알약 크기가 굵기를 따로 정하게 되면서
// 옛 크기 쪽으로 옮겼다 — 옛 버튼이 받는 클래스 묶음은 그대로다.
const SIZE: Record<ClassicSize, string> = {
  sm: "min-h-10 rounded-[6px] px-4 text-[13px] font-semibold",
  md: "min-h-11 rounded-[6px] px-5 text-[14px] font-semibold",
  lg: "min-h-12 rounded-[6px] px-6 text-[15px] font-semibold",
};

const ICON_SIZE: Record<ClassicSize, string> = {
  sm: "size-9 rounded-full p-0 font-semibold",
  md: "size-11 rounded-full p-0 font-semibold",
  lg: "size-12 rounded-full p-0 font-semibold",
};

type Common = {
  variant?: Variant;
  size?: Size;
  /** 알약 크기의 글자 굵기. 옛 크기(sm·md·lg)는 늘 semibold 라 이 값을 읽지 않는다. */
  weight?: Weight;
  loading?: boolean;
  fullWidth?: boolean;
  className?: string;
};

/** 아이콘 전용 버튼은 접근명을 **타입으로** 요구한다. */
type Content =
  | { variant?: Exclude<Variant, "icon">; children: ReactNode; label?: never }
  | { variant: "icon"; children: ReactNode; label: string };

type AsButton = Common
  & Content
  & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">
  & { href?: never; ref?: Ref<HTMLButtonElement> };

type AsLink = Common
  & Content
  & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children" | "href">
  & {
    href: string;
    ref?: Ref<HTMLAnchorElement>;
    /** 앱 안 링크의 미리 받기(`next/link`). 바깥 주소에는 뜻이 없어 넘기지 않는다. */
    prefetch?: boolean;
    // 링크는 `disabled` 될 수 없다. `loading`도 마찬가지다 — 링크 분기는 그것을 읽을
    // 방법이 없어서, 받아만 놓고 아무 일도 안 하면 호출자가 중복 클릭을 막았다고
    // 믿게 된다. 타입에서 막는 편이 정직하다.
    disabled?: never;
    loading?: never;
  };

export type ButtonProps = AsButton | AsLink;

/**
 * 앱 안 이동인지 판별한다. `hanbang://invite#CODE` 같은 커스텀 스킴이나 외부 주소를
 * `next/link`에 넘기면 클라이언트 라우터가 가로채서 이동이 안 된다.
 */
function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

function sizeClasses(variant: Variant, size: Size, weight: Weight | undefined): string {
  if (isPillSize(size)) return `${PILL_SIZE[size]} ${WEIGHT[weight ?? "regular"]}`;
  return variant === "icon" ? ICON_SIZE[size] : SIZE[size];
}

function classesFor({ variant = "secondary", size = "md", weight, fullWidth, className }: Common & { variant?: Variant }) {
  return [
    BASE,
    VARIANT[variant],
    sizeClasses(variant, size, weight),
    fullWidth ? "w-full" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

export default function Button(props: ButtonProps) {
  // 공개 타입은 위의 유니온이 엄격하게 지키고, 여기서는 한 번만 합쳐서 푼다.
  // 버릴 값을 `_v` 같은 이름으로 구조분해하면 미사용 경고만 늘어난다.
  const merged = props as AsButton & Partial<AsLink>;
  const {
    variant = "secondary",
    size = "md",
    weight,
    loading,
    fullWidth,
    className,
    children,
    label,
    href,
    ...rest
  } = merged;

  const classes = classesFor({ variant, size, weight, fullWidth, className });

  if (href !== undefined) {
    const { prefetch, ...linkRest } = rest as AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean };
    const anchorProps = linkRest as AnchorHTMLAttributes<HTMLAnchorElement>;
    // 호출자가 준 접근명이 이긴다. `label`은 아이콘 변형의 기본값일 뿐이다.
    // 이 순서를 뒤집으면(스프레드 뒤에 aria-label을 두면) 호출자가 준 값이
    // undefined로 덮여 **접근명이 통째로 사라진다.** 실제로 그렇게 만들었다가
    // 2026-08-20 적대 검토에서 잡혔다.
    const accessibleName = anchorProps["aria-label"] ?? label;

    // `hanbang://` 같은 스킴이나 외부 주소는 `next/link`가 가로채면 이동이 안 된다.
    if (!isInternalHref(href)) {
      return (
        <a {...anchorProps} href={href} className={classes} aria-label={accessibleName}>
          {children}
        </a>
      );
    }

    return (
      <Link {...anchorProps} href={href} prefetch={prefetch} className={classes} aria-label={accessibleName}>
        {children}
      </Link>
    );
  }

  const buttonProps = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  const accessibleName = buttonProps["aria-label"] ?? label;

  return (
    <button
      // 지금 웹에는 type을 안 적은 버튼이 188개다. 기본값을 여기서 정한다.
      type="button"
      {...buttonProps}
      className={classes}
      aria-label={accessibleName}
      // `loading`이면 무조건 바쁘다고 말하되, 호출자가 직접 건 값도 지우지 않는다.
      aria-busy={loading || buttonProps["aria-busy"] || undefined}
      disabled={loading || buttonProps.disabled}
    >
      {children}
    </button>
  );
}
