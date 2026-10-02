<template>
  <div class="pdf-viewer-wrapper mjms-pdf-viewer">
    <div class="pdf-toolbar">
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
import * as pdfjsLib from 'pdfjs-dist'
import { generateFilePath, generateUrl } from '@nextcloud/router'
import { loadState } from '@nextcloud/initial-state'

pdfjsLib.GlobalWorkerOptions.workerSrc = generateFilePath('mjms_pdf_viewer', 'js', 'pdf.worker.min.mjs')

export default {
  name: 'PDFView',
  props: {
    filename: { type: String, default: '' },
    davPath: { type: String, default: '' },
    source: { type: String, default: '' },
    fileid: { type: [Number, String], default: null },
  },
  data() {
    return {
      managerEnabled: loadState('mjms_pdf_viewer', 'manager-enabled', false),
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
    this._onFocus = () => { if (!document.hidden && !this.busy) this.loadDocument() }
    this._onVisibility = () => { if (!document.hidden && !this.busy) this.loadDocument() }
    window.addEventListener('focus', this._onFocus)
    document.addEventListener('visibilitychange', this._onVisibility)
    this.loadDocument()
  },
  beforeDestroy() {
    window.removeEventListener('focus', this._onFocus)
    document.removeEventListener('visibilitychange', this._onVisibility)
    this._loadId++
    this.releaseDocument()
  },
  watch: {
    documentUrl() { this.loadDocument() },
  },
  methods: {
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
      this.$emit('update:loaded', true)
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
      this.$emit('update:loaded', false)
      try {
        if (!this.documentUrl) throw new Error('Missing PDF URL')
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
          this.$emit('update:loaded', true)
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
