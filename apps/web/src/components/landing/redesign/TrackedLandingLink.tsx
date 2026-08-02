"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { captureEvent } from "@/lib/analytics";

type TrackedLandingLinkProps = Omit<ComponentProps<typeof Link>, "children" | "onClick"> & {
  children: ReactNode;
  source: "landing_header" | "landing_closing";
};

export default function TrackedLandingLink({
  children,
  source,
  ...props
}: TrackedLandingLinkProps) {
  return (
    <Link
      {...props}
      onClick={() => captureEvent("landing_amora_start_click", { source })}
    >
      {children}
    </Link>
  );
}
