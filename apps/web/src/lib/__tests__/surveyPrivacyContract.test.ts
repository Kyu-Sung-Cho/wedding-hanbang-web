import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const questions = readFileSync(
  join(process.cwd(), "src/app/customersurvey/data/questions.ts"),
  "utf8"
);
const draftHook = readFileSync(
  join(process.cwd(), "src/app/customersurvey/hooks/useSurveyState.ts"),
  "utf8"
);
const surveyRoute = readFileSync(
  join(process.cwd(), "src/app/api/survey/route.ts"),
  "utf8"
);

describe("customer survey privacy contract", () => {
  it("does not collect launch contact details in the research survey", () => {
    expect(questions).not.toContain("id: 'q23'");
    expect(surveyRoute).toContain("q23_contact: null");
    expect(surveyRoute).toContain("user_agent: null");
    expect(surveyRoute).not.toContain('request.headers.get("user-agent")');
  });

  it("expires browser drafts after 24 hours and drops legacy contact fields", () => {
    expect(draftHook).toContain("const DRAFT_TTL_MS = 24 * 60 * 60 * 1000");
    expect(draftHook).toContain("delete safeAnswers.q23");
    expect(draftHook).toContain("localStorage.removeItem(LOCAL_STORAGE_KEY)");
  });
});
