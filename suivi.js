/* ═══════════════════════════════════════════════════════════════════════
   suivi.js — ce que le Dashboard privé voit (25 octobre 2026)
   ═══════════════════════════════════════════════════════════════════════

   Chargé par l'app (/app/) ET par le site. Deux rôles :

   ① LES ERREURS (app + site) — erreurs JavaScript, promesses rejetées,
     appels au serveur qui échouent, `console.error`. Envoyées à
     `signaler_erreur` ; le serveur y ajoute lui-même la personne et
     l'entreprise (impossible à falsifier depuis le navigateur).

   ② LES VISITES (site seulement) — page vue, clics sur les liens et
     boutons, durée de la visite. Sans cookie, sans adresse IP : un
     identifiant au hasard, oublié à la fermeture de l'onglet.

   ⚠ CE FICHIER NE DOIT JAMAIS CASSER LA PAGE. Tout est dans des try/catch,
     rien n'est attendu, et si le serveur ne répond pas, tant pis : on perd
     un signalement, jamais l'app.
   ═══════════════════════════════════════════════════════════════════════ */
;(function () {
  try {
    if (window.__suiviStandix) return
    window.__suiviStandix = true

    var URL_SB = 'https://tlrtsoahwqhtvtkhssbm.supabase.co'
    var CLE = 'sb_publishable_pzGIsj3EE2Sh_OBt21QbGg_4lKfitFw'
    var JETON = 'sb-tlrtsoahwqhtvtkhssbm-auth-token'
    var chemin = location.pathname || '/'
    var SOURCE = /^\/app(\/|$)/.test(chemin) ? 'app' : 'site'
    if (/^\/admin(\/|$)/.test(chemin)) return // le Dashboard ne se surveille pas lui-même

    /* La vraie fonction `fetch`, gardée avant qu'on l'enveloppe : nos propres
       envois ne doivent jamais repasser par la surveillance. */
    var fetchOrigine = window.fetch ? window.fetch.bind(window) : null
    if (!fetchOrigine) return

    /* ─── L'appareil, en quelques mots ─── */
    var ua = navigator.userAgent || ''
    function appareil() {
      if (/iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'tablette'
      if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablette'
      if (/Mobi|iPhone|Android/i.test(ua)) return 'téléphone'
      return 'ordinateur'
    }
    function systeme() {
      var m
      if ((m = ua.match(/iPhone OS (\d+)[_.](\d+)/)) || (m = ua.match(/CPU OS (\d+)[_.](\d+)/))) return 'iOS ' + m[1] + '.' + m[2]
      if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'iPadOS'
      if ((m = ua.match(/Android (\d+)/))) return 'Android ' + m[1]
      if (/Windows/.test(ua)) return 'Windows'
      if (/Mac OS X/.test(ua)) return 'macOS'
      if (/Linux/.test(ua)) return 'Linux'
      return 'autre'
    }
    function navigateur() {
      var m
      if ((m = ua.match(/Edg\/(\d+)/))) return 'Edge ' + m[1]
      if ((m = ua.match(/SamsungBrowser\/(\d+)/))) return 'Samsung ' + m[1]
      if ((m = ua.match(/(?:Chrome|CriOS)\/(\d+)/))) return 'Chrome ' + m[1]
      if ((m = ua.match(/(?:Firefox|FxiOS)\/(\d+)/))) return 'Firefox ' + m[1]
      if ((m = ua.match(/Version\/(\d+).*Safari/))) return 'Safari ' + m[1]
      return 'autre'
    }
    var APPAREIL = appareil(), SYSTEME = systeme(), NAVIGATEUR = navigateur()
    var ECRAN = (screen.width || 0) + '×' + (screen.height || 0)
    var LANGUE = (navigator.language || '').slice(0, 10)

    function version() {
      try {
        var s = document.querySelector('script[src*="app.js"]')
        var m = s && s.getAttribute('src').match(/v=([\w-]+)/)
        return m ? m[1] : null
      } catch (e) { return null }
    }

    /* Le jeton de la personne connectée, s'il est encore valable. Sans lui,
       l'erreur est quand même notée, mais sans savoir qui. */
    function jeton() {
      try {
        var brut = localStorage.getItem(JETON)
        if (!brut) return null
        var s = JSON.parse(brut)
        s = s && (s.currentSession || s)
        if (!s || !s.access_token) return null
        if (s.expires_at && s.expires_at * 1000 < Date.now() + 5000) return null
        return s.access_token
      } catch (e) { return null }
    }

    function envoyer(fonction, donnees) {
      try {
        var t = jeton()
        var entetes = { 'Content-Type': 'application/json', apikey: CLE }
        if (t) entetes.Authorization = 'Bearer ' + t
        fetchOrigine(URL_SB + '/rest/v1/rpc/' + fonction, {
          method: 'POST',
          headers: entetes,
          body: JSON.stringify({ p: donnees }),
          keepalive: true,
        }).catch(function () {})
      } catch (e) {}
    }

    /* ═══ ① LES ERREURS ═══════════════════════════════════════════════════ */

    var vues = {}        // même erreur répétée : une fois toutes les 10 s
    var envoyees = 0     // et 40 au plus par chargement de page
    var BRUIT = /ResizeObserver loop|Script error\.?$|Non-Error promise rejection captured|AbortError|The operation was aborted|Load failed$|cancelled|annulé/i

    function texte(x) {
      try {
        if (x == null) return ''
        if (typeof x === 'string') return x
        if (x instanceof Error) return (x.name && x.name !== 'Error' ? x.name + ': ' : '') + x.message
        if (x.message) return String(x.message)
        return JSON.stringify(x).slice(0, 500)
      } catch (e) { return String(x) }
    }

    function signaler(genre, message, extra) {
      try {
        message = String(message || '').trim()
        if (!message || BRUIT.test(message)) return
        if (/signaler_erreur|noter_visite/.test(message)) return
        var cle = genre + '|' + message.slice(0, 120)
        var maintenant = Date.now()
        if (vues[cle] && maintenant - vues[cle] < 10000) return
        vues[cle] = maintenant
        if (++envoyees > 40) return
        extra = extra || {}
        envoyer('signaler_erreur', {
          source: SOURCE,
          genre: genre,
          code: extra.code || null,
          message: message.slice(0, 1000),
          pile: extra.pile ? String(extra.pile).slice(0, 3000) : null,
          statut_http: extra.statut_http || null,
          page: (location.pathname + location.hash).slice(0, 200),
          url: extra.url ? String(extra.url).slice(0, 500) : null,
          appareil: APPAREIL, systeme: SYSTEME, navigateur: NAVIGATEUR,
          ecran: ECRAN, langue: LANGUE, version: SOURCE === 'app' ? version() : null,
        })
      } catch (e) {}
    }

    /* Pour signaler à la main depuis le code : standixSignaler('CODE', 'message') */
    window.standixSignaler = function (code, message, details) {
      signaler('manuel', message || code, { code: code, pile: details ? texte(details) : null })
    }

    window.addEventListener('error', function (ev) {
      try {
        /* Une image ou un script qui ne charge pas : l'événement vient de l'élément. */
        var el = ev.target
        if (el && el !== window && (el.src || el.href)) {
          var lien = el.src || el.href
          if (/supabase\.co\/storage/.test(lien) || el.tagName === 'SCRIPT' || el.tagName === 'LINK') {
            signaler('ressource', (el.tagName || 'fichier').toLowerCase() + ' introuvable', {
              code: 'RESSOURCE', url: String(lien).split('?')[0],
            })
          }
          return
        }
        var err = ev.error
        signaler('js', ev.message || texte(err), {
          code: err && err.name && err.name !== 'Error' ? err.name : 'JS',
          pile: (err && err.stack) || (ev.filename ? ev.filename + ':' + ev.lineno + ':' + ev.colno : null),
        })
      } catch (e) {}
    }, true)

    window.addEventListener('unhandledrejection', function (ev) {
      try {
        var r = ev.reason
        signaler('promesse', texte(r) || 'Promesse rejetée', {
          code: (r && r.code) || (r && r.name && r.name !== 'Error' ? r.name : 'PROMESSE'),
          pile: r && r.stack,
        })
      } catch (e) {}
    })

    /* `console.error` : l'app y écrit déjà ses échecs. On les garde. */
    try {
      var consoleOrigine = console.error
      console.error = function () {
        try {
          var parts = []
          var pile = null
          for (var i = 0; i < arguments.length; i++) {
            var a = arguments[i]
            if (a instanceof Error && !pile) pile = a.stack
            parts.push(texte(a))
          }
          signaler('console', parts.join(' ').slice(0, 1000), {
            code: (arguments[1] && arguments[1].code) || 'CONSOLE', pile: pile,
          })
        } catch (e) {}
        return consoleOrigine.apply(console, arguments)
      }
    } catch (e) {}

    /* Les appels au serveur qui échouent (base, fonctions IA, Stripe…). La
       réponse est rendue telle quelle à l'app : on ne fait que regarder. */
    function nomAppel(u) {
      try {
        var p = new URL(u, location.href)
        return p.pathname.replace(/^\/(rest|functions|auth|storage)\/v1\//, '$1 ')
          .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '…').slice(0, 80)
      } catch (e) { return String(u).slice(0, 80) }
    }

    window.fetch = function (entree, options) {
      var u = ''
      try { u = typeof entree === 'string' ? entree : (entree && entree.url) || String(entree) } catch (e) {}
      var surveille = /supabase\.co|\/functions\/v1\//.test(u) && !/rpc\/(signaler_erreur|noter_visite)/.test(u)
      var p = fetchOrigine(entree, options)
      if (!surveille) return p
      return p.then(function (rep) {
        try {
          /* 401 : session expirée, l'app la renouvelle d'elle-même. */
          if (!rep.ok && rep.status !== 401) {
            var nom = nomAppel(u)
            rep.clone().text().then(function (corps) {
              var detail = ''
              try {
                var j = JSON.parse(corps)
                detail = j.message || j.error_description || j.error || j.msg || j.hint || ''
                if (typeof detail !== 'string') detail = JSON.stringify(detail)
                if (j.code && typeof j.code === 'string') nom += ' · ' + j.code
              } catch (e) { detail = (corps || '').slice(0, 200) }
              signaler('reseau', nom + ' → ' + rep.status + (detail ? ' : ' + detail : ''), {
                code: 'HTTP ' + rep.status, statut_http: rep.status, url: u.split('?')[0],
              })
            }).catch(function () {})
          }
        } catch (e) {}
        return rep
      }, function (err) {
        try {
          if (navigator.onLine !== false && !(err && err.name === 'AbortError')) {
            signaler('reseau', nomAppel(u) + ' → serveur injoignable : ' + texte(err), {
              code: 'RESEAU', url: u.split('?')[0],
            })
          }
        } catch (e) {}
        throw err
      })
    }

    /* ═══ ② LES VISITES (site seulement) ══════════════════════════════════ */

    if (SOURCE !== 'site') return

    var session
    try {
      session = sessionStorage.getItem('stx_s')
      if (!session) {
        session = Math.random().toString(36).slice(2) + Date.now().toString(36)
        sessionStorage.setItem('stx_s', session)
      }
    } catch (e) { session = Math.random().toString(36).slice(2) + Date.now().toString(36) }

    var debut = Date.now()
    var parametres = {}
    try { new URLSearchParams(location.search).forEach(function (v, k) { parametres[k] = v }) } catch (e) {}

    function referent() {
      try {
        if (!document.referrer) return null
        var h = new URL(document.referrer).hostname.replace(/^www\./, '')
        return h === location.hostname.replace(/^www\./, '') ? null : h
      } catch (e) { return null }
    }

    function fuseau() {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch (e) { return null }
    }

    function visite(evenement, extra) {
      var d = {
        session: session, evenement: evenement, page: location.pathname,
        appareil: APPAREIL, systeme: SYSTEME, navigateur: NAVIGATEUR, langue: LANGUE, fuseau: fuseau(),
      }
      for (var k in extra) d[k] = extra[k]
      envoyer('noter_visite', d)
    }

    visite('vue', {
      referent: referent(),
      utm_source: parametres.utm_source || parametres.ref || null,
      utm_campagne: parametres.utm_campaign || null,
    })

    document.addEventListener('click', function (ev) {
      try {
        var el = ev.target && ev.target.closest && ev.target.closest('a, button')
        if (!el) return
        var t = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50)
        var h = el.getAttribute('href') || ''
        if (/^mailto:/.test(h)) t = (t || 'email') + ' (mailto)'
        else if (h && h.charAt(0) !== '#') t = (t || 'lien') + ' → ' + h.split('?')[0].slice(0, 40)
        if (t) visite('clic', { cible: t.slice(0, 120) })
      } catch (e) {}
    }, true)

    var sortieNotee = false
    function sortie() {
      if (sortieNotee) return
      sortieNotee = true
      visite('sortie', { duree_s: Math.round((Date.now() - debut) / 1000) })
    }
    window.addEventListener('pagehide', sortie)
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') sortie()
    })
  } catch (e) {}
})()
