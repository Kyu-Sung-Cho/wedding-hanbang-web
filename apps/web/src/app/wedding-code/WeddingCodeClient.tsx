"use client";

// CANDIDATE4_RETIRED: unreachable legacy UI; do not reconnect or reuse for Candidate 5.
// 웨딩코드 v0.5 폼 — 16개 상황형 질문을 한 화면 한 질문으로 진행한다.
// 결과 화면에서 v0.5 score/report를 참고용으로 보여주며, 사람이나 관계를 단정하지 않는다.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Clock3, Loader2, MessageCircle, UsersRound } from "lucide-react";
import {
  WC_NO_RIGHT_ANSWER, WC_CONSENT_LABEL,
  WC_STAGES, WC_ANSWERING_MODES, WC_QUOTE_STATUSES, WC_PARENT_INVOLVEMENTS, WC_CONCERNS,
  WC_SCALE_LABELS, WC_FEEDBACK_ITEMS, WC_CTA_ITEMS, WC_FREE_TEXT_ITEMS,
} from "@/constants/weddingCodeForm";
import {
  WEDDING_CODE_V05_QUESTIONS,
  WEDDING_CODE_V05_VERSION,
  type WeddingCodeV05Question,
} from "@/constants/weddingCodeV05";
import { readStoredUtm } from "@/utils/utm";
import { captureEvent } from "@/lib/analytics";
import { WC_RESULT_STORAGE_KEY, type WcResultBackup } from "./result/ResultClient";

type Step = "intro" | "context" | "questions" | "feedback" | "cta" | "freetext";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FlowQuestion = WeddingCodeV05Question;

const WC_V05_INTRO_TITLE = "웨딩코드 3분 테스트";
const WC_V05_INTRO_BODY = `결혼 준비를 하다 보면 예산, 취향, 가족 조율, 역할 분담, 서로에게 필요한 말의 순서가 한꺼번에 섞입니다.

웨딩코드는 16개의 실제 상황에서 내가 중요하게 보는 것을 정리하고, 상대와 더 편하게 이야기할 지점을 보여주는 참고 도구예요. 사람을 평가하거나 두 사람의 앞날을 단정하지 않습니다.`;

const card = "rounded-[6px] border border-[var(--hb-hairline)] bg-white/90 shadow-[var(--shadow-raised)]";
const primaryBtn =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-7 text-[14px] font-semibold text-white shadow-[var(--shadow-raised)] transition-colors hover:bg-[#2d4642] disabled:opacity-40 disabled:cursor-not-allowed";
const ghostBtn =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[6px] border border-[var(--hb-hairline)] bg-white px-5 text-[13px] font-semibold text-[#6d625a] transition-colors hover:bg-[#f7f3ec]";

const INTRO_POINTS = [
  { icon: Clock3, label: "3분", body: "16개 장면" },
  { icon: MessageCircle, label: "대화", body: "질문 카드" },
  { icon: UsersRound, label: "커플", body: "비교 리포트" },
] as const;

export default function WeddingCodeClient() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("intro");
  const [consent, setConsent] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  // 파트너 유입 페어링 토큰 (?ct=) — 형식만 확인, 엄격 검증은 서버
  const [ctToken, setCtToken] = useState<string | null>(null);
  useEffect(() => {
    const ct = new URLSearchParams(window.location.search).get("ct");
    if (ct && UUID_RE.test(ct)) setCtToken(ct);
  }, []);

  // 참여자 컨텍스트
  const [stage, setStage] = useState("");
  const [mode, setMode] = useState("");
  const [quoteStatus, setQuoteStatus] = useState("");
  const [parentInvolvement, setParentInvolvement] = useState("");
  const [concerns, setConcerns] = useState<string[]>([]);
  const [concernOther, setConcernOther] = useState("");

  // 문항
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [qIndex, setQIndex] = useState(0);

  // 피드백·CTA·자유 텍스트
  const [feedback, setFeedback] = useState<Record<string, number>>({});
  const [cta, setCta] = useState<Record<string, number>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flow: FlowQuestion[] = useMemo(() => [...WEDDING_CODE_V05_QUESTIONS], []);

  const current = flow[qIndex];
  const contextAnswerCount = [stage, mode, quoteStatus, parentInvolvement].filter(Boolean).length;
  const contextMissingCount = 4 - contextAnswerCount;
  const contextComplete = contextMissingCount === 0;

  function toggleConcern(c: string) {
    setConcerns((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function selectOption(q: FlowQuestion, value: string) {
    setAnswers((prev) => ({ ...prev, [q.key]: value }));
    setSkipped((prev) => ({ ...prev, [q.key]: false }));
    window.setTimeout(() => advance(), 160);
  }

  function advance() {
    if (qIndex + 1 < flow.length) setQIndex(qIndex + 1);
    else setStep("feedback");
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const utm = readStoredUtm();
      const params = new URLSearchParams(window.location.search);
      const res = await fetch("/api/wedding-code/response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consent: true,
          participant_stage: stage,
          answering_mode: mode,
          quote_status: quoteStatus,
          parent_involvement: parentInvolvement,
          biggest_concern: concerns,
          biggest_concern_other: concerns.includes("기타") ? concernOther : undefined,
          answers,
          stage_flags: {},
          feedback,
          cta_interest: cta,
          free_text: freeText,
          duration_ms: startedAt ? Date.now() - startedAt : undefined,
          utm_source: utm?.source ?? params.get("utm_source") ?? undefined,
          utm_medium: utm?.medium ?? params.get("utm_medium") ?? undefined,
          utm_campaign: utm?.campaign ?? params.get("utm_campaign") ?? undefined,
          utm_content: params.get("utm_content") ?? undefined,
          couple_token: ctToken ?? undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean; error?: string; id?: string | null; paired?: boolean; coupleToken?: string | null;
      };
      if (!res.ok || !data.success) {
        setError(data.error ?? "저장에 실패했어요. 잠시 후 다시 시도해주세요.");
        return;
      }
      captureEvent("wedding_code_completed", { stage, quote_status: quoteStatus });
      if (data.paired) captureEvent("wc_invite_pair_completed", {});

      // 결과 화면용 백업 (새로고침 대비) → /wedding-code/result 이동
      const resultBackup: WcResultBackup = {
        answers,
        skipped,
        version: WEDDING_CODE_V05_VERSION,
        responseId: data.id ?? null,
        paired: data.paired === true,
        coupleToken: data.coupleToken ?? null,
        savedAt: new Date().toISOString(),
      };
      try {
        // localStorage — 카톡 인앱 종료 후 재방문에도 결과 복원 (재응시 시 덮어쓰기 허용)
        window.localStorage.setItem(WC_RESULT_STORAGE_KEY, JSON.stringify(resultBackup));
      } catch { /* storage 불가 시에도 이동 — 결과 화면이 폼으로 안내 */ }
      router.push("/wedding-code/result");
    } catch {
      setError("네트워크 오류가 발생했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  const answeredCount = flow.filter((q) => answers[q.key]).length;

  return (
    <div className="min-h-screen bg-[var(--hb-surface-page)] px-4 py-7 sm:py-12">
      <div className="mx-auto w-full max-w-[620px]">
        {/* 헤더 */}
        <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--hb-accent-hover)]">
          WEDDINGCODE V0.5
        </p>
        <h1 className="mb-6 text-center text-[25px] font-semibold leading-[1.25] text-[var(--hb-text-strong)] sm:text-[30px]">
          {WC_V05_INTRO_TITLE}
        </h1>

        {/* 진행 바 (문항 단계에서만) */}
        {step === "questions" && flow.length > 0 && (
          <div className="mb-5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#efe6d7]">
              <div
                className="h-full rounded-full bg-[var(--hb-primary)] transition-all duration-300"
                style={{ width: `${Math.round((answeredCount / flow.length) * 100)}%` }}
              />
            </div>
            {/* 번호는 현재 위치 기준 — 뒤로가기로 재방문해도 보고 있는 문항과 일치 */}
            <p className="mt-1.5 text-right text-[12px] font-medium text-[var(--hb-text-muted)]">
              {qIndex + 1} / {flow.length}
            </p>
          </div>
        )}

        {/* ── 인트로 + 동의 ── */}
        {step === "intro" && (
          <div className={`${card} overflow-hidden`}>
            <div className="p-5 sm:p-8">
              <p className="text-[12px] font-semibold text-[var(--hb-accent-hover)]">중요하게 보는 것을 정리해요</p>
              <p className="mt-3 whitespace-pre-line text-[14px] font-medium leading-[1.75] text-[var(--hb-text-body)]">
                {WC_V05_INTRO_BODY}
              </p>
            </div>
            <div className="grid grid-cols-3 divide-x divide-[var(--hb-hairline)] border-y border-[var(--hb-hairline)] bg-[var(--hb-surface-page)]">
              {INTRO_POINTS.map((point) => (
                <div key={point.label} className="min-w-0 px-3 py-3 text-center sm:px-5 sm:py-4">
                  <point.icon className="mx-auto h-4 w-4 text-[var(--hb-text-strong)]" />
                  <div>
                    <p className="mt-1.5 text-[12px] font-semibold text-[var(--hb-text-strong)]">{point.label}</p>
                    <p className="mt-0.5 truncate text-[11px] font-medium leading-relaxed text-[#6d625a]">{point.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-5 sm:p-8">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-4 py-3.5 select-none">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--hb-text-strong)]"
              />
              <span className="text-[13px] font-medium leading-relaxed text-[var(--hb-text-body)]">{WC_CONSENT_LABEL}</span>
            </label>
            <button
              onClick={() => {
                if (!consent) return;
                setStartedAt(Date.now());
                captureEvent("wedding_code_started", {});
                setStep("context");
              }}
              disabled={!consent}
              className={`${primaryBtn} mt-5 w-full`}
            >
              시작하기 <ArrowRight className="h-4 w-4" />
            </button>
            </div>
          </div>
        )}

        {/* ── 참여자 컨텍스트 ── */}
        {step === "context" && (
          <div className={`${card} p-6 sm:p-8`}>
            <div className="mb-6 rounded-[6px] bg-[#EEF4F1] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] font-semibold text-[var(--hb-text-strong)]">기본 상황 {contextAnswerCount} / 4</p>
                <p className="text-[11px] font-semibold text-[#6d625a]">
                  {contextComplete ? "질문으로 넘어갈 수 있어요" : `${contextMissingCount}개 더 선택`}
                </p>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                <div
                  className="h-full rounded-full bg-[var(--hb-primary)] transition-all"
                  style={{ width: `${(contextAnswerCount / 4) * 100}%` }}
                />
              </div>
            </div>
            <ContextSelect label="지금 결혼 준비 단계는 어디에 가장 가깝나요?" options={WC_STAGES} value={stage} onChange={setStage} />
            <ContextSelect label="답변은 혼자 하고 있나요, 상대와 함께 하고 있나요?" options={WC_ANSWERING_MODES} value={mode} onChange={setMode} />
            <ContextSelect label="업체 견적을 받아본 적이 있나요?" options={WC_QUOTE_STATUSES} value={quoteStatus} onChange={setQuoteStatus} />
            <ContextSelect label="부모님 또는 가족이 결혼 준비 결정에 어느 정도 관여하고 있나요?" options={WC_PARENT_INVOLVEMENTS} value={parentInvolvement} onChange={setParentInvolvement} />

            <p className="mb-2 mt-6 text-[14px] font-semibold text-[var(--hb-text-strong)]">
              지금 가장 큰 결혼 준비 고민은 무엇인가요? <span className="font-medium text-[var(--hb-text-muted)]">(복수 선택)</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {WC_CONCERNS.map((c) => (
                <button
                  key={c}
                  onClick={() => toggleConcern(c)}
                  className={`rounded-[6px] border px-3.5 py-2 text-[13px] font-medium transition-colors ${
                    concerns.includes(c)
                      ? "border-[var(--hb-primary)] bg-[var(--hb-primary)] text-white"
                      : "border-[var(--hb-hairline)] bg-white text-[var(--hb-text-body)] hover:border-[#b68a3a]"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            {concerns.includes("기타") && (
              <input
                type="text"
                value={concernOther}
                onChange={(e) => setConcernOther(e.target.value)}
                placeholder="기타 고민을 적어주세요"
                className="mt-3 w-full rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-4 py-3 text-[14px] text-[var(--hb-text-strong)] outline-none focus:border-[var(--hb-primary)]"
              />
            )}

            <button
              onClick={() => contextComplete && setStep("questions")}
              disabled={!contextComplete}
              className={`${primaryBtn} mt-6 w-full`}
            >
              {contextComplete ? "질문 시작" : `${contextMissingCount}개 더 선택하면 시작`} <ArrowRight className="h-4 w-4" />
            </button>
            <p className="mt-3 text-center text-[12px] font-medium text-[var(--hb-text-muted)]">{WC_NO_RIGHT_ANSWER}</p>
          </div>
        )}

        {/* ── 문항 (한 화면 한 질문) ── */}
        {step === "questions" && current && (
          <div className={`${card} p-6 sm:p-8`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[12px] font-semibold text-[var(--hb-accent-hover)]">{current.title}</p>
              <p className="rounded-full bg-[#EEF4F1] px-2.5 py-1 text-[11px] font-semibold text-[var(--hb-text-strong)]">
                {qIndex + 1} / {flow.length}
              </p>
            </div>
            <p className="text-[19px] font-semibold leading-[1.5] text-[var(--hb-text-strong)] sm:text-[21px]">
              {current.question}
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              {current.options.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => selectOption(current, opt.value)}
                  className={`flex items-start gap-3 rounded-[6px] border px-4 py-3.5 text-left text-[14px] font-medium leading-[1.6] transition-colors ${
                    answers[current.key] === opt.value
                      ? "border-[var(--hb-primary)] bg-[#EEF4F1] text-[var(--hb-text-strong)]"
                      : "border-[var(--hb-hairline)] bg-white text-[var(--hb-text-body)] hover:border-[var(--hb-primary)]/50 hover:bg-[var(--hb-surface-page)]"
                  }`}
                >
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    answers[current.key] === opt.value ? "border-[var(--hb-primary)] bg-[var(--hb-primary)] text-white" : "border-[#d8c9ad] bg-[var(--hb-surface-page)]"
                  }`}>
                    {answers[current.key] === opt.value && <Check className="h-3 w-3" />}
                  </span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between">
              <button
                onClick={() => (qIndex > 0 ? setQIndex(qIndex - 1) : setStep("context"))}
                className={ghostBtn}
              >
                <ArrowLeft className="h-3.5 w-3.5" /> 이전
              </button>
            </div>
          </div>
        )}

        {/* ── 피드백 척도 ── */}
        {step === "feedback" && (
          <ScaleScreen
            title="테스트는 어떠셨나요?"
            items={WC_FEEDBACK_ITEMS}
            values={feedback}
            onChange={(k, v) => setFeedback((p) => ({ ...p, [k]: v }))}
            onBack={() => setStep("questions")}
            onNext={() => setStep("cta")}
          />
        )}

        {/* ── CTA 관심 ── */}
        {step === "cta" && (
          <ScaleScreen
            title="이런 게 있다면 써보고 싶나요?"
            items={WC_CTA_ITEMS}
            values={cta}
            onChange={(k, v) => setCta((p) => ({ ...p, [k]: v }))}
            onBack={() => setStep("feedback")}
            onNext={() => setStep("freetext")}
          />
        )}

        {/* ── 자유 텍스트 + 제출 ── */}
        {step === "freetext" && (
          <div className={`${card} p-6 sm:p-8`}>
            <h2 className="mb-4 text-[20px] font-semibold text-[var(--hb-text-strong)]">마지막으로, 자유롭게 남겨주세요</h2>
            {WC_FREE_TEXT_ITEMS.map((item) => (
              <div key={item.key} className="mb-4">
                <p className="mb-1.5 text-[13px] font-semibold text-[var(--hb-text-body)]">
                  {item.label} <span className="font-medium text-[var(--hb-text-muted)]">(선택)</span>
                </p>
                <textarea
                  value={freeText[item.key] ?? ""}
                  onChange={(e) => setFreeText((p) => ({ ...p, [item.key]: e.target.value }))}
                  rows={2}
                  maxLength={1000}
                  className="w-full resize-none rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-4 py-3 text-[14px] leading-relaxed text-[var(--hb-text-strong)] outline-none focus:border-[var(--hb-primary)]"
                />
              </div>
            ))}
            {error && <p className="mb-3 text-[13px] font-semibold text-danger-700">{error}</p>}
            <div className="flex items-center justify-between gap-3">
              <button onClick={() => setStep("cta")} className={ghostBtn}>
                <ArrowLeft className="h-3.5 w-3.5" /> 이전
              </button>
              <button onClick={submit} disabled={submitting} className={`${primaryBtn} flex-1`}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {submitting ? "제출 중..." : "제출하기"}
              </button>
            </div>
          </div>
        )}

        {/* 제출 성공 시 /wedding-code/result 로 이동 — 완료 화면은 결과 화면이 대체 */}
      </div>
    </div>
  );
}

function ContextSelect({
  label, options, value, onChange,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mb-5">
      <p className="mb-2 text-[14px] font-semibold text-[var(--hb-text-strong)]">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            aria-pressed={value === opt.value}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-[6px] border px-3.5 py-2 text-[13px] font-medium transition-colors ${
              value === opt.value
                ? "border-[var(--hb-primary)] bg-[var(--hb-primary)] text-white"
                : "border-[var(--hb-hairline)] bg-white text-[var(--hb-text-body)] hover:border-[#b68a3a]"
            }`}
          >
            {value === opt.value && <Check className="h-3.5 w-3.5" />}
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ScaleScreen({
  title, items, values, onChange, onBack, onNext,
}: {
  title: string;
  items: readonly { key: string; label: string }[];
  values: Record<string, number>;
  onChange: (key: string, value: number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className={`${card} p-6 sm:p-8`}>
      <h2 className="mb-1 text-[20px] font-semibold text-[var(--hb-text-strong)]">{title}</h2>
      <p className="mb-5 text-[12px] font-medium text-[var(--hb-text-muted)]">
        1 = {WC_SCALE_LABELS[0]} · 5 = {WC_SCALE_LABELS[4]} (선택 사항)
      </p>
      {items.map((item) => (
        <div key={item.key} className="mb-4">
          <p className="mb-2 text-[13px] font-semibold leading-relaxed text-[var(--hb-text-body)]">{item.label}</p>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => onChange(item.key, n)}
                aria-label={`${item.label} — ${n}점 (${WC_SCALE_LABELS[n - 1]})`}
                className={`h-10 flex-1 rounded-[6px] border text-[14px] font-semibold transition-colors ${
                  values[item.key] === n
                    ? "border-[var(--hb-primary)] bg-[var(--hb-primary)] text-white"
                    : "border-[var(--hb-hairline)] bg-white text-[#6d625a] hover:border-[var(--hb-primary)]/50"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="mt-5 flex items-center justify-between gap-3">
        <button onClick={onBack} className={ghostBtn}>
          <ArrowLeft className="h-3.5 w-3.5" /> 이전
        </button>
        <button onClick={onNext} className={`${primaryBtn} flex-1`}>
          다음 <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
