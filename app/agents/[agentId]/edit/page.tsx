import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import PageShell from "@/components/ui/PageShell";
import VisualAgentBuilder from "@/components/agents/workflow-builder/VisualAgentBuilder";

function BuilderFallback() {
  return (
    <p className="studio-loading">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      Loading workflow…
    </p>
  );
}

export default function AgentEditPage() {
  return (
    <PageShell layout="workspace" className="studio-shell studio-shell-scroll">
      <Suspense fallback={<BuilderFallback />}>
        <VisualAgentBuilder variant="workflow" />
      </Suspense>
    </PageShell>
  );
}
