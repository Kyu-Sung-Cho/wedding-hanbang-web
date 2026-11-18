"use client";

import { useCallback, useRef, useState } from "react";
import {
  isJourneyAddOnKey,
  isJourneyStageKey,
  type InvitationJourneyResponse,
  type JourneyPlan,
  type JourneyPlanPatch,
} from "@hanbang/shared/invitation";

import { invitationRequest } from "./invitationApi";
import { isJourneyResponse } from "./invitationGuards";
import { JOURNEY_SAVE_FAILED } from "./liveStateCopy";
import { useMountedRef, type LiveIdentity } from "./useLiveIdentity";
import { useInvitationQuery, type InvitationQuery } from "./useInvitationQuery";

export type InvitationJourneyState = Omit<InvitationQuery<InvitationJourneyResponse>, "data"> & {
  /** 화면에 보일 준비 순서. 저장을 기다리는 동안은 누른 대로 먼저 바뀐 모습이다. */
  data: InvitationJourneyResponse | null;
  saving: boolean;
  saveFailed: string | null;
  toggleStage: (key: string) => void;
  toggleAddOn: (key: string) => void;
  /** 기다리는 저장이 모두 끝날 때까지 기다린다. 마지막 저장이 성공했으면(또는 저장할 것이 없었으면) true. */
  settle: () => Promise<boolean>;
};

type Optimistic = { base: InvitationJourneyResponse; next: InvitationJourneyResponse };

/** 누른 계획을 지금 모델에 먼저 얹는다. 끝남·지금 상태는 서버가 다시 정해 돌려준다. */
function withPlan(from: InvitationJourneyResponse, plan: JourneyPlan): InvitationJourneyResponse {
  const off = new Set<string>(plan.off);
  const addOns = new Set<string>(plan.addOns);
  return {
    plan,
    journey: {
      rows: from.journey.rows.map((row) => ({ ...row, off: row.optional && off.has(row.key) })),
      addOns: from.journey.addOns.map((addOn) => ({ ...addOn, added: addOns.has(addOn.key) })),
    },
  };
}

function toggled<T extends string>(list: readonly T[], key: T): T[] {
  return list.includes(key) ? list.filter((item) => item !== key) : [...list, key];
}

/**
 * GET `/api/invitation/journey` 와 PATCH `/journey-plan`(빼기·다시 넣기·넣기).
 *
 * 누르면 화면을 먼저 바꾸고 저장한다. 저장이 실패하면 서버가 마지막으로 확인해 준 계획으로 되돌린다.
 * 연달아 누르면 마지막 요청의 답만 화면에 쓰고, 그 앞 요청이 성공했으면 되돌아갈 자리로만 기억한다.
 */
export function useInvitationJourney(identity: LiveIdentity): InvitationJourneyState {
  const query = useInvitationQuery("/journey", {
    owner: identity.owner,
    enabled: !identity.isDemo,
    refreshKey: identity.refreshKey,
    accept: isJourneyResponse,
  });
  const [optimistic, setOptimisticState] = useState<Optimistic | null>(null);
  const optimisticRef = useRef<Optimistic | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState<string | null>(null);
  const sequence = useRef(0);
  const pending = useRef<Promise<boolean>>(Promise.resolve(true));
  const mounted = useMountedRef();
  const { replace } = query;
  const shown = optimistic?.next ?? query.data;

  const setOptimistic = useCallback((value: Optimistic | null) => {
    optimisticRef.current = value;
    setOptimisticState(value);
  }, []);

  const send = useCallback(
    (from: InvitationJourneyResponse, confirmed: InvitationJourneyResponse, plan: JourneyPlan) => {
      setOptimistic({ base: confirmed, next: withPlan(from, plan) });
      setSaveFailed(null);
      setSaving(true);
      const id = ++sequence.current;
      const body: JourneyPlanPatch = { off: plan.off, addOns: plan.addOns };
      pending.current = invitationRequest("/journey-plan", { method: "PATCH", body, accept: isJourneyResponse }).then(
        (result) => {
          if (!mounted.current) return result.ok;
          if (id !== sequence.current) {
            // 뒤에 누른 요청이 아직 남았다. 이 답이 성공이면 되돌아갈 자리만 새로 기억한다.
            const current = optimisticRef.current;
            if (result.ok && current) setOptimistic({ ...current, base: result.data });
            return result.ok;
          }
          setSaving(false);
          if (result.ok) {
            replace(result.data);
          } else {
            const base = optimisticRef.current?.base;
            if (base) replace(base);
            setSaveFailed(JOURNEY_SAVE_FAILED);
          }
          setOptimistic(null);
          return result.ok;
        },
      );
    },
    [mounted, replace, setOptimistic],
  );

  const confirmed = optimistic?.base ?? query.data;

  const toggleStage = useCallback(
    (key: string) => {
      if (!shown || !confirmed || !isJourneyStageKey(key)) return;
      if (!shown.journey.rows.some((row) => row.key === key && row.optional)) return;
      send(shown, confirmed, { off: toggled(shown.plan.off, key), addOns: shown.plan.addOns });
    },
    [confirmed, send, shown],
  );

  const toggleAddOn = useCallback(
    (key: string) => {
      if (!shown || !confirmed || !isJourneyAddOnKey(key)) return;
      if (!shown.journey.addOns.some((addOn) => addOn.key === key)) return;
      send(shown, confirmed, { off: shown.plan.off, addOns: toggled(shown.plan.addOns, key) });
    },
    [confirmed, send, shown],
  );

  const settle = useCallback(async () => {
    let waiting: Promise<boolean>;
    let ok = true;
    do {
      waiting = pending.current;
      ok = await waiting;
    } while (waiting !== pending.current);
    return ok;
  }, []);

  return { ...query, data: shown, saving, saveFailed, toggleStage, toggleAddOn, settle };
}
