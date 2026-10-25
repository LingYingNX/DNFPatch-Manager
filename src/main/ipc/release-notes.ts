const stripReleaseNoteHtml = (value: string): string =>
  value
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/p>\s*<p>/giu, "\n\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&nbsp;/giu, " ");

export function normalizeReleaseNotes(value: unknown): string[] {
  if (typeof value === "string") {
    const lines = stripReleaseNoteHtml(value.replace(/\r\n?/gu, "\n")).split("\n");
    const normalized: string[] = [];
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (trimmed.trim() === "" && (normalized.length === 0 || normalized.at(-1) === "")) {
        continue;
      }
      normalized.push(trimmed);
    }
    while (normalized.at(-1) === "") normalized.pop();
    return normalized;
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || !("note" in entry)) return [];
    return typeof entry.note === "string" ? normalizeReleaseNotes(entry.note) : [];
  });
}

export function selectReleaseNotes(
  version: string,
  updaterNotes: readonly string[],
  githubNotes: readonly string[],
  appVersion: string,
  appNotes: readonly string[],
): string[] {
  if (githubNotes.length > 0) return [...githubNotes];
  if (updaterNotes.length > 0 || version !== appVersion) return [...updaterNotes];
  return [...appNotes];
}
