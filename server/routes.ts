
import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertDesignSchema } from "@shared/schema";
import { openai } from "./replit_integrations/image/client";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";

// Panel set configurations
const PANEL_SETS = {
  small: { file: "panels-3.png", name: "Set of 3" },
  medium: { file: "panels-5.png", name: "Set of 5" },
  large: { file: "panels-10.png", name: "Set of 10" },
};

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

    // Step 1: Analyze the wall using GPT-4 Vision to determine size and get placement info
    console.log(`[ProcessDesign] Analyzing wall with GPT-4 Vision...`);
    
    const analysisResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this room image. I need to place acoustic sound panels on the main visible wall.
              
Please respond with JSON only in this format:
{
  "wallSize": "small" | "medium" | "large",
  "wallBounds": {
    "x": number (0-100, percentage from left),
    "y": number (0-100, percentage from top),
    "width": number (0-100, percentage of image width),
    "height": number (0-100, percentage of image height)
  },
  "confidence": number (0-1)
}

Guidelines:
- "small" = wall area less than 30% of image, use 3 panels
- "medium" = wall area 30-50% of image, use 5 panels
- "large" = wall area greater than 50% of image, use 10 panels
- wallBounds should define where the blank wall area is located`
            },
            {
              type: "image_url",
              image_url: { url: imageUrl }
            }
          ]
        }
      ],
      max_tokens: 500,
    });

    const analysisText = analysisResponse.choices[0]?.message?.content || "";
    console.log(`[ProcessDesign] Wall analysis result: ${analysisText}`);

    // Parse the JSON response
    let wallAnalysis: { 
      wallSize: "small" | "medium" | "large";
      wallBounds: { x: number; y: number; width: number; height: number };
    };
    
    try {
      // Extract JSON from the response (handle markdown code blocks)
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      wallAnalysis = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.log(`[ProcessDesign] Could not parse analysis, defaulting to medium`);
      wallAnalysis = { 
        wallSize: "medium", 
        wallBounds: { x: 20, y: 20, width: 60, height: 60 } 
      };
    }

    // Step 2: Select the appropriate panel set
    const panelSet = PANEL_SETS[wallAnalysis.wallSize];
    console.log(`[ProcessDesign] Selected panel set: ${panelSet.name} for ${wallAnalysis.wallSize} wall`);

    // Step 3: Composite the panels onto the original image using sharp
    const panelPath = path.join(process.cwd(), "client", "public", panelSet.file);
    
    // Convert base64 data URL to buffer
    const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, "");
    const originalBuffer = Buffer.from(base64Data, "base64");
    
    // Get original image dimensions
    const originalMeta = await sharp(originalBuffer).metadata();
    const origWidth = originalMeta.width || 1024;
    const origHeight = originalMeta.height || 1024;

    // Calculate panel overlay position and size based on wall bounds
    const overlayX = Math.round((wallAnalysis.wallBounds.x / 100) * origWidth);
    const overlayY = Math.round((wallAnalysis.wallBounds.y / 100) * origHeight);
    const overlayWidth = Math.round((wallAnalysis.wallBounds.width / 100) * origWidth);
    const overlayHeight = Math.round((wallAnalysis.wallBounds.height / 100) * origHeight);

    // Resize the panel overlay to fit the wall area
    const panelBuffer = await sharp(panelPath)
      .resize(overlayWidth, overlayHeight, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();

    // Composite the panels onto the original image
    const compositeBuffer = await sharp(originalBuffer)
      .composite([
        {
          input: panelBuffer,
          left: overlayX,
          top: overlayY,
        }
      ])
      .png()
      .toBuffer();

    const resultBase64 = compositeBuffer.toString("base64");
    const resultUrl = `data:image/png;base64,${resultBase64}`;

    console.log(`[ProcessDesign] Successfully composited panels for design ${designId}`);
    await storage.updateDesignStatus(designId, "completed", resultUrl);

  } catch (error) {
    console.error(`[ProcessDesign] Error processing design ${designId}:`, error);
    if (error instanceof Error) {
      console.error(`[ProcessDesign] Stack trace:`, error.stack);
    }
    await storage.updateDesignStatus(designId, "failed");
  }
}
