"use client";

// 웨딩코드 v0.5 폼 — 16개 상황형 질문을 한 화면 한 질문으로 진행한다.
// 결과 화면에서 v0.5 score/report를 참고용으로 보여주며, 사람이나 관계를 단정하지 않는다.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Clock3, MessageCircle, ShieldCheck } from "lucide-react";
import {
  WC_NO_RIGHT_ANSWER, WC_CONSENT_LABEL,
  WC_STAGES, WC_ANSWERING_MODES, WC_QUOTE_STATUSES, WC_PARENT_INVOLVEMENTS, WC_CONCERNS,
} from "@/constants/weddingCodeForm";
import {
  WEDDING_CODE_V05_QUESTIONS,
  WEDDING_CODE_V05_SCORING_VERSION,
  WEDDING_CODE_V05_VERSION,
  type WeddingCodeV05Question,
} from "@/constants/weddingCodeV05";
import { captureEvent } from "@/lib/analytics";
import { storeWcResultBackup, type WcResultBackup } from "./result/resultBackup";

type Step = "intro" | "context" | "questions" | "result";

type FlowQuestion = WeddingCodeV05Question;

const WC_V05_INTRO_TITLE = "웨딩코드 3분 테스트";
const WC_V05_INTRO_BODY = `결혼 준비를 하다 보면 예산, 취향, 가족 조율, 역할 분담, 서로에게 필요한 말의 순서가 한꺼번에 섞입니다.

웨딩코드는 16개의 실제 상황에서 내가 중요하게 보는 것을 정리하고, 상대와 더 편하게 이야기할 지점을 보여주는 참고 도구예요. 사람을 평가하거나 두 사람의 앞날을 단정하지 않습니다.`;

const card = "rounded-[18px] border border-[#eadfc9] bg-white/90 shadow-[0_10px_30px_rgba(8,22,38,0.05)]";
const primaryBtn =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#36534E] px-7 text-[14px] font-semibold text-white shadow-[0_12px_26px_rgba(54,83,78,0.2)] transition-colors hover:bg-[#2d4642] disabled:opacity-40 disabled:cursor-not-allowed";
const ghostBtn =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-[#eadfc9] bg-white px-5 text-[13px] font-semibold text-[#6d625a] transition-colors hover:bg-[#f7f3ec]";

const INTRO_POINTS = [
  { icon: Clock3, label: "3분", body: "16개 장면" },
  { icon: MessageCircle, label: "대화", body: "질문 카드" },
  { icon: ShieldCheck, label: "기기 안", body: "개인 결과" },
] as const;

export default function WeddingCodeClient() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("intro");
  const [consent, setConsent] = useState(false);

  // 과거 초대 링크의 bearer token은 더 이상 소비하지 않는다. URL에서
  // 즉시 제거해 referrer/공유/화면 캡처를 통한 추가 확산도 줄인다.
  const [removedLegacyInvite, setRemovedLegacyInvite] = useState(false);
  const legacyInviteDetectedRef = useRef(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("ct")) {
      legacyInviteDetectedRef.current = true;
      url.searchParams.delete("ct");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    if (!legacyInviteDetectedRef.current) return;
    const noticeTimer = window.setTimeout(() => setRemovedLegacyInvite(true), 0);
    return () => window.clearTimeout(noticeTimer);
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
  const [qIndex, setQIndex] = useState(0);
  const advanceTimerRef = useRef<number | null>(null);
  const submittingRef = useRef(false);

  const flow: FlowQuestion[] = useMemo(() => [...WEDDING_CODE_V05_QUESTIONS], []);

  const current = flow[qIndex];
  const contextAnswerCount = [stage, mode, quoteStatus, parentInvolvement].filter(Boolean).length;
  const contextMissingCount = 4 - contextAnswerCount;
  const contextComplete = contextMissingCount === 0;

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
    };
  }, []);

  function cancelPendingAdvance() {
    if (advanceTimerRef.current === null) return;
    window.clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = null;
  }

  function toggleConcern(c: string) {
    setConcerns((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function selectOption(q: FlowQuestion, value: string) {
    cancelPendingAdvance();
    setAnswers((prev) => ({ ...prev, [q.key]: value }));
    const selectedIndex = qIndex;
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      if (selectedIndex + 1 < flow.length) setQIndex(selectedIndex + 1);
      else setStep("result");
    }, 160);
  }

  function goBackFromQuestion() {
    cancelPendingAdvance();
    if (qIndex > 0) setQIndex((index) => index - 1);
    else setStep("context");
  }

  function submit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const resultBackup: WcResultBackup = {
      answers,
      skipped: {},
      version: WEDDING_CODE_V05_VERSION,
      scoringVersion: WEDDING_CODE_V05_SCORING_VERSION,
      responseId: null,
      paired: false,
      pairingStatus: "unpaired",
      coupleToken: null,
      savedAt: new Date().toISOString(),
    };
    storeWcResultBackup(resultBackup);
    captureEvent("wedding_code_completed", {
      stage,
      quote_status: quoteStatus,
      version: WEDDING_CODE_V05_VERSION,
    });
    router.replace("/wedding-code/result");
  }

  const answeredCount = flow.filter((q) => answers[q.key]).length;

  return (
    <div className="min-h-screen bg-[#fbf8f2] px-4 py-7 sm:py-12">
      <div className="mx-auto w-full max-w-[620px]">
        {/* 헤더 */}
        <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b5528]">
          WEDDINGCODE V0.5
        </p>
        <h1 className="mb-6 text-center text-[25px] font-semibold leading-[1.25] text-[#263832] sm:text-[30px]">
          {WC_V05_INTRO_TITLE}
        </h1>

        {/* 진행 바 (문항 단계에서만) */}
        {step === "questions" && flow.length > 0 && (
          <div className="mb-5">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-[#efe6d7]"
              role="progressbar"
              aria-label="웨딩코드 질문 진행률"
              aria-valuemin={0}
              aria-valuemax={flow.length}
              aria-valuenow={answeredCount}
            >
              <div
                className="h-full rounded-full bg-[#36534E] transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${Math.round((answeredCount / flow.length) * 100)}%` }}
              />
            </div>
            {/* 번호는 현재 위치 기준 — 뒤로가기로 재방문해도 보고 있는 문항과 일치 */}
            <p className="mt-1.5 text-right text-[12px] font-medium text-[#6d625a]">
              {qIndex + 1} / {flow.length}
            </p>
          </div>
        )}

        {/* ── 인트로 + 동의 ── */}
        {step === "intro" && (
          <div className={`${card} overflow-hidden`}>
            <div className="p-5 sm:p-8">
              <p className="text-[12px] font-semibold tracking-wide text-[#7b5528]">중요하게 보는 것을 정리해요</p>
              {removedLegacyInvite && (
                <div className="mt-3 rounded-[14px] border border-[#d8b8b2] bg-[#fff7f5] px-4 py-3.5" role="alert">
                  <p className="text-[13px] font-semibold text-[#7d4540]">커플 비교 기능을 안전 점검 중이에요</p>
                  <p className="mt-1 text-[12px] font-medium leading-relaxed text-[#6d625a]">
                    초대 정보는 URL에서 제거했어요. 지금은 서버로 답변을 보내지 않고 이 기기에서 개인 결과만 계산합니다.
                  </p>
                </div>
              )}
              <p className="mt-3 whitespace-pre-line text-[14px] font-medium leading-[1.75] text-[#34445a]">
                {WC_V05_INTRO_BODY}
              </p>
            </div>
            <div className="grid grid-cols-3 divide-x divide-[#eadfc9] border-y border-[#eadfc9] bg-[#fffdf7]">
              {INTRO_POINTS.map((point) => (
                <div key={point.label} className="min-w-0 px-3 py-3 text-center sm:px-5 sm:py-4">
                  <point.icon className="mx-auto h-4 w-4 text-[#36534E]" />
                  <div>
                    <p className="mt-1.5 text-[12px] font-semibold text-[#263832]">{point.label}</p>
                    <p className="mt-0.5 truncate text-[11px] font-medium leading-relaxed text-[#6d625a]">{point.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-5 sm:p-8">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-[14px] border border-[#eadfc9] bg-[#fffdf7] px-4 py-3.5 select-none">
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
            <div className="mb-6 rounded-[14px] bg-[#EEF4F1] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] font-semibold text-[#36534E]">기본 상황 {contextAnswerCount} / 4</p>
                <p className="text-[11px] font-semibold text-[#6d625a]">
                  {contextComplete ? "질문으로 넘어갈 수 있어요" : `${contextMissingCount}개 더 선택`}
                </p>
              </div>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-white"
                role="progressbar"
                aria-label="기본 상황 응답 진행률"
                aria-valuemin={0}
                aria-valuemax={4}
                aria-valuenow={contextAnswerCount}
              >
                <div
                  className="h-full rounded-full bg-[#36534E] transition-[width] motion-reduce:transition-none"
                  style={{ width: `${(contextAnswerCount / 4) * 100}%` }}
                />
              </div>
            </div>
            <ContextSelect label="지금 결혼 준비 단계는 어디에 가장 가깝나요?" options={WC_STAGES} value={stage} onChange={setStage} />
            <ContextSelect label="답변은 혼자 하고 있나요, 상대와 함께 하고 있나요?" options={WC_ANSWERING_MODES} value={mode} onChange={setMode} />
            <ContextSelect label="업체 비용표를 받아본 적이 있나요?" options={WC_QUOTE_STATUSES} value={quoteStatus} onChange={setQuoteStatus} />
            <ContextSelect label="부모님 또는 가족이 결혼 준비 결정에 어느 정도 관여하고 있나요?" options={WC_PARENT_INVOLVEMENTS} value={parentInvolvement} onChange={setParentInvolvement} />

            <p className="mb-2 mt-6 text-[14px] font-semibold text-[#263832]">
              지금 가장 큰 결혼 준비 고민은 무엇인가요? <span className="font-medium text-[#6d625a]">(복수 선택)</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {WC_CONCERNS.map((c) => (
                <button
                  key={c}
                  onClick={() => toggleConcern(c)}
                  aria-pressed={concerns.includes(c)}
                  className={`min-h-11 rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors ${
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
                maxLength={200}
                aria-label="기타 결혼 준비 고민"
                placeholder="기타 고민을 적어주세요"
                className="mt-3 w-full rounded-xl border border-[#eadfc9] bg-[#fffdf7] px-4 py-3 text-[14px] text-[#263832] outline-none focus:border-[#36534E]"
              />
            )}

            <button
              onClick={() => contextComplete && setStep("questions")}
              disabled={!contextComplete}
              className={`${primaryBtn} mt-6 w-full`}
            >
              {contextComplete ? "질문 시작" : `${contextMissingCount}개 더 선택하면 시작`} <ArrowRight className="h-4 w-4" />
            </button>
            <p className="mt-3 text-center text-[12px] font-medium text-[#6d625a]">{WC_NO_RIGHT_ANSWER}</p>
          </div>
        )}

        {/* ── 문항 (한 화면 한 질문) ── */}
        {step === "questions" && current && (
          <div className={`${card} p-6 sm:p-8`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[12px] font-semibold tracking-wide text-[#7b5528]">{current.title}</p>
              <p className="rounded-full bg-[#EEF4F1] px-2.5 py-1 text-[11px] font-semibold text-[#36534E]">
                {qIndex + 1} / {flow.length}
              </p>
            </div>
            <p className="text-[19px] font-semibold leading-[1.5] text-[#263832] sm:text-[21px]">
              {current.question}
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              {current.options.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => selectOption(current, opt.value)}
                  aria-pressed={answers[current.key] === opt.value}
                  className={`flex items-start gap-3 rounded-[14px] border px-4 py-3.5 text-left text-[14px] font-medium leading-[1.6] transition-colors ${
                    answers[current.key] === opt.value
                      ? "border-[#36534E] bg-[#EEF4F1] text-[#263832]"
                      : "border-[#eadfc9] bg-white text-[#34445a] hover:border-[#36534E]/50 hover:bg-[#fffdf7]"
                  }`}
                >
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    answers[current.key] === opt.value ? "border-[#36534E] bg-[#36534E] text-white" : "border-[#d8c9ad] bg-[#fffdf7]"
                  }`}>
                    {answers[current.key] === opt.value && <Check className="h-3 w-3" />}
                  </span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between">
              <button
                onClick={goBackFromQuestion}
                className={ghostBtn}
              >
                <ArrowLeft className="h-3.5 w-3.5" /> 이전
              </button>
            </div>
          </div>
        )}

        {/* ── 로컬 결과 계산 ── */}
        {step === "result" && (
          <div className={`${card} p-6 sm:p-8`}>
            <h2 className="text-[20px] font-semibold text-[#263832]">개인 결과를 확인할 준비가 됐어요</h2>
            <p className="mt-2 rounded-[12px] bg-[#EEF4F1] px-4 py-3 text-[13px] font-medium leading-relaxed text-[#34445a]">
              16개 선택은 서버에 수집하지 않고 이 브라우저에서만 결과 카드로 계산해요.
            </p>
            <div className="mt-5 flex items-center justify-between gap-3">
              <button onClick={() => setStep("questions")} className={ghostBtn}>
                <ArrowLeft className="h-3.5 w-3.5" /> 이전
              </button>
              <button onClick={submit} className={`${primaryBtn} flex-1`}>
                <Check className="h-4 w-4" /> 내 결과 보기
              </button>
            </div>
          </div>
        )}

        {/* 로컬 계산 완료 시 /wedding-code/result 로 이동 */}
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
            aria-pressed={value === opt.value}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors ${
              value === opt.value
                ? "border-[#36534E] bg-[#36534E] text-white"
                : "border-[#eadfc9] bg-white text-[#34445a] hover:border-[#b68a3a]"
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
