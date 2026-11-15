import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/jobs/weekly-leaderboard")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const { runWeeklyLeaderboard } = await import("@/lib/notify.server");
        try {
          return Response.json(await runWeeklyLeaderboard());
        } catch (e) {
          console.error(e);
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
