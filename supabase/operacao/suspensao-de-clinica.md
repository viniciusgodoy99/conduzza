# Suspensão de clínica (onda 1): operação

Como suspender e reativar a conta de uma clínica, o que conferir e o que fazer quando algo foge do esperado. Decisão do dono de 20/10/2026: **desativar a conta é suspender mantendo os dados**. Banco no `docs/04`, seção 22; código no `docs/03`, seção 15; telas no brief (Tela 14 e "Conta suspensa"); estado e pendências no `docs/05`, entrada "Onda 1".

**Estado em 20/10/2026:** migration `20261021100000_painel_geral.sql` **aplicada** (ensaio na produção com `ENSAIO OK` e o ok do dono) e código publicado depois dela (`docs/04`, 22.8). Antes de suspender, confira que o código no ar é o da onda 1 (o Painel geral abre): o código de antes não mostra "Conta suspensa" e não tem a trava final do envio.

---

## Regras

- **Só a equipe Conduzza** (super admin) suspende e reativa, pelo Painel geral ou pelo SQL editor. A RPC recusa (42501) qualquer outra sessão, inclusive o administrador da clínica.
- **Sempre com o ok do dono** e sempre por id da clínica, nunca por nome (há clínicas com nomes parecidos).
- **O motivo é obrigatório** (3 a 300 caracteres) e vai para a trilha. Texto da equipe Conduzza: **nunca** nome, telefone ou qualquer dado de paciente.
- **Nunca** `insert`, `update` ou `delete` direto em `clinica_suspensa`: só `suspender_clinica` e `reativar_clinica` devolvem as conversas do agente, cancelam o que venceu, fecham os toques de régua e gravam a trilha.
- Nenhum comando aqui levanta 40001 ou 40P01, e nenhuma consulta devolve conteúdo de mensagem ou telefone.

## O que a suspensão faz

- **A equipe da clínica** (todo papel, o administrador inclusive) vê "Conta suspensa" ao entrar e não lê nem escreve nada da clínica: o banco nega, nas mesmas funções que as policies usam. Quem tem outra clínica ativa troca para ela. **O super admin entra normalmente.**
- **Nada sai pelo WhatsApp da clínica:** régua, confirmação, mensagem agendada, lista de espera, envio ativo, a IA, o atendimento (até o do super admin) e o "Testar" da régua. O motor segura os jobs da clínica na fila; a trava final do envio recusa o que escapar.
- **As conversas do agente voltam para a equipe** na hora (nada é enviado ao contato), e conversa nova não nasce na IA.
- **O que continua:** as mensagens que os pacientes mandam chegam e ficam gravadas, com a mídia (`baixar_midia` não é segurado); os dados ficam todos; a saúde do motor não acusa os jobs segurados (`supabase/operacao/motor-por-cron.md`). As automações de fluxo, que não enviam mensagem (mover etapa, etiquetar, criar atividade, nota interna), continuam rodando no banco (ponto aberto no `docs/05`, entrada "Onda 1"); o follow-up e a conversão da Meta que nascem delas ficam segurados como os outros jobs.

## Suspender

**Pelo Painel geral:** Painel geral, a clínica, cartão **Conta da clínica**, **Suspender conta**. O diálogo lista o efeito; escreva o motivo (o botão só habilita com 3 a 300 caracteres) e confirme. O aviso diz "Conta da {clínica} suspensa.".

**Pelo SQL editor** (recuo, se o painel falhar; a trilha fica "sem nome"):

```sql
select public.suspender_clinica('<id da clínica>', 'Dono em <data>: <motivo curto>');
```

Recusas: `clinica_ja_suspensa` (P0001; nada muda), `motivo_invalido` (22023), clínica que não existe (P0002). Se der 55P03 (trava ocupada), nada mudou: repita em alguns minutos.

## Conferir

```sql
-- as clínicas suspensas, quando e por quê (o motivo é texto da equipe Conduzza)
select c.id, c.name, s.suspensa_em, s.motivo
from public.clinica_suspensa s
join public.clinic c on c.id = s.clinic_id
order by s.suspensa_em;

-- a clínica saiu da lista da IA (não pode aparecer aqui)
select '<id da clínica>'::uuid = any (public.ia_clinicas_da_fase_controlada()) as ainda_na_lista;

-- nenhuma conversa na IA
select count(*) from public.conversation
where clinic_id = '<id da clínica>' and status = 'ia_atendendo';

-- o que está segurado na fila, por tipo (só contagens)
select j.kind, j.status, count(*)
from public.job_queue j
where j.clinic_id = '<id da clínica>' and j.status in ('pendente', 'executando')
group by 1, 2
order by 1, 2;

-- a trilha da clínica no painel
select a.created_at, a.action, a.user_id,
       a.detalhes->>'motivo' as motivo,
       a.detalhes->>'jobs_vencidos' as jobs_vencidos,
       a.detalhes->>'estado' as estado_do_agente
from public.audit_log a
where a.clinic_id = '<id da clínica>'
  and a.action in ('suspendeu_clinica', 'reativou_clinica',
                   'mudou_agente_da_clinica', 'mudou_teto_da_ia')
order by a.created_at desc
limit 20;
```

No painel: o chip "Suspensa" na lista e no cartão da conta, com "Suspensa desde ..." e o motivo.

## Reativar

**Pelo Painel geral:** a clínica, cartão **Conta da clínica**, **Reativar conta**, com o motivo. O aviso diz "Conta da {clínica} reativada." e, quando houve, quantas mensagens automáticas vencidas foram canceladas.

**Pelo SQL editor:**

```sql
select public.reativar_clinica('<id da clínica>', 'Dono em <data>: <motivo curto>');
-- devolve {"jobs_vencidos": n}
```

O que acontece:

- a equipe da clínica volta a entrar normalmente;
- **as mensagens automáticas que venceram durante a suspensão são canceladas** (`last_error 'vencido_na_suspensao'`), para nenhum paciente receber mensagem fora de hora: o job pendente com horário já passado e o que estava executando com o prazo vencido. Os marcados para depois de agora continuam na fila;
- o toque de régua cancelado aparece em Confirmações como não enviado, com o motivo **"Conta suspensa"**; a mensagem agendada cancelada a reconciliação do motor fecha como não enviada, com a atividade de sempre;
- **não são cancelados** e seguem como estavam: a mídia que chegou e as três da Meta (a conversão, a leitura do gasto e a consulta do anúncio). A conversão que passou da janela de 7 dias da Meta é descartada pelo próprio job, como sempre;
- o agente volta a atender se a clínica estava em Teste (ela volta para a lista; a liberação não foi mexida), a partir da próxima conversa: as que voltaram para a equipe na suspensão continuam com a equipe (o Devolver para a IA vale como sempre).

Recusas: `clinica_nao_suspensa` (P0001; nada muda), `motivo_invalido`, P0002.

Depois de reativar: a primeira consulta de "Conferir" sem a clínica, a consulta da fila sem os vencidos e, se o agente estava em Teste, "Na clínica agora" no painel sem motivo de parada.

## Incidentes

- **Alguém da clínica diz que vê "Conta suspensa" sem ter sido suspensa:** a tela mostra o nome da clínica suspensa; confira na primeira consulta de "Conferir". Quem tem vínculo com mais de uma clínica e tinha escolhido a suspensa vê a tela até trocar: "Trocar para {nome}" ou "Trocar de clínica", na própria tela.
- **"Seu acesso não carregou"** para o membro de uma clínica suspensa: a leitura do nome da clínica suspensa falhou (`minhas_clinicas_suspensas`). Tentar de novo; se repetir, conferir o banco.
- **Log `envio_leitura_da_suspensao_falhou` (aviso) e envios com `leitura_falhou`:** a trava não conseguiu perguntar ao banco e fechou (nada saiu). Os jobs tentam de novo sozinhos; se repetir, conferir o banco e a permissão da `service_role` em `clinica_esta_suspensa`. Com `error_code` `PGRST202` ou `42883` em todos os envios, a função sumiu (por exemplo, o banco voltou pelo rollback com o código da onda 1 ainda no ar): nenhum WhatsApp sai de nenhuma clínica até voltar o código ou reaplicar a migration (com o ok do dono).
- **O monitor acusou `fila_atrasada` com uma clínica suspensa:** o que a suspensão segura não conta; o atraso é outro (ou a mídia da clínica suspensa). Siga `supabase/operacao/motor-por-cron.md`, "Conta suspensa" e o diagnóstico de sempre.
- **Uma mensagem saiu de uma clínica suspensa:** não deveria acontecer por nenhum caminho. Avise o dono e guarde os ids (mensagem, conversa, job), sem copiar texto. Se continuar saindo, o recuo é parar o motor (`supabase/operacao/motor-por-cron.md`, "Desligar (rollback)"), que para o envio automático de todas as clínicas, ou desconectar o número da clínica na aba WhatsApp (pelo super admin), que também para de gravar as mensagens que chegam enquanto ele estiver desconectado: os dois só com o ok do dono.

## Rollback

Desfazer a onda 1 inteira: `docs/04`, 22.8, e o cabeçalho de `supabase/operacao/rollback/20261021100000-corpos-anteriores.sql`. **Antes**, reativar pelo painel as clínicas suspensas que devem voltar a enviar (`reativar_clinica` cancela o que venceu; depois do rollback a suspensão some e o motor pegaria tudo, inclusive o vencido) e desligar o agente das clínicas ligadas em Teste pelo painel, fora a teste123 e a Conduzza Teste. Depois, voltar o código e, só então, rodar o arquivo de rollback.
