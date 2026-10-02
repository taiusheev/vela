# Staging test script: everything built 1–2 October 2026

For the founder, on staging, with the Android build from 2 October (EAS build `45eb0cd4`) and the staging bot **@VelaLightstagingbot**. Staging holds test data only. Each step says what you do and what you should see; tick it off, or note what you saw instead and send it to Claude.

**You need:** two Android phones (or one phone plus a second Telegram account on another device), your own Telegram, and the APK installed on both phones from the Expo build page. AI is off on staging, so there are no transcripts or summaries.

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

---

## If something is wrong

Write down the step number, what you did, and what you saw (a screenshot helps), and send it to Claude. Nothing here touches real families: staging is separate from production.
