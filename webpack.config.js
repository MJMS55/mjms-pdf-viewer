const CopyPlugin = require('copy-webpack-plugin')
const webpackConfig = require('@nextcloud/webpack-vue-config')

webpackConfig.entry = {
    main: { import: './src/main.js', filename: 'mjms_pdf_viewer-main.js' },
}

webpackConfig.plugins.push(
    new CopyPlugin({
        patterns: [
            {
                from: 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
                to: 'pdf.worker.min.mjs',
            },
        ],
    })
)

module.exports = webpackConfig