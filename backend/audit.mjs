const forbidden=/signedTransaction|secret|private.?key|mnemonic|bearer|authorization|api.?key/i;
export function redact(value){
 if(Array.isArray(value))return value.map(redact);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!forbidden.test(k)).map(([k,v])=>[k,redact(v)]));
 if(typeof value==='string')return value.replace(/([?&](?:api-key|token|key)=)[^&\s]+/gi,'$1[redacted]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]');
 return value;
}
export function tokenStreams(t){return {
 market:{at:t.marketCheckedAt,sourceAt:t.marketAt,fdv:t.fdv,lp:t.lp,priceUsd:t.priceUsd,source:t.marketSource,error:t.marketError},
 holders:{at:t.holdersCheckedAt??t.holdersAt,count:t.holders,sourceAt:t.holdersAt,error:t.holdersError},
 x:{at:t.lastXAt,observation:t.xObservations?.at(-1),status:t.status,reason:t.reason,pauseReason:t.xPauseReason},
 execution:{execution:t.execution,smartBought:t.smartBought,smartHolding:t.smartHolding,smartNew:t.smartNew},
 identity:{createdAt:t.createdAt,graduatedAt:t.graduatedAt,enrolledAt:t.enrolledAt,creator:t.creator,creatorVerified:t.creatorVerified,creationSignature:t.creationSignature,quoteMint:t.quoteMint,quoteSymbol:t.quoteSymbol,quoteName:t.quoteName,quoteCategory:t.quoteCategory,quoteCategoryLabel:t.quoteCategoryLabel,launchMode:t.launchMode,transferFeeBps:t.transferFeeBps,quoteOnlyFees:t.quoteOnlyFees,quoteMetadataMismatch:t.quoteMetadataMismatch,pool:t.pool,symbol:t.symbol,xAccount:t.xAccount},
 };}
