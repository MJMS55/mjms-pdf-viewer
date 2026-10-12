<template>
  <div class="pdf-viewer-wrapper mjms-pdf-viewer">
    <div ref="toolbar" class="pdf-toolbar">
      <div ref="fileNavigation" class="pdf-file-navigation" role="group" aria-label="Navigation entre les PDF">
        <button aria-label="PDF précédent" :disabled="busy || !hasPreviousPdf" @click="changePdf(-1)">← PDF précédent</button>
        <span ref="fileCounter" v-show="!counterInHeader" class="pdf-file-count mjms-pdf-file-count" role="status" aria-live="polite" :aria-label="pdfCounterLabel">{{ pdfCounterText }}</span>
        <button aria-label="PDF suivant" :disabled="busy || !hasNextPdf" @click="changePdf(1)">PDF suivant →</button>
      </div>
      <span class="pdf-page-label">Page</span>
      <button aria-label="Page précédente" @click="prevPage" :disabled="busy || pageNum <= 1">‹</button>
      <span>{{ pageNum }} / {{ pageCount }}</span>
      <button aria-label="Page suivante" @click="nextPage" :disabled="busy || pageNum >= pageCount">›</button>
      <button :disabled="busy" @click="loadDocument">Actualiser</button>
      <button v-if="pageCount > 1" :aria-expanded="String(showThumbnails)" aria-controls="mjms-pdf-thumbnails" @click="showThumbnails = !showThumbnails">Vignettes</button>
      <details v-if="managerUrl" class="pdf-actions">
        <summary aria-label="Actions du PDF">Actions</summary>
        <div class="pdf-actions-menu">
          <a :href="managerUrl" target="_blank" rel="noopener noreferrer">Ouvrir dans MJMS-PDF-Manager</a>
        </div>
      </details>
    </div>
    <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
    <div v-show="!errorMessage" class="pdf-content">
      <nav v-if="pageCount > 1" v-show="showThumbnails" id="mjms-pdf-thumbnails" class="pdf-thumbnails" aria-label="Pages du PDF">
        <button v-for="number in pageCount" :key="number" ref="thumbnailButtons" class="pdf-thumbnail" :class="{ active: number === pageNum }" :aria-label="'Aller à la page ' + number" :aria-current="number === pageNum ? 'page' : null" :disabled="busy" @click="goToPage(number)">
          <canvas ref="thumbnailCanvases" aria-hidden="true" />
          <span>Page {{ number }}</span>
        </button>
      </nav>
      <div class="pdf-page"><canvas ref="canvas" /></div>
    </div>
  </div>
</template>

<script>
// Keep the initialization script independent of PDF.js and its worker.
let pdfjsPromise
function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* webpackChunkName: "pdfjs" */ 'pdfjs-dist').then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = generateFilePath('mjms_pdf_viewer', 'js', 'pdf.worker.min.mjs')
      return pdfjs
    }).catch(error => { pdfjsPromise = null; throw error })
  }
  return pdfjsPromise
}
import { generateFilePath, generateUrl } from '@nextcloud/router'
import { loadState } from '@nextcloud/initial-state'


// One close adapter per Viewer session, shared by preloaded PDF components.
const returnTargets = new WeakMap()
function rememberReturnTarget(host, file) {
  const viewer = host?.Viewer
  const router = window.OCP?.Files?.Router
  if (!viewer || host.el || host.isStandalone || !router?.goToRoute
    || typeof viewer.onClose !== 'function' || !file.fileid) return
  let target = returnTargets.get(viewer)
  if (!target || viewer.onClose !== target.wrapper) {
    target = { original: viewer.onClose, directory: router.query?.dir, file }
    target.wrapper = function(...args) {
      if (viewer.onClose === target.wrapper) viewer.onClose = target.original
      returnTargets.delete(viewer)
      const result = target.original.apply(this, args)
      // Wait for the native close callback to finish its own route update.
      Promise.resolve(result).then(() => setTimeout(() => {
        if (viewer.file || viewer.fileInfo || router.query?.dir !== target.directory) return
        const query = { ...router.query }
        delete query.openfile
        delete query.opendetails
        Promise.resolve(router.goToRoute(null,
          { ...router.params, fileid: String(target.file.fileid) }, query, true)).catch(() => {})
      }, 0)).catch(() => {})
      return result
    }
    viewer.onClose = target.wrapper
    returnTargets.set(viewer, target)
  }
  target.file = file
}

export default {
  name: 'PDFView',
  props: {
    active: { type: Boolean, default: false },
    fileList: { type: Array, default: () => [] },
    filename: { type: String, default: '' },
    davPath: { type: String, default: '' },
    source: { type: String, default: '' },
    fileid: { type: [Number, String], default: null },
  },
  data() {
    return {
      managerEnabled: false,
      counterInHeader: false,
      loaded: false,
      showThumbnails: true,
      busy: false,
      errorMessage: '',
      pageNum: 1,
      pageCount: 0,
    }
  },
  computed: {
    pdfFiles() {
      const nativeFiles = this.viewerHost()?.fileList
      const files = nativeFiles?.length ? nativeFiles : this.fileList
      return files.filter(file => {
        if (!file || file.type === 'folder' || file.mime === 'httpd/unix-directory') return false
        const mime = file.mime || file.mimetype
        return mime ? mime === 'application/pdf' : /\.pdf$/i.test(file.filename || file.basename || file.name || '')
      })
    },
    pdfPosition() {
      // The native index is authoritative for the active PDF, including arrows,
      // keyboard navigation and slideshow. Preloaded neighbours use their own id.
      const host = this.viewerHost()
      const current = host?.fileList?.[host.currentIndex]
      if (this.active && current) {
        const nativeIndex = this.pdfFiles.indexOf(current)
        if (nativeIndex !== -1) return nativeIndex + 1
      }
      // Native file info can expose a different path spelling from the list.
      const index = this.pdfFiles.findIndex(file =>
        (this.filename && file.filename === this.filename)
        || (this.fileid != null && String(file.fileid ?? file.id) === String(this.fileid)))
      if (index !== -1) return index + 1
      return current ? this.pdfFiles.indexOf(current) + 1 : 0
    },
    pdfCounterText() {
      if (!this.pdfFiles.length) return this.viewerHost() ? '…' : '1/1'
      return this.pdfPosition ? this.pdfPosition + '/' + this.pdfFiles.length
        : this.pdfFiles.length + ' PDF'
    },
    pdfCounterLabel() {
      return this.pdfPosition ? 'PDF ' + this.pdfPosition + ' sur ' + this.pdfFiles.length : this.pdfCounterText
    },
    hasPreviousPdf() { return this.viewerHost()?.hasPrevious === true },
    hasNextPdf() { return this.viewerHost()?.hasNext === true },
    documentUrl() { return this.source || this.davPath },
    managerUrl() {
      const id = Number(this.fileid)
      if (!this.managerEnabled || !Number.isSafeInteger(id) || id <= 0) return null
      return generateUrl('/apps/mjms_pdf_manager/') + '?fileId=' + id
    },
  },
  created() {
    // PDF.js objects must stay outside Vue 2's reactive observation.
    this._thumbnailTask = null
    this._loadId = 0
    this._loadingTask = null
    this._renderTask = null
    this._pdfDocument = null
  },
  mounted() {
    this.refreshManagerState()
    this.rememberCurrentPdf()
    this._onReady = () => { this.refreshManagerState(); this.syncHeaderToolbar() }
    document.addEventListener('DOMContentLoaded', this._onReady)
    this.$nextTick(() => this.syncHeaderToolbar())
    this._onFocus = () => { if (!document.hidden && !this.busy) this.loadDocument() }
    this._onVisibility = () => { if (!document.hidden && !this.busy) this.loadDocument() }
    window.addEventListener('focus', this._onFocus)
    document.addEventListener('visibilitychange', this._onVisibility)
    this.loadDocument()
  },
  beforeDestroy() {
    document.removeEventListener('DOMContentLoaded', this._onReady)
    this._headerObserver?.disconnect()
    this.restoreHeaderToolbar()
    window.removeEventListener('focus', this._onFocus)
    document.removeEventListener('visibilitychange', this._onVisibility)
    this._loadId++
    this.releaseDocument()
  },
  watch: {
    active(value) {
      if (value) {
        this.rememberCurrentPdf(true)
        this.refreshManagerState()
        // Preloaded neighbours have no loaded.sync listener until activation.
        this.$emit('update:loaded', this.loaded)
      }
      this.$nextTick(() => this.syncHeaderToolbar())
    },
    pdfCounterText() { this.$nextTick(() => this.syncHeaderToolbar()) },
    documentUrl() { this.rememberCurrentPdf(); this.loadDocument() },
    fileid() { this.rememberCurrentPdf() },
  },
  methods: {
    rememberCurrentPdf(active = this.active) {
      if (active) rememberReturnTarget(this.viewerHost(), { fileid: this.fileid, filename: this.filename })
    },
    refreshManagerState() {
      this.managerEnabled = loadState('mjms_pdf_viewer', 'manager-enabled', false) === true
    },
    setLoaded(value) {
      this.loaded = value
      this.$emit('update:loaded', value)
    },
    restoreHeaderToolbar() {
      this._headerCounter?.remove()
      this._headerCounter = null
      this.counterInHeader = false
      if (!this._headerControls) return
      if (this.$refs.toolbar && this.$el) this.$el.insertBefore(this.$refs.toolbar, this.$el.firstChild)
      const header = this._headerControls.parentElement
      this._headerControls.remove()
      this._headerControls = null
      if (header && !header.querySelector('.mjms-header-controls')) header.classList.remove('mjms-single-row')
    },
    observeHeader(root) {
      if (!root || this._headerObserverRoot === root || typeof MutationObserver === 'undefined') return
      this._headerObserver?.disconnect()
      this._headerObserverRoot = root
      this._headerObserver = new MutationObserver(() => this.syncHeaderToolbar())
      this._headerObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-handler'] })
    },
    syncHeaderToolbar() {
      if (!this.active) {
        this._headerObserver?.disconnect()
        this._headerObserver = null
        this._headerObserverRoot = null
        this.restoreHeaderToolbar()
        return
      }
      if (!this.$refs.toolbar) return
      // Modal content can be teleported away from the logical Vue parent.
      const host = this.viewerHost()
      const viewer = this.$el.closest('#viewer[data-handler="mjms-pdf-viewer"]')
        || host?.$el || this.$el.closest('.modal-mask')
      const header = viewer?.querySelector('.modal-header')
      // Standalone rendering keeps its toolbar inside the component.
      if (!header) {
        this.observeHeader(document.body)
        return
      }
      if (this._headerControls?.parentElement !== header) {
        this.restoreHeaderToolbar()
        const controls = document.createElement('div')
        controls.className = 'mjms-pdf-viewer mjms-header-controls'
        controls.appendChild(this.$refs.toolbar)
        header.prepend(controls)
        header.classList.add('mjms-single-row')
        this._headerControls = controls
      }
      const menu = header.querySelector('.icons-menu')
      if (menu) {
        // Keep the component's own counter in its template. The header copy is
        // owned by this adapter, so native Vue patches cannot orphan its vnode.
        if (!this._headerCounter) {
          this._headerCounter = document.createElement('span')
          this._headerCounter.className = 'pdf-file-count mjms-pdf-file-count'
          this._headerCounter.setAttribute('role', 'status')
          this._headerCounter.setAttribute('aria-live', 'polite')
        }
        const counter = this._headerCounter
        if (counter.textContent !== this.pdfCounterText) counter.textContent = this.pdfCounterText
        counter.setAttribute('aria-label', this.pdfCounterLabel)
        this.counterInHeader = true
        const play = menu.querySelector('button.play-pause-icons')
        // Reinsert when Nextcloud adds/removes or replaces its slideshow button.
        const anchor = play || menu.firstChild
        if (anchor !== counter && (counter.parentElement !== menu || counter.nextSibling !== anchor)) {
          menu.insertBefore(counter, anchor)
        }
      }
      // The slideshow button may be inserted after the folder list arrives.
      this.observeHeader(viewer)
    },
    viewerHost() {
      // Viewer supplies the filtered/sorted file list and handles its navigation
      // callbacks, lazy loading and wrapping. Keep that behaviour in one adapter.
      let parent = this.$parent
      while (parent) {
        if (typeof parent.previous === 'function' && typeof parent.next === 'function'
          && (parent.$options?.name === 'Viewer' || (Array.isArray(parent.fileList)
            && Number.isInteger(parent.currentIndex)))) return parent
        parent = parent.$parent
      }
      return null
    },
    changePdf(direction) {
      const host = this.viewerHost()
      if (this.busy || !host) return
      if (direction === -1 && this.hasPreviousPdf) host.previous()
      if (direction === 1 && this.hasNextPdf) host.next()
    },
    releaseDocument() {
      this._thumbnailTask?.cancel()
      this._thumbnailTask = null
      this._renderTask?.cancel()
      this._renderTask = null
      const task = this._loadingTask
      this._loadingTask = null
      this._pdfDocument = null
      if (task) Promise.resolve(task.destroy()).catch(() => {})
    },
    fail(error) {
      this.errorMessage = 'Impossible d’afficher ce PDF. Vérifiez son accès et réessayez.'
      // Native Viewer replaces failed handlers with its error view.
      this.setLoaded(true)
      this.$emit('error', error)
    },
    freshDocumentUrl() {
      // Keep DAV/public-share query parameters and fragments intact.
      const url = new URL(this.documentUrl, window.location.href)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        url.searchParams.set('mjmsPdfVersion', Date.now() + '-' + this._loadId)
      }
      return url.href
    },
    async loadDocument() {
      const id = ++this._loadId
      this.releaseDocument()
      this.busy = true
      this.errorMessage = ''
      this.pageNum = 1
      this.pageCount = 0
      this.setLoaded(false)
      try {
        if (!this.documentUrl) throw new Error('Missing PDF URL')
        const pdfjsLib = await loadPdfJs()
        if (id !== this._loadId) return
        const task = pdfjsLib.getDocument({
          url: this.freshDocumentUrl(),
          isEvalSupported: false,
          // Same-origin DAV requests retain Nextcloud authentication and range loading.
          httpHeaders: new URL(this.documentUrl, window.location.href).origin === window.location.origin
            ? { 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' } : undefined,
        })
        this._loadingTask = task
        const doc = await task.promise
        if (id !== this._loadId) return
        this._pdfDocument = doc
        this.pageCount = doc.numPages
        await this.$nextTick()
        await this.renderPage(id)
        if (id === this._loadId) {
          this.setLoaded(true)
          this.renderThumbnails(id).catch(() => {})
        }
      } catch (error) {
        if (id === this._loadId) this.fail(error)
      } finally {
        if (id === this._loadId) this.busy = false
      }
    },
    async renderPage(id = this._loadId) {
      const doc = this._pdfDocument
      if (!doc) return
      const page = await doc.getPage(this.pageNum)
      if (id !== this._loadId) return
      const viewport = page.getViewport({ scale: 1.5 })
      const canvas = this.$refs.canvas
      if (!canvas) return
      canvas.width = viewport.width
      canvas.height = viewport.height
      const task = page.render({ canvasContext: canvas.getContext('2d'), viewport })
      this._renderTask = task
      try { await task.promise } finally {
        if (this._renderTask === task) this._renderTask = null
      }
    },
    async renderThumbnails(id) {
      const doc = this._pdfDocument
      if (!doc || doc.numPages <= 1) return
      for (let number = 1; number <= doc.numPages; number++) {
        if (id !== this._loadId) return
        const page = await doc.getPage(number)
        if (id !== this._loadId) return
        const canvas = this.$refs.thumbnailCanvases?.[number - 1]
        if (!canvas) return
        const original = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: Math.min(120 / original.width, 160 / original.height) })
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const task = page.render({ canvasContext: canvas.getContext('2d'), viewport })
        this._thumbnailTask = task
        try { await task.promise } finally {
          if (this._thumbnailTask === task) this._thumbnailTask = null
        }
        // Let navigation and painting proceed between thumbnails.
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    },
    async goToPage(number) {
      if (this.busy || number < 1 || number > this.pageCount || number === this.pageNum) return
      const id = this._loadId
      this.busy = true
      this.pageNum = number
      try {
        await this.renderPage(id)
        if (id === this._loadId) {
          this.$refs.thumbnailButtons?.[number - 1]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          if (this.$refs.canvas?.parentElement) this.$refs.canvas.parentElement.scrollTop = 0
        }
      } catch (error) {
        if (id === this._loadId) this.fail(error)
      } finally {
        if (id === this._loadId) this.busy = false
      }
    },
    changePage(delta) { return this.goToPage(this.pageNum + delta) },
    prevPage() { return this.changePage(-1) },
    nextPage() { return this.changePage(1) },
  },
}
</script>
