const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const sameScope = (a,b) => a && b && a.ownerId === b.ownerId && a.coupleId === b.coupleId && a.rosterKey === b.rosterKey;
const validScope = scope => scope && UUID.test(scope.ownerId) && UUID.test(scope.coupleId);
export const mediationChoiceLabels = { ok: '괜찮음', conditional: '조건부 가능', difficult: '어려움' };
const choiceValid = choice => Object.hasOwn(mediationChoiceLabels, choice);
const cleanCondition = (choice, value) => {
  if (!choiceValid(choice) || (value !== null && typeof value !== 'string')) return undefined;
  if (choice === 'ok' && value !== null) return undefined;
  const condition = typeof value === 'string' ? value.trim() : null;
  if ((condition?.length ?? 0) > 500 || (choice === 'conditional' && !condition)) return undefined;
  return condition || null;
};
function parseRow(value) {
  if (!record(value) || !UUID.test(value.userId) || !integer(value.revision) || value.revision < 1 || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return null;
  const normalized = cleanCondition(value.choice,value.condition);
  if (normalized === undefined || normalized !== value.condition) return null;
  return { userId:value.userId,choice:value.choice,condition:value.condition,revision:value.revision,updatedAt:value.updatedAt };
}
export function parseMediationResponseState(value, scope, revision) {
  if (!record(value) || !validScope(scope) || value.actorId !== scope.ownerId || value.proposalVersion !== revision.expectedProposalVersion || value.rosterFingerprint !== revision.expectedRosterFingerprint || !integer(value.myResponseRevision) || !Array.isArray(value.responses) || value.responses.length > 2 || value.requiredCount !== 2 || typeof value.accepted !== 'boolean' || typeof value.completed !== 'boolean' || typeof value.partnerLinked !== 'boolean') return null;
  const responses = value.responses.map(parseRow);
  if (responses.some(item=>!item) || new Set(responses.map(item=>item.userId)).size !== responses.length) return null;
  const mine = responses.find(item=>item.userId===scope.ownerId) ?? null;
  const myResponse = value.myResponse === null ? null : parseRow(value.myResponse);
  if ((value.myResponse !== null && !myResponse) || JSON.stringify(mine) !== JSON.stringify(myResponse) || (mine && mine.revision !== value.myResponseRevision)) return null;
  const acceptedCount = responses.filter(item=>item.choice==='ok').length;
  if (value.acceptedCount !== acceptedCount || value.accepted !== (mine?.choice === 'ok') || (value.completed && (acceptedCount !== 2 || !value.partnerLinked)) || (!value.partnerLinked && responses.some(item=>item.userId!==scope.ownerId))) return null;
  return { actorId:value.actorId,proposalVersion:value.proposalVersion,rosterFingerprint:value.rosterFingerprint,accepted:value.accepted,acceptedCount,requiredCount:2,completed:value.completed,partnerLinked:value.partnerLinked,myResponse,myResponseRevision:value.myResponseRevision,responses };
}
export function createMediationResponseSession({ revision, readScope, request }) {
  let generation=0, identity=null;
  let state={ snapshot:null, loading:false, busy:false, error:null, taskSaved:null, taskUnknown:false };
  const listeners=new Set();
  const set=patch=>{ state={...state,...patch}; for(const listener of listeners) listener(); };
  const invalidate=()=>{ generation++;identity=null;set({snapshot:null,loading:false,busy:false,error:null,taskSaved:null, taskUnknown:false}); };
  const current=async (epoch, scope)=>epoch===generation && sameScope(scope,await readScope()) && epoch===generation;
  const path='/api/amora/mediation/responses';
  async function read(epoch, scope) {
    const params=new URLSearchParams({...revision,expectedOwnerId:scope.ownerId});
    const response=await request(scope,`${path}?${params}`,{method:'GET',cache:'no-store'});
    const payload=await response.json();
    if (!(await current(epoch,scope))) throw new Error('SCOPE_CHANGED');
    const parsed=response.ok ? parseMediationResponseState(payload,scope,revision) : null;
    if (!parsed) throw new Error('READ_FAILED');
    return parsed;
  }
  async function load() {
    if(state.loading||state.busy) return false;
    const epoch=generation;set({loading:true,error:null});
    try {
      const scope=await readScope();
      if(epoch!==generation||!validScope(scope)) throw new Error('SCOPE_CHANGED');
      if(identity&&!sameScope(identity,scope)) { invalidate();return false; }
      identity=scope;
      const snapshot=await read(epoch,scope);
      if(epoch!==generation) return false;
      set({snapshot});return true;
    } catch { if(epoch===generation) set({snapshot:null,error:'확인 상태를 불러오지 못했어요. 다시 확인해 주세요.'}); return false; }
    finally { if(epoch===generation) set({loading:false}); }
  }
  async function mutate(method, choice, condition) {
    if(state.busy||state.loading||!identity||!state.snapshot||state.snapshot.completed||!state.snapshot.partnerLinked) return false;
    if(method==='DELETE'&&!state.snapshot.myResponse) return false;
    const normalized=method==='POST'?cleanCondition(choice,condition):null;
    if(normalized===undefined) {set({error:'조건부 가능을 선택하면 확인할 조건을 500자 안으로 적어 주세요.'});return false;}
    const epoch=generation, scope=identity, expectedResponseRevision=state.snapshot.myResponseRevision;
    set({busy:true,error:null});
    try {
      if(!(await current(epoch,scope))) { if(epoch===generation) invalidate();return false; }
      const response=await request(scope,path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({...revision,expectedOwnerId:scope.ownerId,expectedResponseRevision,...(method==='POST'?{choice,condition:normalized}:{})})});
      const payload=await response.json();
      if(!(await current(epoch,scope))) { if(epoch===generation) invalidate();return false; }
      if(!response.ok) {
        if(response.status===409) { const snapshot=await read(epoch,scope);if(epoch===generation)set({snapshot}); }
        throw new Error('WRITE_FAILED');
      }
      const parsed=parseMediationResponseState(payload,scope,revision);
      if(!parsed||parsed.myResponseRevision<=expectedResponseRevision||(method==='POST'?(parsed.myResponse?.choice!==choice||parsed.myResponse.condition!==normalized):(parsed.myResponse!==null||parsed.accepted||parsed.completed))) throw new Error('INVALID_RECEIPT');
      set({snapshot:parsed});return true;
    } catch { if(epoch===generation)set({error:'응답 결과를 확인하지 못했어요. 상태를 다시 확인하고 시도해 주세요.'});return false; }
    finally { if(epoch===generation)set({busy:false}); }
  }
  async function createTask(title, description) {
    if(state.busy||state.loading||!identity||!state.snapshot||state.taskSaved||state.taskUnknown) return false;
    const cleanTitle=typeof title==='string'?title.trim():'';
    const cleanDescription=typeof description==='string'?description.trim():'';
    if(!cleanTitle||cleanTitle.length>120||cleanDescription.length>500) {set({error:'제목은 120자, 내용은 500자 안으로 확인해 주세요.'});return false;}
    const epoch=generation,scope=identity;let dispatched=false, rejected=false;set({busy:true,error:null});
    try {
      if(!(await current(epoch,scope))) {if(epoch===generation)invalidate();return false;}
      const body={title:cleanTitle,description:cleanDescription,status:'open',source:'manual',href:'/chat',expectedOwnerId:scope.ownerId,expectedCoupleId:scope.coupleId};
      dispatched=true;
      const response=await request(scope,'/api/amora/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      rejected=!response.ok && response.status>=400 && response.status<500;
      const payload=await response.json();
      if(!(await current(epoch,scope))) {if(epoch===generation)invalidate();return false;}
      const item=record(payload)?payload.action:null;
      if(!response.ok||!record(item)||typeof item.id!=='string'||!item.id||item.title!==cleanTitle||(item.description??'')!==cleanDescription||item.status!=='open'||item.source!=='manual'||item.href!=='/chat')throw new Error('INVALID_RECEIPT');
      set({taskSaved:item.id});return true;
    } catch {if(epoch===generation)set({taskUnknown:dispatched&&!rejected,error:rejected?'할 일을 저장하지 못했어요. 입력과 연결 상태를 확인한 뒤 다시 시도해 주세요.':'할 일 저장 결과를 확인하지 못했어요. 준비 보드를 먼저 확인해 주세요.'});return false;}
    finally{if(epoch===generation)set({busy:false});}
  }
  return {getState:()=>state,subscribe(listener){listeners.add(listener);return()=>{listeners.delete(listener);};},invalidate,load,respond:(choice,condition)=>mutate('POST',choice,condition),revoke:()=>mutate('DELETE'),createTask};
}