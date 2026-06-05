import type { CohortThreadTopic } from "@/types/community.types";

export const VALID_COHORT_THREAD_TOPICS: CohortThreadTopic[] = [
  "price",
  "review",
  "concern",
  "chat",
];

type ScoredTopic = Exclude<CohortThreadTopic, "chat">;
type KeywordRule = {
  text: string;
  weight: number;
};

const PRICE_KEYWORDS: KeywordRule[] = [
  { text: "견적", weight: 5 },
  { text: "견적서", weight: 6 },
  { text: "가견적", weight: 5 },
  { text: "최종견적", weight: 6 },
  { text: "계약서", weight: 4 },
  { text: "가격", weight: 4 },
  { text: "비용", weight: 4 },
  { text: "금액", weight: 4 },
  { text: "얼마", weight: 4 },
  { text: "가격대", weight: 4 },
  { text: "만원", weight: 3 },
  { text: "만 원", weight: 3 },
  { text: "추가금", weight: 5 },
  { text: "추가비", weight: 4 },
  { text: "계약금", weight: 5 },
  { text: "예약금", weight: 5 },
  { text: "잔금", weight: 4 },
  { text: "입금", weight: 3 },
  { text: "지불", weight: 3 },
  { text: "납부", weight: 3 },
  { text: "위약금", weight: 5 },
  { text: "환불", weight: 4 },
  { text: "결제", weight: 3 },
  { text: "카드", weight: 2 },
  { text: "현금", weight: 2 },
  { text: "현금영수증", weight: 4 },
  { text: "부가세", weight: 4 },
  { text: "vat", weight: 4 },
  { text: "할인", weight: 4 },
  { text: "프로모션", weight: 3 },
  { text: "서비스", weight: 2 },
  { text: "포함", weight: 2 },
  { text: "미포함", weight: 4 },
  { text: "별도", weight: 3 },
  { text: "무료", weight: 2 },
  { text: "업그레이드", weight: 3 },
  { text: "패키지", weight: 3 },
  { text: "예산", weight: 3 },
  { text: "식대", weight: 5 },
  { text: "식비", weight: 4 },
  { text: "밥값", weight: 4 },
  { text: "대관료", weight: 5 },
  { text: "대관", weight: 4 },
  { text: "보증인원", weight: 5 },
  { text: "최소보증", weight: 5 },
  { text: "보증 인원", weight: 5 },
  { text: "헬퍼비", weight: 5 },
  { text: "헬퍼", weight: 3 },
  { text: "지정비", weight: 4 },
  { text: "지정", weight: 2 },
  { text: "피팅비", weight: 4 },
  { text: "피팅", weight: 2 },
  { text: "출장비", weight: 4 },
  { text: "출장", weight: 2 },
  { text: "원본", weight: 3 },
  { text: "원본비", weight: 5 },
  { text: "수정본", weight: 3 },
  { text: "수정비", weight: 5 },
  { text: "앨범", weight: 2 },
  { text: "액자", weight: 2 },
  { text: "꽃장식", weight: 3 },
  { text: "플라워", weight: 2 },
  { text: "혼주메이크업", weight: 4 },
  { text: "혼주 메이크업", weight: 4 },
  { text: "본식스냅", weight: 3 },
  { text: "본식 스냅", weight: 3 },
  { text: "DVD", weight: 2 },
  { text: "영상", weight: 2 },
  { text: "스드메", weight: 2 },
  { text: "웨딩홀", weight: 2 },
  { text: "예식장", weight: 2 },
  { text: "드레스샵", weight: 2 },
  { text: "드레스 샵", weight: 2 },
  { text: "메이크업샵", weight: 2 },
  { text: "스튜디오", weight: 2 },
  { text: "가성비", weight: 3 },
  { text: "비싸", weight: 4 },
  { text: "저렴", weight: 4 },
  { text: "싼", weight: 2 },
  { text: "합리적", weight: 2 },
];

const REVIEW_KEYWORDS: KeywordRule[] = [
  { text: "후기", weight: 5 },
  { text: "다녀왔", weight: 4 },
  { text: "방문", weight: 3 },
  { text: "투어", weight: 4 },
  { text: "상담받", weight: 4 },
  { text: "계약했", weight: 4 },
  { text: "시식", weight: 4 },
  { text: "촬영", weight: 3 },
  { text: "본식", weight: 2 },
  { text: "추천", weight: 3 },
  { text: "비추천", weight: 4 },
  { text: "만족", weight: 3 },
  { text: "불만", weight: 3 },
  { text: "별로", weight: 3 },
  { text: "좋았", weight: 3 },
  { text: "아쉬", weight: 3 },
  { text: "실장", weight: 2 },
  { text: "플래너", weight: 2 },
];

const CONCERN_KEYWORDS: KeywordRule[] = [
  { text: "고민", weight: 5 },
  { text: "걱정", weight: 4 },
  { text: "불안", weight: 4 },
  { text: "괜찮", weight: 4 },
  { text: "어떻게", weight: 3 },
  { text: "어때", weight: 3 },
  { text: "해야", weight: 3 },
  { text: "할까", weight: 4 },
  { text: "맞을까", weight: 4 },
  { text: "고르", weight: 3 },
  { text: "선택", weight: 3 },
  { text: "궁금", weight: 3 },
  { text: "질문", weight: 3 },
  { text: "언제", weight: 3 },
  { text: "뭐가 나", weight: 3 },
  { text: "어느 쪽", weight: 3 },
];

const CURRENCY_PATTERNS = [
  /\d+(?:\.\d+)?\s*(?:만원|만\s*원|천만원|억원|억|원)/i,
  /(?:₩|￦)\s*\d+/,
  /\d+(?:\.\d+)?\s*%/,
];

const PRICE_QUESTION_PATTERN = /(얼마(?!나)|가격대|견적|비용|금액).{0,12}(?:야|일까|인가|나와|나왔|받았|정도|쯤|비싸|저렴|괜찮)/;
const PRICE_CONTEXT_PATTERN = /(웨딩홀|예식장|스드메|스튜디오|드레스|메이크업|스냅|영상|본식|부케|혼주).{0,16}(?:얼마|견적|가격|비용|금액|추가|포함|별도|할인|계약|예약금|계약금)/;

function normalizeContent(content: string) {
  return content
    .replace(/\[post:[^\]]+\]/g, " ")
    .replace(/\[img:[^\]]+\]/g, " ")
    .replace(/@\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function scoreKeywords(text: string, rules: KeywordRule[]) {
  return rules.reduce((score, rule) => (
    text.includes(rule.text.toLowerCase()) ? score + rule.weight : score
  ), 0);
}

function scorePatterns(text: string) {
  let score = 0;
  if (CURRENCY_PATTERNS.some((pattern) => pattern.test(text))) score += 8;
  if (PRICE_QUESTION_PATTERN.test(text)) score += 6;
  if (PRICE_CONTEXT_PATTERN.test(text)) score += 6;
  return score;
}

export function normalizeCohortThreadTopic(topic?: string | null): CohortThreadTopic | null {
  return VALID_COHORT_THREAD_TOPICS.includes(topic as CohortThreadTopic)
    ? (topic as CohortThreadTopic)
    : null;
}

export function inferCohortThreadTopic(content: string): CohortThreadTopic {
  const normalized = normalizeContent(content);
  if (!normalized) return "chat";

  const scores: Record<ScoredTopic, number> = {
    price: scoreKeywords(normalized, PRICE_KEYWORDS) + scorePatterns(normalized),
    review: scoreKeywords(normalized, REVIEW_KEYWORDS),
    concern: scoreKeywords(normalized, CONCERN_KEYWORDS),
  };

  if (scores.price >= 5) return "price";

  const ranked = (Object.entries(scores) as Array<[ScoredTopic, number]>)
    .sort((a, b) => b[1] - a[1]);
  const [bestTopic, bestScore] = ranked[0];

  if (bestScore <= 0) return "chat";
  if (bestTopic === "concern" && scores.review >= bestScore && scores.review > 0) {
    return "review";
  }

  return bestTopic;
}

export function resolveCohortThreadTopic(
  storedTopic: string | null | undefined,
  content: string
): CohortThreadTopic {
  const normalizedStored = normalizeCohortThreadTopic(storedTopic);
  const inferred = inferCohortThreadTopic(content);

  if (!normalizedStored) return inferred;
  if (inferred === "price") return "price";
  if (normalizedStored === "chat" && inferred !== "chat") return inferred;
  return normalizedStored;
}
