import { testExternalAgentConnection } from "@/lib/agents/external/test-connection";
import { isSupportedConnectionMethod } from "@/lib/agents/external/connection-methods";
import { ensureOrganization } from "@/lib/organizations/ensure-organization";
import { parseJsonBody, secureError, secureJson } from "@/lib/security/api";
import { ValidationError } from "@/lib/security/errors";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const testSchema = z.object({
  method: z.string(),
  endpointUrl: z.string().trim().optional(),
  authType: z.enum(["none", "bearer", "api_key_header"]).optional(),
  authToken: z.string().optional(),
  authHeaderName: z.string().optional(),
  agentId: z.string().optional(),
  apiKey: z.string().optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return secureError("Unauthorized", 401);

  try {
    await ensureOrganization(supabase, user.id, user.email ?? "user@local");
    const body = await parseJsonBody(request, testSchema);

    if (!isSupportedConnectionMethod(body.method)) {
      return secureError("Unsupported connection method.", 400);
    }

    const result = await testExternalAgentConnection({
      method: body.method,
      endpointUrl: body.endpointUrl,
      authType: body.authType,
      authToken: body.authToken,
      authHeaderName: body.authHeaderName,
      agentId: body.agentId,
      apiKey: body.apiKey,
    });

    return secureJson({ success: result.passed, result });
  } catch (err) {
    if (err instanceof ValidationError) {
      return secureError(err.message, 400, { details: err.details });
    }
    const message = err instanceof Error ? err.message : "Test failed.";
    return secureError(message, 500);
  }
}
