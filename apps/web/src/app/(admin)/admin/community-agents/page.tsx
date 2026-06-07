"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  FileText,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

type AgentStatus = "draft" | "active" | "paused" | "retired";
type TargetType = "post" | "comment" | "reaction" | "cohort_message";
type ContentOrigin = "question" | "comment" | "summary" | "news" | "checklist" | "reaction";

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
  posted_post_id: string | null;
  posted_comment_id: string | null;
  posted_cohort_message_id: string | null;
  created_at: string;
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

function formatDate(value: string): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CommunityAgentsAdminPage() {
  const [authState, setAuthState] = useState<"loading" | "admin" | "denied">("loading");
  const [data, setData] = useState<AgentsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState("");

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

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId]
  );

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/community-agents");
      if (!res.ok) throw new Error("load_failed");
      const next = (await res.json()) as AgentsResponse;
      setData(next);
      setSelectedAgentId((current) => current || next.agents[0]?.id || "");
    } catch {
      setMessage("에이전트 정보를 불러오지 못했습니다.");
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
        posted?: number;
        drafted?: number;
        skipped?: number;
        failed?: number;
      };
      if (!res.ok) {
        throw new Error(result.message ?? result.error ?? "Automation failed.");
      }
      await loadAgents();
      setMessage(
        dryRun
          ? `Dry run complete: drafted ${result.drafted ?? 0}, skipped ${result.skipped ?? 0}, failed ${result.failed ?? 0}`
          : `Automation complete: posted ${result.posted ?? 0}, drafted ${result.drafted ?? 0}, skipped ${result.skipped ?? 0}`
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
          <MetricCard label="초안" value={`${data?.drafts.length ?? 0}개`} helper={`검토중 ${data?.metrics?.draftsByStatus?.needs_review ?? 0}개`} />
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

            <section className="rounded-2xl border border-[#e5d8ca] bg-white/95 p-5 shadow-[0_12px_32px_rgba(50,36,17,0.05)]">
              <h2 className="mb-4 font-serif-kr text-2xl font-medium">최근 초안</h2>
              <div className="space-y-3">
                {(data?.drafts ?? []).length === 0 && (
                  <p className="rounded-xl bg-[#fbf8f2] p-4 text-sm text-[#928980]">아직 초안이 없습니다.</p>
                )}
                {(data?.drafts ?? []).map((draft) => {
                  const agent = agents.find((item) => item.id === draft.agent_id);
                  const blocked = draft.verification_status === "blocked" || draft.verification_status === "source_required";
                  return (
                    <article key={draft.id} className="rounded-xl border border-[#e5d8ca] bg-[#fffdf8] p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-[#263832]">{draft.title || TARGET_LABEL[draft.target_type]}</p>
                          <p className="text-xs text-[#928980]">{agent?.public_nickname ?? "agent"} · {ORIGIN_LABEL[draft.content_origin]} · {formatDate(draft.created_at)}</p>
                        </div>
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-[#36534E]">{draft.status}</span>
                      </div>
                      {draft.content && (
                        <p className="line-clamp-3 text-sm leading-6 text-[#635b51]">{draft.content.replace(/<[^>]*>/g, " ")}</p>
                      )}
                      {draft.safety_flags.length > 0 && (
                        <div className="mt-2 rounded-lg bg-[#fff3d9] px-2 py-1 text-xs font-semibold text-[#8a641a]">
                          {draft.safety_flags.join(", ")}
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {draft.status !== "posted" && (
                          <>
                            <button
                              onClick={() => runAction("approveDraft", { draftId: draft.id })}
                              disabled={!!actionLoading}
                              className="inline-flex h-8 items-center gap-1 rounded-full border border-[#e5d8ca] bg-white px-3 text-xs font-bold text-[#36534E]"
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
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
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
