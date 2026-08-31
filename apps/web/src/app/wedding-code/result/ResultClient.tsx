"use client";

// CANDIDATE4_RETIRED: unreachable legacy UI; do not reconnect or reuse for Candidate 5.
import { useEffect, useMemo, useState } from "react";
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
  WEDDING_CODE_V05_VERSION,
} from "@/constants/weddingCodeV05";
import { toWeddingCodeV05Answers } from "@/lib/weddingCode/answers";
import type { WeddingCodeCoupleReportPayload } from "@/lib/weddingCode/coupleReport";
import { buildWeddingCodeV05IndividualReport } from "@/lib/weddingCode/report";
import { scoreWeddingCodeV05 } from "@/lib/weddingCode/score";
import { renderShareCard, downloadCanvasPng, canvasToPngBlob } from "@/lib/weddingCode/shareCard";
import { captureEvent } from "@/lib/analytics";

export interface WcResultBackup {
  answers: Record<string, string>;
  skipped: Record<string, boolean>;
  version?: string;
  responseId: string | null;
  paired: boolean;
  coupleToken: string | null;
  savedAt: string;
}

export const WC_RESULT_STORAGE_KEY = "wc_result_v05";

type CoupleReportState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "waiting"; payload: Extract<WeddingCodeCoupleReportPayload, { status: "waiting" }> }
  | { kind: "incompatible"; payload: Extract<WeddingCodeCoupleReportPayload, { status: "incompatible" }> }
  | { kind: "ready"; payload: Extract<WeddingCodeCoupleReportPayload, { status: "ready" }> }
  | { kind: "error"; messageKo: string };

const card = "rounded-[6px] border border-[var(--hb-hairline)] bg-white/90 shadow-[var(--shadow-raised)]";
const primaryBtn =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-6 text-[14px] font-semibold text-white shadow-[var(--shadow-raised)] transition-colors hover:bg-[#2d4642] disabled:opacity-40";
const ghostBtn =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[6px] border border-[var(--hb-hairline)] bg-white px-5 text-[13px] font-semibold text-[#6d625a] transition-colors hover:bg-[#f7f3ec]";

function readBackup(): WcResultBackup | null {
  try {
    const raw = window.localStorage.getItem(WC_RESULT_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as WcResultBackup;
    return value && typeof value === "object" && value.answers ? value : null;
  } catch {
    return null;
  }
}

function writeBackup(backup: WcResultBackup): void {
  try {
    window.localStorage.setItem(WC_RESULT_STORAGE_KEY, JSON.stringify(backup));
  } catch {
    /* storage 불가 환경 무시 */
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
  const [allOpen, setAllOpen] = useState(false);
  const [inviteState, setInviteState] = useState<"idle" | "creating" | "copied" | "error">("idle");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [coupleReportState, setCoupleReportState] = useState<CoupleReportState>({ kind: "idle" });
  const [coupleReportReloadKey, setCoupleReportReloadKey] = useState(0);

  useEffect(() => {
    const data = readBackup();
    setBackup(data);
    if (data) captureEvent("wc_result_viewed", { paired: data.paired, version: data.version ?? WEDDING_CODE_V05_VERSION });
  }, []);

  const answers = useMemo(() => {
    if (!backup || backup === "loading") return {};
    return toWeddingCodeV05Answers(backup.answers);
  }, [backup]);

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

  useEffect(() => {
    if (!backup || backup === "loading" || !backup.coupleToken) {
      setCoupleReportState({ kind: "idle" });
      return;
    }

    const coupleToken = backup.coupleToken;
    let cancelled = false;
    async function loadCoupleReport() {
      setCoupleReportState({ kind: "loading" });
      try {
        const res = await fetch(`/api/wedding-code/couple-report?ct=${encodeURIComponent(coupleToken)}`);
        const payload = (await res.json().catch(() => null)) as WeddingCodeCoupleReportPayload | { error?: string } | null;
        if (cancelled) return;
        if (!res.ok || !payload || !("status" in payload)) {
          const messageKo = payload && "error" in payload ? payload.error : null;
          setCoupleReportState({ kind: "error", messageKo: messageKo ?? "비교 리포트를 불러오지 못했어요." });
          return;
        }
        if (payload.status === "ready") {
          setCoupleReportState({ kind: "ready", payload });
          captureEvent("wc_couple_report_viewed", { version: WEDDING_CODE_V05_VERSION });
        } else if (payload.status === "waiting") {
          setCoupleReportState({ kind: "waiting", payload });
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
  }, [backup, coupleReportReloadKey]);

  async function saveResultCard() {
    setSavingCard(true);
    try {
      const strongestAxis =
        report.axisReports.find((axis) => axis.leftScore !== null && axis.rightScore !== null) ?? report.axisReports[0];
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
            captureEvent("wc_result_card_saved", { method: "share", version: WEDDING_CODE_V05_VERSION });
            return;
          } catch (err) {
            if (err instanceof Error && err.name === "AbortError") return;
          }
        }
      }

      const dataUrl = canvas.toDataURL("image/png");
      setSaveOverlay({ dataUrl, canvas });
      captureEvent("wc_result_card_saved", { method: "longpress_shown", version: WEDDING_CODE_V05_VERSION });
    } catch {
      /* 공유 카드 렌더 실패는 화면 이용을 막지 않는다 */
    } finally {
      setSavingCard(false);
    }
  }

  function downloadFromOverlay() {
    if (!saveOverlay) return;
    downloadCanvasPng(saveOverlay.canvas, "weddingcode-result.png");
    captureEvent("wc_result_card_saved", { method: "download", version: WEDDING_CODE_V05_VERSION });
  }

  async function createInvite() {
    if (!backup || backup === "loading" || !backup.responseId || inviteState === "creating") return;
    let token = backup.coupleToken;
    setInviteState("creating");
    try {
      if (!token) {
        token = crypto.randomUUID();
        const res = await fetch("/api/wedding-code/pair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response_id: backup.responseId, couple_token: token }),
        });
        if (!res.ok) {
          setInviteState("error");
          return;
        }
        const next = { ...backup, coupleToken: token };
        setBackup(next);
        writeBackup(next);
        captureEvent("wc_invite_link_created", { version: WEDDING_CODE_V05_VERSION });
      }
      const link = `${window.location.origin}/wedding-code?ct=${token}`;
      setInviteLink(link);
      try {
        await navigator.clipboard.writeText(link);
        setInviteState("copied");
      } catch {
        setInviteState("idle");
      }
    } catch {
      setInviteState("error");
    }
  }

  if (backup === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--hb-surface-page)]">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--hb-accent-hover)]" />
      </div>
    );
  }

  if (!backup || score.answeredCount === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--hb-surface-page)] px-4">
        <div className={`${card} max-w-[420px] p-8 text-center`}>
          <p className="text-[20px] font-semibold text-[var(--hb-text-strong)]">결과를 불러올 응답이 없어요</p>
          <p className="mt-2 text-[13px] font-medium leading-relaxed text-[var(--hb-text-body)]">
            v0.5 테스트를 먼저 완료하면 이 화면에서 결혼 준비 방식을 정리해볼 수 있어요.
          </p>
          <Link href="/wedding-code" className={`${primaryBtn} mt-5 w-full`}>
            테스트 하러 가기 <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--hb-surface-page)] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-[620px]">
        <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--hb-accent-hover)]">
          WEDDINGCODE V0.5
        </p>
        <h1 className="text-center text-[27px] font-semibold leading-[1.3] text-[var(--hb-text-strong)] sm:text-[31px]">
          {report.titleKo}
        </h1>
        <p className="mt-2 text-center text-[13px] font-medium leading-relaxed text-[var(--hb-text-body)]">
          {report.subtitleKo}
        </p>

        <section className={`${card} mt-7 overflow-hidden`}>
          <div className="flex items-start justify-between gap-4 p-5 sm:p-6">
            <div>
              <p className="text-[12px] font-semibold text-[var(--hb-accent-hover)]">결과 요약</p>
              <p className="mt-2 text-[17px] font-semibold leading-relaxed text-[var(--hb-text-strong)]">
                {strongestAxis?.summaryKo ?? report.subtitleKo}
              </p>
              <p className="mt-2 text-[13px] font-medium leading-relaxed text-[var(--hb-text-body)]">
                점수로 판정하지 않고, 결혼 준비 대화에 바로 쓸 수 있는 기준만 정리했어요.
              </p>
            </div>
            <button
              onClick={saveResultCard}
              disabled={savingCard}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--hb-hairline)] bg-white text-[var(--hb-text-strong)] disabled:opacity-50"
              aria-label="결과 카드 저장·공유"
              title="결과 카드 저장·공유"
            >
              {savingCard ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
            </button>
          </div>
          <div className="grid grid-cols-3 divide-x divide-[var(--hb-hairline)] border-t border-[var(--hb-hairline)] bg-[var(--hb-surface-page)]">
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
                <h2 className="text-[16px] font-semibold text-[var(--hb-text-strong)]">{axis.labelKo}</h2>
              </div>
              <p className="mt-2 text-[14px] font-medium leading-[1.75] text-[var(--hb-text-body)]">{axis.summaryKo}</p>
              <div className="mt-4 flex items-center justify-between gap-3 rounded-[6px] bg-[var(--hb-surface-hover)] px-4 py-3 text-[12px] font-semibold text-[var(--hb-text-strong)]">
                <span>{labels.left}</span>
                <span aria-hidden="true" className="text-[#A77B74]">↔</span>
                <span>{labels.right}</span>
              </div>
                  </>
                );
              })()}
            </article>
          ))}
        </section>

        <section className={`${card} mt-5 p-5 sm:p-6`}>
          <p className="text-[12px] font-semibold text-[var(--hb-accent-hover)]">오늘 대화해볼 것</p>
          <div className="mt-3 flex flex-col gap-2.5">
            {report.talkStarters.map((text) => (
              <p key={text} className="rounded-[6px] bg-[var(--hb-surface-page)] px-4 py-3 text-[13px] font-medium leading-relaxed text-[var(--hb-text-strong)]">
                {text}
              </p>
            ))}
          </div>
        </section>

        <section className={`${card} mt-5 p-5 sm:p-6`}>
          <p className="text-[12px] font-semibold text-[var(--hb-accent-hover)]">다음 행동 카드</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {report.actionCards.map((action) => (
              <div key={action.id} className="rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] p-4">
                <p className="text-[14px] font-semibold text-[var(--hb-text-strong)]">{action.titleKo}</p>
                <p className="mt-1.5 text-[13px] font-medium leading-relaxed text-[var(--hb-text-body)]">{action.bodyKo}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-7 flex flex-col gap-2.5">
          {!backup.coupleToken && backup.responseId && coupleReportState.kind !== "ready" && (
            <div className={`${card} p-5`}>
              <button onClick={createInvite} disabled={inviteState === "creating"} className={`${primaryBtn} w-full`}>
                {inviteState === "creating" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className="h-4 w-4" />}
                상대에게 보내고 비교 준비하기
              </button>
              <p className="mt-2 text-center text-[12px] font-medium text-[#9a9188]">
                상대가 같은 테스트를 완료하면 두 사람의 준비 방식 겹침도를 만들 수 있어요.
              </p>
              {visibleInviteLink && (
                <div className="mt-3 flex items-center gap-2 rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-3 py-2.5">
                  <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--hb-text-body)]">{visibleInviteLink}</p>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(visibleInviteLink);
                        setInviteState("copied");
                      } catch {
                        /* 수동 복사 안내 유지 */
                      }
                    }}
                    className="shrink-0 text-[var(--hb-text-strong)]"
                    aria-label="링크 복사"
                  >
                    {inviteState === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              )}
              {inviteState === "copied" && (
                <p className="mt-1.5 text-center text-[12px] font-semibold text-[var(--hb-text-strong)]">링크를 복사했어요. 카톡으로 보내보세요.</p>
              )}
              {inviteState === "error" && (
                <p className="mt-1.5 text-center text-[12px] font-semibold text-red-500">링크 생성에 실패했어요. 잠시 후 다시 시도해주세요.</p>
              )}
            </div>
          )}
          <Link
            href="/check"
            onClick={() => captureEvent("wedding_code_to_quote_check", { version: WEDDING_CODE_V05_VERSION })}
            className={`${ghostBtn} w-full`}
          >
            <ClipboardCheck className="h-4 w-4" />
            내 견적 체크하러 가기
          </Link>
        </div>

        <div className={`${card} mt-7 overflow-hidden`}>
          <button
            onClick={() => setAllOpen(!allOpen)}
            className="flex w-full items-center justify-between px-6 py-4 text-left"
          >
            <span className="text-[14px] font-semibold text-[var(--hb-text-strong)]">내 선택 전부 보기</span>
            {allOpen ? <ChevronUp className="h-4 w-4 text-[#9a9188]" /> : <ChevronDown className="h-4 w-4 text-[#9a9188]" />}
          </button>
          {allOpen && (
            <div className="divide-y divide-[#f0e9db] border-t border-[var(--hb-hairline)]">
              {WEDDING_CODE_V05_QUESTIONS.map((question) => {
                const answer = answers[question.key];
                const option = question.options.find((candidate) => candidate.value === answer);
                return (
                  <div key={question.key} className="px-6 py-3.5">
                    <p className="text-[11px] font-semibold text-[var(--hb-accent-hover)]">{question.title}</p>
                    <p className="mt-1 text-[13px] font-medium leading-relaxed text-[var(--hb-text-body)]">
                      {option ? option.label : <span className="text-[#9a9188]">응답 없음</span>}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <p className="mt-5 text-center text-[11px] font-medium leading-relaxed text-[#9a9188]">
          {report.disclaimerKo}
        </p>
      </div>

      {saveOverlay && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#1a1a1f]/92 px-6 py-8">
          <button
            onClick={() => setSaveOverlay(null)}
            aria-label="닫기"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL은 next/image 불가 */}
          <img
            src={saveOverlay.dataUrl}
            alt="웨딩코드 결과 카드"
            className="max-h-[70vh] w-auto rounded-[6px] shadow-2xl"
          />
          <p className="mt-4 text-center text-[14px] font-semibold leading-relaxed text-white">
            이미지를 길게 눌러 사진 앱에 저장하세요.
          </p>
          <button
            onClick={downloadFromOverlay}
            className="mt-3 text-[12px] font-medium text-white/60 underline underline-offset-2"
          >
            또는 파일로 저장
          </button>
        </div>
      )}
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
      <section className={`${card} mt-5 p-5 sm:p-6`}>
        <div className="flex items-center gap-2.5">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--hb-text-strong)]" />
          <p className="text-[14px] font-semibold text-[var(--hb-text-strong)]">두 사람의 준비 방식 겹침도를 불러오는 중이에요.</p>
        </div>
      </section>
    );
  }

  if (state.kind === "waiting" || state.kind === "idle") {
    return (
      <section className={`${card} mt-5 p-5 sm:p-6`}>
        <p className="text-[12px] font-semibold text-[var(--hb-accent-hover)]">커플 비교</p>
        <p className="mt-2 text-[17px] font-semibold text-[var(--hb-text-strong)]">
          {state.kind === "waiting" ? state.payload.messageKo : "아직 상대 응답을 기다리고 있어요."}
        </p>
        <p className="mt-1.5 text-[13px] font-medium leading-relaxed text-[var(--hb-text-body)]">
          상대가 같은 링크로 테스트를 마치면, 이 화면에서 쉽게 이야기할 부분과 먼저 맞출 부분을 볼 수 있어요.
        </p>
        <button onClick={onRefresh} className={`${ghostBtn} mt-4`}>
          상태 다시 확인
        </button>
      </section>
    );
  }

  if (state.kind === "incompatible" || state.kind === "error") {
    return (
      <section className={`${card} mt-5 p-5 sm:p-6`}>
        <p className="text-[12px] font-semibold text-[var(--hb-accent-hover)]">커플 비교</p>
        <p className="mt-2 text-[17px] font-semibold text-[var(--hb-text-strong)]">
          {state.kind === "incompatible" ? state.payload.messageKo : state.messageKo}
        </p>
        <p className="mt-1.5 text-[13px] font-medium leading-relaxed text-[var(--hb-text-body)]">
          비교는 두 사람 모두 v0.5 테스트를 완료했을 때만 보여줘요.
        </p>
        <button onClick={onRefresh} className={`${ghostBtn} mt-4`}>
          다시 불러오기
        </button>
      </section>
    );
  }

  const { report } = state.payload;

  return (
    <section className={`${card} mt-5 p-5 sm:p-6`}>
      <p className="text-[12px] font-semibold text-[var(--hb-accent-hover)]">커플 비교</p>
      <div className="mt-2">
        <h2 className="text-[20px] font-semibold leading-[1.35] text-[var(--hb-text-strong)]">{report.titleKo}</h2>
        <p className="mt-1.5 text-[13px] font-semibold leading-relaxed text-[var(--hb-text-strong)]">
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

      <p className="mt-4 rounded-[6px] bg-[var(--hb-surface-page)] px-4 py-3 text-[13px] font-medium leading-relaxed text-[var(--hb-text-body)]">
        {report.guideKo}
      </p>

      {report.scenarioCards.length > 0 && (
        <div className="mt-5 border-t border-[var(--hb-hairline)] pt-5">
          <p className="text-[12px] font-semibold text-[var(--hb-accent-hover)]">실제 장면별 솔루션</p>
          <div className="mt-3 grid gap-4">
            {report.scenarioCards.map((card) => (
              <CoupleScenarioCard key={card.id} card={card} />
            ))}
          </div>
        </div>
      )}

      {report.solutionCards.length > 0 && (
        <div className="mt-5 border-t border-[var(--hb-hairline)] pt-5">
          <p className="text-[12px] font-semibold text-[var(--hb-accent-hover)]">축별 맞춰볼 방법</p>
          <div className="mt-3 grid gap-3">
            {report.solutionCards.map((card) => (
              <CoupleSolutionCard key={card.id} card={card} />
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] font-medium leading-relaxed text-[#9a9188]">
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
    <div className="border-t border-[var(--hb-hairline)] pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-[var(--hb-accent-hover)]">{card.categoryKo}</p>
          <p className="mt-1 text-[15px] font-semibold leading-snug text-[var(--hb-text-strong)]">{card.titleKo}</p>
        </div>
        <p className="shrink-0 rounded-full bg-[#EEF4F1] px-2.5 py-1 text-[11px] font-semibold text-[var(--hb-text-strong)]">
          {sameChoice ? "같은 초점" : "서로 다른 초점"}
        </p>
      </div>

      <div className="mt-3 grid gap-2">
        <div className="rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-3 py-2.5">
          <p className="text-[11px] font-semibold text-[var(--color-rose-700)]">
            {sameChoice ? "두 사람 모두 중요하게 본 것" : "한 사람이 더 중요하게 본 것"}
          </p>
          <p className="mt-1 text-[12px] font-medium leading-relaxed text-[var(--hb-text-body)]">{card.firstChoiceKo}</p>
        </div>
        {!sameChoice && (
          <div className="rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-3 py-2.5">
            <p className="text-[11px] font-semibold text-[var(--color-rose-700)]">다른 사람이 더 중요하게 본 것</p>
            <p className="mt-1 text-[12px] font-medium leading-relaxed text-[var(--hb-text-body)]">{card.secondChoiceKo}</p>
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-2.5">
        <div>
          <p className="text-[11px] font-semibold text-[var(--color-rose-700)]">조심할 지점</p>
          <p className="mt-1 text-[13px] font-medium leading-relaxed text-[var(--hb-text-body)]">{card.attentionKo}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-[var(--hb-text-strong)]">해결 방법</p>
          <p className="mt-1 text-[13px] font-medium leading-relaxed text-[var(--hb-text-body)]">{card.solutionKo}</p>
        </div>
        <p className="rounded-[6px] bg-white px-3 py-2.5 text-[12px] font-semibold leading-relaxed text-[var(--hb-text-strong)]">
          {card.firstQuestionKo}
        </p>
      </div>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-4 py-3.5 text-center">
      <p className="text-[11px] font-semibold text-[var(--hb-accent-hover)]">{label}</p>
      <p className="mt-1 truncate text-[13px] font-semibold text-[var(--hb-text-strong)]">{value}</p>
    </div>
  );
}

function CoupleSolutionCard({
  card,
}: {
  card: Extract<WeddingCodeCoupleReportPayload, { status: "ready" }>["report"]["solutionCards"][number];
}) {
  return (
    <div className="rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-4 py-3.5">
      <div>
        <p className="text-[11px] font-semibold tracking-wide text-[var(--hb-accent-hover)]">{card.categoryKo}</p>
        <p className="mt-1 text-[14px] font-semibold leading-snug text-[var(--hb-text-strong)]">{card.titleKo}</p>
      </div>
      <div className="mt-3 grid gap-2.5">
        <div>
          <p className="text-[11px] font-semibold text-[var(--color-rose-700)]">조심할 지점</p>
          <p className="mt-1 text-[13px] font-medium leading-relaxed text-[var(--hb-text-body)]">{card.attentionKo}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-[var(--hb-text-strong)]">이렇게 해보기</p>
          <p className="mt-1 text-[13px] font-medium leading-relaxed text-[var(--hb-text-body)]">{card.solutionKo}</p>
        </div>
        <p className="rounded-[6px] bg-white px-3 py-2.5 text-[12px] font-semibold leading-relaxed text-[var(--hb-text-strong)]">
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
    <div className={`rounded-[6px] border px-4 py-3.5 ${
      emphasis ? "border-[var(--hb-primary)]/25 bg-[#EEF4F1]" : "border-[var(--hb-hairline)] bg-[var(--hb-surface-page)]"
    }`}>
      <div>
        <p className="text-[11px] font-semibold tracking-wide text-[var(--hb-accent-hover)]">{label}</p>
      </div>
      <p className="mt-1 text-[14px] font-semibold text-[var(--hb-text-strong)]">{axis.labelKo}</p>
      <p className="mt-1 text-[13px] font-medium leading-relaxed text-[var(--hb-text-body)]">{axis.summaryKo}</p>
    </div>
  );
}
