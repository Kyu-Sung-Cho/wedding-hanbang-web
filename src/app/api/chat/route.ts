import { createClient } from "@/lib/supabase/server";
import { getChatResponse } from "@/lib/ai/claude";
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const { messages, coupleId, senderName, weddingContext } =
      await request.json();

    if (!messages || !coupleId) {
      return NextResponse.json(
        { error: "메시지와 커플 ID가 필요합니다." },
        { status: 400 }
      );
    }

    // 시스템 프롬프트 생성
    const systemPrompt = getWeddingPlannerSystemPrompt({
      weddingDate: weddingContext?.weddingDate ?? null,
      budget: weddingContext?.budget ?? 0,
      progress: weddingContext?.progress ?? {},
    });

    // Claude API 호출
    const formattedMessages = messages.map(
      (m: { role: string; content: string }) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      })
    );

    const aiContent = await getChatResponse(systemPrompt, formattedMessages);

    return NextResponse.json({
      content: aiContent,
      senderName,
    });
  } catch (err) {
    console.error("채팅 API 에러:", err);
    return NextResponse.json(
      { error: "AI 응답 생성에 실패했습니다." },
      { status: 500 }
    );
  }
}
