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
// Numa instalação que exige conta, o 401 de uma execução não é erro para ler na
// tela: é o momento de pedir para entrar. Leva a pessoa ao cadastro guardando de
// onde ela veio, para voltar ao mesmo lugar depois.
function signInAndReturn(){location.href='/entrar?proximo='+encodeURIComponent(location.pathname+location.search)}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ACTIVITY_KEY='qa-radar-activity',ACTIVITY_LIMIT=40;
function recordActivity(activity){
  try{
    const current=JSON.parse(localStorage.getItem(ACTIVITY_KEY)||'[]'),items=Array.isArray(current)?current:[];
    items.unshift({...activity,createdAt:activity.createdAt||Date.now()});
    localStorage.setItem(ACTIVITY_KEY,JSON.stringify(items.slice(0,ACTIVITY_LIMIT)));
  }catch{}
  fetch('/api/dashboard/activity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(activity)}).catch(()=>{});
}
function activityTarget(value){
  try{const url=new URL(value);return url.host+url.pathname}catch{return String(value||'Execução')}
}
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
  document.querySelector('#issues').innerHTML='<div class="issue issue-note"><div class="message">O navegador está carregando e observando a página…</div></div>';
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
  list.innerHTML=r.issues.length?r.issues.map(i=>'<div class="issue"><span class="badge '+esc(i.severity)+'">'+(i.severity==='error'?'Erro':'Aviso')+'</span><span class="category">'+esc(categories[i.category]||i.category)+'</span><div class="message"><strong>'+esc(i.title||i.message)+'</strong>'+(i.baselineStatus?' <small>· '+(i.baselineStatus==='new'?'NOVO':'EXISTENTE')+'</small>':'')+(i.occurrences>1?' ('+i.occurrences+'x)':'')+(i.impact?'<p><b>Impacto:</b> '+esc(i.impact)+'</p>':'')+(i.recommendation?'<p><b>Como verificar:</b> '+esc(i.recommendation)+'</p>':'')+(i.url?'<code>'+esc(i.url)+'</code>':'')+(i.evidence?'<span class="evidence-ref">'+esc(i.evidence.label)+' · '+esc(i.evidence.selector)+'</span>':'')+'<details><summary>Detalhe técnico</summary><code>'+esc(i.message)+'</code></details></div></div>').join(''):'<div class="issue issue-note"><div class="message">Nenhum problema encontrado. Tudo limpo por aqui.</div></div>';
  const issueCount=category=>r.issues.filter(issue=>issue.category===category).length;
  const qualityScore=count=>Math.max(0,Math.min(100,100-count*14));
  recordActivity({id:'scan-'+job.id,type:'scan',title:r.title||activityTarget(r.targetUrl),detail:(r.pages?.length??1)+' página(s) · '+r.browser,status:r.passed?'success':'error',errors:r.summary.errors,warnings:r.summary.warnings,durationMs:r.durationMs,href:'/scanner',scores:{http:r.mainStatus&&r.mainStatus<400?100:35,performance:perf?.lcpMs===undefined?undefined:Math.max(0,Math.min(100,Math.round(110-perf.lcpMs/35))),accessibility:qualityScore(issueCount('accessibility')),dom:qualityScore(issueCount('element')+issueCount('seo')),javascript:qualityScore(issueCount('javascript')+issueCount('console'))}});
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
if(form)form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;button.innerHTML='<i class="loader"></i>Iniciando';running();const formData=new FormData(form),data=Object.fromEntries(formData);data.timeoutMs=Number(data.timeoutMs);data.settleMs=Number(data.settleMs);data.maxPages=Number(data.maxPages);data.sitemap=formData.has('sitemap');data.accessibility=formData.has('accessibility');data.regressionsOnly=formData.has('regressionsOnly');data.acceptBaseline=formData.has('acceptBaseline');try{const response=await fetch('/api/scans',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}),job=await response.json();if(response.status===401){signInAndReturn();return}if(!response.ok)throw new Error(job.error||'Não foi possível iniciar a análise.');currentJobId=job.id;cancelButton.hidden=false;button.innerHTML='<i class="loader"></i>Analisando';await poll(job.id)}catch(error){showError(error.message);document.querySelector('#status').className='status fail';document.querySelector('#status').textContent=error.message.includes('cancelada')?'CANCELADA':'FALHA NA EXECUÇÃO'}finally{currentJobId=undefined;cancelButton.hidden=true;cancelButton.textContent='Cancelar';if(globalThis.turnstile)globalThis.turnstile.reset();if(turnstileBlock)turnstileBlock.hidden=false;button.disabled=false;button.textContent='Executar novo scanner'}});
// Seletor de aplicação da Inspeção. Nasce oculto e só aparece para quem tem
// conta com aplicação cadastrada: anônimo e servidor sem banco não teriam o que
// escolher, e um campo vazio ali só levantaria a pergunta "o que é isso?".
const scanApplicationPicker=document.querySelector('#application-picker'),scanApplicationSelect=document.querySelector('#scan-application');
async function loadScanApplications(){
  if(!scanApplicationPicker||!scanApplicationSelect)return;
  try{
    const response=await fetch('/api/v1/applications');
    if(!response.ok)return;
    const applications=(await response.json()).applications||[];
    if(!applications.length)return;
    for(const application of applications){
      const option=document.createElement('option');
      option.value=application.id;
      option.textContent=application.name;
      option.dataset.baseUrl=application.baseUrl;
      scanApplicationSelect.append(option);
    }
    scanApplicationPicker.hidden=false;
    // Vindo de "Inspecionar" na lista de aplicações, já chega escolhida.
    const wanted=new URLSearchParams(location.search).get('aplicacao');
    if(wanted&&applications.some(application=>application.id===wanted))scanApplicationSelect.value=wanted;
    const urlField=document.querySelector('#url');
    const fillUrl=()=>{
      const chosen=scanApplicationSelect.selectedOptions[0];
      // Só preenche o que está vazio: sobrescrever a URL digitada seria apagar
      // o trabalho de quem quer inspecionar uma página específica.
      if(chosen?.dataset.baseUrl&&urlField&&!urlField.value)urlField.value=chosen.dataset.baseUrl;
    };
    scanApplicationSelect.addEventListener('change',fillUrl);
    fillUrl();
  }catch{}
}
void loadScanApplications();

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
if(codeStart)codeStart.addEventListener('click',async()=>{codeError.style.display='none';try{const response=await fetch('/api/codegen',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:codeUrl.value})}),data=await response.json();
  // O gravador abre um navegador na máquina que roda o servidor: hospedado ele não faz sentido.
  if(response.status===401||response.status===403)throw new Error('O gravador só funciona com o QA Radar rodando na sua máquina. Neste servidor, cole ou importe o arquivo .spec.ts e execute.');
  if(!response.ok)throw new Error(data.error||'Não foi possível iniciar o Codegen.');codegenId=data.id;codeStart.disabled=true;codeStop.disabled=false;codeStart.textContent='Gravando no navegador…';}catch(reason){codeError.textContent=reason.message;codeError.style.display='block'}});
if(codeStop)codeStop.addEventListener('click',async()=>{if(!codegenId)return;codeStop.disabled=true;try{const response=await fetch('/api/codegen/'+codegenId),data=await response.json();if(data.status!=='completed'){codeError.textContent='Feche a janela do navegador para concluir a gravação e tente novamente.';codeError.style.display='block';return}codeEditor.value=data.code;codeStart.disabled=false;codeStart.textContent='Iniciar nova gravação';codegenId=undefined;}catch(reason){codeError.textContent=reason.message;codeError.style.display='block'}finally{codeStop.disabled=false}});
document.querySelector('#code-save')?.addEventListener('click',()=>{const blob=new Blob([codeEditor.value],{type:'text/typescript'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='qa-radar.spec.ts';link.click();URL.revokeObjectURL(link.href)});
// Execução hospedada exige o token administrativo do servidor; ele fica só nesta
// aba e é enviado como Bearer. Em localhost o servidor não pede nada disso.
const journeySignin=document.querySelector('#journey-signin'),journeySigninError=document.querySelector('#journey-signin-error');
// O token administrativo continua valendo na API, para automação, mas não é
// mais pedido a uma pessoa: no navegador o caminho é entrar com a conta.
function codeExecutionHeaders(){return {'content-type':'application/json'}}
function askToSignIn(message){
  if(!journeySignin)return;
  journeySignin.hidden=false;
  if(journeySigninError){journeySigninError.textContent=message;journeySigninError.style.display='block'}
}
const codeExecute=document.querySelector('#code-execute');codeExecute?.addEventListener('click',async()=>{codeExecute.disabled=true;codeExecute.innerHTML='<i class="loader"></i>Executando';codeError.style.display='none';codeResult.hidden=true;try{const response=await fetch('/api/code-execution',{method:'POST',headers:codeExecutionHeaders(),body:JSON.stringify({code:codeEditor.value})}),data=await response.json();if(response.status===401||response.status===403){askToSignIn(data.error||'Entre com sua conta para executar a jornada.');return}if(!response.ok&&data.status!=='failed')throw new Error(data.error||'Não foi possível executar a jornada.');if(journeySignin)journeySignin.hidden=true;const report=data.report||{},passed=data.status==='passed',stats=report.stats||{},errors=report.errors||[],details=data.failureDetails||errors.map(error=>error.message).join('\n\n'),duration=Number(stats.duration||0);codeResult.className='code-result '+(passed?'pass':'fail');codeResult.innerHTML='<div class="code-result-head"><div><span>'+(passed?'✓ Jornada aprovada':'✕ Jornada reprovada')+'</span><small>Execução '+esc(data.id)+'</small></div><strong>'+((duration/1000).toFixed(1))+'s</strong></div><div class="code-result-metrics"><span><b>'+(stats.expected||0)+'</b> aprovados</span><span><b>'+(stats.unexpected||0)+'</b> falhas</span><span><b>'+(stats.skipped||0)+'</b> ignorados</span></div>'+(details?'<pre>'+esc(details)+'</pre>':'');recordActivity({id:'journey-'+data.id,type:'journey',title:'Jornada Playwright',detail:(stats.expected||0)+' aprovado(s) · '+(stats.unexpected||0)+' falha(s)',status:passed?'success':'error',errors:Number(stats.unexpected||0),warnings:Number(stats.skipped||0),durationMs:duration,href:'/journeys',scores:{javascript:passed?100:Math.max(10,100-Number(stats.unexpected||0)*25),dom:passed?100:55}});codeResult.hidden=false;}catch(reason){codeError.textContent=reason.message;codeError.style.display='block'}finally{codeExecute.disabled=false;codeExecute.textContent='Executar'}});
document.querySelector('#code-import')?.addEventListener('change',async event=>{const file=event.target.files?.[0];if(file)codeEditor.value=await file.text()});

// Conta: a barra superior só mostra alguma coisa se o servidor tiver login
// configurado. Sem isso o produto segue anônimo e nada aparece.
// Cliente HTTP interativo de /api-tests (estilo Postman) — independente do
// Modo Jornada acima; não compartilha nenhum elemento com ele.
const httpSend=document.querySelector('#http-send');
if(httpSend){
  const httpMethod=document.querySelector('#http-method'),httpUrl=document.querySelector('#http-url'),httpErrorBox=document.querySelector('#http-error'),httpNotice=document.querySelector('#http-notice'),httpBody=document.querySelector('#http-body'),httpParams=document.querySelector('#http-params'),httpHeaders=document.querySelector('#http-headers'),httpVariables=document.querySelector('#http-variables'),httpAuthType=document.querySelector('#http-auth-type'),httpAuthBearerToken=document.querySelector('#http-auth-bearer-token'),httpAuthBasicUser=document.querySelector('#http-auth-basic-user'),httpAuthBasicPassword=document.querySelector('#http-auth-basic-password'),httpAuthApiKeyName=document.querySelector('#http-auth-api-key-name'),httpAuthApiKeyValue=document.querySelector('#http-auth-api-key-value'),httpAuthApiKeyLocation=document.querySelector('#http-auth-api-key-location'),httpResponse=document.querySelector('#http-response'),httpResponseEmpty=document.querySelector('#http-response-empty'),httpResponseStatus=document.querySelector('#http-response-status'),httpResponseDuration=document.querySelector('#http-response-duration'),httpResponseSize=document.querySelector('#http-response-size'),httpResponseHeaders=document.querySelector('#http-response-headers'),httpResponseBody=document.querySelector('#http-response-body'),httpCopyResponse=document.querySelector('#http-copy-response'),httpCollectionList=document.querySelector('#http-collection-list'),httpCollectionName=document.querySelector('#http-collection-name'),httpCollectionSearch=document.querySelector('#http-collection-search'),httpHistoryList=document.querySelector('#http-history-list'),httpHistoryCount=document.querySelector('#http-history-count'),httpBodyState=document.querySelector('#http-body-state');
  const COLLECTION_KEY='qa-radar-api-collection',VARIABLES_KEY='qa-radar-api-variables',HISTORY_KEY='qa-radar-api-history',HISTORY_LIMIT=30;
  let activeHttpRequest,currentCollectionIndex=-1,noticeTimer;
  function hideHttpMessages(){httpErrorBox.style.display='none';httpNotice.style.display='none';clearTimeout(noticeTimer)}
  function showHttpError(message){httpNotice.style.display='none';httpErrorBox.textContent=message;httpErrorBox.style.display='block'}
  function showHttpNotice(message){httpErrorBox.style.display='none';httpNotice.textContent=message;httpNotice.style.display='block';clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{httpNotice.style.display='none'},3500)}
  function updatePairCounts(){
    document.querySelector('#http-param-count').textContent=String(kvPairs(httpParams).length);
    document.querySelector('#http-header-count').textContent=String(kvPairs(httpHeaders).length);
    document.querySelector('#http-variable-count').textContent=String(kvPairs(httpVariables).length);
  }
  function kvRow(container,keyPlaceholder,valuePlaceholder){
    const row=document.createElement('div');
    row.className='http-kv-row';
    row.innerHTML='<input type="text" class="http-kv-key" aria-label="Nome" placeholder="'+esc(keyPlaceholder)+'"><input type="text" class="http-kv-value" aria-label="Valor" placeholder="'+esc(valuePlaceholder)+'"><button type="button" class="secondary http-kv-remove" aria-label="Remover">×</button>';
    row.querySelector('.http-kv-remove').addEventListener('click',()=>{row.remove();pairsChanged(container)});
    container.appendChild(row);
    return row;
  }
  document.querySelector('#http-add-param')?.addEventListener('click',()=>kvRow(httpParams,'Nome','Valor'));
  document.querySelector('#http-add-header')?.addEventListener('click',()=>kvRow(httpHeaders,'Nome','Valor'));
  document.querySelector('#http-add-variable')?.addEventListener('click',()=>kvRow(httpVariables,'nome','valor'));
  for(const container of [httpParams,httpHeaders,httpVariables]){
    container.querySelectorAll('.http-kv-remove').forEach(button=>button.addEventListener('click',()=>{button.closest('.http-kv-row').remove();pairsChanged(container)}));
    container.addEventListener('input',()=>pairsChanged(container));
  }
  function kvPairs(container){
    return [...container.querySelectorAll('.http-kv-row')].map(row=>({key:row.querySelector('.http-kv-key').value.trim(),value:row.querySelector('.http-kv-value').value})).filter(pair=>pair.key);
  }
  function pairsChanged(container){
    updatePairCounts();
    if(container===httpVariables){try{localStorage.setItem(VARIABLES_KEY,JSON.stringify(kvPairs(httpVariables)))}catch{}}
  }
  function applyVariables(text,variables){
    return variables.reduce((value,variable)=>value.split('{{'+variable.key+'}}').join(variable.value),text);
  }
  function bindHttpTabs(){
    document.querySelectorAll('[data-http-tabs]').forEach(tabList=>{
      tabList.querySelectorAll('[data-http-tab]').forEach(tab=>tab.addEventListener('click',()=>{
        const target=document.querySelector('#'+tab.dataset.httpTab);
        if(!target)return;
        tabList.querySelectorAll('[data-http-tab]').forEach(item=>{const selected=item===tab;item.classList.toggle('active',selected);item.setAttribute('aria-selected',String(selected));document.querySelector('#'+item.dataset.httpTab).hidden=!selected});
      }));
    });
  }
  function loadCollection(){
    try{const raw=localStorage.getItem(COLLECTION_KEY),parsed=raw?JSON.parse(raw):{};return {requests:Array.isArray(parsed.requests)?parsed.requests:[]}}catch{return {requests:[]}}
  }
  function saveCollection(collection){try{localStorage.setItem(COLLECTION_KEY,JSON.stringify(collection))}catch{}}
  function loadHistory(){
    try{const parsed=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');return Array.isArray(parsed)?parsed:[]}catch{return []}
  }
  function saveHistory(history){try{localStorage.setItem(HISTORY_KEY,JSON.stringify(history.slice(0,HISTORY_LIMIT)))}catch{}}
  function fillPairs(container,pairs,keyPlaceholder='Nome',valuePlaceholder='Valor'){
    container.innerHTML='';
    (pairs?.length?pairs:[{key:'',value:''}]).forEach(pair=>{const row=kvRow(container,keyPlaceholder,valuePlaceholder);row.querySelector('.http-kv-key').value=pair.key||'';row.querySelector('.http-kv-value').value=pair.value||''});
    pairsChanged(container);
  }
  function normalizePairs(value){
    return Array.isArray(value)?value.filter(pair=>pair&&typeof pair.key==='string'&&typeof pair.value==='string').map(pair=>({key:pair.key,value:pair.value})):[];
  }
  function normalizeAuth(value){
    const auth=value&&typeof value==='object'?value:{},type=['bearer','basic','api-key'].includes(auth.type)?auth.type:'none';
    return {type,bearerToken:typeof auth.bearerToken==='string'?auth.bearerToken:'',username:typeof auth.username==='string'?auth.username:'',password:typeof auth.password==='string'?auth.password:'',apiKeyName:typeof auth.apiKeyName==='string'?auth.apiKeyName:'',apiKeyValue:typeof auth.apiKeyValue==='string'?auth.apiKeyValue:'',apiKeyLocation:auth.apiKeyLocation==='query'?'query':'header'};
  }
  function readAuth(){
    return {type:httpAuthType.value,bearerToken:httpAuthBearerToken.value,username:httpAuthBasicUser.value,password:httpAuthBasicPassword.value,apiKeyName:httpAuthApiKeyName.value,apiKeyValue:httpAuthApiKeyValue.value,apiKeyLocation:httpAuthApiKeyLocation.value};
  }
  function fillAuth(value){
    const auth=normalizeAuth(value);httpAuthType.value=auth.type;httpAuthBearerToken.value=auth.bearerToken;httpAuthBasicUser.value=auth.username;httpAuthBasicPassword.value=auth.password;httpAuthApiKeyName.value=auth.apiKeyName;httpAuthApiKeyValue.value=auth.apiKeyValue;httpAuthApiKeyLocation.value=auth.apiKeyLocation;syncAuthType();
  }
  function currentRequest(name=''){
    return {name,method:httpMethod.value,url:httpUrl.value.trim(),params:kvPairs(httpParams),headers:kvPairs(httpHeaders),body:httpBody.value,auth:readAuth()};
  }
  function normalizeRequest(item){
    if(!item||typeof item!=='object'||typeof item.name!=='string'||typeof item.url!=='string')return;
    const method=typeof item.method==='string'?item.method.toUpperCase():'GET';
    if(!item.name.trim()||!['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(method))return;
    return {name:item.name.trim(),method,url:item.url,params:normalizePairs(item.params),headers:normalizePairs(item.headers),body:typeof item.body==='string'?item.body:'',auth:normalizeAuth(item.auth)};
  }
  function fillRequest(item){
    httpMethod.value=item.method||'GET';httpUrl.value=item.url||'';httpBody.value=item.body||'';
    fillPairs(httpParams,item.params);fillPairs(httpHeaders,item.headers);fillAuth(item.auth);syncHttpMethod();hideHttpMessages();
  }
  function renderCollection(query=httpCollectionSearch.value.trim()){
    const collection=loadCollection();
    if(!collection.requests.length){httpCollectionList.innerHTML='<p class="hint">Nenhuma requisição salva ainda.</p>';return}
    const normalized=query.toLocaleLowerCase('pt-BR');
    const matches=collection.requests.map((item,index)=>({item,index})).filter(({item})=>!normalized||(item.name+' '+item.method+' '+item.url).toLocaleLowerCase('pt-BR').includes(normalized));
    if(!matches.length){httpCollectionList.innerHTML='<p class="hint">Nenhuma requisição encontrada.</p>';return}
    httpCollectionList.innerHTML=matches.map(({item,index})=>'<div class="http-collection-item '+(index===currentCollectionIndex?'active':'')+'"><span class="http-method-badge">'+esc(item.method)+'</span><button type="button" class="http-collection-load" data-index="'+index+'"><strong>'+esc(item.name)+'</strong><span>'+esc(item.url||'URL não informada')+'</span></button><button type="button" class="secondary http-collection-delete" data-index="'+index+'" aria-label="Remover '+esc(item.name)+'">Remover</button></div>').join('');
    httpCollectionList.querySelectorAll('.http-collection-load').forEach(button=>button.addEventListener('click',()=>{
      const item=loadCollection().requests[Number(button.dataset.index)];
      if(!item)return;
      currentCollectionIndex=Number(button.dataset.index);httpCollectionName.value=item.name;
      fillRequest(item);renderCollection();
    }));
    httpCollectionList.querySelectorAll('.http-collection-delete').forEach(button=>button.addEventListener('click',()=>{
      const index=Number(button.dataset.index),collection=loadCollection();collection.requests.splice(index,1);saveCollection(collection);
      if(currentCollectionIndex===index)currentCollectionIndex=-1;else if(currentCollectionIndex>index)currentCollectionIndex-=1;
      renderCollection();showHttpNotice('Requisição removida da collection.');
    }));
  }
  function renderHistory(){
    const history=loadHistory();httpHistoryCount.textContent=String(history.length);
    if(!history.length){httpHistoryList.innerHTML='<p class="hint">Nenhuma requisição executada ainda.</p>';return}
    httpHistoryList.innerHTML=history.map((item,index)=>{
      const failed=!item.status||item.status>=400,date=new Date(item.createdAt).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
      return '<div class="http-history-item"><span class="http-method-badge">'+esc(item.method)+'</span><button type="button" class="http-history-load" data-index="'+index+'"><strong>'+esc(item.displayUrl||item.url)+'</strong><span>'+esc(date)+'</span></button><div class="http-history-result"><strong class="'+(failed?'error':'')+'">'+esc(item.status?item.status+' '+(item.statusText||''):'Erro')+'</strong><small>'+esc(item.durationMs||0)+' ms</small></div></div>';
    }).join('');
    httpHistoryList.querySelectorAll('.http-history-load').forEach(button=>button.addEventListener('click',()=>{
      const item=loadHistory()[Number(button.dataset.index)];if(!item)return;
      currentCollectionIndex=-1;httpCollectionName.value='';fillRequest(item);renderCollection();showHttpNotice('Requisição carregada do histórico.');
    }));
  }
  function recordHistory(request,result){
    const createdAt=Date.now(),history=loadHistory();history.unshift({...request,...result,createdAt});saveHistory(history);renderHistory();
    const failed=!result.status||result.status>=400;
    recordActivity({id:'api-'+createdAt,type:'api',title:request.method+' '+activityTarget(result.displayUrl||request.url),detail:(result.status?result.status+' '+(result.statusText||''):'Falha de conexão'),status:failed?'error':'success',errors:failed?1:0,warnings:0,durationMs:result.durationMs||0,createdAt,href:'/api-tests?activity='+createdAt,scores:{http:failed?30:100}});
  }
  function syncHttpMethod(){httpBodyState.hidden=!['GET','HEAD'].includes(httpMethod.value)}
  function syncAuthType(){
    for(const type of ['none','bearer','basic','api-key'])document.querySelector('#http-auth-'+type).hidden=httpAuthType.value!==type;
  }
  function resetHttpRequest(){
    activeHttpRequest?.abort();activeHttpRequest=undefined;currentCollectionIndex=-1;
    httpMethod.value='GET';httpUrl.value='';httpBody.value='';httpCollectionName.value='';
    fillPairs(httpParams,[]);fillPairs(httpHeaders,[]);fillAuth({});syncHttpMethod();hideHttpMessages();
    httpResponse.hidden=true;httpResponseEmpty.hidden=false;httpCopyResponse.hidden=true;renderCollection();
  }
  bindHttpTabs();
  try{const savedVariables=JSON.parse(localStorage.getItem(VARIABLES_KEY)||'[]');if(Array.isArray(savedVariables))fillPairs(httpVariables,savedVariables,'nome','valor')}catch{}
  updatePairCounts();syncHttpMethod();syncAuthType();
  renderCollection();renderHistory();
  const requestedActivity=Number(new URLSearchParams(location.search).get('activity'));
  if(requestedActivity){
    const request=loadHistory().find(item=>Number(item.createdAt)===requestedActivity);
    if(request){fillRequest(request);showHttpNotice('Requisição recuperada. Revise os dados antes de reenviar.')}
  }

  document.querySelector('#http-save-request')?.addEventListener('click',()=>{
    const name=httpCollectionName.value.trim();
    if(!name){showHttpError('Informe um nome para salvar a requisição.');return}
    const request=currentRequest(name),collection=loadCollection();
    const sameName=collection.requests.findIndex((item,index)=>index!==currentCollectionIndex&&item.name.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR'));
    const targetIndex=currentCollectionIndex>=0?currentCollectionIndex:sameName;
    if(targetIndex>=0){collection.requests[targetIndex]=request;currentCollectionIndex=targetIndex}else{collection.requests.push(request);currentCollectionIndex=collection.requests.length-1}
    saveCollection(collection);renderCollection();showHttpNotice(targetIndex>=0?'Requisição atualizada.':'Requisição salva na collection.');
  });
  httpCollectionSearch.addEventListener('input',()=>renderCollection());
  httpMethod.addEventListener('change',syncHttpMethod);
  httpAuthType.addEventListener('change',syncAuthType);
  document.querySelector('#http-clear')?.addEventListener('click',resetHttpRequest);
  document.querySelector('#http-clear-history')?.addEventListener('click',()=>{saveHistory([]);renderHistory();showHttpNotice('Histórico removido.')});
  document.querySelector('#http-format-body')?.addEventListener('click',()=>{
    hideHttpMessages();
    if(!httpBody.value.trim()){showHttpError('Informe um body JSON para formatar.');return}
    try{httpBody.value=JSON.stringify(JSON.parse(httpBody.value),null,2);showHttpNotice('JSON formatado.')}catch{showHttpError('O body não contém um JSON válido.')}
  });
  document.querySelector('#http-collection-export')?.addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify(loadCollection(),null,2)],{type:'application/json'}),link=document.createElement('a');
    link.href=URL.createObjectURL(blob);link.download='qa-radar-api-collection.json';link.click();URL.revokeObjectURL(link.href);
  });
  document.querySelector('#http-collection-import')?.addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try{
      const imported=JSON.parse(await file.text());if(!Array.isArray(imported.requests))throw new Error();
      const valid=imported.requests.map(normalizeRequest).filter(Boolean);if(valid.length!==imported.requests.length)throw new Error();
      const collection=loadCollection(),byName=new Map(collection.requests.map(item=>[item.name.toLocaleLowerCase('pt-BR'),item]));
      valid.forEach(item=>byName.set(item.name.toLocaleLowerCase('pt-BR'),item));saveCollection({requests:[...byName.values()]});currentCollectionIndex=-1;renderCollection();showHttpNotice(valid.length+' requisição(ões) importada(s).');
    }
    catch{showHttpError('Arquivo de collection inválido.')}
    finally{event.target.value=''}
  });
  httpCopyResponse.addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(httpResponseBody.textContent);showHttpNotice('Body copiado para a área de transferência.')}catch{showHttpError('Não foi possível copiar o body.')}
  });

  httpSend.addEventListener('click',async()=>{
    if(activeHttpRequest){activeHttpRequest.abort();return}
    hideHttpMessages();
    const request=currentRequest(),variables=kvPairs(httpVariables),method=request.method,rawUrl=applyVariables(request.url,variables);
    if(!rawUrl){showHttpError('Informe a URL da requisição.');return}
    if(/{{[^{}]+}}/.test(rawUrl)){showHttpError('Preencha todas as variáveis usadas na URL.');return}
    let parsedUrl;
    try{parsedUrl=new URL(rawUrl);if(!['http:','https:'].includes(parsedUrl.protocol))throw new Error()}catch{showHttpError('Informe uma URL HTTP ou HTTPS válida.');return}
    for(const pair of request.params){
      const key=applyVariables(pair.key,variables),value=applyVariables(pair.value,variables);
      if(/{{[^{}]+}}/.test(key+value)){showHttpError('Preencha todas as variáveis usadas nos parâmetros.');return}
      if(key)parsedUrl.searchParams.append(key,value);
    }
    const headers={};
    for(const pair of request.headers){
      const key=applyVariables(pair.key,variables),value=applyVariables(pair.value,variables);
      if(/{{[^{}]+}}/.test(key+value)){showHttpError('Preencha todas as variáveis usadas nos headers.');return}
      if(key)headers[key]=value;
    }
    const setHeader=(key,value)=>{const existing=Object.keys(headers).find(name=>name.toLowerCase()===key.toLowerCase());if(existing)delete headers[existing];headers[key]=value};
    const auth=request.auth;
    let authQueryName;
    if(auth.type==='bearer'){
      const token=applyVariables(auth.bearerToken,variables);if(!token){showHttpError('Informe o Bearer Token.');return}if(/{{[^{}]+}}/.test(token)){showHttpError('Preencha a variável usada no Bearer Token.');return}setHeader('Authorization','Bearer '+token);
    }else if(auth.type==='basic'){
      const username=applyVariables(auth.username,variables),password=applyVariables(auth.password,variables);if(!username){showHttpError('Informe o usuário do Basic Auth.');return}if(/{{[^{}]+}}/.test(username+password)){showHttpError('Preencha as variáveis usadas no Basic Auth.');return}
      const bytes=new TextEncoder().encode(username+':'+password);let binary='';bytes.forEach(byte=>{binary+=String.fromCharCode(byte)});setHeader('Authorization','Basic '+btoa(binary));
    }else if(auth.type==='api-key'){
      const key=applyVariables(auth.apiKeyName,variables),value=applyVariables(auth.apiKeyValue,variables);if(!key||!value){showHttpError('Informe o nome e o valor da API Key.');return}
      if(/{{[^{}]+}}/.test(key+value)){showHttpError('Preencha as variáveis usadas na API Key.');return}
      if(auth.apiKeyLocation==='query'){parsedUrl.searchParams.set(key,value);authQueryName=key}else setHeader(key,value);
    }
    const url=parsedUrl.toString();
    let displayUrl=url;
    if(authQueryName){const redactedUrl=new URL(url);redactedUrl.searchParams.set(authQueryName,'REDACTED');displayUrl=redactedUrl.toString()}
    const body=method==='GET'||method==='HEAD'?undefined:applyVariables(httpBody.value,variables);
    if(body&&/{{[^{}]+}}/.test(body)){showHttpError('Preencha todas as variáveis usadas no body.');return}
    if(body&&!Object.keys(headers).some(key=>key.toLowerCase()==='content-type')){try{JSON.parse(body);headers['Content-Type']='application/json'}catch{}}
    activeHttpRequest=new AbortController();httpSend.classList.add('cancel-active');httpSend.innerHTML='<i class="loader"></i>Cancelar';
    let historyRecorded=false;
    try{
      const response=await fetch('/api/http-request',{method:'POST',headers:{'content-type':'application/json'},signal:activeHttpRequest.signal,body:JSON.stringify({method,url,headers,...(body!==undefined?{body}:{})})}),data=await response.json();
      if(response.status===401){signInAndReturn();return}
      if(!response.ok)throw new Error(data.error||'Não foi possível enviar a requisição.');
      httpResponse.hidden=false;httpResponseEmpty.hidden=true;httpCopyResponse.hidden=false;
      const statusClass=data.status>=200&&data.status<300?'ok':data.status>=300&&data.status<400?'redirect':'error';
      httpResponseStatus.className='http-status '+statusClass;httpResponseStatus.textContent=data.status+' '+data.statusText;
      httpResponseDuration.textContent=data.durationMs+' ms';
      httpResponseHeaders.textContent=Object.entries(data.headers||{}).map(([key,value])=>key+': '+value).join('\n')||'(sem headers)';
      let prettyBody=data.body;
      try{prettyBody=JSON.stringify(JSON.parse(data.body),null,2)}catch{}
      httpResponseBody.textContent=prettyBody+(data.bodyTruncated?'\n\n[corpo truncado]':'');
      const bytes=new TextEncoder().encode(data.body||'').length;httpResponseSize.textContent=bytes<1024?bytes+' B':(bytes/1024).toFixed(1)+' KB';
      recordHistory(request,{displayUrl,status:data.status,statusText:data.statusText,durationMs:data.durationMs});historyRecorded=true;
    }catch(error){
      if(error.name==='AbortError')showHttpNotice('Envio cancelado.');
      else{showHttpError(error.message);if(!historyRecorded)recordHistory(request,{displayUrl,status:0,statusText:'Erro',durationMs:0})}
    }
    finally{activeHttpRequest=undefined;httpSend.classList.remove('cancel-active');httpSend.textContent='Enviar'}
  });
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();httpSend.click()}});
}
`;

export const SHELL_CLIENT_SCRIPT = String.raw`
const appSidebar=document.querySelector('.app-sidebar'),mobileNavToggle=document.querySelector('.mobile-nav-toggle');
const contextClock=document.querySelector('#context-clock');
function updateContextClock(){
  if(!contextClock)return;
  const now=new Date();
  contextClock.dateTime=now.toISOString();
  contextClock.textContent=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(now).replace(',','');
}
updateContextClock();
if(contextClock)setInterval(updateContextClock,30000);
// O ambiente escolhido na barra de contexto vale para todas as páginas: fica no
// navegador e alimenta o campo "Ambiente" da Inspeção.
const environmentKey='qa-radar-environment';
const environmentSelect=document.querySelector('#context-environment');
const environmentLabel=document.querySelector('#context-environment-label');
function applyEnvironment(slug,persist){
  if(!environmentSelect)return;
  const option=[...environmentSelect.options].find(item=>item.value===slug)||environmentSelect.options[0];
  environmentSelect.value=option.value;
  if(environmentLabel)environmentLabel.textContent=option.textContent;
  environmentSelect.closest('.context-item')?.setAttribute('data-environment',option.value);
  if(persist){try{localStorage.setItem(environmentKey,option.value)}catch{}}
  const scanEnvironment=document.querySelector('#environment');
  if(scanEnvironment&&!scanEnvironment.disabled)scanEnvironment.value=option.value;
}
if(environmentSelect){
  let storedEnvironment='';
  try{storedEnvironment=localStorage.getItem(environmentKey)||''}catch{}
  applyEnvironment(storedEnvironment||environmentSelect.value,false);
  environmentSelect.addEventListener('change',()=>applyEnvironment(environmentSelect.value,true));
}
function setMobileNavigation(open){
  if(!appSidebar||!mobileNavToggle)return;
  appSidebar.classList.toggle('nav-open',open);
  mobileNavToggle.setAttribute('aria-expanded',String(open));
  mobileNavToggle.setAttribute('aria-label',open?'Fechar menu':'Abrir menu');
}
mobileNavToggle?.addEventListener('click',()=>setMobileNavigation(!appSidebar.classList.contains('nav-open')));
appSidebar?.querySelectorAll('.nav-link').forEach(link=>link.addEventListener('click',()=>setMobileNavigation(false)));
document.addEventListener('keydown',event=>{if(event.key==='Escape')setMobileNavigation(false)});
window.matchMedia('(min-width: 861px)').addEventListener('change',event=>{if(event.matches)setMobileNavigation(false)});

// Conta na barra superior. Vive aqui, e não no script das ferramentas, porque a
// Visão geral e a Ajuda não carregam aquele script — com a lógica lá, o controle
// nascia oculto e nunca aparecia justamente na primeira página que se abre.
const accountControl=document.querySelector('#account-control');
const verifyBanner=document.querySelector('#verify-banner');
async function refreshAccount(){
  if(!accountControl)return;
  try{
    const me=await (await fetch('/api/v1/auth/me')).json();
    if(!me.loginAvailable){accountControl.hidden=true;return}
    accountControl.hidden=false;
    const signin=document.querySelector('#account-signin'),user=document.querySelector('#account-user');
    if(me.authenticated&&me.user){
      if(signin)signin.hidden=true;
      if(user)user.hidden=false;
      const avatar=document.querySelector('#account-avatar'),login=document.querySelector('#account-login');
      if(login)login.textContent=me.user.name||me.user.login;
      if(avatar){if(me.user.avatarUrl){avatar.src=me.user.avatarUrl;avatar.hidden=false}else avatar.hidden=true}
      // Quem entrou não precisa mais do aviso de login na Jornada.
      const signinNotice=document.querySelector('#journey-signin');
      if(signinNotice)signinNotice.hidden=true;
      // Só avisa quem tem e-mail e ainda não confirmou; conta vinda só do
      // provedor externo pode não ter endereço nenhum para confirmar.
      if(verifyBanner)verifyBanner.hidden=!(me.user.email&&!me.user.emailVerified);
    }else{
      if(signin)signin.hidden=false;
      if(user)user.hidden=true;
      if(verifyBanner)verifyBanner.hidden=true;
    }
  }catch{accountControl.hidden=true}
}
document.querySelector('#account-signout')?.addEventListener('click',async event=>{
  const button=event.currentTarget;button.disabled=true;
  try{await fetch('/api/v1/auth/logout',{method:'POST'});location.reload()}
  catch{button.disabled=false}
});
document.querySelector('#verify-resend')?.addEventListener('click',async event=>{
  const button=event.currentTarget,state=document.querySelector('#verify-state');
  button.disabled=true;
  const say=text=>{if(state){state.textContent=text;state.hidden=false}};
  try{
    const response=await fetch('/api/v1/auth/verify/request',{method:'POST'});
    const body=await response.json().catch(()=>({}));
    if(!response.ok){say(body.error||'Não foi possível reenviar agora.');button.disabled=false;return}
    if(body.verified){if(verifyBanner)verifyBanner.hidden=true;return}
    say(body.sent?'Enviado. Confira sua caixa de entrada.':'Este servidor não envia e-mail.');
  }catch{say('Não foi possível reenviar agora.');button.disabled=false}
});
void refreshAccount();
`;

/**
 * Cliente das aplicações.
 *
 * O mesmo formulário cadastra e edita: são o mesmo conjunto de campos, e uma
 * segunda tela só para editar dobraria a superfície sem mudar nada do que a
 * pessoa faz.
 */
export const APPLICATIONS_CLIENT_SCRIPT = String.raw`
const applicationForm=document.querySelector('#application-form');
const applicationList=document.querySelector('#application-list');
const applicationHint=document.querySelector('#application-list-hint');
const applicationError=document.querySelector('#application-error');
const applicationTitle=document.querySelector('#application-form-title');
const applicationSubmit=document.querySelector('#application-submit');
const applicationCancel=document.querySelector('#application-cancel');
const fieldId=document.querySelector('#application-id');
const fieldName=document.querySelector('#application-name');
const fieldBaseUrl=document.querySelector('#application-base-url');
const fieldEnvironments=document.querySelector('#application-environments');
const appEsc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));

function applicationFail(message){if(applicationError){applicationError.textContent=message;applicationError.style.display='block'}}
function applicationClearError(){if(applicationError){applicationError.textContent='';applicationError.style.display='none'}}

function editApplication(application){
  if(fieldId)fieldId.value=application.id;
  if(fieldName)fieldName.value=application.name;
  if(fieldBaseUrl)fieldBaseUrl.value=application.baseUrl;
  if(fieldEnvironments)fieldEnvironments.value=(application.environments||[]).join(', ');
  if(applicationTitle)applicationTitle.textContent='Editar aplicação';
  if(applicationSubmit)applicationSubmit.textContent='Salvar alterações';
  if(applicationCancel)applicationCancel.hidden=false;
  applicationClearError();
  fieldName?.focus();
}

function resetApplicationForm(){
  applicationForm?.reset();
  if(fieldId)fieldId.value='';
  if(applicationTitle)applicationTitle.textContent='Nova aplicação';
  if(applicationSubmit)applicationSubmit.textContent='Cadastrar aplicação';
  if(applicationCancel)applicationCancel.hidden=true;
  applicationClearError();
}
applicationCancel?.addEventListener('click',resetApplicationForm);

function renderApplications(applications){
  if(!applicationList)return;
  if(!applications.length){
    applicationList.innerHTML='';
    if(applicationHint)applicationHint.textContent='Nenhuma aplicação cadastrada ainda. Comece pelo formulário ao lado.';
    return;
  }
  if(applicationHint)applicationHint.textContent=applications.length===1?'1 aplicação cadastrada.':applications.length+' aplicações cadastradas.';
  applicationList.innerHTML=applications.map(application=>
    '<article class="application-item" data-id="'+appEsc(application.id)+'">'+
      '<div class="application-info"><strong>'+appEsc(application.name)+'</strong>'+
        '<a href="'+appEsc(application.baseUrl)+'" target="_blank" rel="noopener noreferrer">'+appEsc(application.baseUrl)+'</a>'+
        (application.environments&&application.environments.length?'<div class="application-tags">'+application.environments.map(environment=>'<span>'+appEsc(environment)+'</span>').join('')+'</div>':'')+
      '</div>'+
      '<div class="application-actions">'+
        '<button type="button" data-action="scan">Inspecionar</button>'+
        '<button type="button" data-action="edit">Editar</button>'+
        '<button type="button" data-action="archive">Arquivar</button>'+
      '</div>'+
    '</article>').join('');
}

let applicationsCache=[];
async function loadApplications(){
  try{
    const response=await fetch('/api/v1/applications');
    if(response.status===401){location.href='/entrar?proximo='+encodeURIComponent(location.pathname);return}
    const body=await response.json();
    if(!response.ok){disableApplicationForm(body.error||'Não foi possível carregar suas aplicações.');return}
    applicationsCache=body.applications||[];
    renderApplications(applicationsCache);
  }catch{disableApplicationForm('Não foi possível carregar suas aplicações.')}
}

// Desligar é mais honesto que deixar digitar: o campo aberto promete um cadastro
// que o servidor não tem como aceitar.
function disableApplicationForm(reason){
  if(applicationHint)applicationHint.textContent=reason;
  for(const field of [fieldName,fieldBaseUrl,fieldEnvironments,applicationSubmit])if(field)field.disabled=true;
  const notice=document.querySelector('#application-unavailable');
  if(notice){notice.textContent=reason;notice.hidden=false}
}

applicationList?.addEventListener('click',async event=>{
  const button=event.target.closest('button[data-action]');
  if(!button)return;
  const id=button.closest('.application-item')?.dataset.id;
  const application=applicationsCache.find(item=>item.id===id);
  if(!application)return;
  if(button.dataset.action==='edit'){editApplication(application);return}
  if(button.dataset.action==='scan'){location.href='/scanner?aplicacao='+encodeURIComponent(application.id);return}
  // Arquivar é reversível no banco, mas some da lista: confirmar evita o clique
  // errado numa lista onde os botões ficam lado a lado.
  if(!confirm('Arquivar "'+application.name+'"? As análises já feitas continuam no histórico.'))return;
  button.disabled=true;
  try{
    const response=await fetch('/api/v1/applications/'+encodeURIComponent(application.id),{method:'DELETE'});
    if(!response.ok){const body=await response.json().catch(()=>({}));applicationFail(body.error||'Não foi possível arquivar.');button.disabled=false;return}
    await loadApplications();
  }catch{applicationFail('Não foi possível arquivar.');button.disabled=false}
});

applicationForm?.addEventListener('submit',async event=>{
  event.preventDefault();
  applicationClearError();
  const id=fieldId?.value||'';
  const payload={
    name:fieldName?.value.trim()||'',
    baseUrl:fieldBaseUrl?.value.trim()||'',
    environments:(fieldEnvironments?.value||'').split(',').map(part=>part.trim()).filter(Boolean),
  };
  if(applicationSubmit)applicationSubmit.disabled=true;
  try{
    const response=await fetch('/api/v1/applications'+(id?'/'+encodeURIComponent(id):''),{
      method:id?'PATCH':'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(payload),
    });
    if(response.status===401){location.href='/entrar?proximo='+encodeURIComponent(location.pathname);return}
    const body=await response.json().catch(()=>({}));
    if(!response.ok){applicationFail(body.error||'Não foi possível salvar.');return}
    resetApplicationForm();
    await loadApplications();
  }catch{applicationFail('Não foi possível salvar.')}
  finally{if(applicationSubmit)applicationSubmit.disabled=false}
});

void loadApplications();
`;

export const HOME_DASHBOARD_SCRIPT = String.raw`
const dashboardActivityKey='qa-radar-activity';
const dashboardEsc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
function loadDashboardActivity(){
  try{
    const raw=localStorage.getItem(dashboardActivityKey);
    if(raw!==null){
      const stored=JSON.parse(raw);
      if(Array.isArray(stored))return stored;
    }
  }catch{}
  try{
    const apiHistory=JSON.parse(localStorage.getItem('qa-radar-api-history')||'[]');
    if(!Array.isArray(apiHistory))return [];
    return apiHistory.map((item,index)=>{
      let target=String(item.displayUrl||item.url||'API');
      try{const url=new URL(target);target=url.host+url.pathname}catch{}
      const failed=!item.status||item.status>=400;
      return {id:'legacy-api-'+index,type:'api',title:(item.method||'GET')+' '+target,detail:item.status?item.status+' '+(item.statusText||''):'Falha de conexão',status:failed?'error':'success',errors:failed?1:0,warnings:0,durationMs:item.durationMs||0,createdAt:item.createdAt,href:'/api-tests?activity='+Number(item.createdAt||0),scores:{http:failed?30:100}};
    });
  }catch{return []}
}
function dashboardTime(value){
  const date=new Date(value||Date.now()),elapsed=Math.max(0,Date.now()-date.getTime()),minutes=Math.floor(elapsed/60000);
  if(minutes<1)return 'agora';
  if(minutes<60)return 'há '+minutes+' min';
  const hours=Math.floor(minutes/60);
  if(hours<24)return 'há '+hours+' h';
  return date.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
}
function dashboardDuration(value){
  const milliseconds=Number(value||0);
  if(milliseconds<1000)return Math.round(milliseconds)+'ms';
  if(milliseconds<60000)return (milliseconds/1000).toFixed(milliseconds>=10000?0:1)+'s';
  return Math.round(milliseconds/60000)+'min';
}
function activityMeta(item){
  if(item.type==='scan')return {label:'INSPEÇÃO',icon:'overview'};
  if(item.type==='journey')return {label:'JORNADA',icon:'journey'};
  return {label:'API',icon:'api'};
}
// "12 erros" / "1 erro" / "—" quando não há medição para o eixo.
function dashboardCount(value,singular,plural){
  const total=Number(value||0);
  return total?total+' '+(total===1?singular:plural):'-';
}
function dashboardScore(value,suffix){
  return Number.isFinite(value)?value+' '+suffix:'-';
}
let dashboardFilter='all';
let dashboardShowAll=false;
let dashboardActivities=loadDashboardActivity();
const dashboardLiveState=document.querySelector('#dashboard-live-state');
function setDashboardLiveState(state,label){
  if(!dashboardLiveState)return;
  dashboardLiveState.dataset.state=state;
  dashboardLiveState.title=label;
  const description=dashboardLiveState.querySelector('.sr-only');if(description)description.textContent=label;
}
function mergeDashboardActivity(activity){
  if(!activity||typeof activity!=='object'||typeof activity.id!=='string')return;
  const merged=new Map(dashboardActivities.map(item=>[item.id,item]));
  merged.set(activity.id,activity);
  dashboardActivities=[...merged.values()];
  renderDashboard();
}
function renderDashboard(){
  const activities=dashboardActivities.sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0)).slice(0,40);
  const recent=document.querySelector('#dashboard-recent-list'),signals=document.querySelector('#dashboard-signal-list');
  const emptyRecent=document.querySelector('#dashboard-recent-empty'),emptySignals=document.querySelector('#dashboard-signal-empty');
  const historyToggle=document.querySelector('#dashboard-history-toggle');
  const filtered=dashboardFilter==='all'?activities:activities.filter(item=>item.type===dashboardFilter);
  document.querySelector('#dashboard-run-count').textContent=activities.length?(filtered.length===activities.length?activities.length:filtered.length+' de '+activities.length)+' local(is)':'Dados locais';
  historyToggle.hidden=!filtered.length;
  const clearButton=document.querySelector('#dashboard-clear');
  if(clearButton)clearButton.hidden=!activities.length;
  historyToggle.textContent=dashboardShowAll?'Mostrar recentes':'Ver histórico completo';
  historyToggle.setAttribute('aria-expanded',String(dashboardShowAll));
  ['scan','journey','api'].forEach(type=>{
    const label=document.querySelector('#dashboard-last-'+type),latest=activities.find(item=>item.type===type);
    if(label)label.textContent=latest?'Última execução '+dashboardTime(latest.createdAt):'Sem execuções recentes';
  });
  if(!activities.length){
    recent.innerHTML='';signals.innerHTML='';
    emptyRecent.hidden=false;emptySignals.hidden=false;
    // Sem execuções o radar mostra só a grade: nada de polígono sugerindo dados.
    const area=document.querySelector('.radar-area');if(area)area.style.opacity='0';
    document.querySelectorAll('.radar-dot').forEach(dot=>{dot.style.opacity='0'});
    for(const axis of ['http','performance','accessibility','dom','javascript']){
      const label=document.querySelector('#radar-value-'+axis);if(label)label.textContent='—';
    }
    document.querySelector('#dashboard-quality-index').textContent='—';
    document.querySelector('#dashboard-quality-label').textContent='Sem dados';
    document.querySelector('.radar-visual').setAttribute('aria-label','Mapa de qualidade sem dados');
    const accountBadge=document.querySelector('#dashboard-source');
    if(accountBadge)accountBadge.hidden=true;
    for(const id of ['errors','warnings']){
      const field=document.querySelector('#dashboard-'+id);if(field)field.textContent='0';
      const delta=document.querySelector('#dashboard-'+id+'-delta');
      if(delta){delta.className='quality-delta';delta.textContent=''}
    }
    return;
  }
  emptyRecent.hidden=filtered.length>0;emptySignals.hidden=true;
  recent.innerHTML=filtered.slice(0,dashboardShowAll?40:6).map(item=>{
    const meta=activityMeta(item),failed=item.status==='error';
    const href=dashboardEsc(item.href||'/');
    const performance=Number(item.scores?.performance),accessibility=Number(item.scores?.accessibility);
    const createdAt=new Date(item.createdAt||Date.now()),errors=Number(item.errors||0),warnings=Number(item.warnings||0);
    const title=dashboardEsc(item.title);
    // item.detail é o resultado ("200 OK", "1 falha(s)"), não o ambiente: ele
    // acompanha o título, e a coluna de ambiente mostra de fato o ambiente.
    return '<div class="dashboard-run"><span class="run-kind icon-'+meta.icon+'"><i></i></span><a class="run-title" href="'+href+'"><strong>'+title+'</strong><small>'+dashboardEsc(item.detail||meta.label)+'</small></a><span class="run-environment">Local</span><span class="run-status '+(failed?'error':'success')+'"><i></i>'+(failed?'ERRO':'SUCESSO')+'</span><span class="run-errors '+(errors?'has-value':'')+'">'+dashboardCount(errors,'erro','erros')+'</span><span class="run-warnings '+(warnings?'has-value':'')+'">'+dashboardCount(warnings,'aviso','avisos')+'</span><span class="run-score '+(Number.isFinite(performance)?'has-value':'')+'">'+dashboardScore(performance,'perf.')+'</span><span class="run-score '+(Number.isFinite(accessibility)?'has-value':'')+'">'+dashboardScore(accessibility,'acess.')+'</span><time datetime="'+createdAt.toISOString()+'" title="'+dashboardTime(item.createdAt)+'">'+createdAt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+'</time><span class="run-duration">'+dashboardDuration(item.durationMs)+'</span><a class="run-play" href="'+href+'" aria-label="Executar novamente '+title+'">▷</a><a class="run-action" href="'+href+'" aria-label="Abrir '+title+'">›</a></div>';
  }).join('');
  signals.innerHTML=activities.slice(0,7).map(item=>{
    const meta=activityMeta(item);
    const level=item.status==='error'?'error':Number(item.warnings||0)?'warning':'success';
    const label=level==='error'?'ERRO':level==='warning'?'AVISO':'SUCESSO';
    return '<a class="signal-event '+level+'" href="'+dashboardEsc(item.href||'/')+'"><time>'+new Date(item.createdAt||Date.now()).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+'</time><i></i><span><b>'+label+'</b><strong>'+dashboardEsc(item.title)+'</strong><small>'+dashboardEsc(item.detail||meta.label)+'</small></span></a>';
  }).join('');
  const axes=['http','performance','accessibility','dom','javascript'],values={};
  for(const axis of axes){
    const samples=activities.slice(0,12).map(item=>Number(item.scores?.[axis])).filter(Number.isFinite);
    values[axis]=samples.length?Math.round(samples.reduce((sum,value)=>sum+value,0)/samples.length):undefined;
    const label=document.querySelector('#radar-value-'+axis);if(label)label.textContent=values[axis]===undefined?'—':String(values[axis]);
  }
  const available=axes.map(axis=>values[axis]).filter(Number.isFinite),index=available.length?Math.round(available.reduce((sum,value)=>sum+value,0)/available.length):undefined;
  document.querySelector('#dashboard-quality-index').textContent=index===undefined?'—':String(index);
  document.querySelector('#dashboard-quality-label').textContent=index===undefined?'Sem dados':index>=85?'Excelente':index>=70?'Estável':index>=50?'Atenção':'Crítico';
  // A grade do SVG carrega a geometria; usá-la aqui garante que o vértice de um
  // eixo caia exatamente sobre o anel correspondente.
  const svg=document.querySelector('.radar-svg');
  if(svg){
    const center=Number(svg.dataset.radarCenter),maxRadius=Number(svg.dataset.radarRadius);
    const floor=Number(svg.dataset.radarFloor),span=Number(svg.dataset.radarSpan);
    const points=axes.map((axis,position)=>{
      const value=Math.max(0,Math.min(100,Number(values[axis])||0));
      const angle=(-90+position*72)*Math.PI/180,radius=maxRadius*(floor+span*value);
      const x=center+Math.cos(angle)*radius,y=center+Math.sin(angle)*radius;
      const dot=svg.querySelector('[data-radar-point="'+axis+'"]');
      if(dot){dot.setAttribute('cx',x.toFixed(1));dot.setAttribute('cy',y.toFixed(1));dot.style.opacity=Number.isFinite(values[axis])?'1':'0'}
      return x.toFixed(1)+','+y.toFixed(1);
    }).join(' ');
    svg.querySelector('.radar-area').setAttribute('points',points);
    svg.querySelector('.radar-area').style.opacity=available.length?'1':'0';
  }
  const axisNames={http:'HTTP',performance:'Performance',accessibility:'Acessibilidade',dom:'DOM',javascript:'JavaScript'};
  const axisSummary=axes.filter(axis=>Number.isFinite(values[axis])).map(axis=>axisNames[axis]+' '+values[axis]).join(', ');
  document.querySelector('.radar-visual').setAttribute('aria-label',index===undefined?'Mapa de qualidade sem dados':'Índice de qualidade '+index+' de 100'+(axisSummary?'. '+axisSummary:''));
  const day=86400000,elapsed=item=>Date.now()-Number(item.createdAt||0);
  const lastDay=activities.filter(item=>elapsed(item)<day),previousDay=activities.filter(item=>elapsed(item)>=day&&elapsed(item)<day*2);
  const totalOf=(list,field)=>list.reduce((sum,item)=>sum+Number(item[field]||0),0);
  const averageOf=(list,axis)=>{
    const samples=list.map(item=>Number(item.scores?.[axis])).filter(Number.isFinite);
    return samples.length?Math.round(samples.reduce((sum,value)=>sum+value,0)/samples.length):undefined;
  };
  // O delta só aparece quando existe janela anterior para comparar — sem isso não há variação real a mostrar.
  const setMetric=(id,current,previous)=>{
    const field=document.querySelector('#dashboard-'+id);
    if(!field)return;
    field.textContent=current===undefined?'—':String(current);
    const delta=document.querySelector('#dashboard-'+id+'-delta');
    if(!delta)return;
    const difference=current===undefined||previous===undefined?0:current-previous;
    delta.className='quality-delta'+(difference>0?' up':difference<0?' down':'');
    delta.textContent=difference?Math.abs(difference)+' vs 24h':'';
  };
  setMetric('errors',totalOf(lastDay,'errors'),previousDay.length?totalOf(previousDay,'errors'):undefined);
  setMetric('warnings',totalOf(lastDay,'warnings'),previousDay.length?totalOf(previousDay,'warnings'):undefined);
}
renderDashboard();
let dashboardStream;
if('EventSource' in window){
  dashboardStream=new EventSource('/api/dashboard/activity/events');
  dashboardStream.addEventListener('open',()=>setDashboardLiveState('connected','Sinal ao vivo conectado'));
  dashboardStream.addEventListener('message',event=>{
    try{mergeDashboardActivity(JSON.parse(event.data))}catch{}
  });
  dashboardStream.addEventListener('error',()=>setDashboardLiveState('connecting','Reconectando ao sinal ao vivo'));
  window.addEventListener('pagehide',()=>dashboardStream.close(),{once:true});
}else{
  setDashboardLiveState('offline','Atualização ao vivo indisponível neste navegador');
}
fetch('/api/dashboard/activity').then(async response=>{
  if(!response.ok)return;
  const data=await response.json();if(!Array.isArray(data.activities))return;
  const merged=new Map(dashboardActivities.map(item=>[item.id,item]));
  data.activities.forEach(item=>merged.set(item.id,item));
  dashboardActivities=[...merged.values()];renderDashboard();
}).catch(()=>{});
document.querySelectorAll('[data-dashboard-filter]').forEach(button=>button.addEventListener('click',()=>{
  dashboardFilter=button.dataset.dashboardFilter;
  dashboardShowAll=false;
  document.querySelectorAll('[data-dashboard-filter]').forEach(item=>item.classList.toggle('active',item===button));
  renderDashboard();
}));
document.querySelector('#dashboard-history-toggle')?.addEventListener('click',()=>{dashboardShowAll=!dashboardShowAll;renderDashboard()});
// Limpar o histórico precisa apagar as duas cópias. O localStorage é o que a
// lista lê primeiro, mas o servidor guarda a mesma coisa por navegador, atrás do
// cookie do dashboard, e devolve tudo no próximo carregamento — apagar só uma
// das duas faria as execuções voltarem sozinhas.
const dashboardClear=document.querySelector('#dashboard-clear');
dashboardClear?.addEventListener('click',async()=>{
  const source=document.querySelector('#dashboard-source'),hasAccount=Boolean(source)&&!source.hidden;
  const warning='Apagar '+dashboardCount(dashboardActivities.length,'execução','execuções')+' da Visão geral? A ação não tem volta.'+(hasAccount?'\n\nInclui as análises guardadas na sua conta, com os relatórios delas.':'');
  if(!confirm(warning))return;
  dashboardClear.disabled=true;
  try{localStorage.setItem(dashboardActivityKey,'[]')}catch{}
  try{await fetch('/api/dashboard/activity',{method:'DELETE'})}catch{}
  // Terceira cópia: a da conta. Era ela que fazia tudo voltar na recarga
  // seguinte, e por isso a confirmação avisa que ela também vai embora.
  if(hasAccount){try{await fetch('/api/v1/scans',{method:'DELETE'})}catch{}}
  dashboardActivities=[];
  dashboardShowAll=false;
  renderDashboard();
  dashboardClear.disabled=false;
});
window.addEventListener('storage',event=>{if(event.key===dashboardActivityKey){dashboardActivities=loadDashboardActivity();renderDashboard()}});

/**
 * Histórico da conta, quando existe.
 *
 * O localStorage continua sendo a fonte de quem não tem conta — e é o único
 * histórico possível nesse caminho, que é decisão de produto. Para quem entrou,
 * o servidor manda: é o que faz o histórico sobreviver a outro navegador, a uma
 * limpeza de cache e a um computador diferente. As duas listas se somam pelo id,
 * porque a mesma análise aparece nas duas e ela não pode ser listada duas vezes.
 */
function scanToActivity(scan){
  const report=scan.report||{},summary=report.summary||{};
  const errors=Number(summary.errors||0),warnings=Number(summary.warnings||0);
  let target=String(report.url||scan.url||'Inspeção');
  try{const url=new URL(target);target=url.host+url.pathname}catch{}
  return {
    id:scan.id,
    type:'scan',
    title:'Inspeção · '+target,
    detail:scan.status==='completed'?dashboardCount(errors,'erro','erros')+' · '+dashboardCount(warnings,'aviso','avisos'):scan.status,
    status:scan.status!=='completed'?'error':report.passed===false?'error':'success',
    errors,
    warnings,
    durationMs:Number(report.durationMs||0),
    createdAt:scan.createdAt,
    href:'/scanner',
    scores:{},
  };
}
async function loadAccountHistory(){
  try{
    const response=await fetch('/api/v1/scans');
    // 401 é o caminho anônimo, não uma falha: segue só com o histórico local.
    if(!response.ok)return;
    const scans=(await response.json()).scans||[];
    const source=document.querySelector('#dashboard-source');
    if(source)source.hidden=false;
    if(!scans.length)return;
    const seen=new Set(dashboardActivities.map(item=>item.id));
    dashboardActivities=[...dashboardActivities,...scans.filter(scan=>!seen.has(scan.id)).map(scanToActivity)]
      .sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
    renderDashboard();
  }catch{}
}
void loadAccountHistory();
`;
