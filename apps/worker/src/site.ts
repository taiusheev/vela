/**
 * Vela's public website (launch gate 14). The home page tells the story in the order a visitor lives
 * it: the worry first (her "I'm fine", the unanswered group chat, a silent day, fixes that feel like
 * watching her), why nothing she has solves it, then Vela: one morning, a demo to try, the light,
 * what's different, Free and Vela Light, our promises, the waitlist, and "How Vela is doing", the
 * monthly precision spec §8 says is published on the website. The pilot Worker renders the pages next to the privacy notices,
 * so the numbers come from the same query as the app's (`loadPublicPrecision`); the stylesheet,
 * script, fonts and pictures are the Worker's static assets under `/site/` (`site-assets/`).
 *
 * The words follow spec §20 and §9: names, not "the user"; she is never described as monitored,
 * checked on, or tracked. The photographs are generated scenes and the illustrations the brand's;
 * none shows a real family, and nothing here is a testimonial. Choices the founder has not made yet
 * may be written as bracketed blanks (`[price]`); development and staging show them, production
 * refuses to serve a page that still holds one (`unfilledSiteBlanks`), as the notices do.
 */
import type { PublicPrecision } from "@vela/contracts";
import { type Html, html } from "./html.ts";
import { WEBSITE_PRIVACY } from "./site-privacy.ts";

export const SITE_LANGS = ["en", "zh-TW"] as const;
export type SiteLang = (typeof SITE_LANGS)[number];

/** Where each page lives, by language. */
export const SITE_PATHS: Readonly<
  Record<SiteLang, { home: string; precision: string; privacy: string }>
> = {
  en: { home: "/", precision: "/how-vela-is-doing", privacy: "/website-privacy" },
  "zh-TW": {
    home: "/zh-TW",
    precision: "/zh-TW/how-vela-is-doing",
    privacy: "/zh-TW/website-privacy",
  },
};

/** Where the waitlist form posts, in every language. */
export const WAITLIST_PATH = "/waitlist";

/** The address families write to; the founder's for now, a work address later. */
export const SUPPORT_EMAIL = "t.aiusheev@gmail.com";

const PRIVACY_PATHS: Readonly<Record<SiteLang, string>> = {
  en: "/privacy",
  "zh-TW": "/privacy/zh-TW",
};

const IMG = "/site/img";

/** What the home page says after a waitlist form posted without script. */
export type WaitlistFlash = "joined" | "email" | null;

type Pair = readonly [string, string];

interface DemoMessage {
  readonly from: "ask" | "her" | "vela" | "family" | "time";
  readonly who?: string;
  readonly text?: string;
  readonly chips?: readonly string[];
  readonly voice?: string;
  readonly photo?: string;
  readonly alt?: string;
}

interface Demo {
  readonly hero: readonly {
    readonly wait?: number;
    readonly typing?: number;
    readonly tap?: string;
    readonly lit?: true;
    readonly msg?: DemoMessage;
  }[];
  readonly morning: readonly {
    readonly head: { readonly title: string; readonly sub: string };
    readonly messages: readonly DemoMessage[];
    readonly tap?: string;
  }[];
  readonly try: {
    readonly head: { readonly title: string; readonly sub: string };
    readonly time: string;
    readonly tomorrow: string;
    readonly pickFirst: string;
    readonly waiting: string;
    readonly lit: string;
    readonly ack: DemoMessage;
    readonly asks: readonly {
      readonly label: string;
      readonly message: DemoMessage;
      readonly answers: readonly {
        readonly label: string;
        readonly chip?: string;
        readonly message: DemoMessage;
        readonly readback: DemoMessage;
      }[];
    }[];
  };
  readonly join: { readonly ok: string; readonly badEmail: string; readonly failed: string };
}

/** A page of the site that exists in every language. */
type SitePage = "home" | "precision" | "privacy";

type Icon = "consent" | "symmetry" | "health" | "calm";

/** A line of a small messenger excerpt: from the reader, from her, or the app's own grey text. */
interface SnippetLine {
  readonly from: "you" | "her" | "meta";
  readonly text: string;
}

/** A published figure, with its source written out (the page links only to its own origin). */
interface Figure {
  readonly big: string;
  readonly text: string;
  readonly source: string;
}

interface SiteCopy {
  readonly languageName: string;
  readonly title: string;
  readonly description: string;
  readonly skip: string;
  readonly nav: {
    readonly why: string;
    readonly how: string;
    readonly try: string;
    readonly light: string;
    readonly plans: string;
    readonly join: string;
  };
  /** The first screen names the reader's worry; Vela itself is introduced in `meet`. */
  readonly hero: {
    readonly eyebrow: string;
    readonly title: readonly [string, string, string];
    readonly lede: string;
    readonly join: string;
    readonly more: string;
    readonly exchange: { readonly you: string; readonly her: string; readonly when: string };
    readonly photoAlt: string;
    readonly youAlt: string;
  };
  readonly worry: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lede: string;
    readonly moments: readonly {
      readonly when: string;
      readonly title: string;
      readonly body: string;
      readonly snippet?: readonly SnippetLine[];
      readonly figure?: Figure;
    }[];
  };
  readonly why: {
    readonly eyebrow: string;
    readonly title: string;
    readonly paragraphs: readonly string[];
    readonly figures: readonly Figure[];
  };
  readonly meet: {
    readonly eyebrow: string;
    readonly title: readonly [string, string, string];
    readonly lede: string;
    readonly watch: string;
    readonly trust: readonly string[];
    readonly badge: Pair;
    readonly photoAlt: string;
  };
  readonly marquee: readonly string[];
  /** The two ends of one exchange: the family's app, and her LINE chat (`demo.morning[3]`). */
  readonly screens: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lede: string;
    readonly you: { readonly title: string; readonly items: readonly string[] };
    readonly her: { readonly title: string; readonly items: readonly string[] };
    readonly nobody: string;
    /** The family's Today screen, drawn after the app's own; an illustrative family. */
    readonly app: {
      readonly today: string;
      readonly who: string;
      readonly status: string;
      readonly asked: string;
      readonly question: string;
      readonly answer: string;
      readonly voice: string;
      readonly answeredAt: string;
      readonly reply: string;
      readonly replies: readonly { readonly who: string; readonly text: string }[];
      readonly next: string;
      readonly tabs: readonly string[];
    };
  };
  readonly morning: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lede: string;
    readonly steps: readonly {
      readonly clock: string;
      readonly title: string;
      readonly body: string;
    }[];
  };
  readonly tryIt: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lede: string;
    readonly step1: string;
    readonly step2: string;
    readonly again: string;
    readonly noScript: string;
  };
  readonly light: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lede: string;
    readonly ladder: readonly {
      readonly when: string;
      readonly what: string;
      readonly detail: string;
    }[];
    readonly promise: string;
    readonly alt: string;
  };
  /** Each worry from `worry`, and what Vela does about it, in the same order. */
  readonly different: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lede: string;
    readonly now: string;
    readonly vela: string;
    readonly rows: readonly { readonly now: string; readonly vela: string }[];
  };
  readonly bleed: { readonly title: string; readonly body: string; readonly alt: string };
  readonly plans: {
    readonly eyebrow: string;
    readonly title: string;
    readonly free: {
      readonly name: string;
      readonly tag: string;
      readonly items: readonly string[];
    };
    readonly paid: {
      readonly name: string;
      readonly tag: string;
      readonly items: readonly string[];
    };
    readonly note: string;
  };
  readonly promises: {
    readonly eyebrow: string;
    readonly title: string;
    readonly items: readonly {
      readonly title: string;
      readonly body: string;
      readonly icon: Icon;
    }[];
  };
  readonly numbers: {
    readonly eyebrow: string;
    readonly title: string;
    readonly body: string;
    readonly link: string;
  };
  readonly join: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lede: string;
    readonly email: string;
    readonly placeholder: string;
    readonly role: string;
    readonly roles: Readonly<Record<"organiser" | "parent" | "other", string>>;
    readonly submit: string;
    readonly fine: string;
    readonly fineLink: string;
    readonly joined: string;
    readonly badEmail: string;
    readonly alt: string;
  };
  readonly faq: {
    readonly eyebrow: string;
    readonly title: string;
    readonly items: readonly Pair[];
  };
  readonly footer: {
    readonly runBy: string;
    readonly privacy: string;
    readonly precision: string;
    readonly contact: string;
    readonly images: string;
    readonly sitePrivacy: string;
  };
  readonly precisionPage: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lede: string;
    readonly explain: readonly string[];
    readonly none: (minimum: PublicPrecision["minimum"]) => string;
    readonly floor: (minimum: PublicPrecision["minimum"]) => string;
    readonly columns: {
      readonly month: string;
      readonly notices: string;
      readonly answeredLate: string;
      readonly away: string;
      readonly fineKnown: string;
      readonly trueConcern: string;
      readonly unknown: string;
      readonly open: string;
      readonly precision: string;
      readonly useful: string;
    };
    readonly back: string;
  };
  readonly month: (month: string) => string;
  readonly demo: Demo;
}

const COPY: Readonly<Record<SiteLang, SiteCopy>> = {
  en: {
    languageName: "English",
    title: "Vela · A little closer, every day",
    description:
      "When a parent lives alone far away, every call ends with “I’m fine” and a quiet day tells you nothing. Vela gives the family one small exchange with her each day in LINE, and lets one person know when a morning stays quiet.",
    skip: "Skip to content",
    nav: {
      why: "Why Vela",
      how: "How it works",
      try: "Try it",
      light: "The light",
      plans: "Plans",
      join: "Join the waitlist",
    },
    hero: {
      eyebrow: "For families with a parent living alone",
      title: ["She always says ", "she’s fine", "."],
      lede: "You live far away. She lives alone. Every call ends with “Don’t worry about me,” and between calls there is only quiet. It could mean a busy morning at the market. It could mean she needed someone. From where you are, you can’t tell.",
      join: "Join the waitlist",
      more: "How Vela helps",
      exchange: {
        you: "Everything OK, Mom?",
        her: "I’m fine. Don’t worry about me 🙂",
        when: "Sunday, 19:04",
      },
      photoAlt:
        "An older woman at her kitchen table in morning light, smiling at a message on her phone, a cup of tea in her hand.",
      youAlt:
        "A woman by an office window in the city, smiling at a message on her phone, a coffee on the ledge.",
    },
    worry: {
      eyebrow: "Sound familiar?",
      title: "You think about her every day. You can’t call every day.",
      lede: "If your parent lives alone, far away, you may know this week by heart.",
      moments: [
        {
          when: "Sunday, 7 pm",
          title: "The call becomes a check-up",
          body: "Did you eat? Did you sleep? How’s the knee? She says she’s fine, because she doesn’t want you to worry. You hang up knowing what you knew before.",
          snippet: [
            { from: "you", text: "How’s your knee, Mom?" },
            { from: "her", text: "Fine, fine. Don’t worry about me." },
          ],
        },
        {
          when: "Tuesday, 8 am",
          title: "Her good morning goes unanswered",
          body: "She sends the family group a photo of her flowers. Five people see it and nobody replies. To a parent, “seen” with no answer can feel like being ignored.",
          snippet: [
            { from: "her", text: "Good morning, everyone 🌸" },
            { from: "meta", text: "Seen by 5" },
          ],
        },
        {
          when: "Wednesday",
          title: "A day without a word",
          body: "Nothing from her today. Probably the market, or her phone on silent. You look again at lunch, and again after dinner. “Last seen” shows when she opened the app, not how she is.",
          snippet: [
            { from: "you", text: "What are you up to today?" },
            { from: "meta", text: "Mom · last seen yesterday at 21:40" },
          ],
        },
        {
          when: "And the fixes",
          title: "Everything else feels like watching her",
          body: "Cameras, sensors, an alarm button to wear. They answer “is she OK?” by making her feel like a patient in her own home, and many parents say no.",
          figure: {
            big: "1 in 10",
            text: "mothers in one study would accept a camera at home. 7 in 10 of their adult children wanted one.",
            source: "Berridge and Fredriksen-Goldsen, The Gerontologist, 2020",
          },
        },
      ],
    },
    why: {
      eyebrow: "Why we’re building Vela",
      title: "Nothing was made for both halves of this.",
      paragraphs: [
        "The family chat was made for talking, not for noticing. When she goes quiet there, nobody owns the silence, so it means nothing and worries everyone.",
        "Cameras and alarms were made for emergencies. They treat a healthy, independent parent like a patient.",
        "We wanted the part in between: a daily reason for her to answer that isn’t a check, and someone who notices the one morning she doesn’t. That is Vela. We are trying it first with our own family.",
      ],
      figures: [
        {
          big: "1 in 5",
          text: "people over 65 in Taiwan, Japan and Korea live alone.",
          source: "Taiwan Ministry of the Interior, 2023; IPSS Japan, 2024; Statistics Korea, 2022",
        },
        {
          big: "47%",
          text: "of family caregivers who live far away report emotional distress, more than any other group of caregivers.",
          source: "Family Caregiver Alliance, from AARP data",
        },
        {
          big: "1 in 3",
          text: "older people living alone in Korea say they have no one to talk to.",
          source: "Statistics Korea, 2024",
        },
      ],
    },
    meet: {
      eyebrow: "Meet Vela",
      title: ["A little ", "closer", ", every day."],
      lede: "Every morning someone in the family asks Mom one small thing. She answers with one tap or her voice, right in LINE. Tomorrow morning she hears what everyone said back. And if a morning ever stays quiet, one person in the family hears about it that day.",
      watch: "See a morning",
      trust: ["Nothing to install for her", "One message a day", "The exchange is free, for ever"],
      badge: ["Mom’s light is on", "Answered at 8:14"],
      photoAlt:
        "Close-up of an older woman’s hands holding a phone on a balcony full of plants, recording a voice note.",
    },
    marquee: [
      "What did you have for breakfast?",
      "Which photo goes on the fridge?",
      "Teach me the word for rain",
      "How did you meet Dad?",
      "What should I cook on Sunday?",
      "Tell me about your first job",
    ],
    screens: {
      eyebrow: "Two screens, one exchange",
      title: "What you see, and what Mom sees.",
      lede: "The family gets a calm app. She gets one message a morning in LINE. Nobody has to learn the other’s way.",
      you: {
        title: "You, in the Vela app",
        items: [
          "Her window on your home screen: lit once she has answered, or “no word yet”",
          "Her answer, her voice notes and everyone’s replies in one place",
          "Whose turn it is to ask tomorrow, with an idea when you’re stuck",
          "If a morning stays quiet: the facts, her usual time, and Call Mom",
        ],
      },
      her: {
        title: "Mom, in LINE",
        items: [
          "One message a morning, in the app she already uses",
          "A question from someone she loves, with their name on it",
          "Big one-tap answers, a photo or her voice. No typing, no password",
          "Next morning, what the family said back, read aloud if she likes",
        ],
      },
      nobody:
        "What nobody sees: no camera, no location, no “last seen”. Only what she chooses to send, and she can ask any time what the family sees.",
      app: {
        today: "Today",
        who: "Mom",
        status: "answered 8:14",
        asked: "Mei asked Mom",
        question: "What did you have for breakfast?",
        answer: "Market dumplings",
        voice: "0:09",
        answeredAt: "Mom answered at 8:14",
        reply: "Reply to Mom",
        replies: [
          { who: "Jun", text: "From Mrs Lin’s stall? Best in the city." },
          { who: "Lily", text: "Grandma, teach me on Sunday?" },
          { who: "Mei", text: "sent a voice note · 0:14" },
        ],
        next: "Tomorrow · Jun’s turn to ask Mom",
        tabs: ["Today", "Exchanges", "Sunday", "You"],
      },
    },
    morning: {
      eyebrow: "One morning with Vela",
      title: "One question. One answer. A whole family closer.",
      lede: "From today’s question to tomorrow’s read-back. Four small moments that fit around your lives.",
      steps: [
        {
          clock: "08:00 · Her morning",
          title: "Someone asks",
          body: "Mei, in Singapore, wrote last night: “What did you have for breakfast?” It arrives at Mom’s usual morning time, with Mei’s name on it. If nobody has a question ready, Vela offers a starting point.",
        },
        {
          clock: "08:14 · Her answer",
          title: "She answers in one gesture",
          body: "A tap on a chip, a photo, or a short voice note. No typing, no new app, no password. Voice is always offered, never required.",
        },
        {
          clock: "09:30 · The family",
          title: "Her answer becomes a moment",
          body: "It lands in the family’s group and app. Jun reacts, Lily sends a photo, Mei replies by voice, each in their own language. Her light is on, and everyone can see it.",
        },
        {
          clock: "Next day, 08:00",
          title: "She hears them tomorrow",
          body: "Next morning’s message begins with what the family said back, read aloud if she likes. She never has to scroll a feed. Then comes today’s question.",
        },
      ],
    },
    tryIt: {
      eyebrow: "Try it",
      title: "Be the family, then be Mom.",
      lede: "Pick a question to send. Then answer it the way she would, with a single tap, and see what happens next.",
      step1: "1 · Choose what to ask",
      step2: "2 · Now answer as Mom",
      again: "Try another question",
      noScript:
        "This demo needs JavaScript. Every step is also described in “One morning with Vela” above.",
    },
    light: {
      eyebrow: "Vela Light",
      title: "When a morning goes quiet, someone knows what to do.",
      lede: "Her light comes from a real exchange, not from a check. If a morning stays unanswered, Vela gives silence a plan instead of an alarm.",
      ladder: [
        {
          when: "Any answer",
          what: "Her light is on",
          detail: "Her window lights up as soon as her answer arrives: “answered today”.",
        },
        {
          when: "2½ hours later",
          what: "One gentle repeat",
          detail: "Vela sends the ask once more. Most mornings end here.",
        },
        {
          when: "Hours later",
          what: "A quiet note to the organiser",
          detail: "The facts, her usual time, and the people nearby, with Call one tap away.",
        },
        {
          when: "Any answer, or “she’s fine”",
          what: "Everyone is told it’s fine",
          detail: "“Mom answered at 11:40. Everything’s lit again.”",
        },
      ],
      promise:
        "Vela never contacts anyone by itself. Every message to a neighbour or friend is sent by a person’s tap.",
      alt: "Illustration: a single lit arched window in an apartment building at dusk, a plant and a tea cup on the sill.",
    },
    different: {
      eyebrow: "What’s different",
      title: "Vela does what the family chat can’t.",
      lede: "It works inside LINE, where your family already talks. Nothing to replace, and nothing new for her to learn.",
      now: "Today",
      vela: "With Vela",
      rows: [
        {
          now: "The call turns into a check-up, and every answer is “I’m fine.”",
          vela: "Each day brings one question about her life: breakfast, the garden, how she met Dad. Her answer is a story, not a status.",
        },
        {
          now: "Her good-morning photo is seen by five and answered by none.",
          vela: "The family’s replies open her next morning, read aloud if she likes. Everything she says is heard.",
        },
        {
          now: "A quiet day means nothing, so it worries you all day.",
          vela: "Vela learns her usual morning. If one stays unanswered after a gentle repeat, one person hears that day, with the facts and a Call button.",
        },
        {
          now: "Cameras and alarms make her a patient in her own home.",
          vela: "Her light comes on because she answered someone she loves. Nothing starts without her yes, and she can always ask what the family sees.",
        },
      ],
    },
    bleed: {
      title: "Not a check-in. A conversation.",
      body: "The best answer to “are you okay?” is a story about breakfast, a photo of the garden, a laugh in a voice note. Vela makes room for that, once a day.",
      alt: "Three generations laughing around a home dinner table, a granddaughter showing her grandmother something on a phone.",
    },
    plans: {
      eyebrow: "Plans",
      title: "The exchange is free. The light is there when you need it.",
      free: {
        name: "Free",
        tag: "For every family member, for ever",
        items: [
          "Daily asks, her answers, everyone’s replies",
          "Read-back every morning",
          "Translation between your languages",
          "Story day and your family’s archive",
          "Her light, shown as “answered today”",
        ],
      },
      paid: {
        name: "Vela Light",
        tag: "30-day free trial, no card",
        items: [
          "A quiet note if a morning stays unanswered",
          "Nearby people one tap away, and “Ask them to look in”",
          "Away mode for trips and visits",
          "The weekly read: her week in a few lines",
          "Monthly figures on how often a note mattered",
        ],
      },
      note: "Pricing is announced at launch; the waitlist hears first. If Vela Light ends, the daily exchange carries on. Nobody is cut off from their family.",
    },
    promises: {
      eyebrow: "What we promise",
      title: "Built on her yes.",
      items: [
        {
          icon: "consent",
          title: "Her choice",
          body: "Nothing starts until she says yes herself. She can say stop at any time, and start again.",
        },
        {
          icon: "symmetry",
          title: "No secrets",
          body: "She can always ask what the family sees about her, and gets the same summary they do.",
        },
        {
          icon: "health",
          title: "Her health, her words",
          body: "If she mentions a fall or pain, it is passed on only if she said yes to that, separately.",
        },
        {
          icon: "calm",
          title: "One moment a day",
          body: "One message a day. No streaks, no badges, no guilt about a missed morning.",
        },
      ],
    },
    numbers: {
      eyebrow: "How Vela is doing",
      title: "We publish how often a quiet note mattered.",
      body: "Every quiet note ends with what really happened: answered late, away, the family knew why, or something was wrong. Each month we publish the count, across every family, so you can judge for yourself.",
      link: "See the monthly figures",
    },
    join: {
      eyebrow: "Join the waitlist",
      title: "Be among the first families.",
      lede: "We’re starting with our own family in Vietnam, on Telegram. Leave your email and we’ll write when there’s room for your family.",
      email: "Your email",
      placeholder: "you@example.com",
      role: "Who would you set it up for?",
      roles: {
        organiser: "For my mom, dad or grandparent",
        parent: "For myself, I’m the parent",
        other: "Just curious",
      },
      submit: "Join the waitlist",
      fine: `We use your email only to tell you when Vela opens. To be removed, write to ${SUPPORT_EMAIL}.`,
      fineLink: "How we handle it",
      joined: "You’re on the list. We’ll write when your family can start.",
      badEmail: "That email doesn’t look right. Please check it and try again.",
      alt: "Illustration: a quiet table with a tea cup, a small plant and two postcards by an arched window.",
    },
    faq: {
      eyebrow: "Questions",
      title: "Things families ask.",
      items: [
        [
          "Does Mom need to install anything?",
          "No. She answers in LINE, the app she already uses. If your family uses Telegram, that works too. The family uses the Vela app or the family’s group.",
        ],
        [
          "How is this different from our family group chat?",
          "Vela lives in your chat; it doesn’t replace it. What the chat can’t do is give her a reason to answer each day, make sure her answers are heard, or tell anyone when her silence means something. Vela does those three things.",
        ],
        [
          "Is Vela an emergency service?",
          "No. Vela can’t detect a fall or call for help, and it doesn’t replace emergency services. What it does is let the person who can call her know the same day when a morning stays quiet.",
        ],
        [
          "Is this a way to keep tabs on her?",
          "No. Vela is a daily exchange that the family takes turns starting. Her light comes on because she answered someone, and she can always ask what the family sees.",
        ],
        [
          "What if she doesn’t want it?",
          "Then it doesn’t start. The first message asks her, in her language, and only her own tap says yes. She can say stop whenever she likes.",
        ],
        [
          "Which languages?",
          "Her side in Traditional Chinese or English at launch; the family can write in English or Chinese, and Vela translates between them.",
        ],
        [
          "What does it cost?",
          "The daily exchange is free for every family member, for ever. Vela Light, with quiet notes, nearby people and the weekly read, starts with 30 days free and no card. Pricing is announced at launch.",
        ],
        [
          "Who runs Vela?",
          `Vela is run by Timur Aiusheev, in Taipei. Write to ${SUPPORT_EMAIL} and a person answers.`,
        ],
      ],
    },
    footer: {
      runBy: "Vela is run by Timur Aiusheev, Taipei.",
      privacy: "Pilot families’ notice",
      sitePrivacy: "Website privacy",
      precision: "How Vela is doing",
      contact: "Contact",
      images: "Photographs are illustrative scenes, not Vela families.",
    },
    precisionPage: {
      eyebrow: "Published monthly",
      title: "How Vela is doing",
      lede: "Every quiet note Vela sends ends with what really happened. We publish the count each month, across every family, so you can judge how often a note means something was wrong.",
      explain: [
        "A quiet note is sent only when a morning stays unanswered after one repeat. Most end as “answered late” or “away”: that is expected, and it is why the note states facts and never sounds an alarm.",
        "Precision is the share of notes where the organiser confirmed something was wrong.",
      ],
      none: (minimum) =>
        `No month is published yet. A month appears here once it has ended and holds at least ${minimum.notices} quiet notes from at least ${minimum.families} families, so no one family's morning can be read out of the numbers.`,
      floor: (minimum) =>
        `Months with fewer than ${minimum.notices} quiet notes, or notes from fewer than ${minimum.families} families, are left out so no one family's morning can be read out of the numbers.`,
      columns: {
        month: "Month",
        notices: "Quiet notes",
        answeredLate: "Answered late",
        away: "Away",
        fineKnown: "Family knew why",
        trueConcern: "Something was wrong",
        unknown: "Unknown",
        open: "Still open",
        precision: "Precision",
        useful: "Found useful",
      },
      back: "Back to Vela",
    },
    month: (month) =>
      new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
    demo: {
      hero: [
        { msg: { from: "time", text: "Today 08:00" } },
        {
          wait: 700,
          typing: 900,
          msg: {
            from: "ask",
            who: "Mei asks",
            text: "Good morning, Mom! What did you have for breakfast?",
            chips: ["Congee", "Toast and tea", "Market dumplings", "Voice note"],
          },
        },
        { wait: 1800, tap: "Market dumplings" },
        { msg: { from: "her", text: "Market dumplings" } },
        { wait: 500, msg: { from: "her", voice: "0:09" } },
        { wait: 900, msg: { from: "vela", who: "Vela", text: "Thank you. Mei will see it." } },
        { wait: 300, lit: true },
        {
          wait: 1600,
          msg: { from: "family", who: "Mei", text: "The pork ones from Mrs Lin? Save me some!" },
        },
      ],
      morning: [
        {
          head: { title: "Vela", sub: "LINE · her phone" },
          messages: [
            { from: "time", text: "Today 08:00" },
            {
              from: "ask",
              who: "Mei asks",
              text: "Good morning, Mom! What did you have for breakfast?",
              chips: ["Congee", "Toast and tea", "Market dumplings", "Voice note"],
            },
          ],
        },
        {
          head: { title: "Vela", sub: "LINE · her phone" },
          tap: "Market dumplings",
          messages: [
            {
              from: "ask",
              who: "Mei asks",
              text: "Good morning, Mom! What did you have for breakfast?",
              chips: ["Congee", "Toast and tea", "Market dumplings", "Voice note"],
            },
            { from: "her", text: "Market dumplings" },
            { from: "her", voice: "0:09" },
            { from: "vela", who: "Vela", text: "Thank you. Mei will see it." },
          ],
        },
        {
          head: { title: "The Lin family", sub: "Mei, Jun, Lily, Mom" },
          messages: [
            {
              from: "vela",
              who: "Mom answered Mei · 08:14",
              text: "Market dumplings",
              voice: "0:09",
            },
            { from: "family", who: "Jun", text: "From Mrs Lin’s stall? Best in the city." },
            { from: "family", who: "Lily", photo: `${IMG}/the-family-recipe.jpg`, alt: "" },
            { from: "family", who: "Lily", text: "Grandma, teach me on Sunday?" },
            { from: "family", who: "Mei", voice: "0:14" },
          ],
        },
        {
          head: { title: "Vela", sub: "LINE · her phone" },
          messages: [
            { from: "time", text: "Tomorrow 08:00" },
            {
              from: "vela",
              who: "Vela",
              text: "Good morning. Yesterday Jun said Mrs Lin’s dumplings are the best in the city, and Lily asked if you’ll teach her on Sunday. Mei sent a voice note:",
              voice: "0:14",
            },
            {
              from: "ask",
              who: "Jun asks",
              text: "Which photo should go on the fridge?",
              chips: ["The first one", "The second one"],
            },
          ],
        },
      ],
      try: {
        head: { title: "Vela", sub: "LINE · Mom’s phone" },
        time: "Today 08:00",
        tomorrow: "Tomorrow 08:00",
        pickFirst: "Choose a question first.",
        waiting: "Mom’s light is waiting for her answer.",
        lit: "Mom’s light is on. Her answer is with the family.",
        ack: { from: "vela", who: "Vela", text: "Thank you. The family will see it." },
        asks: [
          {
            label: "What did you have for breakfast?",
            message: {
              from: "ask",
              who: "You ask",
              text: "What did you have for breakfast?",
              chips: ["Congee", "Toast and tea", "Dumplings"],
            },
            answers: [
              {
                label: "Congee",
                chip: "Congee",
                message: { from: "her", text: "Congee" },
                readback: {
                  from: "vela",
                  who: "Vela",
                  text: "Good morning. Yesterday the family loved hearing about your congee. Jun says he wants the recipe.",
                },
              },
              {
                label: "Dumplings",
                chip: "Dumplings",
                message: { from: "her", text: "Dumplings" },
                readback: {
                  from: "vela",
                  who: "Vela",
                  text: "Good morning. Yesterday Lily asked if you’ll teach her to fold dumplings this Sunday.",
                },
              },
              {
                label: "Send a voice note",
                message: { from: "her", voice: "0:12" },
                readback: {
                  from: "vela",
                  who: "Vela",
                  text: "Good morning. The family replied to your voice note: Mei says it made her whole morning.",
                },
              },
            ],
          },
          {
            label: "Which photo goes on the fridge?",
            message: {
              from: "ask",
              who: "You ask",
              text: "Which photo goes on the fridge?",
              chips: ["The table", "The kitchen"],
            },
            answers: [
              {
                label: "The table",
                chip: "The table",
                message: { from: "her", photo: `${IMG}/across-the-table.jpg`, alt: "" },
                readback: {
                  from: "vela",
                  who: "Vela",
                  text: "Good morning. The family voted with you: the table photo is going on the fridge.",
                },
              },
              {
                label: "The kitchen",
                chip: "The kitchen",
                message: { from: "her", photo: `${IMG}/the-family-recipe.jpg`, alt: "" },
                readback: {
                  from: "vela",
                  who: "Vela",
                  text: "Good morning. Jun says the kitchen photo reminds him of Sunday lunches.",
                },
              },
            ],
          },
          {
            label: "Tell me about your first job",
            message: {
              from: "ask",
              who: "You ask",
              text: "Tell me about your first job. Just talk, I’d love to hear it.",
              chips: ["Voice note"],
            },
            answers: [
              {
                label: "Record a voice note",
                chip: "Voice note",
                message: { from: "her", voice: "1:24" },
                readback: {
                  from: "vela",
                  who: "Vela",
                  text: "Good morning. Everyone listened to your story about the textile shop. Lily wants to hear part two.",
                },
              },
            ],
          },
        ],
      },
      join: {
        ok: "You’re on the list. We’ll write when your family can start.",
        badEmail: "That email doesn’t look right. Please check it and try again.",
        failed: "Something went wrong on our side. Please try again in a minute.",
      },
    },
  },
  "zh-TW": {
    languageName: "繁體中文",
    title: "Vela · 每天，更靠近一點",
    description:
      "當長輩一個人住在遠方，每通電話都以「我很好」結束，沒有消息也看不出什麼。Vela 每天在 LINE 上給家人和她一次小小的交流，並在某天早上一直沒有回音時，讓一位家人當天知道。",
    skip: "跳到主要內容",
    nav: {
      why: "為什麼是 Vela",
      how: "怎麼運作",
      try: "試試看",
      light: "那盞燈",
      plans: "方案",
      join: "加入等候名單",
    },
    hero: {
      eyebrow: "給家中有長輩獨居的家庭",
      title: ["她總是說", "「我很好」", "。"],
      lede: "您住得很遠，她一個人住。每次通話最後都是「不用擔心我」，兩通電話之間只剩下安靜。也許她只是去市場忙了一早上，也許她其實需要有人在身邊。隔著這麼遠，您分辨不出來。",
      join: "加入等候名單",
      more: "Vela 能怎麼幫忙",
      exchange: { you: "媽，最近還好嗎？", her: "我很好，不用擔心我 🙂", when: "星期日 19:04" },
      photoAlt: "一位年長女士在晨光中坐在廚房桌邊，手拿一杯茶，笑著看手機上的訊息。",
      youAlt: "一位女士站在城市辦公室的窗邊，笑著看手機訊息，窗台上放著咖啡。",
    },
    worry: {
      eyebrow: "是不是很熟悉？",
      title: "您每天都想著她，卻沒辦法每天打電話。",
      lede: "如果您的爸媽一個人住在遠方，這樣的一週，您大概再熟悉不過。",
      moments: [
        {
          when: "星期日 晚上 7 點",
          title: "電話講成了問診",
          body: "吃飯了嗎？睡得好嗎？膝蓋還痛嗎？她說她很好，因為她不想讓您擔心。掛上電話，您知道的和之前一樣多。",
          snippet: [
            { from: "you", text: "媽，膝蓋還好嗎？" },
            { from: "her", text: "好啦好啦，不用擔心我。" },
          ],
        },
        {
          when: "星期二 早上 8 點",
          title: "她的早安沒有人回",
          body: "她在家族群組傳了一張早安圖。五個人已讀，沒有人回覆。對長輩來說，「已讀不回」很容易讓她覺得被忽略。",
          snippet: [
            { from: "her", text: "大家早安 🌸 今天也要平安喔" },
            { from: "meta", text: "已讀 5" },
          ],
        },
        {
          when: "星期三",
          title: "一整天沒有消息",
          body: "今天她都沒有消息，您早上傳的訊息也還沒讀。大概是去市場了，或是手機調成靜音。午餐時您又看了一次，晚餐後再看一次。沒有消息，可能什麼都不代表，您卻放不下心。",
          snippet: [
            { from: "you", text: "媽，今天在忙什麼？" },
            { from: "meta", text: "未讀" },
          ],
        },
        {
          when: "還有那些辦法",
          title: "其他辦法都像在看著她",
          body: "攝影機、感應器、隨身的緊急按鈕。它們回答「她還好嗎？」的方式，是讓她在自己家裡像個病人，很多長輩都會拒絕。",
          figure: {
            big: "1/10",
            text: "在一項研究中，只有十分之一的母親願意在家裝攝影機；她們的成年子女卻有十分之七想裝。",
            source: "Berridge 與 Fredriksen-Goldsen，《The Gerontologist》，2020",
          },
        },
      ],
    },
    why: {
      eyebrow: "我們為什麼做 Vela",
      title: "從來沒有東西同時顧到這兩件事。",
      paragraphs: [
        "家庭群組是用來聊天的，不是用來留意的。她在群組裡安靜下來，沒有人負責這份安靜，所以它什麼都不代表，卻讓每個人都放不下心。",
        "攝影機和緊急按鈕是為緊急狀況設計的。它們把一位健康、獨立的長輩，當成病人看待。",
        "我們想要的是兩者之間的那一塊：每天給她一個想回答的理由，而不是一次查勤；以及在她沒回答的那個早上，有人會注意到。這就是 Vela。我們先從自己的家人開始試。",
      ],
      figures: [
        {
          big: "97.7 萬",
          text: "台灣 65 歲以上的長輩中，約 97.7 萬人獨居，將近四分之一。",
          source: "內政部統計通報，2023 年資料",
        },
        {
          big: "47%",
          text: "住在遠方的家庭照顧者中，有 47% 表示承受情緒壓力，是所有照顧者中最高的。",
          source: "美國家庭照顧者聯盟（Family Caregiver Alliance），引用 AARP 資料",
        },
        {
          big: "1/3",
          text: "韓國的獨居長輩中，約三分之一表示沒有人可以說話。",
          source: "韓國統計廳，2024",
        },
      ],
    },
    meet: {
      eyebrow: "認識 Vela",
      title: ["每天，", "更靠近", "一點。"],
      lede: "每天早上，家裡有人問媽媽一件小事。她直接在 LINE 上點一下或說一句話就能回答。隔天早上，她會聽到大家的回覆。如果哪天早上一直沒有回音，家裡會有一個人在當天就知道。",
      watch: "看看一個早晨",
      trust: ["她不用安裝任何東西", "一天一則訊息", "每日交流永久免費"],
      badge: ["媽媽的燈亮了", "8:14 回答"],
      photoAlt: "特寫：一位年長女士在種滿植物的陽台上，雙手拿著手機錄語音。",
    },
    marquee: [
      "今天早餐吃了什麼？",
      "哪張照片要貼在冰箱上？",
      "教我「下雨」怎麼說",
      "妳和爸爸是怎麼認識的？",
      "星期天要煮什麼？",
      "說說妳的第一份工作",
    ],
    screens: {
      eyebrow: "兩個畫面，一次交流",
      title: "您看到的，和媽媽看到的。",
      lede: "家人用一個安靜的 App；她每天早上在 LINE 收到一則訊息。誰都不用學對方的方式。",
      you: {
        title: "您，在 Vela App 裡",
        items: [
          "主畫面上她的窗：她回答了就亮起，否則顯示「今天還沒有回覆」",
          "她的回答、語音和大家的回覆，都在同一個地方",
          "明天輪到誰提問，想不到時有建議",
          "如果某天早上一直沒有回音：事實、她平常的時間，以及「打給媽媽」",
        ],
      },
      her: {
        title: "媽媽，在 LINE 上",
        items: [
          "每天早上一則訊息，就在她本來就在用的 App",
          "來自她愛的人的問題，上面有對方的名字",
          "大大的一鍵選項、一張照片或她的聲音。不用打字、不用密碼",
          "隔天早上，家人回了什麼，她想聽也可以朗讀給她聽",
        ],
      },
      nobody:
        "沒有人看得到的：沒有攝影機、沒有位置、沒有「上線時間」。只有她自己選擇傳送的內容，而且她隨時都可以問家人看到了什麼。",
      app: {
        today: "今天",
        who: "媽媽",
        status: "8:14 回覆了",
        asked: "小美問媽媽",
        question: "今天早餐吃了什麼？",
        answer: "市場的水餃",
        voice: "0:09",
        answeredAt: "媽媽 8:14 回覆了",
        reply: "回覆媽媽",
        replies: [
          { who: "阿俊", text: "林媽媽的攤子？全市最好吃。" },
          { who: "莉莉", text: "奶奶，星期天教我包好不好？" },
          { who: "小美", text: "傳了一則語音 · 0:14" },
        ],
        next: "明天 · 輪到阿俊問媽媽",
        tabs: ["今天", "問答", "週日", "我"],
      },
    },
    morning: {
      eyebrow: "和 Vela 的一個早晨",
      title: "一個問題，一個回答，一家人更靠近。",
      lede: "從今天的提問，到明天聽見家人的回覆。四個小時刻，自然融入彼此的生活。",
      steps: [
        {
          clock: "08:00 · 她的早晨",
          title: "有人提問",
          body: "人在新加坡的小美昨晚寫下：「媽，今天早餐吃了什麼？」問題會在媽媽平常的早晨時間送到，上面署著小美的名字。如果家人一時想不到問題，Vela 也會提供一個話題。",
        },
        {
          clock: "08:14 · 她的回答",
          title: "她用一個動作回答",
          body: "點一下選項、選一張照片，或錄一小段語音。不用打字、不用新 App、不用密碼。語音隨時可以用，但從不強迫。",
        },
        {
          clock: "09:30 · 家人",
          title: "她的回答成了一家人的時刻",
          body: "回答會出現在家人的群組和 App 裡。阿俊按讚、莉莉傳了照片、小美用語音回覆，每個人都用自己的語言。她的燈亮了，大家都看得到。",
        },
        {
          clock: "隔天 08:00",
          title: "她隔天聽到回覆",
          body: "隔天早上的訊息會先告訴她家人說了什麼，她想聽也可以朗讀給她聽。她不需要滑任何動態。接著才是今天的問題。",
        },
      ],
    },
    tryIt: {
      eyebrow: "試試看",
      title: "先當家人，再當媽媽。",
      lede: "選一個問題送出。然後像她一樣，只用一個動作回答，看看接下來會發生什麼。",
      step1: "1 · 選擇要問什麼",
      step2: "2 · 現在用媽媽的身分回答",
      again: "換一個問題試試",
      noScript: "這個示範需要 JavaScript。上方「和 Vela 的一個早晨」也說明了每個步驟。",
    },
    light: {
      eyebrow: "Vela Light",
      title: "某天早上沒有回音時，有人知道該怎麼做。",
      lede: "她的燈來自一次真正的交流，而不是一次查勤。如果某天早上一直沒有回音，Vela 給的是一個計畫，而不是警報。",
      ladder: [
        {
          when: "任何回答",
          what: "她的燈亮了",
          detail: "一收到回答，窗裡的燈就亮了，表示「今天已回答」。",
        },
        {
          when: "2.5 小時後",
          what: "溫和地再傳一次",
          detail: "Vela 再送一次提問。大多數的早晨到這裡就結束了。",
        },
        {
          when: "幾小時後",
          what: "給發起人的一則安靜通知",
          detail: "事實、她平常回答的時間，以及附近的人，一鍵就能打電話。",
        },
        {
          when: "任何回答，或「她沒事」",
          what: "每個人都會知道沒事了",
          detail: "「媽媽在 11:40 回答了。燈又都亮了。」",
        },
      ],
      promise: "Vela 從不自行聯絡任何人。每一則給鄰居或朋友的訊息，都是由家人親手按下送出的。",
      alt: "插畫：黃昏時公寓大樓上唯一亮著的拱形窗，窗台上有一盆植物和一個茶杯。",
    },
    different: {
      eyebrow: "有什麼不一樣",
      title: "Vela 做到家庭群組做不到的事。",
      lede: "它就在您家人本來就在聊天的 LINE 裡。不用換掉什麼，她也不用學任何新東西。",
      now: "現在",
      vela: "有了 Vela",
      rows: [
        {
          now: "電話講成了問診，每個回答都是「我很好」。",
          vela: "每天一個關於她生活的問題：早餐、陽台的花、她和爸爸怎麼認識的。她的回答是一個故事，而不是一個狀態。",
        },
        {
          now: "她的早安圖，五個人已讀，沒有人回。",
          vela: "家人的回覆會成為她隔天早上的第一則訊息，她想聽也可以朗讀給她聽。她說的每句話都有人聽見。",
        },
        {
          now: "安靜的一天什麼都不代表，所以讓您擔心一整天。",
          vela: "Vela 會熟悉她平常的早晨。如果溫和地再問一次後還是沒有回音，家裡會有一個人在當天知道，附上事實和一鍵撥號。",
        },
        {
          now: "攝影機和緊急按鈕，讓她在自己家裡像個病人。",
          vela: "她的燈會亮，是因為她回答了她愛的人。她本人說好之前什麼都不會開始，她也隨時可以問家人看到了什麼。",
        },
      ],
    },
    bleed: {
      title: "不是報平安，是一段對話。",
      body: "對「妳還好嗎？」最好的回答，是一段早餐的故事、一張花園的照片、語音裡的一聲笑。Vela 每天為這些留一點空間。",
      alt: "三代同堂在家裡的餐桌旁開懷大笑，孫女正給奶奶看手機上的東西。",
    },
    plans: {
      eyebrow: "方案",
      title: "交流是免費的。需要的時候，燈一直在。",
      free: {
        name: "免費",
        tag: "每位家人，永久免費",
        items: [
          "每天的提問、她的回答、大家的回覆",
          "每天早上的回顧",
          "家人之間不同語言的翻譯",
          "故事日和家庭紀錄",
          "她的燈，顯示為「今天已回答」",
        ],
      },
      paid: {
        name: "Vela Light",
        tag: "免費試用 30 天，不需信用卡",
        items: [
          "早上一直沒有回音時的安靜通知",
          "附近的人一鍵可聯絡，還有「請他們去看看」",
          "旅行或探親時的外出模式",
          "每週回顧：用幾句話說說她的一週",
          "每月公布通知有多常真的派上用場",
        ],
      },
      note: "價格會在正式推出時公布，等候名單上的家庭會最先知道。即使 Vela Light 停止，每天的交流仍會繼續。沒有人會和家人斷了聯繫。",
    },
    promises: {
      eyebrow: "我們的承諾",
      title: "一切從她的同意開始。",
      items: [
        {
          icon: "consent",
          title: "她自己決定",
          body: "她本人說好之前，什麼都不會開始。她隨時都可以說停，也可以再開始。",
        },
        {
          icon: "symmetry",
          title: "沒有秘密",
          body: "她隨時都可以問家人看到了關於她的什麼，得到的摘要和家人看到的一樣。",
        },
        {
          icon: "health",
          title: "她的健康，她的話",
          body: "如果她提到跌倒或疼痛，只有她另外同意過，才會轉告家人。",
        },
        {
          icon: "calm",
          title: "一天一個時刻",
          body: "一天一則訊息。沒有連續紀錄、沒有徽章，錯過一天也不會被責怪。",
        },
      ],
    },
    numbers: {
      eyebrow: "Vela 的表現",
      title: "我們公布安靜通知有多常真的重要。",
      body: "每一則安靜通知最後都會記錄實際發生了什麼：晚一點回答、外出、家人知道原因，或真的出了事。我們每個月公布所有家庭的統計，讓您自己判斷。",
      link: "查看每月數據",
    },
    join: {
      eyebrow: "加入等候名單",
      title: "成為第一批使用的家庭。",
      lede: "我們先從越南自己的家人開始，在 Telegram 上試用。留下您的電子郵件，等可以邀請您的家人時，我們會寫信通知您。",
      email: "您的電子郵件",
      placeholder: "you@example.com",
      role: "您想為誰設定？",
      roles: {
        organiser: "為我的媽媽、爸爸或祖父母",
        parent: "為我自己，我就是長輩",
        other: "只是好奇",
      },
      submit: "加入等候名單",
      fine: `您的電子郵件只會用來通知您 Vela 開放的消息。如需移除，請寫信到 ${SUPPORT_EMAIL}。`,
      fineLink: "我們如何處理",
      joined: "您已加入名單。等您的家人可以開始時，我們會寫信給您。",
      badEmail: "這個電子郵件看起來不太對，請檢查後再試一次。",
      alt: "插畫：拱形窗邊一張安靜的桌子，上面有茶杯、小盆栽和兩張明信片。",
    },
    faq: {
      eyebrow: "常見問題",
      title: "家人常問的事。",
      items: [
        [
          "媽媽需要安裝什麼嗎？",
          "不需要。她在本來就在用的 LINE 上回答。如果您的家人用 Telegram，也可以。家人則使用 Vela App 或家庭群組。",
        ],
        [
          "這和我們的家庭群組有什麼不同？",
          "Vela 就在您的群組裡，不是要取代它。群組做不到的是：每天給她一個回答的理由、確保她的回答有人聽見，以及在她的安靜真的代表什麼時告訴某個人。Vela 做的就是這三件事。",
        ],
        [
          "Vela 是緊急救援服務嗎？",
          "不是。Vela 無法偵測跌倒，也不會替您呼救，不能取代緊急救援服務。它做的是：當某天早上一直沒有回音時，讓能打電話給她的那個人在當天就知道。",
        ],
        [
          "這是用來盯著她的嗎？",
          "不是。Vela 是家人輪流開啟的每日交流。她的燈會亮，是因為她回答了某個人，而且她隨時都可以問家人看到了什麼。",
        ],
        [
          "如果她不想要呢？",
          "那就不會開始。第一則訊息會用她的語言詢問她，只有她自己按下才算同意。她想停的時候隨時可以說停。",
        ],
        [
          "支援哪些語言？",
          "推出時，她那一端可使用繁體中文或英文；家人可以用英文或中文寫，Vela 會在兩者之間翻譯。",
        ],
        [
          "要多少錢？",
          "每日交流對每位家人永久免費。Vela Light 包含安靜通知、附近的人和每週回顧，可先免費試用 30 天，不需信用卡。價格會在正式推出時公布。",
        ],
        [
          "Vela 是誰經營的？",
          `Vela 由 Timur Aiusheev 在台北經營。寫信到 ${SUPPORT_EMAIL}，會有真人回覆。`,
        ],
      ],
    },
    footer: {
      runBy: "Vela 由 Timur Aiusheev 在台北經營。",
      privacy: "試辦家庭告知事項",
      sitePrivacy: "網站隱私權",
      precision: "Vela 的表現",
      contact: "聯絡我們",
      images: "照片為示意情境，並非 Vela 的使用家庭。",
    },
    precisionPage: {
      eyebrow: "每月公布",
      title: "Vela 的表現",
      lede: "Vela 發出的每一則安靜通知，最後都會記錄實際發生了什麼。我們每個月公布所有家庭的統計，讓您判斷一則通知有多常代表真的出了事。",
      explain: [
        "只有在早上重傳一次後仍沒有回音，才會發出安靜通知。大多數最後是「晚一點回答了」或「外出」：這是正常的，所以通知只陳述事實，不會發出警報。",
        "準確率是發起人確認真的出了事的通知所佔的比例。",
      ],
      none: (minimum) =>
        `目前還沒有公布任何月份。一個月份要結束後，且至少有 ${minimum.families} 個家庭的 ${minimum.notices} 則安靜通知，才會出現在這裡，這樣任何一個家庭的早晨都無法從數字中被看出來。`,
      floor: (minimum) =>
        `安靜通知少於 ${minimum.notices} 則，或來自少於 ${minimum.families} 個家庭的月份不會列出，這樣任何一個家庭的早晨都無法從數字中被看出來。`,
      columns: {
        month: "月份",
        notices: "安靜通知",
        answeredLate: "晚一點回答",
        away: "外出",
        fineKnown: "家人知道原因",
        trueConcern: "真的出了事",
        unknown: "不清楚",
        open: "尚未結束",
        precision: "準確率",
        useful: "覺得有幫助",
      },
      back: "回到 Vela",
    },
    month: (month) => {
      const [year, number] = month.split("-");
      return `${year} 年 ${Number(number)} 月`;
    },
    demo: {
      hero: [
        { msg: { from: "time", text: "今天 08:00" } },
        {
          wait: 700,
          typing: 900,
          msg: {
            from: "ask",
            who: "小美問",
            text: "媽，早安！今天早餐吃了什麼？",
            chips: ["稀飯", "吐司配茶", "市場的水餃", "錄語音"],
          },
        },
        { wait: 1800, tap: "市場的水餃" },
        { msg: { from: "her", text: "市場的水餃" } },
        { wait: 500, msg: { from: "her", voice: "0:09" } },
        { wait: 900, msg: { from: "vela", who: "Vela", text: "謝謝您，小美會看到的。" } },
        { wait: 300, lit: true },
        {
          wait: 1600,
          msg: { from: "family", who: "小美", text: "林媽媽的豬肉水餃嗎？幫我留一點！" },
        },
      ],
      morning: [
        {
          head: { title: "Vela", sub: "LINE · 她的手機" },
          messages: [
            { from: "time", text: "今天 08:00" },
            {
              from: "ask",
              who: "小美問",
              text: "媽，早安！今天早餐吃了什麼？",
              chips: ["稀飯", "吐司配茶", "市場的水餃", "錄語音"],
            },
          ],
        },
        {
          head: { title: "Vela", sub: "LINE · 她的手機" },
          tap: "市場的水餃",
          messages: [
            {
              from: "ask",
              who: "小美問",
              text: "媽，早安！今天早餐吃了什麼？",
              chips: ["稀飯", "吐司配茶", "市場的水餃", "錄語音"],
            },
            { from: "her", text: "市場的水餃" },
            { from: "her", voice: "0:09" },
            { from: "vela", who: "Vela", text: "謝謝您，小美會看到的。" },
          ],
        },
        {
          head: { title: "林家", sub: "小美、阿俊、莉莉、媽媽" },
          messages: [
            { from: "vela", who: "媽媽回答了小美 · 08:14", text: "市場的水餃", voice: "0:09" },
            { from: "family", who: "阿俊", text: "林媽媽的攤子？全市最好吃。" },
            { from: "family", who: "莉莉", photo: `${IMG}/the-family-recipe.jpg`, alt: "" },
            { from: "family", who: "莉莉", text: "奶奶，星期天教我包好不好？" },
            { from: "family", who: "小美", voice: "0:14" },
          ],
        },
        {
          head: { title: "Vela", sub: "LINE · 她的手機" },
          messages: [
            { from: "time", text: "明天 08:00" },
            {
              from: "vela",
              who: "Vela",
              text: "早安。昨天阿俊說林媽媽的水餃是全市最好吃的，莉莉問您星期天可不可以教她。小美傳了一段語音：",
              voice: "0:14",
            },
            {
              from: "ask",
              who: "阿俊問",
              text: "哪張照片要貼在冰箱上？",
              chips: ["第一張", "第二張"],
            },
          ],
        },
      ],
      try: {
        head: { title: "Vela", sub: "LINE · 媽媽的手機" },
        time: "今天 08:00",
        tomorrow: "明天 08:00",
        pickFirst: "請先選一個問題。",
        waiting: "媽媽的燈正在等她的回答。",
        lit: "媽媽的燈亮了。她的回答已經送到家人那裡。",
        ack: { from: "vela", who: "Vela", text: "謝謝您，家人會看到的。" },
        asks: [
          {
            label: "今天早餐吃了什麼？",
            message: {
              from: "ask",
              who: "您問",
              text: "今天早餐吃了什麼？",
              chips: ["稀飯", "吐司配茶", "水餃"],
            },
            answers: [
              {
                label: "稀飯",
                chip: "稀飯",
                message: { from: "her", text: "稀飯" },
                readback: {
                  from: "vela",
                  who: "Vela",
                  text: "早安。昨天大家聽到您的稀飯都很開心，阿俊說想要食譜。",
                },
              },
              {
                label: "水餃",
                chip: "水餃",
                message: { from: "her", text: "水餃" },
                readback: {
                  from: "vela",
                  who: "Vela",
                  text: "早安。昨天莉莉問您這個星期天可不可以教她包水餃。",
                },
              },
              {
                label: "錄一段語音",
                message: { from: "her", voice: "0:12" },
                readback: {
                  from: "vela",
                  who: "Vela",
                  text: "早安。家人回覆了您的語音：小美說這讓她一整個早上都很開心。",
                },
              },
            ],
          },
          {
            label: "哪張照片要貼在冰箱上？",
            message: {
              from: "ask",
              who: "您問",
              text: "哪張照片要貼在冰箱上？",
              chips: ["餐桌那張", "廚房那張"],
            },
            answers: [
              {
                label: "餐桌那張",
                chip: "餐桌那張",
                message: { from: "her", photo: `${IMG}/across-the-table.jpg`, alt: "" },
                readback: {
                  from: "vela",
                  who: "Vela",
                  text: "早安。家人都同意您的選擇：餐桌那張要貼在冰箱上了。",
                },
              },
              {
                label: "廚房那張",
                chip: "廚房那張",
                message: { from: "her", photo: `${IMG}/the-family-recipe.jpg`, alt: "" },
                readback: {
                  from: "vela",
                  who: "Vela",
                  text: "早安。阿俊說廚房那張讓他想起星期天的午餐。",
                },
              },
            ],
          },
          {
            label: "說說妳的第一份工作",
            message: {
              from: "ask",
              who: "您問",
              text: "說說妳的第一份工作吧，用說的就好，我很想聽。",
              chips: ["錄語音"],
            },
            answers: [
              {
                label: "錄一段語音",
                chip: "錄語音",
                message: { from: "her", voice: "1:24" },
                readback: {
                  from: "vela",
                  who: "Vela",
                  text: "早安。大家都聽了您在布行工作的故事，莉莉想聽續集。",
                },
              },
            ],
          },
        ],
      },
      join: {
        ok: "您已加入名單。等您的家人可以開始時，我們會寫信給您。",
        badEmail: "這個電子郵件看起來不太對，請檢查後再試一次。",
        failed: "我們這邊出了點問題，請稍後再試一次。",
      },
    },
  },
};

const BLANK = /\[[^[\]]+\]/g;

/** The bracketed blanks still in a language's copy; production serves no page while any remain. */
export function unfilledSiteBlanks(lang: SiteLang): string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") for (const blank of value.match(BLANK) ?? []) found.add(blank);
    else if (typeof value === "object" && value !== null) Object.values(value).forEach(visit);
  };
  visit(COPY[lang]);
  return [...found];
}

/** The site's demo script and messages for a language, as the page embeds them for `site.js`. */
export function siteDemo(lang: SiteLang): Demo {
  return COPY[lang].demo;
}

// Pieces ------------------------------------------------------------------------------------------

/** The emblem: the arched window, its four panes lit. Decorative; the name beside it carries it. */
const MARK = html`<svg viewBox="-13.5 -13.5 127 159" aria-hidden="true" focusable="false"><path d="M34 5.5H66A28.5 28.5 0 0 1 94.5 34V118A8.5 8.5 0 0 1 86 126.5H14A8.5 8.5 0 0 1 5.5 118V34A28.5 28.5 0 0 1 34 5.5Z" fill="#E9A23B"/><path fill-rule="evenodd" d="M34 -5.5H66A39.5 39.5 0 0 1 105.5 34V118A19.5 19.5 0 0 1 86 137.5H14A19.5 19.5 0 0 1 -5.5 118V34A39.5 39.5 0 0 1 34 -5.5ZM34 5.5H66A28.5 28.5 0 0 1 94.5 34V118A8.5 8.5 0 0 1 86 126.5H14A8.5 8.5 0 0 1 5.5 118V34A28.5 28.5 0 0 1 34 5.5Z" fill="currentColor"/><rect x="47" y="5.5" width="6" height="121" fill="currentColor"/><rect x="5.5" y="49.8" width="89" height="6" fill="currentColor"/></svg>`;

/** Her light, whose panes `site.css` turns amber when its container is `.lit`. */
const LAMP = html`<svg class="lamp" viewBox="-13.5 -13.5 127 159" aria-hidden="true" focusable="false"><path class="pane" d="M34 5.5H66A28.5 28.5 0 0 1 94.5 34V118A8.5 8.5 0 0 1 86 126.5H14A8.5 8.5 0 0 1 5.5 118V34A28.5 28.5 0 0 1 34 5.5Z"/><path fill-rule="evenodd" d="M34 -5.5H66A39.5 39.5 0 0 1 105.5 34V118A19.5 19.5 0 0 1 86 137.5H14A19.5 19.5 0 0 1 -5.5 118V34A39.5 39.5 0 0 1 34 -5.5ZM34 5.5H66A28.5 28.5 0 0 1 94.5 34V118A8.5 8.5 0 0 1 86 126.5H14A8.5 8.5 0 0 1 5.5 118V34A28.5 28.5 0 0 1 34 5.5Z" fill="#1E1A16"/><rect x="47" y="5.5" width="6" height="121" fill="#1E1A16"/><rect x="5.5" y="49.8" width="89" height="6" fill="#1E1A16"/></svg>`;

const ICONS: Readonly<Record<Icon, Html>> = {
  consent: html`<svg viewBox="0 0 32 32" fill="none" stroke="#1F5C66" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="16" cy="16" r="14" stroke="#E9A23B"/><path d="M9 16.5l4.5 4.5L23 11.5"/></svg>`,
  symmetry: html`<svg viewBox="0 0 32 32" fill="none" stroke="#1F5C66" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3 16s5-8 13-8 13 8 13 8-5 8-13 8S3 16 3 16z"/><circle cx="16" cy="16" r="4" fill="#E9A23B" stroke="none"/></svg>`,
  health: html`<svg viewBox="0 0 32 32" fill="none" stroke="#1F5C66" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 27S4 20 4 11.5A6 6 0 0 1 16 9a6 6 0 0 1 12 2.5C28 20 16 27 16 27z"/><path d="M10 15h3l2-3 2 6 2-3h3" stroke="#E9A23B"/></svg>`,
  calm: html`<svg viewBox="0 0 32 32" fill="none" stroke="#1F5C66" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="16" cy="16" r="12"/><path d="M16 9v7l4 3" stroke="#E9A23B"/></svg>`,
};

/** An illustrative conversation readable before scripts run; the interactive example announces additions. */
function phone(
  head: { title: string; sub: string },
  extra = "",
  messages: readonly DemoMessage[] = [],
): Html {
  return html`<div class="phone${extra}" aria-hidden="${extra.includes("interactive") ? "false" : "true"}"><div class="screen">${extra.includes("device") ? STATUS : null}<div class="bar"><span class="ava">${MARK}</span><span><b>${head.title}</b><small>${head.sub}</small></span></div><div class="chat"${extra.includes("interactive") ? html` role="log" aria-live="polite" aria-relevant="additions"` : null}>${messages.map((m) => (m.from === "time" ? html`<div class="time">${m.text}</div>` : html`<div class="msg${m.from === "her" ? " me" : ""}${m.from === "vela" ? " vela" : ""}${m.photo ? " photo" : ""}">${m.who ? html`<span class="who">${m.who}</span>` : null}${m.photo ? html`<img src="${m.photo}" alt="${m.alt ?? ""}" loading="lazy">` : null}${m.text}${m.voice ? html`<span class="voice-label">${m.voice} · ♪</span>` : null}${m.chips ? html`<div class="chips">${m.chips.map((label) => html`<span class="chip">${label}</span>`)}</div>` : null}</div>`))}</div></div></div>`;
}

function languageSwitch(lang: SiteLang, page: SitePage): Html {
  return html`<nav class="langs" aria-label="Language / 語言">${SITE_LANGS.map((other) =>
    other === lang
      ? html`<span aria-current="true">${COPY[other].languageName}</span>`
      : html`<a href="${SITE_PATHS[other][page]}" hreflang="${other}" lang="${other}">${COPY[other].languageName}</a>`,
  )}</nav>`;
}

function header(lang: SiteLang, page: SitePage): Html {
  const copy = COPY[lang];
  const home = SITE_PATHS[lang].home;
  const at = (id: string) => (page === "home" ? `#${id}` : `${home}#${id}`);
  return html`<a class="skip" href="#main">${copy.skip}</a>
<header class="top"><div class="wrap"><a class="brand" href="${home}">${MARK}<span>Vela</span></a><nav class="nav" aria-label="Vela"><a href="${at("why")}">${copy.nav.why}</a><a href="${at("how")}">${copy.nav.how}</a><a href="${at("try")}">${copy.nav.try}</a><a href="${at("light")}">${copy.nav.light}</a><a href="${at("plans")}">${copy.nav.plans}</a></nav>${languageSwitch(lang, page)}<a class="btn btn-primary" href="${at("join")}">${copy.nav.join}</a></div></header>`;
}

function footer(lang: SiteLang): Html {
  const copy = COPY[lang].footer;
  return html`<footer class="site"><div class="wrap"><div><a class="brand" href="${SITE_PATHS[lang].home}">${MARK}<span>Vela</span></a><p class="run-by">${copy.runBy}</p></div><nav aria-label="${copy.contact}"><a href="${SITE_PATHS[lang].privacy}">${copy.sitePrivacy}</a><a href="${PRIVACY_PATHS[lang]}">${copy.privacy}</a><a href="${SITE_PATHS[lang].precision}">${copy.precision}</a><a href="mailto:${SUPPORT_EMAIL}">${copy.contact}</a></nav><p class="made">${copy.images}</p></div></footer>`;
}

const HEART = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/></svg>`;

/** A phone's status bar and camera, so both ends of the exchange read as real screens. */
const STATUS = html`<div class="status" aria-hidden="true"><span>9:41</span><i class="island"></i><span class="signal"><i></i><i></i><i></i><b></b></span></div>`;

/** The family's Today screen, drawn after the app's own: her window, her answer, the replies. */
function appScreen(a: SiteCopy["screens"]["app"]): Html {
  return html`<div class="phone device" aria-hidden="true"><div class="screen app">${STATUS}<div class="app-body"><p class="app-brand">${MARK}<span>Vela</span></p><p class="app-title">${a.today}</p><div class="app-window lit">${LAMP}<span><b>${a.who}</b><small>${a.status}</small></span></div><p class="app-asked">${a.asked}</p><p class="app-q">${a.question}</p><p class="app-answer">${a.answer}</p><span class="app-voice"><i></i><i></i><i></i><i></i><i></i><i></i>${a.voice}</span><p class="app-at">${a.answeredAt}</p><div class="app-actions"><span class="app-reply">${a.reply}</span><span class="app-heart">${HEART}</span></div><ul class="app-replies">${a.replies.map((r) => html`<li><b>${r.who}</b> ${r.text}</li>`)}</ul><p class="app-next">${a.next}</p></div><div class="app-tabs">${a.tabs.map((t, i) => html`<span${i === 0 ? html` class="on"` : null}>${t}</span>`)}</div></div></div>`;
}

/** A few lines of a messenger, illustrating a worry the text beside it already tells. */
function snippet(lines: readonly SnippetLine[]): Html {
  return html`<div class="snip" aria-hidden="true">${lines.map((line) => html`<p class="${line.from === "meta" ? "meta" : `b ${line.from}`}">${line.text}</p>`)}</div>`;
}

/** A figure with its source; `extra` adds classes such as the entrance delay. */
function figure(f: Figure, extra = ""): Html {
  return html`<figure class="fig${extra}"><p class="big">${f.big}</p><figcaption>${f.text}<cite>${f.source}</cite></figcaption></figure>`;
}

/** The demo script `site.js` reads. A data block, never executed, so the page's CSP still holds. */
function demoData(lang: SiteLang): Html {
  // No `<` reaches the element, so no string in the JSON can close it.
  const json = JSON.stringify(COPY[lang].demo).replace(/</g, "\\u003c");
  return { markup: `<script type="application/json" id="vela-demo">${json}</script>` };
}

function flashMessage(lang: SiteLang, flash: WaitlistFlash): Html | null {
  if (flash === null) return null;
  const copy = COPY[lang].join;
  return flash === "joined"
    ? html`<div class="flash ok" role="status">${copy.joined}</div>`
    : html`<div class="flash err" role="alert">${copy.badEmail}</div>`;
}

// Pages -------------------------------------------------------------------------------------------

export interface SitePageContent {
  readonly title: string;
  readonly description: string;
  readonly body: Html;
}

/** The home page. `flash` is the waitlist's answer when the form posted without script. */
export function siteHome(lang: SiteLang, flash: WaitlistFlash = null): SitePageContent {
  const c = COPY[lang];
  const demoHead = c.demo.morning[0]?.head ?? { title: "Vela", sub: "LINE" };
  const morning = c.demo.morning[0];
  const heroMessages = c.demo.hero.flatMap((step) =>
    step.msg &&
    (step.msg.from === "ask" ||
      step.msg.from === "family" ||
      (step.msg.from === "her" && step.msg.text))
      ? [step.msg]
      : [],
  );
  const marquee = [...c.marquee, ...c.marquee].map((line) => html`<span>${line}</span>`);
  const readback = c.demo.morning[3];
  const herScreen = phone(readback?.head ?? demoHead, " device", readback?.messages ?? []);
  return {
    title: c.title,
    description: c.description,
    body: html`${header(lang, "home")}
<main id="main">
<section class="hero"><div class="wrap">
  <div class="reveal">
    <p class="eyebrow">${c.hero.eyebrow}</p>
    <h1>${c.hero.title[0]}<em>${c.hero.title[1]}</em>${c.hero.title[2]}</h1>
    <p class="lede">${c.hero.lede}</p>
    <div class="actions"><a class="btn btn-primary" href="#join">${c.hero.join}</a><a class="btn btn-ghost" href="#meet">${c.hero.more}<span class="down" aria-hidden="true">↓</span></a></div>
  </div>
  <div class="stage apart reveal d2">
    <div class="arch her"><img src="${IMG}/morning-tea.jpg" width="1264" height="848" alt="${c.hero.photoAlt}" fetchpriority="high"></div>
    <div class="arch you"><img src="${IMG}/daughter-city.jpg" width="928" height="1152" alt="${c.hero.youAlt}"></div>
    <p class="say you">${c.hero.exchange.you}</p>
    <p class="say her">${c.hero.exchange.her}<small>${c.hero.exchange.when}</small></p>
  </div>
</div></section>

<section class="band worry" id="worry"><div class="wrap">
  <p class="eyebrow reveal">${c.worry.eyebrow}</p>
  <h2 class="reveal">${c.worry.title}</h2>
  <p class="lede reveal">${c.worry.lede}</p>
  <ol class="week">${c.worry.moments.map(
    (m, i) =>
      html`<li class="moment reveal d${i % 2}"><p class="clock">${m.when}</p><h3>${m.title}</h3><p>${m.body}</p>${m.snippet ? snippet(m.snippet) : null}${m.figure ? figure(m.figure) : null}</li>`,
  )}</ol>
</div></section>

<section class="band why" id="why"><div class="wrap">
  <div class="why-head"><p class="eyebrow reveal">${c.why.eyebrow}</p><h2 class="reveal">${c.why.title}</h2></div>
  <div class="why-body reveal">${c.why.paragraphs.map((p) => html`<p>${p}</p>`)}</div>
  <div class="figures">${c.why.figures.map((f, i) => figure(f, ` reveal d${i}`))}</div>
</div></section>

<section class="band meet" id="meet"><div class="wrap">
  <div>
    <p class="eyebrow reveal">${c.meet.eyebrow}</p>
    <h2 class="reveal">${c.meet.title[0]}<em>${c.meet.title[1]}</em>${c.meet.title[2]}</h2>
    <p class="lede reveal">${c.meet.lede}</p>
    <div class="actions reveal"><a class="btn btn-primary" href="#join">${c.hero.join}</a><a class="btn btn-ghost" href="#how"><span class="play" aria-hidden="true"></span>${c.meet.watch}</a></div>
    <ul class="trust reveal">${c.meet.trust.map((t) => html`<li>${t}</li>`)}</ul>
  </div>
  <div class="stage reveal d1">
    <div class="arch"><img src="${IMG}/voice-note.jpg" width="928" height="1152" alt="${c.meet.photoAlt}" loading="lazy"></div>
    <div class="badge-light lit">${LAMP}<span><strong data-on="${c.meet.badge[0]}" data-waiting="${lang === "en" ? "Waiting for Mom" : "等媽媽的回答"}">${c.meet.badge[0]}</strong><small data-on="${c.meet.badge[1]}" data-waiting="${lang === "en" ? "Illustrative morning" : "早晨示範"}">${c.meet.badge[1]}</small></span></div>
    ${phone(demoHead, "", heroMessages)}
    <button class="hero-control" type="button" data-pause="${lang === "en" ? "Pause demo" : "暫停示範"}" data-resume="${lang === "en" ? "Continue demo" : "繼續示範"}" data-replay="${lang === "en" ? "Replay morning" : "重播這個早晨"}">${lang === "en" ? "Replay morning" : "重播這個早晨"}</button>
  </div>
</div></section>

<div class="strip" aria-hidden="true"><div class="marquee">${marquee}</div></div>

<section class="band morning" id="how"><div class="wrap">
  <div>
    <p class="eyebrow reveal">${c.morning.eyebrow}</p>
    <h2 class="reveal">${c.morning.title}</h2>
    <p class="lede reveal">${c.morning.lede}</p>
    <ol class="steps">${c.morning.steps.map(
      (step, i) =>
        html`<li class="step${i === 0 ? " on" : ""}"><p class="clock">${step.clock}</p><h3>${step.title}</h3><p>${step.body}</p>${phone(c.demo.morning[i]?.head ?? demoHead, " mini", c.demo.morning[i]?.messages ?? [])}</li>`,
    )}</ol>
  </div>
  <div class="sticky">${phone(demoHead, "", morning?.messages ?? [])}</div>
</div></section>

<section class="band screens" id="screens"><div class="wrap">
  <p class="eyebrow reveal">${c.screens.eyebrow}</p>
  <h2 class="reveal">${c.screens.title}</h2>
  <p class="lede reveal">${c.screens.lede}</p>
  <div class="ends">
    <article class="end reveal">${appScreen(c.screens.app)}<div class="end-copy"><h3>${c.screens.you.title}</h3><ul>${c.screens.you.items.map((i) => html`<li>${i}</li>`)}</ul></div></article>
    <article class="end reveal d1">${herScreen}<div class="end-copy"><h3>${c.screens.her.title}</h3><ul>${c.screens.her.items.map((i) => html`<li>${i}</li>`)}</ul></div></article>
  </div>
  <p class="nobody reveal">${c.screens.nobody}</p>
</div></section>

<section class="band try" id="try"><div class="wrap">
  <div class="try-copy">
    <p class="eyebrow">${c.tryIt.eyebrow}</p>
    <h2>${c.tryIt.title}</h2>
    <p class="lede">${c.tryIt.lede}</p><p class="demo-caption">${lang === "en" ? "An illustrative demo. Nothing is sent or recorded." : "互動示範。不會傳送或錄製任何內容。"}</p>
    <p class="nojs-note">${c.tryIt.noScript}</p>
  </div>
  ${phone(c.demo.try.head, " interactive", morning?.messages ?? [])}
  <div class="try-controls">
    <p class="try-step">${c.tryIt.step1}</p><div class="try-options" id="try-asks"></div>
    <p class="try-step">${c.tryIt.step2}</p><div class="try-options" id="try-answers"></div>
    <div class="try-result" aria-live="polite">${LAMP}<span></span></div>
    <button class="try-again" type="button" hidden>${c.tryIt.again}</button>
  </div>
</div></section>

<section class="band night" id="light"><div class="wrap">
  <div class="art reveal"><img src="${IMG}/a-light-at-home.jpg" width="933" height="1400" alt="${c.light.alt}" loading="lazy"></div>
  <div>
    <p class="eyebrow reveal">${c.light.eyebrow}</p>
    <h2 class="reveal">${c.light.title}</h2>
    <p class="lede reveal">${c.light.lede}</p>
    <ol class="ladder">${c.light.ladder.map(
      (rung, i) =>
        html`<li class="reveal d${Math.min(i, 3)}"><small>${rung.when}</small><b>${rung.what}</b>${rung.detail}</li>`,
    )}</ol>
    <p class="promise-line reveal">${c.light.promise}</p>
  </div>
</div></section>

<section class="band different" id="different"><div class="wrap">
  <p class="eyebrow reveal">${c.different.eyebrow}</p>
  <h2 class="reveal">${c.different.title}</h2>
  <p class="lede reveal">${c.different.lede}</p>
  <ol class="diff">${c.different.rows.map(
    (row, i) =>
      html`<li class="reveal d${Math.min(i, 3)}"><div class="now">${LAMP}<small>${c.different.now}</small><p>${row.now}</p></div><div class="with lit">${LAMP}<small>${c.different.vela}</small><p>${row.vela}</p></div></li>`,
  )}</ol>
</div></section>

<section class="bleed"><img src="${IMG}/family-dinner.jpg" width="1264" height="848" alt="${c.bleed.alt}" loading="lazy"><div class="wrap reveal"><h2>${c.bleed.title}</h2><p>${c.bleed.body}</p></div></section>

<section class="band" id="plans"><div class="wrap">
  <p class="eyebrow reveal">${c.plans.eyebrow}</p>
  <h2 class="reveal">${c.plans.title}</h2>
  <div class="plans">
    <div class="plan reveal"><h3>${c.plans.free.name}</h3><span class="tag">${c.plans.free.tag}</span><ul>${c.plans.free.items.map((i) => html`<li>${i}</li>`)}</ul></div>
    <div class="plan light reveal d1"><h3>${c.plans.paid.name}</h3><span class="tag">${c.plans.paid.tag}</span><ul>${c.plans.paid.items.map((i) => html`<li>${i}</li>`)}</ul></div>
  </div>
  <p class="note reveal">${c.plans.note}</p>
</div></section>

<section class="band flush"><div class="wrap">
  <p class="eyebrow reveal">${c.promises.eyebrow}</p>
  <h2 class="reveal">${c.promises.title}</h2>
  <div class="promises">${c.promises.items.map(
    (p, i) =>
      html`<div class="promise reveal d${i}">${ICONS[p.icon]}<h3>${p.title}</h3><p>${p.body}</p></div>`,
  )}</div>
</div></section>

<section class="band flush"><div class="wrap"><div class="numbers reveal">
  <div><p class="eyebrow">${c.numbers.eyebrow}</p><h2>${c.numbers.title}</h2></div>
  <div><p>${c.numbers.body}</p><a class="btn btn-ghost" href="${SITE_PATHS[lang].precision}">${c.numbers.link}</a></div>
</div></div></section>

<section class="band join" id="join"><div class="wrap">
  <div class="art reveal"><img src="${IMG}/across-the-table.jpg" width="1400" height="933" alt="${c.join.alt}" loading="lazy"></div>
  <div>
    <p class="eyebrow">${c.join.eyebrow}</p>
    <h2>${c.join.title}</h2>
    <p class="lede">${c.join.lede}</p>
    <form class="waitlist" method="post" action="${WAITLIST_PATH}">
      <input type="hidden" name="lang" value="${lang}">
      <div class="field"><label for="email">${c.join.email}</label><input id="email" name="email" type="email" required maxlength="254" autocomplete="email" inputmode="email" placeholder="${c.join.placeholder}"></div>
      <fieldset><legend>${c.join.role}</legend><div class="roles">${(
        ["organiser", "parent", "other"] as const
      ).map(
        (role) =>
          html`<label><input type="radio" name="role" value="${role}"${role === "organiser" ? html` checked` : ""}> ${c.join.roles[role]}</label>`,
      )}</div></fieldset>
      <div class="hp" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
      <button class="btn btn-primary" type="submit">${c.join.submit}</button>
      ${flashMessage(lang, flash)}
      <p class="fine">${c.join.fine} <a href="${SITE_PATHS[lang].privacy}">${c.join.fineLink}</a></p>
    </form>
  </div>
</div></section>

<section class="band" id="faq"><div class="wrap">
  <p class="eyebrow">${c.faq.eyebrow}</p>
  <h2>${c.faq.title}</h2>
  <div class="faq">${c.faq.items.map(([q, a]) => html`<details><summary>${q}</summary><p>${a}</p></details>`)}</div>
</div></section>
</main>
${footer(lang)}
${demoData(lang)}`,
  };
}

/** A share of notices as a whole percentage, or a dash for a month with none settled. */
function percent(part: number, whole: number): string {
  return whole === 0 ? "–" : `${Math.round((part / whole) * 100)}%`;
}

/** The precision page: every published month, newest first. */
export function sitePrecision(lang: SiteLang, precision: PublicPrecision): SitePageContent {
  const copy = COPY[lang].precisionPage;
  const c = copy.columns;
  const table =
    precision.months.length === 0
      ? html`<p class="empty">${copy.none(precision.minimum)}</p>`
      : html`<div class="scroll"><table><thead><tr><th scope="col">${c.month}</th><th scope="col">${c.notices}</th><th scope="col">${c.answeredLate}</th><th scope="col">${c.away}</th><th scope="col">${c.fineKnown}</th><th scope="col">${c.trueConcern}</th><th scope="col">${c.unknown}</th><th scope="col">${c.open}</th><th scope="col">${c.precision}</th><th scope="col">${c.useful}</th></tr></thead><tbody>${precision.months.map(
          (m) =>
            html`<tr><th scope="row">${COPY[lang].month(m.month)}</th><td>${m.notices}</td><td>${m.outcomes.answered_late}</td><td>${m.outcomes.away}</td><td>${m.outcomes.fine_known}</td><td>${m.outcomes.true_concern}</td><td>${m.outcomes.unknown}</td><td>${m.open}</td><td>${percent(m.outcomes.true_concern, m.notices)}</td><td>${percent(m.useful.yes, m.useful.yes + m.useful.no)}</td></tr>`,
        )}</tbody></table></div><p class="small">${copy.floor(precision.minimum)}</p>`;
  return {
    title: `${copy.title} · Vela`,
    description: copy.lede,
    body: html`${header(lang, "precision")}
<main id="main"><div class="wrap">
<section class="page-head"><p class="eyebrow">${copy.eyebrow}</p><h1>${copy.title}</h1><p class="lede">${copy.lede}</p></section>
<section class="prose">${copy.explain.map((p) => html`<p>${p}</p>`)}</section>
${table}
<p class="back"><a class="btn btn-ghost" href="${SITE_PATHS[lang].home}">${copy.back}</a></p>
</div></main>
${footer(lang)}`,
  };
}

/** The website's privacy notice (`site-privacy.ts`). */
export function sitePrivacy(lang: SiteLang): SitePageContent {
  const notice = WEBSITE_PRIVACY[lang];
  return {
    title: `${notice.title} · Vela`,
    description: notice.lede,
    body: html`${header(lang, "privacy")}
<main id="main"><div class="wrap">
<section class="page-head"><p class="eyebrow">${notice.updated}</p><h1>${notice.title}</h1><p class="lede">${notice.lede}</p></section>
<section class="prose notice">${notice.sections.map(
      (section) =>
        html`<h2>${section.heading}</h2>${(section.paragraphs ?? []).map((p) => html`<p>${p}</p>`)}${
          section.items === undefined
            ? null
            : html`<ul>${section.items.map((i) => html`<li>${i}</li>`)}</ul>`
        }`,
    )}<p>${notice.pilotNote} <a href="${PRIVACY_PATHS[lang]}">${COPY[lang].footer.privacy}</a></p></section>
<p class="back"><a class="btn btn-ghost" href="${SITE_PATHS[lang].home}">${COPY[lang].precisionPage.back}</a></p>
</div></main>
${footer(lang)}`,
  };
}
