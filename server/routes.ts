
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

    // Step 1: Analyze wall and get panel positions from GPT-4o Vision
    console.log(`[ProcessDesign] Analyzing wall with GPT-4o Vision...`);

    const analysisResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are an interior design expert. Analyze this room photo to place acoustic sound panels on the main visible wall.

Based on the wall size, recommend either 3, 5, or 10 panels:
- Small wall (less than 30% of image): 3 panels
- Medium wall (30-50% of image): 5 panels  
- Large wall (over 50% of image): 10 panels

Respond with JSON ONLY:
{
  "panelCount": 3 | 5 | 10,
  "wallBounds": {
    "x": number (0-100, left edge percentage),
    "y": number (0-100, top edge percentage),
    "width": number (0-100, wall width as percentage),
    "height": number (0-100, wall height as percentage)
  },
  "panels": [
    {
      "x": number (0-100, center X as percentage),
      "y": number (0-100, center Y as percentage),
      "width": number (5-15, width as percentage),
      "height": number (8-25, height as percentage)
    }
  ],
  "wallColor": "description of wall color",
  "lightingDirection": "left | right | above | diffuse"
}

Guidelines:
- Create an asymmetric gallery-style arrangement
- Panels should be within the wall bounds
- Space panels with 2-4% gaps between them
- Vary sizes for visual interest`
            },
            {
              type: "image_url",
              image_url: { url: imageUrl, detail: "high" }
            }
          ]
        }
      ],
      max_tokens: 2000,
    });

    const analysisText = analysisResponse.choices[0]?.message?.content || "";
    console.log(`[ProcessDesign] Wall analysis: ${analysisText.substring(0, 500)}`);

    // Parse the analysis
    interface LayoutAnalysis {
      panelCount: 3 | 5 | 10;
      wallBounds: { x: number; y: number; width: number; height: number };
      panels: PanelPosition[];
      wallColor: string;
      lightingDirection: string;
    }

    let analysis: LayoutAnalysis;
    
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      analysis = JSON.parse(jsonMatch[0]);
      
      // CRITICAL: Coerce panelCount to exactly 3, 5, or 10
      const rawCount = Number(analysis.panelCount) || 5;
      if (rawCount <= 3) {
        analysis.panelCount = 3;
      } else if (rawCount <= 7) {
        analysis.panelCount = 5;
      } else {
        analysis.panelCount = 10;
      }
      
      // Validate and clamp panel position values
      analysis.panels = (analysis.panels || []).map(p => ({
        x: Math.max(5, Math.min(95, Number(p.x) || 50)),
        y: Math.max(5, Math.min(95, Number(p.y) || 50)),
        width: Math.max(3, Math.min(20, Number(p.width) || 8)),
        height: Math.max(5, Math.min(30, Number(p.height) || 12))
      }));
      
      // Normalize panel array to exactly panelCount entries
      if (analysis.panels.length > analysis.panelCount) {
        // Trim excess panels
        analysis.panels = analysis.panels.slice(0, analysis.panelCount);
      } else if (analysis.panels.length < analysis.panelCount) {
        // Fill missing panels from default layout
        const defaultLayout = createDefaultLayout(analysis.panelCount);
        while (analysis.panels.length < analysis.panelCount) {
          const idx = analysis.panels.length;
          if (idx < defaultLayout.panels.length) {
            analysis.panels.push(defaultLayout.panels[idx]);
          }
        }
      }
      
    } catch (parseError) {
      console.log(`[ProcessDesign] Parse error, using defaults`);
      analysis = createDefaultLayout(5);
    }

    // Select panel set based on validated count
    const panelSetKey = analysis.panelCount === 3 ? "small" : analysis.panelCount === 10 ? "large" : "medium";
    const panelSet = PANEL_SETS[panelSetKey];
    console.log(`[ProcessDesign] Using ${panelSet.name} with exactly ${analysis.panelCount} panels`);

    // Step 2: Create square 1024x1024 images for gpt-image-1 edit
    // Letterbox the original image to preserve aspect ratio within the square
    const targetSize = 1024;
    const aspectRatio = origWidth / origHeight;
    
    let innerWidth: number, innerHeight: number, offsetX: number, offsetY: number;
    if (aspectRatio > 1) {
      // Landscape: fit width, pad top/bottom
      innerWidth = targetSize;
      innerHeight = Math.round(targetSize / aspectRatio);
      offsetX = 0;
      offsetY = Math.round((targetSize - innerHeight) / 2);
    } else {
      // Portrait or square: fit height, pad left/right
      innerHeight = targetSize;
      innerWidth = Math.round(targetSize * aspectRatio);
      offsetX = Math.round((targetSize - innerWidth) / 2);
      offsetY = 0;
    }

    console.log(`[ProcessDesign] Letterboxing: ${innerWidth}x${innerHeight} at offset (${offsetX}, ${offsetY})`);

    // Validate panels against wall bounds and create mask
    // Clamp panels to stay within wall bounds
    const wallBounds = analysis.wallBounds || { x: 10, y: 10, width: 80, height: 80 };
    const validatedPanels: PanelPosition[] = [];
    
    for (const panel of analysis.panels) {
      // Check if panel center is within wall bounds
      const wallLeft = wallBounds.x;
      const wallRight = wallBounds.x + wallBounds.width;
      const wallTop = wallBounds.y;
      const wallBottom = wallBounds.y + wallBounds.height;
      
      // Clamp panel position to wall bounds
      const clampedX = Math.max(wallLeft + panel.width/2, Math.min(wallRight - panel.width/2, panel.x));
      const clampedY = Math.max(wallTop + panel.height/2, Math.min(wallBottom - panel.height/2, panel.y));
      
      validatedPanels.push({
        x: clampedX,
        y: clampedY,
        width: panel.width,
        height: panel.height
      });
    }
    
    // If we lost too many panels, use default layout
    if (validatedPanels.length < analysis.panelCount) {
      console.log(`[ProcessDesign] Only ${validatedPanels.length} valid panels, using default layout`);
      const defaultLayout = createDefaultLayout(analysis.panelCount);
      validatedPanels.length = 0;
      validatedPanels.push(...defaultLayout.panels);
    }
    
    // Create mask with panel rectangles
    const maskComposites: sharp.OverlayOptions[] = [];
    
    for (const panel of validatedPanels) {
      // Scale panel dimensions to the inner (letterboxed) area
      const panelW = Math.round((panel.width / 100) * innerWidth);
      const panelH = Math.round((panel.height / 100) * innerHeight);
      // Position relative to inner area, then add offset for letterboxing
      const panelX = offsetX + Math.round((panel.x / 100) * innerWidth - panelW / 2);
      const panelY = offsetY + Math.round((panel.y / 100) * innerHeight - panelH / 2);
      
      // Skip if panel would be outside canvas (shouldn't happen after validation)
      if (panelX < 0 || panelY < 0 || panelX + panelW > targetSize || panelY + panelH > targetSize) {
        console.log(`[ProcessDesign] Skipping out-of-bounds panel at (${panelX}, ${panelY})`);
        continue;
      }
      
      // White rectangle for this panel position
      const rectBuffer = await sharp({
        create: {
          width: Math.max(1, panelW),
          height: Math.max(1, panelH),
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 255 }
        }
      }).png().toBuffer();

      maskComposites.push({
        input: rectBuffer,
        left: panelX,
        top: panelY,
      });
    }
    
    // Verify we have the expected number of panels in the mask
    const expectedCount = analysis.panelCount;
    if (maskComposites.length < expectedCount) {
      console.log(`[ProcessDesign] Only ${maskComposites.length}/${expectedCount} panels in mask, using fallback`);
      maskComposites.length = 0; // Clear and rebuild with defaults
      
      // Use default layout with CORRECT panel count
      const fallbackLayout = createDefaultLayout(expectedCount);
      for (const panel of fallbackLayout.panels) {
        const panelW = Math.round((panel.width / 100) * innerWidth);
        const panelH = Math.round((panel.height / 100) * innerHeight);
        const panelX = offsetX + Math.round((panel.x / 100) * innerWidth - panelW / 2);
        const panelY = offsetY + Math.round((panel.y / 100) * innerHeight - panelH / 2);
        
        const rectBuffer = await sharp({
          create: {
            width: Math.max(1, panelW),
            height: Math.max(1, panelH),
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 255 }
          }
        }).png().toBuffer();

        maskComposites.push({
          input: rectBuffer,
          left: Math.max(0, panelX),
          top: Math.max(0, panelY),
        });
      }
      // Update analysis.panels for later compositing
      analysis.panels = fallbackLayout.panels;
    } else {
      // Use validated panels for compositing
      analysis.panels = validatedPanels;
    }
    
    // Final check: ensure we have panels
    if (maskComposites.length === 0) {
      throw new Error("Could not create valid panel layout");
    }
    
    console.log(`[ProcessDesign] Created mask with ${maskComposites.length} panel regions`);

    // Create the 1024x1024 mask: transparent base with white panel areas
    const maskBuffer = await sharp({
      create: {
        width: targetSize,
        height: targetSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent = don't edit
      }
    })
      .composite(maskComposites)
      .png()
      .toBuffer();

    // Resize and letterbox original image to 1024x1024
    const resizedInner = await sharp(originalBuffer)
      .resize(innerWidth, innerHeight, { fit: "fill" })
      .png()
      .toBuffer();

    // Place the resized image on a 1024x1024 black canvas (letterboxed)
    const resizedOriginal = await sharp({
      create: {
        width: targetSize,
        height: targetSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 255 }
      }
    })
      .composite([{ input: resizedInner, left: offsetX, top: offsetY }])
      .png()
      .toBuffer();

    // Step 3: Use gpt-image-1 edit with mask to add panels
    console.log(`[ProcessDesign] Generating panels with AI (mask-based edit)...`);

    const editPrompt = `Add ${analysis.panelCount} acoustic felt sound panels to the wall in this room, exactly in the masked areas.

Panel description: ${panelSet.description}

Requirements:
- Each panel should have a soft felt/fabric texture
- Add realistic shadows matching the room's lighting (coming from ${analysis.lightingDirection || 'above'})
- Panels should look like they are physically mounted on the wall
- Match the perspective of the room
- Colors should complement the ${analysis.wallColor || 'existing'} wall
- Keep ALL other elements of the room exactly as they are`;

    const response = await openai.images.edit({
      model: "gpt-image-1",
      image: resizedOriginal,
      mask: maskBuffer,
      prompt: editPrompt,
      n: 1,
      size: "1024x1024",
    });

    console.log(`[ProcessDesign] Received AI edit response`);

    const b64_json = response.data[0].b64_json;
    
    if (!b64_json) {
      throw new Error("No image in response");
    }

    // Extract panel regions from AI result and composite onto ORIGINAL image
    const editedBuffer = Buffer.from(b64_json, "base64");
    
    // Extract the inner region from the letterboxed AI result
    const editedInner = await sharp(editedBuffer)
      .extract({ left: offsetX, top: offsetY, width: innerWidth, height: innerHeight })
      .png()
      .toBuffer();

    // For each panel position, extract that region from the AI result
    // and composite it onto the original image
    const panelOverlays: sharp.OverlayOptions[] = [];
    
    for (const panel of analysis.panels) {
      // Panel position in the inner (letterboxed) coordinate space
      const panelW = Math.round((panel.width / 100) * innerWidth);
      const panelH = Math.round((panel.height / 100) * innerHeight);
      const panelX = Math.round((panel.x / 100) * innerWidth - panelW / 2);
      const panelY = Math.round((panel.y / 100) * innerHeight - panelH / 2);
      
      // Skip invalid panels
      if (panelX < 0 || panelY < 0 || panelX + panelW > innerWidth || panelY + panelH > innerHeight) {
        continue;
      }
      
      try {
        // Extract this panel region from the AI-edited image
        const panelRegion = await sharp(editedInner)
          .extract({ left: panelX, top: panelY, width: panelW, height: panelH })
          .png()
          .toBuffer();
        
        // Scale panel position back to original image dimensions
        const origPanelX = Math.round((panelX / innerWidth) * origWidth);
        const origPanelY = Math.round((panelY / innerHeight) * origHeight);
        const origPanelW = Math.round((panelW / innerWidth) * origWidth);
        const origPanelH = Math.round((panelH / innerHeight) * origHeight);
        
        // Resize the extracted panel to original scale
        const scaledPanel = await sharp(panelRegion)
          .resize(origPanelW, origPanelH, { fit: "fill" })
          .png()
          .toBuffer();
        
        panelOverlays.push({
          input: scaledPanel,
          left: origPanelX,
          top: origPanelY,
        });
      } catch (extractError) {
        console.log(`[ProcessDesign] Could not extract panel region, skipping`);
      }
    }

    // Verify we have panel overlays before marking as complete
    if (panelOverlays.length === 0) {
      console.error(`[ProcessDesign] No panels extracted from AI result`);
      throw new Error("Failed to extract any panels from AI-generated image");
    }
    
    console.log(`[ProcessDesign] Extracted ${panelOverlays.length} panels from AI result`);

    // Composite panel regions onto the ORIGINAL untouched image
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

// Create a default panel layout
function createDefaultLayout(count: 3 | 5 | 10) {
  const panels: PanelPosition[] = [];
  
  if (count === 3) {
    panels.push(
      { x: 35, y: 40, width: 8, height: 16 },
      { x: 50, y: 45, width: 10, height: 10 },
      { x: 65, y: 42, width: 9, height: 12 }
    );
  } else if (count === 5) {
    panels.push(
      { x: 30, y: 35, width: 8, height: 18 },
      { x: 42, y: 45, width: 9, height: 9 },
      { x: 55, y: 38, width: 10, height: 14 },
      { x: 67, y: 48, width: 8, height: 12 },
      { x: 78, y: 40, width: 7, height: 16 }
    );
  } else {
    panels.push(
      { x: 20, y: 30, width: 7, height: 14 },
      { x: 30, y: 45, width: 8, height: 8 },
      { x: 38, y: 32, width: 6, height: 12 },
      { x: 48, y: 50, width: 9, height: 10 },
      { x: 50, y: 35, width: 7, height: 16 },
      { x: 60, y: 42, width: 8, height: 8 },
      { x: 68, y: 30, width: 6, height: 14 },
      { x: 72, y: 48, width: 7, height: 10 },
      { x: 80, y: 36, width: 8, height: 12 },
      { x: 85, y: 50, width: 6, height: 8 }
    );
  }

  return {
    panelCount: count,
    wallBounds: { x: 15, y: 20, width: 70, height: 60 },
    panels,
    wallColor: "white",
    lightingDirection: "above"
  };
}
