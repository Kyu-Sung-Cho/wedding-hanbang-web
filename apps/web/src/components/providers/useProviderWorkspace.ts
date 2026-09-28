"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { providerWorkspaceSchema, type ProviderWorkspace } from "@/lib/providers/contracts";
import { providerFailure, providerRead } from "./providerClient";

export default function useProviderWorkspace() {
  const [workspace, setWorkspace] = useState<ProviderWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      const result = await providerRead("/api/provider/workspace", providerWorkspaceSchema, controller.signal);
      if (!controller.signal.aborted && current === generation.current) setWorkspace(result);
    } catch (cause) {
      if (!controller.signal.aborted && current === generation.current) {
        // 권한 회수 후 이전 프로필의 편집 화면을 남기지 않는다.
        setWorkspace(null); setError(providerFailure(cause));
        throw cause;
      }
    } finally { if (!controller.signal.aborted && current === generation.current) setLoading(false); }
  }, []);

  useEffect(() => { void reload().catch(() => {}); return () => { generation.current += 1; controllerRef.current?.abort(); }; }, [reload]);
  return { workspace, loading, error, reload };
}
