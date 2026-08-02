"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

type AdminSessionState =
  | { status: "checking"; userId: null; email: "" }
  | { status: "not_authenticated"; userId: null; email: "" }
  | { status: "admin"; userId: string; email: string };

const CHECKING_STATE: AdminSessionState = {
  status: "checking",
  userId: null,
  email: "",
};

export function useAdminSessionBoundary(): AdminSessionState {
  const [sessionState, setSessionState] = useState<AdminSessionState>(CHECKING_STATE);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    let verificationGeneration = 0;
    let verifiedUserId: string | null = null;
    let lastForegroundCheckAt = 0;

    const redirectToLogin = () => {
      if (window.location.pathname !== "/admin/login") {
        window.location.replace("/admin/login");
      }
    };

    const denyAccess = () => {
      verifiedUserId = null;
      setSessionState({ status: "not_authenticated", userId: null, email: "" });
      redirectToLogin();
    };

    const verify = async (expectedUserId?: string) => {
      const generation = ++verificationGeneration;
      // Unmount the entire dashboard while the cookie/Bearer session and admin
      // role are being revalidated. No prior administrator PII remains in DOM.
      setSessionState(CHECKING_STATE);

      try {
        const {
          data: { user: beforeUser },
        } = await supabase.auth.getUser();
        if (!active || generation !== verificationGeneration) return;
        if (!beforeUser || (expectedUserId && beforeUser.id !== expectedUserId)) {
          denyAccess();
          return;
        }

        const response = await fetch("/api/admin/auth", { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as {
          isAdmin?: boolean;
          email?: string;
        } | null;

        const {
          data: { user: afterUser },
        } = await supabase.auth.getUser();
        if (!active || generation !== verificationGeneration) return;
        if (
          !response.ok ||
          !payload?.isAdmin ||
          !afterUser ||
          afterUser.id !== beforeUser.id ||
          (expectedUserId !== undefined && afterUser.id !== expectedUserId)
        ) {
          denyAccess();
          return;
        }

        verifiedUserId = afterUser.id;
        setSessionState({
          status: "admin",
          userId: afterUser.id,
          email: typeof payload.email === "string" ? payload.email : afterUser.email ?? "",
        });
      } catch {
        if (active && generation === verificationGeneration) denyAccess();
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user?.id ?? null;
      if (nextUserId && verifiedUserId === nextUserId) return;

      verificationGeneration += 1;
      setSessionState(CHECKING_STATE);
      if (!nextUserId) {
        denyAccess();
        return;
      }

      window.queueMicrotask(() => {
        if (active) void verify(nextUserId);
      });
    });

    const revalidateForegroundSession = () => {
      const now = Date.now();
      if (now - lastForegroundCheckAt < 750) return;
      lastForegroundCheckAt = now;
      void verify(verifiedUserId ?? undefined);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") revalidateForegroundSession();
    };

    window.addEventListener("focus", revalidateForegroundSession);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void verify();

    return () => {
      active = false;
      verificationGeneration += 1;
      subscription.unsubscribe();
      window.removeEventListener("focus", revalidateForegroundSession);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return sessionState;
}
