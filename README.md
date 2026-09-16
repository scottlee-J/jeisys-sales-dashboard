# 국가별 대리점 실적 · Forecast 대시보드

해외 영업팀이 **국가·거래처(대리점)·장비별 실적과 forecast를 한눈에 보고, 챗봇으로 입력·조회**할 수 있게 만든 대시보드입니다. (PoC 단계)

여러 시트에 흩어져 있던 실적 자료를 한 화면에서 기간별·조건별로 비교할 수 있게 하는 것이 목표입니다.

## 주요 기능

- **조건별 조회** — 영업팀 → 국가 → 거래처 → 장비 → 품목 순으로 좁혀가며 조회. 조건을 고르지 않으면 상위 단위 합계를 보여 줍니다.
- **그래프** — 기간별(연/반기/분기/월) 실적·forecast 추이와 달성률, 전년 동기 대비 비교와 증감률을 수치와 함께 표시합니다.
- **챗봇 입력** — "AMJAD 2026년 8월 Density 실적 250000" 처럼 말하면 데이터가 저장됩니다.
- **챗봇 조회·순위** — "EU팀 분기별로 보여줘", "대만에서 매출이 가장 높은 거래처는?", "3분기 팀별 달성률" 처럼 물으면 화면 조건이 바뀌고, 순위는 서버가 직접 집계해 답합니다.
- **PO(발주서) PDF 업로드** — PDF를 올리면 거래처·품목·수량·단가를 읽어 미리보기로 보여 주고, 확인·수정 후 실적에 반영합니다.
- **엑셀 내보내기** — 지금 고른 조건의 원본 데이터를 CSV로 내려받습니다.
- **로그인 · 권한** — Supabase Auth(이메일/비밀번호). 관리자는 전체 데이터를, 일반 사용자는 본인이 속한 영업팀 데이터만 봅니다(서버에서 걸러서 전달).
- **환율** — 서울외국환중개 매매기준율을 불러와 달러/원화를 전환합니다.

## 기술 스택

| 구분 | 사용 기술 |
| --- | --- |
| 프레임워크 | Next.js (App Router), TypeScript |
| 스타일 | Tailwind CSS |
| 인증 | Supabase Auth (`@supabase/ssr`) |
| 데이터베이스 | Supabase Postgres |
| 챗봇 AI | OpenAI API |
| PDF 인식 | pdf-parse |
| 배포 | Vercel |

그래프는 외부 차트 라이브러리 없이 SVG로 직접 그렸습니다.

## 실행 방법

```bash
npm install
npm run dev
```

`http://localhost:3000` 에서 확인할 수 있습니다.

## 환경 변수

`.env` 파일에 아래 값이 필요합니다. (이 파일은 저장소에 올라가지 않습니다)

| 이름 | 설명 |
| --- | --- |
| `OPENAI_API_KEY` | 챗봇·PO 인식용 OpenAI API 키 |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase 공개용 키 |

## 폴더 구조

```
app/
  api/        조회·저장, 챗봇, PO 인식, 환율 API
  components/ 대시보드, 그래프, 챗봇, PO 업로드 화면
  login/ signup/ logout/   인증 화면과 서버 액션
lib/
  store.ts    데이터 읽기·저장 (지금은 JSON 파일)
  supabase/   인증 클라이언트와 세션·권한 처리
data/
  records.json  실적·forecast 초기 데이터 (Supabase 로 옮기기 전 원본)
  dealers.json  거래처 마스터 목록
```

## 참고

- 실적 데이터는 Supabase Postgres(`public.records`)에 저장합니다. 저장 방식을 바꿀 때 고쳐야 할 곳은 `lib/store.ts` 한 곳입니다.
- 자세한 기획 내용은 [PRD.md](PRD.md), 개발 규칙은 [CLAUDE.md](CLAUDE.md)를 참고하세요.
