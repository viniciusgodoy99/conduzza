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
| Filas | **`job_queue` + `pg_cron` + Edge Function** | Mantém tudo dentro do Supabase no V1. Régua de mensagem é trabalho agendado, não requisição HTTP |
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
│   ├── llm/                      agente, ferramentas, filtro de conformidade
│   └── billing/                  gateway de pagamento
├── domain/                       regras de negócio puras, sem I/O, testáveis
│   ├── scheduling.ts             disponibilidade, hold, conflito
│   ├── cadence.ts                cálculo de quando disparar cada passo de régua
│   └── attribution.ts            origem do lead
└── utils/                        formatadores pt-BR, datas, moeda

supabase/
├── migrations/                   SQL versionado, uma migration por mudança
└── functions/
    ├── whatsapp-webhook/         recebe da Meta
    ├── job-worker/               processa job_queue, chamado por pg_cron
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

O Service Role Key ignora RLS. **Só pode ser usado dentro de Edge Function**, nunca em código que chegue ao browser.

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
| `buscar_procedimento` | preço, duração, convênios aceitos | lê de `service_link`, nunca de texto livre |
| `buscar_horario` | primeiros horários livres | respeita `bookable_by_ai` do vínculo |
| `reservar_horario` | cria `slot_hold` de 10 min | expira sozinho |
| `agendar` | confirma o hold e cria `appointment` | falha se o hold expirou |
| `remarcar` / `cancelar` | move ou cancela | cancelamento dispara reoferta da lista de espera |
| `entrar_lista_espera` | adiciona à fila | |
| `escalar_humano` | muda status para `aguardando_humano` | **obrigatória** em: sintoma, pedido de humano, insatisfação, menor de idade, valor fora da tabela, 2 falhas seguidas |

### Filtro de conformidade

Camada separada, com testes próprios. Recebe o texto que o LLM produziu e devolve `{ aprovado: boolean, motivo?: string }`. Bloqueia: triagem de sintoma, orientação clínica, promessa de resultado, indicação de medicamento ou dosagem, diagnóstico, oferta casada.

Implementar como combinação de regras determinísticas (lista de padrões) **e** uma verificação por modelo. Regra determinística sozinha vaza. Modelo sozinho não é auditável. Os dois juntos são defensáveis.

---

## 5. Fluxo de mensagem enviada (réguas)

```
pg_cron a cada minuto
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

Segredos só em variável de ambiente. `.env.example` versionado, `.env` nunca.

---

## 11. Observabilidade

Monitorar, com alerta: disponibilidade, taxa de erro do webhook, tamanho da `job_queue` (fila crescendo é régua parando), **quality rating do número por clínica** (rebaixamento é incidente de produto, precisa aparecer antes de a clínica reclamar), gasto contra teto, e latência do LLM.

Log de aplicação **nunca** contém conteúdo de mensagem de paciente. Guardar identificador, não texto.
