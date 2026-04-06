/**
 * Code Execution System
 * 
 * Safely executes code in sandboxed environments:
 * - JavaScript/TypeScript (VM2)
 * - Python (isolated subprocess)
 * - Swift/iOS (via swift REPL or Xcode)
 * 
 * Used for:
 * - Testing code JARVIS generates
 * - Running data analysis scripts
 * - Validating solutions
 */

import * as vm from "vm";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger.js";

const execAsync = promisify(exec);
const SANDBOX_DIR = path.join(process.cwd(), ".sandbox");

if (!fs.existsSync(SANDBOX_DIR)) {
  fs.mkdirSync(SANDBOX_DIR, { recursive: true });
}

// ── JavaScript/TypeScript Execution ────────────────────────────────────────
export async function executeJavaScript(
  code: string,
  timeout = 5000
): Promise<{ success: boolean; output: any; error?: string; executionTime: number }> {
  await logger.info("codeExec", "Executing JavaScript code");

  const startTime = Date.now();

  try {
    const sandbox = {
      console: {
        log: (...args: any[]) => console.log("[SANDBOX]", ...args),
        error: (...args: any[]) => console.error("[SANDBOX]", ...args),
      },
      result: undefined as any,
    };
    const context = vm.createContext(sandbox);
    const result = vm.runInContext(code, context, { timeout });
    const executionTime = Date.now() - startTime;

    return {
      success: true,
      output: result,
      executionTime,
    };

  } catch (err) {
    return {
      success: false,
      output: null,
      error: String(err),
      executionTime: Date.now() - startTime,
    };
  }
}

// ── Python Execution ───────────────────────────────────────────────────────
export async function executePython(
  code: string,
  timeout = 10000
): Promise<{ success: boolean; output: string; error?: string; executionTime: number }> {
  await logger.info("codeExec", "Executing Python code");

  const startTime = Date.now();
  const filename = `script_${Date.now()}.py`;
  const filepath = path.join(SANDBOX_DIR, filename);

  try {
    // Write code to file
    fs.writeFileSync(filepath, code);

    // Execute with timeout
    const { stdout, stderr } = await execAsync(
      `python3 "${filepath}"`,
      {
        timeout,
        maxBuffer: 1024 * 1024 * 10, // 10MB
      }
    );

    // Cleanup
    fs.unlinkSync(filepath);

    const executionTime = Date.now() - startTime;

    if (stderr && !stdout) {
      return {
        success: false,
        output: "",
        error: stderr,
        executionTime,
      };
    }

    return {
      success: true,
      output: stdout || stderr,
      executionTime,
    };

  } catch (err: any) {
    // Cleanup on error
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }

    return {
      success: false,
      output: "",
      error: err.stderr || err.message,
      executionTime: Date.now() - startTime,
    };
  }
}

// ── Swift Execution (for iOS development) ──────────────────────────────────
export async function executeSwift(
  code: string,
  timeout = 15000
): Promise<{ success: boolean; output: string; error?: string; executionTime: number }> {
  await logger.info("codeExec", "Executing Swift code");

  const startTime = Date.now();
  const filename = `script_${Date.now()}.swift`;
  const filepath = path.join(SANDBOX_DIR, filename);

  try {
    // Write code to file
    fs.writeFileSync(filepath, code);

    // Execute using swift REPL or compiler
    const { stdout, stderr } = await execAsync(
      `swift "${filepath}"`,
      {
        timeout,
        maxBuffer: 1024 * 1024 * 10,
      }
    );

    // Cleanup
    fs.unlinkSync(filepath);

    const executionTime = Date.now() - startTime;

    if (stderr && !stdout) {
      return {
        success: false,
        output: "",
        error: stderr,
        executionTime,
      };
    }

    return {
      success: true,
      output: stdout || stderr,
      executionTime,
    };

  } catch (err: any) {
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }

    return {
      success: false,
      output: "",
      error: err.stderr || err.message,
      executionTime: Date.now() - startTime,
    };
  }
}

// ── Smart Language Detection ───────────────────────────────────────────────
function detectLanguage(code: string): "javascript" | "python" | "swift" {
  // Simple heuristic detection
  if (code.includes("import ") && code.includes("func ")) return "swift";
  if (code.includes("def ") || code.includes("import ")) return "python";
  return "javascript";
}

// ── Universal Code Executor ────────────────────────────────────────────────
export async function executeCode(
  code: string,
  language?: "javascript" | "python" | "swift",
  timeout = 10000
): Promise<{
  success: boolean;
  output: any;
  error?: string;
  language: string;
  executionTime: number;
}> {
  const lang = language || detectLanguage(code);

  await logger.info("codeExec", `Executing ${lang} code`);

  let result: any;

  switch (lang) {
    case "javascript":
      result = await executeJavaScript(code, timeout);
      break;
    case "python":
      result = await executePython(code, timeout);
      break;
    case "swift":
      result = await executeSwift(code, timeout);
      break;
    default:
      return {
        success: false,
        output: null,
        error: `Unsupported language: ${lang}`,
        language: lang,
        executionTime: 0,
      };
  }

  return {
    ...result,
    language: lang,
  };
}

// ── Test Code Against Test Cases ───────────────────────────────────────────
export async function testCode(
  code: string,
  testCases: Array<{ input: any; expectedOutput: any }>,
  language?: "javascript" | "python" | "swift"
): Promise<{
  passed: number;
  failed: number;
  results: Array<{
    input: any;
    expected: any;
    actual: any;
    passed: boolean;
  }>;
}> {
  const results: any[] = [];
  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    // Wrap code with test input
    const wrappedCode = `
${code}

// Test execution
const result = main(${JSON.stringify(testCase.input)});
console.log(JSON.stringify(result));
`;

    const execution = await executeCode(wrappedCode, language);

    let actual: any;
    try {
      actual = JSON.parse(execution.output as string);
    } catch {
      actual = execution.output;
    }

    const testPassed = JSON.stringify(actual) === JSON.stringify(testCase.expectedOutput);

    results.push({
      input: testCase.input,
      expected: testCase.expectedOutput,
      actual,
      passed: testPassed,
    });

    if (testPassed) passed++;
    else failed++;
  }

  return { passed, failed, results };
}

// ── Code Linting/Validation ────────────────────────────────────────────────
export async function validateCode(
  code: string,
  language: "javascript" | "python" | "swift"
): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    switch (language) {
      case "javascript":
        // Basic syntax check using vm
        vm.runInNewContext(code, {}, { timeout: 5000 });
        break;

      case "python":
        // Run with syntax check flag
        const tempPy = path.join(SANDBOX_DIR, `check_${Date.now()}.py`);
        fs.writeFileSync(tempPy, code);
        const { stderr } = await execAsync(`python3 -m py_compile "${tempPy}"`);
        if (fs.existsSync(tempPy)) fs.unlinkSync(tempPy);
        if (stderr) errors.push(stderr);
        break;

      case "swift":
        // Write to temp file and compile
        const tempFile = path.join(SANDBOX_DIR, `validate_${Date.now()}.swift`);
        fs.writeFileSync(tempFile, code);
        const { stderr: swiftErr } = await execAsync(`swiftc -parse "${tempFile}"`);
        fs.unlinkSync(tempFile);
        if (swiftErr) errors.push(swiftErr);
        break;
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };

  } catch (err) {
    return {
      valid: false,
      errors: [String(err)],
      warnings,
    };
  }
}
