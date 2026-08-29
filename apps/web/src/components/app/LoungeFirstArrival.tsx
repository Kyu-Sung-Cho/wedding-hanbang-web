"use client";

import Link from "next/link";
import { ArrowRight, Check, Sparkles, Users } from "lucide-react";
import {
  buildLoungeFirstRunView,
  isOnlyStageSuggestion,
  readPreparationStage,
  WEDDING_STYLE_OPTIONS,
  type LoungeFirstRunDestination,
  type LoungeFirstRunView,
} from "@hanbang/shared";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { getEvents } from "@/utils/scheduleEvents";
import type { ProgressItem } from "@/types/database.types";

/**
 * 웨딩 라운지 첫 도착 카드.
 *
 * ## 왜 필요한가
 *
 * 온보딩을 막 끝낸 커플의 라운지는 위젯만 있고 값이 없다. 안내 오버레이가 기능을
 * 설명해도, 닫고 나면 여전히 빈 화면이다. 그런데 그 사람은 방금 예식일·단계·원하는
 * 분위기를 **말했다.** 그걸 되비추지 않으면 자기 입력이 어디로 갔는지 모른 채 빈
 * 위젯을 본다.
 *
 * 무엇을 보여줄지(되읽을 줄, 다음 걸음 하나, 초대, 빈 이유)는 `@hanbang/shared`의
 * `buildLoungeFirstRunView`가 정한다. 웹과 앱이 같은 말을 해야 하기 때문이다.
 * 여기서 하는 일은 두 가지뿐이다 — **언제 띄울지**와 **목적지를 어느 경로로 열지**.
 *
 * ## 언제 사라지는가
 *
 * 별도 플래그를 두지 않는다. 플래그는 언젠가 어긋나서 "데이터가 있는데 첫 도착
 * 화면"이 남는다. 대신 화면이 실제로 비어 있는지를 매 렌더 계산하고, 커플이 무언가
 * 남기는 순간 판정이 뒤집혀 저절로 사라진다.
 */

/**
 * 의미 키 → 이 앱의 실제 경로.
 *
 * 계약에는 경로가 없다(플랫폼마다 다르므로). 여기 적은 다섯 개는 모두
 * `apps/web/src/app` 아래에 실물이 있는 화면이고, `LoungeFirstArrival.test.tsx`가
 * 파일 존재로 그 사실을 강제한다.
 */
export const DESTINATION_PATH: Record<LoungeFirstRunDestination, string> = {
  amora: "/chat",
  checklist: "/checklist",
  budget: "/budget",
  schedule: "/schedule",
  // 공시 가격은 로그인 없이 열리는 공개 화면이라 `/wedding` 아래에 없다.
  price: "/price",
};

/** 파트너 초대는 초대 코드가 사는 곳(설정 > 커플 연결)으로 보낸다. */
export const INVITE_PATH = "/settings";

/**
 * 목적지 링크.
 *
 * `/price`만 `weddingPath`로 감싸지 않는다. 감싸면 `/wedding/price`가 되는데
 * `weddingAppRoutes.ts`에 그 이름이 없어 리라이트 대상이 아니다 — 링크는 살아 있는
 * 것처럼 보이고 누르면 404다.
 */
function destinationLinkProps(destination: LoungeFirstRunDestination) {
  const path = DESTINATION_PATH[destination];
  if (destination === "price") return { href: path };
  return weddingLinkProps(path);
}

interface WeddingPreferencesShape {
  weddingStyle?: unknown;
}

/**
 * 온보딩에서 고른 분위기를 사람이 읽는 라벨로. 안 골랐거나 모르는 값이면 null이고,
 * 그러면 계약이 그 줄을 아예 만들지 않는다 — 사용자가 말하지 않은 것은 화면에 없다.
 */
function readWeddingStyleLabel(progress: Record<string, unknown>): string | null {
  const raw = progress.__preferences;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as WeddingPreferencesShape).weddingStyle;
  if (typeof value !== "string") return null;
  return WEDDING_STYLE_OPTIONS.find((option) => option.value === value)?.label ?? null;
}

/**
 * 커플이 직접 상태를 남긴 카테고리들. `{ venue: "completed", ... }`
 *
 * `__`로 시작하는 키는 카테고리가 아니라 예약 칸(단계·선호·일정)이라 세지 않는다.
 * `not_started`는 새로 생긴 사실이 아니라 기본값이므로 역시 세지 않는다 —
 * 온보딩도 같은 이유로 그 상태는 저장하지 않는다(buildOnboardingProgress).
 */
function readRecordedCategoryStatuses(
  progress: Record<string, ProgressItem>,
): Record<string, string> {
  const recorded: Record<string, string> = {};
  for (const [key, item] of Object.entries(progress)) {
    if (key.startsWith("__")) continue;
    const status = item?.status;
    if (status === "in_progress" || status === "completed" || status === "not_applicable") {
      recorded[key] = status;
    }
  }
  return recorded;
}

export interface LoungeFirstArrivalInput {
  /** 온보딩을 마치지 않았으면 되읽을 것 자체가 없다. */
  onboardingCompleted: boolean;
  weddingDate?: string | null;
  progress: Record<string, ProgressItem>;
  /** 입력한 총 예산(원). 0이면 아직 안 적은 것이다. */
  totalBudget: number;
  /** 기록된 지출 합(원). 라운지가 이미 계산해 둔 값을 그대로 받는다. */
  spentBudget: number;
  /** 사람이 직접 체크한 체크리스트 항목 수. */
  checkedItemCount: number;
  partnerLinked: boolean;
  now: number;
}

/**
 * 첫 도착 화면을 보여줄지 판정하고, 보여준다면 무엇을 보여줄지 돌려준다.
 *
 * ## 판정 기준을 왜 이렇게 잡았나
 *
 * "아직 커플이 만든 데이터가 사실상 없다"를 라운지가 실제로 그리는 값들로 정의한다.
 * 라운지의 위젯은 네 가지를 먹고 산다 — 체크리스트, 카테고리 상태, 예산, 일정.
 * 그 넷이 모두 비어 있으면 화면에 그릴 수 있는 것이 정말로 없다.
 *
 *   1. 사람이 체크한 항목 0개  — 체크 진행 위젯이 0%
 *   2. 손으로 남긴 카테고리 0개 — 아무것도 없거나, 온보딩 제안값 그대로
 *   3. 기록된 지출 0        — 예산 패널이 "미입력"
 *   4. 등록된 일정 0건        — 다가오는 일정 패널이 빔
 *
 * **총 예산은 세지 않는다.** 웹 온보딩이 결혼 정보 단계에서 총 예산을 직접 받기 때문에,
 * 그 값을 "커플이 만든 데이터"로 세면 예산을 적어 넣은 사람 — 즉 정상 경로로 가입한
 * 대부분 — 에게 첫 도착 화면이 아예 뜨지 않는다. 온보딩에서 말한 것은 이 화면이
 * 되읽어 줄 대상이지, 화면을 없앨 근거가 아니다. 앱도 같은 이유로 total_budget을 뺀다.
 *
 * 하나라도 생기면 라운지에 볼 것이 생겼다는 뜻이라 첫 도착 화면은 물러난다.
 * 아모라 채팅 기록이나 저장한 글은 기준에 넣지 않았다 — 그 둘은 비동기로 늦게
 * 도착해서, 넣으면 첫 렌더에 카드가 떴다가 사라지는 깜빡임이 생긴다.
 */
export function buildLoungeFirstArrival(
  input: LoungeFirstArrivalInput,
): LoungeFirstRunView | null {
  if (!input.onboardingCompleted) return null;

  const preparationStage = readPreparationStage(input.progress);

  const recordedCategories = readRecordedCategoryStatuses(input.progress);
  // 아직 아무것도 안 한 상태는 두 가지 모양이다.
  //   ① 남긴 카테고리가 하나도 없다 — 19항목 화면을 건너뛴 사람.
  //   ② 남긴 값이 **온보딩이 채워준 제안값 그대로**다 — "저장하고 시작하기"를 누른 사람.
  // ②를 "만든 데이터"로 세면 just_started가 아닌 단계를 고른 사람 — 5개 중 4개 — 이
  // 이 화면을 한 번도 못 본다. 제안값은 사용자가 화면에서 확인한 것이지 라운지에서 한
  // 일이 아니다. 한 칸이라도 다르면 진짜 입력이므로 물러난다. 판정은 공유 계약이 한다.
  const nothingRecordedYet =
    Object.keys(recordedCategories).length === 0
    || isOnlyStageSuggestion(recordedCategories, preparationStage);

  const stillEmpty =
    input.checkedItemCount <= 0
    && nothingRecordedYet
    && input.spentBudget <= 0
    && getEvents(input.progress as Record<string, unknown>).length === 0;

  if (!stillEmpty) return null;

  return buildLoungeFirstRunView({
    weddingDate: input.weddingDate,
    preparationStage,
    weddingStyleLabel: readWeddingStyleLabel(input.progress as Record<string, unknown>),
    partnerLinked: input.partnerLinked,
    now: input.now,
  });
}

/**
 * 되읽기 카드 + 다음 걸음 하나 + (아직 혼자라면) 초대 카드.
 *
 * 되읽기는 판정하지 않는다. "늦으셨어요" 같은 말은 근거도 없고 도움도 안 된다 —
 * 사용자가 말한 것을 말한 그대로 돌려주는 데까지가 이 카드의 몫이다.
 */
export default function LoungeFirstArrival({ view }: { view: LoungeFirstRunView }) {
  const nextStepLink = destinationLinkProps(view.nextStep.destination);
  const inviteLink = weddingLinkProps(INVITE_PATH);

  return (
    <section data-testid="lounge-first-arrival" className="grid gap-4">
      <div className="rounded-[22px] border border-[var(--hb-hairline)] bg-white/92 p-5 shadow-[0_10px_30px_rgba(8,22,38,0.04)] md:p-6">
        <p className="inline-flex items-center gap-2 rounded-full border border-[var(--hb-hairline)] bg-[#fff8ec] px-3.5 py-1.5 text-[12px] font-semibold text-[#9d6f36]">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          확인했어요
        </p>
        <h2 className="mt-4 font-serif-kr text-[24px] font-medium leading-tight text-[#071629]">
          말씀해주신 내용이에요
        </h2>
        <dl className="mt-4 grid gap-2.5 sm:grid-cols-3">
          {view.echo.map((line) => (
            <div
              key={line.label}
              className="min-w-0 rounded-[16px] border border-[var(--hb-hairline)] bg-[#fffdf7] p-3.5"
            >
              <dt className="text-[11px] font-semibold text-[#9d6f36]">{line.label}</dt>
              <dd className="mt-1.5 truncate text-[14px] font-semibold text-[#071629]">
                {line.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* 화면에서 가장 큰 요소. 다음에 할 수 있는 일은 하나만 크게 세운다. */}
      <div className="rounded-[22px] border border-[#29433e] bg-[var(--hb-primary)] p-5 text-white shadow-[0_16px_38px_rgba(54,83,78,0.16)] md:p-6">
        <p className="text-[12px] font-semibold text-[#ecd7a4]">다음 걸음 하나</p>
        <h2 className="mt-1.5 font-serif-kr text-[27px] font-medium leading-tight md:text-[30px]">
          {view.nextStep.title}
        </h2>
        <p className="mt-2.5 max-w-[560px] text-[14px] font-medium leading-[1.7] text-white/80">
          {view.nextStep.body}
        </p>
        <Link
          {...nextStepLink}
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 text-[14px] font-semibold text-[var(--hb-text-strong)] transition-colors hover:bg-[#fff8ec] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ecd7a4] focus-visible:ring-offset-2 focus-visible:ring-offset-[#36534E]"
        >
          {view.nextStep.cta}
          <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      {view.invite && (
        <div className="rounded-[22px] border border-[var(--hb-hairline)] bg-[#fffaf0] p-5 md:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[var(--hb-text-strong)]">
              <Users className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-[#071629]">{view.invite.title}</h3>
              <p className="mt-1.5 text-[13px] font-medium leading-[1.7] text-[#5d6879]">
                {view.invite.body}
              </p>
              {/* 코드 자체는 설정에만 있다. 라운지에 그대로 띄우면 화면을 켜 둔 자리에서
                  누구나 읽을 수 있고, 여기서 다시 발급 API를 부를 이유도 없다. */}
              <p className="mt-1.5 text-[12px] font-medium leading-[1.6] text-[#7A8290]">
                설정 &gt; 커플 연결에서 코드를 확인할 수 있어요.
              </p>
              <Link
                {...inviteLink}
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--hb-hairline)] bg-white px-5 text-[13px] font-semibold text-[var(--hb-text-strong)] transition-colors hover:bg-[#fff8ec] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-2"
              >
                {view.invite.cta}
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * 빈 위젯들 바로 위에 붙는 한 줄. 빈 화면을 설명 없이 두지 않는다.
 * 카드와 떨어져 있어야 하므로 컴포넌트를 나눴다 — 같은 판정 결과를 나눠 쓴다.
 */
export function LoungeFirstArrivalEmptyNote({ view }: { view: LoungeFirstRunView }) {
  return (
    <p
      data-testid="lounge-first-arrival-empty-note"
      className="inline-flex items-start gap-2 rounded-[16px] border border-[var(--hb-hairline)] bg-[#fffdf7] px-4 py-3 text-[12px] font-medium leading-[1.6] text-[#5d6879]"
    >
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#9d6f36]" aria-hidden="true" />
      {view.emptyNote}
    </p>
  );
}
