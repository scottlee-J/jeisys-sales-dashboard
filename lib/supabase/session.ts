import { createClient } from "./server";

// 로그인한 사용자의 역할/소속 팀. app_metadata 는 사용자가 직접 못 고치고
// 관리자(Admin API)만 설정할 수 있어서, 권한 판단에 안전하게 쓸 수 있다.
export type Session = {
  email: string | null;
  role: "admin" | "user";
  // "user" 역할일 때만 의미 있음. 이 팀 데이터만 볼 수 있다.
  team: string | null;
};

export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data) return null;

  const appMetadata = (data.claims.app_metadata ?? {}) as {
    role?: string;
    team?: string;
  };

  return {
    email: (data.claims.email as string) ?? null,
    role: appMetadata.role === "admin" ? "admin" : "user",
    team: appMetadata.team ?? null,
  };
}

// 일반 사용자(role: "user")는 자기 소속 팀 데이터만 보게 걸러 준다.
// 관리자이거나 팀이 지정 안 된 사용자는 그대로(전체) 돌려준다.
export function scopeByTeam<T extends { team: string }>(
  records: T[],
  session: Session | null,
): T[] {
  if (!session || session.role === "admin" || !session.team) return records;
  return records.filter((record) => record.team === session.team);
}
