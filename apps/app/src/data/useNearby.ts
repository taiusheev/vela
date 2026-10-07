import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiNearbyContact, NearbyConsent } from "@vela/contracts";
import { useCallback, useState } from "react";
import {
  addNearby,
  apiConfigured,
  fetchFamily,
  inviteNearby,
  nearbyRefusal,
  removeNearby,
} from "../api/client.ts";
import { useIdempotencyKey } from "../api/idempotency.ts";
import { accountsConfigured, useAccount } from "../auth/clerk.tsx";

/** The most people nearby one kept-light member has (spec §17). */
import { demoDataAllowed } from "./live-state.ts";

export const NEARBY_MAX = 2;

export interface NearbyPerson {
  id: string;
  name: string;
  relation: string | null;
  /** "Said yes", "Said no", "Vela asks them first": where their yes stands. */
  consent: string;
  saidYes: boolean;
}

export interface NearbyView {
  people: NearbyPerson[];
  loading: boolean;
  readFailed: boolean;
  refresh(): void;
  /** Whether another person can be added: fewer than two, and not while a change is on its way. */
  canAdd: boolean;
  /** Add someone; resolves true once they are added, so the form can clear itself. */
  add(name: string, relation: string): Promise<boolean>;
  remove(contactId: string): void;
  /**
   * The link for one person who has not said yes, to send them from the organiser's own phone; they
   * open it in Telegram and Vela asks them there (ADR-36). Null when it could not be had.
   */
  invite(contactId: string): Promise<string | null>;
  changing: boolean;
  /** Why the last change did not go through, in words for the screen. */
  refused?: string;
}

function consentOf(consent: NearbyConsent): string {
  switch (consent) {
    case "yes":
      return t`Said yes`;
    case "no":
      return t`Said no`;
    default:
      return t`Has not said yes yet`;
  }
}

function personOf(contact: ApiNearbyContact): NearbyPerson {
  return {
    id: contact.id,
    name: contact.name,
    relation: contact.relation,
    consent: consentOf(contact.consent),
    saidYes: contact.consent === "yes",
  };
}

function refusedLine(error: unknown): string {
  switch (nearbyRefusal(error)) {
    case "full":
      return t`Two people nearby is the most. Remove one to add someone else.`;
    case "number":
      return t`Leave the number out. Vela asks them for it, with their yes.`;
    default:
      return t`That did not go through. Try again in a moment.`;
  }
}

/** The example family's two, as You shows them, so the demo can be tried without an API. */
function examplePeople(): NearbyPerson[] {
  return [
    {
      id: "c1",
      name: "Lena",
      relation: t({ comment: "who a nearby contact is to her", message: "neighbour" }),
      consent: consentOf("yes"),
      saidYes: true,
    },
    {
      id: "c2",
      name: "Petro",
      relation: t({ comment: "who a nearby contact is to her", message: "downstairs" }),
      consent: consentOf("waiting"),
      saidYes: false,
    },
  ];
}

/**
 * The people nearby one kept-light member (spec A3, A12): read from the family behind You, which
 * lists them for organisers, and changed through the API. Nobody is contacted by adding them: the
 * organiser sends each one a link from their own phone, and Vela asks them only once they open it
 * (ADR-36), or the founder records a yes given another way (L8). Without an API, the example two,
 * changed only on this screen.
 */
export function useNearby(familyId: string | undefined, memberId: string | undefined): NearbyView {
  useLingui();
  const account = useAccount();
  const queries = useQueryClient();
  const addKey = useIdempotencyKey("nearby");
  const removeKey = useIdempotencyKey("nearby-remove");
  const [example, setExample] = useState<NearbyPerson[] | null>(null);
  const [refused, setRefused] = useState<string | undefined>();
  const demo = demoDataAllowed(apiConfigured(), accountsConfigured());

  const enabled = !demo && account.signedIn && familyId !== undefined;
  const read = useQuery({
    queryKey: ["family", familyId],
    enabled,
    refetchOnWindowFocus: "always",
    queryFn: async () => fetchFamily(familyId ?? "", await account.token()),
  });
  const refetch = read.refetch;
  const refresh = useCallback(() => {
    if (enabled) void refetch();
  }, [enabled, refetch]);
  const after = async () => {
    setRefused(undefined);
    await queries.invalidateQueries({ queryKey: ["family", familyId] });
  };
  const adding = useMutation({
    mutationFn: async (input: { member_id: string; name: string; relation: string | null }) =>
      addNearby(familyId ?? "", input, addKey(input), await account.token()),
    onSuccess: after,
    onError: (error) => setRefused(refusedLine(error)),
  });
  const removing = useMutation({
    mutationFn: async (contactId: string) =>
      removeNearby(contactId, removeKey({ contactId }), await account.token()),
    onSuccess: after,
    onError: (error) => setRefused(refusedLine(error)),
  });

  const inviteKey = useIdempotencyKey("nearby-invite");
  const inviting = useMutation({
    mutationFn: async (contactId: string) =>
      inviteNearby(contactId, inviteKey({ contactId, at: Date.now() }), await account.token()),
    onError: (error) => setRefused(refusedLine(error)),
  });

  const people = demo
    ? (example ?? examplePeople())
    : (read.data?.nearby ?? [])
        .filter((contact) => contact.near_member_id === memberId)
        .map(personOf);
  const changing = adding.isPending || removing.isPending || inviting.isPending;

  return {
    people,
    loading: enabled && read.isPending,
    readFailed: read.isError,
    refresh,
    canAdd:
      people.length < NEARBY_MAX &&
      !changing &&
      (demo || (!read.isError && read.data !== undefined && memberId !== undefined)),
    changing,
    ...(refused === undefined && !read.isError
      ? {}
      : { refused: refused ?? t`The people nearby could not be reached just now.` }),
    async add(name, relation) {
      const trimmed = { name: name.trim(), relation: relation.trim() };
      if (trimmed.name.length === 0) return false;
      if (demo) {
        setExample([
          ...people,
          {
            id: `example-${people.length + 1}`,
            name: trimmed.name,
            relation: trimmed.relation.length === 0 ? null : trimmed.relation,
            consent: consentOf("waiting"),
            saidYes: false,
          },
        ]);
        return true;
      }
      if (memberId === undefined) return false;
      try {
        await adding.mutateAsync({
          member_id: memberId,
          name: trimmed.name,
          relation: trimmed.relation.length === 0 ? null : trimmed.relation,
        });
        return true;
      } catch {
        return false;
      }
    },
    async invite(contactId) {
      if (demo) return "https://t.me/VelaLightBot?start=nEXAMPLE";
      try {
        return (await inviting.mutateAsync(contactId)).link;
      } catch {
        return null;
      }
    },
    remove(contactId) {
      if (demo) {
        setExample(people.filter((person) => person.id !== contactId));
        return;
      }
      removing.mutate(contactId);
    },
  };
}
