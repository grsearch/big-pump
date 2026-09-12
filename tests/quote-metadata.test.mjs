import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteFields,enrichMetadata} from '../backend/stonk-metadata.mjs';
import {validateQuoteMatch} from '../lib/social.ts';
test('quote metadata keeps false and unknown distinct, and never manufactures rewards',()=>{
 const fields=quoteFields({quote:{name:'NVIDIA',category:'stock',categoryLabel:'股票'},quoteOnlyFees:false});
 const result=enrichMetadata({...fields,ca:'coin',quoteMint:'quote',quoteSymbol:'NVDAx',mode:'reward',transferFeeBps:100});
 assert.equal(result.quoteOnlyFees,false);assert.equal(result.quoteCategory,'stock');assert.equal(result.launchMode,'reward');
 assert.equal(result.rewardAmount,undefined);assert.equal(enrichMetadata({ca:'coin'}).transferFeeBps,null);
 assert.equal(quoteFields({quoteOnlyFees:'false'}).quoteOnlyFees,null);
});
test('API enrichment cannot overwrite verified quote mint or label a different asset',()=>{
 const result=enrichMetadata({ca:'coin',quoteMint:'wrong',quoteSymbol:'NVDAx',quoteName:'NVIDIA',quoteCategory:'stock'}, {quoteMint:'verified',xAccount:'owner'});
 assert.equal(result.quoteMint,'verified');assert.equal(result.quoteSymbol,null);assert.equal(result.quoteCategory,null);
 assert.equal(result.quoteMetadataMismatch,true);assert.equal(result.xAccount,'owner');
});
test('quote narrative requires observed evidence and remains unknown for old assessments',()=>{
 const ids=new Set(['post']);assert.equal(validateQuoteMatch(undefined,ids).score,null);
 assert.equal(validateQuoteMatch({score:80,reason:'明确配对讨论',evidenceIds:['post']},ids).score,80);
 for(const evidenceIds of [[],['invented']])assert.throws(()=>validateQuoteMatch({score:80,reason:'test',evidenceIds},ids));
});
