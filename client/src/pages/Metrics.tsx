import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, Legend,
} from "recharts";
import {
  TrendingUp, Users, DollarSign, Target, Zap, BarChart2,
  Globe, PlusCircle, Trash2, CheckCircle2, XCircle,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { LEAD_SOURCES, type LeadSource } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────
interface LeadItem {
  id: number; date: string; source: string;
  converted: number; name: string | null; email: string | null;
  phone: string | null; message: string | null;
}

interface ChannelRevenue {
  channel: string;
  revenue: number;
  jobCount: number;
}

interface MetricsData {
  avgJobValue: number;
  totalRevenue: number;
  totalJobs: number;
  totalMarketingSpend: number;
  newCustomers: number;
  cac: number;
  clv: number;
  clvCacRatio: number;
  totalLeads: number;
  costPerLead: number;
  convertedLeads: number;
  conversionRate: number;
  channelRevenue: ChannelRevenue[];
  formSubmissions: number;
  recentLeads: LeadItem[];
  monthlySpend: { month: string; total: number; byChannel: { channel: string; amount: number }[] }[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const fmtD = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const fmtRatio = (n: number) => `${n.toFixed(2)}:1`;

const CHANNEL_COLORS = [
  "#22c55e", "#3b82f6", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4", "#ef4444",
];

function channelColor(index: number) {
  return CHANNEL_COLORS[index % CHANNEL_COLORS.length];
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent?: string;
  badge?: { text: string; color: string };
}
function KpiCard({ label, value, sub, icon, accent = "text-primary", badge }: KpiCardProps) {
  return (
    <div className="stat-card flex flex-col gap-3 p-5" data-testid={`kpi-${label.replace(/\s+/g, "-").toLowerCase()}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="stat-label text-xs">{label}</span>
        <span className={`${accent} opacity-70`}>{icon}</span>
      </div>
      <div className={`stat-value text-2xl tabular-nums ${accent}`}>{value}</div>
      {(sub || badge) && (
        <div className="flex items-center gap-2 flex-wrap">
          {sub && <span className="stat-label text-xs">{sub}</span>}
          {badge && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge.color}`}>
              {badge.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────────────────────
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-32 rounded-lg border border-dashed border-border text-muted-foreground text-sm">
      {message}
    </div>
  );
}

// ── Marketing Spend Form ───────────────────────────────────────────────────────
function SpendForm() {
  const { toast } = useToast();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [channel, setChannel] = useState("Google Ads");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/marketing-spend", {
        month, channel, amount: parseFloat(amount) || 0, notes: notes || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metrics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketing-spend"] });
      toast({ title: "Spend saved", description: `${channel} — ${fmt(parseFloat(amount) || 0)}` });
      setAmount("");
      setNotes("");
    },
    onError: () => toast({ title: "Error", description: "Could not save spend.", variant: "destructive" }),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Log Marketing Spend
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Month</label>
          <input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-spend-month"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Channel</label>
          <select
            value={channel}
            onChange={e => setChannel(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="select-spend-channel"
          >
            {["Google Ads", "Yard Signs", "Mailers", "Social Media", "Other"].map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Amount ($)</label>
          <input
            type="number"
            min={0}
            step={0.01}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-spend-amount"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Notes (optional)</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. Spring campaign"
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-spend-notes"
          />
        </div>
      </div>
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || !amount}
        className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        data-testid="button-save-spend"
      >
        <PlusCircle size={14} />
        {mutation.isPending ? "Saving..." : "Save Spend"}
      </button>
    </div>
  );
}

// ── Add Lead Form ─────────────────────────────────────────────────────────────
function AddLeadForm() {
  const { toast } = useToast();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState<LeadSource>("Google Ads");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [converted, setConverted] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/leads", {
        date, source, converted: converted ? 1 : 0,
        name: name || null, phone: phone || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/metrics"] });
      toast({ title: "Lead logged", description: `${source} — ${name || "unnamed"}` });
      setName(""); setPhone(""); setConverted(false);
    },
    onError: () => toast({ title: "Error", description: "Could not save lead.", variant: "destructive" }),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Log Lead Manually
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-lead-date"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Source</label>
          <select
            value={source}
            onChange={e => setSource(e.target.value as LeadSource)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="select-lead-source"
          >
            {LEAD_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Lead name"
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-lead-name"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Phone</label>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="(919) 000-0000"
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-lead-phone"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          checked={converted}
          onChange={e => setConverted(e.target.checked)}
          className="accent-primary"
          data-testid="checkbox-lead-converted"
        />
        <span className="text-muted-foreground">Converted to booked job</span>
      </label>
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        data-testid="button-save-lead"
      >
        <PlusCircle size={14} />
        {mutation.isPending ? "Saving..." : "Log Lead"}
      </button>
    </div>
  );
}

// ── Spend Row ─────────────────────────────────────────────────────────────────
function SpendRow({ item }: { item: { id: number; month: string; channel: string; amount: number; notes: string | null } }) {
  const { toast } = useToast();
  const del = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/marketing-spend/${item.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing-spend"] });
      queryClient.invalidateQueries({ queryKey: ["/api/metrics"] });
    },
    onError: () => toast({ title: "Error", description: "Could not delete entry.", variant: "destructive" }),
  });
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0 gap-2">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-xs font-mono text-muted-foreground w-16 shrink-0">{item.month}</span>
        <span className="text-sm text-foreground truncate">{item.channel}</span>
        {item.notes && <span className="text-xs text-muted-foreground truncate">{item.notes}</span>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="tabular-nums text-sm font-medium text-foreground">{fmtD(item.amount)}</span>
        <button
          onClick={() => del.mutate()}
          disabled={del.isPending}
          className="text-muted-foreground hover:text-red-400 transition-colors p-0.5"
          data-testid={`button-delete-spend-${item.id}`}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Lead Row ──────────────────────────────────────────────────────────────────
function LeadRow({ lead }: { lead: LeadItem }) {
  const { toast } = useToast();
  const toggle = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/leads/${lead.id}`, { converted: lead.converted === 1 ? 0 : 1 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/metrics"] });
    },
  });
  const del = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/leads/${lead.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/metrics"] });
    },
    onError: () => toast({ title: "Error", description: "Could not delete lead.", variant: "destructive" }),
  });

  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0 gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs font-mono text-muted-foreground w-20 shrink-0">{lead.date}</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium shrink-0">{lead.source}</span>
        <span className="text-sm text-muted-foreground truncate">{lead.name ?? "—"}</span>
        {lead.phone && <span className="text-xs text-muted-foreground truncate">{lead.phone}</span>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => toggle.mutate()}
          title={lead.converted === 1 ? "Mark as not converted" : "Mark as converted"}
          className={`transition-colors ${lead.converted === 1 ? "text-green-400" : "text-muted-foreground hover:text-green-400"}`}
          data-testid={`button-toggle-lead-${lead.id}`}
        >
          {lead.converted === 1 ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
        </button>
        <button
          onClick={() => del.mutate()}
          disabled={del.isPending}
          className="text-muted-foreground hover:text-red-400 transition-colors p-0.5"
          data-testid={`button-delete-lead-${lead.id}`}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Custom tooltip ─────────────────────────────────────────────────────────────
function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-xl">
      <p className="font-medium text-foreground mb-1">{label}</p>
      <p className="text-primary tabular-nums">{fmt(payload[0]?.value ?? 0)}</p>
      <p className="text-muted-foreground text-xs">{payload[0]?.payload?.jobCount} job{payload[0]?.payload?.jobCount !== 1 ? "s" : ""}</p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Metrics() {
  const { data: metrics, isLoading } = useQuery<MetricsData>({
    queryKey: ["/api/metrics"],
  });

  const { data: spendList = [] } = useQuery<any[]>({
    queryKey: ["/api/marketing-spend"],
  });

  const { data: leadList = [] } = useQuery<LeadItem[]>({
    queryKey: ["/api/leads"],
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-card animate-pulse" />
        ))}
      </div>
    );
  }

  if (!metrics) return null;

  const clvCacColor =
    metrics.clvCacRatio >= 3 ? "text-green-400" :
    metrics.clvCacRatio >= 1.5 ? "text-yellow-400" : "text-red-400";

  const clvCacBadge =
    metrics.clvCacRatio >= 3 ? { text: "Healthy 3:1+", color: "bg-green-400/10 text-green-400" } :
    metrics.clvCacRatio >= 1.5 ? { text: "Moderate", color: "bg-yellow-400/10 text-yellow-400" } :
    { text: "Needs work", color: "bg-red-400/10 text-red-400" };

  // Webhook URL for clipboard copy
  const webhookNote = `/api/leads/webhook`;

  return (
    <div className="p-6 space-y-8 max-w-6xl">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>
          Business Metrics
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          KPIs, acquisition costs, lead tracking, and channel performance.
        </p>
      </div>

      {/* ── Core KPIs ─────────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Key Performance Indicators" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Avg Job Value"
            value={fmtD(metrics.avgJobValue)}
            sub={`${metrics.totalJobs} total jobs`}
            icon={<DollarSign size={16} />}
          />
          <KpiCard
            label="Customer Acq. Cost"
            value={metrics.cac > 0 ? fmtD(metrics.cac) : "—"}
            sub={`${metrics.newCustomers} new customers`}
            icon={<Target size={16} />}
            accent="text-blue-400"
          />
          <KpiCard
            label="Customer Lifetime Value"
            value={fmtD(metrics.clv)}
            sub={`${metrics.totalJobs} jobs across clients`}
            icon={<Users size={16} />}
            accent="text-purple-400"
          />
          <KpiCard
            label="CLV : CAC Ratio"
            value={metrics.cac > 0 ? fmtRatio(metrics.clvCacRatio) : "—"}
            sub="Target: 3:1 or better"
            icon={<TrendingUp size={16} />}
            accent={clvCacColor}
            badge={metrics.cac > 0 ? clvCacBadge : undefined}
          />
          <KpiCard
            label="Cost per Lead"
            value={metrics.totalLeads > 0 ? fmtD(metrics.costPerLead) : "—"}
            sub={`${metrics.totalLeads} total leads`}
            icon={<Zap size={16} />}
            accent="text-yellow-400"
          />
          <KpiCard
            label="Lead Conversion Rate"
            value={metrics.totalLeads > 0 ? fmtPct(metrics.conversionRate) : "—"}
            sub={`${metrics.convertedLeads} / ${metrics.totalLeads} converted`}
            icon={<BarChart2 size={16} />}
            accent="text-green-400"
          />
          <KpiCard
            label="Total Ad Spend"
            value={fmt(metrics.totalMarketingSpend)}
            sub="All channels, all time"
            icon={<DollarSign size={16} />}
            accent="text-orange-400"
          />
          <KpiCard
            label="Form Submissions"
            value={String(metrics.formSubmissions)}
            sub="Tracked leads total"
            icon={<Globe size={16} />}
            accent="text-cyan-400"
          />
        </div>
      </section>

      {/* ── Channel Revenue Chart ──────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Revenue by Lead Source"
          subtitle="Which channels are driving the most revenue"
        />
        {metrics.channelRevenue.length === 0 ? (
          <EmptyState message="Tag jobs with a lead source to see channel revenue here." />
        ) : (
          <div className="rounded-xl border border-border bg-card p-4">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={metrics.channelRevenue} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="channel"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <Tooltip content={<RevenueTooltip />} />
                <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                  {metrics.channelRevenue.map((_: ChannelRevenue, i: number) => (
                    <Cell key={i} fill={channelColor(i)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Channel table */}
            <div className="mt-4 space-y-1 border-t border-border pt-3">
              {metrics.channelRevenue.map((ch: ChannelRevenue, i: number) => {
                const pct = metrics.totalRevenue > 0
                  ? ((ch.revenue / metrics.totalRevenue) * 100).toFixed(1)
                  : "0.0";
                return (
                  <div key={ch.channel} className="flex items-center gap-3 py-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: channelColor(i) }}
                    />
                    <span className="text-sm text-foreground flex-1 min-w-0 truncate">{ch.channel}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{ch.jobCount} jobs</span>
                    <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">{pct}%</span>
                    <span className="text-sm font-medium tabular-nums text-foreground w-20 text-right">{fmtD(ch.revenue)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* ── Two-column: Spend + Leads ───────────────────────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Marketing Spend */}
        <div className="space-y-4">
          <SectionHeader
            title="Marketing Spend"
            subtitle="Log monthly ad spend to calculate CAC automatically"
          />
          <SpendForm />
          {spendList.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Spend History
              </p>
              {spendList.map((item: any) => <SpendRow key={item.id} item={item} />)}
            </div>
          )}
        </div>

        {/* Leads */}
        <div className="space-y-4">
          <SectionHeader
            title="Lead Tracking"
            subtitle="Log leads manually or they'll arrive via the form webhook"
          />
          <AddLeadForm />
          {leadList.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Recent Leads
              </p>
              {leadList.slice(0, 15).map((lead: LeadItem) => <LeadRow key={lead.id} lead={lead} />)}
            </div>
          )}
        </div>
      </section>

      {/* ── Webhook instructions ───────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Website Form Webhook"
          subtitle="Add this snippet to your pressureboysnc.com Netlify site to auto-track quote form submissions"
        />
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <p className="text-sm text-muted-foreground">
            When someone submits your quote form, POST the form data to your app's webhook endpoint.
            Leads appear automatically in the tracking table above.
          </p>
          <div className="rounded-lg bg-background border border-border p-3 font-mono text-xs text-muted-foreground overflow-x-auto whitespace-pre">
{`// Add to your Netlify form submission handler:
fetch('YOUR_APP_URL/api/leads/webhook', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name:    formData.get('name'),
    email:   formData.get('email'),
    phone:   formData.get('phone'),
    message: formData.get('message'),
  }),
});`}
          </div>
          <p className="text-xs text-muted-foreground">
            Replace <code className="bg-background px-1 py-0.5 rounded border border-border">YOUR_APP_URL</code> with
            your deployed app URL. The endpoint is <code className="bg-background px-1 py-0.5 rounded border border-border">{webhookNote}</code> — no authentication required.
          </p>
        </div>
      </section>
    </div>
  );
}
