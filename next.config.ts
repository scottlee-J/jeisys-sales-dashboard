import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse 는 Node 전용 기능을 써서 Next.js 번들에 넣으면 동작하지 않는다.
  // 서버에서 native require 로 쓰도록 번들링에서 제외한다.
  // @napi-rs/canvas 는 pdf-parse(pdfjs-dist)가 DOMMatrix 를 채울 때 쓰는 네이티브
  // 모듈이라, 이것도 번들에서 빼고 파일만 그대로 올려야 한다.
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  // Vercel 빌드는 필요한 파일만 골라서 올리는데, pdfjs-dist 는 @napi-rs/canvas 와
  // pdf.worker.mjs 를 실행 중에 동적으로 불러서 이 파일들이 빠진다.
  // PO 업로드 함수에는 강제로 포함시킨다.
  outputFileTracingIncludes: {
    "/api/po": [
      "./node_modules/@napi-rs/canvas*/**",
      "./node_modules/pdfjs-dist/legacy/build/**",
    ],
  },
};

export default nextConfig;
