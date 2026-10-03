# Staging test script: everything built 1–3 October 2026

For the founder, on staging, with the Android build from 2 October (EAS build `45eb0cd4`) and the staging bot **@VelaLightstagingbot**. Staging holds test data only. Each step says what you do and what you should see; tick it off, or note what you saw instead and send it to Claude.

## On an iPhone, without Android and without an Apple Developer account

1. On the iPhone, install **Expo Go** from the App Store (free).
2. The iPhone and the Mac must be on the same Wi-Fi, or the Mac on the iPhone's hotspot.
3. On the Mac, Claude starts the tab **"Vela on iPhone"** (`pnpm --filter @vela/app start:staging`), which shows a QR code. Point the iPhone's Camera at it and tap the banner: Vela opens inside Expo Go, talking to staging.
4. Use one iPhone for the organiser's steps. For her phone (sections 2–4), sign out and use **You → Her phone** on the same iPhone, or a second iPhone with Expo Go.

What Expo Go cannot do, which a real build can: no push notifications and no morning chime; and an iPhone cannot play voice notes recorded in Telegram (Telegram's Ogg format). Voice replies recorded in the app play fine.

---

**You need (Android):** two Android phones (or one phone plus a second Telegram account on another device), your own Telegram, and the APK installed on both phones from the Expo build page. AI is off on staging, so there are no transcripts or summaries.

---

## 1 · Set up a family (once)

1. On phone A, open Vela and sign up with a test email. Create a family for a kept-light member, "Mom", in Taipei.
2. Send the invite to your second Telegram account and tap **Start**, then **Yes, that's fine**.
   - ✅ The app's Today shows Mom's light as waiting, then lit after her first morning.
3. In You, add the family's Telegram group if you use one (optional: answers then show there).

## 2 · Her phone (parent surface)

1. On phone B, sign in as you, go to **You → Her phone → Set up this phone**. Allow notifications when asked.
   - ✅ Phone B now shows Mom's screen: her message in large type, big buttons, "Read this aloud".
2. Tap **Read this aloud**. ✅ The phone speaks the message.
3. Tap **🎙 Answer with your voice**, allow the microphone, say a sentence, tap **Stop**, **Listen**, then **Send my answer**.
   - ✅ Phone A's Today shows Mom answered.
   - ✅ If the family has a Telegram group, the voice message appears there.
4. Type a few words and **Send**. ✅ They show on Today too.

## 3 · Photos and voice to her phone

1. On phone A, **Ask** Mom with two photos ("Which one do you like more?") for tomorrow.
2. The next morning on phone B: ✅ both photos show, numbered 1 and 2, with buttons 1 and 2. Tap one.
3. On phone A, open today's exchange and use **🎙 Reply with your voice** and **📷 Reply with a photo**.
   - ✅ The photo shows as a picture under "What the family said".
4. The morning after: ✅ phone B shows the photo and a **▶ Play the voice message** button that plays your voice.
5. If someone sends a photo or voice note in the family's Telegram group as a reply, it should also reach phone B the next morning.

## 4 · Kitchen table

1. Turn phone B on its side (or stand a tablet). ✅ It shows the clock, the date, the message and **Answer**, and the screen stays on.
2. Tap anywhere. ✅ Her normal screen opens. Leave it alone for 6 minutes. ✅ It goes back to the table.
3. At her morning time: ✅ one chime.

## 5 · Someone nearby, and "Ask them to look in"

1. On phone A, **You → People nearby**, add "Anna, neighbour". Tap **Ask on Telegram** and send the message to a Telegram account that plays Anna (not your organiser account).
2. As Anna, open the link in Telegram. ✅ The bot asks, in your name, with **Yes, I'm happy to** / **No, thank you**. Tap Yes.
   - ✅ You get "Anna said yes…" on Telegram; People nearby shows Anna as "Said yes".
3. Make a quiet morning: don't answer as Mom on her next morning. After her quiet time, phone A shows the quiet sheet.
4. On the sheet, tap **Ask them to look in** next to Anna.
   - ✅ Anna gets "Mia asks: could you look in on Mom today?" with **I'll look in** / **Can't today**.
5. As Anna, tap **I'll look in**. ✅ You get "Anna will look in on Mom." and the sheet says so.
6. Now answer as Mom. ✅ Anna gets "Mom has answered now, so there is no need to look in."
7. As Anna, send **stop**. ✅ Anna is removed, and People nearby no longer lists her.
8. Optional: invite someone and tap **No**. ✅ They are deleted at once.

## 6 · Story day and the family book

1. On phone A, open the **Sunday** tab. ✅ At the bottom, "Story day" offers a story question for Mom's next Sunday.
2. Tap **Another question** once. ✅ A different question appears. Tap **Ask it on Sunday**.
   - ✅ It says the question is on its way for Sunday.
3. On Sunday morning, answer as Mom: on Telegram with words or a voice note, or on her phone with **🎙 Answer with your voice**.
   - ✅ On Telegram, her thanks says "Your story is kept in the family book." with **Don't keep this one**.
4. On phone A, Sunday tab → **Read the family book**. ✅ The story shows: the question, who asked, her words, and **▶ Her voice** when she answered by voice on her phone.
5. As Mom on Telegram, tap **Don't keep this one**. ✅ She is told the story is no longer in the book, and it is gone from the book on phone A.
6. Optional, as an organiser: on another story, tap **Take this story out of the book**. ✅ It disappears.

Not there yet: voting on questions, and a PDF of the book.

---

## If something is wrong

Write down the step number, what you did, and what you saw (a screenshot helps), and send it to Claude. Nothing here touches real families: staging is separate from production.
