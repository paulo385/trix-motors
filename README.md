# Trix Motors – Venda e Impostos

Site em HTML, CSS e JavaScript puro, sem framework, para cadastrar vendas de veículos e calcular os impostos (IRPJ, CSLL, PIS, COFINS e ICMS), com a mesma lógica da planilha `PLANILHA_CALCULO_-_IMPOSTO`.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | Estrutura das telas (formulários, abas, tabelas) |
| `style.css` | Visual: cores, fontes, layout, tema claro e escuro |
| `script.js` | Cálculo dos impostos, validações (CPF, placa, Renavam), histórico e fechamento |
| `config.js` | Endereço e chave pública do banco de dados (Supabase). Em branco = vendas só no aparelho |
| `supabase/setup.sql` | Script que cria as tabelas e as regras de acesso no Supabase |
| `supabase/002-cadastro-com-aprovacao.sql` | Script do cadastro de vendedores com aprovação do administrador |
| `.github/workflows/manter-banco-ativo.yml` | Rotina do GitHub que evita a pausa do banco grátis |
| `pdf.js` | Monta os PDFs: relatório do mês e resumo de cada venda |
| `manifest.json` | Nome, ícone e cores do app quando instalado no celular |
| `sw.js` | Faz o app abrir rápido e funcionar sem internet. Ao mudar qualquer arquivo, aumente a `VERSAO` dentro dele e o `?v=` no index.html |
| `icons/` | Logo da Trix Motors, favicon e ícones do app (tela inicial, Android e iPhone) |
| `lib/` | Bibliotecas de PDF (jsPDF e jsPDF-AutoTable, licença MIT). Não precisa mexer |
| `README.md` | Este guia |

## Site no ar (GitHub Pages)

Depois de ativar o GitHub Pages (Settings → Pages → branch `main`, pasta `/ (root)`), o app fica em:

`https://SEU-USUARIO.github.io/trix-motors/`

Esse endereço tem https, então dá para instalar no celular.

## Como abrir

- **No computador:** deixe todos os arquivos e a pasta `lib` juntos e dê dois cliques no `index.html`. Ele abre no navegador e já funciona, sem instalar nada.
- **Na internet:** envie todos os arquivos, com a pasta `lib`, para qualquer hospedagem de site estático, como Netlify, Vercel, GitHub Pages ou a hospedagem que você já usa.

## Instalar no celular (app)

O site se ajusta ao tamanho da tela: no celular as abas vão para baixo, como num aplicativo, e o histórico vira cartões.

Para instalar, o site precisa estar **publicado num endereço com https** (Netlify, Vercel, GitHub Pages ou sua hospedagem). Abrindo o arquivo direto do computador não dá para instalar.

- **Android (Chrome):** abra o endereço e toque em **Instalar app** no topo, ou no menu ⋮ → *Instalar app* / *Adicionar à tela inicial*.
- **iPhone (Safari):** abra o endereço, toque em **Compartilhar** e depois em **Adicionar à Tela de Início**. O próprio site mostra essa dica.
- **Computador (Chrome ou Edge):** aparece o ícone de instalar na barra de endereço.

Depois de instalado, ele abre em tela cheia, com ícone próprio, e funciona mesmo sem internet. As vendas ficam salvas no próprio aparelho.

## Relatórios em PDF

- **Relatório do mês:** na aba *Vendas e impostos*, escolha o mês e aperte **RELATÓRIO PDF**. Sai a lista de vendas do mês, os impostos de cada uma, PIS/COFINS/ICMS do mês com vencimento, o IRPJ/CSLL acumulado do trimestre (que é pago por trimestre) e a conferência com o DARF pago.
- **PDF de uma venda:** aperte **PDF** na linha da venda, ou **Gerar PDF desta venda** logo depois de calcular. Sai a ficha do cliente e do veículo, os impostos e o resultado. É documento interno, não é nota fiscal.

## Banco de dados (Supabase, grátis)

Com o banco ligado, cada pessoa entra com e-mail e senha, e **todos os aparelhos veem as mesmas vendas**, atualizadas ao vivo.

### Configurar (uma vez só)

1. Crie uma conta em **supabase.com** e clique em **New project**. Nome: `trix-motors`. Região: **South America (São Paulo)**. Anote a senha do banco.
2. Abra **SQL Editor** → **New query**, cole todo o conteúdo de `supabase/setup.sql` e troque `seu-email@exemplo.com` pelo seu e-mail real. Clique em **Run**.
3. Em **Authentication → Users → Add user → Create new user**, crie o seu usuário (o mesmo e-mail) com uma senha e marque **Auto Confirm User**. Repita para cada vendedor.
4. Rode também `supabase/002-cadastro-com-aprovacao.sql` e, em **Authentication → Sign In / Providers**, deixe **Allow new users to sign up** ligado e **Confirm email** desligado (o acesso só é liberado depois da sua aprovação).
5. Em **Authentication → URL Configuration**, coloque em **Site URL**: `https://paulo385.github.io/trix-motors/` (usado no "Esqueci minha senha").
6. Em **Project Settings → API Keys**, copie o **Project URL** e a chave **publishable** (ou **anon public**) e coloque no `config.js`.

Nunca use a chave **secret** / **service_role** no `config.js`: ele fica público.

### Cadastro de vendedores (com aprovação)

1. Rode também o `supabase/002-cadastro-com-aprovacao.sql` no SQL Editor (uma vez só).
2. Em **Authentication → Sign In / Providers**, deixe **Allow new users to sign up** LIGADO e **Confirm email** DESLIGADO.
3. O vendedor abre o app, toca em **Criar conta** e preenche nome, e-mail e senha.
4. Você (administrador) abre a aba **Usuários** no app, que mostra os pedidos, e toca em **Aprovar** ou **Recusar**.

Na mesma aba dá para **remover o acesso** de quem sair da loja e **tornar alguém administrador**. Quem não foi aprovado não vê nenhuma venda, mesmo tendo conta: a conferência é feita no banco.

### Ver e exportar as vendas pelo Supabase

**Table Editor → vendas** mostra todas as vendas. O botão **Export → CSV** baixa tudo.

### Pausa do plano grátis

O Supabase grátis pausa o banco depois de 7 dias sem uso. A rotina `manter-banco-ativo` do GitHub consulta o banco a cada 3 dias para evitar isso. Se mesmo assim pausar, entre no supabase.com e clique em **Restore project**. Os dados não se perdem.

## Onde os dados ficam

- **Com o banco configurado:** no Supabase. Cada pessoa entra com sua conta; ao sair, as vendas somem da tela daquele aparelho.
- **Sem banco (config.js em branco):** só no navegador de quem está usando.
- **Vendas antigas do aparelho:** depois de configurar o banco, o app oferece **Enviar para o banco** as vendas que estavam salvas só no aparelho.

## Cálculo usado

Lucro = venda − compra. Os impostos federais incidem sobre o lucro e o ICMS sobre o valor de venda.

| Imposto | Base | Alíquota |
|---|---|---|
| IRPJ | 8% do lucro | 15% |
| CSLL | 12% do lucro | 9% |
| PIS | lucro | 0,65% |
| COFINS | lucro | 3% |
| ICMS | 5% do valor de venda | 19,5% |
| Adicional IRPJ | base do IRPJ acima de R$ 60.000 no trimestre | 10% |

As alíquotas podem ser alteradas na aba **Alíquotas**. Cada venda guarda as alíquotas do dia em que foi salva.

Conferência: compra de R$ 100.000 e venda de R$ 105.000 dão R$ 1.320,25 de impostos e R$ 3.679,75 de líquido, igual à planilha.

## Importante

Este é um protótipo. Confirme as regras de imposto, os códigos de DARF e os prazos com o contador antes de usar para valer. O site guarda CPF e endereço de clientes: hospede em local seguro e com acesso restrito.
