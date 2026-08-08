import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { resolveCohortThreadTopic } from "@/lib/community/cohortTopicClassifier";
import type { CohortThreadTopic } from "@/types/community.types";

type DigestPeriod = "today" | "week";

type MessageRow = {
  id: string;
  content: string;
  author_id: string;
  thread_topic: string | null;
  created_at: string;
};

type CleanedMessage = MessageRow & {
  clean: string;
  topic: CohortThreadTopic;
};

type SubtopicRule = {
  id: string;
  label: string;
  group: "price" | "vendor" | "schedule" | "relationship" | "prep";
  topicHint?: CohortThreadTopic;
  keywords: string[];
};

type SubtopicCluster = {
  rule: SubtopicRule;
  count: number;
  score: number;
  messages: CleanedMessage[];
  keywords: Map<string, number>;
  questionCount: number;
  authors: Set<string>;
  latestAt: number;
};

const TOPIC_LABEL: Record<CohortThreadTopic, string> = {
  price: "가격",
  review: "후기",
  concern: "고민",
  chat: "수다",
};

const TOPIC_ORDER: CohortThreadTopic[] = ["price", "review", "concern", "chat"];

const KEYWORD_GROUPS: Record<CohortThreadTopic, string[]> = {
  price: [
    "견적",
    "계약금",
    "예약금",
    "추가금",
    "식대",
    "대관료",
    "보증인원",
    "헬퍼비",
    "지정비",
    "원본",
    "수정본",
    "할인",
    "포함",
    "별도",
  ],
  review: ["후기", "투어", "상담", "방문", "시식", "촬영", "추천", "비추천", "만족", "아쉬"],
  concern: ["고민", "걱정", "괜찮", "어때", "할까", "궁금", "질문", "선택", "언제"],
  chat: ["안녕", "수다", "공유", "준비", "오늘", "이번주"],
};

const SUBTOPIC_GROUP_LABEL: Record<SubtopicRule["group"], string> = {
  price: "가격",
  vendor: "업체",
  schedule: "일정",
  relationship: "관계",
  prep: "준비",
};

const SUBTOPIC_RULES: SubtopicRule[] = [
  {
    id: "general_quote",
    label: "견적·비용 질문",
    group: "price",
    topicHint: "price",
    keywords: ["견적", "가격", "비용", "금액", "얼마", "만원", "만 원", "비싸", "저렴"],
  },
  {
    id: "venue_quote",
    label: "결혼식장 견적·식사비",
    group: "price",
    topicHint: "price",
    keywords: ["웨딩홀", "예식장", "홀", "식대", "대관료", "보증인원", "최소보증", "꽃장식", "주차", "시식"],
  },
  {
    id: "sdm_package",
    label: "사진 촬영·드레스·헤어·메이크업 묶음",
    group: "price",
    topicHint: "price",
    keywords: ["스드메", "패키지", "스튜디오", "드레스", "메이크업", "추가금", "포함", "별도"],
  },
  {
    id: "studio_shoot",
    label: "웨딩 사진 촬영",
    group: "vendor",
    keywords: ["스튜디오", "촬영", "원본", "수정본", "앨범", "액자", "컨셉", "야외", "한복"],
  },
  {
    id: "dress",
    label: "드레스 입어보기·수선",
    group: "vendor",
    keywords: ["드레스", "드레스샵", "드레스 샵", "피팅", "투어", "가봉", "본식드레스", "셀렉"],
  },
  {
    id: "makeup",
    label: "헤어·메이크업",
    group: "vendor",
    keywords: ["메이크업", "메이크업샵", "헤어", "혼주메이크업", "혼주 메이크업", "샵", "실장"],
  },
  {
    id: "snap_video",
    label: "결혼식 날 사진·영상",
    group: "vendor",
    keywords: ["스냅", "본식스냅", "본식 스냅", "DVD", "영상", "작가", "촬영팀", "원본"],
  },
  {
    id: "contract_payment",
    label: "계약·결제 조건",
    group: "price",
    topicHint: "price",
    keywords: ["계약", "계약서", "계약금", "예약금", "잔금", "환불", "위약금", "카드", "현금영수증", "부가세"],
  },
  {
    id: "discount_budget",
    label: "할인·예산 조정",
    group: "price",
    topicHint: "price",
    keywords: ["할인", "프로모션", "서비스", "예산", "비싸", "저렴", "가성비", "절약", "추가비", "추가금"],
  },
  {
    id: "booking_schedule",
    label: "예약·일정 잡기",
    group: "schedule",
    keywords: ["예약", "일정", "날짜", "시간", "가능", "D-", "디데이", "방문", "상담", "투어"],
  },
  {
    id: "family_etiquette",
    label: "부모님 첫 만남·가족 예절",
    group: "relationship",
    keywords: ["상견례", "혼주", "부모님", "양가", "예절", "첫인사", "인사", "복장", "선물"],
  },
  {
    id: "guest_invitation",
    label: "종이·모바일 초대장·하객",
    group: "prep",
    keywords: ["청첩장", "모바일청첩장", "하객", "축의금", "답례", "식권", "좌석", "초대"],
  },
  {
    id: "honeymoon",
    label: "신혼여행",
    group: "prep",
    keywords: ["신혼여행", "허니문", "여행", "항공", "숙소", "리조트", "몰디브", "발리"],
  },
  {
    id: "decision_concern",
    label: "선택 고민",
    group: "relationship",
    topicHint: "concern",
    keywords: ["고민", "걱정", "괜찮", "어때", "할까", "맞을까", "선택", "추천", "비추천"],
  },
  {
    id: "prep_progress",
    label: "준비 진행 상황",
    group: "prep",
    keywords: ["완료", "진행", "준비", "체크", "체크리스트", "등록", "공유", "오늘", "이번주"],
  },
];

const GENERIC_SUBTOPIC_IDS = new Set(["general_quote"]);
const DIGEST_MESSAGE_LIMIT = 300;
const SUBTOPIC_LIMIT = 8;
const REPRESENTATIVE_SCORE_MAX_POINTS = {
  frequency: 34,
  participants: 30,
  questions: 10,
  specificity: 20,
};

function isGenericSubtopic(id: string) {
  return GENERIC_SUBTOPIC_IDS.has(id);
}

function normalizedLogScore(value: number, maxValue: number, maxPoints: number) {
  if (value <= 0 || maxValue <= 0) return 0;
  return (Math.log1p(value) / Math.log1p(maxValue)) * maxPoints;
}

function buildRecencyScore(latestAt: number) {
  if (!Number.isFinite(latestAt) || latestAt <= 0) return 0;
  const hours = (Date.now() - latestAt) / (1000 * 60 * 60);
  if (hours <= 2) return 6;
  if (hours <= 6) return 4;
  if (hours <= 24) return 2;
  if (hours <= 72) return 1;
  return 0;
}

function buildRepresentativeScore(
  cluster: SubtopicCluster,
  context: {
    maxCount: number;
    maxParticipants: number;
    maxQuestions: number;
    maxSpecificity: number;
  }
) {
  const participantCount = cluster.authors.size;
  const averageSpecificity = cluster.score / Math.max(cluster.count, 1);
  const frequencyScore = normalizedLogScore(
    cluster.count,
    context.maxCount,
    REPRESENTATIVE_SCORE_MAX_POINTS.frequency
  );
  const diversityScore = normalizedLogScore(
    participantCount,
    context.maxParticipants,
    REPRESENTATIVE_SCORE_MAX_POINTS.participants
  );
  const questionScore = normalizedLogScore(
    cluster.questionCount,
    context.maxQuestions,
    REPRESENTATIVE_SCORE_MAX_POINTS.questions
  );
  const specificityScore = normalizedLogScore(
    averageSpecificity,
    context.maxSpecificity,
    REPRESENTATIVE_SCORE_MAX_POINTS.specificity
  );
  const recencyScore = buildRecencyScore(cluster.latestAt);

  return {
    total: frequencyScore + diversityScore + questionScore + specificityScore + recencyScore,
    frequencyScore,
    diversityScore,
    questionScore,
    specificityScore,
    recencyScore,
  };
}

function hasRepresentativeSignal(cluster: SubtopicCluster) {
  return (
    cluster.count >= 2 ||
    cluster.authors.size >= 2 ||
    (cluster.questionCount > 0 && cluster.score >= 4) ||
    cluster.score >= 8
  );
}

function kstParts(date: Date) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    year: kst.getUTCFullYear(),
    month: kst.getUTCMonth(),
    date: kst.getUTCDate(),
    day: kst.getUTCDay(),
  };
}

function kstDateStartUtc(parts: { year: number; month: number; date: number }) {
  return new Date(Date.UTC(parts.year, parts.month, parts.date) - 9 * 60 * 60 * 1000);
}

function getPeriodStart(period: DigestPeriod) {
  const now = new Date();
  const parts = kstParts(now);
  if (period === "today") return kstDateStartUtc(parts);

  const mondayOffset = (parts.day + 6) % 7;
  return kstDateStartUtc({
    year: parts.year,
    month: parts.month,
    date: parts.date - mondayOffset,
  });
}

async function ensureActiveMember(
  supabase: Awaited<ReturnType<typeof createClientFromRequest>>,
  roomId: string,
  userId: string
) {
  const { data } = await supabase
    .from("cohort_members")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  return !!data;
}

function redactSensitiveText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[이메일]")
    .replace(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g, "[연락처]")
    .replace(/\b\d{2,6}[-\s.]\d{2,6}[-\s.]\d{2,8}\b/g, "[번호]")
    .replace(/\b\d{10,16}\b/g, "[번호]");
}

function cleanContent(content: string) {
  const withPostTitles = content.replace(/\[post:[^|\]]+\|([^\]]+)\]/g, "공유글: $1");
  const withImages = withPostTitles.replace(/\[img:[^\]]+\]/g, "사진 공유");
  const withoutMentions = withImages.replace(/@\[[^|\]]+\|[^\]]+\]/g, "");
  return redactSensitiveText(withoutMentions)
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value: string, max = 56) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function countKeywords(messages: string[], topic: CohortThreadTopic) {
  const joined = messages.join(" ");
  return KEYWORD_GROUPS[topic]
    .map((keyword) => ({
      keyword,
      count: (joined.match(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length,
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword, "ko"))
    .slice(0, 4)
    .map((item) => item.keyword);
}

function getKeywordHits(content: string, keywords: string[]) {
  const lowered = content.toLowerCase();
  return keywords.filter((keyword) => lowered.includes(keyword.toLowerCase()));
}

function isQuestionLike(content: string) {
  return /[?？]|(얼마|어때|할까|괜찮|추천|궁금|알아|가능|언제|해야|맞을까|될까)/.test(content);
}

function buildSubtopicSummary(
  label: string,
  group: SubtopicRule["group"],
  keywords: string[],
  sample: string
) {
  const keywordText = keywords.length > 0 ? keywords.slice(0, 3).join(", ") : SUBTOPIC_GROUP_LABEL[group];

  if (group === "price") {
    return `${keywordText} 기준으로 비용과 조건을 비교하는 이야기가 있었어요${sample ? `: ${clip(sample)}` : "."}`;
  }
  if (group === "vendor") {
    return `${label} 관련 업체 경험과 선택 기준이 공유됐어요${sample ? `: ${clip(sample)}` : "."}`;
  }
  if (group === "schedule") {
    return `${label} 흐름에서 방문 가능 시간과 다음 일정을 맞추는 맥락이 보여요${sample ? `: ${clip(sample)}` : "."}`;
  }
  if (group === "relationship") {
    return `${label}처럼 혼자 결정하기 애매한 부분을 같이 확인하고 있어요${sample ? `: ${clip(sample)}` : "."}`;
  }
  return `${label}에 대한 준비 상태와 다음 체크 포인트가 오갔어요${sample ? `: ${clip(sample)}` : "."}`;
}

function buildSubtopicAction(label: string, group: SubtopicRule["group"]) {
  if (group === "price") return "금액·포함·별도 조건을 한 줄로 남기면 나중에 평균 비교가 쉬워요.";
  if (group === "vendor") return "좋았던 점과 아쉬웠던 점을 나눠 남기면 다른 사람이 비교할 때 상황을 이해하기 쉬워요.";
  if (group === "schedule") return "확정된 날짜는 준비 기록에 남겨두면 동기방 흐름과 내 일정이 이어져요.";
  if (group === "relationship") return "누가 무엇을 원했고 어디서 막혔는지 함께 적으면 다른 사람이 같은 상황인지 비교하기 쉬워요.";
  return `${label}은 완료 여부를 짧게 남겨두면 다음 사람이 준비 순서를 따라오기 쉬워요.`;
}

function extractMoneyValues(content: string) {
  return content.match(/\d+(?:\.\d+)?\s*(?:만원|만\s*원|천만원|억원|억|원)/g) ?? [];
}

function compactMessageTitle(content: string) {
  return clip(
    content
      .replace(/^(오늘|어제|혹시|저도|제가|저희|다들)\s*/g, "")
      .replace(/\s+/g, " ")
      .replace(/[.。!?！？]+$/g, ""),
    44
  );
}

function buildSubtopicTitle(rule: SubtopicRule, sample: string, keywords: string[]) {
  const moneyValues = extractMoneyValues(sample);
  const firstMoney = moneyValues[0];
  const lastMoney = moneyValues[moneyValues.length - 1];
  const guaranteeMatch = sample.match(/(?:보증인원|보증 인원|최소보증|보증)\s*(\d+\s*명?)/);
  const placeCount = sample.match(/(\d+)\s*곳/);
  const hasQuestion = isQuestionLike(sample);

  if (rule.id === "venue_quote") {
    const bits: string[] = [];
    if (firstMoney) bits.push(`식대 ${firstMoney.replace(/\s+/g, "")}`);
    if (guaranteeMatch?.[1]) bits.push(`최소 결제 식사 인원 ${guaranteeMatch[1].replace(/\s+/g, "")}`);
    if (/대관료.{0,8}별도|별도.{0,8}대관료/.test(sample)) bits.push("장소 사용료 별도");
    if (bits.length > 0) return `${bits.join(" · ")}라 총액 확인 필요`;
  }

  if (rule.id === "sdm_package" && firstMoney) {
    if (lastMoney && lastMoney !== firstMoney) {
      return `사진·드레스·메이크업 ${firstMoney.replace(/\s+/g, "")} 견적이 별도 항목 포함 ${lastMoney.replace(/\s+/g, "")}`;
    }
    return `사진·드레스·메이크업 ${firstMoney.replace(/\s+/g, "")} 견적 공유`;
  }

  if (rule.id === "dress") {
    if (placeCount?.[1] && /충분|괜찮|고민|어디까지/.test(sample)) {
      return `드레스 매장 ${placeCount[1]}곳을 방문하면 충분한지 고민`;
    }
    if (/피팅비/.test(sample)) return "드레스 입어보기 비용과 방문 범위 비교";
  }

  if (rule.id === "snap_video") {
    if (/원본/.test(sample) && /지정비|작가/.test(sample)) {
      return "결혼식 날 촬영한 전체 사진 파일·촬영자 지정 비용 확인 필요";
    }
    if (/DVD|영상/.test(sample)) return "결혼식 날 영상을 뺄지 남길지 고민";
  }

  if (rule.id === "contract_payment") {
    if (/환불|위약금/.test(sample)) return "계약금 환불·위약금 조건 확인 필요";
    if (/계약금|예약금/.test(sample)) return "계약금·예약금 조건 공유";
  }

  if (rule.id === "general_quote") {
    if (firstMoney && hasQuestion) return `${firstMoney.replace(/\s+/g, "")} 견적이 괜찮은지 질문`;
    if (firstMoney) return `${firstMoney.replace(/\s+/g, "")} 비용 조건 공유`;
  }

  if (rule.id === "decision_concern" && hasQuestion) {
    return `${keywords[0] ?? "선택"} 관련 결정 전 질문`;
  }

  return compactMessageTitle(sample);
}

function buildSubtopics(messages: CleanedMessage[]) {
  const clusterMap = new Map<string, SubtopicCluster>();

  for (const message of messages) {
    if (!message.clean) continue;

    const scoredRules = SUBTOPIC_RULES.map((rule) => {
      const hits = getKeywordHits(message.clean, rule.keywords);
      const topicBonus = hits.length > 0 && rule.topicHint && rule.topicHint === message.topic ? 2 : 0;
      return {
        rule,
        hits,
        score: hits.length * 2 + topicBonus,
      };
    })
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        const genericPenalty = Number(isGenericSubtopic(a.rule.id)) - Number(isGenericSubtopic(b.rule.id));
        return b.score - a.score || genericPenalty || b.hits.length - a.hits.length;
      })
      .slice(0, 1);

    for (const item of scoredRules) {
      const current = clusterMap.get(item.rule.id) ?? {
        rule: item.rule,
        count: 0,
        score: 0,
        messages: [],
        keywords: new Map<string, number>(),
        questionCount: 0,
        authors: new Set<string>(),
        latestAt: 0,
      };
      current.count += 1;
      current.score += item.score;
      if (current.messages.length < 3) current.messages.push(message);
      if (isQuestionLike(message.clean)) current.questionCount += 1;
      current.authors.add(message.author_id);
      const createdAt = Date.parse(message.created_at);
      if (Number.isFinite(createdAt)) current.latestAt = Math.max(current.latestAt, createdAt);
      for (const keyword of item.hits) {
        current.keywords.set(keyword, (current.keywords.get(keyword) ?? 0) + 1);
      }
      clusterMap.set(item.rule.id, current);
    }
  }

  const clusters = [...clusterMap.values()];
  const hasSpecificPriceCluster = clusters.some(
    (cluster) => cluster.rule.group === "price" && !isGenericSubtopic(cluster.rule.id)
  );

  const candidates = clusters
    .filter((cluster) => !(hasSpecificPriceCluster && isGenericSubtopic(cluster.rule.id)))
    .filter(hasRepresentativeSignal);
  const scoreContext = {
    maxCount: Math.max(...candidates.map((cluster) => cluster.count), 0),
    maxParticipants: Math.max(...candidates.map((cluster) => cluster.authors.size), 0),
    maxQuestions: Math.max(...candidates.map((cluster) => cluster.questionCount), 0),
    maxSpecificity: Math.max(
      ...candidates.map((cluster) => cluster.score / Math.max(cluster.count, 1)),
      0
    ),
  };

  return candidates
    .map((cluster) => ({
      cluster,
      representativeScore: buildRepresentativeScore(cluster, scoreContext),
    }))
    .sort(
      (a, b) =>
        b.representativeScore.total - a.representativeScore.total ||
        b.cluster.count - a.cluster.count ||
        b.cluster.authors.size - a.cluster.authors.size ||
        b.cluster.score - a.cluster.score ||
        a.cluster.rule.label.localeCompare(b.cluster.rule.label, "ko")
    )
    .slice(0, SUBTOPIC_LIMIT)
    .map(({ cluster, representativeScore }) => {
      const keywords = [...cluster.keywords.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
        .slice(0, 4)
        .map(([keyword]) => keyword);
      const primaryMessage = cluster.messages[0];
      const sample = primaryMessage?.clean ?? "";
      return {
        id: cluster.rule.id,
        label: cluster.rule.label,
        group: cluster.rule.group,
        groupLabel: SUBTOPIC_GROUP_LABEL[cluster.rule.group],
        count: cluster.count,
        participantCount: cluster.authors.size,
        questionCount: cluster.questionCount,
        keywords,
        title: buildSubtopicTitle(cluster.rule, sample, keywords),
        primaryMessageId: primaryMessage?.id ?? null,
        messageIds: cluster.messages.map((message) => message.id),
        representativeScore,
        sample: clip(sample, 72),
        summary: buildSubtopicSummary(cluster.rule.label, cluster.rule.group, keywords, sample),
        action: buildSubtopicAction(cluster.rule.label, cluster.rule.group),
      };
    });
}

function makeLead(
  period: DigestPeriod,
  topTopic: CohortThreadTopic | null,
  messageCount: number,
  topSubtopic?: string
) {
  if (messageCount === 0) {
    return period === "today"
      ? "오늘은 아직 동기방 대화가 많지 않아요."
      : "이번주는 아직 정리할 만큼 대화가 많지 않아요.";
  }
  if (topSubtopic) {
    return `${period === "today" ? "오늘은" : "이번주는"} ${topSubtopic}이 가장 많이 나왔어요.`;
  }
  if (!topTopic) return "동기방 대화를 짧게 정리했어요.";
  return `${period === "today" ? "오늘은" : "이번주는"} ${TOPIC_LABEL[topTopic]} 이야기가 가장 많이 오갔어요.`;
}

function buildHighlights(grouped: Record<CohortThreadTopic, string[]>) {
  const highlights: string[] = [];

  for (const topic of TOPIC_ORDER) {
    const messages = grouped[topic];
    if (messages.length === 0) continue;

    const keywords = countKeywords(messages, topic);
    const example = messages.find((message) => message.length > 0);
    const prefix = keywords.length > 0
      ? `${keywords.join(", ")}`
      : TOPIC_LABEL[topic];

    if (topic === "price") {
      highlights.push(`${prefix} 관련 가격 맥락이 나왔어요${example ? `: ${clip(example)}` : "."}`);
    } else if (topic === "review") {
      highlights.push(`${prefix} 중심으로 실제 경험 공유가 있었어요${example ? `: ${clip(example)}` : "."}`);
    } else if (topic === "concern") {
      highlights.push(`${prefix}처럼 결정 전 확인할 질문이 모였어요${example ? `: ${clip(example)}` : "."}`);
    } else if (messages.length >= 2) {
      highlights.push(`가벼운 수다와 준비 상황 공유도 이어졌어요.`);
    }
  }

  return highlights.slice(0, 4);
}

function buildNextActions(counts: Record<CohortThreadTopic, number>, imageCount: number) {
  const actions: string[] = [];

  if (counts.price > 0) {
    actions.push("가격 이야기는 필터에서 다시 보고, 확정 금액은 익명 가격 평균에 등록해보세요.");
  }
  if (counts.concern > 0) {
    actions.push("답이 필요한 고민은 한 번 더 끌어올리면 동기들이 이어서 답하기 좋아요.");
  }
  if (counts.review > 0) {
    actions.push("좋았던 후기나 주의할 점은 커뮤니티 글로 남기면 나중에 다시 찾기 쉬워요.");
  }
  if (imageCount > 0) {
    actions.push("사진 속 견적·계약 조건을 분석하려면 아모라 채팅에서 확인 후 공유하는 흐름이 안전해요.");
  }

  return actions.slice(0, 3);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: roomId } = await params;
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const member = await ensureActiveMember(supabase, roomId, user.id);
    if (!member) {
      return NextResponse.json(
        { error: "해당 동기방의 활성 멤버만 이용할 수 있습니다." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const period: DigestPeriod = searchParams.get("period") === "week" ? "week" : "today";
    const since = getPeriodStart(period).toISOString();

    const { data, error } = await supabase
      .from("cohort_messages")
      .select("id, content, author_id, thread_topic, created_at")
      .eq("room_id", roomId)
      .eq("is_deleted", false)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(DIGEST_MESSAGE_LIMIT);

    if (error) {
      console.error("Cohort digest load error:", error);
      return NextResponse.json(
        { error: "동기방 요약을 불러오지 못했습니다." },
        { status: 500 }
      );
    }

    const messages = ((data ?? []) as MessageRow[]).reverse();
    const grouped: Record<CohortThreadTopic, string[]> = {
      price: [],
      review: [],
      concern: [],
      chat: [],
    };
    const counts: Record<CohortThreadTopic, number> = {
      price: 0,
      review: 0,
      concern: 0,
      chat: 0,
    };
    let imageCount = 0;

    const cleanedMessages = messages.map((message) => {
      if (message.content.includes("[img:")) imageCount += 1;
      const clean = cleanContent(message.content);
      const topic = resolveCohortThreadTopic(message.thread_topic, message.content);
      counts[topic] += 1;
      if (clean) grouped[topic].push(clean);
      return { ...message, clean, topic };
    });

    const topTopic = TOPIC_ORDER
      .filter((topic) => counts[topic] > 0)
      .sort((a, b) => counts[b] - counts[a] || TOPIC_ORDER.indexOf(a) - TOPIC_ORDER.indexOf(b))[0] ?? null;
    const subtopics = buildSubtopics(cleanedMessages);

    const questions = cleanedMessages
      .filter((message) => message.clean && isQuestionLike(message.clean))
      .slice(-4)
      .reverse()
      .map((message) => ({
        topic: message.topic,
        label: TOPIC_LABEL[message.topic],
        text: clip(message.clean, 64),
      }));

    const payload = {
      period,
      generatedAt: new Date().toISOString(),
      messageCount: messages.length,
      imageCount,
      lead: makeLead(period, topTopic, messages.length, subtopics[0]?.label),
      topicBreakdown: TOPIC_ORDER.map((topic) => ({
        topic,
        label: TOPIC_LABEL[topic],
        count: counts[topic],
      })).filter((item) => item.count > 0),
      subtopics,
      highlights: buildHighlights(grouped),
      questions,
      nextActions: buildNextActions(counts, imageCount),
      empty: messages.length === 0,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, max-age=120",
      },
    });
  } catch (err) {
    console.error("Cohort digest error:", err);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
