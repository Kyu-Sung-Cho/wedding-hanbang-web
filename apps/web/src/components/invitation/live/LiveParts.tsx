"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { EXAMPLE_COPY } from "@hanbang/shared/invitation";

import ChatSidePanel from "@/components/app/chat/ChatSidePanel";
import AiNoticeFooter from "@/components/common/AiNoticeFooter";
import AmoraOrb from "@/components/ui/AmoraOrb";
import Button from "@/components/ui/Button";
import { consumePendingAmoraFirstHello } from "@/lib/amora/pendingFirstHello";
import { weddingPath } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";

import { InvitationBackLink } from "../InvitationParts";
import { INVITATION_FOCUS_RING, INVITATION_SCREEN_ROOT, cx } from "../invitationScreen";
import { LIVE_MORE_LINKS, LIVE_MORE_LINKS_LABEL } from "./liveRoutes";
import { LIVE_RETRY_LABEL } from "./liveStateCopy";

/**
 * 청첩장 디자인 실제 커플 화면(2026-11-17)이 함께 쓰는 조각. 값은 아티팩트 화면과 같은 말투·크기를 따른다
 * (상태 한 줄은 13px 본문색, 아모라 말은 17px 글줄, 단추는 공유 알약).
 */

/** 상태 한 줄. 실패는 경고색으로 바로 읽어 주고, 나머지는 조용히 알린다. */
export function LiveNotice({ tone = "status", children }: { tone?: "status" | "error"; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cx("text-[13px] leading-[1.6]", tone === "error" ? "text-inv-warn" : "text-inv-body")}
      data-live-notice={tone}
    >
      {children}
    </p>
  );
}

/** 넓은 화면에서 폰 화면을 가운데 480px 단으로 그린다(예시 커플의 `ExampleColumn` 과 같은 값). */
export function LiveColumn({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex min-h-0 w-full max-w-[480px] flex-1 flex-col">{children}</div>;
}

type Back = { href: string; label: string };

function ScreenHeader({ back }: { back?: Back }) {
  if (!back) return <div className="h-[60px] shrink-0" />;
  return (
    <header className="flex shrink-0 items-center pt-4 pr-4 pl-2.5">
      <InvitationBackLink href={back.href} label={back.label} />
    </header>
  );
}

/**
 * 불러오는 중. 일하는 오브를 하나 띄운다(오브가 "아모라, 일하는 중"이라고 읽힌다). 바쁜 칸으로 표시한다.
 * 불러오는 중이라는 글자는 상태 문구가 아직 없어 쓰지 않는다(보고서의 빈자리).
 *
 * `footer` 는 뒤로 갈 곳이 없는 첫 화면(라운지)에서 넘긴다. 읽기가 오래 걸려도 다른 화면·설정으로 나갈 수 있다.
 */
export function LiveLoadingScreen({ back, footer }: { back?: Back; footer?: ReactNode }) {
  return (
    <div className={INVITATION_SCREEN_ROOT} data-invitation-screen="live-loading">
      <ScreenHeader back={back} />
      <div className="flex flex-1 items-center justify-center pb-[60px]" aria-busy="true">
        <AmoraOrb size={64} mood="working" />
      </div>
      {footer ? <div className="shrink-0 px-[22px] pb-6">{footer}</div> : null}
    </div>
  );
}

/**
 * 빈 상태·실패 화면. 아모라가 한 줄로 말하고(17px 글줄), 필요하면 단추 하나를 둔다.
 * 새 문장을 짓지 않는다 — 넘겨받은 상태 문구만 그린다.
 */
export function LiveMessageScreen({
  back,
  text,
  sub,
  action,
  tone = "status",
  footer,
}: {
  back?: Back;
  text: string;
  sub?: string | null;
  action?: { label: string; href?: string; onClick?: () => void } | null;
  tone?: "status" | "error";
  /** 뒤로 갈 곳이 없는 첫 화면(라운지)의 실패에서 넘긴다. 다른 화면·설정으로 나갈 링크와 AI 서비스 고지. */
  footer?: ReactNode;
}) {
  return (
    <div className={INVITATION_SCREEN_ROOT} data-invitation-screen="live-message">
      <ScreenHeader back={back} />
      <div className="flex min-h-0 flex-1 flex-col items-start gap-4 overflow-y-auto px-[22px] pt-6 pb-6">
        <AmoraOrb size={44} mood="calm" />
        <p role={tone === "error" ? "alert" : undefined} className="text-[17px] leading-[1.65]">
          {text}
        </p>
        {sub ? <p className="text-[13px] leading-[1.6] text-inv-muted">{sub}</p> : null}
        {action ? (
          action.href ? (
            <Button href={action.href} variant="ink" size="pill-46" weight="bold" className="px-[22px]">
              {action.label}
            </Button>
          ) : (
            <Button variant="outline" size="pill-46" className="px-[22px]" onClick={action.onClick}>
              {action.label}
            </Button>
          )
        ) : null}
        {footer ? <div className="mt-auto w-full pt-6">{footer}</div> : null}
      </div>
    </div>
  );
}

/** 다시 불러오기 단추(실패 줄 옆). */
export function LiveRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <Button variant="outline" size="pill-38" className="self-start px-3.5" onClick={onRetry}>
      {LIVE_RETRY_LABEL}
    </Button>
  );
}

/**
 * 청첩장 홈 맨 아래. 옛 사이드바·상단 바를 걷어 낸 자리라 예산·체크리스트·일정·예절 가이드·설정을 여기서 열고,
 * 옛 라운지 바닥에 있던 AI 서비스 고지를 그대로 둔다(법적 고지 문장은 글자 그대로).
 */
export function LiveFooter() {
  return (
    <div className="flex flex-col gap-1 pt-2" data-live-footer>
      <nav aria-label={LIVE_MORE_LINKS_LABEL} className="flex flex-wrap gap-x-4 gap-y-1">
        {LIVE_MORE_LINKS.map((link) => (
          <Link
            key={link.path}
            href={weddingPath(link.path)}
            className={cx(
              "inline-flex min-h-11 items-center text-[13px] text-inv-body underline-offset-4 hover:text-inv-ink hover:underline",
              INVITATION_FOCUS_RING,
            )}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <AiNoticeFooter variant="light" />
    </div>
  );
}

/** 체험 모드(예시 커플 자료)를 보일 때 맨 위 한 줄. 업체 이름과 가격, 사진이 예시라는 것을 늘 함께 말한다. */
export function DemoExampleNote() {
  return (
    <p className="shrink-0 px-4 py-2 text-center text-[12px] leading-[1.5] text-inv-muted" data-example-banner>
      {EXAMPLE_COPY.banner}
    </p>
  );
}

/**
 * 실제 아모라 대화(`ChatSidePanel`)를 청첩장 모양으로 단다. 보내기·레인·안전·승인 경로는 대화 칸 그대로다.
 *
 * 열려 있는 대화 칸이라 닫기가 없다. 첫 실행 안내 뒤 보관해 둔 아모라의 첫마디가 있으면 한 번 건넨다
 * (전체 화면 대화가 같은 보관을 가져가는 것과 같다).
 */
export function LiveAmoraChat() {
  const ownerId = useAuthStore((state) => state.profile?.id ?? null);
  const [firstHello, setFirstHello] = useState<string | null>(null);

  useEffect(() => {
    if (!ownerId) return;
    const delivered = consumePendingAmoraFirstHello({ ownerId });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 주인이 정해진 뒤 보관을 한 번 가져온다(서버에는 없는 저장소)
    if (delivered) setFirstHello(delivered.body);
  }, [ownerId]);

  return <ChatSidePanel isOpen onClose={keepOpen} presentation="invitation" firstHello={firstHello} />;
}

/** 대화 칸은 화면 자체라 닫히지 않는다. */
function keepOpen() {}
