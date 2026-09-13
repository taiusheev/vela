/**
 * English is the source catalog (spec §20): every other catalog translates these keys one for one,
 * and `MessageKey` is derived from this object, so a key exists only once it has English wording.
 *
 * Wording rules the tests enforce (spec §9, §14.4, §20): the kept-light member is named, never
 * referred to by a gendered pronoun, because the product never assumes gender; nothing says
 * "monitor", "check on", or "track", because elders refuse a product framed as surveillance.
 */
export const en = {
  "arrival.greeting": "Good morning, {address}.",
  "arrival.late": "Sorry this is late.",
  "arrival.repeat": "In case you missed it:",
  "arrival.readback_heading": "From yesterday:",
  "arrival.asks": "{asker} asks:",
  "arrival.asks_on_behalf": "{asker} asks, for {child}:",
  "arrival.photo_choice": "Which one? Tap 1 or 2.",
  "arrival.vote": "Tap one.",
  "arrival.hello": "Nothing new from the family today. How are you this morning?",
  "arrival.hello_signature": "Vela, from your family",
  "arrival.hint": "Reply with a voice message, or tap a button.",
  "button.fine": "I'm fine",
  "button.heart": "❤️",
  "button.choice": "{n}",
  "ack.thanks": "Thank you, {address}. The family will hear it.",
  "readback.replied": "{name}: {text}",
  "readback.voice": "{name} sent a voice message.",
  "readback.reactions": "{names} sent {emoji}",
  "consent.request":
    "{organiser} would like to keep a light on for you. Every morning someone in the family will ask you something, and when you answer, they will know you are fine. If there is no answer by evening, {organiser} will know to call. You can say stop at any time.",
  "consent.yes": "Yes, that's fine",
  "consent.no": "No, thank you",
  "consent.accepted": "Thank you. Your first morning arrives tomorrow at {time}.",
  "consent.declined": "That's fine. Nothing will arrive.",
  "organiser.consent_given": "{name} said yes. The first morning arrives tomorrow at {time}.",
  "organiser.consent_declined": "{name} said no for now. Nothing will be sent.",
  "parent.stopped": "Everything is paused. Say start whenever you would like it back.",
  "parent.started": "Welcome back. Your next morning arrives at {time}.",
  "organiser.stopped": "{name} asked to pause. Nothing is wrong with the app.",
  "parent.family_sees_heading": "This is what the family saw from you this week:",
  "parent.family_sees_empty": "Nothing yet this week.",
  "group.linked":
    "Hello, family. I'm Vela. Each evening I will say whose turn it is to ask {name} something for the morning.",
  "group.turn_prompt":
    "Tomorrow is {holder}'s turn with {name}. Reply to this message with a question, a photo, or a voice note.",
  "group.turn_prompt_open":
    "Tomorrow, anyone can ask {name} something. Reply to this message with a question, a photo, or a voice note.",
  "group.ask_confirmed": "Into {name}'s morning.",
  "group.ask_queued": "Tomorrow already has {asker}'s ask. This one is saved for another morning.",
  "group.answer_light": "☀️ {name} answered {asker} · {time}",
  "group.answer_hello": "☀️ {name} is fine · {time}",
  "group.answer_chip": "{name} chose: {choice}",
  "group.answer_pick": "{name} picked photo {n}.",
  "group.answer_vote": "{name} voted: {choice}",
  "group.answer_text": "{name}: {text}",
  "group.answer_transcript": "{name} (voice): {text}",
  "quiet.notice":
    "It's been quiet at {name}'s today. The morning message went out at {sent}; {name} usually answers by {usual}. Nothing worrying is known.",
  "quiet.nearby": "Nearby: {contacts}",
  "quiet.fine_button": "{name} is fine, I know why",
  "quiet.wait_button": "Wait 2 hours",
  "quiet.waiting": "I'll look again at {time}.",
  "quiet.resolved_answered": "{name} answered at {time}. Everything is lit again.",
  "quiet.resolved_fine": "{organiser} says {name} is fine.",
  "delivery.failed": "We couldn't reach {name} on {channel} today. Nothing else is known.",
  "flag.notice": '{name} said something you may want to hear: "{quote}"',
  "onboarding.welcome":
    "Hello, I'm Vela. Let's set up a light for someone in your family. It takes two minutes.",
  "onboarding.ask_name": "What do you call them? For example: Mom, Grandma, Dad.",
  "onboarding.ask_address": "How should I greet them each morning? For example: Mrs Chen, Mom.",
  "onboarding.ask_language": "Which language should their messages be in?",
  "onboarding.ask_country": "Which country do they live in?",
  "onboarding.ask_zone": "Which time zone?",
  "onboarding.ask_wake": "When do they usually wake up? Tap one or type a time like 07:30.",
  "onboarding.ask_nearby":
    "Who lives nearby and could look in if needed? Send a name and phone number, or tap Skip.",
  "onboarding.skip": "Skip",
  "onboarding.invalid_time": "Please send a time like 07:30.",
  "onboarding.done":
    "All set. Send this link to {name}: {link} Then add me to your family group chat, so the family can take turns asking.",
  "admin.weekly_read_draft": "Weekly read draft for {family}:",
} satisfies Record<string, string>;
