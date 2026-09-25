# Modelos de e-mail de autenticação

Os e-mails de cadastro, convite e senha nova saem do Supabase Auth (pelo SMTP do Resend). O texto e o visual deles **não** vêm do código: ficam no painel do Supabase. Esta pasta guarda a versão oficial de cada modelo para colar lá e para revisar em PR.

| Arquivo                        | Modelo no painel | Assunto                                     | Link do botão                                                                            | Leva para     |
| ------------------------------ | ---------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------- |
| `confirmacao-de-cadastro.html` | Confirm signup   | Confirme seu e-mail no Conduzza Clínicas    | `{{ .SiteURL }}/confirm?token_hash={{ .TokenHash }}&type=email&next=/inicio`             | área logada   |
| `convite.html`                 | Invite user      | Você foi convidado para o Conduzza Clínicas | `{{ .SiteURL }}/confirm?token_hash={{ .TokenHash }}&type=invite&next=/convite`           | criar a senha |
| `redefinicao-de-senha.html`    | Reset password   | Crie uma senha nova no Conduzza Clínicas    | `{{ .SiteURL }}/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/redefinir-senha` | senha nova    |

Os modelos Magic Link, Change Email Address e Reauthentication não são usados pelo app: podem ficar como estão.

## Por que o link é montado à mão (achado 117 da revisão)

O modelo padrão do Supabase usa `{{ .ConfirmationURL }}`, e isso quebra dois fluxos do app:

- **Convite:** o convite é enviado pelo servidor sem PKCE, então o link padrão devolve a sessão no fragmento da URL (`#access_token=...`). A rota `/confirm` roda no servidor e nunca vê o fragmento: a pessoa convidada caía em "link vencido" sem ter senha, e o token ficava na barra de endereço.
- **Senha nova e confirmação de cadastro:** o link padrão manda um `code` PKCE que só troca pela sessão no navegador que fez o pedido. Pedido no computador da recepção e aberto no celular, falhava.

Com `token_hash`, a rota `/confirm` chama `verifyOtp`, que não depende do navegador: o link abre em qualquer aparelho e a sessão nunca passa pela URL.

## Antes de colar

1. **Site URL** (Authentication, URL Configuration): tem de ser o endereço de produção, com `https://`. Os três modelos usam `{{ .SiteURL }}` para o link **e** para a imagem da marca.
2. **Redirect URLs**, na mesma tela: incluir `https://<endereço de produção>/confirm` (o código ainda manda `redirectTo` e `emailRedirectTo` apontando para `/confirm`) e manter os de `http://localhost:3000` para desenvolvimento.
3. **Imagem da marca publicada:** abrir `https://<endereço de produção>/brand/email/conduzza-lockup-on-dark@2x.png` no navegador. Ela só existe depois que o commit com `public/brand/email/` chegar à produção. Sem ela, o e-mail mostra o texto alternativo "Conduzza" em creme sobre a faixa escura (legível, mas sem o logo).

## Como colar

Painel do Supabase, projeto `imizkroxevcawomvgrbn`, Authentication, Emails (aba Templates). Para cada linha da tabela acima:

1. Abrir o modelo indicado na coluna "Modelo no painel".
2. Trocar o **Subject** pelo texto da coluna "Assunto".
3. No corpo (modo código), apagar tudo e colar o arquivo inteiro, do `<!doctype html>` ao `</html>`.
4. Salvar.

## Como testar (obrigatório antes de liberar para clínica)

Usar caixas de e-mail de verdade e conferir que o e-mail chegou pelo Resend (https://resend.com/emails) com a faixa escura e o logo.

1. **Cadastro:** criar uma clínica de teste em `/cadastro`. Abrir o e-mail **no celular** e tocar em "Confirmar meu e-mail". Tem de cair na área logada, sem `#access_token` na barra.
2. **Convite:** em Configurações, Equipe, convidar um e-mail novo. Abrir o convite no celular e tocar em "Aceitar convite e criar senha". Tem de cair em `/convite`, já com sessão, e a senha criada tem de entrar no login.
3. **Senha nova:** em `/recuperar-senha`, pedir o link **no computador** e abrir o e-mail **no celular**. Tem de cair em `/redefinir-senha` e salvar a senha.
4. **Link usado duas vezes:** tocar de novo no link do teste 3. Tem de aparecer, na tela de entrada, o aviso "Não foi possível abrir o link do e-mail", sem afirmar que ele venceu.
5. **Clínica de teste:** marcar como de teste ou apagar as clínicas criadas nos testes.

## Cuidados

- O projeto do Supabase é o mesmo em desenvolvimento e produção, então os links sempre apontam para o Site URL (produção), inclusive quando o cadastro é feito no `localhost`.
- O prazo do link é o configurado no painel (Authentication, Providers, Email, "Email OTP Expiration"). Os modelos só dizem "vale por tempo limitado" para não prometer um prazo que o painel pode mudar.
- Antivírus corporativo e filtros de link (por exemplo o Safe Links do Outlook) às vezes abrem o link antes da pessoa e gastam o uso único. Se acontecer, a tela de entrada explica e a pessoa pede outro link. Se virar frequente, o caminho é uma página intermediária com um botão de confirmar (não existe hoje).
- Cores em hex são permitidas aqui (cliente de e-mail não lê variável CSS); cada uma tem a origem no design system comentada no próprio arquivo. Nenhum texto usa travessão.
- Ao mudar um modelo, mudar o arquivo desta pasta no mesmo PR e colar de novo no painel: o painel não tem histórico.
