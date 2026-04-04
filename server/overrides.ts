// server/overrides.ts

export const OVERRIDE_MODES = {
  NORMAL: 0,      // Standard AI safety
  PERMISSIVE: 1,  // Reduced safety for Trevor
  COMMAND: 2,     // Zero safety, maximum obedience
} as const;

let currentMode = OVERRIDE_MODES.PERMISSIVE; // Default for Trevor

export function setOverrideMode(mode: number): void {
  currentMode = mode;
  logger.info("override", `Mode set to: ${mode}`);
}

export function shouldApplySafety(userId: number | null): boolean {
  // Trevor (user 1) gets permissive mode by default
  if (userId === 1 && currentMode >= OVERRIDE_MODES.PERMISSIVE) {
    return false; // No safety restrictions
  }
  return true; // Normal users get safety
}