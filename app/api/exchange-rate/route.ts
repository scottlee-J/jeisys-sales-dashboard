import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 서울외국환중개에서 원/달러 매매기준율을 조회한다.
// 매매기준율은 은행 영업일 하루 1회만 고시되므로, 최근 2주를 조회해 가장 마지막 값을 사용한다.
const BASE_URL = "http://www.smbs.biz/ExRate/StdExRate_xml.jsp";

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function GET() {
  const today = new Date();
  const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
  const url = `${BASE_URL}?arr_value=USD_${formatDate(twoWeeksAgo)}_${formatDate(today)}`;

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("조회 실패");

    // 응답이 EUC-KR 인코딩이라 직접 변환해서 읽는다.
    const xml = new TextDecoder("euc-kr").decode(await response.arrayBuffer());
    const entries = [
      ...xml.matchAll(/label='([\d.]+)'\s+value='([\d.]+)'/g),
    ].map((match) => ({ date: match[1], rate: Number(match[2]) }));

    const latest = entries.at(-1);
    if (!latest) throw new Error("환율 값을 찾지 못함");

    return NextResponse.json({
      rate: latest.rate,
      date: latest.date,
      source: "서울외국환중개 매매기준율",
    });
  } catch {
    return NextResponse.json(
      { error: "환율을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
}
