import { Redirect } from "expo-router";

/**
 * Settings now lives on You, one page instead of two (6 November 2026). The address stays, so an
 * older link, a notification or a muscle-memory tap on "Settings" still lands where the settings are.
 */
export default function SettingsScreen() {
  return <Redirect href="/you" />;
}
