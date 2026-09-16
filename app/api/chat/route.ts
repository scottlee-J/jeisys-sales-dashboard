import { NextResponse } from "next/server";
import { readRecords, saveRecord } from "@/lib/store";
import { getSession, scopeByTeam } from "@/lib/supabase/session";
import type { Record } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 챗봇이 사용자의 말에서 뽑아내야 하는 값의 형식
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["save", "search", "rank"],
      description:
        "데이터를 저장하려는 요청이면 save, 조건에 맞는 화면을 보여 달라는 요청이면 search, " +
        "'가장 높은/낮은', '1등', '제일 잘 파는' 처럼 순위·최댓값·최솟값을 묻는 요청이면 rank",
    },
    searchFilters: {
      type: "object",
      description: "조회 요청일 때 화면에 적용할 조건",
      properties: {
        teams: { type: "array", items: { type: "string" } },
        countries: { type: "array", items: { type: "string" } },
        clients: { type: "array", items: { type: "string" } },
        equipments: { type: "array", items: { type: "string" } },
        items: { type: "array", items: { type: "string" } },
        consumablesOnly: {
          type: "boolean",
          description:
            "'소모품' 이라고만 말하고 구체적인 품목 이름은 안 말했으면 true 로 두세요 — " +
            "그러면 서버가 '장비'(본체)만 빼고 나머지 모든 품목을 골라 줍니다. items 는 이때 빈 배열로 두세요.",
        },
        periodUnit: {
          type: ["string", "null"],
          enum: ["year", "half", "quarter", "month", null],
          description: "기간 단위 (연도별 year, 반기별 half, 분기별 quarter, 월별 month)",
        },
        measure: {
          type: ["string", "null"],
          enum: ["amount", "quantity", null],
          description:
            "화면에 보여줄 기준. 금액(달러/원화) 이면 'amount', 수량(개수)이면 'quantity'. 말하지 않았으면 null.",
        },
      },
      required: [
        "teams",
        "countries",
        "clients",
        "equipments",
        "items",
        "consumablesOnly",
        "periodUnit",
        "measure",
      ],
      additionalProperties: false,
    },
    rankBy: {
      type: ["string", "null"],
      enum: ["client", "country", "equipment", "team", null],
      description:
        "intent가 rank일 때, 무엇을 기준으로 순위를 매길지. '거래처'를 물었으면 client, " +
        "'국가'면 country, '장비'면 equipment, '팀'이면 team. 말하지 않았으면 client.",
    },
    rankMetric: {
      type: ["string", "null"],
      enum: ["actual", "forecast", "achievement", "quantity", null],
      description:
        "intent가 rank일 때 무엇으로 순위를 매길지. 매출/실적이면 actual, forecast(계획)면 forecast, " +
        "'달성률'이면 achievement, '수량/대수/개수'면 quantity. 말하지 않았으면 actual.",
    },
    rankPeriodFrom: {
      type: ["string", "null"],
      description:
        "intent가 rank일 때 기간 시작(YYYY-MM). '3분기'면 해당 연도의 07, '상반기'면 01, '8월'이면 08. " +
        "기간을 말하지 않았으면 null (올해 전체).",
    },
    rankPeriodTo: {
      type: ["string", "null"],
      description:
        "intent가 rank일 때 기간 끝(YYYY-MM, 포함). '3분기'면 09, '상반기'면 06, '8월'이면 08. 말하지 않았으면 null.",
    },
    rankDirection: {
      type: ["string", "null"],
      enum: ["top", "bottom", null],
      description:
        "intent가 rank일 때, '가장 높은/제일 많이' 처럼 최댓값을 물었으면 top, " +
        "'가장 낮은/제일 안 팔리는' 처럼 최솟값을 물었으면 bottom. 말하지 않았으면 top.",
    },
    rankCount: {
      type: ["number", "null"],
      description: "intent가 rank일 때 몇 위까지 보여줄지 (예: '상위 3개' → 3). 말하지 않았으면 1.",
    },
    team: {
      type: ["string", "null"],
      description: "영업팀 (MEA팀, LATAM팀, APAC 1실, EU팀 중 하나)",
    },
    country: { type: ["string", "null"], description: "국가명" },
    client: { type: ["string", "null"], description: "거래처(대리점) 이름" },
    period: { type: ["string", "null"], description: "기간 (YYYY-MM 형식)" },
    equipment: {
      type: ["string", "null"],
      description: "장비 카테고리 (예: Density, Potenza)",
    },
    item: {
      type: ["string", "null"],
      description: "장비 안의 품목 (장비, 소모품1, 소모품2, 소모품3)",
    },
    actual: { type: ["number", "null"], description: "실적 금액 (USD)" },
    forecast: {
      type: ["number", "null"],
      description: "예측(forecast) 금액 (USD)",
    },
    actualQty: {
      type: ["number", "null"],
      description: "실적 수량 (장비는 대, 소모품은 개)",
    },
    forecastQty: { type: ["number", "null"], description: "예측 수량" },
    ready: {
      type: "boolean",
      description: "국가/기간/장비와 수치가 모두 확인되어 저장해도 되는지 여부",
    },
    reply: { type: "string", description: "사용자에게 보여줄 한국어 답변" },
  },
  required: [
    "intent",
    "searchFilters",
    "rankBy",
    "rankMetric",
    "rankPeriodFrom",
    "rankPeriodTo",
    "rankDirection",
    "rankCount",
    "team",
    "item",
    "country",
    "client",
    "period",
    "equipment",
    "actual",
    "forecast",
    "actualQty",
    "forecastQty",
    "ready",
    "reply",
  ],
  additionalProperties: false,
} as const;

// 팀 → 국가 → 거래처, 장비 → 품목 목록을 만든다. 챗봇이 한국어 발음·줄임말 입력을
// 실제(영어) 국가·거래처·장비·품목명과 매칭할 수 있도록, 매 요청마다 현재 등록된
// 목록을 시스템 프롬프트에 넣어 준다.
function buildDirectory(records: Record[]) {
  const byTeam = new Map<string, Map<string, Set<string>>>();
  const itemsByEquipment = new Map<string, Set<string>>();

  for (const record of records) {
    const byCountry = byTeam.get(record.team) ?? new Map<string, Set<string>>();
    byTeam.set(record.team, byCountry);
    const clients = byCountry.get(record.country) ?? new Set<string>();
    byCountry.set(record.country, clients);
    clients.add(record.client);

    const items = itemsByEquipment.get(record.equipment) ?? new Set<string>();
    itemsByEquipment.set(record.equipment, items);
    items.add(record.item);
  }

  const clientLines: string[] = [];
  for (const [team, byCountry] of byTeam) {
    clientLines.push(team);
    for (const [country, clients] of byCountry) {
      clientLines.push(`  ${country}: ${[...clients].join(", ")}`);
    }
  }

  const equipmentLines: string[] = [];
  for (const [equipment, items] of itemsByEquipment) {
    equipmentLines.push(`${equipment}: ${[...items].join(", ")}`);
  }

  return {
    clients: clientLines.join("\n"),
    equipment: equipmentLines.join("\n"),
  };
}

// "거래처별 미확정" 은 실제 거래처가 아니므로 순위·랭킹 계산에서는 항상 제외한다
// (화면에서도 항상 숨겨져 있는 것과 같은 기준).
const isConfirmedClient = (record: Record) =>
  !record.client.includes("거래처별 미확정");

const RANK_LABEL: { [key: string]: string } = {
  client: "거래처",
  country: "국가",
  equipment: "장비",
  team: "영업팀",
};

export type RankMetric = "actual" | "forecast" | "achievement" | "quantity";
export type RankRow = {
  name: string;
  actual: number;
  forecast: number;
  actualQty: number;
  forecastQty: number;
  achievement: number | null;
  // 순위를 매긴 기준값 (금액/수량/달성률). 달성률을 못 구하면 null.
  value: number | null;
};

// intent가 'rank' 일 때, 조건에 맞는 레코드를 모아 그룹별 합계 순위를 계산한다.
// 기간을 말하지 않았으면 가장 최근 연도(올해) 전체를 기준으로 삼는다.
// (작년 데모 데이터가 섞여 있어 연도를 안 자르면 두 해가 합쳐지기 때문)
function computeRanking(
  records: Record[],
  filters: {
    teams?: string[];
    countries?: string[];
    clients?: string[];
    equipments?: string[];
    items?: string[];
  },
  rankBy: "client" | "country" | "equipment" | "team",
  metric: RankMetric,
  direction: "top" | "bottom",
  period: { from: string | null; to: string | null },
) {
  const match = (selected: string[] | undefined, value: string) =>
    !selected || selected.length === 0 || selected.includes(value);

  const scoped = records.filter(
    (r) =>
      isConfirmedClient(r) &&
      match(filters.teams, r.team) &&
      match(filters.countries, r.country) &&
      match(filters.clients, r.client) &&
      match(filters.equipments, r.equipment) &&
      match(filters.items, r.item),
  );

  const years = [...new Set(scoped.map((r) => Number(r.period.slice(0, 4))))].sort();
  const latestYear = years.at(-1);

  const from = period.from ?? (latestYear ? `${latestYear}-01` : null);
  const to = period.to ?? (latestYear ? `${latestYear}-12` : null);
  const periodScoped =
    from && to
      ? scoped.filter((r) => r.period >= from && r.period <= to)
      : scoped;

  const totals = new Map<
    string,
    { actual: number; forecast: number; actualQty: number; forecastQty: number }
  >();
  for (const record of periodScoped) {
    const key = record[rankBy];
    const entry = totals.get(key) ?? {
      actual: 0,
      forecast: 0,
      actualQty: 0,
      forecastQty: 0,
    };
    entry.actual += record.actual ?? 0;
    entry.forecast += record.forecast ?? 0;
    entry.actualQty += record.actualQty ?? 0;
    entry.forecastQty += record.forecastQty ?? 0;
    totals.set(key, entry);
  }

  const rows: RankRow[] = [...totals.entries()].map(([name, sum]) => {
    const achievement =
      sum.forecast > 0 ? Math.round((sum.actual / sum.forecast) * 100) : null;
    const value =
      metric === "achievement"
        ? achievement
        : metric === "quantity"
          ? sum.actualQty
          : sum[metric];
    return { name, ...sum, achievement, value };
  });

  // 기준값이 없는(달성률을 못 구하는) 항목은 항상 맨 뒤로 보낸다.
  rows.sort((a, b) => {
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return direction === "top" ? b.value - a.value : a.value - b.value;
  });

  return { from, to, rows };
}

// 리더보드 표 위에 보여 줄 설명 문구 (예: "2026-07~2026-09 · 영업팀별 · 달성률 높은 순")
function buildRankCaption(
  from: string | null,
  to: string | null,
  rankBy: string,
  metric: RankMetric,
  direction: "top" | "bottom",
) {
  const metricLabel = {
    actual: "실적",
    forecast: "forecast",
    achievement: "달성률",
    quantity: "수량",
  }[metric];
  const periodLabel = from && to ? (from === to ? from : `${from}~${to}`) : "전체 기간";
  return `${periodLabel} · ${RANK_LABEL[rankBy] ?? rankBy}별 · ${metricLabel} ${
    direction === "top" ? "높은" : "낮은"
  } 순`;
}

function buildSystemPrompt(directory: { clients: string; equipment: string }) {
  const today = new Date().toISOString().slice(0, 10);
  return [
    "당신은 국가별 대리점 실적·forecast 대시보드를 돕는 한국어 챗봇입니다. 데이터 입력과 조회(검색) 두 가지를 처리합니다.",
    `오늘 날짜는 ${today} 입니다.`,
    "아래는 현재 등록된 영업팀/국가/거래처 목록입니다 (형식: 팀 다음 줄에 '  국가: 거래처1, 거래처2'):",
    directory.clients,
    "사용자가 한국어로 말하거나 실제 표기와 다르게 불러도, 뜻이 같은 대상이면 반드시 위 목록에 있는 국가·거래처 표기 그대로 country/client 에 넣으세요.",
    "예: 사용자가 '태국의 레이저 엔지니어'라고 말하면 country는 'Thailand', client는 'Laser Engineer' 그대로 씁니다. 이건 저장(save) 요청에만 적용합니다 — 국가만 말하고 거래처를 안 말했는데 그 국가에 거래처가 하나뿐이면 그 거래처로 채우세요.",
    "조회(search) 요청일 때는 사용자가 거래처를 직접 언급하지 않았다면 clients 는 항상 빈 배열로 두세요. 장비나 다른 조건만 보고 특정 거래처를 추측해서 채우지 마세요 (거래처가 여러 곳이면 전부 보여줘야 합니다).",
    "위 목록에서 뜻이 같은 국가/거래처를 도저히 찾을 수 없을 때만 사용자가 말한 이름을 새 값으로 쓰세요.",
    "아래는 현재 등록된 장비 카테고리와 그 안의 품목 목록입니다 (형식: 장비: 품목1, 품목2):",
    directory.equipment,
    "사용자가 장비나 품목을 한국어 발음, 줄임말로 말해도(예: '리니어지'→'Linear Z', '덴서티'→'Density', '포텐자'→'Potenza'), 뜻이 같으면 위 목록의 정확한 표기 그대로 equipment/item(또는 검색이면 equipments/items)에 넣으세요.",
    "먼저 intent 를 정하세요. 수치를 기록하려는 요청이면 'save', 무엇을 보여 달라거나 찾아 달라는 요청이면 'search', " +
      "'매출이 가장 높은 거래처는 어디야', '어느 나라가 제일 잘 팔려' 처럼 순위·최댓값·최솟값을 묻는 요청이면 'rank' 입니다.",
    "intent 가 'rank' 이면 searchFilters 에는 순위를 좁힐 조건만 넣으세요 (예: '대만에서'라고 했으면 countries=['Taiwan'], " +
      "clients 는 비워 두세요 — 순위를 물어보는 대상이니까요). rankBy/rankMetric/rankDirection/rankCount 를 채우고, " +
      "ready 는 false, 수치 항목은 모두 null 로 두고, reply 에는 '확인해 드릴게요' 정도로만 답하세요 (실제 순위·숫자는 서버가 계산해서 알려 줍니다).",
    "'팀별 매출', '국가별 달성률', '3분기 팀별 달성률' 처럼 '무엇별' 로 묶어서 보고 싶다고 하면 그것도 intent 'rank' 입니다 " +
      "(1등만 묻지 않아도 rank 입니다). 이때 rankCount 는 말한 개수가 없으면 넉넉히 10 으로 두세요.",
    "'달성률'을 물으면 rankMetric 을 'achievement', '수량/대수/개수'면 'quantity', '매출/실적'이면 'actual', 'forecast/계획'이면 'forecast' 로 하세요.",
    "기간을 말했으면 rankPeriodFrom/rankPeriodTo 를 YYYY-MM 으로 채우세요. 연도를 말하지 않았으면 올해로 계산합니다. " +
      "예: '3분기' → 07~09, '상반기' → 01~06, '8월' → 08~08, '1~3월' → 01~03. 기간을 말하지 않았으면 둘 다 null 로 두세요.",
    "intent 가 'search' 이면 searchFilters 에 화면에 적용할 조건을 담고, reply 에는 어떤 조건으로 화면을 바꿨는지 한 문장으로 설명하세요.",
    "searchFilters 의 각 배열에는 사용자가 말한 값만 넣고, 말하지 않은 조건은 빈 배열로 두세요 (빈 배열은 '전체' 를 뜻합니다).",
    "'연도별/반기별/분기별/월별' 처럼 기간 단위를 말했으면 periodUnit 에 각각 year/half/quarter/month 를 넣고, 말하지 않았으면 null 로 두세요.",
    "'수량', '개수', '몇 대', '판매수량' 처럼 수량 기준으로 보고 싶다는 말이 있으면 measure 를 'quantity' 로, '금액', '매출' 처럼 금액 기준이면 'amount' 로 하세요. 언급이 없으면 null 로 두세요.",
    "조회(search) 요청에서 장비(equipments)는 말했는데 품목(items)을 안 말했으면, items 는 빈 배열(전체)이 아니라 ['장비'] 로 채우세요 — 소모품까지 합친 값이 아니라 장비 본체 실적/수량을 기본으로 보여주기 위함입니다. reply 에도 '장비(본체) 기준' 이라고 알려주세요. 사용자가 소모품이나 특정 품목을 직접 말했을 때만 그 품목을 넣으세요.",
    "사용자가 '소모품'(또는 '소모품들', '소모품만')이라고만 말하고 구체적인 소모품 이름(예: 'Density Body Tip')은 안 말했으면, items 는 빈 배열로 두고 consumablesOnly 를 true 로 하세요. 이때는 reply 에 '소모품(장비 본체 제외) 기준' 이라고 알려주세요. 다른 경우엔 consumablesOnly 를 항상 false 로 두세요.",
    "intent 가 'search' 이면 ready 는 false 로 두고 수치 항목은 모두 null 로 두세요.",
    "사용자의 말에서 영업팀, 국가, 거래처, 기간, 장비, 품목, 실적 수치, forecast 수치를 뽑아내세요.",
    "거래처(대리점)가 실적을 구분하는 기준입니다. 거래처마다 취급하는 장비가 다릅니다.",
    "장비는 Density, Potenza 같은 큰 카테고리이고, 품목은 그 안의 '장비'(기계 본체), '소모품1', '소모품2', '소모품3' 입니다.",
    "사용자가 품목을 말했으면 그 품목을 그대로 쓰세요. 품목을 전혀 말하지 않은 경우에만 '장비' 로 두고, 그때만 답변에 '장비(본체) 기준으로 저장합니다' 라고 알려 주세요.",
    "영업팀은 MEA팀, LATAM팀, APAC 1실, EU팀 네 가지입니다. 팀이나 국가를 말하지 않으면 null 로 두세요 (거래처로 자동 연결됩니다).",
    "모든 금액은 달러(USD) 기준입니다. '3대', '5000개' 처럼 수량을 말하면 actualQty 나 forecastQty 에 넣고, 말하지 않으면 null 로 두세요.",
    "기간은 반드시 YYYY-MM 형식으로 변환하세요. '저번달' 같은 표현은 오늘 날짜를 기준으로 계산하고, 어떤 기간으로 이해했는지 답변에 명시하세요.",
    "장비는 미리 정해진 목록이 없으므로 사용자가 말한 이름을 그대로 사용하세요. 국가·거래처는 위 목록을 우선 따르세요.",
    "실적과 forecast 는 둘 중 하나만 있어도 저장할 수 있습니다. 하나만 말했다면 나머지는 null 로 두고 ready 를 true 로 두세요.",
    "거래처, 기간, 장비 중 하나라도 빠졌거나, 실적과 forecast 가 둘 다 없을 때만 ready 를 false 로 두고 빠진 항목을 되물으세요.",
    "모든 항목이 확인되면 ready 를 true 로 두고, 저장할 내용을 요약해서 답변하세요.",
    "답변(reply)은 항상 한국어로 작성하세요.",
  ].join("\n");
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { reply: "OPENAI_API_KEY 가 설정되어 있지 않습니다. .env 를 확인해 주세요." },
      { status: 500 },
    );
  }

  const { messages } = await request.json();
  const session = await getSession();
  // 일반 사용자에게는 자기 팀 데이터만 보여준다 (다른 팀 이름·수치가 챗봇을 통해 새지 않게).
  const scopedRecords = scopeByTeam(await readRecords(), session);
  const directory = buildDirectory(scopedRecords);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: buildSystemPrompt(directory) },
        ...messages,
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "record_input",
          schema: RESPONSE_SCHEMA,
          strict: true,
        },
      },
    }),
  });

  if (!response.ok) {
    return NextResponse.json(
      { reply: "AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }

  const data = await response.json();
  const parsed = JSON.parse(data.choices[0].message.content);

  // 순위 요청이면 서버가 직접 집계해서 답한다 (모델은 실제 매출 숫자를 모르므로).
  if (parsed.intent === "rank") {
    const rankBy = parsed.rankBy ?? "client";
    const metric: RankMetric = parsed.rankMetric ?? "actual";
    const direction = parsed.rankDirection ?? "top";
    const count = parsed.rankCount && parsed.rankCount > 0 ? parsed.rankCount : 1;

    const { from, to, rows } = computeRanking(
      scopedRecords,
      parsed.searchFilters,
      rankBy,
      metric,
      direction,
      { from: parsed.rankPeriodFrom, to: parsed.rankPeriodTo },
    );

    if (rows.length === 0) {
      return NextResponse.json({
        reply: "조건에 맞는 데이터가 없어서 순위를 계산할 수 없습니다.",
        saved: false,
      });
    }

    const caption = buildRankCaption(from, to, rankBy, metric, direction);
    const formatMetric = (row: RankRow) =>
      metric === "achievement"
        ? row.achievement === null
          ? "-"
          : `${row.achievement}%`
        : metric === "quantity"
          ? `${row.actualQty.toLocaleString()}개`
          : `$${Math.round(metric === "forecast" ? row.forecast : row.actual).toLocaleString()}`;

    const lines = rows
      .slice(0, count)
      .map((row, i) => `${i + 1}위 ${row.name} — ${formatMetric(row)}`);
    const reply = [`${caption}`, ...lines].join("\n");

    // 화면 필터는 1위 대상으로 맞춰서 그래프로도 바로 확인할 수 있게 한다.
    const searchFilters = { ...parsed.searchFilters };
    const winner = rows[0].name;
    if (rankBy === "client") searchFilters.clients = [winner];
    if (rankBy === "country") searchFilters.countries = [winner];
    if (rankBy === "equipment") searchFilters.equipments = [winner];
    if (rankBy === "team") searchFilters.teams = [winner];
    if (searchFilters.equipments.length > 0 && searchFilters.items.length === 0) {
      searchFilters.items = ["장비"];
    }

    return NextResponse.json({ reply, saved: false, searchFilters });
  }

  // 조회 요청이면 저장하지 않고, 화면에 적용할 조건만 돌려준다.
  if (parsed.intent === "search") {
    const searchFilters = { ...parsed.searchFilters };
    // 장비는 골랐는데 품목을 안 골랐으면, 소모품까지 합친 "전체"가 아니라
    // 장비(본체) 기준으로 기본을 잡는다. (모델이 놓쳤을 때를 대비한 안전장치)
    if (searchFilters.equipments.length > 0 && searchFilters.items.length === 0) {
      searchFilters.items = ["장비"];
    }
    return NextResponse.json({
      reply: parsed.reply,
      saved: false,
      searchFilters,
    });
  }

  const hasNumber =
    parsed.actual !== null ||
    parsed.forecast !== null ||
    parsed.actualQty !== null ||
    parsed.forecastQty !== null;
  const hasAllKeys = parsed.client && parsed.period && parsed.equipment;

  // 저장할 준비가 안 되었으면 되묻는 답변만 돌려준다.
  if (!parsed.ready || !hasAllKeys || !hasNumber) {
    return NextResponse.json({ reply: parsed.reply, saved: false });
  }

  // 음수 등 비정상 수치는 저장하지 않고 사용자에게 먼저 확인한다.
  const negative =
    (parsed.actual !== null && parsed.actual < 0) ||
    (parsed.forecast !== null && parsed.forecast < 0);
  if (negative) {
    return NextResponse.json({
      reply: "입력하신 수치에 음수가 있습니다. 값이 맞는지 확인 후 다시 알려 주세요.",
      saved: false,
    });
  }

  const result = await saveRecord({
    team: parsed.team,
    country: parsed.country,
    client: parsed.client,
    period: parsed.period,
    equipment: parsed.equipment,
    // 품목을 말하지 않았으면 기계 본체를 뜻하는 "장비" 로 저장한다.
    item: parsed.item ?? "장비",
    actual: parsed.actual,
    forecast: parsed.forecast,
    actualQty: parsed.actualQty,
    forecastQty: parsed.forecastQty,
  });

  // 덮어쓴 경우에는 기존 값이 무엇이었는지 함께 알려 준다.
  const overwriteNotice = result.overwritten
    ? ` (기존 값 실적 ${result.previous?.actual ?? "-"} / forecast ${
        result.previous?.forecast ?? "-"
      } 을 덮어썼습니다)`
    : "";

  return NextResponse.json({
    reply: `${parsed.reply}\n\n저장 완료: ${result.record.team} / ${result.record.country} / ${result.record.client} / ${result.record.period} / ${result.record.equipment} · ${result.record.item} — 실적 $${(result.record.actual ?? 0).toLocaleString()}, forecast $${(result.record.forecast ?? 0).toLocaleString()}${overwriteNotice}`,
    saved: true,
    record: result.record,
  });
}
