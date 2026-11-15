import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const METHOD_NAMES: Record<string, string> = { amazon: "Amazon", apple: "Apple", ach: "ACH" };
export const WEEKLY_BONUS_BDT = 50;

export async function sendGroup(text: string) {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chat = process.env["TELEGRAM_GROUP_ID"];
  const thread = process.env["TELEGRAM_THREAD_ID"];
  if (!token || !chat) throw new Error("Telegram group not configured");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, ...(thread ? { message_thread_id: Number(thread) } : {}), text }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Telegram error [${res.status}]: ${body}`);
}

const THEMES = ["সময়ের দাম", "ধারাবাহিকতা", "ডলার আর্নিং", "ঘুম বনাম কাজ", "চা আর সার্ভে", "ছোট ছোট সঞ্চয়", "ভোরের পরিশ্রম", "অলসতা তাড়ানো", "স্বপ্ন আর টার্গেট", "মোবাইলে রোজগার"];

/** Generates a fresh 2-line witty Bengali rhyme. Falls back to a fixed line if AI is unavailable. */
export async function makeRhyme(kind: "earning" | "weekly", context: string): Promise<string> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  const theme = THEMES[Math.floor(Math.random() * THEMES.length)];
  const fallback = kind === "earning" ? "🌱 এক ডলার দুই ডলার, জমে হবে পাহাড়,\n⏰ সময় ধরে কাজ করো, সাফল্য তোমার! 🚀" : "🔥 নতুন সপ্তাহ নতুন লড়াই, টার্গেট এবার ডাবল,\n💪 যে থামবে না সেই জিতবে, বাকিরা শুধু ট্রাবল! 🏆";
  if (!apiKey) return fallback;
  try {
    const openai = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey,
      headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });
    const prompt = kind === "earning"
      ? `একজন সদস্য এইমাত্র আয় করেছে: ${context}। বিষয়: "${theme}"। একদম নতুন, মজার, ছন্দময় ২ লাইনের বাংলা মোটিভেশনাল ছড়া লেখো, ইমোজিসহ। কোনো পরিচিত প্রবাদ বা আগের ছড়া রিপিট করবে না। (seed ${crypto.randomUUID().slice(0, 8)})`
      : `সাপ্তাহিক লিডারবোর্ড: ${context}। আগামী সপ্তাহের জন্য একটা মজার, এনার্জেটিক বাংলা ছড়া ও চ্যালেঞ্জ লেখো (৩-৪ লাইন), ইমোজিসহ। বিষয়: "${theme}"। একদম নতুন হতে হবে। (seed ${crypto.randomUUID().slice(0, 8)})`;
    const result = streamText({
      model: openai.responses("openai/gpt-6-astra"),
      system: "তুমি একজন মজার বাংলা ছড়াকার। শুধু ছড়াটি লেখো — কোনো শিরোনাম, ব্যাখ্যা বা উদ্ধৃতিচিহ্ন নয়।",
      prompt,
      maxRetries: 0,
      providerOptions: { openai: { forceReasoning: true, reasoningEffort: "low", store: false } },
    });
    const text = (await result.text).trim();
    return text || fallback;
  } catch (e) {
    console.error("Rhyme generation failed", e);
    return fallback;
  }
}

export async function announceEarning(txId: string) {
  // Claim the notification atomically so each entry is announced at most once.
  const { data: tx } = await supabaseAdmin.from("transactions").update({ notified: true })
    .eq("id", txId).eq("notified", false).neq("method", "bonus").select("user_id,usd,method,site").maybeSingle();
  if (!tx) return { sent: false };
  const { data: p } = await supabaseAdmin.from("profiles").select("name").eq("id", tx.user_id).maybeSingle();
  const name = p?.name ?? "একজন সদস্য";
  const method = METHOD_NAMES[tx.method] ?? tx.method;
  const usd = Number(tx.usd).toFixed(2).replace(/\.00$/, "");
  const rhyme = await makeRhyme("earning", `${name}, $${usd}, ${method}, ${tx.site}`);
  await sendGroup(`💰 ${name} $${usd} আর্ন করে ${method}-এ অ্যাড করেছেন (${tx.site} থেকে)!\n\n${rhyme}`);
  return { sent: true };
}

/** Week key = Monday's date in Dhaka time; one bonus per user per key. */
function weekKey(now = new Date()) {
  const d = new Date(now.getTime() + 6 * 3600e3);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export async function runWeeklyLeaderboard() {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data: txs, error } = await supabaseAdmin.from("transactions").select("user_id,usd,rate")
    .eq("status", "approved").neq("method", "bonus").gte("created_at", since);
  if (error) throw new Error(error.message);
  const totals = new Map<string, number>();
  for (const t of txs ?? []) totals.set(t.user_id, (totals.get(t.user_id) ?? 0) + Number(t.usd) * Number(t.rate));
  const top = [...totals.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 2);
  if (top.length === 0) {
    const rhyme = await makeRhyme("weekly", "এই সপ্তাহে কেউ অ্যাপ্রুভড আয় করেনি");
    await sendGroup(`🏆 এই সপ্তাহের লিডারবোর্ড\n\nএই সপ্তাহে কোনো অ্যাপ্রুভড আয় নেই 😴\n\n${rhyme}`);
    return { winners: 0, bonusAdded: 0 };
  }
  const { data: profs } = await supabaseAdmin.from("profiles").select("id,name").in("id", top.map(([id]) => id));
  const nameOf = (id: string) => profs?.find((p) => p.id === id)?.name ?? "User";
  const week = weekKey();
  let added = 0;
  for (const [uid] of top) {
    const { error: e } = await supabaseAdmin.from("transactions").insert({
      user_id: uid, method: "bonus", usd: 1, rate: WEEKLY_BONUS_BDT, status: "approved", paid: false,
      code: `WEEKLY-BONUS-${week}`, site: "Weekly Leaderboard", bonus_week: week, notified: true,
    });
    if (!e) added++;
    else if (!e.message.includes("duplicate")) throw new Error(e.message);
  }
  const medals = ["🥇", "🥈"];
  const lines = top.map(([id, v], i) => `${medals[i]} ${nameOf(id)} — ৳${Math.round(v)} → ৳${WEEKLY_BONUS_BDT} বোনাস`).join("\n\n");
  const rhyme = await makeRhyme("weekly", top.map(([id, v]) => `${nameOf(id)} ৳${Math.round(v)}`).join(", "));
  const bonusLine = added > 0 ? "🎁 বোনাস অটো অ্যাকাউন্টে যোগ হয়ে গেছে!" : "🎁 এই সপ্তাহের বোনাস আগেই অ্যাকাউন্টে যোগ হয়েছে!";
  await sendGroup(`🏆 এই সপ্তাহের লিডারবোর্ড\n\n${lines}\n\n${bonusLine}\n\n${rhyme}`);
  return { winners: top.length, bonusAdded: added };
}
