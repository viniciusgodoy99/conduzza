import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DocumentosDoPaciente } from "@/components/pacientes/documentos-do-paciente";

// Os documentos pelo WhatsApp na ficha (decisao do dono de 09/11/2026): o
// link do arquivo pela rota de midia, a data no fuso da clinica, o que ainda
// nao veio e a falha da leitura, cada um com texto (nunca so cor).

const MENSAGEM = "70000000-0000-4000-8000-000000000001";

describe("documentos do paciente na ficha", () => {
  it("o documento enviado tem o link da rota de mídia e a data; o que falta diz que ainda não veio", () => {
    const html = renderToStaticMarkup(
      <DocumentosDoPaciente
        documentos={[
          {
            tipo: "documento_com_foto",
            messageId: MENSAGEM,
            enviadoEm: "2026-11-09T02:30:00.000Z",
          },
        ]}
        timezone="America/Fortaleza"
      />,
    );
    expect(html).toContain("Documentos pelo WhatsApp");
    expect(html).toContain(`href="/api/atendimento/midia/${MENSAGEM}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain("Ver arquivo");
    // 02:30 UTC de 09/11 ainda e 08/11 em Fortaleza.
    expect(html).toContain("08/11/2026");
    expect(html).toContain("Foto da carteirinha");
    expect(html).toContain("Ainda não enviado");
  });

  it("a falha da leitura avisa no bloco, sem derrubar a ficha", () => {
    const html = renderToStaticMarkup(
      <DocumentosDoPaciente documentos={null} timezone="America/Fortaleza" />,
    );
    expect(html).toContain("Não foi possível carregar os documentos.");
    expect(html).not.toContain("Ver arquivo");
  });
});
