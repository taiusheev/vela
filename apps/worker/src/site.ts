/**
 * Vela's public website (launch gate 14): the story of one morning, a demo to try, the light, Free
 * and Vela Light, our promises, the waitlist, and "How Vela is doing", the monthly precision spec §8
 * says is published on the website. The pilot Worker renders the pages next to the privacy notices,
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

interface SiteCopy {
  readonly languageName: string;
  readonly title: string;
  readonly description: string;
  readonly skip: string;
  readonly nav: {
    readonly how: string;
    readonly try: string;
    readonly light: string;
    readonly plans: string;
    readonly faq: string;
    readonly join: string;
  };
  readonly hero: {
    readonly eyebrow: string;
    readonly title: readonly [string, string, string];
    readonly lede: string;
    readonly join: string;
    readonly watch: string;
    readonly trust: readonly string[];
    readonly badge: Pair;
    readonly photoAlt: string;
  };
  readonly marquee: readonly string[];
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
  readonly sides: {
    readonly eyebrow: string;
    readonly title: string;
    readonly her: {
      readonly title: string;
      readonly items: readonly string[];
      readonly alt: string;
    };
    readonly family: {
      readonly title: string;
      readonly items: readonly string[];
      readonly alt: string;
    };
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
      "One small exchange a day between a parent and her family. She answers with one tap or her voice on LINE; the family replies; tomorrow morning she hears them.",
    skip: "Skip to content",
    nav: {
      how: "How it works",
      try: "Try it",
      light: "The light",
      plans: "Plans",
      faq: "Questions",
      join: "Join the waitlist",
    },
    hero: {
      eyebrow: "Daily exchanges for families, near and far",
      title: ["A little ", "closer", ", every day."],
      lede: "Every morning someone in the family asks Mom one small thing. She answers with one tap or her voice, right in LINE. Tomorrow morning she hears what everyone said back.",
      join: "Join the waitlist",
      watch: "See a morning",
      trust: ["Nothing to install for her", "One message a day", "The exchange is free, for ever"],
      badge: ["Mom’s light is on", "Answered at 8:14"],
      photoAlt:
        "An older woman at her kitchen table in morning light, smiling at a message on her phone, a cup of tea in her hand.",
    },
    marquee: [
      "What did you have for breakfast?",
      "Which photo goes on the fridge?",
      "Teach me the word for rain",
      "How did you meet Dad?",
      "What should I cook on Sunday?",
      "Tell me about your first job",
    ],
    morning: {
      eyebrow: "One morning with Vela",
      title: "One question. One answer. A whole family closer.",
      lede: "Here is a single day, from the ask to the read-back. Scroll, and watch it happen on her phone.",
      steps: [
        {
          clock: "08:00 · Her morning",
          title: "Someone asks",
          body: "Mei, in Singapore, wrote last night: “What did you have for breakfast?” It arrives at Mom’s usual morning time, with Mei’s name on it. Every ask comes from a person; Vela only carries it.",
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
    sides: {
      eyebrow: "Built for both ends of the call",
      title: "Simple for her. Meaningful for everyone.",
      her: {
        title: "For her",
        items: [
          "Answers in LINE, the app she already uses",
          "One tap, a photo, or her voice",
          "Large text, nothing to set up, no streaks",
          "She can say stop, and ask what the family sees",
        ],
        alt: "Close-up of an older woman’s hands holding a phone on a balcony full of plants, recording a voice note.",
      },
      family: {
        title: "For the family",
        items: [
          "Take turns asking, with suggestions when you’re stuck",
          "Her answers and voice notes in one calm place",
          "Translation between the family’s languages",
          "Her light on the home screen: answered today",
        ],
        alt: "A woman by an office window in the city, smiling at a message on her phone, a coffee on the ledge.",
      },
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
          detail: "Lit on the raw answer, before anything else runs.",
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
      lede: "Vela opens to families in Taiwan first, then more places. Leave your email and we’ll write once, when your family can start.",
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
      "長輩和家人之間，每天一次小小的交流。她在 LINE 上點一下或說一句話回答；家人回覆；隔天早上她就聽到大家說了什麼。",
    skip: "跳到主要內容",
    nav: {
      how: "怎麼運作",
      try: "試試看",
      light: "那盞燈",
      plans: "方案",
      faq: "常見問題",
      join: "加入等候名單",
    },
    hero: {
      eyebrow: "給遠近家人的每日交流",
      title: ["每天，", "更靠近", "一點。"],
      lede: "每天早上，家裡有人問媽媽一件小事。她直接在 LINE 上點一下或說一句話就能回答。隔天早上，她會聽到大家的回覆。",
      join: "加入等候名單",
      watch: "看看一個早晨",
      trust: ["她不用安裝任何東西", "一天一則訊息", "每日交流永久免費"],
      badge: ["媽媽的燈亮了", "8:14 回答"],
      photoAlt: "一位年長女士在晨光中坐在廚房桌邊，手拿一杯茶，笑著看手機上的訊息。",
    },
    marquee: [
      "今天早餐吃了什麼？",
      "哪張照片要貼在冰箱上？",
      "教我「下雨」怎麼說",
      "妳和爸爸是怎麼認識的？",
      "星期天要煮什麼？",
      "說說妳的第一份工作",
    ],
    morning: {
      eyebrow: "和 Vela 的一個早晨",
      title: "一個問題，一個回答，一家人更靠近。",
      lede: "從提問到隔天的回顧，就是這樣的一天。往下滑，看看她的手機上發生了什麼。",
      steps: [
        {
          clock: "08:00 · 她的早晨",
          title: "有人提問",
          body: "人在新加坡的小美昨晚寫下：「媽，今天早餐吃了什麼？」問題會在媽媽平常的早晨時間送到，上面署著小美的名字。每個提問都來自家人，Vela 只負責傳遞。",
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
    sides: {
      eyebrow: "為通話的兩端而設計",
      title: "對她簡單，對每個人都有意義。",
      her: {
        title: "給她",
        items: [
          "在她本來就在用的 LINE 上回答",
          "點一下、一張照片，或她的聲音",
          "大字體、不用設定、沒有連續紀錄",
          "她可以說停，也可以問家人看到了什麼",
        ],
        alt: "特寫：一位年長女士在種滿植物的陽台上，雙手拿著手機錄語音。",
      },
      family: {
        title: "給家人",
        items: [
          "輪流提問，想不到時有建議",
          "她的回答和語音集中在一個安靜的地方",
          "家人之間不同語言的翻譯",
          "主畫面上她的燈：今天已回答",
        ],
        alt: "一位女士站在城市辦公室的窗邊，笑著看手機訊息，窗台上放著咖啡。",
      },
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
        { when: "任何回答", what: "她的燈亮了", detail: "一收到回答就亮，在其他處理之前。" },
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
      lede: "Vela 會先在台灣開放，之後再到更多地方。留下您的電子郵件，等您的家人可以開始時，我們會寫信通知您一次。",
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

/** An empty phone that `site.js` fills; hidden from assistive technology, the text beside it tells it. */
function phone(head: { title: string; sub: string }, extra = ""): Html {
  return html`<div class="phone${extra}" aria-hidden="true"><div class="screen"><div class="bar"><span class="ava">${MARK}</span><span><b>${head.title}</b><small>${head.sub}</small></span></div><div class="chat"></div></div></div>`;
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
<header class="top"><div class="wrap"><a class="brand" href="${home}">${MARK}<span>Vela</span></a><nav class="nav" aria-label="Vela"><a href="${at("how")}">${copy.nav.how}</a><a href="${at("try")}">${copy.nav.try}</a><a href="${at("light")}">${copy.nav.light}</a><a href="${at("plans")}">${copy.nav.plans}</a><a href="${at("faq")}">${copy.nav.faq}</a></nav>${languageSwitch(lang, page)}<a class="btn btn-primary" href="${at("join")}">${copy.nav.join}</a></div></header>`;
}

function footer(lang: SiteLang): Html {
  const copy = COPY[lang].footer;
  return html`<footer class="site"><div class="wrap"><div><a class="brand" href="${SITE_PATHS[lang].home}">${MARK}<span>Vela</span></a><p class="run-by">${copy.runBy}</p></div><nav aria-label="${copy.contact}"><a href="${SITE_PATHS[lang].privacy}">${copy.sitePrivacy}</a><a href="${PRIVACY_PATHS[lang]}">${copy.privacy}</a><a href="${SITE_PATHS[lang].precision}">${copy.precision}</a><a href="mailto:${SUPPORT_EMAIL}">${copy.contact}</a></nav><p class="made">${copy.images}</p></div></footer>`;
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
  const marquee = [...c.marquee, ...c.marquee].map((line) => html`<span>${line}</span>`);
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
    <div class="actions"><a class="btn btn-primary" href="#join">${c.hero.join}</a><a class="btn btn-ghost" href="#how"><span class="play" aria-hidden="true"></span>${c.hero.watch}</a></div>
    <ul class="trust">${c.hero.trust.map((t) => html`<li>${t}</li>`)}</ul>
  </div>
  <div class="stage reveal d2">
    <div class="arch"><img src="${IMG}/morning-tea.jpg" width="1264" height="848" alt="${c.hero.photoAlt}" fetchpriority="high"></div>
    <div class="badge-light">${LAMP}<span><strong>${c.hero.badge[0]}</strong><small>${c.hero.badge[1]}</small></span></div>
    ${phone(demoHead)}
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
        html`<li class="step${i === 0 ? " on" : ""}"><p class="clock">${step.clock}</p><h3>${step.title}</h3><p>${step.body}</p>${phone(c.demo.morning[i]?.head ?? demoHead, " mini")}</li>`,
    )}</ol>
  </div>
  <div class="sticky">${phone(demoHead)}</div>
</div></section>

<section class="band soft"><div class="wrap">
  <p class="eyebrow reveal">${c.sides.eyebrow}</p>
  <h2 class="reveal">${c.sides.title}</h2>
  <div class="sides">
    <article class="side reveal"><div class="pic"><img src="${IMG}/voice-note.jpg" width="928" height="1152" alt="${c.sides.her.alt}" loading="lazy"></div><div class="body"><h3>${c.sides.her.title}</h3><ul>${c.sides.her.items.map((i) => html`<li>${i}</li>`)}</ul></div></article>
    <article class="side reveal d1"><div class="pic"><img src="${IMG}/daughter-city.jpg" width="928" height="1152" alt="${c.sides.family.alt}" loading="lazy"></div><div class="body"><h3>${c.sides.family.title}</h3><ul>${c.sides.family.items.map((i) => html`<li>${i}</li>`)}</ul></div></article>
  </div>
</div></section>

<section class="band try" id="try"><div class="wrap">
  <div class="try-copy">
    <p class="eyebrow">${c.tryIt.eyebrow}</p>
    <h2>${c.tryIt.title}</h2>
    <p class="lede">${c.tryIt.lede}</p>
    <p class="nojs-note">${c.tryIt.noScript}</p>
  </div>
  ${phone(c.demo.try.head)}
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
