"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, RotateCcw } from "lucide-react";

import { encodeWeddingCodeV06 } from "@/lib/weddingCode/v06/code";
import {
  answeredCount,
  buildWeddingCodeV06GapMap,
  describeGap,
  topGapsForDisplay,
  type WeddingCodeV06Answers,
} from "@/lib/weddingCode/v06/gap";
import {
  weddingCodeSceneConfigForExactVersion,
  weddingCodeSceneCountLabel,
  type WeddingCodeSceneConfig,
  type WeddingCodeSceneVersion,
} from "@/lib/weddingCode/scene/config";
import {
  buildWeddingCodeSelfProfile,
  describeSelfAxisAbsence,
  describeSelfAxisReading,
  withJosa,
  type WeddingCodeSelfProfile,
} from "@/lib/weddingCode/scene/selfProfile";
import {
  buildWeddingCodeAmoraProposals,
  buildWeddingCodeCoupleCombination,
  weddingCodeProposalChanges,
} from "@/lib/weddingCode/profile/amoraBridge";
import { useAmoraPersonalization } from "@/hooks/useAmoraPersonalization";
import { useAuthStore } from "@/stores/authStore";
import {
  WEDDING_CODE_FIRMNESS_LABEL,
  buildWeddingCodeLetters,
  compareWeddingCodeLetters,
  type WeddingCodeLetters,
} from "@/lib/weddingCode/profile/letters";
import {
  buildWeddingCodeShareUrl,
  decodeWeddingCodeShareHash,
} from "@/lib/weddingCode/scene/link";

const surface = "rounded-[20px] border border-[var(--hb-hairline)] bg-white";
const primaryButton =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-6"
  + " text-[15px] font-semibold text-white transition-colors duration-150 ease-out"
  + " hover:bg-[var(--hb-primary)] focus-visible:outline-none focus-visible:ring-2"
  + " focus-visible:ring-[var(--hb-primary)] focus-visible:ring-offset-2"
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
}: {
  shareOrigin: string;
  version: WeddingCodeSceneVersion;
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

  const theirs = linkContext.bothCodes?.first ?? linkContext.partnerAnswers;
  const done = answeredCount(answers, questions);
  const sceneCount = weddingCodeSceneCountLabel(questions.length);

  useEffect(() => {
    const applyShareHash = () => {
      const decodedHash = decodeWeddingCodeShareHash(window.location.hash);
      if (!decodedHash) return false;
      setActiveVersion(decodedHash.version);
      setLinkContext({
        partnerAnswers: decodedHash.partnerAnswers,
        partnerCode: decodedHash.partnerCode,
        bothCodes: decodedHash.bothCodes,
      });
      setAnswers(decodedHash.bothCodes?.second ?? {});
      setSkipped([]);
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
    setStep("intro");
    setIndex(0);
    setAnswers({});
    setSkipped([]);
    setCopied(false);
  }

  if (step === "result") {
    return (
      <Shell>
        <ResultView
          answers={answers}
          theirs={theirs}
          config={config}
          shareOrigin={shareOrigin}
          partnerCode={linkContext.partnerCode}
          copied={copied}
          onCopied={setCopied}
          onRestart={restart}
        />
      </Shell>
    );
  }

  if (step === "intro") {
    return (
      <Shell>
        <section className={`${surface} overflow-hidden`}>
          <div className="bg-[var(--hb-primary)] px-5 py-8 text-white sm:px-8">
            <p className="text-[12px] font-semibold tracking-[0.16em] text-[#C7D1C2]">웨딩코드</p>
            <h1 className="mt-3 text-[26px] font-semibold leading-[1.35] sm:text-[30px]">
              {theirs
                ? "먼저 답한 사람이 링크를 보냈어요"
                : `결혼 준비 ${sceneCount} 장면`}
            </h1>
            <p className="mt-4 text-[15px] font-medium leading-[1.7] text-[#F7F1E8]">
              {theirs
                ? `같은 ${sceneCount} 장면에 답하면, 두 사람이 어디서 갈렸는지 바로 볼 수 있어요.`
                : "각자 답하고 나서, 두 사람이 어디서 갈렸는지 나란히 봅니다."}
            </p>
          </div>

          <div className="space-y-3 px-5 py-6 sm:px-8">
            {[
              "다 답하면 내 웨딩코드 네 글자가 나와요. 열여섯 가지 중 하나예요.",
              "맞는 답도 틀린 답도 없어요. 점수도 궁합도 매기지 않아요.",
              "코드는 성격을 맞힌 게 아니라 내가 고른 답을 적은 거예요.",
              "글자마다 몇 대 몇으로 갈렸는지도 같이 보여줘요.",
              "우리와 안 맞는 장면은 건너뛸 수 있어요.",
              "금액은 예시예요. 우리 규모와 다르면 비율로 바꿔 생각해도 돼요.",
              "부모님이나 하객이 없는 상황이면 그 장면은 건너뛰면 돼요.",
              "두 사람이 실제로 고른 문장을 그대로 보여줘요.",
              "겪지 않은 장면은 지금이라면 고를 답을 선택해요.",
              "로그인 없이 사용할 수 있어요.",
              "답은 기기 안에서 계산하며 서버 DB에 저장하지 않아요.",
              "공유 링크에는 답을 나타내는 코드가 들어가므로 함께 볼 사람에게만 보내요.",
            ].map((line) => (
              <p key={line} className="flex gap-2.5 text-[14px] font-medium leading-[1.6] text-[var(--hb-text-strong)]">
                <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#6D806E]" />
                {line}
              </p>
            ))}
          </div>
        </section>

        <button
          type="button"
          onClick={() => setStep("quiz")}
          className={`${primaryButton} mt-5 w-full`}
        >
          {theirs ? "나도 답해보기" : "시작하기"}
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </button>
        <p className="mt-3 text-center text-[13px] font-medium text-[var(--color-rose-700)]">
          {sceneCount} 문항
        </p>
      </Shell>
    );
  }

  const question = questions[index];
  const picked = answers[question.key];
  const last = index === questions.length - 1;
  const skippedHere = skipped.includes(question.key);

  function goNext() {
    if (last) setStep("result");
    else setIndex((value) => Math.min(questions.length - 1, value + 1));
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
                    selected ? "border-[var(--hb-primary)] bg-[var(--hb-primary)] text-white" : "border-[#C7D1C2]"
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
}: {
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
  const mineCode = encodeWeddingCodeV06(answers, config.questions);
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
  const shareText = shareLetters.complete
    ? `내 웨딩코드는 ${shareLetters.code}예요. 같은 ${weddingCodeSceneCountLabel(config.questions.length)} 장면에 답해볼래요?
${shareUrl}`
    : shareUrl;

  const copyButton = (
    <div className="mt-5">
      <button
        type="button"
        data-share-url={shareUrl}
        data-share-text={shareText}
        onClick={() => {
          void navigator.clipboard?.writeText?.(shareText).then(
            () => onCopied(true),
            () => onCopied(false),
          );
        }}
        className={`${primaryButton} w-full`}
      >
        {copied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
        {copied ? "복사했어요" : theirs ? "결과 링크 복사하기" : "내 코드와 링크 보내기"}
      </button>
      <p className="mt-2 text-[12px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
        {theirs
          ? "링크에는 두 사람의 답이 포함돼요. 먼저 답한 사람에게만 보내 주세요."
          : "링크에는 내 답이 포함돼요. 함께 비교할 사람에게만 보내 주세요."}
      </p>
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
            <p className="text-[12px] font-semibold tracking-[0.16em] text-[#C7D1C2]">웨딩코드</p>
            <h1 className="mt-3 text-[24px] font-semibold leading-[1.35] sm:text-[28px]">
              내가 반복해서 고른 것
            </h1>
            {profile.repeated.length > 0 ? (
              <p className="mt-3 text-[15px] font-medium leading-[1.65] text-[#F7F1E8]">
                답한 {profile.answered}장면 중 {profile.repeated[0].count}곳에서{" "}
                {withJosa(
                  profile.repeated.map((item) => `“${item.phrase}”`).join(", "),
                  "을",
                  "를",
                )}{" "}
                먼저 보는 답을 골랐어요.
              </p>
            ) : null}
            <p className="mt-3 text-[13px] font-medium leading-[1.6] text-[#C7D1C2]">
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
              // 건너뛴 주제에 카피를 붙이면 고르지도 않은 답을 읽어주는 것이 된다.
              if (reading.answered === 0) {
                return (
                  <article key={reading.axis} data-self-axis={reading.axis} data-skipped="" className="px-5 py-5 sm:px-8">
                    <p className="text-[12px] font-semibold tracking-[0.02em] text-[#6D806E]">
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
                  <p className="text-[12px] font-semibold tracking-[0.02em] text-[#6D806E]">
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
                      <div key={quote.scene} className="rounded-[12px] bg-[var(--hb-surface-hover)] px-4 py-3">
                        <p className="text-[12px] font-medium leading-[1.5] text-[var(--color-rose-700)]">
                          {quote.scene}
                        </p>
                        <p className="mt-1 text-[15px] font-semibold leading-[1.5] text-[var(--hb-text-strong)]">
                          “{quote.label}”
                        </p>
                      </div>
                    ))}
                  </div>

                  {absence ? (
                    <p className="mt-4 text-[13px] font-medium leading-[1.7] text-[var(--hb-text-strong)]">
                      {absence}
                    </p>
                  ) : null}

                  <p className="mt-4 text-[13px] font-medium leading-[1.7] text-[var(--hb-text-strong)]">
                    <b className="font-semibold text-[var(--hb-text-strong)]">상대에게 미리 말해두기: </b>
                    “{reading.tellPartner}”
                  </p>
                  <p className="mt-2 text-[13px] font-medium leading-[1.7] text-[var(--hb-text-strong)]">
                    <b className="font-semibold text-[var(--hb-text-strong)]">한 가지 챙긴다면: </b>
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

        <AmoraStyleProposals profile={profile} />
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
          <p className="text-[12px] font-semibold tracking-[0.16em] text-[#C7D1C2]">웨딩코드</p>
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
              : map.splits.length > 0
                ? `함께 답한 ${compared}장면 중 ${map.splits.length}곳에서 갈렸어요`
                : `함께 답한 ${compared}장면에서 방향이 같았어요`}
          </h1>
          <p className="mt-3 text-[15px] font-medium leading-[1.65] text-[#F7F1E8]">
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
                  <p className="text-[12px] font-semibold tracking-[0.02em] text-[#6D806E]">
                    {described.headline}
                  </p>
                  <p className="mt-2 text-[13px] font-medium leading-[1.5] text-[var(--color-rose-700)]">
                    {gap.scene}
                  </p>
                  <div className="mt-4 space-y-2.5">
                    {described.quotes.map((quote) => (
                      <p
                        key={quote}
                        className="rounded-[12px] bg-[var(--hb-surface-hover)] px-4 py-3 text-[15px] font-semibold leading-[1.5] text-[var(--hb-text-strong)]"
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
              함께 답한 장면에서 모두 같은 방향이었어요. 그중 문장까지 똑같았던 건{" "}
              {map.identical.length}곳이에요 — 나머지는 같은 쪽을 보면서 다른 말로 표현한
              자리예요.
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

      <SelfProfilePair first={firstProfile} second={secondProfile} />

      {copyButton}
      <button type="button" onClick={onRestart} className={`${secondaryButton} mt-4 w-full`}>
        <RotateCcw aria-hidden="true" className="h-4 w-4" />
        답변을 처음부터 다시 고르기
      </button>
    </>
  );
}

/**
 * 웨딩코드 네 글자.
 *
 * 이름이 코드인데 코드가 없으면 이 제품은 이름값을 못 한다. 다만 MBTI가 하는 두 가지 중
 * **하나만** 한다 — 답을 네 글자로 요약하는 계산은 하고, 「이 유형은 이런 사람」이라는
 * 주장은 하지 않는다. 대신 MBTI가 숨기는 것을 드러낸다: 글자마다 몇 대 몇이었는지,
 * 그리고 어떤 글자가 다시 풀면 바뀔 수 있는지.
 */
function WeddingCodeBadge({ letters }: { letters: WeddingCodeLetters }) {
  return (
    <section className={`${surface} overflow-hidden`} data-wedding-code={letters.code}>
      <div className="bg-[var(--hb-primary)] px-5 py-8 text-center text-white sm:px-8">
        <p className="text-[12px] font-semibold tracking-[0.16em] text-[#C7D1C2]">내 웨딩코드</p>
        <p className="mt-3 flex justify-center gap-1.5 text-[44px] font-semibold leading-none tracking-[0.04em] sm:text-[56px]">
          {letters.slots.map((slot) => (
            <span
              key={slot.axis}
              data-letter={slot.axis}
              data-firmness={slot.firmness}
              className={
                slot.firmness === "narrow"
                  ? "text-[#C7D1C2]"
                  : slot.firmness === "unset"
                    ? "text-[#6D806E]"
                    : "text-white"
              }
            >
              {slot.letter}
            </span>
          ))}
        </p>
        <p className="mt-4 text-[13px] font-medium leading-[1.7] text-[#C7D1C2]">
          열여섯 가지 중 하나예요. 성격을 맞힌 게 아니라, 내가 고른 답을 네 글자로 적은
          거예요.
          {letters.slots.some((slot) => slot.firmness === "narrow")
            ? " 작은 글자는 아슬아슬하게 정해진 자리예요."
            : ""}
        </p>
      </div>

      <div className="divide-y divide-[var(--hb-hairline)]">
        {letters.slots.map((slot) => (
          <div key={slot.axis} className="flex gap-4 px-5 py-4 sm:px-8">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--hb-surface-hover)] text-[18px] font-semibold text-[var(--hb-text-strong)]"
            >
              {slot.letter}
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-[#6D806E]">
                {slot.axisLabel} · {WEDDING_CODE_FIRMNESS_LABEL[slot.firmness]}
              </p>
              <p className="mt-1 text-[15px] font-semibold leading-[1.5] text-[var(--hb-text-strong)]">
                {slot.meaning}
              </p>
              <p className="mt-1 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
                {slot.tally}
              </p>
              {slot.caution ? (
                <p className="mt-1 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
                  {slot.caution}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
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
        <p className="text-[12px] font-semibold tracking-[0.16em] text-[#C7D1C2]">두 사람의 웨딩코드</p>
        <p className="mt-3 text-[30px] font-semibold leading-none tracking-[0.04em] sm:text-[38px]">
          {theirs.code} <span className="text-[#6D806E]">×</span> {mine.code}
        </p>
        <p className="mt-4 text-[13px] font-medium leading-[1.7] text-[#C7D1C2]">
          {different.length > 0
            ? `네 자리 중 ${different.length}자리가 달라요. 점수는 매기지 않아요 — 다른 자리부터 이야기하면 돼요.`
            : unknown.length === comparison.length
              ? "함께 답한 자리가 없어서 나란히 볼 글자가 없어요."
              : "글자가 모두 같아요. 그래도 같은 글자 안에서 고른 문장은 다를 수 있어요."}
        </p>
      </div>
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
                  : " — 한 사람이 건너뛰어 비교하지 않았어요"}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
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
          className="w-full resize-y rounded-[12px] border border-[#C7D1C2] bg-white px-4 py-3 text-[15px] font-medium leading-[1.7] text-[var(--hb-text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-primary)]"
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
function AmoraStyleProposals({ profile }: { profile: WeddingCodeSelfProfile }) {
  const proposals = buildWeddingCodeAmoraProposals(profile);
  const user = useAuthStore((state) => state.user);
  // 로그인하지 않은 사람에게는 설정을 불러올 것도 저장할 것도 없다.
  const personalization = useAmoraPersonalization(Boolean(user));
  const [applied, setApplied] = useState(false);

  if (proposals.length === 0) return null;
  const changes = weddingCodeProposalChanges(proposals);

  return (
    <section className={`${surface} mt-4 overflow-hidden`} data-amora-proposals="">
      <div className="border-b border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] px-5 py-5 sm:px-8">
        <h2 className="text-[17px] font-semibold leading-[1.45] text-[var(--hb-text-strong)]">
          아모라에게 알려줄 도움 방식
        </h2>
        <p className="mt-1.5 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
          내 답과 같은 뜻인 설정값이에요. 웨딩코드가 자동으로 바꾸지 않고, 설정 화면에서
          직접 고를 때만 아모라에 적용돼요.
        </p>
      </div>
      <div className="divide-y divide-[var(--hb-hairline)]">
        {proposals.map((proposal) => (
          <div key={proposal.field} data-proposal={proposal.field} className="px-5 py-5 sm:px-8">
            <p className="text-[15px] font-semibold leading-[1.5] text-[var(--hb-text-strong)]">
              {proposal.choiceLabel}
            </p>
            <p className="mt-1 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
              {proposal.basis}
            </p>
            <p className="mt-2 text-[13px] font-medium leading-[1.7] text-[var(--hb-text-strong)]">
              {proposal.effect}
            </p>
            {proposal.caution ? (
              <p className="mt-2 text-[12px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
                {proposal.caution}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-5 py-5 sm:px-8">
        {user ? (
          <>
            <button
              type="button"
              data-apply-amora=""
              disabled={personalization.saving || applied || personalization.status === "loading"}
              onClick={() => {
                void personalization.save(changes).then((result) => {
                  // 저장 결과를 확인하기 전에 반영됐다고 말하지 않는다.
                  if (result) setApplied(true);
                });
              }}
              className={`${primaryButton} w-full`}
            >
              {applied ? <Check aria-hidden="true" className="h-4 w-4" /> : null}
              {applied
                ? "아모라에 반영했어요"
                : personalization.saving
                  ? "반영하는 중…"
                  : "이 방식으로 아모라에 반영하기"}
            </button>
            {personalization.error ? (
              <p role="alert" className="mt-2 text-[13px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
                {personalization.error}
              </p>
            ) : null}
            <p className="mt-2 text-[12px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
              {applied
                ? "다음 대화부터 아모라가 이 방식으로 움직여요. 설정 화면에서 언제든 바꿀 수 있어요."
                : "위 설정값만 내 계정에 저장돼요. 웨딩코드 답과 고른 문장은 저장하지 않아요."}
            </p>
            <a
              href="/settings/amora-style"
              className="mt-3 inline-block text-[13px] font-semibold text-[var(--hb-text-strong)] underline underline-offset-4"
            >
              설정 화면에서 직접 보기
            </a>
          </>
        ) : (
          <>
            <a
              href="/settings/amora-style"
              className={`${primaryButton} w-full`}
            >
              로그인하고 아모라에 반영하기
            </a>
            <p className="mt-2 text-[12px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
              로그인하면 위 설정값을 내 계정에 저장할 수 있어요. 웨딩코드 답과 고른 문장은
              저장하지 않아요.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

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
}: {
  first: WeddingCodeSelfProfile;
  second: WeddingCodeSelfProfile;
}) {
  const combination = buildWeddingCodeCoupleCombination(first, second);
  return (
    <section className={`${surface} mt-4 overflow-hidden`} data-result="self-pair">
      <div className="border-b border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] px-5 py-5 sm:px-8">
        <h2 className="text-[17px] font-semibold leading-[1.45] text-[var(--hb-text-strong)]">
          각자 반복해서 고른 것
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
                <p className="text-[12px] font-semibold tracking-[0.02em] text-[#6D806E]">
                  {firstReading.axisLabel}
                </p>
                {combined ? (
                  <span
                    data-pair-state={combined.state}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      combined.state === "split"
                        ? "bg-[var(--hb-surface-hover)] text-[var(--color-rose-700)]"
                        : "bg-[#EEF2EC] text-[var(--hb-text-strong)]"
                    }`}
                  >
                    {combined.state === "split" ? "서로 다름" : "방향 같음"}
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
