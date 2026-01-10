
import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const designs = pgTable("designs", {
  id: serial("id").primaryKey(),
  originalImageUrl: text("original_image_url").notNull(),
  processedImageUrl: text("processed_image_url"),
  prompt: text("prompt"),
  status: text("status").notNull().default("pending"), // pending, processing, completed, failed
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDesignSchema = createInsertSchema(designs).omit({ 
  id: true, 
  createdAt: true,
  status: true,
  processedImageUrl: true 
});

export type Design = typeof designs.$inferSelect;
export type InsertDesign = z.infer<typeof insertDesignSchema>;
