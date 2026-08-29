"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export interface SpotlightStep {
  /** 강조할 요소를 찾을 CSS selector (보통 [data-tutorial-target="..."]) */
  selector: string;
  title: string;
  description: string;
  /** 강조 박스 모서리 둥글기 (px). 기본 12 */
  radius?: number;
  /** 강조 박스 패딩 (px). 기본 8 */
  padding?: number;
}

interface Props {
  steps: SpotlightStep[];
  /** localStorage 키 — 완료 여부 저장 */
  storageKey: string;
  /**
   * 자동 시작 모드:
   *  - "auto": 마운트되자마자 (저장되지 않았다면) 시작
   *  - "event": triggerEvent 가 dispatch 될 때 시작
   *  - "prerequisite": 마운트 시 prerequisiteKey 가 set 되어 있고 storageKey 가 아직 없다면 시작
   */
  mode?: "auto" | "event" | "prerequisite";
  /** mode="event" 일 때 들을 커스텀 이벤트 이름 */
  triggerEvent?: string;
  /** mode="prerequisite" 또는 "event" 일 때 — 선행 조건 localStorage 키 */
  prerequisiteKey?: string;
  /**
   * mode="event"에서 triggerEvent가 **사용자의 명시적 요청**일 때 true.
   *
   * `storageKey`는 "자동으로 다시 뜨지 않게" 하는 장치다. 그런데 event 모드가 같은
   * 검사를 써서, 한 번 본 사람이 "처음이신가요?"를 눌러도 아무 일도 일어나지
   * 않았다(2026-07-25~26 자동 투어를 한 번 닫은 방문자에게는 죽은 버튼이었다).
   * 반대로 선행 가이드 완료 신호로 열리는 투어(ServiceDashboardTutorial 등)는
   * 이미 본 사람에게 다시 뜨면 안 되므로 기본값은 false다.
   */
  replayOnTrigger?: boolean;
  /** 시작 딜레이 (ms). 기본 600 */
  delayMs?: number;
  /**
   * 투어가 끝났을 때 한 번 부른다.
   *
   * 왜 필요한가: 지금까지 "봤다"는 사실은 localStorage에만 남아서, 부르는 쪽이
   * 그 사실을 계정에 적거나 다음 화면(아모라 말풍선)에 넘길 방법이 없었다.
   * `reason`으로 완주와 건너뛰기를 구분해 주지만, **둘 다 끝난 것**이다 —
   * 건너뛴 사람에게 매번 다시 띄우는 건 안내가 아니라 방해다.
   */
  onFinish?: (reason: SpotlightFinishReason) => void;
}

/** 완주("completed")인지 사용자가 도중에 닫았는지("skipped"). 둘 다 "끝났다"이다. */
export type SpotlightFinishReason = "completed" | "skipped";

const TOOLTIP_W = 320;
const VIEWPORT_MARGIN = 16;

export default function SpotlightTutorial({
  steps,
  storageKey,
  mode = "auto",
  triggerEvent,
  prerequisiteKey,
  replayOnTrigger = false,
  delayMs = 600,
  onFinish,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [missing, setMissing] = useState(false);

  // ─── 시작 트리거 ────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    // 선행 조건만 보고 연다. 사용자가 직접 요청한 경우에 쓴다.
    const startNow = () => {
      try {
        if (prerequisiteKey && !localStorage.getItem(prerequisiteKey)) return;
      } catch {
        return;
      }
      window.setTimeout(() => setVisible(true), delayMs);
    };

    // 이미 본 사람에게는 열지 않는다. 자동 시작 경로에 쓴다.
    const tryStart = () => {
      try {
        if (localStorage.getItem(storageKey)) return;
      } catch {
        return;
      }
      startNow();
    };

    if (mode === "auto") {
      tryStart();
      return;
    }

    if (mode === "prerequisite") {
      tryStart();
      return;
    }

    if (mode === "event" && triggerEvent) {
      // 이벤트 모드는 "부를 때만 뜬다"는 뜻이다. 여기서 tryStart()를 먼저 부르면
      // 마운트되자마자 열려 auto와 똑같아진다 — 2026-07-26 랜딩에서 실제로
      // 그렇게 동작해, 첫 화면을 가리지 않으려던 변경이 아무 효과가 없었다.
      // 사용자가 직접 부른 것이면 "이미 봤음"으로 막지 않는다 — 그게 죽은 버튼이었다.
      const handler = () => (replayOnTrigger ? startNow() : tryStart());
      window.addEventListener(triggerEvent, handler);
      return () => window.removeEventListener(triggerEvent, handler);
    }
  }, [mode, triggerEvent, prerequisiteKey, replayOnTrigger, storageKey, delayMs]);

  // ─── 타겟 요소 위치 추적 ────────────────────────────────────
  const currentStep = steps[stepIndex];

  // onFinish는 부르는 쪽에서 매 렌더 새로 만들어지기 쉽다. 그대로 의존성에 넣으면
  // finishInternal이 계속 바뀌면서 키보드·스킵 이펙트가 매번 재구독된다.
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  // 끝난 사실은 한 번만 알린다 — 완료 버튼 뒤에 Escape가 들어와도 두 번 쓰지 않는다.
  const finishNotified = useRef(false);

  const finishInternal = useCallback(
    (reason: SpotlightFinishReason) => {
      try {
        localStorage.setItem(storageKey, "true");
      } catch {
        /* */
      }
      setVisible(false);
      setStepIndex(0);
      if (finishNotified.current) return;
      finishNotified.current = true;
      onFinishRef.current?.(reason);
    },
    [storageKey],
  );

  const updateRect = useCallback(() => {
    if (!currentStep) return;
    const el = document.querySelector(currentStep.selector) as HTMLElement | null;
    if (!el) {
      setMissing(true);
      setTargetRect(null);
      return;
    }
    setMissing(false);
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    // 스크롤 안정화를 위해 다음 프레임에 측정
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      setTargetRect(rect);
    });
  }, [currentStep]);

  useEffect(() => {
    if (!visible) return;
    const initialFrame = window.requestAnimationFrame(() => updateRect());
    const onResize = () => updateRect();
    const onScroll = () => {
      const el = document.querySelector(currentStep?.selector ?? "") as HTMLElement | null;
      if (el) setTargetRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.cancelAnimationFrame(initialFrame);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [visible, stepIndex, updateRect, currentStep]);

  // 누락된 타겟이면 다음 스텝으로 자동 스킵 (조건부 렌더링 컴포넌트 대응)
  useEffect(() => {
    if (!visible || !missing) return;
    const t = window.setTimeout(() => {
      if (stepIndex < steps.length - 1) {
        setStepIndex((i) => i + 1);
      } else {
        // 마지막 앵커가 화면에 없어 건너뛴 경우다. 사용자가 닫은 게 아니라
        // 투어가 끝까지 간 것이므로 완주로 본다.
        finishInternal("completed");
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [finishInternal, missing, stepIndex, steps.length, visible]);

  const next = useCallback(() => {
    if (stepIndex < steps.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      finishInternal("completed");
    }
  }, [stepIndex, steps.length, finishInternal]);

  const prev = useCallback(() => {
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
  }, [stepIndex]);

  // ─── 키보드 ─────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") finishInternal("skipped");
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, finishInternal, next, prev]);

  // ─── 툴팁 위치 계산 ────────────────────────────────────────
  const tooltipPos = useMemo(() => {
    if (!targetRect || typeof window === "undefined") return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 14;
    const tooltipH = 220; // 대략적인 높이 (반응형이라 정확 X)

    const spaceBottom = vh - targetRect.bottom;
    const spaceTop = targetRect.top;
    const spaceRight = vw - targetRect.right;
    const spaceLeft = targetRect.left;

    let top: number;
    let left: number;

    if (spaceBottom >= tooltipH + gap) {
      top = targetRect.bottom + gap;
      left = targetRect.left + targetRect.width / 2 - TOOLTIP_W / 2;
    } else if (spaceTop >= tooltipH + gap) {
      top = targetRect.top - tooltipH - gap;
      left = targetRect.left + targetRect.width / 2 - TOOLTIP_W / 2;
    } else if (spaceRight >= TOOLTIP_W + gap) {
      top = Math.max(VIEWPORT_MARGIN, targetRect.top);
      left = targetRect.right + gap;
    } else if (spaceLeft >= TOOLTIP_W + gap) {
      top = Math.max(VIEWPORT_MARGIN, targetRect.top);
      left = targetRect.left - TOOLTIP_W - gap;
    } else {
      // 화면 중앙 fallback
      top = vh / 2 - tooltipH / 2;
      left = vw / 2 - TOOLTIP_W / 2;
    }

    left = Math.max(VIEWPORT_MARGIN, Math.min(vw - TOOLTIP_W - VIEWPORT_MARGIN, left));
    top = Math.max(VIEWPORT_MARGIN, Math.min(vh - tooltipH - VIEWPORT_MARGIN, top));

    return { top, left };
  }, [targetRect]);

  if (!visible || typeof document === "undefined") return null;
  if (!currentStep) return null;

  const radius = currentStep.radius ?? 12;
  const padding = currentStep.padding ?? 8;
  const isLast = stepIndex === steps.length - 1;
  const isFirst = stepIndex === 0;

  const overlay = (
    <div className="fixed inset-0 z-[60]" aria-modal="true" role="dialog">
      {/* 어둠 + 강조 컷아웃 — box-shadow 트릭 (타겟은 클릭 가능하게 pointer-events:none) */}
      {targetRect ? (
        <div
          className="absolute pointer-events-none transition-all duration-300 ease-out"
          style={{
            top: targetRect.top - padding,
            left: targetRect.left - padding,
            width: targetRect.width + padding * 2,
            height: targetRect.height + padding * 2,
            borderRadius: radius,
            boxShadow: "0 0 0 9999px rgba(15, 14, 14, 0.72)",
            outline: "2px solid rgba(196, 150, 126, 0.65)",
            outlineOffset: 0,
          }}
        />
      ) : (
        <div
          className="absolute inset-0 pointer-events-none bg-black/72"
        />
      )}

      {/* 클릭 차단 레이어 (타겟 영역 제외) — 사용자가 실수로 다른 곳 누르는 것 방지.
          타겟 박스 위는 비워두고 나머지 면적만 덮음. */}
      {targetRect && (
        <>
          <div
            className="absolute"
            style={{
              top: 0,
              left: 0,
              right: 0,
              height: Math.max(0, targetRect.top - padding),
            }}
            onClick={(e) => e.stopPropagation()}
          />
          <div
            className="absolute"
            style={{
              top: targetRect.bottom + padding,
              left: 0,
              right: 0,
              bottom: 0,
            }}
            onClick={(e) => e.stopPropagation()}
          />
          <div
            className="absolute"
            style={{
              top: Math.max(0, targetRect.top - padding),
              left: 0,
              width: Math.max(0, targetRect.left - padding),
              height: targetRect.height + padding * 2,
            }}
            onClick={(e) => e.stopPropagation()}
          />
          <div
            className="absolute"
            style={{
              top: Math.max(0, targetRect.top - padding),
              left: targetRect.right + padding,
              right: 0,
              height: targetRect.height + padding * 2,
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </>
      )}

      {/* 툴팁 */}
      {tooltipPos && (
        <div
          className="absolute rounded-2xl bg-white shadow-2xl transition-all duration-200 ease-out"
          style={{
            top: tooltipPos.top,
            left: tooltipPos.left,
            width: TOOLTIP_W,
          }}
        >
          {/* 진행바 */}
          <div className="h-1 rounded-t-2xl overflow-hidden bg-[#f6f3f2]">
            <div
              className="h-full bg-gradient-to-r from-[#795252] to-[#C9A96E] transition-all duration-300"
              style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
            />
          </div>

          <div className="px-5 pt-3 pb-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--hb-text-muted)]">
                {stepIndex + 1} / {steps.length}
              </span>
              <button
                type="button"
                onClick={() => finishInternal("skipped")}
                className="flex items-center gap-1 text-xs text-[var(--hb-text-muted)] hover:text-[#1b1c1c] transition-colors"
                aria-label="튜토리얼 종료"
              >
                건너뛰기
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <h3 className="font-serif-kr text-lg leading-snug text-[#1b1c1c] mb-1.5">
              {currentStep.title}
            </h3>
            <p className="text-sm leading-relaxed text-[var(--hb-text-body)] mb-4">
              {currentStep.description}
            </p>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={prev}
                disabled={isFirst}
                className="flex items-center gap-1 px-3 py-2 text-sm text-[var(--hb-text-body)] hover:text-[#1b1c1c] disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                이전
              </button>
              <button
                type="button"
                onClick={next}
                className="flex items-center gap-1 px-4 py-2 rounded-lg bg-gradient-to-br from-[#795252] to-[#946a6a] text-white text-sm font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] transition-all"
              >
                {isLast ? "완료" : "다음"}
                {!isLast && <ChevronRight className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(overlay, document.body);
}
