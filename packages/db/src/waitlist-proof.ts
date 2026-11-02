/** Content-free proof of the public form against its intended database. Synthetic addresses only. */
export const WAITLIST_PROOF_ORIGINS = {
  "production-worker": "https://vela.vela-light.workers.dev",
  "public-domain": "https://vela-light.com",
} as const;

type Result = { rows: Record<string, unknown>[] };
export type WaitlistProofPorts = {
  query: (sql: string, parameters: string[]) => Promise<Result>;
  submit: (origin: string, email: string, language: string) => Promise<boolean>;
};

export async function proveWaitlist(
  ports: WaitlistProofPorts,
  target: keyof typeof WAITLIST_PROOF_ORIGINS,
  nonce: string,
): Promise<void> {
  if (
    !/^[a-f0-9]{32}$/.test(nonce) ||
    (target !== "public-domain" && target !== "production-worker")
  ) {
    throw new Error("invalid proof parameters");
  }
  const origin = WAITLIST_PROOF_ORIGINS[target];
  for (const language of ["en", "zh-TW"]) {
    const email = `vela-public-proof-${nonce}-${language.toLowerCase()}@example.invalid`;
    const exists = async () =>
      (await ports.query("select language from waitlist_signups where email = $1", [email])).rows;
    // Do not remove or overwrite a pre-existing entry, even in the reserved synthetic namespace.
    if ((await exists()).length !== 0) throw new Error("proof marker already exists");
    let cleanupFailed = false;
    try {
      if (!(await ports.submit(origin, email, language))) throw new Error("form refused");
      let rows = await exists();
      if (rows.length !== 1 || rows[0]?.language !== language) {
        throw new Error("signup not saved in intended database");
      }
      if (!(await ports.submit(origin, email, language))) throw new Error("duplicate refused");
      rows = await exists();
      if (rows.length !== 1 || rows[0]?.language !== language) {
        throw new Error("duplicate changed saved signup");
      }
    } finally {
      await ports.query("delete from waitlist_signups where email = $1", [email]);
      cleanupFailed = (await exists()).length !== 0;
    }
    if (cleanupFailed) throw new Error("synthetic cleanup failed");
  }
}
