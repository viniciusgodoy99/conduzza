"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import {
  useAvisarNaoSalvo,
  type AvisarNaoSalvo,
} from "@/components/agente/nao-salvo";
import { TEXTOS_DO_AGENTE as T } from "@/components/agente/textos";
import type { RetornoDaAcao } from "@/components/agente/tipos";
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import {
  DADOS_EXIGIDOS,
  dadosExigidosSchema,
  ROTULO_DOS_DADOS_EXIGIDOS,
  type DadosExigidos,
} from "@/lib/domain/agente/config";

// "Dados para marcar consulta" (AG3, decisoes D-6 e D-7 do dono, padrao
// recomendado), na aba Regras e limites da Tela 6, logo depois dos limites
// para marcar consulta: o que o assistente pede ao paciente antes de marcar
// (nome completo, data de nascimento e CPF). Versionado como a antecedencia
// e o horizonte: grava no RASCUNHO (salvarDadosExigidosAction, colunas
// exige_*), vale ao publicar e volta no restaurar. A carteirinha nao e
// escolha daqui (vem do Cadastro: convenio ou procedimento que a exige).
//
// Formulario com o proprio Salvar, por isso Checkbox e nao Switch (C31: a
// caixa so vale ao salvar e publicar). O que foi marcado e nao salvo avisa o
// painel (o publicar confere), pelo mesmo nome dos limites ("agenda",
// comOsDadosParaMarcar em nao-salvo.ts): os dois moram na mesma aba e
// descartar remonta os dois. Sem permissao (recepcao), as caixas ficam
// travadas e o Salvar, visivel e desabilitado com a dica.
//
// A frase do cadastro (os dados entram no cadastro do paciente quando a
// equipe aprova a consulta, so onde ele esta vazio) fica sempre visivel: e o
// que o gatilho do banco faz na aprovacao (aplicar_dados_na_aprovacao).

/** Nenhuma caixa marcada: o aviso de que a IA marca sem pedir dado. */
export function nenhumDadoExigido(dados: DadosExigidos): boolean {
  return !dados.nomeCompleto && !dados.nascimento && !dados.cpf;
}

export function CartaoDosDadosExigidos({
  dados,
  podeEditar,
  dica,
  pendente,
  salvando,
  aoSalvar,
  aoMudarNaoSalvo,
}: {
  /** Os dados exigidos do rascunho (ou da publicada, sem rascunho). */
  dados: DadosExigidos;
  podeEditar: boolean;
  dica: string | null;
  pendente: boolean;
  salvando: boolean;
  aoSalvar: (dados: DadosExigidos, retorno: RetornoDaAcao) => void;
  /** Avisa o painel do que foi marcado e nao salvo (o publicar confere). */
  aoMudarNaoSalvo?: AvisarNaoSalvo;
}) {
  const form = useForm<DadosExigidos>({
    resolver: zodResolver(dadosExigidosSchema),
    defaultValues: dados,
  });
  const travado = !podeEditar;
  const atuais = form.watch();
  const erroDoServidor = form.formState.errors.root?.message;
  const naoSalvo = form.formState.isDirty && !travado;
  useAvisarNaoSalvo(naoSalvo, aoMudarNaoSalvo);

  const botaoSalvar = (
    <Button
      type="submit"
      variant="solid"
      disabled={travado || pendente}
      aria-busy={salvando || undefined}
    >
      {salvando ? "Salvando..." : T.salvarDados}
    </Button>
  );

  return (
    <Card role="region" aria-labelledby="agente-dados-titulo">
      <CardHeader>
        <div className="grid min-w-0 gap-[3px]">
          <CardTitle id="agente-dados-titulo">
            {ROTULO_DOS_DADOS_EXIGIDOS}
          </CardTitle>
          <CardDescription>{T.dadosDescricao}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            noValidate
            aria-label={ROTULO_DOS_DADOS_EXIGIDOS}
            className="grid gap-4"
            onSubmit={(evento) =>
              void form.handleSubmit((valores) =>
                aoSalvar(valores, {
                  seDerCerto: () => form.reset(valores),
                  seFalhar: (erro) => form.setError("root", { message: erro }),
                }),
              )(evento)
            }
          >
            <fieldset disabled={travado} className="grid min-w-0 gap-1">
              <legend className="sr-only">{T.dadosLegenda}</legend>
              {DADOS_EXIGIDOS.map((dado) => (
                <FormField
                  key={dado.chave}
                  control={form.control}
                  name={dado.chave}
                  render={({ field }) => (
                    <FormItem className="flex min-h-10 items-center gap-3">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(valor) =>
                            field.onChange(valor === true)
                          }
                          onBlur={field.onBlur}
                        />
                      </FormControl>
                      <FormLabel className="text-[13.5px]">
                        {dado.rotulo}
                      </FormLabel>
                    </FormItem>
                  )}
                />
              ))}
            </fieldset>

            <div className="grid gap-1 text-[13px] text-text-secondary">
              <p>{T.dadosNoCadastro}</p>
              <p>{T.dadosCarteirinha}</p>
            </div>

            {nenhumDadoExigido(atuais) ? (
              <Aviso tom="info" role="note">
                {T.dadosNenhum}
              </Aviso>
            ) : null}
            {erroDoServidor ? (
              <Aviso tom="alert" role="alert">
                {erroDoServidor}
              </Aviso>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              {dica ? (
                <DisabledWithHint hint={dica}>{botaoSalvar}</DisabledWithHint>
              ) : (
                botaoSalvar
              )}
              {naoSalvo ? (
                <span className="text-[13px] text-text-secondary">
                  Alterações ainda não salvas.
                </span>
              ) : null}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
