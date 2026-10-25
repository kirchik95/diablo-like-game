import { performance } from 'node:perf_hooks';
import { crowdFixture, crowdControls } from './crowd-fixture.js';
import { updateGame } from '../src/game.js';
const rows = [];
for (const count of [20,40,60]) {
 const g=crowdFixture(count), times=[];
 for(let i=0;i<3000;i++) {
  const input=crowdControls(g), t=performance.now(); updateGame(g,input,1/120);
  if(i>=600) times.push(performance.now()-t); g.events.length=0;
 }
 times.sort((a,b)=>a-b);
 rows.push({count,steps:times.length,mean:times.reduce((a,b)=>a+b,0)/times.length,p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],awake:g.enemies.filter(e=>e.active&&e.hp>0).length});
}
console.log(JSON.stringify(rows,null,2));
