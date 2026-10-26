import { Suspense } from "react";
import DecisionRunResultsPage from "@/components/decision-agents/DecisionRunResultsPage";

export default function DecisionRunResultsRoute() {
  return (
    <Suspense fallback={null}>
      <DecisionRunResultsPage />
    </Suspense>
  );
}
