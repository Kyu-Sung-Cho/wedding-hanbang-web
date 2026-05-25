"use client";

import { create } from "zustand";
import type {
  Invitation,
  InvitationTemplate,
  InvitationPhoto,
  InvitationAccount,
  InvitationRsvp,
  InvitationGuestbook,
  InvitationStats,
  EditorStep,
  CongratulatoryMoney,
  AiScript,
} from "@/types/invitation.types";

interface InvitationStoreState {
  // 템플릿
  templates: InvitationTemplate[];
  templatesLoading: boolean;

  // 내 청첩장 목록
  invitations: Invitation[];
  invitationsLoading: boolean;

  // 현재 편집 중인 청첩장
  current: Invitation | null;
  currentLoading: boolean;

  // 에디터 상태
  editorStep: EditorStep;
  editorDirty: boolean;

  // 사진/계좌/RSVP/방명록
  photos: InvitationPhoto[];
  accounts: InvitationAccount[];
  rsvpList: InvitationRsvp[];
  guestbook: InvitationGuestbook[];
  stats: InvitationStats | null;

  // 축의금
  moneyList: CongratulatoryMoney[];
  moneyLoading: boolean;
  moneyLocalMode: boolean;

  // AI 대본
  scripts: AiScript[];
  scriptsLoading: boolean;
  scriptStreaming: boolean;
  scriptStreamContent: string;

  error: string | null;

  // 템플릿
  loadTemplates: () => Promise<void>;

  // 청첩장 CRUD
  loadInvitations: (coupleId: string) => Promise<void>;
  loadInvitation: (id: string) => Promise<void>;
  createInvitation: (data: Partial<Invitation>) => Promise<Invitation | null>;
  updateInvitation: (id: string, data: Partial<Invitation>) => Promise<void>;
  deleteInvitation: (id: string) => Promise<void>;
  publishInvitation: (id: string) => Promise<void>;

  // 에디터
  setEditorStep: (step: EditorStep) => void;
  setEditorDirty: (dirty: boolean) => void;
  updateCurrent: (data: Partial<Invitation>) => void;

  // 사진
  loadPhotos: (invitationId: string) => Promise<void>;
  addPhoto: (invitationId: string, url: string, caption?: string) => Promise<void>;
  removePhoto: (photoId: string) => Promise<void>;
  reorderPhotos: (invitationId: string, photoIds: string[]) => Promise<void>;

  // 계좌
  loadAccounts: (invitationId: string) => Promise<void>;
  saveAccounts: (invitationId: string, accounts: Omit<InvitationAccount, "id" | "invitation_id" | "created_at">[]) => Promise<void>;

  // RSVP & 방명록
  loadRsvp: (invitationId: string) => Promise<void>;
  loadGuestbook: (invitationId: string) => Promise<void>;
  loadStats: (invitationId: string) => Promise<void>;

  // 축의금
  loadMoney: (coupleId: string) => Promise<void>;
  addMoney: (data: Omit<CongratulatoryMoney, "id" | "couple_id" | "created_at" | "updated_at">) => Promise<void>;
  updateMoney: (id: string, data: Partial<CongratulatoryMoney>) => Promise<void>;
  deleteMoney: (id: string) => Promise<void>;

  // AI 대본
  loadScripts: (coupleId: string) => Promise<void>;
  generateScript: (params: { coupleId: string; scriptType: string; title: string; context: Record<string, unknown> }) => Promise<void>;
  deleteScript: (id: string) => Promise<void>;
  toggleScriptFavorite: (id: string) => Promise<void>;

  reset: () => void;
}

const DEMO_COUPLE_ID = "demo-couple";

function isAuthFailure(res: Response) {
  return res.status === 401 || res.status === 403;
}

function createLocalMoney(
  data: Omit<CongratulatoryMoney, "id" | "couple_id" | "created_at" | "updated_at">
): CongratulatoryMoney {
  const now = new Date().toISOString();
  return {
    id: `local-money-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    couple_id: DEMO_COUPLE_ID,
    guest_name: data.guest_name,
    amount: data.amount,
    side: data.side,
    relation: data.relation ?? null,
    method: data.method,
    memo: data.memo ?? null,
    received_at: data.received_at,
    created_at: now,
    updated_at: now,
  };
}

export const useInvitationStore = create<InvitationStoreState>((set, get) => ({
  templates: [],
  templatesLoading: false,
  invitations: [],
  invitationsLoading: false,
  current: null,
  currentLoading: false,
  editorStep: "template",
  editorDirty: false,
  photos: [],
  accounts: [],
  rsvpList: [],
  guestbook: [],
  stats: null,
  moneyList: [],
  moneyLoading: false,
  moneyLocalMode: false,
  scripts: [],
  scriptsLoading: false,
  scriptStreaming: false,
  scriptStreamContent: "",
  error: null,

  // ============================================================
  // 템플릿
  // ============================================================
  loadTemplates: async () => {
    if (get().templates.length > 0) return;
    set({ templatesLoading: true });
    try {
      const res = await fetch("/api/invitations/templates");
      if (!res.ok) throw new Error("템플릿 로딩 실패");
      const data = await res.json();
      set({ templates: data.templates });
    } catch (err) {
      console.error("템플릿 로딩 에러:", err);
      set({ error: "템플릿을 불러오지 못했습니다." });
    } finally {
      set({ templatesLoading: false });
    }
  },

  // ============================================================
  // 청첩장 CRUD
  // ============================================================
  loadInvitations: async (coupleId) => {
    set({ invitationsLoading: true });
    try {
      const res = await fetch(`/api/invitations?coupleId=${coupleId}`);
      if (!res.ok) throw new Error("청첩장 로딩 실패");
      const data = await res.json();
      set({ invitations: data.invitations });
    } catch (err) {
      console.error("청첩장 로딩 에러:", err);
      set({ error: "청첩장을 불러오지 못했습니다." });
    } finally {
      set({ invitationsLoading: false });
    }
  },

  loadInvitation: async (id) => {
    set({ currentLoading: true });
    try {
      const res = await fetch(`/api/invitations/${id}`);
      if (!res.ok) throw new Error("청첩장 로딩 실패");
      const data = await res.json();
      set({
        current: data.invitation,
        photos: data.photos ?? [],
        accounts: data.accounts ?? [],
      });
    } catch (err) {
      console.error("청첩장 상세 로딩 에러:", err);
      set({ error: "청첩장을 불러오지 못했습니다." });
    } finally {
      set({ currentLoading: false });
    }
  },

  createInvitation: async (data) => {
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("청첩장 생성 실패");
      const result = await res.json();
      const invitation = result.invitation as Invitation;
      set((s) => ({
        invitations: [...s.invitations, invitation],
        current: invitation,
        editorStep: "info",
        editorDirty: false,
      }));
      return invitation;
    } catch (err) {
      console.error("청첩장 생성 에러:", err);
      set({ error: "청첩장을 만들지 못했습니다." });
      return null;
    }
  },

  updateInvitation: async (id, data) => {
    try {
      const res = await fetch(`/api/invitations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("청첩장 수정 실패");
      const result = await res.json();
      set((s) => ({
        current: result.invitation,
        invitations: s.invitations.map((inv) =>
          inv.id === id ? result.invitation : inv
        ),
        editorDirty: false,
      }));
    } catch (err) {
      console.error("청첩장 수정 에러:", err);
      set({ error: "청첩장을 저장하지 못했습니다." });
    }
  },

  deleteInvitation: async (id) => {
    try {
      const res = await fetch(`/api/invitations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("청첩장 삭제 실패");
      set((s) => ({
        invitations: s.invitations.filter((inv) => inv.id !== id),
        current: s.current?.id === id ? null : s.current,
      }));
    } catch (err) {
      console.error("청첩장 삭제 에러:", err);
      set({ error: "청첩장을 삭제하지 못했습니다." });
    }
  },

  publishInvitation: async (id) => {
    try {
      const res = await fetch(`/api/invitations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_published: true }),
      });
      if (!res.ok) throw new Error("발행 실패");
      const result = await res.json();
      set((s) => ({
        current: result.invitation,
        invitations: s.invitations.map((inv) =>
          inv.id === id ? result.invitation : inv
        ),
      }));
    } catch (err) {
      console.error("발행 에러:", err);
      set({ error: "청첩장을 발행하지 못했습니다." });
    }
  },

  // ============================================================
  // 에디터
  // ============================================================
  setEditorStep: (step) => set({ editorStep: step }),
  setEditorDirty: (dirty) => set({ editorDirty: dirty }),
  updateCurrent: (data) => {
    const { current } = get();
    if (!current) return;
    set({ current: { ...current, ...data }, editorDirty: true });
  },

  // ============================================================
  // 사진
  // ============================================================
  loadPhotos: async (invitationId) => {
    try {
      const res = await fetch(`/api/invitations/${invitationId}/photos`);
      if (!res.ok) throw new Error("사진 로딩 실패");
      const data = await res.json();
      set({ photos: data.photos });
    } catch (err) {
      console.error("사진 로딩 에러:", err);
    }
  },

  addPhoto: async (invitationId, url, caption) => {
    try {
      const res = await fetch(`/api/invitations/${invitationId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, caption }),
      });
      if (!res.ok) throw new Error("사진 추가 실패");
      const data = await res.json();
      set((s) => ({ photos: [...s.photos, data.photo] }));
    } catch (err) {
      console.error("사진 추가 에러:", err);
    }
  },

  removePhoto: async (photoId) => {
    try {
      const res = await fetch(`/api/invitations/photos/${photoId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("사진 삭제 실패");
      set((s) => ({ photos: s.photos.filter((p) => p.id !== photoId) }));
    } catch (err) {
      console.error("사진 삭제 에러:", err);
    }
  },

  reorderPhotos: async (invitationId, photoIds) => {
    try {
      await fetch(`/api/invitations/${invitationId}/photos/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds }),
      });
      set((s) => ({
        photos: photoIds
          .map((id, i) => {
            const photo = s.photos.find((p) => p.id === id);
            return photo ? { ...photo, sort_order: i } : null;
          })
          .filter(Boolean) as InvitationPhoto[],
      }));
    } catch (err) {
      console.error("사진 순서 변경 에러:", err);
    }
  },

  // ============================================================
  // 계좌
  // ============================================================
  loadAccounts: async (invitationId) => {
    try {
      const res = await fetch(`/api/invitations/${invitationId}/accounts`);
      if (!res.ok) throw new Error("계좌 로딩 실패");
      const data = await res.json();
      set({ accounts: data.accounts });
    } catch (err) {
      console.error("계좌 로딩 에러:", err);
    }
  },

  saveAccounts: async (invitationId, accounts) => {
    try {
      const res = await fetch(`/api/invitations/${invitationId}/accounts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts }),
      });
      if (!res.ok) throw new Error("계좌 저장 실패");
      const data = await res.json();
      set({ accounts: data.accounts });
    } catch (err) {
      console.error("계좌 저장 에러:", err);
    }
  },

  // ============================================================
  // RSVP & 방명록 & 통계
  // ============================================================
  loadRsvp: async (invitationId) => {
    try {
      const res = await fetch(`/api/invitations/${invitationId}/rsvp`);
      if (!res.ok) throw new Error("RSVP 로딩 실패");
      const data = await res.json();
      set({ rsvpList: data.rsvpList });
    } catch (err) {
      console.error("RSVP 로딩 에러:", err);
    }
  },

  loadGuestbook: async (invitationId) => {
    try {
      const res = await fetch(`/api/invitations/${invitationId}/guestbook`);
      if (!res.ok) throw new Error("방명록 로딩 실패");
      const data = await res.json();
      set({ guestbook: data.guestbook });
    } catch (err) {
      console.error("방명록 로딩 에러:", err);
    }
  },

  loadStats: async (invitationId) => {
    try {
      const res = await fetch(`/api/invitations/${invitationId}/stats`);
      if (!res.ok) throw new Error("통계 로딩 실패");
      const data = await res.json();
      set({ stats: data.stats });
    } catch (err) {
      console.error("통계 로딩 에러:", err);
    }
  },

  // ============================================================
  // 축의금
  // ============================================================
  loadMoney: async (coupleId) => {
    set({ moneyLoading: true });
    try {
      if (coupleId === DEMO_COUPLE_ID) {
        set({ moneyList: [], moneyLocalMode: true });
        return;
      }

      const res = await fetch(`/api/money?coupleId=${coupleId}`);
      if (isAuthFailure(res)) {
        set({ moneyList: [], moneyLocalMode: true });
        return;
      }
      if (!res.ok) throw new Error("축의금 로딩 실패");
      const data = await res.json();
      set({ moneyList: data.moneyList, moneyLocalMode: false });
    } catch (err) {
      console.error("축의금 로딩 에러:", err);
      set({ error: "축의금을 불러오지 못했습니다." });
    } finally {
      set({ moneyLoading: false });
    }
  },

  addMoney: async (data) => {
    if (get().moneyLocalMode) {
      const localMoney = createLocalMoney(data);
      set((s) => ({ moneyList: [localMoney, ...s.moneyList] }));
      return;
    }

    try {
      const res = await fetch("/api/money", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (isAuthFailure(res)) {
        const localMoney = createLocalMoney(data);
        set((s) => ({ moneyList: [localMoney, ...s.moneyList], moneyLocalMode: true }));
        return;
      }
      if (!res.ok) throw new Error("축의금 추가 실패");
      const result = await res.json();
      set((s) => ({ moneyList: [result.money, ...s.moneyList] }));
    } catch (err) {
      console.error("축의금 추가 에러:", err);
    }
  },

  updateMoney: async (id, data) => {
    if (get().moneyLocalMode) {
      set((s) => ({
        moneyList: s.moneyList.map((m) =>
          m.id === id ? { ...m, ...data, updated_at: new Date().toISOString() } : m
        ),
      }));
      return;
    }

    try {
      const res = await fetch(`/api/money/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (isAuthFailure(res)) {
        set((s) => ({
          moneyList: s.moneyList.map((m) =>
            m.id === id ? { ...m, ...data, updated_at: new Date().toISOString() } : m
          ),
          moneyLocalMode: true,
        }));
        return;
      }
      if (!res.ok) throw new Error("축의금 수정 실패");
      const result = await res.json();
      set((s) => ({
        moneyList: s.moneyList.map((m) => (m.id === id ? result.money : m)),
      }));
    } catch (err) {
      console.error("축의금 수정 에러:", err);
    }
  },

  deleteMoney: async (id) => {
    if (get().moneyLocalMode) {
      set((s) => ({ moneyList: s.moneyList.filter((m) => m.id !== id) }));
      return;
    }

    try {
      const res = await fetch(`/api/money/${id}`, { method: "DELETE" });
      if (isAuthFailure(res)) {
        set((s) => ({ moneyList: s.moneyList.filter((m) => m.id !== id), moneyLocalMode: true }));
        return;
      }
      if (!res.ok) throw new Error("축의금 삭제 실패");
      set((s) => ({ moneyList: s.moneyList.filter((m) => m.id !== id) }));
    } catch (err) {
      console.error("축의금 삭제 에러:", err);
    }
  },

  // ============================================================
  // AI 대본
  // ============================================================
  loadScripts: async (coupleId) => {
    set({ scriptsLoading: true });
    try {
      const res = await fetch(`/api/scripts?coupleId=${coupleId}`);
      if (!res.ok) throw new Error("대본 로딩 실패");
      const data = await res.json();
      set({ scripts: data.scripts });
    } catch (err) {
      console.error("대본 로딩 에러:", err);
      set({ error: "대본을 불러오지 못했습니다." });
    } finally {
      set({ scriptsLoading: false });
    }
  },

  generateScript: async ({ coupleId, scriptType, title, context }) => {
    set({ scriptStreaming: true, scriptStreamContent: "", error: null });
    try {
      const res = await fetch("/api/scripts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coupleId, scriptType, title, context }),
      });
      if (!res.ok) throw new Error("대본 생성 실패");

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "text_delta") {
              fullContent += event.content;
              set({ scriptStreamContent: fullContent });
            } else if (event.type === "done") {
              const newScript = event.script as AiScript;
              set((s) => ({ scripts: [newScript, ...s.scripts] }));
            } else if (event.type === "error") {
              set({ error: event.message });
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err) {
      console.error("대본 생성 에러:", err);
      set({ error: "대본을 생성하지 못했습니다." });
    } finally {
      set({ scriptStreaming: false, scriptStreamContent: "" });
    }
  },

  deleteScript: async (id) => {
    try {
      const res = await fetch(`/api/scripts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("대본 삭제 실패");
      set((s) => ({ scripts: s.scripts.filter((sc) => sc.id !== id) }));
    } catch (err) {
      console.error("대본 삭제 에러:", err);
    }
  },

  toggleScriptFavorite: async (id) => {
    const script = get().scripts.find((s) => s.id === id);
    if (!script) return;
    try {
      const res = await fetch(`/api/scripts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_favorite: !script.is_favorite }),
      });
      if (!res.ok) throw new Error("즐겨찾기 실패");
      set((s) => ({
        scripts: s.scripts.map((sc) =>
          sc.id === id ? { ...sc, is_favorite: !sc.is_favorite } : sc
        ),
      }));
    } catch (err) {
      console.error("즐겨찾기 에러:", err);
    }
  },

  reset: () => {
    set({
      templates: [],
      templatesLoading: false,
      invitations: [],
      invitationsLoading: false,
      current: null,
      currentLoading: false,
      editorStep: "template",
      editorDirty: false,
      photos: [],
      accounts: [],
      rsvpList: [],
      guestbook: [],
      stats: null,
      moneyList: [],
      moneyLoading: false,
      moneyLocalMode: false,
      scripts: [],
      scriptsLoading: false,
      scriptStreaming: false,
      scriptStreamContent: "",
      error: null,
    });
  },
}));
