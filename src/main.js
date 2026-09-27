import { registerHandler } from '@nextcloud/viewer'
import PDFView from './views/PDFView.vue'

registerHandler({
  id: 'mjms-pdf-viewer',
  group: 'pdf',
  mimes: ['application/pdf'],
  component: PDFView,
})