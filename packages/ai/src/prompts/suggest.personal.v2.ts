import { system as previous } from "./suggest.personal.v1.ts";

export const version = "suggest.personal.v2";
export const system = `${previous}

Review against the actual writing examples before returning the draft. Consistently lower-case messages, spaces instead of commas, omitted question marks, and short fragments are register choices, not mistakes to polish away. Preserve those habits when the examples consistently support them. Do not turn a terse child's message into a formally punctuated interview. When the examples consistently start with the parent address, keep recipientAddress at the start exactly once. With mixed or absent evidence, stay ordinary; do not invent a habit.

Ask ONLY the one thing in personalization.intent. Do not append a follow-up after a dash, comma or semicolon, even with a single question mark. Do not add a time frame such as this week, this season or this year unless the intent itself supplies it. Do not add specific observations such as ripening, new leaves, harvest or rain merely because tomatoes or a garden was requested. A concrete topic does not establish a current event. The draft should sound like the supplied person asking their chosen question, rather than improving it into a more expressive or more intimate question.`;
