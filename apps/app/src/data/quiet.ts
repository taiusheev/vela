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
}

export interface QuietNotice {
  memberName: string;
  /** Her usual hour, for the label: the sheet is measured against her own day. Unknown at first. */
  usualTime?: string;
  /** When the ask reached her, for the label while her usual hour is not yet known. */
  sentAt?: string;
  /** Asking a contact to look in needs a route that is not built yet; the example day shows it. */
  canAskToCheck?: boolean;
  facts: string[];
  contacts: NearbyContact[];
  /** Set once she answers: the sheet closes itself and says so. */
  resolution?: string;
}

/** The demo's notice, worded as the live one is: her name, never a pronoun, and facts, never her words. */
export const quietFixtureFor = (memberName: string): QuietNotice => ({
  memberName,
  usualTime: "08:00",
  facts: [
    `Today's ask reached ${memberName} at 8:00, and again at 11:00.`,
    `${memberName} last answered yesterday at 8:41.`,
  ],
  contacts: [
    { id: "c1", name: "Lena", relation: "neighbour", consented: true },
    { id: "c2", name: "Petro", relation: "downstairs", consented: false },
  ],
});
