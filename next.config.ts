import type { NextConfig } from "next";

// O servidor de desenvolvimento e o build de producao gravam na MESMA pasta
// (.next) por padrao, entao rodar "npm run build" com o "npm run dev" no ar
// apaga os manifestos do dev e a tela cai com erro 500. NEXT_DIST_DIR deixa o
// dev usar pasta propria: o script "dev" ja passa .next-dev.
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
