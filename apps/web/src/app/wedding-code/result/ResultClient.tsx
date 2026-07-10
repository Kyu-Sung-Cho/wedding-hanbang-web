"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Copy,
  Heart,
  Loader2,
  Share2,
  X,
} from "lucide-react";
import {
  WEDDING_CODE_V05_PUBLIC_AXES,
  WEDDING_CODE_V05_QUESTIONS,
  WEDDING_CODE_V05_SCORING_VERSION,
  WEDDING_CODE_V05_VERSION,
} from "@/constants/weddingCodeV05";
import { toWeddingCodeV05Answers } from "@/lib/weddingCode/answers";
import {
  parseWeddingCodeCoupleReportPayload,
  type WeddingCodeCoupleReportPayload,
} from "@/lib/weddingCode/coupleReport";
import { buildWeddingCodeV05IndividualReport } from "@/lib/weddingCode/report";
import { scoreWeddingCodeV05 } from "@/lib/weddingCode/score";
import { renderShareCard, downloadCanvasPng, canvasToPngBlob } from "@/lib/weddingCode/shareCard";
import { captureEvent } from "@/lib/analytics";
import { isRecord, isUuid } from "@/utils/requestValidation";
import {
  readWcResultBackup,
  storeWcResultBackup,
  type WcResultBackup,
} from "./resultBackup";

type CoupleReportState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "waiting"; payload: Extract<WeddingCodeCoupleReportPayload, { status: "waiting" }> }
  | { kind: "missing"; messageKo: string }
  | { kind: "incompatible"; payload: Extract<WeddingCodeCoupleReportPayload, { status: "incompatible" }> }
  | { kind: "ready"; payload: Extract<WeddingCodeCoupleReportPayload, { status: "ready" }> }
  | { kind: "error"; messageKo: string };

type InviteState = "idle" | "creating" | "copied" | "copy-error" | "create-error" | "conflict";

const card = "rounded-[18px] border border-[#eadfc9] bg-white/90 shadow-[0_10px_30px_rgba(8,22,38,0.05)]";
const primaryBtn =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#36534E] px-6 text-[14px] font-semibold text-white shadow-[0_12px_26px_rgba(54,83,78,0.2)] transition-colors hover:bg-[#2d4642] disabled:opacity-40";
const ghostBtn =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-[#eadfc9] bg-white px-5 text-[13px] font-semibold text-[#6d625a] transition-colors hover:bg-[#f7f3ec]";

function confidenceLabel(value: string): string {
  switch (value) {
    case "balanced":
      return "균형";
    case "slightly_close":
      return "조금 기울어짐";
    case "close":
      return "뚜렷함";
    default:
      return "응답 부족";
  }
}

function axisSideLabels(axisKey: string): { left: string; right: string } {
  const axis = WEDDING_CODE_V05_PUBLIC_AXES.find((candidate) => candidate.key === axisKey);
  return {
    left: axis?.left.labelKo ?? "왼쪽 기준",
    right: axis?.right.labelKo ?? "오른쪽 기준",
  };
}

export default function WeddingCodeResultClient() {
  const [backup, setBackup] = useState<WcResultBackup | null | "loading">("loading");
  const [savingCard, setSavingCard] = useState(false);
  const [saveOverlay, setSaveOverlay] = useState<{ dataUrl: string; canvas: HTMLCanvasElement } | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [inviteState, setInviteState] = useState<InviteState>("idle");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [coupleReportState, setCoupleReportState] = useState<CoupleReportState>({ kind: "idle" });
  const [coupleReportReloadKey, setCoupleReportReloadKey] = useState(0);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const saveOverlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const data = readWcResultBackup();
    setBackup(data);
    if (data) {
      captureEvent("wc_result_viewed", {
        cached_pairing_status: data.pairingStatus ?? "unknown",
        version: data.version ?? "unknown",
      });
    }
  }, []);

  const sourceVersion =
    !backup || backup === "loading" ? "unknown" : backup.version ?? "unknown";
  const scoringCompatible =
    !!backup && backup !== "loading" && backup.scoringVersion === WEDDING_CODE_V05_SCORING_VERSION;

  const answers = useMemo(() => {
    if (!backup || backup === "loading" || !scoringCompatible) return {};
    return toWeddingCodeV05Answers(backup.answers);
  }, [backup, scoringCompatible]);

  const score = useMemo(() => scoreWeddingCodeV05(answers), [answers]);
  const report = useMemo(() => buildWeddingCodeV05IndividualReport(score), [score]);
  const strongestAxis = useMemo(() => {
    return [...report.axisReports]
      .filter((axis) => axis.leftScore !== null && axis.rightScore !== null)
      .sort((a, b) => Math.abs((b.leftScore ?? 0) - (b.rightScore ?? 0)) - Math.abs((a.leftScore ?? 0) - (a.rightScore ?? 0)))[0] ?? null;
  }, [report.axisReports]);
  const visibleInviteLink = useMemo(() => {
    if (inviteLink) return inviteLink;
    if (!backup || backup === "loading" || !backup.coupleToken || typeof window === "undefined") return null;
    return `${window.location.origin}/wedding-code?ct=${backup.coupleToken}`;
  }, [backup, inviteLink]);
  const activeCoupleToken =
    backup && backup !== "loading" ? backup.coupleToken : null;
  const activeCoupleSourceVersion =
    backup && backup !== "loading" ? backup.version ?? "unknown" : "unknown";
  const activePairingUnavailable =
    !!backup && backup !== "loading" && backup.pairingUnavailable === true;

  useEffect(() => {
    if (!activeCoupleToken) {
      setCoupleReportState({ kind: "idle" });
      return;
    }
    if (activePairingUnavailable) {
      setCoupleReportState({
        kind: "missing",
        messageKo: "저장된 초대 응답을 찾지 못했어요.",
      });
      return;
    }

    const coupleToken = activeCoupleToken;
    let cancelled = false;
    async function loadCoupleReport() {
      setCoupleReportState({ kind: "loading" });
      try {
        const res = await fetch(`/api/wedding-code/couple-report?ct=${encodeURIComponent(coupleToken)}`);
        const rawPayload: unknown = await res.json().catch(() => null);
        const payload = parseWeddingCodeCoupleReportPayload(rawPayload);
        if (cancelled) return;
        if (!res.ok || !payload) {
          const messageKo =
            isRecord(rawPayload) && typeof rawPayload.error === "string"
              ? rawPayload.error
              : null;
          setCoupleReportState({ kind: "error", messageKo: messageKo ?? "비교 리포트를 불러오지 못했어요." });
          return;
        }
        if (payload.status === "ready") {
          setCoupleReportState({ kind: "ready", payload });
          setBackup((current) => {
            if (
              !current ||
              current === "loading" ||
              current.coupleToken !== coupleToken ||
              (current.paired && current.pairingStatus === "paired" && !current.pairingUnavailable)
            ) {
              return current;
            }
            const pairedBackup: WcResultBackup = {
              ...current,
              paired: true,
              pairingStatus: "paired",
            };
            storeWcResultBackup(pairedBackup);
            return pairedBackup;
          });
          captureEvent("wc_couple_report_viewed", { version: activeCoupleSourceVersion });
        } else if (payload.status === "waiting") {
          if (payload.responseCount === 0) {
            setCoupleReportState({
              kind: "missing",
              messageKo: "저장된 초대 응답을 찾지 못했어요.",
            });
            setBackup((current) => {
              if (!current || current === "loading" || current.coupleToken !== coupleToken) {
                return current;
              }
              const unavailableBackup: WcResultBackup = {
                ...current,
                pairingUnavailable: true,
              };
              storeWcResultBackup(unavailableBackup);
              return unavailableBackup;
            });
          } else {
            setCoupleReportState({ kind: "waiting", payload });
          }
        } else {
          setCoupleReportState({ kind: "incompatible", payload });
        }
      } catch {
        if (!cancelled) setCoupleReportState({ kind: "error", messageKo: "네트워크 오류로 비교 리포트를 불러오지 못했어요." });
      }
    }

    loadCoupleReport();
    return () => {
      cancelled = true;
    };
  }, [activeCoupleToken, activeCoupleSourceVersion, activePairingUnavailable, coupleReportReloadKey]);

  useEffect(() => {
    if (!saveOverlay) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const saveButton = saveButtonRef.current;
    const overlay = saveOverlayRef.current;
    const focusableSelector =
      "button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])";
    const focusables = () => Array.from(overlay?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    const firstFocusable = focusables()[0];
    firstFocusable?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSaveOverlay(null);
        return;
      }
      if (event.key !== "Tab") return;

      const elements = focusables();
      if (elements.length === 0) {
        event.preventDefault();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
      else saveButton?.focus();
    };
  }, [saveOverlay]);

  async function saveResultCard() {
    setSavingCard(true);
    setSaveFeedback(null);
    try {
      const canvas = await renderShareCard({
        scenario: "나의 웨딩코드",
        quote: strongestAxis?.summaryKo ?? report.subtitleKo,
        factText: report.disclaimerKo,
        factSource: null,
        factLabel: "읽는 방법",
        brand: "웨딩코드 · hanbang.ai",
      });

      const blob = await canvasToPngBlob(canvas);
      if (blob && typeof navigator.canShare === "function") {
        const file = new File([blob], "weddingcode-result.png", { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file] });
            captureEvent("wc_result_card_saved", { method: "share", version: sourceVersion });
            return;
          } catch (err) {
            if (err instanceof Error && err.name === "AbortError") return;
          }
        }
      }

      const dataUrl = canvas.toDataURL("image/png");
      setSaveOverlay({ dataUrl, canvas });
      captureEvent("wc_result_card_saved", { method: "longpress_shown", version: sourceVersion });
    } catch {
      setSaveFeedback("결과 카드를 만들지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setSavingCard(false);
    }
  }

  function downloadFromOverlay() {
    if (!saveOverlay) return;
    downloadCanvasPng(saveOverlay.canvas, "weddingcode-result.png");
    captureEvent("wc_result_card_saved", { method: "download", version: sourceVersion });
  }

  async function createInvite() {
    if (
      !backup ||
      backup === "loading" ||
      !backup.responseId ||
      backup.pairingUnavailable ||
      inviteState === "creating" ||
      inviteState === "conflict"
    ) return;
    let token = backup.coupleToken ?? backup.pendingCoupleToken ?? null;
    setInviteState("creating");
    setInviteError(null);
    try {
      if (!backup.coupleToken) {
        if (!token) token = crypto.randomUUID();
        const pendingBackup = { ...backup, pendingCoupleToken: token };
        setBackup(pendingBackup);
        storeWcResultBackup(pendingBackup);

        const res = await fetch("/api/wedding-code/pair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response_id: backup.responseId, couple_token: token }),
        });
        const payload = (await res.json().catch(() => null)) as {
          success?: boolean;
          error?: string;
          pairingStatus?: string;
          coupleToken?: string;
        } | null;
        if (!res.ok) {
          if (payload?.pairingStatus === "conflict") {
            const unavailableBackup: WcResultBackup = {
              ...pendingBackup,
              pendingCoupleToken: null,
              pairingUnavailable: true,
            };
            setBackup(unavailableBackup);
            storeWcResultBackup(unavailableBackup);
            setInviteError(payload.error ?? "이 응답으로는 초대 링크를 만들 수 없어요.");
            setInviteState("conflict");
            return;
          }
          if (payload?.pairingStatus === "full") {
            const clearedBackup = { ...pendingBackup, pendingCoupleToken: null };
            setBackup(clearedBackup);
            storeWcResultBackup(clearedBackup);
          }
          setInviteError(payload?.error ?? "링크 생성에 실패했어요. 잠시 후 다시 시도해주세요.");
          setInviteState("create-error");
          return;
        }
        if (payload?.success !== true) {
          setInviteError("연결 결과를 확인하지 못했어요. 같은 버튼으로 다시 확인해주세요.");
          setInviteState("create-error");
          return;
        }
        const confirmedPairingStatus = payload.pairingStatus;
        if (
          (confirmedPairingStatus !== "waiting" && confirmedPairingStatus !== "paired") ||
          !isUuid(payload.coupleToken)
        ) {
          setInviteError("연결 결과를 확인하지 못했어요. 같은 버튼으로 다시 확인해주세요.");
          setInviteState("create-error");
          return;
        }
        // The DB may return an already-established token when another tab won
        // the race. Always adopt that canonical capability.
        token = payload.coupleToken;
        const next: WcResultBackup = {
          ...pendingBackup,
          coupleToken: payload.coupleToken,
          pendingCoupleToken: null,
          pairingStatus: confirmedPairingStatus,
          paired: confirmedPairingStatus === "paired",
          pairingUnavailable: false,
        };
        setBackup(next);
        storeWcResultBackup(next);
        captureEvent("wc_invite_link_created", { version: sourceVersion });
      }
      const link = `${window.location.origin}/wedding-code?ct=${token}`;
      setInviteLink(link);
      try {
        await navigator.clipboard.writeText(link);
        setInviteState("copied");
      } catch {
        setInviteState("copy-error");
      }
    } catch {
      setInviteError("네트워크 연결을 확인한 뒤 같은 버튼을 다시 눌러주세요.");
      setInviteState("create-error");
    }
  }

  if (backup === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbf8f2]" role="status" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin text-[#7b5528]" aria-hidden="true" />
        <span className="sr-only">웨딩코드 결과를 불러오는 중이에요.</span>
      </div>
    );
  }

  if (backup && backup.scoringVersion !== WEDDING_CODE_V05_SCORING_VERSION) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbf8f2] px-4">
        <div className={`${card} max-w-[420px] p-8 text-center`} role="status">
          <p className="text-[20px] font-semibold text-[#263832]">결과 계산 기준이 업데이트됐어요</p>
          <p className="mt-2 text-[13px] font-medium leading-relaxed text-[#5d6879]">
            예전 답변을 새 계산 기준으로 조용히 바꾸지 않기 위해 이 결과는 다시 계산하지 않아요. 최신 테스트를 완료해주세요.
          </p>
          <Link href="/wedding-code" className={`${primaryBtn} mt-5 w-full`}>
            최신 테스트 다시 하기 <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  if (!backup || score.answeredCount === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbf8f2] px-4">
        <div className={`${card} max-w-[420px] p-8 text-center`}>
          <p className="text-[20px] font-semibold text-[#263832]">결과를 불러올 응답이 없어요</p>
          <p className="mt-2 text-[13px] font-medium leading-relaxed text-[#5d6879]">
            v0.5 테스트를 먼저 완료하면 이 화면에서 결혼 준비 방식을 정리해볼 수 있어요.
          </p>
          <Link href="/wedding-code" className={`${primaryBtn} mt-5 w-full`}>
            테스트 하러 가기 <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  const inviteUnavailable = backup.pairingUnavailable || inviteState === "conflict";

  return (
    <div className="min-h-screen bg-[#fbf8f2] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-[620px]">
        <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b5528]">
          WEDDINGCODE V0.5
        </p>
        <h1 className="text-center text-[27px] font-semibold leading-[1.3] text-[#263832] sm:text-[31px]">
          {report.titleKo}
        </h1>
        <p className="mt-2 text-center text-[13px] font-medium leading-relaxed text-[#5d6879]">
          {report.subtitleKo}
        </p>
        {backup.storageFallback && (
          <div className="mt-4 rounded-[14px] border border-[#d9c7a9] bg-[#fffdf7] px-4 py-3 text-center" role="status">
            <p className="text-[12px] font-semibold leading-relaxed text-[#6d625a]">
              브라우저의 영구 저장 공간을 사용할 수 없어 이 결과를 임시로 열었어요.
              {backup.storageFallback === "memory"
                ? " 새로고침하기 전에 필요한 내용을 저장해주세요."
                : " 이 탭을 닫기 전에 필요한 내용을 저장해주세요."}
            </p>
          </div>
        )}
        {backup.recoveredPriorSubmission && (
          <div className="mt-4 rounded-[14px] border border-[#d9c7a9] bg-[#fffdf7] px-4 py-3 text-center" role="status">
            <p className="text-[12px] font-semibold leading-relaxed text-[#6d625a]">
              이전 제출 시도에서 서버에 먼저 저장된 응답을 복구했어요. 오류 뒤에 답을 수정했다면 방금 수정한 내용보다 먼저 저장된 답변이 이 결과에 표시돼요.
            </p>
          </div>
        )}
        {backup.pairingStatus === "full" && (
          <div className="mt-4 rounded-[14px] border border-[#d9c7a9] bg-[#fffdf7] px-4 py-3 text-center" role="status">
            <p className="text-[13px] font-semibold text-[#263832]">이 초대 링크는 이미 두 사람이 완료했어요.</p>
            <p className="mt-1 text-[12px] font-medium leading-relaxed text-[#6d625a]">
              이번 응답은 내 결과로 저장됐지만 기존 커플 비교에는 연결되지 않았어요. 아래에서 새 초대 링크를 만들어 비교를 시작할 수 있어요.
            </p>
          </div>
        )}

        <section className={`${card} mt-7 overflow-hidden`}>
          <div className="flex items-start justify-between gap-4 p-5 sm:p-6">
            <div>
              <p className="text-[12px] font-semibold tracking-wide text-[#7b5528]">결과 요약</p>
              <p className="mt-2 text-[17px] font-semibold leading-relaxed text-[#263832]">
                {strongestAxis?.summaryKo ?? report.subtitleKo}
              </p>
              <p className="mt-2 text-[13px] font-medium leading-relaxed text-[#5d6879]">
                점수로 판정하지 않고, 결혼 준비 대화에 바로 쓸 수 있는 기준만 정리했어요.
              </p>
            </div>
            <button
              ref={saveButtonRef}
              onClick={saveResultCard}
              disabled={savingCard}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#eadfc9] bg-white text-[#36534E] disabled:opacity-50"
              aria-label="결과 카드 저장·공유"
              aria-describedby={saveFeedback ? "wc-save-feedback" : undefined}
              title="결과 카드 저장·공유"
            >
              {savingCard ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
            </button>
          </div>
          {saveFeedback && (
            <p id="wc-save-feedback" className="mx-5 mb-4 text-[12px] font-semibold text-red-600 sm:mx-6" role="alert">
              {saveFeedback}
            </p>
          )}
          <div className="grid grid-cols-3 divide-x divide-[#eadfc9] border-t border-[#eadfc9] bg-[#fffdf7]">
            <SummaryMetric label="응답" value={`${score.answeredCount}개`} />
            <SummaryMetric label="핵심 축" value={strongestAxis?.labelKo ?? "균형"} />
            <SummaryMetric label="용도" value="대화 기준" />
          </div>
        </section>

        {backup.coupleToken && (
          <CoupleReportSection
            state={coupleReportState}
            onRefresh={() => setCoupleReportReloadKey((value) => value + 1)}
          />
        )}

        <section className="mt-5 flex flex-col gap-3">
          {report.axisReports.map((axis) => (
            <article key={axis.key} className={`${card} p-5 sm:p-6`}>
              {(() => {
                const labels = axisSideLabels(axis.key);
                return (
                  <>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[16px] font-semibold text-[#263832]">{axis.labelKo}</h2>
                <span className="rounded-full bg-[#EEF4F1] px-3 py-1 text-[11px] font-semibold text-[#36534E]">
                  {confidenceLabel(axis.confidenceBand)}
                </span>
              </div>
              <p className="mt-2 text-[14px] font-medium leading-[1.75] text-[#34445a]">{axis.summaryKo}</p>
              <AxisDirectionSummary
                leftLabel={labels.left}
                rightLabel={labels.right}
                leftValue={axis.leftScore}
                rightValue={axis.rightScore}
                confidenceBand={axis.confidenceBand}
              />
                  </>
                );
              })()}
            </article>
          ))}
        </section>

        <section className={`${card} mt-5 p-5 sm:p-6`}>
          <p className="text-[12px] font-semibold tracking-wide text-[#7b5528]">오늘 대화해볼 것</p>
          <div className="mt-3 flex flex-col gap-2.5">
            {report.talkStarters.map((text) => (
              <p key={text} className="rounded-[12px] bg-[#fffdf7] px-4 py-3 text-[13px] font-medium leading-relaxed text-[#263832]">
                {text}
              </p>
            ))}
          </div>
        </section>

        <section className={`${card} mt-5 p-5 sm:p-6`}>
          <p className="text-[12px] font-semibold tracking-wide text-[#7b5528]">다음 행동 카드</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {report.actionCards.map((action) => (
              <div key={action.id} className="rounded-[14px] border border-[#eadfc9] bg-[#fffdf7] p-4">
                <p className="text-[14px] font-semibold text-[#263832]">{action.titleKo}</p>
                <p className="mt-1.5 text-[13px] font-medium leading-relaxed text-[#5d6879]">{action.bodyKo}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-7 flex flex-col gap-2.5">
          {backup.responseId &&
            coupleReportState.kind !== "ready" &&
            coupleReportState.kind !== "incompatible" &&
            coupleReportState.kind !== "missing" && (
            <div className={`${card} p-5`}>
              <button
                onClick={createInvite}
                disabled={inviteState === "creating" || inviteUnavailable}
                className={`${primaryBtn} w-full`}
              >
                {inviteState === "creating" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className="h-4 w-4" />}
                {inviteUnavailable
                  ? "초대 링크를 만들 수 없어요"
                  : inviteState === "creating"
                  ? "초대 링크 준비 중..."
                  : backup.coupleToken
                    ? "초대 링크 다시 복사하기"
                    : "상대에게 보내고 비교 준비하기"}
              </button>
              {inviteUnavailable ? (
                <div className="mt-3 text-center">
                  <p className="text-[12px] font-semibold leading-relaxed text-[#7d4540]" role="alert">
                    {inviteError ?? "저장된 응답을 찾지 못해 이 결과에서는 초대 링크를 만들 수 없어요."}
                  </p>
                  <p className="mt-1.5 text-[12px] font-medium leading-relaxed text-[#6d625a]">
                    같은 버튼을 반복해도 해결되지 않아요. 최신 테스트로 새 비교를 시작해주세요.
                  </p>
                  <Link href="/wedding-code" className={`${ghostBtn} mt-3 w-full`}>
                    최신 테스트 다시 하기 <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              ) : (
                <p className="mt-2 text-center text-[12px] font-medium text-[#6d625a]">
                  상대가 같은 테스트를 완료하면 두 사람의 준비 방식 겹침도를 만들 수 있어요.
                </p>
              )}
              {!inviteUnavailable && visibleInviteLink && (
                <div className="mt-3 flex items-center gap-2 rounded-[12px] border border-[#eadfc9] bg-[#fffdf7] px-3 py-2.5">
                  <input
                    readOnly
                    value={visibleInviteLink}
                    onFocus={(event) => event.currentTarget.select()}
                    aria-label="상대에게 보낼 웨딩코드 초대 링크"
                    className="min-w-0 flex-1 bg-transparent text-[12px] font-medium text-[#34445a] outline-none"
                  />
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(visibleInviteLink);
                        setInviteState("copied");
                      } catch {
                        setInviteState("copy-error");
                      }
                    }}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#36534E]"
                    aria-label="링크 복사"
                  >
                    {inviteState === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              )}
              {!inviteUnavailable && inviteState === "copied" && (
                <p className="mt-1.5 text-center text-[12px] font-semibold text-[#36534E]" role="status" aria-live="polite">
                  링크를 복사했어요. 카톡으로 보내보세요.
                </p>
              )}
              {!inviteUnavailable && inviteState === "copy-error" && (
                <p className="mt-1.5 text-center text-[12px] font-semibold text-[#8F6662]" role="status" aria-live="polite">
                  자동으로 복사하지 못했어요. 위 링크를 눌러 직접 복사해주세요.
                </p>
              )}
              {!inviteUnavailable && inviteState === "create-error" && (
                <p className="mt-1.5 text-center text-[12px] font-semibold text-red-600" role="alert">
                  {inviteError ?? "링크 생성에 실패했어요. 잠시 후 버튼을 다시 눌러주세요."}
                </p>
              )}
            </div>
          )}
          <Link
            href="/check"
            onClick={() => captureEvent("wedding_code_to_quote_check", { version: sourceVersion })}
            className={`${ghostBtn} w-full`}
          >
            <ClipboardCheck className="h-4 w-4" />
            내 비용표 체크하러 가기
          </Link>
        </div>

        {backup.version === WEDDING_CODE_V05_VERSION ? (
          <div className={`${card} mt-7 overflow-hidden`}>
            <button
              onClick={() => setAllOpen(!allOpen)}
              className="flex w-full items-center justify-between px-6 py-4 text-left"
              aria-expanded={allOpen}
              aria-controls="wc-all-answers"
            >
              <span className="text-[14px] font-semibold text-[#263832]">내 선택 전부 보기</span>
              {allOpen ? <ChevronUp className="h-4 w-4 text-[#6d625a]" /> : <ChevronDown className="h-4 w-4 text-[#6d625a]" />}
            </button>
            {allOpen && (
              <div id="wc-all-answers" className="divide-y divide-[#f0e9db] border-t border-[#eadfc9]">
                {WEDDING_CODE_V05_QUESTIONS.map((question) => {
                  const answer = answers[question.key];
                  const option = question.options.find((candidate) => candidate.value === answer);
                  return (
                    <div key={question.key} className="px-6 py-3.5">
                      <p className="text-[11px] font-semibold text-[#7b5528]">{question.title}</p>
                      <p className="mt-1 text-[13px] font-medium leading-relaxed text-[#34445a]">
                        {option ? option.label : <span className="text-[#6d625a]">응답 없음</span>}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className={`${card} mt-7 p-5 text-center`} role="note">
            <p className="text-[14px] font-semibold text-[#263832]">당시 선택 문장은 다시 표시하지 않아요</p>
            <p className="mt-1.5 text-[12px] font-medium leading-relaxed text-[#6d625a]">
              질문 문구가 업데이트되어, 예전 선택값을 지금 문장으로 잘못 바꿔 보여주지 않도록 숨겼어요.
            </p>
          </div>
        )}

        <p className="mt-5 text-center text-[11px] font-medium leading-relaxed text-[#6d625a]">
          {report.disclaimerKo}
        </p>
      </div>

      {saveOverlay && (
        <div
          ref={saveOverlayRef}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-[#1a1a1f]/92 px-6 py-8 [@media(max-height:600px)]:justify-start"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wc-save-dialog-title"
          aria-describedby="wc-save-dialog-description"
        >
          <h2 id="wc-save-dialog-title" className="sr-only">웨딩코드 결과 카드 저장</h2>
          <button
            onClick={() => setSaveOverlay(null)}
            aria-label="닫기"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL은 next/image 불가 */}
          <img
            src={saveOverlay.dataUrl}
            alt="웨딩코드 결과 카드"
            className="max-h-[70vh] w-auto rounded-[12px] shadow-2xl"
          />
          <p id="wc-save-dialog-description" className="mt-4 text-center text-[14px] font-semibold leading-relaxed text-white">
            이미지를 길게 눌러 사진 앱에 저장하세요.
          </p>
          <button
            onClick={downloadFromOverlay}
            className="mt-3 inline-flex min-h-11 items-center text-[12px] font-medium text-white/80 underline underline-offset-2"
          >
            또는 파일로 저장
          </button>
        </div>
      )}
    </div>
  );
}

function AxisDirectionSummary({
  leftLabel,
  rightLabel,
  leftValue,
  rightValue,
  confidenceBand,
}: {
  leftLabel: string;
  rightLabel: string;
  leftValue: number | null;
  rightValue: number | null;
  confidenceBand: string;
}) {
  let directionKo = "이 축은 답변이 조금 더 필요해요";
  if (leftValue !== null && rightValue !== null) {
    if (confidenceBand === "balanced") directionKo = "두 기준을 함께 보는 편이에요";
    else {
      const closerLabel = leftValue >= rightValue ? leftLabel : rightLabel;
      directionKo = confidenceBand === "slightly_close"
        ? `${closerLabel} 쪽에 조금 더 가까워요`
        : `${closerLabel} 쪽이 비교적 뚜렷해요`;
    }
  }

  return (
    <div className="mt-4 rounded-[12px] bg-[#fffdf7] px-4 py-3">
      <div className="flex items-start justify-between gap-4 text-[11px] font-semibold text-[#6d625a]">
        <span>{leftLabel}</span>
        <span className="text-right">{rightLabel}</span>
      </div>
      <p className="mt-2 text-center text-[12px] font-semibold text-[#36534E]">{directionKo}</p>
    </div>
  );
}

function CoupleReportSection({
  state,
  onRefresh,
}: {
  state: CoupleReportState;
  onRefresh: () => void;
}) {
  if (state.kind === "loading") {
    return (
      <section className={`${card} mt-5 p-5 sm:p-6`} role="status" aria-live="polite">
        <div className="flex items-center gap-2.5">
          <Loader2 className="h-4 w-4 animate-spin text-[#36534E]" aria-hidden="true" />
          <p className="text-[14px] font-semibold text-[#263832]">두 사람의 준비 방식 겹침도를 불러오는 중이에요.</p>
        </div>
      </section>
    );
  }

  if (state.kind === "waiting" || state.kind === "idle") {
    return (
      <section className={`${card} mt-5 p-5 sm:p-6`} role="status" aria-live="polite">
        <p className="text-[12px] font-semibold tracking-wide text-[#7b5528]">커플 비교</p>
        <p className="mt-2 text-[17px] font-semibold text-[#263832]">
          {state.kind === "waiting" ? state.payload.messageKo : "아직 상대 응답을 기다리고 있어요."}
        </p>
        <p className="mt-1.5 text-[13px] font-medium leading-relaxed text-[#5d6879]">
          상대가 같은 링크로 테스트를 마치면, 이 화면에서 쉽게 이야기할 부분과 먼저 맞출 부분을 볼 수 있어요.
        </p>
        <button onClick={onRefresh} className={`${ghostBtn} mt-4`}>
          상태 다시 확인
        </button>
      </section>
    );
  }

  if (state.kind === "missing") {
    return (
      <section className={`${card} mt-5 p-5 sm:p-6`} role="alert" aria-live="assertive">
        <p className="text-[12px] font-semibold tracking-wide text-[#7b5528]">커플 비교</p>
        <p className="mt-2 text-[17px] font-semibold text-[#263832]">{state.messageKo}</p>
        <p className="mt-1.5 text-[13px] font-medium leading-relaxed text-[#5d6879]">
          이 링크를 다시 보내도 비교가 완성되지 않아요. 최신 테스트로 새 초대를 시작해주세요.
        </p>
        <Link href="/wedding-code" className={`${ghostBtn} mt-4`}>
          최신 테스트 다시 하기 <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>
    );
  }

  if (state.kind === "incompatible") {
    return (
      <section
        className={`${card} mt-5 p-5 sm:p-6`}
        role="status"
        aria-live="polite"
      >
        <p className="text-[12px] font-semibold tracking-wide text-[#7b5528]">커플 비교</p>
        <p className="mt-2 text-[17px] font-semibold text-[#263832]">{state.payload.messageKo}</p>
        <p className="mt-1.5 text-[13px] font-medium leading-relaxed text-[#5d6879]">
          이 연결에는 두 응답이 이미 고정되어 있어 같은 링크를 다시 보내도 해결되지 않아요. 최신 테스트로 새 비교를 시작해주세요.
        </p>
        <Link href="/wedding-code" className={`${ghostBtn} mt-4`}>
          최신 테스트 다시 하기 <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className={`${card} mt-5 p-5 sm:p-6`} role="alert" aria-live="assertive">
        <p className="text-[12px] font-semibold tracking-wide text-[#7b5528]">커플 비교</p>
        <p className="mt-2 text-[17px] font-semibold text-[#263832]">{state.messageKo}</p>
        <p className="mt-1.5 text-[13px] font-medium leading-relaxed text-[#5d6879]">
          네트워크나 서버의 일시적인 문제일 수 있어요. 잠시 후 다시 확인해주세요.
        </p>
        <button onClick={onRefresh} className={`${ghostBtn} mt-4`}>다시 불러오기</button>
      </section>
    );
  }

  const { report } = state.payload;

  return (
    <section className={`${card} mt-5 p-5 sm:p-6`}>
      <p className="text-[12px] font-semibold tracking-wide text-[#7b5528]">커플 비교</p>
      <div className="mt-2">
        <h2 className="text-[20px] font-semibold leading-[1.35] text-[#263832]">{report.titleKo}</h2>
        <p className="mt-1.5 text-[13px] font-semibold leading-relaxed text-[#36534E]">
          {report.overlapLabelKo}
        </p>
      </div>

      <div className="mt-5 grid gap-3">
        {report.easyPoints.map((axis) => (
          <CoupleAxisRow key={axis.key} label="대화가 쉬운 지점" axis={axis} />
        ))}
        {report.talkFirst && (
          <CoupleAxisRow label="먼저 맞출 부분" axis={report.talkFirst} emphasis />
        )}
      </div>

      <p className="mt-4 rounded-[12px] bg-[#fffdf7] px-4 py-3 text-[13px] font-medium leading-relaxed text-[#34445a]">
        {report.guideKo}
      </p>

      {report.scenarioCards.length > 0 && (
        <div className="mt-5 border-t border-[#eadfc9] pt-5">
          <p className="text-[12px] font-semibold tracking-wide text-[#7b5528]">실제 장면별 솔루션</p>
          <div className="mt-3 grid gap-4">
            {report.scenarioCards.map((card) => (
              <CoupleScenarioCard key={card.id} card={card} />
            ))}
          </div>
        </div>
      )}

      {report.solutionCards.length > 0 && (
        <div className="mt-5 border-t border-[#eadfc9] pt-5">
          <p className="text-[12px] font-semibold tracking-wide text-[#7b5528]">축별 맞춰볼 방법</p>
          <div className="mt-3 grid gap-3">
            {report.solutionCards.map((card) => (
              <CoupleSolutionCard key={card.id} card={card} />
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] font-medium leading-relaxed text-[#6d625a]">
        {report.disclaimerKo}
      </p>
    </section>
  );
}

function CoupleScenarioCard({
  card,
}: {
  card: Extract<WeddingCodeCoupleReportPayload, { status: "ready" }>["report"]["scenarioCards"][number];
}) {
  const sameChoice = card.relation === "same";

  return (
    <div className="border-t border-[#eadfc9] pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-[#7b5528]">{card.categoryKo}</p>
          <p className="mt-1 text-[15px] font-semibold leading-snug text-[#263832]">{card.titleKo}</p>
        </div>
        <p className="shrink-0 rounded-full bg-[#EEF4F1] px-2.5 py-1 text-[11px] font-semibold text-[#36534E]">
          {sameChoice ? "같은 초점" : "서로 다른 초점"}
        </p>
      </div>

      <div className="mt-3 grid gap-2">
        <div className="rounded-[12px] border border-[#eadfc9] bg-[#fffdf7] px-3 py-2.5">
          <p className="text-[11px] font-semibold text-[#8F6662]">
            {sameChoice ? "두 사람 모두 중요하게 본 것" : "한 사람이 더 중요하게 본 것"}
          </p>
          <p className="mt-1 text-[12px] font-medium leading-relaxed text-[#34445a]">{card.firstChoiceKo}</p>
        </div>
        {!sameChoice && (
          <div className="rounded-[12px] border border-[#eadfc9] bg-[#fffdf7] px-3 py-2.5">
            <p className="text-[11px] font-semibold text-[#8F6662]">다른 사람이 더 중요하게 본 것</p>
            <p className="mt-1 text-[12px] font-medium leading-relaxed text-[#34445a]">{card.secondChoiceKo}</p>
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-2.5">
        <div>
          <p className="text-[11px] font-semibold text-[#8F6662]">조심할 지점</p>
          <p className="mt-1 text-[13px] font-medium leading-relaxed text-[#5d6879]">{card.attentionKo}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-[#36534E]">해결 방법</p>
          <p className="mt-1 text-[13px] font-medium leading-relaxed text-[#34445a]">{card.solutionKo}</p>
        </div>
        <p className="rounded-[10px] bg-white px-3 py-2.5 text-[12px] font-semibold leading-relaxed text-[#263832]">
          {card.firstQuestionKo}
        </p>
      </div>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-4 py-3.5 text-center">
      <p className="text-[11px] font-semibold text-[#7b5528]">{label}</p>
      <p className="mt-1 truncate text-[13px] font-semibold text-[#263832]">{value}</p>
    </div>
  );
}

function CoupleSolutionCard({
  card,
}: {
  card: Extract<WeddingCodeCoupleReportPayload, { status: "ready" }>["report"]["solutionCards"][number];
}) {
  return (
    <div className="rounded-[14px] border border-[#eadfc9] bg-[#fffdf7] px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-[#7b5528]">{card.categoryKo}</p>
          <p className="mt-1 text-[14px] font-semibold leading-snug text-[#263832]">{card.titleKo}</p>
        </div>
      </div>
      <div className="mt-3 grid gap-2.5">
        <div>
          <p className="text-[11px] font-semibold text-[#8F6662]">조심할 지점</p>
          <p className="mt-1 text-[13px] font-medium leading-relaxed text-[#5d6879]">{card.attentionKo}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-[#36534E]">이렇게 해보기</p>
          <p className="mt-1 text-[13px] font-medium leading-relaxed text-[#34445a]">{card.solutionKo}</p>
        </div>
        <p className="rounded-[10px] bg-white px-3 py-2.5 text-[12px] font-semibold leading-relaxed text-[#263832]">
          {card.firstQuestionKo}
        </p>
      </div>
    </div>
  );
}

function CoupleAxisRow({
  label,
  axis,
  emphasis = false,
}: {
  label: string;
  axis: Extract<WeddingCodeCoupleReportPayload, { status: "ready" }>["report"]["easyPoints"][number];
  emphasis?: boolean;
}) {
  return (
    <div className={`rounded-[14px] border px-4 py-3.5 ${
      emphasis ? "border-[#36534E]/25 bg-[#EEF4F1]" : "border-[#eadfc9] bg-[#fffdf7]"
    }`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold tracking-wide text-[#7b5528]">{label}</p>
      </div>
      <p className="mt-1 text-[14px] font-semibold text-[#263832]">{axis.labelKo}</p>
      <p className="mt-1 text-[13px] font-medium leading-relaxed text-[#5d6879]">{axis.summaryKo}</p>
    </div>
  );
}
