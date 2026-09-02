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
  experimental: {
    serverActions: {
      // O padrao e 1 MB, que barra qualquer foto de celular. O arquivo sobe
      // pela Server Action (e nao direto do navegador para o balde) porque
      // assim a permissao, a clinica e o consentimento sao conferidos ANTES
      // de qualquer byte tocar o armazenamento, e o navegador nunca precisa
      // de acesso de escrita ao acervo de midia de paciente.
      //
      // 4 MB e o teto pratico: a plataforma recusa corpo acima de 4,5 MB. A
      // interface reduz foto antes de enviar, entao o limite so aparece em
      // documento grande, e ai a mensagem de erro diz o tamanho.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
