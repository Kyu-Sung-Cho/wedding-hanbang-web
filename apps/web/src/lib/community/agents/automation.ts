import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_COMMUNITY_AGENT_SEEDS, type CommunityAgentStatus } from "@/lib/community/agents/personas";
import {
  validateAgentContent,
  type AgentContentOrigin,
  type AgentVerificationStatus,
} from "@/lib/community/agents/safety";
import { elapsedMs, logAIInteraction, startLatencyClock } from "@/lib/compliance/ai-log";
import { sanitizeHtml, sanitizeText } from "@/utils/sanitize";
import type { CommunityCategory, PostVisibility } from "@/types/community.types";

export type AgentTargetType = "post" | "comment" | "reaction" | "cohort_message";
type AutomationAction = "post" | "comment" | "reaction" | "cohort_message";

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
  behavior: {
    activityLevel?: "very_quiet" | "quiet" | "normal" | "active";
    silenceWeight?: number;
    actionWeights?: Partial<Record<"post" | "comment" | "like" | "summarize", number>>;
    preferredWindows?: string[];
    topics?: string[];
    commentStyle?: string;
  };
  safety: Record<string, unknown>;
  sample_lines: string[];
}

interface DraftRow {
  id: string;
  agent_id: string;
  target_type: AgentTargetType;
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
}

interface RecentPost {
  id: string;
  title: string;
  content: string;
  category: CommunityCategory;
  tags: string[] | null;
  comment_count: number;
  upvote_count: number;
  created_at: string;
  author_id: string;
}

interface DailyState {
  id: string;
  agent_id: string;
  day: string;
  planned_posts: number;
  planned_comments: number;
  planned_reactions: number;
  planned_cohort_messages: number;
  done_posts: number;
  done_comments: number;
  done_reactions: number;
  done_cohort_messages: number;
}

interface GeneratedAction {
  targetType: AgentTargetType;
  contentOrigin: AgentContentOrigin;
  category?: CommunityCategory;
  title?: string;
  content: string;
  sourceUrls?: string[];
  targetPostId?: string;
  targetCommentId?: string;
  targetCohortRoomId?: string;
  confidence?: number;
  reason?: string;
}

export interface CommunityAgentAutomationOptions {
  triggerSource: "cron" | "admin" | "manual";
  actorUserId?: string | null;
  dryRun?: boolean;
  autoPublish?: boolean;
  maxActions?: number;
  seedIfEmpty?: boolean;
}

interface AutomationResultItem {
  agentSlug: string;
  action: AutomationAction;
  status: "posted" | "drafted" | "skipped" | "failed";
  draftId?: string;
  postedPostId?: string | null;
  postedCommentId?: string | null;
  postedCohortMessageId?: string | null;
  reason?: string;
  flags?: string[];
}

export interface CommunityAgentAutomationResult {
  ok: boolean;
  runId: string | null;
  dryRun: boolean;
  planned: number;
  posted: number;
  drafted: number;
  skipped: number;
  failed: number;
  items: AutomationResultItem[];
  message?: string;
}

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const VALID_CATEGORIES: CommunityCategory[] = ["is_normal", "tour_review", "tips_v2", "ama", "free"];

function isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === "42P01" || /does not exist|schema cache/i.test(error.message ?? ""));
}

function todayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function pickInt(random: () => number, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(random() * (max - min + 1));
}

function stripTags(input: string): string {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function boundedCategory(category: unknown): CommunityCategory {
  return VALID_CATEGORIES.includes(category as CommunityCategory) ? (category as CommunityCategory) : "free";
}

function remainingCount(state: DailyState, action: AutomationAction): number {
  if (action === "post") return Math.max(0, state.planned_posts - state.done_posts);
  if (action === "comment") return Math.max(0, state.planned_comments - state.done_comments);
  if (action === "reaction") return Math.max(0, state.planned_reactions - state.done_reactions);
  return Math.max(0, state.planned_cohort_messages - state.done_cohort_messages);
}

function incrementField(action: AutomationAction): keyof Pick<
  DailyState,
  "done_posts" | "done_comments" | "done_reactions" | "done_cohort_messages"
> {
  if (action === "post") return "done_posts";
  if (action === "comment") return "done_comments";
  if (action === "reaction") return "done_reactions";
  return "done_cohort_messages";
}

function buildDailyPlan(agent: AgentRow, day: string): Omit<
  DailyState,
  "id" | "agent_id" | "day" | "done_posts" | "done_comments" | "done_reactions" | "done_cohort_messages"
> {
  const random = seededRandom(hashString(`${day}:${agent.slug}:community-agent-plan`));
  const activity = agent.behavior.activityLevel ?? "quiet";
  const silence = Math.min(0.95, Math.max(0, agent.behavior.silenceWeight ?? 0.5));

  const ranges = {
    very_quiet: { posts: [0, 0], comments: [0, 1], reactions: [0, 2], cohort: [0, 0] },
    quiet: { posts: [0, 1], comments: [0, 2], reactions: [1, 3], cohort: [0, 1] },
    normal: { posts: [0, 1], comments: [1, 3], reactions: [2, 5], cohort: [0, 1] },
    active: { posts: [1, 2], comments: [2, 4], reactions: [3, 6], cohort: [0, 2] },
  }[activity];

  const quietDay = random() < silence * 0.28;
  const offDay = random() < silence * 0.08;

  if (offDay) {
    return {
      planned_posts: 0,
      planned_comments: 0,
      planned_reactions: pickInt(random, 0, 1),
      planned_cohort_messages: 0,
    };
  }

  return {
    planned_posts: quietDay ? 0 : pickInt(random, ranges.posts[0], ranges.posts[1]),
    planned_comments: quietDay ? pickInt(random, 0, 1) : pickInt(random, ranges.comments[0], ranges.comments[1]),
    planned_reactions: pickInt(random, ranges.reactions[0], ranges.reactions[1]),
    planned_cohort_messages: quietDay ? 0 : pickInt(random, ranges.cohort[0], ranges.cohort[1]),
  };
}

function chooseAction(agent: AgentRow, state: DailyState, random: () => number): AutomationAction | null {
  const weights = agent.behavior.actionWeights ?? {};
  const baseCandidates: Array<{ action: AutomationAction; weight: number }> = [
    { action: "post", weight: weights.post ?? 0.12 },
    { action: "comment", weight: weights.comment ?? 0.42 },
    { action: "reaction", weight: weights.like ?? 0.36 },
    { action: "cohort_message", weight: (weights.summarize ?? 0.04) * 0.65 },
  ];
  const candidates = baseCandidates.filter((candidate) => remainingCount(state, candidate.action) > 0 && candidate.weight > 0);

  const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  if (total <= 0) return null;

  let cursor = random() * total;
  for (const candidate of candidates) {
    cursor -= candidate.weight;
    if (cursor <= 0) return candidate.action;
  }
  return candidates[candidates.length - 1]?.action ?? null;
}

async function ensureDefaultAgents(supabase: SupabaseClient): Promise<void> {
  const rows = DEFAULT_COMMUNITY_AGENT_SEEDS.map((agent) => ({
    slug: agent.slug,
    public_nickname: agent.publicNickname,
    internal_label: agent.internalLabel,
    role: agent.role,
    public_mode: agent.publicMode,
    status: "active",
    profile: agent.profile,
    behavior: agent.behavior,
    safety: agent.safety,
    sample_lines: agent.sampleLines,
    created_by: null,
  }));

  const { error } = await supabase
    .from("community_agent_personas")
    .upsert(rows, { onConflict: "slug" });

  if (error) throw new Error(error.message);
}

async function ensureDailyState(supabase: SupabaseClient, agent: AgentRow, day: string): Promise<DailyState> {
  const { data: existing, error } = await supabase
    .from("community_agent_daily_state")
    .select("*")
    .eq("agent_id", agent.id)
    .eq("day", day)
    .maybeSingle();

  if (error && !isMissingTableError(error)) throw new Error(error.message);
  if (existing) return existing as DailyState;

  const plan = buildDailyPlan(agent, day);
  const { data, error: insertError } = await supabase
    .from("community_agent_daily_state")
    .insert({
      agent_id: agent.id,
      day,
      ...plan,
      done_posts: 0,
      done_comments: 0,
      done_reactions: 0,
      done_cohort_messages: 0,
      mood: "normal",
      seed: hashString(`${day}:${agent.slug}`),
    })
    .select("*")
    .single();

  if (insertError || !data) {
    throw new Error(insertError?.message ?? "daily_state_insert_failed");
  }

  return data as DailyState;
}

async function incrementDailyDone(supabase: SupabaseClient, state: DailyState, action: AutomationAction): Promise<void> {
  const field = incrementField(action);
  const current = Number(state[field] ?? 0);
  await supabase
    .from("community_agent_daily_state")
    .update({ [field]: current + 1 })
    .eq("id", state.id);
  state[field] = current + 1;
}

async function ensureAgentIdentity(supabase: SupabaseClient, agent: AgentRow): Promise<string> {
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

  if (error || !data.user) throw new Error(error?.message ?? "agent_user_create_failed");

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

  agent.backing_user_id = userId;
  return userId;
}

async function createDraft(supabase: SupabaseClient, input: {
  agent: AgentRow;
  action: GeneratedAction;
  runId: string | null;
  actorUserId?: string | null;
  autoPublish: boolean;
}): Promise<{ draft: DraftRow; safety: ReturnType<typeof validateAgentContent> }> {
  const raw = input.action;
  const title = raw.title ? sanitizeText(raw.title).slice(0, 200) : null;
  const content = raw.targetType === "reaction"
    ? "like"
    : sanitizeHtml(raw.content ?? "").slice(0, 50000);

  const safety = validateAgentContent({
    origin: raw.contentOrigin,
    title,
    content,
    sourceUrls: raw.sourceUrls,
  });

  const draftStatus = safety.blocked || safety.status === "source_required" ? "needs_review" : "draft";
  const { data, error } = await supabase
    .from("community_agent_content_drafts")
    .insert({
      agent_id: input.agent.id,
      target_type: raw.targetType,
      content_origin: raw.contentOrigin,
      status: draftStatus,
      category: raw.targetType === "post" ? boundedCategory(raw.category) : null,
      title,
      content,
      source_urls: safety.normalizedSourceUrls,
      safety_flags: safety.flags,
      verification_status: safety.status,
      target_post_id: raw.targetPostId ?? null,
      target_comment_id: raw.targetCommentId ?? null,
      target_cohort_room_id: raw.targetCohortRoomId ?? null,
      created_by: input.actorUserId ?? null,
      auto_generated: true,
      auto_publish: input.autoPublish,
      automation_run_id: input.runId,
      decision: {
        confidence: raw.confidence ?? null,
        reason: raw.reason ?? null,
      },
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message ?? "draft_insert_failed");

  await supabase.from("community_agent_activity_log").insert({
    agent_id: input.agent.id,
    action_type: "draft",
    draft_id: data.id,
    metadata: {
      automation_run_id: input.runId,
      safety_status: safety.status,
      flags: safety.flags,
      auto_publish: input.autoPublish,
    },
  });

  return { draft: data as DraftRow, safety };
}

async function publishDraft(supabase: SupabaseClient, draft: DraftRow, agent: AgentRow, actorUserId?: string | null) {
  if (draft.verification_status === "blocked" || draft.safety_flags.some((flag) => flag.startsWith("blocked_"))) {
    throw new Error("blocked_draft");
  }
  if (draft.verification_status === "source_required") {
    throw new Error("source_required");
  }

  const backingUserId = await ensureAgentIdentity(supabase, agent);

  let postedPostId: string | null = null;
  let postedCommentId: string | null = null;
  let postedCohortMessageId: string | null = null;

  if (draft.target_type === "post") {
    const title = sanitizeText(draft.title ?? "").slice(0, 200);
    if (!title) throw new Error("missing_post_title");

    const { data: post, error } = await supabase
      .from("community_posts")
      .insert({
        author_id: backingUserId,
        category: (draft.category as CommunityCategory | null) ?? "free",
        title,
        content: draft.content,
        images: [],
        visibility: "public" satisfies PostVisibility,
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

    if (error || !post) throw new Error(error?.message ?? "post_insert_failed");
    postedPostId = post.id as string;
    await supabase.rpc("community_increment_profile_count", {
      p_user_id: backingUserId,
      p_field: "post_count",
    });
  } else if (draft.target_type === "comment") {
    if (!draft.target_post_id) throw new Error("missing_target_post_id");
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

    if (error || !comment) throw new Error(error?.message ?? "comment_insert_failed");
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
    if (!draft.target_post_id) throw new Error("missing_reaction_post_id");
    const { error } = await supabase.rpc("community_vote_post", {
      p_user_id: backingUserId,
      p_post_id: draft.target_post_id,
      p_vote_type: 1,
    });
    if (error) throw new Error(error.message);
    postedPostId = draft.target_post_id;
  } else if (draft.target_type === "cohort_message") {
    if (!draft.target_cohort_room_id) throw new Error("missing_cohort_room_id");
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

    if (error || !message) throw new Error(error?.message ?? "cohort_message_insert_failed");
    postedCohortMessageId = message.id as string;
  }

  await supabase
    .from("community_agent_content_drafts")
    .update({
      status: "posted",
      posted_post_id: postedPostId,
      posted_comment_id: postedCommentId,
      posted_cohort_message_id: postedCohortMessageId,
      posted_by: actorUserId ?? null,
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
      posted_by: actorUserId ?? "automation",
    },
  });

  revalidatePath("/wedding/community");
  revalidatePath("/wedding/community/all");
  if (postedPostId) revalidatePath(`/wedding/community/post/${postedPostId}`);

  return { postedPostId, postedCommentId, postedCohortMessageId };
}

async function fetchRecentHumanPosts(supabase: SupabaseClient): Promise<RecentPost[]> {
  const since = new Date(Date.now() - 1000 * 60 * 60 * 96).toISOString();
  const { data, error } = await supabase
    .from("community_human_posts")
    .select("id,title,content,category,tags,comment_count,upvote_count,created_at,author_id")
    .eq("visibility", "public")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(24);

  if (error) {
    if (isMissingTableError(error)) throw new Error("community_agent_migration_missing");
    throw new Error(error.message);
  }

  return (data ?? []) as RecentPost[];
}

async function fetchOpenCohortRooms(supabase: SupabaseClient): Promise<Array<{ id: string; name: string; message_count: number }>> {
  const { data } = await supabase
    .from("cohort_rooms")
    .select("id,name,message_count")
    .eq("is_active", true)
    .order("message_count", { ascending: false })
    .limit(8);

  return (data ?? []) as Array<{ id: string; name: string; message_count: number }>;
}

async function chooseReactionTarget(
  supabase: SupabaseClient,
  agentUserId: string,
  posts: RecentPost[],
  random: () => number
): Promise<string | null> {
  const postIds = posts.map((post) => post.id);
  if (postIds.length === 0) return null;

  const { data: votes } = await supabase
    .from("community_votes")
    .select("post_id")
    .eq("user_id", agentUserId)
    .in("post_id", postIds);

  const alreadyLiked = new Set((votes ?? []).map((vote) => vote.post_id as string));
  const candidates = posts.filter((post) => !alreadyLiked.has(post.id));
  if (candidates.length === 0) return null;

  return candidates[Math.floor(random() * candidates.length)]?.id ?? null;
}

function parseGeneratedAction(text: string, fallbackAction: AutomationAction): GeneratedAction {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
  const parsed = JSON.parse(jsonText) as Partial<GeneratedAction>;
  const targetType = parsed.targetType === "comment" || parsed.targetType === "reaction" || parsed.targetType === "cohort_message" || parsed.targetType === "post"
    ? parsed.targetType
    : fallbackAction;
  const contentOrigin = parsed.contentOrigin === "news" ||
    parsed.contentOrigin === "summary" ||
    parsed.contentOrigin === "checklist" ||
    parsed.contentOrigin === "reaction" ||
    parsed.contentOrigin === "comment" ||
    parsed.contentOrigin === "question"
    ? parsed.contentOrigin
    : targetType === "comment"
      ? "comment"
      : "question";

  return {
    targetType,
    contentOrigin,
    category: boundedCategory(parsed.category),
    title: typeof parsed.title === "string" ? parsed.title : undefined,
    content: typeof parsed.content === "string" ? parsed.content : "",
    sourceUrls: Array.isArray(parsed.sourceUrls) ? parsed.sourceUrls.filter((url): url is string => typeof url === "string") : [],
    targetPostId: typeof parsed.targetPostId === "string" ? parsed.targetPostId : undefined,
    targetCommentId: typeof parsed.targetCommentId === "string" ? parsed.targetCommentId : undefined,
    targetCohortRoomId: typeof parsed.targetCohortRoomId === "string" ? parsed.targetCohortRoomId : undefined,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
    reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
  };
}

async function generateAction(input: {
  agent: AgentRow;
  action: AutomationAction;
  posts: RecentPost[];
  cohortRooms: Array<{ id: string; name: string; message_count: number }>;
  model: string;
}): Promise<{ action: GeneratedAction; tokensInput: number; tokensOutput: number; rawText: string; latencyMs: number }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY_missing");
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const postContext = input.posts.slice(0, 10).map((post) => ({
    id: post.id,
    title: post.title,
    category: post.category,
    tags: post.tags ?? [],
    comments: post.comment_count,
    likes: post.upvote_count,
    body: stripTags(post.content).slice(0, 260),
  }));

  const system = [
    "You run one Korean wedding community persona.",
    "Write naturally in Korean, short and human, but never invent a personal visit, contract, quote, booking, or payment experience.",
    "If the persona does not know, ask a useful question or share a cautious checklist.",
    "Do not recommend a specific vendor unless the provided context supports it.",
    "News/statistical/numeric claims require HTTPS source URLs. If sources are not supplied, do not write news.",
    "Return JSON only. No markdown.",
  ].join(" ");

  const user = JSON.stringify({
    desiredAction: input.action,
    outputSchema: {
      targetType: "post | comment | cohort_message",
      contentOrigin: "question | comment | summary | checklist | news",
      category: "free | tips_v2 | tour_review | is_normal | ama",
      targetPostId: "required for comment",
      targetCohortRoomId: "required for cohort_message",
      title: "required for post",
      content: "plain Korean text or simple paragraphs",
      sourceUrls: "required for news/statistics, otherwise []",
      confidence: "0 to 1",
      reason: "short internal reason",
    },
    persona: {
      publicNickname: input.agent.public_nickname,
      internalLabel: input.agent.internal_label,
      role: input.agent.role,
      profile: input.agent.profile,
      behavior: input.agent.behavior,
      sampleLines: input.agent.sample_lines?.slice(0, 2),
    },
    recentHumanPosts: postContext,
    cohortRooms: input.cohortRooms,
    constraints: {
      maxPostTitleChars: 72,
      maxCommentChars: 360,
      maxPostChars: 900,
      avoid: [
        "fake first-person experience",
        "vendor ranking without source",
        "medical/legal/financial certainty",
        "repeating another agent",
      ],
    },
  });

  const startedAt = startLatencyClock();
  const message = await anthropic.messages.create({
    model: input.model,
    max_tokens: 520,
    temperature: 0.82,
    system,
    messages: [{ role: "user", content: user }],
  });

  const firstBlock = message.content[0];
  const rawText = firstBlock && firstBlock.type === "text" ? firstBlock.text.trim() : "";
  const latencyMs = elapsedMs(startedAt);

  void logAIInteraction({
    userId: input.agent.backing_user_id ?? null,
    interactionType: "community_agent_auto",
    specialistType: "general",
    userInput: null,
    aiOutput: rawText,
    latencyMs,
    success: rawText.length > 0,
    model: input.model,
    tokensInput: message.usage?.input_tokens,
    tokensOutput: message.usage?.output_tokens,
    metadata: {
      endpoint: "community-agent-automation",
      agent_id: input.agent.id,
      agent_slug: input.agent.slug,
      desired_action: input.action,
      context_post_ids: postContext.map((post) => post.id),
    },
  });

  return {
    action: parseGeneratedAction(rawText, input.action),
    tokensInput: message.usage?.input_tokens ?? 0,
    tokensOutput: message.usage?.output_tokens ?? 0,
    rawText,
    latencyMs,
  };
}

export async function runCommunityAgentAutomation(
  supabase: SupabaseClient,
  options: CommunityAgentAutomationOptions
): Promise<CommunityAgentAutomationResult> {
  const dryRun = options.dryRun ?? false;
  const autoPublish = options.autoPublish ?? true;
  const maxActions = Math.max(1, Math.min(options.maxActions ?? 6, 20));
  const model = process.env.COMMUNITY_AGENT_MODEL ?? DEFAULT_MODEL;
  const day = todayKey();
  let runId: string | null = null;
  const items: AutomationResultItem[] = [];
  let tokensInput = 0;
  let tokensOutput = 0;

  const { data: run, error: runError } = await supabase
    .from("community_agent_automation_runs")
    .insert({
      trigger_source: options.triggerSource,
      status: "running",
      dry_run: dryRun,
      model,
      metadata: { auto_publish: autoPublish, max_actions: maxActions },
    })
    .select("id")
    .single();

  if (runError) {
    if (isMissingTableError(runError)) {
      return {
        ok: false,
        runId: null,
        dryRun,
        planned: 0,
        posted: 0,
        drafted: 0,
        skipped: 0,
        failed: 0,
        items: [],
        message: "community agent automation SQL has not been applied.",
      };
    }
    throw new Error(runError.message);
  }
  runId = run.id as string;

  try {
    let { data: agentsRaw, error: agentsError } = await supabase
      .from("community_agent_personas")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: true });

    if (isMissingTableError(agentsError)) {
      throw new Error("community_agent_migration_missing");
    }

    if ((!agentsRaw || agentsRaw.length === 0) && (options.seedIfEmpty ?? true)) {
      const existingAgents = await supabase
        .from("community_agent_personas")
        .select("id", { count: "exact", head: true });

      if ((existingAgents.count ?? 0) === 0) {
        await ensureDefaultAgents(supabase);
        const refreshed = await supabase
          .from("community_agent_personas")
          .select("*")
          .eq("status", "active")
          .order("created_at", { ascending: true });
        agentsRaw = refreshed.data;
        agentsError = refreshed.error;
      }
    }

    if (agentsError) throw new Error(agentsError.message);

    const agents = ((agentsRaw ?? []) as AgentRow[]).filter((agent) => agent.status === "active");
    if (agents.length === 0) {
      await supabase
        .from("community_agent_automation_runs")
        .update({ status: "completed", completed_at: new Date().toISOString(), skipped_count: 1, metadata: { reason: "no_active_agents" } })
        .eq("id", runId);
      return { ok: true, runId, dryRun, planned: 0, posted: 0, drafted: 0, skipped: 1, failed: 0, items: [] };
    }

    const [posts, cohortRooms] = await Promise.all([
      fetchRecentHumanPosts(supabase),
      fetchOpenCohortRooms(supabase),
    ]);

    const random = seededRandom(hashString(`${day}:${new Date().getUTCHours()}:automation-run`));
    const shuffledAgents = [...agents].sort(() => random() - 0.5);

    for (const agent of shuffledAgents) {
      if (items.length >= maxActions) break;

      const state = await ensureDailyState(supabase, agent, day);
      const action = chooseAction(agent, state, random);
      if (!action) {
        items.push({ agentSlug: agent.slug, action: "reaction", status: "skipped", reason: "daily_plan_complete" });
        continue;
      }

      try {
        const backingUserId = await ensureAgentIdentity(supabase, agent);
        let generated: GeneratedAction;

        if (action === "reaction") {
          const targetPostId = await chooseReactionTarget(supabase, backingUserId, posts, random);
          if (!targetPostId) {
            items.push({ agentSlug: agent.slug, action, status: "skipped", reason: "no_reaction_target" });
            continue;
          }
          generated = {
            targetType: "reaction",
            contentOrigin: "reaction",
            content: "like",
            targetPostId,
            confidence: 0.9,
            reason: "Recent human post fits the persona topics.",
          };
        } else if (action === "cohort_message" && cohortRooms.length === 0) {
          items.push({ agentSlug: agent.slug, action, status: "skipped", reason: "no_cohort_room" });
          continue;
        } else if ((action === "comment") && posts.length === 0) {
          items.push({ agentSlug: agent.slug, action, status: "skipped", reason: "no_recent_human_posts" });
          continue;
        } else {
          const generation = await generateAction({ agent, action, posts, cohortRooms, model });
          tokensInput += generation.tokensInput;
          tokensOutput += generation.tokensOutput;
          generated = generation.action;
        }

        if (generated.targetType === "comment" && !posts.some((post) => post.id === generated.targetPostId)) {
          generated.targetPostId = posts[Math.floor(random() * posts.length)]?.id;
        }
        if (generated.targetType === "cohort_message" && !cohortRooms.some((room) => room.id === generated.targetCohortRoomId)) {
          generated.targetCohortRoomId = cohortRooms[Math.floor(random() * cohortRooms.length)]?.id;
        }

        const { draft, safety } = await createDraft(supabase, {
          agent,
          action: generated,
          runId,
          actorUserId: options.actorUserId,
          autoPublish,
        });

        const canPublish = autoPublish && !dryRun && !safety.blocked && safety.status !== "source_required";
        if (!canPublish) {
          items.push({
            agentSlug: agent.slug,
            action,
            status: "drafted",
            draftId: draft.id,
            reason: dryRun ? "dry_run" : "needs_review",
            flags: safety.flags,
          });
          continue;
        }

        const posted = await publishDraft(supabase, draft, agent, options.actorUserId);
        await incrementDailyDone(supabase, state, action);
        items.push({
          agentSlug: agent.slug,
          action,
          status: "posted",
          draftId: draft.id,
          ...posted,
          flags: safety.flags,
        });
      } catch (error) {
        items.push({
          agentSlug: agent.slug,
          action,
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const posted = items.filter((item) => item.status === "posted").length;
    const drafted = items.filter((item) => item.status === "drafted").length;
    const skipped = items.filter((item) => item.status === "skipped").length;
    const failed = items.filter((item) => item.status === "failed").length;

    await supabase
      .from("community_agent_automation_runs")
      .update({
        status: failed > 0 && posted + drafted === 0 ? "failed" : "completed",
        completed_at: new Date().toISOString(),
        planned_count: items.length,
        published_count: posted,
        drafted_count: drafted,
        skipped_count: skipped,
        failed_count: failed,
        tokens_input: tokensInput,
        tokens_output: tokensOutput,
        metadata: {
          auto_publish: autoPublish,
          max_actions: maxActions,
          items,
        },
      })
      .eq("id", runId);

    return {
      ok: failed === 0 || posted + drafted > 0,
      runId,
      dryRun,
      planned: items.length,
      posted,
      drafted,
      skipped,
      failed,
      items,
    };
  } catch (error) {
    await supabase
      .from("community_agent_automation_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : String(error),
      })
      .eq("id", runId);

    return {
      ok: false,
      runId,
      dryRun,
      planned: items.length,
      posted: items.filter((item) => item.status === "posted").length,
      drafted: items.filter((item) => item.status === "drafted").length,
      skipped: items.filter((item) => item.status === "skipped").length,
      failed: items.filter((item) => item.status === "failed").length + 1,
      items,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
