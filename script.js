"use strict";
// Entirely local visual simulation. No AI calls or real code execution.
(() => {
 const $=id=>document.getElementById(id);
 const ui={arch:$('architectPanel'),ops:$('leftPanel'),agents:$('agentsPanel'),oracle:$('oraclePanel'),done:$('rightPanel'),files:$('filesPanel')};
 const taskList=$('taskQueue'),doneList=$('resultList'),fileList=$('fileList');
 const names=['neo','trinity','morpheus'];
 const specs={
 neo:{match:/api|backend|server|cache|database|query|data/i,problem:'Fix cache mismatch',code:['const entry = cache.get(key);','if (!entry) await rebuild();','const patch = validate(data);','await store.commit(patch);']},
 trinity:{match:/css|style|ui|screen|button|layout|component|front|design/i,problem:'Repair UI state',code:['const view = render(state);','bindAction("save", commit);','layout.fit(container);','return reconcile(view);']},
 morpheus:{match:/test|auth|secure|network|route|login|integrat|protocol/i,problem:'Repair auth timeout',code:['const session = verify(token);','await retry(connection);','assert.equal(status, 200);','return tests.run(suite);']}
 };
 const workers=Object.fromEntries(names.map(name=>[name,{job:null,status:$(name+'-status'),bar:$(name+'-prog'),code:$(name+'-prog').closest('.agent-card').querySelector('.code-lines')} ]));
 const jobs=[],ops=[],completed=[],files=[],timers=[],packets=[];
 let time=0,last=performance.now(),paused=false,serial=0,opsIncoming=false,doneIncoming=false,uiStamp=-Infinity,codeStamp=-Infinity,zionStarted=-Infinity,zionLatest=null;
 const BOX=62,GAP=8,STEP=BOX+GAP;
 const ORACLE_CONCURRENCY=3;
 const metrics={ops:0,done:0,files:0};
 const paths={},routes={};
 const SVG='http://www.w3.org/2000/svg';
 const svg=document.createElementNS(SVG,'svg');svg.id='transmission';svg.setAttribute('aria-hidden','true');document.body.append(svg);
 const routeNames=['archOps','opsAgent','agentOps','opsOracle','oracleDone','doneArch','doneFiles'];
 for(const id of routeNames){const path=document.createElementNS(SVG,'path');path.classList.add('tx-line');svg.append(path);paths[id]=path;}
 function summary(panel){const e=document.createElement('div');e.className='panel-summary';panel.append(e);return e;}
 const countOps=summary(ui.ops),countDone=summary(ui.done),countFiles=summary(ui.files),countOracle=summary(ui.oracle);
 $('history').replaceChildren();taskList.replaceChildren();doneList.replaceChildren();fileList.replaceChildren();
 $('micBtn').textContent='SIM';$('micBtn').title='Local simulation — use the text input';$('micBtn').removeAttribute('tabindex');$('micBtn').removeAttribute('role');$('micBtn').setAttribute('aria-label','Simulation mode');
 // Three stable inspection windows fill the Oracle's available square.
 const inspectors=[];$('oracleFeed').replaceChildren();
 for(let i=0;i<ORACLE_CONCURRENCY;i++){
  const el=document.createElement('div');el.className='inspection-slot card';el.dataset.slot=String(i+1);
  const heading=document.createElement('div');heading.className='inspection-heading';
  const title=document.createElement('span'),percent=document.createElement('span');heading.append(title,percent);
  const status=document.createElement('div');status.className='inspection-status';
  const meter=document.createElement('div');meter.className='flow-meter';const bar=document.createElement('i');meter.append(bar);
  const code=document.createElement('div');code.className='inspection-code';el.append(heading,status,meter,code);$('oracleFeed').append(el);
  inspectors.push({job:null,el,title,percent,status,bar,code});
 }
 // Zion's activity window sits directly under the title, ABOVE its file list.
 const zionWindow=document.createElement('div');zionWindow.className='zion-activity';
 const zionHeading=document.createElement('div');zionHeading.className='activity-heading';zionHeading.textContent='FILE PROCESSING';
 const zionCode=document.createElement('div');zionWindow.append(zionHeading,zionCode);ui.files.insertBefore(zionWindow,fileList);
 function log(text,user=false){const h=$('history'),follow=h.scrollHeight-h.scrollTop-h.clientHeight<30;const d=document.createElement('div');d.className='history-entry'+(user?' user':'');d.textContent=text;h.append(d);while(h.children.length>300)h.firstChild.remove();if(follow)h.scrollTop=h.scrollHeight;}
 function later(delay,fn){timers.push({at:time+delay,fn});}
 const random=(a,b)=>a+Math.random()*(b-a),duration=()=>random(5000,15000);
 const fraction=j=>Math.min(1,Math.max(0,(time-j.start)/j.duration));
 // Count queued assignments, not just the job already on a coding card.
 function choose(text,previous){
  const activeStates=new Set(['thinking','awaitOps','toOps','waiting','toWorker','coding','fromWorker']);
  const candidates=previous?names.filter(name=>name!==previous):[...names];
  const workload=candidates.map(name=>({name,count:jobs.filter(job=>job.agent===name&&activeStates.has(job.state)).length}));
  const lowest=Math.min(...workload.map(worker=>worker.count));
  const tied=workload.filter(worker=>worker.count===lowest);
  return tied[Math.floor(Math.random()*tied.length)].name;
 }
 function port(el,side,f){const r=el.getBoundingClientRect();return{x:side==='left'?r.left:r.right,y:r.top+r.height*f};}
 function makeRoute(id){let s,t,x;switch(id){
 case 'archOps':s=port(ui.arch,'left',.8);t=port(ui.ops,'right',.92);x=t.x+26;break;
 case 'opsAgent':s=port(ui.ops,'left',.65);t=port(ui.agents,'right',.5);x=(s.x+t.x)/2;break;
 case 'agentOps':s=port(ui.agents,'right',.62);t=port(ui.ops,'left',.35);x=(s.x+t.x)/2-10;break;
 case 'opsOracle':s=port(ui.ops,'right',.08);t=port(ui.oracle,'left',.5);x=s.x+26;break;
 case 'oracleDone':s=port(ui.oracle,'right',.5);t=port(ui.done,'left',.08);x=(s.x+t.x)/2;break;
 case 'doneArch':s=port(ui.done,'left',.92);t=port(ui.arch,'right',.75);x=s.x-26;break;
 case 'doneFiles':s=port(ui.done,'right',.92);t=port(ui.files,'left',.1);x=(s.x+t.x)/2;break;
 }const points=[s,{x,y:s.y},{x,y:t.y},t];const lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y));return{points,lengths,total:lengths.reduce((a,b)=>a+b,0)};}
 function layout(){metrics.ops=taskList.clientHeight;metrics.done=doneList.clientHeight;metrics.files=fileList.clientHeight;for(const id of routeNames){routes[id]=makeRoute(id);paths[id].setAttribute('d',routes[id].points.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join(' '));}for(const j of ops)j.y=Math.min(j.y,Math.max(0,metrics.ops-BOX));for(const j of completed)j.y=Math.min(j.y,Math.max(0,metrics.done-BOX));renderFiles();renderActivity();}
 function transfer(id,callback){const el=document.createElement('div');el.className='packet';$('packetLayer').append(el);packets.push({id,el,start:time,callback});}
 function animatePackets(){for(let i=packets.length-1;i>=0;i--){const p=packets[i],t=Math.min(1,(time-p.start)/850),r=routes[p.id];let dist=t*r.total,at=r.points[0];for(let k=0;k<r.lengths.length;k++){const len=r.lengths[k];if(dist<=len){const q=len?dist/len:1;at={x:r.points[k].x+(r.points[k+1].x-r.points[k].x)*q,y:r.points[k].y+(r.points[k+1].y-r.points[k].y)*q};break;}dist-=len;at=r.points[k+1];}p.el.style.transform=`translate3d(${at.x-4}px,${at.y-5}px,0)`;p.el.style.opacity=Math.floor((time-p.start)/180)%2?'.3':'1';if(t===1){p.el.remove();packets.splice(i,1);p.callback();}}}
 function createCard(j){const e=document.createElement('div');e.className='flow-card card';e.dataset.operation=j.id;for(const cls of ['job-id','problem','stage']){const child=document.createElement('div');child.className=cls;e.append(child);}const meter=document.createElement('div');meter.className='flow-meter';meter.append(document.createElement('i'));e.append(meter);return e;}
 function label(e,j,stage,pct){e.children[0].textContent=j.id+(j.attempt>1?' · R'+(j.attempt-1):'');e.children[1].textContent=j.problem;e.children[2].textContent=stage;e.lastChild.firstChild.style.width=Math.round(pct*100)+'%';e.classList.toggle('fail',j.pass===false&&e.parentElement===doneList);e.title=j.id+' — '+j.problem+' — '+stage;}
 function submit(){const text=$('chatInput').value.trim();if(!text)return;$('chatInput').value='';log('You: '+text,true);const agent=choose(text);const category=names.find(n=>specs[n].match.test(text))||agent;const j={id:'OP-'+(++serial).toString(16).toUpperCase().padStart(3,'0'),text,problem:specs[category].problem,agent,attempt:1,state:'thinking',pass:null};jobs.push(j);log('Architect: Analyzing '+j.id+'…');later(random(1800,3000),()=>{j.state='awaitOps';log('Architect: '+j.id+' assigned to '+j.agent.toUpperCase()+'.');});}
 function admitOperations(){if(opsIncoming||metrics.ops<BOX)return;const bottom=metrics.ops-BOX,tail=ops.at(-1);if(tail&&tail.y>bottom-STEP)return;const j=jobs.find(j=>j.state==='awaitOps');if(!j)return;opsIncoming=true;j.state='toOps';transfer('archOps',()=>{opsIncoming=false;j.state='waiting';j.y=Math.max(0,metrics.ops-BOX);j.opEl=createCard(j);taskList.append(j.opEl);ops.push(j);});}
 function assignWorkers(){for(const n of names){if(workers[n].job)continue;const j=ops.find(j=>j.state==='waiting'&&j.agent===n);if(!j)continue;workers[n].job=j;j.state='toWorker';transfer('opsAgent',()=>{j.state='coding';j.start=time;j.duration=duration();log(n.toUpperCase()+': Coding '+j.id+'.');});}}
 function inspect(){for(let i=0;i<inspectors.length;i++){const slot=inspectors[i];if(slot.job)continue;const j=jobs.filter(j=>j.state==='oracleQueue').sort((a,b)=>a.oracleArrival-b.oracleArrival)[0];if(!j)break;slot.job=j;j.state='inspect';j.start=time;j.duration=duration();slot.el.dataset.active='true';slot.el.dataset.operation=j.id;log('Oracle '+(i+1)+': Inspecting '+j.id+'.');}}
 function admitCompleted(){if(doneIncoming||metrics.done<BOX)return;const tail=completed.at(-1);if(tail&&tail.y<STEP)return;const j=jobs.filter(j=>j.state==='verdict').sort((a,b)=>a.verdictAt-b.verdictAt)[0];if(!j)return;doneIncoming=true;j.state='toDone';transfer('oracleDone',()=>{doneIncoming=false;j.state='descending';j.start=time;j.duration=4000;j.y=0;j.doneEl=createCard(j);doneList.append(j.doneEl);completed.push(j);});}
 function routeResult(j){j.state='branch';transfer(j.pass?'doneFiles':'doneArch',()=>{if(j.pass){j.state='filed';const entry={id:j.id,problem:j.problem,name:j.id.toLowerCase()+'.js',attempt:j.attempt};files.unshift(entry);zionLatest=entry;zionStarted=time;log('Zion: '+j.id+' fake file created.');renderFiles();renderActivity();}else{j.state='thinking';j.attempt++;j.agent=choose(j.text,j.agent);log('Architect: '+j.id+' returned for rework → '+j.agent.toUpperCase()+'.');later(1800,()=>{j.pass=null;j.state='awaitOps';});}});}
 function updateState(){admitOperations();assignWorkers();inspect();admitCompleted();for(const j of jobs){if(j.state==='coding'&&fraction(j)>=1){j.state='fromWorker';transfer('agentOps',()=>{workers[j.agent].job=null;j.state='ready';log('Operations: '+j.id+' coding complete.');});}}
  for(const slot of inspectors){const j=slot.job;if(j&&fraction(j)>=1){slot.job=null;slot.el.dataset.active='false';delete slot.el.dataset.operation;j.pass=j.attempt>=3||Math.random()<.75;j.state='verdict';j.verdictAt=time;log('Oracle: '+j.id+' '+(j.pass?'PASS.':'FAIL — rework required.'));}}
 }
 function moveCards(dt){let upper=-STEP;const bottom=Math.max(0,metrics.ops-BOX);for(let i=0;i<ops.length;i++){const j=ops[i];const p=j.state==='coding'?.85*fraction(j):j.state==='fromWorker'?.85:j.state==='ready'?1:0;const target=Math.min(bottom,Math.max(upper+STEP,bottom*(1-p)));const speed=Math.max(40,bottom/(j.duration||10000)*1000)*dt/1000;j.y=Math.max(target,j.y-speed);upper=j.y;j.opEl.style.transform=`translate3d(0,${j.y.toFixed(3)}px,0)`;if(j.state==='ready'&&j.y<=.1){j.opEl.remove();ops.splice(i--,1);j.opEl=null;j.state='toOracle';transfer('opsOracle',()=>{j.state='oracleQueue';j.oracleArrival=time;});}}
 let lower=metrics.done+GAP;const floor=Math.max(0,metrics.done-BOX);for(let i=0;i<completed.length;i++){const j=completed[i];const target=Math.max(0,Math.min(floor,lower-STEP,floor*fraction(j)));j.y=Math.min(target,j.y+Math.max(45,floor/4)*dt/1000);lower=j.y;j.doneEl.style.transform=`translate3d(0,${j.y.toFixed(3)}px,0)`;if(j.y>=floor-.1&&fraction(j)>=1){j.doneEl.remove();completed.splice(i--,1);j.doneEl=null;routeResult(j);}}
 }
 function renderFiles(){fileList.replaceChildren();const cap=Math.max(0,Math.floor(metrics.files/STEP));files.slice(0,cap).forEach((f,i)=>{const e=createCard(f);e.style.transform=`translate3d(0,${i*STEP}px,0)`;label(e,f,'SIMULATED FILE',1);e.children[1].textContent=f.name;fileList.append(e);});countFiles.textContent=files.length+' fake files'+(files.length>cap?' · '+cap+' shown':'');}
 function renderText(){for(const j of ops){const state=j.state==='waiting'?'QUEUED · '+j.agent.toUpperCase():j.state==='coding'?j.agent.toUpperCase()+' · '+Math.round(fraction(j)*100)+'%':j.state==='ready'?'CODE READY':j.state==='fromWorker'?'CODE RETURNING':'ASSIGNING';label(j.opEl,j,state,j.state==='coding'?fraction(j):j.state==='ready'||j.state==='fromWorker'?1:0);}for(const j of completed)label(j.doneEl,j,j.pass?'PASS · TO ZION':'FAIL · TO ARCHITECT',1);
 const waiting=jobs.filter(j=>j.state==='awaitOps'||j.state==='toOps').length;countOps.textContent=ops.length+' active'+(waiting?' · '+waiting+' queued':'');countDone.textContent=completed.length+' routing · '+jobs.filter(j=>j.state==='verdict'||j.state==='toDone').length+' waiting';
 const queued=jobs.filter(j=>j.state==='oracleQueue').length;countOracle.textContent=inspectors.filter(s=>s.job).length+'/'+ORACLE_CONCURRENCY+' inspecting · '+queued+' queued';
 for(let i=0;i<inspectors.length;i++){const slot=inspectors[i],j=slot.job,p=j?fraction(j):0;slot.title.textContent=j?j.id+' · QC '+(i+1):'QC '+(i+1)+' · AVAILABLE';slot.percent.textContent=j?Math.round(p*100)+'%':'IDLE';slot.status.textContent=j?j.problem+' · '+['Syntax review','Dependency check','Quality assessment'][Math.min(2,Math.floor(p*3))]:'Ready for completed code';slot.bar.style.width=(p*100)+'%';}
 for(const n of names){const w=workers[n],j=w.job;w.status.textContent=j?j.id+' · '+(j.state==='coding'?'CODING':'TRANSFER'):'Status: IDLE';w.bar.style.width=(j?j.state==='coding'?fraction(j)*100:100:0)+'%';}
 document.querySelector('.architect-process-indicator').classList.toggle('thinking',!paused&&jobs.some(j=>j.state==='thinking'));
 }
 function fillCode(container,lines,cap,cls){const count=Math.max(0,Math.min(cap,lines.length));while(container.children.length>count)container.lastChild.remove();while(container.children.length<count){const e=document.createElement('div');e.className=cls;container.append(e);}for(let i=0;i<count;i++)if(container.children[i].textContent!==lines[i])container.children[i].textContent=lines[i];}
 function renderActivity(){const tick=Math.floor(time/650);
 for(const n of names){const w=workers[n],j=w.job,content=j?['// '+j.id+' · '+j.problem,...specs[n].code.map((_,i,a)=>a[(tick+i)%a.length])]:['// '+n.toUpperCase()+' ready','// waiting for assignment'];fillCode(w.code,content,Math.floor((w.code.clientHeight-8)/17),'code-line');}
 for(let i=0;i<inspectors.length;i++){const slot=inspectors[i],j=slot.job;let lines;if(j){const checks=['parse(source);','validate(dependencies);','assert(tests.passed);','review(edge_cases);','check(output.schema);','verify(code.quality);'];lines=['> inspect("'+j.id+'");',...checks.map((_,k,a)=>'> '+a[(tick+k+i)%a.length]),'> verdict.pending();'];}else lines=['> quality_gate.ready();','> awaiting operation...','> inspector: IDLE'];fillCode(slot.code,lines,Math.floor((slot.code.clientHeight-3)/13),'activity-line');}
 let zionLines;if(zionLatest&&time-zionStarted<4000){const phases=['receiving approved output...','packaging operation...','creating '+zionLatest.name+'...','file registered: READY'];zionLines=['> operation: '+zionLatest.id,'> '+phases[Math.min(3,Math.floor((time-zionStarted)/1000))],'> directory: /zion/output','> mode: SIMULATION'];}else zionLines=['> file_control.ready();','> registered files: '+files.length,'> awaiting approved code...','> mode: SIMULATION'];fillCode(zionCode,zionLines,4,'activity-line');
 }
 $('sendBtn').addEventListener('click',submit);$('chatInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit();}});
 $('pauseBtn').addEventListener('click',()=>{paused=!paused;$('pauseBtn').textContent=paused?'Resume Agents':'Pause Agents';log('System: Simulation '+(paused?'paused.':'resumed.'));renderText();});
 const backdrop=$('modalBackdrop'),settings=$('openSettings'),fields=[...backdrop.querySelectorAll('select,input:not([type=range])')];let volumeBefore=0.25;
 for(const field of fields){field.disabled=true;field.title='Display only — simulation does not call a model';}
 const volume=$('volumeSlider'),audio=$('backgroundAudio'),mute=$('muteBtn');let muted=false,started=false,starting=false;
 audio.volume=Number(volume.value);mute.textContent='Mute';
 function updateVolume(){audio.volume=Number(volume.value);$('volumePercent').textContent=Math.round(audio.volume*100)+'%';}updateVolume();
 function startAudio(){if(started||starting||muted)return;starting=true;audio.muted=false;audio.play().then(()=>{started=true;starting=false;}).catch(()=>{starting=false;});}
 for(const event of ['click','keydown','touchstart'])document.addEventListener(event,e=>{if(e.target!==mute)startAudio();},{passive:true});
 mute.addEventListener('click',()=>{muted=!muted;audio.muted=muted;mute.textContent=muted?'Unmute':'Mute';if(!muted)startAudio();});volume.addEventListener('input',updateVolume);
 function closeSettings(){backdrop.classList.remove('open');settings.focus();}
 settings.addEventListener('click',()=>{volumeBefore=audio.volume;backdrop.classList.add('open');$('modalCancel').focus();});
 $('modalCancel').addEventListener('click',()=>{volume.value=String(volumeBefore);updateVolume();closeSettings();});$('modalSave').addEventListener('click',closeSettings);
 document.addEventListener('keydown',e=>{if(!backdrop.classList.contains('open'))return;if(e.key==='Escape')$('modalCancel').click();if(e.key==='Tab'){const focus=[...backdrop.querySelectorAll('button,input:not(:disabled),select:not(:disabled)')],first=focus[0],last=focus.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
 window.addEventListener('resize',layout);const observer=new ResizeObserver(layout);observer.observe(taskList);observer.observe($('oracleFeed'));
 layout();renderText();renderActivity();log('Architect: Ready. Balanced assignment and three Oracle inspectors online.');
 function frame(now){const elapsed=Math.max(0,now-last);last=now;const dt=paused?0:elapsed;time+=dt;if(!paused){for(let i=timers.length-1;i>=0;i--)if(timers[i].at<=time){const t=timers.splice(i,1)[0];t.fn();}animatePackets();updateState();moveCards(dt);}if(time-uiStamp>=180){renderText();uiStamp=time;}if(time-codeStamp>=650){renderActivity();codeStamp=time;}requestAnimationFrame(frame);}requestAnimationFrame(frame);
})();

// Matrix Rain Animation — supplied algorithm and values, unchanged.
(function () {
    var matrixCanvas = document.getElementById("matrixCanvas");
    if (!matrixCanvas) return;
    var ctx = matrixCanvas.getContext("2d");
    matrixCanvas.width = window.innerWidth;
    matrixCanvas.height = window.innerHeight;
    var matrixChars =
        "0矩阵A7代码@协2议访问#9系统安F全4数据网$络1终端用Z户8连接!加密3解密%上传6下K载5&";
    matrixChars = matrixChars.split("");
    var fontSize = 14;
    var columns = Math.floor(matrixCanvas.width / fontSize);
    var drops = [];
    for (var i = 0; i < columns; i++) {
        drops[i] =
            Math.floor(Math.random() * (matrixCanvas.height / fontSize)) -
            Math.floor(matrixCanvas.height / fontSize);
    }
    function draw() {
        ctx.fillStyle = "rgba(2,8,10,0.05)";
        ctx.fillRect(0, 0, matrixCanvas.width, matrixCanvas.height);
        ctx.font = fontSize + 'px Consolas,Mono,"Courier New",monospace';
        for (var i = 0; i < drops.length; i++) {
            var text =
                matrixChars[Math.floor(Math.random() * matrixChars.length)];
            var y = drops[i] * fontSize;
            if (y >= 0) {
                ctx.fillStyle = "rgba(0,255,255,0.7)";
                ctx.fillText(text, i * fontSize, y);
            }
            drops[i]++;
            if (y > matrixCanvas.height && Math.random() > 0.95) {
                drops[i] = Math.floor(Math.random() * -20) - 1;
            }
        }
    }
    setInterval(draw, 85);
})();
