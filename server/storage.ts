
import { designs, type Design, type InsertDesign } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

export interface IStorage {
  createDesign(design: InsertDesign): Promise<Design>;
  getDesign(id: number): Promise<Design | undefined>;
  getDesigns(): Promise<Design[]>;
  updateDesignStatus(id: number, status: string, processedImageUrl?: string): Promise<Design>;
}

export class DatabaseStorage implements IStorage {
  async createDesign(insertDesign: InsertDesign): Promise<Design> {
    const [design] = await db
      .insert(designs)
      .values(insertDesign)
      .returning();
    return design;
  }

  async getDesign(id: number): Promise<Design | undefined> {
    const [design] = await db
      .select()
      .from(designs)
      .where(eq(designs.id, id));
    return design;
  }

  async getDesigns(): Promise<Design[]> {
    return await db.select().from(designs).orderBy(designs.id);
  }

  async updateDesignStatus(id: number, status: string, processedImageUrl?: string): Promise<Design> {
    const [updated] = await db
      .update(designs)
      .set({ status, processedImageUrl })
      .where(eq(designs.id, id))
      .returning();
    return updated;
  }
}

export const storage = new DatabaseStorage();
