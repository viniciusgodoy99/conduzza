import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STATUS_TONE_VARS } from "@/lib/design/status";
import {
  grafiaDaEtiqueta,
  type LeituraDasEtiquetas,
  type OpcaoDeEtiqueta,
} from "@/lib/domain/etiquetas-do-lead";

// Conteudo do popover "Etiquetar lead" da barra de acoes em massa (relato do
// dono em 20/10/2026: "nao ta adicionando nem aparecendo as que ja
// existem"). Sem hook: a barra guarda o estado, e os testes chamam a funcao
// e acham o onClick na arvore (o projeto nao tem jsdom).
//
// 1. Etiqueta nova, por texto. Se a clinica ja tem a mesma etiqueta com
//    outra grafia (maiuscula ou acento), entra a grafia dela, e o campo
//    avisa antes: "lead" entra como "LEAD", nunca as duas.
// 2. "Etiquetas da clínica": as cadastradas em Configuracoes, com o tom
//    delas, e as que ja estao em uso nos leads, sem repetir
//    (opcoesDeEtiqueta). Um toque adiciona aos selecionados. Sem a leitura
//    das cadastradas (carregando ou erro), ficam so as em uso, com o aviso.
// 3. As etiquetas dos selecionados, com o X para remover, como antes.
//
// O MESMO painel abre para UM lead, no "+" da linha da lista e da gaveta
// (pedido do dono em 20/10/2026: "nao consigo ... adicionar uma etiqueta
// por aqui"), com alvo "lead": os textos falam deste lead e as etiquetas que
// ele ja tem saem da lista de adicionar (ficam embaixo, com o X). A grafia
// existente continua valendo, porque ela olha todas as opcoes.

// Linha clicavel na casca do item de menu do DS, a mesma dos outros
// popovers da barra (Reatribuir, Mudar etapa): 40px de alvo.
const LINHA_DA_ETIQUETA =
  "flex min-h-10 w-full items-center gap-[9px] rounded-sm px-[9px] text-left text-[13px] font-medium text-foreground outline-none cz-transition hover:bg-accent hover:text-text-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-45";

export function PainelEtiquetarLead({
  novaEtiqueta,
  aoDigitar,
  opcoes,
  leitura,
  aoTentarDeNovo,
  etiquetasDosSelecionados,
  ocupado,
  aoAdicionar,
  aoRemover,
  alvo = "selecionados",
}: {
  novaEtiqueta: string;
  aoDigitar: (texto: string) => void;
  /** As cadastradas e as em uso, sem repetir (opcoesDeEtiqueta) */
  opcoes: readonly OpcaoDeEtiqueta[];
  /** Leitura das cadastradas; carregando ou erro, as opcoes sao as em uso */
  leitura: LeituraDasEtiquetas;
  aoTentarDeNovo?: () => void;
  /** Uniao das etiquetas dos selecionados (ou as do lead), para remover */
  etiquetasDosSelecionados: readonly string[];
  ocupado: boolean;
  /** Recebe a grafia que vai para o lead */
  aoAdicionar: (nome: string) => void;
  aoRemover: (nome: string) => void;
  /** A selecao da barra em massa (o padrao) ou um lead so */
  alvo?: "selecionados" | "lead";
}) {
  const digitada = novaEtiqueta.replace(/\s+/g, " ").trim();
  const grafia = grafiaDaEtiqueta(novaEtiqueta, opcoes);
  const outraGrafia = digitada.length > 0 && grafia !== digitada;
  const umLead = alvo === "lead";
  // Para um lead, o que ele ja tem nao se oferece de novo (a mesma grafia;
  // outra grafia continua, para trocar "lead" por "LEAD").
  const oferecidas = umLead
    ? opcoes.filter((opcao) => !etiquetasDosSelecionados.includes(opcao.nome))
    : opcoes;

  return (
    <div className="grid gap-3 p-[5px]">
      <p className="text-[11px] leading-[1.4] text-text-secondary">
        Estas etiquetas ficam no lead e não mudam as etiquetas da conversa no
        Atendimento.
      </p>

      <div className="grid">
        <div className="flex gap-1.5">
          <Input
            value={novaEtiqueta}
            onChange={(e) => aoDigitar(e.target.value)}
            placeholder="Nova etiqueta do lead"
            maxLength={40}
            aria-label="Nova etiqueta"
          />
          <Button
            variant="solid"
            disabled={ocupado || digitada.length === 0}
            onClick={() => aoAdicionar(grafia)}
          >
            Adicionar
          </Button>
        </div>
        {/* Regiao viva sempre montada (o leitor de tela so anuncia mudanca
            em regiao que ja existia); vazia, nao ocupa espaco. */}
        <p
          aria-live="polite"
          className="mt-1.5 text-[11px] leading-[1.4] text-text-secondary empty:mt-0"
        >
          {outraGrafia ? (
            <>
              Esta etiqueta já existe como{" "}
              <span className="font-semibold text-text-strong">{grafia}</span> e
              entra com essa grafia.
            </>
          ) : null}
        </p>
      </div>

      <div className="grid gap-1.5">
        <p className="text-xs font-semibold text-text-strong">
          Etiquetas da clínica
        </p>
        {leitura === "carregando" ? (
          <p role="status" className="text-xs text-text-secondary">
            Carregando as etiquetas cadastradas.
          </p>
        ) : null}
        {leitura === "erro" ? (
          <div className="grid justify-items-start gap-1.5">
            <p className="text-xs leading-[1.4] text-text-secondary">
              Não foi possível carregar as etiquetas cadastradas em
              Configurações. Aparecem só as que já estão nos leads.
            </p>
            {aoTentarDeNovo ? (
              <Button
                variant="outline"
                size="sm"
                disabled={ocupado}
                onClick={aoTentarDeNovo}
              >
                Tentar de novo
              </Button>
            ) : null}
          </div>
        ) : null}
        {oferecidas.length > 0 ? (
          <div className="-mx-[5px] grid cz-scroll max-h-48 overflow-y-auto">
            {oferecidas.map((opcao) => (
              <button
                key={opcao.nome}
                type="button"
                disabled={ocupado}
                onClick={() => aoAdicionar(opcao.nome)}
                aria-label={`Adicionar etiqueta ${opcao.nome}`}
                className={LINHA_DA_ETIQUETA}
              >
                <Plus
                  className="size-[15px] shrink-0 text-text-secondary"
                  aria-hidden
                />
                <span
                  aria-hidden
                  className="size-[7px] shrink-0 rounded-[2px]"
                  style={{
                    backgroundColor: STATUS_TONE_VARS[opcao.tom].marker,
                  }}
                />
                <span className="min-w-0 truncate">{opcao.nome}</span>
              </button>
            ))}
          </div>
        ) : leitura === "pronto" ? (
          <p className="text-xs leading-[1.4] text-text-secondary">
            {opcoes.length > 0
              ? "Este lead já tem todas as etiquetas da clínica. Escreva uma acima para criar outra."
              : "A clínica ainda não tem etiquetas. Escreva uma acima para criar a primeira."}
          </p>
        ) : null}
      </div>

      {etiquetasDosSelecionados.length > 0 ? (
        <div className="grid gap-1.5">
          <p className="text-xs text-text-secondary">
            {umLead
              ? "Etiquetas deste lead (toque no X para remover)"
              : "Etiquetas do lead nos selecionados (toque no X para remover)"}
          </p>
          <div className="flex cz-scroll max-h-28 flex-wrap gap-2 overflow-y-auto">
            {etiquetasDosSelecionados.map((etiqueta) => (
              <span
                key={etiqueta}
                className="inline-flex h-7 max-w-full items-center gap-1 rounded-sm border border-input bg-card pr-1 pl-2.5 text-xs font-medium text-foreground"
              >
                <span className="truncate">{etiqueta}</span>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => aoRemover(etiqueta)}
                  aria-label={`Remover etiqueta ${etiqueta}`}
                  className="hit-40 relative grid size-5 shrink-0 place-items-center rounded-[4px] text-text-secondary cz-transition hover:bg-surface-3 hover:text-text-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus focus-visible:outline-solid disabled:pointer-events-none disabled:opacity-45"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-text-secondary">
          {umLead
            ? "Este lead ainda não tem etiquetas."
            : "Os leads selecionados ainda não têm etiquetas."}
        </p>
      )}
    </div>
  );
}
