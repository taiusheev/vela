import { useEffect, useState } from "react";
import { readSetting, writeSetting } from "../storage/flags.ts";
import { FIRST_OPENED_SETTING, inFirstWeek } from "./first-week.ts";

/**
 * True during the reader's first week on this device. Explanations such as "A light comes on when
 * they answer their morning" help on day one and become noise by day ten, so they show only while
 * this is true. A device that keeps nothing keeps teaching, which is the harmless way to fail.
 */
export function useFirstWeek(): boolean {
  const [first, setFirst] = useState(true);
  useEffect(() => {
    let live = true;
    void readSetting(FIRST_OPENED_SETTING).then((stored) => {
      if (stored === null) void writeSetting(FIRST_OPENED_SETTING, new Date().toISOString());
      if (live) setFirst(inFirstWeek(stored, new Date()));
    });
    return () => {
      live = false;
    };
  }, []);
  return first;
}
