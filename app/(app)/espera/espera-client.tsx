"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2, UserRoundPlus } from "lucide-react";
import { useMemo, useState } from "react";

import { DialogConfig } from "@/components/espera/dialog-config";
import { CartaoReoferta } from "@/components/espera/faixa-reoferta";
import { FilaDeEspera } from "@/components/espera/fila";
import {
  ModalAdicionar,
  type ContatoEscolhido,
  type OpcaoDeCatalogo,
} from "@/components/espera/modal-adicionar";
import { PainelMetricas } from "@/components/espera/painel-metricas";
import { Aviso } from "@/components/shared/aviso";
import { DisabledWithHint } from "@/components/shared/permission-hint";
import { Button } from "@/components/ui/button";
import {
  esperaKeys,
  fetchFilaDeEspera,
  fetchMetricasDaEspera,
  fetchOfertasEmAndamento,
  type ConfigDaEspera,
  type EntradaDaEspera,
  type MetricasDaEspera,
  type OfertaEmAndamento,
} from "@/lib/queries/espera";
import { useEsperaChannel } from "@/lib/realtime/use-espera-channel";
import { createClient } from "@/lib/supabase/client";

// Tela 10, Lista de espera: fila agrupada, faixa da reoferta em andamento e
// as metricas do que a fila recupera. Tempo real invalida as chaves; a
// contagem regressiva da faixa e timer no cliente.
//
// Desenho do design system (docs/06 secao 5.8): a fila a esquerda e a coluna
// lateral (reoferta e desempenho) a direita a partir de 1280px, fixa ao
// rolar; abaixo disso a lateral sobe para o topo, como o brief pede ("faixa
// no topo", "painel superior").

export function EsperaClient({
  clinicId,
  timezone,
  ehAdmin,
  podeEditar,
  dicaSemPermissao,
  podeRegistrarAutorizacao,
  dicaAutorizacao,
  filaInicial,
  ofertasIniciais,
  metricasIniciais,
  config,
  procedimentos,
  profissionais,
  contatoParaAdicionar,
}: {
  clinicId: string;
  timezone: string;
  ehAdmin: boolean;
  podeEditar: boolean;
  dicaSemPermissao: string;
  /** Registrar a autorizacao de mensagens (chave de leads e pacientes). */
  podeRegistrarAutorizacao: boolean;
  dicaAutorizacao: string;
  filaInicial: EntradaDaEspera[];
  ofertasIniciais: OfertaEmAndamento[];
  metricasIniciais: MetricasDaEspera;
  config: ConfigDaEspera;
  procedimentos: OpcaoDeCatalogo[];
  profissionais: OpcaoDeCatalogo[];
  contatoParaAdicionar: ContatoEscolhido | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  // O deep link (?adicionar=) so abre o modal para quem PODE escrever:
  // papel de leitura ve a tela normal, com o botao desabilitado e a dica.
  const [modalAberto, setModalAberto] = useState(
    contatoParaAdicionar !== null && podeEditar,
  );
  // O paciente do link vale so para a primeira abertura: fechado o modal,
  // "Adicionar manualmente" volta a comecar pela busca.
  const [contatoDoLink, setContatoDoLink] = useState(contatoParaAdicionar);
  const [configAberta, setConfigAberta] = useState(false);

  useEsperaChannel(supabase, queryClient, clinicId);

  const filaQuery = useQuery({
    queryKey: esperaKeys.fila(clinicId),
    queryFn: () => fetchFilaDeEspera(supabase, clinicId),
    initialData: filaInicial,
  });
  const ofertasQuery = useQuery({
    queryKey: esperaKeys.oferta(clinicId),
    queryFn: () => fetchOfertasEmAndamento(supabase, clinicId),
    initialData: ofertasIniciais,
  });
  const metricasQuery = useQuery({
    queryKey: esperaKeys.metricas(clinicId),
    queryFn: () => fetchMetricasDaEspera(supabase, clinicId),
    initialData: metricasIniciais,
  });
  // A carga inicial vem do servidor (erro ali cai no error.tsx); aqui o erro
  // so pode ser de uma atualizacao, e o dado anterior continua na tela.
  const falhouAoAtualizar =
    filaQuery.isError || ofertasQuery.isError || metricasQuery.isError;
  const atualizando =
    filaQuery.isFetching || ofertasQuery.isFetching || metricasQuery.isFetching;

  const invalidar = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: esperaKeys.fila(clinicId) }),
      queryClient.invalidateQueries({ queryKey: esperaKeys.oferta(clinicId) }),
      queryClient.invalidateQueries({
        queryKey: esperaKeys.metricas(clinicId),
      }),
    ]);
  };

  return (
    <div className="flex flex-col gap-3.5">
      {/* "Adicionar manualmente" e o unico lime cheio da tela. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {ehAdmin ? (
          <Button variant="outline" onClick={() => setConfigAberta(true)}>
            <Settings2 />
            Configurar reoferta
          </Button>
        ) : (
          <DisabledWithHint hint="Somente administradores alteram a configuração da reoferta">
            <Button variant="outline" disabled>
              <Settings2 />
              Configurar reoferta
            </Button>
          </DisabledWithHint>
        )}
        {podeEditar ? (
          <Button onClick={() => setModalAberto(true)}>
            <UserRoundPlus />
            Adicionar manualmente
          </Button>
        ) : (
          <DisabledWithHint hint={dicaSemPermissao}>
            <Button disabled>
              <UserRoundPlus />
              Adicionar manualmente
            </Button>
          </DisabledWithHint>
        )}
      </div>

      {falhouAoAtualizar ? (
        <Aviso
          tom="warning"
          acao={
            <Button
              variant="ghost"
              disabled={atualizando}
              onClick={() => void invalidar()}
            >
              {atualizando ? "Tentando..." : "Tentar de novo"}
            </Button>
          }
        >
          Não foi possível atualizar a lista agora. A tela mostra a última
          versão carregada.
        </Aviso>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
        <div className="order-2 min-w-0 xl:order-1">
          <FilaDeEspera
            entradas={filaQuery.data}
            timezone={timezone}
            podeEditar={podeEditar}
            dicaSemPermissao={dicaSemPermissao}
            aoMudar={invalidar}
          />
        </div>
        {/* Fixa ao rolar, com altura maxima de uma tela (108px = barra
            superior de 60 e o respiro de 24 em cima e embaixo): com muitas
            vagas em reoferta a lateral rola por dentro, em vez de o fim do
            cartao ficar inalcancavel. */}
        <div className="order-1 grid cz-scroll min-w-0 items-start gap-3.5 md:grid-cols-2 xl:sticky xl:top-6 xl:order-2 xl:-m-1 xl:max-h-[calc(100dvh-108px)] xl:grid-cols-1 xl:overflow-y-auto xl:p-1">
          <CartaoReoferta
            ofertas={ofertasQuery.data}
            timezone={timezone}
            podeEditar={podeEditar}
            dicaSemPermissao={dicaSemPermissao}
            aoMudar={invalidar}
          />
          <PainelMetricas metricas={metricasQuery.data} />
        </div>
      </div>

      <ModalAdicionar
        clinicId={clinicId}
        aberto={modalAberto}
        onFechar={() => {
          setModalAberto(false);
          setContatoDoLink(null);
        }}
        procedimentos={procedimentos}
        profissionais={profissionais}
        contatoInicial={contatoDoLink}
        podeRegistrarAutorizacao={podeRegistrarAutorizacao}
        dicaAutorizacao={dicaAutorizacao}
        aoMudar={invalidar}
      />
      <DialogConfig
        aberto={configAberta}
        onFechar={() => setConfigAberta(false)}
        config={config}
        aoMudar={invalidar}
      />
    </div>
  );
}
