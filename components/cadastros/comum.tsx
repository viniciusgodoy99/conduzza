"use client";

import {
  CalendarDays,
  Eye,
  Pencil,
  Umbrella,
  Zap,
  ZapOff,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";

import { ContactAvatar } from "@/components/atendimento/contact-avatar";
import { Aviso } from "@/components/shared/aviso";
import { EmptyState } from "@/components/shared/empty-state";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { RECORD_STATUS, type StatusDefinition } from "@/lib/design/status";
import { cn } from "@/lib/utils";
import { formatarCentavos, lerReais } from "@/lib/utils/moeda";

// Pecas compartilhadas pelas abas de Cadastros, no desenho do design system
// Conduzza (docs/06 secao 5.11).

// Situacoes proprias de Cadastros, nas 3 camadas (icone, rotulo e cor). Cada
// icone e EXCLUSIVO deste sentido e desta cor em qualquer tela, e esta
// registrado na tabela de reservados (lib/design/status.ts e docs/06 secao
// 4.6), achados 9 e 16:
// - Coberto: Umbrella info. A familia Shield e da autorizacao para receber
//   mensagens (ShieldCheck success, ShieldX alert, ShieldOff neutral) e o
//   ShieldPlus e o botao "Registrar autorizacao" de Confirmacoes.
// - Impede encaixe: ZapOff warning, o par do Zap (encaixe, sempre neutro na
//   Agenda). CalendarX2 e so do pacote vencido (alert) na ficha.
export const COBERTO_PELO_CONVENIO: StatusDefinition = {
  label: "Coberto",
  tone: "info",
  icon: Umbrella,
};

export const ENCAIXE_DO_BLOQUEIO: Record<
  "impede" | "permite",
  StatusDefinition
> = {
  impede: { label: "Impede encaixe", tone: "warning", icon: ZapOff },
  permite: { label: "Permite encaixe", tone: "neutral", icon: Zap },
};

// Acao de escrita: visivel sempre; desabilitada com dica quando o papel nao
// edita (regra do brief: esconder confunde, desabilitar explica). Alvo de
// toque de 40px (h-10) em qualquer tamanho. O padrao e o primario: o "Novo X"
// e o unico lime da aba; o resto usa outline, ghost ou destructive.
export function BotaoProtegido({
  podeEditar,
  dica,
  onClick,
  children,
  variant = "default",
  size = "default",
  className,
  disabled = false,
}: {
  podeEditar: boolean;
  dica: string;
  onClick: () => void;
  children: React.ReactNode;
  variant?: "default" | "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "lg";
  className?: string;
  disabled?: boolean;
}) {
  const classe = cn("h-10", className);
  if (podeEditar) {
    return (
      <Button
        variant={variant}
        size={size}
        onClick={onClick}
        className={classe}
        disabled={disabled}
      >
        {children}
      </Button>
    );
  }
  return (
    <DisabledWithHint hint={dica}>
      <Button variant={variant} size={size} disabled className={classe}>
        {children}
      </Button>
    </DisabledWithHint>
  );
}

// Acoes da linha de uma tabela de Cadastros. Quem edita ve o lapis. Quem so
// ve (achado 41) ganha "Ver detalhes", que abre o mesmo modal em modo
// leitura, e o lapis continua visivel e desabilitado com a dica do papel.
export function AcoesDaLinha({
  podeEditar,
  dica,
  nome,
  aoEditar,
  aoVerDetalhes,
}: {
  podeEditar: boolean;
  dica: string;
  nome: string;
  aoEditar: () => void;
  aoVerDetalhes?: () => void;
}) {
  if (podeEditar) {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={aoEditar}
        aria-label={`Editar ${nome}`}
      >
        <Pencil aria-hidden />
      </Button>
    );
  }
  return (
    <div className="flex items-center justify-end gap-1">
      {aoVerDetalhes ? (
        <Button
          variant="ghost"
          onClick={aoVerDetalhes}
          aria-label={`Ver detalhes de ${nome}`}
        >
          <Eye aria-hidden /> Ver detalhes
        </Button>
      ) : null}
      <DisabledWithHint hint={dica}>
        <Button
          variant="ghost"
          size="icon"
          disabled
          aria-label={`Editar ${nome}`}
        >
          <Pencil aria-hidden />
        </Button>
      </DisabledWithHint>
    </div>
  );
}

// Modal em modo leitura: rotulo e valor em texto corrido, sem truncar
// (preparo e observacoes podem ser longos e a recepcao responde por eles).
export function DetalheSomenteLeitura({
  itens,
}: {
  itens: { rotulo: string; valor: React.ReactNode }[];
}) {
  return (
    <dl className="grid">
      {itens.map((item) => (
        <div
          key={item.rotulo}
          className="grid gap-1 border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
        >
          <dt className="text-xs font-semibold text-text-secondary">
            {item.rotulo}
          </dt>
          <dd className="text-[13.5px] break-words whitespace-pre-wrap text-foreground">
            {item.valor === null ||
            item.valor === undefined ||
            item.valor === "" ? (
              <span className="text-text-secondary">Não informado</span>
            ) : (
              item.valor
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// Larguras do modal de cadastro (decisao do dono de 29/09/2026: modal
// central em todos os cadastros, no lugar do painel lateral). A larga e para
// o formulario com tabela dentro (jornada do profissional, quem faz o
// procedimento).
export const LARGURA_DO_MODAL = {
  normal: "sm:max-w-[520px]",
  larga: "sm:max-w-[640px]",
} as const;

// Modal central de cadastro (criar, editar ou ver), na receita do Modal do
// design system: cabecalho fixo com titulo e descricao, corpo que rola por
// dentro (o modal inteiro vai ate 86vh), avisos e erro fixos logo acima do
// rodape (sempre a vista, mesmo com o formulario comprido) e rodape fixo com
// Cancelar e Salvar. Foco preso no modal, Esc e o X fecham (Radix Dialog). O
// nome continua PainelDeCadastro para os chamadores nao mudarem.
export function PainelDeCadastro({
  aberto,
  aoMudarAberto,
  titulo,
  descricao,
  larga = false,
  erro,
  aviso,
  rodape,
  children,
}: {
  aberto: boolean;
  aoMudarAberto: (aberto: boolean) => void;
  titulo: string;
  descricao?: string;
  /** 640px no lugar de 520px (formulario com tabela dentro) */
  larga?: boolean;
  erro?: string | null;
  /** Pergunta de confirmacao que substitui o Salvar enquanto esta aberta */
  aviso?: React.ReactNode;
  rodape?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={aberto} onOpenChange={aoMudarAberto}>
      <DialogContent
        // O Dialog padrao rola inteiro; aqui so o corpo rola, para cabecalho,
        // aviso e rodape ficarem parados (flex em coluna, sem padding proprio).
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          larga ? LARGURA_DO_MODAL.larga : LARGURA_DO_MODAL.normal,
        )}
        // Sem descricao, o modal nao aponta para uma que nao existe.
        {...(descricao ? {} : { "aria-describedby": undefined })}
      >
        <DialogHeader className="shrink-0 px-5 pt-[18px] pr-14 pb-3.5">
          <DialogTitle>{titulo}</DialogTitle>
          {descricao ? (
            <DialogDescription>{descricao}</DialogDescription>
          ) : null}
        </DialogHeader>
        {/* pt-1: o contorno de foco (2px com folga de 2px) do primeiro campo
            nao e cortado pela rolagem do corpo. */}
        <div className="cz-scroll min-h-0 flex-auto overflow-y-auto px-5 pt-1 pb-5">
          {children}
        </div>
        {aviso || erro ? (
          <div className="grid shrink-0 gap-3 px-5 pb-4">
            {aviso}
            {erro ? (
              <Aviso tom="alert" role="alert">
                {erro}
              </Aviso>
            ) : null}
          </div>
        ) : null}
        {rodape ? (
          <DialogFooter className="m-0 shrink-0">{rodape}</DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// Rodape padrao dos formularios: Cancelar (ghost) e Salvar (primario).
export function RodapeDeSalvar({
  salvando,
  aoCancelar,
  aoSalvar,
  rotuloSalvar = "Salvar",
  idDoSalvar,
}: {
  salvando: boolean;
  aoCancelar: () => void;
  aoSalvar: () => void;
  rotuloSalvar?: string;
  /** Para o foco voltar ao Salvar (useFocoDeVoltaAoSalvar) */
  idDoSalvar?: string;
}) {
  return (
    <>
      <Button variant="ghost" onClick={aoCancelar}>
        Cancelar
      </Button>
      <Button id={idDoSalvar} onClick={aoSalvar} disabled={salvando}>
        {salvando ? "Salvando..." : rotuloSalvar}
      </Button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Foco do teclado nas confirmacoes que tomam o lugar do Salvar (achado de
// 02/10/2026). O botao que tinha o foco sai da tela junto (o Salvar, quando
// o aviso entra; o "mesmo assim", quando o aviso sai depois de gravar) e o
// FocusScope do Radix joga o foco para o proprio modal, a dezenas de Tabs da
// confirmacao. Estas pecas levam o foco para onde a pessoa precisa dele, e
// so quando ele se perdeu: quem ja esta num campo ou botao fica onde esta.
// ---------------------------------------------------------------------------

/**
 * O foco se perdeu: esta no body, num elemento que saiu da pagina ou num
 * elemento fora da ordem do Tab (o modal do Radix e os alvos de foco tem
 * tabIndex -1). Campo, botao, link e caixa de marcar tem tabIndex 0.
 */
export function focoPerdido(): boolean {
  if (typeof document === "undefined" || typeof HTMLElement === "undefined") {
    return false;
  }
  const ativo = document.activeElement;
  return (
    !(ativo instanceof HTMLElement) ||
    ativo === document.body ||
    !ativo.isConnected ||
    ativo.tabIndex < 0
  );
}

/**
 * Ref de um alvo de foco (com tabIndex -1) que recebe o foco quando aparece,
 * se o foco estiver perdido. So na montagem: um aviso que ja estava na tela
 * nao rouba o foco de quem voltou a editar. Para um aviso novo tomar o lugar
 * de outro do mesmo tipo, quem monta troca a `key`.
 */
export function useFocoAoAparecer<T extends HTMLElement>() {
  const alvo = useRef<T>(null);
  useEffect(() => {
    if (focoPerdido()) {
      alvo.current?.focus();
    }
  }, []);
  return alvo;
}

/**
 * Devolve o foco ao Salvar do rodape quando a confirmacao sai depois de
 * gravar e o modal continua aberto (erro, cadastro mudou, gravacao parcial):
 * o botao que tinha o foco saiu com o aviso. Quem chama marca com
 * `devolver()` no mesmo passo em que tira o aviso. A volta acontece quando o
 * Salvar esta na tela e habilitado (sem aviso e sem gravacao em curso) e so
 * se o foco estiver perdido. Aviso novo esquece o pedido (o foco vai para
 * ele), e quem fecha ou reabre o modal chama `esquecer()`.
 */
export function useFocoDeVoltaAoSalvar(
  idDoSalvar: string,
  { avisoAberto, salvando }: { avisoAberto: boolean; salvando: boolean },
) {
  const pendente = useRef(false);
  useEffect(() => {
    if (avisoAberto) {
      pendente.current = false;
      return;
    }
    if (salvando || !pendente.current) {
      return;
    }
    pendente.current = false;
    const botao = document.getElementById(idDoSalvar);
    if (
      botao instanceof HTMLButtonElement &&
      !botao.disabled &&
      focoPerdido()
    ) {
      botao.focus();
    }
  }, [idDoSalvar, avisoAberto, salvando]);
  return useMemo(
    () => ({
      devolver: () => {
        pendente.current = true;
      },
      esquecer: () => {
        pendente.current = false;
      },
    }),
    [],
  );
}

// Vazio de uma aba: dentro de um cartao, com a acao em outline (o lime da
// aba e o "Novo X" do topo). Quem nao edita ve a acao desabilitada com dica.
export function VazioDaAba({
  icon,
  titulo,
  descricao,
  acao,
  podeEditar,
  dica,
}: {
  icon: LucideIcon;
  titulo: string;
  descricao: string;
  acao?: {
    rotulo: string;
    onClick: () => void;
    variant?: "default" | "outline";
  };
  podeEditar: boolean;
  dica: string;
}) {
  return (
    <Card>
      <EmptyState icon={icon} title={titulo} description={descricao}>
        {acao ? (
          <BotaoProtegido
            podeEditar={podeEditar}
            dica={dica}
            variant={acao.variant ?? "outline"}
            onClick={acao.onClick}
          >
            {acao.rotulo}
          </BotaoProtegido>
        ) : null}
      </EmptyState>
    </Card>
  );
}

// Avatar do profissional com o ponto da cor da agenda. A cor e dado da
// clinica (escolhida no cadastro), por isso vai inline: e a unica cor fora
// dos tokens na tela.
export function AvatarDoProfissional({
  nome,
  cor,
  tamanho = 30,
}: {
  nome: string;
  cor: string | null;
  tamanho?: number;
}) {
  return (
    <span aria-hidden className="relative inline-flex shrink-0">
      <ContactAvatar name={nome} phone="" size={tamanho} />
      {cor ? (
        <span
          className="absolute -right-px -bottom-px size-2.5 rounded-full border-2 border-card"
          style={{ backgroundColor: cor }}
        />
      ) : null}
    </span>
  );
}

// Opcao de formulario com Salvar: Checkbox com rotulo e descricao (docs/06,
// C31). Switch fica so para o que vale na hora (a IA do vinculo).
export function CampoDeMarcar({
  id,
  rotulo,
  descricao,
  marcado,
  aoMudar,
}: {
  id: string;
  rotulo: string;
  descricao?: string;
  marcado: boolean;
  aoMudar: (marcado: boolean) => void;
}) {
  const idDaDescricao = descricao ? `${id}-descricao` : undefined;
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        checked={marcado}
        onCheckedChange={(valor) => aoMudar(valor === true)}
        aria-describedby={idDaDescricao}
        className="mt-px"
      />
      <div className="grid gap-1">
        <Label htmlFor={id} className="text-[13.5px] leading-[1.3]">
          {rotulo}
        </Label>
        {descricao ? (
          <p id={idDaDescricao} className="text-xs text-text-secondary">
            {descricao}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// Aviso de consultas ja marcadas no periodo afetado (achado 37): bloqueio e
// desativacao nao desmarcam nada, entao a tela conta, avisa e so segue com
// confirmacao explicita. Datas no fuso da clinica (regra 3.6). O `titulo`
// troca so a frase em negrito (tirar convenio nao e "neste periodo"); sem
// ele, vale o texto de sempre.
//
// Sem consulta (tirar convenio que so tira o profissional de um
// procedimento, D3 de 02/10/2026), ficam so o titulo e a confirmacao: o
// corpo ("as consultas continuam valendo...") falaria do que nao existe, e
// o "Abrir a Agenda" sairia de Cadastros perdendo a edicao sem motivo. A
// confirmacao, sozinha, vai em outline. Cancelar continua no rodape.
//
// Foco do teclado: o aviso entra no lugar do Salvar, que sai com o foco.
// O proprio aviso recebe o foco (fora da ordem do Tab): o proximo Tab cai na
// primeira acao e um Enter repetido nao confirma nada sem leitura. Quando a
// confirmacao termina com o aviso ainda na tela (erro), o foco volta para
// ela.
export function AvisoDeConsultas({
  consultas,
  primeira,
  timezone,
  rotuloConfirmar,
  confirmando,
  aoConfirmar,
  titulo,
  id,
}: {
  consultas: number;
  primeira: string | null;
  timezone: string;
  rotuloConfirmar: string;
  confirmando: boolean;
  aoConfirmar: () => void;
  /** Substitui "Há N consultas marcadas neste período. Remarque ou cancele." */
  titulo?: React.ReactNode;
  /** Id do alvo de foco (o contorno do aviso) */
  id?: string;
}) {
  const temConsultas = consultas > 0;
  const alvo = useFocoAoAparecer<HTMLDivElement>();
  const botaoConfirmar = useRef<HTMLButtonElement>(null);
  const confirmandoAntes = useRef(confirmando);
  useEffect(() => {
    // O botao fica desabilitado enquanto grava e perde o foco.
    if (confirmandoAntes.current && !confirmando && focoPerdido()) {
      botaoConfirmar.current?.focus();
    }
    confirmandoAntes.current = confirmando;
  }, [confirmando]);
  const quando = primeira
    ? `${new Date(primeira).toLocaleDateString("pt-BR", {
        timeZone: timezone,
        day: "2-digit",
        month: "2-digit",
      })} às ${new Date(primeira).toLocaleTimeString("pt-BR", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : null;
  // Atencao e CircleAlert (padrao do Aviso warning): TriangleAlert e so do
  // status Faltou (tabela de icones reservados, docs/06 secao 4.6).
  return (
    // Alvo do foco com o raio do Aviso (o contorno :focus-visible global
    // acompanha a caixa).
    <div ref={alvo} id={id} tabIndex={-1} className="rounded-xl">
      <Aviso tom="warning" role="alert">
        <p className="text-[13.5px] leading-[1.35] font-bold">
          {titulo ?? (
            <>
              Há <span className="cz-num">{consultas}</span>{" "}
              {consultas === 1 ? "consulta marcada" : "consultas marcadas"}{" "}
              neste período. Remarque ou cancele.
            </>
          )}
        </p>
        {temConsultas ? (
          <p className="mt-1">
            {quando ? (
              <>
                A primeira é em <span className="cz-num">{quando}</span>.{" "}
              </>
            ) : null}
            Esta ação não desmarca nada: as consultas continuam valendo e os
            lembretes continuam saindo para os pacientes.
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {temConsultas ? (
            <Button asChild variant="outline">
              <Link href="/agenda">
                <CalendarDays aria-hidden /> Abrir a Agenda
              </Link>
            </Button>
          ) : null}
          <Button
            ref={botaoConfirmar}
            variant={temConsultas ? "ghost" : "outline"}
            onClick={aoConfirmar}
            disabled={confirmando}
          >
            {confirmando ? "Salvando..." : rotuloConfirmar}
          </Button>
        </div>
      </Aviso>
    </div>
  );
}

// Situacao ativo/inativo nas 3 camadas (icone de forma distinta, rotulo em
// texto e cor), com o mapa RECORD_STATUS. Nunca so cor.
export function ChipSituacao({ active }: { active: boolean }) {
  return (
    <StatusChip
      size="sm"
      definition={RECORD_STATUS[active ? "ativo" : "inativo"]}
    />
  );
}

// Previa do valor em reais ao lado do campo (achado 34): quem digita "250.00"
// ve "R$ 250,00" antes de salvar, e o que nao da para ler vira aviso em
// texto, nao um valor 100 vezes maior gravado em silencio.
export function PreviaDeReais({ texto, id }: { texto: string; id?: string }) {
  const centavos = lerReais(texto);
  if (centavos === null) {
    return null;
  }
  if (centavos === undefined) {
    return (
      <p id={id} aria-live="polite" className="text-xs text-alert-text">
        Não entendemos este valor. Use o formato 250,00.
      </p>
    );
  }
  return (
    <p id={id} aria-live="polite" className="text-xs text-text-secondary">
      Será salvo como{" "}
      <span className="cz-num text-text-strong">
        {formatarCentavos(centavos)}
      </span>
    </p>
  );
}
