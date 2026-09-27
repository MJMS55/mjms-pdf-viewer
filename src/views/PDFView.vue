<template>
  <div class="pdf-viewer-wrapper">
    <div class="pdf-toolbar">
      <button @click="prevPage" :disabled="pageNum <= 1">‹</button>
      <span>{{ pageNum }} / {{ pageCount }}</span>
      <button @click="nextPage" :disabled="pageNum >= pageCount">›</button>
    </div>
    <canvas ref="canvas" />
  </div>
</template>

<script>
import * as pdfjsLib from 'pdfjs-dist'
import { generateFilePath } from '@nextcloud/router'

pdfjsLib.GlobalWorkerOptions.workerSrc = generateFilePath('mjms_pdf_viewer', 'js', 'pdf.worker.min.mjs')

export default {
  name: 'PDFView',
  props: {
    filename: { type: String, default: '' },
    davPath: { type: String, default: '' },
    fileid: { type: Number, default: null },
  },
  data() {
    return {
      pdfDoc: null,
      pageNum: 1,
      pageCount: 0,
    }
  },
  watch: {
    davPath: {
      immediate: true,
      handler() {
        this.loadDocument()
      },
    },
  },
  methods: {
    async loadDocument() {
      if (!this.davPath) return
      this.pageNum = 1
      this.pdfDoc = await pdfjsLib.getDocument(this.davPath).promise
      this.pageCount = this.pdfDoc.numPages
      this.renderPage()
    },
    async renderPage() {
      const page = await this.pdfDoc.getPage(this.pageNum)
      const viewport = page.getViewport({ scale: 1.5 })
      const canvas = this.$refs.canvas
      canvas.width = viewport.width
      canvas.height = viewport.height
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    },
    prevPage() {
      if (this.pageNum > 1) {
        this.pageNum--
        this.renderPage()
      }
    },
    nextPage() {
      if (this.pageNum < this.pageCount) {
        this.pageNum++
        this.renderPage()
      }
    },
  },
}
</script>

<style scoped>
.pdf-viewer-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}
.pdf-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px;
}
canvas {
  max-width: 100%;
  max-height: 90vh;
}
</style>