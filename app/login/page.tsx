import Link from "next/link";
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">로그인</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          국가별 대리점 실적 · Forecast 대시보드
        </p>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
          {error}
        </p>
      )}

      <form action={login} className="space-y-3">
        <input
          type="email"
          name="email"
          placeholder="이메일"
          required
          className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-white/20"
        />
        <input
          type="password"
          name="password"
          placeholder="비밀번호"
          required
          className="w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-white/20"
        />
        <button
          type="submit"
          className="w-full rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white"
        >
          로그인
        </button>
      </form>

      <p className="text-center text-sm text-black/60 dark:text-white/60">
        계정이 없으신가요?{" "}
        <Link href="/signup" className="text-indigo-500 hover:underline">
          회원가입
        </Link>
      </p>
    </main>
  );
}
