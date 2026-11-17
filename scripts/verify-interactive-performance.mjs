import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
const load=createRequire(import.meta.url),root=await fs.realpath(process.cwd()),out=path.join(root,'work/interactive-performance-output');
const baselineFile=path.join(root,'scripts/fixtures/cpu-fifo-baseline.cjs');
assert.equal(createHash('sha256').update(await fs.readFile(baselineFile)).digest('hex'),'0d1d012c84b580cce7c1d57df26eb3a6146c1e7e333771c7eef6a791eeebd7fb');
await fs.mkdir(out);assert.equal(await fs.realpath(out),out);
const baseline=load(baselineFile).createCpuTasks,current=load(path.join(root,'electron/cpu-tasks.cjs')).createCpuTasks;
const width=1024,height=1024,bitmap=Buffer.alloc(width*height*4,255),workers=new Set(),rounds=[];
const report={passed:false,version:JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version,commit:process.env.GITHUB_SHA||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),localDiagnostic:process.env.GITHUB_ACTIONS!=='true',syntheticFixture:true,actualProviderCalls:0,normalApplicationStarted:false,normalProfileAccessed:false,scope:'Three paired measurements of six real Node CPU Worker alpha scans on the same 1024x1024 opaque RGBA input; priority order and native worker lifetime, not a whole-app or 4K performance guarantee',errors:[]};
let deadline, activeAbort, expired = false;
async function measure(label,factory,iteration){
 const controller=new AbortController();activeAbort=controller;const exits=[],order=[];let active=0,maxWorkers=0,peakRss=process.memoryUsage().rss,worstLoopDelayMs=0,last=performance.now();
 const timer=setInterval(()=>{const now=performance.now();worstLoopDelayMs=Math.max(worstLoopDelayMs,now-last-10);last=now;peakRss=Math.max(peakRss,process.memoryUsage().rss);},10);
 const tasks=factory({workerFile:path.join(root,'electron/cpu-worker.cjs'),createWorker:(file,options)=>{const worker=new Worker(file,options);active++;maxWorkers=Math.max(maxWorkers,active);workers.add(worker);exits.push(new Promise(resolve=>worker.once('exit',()=>{active--;workers.delete(worker);resolve();})));return worker;}});
 const start=performance.now(),cpu=process.cpuUsage();let interactiveLatencyMs=0;
 try {
  const jobs=['active','background-1','background-2','background-3','background-4','interactive'].map(id=>tasks.run('image-alpha',{width,height,bitmap},{priority:id==='interactive'?'interactive':'background',signal:controller.signal}).then(value=>{assert.equal(value.transparency,'opaque');order.push(id);if(id==='interactive')interactiveLatencyMs=performance.now()-start;}));
  await Promise.all(jobs);await tasks.drain();await Promise.all(exits);
  const used=process.cpuUsage(cpu),value={label,iteration,order,interactiveLatencyMs,totalMs:performance.now()-start,workerCpuMs:(used.user+used.system)/1000,maxWorkers,peakRss,worstLoopDelayMs:Math.max(0,worstLoopDelayMs)};
  assert.equal(order.indexOf('interactive'),label==='priority'?1:5);if(label==='priority')assert.equal(maxWorkers,1);assert.equal(active,0);return value;
 } finally {clearInterval(timer);controller.abort();await tasks.drain();await Promise.allSettled(exits);activeAbort=undefined;}
}
try {
 deadline=setTimeout(()=>{expired=true;activeAbort?.abort();report.errors.push('CPU priority measurement reached its 60-second deadline');void Promise.allSettled([...workers].map(worker=>worker.terminate())).finally(()=>{process.exitCode=1;});},60000);
 for(let iteration=1;iteration<=3;iteration++){assert.equal(expired,false);rounds.push(await measure('fifo-2.9',baseline,iteration));rounds.push(await measure('priority',current,iteration));}
 const median=label=>rounds.filter(row=>row.label===label).map(row=>row.interactiveLatencyMs).sort((a,b)=>a-b)[1];
 report.measurements=rounds;report.summary={baselineMedianInteractiveMs:median('fifo-2.9'),priorityMedianInteractiveMs:median('priority'),maximumPriorityWorkers:Math.max(...rounds.filter(row=>row.label==='priority').map(row=>row.maxWorkers)),workerThreadsRemaining:workers.size,inputBytes:bitmap.length,iterations:3};
 report.sources={};for(const file of ['scripts/verify-interactive-performance.mjs','scripts/fixtures/cpu-fifo-baseline.cjs','electron/cpu-tasks.cjs','electron/cpu-task-scheduler.cjs','electron/cpu-worker.cjs'])report.sources[file]=createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');
 assert.equal(workers.size,0);assert.equal(expired,false);assert.equal(report.summary.maximumPriorityWorkers,1);report.passed=true;
} catch(error){report.errors.push(String(error.stack||error));process.exitCode=1;}
finally{clearTimeout(deadline);await Promise.allSettled([...workers].map(worker=>worker.terminate()));await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:report.passed,report:path.join(out,'report.json'),summary:report.summary,errors:report.errors}));}
