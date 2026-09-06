"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type AccessibleModalOptions = {
  open: boolean;
  onClose(): void;
  closeOnEscape?: boolean;
  initialFocusSelector?: string;
  /** 부모 모달이 이미 잠근 스크롤은 부모가 복원한다. */
  respectExistingScrollLock?: boolean;
};

export function useAccessibleModal<T extends HTMLElement = HTMLDivElement>({
  open,
  onClose,
  closeOnEscape = true,
  initialFocusSelector,
  respectExistingScrollLock = false,
}: AccessibleModalOptions): RefObject<T | null> {
  const dialogRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    const ownsScrollLock = !respectExistingScrollLock || previousOverflow !== "hidden";
    if (ownsScrollLock) document.body.style.overflow = "hidden";

    const initialControl = (initialFocusSelector
      ? dialog?.querySelector<HTMLElement>(initialFocusSelector)
      : null)
      ?? dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ?? dialog;
    initialControl?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeOnEscape) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => (
          !element.hasAttribute("disabled")
          && element.getAttribute("aria-hidden") !== "true"
          && !element.closest("[inert]")
        ));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (ownsScrollLock) document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [closeOnEscape, initialFocusSelector, open, respectExistingScrollLock]);

  return dialogRef;
}
