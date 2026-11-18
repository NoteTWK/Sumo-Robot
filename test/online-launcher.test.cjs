'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

async function runOnOccupiedPort(payload) {
  const server = http.createServer((req,res) => {
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify(payload));
  });
  await new Promise(resolve => server.listen(0,'0.0.0.0',resolve));
  try {
    const child=spawn(process.execPath,['online.cjs'],{
      cwd:require('node:path').join(__dirname,'..'),
      env:{...process.env,PORT:String(server.address().port)},stdio:['ignore','pipe','pipe']
    });
    let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
    const [code]=await once(child,'exit');return {code,output};
  } finally { await new Promise(resolve=>server.close(resolve)); }
}
test('launching again reuses an existing online game without starting another tunnel', {timeout:10000},async()=>{
  const result=await runOnOccupiedPort({robots:Array(6).fill({}),arenas:[],session:'existing',links:[{ip:'internet'}]});
  assert.equal(result.code,0);assert.match(result.output,/already running/);
  assert.doesNotMatch(result.output,/Downloading|Connecting to the internet/);
});
test('launcher reports an unrelated program occupying the port', {timeout:10000},async()=>{
  const result=await runOnOccupiedPort({other:true});
  assert.equal(result.code,1);assert.match(result.output,/used by another program/);
});
