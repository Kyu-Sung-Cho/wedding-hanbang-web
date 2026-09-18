"use client";

import { useMemo } from "react";
import { AMORA_RECAP_REQUEST, buildAmoraConversationRecap, type ConversationRecap } from "@hanbang/shared";
import Button from "@/components/ui/Button";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { weddingPath } from "@/lib/weddingPaths";
import { getPendingAmoraAction } from "../PendingAmoraActionCard";
import type { ChatMessageVisibility } from "@/types/database.types";

const labels: Record<ConversationRecap["actions"][number]["state"], string> = {
  applied: "반영 결과 확인됨", pending: "확인 전 · 아직 반영 안 됨", awaiting_result: "승인 후 결과 확인 중",
  failed: "반영 실패 · 다시 확인 필요", expired: "기한 만료 · 새 제안 필요", superseded: "이전 제안 · 다시 확인 필요",
};

// 정리 부탁 문장은 앱 정리 시트와 같은 것을 쓴다 — `@hanbang/shared` 한 곳에 있다(2026-09-18).

export interface ConversationRecapPanelProps {
  visibility: ChatMessageVisibility;
  nowMs: number;
  canDraft: boolean;
  onDraft(text: string): void;
}

export default function ConversationRecapPanel({ visibility, nowMs, canDraft, onDraft }: ConversationRecapPanelProps) {
  const { profile, couple, isDemo } = useAuthStore();
  const { messages, initialLoadDone, isLoading, sharedClearedAt, privateClearedAt } = useChatStore();
  const recap = useMemo(() => profile && couple && profile.couple_id === couple.id
    && (profile.role === "bride" || profile.role === "groom")
    && (profile.role === "bride" ? couple.bride_id : couple.groom_id) === profile.id
    ? buildAmoraConversationRecap({ messages, coupleId: couple.id, userId: profile.id, role: profile.role,
      visibility, clearedAt: visibility === "shared" ? sharedClearedAt : privateClearedAt,
      nowMs, readPending: getPendingAmoraAction }) : null,
  [profile, couple, messages, visibility, sharedClearedAt, privateClearedAt, nowMs]);
  const shared = visibility === "shared";
  return <section className="space-y-4 p-4 text-sm text-[var(--hb-text-body)]" aria-label="현재 범위 대화 정리">
    <div className="space-y-1 border-b border-[var(--hb-hairline)] pb-3">
      <p className="font-semibold text-[var(--hb-text-strong)]">{shared ? "함께 대화 정리" : "나만 보는 대화 정리"}</p>
      <p className="text-xs leading-relaxed">{shared ? "함께 대화에 저장된 내용만 보여요." : "내 비공개 대화에 저장된 내용만 보여요. 상대방에게 공유하지 않아요."}</p>
      <p className="text-xs leading-relaxed">불러온 최근 대화 기준이에요. 화면에서 정리한 대화는 다시 꺼내지 않아요.</p>
    </div>
    {isDemo ? <p>체험 대화는 저장되지 않아요. 내 정보로 시작한 뒤 대화를 이어갈 수 있어요.</p>
      : isLoading || !initialLoadDone ? <p role="status">저장된 대화를 불러오는 중…</p>
      : !recap?.messageCount ? <p>이 범위에서 이어볼 대화가 아직 없어요.</p>
      : <>
        <p className="text-xs text-[var(--hb-text-muted)]">최근 대화일 {recap.day} · 불러온 메시지 {recap.messageCount}개</p>
        {recap.lastQuestion && <div className="space-y-2">
          <h4 className="font-semibold text-[var(--hb-text-strong)]">마지막으로 내가 물어본 내용</h4>
          <p className="whitespace-pre-wrap break-words rounded-[6px] bg-[var(--hb-surface-hover)] p-3 leading-relaxed">{recap.lastQuestion.text}</p>
          <Button variant="secondary" disabled={!canDraft} fullWidth onClick={() => onDraft(`이전에 내가 물어본 내용이에요:\n${recap.lastQuestion!.text}\n\n현재 상태를 확인하고 여기서 이어서 이야기해줘. 이미 반영된 변경은 다시 실행하지 마.`)} className="whitespace-normal!">이 내용으로 이어서 입력</Button>
        </div>}
        {recap.actions.length > 0 && <div className="space-y-2">
          <h4 className="font-semibold text-[var(--hb-text-strong)]">제안과 반영 기록</h4>
          <p className="text-xs leading-relaxed">제안은 확정된 결정이 아니에요. 반영 후 변경된 최신 값은 예산·일정 탭에서 확인해 주세요.</p>
          <ul className="divide-y divide-[var(--hb-hairline)]">
            {recap.actions.map(action => <li key={action.actionId} className="space-y-1 py-3">
              <p className="text-xs font-semibold text-[var(--hb-accent-hover)]">{labels[action.state]}</p>
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{action.text}</p>
            </li>)}
          </ul>
        </div>}
        <Button variant="secondary" disabled={!canDraft} fullWidth className="whitespace-normal!" onClick={() => onDraft(AMORA_RECAP_REQUEST)}>대화 정리 요청을 입력창에 넣기</Button>
        <p className="text-xs leading-relaxed">입력한 문장을 확인하고 보내 주세요. 아모라의 정리는 이 대화에 남으며 예산·일정·할 일을 자동으로 변경하지 않아요.</p>
        {!canDraft && <p role="status" className="text-xs">작성 중인 내용이나 진행 중인 답변을 마친 뒤 이어갈 수 있어요.</p>}
      </>}
    <div className="flex flex-wrap gap-2 border-t border-[var(--hb-hairline)] pt-3">
      {shared ? <><Button href={weddingPath("/chat/board")} variant="ghost">준비 보드</Button><Button href={weddingPath("/budget")} variant="ghost">현재 예산</Button></>
        : <Button href={weddingPath("/chat/personal")} variant="ghost">개인 할 일</Button>}
    </div>
  </section>;
}
