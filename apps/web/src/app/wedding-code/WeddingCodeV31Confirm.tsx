"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import Button from "@/components/ui/Button";
import { v31Body, v31Title } from "./WeddingCodeV31Inputs";

export type V31ConfirmDialogProps = {
  title: string;
  /** 무엇이 지워지고 무엇이 남는지 적은 글. */
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * 답이 지워지는 단추 앞에 두는 확인 창 한 번(v4 의 RestartBlock 확인 창과 같은 모양, 문구는 v3.1 용으로 따로 쓴다).
 * 열리면 안전한 쪽(그대로 두기)에 초점이 가고, 탭은 창 안에서만 돌며, Esc 와 바깥 누르기는 그대로 두기다.
 * 문서 맨 끝(body)에 그려서 앱 셸의 하단 탭 막대나 부모의 잘림에 가려지지 않는다.
 * 닫은 뒤 초점을 어디로 돌릴지는 부르는 쪽이 정한다. 지우는 일은 onConfirm 뒤에만 일어난다.
 */
export default function V31ConfirmDialog({ title, body, confirmLabel, cancelLabel, onConfirm, onCancel }: V31ConfirmDialogProps) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const bodyId = `${ids}-body`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // 문서에 건 keydown 이 늘 최신 onCancel 을 부르게 한다(창이 열려 있는 동안 부모가 다시 그려져도 다시 걸지 않는다).
  const cancelHandler = useRef(onCancel);
  useEffect(() => { cancelHandler.current = onCancel; }, [onCancel]);

  useEffect(() => {
    cancelRef.current?.focus();
    // Esc 와 탭 가두기는 창 안이 아니라 문서에서 듣는다. 창 안의 글을 눌러 초점이 body 로 빠져도 Esc 가 통하고, 탭이 뒤의 화면으로 새지 않는다.
    function onDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelHandler.current(); return; }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const buttons = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled])")];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (!(active instanceof Node) || !dialog.contains(active)) {
        // 초점이 창 밖에 있으면 안전한 쪽으로 돌려보낸다.
        event.preventDefault();
        (cancelRef.current ?? first).focus();
      } else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onDocumentKeyDown, true);
    return () => document.removeEventListener("keydown", onDocumentKeyDown, true);
  }, []);

  return createPortal(
    <div data-confirm-overlay className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={event => { if (event.target === event.currentTarget) onCancel(); }}>
      <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}
        className="w-full max-w-sm rounded-xl border border-paper-outline bg-[var(--hb-surface-raised)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-raised)]">
        <h2 id={titleId} className={`text-lg ${v31Title}`}>{title}</h2>
        <p id={bodyId} className={`mt-2 ${v31Body}`}>{body}</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
          <Button variant="secondary" onClick={onConfirm} className="whitespace-normal!">{confirmLabel}</Button>
          <Button ref={cancelRef} variant="primary" onClick={onCancel} className="whitespace-normal!">{cancelLabel}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
