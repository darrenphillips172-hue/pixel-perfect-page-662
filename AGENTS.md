<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules
- Users sign in only via Telegram: `telegramSignIn` server fn verifies WebApp initData with TELEGRAM_BOT_TOKEN, then issues a magic-link token the client verifies — never add an email/password screen. Why: identity must be the Telegram account.
- Admin = `user_roles` row, granted automatically when Telegram ID equals ADMIN_TELEGRAM_ID. Why: no client-side admin checks.
- Rate/status/paid on transactions are enforced by the `tx_guard` DB trigger; proof images live in the private `proofs` bucket under `<user_id>/`. Why: users can't tamper with balances or see others' proofs.
- Telegram group posts (new-earning announcements, weekly leaderboard + bonus) live in `src/lib/notify.server.ts`; the weekly job is the `/api/public/jobs/weekly-leaderboard` route on a managed schedule, not an Edge Function. Why: TanStack server routes are the project's server surface.
- Weekly bonuses are `transactions` rows with method `bonus`, inserted only by the server (tx_guard rejects user inserts) and unique per user per `bonus_week`. Why: they flow into Running Balance/payouts with no double-pay.
