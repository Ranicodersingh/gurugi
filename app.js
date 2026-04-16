'use strict';

// ══════════════════════════════════════════════════
//  DATABASE  (localStorage + Firebase sync)
// ══════════════════════════════════════════════════
const DB={
  gs(){return JSON.parse(localStorage.getItem('sp_students')||'[]');},
  ss(d){fbSet('sp_students',d);},
  gp(){return JSON.parse(localStorage.getItem('sp_payments')||'[]');},
  sp(d){fbSet('sp_payments',d);},
  gc(){return JSON.parse(localStorage.getItem('sp_classes')||'[]');},
  sc(d){fbSet('sp_classes',d);},
  gh(){return JSON.parse(localStorage.getItem('sp_hw')||'[]');},
  sh(d){fbSet('sp_hw',d);},
  gpr(){return JSON.parse(localStorage.getItem('sp_prog')||'[]');},
  spr(d){fbSet('sp_prog',d);},
  gb(){return JSON.parse(localStorage.getItem('sp_batches')||'[]');},
  sb(d){fbSet('sp_batches',d);},
  nid(a){return a.length?Math.max(...a.map(x=>x.id))+1:1;}
};

// ══════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════
const TPL_DEFAULTS={
  fee:`Hello {student} 👋\nFee reminder for {student}'s singing class.\nAmount due: {currency}{balance}\n\nPlease clear at your earliest convenience.\n\nThank you 🙏\n{teacher} — {institute}`,
  upcoming:`Hello {student} 🎵\nJust a reminder that {month} fees of {currency}{fee} are due soon.\nKindly pay on time to continue your classes without interruption.\n\nThank you 🙏\n{teacher} — {institute}`,
  class:`Hello {student} 🎵\nReminder: Your singing class is today!\nTime: {time}\n{meet}\n\n— {teacher}`,
  hw:`Hello {student} 📝\nHomework:\n\n{homework}\n\nDue: {due}\n\nPractise regularly! 🎤\n— {teacher}`,
  confirm:`Hello {student} ✅\nPayment of {currency}{amount} received for your singing class.\nThank you! 🙏\n\n— {teacher}, {institute}`
};

const SET_DEFAULT={
  teacher:'',inst:'',mynum:'',curr:'₹',
  tpl_fee:TPL_DEFAULTS.fee,tpl_class:TPL_DEFAULTS.class,
  tpl_hw:TPL_DEFAULTS.hw,tpl_confirm:TPL_DEFAULTS.confirm
};

function getSettings(){return Object.assign({},SET_DEFAULT,JSON.parse(localStorage.getItem('sp_settings')||'{}'));}
function saveSettingsObj(s){fbSet('sp_settings',s);}

// ══════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════
const now=new Date();
function curM(){return new Date().getMonth()+1;}
function curY(){return new Date().getFullYear();}
const MO=['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
let curPg='dash', prevPg='dash', editId=null, detId=null, payId=null, hwStuId=null, progStuId=null, attStuId=null, attClsId=null, batchAttClsId=null, batchAttBatchId=null;
let chipFilter='all', repTab='month', feeType='monthly', selDay=null, settingsDirty=false;

// ══════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════
function NR(n){return Number(n||0).toLocaleString('en-IN');}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}
function toast(m,t=''){
  const el=document.getElementById('toast');
  el.textContent=m;el.className='on'+(t?' '+t:'');
  clearTimeout(el._t);el._t=setTimeout(()=>el.className='',2800);
}
function fmt12(t){
  if(!t) return '';
  const[h,m]=t.split(':');
  const hr=+h;
  return (hr%12||12)+':'+m+' '+(hr<12?'AM':'PM');
}
function timeRange(t, durMins){
  if(!t) return '';
  const[h,m]=t.split(':');
  const startMins=+h*60+ +m;
  const endMins=startMins+(parseInt(durMins)||45);
  const eh=Math.floor(endMins/60), em=endMins%60;
  const endTime=(eh<10?'0':'')+eh+':'+(em<10?'0':'')+em;
  const dur=parseInt(durMins)||45;
  const durLabel=dur>=60?(Math.floor(dur/60)+'h'+(dur%60?' '+dur%60+'m':'')):(dur+'m');
  return fmt12(t)+' – '+fmt12(endTime)+' · '+durLabel;
}
function todayStr(){return new Date().toISOString().split('T')[0];}

// ══════════════════════════════════════════════════
//  FINANCE
// ══════════════════════════════════════════════════
function totalPaid(sid){return DB.gp().filter(p=>p.student_id===sid&&p.type==='fee').reduce((a,p)=>a+p.amount,0);}
function totalAdvance(sid){
  const adv=DB.gp().filter(p=>p.student_id===sid&&p.type==='advance').reduce((a,p)=>a+p.amount,0);
  const used=DB.gp().filter(p=>p.student_id===sid&&p.type==='advance_used').reduce((a,p)=>a+p.amount,0);
  return Math.max(0,adv-used);
}

function calcDue(s){
  const pays=DB.gp().filter(p=>p.student_id===s.id);
  const paid=pays.filter(p=>p.type==='fee').reduce((a,p)=>a+p.amount,0);
  const adv=totalAdvance(s.id);
  if(s.fee_type==='monthly'){
    if(!s.joining_date) return 0;
    const j=new Date(s.joining_date);
    let owed=(parseFloat(s.prev_due)||0);
    const jY=j.getFullYear(),jM=j.getMonth()+1;
    for(let y=jY;y<=curY();y++){
      const ms=(y===jY)?jM:1,me=(y===curY())?curM()-1:12;
      for(let m=ms;m<=me;m++) owed+=parseFloat(s.monthly_fee)||0;
    }
    return Math.max(0,owed-paid-adv);
  } else if(s.fee_type==='perclass'){
    const cls=DB.gc().filter(c=>c.student_id===s.id&&c.attended===true);
    const owed=cls.length*(parseFloat(s.per_class_fee)||0)+(parseFloat(s.prev_due)||0);
    return Math.max(0,owed-paid-adv);
  } else if(s.fee_type==='package'){
    const cls=DB.gc().filter(c=>c.student_id===s.id&&c.attended===true);
    const pkgCls=parseFloat(s.pkg_classes)||10;
    const pkgFee=parseFloat(s.pkg_fee)||0;
    const pkgsUsed=Math.ceil(cls.length/pkgCls);
    const owed=pkgsUsed*pkgFee+(parseFloat(s.prev_due)||0);
    return Math.max(0,owed-paid-adv);
  }
  return 0;
}

function monthCollected(){
  return DB.gp().filter(p=>p.type==='fee'&&p.year===curY()&&p.month===curM()).reduce((a,p)=>a+p.amount,0);
}
function monthClasses(){return DB.gc().filter(c=>{const d=new Date(c.date);return d.getMonth()+1===curM()&&d.getFullYear()===curY()&&c.attended===true;}).length;}

// Check if current month fee is unpaid for monthly students
function isCurrentMonthUnpaid(s){
  if(s.fee_type!=='monthly') return false;
  if(!s.joining_date) return false;
  const j=new Date(s.joining_date);
  // Student must have joined on or before this month
  if(j.getFullYear()>curY()||(j.getFullYear()===curY()&&j.getMonth()+1>curM())) return false;
  const paidThisMonth=DB.gp().filter(p=>p.student_id===s.id&&p.type==='fee'&&p.month===curM()&&p.year===curY()).reduce((a,p)=>a+p.amount,0);
  const fee=parseFloat(s.monthly_fee)||0;
  const adv=totalAdvance(s.id);
  return (paidThisMonth+adv)<fee;
}

// Within 7 days of month end — remind for next month
function isUpcomingReminder(s){
  if(s.fee_type!=='monthly') return false;
  const daysLeft=new Date(curY(),curM(),0).getDate()-new Date().getDate();
  if(daysLeft>7) return false;
  // Check if next month fee already paid
  const nextM=curM()%12+1, nextY=curM()===12?curY()+1:curY();
  const paidNext=DB.gp().filter(p=>p.student_id===s.id&&p.type==='fee'&&p.month===nextM&&p.year===nextY).reduce((a,p)=>a+p.amount,0);
  const adv=totalAdvance(s.id);
  const fee=parseFloat(s.monthly_fee)||0;
  return (paidNext+adv)<fee;
}

// ══════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════
const NAV_MAP={dash:'nb-dash',stu:'nb-stu',batch:'nb-batch',sch:'nb-sch',rep:'nb-rep',alerts:'nb-rep',set:'nb-set'};
function nav(p){
  document.querySelectorAll('.pg').forEach(x=>x.classList.remove('on'));
  document.querySelectorAll('.nb').forEach(x=>x.classList.remove('on'));
  document.getElementById('pg-'+p).classList.add('on');
  const nb=document.getElementById('nb-'+p);
  if(nb) nb.classList.add('on');
  document.getElementById('fab').className=(p==='stu')?'on':'';
  document.getElementById('scrollEl').scrollTop=0;
  prevPg=curPg; curPg=p;
  if(p==='dash')  renderDash();
  if(p==='stu')   renderStu();
  if(p==='batch') renderBatches();
  if(p==='sch')   renderSch();
  if(p==='rep')   {repTab='month';document.querySelectorAll('.rtab').forEach((t,i)=>t.classList.toggle('on',i===0));renderRep();}
  if(p==='alerts')renderAlerts();
  if(p==='set')   renderSettings();
  updateBell();
}

function goDetail(id){
  prevPg=curPg;detId=id;window.detId=id;
  document.querySelectorAll('.pg').forEach(x=>x.classList.remove('on'));
  document.querySelectorAll('.nb').forEach(x=>x.classList.remove('on'));
  document.getElementById('pg-det').classList.add('on');
  document.getElementById('fab').className='';
  document.getElementById('scrollEl').scrollTop=0;
  renderDet(id);
}

function goBack(){nav(prevPg||'dash');}

function showFormPage(){
  document.querySelectorAll('.pg').forEach(x=>x.classList.remove('on'));
  document.querySelectorAll('.nb').forEach(x=>x.classList.remove('on'));
  document.getElementById('pg-form').classList.add('on');
  document.getElementById('fab').className='';
  document.getElementById('scrollEl').scrollTop=0;
}

// ══════════════════════════════════════════════════
//  AVATAR
// ══════════════════════════════════════════════════
function avatarHTML(s,size=40){
  const colors=['#c084fc','#34d399','#60a5fa','#f59e0b','#f87171','#a78bfa','#f472b6'];
  const col=colors[s.id%colors.length];
  const initials=(s.student_name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const st=`width:${size}px;height:${size}px;border-radius:50%;flex-shrink:0;border:2px solid ${col}44;background:${col}18;display:flex;align-items:center;justify-content:center;overflow:hidden;`;
  if(s.photo) return`<div style="${st}"><img src="${s.photo}" style="width:100%;height:100%;object-fit:cover;" loading="lazy"/></div>`;
  return`<div style="${st}"><span style="color:${col};font-weight:800;font-size:${Math.round(size*0.33)}px">${initials}</span></div>`;
}

// ══════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════
function renderDash(){
  const cfg=getSettings();
  document.getElementById('hdrDate').textContent=now.getDate()+' '+MO[curM()-1].slice(0,3)+' '+curY();
  document.getElementById('heroM').textContent=MO[curM()-1]+' '+curY();
  document.getElementById('hdrSub').textContent=cfg.inst||cfg.teacher||'Singing Teacher';
  const stus=DB.gs().filter(s=>s.active);
  const curr=cfg.curr||'₹';
  const collected=monthCollected();
  const totalDues=stus.reduce((a,s)=>a+calcDue(s),0);
  const totalAdv=stus.reduce((a,s)=>a+totalAdvance(s.id),0);
  const mCls=monthClasses();
  document.getElementById('heroV').textContent=curr+NR(collected);
  document.getElementById('hm-s').textContent=stus.length;
  document.getElementById('hm-c').textContent=DB.gc().filter(c=>c.date===todayStr()).length;
  document.getElementById('hm-d').textContent=stus.filter(s=>calcDue(s)>0||isCurrentMonthUnpaid(s)).length;
  document.getElementById('dc').textContent=curr+NR(collected);
  document.getElementById('dd').textContent=curr+NR(totalDues);
  document.getElementById('da').textContent=curr+NR(totalAdv);
  document.getElementById('dm').textContent=mCls;
  // Today's classes — declare first so it's available below
  const todayClasses=DB.gc().filter(c=>c.date===todayStr()).sort((a,b)=>a.time>b.time?1:-1);
  // ── COLLECT BEFORE CLASS BANNER ──
  const unpaidToday=todayClasses.map(c=>stus.find(x=>x.id===c.student_id)).filter(s=>s&&isCurrentMonthUnpaid(s));
  const upcomingReminders=stus.filter(s=>s.fee_type==='monthly'&&isUpcomingReminder(s)&&!isCurrentMonthUnpaid(s));
  let bannerHtml='';
  if(unpaidToday.length){
    bannerHtml+=`<div style="margin:0 0 10px;padding:12px 14px;background:var(--surf);border:1px solid var(--red)55;border-radius:14px;display:flex;align-items:flex-start;gap:10px;">
      <div style="font-size:22px;flex-shrink:0">🚫</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:800;color:var(--red);margin-bottom:4px">Fee Pending — Cannot Start Class!</div>
        <div style="font-size:11px;color:var(--txt3);margin-bottom:8px">${unpaidToday.map(s=>esc(s.student_name)).join(', ')} — ${MO[curM()-1]} fee not paid</div>
        <div style="display:flex;gap:7px;flex-wrap:wrap">
          ${unpaidToday.map(s=>`
            <button class="tc-btn" style="border-color:var(--grn)44;color:var(--grn);background:var(--grn)0d" onclick="openPay(${s.id})">💰 Collect from ${esc(s.student_name)}</button>
            <button class="tc-btn wa" onclick="sendWA(${s.id},'fee')">📱 Remind</button>
          `).join('')}
        </div>
      </div>
    </div>`;
  }
  if(upcomingReminders.length){
    const daysLeft=new Date(curY(),curM(),0).getDate()-new Date().getDate();
    bannerHtml+=`<div style="margin:0 0 10px;padding:12px 14px;background:var(--surf);border:1px solid var(--gold)44;border-radius:14px;display:flex;align-items:flex-start;gap:10px;">
      <div style="font-size:22px;flex-shrink:0">⏰</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:800;color:var(--gold);margin-bottom:4px">Collect Next Month's Fee — ${daysLeft} days left!</div>
        <div style="font-size:11px;color:var(--txt3);margin-bottom:8px">${upcomingReminders.map(s=>esc(s.student_name)).join(', ')}</div>
        <div style="display:flex;gap:7px;flex-wrap:wrap">
          ${upcomingReminders.map(s=>`
            <button class="tc-btn" style="border-color:var(--gold)44;color:var(--gold);background:var(--gold)0d" onclick="sendWA(${s.id},'upcoming')">📱 Remind ${esc(s.student_name)}</button>
          `).join('')}
        </div>
      </div>
    </div>`;
  }
  const bannerEl=document.getElementById('feeBanner');
  if(bannerEl) bannerEl.innerHTML=bannerHtml||'';
  const todayEl=document.getElementById('todayClasses');
  if(!todayClasses.length){
    todayEl.innerHTML='<div class="empty" style="padding:20px"><div class="empty-ic" style="font-size:32px">📅</div>No classes today</div>';
  } else {
    todayEl.innerHTML=todayClasses.map(c=>{
      if(c.batch_id){
        // Batch class
        const b=DB.gb().find(x=>x.id===c.batch_id);
        const members=stus.filter(s=>b?.student_ids?.includes(s.id));
        return`<div class="today-card online" style="border-left:3px solid var(--acc)">
          <div class="tc-top">
            <div style="display:flex;align-items:center;gap:9px;flex:1">
              <div style="width:36px;height:36px;border-radius:50%;background:var(--acc)20;border:2px solid var(--acc)44;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">🎭</div>
              <div>
                <div class="tc-name">${esc(b?b.name:'Batch Class')}</div>
                <div style="font-size:11px;color:var(--txt3)">${members.map(m=>m.student_name).join(', ')||'No members'}</div>
              </div>
            </div>
            <div class="tc-time">${timeRange(c.time,c.duration)}</div>
          </div>
          <div class="tc-tags">
            <span class="bdg" style="background:var(--acc)18;color:var(--acc);border:1px solid var(--acc)33;font-size:10px;">🎭 Group</span>
            <span class="bdg ${c.attended===true?'paid':c.attended===false?'due':''}" style="font-size:10px">${c.attended===true?'✅ Done':c.attended===false?'❌ Absent':'⏳ Upcoming'}</span>
          </div>
          <div class="tc-btns">
            ${c.meet_link&&c.type==='online'?`<button class="tc-btn meet" onclick="event.stopPropagation();openMeet('${esc(c.meet_link)}')">🎥 Join</button>`:''}
            <button class="tc-btn att" onclick="event.stopPropagation();openBatchAtt(${c.id},${c.batch_id})">✅ Attendance</button>
            <button class="tc-btn" style="border-color:var(--ylw)44;color:var(--ylw)" onclick="event.stopPropagation();openResched(${c.id})">📅 Reschedule</button>
            <button class="tc-btn wa" onclick="event.stopPropagation();batchWA(${c.batch_id})">📱 WA All</button>
          </div>
        </div>`;
      }
      const s=stus.find(x=>x.id===c.student_id);
      if(!s) return '';
      return todayClassCard(c,s,cfg);
    }).join('');
  }
  // Dues
  const dueStus=stus.filter(s=>calcDue(s)>0).sort((a,b)=>calcDue(b)-calcDue(a)).slice(0,5);
  const duesEl=document.getElementById('dashDues');
  if(!dueStus.length){
    duesEl.innerHTML='<div class="empty" style="padding:20px"><div class="empty-ic" style="font-size:32px">✅</div>All dues clear!</div>';
  } else {
    duesEl.innerHTML=dueStus.map(s=>`
      <div class="today-card" style="border-left:3px solid var(--ylw);" onclick="goDetail(${s.id})">
        <div class="tc-top">
          <div style="display:flex;align-items:center;gap:9px;flex:1">
            ${avatarHTML(s,36)}
            <div class="tc-name">${esc(s.student_name)}</div>
          </div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:800;color:var(--ylw)">${curr}${NR(calcDue(s))}</div>
        </div>
        <div class="tc-btns">
          <button class="tc-btn" style="border-color:var(--grn)44;color:var(--grn)" onclick="event.stopPropagation();openPay(${s.id})">💰 Collect</button>
          <button class="tc-btn wa" onclick="event.stopPropagation();sendWA(${s.id},'fee')">📱 Remind</button>
        </div>
      </div>`).join('');
  }
  renderAvailCard();
  updateBell();
}

function todayClassCard(c,s,cfg){
  const meetLink=c.meet_link||s.meet_link||'';
  const feeUnpaid=isCurrentMonthUnpaid(s);
  const curr=cfg.curr||'₹';
  return`<div class="today-card ${c.type||'online'}" onclick="goDetail(${s.id})" style="${feeUnpaid?'border-color:var(--red)66;':''}" >
    <div class="tc-top">
      <div style="display:flex;align-items:center;gap:9px;flex:1">
        ${avatarHTML(s,36)}
        <div>
          <div class="tc-name">${esc(s.student_name)}</div>
          ${c.topic?`<div style="font-size:11px;color:var(--txt3);margin-top:1px">${esc(c.topic)}</div>`:''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        ${s.mobile_number?`<a href="tel:${esc(s.mobile_number)}" onclick="event.stopPropagation()" style="width:30px;height:30px;border-radius:8px;background:var(--grn)18;border:1px solid var(--grn)44;display:flex;align-items:center;justify-content:center;font-size:15px;text-decoration:none">📞</a>`:''}
        <div class="tc-time">${timeRange(c.time, c.duration)}</div>
      </div>
    </div>
    <div class="tc-tags">
      <span class="tag">${c.type==='online'?'🌐 Online':'📍 Offline'}</span>
      <span class="bdg ${c.attended===true?'paid':c.attended===false?'due':''}" style="font-size:10px">
        ${c.attended===true?'✅ Present':c.attended===false?'❌ Absent':'⏳ Upcoming'}
      </span>
      ${feeUnpaid?`<span class="bdg due" style="animation:pulse 2s infinite">⚠️ Fee Due</span>`:''}
    </div>
    ${feeUnpaid?`<div style="background:var(--red)0d;border:1px solid var(--red)33;border-radius:8px;padding:7px 10px;margin-top:6px;font-size:11px;color:var(--red);font-weight:700;">
      ⚠️ ${MO[curM()-1]} fee of ${curr}${NR(s.monthly_fee)} not paid — please collect
    </div>`:''}
    <div class="tc-btns">
      ${meetLink&&c.type==='online'?`<button class="tc-btn meet" onclick="event.stopPropagation();openMeet('${esc(meetLink)}')">🎥 Join Meet</button>`:''}
      <button class="tc-btn att" onclick="event.stopPropagation();openAtt(${c.id},${s.id})">✅ Attendance</button>
      <button class="tc-btn hw" onclick="event.stopPropagation();openHW(${s.id})">📝 Homework</button>
      ${feeUnpaid?`<button class="tc-btn" style="border-color:var(--grn)44;color:var(--grn);background:var(--grn)0d" onclick="event.stopPropagation();openPay(${s.id})">💰 Collect</button>`:''}
      <button class="tc-btn" style="border-color:var(--ylw)44;color:var(--ylw);background:var(--ylw)0d" onclick="event.stopPropagation();openResched(${c.id})">📅 Reschedule</button>
      <button class="tc-btn wa" onclick="event.stopPropagation();sendWA(${s.id},'class',{time:'${c.time}',meet:'${meetLink}'})">📱 Remind</button>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════
//  STUDENTS PAGE
// ══════════════════════════════════════════════════
function renderStu(){
  const stus=DB.gs().filter(s=>s.active);
  const q=(document.getElementById('srchIn').value||'').toLowerCase();
  const list=stus.filter(s=>
    (s.student_name||'').toLowerCase().includes(q)||
    (s.contact_name||'').toLowerCase().includes(q)||
    (s.mobile_number||'').includes(q)||
    (s.level||'').toLowerCase().includes(q)||
    (s.class_days||'').toLowerCase().includes(q)
  ).filter(s=>{
    if(chipFilter==='all') return true;
    if(chipFilter==='due') return calcDue(s)>0;
    if(chipFilter==='advance') return totalAdvance(s.id)>0;
    return s.fee_type===chipFilter;
  });
  document.getElementById('stuEmpty').style.display=list.length?'none':'block';
  document.getElementById('stuList').innerHTML=list.map(s=>stuCard(s)).join('');
}
function setChip(f,el){chipFilter=f;document.querySelectorAll('.chip-f').forEach(c=>c.classList.remove('on'));el.classList.add('on');renderStu();}

function stuCard(s){
  const cfg=getSettings();
  const curr=cfg.curr||'₹';
  const due=calcDue(s);
  const adv=totalAdvance(s.id);
  const feeLabel=s.fee_type==='monthly'?`${curr}${NR(s.monthly_fee)}/mo`:
                 s.fee_type==='perclass'?`${curr}${NR(s.per_class_fee)}/class`:
                 `${s.pkg_classes} cls=${curr}${NR(s.pkg_fee)}`;
  const nextCls=DB.gc().filter(c=>c.student_id===s.id&&c.date>=todayStr()).sort((a,b)=>a.date>b.date?1:-1)[0];
  return`<div class="stu-card ${s.fee_type}" onclick="goDetail(${s.id})">
    <div class="sc-top">
      <div class="sc-left">
        ${avatarHTML(s,38)}
        <div class="sc-name" onclick="event.stopPropagation();goDetail(${s.id})">${esc(s.student_name)}</div>
      </div>
      <div class="sc-fee">${feeLabel}</div>
    </div>
    <div class="sc-mid">

      ${s.level?`<span class="tag">${esc(s.level)}</span>`:''}
      ${s.class_type?`<span class="tag">${s.class_type==='online'?'🌐':'📍'} ${esc(s.class_type)}</span>`:''}
      ${s.class_days?`<span class="tag">📅 ${esc(s.class_days)}</span>`:''}
      ${s.class_time?`<span class="tag">⏰ ${fmt12(s.class_time)}</span>`:''}
    </div>
    ${due>0?`<div class="sc-pending"><span class="sc-pending-amt">Pending: ${curr}${NR(due)}</span><span class="sc-pending-meta">${s.fee_type==='perclass'?'per class dues':s.fee_type==='package'?'package dues':'past months'}</span></div>`:''}
    ${adv>0?`<div class="sc-advance"><span class="sc-advance-amt">Advance: ${curr}${NR(adv)}</span><span class="sc-advance-meta">held balance</span></div>`:''}
    ${nextCls?`<div style="font-size:11px;color:var(--acc);margin-top:6px">Next: ${nextCls.date} · ${timeRange(nextCls.time, nextCls.duration)} ${nextCls.type==='online'?'🌐':'📍'}</div>`:''}
    <div class="sc-btns" onclick="event.stopPropagation()">
      ${due>0?`<button class="sc-btn pay" onclick="openPay(${s.id})">💰 Collect</button>`:''}
      ${s.mobile_number?`<a href="tel:${esc(s.mobile_number)}" class="sc-btn" style="border-color:var(--grn)44;color:var(--grn);background:var(--grn)0d;text-decoration:none">📞 Call</a>`:''}
      <button class="sc-btn wa" onclick="sendWA(${s.id},'fee')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.124 1.532 5.856L.044 23.552a.5.5 0 00.593.594l5.817-1.474A11.949 11.949 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.9 0-3.68-.524-5.2-1.435l-.372-.222-3.853.977.998-3.735-.244-.386A9.955 9.955 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
        WhatsApp
      </button>
      <button class="sc-btn view" onclick="goDetail(${s.id})">View →</button>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════
//  SCHEDULE PAGE
// ══════════════════════════════════════════════════
// stripStart = the first date shown in the strip
let stripStart = null;

function shiftWeek(days){
  if(days===0){
    // Today
    selDay=todayStr();
    stripStart=null; // reset
  } else {
    const d=new Date((stripStart||todayStr())+'T12:00:00');
    d.setDate(d.getDate()+days);
    stripStart=d.toISOString().split('T')[0];
    // Also move selDay with the strip
    const sd=new Date(selDay+'T12:00:00');
    sd.setDate(sd.getDate()+days);
    selDay=sd.toISOString().split('T')[0];
  }
  renderSch(true); // true = animate scroll
}

function renderSch(scrollAnim=false){
  const strip=document.getElementById('weekStrip');
  if(!selDay) selDay=todayStr();
  if(!stripStart) stripStart=todayStr();

  // Show 30 days from stripStart
  const start=new Date(stripStart+'T12:00:00');
  let days=[];
  for(let i=0;i<30;i++){
    const d=new Date(start);
    d.setDate(start.getDate()+i);
    days.push(d);
  }

  // Month label — unique months in view
  const months=[...new Set(days.map(d=>MO[d.getMonth()]+' '+d.getFullYear()))];
  const monthLbl=document.getElementById('weekMonthLbl');
  if(monthLbl) monthLbl.textContent=months.slice(0,2).join(' · ');

  strip.innerHTML=days.map((d,i)=>{
    const ds=d.toISOString().split('T')[0];
    const hasCls=DB.gc().some(c=>c.date===ds);
    const isToday=ds===todayStr();
    const isSel=ds===selDay;
    return`<div class="wd${isSel?' on':''}${isToday&&!isSel?' today-marker':''}"
      id="wd-${ds}"
      onclick="selDay='${ds}';renderSchContent();"
      style="animation-delay:${i*0.025}s">
      <div class="wd-name" style="${isToday&&!isSel?'color:var(--acc)':''}">${DOW[d.getDay()]}</div>
      <div class="wd-num">${d.getDate()}</div>
      ${hasCls?`<div class="wd-dot"></div>`:`<div style="width:5px;height:5px;margin-top:1px;"></div>`}
    </div>`;
  }).join('');

  // Smooth scroll to selected day — but only if it's in view, don't force center
  if(scrollAnim){
    setTimeout(()=>{
      const el=document.getElementById('wd-'+selDay);
      if(el) el.scrollIntoView({behavior:'smooth',block:'nearest',inline:'nearest'});
    },80);
  }

  renderSchContent();
}

function renderSchContent(){
  // Update day label
  const isToday=selDay===todayStr();
  const selDate=new Date(selDay+'T12:00:00');
  document.getElementById('schDayLbl').textContent=
    isToday?'Today\'s Schedule':
    `${DOW[selDate.getDay()]}, ${selDate.getDate()} ${MO[selDate.getMonth()]} ${selDate.getFullYear()}`;

  // Update active day highlight without rebuilding strip
  document.querySelectorAll('.wd').forEach(el=>{
    const ds=el.id.replace('wd-','');
    el.classList.toggle('on', ds===selDay);
  });

  const cls=DB.gc().filter(c=>c.date===selDay).sort((a,b)=>a.time>b.time?1:-1);
  const stus=DB.gs();
  const cfg=getSettings();
  const list=document.getElementById('schList');
  if(!cls.length){
    list.innerHTML='<div class="empty"><div class="empty-ic">📅</div>No classes scheduled</div>';
    return;
  }
  list.innerHTML=cls.map(c=>{
    const isBatch=!!c.batch_id;
    const b=isBatch?DB.gb().find(x=>x.id===c.batch_id):null;
    const s=!isBatch?stus.find(x=>x.id===c.student_id):null;
    if(!isBatch&&!s) return '';
    const meetLink=c.meet_link||(s?.meet_link||'');
    const label=isBatch?b?.name||'Batch':s.student_name;
    const members=isBatch?stus.filter(x=>b?.student_ids?.includes(x.id)):[];
    return`<div class="sch-slot ${c.type||'online'}">
      <div class="ss-top">
        <div class="ss-time">${timeRange(c.time, c.duration)}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="bdg ${c.attended===true?'paid':c.attended===false?'due':'pkg'}" style="font-size:10px">
            ${c.attended===true?'✅ Present':c.attended===false?'❌ Absent':'⏳ Upcoming'}
          </span>
          ${isBatch?`<span class="bdg" style="background:var(--acc)18;color:var(--acc);border:1px solid var(--acc)33;font-size:10px;">🎭 Batch</span>`:''}
          <button style="background:none;border:none;color:var(--red);font-size:16px;cursor:pointer;padding:2px" onclick="deleteClass(${c.id})">🗑</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px">
        ${isBatch
          ?`<div style="width:34px;height:34px;border-radius:50%;background:var(--acc)20;border:2px solid var(--acc)44;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">🎭</div>`
          :avatarHTML(s,34)}
        <div>
          <div class="ss-name" onclick="${isBatch?'':(`goDetail(${s.id})`)};" style="cursor:${isBatch?'default':'pointer'}">${esc(label)}</div>
          ${isBatch&&members.length?`<div style="font-size:11px;color:var(--txt3)">${members.map(m=>m.student_name).join(', ')}</div>`:''}
          ${c.topic?`<div style="font-size:11px;color:var(--txt3)">${esc(c.topic)}</div>`:''}
        </div>
      </div>
      <div class="ss-btns">
        ${meetLink&&c.type==='online'?`<button class="tc-btn meet" onclick="openMeet('${esc(meetLink)}')">🎥 Join</button>`:''}
        ${isBatch
          ?`<button class="tc-btn att" onclick="openBatchAtt(${c.id},${c.batch_id})">✅ Attendance</button>`
          :`<button class="tc-btn att" onclick="openAtt(${c.id},${s.id})">✅ Attend</button>`}
        ${!isBatch?`<button class="tc-btn hw" onclick="openHW(${s.id})">📝 HW</button>`:''}
        <button class="tc-btn" style="border-color:var(--ylw)44;color:var(--ylw);background:var(--ylw)0d" onclick="openResched(${c.id})">📅 Reschedule</button>
        ${isBatch
          ?`<button class="tc-btn wa" onclick="batchWA(${c.batch_id})">📱 WA All</button>`
          :`<button class="tc-btn wa" onclick="sendWA(${s.id},'class',{time:'${c.time}',meet:'${meetLink}'})">📱 Remind</button>`}
      </div>
    </div>`;
  }).join('');
}

function openAddClass(batchId=null){
  const stus=DB.gs().filter(s=>s.active);
  document.getElementById('cls-stu-search').value='';
  document.getElementById('cls-stu').value='';
  document.getElementById('cls-stu-list').style.display='none';
  document.getElementById('cls-time').value='';
  document.getElementById('tp-cls-time-val').textContent='Select time';
  document.getElementById('tp-cls-time-val').className='tp-display-val empty';
  delete TP_STATE['cls-time'];
  // If batchId passed, store it
  document.getElementById('addClassOv').dataset.batchId=batchId||'';
  if(batchId){
    const b=DB.gb().find(x=>x.id===batchId);
    document.querySelector('#addClassOv .modal-ttl').childNodes[0].textContent=`Add Class — ${b?b.name:'Batch'} `;
    // Pre-select first batch member in search
    if(b?.student_ids?.length){
      const s=stus.find(x=>b.student_ids.includes(x.id));
      if(s){document.getElementById('cls-stu').value=s.id;document.getElementById('cls-stu-search').value=s.student_name;}
    }
  } else {
    document.querySelector('#addClassOv .modal-ttl').childNodes[0].textContent='Add Class Slot ';
    renderStuDropdown(stus);
    if(stus.length){document.getElementById('cls-stu').value=stus[0].id;document.getElementById('cls-stu-search').value=stus[0].student_name;}
  }
  document.getElementById('cls-date').value=selDay||todayStr();
  document.getElementById('cls-dur').value='45';
  document.getElementById('cls-type').value='online';
  document.getElementById('cls-meet').value='';
  document.getElementById('cls-topic').value='';
  document.getElementById('addClassOv').classList.add('on');
}

function renderStuDropdown(list){
  const el=document.getElementById('cls-stu-list');
  if(!list.length){
    el.innerHTML='<div style="padding:12px 14px;font-size:13px;color:var(--txt3)">No students found</div>';
    return;
  }
  el.innerHTML=list.map(s=>`
    <div onclick="selectStu(${s.id},'${esc(s.student_name)}')"
      style="padding:11px 14px;font-size:14px;font-weight:600;cursor:pointer;border-bottom:1px solid var(--bdr);
        display:flex;align-items:center;gap:10px;transition:background .1s;"
      onmouseover="this.style.background='var(--surf3)'"
      onmouseout="this.style.background=''">
      ${avatarHTML(s,28)}
      <div>
        <div style="color:var(--txt)">${esc(s.student_name)}</div>
        <div style="font-size:11px;color:var(--txt3)">${s.level||''} ${s.class_type?'· '+s.class_type:''}</div>
      </div>
    </div>`).join('');
}

function selectStu(id, name){
  document.getElementById('cls-stu').value=id;
  document.getElementById('cls-stu-search').value=name;
  document.getElementById('cls-stu-list').style.display='none';
  // Auto-fill meet link from student profile
  const s=DB.gs().find(x=>x.id===id);
  if(s&&s.meet_link) document.getElementById('cls-meet').value=s.meet_link;
  if(s&&s.class_type) document.getElementById('cls-type').value=s.class_type;
}

function showStuDropdown(){
  const stus=DB.gs().filter(s=>s.active);
  renderStuDropdown(stus);
  document.getElementById('cls-stu-list').style.display='block';
}

function filterStuDropdown(){
  const q=(document.getElementById('cls-stu-search').value||'').toLowerCase();
  const stus=DB.gs().filter(s=>s.active&&(s.student_name||'').toLowerCase().includes(q));
  renderStuDropdown(stus);
  document.getElementById('cls-stu-list').style.display='block';
  // Clear selection if user is typing
  document.getElementById('cls-stu').value='';
}

// Close dropdown when clicking outside
document.addEventListener('click',function(e){
  const wrap=document.getElementById('cls-stu-search');
  const list=document.getElementById('cls-stu-list');
  if(wrap&&list&&!wrap.contains(e.target)&&!list.contains(e.target)){
    list.style.display='none';
  }
});

function saveClass(){
  const sid=parseInt(document.getElementById('cls-stu').value);
  const time=document.getElementById('cls-time').value;
  const batchId=parseInt(document.getElementById('addClassOv').dataset.batchId)||null;
  if(!sid&&!batchId){toast('Select a student','er');return;}
  if(!time){toast('Select class time','er');return;}
  const cls=DB.gc();
  cls.push({id:DB.nid(cls),student_id:sid||null,batch_id:batchId||null,
    date:document.getElementById('cls-date').value,
    time,duration:document.getElementById('cls-dur').value,
    type:document.getElementById('cls-type').value,
    meet_link:document.getElementById('cls-meet').value,
    topic:document.getElementById('cls-topic').value,
    attended:null,batch_att:{}});
  DB.sc(cls);closeOv('addClassOv');toast('Class added ✓','ok');renderSch();
}

function deleteClass(id){
  document.getElementById('delMsg').textContent='Delete this class slot?';
  document.getElementById('delConfirmBtn').onclick=()=>{
    DB.sc(DB.gc().filter(c=>c.id!==id));closeOv('delOv');toast('Deleted');renderSch();
  };
  document.getElementById('delOv').classList.add('on');
}

function openAtt(cid,sid){attClsId=cid;attStuId=sid;
  const c=DB.gc().find(x=>x.id===cid);
  const s=DB.gs().find(x=>x.id===sid);
  document.getElementById('attTitle').textContent=`Attendance — ${s?s.student_name:''}`;
  document.getElementById('attOv').classList.add('on');
}

function markAtt(status){
  const cls=DB.gc();
  const i=cls.findIndex(c=>c.id===attClsId);
  if(i>=0){cls[i].attended=(status==='present');DB.sc(cls);}
  closeOv('attOv');toast(status==='present'?'Marked Present ✅':'Marked Absent ❌');
  renderSch();renderDash();
}

function openMeet(url){window.open(url,'_blank');toast('Opening Google Meet 🎥');}

// ══════════════════════════════════════════════════
//  DETAIL PAGE
// ══════════════════════════════════════════════════
function renderDet(id){
  const s=DB.gs().find(x=>x.id===id);if(!s)return;
  const cfg=getSettings();const curr=cfg.curr||'₹';
  const due=calcDue(s);const adv=totalAdvance(s.id);
  const allPays=DB.gp().filter(p=>p.student_id===id);
  const totalPaidAmt=allPays.filter(p=>p.type==='fee').reduce((a,p)=>a+p.amount,0);
  const allCls=DB.gc().filter(c=>c.student_id===id).sort((a,b)=>a.date>b.date?-1:1);
  const attended=allCls.filter(c=>c.attended===true).length;
  const absent=allCls.filter(c=>c.attended===false).length;
  const progs=DB.gpr().filter(p=>p.student_id===id);
  const hws=DB.gh().filter(h=>h.student_id===id).sort((a,b)=>b.id-a.id);
  const colors=['#c084fc','#34d399','#60a5fa','#f59e0b','#f87171','#a78bfa','#f472b6'];
  const col=colors[id%colors.length];
  const feeLabel=s.fee_type==='monthly'?`${curr}${NR(s.monthly_fee)}/mo`:
                 s.fee_type==='perclass'?`${curr}${NR(s.per_class_fee)}/class`:
                 `${s.pkg_classes} classes = ${curr}${NR(s.pkg_fee)}`;
  document.getElementById('pg-det').innerHTML=`
    <button class="back-btn" onclick="goBack()">← Back</button>
    <div class="det-cover">
      <div class="det-avatar" style="border-color:${col}88;background:${col}18">
        ${s.photo?`<img src="${s.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:`<span style="font-size:28px;color:${col}">${(s.student_name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</span>`}
      </div>
    </div>
    <div class="det-name">${esc(s.student_name)}</div>
    <div class="det-sub">${esc(s.level||'')} ${s.voice_type&&s.voice_type!=='Not set'?'· '+s.voice_type:''} ${feeLabel?'· '+feeLabel:''}</div>

    <!-- Action buttons -->
    <div style="display:flex;gap:8px;padding:14px;flex-wrap:wrap;">
      ${due>0?`<button class="sc-btn pay" style="flex:1" onclick="openPay(${s.id})"><span>💰</span>Collect Fee</button>`:''}
      ${s.mobile_number?`<a href="tel:${esc(s.mobile_number)}" class="sc-btn" style="flex:1;border-color:var(--grn)44;color:var(--grn);background:var(--grn)0d;text-decoration:none;justify-content:center;"><span>📞</span>Call</a>`:''}
      <button class="sc-btn wa" style="flex:1" onclick="sendWA(${s.id},'fee')"><span>📱</span>Fee Remind</button>
      <button class="sc-btn" style="flex:1;border-color:var(--gold)44;color:var(--gold)" onclick="openHW(${s.id})"><span>📝</span>Homework</button>
      <button class="sc-btn" style="flex:1;border-color:var(--acc)44;color:var(--acc)" onclick="openProg(${s.id})"><span>🎵</span>Progress</button>
      <button class="sc-btn" style="flex:1" onclick="openEdit(${s.id})"><span>✏️</span>Edit</button>
      <button class="sc-btn" style="flex:1;border-color:var(--red)44;color:var(--red)" onclick="confirmDel(${s.id})"><span>🗑</span>Delete</button>
    </div>

    <!-- Fee summary -->
    <div class="inf-sec">
      <div class="inf-ttl">💰 Fee Summary</div>
      <div class="inf-row"><span class="il">Fee Type</span><span class="iv">${s.fee_type==='monthly'?'Monthly':s.fee_type==='perclass'?'Per Class':'Package'}</span></div>
      <div class="inf-row"><span class="il">Fee</span><span class="iv mono p">${feeLabel}</span></div>
      <div class="inf-row"><span class="il">Total Collected</span><span class="iv mono g">${curr}${NR(totalPaidAmt)}</span></div>
      ${adv>0?`<div class="inf-row"><span class="il">Advance Balance</span><span class="iv mono p">${curr}${NR(adv)}</span></div>`:''}
      <div class="inf-row"><span class="il">Outstanding Due</span><span class="iv mono ${due>0?'r':'g'}">${due>0?curr+NR(due):'All Clear ✓'}</span></div>
    </div>

    <!-- Class stats -->
    <div class="inf-sec">
      <div class="inf-ttl">📅 Class Stats</div>
      <div class="inf-row"><span class="il">Total Classes</span><span class="iv">${allCls.length}</span></div>
      <div class="inf-row"><span class="il">Attended</span><span class="iv g">${attended}</span></div>
      <div class="inf-row"><span class="il">Absent</span><span class="iv r">${absent}</span></div>
      <div class="inf-row"><span class="il">Schedule</span><span class="iv">${s.class_days||'—'} ${s.class_time?'at '+fmt12(s.class_time):''}</span></div>
      ${s.meet_link?`<div class="inf-row"><span class="il">Meet Link</span><span class="iv"><a href="${esc(s.meet_link)}" onclick="event.preventDefault();openMeet('${esc(s.meet_link)}')">Join Meet 🎥</a></span></div>`:''}
    </div>

    <!-- Contact -->
    <div class="inf-sec">
      <div class="inf-ttl">📞 Contact</div>
      <div class="inf-row"><span class="il">Mobile</span><span class="iv"><a href="tel:${esc(s.mobile_number)}">${esc(s.mobile_number||'—')}</a></span></div>
      <div class="inf-row"><span class="il">Class Type</span><span class="iv">${s.class_type==='online'?'🌐 Online':s.class_type==='offline'?'📍 Offline':'Both'}</span></div>
      ${s.joining_date?`<div class="inf-row"><span class="il">Joined</span><span class="iv">${s.joining_date}</span></div>`:''}
    </div>

    <!-- Song/Raga Progress -->
    <div class="inf-sec">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px">
        <div class="inf-ttl" style="margin-bottom:0">🎵 Song / Raga Progress</div>
        <button class="sc-btn" style="font-size:11px;padding:5px 10px" onclick="openProg(${s.id})">+ Add</button>
      </div>
      ${progs.length?progs.map(p=>`
        <div class="prog-item">
          <div class="prog-left">
            <div class="prog-name">${esc(p.name)}</div>
            ${p.note?`<div class="prog-date">${esc(p.note)}</div>`:''}
            <div class="prog-bar-wrap"><div class="prog-bar" style="width:${p.pct||0}%"></div></div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="prog-pct">${p.pct||0}%</div>
            <button class="pdel" onclick="deleteProg(${p.id},${id})">🗑</button>
          </div>
        </div>`).join('')
      :'<div style="color:var(--txt3);font-size:13px;padding:8px 0">No songs/ragas tracked yet.</div>'}
    </div>

    <!-- Homework -->
    <div class="inf-sec">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px">
        <div class="inf-ttl" style="margin-bottom:0">📝 Homework</div>
        <button class="sc-btn" style="font-size:11px;padding:5px 10px" onclick="openHW(${s.id})">+ Assign</button>
      </div>
      ${hws.length?hws.slice(0,5).map(h=>`
        <div class="hw-item">
          <div class="hw-top">
            <div class="hw-text">${esc(h.text)}</div>
            <button class="pdel" onclick="deleteHW(${h.id},${id})">🗑</button>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
            <div style="font-size:11px;color:var(--txt3)">${h.due_date?'Due: '+h.due_date:h.created}</div>
            <div style="display:flex;gap:6px;align-items:center">
              <span class="hw-status ${h.done?'done':'pending'}">${h.done?'✓ Done':'Pending'}</span>
              <button style="background:none;border:none;color:var(--wa);font-size:12px;cursor:pointer;padding:2px 5px;font-family:var(--font);font-weight:700" onclick="sendHWWA(${h.id},${id})">📱</button>
              ${!h.done?`<button style="background:none;border:none;color:var(--grn);font-size:12px;cursor:pointer;padding:2px 5px;font-family:var(--font);font-weight:700" onclick="markHWDone(${h.id},${id})">✓</button>`:''}
            </div>
          </div>
        </div>`).join('')
      :'<div style="color:var(--txt3);font-size:13px;padding:8px 0">No homework assigned yet.</div>'}
    </div>

    <!-- Payment History -->
    <div style="padding:14px 14px 0"><div class="inf-ttl">💳 Payment History</div></div>
    <div style="padding:0 14px 14px">
      ${allPays.length?[...allPays].sort((a,b)=>b.id-a.id).map(p=>`
        <div class="ph-item">
          <div class="pl">
            <span class="pm-l">${p.type==='advance'?'Advance Paid':p.type==='fee'?'Fee Payment':'Advance Used'}</span>
            <span class="pd-l">${p.date} · ${esc(p.mode||'Cash')}${p.note?' · '+esc(p.note):''}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span class="pa-l ${p.type==='advance'?'adv':''}">${p.type==='advance'?'⬆':'+'} ${curr}${NR(p.amount)}</span>
            <button class="pdel" onclick="confirmDelPay(${p.id},${id})">🗑</button>
          </div>
        </div>`).join('')
      :'<div style="color:var(--txt3);font-size:13px;padding:8px 0">No payments yet.</div>'}
    </div>
    ${s.notes?`<div class="inf-sec"><div class="inf-ttl">Notes</div><div style="font-size:13px;color:var(--txt2);line-height:1.6">${esc(s.notes)}</div></div>`:''}`;
}

// ══════════════════════════════════════════════════
//  HOMEWORK
// ══════════════════════════════════════════════════
function openHW(sid){
  hwStuId=sid;
  const s=DB.gs().find(x=>x.id===sid);
  document.getElementById('hwTitle').textContent=`Homework — ${s?s.student_name:''}`;
  document.getElementById('hwText').value='';
  document.getElementById('hwDue').value='';
  document.getElementById('hwOv').classList.add('on');
}

function saveHW(){
  const text=(document.getElementById('hwText').value||'').trim();
  if(!text){toast('Enter homework','er');return;}
  const due=document.getElementById('hwDue').value;
  const hw=DB.gh();
  const newHW={id:DB.nid(hw),student_id:hwStuId,text,due_date:due,
    created:new Date().toLocaleDateString('en-IN'),done:false};
  hw.push(newHW);DB.sh(hw);
  closeOv('hwOv');toast('Homework saved ✓','ok');
  if(document.getElementById('pg-det').classList.contains('on')) renderDet(hwStuId);
}

function saveHWOnly(){
  const text=(document.getElementById('hwText').value||'').trim();
  if(!text){toast('Enter homework','er');return;}
  const due=document.getElementById('hwDue').value;
  const hw=DB.gh();
  hw.push({id:DB.nid(hw),student_id:hwStuId,text,due_date:due,
    created:new Date().toLocaleDateString('en-IN'),done:false});
  DB.sh(hw);closeOv('hwOv');toast('Homework saved ✓','ok');
  if(document.getElementById('pg-det').classList.contains('on')) renderDet(hwStuId);
}

function sendHWWA(hwId,sid){
  const h=DB.gh().find(x=>x.id===hwId);const s=DB.gs().find(x=>x.id===sid);
  if(!h||!s) return;
  const cfg=getSettings();
  let msg=(cfg.tpl_hw||TPL_DEFAULTS.hw)
    .replaceAll('{student}',s.student_name)
    .replaceAll('{homework}',h.text)
    .replaceAll('{due}',h.due_date||'ASAP')
    .replaceAll('{teacher}',cfg.teacher||'Teacher');
  sendWAMsg(s.mobile_number,msg);
}

function markHWDone(hwId,sid){
  const hw=DB.gh();const i=hw.findIndex(h=>h.id===hwId);
  if(i>=0){hw[i].done=true;DB.sh(hw);}
  toast('Marked done ✓','ok');renderDet(sid);
}

function deleteHW(hwId,sid){
  DB.sh(DB.gh().filter(h=>h.id!==hwId));toast('Deleted');renderDet(sid);
}

// ══════════════════════════════════════════════════
//  PROGRESS
// ══════════════════════════════════════════════════
function openProg(sid){
  progStuId=sid;
  const s=DB.gs().find(x=>x.id===sid);
  document.getElementById('progTitle').textContent=`Progress — ${s?s.student_name:''}`;
  document.getElementById('progName').value='';
  document.getElementById('progPct').value='';
  document.getElementById('progNote').value='';
  document.getElementById('progOv').classList.add('on');
}

function saveProg(){
  const name=(document.getElementById('progName').value||'').trim();
  if(!name){toast('Enter song/raga name','er');return;}
  const pct=parseInt(document.getElementById('progPct').value)||0;
  const pr=DB.gpr();
  // Update if same song exists, else add
  const existing=pr.find(p=>p.student_id===progStuId&&p.name.toLowerCase()===name.toLowerCase());
  if(existing){existing.pct=pct;existing.note=document.getElementById('progNote').value;}
  else pr.push({id:DB.nid(pr),student_id:progStuId,name,pct,note:document.getElementById('progNote').value});
  DB.spr(pr);closeOv('progOv');toast('Progress saved ✓','ok');
  if(document.getElementById('pg-det').classList.contains('on')) renderDet(progStuId);
}

function deleteProg(pid,sid){DB.spr(DB.gpr().filter(p=>p.id!==pid));toast('Deleted');renderDet(sid);}

// ══════════════════════════════════════════════════
//  WHATSAPP
// ══════════════════════════════════════════════════
function sendWA(sid, tplKey, extraVars={}){
  const s=DB.gs().find(x=>x.id===sid);if(!s) return;
  const cfg=getSettings();
  const curr=cfg.curr||'₹';
  const due=calcDue(s);
  const adv=totalAdvance(s.id);
  const feeAmt=s.fee_type==='monthly'?s.monthly_fee:s.fee_type==='perclass'?s.per_class_fee:s.pkg_fee;
  let tpl=cfg['tpl_'+tplKey]||TPL_DEFAULTS[tplKey]||'';
  const meetLink=extraVars.meet||s.meet_link||'';
  const nextMonthName=MO[curM()%12]; // next month name
  const vars={
    student:s.student_name,
    fee:NR(feeAmt||0),month:MO[curM()-1],
    nextmonth:nextMonthName,
    dueday:'1st '+nextMonthName,
    balance:NR(due),advance:NR(adv),
    teacher:cfg.teacher||'Teacher',institute:cfg.inst||'',
    currency:curr,
    time:extraVars.time?fmt12(extraVars.time):'',
    meet:meetLink?`Meet Link: ${meetLink}`:'',
    ...extraVars
  };
  let msg=tpl;
  Object.entries(vars).forEach(([k,v])=>{msg=msg.replaceAll('{'+k+'}',String(v));});
  sendWAMsg(s.mobile_number,msg);
}

function sendWAMsg(phone,msg){
  let num=String(phone||'').replace(/\D/g,'');
  if(!num.startsWith('91')) num='91'+num;
  const url=`https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  document.getElementById('waPreviewText').textContent=msg;
  document.getElementById('waConfirmBtn').onclick=()=>{closeOv('waOv');window.open(url,'_blank');toast('Opening WhatsApp 📱','wa');};
  document.getElementById('waOv').classList.add('on');
}

// ══════════════════════════════════════════════════
//  PAYMENT
// ══════════════════════════════════════════════════
function openPay(sid){
  payId=sid;
  const s=DB.gs().find(x=>x.id===sid);if(!s) return;
  const cfg=getSettings();const curr=cfg.curr||'₹';
  const due=calcDue(s);
  document.getElementById('payName').textContent=s.student_name;
  document.getElementById('payDue').textContent=due>0?curr+NR(due)+' due':'No dues';
  const advBal=totalAdvance(sid);
  document.getElementById('pamt').value=due>0?due:'';
  document.getElementById('ptype').value='fee';
  document.getElementById('pmode').value='Cash';
  document.getElementById('pnote').value='';
  document.getElementById('sendConfirmChk').checked=false;
  document.getElementById('payOv').classList.add('on');
}

function savePay(){
  const s=DB.gs().find(x=>x.id===payId);if(!s) return;
  const amount=parseFloat(document.getElementById('pamt').value);
  if(!amount||amount<=0){toast('Enter valid amount','er');return;}
  const type=document.getElementById('ptype').value;
  const mode=document.getElementById('pmode').value;
  const note=(document.getElementById('pnote').value||'').trim();
  const sendConf=document.getElementById('sendConfirmChk').checked;
  const pays=DB.gp();
  pays.push({id:DB.nid(pays),student_id:payId,amount,type,mode,note,
    month:curM(),year:curY(),date:new Date().toLocaleDateString('en-IN')});
  DB.sp(pays);
  closeOv('payOv');
  toast(type==='advance'?'Advance recorded ✓':'Payment recorded ✓','ok');
  if(sendConf) setTimeout(()=>{
    const cfg=getSettings();const curr=cfg.curr||'₹';
    let msg=(cfg.tpl_confirm||TPL_DEFAULTS.confirm)
      .replaceAll('{student}',s.student_name)
      .replaceAll('{amount}',NR(amount))
      .replaceAll('{currency}',curr)
      .replaceAll('{teacher}',cfg.teacher||'Teacher')
      .replaceAll('{institute}',cfg.inst||'');
    sendWAMsg(s.mobile_number,msg);
  },400);
  if(document.getElementById('pg-det').classList.contains('on')) renderDet(payId);
  else renderDash();
  updateBell();
}

// ══════════════════════════════════════════════════
//  REPORTS
// ══════════════════════════════════════════════════
function showRT(t,el){repTab=t;document.querySelectorAll('.rtab').forEach(x=>x.classList.remove('on'));el.classList.add('on');renderRep();}
function renderRep(){
  const cfg=getSettings();const curr=cfg.curr||'₹';
  const stus=DB.gs().filter(s=>s.active);
  let html='';
  if(repTab==='month'){
    const mPays=DB.gp().filter(p=>p.type==='fee'&&p.month===curM()&&p.year===curY());
    const collected=mPays.reduce((a,p)=>a+p.amount,0);
    const mCls=DB.gc().filter(c=>{const d=new Date(c.date);return d.getMonth()+1===curM()&&d.getFullYear()===curY();});
    html=`<div class="rcard" style="margin-top:14px">
      <div class="rttl">📊 ${MO[curM()-1]} ${curY()}</div>
      <div class="rrow"><span class="rn">Collected</span><span class="rv g">${curr}${NR(collected)}</span></div>
      <div class="rrow"><span class="rn">Classes Scheduled</span><span class="rv">${mCls.length}</span></div>
      <div class="rrow"><span class="rn">Classes Attended</span><span class="rv g">${mCls.filter(c=>c.attended===true).length}</span></div>
      <div class="rrow"><span class="rn">Absences</span><span class="rv r">${mCls.filter(c=>c.attended===false).length}</span></div>
    </div>
    <div class="rcard">
      <div class="rttl">Student Payments — ${MO[curM()-1]}</div>
      ${stus.map(s=>{
        const paid=DB.gp().filter(p=>p.student_id===s.id&&p.type==='fee'&&p.month===curM()&&p.year===curY()).reduce((a,p)=>a+p.amount,0);
        return`<div class="rrow" onclick="goDetail(${s.id})" style="cursor:pointer">
          <div><div class="rn">${esc(s.student_name)}</div><div class="rs">${s.fee_type}</div></div>
          <span class="rv ${paid>0?'g':'r'}">${paid>0?curr+NR(paid):'—'}</span>
        </div>`;}).join('')}
    </div>`;
  } else if(repTab==='dues'){
    const wd=stus.map(s=>({...s,due:calcDue(s)})).filter(s=>s.due>0).sort((a,b)=>b.due-a.due);
    const total=wd.reduce((a,s)=>a+s.due,0);
    html=`<div class="rcard" style="margin-top:14px">
      <div class="rttl">Total Outstanding: ${curr}${NR(total)}</div>
      ${wd.length?wd.map(s=>`<div class="rrow" onclick="goDetail(${s.id})" style="cursor:pointer">
        <div><div class="rn">${esc(s.student_name)}</div><div class="rs">${s.fee_type}</div></div>
        <div style="text-align:right">
          <div class="rv r">${curr}${NR(s.due)}</div>
          <button class="tc-btn wa" style="font-size:10px;padding:4px 8px;margin-top:4px" onclick="event.stopPropagation();sendWA(${s.id},'fee')">📱 Remind</button>
        </div>
      </div>`).join(''):'<div style="color:var(--grn);font-size:13px;padding:6px 0">🎉 No dues!</div>'}
    </div>`;
  } else {
    const total=DB.gp().filter(p=>p.type==='fee').reduce((a,p)=>a+p.amount,0);
    html=`<div class="rcard" style="margin-top:14px">
      <div class="rttl">All-Time: ${curr}${NR(total)} collected</div>
      ${stus.map(s=>{
        const t=DB.gp().filter(p=>p.student_id===s.id&&p.type==='fee').reduce((a,p)=>a+p.amount,0);
        const c=DB.gc().filter(x=>x.student_id===s.id&&x.attended===true).length;
        return`<div class="rrow" onclick="goDetail(${s.id})" style="cursor:pointer">
          <div><div class="rn">${esc(s.student_name)}</div><div class="rs">${c} classes attended</div></div>
          <span class="rv g">${curr}${NR(t)}</span>
        </div>`;}).join('')}
    </div>`;
  }
  document.getElementById('repContent').innerHTML=html;
}

// ══════════════════════════════════════════════════
//  ALERTS
// ══════════════════════════════════════════════════
function renderAlerts(){
  const cfg=getSettings();const curr=cfg.curr||'₹';
  const stus=DB.gs().filter(s=>s.active);
  const daysLeft=new Date(curY(),curM(),0).getDate()-new Date().getDate();
  // Students with class TODAY but fee unpaid
  const todaySids=new Set(DB.gc().filter(c=>c.date===todayStr()).map(c=>c.student_id));
  const blockToday=stus.filter(s=>todaySids.has(s.id)&&isCurrentMonthUnpaid(s));
  // All with dues or unpaid this month
  const dues=stus.filter(s=>calcDue(s)>0||isCurrentMonthUnpaid(s)).sort((a,b)=>(calcDue(b)||0)-(calcDue(a)||0));
  // 1 week before next month — remind to collect
  const upcoming=stus.filter(s=>s.fee_type==='monthly'&&isUpcomingReminder(s));
  const pendingHW=DB.gh().filter(h=>!h.done);
  let html='';
  if(!blockToday.length&&!dues.length&&!upcoming.length&&!pendingHW.length){
    html='<div class="empty"><div class="empty-ic">✅</div><div style="font-size:15px;font-weight:700">All Clear!</div><div style="font-size:12px;margin-top:6px;color:var(--txt3)">No dues, no reminders</div></div>';
    document.getElementById('alertsContent').innerHTML=html; return;
  }
  // ── SECTION 1: Cannot start class today ──
  if(blockToday.length){
    html+=`<div class="rcard" style="border:1px solid var(--red)77;margin-top:14px;background:var(--surf)">
      <div class="rttl" style="color:var(--red)">🚫 Cannot Start Class Today — Fee Unpaid (${blockToday.length})</div>
      <div style="font-size:12px;color:var(--txt3);margin-bottom:12px">Collect ${MO[curM()-1]} fee before starting today's class!</div>
      ${blockToday.map(s=>`<div class="rrow" onclick="goDetail(${s.id})" style="cursor:pointer">
        <div><div class="rn">${esc(s.student_name)}</div><div class="rs">${MO[curM()-1]} fee: ${curr}${NR(parseFloat(s.monthly_fee)||0)} unpaid</div></div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          <button class="tc-btn" style="font-size:11px;padding:5px 10px;border-color:var(--grn)44;color:var(--grn);background:var(--grn)0d" onclick="event.stopPropagation();openPay(${s.id})">💰 Collect Now</button>
          <button class="tc-btn wa" style="font-size:10px;padding:4px 8px" onclick="event.stopPropagation();sendWA(${s.id},'fee')">📱 Send Reminder</button>
        </div>
      </div>`).join('')}
    </div>`;
  }
  // ── SECTION 2: Upcoming — 1 week before next month ──
  if(upcoming.length){
    html+=`<div class="rcard" style="border-color:var(--gold)55;margin-top:14px">
      <div class="rttl" style="color:var(--gold)">⏰ Collect Next Month's Fee — ${daysLeft} day${daysLeft!==1?'s':''} left in ${MO[curM()-1]}</div>
      <div style="font-size:12px;color:var(--txt3);margin-bottom:12px">Remind students now so they pay before ${MO[curM()%12]} starts.</div>
      ${upcoming.map(s=>`<div class="rrow" onclick="goDetail(${s.id})" style="cursor:pointer">
        <div><div class="rn">${esc(s.student_name)}</div><div class="rs">${MO[curM()%12]} fee: ${curr}${NR(s.monthly_fee)}</div></div>
        <div style="display:flex;gap:6px">
          <button class="tc-btn" style="font-size:10px;padding:4px 8px;border-color:var(--grn)44;color:var(--grn)" onclick="event.stopPropagation();openPay(${s.id})">💰 Collect</button>
          <button class="tc-btn wa" style="font-size:10px;padding:4px 8px" onclick="event.stopPropagation();sendWA(${s.id},'upcoming')">📱 Remind for ${MO[curM()%12]}</button>
        </div>
      </div>`).join('')}
    </div>`;
  }
  // ── SECTION 3: All outstanding dues ──
  if(dues.length){
    html+=`<div class="rcard" style="border-color:var(--ylw)55;margin-top:14px">
      <div class="rttl" style="color:var(--ylw)">💰 Fee Due — Class on Hold (${dues.length})</div>
      ${dues.map(s=>`<div class="rrow" onclick="goDetail(${s.id})" style="cursor:pointer">
        <div><div class="rn">${esc(s.student_name)}</div>
        <div class="rs">${isCurrentMonthUnpaid(s)?MO[curM()-1]+' fee unpaid':''}${calcDue(s)>0?' · Overall: '+curr+NR(calcDue(s)):''}</div></div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          <div style="font-family:var(--mono);font-size:13px;font-weight:800;color:var(--ylw)">${curr}${NR(calcDue(s)||parseFloat(s.monthly_fee)||0)}</div>
          <div style="display:flex;gap:5px">
            <button class="tc-btn" style="font-size:10px;padding:4px 8px;border-color:var(--grn)44;color:var(--grn)" onclick="event.stopPropagation();openPay(${s.id})">💰 Collect</button>
            <button class="tc-btn wa" style="font-size:10px;padding:4px 8px" onclick="event.stopPropagation();sendWA(${s.id},'fee')">📱 Remind</button>
          </div>
        </div>
      </div>`).join('')}
    </div>`;
  }
  // ── SECTION 4: Pending homework ──
  if(pendingHW.length){
    html+=`<div class="rcard" style="border-color:var(--gold)44;margin-top:14px">
      <div class="rttl" style="color:var(--gold)">📝 Pending Homework (${pendingHW.length})</div>
      ${pendingHW.slice(0,5).map(h=>{
        const s=stus.find(x=>x.id===h.student_id);
        return`<div class="rrow">
          <div><div class="rn">${s?esc(s.student_name):'?'}</div><div class="rs">${esc(h.text.slice(0,45))}…</div></div>
          <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end">
            <span style="font-size:10px;color:var(--gold)">${h.due_date?'Due: '+h.due_date:'No due date'}</span>
            <button class="tc-btn wa" style="font-size:10px;padding:4px 8px" onclick="sendHWWA(${h.id},${h.student_id})">📱 Send</button>
          </div>
        </div>`;}).join('')}
    </div>`;
  }
  document.getElementById('alertsContent').innerHTML=html;
}


function updateBell(){
  const stus=DB.gs().filter(s=>s.active);
  const has=stus.some(s=>calcDue(s)>0||isCurrentMonthUnpaid(s))||
            stus.some(s=>s.fee_type==='monthly'&&isUpcomingReminder(s))||
            DB.gh().some(h=>!h.done);
  document.getElementById('bellDot').style.display=has?'block':'none';
}

// ── DAY CHIPS ──
function toggleDay(day, el){
  // Daily = select all or just Daily
  if(day==='Daily'){
    const isOn=el.classList.contains('on');
    document.querySelectorAll('#fdays-chips .day-chip').forEach(c=>c.classList.remove('on'));
    if(!isOn) el.classList.add('on');
  } else {
    // Deselect Daily if selecting specific days
    const dailyChip=document.querySelector('#fdays-chips [data-day="Daily"]');
    if(dailyChip) dailyChip.classList.remove('on');
    el.classList.toggle('on');
  }
  updateDaysSummary();
}

function updateDaysSummary(){
  const selected=[...document.querySelectorAll('#fdays-chips .day-chip.on')].map(c=>c.dataset.day);
  document.getElementById('fdays').value=selected.join(', ');
  const summary=document.getElementById('fdays-summary');
  if(selected.length){
    const isDaily=selected.includes('Daily');
    const perWeek=isDaily?7:selected.length;
    summary.textContent=`${perWeek} class${perWeek!==1?'es':''}/week · ~${Math.round(perWeek*4.33)} classes/month`;
  } else {
    summary.textContent='';
  }
  updateClassCostSummary();
}

function updateClassCostSummary(){
  const selected=[...document.querySelectorAll('#fdays-chips .day-chip.on')].map(c=>c.dataset.day);
  const dur=parseInt(document.getElementById('fdur').value)||45;
  const summaryEl=document.getElementById('fclsSummary');
  if(!selected.length){summaryEl.style.display='none';return;}
  const isDaily=selected.includes('Daily');
  const perWeek=isDaily?7:selected.length;
  const perMonth=Math.round(perWeek*4.33);
  const hrsMonth=((perMonth*dur)/60).toFixed(1);
  document.getElementById('fclsPerWeek').textContent=perWeek;
  document.getElementById('fclsPerMonth').textContent=perMonth;
  document.getElementById('fclsHrsMonth').textContent=hrsMonth+'h';
  // Cost
  const costWrap=document.getElementById('fclsCostWrap');
  const perClassFee=parseFloat(document.getElementById('ffeepc')?.value)||0;
  if(perClassFee>0){
    document.getElementById('fclsCostMonth').textContent=getSettings().curr+(perMonth*perClassFee).toLocaleString('en-IN');
    costWrap.style.display='block';
  } else {
    costWrap.style.display='none';
  }
  summaryEl.style.display='block';
}

function setDayChips(daysStr){
  // Clear all
  document.querySelectorAll('#fdays-chips .day-chip').forEach(c=>c.classList.remove('on'));
  if(!daysStr) return;
  const days=daysStr.split(',').map(d=>d.trim());
  days.forEach(d=>{
    const chip=document.querySelector(`#fdays-chips [data-day="${d}"]`);
    if(chip) chip.classList.add('on');
  });
  updateDaysSummary();
}


function setFeeType(t){
  feeType=t;
  ['monthly','perclass','package'].forEach(x=>{
    document.getElementById('ft-'+x).classList.toggle('on',x===t);
  });
  document.getElementById('fMonthlyWrap').style.display=t==='monthly'?'block':'none';
  document.getElementById('fPerClassWrap').style.display=t==='perclass'?'block':'none';
  document.getElementById('fPackageWrap').style.display=t==='package'?'block':'none';
}

function openAdd(){
  editId=null;prevPg=curPg;
  document.getElementById('fTtl').textContent='Add Student';
  document.getElementById('fSub').textContent='Fill in student details';
  ['fn','fcon','fmob','fmeet','fdur','ffee','ffeepc','fpkgcls','fpkgfee','fadv','fnotes'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('fctype').value='online';
  document.getElementById('flevel').value='Beginner';
  document.getElementById('fvoice').value='Not set';
  document.getElementById('fjd').value=todayStr();
  // Reset day chips
  setDayChips('');
  // Reset time picker
  document.getElementById('ftime').value='';
  document.getElementById('tp-ftime-val').textContent='Select time';
  document.getElementById('tp-ftime-val').className='tp-display-val empty';
  delete TP_STATE['ftime'];
  document.getElementById('fclsSummary').style.display='none';
  setFeeType('monthly');
  showFormPage();
}

function openEdit(id){
  const s=DB.gs().find(x=>x.id===id);if(!s)return;
  editId=id;prevPg='det';
  document.getElementById('fTtl').textContent='Edit Student';
  document.getElementById('fSub').textContent='Update student info';
  document.getElementById('fn').value=s.student_name||'';
  document.getElementById('fcon').value=s.contact_name||'';
  document.getElementById('fmob').value=s.mobile_number||'';
  document.getElementById('fctype').value=s.class_type||'online';
  document.getElementById('fmeet').value=s.meet_link||'';
  document.getElementById('fdays').value=s.class_days||'';
  setDayChips(s.class_days||'');
  // Restore time picker
  if(s.class_time){
    setTPValue('ftime', s.class_time);
    document.getElementById('ftime').value=s.class_time;
  } else {
    document.getElementById('ftime').value='';
    document.getElementById('tp-ftime-val').textContent='Select time';
    document.getElementById('tp-ftime-val').className='tp-display-val empty';
    delete TP_STATE['ftime'];
  }
  document.getElementById('fdur').value=s.class_duration||'';
  document.getElementById('flevel').value=s.level||'Beginner';
  document.getElementById('fvoice').value=s.voice_type||'Not set';
  document.getElementById('fjd').value=s.joining_date||'';
  document.getElementById('ffee').value=s.monthly_fee||'';
  document.getElementById('ffeepc').value=s.per_class_fee||'';
  document.getElementById('fpkgcls').value=s.pkg_classes||'';
  document.getElementById('fpkgfee').value=s.pkg_fee||'';
  document.getElementById('fadv').value='';
  document.getElementById('fnotes').value=s.notes||'';
  setFeeType(s.fee_type||'monthly');
  showFormPage();
}

function saveStu(){
  const name=(document.getElementById('fn').value||'').trim();
  const mobile=(document.getElementById('fmob').value||'').trim();
  if(!name){toast('Enter student name','er');return;}
  if(!mobile){toast('Enter mobile number','er');return;}
  const stus=DB.gs();
  const obj={
    student_name:name,contact_name:(document.getElementById('fcon').value||'').trim(),
    mobile_number:mobile,class_type:document.getElementById('fctype').value,
    meet_link:document.getElementById('fmeet').value,
    class_days:(document.getElementById('fdays').value||'').trim(),
    class_time:document.getElementById('ftime').value,
    class_duration:document.getElementById('fdur').value,
    level:document.getElementById('flevel').value,
    voice_type:document.getElementById('fvoice').value,
    joining_date:document.getElementById('fjd').value,
    fee_type:feeType,
    monthly_fee:parseFloat(document.getElementById('ffee').value)||0,
    per_class_fee:parseFloat(document.getElementById('ffeepc').value)||0,
    pkg_classes:parseFloat(document.getElementById('fpkgcls').value)||10,
    pkg_fee:parseFloat(document.getElementById('fpkgfee').value)||0,
    notes:(document.getElementById('fnotes').value||'').trim(),
    active:true
  };
  const advAmt=parseFloat(document.getElementById('fadv').value)||0;
  if(editId){
    const i=stus.findIndex(s=>s.id===editId);
    obj.prev_due=stus[i].prev_due||0;
    stus[i]={...stus[i],...obj};
    DB.ss(stus);toast('Updated ✓','ok');goDetail(editId);
  } else {
    obj.id=DB.nid(stus);stus.push(obj);DB.ss(stus);
    if(advAmt>0){
      const pays=DB.gp();
      pays.push({id:DB.nid(pays),student_id:obj.id,amount:advAmt,type:'advance',
        mode:'Cash',note:'Initial advance',month:curM(),year:curY(),date:new Date().toLocaleDateString('en-IN')});
      DB.sp(pays);
    }
    toast('Student added ✓','ok');nav('stu');
  }
}

// ══════════════════════════════════════════════════
//  DELETE
// ══════════════════════════════════════════════════
function confirmDel(id){
  const s=DB.gs().find(x=>x.id===id);if(!s)return;
  document.getElementById('delMsg').textContent=`Delete "${s.student_name}"? All records will be removed.`;
  document.getElementById('delConfirmBtn').onclick=()=>{
    DB.ss(DB.gs().filter(s=>s.id!==id));
    DB.sp(DB.gp().filter(p=>p.student_id!==id));
    DB.sc(DB.gc().filter(c=>c.student_id!==id));
    DB.sh(DB.gh().filter(h=>h.student_id!==id));
    DB.spr(DB.gpr().filter(p=>p.student_id!==id));
    closeOv('delOv');toast('Deleted');nav('stu');
  };
  document.getElementById('delOv').classList.add('on');
}

function confirmDelPay(pid,sid){
  document.getElementById('delMsg').textContent='Remove this payment?';
  document.getElementById('delConfirmBtn').onclick=()=>{DB.sp(DB.gp().filter(p=>p.id!==pid));closeOv('delOv');toast('Removed');renderDet(sid);};
  document.getElementById('delOv').classList.add('on');
}

// ══════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════
function renderSettings(){
  const cfg=getSettings();
  document.getElementById('s-teacher').value=cfg.teacher||'';
  document.getElementById('s-inst').value=cfg.inst||'';
  document.getElementById('s-mynum').value=cfg.mynum||'';
  document.getElementById('s-curr').value=cfg.curr||'₹';
  document.getElementById('s-tpl-fee').value=cfg.tpl_fee||TPL_DEFAULTS.fee;
  document.getElementById('s-tpl-class').value=cfg.tpl_class||TPL_DEFAULTS.class;
  document.getElementById('s-tpl-hw').value=cfg.tpl_hw||TPL_DEFAULTS.hw;
  document.getElementById('s-tpl-confirm').value=cfg.tpl_confirm||TPL_DEFAULTS.confirm;
  document.getElementById('si-stus').textContent=DB.gs().filter(s=>s.active).length;
  document.getElementById('si-pays').textContent=DB.gp().length;
  renderAvailSettings();
  renderThemeGrid();
  settingsDirty=false;updateSaveBtn();
}

function settingsChanged(){settingsDirty=true;updateSaveBtn();}
function updateSaveBtn(){
  const btn=document.getElementById('saveSetBtn');
  if(settingsDirty){btn.style.opacity='1';btn.style.cursor='pointer';btn.disabled=false;btn.textContent='Save Settings';}
  else{btn.style.opacity='.5';btn.style.cursor='default';btn.disabled=true;btn.textContent='Settings Saved ✓';}
}

function saveSettings(){
  saveSettingsObj({
    teacher:document.getElementById('s-teacher').value.trim(),
    inst:document.getElementById('s-inst').value.trim(),
    mynum:document.getElementById('s-mynum').value.trim(),
    curr:(document.getElementById('s-curr').value||'₹').trim(),
    tpl_fee:document.getElementById('s-tpl-fee').value,
    tpl_class:document.getElementById('s-tpl-class').value,
    tpl_hw:document.getElementById('s-tpl-hw').value,
    tpl_confirm:document.getElementById('s-tpl-confirm').value,
  });
  settingsDirty=false;updateSaveBtn();
  document.getElementById('hdrSub').textContent=getSettings().inst||getSettings().teacher||'Singing Teacher';
  toast('Settings saved ✓','ok');
}

// ══════════════════════════════════════════════════
//  DATA MANAGEMENT
// ══════════════════════════════════════════════════
function exportData(){
  const data={version:1,exported:new Date().toISOString(),
    students:DB.gs(),payments:DB.gp(),classes:DB.gc(),homework:DB.gh(),progress:DB.gpr(),batches:DB.gb(),settings:getSettings()};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`GuruJi_backup_${todayStr()}.json`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(url);toast('Exported ✓','ok');
}

function importData(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      if(!data.students) throw new Error('Invalid');
      document.getElementById('delMsg').textContent=`Import backup from ${data.exported?data.exported.split('T')[0]:'?'}? This replaces all data.`;
      document.getElementById('delConfirmBtn').onclick=()=>{
        DB.ss(data.students||[]);DB.sp(data.payments||[]);DB.sc(data.classes||[]);
        DB.sh(data.homework||[]);DB.spr(data.progress||[]);DB.sb(data.batches||[]);
        if(data.settings) saveSettingsObj(data.settings);
        closeOv('delOv');toast('Imported ✓','ok');input.value='';nav('dash');
      };
      document.getElementById('delOv').classList.add('on');
    }catch(err){toast('Invalid file','er');}
  };
  reader.readAsText(file);
}

function confirmClearAll(){
  document.getElementById('delMsg').textContent='Delete ALL data? Cannot be undone.';
  document.getElementById('delConfirmBtn').onclick=()=>{const th=localStorage.getItem('sp_theme');localStorage.clear();if(th)localStorage.setItem('sp_theme',th);closeOv('delOv');toast('Cleared');nav('dash');loadSavedTheme();};
  document.getElementById('delOv').classList.add('on');
}

// ══════════════════════════════════════════════════
//  MODAL HELPERS
// ══════════════════════════════════════════════════
function closeOv(id){document.getElementById(id).classList.remove('on');}
['payOv','hwOv','progOv','attOv','waOv','delOv','addClassOv','reschedOv','addBatchOv','batchAttOv','userMenuOv'].forEach(id=>{
  document.getElementById(id).addEventListener('click',function(e){if(e.target===this)closeOv(id);});
});

// Show/hide meet link based on class type
document.getElementById('fctype').addEventListener('change',function(){
  document.getElementById('fmeetWrap').style.display=this.value!=='offline'?'block':'none';
});

// ══════════════════════════════════════════════════
//  DEMO DATA
// ══════════════════════════════════════════════════
if(DB.gs().length===0){
  const jd=(n)=>{const d=new Date(curY(),curM()-1-n,1);return d.toISOString().split('T')[0];};
  DB.ss([
    {id:1,student_name:'Priya Sharma',contact_name:'Ramesh Sharma',mobile_number:'9876543210',class_type:'online',meet_link:'https://meet.google.com/abc-defg-hij',class_days:'Mon, Wed, Fri',class_time:'18:00',class_duration:'45',level:'Intermediate',voice_type:'Soprano',joining_date:jd(3),fee_type:'monthly',monthly_fee:2000,per_class_fee:0,pkg_classes:0,pkg_fee:0,prev_due:0,notes:'Loves Hindustani classical',active:true},
    {id:2,student_name:'Arjun Mehta',contact_name:'Suresh Mehta',mobile_number:'9123456789',class_type:'offline',meet_link:'',class_days:'Tue, Thu',class_time:'17:00',class_duration:'60',level:'Beginner',voice_type:'Tenor',joining_date:jd(2),fee_type:'perclass',monthly_fee:0,per_class_fee:350,pkg_classes:0,pkg_fee:0,prev_due:0,notes:'',active:true},
    {id:3,student_name:'Kavya Reddy',contact_name:'Vijay Reddy',mobile_number:'9988776655',class_type:'online',meet_link:'https://meet.google.com/xyz-abcd-efg',class_days:'Sat, Sun',class_time:'10:00',class_duration:'45',level:'Advanced',voice_type:'Alto',joining_date:jd(4),fee_type:'package',monthly_fee:0,per_class_fee:0,pkg_classes:8,pkg_fee:2400,prev_due:0,notes:'Learning Carnatic music',active:true},
  ]);
  // Add some classes for today
  const cls=[];
  cls.push({id:1,student_id:1,date:todayStr(),time:'18:00',duration:'45',type:'online',meet_link:'https://meet.google.com/abc-defg-hij',topic:'Yaman Raga — Alaap',attended:null});
  cls.push({id:2,student_id:2,date:todayStr(),time:'17:00',duration:'60',type:'offline',meet_link:'',topic:'Sur Exercises',attended:null});
  DB.sc(cls);
  // Some payments
  const pays=[];
  pays.push({id:1,student_id:1,amount:2000,type:'fee',mode:'UPI',note:'',month:curM()-1,year:curY(),date:'01/03/2025'});
  pays.push({id:2,student_id:3,amount:1000,type:'advance',mode:'Cash',note:'Initial',month:curM(),year:curY(),date:'01/03/2025'});
  DB.sp(pays);
  // Some progress
  DB.spr([
    {id:1,student_id:1,name:'Yaman Raga',pct:65,note:'Working on Mandra saptak'},
    {id:2,student_id:1,name:'Bhairav Raga',pct:30,note:'Just started'},
    {id:3,student_id:3,name:'Kalyani Raga',pct:80,note:'Almost ready for performance'},
  ]);
  // Some homework
  DB.sh([
    {id:1,student_id:1,text:'Practise Yaman Alaap 15 minutes daily. Focus on slow meend on Ga note.',due_date:todayStr(),created:'15/03/2025',done:false},
    {id:2,student_id:2,text:'Sa Re Ga Ma Pa Dha Ni — all 3 octaves without break. 20 repetitions.',due_date:'',created:'14/03/2025',done:true},
  ]);
  saveSettingsObj({...SET_DEFAULT,teacher:'Ravi Sir',inst:'Swar Sangam Academy',curr:'₹'});
}

// ══════════════════════════════════════════════════
//  CUSTOM TIME PICKER
// ══════════════════════════════════════════════════
const TP_STATE={};

function buildTPPanel(id){
  const panel=document.getElementById(`tp-${id}-panel`);
  if(!panel) return;
  const st=TP_STATE[id]||{h:12,m:0,ampm:'AM'};
  const hours=Array.from({length:12},(_,i)=>i+1);
  const mins=Array.from({length:12},(_,i)=>i*5);
  panel.innerHTML=`
    <div class="tp-row" onclick="event.stopPropagation()">
      <div class="tp-col">
        <div class="tp-lbl">Hour</div>
        <div class="tp-scroll" id="tp-${id}-h">
          ${hours.map(h=>`<div class="tp-item${st.h===h?' sel':''}" onclick="event.stopPropagation();tpSet('${id}','h',${h})">${h}</div>`).join('')}
        </div>
      </div>
      <div class="tp-col">
        <div class="tp-sep">:</div>
        <div class="tp-scroll" id="tp-${id}-m">
          ${mins.map(m=>`<div class="tp-item${st.m===m?' sel':''}" onclick="event.stopPropagation();tpSet('${id}','m',${m})">${m<10?'0'+m:m}</div>`).join('')}
        </div>
      </div>
      <div class="tp-col">
        <div class="tp-lbl">AM/PM</div>
        <div class="tp-ampm">
          <div class="tp-ampm-btn${st.ampm==='AM'?' sel':''}" onclick="event.stopPropagation();tpSet('${id}','ampm','AM')">AM</div>
          <div class="tp-ampm-btn${st.ampm==='PM'?' sel':''}" onclick="event.stopPropagation();tpSet('${id}','ampm','PM')">PM</div>
        </div>
      </div>
    </div>
    <button class="tp-done" onclick="event.stopPropagation();tpConfirm('${id}')">Set Time ✓</button>`;
  setTimeout(()=>{
    const hSel=panel.querySelector('.tp-scroll .sel');
    if(hSel) hSel.scrollIntoView({block:'nearest',behavior:'smooth'});
  },30);
}

function toggleTP(id){
  const panel=document.getElementById(`tp-${id}-panel`);
  if(!panel) return;
  const isOpen=panel.classList.contains('open');
  document.querySelectorAll('.tp-panel.open').forEach(p=>p.classList.remove('open'));
  document.querySelectorAll('.tp-display.open').forEach(d=>d.classList.remove('open'));
  if(!isOpen){
    buildTPPanel(id);
    // Position first, then show
    const btn=document.querySelector(`[onclick="toggleTP('${id}')"]`);
    if(btn){
      btn.classList.add('open');
      const rect=btn.getBoundingClientRect();
      const spaceBelow=window.innerHeight-rect.bottom;
      panel.style.top=(spaceBelow>240?rect.bottom+6:rect.top-250)+'px';
      panel.style.left=Math.min(Math.max(10,rect.left),window.innerWidth-280)+'px';
    }
    panel.classList.add('open');
  }
}

function tpSet(id, field, val){
  if(!TP_STATE[id]) TP_STATE[id]={h:12,m:0,ampm:'AM'};
  TP_STATE[id][field]=val;
  // Rebuild panel but keep position
  const panel=document.getElementById(`tp-${id}-panel`);
  const top=panel?.style.top, left=panel?.style.left;
  buildTPPanel(id);
  if(panel&&top){ panel.style.top=top; panel.style.left=left; }
}

function tpConfirm(id){
  const st=TP_STATE[id]||{h:12,m:0,ampm:'AM'};
  let h24=st.h;
  if(st.ampm==='AM'&&st.h===12) h24=0;
  else if(st.ampm==='PM'&&st.h!==12) h24=st.h+12;
  const val=(h24<10?'0':'')+h24+':'+(st.m<10?'0':'')+st.m;
  const hidden=document.getElementById(id);
  if(hidden) hidden.value=val;
  const display=document.getElementById(`tp-${id}-val`);
  if(display){
    display.textContent=st.h+':'+(st.m<10?'0':'')+st.m+' '+st.ampm;
    display.classList.remove('empty');
  }
  const panel=document.getElementById(`tp-${id}-panel`);
  const btn=document.querySelector(`[onclick="toggleTP('${id}')"]`);
  if(panel) panel.classList.remove('open');
  if(btn) btn.classList.remove('open');
}

function setTPValue(id, val24){
  if(!val24) return;
  const[h,m]=val24.split(':');
  let hr=+h, mn=+m;
  // Round mn to nearest 5
  mn=Math.round(mn/5)*5; if(mn===60) mn=55;
  const ampm=hr<12?'AM':'PM';
  const h12=hr%12||12;
  TP_STATE[id]={h:h12,m:mn,ampm};
  const display=document.getElementById(`tp-${id}-val`);
  if(display){
    display.textContent=h12+':'+(mn<10?'0':'')+mn+' '+ampm;
    display.classList.remove('empty');
  }
}

// Close picker on outside click - but not when clicking inside panel
document.addEventListener('click',function(e){
  if(!e.target.closest('.tp-wrap')&&!e.target.closest('.tp-panel')){
    document.querySelectorAll('.tp-panel.open').forEach(p=>p.classList.remove('open'));
    document.querySelectorAll('.tp-display.open').forEach(d=>d.classList.remove('open'));
  }
});

// ══════════════════════════════════════════════════

function showUserMenu(){
  const u=CURRENT_USER;if(!u)return;
  document.getElementById('userMenuName').textContent=u.displayName||'Teacher';
  document.getElementById('userMenuEmail').textContent=u.email;
  const photo=document.getElementById('userMenuPhoto');
  const avatar=document.getElementById('userMenuAvatar');
  if(u.photoURL){photo.src=u.photoURL;photo.style.display='block';avatar.style.display='none';}
  else{photo.style.display='none';avatar.style.display='flex';}
  const providers=u.providerData.map(p=>p.providerId==='google.com'?'Google':'Email/Password').join(', ');
  document.getElementById('userMenuProvider').textContent='Signed in via '+providers;
  document.getElementById('userMenuOv').classList.add('on');
}

let editBatchId=null;

function renderBatches(){
  const batches=DB.gb();
  const el=document.getElementById('batchList');
  const empty=document.getElementById('batchEmpty');
  if(!batches.length){if(el)el.innerHTML='';if(empty)empty.style.display='block';return;}
  if(empty)empty.style.display='none';
  const stus=DB.gs();
  const cfg=getSettings();
  const colors=['#c084fc','#34d399','#60a5fa','#f59e0b','#f87171'];
  el.innerHTML=batches.map(b=>{
    const members=stus.filter(s=>b.student_ids?.includes(s.id));
    const col=colors[b.id%colors.length];
    return`<div style="background:var(--surf);border:1px solid var(--bdr);border-left:3px solid ${col};border-radius:var(--r);padding:13px;margin:0 14px 12px;box-shadow:0 4px 16px #00000022;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
        <div>
          <div style="font-size:16px;font-weight:800;">${esc(b.name)}</div>
          <div style="font-size:11px;color:var(--txt3);margin-top:2px;">${b.subject?esc(b.subject)+' · ':''}${members.length} student${members.length!==1?'s':''}${b.max_students?' · max '+b.max_students:''}${b.schedule?' · '+esc(b.schedule):''}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="sc-btn" style="font-size:11px;padding:5px 9px" onclick="openEditBatch(${b.id})">✏️</button>
          <button class="sc-btn" style="font-size:11px;padding:5px 9px;border-color:var(--red)44;color:var(--red)" onclick="deleteBatch(${b.id})">🗑</button>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
        ${members.map(s=>avatarHTML(s,32)).join('')}
        ${!members.length?`<span style="font-size:12px;color:var(--txt3)">No students yet — tap ✏️ to add</span>`:''}
      </div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;">
        <button class="sc-btn" style="border-color:var(--acc)44;color:var(--acc)" onclick="scheduleBatchClass(${b.id})">📅 Schedule Class</button>
        <button class="sc-btn wa" onclick="batchWA(${b.id})">📱 WA All</button>
        <button class="sc-btn" style="border-color:var(--grn)44;color:var(--grn)" onclick="collectBatchFees(${b.id})">💰 Collect Fees</button>
      </div>
    </div>`;
  }).join('');
}

function openAddBatch(){
  editBatchId=null;
  document.getElementById('addBatchTitle').textContent='Create Batch';
  ['batch-name','batch-subj','batch-days','batch-max'].forEach(id=>document.getElementById(id).value='');
  renderBatchStudentCheckboxes([]);
  document.getElementById('addBatchOv').classList.add('on');
}

function openEditBatch(id){
  editBatchId=id;
  const b=DB.gb().find(x=>x.id===id);if(!b)return;
  document.getElementById('addBatchTitle').textContent='Edit Batch';
  document.getElementById('batch-name').value=b.name||'';
  document.getElementById('batch-subj').value=b.subject||'';
  document.getElementById('batch-days').value=b.schedule||'';
  document.getElementById('batch-max').value=b.max_students||'';
  renderBatchStudentCheckboxes(b.student_ids||[]);
  document.getElementById('addBatchOv').classList.add('on');
}

function renderBatchStudentCheckboxes(selected=[]){
  const stus=DB.gs().filter(s=>s.active);
  document.getElementById('batch-stu-checkboxes').innerHTML=stus.map(s=>`
    <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:4px 0;">
      <input type="checkbox" id="bsc-${s.id}" ${selected.includes(s.id)?'checked':''}
        style="width:16px;height:16px;accent-color:var(--acc);cursor:pointer;flex-shrink:0;"/>
      ${avatarHTML(s,28)}
      <div><div style="font-size:13px;font-weight:700;">${esc(s.student_name)}</div>
      <div style="font-size:11px;color:var(--txt3);">${s.level||''}</div></div>
    </label>`).join('');
}

function saveBatch(){
  const name=(document.getElementById('batch-name').value||'').trim();
  if(!name){toast('Enter batch name','er');return;}
  const stus=DB.gs().filter(s=>s.active);
  const selectedIds=stus.filter(s=>document.getElementById(`bsc-${s.id}`)?.checked).map(s=>s.id);
  const batches=DB.gb();
  const obj={name,subject:document.getElementById('batch-subj').value.trim(),
    schedule:document.getElementById('batch-days').value.trim(),
    max_students:parseInt(document.getElementById('batch-max').value)||null,
    student_ids:selectedIds};
  if(editBatchId){const i=batches.findIndex(b=>b.id===editBatchId);batches[i]={...batches[i],...obj};}
  else{obj.id=DB.nid(batches);batches.push(obj);}
  DB.sb(batches);closeOv('addBatchOv');toast('Batch saved ✓','ok');renderBatches();
}

function deleteBatch(id){
  document.getElementById('delMsg').textContent='Delete this batch? Students are not deleted.';
  document.getElementById('delConfirmBtn').onclick=()=>{DB.sb(DB.gb().filter(b=>b.id!==id));closeOv('delOv');toast('Deleted');renderBatches();};
  document.getElementById('delOv').classList.add('on');
}

function scheduleBatchClass(batchId){
  nav('sch');
  setTimeout(()=>openAddClass(batchId),200);
}

function batchWA(batchId){
  const b=DB.gb().find(x=>x.id===batchId);if(!b)return;
  const stus=DB.gs().filter(s=>b.student_ids?.includes(s.id));
  const cfg=getSettings();
  if(!stus.length){toast('No students in batch','er');return;}
  const bname=b.name, bsubj=b.subject||'', bsch=b.schedule||'';
  const tname=cfg.teacher||'Teacher', tinst=cfg.inst||'';
  const msg='Hello! 🎵\nReminder for *'+bname+'*'+(bsubj?' ('+bsubj+')':'')+'.'+(bsch?'\n📅 Schedule: '+bsch:'')+'\nPlease be on time 🙏\n\n— '+tname+(tinst?', '+tinst:'');
  document.getElementById('waPreviewText').textContent=msg+'\n\n(Will send to: '+stus.map(s=>s.student_name).join(', ')+')';
  document.getElementById('waConfirmBtn').onclick=()=>{
    closeOv('waOv');
    stus.forEach((st,i)=>{
      let n=String(st.mobile_number||'').replace(/\D/g,'');
      if(!n.startsWith('91')) n='91'+n;
      setTimeout(()=>window.open('https://wa.me/'+n+'?text='+encodeURIComponent(msg),'_blank'),i*800);
    });
    toast('Opening WA for '+stus.length+' students 📱','ok');
  };
  document.getElementById('waOv').classList.add('on');
}

function collectBatchFees(batchId){
  const b=DB.gb().find(x=>x.id===batchId);if(!b)return;
  const stus=DB.gs().filter(s=>b.student_ids?.includes(s.id)&&calcDue(s)>0);
  if(!stus.length){toast('All fees clear in this batch ✓','ok');return;}
  openPay(stus[0].id);
  if(stus.length>1) toast(`${stus.length} students have dues`);
}

const pendingBatchAtt={};
function openBatchAtt(clsId,batchId){
  batchAttClsId=clsId;batchAttBatchId=batchId;
  const b=DB.gb().find(x=>x.id===batchId);
  const members=DB.gs().filter(s=>b?.student_ids?.includes(s.id));
  const c=DB.gc().find(x=>x.id===clsId);
  document.getElementById('batchAttTitle').textContent=`Attendance — ${b?b.name:'Batch'}`;
  Object.keys(pendingBatchAtt).forEach(k=>delete pendingBatchAtt[k]);
  document.getElementById('batchAttList').innerHTML=members.map(s=>{
    const att=c?.batch_att?.[s.id];
    if(att!==undefined) pendingBatchAtt[s.id]=att;
    return`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bdr);">
      <div style="display:flex;align-items:center;gap:10px;">${avatarHTML(s,34)}<div style="font-size:13px;font-weight:700;">${esc(s.student_name)}</div></div>
      <div style="display:flex;gap:6px;">
        <button id="att-p-${s.id}" class="sc-btn" style="${att===true?'border-color:var(--grn);color:var(--grn);background:var(--grn)10':''}" onclick="setBatchAtt(${s.id},true)">✅</button>
        <button id="att-a-${s.id}" class="sc-btn" style="${att===false?'border-color:var(--red)44;color:var(--red);background:var(--red)0d':''}" onclick="setBatchAtt(${s.id},false)">❌</button>
      </div>
    </div>`;
  }).join('');
  document.getElementById('batchAttOv').classList.add('on');
}

function setBatchAtt(stuId,present){
  pendingBatchAtt[stuId]=present;
  const pb=document.getElementById(`att-p-${stuId}`);
  const ab=document.getElementById(`att-a-${stuId}`);
  if(pb){pb.style.borderColor=present?'var(--grn)':'var(--bdr)';pb.style.color=present?'var(--grn)':'var(--txt2)';pb.style.background=present?'var(--grn)10':'';}
  if(ab){ab.style.borderColor=!present?'var(--red)':'var(--bdr)';ab.style.color=!present?'var(--red)':'var(--txt2)';ab.style.background=!present?'var(--red)0d':'';}
}

function saveBatchAtt(){
  const cls=DB.gc();
  const i=cls.findIndex(c=>c.id===batchAttClsId);
  if(i>=0){
    if(!cls[i].batch_att) cls[i].batch_att={};
    Object.assign(cls[i].batch_att,pendingBatchAtt);
    cls[i].attended=Object.values(cls[i].batch_att).some(v=>v===true);
  }
  DB.sc(cls);closeOv('batchAttOv');toast('Attendance saved ✓','ok');
  renderSch();renderDash();
}

// ══════════════════════════════════════════════════
//  RESCHEDULE
// ══════════════════════════════════════════════════
let reschedClsId=null;

function openResched(cid){
  reschedClsId=cid;
  const c=DB.gc().find(x=>x.id===cid);if(!c) return;
  const s=DB.gs().find(x=>x.id===c.student_id);
  document.getElementById('reschedTitle').textContent=`Reschedule — ${s?s.student_name:'Class'}`;
  document.getElementById('reschedInfo').textContent=
    `Original: ${c.date} at ${fmt12(c.time)}${c.duration?' · '+c.duration+'m':''}`;
  document.getElementById('resched-date').value=c.date;
  document.getElementById('resched-time').value='';
  document.getElementById('tp-resched-time-val').textContent='Select time';
  document.getElementById('tp-resched-time-val').className='tp-display-val empty';
  document.getElementById('resched-reason').value='';
  document.getElementById('resched-notify').checked=true;
  if(c.time) setTPValue('resched-time',c.time);
  document.getElementById('reschedOv').classList.add('on');
}

function saveResched(){
  const c=DB.gc().find(x=>x.id===reschedClsId);if(!c) return;
  const newDate=document.getElementById('resched-date').value;
  const newTime=document.getElementById('resched-time').value;
  const reason=document.getElementById('resched-reason').value;
  const notify=document.getElementById('resched-notify').checked;
  if(!newDate){toast('Select new date','er');return;}
  if(!newTime){toast('Select new time','er');return;}
  const cls=DB.gc();
  const i=cls.findIndex(x=>x.id===reschedClsId);
  const oldDate=cls[i].date, oldTime=cls[i].time;
  cls[i].date=newDate;
  cls[i].time=newTime;
  cls[i].rescheduled=true;
  cls[i].original_date=oldDate;
  cls[i].original_time=oldTime;
  DB.sc(cls);
  closeOv('reschedOv');
  toast('Class rescheduled ✓','ok');
  // Notify student via WA
  if(notify){
    const s=DB.gs().find(x=>x.id===c.student_id);
    const cfg=getSettings();
    if(s&&s.mobile_number){
      const msg='Hello '+s.student_name+'! 📅\nYour class has been rescheduled.\n\nOriginal: '+oldDate+' at '+fmt12(oldTime)+'\nNew: '+newDate+' at '+fmt12(newTime)+(reason?'\n\nReason: '+reason:'')+'\n\nSorry for the inconvenience 🙏\n— '+(cfg.teacher||'Teacher');
      setTimeout(()=>sendWAMsg(s.mobile_number,msg),300);
    }
  }
  selDay=newDate;renderSch();renderDash();
}


const DAYS_FULL=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function getAvailability(){return JSON.parse(localStorage.getItem('sp_avail')||'{}');}
function saveAvailObj(o){fbSet('sp_avail',o);}

function renderAvailSettings(){
  const avail=getAvailability();
  const rows=document.getElementById('availRows');
  if(!rows) return;
  rows.innerHTML=DAYS_FULL.map((day,i)=>{
    const a=avail[i]||{on:i>=1&&i<=5,from:'09:00',to:'18:00'};
    return`<div style="padding:10px 14px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <label class="tog-sw" style="flex-shrink:0">
        <input type="checkbox" id="av-on-${i}" ${a.on?'checked':''}>
        <span class="tog-sl"></span>
      </label>
      <div style="font-size:13px;font-weight:700;min-width:85px;color:${a.on?'var(--txt)':'var(--txt3)'};">${day}</div>
      <input type="time" class="fi" id="av-from-${i}" value="${a.from}" style="flex:1;min-width:90px;padding:8px 10px;font-size:13px;" ${a.on?'':'disabled'}/>
      <span style="color:var(--txt3);font-size:12px;flex-shrink:0;">to</span>
      <input type="time" class="fi" id="av-to-${i}" value="${a.to}" style="flex:1;min-width:90px;padding:8px 10px;font-size:13px;" ${a.on?'':'disabled'}/>
    </div>`;
  }).join('');
  DAYS_FULL.forEach((_,i)=>{
    const chk=document.getElementById(`av-on-${i}`);
    if(chk) chk.addEventListener('change',()=>{
      document.getElementById(`av-from-${i}`).disabled=!chk.checked;
      document.getElementById(`av-to-${i}`).disabled=!chk.checked;
    });
  });
}

function saveAvailability(){
  const avail={};
  DAYS_FULL.forEach((_,i)=>{
    avail[i]={
      on:document.getElementById(`av-on-${i}`)?.checked||false,
      from:document.getElementById(`av-from-${i}`)?.value||'09:00',
      to:document.getElementById(`av-to-${i}`)?.value||'18:00',
    };
  });
  saveAvailObj(avail);toast('Availability saved ✓','ok');renderDash();
}

function renderAvailCard(){
  const el=document.getElementById('availCard');if(!el)return;
  const avail=getAvailability();
  const todayDow=now.getDay();
  const a=avail[todayDow];
  const todayCls=DB.gc().filter(c=>c.date===todayStr());

  // If no availability set but has classes, infer from class times
  let from=a?.from, to=a?.to, isSet=a?.on;
  if(!isSet){
    if(todayCls.length){
      // Infer window from earliest class start to latest class end
      const toMinsLocal=t=>{const[h,m]=t.split(':');return +h*60+ +m;};
      const starts=todayCls.map(c=>toMinsLocal(c.time));
      const ends=todayCls.map(c=>toMinsLocal(c.time)+(parseInt(c.duration)||45));
      const minS=Math.min(...starts), maxE=Math.max(...ends);
      const pad=m=>(m<10?'0':'')+Math.floor(m/60)+':'+(m%60<10?'0':'')+(m%60);
      from=pad(Math.max(0,minS-30));
      to=pad(Math.min(1439,maxE+30));
      isSet=true;
    } else {
      // Truly free day — no classes, no availability set
      el.innerHTML=`<div style="background:var(--surf);border:1px solid var(--grn)44;border-radius:14px;padding:13px 14px;display:flex;align-items:center;gap:12px;">
        <div style="font-size:26px;">🟢</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:800;color:var(--grn)">Completely Free Today!</div>
          <div style="font-size:11px;color:var(--txt3);margin-top:2px">${DAYS_FULL[todayDow]} — no classes scheduled</div>
        </div>
        <button onclick="nav('set');setTimeout(()=>document.getElementById('avail-section').scrollIntoView({behavior:'smooth'}),200)"
          style="padding:6px 12px;border-radius:8px;background:var(--acc)18;border:1px solid var(--acc)44;color:var(--acc);font-size:11px;cursor:pointer;font-weight:700;flex-shrink:0;">Set Hours →</button>
      </div>`;
      return;
    }
  }

  const toMins=t=>{const[h,m]=t.split(':');return +h*60+ +m;};
  const toHHMM=m=>{const h=Math.floor(m/60);const mn=m%60;return(h%12||12)+':'+(mn<10?'0':'')+mn+(h<12?' AM':' PM');};
  const durStr=m=>m>=60?(Math.floor(m/60)+'h'+(m%60?' '+m%60+'m':'')):(m+'m');
  const fromMins=toMins(from), endMins=toMins(to);
  const totalMins=Math.max(0,endMins-fromMins);
  if(!totalMins){el.innerHTML='';return;}

  // Classes clamped to window, sorted
  const clsList=[...todayCls]
    .map(c=>{
      const cs=toMins(c.time),dur=parseInt(c.duration)||45,ce=cs+dur;
      const s=DB.gs().find(x=>x.id===c.student_id);
      return{from:Math.max(cs,fromMins),to:Math.min(ce,endMins),label:s?s.student_name:'Class'};
    })
    .filter(c=>c.from<c.to)
    .sort((x,y)=>x.from-y.from);

  // Merge overlapping
  const merged=[];
  clsList.forEach(c=>{
    if(merged.length&&c.from<merged[merged.length-1].to){
      merged[merged.length-1].to=Math.max(merged[merged.length-1].to,c.to);
      merged[merged.length-1].label+=' & '+c.label;
    } else merged.push({...c});
  });

  // Build slots
  const slots=[];let cursor=fromMins;
  merged.forEach(c=>{
    if(c.from>cursor) slots.push({type:'free',from:cursor,to:c.from});
    slots.push({type:'class',from:c.from,to:c.to,label:c.label});
    cursor=c.to;
  });
  if(cursor<endMins) slots.push({type:'free',from:cursor,to:endMins});

  const freeMins=slots.filter(s=>s.type==='free').reduce((sum,s)=>sum+(s.to-s.from),0);
  const busyMins=totalMins-freeMins;
  const allFree=merged.length===0;

  el.innerHTML=`<div style="background:var(--surf);border:1px solid ${allFree?'var(--grn)44':'var(--bdr)'};border-radius:14px;padding:14px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${allFree?'0':'12px'};">
      <div>
        <div style="font-size:13px;font-weight:800;">🕐 ${fmt12(from)} — ${fmt12(to)}</div>
        <div style="font-size:11px;color:var(--txt3);margin-top:2px;">${DAYS_FULL[todayDow]} · ${durStr(totalMins)} total${busyMins>0?' · '+durStr(busyMins)+' busy':''}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:20px;font-weight:900;font-family:var(--mono);color:${freeMins>0?'var(--grn)':'var(--red)'};">${freeMins>0?durStr(freeMins):'Full'}</div>
        <div style="font-size:10px;color:var(--txt3);">${allFree?'🟢 completely free':freeMins>0?'free today':'fully booked'}</div>
      </div>
    </div>
    ${!allFree?`
    <div style="display:flex;height:24px;border-radius:8px;overflow:hidden;gap:2px;margin-bottom:12px;">
      ${slots.map(sl=>{const w=Math.max(1,Math.round((sl.to-sl.from)/totalMins*100));
        return`<div style="flex:${w};min-width:3px;background:${sl.type==='free'?'var(--grn)20':'var(--acc)33'};border:1px solid ${sl.type==='free'?'var(--grn)55':'var(--acc)66'};border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden;">
          ${(sl.to-sl.from)>15?`<span style="font-size:9px;font-weight:800;color:${sl.type==='free'?'var(--grn)':'var(--acc)'};padding:0 3px;white-space:nowrap;overflow:hidden;">${sl.type==='free'?'Free':sl.label.split(' ')[0]}</span>`:''}
        </div>`;}).join('')}
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;">
      ${slots.map(sl=>`<div style="display:flex;align-items:center;gap:8px;">
        <div style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${sl.type==='free'?'var(--grn)':'var(--acc)'};"></div>
        <div style="font-size:12px;font-weight:700;min-width:140px;color:${sl.type==='free'?'var(--grn)':'var(--txt)'};">${toHHMM(sl.from)} – ${toHHMM(sl.to)}</div>
        <div style="font-size:11px;color:var(--txt3);flex:1;">${sl.type==='free'?'🟢 Free':'📚 '+esc(sl.label)}</div>
        <div style="font-size:10px;color:var(--txt3);font-family:var(--mono);">${durStr(sl.to-sl.from)}</div>
      </div>`).join('')}
    </div>`:''}
  </div>`;
}

// ══════════════════════════════════════════════════
//  THEMES
// ══════════════════════════════════════════════════
const THEMES=[
  {id:'purple',   name:'Purple Night', dark:true,  bg:'#0d0a1a',surf:'#1a1530',bdr:'#2e2850',acc:'#c084fc',txt:'#f0ebff',txt2:'#9d8ec0',txt3:'#5a5070',grn:'#34d399',red:'#f87171',ylw:'#fbbf24',h1:'#1e0a3c',h2:'#2d1060'},
  {id:'midnight', name:'Midnight',     dark:true,  bg:'#0a0f1e',surf:'#131d35',bdr:'#253050',acc:'#4f9eff',txt:'#eef2ff',txt2:'#8899bb',txt3:'#4a5878',grn:'#22d48a',red:'#ff5e7a',ylw:'#ffb830',h1:'#0f2a5e',h2:'#1a3a7a'},
  {id:'obsidian', name:'Obsidian',     dark:true,  bg:'#0d0d0d',surf:'#1a1a1a',bdr:'#2a2a2a',acc:'#7c6fff',txt:'#f0f0f0',txt2:'#888888',txt3:'#555555',grn:'#34d399',red:'#f87171',ylw:'#fbbf24',h1:'#111111',h2:'#1d1d2e'},
  {id:'forest',   name:'Forest',       dark:true,  bg:'#0d1a12',surf:'#132218',bdr:'#1e3526',acc:'#4ade80',txt:'#ecfdf5',txt2:'#6ee7b7',txt3:'#2d6a4a',grn:'#4ade80',red:'#fb923c',ylw:'#facc15',h1:'#0a2a14',h2:'#0f3d1e'},
  {id:'slate',    name:'Slate',        dark:true,  bg:'#0f172a',surf:'#1e293b',bdr:'#334155',acc:'#38bdf8',txt:'#f1f5f9',txt2:'#94a3b8',txt3:'#475569',grn:'#34d399',red:'#fb7185',ylw:'#fbbf24',h1:'#0f2040',h2:'#162d50'},
  {id:'aurora',   name:'Aurora',       dark:true,  bg:'#0f0a1e',surf:'#1a1030',bdr:'#2d1f4a',acc:'#e879f9',txt:'#f5f0ff',txt2:'#a78bfa',txt3:'#5b3d8a',grn:'#34d399',red:'#f472b6',ylw:'#fbbf24',h1:'#1a0838',h2:'#2d1060'},
  {id:'warm',     name:'Warm Dark',    dark:true,  bg:'#1a1208',surf:'#261b0c',bdr:'#3d2e14',acc:'#f59e0b',txt:'#fef9ee',txt2:'#d4a56a',txt3:'#7a5c30',grn:'#86efac',red:'#fb923c',ylw:'#fcd34d',h1:'#2a1a06',h2:'#3d2810'},
  {id:'rose',     name:'Rose Dark',    dark:true,  bg:'#1a0a10',surf:'#2a1020',bdr:'#3d1a2e',acc:'#fb7185',txt:'#fff0f3',txt2:'#f9a8b8',txt3:'#7a3050',grn:'#34d399',red:'#fb7185',ylw:'#fbbf24',h1:'#2d0818',h2:'#3d1028'},
  {id:'ocean',    name:'Ocean',        dark:true,  bg:'#020f1a',surf:'#0a2030',bdr:'#0e3050',acc:'#06b6d4',txt:'#e0f7ff',txt2:'#67c8e8',txt3:'#1a5070',grn:'#34d399',red:'#f87171',ylw:'#fbbf24',h1:'#051828',h2:'#082540'},
  {id:'light',    name:'Light Clean',  dark:false, bg:'#f8fafc',surf:'#ffffff',bdr:'#e2e8f0',acc:'#6d28d9',txt:'#0f172a',txt2:'#64748b',txt3:'#94a3b8',grn:'#16a34a',red:'#dc2626',ylw:'#d97706',h1:'#ede9fe',h2:'#ddd6fe'},
  {id:'cream',    name:'Cream',        dark:false, bg:'#fdf8f0',surf:'#fffcf5',bdr:'#e8dcc8',acc:'#c2410c',txt:'#1c1410',txt2:'#78614a',txt3:'#a8917a',grn:'#15803d',red:'#b91c1c',ylw:'#b45309',h1:'#fef3e2',h2:'#fde8c8'},
  {id:'corporate',name:'Corporate',    dark:false, bg:'#f0f4f8',surf:'#ffffff',bdr:'#cbd5e1',acc:'#1d4ed8',txt:'#1e3a5f',txt2:'#4b6584',txt3:'#94a3b8',grn:'#15803d',red:'#dc2626',ylw:'#b45309',h1:'#dbeafe',h2:'#bfdbfe'},
];

function applyTheme(id){
  const t=THEMES.find(x=>x.id===id);if(!t)return;
  const r=document.documentElement.style;
  r.setProperty('--bg',   t.bg);
  r.setProperty('--bg2',  t.bg);
  r.setProperty('--surf', t.surf);
  r.setProperty('--surf2',t.surf);
  r.setProperty('--surf3',t.surf);
  r.setProperty('--bdr',  t.bdr);
  r.setProperty('--bdr2', t.bdr);
  r.setProperty('--acc',  t.acc);
  r.setProperty('--acc2', t.acc);
  r.setProperty('--acc3', t.acc);
  r.setProperty('--txt',  t.txt);
  r.setProperty('--txt2', t.txt2);
  r.setProperty('--txt3', t.txt3);
  r.setProperty('--grn',  t.grn);
  r.setProperty('--red',  t.red);
  r.setProperty('--ylw',  t.ylw);
  // Hero variables
  r.setProperty('--hero1',    t.h1);
  r.setProperty('--hero2',    t.h2);
  r.setProperty('--hero-txt', t.txt);
  r.setProperty('--hero-txt2',t.txt2);
  // HM boxes — light on dark, dark on light
  if(t.dark){
    r.setProperty('--hm-bg',  '#ffffff0d');
    r.setProperty('--hm-bdr', '#ffffff0d');
  } else {
    r.setProperty('--hm-bg',  t.acc+'18');
    r.setProperty('--hm-bdr', t.acc+'33');
  }
  localStorage.setItem('sp_theme',id);
  fbSetRaw('sp_theme',id);
  // Update select arrow color to match accent
  const acc=encodeURIComponent(t.acc);
  const arrowSvg=`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='${acc}' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`;
  document.querySelectorAll('.fs').forEach(el=>{
    el.style.backgroundImage=arrowSvg;
    el.style.colorScheme=t.dark?'dark':'light';
  });
  // Update all option backgrounds
  document.querySelectorAll('.fs option').forEach(el=>{
    el.style.background=t.surf;
    el.style.color=t.txt;
  });
  document.documentElement.style.colorScheme=t.dark?'dark':'light';
  renderThemeGrid();
  toast('Theme: '+t.name+' ✓','ok');
}

function renderThemeGrid(){
  const el=document.getElementById('themeGrid');if(!el)return;
  const active=localStorage.getItem('sp_theme')||'purple';
  el.innerHTML=`<div class="theme-grid">${THEMES.map(t=>`
    <div class="theme-card${t.id===active?' active':''}" onclick="applyTheme('${t.id}')">
      <div class="theme-preview" style="background:${t.bg}">
        <div class="theme-mini-bar" style="background:${t.surf};border:1px solid ${t.bdr}"></div>
        <div class="theme-mini-card" style="background:${t.surf};border:1px solid ${t.bdr}">
          <div class="theme-mini-line" style="background:${t.txt};opacity:.8;width:70%"></div>
          <div class="theme-mini-line" style="background:${t.txt2};width:45%"></div>
          <div class="theme-mini-dot" style="background:${t.acc}"></div>
        </div>
      </div>
      <div class="theme-label">${t.name}</div>
    </div>`).join('')}</div>`;
}

function loadSavedTheme(){
  const id=localStorage.getItem('sp_theme')||'purple';
  applyTheme(id);
  // Ensure colorScheme applied immediately before any render
  const t=THEMES.find(x=>x.id===id);
  if(t) document.documentElement.style.colorScheme=t.dark?'dark':'light';
}

// ══════════════════════════════════════════════════
//  INIT  — load Firebase first, then boot
// ══════════════════════════════════════════════════
function bootApp(){
  // Fix display type on resize
  window.addEventListener('resize',()=>{
    const app=document.getElementById('app');
    if(app&&app.style.display!=='none'){
      app.style.display=window.innerWidth>=768?'grid':'flex';
    }
  });
  const cfg0=getSettings();
  document.getElementById('hdrDate').textContent=now.getDate()+' '+MO[curM()-1].slice(0,3)+' '+curY();
  document.getElementById('hdrSub').textContent=cfg0.inst||cfg0.teacher||'Singing Teacher';
  selDay=todayStr();
  loadSavedTheme();
  renderDash();
  updateBell();
  // Show Namaste greeting
  document.getElementById('namasteTeacher').textContent=
    cfg0.teacher ? cfg0.teacher : cfg0.inst ? cfg0.inst : '';
  setTimeout(closeNameste, 3000);
  // Show sync status
  const dot=document.getElementById('fbDot');
  if(dot) dot.style.background = FB_READY ? '#34d399' : '#f87171';
}

// App is booted via FBAUTH.onAuthStateChanged in the Firebase script block above.
// Do NOT call bootApp() or loadFromFirebase() here.

function closeNameste(){
  const ov=document.getElementById('namasteOv');
  if(!ov||ov.style.display==='none') return;
  ov.style.animation='namasteFade .4s cubic-bezier(.22,.68,0,1.1) forwards';
  setTimeout(()=>ov.style.display='none', 380);
}