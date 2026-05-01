import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertJobSchema, insertMarketingSpendSchema, insertLeadSchema } from "@shared/schema";
import type { InsertJob } from "@shared/schema";
import crypto from "crypto";

// ── Jobber OAuth constants ────────────────────────────────────────────────────
const JOBBER_AUTHORIZE_URL = "https://api.getjobber.com/api/oauth/authorize";
const JOBBER_TOKEN_URL     = "https://api.getjobber.com/api/oauth/token";
const JOBBER_GRAPHQL_URL   = "https://api.getjobber.com/api/graphql";

function getOAuthConfig() {
  const clientId     = process.env.JOBBER_CLIENT_ID;
  const clientSecret = process.env.JOBBER_CLIENT_SECRET;
  const appUrl       = (process.env.APP_URL ?? "http://localhost:5000").replace(/\/$/, "");
  const redirectUri  = `${appUrl}/api/jobber/callback`;
  return { clientId, clientSecret, redirectUri, appUrl };
}

// ── Jobber GraphQL query ──────────────────────────────────────────────────────
// ── Constants ────────────────────────────────────────────────────────────────
const START_ADDRESS = "300 Lake Boone Trl, Raleigh, NC 27608";
const START_COORDS  = { lng: -78.6918, lat: 35.8070 }; // 300 Lake Boone Trl
const MPG           = 12;

const JOBBER_JOBS_QUERY = `
  query SyncJobs($cursor: String) {
    jobs(first: 50, after: $cursor) {
      nodes {
        id
        title
        total
        completedAt
        createdAt
        jobStatus
        client {
          name
          firstName
          lastName
        }
        property {
          address {
            street
            city
            province
            postalCode
          }
        }
        lineItems {
          nodes { name }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface JobberJob {
  id: string;
  title: string | null;
  total: number;
  completedAt: string | null;
  createdAt: string;
  jobStatus: string;
  client: { name: string; firstName: string; lastName: string };
  property?: {
    address?: {
      street?: string;
      city?: string;
      province?: string;
      postalCode?: string;
    };
  };
  lineItems: { nodes: Array<{ name: string }> };
}

// ── Gas price fetching ────────────────────────────────────────────────────────
async function fetchRaleighGasPrice(): Promise<number> {
  try {
    const resp = await fetch("https://gasprices.aaa.com/?state=NC", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const html = await resp.text();
    // Parse the Wake County / Raleigh average from AAA page
    const match = html.match(/\$([0-9]+\.[0-9]+)/);
    if (match) {
      const price = parseFloat(match[1]);
      if (price > 2 && price < 8) return price;
    }
  } catch (e) {
    console.warn("Gas price fetch failed, using fallback:", e);
  }
  return 4.01; // Raleigh fallback as of Apr 2026
}

// ── Distance calculation via OpenRouteService ─────────────────────────────────
async function calcTravelCost(address: string, gasPrice: number): Promise<number> {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) return 0;

  try {
    // Geocode the destination address
    const geoResp = await fetch(
      `https://api.openrouteservice.org/geocode/search?api_key=${apiKey}&text=${encodeURIComponent(address)}&boundary.country=US&size=1`,
      { headers: { "User-Agent": "MarginIQ/1.0" } }
    );
    const geoData = await geoResp.json() as any;
    const coords = geoData?.features?.[0]?.geometry?.coordinates;
    if (!coords) return 0;

    const [destLng, destLat] = coords;

    // Get driving distance
    const routeResp = await fetch(
      `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${apiKey}&start=${START_COORDS.lng},${START_COORDS.lat}&end=${destLng},${destLat}`,
      { headers: { "User-Agent": "MarginIQ/1.0" } }
    );
    const routeData = await routeResp.json() as any;
    const distanceMeters = routeData?.features?.[0]?.properties?.segments?.[0]?.distance;
    if (!distanceMeters) return 0;

    const miles = distanceMeters / 1609.34;
    const roundTripMiles = miles * 2;
    const gallonsUsed = roundTripMiles / MPG;
    const cost = gallonsUsed * gasPrice;

    return Math.round(cost * 100) / 100; // round to cents
  } catch (e) {
    console.warn("Travel cost calc failed for address:", address, e);
    return 0;
  }
}

// ── Token management ──────────────────────────────────────────────────────────
interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms
}

async function loadTokenSet(): Promise<TokenSet | null> {
  const raw = await storage.getConfig("jobber_oauth_tokens");
  if (!raw) return null;
  try { return JSON.parse(raw) as TokenSet; } catch { return null; }
}

async function saveTokenSet(t: TokenSet) {
  await storage.setConfig("jobber_oauth_tokens", JSON.stringify(t));
  // Keep backward-compat key used by older sync code
  await storage.setConfig("jobber_access_token", t.accessToken);
}

async function clearTokenSet() {
  await storage.setConfig("jobber_oauth_tokens", "");
  await storage.setConfig("jobber_access_token", "");
}

async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const { clientId, clientSecret } = getOAuthConfig();
  if (!clientId || !clientSecret) throw new Error("JOBBER_CLIENT_ID / JOBBER_CLIENT_SECRET not configured");

  const resp = await fetch(JOBBER_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token refresh failed (${resp.status}): ${text}`);
  }

  const data = await resp.json() as any;
  const set: TokenSet = {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt:    Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  await saveTokenSet(set);
  return set;
}

/** Returns a valid access token, refreshing silently if expired */
async function getValidAccessToken(): Promise<string> {
  const t = await loadTokenSet();
  if (!t) throw new Error("Not connected to Jobber. Please connect in Settings.");

  // Refresh if within 2 minutes of expiry
  if (Date.now() > t.expiresAt - 120_000) {
    const refreshed = await refreshAccessToken(t.refreshToken);
    return refreshed.accessToken;
  }
  return t.accessToken;
}

// ── Jobber data fetching ──────────────────────────────────────────────────────
async function fetchAllJobberJobs(token: string): Promise<JobberJob[]> {
  const all: JobberJob[] = [];
  let cursor: string | null = null;

  while (true) {
    const resp = await fetch(JOBBER_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-JOBBER-GRAPHQL-VERSION": "2025-04-16",
      },
      body: JSON.stringify({ query: JOBBER_JOBS_QUERY, variables: { cursor } }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Jobber API error ${resp.status}: ${text}`);
    }

    const json = await resp.json() as any;
    if (json.errors?.length) throw new Error(`Jobber GraphQL error: ${json.errors[0].message}`);

    const jobsData = json?.data?.jobs;
    if (!jobsData) throw new Error("Unexpected Jobber response shape");

    all.push(...(jobsData.nodes as JobberJob[]));

    if (jobsData.pageInfo.hasNextPage) {
      cursor = jobsData.pageInfo.endCursor;
    } else {
      break;
    }
  }
  return all;
}

async function mapJobberJobToInsert(j: JobberJob, gasPrice: number): Promise<InsertJob> {
  const rawDate  = j.completedAt ?? j.createdAt;
  const date     = rawDate ? rawDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const lineItem = j.lineItems?.nodes?.[0]?.name;
  const name     = j.title || lineItem || `Job #${j.id.slice(-6)}`;
  const client   = j.client?.name
    || `${j.client?.firstName ?? ""} ${j.client?.lastName ?? ""}`.trim()
    || "Unknown";

  // Build address string from property
  const addr = j.property?.address;
  const fullAddress = addr
    ? [addr.street, addr.city, addr.province, addr.postalCode].filter(Boolean).join(", ")
    : null;

  // Calculate travel cost if we have an address
  const gasCost = fullAddress ? await calcTravelCost(fullAddress, gasPrice) : 0;

  return {
    name, client, date,
    jobPrice:      j.total ?? 0,
    supplyCost:    0,
    laborCost:     0,
    gasCost,
    equipmentCost: 0,
    otherCost:     0,
    notes:         fullAddress ? `Address: ${fullAddress}` : null,
    category:      null,
    externalId:    j.id,
  };
}

// ── Route registration ────────────────────────────────────────────────────────
export function registerRoutes(httpServer: Server, app: Express) {

  // ── Jobs CRUD ──────────────────────────────────────────────────────────────
  app.get("/api/jobs", async (_req, res) => {
    res.json(await storage.getAllJobs());
  });

  app.get("/api/jobs/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const job = await storage.getJob(id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  });

  app.post("/api/jobs", async (req, res) => {
    const parsed = insertJobSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    res.status(201).json(await storage.createJob(parsed.data));
  });

  app.patch("/api/jobs/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const parsed = insertJobSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const job = await storage.updateJob(id, parsed.data);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  });

  /** DELETE /api/jobs/all — wipe all jobs so Jobber re-sync recalculates travel costs */
  app.delete("/api/jobs/all", async (_req, res) => {
    const count = await storage.deleteAllJobs();
    res.json({ ok: true, deleted: count });
  });

  app.delete("/api/jobs/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    if (!await storage.deleteJob(id)) return res.status(404).json({ error: "Job not found" });
    res.status(204).send();
  });

  // ── Jobber OAuth ───────────────────────────────────────────────────────────

  /** GET /api/jobber/status — returns connection state */
  app.get("/api/jobber/status", async (_req, res) => {
    const { clientId } = getOAuthConfig();
    const tokens = await loadTokenSet();
    const configured = !!(clientId && process.env.JOBBER_CLIENT_SECRET);

    res.json({
      connected:   !!tokens?.accessToken,
      configured,  // true when env vars are present
      // Account name if we ever fetch it (future enhancement)
    });
  });

  /** GET /api/jobber/connect — redirect browser to Jobber's OAuth authorization page */
  app.get("/api/jobber/connect", async (req, res) => {
    const { clientId, redirectUri } = getOAuthConfig();
    if (!clientId) {
      return res.status(500).send(`
        <html><body style="font-family:sans-serif;padding:2rem;background:#0d1117;color:#e6edf3">
          <h2 style="color:#f85149">⚠️ Jobber credentials not configured</h2>
          <p>Set <code>JOBBER_CLIENT_ID</code> and <code>JOBBER_CLIENT_SECRET</code> in your <code>.env</code> file.</p>
          <p><a href="/#/settings" style="color:#3fb950">← Back to Settings</a></p>
        </body></html>
      `);
    }

    // CSRF state token
    const state = crypto.randomBytes(16).toString("hex");
    await storage.setConfig("jobber_oauth_state", state);

    const url = new URL(JOBBER_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id",     clientId);
    url.searchParams.set("redirect_uri",  redirectUri);
    url.searchParams.set("state",         state);

    res.redirect(url.toString());
  });

  /** GET /api/jobber/callback — Jobber redirects here after user grants access */
  app.get("/api/jobber/callback", async (req, res) => {
    const { code, state, error } = req.query as Record<string, string>;
    const { clientId, clientSecret, redirectUri } = getOAuthConfig();

    // User denied
    if (error) {
      return res.redirect("/#/settings?jobber=denied");
    }

    // CSRF check
    const savedState = await storage.getConfig("jobber_oauth_state");
    if (!state || state !== savedState) {
      return res.redirect("/#/settings?jobber=error&reason=state_mismatch");
    }
    await storage.setConfig("jobber_oauth_state", ""); // consume state

    if (!code) {
      return res.redirect("/#/settings?jobber=error&reason=no_code");
    }

    try {
      // Exchange code for tokens
      const tokenResp = await fetch(JOBBER_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type:    "authorization_code",
          client_id:     clientId!,
          client_secret: clientSecret!,
          code,
          redirect_uri:  redirectUri,
        }).toString(),
      });

      if (!tokenResp.ok) {
        const text = await tokenResp.text();
        console.error("Jobber token exchange failed:", text);
        return res.redirect("/#/settings?jobber=error&reason=token_exchange");
      }

      const data = await tokenResp.json() as any;
      const tokenSet: TokenSet = {
        accessToken:  data.access_token,
        refreshToken: data.refresh_token,
        expiresAt:    Date.now() + (data.expires_in ?? 3600) * 1000,
      };
      await saveTokenSet(tokenSet);

      // Kick off an immediate background sync
      fetchAllJobberJobs(tokenSet.accessToken)
        .then(async jobs => {
          const gasPrice = await fetchRaleighGasPrice();
          const rows: InsertJob[] = [];
          for (const j of jobs) {
            const row = await mapJobberJobToInsert(j, gasPrice);
            rows.push(row);
            await new Promise(r => setTimeout(r, 300));
          }
          const result = await storage.upsertJobberJobs(rows);
          console.log(`[Jobber] Initial sync: ${result.imported} imported, ${result.skipped} skipped (gas $${gasPrice}/gal)`);
        })
        .catch(err => console.error("[Jobber] Initial sync error:", err));

      res.redirect("/#/settings?jobber=connected");

    } catch (err: any) {
      console.error("Jobber callback error:", err);
      res.redirect("/#/settings?jobber=error&reason=exception");
    }
  });

  /** POST /api/jobber/disconnect */
  app.post("/api/jobber/disconnect", async (_req, res) => {
    await clearTokenSet();
    res.json({ ok: true });
  });

  /** POST /api/jobber/sync — manual sync trigger */
  app.post("/api/jobber/sync", async (_req, res) => {
    try {
      const token = await getValidAccessToken();
      const jobberJobs = await fetchAllJobberJobs(token);
      const gasPrice = await fetchRaleighGasPrice();
      console.log(`[Jobber] Using gas price: $${gasPrice}/gal, ${jobberJobs.length} jobs to process`);

      // Respond immediately so the request doesn't time out
      res.json({
        ok: true,
        total: jobberJobs.length,
        gasPrice,
        message: `Syncing ${jobberJobs.length} jobs in background (gas $${gasPrice}/gal) — check back in a minute`,
      });

      // Process in background with rate limiting
      (async () => {
        const rows: InsertJob[] = [];
        for (const j of jobberJobs) {
          const row = await mapJobberJobToInsert(j, gasPrice);
          rows.push(row);
          await new Promise(r => setTimeout(r, 300));
        }
        const result = await storage.upsertJobberJobs(rows);
        console.log(`[Jobber] Sync complete: ${result.imported} imported, ${result.skipped} skipped`);
      })().catch(err => console.error("[Jobber] Background sync error:", err));

    } catch (err: any) {
      console.error("Jobber sync error:", err);
      res.status(502).json({ error: err.message ?? "Jobber sync failed" });
    }
  });

  // ── Legacy: manual token endpoint (keep for backward compat) ──────────────
  app.get("/api/settings/jobber-token", async (_req, res) => {
    const token = await storage.getConfig("jobber_access_token");
    res.json({ hasToken: !!token, tokenPreview: token ? `…${token.slice(-6)}` : null });
  });

  // ── Marketing Spend CRUD ───────────────────────────────────────────────────
  app.get("/api/marketing-spend", async (_req, res) => {
    res.json(await storage.getAllMarketingSpend());
  });

  app.post("/api/marketing-spend", async (req, res) => {
    const parsed = insertMarketingSpendSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    res.status(201).json(await storage.upsertMarketingSpend(parsed.data));
  });

  app.delete("/api/marketing-spend/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    if (!await storage.deleteMarketingSpend(id)) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  });

  // ── Leads CRUD ────────────────────────────────────────────────────────────
  app.get("/api/leads", async (_req, res) => {
    res.json(await storage.getAllLeads());
  });

  app.post("/api/leads", async (req, res) => {
    const parsed = insertLeadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    res.status(201).json(await storage.createLead(parsed.data));
  });

  app.patch("/api/leads/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const parsed = insertLeadSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const lead = await storage.updateLead(id, parsed.data);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    res.json(lead);
  });

  app.delete("/api/leads/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    if (!await storage.deleteLead(id)) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  });

  // ── Public webhook: pressureboysnc.com form submissions ──────────────────
  // POST /api/leads/webhook  (no auth — called from Netlify site)
  app.post("/api/leads/webhook", async (req, res) => {
    try {
      const body = req.body ?? {};
      const lead = await storage.createLead({
        date: new Date().toISOString().slice(0, 10),
        source: "Google Business", // default for website form submissions
        converted: 0,
        name:    body.name    ?? body.first_name ?? null,
        email:   body.email   ?? null,
        phone:   body.phone   ?? null,
        message: body.message ?? body.comments ?? null,
        formData: JSON.stringify(body),
      });
      console.log(`[Webhook] New lead from pressureboysnc.com:`, lead.id);
      res.json({ ok: true, id: lead.id });
    } catch (err: any) {
      console.error("[Webhook] Error saving lead:", err);
      res.status(500).json({ error: "Failed to save lead" });
    }
  });

  // ── Metrics aggregate ─────────────────────────────────────────────────────
  app.get("/api/metrics", async (_req, res) => {
    res.json(await storage.getMetrics());
  });
}

// ── Auto-sync scheduler ───────────────────────────────────────────────────────
// Runs every hour automatically — only syncs new jobs, skips already-imported ones
export async function startAutoSync() {
  const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  async function runSync() {
    try {
      const token = await getValidAccessToken();
      const jobberJobs = await fetchAllJobberJobs(token);
      const gasPrice = await fetchRaleighGasPrice();

      const rows: InsertJob[] = [];
      for (const j of jobberJobs) {
        const row = await mapJobberJobToInsert(j, gasPrice);
        rows.push(row);
        await new Promise(r => setTimeout(r, 300));
      }

      const result = await storage.upsertJobberJobs(rows);
      if (result.imported > 0) {
        console.log(`[AutoSync] ${result.imported} new job(s) imported (gas $${gasPrice}/gal)`);
      } else {
        console.log(`[AutoSync] Up to date — ${result.skipped} jobs already synced`);
      }
    } catch (err: any) {
      // Not connected yet or token expired — silently skip
      if (!err.message?.includes("Not connected")) {
        console.warn("[AutoSync] Error:", err.message);
      }
    }
  }

  // Run once on startup after a short delay, then every hour
  setTimeout(() => {
    runSync();
    setInterval(runSync, INTERVAL_MS);
  }, 10_000); // 10 second delay on startup

  console.log("[AutoSync] Scheduler started — syncing every hour");
}
