(function(){
  'use strict';
  const A=window.ASCEND=window.ASCEND||{};
  const KEY='ascend_discipline_protocol_v7';
  const RECOVERY_KEY='ascend_discipline_protocol_recovery_v1';
  const SNAPSHOT_KEY='ascend_discipline_protocol_snapshots_v1';
  const LEGACY_KEYS=['ascend_discipline_protocol_v6','ascend_discipline_protocol_v5','ascend_discipline_protocol_v4','ascend_strict_system_v3','ascend_automatic_year_system_v2','ascend_personal_growth_system_v1'];
  const VERSION=13;
  const BACKUP_VERSION=2;
  const ROUTINE_LOG_LIMIT=420;
  const SNAPSHOT_LIMIT=7;
  const PERMANENT_LOG_TYPES=new Set(['system','level','rank','mastery','achievement','backup','restore','emergency','attendance-correction','integrity','recovery','snapshot','boss']);
  const nowIso=()=>new Date().toISOString();
  const dateKey=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const uid=(prefix='id')=>window.crypto?.randomUUID?`${prefix}_${crypto.randomUUID()}`:`${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const memory=(()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}})();
  const store=(()=>{try{localStorage.setItem('__ascend_test__','1');localStorage.removeItem('__ascend_test__');return localStorage}catch(error){console.warn('Persistent storage unavailable. Using temporary memory.',error);return memory}})();

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
    tradingNotes:[],
    settings:{sound:true,haptics:true,keepAwake:true,notifications:false,notificationLeadMinutes:10},
    integrity:{clockStatus:'trusted',rewardHold:false,lastWallTime:null,lastVerifiedAt:null,lastFlag:null,lastSessionDelta:0},
    recovery:{active:false,status:'idle',sourceDate:null,reason:null,action:null,protectedDate:null,protectedProtocolId:null,completedAt:null},
    system:{recoveredFrom:null,lastStorageWarningAt:null,notificationLedger:{}},
    logs:[]
  });

  const normalizeAttendance=record=>({
    id:record.id||uid('attendance'),meetingKey:record.meetingKey||'',classId:record.classId||null,
    subjectKey:String(record.subjectKey||record.subjectName||'').trim().toLowerCase(),subjectName:record.subjectName||'Unknown Subject',code:record.code||'',
    scheduledDate:record.scheduledDate||dateKey(new Date(record.createdAt||Date.now())),scheduledStart:record.scheduledStart||'00:00',scheduledEnd:record.scheduledEnd||'00:00',
    room:record.room||'',modality:record.modality||'Onsite',status:record.status||'unverified',checkInAt:record.checkInAt||null,dismissedAt:record.dismissedAt||null,
    dismissalStatus:record.dismissalStatus||null,minutesLate:Number(record.minutesLate||0),pendingXp:Number(record.pendingXp||0),xpAwarded:Number(record.xpAwarded||0),
    finalized:Boolean(record.finalized),ongoingUntil:record.ongoingUntil||null,createdAt:record.createdAt||nowIso(),updatedAt:record.updatedAt||record.createdAt||nowIso(),
    corrections:Array.isArray(record.corrections)?record.corrections:[]
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
      if(protocol.status==='active'){
        if(activeKept)protocol.status='pending';
        else activeKept=true;
      }
      if(protocol.status==='cleared'){
        protocol.steps.forEach(step=>{step.status='completed';step.startedAt=step.startedAt||protocol.startedAt||protocol.completedAt;step.completedAt=step.completedAt||protocol.completedAt||nowIso()});
        protocol.earnedXp=Math.max(0,Number(protocol.earnedXp||0));
      }
      if(protocol.status==='failed')protocol.earnedXp=0;
      protocol.focusBreaches=Math.max(0,Number(protocol.focusBreaches||0));
      protocol.hiddenMilliseconds=Math.max(0,Number(protocol.hiddenMilliseconds||0));
    });
    day.completedProtocols=Object.values(protocols).filter(protocol=>protocol?.status==='cleared').length;
    day.failedProtocols=Object.values(protocols).filter(protocol=>protocol?.status==='failed').length;
    if(!['active','cleared','failed'].includes(day.status))day.status='active';
    day.rewardApplied=Boolean(day.rewardApplied);
    day.heldXp=Math.max(0,Number(day.heldXp||0));
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
    const state={...base,...raw,player:{...base.player,...(raw.player||{})},integrity:{...base.integrity,...(raw.integrity||{})},recovery:{...base.recovery,...(raw.recovery||{})},system:{...base.system,...(raw.system||{})},settings:{...base.settings,...rawSettings}};
    state.version=VERSION;
    state.settings.sound=typeof rawSettings.sound==='boolean'?rawSettings.sound:base.settings.sound;
    state.settings.haptics=typeof rawSettings.haptics==='boolean'?rawSettings.haptics:base.settings.haptics;
    state.settings.keepAwake=typeof rawSettings.keepAwake==='boolean'?rawSettings.keepAwake:base.settings.keepAwake;
    state.settings.notifications=typeof rawSettings.notifications==='boolean'?rawSettings.notifications:base.settings.notifications;
    state.settings.notificationLeadMinutes=Math.min(30,Math.max(5,Number(rawSettings.notificationLeadMinutes||10)));
    state.dayRecords=raw.dayRecords&&typeof raw.dayRecords==='object'&&!Array.isArray(raw.dayRecords)?raw.dayRecords:{};
    Object.values(state.dayRecords).forEach(normalizeProtocolState);
    state.classSchedule=Array.isArray(raw.classSchedule)?raw.classSchedule.map(entry=>({...entry,modality:entry.modality||((entry.room||'').toLowerCase().includes('online')?'Online':'Onsite')})):[];
    state.scheduleExceptions=Array.isArray(raw.scheduleExceptions)?raw.scheduleExceptions.map(normalizeException):[];
    state.attendanceRecords=Array.isArray(raw.attendanceRecords)?raw.attendanceRecords.map(normalizeAttendance):[];
    state.academicTasks=Array.isArray(raw.academicTasks)?raw.academicTasks:[];
    state.tradingNotes=Array.isArray(raw.tradingNotes)?raw.tradingNotes:[];
    state.logs=pruneLogs(raw.logs);
    state.player.achievementUnlocks=state.player.achievementUnlocks&&typeof state.player.achievementUnlocks==='object'&&!Array.isArray(state.player.achievementUnlocks)?state.player.achievementUnlocks:{};
    state.player.achievementSeen=Array.isArray(state.player.achievementSeen)?[...new Set(state.player.achievementSeen.map(String))]:[];
    if(!state.player.pendingRank)state.player.pendingRank=pendingRankFor(state.player.level,state.player.rank);
    if(!['trusted','flagged'].includes(state.integrity.clockStatus))state.integrity.clockStatus='trusted';
    state.integrity.rewardHold=Boolean(state.integrity.rewardHold||state.integrity.clockStatus==='flagged');
    state.system.notificationLedger=state.system.notificationLedger&&typeof state.system.notificationLedger==='object'&&!Array.isArray(state.system.notificationLedger)?state.system.notificationLedger:{};
    return state;
  };

  const migrateLegacy=raw=>{
    const state=normalizeCurrent(raw||{});
    state.logs.push({id:uid('log'),at:nowIso(),type:'system',message:'ASCEND upgraded with integrity checks, automatic recovery snapshots, strict protocol states, schedule exceptions, and optional local alerts.'});
    state.logs=pruneLogs(state.logs);return state;
  };

  const parseStateText=text=>{
    if(!text)throw new Error('No saved state.');
    const parsed=JSON.parse(text);
    if(!parsed?.player)throw new Error('Player record missing.');
    return normalizeCurrent(parsed);
  };

  const hashText=text=>{
    let hash=2166136261;
    for(let index=0;index<text.length;index+=1){hash^=text.charCodeAt(index);hash=Math.imul(hash,16777619)}
    return (hash>>>0).toString(16);
  };

  const readSnapshots=()=>{
    try{const value=JSON.parse(store.getItem(SNAPSHOT_KEY)||'[]');return Array.isArray(value)?value:[]}catch(error){return[]}
  };
  const writeSnapshots=snapshots=>store.setItem(SNAPSHOT_KEY,JSON.stringify(snapshots.slice(-SNAPSHOT_LIMIT)));
  const snapshotState=state=>JSON.parse(JSON.stringify({...state,system:{...(state.system||{}),recoveredFrom:null}}));
  const createDailySnapshot=(state,force=false)=>{
    const normalized=normalizeCurrent(snapshotState(state));
    const serialized=JSON.stringify(normalized);
    const hash=hashText(serialized);
    const today=dateKey();
    const snapshots=readSnapshots();
    const last=snapshots[snapshots.length-1];
    if(!force&&last&&last.date===today&&last.hash===hash)return last;
    const item={id:uid('snapshot'),date:today,createdAt:nowIso(),hash,state:normalized};
    const filtered=snapshots.filter(snapshot=>snapshot.date!==today);
    filtered.push(item);writeSnapshots(filtered);
    return item;
  };

  const recoverState=()=>{
    const attempts=[['recovery',store.getItem(RECOVERY_KEY)],...readSnapshots().slice().reverse().map(snapshot=>[`snapshot:${snapshot.date}`,JSON.stringify(snapshot.state)])];
    for(const [source,text] of attempts){
      try{
        const state=parseStateText(text);state.system.recoveredFrom=source;
        state.logs.push({id:uid('log'),at:nowIso(),type:'integrity',message:`Automatic data recovery completed from ${source}.`});
        store.setItem(KEY,JSON.stringify(state));return state;
      }catch(error){}
    }
    const clean=initialState();clean.system.recoveredFrom='clean-state';return clean;
  };

  const load=()=>{
    try{
      const current=store.getItem(KEY);
      if(current)return parseStateText(current);
      for(const key of LEGACY_KEYS){const legacy=store.getItem(key);if(!legacy)continue;const migrated=migrateLegacy(JSON.parse(legacy));store.setItem(KEY,JSON.stringify(migrated));createDailySnapshot(migrated,true);return migrated}
      return initialState();
    }catch(error){console.error('ASCEND load failed. Attempting recovery.',error);return recoverState()}
  };

  const persist=state=>{
    const normalized=normalizeCurrent(state);normalized.updatedAt=nowIso();normalized.version=VERSION;normalized.logs=pruneLogs(normalized.logs);
    const previous=store.getItem(KEY);
    if(previous){try{parseStateText(previous);store.setItem(RECOVERY_KEY,previous)}catch(error){}}
    const serialized=JSON.stringify(normalized);
    try{store.setItem(KEY,serialized)}catch(error){
      normalized.logs=pruneLogs(normalized.logs).slice(-Math.floor(ROUTINE_LOG_LIMIT/2));
      store.setItem(KEY,JSON.stringify(normalized));
    }
    createDailySnapshot(normalized,false);
    Object.keys(state).forEach(key=>delete state[key]);Object.assign(state,normalized);
    return state;
  };

  const save=state=>persist(state);
  const createBackup=state=>JSON.stringify({app:'ASCEND',backupVersion:BACKUP_VERSION,exportedAt:nowIso(),state:normalizeCurrent(JSON.parse(JSON.stringify(state)))},null,2);
  const parseBackup=text=>{
    let parsed;try{parsed=JSON.parse(text)}catch(error){throw new Error('The selected file is not valid JSON.')}
    const raw=parsed&&parsed.app==='ASCEND'&&parsed.state?parsed.state:parsed;
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('The selected file does not contain ASCEND data.');
    if(!raw.player||typeof raw.player!=='object')throw new Error('The backup is missing the Player record.');
    return normalizeCurrent(raw);
  };
  const summarize=state=>({
    initialized:Boolean(state.initialized),playerName:state.player?.codename||state.player?.name||'Player',level:Number(state.player?.level||1),rank:state.player?.rank||'E',
    days:Object.keys(state.dayRecords||{}).length,attendance:Array.isArray(state.attendanceRecords)?state.attendanceRecords.length:0,tasks:Array.isArray(state.academicTasks)?state.academicTasks.length:0,
    schedules:Array.isArray(state.classSchedule)?state.classSchedule.length:0,exceptions:Array.isArray(state.scheduleExceptions)?state.scheduleExceptions.length:0,trading:Array.isArray(state.tradingNotes)?state.tradingNotes.length:0,
    logs:Array.isArray(state.logs)?state.logs.length:0,updatedAt:state.updatedAt||state.createdAt||nowIso()
  });
  const listSnapshots=()=>readSnapshots().map(({id,date,createdAt,state})=>({id,date,createdAt,summary:summarize(state)})).reverse();
  const restoreSnapshot=id=>{
    const snapshot=readSnapshots().find(item=>item.id===id);if(!snapshot)throw new Error('Snapshot not found.');return normalizeCurrent(JSON.parse(JSON.stringify(snapshot.state)));
  };
  const storageBytes=state=>{
    const primary=JSON.stringify(state||{}),snapshots=store.getItem(SNAPSHOT_KEY)||'[]',recovery=store.getItem(RECOVERY_KEY)||'';
    return new TextEncoder().encode(primary+snapshots+recovery).length;
  };
  const clearRecoveryNotice=state=>{if(state?.system)state.system.recoveredFrom=null;return state};

  A.storage={load,save,dateKey,uid,createBackup,parseBackup,summarize,pruneLogs,normalizeCurrent,createDailySnapshot,listSnapshots,restoreSnapshot,storageBytes,clearRecoveryNotice};
})();
