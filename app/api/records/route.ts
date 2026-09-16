import { NextResponse } from "next/server";
import { readRecords, saveRecord } from "@/lib/store";
import { getSession, scopeByTeam } from "@/lib/supabase/session";

// 파일 시스템을 사용하므로 Node 런타임에서 동작시킨다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 저장된 데이터를 내려 준다. 일반 사용자는 자기 팀 데이터만 받는다
// (화면 필터가 아니라 서버에서 걸러서, 다른 팀 데이터가 아예 전달되지 않게 한다).
export async function GET() {
  const session = await getSession();
  const records = scopeByTeam(await readRecords(), session);
  return NextResponse.json({ records });
}

// 실적/예측 데이터를 저장한다. 같은 조합이면 덮어쓴다.
export async function POST(request: Request) {
  const body = await request.json();
  const {
    team,
    country,
    client,
    period,
    equipment,
    item,
    actual,
    forecast,
    actualQty,
    forecastQty,
    mode,
  } = body ?? {};

  if (!client || !period || !equipment) {
    return NextResponse.json(
      { error: "거래처, 기간, 장비는 모두 필요합니다." },
      { status: 400 },
    );
  }

  const result = await saveRecord({
    team: typeof team === "string" ? team : null,
    country: typeof country === "string" ? country : null,
    client,
    period,
    equipment,
    item: typeof item === "string" ? item : "장비",
    actual: typeof actual === "number" ? actual : null,
    forecast: typeof forecast === "number" ? forecast : null,
    actualQty: typeof actualQty === "number" ? actualQty : null,
    forecastQty: typeof forecastQty === "number" ? forecastQty : null,
    // PO 업로드처럼 건별로 쌓이는 입력은 "add" 로 기존 값에 더한다.
    mode: mode === "add" ? "add" : "overwrite",
  });

  return NextResponse.json(result);
}
