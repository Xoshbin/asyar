import { createWriteStream, unlinkSync, existsSync } from 'node:fs'
import { get as httpsGet } from 'node:https'
import { get as httpGet } from 'node:http'

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

function pickGet(url) {
  return url.startsWith('https:') ? httpsGet : httpGet
}

// Download `url` to `dest`, following up to `maxRedirects` HTTP redirects
// (301/302/303/307/308). The destination file is materialised only after the
// final 200 response arrives — earlier implementations created the file
// up-front and reused it across redirects, which left the stream closed by
// the time the body arrived, hung the promise, and crashed CI with
// "Detected unsettled top-level await". `options.getImpl` lets tests inject
// a fake `https.get`-style function.
export function download(url, dest, options = {}) {
  const { maxRedirects = 10, getImpl } = options

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (err) => {
      if (settled) return
      settled = true
      err ? reject(err) : resolve()
    }

    const visit = (currentUrl, redirectsLeft) => {
      const get = getImpl ?? pickGet(currentUrl)
      const req = get(currentUrl, (res) => {
        const { statusCode } = res

        if (REDIRECT_STATUSES.has(statusCode)) {
          res.resume()
          const location = res.headers && res.headers.location
          if (!location) {
            return finish(new Error(`Redirect with no Location header from ${currentUrl}`))
          }
          if (redirectsLeft <= 0) {
            return finish(new Error(`Too many redirects starting at ${url}`))
          }
          return visit(new URL(location, currentUrl).toString(), redirectsLeft - 1)
        }

        if (statusCode !== 200) {
          res.resume()
          return finish(new Error(`HTTP ${statusCode} for ${currentUrl}`))
        }

        const file = createWriteStream(dest)
        const fail = (err) => {
          file.destroy()
          if (existsSync(dest)) {
            try { unlinkSync(dest) } catch {}
          }
          finish(err)
        }
        file.on('error', fail)
        res.on('error', fail)
        file.on('finish', () => file.close((err) => (err ? fail(err) : finish())))
        res.pipe(file)
      })
      req.on('error', finish)
    }

    visit(url, maxRedirects)
  })
}
