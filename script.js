(function(){
"use strict";
const $ = id => document.getElementById(id);
const PADRAO = {irpjPres:0.08, irpj:0.15, csllPres:0.12, csll:0.09, pis:0.0065, cofins:0.03, icmsBase:0.05, icms:0.195, adicLimite:60000, adic:0.10, empresas:"TRIX, TRX"};
const CFG_META = [
  ["irpjPres","Presunção IRPJ (% do lucro)",true],["irpj","Alíquota IRPJ",true],
  ["csllPres","Presunção CSLL (% do lucro)",true],["csll","Alíquota CSLL",true],
  ["pis","PIS (sobre o lucro)",true],["cofins","COFINS (sobre o lucro)",true],
  ["icmsBase","Base do ICMS (% da venda)",true],["icms","Alíquota ICMS",true],
  ["adic","Adicional IRPJ",true],["adicLimite","Limite do adicional por trimestre (R$)",false],
  ["empresas","Empresas (separadas por vírgula)",false]
];

/* ---------- formatação ---------- */
const fmtBRL = v => (v<0?"−":"") + "R$ " + Math.abs(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtN = v => Math.abs(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtPct = (v,d=1) => (v*100).toLocaleString("pt-BR",{minimumFractionDigits:d,maximumFractionDigits:d}) + "%";
const fmtAliq = v => (v*100).toLocaleString("pt-BR",{maximumFractionDigits:3}) + "%";
const fmtData = s => s ? s.split("-").reverse().join("/") : "—";
const esc = s => String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function parseBRL(s){
  if(s==null) return NaN; s = String(s).replace(/R\$|\s/g,"");
  if(!s) return NaN;
  if(s.includes(",")) s = s.replace(/\./g,"").replace(",",".");
  else if((s.match(/\./g)||[]).length>1) s = s.replace(/\./g,"");
  else if(/^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(".","");
  const n = Number(s); return isFinite(n) ? n : NaN;
}
const hoje = () => { const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
const triDe = s => { const [y,m]=s.split("-").map(Number); return y+"-T"+(Math.floor((m-1)/3)+1); };
const triNome = t => { const [y,q]=t.split("-T"); const ms=[["jan","mar"],["abr","jun"],["jul","set"],["out","dez"]][q-1]; return q+"º trimestre "+y+" ("+ms[0]+"–"+ms[1]+")"; };

/* ---------- cálculo (mesma lógica da aba IMPOSTO da planilha) ---------- */
function calcular(compra, venda, custos, a){
  const lucro = venda - compra;
  const base = Math.max(lucro,0);
  const bcIrpj = base*a.irpjPres, irpj = bcIrpj*a.irpj;
  const bcCsll = base*a.csllPres, csll = bcCsll*a.csll;
  const pis = base*a.pis, cofins = base*a.cofins;
  const bcIcms = venda*a.icmsBase, icms = bcIcms*a.icms;
  const total = irpj+csll+pis+cofins+icms;
  const liquido = lucro - total;
  const real = liquido - (custos||0);
  return {lucro, base, bcIrpj, irpj, bcCsll, csll, pis, cofins, bcIcms, icms, total, liquido, real, custos:custos||0,
          pct: lucro>0 ? total/lucro : null, federal: irpj+csll+pis+cofins};
}
function precoMinimo(compra, custos, desejado, a){
  const k = a.irpjPres*a.irpj + a.csllPres*a.csll + a.pis + a.cofins;
  const i = a.icmsBase*a.icms;
  let v = (desejado + custos + compra*(1-k)) / (1-k-i);
  if(v < compra) v = (desejado + custos + compra) / (1-i);
  return v;
}

/* ---------- estado e armazenamento ---------- */
let cfg = {...PADRAO};
let vendas = [];
let fechamentos = {};
let db = null, modo = "conectando";
let sb = null, usuario = null, ehAdmin = false, canal = null;
let empresa = null;
let editId = null;
let ultimo = null; // último cálculo válido do formulário

const LS = "revenda-impostos-v1";
function lsLer(){ try{ return JSON.parse(localStorage.getItem(LS)) || {}; }catch(e){ return {}; } }
function lsGravar(obj){ try{ localStorage.setItem(LS, JSON.stringify(obj)); return true; }catch(e){ return false; } }
function lsCarregar(){ const o = lsLer(); vendas = o.vendas||[]; fechamentos = o.fechamentos||{}; cfg = {...PADRAO, ...(o.cfg||{})}; }
function lsSalvarTudo(){ lsGravar({vendas, fechamentos, cfg}); }

function setStatus(){
  const el = $("status");
  const m = {conectando:["","Conectando…"], nuvem:["ok","Salvo na nuvem"], local:["local","Salvando só neste navegador"],
    banco:["ok", usuario ? "Banco de dados · "+usuario : "Banco de dados"], offline:["local","Sem conexão com o banco"]}[modo] || ["",""];
  el.innerHTML = '<span class="dot '+m[0]+'"></span><span>'+m[1]+'</span>';
}
const novoId = () => "v" + Date.now().toString(36) + Math.random().toString(36).slice(2,7);

/* ---------- banco de dados Supabase ---------- */
function erroBanco(e){
  const msg = String((e && (e.message || e.error_description)) || e || "");
  if(e && (e.code==="42501" || /row-level security|permission denied/i.test(msg))) return {code:"sem_permissao", message:msg};
  if(/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) return {code:"offline", message:msg};
  return {code:(e && e.code) || "erro", message:msg};
}
function msgErro(err, padrao){
  if(err && err.code==="sem_permissao") return "Seu usuário não tem permissão para isso. Fale com o administrador.";
  if(err && err.code==="offline") return "Sem internet. Nada foi salvo; tente de novo quando a conexão voltar.";
  if(err && err.code==="quota_exceeded") return "Limite de registros atingido. Exclua vendas antigas.";
  return padrao;
}
function linhaVenda(o){
  return {id:o.id, empresa:o.empresa, data_venda:(o.valores && o.valores.dataVenda) || null, placa:(o.veiculo && o.veiculo.placa) || null, doc:o, atualizado_em:new Date().toISOString()};
}
async function sbUpsert(tabela, linhas, opcoes){
  const {error} = await sb.from(tabela).upsert(linhas, opcoes);
  if(error) throw erroBanco(error);
}
async function sbTudo(tabela){
  const out = [];
  for(let de=0; ; de+=1000){
    const {data, error} = await sb.from(tabela).select("id,doc").order("id").range(de, de+999);
    if(error) throw erroBanco(error);
    out.push(...(data||[]));
    if(!data || data.length < 1000) break;
  }
  return out;
}
async function carregarBanco(){
  const [vs, fs, cs] = await Promise.all([sbTudo("vendas"), sbTudo("fechamentos"), sbTudo("config")]);
  vendas = vs.map(r=>({...r.doc, id:r.id}));
  const f = {}; fs.forEach(r=>{ f[r.id] = r.doc; }); fechamentos = f;
  const c = cs.find(r=>r.id==="aliquotas"); cfg = {...PADRAO, ...(c ? c.doc : {})};
  if(modo==="offline"){ modo="banco"; }
  renderTudo();
}
let tRecarga = null;
function agendarRecarga(){
  clearTimeout(tRecarga);
  tRecarga = setTimeout(()=>{ if(sb && usuario) carregarBanco().catch(err=>{ if(err.code==="offline"){ modo="offline"; setStatus(); } }); }, 400);
}
function assinarMudancas(){
  if(canal || !sb.channel) return;
  try{
    canal = sb.channel("trix-mudancas")
      .on("postgres_changes", {event:"*", schema:"public", table:"vendas"}, agendarRecarga)
      .on("postgres_changes", {event:"*", schema:"public", table:"fechamentos"}, agendarRecarga)
      .on("postgres_changes", {event:"*", schema:"public", table:"config"}, agendarRecarga)
      .subscribe();
  }catch(e){ canal = null; }
}
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible" && modo!=="local" && sb && usuario) agendarRecarga(); });

async function salvarVenda(obj){
  if(modo==="banco" || modo==="offline"){ await sbUpsert("vendas", linhaVenda(obj)); const i=vendas.findIndex(v=>v.id===obj.id); if(i>=0) vendas[i]=obj; else vendas.push(obj); renderTudo(); }
  else if(modo==="nuvem"){ await db.collection("vendas").doc(obj.id).set(obj); }
  else { const i = vendas.findIndex(v=>v.id===obj.id); if(i>=0) vendas[i]=obj; else vendas.push(obj); lsSalvarTudo(); renderTudo(); }
}
async function excluirVenda(id){
  if(modo==="banco" || modo==="offline"){ const {error} = await sb.from("vendas").delete().eq("id", id); if(error) throw erroBanco(error); vendas = vendas.filter(v=>v.id!==id); renderTudo(); }
  else if(modo==="nuvem"){ await db.collection("vendas").doc(id).delete(); }
  else { vendas = vendas.filter(v=>v.id!==id); lsSalvarTudo(); renderTudo(); }
}
async function salvarCfg(novo){
  if(modo==="banco" || modo==="offline"){ await sbUpsert("config", {id:"aliquotas", doc:novo, atualizado_em:new Date().toISOString()}); cfg = {...PADRAO,...novo}; renderTudo(); }
  else if(modo==="nuvem"){ await db.doc("config/aliquotas").set(novo); }
  else { cfg = {...PADRAO,...novo}; lsSalvarTudo(); renderTudo(); }
}
async function salvarFech(id, obj){
  if(modo==="banco" || modo==="offline"){ await sbUpsert("fechamentos", {id, doc:obj, atualizado_em:new Date().toISOString()}); fechamentos[id]=obj; renderTudo(); }
  else if(modo==="nuvem"){ await db.collection("fechamentos").doc(id).set(obj); }
  else { fechamentos[id]=obj; lsSalvarTudo(); renderTudo(); }
}

/* ---------- toast / modal ---------- */
let tT;
function toast(msg){ const t=$("toast"); t.textContent=msg; t.classList.add("on"); clearTimeout(tT); tT=setTimeout(()=>t.classList.remove("on"),2600); }
function confirmar(texto, titulo, botao){
  return new Promise(res=>{
    $("mTitle").textContent = titulo || "Excluir venda?"; $("mOk").textContent = botao || "Excluir";
    $("mText").textContent = texto; $("modal").classList.add("on"); $("mCancel").focus();
    const fim = r => { $("modal").classList.remove("on"); $("mOk").onclick=$("mCancel").onclick=null; res(r); };
    $("mOk").onclick = ()=>fim(true); $("mCancel").onclick = ()=>fim(false);
  });
}

/* ---------- empresas ---------- */
const listaEmpresas = () => String(cfg.empresas||"").split(",").map(s=>s.trim()).filter(Boolean);
function renderEmpresas(){
  const lista = listaEmpresas(); if(!lista.length) lista.push("Minha empresa");
  if(!empresa || !lista.includes(empresa)){
    let salvo=null; try{ salvo = localStorage.getItem(LS+"-empresa"); }catch(e){}
    empresa = lista.includes(salvo) ? salvo : lista[0];
  }
  $("segEmpresa").innerHTML = lista.map(e=>'<button type="button" aria-pressed="'+(e===empresa)+'">'+esc(e)+'</button>').join("");
  [...$("segEmpresa").children].forEach(b=>b.onclick=()=>{ empresa=b.textContent; try{localStorage.setItem(LS+"-empresa",empresa);}catch(e){} renderTudo(); });
}

/* ---------- abas ---------- */
function rota(){
  const v = (location.hash||"#nova").slice(1);
  const ok = ["nova","vendas","aliquotas"].includes(v) ? v : "nova";
  document.querySelectorAll("section.view").forEach(s=>s.classList.toggle("on", s.id==="v-"+ok));
  document.querySelectorAll("nav.tabs a").forEach(a=>{ if(a.dataset.v===ok) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
}
window.addEventListener("hashchange", ()=>{ rota(); window.scrollTo(0,0); });

/* ---------- máscaras e validação ---------- */
function soDig(s){ return String(s||"").replace(/\D/g,""); }
function cpfValido(c){
  c = soDig(c); if(c.length!==11 || /^(\d)\1+$/.test(c)) return false;
  for(let t=9;t<11;t++){ let s=0; for(let i=0;i<t;i++) s+=Number(c[i])*(t+1-i); if(((s*10)%11)%10!==Number(c[t])) return false; }
  return true;
}
function cnpjValido(c){
  c = soDig(c); if(c.length!==14 || /^(\d)\1+$/.test(c)) return false;
  const calc = n => { let s=0, p=n-7; for(let i=0;i<n;i++){ s+=Number(c[i])*p--; if(p<2) p=9; } const r=s%11; return r<2?0:11-r; };
  return calc(12)===Number(c[12]) && calc(13)===Number(c[13]);
}
function mascaraDoc(v){
  const d = soDig(v).slice(0,14);
  if(d.length<=11) return d.replace(/(\d{3})(\d)/,"$1.$2").replace(/(\d{3})(\d)/,"$1.$2").replace(/(\d{3})(\d{1,2})$/,"$1-$2");
  return d.replace(/^(\d{2})(\d)/,"$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/,"$1.$2.$3").replace(/\.(\d{3})(\d)/,".$1/$2").replace(/(\d{4})(\d)/,"$1-$2");
}
function mascaraTel(v){ const d=soDig(v).slice(0,11); if(d.length<=2) return d; if(d.length<=6) return "("+d.slice(0,2)+") "+d.slice(2); if(d.length<=10) return "("+d.slice(0,2)+") "+d.slice(2,6)+"-"+d.slice(6); return "("+d.slice(0,2)+") "+d.slice(2,7)+"-"+d.slice(7); }
const placaOk = p => /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(String(p).replace("-","").toUpperCase());

function hint(id, msg, inputId){ $(id).textContent = msg||""; $(id).classList.toggle("err", !!msg); if(inputId) $(inputId).classList.toggle("err", !!msg); }
$("cCpf").addEventListener("input", e=>{ e.target.value = mascaraDoc(e.target.value); });
$("cCpf").addEventListener("blur", e=>{ const d=soDig(e.target.value); if(!d) return hint("hCpf","","cCpf");
  if(d.length===11) hint("hCpf", cpfValido(d)?"":"CPF inválido, confira os dígitos","cCpf");
  else if(d.length===14) hint("hCpf", cnpjValido(d)?"":"CNPJ inválido, confira os dígitos","cCpf");
  else hint("hCpf","CPF tem 11 dígitos e CNPJ tem 14","cCpf"); });
$("cTel").addEventListener("input", e=>{ e.target.value = mascaraTel(e.target.value); });
$("vPlaca").addEventListener("input", e=>{ e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g,""); });
$("vPlaca").addEventListener("blur", e=>{ const v=e.target.value; hint("hPlaca", v && !placaOk(v) ? "Use ABC1D23 ou ABC1234" : "", "vPlaca"); });
$("vRenavam").addEventListener("input", e=>{ e.target.value = soDig(e.target.value).slice(0,11); });
$("vRenavam").addEventListener("blur", e=>{ const v=e.target.value; hint("hRenavam", v && v.length!==11 ? "Renavam tem 11 dígitos" : "", "vRenavam"); });
["xCompra","xCustos","xVenda"].forEach(id=>{
  $(id).addEventListener("blur", e=>{ const n=parseBRL(e.target.value); if(!isNaN(n)) e.target.value = fmtN(n); });
  $(id).addEventListener("input", ()=>{ if(ultimo){ ultimo=null; $("bSalvar").disabled=true; renderResultado(null,"Valores alterados. Aperte CALCULAR de novo."); } });
});

/* ---------- formulário ---------- */
const CAMPOS = ["cNome","cCpf","cEnd","cTel","cCidade","cUf","vModelo","vAno","vPlaca","vRenavam","vChassi","vOrigem","vDataCompra","vNfEnt","xCompra","xCustos","xVenda","xData","xNf","xVendedor"];
function limpar(){
  CAMPOS.forEach(id=>{ const el=$(id); el.value = el.tagName==="SELECT" ? el.options[0].value : ""; el.classList.remove("err"); });
  ["hCpf","hPlaca","hRenavam"].forEach(h=>hint(h,""));
  $("xData").value = hoje(); $("formErr").textContent=""; editId=null; ultimo=null;
  $("bSalvar").disabled = true; $("bSalvar").textContent="Salvar venda";
  renderResultado(null);
}
function lerForm(){
  return {
    cliente:{nome:$("cNome").value.trim(), doc:$("cCpf").value.trim(), endereco:$("cEnd").value.trim(), telefone:$("cTel").value.trim(), cidade:$("cCidade").value.trim(), uf:$("cUf").value.trim().toUpperCase()},
    veiculo:{modelo:$("vModelo").value.trim(), ano:$("vAno").value.trim(), placa:$("vPlaca").value.trim().toUpperCase().replace("-",""), renavam:$("vRenavam").value.trim(), chassi:$("vChassi").value.trim().toUpperCase(), origem:$("vOrigem").value, dataCompra:$("vDataCompra").value, nfEntrada:$("vNfEnt").value.trim()},
    valores:{compra:parseBRL($("xCompra").value), custos:parseBRL($("xCustos").value)||0, venda:parseBRL($("xVenda").value), dataVenda:$("xData").value||hoje(), nfSaida:$("xNf").value.trim(), vendedor:$("xVendedor").value.trim()}
  };
}
function preencher(v){
  const c=v.cliente||{}, ve=v.veiculo||{}, x=v.valores||{};
  $("cNome").value=c.nome||""; $("cCpf").value=c.doc||""; $("cEnd").value=c.endereco||""; $("cTel").value=c.telefone||""; $("cCidade").value=c.cidade||""; $("cUf").value=c.uf||"";
  $("vModelo").value=ve.modelo||""; $("vAno").value=ve.ano||""; $("vPlaca").value=ve.placa||""; $("vRenavam").value=ve.renavam||""; $("vChassi").value=ve.chassi||""; $("vOrigem").value=ve.origem||"Concessionária"; $("vDataCompra").value=ve.dataCompra||""; $("vNfEnt").value=ve.nfEntrada||"";
  $("xCompra").value= isFinite(x.compra)?fmtN(x.compra):""; $("xCustos").value= x.custos?fmtN(x.custos):""; $("xVenda").value= isFinite(x.venda)?fmtN(x.venda):""; $("xData").value=x.dataVenda||hoje(); $("xNf").value=x.nfSaida||""; $("xVendedor").value=x.vendedor||"";
}
function aliqAtuais(){ const a={}; for(const k of Object.keys(PADRAO)) if(k!=="empresas") a[k]=Number(cfg[k]); return a; }

$("form").addEventListener("submit", e=>{
  e.preventDefault();
  const f = lerForm(); const erros=[];
  if(isNaN(f.valores.compra) || f.valores.compra<=0){ erros.push("valor de compra"); $("xCompra").classList.add("err"); } else $("xCompra").classList.remove("err");
  if(isNaN(f.valores.venda) || f.valores.venda<=0){ erros.push("valor de venda"); $("xVenda").classList.add("err"); } else $("xVenda").classList.remove("err");
  if(erros.length){ $("formErr").textContent = "Preencha o "+erros.join(" e o ")+" para calcular."; return; }
  $("formErr").textContent="";
  const a = aliqAtuais();
  ultimo = {form:f, aliq:a, r:calcular(f.valores.compra, f.valores.venda, f.valores.custos, a)};
  $("bSalvar").disabled = false;
  renderResultado(ultimo);
  if(window.innerWidth<=880) $("resultBox").scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
});

$("bSalvar").addEventListener("click", async ()=>{
  if(!ultimo) return;
  const f = lerForm(); const falta=[];
  if(!f.cliente.nome){ falta.push("nome do cliente"); $("cNome").classList.add("err"); } else $("cNome").classList.remove("err");
  if(!f.veiculo.modelo){ falta.push("modelo"); $("vModelo").classList.add("err"); } else $("vModelo").classList.remove("err");
  if(!placaOk(f.veiculo.placa)){ falta.push("placa válida"); $("vPlaca").classList.add("err"); } else $("vPlaca").classList.remove("err");
  const d = soDig(f.cliente.doc);
  if(d && !(d.length===11?cpfValido(d):d.length===14?cnpjValido(d):false)){ falta.push("CPF/CNPJ válido"); $("cCpf").classList.add("err"); }
  if(falta.length){ $("formErr").textContent = "Para salvar, falta: "+falta.join(", ")+"."; return; }
  $("formErr").textContent="";
  const antigo = editId ? vendas.find(v=>v.id===editId) : null;
  const obj = {id: editId||novoId(), empresa, ...f, aliq: ultimo.aliq, criadoEm: antigo?.criadoEm || new Date().toISOString(), atualizadoEm:new Date().toISOString()};
  $("bSalvar").disabled = true;
  try{ await salvarVenda(obj); toast(editId?"Venda atualizada":"Venda salva em "+empresa); limpar(); }
  catch(err){ $("bSalvar").disabled=false; $("formErr").textContent = msgErro(err, "Não foi possível salvar agora. Tente de novo em instantes."); }
});
$("bLimpar").addEventListener("click", limpar);
$("bExemplo").addEventListener("click", ()=>{
  preencher({cliente:{nome:"Cliente Exemplo da Silva", doc:"529.982.247-25", endereco:"Rua das Palmeiras, 120 – Centro", telefone:"(11) 98765-4321", cidade:"São Paulo", uf:"SP"},
    veiculo:{modelo:"BMW 430i", ano:"2025/2025", placa:"QFD5E22", renavam:"", chassi:"", origem:"Concessionária", dataCompra:"2026-04-09", nfEntrada:"CONC."},
    valores:{compra:100000, custos:0, venda:105000, dataVenda:hoje(), nfSaida:"", vendedor:""}});
  $("form").requestSubmit();
});

/* ---------- resultado ---------- */
function renderResultado(u, aviso){
  const box = $("resultCard");
  if(!u){
    box.innerHTML = '<div class="empty"><strong>'+(aviso?"Recalcular":"Resultado da venda")+'</strong>'+(aviso||"Preencha o valor de compra e o de venda e aperte <b>CALCULAR</b>. Os impostos aparecem aqui.")+'</div>';
    return;
  }
  const r=u.r, a=u.aliq, v=u.form.valores;
  const pctPill = r.pct==null ? '<span class="pill bad">Venda sem lucro</span>' : '<span class="pill '+(r.pct>0.35?"bad":r.pct>0.2?"warn":"")+'">'+fmtPct(r.pct)+' do lucro em impostos</span>';
  const icmsShare = r.total>0 ? r.icms/r.total : 0;
  box.innerHTML =
    '<div class="hero"><div><div class="lbl">Líquido da venda</div><div class="big num '+(r.liquido<0?"neg":"")+'">'+fmtBRL(r.liquido)+'</div></div><div>'+pctPill+'</div></div>'+
    '<table class="tax num"><thead><tr><th>Item</th><th>Base</th><th>Alíq.</th><th>Valor</th></tr></thead><tbody>'+
    '<tr class="sub"><td>Venda − compra</td><td>'+fmtN(v.venda)+'<small>− '+fmtN(v.compra)+'</small></td><td></td><td>'+fmtBRL(r.lucro)+'</td></tr>'+
    row("IRPJ", fmtPct(a.irpjPres,0)+" do lucro", r.bcIrpj, a.irpj, r.irpj)+
    row("CSLL", fmtPct(a.csllPres,0)+" do lucro", r.bcCsll, a.csll, r.csll)+
    row("PIS", "sobre o lucro", r.base, a.pis, r.pis)+
    row("COFINS", "sobre o lucro", r.base, a.cofins, r.cofins)+
    row("ICMS", fmtPct(a.icmsBase,0)+" da venda", r.bcIcms, a.icms, r.icms)+
    '<tr class="tot"><td>Total de impostos</td><td></td><td></td><td>'+fmtBRL(r.total)+'</td></tr>'+
    '<tr><td><b>Líquido da venda</b><small>lucro − impostos</small></td><td></td><td></td><td><b class="'+(r.liquido<0?"neg":"")+'">'+fmtBRL(r.liquido)+'</b></td></tr>'+
    (r.custos? '<tr class="sub"><td>Custos de preparação</td><td></td><td></td><td>− '+fmtN(r.custos)+'</td></tr><tr><td><b>Sobra no bolso</b><small>depois dos custos</small></td><td></td><td></td><td><b class="'+(r.real<0?"neg":"ok")+'">'+fmtBRL(r.real)+'</b></td></tr>' : '')+
    '</tbody></table>'+
    (r.total>0 ? '<div class="bar" aria-hidden="true"><span style="width:'+(100-icmsShare*100)+'%;background:var(--muted)"></span><span style="width:'+(icmsShare*100)+'%;background:var(--accent)"></span></div>'+
      '<div class="legend"><span><i style="background:var(--muted)"></i>Federais '+fmtBRL(r.federal)+'</span><span><i style="background:var(--accent)"></i>ICMS '+fmtBRL(r.icms)+' ('+fmtPct(icmsShare,0)+' do total)</span></div>' : '')+
    '<div class="minimo"><div class="row"><div class="f"><label for="mDesejado">Quanto quer ganhar líquido?</label><div class="money"><input id="mDesejado" class="num" inputmode="decimal" placeholder="0,00"></div></div>'+
    '<div><div class="hint">Vender por no mínimo</div><output id="mOut" class="num">—</output></div></div>'+
    '<p class="note" style="margin:6px 0 0">Considera compra'+(r.custos?", custos":"")+' e todos os impostos.</p></div>'+
    '<div class="actions"><button type="button" class="btn" id="bPdfVenda">Gerar PDF desta venda</button></div>';
  $("bPdfVenda").addEventListener("click", ()=>{
    const f = lerForm();
    const v = {...u.form, cliente:f.cliente, veiculo:f.veiculo, valores:{...u.form.valores, nfSaida:f.valores.nfSaida, vendedor:f.valores.vendedor, dataVenda:f.valores.dataVenda}};
    pdfDaVenda(v, empresa);
  });
  $("mDesejado").addEventListener("input", e=>{
    const d = parseBRL(e.target.value);
    $("mOut").textContent = isNaN(d) ? "—" : fmtBRL(precoMinimo(v.compra, r.custos, d, a));
  });
  function row(n, sub, base, aliq, val){ return '<tr><td>'+n+'<small>'+sub+'</small></td><td>'+fmtN(base)+'</td><td>'+fmtAliq(aliq)+'</td><td>'+fmtBRL(val)+'</td></tr>'; }
}

/* ---------- vendas e fechamento ---------- */
function calcVenda(v){ const a = {...aliqAtuais(), ...(v.aliq||{})}; return calcular(Number(v.valores.compra), Number(v.valores.venda), Number(v.valores.custos)||0, a); }
function ultimoDiaUtil(y, m0){ const d=new Date(y, m0+1, 0); while(d.getDay()===0||d.getDay()===6) d.setDate(d.getDate()-1); return d; }
function dia25(y, m0){ const d=new Date(y, m0+1, 25); while(d.getDay()===0||d.getDay()===6) d.setDate(d.getDate()-1); return d; }
const fmtD = d => String(d.getDate()).padStart(2,"0")+"/"+String(d.getMonth()+1).padStart(2,"0")+"/"+d.getFullYear();
const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function renderVendas(){
  const daEmpresa = vendas.filter(v=>v.empresa===empresa && v.valores && v.valores.dataVenda);
  const tris = new Set(daEmpresa.map(v=>triDe(v.valores.dataVenda))); tris.add(triDe(hoje()));
  const lista = [...tris].sort().reverse();
  const sel = $("selTri"); const atual = sel.value && lista.includes(sel.value) ? sel.value : (lista.find(t=>daEmpresa.some(v=>triDe(v.valores.dataVenda)===t)) || lista[0]);
  sel.innerHTML = lista.map(t=>'<option value="'+t+'"'+(t===atual?" selected":"")+'>'+triNome(t)+'</option>').join("");
  const tri = atual;
  const doTri = daEmpresa.filter(v=>triDe(v.valores.dataVenda)===tri).sort((a,b)=>a.valores.dataVenda.localeCompare(b.valores.dataVenda));
  const q = $("busca").value.trim().toLowerCase();
  const vis = q ? doTri.filter(v=>[v.veiculo?.placa,v.veiculo?.modelo,v.cliente?.nome].join(" ").toLowerCase().includes(q)) : doTri;

  const S = {venda:0,compra:0,lucro:0,total:0,liquido:0,bcIrpj:0,irpj:0,bcCsll:0,csll:0,pis:0,cofins:0,icms:0};
  const porMes = {};
  doTri.forEach(v=>{ const r=calcVenda(v); const m=Number(v.valores.dataVenda.slice(5,7))-1;
    porMes[m] = porMes[m] || {n:0,lucro:0,pis:0,cofins:0,icms:0};
    Object.assign(porMes[m], {n:porMes[m].n+1, lucro:porMes[m].lucro+r.lucro, pis:porMes[m].pis+r.pis, cofins:porMes[m].cofins+r.cofins, icms:porMes[m].icms+r.icms});
    S.venda+=Number(v.valores.venda); S.compra+=Number(v.valores.compra);
    for(const k of ["lucro","total","liquido","bcIrpj","irpj","bcCsll","csll","pis","cofins","icms"]) S[k]+=r[k]; });

  $("tiles").innerHTML =
    tile("Carros vendidos", String(doTri.length)) + tile("Faturamento", fmtBRL(S.venda)) +
    tile("Lucro bruto", fmtBRL(S.lucro)) + tile("Impostos", fmtBRL(S.total)) + tile("Líquido", fmtBRL(S.liquido));

  if(!vis.length){
    $("tbVendas").innerHTML = '<tbody><tr><td class="l" style="padding:28px;color:var(--muted);white-space:normal">'+(doTri.length?"Nenhuma venda encontrada para essa busca.":"Nenhuma venda de "+esc(empresa)+" neste trimestre. Cadastre em <a href=\"#nova\">Nova venda</a>.")+'</td></tr></tbody>';
  } else {
    let T={c:0,v:0,l:0,i:0,q:0};
    $("tbVendas").innerHTML = '<thead><tr><th class="l">Data</th><th class="l">Veículo</th><th class="l">Cliente</th><th>Compra</th><th>Venda</th><th>Lucro</th><th>Impostos</th><th>Líquido</th><th>% s/ lucro</th><th></th></tr></thead><tbody class="num">'+
      vis.map(v=>{ const r=calcVenda(v); T.c+=+v.valores.compra; T.v+=+v.valores.venda; T.l+=r.lucro; T.i+=r.total; T.q+=r.liquido;
        return '<tr><td class="l c-data" data-label="Data">'+fmtData(v.valores.dataVenda)+(v.valores.nfSaida?'<span class="sub">NF '+esc(v.valores.nfSaida)+'</span>':'')+'</td>'+
        '<td class="l c-veic" data-label="Veículo"><span class="placa"><b>BRASIL</b><span>'+esc(v.veiculo?.placa||"—")+'</span></span> '+esc(v.veiculo?.modelo||"")+'</td>'+
        '<td class="l c-cli" data-label="Cliente">'+(esc(v.cliente?.nome)||'<span class="sub">—</span>')+'</td>'+
        '<td data-label="Compra">'+fmtN(v.valores.compra)+'</td><td data-label="Venda">'+fmtN(v.valores.venda)+'</td><td data-label="Lucro" class="'+(r.lucro<0?"neg":"")+'">'+fmtN(r.lucro)+'</td><td data-label="Impostos">'+fmtN(r.total)+'</td><td data-label="Líquido" class="c-liq '+(r.liquido<0?"neg":"")+'">'+fmtN(r.liquido)+'</td><td data-label="% s/ lucro">'+(r.pct==null?"—":fmtPct(r.pct))+'</td>'+
        '<td class="c-acoes"><button class="btn sm link" data-pdf="'+esc(v.id)+'" type="button">PDF</button><button class="btn sm link" data-ed="'+esc(v.id)+'" type="button">Editar</button><button class="btn sm link danger" data-del="'+esc(v.id)+'" type="button">Excluir</button></td></tr>'; }).join("")+
      '</tbody><tfoot class="num"><tr><td class="l c-data" colspan="3">Total ('+vis.length+')</td><td data-label="Compra">'+fmtN(T.c)+'</td><td data-label="Venda">'+fmtN(T.v)+'</td><td data-label="Lucro">'+fmtN(T.l)+'</td><td data-label="Impostos">'+fmtN(T.i)+'</td><td data-label="Líquido">'+fmtN(T.q)+'</td><td data-label="% s/ lucro">'+(T.l>0?fmtPct(T.i/T.l):"—")+'</td><td class="c-acoes"></td></tr></tfoot>';
  }

  // fechamento
  const [ano, qs] = tri.split("-T"); const y=Number(ano), qn=Number(qs);
  const adicional = Math.max(0, S.bcIrpj - Number(cfg.adicLimite)) * Number(cfg.adic);
  const irpjTot = S.irpj + adicional;
  const venc = fmtD(ultimoDiaUtil(y, qn*3-1));
  const meses = [0,1,2].map(i=>(qn-1)*3+i);
  $("fechTab").innerHTML =
    '<table class="tax num"><thead><tr><th>Tributo</th><th>Base</th><th>Valor</th><th>Vencimento</th></tr></thead><tbody>'+
    '<tr><td>IRPJ<small>DARF 2089 · trimestral</small></td><td>'+fmtN(S.bcIrpj)+'</td><td>'+fmtBRL(S.irpj)+'</td><td>'+venc+'</td></tr>'+
    '<tr class="'+(adicional?"":"sub")+'"><td>Adicional IRPJ 10%<small>BC acima de '+fmtBRL(Number(cfg.adicLimite))+'</small></td><td></td><td>'+fmtBRL(adicional)+'</td><td>'+venc+'</td></tr>'+
    '<tr><td>CSLL<small>DARF 2372 · trimestral</small></td><td>'+fmtN(S.bcCsll)+'</td><td>'+fmtBRL(S.csll)+'</td><td>'+venc+'</td></tr>'+
    '<tr class="tot"><td>IRPJ + CSLL</td><td></td><td>'+fmtBRL(irpjTot+S.csll)+'</td><td></td></tr></tbody></table>'+
    '<h3 style="margin:18px 0 6px;font-size:1rem">Mensais</h3>'+
    '<table class="tax num"><thead><tr><th>Mês</th><th>Vendas</th><th>PIS<small>8109</small></th><th>COFINS<small>2172</small></th><th>ICMS</th><th>Venc. PIS/COF</th></tr></thead><tbody>'+
    meses.map(m=>{ const p=porMes[m]||{n:0,pis:0,cofins:0,icms:0}; return '<tr><td>'+MESES[m]+'</td><td>'+p.n+'</td><td>'+fmtN(p.pis)+'</td><td>'+fmtN(p.cofins)+'</td><td>'+fmtN(p.icms)+'</td><td>'+fmtD(dia25(y,m))+'</td></tr>'; }).join("")+
    '<tr class="tot"><td>Trimestre</td><td>'+doTri.length+'</td><td>'+fmtN(S.pis)+'</td><td>'+fmtN(S.cofins)+'</td><td>'+fmtN(S.icms)+'</td><td></td></tr></tbody></table>'+
    '<p class="note">Vencimentos consideram só fins de semana, não feriados. O ICMS segue a guia e o prazo do seu estado. Confirme códigos e prazos com o contador.</p>';

  // conferência
  const fid = empresa.replace(/[^A-Za-z0-9_-]/g,"_")+"-"+tri;
  const fc = fechamentos[fid] || {};
  const dif = (pago, calc) => { if(pago==null || isNaN(pago)) return '<span class="sub">—</span>'; const d=pago-calc; return '<span class="'+(Math.abs(d)<0.01?"ok":"")+'">'+(d>=0?"+":"−")+" "+fmtN(d)+'</span>'; };
  $("confBox").innerHTML =
    '<p class="note" style="margin-top:0">Lance o valor pago. A diferença mostra o que veio de outras receitas que não são venda de veículo.</p>'+
    '<table class="tax num"><thead><tr><th>DARF</th><th>Calculado</th><th>Pago</th><th>Diferença</th></tr></thead><tbody>'+
    '<tr><td>IRPJ</td><td>'+fmtN(irpjTot)+'</td><td><div class="money"><input id="pgIrpj" class="num" inputmode="decimal" value="'+(fc.irpj!=null?fmtN(fc.irpj):"")+'"></div></td><td>'+dif(fc.irpj, irpjTot)+'</td></tr>'+
    '<tr><td>CSLL</td><td>'+fmtN(S.csll)+'</td><td><div class="money"><input id="pgCsll" class="num" inputmode="decimal" value="'+(fc.csll!=null?fmtN(fc.csll):"")+'"></div></td><td>'+dif(fc.csll, S.csll)+'</td></tr></tbody></table>'+
    '<div class="fields" style="margin-top:12px"><div class="f"><label for="pgData">Pago em</label><input id="pgData" type="date" value="'+esc(fc.pagoEm||"")+'"></div></div>'+
    '<div class="actions"><button class="btn" id="bConf" type="button">Salvar conferência</button></div>';
  $("bConf").onclick = async ()=>{
    const irpj=parseBRL($("pgIrpj").value), csll=parseBRL($("pgCsll").value);
    try{ await salvarFech(fid, {empresa, trimestre:tri, irpj:isNaN(irpj)?null:irpj, csll:isNaN(csll)?null:csll, pagoEm:$("pgData").value||""}); toast("Conferência salva"); }
    catch(e){ toast(msgErro(e, "Não foi possível salvar agora")); }
  };

  function tile(l,v){ return '<div class="tile"><div class="lbl">'+l+'</div><div class="v num">'+v+'</div></div>'; }
}
$("selTri").addEventListener("change", renderVendas);
$("busca").addEventListener("input", renderVendas);
$("tbVendas").addEventListener("click", async e=>{
  const ed = e.target.closest("[data-ed]"), del = e.target.closest("[data-del]"), pdf = e.target.closest("[data-pdf]");
  if(pdf){ const v = vendas.find(x=>x.id===pdf.dataset.pdf); if(v) pdfDaVenda(v, v.empresa); return; }
  if(ed){ const v = vendas.find(x=>x.id===ed.dataset.ed); if(!v) return;
    limpar(); preencher(v); editId=v.id; if(v.empresa && v.empresa!==empresa){ empresa=v.empresa; renderEmpresas(); }
    $("bSalvar").textContent="Salvar alterações"; location.hash="#nova"; $("form").requestSubmit(); }
  if(del){ const v = vendas.find(x=>x.id===del.dataset.del); if(!v) return;
    if(await confirmar("A venda do "+(v.veiculo?.modelo||"veículo")+" placa "+(v.veiculo?.placa||"")+" será apagada do histórico.")){
      try{ await excluirVenda(v.id); toast("Venda excluída"); }catch(err){ toast(msgErro(err, "Não foi possível excluir agora")); } } }
});

/* ---------- PDF ---------- */
function jsPDFpronto(){
  const J = window.jspdf && window.jspdf.jsPDF;
  if(!J || !window.RevendaPDF){ toast("Não foi possível carregar o gerador de PDF. Confira a internet e recarregue a página."); return null; }
  return J;
}
async function entregarPDF(doc, nome){
  let dl = null;
  try{ dl = window.claude && window.claude.use ? await window.claude.use("downloads") : null; }catch(e){ dl = null; }
  if(dl){
    try{ await dl.save({filename:nome, data:doc.output("blob")}); toast("PDF pronto: "+nome); }
    catch(e){ if(e && e.code==="declined") return; if(e && e.code==="rate_limited") toast("Já existe um download aguardando confirmação"); else toast("Não foi possível baixar o PDF aqui"); }
    return;
  }
  try{ doc.save(nome); toast("PDF gerado: "+nome); }catch(e){ toast("Não foi possível baixar o PDF neste navegador"); }
}
let logoPromessa = null;
function carregarLogo(){
  if(!logoPromessa) logoPromessa = fetch("icons/logo-mark.png").then(r=>{ if(!r.ok) throw 0; return r.blob(); })
    .then(b=>new Promise((ok,erro)=>{ const fr=new FileReader(); fr.onload=()=>ok(fr.result); fr.onerror=erro; fr.readAsDataURL(b); }))
    .then(data=>new Promise(ok=>{ const im=new Image(); im.onload=()=>ok({data, w:im.naturalWidth, h:im.naturalHeight, empresas:["TRIX"]}); im.onerror=()=>ok(null); im.src=data; }))
    .catch(()=>null);
  return logoPromessa;
}
const nomeArq = s => String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^A-Za-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"");
async function pdfDaVenda(v, emp){
  const J = jsPDFpronto(); if(!J) return;
  const logo = await carregarLogo();
  const a = {...aliqAtuais(), ...(v.aliq||{})};
  const r = calcular(Number(v.valores.compra), Number(v.valores.venda), Number(v.valores.custos)||0, a);
  const doc = RevendaPDF.resumoVenda(J, {v, r, aliq:a, empresa:emp, logo});
  entregarPDF(doc, "Venda-"+nomeArq(v.veiculo?.placa||v.veiculo?.modelo||"veiculo")+"-"+(v.valores.dataVenda||hoje())+".pdf");
}
$("bPdfTri").addEventListener("click", async ()=>{
  const J = jsPDFpronto(); if(!J) return;
  const logo = await carregarLogo();
  const tri = $("selTri").value;
  const fid = empresa.replace(/[^A-Za-z0-9_-]/g,"_")+"-"+tri;
  const lista = vendas.filter(v=>v.empresa===empresa && v.valores && v.valores.dataVenda && triDe(v.valores.dataVenda)===tri).map(v=>({v, r:calcVenda(v)}));
  const doc = RevendaPDF.relatorioTrimestre(J, {tri, empresas:[{nome:empresa, vendas:lista, fech:fechamentos[fid]||null}], adicLimite:Number(cfg.adicLimite), adic:Number(cfg.adic), logo});
  const [y,q] = tri.split("-T");
  entregarPDF(doc, "Relatorio-"+nomeArq(empresa)+"-"+q+"T"+y+".pdf");
});

/* ---------- CSV ---------- */
$("bCsv").addEventListener("click", async ()=>{
  const tri = $("selTri").value;
  const rows = vendas.filter(v=>v.empresa===empresa && triDe(v.valores.dataVenda)===tri);
  const n = x => Number(x).toFixed(2).replace(".",",");
  const head = ["Empresa","Data venda","NF saída","Modelo","Placa","Renavam","Chassi","Data compra","NF entrada","Origem","Cliente","CPF/CNPJ","Endereço","Cidade","UF","Telefone","Compra","Custos","Venda","Lucro","BC IRPJ","IRPJ","BC CSLL","CSLL","PIS","COFINS","BC ICMS","ICMS","Total impostos","Líquido"];
  const q = s => '"'+String(s==null?"":s).replace(/"/g,'""')+'"';
  const lines = [head.map(q).join(";")].concat(rows.map(v=>{ const r=calcVenda(v), c=v.cliente||{}, ve=v.veiculo||{}, x=v.valores;
    return [v.empresa,fmtData(x.dataVenda),x.nfSaida,ve.modelo,ve.placa,ve.renavam,ve.chassi,fmtData(ve.dataCompra),ve.nfEntrada,ve.origem,c.nome,c.doc,c.endereco,c.cidade,c.uf,c.telefone].map(q)
      .concat([x.compra,x.custos||0,x.venda,r.lucro,r.bcIrpj,r.irpj,r.bcCsll,r.csll,r.pis,r.cofins,r.bcIcms,r.icms,r.total,r.liquido].map(n)).join(";"); }));
  const csv = "﻿" + lines.join("\r\n");
  const nome = "vendas-"+empresa+"-"+tri+".csv";
  try{
    const dl = window.claude ? await window.claude.use("downloads") : null;
    if(dl){ await dl.save({filename:nome, data:csv}); return; }
  }catch(e){ if(e && e.code && /declin|cancel|abort/i.test(e.code+" "+e.message)) return; }
  try{ await navigator.clipboard.writeText(csv.slice(1)); toast("CSV copiado. Cole no Excel."); }catch(e){ toast("Não foi possível exportar neste navegador"); }
});

/* ---------- alíquotas ---------- */
function renderCfg(){
  $("cfgFields").innerHTML = CFG_META.map(([k,l,pct])=>'<div class="f'+(k==="empresas"?" s4":"")+'"><label for="cfg_'+k+'">'+l+'</label>'+
    (pct ? '<div style="position:relative"><input id="cfg_'+k+'" class="num" inputmode="decimal" value="'+String(+(Number(cfg[k])*100).toFixed(4)).replace(".",",")+'" style="padding-right:28px;text-align:right"><span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--muted)">%</span></div>'
         : (k==="empresas" ? '<input id="cfg_'+k+'" value="'+esc(cfg[k])+'">' : '<div class="money"><input id="cfg_'+k+'" class="num" inputmode="decimal" value="'+fmtN(Number(cfg[k]))+'"></div>'))+'</div>').join("");
}
$("bCfg").addEventListener("click", async ()=>{
  const novo={}; let erro=null;
  for(const [k,l,pct] of CFG_META){ const raw=$("cfg_"+k).value;
    if(k==="empresas"){ if(!raw.split(",").map(s=>s.trim()).filter(Boolean).length) erro="Informe ao menos uma empresa."; novo[k]=raw; continue; }
    const n=parseBRL(raw); if(isNaN(n)||n<0){ erro="Confira o campo "+l+"."; break; } novo[k]= pct ? n/100 : n; }
  if(erro){ toast(erro); return; }
  try{ await salvarCfg(novo); toast("Alíquotas salvas"); }catch(e){ toast(e && e.code==="offline" ? msgErro(e,"") : "Só o administrador pode alterar as alíquotas"); }
});
$("bCfgPadrao").addEventListener("click", ()=>{ const keep=cfg.empresas; cfg={...PADRAO, empresas:keep}; renderCfg(); toast("Valores da planilha carregados. Aperte Salvar para gravar."); });

/* ---------- render geral ---------- */
function renderTudo(){
  renderEmpresas(); renderVendas();
  if(!document.activeElement || !document.activeElement.id || !document.activeElement.id.startsWith("cfg_")) renderCfg();
  setStatus();
}

/* ---------- inicialização ---------- */
limpar(); rota(); renderTudo();

/* ---------- login (Supabase) ---------- */
let telaLogin = "entrar";
const recuperandoSenha = /type=recovery/.test(location.hash);
function mostrarLogin(tela, info){
  telaLogin = tela;
  const L = {
    entrar: ["Entrar", "Use o e-mail e a senha cadastrados pelo administrador.", "ENTRAR"],
    nova:   ["Criar nova senha", "Digite a nova senha para a sua conta.", "SALVAR SENHA"],
    negado: ["Acesso não liberado", "O e-mail "+(info||"")+" entrou, mas não está na lista de usuários do app. Peça ao administrador para incluir.", ""]
  }[tela];
  $("loginTitulo").textContent = L[0]; $("loginSub").textContent = L[1];
  $("campoEmail").hidden = tela!=="entrar"; $("campoSenha").hidden = tela!=="entrar"; $("campoNova").hidden = tela!=="nova";
  $("bEntrar").hidden = tela==="negado"; $("bEntrar").textContent = L[2]; $("bEntrar").disabled = false;
  $("bEsqueci").hidden = tela!=="entrar"; $("bLoginSair").hidden = tela!=="negado";
  $("loginErr").textContent = ""; $("loginErr").classList.add("err");
  $("login").hidden = false;
  setTimeout(()=>{ const alvo = tela==="nova" ? $("lNova") : ($("lEmail").value ? $("lSenha") : $("lEmail")); if(alvo && !alvo.closest("[hidden]")) alvo.focus(); }, 50);
}
function avisoLogin(msg, ok){ $("loginErr").textContent = msg; $("loginErr").classList.toggle("err", !ok); }
function msgLogin(error){
  const m = String((error && error.message) || "");
  if(/invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
  if(/email not confirmed/i.test(m)) return "Este e-mail ainda não foi confirmado. Confira sua caixa de entrada.";
  if(/failed to fetch|network/i.test(m)) return "Sem internet. Confira a conexão e tente de novo.";
  if(/password should be at least|weak/i.test(m)) return "A senha precisa ter pelo menos 6 caracteres.";
  if(/rate limit|too many/i.test(m)) return "Muitas tentativas. Espere alguns minutos e tente de novo.";
  return "Não foi possível entrar: " + m;
}
function pararBanco(){
  if(canal && sb){ try{ sb.removeChannel(canal); }catch(e){} }
  canal = null; usuario = null; ehAdmin = false;
  vendas = []; fechamentos = {}; cfg = {...PADRAO};
  $("bSair").hidden = true; $("migrar").hidden = true;
  renderTudo();
}
async function entrarNoApp(session){
  usuario = session.user.email; setStatus();
  const {data, error} = await sb.from("membros").select("email,nome,admin").limit(1);
  if(error){
    const e = erroBanco(error);
    if(e.code==="offline"){ $("login").hidden = true; modo="offline"; $("bSair").hidden=false; setStatus(); toast("Sem internet. As vendas aparecem quando a conexão voltar."); return; }
    mostrarLogin("entrar"); avisoLogin("Erro ao abrir o banco: " + e.message); return;
  }
  if(!data || !data.length){ mostrarLogin("negado", usuario); return; }
  ehAdmin = !!data[0].admin;
  $("login").hidden = true; $("bSair").hidden = false; modo = "banco"; setStatus();
  try{ await carregarBanco(); }catch(e){ if(e.code==="offline"){ modo="offline"; setStatus(); } else toast("Erro ao carregar as vendas: " + e.message); }
  assinarMudancas();
  verificarMigracao();
}
async function iniciarBanco(){
  const C = window.TRIX_CONFIG || {};
  if(!C.supabaseUrl || !C.supabaseKey || !window.supabase || !window.supabase.createClient) return false;
  try{
    sb = window.supabase.createClient(C.supabaseUrl.trim(), C.supabaseKey.trim(), {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}});
  }catch(e){ console.error(e); return false; }
  modo = "banco"; setStatus();
  sb.auth.onAuthStateChange((evento)=>{
    if(evento==="PASSWORD_RECOVERY"){ mostrarLogin("nova"); }
    else if(evento==="SIGNED_OUT"){ pararBanco(); mostrarLogin("entrar"); }
  });
  const {data} = await sb.auth.getSession();
  if(recuperandoSenha){ mostrarLogin("nova"); }
  else if(data && data.session){ await entrarNoApp(data.session); }
  else { mostrarLogin("entrar"); }
  return true;
}
$("loginForm").addEventListener("submit", async e=>{
  e.preventDefault();
  if(!sb) return;
  if(telaLogin==="entrar"){
    const email = $("lEmail").value.trim(), senha = $("lSenha").value;
    if(!email || !senha){ avisoLogin("Preencha o e-mail e a senha."); return; }
    $("bEntrar").disabled = true; avisoLogin("Entrando…", true);
    const {data, error} = await sb.auth.signInWithPassword({email, password:senha});
    $("bEntrar").disabled = false;
    if(error){ avisoLogin(msgLogin(error)); return; }
    $("lSenha").value = "";
    await entrarNoApp(data.session);
  } else if(telaLogin==="nova"){
    const nova = $("lNova").value;
    if(nova.length < 6){ avisoLogin("A senha precisa ter pelo menos 6 caracteres."); return; }
    $("bEntrar").disabled = true;
    const {error} = await sb.auth.updateUser({password:nova});
    $("bEntrar").disabled = false;
    if(error){ avisoLogin(msgLogin(error)); return; }
    $("lNova").value = "";
    try{ history.replaceState(null, "", location.pathname + "#nova"); }catch(err){}
    rota(); toast("Senha alterada");
    const {data} = await sb.auth.getSession();
    if(data && data.session) await entrarNoApp(data.session); else mostrarLogin("entrar");
  }
});
$("bEsqueci").addEventListener("click", async ()=>{
  const email = $("lEmail").value.trim();
  if(!email){ avisoLogin("Digite seu e-mail acima e toque de novo em \"Esqueci minha senha\"."); $("lEmail").focus(); return; }
  const {error} = await sb.auth.resetPasswordForEmail(email, {redirectTo: location.origin + location.pathname});
  if(error) avisoLogin(msgLogin(error));
  else avisoLogin("Se esse e-mail estiver cadastrado, enviamos um link para criar uma nova senha.", true);
});
$("bLoginSair").addEventListener("click", ()=>{ sb && sb.auth.signOut(); });
$("bSair").addEventListener("click", async ()=>{
  if(!sb) return;
  if(await confirmar("Sair da conta "+(usuario||"")+" neste aparelho?", "Sair da conta?", "Sair")) sb.auth.signOut();
});

/* ---------- enviar vendas antigas do aparelho para o banco ---------- */
let pendentesLocais = null;
function verificarMigracao(){
  const o = lsLer(); const n = (o.vendas||[]).length;
  let feito = false; try{ feito = localStorage.getItem(LS+"-migrado")==="1"; }catch(e){}
  if(!n || feito){ $("migrar").hidden = true; return; }
  pendentesLocais = o;
  $("migrarTxt").innerHTML = "Este aparelho tem <b>"+n+" venda"+(n>1?"s":"")+"</b> salva"+(n>1?"s":"")+" só nele, de antes do banco de dados. Quer enviar para o banco, para todos verem?";
  $("migrar").hidden = false;
}
$("bMigrar").addEventListener("click", async ()=>{
  if(!pendentesLocais) return;
  $("bMigrar").disabled = true;
  try{
    const vs = (pendentesLocais.vendas||[]).filter(v=>v && v.id && v.valores);
    if(vs.length) await sbUpsert("vendas", vs.map(linhaVenda), {onConflict:"id", ignoreDuplicates:true});
    const fs = Object.entries(pendentesLocais.fechamentos||{}).map(([id,doc])=>({id, doc, atualizado_em:new Date().toISOString()}));
    if(fs.length) await sbUpsert("fechamentos", fs, {onConflict:"id", ignoreDuplicates:true});
    try{ localStorage.setItem(LS+"-migrado","1"); }catch(e){}
    $("migrar").hidden = true; toast(vs.length+" venda"+(vs.length>1?"s":"")+" enviada"+(vs.length>1?"s":"")+" para o banco");
    await carregarBanco();
  }catch(e){ toast(msgErro(e, "Não foi possível enviar agora: "+(e.message||""))); }
  $("bMigrar").disabled = false;
});
$("bMigrarNao").addEventListener("click", ()=>{ $("migrar").hidden = true; });

(async function conectar(){
  let ns = null;
  try{ ns = window.claude && window.claude.use ? await window.claude.use("db") : null; }catch(e){ ns=null; }
  if(!ns){
    if(await iniciarBanco().catch(e=>{ console.error(e); return false; })) return;
    modo="local"; lsCarregar(); renderTudo(); return;
  }
  db = ns; modo="nuvem"; setStatus();
  const timer = setTimeout(()=>{ const s=$("status"); s.innerHTML='<span class="dot local"></span><span>Sem conexão com a nuvem ainda</span>'; }, 10000);
  const fail = err => { clearTimeout(timer); if(err && err.code==="revoked"){ modo="local"; lsCarregar(); } renderTudo(); };
  db.collection("vendas").onSnapshot(snap=>{ if(!snap.metadata.fromCache){ clearTimeout(timer); setStatus(); }
    vendas = snap.docs.map(d=>({id:d.id, ...d.data()})); renderTudo(); }, fail);
  db.doc("config/aliquotas").onSnapshot(snap=>{ cfg = {...PADRAO, ...(snap.exists?snap.data():{})}; renderTudo(); }, fail);
  db.collection("fechamentos").onSnapshot(snap=>{ const o={}; snap.docs.forEach(d=>o[d.id]=d.data()); fechamentos=o; renderTudo(); }, fail);
})();

/* ---------- App instalável (PWA) ---------- */
(function(){
  const dentroDoClaude = (()=>{ try{ return window.self !== window.top; }catch(e){ return true; } })();
  const instalado = matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const podeSW = "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1");

  if(podeSW && !dentroDoClaude){
    window.addEventListener("load", ()=>{ navigator.serviceWorker.register("sw.js").catch(()=>{}); });
  }

  const btn = document.getElementById("bInstalar");
  let pedido = null;
  window.addEventListener("beforeinstallprompt", e=>{
    e.preventDefault(); pedido = e;
    if(!instalado) btn.hidden = false;
  });
  btn.addEventListener("click", async ()=>{
    if(pedido){
      pedido.prompt();
      try{ const r = await pedido.userChoice; if(r.outcome === "accepted") btn.hidden = true; }catch(e){}
      pedido = null;
    } else if(ehIOS()){
      mostrarDicaIOS(true);
    }
  });
  window.addEventListener("appinstalled", ()=>{ btn.hidden = true; toast("App instalado na tela inicial"); });

  function ehIOS(){ return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
  function mostrarDicaIOS(forcar){
    let visto = false; try{ visto = localStorage.getItem(LS+"-dica-ios") === "1"; }catch(e){}
    if(visto && !forcar) return;
    document.getElementById("iosTip").hidden = false;
  }
  document.getElementById("iosTipFechar").addEventListener("click", ()=>{
    document.getElementById("iosTip").hidden = true;
    try{ localStorage.setItem(LS+"-dica-ios","1"); }catch(e){}
  });
  // No iPhone o Safari não mostra aviso de instalação: mostramos o botão e a dica
  if(ehIOS() && !instalado && !dentroDoClaude && podeSW){
    btn.hidden = false;
    setTimeout(()=>mostrarDicaIOS(false), 1500);
  }
})();
})();
