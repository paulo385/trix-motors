/* Geração de PDF: relatório do trimestre e resumo de uma venda.
   Usa jsPDF + jsPDF-AutoTable. Recebe os dados já calculados pelo script.js. */
(function (root) {
  "use strict";

  const MARCA = [254, 130, 9];      // laranja Trix Motors
  const ESCURO = [22, 24, 28];      // grafite
  const MARCA_TXT = [180, 84, 0];   // laranja escuro para texto no branco
  const TINTA = [21, 32, 46];
  const CINZA = [90, 102, 118];
  const LINHA = [217, 223, 231];
  const FUNDO = [242, 244, 247];
  const LARANJA = [161, 92, 0];
  const VERMELHO = [180, 35, 24];
  const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

  const n2 = v => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const brl = v => (v < 0 ? "-" : "") + "R$ " + n2(Math.abs(v));
  const num = v => (v < 0 ? "-" : "") + n2(Math.abs(v));
  const pct = (v, d) => v == null ? "-" : (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: d == null ? 1 : d, maximumFractionDigits: d == null ? 1 : d }) + "%";
  const aliqTxt = v => (v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 3 }) + "%";
  const data = s => s ? s.split("-").reverse().join("/") : "-";
  const dd = d => String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
  function ultimoDiaUtil(y, m0) { const d = new Date(y, m0 + 1, 0); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1); return d; }
  function dia25(y, m0) { const d = new Date(y, m0 + 1, 25); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1); return d; }
  function triNome(t) { const [y, q] = t.split("-T"); const ms = [["jan", "mar"], ["abr", "jun"], ["jul", "set"], ["out", "dez"]][q - 1]; return q + "º trimestre de " + y + " (" + ms[0] + " a " + ms[1] + ")"; }
  function agora() { const d = new Date(); return dd(d) + " às " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }

  /* Logo só nos documentos das empresas cujo nome bate com dados.logo.empresas (padrão: TRIX) */
  function logoDe(dados, empresa) {
    const L = dados && dados.logo; if (!L || !L.data) return null;
    const lista = (L.empresas || ["TRIX"]).map(s => String(s).toUpperCase());
    return lista.includes(String(empresa || "").trim().toUpperCase()) ? L : null;
  }

  function tabela(doc, opts) {
    if (typeof doc.autoTable === "function") doc.autoTable(opts);
    else if (typeof root.__autoTable === "function") root.__autoTable(doc, opts);
    else throw new Error("jsPDF-AutoTable não carregou");
    return doc.lastAutoTable.finalY;
  }
  const baseTabela = {
    theme: "grid",
    styles: { font: "helvetica", fontSize: 8.5, textColor: TINTA, lineColor: LINHA, lineWidth: 0.1, cellPadding: 1.8 },
    headStyles: { fillColor: ESCURO, textColor: 255, fontStyle: "bold", fontSize: 8 },
    footStyles: { fillColor: FUNDO, textColor: TINTA, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [250, 251, 253] },
  };

  function cabecalho(doc, titulo, subtitulo, direita, logo) {
    const W = doc.internal.pageSize.getWidth();
    doc.setFillColor(...ESCURO); doc.rect(0, 0, W, 3, "F");
    doc.setFillColor(...MARCA); doc.rect(0, 3, W, 1.2, "F");
    let xDir = W - 14;
    if (logo && logo.data) {
      const h = 11, w = h * logo.w / logo.h;
      try { doc.addImage(logo.data, "PNG", W - 14 - w, 9, w, h); xDir = W - 14 - w - 5; } catch (e) { /* sem logo */ }
    }
    doc.setTextColor(...TINTA); doc.setFont("helvetica", "bold"); doc.setFontSize(17);
    doc.text(titulo, 14, 16);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...CINZA);
    doc.text(subtitulo, 14, 22);
    if (direita) { doc.setFontSize(8.5); doc.text(direita, xDir, 16, { align: "right" }); }
    doc.setDrawColor(...LINHA); doc.setLineWidth(0.3); doc.line(14, 26, W - 14, 26);
    return 32;
  }
  function rodapes(doc, texto) {
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...CINZA);
      doc.text(texto, 14, H - 8, { maxWidth: W - 50 });
      doc.text("Página " + i + " de " + total, W - 14, H - 8, { align: "right" });
    }
  }
  function titulo2(doc, y, txt, cor) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(11.5); doc.setTextColor(...(cor || TINTA));
    doc.text(txt, 14, y); return y + 3;
  }
  function precisaPagina(doc, y, altura) {
    const H = doc.internal.pageSize.getHeight();
    if (y + altura > H - 18) { doc.addPage(); return 18; }
    return y;
  }
  function blocosResumo(doc, y, itens) {
    const W = doc.internal.pageSize.getWidth();
    const gap = 4, w = (W - 28 - gap * (itens.length - 1)) / itens.length, h = 16;
    itens.forEach(([lbl, val, cor], i) => {
      const x = 14 + i * (w + gap);
      doc.setFillColor(...FUNDO); doc.setDrawColor(...LINHA); doc.roundedRect(x, y, w, h, 1.5, 1.5, "FD");
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...CINZA);
      doc.text(lbl.toUpperCase(), x + 3, y + 5.5);
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...(cor || TINTA));
      doc.text(val, x + 3, y + 12.5);
    });
    return y + h + 6;
  }

  /* ---------------- Relatório do trimestre ----------------
     dados = { tri:"2026-T3", empresas:[{ nome, vendas:[{v, r}], fech:{irpj,csll,pagoEm}|null }], adicLimite, adic } */
  function relatorioTrimestre(jsPDF, dados) {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const [ano, qs] = dados.tri.split("-T"); const y0 = Number(ano), q = Number(qs);
    const meses = [0, 1, 2].map(i => (q - 1) * 3 + i);
    const vencTri = dd(ultimoDiaUtil(y0, q * 3 - 1));
    const nomes = dados.empresas.map(e => e.nome).join(" e ");

    dados.empresas.forEach((emp, idx) => {
      if (idx > 0) doc.addPage();
      let y = cabecalho(doc, "Relatório de vendas e impostos · " + emp.nome, triNome(dados.tri), "Gerado em " + agora(), logoDe(dados, emp.nome));

      const vendas = emp.vendas.slice().sort((a, b) => a.v.valores.dataVenda.localeCompare(b.v.valores.dataVenda));
      const S = { venda: 0, compra: 0, lucro: 0, total: 0, liquido: 0, bcIrpj: 0, irpj: 0, bcCsll: 0, csll: 0, pis: 0, cofins: 0, icms: 0 };
      const porMes = {};
      vendas.forEach(({ v, r }) => {
        S.venda += Number(v.valores.venda); S.compra += Number(v.valores.compra);
        ["lucro", "total", "liquido", "bcIrpj", "irpj", "bcCsll", "csll", "pis", "cofins", "icms"].forEach(k => S[k] += r[k]);
        const m = Number(v.valores.dataVenda.slice(5, 7)) - 1;
        const p = porMes[m] = porMes[m] || { n: 0, venda: 0, lucro: 0, pis: 0, cofins: 0, icms: 0 };
        p.n++; p.venda += Number(v.valores.venda); p.lucro += r.lucro; p.pis += r.pis; p.cofins += r.cofins; p.icms += r.icms;
      });
      const adicional = Math.max(0, S.bcIrpj - Number(dados.adicLimite)) * Number(dados.adic);

      y = blocosResumo(doc, y, [
        ["Carros vendidos", String(vendas.length)],
        ["Faturamento", brl(S.venda)],
        ["Lucro bruto", brl(S.lucro)],
        ["Impostos", brl(S.total + adicional), LARANJA],
        ["Líquido", brl(S.liquido - adicional), S.liquido - adicional < 0 ? VERMELHO : TINTA],
      ]);

      y = titulo2(doc, y, "Vendas do trimestre");
      if (!vendas.length) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...CINZA);
        doc.text("Nenhuma venda registrada neste trimestre.", 14, y + 5); y += 12;
      } else {
        y = tabela(doc, Object.assign({}, baseTabela, {
          startY: y + 1,
          head: [["Data", "NF saída", "Veículo", "Placa", "Cliente", "Compra", "Venda", "Lucro", "IRPJ", "CSLL", "PIS", "COFINS", "ICMS", "Impostos", "Líquido", "% s/ lucro"]],
          body: vendas.map(({ v, r }) => [
            data(v.valores.dataVenda), v.valores.nfSaida || "-", v.veiculo.modelo || "-", v.veiculo.placa || "-", (v.cliente && v.cliente.nome) || "-",
            num(v.valores.compra), num(v.valores.venda), num(r.lucro), num(r.irpj), num(r.csll), num(r.pis), num(r.cofins), num(r.icms), num(r.total), num(r.liquido), pct(r.pct)]),
          foot: [["Total", "", vendas.length + " venda" + (vendas.length > 1 ? "s" : ""), "", "", num(S.compra), num(S.venda), num(S.lucro), num(S.irpj), num(S.csll), num(S.pis), num(S.cofins), num(S.icms), num(S.total), num(S.liquido), S.lucro > 0 ? pct(S.total / S.lucro) : "-"]],
          showFoot: "lastPage",
          styles: Object.assign({}, baseTabela.styles, { fontSize: 7.5, cellPadding: 1.5 }),
          headStyles: Object.assign({}, baseTabela.headStyles, { fontSize: 7, halign: "right" }),
          footStyles: Object.assign({}, baseTabela.footStyles, { halign: "right" }),
          columnStyles: (() => { const c = {}; for (let i = 5; i <= 15; i++) c[i] = { halign: "right" }; c[4] = { cellWidth: 34 }; return c; })(),
          didParseCell: h => { if (h.column.index <= 4 && (h.section === "head" || h.section === "foot")) h.cell.styles.halign = "left"; },
        })) + 8;
      }

      // Fechamento: trimestrais (esquerda) e mensais (direita)
      y = precisaPagina(doc, y, 62);
      const W = doc.internal.pageSize.getWidth();
      const colW = (W - 28 - 8) / 2;
      const yTit = y;
      titulo2(doc, yTit, "Fechamento: IRPJ e CSLL (trimestral)");
      const yA = tabela(doc, Object.assign({}, baseTabela, {
        startY: yTit + 2, margin: { left: 14 }, tableWidth: colW,
        head: [["Tributo", "Código DARF", "Base de cálculo", "Valor", "Vencimento"]],
        body: [
          ["IRPJ", "2089", num(S.bcIrpj), num(S.irpj), vencTri],
          ["Adicional IRPJ 10%", "2089", adicional ? num(Math.max(0, S.bcIrpj - dados.adicLimite)) : "-", num(adicional), vencTri],
          ["CSLL", "2372", num(S.bcCsll), num(S.csll), vencTri],
        ],
        foot: [["Total IRPJ + CSLL", "", "", num(S.irpj + adicional + S.csll), ""]],
        columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "center" } },
      }));
      doc.setFont("helvetica", "bold"); doc.setFontSize(11.5); doc.setTextColor(...TINTA);
      doc.text("PIS, COFINS e ICMS (mensais)", 14 + colW + 8, yTit);
      const yB = tabela(doc, Object.assign({}, baseTabela, {
        startY: yTit + 2, margin: { left: 14 + colW + 8 }, tableWidth: colW,
        head: [["Mês", "Vendas", "PIS (8109)", "COFINS (2172)", "ICMS", "Venc. PIS/COFINS"]],
        body: meses.map(m => { const p = porMes[m] || { n: 0, pis: 0, cofins: 0, icms: 0 }; return [MESES[m], String(p.n), num(p.pis), num(p.cofins), num(p.icms), dd(dia25(y0, m))]; }),
        foot: [["Trimestre", String(vendas.length), num(S.pis), num(S.cofins), num(S.icms), ""]],
        columnStyles: { 1: { halign: "center" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "center" } },
      }));
      y = Math.max(yA, yB) + 8;

      // Conferência com DARF pago
      const f = emp.fech;
      if (f && (f.irpj != null || f.csll != null)) {
        y = precisaPagina(doc, y, 40);
        y = titulo2(doc, y, "Conferência com o DARF pago" + (f.pagoEm ? " em " + data(f.pagoEm) : ""));
        const linha = (nome, calc, pago) => [nome, num(calc), pago == null ? "-" : num(pago), pago == null ? "-" : (pago - calc >= 0 ? "+" : "-") + n2(Math.abs(pago - calc))];
        y = tabela(doc, Object.assign({}, baseTabela, {
          startY: y + 1, tableWidth: colW,
          head: [["DARF", "Calculado (veículos)", "Pago", "Diferença"]],
          body: [linha("IRPJ", S.irpj + adicional, f.irpj), linha("CSLL", S.csll, f.csll)],
          columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
        }));
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...CINZA);
        doc.text("A diferença corresponde a receitas que não são venda de veículo (serviços, outras operações) ou a ajustes. Conferir com o contador.", 14, y + 5, { maxWidth: colW * 2 });
        y += 12;
      }
    });

    rodapes(doc, "Lucro presumido sobre a margem (venda - compra). IRPJ 8% x 15%, CSLL 12% x 9%, PIS 0,65% e COFINS 3% sobre o lucro, ICMS 19,5% sobre 5% da venda. Vencimentos consideram só fins de semana, não feriados. Documento interno: confirme valores, códigos e prazos com o contador. " + nomes + ".");
    return doc;
  }

  /* ---------------- Resumo de uma venda ----------------
     dados = { v, r, aliq, empresa } */
  function resumoVenda(jsPDF, dados) {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const { v, r, aliq: a } = dados;
    const c = v.cliente || {}, ve = v.veiculo || {}, x = v.valores || {};
    const W = doc.internal.pageSize.getWidth();
    let y = cabecalho(doc, "Resumo da venda · " + (ve.modelo || "Veículo"), (dados.empresa || "") + "  ·  Placa " + (ve.placa || "-") + "  ·  " + data(x.dataVenda), "Gerado em " + agora(), logoDe(dados, dados.empresa));

    // selo "uso interno"
    doc.setFillColor(251, 239, 220); doc.setTextColor(...LARANJA); doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
    const temLogo = !!logoDe(dados, dados.empresa); const ySelo = temLogo ? 27.5 : 19;
    if (temLogo) y += 3;
    doc.roundedRect(W - 44, ySelo, 30, 5.5, 1.2, 1.2, "F"); doc.text("USO INTERNO", W - 29, ySelo + 3.8, { align: "center" });

    const colW = (W - 28 - 6) / 2;
    const ficha = (titulo, linhas, x0, yy) => tabela(doc, Object.assign({}, baseTabela, {
      startY: yy, margin: { left: x0 }, tableWidth: colW, theme: "plain",
      head: [[{ content: titulo, colSpan: 2 }]],
      body: linhas.map(([k, val]) => [k, val || "-"]),
      styles: Object.assign({}, baseTabela.styles, { fontSize: 9, cellPadding: 1.6 }),
      headStyles: { fillColor: FUNDO, textColor: MARCA_TXT, fontStyle: "bold", fontSize: 9.5 },
      columnStyles: { 0: { textColor: CINZA, cellWidth: 30 } },
    }));
    const yC = ficha("Cliente", [["Nome", c.nome], ["CPF/CNPJ", c.doc], ["Telefone", c.telefone], ["Endereço", c.endereco], ["Cidade/UF", [c.cidade, c.uf].filter(Boolean).join(" / ")]], 14, y);
    const yV = ficha("Veículo", [["Modelo", ve.modelo], ["Ano", ve.ano], ["Placa", ve.placa], ["Renavam", ve.renavam], ["Chassi", ve.chassi], ["Origem", ve.origem], ["Compra", data(ve.dataCompra) + (ve.nfEntrada ? "  ·  NF " + ve.nfEntrada : "")]], 14 + colW + 6, y);
    y = Math.max(yC, yV) + 6;

    y = blocosResumo(doc, y, [
      ["Valor de compra", brl(Number(x.compra))],
      ["Valor de venda", brl(Number(x.venda))],
      ["Lucro bruto", brl(r.lucro), r.lucro < 0 ? VERMELHO : TINTA],
      ["Líquido", brl(r.liquido), r.liquido < 0 ? VERMELHO : MARCA_TXT],
    ]);

    y = titulo2(doc, y, "Impostos da venda");
    const linhas = [
      ["IRPJ", pct(a.irpjPres, 0) + " do lucro", num(r.bcIrpj), aliqTxt(a.irpj), num(r.irpj)],
      ["CSLL", pct(a.csllPres, 0) + " do lucro", num(r.bcCsll), aliqTxt(a.csll), num(r.csll)],
      ["PIS", "lucro", num(r.base), aliqTxt(a.pis), num(r.pis)],
      ["COFINS", "lucro", num(r.base), aliqTxt(a.cofins), num(r.cofins)],
      ["ICMS", pct(a.icmsBase, 0) + " da venda", num(r.bcIcms), aliqTxt(a.icms), num(r.icms)],
    ];
    y = tabela(doc, Object.assign({}, baseTabela, {
      startY: y + 1,
      head: [["Imposto", "Base sobre", "Base de cálculo", "Alíquota", "Valor (R$)"]],
      body: linhas,
      foot: [["Total de impostos", "", "", r.pct == null ? "" : pct(r.pct) + " do lucro", num(r.total)]],
      columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
      didParseCell: h => { if (h.section === "foot" && h.column.index >= 3) h.cell.styles.halign = "right"; if (h.section === "head" && h.column.index >= 2) h.cell.styles.halign = "right"; },
    })) + 6;

    const res = [["Valor de venda", num(Number(x.venda))], ["(-) Valor de compra", num(Number(x.compra))], ["(=) Lucro bruto", num(r.lucro)], ["(-) Impostos", num(r.total)], ["(=) Líquido da venda", num(r.liquido)]];
    if (r.custos) { res.push(["(-) Custos de preparação", num(r.custos)]); res.push(["(=) Sobra no bolso", num(r.real)]); }
    y = titulo2(doc, y, "Resultado");
    y = tabela(doc, Object.assign({}, baseTabela, {
      startY: y + 1, tableWidth: colW + 20,
      body: res, theme: "plain",
      styles: Object.assign({}, baseTabela.styles, { fontSize: 10, cellPadding: 1.8 }),
      columnStyles: { 1: { halign: "right" } },
      didParseCell: h => { if (String(h.row.raw[0]).startsWith("(=)")) { h.cell.styles.fontStyle = "bold"; h.cell.styles.fillColor = FUNDO; } },
    })) + 6;

    const extra = [["NF de saída", x.nfSaida], ["Vendedor", x.vendedor]].filter(([, val]) => val);
    if (extra.length) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...CINZA);
      doc.text(extra.map(([k, val]) => k + ": " + val).join("   ·   "), 14, y); y += 6;
    }

    rodapes(doc, "Documento interno da revenda, não é nota fiscal. Cálculo por lucro presumido sobre a margem; confirme com o contador.");
    return doc;
  }

  root.RevendaPDF = { relatorioTrimestre, resumoVenda };
})(typeof window !== "undefined" ? window : globalThis);
