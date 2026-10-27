/* ═══════════════════════════════════════════════════════════════════════
   suivi.js — ce que le Dashboard privé voit (25 octobre 2026)
   ═══════════════════════════════════════════════════════════════════════

   Chargé par l'app (/app/) ET par le site. Deux rôles :

   ① LES ERREURS (app + site) — erreurs JavaScript, promesses rejetées,
     appels au serveur qui échouent, `console.error`. Envoyées à
     `signaler_erreur` ; le serveur y ajoute lui-même la personne et
     l'entreprise (impossible à falsifier depuis le navigateur).

   ② L'ACTIVITÉ (app seulement) — un signal toutes les 5 minutes pendant
     l'utilisation, pour repérer un compte utilisé par plusieurs personnes.

   ③ LES MESSAGES aux responsables (app seulement) — avertissements envoyés
     depuis le Dashboard, affichés dans une fenêtre « J'ai compris ».

   ④ LES VISITES (site seulement) — page vue, clics sur les liens et
     boutons, durée de la visite. Sans cookie, sans adresse IP : un
     identifiant au hasard, oublié à la fermeture de l'onglet.

   ⑤ L'ORIGINE (site + app, 26 octobre 2026) — le site ou la campagne qui a
     amené le visiteur, gardé dans l'onglet (`stx_origine`, oublié à sa
     fermeture). L'app l'envoie à la création d'une entreprise : le Dashboard
     sait alors d'où viennent les clients payants.

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
    if (/^\/admin(\.html)?(\/|$)/.test(chemin)) return // le Dashboard ne se surveille pas lui-même

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
        if (/signaler_erreur|noter_visite|noter_activite|noter_perf/.test(message)) return
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
          // Jamais de jeton de connexion (lien « mot de passe oublié ») dans le journal.
          page: (location.pathname + location.hash.replace(/((?:access|refresh|provider)_token|token_hash|token|code)=[^&]*/gi, '$1=…')).slice(0, 200),
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
      var surveille = /supabase\.co|\/functions\/v1\//.test(u) && !/rpc\/(signaler_erreur|noter_visite|noter_activite|noter_perf|mes_avertissements|lire_avertissement)/.test(u)
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

    /* ═══ ② L'ACTIVITÉ (app seulement) ═════════════════════════════════
       Toutes les 5 minutes pendant que l'app est ouverte et visible : sert à
       repérer un même compte utilisé EN MÊME TEMPS sur plusieurs appareils
       (compte partagé). Le serveur lit lui-même le compte, la connexion,
       l'appareil et le réseau. Sans connexion, rien n'est envoyé. */
    if (SOURCE === 'app') {
      var derniereActivite = 0
      var activite = function () {
        try {
          if (document.visibilityState !== 'visible' || !jeton()) return
          if (Date.now() - derniereActivite < 4 * 60 * 1000) return
          derniereActivite = Date.now()
          envoyer('noter_activite', { version: version() })
        } catch (e) {}
      }
      setTimeout(activite, 4000)
      setInterval(activite, 5 * 60 * 1000)
      document.addEventListener('visibilitychange', activite)

      /* La vitesse réelle : réponse du serveur, page lue, et app vraiment
         affichée (jalon « APP AFFICHÉE » de boot.js). Une fois par chargement. */
      var debutMesure = Date.now()
      var mesurer = function () {
        try {
          var chrono = window.__chrono || []
          var pret = null
          for (var i = 0; i < chrono.length; i++) if (/APP AFFICH/.test(chrono[i][0])) { pret = chrono[i][1]; break }
          if (pret === null && Date.now() - debutMesure < 25000) { setTimeout(mesurer, 1000); return }
          var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0]
          envoyer('noter_perf', {
            appareil: APPAREIL, systeme: SYSTEME, navigateur: NAVIGATEUR, version: version(),
            reseau: (navigator.connection && navigator.connection.effectiveType) || null,
            serveur_ms: nav ? String(Math.round(nav.responseStart)) : null,
            page_ms: nav ? String(Math.round(nav.domContentLoadedEventEnd)) : null,
            pret_ms: pret !== null ? String(Math.round(pret)) : null,
          })
        } catch (e) {}
      }
      if (document.readyState === 'complete') setTimeout(mesurer, 1500)
      else window.addEventListener('load', function () { setTimeout(mesurer, 1500) })
    }

    /* ═══ ANTI-PIRATAGE (app et site) ══════════════════════════════════
       Toute page de Standix ne charge du code que depuis une courte liste de
       domaines connus. Un script ou un cadre venu d'ailleurs (code injecté
       par un pirate) est signalé au Dashboard, une fois par domaine. */
    var DOMAINES_CONNUS = ['standix.app', 'www.standix.app', 'emcl22a-creator.github.io', 'fonts.googleapis.com', 'fonts.gstatic.com',
      'cdn.jsdelivr.net', 'tlrtsoahwqhtvtkhssbm.supabase.co', 'js.stripe.com', 'checkout.stripe.com', 'hooks.stripe.com', 'm.stripe.network']
    var dejaSignales = {}
    var verifierSource = function (url, genre) {
      try {
        if (!url || !/^https?:/i.test(url)) return
        var h = new URL(url, location.href).hostname
        if (h === location.hostname || DOMAINES_CONNUS.indexOf(h) >= 0 || dejaSignales[h]) return
        dejaSignales[h] = true
        signaler('intrusion', genre + ' inconnu chargé depuis ' + h, { code: 'INTRUSION', url: String(url).split('?')[0] })
      } catch (e) {}
    }
    var inspecter = function () {
      try {
        var el = document.querySelectorAll('script[src], iframe[src]')
        for (var i = 0; i < el.length; i++) verifierSource(el[i].src, el[i].tagName === 'IFRAME' ? 'Cadre' : 'Script')
        var res = (performance.getEntriesByType && performance.getEntriesByType('resource')) || []
        for (var j = 0; j < res.length; j++) if (res[j].initiatorType === 'script') verifierSource(res[j].name, 'Script')
      } catch (e) {}
    }
    if (document.readyState === 'complete') setTimeout(inspecter, 3000)
    else window.addEventListener('load', function () { setTimeout(inspecter, 3000) })
    try {
      new MutationObserver(function (liste) {
        for (var i = 0; i < liste.length; i++) {
          var ajouts = liste[i].addedNodes
          for (var j = 0; j < ajouts.length; j++) {
            var n = ajouts[j]
            if (n.tagName === 'SCRIPT' || n.tagName === 'IFRAME') verifierSource(n.src, n.tagName === 'IFRAME' ? 'Cadre' : 'Script')
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true })
    } catch (e) {}

    /* ═══ ③ LES MESSAGES DE STANDIX AUX RESPONSABLES (app seulement) ════
       Envoyés depuis le Dashboard privé (« Envoyer un avertissement »).
       À l'ouverture de l'app, un responsable (rôle gestion) de l'entreprise
       voit chaque message non lu dans une fenêtre, et doit toucher
       « J'ai compris ». Le serveur ne renvoie que les messages destinés à
       cette personne. Textes de l'interface en FR / EN / DE ; le message
       lui-même est celui écrit dans le Dashboard. */
    if (SOURCE === 'app') {
      var TXT = {
        fr: { ok: 'J’ai compris', source: 'Message de Standix', info: 'Information', avertissement: 'Avertissement', dernier: 'Dernier avertissement' },
        en: { ok: 'I understand', source: 'Message from Standix', info: 'Information', avertissement: 'Warning', dernier: 'Final warning' },
        de: { ok: 'Verstanden', source: 'Nachricht von Standix', info: 'Information', avertissement: 'Warnung', dernier: 'Letzte Warnung' },
      }
      var langue = function () { try { var l = localStorage.getItem('procedo_langue') || document.documentElement.lang || 'fr'; return TXT[l] ? l : 'fr' } catch (e) { return 'fr' } }
      var enCoursMsg = false, dernierControle = 0
      var appelRpc = function (nom, corps) {
        var t = jeton(); if (!t) return Promise.reject(new Error('pas de session'))
        return fetchOrigine(URL_SB + '/rest/v1/rpc/' + nom, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: CLE, Authorization: 'Bearer ' + t },
          body: JSON.stringify(corps || {}),
        }).then(function (r) { return r.ok ? r.text().then(function (x) { return x ? JSON.parse(x) : null }) : null })
      }
      var COULEURS = { info: ['#3A78EE', 'rgba(58,120,238,.12)'], avertissement: ['#D97706', 'rgba(217,119,6,.13)'], dernier: ['#DC2626', 'rgba(220,38,38,.12)'] }
      var ICONES = {
        info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
        avertissement: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
        dernier: '<circle cx="12" cy="12" r="10"/><path d="M4.9 4.9l14.2 14.2"/>',
      }
      var montrer = function (liste) {
        if (!liste || !liste.length) { enCoursMsg = false; return }
        var m = liste[0], T = TXT[langue()], c = COULEURS[m.niveau] || COULEURS.avertissement
        var sombre = matchMedia && matchMedia('(prefers-color-scheme: dark)').matches
        var fond = sombre ? '#16171C' : '#FFFFFF', texte = sombre ? '#F2F2F4' : '#0B0C10', gris = sombre ? '#A9ABB3' : '#6B6E76'
        var date = ''
        try { date = new Date(m.cree_le).toLocaleDateString(langue() === 'en' ? 'en-GB' : langue() === 'de' ? 'de-CH' : 'fr-FR', { day: 'numeric', month: 'long' }) } catch (e) {}
        var voile = document.createElement('div')
        voile.setAttribute('role', 'alertdialog'); voile.setAttribute('aria-modal', 'true')
        voile.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.42);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:0;transition:opacity .25s;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;touch-action:none'
        var echapper = function (x) { return String(x || '').replace(/[&<>"']/g, function (k) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[k] }) }
        voile.innerHTML =
          '<div style="width:100%;max-width:440px;margin:0 auto;background:' + fond + ';color:' + texte + ';border-radius:24px 24px 0 0;padding:26px 22px calc(18px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.25);transform:translateY(30px);transition:transform .3s cubic-bezier(.2,.8,.2,1);max-height:88vh;display:flex;flex-direction:column">' +
            '<div style="width:52px;height:52px;border-radius:16px;display:grid;place-items:center;background:' + c[1] + ';color:' + c[0] + ';margin-bottom:14px;flex:none"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONES[m.niveau] || ICONES.avertissement) + '</svg></div>' +
            '<div style="font-size:13px;font-weight:600;color:' + c[0] + ';margin-bottom:4px">' + T[m.niveau] + '</div>' +
            '<div style="font-size:21px;font-weight:700;letter-spacing:-.015em;line-height:1.25;margin-bottom:6px">' + echapper(m.titre) + '</div>' +
            '<div style="font-size:13px;color:' + gris + ';margin-bottom:14px">' + T.source + (date ? ' · ' + date : '') + '</div>' +
            '<div style="font-size:15.5px;line-height:1.55;white-space:pre-wrap;overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y;margin-bottom:20px">' + echapper(m.message) + '</div>' +
            '<button type="button" style="flex:none;width:100%;height:52px;border:0;border-radius:14px;background:linear-gradient(135deg,#1F4CEE 0%,#3A78EE 55%,#4899EC 100%);color:#fff;font:600 16px/1 Inter,-apple-system,sans-serif;cursor:pointer">' + T.ok + '</button>' +
          '</div>'
        if (innerWidth >= 700) { voile.style.alignItems = 'center'; voile.firstChild.style.borderRadius = '24px' }
        document.body.appendChild(voile)
        requestAnimationFrame(function () { voile.style.opacity = '1'; voile.firstChild.style.transform = 'none' })
        voile.querySelector('button').onclick = function (ev) {
          var b = ev.currentTarget; b.disabled = true; b.style.opacity = '.7'
          appelRpc('lire_avertissement', { p_id: m.id }).catch(function () {}).then(function () {
            voile.style.opacity = '0'
            setTimeout(function () { voile.remove(); montrer(liste.slice(1)) }, 260)
          })
        }
      }
      var verifierMessages = function () {
        try {
          if (enCoursMsg || document.visibilityState !== 'visible' || !jeton()) return
          if (Date.now() - dernierControle < 60 * 1000) return
          dernierControle = Date.now()
          enCoursMsg = true
          appelRpc('mes_avertissements').then(function (l) {
            if (Array.isArray(l) && l.length) montrer(l); else enCoursMsg = false
          }, function () { enCoursMsg = false })
        } catch (e) { enCoursMsg = false }
      }
      /* Après le démarrage de l'app (l'écran de chargement d'abord), puis
         au retour dans l'app et toutes les 10 minutes. */
      setTimeout(verifierMessages, 3500)
      setInterval(verifierMessages, 10 * 60 * 1000)
      document.addEventListener('visibilitychange', function () { setTimeout(verifierMessages, 800) })
    }

    /* ═══ ⑤ L'ORIGINE DU VISITEUR (site + app) ═══════════════════════════════

       Ce qui l'a amené : le site d'où il vient (nom de domaine seulement),
       les paramètres de campagne (utm_…), la page d'arrivée, l'heure. Dans
       l'onglet seulement, comme l'identifiant de visite.

       ⚠ LA PREMIÈRE ORIGINE COMPTE, sauf une nouvelle campagne : quelqu'un
         qui lit trois pages ne « vient » pas de la page d'avant. Mais un lien
         de campagne (utm) dit d'où il arrive vraiment.
       ⚠ DANS L'APP, ON N'ÉCRIT QUE CE QUI VIENT DE L'EXTÉRIEUR : un gérant qui
         rouvre l'app n'est pas une « visite directe ».
       ⚠ LES BOUTONS « ESSAYER » OUVRENT UN NOUVEL ONGLET, qui part sans rien
         de l'onglet du site. L'origine passe donc dans l'adresse du lien vers
         /app/ (paramètres o_…, ajoutés au moment du clic), et l'app la retire
         de son adresse dès qu'elle l'a lue. */
    try {
      var p5 = {}
      try { new URLSearchParams(location.search).forEach(function (v, k) { p5[k] = v }) } catch (e) {}
      var court = function (v, n) { return v ? String(v).slice(0, n) : null }
      var O5 = ['o_ref', 'o_src', 'o_med', 'o_camp', 'o_page', 'o_t']
      if (SOURCE === 'app' && (p5.o_ref || p5.o_src || p5.o_page)) {
        var quand5 = p5.o_t && !isNaN(Date.parse(p5.o_t)) ? new Date(p5.o_t).toISOString() : new Date().toISOString()
        sessionStorage.setItem('stx_origine', JSON.stringify({
          referent: court(p5.o_ref, 200), utm_source: court(p5.o_src, 100), utm_medium: court(p5.o_med, 100),
          utm_campagne: court(p5.o_camp, 150), page: court(p5.o_page, 200), quand: quand5,
        }))
        try {
          var u5 = new URL(location.href)
          O5.forEach(function (k) { u5.searchParams.delete(k) })
          history.replaceState(history.state, '', u5.pathname + (u5.searchParams.toString() ? '?' + u5.searchParams.toString() : '') + u5.hash)
        } catch (e) {}
        p5 = {}
      }
      if (SOURCE === 'site') {
        var versApp = function (ev) {
          try {
            var a = ev.target && ev.target.closest && ev.target.closest('a[href]')
            if (!a) return
            var u = new URL(a.getAttribute('href'), location.href)
            if (u.origin !== location.origin || !/^\/app(\/|$)/.test(u.pathname)) return
            var o = JSON.parse(sessionStorage.getItem('stx_origine') || 'null')
            if (!o) return
            var champs = { o_ref: o.referent, o_src: o.utm_source, o_med: o.utm_medium, o_camp: o.utm_campagne, o_page: o.page, o_t: o.quand }
            for (var k in champs) if (champs[k]) u.searchParams.set(k, champs[k]); else u.searchParams.delete(k)
            a.setAttribute('href', u.pathname + '?' + u.searchParams.toString() + u.hash)
          } catch (e) {}
        }
        document.addEventListener('click', versApp, true)
        document.addEventListener('auxclick', versApp, true)
      }
      var ref5 = null
      try {
        if (document.referrer) {
          var h5 = new URL(document.referrer).hostname.replace(/^www\./, '')
          if (h5 !== location.hostname.replace(/^www\./, '')) ref5 = h5
        }
      } catch (e) {}
      var campagne5 = p5.utm_source || p5.ref || null
      var deja5 = null
      try { deja5 = sessionStorage.getItem('stx_origine') } catch (e) {}
      if ((!deja5 && (SOURCE === 'site' || ref5 || campagne5)) || campagne5) {
        sessionStorage.setItem('stx_origine', JSON.stringify({
          referent: court(ref5, 200), utm_source: court(campagne5, 100),
          utm_medium: court(p5.utm_medium, 100), utm_campagne: court(p5.utm_campaign, 150),
          page: court(location.pathname, 200), quand: new Date().toISOString(),
        }))
      }
    } catch (e) {}

    /* ═══ ④ LES VISITES (site seulement) ══════════════════════════════════ */

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
