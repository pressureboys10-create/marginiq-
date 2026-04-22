import { Link, useLocation } from "wouter";
import { LayoutDashboard, PlusCircle, Settings, RefreshCw, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import AddJobDialog from "./AddJobDialog";

interface SyncResult {
  ok: boolean;
  imported: number;
  skipped: number;
  total: number;
  message: string;
}

interface JobberStatus {
  connected: boolean;
  configured: boolean;
}

export default function Sidebar() {
  const [location] = useLocation();
  const [addOpen, setAddOpen] = useState(false);
  const { toast } = useToast();

  const { data: tokenStatus } = useQuery<JobberStatus>({
    queryKey: ["/api/jobber/status"],
  });

  const syncMutation = useMutation({
    mutationFn: (): Promise<SyncResult> => apiRequest("POST", "/api/jobber/sync"),
    onSuccess: (data: SyncResult) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({
        title: data.imported > 0 ? "Sync complete" : "Already up to date",
        description: data.message,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Sync failed",
        description: err?.message ?? "Check your Jobber token in Settings.",
        variant: "destructive",
      });
    },
  });

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/metrics", label: "Metrics", icon: TrendingUp },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <>
      <aside className="w-56 shrink-0 flex flex-col border-r border-border bg-card h-full">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-border">
          <svg
            aria-label="MarginIQ Logo"
            width="28"
            height="28"
            viewBox="0 0 28 28"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect width="28" height="28" rx="6" fill="hsl(142 72% 45%)" />
            <path
              d="M14 5v2M14 21v2M10 9h5.5a2.5 2.5 0 0 1 0 5H12a2.5 2.5 0 0 0 0 5H18"
              stroke="hsl(222 47% 6%)"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-bold text-base tracking-tight" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>
            MarginIQ
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 flex flex-col gap-1 p-3 pt-4">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                location === href
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}
              data-testid={`nav-${label.toLowerCase()}`}
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </nav>

        {/* Bottom actions */}
        <div className="p-3 border-t border-border space-y-2">
          {/* Sync from Jobber — only show if token is configured */}
          {tokenStatus?.connected && (
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium border border-border bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
              data-testid="button-sync-sidebar"
            >
              <RefreshCw size={12} className={syncMutation.isPending ? "animate-spin" : ""} />
              {syncMutation.isPending ? "Syncing..." : "Sync from Jobber"}
            </button>
          )}

          {/* Add Job */}
          <button
            onClick={() => setAddOpen(true)}
            className="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            data-testid="button-add-job"
          >
            <PlusCircle size={15} />
            Add Job
          </button>
        </div>
      </aside>

      <AddJobDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
