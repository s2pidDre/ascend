(function(){
  'use strict';
  const A=window.ASCEND;
  const S=A.storage;
  let state=S.load();
  let transitionLocked=false;
  let transitionTimer=null;
  let wakeLock=null;
  let earlyWakeDismissedSession=false;
  let holdSession=null;
  let brandHoldStartedAt=0;
  let brandHoldProtocolActive=false;
  let brandHoldDeveloperReady=false;
  let clockTapCount=0;
  let clockTapTimer=null;
  let clockArmedUntil=0;
  let clockHoldStartedAt=0;
  let clockHoldMode='';
  let clockSuppressClick=false;
  let escapeTimer=null;
  let scheduleUi={view:'home',day:new Date().getDay(),page:0,editId:null,isNew:false};
  let controlUi={view:'home',profilePage:0,profileMonth:null,profileDay:null,attendanceTab:'overall',subjectIndex:0,subjectAbsencePage:0,subjectFilter:'all',unverifiedIndex:0,unverifiedResolveId:null,attendanceEditId:null,historyIndex:0,correction:false,taskTab:'tasks',taskIndex:0,ruleIndex:0,dependencyIndex:0,rollbackIndex:0,directDeveloper:false,directProfile:false};
  let developerRunSession=null;
  let developerClockTimer=null;
  let conflictUi={index:0,issues:[]};
  const processedConfirmationTokens=new Set();
  let currentClassContext=null;
  let attendanceBackfillSignature='';
  let activeScreenId=null;
  let brandFlashTimer=null;
  let lastResultAnimationKey=null;
  let backupUi={pending:null,fileName:''};
  let settingsUi={pending:null,fileName:'',kind:''};
  let noticeTimer=null;
  let noticeHideTimer=null;
  let saveNoticeTimer=null;
  let lastSaveNoticeAt=0;
  let waitingServiceWorker=null;
  let launchDismissed=false;
  let orientationBlocked=false;
  let exceptionUi={index:0};
  let directiveUi={protocolId:null,stepId:null,isNew:false,isNewProtocol:false,draft:null,dirty:false,preview:false,restoreArmedUntil:0,deleteArmedUntil:0};
  let notificationSweepAt=0;
  let storageCheckAt=0;
  let advancedSyncDate='';
  let bootCompletionTimer=null;
  let timezonePromptShown=false;
  let customFormEditing=false;
  const BOOT_GUARD_KEY='ascend_boot_guard_v1';

  const $=selector=>document.querySelector(selector);
  const glyphNames=new Set(['apex','signal','sleep','wake','confirm','reset','water','shine','stretch','bath','meal','list','work','grid','trade','close','next','academic','success','failure','profile','data','lock','chevron-left','chevron-right','emergency','update','offline','save','shield','bell','calendar','recovery','clock','quest','lab','diagnostic','timezone','rollback','recurring','dependency','weekly']);
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
  const clone=value=>JSON.parse(JSON.stringify(value));
  const minutes=time=>{const[h,m]=time.split(':').map(Number);return h*60+m};
  const todayMinutes=date=>date.getHours()*60+date.getMinutes()+date.getSeconds()/60;
  const formatClock=date=>state.settings?.timeFormat==='24'?new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date):new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',hour12:true}).format(date);
  const formatDate=date=>new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric'}).format(date);
  const formatShortDate=value=>{const date=value instanceof Date?value:new Date(value);return Number.isNaN(date.getTime())?'Unknown':new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(date)};
  const formatTime=time=>{const d=new Date();const[h,m]=time.split(':').map(Number);d.setHours(h,m,0,0);return formatClock(d)};
  const timeOnDate=(date,time)=>{const d=new Date(date);const[h,m]=time.split(':').map(Number);d.setHours(h,m,0,0);return d};
  const minuteInWindow=(minute,start,end)=>start<=end?(minute>=start&&minute<end):(minute>=start||minute<end);
  const systemWakeTime=()=>blueprint('wake')?.start||'05:00';
  const systemDailyCutoff=(date=new Date())=>{const configs=protocolConfigsForDate(date);if(!configs.length)return blueprint('shutdown')?.end||'23:00';return configs.slice(1).reduce((latest,config)=>minutes(config.end)>minutes(latest)?config.end:latest,configs[0].end)};
  const earlyWakeStartMinute=()=>((minutes(systemWakeTime())-60)+1440)%1440;
  const isSleepWindow=date=>minuteInWindow(todayMinutes(date),minutes(systemDailyCutoff(date)),earlyWakeStartMinute());
  const isEarlyWakeWindow=date=>minuteInWindow(todayMinutes(date),earlyWakeStartMinute(),minutes(systemWakeTime()));
  const nextWakeMoment=date=>{const wake=timeOnDate(date,systemWakeTime()),minute=todayMinutes(date),wakeMinute=minutes(systemWakeTime());if(minute>=minutes(systemDailyCutoff(date))||minute>=wakeMinute)wake.setDate(wake.getDate()+1);return wake};
  const show=id=>{
    if(activeScreenId===id)return;
    const questOverlay=document.getElementById('dailyQuestOverlay');
    if(id!=='freeScreen'&&questOverlay)questOverlay.hidden=true;
    screens.forEach(screen=>{document.getElementById(screen).hidden=screen!==id});
    const screen=document.getElementById(id);
    screen?.classList.remove('screen-enter');
    if(screen){void screen.offsetWidth;screen.classList.add('screen-enter')}
    activeScreenId=id;
  };
  const noticeGlyphs={save:'save',backup:'data',restore:'confirm',offline:'offline',online:'signal',update:'update',installed:'success',snapshot:'data',alert:'bell',recovery:'recovery',diagnostic:'diagnostic'};
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
  const save=(options={})=>{reconcileStateMachine();const saved=S.save(state);if(!options.silent)queueSaveNotice();return saved};
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
  const protocolTransitions={pending:new Set(['active','failed','skipped']),active:new Set(['cleared','failed']),cleared:new Set(),failed:new Set(),skipped:new Set()};
  const stepTransitions={pending:new Set(['active','completed','skipped']),active:new Set(['completed','skipped']),completed:new Set(),skipped:new Set()};
  const transitionProtocol=(protocol,next,meta={})=>{
    if(!protocol||protocol.status===next)return protocol?.status===next;
    if(!protocolTransitions[protocol.status]?.has(next))return false;
    protocol.status=next;
    if(next==='active')protocol.startedAt=protocol.startedAt||meta.at||new Date().toISOString();
    if(['cleared','failed','skipped'].includes(next))protocol.completedAt=protocol.completedAt||meta.at||new Date().toISOString();
    if(next==='failed'){protocol.earnedXp=0;protocol.failureReason=meta.reason||protocol.failureReason||'Protocol failed.'}
    if(next==='skipped'){protocol.earnedXp=0;protocol.excused=meta.excused!==false;protocol.skipReason=meta.reason||protocol.skipReason||'Skipped for today.'}
    return true;
  };
  const transitionStep=(step,next,at=new Date().toISOString())=>{
    if(!step||step.status===next)return step?.status===next;
    if(!stepTransitions[step.status]?.has(next))return false;
    step.status=next;
    if(next==='active')step.startedAt=step.startedAt||at;
    if(next==='completed'){step.startedAt=step.startedAt||at;step.completedAt=step.completedAt||at}
    if(next==='skipped'){step.completedAt=step.completedAt||at}
    return true;
  };
  const reconcileStateMachine=()=>{
    Object.values(state.dayRecords||{}).forEach(day=>{
      const protocols=Object.values(day.protocols||{});let activeFound=false;
      protocols.sort((a,b)=>String(a.startedAt||'').localeCompare(String(b.startedAt||''))).forEach(protocol=>{
        if(!['pending','active','cleared','failed','skipped'].includes(protocol.status))protocol.status='pending';
        if(protocol.status==='active'){if(activeFound)protocol.status='pending';else activeFound=true}
        (protocol.steps||[]).forEach(step=>{if(!['pending','active','completed','skipped'].includes(step.status))step.status='pending'});
        if(protocol.status==='cleared')(protocol.steps||[]).forEach(step=>{if(!['completed','skipped'].includes(step.status))transitionStep(step,'completed',protocol.completedAt||new Date().toISOString())});
      });
      day.completedProtocols=protocols.filter(protocol=>protocol.status==='cleared').length;
      day.failedProtocols=protocols.filter(protocol=>protocol.status==='failed').length;
    });
  };
  const recordMoment=(record,time)=>new Date(`${record.date}T${time}:00`);
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
  const isWeeklyBossDate=date=>date.getDay()===6;
  const variants=(...copy)=>copy;

  const protocolDefaults=[
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
      id:'workout',short:'WORKOUT',name:'Workout Protocol',icon:'stretch',start:'08:00',end:'09:30',xp:150,
      prep:'Prepare after breakfast. Complete the Workout Dungeon, five-minute cooldown, shower, and final confirmation before 9:30 AM. The directive is active only on Tuesday, Wednesday, Friday, and Saturday when no class window conflicts.',
      subtasks:()=>[
        {id:'workout-prepare',title:'Prepare',copy:variants('Change into training clothes, prepare water, and make the workout space ready.','Prepare your body, water, and training area before beginning the dungeon.'),icon:'list',type:'hold'},
        {id:'workout-dungeon',title:'Workout Dungeon',copy:variants('Train for at least fifteen minutes. End the dungeon whenever the workout is actually finished; forty-five minutes is the recommended upper target.','Complete a real 15–45 minute training session. Duration beyond fifteen minutes does not increase XP.'),icon:'stretch',type:'workout',minDuration:15,recommendedMax:45},
        {id:'workout-cooldown',title:'5-Minute Cooldown Dungeon',copy:variants('Recover, hydrate, breathe, and stretch for five minutes.','Complete five minutes of controlled cooldown before showering.'),icon:'water',type:'timer',duration:5,autoComplete:true},
        {id:'workout-shower',title:'Shower & Recover',copy:variants('Shower, change into clean clothes, hydrate, and finish your immediate post-workout recovery.','Clean up after training and prepare for the rest of the day.'),icon:'bath',type:'hold'},
        {id:'workout-confirm',title:'Confirm Done',copy:variants('Confirm the workout, cooldown, and shower are complete.','Finish the Workout Protocol and record the clear.'),icon:'success',type:'tap'}
      ]
    },
    {
      id:'dinner',short:'DINNER',name:'Dinner Protocol',icon:'meal',start:'20:00',end:'20:30',xp:90,
      prep:'Prepare dinner before the fixed window so the evening schedule remains protected.',
      subtasks:()=>[
        {id:'dinner-prepare',title:'Prepare dinner',copy:variants('Prepare the evening meal without delaying the protocol.','Begin dinner preparation.'),icon:'list',type:'hold'},
        {id:'dinner-eat',title:'Eat the full meal',copy:variants('Complete the evening meal within the fixed window.','Finish your dinner.'),icon:'meal',type:'hold'},
        {id:'dinner-water',title:'Drink one glass of water',copy:variants('Complete hydration with dinner.','Drink one full glass of water.'),icon:'water',type:'hold'},
        {id:'dinner-quality',title:'Confirm nutrition standard',copy:variants('Confirm that dinner included protein and enough food for recovery and healthy weight gain.','Confirm the meal supported recovery.'),icon:'success',type:'tap'}
      ]
    },
    {
      id:'productivity',short:'WORK',name:'Productivity Protocol',icon:'work',start:'20:30',end:'22:00',xp:180,
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
      id:'shutdown',short:'SLEEP',name:'Shutdown Protocol',icon:'sleep',start:'22:00',end:'23:00',xp:120,
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

  const directiveDefaultDays={wake:[0,1,2,3,4,5,6],breakfast:[0,1,2,3,4,5,6],workout:[2,3,5,6],dinner:[0,1,2,3,4,5,6],productivity:[0,1,2,3,4,5,6],shutdown:[0,1,2,3,4,5,6]};
  const directiveSystemRoles={wake:'wake',workout:'workout',productivity:'productivity',shutdown:'shutdown'};
  const directiveCoreProtocols=new Set(Object.keys(directiveSystemRoles));
  const directiveLinkedSteps=new Set(['wake-confirm','bath','workout-dungeon','workout-cooldown','subject-audit','execution-plan','trading-review']);
  const directiveStandardTypes=new Set(['tap','hold','timer']);
  const directivePriorityWeight={high:3,normal:2,low:1};
  const protocolDefaultById=id=>protocolDefaults.find(protocol=>protocol.id===id)||null;
  const automaticProtocolXp=def=>{
    const steps=(def.subtasks||[]).filter(step=>step.enabled!==false),required=steps.filter(step=>step.required!==false).length;
    const timerMinutes=steps.reduce((sum,step)=>sum+(step.type==='timer'?Number(step.duration||0):step.type==='workout'?Number(step.minDuration||0):0),0);
    return clamp(Math.round(30+required*14+timerMinutes*2),30,300);
  };
  const directiveProtocolDefinition=id=>{
    const base=protocolDefaultById(id),override=state.directiveConfig?.protocols?.[id]||{};
    if(!base&&!Object.keys(override).length)return null;
    const custom=!base;
    const defaultSteps=base?base.subtasks(state.player.level).map(step=>({...clone(step),enabled:true,required:true,allowSkip:step.type==='timer',perfectRequired:true})):[];
    const steps=Array.isArray(override.subtasks)?clone(override.subtasks):defaultSteps;
    const def={
      id:base?.id||id,custom,systemRole:base?(directiveSystemRoles[id]||'standard'):'standard',
      enabled:override.enabled!==false,required:override.required!==false,
      name:override.name||base?.name||'Custom Protocol',short:override.short||base?.short||'CUSTOM',prep:override.prep||base?.prep||'Complete each enabled directive during this protocol window.',icon:normalizeGlyph(override.icon||base?.icon||'apex'),
      start:override.start||base?.start||'12:00',end:override.end||base?.end||'13:00',
      activeDays:Array.isArray(override.activeDays)?clone(override.activeDays):clone(directiveDefaultDays[id]||[0,1,2,3,4,5,6]),
      schedulingMode:['fixed','flexible'].includes(override.schedulingMode)?override.schedulingMode:'fixed',priority:['high','normal','low'].includes(override.priority)?override.priority:(id==='wake'||id==='shutdown'?'high':'normal'),
      allowSkipToday:override.allowSkipToday!==false,xpMode:['automatic','custom'].includes(override.xpMode)?override.xpMode:(base?'custom':'automatic'),xp:clamp(Number(override.xp||base?.xp||100),10,500),
      subtasks:steps.map(step=>({...step,enabled:step.enabled!==false,required:step.required!==false,allowSkip:step.allowSkip===true||step.type==='timer',perfectRequired:step.perfectRequired!==false}))
    };
    if(def.xpMode==='automatic')def.xp=automaticProtocolXp(def);
    return def;
  };
  const directiveProtocolIds=()=>[...new Set([...protocolDefaults.map(item=>item.id),...Object.keys(state.directiveConfig?.protocols||{})])];
  const buildDirectiveBlueprints=()=>directiveProtocolIds().map(id=>directiveProtocolDefinition(id)).filter(Boolean).map(def=>{const enabledSteps=def.subtasks.filter(step=>step.enabled!==false).map(step=>clone(step));return{...def,subtasks:()=>clone(enabledSteps)}}).sort((a,b)=>minutes(a.start)-minutes(b.start)||(directivePriorityWeight[b.priority]||2)-(directivePriorityWeight[a.priority]||2)||a.name.localeCompare(b.name));
  let protocolBlueprints=buildDirectiveBlueprints();
  const refreshDirectiveBlueprints=()=>{protocolBlueprints=buildDirectiveBlueprints()};
  const blueprint=id=>protocolBlueprints.find(protocol=>protocol.id===id);
  const dayRecord=()=>state.dayRecords[currentKey()]||null;
  const activeProtocolRecord=()=>{
    const record=dayRecord();
    return record?Object.values(record.protocols).find(protocol=>protocol.status==='active')||null:null;
  };
  const subjectKey=value=>String(value||'').trim().toLowerCase();
  const activeSchedule=()=>state.classSchedule.filter(entry=>entry.active!==false);
  const scheduleEntryStartKey=entry=>entry?.effectiveFrom||(entry?.createdAt?S.dateKey(new Date(entry.createdAt)):null);
  const scheduleEntryActiveOnDate=(entry,key)=>{const start=scheduleEntryStartKey(entry),end=entry?.effectiveTo||null;return(!start||key>=start)&&(!end||key<end)};
  const applyScheduleExceptions=(entries,date)=>{
    const key=S.dateKey(date),exceptions=(state.scheduleExceptions||[]).filter(item=>item.active!==false&&item.date===key);
    if(exceptions.some(item=>item.type==='no-classes'))return[];
    let result=entries.map(entry=>({...entry}));
    exceptions.forEach(exception=>{
      if(exception.type==='cancel')result=result.filter(entry=>entry.id!==exception.classId&&entry.classId!==exception.classId);
      if(['reschedule','special'].includes(exception.type))result=result.map(entry=>(entry.id===exception.classId||entry.classId===exception.classId)?{...entry,start:exception.start||entry.start,end:exception.end||entry.end,exceptionType:exception.type}:entry);
    });
    return result.sort((a,b)=>minutes(a.start)-minutes(b.start));
  };
  const effectiveScheduleForDate=date=>applyScheduleExceptions(activeSchedule().filter(entry=>Number(entry.day)===date.getDay()),date);
  const historicalScheduleForDate=date=>{
    const key=S.dateKey(date),versions=[...(state.scheduleHistory||[]),...(state.classSchedule||[])];
    const entries=versions.filter(entry=>scheduleEntryActiveOnDate(entry,key)&&Number(entry.day)===date.getDay()).map(entry=>({...entry,id:entry.classId||entry.id,classId:entry.classId||entry.id}));
    const deduped=[];const seen=new Set();entries.sort((a,b)=>String(b.effectiveFrom||'').localeCompare(String(a.effectiveFrom||''))).forEach(entry=>{const id=entry.classId||entry.id;if(seen.has(id))return;seen.add(id);deduped.push(entry)});
    return applyScheduleExceptions(deduped,date);
  };
  const workoutHasClassConflict=date=>{
    const workout=blueprint('workout');if(!workout||workout.enabled===false)return false;
    return effectiveScheduleForDate(date).some(entry=>{
      const classPriorityStart=minutes(entry.start)-15;
      return classPriorityStart<minutes(workout.end)&&minutes(entry.end)>minutes(workout.start);
    });
  };
  const protocolEligibleForDate=(config,date)=>Boolean(config&&config.enabled!==false&&(config.activeDays||directiveDefaultDays[config.id]||[]).includes(date.getDay())&&(config.systemRole!=='workout'||!workoutHasClassConflict(date)));
  const protocolConfigsForDate=date=>protocolBlueprints.filter(config=>protocolEligibleForDate(config,date));
  const protocolConfigsForRecord=record=>protocolBlueprints.filter(config=>Boolean(record?.protocols?.[config.id]));
  const requiredProtocolCountForRecord=record=>Object.values(record?.protocols||{}).filter(protocol=>protocol?.required!==false&&!protocol?.excused).length;
  const protocolStepsForDate=(config,date)=>{
    const steps=config.subtasks(state.player.level);
    if(config.id==='wake'&&protocolEligibleForDate(blueprint('workout'),date))return steps.filter(step=>step.id!=='bath');
    return steps;
  };
  const makeProtocolState=(config,weeklyBoss=false,date=new Date())=>({
    id:config.id,name:config.name,start:config.start,end:config.end,xp:config.xp,
    status:'pending',required:config.required!==false,schedulingMode:config.schedulingMode||'fixed',priority:config.priority||'normal',allowSkipToday:config.allowSkipToday!==false,steps:protocolStepsForDate(config,date).map(step=>({...step,status:'pending',startedAt:null,completedAt:null})),startedAt:null,completedAt:null,earnedXp:0,excused:false,hadRequiredSkip:false,
    boss:weeklyBoss&&config.systemRole==='productivity',resolutionKey:null
  });
  const syncWorkoutStepShape=protocol=>{
    if(!protocol||!['pending','active'].includes(protocol.status))return false;
    const config=blueprint('workout'),existing=new Map((protocol.steps||[]).map(step=>[step.id,step]));
    const desired=config.subtasks(state.player.level).map(step=>{
      const previous=existing.get(step.id);
      return previous?{...step,...previous,id:step.id,title:step.title,copy:step.copy,icon:step.icon,type:step.type,minDuration:step.minDuration,recommendedMax:step.recommendedMax,duration:step.duration,autoComplete:step.autoComplete}:{...step,status:'pending',startedAt:null,completedAt:null};
    });
    const before=(protocol.steps||[]).map(step=>step.id).join('|'),after=desired.map(step=>step.id).join('|');
    const timingChanged=protocol.start!==config.start||protocol.end!==config.end;
    if(before===after&&!timingChanged)return false;
    protocol.steps=desired;protocol.start=config.start;protocol.end=config.end;protocol.name=config.name;protocol.xp=config.xp;return true;
  };
  const syncWakeBathForWorkout=record=>{
    const wake=record?.protocols?.wake;if(!wake||!['pending','active'].includes(wake.status))return false;
    const workoutRequired=Boolean(record.protocols?.workout),bathIndex=(wake.steps||[]).findIndex(step=>step.id==='bath');
    if(workoutRequired&&bathIndex>=0){wake.steps.splice(bathIndex,1);return true}
    if(!workoutRequired&&bathIndex<0){
      const bath=blueprint('wake').subtasks(state.player.level).find(step=>step.id==='bath');
      if(bath){wake.steps.push({...bath,status:'pending',startedAt:null,completedAt:null});return true}
    }
    return false;
  };
  const syncConditionalProtocols=(record,now=new Date())=>{
    if(!record||record.status!=='active'||record.date!==S.dateKey(now))return false;
    const workout=record.protocols?.workout,eligible=protocolEligibleForDate(blueprint('workout'),now);let changed=false;
    if(workout&&!eligible&&['pending','active'].includes(workout.status)){
      delete record.protocols.workout;record.completedProtocols=Object.values(record.protocols).filter(item=>item.status==='cleared').length;record.failedProtocols=Object.values(record.protocols).filter(item=>item.status==='failed').length;changed=true;
      state.logs.push({id:S.uid('log'),at:now.toISOString(),type:'schedule',message:'Workout Protocol suppressed because a class window takes priority.'});
    }
    if(!record.protocols?.workout&&eligible&&todayMinutes(now)<minutes(blueprint('workout').start)){
      record.protocols.workout=makeProtocolState(blueprint('workout'),record.weeklyBoss,now);changed=true;
      state.logs.push({id:S.uid('log'),at:now.toISOString(),type:'protocol',message:'Workout Protocol added to today’s configured sequence.'});
    }
    if(syncWorkoutStepShape(record.protocols?.workout))changed=true;
    if(syncWakeBathForWorkout(record))changed=true;
    return changed;
  };
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
    const requiredSkips=recent.reduce((sum,day)=>sum+Object.values(day.protocols||{}).reduce((count,protocol)=>count+(protocol.hadRequiredSkip?1:0),0),0);
    const pending=state.academicTasks.filter(task=>task.status!=='completed').length;
    const absences=state.attendanceRecords.filter(record=>record.scheduledDate>=cutoffKey&&record.scheduledDate<key&&['absent','unverified'].includes(record.status)).length;
    if(morningFailures>=2)return{id:'dawn-chain',title:'Dawn Chain',copy:'Clear Wake and Breakfast on time, then complete the full day.',requirements:['Wake on time','Breakfast on time','Full day clear']};
    if(absences>=1)return{id:'attendance-lock',title:'Attendance Lock',copy:'Resolve every scheduled class and complete the full day without an absence.',requirements:['No absent class','No unresolved class','Full day clear']};
    if(pending>=2)return{id:'deadline-hunter',title:'Deadline Hunter',copy:'Complete at least one academic task during Productivity and clear the full day.',requirements:['Complete one task','Productivity clear','Full day clear'],baselineCompleted:state.academicTasks.filter(task=>task.status==='completed').length};
    if(requiredSkips>=2)return{id:'full-sequence',title:'Full Sequence',copy:'Clear the required Saturday sequence without skipping any required directive.',requirements:['Full day clear','No required directive skips']};
    return{id:'perfect-sequence',title:'Perfect Sequence',copy:'Achieve a Perfect Clear across the complete Saturday sequence.',requirements:['Required protocols on time','No required directive skips','Full day clear']};
  };
  const rankTrialPlanFor=rank=>{
    const plans={
      D:{rank:'D',attendance:0,streak:0,bosses:0,perfect:false,onTime:80},C:{rank:'C',attendance:75,streak:2,bosses:0,perfect:true,onTime:90},B:{rank:'B',attendance:80,streak:3,bosses:1,perfect:true,onTime:90},A:{rank:'A',attendance:90,streak:5,bosses:1,perfect:true,onTime:100},S:{rank:'S',attendance:95,streak:7,bosses:2,perfect:true,onTime:100}
    };return plans[rank]||null;
  };
  const bossClearCount=()=>Object.values(state.dayRecords||{}).filter(day=>day.weeklyBossCleared).length;
  const recordHasRequiredSkip=record=>Object.values(record?.protocols||{}).some(protocol=>protocol?.hadRequiredSkip||(protocol?.steps||[]).some(step=>step.required!==false&&step.status==='skipped'));
  const evaluateWeeklyBoss=(record,cleared)=>{
    if(!record.weeklyBoss||!record.weeklyBossPlan||!cleared)return false;const plan=record.weeklyBossPlan;
    if(plan.id==='dawn-chain')return ['wake','breakfast'].every(id=>record.protocols[id]?.status==='cleared'&&protocolOnTime(record,record.protocols[id]));
    if(plan.id==='attendance-lock')return !state.attendanceRecords.some(item=>item.scheduledDate===record.date&&['absent','unverified'].includes(item.status));
    if(plan.id==='deadline-hunter')return state.academicTasks.filter(task=>task.status==='completed').length>Number(plan.baselineCompleted||0)&&record.protocols.productivity?.status==='cleared';
    if(plan.id==='full-sequence')return !recordHasRequiredSkip(record);
    return record.onTimePercentage===100&&!recordHasRequiredSkip(record);
  };
  const evaluateRankTrial=record=>{const plan=record.rankTrialPlan;if(!plan)return false;const academic=overallAcademicStats();return record.status==='cleared'&&record.onTimePercentage>=plan.onTime&&(!plan.perfect||record.perfectClear)&&academic.attendanceRate>=plan.attendance&&state.player.streak>=plan.streak&&bossClearCount()>=plan.bosses};

  const createDayRecord=(date=new Date())=>{
    const key=S.dateKey(date);
    if(state.dayRecords[key])return state.dayRecords[key];
    const protocols={};
    const weeklyBoss=isWeeklyBossDate(date);
    const weeklyBossPlan=weeklyBoss?buildWeeklyBossPlan(date):null;
    const rankTrialPlan=state.player.pendingRank?rankTrialPlanFor(state.player.pendingRank):null;
    protocolConfigsForDate(date).forEach(config=>{protocols[config.id]=makeProtocolState(config,weeklyBoss,date)});
    const record={
      date:key,status:'active',createdAt:new Date().toISOString(),protocols,completedProtocols:0,failedProtocols:0,
      wakeCheckInAt:null,wakeStatus:null,totalXp:0,onTimePercentage:0,automaticReward:null,
      weeklyBoss,weeklyBossPlan,weeklyBossCleared:false,perfectClear:false,rankTrialActive:Boolean(rankTrialPlan),rankTrialPlan,rankAdvanced:false,rankTrialFailed:false,
      rewardApplied:false,
      timezone:{name:state.timezone?.name||S.timezoneName(),offset:state.timezone?.offset??S.timezoneOffset()}
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
    state.logs.push({id:S.uid('log'),at:now.toISOString(),type:'protocol',message:`${config.name} started.`});
    save();systemFeedback(protocol.boss?'boss':'start',protocol.boss?'Weekly Boss issued.':'Directive issued.',`start-${record.date}-${config.id}`);
    return protocol;
  };

  const recordWakeCheckIn=(record,now,source)=>{
    if(record.wakeCheckInAt)return;
    record.wakeCheckInAt=now.toISOString();
    const wakeConfig=blueprint('wake'),minute=todayMinutes(now),wakeStart=minutes(wakeConfig?.start||'05:00');
    record.wakeStatus=minute<wakeStart?'early':minute<=wakeStart+30?'on-time':'late';
    const protocol=startProtocol(record,wakeConfig,now);
    const first=protocol?.steps?.[0];if(first?.type==='system')transitionStep(first,'completed',now.toISOString());
    state.logs.push({id:S.uid('log'),at:now.toISOString(),type:'wake',message:`Wake recorded at ${formatClock(now)} (${record.wakeStatus}, ${source}).`});
    save();systemFeedback('start',record.wakeStatus==='late'?'Late wake recorded. Begin immediately.':'Wake state confirmed.',`wake-${record.date}`);
  };

  const protocolOnTime=(record,protocol)=>{
    if(protocol.id==='wake')return ['early','on-time'].includes(record.wakeStatus);
    if(!protocol.startedAt)return false;
    if(protocol.schedulingMode==='flexible')return new Date(protocol.startedAt)<recordMoment(record,protocol.end);
    return new Date(protocol.startedAt)<=new Date(timeOnDate(new Date(protocol.startedAt),protocol.start).getTime()+10*60000);
  };

  const calculateProtocolXp=(record,protocol)=>{const lateFactor=protocolOnTime(record,protocol)?1:.85;return Math.round(protocol.xp*lateFactor*(protocol.boss?1.35:1))};
  const creditProtocolProfileXp=(protocol,when=new Date())=>{
    if(!protocol||protocol.status!=='cleared')return 0;
    const target=Math.max(0,Number(protocol.earnedXp||0)),applied=Math.max(0,Number(protocol.profileXpAppliedAmount||0)),delta=Math.max(0,target-applied);
    if(!delta)return 0;
    state.player.totalXp=Math.max(0,Number(state.player.totalXp||0)+delta);protocol.profileXpAppliedAmount=target;protocol.profileXpAppliedAt=when.toISOString();return delta;
  };
  const syncAttendanceProfileXp=(record,when=new Date())=>{
    if(!record)return 0;
    const target=record.finalized?Math.max(0,Number(record.xpAwarded||0)):0,applied=Math.max(0,Number(record.profileXpAppliedAmount||0)),delta=target-applied;
    if(!delta)return 0;
    state.player.totalXp=Math.max(0,Number(state.player.totalXp||0)+delta);record.profileXpAppliedAmount=target;record.profileXpAppliedAt=when.toISOString();return delta;
  };
  const PROFILE_XP_RECONCILIATION_VERSION=55;
  const reconcileCurrentDayProfileXp=()=>{
    state.system=state.system||{};
    const previous=state.system.profileXpReconciliation||{};
    if(Number(previous.version||0)>=PROFILE_XP_RECONCILIATION_VERSION)return 0;
    const now=new Date(),date=S.dateKey(now),day=state.dayRecords?.[date];
    let repairedMarkers=0,directiveXp=0,attendanceXp=0;
    if(day){
      const legacyWholeDayPaid=day.status==='cleared'&&Boolean(day.rewardApplied);
      Object.values(day.protocols||{}).forEach(protocol=>{
        if(protocol?.status!=='cleared')return;
        const target=Math.max(0,Number(protocol.earnedXp||0));if(!target)return;
        const applied=Math.max(0,Number(protocol.profileXpAppliedAmount||0));
        if(applied>=target&&!protocol.profileXpAppliedAt&&!legacyWholeDayPaid){protocol.profileXpAppliedAmount=0;repairedMarkers+=1}
        directiveXp+=creditProtocolProfileXp(protocol,now);
      });
    }
    state.attendanceRecords.filter(record=>record?.scheduledDate===date&&record.finalized).forEach(record=>{
      const target=Math.max(0,Number(record.xpAwarded||0));if(!target)return;
      const applied=Math.max(0,Number(record.profileXpAppliedAmount||0));
      if(applied>=target&&!record.profileXpAppliedAt){record.profileXpAppliedAmount=0;repairedMarkers+=1}
      attendanceXp+=syncAttendanceProfileXp(record,now);
    });
    const recovered=directiveXp+attendanceXp;
    state.system.profileXpReconciliation={version:PROFILE_XP_RECONCILIATION_VERSION,completedAt:now.toISOString(),date,repairedMarkers,recoveredDirectiveXp:directiveXp,recoveredAttendanceXp:attendanceXp,status:'complete'};
    state.logs.push({id:S.uid('log'),at:now.toISOString(),type:'migration',message:`Profile XP reconciliation completed for ${date}.${repairedMarkers?` ${repairedMarkers} unproven legacy XP marker${repairedMarkers===1?'':'s'} repaired.`:''}${recovered?` ${recovered} XP added to Profile.`:''}`});
    save({silent:true});
    if(recovered)setTimeout(()=>showSystemNotice('restore','PROFILE XP RECOVERED',`+${recovered} XP synchronized from today.`,2800),250);
    return recovered;
  };
  const pendingProfileXp=()=>Object.values(state.dayRecords||{}).some(day=>Object.values(day.protocols||{}).some(protocol=>protocol?.status==='cleared'&&Number(protocol.earnedXp||0)>Number(protocol.profileXpAppliedAmount||0)))||state.attendanceRecords.some(record=>(record.finalized?Number(record.xpAwarded||0):0)!==Number(record.profileXpAppliedAmount||0));

  const showOverlay=(eyebrow,title,value,duration=900)=>new Promise(resolve=>{
    clearTimeout(transitionTimer);transitionLocked=true;
    $('#overlayEyebrow').textContent=eyebrow;$('#overlayTitle').textContent=title;$('#overlayValue').textContent=value||'';
    $('#systemOverlay').hidden=false;
    transitionTimer=setTimeout(()=>{$('#systemOverlay').hidden=true;transitionLocked=false;resolve()},duration);
  });

  const clearProtocol=async(record,protocol)=>{
    const completedAt=new Date().toISOString();if(!transitionProtocol(protocol,'cleared',{at:completedAt}))return;protocol.completedAt=completedAt;protocol.resolutionKey=protocol.resolutionKey||`${record.date}:${protocol.id}:cleared`;protocol.earnedXp=calculateProtocolXp(record,protocol);
    record.completedProtocols+=1;
    const creditedXp=creditProtocolProfileXp(protocol,new Date(completedAt));
    state.logs.push({id:S.uid('log'),at:protocol.completedAt,type:'clear',message:`${protocol.name} cleared for ${protocol.earnedXp} XP${creditedXp?' · added to Profile':''}.`});
    save();
    const config=blueprint(protocol.id);
    show('protocolResultScreen');
    $('#protocolResultEmblem').classList.remove('failed');setGlyph('protocolResultEmblem','success');
    $('#protocolResultEyebrow').textContent=protocol.boss?'WEEKLY BOSS DEFEATED':'PROTOCOL CLEARED';
    $('#protocolResultTitle').textContent=`${protocol.name} Complete`;
    $('#protocolResultMessage').textContent=protocol.hadRequiredSkip?'Protocol cleared with a required directive skipped. Perfect Clear remains unavailable today.':'The protocol sequence was resolved before its deadline.';
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
    if(!protocol||['cleared','failed','skipped'].includes(protocol.status))return false;
    const at=new Date().toISOString();if(!transitionProtocol(protocol,'failed',{at,reason}))return false;
    protocol.completedAt=at;protocol.resolutionKey=protocol.resolutionKey||`${record.date}:${protocol.id}:failed`;protocol.earnedXp=0;protocol.failureReason=reason;
    record.failedProtocols=Object.values(record.protocols).filter(item=>item.status==='failed').length;
    if(log)state.logs.push({id:S.uid('log'),at,type:'failure',message:`${protocol.name} failed: ${reason}`});
    if(!options.defer){save();systemFeedback('warning','Protocol failed.',`failed-${record.date}-${protocol.id}`)}return true;
  };

  const evaluateDeadlines=(record,now=new Date())=>{
    if(!record||record.status!=='active')return;let resolvedCount=0;
    protocolConfigsForRecord(record).forEach(config=>{const protocol=record.protocols[config.id];if(!protocol||['cleared','failed','skipped'].includes(protocol.status))return;if(now>=recordMoment(record,config.end)){if(protocol.required===false){transitionProtocol(protocol,'skipped',{at:now.toISOString(),reason:'Optional protocol window ended.',excused:true});state.logs.push({id:S.uid('log'),at:now.toISOString(),type:'protocol',message:`${protocol.name} skipped when its optional window ended.`});resolvedCount+=1}else if(failProtocol(record,protocol,'The protocol deadline passed before the sequence was resolved.',true,{defer:true}))resolvedCount+=1}});
    if(resolvedCount){save();systemFeedback('warning',`${resolvedCount} protocol window${resolvedCount===1?'':'s'} resolved.`,`deadline-reconcile-${record.date}-${resolvedCount}`)}
  };

  const calculateOnTimePercentage=record=>{let onTime=0;const configs=protocolConfigsForRecord(record).filter(config=>{const protocol=record.protocols[config.id];return protocol?.required!==false&&!protocol?.excused});configs.forEach(config=>{if(protocolOnTime(record,record.protocols[config.id]))onTime+=1});return configs.length?Math.round(onTime/configs.length*100):100};

  const chooseReward=record=>{
    if(record.perfectClear)return 'Perfect Clear reward: an extended guilt-free leisure period.';
    if(record.weeklyBossCleared)return 'Weekly Boss reward: one extended recovery or hobby session.';
    return 'Daily Clear reward: a planned leisure period after all obligations are complete.';
  };

  const applyClearedDayRewards=(record,now=new Date())=>{
    if(record.rewardApplied)return false;
    const xp=Number(record.baseXp??Object.values(record.protocols).reduce((sum,protocol)=>sum+Number(protocol.earnedXp||0),0));
    Object.values(record.protocols).forEach(protocol=>creditProtocolProfileXp(protocol,now));
    state.player.streak+=1;state.player.bestStreak=Math.max(state.player.bestStreak,state.player.streak);
    state.player.totalClearDays+=1;state.player.levelClearDays+=1;
    record.totalXp=xp;record.rewardApplied=true;record.rewardReleasedAt=now.toISOString();
    if(record.perfectClear){state.player.perfectClears=(state.player.perfectClears||0)+1;state.player.lastPerfectDate=record.date}
    if(record.rankTrialActive&&!record.rankTrialResolved){
      state.player.rankTrialAttempts=(state.player.rankTrialAttempts||0)+1;
      if(evaluateRankTrial(record)&&state.player.pendingRank){state.player.rank=state.player.pendingRank;state.player.pendingRank=null;record.rankAdvanced=true}
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
  const applyFailedDayOutcome=record=>{
    if(record.outcomeApplied)return;
    state.player.streak=0;state.player.totalFailedDays+=1;record.outcomeApplied=true;
    if(record.rankTrialActive){record.rankTrialFailed=true;record.rankTrialResolved=true;state.player.rankTrialAttempts=(state.player.rankTrialAttempts||0)+1}
  };
  const syncOutstandingProfileXp=()=>{
    const now=new Date();let directiveXp=0,attendanceXp=0;
    Object.values(state.dayRecords||{}).forEach(day=>Object.values(day.protocols||{}).forEach(protocol=>{directiveXp+=creditProtocolProfileXp(protocol,now)}));
    state.attendanceRecords.forEach(record=>{attendanceXp+=syncAttendanceProfileXp(record,now)});
    const unreleased=Object.values(state.dayRecords||{}).filter(day=>day.status==='cleared'&&!day.rewardApplied).sort((a,b)=>a.date.localeCompare(b.date));
    unreleased.forEach(day=>applyClearedDayRewards(day,now));
    if(unreleased.length||directiveXp||attendanceXp){state.logs.push({id:S.uid('log'),at:now.toISOString(),type:'system',message:`Profile XP synchronized${directiveXp?` · ${directiveXp} directive XP`:''}${attendanceXp?` · ${attendanceXp} attendance XP`:''}${unreleased.length?` · ${unreleased.length} Daily Clear reward${unreleased.length===1?'':'s'} finalized`:''}.`});save({silent:true})}
    return unreleased.length+directiveXp+attendanceXp;
  };
  const finalizeDay=(record,now=new Date(),force=false)=>{
    if(!record||record.status!=='active')return;
    const resolved=Object.values(record.protocols).every(protocol=>['cleared','failed','skipped'].includes(protocol.status));
    const recordConfigs=protocolConfigsForRecord(record),latestEnd=recordConfigs.length?recordConfigs.slice(1).reduce((latest,config)=>minutes(config.end)>minutes(latest)?config.end:latest,recordConfigs[0].end):(blueprint('shutdown')?.end||'23:00'),cutoff=recordMoment(record,latestEnd);
    if(!force&&!resolved&&now<cutoff)return;
    Object.values(record.protocols).forEach(protocol=>{if(['cleared','failed','skipped'].includes(protocol.status))return;if(protocol.required===false)transitionProtocol(protocol,'skipped',{at:now.toISOString(),reason:'Optional protocol unresolved at daily cutoff.',excused:true});else failProtocol(record,protocol,'The daily cutoff was reached before completion.',false,{defer:true})});
    record.completedProtocols=Object.values(record.protocols).filter(protocol=>protocol.status==='cleared').length;record.failedProtocols=Object.values(record.protocols).filter(protocol=>protocol.status==='failed').length;
    const requiredProtocols=Object.values(record.protocols).filter(protocol=>protocol.required!==false&&!protocol.excused),requiredCount=requiredProtocols.length,cleared=requiredProtocols.every(protocol=>protocol.status==='cleared');
    record.status=cleared?'cleared':'failed';record.finalizedAt=now.toISOString();record.baseXp=Object.values(record.protocols).reduce((sum,protocol)=>sum+Number(protocol.earnedXp||0),0);record.onTimePercentage=calculateOnTimePercentage(record);record.perfectClear=cleared&&record.onTimePercentage===100&&!recordHasRequiredSkip(record);record.weeklyBossCleared=evaluateWeeklyBoss(record,cleared);
    if(cleared)applyClearedDayRewards(record,now);else applyFailedDayOutcome(record);
    const requiredCleared=requiredProtocols.filter(protocol=>protocol.status==='cleared').length;state.logs.push({id:S.uid('log'),at:now.toISOString(),type:record.status,message:`Day ${record.status}. ${requiredCleared}/${requiredCount} required protocols cleared.${record.perfectClear?' Perfect Clear achieved.':''}${record.weeklyBossCleared?' Weekly Boss defeated.':''}`});save();
    if(cleared){if(record.rankAdvanced)systemFeedback('level',`${state.player.rank}-Rank achieved.`);else if(record.levelAdvanced)systemFeedback('level',`Level ${state.player.level} reached.`);else if(record.weeklyBossCleared)systemFeedback('boss','Weekly Boss defeated.');else if(record.perfectClear)systemFeedback('clear','Perfect Clear.');else systemFeedback('clear','Daily Clear.')}else systemFeedback('warning','Day failed.');
  };

  const finalizePastDays=()=>{
    const today=currentKey();
    Object.values(state.dayRecords).filter(record=>record.date<today&&record.status==='active').sort((a,b)=>a.date.localeCompare(b.date)).forEach(record=>finalizeDay(record,new Date(`${record.date}T23:59:59`),true));
  };

  const findCurrentProtocol=(record,now)=>{const minute=todayMinutes(now),configs=protocolConfigsForRecord(record);const active=configs.find(config=>record.protocols[config.id]?.status==='active');if(active)return active;const available=configs.filter(config=>config.schedulingMode!=='flexible'&&minute>=minutes(config.start)&&minute<minutes(config.end)&&record.protocols[config.id]?.status==='pending');return available.sort((a,b)=>(directivePriorityWeight[b.priority]||2)-(directivePriorityWeight[a.priority]||2)||minutes(a.end)-minutes(b.end)||minutes(a.start)-minutes(b.start))[0]||null};
  const findAvailableFlexibleProtocol=(record,now)=>{const minute=todayMinutes(now);return protocolConfigsForRecord(record).filter(config=>config.schedulingMode==='flexible'&&minute>=minutes(config.start)&&minute<minutes(config.end)&&record.protocols[config.id]?.status==='pending').sort((a,b)=>(directivePriorityWeight[b.priority]||2)-(directivePriorityWeight[a.priority]||2)||minutes(a.end)-minutes(b.end))[0]||null};
  const findNextProtocol=(record,now)=>{
    const minute=todayMinutes(now);
    return protocolConfigsForRecord(record).find(config=>minutes(config.start)>minute&&record.protocols[config.id].status==='pending')||null;
  };

  const classesForDate=date=>effectiveScheduleForDate(date);
  const meetingKey=(entry,date=new Date())=>`${S.dateKey(date)}::${entry.id}`;
  const attendanceFor=(entry,date=new Date())=>state.attendanceRecords.find(record=>record.meetingKey===meetingKey(entry,date))||null;
  const nextClassAt=(date=new Date())=>classesForDate(date).find(entry=>minutes(entry.start)>todayMinutes(date)&&!['no-class'].includes(attendanceFor(entry,date)?.status))||null;
  const createAttendanceRecord=(entry,date=new Date(),source='runtime')=>{
    const existing=attendanceFor(entry,date);if(existing)return existing;
    const record={
      id:S.uid('attendance'),meetingKey:meetingKey(entry,date),classId:entry.id,subjectKey:subjectKey(entry.subject),subjectName:entry.subject,code:entry.code||'',
      scheduledDate:S.dateKey(date),scheduledStart:entry.start,scheduledEnd:entry.end,room:entry.room||'',modality:entry.modality||'Onsite',
      status:'unverified',checkInAt:null,dismissedAt:null,dismissalStatus:null,minutesLate:0,pendingXp:0,xpAwarded:0,profileXpAppliedAmount:0,profileXpAppliedAt:null,finalized:false,
      ongoingUntil:null,arrivalTime:'',departureTime:'',note:'',resolvedManually:false,resolutionAt:null,source,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),corrections:[],
      timezone:{name:state.timezone?.name||S.timezoneName(),offset:state.timezone?.offset??S.timezoneOffset()}
    };
    state.attendanceRecords.push(record);return record;
  };
  const attendanceXpFor=(status,lateMinutes=0)=>{
    if(status==='early')return 30;
    if(status==='present')return 25;
    if(status==='late')return lateMinutes<=20?20:lateMinutes<=30?15:10;
    if(status==='partial')return 10;
    return 0;
  };
  const scheduledMoment=(record,time)=>new Date(`${record.scheduledDate}T${time}:00`);
  const setAttendanceStatus=(record,status,when=new Date())=>{
    const start=scheduledMoment(record,record.scheduledStart);
    record.status=status;
    if(['early','present','late','partial'].includes(status)){
      record.checkInAt=when.toISOString();
      record.minutesLate=Math.max(0,Math.round((when-start)/60000));
      record.pendingXp=attendanceXpFor(status,record.minutesLate);
      record.finalized=false;record.xpAwarded=0;
    }else{
      record.checkInAt=null;record.minutesLate=0;record.pendingXp=0;record.xpAwarded=0;
      record.finalized=['absent','excused','no-class'].includes(status);
      if(record.finalized){record.dismissedAt=when.toISOString();record.dismissalStatus=status;}
    }
    record.updatedAt=when.toISOString();
  };
  const finalizeAttendance=(record,dismissalStatus='dismissed',when=new Date())=>{
    if(!record)return;
    if(dismissalStatus==='no-class')setAttendanceStatus(record,'no-class',when);
    else if(['early','present','late','partial'].includes(record.status)){
      record.dismissedAt=when.toISOString();record.dismissalStatus=dismissalStatus;record.finalized=true;record.xpAwarded=record.pendingXp||attendanceXpFor(record.status,record.minutesLate);
      record.updatedAt=when.toISOString();record.ongoingUntil=null;
    }
    const profileDelta=syncAttendanceProfileXp(record,when);
    state.logs.push({id:S.uid('log'),at:when.toISOString(),type:'attendance',message:`${record.subjectName}: ${record.status}${record.finalized?` · ${record.xpAwarded} XP`:''}${profileDelta>0?' · added to Profile':profileDelta<0?' · Profile XP adjusted':''}.`});
    save();
  };
  const attendanceDateStart=entry=>entry?.effectiveFrom||(entry?.createdAt?S.dateKey(new Date(entry.createdAt)):currentKey());
  const syncHistoricalUnresolvedMeetings=(now=new Date())=>{
    const today=S.dateKey(now),versions=[...(state.scheduleHistory||[]),...(state.classSchedule||[])],versionStamp=versions.map(entry=>`${entry.classId||entry.id}:${entry.effectiveFrom||''}:${entry.effectiveTo||''}:${entry.updatedAt||entry.createdAt||''}`).sort().join('|'),exceptionStamp=(state.scheduleExceptions||[]).map(item=>`${item.id}:${item.date}:${item.type}:${item.classId||''}:${item.start||''}:${item.end||''}:${item.active!==false}`).sort().join('|'),signature=`${today}|${versionStamp}|${exceptionStamp}`;
    if(signature===attendanceBackfillSignature)return false;attendanceBackfillSignature=signature;
    const floor=new Date(now);floor.setHours(12,0,0,0);floor.setDate(floor.getDate()-210);let changed=false;
    const starts=versions.map(attendanceDateStart).filter(Boolean).sort();const first=starts[0]||today;let cursor=new Date(`${first}T12:00:00`);if(Number.isNaN(cursor.getTime())||cursor<floor)cursor=floor;
    const limit=new Date(`${today}T12:00:00`);
    while(cursor<=limit){
      historicalScheduleForDate(cursor).forEach(entry=>{
        const end=timeOnDate(cursor,entry.end);if(end>now||attendanceFor(entry,cursor))return;
        const record=createAttendanceRecord(entry,cursor,'historical-backfill');record.status='unverified';record.finalized=false;record.updatedAt=now.toISOString();changed=true;
      });
      cursor.setDate(cursor.getDate()+1);
    }
    if(changed)save({silent:true});return changed;
  };
  const syncUnverifiedMeetings=(now=new Date())=>{
    let changed=false;
    classesForDate(now).forEach(entry=>{
      const end=timeOnDate(now,entry.end);
      if(now<end||attendanceFor(entry,now))return;
      const record=createAttendanceRecord(entry,now);record.status='unverified';record.finalized=false;record.updatedAt=now.toISOString();changed=true;
    });
    if(changed)save({silent:true});
  };
  const unresolvedAttendance=(date=new Date())=>state.attendanceRecords
    .filter(record=>record.status==='unverified'&&!record.finalized&&record.scheduledDate<=S.dateKey(date))
    .filter(record=>{const end=scheduledMoment(record,record.scheduledEnd);return !Number.isNaN(end.getTime())&&end<=date})
    .sort((a,b)=>`${b.scheduledDate}T${b.scheduledStart}`.localeCompare(`${a.scheduledDate}T${a.scheduledStart}`))[0]||null;
  const classStateAt=(now=new Date())=>{
    syncHistoricalUnresolvedMeetings(now);syncUnverifiedMeetings(now);
    const classes=classesForDate(now);
    for(const entry of classes){
      const record=attendanceFor(entry,now),start=timeOnDate(now,entry.start),end=timeOnDate(now,entry.end);
      if(['no-class','excused','absent'].includes(record?.status)||record?.finalized)continue;
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
  const attendanceTimeValue=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value||''))?String(value):'';
  const applyManualAttendanceResolution=(record,status,options={})=>{
    if(!record||!['present','partial','absent','excused','no-class'].includes(status))return false;
    const arrival=status==='partial'?attendanceTimeValue(options.arrivalTime):'',departure=status==='partial'?attendanceTimeValue(options.departureTime):'';
    if(status==='partial'&&arrival&&departure&&minutes(departure)<minutes(arrival))return false;
    const now=new Date(),before=record.status,priorXp=Math.max(0,Number(record.profileXpAppliedAmount||0));
    record.corrections=Array.isArray(record.corrections)?record.corrections:[];
    if(before!==status||record.finalized)record.corrections.push({at:now.toISOString(),from:before,to:status,note:String(options.note||'').slice(0,240)});
    record.note=String(Object.prototype.hasOwnProperty.call(options,'note')?options.note:(record.note||'')).slice(0,240);record.arrivalTime='';record.departureTime='';record.resolvedManually=true;record.resolutionAt=now.toISOString();record.ongoingUntil=null;
    if(status==='present'){
      const check=scheduledMoment(record,record.scheduledStart),end=scheduledMoment(record,record.scheduledEnd);setAttendanceStatus(record,'present',check);finalizeAttendance(record,'dismissed',end);
    }else if(status==='partial'){
      const check=scheduledMoment(record,arrival||record.scheduledStart),end=scheduledMoment(record,departure||record.scheduledEnd);record.arrivalTime=arrival;record.departureTime=departure;setAttendanceStatus(record,'partial',check);record.arrivalTime=arrival;record.departureTime=departure;finalizeAttendance(record,'partial',end);
    }else{
      setAttendanceStatus(record,status,now);record.finalized=true;record.dismissalStatus=status;record.dismissedAt=now.toISOString();record.pendingXp=0;record.xpAwarded=0;record.updatedAt=now.toISOString();const delta=syncAttendanceProfileXp(record,now);state.logs.push({id:S.uid('log'),at:now.toISOString(),type:'attendance',message:`${record.subjectName}: ${status} · manually resolved.${delta?` Profile XP ${delta>0?'increased':'decreased'} by ${Math.abs(delta)}.`:''}`});save();
    }
    const currentXp=Math.max(0,Number(record.profileXpAppliedAmount||0));
    if(before!==status||priorXp!==currentXp)state.logs.push({id:S.uid('log'),at:now.toISOString(),type:'attendance-correction',message:`${record.subjectName} resolved from ${before} to ${status}.${priorXp!==currentXp?` Profile XP adjusted by ${Math.abs(currentXp-priorXp)}.`:''}`});
    save({silent:true});return true;
  };
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
    if(action==='cancelled'||action==='resolve-no-class'){
      applyManualAttendanceResolution(record,'no-class');systemFeedback('warning','No Class recorded.');if(action==='cancelled')await showOverlay('NO CLASS',entry.subject,'NO XP · NO PENALTY',800);renderApp();return;
    }
    if(action==='absent'){
      applyManualAttendanceResolution(record,'absent');systemFeedback('warning','Absence recorded.');renderApp();return;
    }
    if(action==='resolve-excused'){
      applyManualAttendanceResolution(record,'excused');systemFeedback('attendance','Excused attendance recorded.');renderApp();return;
    }
    if(action==='resolve-partial'){
      applyManualAttendanceResolution(record,'partial');systemFeedback('attendance','Partial attendance recorded.');renderApp();return;
    }
    if(action==='ongoing'){
      record.ongoingUntil=new Date(now.getTime()+15*60000).toISOString();record.dismissalStatus='still-ongoing';record.updatedAt=now.toISOString();save();systemFeedback('attendance','Class extension recorded.');renderApp();return;
    }
    if(action==='dismissed'||action==='dismissed-early'){
      finalizeAttendance(record,action==='dismissed-early'?'dismissed-early':'dismissed',now);systemFeedback('dismissal','Class dismissal recorded.');await showOverlay('CLASS COMPLETE',entry.subject,`+${record.xpAwarded} XP`,850);renderApp();return;
    }
    if(action==='resolve-present'){
      applyManualAttendanceResolution(record,'present');systemFeedback('attendance','Attendance record resolved.');renderApp();
    }
  };
  const renderClassScreen=(context,now=new Date())=>{
    requestWakeLock();show('classScreen');document.body.dataset.state=context.mode==='dismissal'||context.mode==='resolve'?'warning':'active';currentClassContext=context;
    const {entry,record,start,end,mode}=context;
    $('#classCard').dataset.mode=mode;
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

  const formatHeaderClock=date=>{
    const compactHeader=!!window.matchMedia?.('(max-width:480px)').matches;
    const options={hour:'2-digit',minute:'2-digit'};
    if(!compactHeader)options.second='2-digit';
    if(state.settings?.timeFormat==='24')options.hourCycle='h23';
    else options.hour12=true;
    return new Intl.DateTimeFormat(undefined,options).format(date);
  };

  const updateClock=()=>{
    const now=new Date();
    $('#clockTime').textContent=formatHeaderClock(now);
    $('#clockDate').textContent=formatDate(now);
  };

  const updateCheckInAndEvaluation=()=>{
    if(!state.initialized)return null;
    finalizePastDays();
    reconcileCurrentDayProfileXp();
    if(Object.values(state.dayRecords||{}).some(day=>day.status==='cleared'&&!day.rewardApplied)||pendingProfileXp())syncOutstandingProfileXp();
    const now=new Date();
    const record=createDayRecord(now);
    if(syncConditionalProtocols(record,now))save({silent:true});
    const minute=todayMinutes(now),wakeStart=minutes(systemWakeTime()),wakeEnd=minutes(blueprint('wake')?.end||'06:00');
    if(!record.wakeCheckInAt&&minute>=wakeStart&&minute<wakeEnd&&document.visibilityState==='visible')recordWakeCheckIn(record,now,'automatic-window');
    evaluateDeadlines(record,now);
    if(now>=recordMoment(record,systemDailyCutoff()))finalizeDay(record,now);
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
  const reminderBridgeState=()=>state.system.reminderBridge||(state.system.reminderBridge={lastCheckAt:null,missedCount:0,lastMissedAt:null,lastExportAt:null,lastExportEvents:0});
  const invalidateExternalCalendar=()=>{state.settings.externalCalendarConfirmed=false;};
  const escapeIcs=value=>String(value??'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  const icsLocal=date=>`${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
  const icsUtc=date=>`${date.getUTCFullYear()}${pad(date.getUTCMonth()+1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  const addCalendarEvent=(lines,{uid,start,end,summary,description,leadMinutes=10,deadlineAlarm=true})=>{
    lines.push('BEGIN:VEVENT',`UID:${escapeIcs(uid)}`,`DTSTAMP:${icsUtc(new Date())}`,`DTSTART:${icsLocal(start)}`,`DTEND:${icsLocal(end)}`,`SUMMARY:${escapeIcs(summary)}`,`DESCRIPTION:${escapeIcs(description)}`,'CATEGORIES:ASCEND');
    lines.push('BEGIN:VALARM',`TRIGGER:-PT${Math.max(1,leadMinutes)}M`,'ACTION:DISPLAY',`DESCRIPTION:${escapeIcs(`${summary} starts soon.`)}`,'END:VALARM');
    if(deadlineAlarm)lines.push('BEGIN:VALARM','TRIGGER;RELATED=END:-PT5M','ACTION:DISPLAY',`DESCRIPTION:${escapeIcs(`${summary} deadline in five minutes.`)}`,'END:VALARM');
    lines.push('END:VEVENT');
  };
  const buildReminderCalendar=(options={})=>{
    const test=Boolean(options.test),lead=Number(state.settings.notificationLeadMinutes||10),horizon=test?1:Number(state.settings.externalCalendarHorizonDays||60),now=new Date(),lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//ASCEND//External Reminder Bridge//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH',`X-WR-CALNAME:${escapeIcs(test?'ASCEND Reminder Test':'ASCEND Discipline Reminders')}`];
    let events=0;
    if(test){
      const start=new Date(now.getTime()+2*60000),end=new Date(start.getTime()+15*60000);
      addCalendarEvent(lines,{uid:`ascend-reminder-test-${start.getTime()}@local`,start,end,summary:'ASCEND · External Reminder Test',description:'Two-minute device calendar reminder test. Import this event and keep calendar notifications enabled.',leadMinutes:1,deadlineAlarm:false});events=1;
    }else{
      const cursor=new Date(now);cursor.setHours(0,0,0,0);
      for(let offset=0;offset<horizon;offset++){
        const date=new Date(cursor);date.setDate(cursor.getDate()+offset);const key=S.dateKey(date);
        protocolConfigsForDate(date).forEach(config=>{
          const start=timeOnDate(date,config.start),end=timeOnDate(date,config.end);
          addCalendarEvent(lines,{uid:`ascend-protocol-${key}-${config.id}@local`,start,end,summary:`ASCEND · ${config.name}`,description:`Fixed ASCEND protocol from ${formatTime(config.start)} to ${formatTime(config.end)}. Open ASCEND and complete every required stage before the deadline.`,leadMinutes:lead,deadlineAlarm:true});events++;
        });
        classesForDate(date).forEach(entry=>{
          const start=timeOnDate(date,entry.start),end=timeOnDate(date,entry.end),location=[entry.modality,entry.room].filter(Boolean).join(' · ');
          addCalendarEvent(lines,{uid:`ascend-class-${key}-${entry.id}@local`,start,end,summary:`ASCEND Class · ${entry.subject}`,description:`Class check-in for ${entry.subject}${location?` · ${location}`:''}. Open ASCEND to confirm attendance and dismissal.`,leadMinutes:Math.max(lead,15),deadlineAlarm:true});events++;
        });
      }
    }
    lines.push('END:VCALENDAR');
    return{text:lines.join('\r\n')+'\r\n',events};
  };
  const shareCalendarFile=async(name,content)=>{
    const blob=new Blob([content],{type:'text/calendar;charset=utf-8'}),file=typeof File==='function'?new File([blob],name,{type:'text/calendar'}):null;
    if(file&&navigator.share&&navigator.canShare?.({files:[file]})){
      try{await navigator.share({title:'ASCEND Device Reminders',text:'Import this ASCEND reminder calendar into your device calendar.',files:[file]});return'shared'}catch(error){if(error?.name==='AbortError')return'cancelled'}
    }
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);return'downloaded';
  };
  const scheduledReminderMomentsBetween=(start,end)=>{
    const moments=[];if(!(start instanceof Date)||!(end instanceof Date)||end<=start)return moments;
    const cursor=new Date(start);cursor.setHours(0,0,0,0);const last=new Date(end);last.setHours(23,59,59,999);
    for(let date=new Date(cursor);date<=last;date.setDate(date.getDate()+1)){
      protocolConfigsForDate(date).forEach(config=>{const moment=timeOnDate(date,config.start);if(moment>start&&moment<=end)moments.push({at:moment,label:config.name})});
      classesForDate(date).forEach(entry=>{const moment=timeOnDate(date,entry.start);if(moment>start&&moment<=end)moments.push({at:moment,label:`${entry.subject} class`})});
      if(moments.length>40)break;
    }
    return moments.sort((a,b)=>a.at-b.at);
  };
  const checkReminderGap=(now=new Date())=>{
    const bridge=reminderBridgeState(),last=bridge.lastCheckAt?new Date(bridge.lastCheckAt):null;
    if(!last||Number.isNaN(last.getTime())){bridge.lastCheckAt=now.toISOString();S.save(state);return}
    const gap=now-last;if(gap<60000)return;
    if(gap>=120000){
      const events=scheduledReminderMomentsBetween(last,now);
      if(events.length){bridge.missedCount=Number(bridge.missedCount||0)+events.length;bridge.lastMissedAt=now.toISOString();state.logs.push({id:S.uid('log'),at:now.toISOString(),type:'reminder',message:`Reminder gap detected after ASCEND was inactive: ${events.length} scheduled event(s).`});if(document.visibilityState==='visible'&&launchDismissed)showSystemNotice('alert','REMINDER GAP DETECTED',`${events.length} scheduled event(s) passed while ASCEND was inactive. Device calendar alarms are the external fallback.`,3600)}
    }
    bridge.lastCheckAt=now.toISOString();S.save(state);
  };
  const renderExternalReminders=()=>{
    setControlView('externalRemindersView');const bridge=reminderBridgeState(),permission=('Notification' in window)?Notification.permission:'unsupported',local=state.settings.notifications&&permission==='granted';
    $('#externalLocalStatus').textContent=local?'ON':permission==='denied'?'BLOCKED':'OFF';
    $('#externalCalendarStatus').textContent=state.settings.externalCalendarConfirmed?'ACTIVE':state.settings.externalCalendarExportedAt?'EXPORTED':'NOT EXPORTED';
    $('#externalHorizonStatus').textContent=`${state.settings.externalCalendarHorizonDays||60} DAYS`;
    $('#externalMissedStatus').textContent=String(bridge.missedCount||0);
    $('#externalReminderLead').value=String(state.settings.notificationLeadMinutes||10);
    $('#externalToggleAlerts b').textContent=state.settings.notifications?'Disable Local Alerts':'Enable Local Alerts';
    $('#confirmExternalCalendar').textContent=state.settings.externalCalendarConfirmed?'Calendar Confirmed Active':'Confirm Calendar Imported';
    const last=state.settings.externalCalendarExportedAt?formatShortDate(state.settings.externalCalendarExportedAt):null;
    $('#externalReminderCopy').textContent=state.settings.externalCalendarConfirmed?`Device calendar bridge confirmed${last?` · last exported ${last}`:''}. Re-export after schedule or timezone changes.`:'Export the next 60 days of protocols and classes, then import the .ics file into your device calendar so alarms can fire while the PWA is fully closed.';
  };
  const exportReminderCalendar=async(test=false)=>{
    const calendar=buildReminderCalendar({test}),fileName=test?`ascend-reminder-test-${S.dateKey(new Date())}.ics`:`ascend-device-reminders-${S.dateKey(new Date())}.ics`,result=await shareCalendarFile(fileName,calendar.text);
    if(result==='cancelled')return;
    if(!test){const now=new Date().toISOString(),bridge=reminderBridgeState();state.settings.externalCalendarExportedAt=now;state.settings.externalCalendarConfirmed=false;bridge.lastExportAt=now;bridge.lastExportEvents=calendar.events;state.logs.push({id:S.uid('log'),at:now,type:'reminder',message:`External reminder calendar exported with ${calendar.events} event(s).`});save({silent:true});showSystemNotice('alert','CALENDAR FILE READY',`${calendar.events} reminders exported. Import the file into your device calendar, then confirm activation.`,3800);renderExternalReminders()}else showSystemNotice('alert','TEST REMINDER READY','Import the calendar event. Its alarm is scheduled approximately two minutes from now.',3600);
  };
  const confirmExternalCalendar=()=>{
    state.settings.externalCalendarConfirmed=!state.settings.externalCalendarConfirmed;const now=new Date().toISOString();state.logs.push({id:S.uid('log'),at:now,type:'reminder',message:`Device calendar reminder bridge marked ${state.settings.externalCalendarConfirmed?'active':'inactive'}.`});save({silent:true});showSystemNotice('alert',state.settings.externalCalendarConfirmed?'DEVICE CALENDAR ACTIVE':'DEVICE CALENDAR UNCONFIRMED',state.settings.externalCalendarConfirmed?'External calendar alarms are now recorded as the closed-app fallback.':'Re-import the current calendar file before relying on external alarms.',3000);renderExternalReminders();
  };

  const sweepNotifications=(record,now=new Date())=>{
    if(Date.now()-notificationSweepAt<20000)return;notificationSweepAt=Date.now();checkReminderGap(now);
    if(!state.settings.notifications)return;
    const lead=notificationLeadMinutes()*60000;
    protocolConfigsForRecord(record).forEach(config=>{
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
    if(record?.weeklyBoss&&record.weeklyBossPlan){const boss=record.protocols?.productivity,start=recordMoment(record,blueprint('productivity')?.start||'20:30'),delta=start-now;if(boss?.status==='pending'&&delta>0&&delta<=lead)sendLocalNotification(`${record.date}:weekly-boss`, `Weekly Boss: ${record.weeklyBossPlan.title}`,record.weeklyBossPlan.copy)}
    Object.values(record?.protocols||{}).filter(protocol=>protocol.status==='failed'&&protocol.completedAt&&now-new Date(protocol.completedAt)<=60*60000).forEach(protocol=>sendLocalNotification(`${record.date}:${protocol.id}:failed`,`${protocol.name} failed`,protocol.failureReason||'The fixed deadline passed.'));
  };
  const storageReport=async()=>{
    const localBytes=S.storageBytes(state);let usage=localBytes,quota=5*1024*1024;
    try{const estimate=await navigator.storage?.estimate?.();if(estimate){usage=Math.max(usage,Number(estimate.usage||0));quota=Number(estimate.quota||quota)}}catch(error){}
    return{usage,quota,ratio:quota?usage/quota:0,localBytes};
  };
  const checkStoragePressure=async(force=false)=>{
    if(!force&&Date.now()-storageCheckAt<60000)return;storageCheckAt=Date.now();const report=await storageReport();
    if(report.ratio>=.8||report.localBytes>=4*1024*1024){const today=S.dateKey();if(state.system.lastStorageWarningAt!==today){state.system.lastStorageWarningAt=today;state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'system',message:'Local storage pressure warning issued.'});save({silent:true});showSystemNotice('alert','STORAGE CAPACITY WARNING','Export a backup. Routine logs are being limited automatically.',4200)}}
    return report;
  };

  const applyBodyState=(record,protocol,task,deadlineMs)=>{
    syncAmbientState(record,protocol);
    const minutesLeft=deadlineMs/60000;
    let stateName=task?.type==='timer'||task?.type==='academic'||task?.type==='trading'?'timed':'active';
    if(minutesLeft<=5)stateName='critical';else if(minutesLeft<=10)stateName='warning';
    document.body.dataset.state=stateName;
  };

  const renderSetup=()=>{releaseWakeLock();show('setupScreen');document.body.dataset.state='standby'};

  const renderEarlyWake=()=>{releaseWakeLock();show('earlyWakeScreen');document.body.dataset.state='active';currentClassContext=null;$('#earlyWakeFill').style.width='0%';const wake=systemWakeTime();$('#earlyWakeScreen .early-time strong').textContent=formatTime(wake);$('#earlyWakeScreen .lead').textContent=`Available during the hour before ${formatTime(wake)}. Confirm only when you are ready to begin. The completed hold time becomes your official wake time.`};

  const renderSleep=(now=new Date(),earlyDismissed=false)=>{
    releaseWakeLock();show('sleepScreen');document.body.dataset.state='standby';currentClassContext=null;
    const earlyMinute=earlyWakeStartMinute(),earlyTime=`${pad(Math.floor(earlyMinute/60))}:${pad(earlyMinute%60)}`;$('#sleepScreen .sleep-range').textContent=`${formatTime(systemDailyCutoff())} – ${formatTime(earlyTime)}`;
    const nextWake=nextWakeMoment(now);
    const sameDay=S.dateKey(nextWake)===S.dateKey(now);
    $('#sleepCountdown').textContent=formatDuration(nextWake-now);
    $('#sleepNextTime').textContent=`${sameDay?'Today':'Tomorrow'} at ${formatTime(systemWakeTime())}`;
    if(earlyDismissed){
      $('#sleepMessage').textContent=`Early Wake Sign-In remains available until ${formatTime(systemWakeTime())}. Reopen ASCEND when you are fully awake.`;
    }else if(isSleepWindow(now)){
      const early=timeOnDate(now,`${pad(Math.floor(earlyWakeStartMinute()/60))}:${pad(earlyWakeStartMinute()%60)}`);$('#sleepMessage').textContent=`Early Wake Sign-In unlocks at ${formatClock(early)}. Protect the recovery window.`;
    }else{
      $('#sleepMessage').textContent=`No directive is active. The Wake Protocol begins at ${formatTime(systemWakeTime())}.`;
    }
  };

  const renderFreeDailyQuest=()=>{
    const quest=ensureDailyQuest(),progress=questProgress(quest),canClaim=progress.done&&!quest.claimed;
    $('#freeQuestMini').textContent=quest.claimed?'DONE':canClaim?'READY':progress.label;
    $('#dailyQuestHeading').textContent=quest.title;
    $('#dailyQuestCopy').textContent=quest.copy;
    $('#dailyQuestStatus').textContent=quest.claimed?'CLAIMED':progress.label;
    $('#dailyQuestFill').style.width=`${progress.progress*100}%`;
    $('#dailyQuestReward').textContent=quest.claimed?'REWARD CLAIMED':`+${quest.xp} XP`;
    $('#dailyQuestClaim').hidden=!canClaim;
  };
  const openDailyQuest=()=>{renderFreeDailyQuest();$('#dailyQuestOverlay').hidden=false};
  const closeDailyQuest=()=>{$('#dailyQuestOverlay').hidden=true};

  const renderFree=(record,now)=>{
    releaseWakeLock();show('freeScreen');document.body.dataset.state='standby';currentClassContext=null;renderFreeDailyQuest();
    $('#freeLevel').textContent=state.player.level;$('#freeRank').textContent=state.player.rank;$('#freeStreak').textContent=state.player.streak;
    const required=clearDaysRequired(state.player.level);

    const flexible=findAvailableFlexibleProtocol(record,now);$('#startFlexibleProtocolButton').hidden=!flexible;$('#startFlexibleProtocolButton').dataset.protocolId=flexible?.id||'';
    if(flexible){const deadline=timeOnDate(now,flexible.end);$('#freeEyebrow').textContent='FLEXIBLE WINDOW';$('#freeKicker').textContent='PROTOCOL AVAILABLE';$('#freeTitle').textContent=flexible.name;$('#freeNextTime').textContent=`Available until ${formatTime(flexible.end)}`;$('#freeCountdown').textContent=formatDuration(deadline-now);$('#freePrep').textContent=flexible.prep;return}
    const nextClass=nextClassAt(now);
    const nextProtocol=findNextProtocol(record,now);
    let event=null;
    if(nextClass){event={type:'class',time:timeOnDate(now,nextClass.start),data:nextClass}}
    if(nextProtocol){const time=timeOnDate(now,nextProtocol.start);if(!event||time<event.time)event={type:'protocol',time,data:nextProtocol}}
    if(!event){
      $('#freeEyebrow').textContent='SYSTEM STANDBY';$('#freeKicker').textContent='NEXT WAKE DIRECTIVE';$('#freeTitle').textContent='Wake Protocol';
      const tomorrow=new Date(now),wakeParts=systemWakeTime().split(':').map(Number);tomorrow.setDate(tomorrow.getDate()+1);tomorrow.setHours(wakeParts[0],wakeParts[1],0,0);
      $('#freeNextTime').textContent=`Tomorrow at ${formatTime(systemWakeTime())}`;$('#freeCountdown').textContent=formatDuration(tomorrow-now);$('#freePrep').textContent=`Protect the sleep window. The System begins again at ${formatTime(systemWakeTime())}.`;return;
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

  const startAvailableFlexibleProtocol=()=>{const record=dayRecord(),id=$('#startFlexibleProtocolButton').dataset.protocolId,config=blueprint(id);if(!record||!config||config.schedulingMode!=='flexible'||record.protocols?.[id]?.status!=='pending')return;startProtocol(record,config,new Date());renderApp()};

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
  const defaultAuditDraft=()=>({title:'',deadline:'',difficulty:'Medium',workload:'30',note:''});
  const auditDraftFor=step=>{
    step.auditState=step.auditState||{index:0};
    const draft=step.auditState.draft&&typeof step.auditState.draft==='object'?step.auditState.draft:{};
    step.auditState.draft={...defaultAuditDraft(),...draft};
    return step.auditState.draft;
  };
  const captureAuditDraft=()=>{
    const protocol=activeProtocolRecord(),step=currentStep(protocol);if(!step||step.type!=='audit')return false;
    const title=$('#auditTaskTitle'),deadline=$('#auditTaskDeadline'),difficulty=$('#auditTaskDifficulty'),workload=$('#auditTaskWorkload'),note=$('#auditTaskNote');
    if(!title||!deadline||!difficulty||!workload||!note)return false;
    step.auditState=step.auditState||{index:0};
    step.auditState.draft={title:title.value,deadline:deadline.value,difficulty:difficulty.value||'Medium',workload:String(workload.value||'30'),note:note.value};
    return true;
  };

  const taskById=id=>state.academicTasks.find(task=>task.id===id)||null;
  const taskBlockers=task=>(task?.dependencyIds||[]).map(taskById).filter(Boolean).filter(item=>item.status!=='completed');
  const taskDependenciesMet=task=>taskBlockers(task).length===0;
  const dependencyPathExists=(startId,targetId,seen=new Set())=>{
    if(startId===targetId)return true;if(seen.has(startId))return false;seen.add(startId);
    const task=taskById(startId);return (task?.dependencyIds||[]).some(id=>dependencyPathExists(id,targetId,seen));
  };
  const taskRiskInfo=task=>{
    const now=new Date(),deadline=task?.deadline?new Date(`${task.deadline}T23:59:59`):null;
    const days=deadline?Math.ceil((deadline-now)/86400000):999;
    const blockers=taskBlockers(task),workload=Math.max(15,Number(task.workloadMinutes||30)),difficulty=String(task.difficulty||'Medium').toLowerCase();
    const sameDay=task?.deadline?state.academicTasks.filter(item=>item.status!=='completed'&&item.id!==task.id&&item.deadline===task.deadline).length:0;
    const subjectDays=activeSchedule().filter(entry=>subjectKey(entry.subject)===task.subjectKey).map(entry=>Number(entry.day));
    const upcomingClass=subjectDays.some(day=>{const delta=(day-now.getDay()+7)%7;return delta<=2});
    let score=0;const reasons=[];
    if(days<0){score+=100;reasons.push('overdue')}else if(days===0){score+=75;reasons.push('due today')}else if(days===1){score+=60;reasons.push('due tomorrow')}else if(days<=3){score+=42;reasons.push(`due in ${days} days`)}else if(days<=7){score+=24;reasons.push(`due in ${days} days`)}
    if(blockers.length){score+=Math.min(30,blockers.length*12);reasons.push(`${blockers.length} prerequisite${blockers.length===1?'':'s'} incomplete`)}
    if(workload>=120){score+=24;reasons.push('multi-session workload')}else if(workload>=60){score+=14;reasons.push(`${workload}-minute workload`)}
    if(difficulty.includes('high')||difficulty.includes('difficult')){score+=14;reasons.push('high difficulty')}else if(difficulty.includes('medium')||difficulty.includes('moderate'))score+=7;
    if(Number(task.postponements||0)>0){score+=Math.min(24,Number(task.postponements||0)*8);reasons.push(`postponed ${task.postponements} time${task.postponements===1?'':'s'}`)}
    if(sameDay){score+=Math.min(18,sameDay*6);reasons.push(`${sameDay+1} tasks share the deadline`)}
    if(upcomingClass){score+=8;reasons.push('subject meets soon')}
    const level=score>=80?'CRITICAL':score>=55?'HIGH':score>=30?'ELEVATED':'NORMAL';
    return{score,level,reasons,days,blockers,workload,fit:workload<=25?'FITS TONIGHT':workload<=60?'SPLIT RECOMMENDED':'MULTI-SESSION REQUIRED'};
  };
  const sortedPendingTasks=()=>state.academicTasks.filter(task=>task.status!=='completed').sort((a,b)=>{
    const riskDifference=taskRiskInfo(b).score-taskRiskInfo(a).score;
    if(riskDifference)return riskDifference;
    const ad=a.deadline?new Date(`${a.deadline}T23:59:59`).getTime():Infinity;
    const bd=b.deadline?new Date(`${b.deadline}T23:59:59`).getTime():Infinity;
    return ad-bd||String(a.subjectName).localeCompare(String(b.subjectName));
  });
  const pendingTasks=()=>sortedPendingTasks().filter(taskDependenciesMet);

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
    const draft=auditDraftFor(step);
    $('#customTaskArea').innerHTML=`
      <div class="audit-head"><span>${step.auditState.index+1} / ${subjects.length}</span><strong>${escapeHtml(subject.name)}</strong><small>${subjectPending} pending</small></div>
      ${shownTask?`<div class="existing-task"><span>NEXT PENDING</span><strong>${escapeHtml(shownTask.title)}</strong><small>${shownTask.deadline||'No deadline'}</small><button type="button" data-custom="complete-existing" data-task-id="${shownTask.id}">Mark Completed</button></div>`:''}
      <div class="compact-form audit-form">
        <label>Task<input id="auditTaskTitle" type="text" maxlength="80" placeholder="Required output" value="${escapeHtml(draft.title)}"></label>
        <label>Deadline<span class="time-shell"><input id="auditTaskDeadline" type="date" value="${escapeHtml(draft.deadline)}"></span></label>
        <label>Difficulty<select id="auditTaskDifficulty"><option value="Low" ${draft.difficulty==='Low'?'selected':''}>Low</option><option value="Medium" ${draft.difficulty==='Medium'?'selected':''}>Medium</option><option value="High" ${draft.difficulty==='High'?'selected':''}>High</option></select></label>
        <label>Workload<select id="auditTaskWorkload"><option value="15" ${draft.workload==='15'?'selected':''}>15 minutes</option><option value="30" ${draft.workload==='30'?'selected':''}>30 minutes</option><option value="60" ${draft.workload==='60'?'selected':''}>1 hour</option><option value="120" ${draft.workload==='120'?'selected':''}>2 hours</option><option value="180" ${draft.workload==='180'?'selected':''}>Multi-session</option></select></label>
        <label>Note<input id="auditTaskNote" type="text" maxlength="70" placeholder="Optional" value="${escapeHtml(draft.note)}"></label>
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
        <div class="recommendation"><span>SYSTEM RECOMMENDATION${recommended?` · ${taskRiskInfo(recommended).level}`:''}</span><strong>${recommended?escapeHtml(recommended.title):'Academic Maintenance'}</strong><small>${recommended?`${escapeHtml(recommended.subjectName)} · ${recommended.deadline||'No deadline'} · ${taskRiskInfo(recommended).fit}<br>${escapeHtml(taskRiskInfo(recommended).reasons.slice(0,2).join(' · ')||'Highest current priority')}`:'No pending academic tasks were found.'}</small></div>
        <div class="mode-grid"><button type="button" data-custom="plan-single" ${tasks.length?'':'disabled'}>Single Priority</button><button type="button" data-custom="plan-multi" ${tasks.length>1?'':'disabled'}>Multiple Subjects</button><button type="button" data-custom="plan-maintenance" ${tasks.length?'disabled':''}>No Pending Tasks</button></div>`;
      return;
    }
    const task=tasks[clamp(plan.index,0,Math.max(0,tasks.length-1))];
    if(!task){plan.phase='mode';renderPlanner(protocol,step);return}
    const selected=plan.selectedIds.includes(task.id);
    $('#customTaskArea').innerHTML=`
      <div class="task-picker"><span>${plan.index+1} / ${tasks.length}</span><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.subjectName)} · ${task.deadline||'No deadline'} · ${taskRiskInfo(task).level} · ${taskRiskInfo(task).workload} min</small></div>
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
      $('#customTaskArea').innerHTML=`<div class="academic-card active"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta)}</small><b>${formatDuration(remaining).slice(3)}</b><em>TIMER ACTIVE</em></div>`;return;
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
      $('#customTaskArea').innerHTML=`<div class="academic-card active"><strong>MARKET REVIEW ACTIVE</strong><small>A no-trade decision is valid when no setup meets your rules.</small><b>${formatDuration(remaining).slice(3)}</b><em>TIMER ACTIVE</em></div>`;return;
    }
    $('#customTaskArea').innerHTML=`
      <div class="compact-form trading-form">
        <label>Observation<input id="tradingObservation" type="text" maxlength="110" placeholder="One market observation"></label>
        <label>Decision<select id="tradingDecision"><option value="No trade — no valid setup">No trade — no valid setup</option><option value="Trade logged within plan">Trade logged within plan</option><option value="Position reviewed — no action">Position reviewed — no action</option></select></label>
      </div>
      <button class="custom-primary" type="button" data-custom="save-trading">Save Trading Review</button>`;
  };

  const workoutElapsed=step=>step?.startedAt?Math.max(0,Date.now()-new Date(step.startedAt).getTime()):0;
  const renderWorkoutDungeon=(protocol,step)=>{
    $('#actionButton').hidden=true;$('#subtaskTimer').hidden=true;$('#customTaskArea').hidden=false;
    const minMs=Number(step.minDuration||15)*60000,maxMs=Number(step.recommendedMax||45)*60000;
    if(step.status==='pending'){
      $('#customTaskArea').innerHTML=`<div class="custom-message"><strong>WORKOUT DUNGEON</strong><p>Train for at least ${step.minDuration||15} minutes. End when the workout is actually finished. ${step.recommendedMax||45} minutes is the recommended upper target; extra time does not increase XP.</p><button type="button" data-custom="start-workout">Start Workout Dungeon</button></div>`;return;
    }
    const elapsed=workoutElapsed(step),minimumCleared=elapsed>=minMs,limitReached=elapsed>=maxMs;
    const status=limitReached?'DUNGEON LIMIT REACHED':minimumCleared?'MINIMUM CLEARED':'MINIMUM RUN ACTIVE';
    const copy=limitReached?'Finish the current set, then end the workout when ready.':minimumCleared?'You may end the workout whenever the planned session is complete.':`${formatDuration(Math.max(0,minMs-elapsed)).slice(3)} until the 15-minute minimum.`;
    $('#customTaskArea').innerHTML=`<div class="academic-card active workout-dungeon-card"><strong>WORKOUT DUNGEON ACTIVE</strong><small>${escapeHtml(copy)}</small><b>${formatDuration(elapsed)}</b><em>${status}</em></div>${minimumCleared?'<button class="custom-primary" type="button" data-custom="end-workout">End Workout</button>':'<button class="danger-button compact-danger workout-early-exit" type="button" data-custom="exit-workout-early"><b>Exit Early · No Clear</b></button>'}`;
  };
  const advanceAutomaticProtocolSteps=protocol=>{
    const task=currentStep(protocol);if(!task||task.type!=='timer'||!task.autoComplete||task.status!=='active'||!task.startedAt)return false;
    if(Date.now()-new Date(task.startedAt).getTime()<Number(task.duration||0)*60000)return false;
    if(!transitionStep(task,'completed',new Date().toISOString()))return false;
    state.logs.push({id:S.uid('log'),at:task.completedAt,type:'subtask',message:`${task.title} completed automatically after ${task.duration} minutes.`});return true;
  };

  const renderProtocol=(record,config)=>{
    requestWakeLock();show('protocolScreen');
    const protocol=startProtocol(record,config,new Date());
    if(advanceAutomaticProtocolSteps(protocol))save({silent:true});
    const task=currentStep(protocol);
    if(!task){clearProtocol(record,protocol);return}
    const deadline=timeOnDate(new Date(),config.end);const deadlineMs=deadline-new Date();applyBodyState(record,protocol,task,deadlineMs);
    $('#protocolLabel').textContent=protocol.boss?`WEEKLY BOSS · ${record.weeklyBossPlan?.title||'PRODUCTIVITY'}`:config.name.toUpperCase();
    $('#protocolWindow').textContent=`${formatTime(config.start)} – ${formatTime(config.end)}`;
    const index=protocol.steps.indexOf(task);$('#stepCurrent').textContent=index+1;$('#stepTotal').textContent=protocol.steps.length;
    const punctual=protocolOnTime(record,protocol);$('#punctualityBadge').textContent=task.type==='timer'||task.type==='academic'||task.type==='trading'?'TIMER ACTIVE':punctual?'ON TIME':'LATE';$('#punctualityBadge').classList.toggle('late',!punctual);
    $('#deadlineCountdown').textContent=`${formatDuration(deadlineMs)} LEFT`;
    const customLayout=['audit','planner','academic','trading','workout'].includes(task.type);
    $('#focusCard').dataset.layout=customLayout?'custom':task.type==='timer'?'timed':'plain';
    $('#focusSigil').hidden=customLayout;
    setGlyph('focusIcon',task.icon||config.icon);$('#subtaskType').textContent=protocol.boss&&['execution-plan'].includes(task.id)?'WEEKLY BOSS DIRECTIVE':'CURRENT DIRECTIVE';
    $('#subtaskTitle').textContent=task.title;$('#subtaskCopy').textContent=stepCopy(task);
    const resolvedSteps=protocol.steps.filter(step=>['completed','skipped'].includes(step.status)).length;$('#completedSteps').textContent=`${resolvedSteps} / ${protocol.steps.length} resolved`;const skippable=task.allowSkip===true||task.required===false||['timer','academic','trading','workout'].includes(task.type);$('#skipDirectiveButton').hidden=!skippable;$('#skipDirectiveButton').textContent=task.required!==false?'Skip Directive · No Perfect Clear':'Skip Optional Directive';
    $('#protocolXp').textContent=`${Math.round(config.xp*(protocol.boss?1.35:1))} XP available`;
    $('#focusNote').textContent=protocol.boss?(record.weeklyBossPlan?.copy||'Complete the adaptive Weekly Boss objective.'):config.id==='workout'?'15–45 minute dungeon · 5-minute cooldown · shower and recovery · classes take priority.':'Complete every required stage before the fixed deadline.';
    if(task.type==='audit')renderAudit(protocol,task);
    else if(task.type==='planner')renderPlanner(protocol,task);
    else if(task.type==='academic')renderAcademic(protocol,task);
    else if(task.type==='trading')renderTrading(protocol,task);
    else if(task.type==='workout')renderWorkoutDungeon(protocol,task);
    else renderStandardTask(record,protocol,task);
  };

  const renderResult=record=>{
    releaseWakeLock();show('resultScreen');document.body.dataset.state=record.status==='cleared'?'active':'critical';
    const cleared=record.status==='cleared';$('#resultEmblem').classList.toggle('failed',!cleared);setGlyph('resultEmblem',cleared?'success':'failure');
    $('#resultEyebrow').textContent=cleared?(record.rankAdvanced?'RANK ADVANCED':record.perfectClear?'PERFECT CLEAR':record.weeklyBossCleared?'WEEKLY BOSS DEFEATED':'DAY CLEARED'):'DAY FAILED';
    $('#resultTitle').textContent=cleared?'Discipline Maintained':'Discipline Broken';
    $('#resultMessage').textContent=cleared?'Every required protocol was completed before the daily cutoff.':'At least one required protocol failed. The streak and Daily Clear were lost; XP from directives already cleared remains earned.';
    const resultRequired=Object.values(record.protocols||{}).filter(protocol=>protocol.required!==false&&!protocol.excused);$('#resultProtocols').textContent=`${resultRequired.filter(protocol=>protocol.status==='cleared').length}/${resultRequired.length}`;$('#resultOnTime').textContent=`${record.onTimePercentage}%`;$('#resultXp').textContent=record.totalXp;$('#resultLevel').textContent=`${state.player.level} · ${state.player.rank}`;
    const sealText=record.rankAdvanced?`${state.player.rank}-RANK ACHIEVED`:record.perfectClear?'PERFECT CLEAR':record.rankTrialFailed?'RANK-UP TRIAL FAILED':record.weeklyBossCleared?'WEEKLY BOSS DEFEATED':'';
    $('#resultSeal').hidden=!sealText;$('#resultSeal').textContent=sealText;$('#resultSeal').classList.toggle('failed',record.rankTrialFailed);
    $('#autoReward').hidden=!cleared;$('#rewardText').textContent=record.automaticReward||'';$('#masteryMessage').hidden=!state.player.mastered;
    $('#tomorrowNote').textContent=`Tomorrow begins again at ${formatTime(systemWakeTime())}.`;
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
    if(transitionLocked)return;
    const now=new Date();
    if(isSleepWindow(now)){renderSleep(now);return}
    if(record.status!=='active'){renderResult(record);return}
    if(!record.wakeCheckInAt&&isEarlyWakeWindow(now)){
      if(earlyWakeDismissedSession)renderSleep(now,true);else renderEarlyWake();
      return;
    }
    const config=findCurrentProtocol(record,now);
    const classState=classStateAt(now);
    if(classState&&config?.id==='workout'){renderClassScreen(classState,now);return}
    if(config){renderProtocol(record,config);return}
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

  const skipCurrentDirective=async()=>{
    const record=dayRecord(),protocol=activeProtocolRecord();if(!record||!protocol)return;const task=currentStep(protocol);if(!task)return;
    const skippable=task.allowSkip===true||task.required===false||['timer','academic','trading','workout'].includes(task.type);if(!skippable)return;
    if(!transitionStep(task,'skipped',new Date().toISOString()))return;task.skipReason='Skipped manually';if(task.required!==false&&task.perfectRequired!==false)protocol.hadRequiredSkip=true;
    state.logs.push({id:S.uid('log'),at:task.completedAt,type:'subtask',message:`${task.title} skipped${task.required!==false?' · required skip recorded':''}.`});save();
    await showOverlay('DIRECTIVE SKIPPED',task.title,task.required!==false?'PERFECT CLEAR LOCKED':'OPTIONAL');if(!currentStep(protocol))await clearProtocol(record,protocol);else renderApp();
  };

  const beginAction=()=>{
    const protocol=activeProtocolRecord(),task=currentStep(protocol);if(!task||$('#actionButton').disabled)return;
    if(task.type==='tap')completeSubtask();
    else if(task.type==='timer'){
      if(task.status==='pending'){transitionStep(task,'active',new Date().toISOString());save();systemFeedback('start','Timed directive started.',`timer-${protocol.id}-${task.id}-${task.startedAt}`);renderApp()}
      else if(Date.now()-new Date(task.startedAt).getTime()>=task.duration*60000)completeSubtask();
    }
  };

  const criticalConfirmationOwners=new Set(['action','class-confirm','early-wake']);
  const confirmationContext=owner=>{
    if(owner==='action'){const protocol=activeProtocolRecord(),task=currentStep(protocol),record=dayRecord();return protocol&&task&&record?{token:`${record.date}|${protocol.id}|${protocol.status}|${task.id}|${task.status}`,deadline:recordMoment(record,protocol.end).getTime()}:null}
    if(owner==='class-confirm'){const context=currentClassContext,entry=context?.entry;return context&&entry?{token:`${S.dateKey()}|${entry.id}|${context.mode}|${context.record?.status||'none'}`,deadline:context.end?.getTime?.()||Infinity}:null}
    if(owner==='early-wake'){const record=dayRecord();return{token:`${S.dateKey()}|early-wake|${record?.wakeCheckInAt||'pending'}`,deadline:timeOnDate(new Date(),systemWakeTime()).getTime()}}
    return{token:`${owner}|${Date.now()}`,deadline:Infinity};
  };
  const recordConfirmationAudit=(owner,result,reason,context)=>{
    state.system.auditTrail=state.system.auditTrail||[];const entry={id:S.uid('audit'),at:new Date().toISOString(),type:'confirmation',owner,result,reason,token:context?.token||null,source:'live'};state.system.auditTrail.push(entry);state.system.auditTrail=state.system.auditTrail.slice(-240);
    if(result!=='accepted')state.logs.push({id:S.uid('log'),at:entry.at,type:'system',message:`${owner} confirmation ${result}: ${reason}.`});S.save(state);
  };
  const validateConfirmation=(owner,startContext)=>{
    if(!criticalConfirmationOwners.has(owner))return{ok:true};
    if(document.visibilityState!=='visible')return{ok:false,reason:'ASCEND was not visible through the full confirmation'};
    const current=confirmationContext(owner);if(!startContext||!current||current.token!==startContext.token)return{ok:false,reason:'The active state changed during confirmation'};
    if(owner==='action'&&Date.now()>=Number(startContext.deadline||Infinity))return{ok:false,reason:'The protocol deadline passed before confirmation completed'};
    if(owner==='class-confirm'&&!['approaching','checkin'].includes(currentClassContext?.mode))return{ok:false,reason:'The class check-in window changed'};
    if(processedConfirmationTokens.has(startContext.token))return{ok:false,reason:'This confirmation was already processed'};
    return{ok:true,current};
  };
  const cancelHold=(owner=null)=>{
    if(!holdSession)return;if(owner&&holdSession.owner!==owner)return;
    const cancelled=holdSession;cancelAnimationFrame(cancelled.raf);cancelled.onProgress?.(0);
    if(navigator.vibrate)navigator.vibrate(0);
    document.body.classList.remove('hold-active');delete document.body.dataset.holdOwner;holdSession=null;
    if(criticalConfirmationOwners.has(cancelled.owner)&&Number(cancelled.progress||0)>=.25)recordConfirmationAudit(cancelled.owner,'interrupted','Hold released or visibility changed before completion',cancelled.context);
  };
  const beginHold=(owner,duration,onProgress,onComplete)=>{
    cancelHold();const started=performance.now(),checkpoints=[.25,.5,.75],checkpointOwners=new Set(['brand','emergency-exit','clock-backup']),context=confirmationContext(owner);let checkpointIndex=0;
    document.body.classList.add('hold-active');document.body.dataset.holdOwner=owner;
    const frame=now=>{
      const progress=clamp((now-started)/duration,0,1);if(holdSession)holdSession.progress=progress;onProgress?.(progress);
      if(checkpointOwners.has(owner)&&checkpointIndex<checkpoints.length&&progress>=checkpoints[checkpointIndex]){haptic(checkpointIndex===1?'hold-mid':'hold');checkpointIndex+=1}
      if(progress>=1){
        holdSession=null;onProgress?.(0);document.body.classList.remove('hold-active');delete document.body.dataset.holdOwner;
        const validation=validateConfirmation(owner,context);if(!validation.ok){recordConfirmationAudit(owner,'rejected',validation.reason,context);haptic('failed');showBreachWarning('CONFIRMATION REJECTED',validation.reason);return}
        if(criticalConfirmationOwners.has(owner)){processedConfirmationTokens.add(context.token);recordConfirmationAudit(owner,'accepted','State, visibility, and deadline checks passed',context)}
        haptic('hold-final');onComplete();
      }else holdSession.raf=requestAnimationFrame(frame);
    };
    holdSession={owner,raf:requestAnimationFrame(frame),onProgress,progress:0,context};
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

  const addAcademicTask=(subject,title,deadline,difficulty,note,workloadMinutes=30)=>{
    state.academicTasks.push({id:S.uid('task'),subjectKey:subject.key,subjectName:subject.name,title,deadline,difficulty,note,status:'pending',createdAt:new Date().toISOString(),workMinutes:0,workloadMinutes:Number(workloadMinutes||30),postponements:0,lastPostponedAt:null,completedAt:null,dependencyIds:[],sourceRuleId:null,occurrenceDate:null});save();
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
    if(action==='start-workout'&&step.type==='workout'){
      transitionStep(step,'active',new Date().toISOString());save();systemFeedback('start','Workout Dungeon started.',`workout-${protocol.id}-${step.startedAt}`);renderApp();return;
    }
    if(action==='end-workout'&&step.type==='workout'){
      const elapsed=workoutElapsed(step),minimum=Number(step.minDuration||15)*60000;if(elapsed<minimum)return;
      step.workoutEndedAt=new Date().toISOString();step.workoutDurationSeconds=Math.round(elapsed/1000);transitionStep(step,'completed',step.workoutEndedAt);
      const cooldown=currentStep(protocol);if(cooldown?.id==='workout-cooldown'&&cooldown.status==='pending')transitionStep(cooldown,'active',step.workoutEndedAt);
      state.logs.push({id:S.uid('log'),at:step.workoutEndedAt,type:'subtask',message:`Workout Dungeon completed after ${Math.round(elapsed/60000)} minute(s). Cooldown started.`});save();systemFeedback('clear','Workout complete. Cooldown started.');renderApp();return;
    }
    if(action==='exit-workout-early'&&step.type==='workout'){
      const elapsed=workoutElapsed(step);step.workoutEndedAt=new Date().toISOString();step.workoutDurationSeconds=Math.round(elapsed/1000);transitionStep(step,'completed',step.workoutEndedAt);failProtocol(dayRecord(),protocol,'Workout Dungeon ended before the 15-minute minimum.',true);showBreachWarning('WORKOUT ENDED EARLY','Minimum dungeon duration was not reached. Workout receives 0 XP and does not clear.');renderApp();return;
    }
    if(action==='finish-audit'){completeCustomStep();return}
    if(action==='complete-existing'){
      const task=state.academicTasks.find(item=>item.id===button.dataset.taskId);if(task){const blockers=taskBlockers(task);if(blockers.length){showBreachWarning('TASK LOCKED',`Complete ${blockers[0].title} first.`);return}task.status='completed';task.completedAt=new Date().toISOString();save();showBreachWarning('TASK COMPLETED',task.title);renderApp()}return;
    }
    if(action==='save-task'){
      captureAuditDraft();const subject=currentAuditSubject(step),draft=auditDraftFor(step);const title=String(draft.title||'').trim(),deadline=draft.deadline,difficulty=draft.difficulty||'Medium',workload=Number(draft.workload||30),note=String(draft.note||'').trim();
      if(!subject||!title||!deadline){showBreachWarning('TASK DATA INCOMPLETE','Task name and deadline are required.');return}
      step.auditState.draft=defaultAuditDraft();addAcademicTask(subject,title,deadline,difficulty,note,workload);showBreachWarning('TASK SAVED',`${subject.name}: ${title}`);renderApp();return;
    }
    if(action==='next-subject'){step.auditState.draft=defaultAuditDraft();step.auditState.index+=1;save();renderApp();return}
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
      const task=state.academicTasks.find(item=>item.id===step.taskId);if(task){task.workMinutes=(task.workMinutes||0)+step.duration;if(action==='task-completed'){task.status='completed';task.completedAt=new Date().toISOString()}else{task.postponements=Number(task.postponements||0)+1;task.lastPostponedAt=new Date().toISOString()}}
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
      if(['no-classes','cancel'].includes(type)){record.status='no-class';record.finalized=true;record.dismissalStatus='no-class';record.dismissedAt=new Date().toISOString();record.pendingXp=0;record.xpAwarded=0;record.updatedAt=new Date().toISOString()}
      else{record.scheduledStart=start;record.scheduledEnd=end;record.updatedAt=new Date().toISOString()}
    });
    invalidateExternalCalendar();state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'schedule',message:`Schedule exception saved for ${date}: ${type}.`});save();exceptionUi.index=0;renderScheduleExceptions();showSystemNotice('snapshot','SCHEDULE EXCEPTION SAVED','Only the selected date is affected.',2400);
  };
  const deleteScheduleException=()=>{
    const item=sortedExceptions()[exceptionUi.index];if(!item)return;state.scheduleExceptions=state.scheduleExceptions.filter(value=>value.id!==item.id);invalidateExternalCalendar();state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'schedule',message:`Schedule exception deleted for ${item.date}.`});save();exceptionUi.index=Math.max(0,exceptionUi.index-1);renderScheduleExceptions();
  };

  const notificationLeadMinutes=()=>Math.min(30,Math.max(5,Number(state.settings.notificationLeadMinutes||10)));
  const dateFromKey=key=>new Date(`${key}T12:00:00`);
  const addDays=(date,amount)=>{const value=new Date(date);value.setDate(value.getDate()+amount);return value};
  const mondayFor=date=>{const value=new Date(date);value.setHours(12,0,0,0);const day=value.getDay();value.setDate(value.getDate()-(day===0?6:day-1));return value};
  const percent=(value,total)=>total?Math.round(value/total*100):0;
  const completedTaskCount=()=>state.academicTasks.filter(task=>task.status==='completed').length;

  const dailyQuestCatalog={
    'wake-clear':{id:'wake-clear',title:'First Victory',copy:'Clear the Wake Protocol today.',xp:25},
    'academic-task':{id:'academic-task',title:'Academic Advance',copy:'Complete one pending academic task today.',xp:35},
    'timer-clear':{id:'timer-clear',title:'Timer Clear',copy:'Complete one timed directive today.',xp:40},
    'on-schedule':{id:'on-schedule',title:'On Schedule',copy:'Clear one required directive within its proper window.',xp:30},
    'clear-day':{id:'clear-day',title:'Complete the Sequence',copy:'Clear every required protocol today.',xp:50}
  };
  const questCandidatesForDate=date=>{
    const schoolDay=effectiveScheduleForDate(date).length>0;
    const hasPendingAcademic=state.academicTasks.some(task=>task.status!=='completed');
    const ids=schoolDay
      ?[...(hasPendingAcademic?['academic-task']:[]),'on-schedule','timer-clear','clear-day']
      :['wake-clear','on-schedule','timer-clear','clear-day'];
    return [...new Set(ids)].map(id=>dailyQuestCatalog[id]).filter(Boolean);
  };
  const chooseDailyQuest=date=>{
    const candidates=questCandidatesForDate(date),key=S.dateKey(date);
    const seed=[...key].reduce((sum,char)=>sum+char.charCodeAt(0),0);
    return candidates[seed%candidates.length]||dailyQuestCatalog['clear-day'];
  };
  const questProgress=quest=>{
    if(!quest)return{done:false,progress:0,label:'0 / 1'};
    const day=state.dayRecords?.[quest.date];let done=false;
    if(quest.id==='clear-day')done=day?.status==='cleared';
    if(quest.id==='wake-clear')done=day?.protocols?.wake?.status==='cleared';
    if(quest.id==='academic-task')done=completedTaskCount()>Number(quest.baselineCompleted||0);
    if(quest.id==='on-schedule')done=Boolean(day&&Object.values(day.protocols||{}).some(protocol=>protocol?.status==='cleared'&&protocolOnTime(day,protocol)));
    if(quest.id==='timer-clear')done=Boolean(day&&Object.values(day.protocols||{}).some(protocol=>(protocol?.steps||[]).some(step=>step?.type==='timer'&&step.status==='completed')));
    return{done,progress:done?1:0,label:done?'1 / 1':'0 / 1'};
  };
  const ensureDailyQuest=()=>{
    state.quests=state.quests||{daily:null,history:[]};const today=S.dateKey(),date=new Date(`${today}T12:00:00`),current=state.quests.daily;
    const template=current?.date===today?dailyQuestCatalog[current.id]:null;
    if(template){Object.assign(current,template);return current}
    if(current){state.quests.history=state.quests.history||[];state.quests.history.push({...current,expiredAt:new Date().toISOString(),completed:questProgress(current).done});state.quests.history=state.quests.history.slice(-60)}
    const chosen=chooseDailyQuest(date);
    state.quests.daily={...chosen,date:today,createdAt:new Date().toISOString(),claimed:false,baselineCompleted:completedTaskCount()};
    return state.quests.daily;
  };
  const claimDailyQuest=()=>{
    const quest=ensureDailyQuest(),progress=questProgress(quest);if(!progress.done||quest.claimed)return;
    quest.claimed=true;quest.claimedAt=new Date().toISOString();state.player.totalXp+=Number(quest.xp||25);
    state.logs.push({id:S.uid('log'),at:quest.claimedAt,type:'quest',message:`Daily Quest claimed: ${quest.title}. +${quest.xp} XP.`});save();systemFeedback('clear','Daily Quest reward claimed.');renderApp();
  };

  const buildWeeklyDebrief=(startDate,endDate,key)=>{
    const start=S.dateKey(startDate),end=S.dateKey(endDate),days=Object.values(state.dayRecords).filter(day=>day.date>=start&&day.date<=end),records=state.attendanceRecords.filter(record=>record.scheduledDate>=start&&record.scheduledDate<=end&&record.finalized),tasks=state.academicTasks.filter(task=>String(task.completedAt||'').slice(0,10)>=start&&String(task.completedAt||'').slice(0,10)<=end);
    const clears=days.filter(day=>day.status==='cleared').length,failures=days.filter(day=>day.status==='failed').length,attended=records.filter(record=>['early','present','late','partial'].includes(record.status)).length,required=records.filter(record=>['early','present','late','partial','absent'].includes(record.status)).length;
    const bestDay=[...days].sort((a,b)=>Number(b.completedProtocols||0)-Number(a.completedProtocols||0))[0];
    const reasons={};days.filter(day=>day.status==='failed').forEach(day=>{const reason=day.failureReason||'Missed sequence';reasons[reason]=(reasons[reason]||0)+1});
    const commonReason=Object.entries(reasons).sort((a,b)=>b[1]-a[1])[0]?.[0]||'No repeated failure pattern';
    const trend=clears>failures?'RISING':clears===failures?'STABLE':'REBUILDING';
    const completionRate=percent(clears,clears+failures),attendanceRate=percent(attended,required);
    const recommendation=completionRate<70?'Prioritize clearing every required directive next week.':attendanceRate<85?'Protect class attendance and punctuality next week.':tasks.length===0?'Complete at least one meaningful academic task next week.':'Maintain the current sequence and protect consistency.';
    return{id:S.uid('weekly'),key,start,end,createdAt:new Date().toISOString(),completionRate,attendanceRate,bestDay:bestDay?.date||'No clear day',commonReason,trend,bossCleared:days.some(day=>day.weeklyBossCleared),tasksCompleted:tasks.length,recommendation};
  };
  const ensureWeeklyDebrief=()=>{
    state.weeklyDebriefs=state.weeklyDebriefs||[];const thisMonday=mondayFor(new Date()),end=addDays(thisMonday,-1),start=addDays(end,-6),key=S.dateKey(start);
    if(state.weeklyDebriefs.some(item=>item.key===key))return;
    const hasData=Object.values(state.dayRecords).some(day=>day.date>=S.dateKey(start)&&day.date<=S.dateKey(end))||state.attendanceRecords.some(record=>record.scheduledDate>=S.dateKey(start)&&record.scheduledDate<=S.dateKey(end));
    if(!hasData)return;state.weeklyDebriefs.push(buildWeeklyDebrief(start,end,key));state.weeklyDebriefs=state.weeklyDebriefs.slice(-16);state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'weekly',message:`Weekly Debrief created for ${S.dateKey(start)}.`});
  };

  const recurringRuleDue=(rule,date)=>{
    const key=S.dateKey(date);if(key<rule.startDate)return false;
    if(rule.cadence==='daily')return true;
    if(rule.cadence==='weekdays')return (rule.weekdays||[]).includes(date.getDay());
    if(rule.cadence==='monthly')return date.getDate()===Number(rule.dayOfMonth||1);
    return date.getDay()===(rule.weekdays?.[0]??new Date(`${rule.startDate}T12:00:00`).getDay());
  };
  const generateRecurringTasks=()=>{
    const today=new Date(),oldest=addDays(today,-34);let generated=0;
    (state.recurringTaskRules||[]).filter(rule=>rule.active).forEach(rule=>{
      let cursor=new Date(Math.max(dateFromKey(rule.startDate).getTime(),oldest.getTime()));cursor.setHours(12,0,0,0);
      for(;cursor<=today;cursor=addDays(cursor,1)){
        const occurrence=S.dateKey(cursor);if(!recurringRuleDue(rule,cursor))continue;
        if(state.academicTasks.some(task=>task.sourceRuleId===rule.id&&task.occurrenceDate===occurrence))continue;
        state.academicTasks.push({id:S.uid('task'),subjectKey:rule.subjectKey,subjectName:rule.subjectName,title:rule.title,deadline:occurrence,difficulty:rule.difficulty,note:rule.note,status:'pending',createdAt:new Date().toISOString(),completedAt:null,workMinutes:0,dependencyIds:[...(rule.dependencyTemplateIds||[])],sourceRuleId:rule.id,occurrenceDate:occurrence});rule.lastGeneratedDate=occurrence;generated+=1;
      }
    });
    return generated;
  };

  const detectTimezoneChange=()=>{
    state.timezone=state.timezone||{name:S.timezoneName(),offset:S.timezoneOffset(),history:[],pending:null,ignoredDevice:null};
    const name=S.timezoneName(),offset=S.timezoneOffset();if(state.timezone.name===name&&Number(state.timezone.offset)===offset)return false;
    if(state.timezone.ignoredDevice?.name===name&&Number(state.timezone.ignoredDevice?.offset)===offset)return false;
    state.timezone.pending={fromName:state.timezone.name,fromOffset:Number(state.timezone.offset),toName:name,toOffset:offset,detectedAt:new Date().toISOString()};return true;
  };
  const timezoneOffsetLabel=value=>`${Number(value)>=0?'+':''}${Math.floor(Number(value)/60)}:${String(Math.abs(Number(value))%60).padStart(2,'0')}`;
  const showTimezoneOverlay=()=>{
    const overlay=$('#timezoneOverlay');if(!overlay)return;const pending=state.timezone?.pending;
    $('#timezoneComparison').innerHTML=pending?`<div><span>PREVIOUS</span><strong>${escapeHtml(pending.fromName)}</strong><small>UTC ${timezoneOffsetLabel(pending.fromOffset)}</small></div><div><span>CURRENT</span><strong>${escapeHtml(pending.toName)}</strong><small>UTC ${timezoneOffsetLabel(pending.toOffset)}</small></div>`:`<div><span>CURRENT TIMEZONE</span><strong>${escapeHtml(state.timezone.name)}</strong><small>UTC ${timezoneOffsetLabel(state.timezone.offset)}</small></div>`;
    $('#confirmTimezoneTravel').hidden=!pending;$('#keepPreviousTimezone').hidden=!pending;overlay.hidden=false;timezonePromptShown=true;
  };
  const confirmTimezoneChange=()=>{
    const pending=state.timezone?.pending;if(!pending)return;
    state.timezone.history.push({...pending,confirmedAt:new Date().toISOString()});state.timezone.name=pending.toName;state.timezone.offset=pending.toOffset;state.timezone.confirmedAt=new Date().toISOString();state.timezone.pending=null;state.timezone.ignoredDevice=null;invalidateExternalCalendar();
    state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'system',message:`Timezone change confirmed: ${pending.fromName} to ${pending.toName}. Existing records retained their original timezone.`});save();$('#timezoneOverlay').hidden=true;renderReliability();
  };
  const rejectTimezoneChange=()=>{const pending=state.timezone?.pending;if(pending){state.timezone.ignoredDevice={name:pending.toName,offset:pending.toOffset,ignoredAt:new Date().toISOString()};state.timezone.pending=null;state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'system',message:`Device timezone ${pending.toName} ignored; ASCEND kept ${pending.fromName}.`});save({silent:true})}$('#timezoneOverlay').hidden=true;renderReliability()};

  const readBootGuard=()=>{try{return JSON.parse(safeSession.get(BOOT_GUARD_KEY)||'null')}catch(error){return null}};
  const beginBootGuard=()=>{
    const previous=readBootGuard(),recent=previous?.pending&&Date.now()-Number(previous.startedAt||0)<10*60*1000,failures=recent?Number(previous.failures||0)+1:0;
    safeSession.set(BOOT_GUARD_KEY,JSON.stringify({pending:true,startedAt:Date.now(),failures}));
    if(failures>=2){state.system.safeMode=true;state.system.recoveredFrom=state.system.recoveredFrom||'startup-guard';return true}return false;
  };
  const completeBootGuard=()=>{clearTimeout(bootCompletionTimer);state.system.lastSuccessfulBoot=new Date().toISOString();safeSession.set(BOOT_GUARD_KEY,JSON.stringify({pending:false,startedAt:Date.now(),failures:0}));S.save(state)};
  const applySafeMode=()=>{document.body.classList.toggle('safe-mode',Boolean(state.system?.safeMode));if(state.system?.safeMode){releaseWakeLock();const splash=$('#launchSplash');if(splash)splash.hidden=true;launchDismissed=true}};

  const scanAcademicConflicts=()=>{
    const issues=[];
    const add=(severity,type,title,copy)=>issues.push({id:`${type}-${issues.length}`,severity,type,title,copy});
    const byDay=new Map();activeSchedule().forEach(entry=>{const day=Number(entry.day);if(!byDay.has(day))byDay.set(day,[]);byDay.get(day).push(entry);const start=minutes(entry.start),end=minutes(entry.end);if(start>=end)add('critical','schedule','Invalid class window',`${entry.subject} ends before or at its start time.`);if(start<450||end>1170)add('warning','schedule','Class outside daytime window',`${entry.subject} is outside 7:30 AM–7:30 PM.`)});
    byDay.forEach((entries,day)=>{const sorted=[...entries].sort((a,b)=>minutes(a.start)-minutes(b.start));for(let i=0;i<sorted.length;i+=1)for(let j=i+1;j<sorted.length;j+=1){if(minutes(sorted[j].start)<minutes(sorted[i].end))add('critical','schedule','Overlapping classes',`${scheduleDayName(day)}: ${sorted[i].subject} overlaps ${sorted[j].subject}.`)}});
    const byDate=new Map();(state.scheduleExceptions||[]).filter(item=>item.active!==false).forEach(item=>{if(!byDate.has(item.date))byDate.set(item.date,[]);byDate.get(item.date).push(item)});
    byDate.forEach((items,date)=>{if(items.some(item=>item.type==='no-classes')&&items.length>1)add('critical','exception','Conflicting date exceptions',`${date} has No Classes plus another exception.`);const seen=new Set();items.forEach(item=>{const key=`${item.classId||'all'}|${item.type}`;if(seen.has(key))add('warning','exception','Duplicate schedule exception',`${date} contains repeated ${item.type} rules for the same class.`);seen.add(key);if(['reschedule','special'].includes(item.type)){const start=minutes(item.start||'00:00'),end=minutes(item.end||'00:00');if(start>=end)add('critical','exception','Invalid exception time',`${date}: ${item.note||item.type} has an invalid time window.`)}});const timed=items.filter(item=>['reschedule','special'].includes(item.type)&&item.start&&item.end);for(let i=0;i<timed.length;i+=1)for(let j=i+1;j<timed.length;j+=1){if(minutes(timed[j].start)<minutes(timed[i].end)&&minutes(timed[j].end)>minutes(timed[i].start))add('warning','exception','Overlapping exception events',`${date}: two rescheduled or special events overlap.`)}});
    state.academicTasks.filter(task=>task.status!=='completed').forEach(task=>(task.dependencyIds||[]).map(taskById).filter(Boolean).forEach(required=>{if(task.deadline&&required.deadline&&task.deadline<required.deadline)add('critical','dependency','Dependency deadline conflict',`${task.title} is due before prerequisite ${required.title}.`)}));
    const ruleKeys=new Map();(state.recurringTaskRules||[]).filter(rule=>rule.active).forEach(rule=>{const key=[rule.subjectKey,String(rule.title).toLowerCase(),rule.cadence,rule.startDate,(rule.weekdays||[]).join(','),rule.dayOfMonth].join('|');if(ruleKeys.has(key))add('warning','recurring','Duplicate recurring rule',`${rule.title} duplicates another active rule.`);else ruleKeys.set(key,rule.id)});
    const occurrenceKeys=new Set();state.academicTasks.filter(task=>task.sourceRuleId&&task.occurrenceDate).forEach(task=>{const key=`${task.sourceRuleId}|${task.occurrenceDate}`;if(occurrenceKeys.has(key))add('critical','recurring','Duplicate generated occurrence',`${task.title} was generated more than once for ${task.occurrenceDate}.`);occurrenceKeys.add(key)});
    return issues.sort((a,b)=>(a.severity==='critical'?0:1)-(b.severity==='critical'?0:1)||a.type.localeCompare(b.type));
  };
  const renderConflictRecord=()=>{
    const issues=conflictUi.issues||[];conflictUi.index=clamp(conflictUi.index,0,Math.max(0,issues.length-1));const issue=issues[conflictUi.index];
    $('#conflictSummary').innerHTML=`<div><span>STATUS</span><strong class="${issues.length?'critical-text':''}">${issues.length?'REVIEW':'CLEAR'}</strong></div><div><span>ISSUES</span><strong>${issues.length}</strong></div>`;
    $('#conflictRecord').innerHTML=issue?`<span>${escapeHtml(issue.severity.toUpperCase())} · ${escapeHtml(issue.type.toUpperCase())}</span><strong>${escapeHtml(issue.title)}</strong><small>${escapeHtml(issue.copy)}</small>`:'<span>SCAN COMPLETE</span><strong>No academic conflicts detected</strong><small>Schedule, exceptions, dependencies, and recurring rules are consistent.</small>';
    $('#conflictNav').hidden=issues.length<=1;$('#conflictPageLabel').textContent=issues.length?`${conflictUi.index+1} / ${issues.length}`:'0 / 0';$('#conflictPrev').disabled=conflictUi.index===0;$('#conflictNext').disabled=conflictUi.index>=issues.length-1;
  };
  const renderConflictScan=(run=true)=>{setControlView('conflictScanView');if(run){conflictUi.issues=scanAcademicConflicts();conflictUi.index=0;state.system.lastConflictScan={at:new Date().toISOString(),issues:conflictUi.issues.length};state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'system',message:`Academic conflict scan completed with ${conflictUi.issues.length} issue(s).`});save({silent:true})}renderConflictRecord()};

  const runDataConsistencyWatchdog=(notify=true)=>{
    let issues=0,repairs=0;const repairNotes=[];
    Object.values(state.dayRecords||{}).forEach(day=>{const protocols=Object.values(day.protocols||{}),completed=protocols.filter(item=>item.status==='cleared').length,failed=protocols.filter(item=>item.status==='failed').length;if(day.completedProtocols!==completed){issues+=1;repairs+=1;day.completedProtocols=completed;repairNotes.push(`Corrected ${day.date} completed count`)}if(day.failedProtocols!==failed){issues+=1;repairs+=1;day.failedProtocols=failed;repairNotes.push(`Corrected ${day.date} failure count`)}});
    const validTaskIds=new Set(state.academicTasks.map(task=>task.id));state.academicTasks.forEach(task=>{const before=(task.dependencyIds||[]).length;task.dependencyIds=[...new Set((task.dependencyIds||[]).filter(id=>id!==task.id&&validTaskIds.has(id)))];if(task.dependencyIds.length!==before){issues+=1;repairs+=1;repairNotes.push(`Repaired dependencies for ${task.title}`)}});
    const occurrenceSeen=new Set(),duplicateTaskIds=new Set();state.academicTasks.forEach(task=>{if(!task.sourceRuleId||!task.occurrenceDate)return;const key=`${task.sourceRuleId}|${task.occurrenceDate}`;if(occurrenceSeen.has(key)){issues+=1;repairs+=1;duplicateTaskIds.add(task.id)}else occurrenceSeen.add(key)});if(duplicateTaskIds.size)state.academicTasks=state.academicTasks.filter(task=>!duplicateTaskIds.has(task.id));
    const attendanceByMeeting=new Map();state.attendanceRecords.forEach(record=>{if(!record.meetingKey)return;const existing=attendanceByMeeting.get(record.meetingKey);if(!existing)attendanceByMeeting.set(record.meetingKey,record);else{issues+=1;const keep=(record.finalized&&!existing.finalized)||(String(record.updatedAt)>String(existing.updatedAt))?record:existing;attendanceByMeeting.set(record.meetingKey,keep)}});if(attendanceByMeeting.size&&attendanceByMeeting.size<state.attendanceRecords.filter(record=>record.meetingKey).length){const noKey=state.attendanceRecords.filter(record=>!record.meetingKey);state.attendanceRecords=[...noKey,...attendanceByMeeting.values()];repairs+=1;repairNotes.push('Removed duplicate attendance records')}
    ['totalXp','streak','bestStreak','totalClearDays','totalFailedDays','levelClearDays'].forEach(key=>{if(Number(state.player[key]||0)<0){issues+=1;repairs+=1;state.player[key]=0;repairNotes.push(`Corrected negative ${key}`)}});
    state.system.watchdog={lastRun:new Date().toISOString(),issues,repairs,summary:issues?`${repairs} repair(s) from ${issues} issue(s)`:'All consistency checks passed'};state.system.auditTrail=state.system.auditTrail||[];state.system.auditTrail.push({id:S.uid('audit'),at:state.system.watchdog.lastRun,type:'watchdog',before:null,after:{issues,repairs},reason:repairNotes.slice(0,8).join('; ')||'No repair required',source:'automatic'});state.system.auditTrail=state.system.auditTrail.slice(-240);state.logs.push({id:S.uid('log'),at:state.system.watchdog.lastRun,type:'watchdog',message:`Data watchdog completed: ${issues} issue(s), ${repairs} repair(s).`});save({silent:true});if(notify)showSystemNotice(issues?'alert':'save',issues?'CONSISTENCY REPAIRS COMPLETE':'DATA CONSISTENCY CLEAR',state.system.watchdog.summary,3200);return state.system.watchdog;
  };

  const renderAcademicTasks=()=>{setControlView('academicTasksView');renderTaskManager()};
  const taskSubjectsOptions=()=>{const subjects=subjectCatalog();return subjects.length?subjects.map(item=>`<option value="${escapeHtml(item.key)}" data-name="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join(''):'<option value="general" data-name="General">General</option>'};
  const renderTaskManager=()=>{
    document.querySelectorAll('#taskManagerTabs [data-task-tab]').forEach(button=>button.classList.toggle('selected',button.dataset.taskTab===controlUi.taskTab));
    const content=$('#taskManagerContent');
    if(controlUi.taskTab==='tasks'){
      const tasks=[...state.academicTasks].sort((a,b)=>String(a.status).localeCompare(String(b.status))||String(a.deadline||'9999').localeCompare(String(b.deadline||'9999')));controlUi.taskIndex=clamp(controlUi.taskIndex,0,Math.max(0,tasks.length-1));const task=tasks[controlUi.taskIndex],blockers=task?taskBlockers(task):[];
      content.innerHTML=`<div class="manager-form task-create-form"><label>Subject<select id="managerTaskSubject">${taskSubjectsOptions()}</select></label><label>Task<input id="managerTaskTitle" maxlength="80" placeholder="Task title"></label><label>Deadline<input id="managerTaskDeadline" type="date" value="${S.dateKey()}"></label><label>Difficulty<select id="managerTaskDifficulty"><option>Low</option><option selected>Medium</option><option>High</option></select></label><label>Workload<select id="managerTaskWorkload"><option value="15">15 min</option><option value="30" selected>30 min</option><option value="60">1 hour</option><option value="120">2 hours</option><option value="180">Multi-session</option></select></label><button type="button" data-task-action="create-task">Add Task</button></div>${task?`<div class="manager-record ${blockers.length?'locked':''}"><span>${escapeHtml(task.subjectName)} · ${task.deadline||'NO DEADLINE'}</span><strong>${escapeHtml(task.title)}</strong><small>${task.status==='completed'?'COMPLETED':blockers.length?`LOCKED BY ${escapeHtml(blockers.map(item=>item.title).join(', '))}`:`${taskRiskInfo(task).level} RISK · ${taskRiskInfo(task).workload} MIN · ${taskRiskInfo(task).fit}`}</small><div class="mini-nav"><button type="button" data-task-action="task-prev">${glyphMarkup('chevron-left')}</button><b>${controlUi.taskIndex+1} / ${tasks.length}</b><button type="button" data-task-action="task-next">${glyphMarkup('chevron-right')}</button></div><div class="manager-record-actions"><button type="button" data-task-action="complete-task" ${task.status==='completed'||blockers.length?'disabled':''}>Complete</button><button type="button" data-task-action="delete-task">Delete</button></div></div>`:'<div class="schedule-empty"><strong>No Academic Tasks</strong><span>Create a task without adding anything to the main screen.</span></div>'}`;
    }else if(controlUi.taskTab==='recurring'){
      const rules=state.recurringTaskRules||[];controlUi.ruleIndex=clamp(controlUi.ruleIndex,0,Math.max(0,rules.length-1));const rule=rules[controlUi.ruleIndex];
      content.innerHTML=`<div class="manager-form recurring-form"><label>Subject<select id="ruleSubject">${taskSubjectsOptions()}</select></label><label>Task<input id="ruleTitle" maxlength="80" placeholder="Recurring task"></label><label>Repeat<select id="ruleCadence"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="weekdays">Selected Weekdays</option><option value="monthly">Monthly</option></select></label><label>Start<input id="ruleStart" type="date" value="${S.dateKey()}"></label><label class="weekday-field">Days<select id="ruleWeekdays" multiple><option value="1">Mon</option><option value="2">Tue</option><option value="3">Wed</option><option value="4">Thu</option><option value="5">Fri</option><option value="6">Sat</option><option value="0">Sun</option></select></label><button type="button" data-task-action="create-rule">Create Rule</button></div>${rule?`<div class="manager-record"><span>${rule.active?'ACTIVE':'PAUSED'} · ${escapeHtml(rule.cadence.toUpperCase())}</span><strong>${escapeHtml(rule.title)}</strong><small>${escapeHtml(rule.subjectName)} · Last generated ${rule.lastGeneratedDate||'never'}</small><div class="mini-nav"><button type="button" data-task-action="rule-prev">${glyphMarkup('chevron-left')}</button><b>${controlUi.ruleIndex+1} / ${rules.length}</b><button type="button" data-task-action="rule-next">${glyphMarkup('chevron-right')}</button></div><div class="manager-record-actions"><button type="button" data-task-action="toggle-rule">${rule.active?'Pause':'Resume'}</button><button type="button" data-task-action="delete-rule">Delete</button></div></div>`:'<div class="schedule-empty"><strong>No Recurring Rules</strong><span>Rules automatically create dated task occurrences.</span></div>'}`;
    }else{
      const tasks=state.academicTasks.filter(task=>task.status!=='completed');controlUi.dependencyIndex=clamp(controlUi.dependencyIndex,0,Math.max(0,tasks.length-1));const selected=tasks[controlUi.dependencyIndex];const options=tasks.map(task=>`<option value="${task.id}">${escapeHtml(task.title)}</option>`).join('');const links=(selected?.dependencyIds||[]).map(taskById).filter(Boolean);
      content.innerHTML=tasks.length>1?`<div class="dependency-form"><label>Locked task<select id="dependencyTask">${options}</select></label><label>Requires<select id="dependencyRequired">${options}</select></label><button type="button" data-task-action="add-dependency">Link Tasks</button></div><div class="manager-record"><span>DEPENDENCY ${controlUi.dependencyIndex+1} / ${tasks.length}</span><strong>${escapeHtml(selected.title)}</strong><small>${links.length?`Requires: ${escapeHtml(links.map(item=>item.title).join(', '))}`:'No prerequisite linked.'}</small><div class="mini-nav"><button type="button" data-task-action="dependency-prev">${glyphMarkup('chevron-left')}</button><b>${controlUi.dependencyIndex+1} / ${tasks.length}</b><button type="button" data-task-action="dependency-next">${glyphMarkup('chevron-right')}</button></div>${links.length?`<button type="button" data-task-action="remove-dependency" data-dependency-id="${links[0].id}">Remove ${escapeHtml(links[0].title)}</button>`:''}</div>`:'<div class="schedule-empty"><strong>Two Pending Tasks Required</strong><span>Create at least two tasks before defining an execution dependency.</span></div>';
      if(selected){const taskSelect=$('#dependencyTask');if(taskSelect)taskSelect.value=selected.id}
    }
  };
  const handleTaskManagerAction=event=>{
    const button=event.target.closest('[data-task-action]');if(!button)return;const action=button.dataset.taskAction;
    if(action==='create-task'){
      const select=$('#managerTaskSubject'),title=$('#managerTaskTitle')?.value.trim(),deadline=$('#managerTaskDeadline')?.value,difficulty=$('#managerTaskDifficulty')?.value||'Medium',workload=Number($('#managerTaskWorkload')?.value||30);if(!title){showBreachWarning('TASK REQUIRED','Enter a task title.');return}
      const option=select?.selectedOptions?.[0],subject={key:select?.value||'general',name:option?.dataset.name||option?.textContent||'General'};addAcademicTask(subject,title,deadline,difficulty,'',workload);controlUi.taskIndex=state.academicTasks.length-1;renderTaskManager();return;
    }
    const tasks=[...state.academicTasks].sort((a,b)=>String(a.status).localeCompare(String(b.status))||String(a.deadline||'9999').localeCompare(String(b.deadline||'9999'))),task=tasks[controlUi.taskIndex];
    if(action==='task-prev'){controlUi.taskIndex=Math.max(0,controlUi.taskIndex-1);renderTaskManager();return}if(action==='task-next'){controlUi.taskIndex=Math.min(Math.max(0,tasks.length-1),controlUi.taskIndex+1);renderTaskManager();return}
    if(action==='complete-task'&&task){const blockers=taskBlockers(task);if(blockers.length){showBreachWarning('TASK LOCKED',`Complete ${blockers[0].title} first.`);return}task.status='completed';task.completedAt=new Date().toISOString();save();renderTaskManager();return}
    if(action==='delete-task'&&task){state.academicTasks=state.academicTasks.filter(item=>item.id!==task.id);state.academicTasks.forEach(item=>{item.dependencyIds=(item.dependencyIds||[]).filter(id=>id!==task.id)});save();controlUi.taskIndex=Math.max(0,controlUi.taskIndex-1);renderTaskManager();return}
    if(action==='create-rule'){
      const select=$('#ruleSubject'),title=$('#ruleTitle')?.value.trim(),cadence=$('#ruleCadence')?.value||'weekly',startDate=$('#ruleStart')?.value||S.dateKey(),weekdays=[...($('#ruleWeekdays')?.selectedOptions||[])].map(item=>Number(item.value));if(!title){showBreachWarning('RULE REQUIRED','Enter a recurring task title.');return}
      const option=select?.selectedOptions?.[0];state.recurringTaskRules.push({id:S.uid('rule'),active:true,subjectKey:select?.value||'general',subjectName:option?.dataset.name||option?.textContent||'General',title,difficulty:'Medium',note:'',cadence,weekdays:weekdays.length?weekdays:[dateFromKey(startDate).getDay()],dayOfMonth:dateFromKey(startDate).getDate(),deadlineTime:'20:00',startDate,lastGeneratedDate:null,dependencyTemplateIds:[],createdAt:new Date().toISOString()});generateRecurringTasks();save();controlUi.ruleIndex=state.recurringTaskRules.length-1;renderTaskManager();return;
    }
    const rule=state.recurringTaskRules[controlUi.ruleIndex];if(action==='rule-prev'){controlUi.ruleIndex=Math.max(0,controlUi.ruleIndex-1);renderTaskManager();return}if(action==='rule-next'){controlUi.ruleIndex=Math.min(Math.max(0,state.recurringTaskRules.length-1),controlUi.ruleIndex+1);renderTaskManager();return}
    if(action==='toggle-rule'&&rule){rule.active=!rule.active;save();renderTaskManager();return}if(action==='delete-rule'&&rule){state.recurringTaskRules=state.recurringTaskRules.filter(item=>item.id!==rule.id);save();controlUi.ruleIndex=Math.max(0,controlUi.ruleIndex-1);renderTaskManager();return}
    const pending=state.academicTasks.filter(item=>item.status!=='completed'),selected=pending[controlUi.dependencyIndex];
    if(action==='dependency-prev'){controlUi.dependencyIndex=Math.max(0,controlUi.dependencyIndex-1);renderTaskManager();return}if(action==='dependency-next'){controlUi.dependencyIndex=Math.min(Math.max(0,pending.length-1),controlUi.dependencyIndex+1);renderTaskManager();return}
    if(action==='add-dependency'){
      const taskId=$('#dependencyTask')?.value,requiredId=$('#dependencyRequired')?.value,target=taskById(taskId);if(!target||!requiredId||taskId===requiredId){showBreachWarning('INVALID LINK','A task cannot require itself.');return}
      if(dependencyPathExists(requiredId,taskId)){showBreachWarning('DEPENDENCY LOOP BLOCKED','This link would create a circular task chain.');return}target.dependencyIds=[...new Set([...(target.dependencyIds||[]),requiredId])];save();controlUi.dependencyIndex=pending.findIndex(item=>item.id===taskId);renderTaskManager();return;
    }
    if(action==='remove-dependency'&&selected){selected.dependencyIds=(selected.dependencyIds||[]).filter(id=>id!==button.dataset.dependencyId);save();renderTaskManager()}
  };

  const renderAdvancedSystemHome=()=>{controlUi.directDeveloper=false;setControlView('advancedSystemHomeView')};
  const renderUpdatesRollback=()=>{
    setControlView('updatesRollbackView');const info=S.schemaInfo(),points=S.listRollbackPoints();controlUi.rollbackIndex=clamp(controlUi.rollbackIndex,0,Math.max(0,points.length-1));const point=points[controlUi.rollbackIndex];
    $('#updateSchemaSummary').innerHTML=`<div><span>SCHEMA</span><strong>V${info.version}</strong></div><div><span>ROLLBACKS</span><strong>${points.length}</strong></div><div><span>SNAPSHOTS</span><strong>${info.snapshotCount}</strong></div>`;
    $('#rollbackNav').hidden=points.length<=1;$('#rollbackPageLabel').textContent=points.length?`${controlUi.rollbackIndex+1} / ${points.length}`:'0 / 0';$('#rollbackPrev').disabled=controlUi.rollbackIndex===0;$('#rollbackNext').disabled=controlUi.rollbackIndex>=points.length-1;$('#restoreRollback').hidden=!point;
    $('#rollbackRecord').innerHTML=point?`<span>${formatShortDate(point.createdAt)} · SCHEMA ${point.fromVersion}</span><strong>${escapeHtml(point.label)}</strong><small>${escapeHtml(point.summary.playerName)} · Level ${Number(point.summary.level)||0} · ${Number(point.summary.days)||0} day records · ${Number(point.summary.tasks)||0} tasks</small>`:'<div class="schedule-empty"><strong>No Migration Rollback</strong><span>A rollback point is created automatically before a future data-schema migration.</span></div>';
  };
  const restoreSelectedRollback=()=>{const point=S.listRollbackPoints()[controlUi.rollbackIndex];if(!point)return;try{state=S.restoreRollbackPoint(point.id);state.system.safeMode=true;state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'restore',message:`Migration rollback restored from schema ${point.fromVersion}.`});save({silent:true});closeScheduleOverlay();activeScreenId=null;applySafeMode();renderApp();showBreachWarning('ROLLBACK RESTORED','Pre-update data was restored in Safe Mode.','clear')}catch(error){showBreachWarning('ROLLBACK FAILED',error.message||'Rollback data could not be restored.')}};
  const collectDiagnostics=async()=>{
    let persistent='UNKNOWN';try{persistent=navigator.storage?.persisted?await navigator.storage.persisted()?'READY':'AVAILABLE':'UNSUPPORTED'}catch(error){persistent='BLOCKED'}
    return[
      ['Installed PWA',matchMedia('(display-mode: standalone)').matches||navigator.standalone?'READY':'BROWSER'],
      ['Service Worker','serviceWorker' in navigator?'READY':'UNSUPPORTED'],
      ['Wake Lock','wakeLock' in navigator?'READY':'UNSUPPORTED'],
      ['Vibration','vibrate' in navigator?'READY':'UNSUPPORTED'],
      ['Notifications','Notification' in window?(Notification.permission==='granted'?'READY':Notification.permission.toUpperCase()):'UNSUPPORTED'],
      ['Persistent Storage',persistent],
      ['Backup Files','FileReader' in window&&'Blob' in window?'READY':'UNSUPPORTED'],
      ['Safe Mode',state.system.safeMode?'ACTIVE':'STANDBY']
    ];
  };
  const renderDiagnostics=async()=>{setControlView('diagnosticsView');$('#diagnosticGrid').innerHTML='<div class="diagnostic-loading">RUNNING CHECKS…</div>';const entries=await collectDiagnostics();$('#diagnosticGrid').innerHTML=entries.map(([label,value])=>`<div class="diagnostic-row ${['UNSUPPORTED','BLOCKED'].includes(value)?'failed':''}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');const watchdog=state.system.watchdog||{};$('#watchdogSummary').innerHTML=`<span>DATA WATCHDOG${watchdog.lastRun?` · ${formatShortDate(watchdog.lastRun)}`:''}</span><strong>${escapeHtml(watchdog.summary||'Not run')}</strong><small>${Number(watchdog.issues||0)} issue(s) · ${Number(watchdog.repairs||0)} repair(s)</small>`};
  const developerLabDefinition={protocol:'SYSTEM LAB',window:'NOTIFICATION & HAPTIC TEST',type:'DEVICE FEEDBACK',title:'Preview System Feedback',copy:'Trigger individual haptic patterns and safe local test alerts.',icon:'lab',detail:'LIVE PROGRESS · PROTECTED',action:'Hold to End Lab Session',note:'Use Exit Test to leave immediately, or hold below to finish the laboratory session.'};
  const createDeveloperSandbox=mode=>{
    const sandbox=clone(state);
    if(mode==='sample'){
      sandbox.player={...sandbox.player,name:'Test Player',codename:'Sandbox',level:12,rank:'C',streak:4,totalXp:1850};
      sandbox.dayRecords={};sandbox.attendanceRecords=[];sandbox.academicTasks=[];sandbox.scheduleExceptions=[];
      sandbox.classSchedule=Array.from({length:7},(_,day)=>({id:`sample-class-${day}`,subject:'Developer Test Class',code:'DEV 101',day,room:'Simulation Room',modality:'Onsite',start:'10:30',end:'12:00',active:true}));
    }
    sandbox.system={...sandbox.system,developerSandbox:true};return sandbox;
  };
  const addDeveloperEvent=(type,detail,data={})=>{if(!developerRunSession)return;developerRunSession.events.push({at:new Date(developerRunSession.simulatedAt).toISOString(),type,detail,...data})};
  const developerSandboxSummary=sandbox=>`${sandbox.player?.codename||sandbox.player?.name||'Player'} · Level ${sandbox.player?.level||1} · ${sandbox.classSchedule?.length||0} classes · ${sandbox.academicTasks?.filter(task=>task.status!=='completed').length||0} pending tasks`;
  const developerDateTimeValue=value=>{
    const date=value instanceof Date?value:new Date(value);if(Number.isNaN(date.getTime()))return'';
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };
  const developerStepCopy=(step,date)=>Array.isArray(step.copy)?step.copy[(date.getDate()+step.id.length)%step.copy.length]:step.copy;
  const developerClassesForDate=date=>{
    if(!developerRunSession)return[];const sandbox=developerRunSession.sandbox,key=S.dateKey(date),exceptions=(sandbox.scheduleExceptions||[]).filter(item=>item.active!==false&&item.date===key);
    if(exceptions.some(item=>item.type==='no-classes'))return[];
    let entries=(sandbox.classSchedule||[]).filter(entry=>entry.active!==false&&Number(entry.day)===date.getDay()).map(entry=>({...entry}));
    exceptions.forEach(exception=>{
      if(exception.type==='cancel')entries=entries.filter(entry=>entry.id!==exception.classId);
      if(['reschedule','special'].includes(exception.type))entries=entries.map(entry=>entry.id===exception.classId?{...entry,start:exception.start||entry.start,end:exception.end||entry.end,exceptionType:exception.type}:entry);
    });
    return entries.sort((a,b)=>minutes(a.start)-minutes(b.start));
  };
  const developerProtocolConfigsForDate=date=>protocolBlueprints.filter(config=>{
    if(config.enabled===false||!(config.activeDays||directiveDefaultDays[config.id]||[]).includes(date.getDay()))return false;
    if(config.id!=='workout')return true;
    const workout=blueprint('workout');return !developerClassesForDate(date).some(entry=>minutes(entry.start)-15<minutes(workout.end)&&minutes(entry.end)>minutes(workout.start));
  });
  const developerProtocolStepsForDate=(config,date)=>{
    const steps=config.subtasks(developerRunSession?.sandbox?.player?.level||1);
    if(config.id==='wake'&&developerProtocolConfigsForDate(date).some(item=>item.id==='workout'))return steps.filter(step=>step.id!=='bath');
    return steps;
  };
  const developerProtocolProgress=(date,config)=>{
    const session=developerRunSession,key=S.dateKey(date);session.protocolProgress=session.protocolProgress||{};session.protocolProgress[key]=session.protocolProgress[key]||{};
    if(!session.protocolProgress[key][config.id])session.protocolProgress[key][config.id]={stepIndex:config.id==='wake'?1:0,cleared:false,failed:false,timers:{}};
    return session.protocolProgress[key][config.id];
  };
  const developerAttendanceRecord=(entry,date)=>{
    const session=developerRunSession,key=`${S.dateKey(date)}::${entry.id}`;session.attendance=session.attendance||{};
    return session.attendance[key]||(session.attendance[key]={checkedInAt:null,status:'unverified',finalized:false,dismissedAt:null});
  };
  const developerNextEventMoment=from=>{
    if(!developerRunSession)return null;const candidates=[];
    for(let offset=0;offset<3;offset+=1){
      const date=new Date(from);date.setDate(from.getDate()+offset);date.setHours(0,0,0,0);
      const earlyMinute=earlyWakeStartMinute(),early=`${pad(Math.floor(earlyMinute/60))}:${pad(earlyMinute%60)}`;[[early,'Early Wake Window'],[systemWakeTime(),'Wake Protocol'],[systemDailyCutoff(date),'Recovery Window']].forEach(([time,label])=>candidates.push({at:timeOnDate(date,time),label}));
      developerProtocolConfigsForDate(date).forEach(config=>candidates.push({at:timeOnDate(date,config.start),label:config.name}));
      developerClassesForDate(date).forEach(entry=>candidates.push({at:timeOnDate(date,entry.start),label:`${entry.subject} Class`}));
    }
    return candidates.filter(item=>item.at>from).sort((a,b)=>a.at-b.at)[0]||null;
  };
  const developerClassStateAt=now=>{
    for(const entry of developerClassesForDate(now)){
      const record=developerAttendanceRecord(entry,now),start=timeOnDate(now,entry.start),end=timeOnDate(now,entry.end);
      if(record.finalized)continue;
      if(record.checkedInAt){
        if(now<end)return{mode:'active',entry,record,start,end};
        if(now-end<=60*60000)return{mode:'dismissal',entry,record,start,end};
        record.finalized=true;continue;
      }
      if(now>=start&&now<end)return{mode:'checkin',entry,record,start,end};
      if(now<start&&start-now<=15*60000)return{mode:'approaching',entry,record,start,end};
      if(now>=end&&now-end<=60*60000)return{mode:'resolve',entry,record,start,end};
    }
    return null;
  };
  const developerLiveStateAt=now=>{
    const session=developerRunSession;
    if(session.mode==='lab')return{kind:'lab',...developerLabDefinition,status:'LAB READY',countdown:'SESSION ACTIVE',resultClass:'success',layout:'lab',actionDisabled:false};
    const dateKey=S.dateKey(now),minute=todayMinutes(now);
    if(isSleepWindow(now)){
      const wake=nextWakeMoment(now),earlyMinute=earlyWakeStartMinute(),early=`${pad(Math.floor(earlyMinute/60))}:${pad(earlyMinute%60)}`;return{kind:'sleep',protocol:'RECOVERY WINDOW',window:`${formatTime(systemDailyCutoff(now))} – ${formatTime(early)}`,type:'SYSTEM STANDBY',title:'Recovery Window',copy:'ASCEND remains in low-power recovery until the Early Wake window opens.',icon:'sleep',detail:`WAKE PROTOCOL · ${formatClock(wake)}`,status:'STANDBY',countdown:`${formatDuration(Math.max(0,wake-now))} UNTIL WAKE`,resultClass:'success',layout:'plain',action:null,note:'Advance or edit simulated time to watch the next system state appear.'};
    }
    session.earlyWakeConfirmed=session.earlyWakeConfirmed||{};
    if(isEarlyWakeWindow(now)&&!session.earlyWakeConfirmed[dateKey]){
      const wake=timeOnDate(now,systemWakeTime()),earlyMinute=earlyWakeStartMinute(),early=`${pad(Math.floor(earlyMinute/60))}:${pad(earlyMinute%60)}`;return{kind:'early',protocol:'EARLY WAKE SIGN-IN',window:`${formatTime(early)} – ${formatTime(systemWakeTime())}`,type:'CONSCIOUSNESS CHECK',title:'Are You Awake?',copy:'Confirming now records an early wake and begins the Wake Protocol inside the sandbox.',icon:'signal',detail:'EARLY START AVAILABLE',status:'AVAILABLE',countdown:`${formatDuration(Math.max(0,wake-now))} UNTIL ${formatTime(systemWakeTime())}`,resultClass:'success',layout:'plain',action:'Hold to Confirm Awake',note:'This confirmation affects only isolated Developer Test data.'};
    }
    let config=developerProtocolConfigsForDate(now).find(item=>minute>=minutes(item.start)&&minute<minutes(item.end));
    if(!config&&session.earlyWakeConfirmed[dateKey]&&minuteInWindow(minute,earlyWakeStartMinute(),minutes(blueprint('wake')?.end||'06:00')))config=blueprint('wake');
    if(config){
      const progress=developerProtocolProgress(now,config),steps=developerProtocolStepsForDate(config,now),end=timeOnDate(now,config.end),timeLeft=Math.max(0,end-now);
      if(!progress.cleared){
        if(progress.failed)return{kind:'protocol-failed',config,progress,protocol:config.name.toUpperCase(),window:`${formatTime(config.start)} – ${formatTime(config.end)}`,type:'PROTOCOL FAILED',title:`${config.name} Failed`,copy:'The simulated deadline passed before every required stage was completed.',icon:'failure',detail:`0 XP · ${progress.stepIndex} / ${steps.length} COMPLETED`,status:'FAILED',countdown:'00:00:00',resultClass:'failure',layout:'plain',action:null,note:'Reset the simulator or move to a new date to test a fresh sequence.'};
        if(progress.stepIndex>=steps.length){progress.cleared=true}
        else{
          const task=steps[progress.stepIndex],timedTask=['timer','workout'].includes(task.type),requiredMinutes=task.type==='workout'?Number(task.minDuration||15):Number(task.duration||0),timerStart=progress.timers[task.id],timerRemaining=timedTask&&timerStart?Math.max(0,requiredMinutes*60000-(now-new Date(timerStart))):null;
          if(task.type==='timer'&&task.autoComplete&&timerStart&&timerRemaining===0){progress.stepIndex+=1;addDeveloperEvent('completion',`${task.title} completed automatically`);return developerLiveStateAt(now)}
          const minutesLeft=timeLeft/60000,resultClass=minutesLeft<=5?'failure':minutesLeft<=10?'late':'success',status=minutesLeft<=5?'CRITICAL':minutesLeft<=10?'WARNING':'ON TIME';
          let action=timedTask?(timerStart?(timerRemaining>0?'Dungeon in Progress':'Hold to Confirm Dungeon Clear'):'Hold to Start Dungeon'):(task.type==='tap'?'Hold to Confirm Complete':'Hold to Confirm');
          const actionDisabled=timedTask&&Boolean(timerStart)&&timerRemaining>0;
          const detail=timedTask?(timerStart?`${formatDuration(timerRemaining)} · ${timerRemaining>0?'DUNGEON ACTIVE':'TIME CLEARED'}`:`${requiredMinutes}:00 REQUIRED TIME`):`STEP ${progress.stepIndex+1} / ${steps.length} · ${config.xp} XP AVAILABLE`;
          return{kind:'protocol',config,progress,task,steps,protocol:config.name.toUpperCase(),window:`${formatTime(config.start)} – ${formatTime(config.end)}`,type:task.id==='execution-plan'&&config.id==='productivity'?'WEEKLY BOSS DIRECTIVE':'CURRENT DIRECTIVE',title:task.title,copy:developerStepCopy(task,now),icon:task.icon||config.icon,detail,status,countdown:`${formatDuration(timeLeft)} LEFT`,resultClass,layout:timedTask?'timed':'plain',action,actionDisabled,note:'Complete every required stage before the simulated fixed deadline.'};
        }
      }
    }
    const classState=developerClassStateAt(now);
    if(classState){
      const {entry,record,start,end,mode}=classState,until=mode==='approaching'?start-now:Math.max(0,end-now),location=[entry.modality,entry.room].filter(Boolean).join(' · ');
      if(mode==='approaching')return{kind:'class',classMode:mode,entry,record,protocol:'CLASS APPROACHING',window:`${formatTime(entry.start)} – ${formatTime(entry.end)}`,type:entry.code||'SCHEDULED CLASS',title:entry.subject,copy:`${location||'Scheduled meeting'} begins soon. Early attendance confirmation is available.`,icon:'academic',detail:'CHECK-IN OPENS · 15 MINUTES EARLY',status:'APPROACHING',countdown:`${formatDuration(until)} UNTIL CLASS`,resultClass:'success',layout:'plain',action:'Hold to Confirm Attendance',note:'Attendance stays inside the isolated sandbox.'};
      if(mode==='checkin')return{kind:'class',classMode:mode,entry,record,protocol:'CLASS CHECK-IN',window:`${formatTime(entry.start)} – ${formatTime(entry.end)}`,type:entry.code||'ATTENDANCE CHECK',title:entry.subject,copy:`Confirm that you are present for ${location||'the scheduled class'}.`,icon:'academic',detail:'ATTENDANCE XP · PENDING',status:now-start<=10*60000?'ON TIME':'LATE',countdown:`${formatDuration(until)} CLASS REMAINING`,resultClass:now-start<=10*60000?'success':'late',layout:'plain',action:'Hold to Confirm Attendance',note:'The simulated attendance record remains isolated.'};
      if(mode==='active')return{kind:'class',classMode:mode,entry,record,protocol:'CLASS ACTIVE',window:`${formatTime(entry.start)} – ${formatTime(entry.end)}`,type:entry.code||'ATTENDANCE ACTIVE',title:entry.subject,copy:`Attendance confirmed. ASCEND is waiting for the scheduled dismissal.`,icon:'academic',detail:`${String(record.status||'present').toUpperCase()} · XP PENDING`,status:'PRESENT',countdown:`${formatDuration(until)} REMAINING`,resultClass:'success',layout:'plain',action:'Hold to Dismiss Early',note:'Use the simulated clock to reach the normal dismissal time.'};
      return{kind:'class',classMode:mode,entry,record,protocol:mode==='resolve'?'ATTENDANCE UNRESOLVED':'CLASS DISMISSAL',window:`${formatTime(entry.start)} – ${formatTime(entry.end)}`,type:'ATTENDANCE RESOLUTION',title:entry.subject,copy:mode==='resolve'?'The class ended without a check-in. Resolve the simulated attendance record.':'The scheduled class has ended. Finalize dismissal and attendance XP.',icon:'academic',detail:mode==='resolve'?'UNVERIFIED · 0 XP':'DISMISSAL READY',status:mode==='resolve'?'UNVERIFIED':'COMPLETE',countdown:'CLASS ENDED',resultClass:mode==='resolve'?'late':'success',layout:'plain',action:mode==='resolve'?'Hold to Resolve Present':'Hold to Confirm Dismissal',note:'No live attendance record will be created.'};
    }
    const next=developerNextEventMoment(now),countdown=next?formatDuration(Math.max(0,next.at-now)):'--:--:--';
    return{kind:'free',protocol:'FREE WINDOW',window:'SYSTEM STANDBY',type:next?'NEXT DIRECTIVE':'NO PENDING EVENT',title:next?next.label:'Free Window',copy:next?`The next simulated event begins at ${formatClock(next.at)}.`:'No additional event is scheduled in the current test horizon.',icon:'signal',detail:next?`${formatDate(next.at)} · ${formatClock(next.at)}`:'LIVE DATA PROTECTED',status:'FREE',countdown:next?`${countdown} UNTIL NEXT`:'NO EVENT',resultClass:'success',layout:'plain',action:null,note:'Change simulated time to inspect another app state.'};
  };
  const reconcileDeveloperTimeline=(fromMs,toMs)=>{
    if(!developerRunSession||toMs<=fromMs)return;const from=new Date(fromMs),to=new Date(toMs),cursor=new Date(from);cursor.setHours(0,0,0,0);let days=0,lastFailure=null;
    while(cursor<=to&&days<14){
      developerProtocolConfigsForDate(cursor).forEach(config=>{const end=timeOnDate(cursor,config.end);if(end>from&&end<=to){const progress=developerProtocolProgress(cursor,config);if(!progress.cleared&&!progress.failed){progress.failed=true;lastFailure=config.name;addDeveloperEvent('deadline',`${config.name} failed at its simulated deadline`)}}});
      cursor.setDate(cursor.getDate()+1);days+=1;
    }
    if(lastFailure)showSystemNotice('alert','SIMULATED DEADLINE PASSED',`${lastFailure} was marked failed inside the sandbox.`,2100);
  };
  const setDeveloperSimulatedTime=(value,reason='Simulated time changed')=>{
    if(!developerRunSession)return;const next=value instanceof Date?value.getTime():Number(value);if(!Number.isFinite(next))return;
    const previous=developerRunSession.simulatedAt;reconcileDeveloperTimeline(previous,next);developerRunSession.simulatedAt=next;developerRunSession.lastRealTick=performance.now();addDeveloperEvent('time',`${reason}: ${new Date(next).toISOString()}`);renderDeveloperRun();
  };
  const updateDeveloperTimeDisplay=()=>{
    if(!developerRunSession)return;const simulated=new Date(developerRunSession.simulatedAt),speed=Number(developerRunSession.speed||0),input=$('#developerSimulatedDateTime');
    if(input&&document.activeElement!==input)input.value=developerDateTimeValue(simulated);
    const speedText=speed===0?'PAUSED':speed===1?'1× REAL TIME':`${speed}× SPEED`;
    $('#developerRunFooterLeft').textContent=`${formatDate(simulated).toUpperCase()} · ${formatClock(simulated)} · ${speedText}`;
    const speedControl=$('#developerTimeSpeed');if(speedControl&&speedControl.value!==String(speed))speedControl.value=String(speed);
  };
  const renderDeveloperRun=()=>{
    if(!developerRunSession)return;const live=developerLiveStateAt(new Date(developerRunSession.simulatedAt)),isLab=live.kind==='lab',overlay=$('#developerRunOverlay');developerRunSession.currentState=live;
    overlay.dataset.result=live.resultClass||'success';overlay.dataset.scenario=isLab?'lab':'live';overlay.dataset.mode='live';$('#developerRunCard').classList.toggle('developer-run-card-lab',isLab);$('#developerRunCard').dataset.layout=live.layout||'plain';$('#developerRunActive').hidden=false;$('#developerRunResult').hidden=true;
    $('#developerRunProtocol').textContent=live.protocol;$('#developerRunWindow').textContent=live.window;$('#developerRunStatus').textContent=live.status;$('#developerRunCountdown').textContent=live.countdown;$('#developerRunType').textContent=live.type;$('#developerRunTitle').textContent=live.title;$('#developerRunCopy').textContent=live.copy;$('#developerRunDetail').innerHTML=live.detail?`<strong>${escapeHtml(live.detail)}</strong>`:'';$('#developerRunDetail').hidden=isLab||!live.detail;$('#developerLabPanel').hidden=!isLab;$('#developerLiveToolbar').hidden=isLab;$('#developerRunFill').style.width='0%';setGlyph('developerRunGlyph',live.icon||'apex');
    const action=$('#developerRunAction');action.hidden=!live.action;action.disabled=Boolean(live.actionDisabled);$('#developerRunActionLabel').textContent=live.action||'No Action Required';$('#developerRunNote').textContent=live.note||'Test data only. Live records remain protected.';$('#developerRunNote').hidden=!live.note;
    const step=$('.developer-run-step');if(step){step.querySelector('strong').textContent=isLab?'LAB':'LIVE';step.querySelector('span').textContent=isLab?'MODE':'TIME'}
    updateDeveloperTimeDisplay();
  };
  const startDeveloperClock=()=>{
    clearInterval(developerClockTimer);if(!developerRunSession)return;developerRunSession.lastRealTick=performance.now();developerClockTimer=setInterval(()=>{
      if(!developerRunSession||developerRunSession.mode!=='live')return;const now=performance.now(),speed=Number(developerRunSession.speed||0),elapsed=now-developerRunSession.lastRealTick;developerRunSession.lastRealTick=now;
      if(speed>0){const previous=developerRunSession.simulatedAt,next=previous+elapsed*speed;reconcileDeveloperTimeline(previous,next);developerRunSession.simulatedAt=next;renderDeveloperRun()}
    },250);
  };
  const stopDeveloperClock=()=>{clearInterval(developerClockTimer);developerClockTimer=null};
  const renderDeveloperTest=()=>{
    setControlView('developerTestView');const test=state.system.developerTest||{},start=$('#developerStartDateTime');$('#testSandboxMode').value=test.sandboxMode||'profile';if(start&&document.activeElement!==start)start.value=developerDateTimeValue(new Date());
  };
  const launchDeveloperRun=(options={})=>{
    const mode=options.mode||'live',sandboxMode=options.sandboxMode||$('#testSandboxMode')?.value||'profile',inputValue=$('#developerStartDateTime')?.value,parsed=inputValue?new Date(inputValue):null,simulatedAt=Number(options.simulatedAt)||(parsed&&!Number.isNaN(parsed.getTime())?parsed.getTime():Date.now());state.system=state.system||{};state.system.developerTest=state.system.developerTest||{};state.system.developerTest.sandboxMode=sandboxMode;
    developerRunSession={mode,sandboxMode,sandbox:createDeveloperSandbox(sandboxMode),simulatedAt,speed:mode==='live'?1:0,lastRealTick:performance.now(),protocolProgress:{},attendance:{},earlyWakeConfirmed:{},completed:false,startedAt:new Date().toISOString(),returnDirect:options.returnDirect??Boolean(controlUi.directDeveloper),events:[]};
    addDeveloperEvent('sandbox',`Created ${sandboxMode==='profile'?'real-profile clone':'clean sample'} sandbox`,{summary:developerSandboxSummary(developerRunSession.sandbox)});addDeveloperEvent('state',`Entered full-screen ${mode==='live'?'live-time simulator':'feedback laboratory'}`);
    cancelHold();$('#scheduleOverlay').hidden=true;$('#developerRunOverlay').hidden=false;document.body.classList.add('developer-test-running');releaseWakeLock();renderDeveloperRun();requestAnimationFrame(()=>$('#developerRunOverlay').classList.add('developer-run-visible'));if(mode==='live')startDeveloperClock();haptic('tap');
  };
  const advanceDeveloperTime=(minutesToAdd,reason)=>{if(!developerRunSession)return;setDeveloperSimulatedTime(developerRunSession.simulatedAt+minutesToAdd*60000,reason||`${minutesToAdd} minute adjustment`)};
  const nextDeveloperEvent=()=>{if(!developerRunSession)return;const next=developerNextEventMoment(new Date(developerRunSession.simulatedAt));if(next)setDeveloperSimulatedTime(next.at.getTime(),`Jumped to ${next.label}`)};
  const applyDeveloperDateTime=()=>{const input=$('#developerSimulatedDateTime'),date=input?.value?new Date(input.value):null;if(!date||Number.isNaN(date.getTime())){showBreachWarning('INVALID TEST TIME','Choose a valid simulated date and time.');return}setDeveloperSimulatedTime(date,'Manual simulated time')};
  const setDeveloperSpeed=value=>{if(!developerRunSession)return;developerRunSession.speed=clamp(Number(value||0),0,300);developerRunSession.lastRealTick=performance.now();addDeveloperEvent('speed',`Simulation speed set to ${developerRunSession.speed}x`);renderDeveloperRun()};
  const completeDeveloperRun=()=>{
    if(!developerRunSession)return;const live=developerRunSession.currentState,now=new Date(developerRunSession.simulatedAt);if(!live)return;
    if(live.kind==='lab'){addDeveloperEvent('resolution','Feedback laboratory session ended');exitDeveloperRun(true);return}
    if(live.kind==='early'){developerRunSession.earlyWakeConfirmed[S.dateKey(now)]=true;const wake=developerProtocolProgress(now,blueprint('wake'));wake.stepIndex=Math.max(1,wake.stepIndex);addDeveloperEvent('state','Early wake confirmed');haptic('start');showSystemNotice('diagnostic','SIMULATED WAKE CONFIRMED','Wake Protocol opened inside isolated test data.',1800);renderDeveloperRun();return}
    if(live.kind==='protocol'){
      const {progress,task,steps,config}=live;if(['timer','workout'].includes(task.type)){
        const duration=task.type==='workout'?Number(task.minDuration||15):Number(task.duration||0),started=progress.timers[task.id];if(!started){progress.timers[task.id]=now.toISOString();addDeveloperEvent('timer',`${task.title} started`);haptic('start');renderDeveloperRun();return}
        if(now-new Date(started)<duration*60000)return;
      }
      progress.stepIndex+=1;addDeveloperEvent('completion',`${task.title} completed`);if(progress.stepIndex>=steps.length){progress.cleared=true;addDeveloperEvent('resolution',`${config.name} cleared`);haptic('clear');showSystemNotice('diagnostic','SIMULATED PROTOCOL CLEARED',`${config.name} completed inside the sandbox.`,1900)}else haptic('tap');renderDeveloperRun();return;
    }
    if(live.kind==='class'){
      const {record,classMode,entry}=live;if(['approaching','checkin','resolve'].includes(classMode)){record.checkedInAt=now.toISOString();record.status=classMode==='approaching'?'early':classMode==='resolve'?'present':now-timeOnDate(now,entry.start)<=10*60000?'present':'late';if(classMode==='resolve'){record.finalized=true;record.dismissedAt=now.toISOString()}addDeveloperEvent('attendance',`${entry.subject} marked ${record.status}`);haptic('attendance');showSystemNotice('diagnostic','SIMULATED ATTENDANCE RECORDED',`${entry.subject} · ${record.status.toUpperCase()}`,1800)}else{record.finalized=true;record.dismissedAt=now.toISOString();addDeveloperEvent('attendance',`${entry.subject} dismissed`);haptic('dismissal');showSystemNotice('diagnostic','SIMULATED CLASS DISMISSED',`${entry.subject} finalized inside the sandbox.`,1800)}renderDeveloperRun();
    }
  };
  const previewDeveloperHaptic=()=>{if(!developerRunSession)return;const kind=$('#developerLabEvent').value;haptic(kind);addDeveloperEvent('haptic',`Previewed ${kind} vibration pattern`);showSystemNotice('diagnostic','HAPTIC PREVIEW',`${kind.toUpperCase()} pattern triggered.`,1600)};
  const sendDeveloperTestNotification=async()=>{if(!developerRunSession)return;const kind=$('#developerLabEvent').value;if(!('Notification' in window)){showBreachWarning('NOTIFICATIONS UNSUPPORTED','This browser cannot send a local test alert.');return}let permission=Notification.permission;if(permission==='default')permission=await Notification.requestPermission();if(permission!=='granted'){showBreachWarning('ALERT PERMISSION REQUIRED','Allow notifications before running the alert laboratory.');return}try{new Notification(`ASCEND TEST · ${kind.toUpperCase()}`,{body:'Developer Test Mode notification. Live schedule records are unchanged.',tag:`ascend-test-${Date.now()}`,icon:'assets/icon-192.png'});addDeveloperEvent('notification',`Sent ${kind} test notification`);showSystemNotice('alert','TEST ALERT SENT','The notification laboratory completed successfully.',1800)}catch(error){showBreachWarning('TEST ALERT FAILED',error.message||'Notification could not be created.')}};
  const exitDeveloperRun=(returnToPanel=false)=>{
    stopDeveloperClock();cancelHold('developer-run');$('#developerRunFill').style.width='0%';const returnDirect=developerRunSession?.returnDirect??true,overlay=$('#developerRunOverlay');overlay.classList.remove('developer-run-visible');overlay.hidden=true;delete overlay.dataset.scenario;delete overlay.dataset.mode;$('#developerRunCard').classList.remove('developer-run-card-lab');$('#developerRunDetail').hidden=false;document.body.classList.remove('developer-test-running');developerRunSession=null;
    if(returnToPanel){controlUi.directDeveloper=returnDirect;$('#scheduleOverlay').hidden=false;renderDeveloperTest();releaseWakeLock()}else{controlUi.directDeveloper=false;renderApp();if(activeProtocolRecord())requestWakeLock()}
  };
  const startDeveloperRunAction=event=>{if(!developerRunSession||!developerRunSession.currentState?.action||$('#developerRunAction').disabled)return;event?.preventDefault();beginHold('developer-run',1200,progress=>{$('#developerRunFill').style.width=`${progress*100}%`},completeDeveloperRun)};
  const runDeveloperTest=()=>launchDeveloperRun({mode:'live'});
  const resetDeveloperTest=()=>{state.system.developerTest={enabled:false,unlocked:true,scenario:'live',simulatedDate:null,runs:0,lastResult:null,sandboxMode:'profile',reports:[],labHistory:[]};save({silent:true});renderDeveloperTest();showSystemNotice('diagnostic','TEST HISTORY CLEARED','Developer sandbox history was reset.',1600)};
  const renderRecoverySystem=()=>{setControlView('recoverySystemView');const snapshots=S.listSnapshots(),rollbacks=S.listRollbackPoints();$('#recoverySystemSummary').innerHTML=`<div><span>SAFE MODE</span><strong>${state.system.safeMode?'ACTIVE':'STANDBY'}</strong></div><div><span>SNAPSHOTS</span><strong>${snapshots.length}</strong></div><div><span>ROLLBACKS</span><strong>${rollbacks.length}</strong></div><div><span>LAST BOOT</span><strong>${state.system.lastSuccessfulBoot?formatShortDate(state.system.lastSuccessfulBoot):'PENDING'}</strong></div>`;$('#toggleSafeMode').textContent=state.system.safeMode?'Exit Emergency Safe Mode':'Emergency Safe Mode'};
  const toggleSafeMode=()=>{state.system.safeMode=!state.system.safeMode;state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'recovery',message:`Emergency Safe Mode ${state.system.safeMode?'enabled':'disabled'}.`});save({silent:true});applySafeMode();renderRecoverySystem()};
  const openEmergencyRecovery=()=>{$('#emergencyRecoveryOverlay').hidden=false;$('#emergencyRestoreSnapshot').disabled=!S.listSnapshots().length};
  const closeEmergencyRecovery=()=>{$('#emergencyRecoveryOverlay').hidden=true};
  const synchronizeAdvancedSystems=()=>{const before=JSON.stringify({quest:state.quests?.daily?.date,rules:state.academicTasks.length,debriefs:state.weeklyDebriefs?.length,pending:state.timezone?.pending});ensureDailyQuest();const generated=generateRecurringTasks();ensureWeeklyDebrief();const changedTimezone=detectTimezoneChange();const watchdogDate=state.system.watchdog?.lastRun?S.dateKey(new Date(state.system.watchdog.lastRun)):'';if(watchdogDate!==S.dateKey())runDataConsistencyWatchdog(false);if(generated||changedTimezone||before!==JSON.stringify({quest:state.quests?.daily?.date,rules:state.academicTasks.length,debriefs:state.weeklyDebriefs?.length,pending:state.timezone?.pending}))save({silent:true})};

  const controlViews=['controlHomeView','academicHomeView','profileView','settingsView','attendanceView','systemReliabilityView','scheduleExceptionsView','dataBackupView','academicTasksView','conflictScanView','advancedSystemHomeView','updatesRollbackView','diagnosticsView','externalRemindersView','developerTestView','recoverySystemView','scheduleOverviewView','scheduleEditView','directiveStudioView','directiveEditorView','directiveStepView'];
  const setControlView=view=>{
    controlUi.view=view;
    controlViews.forEach(id=>{const node=document.getElementById(id);if(node)node.hidden=id!==view});
    const schedulePanel=document.querySelector('#scheduleOverlay .schedule-panel');
    if(schedulePanel)schedulePanel.classList.toggle('settings-active',view==='settingsView');
  };
  const subjectCatalog=()=>{
    const map=new Map();
    const add=(key,name,code='')=>{const normalized=subjectKey(key||name);if(!normalized)return;if(!map.has(normalized))map.set(normalized,{key:normalized,name:name||key,code});};
    state.classSchedule.forEach(entry=>add(entry.subject,entry.subject,entry.code||''));
    (state.scheduleHistory||[]).forEach(entry=>add(entry.subject,entry.subject,entry.code||''));
    state.attendanceRecords.forEach(record=>add(record.subjectKey,record.subjectName,record.code||''));
    state.academicTasks.forEach(task=>add(task.subjectKey,task.subjectName,''));
    return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name));
  };
  const streakSummary=records=>{
    const usable=[...records].filter(record=>record.finalized&&!['no-class','excused'].includes(record.status)).sort((a,b)=>`${a.scheduledDate}T${a.scheduledStart}`.localeCompare(`${b.scheduledDate}T${b.scheduledStart}`));
    let current=0,best=0,run=0,punctual=0;
    usable.forEach(record=>{if(['early','present','late','partial'].includes(record.status)){run+=1;best=Math.max(best,run)}else if(record.status==='absent')run=0});
    for(let index=usable.length-1;index>=0;index-=1){if(['early','present','late','partial'].includes(usable[index].status))current+=1;else break}
    for(let index=usable.length-1;index>=0;index-=1){if(['early','present'].includes(usable[index].status))punctual+=1;else break}
    return{current,best,punctual};
  };
  const subjectStats=key=>{
    const subject=subjectCatalog().find(item=>item.key===key)||{key,name:key,code:''};
    const records=state.attendanceRecords.filter(record=>record.subjectKey===key);
    const counts={early:0,present:0,late:0,partial:0,absent:0,excused:0,'no-class':0,unverified:0};records.forEach(record=>{if(counts[record.status]!==undefined)counts[record.status]+=1});
    const attended=counts.early+counts.present+counts.late+counts.partial,required=attended+counts.absent;
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
    const counts={early:0,present:0,late:0,partial:0,absent:0,excused:0,'no-class':0,unverified:0};state.attendanceRecords.forEach(record=>{if(counts[record.status]!==undefined)counts[record.status]+=1});
    const attended=counts.early+counts.present+counts.late+counts.partial,required=attended+counts.absent;
    return{subjects,counts,attended,required,attendanceRate:required?Math.round(attended/required*100):0,punctualityRate:attended?Math.round((counts.early+counts.present)/attended*100):0,xp:subjects.reduce((sum,item)=>sum+item.xp,0),streaks:streakSummary(state.attendanceRecords)};
  };
  const renderControlHome=()=>{setControlView('controlHomeView');const academic=overallAcademicStats();$('#freeScheduleClassCount').textContent=activeSchedule().length;$('#freeScheduleAttendanceRate').textContent=`${academic.attendanceRate}%`};
  const renderAcademicHome=()=>{
    setControlView('academicHomeView');const academic=overallAcademicStats();$('#scheduleHomeCount').textContent=activeSchedule().length;$('#academicHomeXp').textContent=academic.xp;
  };
  const renderReliability=async()=>{
    setControlView('systemReliabilityView');
    const snapshots=S.listSnapshots();const report=await storageReport();const percent=Math.min(999,Math.round(report.ratio*100));
    $('#reliabilityTimezoneStatus').textContent=`UTC ${timezoneOffsetLabel(state.timezone?.offset??S.timezoneOffset())}`;
    $('#reliabilityStorageStatus').textContent=report.ratio>=.8?'HIGH':`${percent}%`;
    $('#reliabilitySnapshotCount').textContent=`${snapshots.length} / 7`;
    $('#reliabilityNotificationStatus').textContent=state.settings.notifications&&('Notification' in window)&&Notification.permission==='granted'?'ON':'OFF';
    $('#reliabilityCopy').textContent=`Local recovery and alerts remain available offline · ${state.timezone?.name||S.timezoneName()}.`;
    $('#reviewTimezone').textContent=state.timezone?.pending?'Review Detected Timezone':'Review Timezone';
    $('#toggleNotifications b').textContent=state.settings.notifications?'Disable Local Alerts':'Enable Local Alerts';
    $('#toggleWakeLock b').textContent=`Keep Screen Awake: ${state.settings.keepAwake?'On':'Off'}`;
    $('#restoreLatestSnapshot').disabled=!snapshots.length;
  };
  const toggleNotifications=async()=>{
    if(!('Notification' in window)){showBreachWarning('ALERTS NOT SUPPORTED','This browser does not support local notifications.');return}
    if(!state.settings.notifications){const permission=await Notification.requestPermission();if(permission!=='granted'){showBreachWarning('ALERT PERMISSION DENIED','Enable notifications in browser or app settings first.');return}state.settings.notifications=true}
    else state.settings.notifications=false;
    state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'system',message:`Local alerts ${state.settings.notifications?'enabled':'disabled'}.`});save();renderReliability();
  };
  const restoreLatestSnapshot=()=>{
    const latest=S.listSnapshots()[0];if(!latest){showBreachWarning('NO SNAPSHOT','No automatic recovery snapshot is available.');return}
    try{state=S.restoreSnapshot(latest.id);state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'restore',message:`Latest automatic snapshot restored: ${latest.date}.`});save({silent:true});closeScheduleOverlay();activeScreenId=null;renderApp();showSystemNotice('restore','SNAPSHOT RESTORED',`Recovered local state from ${latest.date}.`,3200)}catch(error){showBreachWarning('RESTORE FAILED',error.message||'Snapshot could not be restored.')}
  };
  const profilePages=['Overview','Identity'];
  const profileMonthKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  const profileMonthDate=key=>{const [year,month]=String(key||profileMonthKey(new Date())).split('-').map(Number);return new Date(year,Math.max(0,(month||1)-1),1,12,0,0,0)};
  const shiftProfileMonth=(key,delta)=>{const date=profileMonthDate(key);date.setMonth(date.getMonth()+delta);return profileMonthKey(date)};
  const profileDayRecordsFor=dateKey=>({day:state.dayRecords?.[dateKey]||null,attendance:state.attendanceRecords.filter(record=>record.scheduledDate===dateKey).sort((a,b)=>String(a.scheduledStart||'').localeCompare(String(b.scheduledStart||'')))});
  const profileTrackingStartKey=()=>{
    const candidates=[],activation=state.activatedAt||state.createdAt;
    if(activation){const date=new Date(activation);if(!Number.isNaN(date.getTime()))candidates.push(S.dateKey(date))}
    const earliestRecord=Object.keys(state.dayRecords||{}).sort()[0];if(earliestRecord)candidates.push(earliestRecord);
    return candidates.sort()[0]||currentKey();
  };
  const profileProtocolProgress=protocol=>{
    const steps=(protocol?.steps||[]).filter(step=>step.required!==false),completed=steps.filter(step=>step.status==='completed').length,skipped=steps.filter(step=>step.status==='skipped').length;
    return{total:steps.length,completed,skipped};
  };
  const profileDayProtocolStats=day=>{
    const required=Object.values(day?.protocols||{}).filter(protocol=>protocol?.required!==false),excused=required.filter(protocol=>protocol.excused&&protocol.status==='skipped'),applicable=required.filter(protocol=>!protocol.excused);
    const cleared=applicable.filter(protocol=>protocol.status==='cleared').length;
    const directives=applicable.reduce((sum,protocol)=>{const progress=profileProtocolProgress(protocol);sum.total+=progress.total;sum.completed+=progress.completed;sum.skipped+=progress.skipped;return sum},{total:0,completed:0,skipped:0});
    const touched=cleared>0||directives.completed>0||directives.skipped>0||applicable.some(protocol=>protocol.status==='active'||Boolean(protocol.startedAt));
    return{required,excused,applicable,cleared,directives,touched};
  };
  const profileDayState=dateKey=>{
    const today=currentKey();
    if(dateKey>today)return'future';
    if(dateKey<profileTrackingStartKey())return'untracked';
    const {day}=profileDayRecordsFor(dateKey);
    if(!day)return dateKey===today?'pending':'missed';
    const stats=profileDayProtocolStats(day);
    if(day.status==='cleared')return stats.excused.length?'excused':'clear';
    if(day.status==='failed')return stats.touched?'partial':'missed';
    if(day.status==='active'||day.status==='pending')return stats.touched?'partial':dateKey===today?'pending':'missed';
    return dateKey===today?'pending':'missed';
  };
  const profileDayResultLabel=dateKey=>{
    const {day}=profileDayRecordsFor(dateKey),status=profileDayState(dateKey);
    if(status==='clear')return'DAILY CLEAR';
    if(status==='excused')return'EXCUSED';
    if(status==='missed')return'MISSED';
    if(status==='pending')return'PENDING';
    if(status==='partial')return day?.status==='active'&&dateKey===currentKey()?'IN PROGRESS':'PARTIAL';
    if(status==='untracked')return'NOT TRACKED';
    if(status==='future')return'FUTURE';
    return'PENDING';
  };
  const profileDayXp=dateKey=>{
    const {day,attendance}=profileDayRecordsFor(dateKey);
    const directive=Object.values(day?.protocols||{}).reduce((sum,protocol)=>sum+Math.max(0,Number(protocol.profileXpAppliedAmount||0)),0);
    const academic=attendance.reduce((sum,record)=>sum+Math.max(0,Number(record.profileXpAppliedAmount||0)),0);
    return{directive,academic,total:directive+academic};
  };
  const profileMonthSummary=key=>{
    const date=profileMonthDate(key),year=date.getFullYear(),month=date.getMonth(),last=new Date(year,month+1,0,12).getDate(),counts={clear:0,partial:0,missed:0,excused:0};
    for(let day=1;day<=last;day+=1){const dayKey=S.dateKey(new Date(year,month,day,12));if(dayKey>currentKey())continue;const status=profileDayState(dayKey);if(counts[status]!==undefined)counts[status]+=1}
    return counts;
  };
  const profileDayCellLabel=(status,dateKey)=>status==='clear'?'CLEAR':status==='excused'?'EXCUSED':status==='missed'?'MISSED':status==='pending'?'PENDING':status==='partial'?(dateKey===currentKey()?'ACTIVE':'PARTIAL'):'';
  const profileCalendarMarkup=()=>{
    const currentMonth=profileMonthKey(new Date());controlUi.profileMonth=controlUi.profileMonth||currentMonth;
    const monthDate=profileMonthDate(controlUi.profileMonth),year=monthDate.getFullYear(),month=monthDate.getMonth(),daysInMonth=new Date(year,month+1,0,12).getDate(),offset=(new Date(year,month,1,12).getDay()+6)%7,summary=profileMonthSummary(controlUi.profileMonth);
    const cells=[];for(let index=0;index<offset;index+=1)cells.push('<span class="profile-calendar-spacer" aria-hidden="true"></span>');
    for(let day=1;day<=daysInMonth;day+=1){
      const key=S.dateKey(new Date(year,month,day,12)),status=profileDayState(key),today=key===currentKey(),disabled=status==='future'||status==='untracked',cellLabel=profileDayCellLabel(status,key);
      cells.push(`<button type="button" class="profile-calendar-day ${status}${today?' today':''}" data-profile-action="calendar-day" data-date="${key}" ${disabled?'disabled':''} aria-label="${escapeHtml(new Date(`${key}T12:00:00`).toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'}))} · ${profileDayResultLabel(key)}"><span>${day}</span>${cellLabel?`<small>${cellLabel}</small>`:''}<i aria-hidden="true"></i></button>`);
    }
    while(cells.length<42)cells.push('<span class="profile-calendar-spacer" aria-hidden="true"></span>');
    const monthLabel=monthDate.toLocaleDateString(undefined,{month:'long',year:'numeric'}),nextDisabled=controlUi.profileMonth>=currentMonth;
    return `<section class="profile-daily-log">
      <div class="profile-calendar-head"><div><span>DAILY LOG</span><strong>${escapeHtml(monthLabel)}</strong><small>${summary.clear} Clear · ${summary.partial} Partial · ${summary.missed} Missed · ${summary.excused} Excused</small></div><nav aria-label="Daily log month navigation"><button type="button" data-profile-action="calendar-prev" aria-label="Previous month">‹</button><button type="button" data-profile-action="calendar-next" aria-label="Next month" ${nextDisabled?'disabled':''}>›</button></nav></div>
      <div class="profile-calendar-weekdays" aria-hidden="true"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>
      <div class="profile-calendar-grid">${cells.join('')}</div>
      <div class="profile-calendar-legend"><span class="clear"><i></i>Clear</span><span class="partial"><i></i>Partial</span><span class="missed"><i></i>Missed</span><span class="excused"><i></i>Excused</span></div>
    </section>`;
  };
  const profileProtocolStatusCopy=protocol=>{if(protocol?.status==='cleared')return'DONE';if(protocol?.status==='skipped'&&protocol?.excused)return'EXCUSED';if(protocol?.status==='failed'){const progress=profileProtocolProgress(protocol);return progress.completed||progress.skipped?'PARTIAL':'MISSED'}if(protocol?.status==='active')return'IN PROGRESS';return'PENDING'};
  const profileAttendanceStatusCopy=status=>({early:'PRESENT · EARLY',present:'PRESENT',late:'PRESENT · LATE',partial:'PARTIAL',absent:'ABSENT',excused:'EXCUSED','no-class':'NO CLASS',unverified:'UNRESOLVED'})[status]||String(status||'UNRESOLVED').toUpperCase();
  const profileDayDetailMarkup=dateKey=>{
    const {day,attendance}=profileDayRecordsFor(dateKey),xp=profileDayXp(dateKey),date=new Date(`${dateKey}T12:00:00`),result=profileDayResultLabel(dateKey),dayStats=profileDayProtocolStats(day);
    const directiveRows=day?protocolConfigsForRecord(day).map(config=>{const protocol=day.protocols[config.id],boss=Boolean(protocol?.boss),name=boss?(day.weeklyBossPlan?.title?`Weekly Boss · ${day.weeklyBossPlan.title}`:'Weekly Boss'):(protocol?.name||config.name).replace(/ Protocol$/,'');const applied=Math.max(0,Number(protocol?.profileXpAppliedAmount||0)),start=protocol?.start||config.start,end=protocol?.end||config.end,progress=profileProtocolProgress(protocol);const stepRows=(protocol?.steps||[]).map(step=>`<div class="profile-directive-row ${escapeHtml(step.status||'pending')}"><span>${escapeHtml(step.title||'Directive')}</span><b>${step.status==='completed'?'DONE':step.status==='skipped'?'SKIPPED':step.status==='active'?'ACTIVE':'PENDING'}</b></div>`).join('');return `<details class="profile-protocol-log ${escapeHtml(protocol?.status||'pending')}"><summary><section><strong>${escapeHtml(name)}</strong><small>${escapeHtml(start)}–${escapeHtml(end)} · ${progress.completed}/${progress.total} required directives${applied?` · +${applied} XP`:''}</small></section><b>${profileProtocolStatusCopy(protocol||{})}</b></summary><div class="profile-directive-list">${stepRows||'<div class="profile-log-empty">No directives recorded.</div>'}</div></details>`}).join(''):'';
    const attendanceRows=attendance.map(record=>{const name=record.code||record.subjectName||'Class',applied=Math.max(0,Number(record.profileXpAppliedAmount||0)),detail=[formatTime(record.scheduledStart||'00:00'),record.subjectName&&record.code?record.subjectName:'',record.arrivalTime?`Arr ${formatTime(record.arrivalTime)}`:'',record.departureTime?`Left ${formatTime(record.departureTime)}`:'',applied?`+${applied} XP`:''].filter(Boolean).join(' · ');return `<div class="profile-log-row attendance ${escapeHtml(record.status||'unverified')}"><section><strong>${escapeHtml(name)}</strong><small>${escapeHtml(detail)}</small></section><b>${profileAttendanceStatusCopy(record.status)}</b></div>`}).join('');
    const dayState=profileDayState(dateKey);
    const protocolSummary=day?`${dayStats.cleared}/${dayStats.applicable.length} required protocols · ${dayStats.directives.completed}/${dayStats.directives.total} required directives${dayStats.excused.length?` · ${dayStats.excused.length} excused`:''}`:dayState==='missed'?'Tracked day · no protocol activity was saved.':dayState==='pending'?'Tracked day · no protocol activity yet.':dayState==='untracked'?'ASCEND was not active on this date.':'No protocol activity recorded.';
    const emptyProtocolCopy=dayState==='missed'?'No detailed protocol snapshot exists for this tracked day.':dayState==='pending'?'No directives have been started yet.':'No directive activity recorded.';
    return `<section class="profile-day-log-detail">
      <div class="profile-day-log-head"><div><span>DAY LOG</span><strong>${escapeHtml(date.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}))}</strong><small>${result} · ${escapeHtml(protocolSummary)}</small></div><div><span>PROFILE XP</span><strong>+${xp.total}</strong><small>${xp.directive} directive · ${xp.academic} attendance</small></div></div>
      <div class="profile-day-log-scroll">
        <div class="profile-log-section"><span>PROTOCOLS & DIRECTIVES</span>${directiveRows||`<div class="profile-log-empty">${escapeHtml(emptyProtocolCopy)}</div>`}</div>
        <div class="profile-log-section"><span>ATTENDANCE</span>${attendanceRows||'<div class="profile-log-empty">No attendance records for this day.</div>'}</div>
      </div>
      <button class="ghost-button profile-log-back" type="button" data-profile-action="calendar-back">Back to Calendar</button>
    </section>`;
  };
  const renderProfile=()=>{
    setControlView('profileView');controlUi.profilePage=clamp(controlUi.profilePage,0,profilePages.length-1);
    const content=$('#profileContent'),activeEmblem=normalizeGlyph(state.player.emblem),required=clearDaysRequired(state.player.level),levelProgress=state.player.mastered?100:required?Math.round(state.player.levelClearDays/required*100):100;
    if(controlUi.profilePage===0){
      controlUi.profileMonth=controlUi.profileMonth||profileMonthKey(new Date());
      content.innerHTML=`<div class="simple-profile-home">
        <div class="simple-profile-identity"><div class="profile-emblem profile-settings-hold" data-settings-hold="true" aria-label="Hold for Settings">${glyphMarkup(activeEmblem)}</div><div><span>PLAYER · ${state.player.rank}-RANK</span><strong>${escapeHtml(state.player.codename||state.player.name)}</strong><small>${escapeHtml(state.player.name)} · ${escapeHtml(state.player.title)}</small></div><button type="button" data-profile-action="edit-identity">Edit</button></div>
        <div class="simple-profile-progression">
          <div class="simple-profile-momentum"><div><span>LEVEL</span><strong>${state.player.level}</strong></div><div><span>STREAK</span><strong>${state.player.streak} DAY${state.player.streak===1?'':'S'}</strong><small class="simple-profile-best">BEST · ${state.player.bestStreak||0} DAY${Number(state.player.bestStreak||0)===1?'':'S'}</small></div></div>
          <div class="simple-profile-progress"><div><span>${state.player.mastered?'SYSTEM MASTERY':'LEVEL PROGRESS'}</span><strong>${state.player.mastered?'COMPLETE':`${state.player.levelClearDays} / ${required} CLEAR DAYS`}</strong></div><i><b style="width:${levelProgress}%"></b></i><small>${Number(state.player.totalXp||0).toLocaleString()} XP</small></div>
        </div>
        ${controlUi.profileDay?profileDayDetailMarkup(controlUi.profileDay):profileCalendarMarkup()}
      </div>`;
      return;
    }
    const emblemOptions=[['apex','Apex'],['confirm','Shard'],['shine','Radiance'],['stretch','Flow'],['academic','Scholar'],['work','Core']];
    content.innerHTML=`<div class="simple-profile-detail"><div class="simple-detail-heading"><span>IDENTITY</span><strong>Edit Player Record</strong><small>Changes apply only to your visible profile identity.</small></div><div class="profile-form simple-identity-form"><label>Name<input id="profileNameEdit" type="text" maxlength="40" value="${escapeHtml(state.player.name)}"></label><label>Codename<input id="profileCodenameEdit" type="text" maxlength="24" value="${escapeHtml(state.player.codename||'')}"></label><label>Emblem<select id="profileEmblemEdit">${emblemOptions.map(([value,label])=>`<option value="${value}" ${value===activeEmblem?'selected':''}>${label}</option>`).join('')}</select></label><label>Title<input id="profileTitleEdit" type="text" maxlength="32" value="${escapeHtml(state.player.title||'ASCEND Player')}"></label></div><button class="custom-primary" type="button" data-profile-action="save-identity">Save Identity</button><button class="ghost-button" type="button" data-profile-action="profile-home">Back to Profile</button></div>`;
  };
  const historyRecords=()=>[...state.attendanceRecords].sort((a,b)=>`${b.scheduledDate}T${b.scheduledStart}`.localeCompare(`${a.scheduledDate}T${a.scheduledStart}`));
  const currentWeekAttendance=()=>{
    const now=new Date(),weekday=now.getDay()||7,start=new Date(now);start.setHours(0,0,0,0);start.setDate(start.getDate()-(weekday-1));
    const end=new Date(start);end.setDate(end.getDate()+7);
    const records=state.attendanceRecords.filter(record=>{const date=new Date(`${record.scheduledDate}T12:00:00`);return date>=start&&date<end});
    const counts={early:0,present:0,late:0,partial:0,absent:0,excused:0,'no-class':0,unverified:0};records.forEach(record=>{if(counts[record.status]!==undefined)counts[record.status]+=1});
    const attended=counts.early+counts.present+counts.late+counts.partial,required=attended+counts.absent;
    return{records,counts,attended,required,start,end};
  };
  const attendanceDateLabel=value=>{
    const date=new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime())?String(value||'Unknown date'):date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  };
  const resolvableUnverifiedRecords=(now=new Date())=>state.attendanceRecords
    .filter(record=>{
      if(record.status!=='unverified'||record.finalized||!record.scheduledDate||!record.scheduledEnd)return false;
      const end=scheduledMoment(record,record.scheduledEnd);return !Number.isNaN(end.getTime())&&end<=now;
    })
    .sort((a,b)=>`${b.scheduledDate}T${b.scheduledStart}`.localeCompare(`${a.scheduledDate}T${a.scheduledStart}`));
  const attendanceStatusLabel=status=>({early:'Present · Early',present:'Present',late:'Present · Late',partial:'Partial',absent:'Absent',excused:'Excused','no-class':'No Class',unverified:'Unresolved'})[status]||'Unresolved';
  const canonicalAttendanceChoice=status=>['early','present','late'].includes(status)?'present':['partial','absent','excused','no-class'].includes(status)?status:'present';
  const attendanceEditorMarkup=record=>{
    const choice=canonicalAttendanceChoice(record.status),isPartial=choice==='partial';
    return `<section class="attendance-resolution-editor" data-record-id="${escapeHtml(record.id)}">
      <div class="attendance-resolution-head"><div><span>${record.status==='unverified'?'RESOLVE ATTENDANCE':'EDIT ATTENDANCE'}</span><strong>${escapeHtml(record.subjectName||record.code||'Class')}</strong><small>${escapeHtml(attendanceDateLabel(record.scheduledDate))} · ${formatTime(record.scheduledStart)}–${formatTime(record.scheduledEnd)}</small></div><b>${escapeHtml(attendanceStatusLabel(record.status))}</b></div>
      <label>Status<select id="attendanceResolutionStatus"><option value="present" ${choice==='present'?'selected':''}>Present</option><option value="partial" ${choice==='partial'?'selected':''}>Partial</option><option value="absent" ${choice==='absent'?'selected':''}>Absent</option><option value="excused" ${choice==='excused'?'selected':''}>Excused</option><option value="no-class" ${choice==='no-class'?'selected':''}>No Class</option></select></label>
      <div class="attendance-partial-fields" id="attendancePartialFields" ${isPartial?'':'hidden'}><label>Arrival <input id="attendanceArrivalTime" type="time" value="${escapeHtml(record.arrivalTime||'')}"></label><label>Departure <input id="attendanceDepartureTime" type="time" value="${escapeHtml(record.departureTime||'')}"></label></div>
      <label>Note <input id="attendanceResolutionNote" type="text" maxlength="240" value="${escapeHtml(record.note||'')}" placeholder="Optional context"></label>
      <div class="attendance-resolution-buttons"><button type="button" class="system-button compact-button" data-attendance-action="save-resolution"><b>Save Attendance</b></button><button type="button" class="ghost-button" data-attendance-action="cancel-resolution">Cancel</button></div>
    </section>`;
  };
  const saveAttendanceResolution=()=>{
    const record=state.attendanceRecords.find(item=>item.id===controlUi.attendanceEditId);if(!record)return;
    const status=$('#attendanceResolutionStatus')?.value,arrival=$('#attendanceArrivalTime')?.value||'',departure=$('#attendanceDepartureTime')?.value||'',note=$('#attendanceResolutionNote')?.value||'';
    if(status==='partial'&&arrival&&departure&&minutes(departure)<minutes(arrival)){showBreachWarning('INVALID PARTIAL ATTENDANCE','Departure time cannot be earlier than arrival time.');return}
    if(!applyManualAttendanceResolution(record,status,{arrivalTime:arrival,departureTime:departure,note})){showBreachWarning('ATTENDANCE NOT SAVED','Review the selected attendance details and try again.');return}
    controlUi.attendanceEditId=null;controlUi.unverifiedResolveId=null;controlUi.unverifiedIndex=clamp(controlUi.unverifiedIndex,0,Math.max(0,resolvableUnverifiedRecords().length-1));systemFeedback(status==='absent'?'warning':'attendance','Attendance saved.');renderAttendance();
  };
  const unverifiedAttendanceMarkup=records=>{
    if(!records.length){controlUi.unverifiedIndex=0;controlUi.unverifiedResolveId=null;return''}
    const editing=records.find(record=>record.id===controlUi.attendanceEditId)||null;if(editing)return attendanceEditorMarkup(editing);
    controlUi.unverifiedIndex=clamp(controlUi.unverifiedIndex,0,records.length-1);const record=records[controlUi.unverifiedIndex];
    return `<section class="attendance-unverified-panel"><div class="attendance-unverified-heading"><div><span>UNRESOLVED</span><strong>${records.length} class${records.length===1?'':'es'} need your input</strong></div><small>${controlUi.unverifiedIndex+1} / ${records.length}</small></div><div class="attendance-unverified-record"><div><strong>${escapeHtml(record.subjectName||record.code||'Class')}</strong><small>${escapeHtml(attendanceDateLabel(record.scheduledDate))} · ${formatTime(record.scheduledStart)}–${formatTime(record.scheduledEnd)}</small></div><button type="button" data-attendance-action="edit-record" data-record-id="${escapeHtml(record.id)}">Resolve</button></div><div class="attendance-unverified-nav" ${records.length<=1?'hidden':''}><button type="button" data-attendance-action="unverified-prev" ${controlUi.unverifiedIndex===0?'disabled':''} aria-label="Previous unresolved record">${glyphMarkup('chevron-left')}</button><span>Past unresolved classes</span><button type="button" data-attendance-action="unverified-next" ${controlUi.unverifiedIndex>=records.length-1?'disabled':''} aria-label="Next unresolved record">${glyphMarkup('chevron-right')}</button></div></section>`;
  };
  const attendanceModeSwitch=active=>`<div class="attendance-mode-switch" role="group" aria-label="Attendance view"><button type="button" data-attendance-action="show-overall" class="${active==='overall'?'active':''}">Overview</button><button type="button" data-attendance-action="show-subjects" class="${active==='subjects'?'active':''}">Per Subject</button></div>`;
  const attendanceFilterMatches=(record,filter)=>filter==='all'||(filter==='present'&&['early','present','late'].includes(record.status))||record.status===filter;
  const subjectAttendanceRow=record=>{
    const time=[formatTime(record.scheduledStart),record.arrivalTime?`Arr ${formatTime(record.arrivalTime)}`:'',record.departureTime?`Left ${formatTime(record.departureTime)}`:''].filter(Boolean).join(' · '),unresolved=record.status==='unverified';
    return `<div class="subject-session-row ${escapeHtml(record.status)}"><div class="subject-session-date"><strong>${escapeHtml(attendanceDateLabel(record.scheduledDate))}</strong><small>${escapeHtml(time)}</small></div><div class="subject-session-status"><b>${escapeHtml(attendanceStatusLabel(record.status))}</b>${record.note?`<small>${escapeHtml(record.note)}</small>`:''}</div><button type="button" data-attendance-action="edit-record" data-record-id="${escapeHtml(record.id)}">${unresolved?'Resolve':'Edit'}</button></div>`;
  };
  const renderAttendance=()=>{
    syncHistoricalUnresolvedMeetings();setControlView('attendanceView');controlUi.correction=false;
    const academic=overallAcademicStats(),week=currentWeekAttendance(),records=historyRecords(),latest=records[0]||null;$('#attendanceNav').hidden=true;const content=$('#attendanceContent');
    if(controlUi.attendanceTab==='subjects'){
      const subjects=academic.subjects;if(!subjects.length){content.innerHTML=`${attendanceModeSwitch('subjects')}<div class="schedule-empty attendance-empty"><strong>No Subjects Yet</strong><span>Add a class schedule first.</span></div>`;return}
      controlUi.subjectIndex=clamp(controlUi.subjectIndex,0,subjects.length-1);const stats=subjects[controlUi.subjectIndex],subjectRecords=[...stats.records].sort((a,b)=>`${b.scheduledDate}T${b.scheduledStart}`.localeCompare(`${a.scheduledDate}T${a.scheduledStart}`));
      const filters=[['all','All'],['present','Present'],['partial','Partial'],['absent','Absent'],['unverified','Unresolved']];if(!filters.some(([value])=>value===controlUi.subjectFilter))controlUi.subjectFilter='all';const filtered=subjectRecords.filter(record=>attendanceFilterMatches(record,controlUi.subjectFilter));
      const editing=state.attendanceRecords.find(record=>record.id===controlUi.attendanceEditId&&record.subjectKey===stats.subject.key)||null;$('#attendanceNav').hidden=subjects.length<=1;$('#attendancePageLabel').textContent=`${controlUi.subjectIndex+1} / ${subjects.length}`;
      const presentTotal=stats.counts.early+stats.counts.present+stats.counts.late;
      content.innerHTML=`${attendanceModeSwitch('subjects')}<div class="subject-attendance-heading"><span>SUBJECT LOG</span><strong>${escapeHtml(stats.subject.name)}</strong><small>${escapeHtml(stats.subject.code||'No subject code')} · complete chronological attendance history</small></div><div class="subject-log-summary"><div><span>PRESENT</span><strong>${presentTotal}</strong></div><div><span>PARTIAL</span><strong>${stats.counts.partial}</strong></div><div><span>ABSENT</span><strong>${stats.counts.absent}</strong></div><div><span>UNRESOLVED</span><strong>${stats.counts.unverified}</strong></div></div>${editing?attendanceEditorMarkup(editing):''}<div class="subject-log-filters">${filters.map(([value,label])=>`<button type="button" data-attendance-action="subject-filter" data-filter="${value}" class="${controlUi.subjectFilter===value?'active':''}">${label}</button>`).join('')}</div><div class="subject-session-list">${filtered.length?filtered.map(subjectAttendanceRow).join(''):'<div class="subject-session-empty">No sessions match this filter.</div>'}</div>`;return;
    }
    controlUi.attendanceTab='overall';const weekRate=week.required?Math.round(week.attended/week.required*100):0,onTime=academic.counts.early+academic.counts.present,unverified=resolvableUnverifiedRecords(),latestForDisplay=unverified.length?records.find(record=>record.status!=='unverified'||record.finalized)||null:latest;
    const latestMarkup=latestForDisplay?`<div class="attendance-latest-card"><div><span>LATEST RECORD</span><strong>${escapeHtml(latestForDisplay.subjectName)}</strong><small>${escapeHtml(attendanceDateLabel(latestForDisplay.scheduledDate))} · ${formatTime(latestForDisplay.scheduledStart)}</small></div><b class="attendance-status-${escapeHtml(latestForDisplay.status)}">${escapeHtml(attendanceStatusLabel(latestForDisplay.status).toUpperCase())}</b></div>`:unverified.length?'':'<div class="schedule-empty attendance-empty"><strong>No Attendance Records</strong><span>Scheduled sessions will appear here automatically.</span></div>';
    content.innerHTML=`${attendanceModeSwitch('overall')}<div class="attendance-overview-stats"><div><span>ATTENDANCE</span><strong>${academic.attendanceRate}%</strong></div><div><span>PUNCTUALITY</span><strong>${academic.punctualityRate}%</strong></div><div><span>THIS WEEK</span><strong>${week.required?`${week.attended}/${week.required}`:'—'}</strong><small>${week.required?`${weekRate}% attended`:'No required classes yet'}</small></div><div><span>CURRENT STREAK</span><strong>${academic.streaks.current}</strong></div></div><div class="attendance-counts simplified-attendance-counts"><div><span>PRESENT</span><strong>${onTime+academic.counts.late}</strong></div><div><span>PARTIAL</span><strong>${academic.counts.partial}</strong></div><div><span>ABSENT</span><strong>${academic.counts.absent}</strong></div><div><span>UNRESOLVED</span><strong>${academic.counts.unverified}</strong></div><div><span>EXCUSED</span><strong>${academic.counts.excused}</strong></div><div><span>NO CLASS</span><strong>${academic.counts['no-class']}</strong></div></div><div class="attendance-overview-lower">${unverifiedAttendanceMarkup(unverified)}${latestMarkup}</div>`;
  };
  const SETTINGS_EXPORT_VERSION=1;
  const progressExportKeys=['player','dayRecords','attendanceRecords','academicTasks','recurringTaskRules','tradingNotes','quests','weeklyDebriefs'];
  const settingsExportFilename=kind=>{
    const now=new Date(),time=`${pad(now.getHours())}${pad(now.getMinutes())}`,label=kind==='full'?'full-backup':kind;
    return `ascend-${label}-${S.dateKey(now)}-${time}.json`;
  };
  const downloadJson=(text,filename)=>{
    const blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=filename;link.hidden=true;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  };
  const buildSettingsExport=kind=>{
    if(kind==='full')return S.createBackup(state);
    const data={};
    if(kind==='progress')progressExportKeys.forEach(key=>{data[key]=clone(state[key])});
    else if(kind==='schedule'){data.classSchedule=clone(state.classSchedule||[]);data.scheduleHistory=clone(state.scheduleHistory||[]);data.scheduleExceptions=clone(state.scheduleExceptions||[])}
    else throw new Error('Unknown export type.');
    return JSON.stringify({app:'ASCEND',exportType:kind,exportVersion:SETTINGS_EXPORT_VERSION,schemaVersion:S.schemaInfo().version,exportedAt:new Date().toISOString(),data},null,2);
  };
  const settingsProgressSummary=data=>{
    const player=data.player||{};
    return{title:`${player.codename||player.name||'Player'} · Level ${Number(player.level||1)} · ${player.rank||'E'}-Rank`,details:`${Object.keys(data.dayRecords||{}).length} days · ${(data.attendanceRecords||[]).length} attendance · ${(data.academicTasks||[]).length} tasks · ${(data.quests?.history||[]).length} quest records`};
  };
  const settingsScheduleSummary=data=>{
    const classes=Array.isArray(data.classSchedule)?data.classSchedule:[],history=Array.isArray(data.scheduleHistory)?data.scheduleHistory:[],exceptions=Array.isArray(data.scheduleExceptions)?data.scheduleExceptions:[],subjects=new Set([...classes,...history].map(item=>String(item.subject||'').trim().toLowerCase()).filter(Boolean));
    return{title:`${classes.length} active class${classes.length===1?'':'es'} · ${subjects.size} subject${subjects.size===1?'':'s'}`,details:`${history.length} historical schedule revision${history.length===1?'':'s'} · ${exceptions.length} exception${exceptions.length===1?'':'s'}`};
  };
  const parseSettingsImport=(text,kind)=>{
    if(kind==='full'){const imported=S.parseBackup(text),summary=S.summarize(imported);return{kind,state:imported,summary:{title:`${summary.playerName} · Level ${summary.level} · ${summary.rank}-Rank`,details:`${summary.days} days · ${summary.attendance} attendance · ${summary.tasks} tasks · ${summary.schedules} classes`}}}
    let parsed;try{parsed=JSON.parse(text)}catch(error){throw new Error('The selected file is not valid JSON.')}
    if(!parsed||parsed.app!=='ASCEND'||parsed.exportType!==kind||!parsed.data||typeof parsed.data!=='object')throw new Error(`Choose an ASCEND ${kind} backup created from Settings.`);
    const data=parsed.data;
    if(kind==='progress'){
      if(!data.player||typeof data.player!=='object'||Array.isArray(data.player))throw new Error('The progress backup is missing the Player record.');
      if(!data.dayRecords||typeof data.dayRecords!=='object'||Array.isArray(data.dayRecords))throw new Error('The progress backup is missing day records.');
      ['attendanceRecords','academicTasks','recurringTaskRules','tradingNotes','weeklyDebriefs'].forEach(key=>{if(!Array.isArray(data[key]))throw new Error(`The progress backup has invalid ${key}.`)});
      if(!data.quests||typeof data.quests!=='object')throw new Error('The progress backup is missing quest records.');
      const merged=clone(state);progressExportKeys.forEach(key=>{merged[key]=clone(data[key])});const validated=S.normalizeCurrent(merged),validatedData={};progressExportKeys.forEach(key=>{validatedData[key]=clone(validated[key])});
      return{kind,data:validatedData,summary:settingsProgressSummary(validatedData)};
    }
    if(!Array.isArray(data.classSchedule)||!Array.isArray(data.scheduleExceptions))throw new Error('The schedule backup is missing class or exception records.');
    const merged=clone(state);merged.classSchedule=clone(data.classSchedule);merged.scheduleHistory=Array.isArray(data.scheduleHistory)?clone(data.scheduleHistory):[];merged.scheduleExceptions=clone(data.scheduleExceptions);const validated=S.normalizeCurrent(merged),validatedData={classSchedule:clone(validated.classSchedule),scheduleHistory:clone(validated.scheduleHistory||[]),scheduleExceptions:clone(validated.scheduleExceptions)};
    return{kind,data:validatedData,summary:settingsScheduleSummary(validatedData)};
  };
  const clearSettingsImport=()=>{
    settingsUi={pending:null,fileName:'',kind:''};
    ['settingsProgressFile','settingsScheduleFile','settingsFullFile'].forEach(id=>{const input=$(`#${id}`);if(input)input.value=''});
    if(controlUi.view==='settingsView')renderSettings();
  };
  const renderSettings=()=>{
    setControlView('settingsView');
    const lead=$('#settingsNotificationLead'),timeFormat=$('#settingsTimeFormat'),preview=$('#settingsImportPreview');
    if(lead)lead.value=state.settings.notifications?String(state.settings.notificationLeadMinutes||10):'off';
    if(timeFormat)timeFormat.value=state.settings.timeFormat==='24'?'24':'12';
    if(preview){preview.hidden=!settingsUi.pending;if(settingsUi.pending){const summary=settingsUi.pending.summary;$('#settingsImportType').textContent=`${settingsUi.kind.toUpperCase()} LOAD PREVIEW`;$('#settingsImportTitle').textContent=summary.title;$('#settingsImportDetails').textContent=summary.details;$('#settingsImportWarning').textContent=settingsUi.kind==='full'?'This replaces the complete local ASCEND state. A safety rollback is created first.':`This replaces only ${settingsUi.kind} data. Everything else stays unchanged, and a safety rollback is created first.`}}
  };
  const exportSettingsData=kind=>{
    state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'backup',message:`Settings ${kind} backup exported.`});save({silent:true});
    downloadJson(buildSettingsExport(kind),settingsExportFilename(kind));
    systemFeedback('clear',`${kind} backup exported.`);showSystemNotice('backup','BACKUP COMPLETE',`${kind==='full'?'Complete':kind[0].toUpperCase()+kind.slice(1)} data downloaded successfully.`,2200);
  };
  const previewSettingsFile=async(file,kind)=>{
    if(!file)return;if(file.size>10*1024*1024){showBreachWarning('BACKUP TOO LARGE','Choose an ASCEND backup smaller than 10 MB.');return}
    try{settingsUi={pending:parseSettingsImport(await file.text(),kind),fileName:file.name,kind};renderSettings();haptic('tap')}catch(error){clearSettingsImport();showBreachWarning('BACKUP NOT ACCEPTED',error?.message||'The selected file could not be read.')}
  };
  const confirmSettingsImport=()=>{
    if(!settingsUi.pending)return;
    const kind=settingsUi.kind,fileName=settingsUi.fileName;
    try{
      S.createDailySnapshot(state,true);S.createPreUpdateRollback(clone(state),Number(state.version||S.schemaInfo().version),`Before Settings ${kind} import`);
      if(kind==='full')state=settingsUi.pending.state;else{const merged=clone(state);if(kind==='progress')progressExportKeys.forEach(key=>{merged[key]=clone(settingsUi.pending.data[key])});else{merged.classSchedule=clone(settingsUi.pending.data.classSchedule);merged.scheduleHistory=clone(settingsUi.pending.data.scheduleHistory||[]);merged.scheduleExceptions=clone(settingsUi.pending.data.scheduleExceptions)}state=S.normalizeCurrent(merged)}
      state.logs=Array.isArray(state.logs)?state.logs:[];state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'restore',message:`Settings ${kind} backup restored${fileName?`: ${fileName}`:''}.`});
      if(kind==='schedule')invalidateExternalCalendar();
      save({silent:true});settingsUi={pending:null,fileName:'',kind:''};controlUi.correction=false;scheduleUi.editId=null;activeScreenId=null;
      if(kind==='full'){closeScheduleOverlay();renderApp()}else renderSettings();
      showSystemNotice('restore','DATA RESTORED',`${kind==='full'?'Complete ASCEND data':kind[0].toUpperCase()+kind.slice(1)+' data'} restored safely.`,2800);
    }catch(error){showBreachWarning('RESTORE FAILED',error?.message||'The selected data could not be restored.')}
  };
  const updateSettingsNotification=async value=>{
    if(value==='off'){state.settings.notifications=false;save({silent:true});renderSettings();return}
    const lead=clamp(Number(value||10),5,30);
    if(!('Notification' in window)){showBreachWarning('ALERTS NOT SUPPORTED','This browser does not support local notifications.');renderSettings();return}
    if(Notification.permission!=='granted'){
      const permission=await Notification.requestPermission();if(permission!=='granted'){state.settings.notifications=false;showBreachWarning('ALERT PERMISSION DENIED','Enable notifications in browser or app settings first.');renderSettings();return}
    }
    state.settings.notifications=true;state.settings.notificationLeadMinutes=lead;invalidateExternalCalendar();save({silent:true});renderSettings();
  };
  const updateSettingsTimeFormat=value=>{state.settings.timeFormat=value==='24'?'24':'12';save({silent:true});updateClock();renderSettings()};
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
  const resetClockAccessVisual=()=>{
    const clock=$('#clockPanel');if(!clock)return;
    clock.classList.remove('schedule-arming');
    clock.style.setProperty('--schedule-access-progress','0deg');
  };

  const directiveDayLabels=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const directiveLongDayLabels=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const directiveLinkedLabel=(step,protocolId=directiveUi.draft?.id)=>directiveCoreProtocols.has(protocolId)&&(directiveLinkedSteps.has(step.id)||!directiveStandardTypes.has(step.type));
  const directiveDaysCopy=days=>{const normalized=[...(days||[])].sort((a,b)=>a-b);if(normalized.length===7)return'Every day';if(normalized.join(',')==='1,2,3,4,5')return'Weekdays';return normalized.map(day=>directiveDayLabels[day]).join(' · ')||'No active days'};
  const directiveWorkingDefinition=id=>{const def=directiveProtocolDefinition(id);return def?clone(def):null};
  const directiveProtocolStatusCopy=def=>def.enabled===false?'DISABLED':def.systemRole!=='standard'?`${def.systemRole.toUpperCase()} ROLE`:def.custom?'CUSTOM':'STANDARD';
  const directiveTemplateLibrary={
    blank:{name:'Custom Protocol',short:'CUSTOM',icon:'apex',start:'17:00',end:'18:00',prep:'Complete the configured directives during this window.',steps:[['Prepare','Set up what you need before starting.','hold','list'],['Complete the main action','Finish the core action for this protocol.','hold','confirm']]},
    study:{name:'Study Protocol',short:'STUDY',icon:'academic',start:'19:00',end:'20:00',prep:'Prepare notes, references, water, and a distraction-free workspace.',steps:[['Prepare study space','Open the required material and remove distractions.','hold','grid'],['Focused study block','Study without rushing for the configured time.','timer','academic',25],['Record progress','Write what was completed and what remains.','tap','success']]},
    reading:{name:'Reading Protocol',short:'READ',icon:'list',start:'19:00',end:'19:40',prep:'Prepare your book or reading material before the window begins.',steps:[['Prepare reading material','Open the exact material you intend to read.','hold','list'],['Reading block','Read attentively for the configured time.','timer','academic',20],['Record one takeaway','Confirm one useful takeaway from the session.','tap','success']]},
    exercise:{name:'Exercise Protocol',short:'MOVE',icon:'stretch',start:'17:00',end:'18:00',prep:'Prepare water, clothing, and a safe exercise space.',steps:[['Prepare','Prepare water and your exercise area.','hold','list'],['Exercise timer','Complete your planned movement session.','timer','stretch',20],['Recover','Hydrate and complete a short cooldown.','hold','water']]},
    meal:{name:'Meal Protocol',short:'MEAL',icon:'meal',start:'12:00',end:'13:00',prep:'Prepare a complete meal and water.',steps:[['Prepare meal','Prepare the planned meal.','hold','list'],['Eat meal','Finish the meal without unnecessary delay.','hold','meal'],['Hydrate','Drink water with the meal.','hold','water']]},
    morning:{name:'Morning Routine',short:'AM',icon:'wake',start:'06:30',end:'07:15',prep:'Prepare the items needed for a clean morning start.',steps:[['Reset space','Put the immediate area in order.','hold','reset'],['Hygiene','Complete your personal morning hygiene.','hold','shine'],['Plan the day','Review the most important commitments for today.','tap','list']]},
    night:{name:'Night Routine',short:'PM',icon:'sleep',start:'21:00',end:'22:00',prep:'Close open obligations and prepare for recovery.',steps:[['Reset tomorrow','Prepare essentials for the next day.','hold','next'],['Night hygiene','Complete personal night hygiene.','hold','shine'],['Wind down','Use the timer for a quiet screen-light wind-down.','timer','sleep',15]]},
    cleaning:{name:'Cleaning Protocol',short:'CLEAN',icon:'grid',start:'16:00',end:'17:00',prep:'Choose the area and prepare the supplies you need.',steps:[['Prepare supplies','Gather the cleaning supplies for this session.','hold','list'],['Cleaning sprint','Clean the selected area for the configured time.','timer','grid',20],['Reset supplies','Return supplies and leave the area organized.','hold','success']]},
    meditation:{name:'Meditation Protocol',short:'RESET',icon:'sleep',start:'18:00',end:'18:30',prep:'Choose a quiet place and silence unnecessary notifications.',steps:[['Settle','Sit comfortably and prepare to begin.','hold','sleep'],['Meditation timer','Complete the quiet breathing or meditation block.','timer','sleep',10],['Close session','Confirm the session is complete.','tap','success']]}
  };
  const uniqueProtocolId=(base='custom')=>{let id=`${base}-${Date.now().toString(36)}`,index=1;while(directiveProtocolIds().includes(id))id=`${base}-${Date.now().toString(36)}-${index++}`;return id};
  const newDirectiveProtocolDraft=(templateKey='blank')=>{const template=directiveTemplateLibrary[templateKey]||directiveTemplateLibrary.blank,id=uniqueProtocolId(templateKey);return{id,custom:true,systemRole:'standard',enabled:true,required:false,name:template.name,short:template.short,prep:template.prep,icon:template.icon,start:template.start,end:template.end,activeDays:[0,1,2,3,4,5,6],schedulingMode:'flexible',priority:'normal',allowSkipToday:true,xpMode:'automatic',xp:100,subtasks:template.steps.map((item,index)=>({id:`${id}-step-${index+1}`,title:item[0],copy:[item[1],item[1]],type:item[2],icon:item[3],duration:item[4]||10,enabled:true,required:true,allowSkip:item[2]==='timer',perfectRequired:true,holdDuration:1800}))};};
  const renderDirectiveStudio=()=>{
    setControlView('directiveStudioView');directiveUi.protocolId=null;directiveUi.stepId=null;directiveUi.draft=null;directiveUi.dirty=false;directiveUi.preview=false;
    const definitions=directiveProtocolIds().map(id=>directiveProtocolDefinition(id)).filter(Boolean).sort((a,b)=>minutes(a.start)-minutes(b.start)||(directivePriorityWeight[b.priority]||2)-(directivePriorityWeight[a.priority]||2));
    $('#directiveProtocolList').innerHTML=definitions.length?definitions.map(def=>{const enabledCount=def.subtasks.filter(step=>step.enabled!==false).length,rule=def.required===false?'OPTIONAL':'REQUIRED';return `<button class="directive-protocol-card ${def.enabled===false?'disabled':''} ${def.custom?'custom':''} ${def.required===false?'optional':'required'}" type="button" data-directive-protocol="${escapeHtml(def.id)}"><span class="directive-protocol-time">${escapeHtml(formatTime(def.start))}<i></i>${escapeHtml(formatTime(def.end))}</span><section><strong>${escapeHtml(def.name)}</strong><small>${escapeHtml(directiveDaysCopy(def.activeDays))} · ${enabledCount} directive${enabledCount===1?'':'s'} · ${escapeHtml(def.schedulingMode)}</small></section><b>${rule} · ${directiveProtocolStatusCopy(def)}</b></button>`}).join(''):'<div class="schedule-empty"><strong>No protocols</strong><span>Create a protocol from a template.</span></div>';
    const historyCount=state.directiveConfig?.history?.length||0;$('#directiveStudioMeta').textContent=`${definitions.filter(def=>def.enabled!==false).length} enabled · ${definitions.length} total · ${historyCount} saved version${historyCount===1?'':'s'}`;$('#directiveUndo').disabled=!historyCount;$('#directiveRestoreAll').textContent='Restore All Defaults';directiveUi.restoreArmedUntil=0;directiveUi.deleteArmedUntil=0;
  };
  const renderDirectivePreview=()=>{const draft=directiveUi.draft,panel=$('#directivePreviewPanel');if(!draft||!directiveUi.preview){panel.hidden=true;return}panel.hidden=false;const steps=draft.subtasks.filter(step=>step.enabled!==false);$('#directivePreviewContent').innerHTML=`<div class="directive-preview-protocol"><header><strong>${escapeHtml(draft.name)}</strong><span>${escapeHtml(formatTime(draft.start))} – ${escapeHtml(formatTime(draft.end))}</span></header><p>${escapeHtml(draft.prep||'No preparation message.')}</p><div class="directive-preview-steps">${steps.map((step,index)=>`<div><b>${String(index+1).padStart(2,'0')}</b><strong>${escapeHtml(step.title)}</strong><small>${escapeHtml(step.type.toUpperCase())}${step.required===false?' · OPTIONAL':''}${step.allowSkip?' · SKIP':''}</small></div>`).join('')}</div></div>`};
  const renderDirectiveEditor=()=>{
    const draft=directiveUi.draft;if(!draft){renderDirectiveStudio();return}setControlView('directiveEditorView');const core=directiveCoreProtocols.has(draft.id),wake=draft.id==='wake';
    $('#directiveEditorEyebrow').textContent=`${draft.short||draft.id.toUpperCase()} · ${draft.systemRole!=='standard'?`${draft.systemRole.toUpperCase()} SYSTEM ROLE`:draft.custom?'CUSTOM PROTOCOL':'STANDARD PROTOCOL'}`;$('#directiveEditorTitle').textContent=draft.name;
    $('#directiveName').value=draft.name;$('#directiveShort').value=draft.short||'';$('#directivePrep').value=draft.prep||'';$('#directiveStart').value=draft.start;$('#directiveEnd').value=draft.end;$('#directiveProtocolEnabled').checked=draft.enabled!==false;$('#directiveProtocolEnabled').disabled=wake;$('#directiveProtocolRequired').checked=draft.required!==false;$('#directiveProtocolRequired').disabled=wake;$('#directiveSchedulingMode').value=draft.schedulingMode||'fixed';$('#directivePriority').value=draft.priority||'normal';$('#directiveXpMode').value=draft.xpMode||'custom';$('#directiveXpValue').value=Math.round(Number(draft.xp||100));$('#directiveXpValueWrap').hidden=draft.xpMode!=='custom';$('#directiveAllowSkipToday').checked=draft.allowSkipToday!==false;$('#directiveAllowSkipToday').disabled=wake;
    $('#directiveSystemRole').textContent=(draft.systemRole||'standard').toUpperCase();$('#directiveProtocolRuleSummary').textContent=`${draft.required===false?'Optional':'Required'} · ${draft.schedulingMode==='flexible'?'Flexible window':'Fixed window'} · ${String(draft.priority||'normal').toUpperCase()} priority`;$('#directiveCoreNote').hidden=!core;
    $('#directiveDayButtons').innerHTML=directiveLongDayLabels.map((label,day)=>`<button type="button" data-directive-day="${day}" class="${draft.activeDays.includes(day)?'selected':''}" ${wake?'disabled':''}>${label.slice(0,3)}</button>`).join('');
    $('#directiveStepList').innerHTML=draft.subtasks.map((step,index)=>{const linked=directiveLinkedLabel(step,draft.id);return `<div class="directive-step-row ${step.enabled===false?'disabled':''} ${linked?'linked':''} ${step.required===false?'optional':''} ${step.allowSkip?'skippable':''}" data-directive-step="${escapeHtml(step.id)}"><span>${String(index+1).padStart(2,'0')}</span><section><strong>${escapeHtml(step.title)}</strong><small>${escapeHtml(step.type.toUpperCase())}${linked?' · SYSTEM-LINKED':''}${step.required===false?' · OPTIONAL':' · REQUIRED'}${step.allowSkip?' · SKIPPABLE':''}${step.enabled===false?' · DISABLED':''}</small></section><div class="directive-step-actions"><button type="button" data-step-action="up" ${linked||index===0?'disabled':''} aria-label="Move directive up">↑</button><button type="button" data-step-action="down" ${linked||index===draft.subtasks.length-1?'disabled':''} aria-label="Move directive down">↓</button><button type="button" data-step-action="toggle" ${linked?'disabled':''}>${step.enabled===false?'On':'Off'}</button><button type="button" data-step-action="edit">Edit</button><button type="button" data-step-action="delete" ${linked?'disabled':''}>×</button></div></div>`}).join('');
    $('#directiveUnsaved').hidden=!directiveUi.dirty;$('#directiveRestoreProtocol').hidden=!protocolDefaultById(draft.id);$('#directiveDeleteProtocol').hidden=!draft.custom;$('#directiveDeleteProtocol').querySelector('b').textContent='Delete Protocol';directiveUi.deleteArmedUntil=0;
    const today=dayRecord()?.protocols?.[draft.id],skipAllowed=draft.allowSkipToday!==false&&today?.status==='pending';$('#directiveSkipToday').hidden=wake;$('#directiveSkipToday').disabled=!skipAllowed;$('#directiveSkipToday').textContent=today?.status==='skipped'?'Skipped Today':skipAllowed?'Skip Today':'Skip Today · Unavailable';$('#directivePreview').textContent=directiveUi.preview?'Close Preview':'Preview';renderDirectivePreview();
  };
  const openDirectiveEditor=id=>{const def=directiveWorkingDefinition(id);if(!def)return;directiveUi={...directiveUi,protocolId:id,stepId:null,isNew:false,isNewProtocol:false,draft:def,dirty:false,preview:false,deleteArmedUntil:0};renderDirectiveEditor()};
  const openNewDirectiveProtocol=()=>{const template=$('#directiveTemplateSelect').value||'blank',draft=newDirectiveProtocolDraft(template);directiveUi={...directiveUi,protocolId:draft.id,stepId:null,isNew:false,isNewProtocol:true,draft,dirty:true,preview:false,deleteArmedUntil:0};renderDirectiveEditor()};
  const directiveStepById=id=>directiveUi.draft?.subtasks?.find(step=>step.id===id)||null;
  const openDirectiveStepEditor=(id=null)=>{if(!directiveUi.draft)return;directiveUi.stepId=id;directiveUi.isNew=!id;const step=id?directiveStepById(id):{id:`custom-${Date.now().toString(36)}`,title:'New Directive',copy:['Complete this directive before continuing.',''],icon:'apex',type:'hold',enabled:true,required:true,allowSkip:false,perfectRequired:true,duration:10,holdDuration:1800};if(!step)return;setControlView('directiveStepView');const linked=id?directiveLinkedLabel(step,directiveUi.draft.id):false;$('#directiveStepEyebrow').textContent=linked?'SYSTEM-LINKED DIRECTIVE':'CUSTOM DIRECTIVE';$('#directiveStepTitle').textContent=id?'Edit Directive':'Add Directive';$('#directiveStepName').value=step.title||'';$('#directiveStepCopy').value=Array.isArray(step.copy)?step.copy[0]||'':step.copy||'';$('#directiveStepAltCopy').value=Array.isArray(step.copy)?step.copy[1]||'':'';$('#directiveStepIcon').value=normalizeGlyph(step.icon||'apex');$('#directiveStepType').value=directiveStandardTypes.has(step.type)?step.type:'hold';$('#directiveStepType').disabled=linked;$('#directiveStepDuration').value=Number(step.duration||10);$('#directiveStepDurationWrap').hidden=(linked?step.type:$('#directiveStepType').value)!=='timer';$('#directiveStepRequired').checked=step.required!==false;$('#directiveStepRequired').disabled=linked;$('#directiveStepAllowSkip').checked=Boolean(step.allowSkip);$('#directiveStepAllowSkip').disabled=step.type==='system';$('#directiveStepLinkedNote').hidden=!linked;$('#directiveStepDelete').hidden=!id||linked;};
  const captureDirectiveGeneralFields=()=>{const draft=directiveUi.draft;if(!draft)return;draft.name=$('#directiveName').value.trim();draft.short=$('#directiveShort').value.trim().toUpperCase().slice(0,16)||'CUSTOM';draft.prep=$('#directivePrep').value.trim();draft.start=$('#directiveStart').value;draft.end=$('#directiveEnd').value;draft.enabled=draft.id==='wake'?true:$('#directiveProtocolEnabled').checked;draft.required=draft.id==='wake'?true:$('#directiveProtocolRequired').checked;draft.schedulingMode=$('#directiveSchedulingMode').value;draft.priority=$('#directivePriority').value;draft.xpMode=$('#directiveXpMode').value;draft.xp=clamp(Number($('#directiveXpValue').value||draft.xp||100),10,500);draft.allowSkipToday=draft.id==='wake'?false:$('#directiveAllowSkipToday').checked;if(draft.xpMode==='automatic')draft.xp=automaticProtocolXp(draft);directiveUi.dirty=true;};
  const validateDirectiveDraft=draft=>{if(!draft.name)return'Protocol name is required.';if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.end)||minutes(draft.end)<=minutes(draft.start))return'Protocol end time must be later than its start time.';if(draft.enabled!==false&&!draft.activeDays.length)return'Choose at least one active day.';if(draft.enabled!==false&&!draft.subtasks.some(step=>step.enabled!==false))return'At least one directive must remain enabled.';if(draft.id==='wake'&&(draft.enabled===false||draft.required===false||draft.activeDays.length!==7))return'The Wake system role must remain enabled, required, and active every day.';const ids=new Set();for(const step of draft.subtasks){if(ids.has(step.id))return'Directive IDs must remain unique inside a protocol.';ids.add(step.id);if(!String(step.title||'').trim())return'Every directive needs a title.';if(step.type==='timer'&&(!Number(step.duration)||Number(step.duration)<1))return'Timer directives need a duration of at least one minute.'}if(draft.id==='productivity'){const audit=draft.subtasks.findIndex(step=>step.id==='subject-audit'),plan=draft.subtasks.findIndex(step=>step.id==='execution-plan');if(audit>=0&&plan>=0&&audit>plan)return'Subject Task Audit must remain before the execution planner.'}if(draft.id==='workout'){const dungeon=draft.subtasks.findIndex(step=>step.id==='workout-dungeon'),cooldown=draft.subtasks.findIndex(step=>step.id==='workout-cooldown');if(dungeon>=0&&cooldown>=0&&dungeon>cooldown)return'Workout Dungeon must remain before the cooldown.'}return'';};
  const directiveOverlapList=draft=>directiveProtocolIds().filter(id=>id!==draft.id).map(id=>directiveProtocolDefinition(id)).filter(other=>other&&other.enabled!==false&&draft.enabled!==false&&draft.activeDays.some(day=>other.activeDays.includes(day))&&minutes(draft.start)<minutes(other.end)&&minutes(draft.end)>minutes(other.start));
  const pushDirectiveHistory=()=>{state.directiveConfig=state.directiveConfig||{version:2,protocols:{},history:[],updatedAt:null};state.directiveConfig.history=Array.isArray(state.directiveConfig.history)?state.directiveConfig.history:[];state.directiveConfig.history.push({at:new Date().toISOString(),protocols:clone(state.directiveConfig.protocols||{})});state.directiveConfig.history=state.directiveConfig.history.slice(-5)};
  const syncCurrentDayDirectiveConfig=id=>{const record=dayRecord(),config=blueprint(id);if(!record||record.date!==currentKey()||record.status!=='active')return;const current=record.protocols?.[id],eligible=protocolEligibleForDate(config,new Date()),nowMinute=todayMinutes(new Date());if(current?.status==='active'||current?.status==='cleared'||current?.status==='failed'||current?.status==='skipped')return;if(current&&current.status==='pending'){if(!eligible)delete record.protocols[id];else record.protocols[id]=makeProtocolState(config,record.weeklyBoss,new Date())}else if(!current&&eligible&&nowMinute<minutes(config.end))record.protocols[id]=makeProtocolState(config,record.weeklyBoss,new Date());record.completedProtocols=Object.values(record.protocols||{}).filter(item=>item.status==='cleared').length;record.failedProtocols=Object.values(record.protocols||{}).filter(item=>item.status==='failed').length;syncWakeBathForWorkout(record)};
  const syncAllCurrentDayDirectiveConfigs=ids=>[...new Set([...(ids||[]),...directiveProtocolIds(),...Object.keys(dayRecord()?.protocols||{})])].forEach(syncCurrentDayDirectiveConfig);
  const saveDirectiveProtocol=()=>{captureDirectiveGeneralFields();const draft=directiveUi.draft,active=activeProtocolRecord();if(active?.id===draft?.id){showBreachWarning('PROTOCOL CURRENTLY ACTIVE','Finish the active protocol before changing its live configuration.');return}const issue=validateDirectiveDraft(draft);if(issue){showBreachWarning('DIRECTIVE CONFIGURATION BLOCKED',issue);return}const overlaps=directiveOverlapList(draft);pushDirectiveHistory();state.directiveConfig.protocols[draft.id]=clone({...draft,custom:undefined});state.directiveConfig.version=2;state.directiveConfig.updatedAt=new Date().toISOString();refreshDirectiveBlueprints();syncCurrentDayDirectiveConfig(draft.id);state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'system',message:`Directive Studio updated ${draft.name}.`});save();directiveUi.dirty=false;systemFeedback('clear','Directive configuration saved.');renderDirectiveStudio();if(overlaps.length)showSystemNotice('alert','OVERLAP SAVED',`${draft.name} overlaps ${overlaps[0].name}. ASCEND will queue by priority, then nearest deadline.`,3200)};
  const restoreDirectiveProtocolDraft=()=>{const base=protocolDefaultById(directiveUi.protocolId);if(!base)return;directiveUi.draft=directiveProtocolDefinition(base.id);const override=state.directiveConfig?.protocols?.[base.id];directiveUi.draft={id:base.id,custom:false,systemRole:directiveSystemRoles[base.id]||'standard',enabled:true,required:true,name:base.name,short:base.short,prep:base.prep,icon:base.icon,start:base.start,end:base.end,activeDays:clone(directiveDefaultDays[base.id]),schedulingMode:'fixed',priority:base.id==='wake'||base.id==='shutdown'?'high':'normal',allowSkipToday:base.id!=='wake',xpMode:'custom',xp:base.xp,subtasks:base.subtasks(state.player.level).map(step=>({...clone(step),enabled:true,required:true,allowSkip:step.type==='timer',perfectRequired:true}))};directiveUi.dirty=true;directiveUi.preview=false;renderDirectiveEditor();showSystemNotice('restore','DEFAULTS LOADED','Review the restored protocol, then Save Changes.',2200)};
  const restoreAllDirectiveDefaults=()=>{if(activeProtocolRecord()){showBreachWarning('ACTIVE PROTOCOL PROTECTED','Finish the active protocol before restoring all protocol defaults.');return}const now=Date.now();if(directiveUi.restoreArmedUntil<now){directiveUi.restoreArmedUntil=now+5000;$('#directiveRestoreAll').textContent='Click Again to Confirm';showSystemNotice('alert','CONFIRM RESTORE','This removes custom protocols and restores the six original definitions.',2600);return}const before=directiveProtocolIds();pushDirectiveHistory();state.directiveConfig.protocols={};state.directiveConfig.version=2;state.directiveConfig.updatedAt=new Date().toISOString();refreshDirectiveBlueprints();syncAllCurrentDayDirectiveConfigs(before);state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'system',message:'Directive Studio restored all protocol defaults and removed custom protocols.'});save();renderDirectiveStudio();showSystemNotice('restore','PROTOCOLS RESTORED','Original protocol definitions are active again.',2400)};
  const duplicateDirectiveProtocol=()=>{captureDirectiveGeneralFields();const source=directiveUi.draft;if(!source)return;const id=uniqueProtocolId('copy'),draft=clone(source);draft.id=id;draft.custom=true;draft.systemRole='standard';draft.name=`${source.name} Copy`.slice(0,60);draft.short='COPY';draft.required=false;draft.xpMode='automatic';draft.allowSkipToday=true;draft.subtasks=draft.subtasks.map((step,index)=>({...step,id:`${id}-step-${index+1}`,type:directiveStandardTypes.has(step.type)?step.type:'hold',autoComplete:false,minDuration:undefined,recommendedMax:undefined,required:true,allowSkip:step.type==='timer'}));draft.xp=automaticProtocolXp(draft);directiveUi={...directiveUi,protocolId:id,draft,dirty:true,isNewProtocol:true,preview:false};renderDirectiveEditor();showSystemNotice('save','DUPLICATE READY','The copy is optional by default. Adjust it, then Save Changes.',2200)};
  const deleteDirectiveProtocol=()=>{const draft=directiveUi.draft;if(!draft?.custom)return;const active=activeProtocolRecord();if(active?.id===draft.id){showBreachWarning('PROTOCOL CURRENTLY ACTIVE','Finish the active protocol before deleting it.');return}const now=Date.now();if((directiveUi.deleteArmedUntil||0)<now){directiveUi.deleteArmedUntil=now+5000;$('#directiveDeleteProtocol b').textContent='Click Again to Delete';showSystemNotice('alert','CONFIRM DELETE','The protocol definition will be removed. Historical completed records stay intact.',2400);return}pushDirectiveHistory();delete state.directiveConfig.protocols[draft.id];state.directiveConfig.updatedAt=new Date().toISOString();const record=dayRecord();if(record?.protocols?.[draft.id]?.status==='pending')delete record.protocols[draft.id];refreshDirectiveBlueprints();state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'system',message:`Custom protocol deleted: ${draft.name}.`});save();renderDirectiveStudio();showSystemNotice('restore','PROTOCOL DELETED','The custom protocol was removed.',2000)};
  const skipDirectiveProtocolToday=()=>{const draft=directiveUi.draft,record=dayRecord(),protocol=record?.protocols?.[draft?.id];if(!draft||draft.id==='wake'||draft.allowSkipToday===false||!protocol||protocol.status!=='pending'){showBreachWarning('SKIP TODAY UNAVAILABLE','Only a pending protocol with Skip Today enabled can be excused for the current day.');return}transitionProtocol(protocol,'skipped',{at:new Date().toISOString(),reason:'Skipped for today from Directive Studio.',excused:true});state.logs.push({id:S.uid('log'),at:protocol.completedAt,type:'protocol',message:`${protocol.name} skipped for today and excused from Daily Clear.`});save();showSystemNotice('alert','SKIPPED FOR TODAY',`${protocol.name} returns on its next eligible day.`,2400);renderDirectiveEditor();};
  const saveDirectiveStep=()=>{const draft=directiveUi.draft;if(!draft)return;const existing=directiveUi.stepId?directiveStepById(directiveUi.stepId):null,linked=existing?directiveLinkedLabel(existing,draft.id):false,title=$('#directiveStepName').value.trim(),copy=$('#directiveStepCopy').value.trim(),alt=$('#directiveStepAltCopy').value.trim(),type=linked?existing.type:$('#directiveStepType').value,duration=clamp(Number($('#directiveStepDuration').value||10),1,180),icon=normalizeGlyph($('#directiveStepIcon').value),required=linked?true:$('#directiveStepRequired').checked,allowSkip=type==='system'?false:$('#directiveStepAllowSkip').checked;if(!title||!copy){showBreachWarning('DIRECTIVE INCOMPLETE','Title and primary instruction are required.');return}const next={...(existing||{}),id:existing?.id||`custom-${Date.now().toString(36)}`,title,copy:[copy,alt||copy],icon,type,enabled:existing?.enabled!==false,required,allowSkip,perfectRequired:true,duration:type==='timer'?duration:(existing?.duration||duration),holdDuration:existing?.holdDuration||1800};if(existing){const index=draft.subtasks.findIndex(step=>step.id===existing.id);draft.subtasks[index]=next}else draft.subtasks.push(next);if(draft.xpMode==='automatic')draft.xp=automaticProtocolXp(draft);directiveUi.dirty=true;directiveUi.stepId=null;directiveUi.isNew=false;renderDirectiveEditor()};
  const deleteDirectiveStep=id=>{const step=directiveStepById(id);if(!step||directiveLinkedLabel(step,directiveUi.draft?.id))return;directiveUi.draft.subtasks=directiveUi.draft.subtasks.filter(item=>item.id!==id);if(directiveUi.draft.xpMode==='automatic')directiveUi.draft.xp=automaticProtocolXp(directiveUi.draft);directiveUi.dirty=true;renderDirectiveEditor()};
  const undoDirectiveConfig=()=>{if(activeProtocolRecord()){showBreachWarning('ACTIVE PROTOCOL PROTECTED','Finish the active protocol before restoring a previous protocol version.');return}const history=state.directiveConfig?.history||[];if(!history.length){showSystemNotice('restore','NO PRIOR VERSION','No earlier protocol configuration is stored yet.',1800);return}const before=directiveProtocolIds(),previous=history.pop();state.directiveConfig.protocols=clone(previous.protocols||{});state.directiveConfig.version=2;state.directiveConfig.updatedAt=new Date().toISOString();refreshDirectiveBlueprints();syncAllCurrentDayDirectiveConfigs(before);state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'system',message:'Directive Studio restored the previous protocol configuration version.'});save();renderDirectiveStudio();showSystemNotice('restore','PREVIOUS VERSION RESTORED','The latest protocol configuration was rolled back.',2300)};
  const exportDirectiveConfig=()=>{const payload={app:'ASCEND',exportType:'directives',exportVersion:2,schemaVersion:S.schemaInfo().version,exportedAt:new Date().toISOString(),directiveConfig:clone(state.directiveConfig||{version:2,protocols:{},history:[],updatedAt:null})};downloadJson(JSON.stringify(payload,null,2),`ascend-directives-${S.dateKey()}.json`);showSystemNotice('save','PROTOCOLS EXPORTED','Directive and custom protocol configuration saved as JSON.',2200)};
  const importDirectiveConfig=async file=>{if(!file)return;if(activeProtocolRecord()){showBreachWarning('ACTIVE PROTOCOL PROTECTED','Finish the active protocol before importing protocol settings.');$('#directiveImportFile').value='';return}try{const before=directiveProtocolIds(),text=await file.text(),payload=JSON.parse(text),raw=payload?.directiveConfig||payload?.data?.directiveConfig||payload,merged=clone(state);merged.directiveConfig=raw;const validated=S.normalizeCurrent(merged);pushDirectiveHistory();const previousHistory=clone(state.directiveConfig.history||[]);state.directiveConfig=validated.directiveConfig;state.directiveConfig.history=[...previousHistory,...(state.directiveConfig.history||[])].slice(-5);state.directiveConfig.updatedAt=new Date().toISOString();refreshDirectiveBlueprints();syncAllCurrentDayDirectiveConfigs(before);save();renderDirectiveStudio();showSystemNotice('restore','PROTOCOLS IMPORTED','Configuration was validated and applied safely.',2400)}catch(error){showBreachWarning('DIRECTIVE IMPORT FAILED',error.message||'The selected file is not a valid directive configuration.')}finally{$('#directiveImportFile').value=''}};

  const openControlOverlay=()=>{
    if(!$('#scheduleOverlay').hidden||!$('#emergencyOverlay').hidden||!$('#developerRunOverlay').hidden)return;
    cancelHold();resetClockAccessVisual();controlUi.directDeveloper=false;controlUi.directProfile=false;$('#scheduleOverlay').hidden=false;renderControlHome();haptic('tap');
  };
  const closeScheduleOverlay=()=>{$('#scheduleOverlay').hidden=true;cancelHold('schedule-delete');cancelHold('clock-schedule');cancelHold('profile-settings');resetClockAccessVisual();controlUi.correction=false;controlUi.attendanceEditId=null;controlUi.unverifiedResolveId=null;controlUi.directDeveloper=false;controlUi.directProfile=false;backupUi={pending:null,fileName:''};settingsUi={pending:null,fileName:'',kind:''};if($('#backupFileInput'))$('#backupFileInput').value='';['settingsProgressFile','settingsScheduleFile','settingsFullFile'].forEach(id=>{const input=$(`#${id}`);if(input)input.value=''});renderApp();if(activeProtocolRecord())requestWakeLock()};
  const renderScheduleOverview=()=>{
    setControlView('scheduleOverviewView');scheduleUi.day=Number(scheduleUi.day);const entries=scheduleEntriesForDay(scheduleUi.day);const totalPages=Math.max(1,Math.ceil(entries.length/schedulePageSize));scheduleUi.page=clamp(scheduleUi.page,0,totalPages-1);
    $('#scheduleWeekTabs').innerHTML=scheduleDays.map(day=>{const count=scheduleEntriesForDay(day.value).length;return`<button type="button" data-day="${day.value}" class="${day.value===scheduleUi.day?'selected':''}"><strong>${day.label}</strong><small>${count}</small></button>`}).join('');
    $('#scheduleDayTitle').textContent=scheduleDayName(scheduleUi.day);$('#scheduleDayCount').textContent=`${entries.length} ${entries.length===1?'class':'classes'}`;
    const pageEntries=entries.slice(scheduleUi.page*schedulePageSize,(scheduleUi.page+1)*schedulePageSize);
    $('#scheduleClassList').innerHTML=pageEntries.length?pageEntries.map(entry=>`<button class="schedule-class-row" type="button" data-class-id="${entry.id}"><span>${formatTime(entry.start)}–${formatTime(entry.end)}</span><strong>${escapeHtml(entry.subject)}</strong><small>${escapeHtml([entry.code,entry.modality,entry.room].filter(Boolean).join(' · ')||'No location')}</small><b>EDIT</b></button>`).join(''):'<div class="schedule-empty"><strong>No classes saved</strong><span>Add a class for this day.</span></div>';
    $('#schedulePageNav').hidden=totalPages<=1;$('#schedulePageLabel').textContent=`${scheduleUi.page+1} / ${totalPages}`;$('#schedulePagePrev').disabled=scheduleUi.page===0;$('#schedulePageNext').disabled=scheduleUi.page>=totalPages-1;
  };
  const currentScheduleEntry=()=>state.classSchedule.find(entry=>entry.id===scheduleUi.editId&&entry.active!==false)||null;
  const archiveScheduleVersion=(entry,effectiveTo=currentKey())=>{
    if(!entry)return;state.scheduleHistory=Array.isArray(state.scheduleHistory)?state.scheduleHistory:[];
    const version={...clone(entry),id:S.uid('schedule-version'),classId:entry.id,effectiveFrom:entry.effectiveFrom||(entry.createdAt?S.dateKey(new Date(entry.createdAt)):effectiveTo),effectiveTo,active:false,archivedAt:new Date().toISOString()};
    state.scheduleHistory.push(version);state.scheduleHistory=state.scheduleHistory.slice(-240);
  };
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
      const oldKey=subjectKey(entry.subject),newKey=subjectKey(subject),oldSubject=entry.subject;const oldSubjectStillLinked=activeSchedule().some(item=>item.id!==entry.id&&subjectKey(item.subject)===oldKey),changed=['subject','code','day','room','modality','start','end'].some(key=>String(entry[key]??'')!==String(({subject,code,day,room,modality,start,end})[key]??''));
      if(changed)archiveScheduleVersion(entry,currentKey());
      Object.assign(entry,{subject,code,day,room,modality,start,end,active:true,effectiveFrom:changed?currentKey():(entry.effectiveFrom||(entry.createdAt?S.dateKey(new Date(entry.createdAt)):currentKey())),updatedAt:new Date().toISOString()});
      if(oldKey!==newKey&&!oldSubjectStillLinked){
        state.academicTasks.filter(task=>task.subjectKey===oldKey).forEach(task=>{task.subjectKey=newKey;task.subjectName=subject});
        state.attendanceRecords.filter(record=>record.subjectKey===oldKey).forEach(record=>{record.subjectKey=newKey;record.subjectName=subject;record.code=code||record.code});
        state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'schedule',message:`Academic tasks and attendance relinked from ${oldSubject} to ${subject}.`});
      }
    }else state.classSchedule.push({id:S.uid('class'),subject,code,day,room,modality,start,end,active:true,effectiveFrom:currentKey(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    invalidateExternalCalendar();state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'schedule',message:`Class schedule saved: ${subject}, ${scheduleDayName(day)} ${start}-${end}.`});
    save();scheduleUi.day=day;scheduleUi.page=0;scheduleUi.editId=null;scheduleUi.isNew=false;renderScheduleOverview();showBreachWarning('SCHEDULE UPDATED',`${subject} now synchronizes with attendance, subject XP, and task tracking.`);
  };
  const deleteScheduleEntry=()=>{
    const entry=currentScheduleEntry();if(!entry)return;
    archiveScheduleVersion(entry,currentKey());state.classSchedule=state.classSchedule.filter(item=>item.id!==entry.id);invalidateExternalCalendar();
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
  const resetBrandAccessVisual=()=>{
    const brand=$('#systemBrand');if(!brand)return;
    brand.classList.remove('developer-arming','developer-ready','emergency-arming');
    brand.style.setProperty('--brand-access-progress','0deg');
    brand.style.setProperty('--brand-access-glow','8px');
    brand.style.setProperty('--brand-access-scale','1');
  };
  const openProfileFromBrand=()=>{
    if(!state.initialized||!$('#scheduleOverlay').hidden||!$('#emergencyOverlay').hidden||!$('#developerRunOverlay').hidden)return;
    cancelHold();resetBrandAccessVisual();brandHoldStartedAt=0;brandHoldProtocolActive=false;brandHoldDeveloperReady=false;controlUi.directDeveloper=false;controlUi.directProfile=true;controlUi.profilePage=0;controlUi.profileMonth=profileMonthKey(new Date());controlUi.profileDay=null;$('#scheduleOverlay').hidden=false;renderProfile();releaseWakeLock();haptic('tap');
  };
  const openDeveloperFromBrand=()=>{
    if(!$('#emergencyOverlay').hidden)return;
    cancelHold();resetBrandAccessVisual();brandHoldStartedAt=0;brandHoldProtocolActive=false;brandHoldDeveloperReady=false;
    state.system=state.system||{};state.system.developerTest=state.system.developerTest||{};state.system.developerTest.unlocked=true;
    save({silent:true});controlUi.directDeveloper=true;releaseWakeLock();launchDeveloperRun({mode:'live',sandboxMode:'profile',simulatedAt:Date.now(),returnDirect:true});
    showSystemNotice('diagnostic','LIVE SIMULATOR OPEN','Change simulated time and watch ASCEND react without changing live progress.',2100);
  };
  const startBrandAccessHold=()=>{
    if(!$('#scheduleOverlay').hidden||!$('#emergencyOverlay').hidden)return;
    brandHoldStartedAt=performance.now();brandHoldProtocolActive=Boolean(activeProtocolRecord());brandHoldDeveloperReady=false;
    const duration=brandHoldProtocolActive?6000:3000;
    beginHold('brand-access',duration,progress=>{
      const brand=$('#systemBrand');if(!brand)return;
      const elapsed=progress*duration;
      brand.style.setProperty('--brand-access-glow',`${8+Math.min(1,elapsed/3000)*13}px`);
      brand.style.setProperty('--brand-access-scale',String(1+Math.min(1,elapsed/3000)*.04));
      if(brandHoldProtocolActive&&elapsed>=3000){
        if(!brandHoldDeveloperReady){brandHoldDeveloperReady=true;haptic('hold-final');showSystemNotice('diagnostic','DEVELOPER ACCESS READY','Release now for Developer Mode, or keep holding for Emergency Override.',2200)}
        brand.classList.remove('developer-arming','developer-ready');brand.classList.add('emergency-arming');
        brand.style.setProperty('--brand-access-progress',`${clamp((elapsed-3000)/3000,0,1)*360}deg`);
      }else{
        brand.classList.remove('emergency-arming','developer-ready');brand.classList.add('developer-arming');
        brand.style.setProperty('--brand-access-progress',`${clamp(elapsed/3000,0,1)*360}deg`);
      }
    },()=>{
      const emergency=brandHoldProtocolActive;
      brandHoldStartedAt=0;brandHoldProtocolActive=false;brandHoldDeveloperReady=false;resetBrandAccessVisual();
      if(emergency)openEmergencyOverlay('brand-hold');else openDeveloperFromBrand();
    });
  };
  const finishBrandAccessHold=()=>{
    if(!brandHoldStartedAt)return;
    const elapsed=performance.now()-brandHoldStartedAt;
    const openProfile=elapsed<=650;
    const openDeveloper=brandHoldProtocolActive&&elapsed>=3000&&elapsed<6000;
    cancelHold('brand-access');brandHoldStartedAt=0;brandHoldProtocolActive=false;brandHoldDeveloperReady=false;resetBrandAccessVisual();
    if(openDeveloper){openDeveloperFromBrand();return}
    if(openProfile)openProfileFromBrand();
  };
  const cancelBrandAccessHold=()=>{cancelHold('brand-access');brandHoldStartedAt=0;brandHoldProtocolActive=false;brandHoldDeveloperReady=false;resetBrandAccessVisual()};
  const armClockBackup=()=>{clockArmedUntil=Date.now()+6000;resetClockAccessVisual();$('#clockPanel').classList.add('backup-armed');showBreachWarning('OVERRIDE GESTURE ARMED','Hold the clock for 3 seconds to open Emergency Override.');setTimeout(()=>{if(Date.now()>=clockArmedUntil)$('#clockPanel').classList.remove('backup-armed')},6100)};
  const startClockAccessHold=event=>{
    if(!$('#scheduleOverlay').hidden||!$('#emergencyOverlay').hidden||!$('#developerRunOverlay').hidden)return;
    if(event.button!==undefined&&event.button!==0)return;
    event.preventDefault();clockHoldStartedAt=performance.now();clockHoldMode=Date.now()<=clockArmedUntil?'emergency':'schedule';
    const clock=$('#clockPanel');clock.setPointerCapture?.(event.pointerId);
    if(clockHoldMode==='schedule')clock.classList.add('schedule-arming');
    beginHold(clockHoldMode==='emergency'?'clock-backup':'clock-schedule',3000,progress=>{
      if(clockHoldMode==='schedule')clock.style.setProperty('--schedule-access-progress',`${progress*360}deg`);
    },()=>{
      const mode=clockHoldMode;clockHoldStartedAt=0;clockHoldMode='';clockSuppressClick=true;setTimeout(()=>{clockSuppressClick=false},500);resetClockAccessVisual();
      if(mode==='emergency'){clockArmedUntil=0;clock.classList.remove('backup-armed');openEmergencyOverlay('clock-gesture')}else openControlOverlay();
    });
  };
  const finishClockAccessHold=event=>{
    if(!clockHoldStartedAt)return;
    const elapsed=performance.now()-clockHoldStartedAt;
    cancelHold(clockHoldMode==='emergency'?'clock-backup':'clock-schedule');clockHoldStartedAt=0;clockHoldMode='';resetClockAccessVisual();
    if(elapsed>=450){clockSuppressClick=true;setTimeout(()=>{clockSuppressClick=false},500)}
    try{$('#clockPanel').releasePointerCapture?.(event.pointerId)}catch(error){}
  };
  const cancelClockAccessHold=()=>{if(clockHoldMode)cancelHold(clockHoldMode==='emergency'?'clock-backup':'clock-schedule');clockHoldStartedAt=0;clockHoldMode='';resetClockAccessVisual()};

  const revealUpdatePrompt=worker=>{
    if(!worker||waitingServiceWorker===worker)return;waitingServiceWorker=worker;
    const prompt=$('#updatePrompt');if(prompt){prompt.hidden=false;void prompt.offsetWidth;prompt.classList.add('update-show')}
    showSystemNotice('update','SYSTEM UPDATE READY','Refresh when you are ready to load the newest build.',3000);
  };
  const requestPersistentStorage=async()=>{
    if(!navigator.storage?.persist||!navigator.storage?.persisted)return false;
    if(safeSession.get('ascend-persistence-attempted')){
      try{return await navigator.storage.persisted()}catch(error){return false}
    }
    safeSession.set('ascend-persistence-attempted','1');
    try{
      if(await navigator.storage.persisted())return true;
      return await navigator.storage.persist();
    }catch(error){return false}
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
    $('#activateButton').addEventListener('click',()=>{const name=$('#playerName').value.trim();if(!name){$('#playerName').focus();return}state.player.name=name;state.initialized=true;state.activatedAt=state.activatedAt||new Date().toISOString();state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'system',message:'Discipline System activated at Level 1.'});save();requestPersistentStorage();renderApp()});
    $('#earlyWakeButton').addEventListener('pointerdown',event=>{event.preventDefault();beginHold('early-wake',2000,progress=>{$('#earlyWakeFill').style.width=`${progress*100}%`},confirmEarlyWake)});
    ['pointerup','pointercancel','pointerleave'].forEach(type=>$('#earlyWakeButton').addEventListener(type,()=>cancelHold('early-wake')));
    $('#notYetButton').addEventListener('click',()=>{earlyWakeDismissedSession=true;haptic('tap');renderApp()});
    $('#freeQuestOpen').addEventListener('click',openDailyQuest);
    $('#startFlexibleProtocolButton').addEventListener('click',startAvailableFlexibleProtocol);
    $('#dailyQuestClaim').addEventListener('click',claimDailyQuest);
    $('#closeDailyQuest').addEventListener('click',closeDailyQuest);
    $('#dailyQuestOverlay').addEventListener('click',event=>{if(event.target===$('#dailyQuestOverlay'))closeDailyQuest()});

    $('#actionButton').addEventListener('click',beginAction);
    $('#skipDirectiveButton').addEventListener('click',skipCurrentDirective);
    $('#actionButton').addEventListener('pointerdown',event=>{const protocol=activeProtocolRecord(),task=currentStep(protocol);if(!task||task.type!=='hold'||$('#actionButton').disabled)return;event.preventDefault();beginHold('action',task.holdDuration||1800,progress=>{$('#holdFill').style.width=`${progress*100}%`},completeSubtask)});
    ['pointerup','pointercancel','pointerleave'].forEach(type=>$('#actionButton').addEventListener(type,()=>cancelHold('action')));
    const customTaskArea=$('#customTaskArea');
    customTaskArea.addEventListener('click',handleCustomAction);
    customTaskArea.addEventListener('focusin',event=>{if(event.target.matches('input,select,textarea'))customFormEditing=true});
    customTaskArea.addEventListener('focusout',()=>setTimeout(()=>{customFormEditing=Boolean(customTaskArea.querySelector('input:focus,select:focus,textarea:focus'))},0));
    customTaskArea.addEventListener('input',()=>captureAuditDraft());
    customTaskArea.addEventListener('change',()=>{if(captureAuditDraft())save({silent:true})});

    $('#classConfirmButton').addEventListener('pointerdown',event=>{event.preventDefault();beginHold('class-confirm',1400,progress=>{$('#classConfirmFill').style.width=`${progress*100}%`},checkInClass)});
    ['pointerup','pointercancel','pointerleave'].forEach(type=>$('#classConfirmButton').addEventListener(type,()=>{cancelHold('class-confirm');$('#classConfirmFill').style.width='0%'}));
    $('#classScreen').addEventListener('click',event=>{const button=event.target.closest('[data-class-action]');if(button)handleClassAction(button.dataset.classAction)});

    $('#scheduleClose').addEventListener('click',closeScheduleOverlay);
    $('#openPlayerProfile').addEventListener('click',()=>{controlUi.profilePage=0;controlUi.profileMonth=profileMonthKey(new Date());controlUi.profileDay=null;renderProfile()});
    $('#openSettings').addEventListener('click',()=>{settingsUi={pending:null,fileName:'',kind:''};renderSettings()});
    $('#openAcademicControl').addEventListener('click',renderAcademicHome);
    $('#openFreeSchedule').addEventListener('click',()=>{scheduleUi.day=defaultScheduleDay();scheduleUi.page=0;renderScheduleOverview()});
    $('#openFreeAttendance').addEventListener('click',()=>{controlUi.attendanceTab='overall';controlUi.subjectIndex=0;controlUi.subjectFilter='all';controlUi.unverifiedIndex=0;controlUi.unverifiedResolveId=null;controlUi.attendanceEditId=null;renderAttendance()});
    $('#openDirectiveStudio').addEventListener('click',renderDirectiveStudio);
    $('#directiveStudioBack').addEventListener('click',renderControlHome);
    $('#directiveAddProtocol').addEventListener('click',openNewDirectiveProtocol);
    $('#directiveProtocolList').addEventListener('click',event=>{const button=event.target.closest('[data-directive-protocol]');if(button)openDirectiveEditor(button.dataset.directiveProtocol)});
    $('#directiveExport').addEventListener('click',exportDirectiveConfig);
    $('#directiveImport').addEventListener('click',()=>{const input=$('#directiveImportFile');input.value='';input.click()});
    $('#directiveImportFile').addEventListener('change',event=>importDirectiveConfig(event.target.files?.[0]));
    $('#directiveRestoreAll').addEventListener('click',restoreAllDirectiveDefaults);
    $('#directiveUndo').addEventListener('click',undoDirectiveConfig);
    $('#directiveEditorBack').addEventListener('click',renderDirectiveStudio);
    $('#directiveSave').addEventListener('click',saveDirectiveProtocol);
    $('#directiveRestoreProtocol').addEventListener('click',restoreDirectiveProtocolDraft);
    $('#directiveDuplicate').addEventListener('click',duplicateDirectiveProtocol);
    $('#directiveDeleteProtocol').addEventListener('click',deleteDirectiveProtocol);
    $('#directiveSkipToday').addEventListener('click',skipDirectiveProtocolToday);
    $('#directivePreview').addEventListener('click',()=>{captureDirectiveGeneralFields();directiveUi.preview=!directiveUi.preview;renderDirectiveEditor()});
    ['directiveName','directiveShort','directivePrep','directiveXpValue'].forEach(id=>$('#'+id).addEventListener('input',()=>{directiveUi.dirty=true;$('#directiveUnsaved').hidden=false}));
    ['directiveStart','directiveEnd','directiveSchedulingMode','directivePriority','directiveProtocolEnabled','directiveProtocolRequired','directiveAllowSkipToday'].forEach(id=>$('#'+id).addEventListener('change',()=>{captureDirectiveGeneralFields();renderDirectiveEditor()}));
    $('#directiveXpMode').addEventListener('change',()=>{captureDirectiveGeneralFields();$('#directiveXpValueWrap').hidden=$('#directiveXpMode').value!=='custom';renderDirectiveEditor()});
    $('#directiveDayButtons').addEventListener('click',event=>{const button=event.target.closest('[data-directive-day]');if(!button||!directiveUi.draft)return;captureDirectiveGeneralFields();const day=Number(button.dataset.directiveDay),days=new Set(directiveUi.draft.activeDays);if(days.has(day))days.delete(day);else days.add(day);directiveUi.draft.activeDays=[...days].sort((a,b)=>a-b);directiveUi.dirty=true;renderDirectiveEditor()});
    $('#directiveAddStep').addEventListener('click',()=>{captureDirectiveGeneralFields();openDirectiveStepEditor()});
    $('#directiveStepList').addEventListener('click',event=>{const row=event.target.closest('[data-directive-step]'),button=event.target.closest('[data-step-action]');if(!row||!button||button.disabled||!directiveUi.draft)return;captureDirectiveGeneralFields();const id=row.dataset.directiveStep,action=button.dataset.stepAction,index=directiveUi.draft.subtasks.findIndex(step=>step.id===id),step=directiveUi.draft.subtasks[index];if(!step)return;if(action==='edit'){openDirectiveStepEditor(id);return}if(action==='delete'){deleteDirectiveStep(id);return}if(action==='toggle'){step.enabled=step.enabled===false;directiveUi.dirty=true;renderDirectiveEditor();return}if(action==='up'&&index>0&&!directiveLinkedLabel(directiveUi.draft.subtasks[index-1],directiveUi.draft.id)){[directiveUi.draft.subtasks[index-1],directiveUi.draft.subtasks[index]]=[directiveUi.draft.subtasks[index],directiveUi.draft.subtasks[index-1]];directiveUi.dirty=true;renderDirectiveEditor();return}if(action==='down'&&index<directiveUi.draft.subtasks.length-1&&!directiveLinkedLabel(directiveUi.draft.subtasks[index+1],directiveUi.draft.id)){[directiveUi.draft.subtasks[index+1],directiveUi.draft.subtasks[index]]=[directiveUi.draft.subtasks[index],directiveUi.draft.subtasks[index+1]];directiveUi.dirty=true;renderDirectiveEditor()}});
    $('#directiveStepBack').addEventListener('click',renderDirectiveEditor);
    $('#directiveStepSave').addEventListener('click',saveDirectiveStep);
    $('#directiveStepDelete').addEventListener('click',()=>{const id=directiveUi.stepId;if(id)deleteDirectiveStep(id)});
    $('#directiveStepType').addEventListener('change',event=>{const timer=event.target.value==='timer';$('#directiveStepDurationWrap').hidden=!timer;if(timer)$('#directiveStepAllowSkip').checked=true});
    $('#openAcademicTasks').addEventListener('click',()=>{controlUi.taskTab='tasks';renderAcademicTasks()});
    $('#openAdvancedSystem').addEventListener('click',renderAdvancedSystemHome);
    $('#openDataBackup').addEventListener('click',()=>{backupUi={pending:null,fileName:''};renderDataBackup()});
    $('#openSystemReliability').addEventListener('click',renderReliability);
    $('#academicBack').addEventListener('click',renderControlHome);
    $('#profileBack').addEventListener('click',closeScheduleOverlay);
    $('#settingsBack').addEventListener('click',()=>{settingsUi={pending:null,fileName:'',kind:''};controlUi.profilePage=0;controlUi.profileDay=null;renderProfile()});
    $('#settingsSaveProgress').addEventListener('click',()=>exportSettingsData('progress'));
    $('#settingsSaveSchedule').addEventListener('click',()=>exportSettingsData('schedule'));
    $('#settingsSaveFull').addEventListener('click',()=>exportSettingsData('full'));
    $('#settingsLoadProgress').addEventListener('click',()=>{const input=$('#settingsProgressFile');input.value='';input.click()});
    $('#settingsLoadSchedule').addEventListener('click',()=>{const input=$('#settingsScheduleFile');input.value='';input.click()});
    $('#settingsLoadFull').addEventListener('click',()=>{const input=$('#settingsFullFile');input.value='';input.click()});
    $('#settingsProgressFile').addEventListener('change',event=>previewSettingsFile(event.target.files?.[0],'progress'));
    $('#settingsScheduleFile').addEventListener('change',event=>previewSettingsFile(event.target.files?.[0],'schedule'));
    $('#settingsFullFile').addEventListener('change',event=>previewSettingsFile(event.target.files?.[0],'full'));
    $('#settingsConfirmImport').addEventListener('click',confirmSettingsImport);
    $('#settingsCancelImport').addEventListener('click',clearSettingsImport);
    $('#settingsNotificationLead').addEventListener('change',event=>updateSettingsNotification(event.target.value));
    $('#settingsTimeFormat').addEventListener('change',event=>updateSettingsTimeFormat(event.target.value));
    $('#attendanceBack').addEventListener('click',renderControlHome);
    $('#academicTasksBack').addEventListener('click',renderAcademicHome);
    $('#advancedSystemBack').addEventListener('click',renderAcademicHome);
    $('#dataBackupBack').addEventListener('click',()=>{backupUi={pending:null,fileName:''};renderRecoverySystem()});
    $('#systemReliabilityBack').addEventListener('click',renderAdvancedSystemHome);
    $('#taskManagerTabs').addEventListener('click',event=>{const button=event.target.closest('[data-task-tab]');if(!button)return;controlUi.taskTab=button.dataset.taskTab;renderTaskManager()});
    $('#taskManagerContent').addEventListener('click',handleTaskManagerAction);
    $('#advancedSystemHomeView').addEventListener('click',event=>{const button=event.target.closest('[data-advanced-view]');if(!button||button.classList.contains('developer-entry'))return;const view=button.dataset.advancedView;if(view==='updatesRollbackView')renderUpdatesRollback();else if(view==='systemReliabilityView')renderReliability();else if(view==='diagnosticsView')renderDiagnostics();else if(view==='externalRemindersView')renderExternalReminders();else if(view==='recoverySystemView')renderRecoverySystem()});
    const developerEntry=$('#advancedSystemHomeView .developer-entry');
    developerEntry.addEventListener('click',()=>{state.system.developerTest.unlocked=true;save({silent:true});controlUi.directDeveloper=false;renderDeveloperTest()});
    $('#updatesRollbackBack').addEventListener('click',renderAdvancedSystemHome);
    $('#rollbackPrev').addEventListener('click',()=>{controlUi.rollbackIndex=Math.max(0,controlUi.rollbackIndex-1);renderUpdatesRollback()});
    $('#rollbackNext').addEventListener('click',()=>{controlUi.rollbackIndex=Math.min(Math.max(0,S.listRollbackPoints().length-1),controlUi.rollbackIndex+1);renderUpdatesRollback()});
    $('#restoreRollback').addEventListener('click',restoreSelectedRollback);
    $('#diagnosticsBack').addEventListener('click',renderAdvancedSystemHome);
    $('#rerunDiagnostics').addEventListener('click',renderDiagnostics);
    $('#runConsistencyWatchdog').addEventListener('click',()=>{runDataConsistencyWatchdog(true);renderDiagnostics()});
    $('#externalRemindersBack').addEventListener('click',renderAdvancedSystemHome);
    $('#externalToggleAlerts').addEventListener('click',async()=>{await toggleNotifications();renderExternalReminders()});
    $('#externalReminderLead').addEventListener('change',event=>{state.settings.notificationLeadMinutes=clamp(Number(event.target.value||10),5,30);invalidateExternalCalendar();save({silent:true});renderExternalReminders()});
    $('#exportReminderCalendar').addEventListener('click',()=>exportReminderCalendar(false));
    $('#testExternalReminder').addEventListener('click',()=>exportReminderCalendar(true));
    $('#confirmExternalCalendar').addEventListener('click',confirmExternalCalendar);
    $('#developerTestBack').addEventListener('click',()=>{if(controlUi.directDeveloper)closeScheduleOverlay();else renderAdvancedSystemHome()});
    $('#launchDeveloperLive').addEventListener('click',runDeveloperTest);
    $('#launchDeveloperFeedback').addEventListener('click',()=>launchDeveloperRun({mode:'lab'}));
    $('#resetDeveloperTest').addEventListener('click',resetDeveloperTest);
    $('#exitDeveloperRun').addEventListener('click',()=>exitDeveloperRun(false));
    $('#developerRunAgain').addEventListener('click',()=>exitDeveloperRun(true));
    $('#developerRunExitResult').addEventListener('click',()=>exitDeveloperRun(false));
    $('#developerRunAction').addEventListener('pointerdown',startDeveloperRunAction);
    ['pointerup','pointercancel','pointerleave'].forEach(type=>$('#developerRunAction').addEventListener(type,()=>{cancelHold('developer-run');$('#developerRunFill').style.width='0%'}));
    $('#developerApplyTime').addEventListener('click',applyDeveloperDateTime);
    $('#developerSimulatedDateTime').addEventListener('keydown',event=>{if(event.key==='Enter')applyDeveloperDateTime()});
    $('#developerBackFifteen').addEventListener('click',()=>advanceDeveloperTime(-15,'Moved back 15 minutes'));
    $('#developerForwardFifteen').addEventListener('click',()=>advanceDeveloperTime(15,'Moved forward 15 minutes'));
    $('#developerNextEvent').addEventListener('click',nextDeveloperEvent);
    $('#developerTimeSpeed').addEventListener('change',event=>setDeveloperSpeed(event.target.value));
    $('#previewDeveloperHaptic').addEventListener('click',previewDeveloperHaptic);
    $('#sendDeveloperNotification').addEventListener('click',sendDeveloperTestNotification);
    $('#recoverySystemBack').addEventListener('click',renderAdvancedSystemHome);
    $('#toggleSafeMode').addEventListener('click',toggleSafeMode);
    $('#openEmergencyRecovery').addEventListener('click',openEmergencyRecovery);
    $('#reviewTimezone').addEventListener('click',showTimezoneOverlay);
    $('#confirmTimezoneTravel').addEventListener('click',confirmTimezoneChange);
    $('#keepPreviousTimezone').addEventListener('click',rejectTimezoneChange);
    $('#closeTimezoneOverlay').addEventListener('click',()=>{$('#timezoneOverlay').hidden=true});
    $('#timezoneOverlay').addEventListener('click',event=>{if(event.target===$('#timezoneOverlay'))$('#timezoneOverlay').hidden=true});
    $('#emergencyRecoveryOverlay').addEventListener('click',event=>{if(event.target===$('#emergencyRecoveryOverlay'))closeEmergencyRecovery()});
    $('#emergencyExportBackup').addEventListener('click',exportDataBackup);
    $('#emergencyRestoreSnapshot').addEventListener('click',()=>{closeEmergencyRecovery();restoreLatestSnapshot()});
    $('#emergencyContinue').addEventListener('click',()=>{state.system.safeMode=true;save({silent:true});applySafeMode();closeEmergencyRecovery();completeBootGuard()});
    $('#toggleNotifications').addEventListener('click',toggleNotifications);
    $('#toggleWakeLock').addEventListener('click',()=>{state.settings.keepAwake=!state.settings.keepAwake;if(!state.settings.keepAwake)releaseWakeLock();else if(activeProtocolRecord())requestWakeLock();save();renderReliability()});
    $('#createRecoverySnapshot').addEventListener('click',()=>{S.createDailySnapshot(state,true);state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'snapshot',message:'Manual recovery snapshot created.'});save({silent:true});showSystemNotice('snapshot','SNAPSHOT CREATED','A known-good recovery point was stored locally.',2600);renderReliability()});
    $('#restoreLatestSnapshot').addEventListener('click',restoreLatestSnapshot);
    $('#exportBackup').addEventListener('click',exportDataBackup);
    $('#chooseBackup').addEventListener('click',()=>$('#backupFileInput').click());
    $('#backupFileInput').addEventListener('change',event=>previewBackupFile(event.target.files?.[0]));
    $('#cancelBackupRestore').addEventListener('click',clearBackupPreview);
    $('#confirmBackupRestore').addEventListener('click',confirmBackupRestore);
    $('#scheduleConfigEdit').addEventListener('click',()=>{scheduleUi.day=defaultScheduleDay();scheduleUi.page=0;renderScheduleOverview()});
    $('#openAttendance').addEventListener('click',()=>{controlUi.attendanceTab='overall';controlUi.correction=false;controlUi.unverifiedIndex=0;controlUi.unverifiedResolveId=null;controlUi.attendanceEditId=null;renderAttendance()});
    $('#openScheduleExceptions').addEventListener('click',()=>{exceptionUi.index=0;renderScheduleExceptions()});
    $('#openConflictScan').addEventListener('click',()=>renderConflictScan(true));
    $('#conflictScanBack').addEventListener('click',renderAcademicHome);
    $('#rerunConflictScan').addEventListener('click',()=>renderConflictScan(true));
    $('#conflictPrev').addEventListener('click',()=>{conflictUi.index=Math.max(0,conflictUi.index-1);renderConflictRecord()});
    $('#conflictNext').addEventListener('click',()=>{conflictUi.index=Math.min(Math.max(0,conflictUi.issues.length-1),conflictUi.index+1);renderConflictRecord()});
    $('#scheduleExceptionsBack').addEventListener('click',renderControlHome);
    $('#exceptionType').addEventListener('change',syncExceptionFields);
    $('#saveScheduleException').addEventListener('click',saveScheduleException);
    $('#exceptionPrev').addEventListener('click',()=>{exceptionUi.index=Math.max(0,exceptionUi.index-1);renderScheduleExceptions()});
    $('#exceptionNext').addEventListener('click',()=>{exceptionUi.index=Math.min(Math.max(0,sortedExceptions().length-1),exceptionUi.index+1);renderScheduleExceptions()});
    $('#deleteScheduleException').addEventListener('click',deleteScheduleException);

    $('#profileContent').addEventListener('pointerdown',event=>{
      const target=event.target.closest('[data-settings-hold]');if(!target||event.button!==undefined&&event.button!==0)return;
      event.preventDefault();target.setPointerCapture?.(event.pointerId);target.classList.add('settings-arming');
      beginHold('profile-settings',2000,progress=>target.style.setProperty('--settings-hold-progress',String(progress)),()=>{target.classList.remove('settings-arming');target.style.setProperty('--settings-hold-progress','0');$('#openSettings').click()});
    });
    $('#profileContent').addEventListener('pointerup',event=>{const target=event.target.closest('[data-settings-hold]');if(!target)return;try{target.releasePointerCapture?.(event.pointerId)}catch(error){}cancelHold('profile-settings');target.classList.remove('settings-arming');target.style.setProperty('--settings-hold-progress','0')});
    $('#profileContent').addEventListener('pointercancel',event=>{const target=event.target.closest('[data-settings-hold]');if(!target)return;cancelHold('profile-settings');target.classList.remove('settings-arming');target.style.setProperty('--settings-hold-progress','0')});
    $('#profileContent').addEventListener('contextmenu',event=>{if(event.target.closest('[data-settings-hold]'))event.preventDefault()});
    $('#profileContent').addEventListener('click',event=>{
      const button=event.target.closest('[data-profile-action]');if(!button)return;const action=button.dataset.profileAction;
      if(action==='profile-home'){controlUi.profilePage=0;controlUi.profileDay=null;renderProfile();return}
      if(action==='edit-identity'){controlUi.profilePage=1;renderProfile();return}
      if(action==='calendar-prev'){controlUi.profileMonth=shiftProfileMonth(controlUi.profileMonth||profileMonthKey(new Date()),-1);controlUi.profileDay=null;renderProfile();return}
      if(action==='calendar-next'){const currentMonth=profileMonthKey(new Date()),next=shiftProfileMonth(controlUi.profileMonth||currentMonth,1);controlUi.profileMonth=next>currentMonth?currentMonth:next;controlUi.profileDay=null;renderProfile();return}
      if(action==='calendar-day'){const dateKey=button.dataset.date;if(!dateKey||dateKey>currentKey())return;controlUi.profileDay=dateKey;renderProfile();return}
      if(action==='calendar-back'){controlUi.profileDay=null;renderProfile();return}
      if(action==='save-identity'){
        const name=$('#profileNameEdit')?.value.trim(),codename=$('#profileCodenameEdit')?.value.trim()||'',emblem=normalizeGlyph($('#profileEmblemEdit')?.value||'apex'),title=$('#profileTitleEdit')?.value.trim()||'ASCEND Player';
        if(!name){showBreachWarning('NAME REQUIRED','Player name cannot be empty.');return}
        state.player.name=name;state.player.codename=codename;state.player.emblem=emblem;state.player.title=title;state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'profile',message:'Player identity updated.'});save();systemFeedback('clear','Profile saved.');controlUi.profilePage=0;renderProfile();return;
      }
    });

    $('#attendancePrev').addEventListener('click',()=>{if(controlUi.attendanceTab==='subjects'){controlUi.subjectIndex=Math.max(0,controlUi.subjectIndex-1);controlUi.attendanceEditId=null}renderAttendance()});
    $('#attendanceNext').addEventListener('click',()=>{if(controlUi.attendanceTab==='subjects'){controlUi.subjectIndex=Math.min(Math.max(0,subjectCatalog().length-1),controlUi.subjectIndex+1);controlUi.attendanceEditId=null}renderAttendance()});
    $('#attendanceContent').addEventListener('click',event=>{
      const action=event.target.closest('[data-attendance-action]');if(!action)return;const type=action.dataset.attendanceAction;
      if(type==='show-overall'){controlUi.attendanceTab='overall';controlUi.attendanceEditId=null;renderAttendance();return}
      if(type==='show-subjects'){controlUi.attendanceTab='subjects';controlUi.subjectIndex=clamp(controlUi.subjectIndex,0,Math.max(0,subjectCatalog().length-1));controlUi.attendanceEditId=null;renderAttendance();return}
      if(type==='edit-record'){const record=state.attendanceRecords.find(item=>item.id===action.dataset.recordId);if(record){controlUi.attendanceEditId=record.id;controlUi.unverifiedResolveId=record.status==='unverified'?record.id:null;renderAttendance()}return}
      if(type==='cancel-resolution'){controlUi.attendanceEditId=null;controlUi.unverifiedResolveId=null;renderAttendance();return}
      if(type==='save-resolution'){saveAttendanceResolution();return}
      if(type==='unverified-prev'){controlUi.unverifiedIndex=Math.max(0,controlUi.unverifiedIndex-1);renderAttendance();return}
      if(type==='unverified-next'){controlUi.unverifiedIndex=Math.min(Math.max(0,resolvableUnverifiedRecords().length-1),controlUi.unverifiedIndex+1);renderAttendance();return}
      if(type==='subject-filter'){controlUi.subjectFilter=action.dataset.filter||'all';renderAttendance();return}
    });
    $('#attendanceContent').addEventListener('change',event=>{if(event.target?.id!=='attendanceResolutionStatus')return;const fields=$('#attendancePartialFields');if(fields)fields.hidden=event.target.value!=='partial'});

    $('#scheduleOverviewBack').addEventListener('click',renderControlHome);$('#scheduleBack').addEventListener('click',renderScheduleOverview);$('#scheduleSave').addEventListener('click',saveScheduleEntry);
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
    $('#systemBrand').addEventListener('pointerdown',event=>{if(event.button!==undefined&&event.button!==0)return;event.preventDefault();$('#systemBrand').setPointerCapture?.(event.pointerId);startBrandAccessHold()});
    $('#systemBrand').addEventListener('pointerup',event=>{event.preventDefault();try{$('#systemBrand').releasePointerCapture?.(event.pointerId)}catch(error){}finishBrandAccessHold()});
    ['pointercancel','lostpointercapture'].forEach(type=>$('#systemBrand').addEventListener(type,cancelBrandAccessHold));
    $('#clockPanel').addEventListener('click',()=>{if(clockSuppressClick){clockSuppressClick=false;return}clockTapCount+=1;clearTimeout(clockTapTimer);if(clockTapCount>=5){clockTapCount=0;armClockBackup();return}clockTapTimer=setTimeout(()=>{clockTapCount=0},1300)});
    $('#clockPanel').addEventListener('pointerdown',startClockAccessHold);
    $('#clockPanel').addEventListener('pointerup',finishClockAccessHold);
    ['pointercancel','lostpointercapture'].forEach(type=>$('#clockPanel').addEventListener(type,cancelClockAccessHold));
    $('#returnDirectiveButton').addEventListener('click',closeEmergencyOverlay);
    $('#confirmEmergencyButton').addEventListener('pointerdown',event=>{event.preventDefault();beginHold('emergency-exit',3000,progress=>{$('#emergencyExitFill').style.width=`${progress*100}%`},emergencyExit)});
    ['pointerup','pointercancel','pointerleave'].forEach(type=>$('#confirmEmergencyButton').addEventListener(type,()=>cancelHold('emergency-exit')));

    document.querySelectorAll('[data-mastery]').forEach(button=>button.addEventListener('click',()=>{const choice=button.dataset.mastery;state.player.masteryChoice=choice==='graduate'?'Graduated from the System':choice==='maintenance'?'Maintenance Mode':'New Mastery Path';state.logs.push({id:S.uid('log'),at:new Date().toISOString(),type:'mastery',message:state.player.masteryChoice});save();renderApp()}));
    document.addEventListener('keydown',event=>{
      if(event.key!=='Escape'||event.repeat)return;
      if(!$('#developerRunOverlay').hidden){exitDeveloperRun(false);return;}
      if(!$('#emergencyRecoveryOverlay').hidden){closeEmergencyRecovery();return}
      if(!$('#dailyQuestOverlay').hidden){closeDailyQuest();return}
      if(!$('#timezoneOverlay').hidden){$('#timezoneOverlay').hidden=true;return}
      if(!$('#emergencyOverlay').hidden){closeEmergencyOverlay();return}
      if(!$('#scheduleOverlay').hidden){closeScheduleOverlay();return}
      if(escapeTimer||!activeProtocolRecord())return;escapeTimer=setTimeout(()=>{escapeTimer=null;openEmergencyOverlay('escape-hold')},5000);
    });
    document.addEventListener('keyup',event=>{if(event.key==='Escape'&&escapeTimer){clearTimeout(escapeTimer);escapeTimer=null}});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseWakeLock();else{earlyWakeDismissedSession=false;renderApp()}});
    window.addEventListener('pageshow',renderApp);window.addEventListener('focus',renderApp);
  };

  const tick=()=>{
    updateClock();
    const currentDate=S.dateKey();if(currentDate!==advancedSyncDate){advancedSyncDate=currentDate;synchronizeAdvancedSystems();if(state.timezone?.pending&&!timezonePromptShown)setTimeout(showTimezoneOverlay,120)}
    if(orientationBlocked||holdSession||transitionLocked||customFormEditing||!$('#scheduleOverlay').hidden||!$('#developerRunOverlay').hidden||state.system.safeMode)return;renderApp();
  };
  const emergencyBoot=beginBootGuard();
  synchronizeAdvancedSystems();advancedSyncDate=S.dateKey();applySafeMode();
  wireEvents();updateOrientationGuard();renderApp();dismissLaunchSplash();setupServiceWorker();if(state.initialized)requestPersistentStorage();
  bootCompletionTimer=setTimeout(completeBootGuard,2600);
  if(emergencyBoot||state.system?.recoveredFrom==='startup-guard')setTimeout(openEmergencyRecovery,700);
  if(state.timezone?.pending)setTimeout(showTimezoneOverlay,900);
  if(state.system?.recoveredFrom){const source=state.system.recoveredFrom;state.system.recoveredFrom=null;save({silent:true});setTimeout(()=>showSystemNotice('restore','DATA RECOVERED',`Known-good state restored from ${source}.`,3800),950)}
  if(!navigator.onLine)setTimeout(()=>showSystemNotice('offline','OFFLINE MODE','ASCEND is operating from device storage.',2600),900);
  setInterval(tick,1000);
})();
