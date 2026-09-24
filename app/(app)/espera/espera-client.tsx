"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2, UserRoundPlus } from "lucide-react";
import { useMemo, useState } from "react";

import { DialogConfig } from "@/components/espera/dialog-config";
import { FaixaReoferta } from "@/components/espera/faixa-reoferta";
import { FilaDeEspera } from "@/components/espera/fila";
import {
  ModalAdicionar,
  type OpcaoDeCatalogo,
} from "@/components/espera/modal-adicionar";
import { PainelMetricas } from "@/components/espera/painel-metricas";
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

export function EsperaClient({
  clinicId,
  timezone,
  ehAdmin,
  podeEditar,
  dicaSemPermissao,
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
  filaInicial: EntradaDaEspera[];
  ofertasIniciais: OfertaEmAndamento[];
  metricasIniciais: MetricasDaEspera;
  config: ConfigDaEspera;
  procedimentos: OpcaoDeCatalogo[];
  profissionais: OpcaoDeCatalogo[];
  contatoParaAdicionar: { id: string; nome: string } | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  // O deep link (?adicionar=) so abre o modal para quem PODE escrever:
  // papel de leitura ve a tela normal, com o botao desabilitado e a dica.
  const [modalAberto, setModalAberto] = useState(
    contatoParaAdicionar !== null && podeEditar,
  );
  const [configAberta, setConfigAberta] = useState(false);

  useEsperaChannel(supabase, queryClient, clinicId);

  const { data: fila } = useQuery({
    queryKey: esperaKeys.fila(clinicId),
    queryFn: () => fetchFilaDeEspera(supabase, clinicId),
    initialData: filaInicial,
  });
  const { data: ofertas } = useQuery({
    queryKey: esperaKeys.oferta(clinicId),
    queryFn: () => fetchOfertasEmAndamento(supabase, clinicId),
    initialData: ofertasIniciais,
  });
  const { data: metricas } = useQuery({
    queryKey: esperaKeys.metricas(clinicId),
    queryFn: () => fetchMetricasDaEspera(supabase, clinicId),
    initialData: metricasIniciais,
  });

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
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {ehAdmin ? (
          <Button
            variant="outline"
            className="h-10"
            onClick={() => setConfigAberta(true)}
          >
            <Settings2 className="size-4" />
            Configurar reoferta
          </Button>
        ) : (
          <DisabledWithHint hint="Somente administradores alteram a configuração da reoferta">
            <Button variant="outline" className="h-10" disabled>
              <Settings2 className="size-4" />
              Configurar reoferta
            </Button>
          </DisabledWithHint>
        )}
        {podeEditar ? (
          <Button className="h-10" onClick={() => setModalAberto(true)}>
            <UserRoundPlus className="size-4" />
            Adicionar manualmente
          </Button>
        ) : (
          <DisabledWithHint hint={dicaSemPermissao}>
            <Button className="h-10" disabled>
              <UserRoundPlus className="size-4" />
              Adicionar manualmente
            </Button>
          </DisabledWithHint>
        )}
      </div>

      <PainelMetricas metricas={metricas} />

      {ofertas.length > 0 ? (
        <div className="grid gap-2">
          {ofertas.map((oferta) => (
            <FaixaReoferta
              key={oferta.id}
              oferta={oferta}
              timezone={timezone}
              podeEditar={podeEditar}
              dicaSemPermissao={dicaSemPermissao}
              aoMudar={invalidar}
            />
          ))}
        </div>
      ) : null}

      <FilaDeEspera
        entradas={fila}
        timezone={timezone}
        podeEditar={podeEditar}
        dicaSemPermissao={dicaSemPermissao}
        aoMudar={invalidar}
      />

      <ModalAdicionar
        clinicId={clinicId}
        aberto={modalAberto}
        onFechar={() => setModalAberto(false)}
        procedimentos={procedimentos}
        profissionais={profissionais}
        contatoInicial={contatoParaAdicionar}
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
