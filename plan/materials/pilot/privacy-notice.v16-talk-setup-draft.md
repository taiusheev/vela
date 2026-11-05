# Privacy notice v16: "How do you and Mom talk?" (DRAFT)

Status: **draft, waits for the founder's yes.** Until then `TALK_SETUP` stays `off` in production (pinned in `apps/worker/src/wrangler-config.test.ts`) and production ignores these answers. Development and staging have it on for testing.

What changes from v15: onboarding v2 adds one setup screen. It asks how often the organiser and the invited person talk now, and what Vela should never bring up (four fixed topics, plus up to three words of the organiser's own). The Chinese is a draft until the native reader reviews it (vela-zh-tw).

Only the lines below change. Everything else in v15 stays as it is.

## English

**What we collect → App setup and local preview** (add after "…preferred ways of replying,"):

> The new onboarding also asks how often you and the invited person talk now, and what Vela should never bring up: money, health, work, their partner, or up to three words of your own (for example a name).

**What we collect → same paragraph** (add after "These help prepare the first week."):

> Vela's software uses what to avoid to keep those topics out of every question, including questions it writes in your name. It does this by matching words. These answers are never sent to an AI provider. Your own words are encrypted when stored, like messages.

**What we collect → same paragraph** (change the last sentences):

> Relationship, interests, reply preferences, how often you talk and what to avoid are kept with their member profile for the same period as their name and morning settings. You can ask the founder to correct or remove them.

**How long we keep it** (add a row):

> | How often you talk, and what Vela should never bring up | While the invited person is in the family; deleted with their member profile |

## 繁體中文

**我們收集的資料 →「App 設定與本機預覽」**（加在「……喜歡的回覆方式，」之後）：

> 新的設定流程也會詢問你和受邀家人現在多常聊天，以及 Vela 絕對不要提的事：錢、健康、工作、對方的另一半，或你自己寫的最多三個詞（例如一個名字）。

**同一段**（加在「這些資料用來準備第一週。」之後）：

> Vela 的程式會比對這些詞，讓每個問題都避開這些話題，包括以你的名義撰寫的問題。這些答案不會傳給任何 AI 服務。你自己寫的詞在儲存時會加密，和訊息一樣。

**同一段**（修改最後幾句）：

> 關係、興趣、回覆方式、聊天頻率和要避開的事，會和受邀家人的成員資料一起保存，保存期間與其名字和早晨設定相同。你可以請創辦人更正或刪除。

**保存期間**（新增一列）：

> | 聊天頻率，以及 Vela 絕對不要提的事 | 受邀家人仍在家庭中時保存；刪除成員資料時一併刪除 |

## Notes for the founder

- No consent-script change: this is the organiser's own setup answer, not something the invited person agrees to.
- Families already set up are not affected. The screen appears only in new setups.
- Turning it on in production is one small change: `TALK_SETUP` to `on`, plus a new release.
