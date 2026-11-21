"use client";

import { useCallback, useRef, useState } from "react";
import {
  VENDOR_REPLY_COPY,
  type ConsultationPasteSchedulePost,
  type ConsultationScheduleResult,
  type InvitationActivityResponse,
  type InvitationConditionsPatch,
  type InvitationConditionsResponse,
  type InvitationConsultationResponse,
  type InvitationHomeResponse,
} from "@hanbang/shared/invitation";

import { invitationRequest, type InvitationApiResult } from "./invitationApi";
import {
  isActivityResponse,
  isConditionsResponse,
  isConsultationResponse,
  isHomeResponse,
  isScheduleResult,
} from "./invitationGuards";
import { pasteScheduleFailedMessage, scheduleFailedMessage } from "./liveStateCopy";
import { useMountedRef, type LiveIdentity } from "./useLiveIdentity";
import { useInvitationQuery, type InvitationQuery } from "./useInvitationQuery";

/**
 * 청첩장 홈·오늘 한 일·조건·상담 읽기(2026-11-17). 체험 모드는 서버를 부르지 않고 예시 커플을 쓴다.
 */

function queryOptions(identity: LiveIdentity, enabled = true) {
  return { owner: identity.owner, enabled: enabled && !identity.isDemo, refreshKey: identity.refreshKey };
}

/** GET `/api/invitation/home`. */
export function useInvitationHome(identity: LiveIdentity, enabled = true): InvitationQuery<InvitationHomeResponse> {
  return useInvitationQuery("/home", { ...queryOptions(identity, enabled), accept: isHomeResponse });
}

/** GET `/api/invitation/activity`. 웹 준비 공간의 "오늘" 칸이 쓴다. */
export function useInvitationActivity(
  identity: LiveIdentity,
  enabled = true,
): InvitationQuery<InvitationActivityResponse> {
  return useInvitationQuery("/activity", { ...queryOptions(identity, enabled), accept: isActivityResponse });
}

export type InvitationConditionsState = InvitationQuery<InvitationConditionsResponse> & {
  saving: boolean;
  save: (patch: InvitationConditionsPatch) => Promise<InvitationApiResult<InvitationConditionsResponse>>;
};

/** GET·PATCH `/api/invitation/conditions`. 저장이 끝나면 서버가 준 조건으로 바꾼다. */
export function useInvitationConditions(identity: LiveIdentity, enabled = true): InvitationConditionsState {
  const query = useInvitationQuery("/conditions", { ...queryOptions(identity, enabled), accept: isConditionsResponse });
  const [saving, setSaving] = useState(false);
  const mounted = useMountedRef();
  const { replace } = query;

  const save = useCallback(
    async (patch: InvitationConditionsPatch) => {
      setSaving(true);
      const result = await invitationRequest("/conditions", { method: "PATCH", body: patch, accept: isConditionsResponse });
      if (mounted.current) {
        setSaving(false);
        if (result.ok) replace(result.data);
      }
      return result;
    },
    [mounted, replace],
  );

  return { ...query, saving, save };
}

export type InvitationConsultationState = InvitationQuery<InvitationConsultationResponse> & {
  adding: boolean;
  /** 방금 이 화면에서 일정에 넣었다. */
  added: boolean;
  addFailed: string | null;
  addToCalendar: () => Promise<void>;
};

/**
 * GET `/api/invitation/consultation` 과 POST `/consultation/schedule`. 일정에 넣는 것은 커플이 누를 때만이다 —
 * 이 훅은 스스로 넣지 않는다.
 */
export function useInvitationConsultation(identity: LiveIdentity): InvitationConsultationState {
  const query = useInvitationQuery("/consultation", { ...queryOptions(identity), accept: isConsultationResponse });
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [addFailed, setAddFailed] = useState<string | null>(null);
  const mounted = useMountedRef();
  const replyId = query.data?.replyId ?? null;
  const { update } = query;

  const addToCalendar = useCallback(async () => {
    if (!replyId || adding) return;
    setAdding(true);
    setAddFailed(null);
    const result = await invitationRequest("/consultation/schedule", {
      method: "POST",
      body: { replyId },
      accept: isScheduleResult,
    });
    if (!mounted.current) return;
    setAdding(false);
    if (result.ok) {
      setAdded(true);
      update((data) => ({ ...data, inCalendar: true }));
    } else {
      setAddFailed(scheduleFailedMessage(result));
    }
  }, [adding, mounted, replyId, update]);

  return { ...query, adding, added, addFailed, addToCalendar };
}

/** 붙여 넣은 답으로 일정 넣기의 결과 한 줄. */
export type PastedScheduleOutcome = { tone: "status" | "error"; text: string };

export type PastedConsultationScheduleState = {
  adding: boolean;
  outcome: PastedScheduleOutcome | null;
  /** 사람이 넣기를 눌렀을 때만 부른다. 이미 하나가 돌고 있으면 아무것도 하지 않는다. */
  add: (body: ConsultationPasteSchedulePost) => Promise<void>;
  /** 사람이 칸을 바꾸면 앞 결과 줄을 거둔다. */
  clear: () => void;
};

function pastedScheduleOutcome(result: InvitationApiResult<ConsultationScheduleResult>): PastedScheduleOutcome {
  if (!result.ok) return { tone: "error", text: pasteScheduleFailedMessage(result) };
  if (result.data.added) return { tone: "status", text: VENDOR_REPLY_COPY.added };
  if (result.data.alreadyInCalendar) return { tone: "status", text: VENDOR_REPLY_COPY.alreadyAdded };
  return { tone: "error", text: VENDOR_REPLY_COPY.failed };
}

export type PastedConsultationScheduleOptions = {
  /**
   * 새 상담을 일정에 넣었다(`added: true`). 이미 있던 일정(`alreadyInCalendar`)이나 실패에는 부르지 않는다. 상담 화면은
   * 이때 상담을 다시 읽어 넣은 상담 수(`replyPaste.addedCount`)를 맞춘다. 붙여 넣기 칸을 닫은 뒤에 끝나도 부른다.
   */
  onAdded?: () => void;
};

/**
 * POST `/consultation/paste-schedule`(D-83 1단계). 붙여 넣은 업체 답에서 사람이 고른 날짜(와 시간)로 상담 일정 하나를
 * 넣는다. 보내는 것은 홀·날짜·시간 세 칸뿐이고 붙여 넣은 글은 이 요청에 없다. 이 훅은 스스로 넣지 않는다.
 */
export function usePastedConsultationSchedule(options: PastedConsultationScheduleOptions = {}): PastedConsultationScheduleState {
  const { onAdded } = options;
  const [adding, setAdding] = useState(false);
  const [outcome, setOutcome] = useState<PastedScheduleOutcome | null>(null);
  const mounted = useMountedRef();
  // 같은 그림에서 두 번 누르면 `adding` 이 아직 거짓이다. 요청 하나가 끝날 때까지 다음 요청을 막는 표시.
  const writingRef = useRef(false);

  const add = useCallback(
    async (body: ConsultationPasteSchedulePost) => {
      if (writingRef.current) return;
      writingRef.current = true;
      setAdding(true);
      setOutcome(null);
      try {
        const result = await invitationRequest("/consultation/paste-schedule", {
          method: "POST",
          body: { hallId: body.hallId, date: body.date, ...(body.time ? { time: body.time } : {}) },
          accept: isScheduleResult,
        });
        if (mounted.current) setOutcome(pastedScheduleOutcome(result));
        if (result.ok && result.data.added) onAdded?.();
      } finally {
        writingRef.current = false;
        if (mounted.current) setAdding(false);
      }
    },
    [mounted, onAdded],
  );
  const clear = useCallback(() => setOutcome(null), []);

  return { adding, outcome, add, clear };
}
