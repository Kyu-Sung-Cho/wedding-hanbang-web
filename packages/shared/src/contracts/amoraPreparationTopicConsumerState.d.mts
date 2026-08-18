import type { AmoraConsumerState } from "./amoraConsumerState.mjs";
import type { AmoraJourneyTruthTopicPolicy } from "./amoraJourneyTruthAudit.mjs";
import type { AmoraPreparationTopicDetail } from "./amoraPreparationTopic.mjs";

export const AMORA_PREPARATION_TOPIC_CONSUMER_STATE_CONTRACT_VERSION: 1;

export type AmoraPreparationTopicConsumerState = Readonly<{
  version: 1;
  topicStatus: AmoraPreparationTopicDetail["status"];
  truthPolicy: AmoraJourneyTruthTopicPolicy;
  consumerState: AmoraConsumerState;
}>;

export function buildAmoraPreparationTopicConsumerState(
  view: unknown | AmoraPreparationTopicDetail,
): AmoraPreparationTopicConsumerState | null;
