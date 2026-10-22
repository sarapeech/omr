/* ตรวจข้อสอบ OMR — app v2 */
'use strict';
const APP_VERSION = '2.1.0';
const TH = ['ก','ข','ค','ง','จ'];
const LET = 'ABCDE';
const VER_TH = ['ก','ข','ค','ง'];
const LIKERT_TEXT = {5:'มากที่สุด',4:'มาก',3:'ปานกลาง',2:'น้อย',1:'น้อยที่สุด'};

/* ---------------- utilities ---------------- */
const $ = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>[...el.querySelectorAll(s)];
const esc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const tick = ()=>new Promise(r=>setTimeout(r,0));
const r2 = v => Math.round(v*100)/100;
function uidNew(p){ return p+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function toast(msg){ const t=document.createElement('div'); t.className='toast'; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),3000); }
function safeName(s){ return String(s).replace(/[\\/:*?"<>|]/g,'_').slice(0,60); }
async function copyText(t,msg){
  try{ await navigator.clipboard.writeText(t); toast(msg||'คัดลอกแล้ว'); }
  catch(e){ const ta=document.createElement('textarea'); ta.value=t; ta.style.cssText='position:fixed;left:16px;right:16px;bottom:16px;height:40vh;z-index:70'; document.body.appendChild(ta); ta.select(); toast('กดค้างแล้วเลือกคัดลอก'); ta.onblur=()=>ta.remove(); }
}
function saveFile(name,data){
  const blob = data instanceof Blob ? data : new Blob([data],{type:/\.csv$/.test(name)?'text/csv;charset=utf-8':/\.json$/.test(name)?'application/json':'application/octet-stream'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),8000);
}
function csvCell(v,sep){ v=String(v==null?'':v); return (v.includes(sep)||v.includes('"')||v.includes('\n'))?'"'+v.replace(/"/g,'""')+'"':v; }
function toCsv(rows,sep=','){ return '﻿'+rows.map(r=>r.map(v=>csvCell(v,sep)).join(sep)).join('\r\n'); }

/* ---------------- settings, roster ---------------- */
function randToken(){ const a=new Uint8Array(9); crypto.getRandomValues(a); return 'omr-'+[...a].map(b=>b.toString(36).padStart(2,'0')).join('').slice(0,14); }
const Settings = (()=>{ let s={}; try{ s=JSON.parse(localStorage.getItem('omr-settings')||'{}'); }catch(e){}
  return Object.assign({url:'', token:'', auto:true, sheetName:'', iosHintOff:false, camId:'', sens:1, scriptVer:0, ocr:true}, s); })();
if(!Settings.token) Settings.token=randToken();
function saveSettings(){ try{ localStorage.setItem('omr-settings', JSON.stringify(Settings)); }catch(e){} }
saveSettings();

const Roster = {
  list:[], map:new Map(),
  load(){ try{ this.list=JSON.parse(localStorage.getItem('omr-roster')||'[]'); }catch(e){ this.list=[]; } this.index(); },
  save(){ try{ localStorage.setItem('omr-roster', JSON.stringify(this.list)); }catch(e){ toast('พื้นที่เก็บข้อมูลในเครื่องเต็ม'); } this.index(); },
  index(){ this.map=new Map(this.list.map(s=>[s.sid,s])); },
  get(sid){ return sid?this.map.get(sid):null; },
  sections(){ return [...new Set(this.list.map(s=>s.sec).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th',{numeric:true})); },
  suggest(sid){
    if(!this.list.length||!sid) return [];
    const pat=String(sid);
    const out=[];
    for(const s of this.list){
      if(s.sid.length!==pat.length) continue;
      let d=0; for(let i=0;i<pat.length;i++){ if(pat[i]!=='?'&&pat[i]!==s.sid[i]) d++; if(d>1) break; }
      const unknown=(pat.match(/\?/g)||[]).length;
      if(d+0<=1 && (d===1||unknown>0)) out.push(s);
      if(out.length>=4) break;
    }
    return out;
  }
};
Roster.load();

/* paste from Excel / sheet rows -> [{sid,name,sec}] */
function parseRoster(input){
  const rows = Array.isArray(input) ? input.map(r=>r.map(c=>String(c==null?'':c).trim())) :
    String(input).split(/\r?\n/).map(l=>l.replace(/\s+$/,'')).filter(l=>l.trim()).map(l=>{
      if(l.includes('\t')) return l.split('\t').map(c=>c.trim());
      if(l.includes(',')) return l.split(',').map(c=>c.trim());
      const m=l.trim().match(/^(\d{4,})\s+(.+?)(?:\s+(\S{1,4}))?$/);
      if(m){ const sec=m[3]&&/\d/.test(m[3])?m[3]:''; return [m[1], sec?m[2]:(m[2]+(m[3]?' '+m[3]:'')), sec]; }
      return [l.trim()];
    });
  if(!rows.length) return [];
  const nc=Math.max(...rows.map(r=>r.length));
  const col=i=>rows.map(r=>r[i]||'');
  let sidCol=-1, best=0;
  for(let i=0;i<nc;i++){ const v=col(i), f=v.filter(x=>/^\d{5,}$/.test(x)).length/v.length; if(f>best){ best=f; sidCol=i; } }
  if(sidCol<0||best<0.3) return [];
  const data=rows.filter(r=>/^\d{5,}$/.test(r[sidCol]||''));
  const n=data.length;
  // a header row above the data tells which column is which
  const hdr=rows.slice(0,rows.indexOf(data[0])).pop()||[];
  const hName=i=>String(hdr[i]||'').toLowerCase();
  const isSeq=v=>v.length>=3&&v.every((x,j)=>+x===+v[0]+j);
  let secCol=hdr.findIndex((h,i)=>i!==sidCol&&/หมู่|กลุ่ม|section|sec\b|ห้อง/.test(String(h).toLowerCase()));
  if(secCol<0) for(let i=nc-1;i>=0;i--){
    if(i===sidCol||/ลำดับ|^ที่$|^no\.?$/.test(hName(i))) continue;
    const v=data.map(r=>r[i]||''), filled=v.filter(Boolean);
    if(filled.length<n*0.7||isSeq(filled)) continue;
    const shortNum=filled.filter(x=>x.length<=4&&/\d/.test(x)).length/filled.length;
    const distinct=new Set(filled).size;
    if(shortNum>0.8&&distinct<=Math.max(10,n/5)){ secCol=i; break; }
  }
  const nameCols=[];
  for(let i=0;i<nc;i++){
    if(i===sidCol||i===secCol||/ลำดับ|^ที่$|^no\.?$|อีเมล|email|โทร/.test(hName(i))) continue;
    const v=data.map(r=>r[i]||'').filter(Boolean);
    if(!v.length) continue;
    if(v.filter(x=>/^[\d.\s]+$/.test(x)).length/v.length>0.6) continue;   // running numbers, scores
    if(v.filter(x=>/@/.test(x)).length/v.length>0.5) continue;           // e-mail
    nameCols.push(i);
  }
  const TITLE=/^(นาย|นาง|นางสาว|น\.ส\.|ด\.ช\.|ด\.ญ\.|เด็กชาย|เด็กหญิง|ว่าที่ร้อยตรี|Mr\.?|Mrs\.?|Ms\.?|Miss)$/;
  const joinName=parts=>parts.reduce((acc,p)=>acc+(acc&&!TITLE.test(acc.split(' ').pop()||'')?' ':'')+p,'').replace(/\s+/g,' ').trim();
  return data.map(r=>({ sid:r[sidCol], name:joinName(nameCols.map(i=>r[i]).filter(Boolean)), sec:secCol>=0?(r[secCol]||''):'' }));
}

/* ---------------- storage ---------------- */
const Store = {
  async init(){ try{ if(navigator.storage&&navigator.storage.persist) await navigator.storage.persist(); }catch(e){} },
  all(){ try{ return JSON.parse(localStorage.getItem('omr-exams')||'[]'); }catch(e){ return []; } },
  put(list){ try{ localStorage.setItem('omr-exams', JSON.stringify(list)); }catch(e){ toast('พื้นที่เก็บข้อมูลในเครื่องเต็ม'); } },
  async save(ex){ ex.updatedAt=Date.now(); const l=this.all().filter(x=>x.id!==ex.id); l.push(JSON.parse(JSON.stringify(ex))); this.put(l); },
  async remove(id){ this.put(this.all().filter(x=>x.id!==id)); }
};
const ImgStore = {
  db:null,
  open(){ if(this.db) return Promise.resolve(this.db);
    return new Promise((res,rej)=>{ const r=indexedDB.open('omr-img',1); r.onupgradeneeded=()=>r.result.createObjectStore('img'); r.onsuccess=()=>{ this.db=r.result; res(this.db); }; r.onerror=()=>rej(r.error); }); },
  async run(mode,fn){ const db=await this.open(); return new Promise((res,rej)=>{ const t=db.transaction('img',mode); const req=fn(t.objectStore('img')); t.oncomplete=()=>res(req&&req.result); t.onerror=()=>rej(t.error); }); },
  async put(k,v){ try{ await this.run('readwrite',s=>s.put(v,k)); }catch(e){} },
  async get(k){ try{ return await this.run('readonly',s=>s.get(k)); }catch(e){ return null; } },
  async del(k){ try{ await this.run('readwrite',s=>s.delete(k)); }catch(e){} }
};

/* ---------------- exam model ---------------- */
function newExam(kind,name){
  const survey=kind==='survey';
  return { id:uidNew('exam_'), kind, name, numQ:survey?20:60, choices:5, idDigits:survey?0:11, versions:1,
    keys:[[]], weightRules:[], sections:[], results:[], deletes:[], createdAt:Date.now() };
}
function migrate(ex){
  if(!ex.kind) ex.kind='exam';
  if(typeof ex.key==='string'){ ex.keys=[[...ex.key].map(c=>LET.includes(c)?c:'')]; delete ex.key; }
  if(!Array.isArray(ex.keys)||!ex.keys.length) ex.keys=[[]];
  ex.choices=ex.choices||5; ex.idDigits=ex.idDigits==null?11:ex.idDigits; ex.versions=ex.versions||1;
  ex.weightRules=ex.weightRules||[]; ex.sections=ex.sections||[]; ex.deletes=ex.deletes||[]; ex.results=ex.results||[];
  ex.results.forEach((r,i)=>{ if(r.ver==null) r.ver=0; if(ex.kind==='survey'&&!r.no) r.no=i+1; });
  return ex;
}
const isSurvey = ex => ex.kind==='survey';
function labels(ex){ return isSurvey(ex)?['5','4','3','2','1']:ex.choices===2?['ถ','ผ']:TH.slice(0,ex.choices); }
function ansLabel(ex,c){ const i=LET.indexOf(c); return i>=0?labels(ex)[i]:c==='*'?'หลายข้อ':''; }
function keyOf(ex,v){ const k=(ex.keys[v]||[]).slice(0,ex.numQ); while(k.length<ex.numQ) k.push(''); return k; }
function keyLabel(ex,k){ return !k?'':k==='*'?'ทุกคำตอบ':[...k].map(c=>ansLabel(ex,c)).join('/'); }
function weights(ex){
  const w=new Array(ex.numQ).fill(1);
  (ex.weightRules||[]).forEach(r=>{ for(let q=Math.max(1,r.from);q<=Math.min(ex.numQ,r.to);q++) w[q-1]=+r.pts||0; });
  return w;
}
function verOf(ex,r){ return ex.versions>1 ? r.ver : 0; }
function maxScore(ex,v=0){ const k=keyOf(ex,Math.max(0,v)), w=weights(ex); let m=0; k.forEach((x,q)=>{ if(x) m+=w[q]; }); return r2(m); }
function keyFilled(ex,v=0){ return keyOf(ex,v).filter(Boolean).length; }
function isRight(k,a){ return !!k && (k==='*' || (LET.includes(a) && k.includes(a))); }
function scoreOf(ex,r){
  if(isSurvey(ex)) return null;
  const v=verOf(ex,r); if(v==null||v<0) return null;
  const k=keyOf(ex,v), w=weights(ex); let s=0;
  for(let q=0;q<ex.numQ;q++) if(isRight(k[q],r.ans[q])) s+=w[q];
  return r2(s);
}
function valueOf(ex,c){ const i=LET.indexOf(c); return i>=0?ex.choices-i:null; }
function respMean(ex,r){ const v=[...r.ans.slice(0,ex.numQ)].map(c=>valueOf(ex,c)).filter(x=>x!=null); return v.length?r2(v.reduce((a,b)=>a+b,0)/v.length):null; }
function sidOk(ex,sid){ return ex.idDigits===0 || (/^\d+$/.test(sid||'') && sid.length===ex.idDigits); }
function issues(ex,r){
  const out=[];
  if((r.flags||[]).length) out.push({k:'q',t:`ต้องตรวจ ${r.flags.length} ข้อ`});
  if(ex.idDigits>0){
    if(!sidOk(ex,r.sid)) out.push({k:'id',t:'อ่านรหัสไม่ครบ'});
    else if(r.idUnsure) out.push({k:'id',t:'ตรวจรหัส'});
    else if(Roster.list.length && !Roster.get(r.sid)) out.push({k:'roster',t:'ไม่พบในรายชื่อ'});
  }
  if(!isSurvey(ex)&&ex.versions>1&&(r.ver==null||r.ver<0)) out.push({k:'ver',t:'ไม่ได้ฝนชุด'});
  else if(!isSurvey(ex)&&ex.versions>1&&r.verUnsure) out.push({k:'ver',t:'ตรวจชุดข้อสอบ'});
  return out;
}
function flagsOf(ex,r){ return issues(ex,r).reduce((n,i)=>n+(i.k==='q'?r.flags.length:1),0); }
function stud(r){ const s=Roster.get(r.sid); if(s) return s; return r.ocrName?{sid:r.sid,name:r.ocrName,sec:'',ocr:true}:null; }
function examSections(ex){
  if(ex.sections&&ex.sections.length) return ex.sections;
  return [...new Set(ex.results.map(r=>(stud(r)||{}).sec).filter(Boolean))];
}
function missingOf(ex){
  if(!Roster.list.length||ex.idDigits===0) return [];
  const secs=new Set(examSections(ex)); if(!secs.size) return [];
  const have=new Set(ex.results.map(r=>r.sid));
  return Roster.list.filter(s=>secs.has(s.sec)&&!have.has(s.sid));
}
function stats(arr){
  const n=arr.length; if(!n) return null;
  const s=[...arr].sort((a,b)=>a-b), mean=arr.reduce((a,b)=>a+b,0)/n;
  const sd=Math.sqrt(arr.reduce((a,b)=>a+(b-mean)**2,0)/(n>1?n-1:1));
  const med=n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;
  return {n,mean,sd,med,min:s[0],max:s[n-1]};
}
function likertLevel(m){ return m==null?'':m>=4.51?'มากที่สุด':m>=3.51?'มาก':m>=2.51?'ปานกลาง':m>=1.51?'น้อย':'น้อยที่สุด'; }

/* ---------------- state ---------------- */
const S = { exams:[], cur:null, tab:'scan', session:[], images:{}, names:{}, busy:false, prog:0, progText:'', pending:null, keyVer:0, anaVer:0, secFilter:'', rosterQ:'' };
const exam = ()=>S.exams.find(e=>e.id===S.cur);
async function persist(){ const ex=exam(); if(ex) await Store.save(ex); scheduleSync(); }

/* ---------------- rendering ---------------- */
function render(){
  const sel=$('#examSel');
  sel.innerHTML=S.exams.map(e=>`<option value="${e.id}" ${e.id===S.cur?'selected':''}>${esc(e.name)}</option>`).join('')||'<option>กำลังโหลด…</option>';
  const ex=exam();
  $('#tabKey').textContent = ex&&isSurvey(ex)?'ตั้งค่าชุด':'เฉลย';
  $('#tabItems').textContent = ex&&isSurvey(ex)?'สรุปผล':'วิเคราะห์ข้อสอบ';
  $$('nav.tabs button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===S.tab)));
  $('#cntScores').textContent = ex?ex.results.length:0;
  updateSyncChip();
  const m=$('#main');
  if(!ex){ m.innerHTML='<section class="panel"><div class="card empty">กำลังโหลดข้อมูล…</div></section>'; return; }
  const views={scan:viewScan,scores:viewScores,key:viewKey,items:viewItems,sheet:viewSheet,roster:viewRoster,gs:viewGs};
  m.innerHTML='<section class="panel">'+views[S.tab](ex)+'</section>';
  bindView(ex); fillNameImgs(m);
}

function chipFor(ex,r){
  const is=issues(ex,r);
  if(!is.length) return r.edited?'<span class="chip plain">แก้ไขแล้ว</span>':'<span class="chip ok">เรียบร้อย</span>';
  return is.map(i=>`<span class="chip ${i.k==='roster'||i.k==='id'||i.k==='ver'?'bad':'warn'}">${esc(i.t)}</span>`).join(' ');
}
function scoreText(ex,r){
  if(isSurvey(ex)){ const m=respMean(ex,r); return m==null?'–':m.toFixed(2); }
  const s=scoreOf(ex,r); return s==null?'–':`${s}/${maxScore(ex,verOf(ex,r))}`;
}
function personText(ex,r){
  if(ex.idDigits===0) return `ผู้ตอบคนที่ ${r.no||'–'}`;
  const st=stud(r); return st?`${esc(st.name)}${st.sec?` · หมู่ ${esc(st.sec)}`:''}`:'';
}

/* ----- scan tab ----- */
const CAN_LIVE = !!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)&&window.isSecureContext;
function setupWarnings(ex){
  const w=[];
  if(!isSurvey(ex)){
    for(let v=0;v<ex.versions;v++){ const n=keyFilled(ex,v); if(n<ex.numQ) w.push(`เฉลย${ex.versions>1?'ชุด '+VER_TH[v]:''} กรอกแล้ว ${n} จาก ${ex.numQ} ข้อ`); }
  }
  return w.length?`<div class="card warnbox"><b style="color:var(--warn)">ยังตั้งค่าไม่ครบ</b><p class="hint">${w.map(esc).join(' · ')} ข้อที่ไม่มีเฉลยจะไม่นับคะแนน</p><div class="row" style="margin-top:8px"><button data-go="key">ไปที่เฉลย</button></div></div>`:'';
}
function viewScan(ex){
  const rows=S.session.filter(r=>r.exam===ex.id);
  const lastE=rows.length?rows[rows.length-1]:null;
  const lastR=lastE&&!lastE.error?ex.results.find(x=>x.uid===lastE.uid):null;
  const nextBtn=CAN_LIVE?'<button class="primary big" data-live>สแกนแผ่นถัดไป</button>':'<label class="btn primary big" for="camPick">ถ่ายแผ่นถัดไป</label>';
  let latest='';
  if(lastE&&!S.busy){
    if(lastR){ const f=flagsOf(ex,lastR);
      latest=`<div class="card latest ${f?'warnb':'okb'}"><div class="latest-main"><div><span class="hint">แผ่นล่าสุด · ${esc(lastE.src)}</span>
        <div class="latest-score mono">${isSurvey(ex)?scoreText(ex,lastR)+'<small> เฉลี่ย</small>':`${scoreOf(ex,lastR)??'–'}<small>/${maxScore(ex,Math.max(0,verOf(ex,lastR)??0))}</small>`}</div>
        <div><span class="mono">${esc(lastR.sid||'')}</span> ${personText(ex,lastR)}</div></div><div>${chipFor(ex,lastR)}</div></div>
        <div class="row">${nextBtn}<button class="big" data-review="${lastR.uid}">${f?'ดูข้อที่ต้องตรวจ':'ดูภาพและคำตอบ'}</button></div></div>`;
    } else latest=`<div class="card latest badb"><b style="color:var(--bad)">อ่านแผ่นล่าสุดไม่ได้</b><p class="hint">${esc(lastE.error)}</p><div class="row" style="margin-top:10px">${nextBtn}</div></div>`;
  }
  const list=rows.length?`<div class="tablebox"><table><thead><tr><th>ที่มา</th><th>${ex.idDigits?'รหัส':'ผู้ตอบ'}</th><th>ชื่อ</th><th class="num">${isSurvey(ex)?'เฉลี่ย':'คะแนน'}</th><th>สถานะ</th></tr></thead><tbody>${
    rows.slice().reverse().map(e=>{
      if(e.error) return `<tr><td>${esc(e.src)}</td><td colspan="3" class="hint">${esc(e.error)}</td><td><span class="chip bad">อ่านไม่ได้</span></td></tr>`;
      const r=ex.results.find(x=>x.uid===e.uid); if(!r) return '';
      return `<tr class="click" data-review="${r.uid}"><td>${esc(e.src)}</td><td class="mono">${esc(ex.idDigits?r.sid:'#'+r.no)}</td><td class="name">${esc((stud(r)||{}).name||'')}${r.hasName?`<br><img class="nimg" data-nimg="${r.uid}" alt="ลายมือชื่อ" hidden>`:''}</td><td class="num">${scoreText(ex,r)}</td><td>${chipFor(ex,r)}${e.replaced?' <span class="chip plain">แทนผลเดิม</span>':''}</td></tr>`;
    }).join('')}</tbody></table></div>`:'';
  return `${installBanner()}${setupWarnings(ex)}${latest}
  <div class="card" style="padding:0;border:0;background:transparent"><div class="drop" id="drop">
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><rect x="7" y="4" width="26" height="32" rx="3" fill="none" stroke="var(--accent)" stroke-width="2"/><rect x="10" y="7" width="3.5" height="3.5" fill="var(--accent)"/><rect x="26.5" y="7" width="3.5" height="3.5" fill="var(--accent)"/><rect x="10" y="29.5" width="3.5" height="3.5" fill="var(--accent)"/><rect x="26.5" y="29.5" width="3.5" height="3.5" fill="var(--accent)"/><path d="M14 20h12M20 14v12" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/></svg>
    <div><b>${CAN_LIVE?'ส่องกล้องที่กระดาษ แอปจะตรวจให้เองทันที':'ถ่ายรูปกระดาษคำตอบทีละแผ่น'} หรือเลือกไฟล์หลายไฟล์พร้อมกัน</b><p class="hint">${esc(ex.name)} · ${isSurvey(ex)?'แบบสอบถาม':'ข้อสอบ'} ${ex.numQ} ข้อ${ex.versions>1?` · ${ex.versions} ชุด`:''}</p></div>
    <div class="row" style="justify-content:center">
      ${CAN_LIVE?'<button class="primary big" data-live>สแกนด้วยกล้อง</button><label class="btn big" for="camPick">ถ่ายรูป</label>':'<label class="btn primary big" for="camPick">ถ่ายรูป</label>'}
      <label class="btn big" for="filePick">เลือกรูปหรือ PDF</label></div>
    <input type="file" id="filePick" accept="image/*,application/pdf" multiple hidden>
    <input type="file" id="camPick" accept="image/*" capture="environment" hidden>
    ${S.busy?`<div class="progress"><i style="width:${S.prog}%"></i></div><p class="hint" id="progText">${esc(S.progText)}</p>`:''}
  </div></div>
  ${rows.length?`<div class="row"><h3 style="margin:0">สแกนในรอบนี้ ${rows.length} แผ่น</h3><span class="hint">แตะแถวเพื่อดูภาพและแก้ไข</span></div>${list}`:
  `<div class="card"><h3>วิธีสแกนให้แม่น</h3><ol class="tips hint">
    <li>วางกระดาษบนโต๊ะ ส่องกล้องห่างประมาณ 25–30 ซม. ให้เห็นสี่เหลี่ยมดำครบ 4 มุม แล้วถือนิ่ง ๆ ครู่เดียว</li>
    <li>ระวังเงามือทับวงกลม ห้องมืดกดปุ่มไฟฉายในหน้ากล้อง</li>
    <li>ได้ยินเสียงและเห็นคะแนนแล้ว เปลี่ยนแผ่นถัดไปได้เลย</li>
    <li>ถ้านักศึกษาใช้ดินสออ่อน เปิด “อ่านรอยจาง” ในแท็บตั้งค่า</li></ol></div>`}`;
}

/* ----- scores tab ----- */
function filteredResults(ex){
  let rs=[...ex.results];
  if(S.secFilter) rs=rs.filter(r=>((stud(r)||{}).sec||'')===S.secFilter);
  return rs.sort((a,b)=>ex.idDigits?String(a.sid).localeCompare(String(b.sid),'th',{numeric:true}):(a.no||0)-(b.no||0));
}
function viewScores(ex){
  if(!ex.results.length) return `<div class="card empty">ยังไม่มีผลในชุดนี้ <button data-go="scan" class="primary" style="margin-left:8px">ไปสแกน</button></div>${missingHtml(ex)}`;
  const secs=[...new Set(ex.results.map(r=>(stud(r)||{}).sec).filter(Boolean))].sort();
  const rs=filteredResults(ex);
  const need=rs.filter(r=>flagsOf(ex,r)).length;
  let top='';
  if(isSurvey(ex)){
    const ms=rs.map(r=>respMean(ex,r)).filter(v=>v!=null), st=stats(ms);
    top=`<div class="stats"><div class="stat"><b>${rs.length}</b><span>ผู้ตอบ</span></div>
      <div class="stat"><b>${st?st.mean.toFixed(2):'–'}</b><span>ค่าเฉลี่ยรวม</span></div>
      <div class="stat"><b>${st?st.sd.toFixed(2):'–'}</b><span>S.D.</span></div>
      <div class="stat"><b>${st?likertLevel(st.mean):'–'}</b><span>ระดับ</span></div></div>`;
  } else {
    const sc=rs.map(r=>scoreOf(ex,r)).filter(v=>v!=null), st=stats(sc), full=maxScore(ex,0);
    const bins=Math.max(1,Math.min(20,Math.ceil(full)||1)), hist=new Array(bins).fill(0);
    sc.forEach(v=>{ hist[Math.min(bins-1,Math.floor(v/(full||1)*bins))]++; });
    const hm=Math.max(...hist,1);
    top=st?`<div class="stats"><div class="stat"><b>${st.n}</b><span>ผู้สอบ</span></div>
      <div class="stat"><b>${st.mean.toFixed(2)}</b><span>ค่าเฉลี่ย (เต็ม ${full})</span></div>
      <div class="stat"><b>${st.sd.toFixed(2)}</b><span>S.D.</span></div>
      <div class="stat"><b>${st.med}</b><span>มัธยฐาน</span></div>
      <div class="stat"><b>${st.max} / ${st.min}</b><span>สูงสุด / ต่ำสุด</span></div></div>
      <div class="card"><h3 style="margin:0">การกระจายของคะแนน</h3><div class="hist">${hist.map((h,i)=>`<div title="${h} คน" style="height:${h/hm*100}%"></div>`).join('')}</div><div class="histax"><span>0</span><span>${r2(full/2)}</span><span>${full}</span></div></div>`:'';
  }
  return `${top}
  <div class="row">
    ${secs.length>1?`<select id="secFilter"><option value="">ทุกหมู่เรียน</option>${secs.map(s=>`<option ${s===S.secFilter?'selected':''}>${esc(s)}</option>`).join('')}</select>`:''}
    ${need?`<span class="chip warn">ต้องตรวจซ้ำ ${need} แผ่น</span>`:'<span class="chip ok">ตรวจครบทุกแผ่น</span>'}
    <span class="grow"></span>
    <button id="dlCsv" class="primary">ดาวน์โหลด Excel (CSV)</button>
    <button id="cpTsv">คัดลอกตาราง</button>
    ${isSurvey(ex)?'':'<button id="printReturn">พิมพ์ใบคืนผลสอบ</button>'}
  </div>
  <div class="tablebox"><table><thead><tr><th class="num">#</th><th>${ex.idDigits?'รหัสนักศึกษา':'ผู้ตอบ'}</th>${ex.idDigits?'<th>ชื่อ-สกุล</th><th>หมู่</th>':''}${!isSurvey(ex)&&ex.versions>1?'<th>ชุด</th>':''}<th class="num">${isSurvey(ex)?'ค่าเฉลี่ย':'คะแนน'}</th>${isSurvey(ex)?'':'<th class="num">ร้อยละ</th>'}<th>สถานะ</th></tr></thead><tbody>
  ${rs.map((r,i)=>{ const st=stud(r)||{}; const s=scoreOf(ex,r), mx=maxScore(ex,Math.max(0,verOf(ex,r)??0));
    return `<tr class="click" data-review="${r.uid}"><td class="num">${i+1}</td><td class="mono">${esc(ex.idDigits?r.sid||'—':'#'+r.no)}</td>${ex.idDigits?`<td class="name">${esc(st.name||'')}${r.hasName?`<br><img class="nimg" data-nimg="${r.uid}" alt="ลายมือชื่อ" hidden>`:''}</td><td>${esc(st.sec||'')}</td>`:''}${!isSurvey(ex)&&ex.versions>1?`<td>${r.ver>=0?VER_TH[r.ver]:'–'}</td>`:''}<td class="num">${isSurvey(ex)?scoreText(ex,r):s??'–'}</td>${isSurvey(ex)?'':`<td class="num">${s!=null&&mx?(s/mx*100).toFixed(1):'–'}</td>`}<td>${chipFor(ex,r)}</td></tr>`; }).join('')}
  </tbody></table></div>
  ${missingHtml(ex)}
  <div class="row"><span class="grow"></span>${S.pending==='clear'?`<span class="confirm">ลบผลทั้งหมด ${ex.results.length} รายการในชุดนี้? <button class="danger" id="clearYes">ลบทั้งหมด</button><button id="clearNo">ยกเลิก</button></span>`:`<button class="ghost danger" id="clearAll">ลบผลทั้งหมดในชุดนี้</button>`}</div>`;
}
function missingHtml(ex){
  const miss=missingOf(ex); if(!miss.length) return '';
  return `<details class="card"><summary><b>ยังไม่ได้สแกน ${miss.length} คน</b> <span class="hint">จากรายชื่อหมู่ ${esc(examSections(ex).join(', '))}</span></summary>
    <div class="tablebox" style="margin-top:10px"><table><tbody>${miss.map(s=>`<tr><td class="mono">${esc(s.sid)}</td><td class="name">${esc(s.name)}</td><td>${esc(s.sec)}</td></tr>`).join('')}</tbody></table></div></details>`;
}

/* ----- key / setup tab ----- */
function viewKey(ex){
  const survey=isSurvey(ex), L=labels(ex);
  const secs=Roster.sections();
  const setup=`<div class="card"><div class="row" style="margin-bottom:12px"><h2 style="margin:0">ตั้งค่าชุด</h2><span class="chip plain">${survey?'แบบสอบถาม':'ข้อสอบ'}</span></div>
    <div class="grid2">
      <label class="field" style="grid-column:1/-1"><span>ชื่อชุด</span><input type="text" id="exName" value="${esc(ex.name)}"></label>
      <label class="field"><span>จำนวนข้อ (1–100)</span><input type="number" id="exN" min="1" max="100" value="${ex.numQ}"></label>
      ${survey?'':`<label class="field"><span>รูปแบบตัวเลือก</span><select id="exC">${[5,4,3,2].map(c=>`<option value="${c}" ${ex.choices===c?'selected':''}>${c===2?'ถูก/ผิด (ถ ผ)':TH.slice(0,c).join(' ')}</option>`).join('')}</select></label>
      <label class="field"><span>จำนวนชุดข้อสอบ</span><select id="exV">${[1,2,3,4].map(v=>`<option value="${v}" ${ex.versions===v?'selected':''}>${v===1?'ชุดเดียว':v+' ชุด ('+VER_TH.slice(0,v).join(' ')+')'}</option>`).join('')}</select></label>`}
      <label class="field"><span>${survey?'รหัสผู้ตอบ':'จำนวนหลักรหัสนักศึกษา'}</span><select id="exD">${(survey?[0,11,10,9,8,7,6,5,4,3,2,1]:[11,10,9,8,7,6,5,4]).map(d=>`<option value="${d}" ${ex.idDigits===d?'selected':''}>${d===0?'ไม่ต้องระบุ':d+' หลัก'}</option>`).join('')}</select></label>
    </div>
    ${secs.length&&ex.idDigits?`<div style="margin-top:12px"><span class="hint">หมู่เรียนที่สอบชุดนี้ (ใช้แสดงรายชื่อที่ยังไม่ได้สแกน)</span><div class="row" style="margin-top:4px">${secs.map(s=>`<label class="row" style="gap:4px"><input type="checkbox" data-sec="${esc(s)}" ${ex.sections.includes(s)?'checked':''}> ${esc(s)}</label>`).join('')}</div></div>`:''}
    ${ex.results.length?'<p class="hint" style="margin-top:10px">แก้จำนวนข้อหรือตัวเลือกได้ แต่ต้องพิมพ์กระดาษคำตอบให้ตรงกับการตั้งค่า</p>':''}
  </div>`;
  if(survey) return setup+`<div class="card"><h3>มาตราส่วน 5 ระดับ</h3><p class="hint">5 = มากที่สุด · 4 = มาก · 3 = ปานกลาง · 2 = น้อย · 1 = น้อยที่สุด ผลสรุปค่าเฉลี่ยและ S.D. รายข้ออยู่ในแท็บ “สรุปผล”</p></div>
    <div class="row"><span class="grow"></span>${delExamHtml(ex)}</div>`;
  const v=Math.min(S.keyVer,ex.versions-1), k=keyOf(ex,v), w=weights(ex);
  let grid='';
  for(let q=0;q<ex.numQ;q++){
    const kk=k[q], cancel=kk==='*';
    grid+=`<div class="krow ${kk?'':'missing'} ${cancel?'cancel':''}"><span class="n">${q+1}</span>${L.map((t,i)=>`<button class="bub ${!cancel&&kk.includes(LET[i])?'on':''}" data-k="${q}:${i}" aria-label="ข้อ ${q+1} ตอบ ${t}">${t}</button>`).join('')}<button class="x ${cancel?'on':''}" data-cancel="${q}" title="ทุกคนได้คะแนนข้อนี้">${cancel?'ยกเลิกข้อแล้ว':'ยกเลิกข้อ'}</button>${w[q]!==1?`<span class="hint mono" style="margin-left:6px">${w[q]} คะแนน</span>`:''}</div>`;
  }
  const kc=keyFilled(ex,v);
  return setup+`<div class="card">
    <div class="row" style="margin-bottom:10px"><h2 style="margin:0">เฉลย</h2>
      ${ex.versions>1?`<div class="seg">${VER_TH.slice(0,ex.versions).map((t,i)=>`<button data-kv="${i}" aria-pressed="${i===v}">ชุด ${t}</button>`).join('')}</div>`:''}
      <span class="chip ${kc===ex.numQ?'ok':'warn'}" id="keyCount">${kc}/${ex.numQ} ข้อ</span><span class="grow"></span>
      <label class="btn" for="keyPick">อ่านเฉลยจากกระดาษ</label><input type="file" id="keyPick" accept="image/*,application/pdf" hidden></div>
    <p class="hint" style="margin-bottom:12px">แตะวงกลมเพื่อเลือกคำตอบที่ถูก แตะหลายวงได้ถ้าข้อนั้นมีหลายคำตอบที่ถูก “ยกเลิกข้อ” ให้ทุกคนได้คะแนนข้อนั้น แก้เฉลยแล้วคะแนนทุกคนคำนวณใหม่ทันที</p>
    <div class="keygrid">${grid}</div></div>
  <div class="card"><h3>วางเฉลยแบบตัวอักษร${ex.versions>1?` (ชุด ${VER_TH[v]})`:''}</h3><p class="hint">ใช้ได้ทั้ง ${ex.choices===2?'ถ ผ, T F, 1 2':'ก–จ, A–E หรือ 1–5'} เรียงต่อกัน</p>
    <div class="row" style="margin-top:8px"><input type="text" id="keyText" class="grow" placeholder="${ex.choices===2?'ถผถถผ…':'ขจกงจ…'}"><button id="keyApply">ใช้เฉลยนี้</button></div></div>
  <div class="card"><h3>คะแนนรายข้อ</h3><p class="hint">ปกติข้อละ 1 คะแนน ถ้าบางตอนให้คะแนนต่างกัน เพิ่มช่วงข้อที่นี่</p>
    <div style="display:grid;gap:8px;margin-top:8px">${(ex.weightRules||[]).map((r,i)=>`<div class="row"><span>ข้อ</span><input type="number" min="1" max="${ex.numQ}" value="${r.from}" data-wr="${i}:from" style="width:80px"><span>ถึง</span><input type="number" min="1" max="${ex.numQ}" value="${r.to}" data-wr="${i}:to" style="width:80px"><span>ข้อละ</span><input type="number" step="0.5" min="0" value="${r.pts}" data-wr="${i}:pts" style="width:80px"><span>คะแนน</span><button class="ghost danger" data-wdel="${i}">ลบ</button></div>`).join('')}
    <div><button id="wAdd">+ เพิ่มช่วงคะแนน</button> <span class="hint">คะแนนเต็ม ${maxScore(ex,v)}</span></div></div></div>
  <div class="row"><span class="grow"></span>${delExamHtml(ex)}</div>`;
}
function delExamHtml(ex){ return S.pending==='delExam'?`<span class="confirm">ลบชุด “${esc(ex.name)}” พร้อมผลทั้งหมด? <button class="danger" id="delYes">ลบชุดนี้</button><button id="delNo">ยกเลิก</button></span>`:`<button class="ghost danger" id="delExam">ลบชุดนี้</button>`; }

/* ----- analysis tab ----- */
function itemAnalysis(ex,v){
  const rs=ex.results.filter(r=>verOf(ex,r)===v); const n=rs.length; if(!n) return null;
  const k=keyOf(ex,v), sc=rs.map(r=>scoreOf(ex,r)||0);
  const order=rs.map((r,i)=>i).sort((a,b)=>sc[b]-sc[a]);
  const g=Math.max(1,Math.round(n*0.27)), hi=order.slice(0,g), lo=order.slice(-g);
  const items=[];
  for(let q=0;q<ex.numQ;q++){
    const cnt=new Array(ex.choices+1).fill(0);
    rs.forEach(r=>{ const i=LET.indexOf(r.ans[q]); cnt[i>=0&&i<ex.choices?i:ex.choices]++; });
    const kk=k[q], valid=!!kk&&kk!=='*';
    const p=valid?rs.filter(r=>isRight(kk,r.ans[q])).length/n:null;
    const rr=valid?(hi.filter(i=>isRight(kk,rs[i].ans[q])).length-lo.filter(i=>isRight(kk,rs[i].ans[q])).length)/g:null;
    const dead=valid?LET.slice(0,ex.choices).split('').filter((c,i)=>!kk.includes(c)&&cnt[i]/n<0.05).length:0;
    items.push({q,k:kk,cnt,p,r:rr,dead});
  }
  return {n,g,items};
}
function surveySummary(ex){
  const rs=ex.results, items=[];
  for(let q=0;q<ex.numQ;q++){
    const vals=rs.map(r=>valueOf(ex,r.ans[q])).filter(v=>v!=null), st=stats(vals);
    const dist=[5,4,3,2,1].map(x=>vals.filter(v=>v===x).length);
    items.push({q,n:vals.length,mean:st?st.mean:null,sd:st?st.sd:null,dist});
  }
  return items;
}
function viewItems(ex){
  if(!ex.results.length) return `<div class="card empty">สแกนกระดาษก่อน แล้วผลจะแสดงที่นี่</div>`;
  const cols=['var(--accent)','#3f8f8a','#8a6fb8','#c07a3a','#6d7f99'];
  if(isSurvey(ex)){
    const it=surveySummary(ex), all=ex.results.map(r=>respMean(ex,r)).filter(v=>v!=null), st=stats(all);
    return `<div class="card"><h2>สรุปผลแบบสอบถาม</h2><p class="hint">ผู้ตอบ ${ex.results.length} คน · ค่าเฉลี่ยรวม ${st?st.mean.toFixed(2):'–'} (S.D. ${st?st.sd.toFixed(2):'–'}) ระดับ${st?likertLevel(st.mean):'–'}</p>
      <p class="hint">เกณฑ์: 4.51–5.00 มากที่สุด · 3.51–4.50 มาก · 2.51–3.50 ปานกลาง · 1.51–2.50 น้อย · 1.00–1.50 น้อยที่สุด</p></div>
    <div class="row"><span class="grow"></span><button id="dlItems">ดาวน์โหลดสรุปผล (CSV)</button></div>
    <div class="tablebox"><table><thead><tr><th class="num">ข้อ</th><th class="num">n</th><th class="num">x̄</th><th class="num">S.D.</th><th>ระดับ</th><th>การกระจาย (5 → 1)</th></tr></thead><tbody>
    ${it.map(i=>`<tr><td class="num">${i.q+1}</td><td class="num">${i.n}</td><td class="num">${i.mean==null?'–':i.mean.toFixed(2)}</td><td class="num">${i.sd==null?'–':i.sd.toFixed(2)}</td><td>${likertLevel(i.mean)}</td>
      <td><div class="choicebar">${i.dist.map((c,j)=>`<i style="width:${i.n?c/i.n*100:0}%;background:${cols[j]};opacity:${1-j*0.12}"></i>`).join('')}</div><span class="hint mono" style="font-size:12px">${i.dist.join(' · ')}</span></td></tr>`).join('')}
    </tbody></table></div>`;
  }
  const v=Math.min(S.anaVer,ex.versions-1), A=itemAnalysis(ex,v);
  const vsel=ex.versions>1?`<div class="seg">${VER_TH.slice(0,ex.versions).map((t,i)=>`<button data-av="${i}" aria-pressed="${i===v}">ชุด ${t}</button>`).join('')}</div>`:'';
  if(!A) return `<div class="row">${vsel}</div><div class="card empty">ยังไม่มีผู้สอบชุด ${VER_TH[v]}</div>`;
  const L=labels(ex);
  const pTag=p=>p===null?'<span class="chip plain">ไม่คิด</span>':p<0.2?'<span class="chip bad">ยากมาก</span>':p>0.8?'<span class="chip warn">ง่ายมาก</span>':'<span class="chip ok">เหมาะสม</span>';
  const rTag=r=>r===null?'':r<0?'<span class="chip bad">ติดลบ ตรวจเฉลย</span>':r<0.2?'<span class="chip warn">ควรปรับปรุง</span>':'<span class="chip ok">ใช้ได้</span>';
  const good=A.items.filter(i=>i.p!==null&&i.p>=0.2&&i.p<=0.8&&i.r>=0.2).length;
  return `<div class="card"><div class="row"><h2 style="margin:0">วิเคราะห์ข้อสอบรายข้อ</h2>${vsel}</div>
    <p class="hint" style="margin-top:6px">ผู้สอบ${ex.versions>1?'ชุด '+VER_TH[v]:''} ${A.n} คน · กลุ่มสูงและกลุ่มต่ำกลุ่มละ ${A.g} คน (27%) · ข้อที่ดีทั้งความยากและอำนาจจำแนก ${good} ข้อ${A.n<20?' · <b style="color:var(--warn)">ผู้สอบน้อยกว่า 20 คน ค่าที่ได้อาจคลาดเคลื่อน</b>':''}</p>
    <p class="hint">ความยาก p 0.20–0.80 เหมาะสม · อำนาจจำแนก r ตั้งแต่ 0.20 ใช้ได้ · ตัวลวงที่มีคนเลือกน้อยกว่า 5% ถือว่าไม่ทำงาน</p></div>
  <div class="row"><span class="grow"></span><button id="dlItems">ดาวน์โหลดผลวิเคราะห์ (CSV)</button></div>
  <div class="tablebox"><table><thead><tr><th class="num">ข้อ</th><th>เฉลย</th><th class="num">p</th><th>ความยาก</th><th class="num">r</th><th>อำนาจจำแนก</th><th>ตัวเลือกที่ตอบ (${L.join(' ')})</th><th class="num">ตัวลวงไม่ทำงาน</th></tr></thead><tbody>
  ${A.items.map(it=>`<tr><td class="num">${it.q+1}</td><td>${esc(keyLabel(ex,it.k))}</td><td class="num">${it.p===null?'–':it.p.toFixed(2)}</td><td>${pTag(it.p)}</td><td class="num">${it.r===null?'–':it.r.toFixed(2)}</td><td>${rTag(it.r)}</td>
    <td><div class="choicebar">${it.cnt.slice(0,ex.choices).map((c,i)=>`<i style="width:${c/A.n*100}%;background:${cols[i]};opacity:${it.k&&it.k.includes(LET[i])?1:.5}"></i>`).join('')}</div><span class="hint mono" style="font-size:12px">${it.cnt.slice(0,ex.choices).join(' · ')}${it.cnt[ex.choices]?' · ว่าง/หลายข้อ '+it.cnt[ex.choices]:''}</span></td>
    <td class="num">${it.dead||''}</td></tr>`).join('')}</tbody></table></div>`;
}

/* ----- answer sheet tab ----- */
function viewSheet(ex){
  return `<div class="card"><div class="two">
    <div class="sheetwrap" id="sheetWrap"><iframe id="sheetPrev" title="ตัวอย่างกระดาษคำตอบ" width="794" height="1123" scrolling="no"></iframe></div>
    <div>
      <h2>${isSurvey(ex)?'กระดาษคำตอบแบบสอบถาม':'กระดาษคำตอบ'} ${ex.numQ} ข้อ</h2>
      <p class="hint">สร้างจากการตั้งค่าของชุด “${esc(ex.name)}” · ${isSurvey(ex)?'มาตราส่วน 5 ระดับ':ex.choices===2?'ถูก/ผิด':TH.slice(0,ex.choices).join(' ')}${ex.versions>1?` · มีช่องฝนชุด ${VER_TH.slice(0,ex.versions).join(' ')}`:''}${ex.idDigits?` · รหัส ${ex.idDigits} หลัก`:' · ไม่ระบุผู้ตอบ'}</p>
      <div class="row" style="margin:14px 0"><button class="primary" id="printSheet">พิมพ์ / บันทึกเป็น PDF</button><button data-go="key">แก้การตั้งค่า</button></div>
      <h3>การพิมพ์</h3>
      <ol class="tips hint">
        <li>กด “พิมพ์” แล้วเลือกเครื่องพิมพ์ หรือเลือก “บันทึกเป็น PDF” เพื่อเก็บไฟล์ไว้ถ่ายเอกสาร</li>
        <li>ขนาดกระดาษ A4 ขนาดจริง 100% ห้ามเลือก “พอดีหน้า” และไม่ต้องใส่หัวกระดาษ/ท้ายกระดาษ</li>
        <li>ถ้าพิมพ์จากมือถือไม่สะดวก เปิดแอปนี้บนคอมพิวเตอร์แล้วพิมพ์จากที่นั่น</li>
      </ol>
      <p class="hint" style="margin-top:10px">กระดาษ 100 ข้อแบบเดิมที่พิมพ์ไว้แล้วยังใช้ได้กับชุดข้อสอบ ก–จ ชุดเดียว</p>
    </div></div></div>`;
}

/* ----- roster tab ----- */
function viewRoster(){
  const secs=Roster.sections();
  const q=S.rosterQ.trim();
  const shown=(q?Roster.list.filter(s=>s.sid.includes(q)||s.name.includes(q)||s.sec===q):Roster.list).slice(0,300);
  return `<div class="card"><h2>รายชื่อนักศึกษา</h2>
    <p class="hint">มีรายชื่อ ${Roster.list.length} คน${secs.length?` · หมู่เรียน ${esc(secs.join(', '))}`:''} · ใช้ร่วมกันทุกชุดข้อสอบ สแกนแล้วจะขึ้นชื่อทันที และเตือนถ้ารหัสไม่อยู่ในรายชื่อ</p></div>
  <div class="card"><h3>นำเข้ารายชื่อ</h3>
    <p class="hint">คัดลอกจาก Excel หรือ Google Sheet (คอลัมน์รหัสนักศึกษา ชื่อ-สกุล และหมู่เรียน ถ้ามี) แล้ววางที่นี่ แอปจะหาคอลัมน์ให้เอง</p>
    <textarea id="rosterText" placeholder="6512345678901&#9;นางสาวสมใจ ใจดี&#9;1"></textarea>
    <div class="row" style="margin-top:8px"><button class="primary" id="rosterAdd">เพิ่มเข้ารายชื่อ</button><button id="rosterReplace">แทนที่รายชื่อเดิมทั้งหมด</button>
      <span class="grow"></span><button id="rosterPull" ${Settings.url?'':'disabled'}>ดึงจากแท็บ “รายชื่อ” ใน Google Sheet</button></div>
    ${Settings.url?'':'<p class="hint" style="margin-top:6px">ดึงจาก Google Sheet ได้หลังเชื่อมต่อในแท็บตั้งค่า</p>'}
  </div>
  ${Roster.list.length?`<div class="row"><input type="text" id="rosterQ" class="grow" placeholder="ค้นหารหัส ชื่อ หรือหมู่" value="${esc(S.rosterQ)}"><button id="rosterCsv">ดาวน์โหลด CSV</button></div>
  <div class="tablebox"><table><thead><tr><th>รหัส</th><th>ชื่อ-สกุล</th><th>หมู่</th><th></th></tr></thead><tbody>
  ${shown.map(s=>`<tr><td class="mono">${esc(s.sid)}</td><td class="name">${esc(s.name)}</td><td>${esc(s.sec)}</td><td><button class="ghost danger" data-rdel="${esc(s.sid)}" style="padding:2px 8px">ลบ</button></td></tr>`).join('')}
  </tbody></table></div>${Roster.list.length>shown.length?`<p class="hint">แสดง ${shown.length} จาก ${Roster.list.length} คน พิมพ์ค้นหาเพื่อดูคนอื่น</p>`:''}
  <div class="row"><span class="grow"></span>${S.pending==='rclear'?`<span class="confirm">ลบรายชื่อทั้งหมด? <button class="danger" id="rclearYes">ลบ</button><button id="rclearNo">ยกเลิก</button></span>`:'<button class="ghost danger" id="rclear">ลบรายชื่อทั้งหมด</button>'}</div>`:''}`;
}

/* ----- settings / Google Sheet tab ----- */
function gsStatusHtml(){
  const n=pendingCount();
  if(!Settings.url) return `<span class="chip plain">ยังไม่เชื่อม</span><p class="hint" style="margin-top:6px">ตอนนี้ผลเก็บอยู่ในเครื่องนี้เท่านั้น ทำตามขั้นตอนด้านล่างครั้งเดียว แล้วคะแนนจะเข้า Google Sheet เองทุกครั้งที่สแกน</p>`;
  const ex=exam();
  return `<div class="row">${Sync.err?'<span class="chip bad">ส่งไม่สำเร็จ</span>':n?`<span class="chip warn">ค้างส่ง ${n} รายการ</span>`:'<span class="chip ok">ส่งครบแล้ว</span>'}
      ${Settings.sheetName?`<span class="hint">ไฟล์: <b>${esc(Settings.sheetName)}</b></span>`:''}
      ${Sync.last?`<span class="hint">ส่งล่าสุด ${new Date(Sync.last).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})} น.</span>`:''}</div>
    ${Sync.err?`<p class="hint" style="color:var(--bad);margin-top:6px">${esc(Sync.err)}</p>`:''}
    ${Sync.ocrErr?`<p class="hint" style="color:var(--warn);margin-top:6px">${esc(Sync.ocrErr)}</p>`:''}
    ${Settings.ocr&&Settings.scriptVer&&Settings.scriptVer<3?'<p class="hint" style="color:var(--warn);margin-top:6px">อัปเดตโค้ด Apps Script เป็นรุ่น 3 เพื่อให้อ่านลายมือชื่อได้</p>':''}
    <div class="row" style="margin-top:10px"><button class="primary" id="gsNow">ส่งตอนนี้</button>
      ${ex&&ex.sheetUrl?`<a class="btn" href="${esc(ex.sheetUrl)}" target="_blank" rel="noopener">เปิดแท็บของชุดนี้ใน Google Sheet</a>`:''}
      <button class="ghost" id="gsAll">ส่งผลทุกคนซ้ำ</button></div>`;
}
function gsCode(){ return GS_CODE.replace('__TOKEN__', Settings.token); }
function viewGs(){
  return `<div class="card"><h2>Google Sheet</h2><div id="gsStatus" style="margin-top:6px">${gsStatusHtml()}</div></div>
  <div class="card"><h3>เชื่อมต่อ</h3>
    <label class="hint" for="gsUrl">URL ของเว็บแอป Apps Script (ลงท้ายด้วย /exec)</label>
    <div class="row" style="margin-top:4px"><input type="text" id="gsUrl" class="grow mono" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(Settings.url)}"><button id="gsTest" class="primary">ทดสอบและบันทึก</button></div>
    <div class="row" style="margin-top:12px">
      <div class="grow"><label class="hint" for="gsToken">รหัสลับ (ต้องตรงกับในโค้ด)</label><input type="text" id="gsToken" class="mono" value="${esc(Settings.token)}" style="width:100%"></div>
      <label class="row" style="gap:6px;margin-top:18px"><input type="checkbox" id="gsAuto" ${Settings.auto?'checked':''}> ส่งอัตโนมัติหลังสแกน</label></div>
    <p class="hint" style="margin-top:8px">ใช้หลายเครื่องส่งเข้า Sheet เดียวกันได้ ให้ใส่ URL และรหัสลับเดียวกันทุกเครื่อง</p></div>
  <div class="card"><h3>ตั้งค่าครั้งแรก (ประมาณ 5 นาที)</h3>
    <ol class="steps">
      <li>เปิด <a href="https://sheets.new" target="_blank" rel="noopener">sheets.new</a> เพื่อสร้าง Google Sheet ใหม่ ตั้งชื่อเช่น “คะแนนสอบ 1/2569”</li>
      <li>ในชีต เลือกเมนู <b>ส่วนขยาย › Apps Script</b> ลบโค้ดเดิมทั้งหมด แล้ววางโค้ดจากปุ่มนี้
        <div class="row" style="margin:8px 0"><button id="gsCopy" class="primary">คัดลอกโค้ด</button><span class="hint">รหัสลับของเครื่องนี้ใส่ไว้ในโค้ดให้แล้ว</span></div>
        <details><summary class="hint">ดูโค้ด</summary><pre class="code" id="gsCodeBox">${esc(gsCode())}</pre></details></li>
      <li>กดบันทึก 💾 ที่แถบด้านบนเลือกฟังก์ชัน <b>authorize</b> แล้วกด <b>▶ เรียกใช้</b> กดอนุญาตสิทธิ์ให้ครบ (ใช้อ่านลายมือชื่อ)</li>
      <li>กด <b>การทำให้ใช้งานได้ › การทำให้ใช้งานได้รายการใหม่</b> กดรูปเฟืองเลือก <b>เว็บแอป</b></li>
      <li>ตั้ง <b>ดำเนินการในฐานะ: ฉัน</b> และ <b>ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน</b> แล้วกดทำให้ใช้งานได้</li>
      <li>ถ้าขึ้นว่า “Google ยังไม่ได้ยืนยันแอปนี้” กด <b>ขั้นสูง › ไปที่ … (ไม่ปลอดภัย)</b> ได้ เพราะเป็นโค้ดในบัญชีของอาจารย์เอง</li>
      <li>คัดลอก URL ของเว็บแอปมาวางในช่องด้านบน แล้วกด <b>ทดสอบและบันทึก</b></li></ol>
    <p class="hint"><b>อัปเดตโค้ดรุ่นใหม่</b> (URL เดิมใช้ต่อได้): วางโค้ดใหม่ทับ กดบันทึก เลือกฟังก์ชัน <b>authorize</b> กด <b>▶ เรียกใช้</b> แล้วกด <b>การทำให้ใช้งานได้ › จัดการการทำให้ใช้งานได้</b> กดรูปดินสอ เลือก <b>เวอร์ชัน: เวอร์ชันใหม่</b> แล้วกดทำให้ใช้งานได้</p></div>
  <div class="card"><h3>การอ่านกระดาษ</h3>
    <label class="field"><span>ความไวในการอ่านรอยฝน</span><select id="sens">
      <option value="1" ${Settings.sens==1?'selected':''}>ปกติ (ปากกา ดินสอเข้ม)</option>
      <option value="0.75" ${Settings.sens==0.75?'selected':''}>อ่านรอยจาง (ดินสออ่อน กากบาทเส้นบาง)</option></select></label>
    <label class="row" style="gap:6px;margin-top:12px"><input type="checkbox" id="ocrOn" ${Settings.ocr?'checked':''}> อ่านชื่อ-สกุลจากลายมือนักศึกษา แล้วใส่ใน Google Sheet</label>
    <p class="hint">Google อ่านลายมือให้ อาจผิดบ้าง ใช้รหัสนักศึกษายืนยันตัวตน ถ้ามีรายชื่อในแท็บรายชื่อ แอปจะใช้ชื่อจากรายชื่อแทน</p>
    <p class="hint" style="margin-top:6px">ข้อที่แอปไม่แน่ใจจะขึ้นสีเหลืองให้ตรวจเสมอ ถ้าตั้ง “อ่านรอยจาง” แล้วมีรอยลบเยอะ อาจขึ้นว่าตอบหลายข้อบ่อยขึ้น</p></div>
  <div class="card"><h3>สำรองและย้ายข้อมูล</h3><p class="hint">ข้อมูลเก็บในเครื่องนี้ ย้ายไปเครื่องอื่นได้ด้วยไฟล์สำรอง (ไม่รวมภาพกระดาษ)</p>
    <div class="row" style="margin-top:8px"><button id="bkOut">ดาวน์โหลดไฟล์สำรอง</button><label class="btn" for="bkIn">นำเข้าไฟล์สำรอง</label><input type="file" id="bkIn" accept=".json,application/json" hidden></div>
    <p class="hint" style="margin-top:8px">แอปรุ่น ${APP_VERSION}${Settings.scriptVer?` · โค้ด Apps Script รุ่น ${Settings.scriptVer}`:''}</p></div>`;
}

/* ---------------- event binding ---------------- */
function bindView(ex){
  $$('[data-go]').forEach(b=>b.onclick=()=>{ S.tab=b.dataset.go; S.pending=null; render(); });
  $$('[data-review]').forEach(b=>b.onclick=()=>openReview(b.dataset.review));
  const T=S.tab;
  if(T==='scan'){
    $$('[data-live]').forEach(b=>b.onclick=openLive);
    const ih=$('#iosHintOff'); if(ih) ih.onclick=()=>{ Settings.iosHintOff=true; saveSettings(); render(); };
    $('#filePick').onchange=e=>{ handleFiles([...e.target.files]); e.target.value=''; };
    $('#camPick').onchange=e=>{ handleFiles([...e.target.files]); e.target.value=''; };
    const drop=$('#drop');
    ['dragenter','dragover'].forEach(t=>drop.addEventListener(t,e=>{ e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave','drop'].forEach(t=>drop.addEventListener(t,e=>{ e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop',e=>handleFiles([...e.dataTransfer.files]));
  }
  if(T==='scores'&&ex.results.length){
    const sf=$('#secFilter'); if(sf) sf.onchange=e=>{ S.secFilter=e.target.value; render(); };
    $('#dlCsv').onclick=()=>saveFile(safeName(ex.name)+(isSurvey(ex)?'_ผลแบบสอบถาม.csv':'_คะแนน.csv'), toCsv(resultsTable(ex)));
    $('#cpTsv').onclick=()=>copyText(resultsTable(ex).map(r=>r.join('\t')).join('\n'),'คัดลอกแล้ว วางใน Excel ได้เลย');
    const pr=$('#printReturn'); if(pr) pr.onclick=()=>printReturnSheets(ex);
    const c=$('#clearAll'); if(c) c.onclick=()=>{ S.pending='clear'; render(); };
    const cy=$('#clearYes'); if(cy) cy.onclick=async()=>{ ex.results.forEach(r=>{ queueDelete(ex,r); dropImages(r.uid); }); ex.results=[]; S.pending=null; await persist(); toast('ลบผลแล้ว'); render(); };
    const cn=$('#clearNo'); if(cn) cn.onclick=()=>{ S.pending=null; render(); };
  }
  if(T==='key') bindKey(ex);
  if(T==='items'&&ex.results.length){
    $$('[data-av]').forEach(b=>b.onclick=()=>{ S.anaVer=+b.dataset.av; render(); });
    const d=$('#dlItems'); if(d) d.onclick=()=>saveFile(safeName(ex.name)+(isSurvey(ex)?'_สรุปแบบสอบถาม.csv':'_วิเคราะห์ข้อสอบ.csv'), toCsv(itemsTable(ex)));
  }
  if(T==='items') $$('[data-av]').forEach(b=>b.onclick=()=>{ S.anaVer=+b.dataset.av; render(); });
  if(T==='sheet'){ showSheetPreview(ex); $('#printSheet').onclick=()=>printSheet(ex); }
  if(T==='roster') bindRoster();
  if(T==='gs') bindGs();
}
function bindKey(ex){
  $('#exName').onchange=async e=>{ ex.name=e.target.value.trim()||'ชุดข้อสอบ'; await persist(); render(); };
  $('#exN').onchange=async e=>{ ex.numQ=Math.max(1,Math.min(100,parseInt(e.target.value)||ex.numQ)); await persist(); render(); };
  const c=$('#exC'); if(c) c.onchange=async e=>{ ex.choices=+e.target.value; ex.keys=ex.keys.map(k=>k.map(x=>x==='*'?x:[...x].filter(ch=>LET.indexOf(ch)<ex.choices).join(''))); await persist(); render(); };
  const v=$('#exV'); if(v) v.onchange=async e=>{ ex.versions=+e.target.value; while(ex.keys.length<ex.versions) ex.keys.push([]); S.keyVer=0; await persist(); render(); };
  $('#exD').onchange=async e=>{ ex.idDigits=+e.target.value; await persist(); render(); };
  $$('[data-sec]').forEach(cb=>cb.onchange=async()=>{ ex.sections=$$('[data-sec]').filter(x=>x.checked).map(x=>x.dataset.sec); await persist(); });
  $$('[data-kv]').forEach(b=>b.onclick=()=>{ S.keyVer=+b.dataset.kv; render(); });
  const kv=()=>Math.min(S.keyVer,ex.versions-1);
  const setKey=(q,val)=>{ const v=kv(); while(ex.keys.length<=v) ex.keys.push([]); const k=keyOf(ex,v); k[q]=val; ex.keys[v]=k; };
  $$('[data-k]').forEach(b=>b.onclick=async()=>{
    const [q,i]=b.dataset.k.split(':').map(Number), cur=keyOf(ex,kv())[q]; let s=cur==='*'?'':cur;
    s=s.includes(LET[i])?s.replace(LET[i],''):[...(s+LET[i])].sort().join('');
    setKey(q,s);
    const row=b.parentElement; row.classList.toggle('missing',!s); row.classList.remove('cancel');
    row.querySelectorAll('.bub').forEach((x,j)=>x.classList.toggle('on',s.includes(LET[j])));
    const xb=row.querySelector('.x'); xb.classList.remove('on'); xb.textContent='ยกเลิกข้อ';
    const n=keyFilled(ex,kv()), ch=$('#keyCount'); ch.textContent=`${n}/${ex.numQ} ข้อ`; ch.className='chip '+(n===ex.numQ?'ok':'warn');
    await persist();
  });
  $$('[data-cancel]').forEach(b=>b.onclick=async()=>{ const q=+b.dataset.cancel; setKey(q, keyOf(ex,kv())[q]==='*'?'':'*'); await persist(); render(); });
  $('#keyApply').onclick=async()=>{
    const map={'ก':'A','ข':'B','ค':'C','ง':'D','จ':'E','1':'A','2':'B','3':'C','4':'D','5':'E','ถ':'A','ผ':'B','T':'A','F':'B','t':'A','f':'B'};
    const raw=$('#keyText').value.replace(/[\s,]/g,'');
    const arr=[...raw].map(c=>{ const m=map[c]||(ex.choices>2&&'ABCDE'.includes(c.toUpperCase())?c.toUpperCase():''); return LET.indexOf(m)<ex.choices?m:''; });
    if(!arr.length) return;
    if(arr.length>ex.numQ) ex.numQ=Math.min(100,arr.length);
    const v=kv(); const k=keyOf(ex,v); arr.slice(0,100).forEach((c,i)=>{ if(i<k.length) k[i]=c; }); ex.keys[v]=k;
    await persist(); toast(`ใส่เฉลย ${arr.length} ข้อแล้ว`); render();
  };
  $('#keyPick').onchange=async e=>{ const f=e.target.files[0]; e.target.value=''; if(f) readKeySheet(ex,f,kv()); };
  $('#wAdd').onclick=async()=>{ ex.weightRules.push({from:1,to:ex.numQ,pts:2}); await persist(); render(); };
  $$('[data-wr]').forEach(inp=>inp.onchange=async()=>{ const [i,f]=inp.dataset.wr.split(':'); ex.weightRules[+i][f]=+inp.value; await persist(); render(); });
  $$('[data-wdel]').forEach(b=>b.onclick=async()=>{ ex.weightRules.splice(+b.dataset.wdel,1); await persist(); render(); });
  const d=$('#delExam'); if(d) d.onclick=()=>{ S.pending='delExam'; render(); };
  const dy=$('#delYes'); if(dy) dy.onclick=async()=>{
    ex.results.forEach(r=>dropImages(r.uid)); await Store.remove(ex.id); S.exams=S.exams.filter(e=>e.id!==ex.id); S.pending=null;
    if(!S.exams.length){ const n=newExam('exam','ชุดข้อสอบ 1'); S.exams=[n]; await Store.save(n); }
    S.cur=S.exams[0].id; toast('ลบชุดแล้ว'); render(); };
  const dn=$('#delNo'); if(dn) dn.onclick=()=>{ S.pending=null; render(); };
}
function bindRoster(){
  const take=(replace)=>{
    const rows=parseRoster($('#rosterText').value);
    if(!rows.length){ toast('ไม่พบรหัสนักศึกษาในข้อความที่วาง'); return; }
    if(replace) Roster.list=[];
    const m=new Map(Roster.list.map(s=>[s.sid,s])); rows.forEach(s=>m.set(s.sid,Object.assign(m.get(s.sid)||{},s)));
    Roster.list=[...m.values()]; Roster.save(); toast(`นำเข้า ${rows.length} คน · รวม ${Roster.list.length} คน`); render(); scheduleResync();
  };
  $('#rosterAdd').onclick=()=>take(false);
  $('#rosterReplace').onclick=()=>take(true);
  $('#rosterPull').onclick=async()=>{
    try{ const j=await gsPost({action:'roster'});
      if(!j.ok) throw new Error(j.error);
      if(j.created){ toast('สร้างแท็บ “รายชื่อ” ในชีตแล้ว วางรายชื่อในแท็บนั้นแล้วกดดึงอีกครั้ง'); return; }
      const rows=parseRoster(j.rows); if(!rows.length){ toast('แท็บ “รายชื่อ” ยังไม่มีรหัสนักศึกษา'); return; }
      const m=new Map(Roster.list.map(s=>[s.sid,s])); rows.forEach(s=>m.set(s.sid,s)); Roster.list=[...m.values()]; Roster.save();
      toast(`ดึงรายชื่อ ${rows.length} คนแล้ว`); render(); scheduleResync();
    }catch(e){ toast('ดึงรายชื่อไม่ได้: '+errText(e)); }
  };
  const q=$('#rosterQ'); if(q){ q.oninput=e=>{ S.rosterQ=e.target.value; const pos=e.target.selectionStart; render(); const n=$('#rosterQ'); n.focus(); n.setSelectionRange(pos,pos); }; }
  const csv=$('#rosterCsv'); if(csv) csv.onclick=()=>saveFile('รายชื่อนักศึกษา.csv', toCsv([['รหัสนักศึกษา','ชื่อ-สกุล','หมู่เรียน']].concat(Roster.list.map(s=>["'"+s.sid,s.name,s.sec]))));
  $$('[data-rdel]').forEach(b=>b.onclick=()=>{ Roster.list=Roster.list.filter(s=>s.sid!==b.dataset.rdel); Roster.save(); render(); });
  const rc=$('#rclear'); if(rc) rc.onclick=()=>{ S.pending='rclear'; render(); };
  const ry=$('#rclearYes'); if(ry) ry.onclick=()=>{ Roster.list=[]; Roster.save(); S.pending=null; render(); scheduleResync(); };
  const rn=$('#rclearNo'); if(rn) rn.onclick=()=>{ S.pending=null; render(); };
}
/* names live in sheet rows, so a roster change re-sends rows */
function scheduleResync(){ S.exams.forEach(ex=>ex.results.forEach(r=>{ r.syncedSig=null; })); S.exams.forEach(ex=>Store.save(ex)); scheduleSync(800); }

/* ---------------- tables for export ---------------- */
function resultsTable(ex){
  const rs=filteredResults(ex), L=n=>Array.from({length:ex.numQ},(_,i)=>'ข้อ '+(i+1));
  if(isSurvey(ex)){
    const head=['ผู้ตอบ'].concat(ex.idDigits?['รหัส','ชื่อ-สกุล','หมู่เรียน']:[]).concat(['ค่าเฉลี่ย','ต้องตรวจ']).concat(L());
    return [head].concat(rs.map(r=>{ const st=stud(r)||{}; return [r.no].concat(ex.idDigits?["'"+(r.sid||''),st.name||'',st.sec||'']:[]).concat([respMean(ex,r)??'',flagsOf(ex,r)||'']).concat([...r.ans.slice(0,ex.numQ)].map(c=>valueOf(ex,c)??'')); }));
  }
  const head=['ลำดับ','รหัสนักศึกษา','ชื่อ-สกุล','หมู่เรียน'].concat(ex.versions>1?['ชุด']:[]).concat(['คะแนน','คะแนนเต็ม','ร้อยละ','ต้องตรวจ']).concat(L());
  const keys=[];
  for(let v=0;v<ex.versions;v++) keys.push(['',ex.versions>1?'เฉลยชุด '+VER_TH[v]:'เฉลย','',''].concat(ex.versions>1?['']:[]).concat(['','','','']).concat(keyOf(ex,v).map(k=>keyLabel(ex,k))));
  return [head].concat(keys).concat(rs.map((r,i)=>{ const st=stud(r)||{}, s=scoreOf(ex,r), mx=maxScore(ex,Math.max(0,verOf(ex,r)??0));
    return [i+1,"'"+(r.sid||''),st.name||'',st.sec||''].concat(ex.versions>1?[r.ver>=0?VER_TH[r.ver]:'']:[]).concat([s??'',mx,s!=null&&mx?r2(s/mx*100):'',flagsOf(ex,r)||'']).concat([...r.ans.slice(0,ex.numQ)].map(c=>ansLabel(ex,c))); }));
}
function itemsTable(ex){
  if(isSurvey(ex)) return [['ข้อ','จำนวนผู้ตอบ','ค่าเฉลี่ย','S.D.','ระดับ','5','4','3','2','1']].concat(surveySummary(ex).map(i=>[i.q+1,i.n,i.mean==null?'':i.mean.toFixed(2),i.sd==null?'':i.sd.toFixed(2),likertLevel(i.mean),...i.dist]));
  const out=[];
  for(let v=0;v<ex.versions;v++){
    const A=itemAnalysis(ex,v); if(!A) continue;
    out.push(['ชุด','ข้อ','เฉลย','ความยาก p','อำนาจจำแนก r',...labels(ex),'ไม่ตอบ/หลายข้อ','ตัวลวงไม่ทำงาน']);
    A.items.forEach(it=>out.push([VER_TH[v],it.q+1,keyLabel(ex,it.k),it.p==null?'':it.p.toFixed(3),it.r==null?'':it.r.toFixed(3),...it.cnt,it.dead]));
  }
  return out;
}

/* ---------------- image loading ---------------- */
const MAXDIM=2000;
function toImageData(src,w,h){
  const s=Math.min(1,MAXDIM/Math.max(w,h)), cw=Math.round(w*s), ch=Math.round(h*s);
  const c=document.createElement('canvas'); c.width=cw; c.height=ch; const x=c.getContext('2d',{willReadFrequently:true});
  x.fillStyle='#fff'; x.fillRect(0,0,cw,ch); x.drawImage(src,0,0,cw,ch);
  return {canvas:c, data:x.getImageData(0,0,cw,ch)};
}
async function loadImageFile(f){
  try{ const bm=await createImageBitmap(f,{imageOrientation:'from-image'}); const r=toImageData(bm,bm.width,bm.height); bm.close&&bm.close(); return r; }
  catch(e){ const url=URL.createObjectURL(f); try{ const im=new Image(); im.src=url; await im.decode(); return toImageData(im,im.naturalWidth,im.naturalHeight); } finally{ URL.revokeObjectURL(url); } }
}
let pdfReady=null;
function loadScript(src){ return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s); }); }
function ensurePdf(){ if(!pdfReady) pdfReady=(async()=>{ await loadScript('vendor/pdf.min.js'); pdfjsLib.GlobalWorkerOptions.workerSrc='vendor/pdf.worker.min.js'; })(); return pdfReady; }
async function* pdfPages(f){
  await ensurePdf();
  const doc=await pdfjsLib.getDocument({data:new Uint8Array(await f.arrayBuffer())}).promise;
  for(let p=1;p<=doc.numPages;p++){
    const page=await doc.getPage(p), v0=page.getViewport({scale:1}), v=page.getViewport({scale:MAXDIM/Math.max(v0.width,v0.height)});
    const c=document.createElement('canvas'); c.width=Math.round(v.width); c.height=Math.round(v.height);
    const x=c.getContext('2d',{willReadFrequently:true}); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height);
    await page.render({canvasContext:x,viewport:v}).promise;
    yield {page:p,total:doc.numPages,canvas:c,data:x.getImageData(0,0,c.width,c.height)};
    page.cleanup();
  }
}
async function* expand(files){
  for(const f of files){
    if(f.type==='application/pdf'||/\.pdf$/i.test(f.name)){
      try{ for await (const pg of pdfPages(f)) yield Object.assign({src:`${f.name} หน้า ${pg.page}`},pg); }
      catch(e){ yield {src:f.name,error:'เปิดไฟล์ PDF ไม่ได้'}; }
    } else {
      try{ yield Object.assign({src:f.name}, await loadImageFile(f)); }
      catch(e){ yield {src:f.name,error:'เปิดไฟล์ภาพไม่ได้'}; }
    }
  }
}
/* straightened copy of the sheet, 4 px per mm */
const RK=4;
function rectify(img,H){
  const W=Math.round(LAYOUT.page[0]*RK), Hh=Math.round(LAYOUT.page[1]*RK);
  const c=document.createElement('canvas'); c.width=W; c.height=Hh; const x=c.getContext('2d');
  const out=x.createImageData(W,Hh), o=out.data, d=img.data, iw=img.width, ih=img.height;
  for(let y=0;y<Hh;y++) for(let X=0;X<W;X++){
    const [u,v]=OMR.apply(H,(X+.5)/RK,(y+.5)/RK), j=(y*W+X)*4, xi=Math.round(u), yi=Math.round(v);
    if(xi<0||yi<0||xi>=iw||yi>=ih){ o[j]=o[j+1]=o[j+2]=o[j+3]=255; continue; }
    const i=(yi*iw+xi)*4; o[j]=d[i]; o[j+1]=d[i+1]; o[j+2]=d[i+2]; o[j+3]=255;
  }
  x.putImageData(out,0,0);
  return c.toDataURL('image/jpeg',0.72);
}

/* picture of the handwritten name line, 10 px per mm */
const NAME_BOX=[30.5,40.3,123.5,48.6];
function cropName(img,H){
  const k=10,[x0,y0,x1,y1]=NAME_BOX, W=Math.round((x1-x0)*k), Hh=Math.round((y1-y0)*k);
  const c=document.createElement('canvas'); c.width=W; c.height=Hh; const x=c.getContext('2d');
  const out=x.createImageData(W,Hh), o=out.data, d=img.data, iw=img.width, ih=img.height;
  for(let y=0;y<Hh;y++) for(let X=0;X<W;X++){
    const [u,v]=OMR.apply(H,x0+(X+.5)/k,y0+(y+.5)/k), j=(y*W+X)*4, xi=Math.round(u), yi=Math.round(v);
    if(xi<0||yi<0||xi>=iw||yi>=ih){ o[j]=o[j+1]=o[j+2]=o[j+3]=255; continue; }
    const i=(yi*iw+xi)*4; o[j]=d[i]; o[j+1]=d[i+1]; o[j+2]=d[i+2]; o[j+3]=255;
  }
  x.putImageData(out,0,0);
  return c.toDataURL('image/jpeg',0.85);
}
function dropImages(uid){ ImgStore.del(uid); ImgStore.del('n:'+uid); delete S.images[uid]; delete S.names[uid]; }
async function nameImg(uid){ if(S.names[uid]) return S.names[uid]; const u=await ImgStore.get('n:'+uid); if(u) S.names[uid]=u; return u||null; }
/* fill <img data-nimg> placeholders after a render */
async function fillNameImgs(root=document){ for(const im of $$('img[data-nimg]',root)){ const u=await nameImg(im.dataset.nimg); if(u){ im.src=u; im.hidden=false; } } }

/* ---------------- reading ---------------- */
function readOpts(ex){ return {numQ:ex.numQ, choices:ex.choices, idDigits:ex.idDigits, versions:isSurvey(ex)?0:ex.versions, sens:+Settings.sens||1}; }
function resultFromRead(r,ex){
  let ans=''; const flags=[], multi={};
  for(let q=0;q<ex.numQ;q++){ const a=r.answers[q]; ans+=a.pick>=0?LET[a.pick]:a.state==='multi'?'*':'-'; if(a.state==='multi'||a.state==='unsure') flags.push(q); if(a.state==='multi') multi[q]=a.picks; }
  const sid=ex.idDigits?r.id.str.replace(/\s/g,''):'';
  let ver=0;
  if(!isSurvey(ex)&&ex.versions>1){ const v=r.version; ver=v&&v.pick>=0&&v.state==='ok'?v.pick:v&&v.pick>=0?v.pick:-1; if(v&&v.state!=='ok'&&v.pick>=0) flags.push(-1); }
  return {ans, flags:flags.filter(q=>q>=0), sid, multi, ver, verUnsure:flags.includes(-1), idUnsure:!!r.id.unsure};
}
function queueDelete(ex,r){ if(r&&r.syncedSig){ (ex.deletes=ex.deletes||[]).push(r.uid); } }
function addResult(ex,r,data,src){
  const res=resultFromRead(r,ex), uid=uidNew('r');
  const prev=res.sid&&sidOk(ex,res.sid)?ex.results.findIndex(x=>x.sid===res.sid):-1;
  const rec={uid, sid:res.sid, ver:res.ver, ans:res.ans, flags:res.flags, multi:res.multi, src, at:Date.now()};
  if(res.idUnsure) rec.idUnsure=true; if(res.verUnsure) rec.verUnsure=true;
  if(isSurvey(ex)) rec.no=Math.max(0,...ex.results.map(x=>x.no||0))+1;
  let replaced=false;
  if(prev>=0){ const old=ex.results[prev]; queueDelete(ex,old); dropImages(old.uid); if(old.ocrName&&!rec.ocrName){ rec.ocrName=old.ocrName; rec.ocrTried=true; } if(isSurvey(ex)) rec.no=old.no; ex.results.splice(prev,1); replaced=true; }
  ex.results.push(rec);
  try{ const url=rectify(data,r.H); S.images[uid]=url; ImgStore.put(uid,url); }catch(e){}
  if(ex.idDigits>0){ try{ const n=cropName(data,r.H); S.names[uid]=n; ImgStore.put('n:'+uid,n); rec.hasName=true; }catch(e){} }
  return {rec,replaced};
}
async function handleFiles(files){
  const ex=exam(); if(!ex||!files.length) return;
  if(S.busy){ toast('กำลังตรวจชุดก่อนหน้า รอสักครู่'); return; }
  S.busy=true; S.prog=2; S.progText='กำลังเปิดไฟล์…'; render();
  let done=0, ok=0, fail=0, est=files.length;
  for await (const it of expand(files)){
    if(it.total) est=Math.max(est,done+(it.total-it.page+1)+(files.length-1));
    S.progText=`กำลังอ่าน ${it.src}`; S.prog=Math.min(98,Math.round(done/est*100)+2);
    const p=$('.progress i'); if(p) p.style.width=S.prog+'%'; const t=$('#progText'); if(t) t.textContent=S.progText;
    await tick();
    const entry={exam:ex.id, src:it.src, uid:null};
    if(it.error){ entry.error=it.error; fail++; }
    else{
      const r=OMR.read({width:it.data.width,height:it.data.height,data:it.data.data},LAYOUT,readOpts(ex));
      if(!r.ok){ entry.error='หาสี่เหลี่ยมดำที่มุมไม่ครบ 4 มุม ถ่ายใหม่ให้เห็นทั้งแผ่น'; fail++; }
      else{ const {rec,replaced}=addResult(ex,r,it.data,it.src); entry.uid=rec.uid; entry.replaced=replaced; ok++; }
    }
    S.session.push(entry); done++;
  }
  await persist(); S.busy=false; render();
  toast(`ตรวจแล้ว ${ok} แผ่น${fail?` · อ่านไม่ได้ ${fail} แผ่น`:''}`);
}
async function readKeySheet(ex,f,v){
  toast('กำลังอ่านเฉลย…');
  let first=null; for await (const it of expand([f])){ first=it; break; }
  if(!first||first.error){ toast('เปิดไฟล์ไม่ได้'); return; }
  const r=OMR.read({width:first.data.width,height:first.data.height,data:first.data.data},LAYOUT,Object.assign(readOpts(ex),{numQ:100,idDigits:0}));
  if(!r.ok){ toast('หาสี่เหลี่ยมดำที่มุมไม่ครบ ถ่ายใหม่ให้เห็นทั้งแผ่น'); return; }
  let last=0; const k=r.answers.map((a,i)=>{ if(a.pick>=0){ last=i+1; return LET[a.pick]; } if(a.state==='multi'){ last=i+1; return a.picks.map(p=>LET[p]).join(''); } return ''; });
  if(!last){ toast('ไม่พบคำตอบบนกระดาษแผ่นนี้'); return; }
  const unsure=r.answers.slice(0,last).filter(a=>a.state==='unsure').length;
  ex.numQ=Math.max(ex.numQ,last); while(ex.keys.length<=v) ex.keys.push([]); ex.keys[v]=k.slice(0,ex.numQ);
  await persist(); render();
  toast(`อ่านเฉลย${ex.versions>1?'ชุด '+VER_TH[v]:''}ได้ ${last} ข้อ${unsure?` · มี ${unsure} ข้อที่รอยฝนไม่ชัด ตรวจอีกครั้ง`:''}`);
}

/* ---------------- live camera ---------------- */
const Live={on:false};
let audioCtx=null;
function feedback(ok){
  try{ if(audioCtx){ const o=audioCtx.createOscillator(), g=audioCtx.createGain(); o.frequency.value=ok?1320:440; g.gain.setValueAtTime(0.18,audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.001,audioCtx.currentTime+0.18); o.connect(g).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime+0.2); } }catch(e){}
  try{ navigator.vibrate&&navigator.vibrate(ok?70:[40,60,40]); }catch(e){}
}
function setHint(t,cls){ const h=$('#camHint'); if(!h) return; if(h.textContent!==t) h.textContent=t; h.className='camhint'+(cls?' '+cls:''); }
function quadArea(p){ let a=0; for(let i=0;i<4;i++){ const q=p[(i+1)%4]; a+=p[i][0]*q[1]-q[0]*p[i][1]; } return Math.abs(a)/2; }
function grab(canvas,v,maxDim){
  const vw=v.videoWidth, vh=v.videoHeight, s=Math.min(1,maxDim/Math.max(vw,vh)), w=Math.round(vw*s), h=Math.round(vh*s);
  if(canvas.width!==w||canvas.height!==h){ canvas.width=w; canvas.height=h; }
  const x=canvas.getContext('2d',{willReadFrequently:true}); x.drawImage(v,0,0,w,h);
  return {s, data:x.getImageData(0,0,w,h)};
}
function drawOverlay(corners,s,good){
  const v=$('#camVid'), ov=$('#camOv'); if(!v||!ov) return;
  const cw=ov.clientWidth, ch=ov.clientHeight, dpr=window.devicePixelRatio||1;
  if(ov.width!==Math.round(cw*dpr)||ov.height!==Math.round(ch*dpr)){ ov.width=Math.round(cw*dpr); ov.height=Math.round(ch*dpr); }
  const x=ov.getContext('2d'); x.setTransform(dpr,0,0,dpr,0,0); x.clearRect(0,0,cw,ch);
  if(!corners||!v.videoWidth) return;
  const vw=v.videoWidth, vh=v.videoHeight, k=Math.min(cw/vw,ch/vh), ox=(cw-vw*k)/2, oy=(ch-vh*k)/2;
  const P=corners.map(([a,b])=>[ox+a/s*k, oy+b/s*k]);
  x.lineWidth=4; x.lineJoin='round'; x.strokeStyle=good?'#2ecc71':'#f1c40f'; x.fillStyle=good?'rgba(46,204,113,.14)':'rgba(241,196,15,.10)';
  x.beginPath(); P.forEach(([a,b],i)=>i?x.lineTo(a,b):x.moveTo(a,b)); x.closePath(); x.fill(); x.stroke();
  P.forEach(([a,b])=>{ x.beginPath(); x.arc(a,b,7,0,Math.PI*2); x.fillStyle=good?'#2ecc71':'#f1c40f'; x.fill(); });
}
async function backCameras(){
  const all=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
  const back=all.filter(d=>/back|rear|environment|หลัง/i.test(d.label));
  return back.length?back:all;
}
function mainGuess(list){ return list.find(d=>/\b0, facing back/i.test(d.label))||list.find(d=>/camera2 0\b/i.test(d.label))||list[0]; }
function stopCamera(){ try{ Live.stream&&Live.stream.getTracks().forEach(t=>t.stop()); }catch(e){} Live.stream=null; }
async function startCamera(deviceId){
  stopCamera();
  const base={width:{ideal:1920},height:{ideal:1440}};
  Live.stream=await navigator.mediaDevices.getUserMedia({audio:false, video:deviceId?Object.assign({deviceId:{exact:deviceId}},base):Object.assign({facingMode:{ideal:'environment'}},base)});
  const v=$('#camVid'); if(v){ v.srcObject=Live.stream; try{ await v.play(); }catch(e){} }
  Live.track=Live.stream.getVideoTracks()[0]; Live.prev=null; Live.stable=0;
  const t=$('#camTorch'); if(t){ t.hidden=true; t.classList.remove('on'); }
  try{
    const cap=Live.track.getCapabilities&&Live.track.getCapabilities(), st=Live.track.getSettings();
    if(cap&&cap.torch&&t){ t.hidden=false; let on=false; t.onclick=async()=>{ on=!on; try{ await Live.track.applyConstraints({advanced:[{torch:on}]}); t.classList.toggle('on',on); }catch(e){ on=!on; } }; }
    if(cap&&cap.focusMode&&cap.focusMode.includes('continuous')) Live.track.applyConstraints({advanced:[{focusMode:'continuous'}]}).catch(()=>{});
    if(cap&&cap.zoom&&st&&st.zoom>cap.zoom.min) Live.track.applyConstraints({advanced:[{zoom:cap.zoom.min}]}).catch(()=>{});
  }catch(e){}
}
async function openLive(){
  const ex=exam(); if(!ex) return;
  try{ audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)(); audioCtx.resume&&audioCtx.resume(); }catch(e){}
  Object.assign(Live,{on:true,stable:0,prev:null,missing:0,lastSid:null,lastAns:null,lastReadAt:0,attempts:0,count:0,paused:false});
  $('#layer').innerHTML=`<div class="cam" id="cam" role="dialog" aria-label="สแกนด้วยกล้อง">
    <video id="camVid" playsinline muted autoplay></video><canvas id="camOv"></canvas>
    <div class="camtop"><div><b>${esc(ex.name)}</b><span id="camCount">สแกนแล้ว 0 แผ่น</span></div>
      <button id="camSwitch" hidden>สลับกล้อง</button><button id="camTorch" hidden>ไฟฉาย</button><button id="camClose" class="primary">เสร็จ</button></div>
    <div class="camhint" id="camHint">กำลังเปิดกล้อง…</div><div class="camres" id="camRes" hidden></div></div>`;
  $('#camClose').onclick=closeLive;
  try{
    try{ await startCamera(Settings.camId||null); }
    catch(e){ if(Settings.camId&&e&&e.name!=='NotAllowedError'){ Settings.camId=''; saveSettings(); await startCamera(null); } else throw e; }
  }catch(e){ closeLive(); toast(e&&e.name==='NotAllowedError'?'แอปยังไม่ได้รับอนุญาตให้ใช้กล้อง เปิดสิทธิ์กล้องในการตั้งค่าของเบราว์เซอร์':'เปิดกล้องไม่ได้ ใช้ปุ่ม “ถ่ายรูป” แทน'); return; }
  if(!Live.on){ stopCamera(); return; }
  try{
    Live.cams=await backCameras();
    if(!Settings.camId&&Live.cams.length>1){ const g=mainGuess(Live.cams), cur=Live.track.getSettings().deviceId; if(g&&g.deviceId&&g.deviceId!==cur){ try{ await startCamera(g.deviceId); }catch(e){ await startCamera(null); } } }
    if(Live.cams.length>1){ const sw=$('#camSwitch'); sw.hidden=false;
      sw.onclick=async()=>{ const cur=Live.track.getSettings().deviceId, i=Math.max(0,Live.cams.findIndex(d=>d.deviceId===cur)), n=Live.cams[(i+1)%Live.cams.length];
        try{ await startCamera(n.deviceId); Settings.camId=n.deviceId; saveSettings(); setHint(`กล้องหลังตัวที่ ${(i+1)%Live.cams.length+1} จาก ${Live.cams.length}`); }
        catch(e){ toast('เปิดกล้องตัวนี้ไม่ได้'); try{ await startCamera(cur); }catch(_){} } }; }
  }catch(e){}
  try{ Live.wake=await navigator.wakeLock.request('screen'); }catch(e){}
  Live.small=document.createElement('canvas'); Live.full=document.createElement('canvas');
  setHint('เล็งให้เห็นสี่เหลี่ยมดำครบ 4 มุม');
  liveLoop();
}
function closeLive(){ Live.on=false; clearTimeout(Live.t); stopCamera(); try{ Live.wake&&Live.wake.release(); }catch(e){} Live.wake=null; $('#layer').innerHTML=''; render(); }
document.addEventListener('visibilitychange',async()=>{ if(Live.on&&document.visibilityState==='visible'&&!Live.wake){ try{ Live.wake=await navigator.wakeLock.request('screen'); }catch(e){} } if(document.visibilityState==='hidden') Live.wake=null; });
async function liveLoop(){
  if(!Live.on) return;
  let delay=160; const v=$('#camVid');
  try{
    if(!Live.paused&&v&&v.readyState>=2&&v.videoWidth){
      const g=grab(Live.small,v,720);
      const loc=OMR.locate({width:g.data.width,height:g.data.height,data:g.data.data},LAYOUT);
      if(loc.error){
        Live.missing++; Live.stable=0; Live.prev=null; Live.attempts=0; drawOverlay(null);
        if(Live.missing>=2) setHint(Live.count?'วางแผ่นถัดไป ให้เห็นสี่เหลี่ยมดำครบ 4 มุม':'เล็งให้เห็นสี่เหลี่ยมดำครบ 4 มุม');
      } else {
        Live.missing=0;
        const W=g.data.width, H=g.data.height, dim=Math.max(W,H);
        const mv=Live.prev?Math.max(...loc.corners.map((p,i)=>Math.hypot(p[0]-Live.prev[i][0],p[1]-Live.prev[i][1])))/dim:1;
        Live.prev=loc.corners; Live.stable=mv<0.015?Live.stable+1:1;
        const area=quadArea(loc.corners)/(W*H);
        drawOverlay(loc.corners,g.s,Live.stable>=3&&area>=0.2);
        if(area<0.2){ setHint('เลื่อนกล้องเข้าใกล้อีกนิด ให้กระดาษเต็มจอ'); Live.stable=0; }
        else if(Live.stable<3){ if(!/ตรวจแล้ว|บันทึกแล้ว/.test(($('#camHint')||{}).textContent||'')) setHint('ถือนิ่ง ๆ…'); }
        else if(Date.now()-Live.lastReadAt>650){ await liveRead(v); delay=220; }
      }
    }
  }catch(e){ console.error(e); }
  Live.t=setTimeout(liveLoop,delay);
}
async function liveRead(v){
  const ex=exam(); Live.lastReadAt=Date.now();
  const g=grab(Live.full,v,2000);
  const r=OMR.read({width:g.data.width,height:g.data.height,data:g.data.data},LAYOUT,readOpts(ex));
  if(!r.ok) return;
  const res=resultFromRead(r,ex), idOk=ex.idDigits>0&&sidOk(ex,res.sid)&&!res.idUnsure;
  if((idOk&&res.sid===Live.lastSid)||res.ans===Live.lastAns){ setHint('แผ่นนี้ตรวจแล้ว เปลี่ยนแผ่นถัดไปได้เลย','done'); return; }
  const shaky=res.flags.length>Math.max(3,ex.numQ*0.15)||(ex.idDigits>0&&!idOk)||(ex.versions>1&&!isSurvey(ex)&&res.ver<0);
  if(shaky&&Live.attempts<3){ Live.attempts++; setHint('ภาพยังไม่ชัด ถือนิ่ง ๆ…'); return; }
  Live.attempts=0;
  const src='กล้อง '+new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const {rec,replaced}=addResult(ex,r,g.data,src);
  S.session.push({exam:ex.id,src,uid:rec.uid,replaced});
  Live.lastSid=idOk?res.sid:null; Live.lastAns=res.ans; Live.count++;
  await persist(); feedback(!flagsOf(ex,rec)); showLiveResult(ex,rec,replaced);
  setHint('บันทึกแล้ว เปลี่ยนแผ่นถัดไปได้เลย','done');
}
function showLiveResult(ex,rec,replaced){
  const el=$('#camRes'); if(!el) return;
  const f=flagsOf(ex,rec), surv=isSurvey(ex);
  el.hidden=false; el.className='camres '+(f?'warnb':'okb');
  el.innerHTML=`<div class="row" style="align-items:flex-start"><div class="grow">
      <div class="latest-score mono">${surv?scoreText(ex,rec)+'<small> เฉลี่ย</small>':`${scoreOf(ex,rec)??'–'}<small>/${maxScore(ex,Math.max(0,verOf(ex,rec)??0))}</small>`}</div>
      <div><span class="mono">${esc(ex.idDigits?rec.sid||'อ่านรหัสไม่ได้':'')}</span> ${personText(ex,rec)}${!surv&&ex.versions>1?` · ชุด ${rec.ver>=0?VER_TH[rec.ver]:'?'}`:''}</div>
      ${rec.hasName?`<img class="nimg" data-nimg="${rec.uid}" alt="ลายมือชื่อ" hidden>`:''}</div>
    <div style="display:grid;gap:6px;justify-items:end">${chipFor(ex,rec)}${replaced?'<span class="chip plain">แทนผลเดิม</span>':''}</div></div>
    <div class="row"><button id="camEdit">${f?'ดูข้อที่ต้องตรวจ':'ดู/แก้คำตอบ'}</button><button id="camAgain" class="ghost">สแกนแผ่นนี้ใหม่</button></div>`;
  $('#camCount').textContent=`สแกนแล้ว ${Live.count} แผ่น`; fillNameImgs(el);
  $('#camEdit').onclick=()=>{ Live.paused=true; openReview(rec.uid,()=>{ Live.paused=false; const ex2=exam(), r2_=ex2.results.find(x=>x.uid===rec.uid); if(r2_) showLiveResult(ex2,r2_,replaced); else el.hidden=true; }); };
  $('#camAgain').onclick=()=>{ Live.lastSid=null; Live.lastAns=null; Live.lastReadAt=0; el.hidden=true; setHint('ถือนิ่ง ๆ…'); };
}

/* ---------------- review drawer ---------------- */
async function openReview(uid,onClose){
  const ex=exam(), r=ex.results.find(x=>x.uid===uid); if(!r) return;
  if(!S.images[uid]){ const u=await ImgStore.get(uid); if(u) S.images[uid]=u; }
  const img=S.images[uid]; let showAll=!flagsOf(ex,r);
  const L=labels(ex), surv=isSurvey(ex);
  const draw=()=>{
    const fl=new Set(r.flags||[]), qs=showAll?[...Array(ex.numQ).keys()]:[...fl];
    const v=verOf(ex,r), k=!surv&&v>=0?keyOf(ex,v):[];
    const st=stud(r), sug=ex.idDigits&&!Roster.get(r.sid)&&Roster.list.length?Roster.suggest(r.sid):[];
    $('#layer2').innerHTML=`<div class="overlay" id="ov"><div class="drawer" role="dialog" aria-label="ตรวจกระดาษคำตอบ">
      <div class="drawer-head">
        ${ex.idDigits?`<div class="grow" style="flex-basis:220px"><label class="hint" for="sidIn">รหัสนักศึกษา${st?` · <b style="color:var(--ink)">${esc(st.name)}</b>${st.sec?' หมู่ '+esc(st.sec):''}`:''}</label>
          <input type="text" id="sidIn" class="mono" value="${esc(r.sid)}" inputmode="numeric" style="width:100%;${sidOk(ex,r.sid)&&(st||!Roster.list.length)?'':'border-color:var(--bad)'}"></div>`:`<div class="grow"><b>ผู้ตอบคนที่ ${r.no}</b></div>`}
        <div class="stat" style="min-width:110px"><b>${scoreText(ex,r)}</b><span>${surv?'ค่าเฉลี่ย':'คะแนน'}</span></div>
        <button class="primary" id="rvDone">เสร็จ</button></div>
      <div class="drawer-body">
        <div>${img?`<div class="sheetview"><canvas id="rvCanvas"></canvas></div><p class="hint" style="margin-top:6px">${surv?'วงสีน้ำเงิน = คำตอบที่อ่านได้':'เขียว = ถูก · แดง = ผิด · เส้นประ = เฉลย'} · เหลือง = ข้อที่ต้องตรวจ</p>`:'<div class="card hint">ไม่มีภาพของแผ่นนี้ในเครื่องนี้ แก้คำตอบได้จากรายการด้านขวา</div>'}</div>
        <div style="display:grid;gap:12px;align-content:start">
          ${r.hasName?`<div class="card" style="padding:10px 14px"><span class="hint">ลายมือชื่อในกระดาษ</span><img class="nimg big" data-nimg="${r.uid}" alt="ลายมือชื่อ" hidden>
            ${Roster.get(r.sid)?'':`<label class="field" style="margin-top:6px"><span>ชื่อ-สกุล${r.ocrTried?' (อ่านจากลายมือ แก้ได้)':Settings.url&&Settings.ocr?' (จะอ่านจากลายมือเมื่อส่งเข้า Google Sheet)':''}</span><input type="text" id="ocrIn" value="${esc(r.ocrName||'')}" placeholder="พิมพ์ชื่อ-สกุล"></label>`}</div>`:''}
          ${sug.length?`<div class="card warnbox suggest"><span class="hint">ไม่พบรหัสนี้ในรายชื่อ ใช่คนนี้ไหม</span>${sug.map(s=>`<button data-sug="${esc(s.sid)}">${esc(s.sid)} · ${esc(s.name)}</button>`).join('')}</div>`:
            ex.idDigits&&!Roster.get(r.sid)&&Roster.list.length&&sidOk(ex,r.sid)?'<p class="hint" style="color:var(--bad)">ไม่พบรหัสนี้ในรายชื่อ ตรวจรหัสจากภาพ หรือเพิ่มรายชื่อในแท็บรายชื่อ</p>':''}
          ${ex.idDigits&&sidOk(ex,r.sid)&&r.idUnsure?'<div class="card warnbox row"><span class="hint grow">รอยฝนรหัสบางหลักไม่ชัด ตรวจรหัสกับภาพ</span><button id="sidOk">รหัสถูกต้อง</button></div>':''}
          ${ex.idDigits&&!sidOk(ex,r.sid)?`<p class="hint" style="color:var(--bad)">อ่านรหัสนักศึกษาไม่ครบ ${ex.idDigits} หลัก ดูจากภาพแล้วพิมพ์ในช่องด้านบน</p>`:''}
          ${!surv&&ex.versions>1?`<div class="row"><span class="hint">ชุดข้อสอบ</span><div class="seg">${VER_TH.slice(0,ex.versions).map((t,i)=>`<button data-rv="${i}" aria-pressed="${r.ver===i}">${t}</button>`).join('')}</div>${r.ver<0?'<span class="chip bad">ไม่ได้ฝนชุด</span>':''}</div>`:''}
          <div class="row"><h3 style="margin:0">${showAll?'คำตอบทุกข้อ':`ข้อที่ต้องตรวจ ${fl.size} ข้อ`}</h3><span class="grow"></span><button id="rvToggle">${showAll?'ดูเฉพาะข้อที่ต้องตรวจ':'แสดงทุกข้อ'}</button></div>
          ${qs.length?`<div class="card" style="padding:10px 14px">${qs.map(q=>{ const a=r.ans[q], kk=k[q]||'';
            return `<div class="krow"><span class="n" ${fl.has(q)?'style="color:var(--warn);font-weight:600"':''}>${q+1}</span>${L.map((t,i)=>{ const on=a===LET[i], det=(r.multi&&r.multi[q]||[]).includes(i)&&a==='*';
              const cls=(on?(surv?'on':isRight(kk,LET[i])?'on right':'on wrong'):'')+(det?' det':''); return `<button class="bub ${cls}" data-a="${q}:${i}" aria-label="ข้อ ${q+1} ${t}">${t}</button>`; }).join('')}
              <span class="hint" style="margin-left:8px;font-size:12.5px">${a==='*'?'ตอบหลายข้อ':a==='-'?'ไม่ได้ตอบ':''}${!surv&&kk?` · เฉลย ${esc(keyLabel(ex,kk))}`:''}</span>
              ${fl.has(q)?`<button class="ghost" data-okq="${q}" style="margin-left:auto;padding:2px 8px">ยืนยัน</button>`:''}</div>`; }).join('')}</div>`:'<div class="card hint">ไม่มีข้อที่ต้องตรวจ</div>'}
          <div class="row">${S.pending==='delRes'?`<span class="confirm">ลบผลของแผ่นนี้? <button class="danger" id="rvDelYes">ลบ</button><button id="rvDelNo">ยกเลิก</button></span>`:'<button class="ghost danger" id="rvDel">ลบผลแผ่นนี้</button>'}</div>
        </div></div></div></div>`;
    if(img) paintSheet(img,ex,r);
    fillNameImgs($('#layer2'));
    const oi=$('#ocrIn'); if(oi) oi.onchange=async e=>{ r.ocrName=e.target.value.trim(); r.ocrTried=true; r.edited=true; await persist(); draw(); };
    $('#ov').onclick=e=>{ if(e.target.id==='ov') close(); };
    $('#rvDone').onclick=close;
    $('#rvToggle').onclick=()=>{ showAll=!showAll; draw(); };
    const si=$('#sidIn'); if(si) si.onchange=async e=>{ r.sid=e.target.value.replace(/\s/g,''); r.idUnsure=false; r.edited=true; await persist(); draw(); };
    const sc=$('#sidOk'); if(sc) sc.onclick=async()=>{ r.idUnsure=false; r.edited=true; await persist(); draw(); };
    $$('[data-sug]').forEach(b=>b.onclick=async()=>{ r.sid=b.dataset.sug; r.idUnsure=false; r.edited=true; await persist(); draw(); });
    $$('[data-rv]').forEach(b=>b.onclick=async()=>{ r.ver=+b.dataset.rv; r.verUnsure=false; r.edited=true; await persist(); draw(); });
    $$('[data-a]').forEach(b=>b.onclick=async()=>{ const [q,i]=b.dataset.a.split(':').map(Number); const arr=[...r.ans]; arr[q]=arr[q]===LET[i]?'-':LET[i]; r.ans=arr.join(''); r.flags=(r.flags||[]).filter(x=>x!==q); r.edited=true; await persist(); draw(); });
    $$('[data-okq]').forEach(b=>b.onclick=async()=>{ const q=+b.dataset.okq; r.flags=(r.flags||[]).filter(x=>x!==q); r.edited=true; await persist(); draw(); });
    const d=$('#rvDel'); if(d) d.onclick=()=>{ S.pending='delRes'; draw(); };
    const dy=$('#rvDelYes'); if(dy) dy.onclick=async()=>{ queueDelete(ex,r); dropImages(r.uid); ex.results=ex.results.filter(x=>x!==r); S.pending=null; await persist(); close(); toast('ลบผลแล้ว'); };
    const dn=$('#rvDelNo'); if(dn) dn.onclick=()=>{ S.pending=null; draw(); };
  };
  const close=()=>{ $('#layer2').innerHTML=''; S.pending=null; document.removeEventListener('keydown',onKey); render(); if(onClose) onClose(); };
  const onKey=e=>{ if(e.key==='Escape') close(); };
  document.addEventListener('keydown',onKey);
  draw();
}
/* draws marks over the straightened sheet; returns a promise of the canvas */
function markSheet(canvas,url,ex,r){
  return new Promise(res=>{
    const im=new Image();
    im.onload=()=>{
      canvas.width=im.naturalWidth; canvas.height=im.naturalHeight; const x=canvas.getContext('2d'); x.drawImage(im,0,0);
      const col={ok:'#17a35e',bad:'#d6372e',warn:'#e9a400',info:'#2f6fe0'};
      const P=(mx,my)=>[mx*RK,my*RK], rad=LAYOUT.qR*RK*1.45, fl=new Set(r.flags||[]), surv=isSurvey(ex);
      const v=verOf(ex,r), k=!surv&&v>=0?keyOf(ex,v):[];
      x.lineWidth=Math.max(2,rad*0.28);
      for(let q=0;q<ex.numQ;q++){
        const a=r.ans[q], kk=k[q]||'', row=LAYOUT.questions[q];
        if(fl.has(q)){ const [u1,v1]=P(...row[0]), [u2,v2]=P(...row[ex.choices-1]); x.strokeStyle=col.warn; x.strokeRect(Math.min(u1,u2)-rad*1.2,Math.min(v1,v2)-rad*1.2,Math.abs(u2-u1)+rad*2.4,Math.abs(v2-v1)+rad*2.4); }
        const i=LET.indexOf(a);
        if(i>=0){ const [u,vv]=P(...row[i]); x.strokeStyle=surv||!kk?col.info:isRight(kk,a)?col.ok:col.bad; x.beginPath(); x.arc(u,vv,rad,0,Math.PI*2); x.stroke(); }
        if(!surv&&kk&&kk!=='*'&&!isRight(kk,a)){ [...kk].forEach(c=>{ const j=LET.indexOf(c); if(j<0) return; const [u,vv]=P(...row[j]); x.strokeStyle=col.ok; x.setLineDash([rad*.4,rad*.3]); x.beginPath(); x.arc(u,vv,rad*.8,0,Math.PI*2); x.stroke(); x.setLineDash([]); }); }
      }
      if(ex.idDigits) LAYOUT.idCols.slice(0,ex.idDigits).forEach((c,ci)=>{ const d=r.sid[ci]; if(d>='0'&&d<='9'){ const [u,vv]=P(...c[+d]); x.strokeStyle=col.ok; x.beginPath(); x.arc(u,vv,LAYOUT.idR*RK*1.4,0,Math.PI*2); x.stroke(); } });
      if(!surv&&ex.versions>1&&r.ver>=0){ const [u,vv]=P(...LAYOUT.verBubbles[r.ver]); x.strokeStyle=col.ok; x.beginPath(); x.arc(u,vv,rad,0,Math.PI*2); x.stroke(); }
      res(canvas);
    };
    im.onerror=()=>res(null);
    im.src=url;
  });
}
function paintSheet(url,ex,r){ const c=$('#rvCanvas'); if(c) markSheet(c,url,ex,r); }

/* ---------------- answer sheet generator ---------------- */
const FONT_CSS=`@font-face{font-family:S;src:url(fonts/sarabun-thai-400.woff2) format('woff2');font-weight:400;unicode-range:U+0E00-0E7F}
@font-face{font-family:S;src:url(fonts/sarabun-thai-700.woff2) format('woff2');font-weight:700;unicode-range:U+0E00-0E7F}
@font-face{font-family:S;src:url(fonts/sarabun-latin-400.woff2) format('woff2');font-weight:400}
@font-face{font-family:S;src:url(fonts/sarabun-latin-700.woff2) format('woff2');font-weight:700}`;
function sheetHTML(ex){
  const Lb=LAYOUT, surv=isSurvey(ex), L=labels(ex), els=[];
  const rect=(x,y,w,h,st='')=>els.push(`<div style="position:absolute;left:${x}mm;top:${y}mm;width:${w}mm;height:${h}mm;${st}"></div>`);
  const text=(x,y,s,st='',anchor='left')=>els.push(`<div class="t" style="position:absolute;left:${x}mm;top:${y}mm;${anchor==='center'?'transform:translateX(-50%);':anchor==='right'?'transform:translateX(-100%);':''}${st}">${s}</div>`);
  const bub=(cx,cy,r,lab)=>els.push(`<div class="b" style="left:${cx-r}mm;top:${cy-r}mm;width:${2*r}mm;height:${2*r}mm">${lab}</div>`);
  const field=(x,y,label,w,val='')=>{ text(x,y,label,'font-size:10.5pt'); const lx=x+label.length*1.75+1.5; els.push(`<div style="position:absolute;left:${lx}mm;top:${y+5.2}mm;width:${w}mm;border-bottom:0.25mm dotted #555"></div>`); if(val) text(lx+1,y+0.6,esc(val),`font-size:10pt;max-width:${w-1}mm;overflow:hidden`); };
  const FID=Lb.fidSize;
  Lb.fid.forEach(([cx,cy])=>rect(cx-FID/2,cy-FID/2,FID,FID,'background:#000'));
  rect(Lb.bar[0]-15,Lb.bar[1]-2,30,4,'background:#000');
  text(20,16.2,'มหาวิทยาลัยราชภัฏสงขลา','font-size:15pt;font-weight:700');
  text(20,23.2,'คณะวิทยาศาสตร์และเทคโนโลยี','font-size:11.5pt');
  text(196,16.6,surv?'กระดาษคำตอบแบบสอบถาม':'กระดาษคำตอบแบบปรนัย','font-size:13pt;font-weight:700','right');
  text(196,23.2,surv?`${ex.numQ} ข้อ · มาตราส่วน 5 ระดับ`:`${ex.numQ} ข้อ · ${ex.choices===2?'ถูก/ผิด':L.join(' ')}`,'font-size:10pt;color:#444','right');
  rect(13,31.5,183,0.3,'background:#000');
  field(13,34,surv?'เรื่อง':'วิชา/ชุด',100,ex.name);
  field(140,34,'ภาค/ปี',42);
  if(ex.idDigits){ field(13,42,'ชื่อ-สกุล',92); field(126,42,'หมู่เรียน',14); field(160,42,'ห้อง',26); }
  else text(13,42,'ไม่ต้องเขียนชื่อผู้ตอบ คำตอบของท่านจะนำไปวิเคราะห์ในภาพรวมเท่านั้น','font-size:10.5pt;color:#444');
  // left box: student ID, or the scale legend for an anonymous survey
  rect(13,51,74,69,'border:0.3mm solid #000;border-radius:1.5mm');
  if(ex.idDigits){
    const cols=Lb.idCols.slice(0,ex.idDigits), x0=cols[0][0][0], x1=cols[cols.length-1][0][0];
    text((x0+x1)/2,52.2,surv?'รหัสผู้ตอบ':'รหัสนักศึกษา','font-size:10.5pt;font-weight:700','center');
    cols.forEach(col=>{ rect(col[0][0]-2.6,58.2,5.2,5.6,'border:0.25mm solid #333;box-sizing:border-box'); col.forEach(([cx,cy],d)=>bub(cx,cy,Lb.idR,d)); });
  } else {
    text(50,53,'ระดับความคิดเห็น','font-size:11pt;font-weight:700','center');
    [5,4,3,2,1].forEach((n,i)=>{ bub(24,64+i*10,2.6,n); text(30,61.2+i*10,`= ${LIKERT_TEXT[n]}`,'font-size:11pt'); });
  }
  rect(92,51,104,69,'border:0.3mm solid #000;border-radius:1.5mm');
  text(96,52.6,'คำชี้แจง','font-size:10.5pt;font-weight:700');
  const lines=surv?[
    '1. อ่านข้อความแต่ละข้อในแบบสอบถาม แล้วฝนระดับความคิดเห็น',
    '2. ใช้ปากกาหรือดินสอ ทำเครื่องหมาย ✕ หรือระบายทึบในวงกลม',
    '&nbsp;&nbsp;&nbsp;&nbsp;ข้อละ 1 ระดับเท่านั้น',
    ex.idDigits?'3. เขียนและฝนรหัสผู้ตอบให้ครบทุกหลัก':'3. ตอบให้ครบทุกข้อ',
    '4. ห้ามขีดเขียน พับ หรือทำให้สี่เหลี่ยมดำที่มุมกระดาษเปื้อน']:[
    '1. เขียนรหัสนักศึกษาในช่องสี่เหลี่ยม และฝนตัวเลขใต้ช่องให้ครบทุกหลัก',
    '2. ใช้ปากกาหรือดินสอ ทำเครื่องหมาย ✕ หรือระบายทึบในวงกลม',
    '&nbsp;&nbsp;&nbsp;&nbsp;ให้เต็มวงกลม ข้อละ 1 คำตอบเท่านั้น',
    '3. หากต้องการแก้ไข ให้ใช้เทปลบคำผิดปิดวงกลมเดิมให้สะอาด',
    '4. ห้ามขีดเขียน พับ หรือทำให้สี่เหลี่ยมดำที่มุมกระดาษเปื้อน'];
  lines.forEach((s,i)=>text(96,59.2+i*5.3,s,'font-size:9.4pt'));
  text(96,87.6,'ตัวอย่าง','font-size:9.4pt;font-weight:700');
  const exL=L.slice(0,Math.min(5,L.length));
  exL.forEach((lab,k)=>bub(115+k*6.2,90.3,2.1,lab));
  els.push(`<div style="position:absolute;left:${115+Math.min(2,exL.length-1)*6.2-2.4}mm;top:${90.3-2.4}mm;width:4.8mm;height:4.8mm;font-size:13pt;line-height:4.8mm;text-align:center;color:#000;font-weight:700">✕</div>`);
  text(150,87.6,'หรือ','font-size:9.4pt');
  exL.forEach((lab,k)=>bub(159+k*6.2,90.3,2.1,lab));
  els.push(`<div style="position:absolute;left:${159+Math.min(1,exL.length-1)*6.2-2.1}mm;top:${90.3-2.1}mm;width:4.2mm;height:4.2mm;border-radius:50%;background:#000"></div>`);
  rect(96,97,96,0.25,'background:#999');
  if(surv){ text(144,104,'ขอบคุณที่ให้ความร่วมมือ','font-size:10.5pt;color:#444','center'); }
  else {
    text(96,99.5,'ลงชื่อผู้คุมสอบ','font-size:9.4pt');
    els.push('<div style="position:absolute;left:121mm;top:104.3mm;width:34mm;border-bottom:0.25mm dotted #555"></div>');
    if(ex.versions>1){ text(96,108.2,'ฝนชุดข้อสอบ','font-size:9.4pt;font-weight:700'); Lb.verBubbles.slice(0,ex.versions).forEach(([cx,cy],k)=>bub(cx,cy,Lb.verR,VER_TH[k])); }
    rect(160,99,32,18,'border:0.3mm solid #000');
    text(176,99.8,'คะแนน','font-size:9pt;color:#444','center');
  }
  // answer grid (same positions as every other sheet, unused bubbles are simply not printed)
  const Q=Lb.questions, PER=25, nCols=Math.ceil(ex.numQ/PER);
  const y0=Q[0][0][1], pitch=Q[1][0][1]-Q[0][0][1];
  for(let c=0;c<nCols;c++){
    const first=Q[c*PER][0][0], x0=first-12;
    L.forEach((lab,k)=>text(Q[c*PER][k][0],y0-7.6,lab,'font-size:10pt;font-weight:700','center'));
    for(let rr=0;rr<PER;rr++){
      const q=c*PER+rr; if(q>=ex.numQ) break;
      const y=Q[q][0][1];
      if(Math.floor(rr/5)%2===1) rect(x0+0.5,y-pitch/2,43,pitch,'background:#ededed');
      text(x0+7.4,y-2.55,q+1,'font-size:9.6pt;font-weight:700','right');
      Q[q].slice(0,ex.choices).forEach(([cx,cy],k)=>bub(cx,cy,Lb.qR,L[k]));
    }
    if(c) rect(x0-1.3,y0-8.4,0.25,Math.min(PER,ex.numQ-c*PER)*pitch+5.6,'background:#000');
  }
  rect(13,y0-9.2,183,0.3,'background:#000');
  text(105,279.6,`${surv?'เรื่อง':'ชุด'} ${esc(String(ex.name).slice(0,40))} · พิมพ์ขนาด A4 เต็มหน้า (100%) ห้ามย่อหรือขยาย`,'font-size:8pt;color:#666','center');
  return `<div class="omrpage">${els.join('')}</div>`;
}
const SHEET_CSS=`.omrpage{position:relative;width:210mm;height:297mm;overflow:hidden;font-family:S,sans-serif;color:#000;background:#fff;page-break-after:always;break-after:page}
  .omrpage .t{white-space:nowrap;line-height:1.25}
  .omrpage .b{position:absolute;box-sizing:border-box;border:0.28mm solid #555;border-radius:50%;font-size:6.2pt;color:#a8a8a8;display:flex;align-items:center;justify-content:center;line-height:1}
  .omrpage:last-child{page-break-after:auto;break-after:auto}`;
function sheetDoc(ex){ return `<!doctype html><html><head><meta charset="utf-8"><style>${FONT_CSS}${SHEET_CSS} html,body{margin:0;padding:0;background:#fff}</style></head><body>${sheetHTML(ex)}</body></html>`; }
function printSheet(ex){ printParts(SHEET_CSS, sheetHTML(ex), '@page{size:A4;margin:0}'); }
function showSheetPreview(ex){
  const f=$('#sheetPrev'), wrap=$('#sheetWrap'); if(!f) return;
  f.srcdoc=sheetDoc(ex);
  const fit=()=>{ const s=(wrap.clientWidth-24)/794; f.style.transform=`scale(${s})`; wrap.style.height=(1123*s+24)+'px'; };
  fit(); window.addEventListener('resize',fit,{once:true});
}
/* print by placing the pages in the main document; other content is hidden while printing */
async function printParts(css,body,pageRule){
  let area=$('#printArea'); if(!area){ area=document.createElement('div'); area.id='printArea'; document.body.appendChild(area); }
  area.innerHTML=`<style>${FONT_CSS}${css}
    #printArea{display:none}
    @media print{ ${pageRule} html,body{padding:0!important;margin:0!important;background:#fff!important;min-height:0!important}
      body>*:not(#printArea){display:none!important} #printArea{display:block!important} }</style>${body}`;
  try{ await Promise.race([document.fonts.load('16px S'),new Promise(r=>setTimeout(r,1500))]); await document.fonts.ready; }catch(e){}
  await Promise.all([...area.querySelectorAll('img')].map(i=>i.decode?i.decode().catch(()=>{}):0));
  try{ window.print(); }catch(e){ toast('พิมพ์จากหน้านี้ไม่ได้ ลองเปิดแอปใน Chrome บนคอมพิวเตอร์'); }
}
/* ---------------- marked return sheets ---------------- */
async function printReturnSheets(ex){
  const rs=filteredResults(ex); if(!rs.length) return;
  toast(`กำลังเตรียม ${rs.length} หน้า…`);
  const pages=[];
  for(const r of rs){
    const st=stud(r)||{}, s=scoreOf(ex,r), mx=maxScore(ex,Math.max(0,verOf(ex,r)??0));
    let url=S.images[r.uid]||await ImgStore.get(r.uid), imgTag='';
    if(url){ const c=await markSheet(document.createElement('canvas'),url,ex,r);
      if(c){ const blob=await new Promise(res=>c.toBlob(res,'image/jpeg',0.82)); imgTag=`<img src="${URL.createObjectURL(blob)}" style="width:150mm;display:block;margin:4mm auto 0;border:0.3mm solid #999">`; } }
    if(!imgTag){ const k=keyOf(ex,Math.max(0,verOf(ex,r)??0));
      imgTag=`<table class="ans">${[...Array(ex.numQ).keys()].map(q=>`<tr><td>${q+1}</td><td>${ansLabel(ex,r.ans[q])||'–'}</td><td>${esc(keyLabel(ex,k[q]))}</td><td>${isRight(k[q],r.ans[q])?'✓':'✗'}</td></tr>`).join('')}</table>`; }
    pages.push(`<section class="pg"><h1>${esc(ex.name)}</h1><table class="hd"><tr><td>ชื่อ-สกุล</td><td><b>${esc(st.name||'')}</b></td><td>รหัส</td><td class="m">${esc(r.sid||'')}</td></tr>
      <tr><td>หมู่เรียน</td><td>${esc(st.sec||'')}${ex.versions>1?` · ชุด ${r.ver>=0?VER_TH[r.ver]:'–'}`:''}</td><td>คะแนน</td><td><b>${s??'–'} / ${mx}</b>${s!=null&&mx?` (${(s/mx*100).toFixed(1)}%)`:''}</td></tr></table>
      <p class="lg">วงเขียว = ตอบถูก · วงแดง = ตอบผิด · วงประสีเขียว = คำตอบที่ถูก · กรอบเหลือง = ผู้สอนตรวจซ้ำ</p>${imgTag}</section>`);
    await tick();
  }
  printParts(`#printArea .pg{font-family:S,sans-serif;color:#000;page-break-after:always;break-after:page} #printArea .pg:last-child{page-break-after:auto;break-after:auto}
    #printArea .pg h1{font-size:14pt;margin:0 0 2mm} #printArea .hd{width:100%;border-collapse:collapse;font-size:11pt} #printArea .hd td{padding:1mm 2mm;border-bottom:0.2mm solid #ccc}
    #printArea .m{font-family:monospace} #printArea .lg{font-size:9pt;color:#555;margin:2mm 0 0} #printArea .ans{font-size:9pt;border-collapse:collapse} #printArea .ans td{border:0.2mm solid #ccc;padding:0.5mm 2mm}`,
    pages.join(''), '@page{size:A4;margin:10mm}');
}

/* ---------------- Google Sheet sync ---------------- */
const Sync={busy:false,timer:null,retry:null,err:null,last:null,again:false};
function sheetHeader(ex){
  const qcols=Array.from({length:ex.numQ},(_,i)=>'ข้อ '+(i+1));
  if(isSurvey(ex)){ const h=['ผู้ตอบ'].concat(ex.idDigits?['รหัส','ชื่อ-สกุล','หมู่เรียน']:[]).concat(['ค่าเฉลี่ย','ต้องตรวจ (จุด)','เวลาสแกน','รหัสอ้างอิง']); return {h:h.concat(qcols),n:h.length}; }
  const h=['รหัสนักศึกษา','ชื่อ-สกุล','หมู่เรียน'].concat(ex.versions>1?['ชุด']:[]).concat(['คะแนน','คะแนนเต็ม','ร้อยละ','ต้องตรวจ (จุด)','เวลาสแกน','รหัสอ้างอิง']);
  return {h:h.concat(qcols),n:h.length};
}
function layoutSig(ex){ const {h}=sheetHeader(ex); let x=0; const s=h.join('|')+'|'+ex.kind; for(let i=0;i<s.length;i++) x=(x*31+s.charCodeAt(i))|0; return 'v2:'+(x>>>0).toString(36); }
function sigOf(ex,r){ const st=stud(r)||{}; return [r.ocrName||'',layoutSig(ex),r.sid,r.ver,r.ans,JSON.stringify(ex.keys),JSON.stringify(ex.weightRules),ex.name,flagsOf(ex,r),st.name||'',st.sec||''].join('|'); }
function needsOcr(ex,r){ return Settings.ocr&&Settings.scriptVer>=3&&!Sync.ocrBlocked&&r.hasName&&!r.ocrTried&&!Roster.get(r.sid); }
function dirtyRows(ex){ return ex.results.filter(r=>r.syncedSig!==sigOf(ex,r)||needsOcr(ex,r)); }
function pendingCount(){ return S.exams.reduce((n,ex)=>n+dirtyRows(ex).length+(ex.deletes||[]).length,0); }
function scheduleSync(ms=1500){ updateSyncChip(); if(!Settings.url||!Settings.auto) return; clearTimeout(Sync.timer); Sync.timer=setTimeout(()=>doSync(false),ms); }
function errText(e){
  const m=String(e&&e.message||e);
  if(m==='token') return 'รหัสลับไม่ตรงกับในโค้ด Apps Script';
  if(m==='action'||m==='old_script') return 'โค้ด Apps Script เป็นรุ่นเก่า กรุณาอัปเดตโค้ดตามขั้นตอน “อัปเดตโค้ดรุ่นใหม่” ในแท็บตั้งค่า';
  if(m==='html'||e instanceof TypeError) return 'เชื่อมต่อไม่ได้ ตรวจ URL ว่าลงท้ายด้วย /exec และตั้งสิทธิ์เข้าถึงเป็น “ทุกคน”';
  if(m==='offline') return 'ไม่มีอินเทอร์เน็ต จะส่งให้เมื่อกลับมาออนไลน์';
  return m;
}
async function gsPost(payload){
  const res=await fetch(Settings.url,{method:'POST',body:JSON.stringify(Object.assign({token:Settings.token},payload)),redirect:'follow'});
  const t=await res.text(); try{ return JSON.parse(t); }catch(e){ throw new Error(/<html|<!doctype/i.test(t)?'html':'ตอบกลับไม่ถูกต้อง'); }
}
function sheetMeta(ex,n){
  const pad=a=>{ const r=a.slice(); while(r.length<n) r.push(''); return r; };
  if(isSurvey(ex)){
    const it=surveySummary(ex);
    return [pad(['ค่าเฉลี่ย']).concat(it.map(i=>i.mean==null?'':r2(i.mean))), pad(['S.D.']).concat(it.map(i=>i.sd==null?'':r2(i.sd))), pad(['จำนวนผู้ตอบ']).concat(it.map(i=>i.n))];
  }
  const out=[];
  for(let v=0;v<ex.versions;v++) out.push(pad([ex.versions>1?'เฉลยชุด '+VER_TH[v]:'เฉลย']).concat(keyOf(ex,v).map(k=>keyLabel(ex,k))));
  if((ex.weightRules||[]).length) out.push(pad(['คะแนนรายข้อ']).concat(weights(ex)));
  return out;
}
function sheetRow(ex,r){
  const st=stud(r)||{}, ans=[...r.ans.slice(0,ex.numQ)];
  if(isSurvey(ex)) return [ex.idDigits?r.sid||'':r.no].concat(ex.idDigits?[r.sid||'',st.name||'',st.sec||'']:[]).concat([respMean(ex,r)??'',flagsOf(ex,r)||'',r.at||'',r.uid]).concat(ans.map(c=>c==='*'?'หลายข้อ':valueOf(ex,c)??''));
  const s=scoreOf(ex,r), mx=maxScore(ex,Math.max(0,verOf(ex,r)??0));
  return [r.sid||'',st.name||'',st.sec||''].concat(ex.versions>1?[r.ver>=0?VER_TH[r.ver]:'']:[]).concat([s??'',mx,s!=null&&mx?r2(s/mx*100):'',flagsOf(ex,r)||'',r.at||'',r.uid]).concat(ans.map(c=>ansLabel(ex,c)));
}
async function doSync(manual){
  if(!Settings.url){ if(manual) toast('ยังไม่ได้เชื่อม Google Sheet'); return; }
  if(Sync.busy){ Sync.again=true; return; }
  if(!navigator.onLine){ Sync.err=errText('offline'); updateSyncChip(); return; }
  Sync.busy=true; updateSyncChip();
  let sent=0, removed=0;
  try{
    for(const ex of S.exams){
      const d=dirtyRows(ex), dels=[...(ex.deletes||[])];
      if(!d.length&&!dels.length) continue;
      const {h,n}=sheetHeader(ex), sig=layoutSig(ex), nameCol=h.indexOf('ชื่อ-สกุล')+1;
      // a request carries at most 5 handwriting pictures (each takes Google a few seconds to read)
      const chunks=[]; let cur=[], ocrN=0;
      for(const r of d){ const o=needsOcr(ex,r); if(cur.length>=300||(o&&ocrN>=5)){ chunks.push(cur); cur=[]; ocrN=0; } cur.push(r); if(o) ocrN++; }
      if(cur.length||!chunks.length) chunks.push(cur);
      for(let i=0;i<chunks.length;i++){
        const chunk=chunks[i];
        const rows=[];
        for(const r of chunk){ const row={uid:r.uid,cells:sheetRow(ex,r)}; if(needsOcr(ex,r)){ const u=await nameImg(r.uid); if(u) row.nameImg=u; } rows.push(row); }
        const j=await gsPost({action:'sync2', tab:{id:ex.id,name:ex.name}, header:h, uidCol:n, dateCol:n-1, nameCol:nameCol||0, sig, meta:sheetMeta(ex,n),
          rows, deletes:i===0?dels:[]});
        if(!j.ok) throw new Error(j.error||'ส่งไม่สำเร็จ');
        if(j.ver){ Settings.scriptVer=j.ver; }
        const names=j.names||{};
        rows.forEach(row=>{ if(row.nameImg&&row.uid in names){ const r=chunk.find(x=>x.uid===row.uid); if(names[row.uid]===null) return; r.ocrName=names[row.uid]||''; r.ocrTried=true; } });
        if(j.ocrError){ Sync.ocrErr=/403|401|uthoriz|สิทธิ์|permission/i.test(j.ocrError)?'อ่านลายมือชื่อไม่ได้ เพราะยังไม่ได้อนุญาตสิทธิ์ ใน Apps Script ให้เลือกฟังก์ชัน authorize แล้วกด “เรียกใช้” หนึ่งครั้ง':'อ่านลายมือชื่อไม่ได้: '+j.ocrError; Sync.ocrBlocked=true; } else if(rows.some(x=>x.nameImg)) Sync.ocrErr=null;
        chunk.forEach(r=>{ r.syncedSig=sigOf(ex,r); });
        if(i===0){ ex.deletes=(ex.deletes||[]).filter(u=>!dels.includes(u)); removed+=dels.length; }
        if(j.url) ex.sheetUrl=j.url;
        sent+=chunk.length; await Store.save(ex);
      }
    }
    if(S.tab==='scores'||S.tab==='scan') render();
    Sync.err=null; Sync.last=Date.now(); saveSettings();
    if(manual) toast(sent||removed?`ส่งเข้า Google Sheet แล้ว ${sent} รายการ`:'ข้อมูลใน Google Sheet เป็นปัจจุบันแล้ว');
    if(!Sync.ocrBlocked&&S.exams.some(ex=>ex.results.some(r=>needsOcr(ex,r)))) Sync.again=true;
  }catch(e){ Sync.err=errText(e); if(manual) toast('ส่งไม่สำเร็จ: '+Sync.err); clearTimeout(Sync.retry); if(!/รุ่นเก่า|รหัสลับ/.test(Sync.err)) Sync.retry=setTimeout(()=>doSync(false),30000); }
  finally{ Sync.busy=false; updateSyncChip(); updateGsStatus(); if(Sync.again){ Sync.again=false; scheduleSync(300); } }
}
window.addEventListener('online',()=>scheduleSync(500));
function updateSyncChip(){
  const b=$('#syncChip'); if(!b) return; const n=pendingCount(); let t,c;
  if(!Settings.url){ t='Google Sheet: ยังไม่เชื่อม'; c='plain'; }
  else if(Sync.busy){ t='กำลังส่งเข้า Sheet…'; c='plain'; }
  else if(Sync.err){ t=/รุ่นเก่า/.test(Sync.err)?'ต้องอัปเดตโค้ด Apps Script':`ส่งไม่สำเร็จ · ค้าง ${n}`; c=navigator.onLine?'bad':'warn'; }
  else if(n){ t=`ค้างส่ง ${n}`; c='warn'; }
  else { t='Google Sheet ✓'; c='ok'; }
  b.textContent=t; b.className='chip syncchip '+c;
}
function updateGsStatus(){ const el=$('#gsStatus'); if(el){ el.innerHTML=gsStatusHtml(); bindGsStatus(); } }
function bindGsStatus(){
  const a=$('#gsNow'); if(a) a.onclick=()=>{ Sync.ocrBlocked=false; doSync(true); };
  const b=$('#gsAll'); if(b) b.onclick=()=>{ scheduleResync(); doSync(true); };
}
function bindGs(){
  bindGsStatus();
  $('#gsTest').onclick=async()=>{
    const url=$('#gsUrl').value.trim(); Settings.token=$('#gsToken').value.trim()||Settings.token;
    if(!/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(url)&&!/^https?:\/\/localhost/.test(url)){ toast('URL ต้องขึ้นต้นด้วย https://script.google.com/'); return; }
    Settings.url=url; saveSettings();
    const b=$('#gsTest'); b.disabled=true; b.textContent='กำลังทดสอบ…';
    try{ const j=await gsPost({action:'ping'}); if(!j.ok) throw new Error(j.error||'error');
      Settings.sheetName=j.sheet||''; Settings.scriptVer=j.ver||1; Sync.ocrBlocked=false; saveSettings();
      if((j.ver||1)<2){ Sync.err=errText('old_script'); toast(Sync.err); render(); return; }
      Sync.err=null; toast('เชื่อมต่อสำเร็จ'); render(); doSync(false);
    }catch(e){ Sync.err=errText(e); toast('เชื่อมต่อไม่ได้: '+Sync.err); render(); }
  };
  $('#gsToken').onchange=e=>{ Settings.token=e.target.value.trim()||Settings.token; saveSettings(); const box=$('#gsCodeBox'); if(box) box.textContent=gsCode(); };
  $('#gsAuto').onchange=e=>{ Settings.auto=e.target.checked; saveSettings(); if(Settings.auto) scheduleSync(300); };
  $('#gsCopy').onclick=()=>copyText(gsCode(),'คัดลอกโค้ดแล้ว ไปวางใน Apps Script ได้เลย');
  $('#ocrOn').onchange=e=>{ Settings.ocr=e.target.checked; saveSettings(); if(Settings.ocr){ Sync.ocrBlocked=false; scheduleSync(300); } };
  $('#sens').onchange=e=>{ Settings.sens=+e.target.value; saveSettings(); toast('บันทึกแล้ว ใช้กับแผ่นที่สแกนต่อจากนี้'); };
  $('#bkOut').onclick=()=>saveFile(`ตรวจข้อสอบ-สำรอง-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify({app:'omr',v:2,exams:S.exams,roster:Roster.list},null,1));
  $('#bkIn').onchange=async e=>{
    const f=e.target.files[0]; e.target.value=''; if(!f) return;
    try{ const j=JSON.parse(await f.text()); if(j.app!=='omr') throw 0;
      const m=new Map(S.exams.map(x=>[x.id,x])); (j.exams||[]).forEach(x=>m.set(x.id,migrate(x))); S.exams=[...m.values()]; for(const x of S.exams) await Store.save(x);
      if(j.roster&&j.roster.length){ const rm=new Map(Roster.list.map(s=>[s.sid,s])); j.roster.forEach(s=>rm.set(s.sid,s)); Roster.list=[...rm.values()]; Roster.save(); }
      toast(`นำเข้า ${(j.exams||[]).length} ชุดแล้ว`); render();
    }catch(err){ toast('ไฟล์นี้ไม่ใช่ไฟล์สำรองของแอป'); }
  };
}

/* ---------------- new exam / install / boot ---------------- */
function openNewExam(){
  $('#layer2').innerHTML=`<div class="modal" id="nm"><div><h2 style="margin:0">สร้างชุดใหม่</h2>
    <button class="choicecard" data-new="exam"><b>ข้อสอบ</b><span class="hint">ปรนัย 2–5 ตัวเลือก ถูก/ผิด หลายชุดสลับข้อ ตรวจกับเฉลยและวิเคราะห์ข้อสอบ</span></button>
    <button class="choicecard" data-new="survey"><b>แบบสอบถาม</b><span class="hint">มาตราส่วน 5 ระดับ สรุปค่าเฉลี่ยและ S.D. รายข้อ ไม่ต้องระบุผู้ตอบก็ได้</span></button>
    <button class="ghost" id="nmClose">ยกเลิก</button></div></div>`;
  $('#nmClose').onclick=()=>{ $('#layer2').innerHTML=''; };
  $('#nm').onclick=e=>{ if(e.target.id==='nm') $('#layer2').innerHTML=''; };
  $$('[data-new]').forEach(b=>b.onclick=async()=>{
    const kind=b.dataset.new, n=newExam(kind,(kind==='survey'?'แบบสอบถาม ':'ชุดข้อสอบ ')+(S.exams.length+1));
    S.exams.unshift(n); S.cur=n.id; S.tab='key'; await Store.save(n); $('#layer2').innerHTML=''; render(); const i=$('#exName'); if(i){ i.focus(); i.select(); }
  });
}
let deferredInstall=null;
const IS_IOS=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const IS_STANDALONE=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); deferredInstall=e; const b=$('#installBtn'); if(b) b.hidden=false; });
function installBanner(){
  if(!IS_IOS||IS_STANDALONE||Settings.iosHintOff) return '';
  return `<div class="card row" id="iosHint"><div class="grow"><b>ติดตั้งเป็นแอปบน iPhone</b><p class="hint">ใน Safari กดปุ่มแชร์ แล้วเลือก “เพิ่มไปยังหน้าจอโฮม”</p></div><button class="ghost" id="iosHintOff">ปิด</button></div>`;
}
$('#examSel').onchange=e=>{ S.cur=e.target.value; S.pending=null; S.keyVer=0; S.anaVer=0; S.secFilter=''; try{ localStorage.setItem('omr-cur',S.cur); }catch(_){} render(); };
$('#newExam').onclick=openNewExam;
$$('nav.tabs button').forEach(b=>b.onclick=()=>{ S.tab=b.dataset.tab; S.pending=null; render(); });
$('#syncChip').onclick=()=>{ S.tab='gs'; S.pending=null; render(); };
$('#installBtn').onclick=async()=>{ if(!deferredInstall) return; deferredInstall.prompt(); try{ await deferredInstall.userChoice; }catch(e){} deferredInstall=null; $('#installBtn').hidden=true; };
if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol)) window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));

async function boot(){
  render();
  await Store.init();
  S.exams=Store.all().map(migrate);
  if(!S.exams.length){ const ex=newExam('exam','ชุดข้อสอบ 1'); S.exams=[ex]; await Store.save(ex); }
  else for(const ex of S.exams) await Store.save(ex);
  S.exams.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  let last=null; try{ last=localStorage.getItem('omr-cur'); }catch(e){}
  S.cur=(S.exams.find(e=>e.id===last)||S.exams[0]).id;
  render(); scheduleSync(2500);
}
boot();
