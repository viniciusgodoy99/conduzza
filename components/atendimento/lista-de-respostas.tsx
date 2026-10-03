"use client";

import { OctagonAlert, SquareSlash } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import type { RespostaRapida } from "@/lib/domain/respostas-rapidas";
import { cn } from "@/lib/utils";

// A lista de mensagens padrao do compositor (o "/" na resposta ao paciente,
// ou o botao da barra). So desenha: quem decide o que aparece, o item ativo
// e o que acontece ao escolher e o Composer, que mantem o foco no campo de
// texto o tempo todo (o campo e um textbox com aria-activedescendant
// apontando para a opcao ativa; ARIA 1.2 aceita os dois atributos nele).
//
// Clique com onMouseDown + preventDefault em todo o painel (menos a propria
// lista, onde cai o clique na barra de rolagem): o foco nao sai do campo,
// entao o teclado do celular nao fecha, a lista nao se fecha por perder o
// foco e a escolha volta direto para a escrita.
//
// A previa de cada linha ja vem renderizada com o nome do contato: fica so
// na tela, nunca em log.

export const DICA_SEM_CADASTRO =
  "Somente administradores e gestores cadastram mensagens padrão.";

export type ItemDaLista = {
  resposta: RespostaRapida;
  /** o texto como vai entrar no campo (nome do contato e da clinica) */
  previa: string;
};

/** Ids dos elementos da lista, derivados de uma base (useId do compositor). */
export function idsDaLista(base: string) {
  return {
    painel: `${base}-painel`,
    lista: `${base}-lista`,
    opcao: (indice: number) => `${base}-opcao-${indice}`,
  };
}

export function ListaDeRespostas({
  base,
  estado,
  itens,
  ativo,
  cadastradas,
  podeCadastrar,
  contatoSemNome,
  aoEscolher,
  aoApontar,
  aoTentarDeNovo,
}: {
  /** base dos ids (useId do compositor) */
  base: string;
  estado: "carregando" | "erro" | "pronto";
  /** ja filtrados e na ordem */
  itens: ItemDaLista[];
  /** indice da opcao ativa (aria-selected) */
  ativo: number;
  /** quantas ativas a clinica tem, para separar "nenhuma" de "sem resultado" */
  cadastradas: number;
  /** administrador e gestor: o vazio leva a Configuracoes */
  podeCadastrar: boolean;
  /** o contato nao tem nome e algum item usa {{nome}} */
  contatoSemNome: boolean;
  aoEscolher: (indice: number) => void;
  aoApontar: (indice: number) => void;
  aoTentarDeNovo: () => void;
}) {
  const ids = idsDaLista(base);
  const listaRef = useRef<HTMLUListElement>(null);

  // A opcao ativa sempre a vista quando as setas passam do que cabe. Rola SO
  // a lista (scrollIntoView rolaria tambem o fio e a pagina).
  useEffect(() => {
    const lista = listaRef.current;
    const opcao = lista?.querySelector<HTMLElement>(`[data-indice="${ativo}"]`);
    if (!lista || !opcao) {
      return;
    }
    if (opcao.offsetTop < lista.scrollTop) {
      lista.scrollTop = opcao.offsetTop;
    } else if (
      opcao.offsetTop + opcao.offsetHeight >
      lista.scrollTop + lista.clientHeight
    ) {
      lista.scrollTop =
        opcao.offsetTop + opcao.offsetHeight - lista.clientHeight;
    }
  }, [ativo, itens.length]);

  const manterFoco = (evento: React.MouseEvent) => {
    if (evento.target !== listaRef.current) {
      evento.preventDefault();
    }
  };

  let corpo: React.ReactNode;
  if (estado === "carregando") {
    corpo = (
      <p className="px-3 py-3 text-[12.5px] text-text-secondary">
        Carregando as mensagens padrão...
      </p>
    );
  } else if (estado === "erro") {
    corpo = (
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[12.5px] text-alert-text">
          <OctagonAlert aria-hidden className="size-3.5 shrink-0" />
          Não foi possível carregar as mensagens padrão.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={aoTentarDeNovo}
        >
          Tentar de novo
        </Button>
      </div>
    );
  } else if (cadastradas === 0) {
    const configurar = (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!podeCadastrar}
        asChild={podeCadastrar}
      >
        {podeCadastrar ? (
          <Link href="/configuracoes?aba=mensagens">
            Cadastrar em Configurações
          </Link>
        ) : (
          "Cadastrar em Configurações"
        )}
      </Button>
    );
    corpo = (
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <p className="text-[12.5px] text-text-secondary">
          Nenhuma mensagem padrão cadastrada.
        </p>
        {podeCadastrar ? (
          configurar
        ) : (
          <DisabledWithHint hint={DICA_SEM_CADASTRO}>
            {configurar}
          </DisabledWithHint>
        )}
      </div>
    );
  } else if (itens.length === 0) {
    corpo = (
      <p className="px-3 py-3 text-[12.5px] text-text-secondary">
        Nenhuma mensagem com esse atalho.
      </p>
    );
  } else {
    corpo = (
      <ul
        ref={listaRef}
        id={ids.lista}
        role="listbox"
        aria-label="Mensagens padrão"
        className="relative max-h-[min(20rem,40dvh)] overflow-y-auto py-1"
      >
        {itens.map((item, indice) => {
          const selecionada = indice === ativo;
          return (
            <li
              key={item.resposta.id}
              id={ids.opcao(indice)}
              role="option"
              aria-selected={selecionada}
              data-indice={indice}
              onMouseMove={() => {
                if (!selecionada) {
                  aoApontar(indice);
                }
              }}
              onClick={() => aoEscolher(indice)}
              className={cn(
                "grid min-h-10 cursor-pointer gap-0.5 border-l-[3px] px-3 py-1.5 cz-transition",
                selecionada
                  ? "border-primary-edge bg-primary-soft"
                  : "border-transparent hover:bg-surface-3",
              )}
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-[13px] font-semibold text-text-strong">
                  {item.resposta.titulo}
                </span>
                <span className="shrink-0 cz-num text-[11.5px] text-text-secondary">
                  /{item.resposta.atalho}
                </span>
              </span>
              <span className="line-clamp-1 text-[12px] text-text-secondary">
                {item.previa}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div
      id={ids.painel}
      onMouseDown={manterFoco}
      className="grid overflow-hidden rounded-xl border border-border-strong bg-popover text-popover-foreground shadow-pop"
    >
      <p className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-[11.5px] font-semibold text-text-secondary">
        <SquareSlash aria-hidden className="size-3.5" />
        Mensagens padrão
        <span className="ml-auto hidden font-normal sm:inline">
          Enter escolhe, Esc fecha
        </span>
      </p>
      {corpo}
      {contatoSemNome && estado === "pronto" && itens.length > 0 ? (
        <p className="border-t border-border px-3 py-1.5 text-[11.5px] text-text-secondary">
          Contato sem nome: o nome sai do texto.
        </p>
      ) : null}
    </div>
  );
}
