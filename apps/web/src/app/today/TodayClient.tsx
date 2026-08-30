"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, RotateCcw, Shuffle } from "lucide-react";

import {
  TODAY_GIVE_LINE,
  TODAY_OPENING_LINE,
  drawThree,
  type TodayCard,
} from "@/lib/todayOneLine/deck";

type Step = "pick" | "give" | "face";

const surface = "rounded-[6px] border border-[var(--hb-hairline)] bg-white";
const primaryButton =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-6"
  + " text-[15px] font-semibold text-white transition-colors duration-150 ease-out"
  + " hover:bg-[var(--hb-primary)] active:-translate-y-[3px] motion-reduce:transform-none"
  + " focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-primary)]"
  + " focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40";
const secondaryButton =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[6px] border"
  + " border-[#C7D1C2] bg-white px-5 text-[14px] font-semibold text-[var(--hb-text-strong)]"
  + " transition-colors duration-150 ease-out hover:bg-[var(--hb-surface-hover)]"
  + " active:-translate-y-[3px] motion-reduce:transform-none focus-visible:outline-none"
  + " focus-visible:ring-2 focus-visible:ring-[var(--hb-primary)] focus-visible:ring-offset-2";
// 밑줄은 여기 넣지 않는다. `underline`과 `no-underline`을 같은 요소에 겹치면 어느 쪽이
// 이기는지가 클래스 문자열 순서가 아니라 생성된 CSS 순서로 정해져서 밑줄이 남는다.
const quietLink =
  "inline-flex min-h-[44px] items-center justify-center rounded-[6px] px-3 text-[13px]"
  + " font-semibold text-[#8F6662] transition-colors"
  + " hover:text-[var(--hb-text-strong)] focus-visible:outline-none focus-visible:ring-2"
  + " focus-visible:ring-[var(--hb-primary)] focus-visible:ring-offset-2";

/**
 * 「오늘 한 마디」.
 *
 * 설문이 없다. 들어오면 **세 장이 뽑혀 있고** 그중 하나를 고른다. 그다음 상대가 나한테
 * 물어줄 한 장을 고른다 — 준비 얘기를 꺼내는 사람이 늘 같은 사람인 비대칭을 뒤집는
 * 장치이고 이 제품 재미의 핵심이다.
 *
 * 28장을 한 목록에 늘어놓던 초판은 고르는 게 일이었고 첫 화면이 돈 카드로 도배됐다.
 * 세 장은 뽑기고 스물여덟 장은 노동이다. seed는 서버가 날짜로 계산해 내려주므로
 * SSR과 첫 렌더가 일치하고, 날이 바뀌면 세 장이 통째로 바뀐다.
 *
 * 점수·유형·궁합이 없고 응답을 수집하지 않는다. 상태는 화면 안에만 있다.
 * 연구 프로토타입 코드를 일절 import하지 않는다(격리 펜스가 강제한다).
 */
export default function TodayClient({
  shareOrigin,
  seed,
}: {
  shareOrigin: string;
  seed: number;
}) {
  const [step, setStep] = useState<Step>("pick");
  const [round, setRound] = useState(0);
  const [giveRound, setGiveRound] = useState(0);
  const [mine, setMine] = useState<TodayCard | null>(null);
  const [theirs, setTheirs] = useState<TodayCard | null>(null);
  const [draft, setDraft] = useState<TodayCard | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl = theirs ? `${shareOrigin}/today/from?c=${theirs.id}` : "";

  function restart() {
    setStep("pick");
    setRound(0);
    setGiveRound(0);
    setMine(null);
    setTheirs(null);
    setDraft(null);
    setCopied(false);
  }

  if (step === "face" && mine) {
    return (
      <Shell>
        <CardFace card={mine} />

        <div className="mx-auto mt-6 w-full max-w-[340px]">
          <p className="text-[15px] font-semibold leading-[1.7] text-[var(--hb-text-strong)]">
            오늘은 이 한 문장만 꺼내도 충분해요.
          </p>
          <p className="mt-2 text-[13px] font-medium leading-[1.7] text-[var(--color-rose-700)]">
            저희는 이 카드를 보관하지 않아요.
          </p>

          {theirs ? (
            <div className="mt-6 border-t border-[var(--hb-hairline)] pt-5">
              <p className="text-[12px] font-semibold text-[var(--color-rose-700)]">
                상대가 나한테 물어줄 한 마디
              </p>
              <p className="mt-1.5 text-[16px] font-semibold leading-[1.5] text-[var(--hb-text-strong)]">
                {theirs.say}
              </p>
              {/*
                링크 원문은 화면에 뿌리지 않는다. 회색 상자 속 raw URL은 제품이 아니라
                개발자 출력이고, 카드 id가 그대로 보여서 스크린샷을 보낸 순간 상대가
                열기 전에 어느 장인지 들킨다. 주소는 버튼이 들고 있는다.
              */}
              <button
                type="button"
                data-share-url={shareUrl}
                onClick={() => {
                  void navigator.clipboard?.writeText?.(shareUrl).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  );
                }}
                className={`${secondaryButton} mt-4 w-full`}
              >
                {copied ? (
                  <Check aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <Copy aria-hidden="true" className="h-4 w-4" />
                )}
                {copied ? "링크를 복사했어요" : "이 한 장 보낼 링크 복사"}
              </button>
              <p className="mt-2 text-[12px] font-medium leading-[1.6] text-[var(--color-rose-700)]">
                링크에는 이 한 장만 담겨요. 내가 고른 카드는 가지 않아요.
              </p>
            </div>
          ) : null}

          <button type="button" onClick={restart} className={`${secondaryButton} mt-6 w-full`}>
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            다시 고르기
          </button>
        </div>
      </Shell>
    );
  }

  const giving = step === "give";
  const drawn = giving
    ? drawThree(seed + 9973 + giveRound, mine ? [mine.id] : [])
    : drawThree(seed + round);

  return (
    <Shell>
      <section className={`${surface} overflow-hidden`}>
        <div className="bg-[var(--hb-primary)] px-5 py-7 text-white sm:px-8">
          <p className="text-[12px] font-semibold tracking-[0.16em] text-[#C7D1C2]">
            오늘 한 마디
          </p>
          <h1 className="mt-3 text-[24px] font-semibold leading-[1.35] sm:text-[28px]">
            {giving ? "이번엔 상대가 나한테 물어줄 한 장" : "오늘 꺼낼 한 마디를 골라주세요"}
          </h1>
          <p className="mt-3 text-[15px] font-medium leading-[1.65] text-[#F7F1E8]">
            {giving ? TODAY_GIVE_LINE : TODAY_OPENING_LINE}
          </p>
        </div>

        {giving && mine ? (
          <div className="border-b border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] px-5 py-3 sm:px-8">
            <p className="text-[12px] font-semibold text-[var(--color-rose-700)]">내가 물어볼 한 마디</p>
            <p className="mt-1 truncate text-[14px] font-semibold text-[var(--hb-text-strong)]">{mine.say}</p>
          </div>
        ) : null}

        <div className="divide-y divide-[var(--hb-hairline)]">
          {drawn.map((card) => {
            const selected = draft?.id === card.id;
            return (
              <button
                key={card.id}
                type="button"
                data-card={card.id}
                aria-pressed={selected}
                onClick={() => setDraft(card)}
                className={`flex min-h-[88px] w-full items-center justify-between gap-3 px-5 py-5 text-left transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--hb-primary)] sm:px-8 ${
                  selected ? "bg-[var(--hb-surface-hover)]" : "bg-white hover:bg-[var(--hb-surface-page)]"
                }`}
              >
                <span>
                  <span className="block text-[13px] font-medium leading-[1.5] text-[var(--color-rose-700)]">
                    {card.scene}
                  </span>
                  <span className="mt-1.5 block text-[17px] font-semibold leading-[1.5] text-[var(--hb-text-strong)]">
                    {card.say}
                  </span>
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

        <div className="border-t border-[var(--hb-hairline)] px-5 py-3 text-center sm:px-8">
          <button
            type="button"
            data-shuffle="true"
            onClick={() => {
              setDraft(null);
              if (giving) setGiveRound((value) => value + 1);
              else setRound((value) => value + 1);
            }}
            className={`${quietLink} gap-1.5`}
          >
            <Shuffle aria-hidden="true" className="h-4 w-4" />셋 다 아니면, 다른 세 장
          </button>
        </div>
      </section>

      {/*
        모바일 390px에서 버튼 셋을 한 줄에 넣으면 전부 두 줄로 깨진다.
        아래 줄은 항상 주버튼 하나(+뒤로)만 두고, 건너뛰기는 그 아래 텍스트 링크로 내린다.
      */}
      <div className="sticky bottom-0 mt-5 bg-gradient-to-t from-[var(--hb-surface-page)] via-[var(--hb-surface-page)] via-70% pb-3 pt-4">
        <div className="flex gap-3">
          {giving ? (
            <button
              type="button"
              onClick={() => {
                setDraft(mine);
                setStep("pick");
              }}
              className={`${secondaryButton} px-4`}
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              <span className="sr-only">이전 단계로</span>
            </button>
          ) : null}
          <button
            type="button"
            disabled={!draft}
            onClick={() => {
              if (!draft) return;
              if (giving) {
                setTheirs(draft);
                setStep("face");
                return;
              }
              setMine(draft);
              setDraft(null);
              setStep("give");
            }}
            className={`${primaryButton} flex-1`}
          >
            {giving ? "이 한 장 건네기" : "이 카드로 정하기"}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        {giving ? (
          <div className="mt-1 text-center">
            <button
              type="button"
              onClick={() => {
                setTheirs(null);
                setStep("face");
              }}
              className={`${quietLink} underline underline-offset-4`}
            >
              이번엔 안 고를게요
            </button>
          </div>
        ) : null}
      </div>
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

/** 카드 한 장. 스크린샷 한 장이 그대로 완성품이 되도록 출처까지 안에 넣는다. */
export function CardFace({ card }: { card: TodayCard }) {
  return (
    <section
      data-card-face={card.id}
      className={`${surface} mx-auto w-full max-w-[340px] px-6 py-7`}
    >
      <p className="text-[13px] font-medium leading-[1.5] text-[var(--color-rose-700)]">{card.scene}</p>
      <h2 className="mt-4 text-[24px] font-semibold leading-[1.4] text-[var(--hb-text-strong)]">{card.say}</h2>

      <div className="mt-6 border-t border-[var(--hb-hairline)] pt-4">
        <p className="text-[12px] font-semibold text-[var(--color-rose-700)]">언제</p>
        <p className="mt-1 text-[15px] font-medium leading-[1.6] text-[var(--hb-text-strong)]">{card.when}</p>
      </div>

      {card.check ? (
        <div className="mt-4 rounded-[6px] bg-[var(--hb-surface-hover)] px-4 py-3">
          <p className="text-[12px] font-semibold text-[#6D806E]">계약 전 확인할 것</p>
          <p className="mt-1 text-[13px] font-medium leading-[1.65] text-[var(--hb-text-strong)]">
            {card.check}
          </p>
        </div>
      ) : null}

      {/* 스크린샷 한 장이 어디서 왔는지 들고 다녀야 하므로 읽히는 색을 쓴다.
          연한 세이지(#C7D1C2)는 흰 배경에서 대비 2:1도 안 나와 캡처하면 사라진다. */}
      <p className="mt-6 text-[11px] font-semibold tracking-[0.14em] text-[var(--color-rose-700)]">
        오늘 한 마디 · hanbang.ai
      </p>
    </section>
  );
}
