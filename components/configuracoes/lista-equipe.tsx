"use client";

import { CircleAlert, UserMinus, UserPlus, Users } from "lucide-react";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { cancelarAgendadasDaPessoaAction } from "@/app/(app)/atendimento/agendadas-actions";
import {
  desativarMembroAction,
  mudarPapelAction,
  reativarMembroAction,
  vincularProfissionalAction,
} from "@/app/(app)/configuracoes/actions";
import {
  ajudaDeCancelarAgendadas,
  contarAgendadasDaPessoa,
  rotuloDeCancelarAgendadas,
  textoDasAgendadasDaPessoa,
} from "@/components/atendimento/agendadas/contagens";
import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { Aviso } from "@/components/shared/aviso";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ACCESS_LEVEL_STATUS,
  type StatusDefinition,
} from "@/lib/design/status";
import { ROLE_DESCRIPTIONS, ROLE_OPTIONS } from "@/lib/domain/permissions";
import type { Role } from "@/lib/domain/permissions";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// Lista da equipe da clinica: quem tem acesso, com qual papel, e quem esta
// com o acesso desativado (fica no fim, com fundo afundado e chip). Tirar
// acesso nao apaga ninguem: o vinculo vira inativo e volta com um clique.
//
// Tres travas, iguais as do banco, aqui so para explicar antes de tentar:
// ninguem mexe na propria linha, gestor nao mexe em administrador, e o unico
// administrador ativo nao pode ser rebaixado nem desativado.
//
// Mensagens agendadas (A5 do desenho final da mensagem agendada, 06/10/2026):
// tirar o acesso ou trocar para Somente leitura de quem ASSINA mensagens
// agendadas (editou por ultimo, ou criou e ninguem editou) mostra quantas
// sao e oferece cancelar todas, com a caixa desmarcada. Sem cancelar, elas
// saem em nome da pessoa e a conversa fica Sem atendente. A contagem e lida
// pela sessao (a RLS recorta), so quando o dialogo precisa dela.
//
// Papel Profissional (achados 1, 31 e 120): a linha ganha o seletor
// "Profissional da agenda". Sem esse vinculo a Agenda, o Inicio e os
// Resultados da pessoa ficam vazios, entao a falta aparece como aviso na
// propria linha.

export type MembroEquipe = {
  userId: string;
  nome: string;
  email: string;
  papel: Role;
  /** false = acesso tirado, reversivel */
  ativo: boolean;
  /** cadastro de profissional da agenda (so vale para o papel Profissional) */
  professionalId: string | null;
};

/** Quantas mensagens agendadas a pessoa do dialogo assina. */
export type ContagemDeAgendadas =
  | { estado: "carregando" }
  | { estado: "erro" }
  | { estado: "pronto"; n: number };

/** O bloco do dialogo: a contagem e a caixa de cancelar (A5). */
export function AgendadasDaPessoa({
  contagem,
  cancelar,
  aoMarcar,
  desabilitado = false,
}: {
  contagem: ContagemDeAgendadas | null;
  cancelar: boolean;
  aoMarcar: (marcado: boolean) => void;
  desabilitado?: boolean;
}) {
  const base = useId();
  if (!contagem) {
    return null;
  }
  if (contagem.estado === "carregando") {
    return (
      <p role="status" className="text-[13px] text-text-secondary">
        Conferindo as mensagens agendadas desta pessoa.
      </p>
    );
  }
  if (contagem.estado === "erro") {
    return (
      <Aviso tom="warning">
        Não foi possível conferir se esta pessoa assina mensagens agendadas. Se
        assinar, elas saem em nome dela e a conversa fica Sem atendente.
      </Aviso>
    );
  }
  if (contagem.n === 0) {
    return null;
  }
  return (
    <div className="grid gap-2.5">
      <p className="text-[13.5px] font-semibold text-text-strong">
        {textoDasAgendadasDaPessoa(contagem.n)}
      </p>
      <div className="flex items-start gap-2.5">
        <Checkbox
          id={`${base}-cancelar`}
          checked={cancelar}
          disabled={desabilitado}
          onCheckedChange={(valor) => aoMarcar(valor === true)}
          aria-describedby={`${base}-ajuda`}
          className="mt-px"
        />
        <div className="grid gap-1">
          <Label htmlFor={`${base}-cancelar`} className="text-[13.5px]">
            {rotuloDeCancelarAgendadas(contagem.n)}
          </Label>
          <p id={`${base}-ajuda`} className="text-[12.5px] text-text-secondary">
            {ajudaDeCancelarAgendadas(contagem.n)}
          </p>
        </div>
      </div>
    </div>
  );
}

/** A caixa so vale com a contagem lida e maior que zero. */
function vaiCancelar(
  contagem: ContagemDeAgendadas | null,
  cancelar: boolean,
): boolean {
  return cancelar && contagem?.estado === "pronto" && contagem.n > 0;
}

/** Cadastro de profissional que um usuario de papel Profissional pode ser. */
export type ProfissionalDaAgenda = {
  id: string;
  nome: string;
  ativo: boolean;
};

// Atencao e CircleAlert (tabela de icones reservados, docs/06 secao 4.6).
const SEM_VINCULO: StatusDefinition = {
  label: "Sem profissional da agenda",
  tone: "warning",
  icon: CircleAlert,
};

// Radix Select nao aceita item de valor vazio: a sentinela desfaz o vinculo.
const DESLIGAR = "__desligar__";

/**
 * Opcoes do seletor: os profissionais ativos e, se a pessoa ja estiver ligada
 * a um desativado, esse tambem (senao o seletor apareceria vazio).
 */
export function opcoesDeProfissional(
  profissionais: ProfissionalDaAgenda[] | null,
  atual: string | null,
): ProfissionalDaAgenda[] {
  return (profissionais ?? []).filter(
    (profissional) => profissional.ativo || profissional.id === atual,
  );
}

/** Por que o seletor de profissional esta travado, ou nulo se esta livre. */
export function motivoSemProfissional(
  profissionais: ProfissionalDaAgenda[] | null,
  opcoes: ProfissionalDaAgenda[],
): string | null {
  if (profissionais === null) {
    return "Não foi possível carregar os profissionais. Recarregue a página";
  }
  if (opcoes.length === 0) {
    return "Cadastre o profissional em Cadastros antes de ligar";
  }
  return null;
}

export function ListaEquipe({
  membros,
  meuUserId,
  podeGerenciar,
  ehAdmin,
  dica,
  profissionais,
  clinicId,
}: {
  membros: MembroEquipe[];
  meuUserId: string;
  podeGerenciar: boolean;
  ehAdmin: boolean;
  dica: string;
  /** nulo: a leitura dos profissionais falhou */
  profissionais: ProfissionalDaAgenda[] | null;
  /**
   * A clinica ativa: a contagem das mensagens agendadas de quem perde a
   * escrita. Ausente, os dialogos nao contam (nem oferecem cancelar).
   */
  clinicId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmar, setConfirmar] = useState<MembroEquipe | null>(null);
  // Trocar para Somente leitura de quem assina mensagens agendadas.
  const [paraLeitura, setParaLeitura] = useState<MembroEquipe | null>(null);
  const [agendadas, setAgendadas] = useState<ContagemDeAgendadas | null>(null);
  const [cancelarAgendadas, setCancelarAgendadas] = useState(false);
  // A contagem que vale e a do ultimo pedido (abrir o dialogo de outra
  // pessoa antes da primeira voltar nao mistura as duas).
  const pedidoDaContagem = useRef(0);

  const contarAgendadas = async (
    userId: string,
  ): Promise<ContagemDeAgendadas> => {
    if (!clinicId) {
      return { estado: "pronto", n: 0 };
    }
    try {
      const n = await contarAgendadasDaPessoa(createClient(), clinicId, userId);
      return { estado: "pronto", n };
    } catch {
      return { estado: "erro" };
    }
  };

  const cancelarAgendadasDe = async (alvo: MembroEquipe) => {
    const resultado = await cancelarAgendadasDaPessoaAction({
      userId: alvo.userId,
    }).catch(() => null);
    if (!resultado?.ok) {
      toast.error(
        resultado?.error ??
          "Não foi possível cancelar as mensagens agendadas desta pessoa. Tente de novo.",
      );
      return;
    }
    toast.success(
      resultado.canceladas === 1
        ? "1 mensagem agendada cancelada"
        : `${resultado.canceladas} mensagens agendadas canceladas`,
    );
  };

  const abrirTirarAcesso = (membro: MembroEquipe) => {
    const pedido = ++pedidoDaContagem.current;
    setConfirmar(membro);
    setCancelarAgendadas(false);
    setAgendadas(clinicId ? { estado: "carregando" } : null);
    if (!clinicId) {
      return;
    }
    void contarAgendadas(membro.userId).then((contagem) => {
      if (pedidoDaContagem.current === pedido) {
        setAgendadas(contagem);
      }
    });
  };

  const fecharDialogos = () => {
    pedidoDaContagem.current += 1;
    setConfirmar(null);
    setParaLeitura(null);
    setAgendadas(null);
    setCancelarAgendadas(false);
  };

  const mudarPapel = (membro: MembroEquipe, papel: string) => {
    executar(
      () => mudarPapelAction({ user_id: membro.userId, papel }),
      `Papel de ${membro.nome} atualizado`,
      "Não foi possível mudar o papel.",
    );
  };

  // Para Somente leitura: confere primeiro se a pessoa assina agendadas. Sem
  // nenhuma, troca direto (como os outros papeis); com alguma, ou sem
  // conseguir conferir, o dialogo explica antes.
  const pedirLeitura = (membro: MembroEquipe) => {
    const pedido = ++pedidoDaContagem.current;
    setCancelarAgendadas(false);
    startTransition(async () => {
      const contagem = await contarAgendadas(membro.userId);
      if (pedidoDaContagem.current !== pedido) {
        return;
      }
      if (contagem.estado === "pronto" && contagem.n === 0) {
        const resultado = await mudarPapelAction({
          user_id: membro.userId,
          papel: "leitura",
        });
        if (!resultado.ok) {
          toast.error(resultado.error ?? "Não foi possível mudar o papel.");
          return;
        }
        toast.success(`Papel de ${membro.nome} atualizado`);
        return;
      }
      setAgendadas(contagem);
      setParaLeitura(membro);
    });
  };

  const confirmarLeitura = () => {
    const alvo = paraLeitura;
    if (!alvo) {
      return;
    }
    const cancelar = vaiCancelar(agendadas, cancelarAgendadas);
    startTransition(async () => {
      const resultado = await mudarPapelAction({
        user_id: alvo.userId,
        papel: "leitura",
      });
      if (!resultado.ok) {
        toast.error(resultado.error ?? "Não foi possível mudar o papel.");
        return;
      }
      fecharDialogos();
      toast.success(`Papel de ${alvo.nome} atualizado`);
      // Depois da troca: se o cancelamento falhar, a troca ja valeu e as
      // mensagens seguem como o padrao (saem em nome dela).
      if (cancelar) {
        await cancelarAgendadasDe(alvo);
      }
    });
  };

  const adminsAtivos = membros.filter(
    (membro) => membro.ativo && membro.papel === "admin",
  );
  const unicoAdminId =
    adminsAtivos.length === 1 ? (adminsAtivos[0]?.userId ?? null) : null;

  // Devolve o motivo de a acao estar travada, ou null quando ela esta liberada.
  const motivo = (
    membro: MembroEquipe,
    acao: "papel" | "acesso",
  ): string | null => {
    if (!podeGerenciar) {
      return dica;
    }
    if (membro.userId === meuUserId) {
      return acao === "papel"
        ? "Você não altera o próprio papel"
        : "Você não tira o próprio acesso";
    }
    if (!ehAdmin && membro.papel === "admin") {
      return "Somente um administrador altera o acesso de outro administrador";
    }
    if (membro.userId === unicoAdminId) {
      return "A clínica precisa de pelo menos um administrador ativo";
    }
    return null;
  };

  const executar = (
    task: () => Promise<{ ok: boolean; error?: string }>,
    sucesso: string,
    falha: string,
  ) => {
    startTransition(async () => {
      const resultado = await task();
      if (!resultado.ok) {
        toast.error(resultado.error ?? falha);
        return;
      }
      toast.success(sucesso);
    });
  };

  const confirmarDesativacao = () => {
    const alvo = confirmar;
    if (!alvo) {
      return;
    }
    const cancelar = vaiCancelar(agendadas, cancelarAgendadas);
    startTransition(async () => {
      const resultado = await desativarMembroAction({ user_id: alvo.userId });
      if (!resultado.ok) {
        toast.error(resultado.error ?? "Não foi possível tirar o acesso.");
        return;
      }
      fecharDialogos();
      toast.success(`${alvo.nome} ficou sem acesso`);
      // Depois de tirar o acesso (que volta com um clique); o cancelamento
      // nao volta, entao so acontece se o acesso de fato saiu.
      if (cancelar) {
        await cancelarAgendadasDe(alvo);
      }
    });
  };

  const vincular = (membro: MembroEquipe, valor: string) => {
    const professionalId = valor === DESLIGAR ? null : valor;
    const nomeDoProfissional = profissionais?.find(
      (profissional) => profissional.id === professionalId,
    )?.nome;
    executar(
      () =>
        vincularProfissionalAction({
          user_id: membro.userId,
          professional_id: professionalId,
        }),
      nomeDoProfissional
        ? `Agenda de ${nomeDoProfissional} ligada a ${membro.nome}`
        : `Vínculo de ${membro.nome} com a agenda desfeito`,
      "Não foi possível ligar ao profissional da agenda.",
    );
  };

  if (membros.length === 0) {
    return (
      <EmptyState
        compact
        icon={Users}
        title="Ninguém na equipe ainda"
        description="Convide a recepção por e-mail ou passe o código da clínica."
      />
    );
  }

  return (
    <>
      <ul className="divide-y divide-border">
        {membros.map((membro) => {
          const motivoPapel = motivo(membro, "papel");
          const motivoAcesso = motivo(membro, "acesso");
          const ehProfissional = membro.papel === "profissional";

          const seletor = (
            <Select
              value={membro.papel}
              onValueChange={(valor) =>
                valor === "leitura" && membro.papel !== "leitura" && clinicId
                  ? pedirLeitura(membro)
                  : mudarPapel(membro, valor)
              }
              disabled={motivoPapel !== null || pending}
            >
              <SelectTrigger
                className="h-10 w-44"
                aria-label={`Papel de ${membro.nome}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((opcao) => {
                  // Mesma trava da liberacao e do convite: o gestor ve a
                  // opcao, desabilitada, em vez de ser recusado depois. Na
                  // linha de quem ja e administrador o seletor inteiro fica
                  // travado, e o rotulo atual continua limpo.
                  const soAdmin =
                    opcao.value === "admin" &&
                    !ehAdmin &&
                    membro.papel !== "admin";
                  return (
                    <SelectItem
                      key={opcao.value}
                      value={opcao.value}
                      disabled={soAdmin}
                    >
                      {soAdmin
                        ? `${opcao.label} (só um administrador promove)`
                        : opcao.label}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          );

          const opcoes = opcoesDeProfissional(
            profissionais,
            membro.professionalId,
          );
          const motivoVinculo =
            motivoPapel ?? motivoSemProfissional(profissionais, opcoes);
          const seletorDeProfissional = ehProfissional ? (
            <Select
              value={membro.professionalId ?? ""}
              onValueChange={(valor) => vincular(membro, valor)}
              disabled={motivoVinculo !== null || pending}
            >
              <SelectTrigger
                className="h-10 w-56"
                aria-label={`Profissional da agenda de ${membro.nome}`}
              >
                <SelectValue placeholder="Profissional da agenda" />
              </SelectTrigger>
              <SelectContent>
                {opcoes.map((profissional) => (
                  <SelectItem key={profissional.id} value={profissional.id}>
                    {profissional.ativo
                      ? profissional.nome
                      : `${profissional.nome} (desativado)`}
                  </SelectItem>
                ))}
                {membro.professionalId ? (
                  <SelectItem value={DESLIGAR}>
                    Desligar do profissional
                  </SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          ) : null;

          const botao = (
            <Button
              variant="outline"
              className="h-10"
              disabled={motivoAcesso !== null || pending}
              onClick={() =>
                membro.ativo
                  ? abrirTirarAcesso(membro)
                  : executar(
                      () => reativarMembroAction({ user_id: membro.userId }),
                      `${membro.nome} voltou a ter acesso`,
                      "Não foi possível devolver o acesso.",
                    )
              }
            >
              {membro.ativo ? (
                <UserMinus className="size-4" />
              ) : (
                <UserPlus className="size-4" />
              )}
              {membro.ativo ? "Tirar acesso" : "Reativar"}
            </Button>
          );

          return (
            <li
              key={membro.userId}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3",
                !membro.ativo && "bg-surface-4",
              )}
            >
              <ContactAvatar name={membro.nome} phone="" size={30} />
              <span className="grid min-w-[12rem] flex-1 gap-0.5">
                <span className="truncate text-[13.5px] font-semibold text-text-strong">
                  {membro.nome}
                  {membro.userId === meuUserId ? (
                    <span className="font-normal text-text-secondary">
                      {" "}
                      (você)
                    </span>
                  ) : null}
                </span>
                <span className="truncate text-xs text-text-secondary">
                  {membro.email}
                </span>
              </span>

              {membro.ativo ? null : (
                <StatusChip size="sm" definition={ACCESS_LEVEL_STATUS.nada} />
              )}
              {ehProfissional && !membro.professionalId ? (
                <StatusChip size="sm" definition={SEM_VINCULO} />
              ) : null}

              <span className="flex flex-wrap items-center gap-2">
                {motivoPapel ? (
                  <DisabledWithHint hint={motivoPapel}>
                    {seletor}
                  </DisabledWithHint>
                ) : (
                  seletor
                )}
                {seletorDeProfissional ? (
                  motivoVinculo ? (
                    <DisabledWithHint hint={motivoVinculo}>
                      {seletorDeProfissional}
                    </DisabledWithHint>
                  ) : (
                    seletorDeProfissional
                  )
                ) : null}
                {motivoAcesso ? (
                  <DisabledWithHint hint={motivoAcesso}>
                    {botao}
                  </DisabledWithHint>
                ) : (
                  botao
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={confirmar !== null}
        onOpenChange={(aberto) => {
          if (!aberto) {
            fecharDialogos();
          }
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              Tirar o acesso de {confirmar?.nome ?? "esta pessoa"}?
            </DialogTitle>
            <DialogDescription>
              A pessoa perde o acesso à clínica na hora, inclusive às conversas
              de paciente. Nada é apagado: o histórico dela continua aqui e você
              pode devolver o acesso quando quiser.
            </DialogDescription>
          </DialogHeader>
          <AgendadasDaPessoa
            contagem={agendadas}
            cancelar={cancelarAgendadas}
            aoMarcar={setCancelarAgendadas}
            desabilitado={pending}
          />
          <DialogFooter>
            {/* "Voltar", e nao "Cancelar": a caixa acima ja fala em
                cancelar as mensagens, e os dois nomes iguais confundiriam. */}
            <Button variant="ghost" onClick={fecharDialogos}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              // Espera a contagem: confirmar antes dela pularia a escolha.
              disabled={pending || agendadas?.estado === "carregando"}
              onClick={confirmarDesativacao}
            >
              {pending ? "Tirando..." : "Tirar acesso"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={paraLeitura !== null}
        onOpenChange={(aberto) => {
          if (!aberto) {
            fecharDialogos();
          }
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              Trocar {paraLeitura?.nome ?? "esta pessoa"} para Somente leitura?
            </DialogTitle>
            <DialogDescription>{ROLE_DESCRIPTIONS.leitura}</DialogDescription>
          </DialogHeader>
          <AgendadasDaPessoa
            contagem={agendadas}
            cancelar={cancelarAgendadas}
            aoMarcar={setCancelarAgendadas}
            desabilitado={pending}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={fecharDialogos}>
              Voltar
            </Button>
            <Button disabled={pending} onClick={confirmarLeitura}>
              {pending ? "Trocando..." : "Trocar para Somente leitura"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
