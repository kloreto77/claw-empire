// AXIOM V1: causal feature preparation and uncertainty primitives. No trade authorization.
const MINUTE=60_000;
const BANDS=[2.5,7.5,17.5,37.5]; // midpoint approximation for the four recorded depth bins
export type Sample={mid:number;spread_bps:number;bids:number[];asks:number[];imbalance:number;entropy_bid:number|null;entropy_ask:number|null;flow:number};
export type Minute={end:number;mid:number;logReturn:number|null;realizedVol:number;spread:number;bids:number[];asks:number[];imbalance:number;entropyBid:number|null;entropyAsk:number|null;flow:number};
function finite(x:number){return Number.isFinite(x);}
function valid(s:Sample){return finite(s.mid)&&s.mid>0&&finite(s.spread_bps)&&s.spread_bps>=0&&finite(s.imbalance)&&finite(s.flow)&&[s.entropy_bid,s.entropy_ask].every(x=>x===null||finite(x))&&[s.bids,s.asks].every(a=>a.length===4&&a.every(x=>finite(x)&&x>=0));}
const mean=(a:number[])=>a.reduce((s,v)=>s+v,0)/a.length;
const nullableMean=(a:(number|null)[])=>a.every(x=>x!==null)?mean(a as number[]):null;
function mass(a:number[]){return a.reduce((s,v)=>s+v,0);}
export function groupedW1(a:number[],b:number[]):number|null{
 if(a.length!==4||b.length!==4||[...a,...b].some(x=>!finite(x)||x<0))return null;
 const ma=mass(a),mb=mass(b);if(!(ma>0&&mb>0))return null;
 let cumulative=0,w=0;
 for(let i=0;i<3;i++){cumulative+=a[i]/ma-b[i]/mb;w+=Math.abs(cumulative)*(BANDS[i+1]-BANDS[i]);}
 return w;
}
export function robustZ(value:number,past:number[],floor?:number):number|null{
 if(!finite(value)||past.length<1440||past.some(x=>!finite(x)))return null;
 const median=(x:number[])=>{const s=[...x].sort((a,b)=>a-b);return (s[Math.floor((s.length-1)/2)]+s[Math.floor(s.length/2)])/2;};
 const m=median(past),mad=1.4826*median(past.map(x=>Math.abs(x-m)));
 const scale=Math.max(mad,floor&&finite(floor)&&floor>0?floor:0);return scale>0?(value-m)/scale:null;
}
type Liquidity={w1Bid:number;w1Ask:number;massBid:number;massAsk:number;referenceMassBid:number;referenceMassAsk:number};
type State={bucket:number;samples:Map<number,Sample>;history:Minute[]};
export class MinuteFeatures{
 private bySymbol=new Map<string,State>();
 reset(){this.bySymbol.clear();}
 push(symbol:string,ts:number,sample:Sample){
  if(!Number.isSafeInteger(ts)||ts<0||!valid(sample))return null;
  const bucket=Math.floor(ts/MINUTE)*MINUTE,sec=Math.floor(ts/1000)%60;
  let state=this.bySymbol.get(symbol);if(!state){state={bucket,samples:new Map(),history:[]};this.bySymbol.set(symbol,state);}
  if(bucket<state.bucket)return null;
  let output:null|{minute:Minute;liquidity:null|{w1Bid:number;w1Ask:number;massBid:number;massAsk:number;referenceMassBid:number;referenceMassAsk:number}}=null;
  if(bucket>state.bucket){
   const rows=Array.from({length:60},(_,i)=>state!.samples.get(i));
   if(bucket===state.bucket+MINUTE&&rows.every(x=>x!==undefined)){
    const s=rows as Sample[],end=state.bucket+MINUTE,prev=state.history.at(-1);
    if(prev&&prev.end!==end-MINUTE)state.history=[];
    const previous=state.history.at(-1),mid=s[59].mid;
    const returns=s.slice(1).map((x,i)=>Math.log(x.mid/s[i].mid));
    if(previous)returns.unshift(Math.log(s[0].mid/previous.mid));
    const minute:Minute={end,mid,logReturn:previous?Math.log(mid/previous.mid):null,realizedVol:Math.sqrt(returns.reduce((a,r)=>a+r*r,0)),spread:mean(s.map(x=>x.spread_bps)),bids:BANDS.map((_,i)=>mean(s.map(x=>x.bids[i]))),asks:BANDS.map((_,i)=>mean(s.map(x=>x.asks[i]))),imbalance:mean(s.map(x=>x.imbalance)),entropyBid:nullableMean(s.map(x=>x.entropy_bid)),entropyAsk:nullableMean(s.map(x=>x.entropy_ask)),flow:s.reduce((a,x)=>a+x.flow,0)};
    state.history.push(minute);if(state.history.length>65)state.history.shift();
    let liquidity:Liquidity|null=null;
    if(state.history.length===65){
     const reference=state.history.slice(0,60),recent=state.history.slice(60);
     const average=(r:Minute[],side:"bids"|"asks")=>BANDS.map((_,i)=>mean(r.map(x=>x[side][i])));
     const rb=average(recent,"bids"),ra=average(recent,"asks"),pb=average(reference,"bids"),pa=average(reference,"asks");
     const w1Bid=groupedW1(rb,pb),w1Ask=groupedW1(ra,pa);
     if(w1Bid!==null&&w1Ask!==null)liquidity={w1Bid,w1Ask,massBid:mass(rb),massAsk:mass(ra),referenceMassBid:mass(pb),referenceMassAsk:mass(pa)};
    }
    output={minute,liquidity};
   }else state.history=[];
   state.bucket=bucket;state.samples.clear();
  }
  // One sample per receive-time second. Duplicates cannot overwrite evidence.
  if(!state.samples.has(sec))state.samples.set(sec,sample);
  return output;
 }
}
export type Interval={id:string;issuedAt:number;maturesAt:number;low:number;high:number;expandedLow:number;expandedHigh:number;alpha:number};
export class AdaptiveConformal{
 private alpha=.1;
 private scores:number[]=[];
 private errors:number[]=[];
 private pending=new Map<string,Interval>();
 private lastMaturity=-1;
 private lastObserved=-1;
 // One instance per horizon and regime. The caller must persist/restore it and
 // certify out-of-sample coverage and effective sample size before any entry.
 issue(id:string,issuedAt:number,maturesAt:number,low:number,high:number):Interval|null{
  if(!id||!Number.isSafeInteger(issuedAt)||!Number.isSafeInteger(maturesAt)||maturesAt<=issuedAt||issuedAt<this.lastObserved||!finite(low)||!finite(high)||low>high||this.pending.has(id))throw Error("previsão inválida");
  if(this.pending.size>=10000)throw Error("fila conformal cheia");
  const n=this.scores.length,index=Math.ceil((n+1)*(1-this.alpha));
  if(n<200||index>n)return null;
  const s=[...this.scores].sort((a,b)=>a-b)[index-1],out={id,issuedAt,maturesAt,low,high,expandedLow:low-s,expandedHigh:high+s,alpha:this.alpha};
  this.pending.set(id,out);return {...out};
 }
 // Seed only with genuinely matured out-of-sample calibration residuals.
 calibrate(low:number,high:number,y:number,maturesAt:number,observedAt:number){
  if(![low,high,y].every(finite)||low>high||!Number.isSafeInteger(maturesAt)||!Number.isSafeInteger(observedAt)||observedAt<maturesAt||observedAt<this.lastObserved||maturesAt<this.lastMaturity)throw Error("calibração não causal");
  this.lastMaturity=maturesAt;this.lastObserved=observedAt;this.addScore(Math.max(low-y,y-high,0));
 }
 mature(id:string,y:number,observedAt:number){
  const p=this.pending.get(id);
  if(!p||!finite(y)||!Number.isSafeInteger(observedAt)||observedAt<p.maturesAt||observedAt<this.lastObserved||p.maturesAt<this.lastMaturity)throw Error("label ausente, futuro ou fora de ordem");
  this.pending.delete(id);this.lastMaturity=p.maturesAt;this.lastObserved=observedAt;
  this.addScore(Math.max(p.low-y,y-p.high,0));
  const error=Number(y<p.expandedLow||y>p.expandedHigh);
  this.alpha=Math.max(.01,Math.min(.30,this.alpha+.005*(.1-error)));
  this.errors.push(error);if(this.errors.length>200)this.errors.shift();
  return this.status();
 }
 private addScore(score:number){this.scores.push(score);if(this.scores.length>1000)this.scores.shift();}
 status(){const coverage=this.errors.length?1-mean(this.errors):null;return {alpha:this.alpha,scores:this.scores.length,matureForecasts:this.errors.length,coverage,coverageVeto:this.errors.length<200||coverage===null||coverage<.85,pending:this.pending.size};}
}
