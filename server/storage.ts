import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, desc } from "drizzle-orm";
import {
  jobs, config, marketingSpend, leads,
  type Job, type InsertJob,
  type MarketingSpend, type InsertMarketingSpend,
  type Lead, type InsertLead,
} from "@shared/schema";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway.internal")
    ? false
    : { rejectUnauthorized: false },
});
const db = drizzle(pool);

// ── Migrations ─────────────────────────────────────────────────────────────────
async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
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
    await client.query(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketing_spend (
        id SERIAL PRIMARY KEY,
        month TEXT NOT NULL,
        channel TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        notes TEXT
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
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
    console.log("[DB] Migrations complete");
  } finally {
    client.release();
  }
}

// Run migrations immediately
runMigrations().catch(err => console.error("[DB] Migration error:", err));

// ── Storage interface ──────────────────────────────────────────────────────────
export interface IStorage {
  // Jobs
  getAllJobs(): Job[];
  getJob(id: number): Job | undefined;
  createJob(data: InsertJob): Job;
  updateJob(id: number, data: Partial<InsertJob>): Job | undefined;
  deleteJob(id: number): boolean;
  upsertJobberJobs(rows: InsertJob[]): { imported: number; skipped: number };
  deleteAllJobs(): number;

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
  async getAllJobs(): Promise<Job[]> {
    return db.select().from(jobs).orderBy(desc(jobs.date));
  },

  async getJob(id: number): Promise<Job | undefined> {
    const result = await db.select().from(jobs).where(eq(jobs.id, id));
    return result[0];
  },

  async createJob(data: InsertJob): Promise<Job> {
    const result = await db.insert(jobs).values(data).returning();
    return result[0];
  },

  async updateJob(id: number, data: Partial<InsertJob>): Promise<Job | undefined> {
    const result = await db.update(jobs).set(data).where(eq(jobs.id, id)).returning();
    return result[0];
  },

  async deleteJob(id: number): Promise<boolean> {
    const result = await db.delete(jobs).where(eq(jobs.id, id)).returning();
    return result.length > 0;
  },

  async deleteAllJobs(): Promise<number> {
    const result = await pool.query(`DELETE FROM jobs`);
    return result.rowCount ?? 0;
  },

  async upsertJobberJobs(rows: InsertJob[]): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;
    for (const row of rows) {
      if (!row.externalId) continue;
      const existing = await pool.query(`SELECT id FROM jobs WHERE external_id = $1`, [row.externalId]);
      if (existing.rows.length > 0) {
        skipped++;
      } else {
        await db.insert(jobs).values(row);
        imported++;
      }
    }
    return { imported, skipped };
  },

  // ── Config ──────────────────────────────────────────────────────────────────
  async getConfig(key: string): Promise<string | null> {
    const result = await pool.query(`SELECT value FROM config WHERE key = $1`, [key]);
    return result.rows[0]?.value ?? null;
  },

  async setConfig(key: string, value: string): Promise<void> {
    await pool.query(
      `INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value]
    );
  },

  // ── Marketing Spend ──────────────────────────────────────────────────────────
  async getAllMarketingSpend(): Promise<MarketingSpend[]> {
    return db.select().from(marketingSpend).orderBy(desc(marketingSpend.month));
  },

  async getMarketingSpendByMonth(month: string): Promise<MarketingSpend[]> {
    return db.select().from(marketingSpend).where(eq(marketingSpend.month, month));
  },

  async upsertMarketingSpend(data: InsertMarketingSpend): Promise<MarketingSpend> {
    const existing = await pool.query(
      `SELECT id FROM marketing_spend WHERE month = $1 AND channel = $2`,
      [data.month, data.channel]
    );
    if (existing.rows.length > 0) {
      const result = await db.update(marketingSpend).set(data).where(eq(marketingSpend.id, existing.rows[0].id)).returning();
      return result[0];
    }
    const result = await db.insert(marketingSpend).values(data).returning();
    return result[0];
  },

  async deleteMarketingSpend(id: number): Promise<boolean> {
    const result = await db.delete(marketingSpend).where(eq(marketingSpend.id, id)).returning();
    return result.length > 0;
  },

  // ── Leads ────────────────────────────────────────────────────────────────────
  async getAllLeads(): Promise<Lead[]> {
    return db.select().from(leads).orderBy(desc(leads.date));
  },

  async createLead(data: InsertLead): Promise<Lead> {
    const result = await db.insert(leads).values(data).returning();
    return result[0];
  },

  async updateLead(id: number, data: Partial<InsertLead>): Promise<Lead | undefined> {
    const result = await db.update(leads).set(data).where(eq(leads.id, id)).returning();
    return result[0];
  },

  async deleteLead(id: number): Promise<boolean> {
    const result = await db.delete(leads).where(eq(leads.id, id)).returning();
    return result.length > 0;
  },

  // ── Metrics aggregate ─────────────────────────────────────────────────────────
  async getMetrics(): Promise<MetricsData> {
    const allJobs = await db.select().from(jobs);
    const allSpend = await db.select().from(marketingSpend);
    const allLeads = await db.select().from(leads).orderBy(desc(leads.date));

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
