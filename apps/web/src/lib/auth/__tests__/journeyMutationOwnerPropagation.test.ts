import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const productionMutationClients = [
  "src/app/(app)/dashboard/page.tsx",
  "src/app/(app)/settings/page.tsx",
  "src/components/app/budget/BudgetContent.tsx",
  "src/components/app/chat/ActionCard.tsx",
  "src/components/app/etiquette/EtiquetteClient.tsx",
  "src/components/app/schedule/CategoryChecklistModal.tsx",
  "src/components/app/schedule/ScheduleContent.tsx",
] as const;

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function directCallArgumentCounts(source: string, functionName: string): number[] {
  const sourceFile = ts.createSourceFile(
    "mutation-client.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const counts: number[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === functionName
    ) {
      counts.push(node.arguments.length);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return counts;
}

describe("web journey mutation owner propagation", () => {
  it("requires an explicit initiating owner at every production journey/profile call", () => {
    const journeyCounts = productionMutationClients.flatMap((relativePath) =>
      directCallArgumentCounts(readSource(relativePath), "updateJourney"));
    const profileCounts = productionMutationClients.flatMap((relativePath) =>
      directCallArgumentCounts(readSource(relativePath), "updateProfile"));

    expect(journeyCounts.length).toBeGreaterThanOrEqual(10);
    expect(journeyCounts.every((count) => count >= 2)).toBe(true);
    expect(profileCounts.length).toBeGreaterThanOrEqual(2);
    expect(profileCounts.every((count) => count >= 2)).toBe(true);

    const storeSource = readSource("src/stores/authStore.ts");
    const journeySignature = storeSource.match(
      /updateJourney:\s*\([\s\S]*?\)\s*=> Promise<JourneyUpdateResult>/u,
    )?.[0];
    const profileSignature = storeSource.match(
      /updateProfile:\s*\([\s\S]*?\)\s*=> Promise<void>/u,
    )?.[0];
    expect(journeySignature).toBeDefined();
    expect(profileSignature).toBeDefined();
    expect(journeySignature).not.toContain("expectedOwnerId?: string");
    expect(profileSignature).not.toContain("expectedOwnerId?: string");
    expect(storeSource).not.toContain("initiatingOwnerId ?? user?.id");
  });

  it("remounts stale local editors and binds checklist openings to their owner", () => {
    const scheduleSource = readSource(
      "src/components/app/schedule/ScheduleContent.tsx",
    );
    const budgetSource = readSource(
      "src/components/app/budget/BudgetContent.tsx",
    );
    const actionSource = readSource("src/components/app/chat/ActionCard.tsx");
    const checklistSource = readSource(
      "src/components/app/schedule/CategoryChecklistModal.tsx",
    );
    const topNavSource = readSource("src/components/app/TopNav.tsx");

    expect(scheduleSource).toContain("key={mutationOwnerId ?? \"signed-out\"}");
    expect(budgetSource).toContain("key={mutationOwnerId ?? \"signed-out\"}");
    expect(actionSource).toContain("key={mutationOwnerId ?? \"signed-out\"}");
    expect(checklistSource).toContain("props.expectedOwnerId !== currentOwnerId");
    expect(topNavSource).toContain("key={currentOwnerId ?? \"signed-out\"}");
  });
});
