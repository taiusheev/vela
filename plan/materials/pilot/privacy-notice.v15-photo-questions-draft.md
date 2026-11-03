# Privacy notice v15: questions about box photos (draft, needs the founder's yes)

Drafted 3 November 2026 for ADR-61. Changes the approved photo box text
(`privacy-notice.v13-photo-box-approved.en.md`, which becomes v15 with the live notice). Production
keeps `PHOTO_QUESTION_AI` off (pinned in `apps/worker/src/wrangler-config.test.ts`) until this
wording is in the live notice in a release and the families are told.

## In "The photo box", replace the paragraph "What Vela does with it"

**What Vela does with it.** On mornings when nobody in the family wrote a question, about twice a week
and never two days running, Vela sends the person the light is for a photo from the box with a short
question about it. When the person who added the photo gave it their own question, Vela sends that
question as theirs, signed with their name. Otherwise Vela asks a short fixed question, signed by Vela:
an old photo asks for the story behind it; two new photos may ask which one they like more; the
family's line about a photo goes into that question as they wrote it. A question the family writes
for a morning always comes first.

## In "The photo box", replace the paragraph "No AI"

**Help with the question.** When someone adds a photo, they can ask Vela to suggest questions about
it. Vela then sends that one photo, the line written about it, the first name of the person adding it,
how they call the person the light is for, and up to three questions they asked that person before, to
OpenAI, which suggests up to three questions. Only the person adding the photo sees the suggestions;
they choose one, change it or write their own, and nothing is sent until a morning Vela shows the
photo. The suggestions are not kept. OpenAI handles the photo as described in "Who sees it". Photos
are only sent to OpenAI when someone asks for suggestions.

## In "Who sees it", the OpenAI row

Add to its uses: "suggested questions about a photo in the family's photo box, when the person adding
it asks (see "The photo box")". Add to what it receives: "that one photo and the line about it".

---

# 隱私權聲明 v15：相片盒照片的問題（草稿，需要發起人同意）

## 「相片盒」段落中，取代「Vela 怎麼使用」

**Vela 怎麼使用。** 在家人沒有寫問題的早上，大約一週兩次、且不會連續兩天，Vela 會從相片盒挑一張照片，配上一個簡短的問題傳給被留燈的家人。放照片的人如果替照片寫了自己的問題，Vela 會用這個人的名義傳出，署上這個人的名字。沒有寫問題時，Vela 會用固定的簡短問題，以 Vela 的名義傳出：老照片會請被留燈的家人說說照片背後的故事；兩張新照片可能會問比較喜歡哪一張；家人寫的那句話會照原樣放進問題裡。家人替某天早上寫的問題永遠優先。

## 「相片盒」段落中，取代「不使用 AI」

**幫忙想問題。** 放照片時，可以請 Vela 建議幾個關於這張照片的問題。這時 Vela 會把這一張照片、照片的那句話、放照片的人的名字、這個人怎麼稱呼被留燈的家人，以及這個人以前問過的最多三個問題，傳給 OpenAI，由 OpenAI 建議最多三個問題。只有放照片的人看得到這些建議；可以選一個、修改，或自己寫，在 Vela 某天早上傳出照片之前，什麼都不會送出。建議不會保存。OpenAI 處理照片的方式見「誰看得到」。只有在有人請 Vela 建議問題時，照片才會傳給 OpenAI。

## 「誰看得到」的 OpenAI 那一列

用途加上：「放照片的人請 Vela 建議時，提出關於家庭相片盒照片的問題（見「相片盒」）」。收到的資料加上：「那一張照片和照片的那句話」。
