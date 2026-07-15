import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("community fail-closed trust boundary", () => {
  it("does not present legacy author-entered cost data in the active feed or post detail", () => {
    const postCard = read("src/components/community/PostCard.tsx");
    const postDetail = read("src/app/(community)/community/post/[id]/page.tsx");
    const publicTypes = read("src/types/community.types.ts");

    expect(postCard).not.toContain("cost_data");
    expect(postDetail).not.toContain("cost_data");
    expect(postDetail).not.toContain("CostShareDisplay");
    expect(publicTypes).not.toContain("cost_data");
  });

  it("states that Amora does not receive the current post and asks the user to paste needed text", () => {
    const serviceCta = read("src/components/community/ServiceCTA.tsx");
    const landing = read("src/components/community/CommunityLandingClient.tsx");
    const guide = read("src/components/community/CommunityGuide.tsx");
    const combined = [serviceCta, landing, guide].join("\n");

    expect(serviceCta).toContain("현재 커뮤니티 글은 자동으로 전달되지 않았어");
    expect(combined).toContain("아모라는 현재 글을 자동으로 읽지 않아요");
    expect(combined).toContain("필요한 문장을 직접 붙여 넣어 주세요");
    expect(landing).not.toContain("아모라에게 이 글 물어보기");
    expect(landing).not.toContain("이 글에서 궁금한 점을 아모라에게 이어서 물어보세요");
  });

  it("describes topic-based community discovery instead of unsupported region or budget matching", () => {
    const landing = read("src/components/landing/FiveRoles.tsx");

    expect(landing).not.toContain("같은 지역, 비슷한 예산의 사례");
    expect(landing).toContain("같은 준비 주제의 후기");
  });

  it("does not invite a first comment while new comment publishing is closed", () => {
    const landing = read("src/components/community/CommunityLandingClient.tsx");
    const postCard = read("src/components/community/PostCard.tsx");

    expect(landing).not.toContain('"첫 댓글"');
    expect(postCard).not.toContain('"첫 댓글"');
  });

  it("documents physical comment-write retirement and the preserved legacy-read boundary", () => {
    const service = read("../../WEDDINGHANBANG_SERVICE_DOC.md");
    const status = read("../../PROJECT_STATUS.md");

    for (const document of [service, status]) {
      expect(document).toContain("새 댓글·답글");
      expect(document).toContain("기존 댓글");
      expect(document).toContain("410");
    }
  });

  it("physically retires both member and automated comment creation routes", () => {
    const memberRoute = read("src/app/api/community/comments/route.ts");
    const automatedRoute = read("src/app/api/community/ai-comment/route.ts");

    for (const route of [memberRoute, automatedRoute]) {
      expect(route).toContain("status: 410");
      expect(route).not.toMatch(/PUBLIC_BETA_CAPABILITIES|createOpenAIResponse|\.insert\(|createSupabaseClient/);
    }
    expect(automatedRoute).not.toContain("cost_data");
    expect(automatedRoute).not.toContain("price_data");
  });
});
