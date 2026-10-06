# Arquitetura Técnica
### Conduzza Clínicas, V1

---

## 1. Decisão de stack e por quê

| Camada | Escolha | Motivo |
|---|---|---|
| Front e back | **Next.js 15, App Router** | Server Components reduzem código de cliente. Server Actions eliminam metade da camada de API. Um repositório só |
| Banco | **Supabase Postgres** | RLS resolve isolamento multi-tenant no nível do banco, que é o que a LGPD art. 11 exige. Postgres dá exclusion constraint para conflito de agenda, que é a trava mais importante do produto |
| Auth | **Supabase Auth** | Integra com RLS via JWT. Convite por e-mail pronto |
| Tempo real | **Supabase Realtime** | Inbox e Agenda precisam atualizar sozinhos. Sem isso, duas recepcionistas se atropelam |
| Filas | **`job_queue` + motor por `pg_cron`** | Régua de mensagem é trabalho agendado, não requisição HTTP. Desde 02/09/2026 o `pg_cron` com `pg_net` chama `/api/webhooks/motor` na Vercel a cada 20 s (entrada `motor-fila`) e a manutenção a cada minuto (`motor-manutencao`); a rota reivindica jobs com `FOR UPDATE SKIP LOCKED` (`claim_jobs_por_clinica`, com prioridade: confirmação antes de follow-up). Não existe worker em servidor: `npm run worker` é ferramenta local e ponte de emergência que roda o mesmo motor. `worker_heartbeat` alimenta a faixa "as mensagens automáticas estão paradas", e `/api/webhooks/saude` responde 503 para um monitor externo quando o motor para ou atrasa. Runbook: `supabase/operacao/motor-por-cron.md` |
| Webhook WhatsApp | **Edge Function (Deno)** | Precisa responder em menos de 5 segundos para a Meta não reenviar. Function isolada, sem cold start de Next |

### Alerta de residência de dado

`[DECISÃO PENDENTE]` A spec (seção 7.1) recomenda datacenter no Brasil, porque isso remove a discussão de transferência internacional da LGPD (art. 33) para tudo que não seja o LLM. **Ao criar o projeto Supabase, escolher a região `sa-east-1` (São Paulo).** Se a região escolhida for outra, isso vira uma cláusula contratual obrigatória e um item do RIPD.

A chamada ao LLM é transferência internacional de qualquer forma (o provedor, a OpenAI, não tem região no Brasil nem na América do Sul; seção 14). Isso precisa estar no termo de uso da clínica e no RIPD. Não é impeditivo, é obrigação de transparência.

---

## 2. Estrutura de pastas

```
app/
├── (auth)/                       login, convite, recuperação
├── (app)/                        área logada, exige sessão + clínica ativa
│   ├── inicio/                   Tela 5, dashboard
│   ├── atendimento/              Tela 1, inbox
│   ├── agenda/                   Tela 3
│   ├── leads/                    Tela 4
│   ├── pacientes/                Tela 9
│   ├── confirmacoes/             Tela 2
│   ├── espera/                   Tela 10
│   ├── relatorios/               Tela 11
│   ├── agente/                   Tela 6
│   ├── automacoes/               Tela 7
│   ├── cadastros/                Tela 8
│   └── configuracoes/            Tela 12
├── (onboarding)/whatsapp/        Tela 13
├── (admin)/                      Tela 14, visão do dono do produto
└── api/
    ├── webhooks/whatsapp/        fallback, o principal é Edge Function
    └── publico/clique/           aviso do clique rastreado pelo site (F1 do Google, 04/10/2026), sem login

public/
└── rastreio/v1.js                a linha de script que a clínica cola no site (F1 do Google), estática

components/
├── ui/                           shadcn, não editar à mão sem necessidade
├── shared/                       StatusChip, EmptyState, PageHeader, DataTable
└── <dominio>/                    componentes de cada módulo

lib/
├── supabase/                     client, server, middleware
├── integrations/
│   ├── whatsapp/                 Cloud API: envio, template, webhook, custo
│   ├── meta/                     Graph da Meta: capi.ts (devolução de conversões), payload.ts,
│   │                             insights.ts (leitura do investimento, Fase 4, e consulta do anúncio pelo id,
│   │                             04/10/2026) e versao.ts (versão única da Graph); login.ts (login da Meta,
│   │                             04/10/2026, ainda sem uso: é da F3, Conectar com a Meta)
│   ├── google/                   Google Ads (ads.ts, conta-de-servico.ts, oauth.ts, erros.ts, versao.ts),
│   │                             04/10/2026, ainda sem uso: é da F2; a F1 (seção 13) não usa nada daqui
│   ├── llm/                      agente, ferramentas, filtro de conformidade
│   └── billing/                  gateway de pagamento
├── jobs/                         motor da fila (motor.ts, worker.ts) e executores (regua.ts, conversao-meta.ts,
│                                 lista-espera.ts, gasto-meta.ts, o sincronizar_gasto_meta da Fase 4, e
│                                 resolver-anuncio-meta.ts, a consulta dos anúncios pelo id de 04/10/2026)
├── domain/                       regras de negócio puras, sem I/O, testáveis
│   ├── scheduling.ts             disponibilidade, hold, conflito
│   ├── cadence.ts                cálculo de quando disparar cada passo de régua
│   ├── attribution.ts            origem do lead (inclui os códigos de clique do site, F1 do Google)
│   ├── rastreio-do-site.ts       formatos, corpo do aviso, link com o código e a linha do script (F1 do Google)
│   ├── meta-anuncios.ts          conta act_, problemas da leitura do investimento, dias lidos (Fase 4)
│   └── custo-por-lead.ts         divisor, cobertura e textos do custo por lead (Fase 4)
└── utils/                        formatadores pt-BR, datas, moeda

supabase/
├── migrations/                   SQL versionado, uma migration por mudança
└── functions/
    ├── whatsapp-webhook/         recebe da Meta
    ├── job-worker/               PREVISTO, não construído: hoje quem processa job_queue é scripts/worker.ts
    └── ai-agent/                 orquestra o agente

docs/                             esta documentação
```

---

## 3. Multi-tenant

### Modelo

Um usuário pode pertencer a mais de uma clínica (a agência acessa várias). A relação vive em `clinic_member (user_id, clinic_id, role)`.

### RLS, o padrão a repetir em toda tabela

```sql
-- função auxiliar, criada uma vez
create or replace function public.user_clinic_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select clinic_id from clinic_member where user_id = auth.uid()
$$;

-- padrão aplicado a toda tabela de negócio
alter table contact enable row level security;

create policy "membro le da propria clinica" on contact
  for select using (clinic_id in (select public.user_clinic_ids()));

create policy "membro escreve na propria clinica" on contact
  for all using (clinic_id in (select public.user_clinic_ids()))
       with check (clinic_id in (select public.user_clinic_ids()));
```

**Regra:** nenhuma migration que cria tabela de negócio é aceita sem RLS habilitada e policy no mesmo arquivo.

### Permissão por papel

RLS garante o isolamento entre clínicas. **Permissão por papel** (Admin, Gestor, Recepção, Profissional, Leitura) é uma segunda camada, aplicada em policy específica ou na Server Action. A matriz está na seção 5 do brief de telas.

O Service Role Key ignora RLS. **Nunca em código que chegue ao browser.** Na prática ele roda no servidor: no motor da fila, na ingestão do WhatsApp, na rota pública do clique do site (seção 13, que não tem sessão e só chama uma função de registro com o corpo validado) e nas Server Actions que gravam o que a sessão não pode gravar (por exemplo, os segredos da seção 10 e a situação da leitura do investimento da Meta), sempre **depois** da guarda de papel.

---

## 4. Fluxo de mensagem recebida

```
Paciente manda mensagem
        |
        v
Meta Cloud API  --POST-->  Edge Function `whatsapp-webhook`
        |
        |  1. valida assinatura (X-Hub-Signature-256)
        |  2. responde 200 IMEDIATAMENTE (a Meta reenvia se demorar mais de 5s)
        |  3. insere em `message` com `wa_message_id` unique (idempotência)
        |  4. atualiza `conversation.window_expires_at = agora + 24h`
        |  5. enfileira job `process_inbound`
        v
Realtime empurra a mensagem para o Inbox aberto na tela
        |
        v
Worker pega o job `process_inbound`
        |
        |  a conversa está em `ia_atendendo`?
        |    nao  -> fim, humano cuida
        |    sim  -> chama `ai-agent`
        v
Agente monta contexto (persona + base de conhecimento + catálogo + histórico)
        |
        |  decide: responder, usar ferramenta, ou escalar
        v
FILTRO DE CONFORMIDADE  <-- roda SEMPRE, depois do LLM, antes do envio
        |
        |  bloqueou -> escala para humano, grava `ai_decision_log`, NÃO envia
        |  passou   -> envia pela Cloud API, grava `message` com custo
        v
Realtime atualiza a tela
```

### Ferramentas do agente (function calling)

| Ferramenta | O que faz | Trava |
|---|---|---|
| `buscar_procedimento` | preço, duração, convênios aceitos | lê de `service_link` **ativo**, nunca de texto livre; `professional_insurance` e `procedure_insurance` (convênio pelo médico, 02/10/2026) são só do cadastro e não são lidas pela IA |
| `buscar_horario` | primeiros horários livres | só oferece com `sl.bookable_by_ai and pr.bookable_by_ai` (a chave do vínculo **e** a do procedimento) |
| `reservar_horario` | cria `slot_hold` de 10 min | expira sozinho |
| `agendar` | confirma o hold e cria `appointment` | falha se o hold expirou |
| `remarcar` / `cancelar` | move ou cancela | cancelamento dispara reoferta da lista de espera |
| `entrar_lista_espera` | adiciona à fila | |
| `escalar_humano` | muda status para `aguardando_humano` | **obrigatória** em: sintoma, pedido de humano, insatisfação, menor de idade, valor fora da tabela, 2 falhas seguidas |

**Por que as duas chaves (convênio pelo médico, 02/10/2026):** desde então `service_link` tem dois escritores, a RPC do procedimento e a do profissional (cascata do convênio), e o Salvar do procedimento grava a sincronia dos vínculos e a linha do procedimento em passos separados (`docs/04`, seção 2). No meio desse Salvar, a chave do vínculo e a do procedimento podem divergir por um instante; conferindo as duas, qualquer ordem de gravação fica segura. O vínculo continua sendo a fonte do preço, da duração e do convênio aceito: o convênio que o profissional atende e o que cobre o procedimento só decidem quais vínculos existem e estão ativos. O que a IA faz quando o paciente pede um convênio que o profissional não atende ainda não está definido (backlog, entrada "Convênio pelo médico").

### Filtro de conformidade

Camada separada, com testes próprios. Recebe o texto que o LLM produziu e devolve `{ aprovado: boolean, motivo?: string }`. Bloqueia: triagem de sintoma, orientação clínica, promessa de resultado, indicação de medicamento ou dosagem, diagnóstico, oferta casada.

Implementar como combinação de regras determinísticas (lista de padrões) **e** uma verificação por modelo. Regra determinística sozinha vaza. Modelo sozinho não é auditável. Os dois juntos são defensáveis.

---

## 5. Fluxo de mensagem enviada (réguas)

```
pg_cron chama o motor na Vercel a cada 20 s (planner a cada minuto)
        |
        v
Edge Function `job-worker` faz SELECT ... FOR UPDATE SKIP LOCKED em `job_queue`
        |
        v
Para cada job de régua:
   1. o contato tem `consent.active = true`?      nao -> pula e conta como bloqueado
   2. a condição de parada foi atingida?           sim -> cancela os passos seguintes
   3. está dentro da janela de envio permitida?    nao -> reagenda
   4. a conversa está dentro da janela de 24h?
         sim -> pode mandar texto livre (custo zero)
         nao -> só template aprovado (custo cheio)
   5. o teto de gasto da clínica já estourou?      sim -> pausa e notifica
   6. envia, grava `message` com `cost_estimate`, grava `cadence_run`
```

**Backoff e idempotência:** todo job tem `attempts` e `next_attempt_at`. Falha de rede reagenda com backoff exponencial. Job tem chave natural (`contact_id + step_id + scheduled_for`) para não duplicar envio.

---

## 6. Conflito de agenda, a trava mais importante

Duas fontes marcam ao mesmo tempo: a recepcionista na tela e a IA na conversa. Checar disponibilidade em código e depois inserir **não** resolve, porque há corrida entre a checagem e a inserção.

A trava vive no banco:

```sql
create extension if not exists btree_gist;

alter table appointment
  add constraint sem_sobreposicao_por_profissional
  exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status not in ('cancelado_paciente','cancelado_clinica'));
```

O mesmo padrão vale para `resource_id` (sala, cabine, equipamento), que é exigência do nicho de estética: dois procedimentos podem precisar do mesmo laser.

`slot_hold` participa da checagem de disponibilidade, mas com expiração. Job periódico limpa holds vencidos.

---

## 7. Custo e limite de gasto

- Toda linha de `message` enviada grava `cost_estimate`, `pricing_category` (`utility`, `marketing`, `service`) e `billable` (falso quando dentro da janela de 24h).
- `clinic.spend_cap_cents` com pausa automática. Alertas em 50%, 80% e 95%.
- `[PENDENTE]` A tabela de preço por mensagem da Meta no Brasil em BRL não foi levantada (pendência P1 da spec). Implementar como **tabela de configuração** `message_pricing (category, currency, cents, valid_from)`, nunca como número fixo no código. O preço muda e vai mudar.

---

## 8. White-label

- `clinic_branding`: logo horizontal e ícone, cada um em versão clara e escura, cor primária, nome do produto.
- Cor primária entra como **CSS custom property** no `<html>` a partir do servidor. Nada de recompilar Tailwind por cliente.
- **Nomenclatura parametrizável:** `clinic_branding.labels jsonb` com as chaves `profissional`, `procedimento`, `paciente`, `consulta`. Toda string de interface que use esses termos passa por um helper `t(chave)`. Custo agora é baixo. Custo depois é reescrever a interface inteira quando virar "Conduzza Advogados".

---

## 9. Camada de integração com PMS (V2, mas decidida agora)

`appointment.source` é `interna` ou `externa`, com `external_id`. Isso entra **no V1** mesmo sem nenhuma integração construída, porque adicionar depois é reescrever a agenda.

Ordem de integração quando chegar a hora (justificada no benchmark): Feegow (API pública documentada), depois Ninsaúde e Shosp, depois Docplanner e Trinks (exigem acordo), iClinic por último e só com acordo comercial com a Afya, porque não tem API pública.

---

## 10. Ambientes

| Ambiente | Uso |
|---|---|
| Local | Supabase CLI local, número de teste da Meta, dados fictícios |
| Homologação | Projeto Supabase separado, **dados fictícios**. Nunca testar régua com telefone de paciente real |
| Produção | Projeto Supabase em `sa-east-1`, backup diário, restauração testada |

**Segredos.** Segredo da plataforma (chave de serviço do Supabase, token de administração do provedor de WhatsApp, segredos do motor) fica em variável de ambiente: `.env.example` versionado, `.env` nunca. Segredo **de cada clínica** fica no banco, numa tabela irmã `*_secret` (`whatsapp_account_secret`, com o token da instância do WhatsApp e o segredo do webhook; `meta_ads_account_secret`, com o token da API de conversões e, desde a Fase 4, o token de leitura de anúncios `insights_access_token`), com RLS ligada e **nenhuma** policy, lida e escrita só pela service role, depois da guarda de papel. Em `meta_ads_account_secret`, desde a migration `20261003100000`, `anon` e `authenticated` não têm grant nenhum (a sessão recebe 42501 até no `select`).

**O token fica em texto puro na coluna** (sem criptografia no banco): a proteção é a sessão não enxergar a tabela (sem policy e, no segredo da Meta, sem grant) e a regra de nunca devolver o valor. O valor nunca volta para a tela (o campo é só de escrita e a tela recebe só se existe), nunca vai para log nem para `job_queue.last_error`, e nenhuma função do banco o devolve: as que gravam a leitura do investimento recebem só o sha256 dele, para recusar a escrita de uma leitura feita com o token antigo. Na chamada à Meta, o token de leitura vai no cabeçalho `Authorization` e o da API de conversões no corpo do POST; nunca na URL.

---

## 11. Observabilidade

Monitorar, com alerta: disponibilidade, taxa de erro do webhook, tamanho da `job_queue` (fila crescendo é régua parando), **quality rating do número por clínica** (rebaixamento é incidente de produto, precisa aparecer antes de a clínica reclamar), gasto contra teto, e latência do LLM.

Log de aplicação **nunca** contém conteúdo de mensagem de paciente. Guardar identificador, não texto.

---

## 12. Leitura do investimento da Meta (Fase 4 das métricas, 03/10/2026)

Construída e publicada em 03/10/2026. Modelo no `docs/04` (seção 14), operação no `supabase/operacao/motor-por-cron.md` ("Leitura do investimento da Meta"). A consulta dos anúncios pelo id (publicada em 04/10/2026) está no fim desta seção.

```
manutenção (pg_cron, a cada minuto)       "Testar leitura" que deu certo      "Atualizar agora"
  enfileirar_gasto_meta_do_dia()              (Server Action)                    (Server Action, 10 min)
        \                                          |                                 /
         +---------> enfileirar_sincronizacao_de_gasto_meta(clinica, origem) <-----+
                      um job vivo por clínica; recusa clínica de teste,
                      leitura pausada (menos na origem do teste) e pedido cedo demais
                                   |
                                   v
                job_queue: sincronizar_gasto_meta (até 5 tentativas)
                                   |
             motor (Vercel): reivindicação própria, 2 por passagem,
             cada job num grupo só dele, fora da raia da clínica
                                   |
                                   v
             lib/jobs/gasto-meta.ts: lê conta e token pela service role,
             lib/integrations/meta/insights.ts lê a Meta (prazo de 35 s)
                                   |
             ok -> regravar_gasto_meta (uma transação)   falha -> registrar_falha_do_gasto_meta
```

- **Integração** (`lib/integrations/meta/insights.ts`): token só no cabeçalho `Authorization`, conta conferida contra `^act_[0-9]{5,20}$` antes de entrar na URL, host fixo, paginação pelo cursor `after` (o `paging.next` da resposta nunca é seguido), até 500 linhas por página e 40 páginas. Consulta que a Meta acusa como pesada, que passa de 40 páginas ou que não responde no tempo é dividida ao meio, até 2 vezes. Repete na hora até 2 vezes só quando a Meta está indisponível, com backoff (metade fixa, metade sorteada); limite de chamadas nunca repete na hora e devolve a espera lida dos cabeçalhos. A partir de 75% do uso informado pela Meta espera entre chamadas, e a partir de 95% para. O resultado carrega só códigos: a mensagem da Meta nunca sai da função que a classifica. Versão da Graph num lugar só (`versao.ts`, `v26.0`), usada também pela devolução de conversões.
- **Janela:** lê por anúncio e por dia e o total da conta por dia, no fuso **da conta**. `DIAS_DA_LEITURA_DIARIA` (30) dias por leitura; `DIAS_DA_PRIMEIRA_LEITURA` (60) na primeira leitura, na troca de conta e na volta depois de mais de 30 dias parada (constantes em `lib/domain/meta-anuncios.ts`, decisão D4, mantida pelo dono em 04/10/2026).
- **Desfecho por tipo de problema:** a Meta recusou o token, a permissão ou a conta: grava o problema e **pausa** o diário; pedido recusado: grava o problema, sem pausa; Meta fora do ar, prazo esgotado, resposta que não se reconhece, consulta pesada: repete pelo backoff do motor e grava o problema só na última tentativa; limite de chamadas: devolve o job para daqui a 5 a 60 minutos; a gestão trocou a conta ou o token durante a leitura: devolve na hora e nada velho é gravado.
- **Por que reivindicação e grupo próprios:** o job não tem número de WhatsApp, então a raia dele seria a clínica, e uma leitura de até 40 segundos em série com a integração da mesma clínica faria a segunda tarefa voltar por falta de orçamento da passagem.
- **Resultados** lê pela sessão a função `campanhas_do_periodo` (`SECURITY INVOKER`): as contagens de leads são as mesmas para todo papel e o investimento sai nulo fora de administrador e gestor. O custo por lead é calculado no TypeScript (`lib/domain/custo-por-lead.ts`), com o divisor numa constante (decisão D2, mantida pelo dono em 04/10/2026).

### Consulta dos anúncios pelo id (origem real do lead de anúncio, 04/10/2026)

Construída e publicada em 04/10/2026 (migration `20261004100000` aplicada na produção, conferido em `supabase_migrations.schema_migrations`). Modelo no `docs/04` (seção 14.9), operação no `supabase/operacao/motor-por-cron.md` ("Consulta dos anúncios da Meta"), plano e pontos para o dono no backlog. O canal do WhatsApp entrega só o clique e o id do anúncio; a leitura diária acima não devolve anúncio arquivado nem apagado. Este caminho pergunta à Meta, pelo id, a campanha e o conjunto de cada anúncio de onde um lead veio, e grava no mesmo mapa `meta_anuncio`, que é a fonte única do nome da campanha do lead (o contato guarda só o `source_ad_id`).

```
primeiro clique de um anúncio     fim do sincronizar_gasto_meta     "Testar leitura" que deu certo
  (ingestão, service role)            que deu certo (gasto-meta.ts)   (Server Action; ignora a pausa)
        \                                  |                                 /
         +---> enfileirar_resolucao_de_anuncios_meta(clinica, origem) <-----+
                um job vivo por clínica; recusa clínica de teste, falta de conta ou token,
                leitura pausada e "nada a resolver"; todos em melhor esforço (falha só vira log)
                                   |
                                   v
              job_queue: resolver_anuncio_meta (até 5 tentativas)
                                   |
             motor (Vercel): o mesmo 4º trilho do gasto (KINDS_DE_GASTO),
             2 por passagem, cada job num grupo só dele (custo estimado 20 s)
                                   |
                                   v
             lib/jobs/resolver-anuncio-meta.ts: lê conta e token pela service role,
             anuncios_meta_a_resolver (até 20) -> resolverAnuncios (insights.ts, 15 s)
                                   |
             gravar_resolucao_de_anuncios_meta (sha256 do token)   falha da conta -> registrar_falha_do_gasto_meta
                                   |
             ainda há anúncio devido: volta já; nova tentativa marcada: volta nessa hora; senão conclui
```

- **Integração** (`resolverAnuncios` em `lib/integrations/meta/insights.ts`, reaproveitando o contexto e o `pedir` da leitura): até duas chamadas por anúncio, `GET /v26.0/{ad_id}/insights` com `date_preset=maximum` e, quando ela volta sem linha, pesada demais ou sem resposta, `GET /v26.0/{ad_id}` com as expansões de conjunto e campanha. Até 20 anúncios distintos por execução, 8 s por requisição e 15 s no total; o que não cabe volta como "não tentado" e continua pendente no banco. Id fora de `^[0-9]{1,32}$` nunca entra na URL. Nada é logado, e o resultado leva só ids, nomes e códigos numéricos.
- **A falha de um anúncio nunca pausa a leitura diária:** 100/33, 803 e HTTP 404 viram recusa `inacessivel` daquele anúncio; permissão recusada (10, 200 a 299, 294, 100/3191001, HTTP 403) leva a uma conferência da conta salva por lote (a mesma chamada do "Testar leitura"): a conta responde, o anúncio fica `inacessivel`; a conta também recusa, o lote para com a falha da conta e o job segue a ação do gasto (pausar, pela `registrar_falha_do_gasto_meta`). Conta do anúncio diferente da salva vira `outra_conta` e não entra no mapa; 100 genérico, código desconhecido ou linha torta viram `resposta_invalida`; a segunda chamada recusada vira `sem_entrega_ainda`. Token, limite da Meta, versão encerrada e Meta fora do ar interrompem o lote como no gasto.
- **Novas tentativas** calculadas pelo banco (`sem_entrega_ainda` 1 h, 6 h, 24 h e depois diária até 7 dias; `resposta_invalida` 24 h; `inacessivel` e `outra_conta` só com outra conta ou outro token). O job só segue a `proxima_tentativa_em` devolvida. A volta é por `reagendar_job` (não queima tentativa, conta no teto de 20 devoluções); no teto o job falha, e o próximo pedido cria outro, porque o pendente vive nos contatos, não no job.
- **Segredo:** o token fica no job e no cabeçalho `Authorization`; no banco vai só o sha256, com que as funções conferem se a configuração mudou no meio (`config_mudou`: nada é gravado). Log e `last_error` só com códigos e contagens: nem token, nem id ou nome de anúncio, nem mensagem da Meta.
- **Ingestão** (`lib/integrations/whatsapp/ingest.ts`): a captura do anúncio roda antes da atribuição por texto. Grava os ids do clique (primeiro clique vence) e, num update separado, a origem de anúncio, só com canal, método e campanha vazios. No primeiro clique registra o diagnóstico `anuncio_recebido` (só nomes de chave) e pede a consulta.

---

## 13. Google: clique rastreado pelo site (F1 do Google, 04/10/2026)

Construída em 04/10/2026; **migration `20261005100000_clique_do_site.sql` ainda não aplicada e nada publicado**. Pedido do dono no mesmo dia: o anúncio do Google leva ao **site** da clínica, e a origem e a campanha do lead vêm do Google, sem cadastro manual. Modelo no `docs/04` (seção 15), regra na spec (10.13 e 11.15), tela no brief (Tela 12, aba Anúncios do Google), plano e pendências no backlog (entrada "Origem e campanha do Google Ads").

**Sem credencial nenhuma do Google e sem serviço externo:** nada desta seção fala com a API do Google, então nada vai para `lib/integrations/`. As bibliotecas de `lib/integrations/google/` (nome e gasto das campanhas) são da F2 e continuam sem uso.

**Por que script com aviso, e não redirecionador** (o levantamento anterior propunha a rota `/r/[clinica]`, que gravava e redirecionava): o link do site continua indo direto ao `wa.me`. Se a Vercel ou o Supabase caírem, o paciente chega ao WhatsApp do mesmo jeito e só a atribuição se perde; não há redirecionamento aberto nem telefone na nossa URL; e nada nosso entra no anúncio (o Google reprova destino que redireciona para outro domínio, "Destination mismatch"). O endereço do Conduzza **nunca** é destino de anúncio: só o botão do site usa a linha.

```
anúncio do Google -> site da clínica (?gclid=... &gad_campaignid=... &cz_campanha=...)
                         |
        public/rastreio/v1.js (a linha que a clínica cola; estático, ES5, sem dependência)
        só age com sinal do Google na URL ou no sessionStorage da aba
                         |
   toque no link do WhatsApp: " [#CODIGO]" no fim do text  ------>  wa.me (o paciente segue direto)
                         |
   aviso: sendBeacon (text/plain, sem preflight) ou fetch keepalive no-cors
                         v
   POST /api/publico/clique (sem login; fora do middleware)
   corpo até 2 KB, UTF-8 estrito, Zod estrito; responde SEMPRE 204
                         |
   registrar_clique_do_site (service role)  ->  clique_do_site (só o sistema)
                         .
                         .  (o paciente envia a mensagem com o código)
                         v
   ingestão (ingest.ts): anúncio da Meta, código fixo, casar_clique_do_site, mensagem padrão, palavra-chave
                         |
   origem_gravada: Tráfego pago, Google, clique_site, ids da campanha e do grupo (gravados pela função)
```

- **Script `public/rastreio/v1.js`** (estático, servido pela CDN, não importa nada do app): lê `data-chave` do próprio `<script>` (20 caracteres hexadecimais; fora disso, não faz nada). Lê da URL `gclid`, `gbraid`, `wbraid`, `gad_source`, `gad_campaignid`, `cz_campanha` e `cz_grupo`, cada um validado sozinho com os formatos do banco (o inválido sai sem levar os outros). Os sinais ficam no `sessionStorage` com o item `conduzza_rastreio_v1_<chave>`, preso à chave (outra clínica na mesma origem não o lê), e valem nas páginas seguintes da aba. **Sem sinal, nenhum ouvinte e nenhum aviso.** Com sinal, ouve `click` e `auxclick` (só o botão do meio) na fase de captura, nos links `wa.me/<número>`, `api.whatsapp.com/send`, `web.whatsapp.com/send` e `whatsapp://send` (fora: `wa.me/message/...`, `wa.link` e grupos). O código tem 6 caracteres do alfabeto de `attribution.ts`, sorteados por `crypto.getRandomValues` sem viés, e entra como " [#CODIGO]" colado no valor bruto do `text` (o texto da clínica fica byte a byte como estava); sem texto, ou em branco, vai "Olá! [#CODIGO]" (texto provisório). Texto que já tem um código `#XXXXXX` (código fixo de `campaign_link`) ou está mal codificado não é tocado. O `href` original volta 1,5 s depois do clique. Nunca chama `preventDefault`, tudo roda em `try/catch` e o link segue intacto com `sessionStorage` bloqueado ou sem `crypto`. Não lê IP, user agent, caminho, `href` da página, cookie, referrer nem `localStorage`.
- **A linha que a clínica cola** sai de `linhaDoScript(PUBLIC_APP_URL, chave)` (`lib/domain/rastreio-do-site.ts`): `<script src="https://<app>/rastreio/v1.js" data-chave="<chave>" referrerpolicy="no-referrer" async></script>`, só com https (http só para `localhost` e `127.0.0.1`). O `referrerpolicy` vale só para a carga do script; o aviso segue a política de referrer da página da clínica (ponto aberto para o dono no backlog). Como o endereço fica gravado no site de cada clínica, trocar o domínio do sistema obriga todas a recolar a linha.
- **Rota `app/api/publico/clique/route.ts`** (POST e OPTIONS, `runtime = "nodejs"`, `force-dynamic`, `maxDuration = 5`): o `Content-Length` declarado acima de 2048 bytes corta antes de ler, e a leitura aos pedaços para no primeiro pedaço que estoura; o corpo precisa ser UTF-8 válido e passar por `corpoDoCliqueSchema` (campo a mais, formato errado ou nenhum sinal recusam). `argumentosDoRegistro` monta a chamada: `p_google_campaign_id` = `cz_campanha` ou, sem ele, `gad_campaignid`; `p_google_adgroup_id` = `cz_grupo`; `p_site_host` = só o host do cabeçalho `Origin` (nunca o caminho). Chama `registrar_clique_do_site` pela service role com prazo de 4 s. **Responde sempre 204**, com CORS `*` e `no-store`, para não revelar se a chave existe. Log só com `status` (lista fechada de resultados, ou `desconhecido`), `count` (quantos sinais vieram) e `error_code`: eventos `clique_do_site`, `clique_do_site_recusado` e `clique_do_site_falhou`. Nunca a chave, o gclid, o código, o IP, o user agent ou a página.
- **Middleware:** o matcher de `middleware.ts` exclui `api/publico/` e `rastreio/`. Sem isso, o visitante do site, que não tem sessão, seria redirecionado para `/login` e o rastreio pararia calado. Rota pública nova vai em `/api/publico/`.
- **Limite e teto no banco** (não existe limite de requisições na Vercel neste projeto): 30 cliques por minuto por clínica e até 2.000 cliques vivos (não casados e no prazo) por clínica, com despejo do que vence primeiro quando enche. Risco proposto como aceito (a confirmar pelo dono, backlog): a chave é pública e o desenho não guarda IP, então, durante um ataque com a chave, o limite por minuto é disputado com o atacante e um clique real pode ser despejado; a origem fica vazia (preenche-se depois), nunca errada, e a perda acaba quando o ataque para.
- **Ingestão** (`lib/integrations/whatsapp/ingest.ts`, `tentarAtribuirOrigem`): depois do bloco do anúncio da Meta e da leitura de `campaign_link`, `codigosDoCliqueDoSite` (`attribution.ts`) escolhe até 3 códigos da mensagem, do último para o primeiro, e devolve vazio quando algum é código fixo de `campaign_link` (o código fixo vence em qualquer posição do texto). Para cada um, `admin.rpc('casar_clique_do_site')` até o primeiro `origem_gravada` ou `vinculado`. `origem_gravada` encerra; erro ou resposta fora do contrato também encerra, sem cair para mensagem padrão nem palavra-chave (na dúvida, a origem fica vazia); `vinculado`, `nao_achado` e `expirado` seguem para `atribuirOrigem`, que compara a mensagem padrão também com o texto sem o sufixo " [#CODIGO]" desses códigos. Se a leitura de `campaign_link` falhar, o clique não é tentado. A ingestão nunca grava `clique_site`, `Google` nem os ids do Google por conta própria: quem grava é a função. Logs: `clique_do_site_na_ingestao` (status e count), `clique_do_site_casar_falhou` (error_code) e `clique_do_site_resposta_inesperada`, só com ids, nunca o código nem o texto.
- **Configurações** (`components/configuracoes/google-ads-tab.tsx` e `rastreio-do-site-card.tsx`; `app/(app)/configuracoes/rastreio-do-site-actions.ts`): tudo pela sessão. A página lê `rastreio_do_site` (a policy só mostra a linha para administrador e gestor) e a função `situacao_do_rastreio` (só totais). Ligar é `update` de `ativo` e, sem linha, `insert` só de `{clinic_id, ativo: true}`; um 23505 nesse insert refaz o update. **Nunca upsert**: o `ON CONFLICT` do PostgREST grava `clinic_id`, que não tem grant de update (42501). Gerar chave nova chama `trocar_chave_do_rastreio`. Trilha em `audit_log` (entity `rastreio_do_site`), sem a chave.
- **Retenção:** a poda roda no `motor_manutencao` a cada minuto (`podar_cliques_do_site`): clique não casado sai 1 dia depois de vencer; o casado perde gclid, gbraid e wbraid 90 dias depois do clique, e a linha fica.
- **Service role:** além do motor e das Server Actions (seção 3), a rota pública e a ingestão usam a service role para chamar as duas funções do clique, que não têm grant para `anon` nem `authenticated`.

---

## 14. Agente de IA: provedor de LLM (OpenAI, desde 05/10/2026)

Decisão do dono em 05/10/2026: **OpenAI no lugar da Anthropic**, para ser mais barato. A pesquisa usou só fontes oficiais (developers.openai.com, cdn.openai.com, trust.openai.com e o repositório `openai/openai-node`), consultadas em 05/10/2026. O filtro do CFM (regras determinísticas e bateria de conformidade) não mudou: mudou só a camada que fala com o modelo.

**Onde vive:** `lib/integrations/llm/openai.ts` (cliente, erros, identificador de segurança, modelo do agente), `lib/integrations/llm/verificador.ts` e `lib/integrations/llm/classificador-de-entrada.ts`. SDK oficial `openai` (7.28.x, exige Node 22 ou mais), **Responses API** com saída estruturada (`responses.parse` e `zodTextFormat` de `openai/helpers/zod`).

**Modelos (lista fechada por variável de ambiente; fora dela, falha fechada):**

| Uso | Modelo | Raciocínio | Variável |
|---|---|---|---|
| Verificador do CFM e classificador de entrada | `gpt-6-luna` | `none`, com `temperature: 0` | `IA_MODELO_VERIFICADOR` |
| Agente (E2; hoje só a configuração) | `gpt-6-luna` (padrão) ou `gpt-6.1-sol` | `low` (o `gpt-6.1-sol` não aceita `none`) | `IA_MODELO_AGENTE` |

Preço por modelo em `llm_preco` (migration `20261006110000`, faixa Standard). Pela pesquisa, trocar o Sonnet 5 pelo `gpt-6.1-sol` barateia uns 6%; a economia de verdade vem do `gpt-6-luna` (cerca de 20 vezes mais barato), cuja qualidade como agente em português com ferramentas **não está confirmada**: medir na bateria de conformidade e no simulador antes de escolher.

**Regras de chamada** (todas provadas por teste, sem rede):

- `store: false` sempre. A OpenAI guardaria a resposta por 30 dias. O histórico vai inteiro em cada chamada; com raciocínio ligado, `include: ["reasoning.encrypted_content"]`.
- Proibido com dado de paciente: Conversations, `previous_response_id`, Files, Vector Stores, Evals, Batch, `/v1/agents`, o Agents SDK (tracing ligado por padrão) e o modo `background`.
- `service_tier: "default"`: o preço em `llm_preco` é o Standard; um projeto configurado para prioridade cobraria o dobro sem o livro de gasto saber.
- `safety_identifier` = HMAC-SHA256 de `clinic_id` e `contact_id` com `IA_SEGREDO_DO_IDENTIFICADOR` (64 caracteres hex). Nunca telefone; outro formato falha fechado sem chamar. Um bloqueio da OpenAI por abuso cai só naquele contato, não na organização.
- `prompt_cache_key` por clínica (`conduzza:<papel>:<clinic_id>`) no agente. Verificador e classificador rodam com o cache desligado (`prompt_cache_options.mode = "explicit"` sem ponto de corte): o envelope muda a cada chamada (nonce) e o modo implícito pagaria 1,25x para gravar o que nunca é relido.
- O esquema da saída estruturada não tem dado de paciente (a OpenAI o trata como dado de sistema, fora de qualquer região).
- Cliente: chave explícita, URL fixa `https://api.openai.com/v1` (ignora `OPENAI_BASE_URL`), `organization` e `project` nulos (ignora `OPENAI_ORG_ID` e `OPENAI_PROJECT_ID`), prazo explícito, uma tentativa extra, log do SDK desligado.
- 429 de cobrança ou cota (`credit_balance_exhausted`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`, `organization_usage_limit_exceeded`, ou tipo `insufficient_quota`) **não é repetido**: o `fetch` do cliente marca `x-should-retry: false`, que o SDK obedece, e a classificação trata como grave (conta para o desligamento automático).
- Recusa (item `refusal`), resposta incompleta (`max_output_tokens`, `content_filter`), status diferente de `completed`, item inesperado na saída e `output_parsed` nulo ou fora do esquema: falha fechada (bloqueia e escala).
- Nos testes, o pacote `openai` (só o nome exato) é trocado por `tests/stubs/openai-proibido.ts` nas três configs do vitest; `openai/helpers/zod` continua real.

**Dados e LGPD (o que a pesquisa achou):**

- **Treino:** a API não treina com os dados enviados, salvo opt-in (contrato OSA, item 4.2).
- **Retenção:** sem ZDR, o log de abuso guarda prompts e respostas por até 30 dias. ZDR (ou Modified Abuse Monitoring) depende de aprovação comercial da OpenAI. `[PENDENTE]` pedir e ligar antes de paciente real.
- **Região:** não existe região Brasil nem América do Sul, então é sempre transferência internacional (LGPD art. 33). As opções são Global (país de processamento indefinido) ou EUA (com acréscimo de 10% nos modelos lançados a partir de 05/03/2026). `[DECISÃO PENDENTE]` do dono; o código hoje usa Global.
- **Contrato:** o DPA (v.010126) põe a OpenAI OpCo, LLC (EUA) como operadora, mas diz no Anexo 1, item 5, que não se pretende transferir dado sensível, e não tem cláusula para Brasil ou LGPD. `[PENDENTE]` aditivo para dado de saúde e mecanismo de transferência válido pela LGPD (validar com o advogado).
- **Transcrição de áudio:** o áudio de paciente já vai à OpenAI hoje, pela uazapi (`UAZAPI_OPENAI_KEY`). Pela especificação da uazapi, sem chave na chamada ela usa a chave salva na instância, então deixar a variável vazia não garante que o áudio não saia. `[PENDENTE]` correção no código (pedir transcrição só com a nossa chave) e chave num projeto próprio da OpenAI.

O checklist do dono antes de qualquer paciente real está no `docs/05`, Fase 3.
