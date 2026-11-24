import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Real local crypto/HTTP measurement. Database and generated-app evidence is separate.
const moduleUrl = pathToFileURL(
  resolve('packages/auth-runtime/dist/password.js'),
).href;
const childSource = `
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {performance} from 'node:perf_hooks';
import {ArgonPasswords} from ${JSON.stringify(moduleUrl)};
const policy=JSON.parse(process.argv[1]);
const passwords=await ArgonPasswords.create(policy);
const stored=await passwords.hash('Private native pressure fixture password');
const server=createServer((_req,res)=>{res.setHeader('content-type','application/json');res.end('{"status":"alive"}');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
const health=[];let peakRss=process.memoryUsage().rss;
const sampler=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},5);
try{
 const jobs=Array.from({length:8},(_,index)=>index%2===0?passwords.verify(stored,'Private native pressure fixture password'):passwords.verifyDummy('Unknown-account pressure fixture password'));
 const probes=Array.from({length:12},async()=>{const start=performance.now();const response=await fetch('http://127.0.0.1:'+port+'/health');assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'alive'});health.push(performance.now()-start);});
 const outcomes=await Promise.allSettled(jobs);await Promise.all(probes);
 const accepted=outcomes.filter(row=>row.status==='fulfilled').length;
 const capacity=outcomes.filter(row=>row.status==='rejected'&&row.reason?.code==='HASH_CAPACITY').length;
 assert.equal(accepted,2);assert.equal(capacity,6);assert.equal(outcomes[0].status,'fulfilled');assert.equal(outcomes[0].value,true);
 peakRss=Math.max(peakRss,process.memoryUsage().rss,process.resourceUsage().maxRSS*1024);
 assert.ok(peakRss<256*1024*1024,'PER_PROCESS_NATIVE_RSS_BUDGET');
 assert.ok(Math.max(...health)<2000,'LOCAL_HEALTH_SAMPLE_BUDGET');
 process.stdout.write(JSON.stringify({accepted,capacity,peakRss,healthPeakMs:Math.round(Math.max(...health)),healthSamples:health.length,policy:passwords.policy,measuredStartupHashMs:Math.round(passwords.measuredHashMs)}));
}finally{clearInterval(sampler);await new Promise(resolve=>server.close(resolve));}
`;
function peer(
  policy: Record<string, number>,
): Promise<Record<string, unknown>> {
  return new Promise((accept, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--max-old-space-size=128',
        '--input-type=module',
        '-e',
        childSource,
        JSON.stringify(policy),
      ],
      {
        env: { PATH: process.env.PATH, LANG: 'C' },
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    let output = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
    }, 30000);
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 16384) child.kill('SIGKILL');
    });
    child.once('error', () => {
      clearTimeout(timeout);
      reject(new Error('NATIVE_CRYPTO_PEER_START_FAILED'));
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error('NATIVE_CRYPTO_PRESSURE_ASSERTION_FAILED'));
        return;
      }
      try {
        accept(JSON.parse(output) as Record<string, unknown>);
      } catch {
        reject(new Error('INVALID_NATIVE_PRESSURE_RESULT'));
      }
    });
  });
}
const results: Record<string, unknown>[] = [];
const policies: Record<string, number>[] = [
  {},
  { memoryCostKiB: 65536, timeCost: 5 },
];
for (const policy of policies) {
  const peers = await Promise.all([peer(policy), peer(policy)]);
  const aggregatePeakRss = peers.reduce(
    (total, row) => total + Number(row.peakRss),
    0,
  );
  assert.ok(aggregatePeakRss < 512 * 1024 * 1024);
  results.push({
    policy: Object.keys(policy).length ? 'maximum-reviewed-cost' : 'default',
    peers,
    aggregatePeakRss,
  });
}
const directory = resolve('var/cli-evidence/auth-pressure');
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(
  resolve(directory, 'results.json'),
  JSON.stringify(
    {
      scope:
        'two real native crypto processes and local HTTP event-loop probes; no generated API or database simulation',
      results,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
for (const row of results)
  process.stdout.write(
    JSON.stringify({
      policy: row.policy,
      aggregatePeakMiB: Math.ceil(Number(row.aggregatePeakRss) / 1024 / 1024),
      status: 'passed',
    }) + '\n',
  );
