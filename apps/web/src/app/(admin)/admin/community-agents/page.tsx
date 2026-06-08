"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  ThumbsUp,
} from "lucide-react";

type AgentStatus = "draft" | "active" | "paused" | "retired";
type TargetType = "post" | "comment" | "reaction" | "cohort_message";
type ContentOrigin = "question" | "comment" | "summary" | "news" | "checklist" | "reaction";
type DraftTypeFilter = "all" | TargetType;
type DraftStatusFilter = "all" | AgentDraft["status"];

interface AdminAgent {
  id: string;
  slug: string;
  public_nickname: string;
  internal_label: string;
  role: string;
  public_mode: "persona" | "official";
  status: AgentStatus;
  backing_user_id: string | null;
  profile: {
    weddingStage?: string;
    tone?: string;
    voiceRules?: string[];
    avoids?: string[];
  };
  behavior: {
    activityLevel?: string;
    silenceWeight?: number;
    preferredWindows?: string[];
    topics?: string[];
    commentStyle?: string;
  };
  safety: {
    sourcePolicy?: string;
    blockedClaims?: string[];
  };
  sample_lines: string[];
  isDefaultPreview?: boolean;
}

interface AgentDraft {
  id: string;
  agent_id: string;
  target_type: TargetType;
  content_origin: ContentOrigin;
  status: "draft" | "needs_review" | "approved" | "posted" | "rejected" | "archived";
  category: string | null;
  title: string | null;
  content: string;
  source_urls: string[];
  safety_flags: string[];
  verification_status: string;
  target_post_id: string | null;
  target_comment_id: string | null;
  target_cohort_room_id: string | null;
  posted_post_id: string | null;
  posted_comment_id: string | null;
  posted_cohort_message_id: string | null;
  created_at: string;
  target_post: DraftTargetPost | null;
  target_comment: DraftTargetComment | null;
  target_cohort_room: DraftTargetCohortRoom | null;
}

interface DraftTargetPost {
  id: string;
  title: string;
  content: string;
  category: string;
  author_nickname: string | null;
  comment_count: number;
  upvote_count: number;
  created_at: string;
}

interface DraftTargetComment {
  id: string;
  post_id: string;
  parent_id: string | null;
  content: string;
  author_nickname: string | null;
  upvote_count: number;
  created_at: string;
}

interface DraftTargetCohortRoom {
  id: string;
  name: string;
  year: number;
  month: number;
  room_number: number;
  message_count: number;
}

interface AutomationRunItem {
  agentSlug: string;
  action: TargetType;
  status: "posted" | "drafted" | "skipped" | "failed";
  draftId?: string;
  reason?: string;
  flags?: string[];
}

interface AutomationRunState {
  runId: string | null;
  dryRun: boolean;
  planned: number;
  posted: number;
  drafted: number;
  skipped: number;
  failed: number;
  items: AutomationRunItem[];
  completedAt: string;
}

interface AgentMetrics {
  periodDays: number;
  agent: { posts: number; comments: number; reactions: number };
  human: { posts: number; comments: number };
  draftsByStatus: Record<string, number>;
}

interface AgentsResponse {
  setupRequired: boolean;
  agents: AdminAgent[];
  drafts: AgentDraft[];
  draftTotal?: number;
  draftLimit?: number;
  metrics: AgentMetrics | null;
  message?: string;
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  draft: "초안",
  active: "활성",
  paused: "일시정지",
  retired: "종료",
};

const STATUS_CLASS: Record<AgentStatus, string> = {
  draft: "bg-[#f6efe5] text-[#635b51]",
  active: "bg-[#e8f3ee] text-[#2f5f51]",
  paused: "bg-[#fff3d9] text-[#8a641a]",
  retired: "bg-[#eee] text-[#777]",
};

const ORIGIN_LABEL: Record<ContentOrigin, string> = {
  question: "질문형",
  comment: "댓글형",
  summary: "정리형",
  news: "뉴스형",
  checklist: "체크리스트",
  reaction: "반응형",
};

const TARGET_LABEL: Record<TargetType, string> = {
  post: "게시글",
  comment: "댓글",
  reaction: "좋아요",
  cohort_message: "동기방 메시지",
};

const DRAFT_TYPE_FILTER_LABEL: Record<DraftTypeFilter, string> = {
  all: "전체",
  ...TARGET_LABEL,
};

const DRAFT_STATUS_LABEL: Record<AgentDraft["status"], string> = {
  draft: "초안",
  needs_review: "검토 필요",
  approved: "승인됨",
  posted: "게시됨",
  rejected: "반려",
  archived: "보관",
};

const DRAFT_STATUS_FILTER_LABEL: Record<DraftStatusFilter, string> = {
  all: "전체 상태",
  ...DRAFT_STATUS_LABEL,
};

function formatDate(value: string): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function plainText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function hasDraftBody(draft: AgentDraft): boolean {
  return draft.target_type === "reaction" || plainText(draft.content).length >= 2;
}

function isDraftPublishBlocked(draft: AgentDraft): boolean {
  return (
    draft.verification_status === "blocked" ||
    draft.verification_status === "source_required" ||
    draft.safety_flags.includes("empty_content") ||
    !hasDraftBody(draft)
  );
}

export default function CommunityAgentsAdminPage() {
  const [authState, setAuthState] = useState<"loading" | "admin" | "denied">("loading");
  const [data, setData] = useState<AgentsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [lastAutomation, setLastAutomation] = useState<AutomationRunState | null>(null);
  const [expandedDraftIds, setExpandedDraftIds] = useState<Set<string>>(() => new Set());
  const [draftTypeFilter, setDraftTypeFilter] = useState<DraftTypeFilter>("all");
  const [draftStatusFilter, setDraftStatusFilter] = useState<DraftStatusFilter>("all");
  const [showFullDraftBodies, setShowFullDraftBodies] = useState(false);

  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [targetType, setTargetType] = useState<TargetType>("post");
  const [contentOrigin, setContentOrigin] = useState<ContentOrigin>("question");
  const [category, setCategory] = useState("free");
  const [targetPostId, setTargetPostId] = useState("");
  const [targetCohortRoomId, setTargetCohortRoomId] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceUrlsText, setSourceUrlsText] = useState("");

  const agents = useMemo(() => data?.agents ?? [], [data?.agents]);
  const persistedAgents = useMemo(() => agents.filter((agent) => !agent.isDefaultPreview), [agents]);
  const activeCount = agents.filter((agent) => agent.status === "active").length;
  const draftById = useMemo(() => new Map((data?.drafts ?? []).map((draft) => [draft.id, draft])), [data?.drafts]);
  const drafts = useMemo(() => data?.drafts ?? [], [data?.drafts]);
  const filteredDrafts = useMemo(
    () =>
      drafts.filter((draft) => {
        const typeMatches = draftTypeFilter === "all" || draft.target_type === draftTypeFilter;
        const statusMatches = draftStatusFilter === "all" || draft.status === draftStatusFilter;
        return typeMatches && statusMatches;
      }),
    [draftStatusFilter, draftTypeFilter, drafts]
  );
  const draftTypeCounts = useMemo(() => {
    const counts: Record<DraftTypeFilter, number> = {
      all: drafts.length,
      post: 0,
      comment: 0,
      reaction: 0,
      cohort_message: 0,
    };
    for (const draft of drafts) counts[draft.target_type] += 1;
    return counts;
  }, [drafts]);
  const loadedDraftCount = drafts.length;
  const totalDraftCount = data?.draftTotal ?? loadedDraftCount;

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId]
  );

  const loadAgents = useCallback(async (): Promise<AgentsResponse | null> => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/community-agents?draftLimit=240");
      if (!res.ok) throw new Error("load_failed");
      const next = (await res.json()) as AgentsResponse;
      setData(next);
      setSelectedAgentId((current) => current || next.agents[0]?.id || "");
      return next;
    } catch {
      setMessage("에이전트 정보를 불러오지 못했습니다.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/auth");
        const auth = (await res.json().catch(() => null)) as { isAdmin?: boolean } | null;
        if (res.ok && auth?.isAdmin) {
          setAuthState("admin");
          await loadAgents();
        } else {
          setAuthState("denied");
        }
      } catch {
        setAuthState("denied");
      }
    })();
  }, [loadAgents]);

  async function runAction(action: string, payload: Record<string, unknown> = {}) {
    setActionLoading(action);
    setMessage("");
    try {
      const res = await fetch("/api/admin/community-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const result = (await res.json().catch(() => ({}))) as { error?: string; safety?: { flags?: string[] } };
      if (!res.ok) {
        const flags = result.safety?.flags?.length ? ` (${result.safety.flags.join(", ")})` : "";
        throw new Error(`${result.error ?? "처리에 실패했습니다."}${flags}`);
      }
      await loadAgents();
      setMessage("완료됐습니다.");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "처리에 실패했습니다.");
      return false;
    } finally {
      setActionLoading(null);
    }
  }

  async function runAutomationNow(dryRun: boolean) {
    const actionKey = dryRun ? "automationDryRun" : "automationRun";
    setActionLoading(actionKey);
    setMessage("");
    try {
      const res = await fetch("/api/cron/community-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dryRun,
          autoPublish: !dryRun,
          maxActions: dryRun ? 4 : 6,
          seedIfEmpty: true,
        }),
      });
      const result = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        runId?: string | null;
        dryRun?: boolean;
        planned?: number;
        posted?: number;
        drafted?: number;
        skipped?: number;
        failed?: number;
        items?: AutomationRunItem[];
      };
      if (!res.ok) {
        throw new Error(result.message ?? result.error ?? "Automation failed.");
      }
      await loadAgents();
      setLastAutomation({
        runId: result.runId ?? null,
        dryRun,
        planned: result.planned ?? 0,
        posted: result.posted ?? 0,
        drafted: result.drafted ?? 0,
        skipped: result.skipped ?? 0,
        failed: result.failed ?? 0,
        items: result.items ?? [],
        completedAt: new Date().toISOString(),
      });
      setExpandedDraftIds(new Set());
      setMessage(
        dryRun
          ? `dry-run 완료: 초안 ${result.drafted ?? 0}개 생성, 건너뜀 ${result.skipped ?? 0}개, 실패 ${result.failed ?? 0}개`
          : `자동 실행 완료: 게시 ${result.posted ?? 0}개, 초안 ${result.drafted ?? 0}개, 건너뜀 ${result.skipped ?? 0}개`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Automation failed.");
    } finally {
      setActionLoading(null);
    }
  }

  async function createDraft() {
    const sourceUrls = sourceUrlsText
      .split(/\n|,/)
      .map((url) => url.trim())
      .filter(Boolean);

    const ok = await runAction("createDraft", {
      agentId: selectedAgentId,
      targetType,
      contentOrigin,
      category: targetType === "post" ? category : undefined,
      title: targetType === "post" ? title : undefined,
      content,
      sourceUrls,
      targetPostId: targetType === "comment" || targetType === "reaction" ? targetPostId : undefined,
      targetCohortRoomId: targetType === "cohort_message" ? targetCohortRoomId : undefined,
    });

    if (ok) {
      setTitle("");
      setContent("");
      setSourceUrlsText("");
      setTargetPostId("");
      setTargetCohortRoomId("");
    }
  }

  if (authState === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbf8f2] text-[#635b51]">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        관리자 권한을 확인하고 있어요.
      </div>
    );
  }

  if (authState === "denied") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbf8f2] px-4">
        <div className="max-w-md rounded-2xl border border-[#e5d8ca] bg-white p-8 text-center shadow-[0_18px_48px_rgba(50,36,17,0.08)]">
          <ShieldCheck className="mx-auto mb-4 h-8 w-8 text-[#36534E]" />
          <h1 className="font-serif-kr text-2xl text-[#263832]">관리자 로그인이 필요해요</h1>
          <p className="mt-2 text-sm leading-6 text-[#635b51]">커뮤니티 에이전트 관리는 관리자만 접근할 수 있습니다.</p>
          <Link href="/admin/login" className="mt-6 inline-flex h-11 items-center rounded-full bg-[#36534E] px-5 text-sm font-semibold text-white">
            로그인으로 이동
          </Link>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fffdf8_0%,#fbf8f2_46%,#f6efe5_100%)] px-4 py-6 text-[#263832] sm:px-6">
      <div className="mx-auto max-w-[1320px]">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-[0.22em] text-[#36534E]">Community Agents</p>
            <h1 className="font-serif-kr text-[30px] font-medium leading-tight sm:text-[38px]">
              커뮤니티 에이전트 운영실
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-[#635b51]">
              20개 페르소나가 질문, 정리, 댓글, 뉴스 큐레이션을 돕되 관리자 데이터에서는 사람 활동과 분리됩니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin" className="inline-flex h-11 items-center rounded-full border border-[#e5d8ca] bg-white px-4 text-sm font-semibold text-[#36534E]">
              관리자 홈
            </Link>
            <button
              onClick={loadAgents}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-[#e5d8ca] bg-white px-4 text-sm font-semibold text-[#36534E]"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              새로고침
            </button>
            <button
              onClick={() => runAction("seed")}
              disabled={!!actionLoading}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[#36534E] px-5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(54,83,78,0.18)] disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4" />
              20개 기본 agent 심기
            </button>
            <button
              onClick={() => runAutomationNow(true)}
              disabled={!!actionLoading}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-[#e5d8ca] bg-white px-4 text-sm font-semibold text-[#36534E] disabled:opacity-60"
            >
              {actionLoading === "automationDryRun" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              자동 dry-run
            </button>
            <button
              onClick={() => runAutomationNow(false)}
              disabled={!!actionLoading}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[#263832] px-5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(38,56,50,0.18)] disabled:opacity-60"
            >
              {actionLoading === "automationRun" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
              자동 활동 실행
            </button>
          </div>
        </header>

        {message && (
          <div className="mb-5 rounded-2xl border border-[#e5d8ca] bg-white px-4 py-3 text-sm font-semibold text-[#36534E]">
            {message}
          </div>
        )}

        {lastAutomation && (
          <section className="mb-5 rounded-2xl border border-[#e5d8ca] bg-white/95 p-4 shadow-[0_12px_32px_rgba(50,36,17,0.05)]">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#36534E]">
                  {lastAutomation.dryRun ? "Dry-run Preview" : "Automation Result"}
                </p>
                <h2 className="mt-1 font-serif-kr text-2xl font-medium text-[#263832]">
                  {lastAutomation.dryRun ? "방금 생성된 dry-run 초안" : "방금 실행된 자동 활동"}
                </h2>
                <p className="mt-1 text-sm font-medium leading-6 text-[#635b51]">
                  {formatDate(lastAutomation.completedAt)} · 계획 {lastAutomation.planned}개 · 초안 {lastAutomation.drafted}개 · 게시 {lastAutomation.posted}개 · 건너뜀 {lastAutomation.skipped}개 · 실패 {lastAutomation.failed}개
                </p>
              </div>
              <button
                onClick={() => setLastAutomation(null)}
                className="h-9 rounded-full border border-[#e5d8ca] bg-white px-3 text-xs font-bold text-[#36534E]"
              >
                닫기
              </button>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {lastAutomation.items.length === 0 && (
                <p className="rounded-xl bg-[#fbf8f2] p-4 text-sm font-medium text-[#928980]">
                  이번 실행에서 생성되거나 처리된 항목이 없습니다.
                </p>
              )}
              {lastAutomation.items.map((item, index) => {
                const draft = item.draftId ? draftById.get(item.draftId) : null;
                const agent = draft
                  ? agents.find((agentItem) => agentItem.id === draft.agent_id)
                  : agents.find((agentItem) => agentItem.slug === item.agentSlug);
                const expanded = draft ? expandedDraftIds.has(draft.id) : false;
                const blocked = draft ? isDraftPublishBlocked(draft) : false;
                const missingBody = draft ? !hasDraftBody(draft) : false;

                return (
                  <article key={item.draftId ?? `${item.agentSlug}-${index}`} className="rounded-xl border border-[#e5d8ca] bg-[#fffdf8] p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#928980]">
                          {agent?.public_nickname ?? item.agentSlug} · {TARGET_LABEL[item.action]}
                        </p>
                        <h3 className="mt-1 text-base font-bold leading-6 text-[#263832]">
                          {draft?.title || TARGET_LABEL[item.action]}
                        </h3>
                      </div>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#36534E]">
                        {draft ? DRAFT_STATUS_LABEL[draft.status] : item.status}
                      </span>
                    </div>

                    {draft ? (
                      <>
                        <DraftTargetContext draft={draft} />
                        {hasDraftBody(draft) && (
                          <p className={`${expanded ? "" : "line-clamp-5"} whitespace-pre-line text-sm leading-6 text-[#635b51]`}>
                            {plainText(draft.content)}
                          </p>
                        )}
                        {missingBody && (
                          <p className="rounded-xl bg-white px-3 py-2 text-sm font-semibold leading-6 text-[#8a641a]">
                            본문이 비어 있어 게시할 수 없습니다.
                          </p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-[#928980]">
                          <span>{ORIGIN_LABEL[draft.content_origin]}</span>
                          <span>·</span>
                          <span>{formatDate(draft.created_at)}</span>
                          {draft.source_urls.length > 0 && (
                            <>
                              <span>·</span>
                              <span>출처 {draft.source_urls.length}개</span>
                            </>
                          )}
                        </div>
                        {(draft.safety_flags.length > 0 || item.flags?.length) && (
                          <div className="mt-3 rounded-lg bg-[#fff3d9] px-3 py-2 text-xs font-semibold leading-5 text-[#8a641a]">
                            {[...new Set([...(draft.safety_flags ?? []), ...(item.flags ?? [])])].join(", ")}
                          </div>
                        )}
                        <div className="mt-4 flex flex-wrap gap-2">
                          {hasDraftBody(draft) && (
                            <button
                              onClick={() =>
                                setExpandedDraftIds((current) => {
                                  const next = new Set(current);
                                  if (next.has(draft.id)) next.delete(draft.id);
                                  else next.add(draft.id);
                                  return next;
                                })
                              }
                              className="inline-flex h-8 items-center rounded-full border border-[#e5d8ca] bg-white px-3 text-xs font-bold text-[#36534E]"
                            >
                              {expanded ? "접기" : "전체 보기"}
                            </button>
                          )}
                          {draft.status !== "posted" && (
                            <>
                              <button
                                onClick={() => runAction("approveDraft", { draftId: draft.id })}
                                disabled={blocked || missingBody || !!actionLoading}
                                className="inline-flex h-8 items-center gap-1 rounded-full border border-[#e5d8ca] bg-white px-3 text-xs font-bold text-[#36534E] disabled:opacity-50"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                승인
                              </button>
                              <button
                                onClick={() => runAction("publishDraft", { draftId: draft.id })}
                                disabled={blocked || !!actionLoading}
                                className="inline-flex h-8 items-center gap-1 rounded-full bg-[#36534E] px-3 text-xs font-bold text-white disabled:opacity-45"
                              >
                                <Send className="h-3.5 w-3.5" />
                                게시
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="rounded-xl bg-white px-3 py-2 text-sm font-medium leading-6 text-[#928980]">
                        {item.reason ? `처리 결과: ${item.reason}` : "초안 없이 처리된 항목입니다."}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {data?.setupRequired && (
          <div className="mb-5 flex gap-3 rounded-2xl border border-[#e9c99d] bg-[#fff8e8] p-4 text-sm leading-6 text-[#6b5224]">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              아직 Supabase에 agent 테이블 또는 기본 agent가 없습니다. 마이그레이션 적용 후 `20개 기본 agent 심기`를 눌러 시작하세요.
            </div>
          </div>
        )}

        <section className="mb-5 grid gap-3 md:grid-cols-4">
          <MetricCard label="Agent" value={`${agents.length}명`} helper={`활성 ${activeCount}명`} />
          <MetricCard label="Agent 활동" value={`${data?.metrics?.agent.posts ?? 0}글`} helper={`${data?.metrics?.agent.comments ?? 0}댓글 · ${data?.metrics?.agent.reactions ?? 0}좋아요`} />
          <MetricCard label="사람 활동" value={`${data?.metrics?.human.posts ?? 0}글`} helper={`${data?.metrics?.human.comments ?? 0}댓글 · 최근 ${data?.metrics?.periodDays ?? 30}일`} />
          <MetricCard label="초안" value={`${totalDraftCount}개`} helper={`표시 ${loadedDraftCount}개 · 검토중 ${data?.metrics?.draftsByStatus?.needs_review ?? 0}개`} />
        </section>

        <section className="mb-5 rounded-2xl border border-[#e5d8ca] bg-white/95 p-5 shadow-[0_12px_32px_rgba(50,36,17,0.05)]">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#36534E]">Draft Review</p>
              <h2 className="mt-1 font-serif-kr text-2xl font-medium text-[#263832]">초안 검토함</h2>
              <p className="mt-1 text-sm font-medium leading-6 text-[#635b51]">
                전체 {totalDraftCount}개 중 {loadedDraftCount}개를 불러왔고, 현재 필터에 {filteredDrafts.length}개가 보입니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex h-10 items-center gap-2 rounded-full border border-[#e5d8ca] bg-[#fffdf8] px-3 text-xs font-bold text-[#36534E]">
                <input
                  type="checkbox"
                  checked={showFullDraftBodies}
                  onChange={(event) => setShowFullDraftBodies(event.target.checked)}
                  className="h-4 w-4 accent-[#36534E]"
                />
                본문 전체
              </label>
              <select
                value={draftStatusFilter}
                onChange={(event) => setDraftStatusFilter(event.target.value as DraftStatusFilter)}
                className="h-10 rounded-full border border-[#e5d8ca] bg-[#fffdf8] px-3 text-xs font-bold text-[#36534E] outline-none"
              >
                {Object.entries(DRAFT_STATUS_FILTER_LABEL).map(([key, text]) => (
                  <option key={key} value={key}>{text}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {Object.entries(DRAFT_TYPE_FILTER_LABEL).map(([key, text]) => (
              <button
                key={key}
                onClick={() => setDraftTypeFilter(key as DraftTypeFilter)}
                className={`inline-flex h-9 items-center rounded-full px-3 text-xs font-bold transition-colors ${
                  draftTypeFilter === key
                    ? "bg-[#36534E] text-white"
                    : "border border-[#e5d8ca] bg-white text-[#36534E]"
                }`}
              >
                {text} {draftTypeCounts[key as DraftTypeFilter] ?? 0}
              </button>
            ))}
          </div>

          {filteredDrafts.length === 0 ? (
            <p className="rounded-xl bg-[#fbf8f2] p-4 text-sm text-[#928980]">조건에 맞는 초안이 없습니다.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {filteredDrafts.map((draft) => {
                const agent = agents.find((item) => item.id === draft.agent_id);
                const blocked = isDraftPublishBlocked(draft);
                const missingBody = !hasDraftBody(draft);
                const expanded = showFullDraftBodies || expandedDraftIds.has(draft.id);

                return (
                  <article key={draft.id} className="rounded-xl border border-[#e5d8ca] bg-[#fffdf8] p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#928980]">
                          {agent?.public_nickname ?? "agent"} · {TARGET_LABEL[draft.target_type]} · {ORIGIN_LABEL[draft.content_origin]}
                        </p>
                        <h3 className="mt-1 text-base font-bold leading-6 text-[#263832]">
                          {draft.title || TARGET_LABEL[draft.target_type]}
                        </h3>
                      </div>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#36534E]">
                        {DRAFT_STATUS_LABEL[draft.status]}
                      </span>
                    </div>

                    <DraftTargetContext draft={draft} />

                    {hasDraftBody(draft) ? (
                      <p className={`${expanded ? "" : "line-clamp-5"} whitespace-pre-line text-sm leading-6 text-[#635b51]`}>
                        {plainText(draft.content)}
                      </p>
                    ) : (
                      <p className="rounded-xl bg-white px-3 py-2 text-sm font-semibold leading-6 text-[#8a641a]">
                        본문이 비어 있어 게시할 수 없습니다.
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-[#928980]">
                      <span>{formatDate(draft.created_at)}</span>
                      {draft.source_urls.length > 0 && <span>출처 {draft.source_urls.length}개</span>}
                      <span title={draft.id}>draft {shortId(draft.id)}</span>
                    </div>

                    {draft.safety_flags.length > 0 && (
                      <div className="mt-3 rounded-lg bg-[#fff3d9] px-3 py-2 text-xs font-semibold leading-5 text-[#8a641a]">
                        {draft.safety_flags.join(", ")}
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {hasDraftBody(draft) && !showFullDraftBodies && (
                        <button
                          onClick={() =>
                            setExpandedDraftIds((current) => {
                              const next = new Set(current);
                              if (next.has(draft.id)) next.delete(draft.id);
                              else next.add(draft.id);
                              return next;
                            })
                          }
                          className="inline-flex h-8 items-center rounded-full border border-[#e5d8ca] bg-white px-3 text-xs font-bold text-[#36534E]"
                        >
                          {expanded ? "접기" : "전체 보기"}
                        </button>
                      )}
                      {draft.status !== "posted" && (
                        <>
                          <button
                            onClick={() => runAction("approveDraft", { draftId: draft.id })}
                            disabled={blocked || missingBody || !!actionLoading}
                            className="inline-flex h-8 items-center gap-1 rounded-full border border-[#e5d8ca] bg-white px-3 text-xs font-bold text-[#36534E] disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            승인
                          </button>
                          <button
                            onClick={() => runAction("publishDraft", { draftId: draft.id })}
                            disabled={blocked || !!actionLoading}
                            className="inline-flex h-8 items-center gap-1 rounded-full bg-[#36534E] px-3 text-xs font-bold text-white disabled:opacity-45"
                          >
                            <Send className="h-3.5 w-3.5" />
                            게시
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="grid gap-3 md:grid-cols-2">
            {agents.map((agent) => (
              <article key={agent.id} className="rounded-2xl border border-[#e5d8ca] bg-white/92 p-5 shadow-[0_12px_32px_rgba(50,36,17,0.045)]">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-bold text-[#263832]">{agent.public_nickname}</h2>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_CLASS[agent.status]}`}>
                        {STATUS_LABEL[agent.status]}
                      </span>
                      {agent.public_mode === "official" && (
                        <span className="rounded-full bg-[#EEF4F1] px-2.5 py-1 text-[11px] font-bold text-[#36534E]">운영형</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-[#928980]">{agent.internal_label}</p>
                  </div>
                  <Bot className="h-5 w-5 shrink-0 text-[#36534E]" />
                </div>

                <div className="space-y-3 text-sm leading-6 text-[#635b51]">
                  <p><span className="font-bold text-[#36534E]">상황</span> {agent.profile.weddingStage ?? "-"}</p>
                  <p><span className="font-bold text-[#36534E]">말투</span> {agent.profile.tone ?? "-"}</p>
                  <p><span className="font-bold text-[#36534E]">활동</span> 침묵 확률 {Math.round((agent.behavior.silenceWeight ?? 0) * 100)}% · {agent.behavior.preferredWindows?.join(", ")}</p>
                  <p><span className="font-bold text-[#36534E]">주제</span> {agent.behavior.topics?.slice(0, 5).join(" · ")}</p>
                  <p><span className="font-bold text-[#36534E]">금지</span> {agent.safety.blockedClaims?.slice(0, 3).join(" · ")}</p>
                </div>

                <div className="mt-4 rounded-xl bg-[#fbf8f2] p-3 text-sm leading-6 text-[#263832]">
                  {agent.sample_lines?.[0] ?? "샘플 문장이 없습니다."}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => runAction("setStatus", { agentId: agent.id, status: agent.status === "active" ? "paused" : "active" })}
                    disabled={agent.isDefaultPreview || !!actionLoading}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#e5d8ca] bg-white px-3 text-xs font-bold text-[#36534E] disabled:opacity-50"
                  >
                    {agent.status === "active" ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                    {agent.status === "active" ? "일시정지" : "활성화"}
                  </button>
                  <button
                    onClick={() => setSelectedAgentId(agent.id)}
                    disabled={agent.isDefaultPreview}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#36534E] px-3 text-xs font-bold text-white disabled:opacity-50"
                  >
                    <FileText className="h-4 w-4" />
                    초안 작성
                  </button>
                </div>
              </article>
            ))}
          </section>

          <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
            <section className="rounded-2xl border border-[#e5d8ca] bg-white/95 p-5 shadow-[0_12px_32px_rgba(50,36,17,0.05)]">
              <div className="mb-4 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[#36534E]" />
                <h2 className="font-serif-kr text-2xl font-medium">초안 만들기</h2>
              </div>
              <div className="space-y-3">
                <label className="block text-xs font-bold text-[#928980]">Agent</label>
                <select
                  value={selectedAgentId}
                  onChange={(event) => setSelectedAgentId(event.target.value)}
                  className="h-11 w-full rounded-xl border border-[#e5d8ca] bg-[#fffdf8] px-3 text-sm font-semibold outline-none"
                >
                  {persistedAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.public_nickname} · {agent.internal_label}</option>
                  ))}
                </select>

                {selectedAgent && (
                  <div className="rounded-xl bg-[#fbf8f2] p-3 text-xs leading-5 text-[#635b51]">
                    {selectedAgent.profile.voiceRules?.slice(0, 2).join(" · ")}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <SelectBox label="대상" value={targetType} onChange={(value) => setTargetType(value as TargetType)} options={TARGET_LABEL} />
                  <SelectBox label="유형" value={contentOrigin} onChange={(value) => setContentOrigin(value as ContentOrigin)} options={ORIGIN_LABEL} />
                </div>

                {targetType === "post" && (
                  <>
                    <label className="block text-xs font-bold text-[#928980]">카테고리</label>
                    <select
                      value={category}
                      onChange={(event) => setCategory(event.target.value)}
                      className="h-11 w-full rounded-xl border border-[#e5d8ca] bg-[#fffdf8] px-3 text-sm font-semibold outline-none"
                    >
                      <option value="free">자유</option>
                      <option value="tips_v2">꿀팁</option>
                      <option value="tour_review">후기</option>
                      <option value="is_normal">정상인가요?</option>
                      <option value="ama">선배 Q&A</option>
                    </select>
                    <Input label="제목" value={title} onChange={setTitle} placeholder="사람이 쓸 법한 자연스러운 제목" />
                  </>
                )}

                {(targetType === "comment" || targetType === "reaction") && (
                  <Input label="대상 게시글 ID" value={targetPostId} onChange={setTargetPostId} placeholder="post uuid" />
                )}

                {targetType === "cohort_message" && (
                  <Input label="동기방 ID" value={targetCohortRoomId} onChange={setTargetCohortRoomId} placeholder="room uuid" />
                )}

                {targetType !== "reaction" && (
                  <>
                    <label className="block text-xs font-bold text-[#928980]">내용</label>
                    <textarea
                      value={content}
                      onChange={(event) => setContent(event.target.value)}
                      rows={7}
                      placeholder="거짓 경험담 없이 질문, 정리, 체크포인트 중심으로 작성"
                      className="w-full rounded-xl border border-[#e5d8ca] bg-[#fffdf8] px-3 py-3 text-sm leading-6 outline-none"
                    />
                  </>
                )}

                <label className="block text-xs font-bold text-[#928980]">출처 URL</label>
                <textarea
                  value={sourceUrlsText}
                  onChange={(event) => setSourceUrlsText(event.target.value)}
                  rows={3}
                  placeholder="뉴스/통계/가격 주장에는 https 출처 필수"
                  className="w-full rounded-xl border border-[#e5d8ca] bg-[#fffdf8] px-3 py-3 text-sm leading-6 outline-none"
                />

                <button
                  onClick={createDraft}
                  disabled={!selectedAgentId || !!actionLoading}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#36534E] text-sm font-bold text-white disabled:opacity-50"
                >
                  {actionLoading === "createDraft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  안전검사 후 초안 생성
                </button>
              </div>
            </section>

          </aside>
        </div>
      </div>
    </main>
  );
}

function DraftTargetContext({ draft }: { draft: AgentDraft }) {
  if (draft.target_type === "comment" || draft.target_type === "reaction") {
    const post = draft.target_post;
    const label = draft.target_type === "comment" ? "댓글 대상 글" : "좋아요 대상 글";
    const Icon = draft.target_type === "comment" ? MessageSquare : ThumbsUp;

    return (
      <div className="mb-3 rounded-xl border border-[#eadfce] bg-white px-3 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-xs font-bold text-[#36534E]">
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span>{label}</span>
          </div>
          {post ? (
            <Link
              href={`/wedding/community/post/${post.id}`}
              target="_blank"
              className="inline-flex h-7 items-center gap-1 rounded-full border border-[#e5d8ca] px-2.5 text-[11px] font-bold text-[#36534E]"
            >
              <ExternalLink className="h-3 w-3" />
              원글 열기
            </Link>
          ) : null}
        </div>

        {post ? (
          <div className="space-y-2">
            <div>
              <p className="line-clamp-2 text-sm font-bold leading-5 text-[#263832]">{post.title}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#635b51]">{plainText(post.content)}</p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold text-[#928980]">
              <span>{post.category}</span>
              {post.author_nickname ? <span>· {post.author_nickname}</span> : null}
              <span>· 댓글 {post.comment_count}</span>
              <span>· 좋아요 {post.upvote_count}</span>
              <span>· {formatDate(post.created_at)}</span>
              <span title={post.id}>· post {shortId(post.id)}</span>
            </div>
          </div>
        ) : (
          <div className="rounded-lg bg-[#fff3d9] px-3 py-2 text-xs font-semibold leading-5 text-[#8a641a]">
            대상 글 정보를 불러오지 못했습니다.
            {draft.target_post_id ? <span title={draft.target_post_id}> post {shortId(draft.target_post_id)}</span> : " target_post_id가 없습니다."}
          </div>
        )}

        {draft.target_comment ? (
          <div className="mt-2 rounded-lg bg-[#fbf8f2] px-3 py-2">
            <p className="mb-1 text-[11px] font-bold text-[#928980]">답글 대상 댓글</p>
            <p className="line-clamp-2 text-xs leading-5 text-[#635b51]">{plainText(draft.target_comment.content)}</p>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-semibold text-[#928980]">
              {draft.target_comment.author_nickname ? <span>{draft.target_comment.author_nickname}</span> : null}
              <span>좋아요 {draft.target_comment.upvote_count}</span>
              <span>{formatDate(draft.target_comment.created_at)}</span>
              <span title={draft.target_comment.id}>comment {shortId(draft.target_comment.id)}</span>
            </div>
          </div>
        ) : draft.target_comment_id ? (
          <div className="mt-2 rounded-lg bg-[#fff3d9] px-3 py-2 text-xs font-semibold text-[#8a641a]">
            답글 대상 댓글을 불러오지 못했습니다. <span title={draft.target_comment_id}>comment {shortId(draft.target_comment_id)}</span>
          </div>
        ) : null}
      </div>
    );
  }

  if (draft.target_type === "cohort_message") {
    const room = draft.target_cohort_room;

    return (
      <div className="mb-3 rounded-xl border border-[#eadfce] bg-white px-3 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-xs font-bold text-[#36534E]">
            <MessageSquare className="h-3.5 w-3.5 shrink-0" />
            <span>동기방 대상</span>
          </div>
          {room ? (
            <Link
              href={`/wedding/community/cohort/${room.id}`}
              target="_blank"
              className="inline-flex h-7 items-center gap-1 rounded-full border border-[#e5d8ca] px-2.5 text-[11px] font-bold text-[#36534E]"
            >
              <ExternalLink className="h-3 w-3" />
              방 열기
            </Link>
          ) : null}
        </div>

        {room ? (
          <>
            <p className="text-sm font-bold leading-5 text-[#263832]">{room.name}</p>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-semibold text-[#928980]">
              <span>{room.year}년 {room.month}월</span>
              <span>· {room.room_number}방</span>
              <span>· 메시지 {room.message_count}</span>
              <span title={room.id}>· room {shortId(room.id)}</span>
            </div>
          </>
        ) : (
          <div className="rounded-lg bg-[#fff3d9] px-3 py-2 text-xs font-semibold leading-5 text-[#8a641a]">
            대상 동기방 정보를 불러오지 못했습니다.
            {draft.target_cohort_room_id ? <span title={draft.target_cohort_room_id}> room {shortId(draft.target_cohort_room_id)}</span> : " target_cohort_room_id가 없습니다."}
          </div>
        )}
      </div>
    );
  }

  return null;
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border border-[#e5d8ca] bg-white/92 p-4 shadow-[0_10px_28px_rgba(50,36,17,0.04)]">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#928980]">{label}</p>
      <p className="mt-2 text-2xl font-bold text-[#263832]">{value}</p>
      <p className="mt-1 text-sm font-medium text-[#635b51]">{helper}</p>
    </div>
  );
}

function SelectBox({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Record<string, string>;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-[#928980]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-[#e5d8ca] bg-[#fffdf8] px-3 text-sm font-semibold outline-none"
      >
        {Object.entries(options).map(([key, text]) => (
          <option key={key} value={key}>{text}</option>
        ))}
      </select>
    </label>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-[#928980]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-[#e5d8ca] bg-[#fffdf8] px-3 text-sm font-semibold outline-none"
      />
    </label>
  );
}
