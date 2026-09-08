"use client";

import type { AnchorHTMLAttributes, MouseEvent } from "react";

export function followMannersAnchor(event: MouseEvent<HTMLAnchorElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const hash = event.currentTarget.getAttribute("href");
  if (!hash?.startsWith("#")) return;
  const target = document.getElementById(hash.slice(1));
  if (!target) return;
  event.preventDefault();
  if (window.location.hash !== hash) window.history.pushState(null, "", hash);
  // 같은 주소를 다시 눌러도 이동한다. 키보드 초점도 원문의 목적지로 함께 옮긴다.
  if (target instanceof HTMLDetailsElement) target.open = true;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

export default function MannersAnchor(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} onClick={followMannersAnchor} />;
}
