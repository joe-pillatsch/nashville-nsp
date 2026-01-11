
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

    // Step 2: Create panel overlays with shadows and subtle 3D effects
    const panelOverlays: sharp.OverlayOptions[] = [];
    
    // Shadow settings for depth effect
    const shadowOffsetX = Math.round(origWidth * 0.008); // Slight right offset
    const shadowOffsetY = Math.round(origHeight * 0.012); // Slight down offset
    const shadowBlur = Math.round(Math.min(origWidth, origHeight) * 0.015); // Blur radius
    const shadowOpacity = 0.4; // Semi-transparent shadow
    
    // Edge highlight settings
    const highlightWidth = Math.max(2, Math.round(origWidth * 0.003)); // Thin highlight strip
    const highlightOpacity = 0.15; // Subtle highlight
    
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
      
      // 1. Create soft drop shadow (blurred, offset rectangle)
      const shadowBuffer = await sharp({
        create: {
          width: panelW + shadowBlur * 2,
          height: panelH + shadowBlur * 2,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: Math.round(255 * shadowOpacity) }
        }
      })
        .blur(shadowBlur > 0 ? shadowBlur : 1)
        .png()
        .toBuffer();
      
      const shadowX = Math.max(0, panelX + shadowOffsetX - shadowBlur);
      const shadowY = Math.max(0, panelY + shadowOffsetY - shadowBlur);
      
      panelOverlays.push({
        input: shadowBuffer,
        left: shadowX,
        top: shadowY,
      });
      
      // 2. Create pure black panel rectangle
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
      
      // 3. Create subtle edge highlight on top edge (simulates light from above)
      if (panelW > highlightWidth * 2) {
        const topHighlightBuffer = await sharp({
          create: {
            width: panelW,
            height: highlightWidth,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: Math.round(255 * highlightOpacity) }
          }
        }).png().toBuffer();
        
        panelOverlays.push({
          input: topHighlightBuffer,
          left: panelX,
          top: panelY,
        });
      }
      
      // 4. Create subtle edge highlight on left edge
      if (panelH > highlightWidth * 2) {
        const leftHighlightBuffer = await sharp({
          create: {
            width: highlightWidth,
            height: panelH,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: Math.round(255 * highlightOpacity * 0.6) }
          }
        }).png().toBuffer();
        
        panelOverlays.push({
          input: leftHighlightBuffer,
          left: panelX,
          top: panelY,
        });
      }
    }
    
    if (panelOverlays.length === 0) {
      throw new Error("Could not create any valid panel overlays");
    }
    
    console.log(`[ProcessDesign] Created panel overlays with shadows and highlights`);

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

// Layout pattern types for creative variety
type LayoutPattern = 'standard' | 'staggered' | 'asymmetric' | 'mixed';

function generateLayout(
  setId: 3 | 5 | 10,
  wallWidthFt: number,
  wallHeightFt: number
): LayoutPanel[] {
  // Randomly select a layout pattern for variety
  const patterns: LayoutPattern[] = ['standard', 'staggered', 'asymmetric', 'mixed'];
  const pattern = patterns[Math.floor(Math.random() * patterns.length)];
  
  console.log(`[Layout] Using pattern: ${pattern}`);
  
  switch (pattern) {
    case 'staggered':
      return generateStaggeredLayout(setId, wallWidthFt, wallHeightFt);
    case 'asymmetric':
      return generateAsymmetricLayout(setId, wallWidthFt, wallHeightFt);
    case 'mixed':
      return generateMixedLayout(setId, wallWidthFt, wallHeightFt);
    default:
      return generateStandardLayout(setId, wallWidthFt, wallHeightFt);
  }
}

// Standard layout: all panels in a row, bottom-aligned
function generateStandardLayout(
  setId: 3 | 5 | 10,
  wallWidthFt: number,
  wallHeightFt: number
): LayoutPanel[] {
  const panels = expandPanelSet(setId);
  const layouts: LayoutPanel[] = [];
  
  panels.sort((a, b) => b.heightFt - a.heightFt);
  
  let gapFt = 0.5;
  const totalPanelWidthFt = panels.reduce((sum, p) => sum + p.widthFt, 0);
  let totalWidthFt = totalPanelWidthFt + (panels.length - 1) * gapFt;
  
  if (totalWidthFt > wallWidthFt) {
    gapFt = Math.max(0.1, (wallWidthFt - totalPanelWidthFt) / (panels.length - 1));
    totalWidthFt = totalPanelWidthFt + (panels.length - 1) * gapFt;
  }
  
  const startXFt = Math.max(0, (wallWidthFt - totalWidthFt) / 2);
  const bottomMarginFt = 1.5;
  let currentXFt = startXFt;
  
  for (const panel of panels) {
    const panelCenterXFt = currentXFt + panel.widthFt / 2;
    const panelCenterYFt = wallHeightFt - bottomMarginFt - panel.heightFt / 2;
    
    layouts.push({
      x: Math.max(0, Math.min(100, (panelCenterXFt / wallWidthFt) * 100)),
      y: Math.max(0, Math.min(100, (panelCenterYFt / wallHeightFt) * 100)),
      width: Math.max(1, Math.min(100, (panel.widthFt / wallWidthFt) * 100)),
      height: Math.max(1, Math.min(100, (panel.heightFt / wallHeightFt) * 100)),
    });
    
    currentXFt += panel.widthFt + gapFt;
  }
  
  return layouts;
}

// Staggered layout: panels at varying vertical positions for dynamic look
function generateStaggeredLayout(
  setId: 3 | 5 | 10,
  wallWidthFt: number,
  wallHeightFt: number
): LayoutPanel[] {
  const panels = expandPanelSet(setId);
  const layouts: LayoutPanel[] = [];
  
  panels.sort((a, b) => b.heightFt - a.heightFt);
  
  let gapFt = 0.5;
  const totalPanelWidthFt = panels.reduce((sum, p) => sum + p.widthFt, 0);
  let totalWidthFt = totalPanelWidthFt + (panels.length - 1) * gapFt;
  
  if (totalWidthFt > wallWidthFt) {
    gapFt = Math.max(0.1, (wallWidthFt - totalPanelWidthFt) / (panels.length - 1));
    totalWidthFt = totalPanelWidthFt + (panels.length - 1) * gapFt;
  }
  
  const startXFt = Math.max(0, (wallWidthFt - totalWidthFt) / 2);
  let currentXFt = startXFt;
  
  // Stagger vertically: alternating high/low positions
  const staggerOffsets = [0, 0.8, 0.3, 1.0, 0.5]; // Feet offset from center
  
  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];
    const staggerOffset = staggerOffsets[i % staggerOffsets.length];
    
    const panelCenterXFt = currentXFt + panel.widthFt / 2;
    const baseCenterYFt = wallHeightFt / 2;
    const panelCenterYFt = baseCenterYFt + staggerOffset - 0.5;
    
    layouts.push({
      x: Math.max(0, Math.min(100, (panelCenterXFt / wallWidthFt) * 100)),
      y: Math.max(5, Math.min(95, (panelCenterYFt / wallHeightFt) * 100)),
      width: Math.max(1, Math.min(100, (panel.widthFt / wallWidthFt) * 100)),
      height: Math.max(1, Math.min(100, (panel.heightFt / wallHeightFt) * 100)),
    });
    
    currentXFt += panel.widthFt + gapFt;
  }
  
  return layouts;
}

// Asymmetric layout: clustered groupings with varied spacing
// Note: This layout uses alternating gap sizes but keeps panel dimensions exact
function generateAsymmetricLayout(
  setId: 3 | 5 | 10,
  wallWidthFt: number,
  wallHeightFt: number
): LayoutPanel[] {
  const panels = expandPanelSet(setId);
  const layouts: LayoutPanel[] = [];
  
  // Group panels: tight cluster on one side, spread on other
  panels.sort((a, b) => b.heightFt - a.heightFt);
  
  const totalPanelWidthFt = panels.reduce((sum, p) => sum + p.widthFt, 0);
  
  // Calculate with mixed gaps (tight and wide alternating)
  let tightGapFt = 0.25;
  let wideGapFt = 1.0;
  const numTightGaps = Math.floor(panels.length / 2);
  const numWideGaps = panels.length - 1 - numTightGaps;
  let totalGapsFt = numTightGaps * tightGapFt + numWideGaps * wideGapFt;
  let totalWidthFt = totalPanelWidthFt + totalGapsFt;
  
  // If layout is too wide, reduce gaps (not panel sizes) to fit
  if (totalWidthFt > wallWidthFt) {
    const availableGapSpace = wallWidthFt - totalPanelWidthFt;
    // Scale gaps proportionally while maintaining ratio
    const gapScale = Math.max(0.1, availableGapSpace / totalGapsFt);
    tightGapFt *= gapScale;
    wideGapFt *= gapScale;
    totalGapsFt = numTightGaps * tightGapFt + numWideGaps * wideGapFt;
    totalWidthFt = totalPanelWidthFt + totalGapsFt;
  }
  
  const startXFt = Math.max(0, (wallWidthFt - totalWidthFt) / 2);
  const bottomMarginFt = 1.5;
  let currentXFt = startXFt;
  
  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];
    const panelCenterXFt = currentXFt + panel.widthFt / 2;
    const panelCenterYFt = wallHeightFt - bottomMarginFt - panel.heightFt / 2;
    
    // Panel dimensions stay exact (no scaling)
    layouts.push({
      x: Math.max(0, Math.min(100, (panelCenterXFt / wallWidthFt) * 100)),
      y: Math.max(0, Math.min(100, (panelCenterYFt / wallHeightFt) * 100)),
      width: Math.max(1, Math.min(100, (panel.widthFt / wallWidthFt) * 100)),
      height: Math.max(1, Math.min(100, (panel.heightFt / wallHeightFt) * 100)),
    });
    
    // Alternate between tight and wide gaps
    const gapFt = (i % 2 === 0) ? tightGapFt : wideGapFt;
    currentXFt += panel.widthFt + gapFt;
  }
  
  return layouts;
}

// Mixed layout: some horizontal panels mixed with vertical
function generateMixedLayout(
  setId: 3 | 5 | 10,
  wallWidthFt: number,
  wallHeightFt: number
): LayoutPanel[] {
  const panels = expandPanelSet(setId);
  const layouts: LayoutPanel[] = [];
  
  // Rotate some panels to horizontal (swap width/height)
  const rotatedPanels = panels.map((p, i) => {
    // Rotate shorter panels (2ft or less height) to horizontal
    if (p.heightFt <= 2 && i % 2 === 0) {
      return { widthFt: p.heightFt, heightFt: p.widthFt, rotated: true };
    }
    return { ...p, rotated: false };
  });
  
  // Sort by height, keeping rotated ones at the end
  rotatedPanels.sort((a, b) => {
    if (a.rotated !== b.rotated) return a.rotated ? 1 : -1;
    return b.heightFt - a.heightFt;
  });
  
  let gapFt = 0.5;
  const totalPanelWidthFt = rotatedPanels.reduce((sum, p) => sum + p.widthFt, 0);
  let totalWidthFt = totalPanelWidthFt + (rotatedPanels.length - 1) * gapFt;
  
  if (totalWidthFt > wallWidthFt) {
    gapFt = Math.max(0.1, (wallWidthFt - totalPanelWidthFt) / (rotatedPanels.length - 1));
    totalWidthFt = totalPanelWidthFt + (rotatedPanels.length - 1) * gapFt;
  }
  
  const startXFt = Math.max(0, (wallWidthFt - totalWidthFt) / 2);
  const bottomMarginFt = 1.5;
  let currentXFt = startXFt;
  
  for (const panel of rotatedPanels) {
    const panelCenterXFt = currentXFt + panel.widthFt / 2;
    const panelCenterYFt = wallHeightFt - bottomMarginFt - panel.heightFt / 2;
    
    layouts.push({
      x: Math.max(0, Math.min(100, (panelCenterXFt / wallWidthFt) * 100)),
      y: Math.max(0, Math.min(100, (panelCenterYFt / wallHeightFt) * 100)),
      width: Math.max(1, Math.min(100, (panel.widthFt / wallWidthFt) * 100)),
      height: Math.max(1, Math.min(100, (panel.heightFt / wallHeightFt) * 100)),
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
