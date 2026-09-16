"use client";

import { useRef, useState } from "react";

type PoLine = {
  rawName: string;
  equipment: string | null;
  item: string | null;
  quantity: number | null;
  unitPrice: number | null;
  // 실적에 더할 금액. 기본은 수량 × 단가이고, 직접 고칠 수도 있다.
  amount: number | null;
  existingActual: number | null;
  existingActualQty: number | null;
};

type PoResult = {
  fileName: string;
  poNumber: string | null;
  poDate: string | null;
  // 등록된 거래처로 맞춘 이름. 못 맞추면 null 이고 이때는 저장할 수 없다.
  client: string | null;
  rawClient: string | null;
  country: string | null;
  team: string | null;
  period: string | null;
  lines: PoLine[];
  note: string;
  // 장비 → 그 장비의 품목 목록 (표에서 직접 고를 수 있게)
  equipmentOptions: { [equipment: string]: string[] };
};

// PO(발주서) PDF 를 올리면 내용을 읽어 미리 보여 주고, 확인 후 실적에 더한다.
export default function PoUpload({ onSaved }: { onSaved: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PoResult | null>(null);
  // 표에서 고친 값은 여기에 담는다 (읽어온 원본과 분리).
  const [lines, setLines] = useState<PoLine[]>([]);
  const [done, setDone] = useState<string | null>(null);

  const updateLine = (index: number, patch: Partial<PoLine>) =>
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const next = { ...line, ...patch };
        // 수량이나 단가를 고치면 합계(실적에 더할 금액)를 다시 계산한다.
        // 합계를 직접 고쳤을 때는 그 값을 그대로 쓴다.
        if (patch.amount === undefined) {
          next.amount =
            next.quantity !== null && next.unitPrice !== null
              ? next.quantity * next.unitPrice
              : line.amount;
        }
        return next;
      }),
    );

  async function upload(file: File) {
    setLoading(true);
    setError(null);
    setResult(null);
    setLines([]);
    setDone(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/po", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "PO 를 읽지 못했습니다.");
        return;
      }
      setResult(data);
      setLines(data.lines);
    } catch {
      setError("업로드 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  // 미리보기에서 확인한 줄만 실적(actual)에 더한다.
  async function save() {
    if (!result?.client || !result.period) return;
    const savable = lines.filter(
      (line) => line.equipment && line.item && (line.amount !== null || line.quantity !== null),
    );
    setSaving(true);
    try {
      for (const line of savable) {
        await fetch("/api/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            team: result.team,
            country: result.country,
            client: result.client,
            period: result.period,
            equipment: line.equipment,
            item: line.item,
            actual: line.amount,
            actualQty: line.quantity,
            mode: "add",
          }),
        });
      }
      setDone(`${savable.length}개 품목을 실적에 반영했습니다.`);
      setResult(null);
      setLines([]);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const savableCount = lines.filter(
    (line) => line.equipment && line.item && (line.amount !== null || line.quantity !== null),
  ).length;

  return (
    <section className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium">PO(발주서) PDF 올리기</h2>
        <span className="text-xs text-black/50 dark:text-white/50">
          내용을 읽어 보여 준 뒤, 확인하면 실적에 더합니다
        </span>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={loading}
          className="ml-auto rounded-full bg-indigo-500 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          {loading ? "읽는 중..." : "PDF 선택"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload(file);
            event.target.value = "";
          }}
        />
      </div>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      {done && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{done}</p>}

      {result && (
        <div className="mt-4 space-y-3">
          <div className="text-sm">
            <span className="font-medium">{result.client ?? "거래처 매칭 실패"}</span>
            <span className="text-black/50 dark:text-white/50">
              {" "}
              · {result.country ?? "-"} · {result.period ?? "기간 미확인"}
              {result.poNumber ? ` · PO ${result.poNumber}` : ""}
            </span>
          </div>
          {!result.client && (
            <p className="text-sm text-red-500">
              PDF 의 거래처(&quot;{result.rawClient ?? "-"}&quot;)를 등록된 거래처와
              연결하지 못했습니다. 새 거래처를 임의로 만들지 않기 위해 반영하지 않습니다.
            </p>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-black/50 dark:text-white/50">
                <th className="py-1.5 text-left font-normal">PDF 제품명</th>
                <th className="py-1.5 text-left font-normal">장비 · 품목</th>
                <th className="py-1.5 text-right font-normal">수량</th>
                <th className="py-1.5 text-right font-normal">단가(USD)</th>
                <th className="py-1.5 text-right font-normal">합계(USD)</th>
                <th className="py-1.5 text-right font-normal">반영 후 실적</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/10">
              {lines.map((line, index) => {
                const itemOptions = line.equipment
                  ? (result.equipmentOptions[line.equipment] ?? [])
                  : [];
                const matched = line.equipment && line.item;
                return (
                  <tr key={index}>
                    <td className="py-2">{line.rawName}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        <select
                          value={line.equipment ?? ""}
                          onChange={(event) =>
                            // 장비를 바꾸면 품목은 그 장비의 것으로 다시 골라야 한다.
                            updateLine(index, {
                              equipment: event.target.value || null,
                              item: null,
                            })
                          }
                          className="rounded border border-black/15 bg-transparent px-1.5 py-0.5 text-xs dark:border-white/20"
                        >
                          <option value="">장비 선택</option>
                          {Object.keys(result.equipmentOptions).map((equipment) => (
                            <option key={equipment} value={equipment}>
                              {equipment}
                            </option>
                          ))}
                        </select>
                        <select
                          value={line.item ?? ""}
                          onChange={(event) =>
                            updateLine(index, { item: event.target.value || null })
                          }
                          disabled={!line.equipment}
                          className="rounded border border-black/15 bg-transparent px-1.5 py-0.5 text-xs disabled:opacity-40 dark:border-white/20"
                        >
                          <option value="">품목 선택</option>
                          {itemOptions.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="py-2 text-right">
                      <input
                        type="number"
                        value={line.quantity ?? ""}
                        onChange={(event) =>
                          updateLine(index, {
                            quantity: event.target.value === "" ? null : Number(event.target.value),
                          })
                        }
                        className="w-20 rounded border border-black/15 bg-transparent px-1.5 py-0.5 text-right text-sm tabular-nums dark:border-white/20"
                      />
                    </td>
                    <td className="py-2 text-right">
                      <input
                        type="number"
                        value={line.unitPrice ?? ""}
                        onChange={(event) =>
                          updateLine(index, {
                            unitPrice:
                              event.target.value === "" ? null : Number(event.target.value),
                          })
                        }
                        className="w-24 rounded border border-black/15 bg-transparent px-1.5 py-0.5 text-right text-sm tabular-nums dark:border-white/20"
                      />
                    </td>
                    <td className="py-2 text-right">
                      <input
                        type="number"
                        value={line.amount ?? ""}
                        onChange={(event) =>
                          updateLine(index, {
                            amount: event.target.value === "" ? null : Number(event.target.value),
                          })
                        }
                        className="w-28 rounded border border-black/15 bg-transparent px-1.5 py-0.5 text-right text-sm tabular-nums dark:border-white/20"
                      />
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {!matched || line.amount === null
                        ? "-"
                        : `$${((line.existingActual ?? 0) + line.amount).toLocaleString()}`}
                      {matched && line.existingActual !== null && (
                        <span className="ml-1 text-xs text-black/40 dark:text-white/40">
                          (기존 ${line.existingActual.toLocaleString()})
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {result.note && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{result.note}</p>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving || savableCount === 0 || !result.client || !result.period}
              className="rounded-full bg-indigo-500 px-4 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {saving ? "반영 중..." : `${savableCount}개 품목 실적에 반영`}
            </button>
            <button
              onClick={() => {
                setResult(null);
                setLines([]);
              }}
              className="rounded-full border border-black/15 px-4 py-1.5 text-sm text-black/70 dark:border-white/20 dark:text-white/70"
            >
              취소
            </button>
            <span className="text-xs text-black/50 dark:text-white/50">
              수량·단가를 고치면 합계가 자동 계산되고, 합계를 직접 고치면 그 값이 쓰입니다. 장비나
              품목을 안 고르면 그 줄은 빠집니다.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
