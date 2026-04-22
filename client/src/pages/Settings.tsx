import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, RefreshCw, AlertCircle, Unplug, ExternalLink, Zap, ShieldCheck,
} from "lucide-react";

interface JobberStatus {
  connected: boolean;
  configured: boolean;
}

interface SyncResult {
  ok: boolean;
  imported: number;
  skipped: number;
  total: number;
  message: string;
}

// Jobber orange brand colour
const JOBBER_ORANGE = "#F4A020";

function JobberLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect width="40" height="40" rx="8" fill={JOBBER_ORANGE} />
      <path
        d="M20 6C12.268 6 6 12.268 6 20s6.268 14 14 14 14-6.268 14-14S27.732 6 20 6zm0 22a8 8 0 110-16 8 8 0 010 16z"
        fill="white"
      />
    </svg>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const [location] = useLocation();
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);

  // Read OAuth result from URL hash query params after redirect
  useEffect(() => {
    const hash = window.location.hash; // e.g. #/settings?jobber=connected
    const qIndex = hash.indexOf("?");
    if (qIndex === -1) return;
    const params = new URLSearchParams(hash.slice(qIndex + 1));
    const result = params.get("jobber");

    if (result === "connected") {
      toast({ title: "Jobber connected!", description: "Your account is linked. Jobs are syncing now." });
      queryClient.invalidateQueries({ queryKey: ["/api/jobber/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      // Clean up the URL
      window.location.hash = "/settings";
    } else if (result === "denied") {
      toast({ title: "Connection cancelled", description: "You declined access to Jobber.", variant: "destructive" });
      window.location.hash = "/settings";
    } else if (result === "error") {
      const reason = params.get("reason") ?? "unknown";
      toast({ title: "Connection failed", description: `Something went wrong (${reason}). Try again.`, variant: "destructive" });
      window.location.hash = "/settings";
    }
  }, [location]);

  const { data: status, isLoading } = useQuery<JobberStatus>({
    queryKey: ["/api/jobber/status"],
    refetchOnWindowFocus: true,
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/jobber/disconnect"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobber/status"] });
      toast({ title: "Disconnected from Jobber" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: (): Promise<SyncResult> => apiRequest("POST", "/api/jobber/sync"),
    onSuccess: (data) => {
      setLastSync(data);
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({
        title: data.imported > 0 ? "Sync complete" : "Already up to date",
        description: data.message,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Sync failed",
        description: err?.message ?? "Could not reach Jobber. Try reconnecting.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold" style={{ fontFamily: "'Cabinet Grotesk', sans-serif" }}>
          Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage integrations and preferences</p>
      </div>

      {/* Jobber Card */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">

        {/* Card header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <JobberLogo size={32} />
            <div>
              <p className="text-sm font-semibold">Jobber</p>
              <p className="text-xs text-muted-foreground">Import jobs &amp; client data automatically</p>
            </div>
          </div>
          {!isLoading && status?.connected && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-green-400 bg-green-500/10 px-2.5 py-1 rounded-full">
              <CheckCircle2 size={11} />
              Connected
            </span>
          )}
        </div>

        <div className="p-5 space-y-5">

          {isLoading ? (
            <div className="space-y-2">
              <div className="h-10 rounded-lg bg-muted animate-pulse" />
              <div className="h-10 rounded-lg bg-muted animate-pulse w-2/3" />
            </div>

          ) : !status?.configured ? (
            /* ── Credentials not set ───────────────────────────────────────── */
            <NotConfiguredPanel />

          ) : status.connected ? (
            /* ── Connected state ───────────────────────────────────────────── */
            <ConnectedPanel
              syncMutation={syncMutation}
              disconnectMutation={disconnectMutation}
              lastSync={lastSync}
            />

          ) : (
            /* ── Not connected — show Connect button ───────────────────────── */
            <DisconnectedPanel />
          )}

        </div>
      </div>
    </div>
  );
}

// ── Sub-panels ────────────────────────────────────────────────────────────────

function NotConfiguredPanel() {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-yellow-500/25 bg-yellow-500/5 px-4 py-3 flex gap-3">
        <AlertCircle size={16} className="text-yellow-400 shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-yellow-400">App credentials not configured</p>
          <p className="text-xs text-muted-foreground mt-1">
            Set <code className="bg-muted px-1 py-0.5 rounded text-xs">JOBBER_CLIENT_ID</code> and{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-xs">JOBBER_CLIENT_SECRET</code> in your{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-xs">.env</code> file, then restart the server.
          </p>
        </div>
      </div>

      <SetupGuide />
    </div>
  );
}

function DisconnectedPanel() {
  return (
    <div className="space-y-5">
      {/* Feature highlights */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { icon: <Zap size={14} />, title: "Auto-import", desc: "Jobs pulled in on connect & on demand" },
          { icon: <ShieldCheck size={14} />, title: "No duplicates", desc: "Each Jobber job ID is tracked" },
          { icon: <RefreshCw size={14} />, title: "One-click sync", desc: "Re-sync any time from the sidebar" },
        ].map(f => (
          <div key={f.title} className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-2 mb-1 text-primary">{f.icon}
              <span className="text-xs font-semibold">{f.title}</span>
            </div>
            <p className="text-xs text-muted-foreground">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* What gets imported */}
      <div className="rounded-lg bg-muted/30 border border-border p-4 text-xs space-y-1.5">
        <p className="font-medium text-sm text-foreground mb-2">What gets imported</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {[
            ["Job title / service", "→ Job Name"],
            ["Client name",         "→ Client"],
            ["Completion date",     "→ Date"],
            ["Job total",           "→ Job Price"],
          ].map(([from, to]) => (
            <div key={from} className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{from}</span>
              <span className="font-medium text-primary tabular-nums">{to}</span>
            </div>
          ))}
        </div>
        <p className="text-muted-foreground pt-1 border-t border-border mt-2">
          Labor, supply, gas &amp; equipment costs are left blank for you to fill in.
        </p>
      </div>

      {/* Connect button */}
      <a
        href="/api/jobber/connect"
        className="flex items-center justify-center gap-2.5 w-full rounded-lg py-3 px-4 font-semibold text-sm transition-opacity hover:opacity-90"
        style={{ backgroundColor: JOBBER_ORANGE, color: "#1a1100" }}
        data-testid="button-connect-jobber"
      >
        <JobberLogo size={18} />
        Connect with Jobber
      </a>
      <p className="text-xs text-center text-muted-foreground">
        You'll be redirected to Jobber to authorize access, then returned here automatically.
      </p>
    </div>
  );
}

function ConnectedPanel({
  syncMutation,
  disconnectMutation,
  lastSync,
}: {
  syncMutation: any;
  disconnectMutation: any;
  lastSync: SyncResult | null;
}) {
  return (
    <div className="space-y-4">
      {/* Connected status row */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-green-500/25 bg-green-500/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={14} className="text-green-400 shrink-0" />
          <span className="text-sm text-green-400 font-medium">Jobber account connected</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-red-400 h-7 px-2 text-xs"
          onClick={() => disconnectMutation.mutate()}
          disabled={disconnectMutation.isPending}
          data-testid="button-disconnect-jobber"
        >
          <Unplug size={12} className="mr-1.5" />
          Disconnect
        </Button>
      </div>

      {/* Sync section */}
      <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Sync Jobs</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pull all completed jobs from Jobber. Already-imported jobs are skipped.
            </p>
          </div>
          <Button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="shrink-0 ml-4"
            data-testid="button-sync-jobber"
          >
            <RefreshCw size={13} className={`mr-2 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Syncing..." : "Sync Now"}
          </Button>
        </div>

        {/* Last sync result */}
        {lastSync && (
          <div className={`rounded-md border px-3 py-2.5 flex items-start gap-2.5 text-xs
            ${lastSync.imported > 0 ? "border-green-500/20 bg-green-500/5" : "border-border bg-muted/30"}`}
            data-testid="sync-result"
          >
            {lastSync.imported > 0
              ? <CheckCircle2 size={13} className="text-green-400 shrink-0 mt-0.5" />
              : <AlertCircle size={13} className="text-muted-foreground shrink-0 mt-0.5" />
            }
            <div>
              <p className={lastSync.imported > 0 ? "font-medium text-green-400" : "font-medium"}>
                {lastSync.message}
              </p>
              {lastSync.skipped > 0 && (
                <p className="text-muted-foreground mt-0.5">
                  {lastSync.skipped} job{lastSync.skipped !== 1 ? "s" : ""} already in MarginIQ (skipped)
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Re-connect link */}
      <p className="text-xs text-muted-foreground">
        Need to switch accounts?{" "}
        <a href="/api/jobber/connect" className="text-primary hover:underline">Re-authorize with Jobber</a>
      </p>
    </div>
  );
}

function SetupGuide() {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
      <p className="text-sm font-semibold">How to create your Jobber Developer App</p>
      <ol className="space-y-2 text-xs text-muted-foreground list-none">
        {[
          <>Go to <a href="https://developer.getjobber.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">developer.getjobber.com <ExternalLink size={9} /></a> and sign in</>,
          <>Click <strong className="text-foreground">Create App</strong> — give it any name (e.g. "MarginIQ")</>,
          <>Under <strong className="text-foreground">Scopes</strong>, enable: <code className="bg-muted px-1 rounded">jobs:read</code></>,
          <>Under <strong className="text-foreground">Redirect URIs</strong>, add:<br />
            <code className="bg-muted px-1.5 py-0.5 rounded mt-1 inline-block">http://localhost:5000/api/jobber/callback</code><br />
            <span className="text-muted-foreground">(swap for your production URL when deploying)</span>
          </>,
          <>Copy the <strong className="text-foreground">Client ID</strong> and <strong className="text-foreground">Client Secret</strong></>,
          <>Add them to your <code className="bg-muted px-1 rounded">.env</code> file and restart the server</>,
        ].map((step, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="text-primary font-semibold shrink-0">{i + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
