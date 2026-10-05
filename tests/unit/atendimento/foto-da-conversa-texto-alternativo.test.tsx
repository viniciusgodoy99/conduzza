import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FotoDaConversa } from "@/components/atendimento/media/foto-da-conversa";

// Texto alternativo da foto sem legenda: antes toda foto era "enviada pelo
// paciente", inclusive a que a clinica mandou (pelo sistema ou direto pelo
// WhatsApp). Com legenda, a legenda vale para os dois lados.

describe("FotoDaConversa, texto alternativo", () => {
  it("foto do paciente sem legenda", () => {
    const html = renderToStaticMarkup(
      <FotoDaConversa messageId="m1" legenda={null} />,
    );
    expect(html).toContain('alt="Foto enviada pelo paciente"');
  });

  it("foto da clinica sem legenda", () => {
    const html = renderToStaticMarkup(
      <FotoDaConversa messageId="m1" legenda={null} daClinica />,
    );
    expect(html).toContain('alt="Foto enviada pela clínica"');
    expect(html).not.toContain("pelo paciente");
  });

  it("com legenda, a legenda e o texto alternativo", () => {
    const html = renderToStaticMarkup(
      <FotoDaConversa messageId="m1" legenda="Receita" daClinica />,
    );
    expect(html).toContain('alt="Receita"');
  });
});
