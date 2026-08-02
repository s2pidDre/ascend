(function(){
  'use strict';
  const A=window.ASCEND=window.ASCEND||{};
  const KEY='ascend_discipline_protocol_v7';
  const LEGACY_KEYS=['ascend_discipline_protocol_v6','ascend_discipline_protocol_v5','ascend_discipline_protocol_v4','ascend_strict_system_v3','ascend_automatic_year_system_v2','ascend_personal_growth_system_v1'];
  const VERSION=10;
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
      name:'Player',codename:'',emblem:'◇',title:'Discipline Initiate',level:1,maxLevel:50,streak:0,bestStreak:0,totalClearDays:0,totalFailedDays:0,
      levelClearDays:0,mastered:false,masteredAt:null,totalXp:0,masteryChoice:null,
      rank:'E',pendingRank:null,perfectClears:0,lastPerfectDate:null,failureScar:false,rankTrialAttempts:0
    },
    dayRecords:{},
    classSchedule:[],
    attendanceRecords:[],
    academicTasks:[],
    tradingNotes:[],
    settings:{sound:true,haptics:true,keepAwake:true},
    logs:[]
  });

  const normalizeAttendance=record=>({
    id:record.id||uid('attendance'),
    meetingKey:record.meetingKey||'',
    classId:record.classId||null,
    subjectKey:String(record.subjectKey||record.subjectName||'').trim().toLowerCase(),
    subjectName:record.subjectName||'Unknown Subject',
    code:record.code||'',
    scheduledDate:record.scheduledDate||dateKey(new Date(record.createdAt||Date.now())),
    scheduledStart:record.scheduledStart||'00:00',
    scheduledEnd:record.scheduledEnd||'00:00',
    room:record.room||'',
    modality:record.modality||'Onsite',
    status:record.status||'unverified',
    checkInAt:record.checkInAt||null,
    dismissedAt:record.dismissedAt||null,
    dismissalStatus:record.dismissalStatus||null,
    minutesLate:Number(record.minutesLate||0),
    pendingXp:Number(record.pendingXp||0),
    xpAwarded:Number(record.xpAwarded||0),
    finalized:Boolean(record.finalized),
    ongoingUntil:record.ongoingUntil||null,
    createdAt:record.createdAt||nowIso(),
    updatedAt:record.updatedAt||record.createdAt||nowIso(),
    corrections:Array.isArray(record.corrections)?record.corrections:[]
  });

  const normalizeCurrent=raw=>{
    const base=initialState();
    if(!raw||typeof raw!=='object')return base;
    const rawSettings=raw.settings&&typeof raw.settings==='object'?raw.settings:{};
    const state={
      ...base,
      ...raw,
      player:{...base.player,...(raw.player||{})},
      settings:{
        sound:typeof rawSettings.sound==='boolean'?rawSettings.sound:base.settings.sound,
        haptics:typeof rawSettings.haptics==='boolean'?rawSettings.haptics:base.settings.haptics,
        keepAwake:typeof rawSettings.keepAwake==='boolean'?rawSettings.keepAwake:base.settings.keepAwake
      }
    };
    state.version=VERSION;
    state.dayRecords=raw.dayRecords&&typeof raw.dayRecords==='object'?raw.dayRecords:{};
    state.classSchedule=Array.isArray(raw.classSchedule)?raw.classSchedule.map(entry=>({...entry,modality:entry.modality||((entry.room||'').toLowerCase().includes('online')?'Online':'Onsite')})):[];
    state.attendanceRecords=Array.isArray(raw.attendanceRecords)?raw.attendanceRecords.map(normalizeAttendance):[];
    state.academicTasks=Array.isArray(raw.academicTasks)?raw.academicTasks:[];
    state.tradingNotes=Array.isArray(raw.tradingNotes)?raw.tradingNotes:[];
    state.logs=Array.isArray(raw.logs)?raw.logs:[];
    if(!state.player.pendingRank)state.player.pendingRank=pendingRankFor(state.player.level,state.player.rank);
    return state;
  };

  const migrateLegacy=raw=>{
    const state=normalizeCurrent(raw||{});
    state.logs=Array.isArray(state.logs)?state.logs.slice(-500):[];
    state.logs.push({id:uid('log'),at:nowIso(),type:'system',message:'ASCEND upgraded with class attendance, academic progression, hidden Player Profile, stronger haptics, and voice-free feedback.'});
    return state;
  };

  const load=()=>{
    try{
      const current=store.getItem(KEY);
      if(current)return normalizeCurrent(JSON.parse(current));
      for(const key of LEGACY_KEYS){
        const raw=store.getItem(key);
        if(!raw)continue;
        const migrated=migrateLegacy(JSON.parse(raw));
        store.setItem(KEY,JSON.stringify(migrated));
        return migrated;
      }
      return initialState();
    }catch(error){console.error('ASCEND load failed.',error);return initialState()}
  };

  const save=state=>{state.updatedAt=nowIso();state.version=VERSION;store.setItem(KEY,JSON.stringify(state));return state};
  A.storage={load,save,dateKey,uid};
})();
