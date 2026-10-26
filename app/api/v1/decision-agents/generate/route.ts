import { generateDecisionAgentFromPrompt } from "@/lib/decision-agents/generate-from-prompt";
import { parseJsonBody, secureError, secureJson } from "@/lib/security/api";
import { ValidationError } from "@/lib/security/errors";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const generateSchema = z.object({
  prompt: z.string().trim().min(3).max(2000),
  name: z.string().trim().min(3).max(80).optional(),
  decisionType: z.string().trim().max(64).optional(),
  templateId: z.string().trim().optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return secureError("Unauthorized", 401);

  try {
    const body = await parseJsonBody(request, generateSchema);
    const preview = generateDecisionAgentFromPrompt({
      prompt: body.prompt,
      name: body.name,
      decisionType: body.decisionType ?? "custom",
    });
    return secureJson({ success: true, preview });
  } catch (err) {
    if (err instanceof ValidationError) {
      return secureJson({ success: false, error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Could not generate decision agent.";
    return secureJson({ success: false, error: message }, { status: 500 });
  }
}
