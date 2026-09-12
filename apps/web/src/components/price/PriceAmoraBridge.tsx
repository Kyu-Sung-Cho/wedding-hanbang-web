import Link from "next/link";
import AmoraAvatar from "@/components/ui/AmoraAvatar";
import AmoraMark from "@/components/ui/AmoraMark";
import { AMORA_ACTION_CLASS } from "@/components/ui/amoraActionStyles";

import { StartDemoButton } from "@/components/demo/StartDemoButton";
import { isPublicDemoTrialEnabled } from "@/lib/demoTrial";

// 가격을 확인한 직후가 "그래서 뭐부터 하지?"가 가장 커지는 순간이다.
// 그 순간을 로그인 상태에 맞는 아모라 화면으로 잇는 절제된 브릿지 — 과장·재촉 문구 금지.
export function PriceAmoraBridge() {
  // 체험 스위치는 기본 꺼짐이고, 꺼지면 `StartDemoButton` 이 아무것도 그리지 않는다.
  // 그런데 아래 설명 문단은 조건 없이 그려져서, 비로그인 방문자가
  // **"로그인 전에는 아모라 체험을 바로 열 수 있어요" 를 읽고 누를 것을 찾다가
  // 아무 버튼도 못 찾는** 상태가 됐다. 체험을 닫은 커밋(#245)이 다른 화면 셋은
  // 문구까지 갈랐는데 이 파일만 빠졌다.
  //
  // 문구와 버튼을 같은 조건으로 묶는다. 닫혀 있으면 체험을 약속하지 않고
  // 갈 수 있는 곳(가입)을 준다 — 이 자리의 존재 이유가 "다음 한 걸음"이기 때문이다.
  const demoOpen = isPublicDemoTrialEnabled();

  return (
    <section
      aria-label="아모라 안내"
      className="mt-10 rounded-[6px] border border-[var(--hb-primary)]/15 bg-[var(--hb-primary)]/[0.06] px-5 py-8 text-center sm:px-8"
    >
      <AmoraAvatar sizeClassName="size-12" className="mx-auto" />
      <h2 className="mt-4 text-lg font-bold tracking-normal text-[var(--hb-text-strong)]">
        가격은 확인했는데, 뭐부터 해야 할지 막막하다면
      </h2>
      {demoOpen ? (
        <>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--hb-text-strong)]/70">
            로그인 전에는 아모라 체험을 바로 열 수 있어요.
            화면의 이름·예산은 샘플이고 체험 대화와 변경은 계정 기록에 남지 않아요.
            이미 로그인했다면 계정 채팅에서 이어져요.
          </p>
          <StartDemoButton
            label="아모라에게 물어보기"
            className={`${AMORA_ACTION_CLASS} mt-5`}
          />
        </>
      ) : (
        <>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--hb-text-strong)]/70">
            아모라와 이야기하려면 로그인이 필요해요.
            계정을 만들면 지금 본 가격을 기준으로 무엇부터 정할지 함께 정리하고,
            확인한 것만 예산·할 일·일정에 남겨요.
          </p>
          <Link
            href="/login?mode=signup"
            prefetch={false}
            className={`${AMORA_ACTION_CLASS} mt-5`}
          >
            <AmoraMark className="size-5 shrink-0" />아모라와 시작하기
          </Link>
        </>
      )}
      <p className="mt-3 text-[13px]">
        <Link href="/demo" prefetch={false} className="font-semibold text-[var(--hb-text-strong)] underline underline-offset-4">
          아모라가 무엇을 하고 무엇을 하지 않는지 먼저 보기
        </Link>
      </p>
    </section>
  );
}
