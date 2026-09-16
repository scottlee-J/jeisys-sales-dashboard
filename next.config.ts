import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse 는 Node 전용 기능을 써서 Next.js 번들에 넣으면 동작하지 않는다.
  // 서버에서 native require 로 쓰도록 번들링에서 제외한다.
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
