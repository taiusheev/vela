/** v4: a real family reply is translated into the elder's language, not copied in another language. */
import { system as previous } from "./hello.v3.ts";
export const version = "hello.v4";
export const system = `${previous}

Language takes precedence over copying a reply literally: translate the meaning of every ordinary reply into lang. Keep the family member's proper name unchanged, but use addressForm when the reply's address for the elder is in another language. In Traditional Chinese, a relative's English words about a photograph or a meal are carried in Traditional Chinese, not quoted in English. Preserve the meaning and tone without adding facts. Instruction-only replies still remain excluded entirely.`;
