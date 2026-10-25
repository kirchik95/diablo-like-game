// Selection-only audit; the scripted fight controls do not invoke auto-targeting.
import { performance } from 'node:perf_hooks';
import { crowdFixture } from './crowd-fixture.js';
import { autoAimTarget } from '../src/touch.js';
const rows=[];
for(const count of [20,40,60]) {
 const game=crowdFixture(count), options={forward:[0,-1],reach:2.4,contact:2.4};
 for(let i=0;i<1000;i++) autoAimTarget(game.player,game.enemies,options);
 const t=performance.now();
 for(let i=0;i<10000;i++) autoAimTarget(game.player,game.enemies,options);
 rows.push({count,msPerSelection:(performance.now()-t)/10000});
}
console.log(JSON.stringify(rows,null,2));
