# Super admin numa conta só para o painel: operação

Como trocar o super admin das contas de clínica por uma conta só para o painel, o que conferir e como voltar. Decisão do dono de 03/11/2026, **"Conta própria só para o painel"**: o super admin usa um e-mail só para isso; esse e-mail não é membro de clínica nenhuma e cai direto no Painel geral, numa área separada da clínica; para trabalhar numa clínica, a pessoa usa a conta normal. Código no `docs/03`, seção 15.6; banco no `docs/04`, seção 39; tela no brief (Tela 14); estado e pendências no `docs/05`, entrada "Super admin numa conta só para o painel".

**Estado em 03/11/2026:** código e migration `20261103110000_super_admin_sem_clinica.sql` **escritos na branch `super-admin-separado`, nada publicado nem aplicado**, nenhum passo deste roteiro rodou. Hoje há 2 super admins, os 2 com vínculo ativo de administrador: o dono (teste123 e Salud Care) e o Victor (Conduzza Teste).

---

## Regras

- **Sempre com o ok do dono**, um passo de cada vez, e sempre primeiro sem `--confirmar` (a simulação lê, confere e diz o que faria).
- **Os e-mails vêm do dono.** Nenhum e-mail deste roteiro é inventado: onde está `<e-mail ...>`, é o que o dono passar.
- **A conta do painel não é membro de clínica nenhuma**, nem pendente, nem com o acesso tirado. O banco recusa (depois da migration): `CZSA1` "Esta conta é da equipe Conduzza e não entra em clínica." ao vincular um super admin, e `CZSA2` "Esta conta participa de uma clínica e não vira super admin." ao tornar super admin uma conta com vínculo.
- **Nunca dê super admin a partir de metadado do usuário** (o metadado é de quem se cadastra). Super admin só pela linha em `product_admin`, gravada pela service role (este script ou o SQL editor).
- **Nunca** crie, teste ou apague super admin na produção fora deste roteiro. Os testes que precisam de super admin só rodam com opt-in (`RLS_COM_SUPER_ADMIN=1`, `INTEGRACAO_COM_SUPER_ADMIN=1`, `E2E_COM_SUPER_ADMIN=1`) e com o ok do dono.
- Nenhum comando aqui lê ou imprime dado de paciente. Os e-mails impressos são das contas da equipe Conduzza.

## Ordem

1. **Publicar o código** (a área do super admin em `app/(admin)` e a entrada). Funciona com e sem a migration: a ordem entre os dois é livre.
2. **Aplicar a migration** `20261103110000`, depois do ensaio na produção (`~/.claude/plans/super-admin/ensaio-20261103110000.sql`, uma transação desfeita no fim; `ENSAIO OK` e o ok do dono). Ao aplicar, nada muda para ninguém (seção "O que a migration faz", abaixo).
3. **Criar a conta do painel** (passo `criar`), para cada pessoa da equipe que vai administrar o painel.
4. **Conferir que a conta nova funciona**: a pessoa define a senha pelo e-mail, entra e cai direto no Painel geral, sem "Criar clínica" e sem clínica no menu.
5. **Limpar as contas antigas** (passo `limpar`): elas deixam de ser super admin e ficam marcadas como equipe Conduzza. Precisa da migration (a tabela `equipe_conduzza`).

Os passos 3 a 5 são do script `scripts/operacao/super-admin-separado.ts`, com a service role do `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`).

## Conferir (só leitura)

```sh
npx tsx scripts/operacao/super-admin-separado.ts conferir
```

Lista cada super admin com o e-mail, o último login, se o e-mail está confirmado, os vínculos com clínica (o id, o papel e a situação) e a marca de equipe Conduzza; depois, as contas marcadas em `equipe_conduzza` (ou "não existe", antes da migration).

## Criar a conta do painel

```sh
# simulação
npx tsx scripts/operacao/super-admin-separado.ts criar --email <e-mail da conta do painel> --nome "<nome>" --app <endereço do app em produção, https>
# de verdade
npx tsx scripts/operacao/super-admin-separado.ts criar --email <e-mail da conta do painel> --nome "<nome>" --app <endereço do app em produção, https> --confirmar
```

O que faz, nesta ordem:

1. Confere o e-mail: se já existe uma conta com ele, ela só serve se **não tiver linha em clínica nenhuma** (o script para e explica, sem gravar nada).
2. Cria a conta pela API de administração (service role): **confirmada e sem senha**, com o nome em `user_metadata.name`. Sem `tipo` no metadado, o gatilho de cadastro (`handle_new_user`) não cria clínica nem vínculo.
3. Confere de novo que a conta nasceu sem vínculo e grava a linha em `product_admin` (com a migration, o banco também confere: `CZSA2`).
4. Manda o e-mail de **redefinir senha** (o mesmo da tela "Esqueci minha senha", pelo SMTP do Resend), com o link para `<app>/confirm?next=/redefinir-senha`: a pessoa cria a senha dela, e nenhuma senha passa pelo script. O endereço do app precisa estar na lista de endereços de retorno do Supabase Auth (o do app em produção já está, porque a tela de recuperação usa o mesmo caminho).

Se o e-mail não sair, a conta fica pronta: a pessoa pede outro link pela tela "Esqueci minha senha" do app.

**Conferir depois:** `conferir` mostra a conta com "super admin: sim", "sem vínculo com clínica" e "nunca entrou"; depois que a pessoa entrar, o último login aparece. Ela cai direto no Painel geral (o layout da clínica manda o super admin sem vínculo ativo para `/painel-geral`), com o menu da área do super admin: Painel geral, o e-mail e Sair.

## Limpar as contas antigas

Só **depois** que a conta nova funciona (ela é super admin, não tem vínculo e já entrou pelo menos uma vez: o script confere as três coisas e para se faltar alguma) e com a migration aplicada.

```sh
# simulação
npx tsx scripts/operacao/super-admin-separado.ts limpar --antiga <e-mail da conta antiga> [--antiga <outra>] --nova <e-mail da conta do painel>
# de verdade
npx tsx scripts/operacao/super-admin-separado.ts limpar --antiga <e-mail da conta antiga> [--antiga <outra>] --nova <e-mail da conta do painel> --confirmar
```

Para cada conta antiga, nesta ordem:

1. **Marca em `equipe_conduzza`** (`marcado_por` = a conta do painel). A marca vem primeiro: o Painel geral nunca mostra o uso dela nas clínicas como uso do cliente.
2. **Tira de `product_admin`.** A conta continua membro das clínicas, como conta normal (o papel e a situação não mudam), e perde o poder de super admin: o item "Painel geral" sai do menu dela, a rota `/painel-geral` manda para o Início e as funções do painel recusam (42501). A sessão aberta muda na próxima tela (a guarda lê o banco a cada tela).
3. Confere: não é mais super admin e está marcada.

O passo é repetível: a conta que já está marcada e fora de `product_admin` passa sem mudar nada.

**Conferir depois:** `conferir` mostra só a conta do painel como super admin, e as contas antigas em "Marcadas como equipe Conduzza". No Painel geral, a coluna Equipe continua dizendo "Inclui N da equipe Conduzza" nas clínicas delas, e o último acesso delas continua marcado "(equipe Conduzza)".

## O que a migration faz

- **A trava**, em dois gatilhos: `impedir_vinculo_de_super_admin` (em `clinic_member`; `CZSA1`) e `impedir_super_admin_com_vinculo` (em `product_admin`; `CZSA2`). O que já existe fica tolerado: as duas contas antigas continuam super admin e membros das clínicas até a limpeza; podem trocar de papel, perder o acesso e sair, mas não voltam (inativo para ativo), não passam a pendente e não entram em outra clínica.
- **`equipe_conduzza`**: a marca de equipe Conduzza no painel, sem poder de super admin. Só o super admin lê; só a service role escreve.
- **As quatro funções do painel** (a lista, a equipe, as notas e o histórico) marcam como equipe Conduzza quem está em `product_admin` ou em `equipe_conduzza`. O formato não muda.
- **Convidar para uma clínica o e-mail de um super admin** passa a ser recusado. A tela do convite mostra o texto genérico ("Não foi possível concluir o convite. Tente de novo."), de propósito: dizer o motivo revelaria qual e-mail é da equipe Conduzza.

Os códigos `CZSA1` e `CZSA2` são próprios (nunca 40001 nem 40P01, que o PostgREST repete sem limite); o PostgREST devolve 400 com o código no corpo.

## Voltar

- **A limpeza** (uma conta antiga voltar a ser super admin): com a migration aplicada, o banco recusa (`CZSA2`: ela tem vínculo com clínica). É de propósito. Para voltar mesmo assim, primeiro o rollback da migration (abaixo), com o ok do dono, e depois, no SQL editor:

```sql
insert into public.product_admin (user_id)
select u.id from auth.users u where lower(u.email) = lower('<e-mail da conta antiga>');
```

- **A conta do painel** (desfazer o passo criar): no SQL editor, `delete from public.product_admin where user_id = '<id>';` e, se for o caso, apagar a conta pelo painel do Supabase (Authentication). Nunca deixe o sistema sem nenhum super admin: confira com `conferir` antes.
- **A migration:** `supabase/operacao/rollback/20261103110000-corpos-anteriores.sql`, inteiro, numa transação, no SQL editor, em horário calmo (os `DROP TRIGGER` seguram `clinic_member` e `product_admin` por milissegundos; `lock_timeout` de 1 s). As quatro funções voltam aos corpos de 03/11/2026 e saem a tabela `equipe_conduzza` e a trava. **Antes**, guarde quem está marcado (as linhas se perdem):

```sql
select e.user_id, u.email, e.entrou_em, e.marcado_por
from public.equipe_conduzza e
join auth.users u on u.id = e.user_id;
```

  Sem a marca, as contas antigas já limpas passam a contar no painel como uso do cliente. O código publicado continua funcionando sem a migration.

## Testes que dependem desta operação

- `tests/rls/super-admin-sem-clinica.test.ts` e `tests/integration/super-admin-sem-clinica.test.ts`: escritos, rodam **depois** da migration (`npm run test:rls -- super-admin-sem-clinica` e `npm run test:integration -- super-admin-sem-clinica`). A parte com super admin sintético só com `RLS_COM_SUPER_ADMIN=1` e `INTEGRACAO_COM_SUPER_ADMIN=1`, com o ok do dono: ela cria e apaga um super admin de teste na produção.
- `tests/e2e/super-admin.spec.ts`: o caso do super admin só com `E2E_COM_SUPER_ADMIN=1` (cria e apaga um super admin sintético sem clínica).
