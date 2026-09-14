"use client";

// Pre-visualizacao em balao de WhatsApp (brief da Tela 7): o texto exatamente
// como o paciente vai ler, com os botoes renderizados quando a regua os tem.
// Puro visual: quem renderiza as {{variaveis}} e o chamador, com
// renderizarModelo e os MESMOS valores de amostra do editor.

export function BalaoWhatsApp({
  corpo,
  botoes,
}: {
  corpo: string;
  botoes?: string[];
}) {
  return (
    <div
      className="rounded-lg p-3"
      style={{ background: "var(--surface-3)" }}
      aria-label="Pré-visualização da mensagem"
    >
      <div className="max-w-xs rounded-lg rounded-tl-sm border bg-card p-3 shadow-sm">
        <p className="text-[13px] whitespace-pre-line">
          {corpo || "A mensagem aparece aqui enquanto você escreve."}
        </p>
        {botoes && botoes.length > 0 ? (
          <div className="mt-2 grid gap-1 border-t pt-2">
            {botoes.map((botao) => (
              <span
                key={botao}
                className="rounded-md border py-1.5 text-center text-[12.5px] font-medium text-primary"
              >
                {botao}
              </span>
            ))}
          </div>
        ) : null}
        <p className="mt-1 text-right text-[10px] text-text-tertiary">14:00</p>
      </div>
    </div>
  );
}
