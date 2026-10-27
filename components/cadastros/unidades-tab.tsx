"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { salvarUnidadeAction } from "@/app/(app)/cadastros/actions";
import type { TabProps } from "@/app/(app)/cadastros/cadastros-client";
import {
  AcoesDaLinha,
  BotaoProtegido,
  CampoDeMarcar,
  ChipSituacao,
  DetalheSomenteLeitura,
  PainelDeCadastro,
  RodapeDeSalvar,
  VazioDaAba,
} from "@/components/cadastros/comum";
import {
  EditorDoHorarioDeFuncionamento,
  TEXTOS_DO_HORARIO,
} from "@/components/cadastros/horario-de-funcionamento";
import { DataTable } from "@/components/shared/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  comporEndereco,
  diasAbertos,
  formatarCep,
  horarioDaEdicao,
  horarioParaEdicao,
  lerCep,
  LIMITES_DO_CADASTRO,
  linhasDoHorario,
  linkDoMapaValido,
  problemaNosTextosDaUnidade,
  problemasDoHorarioEmEdicao,
  temEnderecoEstruturado,
  UFS,
  type HorarioDeFuncionamento,
  type HorarioEmEdicao,
} from "@/lib/domain/cadastro-para-o-agente";
import {
  cadastroDaUnidade,
  type CadastroDaUnidade,
} from "@/lib/queries/cadastro-para-o-agente";
import type { Unidade } from "@/lib/queries/catalogo";

// Aba Unidades. Desde o cadastro para o agente (AG1, pedido do dono de
// 26/10/2026; migration 20261027100000) a unidade tem o endereco
// estruturado (o `address` de texto passa a ser composto dos campos, pelo
// servidor), o horario de funcionamento e o que vai ao paciente (ponto de
// referencia, estacionamento, acessibilidade e a observacao), conferido
// pelas mesmas regras do editor da base de conhecimento. O CEP fica guardado
// e nao vai a IA; o link do mapa fica guardado (o filtro de saida de hoje
// barra link na resposta da IA). Quem so ve abre o mesmo modal em leitura.

export const TEXTOS_DA_UNIDADE = {
  vazioTitulo: "Nenhuma unidade cadastrada",
  vazioDescricao:
    "Cadastre a unidade com o endereço e o horário: o assistente usa para dizer onde a clínica fica e quando abre.",
  endereco: "Endereço",
  enderecoAjuda:
    "Preencha rua, número, bairro, cidade e UF: o endereço completo é montado a partir deles.",
  enderecoAntigo: "Endereço antigo, em texto livre",
  enderecoAntigoAjuda:
    "Preencha os campos acima: o endereço passa a ser montado a partir deles e este texto sai.",
  comoFica: "Como fica",
  cepAjuda:
    "Fica guardado no cadastro. O assistente não manda CEP ao paciente.",
  comoChegar: "Como chegar",
  referencia: "Ponto de referência",
  referenciaExemplo: "Ex.: Em frente à praça, ao lado da farmácia.",
  linkDoMapa: "Link do mapa",
  linkDoMapaAjuda:
    "Cole o link do Google Maps ou de outro mapa, começando com https://. Fica guardado no cadastro: hoje o assistente não manda link na conversa.",
  estacionamento: "Estacionamento",
  estacionamentoExemplo:
    "Ex.: Estacionamento próprio no subsolo, para pacientes.",
  acessibilidade: "Acessibilidade",
  acessibilidadeExemplo: "Ex.: Rampa na entrada e elevador até o consultório.",
  observacao: "Observação ao paciente",
  observacaoAjuda:
    "Algo que o paciente precisa saber sobre esta unidade. O texto passa pelas mesmas regras das respostas do assistente.",
  textosAoPaciente:
    "Estes textos vão ao paciente: não escreva telefone, link, valor nem orientação de saúde.",
  semHorario: "Não informado",
  ufVazia: "Não informada",
} as const;

const SEM_UF = "nenhuma";

type FormUnidade = {
  id?: string;
  name: string;
  phone: string;
  active: boolean;
  /** O `address` de quando a unidade ainda nao tinha os campos (so leitura) */
  enderecoAntigo: string | null;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  referencia: string;
  estacionamento: string;
  acessibilidade: string;
  link_do_mapa: string;
  observacao_ao_paciente: string;
  horario: HorarioEmEdicao;
};

let contadorDeChave = 0;
function novaChave(): string {
  contadorDeChave += 1;
  return `faixa-da-unidade-${contadorDeChave}`;
}

function formVazio(): FormUnidade {
  return {
    name: "",
    phone: "",
    active: true,
    enderecoAntigo: null,
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
    cep: "",
    referencia: "",
    estacionamento: "",
    acessibilidade: "",
    link_do_mapa: "",
    observacao_ao_paciente: "",
    horario: horarioParaEdicao(null, novaChave),
  };
}

/** O formulario de uma unidade gravada (o catalogo mais as colunas novas). */
export function formDaUnidade(
  unidade: Unidade,
  cadastro: CadastroDaUnidade | null,
): FormUnidade {
  const endereco = {
    logradouro: cadastro?.logradouro ?? null,
    numero: cadastro?.numero ?? null,
    complemento: cadastro?.complemento ?? null,
    bairro: cadastro?.bairro ?? null,
    cidade: cadastro?.cidade ?? null,
    uf: cadastro?.uf ?? null,
  };
  return {
    id: unidade.id,
    name: unidade.name,
    phone: unidade.phone ?? "",
    active: unidade.active,
    enderecoAntigo: temEnderecoEstruturado(endereco) ? null : unidade.address,
    logradouro: endereco.logradouro ?? "",
    numero: endereco.numero ?? "",
    complemento: endereco.complemento ?? "",
    bairro: endereco.bairro ?? "",
    cidade: endereco.cidade ?? "",
    uf: endereco.uf ?? "",
    cep: cadastro?.cep ? formatarCep(cadastro.cep) : "",
    referencia: cadastro?.referencia ?? "",
    estacionamento: cadastro?.estacionamento ?? "",
    acessibilidade: cadastro?.acessibilidade ?? "",
    link_do_mapa: cadastro?.link_do_mapa ?? "",
    observacao_ao_paciente: cadastro?.observacao_ao_paciente ?? "",
    horario: horarioParaEdicao(
      cadastro?.horario_de_funcionamento ?? null,
      novaChave,
    ),
  };
}

const vazioEhNulo = (texto: string) => texto.trim() || null;

/**
 * O que impede salvar, conferido ANTES de gravar: o nome, o CEP, o link do
 * mapa, o horario (cada problema com o dia) e os textos ao paciente (as
 * regras do filtro). O servidor confere tudo de novo.
 */
export function problemaDoFormDaUnidade(form: FormUnidade): string | null {
  if (form.name.trim().length < 2) {
    return "Informe o nome da unidade.";
  }
  if (lerCep(form.cep) === undefined) {
    return "CEP: use 8 números, como 60000-000.";
  }
  const link = form.link_do_mapa.trim();
  if (link !== "" && !linkDoMapaValido(link)) {
    return "Link do mapa: cole o endereço completo, começando com https://.";
  }
  const doHorario = problemasDoHorarioEmEdicao(form.horario);
  if (doHorario.length > 0) {
    return `Horário de funcionamento: ${doHorario.slice(0, 3).join(" ")}`;
  }
  return problemaNosTextosDaUnidade({
    referencia: form.referencia,
    estacionamento: form.estacionamento,
    acessibilidade: form.acessibilidade,
    observacao_ao_paciente: form.observacao_ao_paciente,
  });
}

/** O que vai para salvarUnidadeAction (o servidor compoe o address). */
export function entradaDaUnidade(form: FormUnidade) {
  return {
    id: form.id,
    name: form.name,
    phone: vazioEhNulo(form.phone),
    active: form.active,
    address: form.enderecoAntigo,
    logradouro: vazioEhNulo(form.logradouro),
    numero: vazioEhNulo(form.numero),
    complemento: vazioEhNulo(form.complemento),
    bairro: vazioEhNulo(form.bairro),
    cidade: vazioEhNulo(form.cidade),
    uf: form.uf || null,
    cep: lerCep(form.cep) ?? null,
    referencia: vazioEhNulo(form.referencia),
    estacionamento: vazioEhNulo(form.estacionamento),
    acessibilidade: vazioEhNulo(form.acessibilidade),
    link_do_mapa: vazioEhNulo(form.link_do_mapa),
    horario_de_funcionamento: horarioDaEdicao(form.horario),
    observacao_ao_paciente: vazioEhNulo(form.observacao_ao_paciente),
  };
}

/** "5 dias por semana", "1 dia por semana" ou "Não informado". */
export function resumoDoHorario(
  horario: HorarioDeFuncionamento | null,
): string {
  const dias = diasAbertos(horario);
  if (dias === 0) {
    return TEXTOS_DA_UNIDADE.semHorario;
  }
  return dias === 1 ? "1 dia por semana" : `${dias} dias por semana`;
}

function Contador({ texto, maximo }: { texto: string; maximo: number }) {
  return (
    <span className="cz-num text-xs text-text-secondary">
      {texto.length}/{maximo}
    </span>
  );
}

export function UnidadesTab({
  catalogo,
  cadastroDoAgente,
  podeEditar,
  dica,
  aoMudar,
}: TabProps) {
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<FormUnidade>(formVazio);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Quem so ve Cadastros (recepcao, leitura, profissional) abre o mesmo
  // modal em modo leitura.
  const [somenteLeitura, setSomenteLeitura] = useState(false);

  const abrir = (unidade?: Unidade, leitura = false) => {
    setErro(null);
    setSomenteLeitura(leitura);
    setForm(
      unidade
        ? formDaUnidade(
            unidade,
            cadastroDaUnidade(cadastroDoAgente, unidade.id),
          )
        : formVazio(),
    );
    setAberto(true);
  };

  const mudar = <K extends keyof FormUnidade>(
    campo: K,
    valor: FormUnidade[K],
  ) => setForm((atual) => ({ ...atual, [campo]: valor }));

  const salvar = async () => {
    const problema = problemaDoFormDaUnidade(form);
    if (problema) {
      setErro(problema);
      return;
    }
    setSalvando(true);
    setErro(null);
    const resultado = await salvarUnidadeAction(entradaDaUnidade(form));
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível salvar.");
      return;
    }
    toast.success(form.id ? "Unidade atualizada" : "Unidade criada");
    setAberto(false);
    aoMudar();
  };

  const enderecoDaLinha = (unidade: Unidade): string | null => unidade.address;

  const colunas: ColumnDef<Unidade>[] = [
    {
      id: "nome",
      header: "Nome",
      cell: ({ row }) => (
        <span className="font-semibold text-text-strong">
          {row.original.name}
        </span>
      ),
    },
    {
      id: "endereco",
      header: "Endereço",
      cell: ({ row }) => (
        <span className="text-text-secondary">
          {enderecoDaLinha(row.original) ?? "Não informado"}
        </span>
      ),
    },
    {
      id: "telefone",
      header: "Telefone",
      cell: ({ row }) =>
        row.original.phone ? (
          <span className="cz-num whitespace-nowrap">{row.original.phone}</span>
        ) : (
          <span className="text-text-secondary">Não informado</span>
        ),
    },
    {
      id: "horario",
      header: "Horário",
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-text-secondary">
          {resumoDoHorario(
            cadastroDaUnidade(cadastroDoAgente, row.original.id)
              ?.horario_de_funcionamento ?? null,
          )}
        </span>
      ),
    },
    {
      id: "situacao",
      header: "Situação",
      cell: ({ row }) => <ChipSituacao active={row.original.active} />,
    },
    {
      id: "acoes",
      header: () => <span className="sr-only">Ações</span>,
      meta: { align: "right", numeric: false },
      cell: ({ row }) => (
        <AcoesDaLinha
          podeEditar={podeEditar}
          dica={dica}
          nome={row.original.name}
          aoEditar={() => abrir(row.original)}
          aoVerDetalhes={() => abrir(row.original, true)}
        />
      ),
    },
  ];

  const fechar = () => setAberto(false);
  const enderecoComposto = comporEndereco({
    logradouro: form.logradouro,
    numero: form.numero,
    complemento: form.complemento,
    bairro: form.bairro,
    cidade: form.cidade,
    uf: form.uf || null,
  });
  const horarioSalvo = horarioDaEdicao(form.horario);

  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <BotaoProtegido
          podeEditar={podeEditar}
          dica={dica}
          onClick={() => abrir()}
        >
          <Plus aria-hidden /> Nova unidade
        </BotaoProtegido>
      </div>

      {catalogo.unidades.length === 0 ? (
        <VazioDaAba
          icon={Building2}
          titulo={TEXTOS_DA_UNIDADE.vazioTitulo}
          descricao={TEXTOS_DA_UNIDADE.vazioDescricao}
          acao={{
            rotulo: "Cadastrar a primeira unidade",
            onClick: () => abrir(),
          }}
          podeEditar={podeEditar}
          dica={dica}
        />
      ) : (
        <DataTable columns={colunas} data={catalogo.unidades} />
      )}

      <PainelDeCadastro
        aberto={aberto}
        aoMudarAberto={setAberto}
        // Largo: o horario de funcionamento tem uma linha por dia.
        larga
        titulo={
          somenteLeitura
            ? form.name
            : form.id
              ? "Editar unidade"
              : "Nova unidade"
        }
        erro={somenteLeitura ? null : erro}
        rodape={
          somenteLeitura ? undefined : (
            <RodapeDeSalvar
              salvando={salvando}
              aoCancelar={fechar}
              aoSalvar={() => void salvar()}
            />
          )
        }
      >
        {somenteLeitura ? (
          <DetalheSomenteLeitura
            itens={[
              {
                rotulo: TEXTOS_DA_UNIDADE.endereco,
                valor: enderecoComposto ?? form.enderecoAntigo,
              },
              {
                rotulo: "CEP",
                valor: form.cep ? (
                  <span className="cz-num">{form.cep}</span>
                ) : null,
              },
              { rotulo: "Telefone", valor: form.phone },
              {
                rotulo: TEXTOS_DA_UNIDADE.referencia,
                valor: form.referencia,
              },
              {
                rotulo: TEXTOS_DA_UNIDADE.linkDoMapa,
                valor: form.link_do_mapa ? (
                  <a
                    href={form.link_do_mapa}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-primary-text underline underline-offset-2"
                  >
                    {form.link_do_mapa}
                  </a>
                ) : null,
              },
              {
                rotulo: TEXTOS_DA_UNIDADE.estacionamento,
                valor: form.estacionamento,
              },
              {
                rotulo: TEXTOS_DA_UNIDADE.acessibilidade,
                valor: form.acessibilidade,
              },
              {
                rotulo: TEXTOS_DO_HORARIO.legenda,
                valor: horarioSalvo ? (
                  <ul className="grid gap-1">
                    {linhasDoHorario(horarioSalvo).map((linha) => (
                      <li key={linha.dia}>
                        {linha.rotulo}:{" "}
                        <span className="cz-num">{linha.texto}</span>
                      </li>
                    ))}
                  </ul>
                ) : null,
              },
              {
                rotulo: TEXTOS_DA_UNIDADE.observacao,
                valor: form.observacao_ao_paciente,
              },
              {
                rotulo: "Situação",
                valor: <ChipSituacao active={form.active} />,
              },
            ]}
          />
        ) : null}
        {/* O formulario fica fora da arvore visivel no modo leitura. */}
        <div className="grid gap-4" hidden={somenteLeitura}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="grid gap-1.5">
              <Label htmlFor="unidade-nome">Nome</Label>
              <Input
                id="unidade-nome"
                value={form.name}
                maxLength={120}
                onChange={(e) => mudar("name", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="unidade-telefone">Telefone</Label>
              <Input
                id="unidade-telefone"
                type="tel"
                inputMode="tel"
                value={form.phone}
                maxLength={30}
                onChange={(e) => mudar("phone", e.target.value)}
                className="cz-num"
              />
            </div>
          </div>

          <fieldset className="grid min-w-0 gap-3 border-t border-border pt-4">
            <legend className="text-sm font-bold text-text-strong">
              {TEXTOS_DA_UNIDADE.endereco}
            </legend>
            <p className="text-xs text-text-secondary">
              {TEXTOS_DA_UNIDADE.enderecoAjuda}
            </p>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
              <div className="grid gap-1.5">
                <Label htmlFor="unidade-logradouro">Rua ou avenida</Label>
                <Input
                  id="unidade-logradouro"
                  value={form.logradouro}
                  maxLength={LIMITES_DO_CADASTRO.logradouro}
                  autoComplete="address-line1"
                  onChange={(e) => mudar("logradouro", e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="unidade-numero">Número</Label>
                <Input
                  id="unidade-numero"
                  value={form.numero}
                  maxLength={LIMITES_DO_CADASTRO.numero}
                  placeholder="Ex.: 123 ou S/N"
                  onChange={(e) => mudar("numero", e.target.value)}
                  className="cz-num"
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="unidade-complemento">Complemento</Label>
                <Input
                  id="unidade-complemento"
                  value={form.complemento}
                  maxLength={LIMITES_DO_CADASTRO.complemento}
                  placeholder="Ex.: Sala 4, 2º andar"
                  onChange={(e) => mudar("complemento", e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="unidade-bairro">Bairro</Label>
                <Input
                  id="unidade-bairro"
                  value={form.bairro}
                  maxLength={LIMITES_DO_CADASTRO.bairro}
                  onChange={(e) => mudar("bairro", e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="grid gap-1.5">
                <Label htmlFor="unidade-cidade">Cidade</Label>
                <Input
                  id="unidade-cidade"
                  value={form.cidade}
                  maxLength={LIMITES_DO_CADASTRO.cidade}
                  autoComplete="address-level2"
                  onChange={(e) => mudar("cidade", e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="unidade-uf">UF</Label>
                <Select
                  value={form.uf || SEM_UF}
                  onValueChange={(valor) =>
                    mudar("uf", valor === SEM_UF ? "" : valor)
                  }
                >
                  <SelectTrigger id="unidade-uf" aria-label="UF">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_UF}>
                      {TEXTOS_DA_UNIDADE.ufVazia}
                    </SelectItem>
                    {UFS.map(([sigla, nome]) => (
                      <SelectItem key={sigla} value={sigla}>
                        {sigla} ({nome})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="unidade-cep">CEP</Label>
                <Input
                  id="unidade-cep"
                  value={form.cep}
                  inputMode="numeric"
                  maxLength={9}
                  placeholder="00000-000"
                  autoComplete="postal-code"
                  aria-describedby="unidade-cep-ajuda"
                  onChange={(e) => mudar("cep", e.target.value)}
                  className="cz-num"
                />
              </div>
            </div>
            <p id="unidade-cep-ajuda" className="text-xs text-text-secondary">
              {TEXTOS_DA_UNIDADE.cepAjuda}
            </p>
            {/* A regiao fica montada mesmo vazia: o leitor de tela anuncia o
                endereco montado quando ele aparece. */}
            <div aria-live="polite">
              {enderecoComposto ? (
                <div className="grid gap-1 rounded-xl bg-surface-subtle px-3.5 py-3 text-[13px] text-foreground">
                  <p className="text-xs font-semibold text-text-secondary">
                    {TEXTOS_DA_UNIDADE.comoFica}
                  </p>
                  <p className="break-words">{enderecoComposto}</p>
                </div>
              ) : null}
            </div>
            {form.enderecoAntigo && !enderecoComposto ? (
              <div className="grid gap-1 rounded-xl bg-surface-subtle px-3.5 py-3 text-[13px] text-foreground">
                <p className="text-xs font-semibold text-text-secondary">
                  {TEXTOS_DA_UNIDADE.enderecoAntigo}
                </p>
                <p className="break-words">{form.enderecoAntigo}</p>
                <p className="text-xs text-text-secondary">
                  {TEXTOS_DA_UNIDADE.enderecoAntigoAjuda}
                </p>
              </div>
            ) : null}
          </fieldset>

          <fieldset className="grid min-w-0 gap-3 border-t border-border pt-4">
            <legend className="text-sm font-bold text-text-strong">
              {TEXTOS_DA_UNIDADE.comoChegar}
            </legend>
            <p className="text-xs text-text-secondary">
              {TEXTOS_DA_UNIDADE.textosAoPaciente}
            </p>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="unidade-referencia">
                  {TEXTOS_DA_UNIDADE.referencia}
                </Label>
                <Contador
                  texto={form.referencia}
                  maximo={LIMITES_DO_CADASTRO.referencia}
                />
              </div>
              <Input
                id="unidade-referencia"
                value={form.referencia}
                maxLength={LIMITES_DO_CADASTRO.referencia}
                placeholder={TEXTOS_DA_UNIDADE.referenciaExemplo}
                onChange={(e) => mudar("referencia", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="unidade-mapa">
                {TEXTOS_DA_UNIDADE.linkDoMapa}
              </Label>
              <Input
                id="unidade-mapa"
                type="url"
                inputMode="url"
                value={form.link_do_mapa}
                maxLength={LIMITES_DO_CADASTRO.linkDoMapa}
                placeholder="https://"
                aria-describedby="unidade-mapa-ajuda"
                onChange={(e) => mudar("link_do_mapa", e.target.value)}
              />
              <p
                id="unidade-mapa-ajuda"
                className="text-xs text-text-secondary"
              >
                {TEXTOS_DA_UNIDADE.linkDoMapaAjuda}
              </p>
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="unidade-estacionamento">
                  {TEXTOS_DA_UNIDADE.estacionamento}
                </Label>
                <Contador
                  texto={form.estacionamento}
                  maximo={LIMITES_DO_CADASTRO.estacionamento}
                />
              </div>
              <Input
                id="unidade-estacionamento"
                value={form.estacionamento}
                maxLength={LIMITES_DO_CADASTRO.estacionamento}
                placeholder={TEXTOS_DA_UNIDADE.estacionamentoExemplo}
                onChange={(e) => mudar("estacionamento", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="unidade-acessibilidade">
                  {TEXTOS_DA_UNIDADE.acessibilidade}
                </Label>
                <Contador
                  texto={form.acessibilidade}
                  maximo={LIMITES_DO_CADASTRO.acessibilidade}
                />
              </div>
              <Input
                id="unidade-acessibilidade"
                value={form.acessibilidade}
                maxLength={LIMITES_DO_CADASTRO.acessibilidade}
                placeholder={TEXTOS_DA_UNIDADE.acessibilidadeExemplo}
                onChange={(e) => mudar("acessibilidade", e.target.value)}
              />
            </div>
          </fieldset>

          <div className="border-t border-border pt-4">
            <EditorDoHorarioDeFuncionamento
              idBase="unidade-horario"
              valor={form.horario}
              aoMudar={(horario) => mudar("horario", horario)}
              novaChave={novaChave}
            />
          </div>

          <div className="grid gap-1.5 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="unidade-observacao">
                {TEXTOS_DA_UNIDADE.observacao}
              </Label>
              <Contador
                texto={form.observacao_ao_paciente}
                maximo={LIMITES_DO_CADASTRO.observacaoAoPaciente}
              />
            </div>
            <Textarea
              id="unidade-observacao"
              value={form.observacao_ao_paciente}
              maxLength={LIMITES_DO_CADASTRO.observacaoAoPaciente}
              rows={3}
              aria-describedby="unidade-observacao-ajuda"
              onChange={(e) => mudar("observacao_ao_paciente", e.target.value)}
            />
            <p
              id="unidade-observacao-ajuda"
              className="text-xs text-text-secondary"
            >
              {TEXTOS_DA_UNIDADE.observacaoAjuda}
            </p>
          </div>

          <CampoDeMarcar
            id="unidade-ativa"
            rotulo="Unidade ativa"
            marcado={form.active}
            aoMudar={(marcado) => mudar("active", marcado)}
          />
        </div>
      </PainelDeCadastro>
    </div>
  );
}
