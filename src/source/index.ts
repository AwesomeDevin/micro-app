import type { AppInterface } from '@micro-app/types'
import { fetchSource } from './fetch'
import { logError, CompletionPath, pureCreateElement, debounce } from '../libs/utils'
import { extractLinkFromHtml, fetchLinksFromHtml } from './links'
import { extractScriptElement, fetchScriptsFromHtml } from './scripts'
import scopedCSS from './scoped_css'
import { appInstanceMap } from '../create_app'

/**
 * transform html string to dom
 * @param str string dom
 */
function getWrapElement (str: string): HTMLElement {
  const wrapDiv = pureCreateElement('div')

  wrapDiv.innerHTML = str

  return wrapDiv
}

/**
 * Recursively process each child element
 * @param parent parent element
 * @param app app
 * @param microAppHead micro-app-head element
 */
function flatChildren (
  parent: HTMLElement,
  app: AppInterface,
  microAppHead: Element,
): void {
  const children = Array.from(parent.children)

  children.length && children.forEach((child) => {
    flatChildren(child as HTMLElement, app, microAppHead)
  })

  for (const dom of children) {
    if (dom instanceof HTMLLinkElement) {
      if (dom.hasAttribute('exclude')) {
        parent.replaceChild(document.createComment('link element with exclude attribute ignored by micro-app'), dom)
      } else if (app.scopecss && !dom.hasAttribute('ignore')) {
        extractLinkFromHtml(dom, parent, app, microAppHead)
      } else if (dom.hasAttribute('href')) {
        dom.setAttribute('href', CompletionPath(dom.getAttribute('href')!, app.url))
      }
    } else if (dom instanceof HTMLStyleElement) {
      if (dom.hasAttribute('exclude')) {
        parent.replaceChild(document.createComment('style element with exclude attribute ignored by micro-app'), dom)
      } else if (app.scopecss && !dom.hasAttribute('ignore')) {
        microAppHead.appendChild(scopedCSS(dom, app.name))
      }
    } else if (dom instanceof HTMLScriptElement) {
      extractScriptElement(dom, parent, app)
    } else if (dom instanceof HTMLMetaElement || dom instanceof HTMLTitleElement) {
      parent.removeChild(dom)
    } else if (dom instanceof HTMLImageElement && dom.hasAttribute('src')) {
      dom.setAttribute('src', CompletionPath(dom.getAttribute('src')!, app.url))
    }
  }
}

/**
 * Extract link and script, bind style scope
 * @param htmlStr html string
 * @param app app
 */
function extractSourceDom (htmlStr: string, app: AppInterface) {
  const wrapElement = getWrapElement(htmlStr)
  const microAppHead = wrapElement.querySelector('micro-app-head')
  const microAppBody = wrapElement.querySelector('micro-app-body')

  if (!microAppHead || !microAppBody) {
    const msg = `element ${microAppHead ? 'body' : 'head'} is missing`
    app.onerror(new Error(msg))
    return logError(msg, app.name)
  }

  flatChildren(wrapElement, app, microAppHead)

  if (app.source.links.size) {
    fetchLinksFromHtml(wrapElement, app, microAppHead)
  } else {
    app.onLoad(wrapElement)
  }

  if (app.source.scripts.size) {
    fetchScriptsFromHtml(wrapElement, app)
  } else {
    app.onLoad(wrapElement)
  }
}

/**
 * Get and format html
 * @param app app
 */
export default function extractHtml (app: AppInterface): void {
  // Support to fetch SSR multi-page projects - by awesomedevin

  // Compatibility with old logic

  fetchSource(app.url, app.name, { cache: 'no-cache' }).then((htmlStr: string) => {
    if (!htmlStr) {
      const msg = 'html is empty, please check in detail'
      app.onerror(new Error(msg))
      return logError(msg, app.name)
    }
    htmlStr = htmlStr
      .replace(/<head[^>]*>[\s\S]*?<\/head>/i, (match) => {
        return match
          .replace(/<head/i, '<micro-app-head')
          .replace(/<\/head>/i, '</micro-app-head>')
      })
      .replace(/<body[^>]*>[\s\S]*?<\/body>/i, (match) => {
        return match
          .replace(/<body/i, '<micro-app-body')
          .replace(/<\/body>/i, '</micro-app-body>')
      })

    extractSourceDom(htmlStr, app)
  }).catch((e) => {
    logError(`Failed to fetch data from ${app.url}, micro-app stop rendering`, app.name, e)
    app.onLoadError(e)
  })
}

/**
 * Define a property.
 */
export function def (obj: Object, key: string, val: any, enumerable?: boolean): void {
  Object.defineProperty(obj, key, {
    value: val,
    enumerable: !!enumerable,
    writable: true,
    configurable: true
  })
}

// observe hash change - by awesomedevin
export function watchHashChange (isSSr: boolean, appName: string): void {
  if (!isSSr) return
  const self = this

  window.onhashchange = debounce(function () {
    // console.log('路由被修改了')
    const app = appInstanceMap.get(appName)
    if (app) {
      if (!app.url !== self.getRequestUrl()) {
        extractHtml(app)
      } else {
        self.handleAppMount(app)
      }
    }
  }, 10)
}

/**
 * Intercept mutating methods - by awesomedevin
 */
export function patchHistoryMethods (isSSr: boolean, appName: string): void {
  if (!isSSr) return
  const self = this
  const methodsToPatch: string[] = [
    'pushState',
    'replaceState',
  ]
  const historyObj = window.history

  let timer: NodeJS.Timeout

  methodsToPatch.forEach(function (method) {
  // cache original method
    const original = historyObj[method as keyof History]
    def(historyObj, method,
      function mutator () {
        const app = appInstanceMap.get(appName)
        const result = original.apply(this, Array.prototype.slice.apply(arguments))

        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          if (app) {
            if (!app.url !== self.getRequestUrl()) {
              extractHtml(app)
            } else {
              self.handleAppMount(app)
            }
          }
        }, 50)
        return result
      }
    )
  })
}
