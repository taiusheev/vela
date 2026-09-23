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
}

export interface QuietNotice {
  memberName: string;
  /** Her usual hour, for the label: the sheet is measured against her own day. */
  usualTime: string;
  facts: string[];
  contacts: NearbyContact[];
  /** Set once she answers: the sheet closes itself and says so. */
  resolution?: string;
}

export const quietFixture: QuietNotice = {
  memberName: "Mom",
  usualTime: "08:00",
  facts: [
    "She last answered yesterday at 8:41.",
    "Today's ask was delivered at 8:00, and a repeat at 11:00.",
    "Yesterday she wrote about the tomatoes turning.",
  ],
  contacts: [
    { id: "c1", name: "Lena", relation: "neighbour", consented: true },
    { id: "c2", name: "Petro", relation: "downstairs", consented: false },
  ],
};
