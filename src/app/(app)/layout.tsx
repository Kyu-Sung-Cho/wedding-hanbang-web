"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import { useJourneyStore } from "@/stores/journeyStore";
import { useBudgetStore } from "@/stores/budgetStore";
import { useScheduleStore } from "@/stores/scheduleStore";
import { useChatStore } from "@/stores/chatStore";
import Sidebar from "@/components/app/common/Sidebar";
import TopNav from "@/components/app/common/TopNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { setUser, setSession, setLoading, setInitialized, isInitialized } =
    useAuthStore();
  const dataLoadedRef = useRef(false);

  useEffect(() => {
    const supabase = createClient();

    const initAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }

      setSession(session);
      setUser(session.user);
      setLoading(false);
      setInitialized(true);

      // 인증 후 Supabase 데이터 로드 (한 번만)
      if (!dataLoadedRef.current) {
        dataLoadedRef.current = true;
        loadAllData(session.user.id);
      }
    };

    initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setSession(session);
        setUser(session.user);
      } else {
        router.push("/login");
      }
    });

    return () => subscription.unsubscribe();
  }, [router, setUser, setSession, setLoading, setInitialized]);

  // 모든 스토어 데이터를 Supabase에서 로드
  const loadAllData = async (userId: string) => {
    const supabase = createClient();

    try {
      // 1. 프로필에서 couple_id 가져오기
      const { data: profile } = await supabase
        .from("profiles")
        .select("couple_id, role")
        .eq("id", userId)
        .single();

      if (!profile?.couple_id) {
        // 커플 미연결 상태 - 기본값 유지
        return;
      }

      const coupleId = profile.couple_id;

      // 2. 역할 설정
      if (profile.role) {
        useJourneyStore.getState().setRole(profile.role as "bride" | "groom");
      }

      // 3. 모든 스토어 병렬 로딩
      await Promise.all([
        useJourneyStore.getState().loadFromServer(coupleId),
        useBudgetStore.getState().loadFromServer(coupleId),
        useScheduleStore.getState().loadFromServer(coupleId),
        useChatStore.getState().loadFromServer(coupleId),
      ]);
    } catch (error) {
      console.error("데이터 로드 실패:", error);
    }
  };

  if (!isInitialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ivory-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-rose-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-ivory-50">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopNav />
        <main className="flex-1 overflow-y-auto p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
