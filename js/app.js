(function(){
  'use strict';
  const A=window.ASCEND;
  const S=A.storage;
  let state=S.load();
  let transitionLocked=false;
  let transitionTimer=null;
  let wakeLock=null;
  let lastVisibilityLoss=null;
  let earlyWakeDismissedSession=false;
  let holdSession=null;
  let clockTapCount=0;
  let clockTapTimer=null;
  let clockArmedUntil=0;
  let escapeTimer=null;
  let scheduleUi={view:'home',day:new Date().getDay(),page:0,editId:null,isNew:false};
  let controlUi={view:'home',profilePage:0,directiveIndex:0,achievementPage:0,attendanceTab:'overall',subjectIndex:0,historyIndex:0,correction:false};
  let currentClassContext=null;
  let activeScreenId=null;
  let brandFlashTimer=null;
  let lastResultAnimationKey=null;
  let achievementSeenTimer=null;
  let backupUi={pending:null,fileName:''};
  let noticeTimer=null;
  let noticeHideTimer=null;
  let saveNoticeTimer=null;
  let lastSaveNoticeAt=0;
  let waitingServiceWorker=null;
  let launchDismissed=false;
  let orientationBlocked=false;
  let exceptionUi={index:0};
  let clockBaseline={wall:Date.now(),mono:performance.now()};
  let clockAlertShown=false;
  let notificationSweepAt=0;
  let storageCheckAt=0;
  let integrityHeartbeatAt=0;

  const $=selector=>document.querySelector(selector);
  const glyphNames=new Set(['apex','signal','sleep','wake','confirm','reset','water','shine','stretch','bath','meal','list','work','grid','trade','close','next','academic','success','failure','profile','data','lock','chevron-left','chevron-right','emergency','update','offline','save','shield','bell','calendar','recovery','clock']);
  const glyphAlias={
    '◇':'apex','◆':'confirm','✦':'shine','⌁':'stretch','◈':'academic','A':'apex',
    '↑':'wake','▰':'reset','◉':'water','◒':'meal','▤':'list','◎':'work','▦':'grid','✓':'success','×':'close','→':'next','☾':'sleep'
  };
  const normalizeGlyph=value=>glyphNames.has(value)?value:(glyphAlias[value]||'apex');
  const glyphMarkup=(name,className='system-glyph')=>`<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#glyph-${normalizeGlyph(name)}"></use></svg>`;
  const setGlyph=(target,name)=>{const element=typeof target==='string'?document.getElementById(target):target;if(!element)return;element.innerHTML=glyphMarkup(name);element.dataset.glyph=normalizeGlyph(name)};
  const safeSession=(()=>{
    const memory=new Map();
    return{
      get:key=>{try{return sessionStorage.getItem(key)}catch(error){return memory.get(key)||null}},
      set:(key,value)=>{try{sessionStorage.setItem(key,String(value))}catch(error){memory.set(key,String(value))}},
      remove:key=>{try{sessionStorage.removeItem(key)}catch(error){memory.delete(key)}}
    };
  })();
  const screens=['setupScreen','earlyWakeScreen','sleepScreen','freeScreen','classScreen','protocolScreen','resultScreen','protocolResultScreen'];
  const pad=n=>String(Math.max(0,Math.floor(n))).padStart(2,'0');
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
  const minutes=time=>{const[h,m]=time.split(':').map(Number);return h*60+m};
  const todayMinutes=date=>date.getHours()*60+date.getMinutes()+date.getSeconds()/60;
  const formatClock=date=>new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(date);
  const formatDate=date=>new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric'}).format(date);
  const formatShortDate=value=>{const date=value instanceof Date?value:new Date(value);return Number.isNaN(date.getTime())?'Unknown':new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(date)};
  const formatTime=time=>{const d=new Date();const[h,m]=time.split(':').map(Number);d.setHours(h,m,0,0);return formatClock(d)};
  const timeOnDate=(date,time)=>{const d=new Date(date);const[h,m]=time.split(':').map(Number);d.setHours(h,m,0,0);return d};
  const isSleepWindow=date=>{const minute=todayMinutes(date);return minute>=1320||minute<240};
  const isEarlyWakeWindow=date=>{const minute=todayMinutes(date);return minute>=240&&minute<300};
  const nextWakeMoment=date=>{const wake=timeOnDate(date,'05:00');if(todayMinutes(date)>=1320)wake.setDate(wake.getDate()+1);return wake};
  const show=id=>{
    if(activeScreenId===id)return;
    screens.forEach(screen=>{document.getElementById(screen).hidden=screen!==id});
    const screen=document.getElementById(id);
    screen?.classList.remove('screen-enter');
    if(screen){void screen.offsetWidth;screen.classList.add('screen-enter')}
    activeScreenId=id;
  };
  const noticeGlyphs={save:'save',backup:'data',restore:'confirm',offline:'offline',online:'signal',update:'update',installed:'success',integrity:'shield',snapshot:'data',alert:'bell',recovery:'recovery'};
  const showSystemNotice=(kind,title,copy,duration=2300)=>{
    const notice=$('#systemNotice');if(!notice)return;
    clearTimeout(noticeTimer);clearTimeout(noticeHideTimer);
    notice.className=`system-notice notice-${kind}`;
    $('#noticeTitle').textContent=title;$('#noticeCopy').textContent=copy;
    $('#noticeGlyphUse').setAttribute('href',`#glyph-${noticeGlyphs[kind]||'apex'}`);
    notice.hidden=false;void notice.offsetWidth;notice.classList.add('notice-show');
    noticeTimer=setTimeout(()=>{notice.classList.remove('notice-show');noticeHideTimer=setTimeout(()=>{notice.hidden=true},180)},duration);
  };
  const queueSaveNotice=()=>{
    clearTimeout(saveNoticeTimer);
    if(!state.initialized||!launchDismissed||document.hidden)return;
    saveNoticeTimer=setTimeout(()=>{
      const now=Date.now();if(now-lastSaveNoticeAt<2800)return;
      lastSaveNoticeAt=now;showSystemNotice('save','LOCAL DATA SAVED','Device record synchronized.',1500);
    },520);
  };
  const save=(options={})=>{reconcileStateMachine();if(state.integrity?.clockStatus==='trusted')state.integrity.lastWallTime=new Date().toISOString();const saved=S.save(state);if(!options.silent)queueSaveNotice();return saved};
  const dismissLaunchSplash=()=>{
    const splash=$('#launchSplash');if(!splash||launchDismissed)return;
    const delay=Math.max(0,430-performance.now());
    setTimeout(()=>{splash.classList.add('launch-leave');setTimeout(()=>{splash.hidden=true;launchDismissed=true;const installed=safeSession.get('ascend-update-installed');safeSession.remove('ascend-update-reloading');if(installed){safeSession.remove('ascend-update-installed');showSystemNotice('installed','SYSTEM UPDATE INSTALLED','ASCEND is running the newest cached build.',2600)}},220)},delay);
  };
  const updateOrientationGuard=()=>{
    const touchDevice=navigator.maxTouchPoints>0||matchMedia('(pointer:coarse)').matches;
    orientationBlocked=touchDevice&&innerWidth>innerHeight&&innerHeight<=620&&innerWidth<=1100;
    document.body.classList.toggle('orientation-blocked',orientationBlocked);
    const guard=$('#orientationGuard');if(guard)guard.hidden=!orientationBlocked;
    if(orientationBlocked){cancelHold();releaseWakeLock()}else if(activeProtocolRecord())requestWakeLock();
  };
  const currentKey=()=>S.dateKey(new Date());
  const requiredProtocolCount=5;
  const protocolTransitions={pending:new Set(['active','failed']),active:new Set(['cleared','failed']),cleared:new Set(),failed:new Set()};
  const stepTransitions={pending:new Set(['active','completed']),active:new Set(['completed']),completed:new Set()};
  const transitionProtocol=(protocol,next,meta={})=>{
    if(!protocol||protocol.status===next)return protocol?.status===next;
    if(!protocolTransitions[protocol.status]?.has(next))return false;
    protocol.status=next;
    if(next==='active')protocol.startedAt=protocol.startedAt||meta.at||new Date().toISOString();
    if(['cleared','failed'].includes(next))protocol.completedAt=protocol.completedAt||meta.at||new Date().toISOString();
    if(next==='failed'){protocol.earnedXp=0;protocol.failureReason=meta.reason||protocol.failureReason||'Protocol failed.'}
    return true;
  };
  const transitionStep=(step,next,at=new Date().toISOString())=>{
    if(!step||step.status===next)return step?.status===next;
    if(!stepTransitions[step.status]?.has(next))return false;
    step.status=next;
    if(next==='active')step.startedAt=step.startedAt||at;
    if(next==='completed'){step.startedAt=step.startedAt||at;step.completedAt=step.completedAt||at}
    return true;
  };
  const reconcileStateMachine=()=>{
    Object.values(state.dayRecords||{}).forEach(day=>{
      const protocols=Object.values(day.protocols||{});let activeFound=false;
      protocols.sort((a,b)=>String(a.startedAt||'').localeCompare(String(b.startedAt||''))).forEach(protocol=>{
        if(!['pending','active','cleared','failed'].includes(protocol.status))protocol.status='pending';
        if(protocol.status==='active'){if(activeFound)protocol.status='pending';else activeFound=true}
        (protocol.steps||[]).forEach(step=>{if(!['pending','active','completed'].includes(step.status))step.status='pending'});
        if(protocol.status==='cleared')(protocol.steps||[]).forEach(step=>{if(step.status!=='completed')transitionStep(step,'completed',protocol.completedAt||new Date().toISOString())});
      });
      day.completedProtocols=protocols.filter(protocol=>protocol.status==='cleared').length;
      day.failedProtocols=protocols.filter(protocol=>protocol.status==='failed').length;
    });
  };
  const recordMoment=(record,time)=>new Date(`${record.date}T${time}:00`);
  const flagClockIntegrity=(reason,delta=0)=>{
    state.integrity=state.integrity||{};
    if(state.integrity.clockStatus==='flagged')return;
    state.integrity.clockStatus='flagged';state.integrity.rewardHold=true;state.integrity.lastFlag={at:new Date().toISOString(),reason,delta:Math.round(delta)};
    state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'integrity',message:`Clock integrity flagged: ${reason}. Rewards placed on hold.`});
    S.save(state);
    if(!clockAlertShown){clockAlertShown=true;showBreachWarning('DEVICE TIME CHANGE DETECTED','Deadlines continue, but XP rewards are held until the current device time is verified.');showSystemNotice('integrity','REWARD HOLD ACTIVE','Verify device time in System Integrity.',3600)}
  };
  const checkClockIntegrity=()=>{
    const now=Date.now(),expected=clockBaseline.wall+(performance.now()-clockBaseline.mono),drift=now-expected;
    if(Math.abs(drift)>180000){flagClockIntegrity(drift<0?'Device clock moved backward during this session.':'Device clock jumped forward during this session.',drift);clockBaseline={wall:now,mono:performance.now()}}
    const last=state.integrity?.lastWallTime?new Date(state.integrity.lastWallTime).getTime():0;
    if(last&&now<last-120000)flagClockIntegrity('Current device time is earlier than the last trusted checkpoint.',now-last);
    return state.integrity?.clockStatus!=='flagged';
  };


  const stages=[
    {max:10,name:'COMPLIANCE'},
    {max:20,name:'CONSISTENCY'},
    {max:30,name:'CONTROL'},
    {max:40,name:'INDEPENDENCE'},
    {max:49,name:'MASTERY TRIAL'},
    {max:50,name:'MASTERED'}
  ];
  const stageName=level=>stages.find(stage=>level<=stage.max)?.name||'MASTERED';
  const clearDaysRequired=level=>level<=10?3:level<=20?5:level<=30?7:level<=40?10:level<50?14:0;
  const rankOrder=['E','D','C','B','A','S'];
  const rankThresholds=[{rank:'D',level:6},{rank:'C',level:13},{rank:'B',level:21},{rank:'A',level:31},{rank:'S',level:41}];
  const eligibleRank=(level,currentRank)=>{
    const currentIndex=rankOrder.indexOf(currentRank||'E');
    return [...rankThresholds].reverse().find(item=>level>=item.level&&rankOrder.indexOf(item.rank)>currentIndex)?.rank||null;
  };
  const focusIntegrity=protocol=>clamp(100-(protocol?.focusBreaches||0)*10-Math.floor((protocol?.hiddenMilliseconds||0)/300000)*2,50,100);
  const isWeeklyBossDate=date=>date.getDay()===6;
  const variants=(...copy)=>copy;

  const protocolBlueprints=[
    {
      id:'wake',short:'WAKE',name:'Wake Protocol',icon:'wake',start:'05:00',end:'06:00',xp:120,
      prep:'Water must be ready before sleep. The directive begins when your wake time is recorded.',
      subtasks:()=>[
        {id:'wake-confirm',title:'Wake state confirmed',copy:variants('Official wake time recorded.','Player consciousness confirmed.'),icon:'confirm',type:'system'},
        {id:'leave-bed',title:'Leave your bed',copy:variants('Stand up and place both feet on the floor. Do not return to bed.','Rise immediately. Remaining in bed is not permitted.'),icon:'wake',type:'hold'},
        {id:'make-bed',title:'Make your bed',copy:variants('Restore order immediately. Finish the bed before continuing.','Restore the sleeping area before progression.'),icon:'reset',type:'hold'},
        {id:'hydrate',title:'Drink one full glass of water',copy:variants('Hydration is required before progression.','Drink one full glass of water.'),icon:'water',type:'hold'},
        {id:'hygiene',title:'Brush teeth and wash face',copy:variants('Complete basic morning hygiene before continuing.','Brush your teeth and wash your face.'),icon:'shine',type:'hold'},
        {id:'stretch',title:'Morning Stretch Dungeon',copy:variants('Complete fifteen minutes of controlled full-body stretching.','Restore mobility for fifteen uninterrupted minutes.'),icon:'stretch',type:'timer',duration:15},
        {id:'bath',title:'Take a bath',copy:variants('Complete your bath and prepare yourself for the day.','Finish bathing before the Wake Protocol deadline.'),icon:'confirm',type:'hold'}
      ]
    },
    {
      id:'breakfast',short:'MEAL',name:'Breakfast Protocol',icon:'meal',start:'06:00',end:'07:00',xp:90,
      prep:'Prepare a proper breakfast with protein and enough food for healthy weight gain.',
      subtasks:()=>[
        {id:'breakfast-prepare',title:'Prepare breakfast',copy:variants('Prepare a complete morning meal.','Begin meal preparation immediately.'),icon:'list',type:'hold'},
        {id:'breakfast-eat',title:'Eat a proper breakfast',copy:variants('Finish the prepared meal. Do not intentionally skip it.','Complete the full morning meal.'),icon:'meal',type:'hold'},
        {id:'breakfast-water',title:'Drink one glass of water',copy:variants('Complete morning hydration with the meal.','Drink one full glass of water.'),icon:'water',type:'hold'},
        {id:'breakfast-quality',title:'Confirm nutrition standard',copy:variants('Confirm that the meal included protein and enough food to support healthy weight gain.','Protein and sufficient food are required.'),icon:'success',type:'tap'}
      ]
    },
    {
      id:'dinner',short:'DINNER',name:'Dinner Protocol',icon:'meal',start:'19:30',end:'20:00',xp:90,
      prep:'Prepare dinner before the fixed window so the evening schedule remains protected.',
      subtasks:()=>[
        {id:'dinner-prepare',title:'Prepare dinner',copy:variants('Prepare the evening meal without delaying the protocol.','Begin dinner preparation.'),icon:'list',type:'hold'},
        {id:'dinner-eat',title:'Eat the full meal',copy:variants('Complete the evening meal within the fixed window.','Finish your dinner.'),icon:'meal',type:'hold'},
        {id:'dinner-water',title:'Drink one glass of water',copy:variants('Complete hydration with dinner.','Drink one full glass of water.'),icon:'water',type:'hold'},
        {id:'dinner-quality',title:'Confirm nutrition standard',copy:variants('Confirm that dinner included protein and enough food for recovery and healthy weight gain.','Confirm the meal supported recovery.'),icon:'success',type:'tap'}
      ]
    },
    {
      id:'productivity',short:'WORK',name:'Productivity Protocol',icon:'work',start:'20:00',end:'21:00',xp:180,
      prep:'Prepare your workspace. Saved subjects, deadlines, unfinished tasks, and trading notes will synchronize here.',
      subtasks:()=>[
        {id:'environment-reset',title:'Environment Reset Dungeon',copy:variants('Clear the desk, remove distractions, and prepare your laptop, charger, notes, and water.','Restore the work environment before execution.'),icon:'grid',type:'timer',duration:10},
        {id:'subject-audit',title:'Subject Task Audit',copy:variants('Review each linked subject, enter pending work, and assign deadlines.','Audit each subject before selecting tonight’s execution plan.'),icon:'list',type:'audit'},
        {id:'execution-plan',title:'Choose tonight’s execution mode',copy:variants('Select one priority, divide the session across subjects, or use Academic Maintenance when nothing is pending.','Choose the work pattern that matches the actual workload.'),icon:'work',type:'planner'},
        {id:'trading-review',title:'Trading Discipline Review',copy:variants('Review positions or watchlists, check risk limits, and record one observation. A no-trade decision is valid.','Review the market without forcing an entry.'),icon:'trade',type:'trading',duration:8},
        {id:'productivity-close',title:'Close the productivity session',copy:variants('Save work, preserve unfinished tasks, and close unnecessary tabs and applications.','Secure all outputs and end the session cleanly.'),icon:'success',type:'hold'}
      ]
    },
    {
      id:'shutdown',short:'SLEEP',name:'Shutdown Protocol',icon:'sleep',start:'21:00',end:'22:00',xp:120,
      prep:'The day is not cleared until work is closed, tomorrow is prepared, and bedtime is protected.',
      subtasks:()=>[
        {id:'close-day',title:'Close the day',copy:variants('Save all work, close school and trading apps, close unnecessary tabs, and turn on Do Not Disturb.','End all productive and entertainment activity.'),icon:'close',type:'hold'},
        {id:'prepare-tomorrow',title:'Prepare tomorrow’s essentials',copy:variants('Prepare clothes, bag, documents, chargers, water, and confirm the 5:00 AM alarm.','Remove every avoidable obstacle from tomorrow morning.'),icon:'next',type:'hold'},
        {id:'night-hygiene',title:'Night hygiene and shower',copy:variants('Take a shower, brush teeth, wash face, use the bathroom, and complete necessary personal care.','Complete the full night hygiene routine.'),icon:'shine',type:'hold'},
        {id:'wind-down',title:'Screen-Free Wind-Down Dungeon',copy:variants('Remain screen-free for fifteen minutes. Quiet rest, prayer, breathing, or gentle stretching are allowed.','No browsing, videos, games, trading, or schoolwork.'),icon:'sleep',type:'timer',duration:15},
        {id:'bed',title:'Enter bed and turn off the lights',copy:variants('The day is complete. Enter bed and turn off the lights.','Final directive: bed, lights off, no further phone use.'),icon:'sleep',type:'hold',holdDuration:3000}
      ]
    }
  ];

  const blueprint=id=>protocolBlueprints.find(protocol=>protocol.id===id);
  const dayRecord=()=>state.dayRecords[currentKey()]||null;
  const activeProtocolRecord=()=>{
    const record=dayRecord();
    return record?Object.values(record.protocols).find(protocol=>protocol.status==='active')||null:null;
  };
  const subjectKey=value=>String(value||'').trim().toLowerCase();
  const activeSchedule=()=>state.classSchedule.filter(entry=>entry.active!==false);
  const linkedSubjects=()=>{
    const seen=new Set();
    return activeSchedule().filter(entry=>{
      const key=subjectKey(entry.subject);
      if(!key||seen.has(key))return false;
      seen.add(key);return true;
    }).map(entry=>({key:subjectKey(entry.subject),name:entry.subject,code:entry.code||''})).sort((a,b)=>a.name.localeCompare(b.name));
  };

  const buildWeeklyBossPlan=(date=new Date())=>{
    const key=S.dateKey(date),cutoff=new Date(date);cutoff.setDate(cutoff.getDate()-7);const cutoffKey=S.dateKey(cutoff);
    const recent=Object.values(state.dayRecords||{}).filter(day=>day.date<key&&day.date>=cutoffKey);
    const morningFailures=recent.reduce((sum,day)=>sum+['wake','breakfast'].filter(id=>day.protocols?.[id]?.status==='failed').length,0);
    const breaches=recent.reduce((sum,day)=>sum+Object.values(day.protocols||{}).reduce((count,protocol)=>count+Number(protocol.focusBreaches||0),0),0);
    const pending=state.academicTasks.filter(task=>task.status!=='completed').length;
    const absences=state.attendanceRecords.filter(record=>record.scheduledDate>=cutoffKey&&record.scheduledDate<key&&['absent','unverified'].includes(record.status)).length;
    if(morningFailures>=2)return{id:'dawn-chain',title:'Dawn Chain',copy:'Clear Wake and Breakfast on time, then complete the full day.',requirements:['Wake on time','Breakfast on time','Full day clear']};
    if(absences>=1)return{id:'attendance-lock',title:'Attendance Lock',copy:'Resolve every scheduled class and complete the full day without an absence.',requirements:['No absent class','No unresolved class','Full day clear']};
    if(pending>=2)return{id:'deadline-hunter',title:'Deadline Hunter',copy:'Complete at least one academic task during Productivity and clear the full day.',requirements:['Complete one task','Productivity clear','Full day clear'],baselineCompleted:state.academicTasks.filter(task=>task.status==='completed').length};
    if(breaches>=2)return{id:'focus-unbroken',title:'Focus Unbroken',copy:'Clear every protocol without hiding ASCEND during an active directive.',requirements:['Full day clear','Zero focus breaches']};
    return{id:'perfect-sequence',title:'Perfect Sequence',copy:'Achieve a Perfect Clear across the complete Saturday sequence.',requirements:['All protocols on time','Zero focus breaches','Full day clear']};
  };
  const rankTrialPlanFor=rank=>{
    const plans={
      D:{rank:'D',attendance:0,streak:0,bosses:0,perfect:false,maxBreaches:1,onTime:80},
      C:{rank:'C',attendance:75,streak:2,bosses:0,perfect:true,maxBreaches:0,onTime:90},
      B:{rank:'B',attendance:80,streak:3,bosses:1,perfect:true,maxBreaches:0,onTime:90},
      A:{rank:'A',attendance:90,streak:5,bosses:1,perfect:true,maxBreaches:0,onTime:100},
      S:{rank:'S',attendance:95,streak:7,bosses:2,perfect:true,maxBreaches:0,onTime:100}
    };
    return plans[rank]||null;
  };
  const bossClearCount=()=>Object.values(state.dayRecords||{}).filter(day=>day.weeklyBossCleared).length;
  const evaluateWeeklyBoss=(record,cleared,totalBreaches)=>{
    if(!record.weeklyBoss||!record.weeklyBossPlan)return false;
    const plan=record.weeklyBossPlan;
    if(!cleared)return false;
    if(plan.id==='dawn-chain')return ['wake','breakfast'].every(id=>record.protocols[id]?.status==='cleared'&&protocolOnTime(record,record.protocols[id]));
    if(plan.id==='attendance-lock')return !state.attendanceRecords.some(item=>item.scheduledDate===record.date&&['absent','unverified'].includes(item.status));
    if(plan.id==='deadline-hunter')return state.academicTasks.filter(task=>task.status==='completed').length>Number(plan.baselineCompleted||0)&&record.protocols.productivity?.status==='cleared';
    if(plan.id==='focus-unbroken')return totalBreaches===0;
    return record.onTimePercentage===100&&totalBreaches===0;
  };
  const evaluateRankTrial=(record,totalBreaches)=>{
    const plan=record.rankTrialPlan;if(!plan)return false;
    const academic=overallAcademicStats();
    return record.status==='cleared'&&record.onTimePercentage>=plan.onTime&&totalBreaches<=plan.maxBreaches&&(!plan.perfect||record.perfectClear)&&academic.attendanceRate>=plan.attendance&&state.player.streak>=plan.streak&&bossClearCount()>=plan.bosses;
  };

  const createDayRecord=(date=new Date())=>{
    const key=S.dateKey(date);
    if(state.dayRecords[key])return state.dayRecords[key];
    const protocols={};
    const weeklyBoss=isWeeklyBossDate(date);
    const weeklyBossPlan=weeklyBoss?buildWeeklyBossPlan(date):null;
    const rankTrialPlan=state.player.pendingRank?rankTrialPlanFor(state.player.pendingRank):null;
    protocolBlueprints.forEach(config=>{
      const steps=config.subtasks(state.player.level).map(step=>({...step,status:'pending',startedAt:null,completedAt:null}));
      protocols[config.id]={
        id:config.id,name:config.name,start:config.start,end:config.end,xp:config.xp,
        status:'pending',steps,startedAt:null,completedAt:null,earnedXp:0,focusBreaches:0,hiddenMilliseconds:0,
        boss:weeklyBoss&&config.id==='productivity',resolutionKey:null
      };
    });
    const record={
      date:key,status:'active',createdAt:new Date().toISOString(),protocols,completedProtocols:0,failedProtocols:0,
      wakeCheckInAt:null,wakeStatus:null,totalXp:0,onTimePercentage:0,automaticReward:null,
      weeklyBoss,weeklyBossPlan,weeklyBossCleared:false,perfectClear:false,rankTrialActive:Boolean(rankTrialPlan),rankTrialPlan,rankAdvanced:false,rankTrialFailed:false,
      rewardApplied:false,heldXp:0,integrityStatus:state.integrity?.clockStatus||'trusted'
    };
    state.dayRecords[key]=record;
    save();
    return record;
  };

  const currentStep=protocol=>protocol?.steps.find(step=>step.status==='pending'||step.status==='active')||null;
  const stepCopy=step=>Array.isArray(step.copy)?step.copy[(new Date().getDate()+step.id.length)%step.copy.length]:step.copy;
  const startProtocol=(record,config,now=new Date())=>{
    const protocol=record.protocols[config.id];
    if(protocol.status!=='pending')return protocol;
    if(!transitionProtocol(protocol,'active',{at:now.toISOString()}))return protocol;
    if(state.recovery?.status==='completed'&&state.recovery.protectedDate===record.date&&state.recovery.protectedProtocolId===config.id){
      protocol.recoveryProtected=true;state.recovery.status='consumed';state.recovery.consumedAt=now.toISOString();
      state.logs.push({id:S.uid('log'),at:now.toISOString(),type:'recovery',message:`Recovery protection activated for ${config.name}. Normal completion remains required.`});
      showSystemNotice('recovery','RECOVERY PROTECTION ACTIVE',`${config.name} must be completed normally.`,2600);
    }
    state.logs.push({id:S.uid('log'),at:now.toISOString(),type:'protocol',message:`${config.name} started.`});
    save();systemFeedback(protocol.boss?'boss':'start',protocol.boss?'Weekly Boss issued.':'Directive issued.',`start-${record.date}-${config.id}`);
    return protocol;
  };

  const recordWakeCheckIn=(record,now,source)=>{
    if(record.wakeCheckInAt)return;
    record.wakeCheckInAt=now.toISOString();
    const minute=todayMinutes(now);
    record.wakeStatus=minute<300?'early':minute<=330?'on-time':'late';
    const protocol=startProtocol(record,blueprint('wake'),now);
    const first=protocol.steps[0];transitionStep(first,'completed',now.toISOString());
    state.logs.push({id:S.uid('log'),at:now.toISOString(),type:'wake',message:`Wake recorded at ${formatClock(now)} (${record.wakeStatus}, ${source}).`});
    save();systemFeedback('start',record.wakeStatus==='late'?'Late wake recorded. Begin immediately.':'Wake state confirmed.',`wake-${record.date}`);
  };

  const protocolOnTime=(record,protocol)=>{
    if(protocol.id==='wake')return ['early','on-time'].includes(record.wakeStatus);
    if(!protocol.startedAt)return false;
    return new Date(protocol.startedAt)<=new Date(timeOnDate(new Date(protocol.startedAt),protocol.start).getTime()+10*60000);
  };

  const calculateProtocolXp=(record,protocol)=>{
    const integrity=focusIntegrity(protocol);
    const lateFactor=protocolOnTime(record,protocol)?1:.85;
    return Math.round(protocol.xp*(integrity/100)*lateFactor*(protocol.boss?1.35:1));
  };

  const showOverlay=(eyebrow,title,value,duration=900)=>new Promise(resolve=>{
    clearTimeout(transitionTimer);transitionLocked=true;
    $('#overlayEyebrow').textContent=eyebrow;$('#overlayTitle').textContent=title;$('#overlayValue').textContent=value||'';
    $('#systemOverlay').hidden=false;
    transitionTimer=setTimeout(()=>{$('#systemOverlay').hidden=true;transitionLocked=false;resolve()},duration);
  });

  const clearProtocol=async(record,protocol)=>{
    const completedAt=new Date().toISOString();if(!transitionProtocol(protocol,'cleared',{at:completedAt}))return;protocol.completedAt=completedAt;protocol.resolutionKey=protocol.resolutionKey||`${record.date}:${protocol.id}:cleared`;protocol.earnedXp=calculateProtocolXp(record,protocol);
    record.completedProtocols+=1;
    state.logs.push({id:S.uid('log'),at:protocol.completedAt,type:'clear',message:`${protocol.name} cleared for ${protocol.earnedXp} XP.`});
    save();
    const config=blueprint(protocol.id);
    show('protocolResultScreen');
    $('#protocolResultEmblem').classList.remove('failed');setGlyph('protocolResultEmblem','success');
    $('#protocolResultEyebrow').textContent=protocol.boss?'WEEKLY BOSS DEFEATED':'PROTOCOL CLEARED';
    $('#protocolResultTitle').textContent=`${protocol.name} Complete`;
    $('#protocolResultMessage').textContent='Every required subtask was completed before the deadline.';
    $('#protocolResultTime').textContent=formatClock(new Date(protocol.completedAt));
    $('#protocolResultStatus').textContent=protocolOnTime(record,protocol)?'ON TIME':'LATE CLEAR';
    $('#protocolResultXp').textContent=`+${protocol.earnedXp}`;
    animateResultFeedback('protocolResultEmblem','protocolXpBurst',protocol.earnedXp,Boolean(protocol.boss),false);
    systemFeedback(protocol.boss?'boss':'protocol',protocol.boss?'Weekly Boss defeated.':'Protocol cleared.',`clear-${record.date}-${protocol.id}`);
    transitionLocked=true;
    clearTimeout(transitionTimer);
    transitionTimer=setTimeout(()=>{transitionLocked=false;finalizeDay(record,new Date());renderApp()},1300);
  };

  const failProtocol=(record,protocol,reason,log=true,options={})=>{
    if(!protocol||['cleared','failed'].includes(protocol.status))return false;
    const at=new Date().toISOString();if(!transitionProtocol(protocol,'failed',{at,reason}))return false;
    protocol.completedAt=at;protocol.resolutionKey=protocol.resolutionKey||`${record.date}:${protocol.id}:failed`;protocol.earnedXp=0;protocol.failureReason=reason;
    record.failedProtocols=Object.values(record.protocols).filter(item=>item.status==='failed').length;
    if(log)state.logs.push({id:S.uid('log'),at,type:'failure',message:`${protocol.name} failed: ${reason}`});
    if(!options.defer){save();systemFeedback('warning','Protocol failed.',`failed-${record.date}-${protocol.id}`)}return true;
  };

  const evaluateDeadlines=(record,now=new Date())=>{
    if(!record||record.status!=='active')return;
    let failed=0;
    protocolBlueprints.forEach(config=>{
      const protocol=record.protocols[config.id];
      if(!protocol||['cleared','failed'].includes(protocol.status))return;
      if(now>=recordMoment(record,config.end)&&failProtocol(record,protocol,'The fixed deadline passed before every subtask was completed.',true,{defer:true}))failed+=1;
    });
    if(failed){save();systemFeedback('warning',`${failed} protocol deadline${failed===1?'':'s'} resolved.`,`deadline-reconcile-${record.date}-${failed}`)}
  };

  const calculateOnTimePercentage=record=>{
    let onTime=0;
    protocolBlueprints.forEach(config=>{if(protocolOnTime(record,record.protocols[config.id]))onTime+=1});
    return Math.round(onTime/protocolBlueprints.length*100);
  };

  const chooseReward=record=>{
    if(record.perfectClear)return 'Perfect Clear reward: an extended guilt-free leisure period.';
    if(record.weeklyBossCleared)return 'Weekly Boss reward: one extended recovery or hobby session.';
    return 'Daily Clear reward: a planned leisure period after all obligations are complete.';
  };

  const applyClearedDayRewards=(record,now=new Date())=>{
    if(record.rewardApplied)return false;
    const totalBreaches=Object.values(record.protocols).reduce((sum,protocol)=>sum+Number(protocol.focusBreaches||0),0);
    const xp=Number(record.baseXp??Object.values(record.protocols).reduce((sum,protocol)=>sum+Number(protocol.earnedXp||0),0));
    state.player.totalXp+=xp;state.player.streak+=1;state.player.bestStreak=Math.max(state.player.bestStreak,state.player.streak);
    state.player.totalClearDays+=1;state.player.levelClearDays+=1;state.player.failureScar=false;
    record.totalXp=xp;record.heldXp=0;record.rewardApplied=true;record.rewardReleasedAt=now.toISOString();
    if(record.perfectClear){state.player.perfectClears=(state.player.perfectClears||0)+1;state.player.lastPerfectDate=record.date}
    if(record.rankTrialActive&&!record.rankTrialResolved){
      state.player.rankTrialAttempts=(state.player.rankTrialAttempts||0)+1;
      if(evaluateRankTrial(record,totalBreaches)&&state.player.pendingRank){state.player.rank=state.player.pendingRank;state.player.pendingRank=null;record.rankAdvanced=true}
      else record.rankTrialFailed=true;
      record.rankTrialResolved=true;
    }
    const required=clearDaysRequired(state.player.level);
    if(state.player.level<state.player.maxLevel&&state.player.levelClearDays>=required){
      state.player.level+=1;state.player.levelClearDays=0;record.levelAdvanced=true;
      const target=eligibleRank(state.player.level,state.player.rank);if(target&&!state.player.pendingRank)state.player.pendingRank=target;
      if(state.player.level>=state.player.maxLevel){state.player.level=state.player.maxLevel;state.player.mastered=true;state.player.masteredAt=now.toISOString()}
    }
    record.automaticReward=chooseReward(record);return true;
  };
  const armRecoveryProtocol=record=>{
    if(state.recovery?.active||state.recovery?.sourceDate===record.date)return;
    const nextDate=new Date(`${record.date}T12:00:00`);nextDate.setDate(nextDate.getDate()+1);
    state.recovery={active:true,status:'pending',sourceDate:record.date,reason:null,action:null,protectedDate:S.dateKey(nextDate),protectedProtocolId:'wake',completedAt:null};
    state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'recovery',message:`Recovery Protocol armed after failed day ${record.date}.`});
  };
  const applyFailedDayOutcome=record=>{
    if(record.outcomeApplied)return;
    state.player.streak=0;state.player.totalFailedDays+=1;state.player.failureScar=true;record.outcomeApplied=true;
    if(record.rankTrialActive){record.rankTrialFailed=true;record.rankTrialResolved=true;state.player.rankTrialAttempts=(state.player.rankTrialAttempts||0)+1}
    armRecoveryProtocol(record);
  };
  const releaseHeldRewards=()=>{
    const held=Object.values(state.dayRecords||{}).filter(day=>day.status==='cleared'&&!day.rewardApplied).sort((a,b)=>a.date.localeCompare(b.date));
    held.forEach(day=>applyClearedDayRewards(day,new Date()));
    if(held.length){state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'integrity',message:`Released ${held.length} held day reward(s) after time verification.`});save({silent:true})}
    return held.length;
  };
  const finalizeDay=(record,now=new Date(),force=false)=>{
    if(!record||record.status!=='active')return;
    const resolved=Object.values(record.protocols).every(protocol=>['cleared','failed'].includes(protocol.status));
    const cutoff=recordMoment(record,'22:00');
    if(!force&&!resolved&&now<cutoff)return;
    Object.values(record.protocols).forEach(protocol=>{if(!['cleared','failed'].includes(protocol.status))failProtocol(record,protocol,'The daily cutoff was reached before completion.',false,{defer:true})});
    record.completedProtocols=Object.values(record.protocols).filter(protocol=>protocol.status==='cleared').length;
    record.failedProtocols=Object.values(record.protocols).filter(protocol=>protocol.status==='failed').length;
    const cleared=record.failedProtocols===0&&record.completedProtocols===requiredProtocolCount;
    record.status=cleared?'cleared':'failed';record.finalizedAt=now.toISOString();record.baseXp=Object.values(record.protocols).reduce((sum,protocol)=>sum+Number(protocol.earnedXp||0),0);
    record.onTimePercentage=calculateOnTimePercentage(record);
    const totalBreaches=Object.values(record.protocols).reduce((sum,protocol)=>sum+Number(protocol.focusBreaches||0),0);
    record.perfectClear=cleared&&record.onTimePercentage===100&&totalBreaches===0;
    record.weeklyBossCleared=evaluateWeeklyBoss(record,cleared,totalBreaches);
    if(cleared){
      if(state.integrity?.rewardHold){record.heldXp=record.baseXp;record.totalXp=0;record.integrityStatus='held'}
      else applyClearedDayRewards(record,now);
    }else applyFailedDayOutcome(record);
    state.logs.push({id:S.uid('log'),at:now.toISOString(),type:record.status,message:`Day ${record.status}. ${record.completedProtocols}/${requiredProtocolCount} protocols cleared.${record.perfectClear?' Perfect Clear achieved.':''}${record.weeklyBossCleared?' Weekly Boss defeated.':''}`});
    save();
    if(cleared){
      if(state.integrity?.rewardHold)showSystemNotice('integrity','CLEAR RECORDED · XP HELD','Verify device time to release progression rewards.',3600);
      else if(record.rankAdvanced)systemFeedback('level',`${state.player.rank}-Rank achieved.`);
      else if(record.levelAdvanced)systemFeedback('level',`Level ${state.player.level} reached.`);
      else if(record.weeklyBossCleared)systemFeedback('boss','Weekly Boss defeated.');
      else if(record.perfectClear)systemFeedback('clear','Perfect Clear.');
      else systemFeedback('clear','Daily Clear.');
    }else systemFeedback('warning','Day failed.');
  };

  const finalizePastDays=()=>{
    const today=currentKey();
    Object.values(state.dayRecords).filter(record=>record.date<today&&record.status==='active').sort((a,b)=>a.date.localeCompare(b.date)).forEach(record=>finalizeDay(record,new Date(`${record.date}T22:00:00`),true));
  };

  const findCurrentProtocol=(record,now)=>{
    const minute=todayMinutes(now);
    const wake=record.protocols.wake;
    if(record.wakeCheckInAt&&record.wakeStatus==='early'&&minute>=240&&minute<minutes(wake.end)&&wake.status==='active')return blueprint('wake');
    return protocolBlueprints.find(config=>minute>=minutes(config.start)&&minute<minutes(config.end)&&['pending','active'].includes(record.protocols[config.id].status))||null;
  };
  const findNextProtocol=(record,now)=>{
    const minute=todayMinutes(now);
    return protocolBlueprints.find(config=>minutes(config.start)>minute&&record.protocols[config.id].status==='pending')||null;
  };

  const exceptionsForDate=date=>state.scheduleExceptions.filter(item=>item.active!==false&&item.date===S.dateKey(date));
  const classesForDate=date=>{
    const exceptions=exceptionsForDate(date);
    if(exceptions.some(item=>item.type==='no-classes'))return[];
    let entries=activeSchedule().filter(entry=>Number(entry.day)===date.getDay()).map(entry=>({...entry}));
    exceptions.forEach(exception=>{
      if(exception.type==='cancel')entries=entries.filter(entry=>entry.id!==exception.classId);
      if(['reschedule','special'].includes(exception.type))entries=entries.map(entry=>entry.id===exception.classId?{...entry,start:exception.start||entry.start,end:exception.end||entry.end,exceptionType:exception.type,exceptionNote:exception.note||'',exceptionId:exception.id}:entry);
    });
    return entries.sort((a,b)=>minutes(a.start)-minutes(b.start));
  };
  const meetingKey=(entry,date=new Date())=>`${S.dateKey(date)}::${entry.id}`;
  const attendanceFor=(entry,date=new Date())=>state.attendanceRecords.find(record=>record.meetingKey===meetingKey(entry,date))||null;
  const nextClassAt=(date=new Date())=>classesForDate(date).find(entry=>minutes(entry.start)>todayMinutes(date)&&attendanceFor(entry,date)?.status!=='cancelled')||null;
  const createAttendanceRecord=(entry,date=new Date())=>{
    const existing=attendanceFor(entry,date);if(existing)return existing;
    const record={
      id:S.uid('attendance'),meetingKey:meetingKey(entry,date),classId:entry.id,subjectKey:subjectKey(entry.subject),subjectName:entry.subject,code:entry.code||'',
      scheduledDate:S.dateKey(date),scheduledStart:entry.start,scheduledEnd:entry.end,room:entry.room||'',modality:entry.modality||'Onsite',
      status:'unverified',checkInAt:null,dismissedAt:null,dismissalStatus:null,minutesLate:0,pendingXp:0,xpAwarded:0,finalized:false,
      ongoingUntil:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),corrections:[]
    };
    state.attendanceRecords.push(record);return record;
  };
  const attendanceXpFor=(status,lateMinutes=0)=>{
    if(status==='early')return 30;
    if(status==='present')return 25;
    if(status==='late')return lateMinutes<=20?20:lateMinutes<=30?15:10;
    return 0;
  };
  const scheduledMoment=(record,time)=>new Date(`${record.scheduledDate}T${time}:00`);
  const setAttendanceStatus=(record,status,when=new Date())=>{
    const start=scheduledMoment(record,record.scheduledStart);
    record.status=status;
    if(['early','present','late'].includes(status)){
      record.checkInAt=when.toISOString();
      record.minutesLate=Math.max(0,Math.round((when-start)/60000));
      record.pendingXp=attendanceXpFor(status,record.minutesLate);
      record.finalized=false;record.xpAwarded=0;
    }else{
      record.checkInAt=null;record.minutesLate=0;record.pendingXp=0;record.xpAwarded=0;
      record.finalized=['absent','cancelled'].includes(status);
      if(record.finalized){record.dismissedAt=when.toISOString();record.dismissalStatus=status;}
    }
    record.updatedAt=when.toISOString();
  };
  const finalizeAttendance=(record,dismissalStatus='dismissed',when=new Date())=>{
    if(!record)return;
    if(dismissalStatus==='cancelled')setAttendanceStatus(record,'cancelled',when);
    else if(['early','present','late'].includes(record.status)){
      record.dismissedAt=when.toISOString();record.dismissalStatus=dismissalStatus;record.finalized=true;record.xpAwarded=record.pendingXp||attendanceXpFor(record.status,record.minutesLate);
      record.updatedAt=when.toISOString();record.ongoingUntil=null;
    }
    state.logs.push({id:S.uid('log'),at:when.toISOString(),type:'attendance',message:`${record.subjectName}: ${record.status}${record.finalized?` · ${record.xpAwarded} XP`:''}.`});
    save();
  };
  const syncUnverifiedMeetings=(now=new Date())=>{
    let changed=false;
    classesForDate(now).forEach(entry=>{
      const end=timeOnDate(now,entry.end);
      if(now<end||attendanceFor(entry,now))return;
      const record=createAttendanceRecord(entry,now);record.status='unverified';record.finalized=false;record.updatedAt=now.toISOString();changed=true;
    });
    if(changed)save();
  };
  const unresolvedAttendance=(date=new Date())=>state.attendanceRecords
    .filter(record=>record.scheduledDate===S.dateKey(date)&&!record.finalized)
    .sort((a,b)=>`${a.scheduledDate}T${a.scheduledStart}`.localeCompare(`${b.scheduledDate}T${b.scheduledStart}`))[0]||null;
  const classStateAt=(now=new Date())=>{
    syncUnverifiedMeetings(now);
    const classes=classesForDate(now);
    for(const entry of classes){
      const record=attendanceFor(entry,now),start=timeOnDate(now,entry.start),end=timeOnDate(now,entry.end);
      if(record?.status==='cancelled'||record?.status==='absent'||record?.finalized)continue;
      if(record?.checkInAt){
        const extended=record.ongoingUntil?new Date(record.ongoingUntil):null;
        if(now<end||(extended&&now<extended))return{mode:'active',entry,record,start,end:extended&&extended>end?extended:end};
        return{mode:'dismissal',entry,record,start,end};
      }
      if(now>=start&&now<end)return{mode:'checkin',entry,record,start,end};
      if(now<start&&start-now<=15*60000)return{mode:'approaching',entry,record,start,end};
    }
    const unresolved=unresolvedAttendance(now);
    if(unresolved){
      const entry=state.classSchedule.find(item=>item.id===unresolved.classId)||{id:unresolved.classId,subject:unresolved.subjectName,code:unresolved.code,room:unresolved.room,modality:unresolved.modality,start:unresolved.scheduledStart,end:unresolved.scheduledEnd};
      return{mode:'resolve',entry,record:unresolved,start:scheduledMoment(unresolved,unresolved.scheduledStart),end:scheduledMoment(unresolved,unresolved.scheduledEnd)};
    }
    return null;
  };
  const classEntryFromContext=()=>currentClassContext?.entry||null;
  const classRecordFromContext=()=>currentClassContext?.record||null;
  const checkInClass=async()=>{
    const context=currentClassContext,entry=classEntryFromContext();if(!context||!entry)return;
    const now=new Date(),record=createAttendanceRecord(entry,now),start=timeOnDate(now,entry.start);
    const delta=(now-start)/60000;const status=delta<0?'early':delta<=10?'present':'late';
    setAttendanceStatus(record,status,now);save();systemFeedback('attendance','Attendance confirmed.');
    await showOverlay('ATTENDANCE CONFIRMED',entry.subject,`${status.toUpperCase()} · +${record.pendingXp} XP PENDING`,850);renderApp();
  };
  const handleClassAction=async action=>{
    const context=currentClassContext,entry=classEntryFromContext();if(!context||!entry)return;
    const now=new Date();let record=classRecordFromContext()||createAttendanceRecord(entry,now);
    if(action==='not-yet'){
      state.logs.push({id:S.uid('log'),at:now.toISOString(),type:'attendance',message:`Not there yet: ${entry.subject}.`});save();showBreachWarning('CHECK-IN PENDING',`${entry.subject} remains unverified until you confirm attendance.`);return;
    }
    if(action==='cancelled'){
      finalizeAttendance(record,'cancelled',now);systemFeedback('warning','Class cancelled.');await showOverlay('CLASS CANCELLED',entry.subject,'NO XP · NO PENALTY',800);renderApp();return;
    }
    if(action==='absent'){
      setAttendanceStatus(record,'absent',now);record.finalized=true;record.dismissalStatus='absent';record.dismissedAt=now.toISOString();save();systemFeedback('warning','Absence recorded.');renderApp();return;
    }
    if(action==='ongoing'){
      record.ongoingUntil=new Date(now.getTime()+15*60000).toISOString();record.dismissalStatus='still-ongoing';record.updatedAt=now.toISOString();save();systemFeedback('attendance','Class extension recorded.');renderApp();return;
    }
    if(action==='dismissed'||action==='dismissed-early'){
      finalizeAttendance(record,action==='dismissed-early'?'dismissed-early':'dismissed',now);systemFeedback('dismissal','Class dismissal recorded.');await showOverlay('CLASS COMPLETE',entry.subject,`+${record.xpAwarded} XP`,850);renderApp();return;
    }
    if(action==='resolve-present'||action==='resolve-late'){
      const start=scheduledMoment(record,record.scheduledStart);const check=new Date(start);
      check.setMinutes(check.getMinutes()+(action==='resolve-late'?15:0));
      setAttendanceStatus(record,action==='resolve-late'?'late':'present',check);finalizeAttendance(record,'dismissed',scheduledMoment(record,record.scheduledEnd));
      systemFeedback('attendance','Attendance record resolved.');renderApp();
    }
  };
  const renderClassScreen=(context,now=new Date())=>{
    requestWakeLock();show('classScreen');document.body.dataset.state=context.mode==='dismissal'||context.mode==='resolve'?'warning':'active';currentClassContext=context;
    const {entry,record,start,end,mode}=context;
    $('#classCode').textContent=entry.code||'CLASS';$('#classTitle').textContent=entry.subject;
    $('#classWindow').textContent=`${formatTime(entry.start)} – ${formatTime(entry.end)}`;
    const location=[entry.modality||record?.modality,entry.room||record?.room].filter(Boolean).join(' · ');$('#classLocation').textContent=location||'Location not set';
    $('#classCheckinActions').hidden=!['approaching','checkin'].includes(mode);$('#classActiveActions').hidden=!['active','dismissal'].includes(mode);$('#classResolveActions').hidden=mode!=='resolve';
    const dismissedButton=$('#classActiveActions [data-class-action="dismissed"]');const earlyButton=$('#classActiveActions [data-class-action="dismissed-early"]');
    if(dismissedButton)dismissedButton.hidden=mode!=='dismissal';if(earlyButton)earlyButton.hidden=mode!=='active';
    if(mode==='approaching'){
      $('#classEyebrow').textContent='CLASS APPROACHING';$('#classStatusChip').textContent='CHECK-IN';$('#classQuestion').textContent='Are you already in class?';$('#classCountdown').textContent=formatDuration(start-now);$('#classFootnote').textContent='Early confirmation earns the highest attendance XP.';
    }else if(mode==='checkin'){
      $('#classEyebrow').textContent='ATTENDANCE CHECK';$('#classStatusChip').textContent='UNVERIFIED';$('#classQuestion').textContent='Confirm your attendance now.';$('#classCountdown').textContent=formatDuration(end-now);$('#classFootnote').textContent='Attendance remains unverified until you respond.';
    }else if(mode==='active'){
      $('#classEyebrow').textContent='CLASS IN SESSION';$('#classStatusChip').textContent=(record?.status||'present').toUpperCase();$('#classQuestion').textContent='Class attendance is active.';$('#classCountdown').textContent=formatDuration(end-now);$('#classFootnote').textContent=`${record?.pendingXp||0} XP is pending until dismissal is recorded.`;
    }else if(mode==='dismissal'){
      $('#classEyebrow').textContent='CLASS STATUS';$('#classStatusChip').textContent='END CHECK';$('#classQuestion').textContent='Has the class been dismissed?';$('#classCountdown').textContent='00:00:00';$('#classFootnote').textContent='Confirm dismissal to finalize attendance XP.';
    }else{
      $('#classEyebrow').textContent='ATTENDANCE RESOLUTION';$('#classStatusChip').textContent='UNVERIFIED';$('#classQuestion').textContent='What happened during this class?';$('#classCountdown').textContent='00:00:00';$('#classFootnote').textContent='Resolve the record before its XP and statistics can be finalized.';
    }
  };

  const updateClock=()=>{
    const now=new Date();
    $('#clockTime').textContent=new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(now);
    $('#clockDate').textContent=formatDate(now);
  };

  const updateCheckInAndEvaluation=()=>{
    if(!state.initialized)return null;
    checkClockIntegrity();finalizePastDays();
    if(state.integrity?.clockStatus==='trusted'&&Object.values(state.dayRecords||{}).some(day=>day.status==='cleared'&&!day.rewardApplied))releaseHeldRewards();
    const now=new Date();
    const record=createDayRecord(now);
    const minute=todayMinutes(now);
    if(!record.wakeCheckInAt&&minute>=300&&minute<360&&document.visibilityState==='visible')recordWakeCheckIn(record,now,'automatic-window');
    evaluateDeadlines(record,now);
    if(now>=recordMoment(record,'22:00'))finalizeDay(record,now);
    sweepNotifications(record,now);checkStoragePressure();
    return record;
  };

  const formatDuration=milliseconds=>{
    const seconds=Math.max(0,Math.floor(milliseconds/1000));
    const h=Math.floor(seconds/3600),m=Math.floor((seconds%3600)/60),s=seconds%60;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  };

  const tone=(kind='clear')=>{
    if(!state.settings.sound)return;
    try{
      const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
      const context=new Audio(),oscillator=context.createOscillator(),gain=context.createGain();
      const frequency={clear:620,protocol:760,warning:155,level:880,start:360,emergency:110,boss:520,attendance:700,dismissal:560}[kind]||440;
      oscillator.type=['warning','emergency','boss'].includes(kind)?'sawtooth':'sine';oscillator.frequency.value=frequency;
      gain.gain.setValueAtTime(.0001,context.currentTime);gain.gain.exponentialRampToValueAtTime(.065,context.currentTime+.02);gain.gain.exponentialRampToValueAtTime(.0001,context.currentTime+.34);
      oscillator.connect(gain);gain.connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+.36);
    }catch(error){}
  };
  const haptic=kind=>{
    if(!state.settings.haptics||!navigator.vibrate)return;
    const pattern={
      tap:[45],
      clear:[120,45,180],
      protocol:[95,40,135],
      start:[80,35,120],
      warning:[220,70,240],
      level:[130,55,180,55,280],
      boss:[150,60,150,60,260],
      attendance:[130,50,190],
      dismissal:[100,40,100,40,190],
      emergency:[320,90,320],
      hold:[18],
      'hold-mid':[28],
      'hold-final':[38]
    }[kind]||[60];
    navigator.vibrate(pattern);
  };
  const flashBrand=kind=>{
    const brand=$('#systemBrand');if(!brand)return;
    clearTimeout(brandFlashTimer);
    brand.dataset.event=kind;brand.classList.remove('brand-event');void brand.offsetWidth;brand.classList.add('brand-event');
    brandFlashTimer=setTimeout(()=>{brand.classList.remove('brand-event');delete brand.dataset.event},720);
  };
  const systemFeedback=(kind,text,key=`${kind}-${Date.now()}`)=>{
    void text;void key;tone(kind);haptic(kind);
    if(['clear','protocol','level','boss','emergency'].includes(kind))flashBrand(kind);
  };
  const animateResultFeedback=(emblemId,burstId,xp=0,milestone=false,failed=false)=>{
    const emblem=document.getElementById(emblemId),burst=document.getElementById(burstId);if(!emblem)return;
    emblem.classList.remove('result-flash','milestone-flash','failure-flash');void emblem.offsetWidth;
    emblem.classList.add(failed?'failure-flash':milestone?'milestone-flash':'result-flash');
    if(!burst)return;
    burst.hidden=!xp;burst.textContent=xp?`+${xp} XP`:'';burst.classList.remove('play','milestone');
    if(xp){void burst.offsetWidth;burst.classList.toggle('milestone',milestone);burst.classList.add('play')}
  };
  const syncAmbientState=(record,protocol=null)=>{
    document.body.classList.toggle('failure-scar',Boolean(state.player.failureScar));
    document.body.classList.toggle('rank-trial',Boolean(record?.rankTrialActive||state.player.pendingRank));
    document.body.classList.toggle('weekly-boss',Boolean(protocol?.boss));
    document.body.dataset.rank=state.player.rank||'E';
    document.body.style.setProperty('--aura-strength',String(clamp(.26+state.player.level*.006+state.player.streak*.012,.28,.9)));
  };
  const requestWakeLock=async()=>{
    if(!state.settings.keepAwake||!('wakeLock' in navigator)||document.hidden||wakeLock||orientationBlocked)return;
    try{wakeLock=await navigator.wakeLock.request('screen');wakeLock.addEventListener('release',()=>{wakeLock=null;if(activeProtocolRecord()&&!document.hidden&&state.settings.keepAwake)setTimeout(requestWakeLock,250)},{once:true})}catch(error){wakeLock=null}
  };
  const releaseWakeLock=()=>{try{wakeLock?.release()}catch(error){}wakeLock=null};
  const sendLocalNotification=async(tag,title,body)=>{
    if(!state.settings.notifications||!('Notification' in window)||Notification.permission!=='granted')return;
    state.system.notificationLedger=state.system.notificationLedger||{};
    if(state.system.notificationLedger[tag]||safeSession.get(`notify:${tag}`))return;
    safeSession.set(`notify:${tag}`,'1');state.system.notificationLedger[tag]=new Date().toISOString();
    const ledgerEntries=Object.entries(state.system.notificationLedger).sort((a,b)=>String(b[1]).localeCompare(String(a[1]))).slice(0,100);state.system.notificationLedger=Object.fromEntries(ledgerEntries);S.save(state);
    try{const registration=await navigator.serviceWorker?.ready;if(registration?.showNotification)await registration.showNotification(title,{body,tag,icon:'assets/icon-192.png?v=20260803',badge:'assets/icon-192.png?v=20260803',silent:true,renotify:false});else new Notification(title,{body,tag,icon:'assets/icon-192.png?v=20260803',silent:true})}catch(error){}
  };
  const sweepNotifications=(record,now=new Date())=>{
    if(!state.settings.notifications||Date.now()-notificationSweepAt<20000)return;notificationSweepAt=Date.now();
    const lead=Number(state.settings.notificationLeadMinutes||10)*60000;
    protocolBlueprints.forEach(config=>{
      const protocol=record?.protocols?.[config.id];if(!protocol||protocol.status!=='pending')return;
      const start=recordMoment(record,config.start),delta=start-now;
      if(delta>0&&delta<=lead)sendLocalNotification(`${record.date}:${config.id}:start`,`${config.name} starts soon`,`${Math.max(1,Math.ceil(delta/60000))} minute(s) remaining before the fixed start.`);
    });
    const active=activeProtocolRecord();if(active){const deadline=recordMoment(record,active.end),delta=deadline-now;if(delta>0&&delta<=5*60000)sendLocalNotification(`${record.date}:${active.id}:deadline`,`${active.name} deadline approaching`,'Five minutes or less remain. Complete every required stage.')}
    classesForDate(now).forEach(entry=>{
      const attendance=attendanceFor(entry,now),start=timeOnDate(now,entry.start),end=timeOnDate(now,entry.end),untilStart=start-now,untilEnd=end-now;
      if(untilStart>0&&untilStart<=15*60000)sendLocalNotification(`${S.dateKey(now)}:${entry.id}:class-open`,`${entry.subject} check-in opening`,`Class begins at ${formatTime(entry.start)}.`);
      if(attendance?.checkInAt&&untilEnd>0&&untilEnd<=5*60000)sendLocalNotification(`${S.dateKey(now)}:${entry.id}:dismissal`,`${entry.subject} ending soon`,'Prepare to confirm class dismissal and finalize attendance XP.');
      if(now>=end&&(!attendance||attendance.status==='unverified')&&now-end<=60*60000)sendLocalNotification(`${S.dateKey(now)}:${entry.id}:missed-checkin`,`${entry.subject} attendance unresolved`,'Open ASCEND and resolve the missed attendance confirmation.');
    });
    if(record?.weeklyBoss&&record.weeklyBossPlan){const boss=record.protocols?.productivity,start=recordMoment(record,'20:00'),delta=start-now;if(boss?.status==='pending'&&delta>0&&delta<=lead)sendLocalNotification(`${record.date}:weekly-boss`, `Weekly Boss: ${record.weeklyBossPlan.title}`,record.weeklyBossPlan.copy)}
    Object.values(record?.protocols||{}).filter(protocol=>protocol.status==='failed'&&protocol.completedAt&&now-new Date(protocol.completedAt)<=60*60000).forEach(protocol=>sendLocalNotification(`${record.date}:${protocol.id}:failed`,`${protocol.name} failed`,protocol.failureReason||'The fixed deadline passed.'));
  };
  const storageReport=async()=>{
    const localBytes=S.storageBytes(state);let usage=localBytes,quota=5*1024*1024;
    try{const estimate=await navigator.storage?.estimate?.();if(estimate){usage=Math.max(usage,Number(estimate.usage||0));quota=Number(estimate.quota||quota)}}catch(error){}
    return{usage,quota,ratio:quota?usage/quota:0,localBytes};
  };
  const checkStoragePressure=async(force=false)=>{
    if(!force&&Date.now()-storageCheckAt<60000)return;storageCheckAt=Date.now();const report=await storageReport();
    if(report.ratio>=.8||report.localBytes>=4*1024*1024){const today=S.dateKey();if(state.system.lastStorageWarningAt!==today){state.system.lastStorageWarningAt=today;state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'integrity',message:'Local storage pressure warning issued.'});save({silent:true});showSystemNotice('integrity','STORAGE CAPACITY WARNING','Export a backup. Routine logs are being limited automatically.',4200)}}
    return report;
  };
  const syncRecoveryOverlay=()=>{
    const overlay=$('#recoveryOverlay');if(!overlay)return;
    const canShow=Boolean(state.recovery?.active)&&!activeProtocolRecord()&&!classStateAt(new Date())&&$('#scheduleOverlay').hidden&&$('#emergencyOverlay').hidden;
    overlay.hidden=!canShow;
    if(canShow){const config=blueprint(state.recovery.protectedProtocolId)||blueprint('wake');$('#recoveryProtectedProtocol').textContent=config.name;releaseWakeLock()}
  };
  const completeRecoveryProtocol=()=>{
    if(!state.recovery?.active)return;
    state.recovery.reason=$('#recoveryReason').value;state.recovery.action=$('#recoveryAction').value;state.recovery.status='completed';state.recovery.active=false;state.recovery.completedAt=new Date().toISOString();state.player.failureScar=false;
    state.logs.push({id:S.uid('log'),at:state.recovery.completedAt,type:'recovery',message:`Recovery completed after ${state.recovery.sourceDate}: ${state.recovery.reason} · ${state.recovery.action}. Next ${state.recovery.protectedProtocolId} protected.`});
    save();$('#recoveryOverlay').hidden=true;showSystemNotice('recovery','RECOVERY ARMED','The next protocol must still be completed normally.',3000);renderApp();
  };

  const applyBodyState=(record,protocol,task,deadlineMs)=>{
    syncAmbientState(record,protocol);
    const minutesLeft=deadlineMs/60000;
    let stateName=task?.type==='timer'||task?.type==='academic'||task?.type==='trading'?'timed':'active';
    if(minutesLeft<=5)stateName='critical';else if(minutesLeft<=10)stateName='warning';
    document.body.dataset.state=stateName;
  };

  const renderSetup=()=>{releaseWakeLock();show('setupScreen');document.body.dataset.state='standby'};

  const renderEarlyWake=()=>{
    releaseWakeLock();show('earlyWakeScreen');document.body.dataset.state='active';currentClassContext=null;
    $('#earlyWakeFill').style.width='0%';
  };

  const renderSleep=(now=new Date(),earlyDismissed=false)=>{
    releaseWakeLock();show('sleepScreen');document.body.dataset.state='standby';currentClassContext=null;
    const nextWake=nextWakeMoment(now);
    const sameDay=S.dateKey(nextWake)===S.dateKey(now);
    $('#sleepCountdown').textContent=formatDuration(nextWake-now);
    $('#sleepNextTime').textContent=`${sameDay?'Today':'Tomorrow'} at 5:00 AM`;
    if(earlyDismissed){
      $('#sleepMessage').textContent='Early Wake Sign-In remains available until 5:00 AM. Reopen ASCEND when you are fully awake.';
    }else if(isSleepWindow(now)){
      $('#sleepMessage').textContent='Early Wake Sign-In unlocks at 4:00 AM. Protect the recovery window.';
    }else{
      $('#sleepMessage').textContent='No directive is active. The Wake Protocol begins at 5:00 AM.';
    }
  };

  const renderFree=(record,now)=>{
    releaseWakeLock();show('freeScreen');document.body.dataset.state='standby';currentClassContext=null;
    $('#freeLevel').textContent=state.player.level;$('#freeRank').textContent=state.player.rank;$('#freeStreak').textContent=state.player.streak;
    const required=clearDaysRequired(state.player.level);
    $('#freeProgressText').textContent=state.player.mastered?'Mastery confirmed':`${state.player.levelClearDays} / ${required} clear days · ${record.completedProtocols}/${requiredProtocolCount} today`;
    $('#disciplineState').textContent=state.player.pendingRank?`RANK-UP TRIAL · ${state.player.pendingRank}`:stageName(state.player.level);

    const nextClass=nextClassAt(now);
    const nextProtocol=findNextProtocol(record,now);
    let event=null;
    if(nextClass){event={type:'class',time:timeOnDate(now,nextClass.start),data:nextClass}}
    if(nextProtocol){const time=timeOnDate(now,nextProtocol.start);if(!event||time<event.time)event={type:'protocol',time,data:nextProtocol}}
    if(!event){
      $('#freeEyebrow').textContent='SYSTEM STANDBY';$('#freeKicker').textContent='NEXT WAKE DIRECTIVE';$('#freeTitle').textContent='Wake Protocol';
      const tomorrow=new Date(now);tomorrow.setDate(tomorrow.getDate()+1);tomorrow.setHours(5,0,0,0);
      $('#freeNextTime').textContent='Tomorrow at 5:00 AM';$('#freeCountdown').textContent=formatDuration(tomorrow-now);$('#freePrep').textContent='Protect the sleep window. The System begins again at 5:00 AM.';return;
    }
    if(event.type==='class'){
      $('#freeEyebrow').textContent='DAYTIME FREE WINDOW';$('#freeKicker').textContent='NEXT CLASS';$('#freeTitle').textContent=event.data.subject;
      $('#freeNextTime').textContent=`Starts at ${formatTime(event.data.start)}`;$('#freeCountdown').textContent=formatDuration(event.time-now);
      const location=[event.data.modality,event.data.room].filter(Boolean).join(' · ');$('#freePrep').textContent=location?`Prepare for ${location}.`:'Prepare the required materials before class.';
    }else{
      const config=event.data,bossNext=config.id==='productivity'&&record.weeklyBoss;
      $('#freeEyebrow').textContent='FREE WINDOW';$('#freeKicker').textContent=bossNext?`WEEKLY BOSS · ${record.weeklyBossPlan?.title||'CHALLENGE'}`:'NEXT DIRECTIVE';
      $('#freeTitle').textContent=config.name;$('#freeNextTime').textContent=`Starts at ${formatTime(config.start)}`;$('#freeCountdown').textContent=formatDuration(event.time-now);$('#freePrep').textContent=bossNext?record.weeklyBossPlan?.copy||config.prep:config.prep;
    }
  };

  const renderStandardTask=(record,protocol,task)=>{
    $('#customTaskArea').hidden=true;$('#customTaskArea').innerHTML='';$('#actionButton').hidden=false;$('#subtaskTimer').hidden=true;
    const mode=task.type;
    $('#actionButton').dataset.mode=mode;$('#holdFill').style.width='0%';$('#actionButton').disabled=false;
    if(mode==='system'){$('#actionLabel').textContent='System Confirmed';$('#actionButton').disabled=true}
    else if(mode==='hold'){$('#actionLabel').textContent='Hold to Confirm'}
    else if(mode==='tap'){$('#actionLabel').textContent='Confirm Complete'}
    else if(mode==='timer'){
      $('#subtaskTimer').hidden=false;
      if(task.status==='pending'){$('#timerValue').textContent=`${task.duration}:00`;$('#timerCaption').textContent='REQUIRED TIME';$('#actionLabel').textContent='Start Dungeon'}
      else{
        const elapsed=Date.now()-new Date(task.startedAt).getTime();const remaining=task.duration*60000-elapsed;
        $('#timerValue').textContent=formatDuration(Math.max(0,remaining)).slice(3);$('#timerCaption').textContent=remaining>0?'DUNGEON ACTIVE':'TIME REQUIREMENT CLEARED';
        if(remaining>0){$('#actionLabel').textContent='Dungeon in Progress';$('#actionButton').disabled=true}else $('#actionLabel').textContent='Confirm Dungeon Clear';
      }
    }
  };

  const currentAuditSubject=(step)=>{
    const subjects=linkedSubjects();
    step.auditState=step.auditState||{index:0};
    if(step.auditState.index>=subjects.length)return null;
    return subjects[step.auditState.index];
  };

  const pendingTasks=()=>state.academicTasks.filter(task=>task.status!=='completed').sort((a,b)=>{
    const ad=a.deadline?new Date(`${a.deadline}T23:59:59`).getTime():Infinity;
    const bd=b.deadline?new Date(`${b.deadline}T23:59:59`).getTime():Infinity;
    return ad-bd||String(a.subjectName).localeCompare(String(b.subjectName));
  });

  const renderAudit=(protocol,step)=>{
    $('#actionButton').hidden=true;$('#subtaskTimer').hidden=true;$('#customTaskArea').hidden=false;
    const subjects=linkedSubjects();
    if(!subjects.length){
      $('#customTaskArea').innerHTML=`<div class="custom-message"><strong>NO SUBJECTS LINKED</strong><p>Use the hidden Class Schedule setup during a Free Window. Continue with Academic Maintenance tonight.</p><button type="button" data-custom="finish-audit">Continue</button></div>`;
      return;
    }
    const subject=currentAuditSubject(step);
    if(!subject){
      $('#customTaskArea').innerHTML=`<div class="custom-message"><strong>AUDIT COMPLETE</strong><p>${pendingTasks().length} pending task(s) are available for execution.</p><button type="button" data-custom="finish-audit">Complete Audit</button></div>`;
      return;
    }
    const subjectTasks=state.academicTasks.filter(task=>task.status!=='completed'&&task.subjectKey===subject.key).sort((a,b)=>String(a.deadline||'9999').localeCompare(String(b.deadline||'9999')));
    const subjectPending=subjectTasks.length;
    const shownTask=subjectTasks[0];
    $('#customTaskArea').innerHTML=`
      <div class="audit-head"><span>${step.auditState.index+1} / ${subjects.length}</span><strong>${escapeHtml(subject.name)}</strong><small>${subjectPending} pending</small></div>
      ${shownTask?`<div class="existing-task"><span>NEXT PENDING</span><strong>${escapeHtml(shownTask.title)}</strong><small>${shownTask.deadline||'No deadline'}</small><button type="button" data-custom="complete-existing" data-task-id="${shownTask.id}">Mark Completed</button></div>`:''}
      <div class="compact-form audit-form">
        <label>Task<input id="auditTaskTitle" type="text" maxlength="80" placeholder="Required output"></label>
        <label>Deadline<span class="time-shell"><input id="auditTaskDeadline" type="date"></span></label>
        <label>Difficulty<select id="auditTaskDifficulty"><option value="Easy">Easy</option><option value="Moderate" selected>Moderate</option><option value="Difficult">Difficult</option></select></label>
        <label>Note<input id="auditTaskNote" type="text" maxlength="70" placeholder="Optional"></label>
      </div>
      <div class="custom-actions two"><button type="button" data-custom="save-task">Save Task</button><button type="button" data-custom="next-subject">${step.auditState.index===subjects.length-1?'Finish Subject':'Next Subject'}</button></div>`;
  };

  const recommendedTask=()=>pendingTasks()[0]||null;
  const renderPlanner=(protocol,step)=>{
    $('#actionButton').hidden=true;$('#subtaskTimer').hidden=true;$('#customTaskArea').hidden=false;
    const tasks=pendingTasks();
    step.planState=step.planState||{phase:'mode',mode:null,index:0,selectedIds:[]};
    const plan=step.planState;
    if(plan.phase==='mode'){
      const recommended=recommendedTask();
      $('#customTaskArea').innerHTML=`
        <div class="recommendation"><span>SYSTEM RECOMMENDATION</span><strong>${recommended?escapeHtml(recommended.title):'Academic Maintenance'}</strong><small>${recommended?`${escapeHtml(recommended.subjectName)} · ${recommended.deadline||'No deadline'}`:'No pending academic tasks were found.'}</small></div>
        <div class="mode-grid"><button type="button" data-custom="plan-single" ${tasks.length?'':'disabled'}>Single Priority</button><button type="button" data-custom="plan-multi" ${tasks.length>1?'':'disabled'}>Multiple Subjects</button><button type="button" data-custom="plan-maintenance" ${tasks.length?'disabled':''}>No Pending Tasks</button></div>`;
      return;
    }
    const task=tasks[clamp(plan.index,0,Math.max(0,tasks.length-1))];
    if(!task){plan.phase='mode';renderPlanner(protocol,step);return}
    const selected=plan.selectedIds.includes(task.id);
    $('#customTaskArea').innerHTML=`
      <div class="task-picker"><span>${plan.index+1} / ${tasks.length}</span><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.subjectName)} · ${task.deadline||'No deadline'} · ${task.difficulty}</small></div>
      <div class="picker-nav"><button type="button" data-custom="task-prev" aria-label="Previous task">${glyphMarkup('chevron-left')}</button><button class="${selected?'selected':''}" type="button" data-custom="task-toggle">${plan.mode==='single'?'Select This Task':selected?'Selected':'Add to Sprint'}</button><button type="button" data-custom="task-next" aria-label="Next task">${glyphMarkup('chevron-right')}</button></div>
      <button class="confirm-plan" type="button" data-custom="confirm-plan" ${plan.selectedIds.length?'':'disabled'}>Confirm ${plan.mode==='single'?'Priority':`${plan.selectedIds.length} Task Sprint`}</button>`;
  };

  const academicRemaining=step=>{
    if(!step.startedAt)return step.duration*60000;
    return Math.max(0,step.duration*60000-(Date.now()-new Date(step.startedAt).getTime()));
  };
  const renderAcademic=(protocol,step)=>{
    $('#actionButton').hidden=true;$('#subtaskTimer').hidden=true;$('#customTaskArea').hidden=false;
    const task=step.taskId?state.academicTasks.find(item=>item.id===step.taskId):null;
    const title=task?task.title:'Academic Maintenance';
    const meta=task?`${task.subjectName} · ${task.deadline||'No deadline'}`:'Review notes, read ahead, organize files, or prepare for the next class.';
    if(step.status==='pending'){
      $('#customTaskArea').innerHTML=`<div class="academic-card"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta)}</small><b>${step.duration} MINUTES</b></div><button class="custom-primary" type="button" data-custom="start-academic">Start Focus Block</button>`;return;
    }
    const remaining=academicRemaining(step);
    if(remaining>0){
      $('#customTaskArea').innerHTML=`<div class="academic-card active"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta)}</small><b>${formatDuration(remaining).slice(3)}</b><em>FOCUS INTEGRITY · ${focusIntegrity(protocol)}%</em></div>`;return;
    }
    if(!task){
      $('#customTaskArea').innerHTML=`<div class="academic-card"><strong>MAINTENANCE COMPLETE</strong><small>Required time fulfilled.</small></div><button class="custom-primary" type="button" data-custom="finish-maintenance">Confirm Completion</button>`;return;
    }
    $('#customTaskArea').innerHTML=`<div class="academic-card"><strong>${escapeHtml(title)}</strong><small>Required focus time completed. Record the actual result.</small></div><div class="custom-actions two"><button type="button" data-custom="task-completed">Task Completed</button><button type="button" data-custom="task-progress">Keep In Progress</button></div>`;
  };

  const tradingRemaining=step=>{
    if(!step.startedAt)return step.duration*60000;
    return Math.max(0,step.duration*60000-(Date.now()-new Date(step.startedAt).getTime()));
  };
  const renderTrading=(protocol,step)=>{
    $('#actionButton').hidden=true;$('#subtaskTimer').hidden=true;$('#customTaskArea').hidden=false;
    if(step.status==='pending'){
      $('#customTaskArea').innerHTML=`<div class="custom-message"><strong>DISCIPLINE BEFORE ACTION</strong><p>Review positions or watchlists, check risk limits, and do not force a trade.</p><button type="button" data-custom="start-trading">Start ${step.duration}-Minute Review</button></div>`;return;
    }
    const remaining=tradingRemaining(step);
    if(remaining>0){
      $('#customTaskArea').innerHTML=`<div class="academic-card active"><strong>MARKET REVIEW ACTIVE</strong><small>A no-trade decision is valid when no setup meets your rules.</small><b>${formatDuration(remaining).slice(3)}</b><em>FOCUS INTEGRITY · ${focusIntegrity(protocol)}%</em></div>`;return;
    }
    $('#customTaskArea').innerHTML=`
      <div class="compact-form trading-form">
        <label>Observation<input id="tradingObservation" type="text" maxlength="110" placeholder="One market observation"></label>
        <label>Decision<select id="tradingDecision"><option value="No trade — no valid setup">No trade — no valid setup</option><option value="Trade logged within plan">Trade logged within plan</option><option value="Position reviewed — no action">Position reviewed — no action</option></select></label>
      </div>
      <button class="custom-primary" type="button" data-custom="save-trading">Save Trading Review</button>`;
  };

  const renderProtocol=(record,config)=>{
    requestWakeLock();show('protocolScreen');
    const protocol=startProtocol(record,config,new Date());
    const task=currentStep(protocol);
    if(!task){clearProtocol(record,protocol);return}
    const deadline=timeOnDate(new Date(),config.end);const deadlineMs=deadline-new Date();applyBodyState(record,protocol,task,deadlineMs);
    $('#protocolLabel').textContent=protocol.boss?`WEEKLY BOSS · ${record.weeklyBossPlan?.title||'PRODUCTIVITY'}`:config.name.toUpperCase();
    $('#protocolWindow').textContent=`${formatTime(config.start)} – ${formatTime(config.end)}`;
    const index=protocol.steps.indexOf(task);$('#stepCurrent').textContent=index+1;$('#stepTotal').textContent=protocol.steps.length;
    const punctual=protocolOnTime(record,protocol);$('#punctualityBadge').textContent=task.type==='timer'||task.type==='academic'||task.type==='trading'?`FOCUS ${focusIntegrity(protocol)}%`:punctual?'ON TIME':'LATE';$('#punctualityBadge').classList.toggle('late',!punctual);
    $('#deadlineCountdown').textContent=`${formatDuration(deadlineMs)} LEFT`;
    $('#focusSigil').hidden=['audit','planner','academic','trading'].includes(task.type);
    setGlyph('focusIcon',task.icon||config.icon);$('#subtaskType').textContent=protocol.boss&&['execution-plan'].includes(task.id)?'WEEKLY BOSS DIRECTIVE':'CURRENT DIRECTIVE';
    $('#subtaskTitle').textContent=task.title;$('#subtaskCopy').textContent=stepCopy(task);
    $('#completedSteps').textContent=`${protocol.steps.filter(step=>step.status==='completed').length} / ${protocol.steps.length} completed`;
    $('#protocolXp').textContent=`${Math.round(config.xp*(protocol.boss?1.35:1))} XP available`;
    $('#focusNote').textContent=protocol.boss?(record.weeklyBossPlan?.copy||'Complete the adaptive Weekly Boss objective.'):'Complete every required stage before the fixed deadline.';
    if(task.type==='audit')renderAudit(protocol,task);
    else if(task.type==='planner')renderPlanner(protocol,task);
    else if(task.type==='academic')renderAcademic(protocol,task);
    else if(task.type==='trading')renderTrading(protocol,task);
    else renderStandardTask(record,protocol,task);
  };

  const renderResult=record=>{
    releaseWakeLock();show('resultScreen');document.body.dataset.state=record.status==='cleared'?'active':'critical';
    const cleared=record.status==='cleared';$('#resultEmblem').classList.toggle('failed',!cleared);setGlyph('resultEmblem',cleared?'success':'failure');
    $('#resultEyebrow').textContent=cleared?(record.heldXp?'CLEAR RECORDED · REWARD HOLD':record.rankAdvanced?'RANK ADVANCED':record.perfectClear?'PERFECT CLEAR':record.weeklyBossCleared?'WEEKLY BOSS DEFEATED':'DAY CLEARED'):'DAY FAILED';
    $('#resultTitle').textContent=cleared?'Discipline Maintained':'Discipline Broken';
    $('#resultMessage').textContent=cleared?(record.heldXp?'Clear recorded. Progression rewards are held until device time is verified.':'Every required protocol was completed before the daily cutoff.'):'At least one required protocol failed. Daily XP and the streak were lost.';
    $('#resultProtocols').textContent=`${record.completedProtocols}/${requiredProtocolCount}`;$('#resultOnTime').textContent=`${record.onTimePercentage}%`;$('#resultXp').textContent=record.heldXp?`${record.heldXp} HELD`:record.totalXp;$('#resultLevel').textContent=`${state.player.level} · ${state.player.rank}`;
    const sealText=record.heldXp?'TIME VERIFICATION REQUIRED':record.rankAdvanced?`${state.player.rank}-RANK ACHIEVED`:record.perfectClear?'PERFECT CLEAR':record.rankTrialFailed?'RANK-UP TRIAL FAILED':record.weeklyBossCleared?'WEEKLY BOSS DEFEATED':'';
    $('#resultSeal').hidden=!sealText;$('#resultSeal').textContent=sealText;$('#resultSeal').classList.toggle('failed',record.rankTrialFailed);
    $('#autoReward').hidden=!cleared||Boolean(record.heldXp);$('#rewardText').textContent=record.automaticReward||'';$('#masteryMessage').hidden=!state.player.mastered;
    $('#tomorrowNote').textContent='Tomorrow begins again at 5:00 AM.';
    const animationKey=`${record.date}-${record.status}-${record.totalXp}-${record.rankAdvanced?'rank':''}-${record.levelAdvanced?'level':''}`;
    if(lastResultAnimationKey!==animationKey){
      lastResultAnimationKey=animationKey;
      animateResultFeedback('resultEmblem','dayXpBurst',cleared?record.totalXp:0,Boolean(record.rankAdvanced||record.levelAdvanced||record.perfectClear||record.weeklyBossCleared),!cleared);
    }
  };

  const renderApp=()=>{
    updateClock();
    const record=updateCheckInAndEvaluation();
    syncAmbientState(record,activeProtocolRecord());
    if(!state.initialized){renderSetup();return}
    syncRecoveryOverlay();
    if(transitionLocked)return;
    const now=new Date();
    if(isSleepWindow(now)){renderSleep(now);return}
    if(record.status!=='active'){renderResult(record);return}
    if(!record.wakeCheckInAt&&isEarlyWakeWindow(now)){
      if(earlyWakeDismissedSession)renderSleep(now,true);else renderEarlyWake();
      return;
    }
    const config=findCurrentProtocol(record,now);
    if(config){renderProtocol(record,config);return}
    const classState=classStateAt(now);
    if(classState){renderClassScreen(classState,now);return}
    renderFree(record,now);
  };

  const completeSubtask=async()=>{
    const record=dayRecord(),protocol=activeProtocolRecord();if(!record||!protocol)return;
    const task=currentStep(protocol);if(!task)return;
    if(task.type==='timer'&&task.status==='active'&&Date.now()-new Date(task.startedAt).getTime()<task.duration*60000)return;
    if(!transitionStep(task,'completed',new Date().toISOString()))return;
    state.logs.push({id:S.uid('log'),at:task.completedAt,type:'subtask',message:`${task.title} completed.`});save();
    const count=protocol.steps.filter(step=>step.status==='completed').length;
    await showOverlay('SUBTASK CONFIRMED',task.title,`${count} / ${protocol.steps.length}`);
    if(!currentStep(protocol))await clearProtocol(record,protocol);else renderApp();
  };

  const beginAction=()=>{
    const protocol=activeProtocolRecord(),task=currentStep(protocol);if(!task||$('#actionButton').disabled)return;
    if(task.type==='tap')completeSubtask();
    else if(task.type==='timer'){
      if(task.status==='pending'){transitionStep(task,'active',new Date().toISOString());save();systemFeedback('start','Timed directive started.',`timer-${protocol.id}-${task.id}-${task.startedAt}`);renderApp()}
      else if(Date.now()-new Date(task.startedAt).getTime()>=task.duration*60000)completeSubtask();
    }
  };

  const cancelHold=(owner=null)=>{
    if(!holdSession)return;if(owner&&holdSession.owner!==owner)return;
    cancelAnimationFrame(holdSession.raf);holdSession.onProgress?.(0);
    if(navigator.vibrate)navigator.vibrate(0);
    document.body.classList.remove('hold-active');delete document.body.dataset.holdOwner;holdSession=null;
  };
  const beginHold=(owner,duration,onProgress,onComplete)=>{
    cancelHold();const started=performance.now(),checkpoints=[.25,.5,.75],checkpointOwners=new Set(['brand','schedule-access','emergency-exit','clock-backup']);let checkpointIndex=0;
    document.body.classList.add('hold-active');document.body.dataset.holdOwner=owner;
    const frame=now=>{
      const progress=clamp((now-started)/duration,0,1);onProgress?.(progress);
      if(checkpointOwners.has(owner)&&checkpointIndex<checkpoints.length&&progress>=checkpoints[checkpointIndex]){haptic(checkpointIndex===1?'hold-mid':'hold');checkpointIndex+=1}
      if(progress>=1){
        holdSession=null;onProgress?.(0);document.body.classList.remove('hold-active');delete document.body.dataset.holdOwner;haptic('hold-final');onComplete();
      }else holdSession.raf=requestAnimationFrame(frame);
    };
    holdSession={owner,raf:requestAnimationFrame(frame),onProgress};
  };

  const confirmEarlyWake=async()=>{
    const record=createDayRecord(new Date());if(record.wakeCheckInAt){renderApp();return}
    const now=new Date();recordWakeCheckIn(record,now,'early-confirmation');earlyWakeDismissedSession=false;
    await showOverlay('WAKE TIME RECORDED',formatClock(now),'STATUS · EARLY');renderApp();
  };

  const showBreachWarning=(title,copy,kind='warning')=>{
    $('#breachTitle').textContent=title;$('#breachCopy').textContent=copy;$('#breachWarning').hidden=false;systemFeedback(kind,title,`${kind}-${title}-${Date.now()}`);
    setTimeout(()=>{$('#breachWarning').hidden=true},3400);
  };

  const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

  const completeCustomStep=()=>completeSubtask();

  const addAcademicTask=(subject,title,deadline,difficulty,note)=>{
    state.academicTasks.push({id:S.uid('task'),subjectKey:subject.key,subjectName:subject.name,title,deadline,difficulty,note,status:'pending',createdAt:new Date().toISOString(),workMinutes:0,completedAt:null});save();
  };

  const installAcademicPlan=(protocol,planner,mode,selectedIds=[])=>{
    protocol.steps=protocol.steps.filter(step=>!step.generatedAcademic);
    const plannerIndex=protocol.steps.indexOf(planner);const total=protocol.boss?30:25;let generated=[];
    if(mode==='maintenance')generated=[{id:`academic-maintenance-${Date.now()}`,title:protocol.boss?'Weekly Boss Academic Maintenance':'Academic Maintenance',copy:variants('Review notes, read ahead, organize files, or prepare for the next class.','Use the block to strengthen academic readiness.'),icon:'work',type:'academic',duration:total,generatedAcademic:true,status:'pending',startedAt:null,completedAt:null}];
    else{
      const tasks=selectedIds.map(id=>state.academicTasks.find(task=>task.id===id)).filter(Boolean);const each=Math.max(5,Math.floor(total/tasks.length));let remaining=total;
      generated=tasks.map((task,index)=>{const duration=index===tasks.length-1?remaining:each;remaining-=duration;return{id:`academic-${task.id}-${Date.now()}-${index}`,title:task.title,copy:variants(`Execute ${task.subjectName}: ${task.title}.`,`Complete a focused block for ${task.subjectName}.`),icon:'academic',type:'academic',duration,taskId:task.id,generatedAcademic:true,status:'pending',startedAt:null,completedAt:null}});
    }
    protocol.steps.splice(plannerIndex+1,0,...generated);transitionStep(planner,'completed',new Date().toISOString());save();renderApp();
  };

  const handleCustomAction=event=>{
    const button=event.target.closest('[data-custom]');if(!button||button.disabled)return;
    const action=button.dataset.custom;const protocol=activeProtocolRecord();const step=currentStep(protocol);if(!protocol||!step)return;
    if(action==='finish-audit'){completeCustomStep();return}
    if(action==='complete-existing'){
      const task=state.academicTasks.find(item=>item.id===button.dataset.taskId);if(task){task.status='completed';task.completedAt=new Date().toISOString();save();showBreachWarning('TASK COMPLETED',task.title);renderApp()}return;
    }
    if(action==='save-task'){
      const subject=currentAuditSubject(step);const title=$('#auditTaskTitle')?.value.trim();const deadline=$('#auditTaskDeadline')?.value;const difficulty=$('#auditTaskDifficulty')?.value||'Moderate';const note=$('#auditTaskNote')?.value.trim()||'';
      if(!subject||!title||!deadline){showBreachWarning('TASK DATA INCOMPLETE','Task name and deadline are required.');return}
      addAcademicTask(subject,title,deadline,difficulty,note);showBreachWarning('TASK SAVED',`${subject.name}: ${title}`);renderApp();return;
    }
    if(action==='next-subject'){step.auditState.index+=1;save();renderApp();return}
    if(action==='plan-single'||action==='plan-multi'){
      step.planState={phase:'select',mode:action==='plan-single'?'single':'multi',index:0,selectedIds:[]};save();renderApp();return;
    }
    if(action==='plan-maintenance'){installAcademicPlan(protocol,step,'maintenance');return}
    if(action==='task-prev'||action==='task-next'){
      const tasks=pendingTasks();step.planState.index=(step.planState.index+(action==='task-next'?1:-1)+tasks.length)%tasks.length;save();renderApp();return;
    }
    if(action==='task-toggle'){
      const tasks=pendingTasks(),task=tasks[step.planState.index];if(!task)return;
      if(step.planState.mode==='single')step.planState.selectedIds=[task.id];
      else if(step.planState.selectedIds.includes(task.id))step.planState.selectedIds=step.planState.selectedIds.filter(id=>id!==task.id);
      else if(step.planState.selectedIds.length<3)step.planState.selectedIds.push(task.id);
      save();renderApp();return;
    }
    if(action==='confirm-plan'){installAcademicPlan(protocol,step,step.planState.mode,step.planState.selectedIds);return}
    if(action==='start-academic'){transitionStep(step,'active',new Date().toISOString());save();systemFeedback(protocol.boss?'boss':'start',protocol.boss?'Weekly Boss focus started.':'Academic focus started.',`academic-${step.id}`);renderApp();return}
    if(action==='finish-maintenance'){completeCustomStep();return}
    if(action==='task-completed'||action==='task-progress'){
      const task=state.academicTasks.find(item=>item.id===step.taskId);if(task){task.workMinutes=(task.workMinutes||0)+step.duration;if(action==='task-completed'){task.status='completed';task.completedAt=new Date().toISOString()}}
      save();completeCustomStep();return;
    }
    if(action==='start-trading'){transitionStep(step,'active',new Date().toISOString());save();systemFeedback('start','Trading review started.',`trading-${step.id}`);renderApp();return}
    if(action==='save-trading'){
      const observation=$('#tradingObservation')?.value.trim();const decision=$('#tradingDecision')?.value;if(!observation){showBreachWarning('OBSERVATION REQUIRED','Record one market observation before continuing.');return}
      state.tradingNotes.push({id:S.uid('trade'),at:new Date().toISOString(),observation,decision});save();completeCustomStep();
    }
  };

  const scheduleDays=[
    {value:1,label:'M',name:'Monday'},{value:2,label:'T',name:'Tuesday'},{value:3,label:'W',name:'Wednesday'},
    {value:4,label:'T',name:'Thursday'},{value:5,label:'F',name:'Friday'},{value:6,label:'S',name:'Saturday'},
    {value:0,label:'S',name:'Sunday'}
  ];
  const schedulePageSize=4;
  const scheduleDayName=day=>scheduleDays.find(item=>item.value===Number(day))?.name||'Day';
  const scheduleEntriesForDay=day=>activeSchedule().filter(entry=>Number(entry.day)===Number(day)).sort((a,b)=>minutes(a.start)-minutes(b.start)||a.subject.localeCompare(b.subject));
  const defaultScheduleDay=()=>{
    const today=new Date().getDay();if(scheduleEntriesForDay(today).length)return today;
    return scheduleDays.find(item=>scheduleEntriesForDay(item.value).length)?.value??today;
  };
  const sortedExceptions=()=>[...state.scheduleExceptions].filter(item=>item.active!==false).sort((a,b)=>`${b.date}|${b.createdAt}`.localeCompare(`${a.date}|${a.createdAt}`));
  const syncExceptionFields=()=>{
    const type=$('#exceptionType').value,needsClass=type!=='no-classes',needsTime=['reschedule','special'].includes(type);
    document.querySelector('.exception-class-field').hidden=!needsClass;
    document.querySelectorAll('.exception-time-field').forEach(field=>field.hidden=!needsTime);
  };
  const renderScheduleExceptions=()=>{
    setControlView('scheduleExceptionsView');
    if(!$('#exceptionDate').value)$('#exceptionDate').value=S.dateKey(new Date());
    const entries=activeSchedule().sort((a,b)=>a.subject.localeCompare(b.subject));
    $('#exceptionClass').innerHTML=entries.length?entries.map(entry=>`<option value="${entry.id}">${escapeHtml(entry.subject)} · ${scheduleDayName(entry.day)}</option>`).join(''):'<option value="">No classes saved</option>';
    syncExceptionFields();
    const items=sortedExceptions();exceptionUi.index=clamp(exceptionUi.index,0,Math.max(0,items.length-1));const item=items[exceptionUi.index];
    $('#exceptionNav').hidden=items.length<=1;$('#exceptionPageLabel').textContent=items.length?`${exceptionUi.index+1} / ${items.length}`:'0 / 0';
    $('#exceptionPrev').disabled=exceptionUi.index===0;$('#exceptionNext').disabled=exceptionUi.index>=items.length-1;$('#deleteScheduleException').hidden=!item;
    if(!item){$('#exceptionRecord').innerHTML='<span>NO EXCEPTIONS</span><strong>Normal schedule active</strong><small>One-day changes appear here.</small>';return}
    const entry=state.classSchedule.find(value=>value.id===item.classId);const typeLabel={'no-classes':'NO CLASSES','cancel':'CLASS CANCELLED','reschedule':'CLASS RESCHEDULED','special':'EXAM / SPECIAL'}[item.type];
    const time=item.start&&item.end?` · ${formatTime(item.start)}–${formatTime(item.end)}`:'';
    $('#exceptionRecord').innerHTML=`<span>${escapeHtml(item.date)} · ${typeLabel}</span><strong>${escapeHtml(item.type==='no-classes'?'All scheduled classes':entry?.subject||'Class record')}</strong><small>${escapeHtml((item.note||'One-day schedule override')+time)}</small>`;
  };
  const saveScheduleException=()=>{
    const date=$('#exceptionDate').value,type=$('#exceptionType').value,classId=type==='no-classes'?null:$('#exceptionClass').value,start=$('#exceptionStart').value,end=$('#exceptionEnd').value,note=$('#exceptionNote').value.trim();
    if(!date){showBreachWarning('DATE REQUIRED','Choose the date for this exception.');return}
    if(type!=='no-classes'&&!classId){showBreachWarning('CLASS REQUIRED','Choose the affected class.');return}
    if(['reschedule','special'].includes(type)&&(!start||!end||minutes(end)<=minutes(start))){showBreachWarning('VALID TIME REQUIRED','Choose a valid start and end time.');return}
    state.scheduleExceptions=state.scheduleExceptions.filter(item=>!(item.date===date&&item.type===type&&item.classId===classId));
    state.scheduleExceptions.push({id:S.uid('exception'),date,type,classId,start:['reschedule','special'].includes(type)?start:'',end:['reschedule','special'].includes(type)?end:'',note,active:true,createdAt:new Date().toISOString()});
    state.attendanceRecords.filter(record=>record.scheduledDate===date&&!record.finalized&&(type==='no-classes'||record.classId===classId)).forEach(record=>{
      if(['no-classes','cancel'].includes(type)){record.status='cancelled';record.finalized=true;record.dismissalStatus='cancelled';record.dismissedAt=new Date().toISOString();record.pendingXp=0;record.xpAwarded=0}
      else{record.scheduledStart=start;record.scheduledEnd=end;record.updatedAt=new Date().toISOString()}
    });
    state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'schedule',message:`Schedule exception saved for ${date}: ${type}.`});save();exceptionUi.index=0;renderScheduleExceptions();showSystemNotice('snapshot','SCHEDULE EXCEPTION SAVED','Only the selected date is affected.',2400);
  };
  const deleteScheduleException=()=>{
    const item=sortedExceptions()[exceptionUi.index];if(!item)return;state.scheduleExceptions=state.scheduleExceptions.filter(value=>value.id!==item.id);state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'schedule',message:`Schedule exception deleted for ${item.date}.`});save();exceptionUi.index=Math.max(0,exceptionUi.index-1);renderScheduleExceptions();
  };

  const controlViews=['controlHomeView','academicHomeView','profileView','attendanceView','systemIntegrityView','scheduleExceptionsView','dataBackupView','scheduleOverviewView','scheduleEditView'];
  const setControlView=view=>{
    controlUi.view=view;
    controlViews.forEach(id=>{const node=document.getElementById(id);if(node)node.hidden=id!==view});
  };
  const subjectCatalog=()=>{
    const map=new Map();
    const add=(key,name,code='')=>{const normalized=subjectKey(key||name);if(!normalized)return;if(!map.has(normalized))map.set(normalized,{key:normalized,name:name||key,code});};
    state.classSchedule.forEach(entry=>add(entry.subject,entry.subject,entry.code||''));
    state.attendanceRecords.forEach(record=>add(record.subjectKey,record.subjectName,record.code||''));
    state.academicTasks.forEach(task=>add(task.subjectKey,task.subjectName,''));
    return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name));
  };
  const streakSummary=records=>{
    const usable=[...records].filter(record=>record.finalized&&record.status!=='cancelled').sort((a,b)=>`${a.scheduledDate}T${a.scheduledStart}`.localeCompare(`${b.scheduledDate}T${b.scheduledStart}`));
    let current=0,best=0,run=0,punctual=0;
    usable.forEach(record=>{if(['early','present','late'].includes(record.status)){run+=1;best=Math.max(best,run)}else if(record.status==='absent')run=0});
    for(let index=usable.length-1;index>=0;index-=1){if(['early','present','late'].includes(usable[index].status))current+=1;else break}
    for(let index=usable.length-1;index>=0;index-=1){if(['early','present'].includes(usable[index].status))punctual+=1;else break}
    return{current,best,punctual};
  };
  const subjectStats=key=>{
    const subject=subjectCatalog().find(item=>item.key===key)||{key,name:key,code:''};
    const records=state.attendanceRecords.filter(record=>record.subjectKey===key);
    const counts={early:0,present:0,late:0,absent:0,cancelled:0,unverified:0};records.forEach(record=>{if(counts[record.status]!==undefined)counts[record.status]+=1});
    const attended=counts.early+counts.present+counts.late,required=attended+counts.absent;
    const tasks=state.academicTasks.filter(task=>task.subjectKey===key),completedTasks=tasks.filter(task=>task.status==='completed').length;
    const workMinutes=tasks.reduce((sum,task)=>sum+Number(task.workMinutes||0),0);
    const attendanceXp=records.reduce((sum,record)=>sum+Number(record.xpAwarded||0),0);
    const taskXp=completedTasks*20+Math.floor(workMinutes/5)*2;
    const xp=attendanceXp+taskXp,level=Math.min(50,1+Math.floor(xp/150));
    const streaks=streakSummary(records);
    return{subject,records,counts,attended,required,attendanceRate:required?Math.round(attended/required*100):0,punctualityRate:attended?Math.round((counts.early+counts.present)/attended*100):0,tasks,completedTasks,pendingTasks:tasks.length-completedTasks,workMinutes,attendanceXp,taskXp,xp,level,streaks};
  };
  const overallAcademicStats=()=>{
    const subjects=subjectCatalog().map(subject=>subjectStats(subject.key));
    const counts={early:0,present:0,late:0,absent:0,cancelled:0,unverified:0};state.attendanceRecords.forEach(record=>{if(counts[record.status]!==undefined)counts[record.status]+=1});
    const attended=counts.early+counts.present+counts.late,required=attended+counts.absent;
    return{subjects,counts,attended,required,attendanceRate:required?Math.round(attended/required*100):0,punctualityRate:attended?Math.round((counts.early+counts.present)/attended*100):0,xp:subjects.reduce((sum,item)=>sum+item.xp,0),streaks:streakSummary(state.attendanceRecords)};
  };
  const directiveStats=id=>{
    const records=Object.values(state.dayRecords).map(day=>({day,protocol:day.protocols?.[id]})).filter(item=>item.protocol);
    const clears=records.filter(item=>item.protocol.status==='cleared'),failures=records.filter(item=>item.protocol.status==='failed');
    const onTime=clears.filter(item=>protocolOnTime(item.day,item.protocol)).length;
    const missed={};records.forEach(({protocol})=>protocol.steps?.filter(step=>step.status!=='completed').forEach(step=>{missed[step.title]=(missed[step.title]||0)+1}));
    const mostMissed=Object.entries(missed).sort((a,b)=>b[1]-a[1])[0]?.[0]||'None recorded';
    return{clears:clears.length,failures:failures.length,completionRate:records.length?Math.round(clears.length/records.length*100):0,onTimeRate:clears.length?Math.round(onTime/clears.length*100):0,mostMissed};
  };
  const sortedDayRecords=()=>Object.values(state.dayRecords).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const firstStreakUnlockDate=threshold=>{
    let streak=0;
    for(const day of sortedDayRecords()){
      if(day.status==='cleared')streak+=1;else if(day.status==='failed')streak=0;
      if(streak>=threshold)return `${day.date}T22:00:00`;
    }
    return null;
  };
  const nthAttendanceDate=(statuses,count)=>{
    const matches=[...state.attendanceRecords].filter(record=>record.finalized&&statuses.includes(record.status)).sort((a,b)=>`${a.scheduledDate}T${a.scheduledStart}`.localeCompare(`${b.scheduledDate}T${b.scheduledStart}`));
    const record=matches[count-1];return record?record.checkInAt||`${record.scheduledDate}T${record.scheduledStart}:00`:null;
  };
  const firstFocusUnlockDate=()=>{
    const qualifying=sortedDayRecords().filter(day=>day.status==='cleared'&&Object.values(day.protocols||{}).every(protocol=>Number(protocol.focusBreaches||0)===0));
    return qualifying[2]?`${qualifying[2].date}T22:00:00`:null;
  };
  const achievementList=()=>{
    const academic=overallAcademicStats();const subjects=academic.subjects;
    const days=sortedDayRecords();
    const firstPerfect=days.find(day=>day.perfectClear);
    const firstBoss=days.find(day=>day.weeklyBossCleared);
    const specialistDates=[...state.attendanceRecords.map(record=>record.updatedAt||record.checkInAt),...state.academicTasks.map(task=>task.completedAt||task.createdAt)].filter(Boolean).sort();const specialistSource=specialistDates[specialistDates.length-1]||null;
    const items=[
      {id:'discipline-initiate',title:'Discipline Initiate',unlocked:true,detail:'Activate the ASCEND System.',candidateAt:state.createdAt},
      {id:'first-perfect-clear',title:'First Perfect Clear',unlocked:(state.player.perfectClears||0)>=1,detail:'Complete one Perfect Clear.',candidateAt:firstPerfect?`${firstPerfect.date}T22:00:00`:state.player.lastPerfectDate},
      {id:'seven-day-streak',title:'Seven-Day Streak',unlocked:(state.player.bestStreak||0)>=7,detail:'Maintain seven consecutive clear days.',candidateAt:firstStreakUnlockDate(7)},
      {id:'thirty-day-streak',title:'Thirty-Day Streak',unlocked:(state.player.bestStreak||0)>=30,detail:'Maintain thirty consecutive clear days.',candidateAt:firstStreakUnlockDate(30)},
      {id:'perfect-attendance',title:'Perfect Attendance',unlocked:academic.required>=5&&academic.attendanceRate===100,detail:'Maintain perfect verified attendance across five classes.',candidateAt:nthAttendanceDate(['early','present','late'],5)},
      {id:'early-arrival-specialist',title:'Early Arrival Specialist',unlocked:academic.counts.early>=5,detail:'Record five early class arrivals.',candidateAt:nthAttendanceDate(['early'],5)},
      {id:'weekly-boss-slayer',title:'Weekly Boss Slayer',unlocked:Boolean(firstBoss),detail:'Defeat one Weekly Boss.',candidateAt:firstBoss?`${firstBoss.date}T22:00:00`:null},
      {id:'focus-unbroken',title:'Focus Unbroken',unlocked:state.player.totalClearDays>=3&&firstFocusUnlockDate()!=null,detail:'Clear three days without a Focus Breach.',candidateAt:firstFocusUnlockDate()},
      {id:'subject-specialist',title:'Subject Specialist',unlocked:subjects.some(subject=>subject.level>=5),detail:'Reach Subject Level 5.',candidateAt:specialistSource}
    ];
    const unlocks=state.player.achievementUnlocks||(state.player.achievementUnlocks={}),newAchievements=[];
    items.forEach(item=>{if(item.unlocked&&!unlocks[item.id]){unlocks[item.id]=item.candidateAt||new Date().toISOString();newAchievements.push(item)}item.unlockedAt=unlocks[item.id]||null});
    if(newAchievements.length){newAchievements.forEach(item=>state.logs.push({id:S.uid('log'),at:item.unlockedAt||new Date().toISOString(),type:'achievement',message:`Achievement unlocked: ${item.title}.`}));save()}
    return items;
  };
  const renderControlHome=()=>{setControlView('controlHomeView')};
  const renderAcademicHome=()=>{
    setControlView('academicHomeView');const academic=overallAcademicStats();$('#scheduleHomeCount').textContent=activeSchedule().length;$('#academicHomeXp').textContent=academic.xp;
  };
  const renderSystemIntegrity=async()=>{
    setControlView('systemIntegrityView');
    const snapshots=S.listSnapshots();const report=await storageReport();const percent=Math.min(999,Math.round(report.ratio*100));
    $('#integrityClockStatus').textContent=state.integrity.clockStatus==='flagged'?'FLAGGED':'TRUSTED';
    $('#integrityClockStatus').classList.toggle('critical-text',state.integrity.clockStatus==='flagged');
    $('#integrityStorageStatus').textContent=report.ratio>=.8?'HIGH':`${percent}%`;
    $('#integritySnapshotCount').textContent=`${snapshots.length} / 7`;
    $('#integrityNotificationStatus').textContent=state.settings.notifications&&('Notification' in window)&&Notification.permission==='granted'?'ON':'OFF';
    $('#integrityCopy').textContent=state.integrity.clockStatus==='flagged'?'Progression rewards are held. Confirm the correct device time to release them.':'Timeline checks, strict protocol states, and automatic recovery snapshots are active.';
    $('#verifyClock').hidden=state.integrity.clockStatus!=='flagged';
    $('#toggleNotifications b').textContent=state.settings.notifications?'Disable Local Alerts':'Enable Local Alerts';
    $('#toggleWakeLock b').textContent=`Keep Screen Awake: ${state.settings.keepAwake?'On':'Off'}`;
    $('#restoreLatestSnapshot').disabled=!snapshots.length;
  };
  const verifyDeviceClock=()=>{
    state.integrity.clockStatus='trusted';state.integrity.rewardHold=false;state.integrity.lastFlag=null;state.integrity.lastVerifiedAt=new Date().toISOString();state.integrity.lastWallTime=new Date().toISOString();clockBaseline={wall:Date.now(),mono:performance.now()};clockAlertShown=false;
    const released=releaseHeldRewards();state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'integrity',message:`Current device time verified. ${released} held reward(s) released.`});save({silent:true});showSystemNotice('integrity','DEVICE TIME VERIFIED',released?`${released} held reward(s) released.`:'Timeline trust restored.',3200);renderSystemIntegrity();
  };
  const toggleNotifications=async()=>{
    if(!('Notification' in window)){showBreachWarning('ALERTS NOT SUPPORTED','This browser does not support local notifications.');return}
    if(!state.settings.notifications){const permission=await Notification.requestPermission();if(permission!=='granted'){showBreachWarning('ALERT PERMISSION DENIED','Enable notifications in browser or app settings first.');return}state.settings.notifications=true}
    else state.settings.notifications=false;
    state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'integrity',message:`Local alerts ${state.settings.notifications?'enabled':'disabled'}.`});save();renderSystemIntegrity();
  };
  const restoreLatestSnapshot=()=>{
    const latest=S.listSnapshots()[0];if(!latest){showBreachWarning('NO SNAPSHOT','No automatic recovery snapshot is available.');return}
    try{state=S.restoreSnapshot(latest.id);state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'restore',message:`Latest automatic snapshot restored: ${latest.date}.`});save({silent:true});closeScheduleOverlay();activeScreenId=null;renderApp();showSystemNotice('restore','SNAPSHOT RESTORED',`Recovered local state from ${latest.date}.`,3200)}catch(error){showBreachWarning('RESTORE FAILED',error.message||'Snapshot could not be restored.')}
  };
  const profilePages=['Identity','Progress','Discipline','Academics','Achievements'];
  const renderProfile=()=>{
    setControlView('profileView');controlUi.profilePage=clamp(controlUi.profilePage,0,profilePages.length-1);
    $('#profileTabs').innerHTML=profilePages.map((page,index)=>`<button type="button" data-profile-page="${index}" class="${index===controlUi.profilePage?'selected':''}">${page.slice(0,4)}</button>`).join('');
    $('#profilePageLabel').textContent=profilePages[controlUi.profilePage];
    const academic=overallAcademicStats(),achievements=achievementList(),unlockedTitles=achievements.filter(item=>item.unlocked).map(item=>item.title);
    if(!unlockedTitles.includes(state.player.title)){state.player.title=unlockedTitles[0]||'Discipline Initiate';save()}
    if(controlUi.profilePage===0){
      const emblemOptions=[['apex','Apex'],['confirm','Shard'],['shine','Radiance'],['stretch','Flow'],['academic','Scholar'],['work','Core']],activeEmblem=normalizeGlyph(state.player.emblem);
      $('#profileContent').innerHTML=`<div class="profile-identity"><div class="profile-emblem">${glyphMarkup(activeEmblem)}</div><div><span>PLAYER</span><strong>${escapeHtml(state.player.codename||state.player.name)}</strong><small>${escapeHtml(state.player.title)}</small></div></div><div class="profile-form"><label>Name<input id="profileNameEdit" type="text" maxlength="40" value="${escapeHtml(state.player.name)}"></label><label>Codename<input id="profileCodenameEdit" type="text" maxlength="24" value="${escapeHtml(state.player.codename||'')}"></label><label>Emblem<select id="profileEmblemEdit">${emblemOptions.map(([value,label])=>`<option value="${value}" ${value===activeEmblem?'selected':''}>${label}</option>`).join('')}</select></label><label>Title<select id="profileTitleEdit">${unlockedTitles.map(value=>`<option ${value===state.player.title?'selected':''}>${escapeHtml(value)}</option>`).join('')}</select></label></div><button class="custom-primary" type="button" data-profile-action="save-identity">Save Identity</button>`;
    }else if(controlUi.profilePage===1){
      const required=clearDaysRequired(state.player.level),nextRank=state.player.pendingRank||eligibleRank(state.player.level,state.player.rank)||'S';
      const progress=state.player.mastered?100:required?Math.round(state.player.levelClearDays/required*100):100;
      const remaining=state.player.mastered?0:Math.max(0,required-state.player.levelClearDays);
      $('#profileContent').innerHTML=`<div class="progress-visual"><div class="level-progress-ring" style="--level-progress:${progress*3.6}deg"><span>LEVEL</span><strong>${state.player.level}</strong><small>${progress}%</small></div><div class="progress-visual-copy"><span>${state.player.mastered?'SYSTEM MASTERY':'NEXT LEVEL REQUIREMENT'}</span><strong>${state.player.mastered?'LEVEL 50 ACHIEVED':`${state.player.levelClearDays} / ${required} CLEAR DAYS`}</strong><small>${state.player.mastered?'Progression complete.':`${remaining} more clear day${remaining===1?'':'s'} required.`}</small></div></div><div class="progress-metrics"><div><span>LIFETIME XP</span><strong>${state.player.totalXp}</strong></div><div><span>LIFETIME CLEAR</span><strong>${state.player.totalClearDays}</strong></div></div><div class="profile-detail"><span>NEXT RANK</span><strong>${state.player.pendingRank?`${state.player.pendingRank}-RANK TRIAL ACTIVE`:nextRank===state.player.rank?'MAXIMUM RANK':`${nextRank}-RANK`}</strong><small>${state.player.pendingRank?`${state.player.pendingRank}-Rank requires ${rankTrialPlanFor(state.player.pendingRank)?.onTime||80}% on-time performance, attendance, streak, boss, and focus standards.`:'Rank progression remains based on level and discipline history.'}</small></div>`;
    }else if(controlUi.profilePage===2){
      const all=protocolBlueprints.map(config=>({config,stats:directiveStats(config.id)}));const selected=all[clamp(controlUi.directiveIndex,0,all.length-1)];
      const strongest=[...all].sort((a,b)=>b.stats.completionRate-a.stats.completionRate)[0],weakest=[...all].sort((a,b)=>a.stats.completionRate-b.stats.completionRate)[0];
      const days=Object.values(state.dayRecords),integrityValues=days.flatMap(day=>Object.values(day.protocols||{}).map(focusIntegrity));const integrity=integrityValues.length?Math.round(integrityValues.reduce((a,b)=>a+b,0)/integrityValues.length):100;
      $('#profileContent').innerHTML=`<div class="stat-grid"><div><span>CURRENT STREAK</span><strong>${state.player.streak}</strong></div><div><span>BEST STREAK</span><strong>${state.player.bestStreak}</strong></div><div><span>PERFECT CLEARS</span><strong>${state.player.perfectClears||0}</strong></div><div><span>FOCUS INTEGRITY</span><strong>${integrity}%</strong></div></div><div class="profile-detail directive-detail"><span>${escapeHtml(selected.config.name.toUpperCase())}</span><strong>${selected.stats.completionRate}% CLEAR · ${selected.stats.onTimeRate}% ON TIME</strong><small>${selected.stats.clears} clears · Most missed: ${escapeHtml(selected.stats.mostMissed)}</small><div class="mini-nav"><button type="button" data-profile-action="directive-prev" aria-label="Previous directive">${glyphMarkup('chevron-left')}</button><b>${controlUi.directiveIndex+1} / ${all.length}</b><button type="button" data-profile-action="directive-next" aria-label="Next directive">${glyphMarkup('chevron-right')}</button></div></div><div class="analysis-line"><span>STRONGEST</span><strong>${escapeHtml(strongest.config.name)}</strong><span>WEAKEST</span><strong>${escapeHtml(weakest.config.name)}</strong></div>`;
    }else if(controlUi.profilePage===3){
      const highest=[...academic.subjects].sort((a,b)=>b.level-a.level||b.xp-a.xp)[0];
      const analysis=academic.attendanceRate>=90?'Attendance is reliable.':academic.required?'Attendance consistency needs reinforcement.':'Add classes to begin academic habit tracking.';
      const punctual=academic.punctualityRate>=85?'Punctuality is strong.':'Earlier arrival should be prioritized.';
      $('#profileContent').innerHTML=`<div class="stat-grid"><div><span>ACADEMIC XP</span><strong>${academic.xp}</strong></div><div><span>ATTENDANCE</span><strong>${academic.attendanceRate}%</strong></div><div><span>PUNCTUALITY</span><strong>${academic.punctualityRate}%</strong></div><div><span>CLASS STREAK</span><strong>${academic.streaks.current}</strong></div></div><div class="profile-detail"><span>HIGHEST SUBJECT</span><strong>${highest?`${escapeHtml(highest.subject.name)} · LV ${highest.level}`:'NO DATA'}</strong><small>${highest?`${highest.xp} XP · ${highest.completedTasks}/${highest.tasks.length} tasks completed`:'Schedule a class to create a subject record.'}</small></div><div class="profile-detail"><span>SYSTEM ANALYSIS</span><strong>${escapeHtml(analysis)}</strong><small>${escapeHtml(punctual)}</small></div><button class="custom-primary" type="button" data-profile-action="open-attendance">Open Attendance & Progress</button>`;
    }else{
      const pageSize=4,totalPages=Math.max(1,Math.ceil(achievements.length/pageSize));controlUi.achievementPage=clamp(controlUi.achievementPage,0,totalPages-1);
      const pageItems=achievements.slice(controlUi.achievementPage*pageSize,(controlUi.achievementPage+1)*pageSize),seen=new Set(state.player.achievementSeen||[]);
      const newIds=pageItems.filter(item=>item.unlocked&&!seen.has(item.id)).map(item=>item.id);
      $('#profileContent').innerHTML=`<div class="achievement-summary"><span>UNLOCKED TITLES</span><strong>${achievements.filter(item=>item.unlocked).length} / ${achievements.length}</strong></div><div class="achievement-list">${pageItems.map(item=>`<div class="achievement-row ${item.unlocked?'unlocked':'locked'} ${item.unlocked&&!seen.has(item.id)?'new':''}"><div class="achievement-status">${glyphMarkup(item.unlocked?'success':'lock')}</div><div><strong>${escapeHtml(item.title)}</strong><small>${item.unlocked?`Unlocked ${formatShortDate(item.unlockedAt)}`:'Locked'}</small><em class="achievement-requirement">${escapeHtml(item.detail)}</em></div>${item.unlocked&&!seen.has(item.id)?'<b>NEW</b>':''}</div>`).join('')}</div><div class="mini-nav achievement-nav"><button type="button" data-profile-action="achievement-prev" aria-label="Previous achievements">${glyphMarkup('chevron-left')}</button><b>${controlUi.achievementPage+1} / ${totalPages}</b><button type="button" data-profile-action="achievement-next" aria-label="Next achievements">${glyphMarkup('chevron-right')}</button></div>`;
      clearTimeout(achievementSeenTimer);
      if(newIds.length)achievementSeenTimer=setTimeout(()=>{state.player.achievementSeen=[...new Set([...(state.player.achievementSeen||[]),...newIds])];save();document.querySelectorAll('.achievement-row.new').forEach(row=>row.classList.remove('new'))},1500);
    }
  };
  const attendanceTabs=[{id:'overall',label:'Overall'},{id:'subjects',label:'Subjects'},{id:'history',label:'History'}];
  const historyRecords=()=>[...state.attendanceRecords].sort((a,b)=>`${b.scheduledDate}T${b.scheduledStart}`.localeCompare(`${a.scheduledDate}T${a.scheduledStart}`));
  const renderAttendance=()=>{
    setControlView('attendanceView');const academic=overallAcademicStats();
    $('#attendanceTabs').innerHTML=attendanceTabs.map(tab=>`<button type="button" data-attendance-tab="${tab.id}" class="${tab.id===controlUi.attendanceTab?'selected':''}">${tab.label}</button>`).join('');
    if(controlUi.attendanceTab==='overall'){
      $('#attendanceNav').hidden=true;$('#attendanceContent').innerHTML=`<div class="stat-grid"><div><span>ACADEMIC XP</span><strong>${academic.xp}</strong></div><div><span>ATTENDANCE</span><strong>${academic.attendanceRate}%</strong></div><div><span>PUNCTUALITY</span><strong>${academic.punctualityRate}%</strong></div><div><span>CURRENT STREAK</span><strong>${academic.streaks.current}</strong></div></div><div class="attendance-counts"><div><span>EARLY</span><strong>${academic.counts.early}</strong></div><div><span>PRESENT</span><strong>${academic.counts.present}</strong></div><div><span>LATE</span><strong>${academic.counts.late}</strong></div><div><span>ABSENT</span><strong>${academic.counts.absent}</strong></div><div><span>UNVERIFIED</span><strong>${academic.counts.unverified}</strong></div><div><span>CANCELLED</span><strong>${academic.counts.cancelled}</strong></div></div>`;
      return;
    }
    if(controlUi.attendanceTab==='subjects'){
      const subjects=academic.subjects;controlUi.subjectIndex=clamp(controlUi.subjectIndex,0,Math.max(0,subjects.length-1));$('#attendanceNav').hidden=!subjects.length;
      if(!subjects.length){$('#attendanceContent').innerHTML='<div class="schedule-empty"><strong>No Subject Data</strong><span>Add classes to begin attendance and habit tracking.</span></div>';return}
      const stats=subjects[controlUi.subjectIndex];$('#attendancePageLabel').textContent=`${controlUi.subjectIndex+1} / ${subjects.length}`;
      $('#attendanceContent').innerHTML=`<div class="subject-title"><span>SUBJECT LEVEL ${stats.level}</span><strong>${escapeHtml(stats.subject.name)}</strong><small>${stats.subject.code?escapeHtml(stats.subject.code):'SCHEDULE-LINKED SUBJECT'}</small></div><div class="stat-grid"><div><span>SUBJECT XP</span><strong>${stats.xp}</strong></div><div><span>ATTENDANCE</span><strong>${stats.attendanceRate}%</strong></div><div><span>PUNCTUALITY</span><strong>${stats.punctualityRate}%</strong></div><div><span>STREAK</span><strong>${stats.streaks.current}</strong></div></div><div class="subject-details"><span>Best streak</span><strong>${stats.streaks.best}</strong><span>Tasks</span><strong>${stats.completedTasks}/${stats.tasks.length}</strong><span>Work time</span><strong>${stats.workMinutes} min</strong><span>Pending</span><strong>${stats.pendingTasks}</strong></div>`;
      return;
    }
    const records=historyRecords();controlUi.historyIndex=clamp(controlUi.historyIndex,0,Math.max(0,records.length-1));$('#attendanceNav').hidden=!records.length;
    if(!records.length){$('#attendanceContent').innerHTML='<div class="schedule-empty"><strong>No Attendance History</strong><span>Records appear after scheduled classes.</span></div>';return}
    const record=records[controlUi.historyIndex];$('#attendancePageLabel').textContent=`${controlUi.historyIndex+1} / ${records.length}`;
    const checkIn=record.checkInAt?formatClock(new Date(record.checkInAt)):'Not recorded',dismissal=record.dismissedAt?formatClock(new Date(record.dismissedAt)):'Pending';
    $('#attendanceContent').innerHTML=`<div class="history-card"><span>${escapeHtml(record.scheduledDate)}</span><strong>${escapeHtml(record.subjectName)}</strong><small>${formatTime(record.scheduledStart)}–${formatTime(record.scheduledEnd)} · ${escapeHtml(record.modality||'Onsite')}</small><div class="history-grid"><span>Status</span><b>${escapeHtml(record.status.toUpperCase())}</b><span>Check-in</span><b>${checkIn}</b><span>Dismissed</span><b>${dismissal}</b><span>XP</span><b>${record.finalized?`+${record.xpAwarded}`:'LOCKED'}</b></div></div>${controlUi.correction?`<div class="correction-grid"><button type="button" data-correct-status="early">Early</button><button type="button" data-correct-status="present">Present</button><button type="button" data-correct-status="late">Late</button><button type="button" data-correct-status="absent">Absent</button><button type="button" data-correct-status="cancelled">Cancelled</button><button type="button" data-correct-status="unverified">Unverified</button></div>`:'<button class="custom-primary" type="button" data-attendance-action="correct">Correct Record</button>'}`;
  };
  const correctAttendanceRecord=(record,status)=>{
    const before=record.status,now=new Date();record.corrections=record.corrections||[];record.corrections.push({at:now.toISOString(),from:before,to:status});
    if(['early','present','late'].includes(status)){
      const start=scheduledMoment(record,record.scheduledStart),check=new Date(start);if(status==='early')check.setMinutes(check.getMinutes()-10);if(status==='late')check.setMinutes(check.getMinutes()+15);
      setAttendanceStatus(record,status,check);finalizeAttendance(record,record.dismissalStatus||'dismissed',record.dismissedAt?new Date(record.dismissedAt):scheduledMoment(record,record.scheduledEnd));
    }else if(status==='unverified'){
      setAttendanceStatus(record,'unverified',now);record.finalized=false;record.dismissedAt=null;record.dismissalStatus=null;save();
    }else{
      setAttendanceStatus(record,status,now);record.finalized=true;record.dismissalStatus=status;record.dismissedAt=now.toISOString();save();
    }
    state.logs.push({id:S.uid('log'),at:now.toISOString(),type:'attendance-correction',message:`${record.subjectName} corrected from ${before} to ${status}.`});save();controlUi.correction=false;renderAttendance();
  };
  const backupRecordTotal=summary=>summary.days+summary.attendance+summary.tasks+summary.schedules+(summary.exceptions||0)+summary.trading;
  const renderDataBackup=()=>{
    setControlView('dataBackupView');
    const summary=S.summarize(state);
    $('#backupUpdated').textContent=formatShortDate(summary.updatedAt);
    $('#backupRecordCount').textContent=backupRecordTotal(summary);
    const snapshots=S.listSnapshots();$('#snapshotStripCount').textContent=`${snapshots.length} available`;$('#snapshotStripLatest').textContent=snapshots[0]?`Latest: ${formatShortDate(snapshots[0].createdAt)}`:'No recovery snapshot yet.';
    $('#backupPreview').hidden=!backupUi.pending;
    $('#backupActions').hidden=Boolean(backupUi.pending);
    if(backupUi.pending){
      const preview=S.summarize(backupUi.pending);
      $('#backupPreviewPlayer').textContent=`${preview.playerName} · Level ${preview.level} · ${preview.rank}-Rank`;
      $('#backupPreviewDetails').textContent=`${preview.days} days · ${preview.attendance} attendance records · ${preview.tasks} tasks`;
    }
  };
  const backupFilename=()=>{
    const now=new Date();const time=`${pad(now.getHours())}${pad(now.getMinutes())}`;
    return `ascend-backup-${S.dateKey(now)}-${time}.json`;
  };
  const exportDataBackup=()=>{
    state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'backup',message:'Local ASCEND backup exported.'});save({silent:true});
    const blob=new Blob([S.createBackup(state)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=backupFilename();link.hidden=true;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
    systemFeedback('clear','Backup exported.');showSystemNotice('backup','BACKUP COMPLETE','Offline archive downloaded successfully.',2400);renderDataBackup();
  };
  const clearBackupPreview=()=>{backupUi={pending:null,fileName:''};$('#backupFileInput').value='';renderDataBackup()};
  const previewBackupFile=async file=>{
    if(!file)return;
    if(file.size>10*1024*1024){showBreachWarning('BACKUP TOO LARGE','Choose an ASCEND backup smaller than 10 MB.');return}
    try{
      const imported=S.parseBackup(await file.text());
      backupUi={pending:imported,fileName:file.name};renderDataBackup();haptic('tap');
    }catch(error){backupUi={pending:null,fileName:''};$('#backupFileInput').value='';showBreachWarning('BACKUP NOT ACCEPTED',error?.message||'The selected file could not be read.')}
  };
  const confirmBackupRestore=()=>{
    if(!backupUi.pending)return;
    state=backupUi.pending;
    state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'restore',message:`Local ASCEND backup restored${backupUi.fileName?`: ${backupUi.fileName}`:''}.`});
    save({silent:true});backupUi={pending:null,fileName:''};controlUi.correction=false;scheduleUi.editId=null;activeScreenId=null;
    closeScheduleOverlay();renderApp();showSystemNotice('restore','BACKUP RESTORED','Progress and local records were replaced safely.',2800);showBreachWarning('BACKUP RESTORED','Progress, schedules, attendance, tasks, settings, and milestones were restored.','clear');
  };
  const openControlOverlay=()=>{
    if(activeProtocolRecord()||classStateAt(new Date())||$('#freeScreen').hidden)return;
    cancelHold();$('#scheduleOverlay').hidden=false;renderControlHome();haptic('tap');
  };
  const closeScheduleOverlay=()=>{$('#scheduleOverlay').hidden=true;cancelHold('schedule-delete');cancelHold('schedule-access');$('#compactStatus').style.setProperty('--config-progress','0deg');controlUi.correction=false;backupUi={pending:null,fileName:''};if($('#backupFileInput'))$('#backupFileInput').value=''};
  const renderScheduleOverview=()=>{
    setControlView('scheduleOverviewView');scheduleUi.day=Number(scheduleUi.day);const entries=scheduleEntriesForDay(scheduleUi.day);const totalPages=Math.max(1,Math.ceil(entries.length/schedulePageSize));scheduleUi.page=clamp(scheduleUi.page,0,totalPages-1);
    $('#scheduleWeekTabs').innerHTML=scheduleDays.map(day=>{const count=scheduleEntriesForDay(day.value).length;return`<button type="button" data-day="${day.value}" class="${day.value===scheduleUi.day?'selected':''}"><strong>${day.label}</strong><small>${count}</small></button>`}).join('');
    $('#scheduleDayTitle').textContent=scheduleDayName(scheduleUi.day);$('#scheduleDayCount').textContent=`${entries.length} ${entries.length===1?'class':'classes'}`;
    const pageEntries=entries.slice(scheduleUi.page*schedulePageSize,(scheduleUi.page+1)*schedulePageSize);
    $('#scheduleClassList').innerHTML=pageEntries.length?pageEntries.map(entry=>`<button class="schedule-class-row" type="button" data-class-id="${entry.id}"><span>${formatTime(entry.start)}–${formatTime(entry.end)}</span><strong>${escapeHtml(entry.subject)}</strong><small>${escapeHtml([entry.code,entry.modality,entry.room].filter(Boolean).join(' · ')||'No location')}</small><b>EDIT</b></button>`).join(''):'<div class="schedule-empty"><strong>No classes saved</strong><span>Add a class for this day.</span></div>';
    $('#schedulePageNav').hidden=totalPages<=1;$('#schedulePageLabel').textContent=`${scheduleUi.page+1} / ${totalPages}`;$('#schedulePagePrev').disabled=scheduleUi.page===0;$('#schedulePageNext').disabled=scheduleUi.page>=totalPages-1;
  };
  const currentScheduleEntry=()=>state.classSchedule.find(entry=>entry.id===scheduleUi.editId&&entry.active!==false)||null;
  const openScheduleEditor=id=>{scheduleUi.editId=id||null;scheduleUi.isNew=!id;setControlView('scheduleEditView');fillScheduleForm()};
  const fillScheduleForm=()=>{
    const entry=currentScheduleEntry(),defaults={subject:'',code:'',day:scheduleUi.day,room:'',modality:'Onsite',start:'08:00',end:'09:00'};const value=entry||defaults;
    $('#scheduleEditTitle').textContent=entry?'Edit Class':'Add Class';$('#scheduleSaveLabel').textContent=entry?'Save Changes':'Add Class';$('#scheduleSubject').value=value.subject;$('#scheduleCode').value=value.code||'';$('#scheduleDay').value=String(value.day);$('#scheduleRoom').value=value.room||'';$('#scheduleModality').value=value.modality||'Onsite';$('#scheduleStart').value=value.start;$('#scheduleEnd').value=value.end;$('#scheduleDelete').hidden=!entry;
  };
  const saveScheduleEntry=()=>{
    const subject=$('#scheduleSubject').value.trim(),code=$('#scheduleCode').value.trim(),day=Number($('#scheduleDay').value),room=$('#scheduleRoom').value.trim(),modality=$('#scheduleModality').value,start=$('#scheduleStart').value,end=$('#scheduleEnd').value;
    if(!subject||!start||!end){showBreachWarning('CLASS DATA INCOMPLETE','Subject, start time, and end time are required.');return}
    if(minutes(end)<=minutes(start)){showBreachWarning('INVALID CLASS TIME','Class end time must be later than its start time.');return}
    if(minutes(start)<450||minutes(end)>1170){showBreachWarning('OUTSIDE DAYTIME WINDOW','Classes must remain between 7:30 AM and 7:30 PM.');return}
    const conflicting=activeSchedule().find(item=>item.id!==scheduleUi.editId&&Number(item.day)===day&&minutes(start)<minutes(item.end)&&minutes(end)>minutes(item.start));
    if(conflicting){showBreachWarning('SCHEDULE CONFLICT',`${subject} overlaps ${conflicting.subject}. Adjust the class time first.`);return}
    const entry=currentScheduleEntry();
    if(entry){
      const oldKey=subjectKey(entry.subject),newKey=subjectKey(subject),oldSubject=entry.subject;const oldSubjectStillLinked=activeSchedule().some(item=>item.id!==entry.id&&subjectKey(item.subject)===oldKey);
      Object.assign(entry,{subject,code,day,room,modality,start,end,active:true,updatedAt:new Date().toISOString()});
      if(oldKey!==newKey&&!oldSubjectStillLinked){
        state.academicTasks.filter(task=>task.subjectKey===oldKey).forEach(task=>{task.subjectKey=newKey;task.subjectName=subject});
        state.attendanceRecords.filter(record=>record.subjectKey===oldKey).forEach(record=>{record.subjectKey=newKey;record.subjectName=subject;record.code=code||record.code});
        state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'schedule',message:`Academic tasks and attendance relinked from ${oldSubject} to ${subject}.`});
      }
    }else state.classSchedule.push({id:S.uid('class'),subject,code,day,room,modality,start,end,active:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'schedule',message:`Class schedule saved: ${subject}, ${scheduleDayName(day)} ${start}-${end}.`});
    save();scheduleUi.day=day;scheduleUi.page=0;scheduleUi.editId=null;scheduleUi.isNew=false;renderScheduleOverview();showBreachWarning('SCHEDULE UPDATED',`${subject} now synchronizes with attendance, subject XP, and task tracking.`);
  };
  const deleteScheduleEntry=()=>{
    const entry=currentScheduleEntry();if(!entry)return;
    state.classSchedule=state.classSchedule.filter(item=>item.id!==entry.id);
    state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'schedule',message:`Class removed from future schedule: ${entry.subject}. Attendance, XP, and task history preserved.`});
    save();scheduleUi.day=Number(entry.day);scheduleUi.page=0;scheduleUi.editId=null;scheduleUi.isNew=false;renderScheduleOverview();showBreachWarning('CLASS DELETED',`${entry.subject} was removed from future meetings. Existing records were preserved.`);
  };

  const openEmergencyOverlay=source=>{if(!activeProtocolRecord()||!$('#emergencyOverlay').hidden)return;cancelHold();releaseWakeLock();$('#emergencyOverlay').hidden=false;$('#emergencyExitFill').style.width='0%';$('#emergencyOverlay').dataset.source=source;systemFeedback('emergency','Emergency override opened.')};
  const closeEmergencyOverlay=()=>{$('#emergencyOverlay').hidden=true;requestWakeLock()};
  const emergencyExit=()=>{
    const record=dayRecord(),protocol=activeProtocolRecord();if(!record||!protocol){closeEmergencyOverlay();return}
    const reason=$('#emergencyReason').value;protocol.emergencyReason=reason;state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'emergency',message:`Emergency override used during ${protocol.name}: ${reason}.`});
    if(reason==='technical'){save();closeEmergencyOverlay();showBreachWarning('TECHNICAL OVERRIDE RECORDED','The directive remains active and the fixed deadline continues.');return}
    closeEmergencyOverlay();failProtocol(record,protocol,`Emergency override used: ${reason}.`);renderApp();
  };
  const resetBrandEmergencyHold=()=>{const brand=$('#systemBrand');brand.classList.remove('emergency-arming');brand.style.setProperty('--emergency-progress','0deg');brand.style.setProperty('--emergency-glow','8px');brand.style.setProperty('--emergency-scale','1')};
  const startBrandEmergencyHold=()=>{if(!activeProtocolRecord())return;beginHold('brand',6000,progress=>{const brand=$('#systemBrand');brand.style.setProperty('--emergency-progress',`${progress*360}deg`);brand.style.setProperty('--emergency-glow',`${8+progress*16}px`);brand.style.setProperty('--emergency-scale',String(1+progress*.045));brand.classList.toggle('emergency-arming',progress>.02)},()=>{resetBrandEmergencyHold();openEmergencyOverlay('brand-hold')})};
  const armClockBackup=()=>{clockArmedUntil=Date.now()+6000;$('#clockPanel').classList.add('backup-armed');showBreachWarning('OVERRIDE GESTURE ARMED','Hold the clock for 3 seconds to open Emergency Override.');setTimeout(()=>{if(Date.now()>=clockArmedUntil)$('#clockPanel').classList.remove('backup-armed')},6100)};

  const revealUpdatePrompt=worker=>{
    if(!worker||waitingServiceWorker===worker)return;waitingServiceWorker=worker;
    const prompt=$('#updatePrompt');if(prompt){prompt.hidden=false;void prompt.offsetWidth;prompt.classList.add('update-show')}
    showSystemNotice('update','SYSTEM UPDATE READY','Refresh when you are ready to load the newest build.',3000);
  };
  const setupServiceWorker=()=>{
    if(!('serviceWorker' in navigator))return;
    navigator.serviceWorker.register('./service-worker.js').then(registration=>{
      if(registration.waiting&&navigator.serviceWorker.controller)revealUpdatePrompt(registration.waiting);
      registration.addEventListener('updatefound',()=>{
        const worker=registration.installing;if(!worker)return;
        worker.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)revealUpdatePrompt(worker)});
      });
      registration.update().catch(()=>{});
    }).catch(()=>{});
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(safeSession.get('ascend-update-reloading'))return;
      safeSession.set('ascend-update-reloading','1');
      safeSession.set('ascend-update-installed','1');
      location.reload();
    });
  };

  const wireEvents=()=>{
    $('#applyUpdate').addEventListener('click',()=>{
      if(!waitingServiceWorker)return;
      safeSession.remove('ascend-update-reloading');
      $('#applyUpdate').disabled=true;$('#applyUpdate').textContent='Applying';
      waitingServiceWorker.postMessage({type:'SKIP_WAITING'});
    });
    window.addEventListener('offline',()=>showSystemNotice('offline','OFFLINE MODE','ASCEND will continue using device storage.',3000));
    window.addEventListener('online',()=>showSystemNotice('online','CONNECTION RESTORED','Local operation remains synchronized.',2200));
    window.addEventListener('resize',updateOrientationGuard,{passive:true});
    window.addEventListener('orientationchange',()=>setTimeout(updateOrientationGuard,80),{passive:true});
    window.addEventListener('blur',()=>cancelHold());
    document.addEventListener('pointerup',()=>cancelHold());
    document.addEventListener('pointercancel',()=>cancelHold());
    $('#activateButton').addEventListener('click',()=>{const name=$('#playerName').value.trim();if(!name){$('#playerName').focus();return}state.player.name=name;state.initialized=true;state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'system',message:'Discipline System activated at Level 1.'});save();renderApp()});
    $('#earlyWakeButton').addEventListener('pointerdown',event=>{event.preventDefault();beginHold('early-wake',2000,progress=>{$('#earlyWakeFill').style.width=`${progress*100}%`},confirmEarlyWake)});
    ['pointerup','pointercancel','pointerleave'].forEach(type=>$('#earlyWakeButton').addEventListener(type,()=>cancelHold('early-wake')));
    $('#notYetButton').addEventListener('click',()=>{earlyWakeDismissedSession=true;haptic('tap');renderApp()});

    $('#actionButton').addEventListener('click',beginAction);
    $('#actionButton').addEventListener('pointerdown',event=>{const protocol=activeProtocolRecord(),task=currentStep(protocol);if(!task||task.type!=='hold'||$('#actionButton').disabled)return;event.preventDefault();beginHold('action',task.holdDuration||1800,progress=>{$('#holdFill').style.width=`${progress*100}%`},completeSubtask)});
    ['pointerup','pointercancel','pointerleave'].forEach(type=>$('#actionButton').addEventListener(type,()=>cancelHold('action')));
    $('#customTaskArea').addEventListener('click',handleCustomAction);

    $('#classConfirmButton').addEventListener('pointerdown',event=>{event.preventDefault();beginHold('class-confirm',1400,progress=>{$('#classConfirmFill').style.width=`${progress*100}%`},checkInClass)});
    ['pointerup','pointercancel','pointerleave'].forEach(type=>$('#classConfirmButton').addEventListener(type,()=>{cancelHold('class-confirm');$('#classConfirmFill').style.width='0%'}));
    $('#classScreen').addEventListener('click',event=>{const button=event.target.closest('[data-class-action]');if(button)handleClassAction(button.dataset.classAction)});

    $('#compactStatus').addEventListener('pointerdown',event=>{if($('#freeScreen').hidden||activeProtocolRecord()||classStateAt(new Date()))return;event.preventDefault();beginHold('schedule-access',5000,progress=>{$('#compactStatus').style.setProperty('--config-progress',`${progress*360}deg`)},()=>{$('#compactStatus').style.setProperty('--config-progress','0deg');openControlOverlay()})});
    ['pointerup','pointercancel','pointerleave'].forEach(type=>$('#compactStatus').addEventListener(type,()=>{cancelHold('schedule-access');$('#compactStatus').style.setProperty('--config-progress','0deg')}));
    $('#scheduleClose').addEventListener('click',closeScheduleOverlay);
    $('#openPlayerProfile').addEventListener('click',()=>{controlUi.profilePage=0;renderProfile()});
    $('#openAcademicControl').addEventListener('click',renderAcademicHome);
    $('#openDataBackup').addEventListener('click',()=>{backupUi={pending:null,fileName:''};renderDataBackup()});
    $('#openSystemIntegrity').addEventListener('click',renderSystemIntegrity);
    $('#academicBack').addEventListener('click',renderControlHome);
    $('#profileBack').addEventListener('click',renderControlHome);
    $('#attendanceBack').addEventListener('click',renderAcademicHome);
    $('#dataBackupBack').addEventListener('click',()=>{backupUi={pending:null,fileName:''};renderControlHome()});
    $('#systemIntegrityBack').addEventListener('click',renderControlHome);
    $('#verifyClock').addEventListener('click',verifyDeviceClock);
    $('#toggleNotifications').addEventListener('click',toggleNotifications);
    $('#toggleWakeLock').addEventListener('click',()=>{state.settings.keepAwake=!state.settings.keepAwake;if(!state.settings.keepAwake)releaseWakeLock();else if(activeProtocolRecord())requestWakeLock();save();renderSystemIntegrity()});
    $('#createIntegritySnapshot').addEventListener('click',()=>{S.createDailySnapshot(state,true);state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'snapshot',message:'Manual recovery snapshot created.'});save({silent:true});showSystemNotice('snapshot','SNAPSHOT CREATED','A known-good recovery point was stored locally.',2600);renderSystemIntegrity()});
    $('#restoreLatestSnapshot').addEventListener('click',restoreLatestSnapshot);
    $('#exportBackup').addEventListener('click',exportDataBackup);
    $('#chooseBackup').addEventListener('click',()=>$('#backupFileInput').click());
    $('#backupFileInput').addEventListener('change',event=>previewBackupFile(event.target.files?.[0]));
    $('#cancelBackupRestore').addEventListener('click',clearBackupPreview);
    $('#confirmBackupRestore').addEventListener('click',confirmBackupRestore);
    $('#scheduleConfigEdit').addEventListener('click',()=>{scheduleUi.day=defaultScheduleDay();scheduleUi.page=0;renderScheduleOverview()});
    $('#openAttendance').addEventListener('click',()=>{controlUi.attendanceTab='overall';controlUi.correction=false;renderAttendance()});
    $('#openScheduleExceptions').addEventListener('click',()=>{exceptionUi.index=0;renderScheduleExceptions()});
    $('#scheduleExceptionsBack').addEventListener('click',renderAcademicHome);
    $('#exceptionType').addEventListener('change',syncExceptionFields);
    $('#saveScheduleException').addEventListener('click',saveScheduleException);
    $('#exceptionPrev').addEventListener('click',()=>{exceptionUi.index=Math.max(0,exceptionUi.index-1);renderScheduleExceptions()});
    $('#exceptionNext').addEventListener('click',()=>{exceptionUi.index=Math.min(Math.max(0,sortedExceptions().length-1),exceptionUi.index+1);renderScheduleExceptions()});
    $('#deleteScheduleException').addEventListener('click',deleteScheduleException);

    $('#profileTabs').addEventListener('click',event=>{const button=event.target.closest('[data-profile-page]');if(!button)return;controlUi.profilePage=Number(button.dataset.profilePage);renderProfile()});
    $('#profilePrev').addEventListener('click',()=>{controlUi.profilePage=(controlUi.profilePage-1+profilePages.length)%profilePages.length;renderProfile()});
    $('#profileNext').addEventListener('click',()=>{controlUi.profilePage=(controlUi.profilePage+1)%profilePages.length;renderProfile()});
    $('#profileContent').addEventListener('click',event=>{
      const button=event.target.closest('[data-profile-action]');if(!button)return;const action=button.dataset.profileAction;
      if(action==='save-identity'){
        const name=$('#profileNameEdit')?.value.trim(),codename=$('#profileCodenameEdit')?.value.trim()||'',emblem=normalizeGlyph($('#profileEmblemEdit')?.value||'apex'),title=$('#profileTitleEdit')?.value||'Discipline Initiate';
        if(!name){showBreachWarning('NAME REQUIRED','Player name cannot be empty.');return}
        state.player.name=name;state.player.codename=codename;state.player.emblem=emblem;state.player.title=title;state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'profile',message:'Player identity updated.'});save();systemFeedback('clear','Profile saved.');renderProfile();return;
      }
      if(action==='directive-prev'){controlUi.directiveIndex=(controlUi.directiveIndex-1+protocolBlueprints.length)%protocolBlueprints.length;renderProfile();return}
      if(action==='directive-next'){controlUi.directiveIndex=(controlUi.directiveIndex+1)%protocolBlueprints.length;renderProfile();return}
      if(action==='achievement-prev'){controlUi.achievementPage=Math.max(0,controlUi.achievementPage-1);renderProfile();return}
      if(action==='achievement-next'){const total=Math.max(1,Math.ceil(achievementList().length/4));controlUi.achievementPage=Math.min(total-1,controlUi.achievementPage+1);renderProfile();return}
      if(action==='open-attendance'){controlUi.attendanceTab='overall';renderAttendance()}
    });

    $('#attendanceTabs').addEventListener('click',event=>{const button=event.target.closest('[data-attendance-tab]');if(!button)return;controlUi.attendanceTab=button.dataset.attendanceTab;controlUi.correction=false;renderAttendance()});
    $('#attendancePrev').addEventListener('click',()=>{if(controlUi.attendanceTab==='subjects')controlUi.subjectIndex=Math.max(0,controlUi.subjectIndex-1);else if(controlUi.attendanceTab==='history')controlUi.historyIndex=Math.max(0,controlUi.historyIndex-1);renderAttendance()});
    $('#attendanceNext').addEventListener('click',()=>{if(controlUi.attendanceTab==='subjects')controlUi.subjectIndex=Math.min(Math.max(0,subjectCatalog().length-1),controlUi.subjectIndex+1);else if(controlUi.attendanceTab==='history')controlUi.historyIndex=Math.min(Math.max(0,historyRecords().length-1),controlUi.historyIndex+1);renderAttendance()});
    $('#attendanceContent').addEventListener('click',event=>{
      const action=event.target.closest('[data-attendance-action]');if(action?.dataset.attendanceAction==='correct'){controlUi.correction=true;renderAttendance();return}
      const correction=event.target.closest('[data-correct-status]');if(correction){const record=historyRecords()[controlUi.historyIndex];if(record)correctAttendanceRecord(record,correction.dataset.correctStatus)}
    });

    $('#scheduleOverviewBack').addEventListener('click',renderAcademicHome);$('#scheduleBack').addEventListener('click',renderScheduleOverview);$('#scheduleSave').addEventListener('click',saveScheduleEntry);
    $('#scheduleAdd').addEventListener('click',()=>openScheduleEditor(null));
    $('#scheduleWeekTabs').addEventListener('click',event=>{const button=event.target.closest('[data-day]');if(!button)return;scheduleUi.day=Number(button.dataset.day);scheduleUi.page=0;renderScheduleOverview()});
    $('#scheduleClassList').addEventListener('click',event=>{const button=event.target.closest('[data-class-id]');if(button)openScheduleEditor(button.dataset.classId)});
    $('#schedulePagePrev').addEventListener('click',()=>{scheduleUi.page=Math.max(0,scheduleUi.page-1);renderScheduleOverview()});
    $('#schedulePageNext').addEventListener('click',()=>{scheduleUi.page+=1;renderScheduleOverview()});
    $('#scheduleDelete').addEventListener('pointerdown',event=>{if(!currentScheduleEntry())return;event.preventDefault();beginHold('schedule-delete',2200,progress=>{$('#scheduleDeleteFill').style.width=`${progress*100}%`},deleteScheduleEntry)});
    ['pointerup','pointercancel','pointerleave'].forEach(type=>$('#scheduleDelete').addEventListener(type,()=>{cancelHold('schedule-delete');$('#scheduleDeleteFill').style.width='0%'}));

    $('#scheduleOverlay').addEventListener('click',event=>{if(event.target===$('#scheduleOverlay'))closeScheduleOverlay()});
    $('#emergencyOverlay').addEventListener('click',event=>{if(event.target===$('#emergencyOverlay'))closeEmergencyOverlay()});
    document.querySelectorAll('.brand-mark-image,.system-emblem-image,.free-watermark,.state-watermark,.launch-splash img,.orientation-guard img').forEach(image=>{
      image.draggable=false;
      image.addEventListener('dragstart',event=>event.preventDefault());
      image.addEventListener('contextmenu',event=>event.preventDefault());
    });
    document.addEventListener('contextmenu',event=>{
      if(event.target.closest('.brand,.system-emblem,.free-watermark,.state-watermark,.hold-button,.compact-status,.glyph-frame'))event.preventDefault();
    });
    $('#systemBrand').addEventListener('pointerdown',event=>{event.preventDefault();startBrandEmergencyHold()});
    ['pointerup','pointercancel','pointerleave'].forEach(type=>$('#systemBrand').addEventListener(type,()=>{cancelHold('brand');resetBrandEmergencyHold()}));
    $('#clockPanel').addEventListener('click',()=>{clockTapCount+=1;clearTimeout(clockTapTimer);if(clockTapCount>=5){clockTapCount=0;armClockBackup();return}clockTapTimer=setTimeout(()=>{clockTapCount=0},1300)});
    $('#clockPanel').addEventListener('pointerdown',event=>{if(Date.now()>clockArmedUntil)return;event.preventDefault();beginHold('clock-backup',3000,()=>{},()=>{clockArmedUntil=0;$('#clockPanel').classList.remove('backup-armed');openEmergencyOverlay('clock-gesture')})});
    ['pointerup','pointercancel','pointerleave'].forEach(type=>$('#clockPanel').addEventListener(type,()=>cancelHold('clock-backup')));
    $('#completeRecovery').addEventListener('click',completeRecoveryProtocol);
    $('#returnDirectiveButton').addEventListener('click',closeEmergencyOverlay);
    $('#confirmEmergencyButton').addEventListener('pointerdown',event=>{event.preventDefault();beginHold('emergency-exit',3000,progress=>{$('#emergencyExitFill').style.width=`${progress*100}%`},emergencyExit)});
    ['pointerup','pointercancel','pointerleave'].forEach(type=>$('#confirmEmergencyButton').addEventListener(type,()=>cancelHold('emergency-exit')));

    document.querySelectorAll('[data-mastery]').forEach(button=>button.addEventListener('click',()=>{const choice=button.dataset.mastery;state.player.masteryChoice=choice==='graduate'?'Graduated from the System':choice==='maintenance'?'Maintenance Mode':'New Mastery Path';state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'mastery',message:state.player.masteryChoice});save();renderApp()}));
    document.addEventListener('keydown',event=>{
      if(event.key!=='Escape'||event.repeat)return;
      if(!$('#recoveryOverlay').hidden)return;
      if(!$('#emergencyOverlay').hidden){closeEmergencyOverlay();return}
      if(!$('#scheduleOverlay').hidden){closeScheduleOverlay();return}
      if(escapeTimer||!activeProtocolRecord())return;escapeTimer=setTimeout(()=>{escapeTimer=null;openEmergencyOverlay('escape-hold')},5000);
    });
    document.addEventListener('keyup',event=>{if(event.key==='Escape'&&escapeTimer){clearTimeout(escapeTimer);escapeTimer=null}});
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden){if(activeProtocolRecord()&&$('#emergencyOverlay').hidden&&$('#scheduleOverlay').hidden)lastVisibilityLoss=new Date();releaseWakeLock()}
      else{
        if(lastVisibilityLoss&&activeProtocolRecord()){
          const returned=new Date(),duration=Math.max(0,returned-lastVisibilityLoss),protocol=activeProtocolRecord();protocol.focusBreaches=(protocol.focusBreaches||0)+1;protocol.hiddenMilliseconds=(protocol.hiddenMilliseconds||0)+duration;
          state.logs.push({id:S.uid('log'),at:returned.toISOString(),type:'breach',message:`Focus breach during ${protocol.name}: ${Math.ceil(duration/60000)} minute(s).`});save();showBreachWarning('FOCUS BREACH RECORDED',`ASCEND was hidden for ${Math.max(1,Math.ceil(duration/60000))} minute(s). XP was reduced and the deadline continued.`);
        }
        lastVisibilityLoss=null;earlyWakeDismissedSession=false;renderApp();
      }
    });
    window.addEventListener('pageshow',renderApp);window.addEventListener('focus',renderApp);
  };

  const tick=()=>{
    updateClock();checkClockIntegrity();
    if(state.initialized&&state.integrity?.clockStatus==='trusted'&&Date.now()-integrityHeartbeatAt>=60000){integrityHeartbeatAt=Date.now();state.integrity.lastWallTime=new Date().toISOString();S.save(state)}
    if(orientationBlocked||holdSession||transitionLocked||!$('#scheduleOverlay').hidden)return;renderApp();
  };
  wireEvents();updateOrientationGuard();checkClockIntegrity();renderApp();dismissLaunchSplash();setupServiceWorker();
  if(state.system?.recoveredFrom){const source=state.system.recoveredFrom;state.system.recoveredFrom=null;save({silent:true});setTimeout(()=>showSystemNotice('restore','DATA RECOVERED',`Known-good state restored from ${source}.`,3800),950)}
  if(!navigator.onLine)setTimeout(()=>showSystemNotice('offline','OFFLINE MODE','ASCEND is operating from device storage.',2600),900);
  setInterval(tick,1000);
})();
