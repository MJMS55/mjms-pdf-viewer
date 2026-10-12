<template>
  <div class="pdf-viewer-wrapper mjms-pdf-viewer">
    <div ref="toolbar" class="pdf-toolbar">
      <div class="pdf-file-navigation" role="group" :aria-label="t('mjms_pdf_viewer', 'PDF navigation')">
        <button :aria-label="t('mjms_pdf_viewer', 'Previous PDF')" :disabled="busy || renameBusy || !hasPreviousPdf" @click="changePdf(-1)">← {{ t('mjms_pdf_viewer', "Previous PDF") }}</button>
        <button :aria-label="t('mjms_pdf_viewer', 'Next PDF')" :disabled="busy || renameBusy || !hasNextPdf" @click="changePdf(1)">{{ t('mjms_pdf_viewer', "Next PDF") }} →</button>
      </div>
      <span class="pdf-page-label">{{ t('mjms_pdf_viewer', "Page") }}</span>
      <button :aria-label="t('mjms_pdf_viewer', 'Previous page')" @click="prevPage" :disabled="busy || pageNum <= 1">‹</button>
      <span>{{ pageNum }} / {{ pageCount }}</span>
      <button :aria-label="t('mjms_pdf_viewer', 'Next page')" @click="nextPage" :disabled="busy || pageNum >= pageCount">›</button>
      <button :disabled="busy" @click="loadDocument">{{ t('mjms_pdf_viewer', "Refresh") }}</button>
      <button v-if="pageCount > 1" :aria-expanded="String(showThumbnails)" aria-controls="mjms-pdf-thumbnails" @click.stop="toggleThumbnails">{{ t('mjms_pdf_viewer', "Thumbnails") }}</button>
      <button v-if="canRename" :disabled="busy || renameBusy" @click="beginRename">{{ t('mjms_pdf_viewer', "Rename") }}</button>
      <details v-if="managerUrl" class="pdf-actions">
        <summary :aria-label="t('mjms_pdf_viewer', 'PDF actions')">{{ t('mjms_pdf_viewer', "Actions") }}</summary>
        <div class="pdf-actions-menu">
          <a :href="managerUrl" target="_blank" rel="noopener noreferrer">{{ t('mjms_pdf_viewer', "Open in MJMS-PDF-Manager") }}</a>
        </div>
      </details>
    </div>
    <dialog v-if="renaming" ref="renameDialog" class="pdf-rename-dialog" aria-labelledby="mjms-rename-title" @cancel.prevent="cancelRename" @keydown.stop @keyup.stop>
      <h2 id="mjms-rename-title">{{ t('mjms_pdf_viewer', "Rename PDF") }}</h2>
      <form class="pdf-rename-form" @submit.prevent="renamePdf">
        <label>{{ t('mjms_pdf_viewer', "PDF filename") }} <input ref="renameInput" v-model="renameName" :disabled="renameBusy" maxlength="255" autocomplete="off" @keydown.esc.prevent="cancelRename" /></label>
        <p v-if="renameError" role="alert">{{ renameError }}</p>
        <div class="pdf-rename-actions">
          <button type="button" :disabled="renameBusy" @click="cancelRename">{{ t('mjms_pdf_viewer', "Cancel") }}</button>
          <button type="submit" :disabled="renameBusy">{{ renameBusy ? t('mjms_pdf_viewer', "Renaming…") : t('mjms_pdf_viewer', "Save") }}</button>
        </div>
      </form>
    </dialog>
    <p v-if="renameNotice" role="status">{{ renameNotice }}</p>
    <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
    <div v-show="!errorMessage" class="pdf-content">
      <nav v-if="pageCount > 1" v-show="showThumbnails" id="mjms-pdf-thumbnails" class="pdf-thumbnails" :aria-label="t('mjms_pdf_viewer', 'PDF pages')">
        <button v-for="number in pageCount" :key="number" ref="thumbnailButtons" class="pdf-thumbnail" :class="{ active: number === pageNum }" :aria-label="t('mjms_pdf_viewer', 'Go to page {page}', { page: number })" :aria-current="number === pageNum ? 'page' : null" :disabled="busy" @click="goToPage(number)">
          <canvas ref="thumbnailCanvases" aria-hidden="true" />
          <span>{{ t('mjms_pdf_viewer', 'Page {page}', { page: number }) }}</span>
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
import { emit } from '@nextcloud/event-bus'
import { translate as t } from '@nextcloud/l10n'


// The public Viewer exposes read-only callbacks. Observe its Vue host instead.
const renameRefreshHooks = new WeakMap()
function refreshFolderOnClose(host) {
  if (!host || host.el || typeof host.$watch !== 'function' || renameRefreshHooks.has(host)) return
  const isOpen = () => Boolean(host.currentFile?.filename || host.initiated)
  const unwatch = host.$watch(isOpen, opened => {
    if (opened) return
    unwatch()
    renameRefreshHooks.delete(host)
    // Let the native close callback finish returning to the Files route.
    setTimeout(() => { if (!isOpen()) window.location.reload() }, 200)
  })
  renameRefreshHooks.set(host, unwatch)
}

export default {
  name: 'PDFView',
  props: {
    active: { type: Boolean, default: false },
    filename: { type: String, default: '' },
    davPath: { type: String, default: '' },
    source: { type: String, default: '' },
    fileid: { type: [Number, String], default: null },
    startPage: { type: Number, default: 1 },
  },
  data() {
    return {
      managerEnabled: false,
      renaming: false,
      renameBusy: false,
      renameName: '',
      renameError: '',
      renameNotice: '',
      loaded: false,
      showThumbnails: true,
      busy: false,
      errorMessage: '',
      pageNum: 1,
      pageCount: 0,
    }
  },
  computed: {
    canRename() {
      if (!window.OC?.currentUser || !Number.isSafeInteger(Number(this.fileid)) || Number(this.fileid) <= 0) return false
      const url = new URL(this.davPath || this.source, window.location.href)
      if (url.origin !== window.location.origin || !url.pathname.includes('/remote.php/dav/files/')) return false
      const permissions = this.viewerHost()?.currentFile?.permissions
      return !permissions || permissions.includes('N')
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
    this._onReady = () => { this.refreshManagerState(); this.syncHeaderToolbar() }
    document.addEventListener('DOMContentLoaded', this._onReady)
    this.$nextTick(() => this.syncHeaderToolbar())
    this._onFocus = () => { if (!document.hidden && !this.busy && !this.renameBusy) this.loadDocument() }
    this._onVisibility = () => { if (!document.hidden && !this.busy && !this.renameBusy) this.loadDocument() }
    window.addEventListener('focus', this._onFocus)
    document.addEventListener('visibilitychange', this._onVisibility)
    this.loadDocument()
  },
  beforeDestroy() {
    if (this.$refs.renameDialog?.open) this.$refs.renameDialog.close()
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
    t,
    toggleThumbnails() { this.showThumbnails = !this.showThumbnails },
    loadDavTools() { return import(/* webpackChunkName: "rename" */ '@nextcloud/files/dav') },
    beginRename() {
      if (!this.canRename || this.busy || this.renameBusy) return
      this.renameName = this.filename.split('/').pop()
      this.renameError = ''; this.renameNotice = ''; this.renaming = true
      this.$nextTick(() => {
        this.$refs.renameDialog?.showModal()
        const input = this.$refs.renameInput
        input?.focus()
        input?.setSelectionRange(0, this.renameName.replace(/\.pdf$/i, '').length)
      })
    },
    cancelRename() {
      if (this.renameBusy) return
      if (this.$refs.renameDialog?.open) this.$refs.renameDialog.close()
      this.renaming = false; this.renameError = ''
    },
    async renamePdf() {
      if (this.renameBusy || !this.canRename) return
      this.renameError = ''
      const name = this.renameName.trim()
      if (!name || /[\/\\\x00-\x1f<>:"|?*]/.test(name) || name === '.' || name === '..' || /[. ]$/.test(name)) {
        this.renameError = t('mjms_pdf_viewer', "Choose a valid filename without forbidden characters."); return
      }
      if (!/\.pdf$/i.test(name)) { this.renameError = t('mjms_pdf_viewer', "The filename must keep the .pdf extension."); return }
      const oldFilename = this.filename
      if (name === oldFilename.split('/').pop()) { this.cancelRename(); return }
      const source = new URL(this.davPath || this.source, window.location.href)
      const destination = new URL(source.href)
      destination.pathname = destination.pathname.slice(0, destination.pathname.lastIndexOf('/') + 1) + encodeURIComponent(name)
      destination.search = ''; destination.hash = ''
      source.search = ''; source.hash = ''
      const filename = oldFilename.slice(0, oldFilename.lastIndexOf('/') + 1) + name
      const host = this.viewerHost(), page = this.pageNum
      this.renameBusy = true
      try {
        const response = await fetch(source.href, {
          method: 'MOVE', credentials: 'same-origin',
          headers: { Destination: destination.href, Overwrite: 'F', requesttoken: window.OC.requestToken || '' },
        })
        if (!response.ok) {
          const messages = { 412: t('mjms_pdf_viewer', "A file with this name already exists in this folder."), 409: t('mjms_pdf_viewer', "The folder is no longer available."), 403: t('mjms_pdf_viewer', "You do not have permission to rename this file."), 404: t('mjms_pdf_viewer', "The file no longer exists."), 423: t('mjms_pdf_viewer', "The file is locked. Please try again later.") }
          this.renameError = messages[response.status] || t('mjms_pdf_viewer', "Renaming failed. Please try again."); return
        }
        refreshFolderOnClose(host)
        if (this.$refs.renameDialog?.open) this.$refs.renameDialog.close()
        // Keep the native navigation list and current document on the new path.
        const renamed = file => ({ ...file, filename, basename: name, displayname: name, source: destination.href, davPath: destination.href })
        const matches = file => file?.filename === oldFilename
        if (host) {
          if (Array.isArray(host.fileList)) host.fileList = host.fileList.map(file => matches(file) ? renamed(file) : file)
          if (matches(host.currentFile)) host.currentFile = { ...renamed(host.currentFile), startPage: page }
          host.updatePreviousNext?.()
          host.updateTitle?.(host.currentFile?.basename || name)
        }
        this.renaming = false
        this.renameNotice = t('mjms_pdf_viewer', "PDF renamed.")
        // Native Files uses these events to refresh the renamed entry and folder.
        try {
          const { getClient, getRootPath, getRemoteURL, getDefaultPropfind, resultToNode } = await this.loadDavTools()
          const client = getClient(), root = getRootPath()
          const options = { details: true, data: getDefaultPropfind() }
          const result = await client.stat(root + filename, options)
          const node = resultToNode(result.data, root)
          emit('files:node:moved', { node, oldSource: getRemoteURL() + root + oldFilename })
          const folderPath = (root + filename).slice(0, (root + filename).lastIndexOf('/'))
          const parent = await client.stat(folderPath, options)
          emit('files:node:updated', resultToNode(parent.data, root))
        } catch (error) {
          this.renameNotice = t('mjms_pdf_viewer', "PDF renamed. The folder will refresh when you close the viewer.")
        }
      } catch (error) { this.renameError = t('mjms_pdf_viewer', 'Renaming failed. Please try again.') }
      finally { this.renameBusy = false }
    },
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
      if (this.busy || this.renameBusy || !host) return
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
      this.errorMessage = t('mjms_pdf_viewer', "Unable to display this PDF. Check your access and try again.")
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
        this.pageNum = Math.min(Math.max(1, this.startPage), doc.numPages)
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
