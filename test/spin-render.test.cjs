'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function renderer() {
  const context = vm.createContext({window:{}});
  const source = fs.readFileSync(path.join(__dirname,'../public/render.js'),'utf8')
    .replace('window.SumoRender = {',
      'window.renderTest = {model,riggedMesh,partTransforms}; window.SumoRender = {');
  vm.runInContext(source,context);
  return context.window.renderTest;
}

test('Spin Ring blades progressively match their gameplay reach using one cached mesh',()=>{
  const render = renderer();
  const mesh = render.riggedMesh('spin','spin-charge');
  assert.equal(mesh,render.riggedMesh('spin','spin-blade'));
  assert.equal(mesh,render.riggedMesh('spin','spin-charge'));
  for(const charge of [0,.25,.5,.75,1]){
    const transforms = render.partTransforms('spin-charge',charge,charge);
    let radius = 0;
    for(const face of mesh){
      if(!face.part?.startsWith('blade-'))continue;
      const pose = transforms[face.part];
      for(const point of face.points){
        const [x,y] = pose(point,true);
        radius = Math.max(radius,Math.hypot(x,y)*1.08);
      }
      assert.deepEqual([...pose(face.normal,false)],[...face.normal],
        'translation changes points without changing normal vectors');
    }
    assert.ok(Math.abs(radius-(.7+.2*charge))<1e-9,
      'rendered blade reach matches charge '+charge);
  }
});

test('Spin Ring blade attachments leave other robot meshes unchanged',()=>{
  const render = renderer();
  for(const robot of ['wedge','iron','lightning','grapple','flip']){
    assert.equal(render.riggedMesh(robot,'spin-charge'),render.model(robot));
    assert.equal(render.riggedMesh(robot,'spin-blade'),render.model(robot));
  }
  assert.equal(render.riggedMesh('spin','spin-ult'),render.model('spin'),
    'ultimate keeps its existing mesh');
  assert.equal(render.riggedMesh('spin',null),render.model('spin'));
});
