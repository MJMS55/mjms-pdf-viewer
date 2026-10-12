const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
const compiler=require('vue-template-compiler')
const parser=require('@babel/parser')
const {JSDOM}=require('jsdom')
const source=fs.readFileSync('src/views/PDFView.vue','utf8')
const template=source.match(/<template>([\s\S]*?)<\/template>/)[1]
const script=source.match(/<script>([\s\S]*?)<\/script>/)[1]
const keys=[...new Set([...source.matchAll(/\bt\(\s*['"]mjms_pdf_viewer['"]\s*,\s*(['"])(.*?)\1/g)].map(match=>match[2]))]
const placeholders=text=>[...text.matchAll(/\{\w+\}/g)].map(match=>match[0]).sort()

test('Every interface key has a complete matching English, French and Polish catalogue',()=>{
 assert.ok(keys.length>25)
 for(const locale of ['en','fr','pl']){
  const catalogue=JSON.parse(fs.readFileSync('l10n/'+locale+'.json','utf8'))
  assert.deepEqual(Object.keys(catalogue.translations).sort(),[...keys].sort(),locale)
  for(const key of keys){assert.ok(catalogue.translations[key].trim(),locale+' '+key);assert.deepEqual(placeholders(catalogue.translations[key]),placeholders(key))}
  let registered
  vm.runInNewContext(fs.readFileSync('l10n/'+locale+'.js','utf8'),{OC:{L10N:{register(app,translations,pluralForm){registered={app,translations,pluralForm}}}}})
  assert.equal(registered.app,'mjms_pdf_viewer');assert.equal(registered.pluralForm,catalogue.pluralForm)
  assert.equal(JSON.stringify(registered.translations),JSON.stringify(catalogue.translations))
 }
})

test('Template contains no hard-coded words or untranslated accessible labels',()=>{
 const result=compiler.compile(template);assert.deepEqual(result.errors,[])
 const seen=new Set()
 function visit(node){
  if(!node||seen.has(node))return;seen.add(node)
  if(node.text){const literal=node.text.replace(/\{\{[\s\S]*?\}\}/g,'').trim();assert.equal(/[\p{L}]/u.test(literal),false,'Untranslated template text: '+literal)}
  for(const attr of node.attrsList||[]){if(['aria-label','title','placeholder','alt'].includes(attr.name))assert.fail('Untranslated attribute: '+attr.name+'='+attr.value)}
  for(const child of node.children||[])visit(child)
  for(const condition of node.ifConditions||[])visit(condition.block)
 }
 visit(result.ast)
})

test('User-facing state assignments translate text rather than displaying literals or raw errors',()=>{
 const ast=parser.parse(script,{sourceType:'module',plugins:['dynamicImport']})
 function walk(node){
  if(!node||typeof node!=='object')return
  if(node.type==='AssignmentExpression'&&node.left.type==='MemberExpression'&&['renameError','renameNotice','errorMessage'].includes(node.left.property.name)){
   const value=node.right
   assert.ok(value.type==='CallExpression'&&value.callee.name==='t' || value.type==='StringLiteral'&&value.value==='' || value.type==='LogicalExpression'&&value.right.type==='CallExpression'&&value.right.callee.name==='t','Untranslated user-facing assignment')
  }
  for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value)}
 }
 walk(ast)
 assert.equal(script.includes('error.message'),false)
})

test('App Store summary and description provide English default, French and Polish variants',()=>{
 const dom=new JSDOM(fs.readFileSync('appinfo/info.xml','utf8'),{contentType:'text/xml'})
 for(const tag of ['summary','description']){
  const elements=[...dom.window.document.querySelectorAll(tag)]
  assert.equal(elements.length,3)
  assert.ok(elements.find(node=>!node.getAttribute('lang'))?.textContent.trim())
  for(const lang of ['fr','pl'])assert.ok(elements.find(node=>node.getAttribute('lang')===lang)?.textContent.trim())
 }
 dom.window.close()
})

test('Shipped catalogues resolve through the actual Nextcloud translation library',()=>{
 const dom=new JSDOM('<html lang="en" data-locale="en"><body></body></html>',{url:'https://cloud.test'})
 global.window=dom.window;global.document=dom.window.document
 const l10n=require('@nextcloud/l10n')
 for(const locale of ['en','fr','pl']){
  l10n.unregister('mjms_pdf_viewer')
  vm.runInNewContext(fs.readFileSync('l10n/'+locale+'.js','utf8'),{OC:{L10N:{register(app,translations){l10n.register(app,translations)}}}})
  const translations=JSON.parse(fs.readFileSync('l10n/'+locale+'.json')).translations
  for(const key of keys){
   const expected=translations[key].replaceAll('{page}','55')
   assert.equal(l10n.translate('mjms_pdf_viewer',key,{page:55}),expected,locale+' '+key)
  }
 }
 l10n.unregister('mjms_pdf_viewer');dom.window.close()
})
