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

A chamada ao LLM é transferência internacional de qualquer forma. Isso precisa estar no termo de uso da clínica e no RIPD. Não é impeditivo, é obrigação de transparência.

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
    └── webhooks/whatsapp/        fallback, o principal é Edge Function

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
│   │                             04/10/2026) e versao.ts (versão única da Graph)
│   ├── llm/                      agente, ferramentas, filtro de conformidade
│   └── billing/                  gateway de pagamento
├── jobs/                         motor da fila (motor.ts, worker.ts) e executores (regua.ts, conversao-meta.ts,
│                                 lista-espera.ts, gasto-meta.ts, o sincronizar_gasto_meta da Fase 4, e
│                                 resolver-anuncio-meta.ts, a consulta dos anúncios pelo id de 04/10/2026)
├── domain/                       regras de negócio puras, sem I/O, testáveis
│   ├── scheduling.ts             disponibilidade, hold, conflito
│   ├── cadence.ts                cálculo de quando disparar cada passo de régua
│   ├── attribution.ts            origem do lead
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

O Service Role Key ignora RLS. **Nunca em código que chegue ao browser.** Na prática ele roda no servidor: no motor da fila e nas Server Actions que gravam o que a sessão não pode gravar (por exemplo, os segredos da seção 10 e a situação da leitura do investimento da Meta), sempre **depois** da guarda de papel.

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

Construída e publicada em 03/10/2026. Modelo no `docs/04` (seção 14), operação no `supabase/operacao/motor-por-cron.md` ("Leitura do investimento da Meta"). A consulta dos anúncios pelo id (04/10/2026, publicação pendente) está no fim desta seção.

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

Construída, publicação pendente (migration `20261004100000` ainda não aplicada). Modelo no `docs/04` (seção 14.9), operação no `supabase/operacao/motor-por-cron.md` ("Consulta dos anúncios da Meta"), plano e pontos para o dono no backlog. O canal do WhatsApp entrega só o clique e o id do anúncio; a leitura diária acima não devolve anúncio arquivado nem apagado. Este caminho pergunta à Meta, pelo id, a campanha e o conjunto de cada anúncio de onde um lead veio, e grava no mesmo mapa `meta_anuncio`, que é a fonte única do nome da campanha do lead (o contato guarda só o `source_ad_id`).

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
