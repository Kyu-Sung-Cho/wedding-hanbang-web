const MAX_BYTES=262144;
const unavailable=()=>new Error('AMORA_WRITER_CAPTURE_UNAVAILABLE');
const cancelWithoutWaiting=target=>{
  try {Promise.resolve(target?.cancel()).catch(()=>{});}catch {}
};

/** 고정 read-only capture의 수신 경계다. 내용이나 callback을 운영 증거로 발급하지 않는다. */
export async function readAmoraWriterRetirementBoundedJsonResponse(response,options) {
  if(!(response instanceof Response)||!options||Object.keys(options).join(',')!=='signal'
    ||!(options.signal instanceof AbortSignal))throw unavailable();
  const {signal}=options;
  if(!response.ok||!response.body||signal.aborted){cancelWithoutWaiting(response.body);throw unavailable();}
  let reader;
  try {reader=response.body.getReader();}catch {throw unavailable();}
  const chunks=[];
  let total=0,combined,cancelled=false,rejectAbort;
  const cancel=()=>{if(!cancelled){cancelled=true;cancelWithoutWaiting(reader);}};
  const aborted=new Promise((_,reject)=>{rejectAbort=reject;});
  const onAbort=()=>{cancel();rejectAbort(unavailable());};
  signal.addEventListener('abort',onAbort,{once:true});
  try {
    for(;;) {
      if(signal.aborted)throw unavailable();
      const result=await Promise.race([reader.read(),aborted]);
      if(signal.aborted)throw unavailable();
      if(result.done)break;
      if(!(result.value instanceof Uint8Array)||total+result.value.byteLength>MAX_BYTES)throw unavailable();
      total+=result.value.byteLength;
      chunks.push(Buffer.from(result.value));
    }
    if(total===0||signal.aborted)throw unavailable();
    combined=Buffer.concat(chunks,total);
    const text=new TextDecoder('utf-8',{fatal:true}).decode(combined);
    if(signal.aborted)throw unavailable();
    return JSON.parse(text);
  } catch {
    cancel();throw unavailable();
  } finally {
    signal.removeEventListener('abort',onAbort);
    try {reader.releaseLock();}catch {}
    combined?.fill(0);for(const chunk of chunks)chunk.fill(0);
  }
}
