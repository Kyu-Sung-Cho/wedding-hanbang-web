import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";
import { DEFAULT_COMMUNITY_AGENT_SEEDS, type CommunityAgentStatus } from "@/lib/community/agents/personas";
import {
  validateAgentContent,
  type AgentContentOrigin,
  type AgentVerificationStatus,
} from "@/lib/community/agents/safety";
import { sanitizeHtml, sanitizeText } from "@/utils/sanitize";
import type { CommunityCategory, PostVisibility } from "@/types/community.types";

type TargetType = "post" | "comment" | "reaction" | "cohort_message";

interface AgentRow {
  id: string;
  slug: string;
  public_nickname: string;
  internal_label: string;
  role: string;
  public_mode: "persona" | "official";
  status: CommunityAgentStatus;
  avatar_url: string | null;
  backing_user_id: string | null;
  profile: Record<string, unknown>;
  behavior: Record<string, unknown>;
  safety: Record<string, unknown>;
  sample_lines: string[];
  created_at: string;
  updated_at: string;
}

interface DraftRow {
  id: string;
  agent_id: string;
  target_type: TargetType;
  content_origin: AgentContentOrigin;
  status: "draft" | "needs_review" | "approved" | "posted" | "rejected" | "archived";
  category: string | null;
  title: string | null;
  content: string;
  source_urls: string[];
  safety_flags: string[];
  verification_status: AgentVerificationStatus;
  target_post_id: string | null;
  target_comment_id: string | null;
  target_cohort_room_id: string | null;
  posted_post_id: string | null;
  posted_comment_id: string | null;
  posted_cohort_message_id: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentRequestBody {
  action?: "seed" | "setStatus" | "createDraft" | "approveDraft" | "rejectDraft" | "publishDraft";
  agentId?: string;
  slug?: string;
  status?: CommunityAgentStatus;
  draftId?: string;
  targetType?: TargetType;
  contentOrigin?: AgentContentOrigin;
  category?: CommunityCategory;
  visibility?: PostVisibility;
  title?: string;
  content?: string;
  sourceUrls?: string[];
  targetPostId?: string;
  targetCommentId?: string;
  targetCohortRoomId?: string;
  scheduledFor?: string | null;
  note?: string;
}

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "42P01" || /does not exist|schema cache/i.test(error.message ?? ""));
}

function defaultAgentPayload() {
  return DEFAULT_COMMUNITY_AGENT_SEEDS.map((agent) => ({
    id: `default:${agent.slug}`,
    slug: agent.slug,
    public_nickname: agent.publicNickname,
    internal_label: agent.internalLabel,
    role: agent.role,
    public_mode: agent.publicMode,
    status: agent.defaultStatus,
    avatar_url: null,
    backing_user_id: null,
    profile: agent.profile,
    behavior: agent.behavior,
    safety: agent.safety,
    sample_lines: agent.sampleLines,
    created_at: "",
    updated_at: "",
    isDefaultPreview: true,
  }));
}

function validStatus(status: unknown): status is CommunityAgentStatus {
  return status === "draft" || status === "active" || status === "paused" || status === "retired";
}

function validTargetType(value: unknown): value is TargetType {
  return value === "post" || value === "comment" || value === "reaction" || value === "cohort_message";
}

function validOrigin(value: unknown): value is AgentContentOrigin {
  return value === "question" || value === "comment" || value === "summary" || value === "news" || value === "checklist" || value === "reaction";
}

function hasBodyContent(input: string | null | undefined): boolean {
  return sanitizeText(input ?? "").length >= 2;
}

function isActionableDraft(draft: DraftRow): boolean {
  if (draft.status === "posted" || draft.status === "rejected" || draft.status === "archived") {
    return false;
  }
  if ((draft.safety_flags ?? []).includes("empty_content")) {
    return false;
  }
  return draft.target_type === "reaction" || hasBodyContent(draft.content);
}

async function fetchAgentByIdOrSlug(
  supabase: ReturnType<typeof getServiceClient>,
  input: { agentId?: string; slug?: string }
): Promise<AgentRow | null> {
  let query = supabase.from("community_agent_personas").select("*").limit(1);
  if (input.agentId) {
    query = query.eq("id", input.agentId);
  } else if (input.slug) {
    query = query.eq("slug", input.slug);
  } else {
    return null;
  }

  const { data } = await query.maybeSingle();
  return (data as AgentRow | null) ?? null;
}

async function ensureAgentIdentity(
  supabase: ReturnType<typeof getServiceClient>,
  agent: AgentRow
): Promise<string> {
  if (agent.backing_user_id) return agent.backing_user_id;

  const email = `agent-${agent.slug}@agents.hanbang.ai`;
  const tempPassword = `agent-${agent.slug}-${crypto.randomUUID()}`;
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      account_kind: "community_agent",
      community_agent_slug: agent.slug,
      public_nickname: agent.public_nickname,
    },
  });

  if (error || !data.user) {
    throw new Error(error?.message ?? "agent_user_create_failed");
  }

  const userId = data.user.id;

  await supabase.from("profiles").upsert({
    id: userId,
    email,
    name: agent.public_nickname,
    onboarding_completed: true,
    onboarding_step: 5,
    is_admin: false,
  });

  await supabase.from("community_profiles").upsert({
    user_id: userId,
    nickname: agent.public_nickname,
    avatar_url: agent.avatar_url,
    badge: "member",
    rank: "sprout",
    post_count: 0,
    comment_count: 0,
    total_upvotes_received: 0,
    wedding_completed: false,
  });

  await supabase
    .from("community_agent_personas")
    .update({ backing_user_id: userId })
    .eq("id", agent.id);

  return userId;
}

async function loadMetrics(supabase: ReturnType<typeof getServiceClient>, agentUserIds: string[]) {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceIso = since.toISOString();

  const [agentPosts, agentComments, agentVotes, humanPosts, humanComments, draftCounts] = await Promise.all([
    agentUserIds.length
      ? supabase.from("community_posts").select("id", { count: "exact", head: true }).in("author_id", agentUserIds).gte("created_at", sinceIso)
      : Promise.resolve({ count: 0 }),
    agentUserIds.length
      ? supabase.from("community_comments").select("id", { count: "exact", head: true }).in("author_id", agentUserIds).gte("created_at", sinceIso)
      : Promise.resolve({ count: 0 }),
    agentUserIds.length
      ? supabase.from("community_votes").select("id", { count: "exact", head: true }).in("user_id", agentUserIds).gte("created_at", sinceIso)
      : Promise.resolve({ count: 0 }),
    supabase.from("community_human_posts").select("id", { count: "exact", head: true }).gte("created_at", sinceIso),
    supabase.from("community_human_comments").select("id", { count: "exact", head: true }).gte("created_at", sinceIso),
    supabase.from("community_agent_content_drafts").select("status,target_type,content,safety_flags"),
  ]);

  const draftsByStatus = new Map<string, number>();
  for (const row of draftCounts.data ?? []) {
    if (!isActionableDraft(row as DraftRow)) continue;
    const status = (row as { status?: string }).status ?? "unknown";
    draftsByStatus.set(status, (draftsByStatus.get(status) ?? 0) + 1);
  }

  return {
    periodDays: 30,
    agent: {
      posts: agentPosts.count ?? 0,
      comments: agentComments.count ?? 0,
      reactions: agentVotes.count ?? 0,
    },
    human: {
      posts: humanPosts.count ?? 0,
      comments: humanComments.count ?? 0,
    },
    draftsByStatus: Object.fromEntries(draftsByStatus),
  };
}

export async function GET(req: Request) {
  const { authorized } = await verifyAdmin(req);
  if (!authorized) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const supabase = getServiceClient();

  const { data: agentsRaw, error } = await supabase
    .from("community_agent_personas")
    .select("*")
    .order("created_at", { ascending: true });

  if (isMissingTableError(error)) {
    return NextResponse.json({
      setupRequired: true,
      agents: defaultAgentPayload(),
      drafts: [],
      metrics: null,
      message: "community agent migration has not been applied yet.",
    });
  }

  if (error) {
    console.error("[community-agents.GET] agents error:", error);
    return NextResponse.json({ error: "에이전트 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  const agents = (agentsRaw ?? []) as AgentRow[];
  const { data: draftsRaw } = await supabase
    .from("community_agent_content_drafts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(80);
  const drafts = ((draftsRaw ?? []) as DraftRow[]).filter(isActionableDraft).slice(0, 30);

  const agentUserIds = agents
    .map((agent) => agent.backing_user_id)
    .filter((id): id is string => Boolean(id));

  const metrics = agents.length > 0 ? await loadMetrics(supabase, agentUserIds) : null;

  return NextResponse.json({
    setupRequired: agents.length === 0,
    agents: agents.length > 0 ? agents : defaultAgentPayload(),
    drafts,
    metrics,
  });
}

export async function POST(req: Request) {
  const { authorized, userId } = await verifyAdmin(req);
  if (!authorized || !userId) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const supabase = getServiceClient();
  const body = (await req.json().catch(() => ({}))) as AgentRequestBody;

  if (body.action === "seed") {
    const rows = DEFAULT_COMMUNITY_AGENT_SEEDS.map((agent) => ({
      slug: agent.slug,
      public_nickname: agent.publicNickname,
      internal_label: agent.internalLabel,
      role: agent.role,
      public_mode: agent.publicMode,
      status: agent.defaultStatus === "retired" ? "retired" : "active",
      profile: agent.profile,
      behavior: agent.behavior,
      safety: agent.safety,
      sample_lines: agent.sampleLines,
      created_by: userId,
    }));

    const { error } = await supabase
      .from("community_agent_personas")
      .upsert(rows, { onConflict: "slug" });

    if (isMissingTableError(error)) {
      return NextResponse.json({ error: "Supabase migration을 먼저 적용해야 합니다." }, { status: 500 });
    }
    if (error) {
      console.error("[community-agents.seed] error:", error);
      return NextResponse.json({ error: "기본 에이전트 생성에 실패했습니다." }, { status: 500 });
    }

    const { data: seeded } = await supabase
      .from("community_agent_personas")
      .select("id")
      .in("slug", DEFAULT_COMMUNITY_AGENT_SEEDS.map((agent) => agent.slug));

    await supabase.from("community_agent_activity_log").insert(
      (seeded ?? []).map((agent) => ({
        agent_id: agent.id,
        action_type: "seed",
        metadata: { seeded_by: userId },
      }))
    );

    return NextResponse.json({ ok: true, count: rows.length });
  }

  if (body.action === "setStatus") {
    if (!validStatus(body.status)) {
      return NextResponse.json({ error: "올바른 상태가 아닙니다." }, { status: 400 });
    }

    const agent = await fetchAgentByIdOrSlug(supabase, body);
    if (!agent) return NextResponse.json({ error: "에이전트를 찾을 수 없습니다." }, { status: 404 });

    const { error } = await supabase
      .from("community_agent_personas")
      .update({ status: body.status })
      .eq("id", agent.id);

    if (error) {
      console.error("[community-agents.setStatus] error:", error);
      return NextResponse.json({ error: "상태 변경에 실패했습니다." }, { status: 500 });
    }

    await supabase.from("community_agent_activity_log").insert({
      agent_id: agent.id,
      action_type: "status_change",
      metadata: { from: agent.status, to: body.status, changed_by: userId },
    });

    return NextResponse.json({ ok: true });
  }

  if (body.action === "createDraft") {
    const agent = await fetchAgentByIdOrSlug(supabase, body);
    if (!agent) return NextResponse.json({ error: "에이전트를 찾을 수 없습니다." }, { status: 404 });
    if (!validTargetType(body.targetType)) {
      return NextResponse.json({ error: "대상 유형이 올바르지 않습니다." }, { status: 400 });
    }
    if (!validOrigin(body.contentOrigin)) {
      return NextResponse.json({ error: "콘텐츠 출처 유형이 올바르지 않습니다." }, { status: 400 });
    }

    const title = body.title ? sanitizeText(body.title).slice(0, 200) : null;
    const rawContent = body.targetType === "reaction" ? body.content || "like" : body.content ?? "";
    const content = sanitizeHtml(rawContent).slice(0, 50000);
    if (body.targetType !== "reaction" && !hasBodyContent(content)) {
      return NextResponse.json({ error: "본문이 비어 있는 초안은 만들 수 없습니다." }, { status: 400 });
    }
    const safety = validateAgentContent({
      origin: body.contentOrigin,
      title,
      content,
      sourceUrls: body.sourceUrls,
    });

    const status = safety.blocked || safety.status === "source_required" ? "needs_review" : "draft";
    const { data: draft, error } = await supabase
      .from("community_agent_content_drafts")
      .insert({
        agent_id: agent.id,
        target_type: body.targetType,
        content_origin: body.contentOrigin,
        status,
        category: body.category ?? null,
        title,
        content,
        source_urls: safety.normalizedSourceUrls,
        safety_flags: safety.flags,
        verification_status: safety.status,
        target_post_id: body.targetPostId ?? null,
        target_comment_id: body.targetCommentId ?? null,
        target_cohort_room_id: body.targetCohortRoomId ?? null,
        scheduled_for: body.scheduledFor ?? null,
        created_by: userId,
      })
      .select("*")
      .single();

    if (error) {
      console.error("[community-agents.createDraft] error:", error);
      return NextResponse.json({ error: "초안 생성에 실패했습니다." }, { status: 500 });
    }

    await supabase.from("community_agent_activity_log").insert({
      agent_id: agent.id,
      action_type: "draft",
      draft_id: draft.id,
      metadata: { created_by: userId, safety_status: safety.status, flags: safety.flags },
    });

    return NextResponse.json({ ok: true, draft, safety }, { status: 201 });
  }

  if (body.action === "approveDraft" || body.action === "rejectDraft") {
    if (!body.draftId) return NextResponse.json({ error: "draftId가 필요합니다." }, { status: 400 });

    const nextStatus = body.action === "approveDraft" ? "approved" : "rejected";
    const { error } = await supabase
      .from("community_agent_content_drafts")
      .update({
        status: nextStatus,
        metadata: { note: body.note ?? null, reviewed_by: userId, reviewed_at: new Date().toISOString() },
      })
      .eq("id", body.draftId)
      .neq("status", "posted");

    if (error) {
      console.error("[community-agents.reviewDraft] error:", error);
      return NextResponse.json({ error: "초안 상태 변경에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, status: nextStatus });
  }

  if (body.action === "publishDraft") {
    if (!body.draftId) return NextResponse.json({ error: "draftId가 필요합니다." }, { status: 400 });

    const { data: draftRaw, error: draftError } = await supabase
      .from("community_agent_content_drafts")
      .select("*")
      .eq("id", body.draftId)
      .maybeSingle();

    if (draftError || !draftRaw) {
      return NextResponse.json({ error: "초안을 찾을 수 없습니다." }, { status: 404 });
    }

    const draft = draftRaw as DraftRow;
    if (draft.status === "posted") {
      return NextResponse.json({ error: "이미 게시된 초안입니다." }, { status: 409 });
    }
    if (draft.verification_status === "blocked" || draft.safety_flags.some((flag) => flag.startsWith("blocked_"))) {
      return NextResponse.json({ error: "차단된 초안은 게시할 수 없습니다.", flags: draft.safety_flags }, { status: 400 });
    }
    if (draft.verification_status === "source_required") {
      return NextResponse.json({ error: "출처가 필요한 초안입니다.", flags: draft.safety_flags }, { status: 400 });
    }
    if (draft.target_type !== "reaction" && !hasBodyContent(draft.content)) {
      return NextResponse.json({ error: "본문이 비어 있는 초안은 게시할 수 없습니다.", flags: draft.safety_flags }, { status: 400 });
    }

    const agent = await fetchAgentByIdOrSlug(supabase, { agentId: draft.agent_id });
    if (!agent) return NextResponse.json({ error: "에이전트를 찾을 수 없습니다." }, { status: 404 });

    const backingUserId = await ensureAgentIdentity(supabase, agent);

    let postedPostId: string | null = null;
    let postedCommentId: string | null = null;
    let postedCohortMessageId: string | null = null;

    if (draft.target_type === "post") {
      const title = sanitizeText(draft.title ?? "").slice(0, 200);
      if (!title) return NextResponse.json({ error: "게시글 제목이 필요합니다." }, { status: 400 });

      const { data: post, error } = await supabase
        .from("community_posts")
        .insert({
          author_id: backingUserId,
          category: (draft.category as CommunityCategory | null) ?? "free",
          title,
          content: draft.content,
          images: [],
          visibility: (body.visibility as PostVisibility | undefined) ?? "public",
          vendor_tags: [],
          tags: [],
          ad_disclosure: "general",
          sponsorship_detail: null,
          price_data: null,
          is_quick_review: false,
          rating: null,
          upvote_count: 0,
          downvote_count: 0,
          comment_count: 0,
          view_count: 0,
          bookmark_count: 0,
          is_pinned: false,
          is_weekly_best: false,
        })
        .select("id")
        .single();

      if (error || !post) {
        console.error("[community-agents.publishDraft] post error:", error);
        return NextResponse.json({ error: "게시글 게시에 실패했습니다." }, { status: 500 });
      }

      postedPostId = post.id as string;
      await supabase.rpc("community_increment_profile_count", {
        p_user_id: backingUserId,
        p_field: "post_count",
      });
    } else if (draft.target_type === "comment") {
      if (!draft.target_post_id) return NextResponse.json({ error: "댓글 대상 postId가 필요합니다." }, { status: 400 });
      const { data: comment, error } = await supabase
        .from("community_comments")
        .insert({
          post_id: draft.target_post_id,
          parent_id: draft.target_comment_id,
          author_id: backingUserId,
          content: draft.content,
          upvote_count: 0,
          is_deleted: false,
        })
        .select("id")
        .single();

      if (error || !comment) {
        console.error("[community-agents.publishDraft] comment error:", error);
        return NextResponse.json({ error: "댓글 게시에 실패했습니다." }, { status: 500 });
      }

      postedCommentId = comment.id as string;
      await supabase
        .from("community_posts")
        .select("comment_count")
        .eq("id", draft.target_post_id)
        .single()
        .then(({ data }) =>
          supabase
            .from("community_posts")
            .update({ comment_count: (data?.comment_count ?? 0) + 1 })
            .eq("id", draft.target_post_id)
        );
      await supabase.rpc("community_increment_profile_count", {
        p_user_id: backingUserId,
        p_field: "comment_count",
      });
    } else if (draft.target_type === "reaction") {
      if (!draft.target_post_id) return NextResponse.json({ error: "좋아요 대상 postId가 필요합니다." }, { status: 400 });
      const { error } = await supabase.rpc("community_vote_post", {
        p_user_id: backingUserId,
        p_post_id: draft.target_post_id,
        p_vote_type: 1,
      });
      if (error) {
        console.error("[community-agents.publishDraft] reaction error:", error);
        return NextResponse.json({ error: "좋아요 처리에 실패했습니다." }, { status: 500 });
      }
      postedPostId = draft.target_post_id;
    } else if (draft.target_type === "cohort_message") {
      if (!draft.target_cohort_room_id) return NextResponse.json({ error: "동기방 roomId가 필요합니다." }, { status: 400 });
      const { data: message, error } = await supabase
        .from("cohort_messages")
        .insert({
          room_id: draft.target_cohort_room_id,
          author_id: backingUserId,
          content: sanitizeText(draft.content).slice(0, 2000),
          thread_topic: null,
          images: [],
          reply_to: null,
          is_deleted: false,
        })
        .select("id")
        .single();

      if (error || !message) {
        console.error("[community-agents.publishDraft] cohort message error:", error);
        return NextResponse.json({ error: "동기방 메시지 게시에 실패했습니다." }, { status: 500 });
      }

      postedCohortMessageId = message.id as string;
    }

    await supabase
      .from("community_agent_content_drafts")
      .update({
        status: "posted",
        posted_post_id: postedPostId,
        posted_comment_id: postedCommentId,
        posted_cohort_message_id: postedCohortMessageId,
        posted_by: userId,
      })
      .eq("id", draft.id);

    await supabase.from("community_agent_activity_log").insert({
      agent_id: agent.id,
      action_type: draft.target_type,
      post_id: postedPostId,
      comment_id: postedCommentId,
      cohort_message_id: postedCohortMessageId,
      draft_id: draft.id,
      human_metrics_excluded: true,
      metadata: {
        content_origin: draft.content_origin,
        verification_status: draft.verification_status,
        source_urls: draft.source_urls,
        posted_by: userId,
      },
    });

    revalidatePath("/wedding/community");
    revalidatePath("/wedding/community/all");
    if (postedPostId) revalidatePath(`/wedding/community/post/${postedPostId}`);

    return NextResponse.json({
      ok: true,
      postedPostId,
      postedCommentId,
      postedCohortMessageId,
    });
  }

  return NextResponse.json({ error: "지원하지 않는 action입니다." }, { status: 400 });
}
