/* iOS Safari ignore `user-scalable=no` depuis iOS 10 : le seul moyen fiable de
     bloquer le zoom au pincement est d'intercepter ses événements de geste.
     Volontairement pas d'écouteur sur `touchmove` : non passif, il ferait
     attendre le navigateur à chaque défilement et remettrait des saccades. */
  /* Chronomètre de démarrage. Inactif par défaut ; s'affiche si on ouvre l'app
     avec ?debug=1 à la fin de l'adresse. Il note l'heure de chaque étape pour
     qu'on voie où part le temps au lieu de le supposer. */
  window.__chrono = []
  window.__blocages = []
  window.__fluidite = null
  window.__pirePause = null
  window.__cadence = null
  window.__appuis = []          // délai entre chaque appui et l'image suivante
  window.__fpsToucher = null    // cadence la plus basse observée pendant un défilement

  /* ═══ Ce qu'on mesure, et pourquoi ═══
     Compter les images par seconde sur une page immobile ne veut rien dire :
     un iPhone récent abaisse volontairement la cadence de son écran quand rien
     ne bouge. C'est pour ça qu'on lisait toujours 30, économie d'énergie ou pas.
     Ce qui compte, c'est le délai entre l'instant où le doigt touche l'écran et
     l'image suivante. C'est exactement ce que veut dire « je tape, il ne se
     passe rien ». Et la cadence, on ne la mesure que PENDANT un défilement. */
  document.addEventListener('pointerdown', function () {
    var t = performance.now()
    requestAnimationFrame(function () {
      var delai = Math.round(performance.now() - t)
      window.__appuis.push(delai)
      if (delai > 150) window.jalon('⚠ appui figé ' + delai + 'ms')
    })
  }, true)

  ;(function cadencePendantLeToucher() {
    var images = 0, debut = null, dernier = 0
    function tic(t) {
      if (debut !== null) {
        images++
        if (t - debut > 900) {
          var v = Math.round(images * 1000 / (t - debut))
          if (window.__fpsToucher === null || v < window.__fpsToucher) window.__fpsToucher = v
          debut = null
        }
      }
      requestAnimationFrame(tic)
    }
    requestAnimationFrame(tic)
    ;['pointermove', 'touchmove', 'scroll'].forEach(function (nom) {
      window.addEventListener(nom, function () {
        var t = performance.now()
        if (t - dernier > 1200) { debut = t; images = 0; dernier = t }
      }, { passive: true })
    })
  })()

  /* Cadence de l'écran, mesurée à vide juste après le chargement, avant que
     l'app ne fasse quoi que ce soit. Un iPhone récent donne 120, un plus ancien
     60. Si on lit 30 ici, c'est le mode économie d'énergie qui bride Safari —
     et aucune optimisation du code n'y changera rien. */
  /* App mise en veille, onglet changé, écran verrouillé : on coupe le son.
     Sans ça, une vidéo lancée continuait de jouer en arrière-plan. */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) return
    document.querySelectorAll('video').forEach(function (v) {
      try { if (!v.paused) v.pause() } catch (e) {}
    })
  })

  ;(function cadenceEcran() {
    var n = 0, t0 = null
    function tic(t) {
      if (t0 === null) t0 = t
      n++
      if (t - t0 < 1000) requestAnimationFrame(tic)
      else { window.__cadence = Math.round(n * 1000 / (t - t0)); window.jalon('écran : ' + window.__cadence + ' Hz') }
    }
    requestAnimationFrame(tic)
  })()

  function majPanneau() {
    if (!/[?&]debug=1/.test(location.search)) return
    var el = document.getElementById('chrono-debug')
    if (!el) {
      el = document.createElement('div')
      el.id = 'chrono-debug'
      el.style.cssText = 'position:fixed; top:0; left:0; right:0; z-index:9999;' +
        'background:rgba(0,0,0,0.92); color:#0F0; font:11px/1.45 ui-monospace,Menlo,monospace;' +
        'padding:8px 10px; white-space:pre; max-height:56vh; overflow:auto;'
      document.documentElement.appendChild(el)
    }
    var b = window.__blocages || []
    var pire = b.length ? Math.max.apply(null, b) : 0
    var a = window.__appuis || []
    var pireAppui = a.length ? Math.max.apply(null, a) : null
    var moyAppui = a.length ? Math.round(a.reduce(function (s, v) { return s + v }, 0) / a.length) : null

    /* Le résumé est écrit en premier : c'est la seule partie qui compte, et
       elle se retrouvait auparavant en bas du panneau, hors de l'écran. */
    var resume =
      '=== RÉSUMÉ ===\n' +
      'BLOCAGES : ' + (b.length ? b.length + ' · pire ' + pire + 'ms' : 'aucun') + '\n' +
      'APPUIS   : ' + (a.length ? a.length + ' · pire ' + pireAppui + 'ms · moy ' + moyAppui + 'ms'
                                : 'touchez l\'écran') + '\n' +
      'DEFILEM. : ' + (window.__fpsToucher == null ? 'faites defiler' : window.__fpsToucher + '/s') + '\n' +
      'ECRAN    : ' + (window.__cadence == null ? '…' : window.__cadence + ' Hz au repos') + '\n' +
      '==============\n'

    var prec = 0
    el.textContent = resume + window.__chrono.map(function (j) {
      var e = j[1] - prec; prec = j[1]
      return String(j[1]).padStart(6) + ' ms  +' + String(e).padStart(5) + '  ' + j[0]
    }).join('\n')
  }

  window.jalon = function (nom) {
    window.__chrono.push([nom, Math.round(performance.now())])
    if (/⚠/.test(nom)) console.warn('[Procédo] ' + nom)
    majPanneau()
  }

  // Le résumé se rafraîchit tout seul : appuis et défilement se mesurent
  // après coup, il ne faut pas attendre un nouveau jalon pour les voir.
  setInterval(majPanneau, 700)

  jalon('page lue')
  requestAnimationFrame(function () { requestAnimationFrame(function () { jalon('première image affichée') }) })

  // Le point-virgule est indispensable : sans lui, JavaScript rattache le
  // crochet ouvrant de la ligne suivante à l'appel du dessus et tout casse.
  ;['gesturestart', 'gesturechange', 'gestureend'].forEach(function (type) {
    document.addEventListener(type, function (e) { e.preventDefault() }, { passive: false })
  })
  /* Filet de sécurité : si iOS a malgré tout zoomé (vieille version en cache,
     champ ajouté plus tard...), on force le retour à l'échelle 1 en réécrivant
     brièvement la balise viewport — c'est le seul moyen de dézoomer par script. */
  function forcerDezoom() {
    var vp = document.querySelector('meta[name=viewport]')
    if (!vp) return
    var contenu = vp.getAttribute('content')
    vp.setAttribute('content', contenu.replace('maximum-scale=1.0', 'maximum-scale=0.99'))
    setTimeout(function () { vp.setAttribute('content', contenu) }, 80)
  }
  document.addEventListener('focusout', function () {
    setTimeout(function () {
      if (window.visualViewport && window.visualViewport.scale > 1.01) forcerDezoom()
    }, 60)
  })
  document.addEventListener('focusin', function (e) {
    if (!e.target.matches('input, textarea')) return
    /* Une police sous 16px est la seule cause du zoom automatique d'iOS.
       On corrige à la volée si un champ passe entre les mailles du filet. */
    var taille = parseFloat(getComputedStyle(e.target).fontSize)
    if (taille && taille < 16) e.target.style.fontSize = '16px'
  })


  setTimeout(function() {
    if (!window.__procedoLoaded) {
      var choice = document.getElementById('choice-screen')
      var login = document.getElementById('login-screen')
      var gestion = document.getElementById('gestion-app')
      var equipe = document.getElementById('equipe-app')
      var loginVisible = login && login.style.display === 'flex'
      var gestionVisible = gestion && gestion.style.display === 'block'
      var equipeVisible = equipe && equipe.style.display === 'block'
      /* Une session en cours de vérification compte comme une app en route : sur
         une connexion lente ce contrôle dépassait les six secondes, et le filet
         affichait l'écran de choix par-dessus l'app qui arrivait juste après. */
      var sessionEnCours = !!window.__procedoSessionEnCours
      if (!loginVisible && !gestionVisible && !equipeVisible && !sessionEnCours && choice) {
        document.body.classList.remove('booting')
        choice.style.display = 'flex'
        var logo = choice.querySelector('.boot-logo--once')
        if (logo) requestAnimationFrame(function () {
          requestAnimationFrame(function () { logo.classList.add('play') })
        })
      }
    }
  }, 6000)
