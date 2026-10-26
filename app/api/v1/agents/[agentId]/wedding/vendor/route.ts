import { getBuilderAgentForUserBySlug } from "@/lib/agents/save-builder-agent-draft";
import { weddingVendorActionSchema, weddingVendorSchema } from "@/lib/wedding-planner/intake";
import { actOnWeddingVendor, addWeddingVendor } from "@/lib/wedding-planner/service";
import { parseJsonBody, secureError, secureJson } from "@/lib/security/api";
import { ValidationError } from "@/lib/security/errors";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

const bodySchema = z.union([weddingVendorSchema, weddingVendorActionSchema]);

export async function POST(request: Request, context: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return secureError("Unauthorized", 401);
  const { agentId } = await context.params;
  const agent = await getBuilderAgentForUserBySlug(supabase, {
    userId: user.id,
    userEmail: user.email ?? "user@local",
    slug: agentId?.trim() ?? "",
  });
  if (!agent) return secureJson({ error: "Agent not found." }, { status: 404 });

  try {
    const body = await parseJsonBody(request, bodySchema);
    const event =
      "action" in body
        ? await actOnWeddingVendor({
            agent,
            userId: user.id,
            eventId: body.eventId,
            vendorId: body.vendorId,
            action: body.action,
            quotedAmount: body.quotedAmount,
          })
        : await addWeddingVendor({
            agent,
            userId: user.id,
            eventId: body.eventId,
            vendor: {
              name: body.name,
              category: body.category,
              location: body.location,
              contact: body.contact,
              quotedAmount: body.quotedAmount ?? null,
              currency: body.currency,
              servicesIncluded: body.servicesIncluded,
              cancellationTerms: body.cancellationTerms,
              paymentRecipientId: body.paymentRecipientId ?? null,
              notes: body.notes,
            },
          });
    return secureJson({ success: true, event });
  } catch (err) {
    if (err instanceof ValidationError) return secureError(err.message, 400, { details: err.details });
    return secureError(err instanceof Error ? err.message : "Vendor update failed.", 400);
  }
}
