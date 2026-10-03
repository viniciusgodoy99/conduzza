"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { SecaoDeAtividades } from "@/components/atividades/secao-de-atividades";
import { BlocoFicha } from "@/components/pacientes/comum";
import {
  atividadesKeys,
  type AtividadesDoContato,
  type ContatoDaAtividade,
  type EquipeDaAtividade,
} from "@/lib/queries/atividades";

// Cartao "Atividades" da ficha (Tela 9), no topo da coluna da direita: todas
// as pendentes e as ultimas 5 concluidas. O dado vem do SERVIDOR, na mesma
// carga que grava a trilha de leitura da ficha; depois de uma acao a ficha
// recarrega pelo servidor (router.refresh), como os outros blocos.

export function AtividadesDaFicha({
  clinicId,
  contato,
  atividades,
  equipe,
  timezone,
  podeEditar,
  dica,
  agoraInicial,
}: {
  clinicId: string;
  contato: ContatoDaAtividade;
  /** null quando a leitura falhou no servidor (o cartao mostra o erro) */
  atividades: AtividadesDoContato | null;
  /** null quando a leitura falhou: o dialogo busca sozinho ao abrir */
  equipe: EquipeDaAtividade | null;
  timezone: string;
  podeEditar: boolean;
  dica: string;
  agoraInicial: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const recarregar = () => {
    router.refresh();
    void queryClient.invalidateQueries({ queryKey: atividadesKeys.todas });
  };

  return (
    <BlocoFicha titulo="Atividades">
      <SecaoDeAtividades
        contato={contato}
        clinicId={clinicId}
        timezone={timezone}
        estado={atividades ? "pronto" : "erro"}
        atividades={atividades}
        aoTentarDeNovo={() => router.refresh()}
        aoMudar={recarregar}
        equipe={equipe ?? undefined}
        nomes={equipe?.nomes ?? {}}
        podeEditar={podeEditar}
        dica={dica}
        limite={50}
        mostrarConcluidas
        // Ja estamos na ficha: o atalho dela sairia daqui para ela mesma.
        comAtalhos={{ conversa: true, ficha: false }}
        agoraInicial={agoraInicial}
      />
    </BlocoFicha>
  );
}
