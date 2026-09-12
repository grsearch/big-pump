const text=x=>typeof x==='string'&&x.trim()?x.trim().slice(0,200):null;
export function quoteFields(row){return {
 quoteName:text(row.quote?.name),quoteCategory:text(row.quote?.category),quoteCategoryLabel:text(row.quote?.categoryLabel),
 quoteOnlyFees:typeof row.quoteOnlyFees==='boolean'?row.quoteOnlyFees:null,
 metadataAt:Date.now(),
};}
// API labels describe the chain-verified mint only; never replace its identity.
export function enrichMetadata(c,t={}){
 const mismatch=!!(t.quoteMint&&c.quoteMint&&t.quoteMint!==c.quoteMint);
 const x=c.links?.twitter?.match(/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/)?.[1];
 return {symbol:c.symbol??t.symbol??c.ca.slice(0,5),name:c.name??t.name??'Stonk',
 quoteMint:t.quoteMint??c.quoteMint,quoteSymbol:mismatch?null:c.quoteSymbol??t.quoteSymbol,
 quoteName:mismatch?null:c.quoteName??null,quoteCategory:mismatch?null:c.quoteCategory??null,
 quoteCategoryLabel:mismatch?null:c.quoteCategoryLabel??null,quoteMetadataMismatch:mismatch,
 transferFeeBps:c.transferFeeBps??null,launchMode:['reward','standard'].includes(c.mode)?c.mode:'unknown',
 quoteOnlyFees:typeof c.quoteOnlyFees==='boolean'?c.quoteOnlyFees:null,metadataAt:c.metadataAt??null,
 xAccount:t.xAccount??x??null};
}
