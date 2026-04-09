import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

const SCRIPT_PROMPTS: Record<string, string> = {
  mc_script: `당신은 웨딩 사회자(MC) 대본 작성 전문가입니다.
격식 있으면서도 따뜻한 분위기의 결혼식 사회 대본을 작성하세요.
대본에는 다음 순서를 포함하세요:
1. 오프닝 멘트 (하객 인사)
2. 신랑 입장
3. 신부 입장
4. 주례/축사
5. 성혼선언
6. 양가 인사
7. 클로징 멘트
각 파트 사이에 자연스러운 전환 멘트를 넣어주세요.`,

  vow: `당신은 감동적인 결혼 서약서 작성 전문가입니다.
진심이 담긴, 감동적인 결혼 서약을 작성하세요.
너무 길지 않게, 1-2분 분량으로 작성하세요.
상대방에 대한 사랑, 약속, 미래에 대한 다짐을 담아주세요.`,

  parents_letter: `당신은 결혼식 부모님께 드리는 감사 편지 작성 전문가입니다.
부모님께 드리는 진심 어린 감사 편지를 작성하세요.
어린 시절의 추억, 부모님의 헌신에 대한 감사, 새 출발에 대한 다짐을 담아주세요.
눈물이 날 만큼 감동적이면서도 따뜻한 톤으로 작성하세요.`,

  friend_speech: `당신은 결혼식 축사 작성 전문가입니다.
친구/지인이 하는 축사를 작성하세요.
재미있는 에피소드와 진심 어린 축하 메시지를 균형 있게 담아주세요.
3-5분 분량으로 작성하세요.`,

  invitation_text: `당신은 모바일 청첩장 인사말 작성 전문가입니다.
격식 있으면서도 현대적인 청첩장 인사말을 작성하세요.
2-3문단으로 간결하게 작성하세요.
결혼 소식을 전하고, 소중한 자리에 함께해달라는 초대의 말씀을 담아주세요.`,

  thank_you: `당신은 결혼식 감사 인사 작성 전문가입니다.
결혼식 후 하객분들께 보내는 감사 메시지를 작성하세요.
참석해주신 것에 대한 감사, 축의금에 대한 감사, 앞으로의 다짐을 담아주세요.
SNS나 메시지로 보내기 적합한 길이로 작성하세요.`,
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { coupleId, scriptType, title, context } = await request.json();

  if (!coupleId || !scriptType || !title) {
    return NextResponse.json({ error: "필수 필드 누락" }, { status: 400 });
  }

  const systemPrompt = SCRIPT_PROMPTS[scriptType];
  if (!systemPrompt) {
    return NextResponse.json({ error: "잘못된 대본 타입" }, { status: 400 });
  }

  // 컨텍스트 정보를 사용자 메시지로 구성
  const contextParts: string[] = [];
  if (context.groomName) contextParts.push(`신랑: ${context.groomName}`);
  if (context.brideName) contextParts.push(`신부: ${context.brideName}`);
  if (context.weddingDate) contextParts.push(`예식일: ${context.weddingDate}`);
  if (context.venue) contextParts.push(`예식장: ${context.venue}`);
  if (context.tone) contextParts.push(`톤: ${context.tone}`);
  if (context.additionalInfo) contextParts.push(`추가 정보: ${context.additionalInfo}`);

  const userMessage = contextParts.length > 0
    ? `다음 정보를 바탕으로 "${title}" 대본을 작성해주세요:\n\n${contextParts.join("\n")}`
    : `"${title}" 대본을 작성해주세요.`;

  const anthropic = new Anthropic();

  // SSE 스트리밍 응답
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let fullContent = "";

        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
          stream: true,
        });

        for await (const event of response) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            fullContent += event.delta.text;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "text_delta", content: event.delta.text })}\n\n`)
            );
          }
        }

        // DB에 저장
        const { data: saved } = await supabase
          .from("ai_scripts")
          .insert({
            couple_id: coupleId,
            script_type: scriptType,
            title,
            content: fullContent,
            params: context,
          })
          .select()
          .single();

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done", script: saved })}\n\n`)
        );
      } catch (err) {
        console.error("대본 생성 에러:", err);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", message: "대본 생성에 실패했습니다." })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
