import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Lead source options ────────────────────────────────────────────────────────
export const LEAD_SOURCES = [
  "Google Ads",
  "Yard Sign",
  "Referral",
  "Repeat Customer",
  "Google Business",
  "Other",
] as const;
export type LeadSource = typeof LEAD_SOURCES[number];

// ── Jobs ───────────────────────────────────────────────────────────────────────
export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  client: text("client"),
  date: text("date").notNull(), // ISO date string YYYY-MM-DD
  jobPrice: real("job_price").notNull(),
  supplyCost: real("supply_cost").notNull().default(0),
  laborCost: real("labor_cost").notNull().default(0),
  gasCost: real("gas_cost").notNull().default(0),
  equipmentCost: real("equipment_cost").notNull().default(0),
  otherCost: real("other_cost").notNull().default(0),
  notes: text("notes"),
  category: text("category"),
  externalId: text("external_id"), // Jobber job ID — prevents duplicate imports
  leadSource: text("lead_source"),  // e.g. "Google Ads", "Yard Sign", etc.
});

// ── Config ─────────────────────────────────────────────────────────────────────
export const config = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// ── Marketing Spend ────────────────────────────────────────────────────────────
// One row per month+channel. month = "YYYY-MM"
export const marketingSpend = sqliteTable("marketing_spend", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  month: text("month").notNull(),    // "2024-03"
  channel: text("channel").notNull(), // "Google Ads", "Yard Signs", etc.
  amount: real("amount").notNull().default(0),
  notes: text("notes"),
});

// ── Leads ──────────────────────────────────────────────────────────────────────
// Tracks individual lead events (form submissions, manual entries, etc.)
export const leads = sqliteTable("leads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),       // ISO date YYYY-MM-DD
  source: text("source").notNull(),   // LeadSource value
  converted: integer("converted").notNull().default(0), // 0 or 1 (SQLite bool)
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  message: text("message"),
  formData: text("form_data"),        // raw JSON payload from webhook
});

// ── Insert schemas + types ─────────────────────────────────────────────────────
export const insertJobSchema = createInsertSchema(jobs).omit({ id: true });
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobs.$inferSelect;
export type Config = typeof config.$inferSelect;

export const insertMarketingSpendSchema = createInsertSchema(marketingSpend).omit({ id: true });
export type InsertMarketingSpend = z.infer<typeof insertMarketingSpendSchema>;
export type MarketingSpend = typeof marketingSpend.$inferSelect;

export const insertLeadSchema = createInsertSchema(leads).omit({ id: true });
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;

// ── Derived helpers (computed, not stored) ─────────────────────────────────────
export function computeJobStats(job: Job) {
  const totalCost = job.supplyCost + job.laborCost + job.gasCost + job.equipmentCost + job.otherCost;
  const profit = job.jobPrice - totalCost;
  const margin = job.jobPrice > 0 ? (profit / job.jobPrice) * 100 : 0;
  return { totalCost, profit, margin };
}
