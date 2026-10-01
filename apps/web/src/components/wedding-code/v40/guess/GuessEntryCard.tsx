"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import Button from "@/components/ui/Button";
import { V40_GUESS_COPY } from "@/lib/weddingCode/v40/guess/guessCopy";
import { SectionCard } from "../SectionCard";
import { buttonFocusFix, cx, noteText, srOnly } from "../styles";

/**
 * 서로 짐작해 보기 진입 카드(보내는 사람, 결과 화면의 「상대에게 보내기」 위, 빌드 계획 5.5). 선택이고 이 브라우저에 저장하지 않는다.
 *
 * 두 모양이 있다.
 *   idle: 본문(무엇을 하고, 링크에 무엇이 들어가고, 누가 읽을 수 있고, 저장하지 않는다는 것)과 「해 볼게요」, 「지금은 안 할게요」.
 *   done: 끝낸 뒤 상태. 「내 답과 함께 보내기」를 고르면 짐작도 링크에 들어가고 「질문만 보내기」를 고르면 들어가지 않는다고 사실대로 말하고, 「고치기」와 「빼기」.
 * 「빼기」를 누르면 부모가 짐작을 지우고 state 를 idle 로 돌리며 removed 를 켠다. 그러면 「이제부터 만드는 링크에서 짐작을 뺐어요. 이미 보낸 링크는 그대로 남아요.」를
 * 알림 영역에 말하고 초점을 그 줄로 옮긴다(눌렀던 단추가 사라져서 초점이 갈 곳을 잃지 않게). 「지금은 안 할게요」를 누르면 부모에게 알리고 이 카드는 사라진다.
 * 이 카드는 저장소, 주소, 통계를 만지지 않는다.
 */
export interface GuessEntryCardProps {
  readonly state: "idle" | "done";
  /** 방금 짐작을 뺐다. idle 에서 뺐다는 한 줄을 알림 영역에 말한다. */
  readonly removed?: boolean;
  readonly onStart: () => void;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
  readonly onDismiss: () => void;
  readonly headingLevel?: 2 | 3;
}

export function GuessEntryCard({ state, removed = false, onStart, onEdit, onRemove, onDismiss, headingLevel = 2 }: GuessEntryCardProps): ReactElement | null {
  const [dismissed, setDismissed] = useState(false);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const copy = V40_GUESS_COPY.entry;

  // 빼기를 누르면 눌렀던 단추가 사라진다. 뺐다는 줄로 초점을 옮겨 낭독기가 그 줄을 읽게 한다(상태를 바꾸지 않는다).
  useEffect(() => {
    if (removed) statusRef.current?.focus({ preventScroll: true });
  }, [removed]);

  if (dismissed) return null;
  const statusText = state === "idle" && removed ? copy.removedNote : "";

  return (
    <SectionCard title={copy.title} level={headingLevel} dataCard="pair-guess-entry">
      {state === "idle" ? <p>{copy.body}</p> : <p>{copy.doneNote}</p>}
      <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true" data-entry-status="" className={cx(statusText === "" ? srOnly : noteText, "outline-none")}>
        {statusText}
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        {state === "idle" ? (
          <>
            <Button variant="primary" size="md" onClick={onStart} data-entry="start" className={buttonFocusFix}>
              {copy.startButton}
            </Button>
            <Button
              variant="secondary"
              size="md"
              data-entry="dismiss"
              className={buttonFocusFix}
              onClick={() => {
                setDismissed(true);
                onDismiss();
              }}
            >
              {copy.dismissButton}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="md" onClick={onEdit} data-entry="edit" className={buttonFocusFix}>
              {copy.editButton}
            </Button>
            <Button variant="secondary" size="md" onClick={onRemove} data-entry="remove" className={buttonFocusFix}>
              {copy.removeButton}
            </Button>
          </>
        )}
      </div>
    </SectionCard>
  );
}

export default GuessEntryCard;
