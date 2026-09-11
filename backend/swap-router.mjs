import {Cpmm} from './cpmm.mjs';
import {Jupiter,SOL,validateOrder} from './jupiter.mjs';

export class SwapRouter{
 constructor(store,env,rpc,dependencies={}){this.s=store;this.env=env;this.cpmm=dependencies.cpmm??new Cpmm(rpc,env);this.jupiter=dependencies.jupiter??new Jupiter(store,env);this.fallback=env.CPMM_JUPITER_FALLBACK!=='false';}
 status(){return {...this.jupiter.status(),engine:'cpmm',fallbackEnabled:this.fallback&&!!this.env.JUPITER_API_KEY};}
 async order(inputMint,outputMint,amount,side,taker,slippageBps){
  const ca=inputMint===SOL?outputMint:inputMint;
  // Migration proof is retained independently of observation-list cleanup.
  const proof=this.s.get('stonk-verified-migration',ca),position=this.s.get('live-position',ca),token=this.s.get('token',ca);
  const t={...position,...proof,...token,ca};let error;
  try{const q=await this.cpmm.order(t,inputMint,outputMint,amount,taker,slippageBps);validateOrder(q,{inputMint,outputMint,amount,taker:undefined,slippageBps});return q;}catch(e){error=e;}
  if(!this.fallback||!this.env.JUPITER_API_KEY)throw error;
  const q=await this.jupiter.order(inputMint,outputMint,amount,side,taker,slippageBps);
  return {...q,transport:'jupiter',fallbackReason:error.message};
 }
}
