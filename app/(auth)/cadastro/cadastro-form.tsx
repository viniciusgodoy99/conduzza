"use client";

import {
  ArrowLeft,
  Building2,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Hourglass,
  LoaderCircle,
  MailCheck,
  OctagonAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useActionState } from "react";

import {
  reenviarConfirmacaoAction,
  type ActionState,
} from "@/app/(auth)/actions";
import { Aviso } from "@/components/shared/aviso";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import {
  cadastrarClinicaAction,
  cadastrarPorCodigoAction,
  conferirCodigoAction,
  type CadastroState,
  type ConferenciaDoCodigo,
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

const TITULO =
  "text-[24px] leading-[1.2] font-bold tracking-[-0.02em] text-text-strong";

function Cabecalho({
  titulo,
  descricao,
}: {
  titulo: string;
  descricao: string;
}) {
  return (
    <div className="grid gap-1.5">
      <h1 className={TITULO}>{titulo}</h1>
      <p className="text-[13.5px] text-text-secondary">{descricao}</p>
    </div>
  );
}

// Cartao de escolha do DS (docs/06 secao 5.13): ladrilho lime suave com o
// icone, titulo e descricao, seta a direita. Levanta 1px no hover.
function OpcaoDeCaminho({
  icone: Icone,
  titulo,
  descricao,
  onClick,
}: {
  icone: LucideIcon;
  titulo: string;
  descricao: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid min-h-[88px] grid-cols-[40px_1fr_16px] items-center gap-3 rounded-card border border-border bg-card p-4 text-left shadow-sm cz-transition hover:-translate-y-px hover:shadow-md motion-reduce:transform-none"
    >
      <span
        aria-hidden
        className="grid size-10 place-items-center rounded-xl bg-primary-soft"
      >
        <Icone className="size-5 text-primary-text" />
      </span>
      <span className="grid gap-1">
        <span className="text-sm leading-[1.3] font-bold text-text-strong">
          {titulo}
        </span>
        <span className="text-[12.5px] leading-[1.45] text-text-secondary">
          {descricao}
        </span>
      </span>
      <ChevronRight aria-hidden className="size-4 text-text-secondary" />
    </button>
  );
}

function EscolhaCaminho({
  onEscolher,
}: {
  onEscolher: (caminho: Caminho) => void;
}) {
  return (
    <div className="grid gap-5">
      <Cabecalho
        titulo="Criar conta"
        descricao="Você vai cadastrar uma clínica nova ou entrar numa que já existe?"
      />

      <div className="grid gap-3">
        <OpcaoDeCaminho
          icone={Building2}
          titulo="Cadastrar minha clínica"
          descricao="Você cria a clínica e vira administrador dela, com acesso a tudo e poder de convidar a equipe."
          onClick={() => onEscolher("clinica")}
        />
        <OpcaoDeCaminho
          icone={Users}
          titulo="Entrar com código da clínica"
          descricao="Para quem trabalha numa clínica já cadastrada. O acesso é liberado pelo administrador dela."
          onClick={() => onEscolher("codigo")}
        />
      </div>

      <p className="text-[13.5px] text-text-secondary">
        Já tem conta?{" "}
        <Link
          href="/login"
          className="inline-flex min-h-10 items-center rounded-sm font-semibold text-primary-text underline-offset-2 hover:underline"
        >
          Entrar
        </Link>
      </p>
    </div>
  );
}

const inicialDoReenvio: ActionState = {};

// Tela "Conta criada" (achado 118): deixa claro que o login so funciona
// depois do link e oferece o reenvio ali mesmo. O reenvio e o botao
// principal; ir para o login fica como secundario, porque sem o link ele
// ainda nao resolve.
function Confirmacao({ email, tipo }: { email: string; tipo: string }) {
  const [reenvio, reenviarAction, reenviando] = useActionState(
    reenviarConfirmacaoAction,
    inicialDoReenvio,
  );

  return (
    <div className="grid gap-5">
      <div className="grid justify-items-center gap-3 text-center">
        <span
          aria-hidden
          className="grid size-[52px] place-items-center rounded-card bg-primary-soft"
        >
          <MailCheck className="size-6 text-primary-text" />
        </span>
        <h1 className={TITULO}>Conta criada</h1>
        <p className="text-[13.5px] text-text-secondary">
          Enviamos um link de confirmação para{" "}
          <strong className="font-semibold break-all text-text-strong">
            {email}
          </strong>
          .
        </p>
      </div>
      <Aviso tom="info" titulo="O login só funciona depois do link">
        Abra o e-mail de confirmação e use o link dele para ativar a conta. Se
        não chegar em alguns minutos, confira a caixa de spam ou peça outro
        abaixo.
      </Aviso>
      {tipo === "codigo" ? (
        <Aviso
          tom="warning"
          icone={Hourglass}
          titulo="Acesso aguardando liberação"
        >
          Depois de confirmar o e-mail, um administrador da clínica precisa
          liberar seu acesso. Até lá você entra no sistema, mas ainda não vê as
          conversas dos pacientes.
        </Aviso>
      ) : null}
      <form action={reenviarAction} className="grid gap-3">
        <input type="hidden" name="email" value={email} />
        <Button
          type="submit"
          size="lg"
          disabled={reenviando}
          className="w-full"
        >
          {reenviando ? (
            <>
              <LoaderCircle aria-hidden className="animate-spin" />
              Reenviando...
            </>
          ) : (
            "Reenviar e-mail de confirmação"
          )}
        </Button>
        {reenvio.success ? (
          <Aviso tom="success">{reenvio.success}</Aviso>
        ) : null}
        {reenvio.error ? (
          <Aviso tom="alert" role="alert">
            {reenvio.error}
          </Aviso>
        ) : null}
      </form>
      <Button asChild variant="outline" size="lg" className="w-full">
        <Link href="/login">Ir para o login</Link>
      </Button>
    </div>
  );
}

function Voltar({ onVoltar }: { onVoltar: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onVoltar}
      className="-ml-3 w-fit text-text-secondary"
    >
      <ArrowLeft aria-hidden />
      Voltar
    </Button>
  );
}

function CamposPessoais() {
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="nome">Seu nome</Label>
        <Input
          id="nome"
          name="nome"
          autoComplete="name"
          required
          className="h-11"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="voce@suaclinica.com.br"
          className="h-11"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="password">Senha</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          aria-describedby="password-dica"
          className="h-11"
        />
        <p id="password-dica" className="text-xs text-text-secondary">
          Pelo menos 8 caracteres.
        </p>
      </div>
    </>
  );
}

function ErroDoCadastro({ mensagem }: { mensagem?: string }) {
  if (!mensagem) {
    return null;
  }
  return (
    <Aviso tom="alert" role="alert">
      {mensagem}
    </Aviso>
  );
}

function BotaoDeEnvio({
  pendente,
  desabilitado = false,
  rotulo,
  rotuloPendente,
}: {
  pendente: boolean;
  desabilitado?: boolean;
  rotulo: string;
  rotuloPendente: string;
}) {
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pendente || desabilitado}
      className="w-full"
    >
      {pendente ? (
        <>
          <LoaderCircle aria-hidden className="animate-spin" />
          {rotuloPendente}
        </>
      ) : (
        rotulo
      )}
    </Button>
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
    <form action={formAction} className="grid gap-5">
      <div className="grid gap-2">
        <Voltar onVoltar={onVoltar} />
        <Cabecalho
          titulo="Cadastrar minha clínica"
          descricao="Você fica como administrador e depois convida a equipe."
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="nomeClinica">Nome da clínica</Label>
        <Input
          id="nomeClinica"
          name="nomeClinica"
          autoComplete="organization"
          required
          aria-describedby="nomeClinica-dica"
          className="h-11"
        />
        <p id="nomeClinica-dica" className="text-xs text-text-secondary">
          É assim que o paciente vai ver nas mensagens automáticas.
        </p>
      </div>
      <CamposPessoais />
      <ErroDoCadastro mensagem={state.error} />
      <BotaoDeEnvio
        pendente={pending}
        rotulo="Criar clínica e conta"
        rotuloPendente="Criando..."
      />
    </form>
  );
}

function FormCodigo({ onVoltar }: { onVoltar: () => void }) {
  const [state, formAction, pending] = useActionState(
    cadastrarPorCodigoAction,
    inicial,
  );
  const [codigo, setCodigo] = useState("");
  // Resultado da ultima conferencia, preso ao codigo conferido: se a pessoa
  // mudou o codigo depois, o resultado nao vale mais e nao aparece.
  const [conferencia, setConferencia] = useState<{
    codigo: string;
    resultado: ConferenciaDoCodigo;
  } | null>(null);
  const [conferindo, startConferencia] = useTransition();
  // Descarta respostas fora de ordem: sem isto, um código antigo pode
  // sobrescrever a conferência do código atual.
  const consulta = useRef(0);

  useEffect(() => {
    const alvo = codigo.trim().toUpperCase();
    if (alvo.length < 4) {
      return;
    }
    const versao = ++consulta.current;
    const timer = setTimeout(() => {
      startConferencia(async () => {
        let resultado: ConferenciaDoCodigo;
        try {
          resultado = await conferirCodigoAction(alvo);
        } catch {
          // Falha de rede na conferencia nao pode prender a pessoa: nao da
          // para dizer se o codigo e valido, entao deixa seguir e o cadastro
          // confere de novo antes de criar a conta.
          resultado = { situacao: "falhou" };
        }
        if (versao !== consulta.current) {
          return;
        }
        setConferencia({ codigo: alvo, resultado });
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [codigo]);

  if (state.success && state.email) {
    return <Confirmacao email={state.email} tipo="codigo" />;
  }

  const alvo = codigo.trim().toUpperCase();
  const atual =
    alvo.length >= 4 && conferencia?.codigo === alvo
      ? conferencia.resultado
      : null;
  const podeEnviar =
    atual?.situacao === "encontrado" || atual?.situacao === "falhou";

  return (
    <form action={formAction} className="grid gap-5">
      <div className="grid gap-2">
        <Voltar onVoltar={onVoltar} />
        <Cabecalho
          titulo="Entrar com código"
          descricao="Peça o código ao administrador da clínica."
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="codigo">Código da clínica</Label>
        <Input
          id="codigo"
          name="codigo"
          required
          autoComplete="off"
          spellCheck={false}
          value={codigo}
          onChange={(event) => setCodigo(event.target.value.toUpperCase())}
          placeholder="Ex: A1B2C3D4"
          aria-describedby="codigo-situacao"
          aria-invalid={atual?.situacao === "nao_encontrado" || undefined}
          className="h-11 cz-num tracking-[0.2em] uppercase"
        />
        {/* Situacao do codigo em 3 camadas: icone de forma propria, texto e
            cor. A regiao fica sempre montada para o leitor de tela anunciar
            cada troca. */}
        <div id="codigo-situacao" aria-live="polite" className="min-h-4">
          {conferindo && alvo.length >= 4 ? (
            <SituacaoDoCodigo
              icone={LoaderCircle}
              girando
              className="text-text-secondary"
            >
              Conferindo o código
            </SituacaoDoCodigo>
          ) : atual?.situacao === "encontrado" ? (
            <SituacaoDoCodigo icone={CircleCheck} className="text-success-text">
              Você vai pedir entrada em:{" "}
              <strong className="font-bold">{atual.nome}</strong>
            </SituacaoDoCodigo>
          ) : atual?.situacao === "falhou" ? (
            <SituacaoDoCodigo icone={CircleAlert} className="text-warning-text">
              Não foi possível conferir o código agora. Você pode continuar: ele
              é conferido de novo quando a conta for criada.
            </SituacaoDoCodigo>
          ) : atual?.situacao === "nao_encontrado" ? (
            <SituacaoDoCodigo icone={OctagonAlert} className="text-alert-text">
              Código não encontrado ou desativado.
            </SituacaoDoCodigo>
          ) : null}
        </div>
      </div>
      <CamposPessoais />
      <ErroDoCadastro mensagem={state.error} />
      <BotaoDeEnvio
        pendente={pending}
        desabilitado={!podeEnviar}
        rotulo="Pedir entrada na clínica"
        rotuloPendente="Enviando..."
      />
    </form>
  );
}

function SituacaoDoCodigo({
  icone: Icone,
  girando = false,
  className,
  children,
}: {
  icone: LucideIcon;
  girando?: boolean;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-xs leading-[1.4] font-medium",
        className,
      )}
    >
      <Icone
        aria-hidden
        className={cn("mt-px size-3.5 shrink-0", girando && "animate-spin")}
      />
      <span>{children}</span>
    </p>
  );
}
