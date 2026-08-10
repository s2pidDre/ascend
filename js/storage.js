(function(){
  'use strict';
  const A=window.ASCEND=window.ASCEND||{};
  const KEY='ascend_discipline_protocol_v7';
  const RECOVERY_KEY='ascend_discipline_protocol_recovery_v1';
  const SNAPSHOT_KEY='ascend_discipline_protocol_snapshots_v1';
  const ROLLBACK_KEY='ascend_discipline_protocol_rollbacks_v1';
  const LEGACY_KEYS=['ascend_discipline_protocol_v6','ascend_discipline_protocol_v5','ascend_discipline_protocol_v4','ascend_strict_system_v3','ascend_automatic_year_system_v2','ascend_personal_growth_system_v1'];
  const VERSION=22;
  const BACKUP_VERSION=5;
  const ROUTINE_LOG_LIMIT=420;
  const SNAPSHOT_LIMIT=7;
  const ROLLBACK_LIMIT=4;
  const PERMANENT_LOG_TYPES=new Set(['system','level','rank','mastery','achievement','backup','restore','emergency','attendance-correction','recovery','snapshot','boss','migration','quest','skill','weekly','test','watchdog','reminder']);
  const nowIso=()=>new Date().toISOString();
  const dateKey=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const timezoneName=()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'Local Time'}catch(error){return'Local Time'}};
  const timezoneOffset=()=>-new Date().getTimezoneOffset();
  const uid=(prefix='id')=>window.crypto?.randomUUID?`${prefix}_${crypto.randomUUID()}`:`${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const memory=(()=>{const map=new Map();return{getItem:key=>map.has(key)?map.get(key):null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key)}})();
  const store=(()=>{try{localStorage.setItem('__ascend_test__','1');localStorage.removeItem('__ascend_test__');return localStorage}catch(error){console.warn('Persistent storage unavailable. Using temporary memory.',error);return memory}})();
  const clone=value=>JSON.parse(JSON.stringify(value));

  const rankOrder=['E','D','C','B','A','S'];
  const pendingRankFor=(level,current='E')=>{
    const thresholds=[['D',6],['C',13],['B',21],['A',31],['S',41]];
    const index=rankOrder.indexOf(current||'E');
    return [...thresholds].reverse().find(([rank,min])=>level>=min&&rankOrder.indexOf(rank)>index)?.[0]||null;
  };

  const initialState=()=>({
    version:VERSION,
    initialized:false,
    createdAt:nowIso(),
    updatedAt:nowIso(),
    player:{
      name:'Player',codename:'',emblem:'apex',title:'Discipline Initiate',level:1,maxLevel:50,streak:0,bestStreak:0,totalClearDays:0,totalFailedDays:0,
      levelClearDays:0,mastered:false,masteredAt:null,totalXp:0,masteryChoice:null,
      rank:'E',pendingRank:null,perfectClears:0,lastPerfectDate:null,failureScar:false,rankTrialAttempts:0,
      achievementUnlocks:{},achievementSeen:[]
    },
    dayRecords:{},
    classSchedule:[],
    scheduleExceptions:[],
    attendanceRecords:[],
    academicTasks:[],
    recurringTaskRules:[],
    tradingNotes:[],
    quests:{daily:null,history:[]},
    skills:{points:0,unlocked:[],equipped:[]},
    weeklyDebriefs:[],
    settings:{sound:true,haptics:true,keepAwake:true,notifications:false,notificationLeadMinutes:10,timeFormat:'12',externalCalendarConfirmed:false,externalCalendarExportedAt:null,externalCalendarHorizonDays:60},
    timezone:{name:timezoneName(),offset:timezoneOffset(),confirmedAt:nowIso(),pending:null,ignoredDevice:null,history:[]},
    recovery:{active:false,status:'idle',sourceDate:null,reason:null,action:null,protectedDate:null,protectedProtocolId:null,completedAt:null},
    system:{recoveredFrom:null,lastStorageWarningAt:null,notificationLedger:{},safeMode:false,lastSuccessfulBoot:null,migrationHistory:[],auditTrail:[],watchdog:{lastRun:null,issues:0,repairs:0,summary:'Not run'},reminderBridge:{lastCheckAt:null,missedCount:0,lastMissedAt:null,lastExportAt:null,lastExportEvents:0},profileXpReconciliation:{version:0,completedAt:null,date:null,repairedMarkers:0,recoveredDirectiveXp:0,recoveredAttendanceXp:0,status:'pending'},developerTest:{enabled:false,unlocked:false,scenario:'free',simulatedDate:null,runs:0,lastResult:null,sandboxMode:'profile',reports:[],labHistory:[]}},
    logs:[]
  });

  const normalizeAttendance=record=>({
    id:record.id||uid('attendance'),meetingKey:record.meetingKey||'',classId:record.classId||null,
    subjectKey:String(record.subjectKey||record.subjectName||'').trim().toLowerCase(),subjectName:record.subjectName||'Unknown Subject',code:record.code||'',
    scheduledDate:record.scheduledDate||dateKey(new Date(record.createdAt||Date.now())),scheduledStart:record.scheduledStart||'00:00',scheduledEnd:record.scheduledEnd||'00:00',
    room:record.room||'',modality:record.modality||'Onsite',status:record.status||'unverified',checkInAt:record.checkInAt||null,dismissedAt:record.dismissedAt||null,
    dismissalStatus:record.dismissalStatus||null,minutesLate:Number(record.minutesLate||0),pendingXp:Number(record.pendingXp||0),xpAwarded:Number(record.xpAwarded||0),
    profileXpAppliedAmount:Math.max(0,Number(record.profileXpAppliedAmount||0)),profileXpAppliedAt:record.profileXpAppliedAt||null,
    finalized:Boolean(record.finalized),ongoingUntil:record.ongoingUntil||null,createdAt:record.createdAt||nowIso(),updatedAt:record.updatedAt||record.createdAt||nowIso(),
    timezone:record.timezone||null,corrections:Array.isArray(record.corrections)?record.corrections:[]
  });

  const normalizeTask=task=>({
    id:task.id||uid('task'),subjectKey:String(task.subjectKey||task.subjectName||'general').trim().toLowerCase(),subjectName:task.subjectName||'General',
    title:String(task.title||'Untitled Task').slice(0,80),deadline:task.deadline||'',difficulty:['Low','Medium','High'].includes(task.difficulty)?task.difficulty:'Medium',note:String(task.note||'').slice(0,240),
    status:task.status==='completed'?'completed':'pending',createdAt:task.createdAt||nowIso(),completedAt:task.completedAt||null,workMinutes:Math.max(0,Number(task.workMinutes||0)),
    workloadMinutes:[15,30,60,120,180].includes(Number(task.workloadMinutes))?Number(task.workloadMinutes):30,postponements:Math.max(0,Number(task.postponements||0)),lastPostponedAt:task.lastPostponedAt||null,
    dependencyIds:Array.isArray(task.dependencyIds)?[...new Set(task.dependencyIds.map(String))]:[],sourceRuleId:task.sourceRuleId||null,occurrenceDate:task.occurrenceDate||null
  });

  const normalizeRule=rule=>({
    id:rule.id||uid('rule'),active:rule.active!==false,subjectKey:String(rule.subjectKey||rule.subjectName||'general').trim().toLowerCase(),subjectName:rule.subjectName||'General',
    title:String(rule.title||'Recurring Task').slice(0,80),difficulty:['Low','Medium','High'].includes(rule.difficulty)?rule.difficulty:'Medium',note:String(rule.note||'').slice(0,240),
    cadence:['daily','weekly','weekdays','monthly'].includes(rule.cadence)?rule.cadence:'weekly',weekdays:Array.isArray(rule.weekdays)?[...new Set(rule.weekdays.map(Number).filter(value=>value>=0&&value<=6))]:[],
    dayOfMonth:Math.min(28,Math.max(1,Number(rule.dayOfMonth||1))),deadlineTime:rule.deadlineTime||'20:00',startDate:rule.startDate||dateKey(),lastGeneratedDate:rule.lastGeneratedDate||null,
    dependencyTemplateIds:Array.isArray(rule.dependencyTemplateIds)?[...new Set(rule.dependencyTemplateIds.map(String))]:[],createdAt:rule.createdAt||nowIso()
  });

  const pruneLogs=logs=>{
    const source=Array.isArray(logs)?logs.filter(log=>log&&typeof log==='object'):[];
    const permanent=source.filter(log=>PERMANENT_LOG_TYPES.has(log.type));
    const routine=source.filter(log=>!PERMANENT_LOG_TYPES.has(log.type)).slice(-ROUTINE_LOG_LIMIT);
    const seen=new Set();
    return [...permanent,...routine].sort((a,b)=>String(a.at||'').localeCompare(String(b.at||''))).filter(log=>{
      const key=log.id||`${log.at}|${log.type}|${log.message}`;if(seen.has(key))return false;seen.add(key);return true;
    });
  };

  const normalizeProtocolState=day=>{
    if(!day||typeof day!=='object')return day;
    const protocols=day.protocols&&typeof day.protocols==='object'?day.protocols:{};
    const legacyDayStatus=day.status,legacyRewardApplied=Boolean(day.rewardApplied);
    let activeKept=false;
    Object.values(protocols).sort((a,b)=>String(a.startedAt||'').localeCompare(String(b.startedAt||''))).forEach(protocol=>{
      if(!protocol||typeof protocol!=='object')return;
      if(!['pending','active','cleared','failed'].includes(protocol.status))protocol.status='pending';
      protocol.steps=Array.isArray(protocol.steps)?protocol.steps:[];
      protocol.steps.forEach(step=>{
        if(!['pending','active','completed'].includes(step.status))step.status='pending';
        if(step.status==='completed'&&!step.completedAt)step.completedAt=step.startedAt||day.finalizedAt||nowIso();
        if(step.status==='active'&&!step.startedAt)step.startedAt=nowIso();
      });
      if(protocol.status==='active'){if(activeKept)protocol.status='pending';else activeKept=true}
      if(protocol.status==='cleared'){
        protocol.steps.forEach(step=>{step.status='completed';step.startedAt=step.startedAt||protocol.startedAt||protocol.completedAt;step.completedAt=step.completedAt||protocol.completedAt||nowIso()});
        protocol.earnedXp=Math.max(0,Number(protocol.earnedXp||0));
        if(!Object.prototype.hasOwnProperty.call(protocol,'profileXpAppliedAmount')){
          const legacySettled=legacyDayStatus==='failed'||(legacyDayStatus==='cleared'&&legacyRewardApplied);
          protocol.profileXpAppliedAmount=legacySettled?protocol.earnedXp:0;
        }else protocol.profileXpAppliedAmount=Math.max(0,Number(protocol.profileXpAppliedAmount||0));
        protocol.profileXpAppliedAt=protocol.profileXpAppliedAt||null;
      }
      if(protocol.status==='failed')protocol.earnedXp=0;
      delete protocol.profileXpHeld;
      protocol.focusBreaches=Math.max(0,Number(protocol.focusBreaches||0));
      protocol.hiddenMilliseconds=Math.max(0,Number(protocol.hiddenMilliseconds||0));
    });
    day.completedProtocols=Object.values(protocols).filter(protocol=>protocol?.status==='cleared').length;
    day.failedProtocols=Object.values(protocols).filter(protocol=>protocol?.status==='failed').length;
    if(!['active','cleared','failed'].includes(day.status))day.status='active';
    day.rewardApplied=Boolean(day.rewardApplied);delete day.heldXp;delete day.integrityStatus;day.timezone=day.timezone||null;
    return day;
  };

  const normalizeException=exception=>({
    id:exception.id||uid('exception'),date:exception.date||dateKey(),type:['no-classes','cancel','reschedule','special'].includes(exception.type)?exception.type:'cancel',
    classId:exception.classId||null,start:exception.start||'',end:exception.end||'',note:String(exception.note||'').slice(0,100),createdAt:exception.createdAt||nowIso(),active:exception.active!==false
  });

  const normalizeCurrent=raw=>{
    const base=initialState();
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('ASCEND state is not a valid object.');
    const rawSettings=raw.settings&&typeof raw.settings==='object'?raw.settings:{};
    const state={
      ...base,...raw,
      player:{...base.player,...(raw.player||{})},
      timezone:{...base.timezone,...(raw.timezone||{})},
      recovery:{...base.recovery,...(raw.recovery||{})},
      quests:{...base.quests,...(raw.quests||{})},
      skills:{...base.skills,...(raw.skills||{})},
      system:{...base.system,...(raw.system||{}),reminderBridge:{...base.system.reminderBridge,...(raw.system?.reminderBridge||{})},profileXpReconciliation:{...base.system.profileXpReconciliation,...(raw.system?.profileXpReconciliation||{})},developerTest:{...base.system.developerTest,...(raw.system?.developerTest||{})}},
      settings:{...base.settings,...rawSettings}
    };
    delete state.integrity;
    state.version=VERSION;
    state.settings.sound=typeof rawSettings.sound==='boolean'?rawSettings.sound:base.settings.sound;
    state.settings.haptics=typeof rawSettings.haptics==='boolean'?rawSettings.haptics:base.settings.haptics;
    state.settings.keepAwake=typeof rawSettings.keepAwake==='boolean'?rawSettings.keepAwake:base.settings.keepAwake;
    state.settings.notifications=typeof rawSettings.notifications==='boolean'?rawSettings.notifications:base.settings.notifications;
    state.settings.notificationLeadMinutes=Math.min(30,Math.max(5,Number(rawSettings.notificationLeadMinutes||10)));
    state.settings.timeFormat=rawSettings.timeFormat==='24'?'24':'12';
    state.settings.externalCalendarConfirmed=Boolean(rawSettings.externalCalendarConfirmed);
    state.settings.externalCalendarExportedAt=rawSettings.externalCalendarExportedAt||null;
    state.settings.externalCalendarHorizonDays=Math.min(90,Math.max(30,Number(rawSettings.externalCalendarHorizonDays||60)));
    state.dayRecords=raw.dayRecords&&typeof raw.dayRecords==='object'&&!Array.isArray(raw.dayRecords)?raw.dayRecords:{};
    Object.values(state.dayRecords).forEach(normalizeProtocolState);
    state.classSchedule=Array.isArray(raw.classSchedule)?raw.classSchedule.map(entry=>({...entry,modality:entry.modality||((entry.room||'').toLowerCase().includes('online')?'Online':'Onsite')})):[];
    state.scheduleExceptions=Array.isArray(raw.scheduleExceptions)?raw.scheduleExceptions.map(normalizeException):[];
    state.attendanceRecords=Array.isArray(raw.attendanceRecords)?raw.attendanceRecords.map(normalizeAttendance):[];
    state.academicTasks=Array.isArray(raw.academicTasks)?raw.academicTasks.map(normalizeTask):[];
    const validTaskIds=new Set(state.academicTasks.map(task=>task.id));
    state.academicTasks.forEach(task=>{task.dependencyIds=task.dependencyIds.filter(id=>id!==task.id&&validTaskIds.has(id))});
    state.recurringTaskRules=Array.isArray(raw.recurringTaskRules)?raw.recurringTaskRules.map(normalizeRule):[];
    state.tradingNotes=Array.isArray(raw.tradingNotes)?raw.tradingNotes:[];
    state.logs=pruneLogs(Array.isArray(raw.logs)?raw.logs.map(log=>log?.type==='integrity'?{...log,type:'system'}:log):raw.logs);
    state.player.achievementUnlocks=state.player.achievementUnlocks&&typeof state.player.achievementUnlocks==='object'&&!Array.isArray(state.player.achievementUnlocks)?state.player.achievementUnlocks:{};
    state.player.achievementSeen=Array.isArray(state.player.achievementSeen)?[...new Set(state.player.achievementSeen.map(String))]:[];
    if(!state.player.pendingRank)state.player.pendingRank=pendingRankFor(state.player.level,state.player.rank);
    state.system.notificationLedger=state.system.notificationLedger&&typeof state.system.notificationLedger==='object'&&!Array.isArray(state.system.notificationLedger)?state.system.notificationLedger:{};
    state.system.migrationHistory=Array.isArray(state.system.migrationHistory)?state.system.migrationHistory:[];
    state.system.auditTrail=Array.isArray(state.system.auditTrail)?state.system.auditTrail.slice(-240):[];
    state.system.watchdog={...base.system.watchdog,...(state.system.watchdog&&typeof state.system.watchdog==='object'?state.system.watchdog:{})};
    state.system.reminderBridge={...base.system.reminderBridge,...(state.system.reminderBridge&&typeof state.system.reminderBridge==='object'?state.system.reminderBridge:{})};
    state.system.reminderBridge.missedCount=Math.max(0,Number(state.system.reminderBridge.missedCount||0));
    state.system.reminderBridge.lastExportEvents=Math.max(0,Number(state.system.reminderBridge.lastExportEvents||0));
    state.system.developerTest.reports=Array.isArray(state.system.developerTest.reports)?state.system.developerTest.reports.slice(-30):[];
    state.system.developerTest.labHistory=Array.isArray(state.system.developerTest.labHistory)?state.system.developerTest.labHistory.slice(-40):[];
    state.system.developerTest.sandboxMode=['profile','sample'].includes(state.system.developerTest.sandboxMode)?state.system.developerTest.sandboxMode:'profile';
    state.system.safeMode=Boolean(state.system.safeMode);
    state.quests.daily=state.quests.daily&&typeof state.quests.daily==='object'?state.quests.daily:null;
    state.quests.history=Array.isArray(state.quests.history)?state.quests.history.slice(-60):[];
    state.skills.points=Math.max(0,Number(state.skills.points||0));
    state.skills.unlocked=Array.isArray(state.skills.unlocked)?[...new Set(state.skills.unlocked.map(String))]:[];
    state.skills.equipped=Array.isArray(state.skills.equipped)?[...new Set(state.skills.equipped.map(String))].slice(0,2):[];
    state.weeklyDebriefs=Array.isArray(raw.weeklyDebriefs)?raw.weeklyDebriefs.slice(-16):[];
    state.timezone.name=state.timezone.name||timezoneName();state.timezone.offset=Number.isFinite(Number(state.timezone.offset))?Number(state.timezone.offset):timezoneOffset();
    state.timezone.history=Array.isArray(state.timezone.history)?state.timezone.history.slice(-20):[];
    return state;
  };

  const hashText=text=>{
    let hash=2166136261;
    for(let index=0;index<text.length;index+=1){hash^=text.charCodeAt(index);hash=Math.imul(hash,16777619)}
    return (hash>>>0).toString(16);
  };

  const readList=(key)=>{try{const value=JSON.parse(store.getItem(key)||'[]');return Array.isArray(value)?value:[]}catch(error){return[]}};
  const writeList=(key,value,limit)=>store.setItem(key,JSON.stringify(value.slice(-limit)));
  const snapshotState=state=>clone({...state,system:{...(state.system||{}),recoveredFrom:null}});
  const snapshotLimitFor=state=>state?.skills?.equipped?.includes('archive-core')?10:SNAPSHOT_LIMIT;

  const createDailySnapshot=(state,force=false)=>{
    const normalized=normalizeCurrent(snapshotState(state));
    const serialized=JSON.stringify(normalized),hash=hashText(serialized),today=dateKey(),snapshots=readList(SNAPSHOT_KEY),last=snapshots[snapshots.length-1];
    if(!force&&last&&last.date===today&&last.hash===hash)return last;
    const item={id:uid('snapshot'),date:today,createdAt:nowIso(),hash,state:normalized};
    const filtered=snapshots.filter(snapshot=>snapshot.date!==today);filtered.push(item);writeList(SNAPSHOT_KEY,filtered,snapshotLimitFor(normalized));return item;
  };

  const createPreUpdateRollback=(rawState,fromVersion=Number(rawState?.version||0),label='Pre-update data')=>{
    if(!rawState||typeof rawState!=='object')return null;
    const rollbacks=readList(ROLLBACK_KEY),serialized=JSON.stringify(rawState),hash=hashText(serialized);
    const last=rollbacks[rollbacks.length-1];if(last&&last.hash===hash&&last.fromVersion===fromVersion)return last;
    const item={id:uid('rollback'),createdAt:nowIso(),fromVersion,toVersion:VERSION,label,hash,state:clone(rawState)};
    rollbacks.push(item);writeList(ROLLBACK_KEY,rollbacks,ROLLBACK_LIMIT);return item;
  };

  const migrateLegacy=raw=>{
    const fromVersion=Number(raw?.version||0);createPreUpdateRollback(raw,fromVersion,'Automatic pre-migration rollback');
    const heldDirectiveKeys=[];const heldAttendanceIds=[];
    Object.entries(raw?.dayRecords||{}).forEach(([date,day])=>{
      if(!day||day.rewardApplied||!(Number(day.heldXp||0)>0||day.integrityStatus==='held'))return;
      Object.entries(day.protocols||{}).forEach(([protocolId,protocol])=>{
        if(protocol?.status==='cleared'&&Number(protocol.earnedXp||0)>0&&!protocol.profileXpAppliedAt)heldDirectiveKeys.push(`${date}|${protocolId}`);
      });
    });
    (raw?.attendanceRecords||[]).forEach(record=>{if(Number(record?.profileXpHeld||0)>0&&!record.profileXpAppliedAt)heldAttendanceIds.push(record.id)});
    const state=normalizeCurrent(raw||{});
    let currentDayXpRepair=0,legacyHeldXpReopened=0;
    if(fromVersion<18){
      const today=state.dayRecords?.[dateKey()];
      if(today?.status==='failed')Object.values(today.protocols||{}).forEach(protocol=>{
        const earned=Math.max(0,Number(protocol?.earnedXp||0)),applied=Math.max(0,Number(protocol?.profileXpAppliedAmount||0));
        if(protocol?.status==='cleared'&&earned>0&&applied===earned&&!protocol.profileXpAppliedAt){protocol.profileXpAppliedAmount=0;currentDayXpRepair+=earned}
      });
    }
    heldDirectiveKeys.forEach(key=>{const [date,protocolId]=key.split('|'),protocol=state.dayRecords?.[date]?.protocols?.[protocolId];if(protocol?.status==='cleared'&&!protocol.profileXpAppliedAt){legacyHeldXpReopened+=Math.max(0,Number(protocol.earnedXp||0)-Number(protocol.profileXpAppliedAmount||0));protocol.profileXpAppliedAmount=0}});
    heldAttendanceIds.forEach(id=>{const record=state.attendanceRecords.find(item=>item.id===id);if(record&&!record.profileXpAppliedAt){legacyHeldXpReopened+=Math.max(0,Number(record.xpAwarded||0)-Number(record.profileXpAppliedAmount||0));record.profileXpAppliedAmount=0}});
    if(state.quests?.daily?.id==='clean-timeline')state.quests.daily=null;
    if(fromVersion<21)state.settings.externalCalendarConfirmed=false;
    if(fromVersion<22){
      Object.values(state.dayRecords||{}).forEach(day=>{
        const workout=day?.protocols?.workout;if(!workout||!['pending','active'].includes(workout.status))return;
        workout.start='08:00';workout.end='09:30';
        const steps=Array.isArray(workout.steps)?workout.steps:[];
        workout.steps=steps.filter(step=>step?.id!=='workout-enter');
        if(!workout.steps.some(step=>step?.id==='workout-shower')){
          const confirmIndex=workout.steps.findIndex(step=>step?.id==='workout-confirm');
          const shower={id:'workout-shower',title:'Shower & Recover',copy:['Shower, change into clean clothes, hydrate, and finish your immediate post-workout recovery.','Clean up after training and prepare for the rest of the day.'],icon:'bath',type:'hold',status:'pending',startedAt:null,completedAt:null};
          if(confirmIndex>=0)workout.steps.splice(confirmIndex,0,shower);else workout.steps.push(shower);
        }
      });
      state.settings.externalCalendarConfirmed=false;
    }
    const migration={id:uid('migration'),at:nowIso(),fromVersion,toVersion:VERSION,label:'Workout shower routine update'};
    state.system.migrationHistory.push(migration);
    state.logs.push({id:uid('log'),at:migration.at,type:'migration',message:`ASCEND data migrated from schema ${fromVersion||'legacy'} to ${VERSION}. A rollback point was retained.${currentDayXpRepair?` ${currentDayXpRepair} legacy current-day XP reopened for reconciliation.`:''}${legacyHeldXpReopened?` ${legacyHeldXpReopened} previously held XP reopened for immediate Profile synchronization.`:''}`});
    state.logs=pruneLogs(state.logs);return state;
  };

  const parseStateText=text=>{
    if(!text)throw new Error('No saved state.');
    const parsed=JSON.parse(text);if(!parsed?.player)throw new Error('Player record missing.');
    return Number(parsed.version||0)<VERSION?migrateLegacy(parsed):normalizeCurrent(parsed);
  };

  const recoverState=()=>{
    const attempts=[['recovery',store.getItem(RECOVERY_KEY)],...readList(SNAPSHOT_KEY).slice().reverse().map(snapshot=>[`snapshot:${snapshot.date}`,JSON.stringify(snapshot.state)]),...readList(ROLLBACK_KEY).slice().reverse().map(point=>[`rollback:${point.fromVersion}`,JSON.stringify(point.state)])];
    for(const [source,text] of attempts){
      try{const state=parseStateText(text);state.system.recoveredFrom=source;state.system.safeMode=true;state.logs.push({id:uid('log'),at:nowIso(),type:'recovery',message:`Automatic data recovery completed from ${source}. Safe Mode enabled.`});store.setItem(KEY,JSON.stringify(state));return state}catch(error){}
    }
    const clean=initialState();clean.system.recoveredFrom='clean-state';clean.system.safeMode=true;return clean;
  };

  const load=()=>{
    try{
      const current=store.getItem(KEY);
      if(current){const parsed=JSON.parse(current);const state=Number(parsed?.version||0)<VERSION?migrateLegacy(parsed):normalizeCurrent(parsed);if(Number(parsed?.version||0)<VERSION){store.setItem(KEY,JSON.stringify(state));createDailySnapshot(state,true)}return state}
      for(const key of LEGACY_KEYS){const legacy=store.getItem(key);if(!legacy)continue;const migrated=migrateLegacy(JSON.parse(legacy));store.setItem(KEY,JSON.stringify(migrated));createDailySnapshot(migrated,true);return migrated}
      return initialState();
    }catch(error){console.error('ASCEND load failed. Attempting recovery.',error);return recoverState()}
  };

  const persist=state=>{
    const normalized=normalizeCurrent(state);normalized.updatedAt=nowIso();normalized.version=VERSION;normalized.logs=pruneLogs(normalized.logs);
    const previous=store.getItem(KEY);if(previous){try{JSON.parse(previous);store.setItem(RECOVERY_KEY,previous)}catch(error){}}
    try{store.setItem(KEY,JSON.stringify(normalized))}catch(error){normalized.logs=pruneLogs(normalized.logs).slice(-Math.floor(ROUTINE_LOG_LIMIT/2));store.setItem(KEY,JSON.stringify(normalized))}
    createDailySnapshot(normalized,false);Object.keys(state).forEach(key=>delete state[key]);Object.assign(state,normalized);return state;
  };

  const save=state=>persist(state);
  const createBackup=state=>JSON.stringify({app:'ASCEND',backupVersion:BACKUP_VERSION,schemaVersion:VERSION,exportedAt:nowIso(),state:normalizeCurrent(clone(state))},null,2);
  const parseBackup=text=>{
    let parsed;try{parsed=JSON.parse(text)}catch(error){throw new Error('The selected file is not valid JSON.')}
    const raw=parsed&&parsed.app==='ASCEND'&&parsed.state?parsed.state:parsed;
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('The selected file does not contain ASCEND data.');
    if(!raw.player||typeof raw.player!=='object')throw new Error('The backup is missing the Player record.');
    return Number(raw.version||0)<VERSION?migrateLegacy(raw):normalizeCurrent(raw);
  };
  const summarize=state=>({
    initialized:Boolean(state.initialized),playerName:state.player?.codename||state.player?.name||'Player',level:Number(state.player?.level||1),rank:state.player?.rank||'E',
    days:Object.keys(state.dayRecords||{}).length,attendance:Array.isArray(state.attendanceRecords)?state.attendanceRecords.length:0,tasks:Array.isArray(state.academicTasks)?state.academicTasks.length:0,
    recurring:Array.isArray(state.recurringTaskRules)?state.recurringTaskRules.length:0,schedules:Array.isArray(state.classSchedule)?state.classSchedule.length:0,exceptions:Array.isArray(state.scheduleExceptions)?state.scheduleExceptions.length:0,
    trading:Array.isArray(state.tradingNotes)?state.tradingNotes.length:0,logs:Array.isArray(state.logs)?state.logs.length:0,updatedAt:state.updatedAt||state.createdAt||nowIso()
  });
  const listSnapshots=()=>readList(SNAPSHOT_KEY).map(({id,date,createdAt,state})=>({id,date,createdAt,summary:summarize(state)})).reverse();
  const restoreSnapshot=id=>{const snapshot=readList(SNAPSHOT_KEY).find(item=>item.id===id);if(!snapshot)throw new Error('Snapshot not found.');return normalizeCurrent(clone(snapshot.state))};
  const listRollbackPoints=()=>readList(ROLLBACK_KEY).map(({id,createdAt,fromVersion,toVersion,label,state})=>({id,createdAt,fromVersion,toVersion,label,summary:summarize(state)})).reverse();
  const restoreRollbackPoint=id=>{const point=readList(ROLLBACK_KEY).find(item=>item.id===id);if(!point)throw new Error('Rollback point not found.');return normalizeCurrent(clone(point.state))};
  const storageBytes=state=>{
    const primary=JSON.stringify(state||{}),snapshots=store.getItem(SNAPSHOT_KEY)||'[]',recovery=store.getItem(RECOVERY_KEY)||'',rollbacks=store.getItem(ROLLBACK_KEY)||'[]';
    return new TextEncoder().encode(primary+snapshots+recovery+rollbacks).length;
  };
  const clearRecoveryNotice=state=>{if(state?.system)state.system.recoveredFrom=null;return state};
  const schemaInfo=()=>({version:VERSION,backupVersion:BACKUP_VERSION,key:KEY,rollbackCount:readList(ROLLBACK_KEY).length,snapshotCount:readList(SNAPSHOT_KEY).length});

  A.storage={load,save,dateKey,uid,createBackup,parseBackup,summarize,pruneLogs,normalizeCurrent,createDailySnapshot,listSnapshots,restoreSnapshot,createPreUpdateRollback,listRollbackPoints,restoreRollbackPoint,storageBytes,clearRecoveryNotice,schemaInfo,timezoneName,timezoneOffset};
})();
