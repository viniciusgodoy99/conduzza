"use client";

import { Check, Copy, Hourglass, RefreshCw, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import {
  motivoSemProfissional,
  opcoesDeProfissional,
  type ProfissionalDaAgenda,
} from "@/components/configuracoes/lista-equipe";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { ROLE_OPTIONS } from "@/lib/domain/permissions";

import {
  alternarCodigoAction,
  aprovarMembroAction,
  gerarNovoCodigoAction,
  recusarMembroAction,
} from "./actions";

export type Pendente = {
  userId: string;
  nome: string;
  email: string;
};

/**
 * Pedidos de entrada pelo codigo da clinica, no topo da aba de equipe. Cada
 * linha escolhe o papel e, para Profissional, o profissional da agenda que a
 * pessoa vai ser (achados 1, 31 e 120). Recusar apaga o pedido, entao pede
 * confirmacao (achados 121 e 127).
 */
export function PendentesList({
  pendentes,
  podeGerenciar,
  ehAdmin,
  dica,
  profissionais,
}: {
  pendentes: Pendente[];
  podeGerenciar: boolean;
  /** gestor libera colega, mas nao consegue liberar ninguem como administrador */
  ehAdmin: boolean;
  dica: string;
  /** nulo: a leitura dos profissionais falhou */
  profissionais: ProfissionalDaAgenda[] | null;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [papeis, setPapeis] = useState<Record<string, string>>({});
  const [vinculos, setVinculos] = useState<Record<string, string>>({});
  const [recusando, setRecusando] = useState<Pendente | null>(null);
  const [pending, startTransition] = useTransition();

  if (pendentes.length === 0) {
    return null;
  }

  const opcoes = opcoesDeProfissional(profissionais, null);
  const motivoSemOpcao = motivoSemProfissional(profissionais, opcoes);

  const liberar = (pessoa: Pendente) => {
    const papel = papeis[pessoa.userId] ?? "recepcao";
    const professionalId =
      papel === "profissional" ? (vinculos[pessoa.userId] ?? null) : null;
    setErro(null);
    startTransition(async () => {
      const resultado = await aprovarMembroAction(
        pessoa.userId,
        papel,
        professionalId,
      );
      if (!resultado.ok) {
        setErro(resultado.error ?? "Não foi possível liberar o acesso.");
        return;
      }
      toast.success(`${pessoa.nome} já pode usar o sistema`);
    });
  };

  const confirmarRecusa = () => {
    const alvo = recusando;
    if (!alvo) {
      return;
    }
    setErro(null);
    startTransition(async () => {
      const resultado = await recusarMembroAction(alvo.userId);
      setRecusando(null);
      if (!resultado.ok) {
        setErro(resultado.error ?? "Não foi possível recusar o pedido.");
        return;
      }
      toast.success(`Pedido de ${alvo.nome} recusado`);
    });
  };

  const titulo =
    pendentes.length === 1
      ? "1 pessoa aguardando liberação"
      : `${pendentes.length} pessoas aguardando liberação`;

  return (
    <Card>
      <Aviso
        tom="warning"
        icone={Hourglass}
        titulo={titulo}
        className="rounded-none"
      >
        Entraram com o código da clínica. Enquanto não forem liberadas, não veem
        nenhuma conversa de paciente.
      </Aviso>
      <ul className="divide-y divide-border">
        {pendentes.map((pessoa) => {
          const papel = papeis[pessoa.userId] ?? "recepcao";
          const seletorDePapel = (
            <Select
              value={papel}
              onValueChange={(valor) =>
                setPapeis((atual) => ({ ...atual, [pessoa.userId]: valor }))
              }
              disabled={!podeGerenciar || pending}
            >
              <SelectTrigger className="h-10 w-44" aria-label="Papel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((opcao) => {
                  const soAdmin = opcao.value === "admin" && !ehAdmin;
                  return (
                    <SelectItem
                      key={opcao.value}
                      value={opcao.value}
                      disabled={soAdmin}
                    >
                      {soAdmin
                        ? `${opcao.label} (só um administrador libera)`
                        : opcao.label}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          );
          // Opcional aqui: o vinculo tambem se faz depois, na lista da equipe.
          const seletorDeProfissional =
            papel === "profissional" ? (
              <Select
                value={vinculos[pessoa.userId] ?? ""}
                onValueChange={(valor) =>
                  setVinculos((atual) => ({
                    ...atual,
                    [pessoa.userId]: valor,
                  }))
                }
                disabled={!podeGerenciar || pending || motivoSemOpcao !== null}
              >
                <SelectTrigger
                  className="h-10 w-56"
                  aria-label={`Profissional da agenda de ${pessoa.nome}`}
                >
                  <SelectValue placeholder="Profissional da agenda" />
                </SelectTrigger>
                <SelectContent>
                  {opcoes.map((profissional) => (
                    <SelectItem key={profissional.id} value={profissional.id}>
                      {profissional.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null;

          const liberarBotao = (
            <Button
              variant="solid"
              disabled={!podeGerenciar || pending}
              onClick={() => liberar(pessoa)}
            >
              <Check className="size-4" />
              Liberar
            </Button>
          );
          const recusarBotao = (
            <Button
              variant="ghost"
              disabled={!podeGerenciar || pending}
              onClick={() => setRecusando(pessoa)}
            >
              <X className="size-4" />
              Recusar
            </Button>
          );

          return (
            <li
              key={pessoa.userId}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
            >
              <ContactAvatar name={pessoa.nome} phone="" size={30} />
              <span className="grid min-w-[12rem] flex-1 gap-0.5">
                <span className="truncate text-[13.5px] font-semibold text-text-strong">
                  {pessoa.nome}
                </span>
                <span className="truncate text-xs text-text-secondary">
                  {pessoa.email}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {podeGerenciar ? (
                  <>
                    {seletorDePapel}
                    {seletorDeProfissional && motivoSemOpcao ? (
                      <DisabledWithHint hint={motivoSemOpcao}>
                        {seletorDeProfissional}
                      </DisabledWithHint>
                    ) : (
                      seletorDeProfissional
                    )}
                    {liberarBotao}
                    {recusarBotao}
                  </>
                ) : (
                  <>
                    <DisabledWithHint hint={dica}>
                      {seletorDePapel}
                    </DisabledWithHint>
                    <DisabledWithHint hint={dica}>
                      {liberarBotao}
                    </DisabledWithHint>
                    <DisabledWithHint hint={dica}>
                      {recusarBotao}
                    </DisabledWithHint>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {erro ? (
        <div className="px-4 pb-4">
          <Aviso tom="alert" role="alert">
            {erro}
          </Aviso>
        </div>
      ) : null}

      <Dialog
        open={recusando !== null}
        onOpenChange={(aberto) => {
          if (!aberto) {
            setRecusando(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              Recusar o pedido de {recusando?.nome ?? "esta pessoa"}?
            </DialogTitle>
            <DialogDescription>
              O pedido some da lista e a pessoa continua sem acesso à clínica.
              Se for engano, convide por e-mail: com a conta que ela já tem, o
              acesso entra na hora.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRecusando(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={confirmarRecusa}
            >
              {pending ? "Recusando..." : "Recusar pedido"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * Codigo da clinica (achados 0 e 122): administrador e gestor leem, copiam,
 * giram e ligam ou desligam a entrada por codigo (decisao do dono de
 * 24/09/2026; policies e RPC na migration 20260925110000).
 */
export function CodigoAcesso({
  codigo,
  ativo,
  podeGerenciar,
  dica,
}: {
  /** nulo: a leitura falhou */
  codigo: string | null;
  ativo: boolean;
  podeGerenciar: boolean;
  dica: string;
}) {
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const executar = (
    task: () => Promise<{ ok: boolean; error?: string }>,
    sucesso: string,
  ) => {
    setErro(null);
    startTransition(async () => {
      const resultado = await task();
      if (!resultado.ok) {
        setErro(resultado.error ?? "Algo deu errado.");
        return;
      }
      toast.success(sucesso);
    });
  };

  const copiar = async () => {
    if (!codigo) {
      return;
    }
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setErro("Não foi possível copiar. Selecione o código e copie à mão.");
    }
  };

  const motivoCopiar = !codigo
    ? "O código não carregou"
    : !ativo
      ? "Ligue a entrada por código para passar o código adiante"
      : null;

  const botaoCopiar = (
    <Button
      variant="outline"
      disabled={motivoCopiar !== null}
      onClick={() => void copiar()}
    >
      <Copy className="size-4" />
      {copiado ? "Copiado" : "Copiar"}
    </Button>
  );
  const botaoGerar = (
    <Button
      variant="outline"
      disabled={!podeGerenciar || pending}
      onClick={() =>
        executar(
          gerarNovoCodigoAction,
          "Código novo gerado. O anterior parou de valer.",
        )
      }
    >
      <RefreshCw className="size-4" />
      Gerar novo
    </Button>
  );
  const chave = (
    <Switch
      id="allow-code"
      checked={ativo}
      disabled={!podeGerenciar || pending}
      onCheckedChange={(valor) =>
        executar(
          () => alternarCodigoAction(valor),
          valor ? "Entrada por código ligada" : "Entrada por código desligada",
        )
      }
    />
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Código da clínica</CardTitle>
        <CardDescription>
          Quem tem este código pode pedir entrada na clínica pelo cadastro. O
          acesso só abre depois que alguém da administração liberar.
        </CardDescription>
        <CardAction>
          <Label htmlFor="allow-code" className="text-[13px]">
            Aceitar entrada por código
          </Label>
          {podeGerenciar ? (
            chave
          ) : (
            <DisabledWithHint hint={dica}>{chave}</DisabledWithHint>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        {codigo === null ? (
          <Aviso tom="alert" role="alert">
            Não foi possível carregar o código da clínica. Recarregue a página.
          </Aviso>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {ativo && codigo ? (
            <span className="inline-flex h-11 items-center rounded-lg bg-surface-4 px-4 cz-num text-xl font-semibold tracking-[0.3em] text-text-strong">
              {codigo}
            </span>
          ) : (
            <span className="inline-flex h-11 items-center rounded-lg bg-surface-4 px-4 text-sm text-text-secondary">
              {codigo === null
                ? "Código indisponível"
                : "Entrada por código desligada"}
            </span>
          )}
          {motivoCopiar ? (
            <DisabledWithHint hint={motivoCopiar}>
              {botaoCopiar}
            </DisabledWithHint>
          ) : (
            botaoCopiar
          )}
          {podeGerenciar ? (
            botaoGerar
          ) : (
            <DisabledWithHint hint={dica}>{botaoGerar}</DisabledWithHint>
          )}
        </div>
        <p className="text-xs text-text-secondary">
          Gerar um código novo invalida o anterior na hora. Se o código vazar,
          use isso.
        </p>
        {erro ? (
          <Aviso tom="alert" role="alert">
            {erro}
          </Aviso>
        ) : null}
      </CardContent>
    </Card>
  );
}
