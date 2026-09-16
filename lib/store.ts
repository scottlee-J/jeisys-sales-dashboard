import { promises as fs } from "fs";
import path from "path";
import { createClient } from "./supabase/server";
import type { Dealer, Record } from "./types";

// 실적 데이터는 Supabase Postgres(public.records)에 저장한다.
// 배포 환경(Vercel)은 파일 쓰기가 막혀 있어서 JSON 파일로는 저장이 안 되기 때문이다.
// 저장 방식을 또 바꾸게 되면 고칠 곳은 이 파일 하나뿐이다.
//
// 거래처 마스터 목록은 바뀌지 않는 참고 자료라 파일로 둔다(읽기 전용).
const DEALERS_FILE = path.join(process.cwd(), "data", "dealers.json");

// DB 는 snake_case, 앱은 camelCase 라서 서로 바꿔 준다.
type RecordRow = {
  team: string;
  country: string;
  client: string;
  period: string;
  equipment: string;
  item: string;
  actual: number | null;
  forecast: number | null;
  actual_qty: number | null;
  forecast_qty: number | null;
  standard_price: number | null;
  updated_at: string;
};

const toRecord = (row: RecordRow): Record => ({
  team: row.team,
  country: row.country,
  client: row.client,
  period: row.period,
  equipment: row.equipment,
  item: row.item,
  actual: row.actual,
  forecast: row.forecast,
  actualQty: row.actual_qty,
  forecastQty: row.forecast_qty,
  standardPrice: row.standard_price,
  updatedAt: row.updated_at,
});

export async function readRecords(): Promise<Record[]> {
  const supabase = await createClient();

  // Supabase 는 한 번에 1000행까지만 주므로 나눠서 모두 가져온다.
  const size = 1000;
  const records: Record[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from("records")
      .select("*")
      .range(from, from + size - 1);
    if (error || !data) break;
    records.push(...(data as RecordRow[]).map(toRecord));
    if (data.length < size) break;
  }
  return records;
}

// 실적 확정 여부와 상관없이, 실제로 존재하는 거래처 전체 목록을 읽어 온다.
export async function readDealers(): Promise<Dealer[]> {
  try {
    const raw = await fs.readFile(DEALERS_FILE, "utf-8");
    return JSON.parse(raw) as Dealer[];
  } catch {
    return [];
  }
}

// 데이터를 저장한다. 같은 국가/거래처/기간/장비/품목 조합이 이미 있으면 기존 값을 덮어쓴다.
// mode 가 "add" 면 기존 값에 더한다 (PO 처럼 건별로 쌓이는 주문).
// 반환값의 overwritten 으로 덮어쓰기 여부를 알려 준다.
export async function saveRecord(input: {
  team: string | null;
  country: string | null;
  client: string;
  period: string;
  equipment: string;
  item: string;
  actual: number | null;
  forecast: number | null;
  actualQty: number | null;
  forecastQty: number | null;
  standardPrice?: number | null;
  mode?: "overwrite" | "add";
}): Promise<{ record: Record; overwritten: boolean; previous: Record | null }> {
  const supabase = await createClient();

  // 국가를 따로 말하지 않았으면 같은 거래처의 기존 데이터에서 가져온다.
  // (국가가 키의 일부라서 저장 전에 먼저 정해야 한다)
  const { data: clientRows } = await supabase
    .from("records")
    .select("*")
    .eq("client", input.client);
  const sameClient = (clientRows ?? []) as RecordRow[];

  const country =
    input.country ??
    sameClient.find((row) => row.period === input.period)?.country ??
    sameClient[0]?.country ??
    "미지정";

  const previousRow =
    sameClient.find(
      (row) =>
        row.country === country &&
        row.period === input.period &&
        row.equipment === input.equipment &&
        row.item === input.item,
    ) ?? null;
  const previous = previousRow ? toRecord(previousRow) : null;

  // "add" 모드면 기존 값에 더하고, 아니면 이번 값으로 덮어쓴다.
  // (이번에 값을 주지 않은 항목은 두 모드 모두 기존 값을 그대로 유지한다)
  const merge = (next: number | null, prev: number | null | undefined) => {
    if (next === null) return prev ?? null;
    if (input.mode === "add") return (prev ?? 0) + next;
    return next;
  };

  const record: Record = {
    team: input.team ?? previous?.team ?? sameClient[0]?.team ?? "미지정",
    country,
    client: input.client,
    period: input.period,
    equipment: input.equipment,
    item: input.item,
    actual: merge(input.actual, previous?.actual),
    forecast: merge(input.forecast, previous?.forecast),
    actualQty: merge(input.actualQty, previous?.actualQty),
    forecastQty: merge(input.forecastQty, previous?.forecastQty),
    standardPrice: input.standardPrice ?? previous?.standardPrice ?? null,
    updatedAt: new Date().toISOString(),
  };

  await supabase.from("records").upsert(
    {
      team: record.team,
      country: record.country,
      client: record.client,
      period: record.period,
      equipment: record.equipment,
      item: record.item,
      actual: record.actual,
      forecast: record.forecast,
      actual_qty: record.actualQty,
      forecast_qty: record.forecastQty,
      standard_price: record.standardPrice,
      updated_at: record.updatedAt,
    },
    { onConflict: "country,client,period,equipment,item" },
  );

  return { record, overwritten: previous !== null, previous };
}
