export const WEB_CLIENT_SCRIPT = String.raw`const form=document.querySelector('#scan-form'),button=document.querySelector('#submit'),cancelButton=document.querySelector('#cancel'),errorBox=document.querySelector('#error'),results=document.querySelector('#results');
let currentJobId;
const turnstileBlock=document.querySelector('#turnstile-block');
globalThis.onTurnstileSuccess=()=>{if(turnstileBlock)turnstileBlock.hidden=true};
globalThis.onTurnstileExpired=()=>{if(turnstileBlock)turnstileBlock.hidden=false};
globalThis.onTurnstileError=()=>{if(turnstileBlock)turnstileBlock.hidden=false};
const scanTab=document.querySelector('#scan-tab'),helpTab=document.querySelector('#help-tab'),scanPanel=document.querySelector('#scan-panel'),helpPanel=document.querySelector('#help-panel');
function selectTab(name){if(!scanTab||!helpTab||!scanPanel||!helpPanel)return;const help=name==='help';scanTab.classList.toggle('active',!help);helpTab.classList.toggle('active',help);scanTab.setAttribute('aria-selected',String(!help));helpTab.setAttribute('aria-selected',String(help));scanPanel.hidden=help;helpPanel.hidden=!help}
if(scanTab&&helpTab){scanTab.addEventListener('click',()=>selectTab('scan'));helpTab.addEventListener('click',()=>selectTab('help'))}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function showError(message){if(errorBox){errorBox.textContent=message;errorBox.style.display='block'}}
const historyButton=document.querySelector('#history-button'),historyPanel=document.querySelector('#history-panel');
async function loadHistory(){
  if(!historyButton)return;
  const project=document.querySelector('#project').value.trim(),environment=document.querySelector('#environment').value.trim();
  if(!project){showError('Informe um projeto para consultar o histórico.');return}
  historyButton.disabled=true;historyButton.textContent='Carregando histórico…';
  try{
    const response=await fetch('/api/history?project='+encodeURIComponent(project)+'&environment='+encodeURIComponent(environment)),history=await response.json();
    if(!response.ok)throw new Error(history.error||'Não foi possível consultar o histórico.');
    historyPanel.hidden=false;document.querySelector('#history-count').textContent=history.runs.length+' execução(ões)';
    document.querySelector('#history-baseline').textContent=history.baselineStartedAt?'Baseline: '+new Date(history.baselineStartedAt).toLocaleString('pt-BR'):'Nenhum baseline aprovado';
    document.querySelector('#history-list').innerHTML=history.runs.length?history.runs.map(run=>'<div class="history-entry"><i class="history-dot '+(run.passed?'pass':'')+'"></i><div><strong>'+esc(new Date(run.startedAt).toLocaleString('pt-BR'))+' · '+esc(run.browser)+'</strong><small>'+(run.scanStatus==='partial'?'Execução parcial':'Execução completa')+' · '+run.pages+' página(s) · '+(run.durationMs/1000).toFixed(1)+'s</small></div><div class="history-stats">'+run.summary.errors+' erro(s)<br>'+run.summary.warnings+' aviso(s)'+(run.newIssues===undefined?'':'<br>'+run.newIssues+' novo(s)')+'</div></div>').join(''):'<div class="history-entry"><div></div><div><strong>Nenhuma execução encontrada</strong><small>Execute uma análise para iniciar o histórico.</small></div></div>';
  }catch(error){showError(error.message)}finally{historyButton.disabled=false;historyButton.textContent='Consultar histórico'}
}
if(historyButton)historyButton.addEventListener('click',loadHistory);
function running(){
  errorBox.style.display='none';results.classList.add('visible');results.scrollIntoView({behavior:'smooth',block:'start'});
  document.querySelector('#status').className='status running';document.querySelector('#status').innerHTML='<i class="loader"></i>Executando';
  document.querySelector('#result-title').textContent='Analisando aplicação';document.querySelector('#comparison').textContent='';
  for(const id of ['errors','warnings','http','duration','ttfb','lcp','cls'])document.querySelector('#'+id).textContent='—';
  document.querySelector('#pages').textContent=document.querySelector('#sitemap').checked?'…':'1';
  document.querySelector('#issues').innerHTML='<div class="issue"><div class="message">O navegador está carregando e observando a página…</div></div>';
  document.querySelector('#actions').innerHTML='';document.querySelector('#report-frame').hidden=true;
  document.querySelector('#progress').hidden=false;document.querySelector('#progress-text').textContent='Preparando análise…';document.querySelector('#progress-bar').style.width='0%';cancelButton.hidden=true;cancelButton.disabled=false;
}
function renderProgress(progress,status,queuePosition){
  if(!progress)return;const total=progress.discoveredPages,done=progress.completedPages,queued=status==='queued';
  const stages={queued:'Aguardando na fila', 'discovering-sitemap':'Descobrindo páginas do sitemap', 'launching-browser':'Iniciando navegador', navigating:'Carregando página', inspecting:'Inspecionando página', 'capturing-evidence':'Gerando evidência visual', consolidating:'Consolidando resultados', 'writing-reports':'Gerando relatórios', completed:'Análise concluída', cancelled:'Análise cancelada'};
  document.querySelector('#progress-bar').style.width=Math.max(0,Math.min(100,progress.percent))+'%';
  const stage=stages[progress.stage]||'Executando análise';
  document.querySelector('#progress-text').textContent=queued?stage+(queuePosition?' · posição '+queuePosition:'')+'…':stage+(total?' · '+done+' de '+total+' página(s)'+(progress.currentUrl?' · '+progress.currentUrl:''):'…');
  if(total)document.querySelector('#pages').textContent=done+'/'+total;
}
let artifactUrls=[];
async function artifact(base,name,createUrl=true){const response=await fetch(base+name);if(!response.ok)throw new Error('Não foi possível carregar '+name+'.');const blob=await response.blob(),url=createUrl?URL.createObjectURL(blob):undefined;if(url)artifactUrls.push(url);return {url,text:name==='report.html'?await blob.text():undefined}}
async function render(job){
  cancelButton.hidden=true;document.querySelector('#progress-bar').style.width='100%';document.querySelector('#progress-text').textContent='Análise concluída.';
  const r=job.report,status=document.querySelector('#status');status.className='status '+(r.passed?'pass':'fail');status.textContent=(r.passed?'APROVADO':'REPROVADO')+(r.scanStatus==='partial'?' · PARCIAL':'');
  document.querySelector('#result-title').textContent=r.title||new URL(r.targetUrl).hostname;
  document.querySelector('#errors').textContent=r.summary.errors;document.querySelector('#warnings').textContent=r.summary.warnings;document.querySelector('#http').textContent=r.mainStatus??'N/A';document.querySelector('#duration').textContent=(r.durationMs/1000).toFixed(1)+'s';document.querySelector('#pages').textContent=r.pages?.length??1;
  const pageMetrics=(r.pages??[]).map(p=>p.performance).filter(Boolean),average=(name)=>pageMetrics.length?Math.round(pageMetrics.reduce((sum,p)=>sum+(p[name]??0),0)/pageMetrics.length):undefined;
  const perf=r.performance??(pageMetrics.length?{ttfbMs:average('ttfbMs'),lcpMs:average('lcpMs'),cls:Math.max(...pageMetrics.map(p=>p.cls??0))}:undefined);
  document.querySelector('#ttfb').textContent=perf?.ttfbMs===undefined?'N/A':perf.ttfbMs+' ms';document.querySelector('#lcp').textContent=perf?.lcpMs===undefined?'N/A':perf.lcpMs+' ms';document.querySelector('#cls').textContent=perf?.cls??'N/A';
  document.querySelector('#comparison').textContent=r.comparison?r.comparison.newIssues+' novo(s) · '+r.comparison.existingIssues+' existente(s) · '+r.comparison.resolvedIssues.length+' resolvido(s)':'';
  const categories={console:'Navegador',javascript:'JavaScript',http:'Carregamento',network:'Rede',navigation:'Navegação',performance:'Performance','best-practices':'Boas práticas',seo:'SEO',element:'Elemento da página',accessibility:'Acessibilidade'},list=document.querySelector('#issues');
  list.innerHTML=r.issues.length?r.issues.map(i=>'<div class="issue"><span class="badge '+esc(i.severity)+'">'+(i.severity==='error'?'Erro':'Aviso')+'</span><span class="category">'+esc(categories[i.category]||i.category)+'</span><div class="message"><strong>'+esc(i.title||i.message)+'</strong>'+(i.baselineStatus?' <small>· '+(i.baselineStatus==='new'?'NOVO':'EXISTENTE')+'</small>':'')+(i.occurrences>1?' ('+i.occurrences+'x)':'')+(i.impact?'<p><b>Impacto:</b> '+esc(i.impact)+'</p>':'')+(i.recommendation?'<p><b>Como verificar:</b> '+esc(i.recommendation)+'</p>':'')+(i.url?'<code>'+esc(i.url)+'</code>':'')+(i.evidence?'<span class="evidence-ref">'+esc(i.evidence.label)+' · '+esc(i.evidence.selector)+'</span>':'')+'<details><summary>Detalhe técnico</summary><code>'+esc(i.message)+'</code></details></div></div>').join(''):'<div class="issue"><div class="message">Nenhum problema encontrado. Tudo limpo por aqui.</div></div>';
  artifactUrls.forEach(URL.revokeObjectURL);artifactUrls=[];
  const base='/api/scans/'+job.id+'/',html=await artifact(base,'report.html',false),json=await artifact(base,'report.json'),junit=await artifact(base,'report.junit.xml'),sarif=await artifact(base,'report.sarif.json'),shot=job.screenshotAvailable?await artifact(base,'screenshot.png'):undefined;
  let reportHtml=html.text??'';if(shot)reportHtml=reportHtml.replace('src="screenshot.png"','src="'+shot.url+'"');reportHtml=reportHtml.replaceAll('href="pages/','href="'+base+'pages/');
  const reportUrl=URL.createObjectURL(new Blob([reportHtml],{type:'text/html'}));artifactUrls.push(reportUrl);
  document.querySelector('#actions').innerHTML='<a href="'+reportUrl+'" target="_blank">Abrir relatório HTML ↗</a><a href="'+json.url+'" download="qa-radar-report.json">Baixar JSON</a><a href="'+junit.url+'" download="qa-radar-report.junit.xml">JUnit</a><a href="'+sarif.url+'" download="qa-radar-report.sarif.json">SARIF</a>'+(shot?'<a href="'+shot.url+'" target="_blank">Ver evidência anotada</a>':'');
  const frame=document.querySelector('#report-frame');frame.srcdoc=reportHtml;frame.hidden=false;
  if(historyButton&&r.project)await loadHistory();
}
async function poll(id){for(;;){const response=await fetch('/api/scans/'+id),job=await response.json();if(!response.ok)throw new Error(job.error||'Não foi possível consultar a análise.');renderProgress(job.progress,job.status,job.queuePosition);if(job.status==='completed'){await render(job);return}if(job.status==='cancelled')throw new Error('A análise foi cancelada.');if(job.status==='failed')throw new Error(job.error||'A análise falhou.');await sleep(800)}}
if(cancelButton)cancelButton.addEventListener('click',async()=>{if(!currentJobId)return;cancelButton.disabled=true;cancelButton.textContent='Cancelando…';try{const response=await fetch('/api/scans/'+currentJobId+'/cancel',{method:'POST'}),job=await response.json();if(!response.ok)throw new Error(job.error||'Não foi possível cancelar a análise.')}catch(error){showError(error.message);cancelButton.disabled=false;cancelButton.textContent='Cancelar'}});
if(form)form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;button.innerHTML='<i class="loader"></i>Iniciando';running();const formData=new FormData(form),data=Object.fromEntries(formData);data.timeoutMs=Number(data.timeoutMs);data.settleMs=Number(data.settleMs);data.maxPages=Number(data.maxPages);data.sitemap=formData.has('sitemap');data.accessibility=formData.has('accessibility');data.regressionsOnly=formData.has('regressionsOnly');data.acceptBaseline=formData.has('acceptBaseline');try{const response=await fetch('/api/scans',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}),job=await response.json();if(!response.ok)throw new Error(job.error||'Não foi possível iniciar a análise.');currentJobId=job.id;cancelButton.hidden=false;button.innerHTML='<i class="loader"></i>Analisando';await poll(job.id)}catch(error){showError(error.message);document.querySelector('#status').className='status fail';document.querySelector('#status').textContent=error.message.includes('cancelada')?'CANCELADA':'FALHA NA EXECUÇÃO'}finally{currentJobId=undefined;cancelButton.hidden=true;cancelButton.textContent='Cancelar';if(globalThis.turnstile)globalThis.turnstile.reset();if(turnstileBlock)turnstileBlock.hidden=false;button.disabled=false;button.textContent='Executar novo scanner'}});
const journeyEvidenceModal=document.querySelector('#journey-evidence-modal');
const journeyEvidenceForm=document.querySelector('#journey-evidence-form');
for(const id of ['journey-evidence-close','journey-evidence-cancel'])document.querySelector('#'+id)?.addEventListener('click',()=>journeyEvidenceModal?.close());
const codeStart=document.querySelector('#codegen-start'),codeStop=document.querySelector('#codegen-stop'),codeUrl=document.querySelector('#codegen-url'),codeEditor=document.querySelector('#playwright-code'),codeError=document.querySelector('#codegen-error'),codeResult=document.querySelector('#code-result');let codegenId,completedCodeExecutionId;
const codeEvidenceButton=document.createElement('button');codeEvidenceButton.id='code-evidence-button';codeEvidenceButton.className='secondary';codeEvidenceButton.type='button';codeEvidenceButton.textContent='Gerar relatório HTML';codeEvidenceButton.hidden=true;codeResult?.parentElement?.insertBefore(codeEvidenceButton,codeResult.nextSibling);
if(codeResult){new MutationObserver(()=>{if(!codeResult.hidden){codeEvidenceButton.hidden=false;const match=/Execução ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(codeResult.textContent||'');if(match)codeResult.dataset.executionId=match[1]}}).observe(codeResult,{attributes:true,childList:true,subtree:true,attributeFilter:['hidden']})}
const evidenceStepsBox=document.querySelector('#journey-evidence-steps');
function bindEvidenceStepEditing(){
  evidenceStepsBox?.querySelectorAll('.evidence-step').forEach(row=>{
    const view=row.querySelector('.evidence-step-view p'),input=row.querySelector('input'),button=row.querySelector('.evidence-step-edit');
    button?.addEventListener('click',()=>{
      const editing=row.classList.toggle('editing');
      row.querySelector('.evidence-step-view').hidden=editing;
      input.hidden=!editing;
      button.textContent=editing?'Concluir':'Editar';
      if(editing)input.focus();else view.textContent=input.value.trim()||input.dataset.original||'';
    });
  });
}
codeEvidenceButton.addEventListener('click',async()=>{
  completedCodeExecutionId=codeResult?.dataset.executionId;
  if(!completedCodeExecutionId)return;
  if(evidenceStepsBox){
    evidenceStepsBox.innerHTML='<p class="hint">Carregando passos…</p>';
    try{
      const response=await fetch('/api/code-executions/'+completedCodeExecutionId+'/steps'),data=await response.json();
      const steps=response.ok&&Array.isArray(data.steps)?data.steps:[];
      evidenceStepsBox.innerHTML=steps.length?steps.map((step,index)=>'<div class="evidence-step"><div class="evidence-step-view"><small>Passo '+(index+1)+' · '+esc(step.action)+'</small><p>'+esc(step.description||step.action)+'</p></div><input type="text" maxlength="200" value="'+esc(step.description||'')+'" data-original="'+esc(step.description||'')+'" hidden><button type="button" class="secondary evidence-step-edit">Editar</button></div>').join(''):'<p class="hint">Nenhum passo detectado automaticamente.</p>';
      bindEvidenceStepEditing();
    }catch{evidenceStepsBox.innerHTML='<p class="hint">Não foi possível carregar os passos automaticamente.</p>'}
  }
  journeyEvidenceModal?.showModal();
});
if(journeyEvidenceForm)journeyEvidenceForm.addEventListener('submit',async event=>{if(!completedCodeExecutionId)return;event.preventDefault();const submit=journeyEvidenceForm.querySelector('button[type=submit]'),error=document.querySelector('#journey-evidence-error');error.style.display='none';submit.disabled=true;submit.innerHTML='<i class="loader"></i>Gerando HTML';const stepDescriptions=[...evidenceStepsBox?.querySelectorAll('.evidence-step input')??[]].map(input=>input.value);try{const response=await fetch('/api/code-executions/'+completedCodeExecutionId+'/evidence-report',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({testerName:document.querySelector('#journey-tester-name').value,testType:document.querySelector('#journey-test-type').value,...(stepDescriptions.length?{stepDescriptions}:{})})}),data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível gerar o relatório.');journeyEvidenceModal.close();window.location.href=data.url}catch(reason){error.textContent=reason.message;error.style.display='block'}finally{submit.disabled=false;submit.textContent='Gerar HTML'}});
if(codeStart)codeStart.addEventListener('click',async()=>{codeError.style.display='none';try{const response=await fetch('/api/codegen',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:codeUrl.value})}),data=await response.json();if(!response.ok)throw new Error(data.error||'Não foi possível iniciar o Codegen.');codegenId=data.id;codeStart.disabled=true;codeStop.disabled=false;codeStart.textContent='Gravando no navegador…';}catch(reason){codeError.textContent=reason.message;codeError.style.display='block'}});
if(codeStop)codeStop.addEventListener('click',async()=>{if(!codegenId)return;codeStop.disabled=true;try{const response=await fetch('/api/codegen/'+codegenId),data=await response.json();if(data.status!=='completed'){codeError.textContent='Feche a janela do navegador para concluir a gravação e tente novamente.';codeError.style.display='block';return}codeEditor.value=data.code;codeStart.disabled=false;codeStart.textContent='Iniciar nova gravação';codegenId=undefined;}catch(reason){codeError.textContent=reason.message;codeError.style.display='block'}finally{codeStop.disabled=false}});
document.querySelector('#code-save')?.addEventListener('click',()=>{const blob=new Blob([codeEditor.value],{type:'text/typescript'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='qa-radar.spec.ts';link.click();URL.revokeObjectURL(link.href)});
const codeExecute=document.querySelector('#code-execute');codeExecute?.addEventListener('click',async()=>{codeExecute.disabled=true;codeExecute.innerHTML='<i class="loader"></i>Executando';codeError.style.display='none';codeResult.hidden=true;try{const response=await fetch('/api/code-execution',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:codeEditor.value})}),data=await response.json();if(!response.ok&&data.status!=='failed')throw new Error(data.error||'Não foi possível executar a jornada.');const report=data.report||{},passed=data.status==='passed',stats=report.stats||{},errors=report.errors||[],details=data.failureDetails||errors.map(error=>error.message).join('\n\n'),duration=Number(stats.duration||0);codeResult.className='code-result '+(passed?'pass':'fail');codeResult.innerHTML='<div class="code-result-head"><div><span>'+(passed?'✓ Jornada aprovada':'✕ Jornada reprovada')+'</span><small>Execução '+esc(data.id)+'</small></div><strong>'+((duration/1000).toFixed(1))+'s</strong></div><div class="code-result-metrics"><span><b>'+(stats.expected||0)+'</b> aprovados</span><span><b>'+(stats.unexpected||0)+'</b> falhas</span><span><b>'+(stats.skipped||0)+'</b> ignorados</span></div>'+(details?'<pre>'+esc(details)+'</pre>':'');codeResult.hidden=false;}catch(reason){codeError.textContent=reason.message;codeError.style.display='block'}finally{codeExecute.disabled=false;codeExecute.textContent='Executar'}});
document.querySelector('#code-import')?.addEventListener('change',async event=>{const file=event.target.files?.[0];if(file)codeEditor.value=await file.text()});

// Cliente HTTP interativo de /api-tests (estilo Postman) — independente do
// Modo Jornada acima; não compartilha nenhum elemento com ele.
const httpSend=document.querySelector('#http-send');
if(httpSend){
  const httpMethod=document.querySelector('#http-method'),httpUrl=document.querySelector('#http-url'),httpErrorBox=document.querySelector('#http-error'),httpBody=document.querySelector('#http-body'),httpHeaders=document.querySelector('#http-headers'),httpVariables=document.querySelector('#http-variables'),httpResponse=document.querySelector('#http-response'),httpResponseStatus=document.querySelector('#http-response-status'),httpResponseDuration=document.querySelector('#http-response-duration'),httpResponseHeaders=document.querySelector('#http-response-headers'),httpResponseBody=document.querySelector('#http-response-body'),httpCollectionList=document.querySelector('#http-collection-list'),httpCollectionName=document.querySelector('#http-collection-name');
  const COLLECTION_KEY='qa-radar-api-collection';
  function showHttpError(message){httpErrorBox.textContent=message;httpErrorBox.style.display='block'}
  function kvRow(container,keyPlaceholder,valuePlaceholder){
    const row=document.createElement('div');
    row.className='http-kv-row';
    row.innerHTML='<input type="text" class="http-kv-key" placeholder="'+esc(keyPlaceholder)+'"><input type="text" class="http-kv-value" placeholder="'+esc(valuePlaceholder)+'"><button type="button" class="secondary http-kv-remove" aria-label="Remover">×</button>';
    row.querySelector('.http-kv-remove').addEventListener('click',()=>row.remove());
    container.appendChild(row);
    return row;
  }
  document.querySelector('#http-add-header')?.addEventListener('click',()=>kvRow(httpHeaders,'Nome','Valor'));
  document.querySelector('#http-add-variable')?.addEventListener('click',()=>kvRow(httpVariables,'nome','valor'));
  for(const container of [httpHeaders,httpVariables])container.querySelectorAll('.http-kv-remove').forEach(button=>button.addEventListener('click',()=>button.closest('.http-kv-row').remove()));

  function kvPairs(container){
    return [...container.querySelectorAll('.http-kv-row')].map(row=>({key:row.querySelector('.http-kv-key').value.trim(),value:row.querySelector('.http-kv-value').value})).filter(pair=>pair.key);
  }
  function applyVariables(text,variables){
    return variables.reduce((value,variable)=>value.split('{{'+variable.key+'}}').join(variable.value),text);
  }
  function loadCollection(){
    try{const raw=localStorage.getItem(COLLECTION_KEY),parsed=raw?JSON.parse(raw):{};return {requests:Array.isArray(parsed.requests)?parsed.requests:[]}}catch{return {requests:[]}}
  }
  function saveCollection(collection){try{localStorage.setItem(COLLECTION_KEY,JSON.stringify(collection))}catch{}}
  function fillHeaders(container,pairs){
    container.innerHTML='';
    (pairs?.length?pairs:[{key:'',value:''}]).forEach(pair=>{const row=kvRow(container,'Nome','Valor');row.querySelector('.http-kv-key').value=pair.key||'';row.querySelector('.http-kv-value').value=pair.value||''});
  }
  function renderCollection(){
    const collection=loadCollection();
    if(!collection.requests.length){httpCollectionList.innerHTML='<p class="hint">Nenhuma requisição salva ainda.</p>';return}
    httpCollectionList.innerHTML=collection.requests.map((item,index)=>'<div class="http-collection-item"><button type="button" class="http-collection-load" data-index="'+index+'"><strong>'+esc(item.name)+'</strong><span>'+esc(item.method)+' '+esc(item.url)+'</span></button><button type="button" class="secondary http-collection-delete" data-index="'+index+'">Remover</button></div>').join('');
    httpCollectionList.querySelectorAll('.http-collection-load').forEach(button=>button.addEventListener('click',()=>{
      const item=loadCollection().requests[Number(button.dataset.index)];
      if(!item)return;
      httpMethod.value=item.method;httpUrl.value=item.url;httpBody.value=item.body||'';
      fillHeaders(httpHeaders,item.headers);
    }));
    httpCollectionList.querySelectorAll('.http-collection-delete').forEach(button=>button.addEventListener('click',()=>{
      const collection=loadCollection();collection.requests.splice(Number(button.dataset.index),1);saveCollection(collection);renderCollection();
    }));
  }
  renderCollection();

  document.querySelector('#http-save-request')?.addEventListener('click',()=>{
    const name=httpCollectionName.value.trim();
    if(!name){showHttpError('Informe um nome para salvar a requisição.');return}
    httpErrorBox.style.display='none';
    const collection=loadCollection();
    collection.requests.push({name,method:httpMethod.value,url:httpUrl.value,headers:kvPairs(httpHeaders),body:httpBody.value});
    saveCollection(collection);httpCollectionName.value='';renderCollection();
  });
  document.querySelector('#http-collection-export')?.addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify(loadCollection(),null,2)],{type:'application/json'}),link=document.createElement('a');
    link.href=URL.createObjectURL(blob);link.download='qa-radar-api-collection.json';link.click();URL.revokeObjectURL(link.href);
  });
  document.querySelector('#http-collection-import')?.addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try{const imported=JSON.parse(await file.text());if(!Array.isArray(imported.requests))throw new Error();saveCollection({requests:imported.requests});renderCollection();httpErrorBox.style.display='none'}
    catch{showHttpError('Arquivo de collection inválido.')}
  });

  httpSend.addEventListener('click',async()=>{
    httpErrorBox.style.display='none';
    const variables=kvPairs(httpVariables),method=httpMethod.value,url=applyVariables(httpUrl.value.trim(),variables);
    if(!url){showHttpError('Informe a URL da requisição.');return}
    const headers={};
    kvPairs(httpHeaders).forEach(pair=>{headers[pair.key]=applyVariables(pair.value,variables)});
    const body=method==='GET'||method==='HEAD'?undefined:applyVariables(httpBody.value,variables);
    httpSend.disabled=true;httpSend.innerHTML='<i class="loader"></i>Enviando';
    try{
      const response=await fetch('/api/http-request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method,url,headers,...(body?{body}:{})})}),data=await response.json();
      if(!response.ok)throw new Error(data.error||'Não foi possível enviar a requisição.');
      httpResponse.hidden=false;
      const statusClass=data.status>=200&&data.status<300?'ok':data.status>=300&&data.status<400?'redirect':'error';
      httpResponseStatus.className='http-status '+statusClass;httpResponseStatus.textContent=data.status+' '+data.statusText;
      httpResponseDuration.textContent=data.durationMs+' ms';
      httpResponseHeaders.textContent=Object.entries(data.headers||{}).map(([key,value])=>key+': '+value).join('\n')||'(sem headers)';
      let prettyBody=data.body;
      try{prettyBody=JSON.stringify(JSON.parse(data.body),null,2)}catch{}
      httpResponseBody.textContent=prettyBody+(data.bodyTruncated?'\n\n[corpo truncado]':'');
    }catch(error){showHttpError(error.message);httpResponse.hidden=true}
    finally{httpSend.disabled=false;httpSend.textContent='Enviar'}
  });
}
`;
