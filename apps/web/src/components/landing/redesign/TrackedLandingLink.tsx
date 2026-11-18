"use client";

import type { ComponentProps, ReactNode } from "react";

import Button from "@/components/ui/Button";
import { captureEvent } from "@/lib/analytics";
import type { LandingCtaSource } from "@/lib/landingAnalytics";
import { clearStartHereDateHandoff } from "@/lib/marketing/startHereDateHandoff";

/**
 * 클릭이 일어난 자리.
 *
 * **고정 목록이다.** 사용자 입력·화면 문구·URL 조각을 싣지 않는다 — 이 저장소에서
 * 클릭 흔적이 첨부 파일명·게시글 제목·닉네임을 실어 나른 적이 있다.
 */
export type { LandingCtaSource } from "@/lib/landingAnalytics";

type ButtonProps = ComponentProps<typeof Button>;

type TrackedLandingLinkProps = {
  href: string;
  source: LandingCtaSource;
  children: ReactNode;
  /** 아이콘 버튼은 랜딩 행동이 아니다. 아이콘 변형은 접근명을 따로 요구하므로 받지 않는다. */
  variant: Exclude<NonNullable<ButtonProps["variant"]>, "icon">;
  size: NonNullable<ButtonProps["size"]>;
  weight?: ButtonProps["weight"];
  className?: string;
  /** 로그인이 필요한 목적지는 랜딩에서 미리 받지 않는다(옛 히어로·헤더와 같다). */
  prefetch?: false;
};

/**
 * 랜딩의 행동 링크.
 *
 * 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)로 랜딩 버튼은 공유
 * `Button` 의 알약을 그대로 쓴다. 이 컴포넌트는 그 위에 **누른 자리만** 센다.
 * 시작 기록(예식일 넘김)을 비우는 것도 옛 랜딩 링크와 같다.
 */
export default function TrackedLandingLink({
  href,
  source,
  children,
  variant,
  size,
  weight,
  className,
  prefetch,
}: TrackedLandingLinkProps) {
  // `Button` 의 링크 타입에는 `prefetch` 가 없다. `Button` 은 받은 속성을 `next/link` 에
  // 그대로 넘기므로 여기서 펼쳐 전달한다. 줄 때만 넘겨 기본 동작을 바꾸지 않는다.
  const linkOptions = prefetch === false ? { prefetch } : {};

  return (
    <Button
      href={href}
      variant={variant}
      size={size}
      weight={weight}
      className={className}
      {...linkOptions}
      onClick={() => {
        clearStartHereDateHandoff();
        // 자리 이름만 전달한다. 지연 전송의 출발 화면·시각은 분석 래퍼가 고정한다.
        captureEvent("landing_cta_click", { source });
      }}
    >
      {children}
    </Button>
  );
}
