"use client";

import { useState } from "react";
import { toast } from "sonner";

import { criarLeadAction } from "@/app/(app)/leads/actions";
import { CANAIS } from "@/components/leads/rotulos";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { normalizarTelefone } from "@/lib/domain/importacao";

// Criacao manual de lead (Tela 4). O telefone aceita os formatos brasileiros
// comuns e vira E.164 no submit (normalizarTelefone, o mesmo da importacao).
// Nada aqui fala de consentimento: cadastrar um lead NAO e autorizacao para
// receber mensagens (regra 3.3); a autorizacao e registrada na ficha, com
// fonte e evidencia. Convenio ficou de fora desta versao: exigiria carregar
// o catalogo inteiro so para um select, e o convenio ja e editavel na ficha.

const SEM = "__sem__";

export function ModalNovoLead({
  aberto,
  membros,
  onFechar,
  aoCriar,
}: {
  aberto: boolean;
  membros: Record<string, string>;
  onFechar: () => void;
  aoCriar: () => void;
}) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [canal, setCanal] = useState("");
  const [campanha, setCampanha] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const responsaveis = Object.entries(membros)
    .map(([id, nomeMembro]) => ({ id, nome: nomeMembro }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  const fechar = () => {
    setNome("");
    setTelefone("");
    setCanal("");
    setCampanha("");
    setResponsavel("");
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
    setSalvando(true);
    const resultado = await criarLeadAction({
      name: nomeAparado || undefined,
      phone_e164: telefoneE164,
      source_channel: canal || undefined,
      source_campaign: canal && campanha.trim() ? campanha.trim() : undefined,
      owner_user_id: responsavel || undefined,
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Não foi possível criar o lead.");
      return;
    }
    toast.success("Lead criado");
    aoCriar();
    fechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(a) => (!a ? fechar() : null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Novo lead</DialogTitle>
          <DialogDescription>
            Cadastre quem chegou por fora do WhatsApp, como telefone ou balcão.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="lead-nome">Nome</Label>
            <Input
              id="lead-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="h-10"
              maxLength={120}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lead-telefone">Telefone</Label>
            <Input
              id="lead-telefone"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="(85) 99999-0000"
              inputMode="tel"
              className="h-10"
            />
          </div>
          <div className="grid gap-2">
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
              <SelectTrigger id="lead-origem" className="h-10 w-full">
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
          <div className="grid gap-2">
            <Label htmlFor="lead-campanha">Campanha</Label>
            <Input
              id="lead-campanha"
              value={campanha}
              onChange={(e) => setCampanha(e.target.value)}
              disabled={!canal}
              placeholder={canal ? "" : "Escolha a origem primeiro"}
              className="h-10"
              maxLength={120}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lead-responsavel">Responsável</Label>
            <Select
              value={responsavel || SEM}
              onValueChange={(v) => setResponsavel(v === SEM ? "" : v)}
            >
              <SelectTrigger id="lead-responsavel" className="h-10 w-full">
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
          {erro ? (
            <p role="alert" className="text-sm [color:var(--alert-text)]">
              {erro}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="h-10" onClick={fechar}>
              Cancelar
            </Button>
            <Button className="h-10" onClick={salvar} disabled={salvando}>
              {salvando ? "Criando..." : "Criar lead"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
