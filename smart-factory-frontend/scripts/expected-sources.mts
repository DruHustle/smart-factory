export function expectedSources(
  layout: string | undefined,
  revision: string | undefined,
  pinned: { backend: string; edge: string },
): { backend: string; edge: string } {
  if (layout === "monorepo") {
    if (!revision || !/^[a-f0-9]{40}$/.test(revision))
      throw Error("An immutable consolidated API revision is required");
    return { backend: revision, edge: revision };
  }
  if (layout !== undefined && layout !== "legacy")
    throw Error("Unrecognized qualification source layout");
  if (
    ![pinned.backend, pinned.edge].every(
      (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value),
    )
  )
    throw Error("Immutable companion revisions are required");
  return { backend: pinned.backend, edge: pinned.edge };
}
