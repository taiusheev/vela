/**
 * Vela's question bank: the asks tomorrow's suggestion is drawn from (build plan 3.3), in English
 * and Traditional Chinese. Each item is worded twice. `child` is the ask as a son or daughter would
 * write it to their parent (founder, 17 October 2026: "in a style that the adult child asking their
 * mom"): what "Use this" puts in the Ask field, what the chat offers to start with, and what the
 * evening prompt suggests. `text` is the same ask in Vela's own plain voice, which Vela sends in its
 * own name on a morning nobody in the family wrote for (`takeFallbackQuestion`); it claims no
 * family memory, since a bank item is never sent as a person (ADR-49). Every item is about her life, her knowledge,
 * or her opinions, never how she is; `ask-bank.test.ts` holds both wordings to the rules of
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
  /** Vela's own plain wording, for the morning Vela asks it in its own name. */
  readonly text: Readonly<Record<AskBankLang, string>>;
  /** The family's wording: a son or daughter writing to their parent. */
  readonly child: Readonly<Record<AskBankLang, string>>;
}

type PlainItem = Omit<AskBankItem, "child">;

function item(
  id: string,
  type: AskBankType,
  topic: string,
  en: string,
  zhTW: string,
  group: string = id,
): PlainItem {
  const theme = ASK_BANK_THEMES.find((candidate) => id.startsWith(`${candidate}.`));
  if (theme === undefined) {
    throw new Error(`ask bank item ${id} names no theme`);
  }
  return { id, type, theme, topic, group, text: { en, "zh-TW": zhTW } };
}

const PLAIN: readonly PlainItem[] = [
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
  // Appended 10 October 2026 (product week): twelve weeks without a repeat.
  item(
    "life.childhood.toy",
    "question",
    "childhood",
    "What was your favourite toy as a child?",
    "您小時候最喜歡的玩具是什麼？",
  ),
  item(
    "life.school.subject",
    "question",
    "school",
    "Which school subject did you like most, and why?",
    "您上學時最喜歡哪一科？為什麼？",
  ),
  item(
    "life.work.colleague",
    "question",
    "work",
    "Who was the best person you ever worked with?",
    "您一起工作過最好的同事是誰？",
  ),
  item(
    "life.place.hometown",
    "question",
    "hometown",
    "What has changed most in your hometown since you were young?",
    "從您小時候到現在，家鄉變得最多的是什麼？",
  ),
  item(
    "life.family.parents_work",
    "question",
    "family",
    "What work did your parents do when you were small?",
    "您小時候，爸媽是做什麼工作的？",
  ),
  item(
    "life.money.first_buy",
    "question",
    "money",
    "What was the first thing you bought with your own money?",
    "您用自己賺的錢買的第一樣東西是什麼？",
  ),
  item(
    "life.friends.weekends",
    "question",
    "friends",
    "What did you and your friends do for fun on weekends?",
    "您年輕時週末都和朋友做些什麼？",
  ),
  item(
    "life.home.first_home",
    "question",
    "home_life",
    "What was the first home of your own like?",
    "您第一個自己的家是什麼樣子？",
  ),
  item(
    "life.place.getting_around",
    "question",
    "transport",
    "How did people get around town when you were young?",
    "您年輕的時候，大家在城裡都怎麼出門？",
  ),
  item(
    "life.music.dance",
    "question",
    "music",
    "What dance did people love when you were young?",
    "您年輕的時候，大家最愛跳什麼舞？",
  ),
  item(
    "knowledge.home.stain",
    "question",
    "home",
    "What is your best trick for getting a stain out?",
    "要把衣服上的污漬洗掉，您有什麼好方法？",
  ),
  item(
    "knowledge.garden.flower",
    "question",
    "garden",
    "Which flower would you plant first in a new garden?",
    "如果有一個新花園，您會先種哪一種花？",
  ),
  item(
    "knowledge.money.groceries",
    "question",
    "money",
    "What is your best tip for saving money on groceries?",
    "買菜的時候，您有什麼省錢的好方法？",
  ),
  item(
    "knowledge.craft.mend",
    "question",
    "craft",
    "What is the most useful thing you know how to sew or mend?",
    "您會縫補的東西裡，最實用的是什麼？",
  ),
  item(
    "knowledge.weather.rain",
    "question",
    "weather",
    "How can you tell rain is coming without a forecast?",
    "不看氣象預報，您怎麼知道快要下雨了？",
  ),
  item(
    "opinions.taste.book",
    "question",
    "taste",
    "Which book or story would you want every child to know?",
    "您希望每個孩子都知道哪一本書或哪一個故事？",
  ),
  item(
    "opinions.advice.lasting",
    "question",
    "advice",
    "What makes a marriage or a friendship last, in your view?",
    "在您看來，婚姻或友情要長久，最重要的是什麼？",
  ),
  item(
    "opinions.change.letters",
    "question",
    "change",
    "Which do you prefer, letters or mobile phones, and why?",
    "寫信和手機，您比較喜歡哪一個？為什麼？",
  ),
  item(
    "opinions.taste.holiday",
    "question",
    "celebrations",
    "What is your favourite way to spend a day off?",
    "放假的時候，您最喜歡怎麼過？",
  ),
  item(
    "opinions.place.city",
    "question",
    "places",
    "Would you rather live in a big city or a small town, and why?",
    "您比較喜歡住在大城市還是小鎮？為什麼？",
  ),
  item(
    "life.childhood.summer",
    "story",
    "childhood",
    "Tell me about a summer you remember from when you were young.",
    "跟我說說您年輕時記得的一個夏天。",
  ),
  item(
    "life.family.parents_met",
    "story",
    "family",
    "Tell me how your parents met, if you know the story.",
    "如果您知道，跟我說說您爸媽是怎麼認識的。",
  ),
  item(
    "life.work.unforgettable",
    "story",
    "work",
    "Tell me about a day at work you will never forget.",
    "跟我說說您工作時永遠忘不了的一天。",
  ),
  item(
    "life.home.kindness",
    "story",
    "kindness",
    "Tell me about a time a neighbour or a stranger helped you.",
    "跟我說說有一次鄰居或陌生人幫了您的事。",
  ),
  item(
    "life.place.journey",
    "story",
    "transport",
    "Tell me about your first long journey by train, bus or boat.",
    "跟我說說您第一次搭火車、公車或船出遠門的經過。",
  ),
  item(
    "life.friends.adventure",
    "story",
    "friends",
    "Tell me about an adventure you had with a friend.",
    "跟我說說您和朋友一起經歷的一次冒險。",
  ),
  item(
    "life.school.funny",
    "story",
    "school",
    "Tell me about something funny that happened at school.",
    "跟我說說上學時發生過的一件趣事。",
  ),
  item(
    "life.seasons.celebration",
    "story",
    "celebrations",
    "Tell me about a birthday or celebration you remember well.",
    "跟我說說一個您記得很清楚的生日或慶祝。",
  ),
  item(
    "life.change.telephone",
    "story",
    "change",
    "Tell me about the first time you used a telephone.",
    "跟我說說您第一次打電話的情形。",
  ),
  item(
    "opinions.advice.mistake",
    "story",
    "advice",
    "Tell me about a mistake that taught you something useful.",
    "跟我說說一個讓您學到東西的錯誤。",
  ),
  item(
    "knowledge.craft.handmade",
    "story",
    "craft",
    "Tell me about something you made with your own hands.",
    "跟我說說一樣您親手做的東西。",
  ),
  item(
    "life.family.children",
    "story",
    "family",
    "Tell me what your children were like when they were small.",
    "跟我說說您的孩子小時候是什麼樣子。",
  ),
  item(
    "knowledge.food.folded",
    "recipe",
    "cooking",
    "How do you make dumplings, or another dish you fold by hand?",
    "您怎麼包餃子，或做其他要用手包的菜？",
  ),
  item(
    "knowledge.food.dessert",
    "recipe",
    "desserts",
    "What dessert do you make for special days, and how?",
    "特別的日子您會做什麼甜點？怎麼做？",
  ),
  item(
    "knowledge.food.hot_drink",
    "recipe",
    "drinks",
    "How do you make your favourite hot drink?",
    "您最喜歡的熱飲是怎麼泡的？",
  ),
  item(
    "knowledge.food.leftovers",
    "recipe",
    "cooking",
    "What do you cook with leftovers so nothing is wasted?",
    "剩菜您都怎麼煮，才不會浪費？",
  ),
  item(
    "knowledge.food.hot_weather",
    "recipe",
    "seasonal_food",
    "What do you cook when the weather is hot?",
    "天氣熱的時候，您會煮什麼？",
  ),
  item(
    "knowledge.food.street",
    "recipe",
    "street_food",
    "Which street food from your youth can you make at home?",
    "您年輕時吃過的哪一樣小吃，您在家也會做？",
  ),
  item(
    "knowledge.food.staple",
    "recipe",
    "staples",
    "How do you make the rice, noodles or bread your family eats most?",
    "您家裡最常吃的飯、麵或麵食，是怎麼做的？",
  ),
  item(
    "knowledge.language.rhyme",
    "word",
    "games",
    "Teach me a rhyme you chanted in games as a child.",
    "教我一段您小時候玩遊戲時唸的童謠。",
  ),
  item(
    "knowledge.language.market",
    "word",
    "market",
    "Teach me what sellers used to call out at the market.",
    "教我以前市場裡小販的叫賣聲。",
  ),
  item(
    "knowledge.language.grandparents",
    "word",
    "family_words",
    "Teach me what you called your grandparents, and what the word means.",
    "教我您以前怎麼稱呼爺爺奶奶，那個稱呼是什麼意思。",
  ),
  item(
    "knowledge.language.kind_words",
    "word",
    "words",
    "Teach me a kind thing people often said to each other when you were young.",
    "教我一句您年輕時大家常互相說的好話。",
  ),
  item(
    "knowledge.language.proverb",
    "word",
    "sayings",
    "Teach me a proverb about work or patience.",
    "教我一句跟工作或耐心有關的諺語。",
  ),
  item(
    "knowledge.language.family_cooking",
    "word",
    "kitchen",
    "Teach me a cooking word that only your family uses.",
    "教我一個只有您家裡才用的做菜說法。",
  ),
  item(
    "opinions.language.funny",
    "word",
    "humour",
    "Teach me a funny expression that always makes you laugh.",
    "教我一句總是讓您發笑的有趣說法。",
  ),
];

/**
 * Each item as the family writes it, by id: warm, first person, the way a grown child texts a parent
 * ("I realised I don't know what your very first job was"). Never "Mom" or a name, since the parent
 * may be a father or a grandparent and the reader's own word for them goes in front when they want
 * it. The Traditional Chinese uses 你, as family members write to each other, and awaits a native
 * reader's review with the rest of the bank.
 */
const CHILD_VOICE: Readonly<Record<string, Readonly<Record<AskBankLang, string>>>> = {
  "life.childhood.home": {
    en: "I was trying to picture the house you grew up in. What did it look like?",
    "zh-TW": "我突然很好奇你小時候住的房子，長什麼樣子？",
  },
  "life.childhood.games": {
    en: "What games did you play with the other kids when you were little? I bet they were better than ours.",
    "zh-TW": "你小時候都跟其他小朋友玩什麼？一定比我們那時候好玩吧。",
  },
  "life.school.teacher": {
    en: "Is there a teacher you still think about? I'd love to know who, and why.",
    "zh-TW": "有沒有哪個老師，你到現在還會想起來？為什麼？",
  },
  "life.work.first_job": {
    en: "I realised I don't know what your very first job was. What was it?",
    "zh-TW": "我發現我不知道你的第一份工作是什麼，可以跟我說嗎？",
  },
  "life.work.proud": {
    en: "Of all the work you've done, what are you proudest of? I'd really like to know.",
    "zh-TW": "你做過的這麼多工作裡，最讓你驕傲的是哪一個？",
  },
  "life.place.street": {
    en: "What was your street like when you first lived on your own?",
    "zh-TW": "你剛開始自己生活的時候，住的那條街是什麼樣子？",
  },
  "life.friends.best": {
    en: "Who was your best friend when you were young? You've never really told me.",
    "zh-TW": "你年輕時最好的朋友是誰？你好像沒跟我說過。",
  },
  "life.seasons.festival": {
    en: "Which festival did your family love most when you were a kid?",
    "zh-TW": "你小時候，家裡最期待哪一個節日？",
  },
  "life.music.song": {
    en: "Which song takes you straight back to being young? I want to listen to it too.",
    "zh-TW": "哪一首歌一聽就讓你回到年輕的時候？我也想聽聽看。",
  },
  "knowledge.garden.plant": {
    en: "I want to grow something at home. What's the easiest plant to start with?",
    "zh-TW": "我想在家裡種點東西，哪一種植物最好養？",
  },
  "knowledge.home.fix": {
    en: "What's something at home you can fix that most people can't? I should learn it.",
    "zh-TW": "家裡有什麼東西是你會修、別人都不會的？我應該學起來。",
  },
  "knowledge.food.market": {
    en: "How do you pick good fruit at the market? Mine never tastes as good.",
    "zh-TW": "去市場要怎麼挑水果？我買的常常不甜。",
  },
  "knowledge.home.tidy": {
    en: "What's the one thing you think every home should have? I'm making a list.",
    "zh-TW": "你覺得每個家裡一定要有的東西是什麼？我在列清單。",
  },
  "opinions.advice.first_job": {
    en: "If someone was starting their first job tomorrow, what would you tell them?",
    "zh-TW": "如果有人明天第一天上班，你會給對方什麼建議？",
  },
  "opinions.change.better": {
    en: "What's one thing that's better now than when you were young?",
    "zh-TW": "有什麼事情是現在比你年輕的時候更好的？",
  },
  "opinions.change.wish": {
    en: "What's something from the old days you wish we still had?",
    "zh-TW": "以前有什麼東西，你很希望現在還有？",
  },
  "opinions.taste.film": {
    en: "Which film or show should I watch next? I trust your taste.",
    "zh-TW": "你覺得我下一部該看哪一部電影或節目？我相信你的眼光。",
  },
  "opinions.taste.season": {
    en: "Which season do you like best, and why? I can never decide mine.",
    "zh-TW": "你最喜歡哪個季節？為什麼？我自己一直選不出來。",
  },
  "opinions.advice.dinner": {
    en: "What makes a family dinner a really good one, in your view?",
    "zh-TW": "你覺得怎樣的家庭晚餐，才算是一頓好晚餐？",
  },
  "opinions.place.visit": {
    en: "If you could go back to any place you've been, where would you go?",
    "zh-TW": "如果可以再回到去過的任何地方，你最想去哪裡？",
  },
  "life.childhood.memory": {
    en: "Tell me about a day from when you were little that you still remember clearly. I'd love to hear it.",
    "zh-TW": "跟我說說你小時候到現在還記得很清楚的一天。",
  },
  "life.work.first_day": {
    en: "What was your first day at work like? Tell me everything you remember.",
    "zh-TW": "你第一天上班是什麼情況？把你記得的都跟我說。",
  },
  "life.friends.oldest": {
    en: "How did you meet your oldest friend? I don't think I've ever heard the story.",
    "zh-TW": "你是怎麼認識你最老的朋友的？我好像從來沒聽過這個故事。",
  },
  "life.family.wedding": {
    en: "Tell me about a wedding you remember. Whose was it, and what happened?",
    "zh-TW": "跟我說一場你印象很深的婚禮，是誰的？發生了什麼事？",
  },
  "life.place.move": {
    en: "Tell me about a time you moved somewhere new. What was the hardest part?",
    "zh-TW": "跟我說說你搬到新地方的那一次，最難適應的是什麼？",
  },
  "life.childhood.mischief": {
    en: "Did you ever get into trouble as a kid? I want the whole story.",
    "zh-TW": "你小時候有沒有闖過禍？我想聽完整的故事。",
  },
  "life.family.grandparents": {
    en: "Tell me about your grandparents. I know so little about them.",
    "zh-TW": "跟我說說你的祖父母吧，我知道的好少。",
  },
  "life.seasons.new_year": {
    en: "Tell me about a New Year you remember well. What made it special?",
    "zh-TW": "跟我說一個你印象最深的新年，那年有什麼特別的？",
  },
  "life.work.teacher": {
    en: "Who taught you something that really stuck? Tell me about them.",
    "zh-TW": "誰教過你一件讓你記一輩子的事？跟我說說這個人。",
  },
  "life.place.trip": {
    en: "What was the best trip you ever took? Tell me about it so I can picture it.",
    "zh-TW": "你去過最棒的一趟旅行是哪裡？說給我聽，讓我想像一下。",
  },
  "life.school.day": {
    en: "What was a normal school day like for you? Walk me through it.",
    "zh-TW": "你上學的時候，一天是怎麼過的？從早上說給我聽。",
  },
  "life.home.neighbours": {
    en: "Tell me about the neighbours you had growing up. Were there any real characters?",
    "zh-TW": "跟我說說你小時候的鄰居，有沒有很特別的人？",
  },
  "life.change.television": {
    en: "Do you remember the first time you watched television? Tell me about it.",
    "zh-TW": "你還記得第一次看電視的情景嗎？說給我聽。",
  },
  "opinions.advice.choice": {
    en: "Tell me about a choice you made that turned out well. I could use the inspiration.",
    "zh-TW": "跟我說一個你做過、後來證明是對的決定，我想參考一下。",
  },
  "knowledge.craft.skill": {
    en: "How did you get so good at the thing you're best at? Tell me how you learned.",
    "zh-TW": "你最拿手的那件事，當初是怎麼學會的？",
  },
  "life.family.name": {
    en: "What's the story behind your name, and who chose it?",
    "zh-TW": "你的名字是怎麼來的？是誰取的？",
  },
  "knowledge.food.signature": {
    en: "Everyone asks for that one dish of yours. Will you tell me how you make it?",
    "zh-TW": "大家都想吃你的拿手菜，可以教我怎麼做嗎？",
  },
  "knowledge.food.breakfast": {
    en: "What was breakfast like at home when you were growing up, and how was it made?",
    "zh-TW": "你小時候家裡早餐都吃什麼？是怎麼做的？",
  },
  "knowledge.food.soup": {
    en: "When it gets cold I always think of your soup. How do you make it?",
    "zh-TW": "天氣一變冷我就想到你煮的湯，那要怎麼煮？",
  },
  "knowledge.food.new_year": {
    en: "Which dish do you always make for New Year? I want to learn it this year.",
    "zh-TW": "過年你一定會做的那道菜，今年我想學起來，怎麼做？",
  },
  "knowledge.food.snack": {
    en: "What snack did you love as a kid? We should make it together sometime.",
    "zh-TW": "你小時候最愛吃什麼點心？哪天我們一起做做看。",
  },
  "knowledge.food.preserve": {
    en: "How do you pickle or preserve things at home? I want to try.",
    "zh-TW": "你在家是怎麼醃菜或保存食物的？我想試試看。",
  },
  "knowledge.food.secret": {
    en: "What's the secret ingredient in one of your recipes? I promise to keep it in the family.",
    "zh-TW": "你哪道菜有秘密配方？我保證只留在家裡。",
  },
  "knowledge.food.parents": {
    en: "Which dish from your own parents do you still make? I'd like to keep it going.",
    "zh-TW": "你爸媽以前煮的菜，哪一道你到現在還在做？我想傳下去。",
  },
  "knowledge.language.saying": {
    en: "What was that saying your parents always used? I want to remember it.",
    "zh-TW": "你爸媽以前常掛在嘴邊的那句話是什麼？我想記下來。",
  },
  "knowledge.language.hometown": {
    en: "Teach me a word from where you grew up. I want to try saying it.",
    "zh-TW": "教我一個你家鄉的說法，我想學著講講看。",
  },
  "knowledge.language.kitchen": {
    en: "What do you call your favourite kitchen tool? I always forget the word.",
    "zh-TW": "你最愛用的那個廚房工具叫什麼？我老是忘記。",
  },
  "knowledge.language.blessing": {
    en: "What's a good New Year wish I could say this year? Teach me one.",
    "zh-TW": "今年過年我可以說什麼吉祥話？教我一句。",
  },
  "knowledge.language.weather": {
    en: "Is there an old saying about the weather you grew up with? Teach me.",
    "zh-TW": "有沒有你從小聽到大的天氣俗語？教我一句。",
  },
  "knowledge.language.song": {
    en: "Teach me a line from a song you used to sing. I'll try singing it back.",
    "zh-TW": "教我一句你以前常唱的歌，我唱回給你聽。",
  },
  "knowledge.language.nickname": {
    en: "Did you have a nickname when you were young, or give anyone one? Tell me.",
    "zh-TW": "你年輕時有沒有綽號？還是你幫別人取過？",
  },
  "opinions.language.favourite": {
    en: "What's your favourite word, and why do you like it so much?",
    "zh-TW": "你最喜歡哪一個詞？為什麼特別喜歡？",
  },
  "life.childhood.toy": {
    en: "What was your favourite toy when you were little? I'm trying to picture it.",
    "zh-TW": "你小時候最喜歡的玩具是什麼？我想像不出來。",
  },
  "life.school.subject": {
    en: "Which subject did you like best at school, and why?",
    "zh-TW": "你上學的時候最喜歡哪一科？為什麼？",
  },
  "life.work.colleague": {
    en: "Who was the best person you ever worked with, and what made them so good?",
    "zh-TW": "你共事過最好的人是誰？那個人好在哪裡？",
  },
  "life.place.hometown": {
    en: "What's changed most in your hometown since you were young?",
    "zh-TW": "你的家鄉跟你小時候比，變最多的是什麼？",
  },
  "life.family.parents_work": {
    en: "What work did your parents do when you were small? I don't think I know.",
    "zh-TW": "你小時候，你爸媽是做什麼工作的？我好像不知道。",
  },
  "life.money.first_buy": {
    en: "What was the first thing you bought with your own money? I bet you still remember.",
    "zh-TW": "你用自己賺的錢買的第一樣東西是什麼？還記得嗎？",
  },
  "life.friends.weekends": {
    en: "What did you and your friends do on weekends when you were young?",
    "zh-TW": "你年輕的時候，週末都跟朋友做什麼？",
  },
  "life.home.first_home": {
    en: "What was your first home of your own like? I wish I'd seen it.",
    "zh-TW": "你第一個自己的家是什麼樣子？真希望我看過。",
  },
  "life.place.getting_around": {
    en: "How did people get around town when you were young: bus, bike, or on foot?",
    "zh-TW": "你年輕的時候，大家都怎麼在城裡移動？公車、腳踏車還是走路？",
  },
  "life.music.dance": {
    en: "What dance did everyone do when you were young? I want to see if you still can.",
    "zh-TW": "你年輕的時候大家都跳什麼舞？你現在還會跳嗎？",
  },
  "knowledge.home.stain": {
    en: "I've got a stain that won't come out. What's your best trick?",
    "zh-TW": "我有個污漬洗不掉，你有什麼好方法？",
  },
  "knowledge.garden.flower": {
    en: "If you had a new garden, which flower would you plant first?",
    "zh-TW": "如果有一個新的花園，你第一個會種什麼花？",
  },
  "knowledge.money.groceries": {
    en: "What's your best tip for saving money on groceries? I need it.",
    "zh-TW": "買菜要怎麼省錢？教我一招，我很需要。",
  },
  "knowledge.craft.mend": {
    en: "What's the most useful thing you know how to sew or mend? I can't even do a button.",
    "zh-TW": "你會縫補的東西裡，最實用的是什麼？我連釦子都不會縫。",
  },
  "knowledge.weather.rain": {
    en: "How can you tell rain is coming without a forecast? You always seem to know.",
    "zh-TW": "不看天氣預報，要怎麼知道快下雨了？你好像都知道。",
  },
  "opinions.taste.book": {
    en: "Which book or story should every child know? I want to read it to the kids.",
    "zh-TW": "你覺得哪一本書或哪個故事，每個小孩都該知道？",
  },
  "opinions.advice.lasting": {
    en: "What do you think makes a marriage or a friendship last? I'd like your view.",
    "zh-TW": "你覺得婚姻或友情要長久，最重要的是什麼？",
  },
  "opinions.change.letters": {
    en: "Letters or mobile phones: which do you prefer, and why?",
    "zh-TW": "寫信和手機，你比較喜歡哪一個？為什麼？",
  },
  "opinions.taste.holiday": {
    en: "What's your idea of a perfect day off? I want to plan one for you.",
    "zh-TW": "對你來說，最完美的休假日是什麼樣子？我想幫你安排一天。",
  },
  "opinions.place.city": {
    en: "Big city or small town: where would you rather live, and why?",
    "zh-TW": "大城市還是小鎮，你比較想住哪裡？為什麼？",
  },
  "life.childhood.summer": {
    en: "Which summer from when you were young do you still remember? Tell me about it.",
    "zh-TW": "跟我說說你年輕時印象最深的一個夏天。",
  },
  "life.family.parents_met": {
    en: "Do you know how your parents met? I'd love to hear the story.",
    "zh-TW": "你知道你爸媽是怎麼認識的嗎？我好想聽這個故事。",
  },
  "life.work.unforgettable": {
    en: "Was there a day at work you'll never forget? Tell me what happened.",
    "zh-TW": "有沒有哪一天上班讓你一輩子忘不了？發生了什麼事？",
  },
  "life.home.kindness": {
    en: "Tell me about a time a neighbour or a stranger helped you out.",
    "zh-TW": "跟我說說有一次鄰居或陌生人幫了你的事。",
  },
  "life.place.journey": {
    en: "What was your first long trip by train, bus or boat like? Tell me about it.",
    "zh-TW": "你第一次搭火車、公車或船出遠門，是什麼情形？",
  },
  "life.friends.adventure": {
    en: "Tell me about an adventure you had with a friend. The wilder the better.",
    "zh-TW": "跟我說一次你跟朋友的冒險，越精彩越好。",
  },
  "life.school.funny": {
    en: "What's the funniest thing that happened at your school? I need a laugh.",
    "zh-TW": "你上學時發生過最好笑的事是什麼？我需要笑一下。",
  },
  "life.seasons.celebration": {
    en: "Tell me about a birthday or celebration you remember really well.",
    "zh-TW": "跟我說一個你記得很清楚的生日或慶祝。",
  },
  "life.change.telephone": {
    en: "Do you remember the first time you used a telephone, and who you called?",
    "zh-TW": "你還記得第一次打電話嗎？是打給誰？",
  },
  "opinions.advice.mistake": {
    en: "Tell me about a mistake that taught you something useful. I'm collecting lessons.",
    "zh-TW": "跟我說一個讓你學到東西的錯誤，我在收集人生功課。",
  },
  "knowledge.craft.handmade": {
    en: "What's something you made with your own hands that you were proud of?",
    "zh-TW": "你親手做過、讓你很得意的東西是什麼？",
  },
  "life.family.children": {
    en: "What were we like when we were little? Tell me something I don't remember.",
    "zh-TW": "我們小時候是什麼樣子？說一件我不記得的事。",
  },
  "knowledge.food.folded": {
    en: "How do you make dumplings, or anything you fold by hand? I want to learn properly.",
    "zh-TW": "你包餃子或其他手包的東西是怎麼做的？我想好好學。",
  },
  "knowledge.food.dessert": {
    en: "Which dessert do you make for special days? I'd love you to teach me.",
    "zh-TW": "特別的日子你都做什麼甜點？可以教我嗎？",
  },
  "knowledge.food.hot_drink": {
    en: "How do you make your favourite hot drink? I want mine to taste like yours.",
    "zh-TW": "你最喜歡的熱飲是怎麼泡的？我想泡得跟你一樣好喝。",
  },
  "knowledge.food.leftovers": {
    en: "What do you cook with leftovers so nothing goes to waste? I always throw too much away.",
    "zh-TW": "剩菜你都怎麼煮才不浪費？我老是丟掉太多。",
  },
  "knowledge.food.hot_weather": {
    en: "What do you like to cook when it's hot out? I need ideas.",
    "zh-TW": "天氣熱的時候你都煮什麼？給我一點靈感。",
  },
  "knowledge.food.street": {
    en: "Which street food from your youth could you make at home? Show me how.",
    "zh-TW": "你年輕時吃的哪一種小吃可以在家做？教我怎麼做。",
  },
  "knowledge.food.staple": {
    en: "How do you make the rice, noodles or bread we always eat? Mine never comes out right.",
    "zh-TW": "我們家常吃的飯、麵或麵包，你是怎麼做的？我做的總是不對。",
  },
  "knowledge.language.rhyme": {
    en: "Teach me a rhyme you chanted in games as a kid. I'll teach it to the little ones.",
    "zh-TW": "教我一首你小時候玩遊戲時念的童謠，我想教給小朋友。",
  },
  "knowledge.language.market": {
    en: "What did sellers call out at the market when you were young? Teach me one.",
    "zh-TW": "你小時候市場的小販都怎麼吆喝？教我一句。",
  },
  "knowledge.language.grandparents": {
    en: "What did you call your grandparents, and what does the word mean?",
    "zh-TW": "你以前怎麼稱呼你的祖父母？那個稱呼是什麼意思？",
  },
  "knowledge.language.kind_words": {
    en: "What was a kind thing people often said to each other when you were young?",
    "zh-TW": "你年輕的時候，大家常互相說的一句暖心話是什麼？",
  },
  "knowledge.language.proverb": {
    en: "Is there a proverb about work or patience you live by? Teach it to me.",
    "zh-TW": "有沒有一句關於工作或耐心的諺語，是你一直記著的？教我。",
  },
  "knowledge.language.family_cooking": {
    en: "Is there a cooking word only our family uses? Teach me so it doesn't get lost.",
    "zh-TW": "有沒有只有我們家才用的廚房用語？教我，免得失傳。",
  },
  "opinions.language.funny": {
    en: "What's a funny expression that always makes you laugh? I need a new one.",
    "zh-TW": "有什麼好笑的說法每次都讓你笑出來？教我一個新的。",
  },
};

export const ASK_BANK: readonly AskBankItem[] = PLAIN.map((entry) => {
  const child = CHILD_VOICE[entry.id];
  if (child === undefined) {
    throw new Error(`ask bank item ${entry.id} has no family wording`);
  }
  return { ...entry, child };
});

const BY_ID: ReadonlyMap<string, AskBankItem> = new Map(ASK_BANK.map((entry) => [entry.id, entry]));

export function askBankItem(id: string): AskBankItem | undefined {
  return BY_ID.get(id);
}

function isWrittenIn(text: AskBankItem["text"], lang: Lang): lang is AskBankLang {
  // An own-property check, as `t()` makes, so a corrupt language value reads English rather than
  // an Object.prototype member.
  return Object.hasOwn(text, lang);
}

/**
 * The item in Vela's own words in `lang`, for a morning Vela asks it; a language the bank is not
 * written in reads the English.
 */
export function askBankText(id: string, lang: Lang): string | undefined {
  const found = BY_ID.get(id);
  if (found === undefined) {
    return undefined;
  }
  return isWrittenIn(found.text, lang) ? found.text[lang] : found.text.en;
}

/** The item as the family writes it, in `lang`, or in English where the bank has no `lang`. */
export function askBankChildText(id: string, lang: Lang): string | undefined {
  const found = BY_ID.get(id);
  if (found === undefined) {
    return undefined;
  }
  return isWrittenIn(found.child, lang) ? found.child[lang] : found.child.en;
}
