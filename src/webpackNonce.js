// Nextcloud >= 30 exposes the CSP nonce independently of the request token.
// Evaluate before style-loader injects the viewer's bundled CSS.
const nonce = document.querySelector('meta[name="csp-nonce"]')?.getAttribute('content')
if (nonce) __webpack_nonce__ = nonce
