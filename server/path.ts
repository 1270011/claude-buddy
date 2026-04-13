// Path utilities and helpers

// Path normalization (Windows compat)
// Node's path.join() produces backslash paths on Windows, which bash treats as
// escape sequences, stripping them entirely (e.g. C:\Users -> C:Users).
// Use forward slashes in all paths written to config files.

/**
 * Converts all backslashes in a file path to forward slashes, producing a Unix-style path.
 *
 * @param p - The file path to convert.
 * @returns The converted path with forward slashes.
 */
export function toUnixPath(p: string): string {
  return p.replace(/\\/g, "/");
}