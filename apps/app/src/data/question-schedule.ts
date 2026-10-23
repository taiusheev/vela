/** Calendar arithmetic uses the recipient's dates, never this phone's daylight-saving clock. */
export function questionDates(tomorrow: string): string[] {
  return Array.from({ length: 14 }, (_, index) => {
    const day = new Date(`${tomorrow}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}
