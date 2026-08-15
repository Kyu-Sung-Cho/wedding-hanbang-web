import type {
  AmoraPersonalizationPreferenceField,
  AmoraPersonalizationPreferenceValue,
  AmoraPersonalizationPreferences,
} from "./amoraPersonalization.mjs";

export interface AmoraPersonalizationSettingChoice {
  readonly value: AmoraPersonalizationPreferenceValue;
  readonly label: string;
  readonly description: string;
}

export interface AmoraPersonalizationSettingSection {
  readonly field: AmoraPersonalizationPreferenceField;
  readonly title: string;
  readonly description: string;
  readonly choices: readonly AmoraPersonalizationSettingChoice[];
}

export interface AmoraPersonalizationSettingView
  extends AmoraPersonalizationSettingSection {
  readonly selectedValue: AmoraPersonalizationPreferenceValue;
  readonly selectedLabel: string;
}

export const AMORA_PERSONALIZATION_SETTING_SECTIONS:
  readonly AmoraPersonalizationSettingSection[];

export function getAmoraPersonalizationSettingsView(
  preferences: Readonly<AmoraPersonalizationPreferences> | unknown,
): readonly AmoraPersonalizationSettingView[] | null;

export function buildAmoraPersonalizationSummary(
  preferences: Readonly<AmoraPersonalizationPreferences> | unknown,
): string | null;

export function buildAmoraHomePersonalization(
  preferences: Readonly<AmoraPersonalizationPreferences> | unknown,
  chatIntent: "intake" | "focus" | unknown,
): Readonly<{
  label: string;
  chatActionLabel: string;
}> | null;
