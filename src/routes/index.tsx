import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Home, History, Trophy, Wallet, Shield, X, Pencil, Check, Trash2 } from "lucide-react";

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

type Tx = { id: string; method: string; usd: number; rate: number; status: "pending" | "approved"; paid: boolean; at: number; code: string; site: string };
const SURVEY_SITES = ["Swagbucks", "Freecash", "Prime Opinion", "Five Surveys", "HeyCash", "Qmee", "Survey Junkie", "InboxDollars", "Branded Surveys", "Other"];
type Device = { id: string; kind: string; label: string; expiry: number };
type State = { txs: Tx[]; devices: Device[]; paidOut: number; rates?: Record<string, number> };
const KEY = "dollar-hisab-v2";
const empty: State = { txs: [], devices: [], paidOut: 0 };

const bnDigits = (s: string | number) => String(s).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[+d] ?? d);
const tk = (n: number) => "৳" + Math.round(n).toLocaleString("en-US");
const fmtBn = (t: number) =>
  new Date(t).toLocaleString("bn-BD", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });

function useTelegramUser() {
  const [u, setU] = useState<{ id?: number; name: string }>({ name: "Guest" });
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg) return;
    tg.ready(); tg.expand?.();
    const user = tg.initDataUnsafe?.user;
    if (user) setU({ id: user.id, name: [user.first_name, user.last_name].filter(Boolean).join(" ") });
  }, []);
  return u;
}

export function App() {
  const user = useTelegramUser();
  const [s, setS] = useState<State>(empty);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<"home" | "history" | "leader">("home");
  const [admin, setAdmin] = useState(false);
  const [modal, setModal] = useState<{ method: Method; edit?: Tx | undefined } | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    try { const r = localStorage.getItem(KEY); if (r) setS(JSON.parse(r)); } catch {}
    setLoaded(true); setNow(Date.now());
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  useEffect(() => { if (loaded) localStorage.setItem(KEY, JSON.stringify(s)); }, [s, loaded]);

  const methods = METHODS.map((m) => ({ ...m, rate: s.rates?.[m.id] ?? m.rate }));
  const bdt = (t: Tx) => t.usd * t.rate;
  const calc = useMemo(() => {
    const appr = s.txs.filter((t) => t.status === "approved");
    const running = appr.filter((t) => !t.paid);
    const pending = s.txs.filter((t) => t.status === "pending");
    return {
      running: running.reduce((a, t) => a + bdt(t), 0),
      runningUsd: running.reduce((a, t) => a + t.usd, 0),
      pending: pending.reduce((a, t) => a + bdt(t), 0),
      lifetime: appr.reduce((a, t) => a + bdt(t), 0),
      appr, pendingList: pending,
    };
  }, [s]);

  const upsertTx = (method: Method, d: { usd: number; code: string; site: string }, edit?: Tx) =>
    setS((p) => ({
      ...p,
      txs: edit
        ? p.txs.map((t) => (t.id === edit.id ? { ...t, usd: d.usd, code: d.code, site: d.site } : t))
        : [{ id: crypto.randomUUID(), method: method.id, usd: d.usd, code: d.code, site: d.site, rate: method.rate, status: "pending", paid: false, at: Date.now() }, ...p.txs],
    }));
  const approve = (id: string) => setS((p) => ({ ...p, txs: p.txs.map((t) => (t.id === id ? { ...t, status: "approved" } : t)) }));
  const remove = (id: string) => setS((p) => ({ ...p, txs: p.txs.filter((t) => t.id !== id) }));
  const markPaid = () => setS((p) => ({ ...p, paidOut: p.paidOut + calc.running, txs: p.txs.map((t) => (t.status === "approved" ? { ...t, paid: true } : t)) }));

  return (
    <div className="mx-auto min-h-screen max-w-md pb-28">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-card/90 px-5 py-4 backdrop-blur">
        <h1 className="font-bn text-xl font-bold">💵 ডলার হিসাব</h1>
        <button onClick={() => setAdmin(!admin)} className={`flex items-center gap-1 rounded-full border px-3 py-2 text-xs font-semibold ${admin ? "bg-primary text-primary-foreground" : "bg-card"}`}>
          <Shield size={14} /> Admin
        </button>
      </header>
      <p className="px-5 pt-3 text-xs text-muted-foreground">👋 {user.name}{user.id ? ` · ID ${user.id}` : ""}</p>

      {admin && <AdminPanel s={s} setS={setS} calc={calc} approve={approve} remove={remove} markPaid={markPaid} />}

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
            <TxList txs={s.txs.slice(0, 5)} onEdit={(t) => setModal({ method: methods.find((m) => m.id === t.method)!, edit: t })} />
          </Section>
        </main>
      )}

      {tab === "history" && (
        <main className="px-5 pt-3"><Section title="🧾 All Transactions">
          <TxList txs={s.txs} onEdit={(t) => setModal({ method: methods.find((m) => m.id === t.method)!, edit: t })} />
        </Section></main>
      )}

      {tab === "leader" && (
        <main className="px-5 pt-3"><Section title="🏆 Top Earners">
          <div className="card-soft flex items-center justify-between p-5">
            <span className="font-semibold">🥇 {user.name}</span><span className="font-bold">{tk(calc.lifetime)}</span>
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

      {modal && <AmountModal m={modal.method} edit={modal.edit} onClose={() => setModal(null)} onSubmit={(d) => { upsertTx(modal.method, d, modal.edit); setModal(null); }} />}
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
function AmountModal({ m, edit, onClose, onSubmit }: { m: Method; edit?: Tx | undefined; onClose: () => void; onSubmit: (d: { usd: number; code: string; site: string }) => void }) {
  const [v, setV] = useState(edit ? String(edit.usd) : "");
  const [code, setCode] = useState(edit?.code ?? "");
  const [site, setSite] = useState(edit?.site ?? "");
  const n = parseFloat(v);
  const usdOk = n > 0 && n < 100000;
  const valid = usdOk && code.trim() !== "" && site !== "";
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

        <button disabled={!valid} onClick={() => onSubmit({ usd: Math.round(n * 100) / 100, code: code.trim(), site })} className="bg-grad-purple mt-5 w-full rounded-2xl py-3 font-bold text-on-gradient disabled:opacity-40">
          {edit ? "Save" : "Submit (Pending)"}
        </button>
      </div>
    </div>
  );
}
function AdminPanel({ s, setS, calc, approve, remove, markPaid }: any) {
  const [kind, setKind] = useState("Cloud Phone");
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("7");
  const addDevice = () => {
    if (!label.trim() || !(+days > 0)) return;
    setS((p: State) => ({ ...p, devices: [...p.devices, { id: crypto.randomUUID(), kind, label: label.trim().slice(0, 40), expiry: Date.now() + +days * 864e5 }] }));
    setLabel("");
  };
  return (
    <div className="mx-5 mt-3 space-y-4 rounded-3xl border-2 border-primary/40 bg-card p-4">
      <p className="label-caps text-primary">🛡️ Admin Panel</p>
      <div>
        <p className="mb-2 text-sm font-semibold">Pending ({calc.pendingList.length})</p>
        {calc.pendingList.map((t: Tx) => (
          <div key={t.id} className="border-b py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-semibold">{METHODS.find((m) => m.id === t.method)?.name} · ${t.usd}</span>
              <span className="flex shrink-0 gap-2">
                <button onClick={() => approve(t.id)} className="rounded-full bg-success p-1.5 text-on-gradient" aria-label="Approve"><Check size={14} /></button>
                <button onClick={() => remove(t.id)} className="rounded-full bg-destructive p-1.5 text-on-gradient" aria-label="Delete"><Trash2 size={14} /></button>
              </span>
            </div>
            <p className="truncate text-xs font-semibold text-primary">🏷️ {t.site || "—"}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">🎫 {t.code || "—"}</p>
          </div>
        ))}
      </div>
      <button onClick={markPaid} disabled={calc.running <= 0} className="bg-grad-teal w-full rounded-2xl py-2.5 text-sm font-bold text-on-gradient disabled:opacity-40">
        Mark {tk(calc.running)} as Paid Out
      </button>
      <div className="space-y-2">
        <p className="text-sm font-semibold">Rates (BDT per $)</p>
        <div className="grid grid-cols-3 gap-2">
          {METHODS.map((m) => (
            <label key={m.id} className="text-xs">{m.name}
              <input type="number" value={s.rates?.[m.id] ?? m.rate} onChange={(e) => { const v = +e.target.value; if (v >= 0 && v < 10000) setS((p: State) => ({ ...p, rates: { ...p.rates, [m.id]: v } })); }} className="mt-1 w-full rounded-xl border bg-card px-2 py-1.5 text-sm" />
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
            <button onClick={() => setS((p: State) => ({ ...p, devices: p.devices.filter((x) => x.id !== d.id) }))} className="text-destructive" aria-label="Remove"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
