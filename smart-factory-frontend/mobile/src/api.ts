import { origin } from "./config";

export class SessionExpired extends Error {}
export async function request(session: string, path: string, body?: unknown) {
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer " + session,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401)
    throw new SessionExpired("Sign in again to reopen this record.");
  if (response.status === 403)
    throw Error("You do not have access to this action.");
  if (response.status === 404) throw Error("This record is unavailable.");
  if (response.status === 409)
    throw Error("Another operator updated this record. Refresh and try again.");
  if (!response.ok)
    throw Error(
      "The service could not complete your request. Refresh before retrying.",
    );
  return response.status === 204 ? null : response.json();
}
export type Item = {
  id: number;
  title: string;
  summary: string;
  version: number;
  parent: number;
  owner?: number;
  due?: string | null;
  state: string;
};
export type Detail = { item: Item; history: string[] };

export const trpc = async (
  session: string,
  name: string,
  input: unknown,
  mutation = false,
) => {
  const path = "/api/trpc/" + name;
  const wrapped = { json: input };
  const data = mutation
    ? await request(session, path, wrapped)
    : await request(
        session,
        path + "?input=" + encodeURIComponent(JSON.stringify(wrapped)),
      );
  if (!data?.result?.data)
    throw Error("The Factory API could not return this record.");
  return data.result.data.json;
};
type Action = {
  id: number;
  incidentId: number;
  title: string;
  status: string;
  ownerName?: string;
  ownerId: number;
  dueDate: string | null;
  version: number;
};
const item = (a: Action): Item => ({
  id: a.id,
  title: a.title,
  summary: [a.ownerName, a.status, a.dueDate].filter(Boolean).join(" · "),
  parent: a.incidentId,
  owner: a.ownerId,
  due: a.dueDate,
  version: a.version,
  state: a.status,
});
export async function list(session: string): Promise<Item[]> {
  const data = await trpc(session, "alerts.actionQueue", {
    page: 0,
    pageSize: 50,
  });
  return data.items.map((a: Action) => item(a));
}
export async function detail(session: string, key: string): Promise<Detail> {
  const [incidentId, actionId] = key.split("/").map(Number);
  let after = 0;
  for (;;) {
    const data = await trpc(session, "alerts.actions", {
      id: incidentId,
      after,
    });
    const selected = data.items.find((a: Action) => a.id === actionId);
    if (
      !selected &&
      data.hasMore &&
      data.nextCursor > 0 &&
      data.nextCursor !== after
    ) {
      after = data.nextCursor;
      continue;
    }
    if (!selected) throw Error("This incident action is unavailable.");
    return {
      item: item(selected),
      history: data.items.map((a: Action & { outcome?: string }) =>
        [a.title, a.status, a.outcome].filter(Boolean).join(" · "),
      ),
    };
  }
}

export const actionLabel = "Complete action";
export async function complete(session: string, row: Item, note: string) {
  await trpc(
    session,
    "alerts.updateAction",
    {
      id: row.parent,
      actionId: row.id,
      expectedVersion: row.version,
      ownerId: row.owner,
      dueDate: row.due ?? null,
      status: "completed",
      outcome: note,
    },
    true,
  );
}
export const keyOf = (r: Item) => r.parent + "/" + r.id;
export const validKey = (s: string) => /^[1-9]\d{0,9}\/[1-9]\d{0,9}$/.test(s);
export const done = (r: Item) => r.state === "completed";
export async function signOut(session: string) {
  await trpc(session, "auth.logout", null, true);
}
