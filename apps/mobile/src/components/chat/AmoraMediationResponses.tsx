import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { colors } from '@hanbang/design-tokens';
import { mediationChoiceLabels, type MediationChoice, type MediationResponseRevision, type MediationResponseSession, type MediationSessionState } from '@hanbang/shared/mediation-responses';
import { useMediationResponses } from '@/lib/useMediationResponses';

export default function AmoraMediationResponses({revision}:{revision:MediationResponseRevision}) {
  const {state,session}=useMediationResponses(revision);
  return <ResponseForm key={`${state.snapshot?.actorId??''}:${revision.messageId}:${revision.expectedProposalVersion}:${revision.expectedRosterFingerprint}`} state={state} session={session}/>;
}

function ResponseForm({state,session}:{state:MediationSessionState;session:MediationResponseSession}) {
  const [choice,setChoice]=useState<MediationChoice|null>(null);
  const [condition,setCondition]=useState('');
  const [editing,setEditing]=useState(false);
  const [taskOpen,setTaskOpen]=useState(false);
  const [title,setTitle]=useState('');
  const [description,setDescription]=useState('');
  const snapshot=state.snapshot;
  const currentChoice=editing?choice:snapshot?.myResponse?.choice??null;
  const currentCondition=editing?condition:snapshot?.myResponse?.condition??'';
  const disabled=state.loading||state.busy;
  async function save(){if(currentChoice&&await session.respond(currentChoice,currentChoice==='ok'?null:currentCondition))setEditing(false);}
  return <View style={styles.panel} accessibilityLiveRegion="polite">
    <Text style={styles.title}>이 선택안에 대한 내 응답</Text>
    <Text style={styles.copy}>조건과 어려운 점도 서로 볼 수 있어요. 두 분 모두 ‘괜찮음’으로 확인해야 공동 결정으로 저장돼요.</Text>
    {state.loading&&<View style={styles.loading}><ActivityIndicator color={colors.noir[800]} /><Text style={styles.copy}>확인 상태를 불러오는 중이에요</Text></View>}
    {state.error&&<Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>}
    {state.taskUnknown&&<><Text style={styles.copy}>저장 결과를 확인하기 전에는 다시 저장하지 않아요.</Text><Action label="준비 보드에서 먼저 확인" onPress={()=>router.push('/amora-preparation')}/></>}
    {snapshot&&<>
      {snapshot.responses.map(item=><View key={item.userId} style={styles.response}><Text style={styles.title}>{item.userId===snapshot.actorId?'내 응답':'상대방 응답'} · {mediationChoiceLabels[item.choice]}</Text>{item.condition&&<Text style={styles.body}>{item.condition}</Text>}</View>)}
      {snapshot.completed?<Text style={styles.success}>두 분이 각각 확인해 공동 결정으로 저장했어요</Text>:!snapshot.partnerLinked?<Text style={styles.body}>파트너가 연결된 뒤 두 분이 각각 확인할 수 있어요</Text>:<>
        {snapshot.accepted&&<Text style={styles.body}>내가 확인했어요 · 상대방 확인을 기다리고 있어요</Text>}
        <View style={styles.choices}>{(Object.keys(mediationChoiceLabels) as MediationChoice[]).map(value=><Pressable key={value} accessibilityRole="button" accessibilityLabel={mediationChoiceLabels[value]} accessibilityState={{selected:currentChoice===value,disabled}} disabled={disabled} onPress={()=>{setChoice(value);setCondition(currentCondition);setEditing(true);}} style={[styles.choice,currentChoice===value&&styles.selected,disabled&&styles.disabled]}><Text style={[styles.buttonText,currentChoice===value&&styles.selectedText]}>{mediationChoiceLabels[value]}</Text></Pressable>)}</View>
        {(currentChoice==='conditional'||currentChoice==='difficult')&&<View style={styles.fields}><Text style={styles.copy}>{currentChoice==='conditional'?'확인할 조건 (필수)':'어려운 점 (선택)'}</Text><TextInput accessibilityLabel={currentChoice==='conditional'?'확인할 조건':'어려운 점'} value={currentCondition} editable={!disabled} maxLength={500} multiline textAlignVertical="top" onChangeText={value=>{setChoice(currentChoice);setCondition(value);setEditing(true);}} style={styles.input}/></View>}
        <Action label="내 응답 저장" disabled={disabled||!currentChoice||(currentChoice==='conditional'&&!currentCondition.trim())} onPress={()=>void save()} primary/>
        {snapshot.myResponse&&<Action label="내 응답 취소" disabled={disabled} onPress={()=>void session.revoke().then(saved=>{if(saved){setEditing(false);setChoice(null);setCondition('');}})}/>}
        <Text style={styles.copy}>{snapshot.acceptedCount}/2명 괜찮음 · 조건부 가능과 어려움은 공동 확정이 아니에요.</Text>
      </>}
      {state.taskUnknown?null:state.taskSaved?<><Text style={styles.success}>공유 할 일에 저장했어요.</Text><Action label="준비 보드 보기" onPress={()=>router.push('/amora-preparation')}/></>:!taskOpen?<Action label="내가 확인할 내용 정리" disabled={disabled} onPress={()=>{setTaskOpen(true);setDescription(snapshot.myResponse?.condition??'');}}/>:<View style={styles.review}>
        <Text style={styles.title}>공유 할 일로 저장할 내용 확인</Text><Text style={styles.copy}>파트너도 보는 준비 보드에 저장해요. 상대방에게 담당자를 지정하거나 선택안을 확정하지 않아요.</Text>
        <Text style={styles.copy}>제목</Text><TextInput accessibilityLabel="확인할 할 일 제목" value={title} maxLength={120} editable={!disabled} onChangeText={setTitle} style={[styles.input,styles.titleInput]}/>
        <Text style={styles.copy}>내용</Text><TextInput accessibilityLabel="확인할 할 일 내용" value={description} maxLength={500} multiline editable={!disabled} textAlignVertical="top" onChangeText={setDescription} style={styles.input}/>
        <Action label="확인하고 공유 할 일 저장" disabled={disabled||!title.trim()} onPress={()=>void session.createTask(title,description)} primary/><Action label="취소" disabled={disabled} onPress={()=>setTaskOpen(false)}/>
      </View>}
    </>}
    <Action label="확인 상태 새로고침" disabled={disabled} onPress={()=>void session.load()}/>
  </View>;
}
function Action({label,onPress,disabled=false,primary=false}:{label:string;onPress:()=>void;disabled?:boolean;primary?:boolean}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={[styles.button,primary&&styles.selected,disabled&&styles.disabled]}><Text style={[styles.buttonText,primary&&styles.selectedText]}>{label}</Text></Pressable>;
}
const styles=StyleSheet.create({
  panel:{padding:12,gap:12,borderRadius:14,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},
  title:{fontFamily:'NotoSansKR_600SemiBold',fontSize:14,color:colors.textPrimary},
  copy:{fontFamily:'NotoSansKR_400Regular',fontSize:12,lineHeight:19,color:colors.textSecondary},
  body:{fontFamily:'NotoSansKR_400Regular',fontSize:14,lineHeight:22,color:colors.textPrimary},
  error:{fontSize:13,lineHeight:20,color:colors.danger},success:{fontSize:14,lineHeight:21,color:colors.success},
  loading:{flexDirection:'row',gap:8,alignItems:'center'},response:{padding:12,gap:6,borderRadius:10,backgroundColor:colors.ivory[100]},
  choices:{flexDirection:'row',flexWrap:'wrap',gap:8},choice:{minHeight:48,minWidth:82,flexGrow:1,paddingHorizontal:8,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.border,borderRadius:10,backgroundColor:colors.surface},
  button:{minHeight:48,paddingHorizontal:12,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.border,borderRadius:10,backgroundColor:colors.surface},
  buttonText:{fontFamily:'NotoSansKR_600SemiBold',fontSize:13,color:colors.textPrimary},selected:{backgroundColor:colors.rose[600]},selectedText:{color:colors.surface},disabled:{opacity:0.5},
  fields:{gap:6},input:{minHeight:94,padding:12,borderRadius:10,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,fontSize:14,color:colors.textPrimary},titleInput:{minHeight:48},review:{padding:12,gap:10,borderRadius:10,borderWidth:1,borderColor:colors.border},
});