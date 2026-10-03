"use client";

import {
  CalendarArrowUp,
  Check,
  Ellipsis,
  FileUser,
  MessageSquareText,
  Pencil,
  SquareX,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { conversaDoContatoAction } from "@/app/(app)/atividades/actions";
import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ATIVIDADE_STATUS } from "@/lib/design/status";
import {
  ADIAMENTOS,
  ROTULO_DO_ADIAMENTO,
  situacaoDaAtividade,
  textoDoPrazo,
  type Adiamento,
} from "@/lib/domain/atividades";
import { formatarTelefone } from "@/lib/domain/telefone";
import type { AtividadeResumo } from "@/lib/queries/atividades";
import { cn } from "@/lib/utils";

// Uma atividade na lista. Duas formas:
// - "lista" (tela Atividades): concluir (40px), o que fazer com uma linha de
//   detalhes, o contato (abre a ficha, que serve para lead e paciente), o
//   prazo no fuso da clinica, o chip de situacao nas 3 camadas, o
//   responsavel e o menu (Editar, Adiar, Cancelar, Abrir conversa, Abrir
//   ficha);
// - "compacta" (drawer do lead, painel da conversa e ficha): concluir, o que
//   fazer, situacao, prazo e responsavel, com o mesmo menu.
// Sem permissao (profissional e leitura), concluir e as acoes do menu ficam
// visiveis, desabilitadas e com a dica; abrir conversa e ficha continuam.

export type AcoesDaLinha = {
  concluir: (atividade: AtividadeResumo) => void;
  reabrir: (atividade: AtividadeResumo) => void;
  cancelar: (atividade: AtividadeResumo) => void;
  adiar: (atividade: AtividadeResumo, dias: Adiamento) => void;
  editar: (atividade: AtividadeResumo) => void;
};

export type ContextoDaLinha = {
  agora: Date;
  hoje: string;
  timezone: string;
  /** Nomes da equipe (inclusive quem saiu) */
  nomes: Record<string, string>;
  /** Membros ativos: responsavel fora desta lista aparece "sem acesso" */
  ativos: readonly string[] | null;
  eu: string | null;
  podeEditar: boolean;
  dica: string;
};

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

/** Quem cuida, em texto: "Você", o nome ou "Sem responsável". */
export function textoDoResponsavel(
  assignee: string | null,
  contexto: Pick<ContextoDaLinha, "nomes" | "ativos" | "eu">,
  curto = false,
): { texto: string; semAcesso: boolean; nome: string | null } {
  if (assignee === null) {
    return { texto: "Sem responsável", semAcesso: false, nome: null };
  }
  const semAcesso =
    contexto.ativos !== null && !contexto.ativos.includes(assignee);
  if (assignee === contexto.eu) {
    return { texto: "Você", semAcesso, nome: contexto.nomes[assignee] ?? null };
  }
  const nome = contexto.nomes[assignee] ?? null;
  const base = nome ? (curto ? primeiroNome(nome) : nome) : "Pessoa da equipe";
  return {
    texto: semAcesso ? `${base} (sem acesso)` : base,
    semAcesso,
    nome,
  };
}

function BotaoConcluir({
  atividade,
  ocupada,
  acoes,
  contexto,
}: {
  atividade: AtividadeResumo;
  ocupada: boolean;
  acoes: AcoesDaLinha;
  contexto: ContextoDaLinha;
}) {
  const concluida = atividade.status === "concluida";
  const rotulo = concluida
    ? `Reabrir: ${atividade.titulo}`
    : `Concluir: ${atividade.titulo}`;
  const botao = (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={rotulo}
      disabled={
        !contexto.podeEditar || ocupada || atividade.status === "cancelada"
      }
      onClick={() =>
        concluida ? acoes.reabrir(atividade) : acoes.concluir(atividade)
      }
      className="shrink-0"
    >
      {concluida ? <Undo2 aria-hidden /> : <Check aria-hidden />}
    </Button>
  );
  if (contexto.podeEditar) {
    return botao;
  }
  return <DisabledWithHint hint={contexto.dica}>{botao}</DisabledWithHint>;
}

// Todos os itens sao neutros, inclusive "Cancelar atividade": ele usa o
// icone da situacao Cancelada (SquareX), que e sempre neutral (docs/06 4.6,
// conflito C18). Pintar esse item de alerta poria o mesmo icone em duas
// cores; e cancelar nao apaga nada (tem "Desfazer" e "Reabrir").
function ItemDoMenu({
  icone: Icone,
  rotulo,
  motivo,
  aoEscolher,
}: {
  icone: LucideIcon;
  rotulo: string;
  /** nulo: liberado; texto: desabilitado com o motivo escrito embaixo */
  motivo: string | null;
  aoEscolher: () => void;
}) {
  if (motivo === null) {
    return (
      <DropdownMenuItem onSelect={aoEscolher}>
        <Icone aria-hidden />
        {rotulo}
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem
      disabled
      className="flex-col items-start justify-center gap-0.5 py-2 data-disabled:opacity-100"
    >
      <span className="inline-flex items-center gap-[9px] opacity-45">
        <Icone aria-hidden className="size-[15px]" />
        {rotulo}
      </span>
      <span className="text-xs font-normal text-text-secondary">{motivo}</span>
    </DropdownMenuItem>
  );
}

function MenuDaAtividade({
  atividade,
  ocupada,
  acoes,
  contexto,
  comAtalhos,
}: {
  atividade: AtividadeResumo;
  ocupada: boolean;
  acoes: AcoesDaLinha;
  contexto: ContextoDaLinha;
  /** Abrir conversa e Abrir ficha (fora da propria conversa ou ficha) */
  comAtalhos: { conversa: boolean; ficha: boolean };
}) {
  const router = useRouter();
  const [abrindoConversa, setAbrindoConversa] = useState(false);
  const pendente = atividade.status === "pendente";
  const motivo = contexto.podeEditar ? null : contexto.dica;

  const abrirConversa = async () => {
    if (atividade.conversation_id) {
      router.push(`/atendimento?conversa=${atividade.conversation_id}`);
      return;
    }
    setAbrindoConversa(true);
    const resultado = await conversaDoContatoAction(atividade.contact_id);
    setAbrindoConversa(false);
    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    if (!resultado.conversationId) {
      toast.info(
        "Este contato ainda não tem conversa no WhatsApp que você possa ver.",
      );
      return;
    }
    router.push(`/atendimento?conversa=${resultado.conversationId}`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-text-secondary"
          aria-label={`Mais ações: ${atividade.titulo}`}
          disabled={ocupada || abrindoConversa}
        >
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-72">
        {pendente ? (
          <>
            <ItemDoMenu
              icone={Pencil}
              rotulo="Editar"
              motivo={motivo}
              aoEscolher={() => acoes.editar(atividade)}
            />
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-semibold text-text-secondary">
              Adiar
            </DropdownMenuLabel>
            {ADIAMENTOS.map((dias) => (
              <ItemDoMenu
                key={dias}
                icone={CalendarArrowUp}
                rotulo={ROTULO_DO_ADIAMENTO[dias]}
                motivo={motivo}
                aoEscolher={() => acoes.adiar(atividade, dias)}
              />
            ))}
          </>
        ) : (
          <ItemDoMenu
            icone={Undo2}
            rotulo="Reabrir"
            motivo={motivo}
            aoEscolher={() => acoes.reabrir(atividade)}
          />
        )}
        {comAtalhos.conversa || comAtalhos.ficha ? (
          <DropdownMenuSeparator />
        ) : null}
        {comAtalhos.conversa ? (
          <ItemDoMenu
            icone={MessageSquareText}
            rotulo="Abrir conversa"
            motivo={null}
            aoEscolher={() => void abrirConversa()}
          />
        ) : null}
        {comAtalhos.ficha ? (
          <ItemDoMenu
            icone={FileUser}
            rotulo="Abrir ficha"
            motivo={null}
            aoEscolher={() => router.push(`/pacientes/${atividade.contact_id}`)}
          />
        ) : null}
        {pendente ? (
          <>
            <DropdownMenuSeparator />
            <ItemDoMenu
              icone={SquareX}
              rotulo="Cancelar atividade"
              motivo={motivo}
              aoEscolher={() => acoes.cancelar(atividade)}
            />
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LinhaDeAtividade({
  atividade,
  forma,
  ocupada,
  acoes,
  contexto,
  comAtalhos = { conversa: true, ficha: true },
}: {
  atividade: AtividadeResumo;
  forma: "lista" | "compacta";
  ocupada: boolean;
  acoes: AcoesDaLinha;
  contexto: ContextoDaLinha;
  comAtalhos?: { conversa: boolean; ficha: boolean };
}) {
  const situacao = situacaoDaAtividade(
    atividade,
    contexto.agora,
    contexto.hoje,
  );
  const definicao = ATIVIDADE_STATUS[situacao];
  const prazo = textoDoPrazo(atividade, contexto.hoje, contexto.timezone);
  const responsavel = textoDoResponsavel(
    atividade.assignee_user_id,
    contexto,
    forma === "compacta",
  );
  const nomeDoContato = atividade.contato
    ? (atividade.contato.nome ?? formatarTelefone(atividade.contato.telefone))
    : "Contato";

  if (forma === "compacta") {
    return (
      <li
        className="flex items-start gap-2.5 py-1.5"
        aria-busy={ocupada || undefined}
      >
        <BotaoConcluir
          atividade={atividade}
          ocupada={ocupada}
          acoes={acoes}
          contexto={contexto}
        />
        <div className="grid min-w-0 flex-1 gap-1 pt-0.5">
          <p className="line-clamp-2 text-[13px] font-semibold break-words text-text-strong">
            {atividade.titulo}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
            <StatusChip size="sm" definition={definicao} />
            <span className="cz-num">{prazo}</span>
            <span aria-hidden>·</span>
            <span className={cn(responsavel.semAcesso && "text-warning-text")}>
              {responsavel.texto}
            </span>
          </div>
        </div>
        <MenuDaAtividade
          atividade={atividade}
          ocupada={ocupada}
          acoes={acoes}
          contexto={contexto}
          comAtalhos={comAtalhos}
        />
      </li>
    );
  }

  return (
    <li
      className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0"
      aria-busy={ocupada || undefined}
    >
      <BotaoConcluir
        atividade={atividade}
        ocupada={ocupada}
        acoes={acoes}
        contexto={contexto}
      />
      <div className="grid min-w-0 flex-1 gap-1 pt-0.5">
        <p className="text-sm font-semibold break-words text-text-strong">
          {atividade.titulo}
        </p>
        {atividade.detalhes ? (
          <p className="truncate text-[13px] text-text-secondary">
            {atividade.detalhes}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
          <Link
            href={`/pacientes/${atividade.contact_id}`}
            prefetch={false}
            className="hit-40 max-w-full truncate font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
          >
            {nomeDoContato}
          </Link>
          <span className="cz-num text-text-secondary">{prazo}</span>
          <StatusChip size="sm" definition={definicao} />
          {/* No celular a coluna do responsavel some: ele vem nesta linha. */}
          <span
            className={cn(
              "text-text-secondary md:hidden",
              responsavel.semAcesso && "text-warning-text",
            )}
          >
            {responsavel.texto}
          </span>
          {atividade.origem === "automacao" ? (
            <span className="text-xs text-text-secondary">
              Criada por automação
            </span>
          ) : null}
        </div>
      </div>
      <div className="hidden w-40 shrink-0 items-center gap-2 pt-2 md:flex">
        {responsavel.nome ? (
          <ContactAvatar name={responsavel.nome} phone="" size={24} />
        ) : null}
        <span
          className={cn(
            "min-w-0 truncate text-[13px]",
            responsavel.nome ? "text-foreground" : "text-text-secondary",
            responsavel.semAcesso && "text-warning-text",
          )}
        >
          {responsavel.texto}
        </span>
      </div>
      <MenuDaAtividade
        atividade={atividade}
        ocupada={ocupada}
        acoes={acoes}
        contexto={contexto}
        comAtalhos={comAtalhos}
      />
    </li>
  );
}
