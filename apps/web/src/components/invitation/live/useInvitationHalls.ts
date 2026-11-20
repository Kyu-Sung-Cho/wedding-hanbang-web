"use client";

import { useCallback, useMemo, useState } from "react";
import type { CompareSortId, InvitationHallsResponse } from "@hanbang/shared/invitation";

import { invitationRequest } from "./invitationApi";
import { isHallsResponse, isShortlistResponse } from "./invitationGuards";
import { shortlistFailedMessage } from "./liveStateCopy";
import { useMountedRef, type LiveIdentity } from "./useLiveIdentity";
import { useInvitationQuery, type InvitationQuery } from "./useInvitationQuery";

export type InvitationHallsState = InvitationQuery<InvitationHallsResponse> & {
  /** 담기·빼기가 실패한 까닭. 다음에 누르면 지운다. */
  shortlistFailed: string | null;
  toggleShortlist: (hallId: string) => Promise<void>;
};

/**
 * GET `/api/invitation/halls?sort=` 와 담기·빼기(POST·DELETE `/halls/{id}/shortlist`).
 *
 * 하트는 누르면 먼저 바뀌고, 서버가 답하면 그 답(담겼는지, 몇 곳인지)으로 맞춘다. 실패하면 되돌리고 까닭을 말한다.
 * 담는 것은 커플 안의 선호라 업체로 아무것도 나가지 않는다(서버 경로 설명 그대로).
 */
export function useInvitationHalls(identity: LiveIdentity, sort: CompareSortId, enabled = true): InvitationHallsState {
  const query = useInvitationQuery(`/halls?sort=${encodeURIComponent(sort)}`, {
    owner: identity.owner,
    enabled: enabled && !identity.isDemo,
    refreshKey: identity.refreshKey,
    accept: isHallsResponse,
  });
  const [pending, setPending] = useState<Readonly<Record<string, boolean>>>({});
  const [shortlistFailed, setShortlistFailed] = useState<string | null>(null);
  const mounted = useMountedRef();
  const { update } = query;

  const data = useMemo<InvitationHallsResponse | null>(() => {
    const base = query.data;
    if (!base?.compare || Object.keys(pending).length === 0) return base;
    return {
      ...base,
      compare: {
        ...base.compare,
        halls: base.compare.halls.map((hall) => (hall.id in pending ? { ...hall, picked: pending[hall.id] } : hall)),
      },
    };
  }, [pending, query.data]);

  const toggleShortlist = useCallback(
    async (hallId: string) => {
      const hall = data?.compare?.halls.find((candidate) => candidate.id === hallId);
      if (!hall || hallId in pending) return;
      const nextPicked = !hall.picked;
      setShortlistFailed(null);
      setPending((current) => ({ ...current, [hallId]: nextPicked }));
      const result = await invitationRequest(`/halls/${encodeURIComponent(hallId)}/shortlist`, {
        method: nextPicked ? "POST" : "DELETE",
        accept: isShortlistResponse,
      });
      if (!mounted.current) return;
      if (result.ok) {
        update((current) =>
          current.compare
            ? {
              ...current,
              pickedCount: result.data.pickedCount,
              compare: {
                ...current.compare,
                halls: current.compare.halls.map((candidate) =>
                  candidate.id === hallId ? { ...candidate, picked: result.data.picked } : candidate),
              },
            }
            : { ...current, pickedCount: result.data.pickedCount },
        );
      } else {
        setShortlistFailed(shortlistFailedMessage(result));
      }
      setPending((current) => {
        const next = { ...current };
        delete next[hallId];
        return next;
      });
    },
    [data, mounted, pending, update],
  );

  return { ...query, data, shortlistFailed, toggleShortlist };
}
