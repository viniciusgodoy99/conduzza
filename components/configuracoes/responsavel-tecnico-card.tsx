"use client";

import { TZDate } from "@date-fns/tz";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  definirResponsavelTecnicoAction,
  encerrarResponsavelTecnicoAction,
} from "@/app/(app)/configuracoes/responsavel-tecnico-actions";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CONSELHOS, UFS, ehConselho, ehUf } from "@/lib/domain/preparo";

// Configuracoes, aba Equipe (Tela 12): o cartao "Responsavel tecnico" (AG7,
// desenho 5.3 e 5.6). O RT e a pessoa da equipe (de qualquer papel, inclusive
// Somente leitura) que aprova a orientacao de preparo de cada procedimento;
// sem RT com acesso ativo, nenhuma orientacao sai (o banco confere a cada
// envio, responsavel_tecnico_vigente).
//
// So o administrador pleno (sem a marca de Implementador) e a equipe Conduzza
// definem, trocam e encerram. O gestor e o Implementador veem as acoes
// visiveis e desabilitadas, com a frase do banco como dica. A guarda de
// verdade e a da action (app/(app)/configuracoes/responsavel-tecnico-actions)
// e a da RPC (42501).
//
// Estados: vazio (sem RT), definido, sem acesso ativo (o vinculo do RT nao
// esta ativo: o aviso em atencao, CircleAlert, nunca so cor), erro (a leitura
// do RT falhou: o cartao diz isso e a aba continua) e gravando ("Definindo..."
// e "Encerrando..."). A data do "desde" sai no fuso da clinica.
//
// Os textos repetidos na action (a frase do RT e as dos campos) sao
// conferidos pelo teste: o servidor nao importa deste arquivo de cliente.

export const TEXTOS_DO_RESPONSAVEL_TECNICO = {
  titulo: "Responsável técnico",
  descricao:
    "A pessoa da equipe que aprova as orientações de preparo enviadas aos pacientes, com o registro no conselho de classe.",
  vazio:
    "Sem responsável técnico definido. Sem ele, nenhuma orientação de preparo é enviada aos pacientes.",
  semAcesso:
    "Sem acesso ativo: as orientações aprovadas não estão sendo enviadas.",
  erroDaLeitura: "Não foi possível carregar o responsável técnico.",
  erroDaLeituraAjuda: "Recarregue a página. Se continuar, fale com o suporte.",
  definir: "Definir responsável técnico",
  trocar: "Trocar",
  encerrar: "Encerrar",
  /** A frase 42501 das RPCs, exata (contrato 1.4): a dica de quem nao pode. */
  dica: "Só o administrador da clínica define o responsável técnico.",
  tituloDefinir: "Definir responsável técnico",
  tituloTrocar: "Trocar responsável técnico",
  descricaoDoFormulario:
    "O nome e o registro aparecem para o paciente no começo de cada orientação de preparo.",
  pessoa: "Pessoa da equipe",
  escolhaAPessoa: "Escolha a pessoa",
  nome: "Nome como está no conselho",
  conselho: "Conselho",
  escolhaOConselho: "Escolha o conselho",
  numero: "Número do registro",
  uf: "UF do registro",
  escolhaAUf: "Escolha a UF",
  confirmacao:
    "Confirmo que esta pessoa é a responsável técnica da clínica no conselho de classe.",
  botaoDefinir: "Definir",
  definindo: "Definindo...",
  voltar: "Voltar",
  tituloEncerrar: "Encerrar o responsável técnico?",
  botaoEncerrar: "Encerrar",
  encerrando: "Encerrando...",
  definido: "Responsável técnico definido.",
  trocado: "Responsável técnico trocado.",
  encerrado: "Responsável técnico encerrado.",
  naoSalvou: "Não foi possível salvar agora. Tente de novo.",
  erroDaPessoa: "Escolha a pessoa da equipe.",
  erroDoNomeVazio: "Escreva o nome como está no conselho.",
  erroDoNomeLongo: "Use até 120 caracteres no nome.",
  erroDoNomeComQuebra: "Tire as quebras de linha do nome.",
  erroDoConselho: "Escolha o conselho.",
  erroDoNumeroVazio: "Escreva o número do registro.",
  erroDoNumero: "Use até 20 letras, números, ponto, barra ou hífen no número.",
  erroDaUf: "Escolha a UF do registro.",
  erroDaConfirmacao: "Marque a confirmação para definir.",
} as const;

const T = TEXTOS_DO_RESPONSAVEL_TECNICO;

/** A designacao aberta, como o cartao a mostra. */
export type ResponsavelTecnicoNoCartao = {
  nome: string;
  conselho: string;
  numero: string;
  uf: string;
  /** timestamptz (ISO) do inicio da designacao */
  desde: string;
  /** o e-mail do membro; nulo quando nao veio (a pessoa saiu da clinica) */
  email: string | null;
  /** o vinculo do RT na clinica esta ativo (a regra do RT vigente) */
  comAcesso: boolean;
};

/** Quem pode ser escolhido: os membros ATIVOS, de qualquer papel. */
export type PessoaDaEquipe = {
  userId: string;
  nome: string;
  email: string;
};

export type DadosDoResponsavelTecnico = {
  /** nulo: a clinica nao tem RT definido */
  rt: ResponsavelTecnicoNoCartao | null;
  pessoas: PessoaDaEquipe[];
};

export type ResponsavelTecnicoCardProps = {
  /** nulo: a leitura do RT falhou (o cartao diz isso; a aba continua) */
  dados: DadosDoResponsavelTecnico | null;
  /** administrador pleno ou equipe Conduzza (a action confere de novo) */
  podeDefinir: boolean;
  /** o fuso da clinica (a data do "desde") */
  timezone: string;
};

/** dd/mm/aaaa no fuso da clinica; nulo se a data nao for legivel. */
function dataNoFuso(iso: string, timezone: string): string | null {
  const instante = Date.parse(iso);
  if (!Number.isFinite(instante)) {
    return null;
  }
  return format(new TZDate(instante, timezone), "dd/MM/yyyy", {
    locale: ptBR,
  });
}

/**
 * "{nome} ({conselho}-{UF} {numero}), {e-mail do membro}, desde {data}."
 * (desenho 5.3). Sem o e-mail, a frase fica sem ele.
 */
export function descricaoDoResponsavelTecnico(
  rt: ResponsavelTecnicoNoCartao,
  timezone: string,
): string {
  const partes = [`${rt.nome} (${rt.conselho}-${rt.uf} ${rt.numero})`];
  if (rt.email) {
    partes.push(rt.email);
  }
  const desde = dataNoFuso(rt.desde, timezone);
  if (desde) {
    partes.push(`desde ${desde}`);
  }
  return `${partes.join(", ")}.`;
}

/**
 * O aviso da troca (desenho 5.3). {novo} e a pessoa escolhida no formulario;
 * sem escolha ainda, a forma sem o nome.
 */
export function avisoDaTroca(atual: string, novo: string | null): string {
  return novo
    ? `As orientações aprovadas por ${atual} deixam de ser enviadas até ${novo} aprovar de novo.`
    : `As orientações aprovadas por ${atual} deixam de ser enviadas até o novo responsável técnico aprovar de novo.`;
}

/** O corpo do dialogo "Encerrar o responsavel tecnico?". */
export function textoDoEncerrar(nome: string): string {
  return `As orientações de preparo aprovadas por ${nome} deixam de ser enviadas aos pacientes até a clínica definir um responsável técnico e ele aprovar de novo.`;
}

/** O botao do formulario, parado e gravando. */
export function rotuloDoDefinir(enviando: boolean): string {
  return enviando ? T.definindo : T.botaoDefinir;
}

// ---------------------------------------------------------------------------
// O formulario (react-hook-form com o Zod; a action valida de novo)

// C0, DEL e C1: o CHECK do nome no banco.
const CONTROLE = /[\u0000-\u001f\u007f-\u009f]/;
// O CHECK do numero, igual ao da RPC.
const NUMERO_DO_REGISTRO = /^[0-9A-Za-z./-]{1,20}$/;

/** Como o banco conta (char_length): pontos de codigo. */
function tamanho(texto: string): number {
  return Array.from(texto).length;
}

// Os predicados devolvem boolean (e nao "valor is Conselho"): o refine do Zod
// estreitaria a saida, e o formulario comeca com o campo vazio.
export const formularioDoResponsavelTecnicoSchema = z.object({
  userId: z.string().min(1, { error: T.erroDaPessoa }),
  nome: z
    .string()
    .trim()
    .refine((nome) => tamanho(nome) >= 1, { error: T.erroDoNomeVazio })
    .refine((nome) => tamanho(nome) <= 120, { error: T.erroDoNomeLongo })
    .refine((nome) => !CONTROLE.test(nome), { error: T.erroDoNomeComQuebra }),
  conselho: z.string().refine((valor): boolean => ehConselho(valor), {
    error: T.erroDoConselho,
  }),
  numero: z
    .string()
    .trim()
    .min(1, { error: T.erroDoNumeroVazio })
    .regex(NUMERO_DO_REGISTRO, { error: T.erroDoNumero }),
  uf: z.string().refine((valor): boolean => ehUf(valor), { error: T.erroDaUf }),
  confirmou: z.boolean().refine((marcada): boolean => marcada, {
    error: T.erroDaConfirmacao,
  }),
});

export type ValoresDoResponsavelTecnico = z.infer<
  typeof formularioDoResponsavelTecnicoSchema
>;

const VALORES_VAZIOS: ValoresDoResponsavelTecnico = {
  userId: "",
  nome: "",
  conselho: "",
  numero: "",
  uf: "",
  confirmou: false,
};

/**
 * O corpo do dialogo "Definir" e "Trocar". Exportado para o teste: o Dialog
 * do Radix usa portal, que nao renderiza no servidor. valoresIniciais so
 * serve ao teste (a troca com a pessoa ja escolhida); o dialogo abre vazio.
 */
export function FormularioDoResponsavelTecnico({
  atual,
  pessoas,
  valoresIniciais,
  aoMudarEnvio,
  aoDefinir,
  aoVoltar,
}: {
  /** o nome do RT de agora; nulo quando a clinica nao tem RT */
  atual: string | null;
  pessoas: readonly PessoaDaEquipe[];
  valoresIniciais?: Partial<ValoresDoResponsavelTecnico>;
  /** o dialogo nao fecha enquanto grava */
  aoMudarEnvio?: (enviando: boolean) => void;
  aoDefinir: () => void;
  aoVoltar: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const form = useForm<ValoresDoResponsavelTecnico>({
    resolver: zodResolver(formularioDoResponsavelTecnicoSchema),
    defaultValues: { ...VALORES_VAZIOS, ...valoresIniciais },
  });
  const enviando = form.formState.isSubmitting;
  const escolhida = form.watch("userId");
  const novo =
    pessoas.find((pessoa) => pessoa.userId === escolhida)?.nome ?? null;

  const enviar = async (valores: ValoresDoResponsavelTecnico) => {
    setErro(null);
    aoMudarEnvio?.(true);
    const resultado = await definirResponsavelTecnicoAction({
      userId: valores.userId,
      nome: valores.nome,
      conselho: valores.conselho,
      numero: valores.numero,
      uf: valores.uf,
      // O Zod do formulario so deixa chegar aqui com a caixa marcada.
      confirmou: true,
    }).catch(() => null);
    aoMudarEnvio?.(false);
    if (!resultado) {
      setErro(T.naoSalvou);
      return;
    }
    if (!resultado.ok) {
      setErro(resultado.error);
      return;
    }
    toast.success(atual === null ? T.definido : T.trocado);
    aoDefinir();
  };

  return (
    <Form {...form}>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(evento) => void form.handleSubmit(enviar)(evento)}
      >
        {atual !== null ? (
          <Aviso tom="warning" role="note">
            {avisoDaTroca(atual, novo)}
          </Aviso>
        ) : null}

        <FormField
          control={form.control}
          name="userId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{T.pessoa}</FormLabel>
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={enviando}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={T.escolhaAPessoa} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {pessoas.map((pessoa) => (
                    <SelectItem key={pessoa.userId} value={pessoa.userId}>
                      {pessoa.email
                        ? `${pessoa.nome} (${pessoa.email})`
                        : pessoa.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage className="text-[13px]" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="nome"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{T.nome}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoComplete="off"
                  maxLength={120}
                  disabled={enviando}
                />
              </FormControl>
              <FormMessage className="text-[13px]" />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.7fr)]">
          <FormField
            control={form.control}
            name="conselho"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{T.conselho}</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={enviando}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={T.escolhaOConselho} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {CONSELHOS.map((conselho) => (
                      <SelectItem key={conselho} value={conselho}>
                        {conselho}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="numero"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{T.numero}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={20}
                    disabled={enviando}
                  />
                </FormControl>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="uf"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{T.uf}</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={enviando}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={T.escolhaAUf} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {UFS.map((uf) => (
                      <SelectItem key={uf} value={uf}>
                        {uf}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="confirmou"
          render={({ field }) => (
            <FormItem className="flex items-start gap-2.5">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(marcada) =>
                    field.onChange(marcada === true)
                  }
                  disabled={enviando}
                  className="mt-px"
                />
              </FormControl>
              <div className="grid gap-1">
                <FormLabel className="text-[13.5px] leading-[1.45] font-normal">
                  {T.confirmacao}
                </FormLabel>
                <FormMessage className="text-[13px]" />
              </div>
            </FormItem>
          )}
        />

        {erro ? (
          <Aviso tom="alert" role="alert">
            {erro}
          </Aviso>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={enviando}
            onClick={aoVoltar}
          >
            {T.voltar}
          </Button>
          <Button type="submit" disabled={enviando}>
            {rotuloDoDefinir(enviando)}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

/** O dialogo "Definir responsavel tecnico" e "Trocar responsavel tecnico". */
export function DialogoDoResponsavelTecnico({
  aberto,
  atual,
  pessoas,
  aoFechar,
}: {
  aberto: boolean;
  atual: string | null;
  pessoas: readonly PessoaDaEquipe[];
  aoFechar: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const fechar = () => {
    if (!enviando) {
      aoFechar();
    }
  };
  return (
    <Dialog
      open={aberto}
      onOpenChange={(abrir) => {
        if (!abrir) {
          fechar();
        }
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {atual === null ? T.tituloDefinir : T.tituloTrocar}
          </DialogTitle>
          <DialogDescription>{T.descricaoDoFormulario}</DialogDescription>
        </DialogHeader>
        {/* O formulario desmonta ao fechar: cada abertura comeca vazia. */}
        {aberto ? (
          <FormularioDoResponsavelTecnico
            atual={atual}
            pessoas={pessoas}
            aoMudarEnvio={setEnviando}
            aoDefinir={aoFechar}
            aoVoltar={fechar}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** A confirmacao do "Encerrar" (exportada para o teste, como o formulario). */
export function DialogoDeEncerrar({
  aberto,
  nome,
  pendente,
  erro,
  aoFechar,
  aoEncerrar,
}: {
  aberto: boolean;
  nome: string;
  pendente: boolean;
  erro: string | null;
  aoFechar: () => void;
  aoEncerrar: () => void;
}) {
  return (
    <Dialog
      open={aberto}
      onOpenChange={(abrir) => {
        if (!abrir && !pendente) {
          aoFechar();
        }
      }}
    >
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{T.tituloEncerrar}</DialogTitle>
          <DialogDescription>{textoDoEncerrar(nome)}</DialogDescription>
        </DialogHeader>
        {erro ? (
          <Aviso tom="alert" role="alert">
            {erro}
          </Aviso>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" disabled={pendente} onClick={aoFechar}>
            {T.voltar}
          </Button>
          <Button
            variant="destructive"
            disabled={pendente}
            onClick={aoEncerrar}
          >
            {pendente ? T.encerrando : T.botaoEncerrar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** O cartao da aba Equipe. */
export function ResponsavelTecnicoCard({
  dados,
  podeDefinir,
  timezone,
}: ResponsavelTecnicoCardProps) {
  const [dialogo, setDialogo] = useState<"definir" | "encerrar" | null>(null);
  const [erroDoEncerrar, setErroDoEncerrar] = useState<string | null>(null);
  const [encerrando, startEncerrar] = useTransition();
  const rt = dados?.rt ?? null;

  const abrirEncerrar = () => {
    setErroDoEncerrar(null);
    setDialogo("encerrar");
  };

  const encerrar = () => {
    setErroDoEncerrar(null);
    startEncerrar(async () => {
      const resultado = await encerrarResponsavelTecnicoAction().catch(
        () => null,
      );
      if (!resultado) {
        setErroDoEncerrar(T.naoSalvou);
        return;
      }
      if (!resultado.ok) {
        setErroDoEncerrar(resultado.error);
        return;
      }
      setDialogo(null);
      toast.success(T.encerrado);
    });
  };

  // Visivel e desabilitada, com a dica, para quem nao define (gestor e
  // Implementador): nunca escondida.
  const acao = (rotulo: string, aoClicar: () => void): React.ReactElement => {
    const botao = (
      <Button variant="outline" disabled={!podeDefinir} onClick={aoClicar}>
        {rotulo}
      </Button>
    );
    return podeDefinir ? (
      botao
    ) : (
      <DisabledWithHint hint={T.dica}>{botao}</DisabledWithHint>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{T.titulo}</CardTitle>
        <CardDescription>{T.descricao}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {dados === null ? (
          <Aviso tom="alert" role="alert" titulo={T.erroDaLeitura}>
            {T.erroDaLeituraAjuda}
          </Aviso>
        ) : (
          <>
            {rt === null ? (
              <p className="text-[13.5px] text-text-secondary">{T.vazio}</p>
            ) : (
              <p className="text-[13.5px] break-words text-text-strong">
                {descricaoDoResponsavelTecnico(rt, timezone)}
              </p>
            )}
            {rt !== null && !rt.comAcesso ? (
              <Aviso tom="warning" role="note">
                {T.semAcesso}
              </Aviso>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {rt === null ? (
                acao(T.definir, () => setDialogo("definir"))
              ) : (
                <>
                  {acao(T.trocar, () => setDialogo("definir"))}
                  {acao(T.encerrar, abrirEncerrar)}
                </>
              )}
            </div>
          </>
        )}
      </CardContent>

      {dados !== null && podeDefinir ? (
        <>
          <DialogoDoResponsavelTecnico
            aberto={dialogo === "definir"}
            atual={rt?.nome ?? null}
            pessoas={dados.pessoas}
            aoFechar={() => setDialogo(null)}
          />
          {rt !== null ? (
            <DialogoDeEncerrar
              aberto={dialogo === "encerrar"}
              nome={rt.nome}
              pendente={encerrando}
              erro={erroDoEncerrar}
              aoFechar={() => setDialogo(null)}
              aoEncerrar={encerrar}
            />
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
