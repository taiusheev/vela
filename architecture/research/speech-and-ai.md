# Speech and AI stack: due-diligence research (September 2026)

Scope: STT, TTS, translation, LLM layer, evals, safety for Vela (~1 voice note + 5 short LLM calls/family/day; 1k/10k/100k families; near-zero budget pre-revenue; quality on elderly Mandarin over latency; async OK; "the light" never depends on AI).

Method note: Anthropic's pricing was fetched directly from `platform.claude.com/docs/en/about-claude/pricing` (official, in-page dated). Most other vendor prices below come from pricing-aggregator sites (costbench, tokenmix, diyai, brasstranscripts, texttolab, etc.) dated September 2026 in their own bylines — marked **[aggregator]**, secondary evidence, not the raw vendor page. WER/quality claims from a vendor's own blog are **[vendor-run]**; claims from papers/leaderboards are **[independent]**. Where evidence was thin (elderly Taiwanese-Mandarin specifically), that gap is named, not filled in.

## 1. Recommendation in ten lines

1. **STT default:** Deepgram Nova-3 (batch) for triage — cheapest mainstream vendor with code-switching and a documented training opt-out (`mip_opt_out`) — cascaded to OpenAI gpt-4o-transcribe when confidence is low.
2. **STT second opinion:** self-host SenseVoice/FunASR (open source) behind a small GPU or Groq-hosted Whisper as fallback — it is the only option here explicitly tuned for Mandarin dialects/accents (2–3% WER on AISHELL-1 vs Whisper-Small's 10% [vendor-run]), and Groq's Whisper hosting is ~$0.0007–0.002/min, near-free at our volume.
3. **TTS default:** Azure Neural/HD zh-TW voices ($16–22/1M chars) for reading replies aloud — mature zh-TW locale support and the clearest enterprise compliance paper trail; **on-device `expo-speech`** (native iOS/Android voices, $0) is the zero-dependency fallback that keeps the daily loop alive with no API at all.
4. **TTS upgrade path:** ElevenLabs Flash ($0.05/1k chars) or Fish Audio ($15/1M chars) if Azure sounds too robotic — both rate well for Mandarin/Japanese naturalness; we do not clone family voices (consent law and our own policy both rule it out), so cloning features are irrelevant either way.
5. **Translation default:** LLM translation via Claude Sonnet 5, not DeepL or Google Translate — third-party comparisons consistently show LLMs preserve Japanese/Chinese honorifics and address forms that DeepL/Google flatten, which is exactly the failure Vela must avoid between a grandchild and a grandmother.
6. **Translation fallback only:** DeepL API (now supports zh-Hant, $5/1M input chars) as a cheap cross-check — but it has no formality control for Chinese or Japanese, so it must never be the primary path for family-register text.
7. **LLM, high-volume/low-stakes tasks** (chips, ask suggestions): Claude Haiku 4.5 ($1/$5 per MTok, batch) — cheapest tier, plenty for templated drafting.
8. **LLM, judgment tasks** (concern flagging, weekly read, translation): Claude Sonnet 5 ($2/$10 per MTok, 1M context) — best quality/cost balance where the expensive failure is a missed health flag, not a token bill.
9. **Batch + caching is not optional:** every non-realtime call should use the Batch API (50% off) with a cached system prompt (up to 90% off repeats) — at our async-tolerant volume this roughly halves LLM spend.
10. **Evals:** Promptfoo (free, open-source, YAML golden-set, CI-friendly) for a 50–200-case pre-merge gate, paired with Langfuse (MIT-licensed, free self-hosted) for production tracing — the cheapest combination giving a solo builder both a quality gate and observability.

## 2. Comparison tables

### 2.1 Speech-to-text

| Option | Price (≈/min) | zh-TW/ja/de/hi | Quality evidence | Retention/region | Verdict |
|---|---|---|---|---|---|
| OpenAI gpt-4o-transcribe / mini | $0.006 / $0.003 [aggregator] | Broad multilingual, no zh-TW-specific WER published | None found for elderly/Mandarin | No training on API data by default; ZDR for eligible customers (Aug 2026) | Strong second-opinion model |
| Deepgram Nova-3 (batch) | $0.0043–0.0052 [aggregator] | Multilingual variant: 10 languages + code-switching; monolingual expanded to 30+ incl. Mandarin/Cantonese | Vendor WER claims only | MIP training program is opt-in; `mip_opt_out` flag | Cheapest mainstream, opt-out documented |
| AssemblyAI Universal-3.5 Pro | ~$0.0035 ($0.21/hr) [aggregator] | English-centric; code-switch WER 7.69% [vendor-run] | 5.6% mean WER English vs 6.1% (Universal-2) [vendor-run] | Documented training opt-out | Good for English/code-switch, weak Mandarin evidence |
| Google Chirp 3 | $0.016/min tier-1, batch to $0.003 [aggregator] | 85+ languages; zh-TW support **unconfirmed in public docs — verify directly** | None found | Standard GCP terms, APAC regions available | Only if already on GCP; confirm zh-TW first |
| Azure AI Speech | $0.0167/min, fast-endpoint $0.011 [aggregator] | 100+ languages, broad zh/ja/de/hi | None found for Mandarin specifically | Most complete compliance docs of the majors | Safe, unglamorous |
| Speechmatics | $0.013–0.022/min [aggregator] | 55+ languages, single-pass code-switch, no hint needed | New Melia-1: 6.4% aggregate WER, 14-model benchmark [source independence unconfirmed] | Enterprise/on-prem option | Interesting code-switch story, mid-pack price |
| ElevenLabs Scribe v2 | $0.22/hr batch, $0.39/hr real-time [aggregator] | 99 languages | Vendor claims beat Gemini/OpenAI/Deepgram [vendor-run — caution] | Standard ToS | Fine if already paying for ElevenLabs TTS |
| Amazon Transcribe | ~$0.024/min [aggregator] | Broad incl. zh/ja | None found | Standard AWS terms | Unremarkable |
| Gladia (Solaria-1) | $0.61/hr → $0.20/hr at 10k hrs/mo [aggregator] | Broad multilingual | No independent WER | EU-based vendor | Cheap at scale, thin evidence |
| Rev.ai (Reverb) | ~$0.003/min [aggregator] | Not confirmed for zh-TW | Not confirmed | — | Human tier ($1.99/min) not relevant here |
| **Whisper on Groq** (open source) | **$0.0007–0.0019/min** [aggregator] | Whisper's published language set incl. zh/ja/de/hi | 2.7% WER LibriSpeech, 8–12% "real-world" English [aggregator]; no elderly/Mandarin number | Self-managed | Near-free bulk/fallback tier |
| **SenseVoice/FunASR** (open source) | Free weights, compute only | Mandarin, Cantonese, English, Japanese, Korean, **7 Chinese dialect groups + 26 regional accents** (Fun-ASR-Nano) | SenseVoice-Small 2.96% / Large 2.09% WER on AISHELL-1 vs Whisper-Small 10.04% [vendor-run]; 5–15x faster | Fully self-hosted | **Best fit on paper for Taiwanese-accented Mandarin** — must validate against real elderly-parent audio |
| NVIDIA Canary-Qwen/Parakeet | Free weights or GPU-second | Canary-Qwen is **English-only** | 5.63% WER, tops HF Open ASR Leaderboard (English) [independent] | Self-hosted | Not useful for Mandarin-first product |
| Cloudflare Workers AI (Whisper) | $0.00045–0.00051/min [aggregator] | Whisper's set | Same Whisper caveats | Cloudflare edge terms | Cheapest hosted Whisper, good for prototyping |

**Elderly/accented-speech evidence (general, not Vela-specific):** a JAMIA study on long-term-care interview speech found 48.3% WER at baseline, 24.3% after fine-tuning on matched data [independent, PMC9933064]. Age, regional accent, and dialect measurably raise WER versus benchmark test sets [independent, arXiv 2604.24770, 2508.08684]. **No vendor here publishes a WER number for Taiwanese-accented Mandarin from speakers 70+** — the single biggest evidence gap in this report; treat marketed accuracy as an upper bound only.

### 2.2 Text-to-speech

| Option | Price | Naturalness for 75-y/o | Cloning stance | Verdict |
|---|---|---|---|---|
| ElevenLabs (v2/v3, Flash) | $0.10/1k chars (v2/v3), $0.05/1k (Flash) [aggregator] | Widely rated most natural conversational voice | Requires consent + verification (12+ US states now have voice-cloning consent laws) | Best-in-class if quality demands it; irrelevant to clone anyway since we read with a stock voice |
| OpenAI gpt-4o-mini-tts | $0.60/1M input + $12/1M audio-output tokens ≈ $0.015/min [aggregator] | Decent, less zh/ja-specialized than Azure/Fish | Standard ToS, no cloning without enterprise program | Fine if consolidating vendors |
| **Azure Neural/HD (zh-TW)** | Standard $16/1M, HD $22/1M (cut from $30, Mar 2026) [aggregator] | Mature zh-TW neural voices | Enterprise ToS, clear compliance docs | **Default** for reading replies aloud |
| Google Chirp 3 HD | $30/1M chars [aggregator; free-tier figure varied 1M–4M across sources, confirm] | Strong HD tier | Standard GCP terms | Comparable to Azure; pick one cloud |
| Amazon Polly | Standard $4/1M, Neural $16/1M, Generative $30/1M [aggregator] | Neural tier acceptable | Standard AWS | Cheapest "good enough" |
| Cartesia (Sonic 3) | ~$50/1M chars [aggregator] | Optimized for latency we don't need (async is fine) | Standard ToS | Deprioritize |
| **Fish Audio** | $15/1M chars [aggregator] | Best WER/speaker-similarity in many non-English languages incl. zh/ja/ko on a multilingual benchmark [third-party, not independently verified] | Standard ToS | Attractive upgrade path; verify with a real listening test |
| MiniMax (speech-2.6) | Not fully priced | Marketed for long-form consistency | China-based, dual mainland/US-West endpoints | **Data-residency caution** — explicit decision, not default, for health-adjacent content |
| PlayHT | — | — | Discontinued (Meta acquired PlayAI Jul 2025, shut down ~6 months later) [aggregator] | Remove from consideration |
| **On-device (`expo-speech`)** | **$0** | Apple: 38 voices; Android: 281 voices, quality/coverage varies by OS, historically buggy for non-English on Android | No data leaves device | **Zero-dependency fallback** so "the light" never depends on any API |

### 2.3 Translation (register-preserving, en/zh-TW/ja/de/hi)

| Option | Price | Evidence | Verdict |
|---|---|---|---|
| Claude/GPT LLM translation | Ordinary LLM token pricing (§2.4) | Third-party comparisons rank Claude ≈ GPT-4o above Google Translate/Gemini/DeepL for en↔ja/zh, citing correct contextual (not literal) handling of honorifics like "yoroshiku onegaishimasu" [aggregator synthesis, not a single peer-reviewed study] | **Primary path** |
| DeepL API | $5/1M input chars beyond 500K free/month [aggregator, Jul 2026] | Added zh-Hant as a supported target [official DeepL press/blog]; **formality control excludes Chinese and Japanese** [aggregator] | Cheap cross-check only, never primary |
| Google Translate | Commodity pricing | Ranked below Claude/GPT, roughly at/below DeepL in the same comparison | Last-resort fallback |

### 2.4 LLM layer

**Anthropic** (official, `platform.claude.com/docs/en/about-claude/pricing`):

| Model | In/Out per MTok | Cache read | Context | Batch in/out |
|---|---|---|---|---|
| Opus 5 | $5 / $25 | $0.50 | 1M | $2.50 / $12.50 |
| **Sonnet 5** | **$2 / $10** | $0.20 | 1M (128K max out) | $1 / $5 |
| **Haiku 4.5** | **$1 / $5** | $0.10 | 200K | $0.50 / $2.50 |
| Fable 5.1 / Mythos 5.1 (top tier) | $10 / $50 | $0.25 (deepest cache discount, 0.025x) | 1M | $5 / $25 |

Batch (50% off) and caching (up to 90% off reads) stack. Data residency: global is default and cheapest; `inference_geo:"us"` adds 1.1x; Bedrock/Vertex regional endpoints add ~10%. Structured Outputs (public beta) now guarantees schema-conformant JSON via grammar-constrained tool-use — directly useful for concern-flag/chip schemas.

**OpenAI** (GPT-5.6 family, aggregator-sourced): flagship `gpt-5.6-sol` $5/$30 ($0.50 cached input); mid `gpt-5.6-terra` $2/$12; budget `gpt-5.6-luna` $0.20/$1.20. Zero Data Retention reaffirmed for eligible API customers (Aug 2026), plus a new "Private Safety Processing" layer; no training on API data by default.

**Google** (Gemini 3.x, aggregator-sourced): `2.5 Flash-Lite` $0.10/$0.40 (cheapest); `3.5 Flash` $1.50/$9.00 (**last** tier with EU data residency + EU processing); `3.1 Pro` $2.00/$12.00; `3.8 Flash` (Sep 2, 2026) intro $0.75/$3.75, doubling Jan 1 2027. Newer 3.6–3.8 Flash are global-only — relevant for any German-based family member needing EU-resident processing.

**Task → model:** understanding/summary → Sonnet 5 (batch); concern flagging → Sonnet 5 (sync, never Haiku — highest stakes); chips and ask-suggestion → Haiku 4.5 (batch); weekly read → Sonnet 5 (batch, cached prompt); translation → Sonnet 5 (sync for same-day, batch otherwise).

### 2.5 Evals and tracing

| Tool | Cost | Fit |
|---|---|---|
| **Promptfoo** | Free/open-source; cost is setup time (~4–8 hrs) [aggregator] | Best for the 50–200-case CI gate — YAML in-repo, runs on every PR |
| **Langfuse** | MIT, free self-hosted; managed Cloud Core ~$115/mo for a moderate suite [aggregator] | Best for production tracing once live; self-host to stay free through 10K families |
| LangSmith | Free under 5,000 traces/mo; Plus $99/mo | Fine to start, ceiling hit quickly at our volumes |
| Braintrust | Pro $249/mo, 50k scores included | Worth it later, when human-review throughput (not tooling) is the bottleneck |
| W&B Weave | Not evaluated in depth | Deprioritized versus the Promptfoo+Langfuse combination |

Architecture: Promptfoo golden set (50–200 real+synthetic cases weighted toward Taiwanese-accented Mandarin, code-switching, register shifts, and both false-negative and false-positive health flags) gates every prompt change in CI; Langfuse traces every production call; weekly manual sampling feeds new cases back into the golden set.

## 3. Cost per family per month (assumptions shown)

Assumptions: 30 voice notes/month (~0.5 min avg), 150 routine LLM calls/month (~600 in + 150 out tokens, cached/batched), 4 weekly-read calls/month (~3,000 in + 500 out), 30 TTS replies/month (~300 chars); STT = Deepgram Nova-3 batch; LLM = Claude Sonnet 5 + Haiku 4.5 mix, batch+cache applied to ~80% of calls; TTS = Azure Neural HD. **These are estimates, not measured production data.**

| Component | Volume/family/mo | Unit cost | Est. cost/family/mo |
|---|---|---|---|
| STT (Deepgram Nova-3, batch) | 15 min | $0.0052/min | ~$0.08 |
| LLM routine (Haiku 4.5, batch+cache) | ~112K tok | ~$0.5/MTok blended | ~$0.06 |
| LLM judgment (Sonnet 5, sync) | ~45K tok | ~$3/MTok blended | ~$0.14 |
| LLM weekly read (Sonnet 5, batch+cache) | ~14K tok | ~$1.5/MTok blended | ~$0.02 |
| TTS (Azure Neural HD) | 9,000 chars | $22/1M | ~$0.20 |
| **Total AI cost/family/month** | | | **≈ $0.50** |

Scaled: **≈ $500 / $5,000 / $50,000 per month** at 1k / 10k / 100k families, before any negotiated volume discounts (Anthropic, Google, Azure, and Deepgram all offer these above list-price tiers) and before platform/storage/ops costs. Trivial pre-revenue at 1k families; a real budget line at 100k, which argues for keeping batch+cache discipline as volume grows and revisiting self-hosted SenseVoice/Groq-Whisper once volume justifies the ops overhead.

## 4. Prompt and eval architecture

Store every system prompt as a versioned file in-repo (one per task: concern-flag, chips, ask-suggestion, weekly-read, translation), semantically tagged, with the version logged against every production call in Langfuse. Every non-free-text task returns a fixed JSON schema via Structured Outputs/strict tool-use (concern-flag: `{flag, category, severity, evidence_quote}`; chips: array of exactly 3 strings; ask-suggestion: fixed object) — this both improves reliability and constrains output shape even if input was manipulated. The golden set (50–200 cases) should over-weight the known-hard cases: Taiwanese-accented Mandarin, code-switched Mandarin/English, a grandchild's casual register needing to become respectful register for a grandparent, borderline non-actionable health mentions (catches over-flagging), and clearly actionable ones (catches under-flagging, the costlier failure). Promptfoo blocks any PR that regresses flag recall or translation/chip judge scores; a weekly manual sample of flagged/unflagged production calls (from Langfuse) feeds back into the golden set.

## 5. Risks and fallbacks

- **Provider outage:** queue and retry rather than block, given async tolerance — Deepgram → OpenAI gpt-4o-transcribe → self-hosted Whisper/SenseVoice for STT; Sonnet 5 → a same-tier OpenAI/Gemini model for LLM, since all three now support comparable structured-output guarantees.
- **Quality on elderly/accented Mandarin:** the least-evidenced area in this whole stack (§2.1). Build the golden set with real elderly-parent audio as early as possible, benchmark Deepgram/OpenAI/self-hosted SenseVoice against it in parallel, and let measured WER — not vendor marketing — pick the default; budget time to fine-tune an open model on Common-Voice zh-TW or real data if commercial vendors underperform.
- **Health-content policy:** Anthropic's usage policy treats medical diagnosis as high-risk (human review + AI disclosure required) but exempts wellness advice; Vela's "flag for family, never diagnose" pattern fits the lower-risk category by design, but this should be confirmed in writing with Anthropic before scaling, not assumed. OpenAI's standard API tier is not HIPAA-BAA-eligible (only ChatGPT Enterprise/Edu with a sales-managed account, or the new Healthcare/Clinicians products) — a signed BAA with any vendor requires a direct enterprise conversation, not self-serve terms.
- **Prompt injection via family messages:** treat every family reply as untrusted input. Mitigate with a hardened system prompt refusing role-switching/instruction-following from message content, strict output schemas that constrain shape regardless of injected content, and — matching Vela's existing product principle — no autonomous third-party contact or action by the model; it only ever drafts content a human sends.
- **China-hosted vendors (MiniMax, or any Chinese model called via a mainland-hosted API):** treat as an explicit, disclosed choice given health-adjacent content, not a default; prefer self-hosting open-source Chinese models (SenseVoice, Fun-ASR) on infrastructure you control.
- **DeepL's Chinese/Japanese formality gap:** never route final family-facing translations through DeepL alone; use only as a fallback/cross-check against the LLM's translation.

---

### Sources (representative, accessed September 2026)

1. Anthropic Pricing — https://platform.claude.com/docs/en/about-claude/pricing (official, fetched directly)
2. OpenAI, "Offering Zero Data Retention for frontier models" — https://openai.com/index/offering-zero-data-retention-for-frontier-models/
3. OpenAI, "Introducing OpenAI for Healthcare" — https://openai.com/index/openai-for-healthcare/
4. OpenAI Services Agreement — https://openai.com/policies/services-agreement/
5. Anthropic, "Updating our Usage Policy" — https://www.anthropic.com/news/updating-our-usage-policy
6. DeepL, "DeepL Translator now supports Traditional Chinese" — https://www.deepl.com/en/blog/deepl-translator-now-supports-traditional-chinese
7. DeepL, "DeepL expands language offering with Traditional Chinese" — https://www.deepl.com/en/press-release/deepl-expands-language-offering-with-traditional-chinese
8. DeepL developer changelog — https://developers.deepl.com/docs/resources/roadmap-and-release-notes
9. Google Cloud, Chirp 3 HD docs — https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd
10. Google Cloud, Gemini Enterprise data residency — https://docs.cloud.google.com/gemini/enterprise/docs/locations
11. Deepgram, "Model Improvement Partnership Program" — https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program
12. AssemblyAI, "Opt out of data sharing for model training" — https://support.assemblyai.com/articles/5930031898-how-to-opt-out-of-data-sharing-for-model-training
13. AssemblyAI benchmark docs — https://www.assemblyai.com/docs/pre-recorded-audio/benchmarks
14. ElevenLabs, Speech-to-Text/Scribe docs — https://elevenlabs.io/docs/overview/capabilities/speech-to-text
15. ElevenLabs API pricing — https://elevenlabs.io/pricing/api
16. Hugging Face, FunAudioLLM/SenseVoiceSmall — https://huggingface.co/FunAudioLLM/SenseVoiceSmall
17. FunASR blog, "FunASR vs faster-whisper: Chinese & Cantonese" — https://www.funasr.com/en/blog/funasr-vs-faster-whisper-chinese.html
18. JAMIA/PMC, ASR model from long-term-care interview data — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9933064/
19. arXiv 2604.24770, "Elderly-Contextual Data Augmentation via Speech Synthesis for Elderly ASR"
20. arXiv 2508.08684, "Evaluating State-of-the-Art ASR for Clinical Applications for Older Adults"
21. Mozilla Data Collective, Common Voice Chinese (Taiwan) — https://mozilladatacollective.com/datasets/cmn2g7eaj01fio10769r1m96n
22. Groq pricing summary — https://www.cloudzero.com/blog/groq-pricing/
23. Cloudflare Workers AI pricing — https://developers.cloudflare.com/workers-ai/platform/pricing/
24. MiniMax API Privacy Policy — https://platform.minimax.io/protocol/privacy-policy
25. Fish Audio, "S2.1 Pro: Free Text-to-Speech API" — https://fish.audio/blog/s2-1-pro-free-api/
26. Braintrust, "LangSmith alternatives 2026" — https://www.braintrust.dev/articles/langsmith-alternatives-2026
27. Aggregator pricing pages cross-checked for figures above (Sept 2026 in-page dates, secondary evidence): costbench.com, tokenmix.ai, diyai.io, brasstranscripts.com, texttolab.com, convertaudiototext.com, benchlm.ai, aipricing.guru, eesel.ai.

**Flagged estimates throughout:** all [aggregator]/[vendor-run] tags above; the entire §3 cost table; Fish Audio's "best in 11/24 languages" claim (methodology unverified); Speechmatics' Melia-1 "6.4% WER" claim (independence unconfirmed); and, above all, the absence of any vendor-published WER for elderly Taiwanese-Mandarin speech.
