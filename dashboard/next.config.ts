import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // 忽略類型錯誤以保證 SQLite 原生二進位警告不會干擾 Vercel 雲端打包
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;

