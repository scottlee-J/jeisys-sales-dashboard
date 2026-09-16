import { promises as fs } from "fs";
import path from "path";
import type { Dealer, Record } from "./types";

// PoC 단계에서는 로컬 JSON 파일에 데이터를 저장한다.
// 배포 시 Vercel Postgres로 교체할 부분은 이 파일 하나뿐이다.
const DATA_FILE = path.join(process.cwd(), "data", "records.json");
// 거래처별_취급제품_매트릭스 기준으로 미리 뽑아 둔 거래처 마스터 목록(읽기 전용).
const DEALERS_FILE = path.join(process.cwd(), "data", "dealers.json");

// 거래처/기간/장비/품목 조합으로 데이터의 고유 키를 만든다.
// (팀과 국가는 거래처에 따라 정해지므로 키에서 제외)
function makeKey(
  client: string,
  period: string,
  equipment: string,
  item: string,
) {
  return `${client}||${period}||${equipment}||${item}`;
}

export async function readRecords(): Promise<Record[]> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(raw) as Record[];
  } catch {
    // 파일이 아직 없으면 빈 목록으로 시작한다.
    return [];
  }
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

async function writeRecords(records: Record[]) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(records, null, 2), "utf-8");
}

// 데이터를 저장한다. 같은 국가/기간/장비 조합이 이미 있으면 기존 값을 덮어쓴다.
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
  // "add" 면 기존 값에 더한다 (PO 처럼 건별로 쌓이는 주문). 기본은 덮어쓰기.
  mode?: "overwrite" | "add";
}): Promise<{ record: Record; overwritten: boolean; previous: Record | null }> {
  const records = await readRecords();
  const key = makeKey(input.client, input.period, input.equipment, input.item);
  const index = records.findIndex(
    (r) => makeKey(r.client, r.period, r.equipment, r.item) === key,
  );

  const previous = index >= 0 ? records[index] : null;
  // 팀과 국가를 따로 말하지 않았으면 같은 거래처의 기존 데이터에서 가져온다.
  const sameClient = records.find((r) => r.client === input.client);

  // "add" 모드면 기존 값에 더하고, 아니면 이번 값으로 덮어쓴다.
  // (이번에 값을 주지 않은 항목은 두 모드 모두 기존 값을 그대로 유지한다)
  const merge = (next: number | null, prev: number | null | undefined) => {
    if (next === null) return prev ?? null;
    if (input.mode === "add") return (prev ?? 0) + next;
    return next;
  };

  const record: Record = {
    team: input.team ?? previous?.team ?? sameClient?.team ?? "미지정",
    country:
      input.country ?? previous?.country ?? sameClient?.country ?? "미지정",
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

  if (index >= 0) {
    records[index] = record;
  } else {
    records.push(record);
  }

  await writeRecords(records);
  return { record, overwritten: index >= 0, previous };
}
