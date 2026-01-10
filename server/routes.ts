
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertDesignSchema } from "@shared/schema";
import { openai } from "./replit_integrations/image/client";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // designs endpoints
  app.post("/api/designs", async (req, res) => {
    try {
      const data = insertDesignSchema.parse(req.body);
      const design = await storage.createDesign(data);
      
      // Trigger async processing
      // In a real production app, this should be a background job
      processDesign(design.id, design.originalImageUrl, design.prompt || "sound panels on wall");

      res.status(201).json(design);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.get("/api/designs", async (req, res) => {
    const designs = await storage.getDesigns();
    res.json(designs);
  });

  app.get("/api/designs/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    
    const design = await storage.getDesign(id);
    if (!design) return res.status(404).json({ message: "Design not found" });
    res.json(design);
  });

  // Simple file upload endpoint (mock for now since we don't have object storage integration yet)
  // In a real app, use the Object Storage integration.
  // For MVP, we'll just echo back the data URL or assume client sends data URL.
  // Actually, let's implement a basic in-memory or file-system upload for the MVP session if needed.
  // But client is sending base64/dataURL for now as per schema "originalImageUrl".

  return httpServer;
}

// Background processing function
async function processDesign(designId: number, imageUrl: string, prompt: string) {
  try {
    console.log(`[ProcessDesign] Starting processing for design ${designId}`);
    await storage.updateDesignStatus(designId, "processing");

    // MVP Approach: Generate a NEW image based on a strong descriptive prompt + user prompt.
    const enhancedPrompt = `A photorealistic interior design shot of a modern room with a blank wall that has ${prompt} installed on it. High quality, architectural photography style.`;
    
    console.log(`[ProcessDesign] Sending prompt to OpenAI: "${enhancedPrompt}"`);

    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt: enhancedPrompt,
      n: 1,
      size: "1024x1024",
    });

    console.log(`[ProcessDesign] Received response from OpenAI`);

    // The integration returns base64 for gpt-image-1
    const b64_json = response.data[0].b64_json;
    const generatedUrl = b64_json ? `data:image/png;base64,${b64_json}` : response.data[0].url;

    if (generatedUrl) {
      console.log(`[ProcessDesign] Successfully generated image for design ${designId}`);
      await storage.updateDesignStatus(designId, "completed", generatedUrl);
    } else {
      console.error(`[ProcessDesign] No image URL in response for design ${designId}`);
      await storage.updateDesignStatus(designId, "failed");
    }

  } catch (error) {
    console.error(`[ProcessDesign] Error processing design ${designId}:`, error);
    if (error instanceof Error) {
        console.error(`[ProcessDesign] Stack trace:`, error.stack);
    }
    await storage.updateDesignStatus(designId, "failed");
  }
}
