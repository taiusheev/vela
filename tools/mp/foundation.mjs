import { Page, S, h, li } from "./lib.mjs";

export function foundation() {
  const pages = [];

  // 1.1 Mission
  {
    const p = new Page("1.1 · Mission and promise");
    let y = p.title("Mission", "Why Vela exists, in the words we will keep using.");
    p.box(40, y, 1320, 80, "<b style=\"font-size:14px\">Vela keeps a light on for the people we love who live alone or far away: one daily touch from their family, and the family knows the moment it goes quiet.</b>", S.cardAmber);
    y += 100;
    p.box(40, y, 640, 200, h("The world we are answering", [
      "Super-aged societies are here: Japan, Korea, Italy, Germany, Taiwan since 2025, China and the US next.",
      "Around 50 million people over 65 live alone in the ten richest ageing countries; the number grows every year.",
      "Behind each of them is a child, across town or across the world, who carries the same daily, unspoken worry: “she didn't pick up.”",
      "And in the same families, a 20-year-old and a 45-year-old, both busy, both wanting more from each other than a group chat that went quiet.",
    ]), S.card);
    p.box(720, y, 640, 200, h("The promise, in two halves", [
      "<b>Closer.</b> One moment a day from the people you love, then the app closes. Turns, prompts, grandchildren, translation, story day, memory. Free.",
      "<b>Calmer.</b> For whoever the family keeps a light on for: her answer lights a light the family sees; silence gets a plan, not a spiral; the family knows within hours and knows who is nearby. Paid.",
      "The name: <i>vela</i> is a candle; <i>velar</i> is to keep vigil. A light left on in the window. The family keeps it lit; the parent's answer is the glow.",
    ]), S.cardGreen);
    y += 220;
    p.box(40, y, 1320, 120, h("What Vela is not", li([
      "Not a device: nothing to install, wear, or charge for the eldest; she stays in the messenger she already uses.",
      "Not a monitor: nothing is detected; everything is expressed. She taps a heart or says “fine”. She sees what the family sees, and can say “stop”.",
      "Not an emergency service: the promise is “you'll know within hours, and you'll know who to call”, never “we'll save her”.",
      "Not a feed, not social media: no strangers, no ads, no infinite scroll, no notifications beyond the one moment. Screen time is a metric we want low.",
      "Not an ops company: no Vela staff on the ladder, no partners, no paid welfare checks. The family acts.",
    ])), S.cardGrey);
    pages.push(p);
  }

  // 1.2 The problem in numbers
  {
    const p = new Page("1.2 · The problem in numbers");
    let y = p.title("The problem in numbers", "Sources: research/06 (market size and customer), research/03 (East Asia), research/01 (US). Every figure is cited in those reports.");
    y = p.h2(y, "People living alone, by country");
    y = p.table(40, y, [{ w: 130, title: "Country" }, { w: 330, title: "65+ living alone" }, { w: 330, title: "Detail" }, { w: 330, title: "Projection" }, { w: 200, title: "Source" }], [
      ["United States", "~15–16M · 26% of 65+ (2023); women 31%, men 19%", "65–84: 24% · 85+: 38% · women 75+: ~42%", "~10M “solo agers” 80+ by 2038 (Harvard JCHS)", "Pew 2025, ACL, KFF"],
      ["Japan", "7.37M (2020) · men 15%, women 22% of 65+", "65+ single households 6.25M (2015) → 8.96M (2040); Tokyo 45.8% of elderly households solo by 2040", "10.8M by 2050 (20.6% of all households)", "IPSS, Cabinet Office 2025"],
      ["South Korea", "70+ alone: 2.21M (2025) · 23.6% of seniors live alone (record)", "32.6% of senior solo households have no one to talk to; 34.8% no one to call when sick", "Single-person households 9.71M by 2037", "Korea Herald, Korea Times, MOHW"],
      ["China", "“Empty-nest” 59.7% of 60+ (2021), >100M; ~25–30M truly alone", "Solitary elderly households 17.56M (2010) → 25.4M (2020); rural 62% empty-nest", "60+ > 300M during the 14th five-year plan", "gov.cn, SCMP, MCA"],
      ["Germany", "5.9M (2024) · 34% of 65+", "~1.2M Hausnotruf users vs ~8M 75+ → ~15% penetration", "—", "Destatis"],
      ["United Kingdom", "4.3M (2024), up from 3.5M (2014)", "51% of over-75s in England live alone; growth in solo living entirely driven by 65+", "—", "ONS"],
      ["Italy", "75+ alone: 2.4M · ~40% of 75+", "Telesoccorso regionally subsidised; “telecompagnia” human call tier exists", "—", "ISTAT 2025"],
      ["France", "75+ alone: 2.4M (2021) · 1 in 3 of 65+; 38.7% of women 75+", ">900k téléassistance subscribers; only 10–12% of 75+ equipped; 87% of relatives see it as a “marker of dependency”", "—", "INSEE, Cahiers Silver Économie"],
      ["Taiwan", "Super-aged since 2025 (20%+ of population 65+)", "The founder's second market; LINE is the channel", "—", "—"],
      ["Canada · Australia · EU-27", "CA 85+: 41.8% alone · AU >1.2M of 3.9M 65+ · EU 32.2% of 65+ (women 40%, men 22%)", "AU: 40% of women 75+, 22% of men 75+", "—", "StatCan, AIHW, Eurostat"],
    ]);
    y += 20;
    y = p.h2(y, "Why minutes matter");
    y = p.table(40, y, [{ w: 400, title: "Statistic" }, { w: 300, title: "Value" }, { w: 620, title: "What it means for Vela" }], [
      ["Share of 65+ who fall each year (US)", "~1 in 4", "The catastrophe is common, not rare"],
      ["Falls that become a “long lie” (>1 h on the floor)", "~1 in 5; roughly doubles mortality (JAGS meta-analysis)", "The product's value is minutes-to-discovery"],
      ["Mortality by time to help", "found <1 h: 12% · helpless >72 h: 67%", "Hours matter; days are fatal"],
      ["Fall deaths per 100k (US, 2023)", "65–74: 19 · 75–84: 75 · 85+: 339", "Risk rises steeply after 80"],
      ["Falls among pendant wearers that happen with the pendant off", "~3 in 4 (Univ. of Manchester 2023)", "Wearables fail on compliance, not detection"],
      ["Japan, 2024 (first full-year NPA count)", "76,020 died alone at home; 58,044 were 65+; 21,856 found after 8+ days; 4,538 (65+) found after a month", "The outcome every adult child is imagining"],
      ["Korea godoksa (lonely deaths)", "3,559 (2022) → 3,661 (2023), rising; isolated elders' suicide rate >2.3× co-residing", "Loneliness and safety are the same problem"],
      ["Solo elders' isolation", ">10 h a day with nobody present; in the 90s cohort 82% of falls happened alone", "Nobody is there; the family is the only signal"],
      ["Emergency vs reassurance (France, 7M alarm calls)", "~2% emergencies; 98% reassurance and social", "The daily job is reassurance; emergency is the rare exception"],
    ]);
    y += 20;
    y = p.h2(y, "The other side of the family");
    p.table(40, y, [{ w: 400, title: "Statistic" }, { w: 300, title: "Value" }, { w: 620, title: "Source" }], [
      ["US family caregivers, 2025", "63M (+20M in a decade); 59M care for adults; avg age 51; 3 in 5 women; 29% sandwich generation", "AARP/NAC Caregiving in the US 2025"],
      ["Long-distance caregivers", "nearly 1 in 3; 47% among caregivers under 50", "AARP/NAC 2025 (secondary summary)"],
      ["People living outside their birth country", "~300M (2024); largest origins India, Mexico, Russia, China, Philippines", "UN DESA, IOM"],
      ["Russian speakers who left after Feb 2022", "668k (2022) + 450k (2023); ~600k+ net abroad after returns", "Holod, MSK1"],
      ["Overseas Filipino workers · Indian diaspora", "2.19M OFWs (2024), $35.6B remittances (2025) · 18.5M Indians abroad, $135.5B remittances (FY25)", "PSA, BusinessWorld, IBEF"],
    ]);
    pages.push(p);
  }

  // 1.3 The worry, decomposed
  {
    const p = new Page("1.3 · The worry, decomposed");
    let y = p.title("What “peace of mind” is actually made of", "Five layers on the child's side, four on the parent's. The product must answer both or fail on one.");
    y = p.h2(y, "The adult child");
    y = p.table(40, y, [{ w: 160, title: "Layer" }, { w: 560, title: "What the child is actually feeling" }, { w: 600, title: "Evidence" }], [
      [{ label: "The spike", style: S.tdAmber }, "“She didn't pick up.” Minutes to hours of rehearsing the worst case, then relief, then nothing learned.", "r/AgingParents is full of these; France: 98% of alarm calls are reassurance; every interviewee will have a story"],
      [{ label: "The catastrophe", style: S.tdAmber }, "A fall or stroke, and nobody knows for a day, a week.", "Japan: 21,856 found 8+ days after death (2024); 1 in 5 falls a long lie; mortality 12% → 67% by time to help"],
      [{ label: "The slow slide", style: S.tdAmber }, "Is she eating? Sadder? Forgetting? Will I notice too late?", "Korea: 34.8% of solo elders have no one to call when sick; every sensor company sells “routine drift”"],
      [{ label: "The helplessness", style: S.tdAmber }, "Even if I knew something was wrong, what could I do from 8,000 km?", "Elders' own objection to sensors: “we don't know what we'd do if an alert fires”; scaled products all bolt a human onto the sensor"],
      [{ label: "The guilt", style: S.tdAmber }, "I should call more. I'm not a good daughter.", "Japanese families buy “after an accident” (34%); the purchase is often penance"],
    ]);
    y += 20;
    y = p.h2(y, "The parent");
    y = p.table(40, y, [{ w: 400, title: "The parent feels" }, { w: 920, title: "Evidence" }], [
      ["“I am not a patient. A pendant says I am.”", "87% of French families see telecare as a marker of dependency; US adoption flat at 9% of 65+ for a decade; 3 of 4 falls happen with the pendant off; “he'd rather stay on the floor for an hour”"],
      ["“Don't watch me.”", "Acceptance (Swiss national survey, n=1,211): wearables 81%, ambient sensors 59%, cameras 37%, bathroom cameras 29%; Yamato chose a light bulb because “sensors make elderly people feel watched”"],
      ["“I don't want to be a burden, but I am lonely.”", "NUGU's top use is companionship; Hyodol cut depression risk 36%; Snug's elders write “flooded with gratitude”; Famileo's grandparents keep the gazette"],
      ["“Unknown numbers are spam.”", "Iamfine's own reviews; inTouch tester's mother: “I would feel terrible… they are not bothered about phoning me”; Korean elders resent “mechanical care”"],
    ]);
    y += 20;
    p.box(40, y, 1320, 110, h("The insight that organises everything", [
      "<b>The spike happens because silence is ambiguous.</b> Today, silence means “could be anything.”",
      "Every product that ever delivered peace of mind did one thing: it made silence mean “nothing is wrong, because if it were, you'd know.”",
      "Detection accuracy, hardware, and AI are just different ways of earning the right to say that. Vela earns it with the family's own daily touch and the parent's own answer.",
    ]), S.cardGreen);
    pages.push(p);
  }

  return pages;
}
