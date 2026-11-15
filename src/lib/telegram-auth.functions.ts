import { createServerFn } from "@tanstack/react-start";

const enc = new TextEncoder();
async function hmac(key: Uint8Array<ArrayBuffer>, msg: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array<ArrayBuffer>(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Verifies Telegram WebApp initData and returns a one-time sign-in token for that Telegram user. */
export const telegramSignIn = createServerFn({ method: "POST" })
  .inputValidator((i: { initData: string }) => {
    if (typeof i?.initData !== "string" || i.initData.length > 4096) throw new Error("Invalid");
    return i;
  })
  .handler(async ({ data }) => {
    const botToken = process.env["TELEGRAM_BOT_TOKEN"];
    if (!botToken) throw new Error("Bot token missing");
    const params = new URLSearchParams(data.initData);
    const hash = params.get("hash");
    if (!hash) throw new Error("Invalid Telegram data");
    params.delete("hash");
    const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
    const secret = await hmac(enc.encode("WebAppData"), botToken);
    if (hex(await hmac(secret, check)) !== hash) throw new Error("Invalid Telegram signature");
    const authDate = Number(params.get("auth_date"));
    if (!authDate || Date.now() / 1000 - authDate > 86400) throw new Error("Telegram session expired");
    const tgUser = JSON.parse(params.get("user") || "{}") as { id?: number; first_name?: string; last_name?: string };
    if (!tgUser.id) throw new Error("No Telegram user");

    const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ").slice(0, 80) || "User";
    const email = `tg${tgUser.id}@telegram.local`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin.from("profiles").select("id").eq("telegram_id", tgUser.id).maybeSingle();
    let uid = existing?.id;
    if (!uid) {
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { telegram_id: tgUser.id, name } });
      if (error || !created.user) throw new Error(error?.message ?? "Could not create user");
      uid = created.user.id;
    }
    await supabaseAdmin.from("profiles").upsert({ id: uid, telegram_id: tgUser.id, name });
    if (String(tgUser.id) === (process.env["ADMIN_TELEGRAM_ID"] ?? "").trim()) {
      await supabaseAdmin.from("user_roles").upsert({ user_id: uid, role: "admin" }, { onConflict: "user_id,role" });
    }
    const { data: link, error: le } = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
    if (le || !link.properties?.hashed_token) throw new Error(le?.message ?? "Sign-in failed");
    return { tokenHash: link.properties.hashed_token, telegramId: tgUser.id };
  });
