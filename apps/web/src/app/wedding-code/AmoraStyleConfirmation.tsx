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

    앱에는 아직 아모라 도움 방식을 고르는 네이티브 화면이 없다. 그러니 "앱에서
    하세요" 라고 안내할 곳도 없다. 할 수 없는 일을 권하지 않는 쪽을 택한다 —
    코드·비교·링크 보내기는 그대로 되고, 이 단락만 빠진다.

    브라우저에서는 아무것도 달라지지 않는다. `useInsideMobileApp` 은 서버 렌더와
    첫 페인트에서 늘 false다.
  */
  if (insideApp) return null;

  return <>
    {session.status === "loading" ? <p role="status" className="mt-4 text-sm text-[var(--hb-text-body)]">아모라 설정을 연결할 로그인 상태를 확인하고 있어요.</p> : null}
    {session.status === "error" ? <div role="alert" className="mt-4 text-sm text-[var(--hb-text-body)]"><p>로그인 상태를 확인하지 못했어요. 설정을 연결하기 전에 다시 확인해 주세요.</p><Button className="mt-3" onClick={session.retry}>로그인 상태 다시 확인</Button></div> : null}
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
          장면 속 행동이 지금 원하는 도움과 같지는 않아요. 아래에서 직접 고른 항목만 내 아모라에 반영해요. 상대의 설정이나 두 사람의 합의는 바뀌지 않아요.
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
                <option value="">지금 바꾸지 않기</option>
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
              else setHandoffError("선택을 이어갈 수 없어요. 이 창에서 다시 시도하거나 설정 화면에서 직접 골라주세요.");
            }
          }}
        >
          {applied ? "아모라에 반영했어요" : user ? "내가 고른 방식만 반영하기" : "로그인하고 선택한 방식 확인하기"}
        </Button>
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--hb-text-body)]" role={applied ? "status" : undefined}>
          {applied ? "저장한 방식은 다음 아모라 답변에 참고돼요. 대화 중 원하는 방식을 다시 말하거나 설정에서 바꿀 수 있어요." : "이 설정에는 웨딩코드 답과 고른 문장을 보내지 않아요. 직접 선택한 도움 설정만 확인 후 내 계정에 저장해요."}
        </p>
        {personalization.error || handoffError ? <p role="alert" className="mt-2 text-[13px] leading-relaxed text-[var(--color-rose-700)]">{personalization.error ?? handoffError}</p> : null}
        {user && personalization.status === "error" ? <Button variant="secondary" className="mt-3" onClick={() => { void personalization.load(); }}>기존 설정 다시 불러오기</Button> : null}
        <a href="/settings/amora-style" className="mt-3 inline-block py-2 text-[14px] font-semibold text-[var(--hb-text-strong)] underline underline-offset-4">설정 화면에서 직접 보기</a>
      </div>
    </section>
  );
}
