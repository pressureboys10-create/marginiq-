import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import Dashboard from "@/pages/Dashboard";
import JobDetail from "@/pages/JobDetail";
import Settings from "@/pages/Settings";
import Metrics from "@/pages/Metrics";
import NotFound from "@/pages/not-found";
import Sidebar from "@/components/Sidebar";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <div className="flex h-screen overflow-hidden bg-background">
          <Sidebar />
          <main className="flex-1 overflow-y-auto overscroll-contain">
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/jobs/:id" component={JobDetail} />
              <Route path="/settings" component={Settings} />
              <Route path="/metrics" component={Metrics} />
              <Route component={NotFound} />
            </Switch>
          </main>
        </div>
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}
