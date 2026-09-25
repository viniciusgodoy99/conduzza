"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Check, RotateCcw, Undo2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  assumirConversaAction,
  reabrirConversaAction,
  resolverConversaAction,
  transferirConversaAction,
  type InboxActionResult,
} from "@/app/(app)/atendimento/actions";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { canEdit, ROLE_LABELS, type Role } from "@/lib/domain/permissions";
import {
  conversationKeys,
  type ConversationListItem,
} from "@/lib/queries/conversations";
import { createClient } from "@/lib/supabase/client";

// Acoes da conversa no CABECALHO do fio (decisao do dono, C29): Assumir,
// Transferir, Resolver e Reabrir saem do compositor, que fica so com a
// escrita. As regras continuam as mesmas: quem nao pode fica com o botao
// visivel e desabilitado com dica, e a Server Action recusa de novo.
//
// Largura: o fio vive entre a lista e o painel, e no notebook sobra pouco
// para o cabecalho. Abaixo de 760px de fio, Transferir, Devolver e Resolver
// ficam so com o icone (o nome acessivel continua inteiro e a dica mostra o
// rotulo); abaixo de 480px, "Assumir conversa" mostra so "Assumir".

const ROTULO_RECOLHIVEL = "@max-[759px]/fio:sr-only";
const BOTAO_RECOLHIVEL = "@max-[759px]/fio:w-10 @max-[759px]/fio:px-0";

const DICA_DEVOLVER =
  "Chega com o agente de IA. Até lá, use Resolver quando terminar o atendimento.";
const DICA_TRANSFERIR =
  "Só administrador, gestor e recepção passam a conversa para outra pessoa.";

/**
 * O motivo de quem so acompanha (papel Somente leitura), numa frase so para
 * a dica dos botoes do topo e o aviso do compositor (achado L25): antes a
 * dica dizia "nao pode editar o atendimento" e o compositor outra coisa.
 */
export const SO_ACOMPANHA =
  "Seu perfil acompanha o atendimento, sem responder.";

const PAPEIS_QUE_TRANSFEREM: readonly Role[] = ["admin", "gestor", "recepcao"];
const PAPEIS_QUE_RECEBEM: readonly Role[] = [
  "admin",
  "gestor",
  "recepcao",
  "profissional",
];

type Membro = { user_id: string; role: Role };

type Acao = "assumir" | "resolver" | "reabrir" | "transferir";

export function AcoesDaConversa({
  conversation,
  clinicId,
  viewerId,
  viewerRole,
  authorNames,
  aoIrParaConversa,
  aoPerderConversa,
}: {
  conversation: ConversationListItem;
  clinicId: string;
  viewerId: string;
  viewerRole: Role;
  authorNames: Record<string, string>;
  /** Leva a tela ate outra conversa (a aberta do mesmo paciente, ao reabrir) */
  aoIrParaConversa: (conversationId: string) => void;
  /**
   * A conversa deixou de estar disponivel para esta pessoa (o servidor
   * respondeu conversaIndisponivel, achado L4): o InboxClient tira da lista,
   * fecha o fio e explica.
   */
  aoPerderConversa?: (conversationId: string) => void;
}) {
  const queryClient = useQueryClient();
  const supabase = useMemo(() => createClient(), []);
  const [pendente, iniciar] = useTransition();
  const [acaoEmCurso, setAcaoEmCurso] = useState<Acao | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);

  const podeEditar = canEdit(viewerRole, "atendimento");
  // Unico papel sem escrita no Atendimento e o Somente leitura: a mesma frase
  // do compositor.
  const dicaSemPermissao = SO_ACOMPANHA;
  const podeTransferir = PAPEIS_QUE_TRANSFEREM.includes(viewerRole);
  const resolvida = conversation.status === "resolvida";
  const minha =
    conversation.status === "em_atendimento" &&
    conversation.assignee_user_id === viewerId;
  const deColega =
    conversation.status === "em_atendimento" &&
    conversation.assignee_user_id !== null &&
    conversation.assignee_user_id !== viewerId;

  // A equipe que pode receber a conversa, lida com a sessao (a policy de
  // clinic_member deixa o membro ativo ver o time). So quando o menu abre:
  // a maioria das conversas nunca e passada adiante.
  const membrosQuery = useQuery({
    queryKey: ["membros-que-atendem", clinicId],
    queryFn: async (): Promise<Membro[]> => {
      const { data, error } = await supabase
        .from("clinic_member")
        .select("user_id, role")
        .eq("clinic_id", clinicId)
        .eq("status", "ativo")
        .in("role", [...PAPEIS_QUE_RECEBEM]);
      if (error) {
        throw new Error(error.message);
      }
      return (data ?? []) as Membro[];
    },
    enabled: menuAberto && podeTransferir,
    staleTime: 60_000,
  });
  const candidatos = (membrosQuery.data ?? [])
    .filter(
      (membro) =>
        membro.user_id !== viewerId &&
        membro.user_id !== conversation.assignee_user_id,
    )
    .map((membro) => ({
      ...membro,
      nome: authorNames[membro.user_id] ?? "Pessoa da equipe",
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const atualizar = () => {
    void queryClient.invalidateQueries({
      queryKey: conversationKeys.messages(conversation.id),
    });
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    // Resolver e reabrir mudam o total do chip "Resolvida".
    void queryClient.invalidateQueries({
      queryKey: conversationKeys.totalResolvidas(clinicId),
    });
  };

  const executar = (
    acao: Acao,
    tarefa: () => Promise<InboxActionResult>,
    aoConcluir?: () => void,
  ) => {
    setAcaoEmCurso(acao);
    iniciar(async () => {
      let resultado: InboxActionResult;
      try {
        resultado = await tarefa();
      } catch {
        resultado = {
          ok: false,
          error: "Não foi possível falar com o servidor. Tente de novo.",
        };
      }
      setAcaoEmCurso(null);
      if (!resultado.ok) {
        if (resultado.conversaIndisponivel && aoPerderConversa) {
          aoPerderConversa(conversation.id);
          return;
        }
        if (resultado.conversaAbertaId) {
          // Reabrir esbarrou na conversa que o paciente ja abriu de novo: a
          // tela vai ate ela, em vez de so recusar.
          toast.info("Este paciente já tem uma conversa aberta.", {
            description: "Ela está aberta agora na tela.",
          });
          atualizar();
          aoIrParaConversa(resultado.conversaAbertaId);
          return;
        }
        toast.error(resultado.error ?? "Algo deu errado. Tente de novo.");
        return;
      }
      aoConcluir?.();
      atualizar();
    });
  };

  const assumir = () =>
    executar("assumir", () => assumirConversaAction(conversation.id));

  // RESOLVIDA: so reabrir.
  if (resolvida) {
    const reabrir = (
      <Button
        variant="outline"
        disabled={!podeEditar || pendente}
        onClick={() =>
          executar("reabrir", () => reabrirConversaAction(conversation.id))
        }
      >
        <RotateCcw aria-hidden />
        {acaoEmCurso === "reabrir" ? (
          "Reabrindo..."
        ) : (
          <span>
            Reabrir
            <span className="@max-[479px]/fio:sr-only"> e responder</span>
          </span>
        )}
      </Button>
    );
    return podeEditar ? (
      reabrir
    ) : (
      <DisabledWithHint hint={dicaSemPermissao}>{reabrir}</DisabledWithHint>
    );
  }

  const transferir = (
    <DropdownMenu open={menuAberto} onOpenChange={setMenuAberto}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className={BOTAO_RECOLHIVEL}
              disabled={!podeTransferir || pendente}
            >
              <ArrowRightLeft aria-hidden />
              <span className={ROTULO_RECOLHIVEL}>
                {acaoEmCurso === "transferir"
                  ? "Transferindo..."
                  : "Transferir"}
              </span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Passar a conversa para outra pessoa</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Passar a conversa para</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {membrosQuery.isPending ? (
          <p
            role="status"
            className="px-[9px] py-2.5 text-[13px] text-text-secondary"
          >
            Carregando a equipe...
          </p>
        ) : membrosQuery.isError ? (
          <>
            <p className="px-[9px] py-2 text-[13px] text-alert-text">
              Não foi possível carregar a equipe.
            </p>
            <DropdownMenuItem
              onSelect={(evento) => {
                evento.preventDefault();
                void membrosQuery.refetch();
              }}
            >
              <RotateCcw aria-hidden />
              Tentar de novo
            </DropdownMenuItem>
          </>
        ) : candidatos.length === 0 ? (
          <p className="px-[9px] py-2.5 text-[13px] text-text-secondary">
            Ninguém mais da equipe pode receber esta conversa agora.
          </p>
        ) : (
          candidatos.map((membro) => (
            <DropdownMenuItem
              key={membro.user_id}
              onSelect={() =>
                executar(
                  "transferir",
                  () =>
                    transferirConversaAction({
                      conversation_id: conversation.id,
                      para_user_id: membro.user_id,
                    }),
                  () => toast.success(`Conversa passada para ${membro.nome}.`),
                )
              }
            >
              <span className="grid min-w-0 flex-1">
                <span className="truncate">{membro.nome}</span>
                <span className="text-[11.5px] font-normal text-text-secondary">
                  {ROLE_LABELS[membro.role]}
                </span>
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const transferirComDica = podeTransferir ? (
    transferir
  ) : (
    <DisabledWithHint hint={podeEditar ? DICA_TRANSFERIR : dicaSemPermissao}>
      <Button variant="outline" className={BOTAO_RECOLHIVEL} disabled>
        <ArrowRightLeft aria-hidden />
        <span className={ROTULO_RECOLHIVEL}>Transferir</span>
      </Button>
    </DisabledWithHint>
  );

  // MINHA: devolver (desabilitado ate o agente existir), transferir, resolver.
  // "Minha" nao garante escrita: o papel pode ter virado Somente leitura com
  // a conversa atribuida (achado L5). Ai Resolver fica visivel e desabilitado
  // com o motivo, como Assumir e Reabrir.
  if (minha) {
    const botaoResolver = (
      <Button
        variant="outline"
        className="@max-[479px]/fio:w-10 @max-[479px]/fio:px-0"
        disabled={!podeEditar || pendente}
        onClick={() =>
          executar("resolver", () => resolverConversaAction(conversation.id))
        }
      >
        <Check aria-hidden />
        <span className="@max-[479px]/fio:sr-only">
          {acaoEmCurso === "resolver" ? "Resolvendo..." : "Resolver"}
        </span>
      </Button>
    );
    return (
      <div className="flex items-center gap-1.5">
        <DisabledWithHint hint={DICA_DEVOLVER}>
          <Button variant="ghost" className={BOTAO_RECOLHIVEL} disabled>
            <Undo2 aria-hidden />
            <span className={ROTULO_RECOLHIVEL}>Devolver para a IA</span>
          </Button>
        </DisabledWithHint>
        {transferirComDica}
        {podeEditar ? (
          <Tooltip>
            <TooltipTrigger asChild>{botaoResolver}</TooltipTrigger>
            <TooltipContent>
              Encerrar o atendimento desta conversa
            </TooltipContent>
          </Tooltip>
        ) : (
          <DisabledWithHint hint={dicaSemPermissao}>
            {botaoResolver}
          </DisabledWithHint>
        )}
      </div>
    );
  }

  // SEM ATENDENTE, COM A IA OU COM UM COLEGA: transferir e assumir.
  const botaoAssumir = (
    <Button disabled={!podeEditar || pendente} onClick={assumir}>
      {acaoEmCurso === "assumir" ? (
        "Assumindo..."
      ) : (
        <span>
          Assumir
          <span className="@max-[479px]/fio:sr-only">
            {deColega ? " do colega" : " conversa"}
          </span>
        </span>
      )}
    </Button>
  );

  return (
    <div className="flex items-center gap-1.5">
      {transferirComDica}
      {podeEditar ? (
        botaoAssumir
      ) : (
        <DisabledWithHint hint={dicaSemPermissao}>
          {botaoAssumir}
        </DisabledWithHint>
      )}
    </div>
  );
}
