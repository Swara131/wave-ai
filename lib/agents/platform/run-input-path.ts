import type { AgentRequirement } from "@/lib/agents/requirements/types";

export function agentRunInputPath(
  agentId: string,
  runMissing: Pick<AgentRequirement, "key" | "inputType">[] | undefined
): string {
  const id = encodeURIComponent(agentId);
  const photo = (runMissing ?? []).some(
    (item) => item.key === "venue_photo" || item.inputType === "file"
  );
  const lighting = (runMissing ?? []).some((item) => item.key === "lighting_intake");
  const travel = (runMissing ?? []).some((item) => item.key === "travel_intake");
  const wedding = (runMissing ?? []).some((item) => item.key === "wedding_intake");
  const group = (runMissing ?? []).some((item) => item.key === "group_intake");
  if (lighting) return `/agents/${id}/lighting`;
  if (travel) return `/agents/${id}/travel`;
  if (wedding) return `/agents/${id}/wedding`;
  if (group) return `/agents/${id}/group`;
  return photo ? `/agents/${id}/photo` : `/agents/${id}/run`;
}
