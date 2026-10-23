/** Scope boundaries for local portraits. The adapter owns native files or ephemeral web values. */
export interface PortraitFiles {
  read(scope: string, person: string): string | null;
  save(scope: string, person: string, uri: string): string;
  remove(scope: string, person: string): void;
  clear(scope: string): void;
}
export function portraitKey(family: string, member: string): string {
  return JSON.stringify([family, member]);
}
/** Path-safe and collision-free, including delimiters and non-ASCII names. */
export function portraitPath(value: string): string {
  return Array.from(value, (letter) => letter.codePointAt(0)?.toString(16)).join("-");
}
export class PortraitStore {
  private closed = new Set<string>();
  private files: PortraitFiles;
  constructor(files: PortraitFiles) {
    this.files = files;
  }
  activate(scope: string): void {
    this.closed.delete(scope);
  }
  read(scope: string, family: string, member: string): string | null {
    return this.closed.has(scope) ? null : this.files.read(scope, portraitKey(family, member));
  }
  save(scope: string, family: string, member: string, uri: string): string {
    if (this.closed.has(scope)) throw new Error("This session ended");
    return this.files.save(scope, portraitKey(family, member), uri);
  }
  remove(scope: string, family: string, member: string): void {
    this.files.remove(scope, portraitKey(family, member));
  }
  close(scope: string): void {
    this.closed.add(scope);
  }
  clear(scope: string): void {
    this.close(scope);
    this.files.clear(scope);
  }
}
