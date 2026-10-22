import {
  type EligibilityLanguage,
  PUBLIC_ELIGIBILITY_TERMS_VERSION,
  PUBLIC_ELIGIBILITY_VERSION,
  type PublicEligibilityChoice,
} from "@vela/contracts";
export type EligibilityAnswer = "yes" | "no" | "unsure" | null;
export interface EligibilityReviewState {
  language: EligibilityLanguage;
  adult: EligibilityAnswer;
  taiwan: EligibilityAnswer;
  noticeRead: boolean;
  termsRead: boolean;
  clearFailed: boolean;
  status: "editing" | "saving" | "saved" | "clearing" | "failed";
}
export interface EligibilityReviewPort {
  record(choice: PublicEligibilityChoice, key: string): Promise<void>;
  clear(key: string): Promise<void>;
}
export function eligibilityReviewDecision(
  state: Pick<EligibilityReviewState, "adult" | "taiwan" | "noticeRead" | "termsRead">,
): "incomplete" | "outside_scope" | "ready" {
  if (
    state.adult === "no" ||
    state.adult === "unsure" ||
    state.taiwan === "no" ||
    state.taiwan === "unsure"
  )
    return "outside_scope";
  return state.adult === "yes" && state.taiwan === "yes" && state.noticeRead && state.termsRead
    ? "ready"
    : "incomplete";
}
/** No storage, account reads or network: the caller must explicitly supply its scoped port. */
export class EligibilityReviewController {
  private value: EligibilityReviewState;
  private listeners = new Set<() => void>();
  private disposed = false;
  private retryKey: string | null = null;
  private clearRetryKey: string | null = null;
  readonly scope: string;
  private port: EligibilityReviewPort;
  private key: () => string;
  constructor(
    scope: string,
    port: EligibilityReviewPort,
    key: () => string,
    language: EligibilityLanguage = "en",
  ) {
    this.scope = scope;
    this.port = port;
    this.key = key;
    this.value = {
      language,
      adult: null,
      taiwan: null,
      noticeRead: false,
      termsRead: false,
      clearFailed: false,
      status: "editing",
    };
  }
  snapshot = (): EligibilityReviewState => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(next: EligibilityReviewState) {
    if (this.disposed) return;
    this.value = next;
    for (const listener of this.listeners) listener();
  }
  change(
    patch: Partial<
      Pick<EligibilityReviewState, "adult" | "taiwan" | "noticeRead" | "termsRead" | "language">
    >,
  ) {
    if (
      this.disposed ||
      this.value.status === "saving" ||
      this.value.status === "clearing" ||
      this.value.status === "saved"
    )
      return;
    this.retryKey = null;
    const languageChanged = patch.language !== undefined && patch.language !== this.value.language;
    this.update({
      ...this.value,
      ...patch,
      ...(languageChanged ? { noticeRead: false, termsRead: false } : {}),
      status: "editing",
    });
  }
  async save() {
    if (
      this.disposed ||
      this.value.status === "saving" ||
      this.value.status === "saved" ||
      this.value.status === "clearing" ||
      eligibilityReviewDecision(this.value) !== "ready"
    )
      return;
    const choice: PublicEligibilityChoice = {
      version: PUBLIC_ELIGIBILITY_VERSION,
      terms_version: PUBLIC_ELIGIBILITY_TERMS_VERSION,
      language: this.value.language,
      adult_self_declared: true,
      residence_self_declared: "TW",
      notice_read: true,
      review_terms_acknowledged: true,
    };
    this.retryKey ??= this.key();
    this.update({ ...this.value, status: "saving" });
    try {
      await this.port.record(choice, this.retryKey);
      this.update({ ...this.value, status: "saved" });
    } catch {
      this.update({ ...this.value, status: "failed" });
    }
  }
  async clear() {
    if (this.disposed || this.value.status !== "saved") return;
    this.clearRetryKey ??= this.key();
    this.update({ ...this.value, clearFailed: false, status: "clearing" });
    try {
      await this.port.clear(this.clearRetryKey);
      this.clearRetryKey = null;
      this.retryKey = null;
      this.update({
        ...this.value,
        adult: null,
        taiwan: null,
        noticeRead: false,
        termsRead: false,
        clearFailed: false,
        status: "editing",
      });
    } catch {
      this.update({ ...this.value, clearFailed: true, status: "saved" });
    }
  }
  dispose() {
    this.disposed = true;
    this.listeners.clear();
  }
}
