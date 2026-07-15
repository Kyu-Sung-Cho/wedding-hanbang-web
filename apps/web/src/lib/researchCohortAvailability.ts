type ResearchCohortEnvironment = {
  NODE_ENV?: string;
  RESEARCH_COHORT_APPLICATIONS_ENABLED?: string;
};

/**
 * Production and production-mode previews are hard-closed. Reopening requires
 * a reviewed code change after the database, email, deletion, and operator
 * gates pass; an environment-variable mistake alone can never collect PII.
 * Local development remains usable unless it is explicitly disabled.
 */
export function isResearchCohortApplicationsEnabled(
  environment: ResearchCohortEnvironment = process.env,
): boolean {
  if (environment.NODE_ENV === "production") return false;

  const configured = environment.RESEARCH_COHORT_APPLICATIONS_ENABLED;
  if (configured === "false") return false;
  return true;
}
