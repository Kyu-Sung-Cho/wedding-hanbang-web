"use client";

import { useEffect, useState } from "react";
import AuthInitializer from "@/components/common/AuthInitializer";
import { isPreviewStubMode } from "@/lib/previewStub";
import { createClient } from "@/lib/supabase/client";

export default function CommunityAuthInitializer() {
  const previewStubMode = isPreviewStubMode();
  const [communityHasSession, setCommunityHasSession] = useState(
    () =>
      typeof document !== "undefined" &&
      (document.cookie.includes("demo_mode=true") || document.cookie.includes("sb-"))
  );

  useEffect(() => {
    if (previewStubMode || communityHasSession) return;

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
  }, [communityHasSession, previewStubMode]);

  if (previewStubMode || !communityHasSession) return null;
  return <AuthInitializer />;
}
