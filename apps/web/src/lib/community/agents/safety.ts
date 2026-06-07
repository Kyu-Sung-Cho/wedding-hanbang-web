export type AgentContentOrigin =
  | "question"
  | "comment"
  | "summary"
  | "news"
  | "checklist"
  | "reaction";

export type AgentVerificationStatus =
  | "question_only"
  | "source_not_required"
  | "source_required"
  | "source_verified"
  | "blocked";

export interface AgentContentSafetyResult {
  status: AgentVerificationStatus;
  blocked: boolean;
  needsReview: boolean;
  flags: string[];
  normalizedSourceUrls: string[];
}

const FIRST_PERSON_EXPERIENCE_RE =
  /(제가|저는|저희|나는|나도|저도).{0,40}(계약했|계약을 했|다녀왔|방문했|상담받|상담을 받|견적받|견적을 받|예약했|결제했|투어했|가봤)/;

const NUMERIC_CLAIM_RE =
  /\d[\d,.]*\s*(만원|원|%|퍼센트|명|건|팀|개월|년|회)/;

const SOURCE_CLAIM_RE =
  /(기사|뉴스|통계|조사|소비자원|공정위|정부|지자체|보고서|자료|출처|평균|피해 사례|법|정책)/;

const VENDOR_JUDGMENT_RE =
  /([가-힣A-Za-z0-9·\s]{2,24}(웨딩홀|스튜디오|드레스|메이크업|플래너|DVD|스냅)).{0,36}(추천|비추천|최고|최악|별로|사기|무조건|제일)/;

const QUESTION_RE =
  /[?？]|궁금|어떻게|괜찮|맞나요|하나요|해야 하나|얼마|어느 정도|모르겠|고민/;

function stripTags(input: string): string {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeAgentSourceUrls(sourceUrls: unknown): string[] {
  if (!Array.isArray(sourceUrls)) return [];

  return sourceUrls
    .map((url) => (typeof url === "string" ? url.trim() : ""))
    .filter((url) => /^https:\/\/\S+\.\S+/.test(url))
    .slice(0, 8);
}

export function validateAgentContent(input: {
  origin: AgentContentOrigin;
  title?: string | null;
  content: string;
  sourceUrls?: unknown;
}): AgentContentSafetyResult {
  const normalizedSourceUrls = normalizeAgentSourceUrls(input.sourceUrls);
  const text = stripTags(`${input.title ?? ""}\n${input.content ?? ""}`);
  const flags: string[] = [];

  if (!text || text.length < 2) {
    flags.push("empty_content");
  }

  if (FIRST_PERSON_EXPERIENCE_RE.test(text)) {
    flags.push("blocked_fake_first_person_experience");
  }

  if (VENDOR_JUDGMENT_RE.test(text)) {
    flags.push("blocked_vendor_judgment_without_review");
  }

  const hasNumericClaim = NUMERIC_CLAIM_RE.test(text);
  const hasSourceClaim = SOURCE_CLAIM_RE.test(text);
  const looksLikeQuestion = QUESTION_RE.test(text);
  const requiresSource =
    input.origin === "news" ||
    (input.origin !== "question" && input.origin !== "reaction" && (hasSourceClaim || (hasNumericClaim && !looksLikeQuestion)));

  if (requiresSource && normalizedSourceUrls.length === 0) {
    flags.push("source_required");
  }

  const blocked = flags.some((flag) => flag.startsWith("blocked_")) || flags.includes("empty_content");

  let status: AgentVerificationStatus = "source_not_required";
  if (blocked) {
    status = "blocked";
  } else if (requiresSource && normalizedSourceUrls.length > 0) {
    status = "source_verified";
  } else if (requiresSource) {
    status = "source_required";
  } else if (input.origin === "question" || looksLikeQuestion) {
    status = "question_only";
  }

  return {
    status,
    blocked,
    needsReview: blocked || status === "source_required" || flags.length > 0,
    flags,
    normalizedSourceUrls,
  };
}
