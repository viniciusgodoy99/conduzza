import { describe, expect, it } from "vitest";

import {
  classificarFalhaDeUpload,
  estadoDaMidia,
  exibicaoDaMidiaDeTexto,
  extensaoDoMimetype,
  JANELA_DE_DOWNLOAD_MS,
  marcaDeIndisponivel,
  motivoDaDesistencia,
  nomeOriginalDoArquivo,
  nomeParaBaixar,
  nomeSeguroDeArquivo,
  normalizarMimetype,
} from "@/lib/domain/midia-recebida";

// Cada bloco trava um defeito real da revisao de liberacao (24/09/2026):
// midia eterna em "Baixando o arquivo", erro do Storage descartado, figurinha
// como video quebrado e documento baixando sempre como .pdf.

const CRIADA = "2026-09-24T12:00:00Z";
const CRIADA_MS = new Date(CRIADA).getTime();

describe("estadoDaMidia: baixando, pronta ou indisponivel", () => {
  it("storage:// e pronta, seed:// e demonstracao", () => {
    expect(
      estadoDaMidia("storage://midia-conversas/c/m", CRIADA, CRIADA_MS),
    ).toEqual({ tipo: "pronta" });
    expect(estadoDaMidia("seed://foto", CRIADA, CRIADA_MS)).toEqual({
      tipo: "demonstracao",
    });
  });

  it("URL do provedor recente continua baixando, com hora para vencer", () => {
    const estado = estadoDaMidia(
      "https://mmg.whatsapp.net/x.enc",
      CRIADA,
      CRIADA_MS + 60_000,
    );
    expect(estado).toEqual({
      tipo: "baixando",
      venceEm: CRIADA_MS + JANELA_DE_DOWNLOAD_MS,
    });
  });

  it("sem arquivo depois de 15 minutos vira indisponivel, mesmo sem job", () => {
    // As 16 fotos que chegaram sem URL nunca tiveram job: so o tempo diz.
    expect(
      estadoDaMidia(null, CRIADA, CRIADA_MS + JANELA_DE_DOWNLOAD_MS),
    ).toEqual({ tipo: "indisponivel", motivo: null });
    expect(
      estadoDaMidia("https://x/y.enc", CRIADA, CRIADA_MS + 16 * 60_000),
    ).toEqual({ tipo: "indisponivel", motivo: null });
  });

  it("a sentinela e estado final, qualquer que seja a idade", () => {
    expect(
      estadoDaMidia(marcaDeIndisponivel("storage_falhou"), CRIADA, CRIADA_MS),
    ).toEqual({ tipo: "indisponivel", motivo: "storage_falhou" });
    expect(
      estadoDaMidia(marcaDeIndisponivel("grande_demais"), CRIADA, CRIADA_MS),
    ).toEqual({ tipo: "indisponivel", motivo: "grande_demais" });
    expect(
      estadoDaMidia("indisponivel://outra_coisa", CRIADA, CRIADA_MS),
    ).toEqual({ tipo: "indisponivel", motivo: null });
  });
});

describe("motivoDaDesistencia le o mesmo codigo do last_error", () => {
  it("tamanho tem motivo proprio, venha do download ou do Storage", () => {
    expect(motivoDaDesistencia("download:uazapi_download_413")).toBe(
      "grande_demais",
    );
    expect(motivoDaDesistencia("storage_falhou:413")).toBe("grande_demais");
    expect(motivoDaDesistencia("storage_falhou:400:EntityTooLarge")).toBe(
      "grande_demais",
    );
  });

  it("o resto cai no motivo da etapa que falhou", () => {
    expect(motivoDaDesistencia("storage_falhou:500")).toBe("storage_falhou");
    expect(motivoDaDesistencia("storage_falhou")).toBe("storage_falhou");
    expect(motivoDaDesistencia("storage_falhou:4130")).toBe("storage_falhou");
    expect(motivoDaDesistencia("download:download_indisponivel")).toBe(
      "download_falhou",
    );
    expect(motivoDaDesistencia("excecao_no_worker")).toBe("desistiu");
  });
});

describe("classificarFalhaDeUpload: codigo real, nunca a mensagem", () => {
  it("usa o status do corpo antes do HTTP (o Storage responde 400 com 413 no corpo)", () => {
    expect(
      classificarFalhaDeUpload({
        status: 400,
        statusCode: "413",
        message: "The object exceeded the maximum allowed size",
      }),
    ).toEqual({ erro: "storage_falhou:413", definitivo: true });
  });

  it("guarda o codigo de servico e reconhece o tamanho por ele", () => {
    expect(
      classificarFalhaDeUpload({
        status: 400,
        statusCode: "400",
        code: "EntityTooLarge",
      }),
    ).toEqual({ erro: "storage_falhou:400:EntityTooLarge", definitivo: true });
  });

  it("erro do ambiente (chave, balde) e passageiro continuam repetindo", () => {
    expect(
      classificarFalhaDeUpload({ status: 403, statusCode: "403" }),
    ).toEqual({ erro: "storage_falhou:403", definitivo: false });
    expect(classificarFalhaDeUpload({ status: 500 })).toEqual({
      erro: "storage_falhou:500",
      definitivo: false,
    });
    expect(classificarFalhaDeUpload({ status: 429 }).definitivo).toBe(false);
  });

  it("sem status nenhum (rede) vira x, e codigo esquisito nao entra", () => {
    expect(classificarFalhaDeUpload(new Error("fetch failed"))).toEqual({
      erro: "storage_falhou:x",
      definitivo: false,
    });
    expect(
      classificarFalhaDeUpload({ status: 500, code: "texto com espaço" }).erro,
    ).toBe("storage_falhou:500");
    expect(classificarFalhaDeUpload(null).erro).toBe("storage_falhou:x");
  });

  it("o texto do erro NUNCA vai para o codigo", () => {
    const { erro } = classificarFalhaDeUpload({
      status: 400,
      statusCode: "400",
      message: "exame_de_fulano.pdf invalido",
    });
    expect(erro).not.toContain("fulano");
  });
});

describe("tipo real e extensao", () => {
  it("normaliza parametro e caixa, recusa lixo", () => {
    expect(normalizarMimetype("Audio/OGG; codecs=opus")).toBe("audio/ogg");
    expect(normalizarMimetype("nao e tipo")).toBeNull();
    expect(normalizarMimetype("")).toBeNull();
    expect(normalizarMimetype(null)).toBeNull();
  });

  it("extensao sai de lista fechada; SVG e HTML ficam de fora", () => {
    expect(
      extensaoDoMimetype(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe("xlsx");
    expect(extensaoDoMimetype("application/pdf")).toBe("pdf");
    expect(extensaoDoMimetype("image/svg+xml")).toBeNull();
    expect(extensaoDoMimetype("text/html")).toBeNull();
    expect(extensaoDoMimetype("application/octet-stream")).toBeNull();
  });

  it("figurinha (image/webp) chegando como texto vira foto, nao video", () => {
    expect(exibicaoDaMidiaDeTexto("image/webp")).toBe("foto");
    expect(exibicaoDaMidiaDeTexto("video/mp4")).toBe("video");
    expect(exibicaoDaMidiaDeTexto("audio/ogg")).toBe("audio");
    // Dado antigo, sem tipo guardado: o comportamento de antes.
    expect(exibicaoDaMidiaDeTexto(null)).toBe("video");
  });
});

describe("nome do arquivo baixado", () => {
  it("planilha sem nome baixa com a extensao real, nunca .pdf", () => {
    expect(
      nomeParaBaixar({
        content_type: "documento",
        body: null,
        media_filename: null,
        media_mimetype:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toBe("conduzza-documento.xlsx");
  });

  it("documento de tipo desconhecido baixa sem extensao em vez de mentir", () => {
    expect(nomeParaBaixar({ content_type: "documento", body: null })).toBe(
      "conduzza-documento",
    );
  });

  it("o nome original vem primeiro, sanitizado", () => {
    expect(
      nomeParaBaixar({
        content_type: "documento",
        body: "segue o pedido",
        media_filename: 'pedido/../"exame"?.docx',
        media_mimetype: "application/octet-stream",
      }),
    ).toBe("pedido..exame.docx");
  });

  it("nome original sem extensao ganha a do tipo real", () => {
    expect(
      nomeParaBaixar({
        content_type: "documento",
        body: null,
        media_filename: "Guia do convenio",
        media_mimetype: "application/pdf",
      }),
    ).toBe("Guia do convenio.pdf");
  });

  it("dado antigo: body com extensao ainda serve de nome", () => {
    expect(
      nomeParaBaixar({ content_type: "documento", body: "laudo.pdf" }),
    ).toBe("laudo.pdf");
  });

  it("foto antiga sem tipo continua .jpg; figurinha pelo tipo real", () => {
    expect(nomeParaBaixar({ content_type: "imagem", body: null })).toBe(
      "conduzza-foto.jpg",
    );
    expect(
      nomeParaBaixar({
        content_type: "texto",
        body: null,
        media_mimetype: "image/webp",
      }),
    ).toBe("conduzza-foto.webp");
  });

  it("legenda comum nao vira nome de arquivo", () => {
    expect(
      nomeOriginalDoArquivo({
        content_type: "documento",
        body: "segue o exame",
        media_filename: null,
      }),
    ).toBeNull();
  });

  it("nome enorme e cortado preservando a extensao; vazio vira nulo", () => {
    const nome = nomeSeguroDeArquivo(`${"a".repeat(300)}.pdf`);
    expect(nome?.length).toBeLessThanOrEqual(120);
    expect(nome?.endsWith(".pdf")).toBe(true);
    expect(nomeSeguroDeArquivo('  /\\:*?"<>|  ')).toBeNull();
    expect(nomeSeguroDeArquivo("...")).toBeNull();
  });
});
