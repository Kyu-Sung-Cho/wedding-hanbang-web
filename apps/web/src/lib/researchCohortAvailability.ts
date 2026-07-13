type ResearchCohortEnvironment = {
  NODE_ENV?: string;
  RESEARCH_COHORT_APPLICATIONS_ENABLED?: string;
};

/**
 * Production and production-mode previews must opt in explicitly only after
 * the database, verification email, deletion, and operator gates pass.
 * Local development remains usable unless it is explicitly disabled.
 */
export function isResearchCohortApplicationsEnabled(
  environment: ResearchCohortEnvironment = process.env,
): boolean {
  const configured = environment.RESEARCH_COHORT_APPLICATIONS_ENABLED;
  if (configured === "true") return true;
  if (configured === "false") return false;
  return environment.NODE_ENV !== "production";
}
