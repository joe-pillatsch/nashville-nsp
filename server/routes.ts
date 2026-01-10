
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

    // Step 1: Analyze wall bounds and estimate dimensions from GPT-4o Vision
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
  "wallWidthFt": number (estimated wall width in feet, typically 8-20 feet),
  "wallHeightFt": number (estimated wall height in feet, typically 8-10 feet)
}

Guidelines:
- Estimate the actual wall dimensions in feet based on typical room proportions
- Standard residential ceiling height is 8-9 feet
- Look for context clues like doors (typically 6'8" tall), windows, furniture
- Focus on the largest clear wall space visible for panel placement`
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

    // Parse the wall bounds and dimensions
    interface WallAnalysis {
      wallBounds: { x: number; y: number; width: number; height: number };
      wallWidthFt: number;
      wallHeightFt: number;
    }

    let wallBounds = { x: 15, y: 15, width: 70, height: 70 }; // defaults
    let wallWidthFt = 12; // default wall width in feet
    let wallHeightFt = 8; // default wall height in feet
    
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
        
        // Extract wall dimensions in feet
        if (parsed.wallWidthFt) {
          wallWidthFt = Math.max(5, Math.min(30, Number(parsed.wallWidthFt) || 12));
        }
        if (parsed.wallHeightFt) {
          wallHeightFt = Math.max(6, Math.min(15, Number(parsed.wallHeightFt) || 8));
        }
      }
    } catch (parseError) {
      console.log(`[ProcessDesign] Parse error, using defaults`);
    }

    // Determine which panel set fits best on this wall
    const panelSetId = selectBestPanelSet(wallWidthFt, wallHeightFt);
    const panelSet = PANEL_SETS[panelSetId];
    console.log(`[ProcessDesign] Selected ${panelSet.name} for wall ${wallWidthFt}ft x ${wallHeightFt}ft`);

    // Generate layout using real panel dimensions
    const layoutPanels = generateLayout(panelSetId, wallWidthFt, wallHeightFt);
    console.log(`[ProcessDesign] Generated layout with ${layoutPanels.length} panels`);

    // Wall bounds in pixels
    const wallLeftPx = (wallBounds.x / 100) * origWidth;
    const wallTopPx = (wallBounds.y / 100) * origHeight;
    const wallWidthPx = (wallBounds.width / 100) * origWidth;
    const wallHeightPx = (wallBounds.height / 100) * origHeight;
    
    console.log(`[ProcessDesign] Wall bounds in pixels: (${Math.round(wallLeftPx)}, ${Math.round(wallTopPx)}) ${Math.round(wallWidthPx)}x${Math.round(wallHeightPx)}`);

    // Step 2: Create flat pure-black panel overlays (no shadows, no effects)
    const panelOverlays: sharp.OverlayOptions[] = [];
    
    for (let i = 0; i < layoutPanels.length; i++) {
      const panel = layoutPanels[i];
      
      // Layout values are percentages (0-100) within wall bounds
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

// Panel set specifications with real-world dimensions (in feet)
// Each panel has widthFt and heightFt representing actual physical size
interface PanelSpec {
  widthFt: number;
  heightFt: number;
  quantity: number;
}

interface PanelSet {
  name: string;
  panels: PanelSpec[];
  totalPanelCount: number;
  minWallWidthFt: number;  // Minimum wall width needed to fit all panels
  maxPanelHeightFt: number; // Tallest panel in the set
}

// Calculated minimum wall widths:
// Set of 3: 3 × 1ft panels + 2 × 0.5ft gaps = 4ft total, need ~5ft with margin
// Set of 5: 5 × 1ft panels + 4 × 0.5ft gaps = 7ft total, need ~8ft with margin
// Set of 10: (4+2+2)×1ft + 2×2ft + 9×0.5ft gaps = 8 + 4 + 4.5 = 16.5ft, need ~18ft
const PANEL_SETS: Record<3 | 5 | 10, PanelSet> = {
  3: {
    name: "Set of 3",
    panels: [
      { widthFt: 1, heightFt: 4, quantity: 3 },  // Three 1'×4' panels
    ],
    totalPanelCount: 3,
    minWallWidthFt: 5,   // 3×1ft + 2×0.5ft gaps = 4ft, plus margin
    maxPanelHeightFt: 4,
  },
  5: {
    name: "Set of 5",
    panels: [
      { widthFt: 1, heightFt: 4, quantity: 2 },  // Two 1'×4' panels
      { widthFt: 1, heightFt: 3, quantity: 2 },  // Two 1'×3' panels
      { widthFt: 1, heightFt: 2, quantity: 1 },  // One 1'×2' panel
    ],
    totalPanelCount: 5,
    minWallWidthFt: 8,   // 5×1ft + 4×0.5ft gaps = 7ft, plus margin
    maxPanelHeightFt: 4,
  },
  10: {
    name: "Set of 10",
    panels: [
      { widthFt: 1, heightFt: 4, quantity: 4 },  // Four 1'×4' panels
      { widthFt: 1, heightFt: 3, quantity: 2 },  // Two 1'×3' panels
      { widthFt: 1, heightFt: 2, quantity: 2 },  // Two 1'×2' panels
      { widthFt: 2, heightFt: 2, quantity: 2 },  // Two 2'×2' panels
    ],
    totalPanelCount: 10,
    minWallWidthFt: 18,  // 12ft panels + 4.5ft gaps = 16.5ft, plus margin
    maxPanelHeightFt: 4,
  },
};

// Expand panel specs into individual panel instances
interface IndividualPanel {
  widthFt: number;
  heightFt: number;
}

function expandPanelSet(setId: 3 | 5 | 10): IndividualPanel[] {
  const set = PANEL_SETS[setId];
  const panels: IndividualPanel[] = [];
  
  for (const spec of set.panels) {
    for (let i = 0; i < spec.quantity; i++) {
      panels.push({ widthFt: spec.widthFt, heightFt: spec.heightFt });
    }
  }
  
  return panels;
}

// Generate layout positions for a panel set given wall dimensions in feet
// Returns panel positions as percentages (0-100) within the wall bounds
interface LayoutPanel {
  x: number;      // Center X as percentage of wall width
  y: number;      // Center Y as percentage of wall height
  width: number;  // Width as percentage of wall width
  height: number; // Height as percentage of wall height
}

function generateLayout(
  setId: 3 | 5 | 10,
  wallWidthFt: number,
  wallHeightFt: number
): LayoutPanel[] {
  const panels = expandPanelSet(setId);
  const layouts: LayoutPanel[] = [];
  
  // Sort panels by height (tallest first) to arrange them aesthetically
  // For Set of 5: [4ft, 4ft, 3ft, 3ft, 2ft]
  panels.sort((a, b) => b.heightFt - a.heightFt);
  
  // Calculate total width needed (sum of panel widths + gaps)
  let gapFt = 0.5; // 6 inches between panels (default)
  const totalPanelWidthFt = panels.reduce((sum, p) => sum + p.widthFt, 0);
  let totalGapsWidthFt = (panels.length - 1) * gapFt;
  let totalWidthFt = totalPanelWidthFt + totalGapsWidthFt;
  
  // If total width exceeds wall width, reduce gaps to fit
  if (totalWidthFt > wallWidthFt) {
    const availableGapSpace = wallWidthFt - totalPanelWidthFt;
    gapFt = Math.max(0.1, availableGapSpace / (panels.length - 1)); // Min 1.2 inches
    totalGapsWidthFt = (panels.length - 1) * gapFt;
    totalWidthFt = totalPanelWidthFt + totalGapsWidthFt;
  }
  
  // Calculate starting X position to center the group
  const startXFt = Math.max(0, (wallWidthFt - totalWidthFt) / 2);
  
  // Position each panel, bottom-aligned with some margin from wall bottom
  const bottomMarginFt = 1.5; // Distance from bottom of wall to bottom of lowest panel
  let currentXFt = startXFt;
  
  for (const panel of panels) {
    // Calculate center positions
    const panelCenterXFt = currentXFt + panel.widthFt / 2;
    const panelBottomFt = bottomMarginFt;
    const panelCenterYFt = wallHeightFt - panelBottomFt - panel.heightFt / 2;
    
    // Convert to percentages of wall dimensions, clamped to valid range
    const xPct = Math.max(0, Math.min(100, (panelCenterXFt / wallWidthFt) * 100));
    const yPct = Math.max(0, Math.min(100, (panelCenterYFt / wallHeightFt) * 100));
    const widthPct = Math.max(1, Math.min(100, (panel.widthFt / wallWidthFt) * 100));
    const heightPct = Math.max(1, Math.min(100, (panel.heightFt / wallHeightFt) * 100));
    
    layouts.push({
      x: xPct,
      y: yPct,
      width: widthPct,
      height: heightPct,
    });
    
    currentXFt += panel.widthFt + gapFt;
  }
  
  return layouts;
}

// Determine which panel set fits best on a given wall
function selectBestPanelSet(wallWidthFt: number, wallHeightFt: number): 3 | 5 | 10 {
  // Check which sets fit (largest set that fits is preferred)
  const candidates: (3 | 5 | 10)[] = [10, 5, 3];
  
  for (const setId of candidates) {
    const set = PANEL_SETS[setId];
    if (wallWidthFt >= set.minWallWidthFt && wallHeightFt >= set.maxPanelHeightFt + 2) {
      return setId;
    }
  }
  
  // Default to smallest set if wall is very small
  return 3;
}
