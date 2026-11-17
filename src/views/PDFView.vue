<template>
  <div class="pdf-viewer-wrapper mjms-pdf-viewer">
    <div ref="toolbar" class="pdf-toolbar">
      <a v-if="managerUrl" class="pdf-manager-link" :href="managerUrl" title="Ouvrir dans MJMS-PDF-Manager" aria-label="Ouvrir dans MJMS-PDF-Manager" target="_blank" rel="noopener noreferrer">MJMS-PDF-Manager ↗</a>
      <div ref="fileNavigation" class="pdf-file-navigation" role="group" aria-label="Navigation entre les PDF">
        <button class="pdf-icon-button" title="PDF précédent" aria-label="PDF précédent" :disabled="busy || renaming || !hasPreviousPdf" @click="changePdf(-1)"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5m7-7-7 7 7 7" /></svg></button>
        <span ref="fileCounter" class="pdf-file-count mjms-pdf-file-count" role="status" aria-live="polite" :aria-label="pdfCounterLabel">{{ pdfCounterText }}</span>
        <button class="pdf-icon-button" title="PDF suivant" aria-label="PDF suivant" :disabled="busy || renaming || !hasNextPdf" @click="changePdf(1)"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m-7-7 7 7-7 7" /></svg></button>
      </div>
      <span class="pdf-page-label">Page</span>
      <button aria-label="Page précédente" @click="prevPage" :disabled="busy || pageNum <= 1">‹</button>
      <span>{{ pageNum }} / {{ pageCount }}</span>
      <button aria-label="Page suivante" @click="nextPage" :disabled="busy || pageNum >= pageCount">›</button>
      <button class="pdf-icon-button" title="Actualiser" aria-label="Actualiser" :disabled="busy" @click="loadDocument"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.5-2L20 8M4 16l2.4 3A7 7 0 0 0 18 17" /></svg></button>
      <button v-if="pageCount > 1" class="pdf-icon-button" title="Afficher ou masquer les vignettes" aria-label="Afficher ou masquer les vignettes" :aria-expanded="String(showThumbnails)" aria-controls="mjms-pdf-thumbnails" @click="showThumbnails = !showThumbnails"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg></button>
      <form v-if="currentFileId && currentName" class="pdf-rename-form" @submit.prevent="renameFile">
        <input v-model="renameDraft" :aria-invalid="Boolean(renameError)" :aria-describedby="renameError ? 'mjms-rename-error' : null" aria-label="Nom du PDF" title="Nom du PDF" :disabled="renaming" required @keydown.stop @keyup.stop />
        <button class="pdf-icon-button" type="submit" title="Valider le renommage" aria-label="Valider le renommage" :disabled="renaming || !renameDraft.trim() || renameDraft.trim() === currentName"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6" /></svg></button>
      </form>
    </div>
    <div v-if="renameError" id="mjms-rename-error" ref="renameAlert" class="pdf-rename-error" role="alert" tabindex="-1"><strong>Renommage impossible</strong><span>{{ renameError }}</span></div>
    <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
    <div v-show="!errorMessage" class="pdf-content">
      <nav v-if="pageCount > 1" v-show="showThumbnails" id="mjms-pdf-thumbnails" class="pdf-thumbnails" aria-label="Pages du PDF">
        <button v-for="number in pageCount" :key="number" ref="thumbnailButtons" class="pdf-thumbnail" :class="{ active: number === pageNum }" :aria-label="'Aller à la page ' + number" :aria-current="number === pageNum ? 'page' : null" :disabled="busy" @click="goToPage(number)">
          <canvas ref="thumbnailCanvases" aria-hidden="true" />
          <span>Page {{ number }}</span>
        </button>
      </nav>
      <div ref="pages" class="pdf-page" @scroll.passive="onPageScroll">
        <div v-for="number in pageCount" :key="number" ref="pageElements" class="pdf-sheet" :style="{ aspectRatio: pageAspectRatio }" :aria-label="'Page ' + number">
          <canvas ref="pageCanvases" />
        </div>
      </div>
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
import Vue from 'vue'
import { emit } from '@nextcloud/event-bus'
import { getClient, resultToNode, getDavProperties, getDavNameSpaces } from '@nextcloud/files/dav'

// Both records survive destruction of preloaded PDF components within a session.
const folderRefreshes = new WeakMap()
const renamedFiles = new WeakMap()
function sessionRenames(host) {
  if (!host) return null
  if (!renamedFiles.has(host)) renamedFiles.set(host, Vue.observable({ files: {} }))
  return renamedFiles.get(host)
}
function refreshFolderAfterClose(host) {
  if (!host || host.el || host.isStandalone || folderRefreshes.has(host)
    || typeof host.$watch !== 'function' || !('currentFile' in host)) return
  const isClosed = () => {
    const file = host.currentFile
    return !file?.fileid && !file?.source && !file?.modal
  }
  if (isClosed()) return
  let timer = null
  const stop = host.$watch(isClosed, closed => {
    if (!closed) {
      if (timer !== null) clearTimeout(timer)
      timer = null
      return
    }
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      if (!isClosed()) return
      stop()
      folderRefreshes.delete(host)
      renamedFiles.delete(host)
      window.location.reload()
    }, 300)
  })
  folderRefreshes.set(host, stop)
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
      renameDraft: '',
      renamedName: '',
      renamedUrl: '',
      renamedFileId: null,
      renaming: false,
      renameError: '',
      managerEnabled: loadState('mjms_pdf_viewer', 'manager-enabled', false) === true,
      loaded: false,
      showThumbnails: true,
      busy: false,
      errorMessage: '',
      pageAspectRatio: '2 / 3',
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
    documentUrl() {
      const renamed = sessionRenames(this.viewerHost())?.files[this.currentFileId]
      return renamed?.url || (this.renamedFileId === this.currentFileId && this.renamedUrl) || this.source || this.davPath
    },
    currentFileId() {
      const host = this.viewerHost()
      const file = host?.fileList?.[host.currentIndex]
      const id = Number(this.fileid || (this.active && (file?.fileid ?? file?.id)))
      return Number.isSafeInteger(id) && id > 0 ? id : null
    },
    currentName() {
      const host = this.viewerHost()
      const file = host?.fileList?.[host.currentIndex]
      const renamed = sessionRenames(host)?.files[this.currentFileId]
      return renamed?.name || (this.renamedFileId === this.currentFileId && this.renamedName) || this.filename?.split('/').pop() || (this.active && (file?.basename || file?.filename?.split('/').pop())) || ''
    },
    managerUrl() {
      if (!this.managerEnabled || !this.currentFileId) return null
      return generateUrl('/apps/mjms_pdf_manager/') + '?fileId=' + this.currentFileId
    },
  },
  created() {
    // PDF.js objects must stay outside Vue 2's reactive observation.
    this._destroyed = false
    this._renderedPages = new Set()
    this._pageQueue = Promise.resolve()
    this._visibleRequest = 0
    this._reloadGeneration = 0
    this._lastDocumentReload = null
    this._reloadPromise = null
    this._managerRequest = 0
    this._thumbnailTask = null
    this._loadId = 0
    this._loadingTask = null
    this._renderTask = null
    this._pdfDocument = null
  },
  mounted() {
    // Init scripts can mount before Nextcloud finishes setting up its page.
    this._start = () => {
      if (this._destroyed) return
      this.refreshManagerState()
      this.loadDocument()
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', this._start, { once: true })
    else this.$nextTick(this._start)
    this._onFocus = () => { if (!document.hidden && !this.busy) this.loadDocument() }
    this._onVisibility = () => { if (!document.hidden && !this.busy) this.loadDocument() }
    this._onResize = () => this.onPageScroll()
    window.addEventListener('resize', this._onResize)
    window.addEventListener('focus', this._onFocus)
    document.addEventListener('visibilitychange', this._onVisibility)
  },
  beforeDestroy() {
    this._destroyed = true
    document.removeEventListener('DOMContentLoaded', this._start)
    this._managerRequest++
    window.removeEventListener('resize', this._onResize)
    window.removeEventListener('focus', this._onFocus)
    document.removeEventListener('visibilitychange', this._onVisibility)
    this._loadId++
    this.releaseDocument()
  },
  watch: {
    renameError(message) {
      if (message) this.$nextTick(() => this.$refs.renameAlert?.focus())
    },
    currentName: { immediate: true, handler(name) { this.renameDraft = name } },
    '$listeners': function() {
      // Viewer can attach/replace loaded.sync after the first render, without
      // changing active (in particular when opening a file from Files).
      this.$nextTick(() => {
        if (!this._destroyed) this.$emit('update:loaded', this.loaded)
      })
    },
    showThumbnails() { this.$nextTick(() => this.onPageScroll()) },
    active(value) {
      if (value) {
        this.refreshManagerState()
        // Preloaded neighbours have no loaded.sync listener until activation.
        this.$emit('update:loaded', this.loaded)
      }
    },
    documentUrl() { this.requestDocumentLoad() },
    fileid() {
      if (this.renamedFileId !== this.currentFileId) {
        this.renamedName = ''; this.renamedUrl = ''; this.renamedFileId = null
      }
      this.renameError = ''
    },
  },
  methods: {
    async renameFile() {
      if (this.renaming || !this.currentFileId) return
      const name = this.renameDraft.trim()
      if (!name || name === this.currentName) return
      if (/[\\/\x00-\x1f]/.test(name) || !/\.pdf$/i.test(name)) {
        this.renameError = 'Saisissez un nom valide avec l’extension .pdf.'
        return
      }
      const fileId = this.currentFileId
      const oldUrl = this.documentUrl
      const reloadGeneration = this._reloadGeneration
      this.renaming = true
      this.renameError = ''
      try {
        const response = await fetch(generateUrl('/apps/mjms_pdf_viewer/api/rename'), {
          method: 'POST', credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json', Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            requesttoken: document.head?.dataset?.requesttoken || window.OC?.requestToken || '',
          },
          body: JSON.stringify({ fileId, name }),
        })
        const body = await response.text()
        let result = null
        try { result = body.trim() ? JSON.parse(body) : null } catch { /* A proxy or Nextcloud can return HTML instead of JSON. */ }
        if (!response.ok || response.redirected) {
          const messages = {
            401: 'Votre session a expiré. Rechargez la page et reconnectez-vous.',
            403: 'Renommage refusé : droits insuffisants ou session expirée. Rechargez la page.',
            404: 'Service de renommage ou PDF introuvable. Vérifiez la mise à jour de l’application Nextcloud.',
            409: 'Un fichier porte déjà ce nom.',
            412: 'Votre session de sécurité a expiré. Rechargez la page avant de renommer.',
          }
          const message = typeof result?.message === 'string' ? result.message
            : response.redirected ? 'Votre session a expiré. Rechargez la page et reconnectez-vous.'
              : messages[response.status] || 'Le serveur n’a pas pu renommer ce PDF.'
          throw new Error(message)
        }
        // An empty response does not confirm a rename: preserve the current name.
        if (typeof result?.name !== 'string' || !result.name
          || typeof result?.filename !== 'string' || !result.filename) {
          throw new Error('Le serveur a renvoyé une réponse de renommage vide ou invalide. Vérifiez le nom dans Fichiers avant de réessayer.')
        }
        refreshFolderAfterClose(this.viewerHost())
        if (this._destroyed || this.currentFileId !== fileId) return
        this.renamedFileId = fileId
        this.renamedName = result.name
        this.renameDraft = result.name
        const url = new URL(oldUrl, window.location.href)
        if (/\/remote.php\/(dav|webdav)\//.test(url.pathname)) {
          url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1) + encodeURIComponent(result.name)
          this.renamedUrl = url.href
        }
        const host = this.viewerHost()
        if (host) {
          Vue.set(sessionRenames(host).files, fileId, { name: result.name, url: this.renamedUrl || oldUrl })
        }
        const files = host?.fileList || this.fileList
        const index = files.findIndex(file => Number(file.fileid ?? file.id) === fileId)
        if (index !== -1) {
          // Native file info may expose getter-only fields. Replace the entry
          // rather than assigning to Nextcloud-owned properties.
          const previous = files[index]
          const updated = { ...previous, basename: result.name, filename: result.filename,
            fileid: previous.fileid ?? previous.id ?? fileId,
            mime: previous.mime || previous.mimetype || 'application/pdf',
          }
          // Getter-backed metadata is not included in object spread.
          for (const key of ['permissions', 'ownerId', 'etag', 'size', 'lastmod', 'displayname']) {
            if (key in previous) updated[key] = previous[key]
          }
          if ('displayname' in previous) updated.displayname = result.name
          if ('name' in previous) updated.name = result.name
          for (const key of ['source', 'davPath']) {
            if (previous[key]) {
              const path = new URL(previous[key], window.location.href)
              if (/\/remote.php\/(dav|webdav)\//.test(path.pathname)) {
                path.pathname = path.pathname.slice(0, path.pathname.lastIndexOf('/') + 1) + encodeURIComponent(result.name)
                updated[key] = path.href
              }
            }
          }
          files.splice(index, 1, updated)
        }
        // Files has its own node cache. Native onNext/onPrev updates the route,
        // and Files resolves that route from this cache before opening the PDF.
        // Updating only Viewer.fileList leaves Files pointing at the deleted path.
        await this.synchronizeFilesRename(fileId, result.name, oldUrl)
        // Coalesce the URL watcher with this explicit reload, including sources
        // addressed by file id whose URL does not change after a rename.
        if (this._reloadGeneration === reloadGeneration) await this.requestDocumentLoad()
        else await this._lastDocumentReload
      } catch (error) {
        if (!this._destroyed && this.currentFileId === fileId) this.renameError = error.message || 'Impossible de renommer ce PDF.'
      } finally {
        if (!this._destroyed) this.renaming = false
      }
    },
    async synchronizeFilesRename(fileId, name, previousUrl) {
      let previous = new URL(previousUrl, window.location.href)
      if (!previous.pathname.includes('/remote.php/dav/files/') && this.davPath) {
        previous = new URL(this.davPath, window.location.href)
      }
      const marker = '/remote.php/dav'
      const index = previous.pathname.indexOf(marker + '/files/')
      if (index === -1 || previous.origin !== window.location.origin) return
      const remoteURL = previous.origin + previous.pathname.slice(0, index) + marker
      const destination = new URL(previous.href)
      destination.pathname = destination.pathname.slice(0, destination.pathname.lastIndexOf('/') + 1) + encodeURIComponent(name)
      const path = decodeURIComponent(destination.pathname.slice(index + marker.length))
      const filesRoot = path.split('/').slice(0, 3).join('/')
      const response = await getClient(remoteURL).stat(path, {
        details: true,
        data: '<?xml version="1.0"?><d:propfind ' + getDavNameSpaces()
          + '><d:prop>' + getDavProperties() + '</d:prop></d:propfind>',
      })
      const node = resultToNode(response.data, filesRoot, remoteURL)
      if (Number(node.id) !== fileId) throw new Error('Le PDF est renommé, mais la liste Nextcloud n’a pas pu être actualisée. Fermez le lecteur pour recharger le dossier.')
      // Move first so route lookup cannot find the stale path for this file id.
      emit('files:node:moved', { node, oldSource: previous.origin + decodeURIComponent(previous.pathname) })
      emit('files:node:updated', node)
      emit('files:node:renamed', node)
      await this.$nextTick()
    },
    requestDocumentLoad() {
      if (this._reloadPromise) return this._reloadPromise
      const pending = this.$nextTick().then(() => {
        // Only coalesce requests made in the same Vue update. A later URL
        // change must cancel an in-flight load rather than reuse its promise.
        if (this._reloadPromise === pending) this._reloadPromise = null
        if (!this._destroyed) return this.loadDocument()
      })
      this._reloadGeneration++
      this._lastDocumentReload = pending
      this._reloadPromise = pending
      pending.finally(() => { if (this._reloadPromise === pending) this._reloadPromise = null }).catch(() => {})
      return pending
    },
    async refreshManagerState() {
      // Initial page state may be missing on the first Files navigation.
      // Ask the server for this user's current enablement on every opening.
      const request = ++this._managerRequest
      try {
        const response = await fetch(generateUrl('/apps/mjms_pdf_viewer/api/manager-state'), {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        })
        if (!response.ok) {
          if (request === this._managerRequest && [401, 403].includes(response.status)) this.managerEnabled = false
          return
        }
        const state = await response.json()
        if (request === this._managerRequest && typeof state?.enabled === 'boolean') this.managerEnabled = state.enabled
      } catch {
        // A temporary failure must not hide the server-confirmed Manager link.
      }
    },
    setLoaded(value) {
      this.loaded = value
      this.$emit('update:loaded', value)

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
      if (this.busy || this.renaming || !host) return
      if (direction === -1 && this.hasPreviousPdf) host.previous()
      if (direction === 1 && this.hasNextPdf) host.next()
    },
    releaseDocument() {
      this._renderedPages.clear()
      this._pageQueue = Promise.resolve()
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
        const firstPage = await doc.getPage(1)
        if (id !== this._loadId) return
        const size = firstPage.getViewport({ scale: 1 })
        this.pageAspectRatio = size.width + ' / ' + size.height
        this.pageCount = doc.numPages
        await this.$nextTick()
        if (this.$refs.pages) this.$refs.pages.scrollTop = 0
        this._pageQueue = this.renderPage(id, 1)
        await this._pageQueue
        if (id === this._loadId) {
          this.setLoaded(true)
          this.renderVisiblePages()
          this.renderThumbnails(id).catch(() => {})
        }
      } catch (error) {
        if (id === this._loadId) this.fail(error)
      } finally {
        if (id === this._loadId) this.busy = false
      }
    },
    async renderPage(id = this._loadId, number = this.pageNum) {
      const doc = this._pdfDocument
      if (!doc) return
      if (this._renderedPages.has(number)) return
      const page = await doc.getPage(number)
      if (id !== this._loadId) return
      const viewport = page.getViewport({ scale: 1.5 })
      const canvas = this.$refs.pageCanvases?.[number - 1] || this.$refs.canvas
      if (!canvas) return
      const sheet = this.$refs.pageElements?.[number - 1]
      if (sheet) sheet.style.aspectRatio = viewport.width + ' / ' + viewport.height
      canvas.width = viewport.width
      canvas.height = viewport.height
      const task = page.render({ canvasContext: canvas.getContext('2d'), viewport })
      this._renderTask = task
      try {
        await task.promise
        if (id === this._loadId) this._renderedPages.add(number)
      } finally {
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
    onPageScroll() {
      const container = this.$refs.pages
      const sheets = this.$refs.pageElements
      if (!container || !sheets?.length) return
      const bounds = container.getBoundingClientRect()
      const marker = bounds.top + Math.min(container.clientHeight / 3, 160)
      let selected = 1
      for (let index = 0; index < sheets.length; index++) {
        if (sheets[index].getBoundingClientRect().top > marker) break
        selected = index + 1
      }
      this.pageNum = selected
      this.renderVisiblePages()
    },
    renderVisiblePages() {
      const container = this.$refs.pages
      if (!container || !container.clientHeight || !this._pdfDocument) return
      const id = this._loadId
      const bounds = container.getBoundingClientRect()
      const request = ++this._visibleRequest
      const numbers = (this.$refs.pageElements || []).flatMap((sheet, index) => {
        const rect = sheet.getBoundingClientRect()
        return rect.bottom >= bounds.top - container.clientHeight
          && rect.top <= bounds.bottom + container.clientHeight ? [index + 1] : []
      })
      // One render queue per document prevents concurrent renders on a canvas.
      this._pageQueue = this._pageQueue.then(async () => {
        for (const number of numbers) {
          if (id !== this._loadId || request !== this._visibleRequest) return
          await this.renderPage(id, number)
        }
      }).catch(error => { if (id === this._loadId) this.fail(error) })
    },
    async goToPage(number) {
      if (this.busy || number < 1 || number > this.pageCount || number === this.pageNum) return
      this.pageNum = number
      const sheet = this.$refs.pageElements?.[number - 1]
      const container = this.$refs.pages
      if (sheet && container) {
        container.scrollTop += sheet.getBoundingClientRect().top - container.getBoundingClientRect().top
        this.renderVisiblePages()
      }
      this.$refs.thumbnailButtons?.[number - 1]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      await this.$nextTick()
    },
    changePage(delta) { return this.goToPage(this.pageNum + delta) },
    prevPage() { return this.changePage(-1) },
    nextPage() { return this.changePage(1) },
  },
}
</script>
