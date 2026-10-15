"""설계 검증용 참조 계산기. 앱에 연결하거나 사용자 데이터를 전송하지 않는다."""
from pathlib import Path
import hashlib
import json

BASE=Path(__file__).resolve().parents[1]
CONTRACT=json.loads((BASE/'design-contract.json').read_text(encoding='utf-8'))
BANK=json.loads((BASE/CONTRACT['source_bank']).read_text(encoding='utf-8'))
FORM={
    'version':BANK['version'],'instructions':BANK['instructions'],
    'response_scale':BANK['response_scale'],'missing_responses':BANK['missing_responses'],
    'items':[{'id':i['id'],'display_number':i['display_number'],'context':i['context'],'statement':i['statement']} for i in BANK['items']]
}
FINGERPRINT=hashlib.sha256(json.dumps(FORM,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')).hexdigest()
if CONTRACT.get('questionnaire_version')!=BANK['version']:raise ValueError('scoring_questionnaire_version_mismatch')
if CONTRACT.get('source_questionnaire_fingerprint')!=FINGERPRINT:raise ValueError('scoring_questionnaire_fingerprint_mismatch')
ITEMS={i['id']:i for i in BANK['items']}
CRITERIA={c['id']:c for c in BANK['criteria']}
NOTES={n['id']:n for n in BANK['single_notes']}
MISSING_REASONS=set(BANK['missing_responses']['reasons'])|{'not_answered'}

def validate_submission(submission):
    if not isinstance(submission,dict):raise ValueError('invalid_submission')
    if submission.get('questionnaire_version')!=BANK['version']:
        raise ValueError('questionnaire_version_mismatch')
    if submission.get('questionnaire_fingerprint')!=FINGERPRINT:
        raise ValueError('questionnaire_fingerprint_mismatch')
    answers=submission.get('answers')
    if not isinstance(answers,dict) or set(answers)!=set(ITEMS):
        raise ValueError('answer_item_ids_mismatch')
    for value in answers.values():
        if value is not None and (type(value) is not int or not 1<=value<=5):
            raise ValueError('invalid_response')
    reasons=submission.get('missing_reasons',{})
    if not isinstance(reasons,dict):raise ValueError('invalid_missing_reasons')
    for item_id,reason in reasons.items():
        if item_id not in ITEMS or answers[item_id] is not None or type(reason) is not str or reason not in MISSING_REASONS:
            raise ValueError('invalid_missing_reason')
    share_ids=submission.get('share_item_ids',[])
    if not isinstance(share_ids,list) or any(type(i) is not str or i not in ITEMS for i in share_ids) or len(share_ids)!=len(set(share_ids)):
        raise ValueError('invalid_share_scope')
    if type(submission.get('share_alias',False)) is not bool:
        raise ValueError('invalid_alias_consent')
    if type(submission.get('allow_couple_comparison',False)) is not bool:
        raise ValueError('invalid_comparison_consent')
    return answers

def item_band(value):
    if value is None:return 'M'
    if value>=4:return 'H'
    if value<=2:return 'L'
    return 'U'

def criterion_stats(values):
    completed=sum(v is not None for v in values)
    if completed!=3:
        return {'ratings':values,'answered':completed,'sum':None,'mean':None,'display_mean':None,'state':'M'}
    bands={item_band(v) for v in values}
    state='H' if bands=={'H'} else 'L' if bands=={'L'} else 'X' if {'H','L'}<=bands else 'U'
    return {'ratings':values,'answered':3,'sum':sum(values),'mean':sum(values)/3,'display_mean':round(sum(values)/3,1),'state':state}

def select_alias_component(profile,block,labels):
    tags=[{'criterion':c,'label':labels[c]} for c in block if profile[c]['state']=='H']
    output={'criterion':None,'label':None,'reason':None,'supported_tags':tags}
    states=[profile[c]['state'] for c in block]
    if 'M' in states:output['reason']='missing_in_block';return output
    if 'X' in states:output['reason']='scene_variation_in_block';return output
    if all(s=='H' for s in states):output['reason']='all_supported';return output
    if not tags:output['reason']='no_repeated_support';return output
    top_sum=max(profile[c]['sum'] for c in block)
    winners=[c for c in block if profile[c]['sum']==top_sum]
    if len(winners)!=1:output['reason']='top_tie';return output
    winner=winners[0]
    if profile[winner]['state']!='H':output['reason']='top_not_repeated_support';return output
    runner_up=max(profile[c]['sum'] for c in block if c!=winner)
    if top_sum-runner_up<CONTRACT['alias_rules']['minimum_sum_gap_to_runner_up']:
        output['reason']='small_gap';return output
    output.update({'criterion':winner,'label':labels[winner],'reason':'assigned'})
    return output

def evaluate(submission):
    answers=validate_submission(submission)
    profile={c:criterion_stats([answers[i] for i in data['item_ids']]) for c,data in CRITERIA.items()}
    adjective=select_alias_component(profile,CONTRACT['adjective_block'],CONTRACT['adjective_candidates'])
    animal=select_alias_component(profile,CONTRACT['animal_block'],CONTRACT['animal_candidates'])
    full=adjective['label'] is not None and animal['label'] is not None
    alias={'name':adjective['label']+' '+animal['label'] if full else None,
           'id':adjective['criterion']+'_'+animal['criterion'] if full else None,
           'adjective':adjective,'animal':animal,'status':'full' if full else 'partial' if adjective['label'] or animal['label'] else 'profile_only'}
    notes={n:{'value':answers[n],'band':item_band(answers[n]),'default_public':False} for n in NOTES}
    return {'questionnaire_version':BANK['version'],'scoring_version':CONTRACT['version'],
            'questionnaire_fingerprint':FINGERPRINT,'profile':profile,'single_notes':notes,'alias':alias,
            'human_validation_completed':False}

def public_case(case):
    return {key:case[key] for key in ('summary','good_point','caution','conversation','action') if key in case}

def select_case(cases,a_state,b_state):
    matches=[c for c in cases if c['a_state']==a_state and c['b_state']==b_state]
    if len(matches)!=1:raise ValueError('copy_case_not_unique')
    return public_case(matches[0])

def compare(submission_a,submission_b):
    # 서로 다른 문항/안내/척도는 단지 숫자가 같다고 비교하지 않는다.
    answers_a=validate_submission(submission_a)
    answers_b=validate_submission(submission_b)
    shared=set(submission_a.get('share_item_ids',[]))&set(submission_b.get('share_item_ids',[]))
    catalog=json.loads((BASE/'couple-catalog.json').read_text(encoding='utf-8'))
    if catalog['version']!=CONTRACT['version']:raise ValueError('copy_version_mismatch')
    if catalog.get('questionnaire_version')!=BANK['version']:raise ValueError('copy_questionnaire_version_mismatch')
    if catalog.get('questionnaire_fingerprint')!=FINGERPRINT:raise ValueError('copy_questionnaire_fingerprint_mismatch')
    if not (submission_a.get('allow_couple_comparison',False) and submission_b.get('allow_couple_comparison',False)):
        return {'questionnaire_version':BANK['version'],'scoring_version':CONTRACT['version'],
            'status':'no_comparison_consent','copy':public_case(catalog['overrides']['no_comparison_consent']),
            'aliases':None,'core_cards':[],'single_note_cards':[],'compatibility_score':None,
            'shared_item_ids':[],'joint_decision_confirmed':False}
    core_copy={c['id']:c for c in catalog['criteria']}
    note_copy={c['id']:c for c in catalog['single_notes']}
    core_cards=[];note_cards=[]
    threshold=CONTRACT['couple_rules']['minimum_item_gap_for_discussion']
    for cid,c in CRITERIA.items():
        shared_ids=[i for i in c['item_ids'] if i in shared]
        if not shared_ids:continue
        pairs=[]
        for item_id in shared_ids:
            a=answers_a[item_id];b=answers_b[item_id]
            gap=abs(a-b) if a is not None and b is not None else None
            pairs.append({'item_id':item_id,'display_number':ITEMS[item_id]['display_number'],
                'context':ITEMS[item_id]['context'],'statement':ITEMS[item_id]['statement'],'a':a,'b':b,
                'a_band':item_band(a),'b_band':item_band(b),'gap':gap,
                'discussion_candidate':gap is not None and gap>=threshold})
        card={'criterion':cid,'label':c['label'],'evidence':pairs,'a_mean':None,'b_mean':None,
              'a_state':None,'b_state':None,'status':None,'copy':None}
        if len(shared_ids)!=3:
            card['status']='partial_shared_scope';card['copy']=public_case(catalog['overrides']['unshared'])
        else:
            a_stats=criterion_stats([answers_a[i] for i in c['item_ids']])
            b_stats=criterion_stats([answers_b[i] for i in c['item_ids']])
            if a_stats['state']=='M' or b_stats['state']=='M':
                card['status']='missing';card['copy']=public_case(catalog['overrides']['M'])
            else:
                card.update({'a_mean':a_stats['display_mean'],'b_mean':b_stats['display_mean'],
                    'a_state':a_stats['state'],'b_state':b_stats['state']})
                if a_stats['state']=='X' or b_stats['state']=='X':
                    card['status']='scene_variation';card['copy']=public_case(catalog['overrides']['X'])
                else:
                    card['status']='complete';card['copy']=select_case(core_copy[cid]['cases'],a_stats['state'],b_stats['state'])
        card['discussion_item_ids']=[p['item_id'] for p in pairs if p['discussion_candidate']]
        card['equal_answer_item_ids']=[p['item_id'] for p in pairs if p['a'] is not None and p['a']==p['b']]
        core_cards.append(card)
    for item_id,n in NOTES.items():
        if item_id not in shared:continue
        a=answers_a[item_id];b=answers_b[item_id]
        band_a=item_band(a);band_b=item_band(b)
        gap=abs(a-b) if a is not None and b is not None else None
        note_cards.append({'id':item_id,'label':n['label'],'evidence':{'item_id':item_id,
            'display_number':ITEMS[item_id]['display_number'],'context':ITEMS[item_id]['context'],'statement':ITEMS[item_id]['statement'],'a':a,'b':b},
            'gap':gap,'discussion_candidate':gap is not None and gap>=threshold,
            'status':'missing' if 'M' in (band_a,band_b) else 'complete',
            'copy':public_case(catalog['overrides']['M']) if 'M' in (band_a,band_b) else select_case(note_copy[item_id]['cases'],band_a,band_b)})
    aliases=None
    if submission_a.get('share_alias',False) and submission_b.get('share_alias',False):
        ea=evaluate(submission_a)['alias'];eb=evaluate(submission_b)['alias']
        # 공개 허용된 이름만 전달하며 근거가 비공개인 점수·태그는 공유 결과에 넣지 않는다.
        aliases={'a':{'name':ea['name'],'id':ea['id'],'status':ea['status']},
                 'b':{'name':eb['name'],'id':eb['id'],'status':eb['status']}}
    return {'questionnaire_version':BANK['version'],'scoring_version':CONTRACT['version'],
            'aliases':aliases,'core_cards':core_cards,'single_note_cards':note_cards,
            'compatibility_score':None,'shared_item_ids':[i for i in ITEMS if i in shared],
            'joint_decision_confirmed':False}
