import {
  ApiIdempotencyKey,
  MemoryShareChoice,
  MemorySharePrepared,
  MemorySharePreview,
  MemoryShareRecipients,
  MemoryShareSaved,
  MemoryShareStopped,
  MemorySharingView,
} from "@vela/contracts";
import { type MemorySharingPort, MemorySharingRefreshRequired } from "../data/memory-sharing.ts";
import { assertRequestActive, type SessionRequests, sessionRequests } from "./request-session.ts";

/** No screen imports this factory. Creating a port neither sends a request nor enables a route. */
export function createMemorySharingHttpPort(options: {
  origin: string;
  sessionScope: string;
  familyId: string;
  authorId: string;
  memoryId: string;
  getToken: () => Promise<string | null>;
  requests?: SessionRequests;
  fetcher?: typeof fetch;
}): MemorySharingPort {
  // Copy immutable locators and session ownership; a later mutated options object cannot retarget it.
  const { sessionScope, getToken } = options;
  const requests = options.requests ?? sessionRequests;
  const fetcher = options.fetcher ?? fetch;
  const uuid = MemorySharingView.shape.memory_id;
  const family = uuid.safeParse(options.familyId);
  const author = uuid.safeParse(options.authorId);
  const memory = uuid.safeParse(options.memoryId);
  let origin: string;
  try {
    const url = new URL(options.origin);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      !family.success ||
      !author.success ||
      !memory.success ||
      !sessionScope.trim()
    )
      throw new Error();
    origin = url.origin;
  } catch {
    throw new Error("sharing_configuration_invalid");
  }
  const familyId = options.familyId.toLowerCase();
  const authorId = options.authorId.toLowerCase();
  const memoryId = options.memoryId.toLowerCase();
  const base = `/v1/families/${familyId}`;
  const target = `${base}/memories/${memoryId}/sharing`;
  // Retain only the reviewed proof, never another copy of the quote or recipient names.
  let reviewed: { id: string; sha256: string } | null = null;
  const invalid = () => new Error("sharing_response_invalid");
  const parse = <T>(
    schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
    value: unknown,
  ): T => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw invalid();
    return parsed.data;
  };
  const sameMemory = (id: string) => {
    if (id.toLowerCase() !== memoryId) throw new Error("sharing_target_invalid");
  };
  async function request(path: string, signal: AbortSignal, body?: unknown, key?: string) {
    requests.assertScope(sessionScope);
    if (body !== undefined && !ApiIdempotencyKey.safeParse(key).success)
      throw new Error("sharing_key_invalid");
    return requests.run(
      async (activeSignal) => {
        const token = await requests.credential(sessionScope, getToken);
        assertRequestActive(activeSignal);
        if (!token) throw new Error("sharing_authentication_required");
        return requests.authenticated(
          token,
          async (networkSignal) => {
            let response: Response;
            try {
              response = await fetcher(`${origin}${path}`, {
                method: body === undefined ? "GET" : "POST",
                headers: {
                  accept: "application/json",
                  authorization: `Bearer ${token}`,
                  ...(body === undefined
                    ? {}
                    : { "content-type": "application/json", "idempotency-key": key ?? "" }),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                cache: "no-store",
                credentials: "omit",
                redirect: "error",
                signal: networkSignal,
              });
            } catch {
              assertRequestActive(networkSignal);
              throw new Error("sharing_network_failed");
            }
            assertRequestActive(networkSignal);
            if (response.redirected) throw invalid();
            // Never parse, retain or surface server error text/details (which may contain private words).
            if (!response.ok) return { status: response.status, value: null };
            if (
              response.status !== 200 ||
              !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")
            )
              throw invalid();
            let value: unknown;
            try {
              value = await response.json();
            } catch {
              throw invalid();
            }
            assertRequestActive(networkSignal);
            return { status: 200, value };
          },
          activeSignal,
        );
      },
      signal,
      15_000,
    );
  }
  const requireOk = (result: { status: number; value: unknown }, refresh = false) => {
    if (refresh && (result.status === 404 || result.status === 409)) {
      reviewed = null;
      throw new MemorySharingRefreshRequired();
    }
    if (result.status !== 200) throw new Error(`sharing_request_${result.status}`);
    return result.value;
  };
  return {
    async read(signal) {
      reviewed = null;
      const result = await request(target, signal);
      if (result.status === 404) return null;
      const view = parse(MemorySharingView, requireOk(result));
      if (
        view.memory_id !== memoryId ||
        view.author_id !== authorId ||
        new Set(view.recipients.map((r) => r.member_id.toLowerCase())).size !==
          view.recipients.length
      )
        throw invalid();
      return view;
    },
    async prepare(input, signal) {
      reviewed = null;
      sameMemory(input.memory_id);
      const body = parse(MemoryShareRecipients, { recipient_ids: input.recipient_ids });
      const prepared = parse(
        MemorySharePrepared,
        requireOk(await request(`${target}/presentations`, signal, body, input.key), true),
      );
      const preview = parse(
        MemorySharePreview,
        requireOk(
          await request(`${base}/memory-sharing-presentations/${prepared.id}`, signal),
          true,
        ),
      );
      if (
        preview.presentation_id !== prepared.id ||
        preview.memory_id !== memoryId ||
        preview.recipients.length !== body.recipient_ids.length ||
        new Set(preview.recipients.map((r) => r.member_id.toLowerCase())).size !==
          body.recipient_ids.length ||
        preview.recipients.some((r) => !body.recipient_ids.includes(r.member_id))
      )
        throw invalid();
      reviewed = { id: preview.presentation_id, sha256: preview.presentation_sha256 };
      return preview;
    },
    async confirm(input, signal) {
      const body = parse(MemoryShareChoice, {
        presentation_id: input.presentation_id,
        presentation_sha256: input.presentation_sha256,
        confirmation_version: input.confirmation_version,
      });
      if (reviewed?.id !== body.presentation_id || reviewed.sha256 !== body.presentation_sha256)
        throw new Error("sharing_review_required");
      const saved = parse(
        MemoryShareSaved,
        requireOk(await request(`${base}/memory-sharing/confirm`, signal, body, input.key), true),
      );
      if (saved.id !== memoryId) throw invalid();
    },
    async stop(input, signal) {
      reviewed = null;
      sameMemory(input.memory_id);
      parse(MemoryShareStopped, requireOk(await request(`${target}/stop`, signal, {}, input.key)));
    },
  };
}
