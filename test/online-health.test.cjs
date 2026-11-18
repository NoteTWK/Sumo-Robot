'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const fs = require('node:fs');

function fixture(dnsStatus=0, healthProbe='expected') {
  const calls=[];
  const context=vm.createContext({module:{exports:{}},URL,AbortSignal,
    require:name=>name==='node:https'?{get:(input,options,callback)=>{
      const url=new URL(input);calls.push({url,options});
      const request=new EventEmitter();request.destroy=()=>request.emit('error',Error('closed'));
      queueMicrotask(()=>{
        if(calls.length===1)return request.emit('error',Error('ENOTFOUND'));
        if(options.lookup){
          options.lookup(url.hostname,{all:true},(error,result)=>{
            assert.equal(error,null);assert.equal(result[0].address,'104.16.230.132');
          });
        }
        const body=url.hostname==='dns.google'||url.hostname==='cloudflare-dns.com'?
          {Status:dnsStatus,Answer:dnsStatus===0?[{type:1,data:'104.16.230.132'}]:[]}:
          {service:'robot-sumo',probe:healthProbe};
        const response=new EventEmitter();response.statusCode=200;callback(response);
        response.emit('data',JSON.stringify(body));response.emit('end');
      });
      return request;
    }}:require(name)
  });
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../online-health.cjs'),'utf8'),context);
  return {calls,check:context.module.exports.checkPublicLink};
}
test('host DNS negative cache can recover using public DNS without disabling TLS verification',async()=>{
  const f=fixture();assert.equal(await f.check('https://game.trycloudflare.com','expected'),true);
  assert.equal(f.calls.length,4);
  assert.equal(f.calls.at(-1).url.hostname,'game.trycloudflare.com');
  assert.notEqual(f.calls.at(-1).options.rejectUnauthorized,false);
});
test('a deleted domain is unavailable rather than reusing a stale IP',async()=>{
  const f=fixture(3);assert.equal(await f.check('https://game.trycloudflare.com','expected'),false);
  assert.equal(f.calls.length,3);
});
test('a working public route must return the current game proof',async()=>{
  const f=fixture(0,'another-game');assert.equal(await f.check('https://game.trycloudflare.com','expected'),false);
});
