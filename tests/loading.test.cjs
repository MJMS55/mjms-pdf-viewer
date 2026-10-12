const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const script = fs.readFileSync('src/views/PDFView.vue', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/let pdfjsPromise[\s\S]*?(?=import \{ generateFilePath)/, 'const loadPdfJs = async () => pdfjsLib\n').replace(/^import .*$/gm, '').replace('export default', 'module.exports =')
function deferred() { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b}); return {promise,resolve,reject} }
function fixture(getDocument) {
 const context={URL,setTimeout,window:{location:{href:'https://cloud.test/files',origin:'https://cloud.test'},removeEventListener(){}},document:{removeEventListener(){}},module:{exports:{}},pdfjsLib:{GlobalWorkerOptions:{},getDocument},generateFilePath:()=>'/worker.mjs',generateUrl:p=>p,loadState:()=>true}
 vm.runInNewContext(script,context)
 const component=context.module.exports, events=[]
 const instance={...component.data(),fileList:[],source:'',davPath:'/test.pdf',fileid:7,$refs:{canvas:{getContext:()=>({})}},$nextTick:()=>Promise.resolve(),$emit:(...args)=>events.push(args)}
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
 assert.equal(attached,1);assert.equal(observer.observing,true)
 instance.syncHeaderToolbar();assert.equal(attached,1)
 instance.active=false;instance.syncHeaderToolbar()
 assert.equal(restored,1);assert.equal(removed,1);assert.equal(classes.size,0)
})

test('PDF counter filters other types, follows sorting and updates on list changes', () => {
 const {instance}=fixture(()=>task())
 instance.filename='/b.pdf'
 instance.fileList=[{filename:'/a.pdf',mime:'application/pdf'},{filename:'/image.png',mime:'image/png'},{filename:'/b.pdf',mime:'application/pdf'}]
 assert.equal(instance.pdfFiles.length,2);assert.equal(instance.pdfPosition,2)
 instance.fileList.reverse();assert.equal(instance.pdfPosition,1)
 instance.fileList=[];assert.equal(instance.pdfPosition,0)
})

test('Close restores the last active PDF after native callback, retaining folder and filters', async () => {
 const {instance,component,context}=fixture(()=>task()),calls=[]
 const router={query:{dir:'/PDF',filter:'recent',openfile:'true'},params:{view:'files'},goToRoute(...args){calls.push(args)}}
 context.window.OCP={Files:{Router:router}}
 const viewer={onClose(){calls.push('native');delete router.query.openfile}}
 instance.$parent={$options:{name:'Viewer'},previous(){},next(){},Viewer:viewer}
 instance.active=true;instance.fileid=10;instance.rememberCurrentPdf()
 const wrapper=viewer.onClose
 instance.fileid=12;instance.rememberCurrentPdf()
 assert.equal(viewer.onClose,wrapper)
 instance.active=false;instance.fileid=99;instance.rememberCurrentPdf()
 viewer.onClose();await new Promise(resolve=>setTimeout(resolve,20))
 assert.equal(calls[0],'native');assert.equal(calls.length,2)
 assert.equal(calls[1][1].fileid,'12');assert.equal(calls[1][1].view,'files')
 assert.equal(calls[1][2].dir,'/PDF');assert.equal(calls[1][2].filter,'recent')
 assert.equal('openfile' in calls[1][2],false);assert.equal(calls[1][3],true)
 assert.notEqual(viewer.onClose,wrapper)
})

test('Closing after folder navigation does not redirect to an old PDF', async () => {
 const {instance,context}=fixture(()=>task());let routed=false
 const router={query:{dir:'/PDF'},goToRoute(){routed=true}}
 context.window.OCP={Files:{Router:router}}
 const viewer={onClose(){router.query.dir='/Other'}}
 instance.$parent={$options:{name:'Viewer'},previous(){},next(){},Viewer:viewer}
 instance.active=true;instance.rememberCurrentPdf();viewer.onClose()
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(routed,false)
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

function element() {
 return {
  children:[],parentElement:null,classList:{add(){},remove(){}},attributes:{},setAttribute(name,value){this.attributes[name]=value},
  get firstChild(){return this.children[0] || null},
  get nextSibling(){return this.parentElement?.children[this.parentElement.children.indexOf(this)+1] || null},
  insertBefore(node,anchor){node.remove();const index=anchor?this.children.indexOf(anchor):this.children.length;this.children.splice(index,0,node);node.parentElement=this},
  appendChild(node){this.insertBefore(node,null)},prepend(node){this.insertBefore(node,this.firstChild)},
  remove(){if(this.parentElement){const siblings=this.parentElement.children;siblings.splice(siblings.indexOf(this),1);this.parentElement=null}},
  querySelector(){return null},
 }
}

test('Counter sits immediately before slideshow and follows late insertion and replacement', () => {
 const {instance,context}=fixture(()=>task()),header=element(),menu=element(),viewer=element(),toolbar=element(),counter=element(),navigation=element(),root=element(),actions=element()
 let play=null,observer
 header.querySelector=selector=>selector==='.icons-menu'?menu:null
 menu.querySelector=()=>play
 viewer.querySelector=()=>header
 root.closest=()=>viewer
 context.document.createElement=()=>element()
 context.MutationObserver=class {constructor(callback){this.callback=callback;observer=this}observe(){this.observing=true}disconnect(){this.observing=false}}
 root.appendChild(toolbar);toolbar.appendChild(navigation);navigation.appendChild(counter);menu.appendChild(actions)
 instance.active=true;instance.$el=root;instance.$refs={toolbar,fileCounter:counter,fileNavigation:navigation}
 instance.syncHeaderToolbar();const headerCounter=instance._headerCounter;assert.equal(menu.firstChild,headerCounter)
 play=element();menu.insertBefore(play,menu.firstChild);observer.callback()
 assert.equal(headerCounter.nextSibling,play);assert.equal(menu.firstChild,headerCounter)
 const old=play;play=element();menu.insertBefore(play,old);old.remove();observer.callback()
 assert.equal(headerCounter.nextSibling,play)
 instance.syncHeaderToolbar();assert.equal(menu.children.filter(node=>node===headerCounter).length,1)
 instance.active=false;instance.syncHeaderToolbar()
 assert.equal(counter.parentElement,navigation);assert.equal(observer.observing,false)
 assert.equal(menu.children.includes(headerCounter),false)
})

test('Activating preloaded PDFs updates the close target through the lifecycle', async () => {
 const {instance,component,context}=fixture(()=>task());let returned
 const router={query:{dir:'/PDF'},params:{},goToRoute(route,params){returned=params.fileid}}
 context.window.OCP={Files:{Router:router}}
 const viewer={onClose(){}}
 instance.$parent={$options:{name:'Viewer'},previous(){},next(){},Viewer:viewer}
 instance.fileid=12;component.watch.active.call(instance,true);viewer.onClose()
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(returned,'12')
})

test('100 PDFs show 55/100 then 56/100 through reactive native navigation', async () => {
 const Vue=require('vue')
 const {component}=fixture(()=>task())
 const files=Array.from({length:100},(_,index)=>({fileid:index+1,filename:'/PDF/'+(index+1)+'.pdf',mime:'application/pdf'}))
 const host=new Vue({name:'Viewer',data:()=>({fileList:files,currentIndex:54}),methods:{previous(){this.currentIndex--},next(){this.currentIndex++}}})
 const pdf=new Vue({...component,parent:host,propsData:{active:true,fileid:55,filename:'/PDF/55.pdf',fileList:[files[54]]}})
 // Isolate rendering/loading; retain real Vue computed properties and watcher scheduling.
 pdf.syncHeaderToolbar=()=>{}
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

test('Teleported content uses native root and updates the visible header copy',()=>{
 const {instance,context}=fixture(()=>task()),header=element(),menu=element(),viewer=element(),toolbar=element(),root=element(),play=element()
 header.querySelector=()=>menu;menu.querySelector=()=>play;menu.appendChild(play);viewer.querySelector=()=>header;root.closest=()=>null
 context.document.createElement=()=>element()
 const files=Array.from({length:100},(_,index)=>({fileid:index+1,mime:'application/pdf'}))
 instance.$parent={$options:{name:'Viewer'},$el:viewer,fileList:files,currentIndex:54,previous(){},next(){}}
 instance.$el=root;instance.$refs={toolbar};instance.active=true
 instance.syncHeaderToolbar();assert.equal(instance._headerCounter.textContent,'55/100');assert.equal(instance._headerCounter.nextSibling,play)
 instance.$parent.currentIndex=55;instance.syncHeaderToolbar();assert.equal(instance._headerCounter.textContent,'56/100')
 instance.active=false;instance.syncHeaderToolbar();assert.equal(instance._headerCounter,null);assert.equal(menu.children.length,1)
})
