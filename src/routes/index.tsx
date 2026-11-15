import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { telegramSignIn } from "@/lib/telegram-auth.functions";
import { Home, History, Trophy, Wallet, Shield, X, Pencil, Check, Trash2, ImagePlus } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ডলার হিসাব — USD to BDT Earnings Tracker" },
      { name: "description", content: "Telegram Mini App to track USD earnings converted to BDT with pending, approved and paid-out balances." },
      { property: "og:title", content: "ডলার হিসাব — Earnings Tracker" },
      { property: "og:description", content: "Track Amazon, Apple and ACH earnings in BDT." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: App,
});

type Method = { id: string; name: string; icon: string; rate: number; sub?: string; tone: string };
const METHODS: Method[] = [
  { id: "amazon", name: "Amazon", icon: "🅰️", rate: 80, tone: "from-amber-100 to-orange-200 text-orange-600" },
  { id: "apple", name: "Apple", icon: "🍎", rate: 85, tone: "from-zinc-100 to-zinc-300 text-zinc-900" },
  { id: "ach", name: "ACH", icon: "🏦", rate: 95, tone: "from-emerald-50 to-emerald-200 text-emerald-800" },
];
const SUMMARY = METHODS.map((m) => ({ name: m.name, ids: [m.id] }));

type Tx = { id: string; userId?: string; method: string; usd: number; rate: number; status: "pending" | "approved"; paid: boolean; at: number; code: string; site: string; img?: string };
const SURVEY_SITES = ["TapResearch", "Topsurvey", "PrimeOpinion", "Heycash", "Five survey", "Heypiggy", "Nicesurvey", "Surveystreak", "Eureka", "Other"];
type Device = { id: string; kind: string; label: string; expiry: number };
type State = { txs: Tx[]; devices: Device[]; paidOut: number; rates?: Record<string, number> };
const empty: State = { txs: [], devices: [], paidOut: 0 };

const bnDigits = (s: string | number) => String(s).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[+d] ?? d);
const tk = (n: number) => "৳" + Math.round(n).toLocaleString("en-US");
const fmtBn = (t: number) =>
  new Date(t).toLocaleString("bn-BD", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });

type Row = Database["public"]["Tables"]["transactions"]["Row"];
const toTx = (r: Row): Tx => ({ id: r.id, userId: r.user_id, method: r.method, usd: Number(r.usd), rate: Number(r.rate), status: r.status as Tx["status"], paid: r.paid, at: new Date(r.created_at).getTime(), code: r.code, site: r.site, ...(r.img_path ? { img: r.img_path } : {}) });

/** Signs the visitor in with their Telegram account (no login screen). */
function useTelegramSession() {
  const [st, setSt] = useState<{ uid?: string; tgId?: number; name: string; status: "loading" | "ready" | "no-telegram" | "error"; err?: string }>({ name: "", status: "loading" });
  useEffect(() => {
    (async () => {
      const tg = (window as any).Telegram?.WebApp;
      tg?.ready?.(); tg?.expand?.();
      const initData: string = tg?.initData ?? "";
      const tgUser = tg?.initDataUnsafe?.user;
      const name = tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") : "";
      const { data: { session } } = await supabase.auth.getSession();
      const sameUser = session && (!tgUser || session.user.user_metadata?.["telegram_id"] === tgUser.id);
      if (session && sameUser) {
        setSt({ uid: session.user.id, tgId: session.user.user_metadata?.["telegram_id"], name: name || session.user.user_metadata?.["name"] || "User", status: "ready" });
        return;
      }
      if (!initData) { setSt({ name: "", status: "no-telegram" }); return; }
      try {
        if (session) await supabase.auth.signOut();
        const r = await telegramSignIn({ data: { initData } });
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: r.tokenHash, type: "magiclink" });
        if (error || !data.user) throw error ?? new Error("Sign-in failed");
        setSt({ uid: data.user.id, tgId: r.telegramId, name: name || "User", status: "ready" });
      } catch (e: any) { setSt({ name: "", status: "error", err: e?.message ?? "Sign-in failed" }); }
    })();
  }, []);
  return st;
}

export function App() {
  const user = useTelegramSession();
  const [s, setS] = useState<State>(empty);
  const [isAdmin, setIsAdmin] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [board, setBoard] = useState<{ name: string; total: number }[]>([]);
  const [tab, setTab] = useState<"home" | "history" | "leader">("home");
  const [admin, setAdmin] = useState(false);
  const [modal, setModal] = useState<{ method: Method; edit?: Tx | undefined } | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  const load = useCallback(async () => {
    if (!user.uid) return;
    const [tx, dev, pay, rt, role, lb] = await Promise.all([
      supabase.from("transactions").select("*").order("created_at", { ascending: false }),
      supabase.from("devices").select("*").order("expiry"),
      supabase.from("payouts").select("amount").eq("user_id", user.uid),
      supabase.from("rates").select("*"),
      supabase.from("user_roles").select("role").eq("user_id", user.uid).eq("role", "admin"),
      supabase.rpc("get_leaderboard"),
    ]);
    const adm = (role.data?.length ?? 0) > 0;
    setIsAdmin(adm);
    setBoard((lb.data ?? []).map((r) => ({ name: r.name, total: Number(r.total) })));
    setS({
      txs: (tx.data ?? []).map(toTx),
      devices: (dev.data ?? []).map((d) => ({ id: d.id, kind: d.kind, label: d.label, expiry: new Date(d.expiry).getTime() })),
      paidOut: (pay.data ?? []).reduce((a, r) => a + Number(r.amount), 0),
      rates: Object.fromEntries((rt.data ?? []).map((r) => [r.method, Number(r.rate)])),
    });
    if (adm) {
      const { data } = await supabase.from("profiles").select("id,name,telegram_id");
      setNames(Object.fromEntries((data ?? []).map((p) => [p.id, `${p.name} (${p.telegram_id})`])));
    }
  }, [user.uid]);
  useEffect(() => { load(); }, [load]);

  const methods = METHODS.map((m) => ({ ...m, rate: s.rates?.[m.id] ?? m.rate }));
  const mine = s.txs.filter((t) => t.userId === user.uid);
  const bdt = (t: Tx) => t.usd * t.rate;
  const calc = useMemo(() => {
    const appr = mine.filter((t) => t.status === "approved");
    const running = appr.filter((t) => !t.paid);
    const pending = mine.filter((t) => t.status === "pending");
    const allPending = s.txs.filter((t) => t.status === "pending");
    const allRunning = s.txs.filter((t) => t.status === "approved" && !t.paid).reduce((a, t) => a + bdt(t), 0);
    return {
      running: running.reduce((a, t) => a + bdt(t), 0),
      runningUsd: running.reduce((a, t) => a + t.usd, 0),
      pending: pending.reduce((a, t) => a + bdt(t), 0),
      lifetime: appr.reduce((a, t) => a + bdt(t), 0),
      appr, pendingList: pending, allPending, allRunning,
    };
  }, [s, user.uid]);

  const fail = (e: { message: string } | null) => { if (e) { alert(e.message); return true; } return false; };
  const upsertTx = async (method: Method, d: { usd: number; code: string; site: string; img: string }, edit?: Tx) => {
    let img_path: string | null = edit?.img ?? null;
    if (!d.img) img_path = null;
    else if (d.img.startsWith("data:")) {
      const blob = await (await fetch(d.img)).blob();
      const path = `${user.uid}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("proofs").upload(path, blob, { contentType: blob.type || "image/jpeg" });
      if (fail(up.error)) return;
      img_path = path;
    }
    const body = { usd: d.usd, code: d.code, site: d.site, img_path };
    const r = edit
      ? await supabase.from("transactions").update(body).eq("id", edit.id)
      : await supabase.from("transactions").insert({ ...body, method: method.id, user_id: user.uid! });
    if (!fail(r.error)) load();
  };
  const approve = async (id: string) => { const r = await supabase.from("transactions").update({ status: "approved" }).eq("id", id); if (!fail(r.error)) load(); };
  const remove = async (id: string) => { const r = await supabase.from("transactions").delete().eq("id", id); if (!fail(r.error)) load(); };
  const markPaid = async () => { const r = await supabase.rpc("mark_all_paid"); if (!fail(r.error)) load(); };
  const setRate = async (method: string, rate: number) => { setS((p) => ({ ...p, rates: { ...p.rates, [method]: rate } })); await supabase.from("rates").upsert({ method, rate }); };
  const addDevice = async (kind: string, label: string, days: number) => { const r = await supabase.from("devices").insert({ kind, label, expiry: new Date(Date.now() + days * 864e5).toISOString() }); if (!fail(r.error)) load(); };
  const delDevice = async (id: string) => { const r = await supabase.from("devices").delete().eq("id", id); if (!fail(r.error)) load(); };

  if (user.status !== "ready") {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="font-bn text-2xl font-bold">💵 ডলার হিসাব</h1>
        <p className="font-bn text-muted-foreground">
          {user.status === "loading" ? "Telegram দিয়ে লগইন হচ্ছে…" : user.status === "no-telegram" ? "এই অ্যাপটি Telegram এর ভিতরে খুলুন।" : `লগইন ব্যর্থ: ${user.err}`}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-md pb-28">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-card/90 px-5 py-4 backdrop-blur">
        <h1 className="font-bn text-xl font-bold">💵 ডলার হিসাব</h1>
        {isAdmin && <button onClick={() => setAdmin(!admin)} className={`flex items-center gap-1 rounded-full border px-3 py-2 text-xs font-semibold ${admin ? "bg-primary text-primary-foreground" : "bg-card"}`}>
          <Shield size={14} /> Admin
        </button>}
      </header>
      <p className="px-5 pt-3 text-xs text-muted-foreground">👋 {user.name}{user.tgId ? ` · ID ${user.tgId}` : ""}</p>

      {admin && isAdmin && <AdminPanel s={s} calc={calc} names={names} approve={approve} remove={remove} markPaid={markPaid} setRate={setRate} addDevice={addDevice} delDevice={delDevice} />}

      {tab === "home" && (
        <main className="space-y-6 px-5 pt-3">
          <div className="grid grid-cols-2 gap-3">
            <GradCard cls="bg-grad-purple" label="Running Balance" value={tk(calc.running).replace("৳", "৳ ")} />
            <GradCard cls="bg-grad-orange" label="Pending Balance" value={tk(calc.pending).replace("৳", "৳ ")} />
          </div>
          <div className="bg-grad-teal flex items-center justify-between rounded-3xl p-5 text-on-gradient shadow-lg">
            <div><p className="label-caps">💵 Total Running USD</p><p className="mt-1 text-3xl font-extrabold">${calc.runningUsd.toFixed(2)}</p></div>
            <div className="text-right"><p className="text-sm opacity-90">Approx in BDT</p><p className="text-xl font-bold">{tk(calc.running)}</p></div>
          </div>

          <Section title="📈 Income Breakdown">
            <div className="grid grid-cols-2 gap-3">
              <InfoCard bar="bg-success" label="🔄 Running Income" value={tk(calc.running)} note="(এখনো পেমেন্ট হয়নি)" />
              <InfoCard bar="bg-primary" label="🏆 Lifetime Income" value={tk(calc.lifetime)} note="(সব কিছু মিলিয়ে)" />
            </div>
          </Section>

          <Section title="🌐 Proxy IP & Cloud Phone মেয়াদ">
            <div className="card-soft divide-y p-5">
              {s.devices.length === 0 && <p className="text-sm text-muted-foreground">কোনো ডিভাইস নেই — Admin থেকে যোগ করুন</p>}
              {s.devices.map((d) => <Countdown key={d.id} d={d} now={now} />)}
            </div>
          </Section>

          <Section title="📊 Summary">
            <SummaryList title="✅ Lifetime (Approved)" txs={calc.appr} />
            <SummaryList title="⏳ Pending" txs={calc.pendingList} />
            <div className="card-soft mt-3 p-5">
              <p className="label-caps text-primary">💸 Paid Out</p>
              <div className="mt-3 flex justify-between"><span className="text-muted-foreground">Already Paid</span><span className="text-xl font-bold">৳ {s.paidOut.toFixed(1)}</span></div>
            </div>
          </Section>

          <Section title="💰 Add Earnings">
            <div className="grid grid-cols-3 gap-3">
              {methods.map((m) => (
                <button key={m.id} onClick={() => setModal({ method: m })} className={`flex min-h-36 flex-col items-center justify-center gap-1 rounded-[2rem] bg-gradient-to-b p-2 text-center shadow-sm transition active:scale-95 ${m.tone}`}>
                  <span className="text-3xl">{m.icon}</span>
                  <span className="text-sm font-bold leading-tight">{m.name}</span>
                  <span className="text-xs opacity-70">{m.sub ? `${m.sub} · ` : ""}×{m.rate} BDT</span>
                </button>
              ))}
            </div>
          </Section>

          <div className="grid grid-cols-2 gap-3">
            <NavCard icon={<Trophy className="text-warning" size={36} />} title="Leaderboard" sub="Top earners" onClick={() => setTab("leader")} />
            <NavCard icon={<Wallet className="text-success" size={36} />} title="History" sub="All transactions" onClick={() => setTab("history")} />
          </div>

          <Section title="📝 Recent Activity">
            <TxList txs={mine.slice(0, 5)} onEdit={(t) => setModal({ method: methods.find((m) => m.id === t.method)!, edit: t })} />
          </Section>
        </main>
      )}

      {tab === "history" && (
        <main className="px-5 pt-3"><Section title="🧾 All Transactions">
          <TxList txs={mine} onEdit={(t) => setModal({ method: methods.find((m) => m.id === t.method)!, edit: t })} />
        </Section></main>
      )}

      {tab === "leader" && (
        <main className="px-5 pt-3"><Section title="🏆 Top Earners">
          <div className="space-y-2">
            {board.length === 0 && <p className="card-soft p-5 text-sm text-muted-foreground">এখনো কেউ নেই</p>}
            {board.map((b, i) => (
              <div key={i} className="card-soft flex items-center justify-between p-5">
                <span className="font-semibold">{["🥇", "🥈", "🥉"][i] ?? `#${i + 1}`} {b.name}</span><span className="font-bold">{tk(b.total)}</span>
              </div>
            ))}
          </div>
        </Section></main>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-md border-t bg-card/95 backdrop-blur">
        {([["home", Home, "Home"], ["history", History, "History"]] as const).map(([k, I, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex flex-1 flex-col items-center py-3 text-sm font-semibold ${tab === k ? "text-primary" : "text-muted-foreground/60"}`}>
            <I size={28} fill={tab === k && k === "home" ? "currentColor" : "none"} />{l}
          </button>
        ))}
      </nav>

      {modal && <AmountModal m={modal.method} edit={modal.edit} onClose={() => setModal(null)} onSubmit={async (d) => { await upsertTx(modal.method, d, modal.edit); setModal(null); }} />}
    </div>
  );
}

function GradCard({ cls, label, value }: { cls: string; label: string; value: string }) {
  return (
    <div className={`${cls} relative overflow-hidden rounded-3xl p-5 text-on-gradient shadow-lg`}>
      <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-on-gradient/15" />
      <p className="label-caps opacity-90">{label}</p>
      <p className="mt-3 text-3xl font-extrabold">{value}</p>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-3"><h2 className="label-caps font-bn text-muted-foreground">{title}</h2><div className="h-px flex-1 bg-border" /></div>
      {children}
    </section>
  );
}
function InfoCard({ bar, label, value, note }: { bar: string; label: string; value: string; note: string }) {
  return (
    <div className="card-soft relative overflow-hidden p-5 pl-6">
      <div className={`absolute inset-y-0 left-0 w-1.5 ${bar}`} />
      <p className="label-caps text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-extrabold">{value}</p>
      <p className="font-bn text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
function NavCard({ icon, title, sub, onClick }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="card-soft flex flex-col items-center gap-2 p-6 active:scale-95">
      {icon}<span className="text-lg font-bold">{title}</span><span className="text-sm text-muted-foreground">{sub}</span>
    </button>
  );
}
function Countdown({ d, now }: { d: Device; now: number }) {
  const ms = Math.max(0, d.expiry - now);
  const D = Math.floor(ms / 864e5), H = Math.floor(ms / 36e5) % 24, M = Math.floor(ms / 6e4) % 60, S = Math.floor(ms / 1e3) % 60;
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <p className="font-semibold">☁️ {d.kind} <span className="font-normal text-muted-foreground">({d.label})</span></p>
      <p className="font-bn mt-1 text-2xl font-bold text-primary">
        {ms === 0 ? "মেয়াদ শেষ" : `${bnDigits(D)} দিন ${bnDigits(H)} ঘণ্টা ${bnDigits(M)} মিনিট ${bnDigits(S)} সেকেন্ড`}
      </p>
      <p className="font-bn text-sm text-muted-foreground">মেয়াদ শেষ হবে: {fmtBn(d.expiry)}</p>
    </div>
  );
}
function SummaryList({ title, txs }: { title: string; txs: Tx[] }) {
  return (
    <div className="card-soft mb-3 p-5">
      <p className="label-caps mb-2 text-primary">{title}</p>
      {SUMMARY.map((g) => {
        const l = txs.filter((t) => g.ids.includes(t.method));
        const usd = l.reduce((a, t) => a + t.usd, 0), b = l.reduce((a, t) => a + t.usd * t.rate, 0);
        return (
          <div key={g.name} className="flex justify-between border-b py-2 text-sm last:border-0">
            <span>{g.name}</span><span className="font-semibold">${usd.toFixed(2)} · {tk(b)}</span>
          </div>
        );
      })}
    </div>
  );
}
function TxList({ txs, onEdit }: { txs: Tx[]; onEdit: (t: Tx) => void }) {
  if (!txs.length) return <p className="card-soft p-5 text-sm text-muted-foreground">এখনো কোনো লেনদেন নেই</p>;
  return (
    <div className="space-y-2">
      {txs.map((t) => {
        const m = METHODS.find((x) => x.id === t.method);
        if (!m) return null;
        return (
          <div key={t.id} className="card-soft flex items-center gap-3 p-4">
            <span className="text-2xl">{m.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{m.name}</p>
              <p className="truncate text-xs font-semibold text-primary">🏷️ {t.site || "—"}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">🎫 {t.code || "—"}</p>
              <p className="font-bn truncate text-xs text-muted-foreground">{fmtBn(t.at)}</p>
              <ProofButton img={t.img} />
            </div>
            <div className="shrink-0 text-right">
              <p className="font-bold">${t.usd.toFixed(2)}</p>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${t.status === "pending" ? "bg-warning/20 text-warning" : "bg-success/20 text-success"}`}>
                {t.paid ? "PAID" : t.status.toUpperCase()}
              </span>
            </div>
            {t.status === "pending" && (
              <button onClick={() => onEdit(t)} className="shrink-0 rounded-full bg-secondary p-2 text-secondary-foreground" aria-label="Edit"><Pencil size={14} /></button>
            )}
          </div>
        );
      })}
    </div>
  );
}
function useProofUrl(img?: string) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!img) { setUrl(""); return; }
    if (img.startsWith("data:")) { setUrl(img); return; }
    supabase.storage.from("proofs").createSignedUrl(img, 3600).then(({ data }) => setUrl(data?.signedUrl ?? ""));
  }, [img]);
  return url;
}
function ProofButton({ img: path }: { img?: string | undefined }) {
  const [open, setOpen] = useState(false);
  const img = useProofUrl(path);
  if (!path || !img) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="View Screenshot" className="mt-1 flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold text-primary active:scale-95">
        <img src={img} alt="" className="h-6 w-6 rounded object-cover" /> View Screenshot
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/80 p-4" onClick={() => setOpen(false)}>
          <img src={img} alt="Payment proof screenshot" className="max-h-[85vh] max-w-full rounded-2xl object-contain" />
          <button aria-label="Close" onClick={() => setOpen(false)} className="absolute right-4 top-4 rounded-full bg-card p-2"><X size={18} /></button>
        </div>
      )}
    </>
  );
}
function AmountModal({ m, edit, onClose, onSubmit }: { m: Method; edit?: Tx | undefined; onClose: () => void; onSubmit: (d: { usd: number; code: string; site: string; img: string }) => Promise<void> }) {
  const [v, setV] = useState(edit ? String(edit.usd) : "");
  const [code, setCode] = useState(edit?.code ?? "");
  const [site, setSite] = useState(edit?.site ?? "");
  const [img, setImg] = useState(edit?.img ?? "");
  const [busy, setBusy] = useState(false);
  const preview = useProofUrl(img);
  const n = parseFloat(v);
  const usdOk = n > 0 && n < 100000;
  const valid = usdOk && code.trim() !== "" && site !== "";
  const pickImage = (f?: File) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      let ctx: CanvasRenderingContext2D | null = null;
      try { ctx = document.createElement("canvas").getContext("2d"); } catch { ctx = null; }
      if (!ctx) { setImg(url); return; }
      const im = new Image();
      im.onload = () => {
        try {
          const sc = Math.min(1, 900 / Math.max(im.width, im.height));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(im.width * sc));
          c.height = Math.max(1, Math.round(im.height * sc));
          c.getContext("2d")?.drawImage(im, 0, 0, c.width, c.height);
          setImg(c.toDataURL("image/jpeg", 0.72));
        } catch { setImg(url); }
      };
      im.onerror = () => setImg(url);
      im.src = url;
    };
    r.readAsDataURL(f);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 sm:items-center" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-3xl bg-popover p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">{m.icon} {edit ? "Edit" : "Add"} {m.name}</h3>
          <button onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Rate ×{m.rate} BDT{m.sub ? ` · ${m.sub}` : ""}</p>

        <label htmlFor="amt-usd" className="label-caps mt-4 block text-muted-foreground">Dollar Amount ($)</label>
        <input id="amt-usd" autoFocus type="number" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} placeholder="USD amount" className="mt-1 w-full rounded-2xl border bg-card px-4 py-3 text-2xl font-bold outline-none focus:ring-2 focus:ring-ring" />
        <p className="mt-2 text-sm">≈ <b>{usdOk ? tk(n * m.rate) : "৳0"}</b></p>

        <label htmlFor="amt-code" className="label-caps mt-4 block text-muted-foreground">Code / Gift Card Code</label>
        <input id="amt-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste gift card or payout code" className="mt-1 w-full rounded-2xl border bg-card px-4 py-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring" />

        <label htmlFor="amt-site" className="label-caps mt-4 block text-muted-foreground">Survey Site Name</label>
        <select id="amt-site" value={site} onChange={(e) => setSite(e.target.value)} className="mt-1 w-full rounded-2xl border bg-card px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="">Select survey site</option>
          {SURVEY_SITES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <label htmlFor="amt-img" className="label-caps mt-4 block text-muted-foreground">Upload Screenshot / Proof Image</label>
        <input id="amt-img" type="file" accept="image/*" onChange={(e) => pickImage(e.target.files?.[0])} className="mt-1 w-full rounded-2xl border bg-card px-4 py-3 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-3 file:py-1 file:text-xs file:font-bold file:text-primary-foreground" />
        {img ? (
          <div className="mt-2 flex items-center gap-3">
            <img src={preview} alt="Proof preview" className="h-20 w-20 rounded-xl border object-cover" />
            <button onClick={() => setImg("")} className="flex items-center gap-1 text-xs font-semibold text-destructive"><Trash2 size={12} /> Remove</button>
          </div>
        ) : (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"><ImagePlus size={12} /> Optional — gallery or camera photo</p>
        )}

        <button disabled={!valid || busy} onClick={async () => { setBusy(true); try { await onSubmit({ usd: Math.round(n * 100) / 100, code: code.trim(), site, img }); } finally { setBusy(false); } }} className="bg-grad-purple mt-5 w-full rounded-2xl py-3 font-bold text-on-gradient disabled:opacity-40">
          {busy ? "Saving…" : edit ? "Save" : "Submit (Pending)"}
        </button>
      </div>
    </div>
  );
}
function AdminPanel({ s, calc, names, approve, remove, markPaid, setRate, addDevice: add, delDevice }: any) {
  const [kind, setKind] = useState("Cloud Phone");
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("7");
  const addDevice = () => {
    if (!label.trim() || !(+days > 0)) return;
    add(kind, label.trim().slice(0, 40), +days);
    setLabel("");
  };
  return (
    <div className="mx-5 mt-3 space-y-4 rounded-3xl border-2 border-primary/40 bg-card p-4">
      <p className="label-caps text-primary">🛡️ Admin Panel</p>
      <div>
        <p className="mb-2 text-sm font-semibold">Pending ({calc.allPending.length})</p>
        {calc.allPending.map((t: Tx) => (
          <div key={t.id} className="border-b py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-semibold">{METHODS.find((m) => m.id === t.method)?.name} · ${t.usd}</span>
              <span className="flex shrink-0 gap-2">
                <button onClick={() => approve(t.id)} className="rounded-full bg-success p-1.5 text-on-gradient" aria-label="Approve"><Check size={14} /></button>
                <button onClick={() => remove(t.id)} className="rounded-full bg-destructive p-1.5 text-on-gradient" aria-label="Delete"><Trash2 size={14} /></button>
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground">👤 {names[t.userId ?? ""] ?? "—"}</p>
            <p className="truncate text-xs font-semibold text-primary">🏷️ {t.site || "—"}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">🎫 {t.code || "—"}</p>
            <ProofButton img={t.img} />
          </div>
        ))}
      </div>
      <button onClick={markPaid} disabled={calc.allRunning <= 0} className="bg-grad-teal w-full rounded-2xl py-2.5 text-sm font-bold text-on-gradient disabled:opacity-40">
        Mark {tk(calc.allRunning)} as Paid Out
      </button>
      <div className="space-y-2">
        <p className="text-sm font-semibold">Rates (BDT per $)</p>
        <div className="grid grid-cols-3 gap-2">
          {METHODS.map((m) => (
            <label key={m.id} className="text-xs">{m.name}
              <input type="number" value={s.rates?.[m.id] ?? m.rate} onChange={(e) => { const v = +e.target.value; if (v >= 0 && v < 10000) setRate(m.id, v); }} className="mt-1 w-full rounded-xl border bg-card px-2 py-1.5 text-sm" />
            </label>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">New rates apply to new entries.</p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold">Devices / Expiry</p>
        <div className="flex gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-xl border bg-card px-2 text-sm"><option>Cloud Phone</option><option>Proxy IP</option></select>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name e.g. FUSION111" className="min-w-0 flex-1 rounded-xl border bg-card px-3 py-2 text-sm" />
          <input value={days} onChange={(e) => setDays(e.target.value)} type="number" className="w-14 rounded-xl border bg-card px-2 text-sm" aria-label="Days" />
        </div>
        <button onClick={addDevice} className="w-full rounded-xl bg-primary py-2 text-sm font-bold text-primary-foreground">Add timer (days)</button>
        {s.devices.map((d: Device) => (
          <div key={d.id} className="flex items-center justify-between text-sm">
            <span>{d.kind} ({d.label})</span>
            <button onClick={() => delDevice(d.id)} className="text-destructive" aria-label="Remove"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
