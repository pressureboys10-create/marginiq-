import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type Job, computeJobStats } from "@shared/schema";
import { useState } from "react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import AddJobDialog from "@/components/AddJobDialog";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Briefcase,
  Percent,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronUp,
  Search,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function fmtFull(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
}

function MarginPill({ margin }: { margin: number }) {
  const cls = margin >= 30 ? "margin-pill-good" : margin >= 15 ? "margin-pill-ok" : "margin-pill-bad";
  const Icon = margin >= 15 ? TrendingUp : TrendingDown;
  return (
    <span className={`margin-pill ${cls}`} data-testid="margin-pill">
      <Icon size={10} />
      {margin.toFixed(1)}%
    </span>
  );
}

type SortKey = "date" | "jobPrice" | "margin" | "profit";

export default function Dashboard() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editJob, setEditJob] = useState<(Job & { id: number }) | null>(null);

  const { data: jobs = [], isLoading } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/jobs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Job deleted" });
      setDeleteId(null);
    },
  });

  // Compute derived stats per job
  const jobsWithStats = jobs.map(j => ({ ...j, ...computeJobStats(j) }));

  // Aggregate stats
  const totalJobs = jobs.length;
  const totalRevenue = jobsWithStats.reduce((s, j) => s + j.jobPrice, 0);
  const totalProfit = jobsWithStats.reduce((s, j) => s + j.profit, 0);
  const avgMargin = totalJobs > 0 ? jobsWithStats.reduce((s, j) => s + j.margin, 0) / totalJobs : 0;
  const avgJobPrice = totalJobs > 0 ? totalRevenue / totalJobs : 0;
  const avgCost = totalJobs > 0 ? jobsWithStats.reduce((s, j) => s + j.totalCost, 0) / totalJobs : 0;

  // Filter + sort
  const filtered = jobsWithStats
    .filter(j =>
      j.name.toLowerCase().includes(search.toLowerCase()) ||
      (j.client ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (j.category ?? "").toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      let av: number, bv: number;
      if (sort === "date") { av = new Date(a.date).getTime(); bv = new Date(b.date).getTime(); }
      else if (sort === "jobPrice") { av = a.jobPrice; bv = b.jobPrice; }
      else if (sort === "margin") { av = a.margin; bv = b.margin; }
      else { av = a.profit; bv = b.profit; }
      return sortDir === "desc" ? bv - av : av - bv;
    });

  // Cost breakdown chart — avg cost per category as % of avg job price
  const totalJobsForBreakdown = jobsWithStats.length;
  const costBreakdown = totalJobsForBreakdown > 0 ? [
    {
      name: "Labor",
      avgCost: jobsWithStats.reduce((s, j) => s + j.laborCost, 0) / totalJobsForBreakdown,
      totalCost: jobsWithStats.reduce((s, j) => s + j.laborCost, 0),
      color: "hsl(200 80% 55%)",
    },
    {
      name: "Supplies",
      avgCost: jobsWithStats.reduce((s, j) => s + j.supplyCost, 0) / totalJobsForBreakdown,
      totalCost: jobsWithStats.reduce((s, j) => s + j.supplyCost, 0),
      color: "hsl(142 72% 45%)",
    },
    {
      name: "Gas",
      avgCost: jobsWithStats.reduce((s, j) => s + j.gasCost, 0) / totalJobsForBreakdown,
      totalCost: jobsWithStats.reduce((s, j) => s + j.gasCost, 0),
      color: "hsl(45 95% 55%)",
    },
    {
      name: "Equipment",
      avgCost: jobsWithStats.reduce((s, j) => s + j.equipmentCost, 0) / totalJobsForBreakdown,
      totalCost: jobsWithStats.reduce((s, j) => s + j.equipmentCost, 0),
      color: "hsl(330 70% 60%)",
    },
    {
      name: "Other",
      avgCost: jobsWithStats.reduce((s, j) => s + j.otherCost, 0) / totalJobsForBreakdown,
      totalCost: jobsWithStats.reduce((s, j) => s + j.otherCost, 0),
      color: "hsl(270 50% 60%)",
    },
  ].filter(c => c.avgCost > 0)
   .sort((a, b) => b.avgCost - a.avgCost)
   .map(c => ({
     ...c,
     pctOfPrice: avgJobPrice > 0 ? (c.avgCost / avgJobPrice) * 100 : 0,
   }))
  : [];

  // Chart data — last 12 jobs by date
  const chartData = [...jobsWithStats]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(-12)
    .map(j => ({
      name: j.name.length > 12 ? j.name.slice(0, 12) + "…" : j.name,
      revenue: j.jobPrice,
      cost: j.totalCost,
      margin: parseFloat(j.margin.toFixed(1)),
    }));

  function toggleSort(key: SortKey) {
    if (sort === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSort(key); setSortDir("desc"); }
  }

  const SortIcon = ({ k }: { k: SortKey }) => sort === k
    ? (sortDir === "desc" ? <ChevronDown size={12} /> : <ChevronUp size={12} />)
    : null;

  return (
    <TooltipProvider>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track profitability across all your jobs</p>
        </div>

        {/* KPI Cards */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KPICard label="Total Jobs" value={String(totalJobs)} icon={<Briefcase size={14} />} />
            <KPICard label="Total Revenue" value={fmt(totalRevenue)} icon={<DollarSign size={14} />} green />
            <KPICard label="Total Profit" value={fmt(totalProfit)} icon={<TrendingUp size={14} />} green={totalProfit >= 0} red={totalProfit < 0} />
            <KPICard label="Avg Margin" value={`${avgMargin.toFixed(1)}%`} icon={<Percent size={14} />} green={avgMargin >= 30} red={avgMargin < 15} />
            <KPICard label="Avg Job Price" value={fmt(avgJobPrice)} icon={<DollarSign size={14} />} />
            <KPICard label="Avg Cost" value={fmt(avgCost)} icon={<DollarSign size={14} />} />
          </div>
        )}

        {/* Charts row */}
        {!isLoading && (chartData.length > 0 || costBreakdown.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Revenue vs Cost */}
            {chartData.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-5">
                <p className="text-sm font-semibold mb-4" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>
                  Revenue vs. Cost — Last {chartData.length} Jobs
                </p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData} barGap={2} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 25% 18%)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(210 12% 55%)" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(210 12% 55%)" }} axisLine={false} tickLine={false} tickFormatter={v => `$${v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}`} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: "hsl(222 40% 9%)", border: "1px solid hsl(222 25% 18%)", borderRadius: "8px", fontSize: 12 }}
                      formatter={(value: number, name: string) => [fmtFull(value), name === "revenue" ? "Revenue" : "Cost"]}
                    />
                    <Bar dataKey="revenue" name="revenue" fill="hsl(142 72% 45%)" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="cost" name="cost" fill="hsl(222 30% 25%)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Cost Breakdown */}
            {costBreakdown.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="mb-4">
                  <p className="text-sm font-semibold" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>
                    Cost Breakdown
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Avg per job · % of avg job price ({fmtFull(avgJobPrice)})
                  </p>
                </div>

                {/* Stacked % bar */}
                <div className="flex rounded-md overflow-hidden h-4 mb-5">
                  {costBreakdown.map(c => (
                    <Tooltip key={c.name}>
                      <TooltipTrigger asChild>
                        <div
                          style={{ width: `${c.pctOfPrice}%`, backgroundColor: c.color, minWidth: c.pctOfPrice > 0 ? 2 : 0 }}
                          className="transition-opacity hover:opacity-80 cursor-default"
                          data-testid={`bar-breakdown-${c.name.toLowerCase()}`}
                        />
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">
                        <span className="font-semibold">{c.name}</span>: {fmtFull(c.avgCost)} avg ({c.pctOfPrice.toFixed(1)}% of price)
                      </TooltipContent>
                    </Tooltip>
                  ))}
                  {/* Remaining = profit margin */}
                  {(() => {
                    const usedPct = costBreakdown.reduce((s, c) => s + c.pctOfPrice, 0);
                    const remaining = Math.max(0, 100 - usedPct);
                    return remaining > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            style={{ width: `${remaining}%`, backgroundColor: "hsl(222 30% 18%)" }}
                            className="transition-opacity hover:opacity-80 cursor-default"
                          />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">
                          <span className="font-semibold text-green-400">Profit margin</span>: {remaining.toFixed(1)}%
                        </TooltipContent>
                      </Tooltip>
                    ) : null;
                  })()}
                </div>

                {/* Category rows */}
                <div className="space-y-3">
                  {costBreakdown.map(c => (
                    <div key={c.name} className="flex items-center gap-3">
                      {/* Color dot + label */}
                      <div className="flex items-center gap-2 w-24 shrink-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                        <span className="text-xs text-muted-foreground">{c.name}</span>
                      </div>
                      {/* Progress bar */}
                      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${costBreakdown[0].pctOfPrice > 0 ? (c.pctOfPrice / costBreakdown[0].pctOfPrice) * 100 : 0}%`,
                            backgroundColor: c.color,
                          }}
                        />
                      </div>
                      {/* Values */}
                      <div className="text-right shrink-0">
                        <span className="text-xs font-semibold tabular-nums">{fmtFull(c.avgCost)}</span>
                        <span className="text-xs text-muted-foreground ml-1.5 tabular-nums">{c.pctOfPrice.toFixed(1)}%</span>
                      </div>
                    </div>
                  ))}
                  {/* Profit margin row */}
                  {(() => {
                    const usedPct = costBreakdown.reduce((s, c) => s + c.pctOfPrice, 0);
                    const profitPct = Math.max(0, 100 - usedPct);
                    const profitAvg = avgJobPrice * (profitPct / 100);
                    return (
                      <div className="flex items-center gap-3 border-t border-border pt-2.5 mt-1">
                        <div className="flex items-center gap-2 w-24 shrink-0">
                          <span className="w-2 h-2 rounded-full shrink-0 bg-green-400" />
                          <span className="text-xs font-medium text-green-400">Profit</span>
                        </div>
                        <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div
                            className="h-full rounded-full bg-green-500"
                            style={{
                              width: `${costBreakdown[0].pctOfPrice > 0 ? (profitPct / costBreakdown[0].pctOfPrice) * 100 : profitPct}%`,
                            }}
                          />
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-semibold tabular-nums text-green-400">{fmtFull(profitAvg)}</span>
                          <span className="text-xs text-muted-foreground ml-1.5 tabular-nums">{profitPct.toFixed(1)}%</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

          </div>
        )}

        {/* Jobs Table */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {/* Table header bar */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>
              All Jobs
              {filtered.length !== totalJobs && (
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  {filtered.length} of {totalJobs}
                </span>
              )}
            </p>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search jobs..."
                className="pl-8 pr-3 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring w-48"
                data-testid="input-search"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Briefcase size={32} className="mb-3 opacity-30" />
              <p className="text-sm font-medium">No jobs yet</p>
              <p className="text-xs mt-1">Click "Add Job" to get started</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                    <th className="text-left px-4 py-3 font-medium">Job / Client</th>
                    <th className="text-left px-4 py-3 font-medium">Date</th>
                    <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort("jobPrice")}>
                      <span className="inline-flex items-center gap-1">Price <SortIcon k="jobPrice" /></span>
                    </th>
                    <th className="text-right px-4 py-3 font-medium">Costs</th>
                    <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort("profit")}>
                      <span className="inline-flex items-center gap-1">Profit <SortIcon k="profit" /></span>
                    </th>
                    <th className="text-right px-4 py-3 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort("margin")}>
                      <span className="inline-flex items-center gap-1">Margin <SortIcon k="margin" /></span>
                    </th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(job => (
                    <tr
                      key={job.id}
                      className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                      data-testid={`row-job-${job.id}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground leading-tight">{job.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                          {job.client && <span>{job.client}</span>}
                          {job.client && job.category && <span>·</span>}
                          {job.category && <span>{job.category}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground tabular-nums text-xs">
                        {format(new Date(job.date + "T00:00:00"), "MMM d, yyyy")}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{fmtFull(job.jobPrice)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help border-b border-dashed border-muted-foreground/40">{fmtFull(job.totalCost)}</span>
                          </TooltipTrigger>
                          <TooltipContent className="text-xs space-y-1 p-3">
                            <CostLine label="Supplies" value={job.supplyCost} />
                            <CostLine label="Labor" value={job.laborCost} />
                            <CostLine label="Gas" value={job.gasCost} />
                            <CostLine label="Equipment" value={job.equipmentCost} />
                            <CostLine label="Other" value={job.otherCost} />
                          </TooltipContent>
                        </Tooltip>
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-semibold ${job.profit >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {job.profit >= 0 ? "+" : ""}{fmtFull(job.profit)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <MarginPill margin={job.margin} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => setEditJob(job)}
                            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                            data-testid={`button-edit-${job.id}`}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => setDeleteId(job.id)}
                            className="p-1.5 rounded hover:bg-red-500/15 text-muted-foreground hover:text-red-400 transition-colors"
                            data-testid={`button-delete-${job.id}`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Edit dialog */}
      {editJob && (
        <AddJobDialog
          open={!!editJob}
          onOpenChange={(v) => { if (!v) setEditJob(null); }}
          editJob={editJob}
        />
      )}

      {/* Delete confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(v) => { if (!v) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete job?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this job and its data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}

function KPICard({ label, value, icon, green, red }: {
  label: string; value: string; icon: React.ReactNode; green?: boolean; red?: boolean;
}) {
  return (
    <div className="stat-card" data-testid={`kpi-${label.toLowerCase().replace(/ /g, "-")}`}>
      <div className="flex items-center justify-between">
        <span className="stat-label">{label}</span>
        <span className={`${green ? "text-green-400" : red ? "text-red-400" : "text-muted-foreground"}`}>{icon}</span>
      </div>
      <div className={`stat-value text-lg ${green ? "text-green-400" : red ? "text-red-400" : ""}`}>{value}</div>
    </div>
  );
}

function CostLine({ label, value }: { label: string; value: number }) {
  if (value === 0) return null;
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)}</span>
    </div>
  );
}
