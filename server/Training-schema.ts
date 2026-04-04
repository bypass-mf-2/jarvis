/**
 * Additional Database Schema for Auto-Training
 * 
 * Add these tables to drizzle/schema.ts
 */

import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
} from "drizzle-orm/mysql-core";

// ── Training Examples ───────────────────────────────────────────────────────
export const trainingExamples = mysqlTable("training_examples", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId"),
  instruction: text("instruction").notNull(),
  output: text("output").notNull(),
  rating: int("rating").notNull(), // 1-5 stars
  category: mysqlEnum("category", ["ios", "web", "data", "general"]).default("general"),
  usedInTraining: boolean("usedInTraining").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TrainingExample = typeof trainingExamples.$inferSelect;
export type InsertTrainingExample = typeof trainingExamples.$inferInsert;

// ── Model Versions ──────────────────────────────────────────────────────────
export const modelVersions = mysqlTable("model_versions", {
  id: int("id").autoincrement().primaryKey(),
  modelName: varchar("modelName", { length: 255 }).notNull(),
  baseModel: varchar("baseModel", { length: 255 }).notNull(),
  specialty: mysqlEnum("specialty", ["ios", "web", "data", "general"]).default("general"),
  trainingExamples: int("trainingExamples").default(0),
  status: mysqlEnum("status", ["training", "trained", "deployed", "archived"]).default("training"),
  performanceScore: decimal("performanceScore", { precision: 3, scale: 2 }), // 0-1
  abTestWins: int("abTestWins").default(0),
  abTestLosses: int("abTestLosses").default(0),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  deployedAt: timestamp("deployedAt"),
});

export type ModelVersion = typeof modelVersions.$inferSelect;
export type InsertModelVersion = typeof modelVersions.$inferInsert;

// ── Add rating to existing messages table ───────────────────────────────────
// Add this column to your existing messages table:
// userRating: int("userRating"), // 1-5 stars, null = not rated
