// 실적/예측 데이터 한 건을 나타내는 타입
// 국가 + 기간 + 장비 조합이 데이터의 고유 키 역할을 한다.
// 금액 단위는 모두 달러(USD) 기준으로 저장한다.
export type Record = {
  team: string; // 영업팀 (MEA팀, LATAM팀, APAC 1실, EU팀)
  country: string; // 국가명 (자유 입력)
  client: string; // 거래처(대리점). 거래처마다 취급하는 장비가 다르다.
  period: string; // 기간 (YYYY-MM 형식)
  equipment: string; // 장비 카테고리 (예: Density, Potenza)
  item: string; // 장비 안의 품목 (장비 본체 / 소모품1 / 소모품2 / 소모품3)
  actual: number | null; // 실적 금액 (USD)
  forecast: number | null; // 예측(forecast) 금액 (USD)
  actualQty: number | null; // 실적 수량 (장비는 대, 소모품은 개)
  forecastQty: number | null; // 예측 수량
  standardPrice: number | null; // 참고용 표준 단가(USD). 매출 계산에는 쓰지 않고 화면 표시용
  updatedAt: string; // 마지막 저장 시각
};

// 기간을 묶어서 보는 단위
export type PeriodUnit = "month" | "quarter" | "half" | "year";

// 화면에 표시할 금액 단위
export type Currency = "USD" | "KRW";

// 그래프에 무엇을 그릴지 (금액 기준 / 수량 기준)
export type Measure = "amount" | "quantity";
