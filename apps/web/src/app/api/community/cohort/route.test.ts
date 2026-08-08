// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { GET } from "./route";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const HIDDEN_USER_ID = "10000000-0000-4000-8000-000000000002";
const ROOM_ID = "20000000-0000-4000-8000-000000000001";

function request() {
  return new NextRequest("https://hanbang.ai/api/community/cohort");
}

function query<T extends object>(methods: T): T {
  return methods;
}

function serviceClient() {
  const discoveryQuery = query({
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(async () => ({
      data: [{
        id: ROOM_ID,
        year: 2027,
        month: 4,
        room_number: 1,
        member_count: 2,
        message_count: 1,
        is_active: true,
      }],
      error: null,
    })),
  });
  discoveryQuery.select.mockReturnValue(discoveryQuery);
  discoveryQuery.eq.mockReturnValue(discoveryQuery);
  discoveryQuery.order.mockReturnValue(discoveryQuery);

  const membershipsQuery = query({
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(async () => ({
      data: [{ room_id: ROOM_ID, joined_at: "2026-08-01T00:00:00.000Z" }],
      error: null,
    })),
  });
  membershipsQuery.select.mockReturnValue(membershipsQuery);
  membershipsQuery.eq.mockReturnValue(membershipsQuery);

  const roomsQuery = query({
    select: vi.fn(),
    in: vi.fn(),
    eq: vi.fn(async () => ({
      data: [{
        id: ROOM_ID,
        year: 2027,
        month: 4,
        room_number: 1,
        member_count: 2,
        message_count: 1,
        is_active: true,
      }],
      error: null,
    })),
  });
  roomsQuery.select.mockReturnValue(roomsQuery);
  roomsQuery.in.mockReturnValue(roomsQuery);

  const ownProfileQuery = query({
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({
      data: { wedding_year: 2027, wedding_month: 5 },
      error: null,
    })),
  });
  ownProfileQuery.select.mockReturnValue(ownProfileQuery);
  ownProfileQuery.eq.mockReturnValue(ownProfileQuery);

  let cohortRoomReads = 0;
  const from = vi.fn((table: string) => {
    if (table === "cohort_rooms") {
      cohortRoomReads += 1;
      return cohortRoomReads === 1 ? discoveryQuery : roomsQuery;
    }
    if (table === "cohort_members") return membershipsQuery;
    if (table === "community_profiles") return ownProfileQuery;
    throw new Error(`Unexpected service table: ${table}`);
  });

  return {
    from,
    ownProfileQuery,
  };
}

function viewerClient() {
  const memberRowsQuery = query({
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(async () => ({
      data: [
        { id: "membership-1", user_id: USER_ID, joined_at: "2026-08-01T00:00:00.000Z" },
        { id: "membership-2", user_id: HIDDEN_USER_ID, joined_at: "2026-08-02T00:00:00.000Z" },
      ],
      error: null,
    })),
  });
  memberRowsQuery.select.mockReturnValue(memberRowsQuery);
  memberRowsQuery.eq.mockReturnValue(memberRowsQuery);
  memberRowsQuery.order.mockReturnValue(memberRowsQuery);

  const publicProfilesQuery = query({
    select: vi.fn(),
    in: vi.fn(async () => ({
      data: [{
        user_id: USER_ID,
        nickname: "테스트커플",
        avatar_url: null,
        rank: "sprout",
      }],
      error: null,
    })),
  });
  publicProfilesQuery.select.mockReturnValue(publicProfilesQuery);

  const lastMessageQuery = query({
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => ({
      data: { id: "message-1", content: "안녕하세요", created_at: "2026-08-01T00:00:00.000Z", author_id: USER_ID },
      error: null,
    })),
  });
  lastMessageQuery.select.mockReturnValue(lastMessageQuery);
  lastMessageQuery.eq.mockReturnValue(lastMessageQuery);
  lastMessageQuery.order.mockReturnValue(lastMessageQuery);
  lastMessageQuery.limit.mockReturnValue(lastMessageQuery);

  const from = vi.fn((table: string) => {
    if (table === "cohort_members") return memberRowsQuery;
    if (table === "community_public_profiles") return publicProfilesQuery;
    if (table === "cohort_messages") return lastMessageQuery;
    throw new Error(`Unexpected viewer table: ${table}`);
  });

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
    },
    from,
    publicProfilesQuery,
  };
}

describe("GET /api/community/cohort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses private wedding timing only for the caller's room selection and public profiles for member previews", async () => {
    const service = serviceClient();
    const viewer = viewerClient();
    mocks.createClientFromRequest.mockResolvedValue(viewer);
    mocks.createAdminClient.mockReturnValue(service);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(service.from).toHaveBeenCalledWith("community_profiles");
    expect(service.ownProfileQuery.select).toHaveBeenCalledWith(
      "wedding_year, wedding_month",
    );
    expect(service.ownProfileQuery.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(service.from).not.toHaveBeenCalledWith("community_public_profiles");
    expect(service.from).not.toHaveBeenCalledWith("cohort_messages");
    expect(viewer.from).toHaveBeenCalledWith("cohort_members");
    expect(viewer.from).toHaveBeenCalledWith("community_public_profiles");
    expect(viewer.from).toHaveBeenCalledWith("cohort_messages");
    expect(viewer.publicProfilesQuery.select).toHaveBeenCalledWith(
      "user_id, nickname, avatar_url, rank",
    );
    expect(body.recentMembers).toEqual([{
      id: "membership-1",
      user_id: USER_ID,
      joined_at: "2026-08-01T00:00:00.000Z",
      profile: {
        user_id: USER_ID,
        nickname: "테스트커플",
        avatar_url: null,
        rank: "sprout",
      },
    }]);
    expect(JSON.stringify(body.recentMembers)).not.toContain(HIDDEN_USER_ID);
    expect(JSON.stringify(body.recentMembers)).not.toMatch(/wedding_(?:year|month)/u);
  });
});
