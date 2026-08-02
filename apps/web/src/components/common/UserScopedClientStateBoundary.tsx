"use client";

import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MOBILE_WEB_API_NONCE_PROPERTY,
} from "@/lib/mobile/mobileAuthenticatedFetch";
import { createClient } from "@/lib/supabase/client";
import {
  clearUserScopedClientState,
  reconcileUserScopedClientActor,
  userScopedActorKeyForUser,
} from "@/lib/auth/userScopedClientState";

export type UserScopedActorKind = "user" | "guest" | "demo" | "native";

export type UserScopedClientActor = {
  status: "verifying" | "ready" | "error";
  actorKey: string | null;
  kind: UserScopedActorKind | null;
  userId: string | null;
  generation: number;
};

type ResolvedActor = {
  actorKey: string;
  kind: UserScopedActorKind;
  userId: string | null;
};

const PENDING_ACTOR: UserScopedClientActor = {
  status: "verifying",
  actorKey: null,
  kind: null,
  userId: null,
  generation: 0,
};

const UserScopedClientActorContext = createContext<UserScopedClientActor>(PENDING_ACTOR);

let latestCommittedActor: ResolvedActor | null = null;
let latestCommittedActorOwner: symbol | null = null;

export function getCurrentVerifiedUserScopedActor(): Readonly<ResolvedActor> | null {
  return latestCommittedActor ? { ...latestCommittedActor } : null;
}

function demoModeEnabled(): boolean {
  return typeof document !== "undefined" && document.cookie.includes("demo_mode=true");
}

function nativeActor(): ResolvedActor | null {
  if (typeof window === "undefined" || !window.ReactNativeWebView) return null;
  const nonce = window[MOBILE_WEB_API_NONCE_PROPERTY];
  if (typeof nonce !== "string" || !/^[0-9a-f-]{36}$/i.test(nonce)) return null;
  return { actorKey: `native:${nonce}`, kind: "native", userId: null };
}

function fallbackActor(): ResolvedActor {
  const native = nativeActor();
  if (native) return native;
  if (demoModeEnabled()) return { actorKey: "demo", kind: "demo", userId: "demo" };
  return { actorKey: "guest", kind: "guest", userId: null };
}

async function resolveVerifiedActor(supabase: SupabaseClient): Promise<ResolvedActor> {
  const native = nativeActor();
  if (native) return native;

  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (data.user?.id) {
    return {
      actorKey: userScopedActorKeyForUser(data.user.id),
      kind: "user",
      userId: data.user.id,
    };
  }
  return fallbackActor();
}

function actorCandidateFromSession(session: { user?: { id?: string } } | null): ResolvedActor {
  const native = nativeActor();
  if (native) return native;
  const userId = session?.user?.id;
  if (userId) {
    return { actorKey: userScopedActorKeyForUser(userId), kind: "user", userId };
  }
  return fallbackActor();
}

export function useUserScopedClientActor(): UserScopedClientActor {
  return useContext(UserScopedClientActorContext);
}

export default function UserScopedClientStateBoundary({
  children,
  hideUntilVerified = false,
  fallback = null,
}: {
  children: ReactNode;
  hideUntilVerified?: boolean;
  fallback?: ReactNode;
}) {
  const ownerToken = useMemo(() => Symbol("user-scoped-client-boundary"), []);
  const [actor, setActor] = useState<UserScopedClientActor>(PENDING_ACTOR);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const activeActorRef = useRef<ResolvedActor | null>(null);
  const supabaseRef = useRef<SupabaseClient | null>(null);

  const suspend = useCallback((candidate?: ResolvedActor): number => {
    const generation = ++generationRef.current;
    const current = activeActorRef.current;

    // An auth event already tells us the identity differs. Clear synchronously
    // so React cannot paint the old actor while the network verification runs.
    if (current && candidate && current.actorKey !== candidate.actorKey) {
      clearUserScopedClientState(current.actorKey);
    }
    // A suspended identity is no longer authoritative. Keeping the old actor
    // here could make a rapid B -> A event look like a harmless token refresh
    // and allow an older B verification to commit afterward.
    activeActorRef.current = null;
    if (latestCommittedActorOwner === ownerToken) {
      latestCommittedActor = null;
    }
    setActor({ ...PENDING_ACTOR, generation });
    return generation;
  }, [ownerToken]);

  const commit = useCallback((resolved: ResolvedActor, generation: number) => {
    if (!mountedRef.current || generation !== generationRef.current) return;
    reconcileUserScopedClientActor(resolved.actorKey);
    activeActorRef.current = resolved;
    latestCommittedActor = resolved;
    latestCommittedActorOwner = ownerToken;
    setActor({ status: "ready", ...resolved, generation });
  }, [ownerToken]);

  const verify = useCallback(async (generation: number, expected?: ResolvedActor) => {
    const supabase = supabaseRef.current;
    if (!supabase) return;
    try {
      const resolved = await resolveVerifiedActor(supabase);
      if (expected && resolved.actorKey !== expected.actorKey) {
        throw new Error("AUTH_ACTOR_MISMATCH");
      }
      commit(resolved, generation);
    } catch {
      if (!mountedRef.current || generation !== generationRef.current) return;
      if (latestCommittedActorOwner === ownerToken) latestCommittedActor = null;
      setActor({ ...PENDING_ACTOR, status: "error", generation });
    }
  }, [commit, ownerToken]);

  useEffect(() => {
    mountedRef.current = true;
    const supabase = createClient();
    supabaseRef.current = supabase;

    const initialGeneration = suspend();
    void verify(initialGeneration);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const candidate = actorCandidateFromSession(session);
      const current = activeActorRef.current;

      if (
        current?.actorKey === candidate.actorKey
        && (event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "USER_UPDATED")
      ) {
        return;
      }

      const generation = suspend(candidate);
      // Supabase advises deferring follow-up auth calls until its callback has
      // finished publishing the new cookie-backed session.
      window.queueMicrotask(() => {
        if (mountedRef.current) void verify(generation, candidate);
      });
    });

    const verifyAfterExternalChange = () => {
      const generation = suspend();
      void verify(generation);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") verifyAfterExternalChange();
    };

    window.addEventListener("focus", verifyAfterExternalChange);
    window.addEventListener("online", verifyAfterExternalChange);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      subscription.unsubscribe();
      window.removeEventListener("focus", verifyAfterExternalChange);
      window.removeEventListener("online", verifyAfterExternalChange);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (latestCommittedActorOwner === ownerToken) {
        latestCommittedActor = null;
        latestCommittedActorOwner = null;
      }
    };
  }, [ownerToken, suspend, verify]);

  if (hideUntilVerified && actor.status !== "ready") return fallback;

  const subtreeKey = actor.status === "ready"
    ? `actor:${actor.actorKey}`
    : `pending:${actor.generation}`;

  return (
    <UserScopedClientActorContext.Provider value={actor}>
      <Fragment key={subtreeKey}>{children}</Fragment>
    </UserScopedClientActorContext.Provider>
  );
}
