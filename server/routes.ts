
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

    // Step 1: Analyze wall and get creative layout recommendations from GPT-4o Vision
    console.log(`[ProcessDesign] Analyzing wall with GPT-4o Vision...`);
    
    // Load panel set images for vision analysis
    const panel3Path = path.join(process.cwd(), "client", "public", "panels-3.png");
    const panel5Path = path.join(process.cwd(), "client", "public", "panels-5.png");
    const panel10Path = path.join(process.cwd(), "client", "public", "panels-10.png");
    
    const panel3Base64 = fs.readFileSync(panel3Path).toString("base64");
    const panel5Base64 = fs.readFileSync(panel5Path).toString("base64");
    const panel10Base64 = fs.readFileSync(panel10Path).toString("base64");

    const analysisResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are an interior design expert. I'm showing you:
1. A room photo with a wall where I want to hang acoustic sound panels
2. Three reference images showing acoustic panel sets (3, 5, and 10 panels)

Analyze the room and determine:
1. Which panel set (3, 5, or 10) is most appropriate based on the wall size
2. A creative, aesthetically pleasing arrangement for the individual panels on the wall

The panels in the reference images are approximately 1-foot wide felt acoustic panels in various shapes (rectangles and squares) and colors.

Respond with JSON only:
{
  "panelCount": 3 | 5 | 10,
  "layoutDescription": "A detailed description of how to arrange the panels on the wall, including relative positions, spacing, and artistic considerations like asymmetric balance, visual flow, etc.",
  "wallColor": "The approximate color of the wall",
  "roomStyle": "The overall style of the room (modern, traditional, minimalist, etc.)",
  "confidence": 0-1
}`
            },
            {
              type: "image_url",
              image_url: { url: imageUrl, detail: "high" }
            },
            {
              type: "text",
              text: "Panel Set 1 - 3 panels:"
            },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${panel3Base64}`, detail: "low" }
            },
            {
              type: "text",
              text: "Panel Set 2 - 5 panels:"
            },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${panel5Base64}`, detail: "low" }
            },
            {
              type: "text",
              text: "Panel Set 3 - 10 panels:"
            },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${panel10Base64}`, detail: "low" }
            }
          ]
        }
      ],
      max_tokens: 1000,
    });

    const analysisText = analysisResponse.choices[0]?.message?.content || "";
    console.log(`[ProcessDesign] Wall analysis result: ${analysisText}`);

    // Parse the analysis
    let analysis: { 
      panelCount: 3 | 5 | 10;
      layoutDescription: string;
      wallColor: string;
      roomStyle: string;
    };
    
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      analysis = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.log(`[ProcessDesign] Could not parse analysis, defaulting to 5 panels`);
      analysis = { 
        panelCount: 5, 
        layoutDescription: "Arrange panels in an asymmetric gallery-style layout centered on the wall",
        wallColor: "white",
        roomStyle: "modern"
      };
    }

    // Select the appropriate panel set
    const panelSetKey = analysis.panelCount === 3 ? "small" : analysis.panelCount === 10 ? "large" : "medium";
    const panelSet = PANEL_SETS[panelSetKey];
    console.log(`[ProcessDesign] Selected: ${panelSet.name} for ${analysis.roomStyle} room`);

    // Step 2: Use gpt-image-1 to edit the image and add panels realistically
    console.log(`[ProcessDesign] Generating photorealistic panel arrangement...`);

    // Get the panel reference image
    const panelRefPath = path.join(process.cwd(), "client", "public", panelSet.file);
    const panelRefBuffer = fs.readFileSync(panelRefPath);
    
    // Create an edit prompt that describes exactly what we want
    const editPrompt = `Edit this room photo to add ${panelSet.count} acoustic felt sound panels hanging on the main wall. 

Panel Details: ${panelSet.description}

Layout Guidance: ${analysis.layoutDescription}

IMPORTANT REQUIREMENTS:
- The panels must look like they are ACTUALLY HANGING on the wall with proper perspective
- Add subtle shadows beneath each panel to make them look 3D and realistic
- The panels should have a soft felt/fabric texture
- Maintain proper scale - each panel is approximately 1 foot wide
- Match the lighting and color temperature of the room
- Keep all other elements of the room EXACTLY as they are
- The arrangement should be aesthetically pleasing with intentional asymmetric balance
- Panels should be spaced appropriately, not touching each other

Room context: ${analysis.roomStyle} style room with ${analysis.wallColor} walls.`;

    console.log(`[ProcessDesign] Edit prompt: ${editPrompt.substring(0, 200)}...`);

    // Resize image to supported dimensions for gpt-image-1 (max 1024x1024 for square)
    const resizedBuffer = await sharp(originalBuffer)
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();

    const response = await openai.images.edit({
      model: "gpt-image-1",
      image: resizedBuffer,
      prompt: editPrompt,
      n: 1,
      size: "1024x1024",
    });

    console.log(`[ProcessDesign] Received response from OpenAI image edit`);

    // Get the result
    const b64_json = response.data[0].b64_json;
    const generatedUrl = b64_json ? `data:image/png;base64,${b64_json}` : response.data[0].url;

    if (generatedUrl) {
      console.log(`[ProcessDesign] Successfully generated panel arrangement for design ${designId}`);
      await storage.updateDesignStatus(designId, "completed", generatedUrl);
    } else {
      console.error(`[ProcessDesign] No image in response for design ${designId}`);
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
