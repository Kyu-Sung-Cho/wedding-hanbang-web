"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import { useInsideMobileApp } from "@/hooks/useInsideMobileApp";
import { useAuthStore } from "@/stores/authStore";
import { useAmoraPersonalization } from "@/hooks/useAmoraPersonalization";
import { useWeddingCodeSession } from "@/hooks/useWeddingCodeSession";
import { isAmoraPersonalizationChanges, type AmoraPersonalizationChanges } from "@/lib/amora/personalization";
import { buildWeddingCodeAmoraProposals } from "@/lib/weddingCode/profile/amoraBridge";
import { createWeddingCodeAmoraHandoff } from "@/lib/weddingCode/profile/amoraHandoff";
import type { WeddingCodeSelfProfile } from "@/lib/weddingCode/scene/selfProfile";

/**
 * 설정 API 의 오류 원문(「인증이 필요합니다.」 「서버 오류」)이나 브라우저의 영문 네트워크 오류는
 * 이 카드 말투와 달라 그대로 보이면 튄다. 해요체로 쓴 안내(409 충돌 등)는 그대로 둔다.
 */
export function cardErrorText(message: string): string {
  return /니다\.?$|서버 오류|안전하게|[A-Za-z]/.test(message)
    ? "아모라 설정을 불러오거나 저장하지 못했어요. 잠시 뒤 다시 해 주세요."
    : message;
}

export default function AmoraStyleConfirmation({ profile }: { profile: WeddingCodeSelfProfile }) {
  const session = useWeddingCodeSession();
  const user = useAuthStore((state) => state.user);
  const insideApp = useInsideMobileApp();

  /*
    앱 웹뷰에서는 이 단락을 내린다. 여기서 끝을 못 보기 때문이다.

    앱 웹뷰에는 앱의 세션이 없다(쿠키를 넘기지 않는다). 그래서 **앱에 이미 로그인한
    사람에게도** 이 단락은 `user === null` 로 보여 "로그인하고 선택한 방식 확인하기"
    라고 말한다. 그리고 그 버튼은 `/settings/amora-style` 로 가는데, 앱 웹뷰는
    로그인 필요 경로를 네이티브 화면으로 되돌린다(`webview.tsx` 의 `WEB_TO_NATIVE`).
    되돌아간 네이티브 설정 화면은 고른 방식을 모른다 — 선택을 담은 봉투는 웹뷰
    안에 남고 nonce 는 버려진다. 로그아웃 상태면 거기서 "로그인이 만료됐어요" 를
    본다. 어느 쪽이든 **버튼이 약속한 일이 일어나지 않고, 보던 결과도 사라진다.**

    2026-09-18 부터 앱에도 네이티브 「아모라 도움 방식」 화면(설정 > 아모라)이 있다.
    하지만 여기서 고른 선택을 그 화면으로 넘기는 길은 없다 — 선택 봉투와 nonce 는
    웹뷰 안에만 있고, 네이티브 화면은 그것을 받지 않는다(넘기지 않기로 했다).
    그래서 이 단락이 약속하는 "고른 방식 이어서 확인하기" 는 앱 웹뷰에서 여전히
    끝을 못 본다. 할 수 없는 일을 권하지 않는 쪽을 택한다 — 코드·비교·링크
    보내기는 그대로 되고, 이 단락만 빠진다.

    브라우저에서는 아무것도 달라지지 않는다. `useInsideMobileApp` 은 서버 렌더와
    첫 페인트에서 늘 false다.
  */
  if (insideApp) return null;

  return <>
    {session.status === "loading" ? <p role="status" className="mt-4 text-sm text-[var(--hb-text-body)]">로그인했는지 확인하고 있어요.</p> : null}
    {session.status === "error" ? <div role="alert" className="mt-4 text-sm text-[var(--hb-text-body)]"><p>로그인 상태를 확인하지 못했어요. 아모라 도움 방식을 고르려면 다시 확인해 주세요.</p><Button className="mt-3" onClick={session.retry}>로그인 상태 다시 확인</Button></div> : null}
    <div hidden={session.status !== "ready"}>
      <Confirmation key={user?.id ?? "guest"} profile={profile} sessionReady={session.status === "ready"} />
    </div>
  </>;
}

function Confirmation({ profile, sessionReady }: { profile: WeddingCodeSelfProfile; sessionReady: boolean }) {
  const isDemo = useAuthStore((state) => state.isDemo);
  const user = useAuthStore((state) => state.isDemo ? null : state.user);
  const personalization = useAmoraPersonalization(Boolean(user) && sessionReady);
  const proposals = buildWeddingCodeAmoraProposals(profile);
  const [changes, setChanges] = useState<AmoraPersonalizationChanges>({});
  const [applied, setApplied] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const hasChanges = isAmoraPersonalizationChanges(changes);

  if (proposals.length === 0) return null;
  return (
    <section className="mt-4 overflow-hidden rounded-[6px] border border-[var(--hb-hairline)] bg-white" data-amora-proposals="">
      <div className="border-b border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] px-5 py-5 sm:px-8">
        <h2 className="text-[18px] font-semibold text-[var(--hb-text-strong)]">아모라가 어떻게 도와주면 좋을까요?</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--hb-text-body)]">
          장면에서 고른 답과 지금 받고 싶은 도움은 다를 수 있어서 따로 물어볼게요. 원할 때만 설정해도 돼요.
        </p>
        <p className="mt-2 text-[14px] font-semibold leading-relaxed text-[var(--hb-text-strong)]">
          선택만으로는 저장되지 않아요.{" "}
          {user ? "아래 반영 버튼을 눌러야 저장돼요." : "로그인한 뒤 고른 내용을 다시 확인하고 저장해요."}
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--hb-text-body)]">
          직접 고른 항목만 내 아모라 설정에 반영돼요. 상대 설정이나 둘이 함께 정한 내용은 그대로예요. 문항 개선을 위해 답을 보내는 기능과는 별개예요.
        </p>
      </div>
      <div className="divide-y divide-[var(--hb-hairline)]">
        {proposals.map((proposal) => {
          const selected = proposal.options.find((option) => option.value === changes[proposal.field]);
          return (
            <div key={proposal.field} data-proposal={proposal.field} className="px-5 py-5 sm:px-8">
              <label htmlFor={`wc-help-${proposal.field}`} className="block text-[14px] font-semibold leading-relaxed text-[var(--hb-text-strong)]">{proposal.question}</label>
              <select
                id={`wc-help-${proposal.field}`}
                value={changes[proposal.field] ?? ""}
                disabled={!sessionReady || personalization.saving}
                onChange={(event) => {
                  const next = { ...changes };
                  delete next[proposal.field];
                  const value = event.target.value;
                  const candidate = { ...next, ...(value ? { [proposal.field]: value } : {}) };
                  if (Object.keys(candidate).length === 0 || isAmoraPersonalizationChanges(candidate)) {
                    setChanges(candidate);
                    setApplied(false);
                    setHandoffError(null);
                  }
                }}
                className="mt-3 min-h-12 w-full rounded-[6px] border border-[var(--hb-hairline)] bg-white px-3 text-[16px] text-[var(--hb-text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)]"
              >
                {/* 빈 값 = 이 항목은 건드리지 않음. 옆의 「그때 물어보기」는 실제로 저장되는 설정값이라, 예전 이름(「지금 바꾸지 않기」)은 둘이 같은 뜻으로 읽혔다. 로그인하지 않은 사람에게도 보이므로 「지금 설정」을 전제하지 않는다. */}
                <option value="">고르지 않음 (이 항목은 그대로 둬요)</option>
                {proposal.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {selected ? <p className="mt-2 text-[13px] leading-relaxed text-[var(--hb-text-body)]">{selected.effect}</p> : null}
            </div>
          );
        })}
      </div>
      <div className="border-t border-[var(--hb-hairline)] px-5 py-5 sm:px-8">
        <Button
          variant="primary"
          fullWidth
          data-apply-amora={user ? "" : undefined}
          data-continue-amora={!user ? "" : undefined}
          disabled={!sessionReady || !hasChanges || applied || Boolean(user && personalization.status !== "ready")}
          loading={personalization.saving}
          onClick={() => {
            if (!sessionReady || !hasChanges) return;
            if (user) {
              void personalization.save(changes).then((result) => { if (result) setApplied(true); });
            } else {
              const handoff = createWeddingCodeAmoraHandoff(changes);
              if (handoff) window.location.assign(isDemo ? `/login?redirect=${encodeURIComponent(handoff.href)}` : handoff.href);
              else setHandoffError("고른 내용을 넘기지 못했어요. 한 번 더 눌러 보거나, 설정 화면에서 직접 골라 주세요.");
            }
          }}
        >
          {applied ? "아모라에 반영했어요" : user ? "고른 대로 아모라에 반영하기" : "로그인하고 고른 내용 확인하기"}
        </Button>
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--hb-text-body)]" role={applied ? "status" : undefined}>
          {applied ? "다음 답변부터 아모라가 이 방식을 참고해요. 대화 중에 다르게 부탁하면 그때는 그 부탁을 따라요. 설정은 언제든 바꿀 수 있어요." : "이 설정에는 웨딩코드에서 고른 답이 들어가지 않아요. 여기서 고른 도움 방식만 내가 확인한 뒤에 계정에 저장돼요."}
        </p>
        {personalization.error || handoffError ? <p role="alert" className="mt-2 text-[13px] leading-relaxed text-[var(--color-rose-700)]">{personalization.error ? cardErrorText(personalization.error) : handoffError}</p> : null}
        {user && personalization.status === "error" ? <Button variant="secondary" className="mt-3" onClick={() => { void personalization.load(); }}>내 설정 다시 불러오기</Button> : null}
        <a href="/settings/amora-style" className="mt-3 inline-block py-2 text-[14px] font-semibold text-[var(--hb-text-strong)] underline underline-offset-4">설정 화면에서 직접 보기</a>
      </div>
    </section>
  );
}
