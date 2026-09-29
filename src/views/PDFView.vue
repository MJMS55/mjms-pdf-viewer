<template>
  <div class="pdf-viewer-wrapper mjms-pdf-viewer">
    <div class="pdf-toolbar">
      <button @click="prevPage" :disabled="busy || pageNum <= 1">‹</button>
      <span>{{ pageNum }} / {{ pageCount }}</span>
      <button @click="nextPage" :disabled="busy || pageNum >= pageCount">›</button>
      <details v-if="managerUrl" class="pdf-actions">
        <summary aria-label="Actions du PDF">Actions</summary>
        <div class="pdf-actions-menu">
          <a :href="managerUrl" target="_blank" rel="noopener noreferrer">Ouvrir dans MJMS-PDF-Manager</a>
        </div>
      </details>
    </div>
    <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
    <canvas v-show="!errorMessage" ref="canvas" />
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
      busy: false,
      errorMessage: '',
      pageNum: 1,
      pageCount: 0,
    }
  },
  computed: {
    documentUrl() { return this.source || this.davPath },
    managerUrl() {
      const id = Number(this.fileid)
      if (!this.managerEnabled || !Number.isSafeInteger(id) || id <= 0) return null
      return generateUrl('/apps/mjms_pdf_manager/') + '?fileId=' + id
    },
  },
  created() {
    // PDF.js objects must stay outside Vue 2's reactive observation.
    this._loadId = 0
    this._loadingTask = null
    this._renderTask = null
    this._pdfDocument = null
  },
  mounted() { this.loadDocument() },
  beforeDestroy() {
    this._loadId++
    this.releaseDocument()
  },
  watch: {
    documentUrl() { this.loadDocument() },
  },
  methods: {
    releaseDocument() {
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
        const task = pdfjsLib.getDocument({ url: this.documentUrl, isEvalSupported: false })
        this._loadingTask = task
        const doc = await task.promise
        if (id !== this._loadId) return
        this._pdfDocument = doc
        this.pageCount = doc.numPages
        await this.$nextTick()
        await this.renderPage(id)
        if (id === this._loadId) this.$emit('update:loaded', true)
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
    async changePage(delta) {
      if (this.busy || this.pageNum + delta < 1 || this.pageNum + delta > this.pageCount) return
      const id = this._loadId
      this.busy = true
      this.pageNum += delta
      try { await this.renderPage(id) } catch (error) {
        if (id === this._loadId) this.fail(error)
      } finally {
        if (id === this._loadId) this.busy = false
      }
    },
    prevPage() { return this.changePage(-1) },
    nextPage() { return this.changePage(1) },
  },
}
</script>
