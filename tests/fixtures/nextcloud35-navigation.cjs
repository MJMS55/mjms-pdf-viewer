// SPDX-License-Identifier: AGPL-3.0-or-later
// Nextcloud Viewer stable35, src/views/Viewer.vue; upstream navigation methods.
// https://github.com/nextcloud/viewer/blob/stable35/src/views/Viewer.vue
module.exports = File => ({
		previous() {
			this.currentIndex--
			if (this.currentIndex < 0) {
				this.currentIndex = this.fileList.length - 1
			}

			const fileInfo = this.fileList[this.currentIndex]
			this.openFileFromList(fileInfo)
			this.Viewer.onPrev(fileInfo)
			this.updateTitle(this.currentFile.basename)
		},
		next() {
			this.currentIndex++
			if (this.currentIndex > this.fileList.length - 1) {
				this.currentIndex = 0
			}

			const fileInfo = this.fileList[this.currentIndex]
			this.openFileFromList(fileInfo)
			this.Viewer.onNext(fileInfo)

			this.updateTitle(this.currentFile.basename)
		},
		openFileFromList(fileInfo) {
			// override mimetype if existing alias
			const mime = fileInfo.mime
			this.currentFile = new File(fileInfo, mime, this.components[mime])
			this.changeSidebar()
			this.updatePreviousNext()
		},
		updatePreviousNext() {
			const prev = this.fileList[this.currentIndex - 1]
			const next = this.fileList[this.currentIndex + 1]

			if (prev) {
				const mime = prev.mime
				if (this.components[mime]) {
					this.previousFile = new File(prev, mime, this.components[mime])
				}
			} else {
				// RESET
				this.previousFile = {}
			}

			if (next) {
				const mime = next.mime
				if (this.components[mime]) {
					this.nextFile = new File(next, mime, this.components[mime])
				}
			} else {
				// RESET
				this.nextFile = {}
			}

		}
})
