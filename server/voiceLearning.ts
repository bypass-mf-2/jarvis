/**
 * Voice Learning System
 * 
 * Learns Trevor's writing style by analyzing his messages and creating
 * a personalized system prompt for writing tasks.
 */

import { db, getMessagesByRole } from "./db.js";
import { ollamaChat } from "./ollama.js";
import { logger } from "./logger.js";
import * as fs from "fs";
import * as path from "path";

const VOICE_PROFILE_PATH = path.join(process.cwd(), "trevor-voice-profile.json");

interface VoiceProfile {
  writingStyle: string;
  commonPhrases: string[];
  sentencePatterns: string[];
  vocabulary: string[];
  tone: string;
  perspective: string;
  examples: string[];
  lastUpdated: Date;
}

// ── Analyze Trevor's Writing ────────────────────────────────────────────────
export async function analyzeWritingStyle(limit = 100): Promise<VoiceProfile> {
  await logger.info("voiceLearning", "Analyzing Trevor's writing style...");

  // Get Trevor's messages (user messages)
  const messages = await getMessagesByRole("user", limit);
  
  if (messages.length < 10) {
    throw new Error("Need at least 10 messages to analyze writing style");
  }

  const userText = messages.map((m: any) => m.content).join("\n\n");

  // Use LLM to analyze writing style
  const analysisPrompt = `Analyze this person's writing style and create a detailed profile:

${userText.slice(0, 10000)}

Create a JSON profile with:
{
  "writingStyle": "Detailed description of their writing style",
  "commonPhrases": ["phrase1", "phrase2", ...],
  "sentencePatterns": ["pattern1", "pattern2", ...],
  "vocabulary": ["distinctive word1", "word2", ...],
  "tone": "Their typical tone (casual/formal/technical/etc)",
  "perspective": "How they approach topics",
  "examples": ["Example sentence 1", "Example 2", ...]
}

Focus on:
- Sentence structure preferences
- Common expressions
- Technical level
- Formality
- Unique voice markers
- Perspective and worldview

Return ONLY the JSON, no other text.`;

  const response = await ollamaChat([
    { role: "user", content: analysisPrompt }
  ]);

  // Extract JSON
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to parse writing style analysis");
  }

  const profile: VoiceProfile = {
    ...JSON.parse(jsonMatch[0]),
    lastUpdated: new Date(),
  };

  // Save profile
  fs.writeFileSync(VOICE_PROFILE_PATH, JSON.stringify(profile, null, 2));
  await logger.info("voiceLearning", "Voice profile saved");

  return profile;
}

// ── Load Voice Profile ─────────────────────────────────────────────────────
export function loadVoiceProfile(): VoiceProfile | null {
  if (!fs.existsSync(VOICE_PROFILE_PATH)) {
    return null;
  }
  
  try {
    const data = fs.readFileSync(VOICE_PROFILE_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// ── Generate Writing Prompt ────────────────────────────────────────────────
export function getVoiceSystemPrompt(task?: string): string {
  const profile = loadVoiceProfile();
  
  if (!profile) {
    return "Write in a clear, engaging style.";
  }

  const prompt = `You are writing in Trevor's voice. Match his writing style exactly:

WRITING STYLE: ${profile.writingStyle}

TONE: ${profile.tone}

PERSPECTIVE: ${profile.perspective}

COMMON PHRASES TO USE:
${profile.commonPhrases.slice(0, 10).map(p => `- "${p}"`).join("\n")}

SENTENCE PATTERNS:
${profile.sentencePatterns.slice(0, 5).join("\n")}

VOCABULARY PREFERENCES:
${profile.vocabulary.slice(0, 20).join(", ")}

EXAMPLES OF TREVOR'S WRITING:
${profile.examples.slice(0, 3).map((ex, i) => `${i + 1}. "${ex}"`).join("\n")}

${task ? `\nTASK: ${task}` : ""}

Write EXACTLY as Trevor would. Use his phrases, sentence structures, tone, and perspective. Sound like him, not like a generic AI.`;

  return prompt;
}

// ── Write in Trevor's Voice ────────────────────────────────────────────────
export async function writeInTrevorsVoice(
  topic: string,
  length: "short" | "medium" | "long" = "medium",
  type: "essay" | "story" | "analysis" | "chapter" = "essay"
): Promise<string> {
  const profile = loadVoiceProfile();
  
  if (!profile) {
    throw new Error("No voice profile found. Run analyzeWritingStyle() first.");
  }

  const lengthGuide = {
    short: "2-3 paragraphs",
    medium: "5-7 paragraphs",
    long: "10-15 paragraphs or more",
  };

  const systemPrompt = getVoiceSystemPrompt(
    `Write a ${type} about: ${topic}. Length: ${lengthGuide[length]}.`
  );

  const response = await ollamaChat([
    { role: "system", content: systemPrompt },
    { role: "user", content: `Write about: ${topic}` },
  ]);

  return response;
}

// ── Scheduled Updates ──────────────────────────────────────────────────────
let voiceLearningInterval: ReturnType<typeof setInterval> | null = null;

export function startVoiceLearning(intervalMs = 24 * 60 * 60 * 1000): void {
  if (voiceLearningInterval) return;
  
  logger.info("voiceLearning", "Voice learning scheduler started (updates daily)");
  
  // Initial analysis after 1 hour
  setTimeout(() => {
    analyzeWritingStyle().catch(err => 
      logger.error("voiceLearning", `Analysis failed: ${err}`)
    );
  }, 60 * 60 * 1000);
  
  // Then daily updates
  voiceLearningInterval = setInterval(() => {
    analyzeWritingStyle().catch(err => 
      logger.error("voiceLearning", `Analysis failed: ${err}`)
    );
  }, intervalMs);
}

export function stopVoiceLearning(): void {
  if (voiceLearningInterval) {
    clearInterval(voiceLearningInterval);
    voiceLearningInterval = null;
    logger.info("voiceLearning", "Voice learning stopped");
  }
}