import { createClientFromRequest } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { resolveCohortThreadTopic } from "@/lib/community/cohortTopicClassifier";
import type { CohortThreadTopic } from "@/types/community.types";

type DigestPeriod = "today" | "week";

type MessageRow = {
  id: string;
  content: string;
  thread_topic: string | null;
  created_at: string;
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

function isQuestionLike(content: string) {
  return /[?？]|(얼마|어때|할까|괜찮|추천|궁금|알아|가능|언제|해야|맞을까|될까)/.test(content);
}

function makeLead(period: DigestPeriod, topTopic: CohortThreadTopic | null, messageCount: number) {
  if (messageCount === 0) {
    return period === "today"
      ? "오늘은 아직 동기방 대화가 많지 않아요."
      : "이번주는 아직 정리할 만큼 대화가 많지 않아요.";
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
      .select("id, content, thread_topic, created_at")
      .eq("room_id", roomId)
      .eq("is_deleted", false)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(80);

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
      lead: makeLead(period, topTopic, messages.length),
      topicBreakdown: TOPIC_ORDER.map((topic) => ({
        topic,
        label: TOPIC_LABEL[topic],
        count: counts[topic],
      })).filter((item) => item.count > 0),
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
