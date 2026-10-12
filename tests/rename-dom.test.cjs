const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),vm=require('node:vm')
const {JSDOM}=require('jsdom')

test('Mounted Vue rename form renames the current PDF, refreshes Files and preserves page',async()=>{
 const dom=new JSDOM('<html><body><div id="app"></div></body></html>',{url:'https://cloud.test/index.php/apps/files'})
 global.window=dom.window;global.document=dom.window.document;global.navigator=dom.window.navigator
 global.MutationObserver=dom.window.MutationObserver
 dom.window.HTMLCanvasElement.prototype.getContext=()=>({})
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true}
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false}
 const Vue=require('vue/dist/vue.common.js');Vue.config.productionTip=false;Vue.config.devtools=false
 window.OC={currentUser:'Michel',requestToken:'token'}
 const source=fs.readFileSync('src/views/PDFView.vue','utf8')
 const template=source.match(/<template>([\s\S]*?)<\/template>/)[1]
 const script=source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/let pdfjsPromise[\s\S]*?(?=import \{ generateFilePath)/,'const loadPdfJs = async () => pdfjsLib\n')
  .replace(/^import .*$/gm,'').replace('export default','module.exports =')
 let language='fr'
 const calls=[],events=[]
 const context={URL,setTimeout,window,document,MutationObserver,module:{exports:{}},t:(app,key,params={})=>{let value=JSON.parse(fs.readFileSync('l10n/'+language+'.json','utf8')).translations[key] || key;for(const [name,item] of Object.entries(params))value=value.replaceAll('{'+name+'}',String(item));return value},
  generateFilePath:()=>'/worker',generateUrl:p=>p,loadState:()=>false,
  pdfjsLib:{getDocument:()=>({destroy(){return Promise.resolve()},promise:Promise.resolve({numPages:2,getPage:async()=>({getViewport:()=>({width:100,height:100}),render:()=>({promise:Promise.resolve(),cancel(){}})})})})},
  fetch:async(url,options)=>{calls.push({url,options});return {ok:true}},
  getClient:()=>({stat:async path=>({data:{path}})}),getRootPath:()=>'/files/Michel',getDefaultPropfind:()=>'',resultToNode:x=>x,emit:(name,data)=>events.push({name,data})}
 vm.runInNewContext(script,context)
 const component=context.module.exports;component.template=template
 component.methods.loadDavTools=async()=>({getClient:context.getClient,getRootPath:context.getRootPath,getRemoteURL:()=>'https://cloud.test/remote.php/dav',getDefaultPropfind:context.getDefaultPropfind,resultToNode:context.resultToNode})
 const file={filename:'/folder/old.pdf',basename:'old.pdf',source:'/remote.php/dav/files/Michel/folder/old.pdf',davPath:'/remote.php/dav/files/Michel/folder/old.pdf',fileid:7,permissions:'RN'}
 const host=new Vue({name:'Viewer',components:{PDFView:component},data:()=>({currentFile:file,fileList:[file],Viewer:{files:[file]},hasPrevious:false,hasNext:false}),methods:{previous(){},next(){},updatePreviousNext(){},updateTitle(name){this.currentFile.basename=name}},template:'<div id="viewer" data-handler="mjms-pdf-viewer"><div class="modal-header"><span class="title">{{currentFile.basename}}</span><div class="icons-menu"></div></div><PDFView :key="currentFile.filename" ref="pdf" v-bind="currentFile" :active="true" /></div>'}).$mount('#app')
 const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,15));await Vue.nextTick()}
 await flush()
 const thumbnails=[...document.querySelectorAll('button')].find(button=>button.textContent==='Vignettes')
 assert.ok(thumbnails)
 const thumbNav=document.querySelector('.pdf-thumbnails')
 assert.notEqual(thumbNav.style.display,'none')
 thumbnails.click();await Vue.nextTick();assert.equal(thumbNav.style.display,'none');assert.equal(thumbnails.getAttribute('aria-expanded'),'false')
 thumbnails.click();await Vue.nextTick();assert.notEqual(thumbNav.style.display,'none');assert.equal(thumbnails.getAttribute('aria-expanded'),'true')
 await host.$refs.pdf.goToPage(2)
 const renameButton=[...document.querySelectorAll('button')].find(button=>button.textContent==='Renommer')
 assert.ok(renameButton);renameButton.click();await Vue.nextTick()
 const input=document.querySelector('.pdf-rename-form input')
 assert.ok(input);assert.equal(input.value,'old.pdf')
 assert.equal(document.querySelector('dialog').open,true)
 assert.equal(document.querySelector('.pdf-toolbar .pdf-rename-form'),null)
 assert.equal(document.activeElement,input)
 input.value='Nouveau nom.pdf';input.dispatchEvent(new window.Event('input',{bubbles:true}))
 document.querySelector('.pdf-rename-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}))
 await flush();await flush()
 assert.equal(calls.length,1);assert.equal(calls[0].options.headers.Overwrite,'F')
 assert.equal(host.currentFile.filename,'/folder/Nouveau nom.pdf')
 assert.equal(document.querySelector('.title').textContent,'Nouveau nom.pdf')
 assert.equal(host.$refs.pdf.pageNum,2)
 assert.deepEqual(events.map(event=>event.name),['files:node:moved','files:node:updated'])
 assert.equal(document.querySelector('.pdf-rename-form'),null)
 // Reopening the form targets the new filename, never the old source.
 const nextButton=[...document.querySelectorAll('button')].find(button=>button.textContent==='Renommer');nextButton.click();await Vue.nextTick()
 assert.equal(document.querySelector('.pdf-rename-form input').value,'Nouveau nom.pdf')
 host.$refs.pdf.cancelRename();await Vue.nextTick()
 for(const [locale,renameText,title,cancel,save,thumbnail] of [
  ['en','Rename','Rename PDF','Cancel','Save','Thumbnails'],
  ['pl','Zmień nazwę','Zmień nazwę pliku PDF','Anuluj','Zapisz','Miniatury'],
  ['fr','Renommer','Renommer le PDF','Annuler','Enregistrer','Vignettes'],
 ]){
  language=locale;host.$refs.pdf.$forceUpdate();await Vue.nextTick()
  const button=[...document.querySelectorAll('button')].find(node=>node.textContent===renameText)
  assert.ok(button,locale+' rename button');assert.ok([...document.querySelectorAll('button')].some(node=>node.textContent===thumbnail))
  button.click();await Vue.nextTick();assert.equal(document.querySelector('dialog h2').textContent,title)
  assert.equal(document.querySelector('dialog button[type="button"]').textContent,cancel)
  assert.equal(document.querySelector('dialog button[type="submit"]').textContent,save)
  host.$refs.pdf.renameName='invalid.txt';await host.$refs.pdf.renamePdf();await Vue.nextTick()
  assert.equal(document.querySelector('dialog [role="alert"]').textContent,JSON.parse(fs.readFileSync('l10n/'+locale+'.json')).translations['The filename must keep the .pdf extension.'])
  host.$refs.pdf.cancelRename();await Vue.nextTick()
 }
 host.$destroy();dom.window.close()
})
