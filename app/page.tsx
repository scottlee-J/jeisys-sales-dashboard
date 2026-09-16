import Dashboard from "./components/Dashboard";
import { readDealers, readRecords } from "@/lib/store";
import { getSession, scopeByTeam } from "@/lib/supabase/session";

// 첫 화면은 서버에서 데이터를 읽어 바로 그려 준다.
export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  const records = scopeByTeam(await readRecords(), session);
  const dealers = scopeByTeam(await readDealers(), session);
  return (
    <Dashboard
      initialRecords={records}
      initialDealers={dealers}
      session={session}
    />
  );
}
