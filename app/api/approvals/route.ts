import { NextResponse } from "next/server";
import { generateApprovalsFromRiskAnalysis } from "@/lib/approvals/engine";
import { ApprovalEngineError } from "@/lib/approvals/errors";
import { getApprovalDashboardStats } from "@/lib/approvals/stats";
import { getLatestRiskAnalysis } from "@/lib/risk/repository";
import type { DetectedRisk } from "@/lib/risk-types";
import { recordAudit } from "@/lib/audit/logger";
import { ProposalError } from "@/lib/gateway/errors";
import { listGatewayPendingApprovals } from "@/lib/gateway/proposals/human-decision";
import { ensureOrganization } from "@/lib/organizations/ensure-organization";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseOptionalJsonBody, secureError } from "@/lib/security/api";
import { ValidationError } from "@/lib/security/errors";
import { approvalsGenerateSchema } from "@/lib/security/validation";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const organizationId = await ensureOrganization(
      supabase,
      user.id,
      user.email ?? "user@local"
    );

    const admin = createAdminClient();
    const approvals = await listGatewayPendingApprovals(admin, organizationId);

    return NextResponse.json({ approvals });
  } catch (err) {
    const message =
      err instanceof ProposalError
        ? err.message
        : err instanceof ApprovalEngineError
          ? err.message
          : "Failed to load approvals.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Generates approval requests from the latest risk analysis (or a specific analysis id).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let riskAnalysisId: string | undefined;

  try {
    const body = await parseOptionalJsonBody(request, approvalsGenerateSchema, {});
    riskAnalysisId = body.riskAnalysisId;
  } catch (err) {
    if (err instanceof ValidationError) {
      return secureError(err.message, 400, { details: err.details });
    }
  }

  try {
    const analysis = riskAnalysisId
      ? await supabase
          .from("risk_analysis")
          .select("*")
          .eq("id", riskAnalysisId)
          .eq("user_id", user.id)
          .maybeSingle()
          .then(({ data, error }) => {
            if (error) throw new ApprovalEngineError(error.message);
            return data;
          })
      : await getLatestRiskAnalysis(supabase, user.id);

    if (!analysis) {
      return NextResponse.json(
        { error: "No risk analysis found. Run Risk Analysis first." },
        { status: 404 }
      );
    }

    const risks = (analysis.risks ?? []) as DetectedRisk[];

    if (risks.length === 0) {
      return NextResponse.json(
        { error: "Risk analysis contains no detected risks." },
        { status: 400 }
      );
    }

    const generated = await generateApprovalsFromRiskAnalysis(supabase, {
      organizationId: analysis.organization_id as string,
      requesterId: user.id,
      riskAnalysisId: analysis.id as string,
      risks,
    });

    await recordAudit(supabase, {
      request,
      userId: user.id,
      organizationId: analysis.organization_id as string,
      action: "create",
      entityType: "approval_batch",
      entityId: analysis.id as string,
      riskSeverity: analysis.risk_level as DetectedRisk["severity"],
      approvalStatus: "pending",
      metadata: {
        description: `Generated ${generated.created} approval requests (${generated.pending} pending, ${generated.autoApproved} auto-approved)`,
        ...generated,
      },
    });

    const stats = await getApprovalDashboardStats(supabase);

    return NextResponse.json({ generated, stats });
  } catch (err) {
    const message =
      err instanceof ApprovalEngineError ? err.message : "Failed to generate approvals.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
