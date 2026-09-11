import type { Lang } from "./types";

// Child-facing strings. Parent-facing strings live in parentText().
const CHILD = {
  ru: {
    welcome:
      "Здравствуйте. Я помогаю детям, которые живут далеко, каждое утро знать, что с родителями всё хорошо. Настроим за две минуты.\n\nКак вас зовут?",
    askParentName: "Как зовут вашего родителя? (например: Галина)",
    askAddress: "Как к нему или к ней обращаться в сообщениях? Например «Галина Петровна» или «мама».",
    askParentLang: "На каком языке писать родителю?",
    askParentTz: "Где живёт родитель? Выберите ближайший город, или напишите название зоны (например Asia/Irkutsk).",
    askWake: "Во сколько родитель обычно просыпается? Напишите время, например 7:30. Утреннее сообщение придёт через полчаса после этого.",
    askChildTz: "А где вы? Это нужно, чтобы не писать вам ночью.",
    badTime: "Не понял время. Напишите в формате 7:30.",
    badTz: "Не нашёл такую зону. Выберите город кнопкой или напишите название вроде Europe/Moscow.",
    done: (link: string, address: string) =>
      `Готово. Отправьте родителю эту ссылку и пару слов от себя:\n\n${link}\n\nКогда ${address} нажмёт «Старт», я начну желать доброго утра. Вам будет приходить короткая заметка каждый день, как только родитель ответит.\n\nЛюбое ваше сообщение мне я передам родителю с завтрашним утренним приветом. Команды: /status, /pause, /resume, /delete.`,
    noFamily: "Мы ещё не настроились. Нажмите /start.",
    relayed: "Передам завтра утром вместе с приветом.",
    paused: "Поставил на паузу. Утренних сообщений не будет, пока не напишете /resume.",
    resumed: "Продолжаем. Завтра утром всё как обычно.",
    deleted: "Всё удалено. Спасибо, что попробовали. Если захотите вернуться, нажмите /start.",
    status: (s: string) => s,
    parentJoined: (address: string) => `${address} подключилась. Первое утреннее сообщение придёт завтра.`,
    noteButton: "Мама сегодня пока не ответила на утреннее сообщение. Ничего страшного пока не известно. Мы написали ещё раз. Может, позвоните?",
    notePrefix: "",
  },
  en: {
    welcome:
      "Hello. I help children who live far away know every morning that their parents are okay. Setup takes two minutes.\n\nWhat's your name?",
    askParentName: "What's your parent's first name?",
    askAddress: "How should I address them in messages? For example \"Mrs Ivanova\", \"Galina\", or \"Mum\".",
    askParentLang: "Which language should I use with your parent?",
    askParentTz: "Where does your parent live? Pick the nearest city, or type a zone name (e.g. Asia/Irkutsk).",
    askWake: "What time does your parent usually wake up? Type a time like 7:30. The morning message goes out half an hour later.",
    askChildTz: "And where are you? So I never message you at night.",
    badTime: "I didn't get that time. Please type it like 7:30.",
    badTz: "I don't know that zone. Pick a city button or type a name like Europe/Moscow.",
    done: (link: string, address: string) =>
      `Done. Send your parent this link with a few words from you:\n\n${link}\n\nOnce ${address} taps Start, I'll begin the morning greetings. You'll get a short note every day as soon as they reply.\n\nAnything you write to me, I'll pass on with tomorrow's greeting. Commands: /status, /pause, /resume, /delete.`,
    noFamily: "We haven't set up yet. Tap /start.",
    relayed: "I'll pass it on with tomorrow morning's greeting.",
    paused: "Paused. No morning messages until you send /resume.",
    resumed: "Resumed. Tomorrow morning as usual.",
    deleted: "Everything is deleted. Thank you for trying. Tap /start if you ever want to come back.",
    status: (s: string) => s,
    parentJoined: (address: string) => `${address} has joined. The first morning message goes out tomorrow.`,
    noteButton: "Your parent hasn't answered this morning's message yet. Nothing worrying is known. We've sent a second one. Maybe give them a call?",
    notePrefix: "",
  },
};
export const t = (lang: Lang) => CHILD[lang];

export function langFromCode(code?: string): Lang {
  return code && code.toLowerCase().startsWith("ru") ? "ru" : "en";
}

// Parent-facing strings.
export function parentText(lang: Lang) {
  if (lang === "ru") {
    return {
      welcome: (address: string, child: string, time: string) =>
        `Здравствуйте, ${address}. ${child} попросила меня желать вам доброго утра. Каждый день в ${time} я спрошу, как вы. Нажмите «Всё хорошо» или напишите пару слов. Если не хотите, напишите «не надо», и я перестану.`,
      understood: "Понятно",
      okButton: "Всё хорошо ☀️",
      okReply: "Рад это слышать. Хорошего вам дня!",
      nudge: (address: string) => `${address}, вы там? Просто нажмите кнопку, когда увидите.`,
      voice: "Голосовые я пока не умею слушать, но главное, что вы на связи. Напишите пару слов или нажмите кнопку.",
      signoff: "Хорошего дня! Завтра снова напишу.",
      stopped: "Хорошо, больше не буду писать. Если передумаете, напишите «старт».",
      relayIntro: (child: string) => `${child} передаёт:`,
      morning: [
        (a: string) => `Доброе утро, ${a}! Как спалось?`,
        (a: string) => `${a}, доброе утро. Как вы сегодня?`,
        (a: string) => `Доброе утро, ${a}. Какие планы на день?`,
        (a: string) => `С добрым утром, ${a}! Как настроение?`,
        (a: string) => `Доброе утро, ${a}. Хорошо ли отдохнули?`,
        (a: string) => `${a}, с добрым утром! Что сегодня на завтрак?`,
        (a: string) => `Доброе утро, ${a}. Как самочувствие с утра?`,
      ],
    };
  }
  return {
    welcome: (address: string, child: string, time: string) =>
      `Hello, ${address}. ${child} asked me to wish you good morning. Every day at ${time} I'll ask how you are. Tap "I'm fine" or write a few words. If you'd rather not, write "stop" and I'll stop.`,
    understood: "Got it",
    okButton: "I'm fine ☀️",
    okReply: "Glad to hear it. Have a lovely day!",
    nudge: (address: string) => `${address}, are you there? Just tap the button when you see this.`,
    voice: "I can't listen to voice notes yet, but the main thing is you're in touch. Write a few words or tap the button.",
    signoff: "Have a good day! I'll write again tomorrow.",
    stopped: "Alright, I'll stop writing. If you change your mind, write \"start\".",
    relayIntro: (child: string) => `${child} says:`,
    morning: [
      (a: string) => `Good morning, ${a}! How did you sleep?`,
      (a: string) => `${a}, good morning. How are you today?`,
      (a: string) => `Good morning, ${a}. Any plans for the day?`,
      (a: string) => `Morning, ${a}! How's your mood today?`,
      (a: string) => `Good morning, ${a}. Did you rest well?`,
      (a: string) => `${a}, good morning! What's for breakfast?`,
      (a: string) => `Good morning, ${a}. How are you feeling this morning?`,
    ],
  };
}

export const STOP_WORDS = ["не надо", "ненадо", "хватит", "отстань", "stop", "стоп", "не пиши", "не пишите"];
export const START_WORDS = ["старт", "start", "давай", "пиши"];
