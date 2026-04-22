import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc } from "drizzle-orm";
import {
  jobs, config, marketingSpend, leads,
  type Job, type InsertJob,
  type MarketingSpend, type InsertMarketingSpend,
  type Lead, type InsertLead,
} from "@shared/schema";

const sqlite = new Database("jobs.db");
const db = drizzle(sqlite);

// ── Migrations ─────────────────────────────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    client TEXT,
    date TEXT NOT NULL,
    job_price REAL NOT NULL,
    supply_cost REAL NOT NULL DEFAULT 0,
    labor_cost REAL NOT NULL DEFAULT 0,
    gas_cost REAL NOT NULL DEFAULT 0,
    equipment_cost REAL NOT NULL DEFAULT 0,
    other_cost REAL NOT NULL DEFAULT 0,
    notes TEXT,
    category TEXT,
    external_id TEXT,
    lead_source TEXT
  )
`);

// Idempotent column additions (SQLite does not allow UNIQUE on ALTER TABLE)
const addIfMissing = (table: string, column: string, def: string) => {
  try { sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`); } catch (_) {}
};
addIfMissing("jobs", "external_id", "TEXT");
addIfMissing("jobs", "lead_source", "TEXT");

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS marketing_spend (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT NOT NULL,
    channel TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    notes TEXT
  )
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    source TEXT NOT NULL,
    converted INTEGER NOT NULL DEFAULT 0,
    name TEXT,
    email TEXT,
    phone TEXT,
    message TEXT,
    form_data TEXT
  )
`);

// ── Storage interface ──────────────────────────────────────────────────────────
export interface IStorage {
  // Jobs
  getAllJobs(): Job[];
  getJob(id: number): Job | undefined;
  createJob(data: InsertJob): Job;
  updateJob(id: number, data: Partial<InsertJob>): Job | undefined;
  deleteJob(id: number): boolean;
  upsertJobberJobs(rows: InsertJob[]): { imported: number; skipped: number };

  // Config
  getConfig(key: string): string | null;
  setConfig(key: string, value: string): void;

  // Marketing spend
  getAllMarketingSpend(): MarketingSpend[];
  getMarketingSpendByMonth(month: string): MarketingSpend[];
  upsertMarketingSpend(data: InsertMarketingSpend): MarketingSpend;
  deleteMarketingSpend(id: number): boolean;

  // Leads
  getAllLeads(): Lead[];
  createLead(data: InsertLead): Lead;
  updateLead(id: number, data: Partial<InsertLead>): Lead | undefined;
  deleteLead(id: number): boolean;

  // Metrics aggregate
  getMetrics(): MetricsData;
}

// ── Metrics types ──────────────────────────────────────────────────────────────
export interface ChannelRevenue {
  channel: string;
  revenue: number;
  jobCount: number;
}

export interface MonthlySpend {
  month: string;
  total: number;
  byChannel: { channel: string; amount: number }[];
}

export interface MetricsData {
  // Job value
  avgJobValue: number;
  totalRevenue: number;
  totalJobs: number;

  // CAC
  totalMarketingSpend: number;
  newCustomers: number;         // unique clients with only 1 job
  cac: number;                  // totalMarketingSpend / newCustomers

  // CLV
  clv: number;                  // avg revenue per client
  clvCacRatio: number;

  // Cost per lead
  totalLeads: number;
  costPerLead: number;          // total marketing spend / total leads

  // Conversion
  convertedLeads: number;
  conversionRate: number;       // convertedLeads / totalLeads

  // Channel breakdown
  channelRevenue: ChannelRevenue[];

  // Form submissions
  formSubmissions: number;      // leads from website (any source)
  recentLeads: Lead[];

  // Spend summary
  monthlySpend: MonthlySpend[];
}

// ── Implementation ─────────────────────────────────────────────────────────────
export const storage: IStorage = {
  // ── Jobs ────────────────────────────────────────────────────────────────────
  getAllJobs(): Job[] {
    return db.select().from(jobs).orderBy(desc(jobs.date)).all();
  },

  getJob(id: number): Job | undefined {
    return db.select().from(jobs).where(eq(jobs.id, id)).get();
  },

  createJob(data: InsertJob): Job {
    return db.insert(jobs).values(data).returning().get();
  },

  updateJob(id: number, data: Partial<InsertJob>): Job | undefined {
    const existing = db.select().from(jobs).where(eq(jobs.id, id)).get();
    if (!existing) return undefined;
    return db.update(jobs).set(data).where(eq(jobs.id, id)).returning().get();
  },

  deleteJob(id: number): boolean {
    const result = db.delete(jobs).where(eq(jobs.id, id)).run();
    return result.changes > 0;
  },

  upsertJobberJobs(rows: InsertJob[]): { imported: number; skipped: number } {
    let imported = 0;
    let skipped = 0;
    for (const row of rows) {
      if (!row.externalId) continue;
      const stmt = sqlite.prepare(`SELECT id FROM jobs WHERE external_id = ?`);
      const existing = stmt.get(row.externalId);
      if (existing) {
        skipped++;
      } else {
        db.insert(jobs).values(row).run();
        imported++;
      }
    }
    return { imported, skipped };
  },

  // ── Config ──────────────────────────────────────────────────────────────────
  getConfig(key: string): string | null {
    const row = db.select().from(config).where(eq(config.key, key)).get();
    return row ? row.value : null;
  },

  setConfig(key: string, value: string): void {
    sqlite.prepare(
      `INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(key, value);
  },

  // ── Marketing Spend ──────────────────────────────────────────────────────────
  getAllMarketingSpend(): MarketingSpend[] {
    return db.select().from(marketingSpend).orderBy(desc(marketingSpend.month)).all();
  },

  getMarketingSpendByMonth(month: string): MarketingSpend[] {
    return db.select().from(marketingSpend).where(eq(marketingSpend.month, month)).all();
  },

  upsertMarketingSpend(data: InsertMarketingSpend): MarketingSpend {
    // Try to find existing row with same month + channel
    const existing = sqlite.prepare(
      `SELECT id FROM marketing_spend WHERE month = ? AND channel = ?`
    ).get(data.month, data.channel) as { id: number } | undefined;

    if (existing) {
      return db
        .update(marketingSpend)
        .set(data)
        .where(eq(marketingSpend.id, existing.id))
        .returning()
        .get();
    }
    return db.insert(marketingSpend).values(data).returning().get();
  },

  deleteMarketingSpend(id: number): boolean {
    const result = db.delete(marketingSpend).where(eq(marketingSpend.id, id)).run();
    return result.changes > 0;
  },

  // ── Leads ────────────────────────────────────────────────────────────────────
  getAllLeads(): Lead[] {
    return db.select().from(leads).orderBy(desc(leads.date)).all();
  },

  createLead(data: InsertLead): Lead {
    return db.insert(leads).values(data).returning().get();
  },

  updateLead(id: number, data: Partial<InsertLead>): Lead | undefined {
    const existing = db.select().from(leads).where(eq(leads.id, id)).get();
    if (!existing) return undefined;
    return db.update(leads).set(data).where(eq(leads.id, id)).returning().get();
  },

  deleteLead(id: number): boolean {
    const result = db.delete(leads).where(eq(leads.id, id)).run();
    return result.changes > 0;
  },

  // ── Metrics aggregate ─────────────────────────────────────────────────────────
  getMetrics(): MetricsData {
    const allJobs = db.select().from(jobs).all();
    const allSpend = db.select().from(marketingSpend).all();
    const allLeads = db.select().from(leads).orderBy(desc(leads.date)).all();

    // ── Job value ──────────────────────────────────────────────────────────────
    const totalRevenue = allJobs.reduce((s, j) => s + j.jobPrice, 0);
    const totalJobs = allJobs.length;
    const avgJobValue = totalJobs > 0 ? totalRevenue / totalJobs : 0;

    // ── Customer counts ────────────────────────────────────────────────────────
    // Group by client name (lowercase trim)
    const clientMap = new Map<string, number>();
    for (const j of allJobs) {
      const key = (j.client ?? "unknown").toLowerCase().trim();
      clientMap.set(key, (clientMap.get(key) ?? 0) + 1);
    }
    const uniqueClients = clientMap.size;
    const newCustomers = Array.from(clientMap.values()).filter(c => c === 1).length;

    // ── CLV ────────────────────────────────────────────────────────────────────
    // Total revenue per client / unique clients
    const clv = uniqueClients > 0 ? totalRevenue / uniqueClients : 0;

    // ── Marketing spend ────────────────────────────────────────────────────────
    const totalMarketingSpend = allSpend.reduce((s, r) => s + r.amount, 0);
    const cac = newCustomers > 0 ? totalMarketingSpend / newCustomers : 0;
    const clvCacRatio = cac > 0 ? clv / cac : 0;

    // ── Leads ──────────────────────────────────────────────────────────────────
    const totalLeads = allLeads.length;
    const convertedLeads = allLeads.filter(l => l.converted === 1).length;
    const conversionRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;
    const costPerLead = totalLeads > 0 ? totalMarketingSpend / totalLeads : 0;

    // ── Channel revenue ────────────────────────────────────────────────────────
    const channelMap = new Map<string, { revenue: number; jobCount: number }>();
    for (const j of allJobs) {
      const ch = j.leadSource ?? "Untagged";
      const cur = channelMap.get(ch) ?? { revenue: 0, jobCount: 0 };
      channelMap.set(ch, { revenue: cur.revenue + j.jobPrice, jobCount: cur.jobCount + 1 });
    }
    const channelRevenue: ChannelRevenue[] = Array.from(channelMap.entries())
      .map(([channel, v]) => ({ channel, ...v }))
      .sort((a, b) => b.revenue - a.revenue);

    // ── Form submissions (webhook leads) ───────────────────────────────────────
    const formSubmissions = allLeads.length; // all leads tracked via system

    // ── Monthly spend ──────────────────────────────────────────────────────────
    const monthMap = new Map<string, { total: number; byChannel: Map<string, number> }>();
    for (const s of allSpend) {
      if (!monthMap.has(s.month)) {
        monthMap.set(s.month, { total: 0, byChannel: new Map() });
      }
      const m = monthMap.get(s.month)!;
      m.total += s.amount;
      m.byChannel.set(s.channel, (m.byChannel.get(s.channel) ?? 0) + s.amount);
    }
    const monthlySpend: MonthlySpend[] = Array.from(monthMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 12)
      .map(([month, v]) => ({
        month,
        total: v.total,
        byChannel: Array.from(v.byChannel.entries()).map(([channel, amount]) => ({ channel, amount })),
      }));

    return {
      avgJobValue,
      totalRevenue,
      totalJobs,
      totalMarketingSpend,
      newCustomers,
      cac,
      clv,
      clvCacRatio,
      totalLeads,
      costPerLead,
      convertedLeads,
      conversionRate,
      channelRevenue,
      formSubmissions,
      recentLeads: allLeads.slice(0, 20),
      monthlySpend,
    };
  },
};
