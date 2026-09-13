import type {Trade, Rules} from './engine';

// Replay all known lots, then select realizations by sale time. Window-only
// buys would lose the cost basis of positions opened before the window.
export function walletPeriod(trades: Trade[], r: Rules, now: number, days: number, expenses: {at:number;sol:number}[] = []) {
  const since = now - days * 86400000;
  let profit = -expenses.filter(e=>e.at>since&&e.at<=now).reduce((sum,e)=>sum+e.sol,0), unknown = false;
  const evidence: {ca:string; multiple:number; profit:number; lastSaleAt:number}[] = [];
  const unknownAssets:string[]=[];
  for (const [ca, rows] of Map.groupBy(trades.filter(t => t.at <= now), t => t.ca)) {
    const tx = rows.map(t=>({...t,sol:(t.currency??'SOL')==='SOL'?t.sol:(t.accountingSol??NaN)})).sort((a,b) => a.at-b.at || a.id.localeCompare(b.id));
    const lots: {qty:number; cost:number; at:number}[] = [];
    let invalid = false, bought = 0, first = Infinity, grad = 0;
    let proceeds = 0, cost = 0, lastSaleAt = 0, affected = false;
    for (const t of tx) {
      if (t.side === 'transfer' || t.complete === false || !Number.isFinite(t.sol) || t.quantity <= 0) invalid = true;
      if (t.side === 'buy') {
        lots.push({qty:t.quantity, cost:t.sol, at:t.at}); bought += t.quantity;
        if (t.at < first) {first=t.at; grad=t.graduatedAt;}
      } else if (t.side === 'sell') {
        let q = t.quantity, matchedCost = 0;
        while (q > 1e-9 && lots.length) {
          const lot = lots[0], take = Math.min(q, lot.qty), basis = lot.cost*take/lot.qty;
          matchedCost += basis;
          lot.qty -= take; lot.cost -= basis; q -= take;
          if (lot.qty <= 1e-9) lots.shift();
        }
        if (q > 1e-6) invalid = true;
        if (t.at > since) {
          if(invalid) affected=true;
          else {proceeds += t.sol; cost += matchedCost; lastSaleAt=t.at;}
        }
      }
    }
    if(affected){unknown=true;unknownAssets.push(ca);}
    profit += proceeds-cost;
    const multiple = cost > 0 ? proceeds/cost : 0;
    if (!invalid && lastSaleAt && grad > 0 && first <= grad+r.earlyMinutes*60000 && cost >= r.minInvestSol && multiple >= r.bigWinMultiple && bought > 0) {
      evidence.push({ca,multiple,profit:proceeds-cost,lastSaleAt});
    }
  }
  return {profit:unknown?null:profit, knownProfit:profit, unknownAssets, evidence, unknown};
}
