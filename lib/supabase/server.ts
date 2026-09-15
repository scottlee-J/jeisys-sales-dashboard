import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// 서버 컴포넌트·서버 액션·route handler에서 쓰는 Supabase 클라이언트.
// 서버 컴포넌트는 쿠키를 직접 쓸 수 없어서, 실패해도 무시한다
// (세션 갱신은 middleware.ts 가 담당한다).
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // 서버 컴포넌트에서 호출되면 쿠키를 못 쓰는데, middleware 가 갱신을 대신 해주므로 무시한다.
          }
        },
      },
    },
  );
}
