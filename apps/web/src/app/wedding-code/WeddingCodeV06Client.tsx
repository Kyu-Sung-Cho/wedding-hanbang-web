"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, RotateCcw } from "lucide-react";

import { captureWeddingCodeEvent } from "@/lib/analytics";
import { encodeWeddingCodeV06 } from "@/lib/weddingCode/v06/code";
import {
  answeredCount,
  buildWeddingCodeV06GapMap,
  describeGap,
  topGapsForDisplay,
  type WeddingCodeV06Answers,
  type WeddingCodeV06GapMap,
} from "@/lib/weddingCode/v06/gap";
import {
  CURRENT_WEDDING_CODE_SCENE_CONFIG,
  weddingCodeSceneConfigForExactVersion,
  weddingCodeSceneCountLabel,
  type WeddingCodeSceneConfig,
  type WeddingCodeSceneVersion,
} from "@/lib/weddingCode/scene/config";
import {
  buildWeddingCodeSelfProfile,
  describeSelfAxisAbsence,
  describeSelfAxisReading,
  type WeddingCodeSelfProfile,
} from "@/lib/weddingCode/scene/selfProfile";
import {
  buildWeddingCodeCoupleCombination,
} from "@/lib/weddingCode/profile/amoraBridge";
import AmoraStyleConfirmation from "./AmoraStyleConfirmation";
import ResearchContributionCard, { ResearchContributionDeleteForm } from "./ResearchContributionCard";
import {
  WEDDING_CODE_RESEARCH_RETENTION_DAYS,
  isWeddingCodeResearchSceneVersion,
} from "@/lib/weddingCode/contribution/contract";
import Button from "@/components/ui/Button";
import {
  buildWeddingCodeLetters,
  compareWeddingCodeLetters,
  type WeddingCodeLetters,
} from "@/lib/weddingCode/profile/letters";
import {
  WEDDING_CODE_TIP_LABELS,
  weddingCodeQualifierLine,
} from "@/constants/weddingCodeSelfReading";
import WeddingCodeBadge from "./WeddingCodeBadge";
import {
  buildWeddingCodeShareUrl,
  decodeWeddingCodeShareHash,
} from "@/lib/weddingCode/scene/link";

const surface = "rounded-[6px] border border-[var(--hb-hairline)] bg-white";
const primaryButton =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-action)] px-6"
  + " text-[15px] font-semibold text-white transition-colors duration-150 ease-out"
  + " hover:bg-[var(--hb-action-hover)] focus-visible:outline-none focus-visible:ring-2"
  + " focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2"
  + " disabled:cursor-not-allowed disabled:opacity-40";
const secondaryButton =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[6px] border"
  + " border-[#C7D1C2] bg-white px-5 text-[14px] font-semibold text-[var(--hb-text-strong)]"
  + " transition-colors duration-150 ease-out hover:bg-[var(--hb-surface-hover)] focus-visible:outline-none"
  + " focus-visible:ring-2 focus-visible:ring-[var(--hb-primary)] focus-visible:ring-offset-2";

type Step = "intro" | "quiz" | "result";

/**
 * 웨딩코드 v0.6.
 *
 * ## v0.5와 무엇이 다른가
 *
 * - **결과가 판정이 아니다.** 유형·점수·궁합을 만들지 않는다. 두 사람이 실제로 고른 문장을
 *   그대로 붙여 보여주고, 다음 대화 절차만 제안한다. 심리검사 타당도를 주장하지 않지만
 *   문항 이해도와 대화 유용성은 사람 검증이 필요하다.
 * - **로그인·저장·대기가 없다.** 답 16개를 링크에 싣는다. v0.5는 커플 연동 → DB 저장 →
 *   상대 응답 대기 순서였고, 대부분이 「아직 상대 응답을 기다리고 있어요」에서 끝났다.
 * - **내 답을 인용한다.** v0.5의 개인 결과는 하드코딩 문장 중 하나를 보여줄 뿐 사용자가
 *   고른 문구를 한 번도 쓰지 않았다.
 *
 * 별도 DB 저장은 하지 않는다. 공유할 때 답이 URL에 포함되므로 링크 보관 범위는 사용자가
 * 직접 결정할 수 있게 화면에서 분명히 알린다.
 */
export default function WeddingCodeV06Client({
  shareOrigin,
  version,
  partnerAnswers,
  partnerCode,
  bothCodes,
  researchContributionOpen = false,
  researchStorageActive = false,
}: {
  shareOrigin: string;
  version: WeddingCodeSceneVersion;
  /** 답 익명 보태기를 받을 수 있는가(서버 플래그·비밀값). 닫혀 있으면 카드도 폼도 없다. */
  researchContributionOpen?: boolean;
  /** 받은 답을 지키는 중인가(삭제 폼·안내). 새 답을 받지 않게 된 뒤에도 켜져 있다. */
  researchStorageActive?: boolean;
  /** 링크로 먼저 온 상대 답. 없으면 내가 먼저 푸는 것이다. */
  partnerAnswers: WeddingCodeV06Answers | null;
  partnerCode: string | null;
  /** 두 사람 코드가 모두 URL에 있으면 응답 순서가 고정된 차이 지도를 연다. */
  bothCodes: { first: WeddingCodeV06Answers; second: WeddingCodeV06Answers } | null;
}) {
  const [activeVersion, setActiveVersion] = useState(version);
  const [linkContext, setLinkContext] = useState({
    partnerAnswers,
    partnerCode,
    bothCodes,
  });
  const config = weddingCodeSceneConfigForExactVersion(activeVersion);
  const questions = config.questions;
  const [step, setStep] = useState<Step>(bothCodes ? "result" : "intro");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<WeddingCodeV06Answers>(bothCodes?.second ?? {});
  /** 건너뛴 문항. 아직 안 본 문항과 구분해야 「다음」을 열어줄 수 있다. */
  const [skipped, setSkipped] = useState<readonly string[]>([]);
  const [copied, setCopied] = useState(false);
  const [linkError, setLinkError] = useState(false);
  /**
   * 이번 방문에서 문항을 직접 풀어 결과에 왔는가. 두 사람 링크로 바로 열린 비교 화면의
   * 「나중에 답한 사람」 답은 이 방문자의 답이라는 보장이 없어 보태기 대상이 아니다.
   */
  const [answeredHere, setAnsweredHere] = useState(false);

  const theirs = linkContext.bothCodes?.first ?? linkContext.partnerAnswers;
  const done = answeredCount(answers, questions);
  const sceneCount = weddingCodeSceneCountLabel(questions.length);
  /**
   * 이 판으로 푼 답을 결과 화면에서 보탤 수 있는가. 서버 스위치만 보면 안 된다 — 옛 v0.6
   * 링크로 들어온 사람에게는 카드가 뜨지 않는데, 첫 화면은 「결과 화면에서 보탤 수 있다」고
   * 말하고 있었다. 없는 버튼을 설명하지 않는다.
   */
  const contributionAvailable = researchContributionOpen && isWeddingCodeResearchSceneVersion(activeVersion);

  /**
   * 흐름 기록. 답 글자·코드·링크는 싣지 않고 몇 번째 장면까지 왔는지와 개수만 보낸다.
   * 「몇 번째에서 멈췄나」가 목적이라 뒤로 갔다 다시 온 장면은 두 번 세지 않는다.
   */
  const furthestSceneRef = useRef(-1);
  const previousStepRef = useRef<Step | null>(null);
  const hasPartnerLink = Boolean(theirs);
  useEffect(() => {
    const previous = previousStepRef.current;
    previousStepRef.current = step;
    if (previous === step) return;
    const base = { version: activeVersion, has_partner_link: hasPartnerLink };
    if (step === "intro") {
      furthestSceneRef.current = -1;
      captureWeddingCodeEvent("wedding_code_intro_viewed", base);
    } else if (step === "result") {
      if (previous === "quiz") {
        const answered = answeredCount(answers, questions);
        captureWeddingCodeEvent("wedding_code_completed", {
          ...base,
          scene_total: questions.length,
          answered_count: answered,
          skipped_count: questions.length - answered,
        });
      } else {
        captureWeddingCodeEvent("wedding_code_comparison_viewed", base);
      }
    }
  }, [activeVersion, answers, hasPartnerLink, questions, step]);
  useEffect(() => {
    if (step !== "quiz" || index <= furthestSceneRef.current) return;
    furthestSceneRef.current = index;
    captureWeddingCodeEvent("wedding_code_scene_reached", {
      version: activeVersion,
      has_partner_link: hasPartnerLink,
      scene_index: index + 1,
      scene_total: questions.length,
    });
  }, [activeVersion, hasPartnerLink, index, questions.length, step]);

  useEffect(() => {
    const clearLinkState = () => {
      setLinkContext({ partnerAnswers: null, partnerCode: null, bothCodes: null });
      setActiveVersion(CURRENT_WEDDING_CODE_SCENE_CONFIG.version);
      setAnswers({});
      setSkipped([]);
      setAnsweredHere(false);
      setStep("intro");
      setIndex(0);
      setCopied(false);
    };
    const applyShareHash = (event?: Event) => {
      const decodedHash = decodeWeddingCodeShareHash(window.location.hash);
      if (!decodedHash) {
        if (event || window.location.hash) {
          clearLinkState();
          setLinkError(Boolean(window.location.hash));
        }
        return false;
      }
      setLinkError(false);
      setActiveVersion(decodedHash.version);
      setLinkContext({
        partnerAnswers: decodedHash.partnerAnswers,
        partnerCode: decodedHash.partnerCode,
        bothCodes: decodedHash.bothCodes,
      });
      setAnswers(decodedHash.bothCodes?.second ?? {});
      setSkipped([]);
      setAnsweredHere(false);
      setStep(decodedHash.bothCodes ? "result" : "intro");
      setIndex(0);
      setCopied(false);
      return true;
    };

    window.addEventListener("hashchange", applyShareHash);
    if (applyShareHash()) {
      if (window.location.search) {
        window.history.replaceState(
          null,
          "",
          `${window.location.origin}${window.location.pathname}${window.location.hash}`,
        );
      }
      return () => window.removeEventListener("hashchange", applyShareHash);
    }

    // 예전 ?a=&b= 링크는 한 번 연 뒤 fragment로 바꿔 후속 분석·referrer 노출을 줄인다.
    if (window.location.search) {
      const initialConfig = weddingCodeSceneConfigForExactVersion(version);
      const privateUrl = partnerCode
        ? buildWeddingCodeShareUrl({
          origin: window.location.origin,
          version,
          firstCode: partnerCode,
          secondCode: bothCodes
            ? encodeWeddingCodeV06(bothCodes.second, initialConfig.questions)
            : null,
        })
        : `${window.location.origin}${window.location.pathname}`;
      window.history.replaceState(null, "", privateUrl);
    }
    return () => window.removeEventListener("hashchange", applyShareHash);
  }, [bothCodes, partnerCode, version]);

  function restart() {
    // 반송된 비교 링크만으로 어느 응답이 현재 방문자의 것인지는 알 수 없다.
    // 새 응답은 이전 두 사람의 문맥과 주소를 함께 비워 시작한다.
    captureWeddingCodeEvent("wedding_code_restarted", { version: activeVersion });
    setLinkContext({ partnerAnswers: null, partnerCode: null, bothCodes: null });
    // 상대 링크를 비웠으니 옛 판에 머물 이유가 없다. 예전에는 옛 링크로 들어왔다가
    // 「새 응답 시작하기」를 눌러도 옛 판 문항을 다시 풀었다.
    setActiveVersion(CURRENT_WEDDING_CODE_SCENE_CONFIG.version);
    window.history.replaceState(null, "", window.location.pathname);
    setStep("intro");
    setIndex(0);
    setAnswers({});
    setSkipped([]);
    setAnsweredHere(false);
    setCopied(false);
    setLinkError(false);
  }

  if (linkError) {
    return <Shell><section className={`${surface} px-5 py-7`} role="alert">
      <h1 className="text-xl font-semibold text-[var(--hb-text-strong)]">이 결과 링크를 확인하지 못했어요</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--hb-text-body)]">지원하지 않는 버전이거나 답이 손상된 링크예요. 보낸 사람에게 링크를 다시 받거나 새로 시작해 주세요.</p>
      <Button className="mt-5" onClick={restart}>새 응답 시작하기</Button>
    </section></Shell>;
  }

  if (step === "result") {
    return (
      <Shell>
        <ResultView
          key={`${activeVersion}:${encodeWeddingCodeV06(theirs ?? {}, questions)}:${encodeWeddingCodeV06(answers, questions)}`}
          answers={answers}
          theirs={theirs}
          config={config}
          shareOrigin={shareOrigin}
          partnerCode={linkContext.partnerCode}
          copied={copied}
          onCopied={setCopied}
          onRestart={restart}
          researchContribution={contributionAvailable && answeredHere}
        />
      </Shell>
    );
  }

  if (step === "intro") {
    return (
      <Shell>
        <section className={`${surface} overflow-hidden`}>
          <div className="bg-[var(--hb-primary)] px-5 py-8 text-white sm:px-8">
            <p className="text-[12px] font-semibold text-[var(--hb-on-primary)]">웨딩코드</p>
            <h1 className="mt-3 text-[26px] font-semibold leading-[1.35] sm:text-[30px]">
              {theirs
                ? "먼저 답한 사람이 링크를 보냈어요"
                : `결혼 준비 ${sceneCount} 장면, 나라면?`}
            </h1>
            <p className="mt-4 text-[15px] font-medium leading-[1.7] text-[var(--hb-on-primary)]">
              {theirs
                ? `나도 같은 ${sceneCount} 장면에 답하면 둘이 어디서 갈리는지 바로 볼 수 있어요.`
                : "돈을 쓸 때, 할 일을 나눌 때, 가족과 함께 정할 때, 둘 다 지친 날. 준비하다 한 번쯤 겪는 장면마다 나라면 어떻게 할지 골라 보세요."}
            </p>
          </div>

          <div className="space-y-3 px-5 py-6 sm:px-8">
            {[
              "끝까지 가면 내가 고른 문장과 그 답을 줄인 네 글자를 보여줘요. 성격이나 궁합을 판정하는 검사는 아니에요.",
              "상대도 답하면 둘의 답이 갈린 장면을 나란히 놓아 줘요.",
              "우리와 안 맞거나 아직 답하기 어려운 장면은 건너뛸 수 있어요. 건너뛴 장면은 짐작해서 채우지 않아요.",
            ].map((line) => (
              <p key={line} className="flex gap-2.5 text-[14px] font-medium leading-[1.6] text-[var(--hb-text-strong)]">
                <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--hb-success)]" />
                {line}
              </p>
            ))}
          </div>
          {/*
            안내 문단은 법적 뜻을 지는 문장이다. 말투만 풀고 뜻은 바꾸지 않는다.
            - 브라우저에는 동의와 상관없이 답을 남기지 않는다(그래서 새로고침하면 사라진다).
            - 서버에는 결과 화면에서 직접 동의한 경우에만 저장한다 — **이 판으로 푼 답을 실제로
              보탤 수 있을 때만** 그렇게 말한다(`contributionAvailable`). 옛 v0.6 링크나 수집을
              멈춘 뒤에는 카드가 뜨지 않으니 「보태기」를 약속하지 않는다.
            - 이용 통계 적용일은 `WEDDING_CODE_FUNNEL_ANALYTICS_EFFECTIVE_AT` 과 같은 글자여야 한다
              (analyticsPrivacy.test 가 본다). 항목 전부는 처리방침 제3조에 있다.
          */}
          <details className="border-t border-[var(--hb-hairline)] px-5 py-4 sm:px-8">
            <summary className="cursor-pointer py-2 text-sm font-semibold text-[var(--hb-text-strong)]">답하기 전에 알아둘 것</summary>
            <p className="mt-2 text-sm leading-relaxed text-[var(--hb-text-body)]">금액과 상황은 예시예요. 아직 겪지 않은 장면은 지금 나라면 뭘 고를지 답하거나 건너뛰면 돼요. 부모님·하객·결혼식이 없는 경우에도 그런 장면은 건너뛰어도 괜찮아요.</p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--hb-text-body)]">
              {contributionAvailable
                ? "로그인 없이 쓸 수 있어요. 고른 답은 브라우저에 남기지 않아서 새로고침하면 사라져요. 서버에도 저장하지 않고, 결과 화면에서 '내 답 보태기'에 직접 동의한 경우에만 저장해요. 공유 링크에는 내 답이 담기니 같이 비교할 사람에게만 보내 주세요."
                : "로그인 없이 쓸 수 있어요. 고른 답은 브라우저에 남기지 않아서 새로고침하면 사라지고, 서버에도 저장하지 않아요. 공유 링크에는 내 답이 담기니 같이 비교할 사람에게만 보내 주세요."}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--hb-text-body)]">
              2026년 9월 24일부터는 화면을 고치려고 이용 통계를 남겨요. 시작했는지, 몇 번째 장면까지 봤는지, 끝까지 했는지, 공유했는지 같은 흐름만 남기고, 어떤 답을 골랐는지·네 글자 결과·공유 링크 주소는 넣지 않아요. 남기는 항목 전부는{" "}
              <a href="/privacy" className="font-semibold text-[var(--hb-text-strong)] underline underline-offset-4">개인정보 처리방침</a>
              에 있어요.
            </p>
            {researchStorageActive ? (
              <p className="mt-2 text-sm leading-relaxed text-[var(--hb-text-body)]">
                {contributionAvailable
                  ? `동의하고 보낸 답은 이름·계정 없이 ${WEDDING_CODE_RESEARCH_RETENTION_DAYS}일 동안 보관하고, 질문을 고치는 데만 써요. 동의하지 않으면 아무것도 보내지 않아요.`
                  : `지금 이 질문으로는 답 보태기를 받지 않아요. 전에 보낸 답은 보낸 날부터 ${WEDDING_CODE_RESEARCH_RETENTION_DAYS}일이 지나면 자동으로 지워지고, 그 전에 지우고 싶으면 아래에 삭제 코드를 넣으면 돼요.`}
              </p>
            ) : null}
          </details>
          {researchStorageActive ? <ResearchContributionDeleteForm /> : null}
        </section>

        <button
          type="button"
          onClick={() => {
            captureWeddingCodeEvent("wedding_code_started", {
              version: activeVersion,
              has_partner_link: hasPartnerLink,
            });
            setStep("quiz");
          }}
          className={`${primaryButton} mt-5 w-full`}
        >
          {theirs ? "나도 답해보기" : "시작하기"}
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </button>
        <p className="mt-3 text-center text-[13px] font-medium text-[var(--color-rose-700)]">
          {sceneCount} 문항 · 로그인 없이 바로
        </p>
        {!theirs ? <WeddingTasteEntry placement="intro" /> : null}
      </Shell>
    );
  }

  const question = questions[index];
  const picked = answers[question.key];
  const last = index === questions.length - 1;
  const skippedHere = skipped.includes(question.key);

  function goNext() {
    if (last) {
      setAnsweredHere(true);
      setStep("result");
    } else {
      setIndex((value) => Math.min(questions.length - 1, value + 1));
    }
  }

  /**
   * 우리와 안 맞는 장면은 건너뛴다.
   *
   * 부모님이 안 계시거나, 결혼식을 하지 않거나, 사진 촬영을 안 하는 사람에게 네 개 중
   * 하나를 억지로 고르게 하면 두 가지가 동시에 일어난다 — 화면 앞에서 불편해지고,
   * 고르지도 않은 답이 결과와 아모라 제안에 실린다. 건너뛴 문항은 답에서 빠지고
   * 공유 코드에도 미응답(`-`)으로 남는다.
   */
  function skipQuestion() {
    setAnswers((previous) => {
      const next = { ...previous };
      delete next[question.key];
      return next;
    });
    setSkipped((previous) =>
      previous.includes(question.key) ? previous : [...previous, question.key],
    );
    goNext();
  }

  return (
    <Shell>
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          aria-label="이전 문항"
          disabled={index === 0}
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
          className={`${secondaryButton} px-4 disabled:opacity-30`}
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        </button>
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EFE4D7]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={questions.length}
          aria-valuenow={done}
          aria-valuetext={`${sceneCount} 장면 중 ${done}장면에 답했어요`}
        >
          <div
            data-progress={done}
            className="h-full rounded-full bg-[var(--hb-primary)] transition-[width] duration-200"
            style={{ width: `${(done / questions.length) * 100}%` }}
          />
        </div>
        <p className="text-[13px] font-semibold tabular-nums text-[var(--color-rose-700)]">
          {index + 1}/{questions.length}
        </p>
      </div>

      <section className={`${surface} overflow-hidden`} data-question={question.key}>
        <div className="border-b border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] px-5 py-5 sm:px-8">
          <p className="text-[16px] font-semibold leading-[1.55] text-[var(--hb-text-strong)]">
            {question.scene}
          </p>
          <p className="mt-2 text-[14px] font-medium text-[var(--color-rose-700)]">{question.question}</p>
        </div>

        <div className="divide-y divide-[var(--hb-hairline)]">
          {question.options.map((option) => {
            const selected = picked === option.value;
            return (
              <button
                key={option.value}
                type="button"
                data-option={option.value}
                aria-pressed={selected}
                onClick={() => {
                  setAnswers((previous) => ({ ...previous, [question.key]: option.value }));
                }}
                className={`flex min-h-[64px] w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--hb-primary)] sm:px-8 ${
                  selected ? "bg-[var(--hb-surface-hover)]" : "bg-white hover:bg-[var(--hb-surface-page)]"
                }`}
              >
                <span className="text-[16px] font-semibold leading-[1.5] text-[var(--hb-text-strong)]">
                  {option.label}
                </span>
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                    selected ? "border-[var(--hb-selected-line)] bg-[var(--hb-selected-bg)] text-[var(--hb-selected-text)]" : "border-[#C7D1C2]"
                  }`}
                >
                  {selected ? <Check className="h-4 w-4" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <button
        type="button"
        // 마지막 문항에서도 답 하나만 있으면 결과를 연다. 열여섯 개를 다 채워야만
        // 볼 수 있게 하면, 안 맞는 장면에서 아무거나 고르게 만드는 것과 같다.
        disabled={last ? done === 0 : !picked && !skippedHere}
        onClick={goNext}
        className={`${primaryButton} mt-5 w-full`}
      >
        {last ? "결과 보기" : "다음 문항"}
        <ArrowRight aria-hidden="true" className="h-4 w-4" />
      </button>

      <button
        type="button"
        data-skip-question={question.key}
        onClick={skipQuestion}
        className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-[6px] px-4 text-[13px] font-medium text-[var(--color-rose-700)] underline underline-offset-4 transition-colors hover:text-[var(--hb-text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-primary)]"
      >
        이 장면은 우리와 안 맞아요 — 건너뛰기
      </button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-[var(--hb-surface-page)] px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-[560px]">{children}</div>
    </main>
  );
}

function ResultView({
  answers,
  theirs,
  config,
  shareOrigin,
  partnerCode,
  copied,
  onCopied,
  onRestart,
  researchContribution,
}: {
  researchContribution: boolean;
  answers: WeddingCodeV06Answers;
  theirs: WeddingCodeV06Answers | null;
  config: WeddingCodeSceneConfig;
  shareOrigin: string;
  partnerCode: string | null;
  copied: boolean;
  onCopied: (value: boolean) => void;
  onRestart: () => void;
}) {
  const [showAllGaps, setShowAllGaps] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const canShare = answeredCount(answers, config.questions) > 0;
  const mineCode = encodeWeddingCodeV06(answers, config.questions);
  // 보태는 것은 이 방문자가 방금 고른 답(mineCode)뿐이다. 상대 코드는 넘기지 않는다.
  const contributionCard = researchContribution && isWeddingCodeResearchSceneVersion(config.version)
    ? <ResearchContributionCard answerCode={mineCode} sceneVersion={config.version} />
    : null;
  // 상대 답이 이미 있으면 둘 다 담아 돌려준다 — 그래야 상대도 같은 화면을 본다.
  const shareUrl = buildWeddingCodeShareUrl({
    origin: shareOrigin,
    version: config.version,
    firstCode: theirs && partnerCode ? partnerCode : mineCode,
    secondCode: theirs && partnerCode ? mineCode : null,
  });

  // 코드가 나온 사람은 링크만 보내는 것보다 「나 VTuH야」가 먼저 나가는 게 자연스럽다.
  const shareLetters = buildWeddingCodeLetters(
    buildWeddingCodeSelfProfile(answers, { questions: config.questions, axes: config.axes }),
  );
  const shareText = theirs
    ? `두 사람이 답한 장면을 나란히 보는 웨딩코드 결과예요.\n${shareUrl}`
    : shareLetters.complete
    ? `내 웨딩코드는 ${shareLetters.code}예요. 같은 ${weddingCodeSceneCountLabel(config.questions.length)} 장면에 답해볼래요?
${shareUrl}`
    : shareUrl;

  const copyButton = !canShare ? (
    <p className="mt-5 text-sm leading-relaxed text-[var(--hb-text-body)]">내 답이 없어 비교 결과를 공유할 수 없어요. 한 장면 이상 답한 뒤 다시 비교해 주세요.</p>
  ) : (
    <div className="mt-5">
      <button
        type="button"
        data-share-url={shareUrl}
        data-share-text={shareText}
        onClick={async () => {
          try {
            if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
            await navigator.clipboard.writeText(shareText);
            onCopied(true);
            setCopyError(false);
            captureWeddingCodeEvent("wedding_code_share_copied", {
              version: config.version,
              result_kind: theirs ? "couple" : "solo",
            });
          } catch {
            onCopied(false);
            setCopyError(true);
          }
        }}
        className={`${primaryButton} w-full`}
      >
        {copied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
        {copied ? "복사했어요" : theirs ? "결과 링크 복사하기" : "내 코드와 링크 보내기"}
      </button>
      <p className="mt-2 text-[12px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
        {theirs
          ? "링크에는 두 사람의 답이 포함돼요. 답을 함께 비교한 두 사람 사이에서만 보내 주세요."
          : "링크에는 내 답이 포함돼요. 함께 비교할 사람에게만 보내 주세요."}
      </p>
      {copyError ? <p role="alert" className="mt-3 text-sm text-[var(--hb-text-body)]">자동 복사가 안 됐어요. 아래에서 링크 주소를 직접 복사해 주세요.</p> : null}
      <details className="mt-3 text-sm text-[var(--hb-text-body)]" open={copyError || undefined}>
        <summary className="cursor-pointer py-2 underline underline-offset-4">링크 주소 직접 복사하기</summary>
        <input aria-label="웨딩코드 공유 링크" readOnly value={shareUrl} onFocus={event => event.currentTarget.select()} className="mt-2 min-h-12 w-full rounded-[6px] border border-[var(--hb-hairline)] bg-white px-3 text-sm" />
      </details>
    </div>
  );

  if (!theirs) {
    const profile = buildWeddingCodeSelfProfile(answers, {
      questions: config.questions,
      axes: config.axes,
    });

    /**
     * 열여섯 장면을 모두 건너뛴 경우.
     *
     * 빈 결과 카드 네 장을 보여주면 「아무것도 안 한 사람」처럼 읽힌다. 게다가 답이
     * 하나도 없는 코드는 유효한 링크가 아니어서(`decodeWeddingCodeV06`가 거절한다)
     * 공유 버튼을 그대로 두면 열리지 않는 링크를 보내게 된다.
     */
    if (profile.answered === 0) {
      return (
        <>
          <section className={`${surface} px-6 py-7`} data-result="solo" data-empty="">
            <h1 className="text-[20px] font-semibold leading-[1.45] text-[var(--hb-text-strong)]">
              {weddingCodeSceneCountLabel(config.questions.length)} 장면을 모두 건너뛰셨어요
            </h1>
            <p className="mt-3 text-[14px] font-medium leading-[1.7] text-[var(--hb-text-strong)]">
              우리 상황과 맞는 장면이 없었다면 그대로 두셔도 괜찮아요. 답을 지어내는 것보다
              비워두는 편이 나아요. 한 장면만 답해도 그 주제는 읽어드릴 수 있어요.
            </p>
          </section>
          <button type="button" onClick={onRestart} className={`${secondaryButton} mt-4 w-full`}>
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            다시 보기
          </button>
        </>
      );
    }

    const letters = buildWeddingCodeLetters(profile);
    return (
      <>
        <WeddingCodeBadge letters={letters} />

        <section className={`${surface} mt-4 overflow-hidden`} data-result="solo">
          <div className="bg-[var(--hb-primary)] px-5 py-7 text-white sm:px-8">
            <p className="text-[12px] font-semibold text-[var(--hb-on-primary)]">웨딩코드</p>
            <h1 className="mt-3 text-[24px] font-semibold leading-[1.35] sm:text-[28px]">
              내가 이번에 고른 것
            </h1>
            <p className="mt-3 text-[15px] font-medium leading-[1.65] text-[var(--hb-on-primary)]">
              답한 {profile.answered}장면을 주제별로 정리했어요. 많이 고른 답이 가장 중요한 취향이라는 뜻은 아니에요.
            </p>
            <p className="mt-3 text-[13px] font-medium leading-[1.6] text-[var(--hb-on-primary)]">
              더 좋은 답도 부족한 답도 없어요. 고른 답을 세어서 그대로 보여줄 뿐이고, 유형을
              붙이거나 점수를 매기지 않아요.
              {profile.answered < profile.total
                ? ` 답한 ${profile.answered}장면만 셌고, 건너뛴 장면은 비워뒀어요.`
                : ""}
            </p>
          </div>

          <div className="divide-y divide-[var(--hb-hairline)]">
            {profile.axes.map((reading) => {
              const absence = describeSelfAxisAbsence(reading);
              const qualifierLine = weddingCodeQualifierLine(reading.qualifiers);
              // 건너뛴 주제에 카피를 붙이면 고르지도 않은 답을 읽어주는 것이 된다.
              if (reading.answered === 0) {
                return (
                  <article key={reading.axis} data-self-axis={reading.axis} data-skipped="" className="px-5 py-5 sm:px-8">
                    <p className="text-[12px] font-semibold text-[var(--hb-success)]">
                      {reading.axisLabel}
                    </p>
                    <p className="mt-2 text-[14px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
                      이 주제는 건너뛰었어요. 안 맞는 장면을 비워둔 건 답을 지어내지 않은 거예요.
                    </p>
                  </article>
                );
              }
              return (
                <article key={reading.axis} data-self-axis={reading.axis} className="px-5 py-6 sm:px-8">
                  <p className="text-[12px] font-semibold text-[var(--hb-success)]">
                    {reading.axisLabel}
                  </p>
                  <h2 className="mt-2 text-[18px] font-semibold leading-[1.45] text-[var(--hb-text-strong)]">
                    {reading.title}
                  </h2>
                  <p className="mt-1.5 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
                    {describeSelfAxisReading(reading)}
                  </p>

                  <div className="mt-4 space-y-2">
                    {reading.evidence.map((quote) => (
                      <div key={quote.scene} className="rounded-[6px] bg-[var(--hb-surface-hover)] px-4 py-3">
                        <p className="text-[12px] font-medium leading-[1.5] text-[var(--color-rose-700)]">
                          {quote.scene}
                        </p>
                        <p className="mt-1 text-[15px] font-semibold leading-[1.5] text-[var(--hb-text-strong)]">
                          “{quote.label}”
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* 고른 답에만 붙는 해석 주의. 인용 바로 아래라야 어느 문장 얘기인지 읽힌다. */}
                  {qualifierLine ? (
                    <p data-qualifier-line="" className="mt-2 text-[13px] font-medium leading-[1.6] text-[var(--hb-text-body)]">
                      {qualifierLine}
                    </p>
                  ) : null}

                  {absence ? (
                    <p className="mt-4 text-[13px] font-medium leading-[1.7] text-[var(--hb-text-strong)]">
                      {absence}
                    </p>
                  ) : null}

                  <p data-tip="tellPartner" className="mt-4 text-[13px] font-medium leading-[1.7] text-[var(--hb-text-strong)]">
                    <b className="font-semibold text-[var(--hb-text-strong)]">{WEDDING_CODE_TIP_LABELS.tellPartner}: </b>
                    “{reading.tellPartner}”
                  </p>
                  <p data-tip="watchOut" className="mt-2 text-[13px] font-medium leading-[1.7] text-[var(--hb-text-strong)]">
                    <b className="font-semibold text-[var(--hb-text-strong)]">{WEDDING_CODE_TIP_LABELS.watchOut}: </b>
                    {reading.watchOut}
                  </p>
                </article>
              );
            })}
          </div>

          <div className="border-t border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-5 py-5 sm:px-8">
            <p className="text-[13px] font-medium leading-[1.7] text-[var(--hb-text-strong)]">
              여기까지는 내 답만 본 거예요.{" "}
              <b className="font-semibold text-[var(--hb-text-strong)]">둘이 어디서 갈렸는지</b>는 상대도 같은
              장면에 답해야 나와요.
            </p>
          </div>
        </section>

        <TellPartnerDraft profile={profile} />

        <WeddingTasteEntry placement="result" />

        <AmoraStyleConfirmation profile={profile} />
        {contributionCard}
        {copyButton}
        <button type="button" onClick={onRestart} className={`${secondaryButton} mt-4 w-full`}>
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          다시 답하기
        </button>
      </>
    );
  }

  const map = buildWeddingCodeV06GapMap(theirs, answers, {
    questions: config.questions,
    axes: config.axes,
  });
  const profileOptions = { questions: config.questions, axes: config.axes };
  const firstProfile = buildWeddingCodeSelfProfile(theirs, profileOptions);
  const secondProfile = buildWeddingCodeSelfProfile(answers, profileOptions);
  // 상위 3개를 그냥 자르면 전부 같은 축이 나와 같은 문장이 세 번 반복된다.
  const featured = topGapsForDisplay(map, 3);
  const top = showAllGaps
    ? [...featured, ...map.splits.filter((gap) => !featured.includes(gap))]
    : featured;
  // 둘 다 답한 장면만 비교 대상이다.
  const compared = config.questions.length - map.missing;

  const myLetters = buildWeddingCodeLetters(secondProfile);
  const theirLetters = buildWeddingCodeLetters(firstProfile);

  return (
    <>
      <WeddingCodePair mine={myLetters} theirs={theirLetters} />

      <section className={`${surface} mt-4 overflow-hidden`} data-result="couple">
        <div className="bg-[var(--hb-primary)] px-5 py-7 text-white sm:px-8">
          <p className="text-[12px] font-semibold text-[var(--hb-on-primary)]">웨딩코드</p>
          {/*
            비교한 장면 수는 열여섯이 아니라 **둘 다 답한 장면 수**다. 한 사람이 열두
            장면을 건너뛰었는데 「열여섯 장면 중 2곳에서 갈렸어요」라고 하면, 비교하지도
            못한 열두 장면을 「같았다」로 세는 것이 된다.
          */}
          {/*
            겹치는 답이 하나도 없을 수 있다 — 한 사람은 부모님 장면을, 다른 사람은 촬영
            장면을 건너뛴 경우다. 그때 「방향이 같았어요」는 명백한 거짓이다.
          */}
          <h1 className="mt-3 text-[24px] font-semibold leading-[1.35] sm:text-[28px]">
            {compared === 0
              ? "두 사람이 함께 답한 장면이 없어요"
              : compared > map.identical.length
                ? `함께 답한 ${compared}장면 중 ${compared - map.identical.length}곳에서 다른 답을 골랐어요`
                : `함께 답한 ${compared}장면에서 같은 답을 골랐어요`}
          </h1>
          <p className="mt-3 text-[15px] font-medium leading-[1.65] text-[var(--hb-on-primary)]">
            {compared === 0
              ? "두 사람이 건너뛴 장면이 서로 달라서 나란히 볼 자리가 없었어요. 각자 답한 것은 아래에 그대로 남아 있어요."
              : "어느 쪽이 맞는지는 없어요. 갈린 자리마다 다음 대화를 하나씩 정리했어요."}
            {compared > 0 && map.missing > 0
              ? ` 한 사람이라도 건너뛴 ${map.missing}장면은 비교하지 않았어요.`
              : ""}
          </p>
        </div>

        {top.length > 0 ? (
          <div className="divide-y divide-[var(--hb-hairline)]">
            {top.map((gap) => {
              const described = describeGap(gap, {
                first: "먼저 답한 사람",
                second: "나중에 답한 사람",
              }, {
                axes: config.axes,
                nextSteps: config.nextSteps,
              });
              return (
                <article key={gap.key} data-gap={gap.key} className="px-5 py-6 sm:px-8">
                  {/* 주제 이름이지 유형 이름이 아니다 — 「…형이에요」로 읽히면 안 된다. */}
                  <p className="text-[12px] font-semibold text-[var(--hb-success)]">
                    {described.headline}
                  </p>
                  <p className="mt-2 text-[13px] font-medium leading-[1.5] text-[var(--color-rose-700)]">
                    {gap.scene}
                  </p>
                  <div className="mt-4 space-y-2.5">
                    {described.quotes.map((quote) => (
                      <p
                        key={quote}
                        className="rounded-[6px] bg-[var(--hb-surface-hover)] px-4 py-3 text-[15px] font-semibold leading-[1.5] text-[var(--hb-text-strong)]"
                      >
                        {quote}
                      </p>
                    ))}
                  </div>
                  <p className="mt-4 text-[13px] font-medium leading-[1.7] text-[var(--hb-text-strong)]">
                    <b className="font-semibold text-[var(--hb-text-strong)]">다음 대화: </b>
                    {described.nextScene}
                  </p>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="px-5 py-6 sm:px-8">
            <p className="text-[15px] font-medium leading-[1.7] text-[var(--hb-text-strong)]">
              {compared === 0
                ? "비교할 답이 아직 없어요. 같은 장면을 각자 고른 뒤 나란히 확인해 보세요."
                : `함께 답한 ${compared}장면 중 ${map.identical.length}곳에서 같은 문장을 골랐어요. 다른 문장을 고른 장면도 아래에서 모두 확인할 수 있어요.`}
            </p>
          </div>
        )}

        {map.identical.length > 0 ? (
          <div className="border-t border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-5 py-5 sm:px-8">
            <p className="text-[12px] font-semibold text-[var(--color-rose-700)]">토씨까지 같았던 곳</p>
            <p className="mt-1.5 text-[15px] font-semibold leading-[1.5] text-[var(--hb-text-strong)]">
              “{map.identical[0].firstLabel}”
            </p>
            <p className="mt-1 text-[13px] font-medium text-[var(--color-rose-700)]">
              {map.identical[0].scene}
              {map.identical.length > 1 ? ` 외 ${map.identical.length - 1}곳` : ""}
            </p>
          </div>
        ) : null}
      </section>

      {map.splits.length > 3 ? (
        <button
          type="button"
          aria-expanded={showAllGaps}
          onClick={() => setShowAllGaps((value) => !value)}
          className={`${secondaryButton} mt-4 w-full`}
        >
          {showAllGaps
            ? "대표 대화 3개만 보기"
            : `나머지 ${map.splits.length - featured.length}개 대화도 보기`}
        </button>
      ) : null}

      {compared > 0 ? (
        <details className={`${surface} mt-4 px-5 py-5 sm:px-8`} data-all-compared="">
          <summary className="cursor-pointer py-2 text-[15px] font-semibold text-[var(--hb-text-strong)]">
            함께 답한 {compared}장면 모두 나란히 보기
          </summary>
          <div className="mt-3 divide-y divide-[var(--hb-hairline)]">
            {config.questions.flatMap((question) => {
              const gap = [...map.identical, ...map.shared, ...map.splits].find((item) => item.key === question.key);
              if (!gap) return [];
              return [(
                <article key={gap.key} data-compared-scene={gap.key} className="py-4">
                  <h2 className="text-[14px] font-semibold leading-relaxed text-[var(--hb-text-strong)]">{gap.scene}</h2>
                  <p className="mt-1 text-[12px] text-[var(--hb-text-muted)]">{gap.same ? "같은 문장을 골랐어요" : "다른 문장을 골랐어요"}</p>
                  <p className="mt-3 text-[14px] leading-relaxed text-[var(--hb-text-body)]">먼저 답한 사람: “{gap.firstLabel}”</p>
                  <p className="mt-2 text-[14px] leading-relaxed text-[var(--hb-text-body)]">나중에 답한 사람: “{gap.secondLabel}”</p>
                </article>
              )];
            })}
          </div>
        </details>
      ) : null}

      <SelfProfilePair first={firstProfile} second={secondProfile} map={map} />

      {contributionCard}

      {copyButton}
      <button type="button" onClick={onRestart} className={`${secondaryButton} mt-4 w-full`}>
        <RotateCcw aria-hidden="true" className="h-4 w-4" />
          새 응답 시작하기
      </button>
    </>
  );
}

/**
 * 두 사람의 코드를 나란히.
 *
 * **점수로 합치지 않는다.** 「네 자리 중 세 자리가 같으니 75점」은 근거 없이 관계를
 * 예측하는 것이다. 다른 자리를 짚어주고, 그 자리에서 할 이야기는 아래 차이 지도가 맡는다.
 */
function WeddingCodePair({
  mine,
  theirs,
}: {
  mine: WeddingCodeLetters;
  theirs: WeddingCodeLetters;
}) {
  const comparison = compareWeddingCodeLetters(theirs, mine);
  const different = comparison.filter((item) => item.state === "different");
  const unknown = comparison.filter((item) => item.state === "unknown");

  return (
    <section className={`${surface} overflow-hidden`} data-code-pair="">
      <div className="bg-[var(--hb-primary)] px-5 py-7 text-center text-white sm:px-8">
        <p className="text-[12px] font-semibold text-[var(--hb-on-primary)]">두 사람의 웨딩코드</p>
        <p className="mt-3 text-[30px] font-semibold leading-none tracking-[0.04em] sm:text-[38px]">
          {theirs.code} <span className="text-[var(--color-sage-pale)]">×</span> {mine.code}
        </p>
        <p className="mt-4 text-[13px] font-medium leading-[1.7] text-[var(--hb-on-primary)]">
          {different.length > 0
            ? `네 자리 중 ${different.length}자리가 달라요. 점수는 매기지 않아요 — 다른 자리부터 이야기하면 돼요.`
            : unknown.length === comparison.length
              ? "미응답이나 동률 때문에 비교할 글자가 없어요. 실제로 고른 답은 아래 장면별로 확인해 주세요."
              : `비교할 수 있는 ${comparison.length - unknown.length}자리의 글자가 같아요. 같은 글자여도 장면마다 고른 답은 다를 수 있어요.`}
        </p>
      </div>
      <details>
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-[var(--hb-text-strong)] sm:px-8">글자별 집계 자세히 보기</summary>
      <div className="divide-y divide-[var(--hb-hairline)]">
        {comparison.map((item) => (
          <div key={item.axis} data-code-slot={item.axis} data-code-state={item.state} className="flex items-center gap-4 px-5 py-3.5 sm:px-8">
            <span className="flex shrink-0 items-center gap-1.5 text-[17px] font-semibold text-[var(--hb-text-strong)]">
              {item.first.letter}
              <span className="text-[13px] font-medium text-[var(--color-rose-700)]">·</span>
              {item.second.letter}
            </span>
            <p className="min-w-0 text-[13px] font-medium leading-[1.6] text-[var(--hb-text-strong)]">
              <b className="font-semibold text-[var(--hb-text-strong)]">{item.axisLabel}</b>
              {item.state === "different"
                ? " — 서로 다른 자리예요"
                : item.state === "same"
                  ? " — 같은 자리예요"
                  : " — 미응답이나 동률로 글자를 비교하지 않았어요"}
            </p>
          </div>
        ))}
      </div>
      </details>
    </section>
  );
}

function WeddingTasteEntry({ placement }: { placement: "intro" | "result" }) {
  return <section className={`${surface} mt-5 px-5 py-5 sm:px-8`}>
    <h2 className="text-lg font-semibold text-[var(--hb-text-strong)]">원하는 결혼식도 골라볼까요?</h2>
    <p className="mt-2 text-sm leading-relaxed text-[var(--hb-text-body)]">분위기와 중요한 취향, 피하고 싶은 것, 함께 맞춰볼 범위를 직접 정리해요.</p>
    <Button
      href="/wedding-code/taste"
      variant="secondary"
      fullWidth
      className="mt-4"
      onClick={() => captureWeddingCodeEvent("wedding_code_taste_clicked", { placement })}
    >
      내가 원하는 결혼식 고르기
    </Button>
  </section>;
}

/**
 * 상대에게 보낼 말 — **고쳐 쓸 수 있는 서술형**.
 *
 * ## 왜 여기에만 서술형을 두나
 *
 * 문항마다 자유 입력을 받으면 그 글이 공유 링크(`#a=...`)에 실린다. 선택지 16글자는
 * 「A를 골랐구나」지만 서술형은 이름·집안 사정·금액이 그대로 들어가고, 링크가 한 번
 * 전달되면 회수할 수 없다. 저장하는 쪽으로 바꾸면 로그인·동의·삭제·AI 로그 원문
 * 비복제 규칙이 한 묶음으로 딸려온다 — 그건 아모라 쪽 설계다.
 *
 * 반면 이 상자는 **링크에 실리지 않고 저장되지도 않는다.** 사용자가 고쳐서 자기
 * 클립보드로 복사할 뿐이라, 어디에 붙여넣을지는 사용자가 정한다. 그래서 새 위험 없이
 * 서술형을 쓸 수 있는 유일한 자리다.
 *
 * 원래 이 문장들은 **제가 대신 써준 말**이었다. 남이 써준 문장을 상대에게 보내라는
 * 것이 더 이상했다. 초안만 대고 문장은 본인이 갖는다.
 */
function TellPartnerDraft({ profile }: { profile: WeddingCodeSelfProfile }) {
  const draft = profile.axes
    .filter((reading) => reading.answered > 0)
    .map((reading) => reading.tellPartner)
    .join("\n\n");
  const [text, setText] = useState(draft);
  const [copied, setCopied] = useState(false);
  if (draft === "") return null;

  return (
    <section className={`${surface} mt-4 overflow-hidden`} data-tell-partner="">
      <div className="border-b border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] px-5 py-5 sm:px-8">
        <h2 className="text-[17px] font-semibold leading-[1.45] text-[var(--hb-text-strong)]">
          상대에게 보낼 말
        </h2>
        <p className="mt-1.5 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
          내 답으로 만든 초안이에요. 내 말투로 고쳐 쓰세요. 이 글은 공유 링크에 들어가지
          않고 저장되지도 않아요 — 복사해서 원하는 곳에 직접 붙여넣는 거예요.
        </p>
      </div>
      <div className="px-5 py-5 sm:px-8">
        <label htmlFor="wedding-code-tell-partner" className="sr-only">
          상대에게 보낼 말
        </label>
        <textarea
          id="wedding-code-tell-partner"
          value={text}
          rows={8}
          onChange={(event) => {
            setText(event.target.value);
            setCopied(false);
          }}
          className="w-full resize-y rounded-[6px] border border-[#C7D1C2] bg-white px-4 py-3 text-[15px] font-medium leading-[1.7] text-[var(--hb-text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-primary)]"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={text.trim() === ""}
            onClick={() => {
              void navigator.clipboard?.writeText?.(text).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
            className={`${primaryButton} flex-1`}
          >
            {copied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
            {copied ? "복사했어요" : "이 글 복사하기"}
          </button>
          <button
            type="button"
            disabled={text === draft}
            onClick={() => {
              setText(draft);
              setCopied(false);
            }}
            className={`${secondaryButton} disabled:opacity-40`}
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            초안으로
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * 아모라가 이 답을 받으면 무엇을 다르게 하는지.
 *
 * 여기서는 **저장도 적용도 하지 않는다.** 웨딩코드는 로그인 없이 쓰는 화면이고 답을
 * 서버에 남기지 않는다. 그래서 「이 값을 설정 화면에서 고르면 아모라가 이렇게 움직인다」는
 * 사실만 말하고, 실제 반영은 사용자가 설정 화면에서 직접 확인할 때만 일어난다.
 * 없는 자동 연동을 있는 것처럼 말하지 않는다.
 */
/**
 * 커플 결과에서도 **각자 몫**을 남긴다.
 *
 * 차이 지도만 있으면 「우리는 여기서 갈렸다」로 끝나서, 정작 각자가 자기 답에서 무엇을
 * 반복했는지는 알 수 없다. 갈린 자리를 이야기하려면 먼저 자기가 무엇을 반복했는지
 * 말할 수 있어야 한다. 여기서도 판정하지 않고, 각자 고른 답의 셈만 나란히 둔다.
 */
function SelfProfilePair({
  first,
  second,
  map,
}: {
  first: WeddingCodeSelfProfile;
  second: WeddingCodeSelfProfile;
  map: WeddingCodeV06GapMap;
}) {
  const combination = buildWeddingCodeCoupleCombination(first, second, map);
  return (
    <section className={`${surface} mt-4 overflow-hidden`} data-result="self-pair">
      <div className="border-b border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] px-5 py-5 sm:px-8">
        <h2 className="text-[17px] font-semibold leading-[1.45] text-[var(--hb-text-strong)]">
          각자 이번에 고른 것
        </h2>
        <p className="mt-1.5 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
          두 사람이 각각 어떤 답을 몇 번 골랐는지만 세었어요.
        </p>
      </div>
      <div className="divide-y divide-[var(--hb-hairline)]">
        {first.axes.map((firstReading, index) => {
          const secondReading = second.axes[index];
          const combined = combination.find((item) => item.axis === firstReading.axis);
          return (
            <div key={firstReading.axis} data-pair-axis={firstReading.axis} className="px-5 py-5 sm:px-8">
              <div className="flex items-center gap-2">
                <p className="text-[12px] font-semibold text-[var(--hb-success)]">
                  {firstReading.axisLabel}
                </p>
                {combined ? (
                  <span
                    data-pair-state={combined.state}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      combined.state === "different"
                        ? "bg-[var(--hb-surface-hover)] text-[var(--color-rose-700)]"
                        : "bg-[#EEF2EC] text-[var(--hb-text-strong)]"
                    }`}
                  >
                    {combined.state === "different" ? "다른 답 있음" : "함께 답한 장면만 같음"}
                  </span>
                ) : null}
              </div>
              <div className="mt-3 space-y-3">
                {[
                  { name: "먼저 답한 사람", reading: firstReading },
                  { name: "나중에 답한 사람", reading: secondReading },
                ].map(({ name, reading }) => (
                  <div key={name}>
                    <p className="text-[13px] font-medium text-[var(--color-rose-700)]">{name}</p>
                    {/*
                      건너뛴 사람에게 제목을 붙이면 고르지도 않은 답을 읽어주는 것이 된다.
                      「…나뉘었어요」 밑에 「아직 답하지 않았어요」가 같이 뜨면 둘 중 하나는
                      거짓말이다.
                    */}
                    {reading.answered === 0 ? (
                      <p className="mt-0.5 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
                        이 주제는 건너뛰었어요.
                      </p>
                    ) : (
                      <>
                        <p className="mt-0.5 text-[15px] font-semibold leading-[1.5] text-[var(--hb-text-strong)]">
                          {reading.title}
                        </p>
                        <p className="mt-0.5 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
                          {describeSelfAxisReading(reading)}
                        </p>
                      </>
                    )}
                  </div>
                ))}
              </div>
              {combined ? (
                <p className="mt-3 text-[13px] font-medium leading-[1.7] text-[var(--hb-text-strong)]">
                  {combined.directive}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
