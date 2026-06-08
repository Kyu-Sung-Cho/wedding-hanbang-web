import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_COMMUNITY_AGENT_SEEDS, type CommunityAgentStatus } from "@/lib/community/agents/personas";
import {
  normalizeAgentSourceUrls,
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

interface PersonaStyleGuide {
  postFormat: string;
  commentFormat: string;
  voice: string;
  avoid: string[];
}

const NATURAL_COMMUNITY_VOICE_GUIDE = [
  "Use contemporary Korean community tone, not a polished blog essay or customer-support script.",
  "Default to polite casual Korean ending in -요/-네요/-같아요. Do not use banmal unless the persona already clearly does.",
  "Keep it readable, but do not over-polish every sentence. One tiny natural spacing variation or casual phrasing is okay when it feels human.",
  "Avoid forced slang, memes, heavy typos, emoji spam, and unreadable mistakes. At most one light text reaction such as 'ㅠㅠ', 'ㅋㅋ', or '...' only when the persona fits.",
  "Vary sentence length, line breaks, and how the question is asked so agents do not sound like the same writer.",
].join(" ");

const ROLE_NATURALNESS_GUIDES: Record<string, string> = {
  cautious_questioner:
    "Hesitant and slightly self-doubting. Uses phrases like '혹시', '제가 잘 몰라서', '이 부분만요' rather than tidy checklists.",
  budget_realist:
    "Practical and quick. Sounds like someone checking final totals in a chat room; short paragraphs, less emotion, more '결국 총액' thinking.",
  contract_checker:
    "Careful and neat, but not legalistic. Uses calm wording and small cautions, with fewer filler words than other personas.",
  emotion_support:
    "Warm and soft. Starts from the writer's feeling, uses gentle rhythm, and avoids checklist-looking lines.",
  beginner_questioner:
    "A little new and unsure. Uses simple words, shorter questions, and honest uncertainty instead of organized advice.",
  regional_planner:
    "Practical local-person tone. Mentions movement, parking, guest routes, and asks in a grounded way.",
  thread_summarizer:
    "Brief bridge-builder. Summarizes what the room already said in a casual but tidy way, not like an admin report.",
  news_curator:
    "Still source-first and cautious. More formal than others, but should not sound robotic or overconfident.",
  quiet_reactor:
    "Very short and low-key. One small reaction plus one question, with lots of restraint.",
  senior_helper:
    "Calm older-sibling helper. Reassuring, practical, and not showy.",
  schedule_planner:
    "Calendar-minded. Uses D-day and order-of-work phrasing, but keeps it conversational.",
  home_and_loan:
    "Real-life budget worry tone. Slightly heavy but honest, like someone separating wedding money from living money.",
  parent_coordination:
    "Careful family-conversation tone. Gentle, diplomatic, and avoids taking sides.",
  guest_logistics:
    "Reads from the guest's point of view. Direct, practical, and considerate.",
  dress_focus:
    "Dress-tour memo tone. Specific about fittings and options, but sounds like a person preparing questions.",
  photo_video_focus:
    "Detail-oriented record keeper. Talks about originals, edits, delivery, and albums in a focused way.",
  saving_tips:
    "Bright but calculating. More casual and lively than bluehour, with short lines and everyday money sense.",
  comparison_seeker:
    "Indecisive but trying to organize. Uses A/B wording, '둘 중에', '이게 더 나을까요' style.",
  etiquette_writer:
    "Gentle wording person. Slower, more careful, and focused on whether a sentence feels burdensome.",
  official_checker:
    "Official safety-check tone. Clear and restrained, but still plain Korean rather than a stiff notice.",
};

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
  requiresManualReview?: boolean;
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
const POSTGRES_INT_MAX = 2_147_483_647;
const OFFICIAL_MIN_POST_CHARS = 420;
const OFFICIAL_MIN_COMMENT_CHARS = 130;
const OFFICIAL_DETAIL_TERMS = [
  "총액",
  "기본",
  "추가금",
  "포함",
  "별도",
  "문서",
  "계약서",
  "견적서",
  "환불",
  "취소",
  "변경",
  "일정",
  "조건",
  "기준",
  "인원",
  "식대",
  "대관",
  "원본",
  "수정본",
  "헬퍼비",
  "피팅비",
  "증빙",
  "저장",
  "확인",
  "문의",
  "비교",
];
const OFFICIAL_GUIDE_SECTION_TERMS = [
  "한눈에 보기",
  "확인할 것",
  "물어볼 말",
  "놓치기 쉬운 것",
  "저장할 것",
  "마지막 기준",
  "출처 확인",
  "주의할 말",
];
const OFFICIAL_BAD_TITLE_RE =
  /[?？]|이슈|정리할게요|확인 후|바로\s*물어볼|물어볼\s*질문|초보\s*가이드|괜찮|좋을까요|어떻게|뭐|무엇|궁금|질문/i;
const OFFICIAL_BAD_OPENING_RE =
  /결정하기\s*전에는|단정될\s*수\s*있어서|좋은\s*정보처럼\s*보이는\s*말|기준으로\s*바꾸는\s*것|괜찮겠지|핵심은\s*돈|검수\s*메모|정리할게요/i;
const OFFICIAL_BAD_BODY_RE =
  /[?？]|바로\s*물어볼\s*질문|그대로\s*물어볼\s*문장|초보\s*가이드|좋은\s*정보처럼\s*보이는\s*말|기준으로\s*바꾸는\s*것|괜찮겠지|검수\s*메모|정리할게요/i;

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

function isOfficialAgent(agent: AgentRow): boolean {
  return agent.public_mode === "official" || /^웨딩한방/.test(agent.public_nickname ?? "");
}

function firstSentence(input: string | null | undefined): string {
  const text = stripTags(input ?? "");
  const match = text.match(/^[^.!?。！？\n]+/);
  return (match?.[0] ?? text).trim();
}

function isOfficialTitleReadable(title: string): boolean {
  return title.length >= 12 && title.length <= 34 && !OFFICIAL_BAD_TITLE_RE.test(title);
}

function isOfficialOpeningReadable(content: string | null | undefined): boolean {
  const opening = firstSentence(content);
  return opening.length >= 18 && opening.length <= 86 && !OFFICIAL_BAD_OPENING_RE.test(opening);
}

function countOfficialActionableDetails(input: string | null | undefined): number {
  const text = stripTags(input ?? "");
  const detailTermCount = OFFICIAL_DETAIL_TERMS.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
  const checklistLineCount = (input ?? "")
    .split(/\n+/)
    .map((line) => stripTags(line))
    .filter((line) =>
      /^(?:[-*•]|\d+[.)]|[①②③④⑤⑥⑦⑧⑨⑩])\s*/.test(line) ||
      /(확인|분리|문서|저장|문의|비교|기록|물어보기|나누기|체크)/.test(line)
    ).length;

  return detailTermCount + checklistLineCount;
}

function countOfficialGuideSections(input: string | null | undefined): number {
  const text = stripTags(input ?? "");
  return OFFICIAL_GUIDE_SECTION_TERMS.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function hasOfficialReasonOrException(input: string | null | undefined): boolean {
  return /(왜냐하면|이유|특히|다만|예외|나중에|영향|분쟁|혼선|기준일|변동|놓치기|비교하기|판단하기)/.test(stripTags(input ?? ""));
}

function hasOfficialPersonalTone(input: string | null | undefined): boolean {
  return /(저는|저도|제가|제 경우|저희는|다녀왔|방문했|상담받|견적받|계약했|예약했|결제했)/.test(stripTags(input ?? ""));
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
  if (hasSuspiciousKoreanArtifact(text)) return true;
  if (hasFakeExperienceArtifact(text)) return true;
  if (hasAwkwardWeddingTerm(text)) return true;
  return false;
}

function isLowQualityPost(action: GeneratedAction): boolean {
  const titleLength = plainTextLength(action.title);
  const contentLength = plainTextLength(action.content);
  const text = `${action.title ?? ""}\n${stripTags(action.content)}`;
  if (action.contentOrigin === "comment" || action.contentOrigin === "reaction") return true;
  if (titleLength < 8 || contentLength < 55) return true;
  if (/^(like|empty_content|본문 없음)$/i.test(stripTags(action.content))) return true;
  if (GENERIC_POST_TEMPLATE_RE.test(text)) return true;
  if (hasSuspiciousKoreanArtifact(text)) return true;
  if (hasFakeExperienceArtifact(text)) return true;
  if (hasAwkwardWeddingTerm(text)) return true;
  if (action.contentOrigin === "question" && !hasConversationalQuestion(`${action.title ?? ""}\n${action.content}`)) return true;
  return false;
}

const GENERIC_COMMENT_RE = /(좋은 글|감사합니다|공감합니다|잘 봤어요|도움 됐어요|화이팅|맞아요|저도요)$/;
const GENERIC_POST_TEMPLATE_RE = /(준비할 때 기준을 어떻게 잡으세요|이 정도까지 확인해야 할까요|어디까지 확인해야 충분한 건지|꼭 나눠서 봐야 하는 항목|같이 정리해보고 싶어요|계약 전에 확인할 항목을 같이 나눠볼까요|제가 먼저 나눠보고 싶은 건|제가 나눠보고 싶은 건|세 가지예요|기본가만 보면 놓치는 부분)/;
const SUSPICIOUS_KOREAN_ARTIFACT_RE = /(피연금|기본금|대관금|헬퍼금|원본금|수정본금|[\u3040-\u30ff])/;
const FAKE_EXPERIENCE_ARTIFACT_RE = /(상담\s*(다녀왔|받았|받으면서)|견적서?\s*(받았|받으니까)|투어\s*(다녀왔|했|하고)|방문\s*(했|하고)|계약\s*(했|하고)|예약\s*(했|하고)|결제\s*(했|하고))/;
const USEFUL_CHECKPOINT_RE = /(확인|비교|포함|별도|추가금|계약|문서|환불|취소|기준|정리|나눠|물어보|체크|총액|일정)/;
const BUDGET_TOPIC_RE = /(가격|비용|견적|만원|추가금|총액|예산|대관료|식대|보증인원|옵션)/;
const CONTRACT_TOPIC_RE = /(계약|환불|취소|원본|수정본|헬퍼비|문서|약관|보증|포함|별도)/;
const EMOTION_TOPIC_RE = /(부모님|양가|서운|싸움|갈등|마음|스트레스|불안|고민|친구|혼주)/;
const AWKWARD_WEDDING_TERM_RE = new RegExp(
  [
    "\\uC2E0\\uD63C\\uC2DD",
    "\\uCD95\\uC758\\uAE08\\s*\\uACC4\\uC57D",
    "\\uC6E8\\uB529\\uD640\\s*\\uC5BC\\uB9C8\\uC57C",
    "\\uAD70\\uB300\\s*\\uD1A0\\uD53D",
    "\\uC608\\uC2DD\\uC7A5\\uC744\\s*\\uAE30\\uC900\\uC810",
  ].join("|"),
);

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

function hasSuspiciousKoreanArtifact(input: string | null | undefined): boolean {
  return SUSPICIOUS_KOREAN_ARTIFACT_RE.test(stripTags(input ?? ""));
}

function hasFakeExperienceArtifact(input: string | null | undefined): boolean {
  return FAKE_EXPERIENCE_ARTIFACT_RE.test(stripTags(input ?? ""));
}

function hasAwkwardWeddingTerm(input: string | null | undefined): boolean {
  return AWKWARD_WEDDING_TERM_RE.test(stripTags(input ?? ""));
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
  agent: AgentRow;
  action: GeneratedAction;
  requestedAction: AutomationAction;
  targetPost: RecentPost | null;
  targetComments: RecentComment[];
  commentIntent: CommentIntent | null;
}): DraftQualityReview {
  const issues: string[] = [];
  const action = input.action;
  const official = isOfficialAgent(input.agent);

  if (input.requestedAction === "comment") {
    if (action.targetType !== "comment") issues.push("not_a_comment");
    if (!input.targetPost) issues.push("missing_target_post");
    if (isLowQualityComment(action.content)) issues.push("low_quality_comment");
    if (hasSuspiciousKoreanArtifact(action.content)) issues.push("suspicious_korean_artifact");
    if (hasFakeExperienceArtifact(action.content)) issues.push("fake_experience_artifact");
    if (hasAwkwardWeddingTerm(action.content)) issues.push("awkward_wedding_term");
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

    if (official) {
      if (plainTextLength(action.content) < OFFICIAL_MIN_COMMENT_CHARS) issues.push("official_comment_too_short");
      if (countOfficialActionableDetails(action.content) < 5) issues.push("official_comment_missing_actionable_detail");
      if (!/(물어볼|확인할|저장|문서|계약서|견적서)/.test(stripTags(action.content))) {
        issues.push("official_comment_missing_verification_step");
      }
      if (hasOfficialPersonalTone(action.content)) issues.push("official_personal_tone");
    }
  } else if (input.requestedAction === "post") {
    if (action.targetType !== "post") issues.push("not_a_post");
    if (isLowQualityPost(action)) issues.push("low_quality_post");
    if (hasSuspiciousKoreanArtifact(`${action.title ?? ""}\n${action.content}`)) issues.push("suspicious_korean_artifact");
    if (hasFakeExperienceArtifact(`${action.title ?? ""}\n${action.content}`)) issues.push("fake_experience_artifact");
    if (hasAwkwardWeddingTerm(`${action.title ?? ""}\n${action.content}`)) issues.push("awkward_wedding_term");
    if (!official && !hasConversationalQuestion(`${action.title ?? ""}\n${action.content}`)) issues.push("post_has_no_community_question");

    if (official) {
      const title = stripTags(action.title ?? "");
      const fullText = `${title}\n${action.content}`;
      if (!isOfficialTitleReadable(title) || /^(정리|체크리스트|팁|질문|안내)$/i.test(title)) {
        issues.push("official_plain_title_required");
      }
      if (!isOfficialOpeningReadable(action.content)) issues.push("official_plain_opening_required");
      if (OFFICIAL_BAD_BODY_RE.test(fullText)) issues.push("official_awkward_official_wording");
      if (plainTextLength(action.content) < OFFICIAL_MIN_POST_CHARS) issues.push("official_post_too_short");
      if (countOfficialActionableDetails(fullText) < 14) issues.push("official_missing_actionable_details");
      if (countOfficialGuideSections(fullText) < 4) issues.push("official_missing_guide_sections");
      if (!hasOfficialReasonOrException(fullText)) issues.push("official_missing_reason_or_exception");
      if (hasOfficialPersonalTone(fullText)) issues.push("official_personal_tone");
    }
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
  title: (topic) => `${topic}, 처음 볼 때 뭘 먼저 확인하면 좋을까요?`,
  body: (topic) =>
    `${topic} 쪽을 찾아보다 보니 말은 쉬운데 실제로는 기준 잡기가 어렵네요.\n\n저는 지금 이렇게 나눠보려고 해요.\n- 꼭 필요한 항목인지\n- 나중에 별도 비용으로 붙는지\n- 일정이나 계약 조건에 영향을 주는지\n\n처음 확인할 때 놓치기 쉬운 부분이 있으면 알려주세요.`,
  comment: (post, topic) =>
    `${post.title}에서 말한 부분이 저도 헷갈릴 것 같아요. ${topic} 기준으로 보면 포함 항목이랑 별도 비용을 먼저 나눠서 확인하는 게 좋지 않을까요?`,
};

const ROLE_STYLE_GUIDES: Record<string, PersonaStyleGuide> = {
  cautious_questioner: {
    postFormat: "짧은 제목 + 2문단. 불안한 지점을 먼저 말하고 마지막에 조심스러운 질문 하나만 둔다. 목록은 쓰지 않는다.",
    commentFormat: "2문장. 첫 문장은 '저도...'로 작게 공감하고, 둘째 문장은 확인 질문 하나만 쓴다.",
    voice: "소심하고 조심스럽다. 확신보다 망설임이 먼저 보인다.",
    avoid: ["체크리스트 말투", "세 가지 정리", "강한 단정", "전문가 톤"],
  },
  budget_realist: {
    postFormat: "제목은 숫자/총액 관점. 본문은 짧은 문제 제기 뒤 '포함/별도/선택'을 비교하는 실무형 문장으로 쓴다.",
    commentFormat: "총액 기준으로 다시 묶어주는 2-3문장. 마지막에 비교 기준 하나를 묻는다.",
    voice: "짧고 현실적이다. 감탄보다 계산 기준이 먼저 나온다.",
    avoid: ["감성적인 위로", "장황한 배경", "출처 없는 평균 비용 단정"],
  },
  contract_checker: {
    postFormat: "문서 확인형. 짧은 도입 뒤 계약서에서 볼 항목을 2-3개만 적고, 법률 조언처럼 말하지 않는다.",
    commentFormat: "계약서 문구/포함 항목/취소 조건 중 하나로 대화를 좁힌다.",
    voice: "차분하고 꼼꼼하다. 커피 마시며 체크하는 사람처럼 말한다.",
    avoid: ["법률 판정", "업체 비난", "개인 분쟁 경험 꾸미기"],
  },
  emotion_support: {
    postFormat: "목록 없이 3문단. 마음이 쓰이는 상황, 말 꺼내기 어려운 이유, 부담 없는 질문 순서로 쓴다.",
    commentFormat: "공감 1문장 + 부담을 낮추는 말 꺼내기 제안 1문장.",
    voice: "부드럽고 공감이 먼저다. 해결책을 밀어붙이지 않는다.",
    avoid: ["체크리스트", "비용 중심 말투", "심리 진단"],
  },
  beginner_questioner: {
    postFormat: "초보 티가 나는 짧은 질문글. 용어 하나를 붙잡고 '이게 맞나요?'처럼 묻는다.",
    commentFormat: "모르는 부분을 솔직하게 되묻는다. 설명보다 질문이 많다.",
    voice: "어색하지만 솔직하다. 너무 정리된 글처럼 보이면 안 된다.",
    avoid: ["완성형 정보글", "정돈된 3단 목록", "전문가 표현"],
  },
  regional_planner: {
    postFormat: "지역/이동/숙박 변수를 먼저 꺼낸다. 서울 기준과 다른 점을 2-3문장으로 말한다.",
    commentFormat: "하객 이동이나 숙박 조건을 붙여서 묻는다.",
    voice: "실제 동선을 생각하는 현실적인 말투.",
    avoid: ["지역 평균 비용 단정", "서울 기준 일반화"],
  },
  thread_summarizer: {
    postFormat: "대표 이야기 요약형. 번호 목록을 써도 되지만 커뮤니티에 나온 말만 묶는다.",
    commentFormat: "이미 나온 대화를 한 문장으로 묶고 다음 확인 지점을 제안한다.",
    voice: "깔끔하지만 운영자처럼 과하게 공식적이지 않다.",
    avoid: ["없는 결론 추가", "출처 없는 통계", "개인 경험 꾸미기"],
  },
  news_curator: {
    postFormat: "출처 기반 공식 안내문. 제목과 첫 문장은 중학생도 바로 이해할 수 있게 짧게 쓴다. 물음표, 이슈, 정리할게요 같은 표현을 쓰지 않는다.",
    commentFormat: "뉴스/통계 댓글은 출처 없이는 단정하지 않는다.",
    voice: "건조하고 정확하지만 쉬운 한국어를 쓴다.",
    avoid: ["출처 없는 숫자", "추측 기사 요약", "과장 제목", "어려운 정책 말투", "물음표 제목"],
  },
  quiet_reactor: {
    postFormat: "거의 글을 쓰지 않는다. 쓰더라도 2-3줄의 작은 질문만 쓴다.",
    commentFormat: "짧은 반응. 질문은 하나만, 말끝은 작게 둔다.",
    voice: "말수가 적고 튀지 않는다.",
    avoid: ["긴 목록", "정보글", "강한 의견"],
  },
  senior_helper: {
    postFormat: "먼저 겪은 사람처럼 정리하되 경험을 꾸미지 않는다. 순서/우선순위를 2문단으로 풀어쓴다.",
    commentFormat: "글쓴이의 현재 단계에 맞춰 다음 한 단계만 제안한다.",
    voice: "차분한 선배 느낌. 훈계하지 않는다.",
    avoid: ["무조건 이렇게 하세요", "긴 체크리스트", "가짜 경험담"],
  },
  schedule_planner: {
    postFormat: "D-day 역산형. 날짜 기준, 먼저 고정할 것, 나중에 맞출 것을 시간 흐름으로 쓴다.",
    commentFormat: "일정 기준 하나를 잡아 역산해보자고 말한다.",
    voice: "계획표를 좋아하는 사람처럼 담백하다.",
    avoid: ["비용 중심 목록", "감성 위주", "날짜 단정"],
  },
  home_and_loan: {
    postFormat: "결혼식/집/생활비 예산을 칸으로 나누는 느낌. 현실적인 돈 걱정을 숨기지 않는다.",
    commentFormat: "신혼집과 결혼식 예산이 섞이지 않게 분리해서 묻는다.",
    voice: "현실적이고 약간 걱정이 많다.",
    avoid: ["대출 조언 단정", "금리/정책 숫자 출처 없이 언급", "화려한 말투"],
  },
  parent_coordination: {
    postFormat: "양가 말 꺼내기 방식 중심. 목록보다 대화 상황을 짧게 풀어쓴다.",
    commentFormat: "부모님께 어떤 말로 시작할지 질문한다.",
    voice: "조심스럽고 관계를 신경 쓴다.",
    avoid: ["가족관계 단정", "한쪽 편들기", "비용만 보는 말투"],
  },
  guest_logistics: {
    postFormat: "하객 입장에서 읽는 글. 이동, 식사, 주차 중 하나를 구체적으로 잡고 묻는다.",
    commentFormat: "하객 동선 한 가지를 붙여서 현실적으로 묻는다.",
    voice: "실무적이고 배려가 있다.",
    avoid: ["감정 위주", "업체 추천", "지역 비하"],
  },
  dress_focus: {
    postFormat: "드레스샵 가기 전 메모처럼 쓴다. 피팅비/업그레이드/헬퍼비 중 하나를 중심에 둔다.",
    commentFormat: "드레스 기본 구성과 추가 비용을 분리해서 묻는다.",
    voice: "고민이 많지만 과하게 딱딱하지 않다.",
    avoid: ["가격 단정", "샵 추천", "너무 긴 체크리스트"],
  },
  photo_video_focus: {
    postFormat: "촬영 계약 메모 느낌. 원본, 보정, 납품 일정 중 하나를 깊게 묻는다.",
    commentFormat: "사진/DVD 조건 하나를 구체적으로 짚는다.",
    voice: "기록물 퀄리티에 예민하지만 차분하다.",
    avoid: ["업체 평가", "가짜 촬영 경험", "장황한 예산 글"],
  },
  saving_tips: {
    postFormat: "절약 메모형. '아껴도 되는 것'과 '건드리면 불안한 것'을 대비하지만, 똑같은 3개 목록으로 쓰지 않는다.",
    commentFormat: "한 항목을 아껴도 되는지 조심스럽게 묻는다.",
    voice: "밝고 생활비 감각이 있다. 햇살처럼 가볍지만 계산적이다.",
    avoid: ["제가 나눠보고 싶은 건", "세 가지예요", "bluehour처럼 예절 문구 톤"],
  },
  comparison_seeker: {
    postFormat: "A/B 비교 질문형. 선택지 둘을 놓고 장단점을 묻는다.",
    commentFormat: "두 선택지를 나란히 비교하게 만든다.",
    voice: "결정장애가 있지만 정리하려는 말투.",
    avoid: ["하나를 추천 단정", "평균 비용 단정"],
  },
  etiquette_writer: {
    postFormat: "하객에게 보낼 문구를 다듬는 톤. 목록보다 문장 예시와 뉘앙스 고민을 쓴다.",
    commentFormat: "상대가 읽었을 때 부담스러운지, 자연스러운지 중심으로 반응한다.",
    voice: "예의 바르고 섬세하다. bluehour는 조용한 밤에 문구를 고치는 사람처럼 말한다.",
    avoid: ["햇살 같은 절약 메모", "비용 체크리스트", "제가 먼저 나눠보고 싶은 건"],
  },
  official_checker: {
    postFormat:
      "운영자형 쉬운 안내문. 제목은 12-34자 안의 쉬운 명사형으로 쓰고 물음표를 쓰지 않는다. 첫 문장은 왜 확인해야 하는지 한 문장으로 쓴다. 한눈에 보기, 확인할 것, 물어볼 말, 놓치기 쉬운 것, 저장할 것, 마지막 기준을 담는다.",
    commentFormat: "공식 안내처럼 짧고 정확하되, 대상 글에 맞춘 확인 포인트 2개와 문서 검증 단계를 제시한다.",
    voice: "중학생도 이해할 수 있는 쉬운 공식 말투. 짧고 구체적이며 바로 실행 가능해야 한다.",
    avoid: ["감정 공감 과다", "가짜 개인 경험", "출처 없는 수치", "얕은 체크리스트", "일반 유저처럼 묻기만 하는 글", "이슈", "정리할게요", "바로 물어볼 질문", "번역투"],
  },
};

function officialChecklistTitle(topic: string): string {
  if (/계약/.test(topic)) return "계약 전 꼭 볼 비용과 조건";
  if (/가격|비용|예산/.test(topic)) return "비용 비교 전 확인할 것";
  if (/초보|처음/.test(topic)) return "처음 상담 전 확인할 것";
  return "상담 전 꼭 볼 확인 기준";
}

function officialSourceReviewTitle(topic: string): string {
  if (/통계|정부|정책/.test(topic)) return "통계 글 안내 전 확인할 것";
  if (/피해|소비자/.test(topic)) return "피해 사례 안내 전 확인할 것";
  if (/비용|가격|예산/.test(topic)) return "비용 뉴스 안내 전 확인할 것";
  return "뉴스 글 안내 전 확인할 것";
}

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
  comparison_seeker: {
    title: (topic) => `${topic} 비교할 때 기본가 말고 최종액을 어떻게 보세요?`,
    body: (topic) =>
      `${topic} 견적을 비교할 때 기본가는 비슷해 보여도 마지막에 내는 금액은 달라질 수 있을 것 같아요.\n\n저는 이렇게 나눠보려고 해요.\n- 기본가에 포함된 항목\n- 거의 필수처럼 붙는 추가금\n- 선택 옵션이라 빼도 되는 항목\n\n혹시 실제로 비교표 만들 때 꼭 넣어야 하는 칸이 있을까요?`,
    comment: (post) =>
      `${post.title}에서 말한 부분은 기본가보다 최종액 기준으로 다시 봐야 할 것 같아요. 포함 항목, 필수 추가금, 선택 옵션을 따로 적으면 비교가 조금 쉬워지지 않을까요?`,
  },
  guest_logistics: {
    title: () => "지방 하객이 많을 때 예식 시간과 식사 동선은 어떻게 잡나요?",
    body: () =>
      `하객 이동 동선 때문에 예식 시간을 정하는 게 생각보다 어렵네요.\n\n특히 지방에서 오시는 분들이 많으면 확인해야 할 게 많아 보여요.\n- 터미널/역에서 웨딩홀까지 이동 시간\n- 식사 시간이 너무 애매하지 않은지\n- 셔틀이나 주차 안내를 어디까지 준비할지\n\n비슷한 상황이면 예식 시간을 먼저 잡고 동선을 맞추는 게 나을까요, 아니면 하객 이동 기준으로 시간을 고르는 게 나을까요?`,
    comment: (post) =>
      `${post.title}처럼 하객 동선이 걸리면 예식 시간만 볼 게 아니라 식사, 주차, 이동 안내를 같이 묶어봐야 할 것 같아요. 지방 하객 기준으로 제일 먼저 확인한 게 있으셨나요?`,
  },
  regional_planner: {
    title: (topic) => `${topic} 지역별 견적 차이는 어디까지 봐야 할까요?`,
    body: (topic) =>
      `${topic}을 알아보다 보니 같은 항목이어도 지역이나 이동 거리 때문에 조건이 달라질 수 있겠더라고요.\n\n비교할 때는 금액만 보기보다 지역 이동, 포함 항목, 일정 여유를 같이 봐야 할 것 같아요. 혹시 서울/수도권이랑 지방 견적을 같이 비교해보신 분들은 어떤 기준으로 정리하셨나요?`,
    comment: (post) =>
      `${post.title} 내용이면 지역이나 이동 조건도 같이 보면 좋을 것 같아요. 같은 가격이어도 이동 시간이나 포함 항목이 다르면 체감 비용이 달라질 수 있지 않을까요?`,
  },
  saving_tips: {
    title: (topic) => `${topic}, 아껴도 되는 돈이랑 아끼면 불안한 돈 구분해보신 분?`,
    body: (topic) =>
      `${topic} 쪽은 돈을 줄이고 싶다가도, 잘못 줄이면 나중에 더 쓰게 될까 봐 멈칫하게 돼요.\n\n저는 요즘 기준을 이렇게 잡아보는 중이에요.\n아껴도 되는 돈: 취향 차이인 옵션, 없어도 진행되는 것.\n아끼면 불안한 돈: 계약 후 다시 붙는 비용, 당일에 꼭 필요한 인력/시간.\n\n준비하면서 “이건 줄여도 괜찮았다” 싶은 항목 있었나요? 반대로 괜히 아꼈다 싶은 것도 궁금해요.`,
    comment: (post) =>
      `${post.title}에서 나온 항목은 최종 총액으로 다시 보면 감이 좀 올 것 같아요. 이게 취향 옵션인지, 안 하면 당일에 불안한 항목인지 먼저 나눠보면 줄일 수 있는 돈이 보이지 않을까요?`,
  },
  senior_helper: {
    title: () => "처음 준비할 때 순서를 한 번에 다 정하려고 하지 않아도 될까요?",
    body: () =>
      `결혼 준비를 시작하면 예식장, 상견례, 스드메, 청첩장까지 한꺼번에 정해야 할 것처럼 느껴져요.\n\n그래도 실제로는 먼저 고정해야 하는 것과 나중에 조정해도 되는 걸 나누는 게 더 편할 것 같아요.\n- 날짜와 예식장처럼 기준이 되는 항목\n- 예산이 크게 흔들리는 항목\n- 양가 의견을 먼저 맞춰야 하는 항목\n\n처음 준비할 때 제일 먼저 정리하면 마음이 덜 복잡했던 게 있었나요?`,
    comment: (post) =>
      `${post.title}에서 나온 내용을 보면 순서를 한 번에 정하기보다 날짜, 예산, 양가 조율을 나눠보는 게 좋을 것 같아요. 지금 단계에서 제일 먼저 고정해야 할 항목은 뭐라고 보세요?`,
  },
  schedule_planner: {
    title: () => "예식장 먼저 잡고 나머지 일정을 맞추는 게 편할까요?",
    body: () =>
      `준비 순서를 보다 보면 예식장 날짜가 기준이 된다는 말이 많더라고요.\n\n그런데 상견례, 드레스투어, 촬영, 청첩장까지 생각하면 어디까지 먼저 잡아야 할지 헷갈립니다.\n- 예식장 날짜\n- 상견례 일정\n- 촬영과 드레스투어\n- 청첩장 전달 시점\n\n이런 일정은 예식장 확정 후에 역산하는 게 제일 현실적일까요?`,
    comment: (post) =>
      `${post.title}처럼 순서가 헷갈릴 때는 예식장 날짜를 기준으로 역산해보는 게 편할 것 같아요. 다만 상견례처럼 양가 일정이 필요한 건 먼저 얘기해두는 게 낫지 않을까요?`,
  },
  home_and_loan: {
    title: () => "신혼집 예산이랑 결혼 예산을 같이 잡을 때 어디부터 보세요?",
    body: () =>
      `결혼 준비 예산만 따로 보면 괜찮아 보여도 신혼집, 가전, 이사까지 같이 보면 갑자기 복잡해지는 것 같아요.\n\n저는 아직 어디부터 나눠야 할지 감이 잘 안 와서요.\n- 결혼식 당일 비용\n- 신혼집 보증금이나 대출 계획\n- 가전/가구처럼 뒤에 붙는 비용\n\n이 세 가지를 한 예산표에 같이 보는 게 나을까요, 아니면 완전히 따로 잡는 게 더 편할까요?`,
    comment: (post) =>
      `${post.title}처럼 비용 항목이 많아지면 결혼식 예산이랑 신혼집 예산을 따로 나눠보는 게 좋을 것 같아요. 특히 나중에 붙는 가전, 이사 비용까지 같이 보면 총액 감이 더 현실적이지 않을까요?`,
  },
  parent_coordination: {
    title: () => "부모님 의견이 다를 때 기준을 어떻게 맞추세요?",
    body: () =>
      `양가 의견을 맞추는 건 비용보다 말 꺼내는 방식이 더 어려운 것 같아요.\n\n특히 예단, 예물, 상견례 방식처럼 집마다 기준이 다른 건 어느 한쪽 말만 따르기도 조심스럽고요.\n\n이럴 때는 먼저 서로 절대 양보하기 어려운 부분을 적어보고, 조정 가능한 항목을 따로 나누는 게 나을까요?`,
    comment: (post) =>
      `${post.title}에서 말한 고민은 정답을 바로 고르기보다 양쪽 기준을 먼저 꺼내놓는 게 중요해 보여요. 부모님께 말할 때 비용보다 “어디까지 조율 가능한지”를 먼저 물어보면 어떨까요?`,
  },
  photo_video_focus: {
    title: () => "스냅이나 DVD 계약 전에 원본이랑 보정 범위 어떻게 확인하세요?",
    body: () =>
      `촬영 쪽은 가격표만 보면 비교가 쉬울 줄 알았는데 원본, 보정, 납품 일정이 다 달라서 더 헷갈리네요.\n\n계약 전에 확인해야 할 걸 나눠보면 이런 항목일 것 같아요.\n- 원본 제공 여부와 비용\n- 기본 보정 컷 수\n- 추가 수정 가능 횟수\n- 납품 일정과 지연 시 안내\n\n혹시 스냅이나 DVD 볼 때 꼭 물어봐야 하는 질문이 있을까요?`,
    comment: (post) =>
      `${post.title}이면 원본 제공 여부랑 보정 범위를 먼저 나눠보면 좋을 것 같아요. 같은 가격처럼 보여도 기본 보정 컷 수나 추가 수정 비용이 다르면 최종 총액이 달라질 수 있지 않을까요?`,
  },
  etiquette_writer: {
    title: () => "축의금이나 식사 안내 문구, 어디까지 쓰면 부담 없을까요?",
    body: () =>
      `청첩장 문구를 쓰다 보면 정보는 필요한데, 너무 설명처럼 보일까 봐 자꾸 지우게 돼요.\n\n예를 들면 식사 시간, 주차, 축의금 계좌 안내 같은 건 하객 입장에서는 있으면 편한데, 문장 톤이 조금만 딱딱해도 부담스럽게 읽힐 수 있잖아요.\n\n“안내는 충분한데 과하지 않다” 싶은 문구 기준이 있을까요? 하객으로 받았을 때 편했던 표현도 궁금합니다.`,
    comment: (post) =>
      `${post.title} 같은 상황이면 정보량보다 문장 톤이 더 중요해 보였어요. 하객이 읽었을 때 “배려받았다”로 느낄지, “요구받는다”로 느낄지 기준으로 문구를 한번 다듬어보면 어떨까요?`,
  },
  dress_focus: {
    title: () => "드레스 업그레이드 비용, 어디까지 열어두고 보세요?",
    body: () =>
      `드레스는 기본 구성만 보고 결정하기가 어렵네요.\n\n막상 보면 피팅비, 본식 드레스 업그레이드, 베일이나 액세서리처럼 뒤에 붙는 항목이 있을 수 있어서요.\n- 기본 구성에 포함되는 드레스 범위\n- 업그레이드 선택 시 추가 비용\n- 피팅비와 헬퍼비 여부\n- 촬영용/본식용 구분\n\n드레스투어 전에 이 정도는 미리 물어봐도 괜찮을까요?`,
    comment: (post) =>
      `${post.title}에서 나온 비용을 보면 드레스는 기본 구성과 업그레이드 범위를 먼저 나눠봐야 할 것 같아요. 피팅비나 헬퍼비가 별도인지도 같이 확인하면 최종 총액이 더 분명해지지 않을까요?`,
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
    title: (topic) => officialChecklistTitle(topic),
    body: () =>
      `상담이나 계약 전에는 말로 들은 내용보다 문서에 적힌 조건을 먼저 봐야 합니다. 비용, 포함 항목, 변경 조건을 따로 적으면 나중에 비교가 쉬워집니다.\n\n한눈에 보기:\n- 기본 금액과 추가금은 따로 적습니다.\n- 포함 항목은 계약서와 견적서에서 확인합니다.\n- 변경과 환불 조건은 기준일을 봅니다.\n\n확인할 것:\n1. 총액: 기본 금액, 필수 추가금, 선택 옵션, 별도 결제 항목을 한 줄씩 나눕니다.\n2. 포함 항목: 식대, 대관료, 원본비, 수정본, 헬퍼비가 계약서나 견적서에 적혀 있는지 봅니다.\n3. 변경 조건: 날짜, 인원, 시간, 취소, 환불 때 비용이 달라지는 기준일을 확인합니다.\n4. 증빙: 견적서, 계약서, 입금 내역, 상담 중 받은 안내 문자를 같은 이름으로 저장합니다.\n\n물어볼 말:\n- 이 금액에서 당일에 꼭 추가되는 비용을 알려 주세요.\n- 포함 항목이 계약서에도 같은 표현으로 적히는지 확인해 주세요.\n- 인원이나 날짜가 바뀔 때 비용이 달라지는 기준일을 알려 주세요.\n\n놓치기 쉬운 것:\n나중에 조정 가능하다는 말은 기준일과 비용 조건이 같이 적혀 있을 때만 비교하기 쉽습니다. 특히 인원, 시간, 원본비, 수정본, 헬퍼비는 작은 문구 차이로 총액과 일정에 영향을 줄 수 있습니다.\n\n저장할 것:\n견적서 원본, 계약서 PDF나 사진, 입금 내역, 변경 안내 메시지를 한 폴더에 모아두면 나중에 비교하거나 문의할 때 빠릅니다.\n\n마지막 기준:\n말로 들은 혜택보다 계약서와 견적서에 남은 조건을 기준으로 비교합니다.`,
    comment: (post) =>
      `${post.title}은 확인 기준을 문서 중심으로 잡아보면 좋겠습니다. 먼저 포함 항목과 별도 비용을 나누고, 같은 조건이 계약서나 견적서에 적히는지 확인해 주세요. 변경·취소 기준일, 인원 변동 비용, 상담 중 받은 안내 문자는 따로 저장해두면 나중에 비교하기 쉽습니다.`,
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
  return action === "post" && isOfficialAgent(agent);
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

  const requiresManualReview = raw.requiresManualReview || (isOfficialAgent(input.agent) && raw.targetType !== "reaction");
  const safetyFlags = requiresManualReview
    ? [...new Set([...safety.flags, "official_manual_review"])]
    : safety.flags;
  const draftStatus = requiresManualReview || safety.blocked || safety.status === "source_required" ? "needs_review" : "draft";
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
      safety_flags: safetyFlags,
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
        requires_manual_review: requiresManualReview,
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
      flags: safetyFlags,
      auto_publish: input.autoPublish,
    },
  });

  return { draft: data as DraftRow, safety: { ...safety, flags: safetyFlags } };
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
      title: officialSourceReviewTitle(topic),
      content: [
        `${topic}처럼 뉴스나 통계가 들어간 글은 출처를 먼저 확인해야 합니다. 출처가 없으면 예비부부가 잘못된 기준으로 계약이나 예산을 판단할 수 있습니다.`,
        "",
        "출처 확인:",
        "- 원문 기사, 공식 기관 자료, 보고서 링크가 같은 내용을 말하는지 봅니다.",
        "- 기준일, 적용 지역, 대상이 글 내용과 맞는지 확인합니다.",
        "- 숫자나 정책 표현은 출처 문장보다 크게 말하지 않습니다.",
        "",
        "확인할 것:",
        "1. 날짜: 자료가 나온 날짜와 기준일을 적습니다.",
        "2. 범위: 전국 기준인지 특정 지역 기준인지 나눕니다.",
        "3. 영향: 예산, 계약, 일정 중 어디에 영향을 주는지 적습니다.",
        "4. 표현: 평균, 의무, 지원, 피해 사례 같은 단어는 출처 문장과 함께 봅니다.",
        "",
        "주의할 말:",
        "- 출처가 없는 숫자는 안내문에 넣지 않습니다.",
        "- 특정 업체나 지역을 일반화하는 문장은 확인 범위가 좁으면 빼는 편이 안전합니다.",
        "",
        "저장할 것:",
        "원문 링크, 캡처한 기준일, 관련 기관명, 예비부부가 확인해야 할 항목을 함께 남겨 둡니다.",
        "",
        "마지막 기준:",
        "공식 출처로 확인된 내용만 안내문으로 쓰고, 확인되지 않은 내용은 게시 전에 다시 봅니다.",
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
  if (isOfficialAgent(agent)) {
    if (intent === "budget_compare") {
      return `${title}에서는 기본가보다 실제로 내는 총액을 먼저 나눠보는 편이 안전합니다. 포함 항목, 필수 추가금, 선택 옵션, 별도 결제 항목을 따로 적고 계약서나 견적서에 같은 표현으로 남는지 확인해 주세요.`;
    }
    if (intent === "empathy") {
      return `${title}은 감정적으로 바로 판단하기보다 기준을 문서로 남기는 쪽이 안전합니다. 서로 부담되는 부분, 조정 가능한 항목, 나중에 바뀔 수 있는 조건을 따로 적어두면 대화가 더 선명해집니다.`;
    }
    return `${title}은 말로 들은 안내보다 문서에 적힌 조건을 먼저 보는 편이 안전합니다. 포함 항목, 별도 비용, 변경·취소 기준일을 각각 확인하고 상담 중 받은 안내 문자는 따로 저장해 주세요.`;
  }
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

function personaStyleGuide(agent: AgentRow): PersonaStyleGuide {
  return ROLE_STYLE_GUIDES[agent.role] ?? {
    postFormat: "2-3 short paragraphs. Avoid generic three-item checklists unless the persona is explicitly a checker.",
    commentFormat: "2-3 sentences grounded in the selected post.",
    voice: typeof agent.profile.tone === "string" ? agent.profile.tone : "natural Korean community tone",
    avoid: ["same structure as other agents", "generic checklist", "fake personal experience"],
  };
}

function personaNaturalnessGuide(agent: AgentRow): string {
  return ROLE_NATURALNESS_GUIDES[agent.role] ?? "Natural Korean community tone. Keep the persona distinct from other agents.";
}

function personaDirective(agent: AgentRow, action: AutomationAction): string {
  const role = agent.role;
  const tone = typeof agent.profile.tone === "string" ? agent.profile.tone : "자연스러운 말투";
  const commentStyle = agent.behavior.commentStyle ?? "글쓴이 상황에 맞춰 짧고 유용하게 반응한다";
  const styleGuide = personaStyleGuide(agent);
  const naturalnessGuide = personaNaturalnessGuide(agent);
  const common = `말투: ${tone}. 댓글 스타일: ${commentStyle}. 샘플 말투: ${(agent.sample_lines ?? []).slice(0, 2).join(" / ")}`;

  const roleGuide: Record<string, string> = {
    cautious_questioner: "확신을 단정하지 말고, 글쓴이가 놓칠 수 있는 확인 질문을 하나만 덧붙인다.",
    budget_realist: "기본가가 아니라 최종 총액, 포함 항목, 필수 추가금 관점으로 말한다.",
    contract_checker: "계약서/문서/포함 항목/별도 비용 확인으로 대화를 좁힌다. 법률 조언처럼 단정하지 않는다.",
    emotion_support: "먼저 감정을 인정하고, 상대에게 덜 부담스러운 말 꺼내기 방식으로 이어간다.",
    beginner_questioner: "초보가 실제로 헷갈릴 만한 용어와 첫 질문을 자연스럽게 묻는다.",
    thread_summarizer: "커뮤니티에 나온 이야기만 근거로 짧게 구조화한다. 없는 내용을 추가하지 않는다.",
    official_checker: "운영형 쉬운 안내문으로 쓴다. 제목과 첫 문장은 짧게 쓰고, 게시글에는 물음표를 넣지 않는다.",
    regional_planner: "지역, 이동, 숙박, 하객 동선 변수를 붙여서 서울 기준 일반론과 다르게 말한다.",
    guest_logistics: "하객이 실제로 이동하고 식사하는 장면을 기준으로 묻는다.",
    saving_tips: "절약 가능 항목과 아끼면 불안한 항목을 생활비 감각으로 가볍게 구분한다.",
    etiquette_writer: "하객이 읽을 문장의 뉘앙스, 예의, 부담감을 중심으로 말한다.",
    dress_focus: "드레스 기본 구성, 피팅비, 업그레이드 범위를 중심으로 묻는다.",
    photo_video_focus: "원본, 보정, 납품 일정처럼 촬영 결과물 조건을 중심으로 말한다.",
    schedule_planner: "예식장 날짜를 기준으로 역산하는 일정 감각을 유지한다.",
    home_and_loan: "결혼식 예산과 신혼집 예산이 섞이지 않게 나눠서 말한다.",
    parent_coordination: "양가 의견을 어떻게 꺼낼지 관계 중심으로 조심스럽게 말한다.",
    comparison_seeker: "A/B 선택지를 나란히 두고 비교 기준을 묻는다.",
    quiet_reactor: "짧게 반응하고 튀지 않는다. 긴 글보다 한 가지 질문을 남긴다.",
    news_curator: "출처가 확인된 뉴스와 통계만 다룬다. 공식 게시글은 쉬운 제목과 짧은 첫 문장으로 쓰고 물음표를 넣지 않는다.",
  };

  const actionGuide =
    action === "comment"
      ? "댓글은 선택된 글의 제목/본문 중 구체적인 한 부분에 반응해야 한다. 일반론만 쓰지 말고, 공감 1문장 + 확인 질문/체크포인트 1-2문장으로 작성한다."
      : action === "post"
        ? isOfficialAgent(agent)
          ? "공식 게시글은 실제 경험담을 꾸미지 않는다. 커뮤니티에 되묻지 말고 쉬운 안내문으로 쓴다. 제목과 본문에 물음표를 쓰지 않고, 물어볼 말은 알려 주세요/확인해 주세요로 끝낸다."
          : "게시글은 실제 경험담을 꾸미지 않는다. 현실적인 고민 상황 1개, 왜 헷갈리는지 1개, 커뮤니티에 묻는 질문 1-2개를 포함한다."
        : "해당 공간의 흐름을 정리하거나 조심스럽게 질문한다.";

  const styleDirective = [
    `Natural community voice: ${NATURAL_COMMUNITY_VOICE_GUIDE}`,
    `Persona naturalness: ${naturalnessGuide}`,
    `고유 스타일: ${styleGuide.voice}`,
    action === "comment" ? `댓글 형식: ${styleGuide.commentFormat}` : `게시글 형식: ${styleGuide.postFormat}`,
    `피할 것: ${styleGuide.avoid.join(", ")}`,
  ].join(" ");

  return [common, styleDirective, roleGuide[role] ?? "페르소나의 주제와 말투를 유지한다.", actionGuide].join(" ");
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
    NATURAL_COMMUNITY_VOICE_GUIDE,
    "Make the draft feel like it was typed by this specific persona today, not generated from a universal template.",
    "Casual is okay, but keep respectful polite Korean by default. Do not switch to banmal unless the persona samples already do.",
    "Write like a real Korean 예비부부 community member: specific, warm, slightly imperfect, and useful.",
    "Never invent a personal visit, contract, quote, booking, payment, vendor recommendation, or first-hand review.",
    "Do not write as if this persona already visited a vendor, received a quote, got a contract, booked, paid, or toured. Use '상담 전에', '견적을 볼 때', '계약 전에' instead.",
    "For comments, you must respond to the selected target post, not to the general topic.",
    "If you do not know, ask a careful question or give a checklist-style next step.",
    "Use only familiar wedding terms such as 기본가, 최종 총액, 대관료, 식대, 헬퍼비, 원본비, 수정본. Do not coin awkward terms like 기본금 or 피연금.",
    "Write natural Korean only. Do not mix in Japanese, Chinese, or untranslated foreign filler.",
    "Do not use awkward wedding coinages such as '신혼식', '축의금 계약', or '웨딩홀 얼마야'. Use ordinary terms like 예식, 축의금 안내, 웨딩홀 비용.",
    "Numeric, statistical, legal, policy, or news claims require HTTPS source URLs. Without sources, avoid those claims.",
    isOfficialAgent(input.agent)
      ? "This persona is a Hanbang official/branded account. Official posts must read like a plain vetted guide that a Korean middle-school student can understand. For posts, use a simple 12-34 character title, one short opening sentence, no question marks anywhere, polite request sentences ending with 알려 주세요/확인해 주세요 instead of questions, caveats, saved documents, and a final decision rule. Avoid weird titles or wording such as 이슈, 정리할게요, 바로 물어볼 질문, 초보 가이드 확인할 때, 괜찮겠지, and 검수 메모."
      : "",
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
    personaStyleGuide: personaStyleGuide(input.agent),
    personaNaturalnessGuide: personaNaturalnessGuide(input.agent),
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
      officialAccount: isOfficialAgent(input.agent)
        ? [
            "Branded Hanbang accounts should read like a review-ready easy official guide, not a normal user's quick thought.",
            "Official post titles must be plain Korean, 12-34 chars, no question marks, and no words such as 이슈, 정리할게요, 바로 물어볼 질문, 초보 가이드.",
            "The first sentence must be one simple sentence under 86 Korean chars that explains why the user should check this.",
            "Posts need 420+ Korean chars and clear sections such as 한눈에 보기, 확인할 것, 물어볼 말, 놓치기 쉬운 것, 저장할 것, 마지막 기준.",
            "Use request-style vendor prompts without question marks, such as 알려 주세요 or 확인해 주세요.",
            "Comments need to be target-specific, 130+ Korean chars, and include 2+ concrete checks plus one verification step.",
            "No first-person experience, no vendor judgment, no unsupported numbers, and no source-looking claims without HTTPS sourceUrls.",
          ]
        : null,
      comment: [
        "2-4 Korean sentences.",
        "Prefer 80-240 Korean chars. Do not pack a whole mini-post into a comment.",
        "First sentence must acknowledge the writer's concrete situation.",
        "Add one useful question, comparison point, or checklist item.",
        "Use natural chat-like Korean: readable, lightly casual, and not perfectly essay-like.",
        "Do not overdo typos. A tiny spacing variation is okay only if readability stays high.",
        "Do not say '좋은 글 감사합니다' or generic filler.",
        "Do not pretend you visited, contracted, paid, or received a quote.",
        "Do not repeat an existing comment. Add a new angle based on the selected commentIntent.",
        "Follow the personaStyleGuide. Do not reuse the structure or tone of another agent.",
      ],
      post: [
        "Title should be natural and specific, 18-45 Korean chars.",
        isOfficialAgent(input.agent)
          ? "For official accounts, content should be a compact easy mini-guide with useful sections, not 4-8 short casual lines. Do not include any question mark in title or content."
          : "Content should be 4-8 short lines.",
        isOfficialAgent(input.agent)
          ? "Do not ask the community a question. Give plain guidance, concrete checkpoints, and request-style sentences users can say to vendors."
          : "Include one realistic dilemma, one concrete checkpoint, and one question to the community.",
        "Sound like a current Korean community post: casual polite, not a blog intro, not a report.",
        "Small human imperfections are allowed only when they are subtle and readable.",
        "Follow the personaStyleGuide postFormat. Do not default to the same three-bullet template.",
        "Avoid shared phrases like '제가 먼저 나눠보고 싶은 건', '제가 나눠보고 싶은 건', or '세 가지예요'.",
        "No fake first-person vendor experience.",
        "No unsupported price averages or vendor ranking.",
        input.informationMode
          ? "For information posts, use Sonnet-level caution: if source-backed facts are unavailable, explicitly write that exact figures/news could not be verified. For sourcePolicy=required, contentOrigin must be news and sourceUrls must be real HTTPS URLs or an empty array for admin review."
          : "Question posts can stay personal and cautious without factual claims.",
      ],
    },
    constraints: {
      maxPostTitleChars: 72,
      maxCommentChars: isOfficialAgent(input.agent) ? 520 : 320,
      maxPostChars: isOfficialAgent(input.agent) ? 1800 : 1100,
      avoid: [
        "fake first-person experience",
        "vendor ranking without source",
        "medical/legal/financial certainty",
        "repeating another agent",
        "empty content",
        "generic sympathy with no connection to the target post",
        "overly polished blog tone",
        "customer-support script tone",
        "identical grammar and line structure across personas",
        "unreadable typos or forced slang",
      ],
    },
  });

  const startedAt = startLatencyClock();
  const message = await anthropic.messages.create({
    model: input.model,
    max_tokens: input.informationMode || isOfficialAgent(input.agent) ? 960 : 520,
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
    NATURAL_COMMUNITY_VOICE_GUIDE,
    "Keep the revision casually polite and persona-specific; do not make it sound like a formal blog, report, or customer-support answer.",
    "Remove awkward wedding coinages such as '신혼식', '축의금 계약', or '웨딩홀 얼마야'.",
    "Never invent a personal visit, contract, quote, booking, payment, vendor recommendation, or first-hand review.",
    isOfficialAgent(input.agent)
      ? "This is a Hanbang official/branded account revision. Rewrite weak drafts into a plain vetted guide that a Korean middle-school student can understand: simple title, one short opening sentence, no question marks anywhere, request-style vendor prompts ending with 알려 주세요/확인해 주세요, caveats, saved documents, and a final decision rule. Remove weird titles and wording such as 이슈, 정리할게요, 바로 물어볼 질문, 초보 가이드 확인할 때, 괜찮겠지, and 검수 메모."
      : "",
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
    personaStyleGuide: personaStyleGuide(input.agent),
    personaNaturalnessGuide: personaNaturalnessGuide(input.agent),
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
    officialQualityBar: isOfficialAgent(input.agent)
      ? {
          post: "420+ Korean chars, plain 12-34 char title, one short easy opening sentence, no question marks anywhere, sections for 한눈에 보기/확인할 것/물어볼 말/놓치기 쉬운 것/저장할 것/마지막 기준, and 2+ request-style sentences users can say to vendors.",
          comment: "130+ Korean chars, target-specific, 2+ concrete checks, and one verification step such as checking a contract, quote, message, or saved document.",
          avoid: ["first-person experience", "shallow checklist", "unsupported facts", "generic filler", "question marks", "이슈", "정리할게요", "바로 물어볼 질문", "번역투"],
        }
      : null,
  });

  const startedAt = startLatencyClock();
  const message = await anthropic.messages.create({
    model: input.model,
    max_tokens: input.informationMode || isOfficialAgent(input.agent) ? 900 : 480,
    temperature: 0.64,
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

    const runSeed = dryRun ? `${day}:${runId}:dry-run` : `${day}:${new Date().getUTCHours()}:automation-run`;
    const random = seededRandom(hashString(runSeed));
    const shuffledAgents = dryRun
      ? [...agents].sort(
          (left, right) => {
            const officialRank = Number(isOfficialAgent(right)) - Number(isOfficialAgent(left));
            if (officialRank !== 0) return officialRank;
            return hashString(`${runId}:${left.slug}:dry-run-order`) - hashString(`${runId}:${right.slug}:dry-run-order`);
          }
        )
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
        const officialMode = isOfficialAgent(agent) && action !== "reaction";
        const selectedModel = informationMode || officialMode ? informationModel : model;

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
            agent,
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
              agent,
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
              agent,
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

        if (informationMode && hasRequiredSourcePolicy(agent)) {
          const verifiedSourceUrls = normalizeAgentSourceUrls(generated.sourceUrls);
          if (verifiedSourceUrls.length === 0) {
            generated.requiresManualReview = true;
            generated.reason = [generated.reason, "missing_verified_source_for_admin_review"].filter(Boolean).join(" | ");
          } else {
            generated.sourceUrls = verifiedSourceUrls;
          }
        }

        const { draft, safety } = await createDraft(supabase, {
          agent,
          action: generated,
          runId,
          actorUserId: options.actorUserId,
          autoPublish,
        });

        const canPublish =
          autoPublish && !dryRun && draft.status !== "needs_review" && !safety.blocked && safety.status !== "source_required";
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
