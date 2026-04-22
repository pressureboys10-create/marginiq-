import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { type Job, computeJobStats } from "@shared/schema";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function JobDetail() {
  const [, params] = useRoute("/jobs/:id");
  const [, setLocation] = useLocation();
  const id = params?.id;

  const { data: job, isLoading } = useQuery<Job>({
    queryKey: ["/api/jobs", id],
  });

  if (isLoading) return <div className="p-6"><Skeleton className="h-48 rounded-xl" /></div>;
  if (!job) return <div className="p-6 text-muted-foreground">Job not found.</div>;

  const { totalCost, profit, margin } = computeJobStats(job);

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <button onClick={() => setLocation("/")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft size={14} /> Back
      </button>
      <h1 className="text-xl font-bold">{job.name}</h1>
      <p className="text-sm text-muted-foreground">{job.client} · {format(new Date(job.date + "T00:00:00"), "MMM d, yyyy")}</p>
      <div className="grid grid-cols-3 gap-3">
        <div className="stat-card">
          <div className="stat-label">Price</div>
          <div className="stat-value text-lg">${job.jobPrice.toFixed(2)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Profit</div>
          <div className={`stat-value text-lg ${profit >= 0 ? "text-green-400" : "text-red-400"}`}>${profit.toFixed(2)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Margin</div>
          <div className={`stat-value text-lg ${margin >= 30 ? "text-green-400" : margin >= 15 ? "text-yellow-400" : "text-red-400"}`}>{margin.toFixed(1)}%</div>
        </div>
      </div>
    </div>
  );
}
