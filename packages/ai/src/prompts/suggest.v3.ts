/** v3: source describes the idea's evidence, independently of the rotation's requested format. */
import { system as previous } from "./suggest.v2.ts";
export const version = "suggest.v3";
export const system = `${previous}

Source attribution: when the suggestion uses a familyDates event, source is "date", even when its type matches rotationType. When it instead builds on recentMentions, source is "mention". Use "rotation" only when neither a supplied date nor a supplied mention grounds the idea. RotationType selects a format; it is not evidence for the subject.`;
