import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Called by the app right after a user submits an earning; announces it in the Telegram group once. */
export const notifyNewEarning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { txId: string }) => {
    if (typeof i?.txId !== "string" || !/^[0-9a-f-]{36}$/.test(i.txId)) throw new Error("Invalid");
    return i;
  })
  .handler(async ({ data, context }) => {
    // RLS: caller must own the entry (or be admin) to see it.
    const { data: tx } = await context.supabase.from("transactions").select("id").eq("id", data.txId).maybeSingle();
    if (!tx) throw new Error("Not found");
    const { announceEarning } = await import("@/lib/notify.server");
    return announceEarning(data.txId);
  });

export const sendWeeklyLeaderboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { runWeeklyLeaderboard } = await import("@/lib/notify.server");
    return runWeeklyLeaderboard();
  });
