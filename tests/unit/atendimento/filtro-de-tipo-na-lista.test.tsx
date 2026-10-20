import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConversationList } from "@/components/atendimento/conversation-list";
import { casaTipo, type FiltroDeTipo } from "@/lib/domain/filtros-da-conversa";
import type { ConversationListItem } from "@/lib/queries/conversations";

// Filtro "Todos / Leads / Pacientes" da lista do Atendimento (pedido do dono
// em 20/10/2026). Aqui nao ha navegador: a marcacao da primeira carga (Todos
// ligado, contagem de cada lado, lugar na barra, alvo de 40px) e a regra que
// conta e filtra (casaTipo, a mesma nos dois). O clique, a escolha guardada
// no navegador e o vazio com o filtro ligado so se veem com navegador.

const EU = "11111111-1111-4111-8111-111111111111";
const GRUPO = "Filtrar por lead ou paciente";

function conversa(
  id: string,
  nome: string,
  kind: "lead" | "paciente",
  campos: Partial<ConversationListItem> = {},
): ConversationListItem {
  return {
    id,
    status: "aguardando_humano",
    assignee_user_id: null,
    unread_count: 0,
    awaiting_reply: true,
    last_message_at: "2026-10-20T14:30:00.000Z",
    last_inbound_at: "2026-10-20T14:30:00.000Z",
    last_preview: "Tem horário amanhã?",
    last_preview_kind: "texto",
    last_preview_author: "paciente",
    last_preview_author_user_id: null,
    tags: [],
    whatsapp_account_id: null,
    contact: {
      id: `contato-${id}`,
      name: nome,
      phone_e164: "+5585999990000",
      kind,
      funnel_stage: "novo",
      source_channel: null,
      source_campaign: null,
      first_contact_at: null,
    },
    ...campos,
  };
}

const LISTA = [
  conversa("1", "Ana Lead", "lead"),
  conversa("2", "Bruno Lead", "lead", {
    status: "em_atendimento",
    assignee_user_id: EU,
    awaiting_reply: false,
  }),
  conversa("3", "Carla Paciente", "paciente"),
];

function lista(conversations: ConversationListItem[] = LISTA): string {
  return renderToStaticMarkup(
    <ConversationList
      nomesDeEtapa={{ novo: "Novo" }}
      etiquetas={[]}
      conversations={conversations}
      viewerId={EU}
      authorNames={{}}
      timezone="America/Fortaleza"
      agoraInicial={Date.parse("2026-10-20T15:00:00.000Z")}
      selectedId={null}
      onSelect={() => undefined}
    />,
  );
}

/** Os botoes de um grupo de filtro: o texto (rotulo e contagem) e o estado. */
function botoesDoGrupo(html: string, nome: string) {
  const inicio = html.indexOf(`aria-label="${nome}"`);
  expect(inicio, `grupo "${nome}"`).toBeGreaterThan(-1);
  const grupo = html.slice(inicio, html.indexOf("</div>", inicio));
  return [...grupo.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(
    ([, atributos = "", miolo = ""]) => ({
      texto: miolo.replace(/<[^>]+>/g, ""),
      ligado: atributos.includes('aria-pressed="true"'),
      classes: (/class="([^"]*)"/.exec(atributos)?.[1] ?? "").split(/\s+/),
    }),
  );
}

describe("filtro Todos / Leads / Pacientes na lista", () => {
  it("fica logo abaixo da posse e antes da situação", () => {
    const html = lista();
    const posse = html.indexOf('aria-label="Filtrar por responsável"');
    const tipo = html.indexOf(`aria-label="${GRUPO}"`);
    const situacao = html.indexOf('aria-label="Filtrar por situação"');
    expect(posse).toBeGreaterThan(-1);
    expect(tipo).toBeGreaterThan(posse);
    expect(situacao).toBeGreaterThan(tipo);
  });

  it("chega em Todos, com a contagem de cada lado e o estado para o leitor de tela", () => {
    const html = lista();
    expect(html).toContain(`role="group" aria-label="${GRUPO}"`);
    expect(
      botoesDoGrupo(html, GRUPO).map(({ texto, ligado }) => ({
        texto,
        ligado,
      })),
    ).toEqual([
      { texto: "Todos 3", ligado: true },
      { texto: "Leads 2", ligado: false },
      { texto: "Pacientes 1", ligado: false },
    ]);
  });

  it("cada lado conta o mesmo conjunto que filtra, no lote inteiro", () => {
    const botoes = botoesDoGrupo(lista(), GRUPO);
    const ordem: FiltroDeTipo[] = ["todos", "leads", "pacientes"];
    ordem.forEach((filtro, indice) => {
      const quantos = LISTA.filter((c) => casaTipo(c.contact, filtro)).length;
      expect(botoes[indice]?.texto).toMatch(new RegExp(` ${quantos}$`));
    });
    // Todos e a posse "Todas" contam o mesmo lote.
    expect(lista()).toMatch(/Todas <span[^>]*>3<\/span>/);
  });

  it("lado sem ninguém continua na tela, com zero", () => {
    const soLeads = LISTA.filter((c) => c.contact.kind === "lead");
    expect(botoesDoGrupo(lista(soLeads), GRUPO).map((b) => b.texto)).toEqual([
      "Todos 2",
      "Leads 2",
      "Pacientes 0",
    ]);
  });

  it("alvo de 40px em cada opção, e nenhum travessão nos rótulos", () => {
    const botoes = botoesDoGrupo(lista(), GRUPO);
    expect(botoes).toHaveLength(3);
    for (const botao of botoes) {
      expect(botao.classes).toContain("hit-40");
      expect(botao.texto).not.toMatch(/[—–]/);
    }
    expect(GRUPO).not.toMatch(/[—–]/);
  });

  it("em Todos a lista mostra leads e pacientes, sem o vazio de filtro", () => {
    const html = lista();
    for (const nome of ["Ana Lead", "Bruno Lead", "Carla Paciente"]) {
      expect(html).toContain(nome);
    }
    expect(html).not.toContain("Nenhuma conversa com esses filtros");
  });
});
