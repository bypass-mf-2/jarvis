/**
 * Image Generation System
 * 
 * Supports:
 * - DALL-E 3 (OpenAI API) - Best quality, costs $0.04/image
 * - Stable Diffusion (Local) - Free, runs on your GPU
 * - Automatic1111 SD WebUI - If you have it running
 * 
 * JARVIS can generate images from text descriptions
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger.js";

const OUTPUT_DIR = path.join(process.cwd(), "generated-images");

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ── DALL-E 3 (OpenAI) ───────────────────────────────────────────────────────
export async function generateImageDALLE(
  prompt: string,
  size: "1024x1024" | "1792x1024" | "1024x1792" = "1024x1024",
  quality: "standard" | "hd" = "standard"
): Promise<string> {
  await logger.info("imageGen", `Generating image with DALL-E: "${prompt.slice(0, 50)}..."`);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set in environment");
  }

  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt,
        n: 1,
        size,
        quality,
        response_format: "url",
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`DALL-E API error: ${JSON.stringify(error)}`);
    }

    const data = await response.json();
    const imageUrl = data.data[0].url;

    // Download and save image
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    
    const filename = `dalle-${Date.now()}.png`;
    const filepath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(filepath, imageBuffer);

    await logger.info("imageGen", `Image saved: ${filename}`);

    return filepath;

  } catch (err) {
    await logger.error("imageGen", `DALL-E generation failed: ${err}`);
    throw err;
  }
}

// ── Stable Diffusion (Local via Automatic1111) ─────────────────────────────
export async function generateImageStableDiffusion(
  prompt: string,
  negativePrompt = "ugly, deformed, blurry, low quality",
  steps = 30,
  width = 512,
  height = 512
): Promise<string> {
  await logger.info("imageGen", `Generating image with Stable Diffusion: "${prompt.slice(0, 50)}..."`);

  // Assumes Automatic1111 WebUI running on localhost:7860
  const sdUrl = process.env.SD_WEBUI_URL || "http://localhost:7860";

  try {
    const response = await fetch(`${sdUrl}/sdapi/v1/txt2img`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        negative_prompt: negativePrompt,
        steps,
        width,
        height,
        cfg_scale: 7,
        sampler_name: "DPM++ 2M Karras",
        save_images: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`SD API returned ${response.status}`);
    }

    const data = await response.json();
    const base64Image = data.images[0];

    // Save image
    const imageBuffer = Buffer.from(base64Image, "base64");
    const filename = `sd-${Date.now()}.png`;
    const filepath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(filepath, imageBuffer);

    await logger.info("imageGen", `Image saved: ${filename}`);

    return filepath;

  } catch (err) {
    await logger.error("imageGen", `Stable Diffusion generation failed: ${err}`);
    throw err;
  }
}

// ── Automatic Provider Selection ───────────────────────────────────────────
export async function generateImage(
  prompt: string,
  preferLocal = true
): Promise<{ filepath: string; provider: string }> {
  // Try local SD first if preferred
  if (preferLocal) {
    try {
      const sdUrl = process.env.SD_WEBUI_URL || "http://localhost:7860";
      const healthCheck = await fetch(`${sdUrl}/sdapi/v1/sd-models`, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      
      if (healthCheck.ok) {
        const filepath = await generateImageStableDiffusion(prompt);
        return { filepath, provider: "stable-diffusion" };
      }
    } catch {
      await logger.warn("imageGen", "Local SD not available, falling back to DALL-E");
    }
  }

  // Fall back to DALL-E
  if (process.env.OPENAI_API_KEY) {
    const filepath = await generateImageDALLE(prompt);
    return { filepath, provider: "dall-e-3" };
  }

  throw new Error("No image generation provider available. Set up SD WebUI or add OPENAI_API_KEY");
}

// ── Image Variation (DALL-E only) ──────────────────────────────────────────
export async function createImageVariation(
  imagePath: string,
  n = 1
): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY required for variations");
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const formData = new FormData();
  formData.append("image", new Blob([imageBuffer]), "image.png");
  formData.append("n", n.toString());
  formData.append("size", "1024x1024");

  const response = await fetch("https://api.openai.com/v1/images/variations", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}` },
    body: formData,
  });

  const data = await response.json();
  const filepaths: string[] = [];

  for (let i = 0; i < data.data.length; i++) {
    const imageUrl = data.data[i].url;
    const imageResponse = await fetch(imageUrl);
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    
    const filename = `variation-${Date.now()}-${i}.png`;
    const filepath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(filepath, buffer);
    filepaths.push(filepath);
  }

  return filepaths;
}

// ── Image Editing (Inpainting) ─────────────────────────────────────────────
export async function editImage(
  imagePath: string,
  maskPath: string,
  prompt: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY required for image editing");
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const maskBuffer = fs.readFileSync(maskPath);

  const formData = new FormData();
  formData.append("image", new Blob([imageBuffer]), "image.png");
  formData.append("mask", new Blob([maskBuffer]), "mask.png");
  formData.append("prompt", prompt);
  formData.append("n", "1");
  formData.append("size", "1024x1024");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}` },
    body: formData,
  });

  const data = await response.json();
  const imageUrl = data.data[0].url;
  
  const imageResponse = await fetch(imageUrl);
  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  
  const filename = `edited-${Date.now()}.png`;
  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, buffer);

  return filepath;
}
