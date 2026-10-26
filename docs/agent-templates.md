# Agent templates marketplace

Templates are a **catalog + clone** layer on top of the existing agent builder. They do not replace Agent Builder, Test, Deploy, Connect, Decision Agents, or workflows.

## How templates are seeded

1. Canonical definitions live in `lib/templates/marketplace-catalog.ts` (published templates, unique `slug`).
2. Optional database persistence: table `public.templates` (extended by `supabase/migrations/20260930120000_agent_templates_marketplace.sql`).
3. Seed command upserts by `id`/`slug` and is idempotent:

```bash
npm run seed:templates
```

If the extra columns are missing, the UI still lists the in-code catalog (54 templates). The original 8 `template-*` rows stay unpublished so they do not appear in the marketplace but still resolve for old `source = template:template-N` agents.

## How to add a new template

1. Append a draft object in `lib/templates/marketplace-catalog.ts` (`DRAFTS`).
2. Set `slug`, copy, `category`, `riskLevel`, `tools` (must be existing catalog tools), and user-visible `defaultInstructions` (no hidden system prompts).
3. Safety defaults are derived from `riskLevel` in `lib/templates/safety-defaults.ts`.
4. Re-run `npm run seed:templates` after applying the migration.

Do not add a second agent creation pipeline.

## Clone flow

`POST /api/v1/agents/create-from-template` (authenticated, rate-limited) loads the template **server-side** by id/slug, then calls existing `createBuilderAgent`. Client-supplied risk/permissions are ignored. High-risk templates are stored as `draft` and cannot be activated until `POST /api/v1/agents/:agentId/template-permissions-review`.

The user is sent to `/agents/{slug}/setup?from=template` (existing setup page) with a checklist. Global templates are never mutated.

## Risk → safety defaults

| Risk | Start | Writes | Activation |
|---|---|---|---|
| Low | Active-capable draft | Read/draft tools; no payments/delete/bulk send | No extra gate |
| Medium | Review writes | Approval for external writes | Review recommended |
| High | Paused/draft | Approval for every sensitive action | Server blocks activate/publish until permissions review |

Non-template agents have no `safety_settings.template.riskLevel`, so Builder / Connect / workflow publish paths are unchanged.

## Tests

```bash
npx tsx --test lib/templates/**/*.test.ts
```
