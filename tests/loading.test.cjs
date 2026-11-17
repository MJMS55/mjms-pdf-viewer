const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const script = fs.readFileSync('src/views/PDFView.vue', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/let pdfjsPromise[\s\S]*?(?=import \{ generateFilePath)/, 'const loadPdfJs = async () => pdfjsLib\n').replace(/^import .*$/gm, '').replace('export default', 'module.exports =')
function deferred() { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b}); return {promise,resolve,reject} }
function fixture(getDocument) {
 const context={Vue:require('vue'),emit:()=>{},getDavNameSpaces:()=>'',getDavProperties:()=>'',getClient:()=>({stat:async path=>({data:{filename:path}})}),resultToNode:stat=>({id:7,path:stat.filename,source:'https://cloud.test/remote.php/dav'+stat.filename}),loadState:()=>false,URL,setTimeout,clearTimeout,window:{location:{href:'https://cloud.test/files',origin:'https://cloud.test'},removeEventListener(){}},document:{removeEventListener(){}},module:{exports:{}},pdfjsLib:{GlobalWorkerOptions:{},getDocument},generateFilePath:()=>'/worker.mjs',generateUrl:p=>p,fetch:async()=>({ok:true,json:async()=>({enabled:true})})}
 vm.runInNewContext(script,context)
 const component=context.module.exports, events=[]
 const instance={...component.data(),fileList:[],source:'',davPath:'/test.pdf',fileid:7,$refs:{canvas:{getContext:()=>({})}},$nextTick:callback=>Promise.resolve().then(callback),$emit:(...args)=>events.push(args)}
 for(const [name,fn] of Object.entries(component.methods))instance[name]=fn.bind(instance)
 for(const [name,fn] of Object.entries(component.computed))Object.defineProperty(instance,name,{get:()=>fn.call(instance)})
 component.created.call(instance)
 return {instance,events,component,context}
}
function task(renderPromise=Promise.resolve()) {
 const render={promise:renderPromise,cancel(){this.cancelled=true}}
 return {promise:Promise.resolve({numPages:2,getPage:async()=>({getViewport:()=>({width:200,height:300}),render:()=>render})}),destroy(){this.destroyed=true;return Promise.resolve()},render}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve))
test('Viewer loading ends only after first page is rendered',async()=>{
 const rendered=deferred(),pdf=task(rendered.promise),{instance,events}=fixture(()=>pdf)
 const done=instance.loadDocument();await flush()
 assert.deepEqual(events,[['update:loaded',false]])
 assert.equal(instance.busy,true)
 rendered.resolve();await done
 assert.deepEqual(events,[['update:loaded',false],['update:loaded',true]])
 assert.equal(instance.busy,false);assert.equal(instance.pageCount,2)
})
test('Load and rendering failures end the spinner and notify native Viewer',async()=>{
 for(const renderFailure of [false,true]){
  const failure=new Error('Failed PDF'),pdf=renderFailure?task(Promise.reject(failure)):{promise:Promise.reject(failure),destroy(){}}
  const {instance,events}=fixture(()=>pdf);await instance.loadDocument()
  assert.equal(events.at(-2)[0],'update:loaded');assert.equal(events.at(-2)[1],true)
  assert.equal(events.at(-1)[0],'error');assert.equal(instance.busy,false)
 }
})
test('Missing URL reports an error instead of leaving loading active',async()=>{
 const {instance,events}=fixture(()=>{throw new Error('should not load')});instance.davPath='';await instance.loadDocument()
 assert.equal(events.at(-1)[0],'error');assert.equal(instance.busy,false)
})
test('Switching documents ignores stale completion and releases old task',async()=>{
 const old=deferred(),first={promise:old.promise,destroy(){this.destroyed=true}},second=task();let count=0
 const {instance,events}=fixture(()=>++count===1?first:second)
 const stale=instance.loadDocument();await flush();instance.davPath='/second.pdf';await instance.loadDocument()
 old.reject(new Error('cancelled'));await stale
 assert.equal(first.destroyed,true);assert.equal(instance.pageCount,2)
 assert.equal(events.filter(e=>e[0]==='error').length,0)
 assert.equal(events.filter(e=>e[0]==='update:loaded'&&e[1]).length,1)
})
test('Unmount cancels pending rendering without sending stale completion',async()=>{
 const rendered=deferred(),pdf=task(rendered.promise),{instance,component,events}=fixture(()=>pdf)
 const done=instance.loadDocument();await flush();component.beforeDestroy.call(instance)
 rendered.reject(new Error('cancelled'));await done
 assert.equal(pdf.render.cancelled,true);assert.equal(pdf.destroyed,true)
 assert.deepEqual(events,[['update:loaded',false]])
})
test('Source URL is preferred and rapid continuous-page navigation reaches the latest target',async()=>{
 let url;const pdf=task(),{instance}=fixture(options=>{url=options.url;return pdf})
 instance.source='/source.pdf';await instance.loadDocument();assert.equal(new URL(url).pathname,'/source.pdf');assert.ok(new URL(url).searchParams.has('mjmsPdfVersion'))
 const next=instance.nextPage();await instance.prevPage();await next
 assert.equal(instance.pageNum,1);assert.equal(instance.busy,false)
})


test('Reload changes cache key and preserves DAV query and fragment', async () => {
 const requests=[],{instance}=fixture(options=>{requests.push(options);return task()})
 instance.source='/remote.php/dav/files/user/a.pdf?token=secret#page=2'
 await instance.loadDocument();await instance.loadDocument()
 assert.notEqual(requests[0].url,requests[1].url)
 const url=new URL(requests[1].url)
 assert.equal(url.searchParams.get('token'),'secret');assert.equal(url.hash,'#page=2')
 assert.equal(requests[1].httpHeaders['Cache-Control'],'no-cache, no-store')
})
test('Thumbnail navigation selects the target and rejects out-of-range pages',async()=>{
 const {instance}=fixture(()=>task());await instance.loadDocument()
 await instance.goToPage(2);assert.equal(instance.pageNum,2)
 await instance.goToPage(3);assert.equal(instance.pageNum,2)
 await instance.goToPage(0);assert.equal(instance.pageNum,2)
})
test('Thumbnails render every page in order',async()=>{
 const rendered=[],{instance}=fixture(()=>task());instance._pdfDocument=await task().promise
 instance.$refs.thumbnailCanvases=[{getContext:()=>({number:1})},{getContext:()=>({number:2})}]
 instance._pdfDocument.getPage=async()=>({getViewport:({scale})=>({width:200*scale,height:300*scale}),render:({canvasContext})=>{rendered.push(canvasContext.number);return {promise:Promise.resolve(),cancel(){}}}})
 await instance.renderThumbnails(instance._loadId)
 assert.deepEqual(rendered,[1,2]);assert.ok(instance.$refs.thumbnailCanvases[0].width<=120)
})

test('PDF navigation reaches Viewer through intermediate Vue parents',()=>{
 const calls=[],{instance}=fixture(()=>task())
 const host={$options:{name:'Viewer'},hasPrevious:true,hasNext:true,previous(){calls.push('previous')},next(){calls.push('next')}}
 instance.$parent={$options:{name:'NcModal'},$parent:host}
 instance.changePdf(-1);instance.changePdf(1)
 assert.deepEqual(calls,['previous','next'])
 assert.equal(instance.pageNum,1)
})
test('PDF navigation respects boundaries, busy state and standalone mode',()=>{
 const calls=[],{instance}=fixture(()=>task())
 const host={$options:{name:'Viewer'},hasPrevious:false,hasNext:true,previous(){calls.push('previous')},next(){calls.push('next')}}
 instance.$parent=host;instance.changePdf(-1)
 instance.busy=true;instance.changePdf(1)
 instance.busy=false;instance.changePdf(1)
 instance.$parent=null;instance.changePdf(1)
 assert.deepEqual(calls,['next']);assert.equal(instance.hasNextPdf,false)
})


test('Activation reports completion of a previously preloaded PDF without reloading', async () => {
 let requests=0
 const {instance,component,events}=fixture(()=>{requests++;return task()})
 await instance.loadDocument()
 events.length=0
 instance.$nextTick=()=>Promise.resolve()
 component.watch.active.call(instance,true)
 assert.deepEqual(events,[['update:loaded',true]])
 assert.equal(requests,1)
})

test('Activation during rendering keeps the spinner until rendering completes', async () => {
 const rendered=deferred(),{instance,component,events}=fixture(()=>task(rendered.promise))
 const done=instance.loadDocument();await flush();events.length=0
 component.watch.active.call(instance,true)
 assert.deepEqual(events,[['update:loaded',false]])
 rendered.resolve();await done
 assert.deepEqual(events,[['update:loaded',false],['update:loaded',true]])
})

test('Manager state comes from server on first activation without initial page state', async () => {
 const {instance,component}=fixture(()=>task())
 assert.equal(instance.managerUrl,null)
 component.watch.active.call(instance,true)
 await flush()
 assert.equal(instance.managerUrl,'/apps/mjms_pdf_manager/?fileId=7')
})


test('Disabled Manager state never exposes the action', async () => {
 const {instance,context}=fixture(()=>task())
 context.fetch=async()=>({ok:true,json:async()=>({enabled:false})})
 await instance.refreshManagerState()
 assert.equal(instance.managerUrl,null)
})

test('PDF counter filters other types, follows sorting and updates on list changes', () => {
 const {instance}=fixture(()=>task())
 instance.filename='/b.pdf'
 instance.fileList=[{filename:'/a.pdf',mime:'application/pdf'},{filename:'/image.png',mime:'image/png'},{filename:'/b.pdf',mime:'application/pdf'}]
 assert.equal(instance.pdfFiles.length,2);assert.equal(instance.pdfPosition,2)
 instance.fileList.reverse();assert.equal(instance.pdfPosition,1)
 instance.fileList=[];assert.equal(instance.pdfPosition,0)
})

test('Counter identifies PDF by id even when filenames differ', () => {
 const {instance}=fixture(()=>task())
 instance.filename='/encoded%20path/document.pdf';instance.fileid='7'
 instance.fileList=[{fileid:5,filename:'/first.pdf',mime:'application/pdf'},{fileid:7,filename:'/encoded path/document.pdf',mime:'application/pdf'}]
 assert.equal(instance.pdfCounterText,'2/2');assert.equal(instance.pdfCounterLabel,'PDF 2 sur 2')
})

test('Counter remains visible when position is unknown and uses native index as fallback', () => {
 const {instance}=fixture(()=>task());instance.filename='/unknown.pdf';instance.fileid=null
 instance.fileList=[{filename:'/a.pdf',mime:'application/pdf'},{filename:'/b.pdf',mime:'application/pdf'}]
 assert.equal(instance.pdfCounterText,'2 PDF')
 instance.$parent={$options:{name:'Viewer'},previous(){},next(){},fileList:instance.fileList,currentIndex:1}
 assert.equal(instance.pdfCounterText,'2/2')
 instance.fileList=[];instance.$parent.fileList=[];assert.equal(instance.pdfCounterText,'…')
 instance.$parent=null;assert.equal(instance.pdfCounterText,'1/1')
})

test('PDF files without mime are counted by extension while folders are excluded', () => {
 const {instance}=fixture(()=>task())
 instance.fileList=[{filename:'/a.PDF'},{filename:'/folder.pdf',type:'folder'},{filename:'/b.pdf',mime:'image/png'},null]
 assert.equal(instance.pdfFiles.length,1)
})

test('100 PDFs show 55/100 then 56/100 through reactive native navigation', async () => {
 const Vue=require('vue')
 const {component}=fixture(()=>task())
 const files=Array.from({length:100},(_,index)=>({fileid:index+1,filename:'/PDF/'+(index+1)+'.pdf',mime:'application/pdf'}))
 const host=new Vue({name:'Viewer',data:()=>({fileList:files,currentIndex:54}),methods:{previous(){this.currentIndex--},next(){this.currentIndex++}}})
 const pdf=new Vue({...component,parent:host,propsData:{active:true,fileid:55,filename:'/PDF/55.pdf',fileList:[files[54]]}})
 // Isolate rendering/loading; retain real Vue computed properties and watcher scheduling.
 assert.equal(pdf.pdfCounterText,'55/100')
 host.next();await Vue.nextTick();assert.equal(pdf.pdfCounterText,'56/100')
 host.previous();await Vue.nextTick();assert.equal(pdf.pdfCounterText,'55/100')
 host.currentIndex=99;await Vue.nextTick();assert.equal(pdf.pdfCounterText,'100/100')
 pdf.$destroy();host.$destroy()
})

test('Viewer adapter finds native state without a component name',()=>{
 const {instance}=fixture(()=>task())
 const files=Array.from({length:100},(_,index)=>({fileid:index+1,mime:'application/pdf'}))
 instance.active=true;instance.$parent={$options:{},fileList:files,currentIndex:54,previous(){},next(){}}
 assert.equal(instance.pdfCounterText,'55/100')
 instance.$parent.currentIndex=55;assert.equal(instance.pdfCounterText,'56/100')
})

test('First mount resolves Manager state and renders the whole menu only when enabled', async () => {
 const compiler=require('vue/compiler-sfc')
 const template=fs.readFileSync('src/views/PDFView.vue','utf8').match(/<template>([\s\S]*?)<\/template>/)[1]
 const compiled=compiler.compileTemplate({source:template,filename:'PDFView.vue'})
 assert.deepEqual(compiled.errors,[])
 const {render,staticRenderFns}=new Function(compiled.code+';return {render,staticRenderFns}')()
 for(const enabled of [true,false]) {
  const {instance,component,context}=fixture(()=>task())
  let calls=0
  context.fetch=async(url,options)=>{
   calls++;assert.equal(url,'/apps/mjms_pdf_viewer/api/manager-state')
   assert.equal(options.cache,'no-store');assert.equal(options.credentials,'same-origin')
   return {ok:true,json:async()=>({enabled})}
  }
  context.document.addEventListener=()=>{};context.window.addEventListener=()=>{}
  instance.loadDocument=()=>{}
  component.mounted.call(instance);await flush()
  assert.equal(calls,1);assert.equal(instance.managerEnabled,enabled)
  const Vue=require('vue')
  const view=new Vue({data:()=>({...instance,currentFileId:instance.currentFileId,currentName:instance.currentName,managerUrl:instance.managerUrl,hasPreviousPdf:instance.hasPreviousPdf,hasNextPdf:instance.hasNextPdf,pdfCounterText:instance.pdfCounterText,pdfCounterLabel:instance.pdfCounterLabel}),render,staticRenderFns})
  const nodes=[];const walk=node=>{if(!node)return;nodes.push(node);(node.children||[]).forEach(walk)}
  walk(view._render())
  assert.equal(nodes.some(n=>n.tag==='a'&&n.data.staticClass==='pdf-manager-link'),enabled)
  assert.equal(nodes.some(n=>n.tag==='a'&&n.data.attrs.href==='/apps/mjms_pdf_manager/?fileId=7'),enabled)
  view.$destroy()
 }
})

test('A newer disabled response wins over an older enabled request', async () => {
 const {instance,context}=fixture(()=>task()),old=deferred()
 context.fetch=()=>old.promise
 const first=instance.refreshManagerState()
 context.fetch=async()=>({ok:true,json:async()=>({enabled:false})})
 await instance.refreshManagerState()
 old.resolve({ok:true,json:async()=>({enabled:true})});await first
 assert.equal(instance.managerUrl,null)
})

test('Temporary failures preserve a confirmed Manager link; authentication failures hide it', async () => {
 for(const response of [()=>Promise.reject(new Error('offline')),async()=>({ok:false,status:500}),async()=>({ok:true,json:async()=>({enabled:'true'})}),async()=>({ok:true,json:async()=>{throw new Error('invalid JSON')}})]) {
  const {instance,context}=fixture(()=>task());instance.managerEnabled=true;context.fetch=response
  await instance.refreshManagerState();assert.ok(instance.managerUrl)
 }
 for(const status of [401,403]) {
  const {instance,context}=fixture(()=>task());instance.managerEnabled=true
  context.fetch=async()=>({ok:false,status})
  await instance.refreshManagerState();assert.equal(instance.managerUrl,null)
 }
})

test('Destroyed viewer ignores pending Manager response', async () => {
 const {instance,component,context}=fixture(()=>task()),pending=deferred()
 context.fetch=()=>pending.promise
 const request=instance.refreshManagerState();component.beforeDestroy.call(instance)
 pending.resolve({ok:true,json:async()=>({enabled:true})});await request
 assert.equal(instance.managerUrl,null)
})


test('A late Viewer loaded listener receives the completed state', async () => {
 const {instance,component,events}=fixture(()=>task())
 await instance.loadDocument();events.length=0
 component.watch.$listeners.call(instance)
 await instance.$nextTick()
 assert.deepEqual(events,[['update:loaded',true]])
})

test('First opening waits for DOM readiness before requesting Manager and PDF', async () => {
 const {instance,component,context}=fixture(()=>task()),listeners={},calls=[]
 context.document.readyState='loading'
 context.document.addEventListener=(name,callback)=>{(listeners[name] ||= []).push(callback)}
 context.window.addEventListener=()=>{}
 instance.refreshManagerState=()=>calls.push('manager')
 instance.loadDocument=()=>calls.push('pdf')
 component.mounted.call(instance)
 assert.equal(calls.length,0)
 listeners.DOMContentLoaded.forEach(callback=>callback())
 assert.deepEqual(calls,['manager','pdf'])
})

test('Scroll selects the page at the reading position and schedules visible pages', async () => {
 const {instance}=fixture(()=>task());await instance.loadDocument()
 let top=0
 instance.$refs.pages={clientHeight:600,getBoundingClientRect:()=>({top:0,bottom:600})}
 instance.$refs.pageElements=[0,800].map(y=>({getBoundingClientRect:()=>({top:y-top,bottom:y+780-top})}))
 instance.renderVisiblePages=()=>{}
 instance.onPageScroll();assert.equal(instance.pageNum,1)
 top=800;instance.onPageScroll();assert.equal(instance.pageNum,2)
 top=100;instance.onPageScroll();assert.equal(instance.pageNum,1)
})

test('Continuous navigation scrolls the document to the target sheet', async () => {
 const {instance}=fixture(()=>task());await instance.loadDocument()
 let requested=0
 instance.$refs.pages={scrollTop:20,getBoundingClientRect:()=>({top:100})}
 instance.$refs.pageElements=[{}, {getBoundingClientRect:()=>({top:900})}]
 instance.renderVisiblePages=()=>requested++
 await instance.goToPage(2)
 assert.equal(instance.$refs.pages.scrollTop,820)
 assert.equal(instance.pageNum,2);assert.equal(requested,1)
})

test('Manager action resolves a late native file id on first opening', () => {
 const {instance}=fixture(()=>task());instance.fileid=null;instance.active=true;instance.managerEnabled=true
 instance.$parent={$options:{name:'Viewer'},previous(){},next(){},fileList:[{fileid:42}],currentIndex:0}
 assert.equal(instance.managerUrl,'/apps/mjms_pdf_manager/?fileId=42')
})


test('Visible pages render serially, once each, and hidden preloads stay idle', async () => {
 const {instance}=fixture(()=>task());await instance.loadDocument()
 const pending=deferred(),calls=[]
 instance.$refs.pages={clientHeight:600,getBoundingClientRect:()=>({top:0,bottom:600})}
 instance.$refs.pageElements=[0,500,2000].map(top=>({getBoundingClientRect:()=>({top,bottom:top+480})}))
 instance.renderPage=async(id,number)=>{calls.push(number);if(number===1)await pending.promise}
 instance.renderVisiblePages();await flush()
 assert.deepEqual(calls,[1])
 pending.resolve();await instance._pageQueue
 assert.deepEqual(calls,[1,2])
 calls.length=0;instance.$refs.pages.clientHeight=0
 instance.renderVisiblePages();await instance._pageQueue
 assert.deepEqual(calls,[])
})

test('Vue listener replacement replays the completed PDF state', async () => {
 const Vue=require('vue'),{component}=fixture(()=>task()),events=[]
 const pdf=new Vue({...component,propsData:{active:true}})
 pdf.loaded=true
 pdf.$listeners={'update:loaded':()=>{}}
 pdf.$on('update:loaded',value=>events.push(value))
 await Vue.nextTick();await Vue.nextTick()
 assert.deepEqual(events,[true])
 pdf.$destroy()
})


test('Inline rename posts the file id and CSRF token then updates the DAV path and native list', async () => {
 const {instance,context}=fixture(()=>task())
 instance.filename='/folder/old.pdf';instance.davPath='/remote.php/dav/files/user/folder/old.pdf?download=1'
 instance.renameDraft='nouveau nom.pdf'
 instance.fileList=[{fileid:7,filename:'/folder/old.pdf',basename:'old.pdf'}]
 context.window.OC={requestToken:'csrf-test'}
 context.fetch=async(url,options)=>{
  assert.equal(url,'/apps/mjms_pdf_viewer/api/rename');assert.equal(options.method,'POST')
  assert.equal(options.headers.requesttoken,'csrf-test')
  assert.deepEqual(JSON.parse(options.body),{fileId:7,name:'nouveau nom.pdf'})
  return {ok:true,status:200,text:async()=>JSON.stringify({name:'nouveau nom.pdf',filename:'/folder/nouveau nom.pdf'})}
 }
 await instance.renameFile()
 assert.equal(instance.renamedName,'nouveau nom.pdf')
 assert.equal(new URL(instance.documentUrl).pathname,'/remote.php/dav/files/user/folder/nouveau%20nom.pdf')
 assert.equal(new URL(instance.documentUrl).search,'?download=1')
 assert.equal(instance.fileList[0].basename,'nouveau nom.pdf')
 assert.equal(instance.renameError,'');assert.equal(instance.renaming,false)
})

test('Inline rename rejects invalid names and preserves the PDF after a conflict', async () => {
 const {instance,context}=fixture(()=>task());instance.filename='/old.pdf'
 context.fetch=()=>{throw new Error('Unexpected request')}
 for(const name of ['../bad.pdf','bad.txt','folder/bad.pdf']){
  instance.renameDraft=name;await instance.renameFile();assert.ok(instance.renameError)
 }
 instance.renameDraft='exists.pdf'
 context.fetch=async()=>({ok:false,status:409,text:async()=>JSON.stringify({message:'Un fichier porte déjà ce nom.'})})
 await instance.renameFile()
 assert.equal(instance.renameError,'Un fichier porte déjà ce nom.')
 assert.equal(instance.renamedName,'');assert.equal(instance.documentUrl,'/test.pdf')
})


test('Rename handles empty and HTML error responses without JSON exceptions', async () => {
 for (const [status,body] of [[404,''],[403,'<html>Forbidden</html>'],[500,''],[200,''],[200,'{}'],[200,'<html>Login</html>']]) {
  const {instance,context}=fixture(()=>task());instance.filename='/old.pdf';instance.renameDraft='new.pdf'
  context.fetch=async()=>({ok:status===200,status,text:async()=>body})
  await instance.renameFile()
  assert.ok(instance.renameError);assert.equal(instance.renameError.includes('HTTP'),false)
  assert.equal(instance.renameError.includes('JSON'),false)
  assert.equal(instance.renamedName,'');assert.equal(instance.renaming,false)
 }
})

test('Rename reads the CSRF token from the Nextcloud document and rejects login redirects', async () => {
 const {instance,context}=fixture(()=>task());instance.filename='/old.pdf';instance.renameDraft='new.pdf'
 context.document.head={dataset:{requesttoken:'page-token'}}
 context.fetch=async(url,options)=>{
  assert.equal(options.headers.requesttoken,'page-token')
  assert.equal(options.headers['X-Requested-With'],'XMLHttpRequest')
  return {ok:true,status:200,redirected:true,text:async()=>'<html>Login</html>'}
 }
 await instance.renameFile()
 assert.ok(instance.renameError.includes('session'));assert.equal(instance.renamedName,'')
})


test('Initial server-confirmed Manager state survives an unavailable endpoint on first opening', async () => {
 const {instance,component,context}=fixture(()=>task())
 context.loadState=(app,key,fallback)=>{
  assert.equal(app,'mjms_pdf_viewer');assert.equal(key,'manager-enabled');return true
 }
 Object.assign(instance,component.data.call(instance))
 assert.equal(instance.managerUrl,'/apps/mjms_pdf_manager/?fileId=7')
 context.fetch=async()=>({ok:false,status:404})
 await instance.refreshManagerState()
 assert.equal(instance.managerUrl,'/apps/mjms_pdf_manager/?fileId=7')
 context.fetch=async()=>({ok:true,json:async()=>({enabled:false})})
 await instance.refreshManagerState();assert.equal(instance.managerUrl,null)
})


test('Navigation, activation and rename leave a getter-only native onClose untouched', async () => {
 const {instance,component,context}=fixture(()=>task()),calls=[]
 const original=()=>calls.push('close')
 const viewer=Object.freeze({get onClose(){return original}})
 const file=Object.freeze({fileid:7,filename:'/old.pdf',basename:'old.pdf'})
 instance.$parent={$options:{name:'Viewer'},Viewer:viewer,fileList:[file],currentIndex:0,hasNext:true,hasPrevious:true,previous(){calls.push('previous')},next(){calls.push('next')}}
 context.window.OCP={Files:{Router:{query:{dir:'/'},goToRoute(){throw new Error('Unexpected route change')}}}}
 instance.active=true;instance.filename='/old.pdf'
 component.watch.active.call(instance,true)
 instance.changePdf(1);instance.changePdf(-1)
 instance.renameDraft='new.pdf'
 context.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify({name:'new.pdf',filename:'/new.pdf'})})
 let reloaded=0;instance.loadDocument=async()=>{reloaded++}
 await instance.renameFile()
 assert.equal(instance.renameError,'');assert.equal(reloaded,1)
 assert.equal(instance.$parent.fileList[0].basename,'new.pdf')
 assert.equal(file.basename,'old.pdf');assert.equal(viewer.onClose,original)
 viewer.onClose();assert.deepEqual(calls,['next','previous','close'])
 component.beforeDestroy.call(instance)
})

test('A rename reloads an unchanged file-id source exactly once with real Vue watchers', async () => {
 const Vue=require('vue'),{component,context}=fixture(()=>task())
 const pdf=new Vue({...component,propsData:{active:true,fileid:7,filename:'/old.pdf',source:'/download/7'}})
 let reloaded=0;pdf.loadDocument=async()=>{reloaded++}
 context.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify({name:'new.pdf',filename:'/new.pdf'})})
 pdf.renameDraft='new.pdf';await pdf.renameFile();await Vue.nextTick()
 assert.equal(reloaded,1);assert.equal(pdf.renameError,'');assert.equal(pdf.renameDraft,'new.pdf')
 pdf.$destroy()
})

test('A rename reloads a DAV source exactly once with real Vue URL watchers', async () => {
 const Vue=require('vue'),{component,context}=fixture(()=>task())
 const pdf=new Vue({...component,propsData:{active:true,fileid:7,filename:'/old.pdf',davPath:'/remote.php/dav/files/user/old.pdf'}})
 const urls=[];pdf.loadDocument=async()=>urls.push(pdf.documentUrl)
 context.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify({name:'new.pdf',filename:'/new.pdf'})})
 pdf.renameDraft='new.pdf';await pdf.renameFile();await Vue.nextTick()
 assert.equal(urls.length,1);assert.ok(urls[0].endsWith('/new.pdf'));assert.equal(pdf.renameError,'')
 pdf.$destroy()
})

test('Active and preloaded components keep their toolbar inside their own render tree', async () => {
 const {instance,component,context}=fixture(()=>task())
 const mutations=[]
 const toolbar={parentElement:instance}
 instance.$refs.toolbar=toolbar
 instance.$el={insertBefore(){mutations.push('move')},closest(){throw new Error('Must not move into native header')}}
 context.document.addEventListener=()=>{};context.window.addEventListener=()=>{}
 instance.loadDocument=()=>{}
 component.mounted.call(instance);await flush()
 for(const active of [true,false,true,false,true]) {
  instance.active=active;component.watch.active.call(instance,active);await instance.$nextTick()
  assert.equal(toolbar.parentElement,instance)
 }
 component.beforeDestroy.call(instance)
 assert.deepEqual(mutations,[])
})


test('A second PDF URL cancels an in-flight scheduled load instead of keeping the old document', async () => {
 const old=deferred(),first={promise:old.promise,destroy(){this.destroyed=true}},requests=[]
 const {instance}=fixture(options=>{requests.push(options.url);return requests.length===1?first:task()})
 instance.davPath='/first.pdf'
 const pending=instance.requestDocumentLoad();await flush()
 instance.davPath='/second.pdf';await instance.requestDocumentLoad()
 old.reject(new Error('cancelled'));await pending
 assert.equal(requests.length,2);assert.equal(first.destroyed,true)
 assert.equal(new URL(requests[1]).pathname,'/second.pdf');assert.equal(instance.errorMessage,'')
 assert.equal(instance.loaded,true)
})


test('A successful rename refreshes only when native currentFile is cleared, across PDF navigation', async () => {
 const Vue=require('vue'),{instance,component,context}=fixture(()=>task()),timers=[]
 let reloads=0
 context.window.location.reload=()=>reloads++
 context.setTimeout=fn=>{timers.push(fn);return timers.length}
 context.clearTimeout=()=>{}
 const host=new Vue({name:'Viewer',data:()=>({currentFile:{fileid:7,source:'/old.pdf'},fileList:[],currentIndex:0}),methods:{previous(){},next(){}}})
 instance.$parent=host;instance.filename='/old.pdf';instance.renameDraft='new.pdf'
 context.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify({name:'new.pdf',filename:'/new.pdf'})})
 instance.loadDocument=async()=>{}
 await instance.renameFile()
 component.beforeDestroy.call(instance)
 host.currentFile={fileid:8,source:'/other.pdf'};await Vue.nextTick()
 host.currentFile={fileid:7,source:'/old.pdf'};await Vue.nextTick()
 assert.equal(timers.length,0);assert.equal(reloads,0)
 host.currentFile={};await Vue.nextTick()
 assert.equal(timers.length,1);timers.shift()();assert.equal(reloads,1)
 host.$destroy()
})

test('A rejected rename never schedules a folder refresh', async () => {
 const {instance,context}=fixture(()=>task())
 context.MutationObserver=class {constructor(){throw new Error('Must not observe on failure')}}
 instance.filename='/old.pdf';instance.renameDraft='exists.pdf'
 context.fetch=async()=>({ok:false,status:409,text:async()=>JSON.stringify({message:'Un fichier porte déjà ce nom.'})})
 await instance.renameFile();assert.equal(instance.renameError,'Un fichier porte déjà ce nom.')
})

test('Rename error focuses its visible alert after rendering', async () => {
 const {instance,component}=fixture(()=>task());let focused=0
 instance.$refs.renameAlert={focus(){focused++}}
 component.watch.renameError.call(instance,'Un fichier porte déjà ce nom.')
 await instance.$nextTick();assert.equal(focused,1)
})


test('Returning to a renamed preloaded PDF uses its new URL and name without closing the Viewer', async () => {
 const Vue=require('vue'),{component,context}=fixture(()=>task()),timers=[]
 let reloads=0
 context.window.location.reload=()=>reloads++
 context.setTimeout=fn=>{timers.push(fn);return timers.length}
 const host=new Vue({name:'Viewer',data:()=>({currentFile:{fileid:7,source:'/remote.php/dav/files/user/old.pdf'},fileList:[],currentIndex:0}),methods:{previous(){},next(){}}})
 const props={active:true,fileid:7,filename:'/old.pdf',source:'/remote.php/dav/files/user/old.pdf'}
 const first=new Vue({...component,parent:host,propsData:props})
 first.loadDocument=async()=>{}
 context.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify({name:'new.pdf',filename:'/new.pdf'})})
 first.renameDraft='new.pdf';await first.renameFile();first.$destroy()
 host.currentFile={fileid:8,source:'/other.pdf'};await Vue.nextTick()
 host.currentFile={fileid:7,source:props.source};await Vue.nextTick()
 const returned=new Vue({...component,parent:host,propsData:props})
 assert.equal(returned.currentName,'new.pdf');assert.equal(returned.renameDraft,'new.pdf')
 assert.ok(returned.documentUrl.endsWith('/new.pdf'))
 assert.equal(timers.length,0);assert.equal(reloads,0)
 returned.$destroy();host.$destroy()
})


test('Nextcloud 35 native next/previous plus Files route can return to a renamed file repeatedly', async () => {
 const Vue=require('vue'),{component,context}=fixture(()=>task())
 const root='https://cloud.test/remote.php/dav',base='/files/user'
 const oldNode={id:7,source:root+base+'/old.pdf',path:'/old.pdf'}
 const folderNodes=new Map([[7,oldNode],[8,{id:8,source:root+base+'/other.pdf',path:'/other.pdf'}]])
 const serverPaths=new Set(['/old.pdf','/other.pdf'])
 let closed=0,reloads=0
 context.window.location.reload=()=>reloads++
 const published=[]
 context.emit=(event,payload)=>{
  published.push(event)
  const node=payload.node||payload
  if(event==='files:node:moved'||event==='files:node:updated')folderNodes.set(node.id,node)
 }
 context.getDavNameSpaces=()=>'';context.getDavProperties=()=>''
 context.getClient=()=>({stat:async path=>({data:{filename:path,props:{fileid:7}}})})
 context.resultToNode=(stat,filesRoot,remoteURL)=>({id:7,source:remoteURL+stat.filename,path:stat.filename.slice(filesRoot.length),basename:stat.filename.split('/').pop()})
 const NativeFile=function(info,mime,modal){return {...info,mime,modal,source:info.source||root+base+info.filename}}
 const upstream=require('./fixtures/nextcloud35-navigation.cjs')(NativeFile)
 const files=[{fileid:7,filename:'/old.pdf',basename:'old.pdf',mime:'application/pdf'},{fileid:8,filename:'/other.pdf',basename:'other.pdf',mime:'application/pdf'}]
 const routeChanged=info=>{
  // Files resolves the route file id against its own cached node, then stats its path.
  // Viewer.openFile closes on the resulting 404 (upstream Viewer.vue).
  const node=folderNodes.get(Number(info.fileid))
  if(!node||!serverPaths.has(node.path)){closed++;host.currentFile={}}
 }
 const host=new Vue({name:'Viewer',data:()=>({fileList:files,currentIndex:0,currentFile:NativeFile(files[0],'application/pdf',component),components:{'application/pdf':component},previousFile:{},nextFile:{},Viewer:{onNext:routeChanged,onPrev:routeChanged}}),methods:{...upstream,changeSidebar(){},updateTitle(){}}})
 const pdf=new Vue({...component,parent:host,propsData:{active:true,fileid:7,filename:'/old.pdf',davPath:root+base+'/old.pdf'}})
 pdf.loadDocument=async()=>{}
 context.fetch=async()=>{
  serverPaths.delete('/old.pdf');serverPaths.add('/new.pdf')
  return {ok:true,status:200,text:async()=>JSON.stringify({name:'new.pdf',filename:'/new.pdf'})}
 }
 pdf.renameDraft='new.pdf';await pdf.renameFile()
 for(let i=0;i<5;i++){host.next();await Vue.nextTick();host.previous();await Vue.nextTick()}
 assert.equal(closed,0,'Files still points to the deleted old path and closes the native Viewer on 404')
 assert.equal(reloads,0)
 assert.equal(folderNodes.get(7).path,'/new.pdf')
 assert.ok(published.includes('files:node:moved'))
 assert.equal(host.currentFile.fileid,7)
 pdf.$destroy();host.$destroy()
})


test('A PDF preloaded before rename invalidates its cached URL and name reactively', async () => {
 const Vue=require('vue'),{component,context}=fixture(()=>task())
 const host=new Vue({name:'Viewer',data:()=>({fileList:[],currentFile:{fileid:7},currentIndex:0}),methods:{next(){},previous(){}}})
 const props={fileid:7,filename:'/old.pdf',davPath:'https://cloud.test/remote.php/dav/files/user/old.pdf'}
 const preloaded=new Vue({...component,parent:host,propsData:{...props,active:false}})
 const loaded=[];preloaded.loadDocument=async()=>loaded.push(preloaded.documentUrl)
 assert.ok(preloaded.documentUrl.endsWith('/old.pdf'));assert.equal(preloaded.currentName,'old.pdf')
 const active=new Vue({...component,parent:host,propsData:{...props,active:true}})
 active.loadDocument=async()=>{}
 context.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify({name:'new.pdf',filename:'/new.pdf'})})
 active.renameDraft='new.pdf';await active.renameFile();await Vue.nextTick()
 assert.ok(preloaded.documentUrl.endsWith('/new.pdf'));assert.equal(preloaded.currentName,'new.pdf')
 assert.equal(loaded.length,1)
 active.$destroy();preloaded.$destroy();host.$destroy()
})
