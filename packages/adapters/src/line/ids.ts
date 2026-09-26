/**
 * LINE's documented id shapes. Events are read against them, and nothing goes into a request path
 * without matching one, which also keeps a stray `/` or `?` out of the URL. The unknown actor (a
 * group's own id as the sender) relies on a group id never being a user id.
 */
export const USER_ID = /^U[0-9a-f]{32}$/;
export const GROUP_ID = /^C[0-9a-f]{32}$/;
export const ROOM_ID = /^R[0-9a-f]{32}$/;
/** Where a push can go: a person, a group, or a multi-person chat. */
export const CONVERSATION_ID = /^[UCR][0-9a-f]{32}$/;
/** Decimal, and beyond 2^53, so kept as text. Content downloads put them in a URL path. */
export const MESSAGE_ID = /^[0-9]+$/;
