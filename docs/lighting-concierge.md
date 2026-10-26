# Lighting Concierge template

Ready-made WAVE agent for electricians' customers. Clone it from **Templates** with **Use this template**. That calls the existing `POST /api/v1/agents/create-from-template` flow.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set `QLOO_API_KEY` (server-only). Optional: `QLOO_API_BASE_URL` (default `https://api.qloo.com`).
3. Restart `npm run dev`.
4. Apply `supabase/migrations/20261025180000_lighting_concierge.sql` in the Supabase SQL editor (or your usual migration process).
5. Optional: `npm run seed:templates` so the catalog row exists in `public.templates`. The in-code catalog still lists the template without seeding.

## Vercel

Add `QLOO_API_KEY` (and optionally `QLOO_API_BASE_URL`) in Project Settings → Environment Variables. Do not prefix it with `NEXT_PUBLIC_`.

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
| Qloo Insights + Tags Search | Live when `QLOO_API_KEY` is set |
| Address verification provider | Not connected — manual reviewer workflow |
| Electrician calendar / scheduling | Not connected — pending requests only |

## Qloo endpoints used

Documented at [Qloo API onboarding](https://docs.qloo.com/reference/api-onboarding) and [Taste Analysis](https://docs.qloo.com/reference/taste-analysis):

- `GET {QLOO_API_BASE_URL}/v2/tags?query=` then `filter.query=` (Tags Search)
- `GET {QLOO_API_BASE_URL}/v2/insights?filter.type=urn:tag&signal.interests.tags=`
- `GET {QLOO_API_BASE_URL}/v2/insights?filter.type=urn:entity:brand&signal.interests.tags=`
- Header: `X-Api-Key`

Qloo does not measure warm vs cool Kelvin or whether a room is suitable. Those remain general lighting rules, labeled separately from Qloo tags.

If the key is missing, Qloo returns nothing, or the API errors (401/429/timeout), WAVE continues with the customer's stated preferences and labels the result as a fallback. It never invents Qloo rows.
