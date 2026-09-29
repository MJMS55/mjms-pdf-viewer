const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const script = fs.readFileSync('src/views/PDFView.vue', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/^import .*$/gm, '').replace('export default', 'module.exports =')
function deferred() { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b}); return {promise,resolve,reject} }
function fixture(getDocument) {
 const context={module:{exports:{}},pdfjsLib:{GlobalWorkerOptions:{},getDocument},generateFilePath:()=>'/worker.mjs',generateUrl:p=>p,loadState:()=>true}
 vm.runInNewContext(script,context)
 const component=context.module.exports, events=[]
 const instance={...component.data(),source:'',davPath:'/test.pdf',fileid:7,$refs:{canvas:{getContext:()=>({})}},$nextTick:()=>Promise.resolve(),$emit:(...args)=>events.push(args)}
 for(const [name,fn] of Object.entries(component.methods))instance[name]=fn.bind(instance)
 for(const [name,fn] of Object.entries(component.computed))Object.defineProperty(instance,name,{get:()=>fn.call(instance)})
 component.created.call(instance)
 return {instance,events,component}
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
 const stale=instance.loadDocument();instance.davPath='/second.pdf';await instance.loadDocument()
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
 instance.source='/source.pdf';await instance.loadDocument();assert.equal(url,'/source.pdf')
 const next=instance.nextPage();await instance.prevPage();await next
 assert.equal(instance.pageNum,2);assert.equal(instance.busy,false)
})
