"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

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

type TrackedLandingLinkProps = Omit<ComponentProps<typeof Link>, "children" | "onClick"> & {
  children: ReactNode;
  source: LandingCtaSource;
};

export default function TrackedLandingLink({
  children,
  source,
  ...props
}: TrackedLandingLinkProps) {
  return (
    <Link
      {...props}
      onClick={() => {
        clearStartHereDateHandoff();
        // 자리 이름만 전달한다. 지연 전송의 출발 화면·시각은 분석 래퍼가 고정한다.
        captureEvent("landing_cta_click", { source });
      }}
    >
      {children}
    </Link>
  );
}
