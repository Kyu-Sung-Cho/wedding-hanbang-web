// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  buildAmoraToolRoundCheckpoint,
  loadAmoraToolRoundJournal,
} from "@/lib/ai/amoraTurnJournal";

describe("Amora durable tool-round journal", () => {
  it("checkpoints only replay-required encrypted provider output and bounded tool identity", () => {
    const reasoning = {
      id: "rs_1",
      type: "reasoning" as const,
      summary: [],
      encrypted_content: "opaque-encrypted-reasoning",
    };
    const functionCall = {
      id: "fc_1",
      type: "function_call" as const,
      call_id: "call_1",
      name: "update_budget",
      arguments: JSON.stringify({ total_budget: 30_000_000 }),
      status: "completed" as const,
    };

    const checkpoint = buildAmoraToolRoundCheckpoint(1, {
      fullText: "this streamed draft must not be retained",
      toolCalls: [{
        callId: "call_1",
        name: "update_budget",
        input: { total_budget: 30_000_000 },
      }],
      outputItems: [reasoning, functionCall],
    });

    expect(checkpoint).toMatchObject({
      version: 1,
      callIndex: 1,
      phase: "tool_round",
      outputItems: [reasoning, functionCall],
      toolCalls: [{
        callId: "call_1",
        name: "update_budget",
        input: { total_budget: 30_000_000 },
        inputDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        operationKey: expect.stringMatching(/^[0-9a-f]{64}$/),
      }],
    });
    expect(JSON.stringify(checkpoint)).not.toContain("streamed draft");
  });

  it("loads and validates the exact journal for the active chat-claim generation", async () => {
    const checkpoint = buildAmoraToolRoundCheckpoint(1, {
      fullText: "",
      toolCalls: [{
        callId: "call_1",
        name: "update_budget",
        input: { total_budget: 30_000_000 },
      }],
      outputItems: [{
        id: "fc_1",
        type: "function_call",
        call_id: "call_1",
        name: "update_budget",
        arguments: JSON.stringify({ total_budget: 30_000_000 }),
        status: "completed",
      }],
    });
    const rpc = async () => ({
      data: { action: "loaded", journal: [checkpoint] },
      error: null,
    });

    await expect(loadAmoraToolRoundJournal({
      coupleId: "10000000-0000-4000-8000-000000000001",
      requestKey: "chat:request",
      attemptCount: 2,
    }, { rpc } as never)).resolves.toEqual([checkpoint]);
  });

  it("accepts semantically identical tool arguments regardless of object key order", () => {
    expect(() => buildAmoraToolRoundCheckpoint(1, {
      fullText: "",
      toolCalls: [{
        callId: "call_1",
        name: "add_schedule_event",
        input: { title: "드레스 투어", date: "2027-03-12" },
      }],
      outputItems: [{
        id: "fc_1",
        type: "function_call",
        call_id: "call_1",
        name: "add_schedule_event",
        arguments: JSON.stringify({ date: "2027-03-12", title: "드레스 투어" }),
        status: "completed",
      }],
    })).not.toThrow();
  });

  it("rejects plaintext-only reasoning from the durable replay journal", () => {
    expect(() => buildAmoraToolRoundCheckpoint(1, {
      fullText: "",
      toolCalls: [{
        callId: "call_1",
        name: "update_budget",
        input: { total_budget: 30_000_000 },
      }],
      outputItems: [{
        id: "rs_1",
        type: "reasoning",
        summary: [{ type: "summary_text", text: "private chain of thought" }],
      }, {
        id: "fc_1",
        type: "function_call",
        call_id: "call_1",
        name: "update_budget",
        arguments: JSON.stringify({ total_budget: 30_000_000 }),
        status: "completed",
      }],
    })).toThrow(/encrypted reasoning is required/);
  });

  it("rejects plaintext reasoning summaries even when encrypted content exists", () => {
    expect(() => buildAmoraToolRoundCheckpoint(1, {
      fullText: "",
      toolCalls: [{
        callId: "call_1",
        name: "update_budget",
        input: { total_budget: 30_000_000 },
      }],
      outputItems: [{
        id: "rs_1",
        type: "reasoning",
        summary: [{ type: "summary_text", text: "private chain of thought" }],
        encrypted_content: "opaque-encrypted-reasoning",
      }, {
        id: "fc_1",
        type: "function_call",
        call_id: "call_1",
        name: "update_budget",
        arguments: JSON.stringify({ total_budget: 30_000_000 }),
        status: "completed",
      }],
    })).toThrow(/plaintext reasoning summary is forbidden/);
  });

  it("rejects an extra function call that has no durable tool identity", () => {
    expect(() => buildAmoraToolRoundCheckpoint(1, {
      fullText: "",
      toolCalls: [{
        callId: "call_1",
        name: "update_budget",
        input: { total_budget: 30_000_000 },
      }],
      outputItems: [{
        type: "function_call",
        call_id: "call_1",
        name: "update_budget",
        arguments: JSON.stringify({ total_budget: 30_000_000 }),
      }, {
        type: "function_call",
        call_id: "call_rogue",
        name: "delete_schedule_event",
        arguments: JSON.stringify({ event_id: "evt_1", confirmed: true }),
      }],
    })).toThrow(/unbound function call is forbidden/);
  });
});
