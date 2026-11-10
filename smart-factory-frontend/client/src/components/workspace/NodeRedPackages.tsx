import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { pendingInstall, type PackageReview } from "@shared/node-red";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SampleTime } from "./Primitives";

export default function NodeRedPackages() {
  const utils = trpc.useUtils();
  const status = trpc.nodeRed.status.useQuery(undefined, {
    retry: false,
    refetchInterval: (query) =>
      pendingInstall(query.state.data?.operation ?? null) ? 3_000 : false,
  });
  const [module, setModule] = useState("");
  const [version, setVersion] = useState("");
  const [review, setReview] = useState<PackageReview | null>(null);
  const [requestId, setRequestId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const clearReview = () => {
    setReview(null);
    setAcknowledged(false);
  };
  const refresh = () => utils.nodeRed.status.invalidate();
  const prepare = trpc.nodeRed.review.useMutation({
    retry: false,
    onSuccess: (value) => {
      setReview(value);
      setRequestId(crypto.randomUUID());
      setAcknowledged(false);
    },
  });
  const install = trpc.nodeRed.install.useMutation({
    retry: false,
    onSuccess: (operation) => {
      utils.nodeRed.status.setData(undefined, (current) =>
        current ? { ...current, operation } : current,
      );
    },
    onSettled: () => {
      clearReview();
      void refresh();
    },
  });
  const reconcile = trpc.nodeRed.reconcile.useMutation({
    retry: false,
    onSettled: () => {
      void refresh();
    },
  });
  const data = status.data;
  const operation = data?.operation;
  const pending = pendingInstall(operation ?? null);
  const busy = prepare.isPending || install.isPending || reconcile.isPending;
  const error = prepare.error ?? install.error ?? reconcile.error;
  const canInstall = data?.state === "ready" && !pending && !busy;
  const resetFormReview = () => {
    clearReview();
    prepare.reset();
    install.reset();
  };
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <CardTitle>Node-RED nodes, plugins & libraries</CardTitle>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Add an exact version of a Node-RED package to the enrolled OT
            gateway. Package code runs with the gateway’s permissions and can
            affect existing flows and connected devices. Review each package
            before installation.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={status.isFetching}
          onClick={() => void status.refetch()}
        >
          {status.isFetching ? "Checking…" : "Refresh packages"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {status.isLoading ? (
          <p role="status">Checking the enrolled Node-RED runtime…</p>
        ) : status.error ? (
          <p role="alert" className="text-sm text-destructive">
            {status.error.message}
          </p>
        ) : (
          <div
            className="space-y-2 rounded-md border p-3 text-sm"
            role="status"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {data?.state === "ready"
                  ? "Runtime connected"
                  : data?.state === "disabled"
                    ? "Not configured"
                    : "Unavailable"}
              </Badge>
              {data?.target && (
                <span className="font-medium">
                  {data.target.label} · Node-RED {data.target.version}
                </span>
              )}
            </div>
            <p>{data?.message}</p>
            {data?.target && (
              <p className="break-all text-xs text-muted-foreground">
                Enrolled runtime: {data.target.id}
              </p>
            )}
          </div>
        )}
        {operation && (
          <section
            className="space-y-2 rounded-md border p-3 text-sm"
            aria-label="Latest Node-RED installation"
            aria-live="polite"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium break-all">
                {operation.module}@{operation.version}
              </h3>
              <Badge variant="outline">
                {
                  {
                    installing: "Installation pending",
                    installed: "Version verified",
                    failed: "Request refused",
                    unconfirmed: "Outcome unconfirmed",
                  }[operation.state]
                }
              </Badge>
            </div>
            <p>{operation.message}</p>
            <p className="text-xs text-muted-foreground">
              Last recorded: <SampleTime value={operation.updatedAt} /> ·
              Request {operation.id}
            </p>
            {pending && (
              <>
                <p className="text-muted-foreground">
                  Closing this page does not cancel the gateway installer. An
                  unconfirmed request blocks further installations until its
                  outcome is reviewed.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || data?.state !== "ready"}
                  onClick={() => reconcile.mutate()}
                >
                  {reconcile.isPending
                    ? "Checking outcome…"
                    : "Check installation outcome"}
                </Button>
              </>
            )}
          </section>
        )}
        {data?.state === "ready" && (
          <>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                clearReview();
                prepare.mutate({
                  module: module.trim(),
                  version: version.trim(),
                });
              }}
            >
              <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
                <div className="space-y-2">
                  <Label htmlFor="node-red-package-name">
                    npm package name
                  </Label>
                  <Input
                    id="node-red-package-name"
                    placeholder="node-red-contrib-example"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    maxLength={214}
                    value={module}
                    disabled={!canInstall}
                    onChange={(event) => {
                      setModule(event.target.value);
                      resetFormReview();
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="node-red-package-version">
                    Exact version
                  </Label>
                  <Input
                    id="node-red-package-version"
                    placeholder="1.2.3"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    maxLength={96}
                    value={version}
                    disabled={!canInstall}
                    onChange={(event) => {
                      setVersion(event.target.value);
                      resetFormReview();
                    }}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={!canInstall || !module.trim() || !version.trim()}
                >
                  {prepare.isPending ? "Reviewing…" : "Review package"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Choose a package that declares Node-RED nodes or plugins.
                General Function-node dependencies and saved flow libraries
                follow the separate flow review process.
              </p>
            </form>
            {review && (
              <section
                className="space-y-3 rounded-md border bg-muted/30 p-4"
                aria-label="Review Node-RED package"
              >
                <h3 className="font-medium break-all">
                  {review.module}@{review.version} → {review.target.label}
                </h3>
                {review.description && (
                  <p className="text-sm">{review.description}</p>
                )}
                <p className="text-sm">
                  Declared by the package: {review.nodeSets.length} node sets
                  and {review.pluginSets.length} plugin sets.
                </p>
                <p className="text-xs text-muted-foreground">
                  This metadata identifies the package; it is not a code or
                  compatibility assessment. The review expires at{" "}
                  <SampleTime value={review.expiresAt} />.
                </p>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0"
                    checked={acknowledged}
                    disabled={busy || pending}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  <span>
                    I approve installing{" "}
                    <strong>
                      {review.module}@{review.version}
                    </strong>{" "}
                    on <strong>{review.target.label}</strong>. I have reviewed
                    its code and gateway compatibility. It will execute with
                    this gateway’s permissions and may affect existing flows or
                    devices.
                  </span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={!canInstall || !acknowledged}
                    onClick={() =>
                      install.mutate({
                        reviewToken: review.reviewToken,
                        requestId,
                        acknowledgeCodeExecution: true,
                      })
                    }
                  >
                    {install.isPending
                      ? "Submitting installation…"
                      : "Install approved version"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={clearReview}
                  >
                    Dismiss review
                  </Button>
                </div>
              </section>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        )}
        {data?.state === "ready" && (
          <section
            className="space-y-2"
            aria-label="Installed Node-RED packages"
          >
            <h3 className="text-sm font-medium">
              Runtime package inventory ({data.packages.length})
            </h3>
            <div
              className="max-h-80 overflow-auto rounded-md border focus-visible:outline-2 focus-visible:outline-ring"
              tabIndex={0}
              aria-label="Scrollable package inventory"
            >
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="p-3">Package</th>
                    <th className="p-3">Version</th>
                    <th className="p-3">Contents</th>
                    <th className="p-3">Reported state</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.packages.map((item) => (
                    <tr key={item.name}>
                      <th scope="row" className="p-3 font-normal break-all">
                        {item.name}
                      </th>
                      <td className="p-3 whitespace-nowrap">{item.version}</td>
                      <td className="p-3">
                        {item.nodeSets} node sets · {item.pluginSets} plugin
                        sets
                      </td>
                      <td className="p-3">
                        {item.loadError
                          ? "Load error · review gateway"
                          : item.pendingVersion
                            ? `Pending ${item.pendingVersion}`
                            : "Listed by runtime"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Packages persist in the gateway’s existing Node-RED data volume.
              Commission new OT connections separately. Package updates, removal
              and flow deployment require a separate maintenance review.
            </p>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
