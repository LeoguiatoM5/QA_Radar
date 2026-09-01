/**
 * Scripts do QA Toolbox no navegador.
 *
 * Cada um é um módulo ES embutido na página que importa a regra de negócio de
 * `/assets/toolbox/`, servida a partir de `src/toolbox/`. A divisão é
 * proposital: o que decide (diff, limites, geração, decodificação) é TypeScript
 * tipado e testado; o que está aqui só lê campo, chama a função e desenha o
 * resultado.
 *
 * Como nos demais clientes do produto, nada aqui usa interpolação de template
 * (`${...}`) nem crase: estes textos vivem dentro de um `String.raw` do
 * servidor, e as duas coisas seriam consumidas por ele.
 */

/**
 * Utilidades compartilhadas por todas as ferramentas.
 *
 * Prefixado em cada script em vez de virar um módulo importado porque depende do
 * DOM, e o restante de `src/toolbox/` é deliberadamente livre de navegador para
 * poder rodar nos testes do Node.
 */
const TOOLBOX_UI = String.raw`
const $=id=>document.getElementById(id);
const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
function showError(box,message){if(!box)return;box.textContent=message;box.style.display='block'}
function clearError(box){if(!box)return;box.textContent='';box.style.display='none'}
function show(panel,visible){if(panel)panel.hidden=!visible}
// O retorno visual do "copiar" vive no próprio botão: um aviso flutuante
// exigiria posicionamento e ainda sumiria fora do campo de visão em telas altas.
async function copyText(button,text){
  const original=button.dataset.label||button.textContent;
  button.dataset.label=original;
  try{
    await navigator.clipboard.writeText(text);
    button.textContent='Copiado';
  }catch{
    button.textContent='Não foi possível copiar';
  }
  setTimeout(()=>{button.textContent=original},1800);
}
function downloadFile(name,content,type){
  const blob=new Blob([content],{type:type+';charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;link.download=name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}
function stamp(){return new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}
`;

export const TOOLBOX_HOME_SCRIPT =
  TOOLBOX_UI +
  String.raw`
import { QA_TOOLS, searchTools } from '/assets/toolbox/catalog.js';

const input=$('toolbox-search-input');
const count=$('toolbox-search-count');
const empty=$('toolbox-empty');
const favoritesSection=$('toolbox-favorites');
const favoritesGrid=$('toolbox-favorites-grid');
const sections=[...document.querySelectorAll('[data-tool-category-section]:not(.tool-category-favorites)')];

// As favoritas ficam só neste navegador: são preferência de uso, não dado de
// conta, e mandá-las para o servidor criaria um histórico de quem usa o quê sem
// nenhum ganho para quem usa.
const FAVORITES_KEY='qa-radar-toolbox-favorites';
function readFavorites(){
  try{const raw=JSON.parse(localStorage.getItem(FAVORITES_KEY)||'[]');return Array.isArray(raw)?raw.filter(id=>typeof id==='string'):[]}
  catch{return []}
}
function writeFavorites(ids){
  try{localStorage.setItem(FAVORITES_KEY,JSON.stringify(ids))}catch{}
}
let favorites=readFavorites();

function slots(){return [...document.querySelectorAll('[data-tool-slot]')]}
function cards(){return [...document.querySelectorAll('[data-tool-card]')]}

function paintFavorites(){
  if(!favoritesGrid)return;
  favoritesGrid.innerHTML='';
  for(const id of favorites){
    const origem=document.querySelector('.tool-category:not(.tool-category-favorites) [data-tool-slot="'+id+'"]');
    if(!origem)continue;
    const copia=origem.cloneNode(true);
    copia.dataset.toolClone='true';
    favoritesGrid.appendChild(copia);
  }
  for(const botao of document.querySelectorAll('[data-tool-favorite]')){
    const marcada=favorites.includes(botao.dataset.toolFavorite);
    botao.setAttribute('aria-pressed',String(marcada));
    botao.classList.toggle('active',marcada);
    botao.title=marcada?'Remover dos favoritos':'Favoritar';
  }
}

function toggleFavorite(id){
  favorites=favorites.includes(id)?favorites.filter(other=>other!==id):[...favorites,id];
  writeFavorites(favorites);
  paintFavorites();
  apply(input?input.value:'');
}

document.addEventListener('click',event=>{
  const botao=event.target.closest?event.target.closest('[data-tool-favorite]'):null;
  if(!botao)return;
  event.preventDefault();
  toggleFavorite(botao.dataset.toolFavorite);
});

function apply(query){
  const matches=new Set(searchTools(query,QA_TOOLS).map(tool=>tool.id));
  const todos=cards();
  let visible=0;
  for(const slot of slots()){
    slot.hidden=!matches.has(slot.dataset.toolSlot);
  }
  for(const card of todos){
    const hit=matches.has(card.dataset.toolId);
    card.hidden=!hit;
    // Um card clonado na faixa de favoritas não conta duas vezes no total.
    if(hit&&!card.closest('.tool-category-favorites'))visible+=1;
  }
  for(const section of sections){
    const any=[...section.querySelectorAll('[data-tool-card]')].some(card=>!card.hidden);
    section.hidden=!any;
  }
  if(favoritesSection){
    const any=[...favoritesSection.querySelectorAll('[data-tool-card]')].some(card=>!card.hidden);
    favoritesSection.hidden=!any;
  }
  show(empty,visible===0);
  if(count)count.textContent=visible===0?'Nenhuma ferramenta encontrada.':visible+' de '+todos.filter(card=>!card.closest('.tool-category-favorites')).length+' ferramentas.';
}

input?.addEventListener('input',()=>apply(input.value));
// "/" leva ao campo de busca, atalho já esperado por quem usa ferramenta de dev.
document.addEventListener('keydown',event=>{
  if(event.key!=='/'||event.ctrlKey||event.metaKey||event.altKey)return;
  const active=document.activeElement;
  if(active&&/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))return;
  event.preventDefault();
  input?.focus();
});
paintFavorites();
apply('');
`;

export const JSON_DIFF_SCRIPT =
  TOOLBOX_UI +
  String.raw`
import { parseJsonInput } from '/assets/toolbox/json-value.js';
import { diffJson, formatJsonDiff, formatJsonText, JSON_DIFF_LABELS } from '/assets/toolbox/json-diff.js';

const left=$('diff-left'),right=$('diff-right'),ignore=$('diff-ignore'),errorBox=$('diff-error');
const panel=$('diff-result-panel'),summary=$('diff-summary'),list=$('diff-list'),ignored=$('diff-ignored');
let lastResult=null;

function ignoreRules(){
  return ignore.value.split(',').map(rule=>rule.trim()).filter(Boolean);
}

function preview(value){
  return value===undefined?'—':JSON.stringify(value);
}

function renderEntry(entry){
  const kind=JSON_DIFF_LABELS[entry.kind];
  const rows=entry.kind==='added'
    ?'<span class="diff-after">'+esc(preview(entry.after))+'</span>'
    :entry.kind==='removed'
      ?'<span class="diff-before">'+esc(preview(entry.before))+'</span>'
      :'<span class="diff-before">'+esc(preview(entry.before))+'</span><span class="diff-arrow" aria-hidden="true">↓</span><span class="diff-after">'+esc(preview(entry.after))+'</span>';
  const types=entry.kind==='type_changed'?'<small class="diff-types">'+esc(entry.beforeKind)+' → '+esc(entry.afterKind)+'</small>':'';
  return '<div class="diff-entry diff-'+entry.kind+'"><span class="diff-kind">'+kind+'</span><div class="diff-body"><code class="diff-path">'+esc(entry.path)+'</code><div class="diff-values">'+rows+'</div>'+types+'</div></div>';
}

function run(){
  clearError(errorBox);
  try{
    const before=parseJsonInput(left.value,'Original');
    const after=parseJsonInput(right.value,'Comparar com');
    const result=diffJson(before,after,{ignore:ignoreRules()});
    lastResult=result;
    show(panel,true);
    summary.innerHTML=result.equal
      ?'<span class="tool-status tool-status-ok">SEM DIFERENÇAS</span><span class="tool-summary-text">Os dois JSON são equivalentes com as regras aplicadas.</span>'
      :'<span class="tool-status tool-status-warning">'+result.entries.length+' DIFERENÇA(S)</span><span class="tool-summary-text">'+result.counts.added+' adicionada(s) · '+result.counts.removed+' removida(s) · '+result.counts.changed+' alterada(s) · '+result.counts.type_changed+' com mudança de tipo</span>';
    list.innerHTML=result.entries.map(renderEntry).join('');
    if(result.ignored.length){
      ignored.hidden=false;
      ignored.textContent='Campos ignorados nesta comparação: '+result.ignored.join(', ');
    }else ignored.hidden=true;
    panel.scrollIntoView({block:'nearest',behavior:'smooth'});
  }catch(error){
    show(panel,false);
    showError(errorBox,error instanceof Error?error.message:'Não foi possível comparar.');
  }
}

$('diff-run')?.addEventListener('click',run);
$('diff-format')?.addEventListener('click',()=>{
  clearError(errorBox);
  try{
    if(left.value.trim())left.value=formatJsonText(left.value,'Original');
    if(right.value.trim())right.value=formatJsonText(right.value,'Comparar com');
  }catch(error){showError(errorBox,error instanceof Error?error.message:'JSON inválido.')}
});
$('diff-swap')?.addEventListener('click',()=>{
  const buffer=left.value;left.value=right.value;right.value=buffer;
  if(lastResult)run();
});
$('diff-clear')?.addEventListener('click',()=>{
  left.value='';right.value='';ignore.value='';lastResult=null;
  // Esconder o painel não basta: o payload comparado continuaria no DOM,
  // visível no inspetor e em qualquer captura de tela. Numa ferramenta que
  // promete não mandar nada para fora, "Limpar" tem de apagar de verdade.
  list.innerHTML='';summary.innerHTML='';ignored.textContent='';ignored.hidden=true;
  clearError(errorBox);show(panel,false);
  left.focus();
});
$('diff-copy')?.addEventListener('click',event=>{if(lastResult)copyText(event.currentTarget,formatJsonDiff(lastResult))});
$('diff-download')?.addEventListener('click',()=>{if(lastResult)downloadFile('json-diff-'+stamp()+'.txt',formatJsonDiff(lastResult),'text/plain')});
// Ctrl/Cmd + Enter compara sem tirar a mão do teclado, como no cliente de API.
for(const field of [left,right,ignore]){
  field?.addEventListener('keydown',event=>{
    if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();run()}
  });
}
`;

export const BOUNDARY_SCRIPT =
  TOOLBOX_UI +
  String.raw`
import { generateBoundaryCases, formatBoundaryCases, boundaryCasesToCsv } from '/assets/toolbox/boundary-values.js';

const form=$('boundary-form'),errorBox=$('boundary-error'),panel=$('boundary-result-panel'),rows=$('boundary-rows');
const type=$('boundary-type'),stepField=$('boundary-step-field'),minimum=$('boundary-min'),maximum=$('boundary-max');
let lastCases=[];

const PRESETS={integer:['18','65'],decimal:['0.01','999.99'],'string-length':['3','20'],date:['2026-01-01','2026-12-31']};

function syncType(){
  stepField.hidden=type.value!=='decimal';
  const preset=PRESETS[type.value];
  if(preset){minimum.value=preset[0];maximum.value=preset[1]}
  minimum.placeholder=preset?preset[0]:'';
  maximum.placeholder=preset?preset[1]:'';
}

function render(cases){
  rows.innerHTML=cases.map(item=>'<tr class="'+(item.valid?'boundary-valid':'boundary-invalid')+'"><th scope="row">'+esc(item.id)+'</th><td><code>'+esc(item.display)+'</code></td><td><span class="tool-status '+(item.valid?'tool-status-ok':'tool-status-fail')+'">'+(item.valid?'VALID':'INVALID')+'</span></td><td>'+esc(item.title)+'</td></tr>').join('');
}

function run(event){
  event?.preventDefault();
  clearError(errorBox);
  try{
    const spec={field:$('boundary-field').value,type:type.value,minimum:minimum.value,maximum:maximum.value};
    if(type.value==='decimal')spec.step=Number($('boundary-step').value);
    lastCases=generateBoundaryCases(spec);
    render(lastCases);
    show(panel,true);
  }catch(error){
    show(panel,false);
    showError(errorBox,error instanceof Error?error.message:'Não foi possível gerar os casos.');
  }
}

type?.addEventListener('change',syncType);
form?.addEventListener('submit',run);
$('boundary-clear')?.addEventListener('click',()=>{
  lastCases=[];clearError(errorBox);show(panel,false);
  $('boundary-field').value='';minimum.value='';maximum.value='';
  $('boundary-field').focus();
});
$('boundary-copy')?.addEventListener('click',event=>{if(lastCases.length)copyText(event.currentTarget,formatBoundaryCases(lastCases))});
$('boundary-download')?.addEventListener('click',()=>{if(lastCases.length)downloadFile('boundary-values-'+stamp()+'.csv',boundaryCasesToCsv(lastCases),'text/csv')});
syncType();
`;

export const TEST_DATA_SCRIPT =
  TOOLBOX_UI +
  String.raw`
import { generateTestData, testDataToCsv, testDataToSql } from '/assets/toolbox/test-data.js';

const errorBox=$('data-error'),panel=$('data-result-panel'),output=$('data-output');
let rows=[];
let format='json';

function selectedFields(){
  return [...document.querySelectorAll('[data-field-type]')].filter(box=>box.checked).map(box=>{
    const type=box.dataset.fieldType;
    return {
      type,
      key:document.querySelector('[data-field-key="'+type+'"]').value.trim(),
      mode:document.querySelector('[data-field-mode="'+type+'"]').value,
    };
  });
}

function serialize(){
  if(!rows.length)return '';
  if(format==='csv')return testDataToCsv(rows);
  if(format==='sql')return testDataToSql(rows,$('data-table').value.trim());
  return JSON.stringify(rows,null,2);
}

function paint(){
  output.textContent=serialize();
}

function run(){
  clearError(errorBox);
  try{
    rows=generateTestData({fields:selectedFields(),count:Number($('data-count').value)});
    paint();
    show(panel,true);
  }catch(error){
    rows=[];
    show(panel,false);
    showError(errorBox,error instanceof Error?error.message:'Não foi possível gerar a massa.');
  }
}

$('data-generate')?.addEventListener('click',run);
$('data-regenerate')?.addEventListener('click',run);
$('data-clear')?.addEventListener('click',()=>{
  rows=[];output.textContent='';
  clearError(errorBox);show(panel,false);
  for(const box of document.querySelectorAll('[data-field-type]'))box.checked=false;
});
for(const tab of document.querySelectorAll('[data-data-format]')){
  tab.addEventListener('click',()=>{
    format=tab.dataset.dataFormat;
    for(const other of document.querySelectorAll('[data-data-format]')){
      const active=other===tab;
      other.classList.toggle('active',active);
      other.setAttribute('aria-selected',String(active));
    }
    paint();
  });
}
$('data-copy')?.addEventListener('click',event=>{if(rows.length)copyText(event.currentTarget,serialize())});
$('data-download-json')?.addEventListener('click',()=>{if(rows.length)downloadFile('test-data-'+stamp()+'.json',JSON.stringify(rows,null,2),'application/json')});
$('data-download-csv')?.addEventListener('click',()=>{if(rows.length)downloadFile('test-data-'+stamp()+'.csv',testDataToCsv(rows),'text/csv')});
// Marcar o campo já sugere o nome da propriedade; desmarcar não apaga o que a
// pessoa escreveu, para que remarcar não custe digitar de novo.
for(const box of document.querySelectorAll('[data-field-type]')){
  box.addEventListener('change',()=>{
    if(!box.checked)return;
    const key=document.querySelector('[data-field-key="'+box.dataset.fieldType+'"]');
    if(key&&!key.value.trim())key.value=box.dataset.fieldType;
  });
}
`;

export const JWT_SCRIPT =
  TOOLBOX_UI +
  String.raw`
import { inspectJwt, JWT_STATUS_LABELS, formatDuration } from '/assets/toolbox/jwt.js';

const input=$('jwt-input'),errorBox=$('jwt-error'),panel=$('jwt-result-panel');
const statusBox=$('jwt-status'),claims=$('jwt-claims'),headerBox=$('jwt-header'),payloadBox=$('jwt-payload'),warnings=$('jwt-warnings');
let lastPayload='';

const STATUS_CLASS={valid_structure:'tool-status-ok',expired:'tool-status-fail',not_active_yet:'tool-status-warning',invalid:'tool-status-fail'};

function moment(value){
  return value===undefined?'—':new Date(value).toLocaleString('pt-BR')+' ('+new Date(value).toISOString()+')';
}

function fact(term,value){
  return '<div><dt>'+esc(term)+'</dt><dd>'+esc(value)+'</dd></div>';
}

function decode(){
  clearError(errorBox);
  const result=inspectJwt(input.value);
  if(!result.decoded){
    show(panel,false);
    lastPayload='';
    showError(errorBox,result.error||'Token inválido.');
    return;
  }
  statusBox.className='tool-status '+STATUS_CLASS[result.status];
  statusBox.textContent=JWT_STATUS_LABELS[result.status];
  // Desvio do RFC aparece antes dos claims: é o que explica uma expiração que
  // parece errada, e sem isso o QA acredita no número sem saber de onde veio.
  warnings.innerHTML=result.warnings.map(aviso=>'<li>'+esc(aviso)+'</li>').join('');
  warnings.hidden=result.warnings.length===0;
  const remaining=result.timeRemainingMs===undefined
    ?'Sem exp: o token não declara expiração.'
    :result.timeRemainingMs>0?'Expira em '+formatDuration(result.timeRemainingMs):'Expirado há '+formatDuration(result.timeRemainingMs);
  claims.innerHTML=[
    fact('Algoritmo declarado',result.algorithm||'—'),
    fact('Issued at (iat)',moment(result.timestamps.issuedAt)),
    fact('Expires at (exp)',moment(result.timestamps.expiresAt)),
    fact('Not before (nbf)',moment(result.timestamps.notBefore)),
    fact('Tempo restante',remaining),
    fact('Assinatura',result.signaturePresent?'Presente, não verificada':'Ausente'),
  ].join('');
  headerBox.textContent=JSON.stringify(result.header,null,2);
  lastPayload=JSON.stringify(result.payload,null,2);
  payloadBox.textContent=lastPayload;
  show(panel,true);
}

$('jwt-decode')?.addEventListener('click',decode);
$('jwt-clear')?.addEventListener('click',()=>{
  // Limpar precisa apagar de verdade: o token não pode continuar em memória
  // esperando o próximo "copiar".
  input.value='';lastPayload='';
  headerBox.textContent='';payloadBox.textContent='';claims.innerHTML='';
  warnings.innerHTML='';warnings.hidden=true;
  clearError(errorBox);show(panel,false);
  input.focus();
});
$('jwt-copy')?.addEventListener('click',event=>{if(lastPayload)copyText(event.currentTarget,lastPayload)});
input?.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();decode()}
});
`;

export const CURL_SCRIPT =
  TOOLBOX_UI +
  String.raw`
import { parseCurl, convertCurl, maskParsedCurl, formatCurl, isSecretHeader } from '/assets/toolbox/curl.js';

const input=$('curl-input'),errorBox=$('curl-error'),panel=$('curl-result-panel'),facts=$('curl-facts'),output=$('curl-output');
let parsed=null;
let target='playwright';

function fact(term,value,secret){
  return '<div><dt>'+esc(term)+'</dt><dd'+(secret?' class="tool-secret"':'')+'>'+esc(value)+'</dd></div>';
}

function paint(){
  if(!parsed)return;
  output.textContent=convertCurl(parsed,target);
}

function convert(){
  clearError(errorBox);
  try{
    parsed=parseCurl(input.value);
    const masked=maskParsedCurl(parsed);
    const items=[fact('Método',masked.method),fact('URL',masked.url)];
    for(const param of masked.query)items.push(fact('Query · '+param.name,param.value));
    for(const header of masked.headers)items.push(fact('Header · '+header.name,header.value,isSecretHeader(header.name)));
    if(masked.basicAuth)items.push(fact('Basic auth',masked.basicAuth,true));
    if(masked.body!==undefined)items.push(fact('Body',masked.body.length>400?masked.body.slice(0,400)+'…':masked.body));
    facts.innerHTML=items.join('');
    paint();
    show(panel,true);
  }catch(error){
    parsed=null;
    show(panel,false);
    showError(errorBox,error instanceof Error?error.message:'Não foi possível interpretar o comando.');
  }
}

$('curl-convert')?.addEventListener('click',convert);
$('curl-format')?.addEventListener('click',()=>{
  clearError(errorBox);
  try{input.value=formatCurl(input.value)}
  catch(error){showError(errorBox,error instanceof Error?error.message:'Comando inválido.')}
});
$('curl-clear')?.addEventListener('click',()=>{
  input.value='';parsed=null;output.textContent='';facts.innerHTML='';
  clearError(errorBox);show(panel,false);
  input.focus();
});
$('curl-copy')?.addEventListener('click',event=>{if(parsed)copyText(event.currentTarget,convertCurl(parsed,target))});
for(const tab of document.querySelectorAll('[data-curl-target]')){
  tab.addEventListener('click',()=>{
    target=tab.dataset.curlTarget;
    for(const other of document.querySelectorAll('[data-curl-target]')){
      const active=other===tab;
      other.classList.toggle('active',active);
      other.setAttribute('aria-selected',String(active));
    }
    paint();
  });
}
input?.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();convert()}
});
`;

export const HEALTH_SCRIPT =
  TOOLBOX_UI +
  String.raw`
import { summarizeHealth, formatEnvironmentReport, HEALTH_STATE_LABELS, MAX_HEALTH_CHECKS } from '/assets/toolbox/health.js';

const form=$('health-form'),errorBox=$('health-error'),panel=$('health-result-panel');
const rowsBox=$('health-rows'),resultRows=$('health-rows-result'),summaryBox=$('health-summary'),runButton=$('health-run');
let outcomes=[];
let sequence=0;

const STATE_CLASS={healthy:'tool-status-ok',degraded:'tool-status-warning',failed:'tool-status-fail'};

function addRow(name,url){
  if(rowsBox.children.length>=MAX_HEALTH_CHECKS)return;
  sequence+=1;
  const id='health-row-'+sequence;
  const row=document.createElement('div');
  row.className='health-row';
  row.innerHTML='<div class="tool-field"><label for="'+id+'-name">Serviço</label><input id="'+id+'-name" class="health-name" value="'+esc(name||'')+'" placeholder="Auth" maxlength="60"></div>'
    +'<div class="tool-field"><label for="'+id+'-url">URL</label><input id="'+id+'-url" class="health-url" type="url" value="'+esc(url||'')+'" placeholder="https://api.exemplo.com/health"></div>'
    +'<div class="tool-field"><label for="'+id+'-method">Método</label><select id="'+id+'-method" class="health-method"><option>GET</option><option>HEAD</option></select></div>'
    +'<button type="button" class="secondary health-remove" aria-label="Remover endpoint">×</button>';
  row.querySelector('.health-remove').addEventListener('click',()=>{
    row.remove();
    if(!rowsBox.children.length)addRow('','');
  });
  rowsBox.appendChild(row);
}

function checks(){
  return [...rowsBox.querySelectorAll('.health-row')].map(row=>({
    name:row.querySelector('.health-name').value.trim(),
    url:row.querySelector('.health-url').value.trim(),
    method:row.querySelector('.health-method').value,
  })).filter(check=>check.url);
}

function render(){
  const summary=summarizeHealth(outcomes);
  summaryBox.innerHTML='<span class="tool-status '+STATE_CLASS[summary.state]+'">Environment Status: '+HEALTH_STATE_LABELS[summary.state]+'</span>'
    +'<span class="tool-summary-text">'+summary.checked+' verificados · '+summary.healthy+' healthy · '+summary.degraded+' degraded · '+summary.failed+' failed</span>';
  resultRows.innerHTML=outcomes.map(outcome=>'<tr><th scope="row">'+esc(outcome.name)+'</th><td>'+(outcome.status===undefined?'—':esc(String(outcome.status))+' '+esc(outcome.statusText||''))+'</td><td>'+(outcome.durationMs===undefined?'—':esc(String(outcome.durationMs))+' ms')+'</td><td>'+esc(outcome.contentType||'—')+'</td><td><span class="tool-status '+STATE_CLASS[outcome.state]+'">'+HEALTH_STATE_LABELS[outcome.state]+'</span>'+(outcome.reason?'<small class="health-reason">'+esc(outcome.reason)+'</small>':'')+'</td></tr>').join('');
  show(panel,true);
}

async function run(event){
  event?.preventDefault();
  clearError(errorBox);
  const list=checks();
  if(!list.length){showError(errorBox,'Informe ao menos uma URL.');return}
  runButton.disabled=true;
  const label=runButton.textContent;
  runButton.innerHTML='<i class="loader"></i>Verificando';
  try{
    const response=await fetch('/api/v1/toolbox/health-checks',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        checks:list,
        expectedStatus:Number($('health-expected').value),
        maxResponseTimeMs:Number($('health-max-time').value),
      }),
    });
    const body=await response.json().catch(()=>({}));
    if(!response.ok){showError(errorBox,body.error||'Não foi possível verificar agora.');show(panel,false);return}
    outcomes=body.outcomes||[];
    render();
  }catch{
    showError(errorBox,'Não foi possível falar com o servidor do QA Radar.');
    show(panel,false);
  }finally{
    runButton.disabled=false;
    runButton.textContent=label;
  }
}

form?.addEventListener('submit',run);
$('health-add')?.addEventListener('click',()=>addRow('',''));
$('health-clear')?.addEventListener('click',()=>{
  rowsBox.innerHTML='';outcomes=[];
  addRow('','');
  clearError(errorBox);show(panel,false);
});
$('health-copy')?.addEventListener('click',event=>{if(outcomes.length)copyText(event.currentTarget,formatEnvironmentReport(outcomes))});
addRow('','');
`;

export const PAIRWISE_SCRIPT =
  TOOLBOX_UI +
  String.raw`
import { generatePairwise, pairwiseToCsv, formatPairwiseCases, MAX_PAIRWISE_PARAMETERS } from '/assets/toolbox/pairwise.js';

const form=$('pairwise-form'),rowsBox=$('pairwise-rows'),errorBox=$('pairwise-error'),panel=$('pairwise-result-panel');
const head=$('pairwise-head'),body=$('pairwise-body'),summary=$('pairwise-summary');
let last=null;
let sequence=100;

function addRow(nome,valores){
  if(rowsBox.children.length>=MAX_PAIRWISE_PARAMETERS)return;
  sequence+=1;
  const id='pairwise-'+sequence;
  const row=document.createElement('div');
  row.className='pairwise-row';
  row.innerHTML='<div class="tool-field"><label for="'+id+'-name">Parâmetro</label><input id="'+id+'-name" class="pairwise-name" maxlength="40" value="'+esc(nome||'')+'" placeholder="navegador"></div>'
    +'<div class="tool-field"><label for="'+id+'-values">Valores</label><input id="'+id+'-values" class="pairwise-values" value="'+esc(valores||'')+'" placeholder="chromium, firefox, webkit"></div>'
    +'<button type="button" class="secondary pairwise-remove" aria-label="Remover parâmetro">×</button>';
  rowsBox.appendChild(row);
}

function parametros(){
  return [...rowsBox.querySelectorAll('.pairwise-row')].map(row=>({
    name:row.querySelector('.pairwise-name').value,
    values:row.querySelector('.pairwise-values').value.split(',').map(v=>v.trim()).filter(Boolean),
  }));
}

function render(result){
  const colunas=result.rows.length?Object.keys(result.rows[0]):[];
  head.innerHTML='<tr><th scope="col">Caso</th>'+colunas.map(c=>'<th scope="col">'+esc(c)+'</th>').join('')+'</tr>';
  body.innerHTML=result.rows.map((row,i)=>'<tr><th scope="row">TC'+String(i+1).padStart(3,'0')+'</th>'+colunas.map(c=>'<td>'+esc(row[c])+'</td>').join('')+'</tr>').join('');
  summary.innerHTML='<span class="tool-status tool-status-ok">'+result.rows.length+' CASO(S)</span>'
    +'<span class="tool-summary-text">'+result.exhaustive+' combinações completas · '+result.pairs+' pares cobertos · '+result.reduction+'% de redução</span>';
  show(panel,true);
}

function run(event){
  event?.preventDefault();
  clearError(errorBox);
  try{
    last=generatePairwise(parametros());
    render(last);
  }catch(error){
    last=null;
    show(panel,false);
    showError(errorBox,error instanceof Error?error.message:'Não foi possível gerar as combinações.');
  }
}

rowsBox?.addEventListener('click',event=>{
  const botao=event.target.closest('.pairwise-remove');
  if(!botao)return;
  botao.closest('.pairwise-row').remove();
  if(!rowsBox.children.length)addRow('','');
});
form?.addEventListener('submit',run);
$('pairwise-add')?.addEventListener('click',()=>addRow('',''));
$('pairwise-clear')?.addEventListener('click',()=>{
  rowsBox.innerHTML='';for(let i=0;i<2;i++)addRow('','');
  last=null;head.innerHTML='';body.innerHTML='';summary.innerHTML='';
  clearError(errorBox);show(panel,false);
});
$('pairwise-copy')?.addEventListener('click',event=>{if(last)copyText(event.currentTarget,formatPairwiseCases(last.rows))});
$('pairwise-download')?.addEventListener('click',()=>{if(last)downloadFile('pairwise-'+stamp()+'.csv',pairwiseToCsv(last.rows),'text/csv')});
`;

export const REGEX_SCRIPT =
  TOOLBOX_UI +
  String.raw`
import { testRegex, formatRegexResult } from '/assets/toolbox/regex-tester.js';

const pattern=$('regex-pattern'),flags=$('regex-flags'),subject=$('regex-subject'),errorBox=$('regex-error');
const panel=$('regex-result-panel'),summary=$('regex-summary'),warnings=$('regex-warnings'),linesBox=$('regex-lines'),matchesBox=$('regex-matches');
let last=null;

function grupos(match){
  const uteis=match.groups.filter(g=>g.value!==undefined);
  return uteis.length?uteis.map(g=>'<code>'+esc(g.name)+'</code>: '+esc(g.value)).join('<br>'):'—';
}

function run(){
  clearError(errorBox);
  try{
    last=testRegex(pattern.value,flags.value,subject.value);
    const linhasComCasamento=new Set(last.matches.map(m=>m.line)).size;
    summary.innerHTML=last.matches.length===0
      ?'<span class="tool-status tool-status-warning">SEM CASAMENTO</span><span class="tool-summary-text">A expressão é válida, mas não casou com nada do texto.</span>'
      :'<span class="tool-status tool-status-ok">'+last.matches.length+' CASAMENTO(S)</span><span class="tool-summary-text">em '+linhasComCasamento+' de '+last.lines.length+' linha(s)</span>';
    warnings.innerHTML=last.warnings.map(a=>'<li>'+esc(a)+'</li>').join('');
    warnings.hidden=last.warnings.length===0;
    linesBox.innerHTML=last.lines.map(l=>'<div class="regex-line-row '+(l.matched?'matched':'')+'"><span class="regex-line-number">'+l.number+'</span><code>'+(l.text===''?'<i>(vazia)</i>':esc(l.text))+'</code></div>').join('');
    matchesBox.innerHTML=last.matches.map((m,i)=>'<tr><th scope="row">'+(i+1)+'</th><td>'+m.line+'</td><td>'+m.index+'</td><td><code>'+(m.value===''?'<i>(vazio)</i>':esc(m.value))+'</code></td><td>'+grupos(m)+'</td></tr>').join('');
    show(panel,true);
  }catch(error){
    last=null;
    show(panel,false);
    showError(errorBox,error instanceof Error?error.message:'Não foi possível testar a expressão.');
  }
}

$('regex-run')?.addEventListener('click',run);
$('regex-clear')?.addEventListener('click',()=>{
  pattern.value='';subject.value='';last=null;
  summary.innerHTML='';linesBox.innerHTML='';matchesBox.innerHTML='';
  warnings.innerHTML='';warnings.hidden=true;
  clearError(errorBox);show(panel,false);
  pattern.focus();
});
$('regex-copy')?.addEventListener('click',event=>{if(last)copyText(event.currentTarget,formatRegexResult(last))});
for(const campo of [pattern,flags,subject]){
  campo?.addEventListener('keydown',event=>{
    if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();run()}
  });
}
`;

export const TIMESTAMP_SCRIPT =
  TOOLBOX_UI +
  String.raw`
import { parseTimestampInput, describeTimestamp, TIMESTAMP_SOURCE_LABELS } from '/assets/toolbox/timestamp.js';

const input=$('timestamp-input'),errorBox=$('timestamp-error'),panel=$('timestamp-result-panel');
const summary=$('timestamp-summary'),warnings=$('timestamp-warnings'),facts=$('timestamp-facts');
let last=null;

function fact(termo,valor){return '<div><dt>'+esc(termo)+'</dt><dd>'+esc(valor)+'</dd></div>'}

function run(){
  clearError(errorBox);
  try{
    const leitura=parseTimestampInput(input.value);
    const d=describeTimestamp(leitura.epochMs);
    last=[
      ['Interpretado como',TIMESTAMP_SOURCE_LABELS[leitura.source]],
      ['Epoch (segundos)',String(d.epochSeconds)],
      ['Epoch (milissegundos)',String(d.epochMilliseconds)],
      ['ISO 8601 (UTC)',d.iso],
      ['UTC por extenso',d.utc],
      ['Fuso local ('+d.timeZone+')',d.local],
      ['Dia da semana',d.weekday],
      ['Relativo a agora',d.relative],
    ];
    summary.innerHTML='<span class="tool-status tool-status-ok">'+TIMESTAMP_SOURCE_LABELS[leitura.source].toUpperCase()+'</span><span class="tool-summary-text">'+esc(d.relative)+'</span>';
    warnings.innerHTML=leitura.warnings.map(a=>'<li>'+esc(a)+'</li>').join('');
    warnings.hidden=leitura.warnings.length===0;
    facts.innerHTML=last.map(par=>fact(par[0],par[1])).join('');
    show(panel,true);
  }catch(error){
    last=null;
    show(panel,false);
    showError(errorBox,error instanceof Error?error.message:'Não foi possível converter.');
  }
}

$('timestamp-run')?.addEventListener('click',run);
$('timestamp-now')?.addEventListener('click',()=>{input.value='';run()});
$('timestamp-clear')?.addEventListener('click',()=>{
  input.value='';last=null;facts.innerHTML='';summary.innerHTML='';
  warnings.innerHTML='';warnings.hidden=true;
  clearError(errorBox);show(panel,false);
  input.focus();
});
$('timestamp-copy')?.addEventListener('click',event=>{if(last)copyText(event.currentTarget,last.map(par=>par[0]+': '+par[1]).join('\n'))});
input?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();run()}});
`;

export const HTTP_STATUS_SCRIPT =
  TOOLBOX_UI +
  String.raw`
import { searchHttpStatuses, HTTP_STATUSES } from '/assets/toolbox/http-status.js';

const busca=$('status-search'),lista=$('status-list'),vazio=$('status-empty'),contador=$('status-count');
let classe='todas';

function render(){
  const encontrados=searchHttpStatuses(busca.value).filter(s=>classe==='todas'||s.group===classe);
  lista.innerHTML=encontrados.map(s=>'<article class="status-item status-'+s.group+'">'
    +'<header><b>'+s.code+'</b><strong>'+esc(s.name)+'</strong><span>'+esc(s.group)+'</span></header>'
    +'<p>'+esc(s.summary)+'</p>'
    +'<p class="status-testing"><b>O que checar:</b> '+esc(s.testing)+'</p>'
    +'</article>').join('');
  show(vazio,encontrados.length===0);
  contador.textContent=encontrados.length+' de '+HTTP_STATUSES.length+' códigos.';
}

busca?.addEventListener('input',render);
for(const aba of document.querySelectorAll('[data-status-class]')){
  aba.addEventListener('click',()=>{
    classe=aba.dataset.statusClass;
    for(const outra of document.querySelectorAll('[data-status-class]')){
      const ativa=outra===aba;
      outra.classList.toggle('active',ativa);
      outra.setAttribute('aria-selected',String(ativa));
    }
    render();
  });
}
document.addEventListener('keydown',event=>{
  if(event.key!=='/'||event.ctrlKey||event.metaKey||event.altKey)return;
  const ativo=document.activeElement;
  if(ativo&&/^(INPUT|TEXTAREA|SELECT)$/.test(ativo.tagName))return;
  event.preventDefault();
  busca?.focus();
});
render();
`;

/** Script de cada ferramenta, pelo id do catálogo. */
export const TOOLBOX_SCRIPTS: Record<string, string> = {
  "json-diff": JSON_DIFF_SCRIPT,
  "boundary-values": BOUNDARY_SCRIPT,
  "test-data": TEST_DATA_SCRIPT,
  "jwt-inspector": JWT_SCRIPT,
  "curl-converter": CURL_SCRIPT,
  "api-health": HEALTH_SCRIPT,
  pairwise: PAIRWISE_SCRIPT,
  "regex-tester": REGEX_SCRIPT,
  timestamp: TIMESTAMP_SCRIPT,
  "http-status": HTTP_STATUS_SCRIPT,
};
