"use client";

// 웨딩코드 v0.5 폼 — 16개 상황형 질문을 한 화면 한 질문으로 진행한다.
// 결과 화면에서 v0.5 score/report를 참고용으로 보여주며, 사람이나 관계를 단정하지 않는다.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Clock3, MessageCircle, ShieldCheck } from "lucide-react";
import {
  WEDDING_CODE_V05_QUESTIONS,
  WEDDING_CODE_V05_SCORING_VERSION,
  WEDDING_CODE_V05_VERSION,
  type WeddingCodeV05Question,
} from "@/constants/weddingCodeV05";
import { captureEvent } from "@/lib/analytics";
import { storeWcResultBackup, type WcResultBackup } from "./result/resultBackup";

type Step = "intro" | "questions" | "result";

type FlowQuestion = WeddingCodeV05Question;

const WC_V05_INTRO_TITLE = "웨딩 준비 순서 체크";
const WC_V05_INTRO_BODY = `결혼 준비에서는 둘 다 중요한데 무엇부터 볼지가 자주 달라져요.

16개 장면에서 실제로 먼저 손이 가는 쪽을 고르면, 조건·역할·가족 조율·도움의 순서를 네 가지로 정리해드려요. 정답이나 더 좋은 결과는 없고, 사람이나 관계의 앞날을 판단하지 않습니다.`;
const WC_NO_RIGHT_ANSWER =
  "둘 다 중요해도 괜찮아요. 지금 실제로 먼저 할 것에 더 가까운 쪽을 골라주세요.";

const card = "rounded-[18px] border border-[#eadfc9] bg-white/90 shadow-[0_10px_30px_rgba(8,22,38,0.05)]";
const primaryBtn =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#36534E] px-7 text-[14px] font-semibold text-white shadow-[0_12px_26px_rgba(54,83,78,0.2)] transition-colors hover:bg-[#2d4642] disabled:opacity-40 disabled:cursor-not-allowed";
const ghostBtn =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-[#eadfc9] bg-white px-5 text-[13px] font-semibold text-[#6d625a] transition-colors hover:bg-[#f7f3ec]";

const INTRO_POINTS = [
  { icon: Clock3, label: "약 3분", body: "16개 장면" },
  { icon: MessageCircle, label: "둘 중 하나", body: "먼저 할 쪽" },
  { icon: ShieldCheck, label: "기기 안", body: "완료 후 30일" },
] as const;

export default function WeddingCodeClient() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("intro");

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

  // 문항
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [qIndex, setQIndex] = useState(0);
  const advanceTimerRef = useRef<number | null>(null);
  const submittingRef = useRef(false);
  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  const flow: FlowQuestion[] = useMemo(() => [...WEDDING_CODE_V05_QUESTIONS], []);

  const current = flow[qIndex];
  useEffect(() => {
    return () => {
      if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
    };
  }, []);

  // 자동 전환으로 선택 버튼이 사라진 뒤에도 키보드·스크린리더의
  // 읽기 위치가 새 질문(또는 완료 확인)에 명확히 이어지게 한다.
  useEffect(() => {
    if (step === "questions") questionHeadingRef.current?.focus();
    else if (step === "result") resultHeadingRef.current?.focus();
  }, [qIndex, step]);

  function cancelPendingAdvance() {
    if (advanceTimerRef.current === null) return;
    window.clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = null;
  }

  function selectOption(q: FlowQuestion, value: string) {
    cancelPendingAdvance();
    setAnswers((prev) => ({ ...prev, [q.key]: value }));
    const selectedIndex = qIndex;
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      if (selectedIndex + 1 < flow.length) setQIndex(selectedIndex + 1);
      else setStep("result");
    }, 260);
  }

  function goBackFromQuestion() {
    cancelPendingAdvance();
    if (qIndex > 0) setQIndex((index) => index - 1);
    else setStep("intro");
  }

  function submit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const resultBackup: WcResultBackup = {
      answers,
      version: WEDDING_CODE_V05_VERSION,
      scoringVersion: WEDDING_CODE_V05_SCORING_VERSION,
      savedAt: new Date().toISOString(),
    };
    storeWcResultBackup(resultBackup);
    captureEvent("wedding_code_completed", {
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
          WEDDINGCODE · BETA
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
              aria-valuetext={`${answeredCount}개 응답 완료, 현재 ${qIndex + 1}/${flow.length} 문항`}
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

        {/* ── 인트로 ── */}
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
              <p className="rounded-[14px] border border-[#eadfc9] bg-[#fffdf7] px-4 py-3.5 text-[12px] font-medium leading-relaxed text-[#6d625a]">
                ‘내 결과 보기’를 누르면 16개 답변과 결과는 서버로 보내지 않고 이 브라우저에
                최대 30일 보관해요. 아직 사람 대상 검증 전인 베타 문항입니다.
              </p>
              <button
                onClick={() => {
                  captureEvent("wedding_code_started", { version: WEDDING_CODE_V05_VERSION });
                  setStep("questions");
                }}
                className={`${primaryBtn} mt-5 w-full`}
              >
                바로 시작하기 <ArrowRight className="h-4 w-4" />
              </button>
            </div>
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
            <h2
              ref={questionHeadingRef}
              tabIndex={-1}
              className="text-[19px] font-semibold leading-[1.5] text-[#263832] sm:text-[21px]"
            >
              {current.question}
            </h2>
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
            <p className="mt-4 text-[12px] font-medium leading-relaxed text-[#6d625a]">{WC_NO_RIGHT_ANSWER}</p>
            <div className="mt-4 flex items-center justify-between">
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
            <h2 ref={resultHeadingRef} tabIndex={-1} className="text-[20px] font-semibold text-[#263832]">
              16개 장면을 모두 골랐어요
            </h2>
            <p className="mt-2 rounded-[12px] bg-[#EEF4F1] px-4 py-3 text-[13px] font-medium leading-relaxed text-[#34445a]">
              선택은 서버로 보내지 않아요. 네 가지 준비 순서에서 무엇을 몇 번 먼저 골랐는지 이 브라우저에서 계산합니다.
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
