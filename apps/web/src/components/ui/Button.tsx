import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

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

type Variant = "primary" | "secondary" | "ghost" | "icon";
type Size = "sm" | "md" | "lg";

const BASE = [
  "inline-flex items-center justify-center gap-2",
  "font-semibold whitespace-nowrap",
  "transition-[background-color,border-color,color,opacity] duration-200",
  // 포커스 링은 예외 없이 붙는다 — 지금 웹 버튼의 92.6%에 이게 없다.
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2",
  "disabled:cursor-not-allowed disabled:opacity-50",
].join(" ");

const VARIANT: Record<Variant, string> = {
  primary: [
    "bg-[var(--hb-primary)] text-[var(--hb-on-primary)]",
    "hover:bg-[var(--hb-primary-hover)]",
  ].join(" "),
  secondary: [
    "border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)] text-[var(--hb-text-strong)]",
    "hover:bg-[var(--hb-surface-hover)]",
  ].join(" "),
  ghost: "text-[var(--hb-text-body)] hover:bg-[var(--hb-surface-hover)]",
  icon: "text-[var(--hb-text-muted)] hover:bg-[var(--hb-surface-hover)] hover:text-[var(--hb-text-strong)]",
};

/** 높이는 실측된 지배값을 따른다 — md=44px가 161개로 가장 많고 전역 규칙과도 같다. */
const SIZE: Record<Size, string> = {
  sm: "min-h-10 rounded-full px-4 text-[13px]",
  md: "min-h-11 rounded-full px-5 text-[14px]",
  lg: "min-h-12 rounded-full px-6 text-[15px]",
};

const ICON_SIZE: Record<Size, string> = {
  sm: "size-9 rounded-full p-0",
  md: "size-11 rounded-full p-0",
  lg: "size-12 rounded-full p-0",
};

type Common = {
  variant?: Variant;
  size?: Size;
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
  & { href?: never };

type AsLink = Common
  & Content
  & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children" | "href">
  & { href: string; disabled?: never };

export type ButtonProps = AsButton | AsLink;

/**
 * 앱 안 이동인지 판별한다. `hanbang://invite#CODE` 같은 커스텀 스킴이나 외부 주소를
 * `next/link`에 넘기면 클라이언트 라우터가 가로채서 이동이 안 된다.
 */
function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

function classesFor({ variant = "secondary", size = "md", fullWidth, className }: Common & { variant?: Variant }) {
  return [
    BASE,
    VARIANT[variant],
    variant === "icon" ? ICON_SIZE[size] : SIZE[size],
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
    loading,
    fullWidth,
    className,
    children,
    label,
    href,
    ...rest
  } = merged;

  const classes = classesFor({ variant, size, fullWidth, className });

  if (href !== undefined) {
    const anchorProps = rest as AnchorHTMLAttributes<HTMLAnchorElement>;

    // `hanbang://` 같은 스킴이나 외부 주소는 `next/link`가 가로채면 이동이 안 된다.
    if (!isInternalHref(href)) {
      return (
        <a href={href} {...anchorProps} className={classes} aria-label={label}>
          {children}
        </a>
      );
    }

    return (
      <Link href={href} {...anchorProps} className={classes} aria-label={label}>
        {children}
      </Link>
    );
  }

  const buttonProps = rest as ButtonHTMLAttributes<HTMLButtonElement>;

  return (
    <button
      // 지금 웹에는 type을 안 적은 버튼이 188개다. 기본값을 여기서 정한다.
      type="button"
      {...buttonProps}
      className={classes}
      aria-label={label}
      aria-busy={loading || undefined}
      disabled={loading || buttonProps.disabled}
    >
      {children}
    </button>
  );
}
