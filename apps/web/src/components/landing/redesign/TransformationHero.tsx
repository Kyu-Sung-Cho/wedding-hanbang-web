"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ListChecks,
  LockKeyhole,
  MessageCircle,
  RotateCcw,
  Sparkles,
  WalletCards,
} from "lucide-react";

import { captureEvent } from "@/lib/analytics";

import { landingContent, preparationRecords } from "./landingContent";

const shell = "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";
const amoraStartHref = "/start-here";

type DemoState = "conversation" | "review" | "saved";

const recordIcons = {
  budget: WalletCards,
  task: ListChecks,
  schedule: CalendarDays,
} as const;

export default function TransformationHero() {
  return (
    <section
      className="relative isolate overflow-hidden bg-[#243832] text-white"
      aria-labelledby="landing-hero-title"
    >
      <div className="absolute inset-y-0 right-0 -z-20 w-full opacity-48 sm:opacity-56 lg:w-[58%] lg:opacity-72">
        <Image
          src="/images/wedding-celebration-hero.webp"
          alt="함께 결혼식장으로 걸어가는 두 사람"
          fill
          priority
          sizes="(min-width: 1024px) 58vw, 100vw"
          className="object-cover object-[62%_center]"
        />
      </div>
      <div
        className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,#243832_0%,rgba(36,56,50,0.98)_38%,rgba(36,56,50,0.62)_72%,rgba(36,56,50,0.28)_100%)] lg:bg-[linear-gradient(90deg,#243832_0%,#243832_35%,rgba(36,56,50,0.76)_62%,rgba(36,56,50,0.18)_100%)]"
        aria-hidden="true"
      />
      <div
        className="absolute inset-x-0 bottom-0 -z-10 h-48 bg-gradient-to-t from-[#243832] to-transparent"
        aria-hidden="true"
      />

      <div
        className={`${shell} grid gap-10 pb-16 pt-10 sm:gap-14 sm:pb-20 sm:pt-14 lg:min-h-[min(820px,calc(100svh-4rem))] lg:grid-cols-[minmax(0,0.95fr)_minmax(520px,1.05fr)] lg:items-center lg:gap-10 lg:py-16 xl:gap-12`}
      >
        <div className="relative z-10 max-w-[610px] animate-fade-in motion-reduce:animate-none">
          <p className="flex items-center gap-3 text-[12px] font-semibold text-[#E2D3C8] sm:text-[13px]">
            <span className="h-px w-8 bg-[#A77B74]" aria-hidden="true" />
            {landingContent.hero.eyebrow}
          </p>

          <h1
            id="landing-hero-title"
            className="mt-6 text-[clamp(3rem,14vw,5.8rem)] font-semibold leading-[0.94] tracking-[-0.06em] text-white sm:mt-8"
          >
            <span className="block text-[0.7em] leading-none tracking-[-0.045em] text-white/88">
              둘이 말하면,
            </span>
            <span className="mt-3 block text-[#E2D3C8] sm:mt-4">결혼 준비가</span>
            <span className="mt-1 block">정리돼요.</span>
          </h1>

          <p className="mt-6 text-[16px] font-semibold leading-7 text-white sm:text-[18px]">
            {landingContent.hero.emotionalLine}
          </p>

          <p className="mt-3 max-w-[35rem] text-[15px] leading-[1.75] text-white/78 sm:text-[17px]">
            {landingContent.hero.body}
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3 border-y border-white/16 py-4 text-[13px] font-semibold text-white/82 sm:mt-8 sm:gap-x-7">
            <span>예산</span>
            <span className="h-1 w-1 rounded-full bg-[#A77B74]" aria-hidden="true" />
            <span>할 일</span>
            <span className="h-1 w-1 rounded-full bg-[#A77B74]" aria-hidden="true" />
            <span>일정</span>
            <span className="ml-auto text-[#E2D3C8]">확인 후 저장</span>
          </div>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <Link
              href={amoraStartHref}
              onClick={() =>
                captureEvent("landing_amora_start_click", {
                  source: "landing_hero",
                })
              }
              className="group inline-flex min-h-[60px] w-full items-center justify-between gap-5 rounded-[16px] bg-[#8F6662] px-5 text-[16px] font-semibold text-white shadow-[0_20px_48px_rgba(0,0,0,0.28)] transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-[#7D5753] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2D3C8] focus-visible:ring-offset-4 focus-visible:ring-offset-[#243832] sm:w-auto sm:min-w-[300px]"
            >
              {landingContent.hero.primaryAction}
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15">
                <ArrowRight
                  className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transform-none"
                  aria-hidden="true"
                />
              </span>
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center justify-center text-[14px] font-semibold text-white/82 underline decoration-white/30 underline-offset-4 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2D3C8] focus-visible:ring-offset-4 focus-visible:ring-offset-[#243832]"
            >
              {landingContent.hero.secondaryAction}
            </Link>
          </div>

          <p className="mt-4 flex items-start gap-2 text-[13px] font-medium leading-5 text-white/82">
            <LockKeyhole
              className="mt-0.5 h-4 w-4 shrink-0 text-[#E2D3C8]"
              aria-hidden="true"
            />
            첫 준비 화면의 날짜는 서버로 보내지 않아요 · 질문을 보내기 전에는 AI를 호출하지 않아요
          </p>
        </div>

        <ConversationToPlanDemo />
      </div>
    </section>
  );
}

function ConversationToPlanDemo() {
  const [demoState, setDemoState] = useState<DemoState>("conversation");

  const showReview = () => setDemoState("review");
  const showSavedState = () => {
    setDemoState("saved");
    captureEvent("landing_amora_demo_apply_click", {
      source: "landing_hero_demo",
    });
  };

  return (
    <div
      className="relative z-10 min-w-0 animate-fade-in motion-reduce:animate-none lg:translate-y-4 lg:scale-[1.025]"
      aria-label="대화를 예산, 할 일, 일정으로 정리하는 기능 예시"
    >
      <div className="overflow-hidden rounded-[24px] border border-white/30 bg-[#FBF8F2] text-[#243832] shadow-[0_32px_90px_rgba(0,0,0,0.34)] sm:rounded-[28px]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#243832]/10 bg-white/80 px-4 py-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#36534E] text-white"
              aria-hidden="true"
            >
              <MessageCircle className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-[#243832]">
                {landingContent.demo.coupleRoom}
              </p>
              <p className="mt-0.5 text-[12px] font-medium text-[#4E6A62]">
                아모라가 함께 듣고 정리해요
              </p>
            </div>
          </div>
          <span className="inline-flex min-h-8 items-center rounded-full border border-[#8F6662]/20 bg-[#F3E9DD] px-3 text-[11px] font-semibold text-[#7D5753]">
            직접 눌러보는 예시
          </span>
        </div>

        <ol className="grid grid-cols-3 border-b border-[#243832]/10 bg-[#F7F1E8] px-4 py-3 sm:px-6" aria-label="기능 예시 진행 단계">
          {[
            ["conversation", "1", "둘이 말하기"],
            ["review", "2", "아모라가 정리"],
            ["saved", "3", "확인한 뒤 저장"],
          ].map(([state, number, label]) => {
            const stateOrder = { conversation: 0, review: 1, saved: 2 } as const;
            const active = stateOrder[demoState] >= stateOrder[state as DemoState];
            return (
              <li
                key={state}
                className={`flex items-center gap-2 text-[11px] font-semibold sm:text-[12px] ${active ? "text-[#243832]" : "text-[#36534E]/45"}`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] ${active ? "bg-[#36534E] text-white" : "border border-[#243832]/14 bg-white text-[#36534E]/50"}`}
                >
                  {number}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </li>
            );
          })}
        </ol>

        <div className="grid min-h-[430px] lg:grid-cols-[0.9fr_1.1fr]">
          <div className="border-b border-[#243832]/10 bg-white px-4 py-5 sm:px-6 lg:border-b-0 lg:border-r">
            <p className="text-[11px] font-semibold text-[#8F6662]">둘의 대화</p>
            <div className="mt-5 space-y-4">
              {landingContent.demo.conversation.map((line, index) => (
                <div
                  key={line.speaker}
                  className={`flex items-end gap-2 ${index % 2 === 0 ? "justify-end" : "justify-start"}`}
                >
                  {index % 2 !== 0 ? (
                    <span className="text-[11px] font-semibold text-[#4E6A62]">
                      {line.speaker}
                    </span>
                  ) : null}
                  <p
                    className={`max-w-[82%] px-3.5 py-3 text-[13px] font-medium leading-[1.5] ${index % 2 === 0 ? "rounded-[16px] rounded-br-[5px] bg-[#F3E9DD] text-[#243832]" : "rounded-[16px] rounded-bl-[5px] bg-[#36534E] text-white"}`}
                  >
                    {line.message}
                  </p>
                  {index % 2 === 0 ? (
                    <span className="text-[11px] font-semibold text-[#4E6A62]">
                      {line.speaker}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="mt-6 flex items-start gap-3 border-t border-[#243832]/10 pt-5">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#8F6662]" aria-hidden="true" />
              <p className="text-[12px] leading-5 text-[#4E6A62]">
                아모라가 대화에서 준비에 필요한 내용을 찾아 정리해요.
              </p>
            </div>
          </div>

          <div className="flex flex-col bg-[#FBF8F2] px-4 py-5 sm:px-6" aria-live="polite">
            {demoState === "conversation" ? (
              <div className="flex flex-1 flex-col justify-between animate-fade-in motion-reduce:animate-none">
                <div>
                  <p className="text-[11px] font-semibold text-[#8F6662]">아모라의 정리</p>
                  <h2 className="mt-3 text-[22px] font-semibold leading-[1.25] tracking-[-0.025em] text-[#243832]">
                    두 사람의 말에서
                    <br />세 가지 준비를 찾았어요.
                  </h2>
                  <p className="mt-3 text-[13px] leading-6 text-[#4E6A62]">
                    아직 저장하지 않았어요. 무엇이 정리됐는지 먼저 확인해보세요.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={showReview}
                  className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-[#36534E] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#243832] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FBF8F2]"
                >
                  정리한 내용 보기
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ) : null}

            {demoState === "review" ? (
              <div className="flex flex-1 flex-col animate-fade-in motion-reduce:animate-none">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold text-[#8F6662]">저장 전 확인</p>
                    <h2 className="mt-1 text-[18px] font-semibold text-[#243832]">
                      이렇게 정리할까요?
                    </h2>
                  </div>
                  <span className="text-[11px] font-semibold text-[#4E6A62]">3개</span>
                </div>
                <ul className="mt-4 border-y border-[#243832]/12">
                  {preparationRecords.map((record) => {
                    const Icon = recordIcons[record.id];
                    return (
                      <li
                        key={record.id}
                        className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border-b border-[#243832]/10 py-3.5 last:border-b-0"
                      >
                        <span className="flex h-8 w-8 items-center justify-center text-[#8F6662]">
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <div>
                          <p className="text-[11px] font-semibold text-[#4E6A62]">{record.label}</p>
                          <p className="mt-0.5 text-[13px] font-semibold leading-5 text-[#243832]">{record.value}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  onClick={showSavedState}
                  className="mt-auto inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-[#8F6662] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#7D5753] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FBF8F2]"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  확인하고 저장 흐름 보기
                </button>
              </div>
            ) : null}

            {demoState === "saved" ? (
              <div className="flex flex-1 flex-col items-start justify-center animate-fade-in motion-reduce:animate-none">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#6D806E] text-white" aria-hidden="true">
                  <Check className="h-5 w-5" />
                </span>
                <p className="mt-5 text-[11px] font-semibold text-[#4E6A62]">확인 완료</p>
                <h2 className="mt-2 text-[23px] font-semibold leading-[1.28] tracking-[-0.025em] text-[#243832]">
                  확인한 준비만
                  <br />이렇게 남아요.
                </h2>
                <p className="mt-3 text-[13px] leading-6 text-[#4E6A62]">
                  실제 서비스에서는 예산·할 일·일정에서 이어서 관리할 수 있어요.
                </p>
                <button
                  type="button"
                  onClick={() => setDemoState("conversation")}
                  className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full border border-[#36534E]/18 bg-white px-4 text-[12px] font-semibold text-[#36534E] transition-colors hover:border-[#8F6662] hover:text-[#8F6662] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FBF8F2]"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  처음부터 다시 보기
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <p className="border-t border-[#243832]/10 bg-white px-4 py-3 text-center text-[12px] font-medium leading-5 text-[#4E6A62] sm:px-6">
          {landingContent.demo.boundary}
        </p>
      </div>
    </div>
  );
}
