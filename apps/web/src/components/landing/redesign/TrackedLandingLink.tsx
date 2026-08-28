"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { captureEvent } from "@/lib/analytics";
import { clearStartHereDateHandoff } from "@/lib/marketing/startHereDateHandoff";

/**
 * 클릭이 일어난 자리.
 *
 * **고정 목록이다.** 사용자 입력·화면 문구·URL 조각을 싣지 않는다 — 이 저장소에서
 * 클릭 흔적이 첨부 파일명·게시글 제목·닉네임을 실어 나른 적이 있다.
 */
export type LandingCtaSource =
  | "landing_header"
  | "landing_hero_primary"
  | "landing_hero_secondary"
  | "landing_scenes"
  | "landing_closing_primary"
  | "landing_closing_signup"
  | "landing_closing_login";

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
          // 이름이 도착지를 말해야 한다. 옛 이름 `landing_amora_start_click` 은
          // 도착지가 아모라이던 때 지은 것인데, 지금 1차 CTA 는 `/wedding-code` 로 간다.
          //
          // 도착지가 `wedding_code_started`·`wedding_code_completed` 를 스스로 내므로
          // 여기서는 **어느 자리에서 눌렀는지**만 붙이면 퍼널이 이어진다.
          captureEvent("landing_cta_click", { source });
      }}
    >
      {children}
    </Link>
  );
}
