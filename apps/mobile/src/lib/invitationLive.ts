// 청첩장 디자인(2026-11-17) 실제 커플 화면이 쓰는 API 묶음과 로그인 확인.
//
// 요청은 시작 시점 사용자에게 묶는다(`apiFetchForExpectedUser`). 계정을 바꾼 뒤 늦게 도착한 응답이
// 다른 사람의 청첩장·편지를 그리면 안 된다. 세션이 바뀌면 탭 틀이 화면을 새로 그린다(`(tabs)/_layout.tsx`).
import { useEffect, useState } from "react";
import { apiFetchForExpectedUser } from "@/lib/api";
import { createInvitationApi, type InvitationApi } from "@/lib/invitationApi.mjs";
import { supabase } from "@/lib/supabase";

export function invitationApiFor(ownerId: string): InvitationApi {
  return createInvitationApi((path, init) => apiFetchForExpectedUser(ownerId, path, init));
}

export type LiveOwner =
  | { status: "checking" }
  | { status: "guest" }
  | { status: "ready"; ownerId: string; api: InvitationApi };

/** 지금 로그인한 사람과 그 사람에게 묶인 API. 세션을 못 읽으면 로그아웃으로 본다(요청을 보내지 않는다). */
export function useLiveOwner(): LiveOwner {
  const [owner, setOwner] = useState<LiveOwner>({ status: "checking" });
  useEffect(() => {
    let active = true;
    // 토큰만 새로 받은 경우(같은 사람)는 그대로 둔다. 새 묶음을 만들면 화면이 다시 불러온다.
    const apply = (ownerId: string | null) => {
      if (!active) return;
      setOwner((current) => {
        if (ownerId && current.status === "ready" && current.ownerId === ownerId) return current;
        if (!ownerId && current.status === "guest") return current;
        return ownerId ? { status: "ready", ownerId, api: invitationApiFor(ownerId) } : { status: "guest" };
      });
    };
    supabase.auth.getSession()
      .then(({ data }) => apply(data.session?.user.id ?? null))
      .catch(() => apply(null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      apply(session?.user.id ?? null);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  return owner;
}
