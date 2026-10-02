import { t } from "@lingui/core/macro";

/**
 * What the quiet notice needs (spec §14.1 A11, §8). The API route that will carry it does not
 * exist yet, so these fixtures hold the shapes it will answer with. Facts only: the sheet says
 * what is known and what can be done, and never guesses at a reason.
 */

export interface NearbyContact {
  id: string;
  name: string;
  relation: string;
  /** Only a contact who has said yes can be asked to look in (spec §9). */
  consented: boolean;
  /** Given with their yes, so the organiser can call; the family has no number for anyone else. */
  phone?: string;
  /** They said yes on Telegram, so an organiser can ask them to look in from here (ADR-36). */
  canAsk?: boolean;
  /** This morning's ask: when, by whom, and what they answered. */
  asked?: { at: string; byName?: string; reply: "yes" | "no" | null };
}

export interface QuietNotice {
  memberName: string;
  /** Her usual hour, for the label: the sheet is measured against her own day. Unknown at first. */
  usualTime?: string;
  /** When the ask reached her, for the label while her usual hour is not yet known. */
  sentAt?: string;
  facts: string[];
  contacts: NearbyContact[];
  /** Set once she answers: the sheet closes itself and says so. */
  resolution?: string;
}

/**
 * The demo's notice, worded as the live one is: her name, never a pronoun, and facts, never her
 * words. It is read in the language active when it is built, which is while Today renders.
 */
export const quietFixtureFor = (name: string): QuietNotice => ({
  memberName: name,
  usualTime: "08:00",
  facts: [
    t`Today's ask reached ${name} at 8:00, and again at 11:00.`,
    t`${name} last answered yesterday at 8:41.`,
  ],
  contacts: [
    {
      id: "c1",
      name: "Lena",
      relation: t({ comment: "who a nearby contact is to her", message: "neighbour" }),
      consented: true,
      canAsk: true,
    },
    {
      id: "c2",
      name: "Petro",
      relation: t({ comment: "who a nearby contact is to her", message: "downstairs" }),
      consented: false,
    },
  ],
});
