function immutableRevision(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === 40 &&
    /^[a-f0-9]{40}$/.test(value)
  );
}

export function expectedSources(
  layout: string | undefined,
  revision: string | undefined,
  pinned: { backend: string; edge: string },
): { backend: string; edge: string } {
  if (layout === "monorepo") {
    if (!immutableRevision(revision))
      throw Error("An immutable consolidated API revision is required");
    return { backend: revision, edge: revision };
  }
  if (layout !== undefined && layout !== "legacy")
    throw Error("Unrecognized qualification source layout");
  if (
    !pinned ||
    !immutableRevision(pinned.backend) ||
    !immutableRevision(pinned.edge)
  )
    throw Error("Immutable companion revisions are required");
  return { backend: pinned.backend, edge: pinned.edge };
}
