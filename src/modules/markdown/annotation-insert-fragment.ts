import {
  annotationIdentity,
  annotationMarkdownFragment,
  escapeAnnotationMarkdown,
  type MarkdownAnnotation,
} from "./annotations";

/** Preserve first-selected source order and the original PDF reading order. */
export function annotationInsertFragment(
  chosen: readonly MarkdownAnnotation[],
): string {
  const groups = new Map<string, Map<string, MarkdownAnnotation[]>>();
  const seen = new Set<string>();
  for (const annotation of chosen) {
    const identity = annotationIdentity(annotation);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const source = `${annotation.groupID ?? "library"}/${annotation.sourceKey ?? annotation.attachmentKey}`;
    let attachments = groups.get(source);
    if (!attachments) groups.set(source, (attachments = new Map()));
    let entries = attachments.get(annotation.attachmentKey);
    if (!entries) attachments.set(annotation.attachmentKey, (entries = []));
    entries.push(annotation);
  }
  const heading = (title: string, depth: number) =>
    `${"#".repeat(depth)} ${escapeAnnotationMarkdown(title.replace(/[\r\n]+/g, " "))}\n`;
  const parts: string[] = [];
  for (const attachments of groups.values()) {
    const first = attachments.values().next().value![0];
    if (groups.size > 1)
      parts.push(heading(first.sourceTitle || first.attachmentTitle, 3));
    for (const entries of attachments.values()) {
      entries.sort((a, b) =>
        a.sortIndex && b.sortIndex
          ? a.sortIndex.localeCompare(b.sortIndex)
          : (a.page ?? Infinity) - (b.page ?? Infinity) || 0,
      );
      if (attachments.size > 1)
        parts.push(
          heading(entries[0].attachmentTitle, groups.size > 1 ? 4 : 3),
        );
      parts.push(annotationMarkdownFragment(entries));
    }
  }
  return parts.join("\n");
}
