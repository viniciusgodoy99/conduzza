"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ListaEquipe } from "@/components/configuracoes/lista-equipe";
import type { MembroEquipe } from "@/components/configuracoes/lista-equipe";
import { PainelPapeis } from "@/components/configuracoes/painel-papeis";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConnectClient } from "@/components/whatsapp/connect-client";
import type { ConnectState } from "@/lib/actions/whatsapp-connect";

import { CodigoAcesso, PendentesList } from "./equipe-client";
import type { Pendente } from "./equipe-client";
import { InviteForm } from "./invite-form";

// Tela 12: a aba vive na URL (?aba=whatsapp) para link direto e para a volta
// do navegador funcionar, mesmo padrao de Cadastros.

const ABAS = [
  ["equipe", "Equipe e permissões"],
  ["whatsapp", "WhatsApp"],
] as const;

type AbaKey = (typeof ABAS)[number][0];

export function ConfiguracoesClient({
  abaInicial,
  equipe,
  pendentes,
  meuUserId,
  podeGerenciar,
  ehAdmin,
  dica,
  codigo,
  codigoAtivo,
  whatsapp,
}: {
  abaInicial?: string;
  equipe: MembroEquipe[];
  pendentes: Pendente[];
  meuUserId: string;
  podeGerenciar: boolean;
  ehAdmin: boolean;
  dica: string;
  codigo: string;
  codigoAtivo: boolean;
  whatsapp: {
    initial: ConnectState;
    connectedAt: string | null;
    providerName: string;
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const abaAtiva: AbaKey = ABAS.some(([key]) => key === abaInicial)
    ? (abaInicial as AbaKey)
    : "equipe";

  const trocarAba = (aba: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("aba", aba);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <Tabs value={abaAtiva} onValueChange={trocarAba} className="gap-4">
      <TabsList className="h-auto flex-wrap justify-start">
        {ABAS.map(([key, label]) => (
          <TabsTrigger key={key} value={key} className="min-h-9">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="equipe" className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Usuários e permissões</CardTitle>
            <CardDescription>
              Quem tem acesso a esta clínica e com qual papel.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <PendentesList
              pendentes={pendentes}
              podeGerenciar={podeGerenciar}
              ehAdmin={ehAdmin}
            />

            <ListaEquipe
              membros={equipe}
              meuUserId={meuUserId}
              podeGerenciar={podeGerenciar}
              ehAdmin={ehAdmin}
              dica={dica}
            />

            <div className="border-t pt-6">
              <h3 className="mb-4 text-sm font-semibold">
                Convidar por e-mail
              </h3>
              <InviteForm canInvite={podeGerenciar} hint={dica} />
            </div>

            <CodigoAcesso
              codigo={codigo}
              ativo={codigoAtivo}
              podeGerenciar={podeGerenciar}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>O que cada papel pode fazer</CardTitle>
            <CardDescription>
              Confira antes de escolher o papel de alguém da equipe.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PainelPapeis />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="whatsapp" className="grid gap-4">
        <p className="text-sm text-text-secondary">
          O número conectado aqui é o WhatsApp que a clínica usa para atender.
          Toda conversa de paciente entra e sai por ele, então desconectar
          interrompe o atendimento na hora.
        </p>
        <ConnectClient
          initial={whatsapp.initial}
          connectedAt={whatsapp.connectedAt}
          canManage={podeGerenciar}
          hint={dica}
          providerName={whatsapp.providerName}
        />
      </TabsContent>
    </Tabs>
  );
}
