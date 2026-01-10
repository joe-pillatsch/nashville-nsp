
import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertDesignSchema } from "@shared/schema";
import { openai } from "./replit_integrations/image/client";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";

// Configure multer for file uploads
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ 
  storage: multerStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

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

  // File upload endpoint
  app.post("/api/upload", upload.single("file"), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      // Read file and convert to base64 data URL
      const filePath = req.file.path;
      const fileBuffer = fs.readFileSync(filePath);
      const base64 = fileBuffer.toString("base64");
      const mimeType = req.file.mimetype;
      const dataUrl = `data:${mimeType};base64,${base64}`;
      
      // Clean up the file after reading
      fs.unlinkSync(filePath);
      
      console.log(`[Upload] Successfully processed file: ${req.file.originalname}`);
      res.json({ url: dataUrl });
    } catch (error) {
      console.error("[Upload] Error:", error);
      res.status(500).json({ message: "Upload failed" });
    }
  });

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
