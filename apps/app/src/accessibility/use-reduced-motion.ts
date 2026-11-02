import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { watchReducedMotion } from "./reduced-motion.ts";

/** Avoid animating before the platform's accessibility preference is known. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => watchReducedMotion(AccessibilityInfo, setReduced), []);
  return reduced;
}

/**
 * The same preference, but undefined until the platform has answered, for a moment that plays once
 * and must neither be skipped by the safe default nor shown before it starts. A platform that cannot
 * answer counts as reduced.
 */
export function useMotionPreference(): boolean | undefined {
  const [reduced, setReduced] = useState<boolean>();
  useEffect(() => watchReducedMotion(AccessibilityInfo, setReduced, () => setReduced(true)), []);
  return reduced;
}
