// One request at a time; delays start after completion, including slow failures.
export function serialPoll(run:()=>Promise<boolean>,schedule:(fn:()=>void,ms:number)=>any=setTimeout,cancel:(id:any)=>void=clearTimeout){
 let stopped=false,timer:any,failures=0;
 const tick=async()=>{
  if(stopped)return;
  let ok=false;try{ok=await run();}catch{}
  if(stopped)return;
  failures=ok?0:Math.min(failures+1,3);
  timer=schedule(()=>{void tick();},ok?5000:Math.min(30000,5000*2**failures));
 };
 void tick();return ()=>{stopped=true;cancel(timer);};
}
