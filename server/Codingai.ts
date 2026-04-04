/**
 * Coding Specialization System
 * 
 * Trains JARVIS to be an expert coder:
 * - Uses CodeLLaMA (specialized for coding)
 * - Fine-tunes on Trevor's code style
 * - Specialized knowledge for iOS/Swift development
 * - Understands computer science concepts deeply
 * 
 * Models Available:
 * - codellama:7b - Base coding model
 * - codellama:13b - Better quality
 * - codellama:34b - Best quality (needs more VRAM)
 * - codellama:7b-instruct - Instruction-following
 * - codellama:7b-python - Python specialist
 */

import * as fs from "fs";
import * as path from "path";
import { ollamaChat } from "./ollama.js";
import { logger } from "./logger.js";

// ── Pull CodeLLaMA Models ──────────────────────────────────────────────────
export async function setupCodingModels(): Promise<void> {
  await logger.info("codingAI", "Setting up coding models...");

  const { exec } = require("child_process");
  const { promisify } = require("util");
  const execAsync = promisify(exec);

  const models = [
    "codellama:7b-instruct",     // Best for code generation
    "codellama:7b-python",       // Python specialist
    "deepseek-coder:6.7b",       // Alternative, very good
  ];

  for (const model of models) {
    try {
      console.log(`📥 Pulling ${model}...`);
      await execAsync(`ollama pull ${model}`);
      console.log(`✅ ${model} ready`);
    } catch (err) {
      console.error(`❌ Failed to pull ${model}:`, err);
    }
  }

  await logger.info("codingAI", "Coding models ready");
}

// ── iOS/Swift Knowledge Base ───────────────────────────────────────────────
const IOS_SWIFT_KNOWLEDGE = `
# iOS Development with Swift - Complete Knowledge Base

## Swift Language Fundamentals
- Value types (structs, enums) vs Reference types (classes)
- Optionals and nil safety
- Protocol-oriented programming
- Generics and type constraints
- Property wrappers (@State, @Binding, @Published)
- Concurrency (async/await, actors)
- Memory management (ARC)

## SwiftUI Framework
- Declarative UI syntax
- View composition and modifiers
- State management (@State, @StateObject, @ObservedObject, @EnvironmentObject)
- Navigation (NavigationStack, NavigationLink)
- Lists and ForEach
- Animations and transitions
- Gestures
- Custom views and view builders

## UIKit (Legacy but still used)
- View controllers lifecycle
- Auto Layout and constraints
- Delegates and protocols
- Table views and collection views
- Navigation controllers
- Storyboards vs programmatic UI

## iOS Architecture Patterns
- MVVM (Model-View-ViewModel)
- MVC (Model-View-Controller)
- VIPER (View-Interactor-Presenter-Entity-Router)
- Coordinators for navigation
- Dependency injection

## Data Persistence
- UserDefaults for simple data
- CoreData for complex data
- SwiftData (modern replacement for CoreData)
- FileManager for file operations
- Keychain for sensitive data
- CloudKit for cloud sync

## Networking
- URLSession for HTTP requests
- Codable for JSON parsing
- Async/await networking
- Combine framework for reactive programming
- Error handling

## Common iOS APIs
- Location (CoreLocation)
- Camera (AVFoundation)
- Photos (PhotoKit)
- Notifications (UserNotifications)
- HealthKit
- MapKit
- WebKit

## App Lifecycle
- SceneDelegate and AppDelegate
- State transitions (active, inactive, background)
- App termination handling
- Scene-based lifecycle (iOS 13+)

## Testing
- XCTest framework
- Unit testing
- UI testing
- Test-driven development (TDD)

## Best Practices
- Follow Apple's Human Interface Guidelines
- Use SF Symbols for icons
- Support dark mode
- Handle different device sizes
- Accessibility (VoiceOver, Dynamic Type)
- Localization for multiple languages
`;

// ── Generate Coding System Prompt ─────────────────────────────────────────
export function getCodingSystemPrompt(
  language?: "swift" | "python" | "javascript" | "typescript",
  includeIOS = false
): string {
  let prompt = `You are an expert software engineer specializing in clean, efficient, production-quality code.

CORE PRINCIPLES:
- Write clear, readable code with meaningful variable names
- Follow language-specific best practices and idioms
- Include proper error handling
- Add comments for complex logic
- Prefer simple solutions over clever ones
- Consider edge cases
- Write testable code

CODE STYLE:
- Use consistent formatting
- Keep functions focused and small
- Avoid premature optimization
- Follow DRY (Don't Repeat Yourself)
- Use modern language features appropriately
`;

  // Language-specific additions
  if (language === "swift" || includeIOS) {
    prompt += `\n${IOS_SWIFT_KNOWLEDGE}

SWIFT-SPECIFIC:
- Use optionals safely with guard let or if let
- Prefer structs over classes when appropriate
- Use protocol extensions for code reuse
- Leverage Swift's type system for safety
- Use SwiftUI for modern UI development
- Follow Apple's Swift API design guidelines
`;
  }

  if (language === "python") {
    prompt += `
PYTHON-SPECIFIC:
- Follow PEP 8 style guide
- Use type hints for better code clarity
- Leverage list/dict comprehensions appropriately
- Use context managers (with statements)
- Prefer f-strings for formatting
- Use dataclasses or Pydantic for data models
`;
  }

  if (language === "javascript" || language === "typescript") {
    prompt += `
JAVASCRIPT/TYPESCRIPT:
- Use modern ES6+ features (const/let, arrow functions, destructuring)
- Prefer async/await over callbacks
- Use TypeScript for type safety
- Follow functional programming principles where appropriate
- Avoid var, use const by default
- Use optional chaining (?.) and nullish coalescing (??)
`;
  }

  return prompt;
}

// ── Code Generation with Specialized Models ────────────────────────────────
export async function generateCode(
  task: string,
  language: "swift" | "python" | "javascript" | "typescript" | "java" | "cpp",
  includeTests = false
): Promise<{ code: string; tests?: string; explanation: string }> {
  await logger.info("codingAI", `Generating ${language} code for: ${task}`);

  // Select best model for the task
  let model = "codellama:7b-instruct";
  if (language === "python") model = "codellama:7b-python";
  if (language === "swift") model = "codellama:7b-instruct"; // Use instruct for Swift

  const systemPrompt = getCodingSystemPrompt(language, language === "swift");

  const userPrompt = `Task: ${task}

Generate clean, production-quality ${language} code that solves this task.

${includeTests ? `Also generate comprehensive tests.` : ""}

Format your response as:
\`\`\`${language}
// Your code here
\`\`\`

${includeTests ? `\n\`\`\`${language}\n// Tests here\n\`\`\`\n` : ""}

Explanation: Brief explanation of the solution.`;

  try {
    const response = await ollamaChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      model
    );

    // Extract code blocks
    const codeMatches = response.match(/```(?:\w+)?\n([\s\S]*?)```/g);
    
    let code = "";
    let tests = "";
    let explanation = "";

    if (codeMatches && codeMatches.length > 0) {
      code = codeMatches[0].replace(/```(?:\w+)?\n/, "").replace(/```$/, "");
      
      if (codeMatches.length > 1 && includeTests) {
        tests = codeMatches[1].replace(/```(?:\w+)?\n/, "").replace(/```$/, "");
      }
    }

    // Extract explanation
    const explanationMatch = response.match(/Explanation:([\s\S]*?)(?:```|$)/);
    if (explanationMatch) {
      explanation = explanationMatch[1].trim();
    } else {
      explanation = response;
    }

    return { code, tests, explanation };

  } catch (err) {
    await logger.error("codingAI", `Code generation failed: ${err}`);
    throw err;
  }
}

// ── Code Review and Suggestions ────────────────────────────────────────────
export async function reviewCode(
  code: string,
  language: "swift" | "python" | "javascript" | "typescript"
): Promise<{
  issues: Array<{ severity: "error" | "warning" | "info"; message: string; line?: number }>;
  suggestions: string[];
  score: number; // 0-100
}> {
  const systemPrompt = getCodingSystemPrompt(language);

  const prompt = `Review this ${language} code and provide:

1. Issues (errors, warnings, info)
2. Improvement suggestions
3. Quality score (0-100)

Code:
\`\`\`${language}
${code}
\`\`\`

Return as JSON:
{
  "issues": [
    {"severity": "error|warning|info", "message": "...", "line": 10}
  ],
  "suggestions": ["suggestion 1", "suggestion 2"],
  "score": 85
}`;

  const response = await ollamaChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    "codellama:7b-instruct"
  );

  // Parse JSON
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return {
        issues: [],
        suggestions: ["Failed to parse review"],
        score: 50,
      };
    }
  }

  return {
    issues: [],
    suggestions: [response],
    score: 50,
  };
}

// ── Explain Code ───────────────────────────────────────────────────────────
export async function explainCode(
  code: string,
  language: string
): Promise<string> {
  const prompt = `Explain this ${language} code in detail:

\`\`\`${language}
${code}
\`\`\`

Include:
- What it does (high-level)
- How it works (step-by-step)
- Key concepts used
- Potential improvements`;

  const response = await ollamaChat(
    [{ role: "user", content: prompt }],
    "codellama:7b-instruct"
  );

  return response;
}

// ── Fix Code Bugs ──────────────────────────────────────────────────────────
export async function fixCode(
  code: string,
  error: string,
  language: string
): Promise<{ fixedCode: string; explanation: string }> {
  const systemPrompt = getCodingSystemPrompt(language as any);

  const prompt = `This ${language} code has an error:

\`\`\`${language}
${code}
\`\`\`

Error: ${error}

Fix the code and explain what was wrong.

Format:
\`\`\`${language}
// Fixed code
\`\`\`

Explanation: What was wrong and how it's fixed.`;

  const response = await ollamaChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    "codellama:7b-instruct"
  );

  const codeMatch = response.match(/```(?:\w+)?\n([\s\S]*?)```/);
  const explanationMatch = response.match(/Explanation:([\s\S]*?)$/);

  return {
    fixedCode: codeMatch ? codeMatch[1] : code,
    explanation: explanationMatch ? explanationMatch[1].trim() : response,
  };
}

// ── Convert Between Languages ──────────────────────────────────────────────
export async function convertCode(
  code: string,
  fromLanguage: string,
  toLanguage: string
): Promise<string> {
  const prompt = `Convert this ${fromLanguage} code to ${toLanguage}:

\`\`\`${fromLanguage}
${code}
\`\`\`

Provide only the converted code in ${toLanguage}, maintaining the same functionality.`;

  const response = await ollamaChat(
    [{ role: "user", content: prompt }],
    "codellama:7b-instruct"
  );

  const codeMatch = response.match(/```(?:\w+)?\n([\s\S]*?)```/);
  return codeMatch ? codeMatch[1] : response;
}

// ── Initialize Coding AI ───────────────────────────────────────────────────
export async function initializeCodingAI(): Promise<void> {
  await logger.info("codingAI", "Initializing coding AI system");
  
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                   JARVIS Coding AI Setup                       ║
╚═══════════════════════════════════════════════════════════════╝

This will download specialized coding models:
- CodeLLaMA 7B Instruct (best for code generation)
- CodeLLaMA 7B Python (Python specialist)
- DeepSeek Coder 6.7B (alternative, high quality)

Total download size: ~15GB
This may take 10-30 minutes depending on your connection.

Continue? (Press Ctrl+C to cancel)
`);

  // Wait 5 seconds
  await new Promise(r => setTimeout(r, 5000));

  await setupCodingModels();

  console.log(`
✅ Coding AI ready!

You can now:
- Generate iOS/Swift apps
- Write Python scripts
- Review and fix code
- Convert between languages
- Get coding help 24/7

Try: "Generate a SwiftUI view for a todo list app"
  `);
}
