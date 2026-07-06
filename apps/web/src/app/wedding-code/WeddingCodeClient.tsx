"use client";

// 웨딩코드 v0.3 스모크 폼 — 한 화면 한 질문, 단계 게이팅(Option B), 가정 섹션.
// 채점·유형·캐릭터·코드 없음(가드레일). 완료 화면 CTA는 일반 탐색 링크일 뿐,
// 답변 기반 라우팅이 아니다(16번 결정 문서).

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import {
  WC_INTRO_TITLE, WC_INTRO_BODY, WC_NO_RIGHT_ANSWER, WC_CONSENT_LABEL,
  WC_HYPOTHETICAL_NOTE, WC_OPTIONAL_SECTION_TITLE,
  WC_STAGES, WC_ANSWERING_MODES, WC_QUOTE_STATUSES, WC_PARENT_INVOLVEMENTS, WC_CONCERNS,
  WC_QUESTIONS, WC_SCALE_LABELS, WC_FEEDBACK_ITEMS, WC_CTA_ITEMS, WC_FREE_TEXT_ITEMS,
  gateQuestion, type WcQuestion,
} from "@/constants/weddingCodeForm";
import { readStoredUtm } from "@/utils/utm";
import { captureEvent } from "@/lib/analytics";
import { WC_RESULT_STORAGE_KEY, type WcResultBackup } from "./result/ResultClient";

type Step = "intro" | "context" | "questions" | "feedback" | "cta" | "freetext";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FlowQuestion extends WcQuestion {
  presentation: "direct" | "hypothetical";
}

const card = "rounded-[18px] border border-[#eadfc9] bg-white/90 shadow-[0_10px_30px_rgba(8,22,38,0.05)]";
const primaryBtn =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#36534E] px-7 text-[14px] font-semibold text-white shadow-[0_12px_26px_rgba(54,83,78,0.2)] transition-colors hover:bg-[#2d4642] disabled:opacity-40 disabled:cursor-not-allowed";
const ghostBtn =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-[#eadfc9] bg-white px-5 text-[13px] font-semibold text-[#6d625a] transition-colors hover:bg-[#f7f3ec]";

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

  // 컨텍스트 확정 후 문항 순서 계산: direct 먼저, 가정(hypothetical)은 뒤 섹션으로
  const flow: FlowQuestion[] = useMemo(() => {
    if (!stage || !quoteStatus || !parentInvolvement) return [];
    const ctx = { stage, quoteStatus, parentInvolvement };
    const direct: FlowQuestion[] = [];
    const hypo: FlowQuestion[] = [];
    for (const q of WC_QUESTIONS) {
      const presentation = gateQuestion(q, ctx);
      (presentation === "direct" ? direct : hypo).push({ ...q, presentation });
    }
    return [...direct, ...hypo];
  }, [stage, quoteStatus, parentInvolvement]);

  const current = flow[qIndex];
  const firstHypoIndex = flow.findIndex((q) => q.presentation === "hypothetical");
  const contextComplete = stage && mode && quoteStatus && parentInvolvement;

  function toggleConcern(c: string) {
    setConcerns((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function selectOption(q: FlowQuestion, value: string) {
    setAnswers((prev) => ({ ...prev, [q.key]: value }));
    setSkipped((prev) => ({ ...prev, [q.key]: false }));
    window.setTimeout(() => advance(), 160);
  }

  function skipCurrent(q: FlowQuestion) {
    setSkipped((prev) => ({ ...prev, [q.key]: true }));
    setAnswers((prev) => {
      const next = { ...prev };
      delete next[q.key];
      return next;
    });
    advance();
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
      const stageFlags: Record<string, string> = {};
      for (const q of flow) {
        if (!q.gateFlag) continue;
        stageFlags[q.key] = skipped[q.key] ? "skipped" : q.presentation;
      }
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
          stage_flags: stageFlags,
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
        success?: boolean; error?: string; id?: string | null; paired?: boolean;
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
        responseId: data.id ?? null,
        paired: data.paired === true,
        coupleToken: null,
        savedAt: new Date().toISOString(),
      };
      try {
        window.sessionStorage.setItem(WC_RESULT_STORAGE_KEY, JSON.stringify(resultBackup));
      } catch { /* storage 불가 시에도 이동 — 결과 화면이 폼으로 안내 */ }
      router.push("/wedding-code/result");
    } catch {
      setError("네트워크 오류가 발생했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  const answeredCount = flow.filter((q) => answers[q.key] || skipped[q.key]).length;

  return (
    <div className="min-h-screen bg-[#fbf8f2] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-[560px]">
        {/* 헤더 */}
        <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9d6f36]">
          WEDDINGCODE PROTOTYPE
        </p>
        <h1 className="mb-6 text-center font-serif-kr text-[26px] font-medium leading-[1.3] text-[#263832] sm:text-[30px]">
          {WC_INTRO_TITLE}
        </h1>

        {/* 진행 바 (문항 단계에서만) */}
        {step === "questions" && flow.length > 0 && (
          <div className="mb-5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#efe6d7]">
              <div
                className="h-full rounded-full bg-[#36534E] transition-all duration-300"
                style={{ width: `${Math.round((answeredCount / flow.length) * 100)}%` }}
              />
            </div>
            <p className="mt-1.5 text-right text-[12px] font-medium text-[#9a9188]">
              {Math.min(answeredCount + 1, flow.length)} / {flow.length}
            </p>
          </div>
        )}

        {/* ── 인트로 + 동의 ── */}
        {step === "intro" && (
          <div className={`${card} p-6 sm:p-8`}>
            <p className="whitespace-pre-line text-[14px] font-medium leading-[1.8] text-[#5d6879]">
              {WC_INTRO_BODY}
            </p>
            <label className="mt-6 flex cursor-pointer items-start gap-2.5 rounded-[14px] border border-[#eadfc9] bg-[#fffdf7] px-4 py-3.5 select-none">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#36534E]"
              />
              <span className="text-[13px] font-medium leading-relaxed text-[#34445a]">{WC_CONSENT_LABEL}</span>
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
        )}

        {/* ── 참여자 컨텍스트 ── */}
        {step === "context" && (
          <div className={`${card} p-6 sm:p-8`}>
            <ContextSelect label="지금 결혼 준비 단계는 어디에 가장 가깝나요?" options={WC_STAGES} value={stage} onChange={setStage} />
            <ContextSelect label="답변은 혼자 하고 있나요, 상대와 함께 하고 있나요?" options={WC_ANSWERING_MODES} value={mode} onChange={setMode} />
            <ContextSelect label="업체 견적을 받아본 적이 있나요?" options={WC_QUOTE_STATUSES} value={quoteStatus} onChange={setQuoteStatus} />
            <ContextSelect label="부모님 또는 가족이 결혼 준비 결정에 어느 정도 관여하고 있나요?" options={WC_PARENT_INVOLVEMENTS} value={parentInvolvement} onChange={setParentInvolvement} />

            <p className="mb-2 mt-6 text-[14px] font-semibold text-[#263832]">
              지금 가장 큰 결혼 준비 고민은 무엇인가요? <span className="font-medium text-[#9a9188]">(복수 선택)</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {WC_CONCERNS.map((c) => (
                <button
                  key={c}
                  onClick={() => toggleConcern(c)}
                  className={`rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors ${
                    concerns.includes(c)
                      ? "border-[#36534E] bg-[#36534E] text-white"
                      : "border-[#eadfc9] bg-white text-[#34445a] hover:border-[#b68a3a]"
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
                className="mt-3 w-full rounded-xl border border-[#eadfc9] bg-[#fffdf7] px-4 py-3 text-[14px] text-[#263832] outline-none focus:border-[#36534E]"
              />
            )}

            <button
              onClick={() => contextComplete && setStep("questions")}
              disabled={!contextComplete}
              className={`${primaryBtn} mt-6 w-full`}
            >
              질문 시작 <ArrowRight className="h-4 w-4" />
            </button>
            <p className="mt-3 text-center text-[12px] font-medium text-[#9a9188]">{WC_NO_RIGHT_ANSWER}</p>
          </div>
        )}

        {/* ── 문항 (한 화면 한 질문) ── */}
        {step === "questions" && current && (
          <div className={`${card} p-6 sm:p-8`}>
            {qIndex === firstHypoIndex && current.presentation === "hypothetical" && (
              <div className="mb-4 rounded-[14px] border border-[#d8bb86]/60 bg-[#fdf7ea] px-4 py-3">
                <p className="text-[13px] font-semibold text-[#9d6f36]">{WC_OPTIONAL_SECTION_TITLE}</p>
                <p className="mt-1 text-[12px] font-medium leading-relaxed text-[#8a7c5e]">{WC_HYPOTHETICAL_NOTE}</p>
              </div>
            )}
            <p className="font-serif-kr text-[19px] font-medium leading-[1.5] text-[#263832] sm:text-[21px]">
              {current.question}
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              {current.options.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => selectOption(current, opt.value)}
                  className={`rounded-[14px] border px-4 py-3.5 text-left text-[14px] font-medium leading-[1.6] transition-colors ${
                    answers[current.key] === opt.value
                      ? "border-[#36534E] bg-[#EEF4F1] text-[#263832]"
                      : "border-[#eadfc9] bg-white text-[#34445a] hover:border-[#36534E]/50 hover:bg-[#fffdf7]"
                  }`}
                >
                  {opt.label}
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
              {current.presentation === "hypothetical" && (
                <button onClick={() => skipCurrent(current)} className={ghostBtn}>
                  이 질문 건너뛰기
                </button>
              )}
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
            <h2 className="mb-4 font-serif-kr text-[20px] font-medium text-[#263832]">마지막으로, 자유롭게 남겨주세요</h2>
            {WC_FREE_TEXT_ITEMS.map((item) => (
              <div key={item.key} className="mb-4">
                <p className="mb-1.5 text-[13px] font-semibold text-[#34445a]">
                  {item.label} <span className="font-medium text-[#9a9188]">(선택)</span>
                </p>
                <textarea
                  value={freeText[item.key] ?? ""}
                  onChange={(e) => setFreeText((p) => ({ ...p, [item.key]: e.target.value }))}
                  rows={2}
                  maxLength={1000}
                  className="w-full resize-none rounded-xl border border-[#eadfc9] bg-[#fffdf7] px-4 py-3 text-[14px] leading-relaxed text-[#263832] outline-none focus:border-[#36534E]"
                />
              </div>
            ))}
            {error && <p className="mb-3 text-[13px] font-semibold text-red-500">{error}</p>}
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
      <p className="mb-2 text-[14px] font-semibold text-[#263832]">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors ${
              value === opt.value
                ? "border-[#36534E] bg-[#36534E] text-white"
                : "border-[#eadfc9] bg-white text-[#34445a] hover:border-[#b68a3a]"
            }`}
          >
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
      <h2 className="mb-1 font-serif-kr text-[20px] font-medium text-[#263832]">{title}</h2>
      <p className="mb-5 text-[12px] font-medium text-[#9a9188]">
        1 = {WC_SCALE_LABELS[0]} · 5 = {WC_SCALE_LABELS[4]} (선택 사항)
      </p>
      {items.map((item) => (
        <div key={item.key} className="mb-4">
          <p className="mb-2 text-[13px] font-semibold leading-relaxed text-[#34445a]">{item.label}</p>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => onChange(item.key, n)}
                aria-label={`${item.label} — ${n}점 (${WC_SCALE_LABELS[n - 1]})`}
                className={`h-10 flex-1 rounded-[10px] border text-[14px] font-semibold transition-colors ${
                  values[item.key] === n
                    ? "border-[#36534E] bg-[#36534E] text-white"
                    : "border-[#eadfc9] bg-white text-[#6d625a] hover:border-[#36534E]/50"
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
