"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Button from "@/components/ui/Button";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import { buttonFocusFix, cx, noteText } from "./styles";
import { bodyLine, sectionTitle } from "./resultStyles";

export interface ConfirmDialogProps {
  readonly title: string;
  /** 무엇이 지워지고 무엇이 남는지 적은 글. */
  readonly body: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * 지워지는 것을 알리는 확인 창 한 번. 열리면 안전한 쪽(그대로 두기)에 초점이 가고, 탭은 창 안에서만 돌며, 이스케이프와 바깥 누르기는 그대로 두기다.
 * 문서 맨 끝(body)에 그려서 앱 셸의 하단 탭 막대나 부모의 잘림에 가려지지 않는다.
 * 닫은 뒤 초점을 어디로 돌릴지는 부르는 쪽이 정한다.
 */
export function ConfirmDialog({ title, body, confirmLabel, cancelLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const bodyId = `${ids}-body`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // 문서에 건 keydown 이 늘 최신 onCancel 을 부르게 한다(창이 열려 있는 동안 부모가 다시 그려져도 다시 걸지 않는다).
  const cancelHandler = useRef(onCancel);
  useEffect(() => {
    cancelHandler.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    cancelRef.current?.focus();
    // 이스케이프와 탭 가두기는 창 안이 아니라 문서에서 듣는다. 창 안의 글을 눌러 초점이 body 로 빠져도 이스케이프가 통하고,
    // 탭이 뒤에 있는 화면으로 새지 않는다.
    function onDocumentKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelHandler.current();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      // 화면에 그려진 순서(DOM 순서) 그대로의 단추 목록이다.
      const buttons = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled])")];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (!(active instanceof Node) || !dialog.contains(active)) {
        // 초점이 창 밖(body 나 뒤의 화면)에 있으면 안전한 쪽으로 돌려보낸다.
        event.preventDefault();
        (cancelRef.current ?? first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onDocumentKeyDown, true);
    return () => document.removeEventListener("keydown", onDocumentKeyDown, true);
  }, []);

  return createPortal(
    <div
      data-confirm-overlay
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="w-full max-w-sm rounded-xl border border-paper-outline bg-[var(--hb-surface-raised)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-raised)]"
      >
        <h2 id={titleId} className={sectionTitle}>
          {title}
        </h2>
        <p id={bodyId} className={cx(bodyLine, "mt-2")}>
          {body}
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
          <Button ref={confirmRef} variant="secondary" onClick={onConfirm} className={buttonFocusFix}>
            {confirmLabel}
          </Button>
          <Button ref={cancelRef} variant="primary" onClick={onCancel} className={buttonFocusFix}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export interface RestartBlockProps {
  /** 확인 창에서 지우고 다시 하기를 고른 뒤에 한 번 부른다. 답을 지우고 처음으로 돌아가는 일은 부모가 한다. */
  readonly onRestart: () => void;
  /**
   * 확인 창에서 저장 지우기를 고른 뒤에 부른다. 이 기기의 저장(답과 지난번 비교 기록)을 지우고 실제로 지웠는지 돌려준다.
   * true 가 아니면(false, 던짐) 지웠다고 말하지 않고 실패 안내를 보인다.
   */
  readonly onClearStorage: () => boolean | Promise<boolean>;
}

type Dialog = "restart" | "clear";
type ClearState = "idle" | "pending" | "done" | "failed";

/**
 * 처음부터 다시 하기(무엇이 지워지는지 알리는 확인 한 번)와 이 기기의 저장 지우기(같은 확인). 두 단추 모두 누르는 즉시 지우지 않는다.
 * 저장을 지운 결과는 부모가 알려 준 대로만 말한다: 성공이 확인되면 지웠다고, 아니면 브라우저 설정에서 지우라고 안내한다.
 */
export function RestartBlock({ onRestart, onClearStorage }: RestartBlockProps) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [clearState, setClearState] = useState<ClearState>("idle");
  const restartButton = useRef<HTMLButtonElement>(null);
  const clearButton = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 저장 지우기가 끝나면 초점을 지우기 단추로 돌린다. 확인 창이 사라지면서 초점이 body 로 빠지기 때문이다.
  // 결과 문장은 단추 곁 상태 줄이 읽어 주므로 초점은 단추에 두면 된다.
  useEffect(() => {
    if (clearState === "done" || clearState === "failed") clearButton.current?.focus();
  }, [clearState]);

  function cancel() {
    const from = dialog;
    setDialog(null);
    (from === "clear" ? clearButton : restartButton).current?.focus();
  }

  function confirmRestart() {
    setDialog(null);
    onRestart();
  }

  async function confirmClear() {
    setDialog(null);
    setClearState("pending");
    let cleared = false;
    try {
      cleared = (await onClearStorage()) === true;
    } catch {
      cleared = false;
    }
    if (!mounted.current) return;
    // 초점은 다음 그리기가 끝난 뒤 아래 효과가 옮긴다(지금은 단추가 진행 중이라 눌 수 없어서 focus() 가 통하지 않는다).
    setClearState(cleared ? "done" : "failed");
  }

  const clearMessage = clearState === "done" ? V40_COPY.manage.clear.done : clearState === "failed" ? V40_COPY.manage.clear.failed : "";

  return (
    <section data-result-section="manage" className="border-t border-[var(--hb-hairline)] pt-6">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          ref={restartButton}
          variant="secondary"
          aria-haspopup="dialog"
          onClick={() => setDialog("restart")}
          className={buttonFocusFix}
        >
          {V40_COPY.manage.restart.button}
        </Button>
        <Button
          ref={clearButton}
          variant="ghost"
          aria-haspopup="dialog"
          loading={clearState === "pending"}
          onClick={() => {
            setClearState("idle");
            setDialog("clear");
          }}
          className={buttonFocusFix}
        >
          {V40_COPY.manage.clear.button}
        </Button>
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" data-clear-status={clearState} className={cx(noteText, clearMessage !== "" && "mt-3")}>
        {clearMessage}
      </p>
      {dialog === "restart" ? (
        <ConfirmDialog
          title={V40_COPY.manage.restart.confirmTitle}
          body={V40_COPY.manage.restart.confirmBody}
          confirmLabel={V40_COPY.manage.restart.confirmButton}
          cancelLabel={V40_COPY.manage.restart.cancelButton}
          onConfirm={confirmRestart}
          onCancel={cancel}
        />
      ) : null}
      {dialog === "clear" ? (
        <ConfirmDialog
          title={V40_COPY.manage.clear.confirmTitle}
          body={V40_COPY.manage.clear.confirmBody}
          confirmLabel={V40_COPY.manage.clear.confirmButton}
          cancelLabel={V40_COPY.manage.clear.cancelButton}
          onConfirm={() => void confirmClear()}
          onCancel={cancel}
        />
      ) : null}
    </section>
  );
}

export default RestartBlock;
