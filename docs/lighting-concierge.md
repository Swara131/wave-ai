# Lighting Concierge template

Ready-made WAVE agent for electricians' customers. Clone it from **Templates** with **Use this template**. That calls the existing `POST /api/v1/agents/create-from-template` flow.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Restart `npm run dev`.
3. Apply `supabase/migrations/20261025180000_lighting_concierge.sql` in the Supabase SQL editor (or your usual migration process).
4. Optional: `npm run seed:templates` so the catalog row exists in `public.templates`. The in-code catalog still lists the template without seeding.

## How to test the template

1. Open `/templates`, filter **Home Services / Smart Recommendations**, click Lighting Concierge, then **Use this template**.
2. Finish setup, then open `/agents/{slug}/lighting` (or Test — WAVE routes lighting intake there).
3. Submit a complete intake and **Generate Lighting Plan**.
4. Quotes **below ₹5,000** that are complete can auto-allow. **₹5,000 and above**, and incomplete quotes, appear on **Approvals**.
5. Request address verification. Approving that proposal is the only way an address becomes `verified`.
6. Request an electrician visit only after the customer confirms. WAVE stores `pending_confirmation`. It does not invent a booked slot.

## Live vs manual integrations

| Integration | Status |
|---|---|
| WAVE agent clone, approvals, audit | Live |
| Configured electrician rate table | Live (editable on the agent) |
| Address verification provider | Not connected — manual reviewer workflow |
| Electrician calendar / scheduling | Not connected — pending requests only |

Plans use the customer's stated room details, style, budget, and the rate table. WAVE never invents supplier SKUs, electrician availability, or a verified address.
