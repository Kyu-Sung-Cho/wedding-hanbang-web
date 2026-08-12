import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("couple invite-code actor fence", () => {
  it("binds settings reads and regeneration to the displayed account", () => {
    const settings = source("src/app/(app)/settings/page.tsx");
    expect(settings).toContain(
      "[HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: expectedActorUserId",
    );
    expect(settings).toContain(
      "ownerData?.user?.id !== expectedActorUserId",
    );
    expect(settings).toContain(
      "const [coupleConnectionOwnerId, setCoupleConnectionOwnerId]",
    );
    expect(settings).toMatch(
      /selectOwnerBoundCoupleConnection\(\s*coupleConnection,\s*coupleConnectionOwnerId,\s*safeCoupleOwnerId/u,
    );
    expect(settings).toMatch(
      /const responseOwnerId = await readCurrentWebActorId\(\)[\s\S]{0,260}responseOwnerId === expectedActorUserId/u,
    );
    expect(settings).toContain("copyOwnerBoundInviteCode({");
    expect(settings).toContain("readAuthenticatedOwner: readCurrentWebActorId");
    expect(settings).toContain(
      "writeText: (value) => navigator.clipboard.writeText(value)",
    );
    expect(settings).toContain("purgeOwnerBoundSecret: () => {");
  });

  it("binds the dashboard invite read and late response to one account", () => {
    const dashboard = source("src/app/(app)/dashboard/page.tsx");
    const appLayout = source("src/app/(app)/AppClientLayout.tsx");
    expect(dashboard).toContain(
      "[HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: expectedActorUserId",
    );
    expect(dashboard).toContain(
      "useAuthStore.getState().user?.id === expectedActorUserId",
    );
    expect(dashboard).toMatch(
      /const responseOwnerId = await readCurrentDashboardActorId\(\)[\s\S]{0,260}responseOwnerId === expectedActorUserId[\s\S]{0,260}setInviteCodeState/u,
    );
    expect(dashboard).toContain("inviteCodeState && user?.id");
    expect(dashboard).toContain(
      "inviteCodeState.ownerUserId === user.id",
    );
    expect(appLayout).toContain('key={actorScope}');
    expect(dashboard).toContain(
      "useAuthStore.getState().user?.id !== codeSnapshot.ownerUserId",
    );
    expect(dashboard).toMatch(
      /async function copyCode\(\)[\s\S]{0,700}copyOwnerBoundInviteCode\(\{[\s\S]{0,500}readAuthenticatedOwner: readCurrentDashboardActorId[\s\S]{0,300}navigator\.clipboard\.writeText/u,
    );
    expect(dashboard).toMatch(
      /purgeOwnerBoundSecret: \(\) => \{[\s\S]{0,240}setInviteCodeState/u,
    );
    expect(dashboard).toContain(
      "updateJourney({ progress: currentProgress }, expectedActorUserId)",
    );
  });

  it("enforces the shared fence on both the mutating GET and POST handlers", () => {
    const route = source("src/app/api/couple/code/route.ts");
    expect(route.match(/verifyMutationActorFence\(request\.headers, authData\.user\.id\)/gu))
      .toHaveLength(2);
  });
});
