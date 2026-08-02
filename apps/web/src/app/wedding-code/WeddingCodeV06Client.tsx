"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, RotateCcw } from "lucide-react";

import {
  WEDDING_CODE_V06_QUESTIONS,
} from "@/constants/weddingCodeV06";
import {
  buildWeddingCodeV06ShareUrl,
  decodeWeddingCodeV06ShareHash,
  encodeWeddingCodeV06,
  isCompleteWeddingCodeV06,
} from "@/lib/weddingCode/v06/code";
import {
  answeredCount,
  buildWeddingCodeV06GapMap,
  describeGap,
  ownAnswerQuotes,
  topGapsForDisplay,
  type WeddingCodeV06Answers,
} from "@/lib/weddingCode/v06/gap";
import { clearRetiredWeddingCodeStorage } from "@/lib/weddingCode/retiredStorage";

const surface = "rounded-[20px] border border-[#EFE4D7] bg-white";
const primaryButton =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-[#36534E] px-6"
  + " text-[15px] font-semibold text-white transition-colors duration-150 ease-out"
  + " hover:bg-[#243832] focus-visible:outline-none focus-visible:ring-2"
  + " focus-visible:ring-[#36534E] focus-visible:ring-offset-2"
  + " disabled:cursor-not-allowed disabled:opacity-40";
const secondaryButton =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full border"
  + " border-[#C7D1C2] bg-white px-5 text-[14px] font-semibold text-[#36534E]"
  + " transition-colors duration-150 ease-out hover:bg-[#F7F1E8] focus-visible:outline-none"
  + " focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2";

type Step = "intro" | "quiz" | "result";

/**
 * 웨딩코드 v0.6.
 *
 * ## v0.5와 무엇이 다른가
 *
 * - **결과가 판정이 아니다.** 유형·점수·궁합을 만들지 않는다. 두 사람이 실제로 고른 문장을
 *   그대로 붙여 보여주고, 그 차이가 다음에 어디서 또 나오는지만 말한다. 성격을 주장하지
 *   않으므로 타당도 근거가 필요 없다.
 * - **로그인·저장·대기가 없다.** 답 16개를 링크에 싣는다. v0.5는 커플 연동 → DB 저장 →
 *   상대 응답 대기 순서였고, 대부분이 「아직 상대 응답을 기다리고 있어요」에서 끝났다.
 * - **내 답을 인용한다.** v0.5의 개인 결과는 하드코딩 문장 중 하나를 보여줄 뿐 사용자가
 *   고른 문구를 한 번도 쓰지 않았다.
 *
 * 상태는 화면 안에만 있고 아무것도 서버로 보내지 않는다.
 */
export default function WeddingCodeV06Client({
  shareOrigin,
}: {
  shareOrigin: string;
}) {
  const [step, setStep] = useState<Step>("intro");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<WeddingCodeV06Answers>({});
  const [copied, setCopied] = useState(false);
  const [sharedCodes, setSharedCodes] = useState<{
    partnerAnswers: WeddingCodeV06Answers | null;
    partnerCode: string | null;
    bothCodes: { mine: WeddingCodeV06Answers; theirs: WeddingCodeV06Answers } | null;
  }>({ partnerAnswers: null, partnerCode: null, bothCodes: null });

  useEffect(() => {
    // 폐기된 v0.5가 답변·커플 토큰을 계정 미귀속 localStorage에 남겼다.
    // v0.6는 저장하지 않으므로 새 화면 진입 시 오래된 사본도 복원 없이 폐기한다.
    clearRetiredWeddingCodeStorage();

    const fragmentPayload = decodeWeddingCodeV06ShareHash(window.location.hash);
    if (fragmentPayload) {
      let cancelled = false;
      window.queueMicrotask(() => {
        if (cancelled) return;
        if (fragmentPayload.secondAnswers) {
          setAnswers(fragmentPayload.secondAnswers);
          setSharedCodes({
            partnerAnswers: null,
            partnerCode: fragmentPayload.firstCode,
            bothCodes: {
              mine: fragmentPayload.secondAnswers,
              theirs: fragmentPayload.firstAnswers,
            },
          });
          setStep("result");
        } else {
          setSharedCodes({
            partnerAnswers: fragmentPayload.firstAnswers,
            partnerCode: fragmentPayload.firstCode,
            bothCodes: null,
          });
        }
      });
      return () => {
        cancelled = true;
      };
    }

  }, []);

  const theirs = sharedCodes.bothCodes?.theirs ?? sharedCodes.partnerAnswers;
  const done = answeredCount(answers);

  function restart() {
    setStep("intro");
    setIndex(0);
    setAnswers({});
    setCopied(false);
  }

  if (step === "result") {
    return (
      <Shell>
        <ResultView
          answers={answers}
          theirs={theirs}
          shareOrigin={shareOrigin}
          partnerCode={sharedCodes.partnerCode}
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
          <div className="bg-[#243832] px-5 py-8 text-white sm:px-8">
            <p className="text-[12px] font-semibold tracking-[0.16em] text-[#C7D1C2]">웨딩코드</p>
            <h1 className="mt-3 text-[26px] font-semibold leading-[1.35] sm:text-[30px]">
              {theirs ? "상대가 먼저 답하고 보냈어요" : "결혼 준비 열여섯 장면"}
            </h1>
            <p className="mt-4 text-[15px] font-medium leading-[1.7] text-[#F7F1E8]">
              {theirs
                ? "같은 열여섯 장면에 답하면, 두 사람이 어디서 갈렸는지 바로 볼 수 있어요."
                : "각자 답하고 나서, 두 사람이 어디서 갈렸는지 나란히 봅니다."}
            </p>
          </div>

          <div className="space-y-3 px-5 py-6 sm:px-8">
            {[
              "점수도 유형도 궁합도 나오지 않아요.",
              "두 사람이 실제로 고른 문장을 그대로 보여줘요.",
              "로그인 없이 되고, 답은 저장되지 않아요.",
            ].map((line) => (
              <p key={line} className="flex gap-2.5 text-[14px] font-medium leading-[1.6] text-[#36534E]">
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
        <p className="mt-3 text-center text-[13px] font-medium text-[#8F6662]">
          열여섯 문항 · 3분쯤 걸려요
        </p>
      </Shell>
    );
  }

  const question = WEDDING_CODE_V06_QUESTIONS[index];
  const picked = answers[question.key];
  const last = index === WEDDING_CODE_V06_QUESTIONS.length - 1;

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
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EFE4D7]">
          <div
            data-progress={done}
            className="h-full rounded-full bg-[#36534E] transition-[width] duration-200"
            style={{ width: `${(done / WEDDING_CODE_V06_QUESTIONS.length) * 100}%` }}
          />
        </div>
        <p className="text-[13px] font-semibold tabular-nums text-[#8F6662]">
          {index + 1}/{WEDDING_CODE_V06_QUESTIONS.length}
        </p>
      </div>

      <section className={`${surface} overflow-hidden`} data-question={question.key}>
        <div className="border-b border-[#EFE4D7] bg-[#F7F1E8] px-5 py-5 sm:px-8">
          <p className="text-[16px] font-semibold leading-[1.55] text-[#243832]">
            {question.scene}
          </p>
          <p className="mt-2 text-[14px] font-medium text-[#8F6662]">{question.question}</p>
        </div>

        <div className="divide-y divide-[#EFE4D7]">
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
                  // 마지막 문항이면 멈춘다 — 자동으로 결과로 넘어가면 고친 답을 못 본다.
                  if (!last) window.setTimeout(() => setIndex((value) => value + 1), 140);
                }}
                className={`flex min-h-[64px] w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#36534E] sm:px-8 ${
                  selected ? "bg-[#F7F1E8]" : "bg-white hover:bg-[#FBF8F2]"
                }`}
              >
                <span className="text-[16px] font-semibold leading-[1.5] text-[#243832]">
                  {option.label}
                </span>
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                    selected ? "border-[#36534E] bg-[#36534E] text-white" : "border-[#C7D1C2]"
                  }`}
                >
                  {selected ? <Check className="h-4 w-4" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {last ? (
        <button
          type="button"
          disabled={!isCompleteWeddingCodeV06(answers)}
          onClick={() => setStep("result")}
          className={`${primaryButton} mt-5 w-full`}
        >
          결과 보기
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </button>
      ) : null}

      {!last && done === WEDDING_CODE_V06_QUESTIONS.length ? (
        <button
          type="button"
          onClick={() => setStep("result")}
          className={`${secondaryButton} mt-5 w-full`}
        >
          다 골랐어요 — 결과 보기
        </button>
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-[#FBF8F2] px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-[560px]">{children}</div>
    </main>
  );
}

function ResultView({
  answers,
  theirs,
  shareOrigin,
  partnerCode,
  copied,
  onCopied,
  onRestart,
}: {
  answers: WeddingCodeV06Answers;
  theirs: WeddingCodeV06Answers | null;
  shareOrigin: string;
  partnerCode: string | null;
  copied: boolean;
  onCopied: (value: boolean) => void;
  onRestart: () => void;
}) {
  const mineCode = encodeWeddingCodeV06(answers);
  // 상대 답이 이미 있으면 둘 다 담아 돌려준다 — 그래야 상대도 같은 화면을 본다.
  const shareUrl = theirs && partnerCode
    ? buildWeddingCodeV06ShareUrl(shareOrigin, partnerCode, mineCode)
    : buildWeddingCodeV06ShareUrl(shareOrigin, mineCode);

  const copyButton = (
    <div className="mt-5">
      <button
        type="button"
        data-share-url={shareUrl}
        onClick={() => {
          void navigator.clipboard?.writeText?.(shareUrl).then(
            () => onCopied(true),
            () => onCopied(false),
          );
        }}
        className={`${primaryButton} w-full`}
      >
        {copied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
        {copied ? "링크를 복사했어요" : theirs ? "결과 링크 상대에게 보내기" : "상대에게 링크 보내기"}
      </button>
      <p className="mt-2 text-[12px] font-medium leading-[1.6] text-[#8F6662]">
        {theirs
          ? "이 링크를 열면 상대도 지금 이 화면을 그대로 봐요."
          : "상대가 이 링크로 답하면, 두 사람이 어디서 갈렸는지 나와요."}
      </p>
    </div>
  );

  if (!theirs) {
    const quotes = ownAnswerQuotes(answers, 3);
    return (
      <>
        <section className={`${surface} px-6 py-7`} data-result="solo">
          <p className="text-[12px] font-semibold tracking-[0.16em] text-[#8F6662]">
            내가 고른 문장
          </p>
          <h1 className="mt-3 text-[22px] font-semibold leading-[1.4] text-[#243832]">
            열여섯 장면에서 나는 이렇게 답했어요
          </h1>
          <div className="mt-6 space-y-5">
            {quotes.map((quote) => (
              <div key={quote.scene}>
                <p className="text-[13px] font-medium leading-[1.5] text-[#8F6662]">
                  {quote.scene}
                </p>
                <p className="mt-1.5 text-[17px] font-semibold leading-[1.5] text-[#243832]">
                  “{quote.label}”
                </p>
              </div>
            ))}
          </div>
          <p className="mt-7 text-[13px] font-medium leading-[1.7] text-[#36534E]">
            여기까지는 혼자 본 거예요. <b className="font-semibold text-[#243832]">진짜는 둘이 어디서
            갈렸는지</b>인데, 그건 상대도 답해야 나와요.
          </p>
        </section>
        {copyButton}
        <button type="button" onClick={onRestart} className={`${secondaryButton} mt-4 w-full`}>
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          다시 답하기
        </button>
      </>
    );
  }

  const map = buildWeddingCodeV06GapMap(theirs, answers);
  // 상위 3개를 그냥 자르면 전부 같은 축이 나와 같은 문장이 세 번 반복된다.
  const top = topGapsForDisplay(map, 3);

  return (
    <>
      <section className={`${surface} overflow-hidden`} data-result="couple">
        <div className="bg-[#243832] px-5 py-7 text-white sm:px-8">
          <p className="text-[12px] font-semibold tracking-[0.16em] text-[#C7D1C2]">웨딩코드</p>
          <h1 className="mt-3 text-[24px] font-semibold leading-[1.35] sm:text-[28px]">
            {map.splits.length > 0
              ? `열여섯 장면 중 ${map.splits.length}곳에서 갈렸어요`
              : "열여섯 장면에서 방향이 같았어요"}
          </h1>
          <p className="mt-3 text-[15px] font-medium leading-[1.65] text-[#F7F1E8]">
            어느 쪽이 맞는지는 없어요. 갈린 자리를 미리 아는 게 전부예요.
          </p>
        </div>

        {top.length > 0 ? (
          <div className="divide-y divide-[#EFE4D7]">
            {top.map((gap) => {
              const described = describeGap(gap, { first: "상대", second: "나" });
              return (
                <article key={gap.key} data-gap={gap.key} className="px-5 py-6 sm:px-8">
                  {/* 주제 이름이지 유형 이름이 아니다 — 「…형이에요」로 읽히면 안 된다. */}
                  <p className="text-[12px] font-semibold tracking-[0.02em] text-[#6D806E]">
                    {described.headline}
                  </p>
                  <p className="mt-2 text-[13px] font-medium leading-[1.5] text-[#8F6662]">
                    {gap.scene}
                  </p>
                  <div className="mt-4 space-y-2.5">
                    {described.quotes.map((quote) => (
                      <p
                        key={quote}
                        className="rounded-[12px] bg-[#F7F1E8] px-4 py-3 text-[15px] font-semibold leading-[1.5] text-[#243832]"
                      >
                        {quote}
                      </p>
                    ))}
                  </div>
                  <p className="mt-4 text-[13px] font-medium leading-[1.7] text-[#36534E]">
                    {described.nextScene}
                  </p>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="px-5 py-6 sm:px-8">
            <p className="text-[15px] font-medium leading-[1.7] text-[#36534E]">
              열여섯 장면 모두 같은 방향으로 답했어요. 그래도 문장까지 똑같았던 건{" "}
              {map.identical.length}곳이에요 — 나머지는 같은 쪽을 보면서 다른 말로 표현한
              자리예요.
            </p>
          </div>
        )}

        {map.identical.length > 0 ? (
          <div className="border-t border-[#EFE4D7] bg-[#FBF8F2] px-5 py-5 sm:px-8">
            <p className="text-[12px] font-semibold text-[#8F6662]">토씨까지 같았던 곳</p>
            <p className="mt-1.5 text-[15px] font-semibold leading-[1.5] text-[#243832]">
              “{map.identical[0].firstLabel}”
            </p>
            <p className="mt-1 text-[13px] font-medium text-[#8F6662]">
              {map.identical[0].scene}
              {map.identical.length > 1 ? ` 외 ${map.identical.length - 1}곳` : ""}
            </p>
          </div>
        ) : null}
      </section>

      {map.splits.length > 3 ? (
        <p className="mt-4 text-center text-[13px] font-medium text-[#8F6662]">
          갈린 자리 {map.splits.length}곳 중, 주제가 겹치지 않게 {top.length}곳만 골랐어요.
        </p>
      ) : null}

      {copyButton}
      <button type="button" onClick={onRestart} className={`${secondaryButton} mt-4 w-full`}>
        <RotateCcw aria-hidden="true" className="h-4 w-4" />
        내 답 다시 고르기
      </button>
    </>
  );
}
