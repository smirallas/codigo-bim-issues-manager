/** Cliente HTTP de ensayo fijo: únicamente servido en modo fixtures, sin credenciales. */
export const demoHtml = `<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ensayo MCP · Issues Manager</title>
<style>body{font:17px/1.6 system-ui;background:#f5f2eb;color:#203b3a;margin:0}main{max-width:1050px;margin:40px auto;padding:0 24px}h1{font-size:32px;margin:12px 0}p{max-width:850px}.badge{font-weight:700;color:#80600b}button{font:inherit;background:#145e59;color:white;border:0;padding:12px 24px;border-radius:8px;cursor:pointer}button:disabled{opacity:.6}section{background:white;border:1px solid #d5ded8;border-radius:10px;padding:18px 24px;margin:18px 0}h2{font-size:21px;margin:0 0 8px}pre{font:14px/1.5 monospace;white-space:pre-wrap;overflow-wrap:anywhere;color:#213e39}small{color:#52645c}</style>
<main><div class="badge">DATOS SINTÉTICOS · SIN CONEXIÓN AUTODESK</div>
<h1>De una llamada MCP a una revisión de incidencia</h1>
<p>Este ensayo envía peticiones a <code>/mcp</code> por Streamable HTTP. Descubre once herramientas, consulta un proyecto de ejemplo y prepara una revisión. La ejecución permanece bloqueada. No hay un agente de IA ni una autorización de usuario real en este recorrido.</p>
<button id="run">Ejecutar ensayo MCP</button><p id="status" role="status">Listo para comprobar el transporte.</p><div id="results"></div>
<script>
const button=document.querySelector('#run'),status=document.querySelector('#status'),results=document.querySelector('#results');
let requestId=0;
async function rpc(method,params){
 const response=await fetch('/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:++requestId,method,params})});
 if(!response.ok)throw new Error('HTTP '+response.status);
 const value=await response.json();if(value.error)throw new Error('Error de protocolo: '+value.error.code);return value.result;
}
function card(title,value){const section=document.createElement('section'),h=document.createElement('h2'),pre=document.createElement('pre');h.textContent=title;pre.textContent=JSON.stringify(value,null,2);section.append(h,pre);results.append(section);}
button.addEventListener('click',async()=>{button.disabled=true;results.replaceChildren();status.textContent='Ensayando llamadas HTTP…';try{
 const init=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'browser-fixture-demo',version:'1'}});
 const catalog=await rpc('tools/list',{});card('1. Conexión y catálogo',{protocol:init.protocolVersion,transport:'Streamable HTTP',tools:catalog.tools.map(t=>t.name)});
 const call=async(name,args)=>(await rpc('tools/call',{name,arguments:args})).structuredContent;
 card('2. Hubs de ejemplo',await call('list_hubs',{}));
 card('3. Contexto explícito',await call('get_project_context',{hub_id:'b.demo-hub',project_id:'b.demo-project'}));
 const plan=await call('prepare_issue',{hub_id:'b.demo-hub',project_id:'b.demo-project',request:{operation:'create',title:'Revisar hueco · ensayo MCP',status:'closed',subtype_id:'demo-subtype'}});
 card('4. Preparación sintética, sin escritura Autodesk',plan);
 if(!plan.ok)throw new Error('La preparación no está disponible');
 const review=await call('review_issue_plan',{plan_id:plan.data.id});
 card('5. Recuperar la misma revisión',{mode:review.mode,ok:review.ok,same_id:review.data?.id===plan.data.id,state:review.data?.state,result:review.data?.result});
 card('6. Ejecución bloqueada',await call('execute_issue_plan',{plan_id:plan.data.id}));
 status.textContent='Ensayo completado: HTTP y contratos comprobados con datos sintéticos. Cero escrituras Autodesk.';
 }catch(error){status.textContent='Ensayo detenido: '+error.message;}finally{button.disabled=false;}});
</script></main></html>`;
