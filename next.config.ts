import type { NextConfig } from "next";

// O servidor de desenvolvimento e o build de producao gravam na MESMA pasta
// (.next) por padrao, entao rodar "npm run build" com o "npm run dev" no ar
// apaga os manifestos do dev e a tela cai com erro 500. NEXT_DIST_DIR deixa o
// dev usar pasta propria: o script "dev" ja passa .next-dev.
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Nao anunciar a plataforma e a versao para o mundo: e informacao que so
  // serve para quem procura alvo com falha conhecida.
  poweredByHeader: false,
};

export default nextConfig;
