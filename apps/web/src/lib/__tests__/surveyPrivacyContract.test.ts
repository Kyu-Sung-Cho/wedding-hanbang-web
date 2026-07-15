import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const surveyRoute = readFileSync(
  join(process.cwd(), "src/app/api/survey/route.ts"),
  "utf8"
);
const surveyPage = readFileSync(
  join(process.cwd(), "src/app/customersurvey/page.tsx"),
  "utf8"
);
const surveyAvailability = readFileSync(
  join(process.cwd(), "src/lib/customerSurveyAvailability.ts"),
  "utf8"
);

const retiredSurveyImplementationPaths = [
  "src/app/customersurvey/components",
  "src/app/customersurvey/data",
  "src/app/customersurvey/hooks",
  "src/app/customersurvey/utils",
];

function filesUnder(path: string): string[] {
  const absolute = join(process.cwd(), path);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute).flatMap((entry) => {
    const child = join(absolute, entry);
    return statSync(child).isDirectory()
      ? filesUnder(join(path, entry))
      : [child];
  });
}

describe("customer survey privacy contract", () => {
  it("keeps the retired survey API physically incapable of collecting data", () => {
    expect(surveyRoute).toContain('code: "CUSTOMER_SURVEY_INTAKE_CLOSED"');
    expect(surveyRoute).toContain("status: 410");
    expect(surveyRoute).not.toContain("q23_contact");
    expect(surveyRoute).not.toMatch(/createClient|verifyTurnstile|checkRateLimit|request\.json|\.from\(/);
  });

  it("does not ship the dormant questionnaire, draft, validation, or submission UI", () => {
    expect(retiredSurveyImplementationPaths.flatMap(filesUnder)).toEqual([]);
    expect(surveyPage).not.toMatch(/CustomerSurveyForm|useSurveyState|QuestionRenderer|fetch\(['"]\/api\/survey/);
  });

  it("hard-closes the unfinished survey screen and storage API", () => {
    expect(surveyAvailability).toContain("CUSTOMER_SURVEY_INTAKE_ENABLED = false");
    expect(surveyPage).not.toContain("isCustomerSurveyIntakeEnabled");
    expect(surveyPage).toContain("현재 설문 응답을 받지 않습니다");
    expect(surveyPage).toContain('localStorage.removeItem("wedding_survey_draft")');
    expect(surveyRoute).not.toContain("isCustomerSurveyIntakeEnabled");
    expect(surveyRoute).toContain('code: "CUSTOMER_SURVEY_INTAKE_CLOSED"');
    expect(surveyRoute).toContain("status: 410");
  });
});
