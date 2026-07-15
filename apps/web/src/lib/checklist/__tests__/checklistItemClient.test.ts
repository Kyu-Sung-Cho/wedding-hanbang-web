import { describe, expect, it, vi } from "vitest";
import {
  ChecklistItemConflictError,
  mutateChecklistItem,
} from "../checklistItemClient";

const mutation = {
  categoryKey: "venue",
  itemId: "venue_01",
  done: true,
  expectedDone: false,
};

describe("mutateChecklistItem", () => {
  it("returns only an authoritative matching item state", async () => {
    const progress = {
      venue: {
        category: "venue",
        status: "in_progress",
        checklist: [{ id: "venue_01", label: "예식 스타일 결정", done: true }],
      },
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      progress,
      categoryKey: "venue",
      itemId: "venue_01",
      item: progress.venue.checklist[0],
    }), { status: 200 }));

    await expect(mutateChecklistItem(mutation, fetcher)).resolves.toEqual({
      progress,
      categoryKey: "venue",
      itemId: "venue_01",
      item: progress.venue.checklist[0],
    });
    expect(fetcher).toHaveBeenCalledWith("/api/journey/checklist-items", expect.objectContaining({
      method: "POST",
      body: JSON.stringify(mutation),
    }));
  });

  it("surfaces conflict progress for a caller to reconcile", async () => {
    const progress = {
      venue: {
        category: "venue",
        status: "in_progress",
        checklist: [{ id: "venue_01", label: "예식 스타일 결정", done: true }],
      },
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "conflict",
      progress,
    }), { status: 409 }));

    await expect(mutateChecklistItem(mutation, fetcher)).rejects.toMatchObject({
      name: ChecklistItemConflictError.name,
      progress,
    });
  });

  it.each([
    { progress: {}, categoryKey: "venue", itemId: "venue_01", item: { id: "venue_01", label: "x", done: true } },
    { progress: { venue: { category: "venue", status: "completed", checklist: [{ id: "venue_01", label: "x", done: false }] } }, categoryKey: "venue", itemId: "venue_01", item: { id: "venue_01", label: "x", done: false } },
    { progress: { venue: { category: "venue", status: "completed", checklist: [{ id: "venue_01", label: "x", done: true }, { id: "venue_01", label: "x", done: true }] } }, categoryKey: "venue", itemId: "venue_01", item: { id: "venue_01", label: "x", done: true } },
  ])("rejects malformed or unconfirmed success data", async (body) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    await expect(mutateChecklistItem(mutation, fetcher)).rejects.toThrow("확인");
  });
});
