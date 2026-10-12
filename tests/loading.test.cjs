const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const script = fs.readFileSync('src/views/PDFView.vue', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/let pdfjsPromise[\s\S]*?(?=import \{ generateFilePath)/, 'const loadPdfJs = async () => pdfjsLib\n').replace(/^import .*$/gm, '').replace('export default', 'module.exports =')
function deferred() { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b}); return {promise,resolve,reject} }
function fixture(getDocument) {
 const context={URL,setTimeout,window:{location:{href:'https://cloud.test/files',origin:'https://cloud.test'},removeEventListener(){}},document:{removeEventListener(){}},module:{exports:{}},t:(app,key,params={})=>{let value=JSON.parse(fs.readFileSync('l10n/fr.json','utf8')).translations[key] || key;for(const [name,item] of Object.entries(params))value=value.replaceAll('{'+name+'}',String(item));return value},pdfjsLib:{GlobalWorkerOptions:{},getDocument},generateFilePath:()=>'/worker.mjs',generateUrl:p=>p,loadState:()=>true}
 vm.runInNewContext(script,context)
 const component=context.module.exports, events=[]
 const instance={...component.data(),fileList:[],startPage:1,source:'',davPath:'/test.pdf',fileid:7,$refs:{canvas:{getContext:()=>({})}},$nextTick:()=>Promise.resolve(),$emit:(...args)=>events.push(args)}
 for(const [name,fn] of Object.entries(component.methods))instance[name]=fn.bind(instance)
 for(const [name,fn] of Object.entries(component.computed))Object.defineProperty(instance,name,{get:()=>fn.call(instance)})
 instance.loadDavTools=async()=>({getClient:context.getClient,getRootPath:context.getRootPath,getRemoteURL:()=>'https://cloud.test/remote.php/dav',getDefaultPropfind:context.getDefaultPropfind,resultToNode:context.resultToNode})
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
test('Source URL is preferred and rapid page requests are serialized',async()=>{
 let url;const pdf=task(),{instance}=fixture(options=>{url=options.url;return pdf})
 instance.source='/source.pdf';await instance.loadDocument();assert.equal(new URL(url).pathname,'/source.pdf');assert.ok(new URL(url).searchParams.has('mjmsPdfVersion'))
 const next=instance.nextPage();await instance.prevPage();await next
 assert.equal(instance.pageNum,2);assert.equal(instance.busy,false)
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

test('Manager state can arrive after creation and is refreshed on activation', () => {
 const {instance,component}=fixture(()=>task())
 assert.equal(instance.managerUrl,null)
 component.watch.active.call(instance,true)
 assert.equal(instance.managerUrl,'/apps/mjms_pdf_manager/?fileId=7')
})


test('Disabled or missing Manager state never exposes the action', () => {
 const {instance,context}=fixture(()=>task())
 context.loadState=()=>false
 instance.refreshManagerState()
 assert.equal(instance.managerUrl,null)
})

test('Late header is attached once and observer is disconnected on deactivation', () => {
 const {instance,context}=fixture(()=>task())
 let header=null,observer,attached=0,restored=0,removed=0
 const classes=new Set()
 const controls={appendChild(){},remove(){removed++}}
 const readyHeader={prepend(node){attached++;node.parentElement=this},classList:{add(c){classes.add(c)},remove(c){classes.delete(c)}},querySelector:()=>null}
 context.MutationObserver=class {
   constructor(callback){this.callback=callback;observer=this}
   observe(){this.observing=true}
   disconnect(){this.observing=false}
 }
 context.document.body={}
 context.document.createElement=()=>controls
 instance.active=true
 instance.$refs.toolbar={}
 instance.$el={closest:()=>({querySelector:()=>header}),insertBefore(){restored++}}
 instance.syncHeaderToolbar()
 assert.equal(observer.observing,true);assert.equal(attached,0)
 header=readyHeader;observer.callback()
 assert.equal(attached,1);assert.equal(observer.observing,false)
 instance.syncHeaderToolbar();assert.equal(attached,1)
 instance.active=false;instance.syncHeaderToolbar()
 assert.equal(restored,1);assert.equal(removed,1);assert.equal(classes.size,0)
})


test('Renaming validates PDF extension and unsafe filenames before sending a request',async()=>{
 const {instance,context}=fixture(()=>task());context.window.OC={currentUser:'Michel'};instance.davPath='/remote.php/dav/files/Michel/folder/old.pdf';instance.filename='/folder/old.pdf'
 let requests=0;context.fetch=async()=>{requests++;return {ok:true}}
 for(const name of ['','../file.pdf','file.txt','bad?.pdf']){instance.renameName=name;await instance.renamePdf();assert.ok(instance.renameError)}
 assert.equal(requests,0)
})

test('Successful rename refuses overwrite, encodes accents and updates native navigation',async()=>{
 const {instance,context}=fixture(()=>task());context.window.OC={currentUser:'Michel',requestToken:'test-token'}
 instance.filename='/folder/old.pdf';instance.davPath='/remote.php/dav/files/Michel/folder/old.pdf';instance.renameName='Été #1.pdf';instance.pageNum=2
 const old={filename:instance.filename,fileid:7,basename:'old.pdf',permissions:'RN'}
 const host={$options:{name:'Viewer'},previous(){},next(){},currentFile:old,fileList:[old,{filename:'/folder/next.pdf'}],Viewer:{files:[old]},updatePreviousNext(){},updateTitle(name){this.title=name}}
 instance.$parent=host;let sent
 context.fetch=async(url,options)=>{sent={url,options};return {ok:true}}
 context.getClient=()=>({stat:async()=>({data:{}})});context.getRootPath=()=>'/files/Michel';context.getDefaultPropfind=()=>'';context.resultToNode=x=>x;context.emit=()=>{}
 await instance.renamePdf()
 assert.equal(sent.options.method,'MOVE');assert.equal(sent.options.headers.Overwrite,'F');assert.equal(sent.options.headers.requesttoken,'test-token')
 assert.equal(new URL(sent.options.headers.Destination).pathname,'/remote.php/dav/files/Michel/folder/%C3%89t%C3%A9%20%231.pdf')
 assert.equal(host.currentFile.filename,'/folder/Été #1.pdf');assert.equal(host.currentFile.startPage,2)
 assert.equal(host.fileList[0].filename,host.currentFile.filename)
 assert.equal(host.fileList[1].filename,'/folder/next.pdf');assert.equal(instance.renameBusy,false);assert.equal(instance.renameError,'')
})

test('A duplicate or forbidden rename keeps the original PDF and shows an error',async()=>{
 for(const status of [412,403,423]){
  const {instance,context}=fixture(()=>task());context.window.OC={currentUser:'Michel'}
  instance.filename='/old.pdf';instance.davPath='/remote.php/dav/files/Michel/old.pdf';instance.renameName='new.pdf'
  const current={filename:'/old.pdf'};instance.$parent={$options:{name:'Viewer'},previous(){},next(){},currentFile:current,fileList:[current]}
  context.fetch=async()=>({ok:false,status});await instance.renamePdf()
  assert.equal(instance.$parent.currentFile.filename,'/old.pdf');assert.ok(instance.renameError);assert.equal(instance.renameBusy,false)
 }
})

test('Public shares and read-only files do not offer rename',()=>{
 const {instance,context}=fixture(()=>task());instance.davPath='/remote.php/dav/files/Michel/file.pdf'
 assert.equal(instance.canRename,false);context.window.OC={currentUser:'Michel'}
 instance.$parent={$options:{name:'Viewer'},previous(){},next(){},currentFile:{permissions:'R'}};assert.equal(instance.canRename,false)
 instance.davPath='/public.php/dav/files/token/file.pdf';assert.equal(instance.canRename,false)
})

test('The renamed current PDF reopens on its previously viewed page',async()=>{
 const {instance}=fixture(()=>task());instance.startPage=2;await instance.loadDocument();assert.equal(instance.pageNum,2)
})


test('Read-only Viewer API is untouched; successful rename refreshes on host close',async()=>{
 const {instance,context}=fixture(()=>task()),calls=[]
 context.window.OC={currentUser:'Michel'};context.window.location.reload=()=>calls.push('refresh')
 instance.filename='/old.pdf';instance.davPath='/remote.php/dav/files/Michel/old.pdf';instance.renameName='new.pdf'
 const old={filename:'/old.pdf'},original=()=>calls.push('native')
 const viewer={};Object.defineProperties(viewer,{onClose:{get:()=>original},files:{get:()=>[old]},fileInfo:{get:()=>Object.freeze(old)}})
 let callback,watches=0,stops=0
 const host={$options:{name:'Viewer'},previous(){},next(){},Viewer:viewer,currentFile:old,fileList:[old],$watch(getter,handler){watches++;callback=handler;return ()=>{stops++}}}
 instance.$parent=host;context.fetch=async()=>({ok:true})
 await instance.renamePdf();assert.equal(instance.renameError,'');assert.equal(host.currentFile.filename,'/new.pdf');assert.equal(viewer.onClose,original)
 instance.filename='/new.pdf';instance.renameName='second.pdf';await instance.renamePdf();assert.equal(watches,1)
 callback(true);await new Promise(resolve=>setTimeout(resolve,220));assert.equal(calls.length,0)
 host.currentFile={};viewer.onClose();callback(false)
 await new Promise(resolve=>setTimeout(resolve,250));assert.deepEqual(calls,['native','refresh']);assert.equal(stops,1)
})

test('Failed rename does not arm a folder refresh',async()=>{
 const {instance,context}=fixture(()=>task());context.window.OC={currentUser:'Michel'}
 instance.filename='/old.pdf';instance.davPath='/remote.php/dav/files/Michel/old.pdf';instance.renameName='new.pdf'
 let watches=0;instance.$parent={$options:{name:'Viewer'},previous(){},next(){},$watch(){watches++}}
 context.fetch=async()=>({ok:false,status:412});await instance.renamePdf();assert.equal(watches,0)
})
