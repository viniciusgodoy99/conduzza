"use client";

import {
  ArrowLeft,
  Building2,
  CircleCheck,
  Loader2,
  MailCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import {
  cadastrarClinicaAction,
  cadastrarPorCodigoAction,
  conferirCodigoAction,
  type CadastroState,
} from "./actions";

// Bifurcação explícita antes do formulário: os dois caminhos são diferentes
// em consequência (um cria a clínica e vira administrador, o outro pede
// entrada e aguarda aprovação), então a escolha vem antes de digitar nada.

type Caminho = "escolha" | "clinica" | "codigo";

const inicial: CadastroState = {};

export function CadastroForm({ tipoInicial }: { tipoInicial?: string }) {
  const [caminho, setCaminho] = useState<Caminho>(
    tipoInicial === "clinica" || tipoInicial === "codigo"
      ? tipoInicial
      : "escolha",
  );

  if (caminho === "escolha") {
    return <EscolhaCaminho onEscolher={setCaminho} />;
  }
  if (caminho === "clinica") {
    return <FormClinica onVoltar={() => setCaminho("escolha")} />;
  }
  return <FormCodigo onVoltar={() => setCaminho("escolha")} />;
}

function EscolhaCaminho({
  onEscolher,
}: {
  onEscolher: (caminho: Caminho) => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h1 className="text-[22px] font-semibold">Criar conta</h1>
        <p className="text-sm text-text-secondary">
          Você vai cadastrar uma clínica nova ou entrar numa que já existe?
        </p>
      </div>

      <button
        type="button"
        onClick={() => onEscolher("clinica")}
        className="border-border-strong grid gap-1 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Building2 strokeWidth={1.5} className="size-4 text-primary" />
          Cadastrar minha clínica
        </span>
        <span className="text-[12.5px] text-text-secondary">
          Você cria a clínica e vira administrador dela, com acesso a tudo e
          poder de convidar a equipe.
        </span>
      </button>

      <button
        type="button"
        onClick={() => onEscolher("codigo")}
        className="border-border-strong grid gap-1 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Users strokeWidth={1.5} className="size-4 text-primary" />
          Entrar com código da clínica
        </span>
        <span className="text-[12.5px] text-text-secondary">
          Para quem trabalha numa clínica já cadastrada. O acesso é liberado
          pelo administrador dela.
        </span>
      </button>

      <p className="text-sm text-text-secondary">
        Já tem conta?{" "}
        <Link href="/login" className="underline-offset-4 hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}

function Confirmacao({ email, tipo }: { email: string; tipo: string }) {
  return (
    <div className="grid gap-4 text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
        <MailCheck strokeWidth={1.5} className="size-6 text-primary" />
      </span>
      <div className="grid gap-1">
        <h1 className="text-[22px] font-semibold">Conta criada</h1>
        <p className="text-sm text-text-secondary">
          Enviamos um link de confirmação para <strong>{email}</strong>. Abra o
          link para ativar sua conta.
        </p>
      </div>
      {tipo === "codigo" ? (
        <p className="rounded-lg border p-3 text-[12.5px] [color:var(--warning-text)] text-text-secondary [background:var(--warning-bg)]">
          Depois de confirmar o e-mail, um administrador da clínica precisa
          liberar seu acesso. Até lá você entra no sistema, mas ainda não vê as
          conversas dos pacientes.
        </p>
      ) : null}
      <Button asChild className="h-11">
        <Link href="/login">Ir para o login</Link>
      </Button>
    </div>
  );
}

function Voltar({ onVoltar }: { onVoltar: () => void }) {
  return (
    <button
      type="button"
      onClick={onVoltar}
      className="inline-flex w-fit items-center gap-1.5 text-sm text-text-secondary hover:text-foreground"
    >
      <ArrowLeft strokeWidth={1.5} className="size-4" />
      Voltar
    </button>
  );
}

function CamposPessoais() {
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="nome">Seu nome</Label>
        <Input id="nome" name="nome" required className="h-11" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="h-11"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Senha</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="h-11"
        />
        <p className="text-xs text-text-tertiary">Pelo menos 8 caracteres.</p>
      </div>
    </>
  );
}

function FormClinica({ onVoltar }: { onVoltar: () => void }) {
  const [state, formAction, pending] = useActionState(
    cadastrarClinicaAction,
    inicial,
  );

  if (state.success && state.email) {
    return <Confirmacao email={state.email} tipo="clinica" />;
  }

  return (
    <form action={formAction} className="grid gap-4">
      <Voltar onVoltar={onVoltar} />
      <div className="grid gap-1">
        <h1 className="text-[22px] font-semibold">Cadastrar minha clínica</h1>
        <p className="text-sm text-text-secondary">
          Você fica como administrador e depois convida a equipe.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="nomeClinica">Nome da clínica</Label>
        <Input id="nomeClinica" name="nomeClinica" required className="h-11" />
      </div>
      <CamposPessoais />
      {state.error ? (
        <p role="alert" className="text-sm [color:var(--alert-text)]">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? "Criando..." : "Criar clínica e conta"}
      </Button>
    </form>
  );
}

function FormCodigo({ onVoltar }: { onVoltar: () => void }) {
  const [state, formAction, pending] = useActionState(
    cadastrarPorCodigoAction,
    inicial,
  );
  const [codigo, setCodigo] = useState("");
  const [clinica, setClinica] = useState<{
    codigo: string;
    nome: string;
  } | null>(null);
  // Falha de rede na conferencia nao pode prender a pessoa: sem isto o botao
  // ficava desabilitado para sempre e a tela acusava o codigo de invalido.
  const [falhouConferencia, setFalhouConferencia] = useState(false);
  const [conferindo, startConferencia] = useTransition();
  // Descarta respostas fora de ordem: sem isto, um código antigo pode
  // sobrescrever a conferência do código atual.
  const consulta = useRef(0);

  useEffect(() => {
    const alvo = codigo.trim().toUpperCase();
    if (alvo.length < 4) {
      setClinica(null);
      return;
    }
    const versao = ++consulta.current;
    const timer = setTimeout(() => {
      startConferencia(async () => {
        try {
          const encontrada = await conferirCodigoAction(alvo);
          if (versao !== consulta.current) {
            return;
          }
          setFalhouConferencia(false);
          setClinica(
            encontrada ? { codigo: alvo, nome: encontrada.nome } : null,
          );
        } catch {
          if (versao !== consulta.current) {
            return;
          }
          // Nao da para dizer se o codigo e valido: deixa seguir e o gatilho
          // do banco decide, com mensagem propria.
          setFalhouConferencia(true);
          setClinica(null);
        }
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [codigo]);

  if (state.success && state.email) {
    return <Confirmacao email={state.email} tipo="codigo" />;
  }

  const codigoConferido =
    clinica !== null && clinica.codigo === codigo.trim().toUpperCase();

  return (
    <form action={formAction} className="grid gap-4">
      <Voltar onVoltar={onVoltar} />
      <div className="grid gap-1">
        <h1 className="text-[22px] font-semibold">Entrar com código</h1>
        <p className="text-sm text-text-secondary">
          Peça o código ao administrador da clínica.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="codigo">Código da clínica</Label>
        <Input
          id="codigo"
          name="codigo"
          required
          value={codigo}
          onChange={(event) => setCodigo(event.target.value.toUpperCase())}
          placeholder="Ex: A1B2C3D4"
          className={cn(
            "h-11 font-mono tracking-[0.2em] uppercase",
            codigoConferido && "[border-color:var(--success)]",
          )}
        />
        {conferindo ? (
          <p className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <Loader2 strokeWidth={1.5} className="size-3 animate-spin" />
            Conferindo o código
          </p>
        ) : codigoConferido ? (
          <p className="flex items-center gap-1.5 text-xs [color:var(--success-text)]">
            <CircleCheck strokeWidth={1.5} className="size-3.5" />
            Você vai pedir entrada em: <strong>{clinica.nome}</strong>
          </p>
        ) : falhouConferencia ? (
          <p className="text-xs [color:var(--warning-text)]">
            Não conseguimos conferir o código agora. Você pode continuar: nós
            validamos ao criar a conta.
          </p>
        ) : codigo.trim().length >= 4 ? (
          <p className="text-xs [color:var(--alert-text)]">
            Código não encontrado ou desativado.
          </p>
        ) : null}
      </div>
      <CamposPessoais />
      {state.error ? (
        <p role="alert" className="text-sm [color:var(--alert-text)]">
          {state.error}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={pending || (!codigoConferido && !falhouConferencia)}
        className="h-11"
      >
        {pending ? "Enviando..." : "Pedir entrada na clínica"}
      </Button>
    </form>
  );
}
