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
type CommentIntent =
  | "first_response"
  | "empathy"
  | "clarifying_question"
  | "budget_compare"
  | "contract_check"
  | "checklist"
  | "summary_bridge";

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

interface RecentComment {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_id: string;
  content: string;
  upvote_count: number;
  created_at: string;
}

interface WritingBlueprint {
  category: CommunityCategory;
  origin: AgentContentOrigin;
  title: (topic: string) => string;
  body: (topic: string) => string;
  comment: (post: RecentPost, topic: string) => string;
}

interface DraftQualityReview {
  ok: boolean;
  score: number;
  issues: string[];
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
  commentIntent?: CommentIntent;
  qualityReview?: DraftQualityReview;
  modelUsed?: string;
  informationMode?: boolean;
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
const DEFAULT_INFORMATION_MODEL = "claude-sonnet-4-6";
const VALID_CATEGORIES: CommunityCategory[] = ["is_normal", "tour_review", "tips_v2", "ama", "free"];
const VALID_COMMENT_INTENTS: CommentIntent[] = [
  "first_response",
  "empathy",
  "clarifying_question",
  "budget_compare",
  "contract_check",
  "checklist",
  "summary_bridge",
];
const INFORMATION_AGENT_ROLES = new Set(["official_checker", "thread_summarizer", "contract_checker"]);
const POSTGRES_INT_MAX = 2_147_483_647;

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

function postgresIntSeed(input: string): number {
  return hashString(input) % POSTGRES_INT_MAX;
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

function hasBodyContent(input: string | null | undefined): boolean {
  return stripTags(input ?? "").length >= 2;
}

function plainTextLength(input: string | null | undefined): number {
  return stripTags(input ?? "").length;
}

function hasConversationalQuestion(input: string | null | undefined): boolean {
  const text = stripTags(input ?? "");
  return /[?？]|궁금|어떻게|어느 정도|뭐가|무엇|괜찮|맞을까요|할까요|해야 할까요|보시나요|알려주/.test(text);
}

function isLowQualityComment(input: string | null | undefined): boolean {
  const text = stripTags(input ?? "");
  if (text.length < 18) return true;
  if (/^(like|empty_content|본문 없음|댓글|좋아요)$/i.test(text)) return true;
  if (text.length < 42 && /(좋은 글|감사합니다|공감합니다|잘 봤어요|도움 됐어요|화이팅)/.test(text)) return true;
  return false;
}

function isLowQualityPost(action: GeneratedAction): boolean {
  const titleLength = plainTextLength(action.title);
  const contentLength = plainTextLength(action.content);
  if (action.contentOrigin === "comment" || action.contentOrigin === "reaction") return true;
  if (titleLength < 8 || contentLength < 55) return true;
  if (/^(like|empty_content|본문 없음)$/i.test(stripTags(action.content))) return true;
  if (action.contentOrigin === "question" && !hasConversationalQuestion(`${action.title ?? ""}\n${action.content}`)) return true;
  return false;
}

const GENERIC_COMMENT_RE = /(좋은 글|감사합니다|공감합니다|잘 봤어요|도움 됐어요|화이팅|맞아요|저도요)$/;
const USEFUL_CHECKPOINT_RE = /(확인|비교|포함|별도|추가금|계약|문서|환불|취소|기준|정리|나눠|물어보|체크|총액|일정)/;
const BUDGET_TOPIC_RE = /(가격|비용|견적|만원|추가금|총액|예산|대관료|식대|보증인원|옵션)/;
const CONTRACT_TOPIC_RE = /(계약|환불|취소|원본|수정본|헬퍼비|문서|약관|보증|포함|별도)/;
const EMOTION_TOPIC_RE = /(부모님|양가|서운|싸움|갈등|마음|스트레스|불안|고민|친구|혼주)/;
const TOKEN_STOPWORDS = new Set([
  "그리고",
  "그런데",
  "저도",
  "혹시",
  "보면",
  "같아요",
  "것",
  "수",
  "때",
  "좀",
  "진짜",
  "어떻게",
  "결혼",
  "준비",
]);

function normalizedTokens(input: string | null | undefined): Set<string> {
  const tokens = stripTags(input ?? "")
    .toLowerCase()
    .split(/[^0-9a-zA-Z가-힣]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !TOKEN_STOPWORDS.has(token));
  return new Set(tokens);
}

function overlapCount(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) count += 1;
  }
  return count;
}

function jaccardSimilarity(leftText: string | null | undefined, rightText: string | null | undefined): number {
  const left = normalizedTokens(leftText);
  const right = normalizedTokens(rightText);
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = overlapCount(left, right);
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function chooseCommentIntent(agent: AgentRow, post: RecentPost, comments: RecentComment[]): CommentIntent {
  const text = `${post.title}\n${stripTags(post.content)}\n${(post.tags ?? []).join(" ")}`;
  if (agent.role === "budget_realist" || BUDGET_TOPIC_RE.test(text)) return "budget_compare";
  if (agent.role === "contract_checker" || agent.role === "official_checker" || CONTRACT_TOPIC_RE.test(text)) return "contract_check";
  if (agent.role === "emotion_support" || EMOTION_TOPIC_RE.test(text)) return "empathy";
  if (comments.length === 0) return "first_response";
  if (agent.role === "thread_summarizer" || comments.length >= 4) return "summary_bridge";
  if (agent.role === "beginner_questioner" || agent.role === "cautious_questioner") return "clarifying_question";
  return "checklist";
}

function intentInstruction(intent: CommentIntent): string {
  const instructions: Record<CommentIntent, string> = {
    first_response: "첫 댓글처럼 글쓴이의 상황을 받아주고, 바로 답을 확정하지 말고 확인 질문 하나를 남긴다.",
    empathy: "감정 부담을 먼저 인정하고, 상대와 조율할 때 덜 부딪히는 말 꺼내기 질문을 덧붙인다.",
    clarifying_question: "글쓴이가 빠뜨렸을 수 있는 확인 질문 하나를 조심스럽게 묻는다.",
    budget_compare: "기본가보다 최종 총액, 포함 항목, 필수 추가금 관점으로 비교 포인트를 준다.",
    contract_check: "문서에 적힌 포함 항목, 별도 비용, 변경/취소 조건을 확인하도록 좁힌다.",
    checklist: "짧은 체크포인트 1-2개를 제안하고, 단정 대신 확인 순서를 묻는다.",
    summary_bridge: "이미 나온 댓글과 겹치지 않게 흐름을 한 문장으로 묶고 다음 확인 지점을 제안한다.",
  };
  return instructions[intent];
}

function reviewGeneratedDraft(input: {
  action: GeneratedAction;
  requestedAction: AutomationAction;
  targetPost: RecentPost | null;
  targetComments: RecentComment[];
  commentIntent: CommentIntent | null;
}): DraftQualityReview {
  const issues: string[] = [];
  const action = input.action;

  if (input.requestedAction === "comment") {
    if (action.targetType !== "comment") issues.push("not_a_comment");
    if (!input.targetPost) issues.push("missing_target_post");
    if (isLowQualityComment(action.content)) issues.push("low_quality_comment");
    if (!hasConversationalQuestion(action.content) && !USEFUL_CHECKPOINT_RE.test(stripTags(action.content))) {
      issues.push("no_question_or_checkpoint");
    }
    if (GENERIC_COMMENT_RE.test(stripTags(action.content))) issues.push("generic_filler");

    if (input.targetPost) {
      const postTokens = normalizedTokens(`${input.targetPost.title} ${input.targetPost.content} ${(input.targetPost.tags ?? []).join(" ")}`);
      const commentTokens = normalizedTokens(action.content);
      if (overlapCount(postTokens, commentTokens) === 0 && !USEFUL_CHECKPOINT_RE.test(stripTags(action.content))) {
        issues.push("not_grounded_in_post");
      }
    }

    const duplicate = input.targetComments.some((comment) => jaccardSimilarity(comment.content, action.content) >= 0.5);
    if (duplicate) issues.push("duplicates_existing_comment");
  } else if (input.requestedAction === "post") {
    if (action.targetType !== "post") issues.push("not_a_post");
    if (isLowQualityPost(action)) issues.push("low_quality_post");
    if (!hasConversationalQuestion(`${action.title ?? ""}\n${action.content}`)) issues.push("post_has_no_community_question");
  }

  if (/^(like|empty_content|본문 없음)$/i.test(stripTags(action.content))) issues.push("placeholder_content");

  const uniqueIssues = [...new Set(issues)];
  const score = Math.max(0, 1 - uniqueIssues.length * 0.18);
  return { ok: uniqueIssues.length === 0, score, issues: uniqueIssues };
}

const CATEGORY_LABELS: Record<CommunityCategory, string> = {
  is_normal: "정상인가요?",
  tour_review: "후기",
  tips_v2: "꿀팁",
  ama: "선배 Q&A",
  free: "자유",
};

const DEFAULT_BLUEPRINT: WritingBlueprint = {
  category: "free",
  origin: "question",
  title: (topic) => `${topic} 준비할 때 기준을 어떻게 잡으세요?`,
  body: (topic) =>
    `${topic} 쪽을 알아보고 있는데 어디까지 확인해야 충분한 건지 아직 감이 잘 안 와요.\n\n견적이나 계약 전에 꼭 나눠서 봐야 하는 항목이 있으면 같이 정리해보고 싶어요.`,
  comment: (post, topic) =>
    `${post.title}에서 말한 부분이 저도 헷갈릴 것 같아요. ${topic} 기준으로 보면 포함 항목이랑 별도 비용을 먼저 나눠서 확인하는 게 좋지 않을까요?`,
};

const ROLE_BLUEPRINTS: Record<string, Partial<WritingBlueprint>> = {
  cautious_questioner: {
    title: (topic) => `${topic} 이 정도까지 확인해야 할까요?`,
    body: (topic) =>
      `${topic} 관련해서 찾아볼수록 기준이 더 헷갈려요.\n\n확정하기 전에 꼭 물어봐야 하는 항목이 있다면 어떤 것부터 보면 좋을까요? 너무 기본적인 질문일 수도 있는데 놓치고 싶지 않아서요.`,
    comment: (post) =>
      `${post.title} 보니까 저도 비슷하게 헷갈릴 것 같아요. 혹시 안내받은 내용 중에 포함/별도 비용이 나뉘어 적힌 부분이 있었나요?`,
  },
  budget_realist: {
    title: (topic) => `${topic} 비용은 총액 기준으로 봐야 할까요?`,
    body: (topic) =>
      `${topic} 견적을 볼 때 기본가만 보면 판단이 잘 안 되는 것 같아요.\n\n옵션, 추가금, 별도 결제 항목까지 합친 최종 금액 기준으로 비교하려면 어떤 항목을 먼저 체크해야 할까요?`,
    comment: (post) =>
      `${post.title}이면 기본가보다 마지막 총액이 더 중요해 보여요. 포함 항목, 필수 추가금, 선택 옵션을 따로 나눠보면 비교가 조금 쉬워질 것 같아요.`,
  },
  contract_checker: {
    category: "tips_v2",
    origin: "checklist",
    title: () => "계약 전 문서에서 꼭 봐야 하는 항목 뭐가 있을까요?",
    body: () =>
      `계약 전에는 말로 들은 안내보다 문서에 적힌 조건을 따로 확인해야 할 것 같아요.\n\n제가 보기엔 포함 항목, 취소/환불 기준, 원본·수정본·헬퍼비 같은 별도 비용을 나눠보는 게 먼저인데, 혹시 더 봐야 할 항목이 있을까요?`,
    comment: (post) =>
      `${post.title} 내용이면 계약서 문구로 다시 확인해보는 게 안전해 보여요. 포함 항목과 별도 비용이 같은 페이지에 적혀 있는지도 같이 보면 좋을 것 같아요.`,
  },
  emotion_support: {
    title: (topic) => `${topic} 때문에 마음이 쓰일 때 어떻게 말 꺼내세요?`,
    body: (topic) =>
      `${topic} 문제는 비용이나 일정보다 말 꺼내는 방식이 더 어렵게 느껴질 때가 있는 것 같아요.\n\n상대가 서운하지 않게 기준을 맞추려면 어떤 식으로 먼저 이야기하는 게 좋을까요?`,
    comment: (post) =>
      `${post.title}은 답을 정하는 것보다 서로 부담을 덜 느끼게 말하는 게 먼저일 것 같아요. 기준을 같이 정해보자고 꺼내면 조금 덜 부딪히지 않을까요?`,
  },
  beginner_questioner: {
    title: (topic) => `${topic} 초보가 먼저 알아야 할 게 뭐예요?`,
    body: (topic) =>
      `${topic} 용어부터 헷갈려서 뭘 먼저 물어봐야 할지도 잘 모르겠어요.\n\n처음 알아보는 입장에서 계약이나 견적 전에 꼭 확인해야 하는 기본 질문이 있다면 알려주세요.`,
    comment: (post) =>
      `${post.title} 보니까 저도 용어부터 다시 봐야겠다는 생각이 들어요. 처음 확인할 때 포함 항목이랑 추가 비용을 따로 물어보는 게 맞을까요?`,
  },
  thread_summarizer: {
    category: "tips_v2",
    origin: "summary",
    title: () => "요즘 글들 보면 먼저 확인할 포인트가 보이는 것 같아요",
    body: () =>
      `최근 커뮤니티 글들을 보면 준비 단계마다 헷갈리는 지점이 꽤 비슷한 것 같아요.\n\n1. 기본가와 최종 결제액을 따로 보기\n2. 말로 들은 조건은 문서로 다시 확인하기\n3. 일정, 비용, 양가 조율을 한 번에 묶지 말고 나눠서 결정하기\n\n이 세 가지를 먼저 정리하면 다음 질문이 조금 선명해질 것 같아요.`,
    comment: (post) =>
      `${post.title}에서 핵심은 조건을 한 번에 보지 말고 나눠서 확인하는 것 같아요. 지금 나온 내용만 보면 비용, 포함 항목, 결정 시점을 따로 정리하면 좋겠습니다.`,
  },
  official_checker: {
    category: "tips_v2",
    origin: "checklist",
    title: () => "계약 전 확인하면 좋은 체크포인트 정리",
    body: () =>
      `계약 전에는 감으로 결정하기보다 확인 항목을 나눠보는 편이 안전합니다.\n\n- 기본 금액과 필수 추가금을 분리하기\n- 포함 항목과 별도 결제 항목을 문서로 확인하기\n- 취소, 변경, 환불 조건을 저장해두기\n- 일정 변경 시 비용이 생기는지 물어보기\n\n비용 이야기는 기준이 분명할 때만 비교하는 게 좋습니다.`,
    comment: (post) =>
      `${post.title}은 계약 전 확인 항목으로 정리해볼 수 있어요. 포함 항목, 별도 비용, 변경 조건을 각각 문서로 확인하면 판단이 더 안전합니다.`,
  },
};

function blueprintFor(agent: AgentRow): WritingBlueprint {
  return { ...DEFAULT_BLUEPRINT, ...(ROLE_BLUEPRINTS[agent.role] ?? {}) };
}

function pickTopic(agent: AgentRow, random: () => number): string {
  const topics = agent.behavior.topics?.filter(Boolean) ?? [];
  return topics[Math.floor(random() * topics.length)] ?? "결혼 준비";
}

function topicScore(agent: AgentRow, post: RecentPost): number {
  const haystack = `${post.title} ${stripTags(post.content)} ${(post.tags ?? []).join(" ")}`.toLowerCase();
  return (agent.behavior.topics ?? []).reduce((score, topic) => {
    const normalized = topic.toLowerCase();
    return haystack.includes(normalized) ? score + 1 : score;
  }, 0);
}

function isInformationPostRequest(agent: AgentRow, action: AutomationAction): boolean {
  return action === "post" && (agent.public_mode === "official" || INFORMATION_AGENT_ROLES.has(agent.role));
}

function hasRequiredSourcePolicy(agent: AgentRow): boolean {
  return agent.safety?.sourcePolicy === "required";
}

function enforceInformationPostPolicy(
  agent: AgentRow,
  requestedAction: AutomationAction,
  informationMode: boolean,
  action: GeneratedAction
): GeneratedAction {
  if (!informationMode || requestedAction !== "post" || action.targetType !== "post") return action;

  const requiresSources = hasRequiredSourcePolicy(agent);
  const policyReason = requiresSources ? "source_required_information_policy" : "information_post_policy";
  const currentReason = action.reason ?? "";

  return {
    ...action,
    contentOrigin: requiresSources
      ? "news"
      : action.contentOrigin === "question"
        ? "checklist"
        : action.contentOrigin,
    category: requiresSources && (!action.category || action.category === "free") ? "tips_v2" : action.category,
    sourceUrls: action.sourceUrls ?? [],
    reason: currentReason.includes(policyReason) ? currentReason : [currentReason, policyReason].filter(Boolean).join(" | "),
  };
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

function chooseDryRunAction(
  agent: AgentRow,
  items: AutomationResultItem[],
  posts: RecentPost[],
  cohortRooms: Array<{ id: string; name: string; message_count: number }>
): AutomationAction {
  const successfulPosts = items.filter((item) => item.action === "post" && item.status === "drafted").length;
  const attemptedPosts = items.filter((item) => item.action === "post").length;
  const successfulComments = items.filter((item) => item.action === "comment" && item.status === "drafted").length;
  const postWeight = agent.behavior.actionWeights?.post ?? 0;

  if (successfulPosts < 2 && attemptedPosts < 4 && postWeight > 0.04) return "post";
  if (posts.length > 0 && successfulComments < 2) return "comment";
  if (cohortRooms.length > 0 && (agent.behavior.actionWeights?.summarize ?? 0) > 0.12) return "cohort_message";
  return posts.length > 0 ? "reaction" : "post";
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
      seed: postgresIntSeed(`${day}:${agent.slug}`),
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

  if (raw.targetType !== "reaction" && !hasBodyContent(content)) {
    throw new Error("empty_generated_content");
  }

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
        comment_intent: raw.commentIntent ?? null,
        quality_review: raw.qualityReview ?? null,
        model_used: raw.modelUsed ?? null,
        information_mode: raw.informationMode ?? false,
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
  if (draft.target_type !== "reaction" && !hasBodyContent(draft.content)) {
    throw new Error("empty_content");
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

async function fetchCommunityPosts(supabase: SupabaseClient, agentUserIds: string[]): Promise<RecentPost[]> {
  const { data, error } = await supabase
    .from("community_posts")
    .select("id,title,content,category,tags,comment_count,upvote_count,created_at,author_id")
    .eq("visibility", "public")
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) {
    if (isMissingTableError(error)) throw new Error("community_agent_migration_missing");
    throw new Error(error.message);
  }

  const rows = ((data ?? []) as RecentPost[]).filter((post) => hasBodyContent(post.title) && hasBodyContent(post.content));
  const agentUserIdSet = new Set(agentUserIds);
  const humanPosts = rows.filter((post) => !agentUserIdSet.has(post.author_id));
  return humanPosts.length > 0 ? humanPosts : rows;
}

async function fetchPostComments(supabase: SupabaseClient, postId: string): Promise<RecentComment[]> {
  const { data, error } = await supabase
    .from("community_comments")
    .select("id,post_id,parent_id,author_id,content,upvote_count,created_at")
    .eq("post_id", postId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: true })
    .limit(24);

  if (error) {
    if (isMissingTableError(error)) throw new Error("community_agent_migration_missing");
    throw new Error(error.message);
  }

  return ((data ?? []) as RecentComment[]).filter((comment) => hasBodyContent(comment.content));
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
  const candidates = posts.filter((post) => post.author_id !== agentUserId && !alreadyLiked.has(post.id));
  if (candidates.length === 0) return null;

  return candidates[Math.floor(random() * candidates.length)]?.id ?? null;
}

async function chooseCommentTarget(
  supabase: SupabaseClient,
  agentUserId: string,
  posts: RecentPost[],
  random: () => number,
  agent: AgentRow
): Promise<RecentPost | null> {
  const postIds = posts.map((post) => post.id);
  if (postIds.length === 0) return null;

  const { data: comments } = await supabase
    .from("community_comments")
    .select("post_id")
    .eq("author_id", agentUserId)
    .in("post_id", postIds);

  const alreadyCommented = new Set((comments ?? []).map((comment) => comment.post_id as string));
  const candidates = posts.filter((post) => post.author_id !== agentUserId && !alreadyCommented.has(post.id));
  if (candidates.length === 0) return null;

  return [...candidates]
    .sort((left, right) => {
      const leftScore =
        topicScore(agent, left) * 8 +
        (left.comment_count === 0 ? 5 : Math.max(0, 4 - left.comment_count)) +
        (left.upvote_count > 0 ? 1 : 0) +
        random();
      const rightScore =
        topicScore(agent, right) * 8 +
        (right.comment_count === 0 ? 5 : Math.max(0, 4 - right.comment_count)) +
        (right.upvote_count > 0 ? 1 : 0) +
        random();
      return rightScore - leftScore;
    })[0] ?? null;
}

function parseGeneratedAction(text: string, fallbackAction: AutomationAction): GeneratedAction {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
  let parsed: Partial<GeneratedAction>;
  try {
    parsed = JSON.parse(jsonText) as Partial<GeneratedAction>;
  } catch {
    parsed = {};
  }
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
    commentIntent: VALID_COMMENT_INTENTS.includes(parsed.commentIntent as CommentIntent)
      ? (parsed.commentIntent as CommentIntent)
      : undefined,
  };
}

function fallbackPost(agent: AgentRow, random: () => number): GeneratedAction {
  if (hasRequiredSourcePolicy(agent)) {
    const topic = pickTopic(agent, random);
    return {
      targetType: "post",
      contentOrigin: "news",
      category: "tips_v2",
      title: `${topic} 이슈는 출처 확인 후 정리할게요`,
      content: [
        `${topic} 관련 내용은 뉴스·통계·정책처럼 단정될 수 있어서, 확인된 출처 없이 바로 정리하지 않겠습니다.`,
        "",
        "관리자가 먼저 확인할 부분",
        "- 원문 기사나 공식 기관 자료 링크",
        "- 적용 시점과 지역",
        "- 예비부부가 계약 전에 확인할 체크포인트",
        "",
        "출처가 확인되면 핵심만 짧게 다시 정리해 올릴게요.",
      ].join("\n"),
      sourceUrls: [],
      confidence: 0.52,
      reason: "Source-required information fallback pending admin source review.",
    };
  }

  const topic = pickTopic(agent, random);
  const blueprint = blueprintFor(agent);
  return {
    targetType: "post",
    contentOrigin: blueprint.origin,
    category: blueprint.category,
    title: blueprint.title(topic),
    content: blueprint.body(topic),
    sourceUrls: [],
    confidence: 0.68,
    reason: "Persona blueprint fallback for a safe community post.",
  };
}

function fallbackComment(agent: AgentRow, targetPost: RecentPost | null, random: () => number, intent?: CommentIntent | null): string {
  const topic = pickTopic(agent, random);
  if (!targetPost) {
    return blueprintFor(agent).comment({ id: "", title: topic, content: "", category: "free", tags: [], comment_count: 0, upvote_count: 0, created_at: "", author_id: "" }, topic);
  }
  const title = targetPost.title;
  if (intent === "budget_compare") {
    return `${title}이면 기본가보다 마지막에 실제로 내는 총액을 먼저 나눠보면 좋을 것 같아요. 포함 항목, 필수 추가금, 선택 옵션을 따로 적어두면 비교가 조금 더 쉬워지지 않을까요?`;
  }
  if (intent === "contract_check") {
    return `${title} 내용이면 말로 들은 안내보다 문서에 적힌 조건을 다시 보는 게 안전해 보여요. 포함 항목, 별도 비용, 변경/취소 조건이 각각 적혀 있는지 먼저 확인해보면 어떨까요?`;
  }
  if (intent === "empathy") {
    return `${title}은 정답을 바로 고르기보다 서로 부담을 덜 느끼게 말 꺼내는 게 먼저일 것 같아요. 기준을 같이 정해보자고 시작하면 조금 덜 부딪히지 않을까요?`;
  }
  if (intent === "summary_bridge") {
    return `${title}에서 나온 이야기는 조건을 한 번에 보지 말고 나눠서 확인하는 쪽으로 정리할 수 있을 것 같아요. 비용, 포함 항목, 결정 시점을 따로 적어보면 다음 선택이 조금 선명해질 것 같습니다.`;
  }
  if (intent === "first_response" || intent === "clarifying_question") {
    return `${title} 보니까 저도 먼저 기준을 나눠서 봐야겠다는 생각이 들어요. 지금 받은 안내에서 포함 항목이랑 별도 비용이 따로 적혀 있었는지 확인해보셨나요?`;
  }
  return blueprintFor(agent).comment(targetPost, topic);
}

function fallbackCohortMessage(agent: AgentRow): string {
  const topic = agent.behavior.topics?.[0] ?? "준비 상황";
  return `${topic} 쪽은 각자 기준이 다를 수 있어서, 포함 항목과 별도 비용을 먼저 나눠보면 좋을 것 같아요.`;
}

function personaDirective(agent: AgentRow, action: AutomationAction): string {
  const role = agent.role;
  const tone = typeof agent.profile.tone === "string" ? agent.profile.tone : "자연스러운 말투";
  const commentStyle = agent.behavior.commentStyle ?? "글쓴이 상황에 맞춰 짧고 유용하게 반응한다";
  const common = `말투: ${tone}. 댓글 스타일: ${commentStyle}. 샘플 말투: ${(agent.sample_lines ?? []).slice(0, 2).join(" / ")}`;

  const roleGuide: Record<string, string> = {
    cautious_questioner: "확신을 단정하지 말고, 글쓴이가 놓칠 수 있는 확인 질문을 하나만 덧붙인다.",
    budget_realist: "기본가가 아니라 최종 총액, 포함 항목, 필수 추가금 관점으로 말한다.",
    contract_checker: "계약서/문서/포함 항목/별도 비용 확인으로 대화를 좁힌다. 법률 조언처럼 단정하지 않는다.",
    emotion_support: "먼저 감정을 인정하고, 상대에게 덜 부담스러운 말 꺼내기 방식으로 이어간다.",
    beginner_questioner: "초보가 실제로 헷갈릴 만한 용어와 첫 질문을 자연스럽게 묻는다.",
    thread_summarizer: "커뮤니티에 나온 이야기만 근거로 짧게 구조화한다. 없는 내용을 추가하지 않는다.",
    official_checker: "운영형으로 체크리스트를 제공하되 개인 경험처럼 말하지 않는다.",
  };

  const actionGuide =
    action === "comment"
      ? "댓글은 선택된 글의 제목/본문 중 구체적인 한 부분에 반응해야 한다. 일반론만 쓰지 말고, 공감 1문장 + 확인 질문/체크포인트 1-2문장으로 작성한다."
      : action === "post"
        ? "게시글은 실제 경험담을 꾸미지 않는다. 현실적인 고민 상황 1개, 왜 헷갈리는지 1개, 커뮤니티에 묻는 질문 1-2개를 포함한다."
        : "해당 공간의 흐름을 정리하거나 조심스럽게 질문한다.";

  return [common, roleGuide[role] ?? "페르소나의 주제와 말투를 유지한다.", actionGuide].join(" ");
}

async function generateAction(input: {
  agent: AgentRow;
  action: AutomationAction;
  posts: RecentPost[];
  cohortRooms: Array<{ id: string; name: string; message_count: number }>;
  targetPost?: RecentPost | null;
  targetComments?: RecentComment[];
  commentIntent?: CommentIntent | null;
  informationMode?: boolean;
  model: string;
}): Promise<{ action: GeneratedAction; tokensInput: number; tokensOutput: number; rawText: string; latencyMs: number }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY_missing");
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const orderedPosts = input.targetPost
    ? [input.targetPost, ...input.posts.filter((post) => post.id !== input.targetPost?.id)]
    : input.posts;
  const postContext = orderedPosts.slice(0, 12).map((post) => ({
    id: post.id,
    title: post.title,
    category: post.category,
    categoryLabel: CATEGORY_LABELS[post.category],
    tags: post.tags ?? [],
    comments: post.comment_count,
    likes: post.upvote_count,
    body: stripTags(post.content).slice(0, 520),
  }));
  const commentContext = (input.targetComments ?? []).slice(-12).map((comment) => ({
    id: comment.id,
    parentId: comment.parent_id,
    authorKind: comment.author_id === input.agent.backing_user_id ? "same_agent" : "community_member",
    likes: comment.upvote_count,
    body: stripTags(comment.content).slice(0, 280),
  }));

  const system = [
    "You operate one Korean wedding community persona.",
    "Write like a real Korean 예비부부 community member: specific, warm, slightly imperfect, and useful.",
    "Never invent a personal visit, contract, quote, booking, payment, vendor recommendation, or first-hand review.",
    "For comments, you must respond to the selected target post, not to the general topic.",
    "If you do not know, ask a careful question or give a checklist-style next step.",
    "Numeric, statistical, legal, policy, or news claims require HTTPS source URLs. Without sources, avoid those claims.",
    input.informationMode
      ? "This is an informational/news post request. Use the higher-trust mode: no hallucinations, no unsourced facts, say you do not know or that verification is needed when sources are missing, and include only HTTPS sourceUrls you are certain support the claim. If the persona sourcePolicy is required, do not turn the post into a casual question-only draft; use contentOrigin news, clearly state what still needs verification when sources are missing, and leave sourceUrls empty rather than inventing sources."
      : "",
    "Return valid JSON only. No markdown outside JSON.",
  ].filter(Boolean).join(" ");

  const user = JSON.stringify({
    desiredAction: input.action,
    informationMode: input.informationMode ?? false,
    outputSchema: {
      targetType: "post | comment | cohort_message",
      contentOrigin: "question | comment | summary | checklist | news",
      category: "free | tips_v2 | tour_review | is_normal | ama",
      targetPostId: input.targetPost ? `for comment, MUST be exactly ${input.targetPost.id}` : "required for comment",
      targetCohortRoomId: "required for cohort_message",
      title: "required for post",
      content: "plain Korean text or simple paragraphs",
      commentIntent: "required for comment",
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
      safety: input.agent.safety,
      sampleLines: input.agent.sample_lines?.slice(0, 2),
    },
    personaDirective: personaDirective(input.agent, input.action),
    commentIntent: input.commentIntent,
    commentIntentInstruction: input.commentIntent ? intentInstruction(input.commentIntent) : null,
    selectedTargetPost: input.targetPost
      ? {
          id: input.targetPost.id,
          title: input.targetPost.title,
          category: input.targetPost.category,
          body: stripTags(input.targetPost.content).slice(0, 900),
          comments: input.targetPost.comment_count,
          likes: input.targetPost.upvote_count,
        }
      : null,
    existingCommentsOnSelectedPost: commentContext,
    communityPosts: postContext,
    cohortRooms: input.cohortRooms,
    qualityBar: {
      comment: [
        "2-4 Korean sentences.",
        "First sentence must acknowledge the writer's concrete situation.",
        "Add one useful question, comparison point, or checklist item.",
        "Do not say '좋은 글 감사합니다' or generic filler.",
        "Do not pretend you visited, contracted, paid, or received a quote.",
        "Do not repeat an existing comment. Add a new angle based on the selected commentIntent.",
      ],
      post: [
        "Title should be natural and specific, 18-45 Korean chars.",
        "Content should be 4-8 short lines.",
        "Include one realistic dilemma, one concrete checkpoint, and one question to the community.",
        "No fake first-person vendor experience.",
        "No unsupported price averages or vendor ranking.",
        input.informationMode
          ? "For information posts, use Sonnet-level caution: if source-backed facts are unavailable, explicitly write that exact figures/news could not be verified. For sourcePolicy=required, contentOrigin must be news and sourceUrls must be real HTTPS URLs or an empty array for admin review."
          : "Question posts can stay personal and cautious without factual claims.",
      ],
    },
    constraints: {
      maxPostTitleChars: 72,
      maxCommentChars: 420,
      maxPostChars: 1100,
      avoid: [
        "fake first-person experience",
        "vendor ranking without source",
        "medical/legal/financial certainty",
        "repeating another agent",
        "empty content",
        "generic sympathy with no connection to the target post",
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
      selected_target_post_id: input.targetPost?.id ?? null,
      selected_comment_intent: input.commentIntent ?? null,
      context_comment_count: commentContext.length,
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

async function reviseGeneratedAction(input: {
  agent: AgentRow;
  requestedAction: AutomationAction;
  draft: GeneratedAction;
  review: DraftQualityReview;
  targetPost: RecentPost | null;
  targetComments: RecentComment[];
  commentIntent: CommentIntent | null;
  informationMode?: boolean;
  model: string;
}): Promise<{ action: GeneratedAction; tokensInput: number; tokensOutput: number; rawText: string; latencyMs: number }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY_missing");
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const system = [
    "You are revising one Korean wedding community persona draft.",
    "Fix only the quality issues. Keep the persona voice and stay grounded in the selected post and existing comments.",
    "Never invent a personal visit, contract, quote, booking, payment, vendor recommendation, or first-hand review.",
    input.informationMode
      ? "This is an informational post revision. No hallucinations. If a fact, news item, statistic, legal/policy point, or average cost is not backed by a certain HTTPS source URL, say it is not verified or remove it. If the persona sourcePolicy is required, keep contentOrigin as news and never invent sources."
      : "",
    "Return valid JSON only.",
  ].filter(Boolean).join(" ");

  const user = JSON.stringify({
    requestedAction: input.requestedAction,
    informationMode: input.informationMode ?? false,
    reviewIssues: input.review.issues,
    reviewScore: input.review.score,
    originalDraft: input.draft,
    persona: {
      publicNickname: input.agent.public_nickname,
      role: input.agent.role,
      profile: input.agent.profile,
      safety: input.agent.safety,
      sampleLines: input.agent.sample_lines?.slice(0, 2),
    },
    commentIntent: input.commentIntent,
    commentIntentInstruction: input.commentIntent ? intentInstruction(input.commentIntent) : null,
    selectedTargetPost: input.targetPost
      ? {
          id: input.targetPost.id,
          title: input.targetPost.title,
          body: stripTags(input.targetPost.content).slice(0, 900),
          tags: input.targetPost.tags ?? [],
        }
      : null,
    existingCommentsOnSelectedPost: input.targetComments.slice(-12).map((comment) => ({
      id: comment.id,
      body: stripTags(comment.content).slice(0, 260),
    })),
    outputSchema: {
      targetType: input.requestedAction === "post" ? "post" : input.requestedAction === "comment" ? "comment" : input.draft.targetType,
      contentOrigin: input.requestedAction === "comment"
        ? "comment"
        : input.informationMode && hasRequiredSourcePolicy(input.agent)
          ? "news"
          : "question | checklist | summary | news",
      category: "free | tips_v2 | tour_review | is_normal | ama",
      targetPostId: input.targetPost ? input.targetPost.id : undefined,
      title: input.requestedAction === "post" ? "required" : undefined,
      content: "improved Korean text",
      commentIntent: input.commentIntent,
      sourceUrls: input.informationMode ? "real HTTPS URLs only, or [] when verification is still needed" : [],
      confidence: "0 to 1",
      reason: "what was improved",
    },
  });

  const startedAt = startLatencyClock();
  const message = await anthropic.messages.create({
    model: input.model,
    max_tokens: 480,
    temperature: 0.58,
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
      stage: "revision",
      agent_id: input.agent.id,
      agent_slug: input.agent.slug,
      desired_action: input.requestedAction,
      selected_target_post_id: input.targetPost?.id ?? null,
      selected_comment_intent: input.commentIntent ?? null,
      review_issues: input.review.issues,
    },
  });

  return {
    action: parseGeneratedAction(rawText, input.requestedAction),
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
  const informationModel = process.env.COMMUNITY_AGENT_INFORMATION_MODEL ?? DEFAULT_INFORMATION_MODEL;
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
      metadata: { auto_publish: autoPublish, max_actions: maxActions, information_model: informationModel },
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

    const activeAgentUserIds = agents
      .map((agent) => agent.backing_user_id)
      .filter((id): id is string => Boolean(id));

    const [posts, cohortRooms] = await Promise.all([
      fetchCommunityPosts(supabase, activeAgentUserIds),
      fetchOpenCohortRooms(supabase),
    ]);

    const random = seededRandom(hashString(`${day}:${new Date().getUTCHours()}:automation-run`));
    const shuffledAgents = dryRun
      ? [...agents].sort((left, right) => {
          const postDelta = (right.behavior.actionWeights?.post ?? 0) - (left.behavior.actionWeights?.post ?? 0);
          if (postDelta !== 0) return postDelta;
          return hashString(`${day}:${left.slug}:dry-run-order`) - hashString(`${day}:${right.slug}:dry-run-order`);
        })
      : [...agents].sort(() => random() - 0.5);

    for (const agent of shuffledAgents) {
      if (items.length >= maxActions) break;

      const state = dryRun ? null : await ensureDailyState(supabase, agent, day);
      const action = dryRun ? chooseDryRunAction(agent, items, posts, cohortRooms) : chooseAction(agent, state as DailyState, random);
      if (!action) {
        items.push({ agentSlug: agent.slug, action: "reaction", status: "skipped", reason: "daily_plan_complete" });
        continue;
      }

      try {
        const backingUserId = await ensureAgentIdentity(supabase, agent);
        let generated: GeneratedAction;
        let selectedTargetPost: RecentPost | null = null;
        let targetComments: RecentComment[] = [];
        let commentIntent: CommentIntent | null = null;
        const informationMode = isInformationPostRequest(agent, action);
        const selectedModel = informationMode ? informationModel : model;

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
          items.push({ agentSlug: agent.slug, action, status: "skipped", reason: "no_community_posts" });
          continue;
        } else {
          if (action === "comment") {
            selectedTargetPost = await chooseCommentTarget(supabase, backingUserId, posts, random, agent);
            if (!selectedTargetPost) {
              items.push({ agentSlug: agent.slug, action, status: "skipped", reason: "no_comment_target" });
              continue;
            }
            targetComments = await fetchPostComments(supabase, selectedTargetPost.id);
            commentIntent = chooseCommentIntent(agent, selectedTargetPost, targetComments);
          }

          const generation = await generateAction({
            agent,
            action,
            posts,
            cohortRooms,
            targetPost: selectedTargetPost,
            targetComments,
            commentIntent,
            informationMode,
            model: selectedModel,
          });
          tokensInput += generation.tokensInput;
          tokensOutput += generation.tokensOutput;
          generated = generation.action;
        }

        if (action === "post" && generated.targetType !== "post") {
          generated = {
            ...generated,
            targetType: "post",
            targetPostId: undefined,
            targetCommentId: undefined,
            targetCohortRoomId: undefined,
          };
        }
        if (action === "comment") {
          if (!selectedTargetPost) {
            selectedTargetPost = posts.find((post) => post.id === generated.targetPostId) ?? null;
          }
          if (!selectedTargetPost) {
            items.push({ agentSlug: agent.slug, action, status: "skipped", reason: "missing_comment_target" });
            continue;
          }
          generated = {
            ...generated,
            targetType: "comment",
            contentOrigin: "comment",
            category: undefined,
            title: undefined,
            targetPostId: selectedTargetPost.id,
            targetCommentId: undefined,
            targetCohortRoomId: undefined,
            commentIntent: commentIntent ?? generated.commentIntent,
          };
        }
        if (generated.targetType === "cohort_message" && !cohortRooms.some((room) => room.id === generated.targetCohortRoomId)) {
          generated.targetCohortRoomId = cohortRooms[Math.floor(random() * cohortRooms.length)]?.id;
        }
        if (generated.targetType === "comment" && !generated.targetPostId) {
          items.push({ agentSlug: agent.slug, action, status: "skipped", reason: "missing_comment_target" });
          continue;
        }
        if (generated.targetType === "cohort_message" && !generated.targetCohortRoomId) {
          items.push({ agentSlug: agent.slug, action, status: "skipped", reason: "missing_cohort_target" });
          continue;
        }
        if (generated.targetType !== "reaction" && !hasBodyContent(generated.content)) {
          if (generated.targetType === "comment") {
            generated.content = fallbackComment(agent, selectedTargetPost, random, commentIntent);
          } else if (generated.targetType === "cohort_message") {
            generated.content = fallbackCohortMessage(agent);
          } else {
            generated = fallbackPost(agent, random);
          }
        }
        if (generated.targetType === "comment" && isLowQualityComment(generated.content)) {
          generated.content = fallbackComment(agent, selectedTargetPost, random, commentIntent);
        }
        if (generated.targetType === "post" && isLowQualityPost(generated)) {
          generated = fallbackPost(agent, random);
        }
        if (generated.targetType === "post" && !hasBodyContent(generated.title)) {
          const replacement = fallbackPost(agent, random);
          generated = {
            ...replacement,
            content: hasBodyContent(generated.content) ? generated.content : replacement.content,
            contentOrigin:
              generated.contentOrigin !== "comment" && generated.contentOrigin !== "reaction"
                ? generated.contentOrigin
                : replacement.contentOrigin,
          };
        }

        generated = enforceInformationPostPolicy(agent, action, informationMode, generated);

        if (generated.targetType === "comment" || generated.targetType === "post") {
          generated.modelUsed = selectedModel;
          generated.informationMode = informationMode;
          let qualityReview = reviewGeneratedDraft({
            action: generated,
            requestedAction: action,
            targetPost: selectedTargetPost,
            targetComments,
            commentIntent,
          });

          if (!qualityReview.ok) {
            try {
              const revision = await reviseGeneratedAction({
                agent,
                requestedAction: action,
                draft: generated,
                review: qualityReview,
                targetPost: selectedTargetPost,
                targetComments,
                commentIntent,
                informationMode,
                model: selectedModel,
              });
              tokensInput += revision.tokensInput;
              tokensOutput += revision.tokensOutput;

              if (action === "comment" && selectedTargetPost) {
                generated = {
                  ...generated,
                  ...revision.action,
                  targetType: "comment",
                  contentOrigin: "comment",
                  category: undefined,
                  title: undefined,
                  targetPostId: selectedTargetPost.id,
                  targetCommentId: undefined,
                  targetCohortRoomId: undefined,
                  commentIntent: commentIntent ?? revision.action.commentIntent ?? generated.commentIntent,
                };
              } else if (action === "post") {
                generated = {
                  ...generated,
                  ...revision.action,
                  targetType: "post",
                  targetPostId: undefined,
                  targetCommentId: undefined,
                  targetCohortRoomId: undefined,
                };
              }
            } catch {
              qualityReview = {
                ok: false,
                score: qualityReview.score,
                issues: [...new Set([...qualityReview.issues, "revision_failed"])],
              };
            }

            if (generated.targetType !== "reaction" && !hasBodyContent(generated.content)) {
              if (generated.targetType === "comment") {
                generated.content = fallbackComment(agent, selectedTargetPost, random, commentIntent);
              } else {
                generated = fallbackPost(agent, random);
              }
            }
            if (generated.targetType === "comment" && isLowQualityComment(generated.content)) {
              generated.content = fallbackComment(agent, selectedTargetPost, random, commentIntent);
            }
            if (generated.targetType === "post" && isLowQualityPost(generated)) {
              generated = fallbackPost(agent, random);
            }

            qualityReview = reviewGeneratedDraft({
              action: generated,
              requestedAction: action,
              targetPost: selectedTargetPost,
              targetComments,
              commentIntent,
            });
          }

          if (!qualityReview.ok) {
            if (action === "comment" && selectedTargetPost) {
              generated = {
                targetType: "comment",
                contentOrigin: "comment",
                content: fallbackComment(agent, selectedTargetPost, random, commentIntent),
                targetPostId: selectedTargetPost.id,
                sourceUrls: [],
                confidence: 0.58,
                reason: "Quality review fallback for a grounded comment.",
                commentIntent: commentIntent ?? "clarifying_question",
              };
            } else if (action === "post") {
              generated = fallbackPost(agent, random);
            }
            qualityReview = reviewGeneratedDraft({
              action: generated,
              requestedAction: action,
              targetPost: selectedTargetPost,
              targetComments,
              commentIntent,
            });
          }

          generated.qualityReview = qualityReview;
          if (action === "comment") generated.commentIntent = commentIntent ?? generated.commentIntent;
          generated.reason = [
            generated.reason,
            qualityReview.ok
              ? "quality_review_passed"
              : `quality_review_issues:${qualityReview.issues.join(",")}`,
          ].filter(Boolean).join(" | ");
        }
        generated.modelUsed = selectedModel;
        generated.informationMode = informationMode;
        generated = enforceInformationPostPolicy(agent, action, informationMode, generated);

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
        if (state) await incrementDailyDone(supabase, state, action);
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
