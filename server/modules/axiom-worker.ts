import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type Result={as_of_ms:number;source_files:number;minute_days:number;symbols:string[];invalid_records:number;records:Record<string,number>;evidence_id:string;paper_authorized:false};
export function createAxiomWorker(dataDir:string,stateDir:string){
 const executable=fileURLToPath(new URL("../../axiom-worker/axiom-worker.exe",import.meta.url));
 let child:ChildProcess|null=null,last:Result|null=null,error="",started=0,finished=0;
 let deadline:ReturnType<typeof setTimeout>|null=null;
 function status(){return {available:existsSync(executable),running:child!==null,last,error,started,finished};}
 function scan(){
  if(child)return status();
  if(!existsSync(executable)){error="Worker Python empacotado indisponível.";return status();}
  mkdirSync(stateDir,{recursive:true});
  error="";started=Date.now();
  const env:NodeJS.ProcessEnv={};
  for(const k of ["SystemRoot","WINDIR","PATH","TEMP","TMP","USERPROFILE","LOCALAPPDATA","APPDATA","PROGRAMDATA","COMSPEC","TZ"]){if(process.env[k])env[k]=process.env[k];}
  env.PYTHONUTF8="1";env.OMP_NUM_THREADS="2";env.OPENBLAS_NUM_THREADS="2";
  const p=spawn(executable,["--data",dataDir,"--state",stateDir,"scan"],{windowsHide:true,stdio:["ignore","pipe","pipe"],env});
  child=p;let buffer="",failed=false;
  function fail(reason:string){failed=true;error=reason;}
  p.stdout?.setEncoding("utf8");p.stdout?.on("data",(s:string)=>{if(buffer.length+s.length>1024*1024){fail("Resposta do worker excedeu limite.");p.kill();}else buffer+=s;});
  p.stderr?.resume();p.on("error",()=>fail("Não foi possível iniciar o worker."));
  deadline=setTimeout(()=>{fail("Tempo limite de análise excedido.");p.kill();},180000);deadline.unref();
  p.on("close",code=>{
   if(deadline)clearTimeout(deadline);deadline=null;child=null;finished=Date.now();
   if(failed)return;
   if(code!==0){error="Análise de qualidade falhou (código "+code+").";return;}
   try{const x=JSON.parse(buffer) as Result;if(x.paper_authorized!==false||!Number.isFinite(x.as_of_ms)||!Array.isArray(x.symbols)||typeof x.evidence_id!=="string"||!Number.isInteger(x.minute_days))throw Error();last=x;}
   catch{error="Resposta inválida do worker.";}
  });
  return status();
 }
 function stop(){if(deadline)clearTimeout(deadline);deadline=null;child?.kill();}
 return {status,scan,stop};
}
