import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { readRecords } from "@/lib/store";
import { getSession, scopeByTeam } from "@/lib/supabase/session";
import type { Record } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PO(발주서) PDF 에서 뽑아내야 하는 값의 형식.
// 저장은 하지 않고, 사용자가 화면에서 확인한 뒤 직접 반영 버튼을 누르게 한다.
const PO_SCHEMA = {
  type: "object",
  properties: {
    poNumber: { type: ["string", "null"], description: "PO 번호 (없으면 null)" },
    poDate: { type: ["string", "null"], description: "발주일 (YYYY-MM-DD, 없으면 null)" },
    client: {
      type: ["string", "null"],
      description: "발주한 거래처(대리점) 이름. 아래 거래처 목록에 있는 표기를 그대로 쓸 것",
    },
    country: { type: ["string", "null"], description: "거래처가 속한 국가" },
    period: {
      type: ["string", "null"],
      description: "실적으로 잡을 기간 (YYYY-MM). 보통 발주일의 연·월",
    },
    lines: {
      type: "array",
      description: "PO 의 품목 줄들",
      items: {
        type: "object",
        properties: {
          rawName: { type: "string", description: "PDF 에 적힌 제품명 그대로" },
          equipment: {
            type: ["string", "null"],
            description: "위 장비 목록에서 찾은 장비 카테고리. 못 찾으면 null",
          },
          item: {
            type: ["string", "null"],
            description: "위 품목 목록에서 찾은 품목명. 장비 본체면 '장비'. 못 찾으면 null",
          },
          quantity: { type: ["number", "null"], description: "수량 (Qty)" },
          unitPrice: {
            type: ["number", "null"],
            description: "단가 (UNIT PRICE / Price 칸의 값, USD). 없으면 null",
          },
          amount: {
            type: ["number", "null"],
            description:
              "그 줄의 합계 금액 (Amount/Total 칸이 따로 있을 때만). 없으면 null — 서버가 수량×단가로 계산한다",
          },
        },
        required: ["rawName", "equipment", "item", "quantity", "unitPrice", "amount"],
        additionalProperties: false,
      },
    },
    note: {
      type: "string",
      description: "확실하지 않은 부분이 있으면 한국어로 짧게 알려 줄 것. 없으면 빈 문자열",
    },
  },
  required: ["poNumber", "poDate", "client", "country", "period", "lines", "note"],
  additionalProperties: false,
} as const;

// 챗봇과 같은 방식으로, 실제 등록된 거래처·장비·품목 목록을 알려 줘서
// PDF 에 적힌 이름을 이 앱의 표기로 맞추게 한다.
function buildDirectory(records: Record[]) {
  const clientsByCountry = new Map<string, Set<string>>();
  const itemsByEquipment = new Map<string, Set<string>>();
  // 거래처 이름 → 그 거래처의 국가·팀 (PO 에 국가가 없거나 달라도 여기서 채운다)
  const clientInfo = new Map<string, { country: string; team: string }>();

  for (const record of records) {
    const clients = clientsByCountry.get(record.country) ?? new Set<string>();
    clientsByCountry.set(record.country, clients);
    clients.add(record.client);
    if (!clientInfo.has(record.client)) {
      clientInfo.set(record.client, { country: record.country, team: record.team });
    }

    const items = itemsByEquipment.get(record.equipment) ?? new Set<string>();
    itemsByEquipment.set(record.equipment, items);
    items.add(record.item);
  }

  return {
    itemsByEquipment,
    clientInfo,
    clients: [...clientsByCountry.entries()]
      .map(([country, clients]) => `${country}: ${[...clients].join(", ")}`)
      .join("\n"),
    equipment: [...itemsByEquipment.entries()]
      .map(([equipment, items]) => `${equipment}: ${[...items].join(", ")}`)
      .join("\n"),
  };
}

// 비교용으로 이름을 단순화한다 (대소문자·공백·괄호·기호 무시).
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");

// PDF 에 적힌 거래처 이름("DensTech Co., Ltd.")을 등록된 거래처("DensTech")로 맞춘다.
// 못 맞추면 null 을 돌려주고, 화면에서는 저장을 막는다 (새 거래처를 멋대로 만들지 않기 위함).
function matchClient(
  rawClient: string | null,
  clientInfo: Map<string, { country: string; team: string }>,
) {
  if (!rawClient) return null;
  const raw = normalize(rawClient);
  const found = [...clientInfo.keys()]
    .filter((name) => {
      const normalized = normalize(name);
      return raw.includes(normalized) || normalized.includes(raw);
    })
    .sort((a, b) => b.length - a.length)[0];
  return found ?? null;
}

// AI 가 장비를 엉뚱하게 고르는 일이 있어서(예: "DENSITY Main Unit" → Potenza),
// PDF 에 적힌 제품명에 실제 장비명이 그대로 들어 있으면 그것을 우선한다.
// 이름이 겹치면 더 긴 쪽을 고른다 ("TRI-BEAM PRO" 가 "TRI-BEAM" 보다 우선).
function matchLine(
  rawName: string,
  aiEquipment: string | null,
  aiItem: string | null,
  itemsByEquipment: Map<string, Set<string>>,
) {
  const raw = normalize(rawName);

  const equipment =
    [...itemsByEquipment.keys()]
      .filter((name) => raw.includes(normalize(name)))
      .sort((a, b) => b.length - a.length)[0] ?? aiEquipment;

  if (!equipment) return { equipment: null, item: null };

  const items = itemsByEquipment.get(equipment);
  // 장비는 맞췄는데 품목이 그 장비의 품목이 아니면 다시 찾는다.
  if (aiItem && items?.has(aiItem)) return { equipment, item: aiItem };

  const itemByName = [...(items ?? [])]
    .filter((name) => name !== "장비" && raw.includes(normalize(name)))
    .sort((a, b) => b.length - a.length)[0];
  if (itemByName) return { equipment, item: itemByName };

  // 소모품 이름이 안 잡히고 본체로 보이면 "장비"(본체) 로 본다.
  const looksLikeMainUnit = /main ?unit|system|본체|장비/i.test(rawName);
  return { equipment, item: looksLikeMainUnit ? "장비" : null };
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY 가 설정되어 있지 않습니다." },
      { status: 500 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "PDF 파일이 없습니다." }, { status: 400 });
  }

  let text = "";
  try {
    const parser = new PDFParse({ data: Buffer.from(await file.arrayBuffer()) });
    text = (await parser.getText()).text;
  } catch (error) {
    console.error("PDF 읽기 실패:", error);
    return NextResponse.json(
      { error: "PDF 를 읽지 못했습니다. 다른 파일로 시도해 주세요." },
      { status: 400 },
    );
  }

  if (text.trim().length < 20) {
    return NextResponse.json(
      {
        error:
          "PDF 에서 글자를 찾지 못했습니다. 스캔한 이미지 PDF 는 아직 지원하지 않습니다.",
      },
      { status: 400 },
    );
  }

  const session = await getSession();
  const directory = buildDirectory(scopeByTeam(await readRecords(), session));
  const today = new Date().toISOString().slice(0, 10);

  const systemPrompt = [
    "당신은 의료기기 회사의 PO(발주서) PDF 내용을 읽고, 실적 대시보드에 넣을 형태로 정리하는 도우미입니다.",
    `오늘 날짜는 ${today} 입니다.`,
    "아래는 이 시스템에 등록된 국가별 거래처 목록입니다:",
    directory.clients,
    "아래는 등록된 장비와 그 안의 품목 목록입니다 (형식: 장비: 품목1, 품목2):",
    directory.equipment,
    "PDF 에 적힌 거래처·제품 이름이 위 목록과 철자가 달라도, 같은 대상이면 위 목록의 표기를 그대로 쓰세요.",
    "장비 본체를 주문한 줄이면 item 은 '장비' 로 하세요. 소모품이면 위 품목 목록에서 가장 알맞은 이름을 고르세요.",
    "위 목록에서 도저히 못 찾겠으면 equipment/item 을 null 로 두고, note 에 어떤 줄이 애매한지 적어 주세요. 추측해서 아무 이름이나 넣지 마세요.",
    "금액은 USD 기준 숫자만 넣으세요. PDF 의 'UNIT PRICE'(단가) 는 unitPrice 에, 줄 합계(Amount/Total)가 따로 있으면 amount 에 넣고, 없으면 amount 는 null 로 두세요.",
    "period 는 발주일의 연·월(YYYY-MM)로 하세요.",
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `아래는 PO PDF 에서 추출한 글자입니다.\n\n${text.slice(0, 20000)}` },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "po_document", schema: PO_SCHEMA, strict: true },
      },
    }),
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: "PO 내용을 해석하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }

  const data = await response.json();
  const parsed = JSON.parse(data.choices[0].message.content);

  // PDF 에 적힌 거래처명을 등록된 거래처로 맞춘다. 못 맞추면 저장할 수 없다.
  const client = matchClient(parsed.client, directory.clientInfo);
  const info = client ? directory.clientInfo.get(client) : null;

  // 같은 거래처·기간·품목에 이미 들어있는 값을 함께 보여 줘서, 반영 후 값을 미리 볼 수 있게 한다.
  const records = await readRecords();
  const lines = parsed.lines.map(
    (line: {
      rawName: string;
      equipment: string | null;
      item: string | null;
      quantity: number | null;
      unitPrice: number | null;
      amount: number | null;
    }) => {
      // AI 가 고른 장비·품목을 PDF 제품명과 대조해서 바로잡는다.
      const matched = matchLine(
        line.rawName,
        line.equipment,
        line.item,
        directory.itemsByEquipment,
      );
      const existing =
        client && parsed.period && matched.equipment && matched.item
          ? (records.find(
              (r) =>
                r.client === client &&
                r.period === parsed.period &&
                r.equipment === matched.equipment &&
                r.item === matched.item,
            ) ?? null)
          : null;
      // PO 에 합계 칸이 따로 없으면 수량 × 단가로 채운다.
      const amount =
        line.amount ??
        (line.quantity !== null && line.unitPrice !== null
          ? line.quantity * line.unitPrice
          : null);

      return {
        ...line,
        ...matched,
        amount,
        existingActual: existing?.actual ?? null,
        existingActualQty: existing?.actualQty ?? null,
      };
    },
  );

  return NextResponse.json({
    ...parsed,
    // 거래처·국가·팀은 추측한 이름이 아니라 등록된 값으로 돌려준다.
    client,
    rawClient: parsed.client,
    country: info?.country ?? null,
    team: info?.team ?? null,
    lines,
    fileName: file.name,
    // 미리보기 표에서 장비·품목을 직접 고칠 수 있도록 등록된 목록을 함께 내려 준다.
    equipmentOptions: Object.fromEntries(
      [...directory.itemsByEquipment.entries()].map(([equipment, items]) => [
        equipment,
        [...items].sort((a, b) => (a === "장비" ? -1 : b === "장비" ? 1 : a.localeCompare(b))),
      ]),
    ),
  });
}
