import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { watchReducedMotion } from "./reduced-motion.ts";

/** Avoid animating before the platform's accessibility preference is known. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => watchReducedMotion(AccessibilityInfo, setReduced), []);
  return reduced;
}
