> **Draft, not live.** Changes to `privacy-notice` for ADR-60 (Vela asks the people nearby itself). Fold into the next notice version with the founder's yes; until then `NEARBY_AUTO_ASK` stays off in production.

# Privacy notice: lines that change when Vela may ask someone nearby

**"In short", replace:**
> Vela never contacts anyone on its own. Every message to a neighbour or friend is sent by a person in the family.

**with:**
> Vela contacts a neighbour or friend only if they agreed to it, and only on a morning the person has not answered: when someone in the family asks, or when nobody in the family has answered Vela's notice for two hours.

**Purpose 2 ("To keep the light"), add after "so the organiser can decide what to do":**
> If nobody in the family has acted on that notice two hours later, Vela asks the nearby contacts who agreed to this whether they could look in, and tells the organisers whom it asked and what they answered.

**"Who sees what", replace:**
> A nearby contact sees only a message an organiser chooses to send them on a quiet day.

**with:**
> A nearby contact sees only a request to look in on a quiet day: one an organiser chose to send, or Vela's own when nobody in the family answered its notice. They never see answers.
