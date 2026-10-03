"use client";

import { useId } from "react";

import { ChipSituacao } from "@/components/cadastros/comum";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

// Lista de marcar convenios dos modais de Cadastros (convenio pelo medico,
// decisao do dono em 02/10/2026): "Convenios que atende" no Profissional e
// "Convenios que cobrem este procedimento" no Procedimento. Especifica e sem
// busca (2 usos; a producao tem 1 convenio por clinica), na receita da lista
// do bloqueio de horario (components/agenda/bloquear-horario-dialog.tsx):
// fieldset com legend, caixa com borda e linhas de 40px (label min-h-10).
//
// - Inativo: aparece so quando quem chama o oferece (marcado ou gravado na
//   abertura), sempre no fim e com ChipSituacao, para poder sair. Nunca so cor.
// - Nota por opcao (ex.: a da auto cura), ligada a caixa por aria-describedby.
// - Quem nao edita ve a lista desabilitada com a dica do papel, no padrao de
//   BotaoProtegido (visivel, desabilitada, com o porque).
// - legendaOculta: a legenda fica so para o leitor de tela, quando quem chama
//   ja mostra o mesmo rotulo (o "Ver detalhes" do Profissional, dentro da
//   lista de rotulo e valor). O grupo continua com o nome acessivel.

export type OpcaoDaListaDeConvenios = {
  id: string;
  nome: string;
  /** insurance.plan_name, depois do nome ("Unimed · Nacional") */
  plano?: string | null;
  inativo: boolean;
  /** Texto curto embaixo da opcao */
  nota?: string;
};

/** Dica de reserva quando quem chama nao passa a do papel */
const DICA_PADRAO = "Somente administradores e gestores alteram os cadastros.";

/** Acima disso a caixa vira duas colunas no sm (nomes curtos, lista longa) */
const OPCOES_PARA_DUAS_COLUNAS = 4;

export function ListaDeConvenios({
  legenda,
  legendaOculta = false,
  ajuda,
  opcoes,
  marcados,
  aoMudar,
  vazio,
  podeEditar = true,
  dica = DICA_PADRAO,
}: {
  legenda: string;
  /** true: a legenda vale so para o leitor de tela (o rotulo ja esta a vista) */
  legendaOculta?: boolean;
  ajuda?: React.ReactNode;
  opcoes: readonly OpcaoDaListaDeConvenios[];
  marcados: ReadonlySet<string>;
  aoMudar: (id: string, marcado: boolean) => void;
  /** O que aparece no lugar da caixa quando nao ha opcao (D6: so texto) */
  vazio: React.ReactNode;
  /** false: caixas desabilitadas, com a dica do papel */
  podeEditar?: boolean;
  dica?: string;
}): React.JSX.Element {
  const idBase = useId();
  const idDaAjuda = `${idBase}-ajuda`;

  // Inativo no fim, sem mudar a ordem de quem chama dentro de cada grupo.
  const ordenadas = [
    ...opcoes.filter((opcao) => !opcao.inativo),
    ...opcoes.filter((opcao) => opcao.inativo),
  ];

  const caixa = (
    <div
      className={cn(
        "grid w-full gap-0.5 rounded-xl border border-border bg-card p-1.5",
        ordenadas.length > OPCOES_PARA_DUAS_COLUNAS && "sm:grid-cols-2",
      )}
    >
      {ordenadas.map((opcao) => {
        const idDaNota = `${idBase}-${opcao.id}-nota`;
        return (
          <div
            key={opcao.id}
            className={cn(
              "grid rounded-md cz-transition",
              podeEditar && "hover:bg-surface-3",
            )}
          >
            <label
              className={cn(
                "flex min-h-10 items-center gap-3 px-2.5 text-[13.5px] text-foreground",
                podeEditar ? "cursor-pointer" : "cursor-not-allowed",
              )}
            >
              <Checkbox
                checked={marcados.has(opcao.id)}
                disabled={!podeEditar}
                onCheckedChange={(valor) => aoMudar(opcao.id, valor === true)}
                aria-describedby={opcao.nota ? idDaNota : undefined}
              />
              <span className="min-w-0 flex-1 py-2 break-words">
                {opcao.nome}
                {opcao.plano ? (
                  <span className="text-text-secondary"> · {opcao.plano}</span>
                ) : null}
              </span>
              {opcao.inativo ? <ChipSituacao active={false} /> : null}
            </label>
            {opcao.nota ? (
              // 39px = respiro da linha (10) + caixa (17) + vao (12): a nota
              // alinha com o nome, nao com a caixa.
              <p
                id={idDaNota}
                className="pr-2.5 pb-2 pl-[39px] text-xs text-text-secondary"
              >
                {opcao.nota}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <fieldset
      className="grid min-w-0 gap-2"
      aria-describedby={ajuda ? idDaAjuda : undefined}
    >
      <legend
        className={cn(
          "mb-1.5 text-xs font-semibold text-foreground",
          legendaOculta && "sr-only",
        )}
      >
        {legenda}
      </legend>
      {ajuda ? (
        <div id={idDaAjuda} className="text-xs text-text-secondary">
          {ajuda}
        </div>
      ) : null}
      {ordenadas.length === 0 ? (
        <div className="rounded-xl bg-surface-subtle px-3.5 py-3 text-[13px] text-text-secondary">
          {vazio}
        </div>
      ) : podeEditar ? (
        caixa
      ) : (
        <DisabledWithHint hint={dica} className="grid w-full">
          {caixa}
        </DisabledWithHint>
      )}
    </fieldset>
  );
}
