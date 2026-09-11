import test from 'node:test';
import assert from 'node:assert/strict';
import {mintFee} from '../backend/valuation.mjs';
import {stonkStep,newStonkArm} from '../lib/stonk-shadow.ts';
import {diffusionDefaults} from '../lib/diffusion-shadow.ts';
const extensions=[{extension:'metadataPointer'},{extension:'tokenMetadata'},
  {extension:'permanentDelegate',state:{delegate:'issuer'}},
  {extension:'defaultAccountState',state:{accountState:'initialized'}},
  {extension:'scaledUiAmountConfig',state:{multiplier:'1',newMultiplier:'1'}},
  {extension:'pausableConfig',state:{paused:false}},
  {extension:'confidentialTransferMint',state:{autoApproveNewAccounts:false}},
  {extension:'transferHook',state:{programId:null}}];
const mint=e=>({value:{owner:'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',data:{parsed:{info:{decimals:6,extensions:e}}}}});
test('GLDx public quote transfers allow observed neutral extension states, not base tokens',()=>{
  assert.equal(mintFee(mint(extensions),1032,'quote').bps,0);
  assert.throws(()=>mintFee(mint(extensions),1032),/permanentDelegate/);
});
test('paused, hooked, frozen, scaled, malformed and unknown quote extensions still block',()=>{
  for(const e of [{extension:'pausableConfig',state:{paused:true}},{extension:'pausableConfig'},
    {extension:'transferHook',state:{programId:'active'}},{extension:'defaultAccountState',state:{accountState:'frozen'}},
    {extension:'scaledUiAmountConfig',state:{multiplier:1,newMultiplier:1.1}},{extension:'unknown'}])
    assert.throws(()=>mintFee(mint([e]),1032,'quote'),new RegExp(e.extension));
});
test('GSTONK transfer fee remains 3% with quote compatibility',()=>{
  const fee={epoch:1032,maximumFee:'1000000000000000',transferFeeBasisPoints:300};
  assert.equal(mintFee(mint([{extension:'transferFeeConfig',state:{olderTransferFee:fee,newerTransferFee:fee}}]),1032).bps,300);
});
test('C keeps exact model failure in pending and timeout reason, distinct from pause',()=>{
  const arm=newStonkArm(1000,1000),token={ca:'c',shadowBlocked:'计价币 GLDx：不支持的扩展 pausableConfig'};
  arm.positions.push({ca:'c',status:'pending',signalAt:1000});
  stonkStep(arm,[token],{rules:diffusionDefaults,acceptEntries:true},2000);
  assert.match(arm.positions[0].reason,/计价币 GLDx/);
  stonkStep(arm,[token],{rules:diffusionDefaults,acceptEntries:true},122000);
  assert.match(arm.positions[0].reason,/超过 2 分钟.*pausableConfig/);
  arm.positions[0].status='pending';stonkStep(arm,[token],{rules:diffusionDefaults,acceptEntries:false},122000);
  assert.equal(arm.positions[0].reason,'已暂停新开仓');
});
