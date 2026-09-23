import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";
import { darkPalette, lightPalette, type Palette } from "./tokens.ts";

interface Theme {
  palette: Palette;
  scheme: "light" | "dark";
}

const ThemeContext = createContext<Theme>({ palette: lightPalette, scheme: "light" });

/**
 * Light is the default and the only mode on the parent surface; dark exists for the twenty-year-old
 * (design system, Colour).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = useMemo<Theme>(
    () => ({ scheme, palette: scheme === "dark" ? darkPalette : lightPalette }),
    [scheme],
  );
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export function usePalette(): Palette {
  return useContext(ThemeContext).palette;
}
