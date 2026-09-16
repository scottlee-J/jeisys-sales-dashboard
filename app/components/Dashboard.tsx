"use client";

import { useCallback, useMemo, useState } from "react";
import Chart, { type ChartPoint } from "./Chart";
import Chatbot, { type SearchFilters } from "./Chatbot";
import PoUpload from "./PoUpload";
import { logout } from "@/app/logout/actions";
import type { Session } from "@/lib/supabase/session";
import type { Currency, Dealer, Measure, PeriodUnit, Record } from "@/lib/types";

const PERIOD_UNITS: { value: PeriodUnit; label: string }[] = [
  { value: "year", label: "연도별" },
  { value: "half", label: "반기별" },
  { value: "quarter", label: "분기별" },
  { value: "month", label: "월별" },
];

export default function Dashboard({
  initialRecords,
  initialDealers,
  session,
}: {
  initialRecords: Record[];
  initialDealers: Dealer[];
  session: Session | null;
}) {
  // 일반 사용자는 자기 소속 팀 데이터만 본다. 서버(records API, page.tsx)가 이미
  // 다른 팀 데이터를 아예 안 내려주므로, 여기서는 팀 필터를 그 팀 하나로 고정만 한다.
  const restrictedTeam =
    session && session.role !== "admin" ? session.team : null;

  const [records, setRecords] = useState<Record[]>(initialRecords);
  // 매출 확정 여부와 무관한 거래처 마스터 목록. 입력 데이터로는 바뀌지 않으므로 고정값으로 둔다.
  const [dealers] = useState<Dealer[]>(initialDealers);
  const [selectedTeams, setSelectedTeams] = useState<string[]>(
    restrictedTeam ? [restrictedTeam] : [],
  );
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [selectedEquipments, setSelectedEquipments] = useState<string[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [periodUnit, setPeriodUnit] = useState<PeriodUnit>("month");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [measure, setMeasure] = useState<Measure>("amount");
  const [rate, setRate] = useState<{ rate: number; date: string } | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  // 아직 거래처가 확정되지 않은 매출("OO (거래처별 미확정)")은 화면에서 항상 숨긴다.
  // 데이터를 지우는 게 아니라 화면에만 안 보이게 하는 것이다.
  const visibleRecords = useMemo(
    () => records.filter((r) => !r.client.includes("거래처별 미확정")),
    [records],
  );

  // 챗봇으로 데이터가 저장된 뒤 최신 목록을 다시 불러온다.
  const reloadRecords = useCallback(async () => {
    const res = await fetch("/api/records");
    const data = await res.json();
    setRecords(data.records);
  }, []);

  // 챗봇으로 조회하면 말한 조건이 그대로 화면 조건으로 설정된다.
  // 단, 일반 사용자는 자기 팀 밖으로 못 나가게 팀 조건은 고정해 둔다.
  const applySearch = useCallback(
    (filters: SearchFilters) => {
      const teams = restrictedTeam ? [restrictedTeam] : (filters.teams ?? []);
      const countries = filters.countries ?? [];
      const clients = filters.clients ?? [];
      const equipments = filters.equipments ?? [];

      setSelectedTeams(teams);
      setSelectedCountries(countries);
      setSelectedClients(clients);
      setSelectedEquipments(equipments);

      // "소모품"만 말했을 때는 방금 고른 조건 기준으로 "장비"(본체)만 빼고 나머지
      // 품목을 전부 골라 준다. (state 는 비동기라 기존 items 메모를 못 쓰므로 직접 다시 좁힌다)
      if (filters.consumablesOnly) {
        const consumables = unique(
          scope(visibleRecords, {
            selectedTeams: teams,
            selectedCountries: countries,
            selectedClients: clients,
            selectedEquipments: equipments,
          }).map((r) => r.item),
        ).filter((item) => item !== "장비");
        setSelectedItems(consumables);
      } else {
        setSelectedItems(filters.items ?? []);
      }

      if (filters.periodUnit) setPeriodUnit(filters.periodUnit);
      if (filters.measure) setMeasure(filters.measure);
    },
    [restrictedTeam, visibleRecords],
  );

  // 원화로 볼 때만 서울외국환중개의 매매기준율을 불러온다.
  const changeCurrency = useCallback(
    async (next: Currency) => {
      if (next === "USD") {
        setCurrency("USD");
        return;
      }
      if (rate) {
        setCurrency("KRW");
        return;
      }
      const res = await fetch("/api/exchange-rate");
      const data = await res.json();
      if (!res.ok) {
        setRateError(data.error);
        return;
      }
      setRate({ rate: data.rate, date: data.date });
      setRateError(null);
      setCurrency("KRW");
    },
    [rate],
  );

  // 상위 조건을 고르면 그에 해당하는 하위 목록만 보여 준다.
  // (팀 → 국가 → 거래처 → 장비 순서로 좁혀진다)
  const teams = useMemo(
    () => unique(visibleRecords.map((r) => r.team)),
    [visibleRecords],
  );
  const countries = useMemo(
    () => unique(scope(visibleRecords, { selectedTeams }).map((r) => r.country)),
    [visibleRecords, selectedTeams],
  );
  // 거래처는 "실적이 확정된 거래처"만 보여 주면 매출을 못 번 것처럼 보이는 실제 거래처가
  // 통째로 숨어 버린다(예: 취급 장비가 매트릭스에 여러 후보로 걸려 "미확정"에 묶인 경우).
  // 그래서 실적 데이터의 거래처 + 매트릭스 기준 거래처 마스터 목록을 합쳐서 보여 준다.
  const clients = useMemo(() => {
    const fromRecords = scope(visibleRecords, {
      selectedTeams,
      selectedCountries,
    }).map((r) => r.client);
    const fromDealers = dealers
      .filter(
        (d) =>
          (selectedTeams.length === 0 || selectedTeams.includes(d.team)) &&
          (selectedCountries.length === 0 || selectedCountries.includes(d.country)),
      )
      .map((d) => d.client);
    return unique([...fromRecords, ...fromDealers]);
  }, [visibleRecords, dealers, selectedTeams, selectedCountries]);
  // 거래처마다 취급하는 장비가 다르므로, 거래처를 고르면 그 거래처의 장비만 남는다.
  const equipments = useMemo(
    () =>
      unique(
        scope(visibleRecords, {
          selectedTeams,
          selectedCountries,
          selectedClients,
        }).map((r) => r.equipment),
      ),
    [visibleRecords, selectedTeams, selectedCountries, selectedClients],
  );
  // 장비를 고르면 그 장비에 속한 품목(소모품)만 남는다.
  // "장비"(본체) 는 항상 맨 앞에 두고 소모품을 이름 순으로 보여 준다.
  const items = useMemo(() => {
    const list = unique(
      scope(visibleRecords, {
        selectedTeams,
        selectedCountries,
        selectedClients,
        selectedEquipments,
      }).map((r) => r.item),
    );
    return list.sort((a, b) => {
      if (a === "장비") return -1;
      if (b === "장비") return 1;
      return a.localeCompare(b);
    });
  }, [visibleRecords, selectedTeams, selectedCountries, selectedClients, selectedEquipments]);

  // 품목 옆에 참고용 표준 단가를 작게 보여 주기 위한 이름 → "$40" 형태 맵
  const itemPrices = useMemo(() => {
    const scoped = scope(visibleRecords, {
      selectedTeams,
      selectedCountries,
      selectedClients,
      selectedEquipments,
    });
    const prices: { [item: string]: string } = {};
    for (const record of scoped) {
      if (record.standardPrice !== null && !prices[record.item]) {
        prices[record.item] = `$${record.standardPrice.toLocaleString()}`;
      }
    }
    return prices;
  }, [visibleRecords, selectedTeams, selectedCountries, selectedClients, selectedEquipments]);

  // 조건을 고르지 않으면 전체를 선택한 것으로 보고 상위 단위 합계를 보여 준다.
  const filtered = useMemo(
    () =>
      scope(visibleRecords, {
        selectedTeams,
        selectedCountries,
        selectedClients,
        selectedEquipments,
        selectedItems,
      }),
    [
      visibleRecords,
      selectedTeams,
      selectedCountries,
      selectedClients,
      selectedEquipments,
      selectedItems,
    ],
  );

  // 지금 고른 조건(팀/국가/거래처/장비/품목)에 해당하는 원본 데이터를 CSV로 내려받는다.
  // 엑셀에서 그대로 열리므로, 새 라이브러리 없이 이 방식으로 데이터 검증을 지원한다.
  const exportCsv = useCallback(() => {
    const headers = [
      "팀", "국가", "거래처", "기간", "장비", "품목",
      "실적금액(USD)", "forecast금액(USD)", "실적수량", "forecast수량", "표준단가(USD)",
    ];
    const escape = (value: string | number | null) => {
      if (value === null || value === undefined) return "";
      const text = String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const rows = filtered.map((r) =>
      [
        r.team, r.country, r.client, r.period, r.equipment, r.item,
        r.actual, r.forecast, r.actualQty, r.forecastQty, r.standardPrice,
      ]
        .map(escape)
        .join(","),
    );
    // 엑셀에서 한글이 안 깨지도록 UTF-8 BOM을 앞에 붙인다.
    const csv = "﻿" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `실적데이터_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  // 선택한 기간 단위(연/반기/분기/월)로 묶어서 금액과 수량을 함께 합산한다.
  const buckets = useMemo(() => {
    const map = new Map<
      string,
      {
        label: string;
        actual: number | null;
        forecast: number | null;
        actualQty: number | null;
        forecastQty: number | null;
      }
    >();

    // 분기별/월별은 작년 데이터까지 섞여 기간이 밀리지 않도록, 가장 최근 연도(올해)만
    // 1월(1분기)부터 보여 준다. (연도별/반기별은 기존처럼 최근 12개 기간 그대로)
    const years = filtered.map((r) => Number(r.period.slice(0, 4)));
    const latestYear = years.length ? Math.max(...years) : null;

    for (const record of filtered) {
      if (
        (periodUnit === "quarter" || periodUnit === "month") &&
        latestYear !== null &&
        Number(record.period.slice(0, 4)) !== latestYear
      ) {
        continue;
      }
      const { key, label } = toBucket(record.period, periodUnit);
      const current = map.get(key) ?? {
        label,
        actual: null,
        forecast: null,
        actualQty: null,
        forecastQty: null,
      };
      if (record.actual !== null) {
        current.actual = (current.actual ?? 0) + record.actual;
      }
      if (record.forecast !== null) {
        current.forecast = (current.forecast ?? 0) + record.forecast;
      }
      if (record.actualQty !== null) {
        current.actualQty = (current.actualQty ?? 0) + record.actualQty;
      }
      if (record.forecastQty !== null) {
        current.forecastQty = (current.forecastQty ?? 0) + record.forecastQty;
      }
      map.set(key, current);
    }

    return (
      [...map.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        // 수치가 겹치지 않도록 가장 최근 12개 기간까지만 보여 준다.
        .slice(-12)
        // key 는 요약 카드에 "어떤 기간 기준인지" 표기할 때 쓴다.
        .map(([key, value]) => ({ key, ...value }))
    );
  }, [filtered, periodUnit]);

  // 원화 환산은 금액에만 적용한다. (수량 그래프에는 환율을 쓰지 않는다)
  const amountExchange = currency === "KRW" && rate ? rate.rate : 1;
  const exchange = measure === "amount" ? amountExchange : 1;

  // 그래프 안에는 숫자만 쓰고, 단위는 그래프 오른쪽 위에 한 번만 표시한다.
  const formatPoint = (value: number) =>
    measure === "amount"
      ? formatCompact(value, currency)
      : formatQuantityCompact(value);
  const chartUnit =
    measure === "quantity" ? "개" : currency === "USD" ? "USD" : "억원";

  const points: ChartPoint[] = useMemo(
    () =>
      buckets.map((bucket) => {
        const actual = measure === "amount" ? bucket.actual : bucket.actualQty;
        const forecast =
          measure === "amount" ? bucket.forecast : bucket.forecastQty;
        return {
          period: bucket.label,
          actual: actual === null ? null : actual * exchange,
          forecast: forecast === null ? null : forecast * exchange,
        };
      }),
    [buckets, measure, exchange],
  );

  // 요약 카드는 그래프에 보이는 전체 기간의 합이 아니라, 선택한 기간 단위의
  // 가장 마지막 기간(올해 / 이번 반기 / 이번 분기 / 이번 달)만 보여 준다.
  // 앞으로의 forecast 만 있는 기간은 건너뛰고, 실적이 들어온 마지막 기간을 쓴다.
  const latestBucket =
    [...buckets].reverse().find((bucket) => bucket.actual !== null) ??
    buckets.at(-1) ??
    null;
  const totals = {
    actual: latestBucket?.actual ?? 0,
    forecast: latestBucket?.forecast ?? 0,
    actualQty: latestBucket?.actualQty ?? 0,
    forecastQty: latestBucket?.forecastQty ?? 0,
  };
  // 카드에 "어떤 기간 기준인지" 적어 준다. (예: 2026년 3분기)
  const totalsPeriod = latestBucket ? toPeriodCaption(latestBucket.key) : null;

  const achievement =
    totals.forecast > 0
      ? Math.round((totals.actual / totals.forecast) * 100)
      : 0;

  // 올해와 작년의 같은 기간(1월, 1분기, 상반기 …) 실적을 나란히 비교한다.
  const comparison = useMemo(() => {
    // 연도별로 볼 때는 이미 연도 간 비교라서 따로 만들지 않는다.
    if (periodUnit === "year") return null;

    const years = [
      ...new Set(filtered.map((r) => Number(r.period.slice(0, 4)))),
    ].sort();
    const thisYear = years.at(-1);
    if (thisYear === undefined || !years.includes(thisYear - 1)) return null;
    const lastYear = thisYear - 1;

    const buckets = new Map<
      string,
      { label: string; thisYear: number | null; lastYear: number | null }
    >();

    for (const record of filtered) {
      if (record.actual === null) continue;
      const year = Number(record.period.slice(0, 4));
      if (year !== thisYear && year !== lastYear) continue;

      const { key, label } = toSeasonBucket(
        Number(record.period.slice(5, 7)),
        periodUnit,
      );
      const entry = buckets.get(key) ?? { label, thisYear: null, lastYear: null };
      const value = measure === "amount" ? record.actual : record.actualQty;
      if (value === null) continue;
      if (year === thisYear) {
        entry.thisYear = (entry.thisYear ?? 0) + value;
      } else {
        entry.lastYear = (entry.lastYear ?? 0) + value;
      }
      buckets.set(key, entry);
    }

    const sorted = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));

    // 증감률은 올해 실적이 들어온 기간끼리만 비교한다.
    let thisYearSum = 0;
    let lastYearSum = 0;
    for (const [, value] of sorted) {
      if (value.thisYear === null) continue;
      thisYearSum += value.thisYear;
      lastYearSum += value.lastYear ?? 0;
    }

    return {
      thisYear,
      lastYear,
      growth:
        lastYearSum > 0
          ? Math.round(((thisYearSum - lastYearSum) / lastYearSum) * 100)
          : null,
      points: sorted.map(([, value]) => ({
        period: value.label,
        actual: value.thisYear === null ? null : value.thisYear * exchange,
        forecast: value.lastYear === null ? null : value.lastYear * exchange,
      })),
    };
  }, [filtered, periodUnit, measure, exchange]);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">
              국가별 대리점 실적 · Forecast 대시보드
            </h1>
            <p className="text-sm text-black/60 dark:text-white/60">
              조건을 고르지 않으면 전체 합계를 보여 줍니다. 금액은
              달러(USD)로 저장됩니다.
            </p>
          </div>
          {session && (
            <p className="text-xs text-black/50 dark:text-white/50">
              {session.email} · {session.role === "admin" ? "관리자" : "일반 사용자"}
            </p>
          )}
        </div>

        {/* 왼쪽: 금액/수량, 달러/원화 전환 · 오른쪽: 엑셀 내보내기, 로그아웃, 도움말 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-full border border-black/15 p-1 dark:border-white/20">
              {(["amount", "quantity"] as Measure[]).map((option) => (
                <button
                  key={option}
                  onClick={() => setMeasure(option)}
                  className={`rounded-full px-3 py-1 text-sm ${
                    measure === option
                      ? "bg-indigo-500 text-white"
                      : "text-black/70 dark:text-white/70"
                  }`}
                >
                  {option === "amount" ? "금액" : "수량"}
                </button>
              ))}
            </div>
            <div className="flex gap-1 rounded-full border border-black/15 p-1 dark:border-white/20">
              {(["USD", "KRW"] as Currency[]).map((option) => (
                <button
                  key={option}
                  onClick={() => changeCurrency(option)}
                  disabled={measure === "quantity"}
                  className={`rounded-full px-3 py-1 text-sm disabled:opacity-40 ${
                    currency === option
                      ? "bg-indigo-500 text-white"
                      : "text-black/70 dark:text-white/70"
                  }`}
                >
                  {option === "USD" ? "달러 ($)" : "원화 (₩)"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={exportCsv}
              className="rounded-full border border-black/15 px-3 py-1 text-sm text-black/70 hover:bg-black/5 dark:border-white/20 dark:text-white/70 dark:hover:bg-white/10"
              title="지금 고른 조건의 데이터를 CSV(엑셀에서 바로 열림)로 내려받습니다"
            >
              엑셀로 내보내기
            </button>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-full border border-black/15 px-3 py-1 text-sm text-black/70 hover:bg-black/5 dark:border-white/20 dark:text-white/70 dark:hover:bg-white/10"
              >
                로그아웃
              </button>
            </form>
            <div className="relative">
              <button
                onClick={() => setShowHelp((v) => !v)}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-black/15 text-sm font-semibold text-black/70 hover:bg-black/5 dark:border-white/20 dark:text-white/70 dark:hover:bg-white/10"
                aria-label="도움말"
              >
                ?
              </button>
              {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
            </div>
          </div>
        </div>

        {currency === "KRW" && rate && (
          <p className="text-right text-xs text-black/50 dark:text-white/50">
            적용 환율 {rate.rate.toLocaleString()}원 · {rate.date} 서울외국환중개
            매매기준율
          </p>
        )}
        {rateError && (
          <p className="text-right text-xs text-red-500">{rateError}</p>
        )}
      </header>

      {/* 입력과 조회를 모두 챗봇으로 처리하므로 화면 맨 위에 둔다. */}
      <Chatbot onSaved={reloadRecords} onSearch={applySearch} />

      <PoUpload onSaved={reloadRecords} />


      {/* 팀 → 국가 → 거래처 → 장비 → 품목 순서로 한 줄씩 쌓아서 보여 준다. */}
      <section className="divide-y divide-black/10 overflow-hidden rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/15">
        {restrictedTeam ? (
          <div className="flex items-center gap-4 px-4 py-2.5 text-sm">
            <div className="w-14 shrink-0 text-xs font-medium text-black/50 dark:text-white/50">
              영업팀
            </div>
            <span className="rounded-full bg-indigo-500 px-2.5 py-1 text-[13px] text-white">
              {restrictedTeam}
            </span>
            <span className="text-xs text-black/40 dark:text-white/40">
              이 계정은 소속 팀 데이터만 볼 수 있습니다
            </span>
          </div>
        ) : (
          <FilterRow
            label="영업팀"
            options={teams}
            selected={selectedTeams}
            onToggle={(next) => {
              setSelectedTeams(next);
              // 상위 조건이 바뀌면 하위 선택은 초기화한다.
              setSelectedCountries([]);
              setSelectedClients([]);
              setSelectedEquipments([]);
            }}
          />
        )}
        <FilterRow
          label="국가"
          options={countries}
          selected={selectedCountries}
          onToggle={(next) => {
            setSelectedCountries(next);
            setSelectedClients([]);
            setSelectedEquipments([]);
          }}
        />
        <FilterRow
          label="거래처"
          options={clients}
          selected={selectedClients}
          onToggle={(next) => {
            setSelectedClients(next);
            setSelectedEquipments([]);
          }}
        />
        <FilterRow
          label="장비"
          options={equipments}
          selected={selectedEquipments}
          onToggle={(next) => {
            setSelectedEquipments(next);
            // 장비가 바뀌면 그 장비의 품목만 남으므로 품목 선택은 초기화한다.
            setSelectedItems([]);
          }}
        />
        <FilterRow
          label="품목"
          options={items}
          selected={selectedItems}
          onToggle={setSelectedItems}
          subLabels={itemPrices}
        />
        <FilterRow
          label="기간"
          options={PERIOD_UNITS.map((unit) => unit.label)}
          selected={[
            PERIOD_UNITS.find((unit) => unit.value === periodUnit)!.label,
          ]}
          onToggle={(next) => {
            const picked = PERIOD_UNITS.find((unit) => unit.label === next[0]);
            if (picked) setPeriodUnit(picked.value);
          }}
          singleSelect
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label={`실적 합계${totalsPeriod ? ` · ${totalsPeriod}` : ""}`}
          value={formatFull(totals.actual * amountExchange, currency)}
          sub={`${formatQuantity(totals.actualQty)}개`}
        />
        <SummaryCard
          label={`forecast 합계${totalsPeriod ? ` · ${totalsPeriod}` : ""}`}
          value={formatFull(totals.forecast * amountExchange, currency)}
          sub={`${formatQuantity(totals.forecastQty)}개`}
        />
        <SummaryCard
          label={`달성률${totalsPeriod ? ` · ${totalsPeriod}` : ""}`}
          value={`${achievement}%`}
        />
        <SummaryCard
          label="전년 동기 대비"
          value={
            comparison?.growth === null || comparison === null
              ? "-"
              : `${comparison.growth > 0 ? "+" : ""}${comparison.growth}%`
          }
          sub={measure === "amount" ? "금액 기준" : "수량 기준"}
        />
      </section>

      {/* 두 그래프는 붙여서 나란히 보여 준다. */}
      <div className="space-y-4">
        <section className="space-y-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-medium">기간별 추이</h2>
            <span className="text-xs text-black/50 dark:text-white/50">
              최근 12개 기간
            </span>
          </div>
          <Chart
            points={points}
            formatValue={formatPoint}
            unit={chartUnit}
            showAchievement
          />
        </section>

        <section className="space-y-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-medium">전년 동기 대비</h2>
            <span className="text-xs text-black/50 dark:text-white/50">
              같은 기간의 실적만 비교합니다
            </span>
          </div>
          {comparison ? (
            <Chart
              points={comparison.points}
              formatValue={formatPoint}
              unit={chartUnit}
              labels={{
                actual: `${comparison.thisYear}년 실적`,
                forecast: `${comparison.lastYear}년 실적`,
              }}
              showGrowth
            />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-black/15 text-sm text-black/60 dark:border-white/20 dark:text-white/60">
              {periodUnit === "year"
                ? "연도별 보기에서는 위 그래프가 이미 연도 간 비교입니다. 월·분기·반기로 바꿔 주세요."
                : "비교할 작년 데이터가 없습니다."}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

// 전년 동기 비교를 위해 연도를 뺀 기간 키(1월, 1분기, 상반기 …)를 만든다.
function toSeasonBucket(month: number, unit: PeriodUnit) {
  if (unit === "half") {
    const half = month <= 6 ? 1 : 2;
    return {
      key: `H${half}`,
      label: half === 1 ? "상반기" : "하반기",
    };
  }
  if (unit === "quarter") {
    const quarter = Math.ceil(month / 3);
    return { key: `Q${quarter}`, label: `${quarter}분기` };
  }
  return { key: String(month).padStart(2, "0"), label: `${month}월` };
}

// 중복을 없애고 이름 순으로 정렬한다.
function unique(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

// 선택한 조건에 해당하는 데이터만 골라 낸다. 고르지 않은 조건은 전체로 본다.
function scope(
  records: Record[],
  filters: {
    selectedTeams?: string[];
    selectedCountries?: string[];
    selectedClients?: string[];
    selectedEquipments?: string[];
    selectedItems?: string[];
  },
) {
  const match = (selected: string[] | undefined, value: string) =>
    !selected || selected.length === 0 || selected.includes(value);

  return records.filter(
    (record) =>
      match(filters.selectedTeams, record.team) &&
      match(filters.selectedCountries, record.country) &&
      match(filters.selectedClients, record.client) &&
      match(filters.selectedEquipments, record.equipment) &&
      match(filters.selectedItems, record.item),
  );
}

// YYYY-MM 형식의 기간을 선택한 단위로 묶기 위한 키와 표시 이름을 만든다.
function toBucket(period: string, unit: PeriodUnit) {
  const [year, month] = period.split("-");
  const monthNumber = Number(month);

  if (unit === "year") {
    return { key: year, label: `${year}년` };
  }
  if (unit === "half") {
    const half = monthNumber <= 6 ? 1 : 2;
    return {
      key: `${year}-H${half}`,
      label: `${year} ${half === 1 ? "상반기" : "하반기"}`,
    };
  }
  if (unit === "quarter") {
    const quarter = Math.ceil(monthNumber / 3);
    return { key: `${year}-Q${quarter}`, label: `${year} ${quarter}분기` };
  }
  return { key: period, label: period };
}

// 요약 카드에 붙일 기간 표기. toBucket 이 만든 key 를 사람이 읽는 말로 바꾼다.
// (2026 → 2026년, 2026-H2 → 2026년 하반기, 2026-Q3 → 2026년 3분기, 2026-08 → 2026년 8월)
function toPeriodCaption(key: string) {
  const year = key.slice(0, 4);
  const rest = key.slice(5);
  if (!rest) return `${year}년`;
  if (rest.startsWith("H")) {
    return `${year}년 ${rest === "H1" ? "상반기" : "하반기"}`;
  }
  if (rest.startsWith("Q")) return `${year}년 ${rest.slice(1)}분기`;
  return `${year}년 ${Number(rest)}월`;
}

// 요약 카드처럼 넓은 곳에서 쓰는 표기.
// 원화는 자릿수가 너무 길어지므로 항상 억 단위로 통일한다.
function formatFull(value: number, currency: Currency) {
  if (currency === "USD") return `$${Math.round(value).toLocaleString()}`;
  return `₩${(value / 100_000_000).toFixed(1)}억`;
}

// 그래프 안에서는 기호 없이 숫자만 짧게 보여 준다. (예: 1.2M, 62.9)
function formatCompact(value: number, currency: Currency) {
  if (currency === "USD") {
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  }
  return (value / 100_000_000).toFixed(1);
}

// 수량은 통화 기호 없이 개수만 보여 준다.
function formatQuantity(value: number) {
  return Math.round(value).toLocaleString();
}

// 그래프에서는 수량이 길어지면 글자가 겹치므로 만 단위부터 줄여서 표기한다.
function formatQuantityCompact(value: number) {
  if (value < 10000) return Math.round(value).toLocaleString();
  return new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

// 조건 한 가지를 한 줄로 보여 준다. (왼쪽 이름 + 오른쪽 선택 버튼)
function FilterRow({
  label,
  options,
  selected,
  onToggle,
  singleSelect = false,
  subLabels,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (next: string[]) => void;
  singleSelect?: boolean;
  // 옵션 이름 옆에 작게 붙일 참고 정보 (예: 품목명 → "$40")
  subLabels?: { [option: string]: string };
}) {
  // 국가·거래처처럼 항목이 많으면 접어 두고 필요할 때 펼친다.
  const [showAll, setShowAll] = useState(false);
  const LIMIT = 14;
  const visible =
    showAll || options.length <= LIMIT
      ? options
      : options.filter(
          (option, index) => index < LIMIT || selected.includes(option),
        );
  const hiddenCount = options.length - visible.length;

  return (
    <div className="flex items-start gap-4 px-4 py-2.5">
      <div className="mt-1 w-14 shrink-0 text-xs font-medium text-black/50 dark:text-white/50">
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {!singleSelect && (
          <Chip active={selected.length === 0} onClick={() => onToggle([])}>
            전체
          </Chip>
        )}
        {visible.map((option) => {
          const active = selected.includes(option);
          return (
            <Chip
              key={option}
              active={active}
              onClick={() =>
                onToggle(
                  singleSelect
                    ? [option]
                    : active
                      ? selected.filter((item) => item !== option)
                      : [...selected, option],
                )
              }
            >
              {option}
              {subLabels?.[option] && (
                <span className="ml-1 opacity-60">{subLabels[option]}</span>
              )}
            </Chip>
          );
        })}
        {hiddenCount > 0 && (
          <button
            onClick={() => setShowAll(true)}
            className="rounded-full px-2.5 py-1 text-[13px] text-indigo-500 hover:underline"
          >
            +{hiddenCount}개 더
          </button>
        )}
        {showAll && options.length > LIMIT && (
          <button
            onClick={() => setShowAll(false)}
            className="rounded-full px-2.5 py-1 text-[13px] text-black/50 hover:underline dark:text-white/50"
          >
            접기
          </button>
        )}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[13px] transition ${
        active
          ? "bg-indigo-500 text-white"
          : "bg-black/5 text-black/70 hover:bg-black/10 dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/15"
      }`}
    >
      {children}
    </button>
  );
}

// 우측 상단 "?" 버튼을 누르면 뜨는 간단한 사용법 안내.
function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <>
      {/* 패널 바깥을 클릭하면 닫히도록 화면 전체를 덮는 투명 레이어 */}
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute right-0 z-20 mt-2 w-80 space-y-3 rounded-lg border border-black/10 bg-white p-4 text-sm shadow-lg dark:border-white/15 dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">사용법</h3>
          <button
            onClick={onClose}
            className="text-black/40 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        <ul className="list-disc space-y-2 pl-4 text-black/70 dark:text-white/70">
          <li>
            <b>필터</b>: 영업팀 → 국가 → 거래처 → 장비 → 품목 순서로 좁혀집니다.
            여러 개를 동시에 선택할 수 있고, 아무것도 안 고르면 전체입니다.
          </li>
          <li>
            <b>챗봇 입력</b>: &quot;AMJAD 2026년 8월 Density 실적 250000&quot;
            처럼 말하면 데이터가 저장됩니다.
          </li>
          <li>
            <b>챗봇 조회</b>: &quot;EU팀 분기별로 보여줘&quot;, &quot;대만
            Density 수량&quot; 처럼 말하면 화면 조건이 그대로 바뀝니다.
          </li>
          <li>
            <b>금액/수량, 달러/원화</b>: 우측 상단 버튼으로 바로 전환됩니다.
          </li>
          <li>
            <b>달성률</b>: 그래프 아래 %가 실적/forecast 비율이며, 색으로 100%
            이상(초록)·70~99%(노랑)·70% 미만(빨강)을 구분합니다.
          </li>
          <li>
            <b>엑셀로 내보내기</b>: 지금 고른 조건의 원본 데이터를 CSV 파일로
            받아 엑셀에서 열어 검증할 수 있습니다.
          </li>
          <li>
            <b>로그아웃</b>: 우측 상단 버튼으로 로그아웃하면 로그인 화면으로
            돌아갑니다.
          </li>
        </ul>
      </div>
    </>
  );
}

function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/15">
      <div className="text-xs text-black/60 dark:text-white/60">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {sub && (
        <div className="text-xs tabular-nums text-black/50 dark:text-white/50">
          {sub}
        </div>
      )}
    </div>
  );
}
