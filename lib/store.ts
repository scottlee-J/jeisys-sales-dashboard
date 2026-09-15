import { promises as fs } from "fs";
import path from "path";
import type { Record } from "./types";

// PoC 단계에서는 로컬 JSON 파일에 데이터를 저장한다.
// 배포 시 Vercel Postgres로 교체할 부분은 이 파일 하나뿐이다.
const DATA_FILE = path.join(process.cwd(), "data", "records.json");

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
}): Promise<{ record: Record; overwritten: boolean; previous: Record | null }> {
  const records = await readRecords();
  const key = makeKey(input.client, input.period, input.equipment, input.item);
  const index = records.findIndex(
    (r) => makeKey(r.client, r.period, r.equipment, r.item) === key,
  );

  const previous = index >= 0 ? records[index] : null;
  // 팀과 국가를 따로 말하지 않았으면 같은 거래처의 기존 데이터에서 가져온다.
  const sameClient = records.find((r) => r.client === input.client);

  const record: Record = {
    team: input.team ?? previous?.team ?? sameClient?.team ?? "미지정",
    country:
      input.country ?? previous?.country ?? sameClient?.country ?? "미지정",
    client: input.client,
    period: input.period,
    equipment: input.equipment,
    item: input.item,
    // 이번에 값을 주지 않은 항목은 기존 값을 유지한다.
    actual: input.actual ?? previous?.actual ?? null,
    forecast: input.forecast ?? previous?.forecast ?? null,
    actualQty: input.actualQty ?? previous?.actualQty ?? null,
    forecastQty: input.forecastQty ?? previous?.forecastQty ?? null,
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
