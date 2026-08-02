"use client";

import AuthInitializer from "@/components/common/AuthInitializer";
import { useUserScopedClientActor } from "@/components/common/UserScopedClientStateBoundary";
import { isPreviewStubMode } from "@/lib/previewStub";

export default function CommunityAuthInitializer() {
  const actor = useUserScopedClientActor();
  if (isPreviewStubMode()) return null;
  if (actor.status !== "ready") return null;
  if (actor.kind !== "user" && actor.kind !== "demo") return null;
  return <AuthInitializer key={actor.actorKey} />;
}
