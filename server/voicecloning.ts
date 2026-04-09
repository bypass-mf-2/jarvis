/**
 * Voice Cloning System
 * 
 * Clones Trevor's voice using:
 * - ElevenLabs API (Best quality, realistic)
 * - Coqui TTS (Local, free but lower quality)
 * 
 * Can generate audio that sounds exactly like Trevor speaking
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger.js";

const OUTPUT_DIR = path.join(process.cwd(), "generated-audio");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ── ElevenLabs Voice Cloning ───────────────────────────────────────────────
// Load saved voice config from disk
function loadVoiceConfig(): { voiceId: string; stability: number; similarityBoost: number } {
  try {
    const configPath = path.join(process.cwd(), "voice-config.json");
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch {}
  return { voiceId: "21m00Tcm4TlvDq8ikWAM", stability: 0.5, similarityBoost: 0.75 };
}

export async function cloneVoiceElevenLabs(
  text: string,
  voiceId?: string // Custom voice ID if you've cloned your voice
): Promise<string> {
  await logger.info("voiceClone", `Generating speech: "${text.slice(0, 50)}..."`);

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY not set");
  }

  // Use provided voiceId, or saved config, or env var, or default
  const savedConfig = loadVoiceConfig();
  const voice = voiceId || process.env.TREVOR_VOICE_ID || savedConfig.voiceId;

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}`,
      {
        method: "POST",
        headers: {
          "Accept": "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_monolingual_v1",
          voice_settings: {
            stability: savedConfig.stability,
            similarity_boost: savedConfig.similarityBoost,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs API error: ${error}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const filename = `voice-${Date.now()}.mp3`;
    const filepath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(filepath, audioBuffer);

    await logger.info("voiceClone", `Audio saved: ${filename}`);
    return filepath;

  } catch (err) {
    await logger.error("voiceClone", `ElevenLabs generation failed: ${err}`);
    throw err;
  }
}

// ── Create Custom Voice (Upload samples to train) ──────────────────────────
export async function createCustomVoice(
  name: string,
  description: string,
  audioSamplePaths: string[] // Array of paths to Trevor's voice samples
): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY required");
  }

  if (audioSamplePaths.length < 3) {
    throw new Error("Need at least 3 audio samples (3-25 recommended)");
  }

  const formData = new FormData();
  formData.append("name", name);
  formData.append("description", description);

  // Add audio files
  for (const samplePath of audioSamplePaths) {
    const audioBuffer = fs.readFileSync(samplePath);
    formData.append("files", new Blob([audioBuffer]), path.basename(samplePath));
  }

  const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create voice: ${error}`);
  }

  const data = await response.json();
  const voiceId = data.voice_id;

  await logger.info("voiceClone", `Created custom voice: ${name} (ID: ${voiceId})`);
  
  // Save voice ID to env
  console.log(`\n✅ Voice created! Add to your .env file:`);
  console.log(`TREVOR_VOICE_ID=${voiceId}\n`);

  return voiceId;
}

// ── Local TTS (Coqui - Free but lower quality) ────────────────────────────
export async function generateSpeechLocal(
  text: string,
  model = "tts_models/en/ljspeech/tacotron2-DDC"
): Promise<string> {
  await logger.info("voiceClone", `Generating local TTS: "${text.slice(0, 50)}..."`);

  // Requires Coqui TTS installed: pip install TTS
  const { execSync } = require("child_process");
  
  const filename = `local-tts-${Date.now()}.wav`;
  const filepath = path.join(OUTPUT_DIR, filename);

  try {
    execSync(
      `tts --text "${text}" --model_name "${model}" --out_path "${filepath}"`,
      { stdio: "ignore" }
    );

    await logger.info("voiceClone", `Local TTS saved: ${filename}`);
    return filepath;

  } catch (err) {
    await logger.error("voiceClone", `Local TTS failed: ${err}`);
    throw new Error("Coqui TTS not installed. Run: pip install TTS");
  }
}

// ── Voice Analysis (Extract characteristics) ───────────────────────────────
export async function analyzeVoice(audioPath: string): Promise<{
  pitch: number;
  speed: number;
  tone: string;
}> {
  // This would use audio analysis libraries
  // For now, placeholder
  await logger.info("voiceClone", `Analyzing voice from: ${audioPath}`);
  
  return {
    pitch: 120, // Hz
    speed: 150, // words per minute
    tone: "confident, clear",
  };
}

// ── Smart Provider Selection ───────────────────────────────────────────────
export async function cloneTrevorsVoice(text: string): Promise<string> {
  // Try ElevenLabs first (best quality)
  if (process.env.ELEVENLABS_API_KEY) {
    try {
      return await cloneVoiceElevenLabs(text);
    } catch (err) {
      await logger.warn("voiceClone", `ElevenLabs failed, trying local: ${err}`);
    }
  }

  // Fall back to local TTS
  try {
    return await generateSpeechLocal(text);
  } catch {
    throw new Error("No voice generation available. Install Coqui TTS or add ELEVENLABS_API_KEY");
  }
}
