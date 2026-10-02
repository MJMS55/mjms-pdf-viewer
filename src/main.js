import './webpackNonce'
import '../css/viewer.css'
import { registerHandler } from '@nextcloud/viewer'
import PDFView from './views/PDFView.vue'

registerHandler({
  id: 'mjms-pdf-viewer',
  group: 'pdf',
  theme: 'default',
  mimes: ['application/pdf'],
  component: PDFView,
})