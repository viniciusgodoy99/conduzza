# Vários números de WhatsApp por clínica

O que a operação precisa saber sobre a frente de vários números (desenho em `docs/07_multiplos_numeros_whatsapp.md`).

---

## Webhook: duas URLs, as duas valem

- **Nova:** `?clinic=<clinic_id>&account=<whatsapp_account.id>&secret=<segredo>`. É a que o sistema registra no uazapi ao conectar um número.
- **Antiga:** `?clinic=<clinic_id>&secret=<segredo>`. Continua valendo **para sempre**: a rota procura, entre os segredos da clínica, o que bate (comparação em tempo constante) e registra `webhook_url_legada` no log. Não há nada a migrar à mão.
- Número removido recebe 401, porque a remoção gira o segredo.

**Reenvio do uazapi é finito.** Pela especificação da API, a entrega do webhook faz cerca de 3 tentativas; um 5xx que dure mais que isso perde o evento. Por isso a rota só responde 5xx quando não pode decidir e a mensagem ainda pode chegar de novo (pareamento aberto pelo QR, ou falha de banco). Para ver o que falhou: `GET /webhook/errors` com o token da instância (últimos 20 erros, só em memória, somem quando o servidor reinicia).

## Sem volta de código

Depois das Fases 3 e 4 (contrato do banco e telas), **não existe rollback de código** para uma clínica que já tem dois números: o código anterior assume um número por clínica e escolheria um deles ao acaso. Se precisar voltar uma versão, primeiro confira:

```sql
select clinic_id, count(*) from whatsapp_account
where removido_em is null group by 1 having count(*) > 1;
```

Com alguma linha, não volte a versão; corrija para frente.

## Limite de números (planos futuros)

`clinic.limite_de_numeros`: nulo é sem limite (o padrão hoje). Só o dono do produto altera, e até existir a tela de administração (Tela 14) é pelo SQL editor:

```sql
update clinic set limite_de_numeros = 2 where id = '<clinic_id>';
```

Baixar o limite abaixo do que a clínica já tem não remove número nenhum: só impede adicionar outro.

## Capacidade do uazapi

O servidor é compartilhado (cerca de 100 vagas). A instância só nasce no primeiro "Conectar" e remover o número apaga a instância. Acompanhe a ocupação antes de liberar números extras em massa.

## Número com nome de perfil no lugar do telefone

Números conectados antes da trava do mesmo celular podem ter o nome do perfil em `display_phone`. O script `scripts/ops/corrigir-display-phone.ts` relê o telefone no provedor e corrige (roda com o service role; não imprime dado de paciente).
