import { MonitorSmartphone } from "lucide-react";

// Faixa exibida SO em telas de celular (abaixo de 768px), nas telas de
// operacao que o brief define como "somente leitura no celular" (secao 6):
// Leads, Pacientes, Confirmacoes, Lista de espera e Automacoes. O aviso e a
// camada de comunicacao; o bloqueio real das acoes continua nas Server
// Actions e nos botoes desabilitados de cada tela.
export function AvisoCelular() {
  return (
    <div
      role="note"
      className="bg-surface flex items-center gap-2 rounded-lg border border-border px-3 py-2 md:hidden"
    >
      <MonitorSmartphone
        strokeWidth={1.5}
        className="size-4 shrink-0 text-text-tertiary"
        aria-hidden
      />
      <p className="text-xs text-text-secondary">
        No celular esta tela é somente leitura. Para editar, use um computador
        ou tablet.
      </p>
    </div>
  );
}
