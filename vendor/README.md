# Vendored third-party libraries

Self-hosted copies so the app works offline (the service worker precaches
them) and no visitor IP address is sent to a CDN. The files are byte-identical
to the cdnjs releases; the SRI hashes below match the ones previously used in
the `<script integrity>` attributes.

| File                        | Library                                        | License                                 |
| --------------------------- | ---------------------------------------------- | --------------------------------------- |
| `jszip-3.10.1.min.js`       | [JSZip](https://github.com/Stuk/jszip) 3.10.1  | MIT or GPLv3 (used under MIT) — `LICENSE.jszip.md` |
| `qrcode-1.0.0.min.js`       | [qrcodejs](https://github.com/davidshimjs/qrcodejs) 1.0.0 | MIT — `LICENSE.qrcodejs.txt`   |
| `marked-16.3.0.umd.min.js`  | [marked](https://github.com/markedjs/marked) 16.3.0 | MIT — `LICENSE.marked.md`          |
| `purify-3.2.7.min.js`       | [DOMPurify](https://github.com/cure53/DOMPurify) 3.2.7 | Apache-2.0 or MPL-2.0 — `LICENSE.dompurify.txt` |

SRI (sha512) of the files as vendored:

- `jszip-3.10.1.min.js`: `XMVd28F1oH/O71fzwBnV7HucLxVwtxf26XV8P4wPk26EDxuGZ91N8bsOttmnomcCD3CS5ZMRL50H0GgOHvegtg==`
- `qrcode-1.0.0.min.js`: `CNgIRecGo7nphbeZ04Sc13ka07paqdeTu0WR1IM4kNcpmBAUSHSQX0FslNhTDadL4O5SAGapGt4FodqL8My0mA==`
- `marked-16.3.0.umd.min.js`: `V6rGY7jjOEUc7q5Ews8mMlretz1Vn2wLdMW/qgABLWunzsLfluM0FwHuGjGQ1lc8jO5vGpGIGFE+rTzB+63HdA==`
- `purify-3.2.7.min.js`: `78KH17QLT5e55GJqP76vutp1D2iAoy06WcYBXB6iBCsmO6wWzx0Qdg8EDpm8mKXv68BcvHOyeeP4wxAL0twJGQ==`

To upgrade: download the new release, verify it against the publisher's
hash, replace the file (new version in the file name), and update the
`<script src>` tags, `sw.js` (`ASSETS_TO_CACHE`, bump `CACHE_NAME`) and this list.
