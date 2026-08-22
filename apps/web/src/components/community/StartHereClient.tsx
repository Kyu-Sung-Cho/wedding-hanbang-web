"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, Check, LockKeyhole } from "lucide-react";

import { StartDemoButton } from "@/components/demo/StartDemoButton";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { computePreparationPriorities } from "@/lib/marketing/preparationPriorities";
import { captureEvent } from "@/lib/analytics";
import { readStartHereDateHandoff } from "@/lib/marketing/startHereDateHandoff";
import {
  buildStartHereSignupHref,
  buildStartHereAmoraPrefill,
  createDemoAmoraHandoffId,
  forgetDemoAmoraPrefill,
  rememberDemoAmoraPrefill,
} from "@/lib/chat/demoHandoff";
import { daysUntilWedding, normalizeWeddingDate } from "@/lib/utils/weddingDate";

// 결혼식 날짜 하나만 받아 지금 확인할 항목을 보여준다.
// 날짜는 이 컴포넌트에서만 계산하고 서버나 분석 이벤트에는 싣지 않는다.

type Preset = "standard" | "small";
type ResultState = "empty" | "past" | "early" | "priorities";

// 작은 결혼식·재혼 등에서 흔히 생략하는 항목. 정답이 아니라 기본값 제안일 뿐이라
// 화면에서 언제든 되돌릴 수 있게 한다(제품 원칙: 관습을 정답처럼 가정하지 않기).
const OFTEN_SKIPPED = new Set(["ham", "pyebaek", "yedan", "hanbok"]);
const EARLY_STARTING_POINTS = [
  {
    title: "편안한 예산 범위",
    body: "얼마까지 쓰는 게 편안한지 상한선부터 이야기해요.",
  },
  {
    title: "초대할 사람의 범위",
    body: "꼭 함께하고 싶은 사람부터 떠올려요.",
  },
  {
    title: "원하는 크기와 분위기",
    body: "작고 편안하게 할지, 많은 사람과 축하할지 기준을 맞춰요.",
  },
] as const;

function buildUndatedAmoraPrefill(preset: Preset): string {
  const style = preset === "small"
    ? "결혼식은 작게 준비하고 싶어요."
    : "필요한 준비 항목은 넓게 살펴보고 싶어요.";
  return (
    `아직 결혼식 날짜가 정해지지 않았어요. ${style} `
    + "날짜를 잡기 전에 둘이 먼저 맞춰볼 기준 한 가지만 알려주세요. "
    + "바뀌는 내용은 저장하기 전에 보여주세요."
  );
}

function beforeLabel(days: number): string {
  // 결혼식 뒤까지 이어지는 분야가 있다. 음수를 그대로 넣으면 "-30일 전"이 된다.
  if (days <= 0) return "예식 뒤";
  if (days < 30) return `${days}일 전`;
  return `${Math.round(days / 30)}개월 전`;
}

export default function StartHereClient() {
  const router = useRouter();
  const [dateText, setDateText] = useState("");
  const [preset, setPreset] = useState<Preset>("standard");
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const lastTrackedResultState = useRef<ResultState>("empty");

  const dday = useMemo(() => daysUntilWedding(dateText), [dateText]);

  // 랜딩 히어로에서 넘어온 날짜를 받는다. 수신 로직은 main 쪽 공유 모듈을 쓴다 —
  // 지난 날짜를 걸러 내고 fragment 폴백까지 한 함수에서 다루며 자체 테스트가 있다.
  //
  // 초기 상태로 넣을 수 없다: sessionStorage는 서버에 없어 첫 렌더에 쓰면 서버 HTML과
  // 어긋난다. 렌더 중에 읽을 수도 없다: 이 읽기는 저장소를 비우는 부수효과다.
  useEffect(() => {
    const handed = readStartHereDateHandoff();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 1회 인계 수신(위 근거)
    setDateText((current) => handed ?? current);
  }, []);

  const applyPreset = (next: Preset) => {
    captureEvent("start_here_style_selected", {
      source: next === "small" ? "small_wedding" : "standard_wedding",
    });
    setPreset(next);
    setSkipped(next === "small" ? new Set(OFTEN_SKIPPED) : new Set());
  };

  const handleDateChange = (value: string) => {
    setDateText(value);
    if (normalizeWeddingDate(value)) {
      captureEvent("start_here_date_selected", { source: "date_input" });
    }
  };

  const toggleSkip = (key: string) => {
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 기본 확인 구간에 들어온 항목을 먼저 보여주고, 세 자리가 차지 않으면
  // 시작점이 가장 가까운 다음 항목을 채운다. 아직 시작 전인 항목은 화면에서 명확히 구분한다.
  //
  // 이 계산은 여기 인라인으로 있었다. 랜딩이 같은 3가지를 그 자리에서 보여주게 되면서
  // 공유 함수로 빠졌고, 두 화면이 서로 다른 3가지를 보여주는 드리프트를 막으려면
  // 여기서도 그 함수를 써야 한다. 로직은 한 글자도 바뀌지 않았다.
  const { activeNow, visiblePriorities } = useMemo(
    () => computePreparationPriorities(dday, { skipped }),
    [dday, skipped],
  );

  // 날짜를 넣기 전에도 답이 있어야 한다. 검색으로 들어온 사람에게 빈 입력칸만
  // 보여주면 첫 화면에서 이탈하고, 서버 HTML에도 색인할 본문이 남지 않는다.
  const overview = useMemo(() => (
    CATEGORY_CHECKLISTS
      .filter((category) => !skipped.has(category.key))
      .map((category) => ({
        key: category.key,
        label: category.label,
        window: `예식 ${beforeLabel(category.ddayStart)} ~ ${beforeLabel(category.ddayDeadline)}`,
        firstStep: category.items[0]?.label ?? null,
        ddayDeadline: category.ddayDeadline,
      }))
      .sort((left, right) => right.ddayDeadline - left.ddayDeadline)
  ), [skipped]);

  const skippable = CATEGORY_CHECKLISTS.filter((category) => OFTEN_SKIPPED.has(category.key));
  const resultState: ResultState = dday === null
    ? "empty"
    : dday < 0
      ? "past"
      : activeNow.length === 0
        ? "early"
        : "priorities";
  const focusLabels = resultState === "early"
    ? EARLY_STARTING_POINTS.map((point) => point.title)
    : visiblePriorities.map((category) => category.label);
  const amoraPrefill = dateText
    ? buildStartHereAmoraPrefill({
        weddingDate: dateText,
        preparationStyle: preset,
        focusLabels,
      })
    : undefined;
  const undatedAmoraPrefill = buildUndatedAmoraPrefill(preset);
  const currentStep = resultState === "early" || resultState === "priorities" ? 2 : 1;

  useEffect(() => {
    if (resultState === "empty" || lastTrackedResultState.current === resultState) return;
    lastTrackedResultState.current = resultState;
    captureEvent("start_here_result_viewed", { source: resultState });
  }, [resultState]);

  const rememberSignupHandoff = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const handoffId = amoraPrefill ? createDemoAmoraHandoffId() : null;
    try {
      if (handoffId) {
        rememberDemoAmoraPrefill(window.localStorage, amoraPrefill, handoffId);
      } else {
        forgetDemoAmoraPrefill(window.localStorage);
      }
    } catch {
      // 저장소가 막혀도 회원가입 이동은 계속한다.
    }
    captureEvent("start_here_signup_click", {
      source: resultState === "early" ? "early" : "priorities",
    });
    router.push(buildStartHereSignupHref(handoffId));
  };

  const resetPastDate = () => {
    setDateText("");
    window.setTimeout(() => document.getElementById("wedding-date")?.focus(), 0);
  };

  return (
    <div className="bg-[#FBF8F2] text-[#243832]">
      <section className="bg-[#243832] text-white" aria-labelledby="start-here-title">
        <div className="mx-auto w-full max-w-[1240px] px-5 pb-10 pt-8 sm:px-8 sm:pb-12 sm:pt-11 lg:px-10 lg:pb-14">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(520px,1.05fr)] lg:items-end lg:gap-16">
            <div className="max-w-[650px]">
              <p className="text-[12px] font-semibold tracking-[0.08em] text-[#E2D3C8]">
                날짜 입력은 로그인 없이 · 날짜는 서버로 보내지 않아요
              </p>
              <h1
                id="start-here-title"
                className="mt-3 text-[clamp(2.5rem,9vw,4.5rem)] font-semibold leading-[1.02] tracking-[-0.055em]"
              >
                첫 준비는
                <span className="mt-1 block text-[#E2D3C8]">날짜가 없어도 돼요.</span>
              </h1>
              <p className="mt-5 max-w-[36rem] text-[16px] leading-7 text-white/84 sm:text-[17px] sm:leading-8">
                날짜가 있으면 지금 볼 세 가지를, 아직 없다면 둘이 먼저 맞출 기준 한 가지를 정리해 드려요.
                대략 잡은 날짜도 괜찮아요.
              </p>
            </div>

            <ol className="grid grid-cols-3 border-y border-white/18" aria-label="첫 준비 진행 단계">
              {[
                [1, "날짜 또는 지금 상황", "아는 만큼만 선택"],
                [2, "순서 또는 첫 기준", "지금 필요한 만큼 확인"],
                [3, "아모라에게 묻기", "첫 질문으로 이어가기"],
              ].map(([step, title, description]) => {
                const reached = Number(step) <= currentStep;
                return (
                  <li
                    key={step}
                    aria-current={Number(step) === currentStep ? "step" : undefined}
                    className="min-h-[82px] border-r border-white/12 px-2 py-4 last:border-r-0 sm:min-h-[92px] sm:px-5"
                  >
                    <span className={`text-[12px] font-semibold ${reached ? "text-[#E2D3C8]" : "text-white/70"}`}>
                      0{step}
                    </span>
                    <div className="mt-2">
                      <p className={`text-[12px] font-semibold leading-5 sm:text-[14px] ${reached ? "text-white" : "text-white/72"}`}>
                        {title}
                      </p>
                      <p className="mt-1 hidden text-[12px] leading-5 text-white/72 sm:block">{description}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-[1240px] px-5 py-12 sm:px-8 sm:py-16 lg:px-10 lg:py-20">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(340px,0.78fr)_minmax(0,1.22fr)] lg:gap-10">
          <section className="bg-white px-5 py-6 shadow-[0_20px_55px_rgba(36,56,50,0.08)] sm:px-7 sm:py-8" aria-labelledby="start-date-title">
            <p className="text-[12px] font-semibold text-[#8F6662]">01 · 예식 예정일</p>
            <h2 id="start-date-title" className="mt-2 text-[25px] font-semibold tracking-[-0.035em] text-[#243832]">
              날짜를 알려주세요.
            </h2>
            <p className="mt-2 text-[15px] leading-7 text-[#4E6A62]">
              날짜는 지금 볼 순서를 계산하는 데만 사용하고, 서버로 보내지 않아요.
            </p>

            <label className="mt-6 block">
              <span className="text-[14px] font-semibold text-[#243832]">예식 예정일</span>
              <span className="mt-2 flex min-h-14 items-center gap-3 rounded-[14px] border border-[#243832]/14 bg-[#FBF8F2] px-4 transition-colors focus-within:border-[#36534E]/55 focus-within:ring-2 focus-within:ring-[#36534E]/10">
                <CalendarDays aria-hidden="true" className="h-5 w-5 shrink-0 text-[#8F6662]" />
                <input
                  id="wedding-date"
                  type="date"
                  value={dateText}
                  onChange={(event) => handleDateChange(event.target.value)}
                  className="min-h-14 min-w-0 flex-1 bg-transparent text-[16px] text-[#243832] outline-none"
                />
              </span>
            </label>

            <div className="mt-3 text-[13px] leading-6 text-[#4E6A62]">
              <span>아직 날짜가 없나요?</span>{" "}
              <StartDemoButton
                label="날짜 없이 기준부터 물어보기"
                prefill={undatedAmoraPrefill}
                analyticsSource="start_here_without_date"
                className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-[#36534E] underline decoration-[#36534E]/30 underline-offset-4 transition-colors hover:text-[#8F6662] disabled:opacity-60"
              />
            </div>

            <fieldset className="mt-6">
              <legend className="text-[14px] font-semibold text-[#243832]">어떤 준비에 가까운가요?</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {([
                  ["standard", "항목을 넓게 볼게요"],
                  ["small", "작게 준비해요"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => applyPreset(value)}
                    aria-pressed={preset === value}
                    className={`inline-flex min-h-11 items-center rounded-full border px-4 text-[14px] font-semibold transition-colors ${
                      preset === value
                        ? "border-[#36534E] bg-[#36534E] text-white"
                        : "border-[#243832]/15 bg-white text-[#243832] hover:bg-[#F5ECE4]"
                    }`}
                  >
                    {preset === value ? <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> : null}
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <p className="mt-6 flex gap-2 border-t border-[#243832]/10 pt-5 text-[13px] leading-6 text-[#4E6A62]">
              <LockKeyhole className="mt-1 h-4 w-4 shrink-0 text-[#8F6662]" aria-hidden="true" />
              아모라로 이어가면 날짜와 첫 질문을 이 브라우저에 임시로 넘겨요. 30분 안에 같은 브라우저의 이 가입 흐름을 마칠 때만 초안으로 불러오며, 직접 질문을 보내기 전까지 AI는 호출하지 않아요.
            </p>

            {dday !== null && dday >= 0 ? (
              <a
                href="#start-result-panel"
                className="mt-5 inline-flex min-h-11 items-center gap-2 font-semibold text-[#36534E] underline decoration-[#36534E]/30 underline-offset-4 lg:hidden"
              >
                업데이트된 내 준비 순서 보기
                <ArrowRight className="h-4 w-4 rotate-90" aria-hidden="true" />
              </a>
            ) : null}
          </section>

          <section
            id="start-result-panel"
            className="scroll-mt-16 min-h-[470px] border border-[#243832]/12 bg-white px-5 py-6 sm:scroll-mt-20 sm:px-7 sm:py-8"
            aria-labelledby="start-result-title"
            aria-live="polite"
          >
            <p className="text-[12px] font-semibold text-[#8F6662]">02 · 지금 볼 세 가지</p>

            {dday === null ? (
              <div className="flex min-h-[380px] flex-col justify-between">
                <div>
                  <h2 id="start-result-title" className="mt-2 text-[27px] font-semibold leading-[1.2] tracking-[-0.04em] text-[#243832] sm:text-[32px]">
                    날짜를 고르면,
                    <span className="block text-[#8F6662]">지금 볼 세 가지가 나와요.</span>
                  </h2>
                  <p className="mt-3 max-w-[34rem] text-[15px] leading-7 text-[#4E6A62]">
                    전체 목록을 한꺼번에 주지 않고, 지금 확인하기 좋은 항목부터 보여드려요.
                  </p>
                </div>
                <ol className="mt-8 border-y border-[#243832]/12">
                  {[
                    "지금 먼저 확인할 준비 항목",
                    "각 항목에서 바로 시작할 첫걸음",
                    "아모라에게 이어서 물어볼 첫 질문",
                  ].map((item, index) => (
                    <li key={item} className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 border-b border-[#243832]/10 py-4 last:border-b-0">
                      <span className="text-[12px] font-semibold text-[#8F6662]">0{index + 1}</span>
                      <span className="text-[15px] font-semibold text-[#243832]">{item}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            {activeNow.length > 0 ? (
              <div>
                <h2 id="start-result-title" className="mt-2 text-[27px] font-semibold leading-[1.2] tracking-[-0.04em] text-[#243832] sm:text-[32px]">
                  예식까지 {dday}일,
                  <span className="block text-[#8F6662]">먼저 이 세 가지를 봐요.</span>
                </h2>
                <p className="mt-3 text-[14px] leading-6 text-[#4E6A62]">
                  {visiblePriorities.some((category) => !category.started)
                    ? "지금 시작할 항목 다음에, 곧 확인할 항목 하나를 미리 보여드려요. 실제 계약서와 업체·가족과 정한 날짜가 항상 우선이에요."
                    : "기본 확인 순서예요. 실제 계약서와 업체·가족과 정한 날짜가 항상 우선이에요."}
                </p>

                <ol className="mt-6 border-y border-[#243832]/12">
                  {visiblePriorities.map((category, index) => (
                    <li key={category.key} className="grid gap-3 border-b border-[#243832]/10 py-5 last:border-b-0 sm:grid-cols-[2.25rem_minmax(0,1fr)] sm:gap-4">
                      <span className="text-[12px] font-semibold text-[#8F6662]">0{index + 1}</span>
                      <div>
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <h3 className="text-[18px] font-semibold text-[#243832]">{category.label}</h3>
                          <span className="text-[13px] font-semibold leading-5 text-[#8F6662]">
                            {!category.started
                              ? `다음 기본 확인 시작까지 ${category.daysUntilStart}일 · 지금은 기준만 미리 맞춰봐도 돼요`
                              : category.daysUntilDeadline < 0
                                ? "기본 확인 시점은 지났지만, 지금부터 하나씩 확인해요"
                                : `기본 확인 시점까지 ${category.daysUntilDeadline}일`}
                          </span>
                        </div>
                        <ul className="mt-3 grid gap-2 sm:grid-cols-3">
                          {category.firstSteps.map((step) => (
                            <li key={step} className="flex gap-2 text-[14px] leading-6 text-[#4E6A62]">
                              <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#B89785]" />
                              {step}
                            </li>
                          ))}
                        </ul>
                        {category.tip ? (
                          <p className="mt-3 bg-[#FBF8F2] px-4 py-3 text-[13px] leading-6 text-[#4E6A62]">
                            {category.tip}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="mt-7 bg-[#36534E] px-5 py-6 text-white sm:px-6">
                  <p className="text-[12px] font-semibold text-[#E2D3C8]">03 · 첫 질문으로 이어가기</p>
                  <h3 className="mt-2 text-[20px] font-semibold">이제 아모라에게 한 가지만 물어보세요.</h3>
                  <p className="mt-2 text-[14px] leading-6 text-white/82">
                    날짜와 지금 볼 항목을 입력창에 임시로 넘겨드려요. 로그인 없이 여는 체험은 계정 기록에 남지 않고, 로그인해 있으면 계정 채팅에서 이어져요.
                  </p>
                  <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                    <StartDemoButton
                      label="이 날짜로 아모라에게 물어보기"
                      prefill={amoraPrefill}
                      analyticsSource="start_here_priorities"
                      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[14px] bg-white px-5 text-[14px] font-semibold text-[#243832] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
                    />
                    <Link
                      href={buildStartHereSignupHref()}
                      onClick={rememberSignupHandoff}
                      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[14px] border border-white/30 px-5 text-[14px] font-semibold text-white transition-colors hover:bg-white/10"
                    >
                      계정 만들고 계속 관리하기
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </div>
            ) : null}

            {dday !== null && dday < 0 ? (
              <div className="flex min-h-[380px] flex-col justify-center">
                <p className="text-[12px] font-semibold text-[#8F6662]">날짜를 다시 확인해 주세요</p>
                <h2 id="start-result-title" className="mt-2 text-[27px] font-semibold leading-[1.2] tracking-[-0.04em] text-[#243832] sm:text-[32px]">
                  이미 지난 날짜예요.
                </h2>
                <p className="mt-3 max-w-[34rem] text-[15px] leading-7 text-[#4E6A62]">
                  결혼식을 마치셨다면 축하드려요. 입력 실수였다면 다른 예정일을 선택해 새 순서를 확인할 수 있어요.
                </p>
                <button
                  type="button"
                  onClick={resetPastDate}
                  className="mt-6 inline-flex min-h-12 w-fit items-center justify-center rounded-[14px] bg-[#36534E] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[#243832]"
                >
                  다른 날짜 선택하기
                </button>
              </div>
            ) : null}

            {dday !== null && dday >= 0 && activeNow.length === 0 ? (
              <div>
                <h2 id="start-result-title" className="text-[27px] font-semibold leading-[1.2] tracking-[-0.04em] text-[#243832] sm:text-[32px]">
                  예식까지 {dday}일,
                  <span className="block text-[#8F6662]">지금은 기준부터.</span>
                </h2>
                <p className="mt-3 max-w-[34rem] text-[15px] leading-7 text-[#4E6A62]">
                  아직 예약을 서두르기보다, 두 사람이 편안한 기준 세 가지를 먼저 이야기해 볼 수 있어요.
                </p>

                <ol className="mt-6 border-y border-[#243832]/12">
                  {EARLY_STARTING_POINTS.map((point, index) => (
                    <li key={point.title} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 border-b border-[#243832]/10 py-4 last:border-b-0">
                      <span className="text-[12px] font-semibold text-[#8F6662]">0{index + 1}</span>
                      <div>
                        <h3 className="text-[16px] font-semibold text-[#243832]">{point.title}</h3>
                        <p className="mt-1 text-[14px] leading-6 text-[#4E6A62]">{point.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="mt-7 flex flex-col gap-2 sm:flex-row">
                  <StartDemoButton
                    label="이 세 가지를 아모라와 정하기"
                    prefill={amoraPrefill}
                    analyticsSource="start_here_early"
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[14px] bg-[#36534E] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[#243832] disabled:opacity-60"
                  />
                  <Link
                    href={buildStartHereSignupHref()}
                    onClick={rememberSignupHandoff}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[14px] border border-[#36534E]/20 px-5 text-[14px] font-semibold text-[#36534E] transition-colors hover:bg-[#EDF2EA]"
                  >
                    계정 만들고 천천히 관리하기
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <section className="mt-14 border-t border-[#243832]/14 pt-10 sm:mt-20 sm:pt-12" aria-labelledby="start-customize-title">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <div>
              <p className="text-[12px] font-semibold text-[#8F6662]">내 상황에 맞추기</p>
              <h2 id="start-customize-title" className="mt-2 text-[25px] font-semibold tracking-[-0.035em] text-[#243832]">
                우리는 안 하는 것도 있어요.
              </h2>
              <p className="mt-2 text-[15px] leading-7 text-[#4E6A62]">
                가족·지역마다 하는 항목이 달라요. 안 하는 건 빼고 봐도 괜찮아요.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {skippable.map((category) => {
                  const off = skipped.has(category.key);
                  return (
                    <button
                      key={category.key}
                      type="button"
                      onClick={() => toggleSkip(category.key)}
                      aria-pressed={off}
                      className={`inline-flex min-h-11 items-center rounded-full border px-4 text-[14px] font-semibold transition-colors ${
                        off
                          ? "border-[#243832]/12 bg-[#f0ece6] text-[#716c65] line-through"
                          : "border-[#243832]/15 bg-white text-[#243832] hover:bg-[#F5ECE4]"
                      }`}
                    >
                      {category.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <details className="border-y border-[#243832]/14 py-5">
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-5 text-[18px] font-semibold text-[#243832]">
                전체 준비 순서 한눈에
                <span className="text-[13px] font-semibold text-[#8F6662]">펼쳐보기</span>
              </summary>
              <p className="mt-3 text-[14px] leading-6 text-[#4E6A62]">
                기본 확인 시점이 이른 순서예요. 실제 계약서와 업체·가족과 정한 날짜가 우선이며,
                아래 순서는 빠뜨리기 쉬운 항목을 살펴보는 참고용이에요.
              </p>
              <ol className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                {overview.map((category) => (
                  <li key={category.key} className="border-t border-[#243832]/10 pt-4">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-[14px] font-semibold text-[#243832]">{category.label}</span>
                      <span className="text-[13px] font-semibold text-[#8F6662]">{category.window}</span>
                    </div>
                    {category.firstStep ? (
                      <p className="mt-1 text-[13px] leading-6 text-[#4E6A62]">첫 걸음 · {category.firstStep}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </details>
          </div>
        </section>
      </div>
    </div>
  );
}
