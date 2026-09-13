/**
 * English is the source catalog (spec §20): every other catalog translates these keys one for one,
 * and `MessageKey` is derived from this object, so a key exists only once it has English wording.
 *
 * Wording rules the tests enforce (spec §9, §14.4, §20): the kept-light member is named, never
 * referred to by a gendered pronoun, because the product never assumes gender; nothing says
 * "monitor", "check on", or "track", because elders refuse a product framed as surveillance.
 *
 * `consent.request`, `consent.yes`, and `consent.no` are what the founder reads aloud on the consent
 * call (plan/materials/pilot/consent-script.en.md, sections 2 and 6): change the script with them.
 *
 * `onboarding.done` asks for a new group without the kept-light member (spec Appendix A): group
 * posts name the member in the third person, and only the family who received the privacy notice
 * may see the answers, so the family's existing chat is the wrong place for Vela.
 */
export const en = {
  "arrival.greeting": "Good morning, {address}.",
  "arrival.late": "Sorry this is late.",
  "arrival.repeat": "In case you missed it:",
  "arrival.readback_heading": "From yesterday:",
  "arrival.asks": "{asker} asks:",
  "arrival.asks_on_behalf": "{asker} asks, for {child}:",
  "arrival.sent_photo": "{asker} sent you a photo.",
  "arrival.sent_voice": "{asker} sent you a voice message.",
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
  "readback.photo": "{name} sent a photo.",
  "readback.reactions": "{names} sent {emoji}",
  "consent.invalid_link":
    "This link is no longer valid. Please ask the person who sent it for a new one.",
  "consent.already_linked": "This Telegram account is already connected to another family on Vela.",
  "consent.request":
    "{organiser} would like to keep a light on for you. Every morning someone in the family will ask you something, and when you answer, they will know you are fine. If a morning goes unanswered, {organiser} will get a quiet note so they can call. You can say stop at any time.",
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
  "group.not_linked": "Only the family organiser can connect Vela to a group.",
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
  "quiet.notice_no_usual":
    "It's been quiet at {name}'s today. The morning message went out at {sent}. Nothing worrying is known.",
  "quiet.nearby": "Nearby: {contacts}",
  "quiet.fine_button": "{name} is fine, I know why",
  "quiet.wait_button": "Wait 2 hours",
  "quiet.waiting": "I'll look again at {time}.",
  "quiet.resolved_answered": "{name} answered at {time}. Everything is lit again.",
  "quiet.resolved_fine": "{organiser} says {name} is fine.",
  "delivery.failed": "We couldn't reach {name} on {channel} today. Nothing else is known.",
  "flag.notice": '{name} said something you may want to hear: "{quote}"',
  "away.confirmed": "Until {date}, then. Have a lovely time.",
  "away.confirmed_open": "Understood. Have a lovely time.",
  "help.private": "Hello. To set up Vela for your family, send /start.",
  "onboarding.welcome":
    "Hello, I'm Vela. Let's set up a light for someone in your family. It takes two minutes.",
  "onboarding.ask_name": "What do you call them? For example: Mom, Grandma, Dad.",
  "onboarding.ask_address": "How should I greet them each morning? For example: Mrs Chen, Mom.",
  "onboarding.ask_language": "Which language should their messages be in?",
  "onboarding.ask_country": "Which country do they live in?",
  "onboarding.country_tw": "Taiwan",
  "onboarding.country_us": "United States",
  "onboarding.country_gb": "United Kingdom",
  "onboarding.country_ca": "Canada",
  "onboarding.country_au": "Australia",
  "onboarding.country_sg": "Singapore",
  "onboarding.country_jp": "Japan",
  "onboarding.country_de": "Germany",
  "onboarding.country_in": "India",
  "onboarding.country_other": "Other",
  "onboarding.ask_zone": "Which time zone?",
  "onboarding.ask_zone_other":
    "Which time zone do they live in? Type its name, like Asia/Seoul or Europe/Paris.",
  "onboarding.invalid_zone": "Please send a time zone name like Asia/Seoul or Europe/Paris.",
  "onboarding.ask_wake": "When do they usually wake up? Tap one or type a time like 07:30.",
  "onboarding.ask_nearby":
    "Who lives nearby and could look in if needed? Send a name and phone number, or tap Skip.",
  "onboarding.skip": "Skip",
  "onboarding.invalid_time": "Please send a time like 07:30.",
  "onboarding.done":
    "All set. Send this link to {name}: {link} Then start a new group for the family, without {name}, and add me to it, so the family can take turns asking.",
  "admin.weekly_read_draft": "Weekly read draft for {family}:",
  "admin.flag": 'Flag in {family}: {name} said "{quote}"',
} satisfies Record<string, string>;
