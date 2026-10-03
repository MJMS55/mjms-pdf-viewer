<template>
  <div class="pdf-viewer-wrapper mjms-pdf-viewer">
    <div ref="toolbar" class="pdf-toolbar">
      <div class="pdf-file-navigation" role="group" aria-label="Navigation entre les PDF">
        <button aria-label="PDF précédent" :disabled="busy || !hasPreviousPdf" @click="changePdf(-1)">← PDF précédent</button>
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


export default {
  name: 'PDFView',
  props: {
    active: { type: Boolean, default: false },
    filename: { type: String, default: '' },
    davPath: { type: String, default: '' },
    source: { type: String, default: '' },
    fileid: { type: [Number, String], default: null },
  },
  data() {
    return {
      managerEnabled: false,
      loaded: false,
      showThumbnails: true,
      busy: false,
      errorMessage: '',
      pageNum: 1,
      pageCount: 0,
    }
  },
  computed: {
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
        this.refreshManagerState()
        // Preloaded neighbours have no loaded.sync listener until activation.
        this.$emit('update:loaded', this.loaded)
      }
      this.$nextTick(() => this.syncHeaderToolbar())
    },
    documentUrl() { this.loadDocument() },
  },
  methods: {
    refreshManagerState() {
      this.managerEnabled = loadState('mjms_pdf_viewer', 'manager-enabled', false) === true
    },
    setLoaded(value) {
      this.loaded = value
      this.$emit('update:loaded', value)
    },
    restoreHeaderToolbar() {
      if (!this._headerControls) return
      if (this.$refs.toolbar && this.$el) this.$el.insertBefore(this.$refs.toolbar, this.$el.firstChild)
      const header = this._headerControls.parentElement
      this._headerControls.remove()
      this._headerControls = null
      if (header && !header.querySelector('.mjms-header-controls')) header.classList.remove('mjms-single-row')
    },
    syncHeaderToolbar() {
      if (!this.active) {
        this._headerObserver?.disconnect()
        this._headerObserver = null
        this.restoreHeaderToolbar()
        return
      }
      if (this._headerControls || !this.$refs.toolbar) return
      const viewer = this.$el.closest('#viewer[data-handler="mjms-pdf-viewer"]')
      const header = viewer?.querySelector('.modal-header')
      // Standalone rendering keeps its toolbar inside the component.
      if (!header) {
        if (!this._headerObserver && typeof MutationObserver !== 'undefined') {
          this._headerObserver = new MutationObserver(() => this.syncHeaderToolbar())
          this._headerObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-handler'] })
        }
        return
      }
      this._headerObserver?.disconnect()
      this._headerObserver = null
      const controls = document.createElement('div')
      controls.className = 'mjms-pdf-viewer mjms-header-controls'
      controls.appendChild(this.$refs.toolbar)
      header.prepend(controls)
      header.classList.add('mjms-single-row')
      this._headerControls = controls
    },
    viewerHost() {
      // Viewer supplies the filtered/sorted file list and handles its navigation
      // callbacks, lazy loading and wrapping. Keep that behaviour in one adapter.
      let parent = this.$parent
      while (parent) {
        if (parent.$options?.name === 'Viewer'
          && typeof parent.previous === 'function' && typeof parent.next === 'function') return parent
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
