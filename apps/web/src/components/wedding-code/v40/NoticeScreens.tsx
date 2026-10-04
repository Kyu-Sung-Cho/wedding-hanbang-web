"use client";

import { useRef } from "react";
import Button from "@/components/ui/Button";
import { V40_COPY, storageExpiredNote } from "@/lib/weddingCode/v40/copy";
import type { GateReason } from "@/lib/weddingCode/v40/types";
import { screenRootClass } from "./SectionCard";
import { bodyText, cx, noticeBox, noticeText } from "./styles";
import { useScreenFocus } from "./useScreenFocus";

/**
 * 안내 화면 모음: 깨진 링크, 위치 관문(코드를 만들지 못한 결과), 두 사람 결과를 만들 수 없는 경우, 화면 오류 대체 화면,
 * 그리고 여러 화면이 함께 쓰는 저장 문제 안내(StorageNotice).
 *
 * 화면은 데이터와 콜백을 props 로 받을 뿐 저장소, 통계, 주소를 만지지 않는다.
 * 「검증을 마친 심리검사가 아니」라는 고지는 이 화면들에 없다(글자를 보여 주는 화면이 아니라서 시작, 받는 사람, 결과, 두 사람 결과 화면이 맡는다).
 */

/** 저장 상태 표시. saved = 마지막 저장이 성공, off = 자동 저장이 꺼짐, unavailable = 이 브라우저에서 저장 불가, conflict = 다른 창이 바꿔서 이 창의 저장을 멈춤. */
export type SaveState = "saved" | "off" | "unavailable" | "conflict";

/** 저장 문제 안내가 말하는 문제. invalid = 저장된 답을 읽지 못함, invalidClock = 저장 시각이 미래라 읽지 못함, expired = 기간이 지나 지움(이 셋은 시작 화면에서만). */
export type StorageProblem = "unavailable" | "conflict" | "invalid" | "invalidClock" | "expired";

export interface StorageNoticeProps {
  readonly problem: StorageProblem;
  /** conflict 일 때 두 단추. 저장된 답을 불러오면 이 창에서 넘긴 답은 쓰이지 않는다. */
  readonly onLoadSaved?: () => void;
  /** conflict 일 때 이 창의 답으로 다시 저장하면 다른 창이 저장한 답은 사라진다(이 단추를 누르는 것이 그 확인이다). */
  readonly onKeepThis?: () => void;
  readonly className?: string;
  /**
   * false 이면 이 안내 글 자신은 알림 영역(role=status)이 아니다. 부모가 늘 문서에 있는 알림 영역 안에 이 안내를 넣을 때 쓴다:
   * 새로 끼워 넣은 알림 영역은 낭독기가 읽지 못하는 일이 많아서, 저장 상태가 쪽을 넘긴 뒤에 바뀌는 질문 화면은 영역을 미리 두고 그 안의 글만 바꾼다.
   * 창끼리 어긋난 경우(conflict)는 이 값과 상관없이 늘 alert 로 알린다. 기본 true.
   */
  readonly live?: boolean;
}

function storageProblemText(problem: StorageProblem): string {
  switch (problem) {
    case "unavailable":
      return V40_COPY.storageNotice.unavailable;
    case "conflict":
      return V40_COPY.storageNotice.conflict;
    case "invalid":
      return V40_COPY.storageNotice.invalid;
    case "invalidClock":
      return `${V40_COPY.storageNotice.invalid} ${V40_COPY.storageNotice.invalidClockHint}`;
    case "expired":
      return storageExpiredNote();
  }
}

/**
 * 저장이 안 되거나 어긋났다고 알리는 상자. 사실만 말한다(저장됐다고 하지 않는다).
 * 창끼리 어긋난 경우(conflict)는 어느 쪽 답으로 이어 할지 고르는 단추 둘이 붙고, 답이 사라질 수 있는 일이라 바로 읽히게 alert 로 알린다.
 */
export function StorageNotice({ problem, onLoadSaved, onKeepThis, className, live = true }: StorageNoticeProps) {
  const conflict = problem === "conflict";
  return (
    <div data-storage-notice={problem} className={cx(noticeBox, "space-y-3", className)}>
      <p role={conflict ? "alert" : live ? "status" : undefined} className={noticeText}>
        {storageProblemText(problem)}
      </p>
      {conflict && (onLoadSaved || onKeepThis) ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          {onLoadSaved ? (
            <Button variant="secondary" size="md" fullWidth onClick={onLoadSaved} data-storage-action="load-saved">
              {V40_COPY.storageNotice.loadSavedButton}
            </Button>
          ) : null}
          {onKeepThis ? (
            <Button variant="secondary" size="md" fullWidth onClick={onKeepThis} data-storage-action="keep-this">
              {V40_COPY.storageNotice.keepThisButton}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 깨진 링크
// ---------------------------------------------------------------------------

export interface BrokenLinkScreenProps {
  /** 처음부터 시작하기(입구가 주소의 뒷부분을 지운다). */
  readonly onStart: () => void;
  /**
   * 같은 안내(V40_COPY.error.brokenLink.notice)를 이미 화면에 내보냈으면 true. 둘이 같은 말로 시작하므로 제목을 다시 보이지 않고
   * 화면 이름으로만 남긴다. 기본 false.
   */
  readonly noticeShown?: boolean;
  readonly embedded?: boolean;
}

/** 링크를 읽지 못했을 때. 기본값을 채우지 않고 처음부터 시작할 수 있다는 것만 알린다. */
export function BrokenLinkScreen({ onStart, noticeShown = false, embedded = false }: BrokenLinkScreenProps) {
  const copy = V40_COPY.error.brokenLink;
  const rootRef = useRef<HTMLElement | null>(null);
  useScreenFocus(rootRef, "broken-link");
  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-label={noticeShown ? copy.title : undefined}
      aria-labelledby={noticeShown ? undefined : "v40-broken-link-title"}
      data-screen="broken-link"
      className={screenRootClass(embedded)}
    >
      {noticeShown ? null : (
        <h1 id="v40-broken-link-title" className="text-2xl font-semibold leading-snug text-[var(--hb-text-strong)]">
          {copy.title}
        </h1>
      )}
      <p className={cx(bodyText, noticeShown ? "" : "mt-3")}>{copy.body}</p>
      <div className="mt-6">
        <Button variant="primary" size="lg" fullWidth onClick={onStart}>
          {copy.startButton}
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 위치 관문: 코드를 만들지 못한 결과
// ---------------------------------------------------------------------------

export interface PositionGateScreenProps {
  readonly reason: GateReason;
  readonly onRestart: () => void;
  /**
   * 넘어간 질문 다시 보기. 확정한 글자가 하나도 없을 때(noInformation)만 뜻이 있어서 그때만 단추를 그린다.
   * 다시 볼 질문이 없으면 주지 않는다.
   */
  readonly onReviewSkipped?: () => void;
  readonly embedded?: boolean;
}

/**
 * 같은 위치만 눌렀거나(rhythm) 확정 글자가 없어서(noInformation) 코드를 만들지 못한 결과. 글자도 링크도 보여 주지 않는다.
 * 코드가 없으니 고지 문장(검증 아님)은 붙이지 않는다. 결과 화면이 이 화면을 안에 그리면서 고지를 함께 보이고 싶다면 결과 화면 몫이다.
 */
export function PositionGateScreen({ reason, onRestart, onReviewSkipped, embedded = false }: PositionGateScreenProps) {
  const copy = V40_COPY.gate;
  const rootRef = useRef<HTMLElement | null>(null);
  useScreenFocus(rootRef, `gate:${reason}`);
  const canReview = reason === "noInformation" && onReviewSkipped !== undefined;
  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-labelledby="v40-gate-title"
      data-screen="gate"
      data-gate-reason={reason}
      className={screenRootClass(embedded)}
    >
      <h1 id="v40-gate-title" className="text-2xl font-semibold leading-snug text-[var(--hb-text-strong)]">
        {copy.title}
      </h1>
      <p className={cx(bodyText, "mt-3")}>{reason === "rhythm" ? copy.rhythmBody : canReview ? copy.noInformationBody : copy.noInformationBodyRestartOnly}</p>
      <p className={cx(bodyText, "mt-3 text-[var(--hb-text-muted)]")}>{copy.noLinkNote}</p>
      <div className="mt-6 flex flex-col gap-2">
        <Button variant="primary" size="lg" fullWidth onClick={onRestart}>
          {copy.restartButton}
        </Button>
        {canReview ? (
          <Button variant="secondary" size="lg" fullWidth onClick={onReviewSkipped}>
            {copy.reviewSkippedButton}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 두 사람 결과를 만들 수 없을 때
// ---------------------------------------------------------------------------

export interface NoCompareScreenProps {
  readonly onRestart: () => void;
  readonly embedded?: boolean;
}

/**
 * 받은 링크로 열어 내 답을 마쳤지만 내 답에서 글자를 정하지 못해 두 사람 결과를 만들 수 없을 때.
 * 다시 해도 또 못 정할 수 있어서 볼 수 있다고 약속하지 않는다.
 */
export function NoCompareScreen({ onRestart, embedded = false }: NoCompareScreenProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  useScreenFocus(rootRef, "no-compare");
  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-labelledby="v40-no-compare-title"
      data-screen="no-compare"
      className={screenRootClass(embedded)}
    >
      <h1 id="v40-no-compare-title" className="text-2xl font-semibold leading-snug text-[var(--hb-text-strong)]">
        {V40_COPY.receive.noCompareTitle}
      </h1>
      <p className={cx(bodyText, "mt-3")}>{V40_COPY.receive.noCompareNote}</p>
      <div className="mt-6">
        <Button variant="primary" size="lg" fullWidth onClick={onRestart}>
          {V40_COPY.receive.noCompareRestartButton}
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 화면 오류 대체
// ---------------------------------------------------------------------------

export interface BoundaryFallbackScreenProps {
  /** 새로고침(호출하는 쪽이 window.location.reload 를 부른다. 이 화면은 주소를 만지지 않는다). */
  readonly onReload: () => void;
  readonly embedded?: boolean;
}

/** 오류 경계가 그리는 대체 화면. 상대가 보낸 링크로 열었다면 받은 링크를 다시 열어야 한다는 말이 본문에 들어 있다. */
export function BoundaryFallbackScreen({ onReload, embedded = false }: BoundaryFallbackScreenProps) {
  const copy = V40_COPY.error.boundary;
  const rootRef = useRef<HTMLElement | null>(null);
  useScreenFocus(rootRef, "boundary");
  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-labelledby="v40-boundary-title"
      role="alert"
      data-screen="boundary"
      className={screenRootClass(embedded)}
    >
      <h1 id="v40-boundary-title" className="text-2xl font-semibold leading-snug text-[var(--hb-text-strong)]">
        {copy.title}
      </h1>
      <p className={cx(bodyText, "mt-3")}>{copy.body}</p>
      <div className="mt-6">
        <Button variant="primary" size="lg" fullWidth onClick={onReload}>
          {copy.reloadButton}
        </Button>
      </div>
    </section>
  );
}
