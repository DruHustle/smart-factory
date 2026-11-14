import {
  sampleValidity,
  type SampleValidityInput,
} from "../../shared/measurements";
import React, { useState, useEffect } from "react";
import { ActivityIndicator, Button, Text, View } from "react-native";
import { trpc } from "./api";

type Card = { key: string; title: string; note: string };
export function OperatorRecords({
  session,
  onError,
}: {
  session: string;
  onError: (e: unknown) => void;
}) {
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState<Card[]>([]),
    [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null),
    [history, setHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(false),
    [more, setMore] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true);
    setHistory([]);
    if (!selected) {
      setRows([]);
      setMore(false);
    }
    const load = async () => {
      if (selected) {
        const result = await readDetail(session, selected);
        if (current) setHistory(result);
      } else {
        const data = await readPage(session, page);
        if (current) {
          setRows(data.rows);
          setMore(data.more);
        }
      }
    };
    load()
      .catch((e) => {
        if (current) onError(e);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [open, session, page, selected, refresh]);
  return (
    <View style={{ gap: 10 }}>
      <Button
        title={open ? "Close Telemetry sources" : "Telemetry sources"}
        onPress={() => {
          setOpen(!open);
          setSelected(null);
        }}
      />
      {open && (
        <>
          <Text
            accessibilityRole="header"
            style={{ fontSize: 20, fontWeight: "600" }}
          >
            {selected
              ? rows.find((x) => x.key === selected)?.title
              : "Telemetry sources"}
          </Text>
          {loading ? (
            <ActivityIndicator />
          ) : selected ? (
            <>
              <Button title="Back to list" onPress={() => setSelected(null)} />
              {history.map((v, i) => (
                <Text key={i}>{v}</Text>
              ))}
            </>
          ) : (
            <>
              {rows.map((r) => (
                <View key={r.key}>
                  <Button title={r.title} onPress={() => setSelected(r.key)} />
                  <Text>{r.note}</Text>
                </View>
              ))}
              {!rows.length && <Text>No records in this workspace.</Text>}
              {page > 0 && (
                <Button
                  title="Previous page"
                  onPress={() => setPage(page - 1)}
                />
              )}
              {more && (
                <Button title="Next page" onPress={() => setPage(page + 1)} />
              )}
            </>
          )}
          <Button
            title="Refresh records"
            disabled={loading}
            onPress={() => setRefresh((x) => x + 1)}
          />
        </>
      )}
    </View>
  );
}

type Source = {
  id: number;
  name: string;
  deviceId: string;
  observedStatus: string;
  type: string;
};
async function readPage(session: string, page: number) {
  const data = await trpc(session, "devices.monitor", { page, pageSize: 25 });
  return {
    rows: data.items.map((d: Source) => ({
      key: String(d.id),
      title: d.name,
      note: [d.deviceId, d.type, "Source: " + d.observedStatus].join(" · "),
    })),
    more: data.hasMore,
  };
}

type Sample = SampleValidityInput & {
  timestamp: number;
  validity?: { state: string; reason?: string | null };
  integration?: { sourceQuality?: string };
  measurements?: Record<
    string,
    { sourceValue?: number; sourceUnit?: string; quality?: string }
  >;
};
function describe(sample: Sample) {
  const time = Number.isFinite(sample.timestamp)
    ? new Date(sample.timestamp).toISOString()
    : "Unknown sample time";
  const rows = [
    time +
      " · " +
      (sample.integration?.sourceQuality || "unknown source quality"),
  ];
  if (sample.validity)
    rows.push(
      [sample.validity.state, sample.validity.reason]
        .filter(Boolean)
        .join(" · "),
    );
  for (const [name, m] of Object.entries(sample.measurements || {})) {
    if (typeof m.sourceValue === "number")
      rows.push(
        name +
          ": " +
          m.sourceValue +
          " " +
          (m.sourceUnit || "(unit unverified)") +
          " · " +
          (m.quality || "unknown quality"),
      );
  }
  return rows;
}
async function readDetail(session: string, id: string) {
  const deviceId = Number(id),
    endTime = Date.now(),
    startTime = endTime - 3600000;
  const [latest, range]: [Sample | null, Sample[]] = await Promise.all([
    trpc(session, "readings.getLatest", { deviceId, scope: "operational" }),
    trpc(session, "readings.getForDevice", {
      deviceId,
      startTime,
      endTime,
      limit: 25,
      scope: "operational",
    }),
  ]);
  const rows = latest
    ? [
        "Latest operational observation",
        ...describe({ ...latest, validity: sampleValidity(latest) }),
      ]
    : ["No operational observation recorded."];
  rows.push("First 25 observations in the last hour");
  if (!range.length) rows.push("No observations in this interval.");
  for (const sample of range) rows.push(describe(sample).join(" · "));
  return rows;
}
