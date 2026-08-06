"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { captureEvent } from "@/lib/analytics";
import { clearStartHereDateHandoff } from "@/lib/marketing/startHereDateHandoff";

type TrackedLandingLinkProps = Omit<ComponentProps<typeof Link>, "children" | "onClick"> & {
  children: ReactNode;
  // 아모라를 **여는** 링크에만 붙인다. 이 컴포넌트는 landing_amora_start_click을
  // 쏘고 날짜 handoff를 지우므로, 아모라를 열지 않는 링크에 쓰면 둘 다 틀린 동작이 된다.
  source: "landing_header" | "landing_closing" | "landing_available_now";
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
        captureEvent("landing_amora_start_click", { source });
      }}
    >
      {children}
    </Link>
  );
}
