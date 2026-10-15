"""이름 우선 결과 카피. 관측 선호와 보류 안내 캐릭터를 구별한다."""
import json
from reference_model import BASE,BANK,CONTRACT,FINGERPRINT,ITEMS,CRITERIA,NOTES,evaluate,compare

CATALOG=json.loads((BASE/'type-catalog.json').read_text(encoding='utf-8'))
COMPONENTS={c['criterion']:c for c in CATALOG['adjectives']+CATALOG['animals']}
COPY=json.loads((BASE/'type-cards.json').read_text(encoding='utf-8'))
CARD_COPY={c['id']:c for c in COPY['cards']}
MEANINGS={c['criterion']:c['meaning'] for c in COPY['adjective_components']+COPY['animal_components']}
FALLBACK=CONTRACT['presentation_rules']['fallback_name']
DEFAULT_SHARE_IDS=[i for c in CRITERIA.values() for i in c['item_ids']]
CONVERSATION_OVERRIDES={
    'B':'둘이 정한 전체 예산 한도에는 어떤 비용까지 포함할까요? 바꿔야 할 때는 어떻게 다시 정할까요?',
    'S':'입장할 때, 이름을 소개할 때, 하객 테이블에서 인사할 때 각각 어떤 방식이면 편할까요?',
}

def submission(values=None, *, comparison=False, share_ids=None, share_alias=False):
    if values is None:answers={i:None for i in ITEMS}
    elif type(values) is int:answers={i:values for i in ITEMS}
    elif isinstance(values,dict):answers={i:values.get(i) for i in ITEMS}
    else:raise ValueError('invalid_values')
    return {'questionnaire_version':BANK['version'],'questionnaire_fingerprint':FINGERPRINT,
            'answers':answers,'missing_reasons':{},'allow_couple_comparison':comparison,
            'share_item_ids':list(DEFAULT_SHARE_IDS if share_ids is None and comparison else share_ids or []),
            'share_alias':share_alias}

def component_meaning(cid):
    return MEANINGS[cid]

def criterion_card(cid,stats):
    data=CRITERIA[cid]
    state=stats['state']
    if state=='H':summary='세 장면 모두 ‘그렇다’ 또는 ‘매우 그렇다’로 답했어요.'
    elif state=='L':summary='세 장면 모두 ‘그렇지 않다’ 또는 ‘전혀 그렇지 않다’로 답했어요. 원하는 대안까지 정해진 것은 아니에요.'
    elif state=='M':summary='답하지 않은 문항이 있어 이 기준의 세 장면 전체 평균은 표시하지 않았어요.'
    elif state=='X':summary='같은 기준에서도 장면에 따라 동의와 반대가 함께 나왔어요. 각 장면의 답부터 확인해 봐요.'
    elif stats['ratings']==[3,3,3]:summary='세 장면 모두 ‘동의도 반대도 하지 않는다’로 답했어요. 이 답에서 한 방향의 선호를 정하지 않았어요.'
    else:summary='중간 응답이 포함돼 있어요. 평균 하나로 묶기보다 장면별 동의 정도를 함께 확인해 봐요.'
    evidence=[{'id':i,'number':ITEMS[i]['display_number'],'context':ITEMS[i]['context'],
               'statement':ITEMS[i]['statement'],'value':v} for i,v in zip(data['item_ids'],stats['ratings'])]
    return {'id':cid,'label':data['label'],'summary':summary,'state':state,
            'mean':stats['display_mean'],'evidence':evidence}

def present(s):
    result=evaluate(s)
    answers=s['answers']
    answered=sum(v is not None for v in answers.values())
    profile=result['profile']
    states=[p['state'] for p in profile.values()]
    repeated=[answers[i] for c in CRITERIA.values() for i in c['item_ids']]
    full=result['alias']['status']=='full'
    name=result['alias']['name'] if full else FALLBACK
    kind='supported_preferences' if full else 'response_state_character'
    selected=[x['criterion'] for x in [result['alias']['adjective'],result['alias']['animal']] if x['criterion']]
    if not answered:
        summary='아직 답한 문항이 없어요. 답을 남기면 해당 장면의 결과를 볼 수 있어요.'
        good=[]
        cautions=['아직 준비 선호를 설명할 응답이 없어요. 비워둔 답은 중간 점수로 채우지 않아요.']
        questions=[]
    elif full:
        card=CARD_COPY[result['alias']['id']]
        summary=card['summary']
        good=[card['good_point']]
        cautions=[card['caution']]
        questions=[CONVERSATION_OVERRIDES.get(c,ITEMS[CRITERIA[c]['item_ids'][0]]['couple_prompt']) for c in selected]
    else:
        if all(v==3 for v in repeated):
            summary='준비 기준을 묻는 27개 문항 모두 ‘동의도 반대도 하지 않는다’로 답했어요. 이번 답은 한 가지 준비 별명으로 묶지 않았어요.'
            good=['원하는 방식이 따로 있는지, 아직 생각해보지 않은 장면인지부터 이야기할 수 있어요.']
            cautions=['중간 응답만으로 균형 감각·유연함·차분한 성격을 판단하지 않아요. 중간 응답이 나온 이유도 사람마다 다를 수 있어요.']
        elif all(state=='H' for state in states):
            summary='준비 기준을 묻는 모든 장면에서 동의했어요. 여러 기준 중 하나만 대표로 고르지 않았어요.'
            good=['함께 지키고 싶은 기준들을 적어두고, 실제로 선택이 겹칠 때 무엇부터 반영할지 이야기할 수 있어요.']
            cautions=['여러 방식에 동의한 것이 모든 일을 잘하거나 실제로 전부 해낼 수 있다는 뜻은 아니에요.']
        elif all(state=='L' for state in states):
            summary='준비 기준을 묻는 모든 문항에 ‘그렇지 않다’ 또는 ‘전혀 그렇지 않다’로 답했어요. 어떤 대안을 원하는지는 이 답만으로 정하지 않았어요.'
            good=['제시된 방식 외에 원하는 준비 방식이 있는지 말로 덧붙여 볼 수 있어요.']
            cautions=['낮은 동의가 무관심이나 반대 성향의 증거는 아니에요. 실제로 원하는 대안을 따로 확인해 주세요.']
        elif 'M' in states:
            summary='답한 내용부터 볼 수 있어요. 답하지 않은 문항이 있어 대표 준비 별명은 한 가지로 정하지 않았어요.'
            good=['답한 장면의 응답은 그대로 확인할 수 있어요. 모든 질문에 억지로 답할 필요는 없어요.']
            cautions=['모름·비해당·답하고 싶지 않음은 3점과 달라요. 비어 있는 답을 특정 성향으로 채우지 않아요.']
        elif 'X' in states:
            summary='같은 준비 기준에서도 장면에 따라 답이 달랐어요. 상황별 답을 함께 보도록 정리했어요.'
            good=['어느 장면에서 원하는 방식이 달라지는지 구체적으로 이야기할 수 있어요.']
            cautions=['장면별 답이 다르다고 일관성이 없는 사람이라는 뜻은 아니에요. 실제 상황과 선택 이유를 함께 봐주세요.']
        else:
            summary='비슷하게 답한 기준이 있거나, 대표 기준을 고를 만큼 반복된 동의가 뚜렷하지 않았어요. 답한 내용부터 함께 볼게요.'
            good=['하나의 이름에 맞추지 않고, 함께 드러난 준비 기준들을 나란히 확인할 수 있어요.']
            cautions=['동점이나 작은 점수 차이에서 특정 기준을 임의로 골라 성향으로 단정하지 않아요.']
        questions=['예식장을 고를 때 어떤 점부터 정해두면 편할까요?', '이 답을 고른 이유 중 파트너에게 먼저 알려주고 싶은 것은 무엇인가요?']
    if selected and not full:
        cautions.append('확인된 부분: '+' / '.join(component_meaning(c) for c in selected))
    why=[component_meaning(c) for c in selected] if full else ['이 이름은 대표 준비 별명이 한 가지로 정해지지 않은 결과를 안내하는 캐릭터 이름이에요. 성격을 판정한 이름은 아니에요.']
    cards=[criterion_card(cid,stats) for cid,stats in profile.items()] if answered else []
    notes=[{'id':i,'label':NOTES[i]['label'],'number':ITEMS[i]['display_number'],'context':ITEMS[i]['context'],
            'statement':ITEMS[i]['statement'],'value':answers[i],'default_share':False,'type_input':False} for i in NOTES] if answered else []
    return {'name':name,'name_kind':kind,'summary':summary,'why_this_name':why,
            'good_points':good,'cautions':cautions,'conversation':questions,'profile':cards,'notes':notes,
            'display_order':list(CONTRACT['presentation_rules']['display_order']),
            'answered_count':answered,'technical_code_in_primary_display':False,
            'questionnaire_version':BANK['version'],'scoring_version':CONTRACT['version'],
            'assessment':result,'human_validation_completed':False}

def present_comparison(a,b):
    result=compare(a,b)
    if result.get('status')=='no_comparison_consent':
        return {'names':None,'summary':result['copy']['summary'],'body':result,'display_order':['summary'],
                'human_validation_completed':False}
    names=None
    if a.get('share_alias',False) and b.get('share_alias',False):
        pa,pb=present(a),present(b)
        names={'a':{'name':pa['name'],'name_kind':pa['name_kind']},'b':{'name':pb['name'],'name_kind':pb['name_kind']}}
    body={k:v for k,v in result.items() if k!='aliases'}
    pairs=[e for c in result['core_cards'] for e in c['evidence']]
    pairs += [{'a':c['evidence']['a'],'b':c['evidence']['b']} for c in result['single_note_cards']]
    complete=[p for p in pairs if p['a'] is not None and p['b'] is not None]
    if not pairs:summary='아직 두 사람이 함께 공유한 문항이 없어요. 서로 보여줄 장면을 고르면 그 답끼리만 비교할 수 있어요.'
    elif complete and all(p['a']==p['b']==3 for p in complete) and len(complete)==len(pairs):
        summary='함께 공유한 문항에서 두 사람 모두 ‘동의도 반대도 하지 않는다’를 골랐어요. 답을 고른 이유까지 같다는 뜻은 아니에요.'
    elif complete and all(p['a']==p['b'] for p in complete) and len(complete)==len(pairs):
        summary='함께 공유한 문항에 같은 답을 골랐어요. 실제로 원하는 선택과 답을 고른 이유도 같은지는 대화로 확인해 주세요.'
    elif complete and all(p['a']==p['b'] for p in complete):
        summary='두 답이 모두 있는 문항에서는 같은 답을 골랐어요. 답이 비어 있는 문항은 비교하지 않았어요. 같은 답도 이유가 같다는 뜻은 아니에요.'
    elif not complete:summary='함께 공유한 문항에 비교할 두 답이 아직 갖춰지지 않았어요. 비어 있는 답은 점수로 채우지 않아요.'
    else:summary='서로 공유하고 두 답이 모두 있는 장면을 비교했어요. 차이가 있는 장면에서 각자의 이유를 먼저 이야기해 봐요.'
    return {'names':names,'summary':summary,'body':body,'display_order':['names','summary','body'] if names else ['summary','body'],
            'human_validation_completed':False}
