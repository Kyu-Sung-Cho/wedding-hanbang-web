"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import AuthInitializer from "@/components/common/AuthInitializer";
import { createClient } from "@/lib/supabase/client";

export default function CommunityAuthInitializer() {
  const pathname = usePathname();
  const shouldAlwaysInitialize = pathname !== "/community";
  const [communityHasSession, setCommunityHasSession] = useState(
    () =>
      typeof document !== "undefined" &&
      (document.cookie.includes("demo_mode=true") || document.cookie.includes("sb-"))
  );

  useEffect(() => {
    if (pathname !== "/community") return;
    if (communityHasSession) return;

    let cancelled = false;
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) {
        setCommunityHasSession(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [communityHasSession, pathname]);

  if (!shouldAlwaysInitialize && !communityHasSession) return null;
  return <AuthInitializer />;
}
