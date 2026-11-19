# Trix Motors – Venda e Impostos

Site em HTML, CSS e JavaScript puro, sem framework, para cadastrar vendas de veículos e calcular os impostos (IRPJ, CSLL, PIS, COFINS e ICMS), com a mesma lógica da planilha `PLANILHA_CALCULO_-_IMPOSTO`.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | Estrutura das telas (formulários, abas, tabelas) |
| `style.css` | Visual: cores, fontes, layout, tema claro e escuro |
| `script.js` | Cálculo dos impostos, validações (CPF, placa, Renavam), histórico e fechamento |
| `pdf.js` | Monta os PDFs: relatório do trimestre e resumo de cada venda |
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

- **Relatório do trimestre:** na aba *Vendas e fechamento*, escolha o trimestre e aperte **RELATÓRIO PDF**. Sai a lista de vendas da empresa selecionada, os impostos de cada uma, o fechamento de IRPJ/CSLL e PIS/COFINS/ICMS com vencimentos e a conferência com o DARF pago.
- **PDF de uma venda:** aperte **PDF** na linha da venda, ou **Gerar PDF desta venda** logo depois de calcular. Sai a ficha do cliente e do veículo, os impostos e o resultado. É documento interno, não é nota fiscal.

## Onde os dados ficam

- **Na página publicada no Claude:** as vendas ficam salvas na nuvem e todos com acesso veem o mesmo histórico.
- **Fora do Claude (este arquivo):** as vendas ficam salvas **só no navegador de quem está usando**. O topo da página mostra "Salvando só neste navegador". Se limpar os dados do navegador, as vendas se perdem.
- Para várias pessoas usarem o mesmo histórico fora do Claude, um desenvolvedor precisa ligar o site a um banco de dados (por exemplo Supabase ou Firebase). No código, as funções `salvarVenda`, `excluirVenda`, `salvarCfg` e `salvarFech` são os únicos pontos que precisam mudar.

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
