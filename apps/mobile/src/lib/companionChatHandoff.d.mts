import type { DashboardCompanionBrief } from "./dashboardExperience.mjs";
import type { AmoraScheduleCareFollowUpBinding } from "@hanbang/shared/amora-schedule-care-follow-up";

export function stagePrivateChatHandoff(input: {
  handoffId: string;
  ownerUserId: string;
  coupleId: string;
  prompt: string;
  scheduleCareFollowUp?: AmoraScheduleCareFollowUpBinding;
}): string | null;

export function readPrivateChatHandoffPromptFromUrl(
  value: string,
  expectedSiteOrigin: string,
): string | null;

export function stageCompanionChatHandoff(input: {
  handoffId: string;
  ownerUserId: string;
  coupleId: string;
  brief: DashboardCompanionBrief;
}): string | null;

export function consumeCompanionChatHandoff(
  handoffId: string,
  expectedOwnerUserId: string,
  expectedCoupleId: string,
): {
  prompt: string;
  scheduleCareFollowUp?: AmoraScheduleCareFollowUpBinding;
} | null;
