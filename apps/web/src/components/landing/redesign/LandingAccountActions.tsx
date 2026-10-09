"use client";

import Link from "next/link";

import { headerAuth } from "./landingContent";
import { useLandingSession } from "./LandingSession";
import TrackedLandingLink from "./TrackedLandingLink";

type LandingAccountActionsProps = {
  variant: "desktop" | "mobile";
  onNavigate?: () => void;
};

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2";
const mobileLinkClassName = `flex min-h-11 items-center border-t border-[var(--color-paper-divider)] px-4 py-3 text-[14px] font-semibold text-[var(--color-paper-ink-soft)] transition-colors duration-200 hover:bg-[var(--color-paper-sheet)] hover:text-[var(--color-paper-ink)] motion-reduce:transition-none ${focusRing}`;

export default function LandingAccountActions({ variant, onNavigate }: LandingAccountActionsProps) {
  const status = useLandingSession();
  const primaryLabel = status === "signed_in" ? "아모라 이어가기"
    : status === "signed_out" ? headerAuth.signUp.label : "아모라 열기";
  const login = status === "signed_out" ? (
    <Link
      href={headerAuth.logIn.href}
      onClick={onNavigate}
      className={variant === "mobile" ? mobileLinkClassName
        : `hidden min-h-11 items-center px-3 text-[14px] font-medium text-[var(--color-paper-ink-soft)] transition-colors duration-200 hover:text-[var(--color-paper-ink)] motion-reduce:transition-none lg:inline-flex ${focusRing}`}
    >
      {headerAuth.logIn.label}
    </Link>
  ) : null;

  const primary = (
    <TrackedLandingLink
      href={headerAuth.signUp.href}
      prefetch={false}
      source="landing_header"
      onClickCapture={onNavigate}
      className={variant === "mobile" ? mobileLinkClassName
        : `hidden min-h-11 items-center rounded-[8px] bg-[var(--hb-action)] px-[26px] text-[15px] font-semibold text-[var(--color-paper-card)] transition-colors duration-200 hover:bg-[var(--hb-action-hover)] motion-reduce:transition-none sm:inline-flex ${focusRing}`}
    >
      {primaryLabel}
    </TrackedLandingLink>
  );

  return variant === "mobile" ? <>{primary}{login}</> : <>{login}{primary}</>;
}
