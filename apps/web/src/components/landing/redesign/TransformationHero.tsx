"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  LockKeyhole,
  MessageCircle,
  RotateCcw,
  Sparkles,
} from "lucide-react";

import { captureEvent } from "@/lib/analytics";
import {
  clearStartHereDateHandoff,
  START_HERE_DATE_HANDOFF_KEY,
} from "@/lib/marketing/startHereDateHandoff";

import { landingContent } from "./landingContent";
import { displayHero, primaryActionMd, secondaryLinkOnDark } from "./landingType";

const shell = "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";
const amoraStartHref = "/start-here";

type DemoState = "proposal" | "saved";

export default function TransformationHero() {
  const router = useRouter();
  const [dateText, setDateText] = useState("");
  // 탭과 다음 화면 사이에 아무 반응이 없으면 사용자는 눌린 줄 모르고 다시 누른다.
  // 연타는 분석 이벤트와 sessionStorage 쓰기를 반복시키므로 첫 제출만 통과시킨다.
  const [isStarting, setIsStarting] = useState(false);

  const startWithDate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isStarting) return;
    setIsStarting(true);
    captureEvent("landing_amora_start_click", { source: "landing_hero" });
    if (!dateText) {
      clearStartHereDateHandoff();
      router.push(amoraStartHref);
      return;
    }

    try {
      window.sessionStorage.setItem(START_HERE_DATE_HANDOFF_KEY, dateText);
      router.push(amoraStartHref);
    } catch {
      // 저장소가 막힌 경우에는 전체 이동으로 fragment가 첫 렌더 전에 준비되게 한다.
      // fragment는 HTTP 요청에 포함되지 않으므로 날짜는 서버 URL로 전송되지 않는다.
      window.location.assign(`${amoraStartHref}#date=${encodeURIComponent(dateText)}`);
    }
  };

  return (
    <section
      className="relative isolate overflow-hidden bg-[#243832] text-white"
      aria-labelledby="landing-hero-title"
    >
      <div className="absolute inset-y-0 right-0 -z-20 w-full opacity-20 sm:opacity-25 lg:w-[58%] lg:opacity-[0.34]">
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
        className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,#243832_0%,rgba(36,56,50,0.99)_44%,rgba(36,56,50,0.82)_76%,rgba(36,56,50,0.58)_100%)] lg:bg-[linear-gradient(90deg,#243832_0%,#243832_42%,rgba(36,56,50,0.88)_70%,rgba(36,56,50,0.44)_100%)]"
        aria-hidden="true"
      />
      <div
        className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-[#243832] to-transparent"
        aria-hidden="true"
      />

      <div
        className={`${shell} grid gap-8 pb-12 pt-5 sm:gap-11 sm:pb-14 sm:pt-10 lg:min-h-[min(720px,calc(100svh-4rem))] lg:grid-cols-[minmax(0,0.94fr)_minmax(510px,1.06fr)] lg:items-center lg:gap-9 lg:py-8 xl:gap-12 xl:py-12`}
      >
        <div className="relative z-10 max-w-[610px]">
          <div
            role="group"
            aria-label="웨딩한방과 아모라의 역할"
            className="flex flex-col gap-2 text-[12px] font-bold tracking-[0.01em] sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
          >
            <span className="inline-flex w-fit items-center gap-2 text-white">
              <span className="h-1.5 w-1.5 rounded-full bg-[#A77B74]" aria-hidden="true" />
              {landingContent.hero.eyebrow}
            </span>
            <span className="hidden h-4 w-px bg-white/20 sm:block" aria-hidden="true" />
            <span className="inline-flex w-fit items-center gap-2 text-[#E2D3C8]">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {landingContent.hero.aiRole}
            </span>
          </div>

          <h1
            id="landing-hero-title"
            className={`mt-4 ${displayHero} text-white sm:mt-6`}
          >
            <span className="block text-[0.72em] leading-none tracking-[-0.045em] text-white/88">
              둘이 말하면,
            </span>
            <span className="mt-2.5 block text-[#E2D3C8] sm:mt-3">결혼 준비가</span>
            <span className="mt-1 block">정리돼요.</span>
          </h1>

          <p className="mt-4 max-w-[35rem] text-[16px] leading-[1.55] text-white/86 sm:mt-5 sm:leading-7">
            {landingContent.hero.body}
          </p>

          <form
            onSubmit={startWithDate}
            className="mt-4 rounded-[20px] border border-white/18 bg-white/10 p-3 shadow-raised backdrop-blur-sm sm:mt-5 sm:p-4"
          >
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
              <label htmlFor="landing-wedding-date" className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-3 text-[12px] font-semibold text-white/82">
                  결혼식 날짜
                  <span className="text-[#E2D3C8]">없어도 시작 가능</span>
                </span>
                <span className="mt-2 flex min-h-12 items-center gap-2 rounded-xl bg-white px-3 text-[#243832] transition-shadow duration-200 focus-within:ring-2 focus-within:ring-[#E2D3C8] focus-within:ring-offset-2 focus-within:ring-offset-[#243832]">
                  <CalendarDays className="h-4 w-4 shrink-0 text-[#8F6662]" aria-hidden="true" />
                  <input
                    id="landing-wedding-date"
                    type="date"
                    value={dateText}
                    onChange={(event) => setDateText(event.target.value)}
                    aria-describedby="landing-start-assurance"
                    className="min-h-12 min-w-0 flex-1 bg-transparent text-[16px] font-semibold text-[#243832] outline-none [color-scheme:light]"
                  />
                </span>
              </label>
              <button
                type="submit"
                aria-busy={isStarting}
                className={`${primaryActionMd} w-full justify-between focus-visible:ring-[#E2D3C8] focus-visible:ring-offset-2 focus-visible:ring-offset-[#243832] sm:w-auto sm:min-w-[190px]`}
              >
                {isStarting ? "여는 중…" : landingContent.hero.primaryAction}
                <ArrowRight
                  className="h-4 w-4 transition-transform duration-200 motion-safe:group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </button>
            </div>
            <div id="landing-start-assurance" className="mt-3 border-t border-white/12 pt-3">
              <ul className="grid gap-2 text-[12px] leading-5 text-white/82 sm:grid-cols-2">
                <li className="flex items-start gap-2">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#E2D3C8]" aria-hidden="true" />
                  로그인·결제 없이 지금 볼 세 가지 확인
                </li>
                <li className="flex items-start gap-2">
                  <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#E2D3C8]" aria-hidden="true" />
                  첫 날짜 계산은 이 브라우저에서 처리
                </li>
              </ul>
              {/* 44px 터치 대상을 문단 안 inline 요소에 주면 line box가 44px로
                  벌어져 링크가 혼자 줄을 차지하고 위아래로 빈 공간이 생긴다. 크기를
                  줄이는 대신 문단 밖으로 꺼내 블록으로 둔다 — 터치 대상은 유지된다. */}
              <p className="mt-2 text-[12px] leading-5 text-white/72">
                아모라에게 질문을 보내면 AI 처리·대화 저장 정책이 적용돼요.
              </p>
              {/* 계정 베타의 경계는 지우지 않되, 첫 행동을 가리지 않도록
                  CTA 아래에 둔다. 로그인 없는 첫 순서에는 적용되지 않는 조건이다. */}
              <p className="mt-1 text-[12px] leading-5 text-white/72">
                {landingContent.hero.betaBoundary}
              </p>
              <Link
                href="/privacy"
                className={`mt-2 ${secondaryLinkOnDark} focus-visible:ring-offset-2 focus-visible:ring-offset-[#243832]`}
              >
                처리 기준 보기
              </Link>
            </div>
          </form>

          <Link
            href={amoraStartHref}
            onClick={() => {
              clearStartHereDateHandoff();
              captureEvent("landing_amora_start_click", {
                source: "landing_hero_without_date",
              });
            }}
            className={`mt-2 ${secondaryLinkOnDark} focus-visible:ring-offset-4 focus-visible:ring-offset-[#243832]`}
          >
            날짜가 아직 없어요 · 둘이 맞출 기준부터 보기
          </Link>
        </div>

        <ConversationToPlanDemo />
      </div>
    </section>
  );
}

function ConversationToPlanDemo() {
  const [demoState, setDemoState] = useState<DemoState>("proposal");
  // 상태를 바꾸면 눌렀던 버튼이 언마운트된다. 그대로 두면 키보드 포커스가
  // document body로 떨어져 다음 Tab이 문서 맨 위로 간다. 사용자가 직접 누른
  // 경우에만 새로 렌더된 대응 버튼으로 포커스를 옮긴다(첫 렌더에서는 옮기지 않는다).
  const movedByUser = useRef(false);
  const applyButtonRef = useRef<HTMLButtonElement>(null);
  const resetButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!movedByUser.current) return;
    movedByUser.current = false;
    const next = demoState === "saved" ? resetButtonRef.current : applyButtonRef.current;
    next?.focus();
  }, [demoState]);

  const showSavedState = () => {
    movedByUser.current = true;
    setDemoState("saved");
    captureEvent("landing_amora_demo_apply_click", {
      source: "landing_hero_demo",
    });
  };

  const showProposalState = () => {
    movedByUser.current = true;
    setDemoState("proposal");
  };

  return (
    <figure
      className="relative z-10 min-w-0 animate-fade-in motion-reduce:animate-none"
      aria-labelledby="landing-product-demo-title"
    >
      <div
        className="absolute -inset-4 -z-10 rounded-[28px] bg-[#E2D3C8]/10 blur-2xl"
        aria-hidden="true"
      />
      <div className="overflow-hidden rounded-[28px] border border-white/18 bg-[#FBF8F2] text-[#243832] shadow-overlay">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#243832]/10 bg-white/84 px-4 py-3 backdrop-blur sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#36534E] text-white"
              aria-hidden="true"
            >
              <MessageCircle className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 id="landing-product-demo-title" className="truncate text-[14px] font-semibold text-[#243832]">
                대화가 준비 기록이 되는 예시
              </h2>
              <p className="mt-0.5 text-[12px] font-medium text-[#4E6A62]">
                아모라가 한 번에 한 가지 변경을 제안해요
              </p>
            </div>
          </div>
          <span className="inline-flex min-h-8 items-center rounded-full border border-[#8F6662]/20 bg-ivory-blush px-3 text-[12px] font-semibold text-rose-700">
            직접 눌러보는 예시
          </span>
        </div>

        <ol className="grid grid-cols-3 border-b border-[#243832]/10 bg-[#F7F1E8] px-3 py-3 sm:px-5" aria-label="기능 예시 진행 단계">
          {[
            ["1", "대화", true],
            ["2", "변경 제안", true],
            ["3", "준비에 반영", demoState === "saved"],
          ].map(([number, label, active]) => (
            // 이전에는 활성/비활성 차이가 #243832 대 #36534E — 서로 약 1.5:1이라
            // 색만으로는 구분되지 않았고 보조기술에 알릴 신호도 없었다. 웨이트와
            // 농도로 차이를 만들고 aria-current로 현재 단계를 알린다.
            <li
              key={String(number)}
              aria-current={active ? "step" : undefined}
              className={`flex items-center gap-1.5 text-[12px] sm:gap-2 ${active ? "font-bold text-[#243832]" : "font-medium text-[#36534E]/70"}`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${active ? "bg-[#36534E] text-white" : "border border-[#243832]/14 bg-white text-[#36534E]/70"}`}
              >
                {number}
              </span>
              <span>{label}</span>
            </li>
          ))}
        </ol>

        <div className="grid md:min-h-[390px] md:grid-cols-[0.88fr_1.12fr]">
          {/* H1이 "둘이 말하면"인데 이 컬럼이 md 미만에서 숨겨져 있어, 모바일
              방문자는 두 사람이 말하는 장면을 한 번도 보지 못했다. 모바일이 주
              뷰포트이므로 보이게 한다. 대신 아래 보조 설명은 데스크톱에만 남겨
              세로 길이를 되돌린다(오른쪽 제안 패널이 같은 내용을 이미 말한다). */}
          <div className="border-b border-[#243832]/10 bg-white px-4 py-4 sm:px-5 md:border-b-0 md:border-r">
            <p className="text-[12px] font-semibold text-[#8F6662]">둘이 말한 내용</p>
            <div className="mt-3 space-y-3">
              {landingContent.demo.conversation.map((line, index) => (
                <div
                  key={line.speaker}
                  className={`flex items-end gap-2 ${index % 2 === 0 ? "justify-end" : "justify-start"}`}
                >
                  {index % 2 !== 0 ? (
                    <span className="text-[12px] font-semibold text-[#4E6A62]">
                      {line.speaker}
                    </span>
                  ) : null}
                  <p
                    className={`max-w-[84%] px-3 py-2.5 text-[14px] font-medium leading-[1.55] ${index % 2 === 0 ? "rounded-xl rounded-br-[6px] bg-ivory-blush text-[#243832]" : "rounded-xl rounded-bl-[6px] bg-[#36534E] text-white"}`}
                  >
                    {line.message}
                  </p>
                  {index % 2 === 0 ? (
                    <span className="text-[12px] font-semibold text-[#4E6A62]">
                      {line.speaker}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="mt-4 hidden items-start gap-2.5 border-t border-[#243832]/10 pt-4 md:flex">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#8F6662]" aria-hidden="true" />
              <p className="text-[12px] leading-5 text-[#4E6A62]">
                대화 안에 여러 준비가 있어도 변경 제안과 확인은 한 번에 한 가지씩 진행해요.
              </p>
            </div>
          </div>

          <div className="flex flex-col bg-[#FBF8F2] px-4 py-4 sm:px-5" aria-live="polite">
            {demoState === "proposal" ? (
              <div className="flex flex-1 flex-col animate-fade-in motion-reduce:animate-none">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-semibold text-[#8F6662]">아모라의 첫 번째 변경 제안</p>
                    <h3 className="mt-1 text-[18px] font-semibold leading-[1.3] tracking-[-0.02em] text-[#243832] sm:text-[20px]">
                      이 일정을 추가할까요?
                    </h3>
                  </div>
                  <span className="rounded-full border border-[#8F6662]/20 bg-white px-2.5 py-1 text-[12px] font-semibold text-[#8F6662]">
                    아직 반영 전
                  </span>
                </div>

                <blockquote className="mt-3 border-l-2 border-[#A77B74] bg-white px-3 py-2.5 text-[12px] leading-5 text-[#4E6A62]">
                  “{landingContent.demo.conversation[1].message}”
                </blockquote>

                {/* DESIGN.md "카드 안에 카드를 넣지 않는다". 이 블록은 이미 데모
                    카드 안이므로 자기 표면(흰 배경·테두리·라운드)을 갖지 않고
                    행으로 남는다. 정보는 그대로다. */}
                <div className="mt-3 border-t border-[#243832]/10 pt-3">
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-[#8F6662]">
                    <CalendarDays className="h-4 w-4" aria-hidden="true" />
                    우리 일정에 추가
                  </div>
                  <p className="mt-2 text-[20px] font-semibold tracking-[-0.025em] text-[#243832]">
                    10월 17일 오후 2시
                  </p>
                  <p className="mt-1 text-[14px] font-semibold text-[#4E6A62]">드레스 투어</p>
                </div>

                <p className="mt-3 text-[12px] leading-5 text-[#4E6A62]">
                  예산이나 할 일을 바꾸려면 각각 별도의 제안과 확인이 필요해요.
                </p>
                <button
                  ref={applyButtonRef}
                  type="button"
                  onClick={showSavedState}
                  className="mt-auto inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#8F6662] px-4 text-[14px] font-semibold text-white transition-colors duration-200 hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FBF8F2]"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  이 일정 반영 예시 보기
                </button>
              </div>
            ) : null}

            {demoState === "saved" ? (
              <div className="flex flex-1 flex-col items-start justify-center animate-fade-in motion-reduce:animate-none">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#6D806E] text-white" aria-hidden="true">
                  <Check className="h-5 w-5" />
                </span>
                <p className="mt-4 text-[12px] font-semibold text-[#4E6A62]">우리 일정에 반영한 예시</p>
                <h3 className="mt-1.5 text-[20px] font-semibold leading-[1.3] tracking-[-0.025em] text-[#243832]">
                  10월 17일 오후 2시
                  <span className="mt-1 block text-[#8F6662]">드레스 투어</span>
                </h3>
                <p className="mt-3 text-[14px] leading-[1.7] text-[#4E6A62]">
                  이 일정 한 건만 반영된 예시예요. 예산이나 할 일을 바꾸려면 각각 별도 제안과 확인이 필요해요.
                </p>
                <button
                  type="button"
                  ref={resetButtonRef}
                  onClick={showProposalState}
                  className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-[#243832]/14 bg-white px-4 text-[12px] font-semibold text-[#36534E] transition-colors duration-200 hover:border-[#8F6662] hover:text-[#8F6662] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FBF8F2]"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  확인 전 제안 다시 보기
                </button>
              </div>
            ) : null}
          </div>
        </div>

      </div>
      <figcaption className="mt-2 text-center text-[12px] font-medium leading-5 text-white/72">
        {landingContent.demo.boundary}
      </figcaption>
    </figure>
  );
}
