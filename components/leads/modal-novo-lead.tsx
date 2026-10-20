"use client";

import { useState } from "react";
import { toast } from "sonner";

import { criarLeadAction } from "@/app/(app)/leads/actions";
import type { OpcaoDeResponsavel } from "@/components/leads/filtros-leads";
import { OPCOES_DA_DECLARACAO } from "@/components/leads/importacao/passo-consentimento";
import { CANAIS } from "@/components/leads/rotulos";
import { Aviso } from "@/components/shared/aviso";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { normalizarTelefone } from "@/lib/domain/importacao";
import type { OpcaoDeclaracao } from "@/lib/integrations/importar-contatos";

// Criacao manual de lead (Tela 4). O telefone aceita os formatos brasileiros
// comuns e vira E.164 no submit (normalizarTelefone, o mesmo da importacao).
// Convenio ficou de fora desta versao: exigiria carregar o catalogo inteiro
// so para um select, e o convenio ja e editavel na ficha (o drawer do lead
// tem "Abrir ficha").
//
// Autorizacao para receber mensagens (decisao do dono em 20/10/2026, para a
// equipe poder iniciar a conversa pelo sistema): pergunta OPCIONAL, com as
// opcoes e a regra da declaracao da importacao ("Outra origem" exige a
// observacao). Sem resposta, o contato fica sem autorizacao, como sempre:
// cadastrar um lead NAO e autorizacao para receber mensagens (regra 3.3).
// A Server Action confere de novo e grava a autorizacao com a trilha.
//
// Responsavel: so membro ATIVO (achado 102). A Server Action confere de novo.

const SEM = "__sem__";

const DESCRICAO_SEM_AUTORIZACAO =
  "Sem autorização registrada, a clínica não envia mensagens para este contato. Dá para registrar depois, na ficha.";

export function ModalNovoLead({
  aberto,
  responsaveis,
  onFechar,
  aoCriar,
}: {
  aberto: boolean;
  /** Membros ativos, ja ordenados */
  responsaveis: OpcaoDeResponsavel[];
  onFechar: () => void;
  aoCriar: () => void;
}) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [canal, setCanal] = useState("");
  const [campanha, setCampanha] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [autorizacao, setAutorizacao] = useState<OpcaoDeclaracao | "">("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const opcaoDaAutorizacao = OPCOES_DA_DECLARACAO.find(
    (opcao) => opcao.valor === autorizacao,
  );

  const fechar = () => {
    setNome("");
    setTelefone("");
    setCanal("");
    setCampanha("");
    setResponsavel("");
    setAutorizacao("");
    setObservacao("");
    setErro(null);
    onFechar();
  };

  const salvar = async () => {
    setErro(null);
    const nomeAparado = nome.trim();
    if (nomeAparado.length === 1) {
      setErro("O nome precisa de pelo menos 2 letras, ou deixe em branco.");
      return;
    }
    const telefoneE164 = normalizarTelefone(telefone);
    if (!telefoneE164) {
      setErro(
        "Informe um telefone válido com DDD, por exemplo (85) 99999-0000.",
      );
      return;
    }
    const observacaoAparada = observacao.trim();
    if (autorizacao === "outra" && observacaoAparada.length < 2) {
      setErro("Descreva como o contato autorizou receber mensagens.");
      return;
    }
    setSalvando(true);
    const resultado = await criarLeadAction({
      name: nomeAparado || undefined,
      phone_e164: telefoneE164,
      source_channel: canal || undefined,
      source_campaign: canal && campanha.trim() ? campanha.trim() : undefined,
      owner_user_id: responsavel || undefined,
      autorizacao: autorizacao
        ? {
            opcao: autorizacao,
            ...(observacaoAparada ? { observacao: observacaoAparada } : {}),
          }
        : undefined,
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível criar o lead.");
      return;
    }
    if (resultado.aviso) {
      toast.warning(resultado.aviso);
    } else {
      toast.success(
        autorizacao
          ? "Lead criado com a autorização registrada"
          : "Lead criado",
      );
    }
    aoCriar();
    fechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(a) => (!a ? fechar() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo lead</DialogTitle>
          <DialogDescription>
            Cadastre quem chegou por fora do WhatsApp, como telefone ou balcão.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="lead-nome">Nome</Label>
            <Input
              id="lead-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lead-telefone">Telefone</Label>
            <Input
              id="lead-telefone"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="(85) 99999-0000"
              inputMode="tel"
              className="cz-num"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lead-origem">Origem</Label>
            <Select
              value={canal || SEM}
              onValueChange={(v) => {
                const novoCanal = v === SEM ? "" : v;
                setCanal(novoCanal);
                if (!novoCanal) {
                  setCampanha("");
                }
              }}
            >
              <SelectTrigger id="lead-origem" className="w-full">
                <SelectValue placeholder="Sem origem" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Sem origem</SelectItem>
                {CANAIS.map((opcao) => (
                  <SelectItem key={opcao.valor} value={opcao.valor}>
                    {opcao.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lead-campanha">Campanha</Label>
            <Input
              id="lead-campanha"
              value={campanha}
              onChange={(e) => setCampanha(e.target.value)}
              disabled={!canal}
              placeholder={canal ? "" : "Escolha a origem primeiro"}
              maxLength={120}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lead-responsavel">Responsável</Label>
            <Select
              value={responsavel || SEM}
              onValueChange={(v) => setResponsavel(v === SEM ? "" : v)}
            >
              <SelectTrigger id="lead-responsavel" className="w-full">
                <SelectValue placeholder="Sem responsável" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Sem responsável</SelectItem>
                {responsaveis.map((membro) => (
                  <SelectItem key={membro.id} value={membro.id}>
                    {membro.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lead-autorizacao">
              Autorização para receber mensagens (opcional)
            </Label>
            <Select
              value={autorizacao || SEM}
              onValueChange={(v) => {
                setAutorizacao(v === SEM ? "" : (v as OpcaoDeclaracao));
                if (v === SEM) {
                  setObservacao("");
                }
              }}
            >
              <SelectTrigger
                id="lead-autorizacao"
                className="w-full"
                aria-describedby="lead-autorizacao-ajuda"
              >
                <SelectValue placeholder="Não registrar agora" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Não registrar agora</SelectItem>
                {OPCOES_DA_DECLARACAO.map((opcao) => (
                  <SelectItem key={opcao.valor} value={opcao.valor}>
                    {opcao.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p
              id="lead-autorizacao-ajuda"
              className="text-xs text-text-secondary"
            >
              {opcaoDaAutorizacao?.descricao ?? DESCRICAO_SEM_AUTORIZACAO}
            </p>
          </div>
          {autorizacao ? (
            <div className="grid gap-1.5">
              <Label htmlFor="lead-autorizacao-observacao">
                Observação{" "}
                {autorizacao === "outra" ? "(obrigatória)" : "(opcional)"}
              </Label>
              <Textarea
                id="lead-autorizacao-observacao"
                rows={2}
                maxLength={300}
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Ex.: assinou a ficha de autorização na recepção"
              />
            </div>
          ) : null}
          {erro ? (
            <Aviso tom="alert" role="alert">
              {erro}
            </Aviso>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={fechar}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Criando..." : "Criar lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
