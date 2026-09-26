/**
 * Vela's question bank: the asks tomorrow's suggestion is drawn from (build plan 3.3), in English
 * and Traditional Chinese. Each item is the ask itself, addressed to her, exactly as "Use this" puts
 * it in the Ask field and as she would receive it. Every item is about her life, her knowledge, or
 * her opinions, never how she is; `ask-bank.test.ts` holds each text to the wording rules of
 * `rules.ts`, including `HEALTH_CHECK`.
 *
 * Ids are stable for ever: rows in `suggestions` keep the id after retention has cleared any words,
 * and the writer's repeat and used rules key on it, so an item is only ever appended, never renamed
 * or removed.
 * Types are the ones an ask composes from words alone, so every suggestion can be sent as it is.
 *
 * The Traditional Chinese awaits a native reader's review, including whether an ask should address a
 * parent as 您 or as 你.
 */
import type { ComposableExchangeType, Lang, MVP_LANGS } from "@vela/contracts";

export const ASK_BANK_TYPES = [
  "question",
  "story",
  "recipe",
  "word",
] as const satisfies readonly ComposableExchangeType[];
export type AskBankType = (typeof ASK_BANK_TYPES)[number];

export const ASK_BANK_THEMES = ["life", "knowledge", "opinions"] as const;
export type AskBankTheme = (typeof ASK_BANK_THEMES)[number];

/**
 * The languages every item is written in: the MVP languages, so a language added there does not
 * compile until the bank speaks it.
 */
export type AskBankLang = (typeof MVP_LANGS)[number];

export interface AskBankItem {
  /** `<theme>.<area>.<slug>`: stable for ever, and never reused. */
  readonly id: string;
  readonly type: AskBankType;
  readonly theme: AskBankTheme;
  /**
   * What the ask is about. Two neighbouring days never share a topic, so topics are finer than an
   * id's area where one area holds a whole type (food, language).
   */
  readonly topic: string;
  /**
   * Items too close to ask within weeks of each other share a group ("your first job" and "your
   * first day at work"); every other item is a group of its own, named by its id.
   */
  readonly group: string;
  readonly text: Readonly<Record<AskBankLang, string>>;
}

function item(
  id: string,
  type: AskBankType,
  topic: string,
  en: string,
  zhTW: string,
  group: string = id,
): AskBankItem {
  const theme = ASK_BANK_THEMES.find((candidate) => id.startsWith(`${candidate}.`));
  if (theme === undefined) {
    throw new Error(`ask bank item ${id} names no theme`);
  }
  return { id, type, theme, topic, group, text: { en, "zh-TW": zhTW } };
}

export const ASK_BANK: readonly AskBankItem[] = [
  // Questions
  item(
    "life.childhood.home",
    "question",
    "childhood",
    "What did the house you grew up in look like?",
    "您小時候住的房子是什麼樣子？",
  ),
  item(
    "life.childhood.games",
    "question",
    "childhood",
    "What games did you play with other children when you were small?",
    "您小時候都和其他小朋友玩什麼遊戲？",
  ),
  item(
    "life.school.teacher",
    "question",
    "school",
    "Which teacher do you still remember, and why?",
    "您到現在還記得哪一位老師？為什麼？",
    "teacher",
  ),
  item(
    "life.work.first_job",
    "question",
    "work",
    "What was your very first job?",
    "您的第一份工作是什麼？",
    "first_job",
  ),
  item(
    "life.work.proud",
    "question",
    "work",
    "What work are you most proud of?",
    "您做過的事情裡，最讓您驕傲的是哪一件？",
  ),
  item(
    "life.place.street",
    "question",
    "neighbourhood",
    "What was the street you lived on as a young adult like?",
    "您年輕時住的那條街是什麼樣子？",
    "neighbourhood",
  ),
  item(
    "life.friends.best",
    "question",
    "friends",
    "Who was your best friend when you were young?",
    "您年輕時最要好的朋友是誰？",
  ),
  item(
    "life.seasons.festival",
    "question",
    "festivals",
    "Which festival did your family most enjoy when you were a child?",
    "您小時候，家裡最喜歡過哪一個節日？",
  ),
  item(
    "life.music.song",
    "question",
    "music",
    "What song takes you straight back to when you were young?",
    "哪一首歌會讓您一下子想起年輕的時候？",
  ),
  item(
    "knowledge.garden.plant",
    "question",
    "garden",
    "What is the easiest plant to grow at home?",
    "在家裡種什麼植物最容易？",
  ),
  item(
    "knowledge.home.fix",
    "question",
    "home",
    "What is something at home you know how to fix that most people don't?",
    "家裡有什麼東西，是您會修、但很多人不會修的？",
  ),
  item(
    "knowledge.food.market",
    "question",
    "market",
    "How do you pick good fruit at the market?",
    "您在市場買水果，都怎麼挑到好的？",
  ),
  item(
    "knowledge.home.tidy",
    "question",
    "home",
    "What is one thing every home should have, in your view?",
    "在您看來，每個家都應該有的一樣東西是什麼？",
  ),
  item(
    "opinions.advice.first_job",
    "question",
    "advice",
    "What advice would you give someone starting their first job?",
    "如果有人剛開始第一份工作，您會給什麼建議？",
    "first_job",
  ),
  item(
    "opinions.change.better",
    "question",
    "change",
    "What is one thing that is better now than when you were young?",
    "有什麼事情，現在比您年輕的時候更好？",
  ),
  item(
    "opinions.change.wish",
    "question",
    "change",
    "What is something from the old days you wish still existed?",
    "以前有什麼東西，您希望現在還有？",
  ),
  item(
    "opinions.taste.film",
    "question",
    "taste",
    "Which film or TV show do you think everyone should see?",
    "您覺得哪一部電影或連續劇，每個人都應該看？",
  ),
  item(
    "opinions.taste.season",
    "question",
    "taste",
    "Which season do you like best, and why?",
    "您最喜歡哪一個季節？為什麼？",
  ),
  item(
    "opinions.advice.dinner",
    "question",
    "family_meals",
    "What makes a family dinner a good one, in your view?",
    "在您看來，一頓好的家庭晚餐需要什麼？",
  ),
  item(
    "opinions.place.visit",
    "question",
    "travel",
    "If you could visit any place again, where would you go?",
    "如果可以再去一個地方走走，您想去哪裡？",
  ),
  // Stories
  item(
    "life.childhood.memory",
    "story",
    "childhood",
    "Tell me about a day from your childhood you still remember clearly.",
    "跟我說說您小時候記得最清楚的一天。",
  ),
  item(
    "life.work.first_day",
    "story",
    "work",
    "Tell me about your first day at work.",
    "跟我說說您第一天上班的情形。",
    "first_job",
  ),
  item(
    "life.friends.oldest",
    "story",
    "friends",
    "Tell me how you met your oldest friend.",
    "跟我說說您和認識最久的朋友是怎麼認識的。",
  ),
  item(
    "life.family.wedding",
    "story",
    "family",
    "Tell me about a wedding you remember.",
    "跟我說說一場您記得的婚禮。",
  ),
  item(
    "life.place.move",
    "story",
    "place",
    "Tell me about a time you moved to a new place.",
    "跟我說說您搬到新地方的那段日子。",
  ),
  item(
    "life.childhood.mischief",
    "story",
    "childhood",
    "Tell me about a time you got into a little trouble as a child.",
    "跟我說說您小時候調皮闖禍的一件事。",
  ),
  item(
    "life.family.grandparents",
    "story",
    "family",
    "Tell me about your grandparents.",
    "跟我說說您的爺爺奶奶或外公外婆。",
  ),
  item(
    "life.seasons.new_year",
    "story",
    "festivals",
    "Tell me about a New Year you remember well.",
    "跟我說說一個您記得很清楚的過年。",
    "new_year",
  ),
  item(
    "life.work.teacher",
    "story",
    "work",
    "Tell me about someone who taught you something important.",
    "跟我說說一位教會您重要事情的人。",
    "teacher",
  ),
  item(
    "life.place.trip",
    "story",
    "travel",
    "Tell me about the best trip you ever took.",
    "跟我說說您去過最棒的一趟旅行。",
  ),
  item(
    "life.school.day",
    "story",
    "school",
    "Tell me what a school day was like for you.",
    "跟我說說您上學的時候，一天是怎麼過的。",
  ),
  item(
    "life.home.neighbours",
    "story",
    "neighbourhood",
    "Tell me about the neighbours you had when you were young.",
    "跟我說說您年輕時的鄰居。",
    "neighbourhood",
  ),
  item(
    "life.change.television",
    "story",
    "change",
    "Tell me about the first time you watched television.",
    "跟我說說您第一次看電視的情形。",
  ),
  item(
    "opinions.advice.choice",
    "story",
    "advice",
    "Tell me about a choice you made that turned out well.",
    "跟我說說您做過的一個好決定。",
  ),
  item(
    "knowledge.craft.skill",
    "story",
    "craft",
    "Tell me how you learned something you are good at.",
    "跟我說說您是怎麼學會一樣拿手本事的。",
  ),
  item(
    "life.family.name",
    "story",
    "family",
    "Tell me the story behind your name.",
    "跟我說說您名字的由來。",
  ),
  // Recipes
  item(
    "knowledge.food.signature",
    "recipe",
    "cooking",
    "How do you make the dish everyone asks you for?",
    "大家最愛吃您做的那道菜，是怎麼做的？",
  ),
  item(
    "knowledge.food.breakfast",
    "recipe",
    "family_meals",
    "What was breakfast in your home growing up, and how was it made?",
    "您小時候家裡的早餐吃什麼？是怎麼做的？",
  ),
  item(
    "knowledge.food.soup",
    "recipe",
    "seasonal_food",
    "What soup do you make when the weather turns cold?",
    "天氣變冷的時候，您會煮什麼湯？",
  ),
  item(
    "knowledge.food.new_year",
    "recipe",
    "festivals",
    "Which dish do you make for New Year, and how?",
    "過年的時候您會做哪一道菜？怎麼做？",
    "new_year",
  ),
  item(
    "knowledge.food.snack",
    "recipe",
    "snacks",
    "What snack did you love as a child, and how is it made?",
    "您小時候最愛吃的點心是什麼？怎麼做？",
  ),
  item(
    "knowledge.food.preserve",
    "recipe",
    "preserving",
    "How do you pickle or preserve food at home?",
    "您在家裡都怎麼醃菜或保存食物？",
  ),
  item(
    "knowledge.food.secret",
    "recipe",
    "cooking",
    "What is the secret ingredient in one of your recipes?",
    "您有哪一道菜加了獨門配料？是什麼？",
  ),
  item(
    "knowledge.food.parents",
    "recipe",
    "family_meals",
    "What dish did your own parents cook that you still make?",
    "有哪一道菜是您爸媽以前常做、您現在也還在做的？",
  ),
  // Words
  item(
    "knowledge.language.saying",
    "word",
    "sayings",
    "Teach me a saying your parents used to say.",
    "教我一句您爸媽以前常說的話。",
  ),
  item(
    "knowledge.language.hometown",
    "word",
    "dialect",
    "Teach me a word from where you grew up.",
    "教我一個您家鄉的說法。",
  ),
  item(
    "knowledge.language.kitchen",
    "word",
    "kitchen",
    "Teach me what you call your favourite kitchen tool.",
    "教我您最喜歡的廚房用具怎麼稱呼。",
  ),
  item(
    "knowledge.language.blessing",
    "word",
    "festivals",
    "Teach me a good wish people say at New Year.",
    "教我一句您過年時常說的吉祥話。",
    "new_year",
  ),
  item(
    "knowledge.language.weather",
    "word",
    "sayings",
    "Teach me an old saying about the weather.",
    "教我一句您知道的、跟天氣有關的老話。",
  ),
  item(
    "knowledge.language.song",
    "word",
    "music",
    "Teach me a line from a song you used to sing.",
    "教我唱一句您以前常唱的歌。",
  ),
  item(
    "knowledge.language.nickname",
    "word",
    "nicknames",
    "Teach me a nickname you had, or gave someone, when you were young.",
    "教我一個您年輕時的綽號，或您幫別人取的綽號。",
  ),
  item(
    "opinions.language.favourite",
    "word",
    "words",
    "Teach me your favourite word, and tell me why you like it.",
    "教我一個您最喜歡的詞，再告訴我為什麼喜歡。",
  ),
];

const BY_ID: ReadonlyMap<string, AskBankItem> = new Map(ASK_BANK.map((entry) => [entry.id, entry]));

export function askBankItem(id: string): AskBankItem | undefined {
  return BY_ID.get(id);
}

function isWrittenIn(text: AskBankItem["text"], lang: Lang): lang is AskBankLang {
  // An own-property check, as `t()` makes, so a corrupt language value reads English rather than
  // an Object.prototype member.
  return Object.hasOwn(text, lang);
}

/** The item's text in `lang`; a language the bank is not written in reads the English. */
export function askBankText(id: string, lang: Lang): string | undefined {
  const found = BY_ID.get(id);
  if (found === undefined) {
    return undefined;
  }
  return isWrittenIn(found.text, lang) ? found.text[lang] : found.text.en;
}
