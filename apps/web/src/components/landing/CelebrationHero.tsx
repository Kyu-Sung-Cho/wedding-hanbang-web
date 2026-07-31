"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  LockKeyhole,
  MessageCircle,
  RotateCcw,
} from "lucide-react";

import { captureEvent } from "@/lib/analytics";

const shell = "mx-auto w-full max-w-[1160px] px-5 sm:px-8 lg:px-10";
const amoraStartHref = "/login?mode=signup&redirect=%2Fwedding%2Fchat";

export default function CelebrationHero() {
  return (
    <section
      className="relative isolate overflow-hidden bg-[#F7F1E8] text-[#243832]"
      aria-labelledby="celebration-hero-title"
    >
      <div
        className="pointer-events-none absolute -left-32 top-12 -z-10 h-80 w-80 rounded-full bg-[#E2D3C8]/28 blur-3xl"
        aria-hidden="true"
      />

      <div
        className={`${shell} grid gap-10 py-8 sm:gap-14 sm:py-12 lg:min-h-[min(780px,calc(100svh-7rem))] lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] lg:items-center lg:gap-14 lg:py-14 xl:gap-20`}
      >
        <div className="relative z-20 min-w-0 max-w-[540px] animate-fade-in motion-reduce:animate-none">
          <p className="flex items-center gap-3 text-[12px] font-semibold tracking-[-0.01em] text-[#36534E] sm:text-[13px]">
            <span
              className="h-px w-8 shrink-0 bg-[#8F6662]"
              aria-hidden="true"
            />
            둘이 함께 쓰는 결혼 준비 AI · 아모라
          </p>

          <h1
            id="celebration-hero-title"
            className="mt-5 tracking-[-0.055em] text-[#243832] sm:mt-7"
          >
            <span className="block text-[clamp(2rem,9vw,2.5rem)] font-medium leading-[1.05]">
              우리, 정말 결혼하는구나.
            </span>
            <span className="mt-3 block text-[clamp(2.1rem,10vw,3.35rem)] font-semibold leading-[1.08] sm:mt-4">
              둘이 말하면 준비가{" "}
              <span className="text-[#8F6662]">하나로</span> 정리돼요.
            </span>
          </h1>

          <p className="mt-5 max-w-[33rem] text-[15px] font-normal leading-[1.72] text-[#36534E] sm:mt-6 sm:text-[16px]">
            둘이 같은 채팅에서 말하면 아모라가 예산·할 일·일정을 제안해요.
            바뀌는 내용을 먼저 보여주고, 확인한 변경만 함께 반영해요.
          </p>

          <div
            className="mt-6 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1.15fr)] items-center gap-1.5 border-y border-[#243832]/12 py-3.5 sm:mt-7 sm:gap-2.5 sm:py-4"
            aria-label="아모라와 함께 준비하는 세 단계"
          >
            <p className="text-center text-[12px] font-semibold leading-[1.35] text-[#243832] sm:text-[13px]">
              둘이 말해요
            </p>
            <ArrowRight
              className="h-3.5 w-3.5 shrink-0 text-[#8F6662]"
              aria-hidden="true"
            />
            <p className="text-center text-[12px] font-semibold leading-[1.35] text-[#243832] sm:text-[13px]">
              아모라가 정리해요
            </p>
            <ArrowRight
              className="h-3.5 w-3.5 shrink-0 text-[#8F6662]"
              aria-hidden="true"
            />
            <p className="text-center text-[12px] font-semibold leading-[1.35] text-[#243832] sm:text-[13px]">
              확인 후 함께 반영해요
            </p>
          </div>

          <div className="mt-5 flex flex-col gap-2.5 sm:mt-7 sm:flex-row sm:items-center sm:gap-5">
            <Link
              href={amoraStartHref}
              onClick={() =>
                captureEvent("landing_amora_start_click", {
                  source: "landing_hero",
                })
              }
              className="group inline-flex min-h-14 w-full items-center justify-between gap-4 rounded-[16px] bg-[#8F6662] px-5 text-[15px] font-semibold text-white shadow-[0_12px_28px_rgba(143,102,98,0.22)] transition-[background-color,box-shadow] duration-200 hover:bg-[#7D5753] hover:shadow-[0_16px_34px_rgba(125,87,83,0.24)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-4 focus-visible:ring-offset-[#F7F1E8] sm:w-auto sm:min-w-60"
            >
              <span>우리 둘 준비 시작하기</span>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/16">
                <ArrowRight
                  className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transform-none"
                  aria-hidden="true"
                />
              </span>
            </Link>
            <Link
              href="/start-here"
              className="inline-flex min-h-11 items-center justify-center px-1 text-center text-[14px] font-semibold leading-5 text-[#36534E] underline decoration-[#36534E]/30 underline-offset-4 transition-colors hover:text-[#8F6662] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-4 focus-visible:ring-offset-[#F7F1E8]"
            >
              로그인 없이 준비 순서 보기
            </Link>
          </div>

          <p className="mt-4 flex items-start gap-2 text-[12px] font-medium leading-5 text-[#36534E] sm:text-[13px]">
            <LockKeyhole
              className="mt-0.5 h-4 w-4 shrink-0 text-[#8F6662]"
              aria-hidden="true"
            />
            나만 상담은 파트너에게 보이지 않아요
          </p>
        </div>

        <CoupleRoomPreview />
      </div>
    </section>
  );
}

function CoupleRoomPreview() {
  const [demoApplied, setDemoApplied] = useState(false);

  const applyDemoSchedule = () => {
    setDemoApplied(true);
    captureEvent("landing_amora_demo_apply_click", {
      source: "landing_hero_demo",
    });
  };

  return (
    <div
      className="relative min-h-[700px] min-w-0 w-full animate-fade-in motion-reduce:animate-none sm:min-h-[720px] lg:min-h-[660px]"
      aria-label="로그인 없이 체험하는 커플 공동 채팅 기능 예시"
    >
      <div className="absolute inset-x-0 top-0 h-[540px] overflow-hidden rounded-[24px] bg-[#243832] shadow-[0_26px_70px_rgba(36,56,50,0.16)] sm:h-[580px] sm:rounded-[28px] lg:inset-y-0 lg:h-auto lg:rounded-[32px]">
        <picture className="absolute inset-0 block h-full w-full">
          <source
            media="(max-width: 1024px) and (orientation: portrait)"
            srcSet="/images/wedding-celebration-hero-mobile.webp"
          />
          <img
            src="/images/wedding-celebration-hero.webp"
            alt="손을 잡고 함께 결혼식장으로 들어가는 신랑과 신부"
            className="h-full w-full object-cover object-center lg:object-[64%_center]"
            style={{ height: "100%", width: "100%" }}
            fetchPriority="high"
            decoding="async"
          />
        </picture>
        <div
          className="absolute inset-0 bg-[linear-gradient(180deg,rgba(36,56,50,0.02)_55%,rgba(36,56,50,0.5)_100%)]"
          aria-hidden="true"
        />
        <div className="absolute right-4 top-4 rounded-full border border-white/25 bg-[#243832]/88 px-3.5 py-2 text-right text-white shadow-lg backdrop-blur-sm sm:right-5 sm:top-5">
          <p className="text-[11px] font-medium text-white/82">결혼식까지</p>
          <p className="mt-0.5 text-[22px] font-semibold tracking-[-0.04em]">
            D-184
          </p>
        </div>
      </div>

      <div className="absolute inset-x-3 bottom-0 overflow-hidden rounded-[22px] border border-white/90 bg-white/96 shadow-[0_24px_65px_rgba(36,56,50,0.2)] backdrop-blur-md sm:left-7 sm:right-auto sm:w-[82%] sm:max-w-[480px] sm:rounded-[26px] lg:-left-10 lg:bottom-7 lg:w-[78%]">
        <div className="flex items-center gap-3 border-b border-[#243832]/10 px-4 py-3.5 sm:px-5 sm:py-4">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#36534E] text-white"
            aria-hidden="true"
          >
            <MessageCircle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold leading-5 text-[#243832] sm:text-[14px]">
              민지 · 현우의 공동 채팅
            </p>
            <p className="text-[11px] font-medium leading-4 text-[#36534E] sm:text-[12px]">
              함께 대화 · 기능 예시 · 로그인 없이 눌러보세요
            </p>
          </div>
        </div>

        <div className="space-y-3 px-4 py-4 sm:px-5">
          <div className="flex items-end justify-end gap-2">
            <span className="text-[11px] font-medium text-[#36534E]">민지</span>
            <p className="max-w-[78%] rounded-[16px] rounded-br-[5px] bg-[#F3E9DD] px-3.5 py-2.5 text-[13px] font-medium leading-[1.45] text-[#243832]">
              드레스 투어, 10월 17일 오후 어때?
            </p>
          </div>

          <div className="flex items-end gap-2">
            <p className="max-w-[82%] rounded-[16px] rounded-bl-[5px] bg-[#36534E] px-3.5 py-2.5 text-[13px] font-medium leading-[1.45] text-white">
              좋아. 아모라, 우리 일정에 넣어줘.
            </p>
            <span className="text-[11px] font-medium text-[#36534E]">현우</span>
          </div>
        </div>

        <div
          className="border-t border-[#243832]/10 bg-[#F7FAF5] px-4 py-4 sm:px-5"
          aria-live="polite"
        >
          {demoApplied ? (
            <div className="animate-fade-in motion-reduce:animate-none">
              <div className="flex items-center gap-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#6D806E] text-white"
                  aria-hidden="true"
                >
                  <Check className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-[14px] font-semibold text-[#243832]">
                    공동 일정에 추가됐어요
                  </p>
                  <p className="mt-0.5 text-[12px] leading-5 text-[#36534E]">
                    10월 17일(토) 오후 2시 · 드레스 투어
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDemoApplied(false)}
                className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full border border-[#36534E]/18 bg-white px-4 text-[12px] font-semibold text-[#36534E] transition-colors hover:border-[#8F6662] hover:text-[#8F6662] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F7FAF5]"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                다시 보기
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <CalendarDays
                  className="mt-0.5 h-5 w-5 shrink-0 text-[#8F6662]"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-[#36534E]">
                    아모라의 일정 제안 · 변경 전 확인
                  </p>
                  <p className="mt-1 text-[13px] font-semibold leading-5 text-[#243832]">
                    10월 17일(토) 오후 2시 ‘드레스 투어’를 공동 일정에
                    추가할까요?
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={applyDemoSchedule}
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[14px] bg-[#36534E] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#243832] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F7FAF5]"
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                이대로 적용
              </button>
            </>
          )}
        </div>

        <p className="border-t border-[#243832]/8 bg-[#FBF8F2] px-4 py-2.5 text-center text-[11px] font-medium leading-4 text-[#36534E] sm:px-5">
          기능 예시이며 실제로 저장되지 않아요
        </p>
      </div>
    </div>
  );
}
