
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

// Panel set configurations with detailed descriptions for AI
const PANEL_SETS = {
  small: { 
    file: "panels-3.png", 
    name: "Set of 3",
    count: 3,
    description: "3 acoustic felt panels: one large vertical rectangle (about 2ft tall x 1ft wide), one medium square (1ft x 1ft), and one small horizontal rectangle (1ft wide x 0.5ft tall). Modern minimalist design in warm earth tones - terracotta, sage green, and cream."
  },
  medium: { 
    file: "panels-5.png", 
    name: "Set of 5",
    count: 5,
    description: "5 acoustic felt panels in varying sizes: two large vertical rectangles (2ft x 1ft), two medium squares (1ft x 1ft), and one horizontal rectangle (1.5ft x 0.75ft). Coordinated color palette with muted natural tones - olive, rust, beige, charcoal, and warm white."
  },
  large: { 
    file: "panels-10.png", 
    name: "Set of 10",
    count: 10,
    description: "10 acoustic felt panels creating a gallery wall effect: mix of vertical rectangles, horizontal rectangles, and squares in various sizes (ranging from 0.5ft to 2ft). Rich color palette including deep burgundy, forest green, navy, terracotta, cream, and natural wood tones."
  },
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

// Panel position type for layout
interface PanelPosition {
  x: number; // percentage from left (0-100)
  y: number; // percentage from top (0-100)
  width: number; // percentage of image width
  height: number; // percentage of image height
}

// Background processing function
async function processDesign(designId: number, imageUrl: string, prompt: string) {
  try {
    console.log(`[ProcessDesign] Starting processing for design ${designId}`);
    await storage.updateDesignStatus(designId, "processing");

    // Convert base64 data URL to buffer for processing
    const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, "");
    const originalBuffer = Buffer.from(base64Data, "base64");
    
    // Get original image dimensions
    const originalMeta = await sharp(originalBuffer).metadata();
    const origWidth = originalMeta.width || 1024;
    const origHeight = originalMeta.height || 1024;
    console.log(`[ProcessDesign] Original image size: ${origWidth}x${origHeight}`);

    // Step 1: Analyze wall bounds from GPT-4o Vision (simplified - only wall detection)
    console.log(`[ProcessDesign] Analyzing wall with GPT-4o Vision...`);

    const analysisResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this room photo to find the main visible wall suitable for hanging acoustic panels.

Respond with JSON ONLY:
{
  "wallBounds": {
    "x": number (0-100, left edge as percentage of image width),
    "y": number (0-100, top edge as percentage of image height),
    "width": number (0-100, wall width as percentage of image),
    "height": number (0-100, wall height as percentage of image)
  },
  "wallSize": "small" | "medium" | "large"
}

Guidelines:
- "small" = wall is less than 30% of image area
- "medium" = wall is 30-50% of image area
- "large" = wall is over 50% of image area
- Focus on the largest clear wall space visible`
            },
            {
              type: "image_url",
              image_url: { url: imageUrl, detail: "high" }
            }
          ]
        }
      ],
      max_tokens: 500,
    });

    const analysisText = analysisResponse.choices[0]?.message?.content || "";
    console.log(`[ProcessDesign] Wall analysis: ${analysisText.substring(0, 300)}`);

    // Parse the wall bounds
    interface WallAnalysis {
      wallBounds: { x: number; y: number; width: number; height: number };
      wallSize: "small" | "medium" | "large";
    }

    let wallBounds = { x: 15, y: 15, width: 70, height: 70 }; // defaults
    let panelCount: 3 | 5 | 10 = 5;
    
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed: WallAnalysis = JSON.parse(jsonMatch[0]);
        
        // Extract wall bounds
        if (parsed.wallBounds) {
          wallBounds = {
            x: Math.max(0, Math.min(90, Number(parsed.wallBounds.x) || 15)),
            y: Math.max(0, Math.min(90, Number(parsed.wallBounds.y) || 15)),
            width: Math.max(20, Math.min(100, Number(parsed.wallBounds.width) || 70)),
            height: Math.max(20, Math.min(100, Number(parsed.wallBounds.height) || 70)),
          };
        }
        
        // Determine panel count from wall size
        if (parsed.wallSize === "small") {
          panelCount = 3;
        } else if (parsed.wallSize === "large") {
          panelCount = 10;
        } else {
          panelCount = 5;
        }
      }
    } catch (parseError) {
      console.log(`[ProcessDesign] Parse error, using defaults`);
    }

    // Get layout template and apply to wall bounds
    const template = getLayoutTemplate(panelCount);
    console.log(`[ProcessDesign] Using template: ${template.name} with ${panelCount} panels`);

    // Wall bounds in pixels
    const wallLeftPx = (wallBounds.x / 100) * origWidth;
    const wallTopPx = (wallBounds.y / 100) * origHeight;
    const wallWidthPx = (wallBounds.width / 100) * origWidth;
    const wallHeightPx = (wallBounds.height / 100) * origHeight;
    
    console.log(`[ProcessDesign] Wall bounds in pixels: (${Math.round(wallLeftPx)}, ${Math.round(wallTopPx)}) ${Math.round(wallWidthPx)}x${Math.round(wallHeightPx)}`);
    console.log(`[ProcessDesign] Creating ${template.panels.length} flat black panels`);

    // Step 2: Create flat pure-black panel overlays (no shadows, no effects)
    const panelOverlays: sharp.OverlayOptions[] = [];
    
    for (let i = 0; i < template.panels.length; i++) {
      const panel = template.panels[i];
      
      // Template values are percentages (0-100) within a normalized space
      // Convert directly to pixels within wall bounds
      const panelCenterX = wallLeftPx + (panel.x / 100) * wallWidthPx;
      const panelCenterY = wallTopPx + (panel.y / 100) * wallHeightPx;
      let panelW = Math.round((panel.width / 100) * wallWidthPx);
      let panelH = Math.round((panel.height / 100) * wallHeightPx);
      let panelX = Math.round(panelCenterX - panelW / 2);
      let panelY = Math.round(panelCenterY - panelH / 2);
      
      // Clamp panel to stay within image bounds
      if (panelX < 0) {
        panelW += panelX;
        panelX = 0;
      }
      if (panelY < 0) {
        panelH += panelY;
        panelY = 0;
      }
      if (panelX + panelW > origWidth) {
        panelW = origWidth - panelX;
      }
      if (panelY + panelH > origHeight) {
        panelH = origHeight - panelY;
      }
      
      // Skip if panel is too small after clamping
      if (panelW < 10 || panelH < 10) {
        console.log(`[ProcessDesign] Skipping too-small panel (${panelW}x${panelH})`);
        continue;
      }
      
      // Create pure black panel rectangle - no shadows, no highlights
      const panelBuffer = await sharp({
        create: {
          width: panelW,
          height: panelH,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 255 } // Pure black
        }
      }).png().toBuffer();
      
      panelOverlays.push({
        input: panelBuffer,
        left: panelX,
        top: panelY,
      });
    }
    
    if (panelOverlays.length === 0) {
      throw new Error("Could not create any valid panel overlays");
    }
    
    console.log(`[ProcessDesign] Created ${panelOverlays.length} flat black panel overlays`);

    // Composite all panels onto the original image
    const resultBuffer = await sharp(originalBuffer)
      .composite(panelOverlays)
      .png()
      .toBuffer();

    const resultBase64 = resultBuffer.toString("base64");
    const resultUrl = `data:image/png;base64,${resultBase64}`;

    console.log(`[ProcessDesign] Successfully composited ${panelOverlays.length} panels for design ${designId}`);
    await storage.updateDesignStatus(designId, "completed", resultUrl);

  } catch (error) {
    console.error(`[ProcessDesign] Error:`, error);
    if (error instanceof Error) {
      console.error(`[ProcessDesign] Stack:`, error.stack);
    }
    await storage.updateDesignStatus(designId, "failed");
  }
}

// Layout template library - matches the actual "Set of 5" panel proportions
// Panels are 1ft wide x varying heights (4ft, 4ft, 2.5ft, 2.5ft, 1.5ft)
// Ratio approximately 1:4 for tallest panels
const LAYOUT_TEMPLATES = {
  // 5-panel layout matching the "Set of 5" reference image
  // Panels arranged left to right: tall, tall, medium, medium, short
  // All panels bottom-aligned at roughly the same baseline
  setOfFive: {
    name: "Set of 5",
    count: 5,
    panels: [
      // Panel 1 (leftmost): 4 feet tall - width 10%, height 50%
      { x: 18, y: 50, width: 10, height: 50 },
      // Panel 2: 4 feet tall
      { x: 34, y: 50, width: 10, height: 50 },
      // Panel 3 (center): ~2.5 feet tall - shorter
      { x: 50, y: 56, width: 10, height: 38 },
      // Panel 4: ~2.5 feet tall
      { x: 66, y: 53, width: 10, height: 44 },
      // Panel 5 (rightmost): ~1.5 feet tall - shortest
      { x: 82, y: 62, width: 10, height: 26 },
    ]
  },
  // 3-panel layouts - also using tall vertical proportions
  threeVertical: {
    name: "Three Vertical Bars",
    count: 3,
    panels: [
      { x: 30, y: 50, width: 10, height: 50 },
      { x: 50, y: 50, width: 10, height: 50 },
      { x: 70, y: 50, width: 10, height: 50 },
    ]
  },
  // 10-panel layouts - two rows of tall panels
  galleryGrid: {
    name: "Gallery Grid",
    count: 10,
    panels: [
      // Top row - 5 panels
      { x: 18, y: 30, width: 8, height: 35 },
      { x: 34, y: 30, width: 8, height: 35 },
      { x: 50, y: 30, width: 8, height: 35 },
      { x: 66, y: 30, width: 8, height: 35 },
      { x: 82, y: 30, width: 8, height: 35 },
      // Bottom row - 5 panels
      { x: 18, y: 75, width: 8, height: 35 },
      { x: 34, y: 75, width: 8, height: 35 },
      { x: 50, y: 75, width: 8, height: 35 },
      { x: 66, y: 75, width: 8, height: 35 },
      { x: 82, y: 75, width: 8, height: 35 },
    ]
  },
};

// Get a layout template based on panel count
function getLayoutTemplate(count: 3 | 5 | 10): typeof LAYOUT_TEMPLATES.setOfFive {
  if (count === 3) {
    return LAYOUT_TEMPLATES.threeVertical;
  } else if (count === 10) {
    return LAYOUT_TEMPLATES.galleryGrid;
  } else {
    // Use the "Set of 5" pattern matching the reference image
    return LAYOUT_TEMPLATES.setOfFive;
  }
}

// Create a default panel layout
function createDefaultLayout(count: 3 | 5 | 10) {
  const template = getLayoutTemplate(count);
  
  return {
    panelCount: count,
    wallBounds: { x: 15, y: 15, width: 70, height: 70 },
    panels: template.panels,
    wallColor: "white",
    lightingDirection: "above"
  };
}
