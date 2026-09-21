export type MediationChoice = 'ok' | 'conditional' | 'difficult';
export type MediationIdentity = { ownerId: string; coupleId: string; rosterKey?: string };
export type MediationResponseRevision = { messageId: string; expectedProposalVersion: string; expectedRosterFingerprint: string };
export type MediationResponse = { userId: string; choice: MediationChoice; condition: string|null; revision: number; updatedAt: string };
export type MediationResponseState = { actorId: string; proposalVersion: string; rosterFingerprint: string; accepted: boolean; acceptedCount: number; requiredCount: 2; completed: boolean; partnerLinked: boolean; myResponseRevision: number; myResponse: MediationResponse|null; responses: MediationResponse[] };
export type MediationSessionState = { snapshot: MediationResponseState|null; loading: boolean; busy: boolean; error: string|null; taskSaved: string|null; taskUnknown: boolean };
export const mediationChoiceLabels: Record<MediationChoice,string>;
export function parseMediationResponseState(value: unknown, scope: MediationIdentity, revision: MediationResponseRevision): MediationResponseState|null;
export function createMediationResponseSession(options: { revision: MediationResponseRevision; timeoutMs?: number; readScope: () => Promise<MediationIdentity|null>; request: (scope: MediationIdentity, path: string, options: RequestInit) => Promise<Response> }): {
 getState: () => MediationSessionState; subscribe: (listener:()=>void)=>()=>void; invalidate:()=>void; load:()=>Promise<boolean>; respond:(choice:MediationChoice,condition:string|null)=>Promise<boolean>; revoke:()=>Promise<boolean>; createTask:(title:string,description:string)=>Promise<boolean>;
};
export type MediationResponseSession = ReturnType<typeof createMediationResponseSession>;
