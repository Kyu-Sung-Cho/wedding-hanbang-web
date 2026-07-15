// The legacy customer survey stores demographic and free-text answers but has
// no verified consent-withdrawal or rights-request workflow. Reopening it must
// be an intentional reviewed code change, never an environment toggle.
export const CUSTOMER_SURVEY_INTAKE_ENABLED = false;

export function isCustomerSurveyIntakeEnabled(): boolean {
  return CUSTOMER_SURVEY_INTAKE_ENABLED;
}
