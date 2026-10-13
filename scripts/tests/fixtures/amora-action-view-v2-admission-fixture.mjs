const repo='Kyu-Sung-Cho/wedding-hanbang-web';
const names=['Web Quality','Web Tests (shard 1/4)','Web Tests (shard 2/4)','Web Tests (shard 3/4)',
  'Web Tests (shard 4/4)','Mobile Quality','Vendor Disclosure Quality','Static Release Contracts (Non-Deploy)',
  'Code Quality (breakage signal only — not a release authorization)'];
/** 외부 Git/GitHub command 경계만 합성화한다. 운영 admission으로 쓸 수 없다. */
export function createSyntheticAmoraAdmissionBoundary({commit='a'.repeat(40),checkout='c'.repeat(40),tree='d'.repeat(40)}={}) {
  return async (binary,args)=>{
    if(binary.endsWith('git.exe')) {
      const text=args.join(' ');
      if(text.includes('status --porcelain'))return '';
      if(text.includes('remote get-url origin'))return `https://github.com/${repo}.git`;
      if(text.includes('symbolic-ref --short HEAD'))return 'codex/amora-action-cas-web-20261012';
      if(text.includes('rev-parse HEAD^{tree}'))return tree;
      if(text.includes('rev-parse HEAD'))return commit;
      if(text.includes('ls-remote'))return `${commit}\trefs/heads/codex/amora-action-cas-web-20261012\n`;
    }
    const endpoint=args.find(arg=>arg.startsWith('repos/'));
    if(endpoint===`repos/${repo}/commits/${commit}/check-runs?per_page=100`)return JSON.stringify({total_count:names.length,
      check_runs:names.map((name,index)=>({id:100+index,name,head_sha:commit,status:'completed',conclusion:'success',
        app:{slug:'github-actions'},check_suite:{id:55},details_url:`https://github.com/${repo}/actions/runs/150/job/${100+index}`}))});
    if(endpoint===`repos/${repo}/actions/runs/150`)return JSON.stringify({id:150,name:'CI',path:'.github/workflows/ci.yml',
      head_sha:commit,status:'completed',conclusion:'success',repository:{full_name:repo},head_repository:{full_name:repo},run_attempt:1});
    if(/^repos\/[^/]+\/[^/]+\/actions\/jobs\/\d+\/logs$/.test(endpoint??''))
      return `2026-10-13T00:01:00Z [command]/usr/bin/git log -1 --format=%H\n2026-10-13T00:01:00Z ${checkout}\n`;
    if(endpoint===`repos/${repo}/git/commits/${checkout}`)return JSON.stringify({sha:checkout,tree:{sha:tree}});
    throw new Error('unexpected synthetic read-only command');
  };
}
