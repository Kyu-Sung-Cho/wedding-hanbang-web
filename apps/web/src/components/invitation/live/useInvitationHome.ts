"use client";

import { useCallback, useState } from "react";
import type {
  InvitationActivityResponse,
  InvitationConditionsPatch,
  InvitationConditionsResponse,
  InvitationConsultationResponse,
  InvitationHomeResponse,
} from "@hanbang/shared/invitation";

import { invitationRequest, type InvitationApiResult } from "./invitationApi";
import {
  isActivityResponse,
  isConditionsResponse,
  isConsultationResponse,
  isHomeResponse,
  isScheduleResult,
} from "./invitationGuards";
import { scheduleFailedMessage } from "./liveStateCopy";
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
