import { createClient } from "@/lib/supabase/server";
import { chatWithTools, buildToolResultContent } from "@/lib/ai/claude";
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";
import { WEDDING_TOOLS } from "@/lib/ai/tools";
import { executeTool } from "@/lib/ai/toolExecutor";
import { NextResponse } from "next/server";
import type { MessageParam, ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type { ToolExecutionResult } from "@/types/database.types";

// Vercel 함수 타임아웃 60초 (tool use 루프 때문에 시간 필요)
export const maxDuration = 60;

const MAX_TOOL_ROUNDS = 5;

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

    // 최신 journey 데이터로 시스템 프롬프트 생성
    const { data: journey, error: journeyErr } = await supabase
      .from("wedding_journeys")
      .select("*")
      .eq("couple_id", coupleId)
      .single();

    if (journeyErr) {
      console.error("Journey 조회 에러:", journeyErr.message);
    }

    const systemPrompt = getWeddingPlannerSystemPrompt({
      weddingDate: journey?.wedding_date ?? weddingContext?.weddingDate ?? null,
      budget: journey?.total_budget ?? weddingContext?.budget ?? 0,
      progress: journey?.progress ?? weddingContext?.progress ?? {},
    });

    // Claude API 호출 (tool use 루프)
    const formattedMessages: MessageParam[] = messages.map(
      (m: { role: string; content: string }) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      })
    );

    // tool executor 실행 컨텍스트
    const executionContext = {
      coupleId,
      weddingContext: {
        weddingDate: journey?.wedding_date ?? weddingContext?.weddingDate ?? null,
        budget: journey?.total_budget ?? weddingContext?.budget ?? 0,
        venue: journey?.venue ?? weddingContext?.venue ?? null,
        progress: journey?.progress ?? weddingContext?.progress ?? {},
      },
    };

    let currentMessages = [...formattedMessages];
    const toolResults: ToolExecutionResult[] = [];
    const toolsUsed: string[] = [];

    // Tool use 루프: 최대 MAX_TOOL_ROUNDS까지 반복
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await chatWithTools({
        systemPrompt,
        messages: currentMessages,
        tools: WEDDING_TOOLS,
      });

      // tool use가 없으면 최종 응답
      if (result.toolUseBlocks.length === 0) {
        return NextResponse.json({
          content: result.fullText,
          senderName,
          toolsUsed,
          toolResults,
        });
      }

      // tool use 블록 실행
      const toolResultContents: ContentBlockParam[] = [];

      for (const toolUse of result.toolUseBlocks) {
        toolsUsed.push(toolUse.name);
        const execResult = await executeTool(toolUse.name, toolUse.input, executionContext);
        toolResults.push(execResult);
        toolResultContents.push(
          buildToolResultContent(toolUse.id, JSON.stringify(execResult.toolOutput))
        );
      }

      // 대화 이어가기: assistant 응답 + tool results
      const assistantContent: ContentBlockParam[] = [];
      if (result.fullText) {
        assistantContent.push({ type: "text", text: result.fullText } as ContentBlockParam);
      }
      for (const toolUse of result.toolUseBlocks) {
        assistantContent.push({
          type: "tool_use",
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input,
        } as ContentBlockParam);
      }

      currentMessages = [
        ...currentMessages,
        { role: "assistant" as const, content: assistantContent },
        { role: "user" as const, content: toolResultContents },
      ];
    }

    // 최대 라운드 초과 시 마지막 호출
    const finalResult = await chatWithTools({
      systemPrompt,
      messages: currentMessages,
      tools: WEDDING_TOOLS,
    });

    return NextResponse.json({
      content: finalResult.fullText,
      senderName,
      toolsUsed,
      toolResults,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("채팅 API 에러:", errMsg);
    return NextResponse.json(
      { error: `AI 응답 생성에 실패했습니다: ${errMsg}` },
      { status: 500 }
    );
  }
}
