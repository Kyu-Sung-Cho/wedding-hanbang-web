"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { invitationRequest, type InvitationApiFailure } from "./invitationApi";

type Settled<T> = {
  requestKey: string;
  owner: string;
  data: T | null;
  failure: InvitationApiFailure | null;
};

export type InvitationQuery<T> = {
  /** 마지막 요청이 아직 끝나지 않았다. 같은 사람의 앞 자료가 있으면 `data` 에 남아 있다. */
  loading: boolean;
  data: T | null;
  /** 마지막 요청의 실패(화면을 떠나 멈춘 요청은 빼고). 다시 불러오는 동안은 null 이다. */
  failure: InvitationApiFailure | null;
  reload: () => void;
  /** 쓰기 응답처럼 서버가 방금 준 자료로 바꾼다. 그사이 끝난 옛 읽기는 버린다. */
  replace: (data: T) => void;
  /** 서버가 확인해 준 한 칸만 지금 자료에 얹는다(예: 담기 결과). 자료가 없으면 아무것도 하지 않는다. */
  update: (updater: (data: T) => T) => void;
};

export type InvitationQueryOptions<T> = {
  /**
   * 지금 로그인한 사람. 바뀌면 앞 사람의 자료를 곧바로 버린다 — 같은 탭에서 계정이 바뀌어도
   * 앞 사람의 이름·날짜·업체가 새 사람 화면에 남지 않는다. 없으면(로그인 전) 부르지 않는다.
   */
  owner: string | null;
  enabled?: boolean;
  /** 바뀌면 다시 부른다(예: 실시간 동기화가 받아 온 준비 정보 판 번호). */
  refreshKey?: string | number | null;
  accept: (value: unknown) => value is T;
};

/**
 * 청첩장 화면의 읽기 하나. 같은 출처로 부르고, 화면을 떠나거나 주소가 바뀌면 앞 요청을 멈춘다.
 */
export function useInvitationQuery<T>(path: string | null, options: InvitationQueryOptions<T>): InvitationQuery<T> {
  const { owner, enabled = true, refreshKey = null, accept } = options;
  const [reloadToken, setReloadToken] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  // `replace` 가 자료를 바꾸면 그 전에 떠난 읽기의 답은 버린다(옛 답이 새 자료를 덮지 않게).
  const generationRef = useRef(0);
  const active = enabled && path !== null && owner !== null;
  const requestKey = active ? JSON.stringify([owner, path, refreshKey, reloadToken]) : null;

  useEffect(() => {
    if (requestKey === null || path === null || owner === null) return;
    const controller = new AbortController();
    const generation = generationRef.current;
    void invitationRequest<T>(path, { signal: controller.signal, accept }).then((result) => {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      if (!result.ok && result.aborted) return;
      setSettled((previous) => ({
        requestKey,
        owner,
        data: result.ok ? result.data : previous && previous.owner === owner ? previous.data : null,
        failure: result.ok ? null : result,
      }));
    });
    return () => controller.abort();
  }, [accept, owner, path, requestKey]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);
  const replace = useCallback(
    (data: T) => {
      if (requestKey === null || owner === null) return;
      generationRef.current += 1;
      setSettled({ requestKey, owner, data, failure: null });
    },
    [owner, requestKey],
  );
  const update = useCallback(
    (updater: (data: T) => T) => {
      setSettled((previous) =>
        previous !== null && previous.owner === owner && previous.data !== null
          ? { ...previous, data: updater(previous.data) }
          : previous,
      );
    },
    [owner],
  );

  const ownData = settled !== null && owner !== null && settled.owner === owner ? settled.data : null;
  const current = settled !== null && settled.requestKey === requestKey ? settled : null;
  return {
    loading: requestKey !== null && current === null,
    data: active ? ownData : null,
    failure: current?.failure ?? null,
    reload,
    replace,
    update,
  };
}
