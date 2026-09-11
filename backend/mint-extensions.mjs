// Quote-asset compatibility concerns ordinary, public transfers only.
export function validateExtensions(extensions, side = 'base') {
  if (!Array.isArray(extensions)) throw Error('扩展数据格式无效');
  const notes=[];
  for(const e of extensions) {
    const name=e?.extension,s=e?.state;
    if(['transferFeeConfig','metadataPointer','tokenMetadata','mintCloseAuthority'].includes(name))continue;
    if(side==='quote') {
      if(name==='defaultAccountState'&&s?.accountState==='initialized')continue;
      if(name==='pausableConfig'&&s?.paused===false){notes.push('计价币可被发行方暂停；本次核验未暂停');continue;}
      if(name==='transferHook'&&s&&s.programId===null)continue;
      if(name==='scaledUiAmountConfig'&&Number(s?.multiplier)===1&&Number(s?.newMultiplier)===1)continue;
      if(name==='permanentDelegate'&&s&&(s.delegate===null||typeof s.delegate==='string'&&s.delegate.length>0)){if(s.delegate)notes.push('计价币存在永久代理权限；模型不估算发行方主动扣划');continue;}
      if(name==='confidentialTransferMint'&&typeof s?.autoApproveNewAccounts==='boolean'){notes.push('仅支持计价币普通公开转账，不模拟保密转账');continue;}
    }
    if(name==='scaledUiAmountConfig')throw Error('显示倍率模型未支持（scaledUiAmountConfig）：当前配置倍率 '+String(s?.multiplier??'未知')+'，下一倍率 '+String(s?.newMultiplier??'未知')+'；需核对行情价格与底层数量口径，不是转账税');
    const detail=name==='pausableConfig'?'（已暂停或状态未知）':name==='transferHook'?'（存在转账钩子或状态未知）':name==='defaultAccountState'?'（新账户非正常可用状态）':'';
    throw Error('不支持的扩展 '+String(name??'未知')+detail);
  }
  return notes;
}
