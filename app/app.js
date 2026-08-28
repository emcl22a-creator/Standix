let createClient

try {
  window.jalon?.('script exécuté, chargement de Supabase')
  let supabaseModule
  try {
    supabaseModule = await import('./supabase.js')
    window.jalon?.('Supabase prêt (fichier local)')
  } catch (localErr) {
    // Filet : si le fichier n'a pas encore été déposé dans le dépôt, on retombe
    // sur le serveur tiers plutôt que de laisser l'app inutilisable.
    console.warn('supabase.js introuvable en local, repli sur jsDelivr :', localErr && localErr.message)
    supabaseModule = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
    window.jalon?.('Supabase prêt (jsDelivr, repli)')
  }
  createClient = supabaseModule.createClient
  if (!createClient) throw new Error('createClient introuvable dans le module Supabase chargé')
} catch (e) {
  console.error('Échec du chargement de Supabase :', e)
  window.__procedoLoaded = true
  document.body.insertAdjacentHTML('beforeend', `
    <div style="position:fixed; inset:0; z-index:9999; background:#050506; display:flex; align-items:center; justify-content:center; padding:24px;">
      <div style="text-align:center; max-width:320px;">
        <p style="color:#fff; font-size:15px; font-weight:300; margin-bottom:8px;">Connexion impossible</p>
        <p style="color:rgba(235,235,245,0.6); font-size:13px; margin-bottom:14px;">Vérifiez votre connexion internet, puis réessayez.</p>
        <div style="background:rgba(255,69,58,0.12); border:1px solid rgba(255,69,58,0.4); border-radius:10px; padding:12px; margin-bottom:20px; text-align:left;">
          <p style="color:#FF6961; font-size:11px; font-weight:700; margin-bottom:4px;">DÉTAIL TECHNIQUE (build v3) :</p>
          <p style="color:#FF9B95; font-size:12px; word-break:break-word;">${(e && e.message) ? e.message : 'Erreur inconnue (pas de message)'}</p>
        </div>
        <button onclick="location.reload()" style="background:#fff; color:#000; padding:11px 24px; border-radius:100px; font-weight:300; font-size:14px; border:none;">Réessayer</button>
      </div>
    </div>
  `)
  throw e
}

// QRCode (génération) et jsQR (lecture caméra) ne sont chargés qu'au moment où
// on en a vraiment besoin, pas au démarrage — ça accélère nettement l'ouverture de l'app.
let QRCode = null
let jsQRLib = null
async function ensureQRCode() {
  if (!QRCode) {
    const mod = await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm')
    QRCode = mod.default
  }
  return QRCode
}
/* ═══════════════════════════════════════════════════════════════════════════
   LA CARTE DE BUREAU

   Dans l'angle, au-dessus de 900 px. Elle n'empêche rien : l'app reste celle
   du téléphone, entière.

   Le code mène à la PAGE DE CONNEXION — l'adresse du site sans rien d'autre.
   Sur son téléphone, la personne n'est probablement pas connectée : l'envoyer
   sur une page interne la ferait rebondir sans comprendre.
   ═══════════════════════════════════════════════════════════════════════════ */
async function poserCarteBureau() {
  const el = document.getElementById('pc-coin')
  if (!el || window.innerWidth < 900) return

  try {
    const QR = await ensureQRCode()
    const toile = document.createElement('canvas')
    /* La racine du site, pas `location.href` : c'est là que se trouve l'écran
       de connexion. */
    const adresse = location.origin + location.pathname.replace(/[^/]*$/, '')
    await QR.toCanvas(toile, adresse, {
      width: 132, margin: 0,
      color: { dark: '#0C0D0E', light: '#F5F5F7' },
    })
    document.getElementById('pc-qr')?.replaceChildren(toile)
    el.hidden = false
  } catch (e) {
    /* Sans code, la carte demanderait de scanner quelque chose qui n'existe
       pas. On ne l'affiche pas du tout. */
    console.warn('[bureau] code QR indisponible :', e.message)
  }
}

poserCarteBureau()

async function ensureJsQR() {
  if (!jsQRLib) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
      s.onload = resolve
      s.onerror = reject
      document.head.appendChild(s)
    })
    jsQRLib = window.jsQR
  }
  return jsQRLib
}

const SUPABASE_URL = 'https://tlrtsoahwqhtvtkhssbm.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_pzGIsj3EE2Sh_OBt21QbGg_4lKfitFw'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

/* ═══════════════════════════════════════════════════════════════════════════
   L'EN-TÊTE D'AUTORISATION DES FONCTIONS

   ═══ LE DÉFAUT ═══

   Six appels envoyaient `Bearer ${SUPABASE_ANON_KEY}` — la clé PUBLIQUE du
   projet, celle qui identifie l'application, pas la personne.

   Une fonction qui cherche ensuite « quel compte m'appelle ? » ne trouve rien :
   pour elle, l'appel est anonyme. D'où le « Compte introuvable » de `ai-start`,
   renvoyé en vingt-deux millisecondes — le temps de constater l'absence, sans
   même interroger la base.

   ═══ LA CORRECTION ═══

   On envoie le JETON DE SESSION, celui que Supabase délivre à la connexion. Il
   porte l'identifiant de la personne, et `auth.uid()` fonctionne enfin côté
   serveur.

   On retombe sur la clé publique si aucune session n'existe : certaines
   fonctions n'ont pas besoin d'identité, et il vaut mieux un appel anonyme
   qu'un appel sans en-tête du tout, que la passerelle refuserait d'emblée.
   ═══════════════════════════════════════════════════════════════════════════ */
async function enTeteFonction() {
  let jeton = SUPABASE_ANON_KEY
  try {
    const { data } = await supabase.auth.getSession()
    if (data?.session?.access_token) jeton = data.session.access_token
  } catch (e) {}
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}` }
}

let currentMembre = null
let manualSteps = []
let videoSteps = []
let ecapEditor = null     // éditeur de clip de l'écran de modification
let currentVideoFile = null
let allEquipeProcedures = []
let equipeEtapesByProc = {}
let equipeLues = new Set()      // identifiants des procédures que j'ai lues
let mesLectures = []            // mes validations, avec date et durée
/* Les deux tris de l'espace équipe. Ils vivent à côté de la dossier courante :
   ce sont les trois choses qui décrivent ce que l'employé regarde. */
let equipeCatSort = 'az'
let equipeProcSort = 'az'
let equipeCatCourante = null
let equipeCatQuery = ''
let scanStream = null
let scanLoopActive = false
/* ═══════════════════════════════════════════════════════════════════════════
   LANGUES

   Deux choses distinctes, et il ne faut pas les confondre :

   • la langue de L'APP — les libellés, les boutons, les messages. Elle se
     choisit dans les réglages et vaut pour toute la navigation.
   • la langue d'UNE PROCÉDURE — son titre et ses étapes. Elle se choisit sur la
     fiche elle-même, parce qu'on peut vouloir lire une consigne en portugais
     tout en gardant l'app en français.

   La procédure d'origine reste la référence : rien n'est écrit en base. Une
   traduction est une aide à la lecture, pas une nouvelle version officielle —
   distinction qui compte pour une consigne de travail.
   ═══════════════════════════════════════════════════════════════════════════ */

const LANGUES = [
  { code: 'fr', nom: 'Fran\u00e7ais',  drapeau: '\uD83C\uDDEB\uD83C\uDDF7' },
  { code: 'en', nom: 'English',   drapeau: '\uD83C\uDDEC\uD83C\uDDE7' },
  { code: 'es', nom: 'Espa\u00f1ol',   drapeau: '\uD83C\uDDEA\uD83C\uDDF8' },
  { code: 'de', nom: 'Deutsch',    drapeau: '\uD83C\uDDE9\uD83C\uDDEA' },
]

/* Le dictionnaire de l'app. Il couvre l'INTÉGRALITÉ de l'espace équipe : les
   46 libellés du balisage, plus les phrases fixes insérées par le code. Douze
   langues à moitié traduites valaient moins que quatre qui le sont vraiment —
   une interface à demi traduite est plus déroutante qu'une interface en français.

   Ajouter une langue revient désormais à ajouter une colonne ici : la mécanique
   est faite, il ne manque que le texte.

   La clé est la phrase française elle-même. Une phrase absente reste en
   français plutôt que d'afficher un code technique. */
const DICO = {
  en: {
    // ── espace gestion ──
    "Vous pouvez quitter cette page": "You can leave this page",
    "la procédure apparaîtra dans votre liste dès qu'elle sera prête.": "the procedure will appear in your list as soon as it is ready.",
    "Préparation": "Getting ready",
    "Vous pouvez quitter cette page, l'analyse continue.": "You can leave this page — we'll keep going.",
    "Lecture de votre vidéo": "Reading your video",
    "Mise en forme": "Almost there",
    "Presque prêt": "Almost ready",
    "C'est plus long que d'habitude, mais l'analyse tourne toujours.": "This is taking longer than usual, but the analysis is still running.",
    "Collez votre texte ci-dessous, ou déposez un fichier. L'IA en tirera des étapes\n        que vous pourrez": "Paste your text below, or drop a file. The AI will draw steps from it that you can",
    ". Au-delà, l'analyse devient longue et le découpage moins fiable — filmez plutôt une procédure par vidéo.": ". Beyond that, the analysis gets long and the cutting less reliable — film one procedure per video instead.",
    "+ Ajouter une étape": "+ Add a step",
    "+ Découper une étape ici": "+ Cut a step here",
    "Abandonner et supprimer": "Cancel and delete",
    "Activité": "Activity",
    "Actuel": "Current",
    "Analyse": "Analytics",
    "Analyse en cours...": "Analysing…",
    "Analyse en cours": "Analysis in progress",
    "Ancien → nouveau": "Oldest → newest",
    "Annuler": "Cancel",
    "Arrivés récemment": "Recently joined",
    "Aucune vidéo importée": "No video imported",
    "Autorisez la caméra pour scanner": "Allow the camera to scan",
    "Bonjour 👋": "Hello 👋",
    "Dossier": "Category",
    "Dossiers les plus consultées": "Most viewed categories",
    "Ce mois-ci": "This month",
    "Cette semaine": "This week",
    "Chaque étape découpée se lie automatiquement au moment de la vidéo où vous étiez.": "Each step you cut is automatically linked to the point in the video you were at.",
    "Chargement...": "Loading…",
    "Chargement…": "Loading…",
    "Code d'accès rapide": "Quick access code",
    "Code d'invitation équipe": "Team invitation code",
    "Collez ici votre procédure, votre note de service, votre mode d'emploi…": "Paste your procedure, memo or instructions here…",
    "Collez un texte, ou déposez un PDF ou un Word": "Paste a text, or drop a PDF or Word file",
    "Comment créer cette procédure ?": "How do you want to create it?",
    "Complétez le titre et la dossier ci-dessus pour continuer.": "Fill in the title and category above to continue.",
    "Compte": "Account",
    "Consulté": "Viewed",
    "Copier ce détail": "Copy this detail",
    "Copier le code": "Copy the code",
    "Diviser": "Split",
    "Début": "Start",
    "Début ici": "Start here",
    "Découper une vidéo": "Cut a video",
    "Détail technique": "Technical detail",
    "E-mail": "Email",
    "Employés": "Employees",
    "Enregistrer": "Save",
    "Enregistrer les modifications": "Save changes",
    "Espace Gestion": "Manager space",
    "Ex : Cuisine": "e.g. Kitchen",
    "Ex : Fermeture de caisse": "e.g. Cash register closing",
    "Faites glisser pour affiner au dixième de seconde": "Drag to fine-tune to a tenth of a second",
    "Filmez la tâche en expliquant à voix haute, l'IA génère les étapes": "Film the task while explaining out loud, the AI writes the steps",
    "Filmez puis découpez chaque étape": "Film, then cut each step",
    "Vidéo de 5 min maximum": "Video, 5 min maximum",
    "Fin": "End",
    "Fin ici": "End here",
    "Glissez sur la frise pour naviguer dans la vidéo": "Drag the timeline to move through the video",
    "Générer les étapes": "Generate the steps",
    "Gérer l'équipe": "Manage the team",
    "Importez une vidéo puis coupez chaque étape": "Import a video then cut each step",
    "Informations personnelles": "Personal details",
    "Jours actifs": "Active days",
    "Jusqu'à 10 membres · fonctionnalités essentielles": "Up to 10 members · essential features",
    "Jusqu'à 25 membres · IA incluse · vérification vidéo": "Up to 25 members · AI included · video check",
    "L'IA transforme la vidéo en une procédure": "The AI turns the video into a procedure",
    "L'IA rédige la procédure à partir d'un document": "The AI writes the procedure from a document",
    "L'IA lit votre document…": "The AI is reading your document…",
    "L'IA travaille au mieux sur des vidéos de": "The AI works best on videos of",
    "Votre procédure apparaîtra dans la liste dès qu'elle sera prête.": "Your procedure will appear in your list as soon as it's ready.",
    "Lancer l'analyse": "Start the analysis",
    "Les moins actifs": "Least active",
    "Les plus actifs": "Most active",
    "Lire": "Play",
    "Lues": "Read",
    "Membres illimités · multi-sites": "Unlimited members · multi-site",
    "Modifier": "Edit",
    "Mois": "Month",
    "Nom A → Z": "Name A → Z",
    "Nom complet": "Full name",
    "Nouveau → ancien": "Newest → oldest",
    "Nouvelle procédure": "New procedure",
    "Ont consulté": "Have viewed",
    "Paramètres": "Settings",
    "Partagez ce code à votre équipe pour qu'elle puisse créer son compte et accéder aux procédures": "Share this code with your team so they can create an account and access the procedures",
    "Pas encore consultées": "Not viewed yet",
    "Procédure générée": "Procedure generated",
    "Procédures": "Procedures",
    "Procédures consultées": "Procedures viewed",
    "Procédures les plus consultées": "Most viewed procedures",
    "Publier la procédure": "Publish the procedure",
    "Quelques secondes. Vous relirez chaque étape ensuite.": "A few seconds. You will review each step afterwards.",
    "Rechercher une procédure...": "Search a procedure…",
    "Retirer une personne lui coupe immédiatement l'accès aux procédures de l'entreprise. Son compte Standix reste actif : elle pourra rejoindre une autre entreprise avec un nouveau code.": "Removing someone immediately cuts their access to the company procedures. Their Standix account stays active: they can join another company with a new code.",
    "Scanner un code": "Scan a code",
    "Scannez pour ouvrir la procédure": "Scan to open the procedure",
    "Se déconnecter": "Sign out",
    "Semaine": "Week",
    "Terminer le réglage": "Finish adjusting",
    "Titre": "Title",
    "Total": "Total",
    "Touchez une étape ci-dessous pour régler son clip": "Tap a step below to adjust its clip",
    "Tous les membres de l'équipe": "All team members",
    "Trier : A → Z": "Sort: A → Z",
    "Trier : les plus actifs": "Sort: most active",
    "Télécharger la fiche": "Download the sheet",
    "Un souci, une idée, une question sur Standix ? Nous lisons tout et nous répondons au plus vite.": "A problem, an idea, a question about Standix? We read everything and reply as soon as we can.",
    "Une consigne écrite, une fiche, un mode d'emploi": "A written instruction, a sheet, a manual",
    "Une question ?": "A question?",
    "Visez le QR code affiché sur un poste pour ouvrir sa procédure": "Point at the QR code displayed at a station to open its procedure",
    "Voir la procédure": "View the procedure",
    "Votre abonnement": "Your plan",
    "Votre compte et votre abonnement": "Your account and your plan",
    "Votre texte": "Your text",
    "Votre équipe": "Your team",
    "Vous pouvez quitter cette page": "You can leave this page",
    "Vue d'ensemble de votre entreprise": "Overview of your company",
    "Vérifiez et ajustez avant de continuer": "Check and adjust before continuing",
    "avant publication.": "before publishing.",
    "chevauchement": "overlap",
    "couvert": "covered",
    "moins de 5 minutes": "under 5 minutes",
    "ou": "or",
    "relire et corriger": "review and correct",
    "trou": "gap",
    "Accéder directement à la procédure en scannant le QR code": "Scan the QR code to open the procedure straight away",
    "À lire": "To read",
    "Écrivez chaque étape dans l'ordre": "Write each step in order",
    "Écrivez chaque étape vous-même": "Write each step yourself",
    "Écrivez les étapes, ou découpez une vidéo": "Write the steps, or cut a video",
    "Écrivez-nous": "Write to us",
    "Étapes": "Steps",
    "Étapes de la procédure": "Procedure steps",
    "Étapes liées": "Linked steps",
    "Étapes manuelles": "Manual steps",
    "— la procédure apparaîtra dans votre liste dès qu'elle sera prête.": "— the procedure will appear in your list as soon as it is ready.",

    // ── espace équipe ──
    // ── navigation et en-têtes ──
    'Espace \u00c9quipe': 'Team space',
    'Proc\u00e9dures': 'Procedures',
    'Activit\u00e9': 'Activity',
    'Cat\u00e9gories': 'Categories',
    'Param\u00e8tres': 'Settings',
    'Scanner un code': 'Scan a code',
    'Mon activit\u00e9': 'My activity',
    'Bonjour \uD83D\uDC4B': 'Hello \uD83D\uDC4B',
    'Chargement\u2026': 'Loading\u2026',
    // ── accueil et listes ──
    'Rechercher une proc\u00e9dure': 'Search a procedure',
    'Rechercher dans cette cat\u00e9gorie': 'Search in this category',
    'Cat\u00e9gorie': 'Category',
    '\u00c0 lire': 'To read',
    'Lue': 'Read',
    'Lues': 'Read',
    'Temps total': 'Total time',
    "Jours d'affil\u00e9e": 'Day streak',
    'En tout': 'In total',
    // ── écran d'activité ──
    'En chiffres': 'In figures',
    'Par cat\u00e9gorie': 'By category',
    'Temps par proc\u00e9dure': 'Time per procedure',
    'Il vous reste \u00e0 lire': 'Left to read',
    'Rien ne vous attend': 'Nothing pending',
    'Taux de lecture': 'Reading rate',
    'Cette semaine': 'This week',
    'Temps moyen par proc\u00e9dure': 'Average time per procedure',
    'Journ\u00e9es actives': 'Active days',
    'Derni\u00e8re lecture': 'Last read',
    'Plus longue lecture': 'Longest read',
    // ── fiche d'une procédure ──
    'Lire dans une autre langue': 'Read in another language',
    '\u00c9tapes de la proc\u00e9dure': 'Procedure steps',
    'Lecture en cours': 'Reading',
    'Proc\u00e9dure consult\u00e9e': 'Procedure read',
    'Aucune \u00e9tape': 'No steps',
    'Les autres proc\u00e9dures ne vous sont pas accessibles': 'The other procedures are not available to you',
    "Demandez le code de l'entreprise \u00e0 votre responsable pour y acc\u00e9der.": 'Ask your manager for the company code to access them.',
    // ── scanner ──
    'Autorisez la cam\u00e9ra pour scanner': 'Allow the camera to scan',
    'Visez le QR code': 'Point at the QR code',
    'Code reconnu': 'Code recognised',
    'Acc\u00e9der \u00e0 la proc\u00e9dure': 'Open the procedure',
    "Ce n'est pas celle-l\u00e0": "That's not the one",
    'Bienvenue': 'Welcome',
    // ── réglages ──
    'Votre compte et votre entreprise': 'Your account and your company',
    'Vos informations': 'Your details',
    'Nom complet': 'Full name',
    'E-mail': 'Email',
    'Enregistrer': 'Save',
    'Langue': 'Language',
    "Langue de l'application": 'App language',
    'Vos entreprises': 'Your companies',
    'Rejoindre': 'Join',
    'Rejoindre une autre entreprise': 'Join another company',
    'D\u00e9bloquer': 'Unlock',
    "Entrez le code \u00e0 6 caract\u00e8res que votre responsable vous a communiqu\u00e9. Il sera retenu : l'entreprise appara\u00eetra dans la liste au-dessus.":
      'Enter the 6-character code your manager gave you. It will be remembered: the company will appear in the list above.',
    'Une question ?': 'A question?',
    '\u00c9crivez-nous': 'Write to us',
    'Un souci, une id\u00e9e, une question sur Standix ? Nous lisons tout et nous r\u00e9pondons au plus vite.':
      'A problem, an idea, a question about Standix? We read everything and reply as soon as we can.',
    'Compte': 'Account',
    'Se d\u00e9connecter': 'Sign out',
  },

  es: {
    // ── espace gestion ──
    "Préparation": "Preparando",
    "Vous pouvez quitter cette page, l'analyse continue.": "Puede salir de esta página, seguimos trabajando.",
    "Lecture de votre vidéo": "Leyendo su vídeo",
    "Mise en forme": "Ya casi está",
    "Presque prêt": "Casi listo",
    "C'est plus long que d'habitude, mais l'analyse tourne toujours.": "Está tardando más de lo habitual, pero el análisis sigue en marcha.",
    "Collez votre texte ci-dessous, ou déposez un fichier. L'IA en tirera des étapes\n        que vous pourrez": "Pega tu texto abajo, o suelta un archivo. La IA extraerá pasos que podrás",
    ". Au-delà, l'analyse devient longue et le découpage moins fiable — filmez plutôt une procédure par vidéo.": ". Más allá, el análisis se alarga y el corte es menos fiable — graba mejor un procedimiento por vídeo.",
    "+ Ajouter une étape": "+ Añadir un paso",
    "+ Découper une étape ici": "+ Cortar un paso aquí",
    "Abandonner et supprimer": "Abandonar y eliminar",
    "Activité": "Actividad",
    "Actuel": "Actual",
    "Analyse": "Análisis",
    "Analyse en cours...": "Analizando…",
    "Analyse en cours": "Análisis en curso",
    "Ancien → nouveau": "Antiguo → nuevo",
    "Annuler": "Cancelar",
    "Arrivés récemment": "Incorporados recientemente",
    "Aucune vidéo importée": "Ningún vídeo importado",
    "Autorisez la caméra pour scanner": "Autoriza la cámara para escanear",
    "Bonjour 👋": "Hola 👋",
    "Dossier": "Categoría",
    "Dossiers les plus consultées": "Categorías más consultadas",
    "Ce mois-ci": "Este mes",
    "Cette semaine": "Esta semana",
    "Chaque étape découpée se lie automatiquement au moment de la vidéo où vous étiez.": "Cada paso cortado se vincula automáticamente al momento del vídeo en el que estabas.",
    "Chargement...": "Cargando…",
    "Chargement…": "Cargando…",
    "Code d'accès rapide": "Código de acceso rápido",
    "Code d'invitation équipe": "Código de invitación del equipo",
    "Collez ici votre procédure, votre note de service, votre mode d'emploi…": "Pega aquí tu procedimiento, tu nota interna, tu manual…",
    "Collez un texte, ou déposez un PDF ou un Word": "Pega un texto, o suelta un PDF o un Word",
    "Comment créer cette procédure ?": "¿Cómo crear este procedimiento?",
    "Complétez le titre et la dossier ci-dessus pour continuer.": "Completa el título y la categoría de arriba para continuar.",
    "Compte": "Cuenta",
    "Consulté": "Consultado",
    "Copier ce détail": "Copiar este detalle",
    "Copier le code": "Copiar el código",
    "Diviser": "Dividir",
    "Début": "Inicio",
    "Début ici": "Inicio aquí",
    "Découper une vidéo": "Cortar un vídeo",
    "Détail technique": "Detalle técnico",
    "E-mail": "Correo",
    "Employés": "Empleados",
    "Enregistrer": "Guardar",
    "Enregistrer les modifications": "Guardar los cambios",
    "Espace Gestion": "Espacio Gestión",
    "Ex : Cuisine": "Ej.: Cocina",
    "Ex : Fermeture de caisse": "Ej.: Cierre de caja",
    "Faites glisser pour affiner au dixième de seconde": "Arrastra para ajustar a la décima de segundo",
    "Filmez la tâche en expliquant à voix haute, l'IA génère les étapes": "Graba la tarea explicando en voz alta, la IA genera los pasos",
    "Filmez puis découpez chaque étape": "Graba y luego corta cada paso",
    "Vidéo de 5 min maximum": "Vídeo de 5 min máximo",
    "Fin": "Fin",
    "Fin ici": "Fin aquí",
    "Glissez sur la frise pour naviguer dans la vidéo": "Desliza por la línea de tiempo para navegar por el vídeo",
    "Générer les étapes": "Generar los pasos",
    "Gérer l'équipe": "Gestionar el equipo",
    "Importez une vidéo puis coupez chaque étape": "Importa un vídeo y corta cada paso",
    "Informations personnelles": "Datos personales",
    "Jours actifs": "Días activos",
    "Jusqu'à 10 membres · fonctionnalités essentielles": "Hasta 10 miembros · funciones esenciales",
    "Jusqu'à 25 membres · IA incluse · vérification vidéo": "Hasta 25 miembros · IA incluida · verificación por vídeo",
    "L'IA transforme la vidéo en une procédure": "La IA convierte el vídeo en un procedimiento",
    "L'IA rédige la procédure à partir d'un document": "La IA redacta el procedimiento a partir de un documento",
    "L'IA lit votre document…": "La IA está leyendo tu documento…",
    "L'IA travaille au mieux sur des vidéos de": "La IA funciona mejor con vídeos de",
    "Votre procédure apparaîtra dans la liste dès qu'elle sera prête.": "Su procedimiento aparecerá en la lista en cuanto esté listo.",
    "Lancer l'analyse": "Iniciar el análisis",
    "Les moins actifs": "Los menos activos",
    "Les plus actifs": "Los más activos",
    "Lire": "Reproducir",
    "Lues": "Leídos",
    "Membres illimités · multi-sites": "Miembros ilimitados · multisede",
    "Modifier": "Editar",
    "Mois": "Mes",
    "Nom A → Z": "Nombre A → Z",
    "Nom complet": "Nombre completo",
    "Nouveau → ancien": "Nuevo → antiguo",
    "Nouvelle procédure": "Nuevo procedimiento",
    "Ont consulté": "Han consultado",
    "Paramètres": "Ajustes",
    "Partagez ce code à votre équipe pour qu'elle puisse créer son compte et accéder aux procédures": "Comparte este código con tu equipo para que pueda crear su cuenta y acceder a los procedimientos",
    "Pas encore consultées": "Aún sin consultar",
    "Procédure générée": "Procedimiento generado",
    "Procédures": "Procedimientos",
    "Procédures consultées": "Procedimientos consultados",
    "Procédures les plus consultées": "Procedimientos más consultados",
    "Publier la procédure": "Publicar el procedimiento",
    "Quelques secondes. Vous relirez chaque étape ensuite.": "Unos segundos. Después revisarás cada paso.",
    "Rechercher une procédure...": "Buscar un procedimiento…",
    "Retirer une personne lui coupe immédiatement l'accès aux procédures de l'entreprise. Son compte Standix reste actif : elle pourra rejoindre une autre entreprise avec un nouveau code.": "Quitar a una persona le corta inmediatamente el acceso a los procedimientos de la empresa. Su cuenta Standix sigue activa: podrá unirse a otra empresa con un nuevo código.",
    "Scanner un code": "Escanear un código",
    "Scannez pour ouvrir la procédure": "Escanea para abrir el procedimiento",
    "Se déconnecter": "Cerrar sesión",
    "Semaine": "Semana",
    "Terminer le réglage": "Terminar el ajuste",
    "Titre": "Título",
    "Total": "Total",
    "Touchez une étape ci-dessous pour régler son clip": "Toca un paso abajo para ajustar su clip",
    "Tous les membres de l'équipe": "Todos los miembros del equipo",
    "Trier : A → Z": "Ordenar: A → Z",
    "Trier : les plus actifs": "Ordenar: los más activos",
    "Télécharger la fiche": "Descargar la ficha",
    "Un souci, une idée, une question sur Standix ? Nous lisons tout et nous répondons au plus vite.": "¿Un problema, una idea, una duda sobre Standix? Lo leemos todo y respondemos lo antes posible.",
    "Une consigne écrite, une fiche, un mode d'emploi": "Una instrucción escrita, una ficha, un manual",
    "Une question ?": "¿Una pregunta?",
    "Visez le QR code affiché sur un poste pour ouvrir sa procédure": "Apunta al código QR de un puesto para abrir su procedimiento",
    "Voir la procédure": "Ver el procedimiento",
    "Votre abonnement": "Tu suscripción",
    "Votre compte et votre abonnement": "Tu cuenta y tu suscripción",
    "Votre texte": "Tu texto",
    "Votre équipe": "Tu equipo",
    "Vous pouvez quitter cette page": "Puedes salir de esta página",
    "Vue d'ensemble de votre entreprise": "Visión general de tu empresa",
    "Vérifiez et ajustez avant de continuer": "Revisa y ajusta antes de continuar",
    "avant publication.": "antes de publicar.",
    "chevauchement": "solapamiento",
    "couvert": "cubierto",
    "moins de 5 minutes": "menos de 5 minutos",
    "ou": "o",
    "relire et corriger": "revisar y corregir",
    "trou": "hueco",
    "Accéder directement à la procédure en scannant le QR code": "Escanea el código QR para abrir el procedimiento al instante",
    "À lire": "Por leer",
    "Écrivez chaque étape dans l'ordre": "Escribe cada paso en orden",
    "Écrivez chaque étape vous-même": "Escribe cada paso tú mismo",
    "Écrivez les étapes, ou découpez une vidéo": "Escribe los pasos, o corta un vídeo",
    "Écrivez-nous": "Escríbenos",
    "Étapes": "Pasos",
    "Étapes de la procédure": "Pasos del procedimiento",
    "Étapes liées": "Pasos enlazados",
    "Étapes manuelles": "Pasos manuales",
    "— la procédure apparaîtra dans votre liste dès qu'elle sera prête.": "— el procedimiento aparecerá en tu lista en cuanto esté listo.",

    // ── espace équipe ──
    'Espace \u00c9quipe': 'Espacio Equipo',
    'Proc\u00e9dures': 'Procedimientos',
    'Activit\u00e9': 'Actividad',
    'Cat\u00e9gories': 'Categor\u00edas',
    'Param\u00e8tres': 'Ajustes',
    'Scanner un code': 'Escanear un c\u00f3digo',
    'Mon activit\u00e9': 'Mi actividad',
    'Bonjour \uD83D\uDC4B': 'Hola \uD83D\uDC4B',
    'Chargement\u2026': 'Cargando\u2026',
    'Rechercher une proc\u00e9dure': 'Buscar un procedimiento',
    'Rechercher dans cette cat\u00e9gorie': 'Buscar en esta categor\u00eda',
    'Cat\u00e9gorie': 'Categor\u00eda',
    '\u00c0 lire': 'Por leer',
    'Lue': 'Le\u00edo',
    'Lues': 'Le\u00eddos',
    'Temps total': 'Tiempo total',
    "Jours d'affil\u00e9e": 'D\u00edas seguidos',
    'En tout': 'En total',
    'En chiffres': 'En cifras',
    'Par cat\u00e9gorie': 'Por categor\u00eda',
    'Temps par proc\u00e9dure': 'Tiempo por procedimiento',
    'Il vous reste \u00e0 lire': 'Te queda por leer',
    'Rien ne vous attend': 'Nada pendiente',
    'Taux de lecture': 'Tasa de lectura',
    'Cette semaine': 'Esta semana',
    'Temps moyen par proc\u00e9dure': 'Tiempo medio por procedimiento',
    'Journ\u00e9es actives': 'D\u00edas activos',
    'Derni\u00e8re lecture': '\u00daltima lectura',
    'Plus longue lecture': 'Lectura m\u00e1s larga',
    'Lire dans une autre langue': 'Leer en otro idioma',
    '\u00c9tapes de la proc\u00e9dure': 'Pasos del procedimiento',
    'Lecture en cours': 'Leyendo',
    'Proc\u00e9dure consult\u00e9e': 'Procedimiento le\u00eddo',
    'Aucune \u00e9tape': 'Sin pasos',
    'Les autres proc\u00e9dures ne vous sont pas accessibles': 'Los dem\u00e1s procedimientos no est\u00e1n disponibles',
    "Demandez le code de l'entreprise \u00e0 votre responsable pour y acc\u00e9der.": 'Pide el c\u00f3digo de la empresa a tu responsable para acceder.',
    'Autorisez la cam\u00e9ra pour scanner': 'Autoriza la c\u00e1mara para escanear',
    'Visez le QR code': 'Apunta al c\u00f3digo QR',
    'Code reconnu': 'C\u00f3digo reconocido',
    'Acc\u00e9der \u00e0 la proc\u00e9dure': 'Abrir el procedimiento',
    "Ce n'est pas celle-l\u00e0": 'No es este',
    'Bienvenue': 'Bienvenido',
    'Votre compte et votre entreprise': 'Tu cuenta y tu empresa',
    'Vos informations': 'Tus datos',
    'Nom complet': 'Nombre completo',
    'E-mail': 'Correo',
    'Enregistrer': 'Guardar',
    'Langue': 'Idioma',
    "Langue de l'application": 'Idioma de la aplicaci\u00f3n',
    'Vos entreprises': 'Tus empresas',
    'Rejoindre': 'Unirse',
    'Rejoindre une autre entreprise': 'Unirse a otra empresa',
    'D\u00e9bloquer': 'Desbloquear',
    "Entrez le code \u00e0 6 caract\u00e8res que votre responsable vous a communiqu\u00e9. Il sera retenu : l'entreprise appara\u00eetra dans la liste au-dessus.":
      'Introduce el c\u00f3digo de 5 cifras que te dio tu responsable. Se guardar\u00e1: la empresa aparecer\u00e1 en la lista de arriba.',
    'Une question ?': '\u00bfUna pregunta?',
    '\u00c9crivez-nous': 'Escr\u00edbenos',
    'Un souci, une id\u00e9e, une question sur Standix ? Nous lisons tout et nous r\u00e9pondons au plus vite.':
      '\u00bfUn problema, una idea, una duda sobre Standix? Lo leemos todo y respondemos lo antes posible.',
    'Compte': 'Cuenta',
    'Se d\u00e9connecter': 'Cerrar sesi\u00f3n',
  },

  pt: {
    // ── espace gestion ──
    "Préparation": "A preparar",
    "Vous pouvez quitter cette page, l'analyse continue.": "Pode sair desta página, continuamos a trabalhar.",
    "Lecture de votre vidéo": "A ler o seu vídeo",
    "Mise en forme": "Quase lá",
    "Presque prêt": "Quase pronto",
    "C'est plus long que d'habitude, mais l'analyse tourne toujours.": "Está a demorar mais do que o habitual, mas a análise continua a correr.",
    "Collez votre texte ci-dessous, ou déposez un fichier. L'IA en tirera des étapes\n        que vous pourrez": "Cole o seu texto abaixo, ou largue um ficheiro. A IA extrairá etapas que poderá",
    ". Au-delà, l'analyse devient longue et le découpage moins fiable — filmez plutôt une procédure par vidéo.": ". Acima disso, a análise demora e o corte é menos fiável — filme antes um procedimento por vídeo.",
    "+ Ajouter une étape": "+ Adicionar uma etapa",
    "+ Découper une étape ici": "+ Cortar uma etapa aqui",
    "Abandonner et supprimer": "Abandonar e eliminar",
    "Activité": "Atividade",
    "Actuel": "Atual",
    "Analyse": "Análise",
    "Analyse en cours...": "A analisar…",
    "Analyse en cours": "Análise em curso",
    "Ancien → nouveau": "Antigo → novo",
    "Annuler": "Cancelar",
    "Arrivés récemment": "Entraram recentemente",
    "Aucune vidéo importée": "Nenhum vídeo importado",
    "Autorisez la caméra pour scanner": "Autorize a câmara para ler",
    "Bonjour 👋": "Olá 👋",
    "Dossier": "Categoria",
    "Dossiers les plus consultées": "Categorias mais consultadas",
    "Ce mois-ci": "Este mês",
    "Cette semaine": "Esta semana",
    "Chaque étape découpée se lie automatiquement au moment de la vidéo où vous étiez.": "Cada etapa cortada liga-se automaticamente ao momento do vídeo em que estava.",
    "Chargement...": "A carregar…",
    "Chargement…": "A carregar…",
    "Code d'accès rapide": "Código de acesso rápido",
    "Code d'invitation équipe": "Código de convite da equipa",
    "Collez ici votre procédure, votre note de service, votre mode d'emploi…": "Cole aqui o seu procedimento, a sua nota de serviço, o seu manual…",
    "Collez un texte, ou déposez un PDF ou un Word": "Cole um texto, ou largue um PDF ou Word",
    "Comment créer cette procédure ?": "Como criar este procedimento?",
    "Complétez le titre et la dossier ci-dessus pour continuer.": "Preencha o título e a categoria acima para continuar.",
    "Compte": "Conta",
    "Consulté": "Consultado",
    "Copier ce détail": "Copiar este detalhe",
    "Copier le code": "Copiar o código",
    "Diviser": "Dividir",
    "Début": "Início",
    "Début ici": "Início aqui",
    "Découper une vidéo": "Cortar um vídeo",
    "Détail technique": "Detalhe técnico",
    "E-mail": "E-mail",
    "Employés": "Funcionários",
    "Enregistrer": "Guardar",
    "Enregistrer les modifications": "Guardar as alterações",
    "Espace Gestion": "Espaço Gestão",
    "Ex : Cuisine": "Ex.: Cozinha",
    "Ex : Fermeture de caisse": "Ex.: Fecho de caixa",
    "Faites glisser pour affiner au dixième de seconde": "Arraste para ajustar ao décimo de segundo",
    "Filmez la tâche en expliquant à voix haute, l'IA génère les étapes": "Filme a tarefa explicando em voz alta, a IA gera as etapas",
    "Filmez puis découpez chaque étape": "Filme e depois corte cada etapa",
    "Vidéo de 5 min maximum": "Vídeo de 5 min no máximo",
    "Fin": "Fim",
    "Fin ici": "Fim aqui",
    "Glissez sur la frise pour naviguer dans la vidéo": "Deslize na linha de tempo para navegar no vídeo",
    "Générer les étapes": "Gerar as etapas",
    "Gérer l'équipe": "Gerir a equipa",
    "Importez une vidéo puis coupez chaque étape": "Importe um vídeo e corte cada etapa",
    "Informations personnelles": "Dados pessoais",
    "Jours actifs": "Dias ativos",
    "Jusqu'à 10 membres · fonctionnalités essentielles": "Até 10 membros · funcionalidades essenciais",
    "Jusqu'à 25 membres · IA incluse · vérification vidéo": "Até 25 membros · IA incluída · verificação por vídeo",
    "L'IA transforme la vidéo en une procédure": "A IA transforma o vídeo num procedimento",
    "L'IA rédige la procédure à partir d'un document": "A IA escreve o procedimento a partir de um documento",
    "L'IA lit votre document…": "A IA está a ler o seu documento…",
    "L'IA travaille au mieux sur des vidéos de": "A IA funciona melhor com vídeos de",
    "Votre procédure apparaîtra dans la liste dès qu'elle sera prête.": "O seu procedimento aparecerá na lista assim que estiver pronto.",
    "Lancer l'analyse": "Iniciar a análise",
    "Les moins actifs": "Os menos ativos",
    "Les plus actifs": "Os mais ativos",
    "Lire": "Reproduzir",
    "Lues": "Lidos",
    "Membres illimités · multi-sites": "Membros ilimitados · multilocal",
    "Modifier": "Editar",
    "Mois": "Mês",
    "Nom A → Z": "Nome A → Z",
    "Nom complet": "Nome completo",
    "Nouveau → ancien": "Novo → antigo",
    "Nouvelle procédure": "Novo procedimento",
    "Ont consulté": "Consultaram",
    "Paramètres": "Definições",
    "Partagez ce code à votre équipe pour qu'elle puisse créer son compte et accéder aux procédures": "Partilhe este código com a sua equipa para que possa criar conta e aceder aos procedimentos",
    "Pas encore consultées": "Ainda não consultados",
    "Procédure générée": "Procedimento gerado",
    "Procédures": "Procedimentos",
    "Procédures consultées": "Procedimentos consultados",
    "Procédures les plus consultées": "Procedimentos mais consultados",
    "Publier la procédure": "Publicar o procedimento",
    "Quelques secondes. Vous relirez chaque étape ensuite.": "Alguns segundos. Depois vai rever cada etapa.",
    "Rechercher une procédure...": "Procurar um procedimento…",
    "Retirer une personne lui coupe immédiatement l'accès aux procédures de l'entreprise. Son compte Standix reste actif : elle pourra rejoindre une autre entreprise avec un nouveau code.": "Remover uma pessoa corta-lhe imediatamente o acesso aos procedimentos da empresa. A conta Standix mantém-se ativa: poderá aderir a outra empresa com um novo código.",
    "Scanner un code": "Ler um código",
    "Scannez pour ouvrir la procédure": "Leia para abrir o procedimento",
    "Se déconnecter": "Terminar sessão",
    "Semaine": "Semana",
    "Terminer le réglage": "Terminar o ajuste",
    "Titre": "Título",
    "Total": "Total",
    "Touchez une étape ci-dessous pour régler son clip": "Toque numa etapa abaixo para ajustar o seu clipe",
    "Tous les membres de l'équipe": "Todos os membros da equipa",
    "Trier : A → Z": "Ordenar: A → Z",
    "Trier : les plus actifs": "Ordenar: os mais ativos",
    "Télécharger la fiche": "Descarregar a ficha",
    "Un souci, une idée, une question sur Standix ? Nous lisons tout et nous répondons au plus vite.": "Um problema, uma ideia, uma dúvida sobre o Standix? Lemos tudo e respondemos o mais depressa possível.",
    "Une consigne écrite, une fiche, un mode d'emploi": "Uma instrução escrita, uma ficha, um manual",
    "Une question ?": "Uma pergunta?",
    "Visez le QR code affiché sur un poste pour ouvrir sa procédure": "Aponte ao código QR de um posto para abrir o seu procedimento",
    "Voir la procédure": "Ver o procedimento",
    "Votre abonnement": "A sua subscrição",
    "Votre compte et votre abonnement": "A sua conta e a sua subscrição",
    "Votre texte": "O seu texto",
    "Votre équipe": "A sua equipa",
    "Vous pouvez quitter cette page": "Pode sair desta página",
    "Vue d'ensemble de votre entreprise": "Visão geral da sua empresa",
    "Vérifiez et ajustez avant de continuer": "Verifique e ajuste antes de continuar",
    "avant publication.": "antes de publicar.",
    "chevauchement": "sobreposição",
    "couvert": "coberto",
    "moins de 5 minutes": "menos de 5 minutos",
    "ou": "ou",
    "relire et corriger": "rever e corrigir",
    "trou": "lacuna",
    "Accéder directement à la procédure en scannant le QR code": "Digitalize o código QR para abrir o procedimento de imediato",
    "À lire": "Por ler",
    "Écrivez chaque étape dans l'ordre": "Escreva cada etapa por ordem",
    "Écrivez chaque étape vous-même": "Escreva cada etapa você mesmo",
    "Écrivez les étapes, ou découpez une vidéo": "Escreva as etapas, ou corte um vídeo",
    "Écrivez-nous": "Escreva-nos",
    "Étapes": "Etapas",
    "Étapes de la procédure": "Etapas do procedimento",
    "Étapes liées": "Etapas ligadas",
    "Étapes manuelles": "Etapas manuais",
    "— la procédure apparaîtra dans votre liste dès qu'elle sera prête.": "— o procedimento aparecerá na sua lista assim que estiver pronto.",

    // ── espace équipe ──
    'Espace \u00c9quipe': 'Espa\u00e7o Equipa',
    'Proc\u00e9dures': 'Procedimentos',
    'Activit\u00e9': 'Atividade',
    'Cat\u00e9gories': 'Categorias',
    'Param\u00e8tres': 'Defini\u00e7\u00f5es',
    'Scanner un code': 'Ler um c\u00f3digo',
    'Mon activit\u00e9': 'A minha atividade',
    'Bonjour \uD83D\uDC4B': 'Ol\u00e1 \uD83D\uDC4B',
    'Chargement\u2026': 'A carregar\u2026',
    'Rechercher une proc\u00e9dure': 'Procurar um procedimento',
    'Rechercher dans cette cat\u00e9gorie': 'Procurar nesta categoria',
    'Cat\u00e9gorie': 'Categoria',
    '\u00c0 lire': 'Por ler',
    'Lue': 'Lido',
    'Lues': 'Lidos',
    'Temps total': 'Tempo total',
    "Jours d'affil\u00e9e": 'Dias seguidos',
    'En tout': 'No total',
    'En chiffres': 'Em n\u00fameros',
    'Par cat\u00e9gorie': 'Por categoria',
    'Temps par proc\u00e9dure': 'Tempo por procedimento',
    'Il vous reste \u00e0 lire': 'Falta ler',
    'Rien ne vous attend': 'Nada pendente',
    'Taux de lecture': 'Taxa de leitura',
    'Cette semaine': 'Esta semana',
    'Temps moyen par proc\u00e9dure': 'Tempo m\u00e9dio por procedimento',
    'Journ\u00e9es actives': 'Dias ativos',
    'Derni\u00e8re lecture': '\u00daltima leitura',
    'Plus longue lecture': 'Leitura mais longa',
    'Lire dans une autre langue': 'Ler noutro idioma',
    '\u00c9tapes de la proc\u00e9dure': 'Etapas do procedimento',
    'Lecture en cours': 'A ler',
    'Proc\u00e9dure consult\u00e9e': 'Procedimento lido',
    'Aucune \u00e9tape': 'Sem etapas',
    'Les autres proc\u00e9dures ne vous sont pas accessibles': 'Os outros procedimentos n\u00e3o est\u00e3o dispon\u00edveis',
    "Demandez le code de l'entreprise \u00e0 votre responsable pour y acc\u00e9der.": 'Pe\u00e7a o c\u00f3digo da empresa ao seu respons\u00e1vel para aceder.',
    'Autorisez la cam\u00e9ra pour scanner': 'Autorize a c\u00e2mara para ler',
    'Visez le QR code': 'Aponte ao c\u00f3digo QR',
    'Code reconnu': 'C\u00f3digo reconhecido',
    'Acc\u00e9der \u00e0 la proc\u00e9dure': 'Abrir o procedimento',
    "Ce n'est pas celle-l\u00e0": 'N\u00e3o \u00e9 este',
    'Bienvenue': 'Bem-vindo',
    'Votre compte et votre entreprise': 'A sua conta e a sua empresa',
    'Vos informations': 'Os seus dados',
    'Nom complet': 'Nome completo',
    'E-mail': 'E-mail',
    'Enregistrer': 'Guardar',
    'Langue': 'Idioma',
    "Langue de l'application": 'Idioma da aplica\u00e7\u00e3o',
    'Vos entreprises': 'As suas empresas',
    'Rejoindre': 'Aderir',
    'Rejoindre une autre entreprise': 'Aderir a outra empresa',
    'D\u00e9bloquer': 'Desbloquear',
    "Entrez le code \u00e0 6 caract\u00e8res que votre responsable vous a communiqu\u00e9. Il sera retenu : l'entreprise appara\u00eetra dans la liste au-dessus.":
      'Introduza o c\u00f3digo de 5 algarismos que o seu respons\u00e1vel lhe deu. Ser\u00e1 guardado: a empresa aparecer\u00e1 na lista acima.',
    'Une question ?': 'Uma pergunta?',
    '\u00c9crivez-nous': 'Escreva-nos',
    'Un souci, une id\u00e9e, une question sur Standix ? Nous lisons tout et nous r\u00e9pondons au plus vite.':
      'Um problema, uma ideia, uma d\u00favida sobre o Standix? Lemos tudo e respondemos o mais depressa poss\u00edvel.',
    'Compte': 'Conta',
    'Se d\u00e9connecter': 'Terminar sess\u00e3o',
  },
}

let langueApp = 'fr'

function chargerLangue() {
  try { langueApp = localStorage.getItem('procedo_langue') || 'fr' } catch (e) { langueApp = 'fr' }
  appliquerLangue()
}

function definirLangue(code) {
  langueApp = code
  try { localStorage.setItem('procedo_langue', code) } catch (e) {}
  appliquerLangue()
}

/* Traduit une phrase si le dictionnaire la connaît, la laisse telle quelle
   sinon. Une phrase manquante reste en français : c'est moins gênant qu'un
   libellé vide ou qu'un code technique à l'écran. */
function t(phrase) {
  if (langueApp === 'fr') return phrase
  return DICO[langueApp]?.[phrase] || phrase
}

/* Parcourt les textes de l'espace équipe et remplace ceux que le dictionnaire
   connaît. On ne touche qu'aux correspondances EXACTES : un titre de procédure
   ou un nom de dossier ne figure pas dans le dictionnaire, il ne risque donc
   jamais d'être modifié. */
function appliquerLangue() {
  /* Les deux espaces sont traduits, et entièrement : 127 libellés côté gestion,
     44 côté équipe. Un espace à moitié traduit est plus déroutant qu'un espace
     en français — c'est tout ou rien. */
  const racines = [
    document.getElementById('equipe-app'),
    document.getElementById('tabbar'),
    document.getElementById('gestion-app'),
    document.getElementById('tabbar'),
  ].filter(Boolean)

  const dico = DICO[langueApp]
  document.documentElement.lang = langueApp

  for (const racine of racines) {
    const parcours = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT)
    const aTraiter = []
    let n
    while ((n = parcours.nextNode())) aTraiter.push(n)

    for (const noeud of aTraiter) {
      const brut = noeud.nodeValue.trim()
      if (!brut) continue
      // On garde l'original une fois pour toutes : sans lui, repasser en
      // français après deux changements de langue serait impossible.
      if (!noeud.__vo) noeud.__vo = brut
      const cible = langueApp === 'fr' ? noeud.__vo : (dico?.[noeud.__vo] || noeud.__vo)
      if (noeud.nodeValue.trim() !== cible) noeud.nodeValue = noeud.nodeValue.replace(brut, cible)
    }
    // Les textes d'invite des champs de saisie
    racine.querySelectorAll('[placeholder]').forEach(el => {
      if (!el.__vo) el.__vo = el.getAttribute('placeholder')
      el.setAttribute('placeholder', langueApp === 'fr' ? el.__vo : (dico?.[el.__vo] || el.__vo))
    })
  }
}

let selectedSpace = 'gestion' // espace choisi sur le premier écran

/* ═══ Arrivée par un QR code ═══
   L'adresse porte la procédure visée et le code de l'entreprise. On les retient
   dès le premier instant, parce qu'ils doivent survivre à la création de compte
   et à la connexion : le but est d'atterrir sur la procédure, quoi qu'il arrive
   entre-temps. */
const cibleQR = (function () {
  const p = new URLSearchParams(window.location.search)
  const proc = p.get('proc')
  return proc ? { proc: proc, code: p.get('e') || '' } : null
})()

/* Affiche l'ossature de l'app sans attendre les données : barre du haut,
   titre, et six cartes en creux. L'utilisateur voit son app tout de suite,
   elle se remplit ensuite. On se souvient de l'espace choisi la dernière fois
   pour savoir laquelle des deux montrer. */
/* ═══════════════════════════════════════════════════════════════════════════
   MONTRER OU MASQUER LA BARRE DU BAS

   Elle s'appelait `tabbar`. Elle s'appelle `bar` depuis le passage au verre
   liquide, et le code la cherchait encore sous son ancien nom : `getElementById`
   rendait `null`, et lire `.style` sur null arrête net la fonction en cours.
   C'est ce qui faisait échouer l'entrée dans l'app juste après l'inscription.

   On passe par une fonction plutôt que par un appel direct : l'accès protégé
   ne s'écrit pas à gauche d'une affectation, et une barre absente ne doit
   jamais interrompre ce qui l'entoure.

   `display:''` et non `'flex'` : la barre porte sa propre géométrie — position
   absolue, largeur calculée, capsule placée au pixel. Lui imposer `flex`
   déplacerait ses onglets. On rend la main au style d'origine. */
/* ═══════════════════════════════════════════════════════════════════════════
   TOUT PARAÎT ENSEMBLE

   Appelée quand un espace a fini de charger. Un seul point de sortie pour les
   deux — c'est ce qui garantit qu'ils se comportent pareil.

   Le délai de secours n'est pas un ornement : sans lui, une requête qui
   n'aboutit pas laisserait l'écran vide pour toujours. On a déjà fait cette
   erreur avec l'écran de démarrage.
   ═══════════════════════════════════════════════════════════════════════════ */
let appRevelee = false
function revelerApp() {
  if (appRevelee) return
  appRevelee = true
  /* Une image d'attente : le rendu qui vient de se faire doit être PEINT avant
     qu'on ne lève le voile, sinon on découvre une page encore en cours de
     mise en page. */
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.body.classList.remove('chargement')
  }))
}
setTimeout(() => {
  if (!appRevelee) {
    console.warn('Standix · chargement trop long, on affiche quand même')
    revelerApp()
  }
}, 6000)

function afficherBarre(montrer) {
  const b = document.getElementById('bar')
  if (b) b.style.display = montrer ? '' : 'none'
  /* La barre vient d'apparaître : si un changement d'espace avait été demandé
     pendant qu'elle était masquée, il n'a rien pu faire — sa largeur valait
     zéro. On le rejoue maintenant, la mesure est possible. */
  if (montrer && window.__espaceEnAttente) {
    const e = window.__espaceEnAttente
    window.__espaceEnAttente = null
    window.majBarreEspace?.(e)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   OÙ MÈNENT LES QUATRE ONGLETS

   La barre ne connaît qu'un index, de 0 à 3. C'est ici qu'il devient une page.
   `onNavigate` est déclarée dans le script de la barre ; on la remplace, sans
   toucher à son code.

   Accueil et Procédures mènent au même écran tant que l'écran d'accueil mobile
   n'existe pas. C'est ce que dit le document de reprise.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Au chargement, la barre est dans le document mais l'app n'est pas ouverte :
   elle flotterait par-dessus l'écran de choix et celui de connexion. */
afficherBarre(false)

/* Vrai le temps qu'un onglet ouvre sa page. C'est ce qui distingue un
   changement d'onglet d'une ouverture depuis une carte — les deux passent par
   la même fonction d'affichage, mais ne méritent pas la même animation. */
let navDepuisOnglet = false

window.onNavigate = function (index) {
  navDepuisOnglet = true
  try {
    /* DEUX AIGUILLAGES, UN PAR ESPACE. Il n'y en avait qu'un, celui de la
       gestion : depuis l'espace Équipe, les onglets activaient des écrans
       invisibles et l'app paraissait ne pas répondre. */
    if (currentMembre?.role === 'equipe') {
      if (index === 0) showEquipeScreen('e-list')
      else if (index === 1) { showEquipeScreen('e-scan'); startScanner('equipe') }
      else if (index === 2) openEquipeSettings()
      return
    }
    if (index === 0) showGestionScreen('p-home')
    else if (index === 1) showGestionScreen('p-list')
    else if (index === 2) { showGestionScreen('p-global-analyse'); loadGlobalAnalyse() }
    else if (index === 3) openSettings()
  } finally { navDepuisOnglet = false }
}

function afficherCoquille(espace) {
  const appEl = document.getElementById(espace === 'equipe' ? 'equipe-app' : 'gestion-app')
  if (!appEl || appEl.style.display === 'block') return
  appEl.style.display = 'block'
  /* L'espace redevient utilisable : il était `inert` pour empêcher Safari d'y
     lire des champs et d'ouvrir le clavier au chargement de l'app. */
  appEl.removeAttribute('inert')
  /* APRÈS l'affichage : la barre doit être mesurable pour que sa géométrie se
     recalcule. Appelée avant, elle travaillait sur une largeur nulle. */
  afficherBarre(true)
  window.majBarreEspace?.(espace)

  /* ═══ PLUS DE FAUX BLOCS ═══

     On posait ici cinq cartes grises en attendant les vraies. Le résultat était
     l'inverse de l'intention : au rechargement, on voyait des rectangles vides
     s'installer, puis disparaître, puis les vraies cartes arriver — trois états
     au lieu d'un, et l'app paraissait ramer.

     La grille reste simplement VIDE le temps du chargement. Le titre, la barre
     et les filtres sont déjà là : la page est déjà elle-même, il n'y manque
     que son contenu, et ça se voit moins qu'un contenu faux. */
}

/* Relance proprement l'animation du logo de l'écran de choix. On retire la
   classe, on force un recalcul, puis on la remet au bout de deux images :
   l'animation repart donc toujours de zéro et sur un écran déjà affiché. */
function lancerAnimationLogo(el) {
  if (!el) return
  el.classList.remove('play')
  void el.offsetWidth
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('play')))
}

function lancerAnimationLogoChoix() {
  lancerAnimationLogo(document.querySelector('#choice-screen .boot-logo--once'))
}

/* Prépare l'écran d'authentification pour une arrivée par QR : bandeau
   explicatif, code pré-rempli et masqué, onglet Inscription en avant. */
async function preparerArriveeQR() {
  const carte = document.querySelector('#login-screen .login-card') || document.getElementById('login-screen')
  if (carte && !document.getElementById('qr-bandeau')) {
    const b = document.createElement('div')
    b.id = 'qr-bandeau'
    b.className = 'qr-bandeau'
    b.innerHTML = '<b>Une procédure vous attend</b><span id="qr-bandeau-sous">Créez votre compte pour la consulter.</span>'
    carte.insertBefore(b, carte.firstChild)
  }
  const champ = document.getElementById('signup-code-acces')
  if (champ && cibleQR.code) {
    champ.value = cibleQR.code
    // Le code est déjà connu : on masque le champ plutôt que de le faire
    // saisir à quelqu'un qui n'a fait que scanner une affiche.
    document.getElementById('signup-equipe-field').style.display = 'none'
  }
  // On nomme l'entreprise si on peut la retrouver par son code.
  if (cibleQR.code) {
    const ent = await entrepriseParCode(cibleQR.code)
    const sous = document.getElementById('qr-bandeau-sous')
    if (sous && ent?.nom) sous.textContent = `Créez votre compte pour rejoindre « ${ent.nom} » et consulter la procédure.`
  }
}

function afficherEcranChoix() {
  /* ═══ LE RETOUR DU COURRIEL PASSE AVANT TOUT ═══

     Le lien de réinitialisation ouvre une session : sans ce contrôle placé
     ici, la personne serait envoyée dans son espace par le chemin normal, et
     on ne lui demanderait jamais son nouveau mot de passe. Le lien n'aurait
     servi à rien, sans qu'aucune erreur ne le signale.

     `verifierRetourMotDePasse` rend `false` immédiatement quand l'adresse ne
     porte pas `type=recovery`, donc ce contrôle ne coûte rien au démarrage
     ordinaire. */
  if (/type=recovery/.test((window.location.hash || '') + (window.location.search || ''))) {
    verifierRetourMotDePasse().then(() => {})
    return
  }

  /* Verrou : si un espace est déjà à l'écran, ou si une fiche membre est en
     mémoire, on ne montre rien par-dessus. C'est ce qui manquait — un appel
     tardif recouvrait l'app déjà ouverte. */
  if (currentMembre) return
  if (document.getElementById('gestion-app')?.style.display === 'block') return
  if (document.getElementById('equipe-app')?.style.display === 'block') return

  /* Quelqu'un qui scanne un QR est forcément un membre d'équipe : on lui
     épargne le choix entre les deux espaces et on l'emmène directement à
     l'inscription, avec le code déjà rempli. */
  if (cibleQR) { chooseSpace('equipe'); preparerArriveeQR(); return }
  document.getElementById('choice-screen').style.display = 'flex'
  lancerAnimationLogoChoix()
}

// ═══ ÉCRAN 1 : CHOIX DE L'ESPACE ═══
window.chooseSpace = function(space) {
  selectedSpace = space
  /* ═══ L'ÉCRAN DE CHOIX RESTE VISIBLE ═══

     Il était masqué d'un coup. Sur une feuille modale, ce qui est derrière doit
     rester là : c'est ce qui fait comprendre qu'on peut revenir, et c'est la
     règle d'iOS pour toute vue présentée par-dessus. */
  const ecranC = document.getElementById('login-screen')
  ecranC.style.display = 'flex'
  /* On rend les champs utilisables : ils étaient `inert` pour empêcher Safari
     de proposer le remplissage depuis l'écran de choix. */
  ecranC.removeAttribute('inert')
  /* Le titre reprend le mot de la carte touchée : on doit reconnaître d'où
     l'on vient, sinon l'écran suivant paraît sans rapport. */
  /* Le titre reprend le mot de la carte touchée, mais SANS le verbe : « S'inscrire
     et créer son entreprise » en tête d'un formulaire d'inscription répéterait ce
     que la page fait déjà voir. La carte annonce le geste, l'écran le déroule. */
  document.getElementById('auth-title').textContent =
    space === 'gestion' ? 'Votre entreprise' : 'Acc\u00e9der aux proc\u00e9dures'
  document.getElementById('signup-gestion-field').style.display = space === 'gestion' ? 'block' : 'none'
  document.getElementById('signup-equipe-field').style.display = space === 'equipe' ? 'block' : 'none'
  /* ═══ INSCRIPTION SEULE, ET LES ONGLETS DISPARAISSENT ═══

     Quelqu'un qui vient de toucher « Créer une entreprise » veut s'inscrire.
     J'ouvrais déjà sur le bon onglet, mais je laissais les deux visibles — la
     connexion restait donc atteignable depuis un écran qui ne lui sert pas.

     Or les deux chemins ne sont pas symétriques. Se connecter depuis « Créer
     une entreprise » n'a aucun sens : on ne crée rien, le champ « Nom de
     l'entreprise » resterait rempli sans être lu, et l'entreprise ne serait
     jamais créée. La personne se retrouverait dans son ancien espace en
     croyant en avoir monté un nouveau.

     Trois écrans, trois gestes, un seul possible dans chacun. C'est le même
     traitement que « J'ai déjà un compte », dans l'autre sens. */
  switchAuthTab('signup')
  document.querySelector('.auth-toggle')?.setAttribute('data-cache', '1')
  const sous = document.getElementById('auth-sous')
  if (sous) {
    /* Ces phrases suivent les cartes du choix : elles disent le rôle, pas la
       suite d'opérations. Un écran qui reprend d'autres mots que le bouton
       qu'on vient de toucher fait douter d'avoir cliqué au bon endroit. */
    /* ═══ UNE PHRASE QUI ACCUEILLE, PAS UNE CONSIGNE ═══

       Elles disaient l'opération : « Vous créez l'entreprise », « Entrez le
       code ». C'est ce que le formulaire montre déjà.

       Une première phrase dit maintenant OÙ l'on arrive, la seconde ce qu'on va
       y faire. C'est le geste d'Apple sur ses écrans de bienvenue : on est reçu
       avant d'être mis au travail. */
    sous.innerHTML = space === 'gestion'
      ? 'Bienvenue.<br><span class="auth-sous-2">Cr\u00e9ez votre espace, invitez votre \u00e9quipe, ' +
        'et laissez l\u2019IA \u00e9crire vos proc\u00e9dures.</span>'
      : 'Bienvenue.<br><span class="auth-sous-2">Votre responsable vous a donn\u00e9 un code \u00e0 ' +
        'six caract\u00e8res : il ouvre les proc\u00e9dures de votre entreprise.</span>'
  }
  document.getElementById('login-error').textContent = ''
}
/* ═══ ALLER DIRECTEMENT À LA CONNEXION ═══

   Sans passer par le choix créer/rejoindre, qui ne concerne que les nouveaux.

   `selectedSpace` reste à `null` : il ne sert QU'À l'inscription, pour savoir
   quel champ afficher et s'il faut créer une entreprise. À la connexion, le
   rôle vient de la fiche `membres`, jamais de ce qui a été choisi sur cet
   écran. Lui donner une valeur ici laisserait croire le contraire à qui lira
   ce code plus tard.

   L'onglet « Créer un compte » reste accessible depuis l'écran de connexion —
   mais il y afficherait un formulaire sans champ entreprise ni champ code. On
   le masque donc : quelqu'un arrivé par ce chemin s'inscrit par les cartes. */
/* ═══ BRANCHÉ ICI, PAS PAR `onclick` DANS LE BALISAGE ═══

   Avec `onclick="allerConnexion()"`, si `app.js` n'est pas déployé — ou tombe
   sur une erreur avant cette ligne — le bouton existe, se dessine, se touche…
   et ne fait rien. Aucune trace, aucun message : on croit à un défaut de
   conception alors que c'est un fichier manquant.

   Un écouteur posé ici échoue autrement : le bouton n'est jamais branché, mais
   la console dit pourquoi. Et la vérification ci-dessous nomme le problème au
   lieu de le laisser deviner. */
document.getElementById('choix-deja')?.addEventListener('click', () => allerConnexion())

/* ═══════════════════════════════════════════════════════════════════════════
   LA PAGE D'ACCUEIL · BOUTONS ET DÉFILEMENT
   ═══════════════════════════════════════════════════════════════════════════ */

/* Les deux boutons d'inscription. Ils appellent `chooseSpace`, comme les
   anciennes cartes — seule la présentation a changé. */
document.querySelectorAll('.ac-btn[data-space]').forEach(b => {
  b.addEventListener('click', () => chooseSpace(b.dataset.space))
})
document.getElementById('ac-connexion')?.addEventListener('click', () => allerConnexion())

/* ═══ LE DÉFILEMENT DES PHOTOS ═══

   Cinq secondes par image : assez pour la regarder, pas assez pour attendre.

   ⚠ LE MINUTEUR S'ARRÊTE QUAND LA PAGE EST CACHÉE. Sans cela, il continue de
     tourner pendant qu'on remplit le formulaire d'inscription — et sur un
     téléphone en arrière-plan, il consomme pour rien.

   Il s'arrête aussi si la personne a demandé moins de mouvement dans ses
   réglages système : une image qui change toute seule en est. */
;(() => {
  const zone = document.getElementById('ac-photos')
  if (!zone) return
  const photos = [...zone.querySelectorAll('.ac-photo')]
  if (photos.length < 2) return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

  let n = 0, minuteur = null
  const suivante = () => {
    photos[n].classList.remove('on')
    n = (n + 1) % photos.length
    photos[n].classList.add('on')
  }
  const lancer = () => { if (!minuteur) minuteur = setInterval(suivante, 5000) }
  const arreter = () => { clearInterval(minuteur); minuteur = null }

  document.addEventListener('visibilitychange', () => {
    document.hidden ? arreter() : lancer()
  })
  lancer()
})()

/* ═══════════════════════════════════════════════════════════════════════════
   MOT DE PASSE OUBLIÉ

   Supabase envoie un lien de réinitialisation par courriel. Le lien ramène sur
   l'app avec une session temporaire, et c'est là qu'on saisit le nouveau mot
   de passe — pas avant. On ne peut donc pas le changer depuis cet écran : on
   demande l'envoi, et tout se passe ensuite dans la boîte aux lettres.

   ─── ON NE DIT JAMAIS SI L'ADRESSE EXISTE ───

   Le message de succès est le MÊME que l'adresse soit connue ou non. Répondre
   « ce compte n'existe pas » permettrait à n'importe qui de vérifier si une
   personne est cliente en tapant son adresse. C'est aussi ce que fait Supabase
   de son côté : il ne rend pas d'erreur pour une adresse inconnue.

   ─── L'ADRESSE DE RETOUR ───

   `location.origin + location.pathname` : le lien du courriel ramène sur
   l'app, pas sur le site. Écrite en dur, elle serait fausse le jour d'un
   changement de domaine — et c'est déjà arrivé aujourd'hui avec l'image de
   partage.

   ⚠ À FAIRE UNE FOIS DANS SUPABASE : Authentication → URL Configuration →
     Redirect URLs, ajouter `https://standix.app/app/**`. Sans cette
     autorisation, le lien du courriel renvoie vers l'adresse par défaut du
     projet et la réinitialisation échoue sans message clair. */
async function demanderReinitialisation(email, zoneErreur, bouton) {
  const err = document.getElementById(zoneErreur)
  const propre = (email || '').trim()
  if (!propre || !propre.includes('@')) {
    if (err) { err.style.color = 'var(--red)'; err.textContent = 'Entrez d\u2019abord votre adresse e-mail.' }
    return
  }
  const avant = bouton ? bouton.textContent : ''
  if (bouton) { bouton.disabled = true; bouton.textContent = 'Envoi\u2026' }
  try {
    const retour = window.location.origin + window.location.pathname
    const { error } = await supabase.auth.resetPasswordForEmail(propre, { redirectTo: retour })
    /* On ne montre l'erreur QUE si elle est technique — réseau coupé, service
       indisponible. Une adresse inconnue ne doit pas se distinguer. */
    if (error && !/user|not found|invalid/i.test(error.message || '')) {
      console.warn('[mot de passe]', error.message)
    }
    if (err) {
      err.style.color = 'var(--label-2)'
      err.innerHTML = `Si un compte existe pour <b>${escapeHtml(propre)}</b>, un lien vient d\u2019y \u00eatre envoy\u00e9. ` +
        `Pensez \u00e0 regarder dans les ind\u00e9sirables.`
    }
  } catch (e) {
    if (err) { err.style.color = 'var(--red)'; err.textContent = 'Envoi impossible : ' + (e?.message || e) }
  } finally {
    if (bouton) { bouton.disabled = false; bouton.textContent = avant }
  }
}
window.demanderReinitialisation = demanderReinitialisation

/* ═══ LES TROIS BOUTONS ═══

   Trois écrans, une seule fonction. Depuis la connexion, l'adresse vient du
   champ saisi ; depuis les pages de compte, elle vient du champ en lecture
   seule — la personne est connectée, on connaît son adresse et lui redemander
   serait un obstacle sans raison. */
document.getElementById('mdp-oublie')?.addEventListener('click', (e) =>
  demanderReinitialisation(document.getElementById('login-email')?.value, 'login-error', e.currentTarget))

document.getElementById('mdp-changer-g')?.addEventListener('click', (e) =>
  demanderReinitialisation(document.getElementById('settings-email')?.value, 'settings-error', e.currentTarget))

document.getElementById('mdp-changer-e')?.addEventListener('click', (e) => {
  /* L'espace Équipe n'a pas de zone d'erreur sur cette carte : on en crée une
     à la volée plutôt que d'ajouter un élément vide au balisage pour les
     rares fois où il sert. */
  let z = document.getElementById('es-mdp-msg')
  if (!z) {
    z = document.createElement('div')
    z.className = 'error-msg'
    z.id = 'es-mdp-msg'
    e.currentTarget.after(z)
  }
  demanderReinitialisation(document.getElementById('es-email')?.value, 'es-mdp-msg', e.currentTarget)
})

/* ═══ LE RETOUR DU COURRIEL ═══

   Supabase ouvre l'app avec `type=recovery` dans l'adresse et une session déjà
   ouverte. On saisit alors le nouveau mot de passe.

   Ce contrôle doit tourner AU DÉMARRAGE, avant que l'app décide où envoyer la
   personne : sans lui, elle atterrirait dans son espace sans jamais qu'on lui
   demande son nouveau mot de passe, et le lien n'aurait servi à rien. */
async function verifierRetourMotDePasse() {
  const brut = (window.location.hash || '') + (window.location.search || '')
  if (!/type=recovery/.test(brut)) return false

  const nouveau = await demanderTexte({
    titre: 'Nouveau mot de passe',
    message: 'Choisissez un mot de passe d\u2019au moins 6 caract\u00e8res.',
    placeholder: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022',
    confirmer: 'Enregistrer',
  })
  if (!nouveau) { toast('Mot de passe inchang\u00e9'); return false }
  if (nouveau.length < 6) { toast('Six caract\u00e8res minimum'); return await verifierRetourMotDePasse() }

  const { error } = await supabase.auth.updateUser({ password: nouveau })
  if (error) { toast('\u00c9chec : ' + error.message); return false }

  /* On nettoie l'adresse : laisser `type=recovery` ferait redemander le mot de
     passe à chaque rafraîchissement de la page. */
  try { history.replaceState({}, '', window.location.pathname) } catch (e) {}
  toast('Mot de passe modifi\u00e9')
  return true
}
window.verifierRetourMotDePasse = verifierRetourMotDePasse

window.allerConnexion = function() {
  const cible = document.getElementById('login-screen')
  const source = document.getElementById('choice-screen')
  if (!cible || !source) {
    console.error('[connexion] écran introuvable — index.html et app.js ne sont pas de la même version')
    return
  }
  selectedSpace = null
  /* L'écran de choix reste visible derrière la feuille, comme pour
     `chooseSpace`. Le masquer briserait l'illusion d'une couche posée dessus. */
  cible.style.display = 'flex'
  cible.removeAttribute('inert')
  document.getElementById('auth-title').textContent = 'Se connecter'
  document.getElementById('signup-gestion-field').style.display = 'none'
  document.getElementById('signup-equipe-field').style.display = 'none'
  switchAuthTab('login')
  const sous = document.getElementById('auth-sous')
  /* Pour qui revient, pas de « bienvenue » — il connaît la maison. Une phrase
     qui reprend le fil là où il l'a laissé. */
  if (sous) sous.innerHTML = 'Content de vous revoir.<br>' +
    '<span class="auth-sous-2">Vos proc\u00e9dures vous attendent.</span>'
  document.getElementById('login-error').textContent = ''
  /* Les onglets disparaissent : il n'y a plus de second onglet utile. */
  document.querySelector('.auth-toggle')?.setAttribute('data-cache', '1')
}

/* ═══ LA FEUILLE REDESCEND AVANT DE DISPARAÎTRE ═══

   Elle était masquée d'un `display:none` — elle disparaissait d'un coup, alors
   qu'elle était montée en glissant. Une animation qui ne joue que dans un sens
   se remarque plus qu'une absence d'animation.

   `feuilleDescend` la fait redescendre, puis on masque au bout de 320 ms — la
   durée exacte de l'animation. */
window.backToChoice = function() {
  const w = document.getElementById('login-screen')
  const carte = w?.querySelector('.login-card')
  if (!w || !carte) return
  carte.style.animation = 'feuilleDescend 0.32s cubic-bezier(0.32,0.72,0,1) both'
  w.style.animation = 'feuilleVoile 0.32s ease reverse both'
  setTimeout(() => {
    w.style.display = 'none'
    w.setAttribute('inert', '')
    carte.style.animation = ''
    w.style.animation = ''
  }, 320)
}

// ═══ ONGLETS Connexion / Créer un compte ═══
window.switchAuthTab = function(tab) {
  const loginBtn = document.getElementById('tab-login-btn')
  const signupBtn = document.getElementById('tab-signup-btn')
  const indicator = document.getElementById('auth-indicator')
  const loginForm = document.getElementById('login-form')
  const signupForm = document.getElementById('signup-form')

  indicator.style.transform = tab === 'login' ? 'translateX(0%)' : 'translateX(100%)'
  loginBtn.classList.toggle('active', tab === 'login')
  signupBtn.classList.toggle('active', tab === 'signup')

  loginForm.classList.remove('active')
  signupForm.classList.remove('active')
  if (tab === 'login') { loginForm.classList.add('active') } else { signupForm.classList.add('active') }

  document.getElementById('login-error').textContent = ''
  document.getElementById('login-error').style.color = 'var(--red)'
}

// ═══ CONNEXION ═══
document.getElementById('login-btn')?.addEventListener('click', async () => {
  const email = document.getElementById('login-email').value.trim()
  const password = document.getElementById('login-password').value
  const errorEl = document.getElementById('login-error')
  const btn = document.getElementById('login-btn')
  errorEl.textContent = ''
  setButtonLoading(btn, true)

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) { errorEl.textContent = "Connexion impossible : " + error.message; setButtonLoading(btn, false); return }

  const { fiches, erreur } = await lireFichesMembre(data.user.id)
  const membre = choisirFicheMembre(fiches, selectedSpace)

  if (!membre) {
    setButtonLoading(btn, false)
    if (erreur) {
      errorEl.textContent = 'Impossible de lire votre fiche : ' + erreur
      return
    }
    /* Compte valide, mais rattaché à aucune entreprise : ce n'est pas une erreur
       de connexion, c'est une étape qui manque. On ouvre le champ du code plutôt
       que d'afficher un refus. */
    document.getElementById('login-screen').style.display = 'none'
    montrerOrphelin()
    return
  }

  enterApp(membre)
  setButtonLoading(btn, false)
})

// ═══ CRÉATION DE COMPTE ═══
document.getElementById('signup-btn')?.addEventListener('click', async () => {
  const prenom = document.getElementById('signup-prenom').value.trim()
  const nom = document.getElementById('signup-nom').value.trim()
  const email = document.getElementById('signup-email').value.trim()
  const password = document.getElementById('signup-password').value
  const entrepriseNom = document.getElementById('signup-entreprise-nom').value.trim()
  const codeAcces = document.getElementById('signup-code-acces').value.trim()
  const errorEl = document.getElementById('login-error')
  errorEl.textContent = ''
  errorEl.style.color = 'var(--red)'

  if (!prenom || !nom) { errorEl.textContent = 'Merci de renseigner votre prénom et votre nom.'; return }
  if (!email || !password) { errorEl.textContent = 'E-mail et mot de passe obligatoires.'; return }
  if (password.length < 6) { errorEl.textContent = 'Le mot de passe doit faire au moins 6 caractères.'; return }
  if (selectedSpace === 'gestion' && !entrepriseNom) { errorEl.textContent = "Merci d'indiquer le nom de votre entreprise."; return }
  /* Le code n'est plus forcément à cinq chiffres : ceux de gestion font six
     signes, lettres comprises. On accepte de 4 à 12 et on laisse la base
     trancher — elle seule sait ce qui existe. */
  if (selectedSpace === 'equipe' && !/^[A-Za-z0-9]{4,12}$/.test(codeAcces)) {
    errorEl.textContent = 'Le code doit contenir entre 4 et 12 caractères.'
    return
  }

  /* ═══ C'EST LE CODE QUI DONNE LE RÔLE ═══

     Auparavant, la personne choisissait son espace et le code ne servait qu'à
     retrouver l'entreprise. Un employé à qui on avait donné le code pouvait
     donc choisir « Gestion » à l'inscription et obtenir tous les droits.

     Maintenant, `verifier_code` renvoie l'entreprise ET le rôle. Le choix fait
     à l'écran précédent ne décide plus de rien : il n'indique que le chemin
     d'inscription. */
  let targetEntrepriseId = null
  let roleAccorde = null
  if (selectedSpace === 'equipe') {
    const { data: trouve, error: errCode } = await supabase
      .rpc('verifier_code', { p_code: codeAcces })
    const ligne = Array.isArray(trouve) ? trouve[0] : trouve
    if (errCode || !ligne) {
      errorEl.textContent = "Ce code n'existe pas, ou il a expiré. Vérifiez-le auprès de votre gestionnaire."
      return
    }
    targetEntrepriseId = ligne.entreprise_id
    roleAccorde = ligne.role
  }

  const signupBtn = document.getElementById('signup-btn')
  setButtonLoading(signupBtn, true)

  const { data, error } = await supabase.auth.signUp({ email, password })

  if (error) {
    if (error.message.includes('already registered') || error.message.includes('already exists')) {
      errorEl.textContent = "Un compte existe déjà avec cet e-mail. Utilisez plutôt l'onglet Se connecter."
    } else {
      errorEl.textContent = "Erreur (" + (error.status || '?') + ") : " + error.message
    }
    setButtonLoading(signupBtn, false)
    return
  }

  if (!data.session) {
    // Confirmation par e-mail requise avant de pouvoir se connecter
    errorEl.textContent = ''
    errorEl.style.color = 'var(--green)'
    errorEl.textContent = 'Compte créé ! Vérifiez vos e-mails pour confirmer, puis connectez-vous.'
    setButtonLoading(signupBtn, false)
    switchAuthTab('login')
    return
  }

  /* ═══════════════════════════════════════════════════════════════════════
     L'ENTREPRISE ET SON FONDATEUR NAISSENT ENSEMBLE

     Avant, l'app faisait deux écritures à la suite : l'entreprise, puis la
     fiche membre. La première était refusée — non pas à l'insertion, mais à la
     RELECTURE. `.insert().select()` oblige Postgres à relire la ligne créée, et
     la règle de lecture ne montre que les entreprises dont on est déjà membre.
     À cet instant la fiche n'existait pas encore : l'entreprise naissait, se
     jugeait invisible, et tout était annulé.

     Une seule fonction côté base fait désormais les deux d'un trait. Elle règle
     le refus, mais surtout elle supprime le cas où la première écriture réussit
     et la seconde échoue : plus d'entreprise sans fondateur, jamais.

     Elle rattache la fiche à `auth.uid()`, jamais à un identifiant venu du
     navigateur, et refuse tout appel sans session. */
  let membre = null

  if (selectedSpace === 'gestion') {
    const { data: fiche, error: erreurCreation } = await supabase
      .rpc('creer_entreprise_et_fondateur', {
        p_nom_entreprise: entrepriseNom,
        p_nom_membre: `${prenom} ${nom}`,
      })

    if (erreurCreation || !fiche) {
      const e = erreurCreation || {}
      if (e.code === '28000') {
        errorEl.textContent = "Votre compte est créé, mais la session n'est pas " +
          "active. Connectez-vous pour créer votre entreprise."
      } else if (e.code === '23505') {
        errorEl.textContent = "Aucun code d'accès libre pour le moment. " +
          "Retentez dans un instant."
      } else if (e.code === 'PGRST202' || /function .*creer_entreprise/i.test(e.message || '')) {
        /* La fonction n'existe pas encore en base. On le dit clairement plutôt
           que de laisser lire « Réessayez » à quelqu'un qui réessaiera en vain. */
        errorEl.textContent = "La création d'entreprise n'est pas installée sur " +
          "la base. Exécutez migration-creation-entreprise.sql."
      } else {
        errorEl.textContent = "Impossible de créer l'entreprise" +
          (e.code ? ' (' + e.code + ')' : '') + '. ' + (e.message || 'Réessayez.')
      }
      console.error('[entreprises] création refusée :', erreurCreation)
      setButtonLoading(signupBtn, false)
      return
    }

    membre = fiche
  } else {
    /* ═══ REJOINDRE UNE ENTREPRISE PASSE PAR LA BASE ═══

       L'app écrivait directement dans `membres` : personne n'était jamais
       refusé, et une entreprise à cinq places pouvait en accueillir vingt.

       Le compte des places se fait maintenant côté base, dans la même
       transaction que l'écriture. Deux raisons :

       — un contrôle en JavaScript se contourne en dix secondes avec les outils
         de développement ;
       — deux inscriptions au même instant sur la dernière place passeraient
         toutes les deux si le compte et l'écriture étaient séparés.

       Et quand c'est complet, la demande est gardée : le gérant la verra sur
       son accueil. Sans ça, un refus ne laisse aucune trace et personne ne sait
       que quelqu'un a essayé d'entrer. */
    const { data: fiche, error: membreError } = await supabase
      .rpc('rejoindre_entreprise', {
        p_code: codeAcces,
        p_nom: `${prenom} ${nom}`,
        p_email: email,
      })

    if (membreError || !fiche) {
      const m = String(membreError?.message || '')
      errorEl.style.color = 'var(--red)'

      if (m.includes('PLACES_COMPLETES')) {
        /* La base lève « PLACES_COMPLETES:Le Bistrot:5 » — le nom peut contenir
           des deux-points, donc on découpe par la FIN : le dernier morceau est
           le nombre de places, tout ce qui précède est le nom. */
        const bouts = m.split('PLACES_COMPLETES:')[1].split(':')
        const places = bouts.pop().trim()
        const nomEnt = bouts.join(':').trim()
        errorEl.textContent =
          `${nomEnt || 'Cette entreprise'} a atteint les ${places} places de son abonnement. ` +
          `Votre demande a été transmise — demandez à votre gérant d'ajouter une place.`
      } else if (m.includes('CODE_INCONNU')) {
        errorEl.textContent = "Ce code entreprise n'existe pas. Vérifiez-le auprès de votre gestionnaire."
      } else if (m.includes('28000')) {
        errorEl.textContent = "Votre compte est créé. Connectez-vous pour rejoindre l'entreprise."
      } else {
        errorEl.textContent = "Impossible de rejoindre l'entreprise : " + (m || 'réessayez.')
      }
      console.error('[rejoindre]', membreError)
      setButtonLoading(signupBtn, false)
      return
    }
    membre = fiche
  }

  setButtonLoading(signupBtn, false)
  enterApp(membre)
})

/* ═══════════════════════════════════════════════════════════════════════════
   SURVEILLANCE DU CHARGEMENT

   Un chargement qui n'aboutit pas est muet : l'écran reste gris et rien
   n'explique pourquoi. On arme donc un compte à rebours à l'entrée dans l'app,
   désamorcé dès que les données arrivent. S'il expire, on affiche ce qu'on sait :
   la dernière étape franchie et l'erreur éventuelle.

   Ce n'est pas un correctif, c'est un témoin. Mais sans témoin on ne corrige
   rien — on devine.
   ═══════════════════════════════════════════════════════════════════════════ */

let montreChargement = null
let derniereErreur = null

function armerSurveillance() {
  if (montreChargement) clearTimeout(montreChargement)
  montreChargement = setTimeout(() => {
    const bandeau = document.getElementById('bandeau-bloc')
    const detail = document.getElementById('bandeau-bloc-detail')
    if (!bandeau || !detail) return

    const etapes = (window.__chrono || []).slice(-6)
      .map(j => Math.round(j[1]) + ' ms \u00b7 ' + j[0]).join('\n')

    detail.textContent = [
      derniereErreur ? 'Erreur : ' + derniereErreur : 'Aucune erreur remont\u00e9e.',
      '',
      'Derni\u00e8res \u00e9tapes :',
      etapes || '(aucune)',
      '',
      'R\u00e9seau : ' + (navigator.onLine ? 'connect\u00e9' : 'hors ligne'),
      'Espace : ' + (currentMembre?.role || '\u2014'),
    ].join('\n')

    bandeau.classList.add('on')
  }, 9000)
}

function desarmerSurveillance() {
  if (montreChargement) { clearTimeout(montreChargement); montreChargement = null }
  document.getElementById('bandeau-bloc')?.classList.remove('on')
}

/* Toute erreur non rattrapée est retenue : c'est presque toujours elle qui
   explique le blocage, et elle n'apparaît nulle part sur téléphone. */
window.addEventListener('unhandledrejection', (e) => {
  derniereErreur = e.reason?.message || String(e.reason || '')
})
window.addEventListener('error', (e) => { derniereErreur = e.message })


/* ═══════════════════════════════════════════════════════════════════════════
   CHOISIR LA BONNE FICHE MEMBRE

   Une personne peut avoir PLUSIEURS fiches : une par entreprise. C'est le cas
   d'un employé qui travaille dans deux établissements, et de tout gérant qui en
   ajoute un second.

   Les lectures utilisaient `.single()` et `.maybeSingle()`, qui exigent une
   ligne et UNE SEULE : dès la deuxième, la requête échoue. D'où le « Aucune
   fiche membre trouvée pour ce compte » sur un compte parfaitement valide, et
   l'app qui restait au chargement au démarrage.

   On lit donc TOUTES les fiches, et on choisit :
   • celle de l'espace où la personne était la dernière fois,
   • sinon celle de l'espace qu'elle vient de choisir à l'écran de connexion,
   • sinon la plus ancienne, qui est son entreprise d'origine.
   ═══════════════════════════════════════════════════════════════════════════ */

function choisirFicheMembre(fiches, espaceVoulu) {
  const liste = (fiches || []).filter(Boolean)
  if (!liste.length) return null
  if (liste.length === 1) return liste[0]

  /* D'abord la DERNIÈRE fiche ouverte. Quelqu'un qui bascule sur son second
     établissement puis recharge la page doit y rester : sans ce repère, il
     revenait sur le premier à chaque rechargement, et le changement semblait
     ne pas avoir pris. */
  let derniere = null
  try { derniere = localStorage.getItem('procedo_membre') } catch (e) {}
  if (derniere) {
    const trouvee = liste.find(m => String(m.id) === String(derniere))
    if (trouvee) return trouvee
  }

  let prefere = espaceVoulu
  if (!prefere) {
    try { prefere = localStorage.getItem('procedo_espace') } catch (e) { prefere = null }
  }

  // Entre plusieurs fiches du même rôle, la plus ancienne : c'est l'entreprise
  // d'origine, celle où l'on s'attend à revenir.
  const parAnciennete = [...liste].sort((a, b) =>
    new Date(a.created_at || 0) - new Date(b.created_at || 0))

  return parAnciennete.find(m => m.role === prefere) || parAnciennete[0]
}

/* Lit les fiches d'un compte sans jamais exiger qu'il n'y en ait qu'une. */
async function lireFichesMembre(userId) {
  const { data, error } = await supabase
    .from('membres').select('*').eq('user_id', userId)
  if (error) return { fiches: [], erreur: error.message }
  return { fiches: data || [], erreur: null }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TROIS APPAREILS PAR COMPTE

   Empêche qu'une équipe de dix personnes partage un seul compte pour payer
   l'abonnement le moins cher. Au-delà de trois appareils, le plus ancien est
   déconnecté.

   On compte les APPAREILS DISTINCTS, pas les lectures simultanées : le problème
   n'est pas que deux personnes lisent en même temps, c'est que dix se partagent
   un compte.

   L'empreinte est tirée du navigateur et rangée sur l'appareil. Elle n'identifie
   personne — c'est un numéro tiré au sort la première fois, rien de plus. Elle
   ne survit pas à un effacement des données du navigateur : quelqu'un de
   déterminé peut donc reprendre une place. Ce n'est pas un verrou, c'est un
   garde-fou — et c'est suffisant, parce que l'équipe qui partage un compte perd
   surtout le suivi individuel qu'elle a payé.
   ═══════════════════════════════════════════════════════════════════════════ */

const APPAREILS_MAX = 3
const RYTHME_PRESENCE = 5 * 60 * 1000     // on se signale toutes les cinq minutes

/* ═══════════════════════════════════════════════════════════════════════════
   TROIS APPAREILS PAR COMPTE, COMPTÉS PAR LE SERVEUR

   Empêche qu'une équipe de dix personnes partage un seul compte pour payer
   l'abonnement le moins cher.

   Le comptage se fait CÔTÉ SERVEUR, dans la fonction `presence`. Elle calcule
   l'empreinte à partir de l'adresse réseau, que le navigateur ne choisit pas et
   ne peut pas effacer — contrairement à une empreinte rangée localement, qui
   disparaissait au premier nettoyage et changeait d'un navigateur à l'autre.

   Comme Netflix : on compte les appareils ACTIFS dans les trente dernières
   minutes. Au-delà de trois, le plus ancien est déconnecté, et c'est le dernier
   arrivé qui reste — sans quoi une équipe qui partage tournerait sur les trois
   mêmes téléphones sans jamais s'en apercevoir.
   ═══════════════════════════════════════════════════════════════════════════ */

let minuteurPresence = null

/* ─── L'alerte au responsable ────────────────────────────────────────────────
   Le serveur signale les comptes partagés ; l'app les montre au responsable,
   là où il peut agir. Un point rouge sur le bouton des réglages, et une carte
   dedans qui dit qui est concerné.

   Le ton n'accuse pas l'employé : il rappelle ce que le partage fait perdre au
   responsable. C'est lui qui doit créer les comptes manquants, pas l'employé. */

let alertesPartage = []

async function chargerAlertesPartage() {
  if (currentMembre?.role !== 'gestion' || !currentMembre?.entreprise_id) return
  try {
    const { data, error } = await supabase.from('alertes_partage')
      .select('id, membre_id, nb_appareils, creee_le, vue')
      .eq('entreprise_id', currentMembre.entreprise_id)
      .eq('vue', false)
    if (error) return          // table absente : rien à signaler
    alertesPartage = data || []
    peindreAlertePartage()
  } catch (e) { /* rien à signaler */ }
}

function peindreAlertePartage() {
  const carte = document.getElementById('alerte-partage')
  const detail = document.getElementById('alerte-detail')
  const pastille = document.querySelector('#gestion-app .icon-pill')

  const n = alertesPartage.length
  if (pastille) pastille.classList.toggle('alerte', n > 0)
  if (!carte) return

  if (!n) { carte.style.display = 'none'; return }

  carte.style.display = 'block'
  if (detail) {
    /* On nomme les personnes quand on peut : « le compte de Karim » est
       actionnable, « un compte » ne l'est pas. */
    const noms = alertesPartage
      .map(a => (cachedMembres || []).find(m => m.id === a.membre_id)?.nom)
      .filter(Boolean)
    const max = Math.max(...alertesPartage.map(a => a.nb_appareils))
    detail.textContent = noms.length
      ? (noms.length === 1
        ? `Le compte de ${noms[0]} est utilis\u00e9 sur ${max} appareils.`
        : `${noms.length} comptes sont utilis\u00e9s sur plusieurs appareils : ${noms.join(', ')}.`)
      : `Un compte est utilis\u00e9 sur ${max} appareils.`
  }
}

document.getElementById('alerte-equipe')?.addEventListener('click', () => openMembres())

document.getElementById('alerte-classer')?.addEventListener('click', async () => {
  const ok = await confirmDialog({
    titre: 'Ignorer ce signalement ?',
    message: "Il repara\u00eetra si le partage continue. Cr\u00e9er un compte par personne " +
      "reste le seul moyen de savoir qui a lu quoi.",
    confirmer: 'Ignorer', annuler: 'Annuler', danger: false,
  })
  if (!ok) return
  const ids = alertesPartage.map(a => a.id)
  await supabase.from('alertes_partage').update({ vue: true }).in('id', ids)
  alertesPartage = []
  peindreAlertePartage()
})

/* Se signale au serveur. Renvoie `false` si cet appareil-ci vient d'être
   déconnecté parce qu'il dépassait la limite. */
async function signalerPresence(membre) {
  if (!membre?.id) return true
  try {
    const rep = await fetch(`${SUPABASE_URL}/functions/v1/presence`, {
      method: 'POST',
      headers: await enTeteFonction(),
      body: JSON.stringify({ membre_id: membre.id, entreprise_id: membre.entreprise_id }),
    })
    const data = await rep.json()
    return !data?.bloque
  } catch (ex) {
    /* Fonction non déployée, réseau coupé : on laisse passer. Mieux vaut ne pas
       compter que de bloquer quelqu'un de légitime. */
    console.warn('Standix \u00b7 pr\u00e9sence :', ex?.message || ex)
    return true
  }
}

/* On se re-signale régulièrement : c'est ce qui permet au serveur de savoir qui
   est ENCORE là, et donc de libérer la place de ceux qui sont partis. */
function lancerSuiviPresence(membre) {
  arreterSuiviPresence()
  minuteurPresence = setInterval(async () => {
    const ok = await signalerPresence(membre)
    if (!ok) {
      arreterSuiviPresence()
      await supabase.auth.signOut()
      location.reload()
    }
  }, RYTHME_PRESENCE)
}

function arreterSuiviPresence() {
  if (minuteurPresence) { clearInterval(minuteurPresence); minuteurPresence = null }
}

/* Ce qu'on montre à quelqu'un dont l'appareil vient d'être déconnecté. Le ton
   n'est pas accusateur : on explique ce qu'on perd, et ce qu'il faut demander. */
async function fenetreTropDAppareils() {
  await confirmDialog({
    titre: 'Trop d\'appareils',
    message: `Ce compte est d\u00e9j\u00e0 utilis\u00e9 sur ${APPAREILS_MAX} appareils. ` +
      `Cet appareil-ci a \u00e9t\u00e9 d\u00e9connect\u00e9.\n\n` +
      `Standix compte les lectures par personne : si votre \u00e9quipe partage un seul ` +
      `compte, votre responsable ne sait pas qui a lu quoi. Demandez-lui votre ` +
      `propre acc\u00e8s \u2014 c'est compris dans votre abonnement.`,
    confirmer: 'Compris', annuler: 'Fermer', danger: false,
  })
}

/* ─── La page des appareils ─────────────────────────────────────────────── */

window.ouvrirAppareils = async function() {
  const gestion = currentMembre?.role === 'gestion'
  if (gestion) showGestionScreen('p-reg-appareils')
  else showEquipeScreen('reg-appareils')
  const el = document.getElementById(gestion ? 'p-app-liste' : 'app-liste')
  if (el) el.innerHTML = '<div class="note">Chargement\u2026</div>'
  await peindreAppareils()
}

document.getElementById('app-retour')?.addEventListener('click', () => {
  if (currentMembre?.role === 'gestion') showGestionScreen('p-settings')
  else showEquipeScreen('e-settings')
})

function quandLisible(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const minutes = Math.floor((Date.now() - d) / 60000)
  if (minutes < 2) return 'en ce moment'
  if (minutes < 60) return `il y a ${minutes} min`
  if (minutes < 1440) return `il y a ${Math.floor(minutes / 60)} h`
  const jours = Math.floor(minutes / 1440)
  if (jours === 1) return 'hier'
  if (jours < 7) return `il y a ${jours} jours`
  return 'le ' + d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

async function peindreAppareils() {
  /* Chaque espace a sa propre liste : on écrit dans celle de l'espace courant. */
  const el = document.getElementById(
    currentMembre?.role === 'gestion' ? 'p-app-liste' : 'app-liste')
  if (!el || !currentMembre?.id) return

  const { data, error } = await supabase.from('presences')
    .select('id, empreinte, nom, reseau, premiere_fois, derniere_fois, revoquee')
    .eq('membre_id', currentMembre.id)
    .order('derniere_fois', { ascending: false })

  if (error) {
    el.innerHTML = `<div class="note">Impossible de lire vos appareils : ${escapeHtml(error.message)}<br>Ex\u00e9cutez migration-presences.sql.</div>`
    return
  }

  /* La liste ne montre QUE les appareils encore rattachés. Ceux qu'on a
     déconnectés n'ont plus rien à y faire. */
  const brut = (data || []).filter(a => !a.revoquee)
  const recent = Date.now() - 30 * 60000

  /* ═══ UN TÉLÉPHONE, UNE LIGNE ═══

     La base garde une trace par réseau : le même iPhone passant du wifi à la 4G
     produisait deux lignes, et le compteur annonçait deux appareils. On voyait
     « 3 sur 3 » avec un seul téléphone en main, et on croyait à une intrusion.

     On regroupe donc sur ce qui identifie vraiment l'appareil : son nom. Deux
     lignes portant « iPhone de Léa » sont le même téléphone, quel que soit le
     réseau par lequel il est passé.

     L'empreinte ne convient pas pour ça : c'est justement elle qui change avec
     le réseau. C'est la cause du problème, pas sa solution. */
  /* ═══ LE NAVIGATEUR NE FAIT PAS UN APPAREIL ═══

     Le nom rendu par la base porte souvent le navigateur : « iPhone · Safari »
     et « iPhone · Chrome ». Deux lignes pour un seul téléphone, et le compteur
     annonçait deux appareils là où il n'y en a qu'un.

     `socleAppareil` retire cette partie. Elle coupe au premier séparateur —
     tiret, point médian, parenthèse — et écarte les noms de navigateurs connus
     s'ils apparaissent ailleurs dans la chaîne.

     ⚠ ON NE TOUCHE PAS À LA BASE. Chaque ligne reste enregistrée : c'est elle
       qui porte la date de dernière visite, et deux navigateurs sur le même
       téléphone peuvent avoir des activités différentes. On regroupe seulement
       à L'AFFICHAGE, et `lignes` garde tous les identifiants — la révocation
       les supprime donc tous ensemble, ce qui est le comportement attendu. */
  const NAVIGATEURS = ['safari', 'chrome', 'firefox', 'edge', 'opera', 'samsung internet',
                       'brave', 'duckduckgo', 'webview', 'crios', 'fxios']
  /* Le socle en conservant la casse : c'est lui qu'on affiche. */
  const socleAffiche = (nom) => {
    let t = String(nom || 'Appareil').trim()
    t = t.split(/\s*[·\-—|(]\s*/)[0].trim()
    const mots = t.split(/\s+/).filter(m => !NAVIGATEURS.includes(m.toLowerCase()))
    return mots.join(' ').trim() || t || 'Appareil'
  }
  /* Le même, en minuscules : c'est lui qui sert de clé de regroupement. */
  const socleAppareil = (nom) => {
    let t = String(nom || 'Appareil').trim()
    /* Tout ce qui suit un séparateur est un détail, pas l'appareil. */
    t = t.split(/\s*[·\-—|(]\s*/)[0].trim()
    /* Le navigateur peut aussi être accolé sans séparateur. On le retire mot à
       mot plutôt qu'en bloc : « iPhone Safari » et « Safari iPhone » doivent
       donner le même socle. */
    const mots = t.split(/\s+/).filter(m => !NAVIGATEURS.includes(m.toLowerCase()))
    const propre = mots.join(' ').trim()
    return (propre || t || 'Appareil').toLowerCase()
  }

  const parAppareil = new Map()
  for (const a of brut) {
    const cle = socleAppareil(a.nom)
    const connu = parAppareil.get(cle)
    if (!connu) {
      /* ═══ LE NOM AFFICHÉ, SANS LE NAVIGATEUR ═══

         On ne peut pas afficher la clé : elle est en minuscules pour que le
         regroupement ignore la casse, et « iPhone » deviendrait « Iphone ».

         On recalcule donc le socle sur le nom D'ORIGINE, en gardant sa casse.
         `socleAffiche` fait le même travail que `socleAppareil` sans passer en
         minuscules — les deux partagent la même liste de navigateurs, donc ils
         ne peuvent pas diverger. */
      parAppareil.set(cle, { ...a, nom: socleAffiche(a.nom), lignes: [a.id],
                             reseaux: a.reseau ? [a.reseau] : [] })
      continue
    }
    /* On garde la visite la plus récente : c'est elle qui dit si l'appareil est
       actif en ce moment. */
    if (new Date(a.derniere_fois) > new Date(connu.derniere_fois)) {
      connu.derniere_fois = a.derniere_fois
    }
    if (new Date(a.premiere_fois) < new Date(connu.premiere_fois)) {
      connu.premiere_fois = a.premiere_fois
    }
    connu.lignes.push(a.id)
    if (a.reseau && !connu.reseaux.includes(a.reseau)) connu.reseaux.push(a.reseau)
  }
  const liste = [...parAppareil.values()]
    .sort((a, b) => new Date(b.derniere_fois) - new Date(a.derniere_fois))
  const actifs = liste.filter(a => new Date(a.derniere_fois) > recent)

  /* Le compteur dit ce que la liste montre. Il comptait les appareils actifs
     dans la demi-heure, alors que la liste les affichait tous — deux nombres
     différents pour la même chose, et c'est le petit qui était annoncé. */
  const val = `${liste.length} sur ${APPAREILS_MAX}`
  for (const id of ['e-nb-appareils', 'p-nb-appareils']) {
    const e = document.getElementById(id)
    if (e) e.textContent = val
  }

  if (!liste.length) {
    el.innerHTML = '<div class="note">Aucun appareil enregistr\u00e9 pour le moment.</div>'
    return
  }

  /* Un même téléphone peut apparaître plusieurs fois : l'appareil est reconnu à
     son réseau, et passer du wifi à la 4G le fait compter comme un nouveau. On
     le dit, sinon on croit à une intrusion. */
  /* La note qui expliquait les doublons de réseau est retirée : il n'y a plus de
     doublons à justifier. Une explication qui survit à son problème devient une
     inquiétude gratuite. */
  const noteReseau = ''

  el.innerHTML = liste.map(a => {
    const vivant = new Date(a.derniere_fois) > recent
    return `<div class="app-ligne${vivant ? ' moi' : ''}${a.revoquee ? ' revoque' : ''}">
      <span class="ic">
        <svg viewBox="0 0 24 24" fill="none">
          <rect x="6.5" y="2.5" width="11" height="19" rx="2.6" stroke="rgba(255,255,255,0.78)" stroke-width="1.7"/>
          <line x1="10.4" y1="18.6" x2="13.6" y2="18.6" stroke="rgba(255,255,255,0.78)" stroke-width="1.7" stroke-linecap="round"/>
        </svg>
      </span>
      <span class="tx">
        <span class="nm">${escapeHtml(a.nom || 'Appareil')}${vivant ? '<span class="ici">actif</span>' : ''}</span>
        <span class="st">${quandLisible(a.derniere_fois)}${
            a.reseaux.length > 1
              ? ' \u00b7 ' + a.reseaux.length + ' r\u00e9seaux'
              : (a.reseaux[0] ? ' \u00b7 ' + escapeHtml(a.reseaux[0]) : '')
          }</span>
      </span>
      <button type="button" class="oter" data-appareil="${a.lignes.join(',')}"
        data-nom="${escapeHtml(a.nom || 'cet appareil')}">Retirer</button>
    </div>`
  }).join('')
  el.insertAdjacentHTML('afterbegin', noteReseau)
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-appareil]')
  if (!b) return
  const ok = await confirmDialog({
    titre: `Retirer ${b.dataset.nom} ?`,
    message: "Cet appareil sera d\u00e9connect\u00e9 et lib\u00e9rera une place. " +
      "Il pourra revenir plus tard s'il en reste une.",
    confirmer: 'Retirer', annuler: 'Annuler', danger: true,
  })
  if (!ok) return
  /* Une ligne d'écran peut recouvrir PLUSIEURS lignes en base — le même
     téléphone vu par deux réseaux. Les retirer toutes : n'en effacer qu'une
     ferait réapparaître l'appareil au rechargement. */
  const lignes = String(b.dataset.appareil || '').split(',').filter(Boolean)
  const { error } = await supabase.from('presences').delete().in('id', lignes)
  if (error) { toast('\u00c9chec : ' + error.message); return }
  await peindreAppareils()
  toast('Appareil retir\u00e9.')
})

async function enterApp(membre) {

  currentMembre = membre
  try {
    localStorage.setItem('procedo_espace', membre.role)
    // Le repère du rechargement : on retient la fiche, donc l'établissement.
    localStorage.setItem('procedo_membre', String(membre.id))
  } catch (e) {}

  /* On masque les écrans d'accueil AVANT toute attente. Ils l'étaient après le
     chargement des procédures : sur une connexion lente, plusieurs secondes
     s'écoulaient pendant lesquelles un autre chemin pouvait afficher l'écran de
     choix — et les deux se superposaient, comme sur mobile. */
  document.getElementById('login-screen').style.display = 'none'
  document.getElementById('choice-screen').style.display = 'none'

  /* Avant tout : cet appareil a-t-il le droit d'entrer ? On le demande au
     serveur, ici plutôt qu'à la connexion, pour couvrir aussi la reprise de
     session. */
  const autorise = await signalerPresence(membre)
  if (!autorise) {
    await supabase.auth.signOut()
    currentMembre = null
    document.getElementById('gestion-app').style.display = 'none'
    document.getElementById('equipe-app').style.display = 'none'
    afficherBarre(false)
    afficherBarre(false)
    const ecranRejet = document.getElementById('login-screen')
    ecranRejet.style.display = 'flex'
    /* Troisième chemin qui montre cet écran : lui aussi doit lever l'inertie,
       sinon la personne verrait un formulaire qu'elle ne peut pas remplir. */
    ecranRejet.removeAttribute('inert')
    /* ═══ LES ONGLETS REVIENNENT ICI ═══

       Ce chemin renvoie à la connexion quelqu'un qui pouvait venir de
       n'importe où — y compris de « Créer une entreprise », qui les avait
       masqués. Sans ce retrait, il arriverait sur un écran de connexion sans
       moyen de basculer, et se retrouverait coincé.

       Le mécanisme n'a de sens que si CHAQUE chemin remet l'état qu'il
       suppose. Un attribut posé par un écran et jamais retiré par un autre est
       une porte fermée qu'on ne retrouve plus. */
    document.querySelector('.auth-toggle')?.removeAttribute('data-cache')
    switchAuthTab('login')
    const sousR = document.getElementById('auth-sous')
    if (sousR) sousR.textContent = 'Connectez-vous ou cr\u00e9ez votre compte'
    window.__procedoLoaded = true
    await fenetreTropDAppareils()
    return
  }
  lancerSuiviPresence(membre)

  /* Les deux espaces s'excluent. On masque LES DEUX avant d'en montrer un :
     quelqu'un qui passe de l'équipe à la gestion — une promotion, par exemple —
     gardait l'ancien affiché sous le nouveau, et voyait les deux à la fois. */
  document.getElementById('gestion-app').style.display = 'none'
  document.getElementById('equipe-app').style.display = 'none'
  afficherBarre(false)
  afficherBarre(false)

  armerSurveillance()

  /* Le tiroir se dessine TOUT DE SUITE, avec ce qu'on sait déjà : la fiche
     membre suffit. Il apparaît donc en même temps que la carte au logo et le
     bouton des réglages, au lieu d'arriver après la lecture en base — ce qui
     donnait une barre incomplète pendant une seconde. */
  peindreTiroir()
  peindreBarreEtablissements()

  // Préchauffage des bibliothèques QR : utile, mais surtout pas pendant le
  // premier affichage. On attend que le navigateur soit inoccupé.
  const prechauffer = () => {
    if (membre.role === 'gestion') ensureQRCode().catch(() => {})
    else ensureJsQR().catch(() => {})
  }
  // Essai : ?nopreload=1 supprime le téléchargement anticipé des bibliothèques QR
  if (!/[?&]nopreload=1/.test(location.search)) {
    if ('requestIdleCallback' in window) requestIdleCallback(prechauffer, { timeout: 6000 })
    else setTimeout(prechauffer, 2500)
  }

  if (membre.role === 'gestion') {
    /* On désigne explicitement l'écran d'accueil. Sans ça, l'écran resté actif
       d'une session précédente réapparaissait : se déconnecter depuis une fiche
       de procédure puis recréer un compte ramenait sur cette fiche, parce que
       rien ne remettait la navigation à zéro. */
    showGestionScreen('p-home')

    /* ═══ LE DESSIN D'ABORD, LES DONNÉES ENSUITE ═══

       `loadGestionProcedures()` était ATTENDU ici, avant d'afficher quoi que ce
       soit : la barre du haut, la barre du bas, les cadres, tout restait caché
       jusqu'à ce que la dernière requête ait répondu. Sur une connexion lente,
       c'était plusieurs secondes de noir — l'app paraissait ne pas démarrer.

       On montre maintenant la charpente tout de suite. Les blocs s'affichent
       vides — ils savent le faire, chacun porte sa phrase d'attente — puis se
       remplissent quand les données arrivent.

       Le chargement n'est pas plus rapide. Il est simplement VISIBLE, ce qui
       n'est pas la même chose mais règle le même problème. */
    document.getElementById('login-screen').style.display = 'none'
    document.getElementById('choice-screen').style.display = 'none'
    const appEl = document.getElementById('gestion-app')
    appEl.style.display = 'block'
    appEl.removeAttribute('inert')
    if (basculeSansAnimation) {
      // On retire la classe sans la remettre : aucune animation ne peut rejouer.
      appEl.classList.remove('app-shell-in')
    } else {
      appEl.classList.remove('app-shell-in'); void appEl.offsetWidth; appEl.classList.add('app-shell-in')
    }
    afficherBarre(true)
    mesurerOnglets()
    window.jalon?.('APP AFFICHÉE')

    /* ═══ LES BLOCS AUSSI FONT PARTIE DE LA CHARPENTE ═══

       Ils n'étaient peints qu'APRÈS le chargement : pendant les deux secondes
       d'attente, l'accueil n'affichait que sa carte d'ouverture, seule au
       milieu du vide. On voyait une page à moitié construite.

       On les peint tout de suite, sur des données encore vides — ils savent le
       faire, chacun porte sa phrase d'attente. La page est alors complète dès
       la première image, et le chargement ne fait que la remplir. */
    renderAccueil()

    /* Les données, une fois la charpente à l'écran. On n'attend plus AVANT
       d'afficher — on remplit APRÈS. */
    await loadGestionProcedures()
    revelerApp()
    desarmerSurveillance()
    window.mesurerFluidite?.()
    // Premier placement sans animation : la barre vient d'apparaître, la
    // pastille doit déjà être au bon endroit, pas y glisser depuis la gauche.
    placerPastilleSansAnimation('tabbar')
    // Le logo est invisible tant qu'il n'a pas sa classe : on la pose tout de
    // suite. L'animation ne repose plus sur un tracé redessiné image par image,
    // elle peut donc démarrer avec l'app sans la faire saccader.
    if (!basculeSansAnimation) lancerAnimationLogo(document.getElementById('topbar-logo-gestion'))
    if (!basculeSansAnimation) atterrirEnHaut()
    chargerLangue()
    chargerEtablissements()
    // Une fois les procédures chargées, l'entreprise est connue : on peut la nommer.
    verifierPromotion(membre)          // tout de suite : c'est la première chose à dire
    chargerAlertesPartage()
    if (cibleQR) ouvrirCibleQR()
    finDuDemarrage()
  } else {
    showEquipeScreen('e-list')
    await loadEquipeProcedures()
    document.getElementById('login-screen').style.display = 'none'
    document.getElementById('choice-screen').style.display = 'none'
    const appEl = document.getElementById('equipe-app')
    appEl.style.display = 'block'
    if (basculeSansAnimation) {
      // On retire la classe sans la remettre : aucune animation ne peut rejouer.
      appEl.classList.remove('app-shell-in')
    } else {
      appEl.classList.remove('app-shell-in'); void appEl.offsetWidth; appEl.classList.add('app-shell-in')
    }
    afficherBarre(true)
    mesurerOnglets()
    chargerLangue()
    chargerEtablissements()
    verifierPromotion(membre)          // tout de suite : c'est la première chose à dire
    window.jalon?.('APP AFFICHÉE')
    revelerApp()
    desarmerSurveillance()
    window.mesurerFluidite?.()
    // Premier placement sans animation : la barre vient d'apparaître, la
    // pastille doit déjà être au bon endroit, pas y glisser depuis la gauche.
    placerPastilleSansAnimation('tabbar')
    // Le logo est invisible tant qu'il n'a pas sa classe : on la pose tout de
    // suite. L'animation ne repose plus sur un tracé redessiné image par image,
    // elle peut donc démarrer avec l'app sans la faire saccader.
    if (!basculeSansAnimation) lancerAnimationLogo(document.getElementById('topbar-logo-equipe'))
    atterrirEnHaut()
    finDuDemarrage()
    if (cibleQR) ouvrirCibleQR()
  }

  /* Une fois l'app à l'écran, pas avant : la question arrive sur une interface
     qu'on reconnaît, pas sur un fond gris de chargement. */
  setTimeout(() => proposerPosteALArrivee(), 700)
}

/* Ouvre la procédure visée par le QR, dans l'espace où l'on se trouve. Un
   gérant qui scanne son propre QR arrive sur l'analyse de la procédure, pas
   sur la fiche de lecture : ce n'est pas lui qui doit la consulter. */
let qrPropositionFaite = false

async function ouvrirCibleQR() {
  if (!cibleQR) return

  /* Cas fréquent en pratique : la personne est connectée, mais dans une autre
     entreprise que celle du QR. Sans rien faire, elle verrait « Procédure
     introuvable » sans comprendre pourquoi. On identifie l'entreprise du code
     et on lui propose d'y aller. */
  if (cibleQR.code && currentMembre && !qrPropositionFaite) {
    qrPropositionFaite = true
    if (await proposerEntrepriseDuQR(cibleQR.code)) return   // l'app est relancée
  }

  const id = cibleQR.proc
  // On efface le paramètre de l'adresse pour qu'un rechargement plus tard ne
  // renvoie pas indéfiniment sur la même procédure.
  try { history.replaceState({}, '', window.location.pathname) } catch (e) {}

  if (currentMembre?.role === 'gestion') { openAnalyse(id); return }

  /* Arrivée depuis l'appareil photo du téléphone. On passe TOUJOURS par la
     fenêtre, comme pour le scanner de l'app : un code peut être mal visé, et
     atterrir d'un coup dans une procédure sans savoir laquelle est brutal.
     Les nouveaux ont l'accueil complet avec le Memoji, les habitués la version
     sobre — mais personne n'entre sans avoir vu le nom. */
  const proc = allEquipeProcedures.find(p => p.id === id)
  let titre = proc?.titre, categorie = proc?.categorie

  /* On LANCE la requête sans l'attendre. Tout l'intérêt est là : la fenêtre
     s'ouvre pendant que la base répond, au lieu de laisser l'écran noir après
     le scan. Le nom se posera dessus quand il arrivera.

     Le `await` avait été remis ici par une réécriture, et la variable qui
     portait la promesse a disparu avec — mais le code plus bas l'attendait
     toujours. L'arrivée par QR code s'arrêtait net dès que le titre n'était
     pas déjà en mémoire. */
  const promesseTitre = titre ? null : supabase.from('procedures')
    .select('titre, categorie').eq('id', id).maybeSingle()

  const nouveau = estNouvelUtilisateur()
  if (nouveau) marquerBienvenueVue()

  /* La fenêtre apparaît MAINTENANT, même si le nom n'est pas encore connu. Elle
     attendait jusqu'ici la réponse de la base : un aller-retour réseau pendant
     lequel l'écran restait noir après le scan. Le nom se pose ensuite. */
  const attente = fenetreBienvenue(titre, categorie, nouveau)

  if (promesseTitre) {
    const { data } = await promesseTitre
    titre = data?.titre; categorie = data?.categorie
    if (!titre) {
      fermerFenetreBienvenue()
      await confirmDialog({
        titre: 'Proc\u00e9dure introuvable',
        message: "Ce code correspond \u00e0 une proc\u00e9dure qui n'existe plus, ou qui appartient \u00e0 une autre entreprise.",
        confirmer: 'Compris', annuler: 'Fermer', danger: false,
      })
      return
    }
    majFenetreBienvenue(titre, categorie)
  }

  const ok = await attente
  if (!ok) return
  openEquipeDetail(id)
}

/* Renvoie true si l'app a été relancée sur une autre entreprise — dans ce cas
   l'ouverture de la procédure se fera au tour suivant. */
async function proposerEntrepriseDuQR(code) {
  const ent = await entrepriseParCode(code)

  // Code inconnu, ou déjà la bonne entreprise : rien à proposer.
  if (!ent || ent.id === currentMembre.entreprise_id) return false

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  // Peut-être appartient-elle déjà à cette entreprise, sans y être en ce moment.
  const { data: dejaMembre } = await supabase
    .from('membres').select('*').eq('user_id', user.id).eq('entreprise_id', ent.id).maybeSingle()

  const nom = ent.nom || 'cette entreprise'
  const ok = await confirmDialog({
    titre: dejaMembre ? "Changer d'entreprise ?" : 'Consulter cette procédure ?',
    message: dejaMembre
      ? `Cette procédure appartient à « ${nom} », où vous avez déjà un accès. Basculer vers cette entreprise pour la consulter ?`
      : `Cette procédure appartient à « ${nom} ». Vous pourrez la consulter, mais pas les autres procédures de l'entreprise : il faut pour cela le code de votre responsable.`,
    confirmer: dejaMembre ? 'Basculer' : 'Consulter',
    annuler: 'Annuler',
    danger: false,
  })
  if (!ok) return false

  let membre = dejaMembre
  if (!membre) {
    /* Adhésion « visiteur » : rattachée à une seule procédure. C'est ce qui
       permet de n'afficher que celle-là, sans jamais charger les autres. */
    /* La place est-elle libre ? Si l'entreprise est complète, la demande est
       déposée et l'on s'arrête ici. */
    if (!(await verifierPlaceLibre(ent.id, ent.nom))) return
    const { data, error } = await supabase.from('membres').insert({
      user_id: user.id,
      nom: currentMembre?.nom || '',
      role: 'visiteur',
      entreprise_id: ent.id,
      procedure_visitee: cibleQR.proc,
    }).select().single()
    if (error) { toast("Accès impossible : " + error.message); return false }
    membre = data
  }

  document.getElementById('gestion-app').style.display = 'none'
  document.getElementById('equipe-app').style.display = 'none'
  afficherBarre(false)
  afficherBarre(false)
  await enterApp(membre)
  return true
}

// Le décor (halos, animations de cartes) ne se remet en marche qu'une fois
// l'app réellement affichée et posée. Avant ça, tout le processeur sert à
// l'afficher — c'est ce qui rendait le lancement saccadé sur iPhone.
let demarrageTermine = false
function finDuDemarrage() {
  if (demarrageTermine) return
  demarrageTermine = true
  const liberer = () => {
    document.body.classList.remove('booting')
    /* L'écran de choix et la connexion ne passent par aucun espace : sans cet
       appel, le voile resterait posé sur une page qui n'a rien à charger. */
    revelerApp()
  }
  if ('requestIdleCallback' in window) requestIdleCallback(liberer, { timeout: 1200 })
  else setTimeout(liberer, 300)
}

// ═══ PARAMÈTRES ═══
/* Remplit la fiche du haut et les valeurs affichées à droite de chaque ligne.
   Une valeur à droite évite d'ouvrir la page pour savoir ce qu'elle contient :
   c'est tout l'intérêt de la grammaire d'iOS. */
function peindreReglages() {
  const nom = currentMembre?.nom || ''
  const el = (i) => document.getElementById(i)

  if (el('reg-nom')) el('reg-nom').textContent = nom || 'Votre compte'
  if (el('reg-initiales')) el('reg-initiales').textContent = initialesEtab(nom)

  const n = (cachedMembres || []).length
  if (el('reg-nb-membres')) {
    el('reg-nb-membres').textContent = n ? `${n} membre${n > 1 ? 's' : ''}` : '\u2014'
  }

  /* ═══ L'APERÇU DIT S'IL Y A UN CODE, PAS LEQUEL ═══

     Il affichait le code permanent dans la liste des réglages. Un code
     temporaire n'a pas sa place là : il change, il expire, et le lire hors de
     sa page ne dit pas combien de temps il vaut encore.

     La ligne dit maintenant l'état — un code court, ou aucun. */
  const codeVivant = cachedEntreprise?.code_invite &&
    new Date(cachedEntreprise.code_invite_expire) > Date.now()
  if (el('reg-code-val')) {
    el('reg-code-val').textContent = codeVivant ? 'Un code est actif' : 'Aucun code'
  }

  /* La ligne des établissements n'apparaît qu'à ceux qui en ont plusieurs, ou
     dont l'offre le permet : ailleurs elle n'aurait rien à montrer. */
  const ne = (mesEtablissements || []).length
  const montrer = ne > 0 && multiSitesAutorise()
  if (el('reg-nb-etabs')) {
    el('reg-nb-etabs').textContent = ne > 1 ? `${ne} \u00e9tablissements` : '1 \u00e9tablissement'
  }

  const l = LANGUES.find(x => x.code === langueApp)
  if (el('reg-langue-val')) el('reg-langue-val').textContent = l?.nom || 'Fran\u00e7ais'
  peindreReglagesEquipe()

  // L'adresse vient du champ, qui est rempli au chargement du compte.
  if (el('reg-email')) el('reg-email').textContent = el('settings-email')?.value || '\u2014'
}

/* Chaque réglage a sa page : on y entre, on en revient. C'est la navigation
   d'iOS, et elle vaut mieux qu'un dépliage — une page peut expliquer, respirer,
   et l'on sait toujours où l'on se trouve. */

window.openSettings = async function() {
  rendreChoixLangueApp()
  chargerEtablissements()
  peindreReglages()
  peindreAppareils()
  chargerAlertesPartage()
  showGestionScreen('p-settings')
  document.getElementById('settings-nom').value = currentMembre.nom || ''
  const { data: userData } = await supabase.auth.getUser()
  document.getElementById('settings-email').value = userData?.user?.email || ''
  document.getElementById('reg-email').textContent = document.getElementById('settings-email').value || '—'

  // Déjà préchargé au démarrage : affichage immédiat, pas d'attente
  let entreprise = cachedEntreprise
  if (!entreprise) {
    document.getElementById('settings-code').textContent = '...'
    const { data, error: entrepriseError } = await supabase
      .from('entreprises').select('*').eq('id', currentMembre.entreprise_id).maybeSingle()
    if (entrepriseError) {
      console.error('Erreur chargement code entreprise :', entrepriseError)
      document.getElementById('settings-code').textContent = '—'
      return
    }
    entreprise = data
    cachedEntreprise = data
  }

  /* ═══ PLUS DE CODE PERMANENT À GÉNÉRER ═══

     Ce bloc créait un code à cinq chiffres pour toute entreprise qui n'en
     avait pas — une survivance de l'époque où le code était permanent.

     Il n'y a plus rien à créer d'office : un code n'existe que si le gérant en
     demande un, et il meurt à son échéance. */
  peindreCodeInvite()
}

document.getElementById('copy-code-btn')?.addEventListener('click', () => {
  const code = document.getElementById('settings-code').textContent
  if (code && code !== '—') {
    navigator.clipboard.writeText(code)
    const btn = document.getElementById('copy-code-btn')
    const original = btn.textContent
    btn.textContent = 'Copié !'
    setTimeout(() => { btn.textContent = original }, 1500)
  }
})

/* `expliquerLePoids` a été retirée avec l'avertissement qui l'appelait. */


document.addEventListener('click', (e) => {
})

/* ═══ « ÉTAPE 1 — » EST DE TROP ═══

   L'IA préfixe souvent ses phrases par « Étape 1 : », « 1. » ou « Étape 3 — ».
   Le chiffre est DÉJÀ dans le cercle à gauche : l'écrire deux fois vole de la
   place au geste, seule chose qui compte pour quelqu'un qui lit debout.

   On nettoie à L'AFFICHAGE plutôt qu'à la création, pour deux raisons : les
   procédures déjà créées en profitent immédiatement, et le texte d'origine
   reste intact en base — si le nettoyage se révélait trop gourmand, rien n'est
   perdu.

   ═══ CE QUE LA RÈGLE ATTRAPE ═══

     « Étape 1 : Ouvrir »      → « Ouvrir »
     « Étape 3 — Fermer »      → « Fermer »
     « 1. Rincer »             → « Rincer »
     « 2) Essuyer »            → « Essuyer »

   ET CE QU'ELLE LAISSE, volontairement :

     « 2 minutes de cuisson »  → intact, le chiffre appartient à la phrase
     « 1er étage »             → intact

   La règle exige un séparateur — deux-points, tiret, point ou parenthèse —
   SUIVI d'une espace. « 2 minutes » n'en a pas, donc rien n'est retiré. */
function sansNumeroDEtape(texte) {
  if (!texte) return ''
  return String(texte)
    .replace(/^\s*(?:\u00e9tape|etape)\s*\d+\s*[:.\u2014\u2013-]\s+/i, '')
    .replace(/^\s*\d+\s*[.):]\s+/, '')
    .trim()
}

/* ═══════════════════════════════════════════════════════════════════════════
   LE RÉSUMÉ DE L'ENTREPRISE, EN HAUT DE L'ACCUEIL

   Ce qu'un gérant vient vérifier en ouvrant l'app : combien ils sont, qui fait
   quoi. L'illustration qui occupait cette place ne lui apprenait rien.

   ═══ POURQUOI « MEMBRES » ET PAS « EMPLOYÉS » ═══

   Le compte total inclut le gérant lui-même. Écrire « 8 employés » quand on est
   huit dont le patron serait faux — et personne ne compte son patron parmi ses
   employés. « Membres » englobe tout le monde sans mentir.

   ═══ LES POSTES SANS PERSONNE ═══

   Ils sont affichés quand même, à zéro. Un poste vide est une information : soit
   il faut recruter, soit il faut le supprimer. Le masquer, c'est l'oublier.
   ═══════════════════════════════════════════════════════════════════════════ */
async function peindreResumeEntreprise() {
  const salut = document.getElementById('re-salut')
  const chiffres = document.getElementById('re-chiffres')
  const postes = document.getElementById('re-postes')
  if (!salut || !chiffres) return

  /* La carte est dévoilée à la SORTIE de cette fonction, jamais ici : tout ce
     qui suit peut attendre le réseau, et la révéler maintenant reviendrait à
     montrer un cadre vide — exactement ce qu'on corrige. */
  const carte = document.getElementById('accueil-resume')
  const devoiler = () => {
    if (!carte || !carte.classList.contains('pas-prete')) return
    carte.classList.remove('pas-prete')
    carte.classList.add('neuf')
  }

  /* Le prénom seul. « Bonjour Emilien Meifj » sonne comme un courrier
     administratif ; le prénom, comme quelqu'un qui vous connaît. */
  const nom = (currentMembre?.nom || '').trim()
  const prenom = nom ? nom.split(/\s+/)[0] : ''
  salut.textContent = prenom ? `Bonjour ${prenom}` : 'Bonjour'

  const membres = cachedMembres || []
  const nbGestion = membres.filter(m => m.role === 'gestion').length
  const nbEquipe = membres.filter(m => m.role === 'equipe').length
  const total = membres.length
  const s = (n) => (n > 1 ? 's' : '')

  /* Le total rejoint la ligne de la salutation. Il n'avait pas besoin d'une
     case à lui : 11 = 3 + 8, et une case qui répète la somme de ses deux
     voisines occupe la même place qu'elles pour ne rien ajouter. */
  const totalEl = document.getElementById('re-total')
  if (totalEl) {
    totalEl.textContent = total ? `${total} membre${s(total)}` : ''
  }

  /* ═══ LA BARRE DE RÉPARTITION ═══

     Trois cases de même taille donnaient le même poids visuel à un total et à
     ses deux parts. Une barre montre la PROPORTION — ce que trois nombres
     alignés obligeaient à calculer de tête.

     ON N'ÉMET QUE LES SEGMENTS NON VIDES. Un segment à `flex:0` aurait une
     largeur nulle, mais l'écart entre segments s'appliquerait quand même : il
     resterait un moignon de 3 px collé au bord. */
  const segments = []
  if (nbGestion > 0) segments.push(`<i class="re-sg" style="flex:${nbGestion}"></i>`)
  if (nbEquipe > 0) segments.push(`<i class="re-se" style="flex:${nbEquipe}"></i>`)

  /* « Équipe » plutôt qu'« employés » : c'est le nom de l'espace dans l'app —
     Gestion d'un côté, Équipe de l'autre — et la carte doit employer les mêmes
     mots que la navigation. « Employés » désignait la même chose avec un autre
     vocabulaire, et obligeait à faire le rapprochement.

     Le mot ne s'accorde plus : « 8 équipe » serait faux, mais « équipe » est un
     collectif — on écrit « 8 en équipe » comme on dit « 3 en gestion ». Les deux
     libellés se lisent alors sur le même modèle. */
  chiffres.innerHTML = total === 0 ? '' : (
    `<div class="re-barre">${segments.join('')}</div>` +
    `<div class="re-leg">` +
      `<span><b class="g">${nbGestion}</b> en gestion</span>` +
      `<span><b class="e">${nbEquipe}</b> en équipe</span>` +
    `</div>`
  )

  /* ═══ TROIS SORTIES, TROIS RÉVÉLATIONS ═══

     La carte est complète dès ici : le salut, le total et la barre sont
     posés. Ce qui suit — les postes — vient d'une requête séparée qui peut
     ne rien rendre.

     Dévoiler à CHAQUE sortie plutôt qu'à la fin seulement : sur une entreprise
     sans postes, la fonction s'arrête avant, et la carte resterait masquée
     pour toujours. Un masquage qu'on oublie de lever est pire que pas de
     masquage du tout. */
  /* ═══ LES POSTES ONT QUITTÉ CETTE CARTE ═══

     Elle en portait sept informations : le prénom, le total, la barre, deux
     chiffres de légende, la liste des postes et son tiroir. Une carte
     d'accueil doit accueillir, pas rendre compte.

     Les postes se consultent une fois par mois, pas chaque matin — et ils ont
     déjà leur page, dans Réglages, où on les crée et les renomme. Les afficher
     ici les dédoublait sans les rendre plus utiles.

     Reste le prénom, le total et la répartition gestion/équipe : trois
     informations qui disent l'état de l'entreprise en un regard. */
  devoiler()
}

/* `basculerPostes` et `postesOuverts` ont été retirés avec le tiroir : ils ne
   pilotaient plus rien. Une fonction exposée sur `window` que plus personne
   n'appelle est pire que du code mort — elle laisse croire qu'un mécanisme
   existe encore. */

/* ═══════════════════════════════════════════════════════════════════════════
   LE CODE DE GESTION

   Il n'existe que lorsqu'une invitation est en cours. La page a donc deux
   états : un encadré qui propose d'en créer un, et un encadré qui montre celui
   qui court.

   Tout se joue côté base, par des fonctions `security definer` : l'app ne
   peut ni engendrer un code, ni décider qu'il est valide. Elle demande, la
   base répond. C'est ce qui empêche quelqu'un de se fabriquer un accès en
   modifiant ce qu'il envoie.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Combien de temps reste-t-il ? Formulé en jours, pas en heures : « expire
   dans 3 jours » se retient, « dans 71 heures » ne dit rien. */
function resteAvant(expire) {
  const ms = new Date(expire).getTime() - Date.now()
  if (ms <= 0) return { texte: 'Expiré', bientot: true, mort: true }
  const jours = Math.floor(ms / 86400000)
  const heures = Math.floor(ms / 3600000)
  if (jours >= 2) return { texte: `Expire dans ${jours} jours`, bientot: false }
  if (heures >= 2) return { texte: `Expire dans ${heures} heures`, bientot: true }
  return { texte: 'Expire dans moins d\u2019une heure', bientot: true }
}

/* ═══════════════════════════════════════════════════════════════════════════
   LE CODE D'INVITATION

   Un seul code, six caractères, créé à la demande pour une durée choisie.

   ⚠ IL EST TIRÉ CÔTÉ SERVEUR. `creer_code_invite` vérifie que l'appelant est
     bien en gestion de cette entreprise. Un code tiré dans le navigateur peut
     être choisi par celui qui le tire.
   ═══════════════════════════════════════════════════════════════════════════ */

let ciMinuteur = null

/* Le temps restant, en clair. Pas de secondes au-delà d'une minute : personne
   ne règle sa conduite sur « 4 min 37 », et un compteur qui bouge chaque
   seconde attire l'œil pour rien. */
function ciResteLisible(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return s + ' s'
  const m = Math.round(s / 60)
  if (m < 60) return m + ' min'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '')
  return Math.round(h / 24) + ' jours'
}

function peindreCodeInvite() {
  const vide = document.getElementById('ci-vide')
  const plein = document.getElementById('ci-plein')
  if (!vide || !plein) return

  clearInterval(ciMinuteur); ciMinuteur = null

  const code = cachedEntreprise?.code_invite
  const exp = cachedEntreprise?.code_invite_expire
  const reste = exp ? new Date(exp) - Date.now() : 0

  /* Un code expiré est traité comme absent. Le serveur le nettoie aussi, mais
     l'app ne doit pas attendre un aller-retour pour le savoir. */
  if (!code || reste <= 0) {
    vide.hidden = false; plein.hidden = true
    if (cachedEntreprise) { cachedEntreprise.code_invite = null; cachedEntreprise.code_invite_expire = null }
    return
  }

  vide.hidden = true; plein.hidden = false
  /* Les caractères espacés : un code de six signes se recopie mieux quand
     l'œil peut les compter. */
  document.getElementById('ci-code').textContent = code.split('').join('\u2009')

  const majReste = () => {
    const r = new Date(exp) - Date.now()
    if (r <= 0) { peindreCodeInvite(); return }
    document.getElementById('ci-reste').textContent = 'Expire dans ' + ciResteLisible(r)
  }
  majReste()
  /* Toutes les dix secondes : assez pour que le compteur reste juste, assez peu
     pour ne pas réveiller le téléphone. */
  ciMinuteur = setInterval(majReste, 10000)
}

/* Les trois durées. Le choix rappelle qu'un code a une fin — un bouton unique
   laisserait croire à un code permanent. */
document.querySelectorAll('.ci-d').forEach(b => {
  b.addEventListener('click', async () => {
    if (!currentMembre?.entreprise_id) return
    document.querySelectorAll('.ci-d').forEach(x => { x.disabled = true })
    try {
      const { data, error } = await supabase.rpc('creer_code_invite', {
        p_entreprise: currentMembre.entreprise_id,
        p_minutes: Number(b.dataset.min) || 120,
      })
      if (error) throw error
      const ligne = Array.isArray(data) ? data[0] : data
      if (cachedEntreprise) {
        cachedEntreprise.code_invite = ligne.code
        cachedEntreprise.code_invite_expire = ligne.expire
      }
      peindreCodeInvite()
      if (navigator.vibrate) navigator.vibrate(8)
    } catch (e) {
      toast('\u00c9chec : ' + (e?.message || e))
    } finally {
      document.querySelectorAll('.ci-d').forEach(x => { x.disabled = false })
    }
  })
})

document.getElementById('ci-copier')?.addEventListener('click', async () => {
  const code = cachedEntreprise?.code_invite
  if (!code) return
  try {
    await navigator.clipboard.writeText(code)
    toast('Code copi\u00e9')
  } catch {
    /* `clipboard` échoue sur les navigateurs anciens et hors HTTPS. On montre
       le code plutôt que de laisser croire à une copie qui n'a pas eu lieu. */
    toast('Copie impossible \u2014 le code est : ' + code)
  }
})

document.getElementById('ci-revoquer')?.addEventListener('click', async () => {
  if (!currentMembre?.entreprise_id) return
  const ok = await confirmDialog({
    titre: 'R\u00e9voquer ce code ?',
    message: 'Il cessera imm\u00e9diatement de fonctionner. Les personnes d\u00e9j\u00e0 ' +
             'inscrites gardent leur acc\u00e8s.',
    confirmer: 'R\u00e9voquer', annuler: 'Annuler', danger: true,
  })
  if (!ok) return
  const { error } = await supabase.rpc('revoquer_code_invite', {
    p_entreprise: currentMembre.entreprise_id,
  })
  if (error) { toast('\u00c9chec : ' + error.message); return }
  if (cachedEntreprise) { cachedEntreprise.code_invite = null; cachedEntreprise.code_invite_expire = null }
  peindreCodeInvite()
  toast('Code r\u00e9voqu\u00e9')
})

document.getElementById('settings-save-btn')?.addEventListener('click', async () => {
  const errorEl = document.getElementById('settings-error')
  const btn = document.getElementById('settings-save-btn')
  errorEl.textContent = ''
  const nom = document.getElementById('settings-nom').value.trim()
  if (!nom) { errorEl.textContent = 'Le nom est obligatoire.'; return }

  setButtonLoading(btn, true)
  const { error } = await supabase.from('membres').update({ nom }).eq('id', currentMembre.id)
  setButtonLoading(btn, false)
  if (error) { errorEl.textContent = "Erreur : " + error.message; return }
  currentMembre.nom = nom
  errorEl.style.color = 'var(--green)'
  errorEl.textContent = 'Enregistré.'
})

document.querySelectorAll('.plan-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.plan-card').forEach(c => c.classList.remove('active'))
    card.classList.add('active')
  })
})

/* La déconnexion est appelée depuis les deux espaces : elle doit exister sur
   `window`, sinon le bouton de l'espace équipe reste muet. */
window.signOut = async function() {
  await supabase.auth.signOut()
  currentMembre = null
  // On revient sur les écrans d'accueil des deux espaces, sinon le prochain
  // compte hériterait de la dernière page consultée.
  document.querySelectorAll('#gestion-app .screen, #equipe-app .screen').forEach(s => s.classList.remove('active'))
  document.getElementById('p-list')?.classList.add('active')
  document.getElementById('e-list')?.classList.add('active')
  document.getElementById('gestion-app').style.display = 'none'
  document.getElementById('equipe-app').style.display = 'none'
  afficherBarre(false)
  afficherBarre(false)
  /* Le repère et les copies locales n'ont plus de sens une fois déconnecté : le
     compte suivant sur ce téléphone ne doit hériter ni du choix ni des
     procédures de quelqu'un d'autre. */
  arreterSuiviPresence()
  try {
    localStorage.removeItem('procedo_membre')
    Object.keys(localStorage)
      .filter(k => k.startsWith('procedo_grille_'))
      .forEach(k => localStorage.removeItem(k))
  } catch (e) {}
  document.getElementById('login-email').value = ''
  document.getElementById('login-password').value = ''
  afficherEcranChoix()
}

/* Contact depuis les réglages, dans les deux espaces. Le courriel arrive
   prérempli avec l'espace et le nom : je sais tout de suite à qui je réponds. */
function ouvrirContact() {
  const espace = currentMembre?.role === 'gestion' ? 'Gestion' : 'Équipe'
  const sujet = encodeURIComponent('Standix · ' + espace)
  const corps = encodeURIComponent(
    '\n\n\u2014\n' + (currentMembre?.nom || '') + ' \u00b7 espace ' + espace)
  /* L'adresse de contact est écrite ici et à un second endroit — le formulaire
     de résiliation. Deux occurrences, aucune constante : c'est peu, mais si un
     troisième point d'écriture apparaît, il faudra une variable plutôt qu'une
     recherche-remplacement de plus. */
  window.location.href = `mailto:Standix.app@gmail.com?subject=${sujet}&body=${corps}`
}
/* Les avatars de l'accueil ouvrent la MÊME fenêtre que la carte « Écrivez-nous »
   des réglages. Ils avaient chacun leur texte, plus court et différent : deux
   portes vers le même endroit doivent dire la même chose, sinon on croit
   arriver ailleurs. */
/* `e-avatar` a disparu avec la carte « Bonjour » de l'espace Équipe : la
   boucle le cherchait sans le trouver. Retiré plutôt que laissé — un nom qui
   ne désigne plus rien fait douter du reste de la liste. */
;['contact-gestion', 'contact-equipe', 'accueil-avatar'].forEach(id => {
  const el = document.getElementById(id)
  el?.addEventListener('click', ouvrirContact)
  el?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrirContact() } })
})

document.getElementById('logout-btn')?.addEventListener('click', () => signOut())

// ═══ ANALYSE GÉNÉRALE ═══
let currentGaData = null
let currentGaPeriod = 'week'

/* Place la pastille sous le segment actif. Les largeurs sont MESURÉES plutôt que
   devinées : « Cette semaine » et « Total » n'occupent pas la même place, et une
   pastille de largeur fixe glisserait à côté de sa cible.

   `immediat` sert à la première pose : quand l'écran s'affiche, la pastille doit
   être déjà en place, pas la rejoindre en glissant depuis la gauche. */
function placerPastille(conteneur, immediat) {
  if (!conteneur) return
  const actif = conteneur.querySelector('button.active')
  if (!actif) return

  const poser = () => {
    const bande = conteneur.getBoundingClientRect()
    const bouton = actif.getBoundingClientRect()
    if (!bouton.width) return          // écran encore masqué : rien à mesurer
    conteneur.style.setProperty('--largeur', bouton.width + 'px')
    conteneur.style.setProperty('--depart', (bouton.left - bande.left - 3) + 'px')
  }

  if (immediat) {
    conteneur.classList.add('sans-glisse')
    poser()
    // On rend le glissement au tour suivant, sinon la pose initiale s'anime.
    requestAnimationFrame(() => requestAnimationFrame(() => conteneur.classList.remove('sans-glisse')))
  } else {
    poser()
  }
}

/* ═══ `reposerPastilles` NE FAIT PLUS RIEN ═══

   Elle repositionnait la bille de fond d'une seule barre : `pm-tri`, le tri de
   « Gérer l'équipe », remplacé par un menu déroulant. L'élément n'existe plus,
   l'appel ne faisait qu'échouer silencieusement.

   La fonction est CONSERVÉE, vide : elle est appelée à chaque affichage
   d'écran et au redimensionnement, à deux endroits éloignés. La retirer
   demanderait de toucher à ces appels, pour un gain nul.

   `placerPastille` reste employée par la barre d'onglets, via
   `placerPastilleSansAnimation`. */
function reposerPastilles() {}
window.addEventListener('resize', () => reposerPastilles())

window.setGaPeriod = function(period) {
  currentGaPeriod = period
  renderGaStats()
}

/* ═══════════════════════════════════════════════════════════════════════════
   L'ANALYSE

   Le taux d'abord, en grand : c'est la réponse à la question qu'on se pose en
   ouvrant la page. Puis ce qu'il manque, en une phrase. Puis l'équipe, les
   dossiers, et ce qu'il reste à traiter.

   Les anneaux ont disparu : trois cercles côte à côte demandaient d'être
   interprétés, là où un seul chiffre répond.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Un temps lisible : « 38 min », « 2 h 40 ». Les secondes n'intéressent
   personne au-delà de la minute. */
function dureeLisible(secondes) {
  const s = Math.max(0, Math.round(secondes || 0))
  if (s < 60) return s + ' s'

  /* On arrondit à la minute, puis on décide du passage aux heures. 59 min 59
     s'affiche donc « 1 h » : c'est voulu, personne ne dit « 60 minutes ». */
  const min = Math.round(s / 60)
  if (min < 60) return min + ' min'

  const h = Math.floor(min / 60), reste = min % 60
  return reste ? `${h} h ${String(reste).padStart(2, '0')}` : `${h} h`
}

function debutPeriode(periode) {
  const now = new Date()
  if (periode === 'week') {
    const d = new Date(now)
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    d.setHours(0, 0, 0, 0)
    return d
  }
  if (periode === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
  return null
}

/* ═══════════════════════════════════════════════════════════════════════════
   LA COURBE D'ÉVOLUTION

   Douze mois de temps de lecture, une ligne, deux chiffres dessous.

   ─── POURQUOI UN SVG ÉCRIT À LA MAIN ───

   Pas de bibliothèque. Une courbe de douze points, c'est une chaîne de
   caractères ; charger cent kilooctets pour la tracer serait payer le
   chargement de chaque page pour un seul bloc.

   ─── L'ÉCHELLE PART DE ZÉRO ───

   Un graphique qui commence à sa valeur minimale exagère tout : trois minutes
   d'écart deviennent une falaise. La base est donc zéro, et le sommet est le
   plus haut mois — la pente qu'on voit est la vraie.

   ─── LES MOIS VIDES SONT DES ZÉROS, PAS DES TROUS ───

   Un mois sans lecture vaut zéro et la ligne y descend. L'omettre relierait
   deux mois éloignés par une droite, en donnant à croire à une continuité qui
   n'a pas eu lieu.
   ═══════════════════════════════════════════════════════════════════════════ */
/* ⚠ DEUX PAGES SONT DEVENUES ORPHELINES.

   `p-an-categories` et `p-an-temps` — le détail par dossier et par procédure —
   n'étaient atteignables que par les blocs qu'on vient de retirer. Elles
   existent encore, avec leur anneau et leur classement, mais plus aucun bouton
   n'y mène.

   Je les laisse en place plutôt que de les supprimer : elles fonctionnent, et
   si tu veux un jour rouvrir ce détail, il suffira d'un bouton. Les effacer
   maintenant demanderait de retirer aussi leurs fonctions de rendu, leurs
   anneaux et leur balisage — quelques centaines de lignes qu'il faudrait
   réécrire en cas de retour en arrière.

   Elles ne coûtent rien tant qu'on ne les ouvre pas : leur code ne s'exécute
   qu'à l'affichage. */
const COURBE_MOIS = 12

/* La période affichée. Trois échelles, un seul réglage. */
let courbePeriode = 'annee'      // 'mois' · 'annee' · 'tout'

/* ═══ LE DÉBUT DE L'HISTOIRE, PAS LE DÉBUT DU CALENDRIER ═══

   La courbe démarre au jour où l'entreprise a été créée. Avant, il n'y avait
   rien — ni équipe, ni procédure — et afficher ces mois vides donnerait à
   croire à un échec là où il n'y avait personne.

   J'avais d'abord pris l'arrivée du DEUXIÈME membre, en me disant qu'une
   entreprise seule ne lit pas ses propres procédures. C'était un raisonnement
   de ma part, pas une demande : le gérant veut voir son histoire depuis le
   début, y compris les semaines où il était seul à préparer.

   Sans date connue, on se rabat sur douze mois. */
function debutEntreprise() {
  const d = cachedEntreprise?.created_at
  if (!d) return null
  const t = new Date(d)
  return isNaN(t) ? null : new Date(t.getFullYear(), t.getMonth(), 1)
}

/* Les cases de la courbe, selon la période. Chacune porte son libellé d'axe. */
function casesCourbe(validations, membres) {
  const now = new Date()
  const cases = []

  if (courbePeriode === 'mois') {
    /* Jour par jour sur le mois courant. Un mois de trente points est lisible ;
       c'est la seule échelle où le détail quotidien a un sens. */
    /* Sur le mois courant, la création n'est un repère que si l'entreprise est
       née CE mois-ci. Sinon on part du 1er, comme d'habitude. */
    const neCeMois = cachedEntreprise?.created_at ? new Date(cachedEntreprise.created_at) : null
    const premierJour = (neCeMois && neCeMois.getFullYear() === now.getFullYear()
      && neCeMois.getMonth() === now.getMonth()) ? neCeMois.getDate() : 1
    const fin = now.getDate()
    for (let j = premierJour; j <= fin; j++) {
      const deb = new Date(now.getFullYear(), now.getMonth(), j)
      /* ═══ LE JOUR SEUL NE DIT RIEN ═══

         Les repères affichaient « 1 · 13 · 25 ». Trois nombres nus, sans mois :
         on ne sait pas de quelle période il s'agit, et « 1 » pourrait aussi bien
         être une valeur qu'une date.

         Le mois est ajouté à chacun — « 1 août · 13 août · 25 août ». Trois
         mots de plus, et la ligne devient lisible sans effort. */
      cases.push({ deb, fin: new Date(now.getFullYear(), now.getMonth(), j + 1), total: 0,
                   nom: `${j} ${deb.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')}` })
    }
  } else if (courbePeriode === 'annee') {
    /* Les douze mois de l'année en cours, de janvier à aujourd'hui. */
    /* ═══ PAS AVANT LA CRÉATION DE L'ENTREPRISE ═══

       « Cette année » partait de janvier, même pour une entreprise créée en
       mai : cinq mois plats à zéro avant que l'histoire commence.

       Le départ est donc le plus tardif des deux — janvier, ou le mois de
       création. Une entreprise née en 2025 garde bien janvier ; une née en mai
       2026 démarre en mai. */
    const ne = debutEntreprise()
    const premier = (ne && ne.getFullYear() === now.getFullYear()) ? ne.getMonth() : 0
    for (let m = premier; m <= now.getMonth(); m++) {
      const deb = new Date(now.getFullYear(), m, 1)
      /* Une seule année affichée : le mois suffit, l'année serait répétée
         douze fois pour rien. */
      cases.push({ deb, fin: new Date(now.getFullYear(), m + 1, 1), total: 0,
                   nom: deb.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '') })
    }
  } else {
    /* Depuis l'arrivée du deuxième membre, mois par mois. Plafonné à vingt-quatre
       points : au-delà, deux ans sur 320 px donnent une ligne illisible. */
    let deb = debutEntreprise() || new Date(now.getFullYear(), now.getMonth() - COURBE_MOIS + 1, 1)
    const limite = new Date(now.getFullYear(), now.getMonth() - 23, 1)
    if (deb < limite) deb = limite
    const c = new Date(deb)
    while (c <= now) {
      /* « Au total » peut traverser deux années : le mois seul ferait revenir
         « janv » deux fois sans qu'on sache lequel est lequel. L'année s'ajoute
         en deux chiffres, pour ne pas allonger la ligne. */
      cases.push({ deb: new Date(c), fin: new Date(c.getFullYear(), c.getMonth() + 1, 1), total: 0,
                   nom: c.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
                         .replace('.', '') })
      c.setMonth(c.getMonth() + 1)
    }
  }

  for (const v of validations || []) {
    const s = Number(v.duree_lecture || 0)
    if (!s) continue
    const t = new Date(v.validated_at)
    const c = cases.find(x => t >= x.deb && t < x.fin)
    if (c) c.total += s
  }
  return cases
}

/* ═══ LES GRADUATIONS DE L'AXE ═══

   Trois seulement — zéro, la moitié, le sommet. Quatre ou cinq encombreraient
   une courbe de 108 px de haut, et personne ne lit une valeur intermédiaire sur
   un graphique de cette taille : on veut l'ordre de grandeur.

   L'arrondi porte sur une valeur ronde au-dessus du sommet — 47 min devient
   1 h, 12 min devient 15. Un axe qui s'arrête à 47 se lit moins vite qu'un axe
   qui s'arrête à un nombre qu'on a en tête. */
function sommetRond(secondes) {
  if (secondes <= 0) return 60
  const paliers = [60, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 57600, 86400]
  return paliers.find(p => p >= secondes) || Math.ceil(secondes / 3600) * 3600
}

function renderCourbe(validations, membres) {
  const el = document.getElementById('ga-courbe')
  if (!el) return
  el.innerHTML = ''

  const cases = casesCourbe(validations, membres)
  const brut = Math.max(...cases.map(c => c.total), 0)

  /* Le filtre vit désormais dans le balisage, sur la ligne du titre. On se
     contente d'y refléter le choix courant. */
  const lbl = document.getElementById('dd-courbe-label')
  if (lbl) {
    lbl.textContent = courbePeriode === 'mois' ? 'Ce mois-ci'
      : courbePeriode === 'annee' ? 'Cette année' : 'Au total'
  }
  document.querySelectorAll('#dd-courbe-menu .dd-opt').forEach(o => {
    o.classList.toggle('actif', o.dataset.courbe === courbePeriode)
  })

  if (!brut || cases.length < 2) {
    el.innerHTML = vide({
      dessin: NEANT_PROCEDURE,
      titre: 'Rien de lu sur cette période',
      phrase: 'Dès que votre équipe ouvrira des procédures, vous verrez ici comment le temps de lecture évolue.',
    })
    return
  }

  const sommet = sommetRond(brut)
  const L = 320, H = 108, marge = 6
  const pas = (L - marge * 2) / (cases.length - 1)
  const y = (v) => H - marge - (v / sommet) * (H - marge * 2)
  const pts = cases.map((c, i) => [marge + i * pas, y(c.total)])

  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]
    const mx = (x0 + x1) / 2
    d += ` C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`
  }
  const aire = `${d} L ${pts[pts.length - 1][0]} ${H - marge} L ${pts[0][0]} ${H - marge} Z`

  const milieu = cases[Math.floor(cases.length / 2)]

  el.innerHTML = `
    <div class="cb-cadre">
      <div class="cb-axe">
        <span>${escapeHtml(dureeLisible(sommet))}</span>
        <span>${escapeHtml(dureeLisible(sommet / 2))}</span>
        <span>0</span>
      </div>
      <div class="cb-zone">
        <svg viewBox="0 0 ${L} ${H}" preserveAspectRatio="none" class="cb-svg">
          <defs>
            <linearGradient id="cbAire" x1="0" y1="0" x2="0" y2="1">
              <!-- L'aire sous la courbe part de l'ambre médian, pas de l'orange
                   sombre : sous un tracé qui va du clair au sombre, un fond
                   sombre écraserait la moitié gauche. -->
              <stop offset="0" stop-color="#FDA81E" stop-opacity="0.24"/>
              <stop offset="1" stop-color="#FDA81E" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <line x1="0" y1="${marge}" x2="${L}" y2="${marge}" class="cb-grille"/>
          <line x1="0" y1="${H / 2}" x2="${L}" y2="${H / 2}" class="cb-grille"/>
          <line x1="0" y1="${H - marge}" x2="${L}" y2="${H - marge}" class="cb-grille"/>
          <path d="${aire}" fill="url(#cbAire)"/>
          <path class="cb-ligne" d="${d}" fill="none" stroke="url(#cbTrait)"
                stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="3.4" fill="#FEC64A"/>
        </svg>
        <div class="cb-mois">
          <span>${escapeHtml(cases[0].nom)}</span>
          <span>${escapeHtml(milieu.nom)}</span>
          <span>${escapeHtml(cases[cases.length - 1].nom)}</span>
        </div>
      </div>
    </div>`

  const ligne = el.querySelector('.cb-ligne')
  if (ligne && !courbeDejaJouee) {
    courbeDejaJouee = true
    const len = ligne.getTotalLength()
    ligne.style.strokeDasharray = len
    ligne.style.strokeDashoffset = len
    requestAnimationFrame(() => {
      ligne.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(0.22,1,0.36,1)'
      ligne.style.strokeDashoffset = '0'
    })
  }
}

let courbeDejaJouee = false

function renderGaStats() {
  if (!currentGaData) return
  const { procedures, employes, validations } = currentGaData
  /* Les trois classements montrent TOUJOURS le mois en cours. Sur sept jours,
     une équipe de cinq affiche souvent zéro partout ; sur le total, les mois
     anciens écrasent le mois courant et plus rien ne bouge jamais. Le mois est
     la seule fenêtre où un classement dit quelque chose d'actuel.

     Les pages complètes gardent leur filtre : c'est là qu'on creuse. */
  const debut = new Date()
  debut.setDate(1); debut.setHours(0, 0, 0, 0)
  const dansPeriode = validations.filter(v => new Date(v.validated_at) >= debut)
  const libelle = 'ce mois-ci'

  const el = (i) => document.getElementById(i)

  const nbEmployes = (currentGaData?.employes || []).length
  /* La courbe prend TOUTES les validations, pas celles du mois : elle montre
     douze mois, elle a besoin des douze. */
  renderCourbe(validations, cachedMembres)
  renderMembresListe()
  renderGainTemps(validations, procedures)
}

/* Ce qu'il reste à faire. Chaque ligne est elle-même l'action : on la touche, on
   arrive là où l'on peut régler le problème. Un bouton unique « relancer
   l'équipe » ne disait ni qui relancer, ni pourquoi. */
/* ═══════════════════════════════════════════════════════════════════════════
   OÙ L'ÉQUIPE PASSE SON TEMPS

   Le classement des procédures par temps de lecture cumulé. C'est le troisième
   axe de la page : qui lit, dans quelle dossier, et sur quoi.

   Ce que ça révèle, et qui ne se voit nulle part ailleurs : une procédure qui
   prend beaucoup plus de temps que les autres est souvent mal écrite, pas plus
   importante. Le temps moyen par lecture le dit mieux que le total, on affiche
   donc les deux.

   Quand `duree_lecture` est vide — la colonne peut ne rien contenir sur les
   anciennes validations — on classe par nombre de lectures et on n'affiche
   aucune durée, plutôt qu'un zéro qui ferait croire à une mesure.
   ═══════════════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════════════════
   LE TEMPS PASSÉ SUR LES PROCÉDURES

   Le vrai temps, pas une estimation : la somme des secondes réellement passées
   sur les fiches. Le décompte tourne uniquement quand une procédure est
   ouverte, et se met en pause dès que l'app passe en arrière-plan.
   ═══════════════════════════════════════════════════════════════════════════ */
/* La carte du haut. Elle dit le mois, pas la semaine : sur sept jours, une
   équipe de cinq personnes affiche souvent zéro, et une carte qui affiche zéro
   ne convainc personne. Le mois donne un chiffre qui existe. */
function renderGainTemps(validations, procedures) {
  const carte = document.getElementById('an-gain')
  if (!carte) return
  carte.style.display = ''

  const debutMois = new Date()
  debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0)
  /* ═══ ON NE COMPTE QUE LES LECTURES DE MEMBRES EXISTANTS ═══

     La carte additionnait TOUTES les validations du mois, y compris celles de
     personnes ayant quitté l'entreprise depuis. Leurs lignes restent en base
     — c'est voulu, elles font foi le jour d'un contrôle — mais elles ne
     doivent plus entrer dans un total qu'on compare aux fiches.

     Résultat : la carte annonçait vingt minutes quand l'unique membre en avait
     quatorze. Le chiffre n'était pas faux, il répondait à une autre question. */
  const membresConnus = new Set(
    (currentGaData?.employes || []).concat(cachedMembres || []).map(m => m.id))
  const duMois = (validations || []).filter(v =>
    new Date(v.validated_at) >= debutMois && membresConnus.has(v.membre_id))

  const secondes = duMois.reduce((s, v) => s + Number(v.duree_lecture || 0), 0)
  const t = document.getElementById('an-gain-t')
  const s = document.getElementById('an-gain-s')

  if (!secondes) {
    t.innerHTML = '<em>Chaque lecture est une explication en moins</em>'
    s.innerHTML = 'D\u00e8s que votre \u00e9quipe ouvrira vos proc\u00e9dures, ' +
      "vous verrez ici <b>le temps que vous n'avez plus \u00e0 passer \u00e0 expliquer</b>."
    return
  }

  /* Le chiffre porté à part : c'est LUI qu'on vient chercher sur cette page,
     et une phrase entière le noie. */
  t.innerHTML = `<b>${escapeHtml(dureeLisible(secondes))}</b>` +
    `<em>de formation ce mois-ci</em>`
  /* « Sans que vous ayez eu à l'expliquer » sonnait comme un reproche déguisé —
     comme si expliquer à son équipe était une corvée dont on se débarrasse. On
     dit plutôt ce qui est vrai et vérifiable : ces lectures ont eu lieu, elles
     sont tracées, et ça compte le jour d'un contrôle. */
  /* « 1 personne a ouvert 5 procédures » recomptait ce que la page affiche
     déjà en dessous. On dit plutôt à QUOI ça sert : ce temps est du travail
     qu'on n'a pas eu à refaire, et il est prouvable. */
  /* La phrase « soit N minutes par personne » a été retirée : elle redécoupait
     le chiffre du titre sans rien apprendre. Il ne reste que ce qui compte —
     ces lectures sont tracées. */
  s.innerHTML = 'Chaque lecture est dat\u00e9e et nominative.'
}

/* ═══════════════════════════════════════════════════════════════════════════
   QUI PASSE LE PLUS DE TEMPS

   Les trois personnes qui ont passé le plus de temps sur les procédures, et le
   détail de ce temps procédure par procédure.

   La liste précédente classait les PROCÉDURES par durée. Celle-ci classe les
   PERSONNES — la même donnée, mais retournée du côté qui intéresse un
   responsable : il connaît ses procédures, il connaît moins ses gens.

   Le détail par procédure est ce qui rend la carte utile : « 42 min » ne dit
   rien, « 42 min dont 25 sur le Plan HACCP » dit que quelqu'un a buté dessus.
   ═══════════════════════════════════════════════════════════════════════════ */
/* Les procédures où l'équipe passe le plus de temps.

   Avant, cette section classait les PERSONNES. Mais un gérant qui regarde son
   analyse ne cherche pas qui lit le plus — il cherche ce qui occupe son équipe.
   Une procédure qui absorbe deux heures par mois est soit essentielle, soit mal
   écrite ; dans les deux cas c'est là qu'il faut regarder. */
function renderTempsLecture(procedures, dansPeriode, libelle, cible, tout) {
  const el = cible || document.getElementById('ga-late-list')
  if (!el) return
  /* ═══ ON VIDE ICI, PAS PLUS BAS ═══

     Le vidage se trouvait juste avant la boucle des lignes — donc APRÈS l'ajout
     de l'anneau, qu'il effaçait aussitôt. Le bloc restait vide : l'anneau était
     bien construit, bien ajouté, et supprimé dans la foulée.

     Rien ne le signalait, puisque aucune erreur n'est levée. Et le défaut ne
     touchait que ce bloc-ci : les deux autres vident en tête, comme il se doit.

     La règle : on vide au début d'une fonction de rendu, jamais au milieu. Ce
     qui est ajouté ensuite doit pouvoir l'être dans n'importe quel ordre. */
  el.innerHTML = ''

  const parProc = {}
  dansPeriode.forEach(v => {
    const s = Number(v.duree_lecture || 0)
    if (!s) return
    if (!parProc[v.procedure_id]) parProc[v.procedure_id] = { total: 0, lecteurs: new Set() }
    parProc[v.procedure_id].total += s
    parProc[v.procedure_id].lecteurs.add(v.membre_id)
  })

  const classement = Object.entries(parProc)
    .map(([id, d]) => ({ proc: procedures.find(x => x.id === id), ...d }))
    .filter(x => x.proc)
    .sort((a, b) => b.total - a.total)

  if (!classement.length) {
    el.innerHTML = vide({          // le conteneur est déjà vide, on peut écraser
      dessin: NEANT_PROCEDURE,
      titre: 'Rien de lu ce mois-ci',
      phrase: "D\u00e8s que quelqu'un ouvrira une proc\u00e9dure, vous verrez ici celles qui occupent le plus votre \u00e9quipe.",
    })
    return
  }

  /* ═══ LE MÊME ANNEAU QUE POUR LES DOSSIERS ═══

     Les trois blocs de cette page répartissent la même chose — du temps de
     lecture — selon trois axes : par dossier, par procédure, par personne. Un
     seul dessin pour les trois : on apprend à le lire une fois.

     Pas d'anneau sur la page complète : elle porte déjà le sien. */
  if (!tout) {
    const avecTemps = classement.filter(x => x.total)
    if (avecTemps.length) {
      const vus = regrouperParts(avecTemps, x => x.total)
      let t = 0
      /* ═══ « AUTRES » GARDE SON GRIS ═══

         `regrouperParts` a déjà posé `ANNEAU_GRIS` sur la part de
         regroupement — c'est ce qui la distingue d'un vrai dossier sur les
         pages de détail. Recolorer TOUTES les parts l'écrasait, et « 1 autre »
         recevait une teinte ambre comme s'il nommait quelque chose.

         On ne colore donc que les parts nommées, et le compteur ne s'incrémente
         que pour elles : sinon la dernière couleur ambre serait sautée. */
      vus.forEach(v => { if (!v.estAutres) v.couleur = FM_TEINTES[t++ % FM_TEINTES.length] })
      el.appendChild(anneauResume(vus, x => x.total,
        x => x.estAutres ? x.nom : (x.proc?.titre || 'Sans titre'),
        dureeLisible(avecTemps.reduce((a, x) => a + x.total, 0)),
        'de lecture ce mois-ci', true))
    }
  }

  /* ═══ SUR LE RÉSUMÉ, L'ANNEAU SUFFIT ═══

     Les lignes détaillées répétaient ce que la légende venait de nommer, avec
     les mêmes couleurs trois centimètres plus haut. Elles gardent leur place
     sur la page complète, où l'on vient chercher les chiffres.

     `tout` distingue les deux : faux sur le résumé, vrai derrière « Voir plus ». */
  const visibles = tout ? classement : []

  /* La même forme que la section Équipe : une ligne nue, le nom au-dessus de
     son sous-titre, la valeur à droite. Pas de cadre, pas de flèche — deux
     sections voisines qui présentent la même chose doivent se ressembler. */
  visibles.forEach((x, i) => {
    const n = x.lecteurs.size
    const div = document.createElement('div')
    div.className = 'emp-row'
    div.dataset.proc = x.proc.id
    div.innerHTML = `
      <div class="emp-row-name">${escapeHtml(x.proc.titre || 'Sans titre')}
        <span class="emp-row-sous">${(x.estAutres ? 'Les moins consult\u00e9es' : escapeHtml(x.proc?.categorie || 'Sans cat\u00e9gorie'))}${
          n ? ' \u00b7 ' + n + ' personne' + (n > 1 ? 's' : '') : ''}</span>
      </div>
      ${tempsTotalHtml(x.total, false, libelle)}`
    div.addEventListener('click', () => openAnalyse(x.proc.id))
    el.appendChild(div)
  })

  /* Le bouton s'affiche même avec trois entrées ou moins : la page complète ne
     se contente plus d'allonger la liste, elle porte l'anneau et le classement
     par période. Il y a donc toujours quelque chose de plus à y voir. */
  if (!tout) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'an-plus'
    b.textContent = 'Voir plus'
    b.addEventListener('click', () => ouvrirAnProcedures())
    el.appendChild(b)
  }
}




/* Trace un anneau de progression. Le trait est un cercle dont on ne dessine
   qu'une fraction, et les deux variables `--vide` et `--cible` servent à
   l'animation de remplissage définie en CSS. */
function dessinerAnneau(id, pct, couleur, texte, unite) {
  const el = document.getElementById(id)
  if (!el) return
  const taille = 58, ep = 6, r = (taille - ep) / 2
  const c = 2 * Math.PI * r
  const cible = c * (1 - Math.max(0, Math.min(100, pct)) / 100)
  el.innerHTML = `
    <svg width="${taille}" height="${taille}">
      <circle class="piste" cx="${taille / 2}" cy="${taille / 2}" r="${r}" fill="none" stroke-width="${ep}"/>
      <circle class="valeur" cx="${taille / 2}" cy="${taille / 2}" r="${r}" fill="none" stroke-width="${ep}"
              stroke="${couleur}" stroke-dasharray="${c}"
              style="--vide:${c}; --cible:${cible}; stroke-dashoffset:${cible}"/>
    </svg>
    <div class="dedans">${escapeHtml(texte)}${unite ? `<span class="unite">${escapeHtml(unite)}</span>` : ''}</div>`
}

/* Classement des dossiers par taux de consultation.
   Le taux d'une dossier = consultations réellement enregistrées, divisé par
   le nombre de consultations possibles, soit ses procédures x ses employés.
   On raisonne en pourcentage et non en volume brut, sinon une dossier de
   dix procédures écraserait systématiquement une dossier de deux. */
/* `cible` et `tout` permettent de réutiliser ce rendu sur la page entière :
   mêmes lignes, même grammaire, un seul endroit qui les dessine. */
/* Les dossiers où l'équipe passe le plus de temps.

   Avant, on classait par taux de consultation. Mais un taux élevé sur une
   dossier d'une seule procédure ne dit rien ; le temps, lui, se compare
   d'une dossier à l'autre quelle que soit leur taille. */
/* « Voir les 1 autres » ne se dit pas. Une seule formule, employée partout. */
function libelleVoirAutres(n) {
  return n === 1 ? "Voir l'autre" : `Voir les ${n} autres`
}

/* L'état vide d'une section. Une phrase grise centrée ne dit rien : elle ne fait
   que constater. Ici on montre le dessin de la section, on nomme ce qui manque
   et on donne le geste qui le résout.

   Trois sections vides d'affilée, c'est ce que voit quiconque crée sa deuxième
   entreprise — le pire moment pour paraître inachevé. */
function vide({ dessin, titre, phrase, action, geste }) {
  return `
    <div class="an-neant">
      <span class="d">${dessin}</span>
      <div class="t">${escapeHtml(titre)}</div>
      <div class="s">${escapeHtml(phrase)}</div>
      ${action ? `<button type="button" class="an-neant-btn" data-neant="${escapeHtml(geste)}">${escapeHtml(action)}</button>` : ''}
    </div>`
}

/* Les trois dessins, dans la palette des icônes de section : un plan derrière à
   16 %, le trait de devant à 42 %, le fond à 5 %. */
const NEANT_EQUIPE = `<svg viewBox="0 0 44 40" fill="none">
  <circle cx="31" cy="13" r="5" stroke="rgba(255,255,255,0.16)" stroke-width="2"/>
  <path d="M22 32a9 9 0 0 1 18 0" stroke="rgba(255,255,255,0.16)" stroke-width="2" stroke-linecap="round"/>
  <circle cx="16" cy="11" r="6.6" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.42)" stroke-width="2"/>
  <path d="M4 33a12 12 0 0 1 24 0" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.42)" stroke-width="2" stroke-linecap="round"/>
</svg>`

const NEANT_CATEGORIE = `<svg viewBox="0 0 44 40" fill="none">
  <path d="M11 9.5A2.6 2.6 0 0 1 13.6 7h5.6l2.6 3.2H35a2.6 2.6 0 0 1 2.6 2.6" stroke="rgba(255,255,255,0.16)" stroke-width="2" stroke-linejoin="round"/>
  <path d="M5 15.5A2.8 2.8 0 0 1 7.8 12.7h6l2.8 3.4H36a2.8 2.8 0 0 1 2.8 2.8v12.3A2.8 2.8 0 0 1 36 34H7.8A2.8 2.8 0 0 1 5 31.2Z" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.42)" stroke-width="2" stroke-linejoin="round"/>
</svg>`

const NEANT_PROCEDURE = `<svg viewBox="0 0 44 40" fill="none">
  <path d="M17 4h10l7.6 7.6V27a3 3 0 0 1-3 3h-1.4" stroke="rgba(255,255,255,0.16)" stroke-width="2" stroke-linejoin="round"/>
  <path d="M11 10.6h9.6l7.4 7.4V33a3 3 0 0 1-3 3H14a3 3 0 0 1-3-3Z" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.42)" stroke-width="2" stroke-linejoin="round"/>
  <path d="M20.6 10.6V18H28" stroke="rgba(255,255,255,0.42)" stroke-width="2" stroke-linejoin="round"/>
  <line x1="16" y1="24" x2="23" y2="24" stroke="rgba(255,255,255,0.42)" stroke-width="1.9" stroke-linecap="round"/>
  <line x1="16" y1="29" x2="20.5" y2="29" stroke="rgba(255,255,255,0.26)" stroke-width="1.9" stroke-linecap="round"/>
</svg>`

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-neant]')
  if (!b) return
  if (b.dataset.neant === 'inviter') showGestionScreen('p-reg-code')
  if (b.dataset.neant === 'creer') startNewProcedure()
})

/* ═══════════════════════════════════════════════════════════════════════════
   UN ANNEAU DE RÉSUMÉ, RÉUTILISABLE

   Écrit une fois pour les trois blocs de la page Analyse. Il prend une liste
   déjà regroupée et colorée, deux accesseurs — la valeur, le nom — et ce qu'il
   faut afficher au centre.

   ─── POURQUOI PAS `dessinerAnneauEq` ───

   Celle-là lit `anEqVues`, écrit dans un identifiant construit, et rebranche
   la légende cliquable de la page de détail. Elle est faite pour un écran
   précis. La détourner aurait demandé de lui passer un faux état, et le
   premier changement sur la page de détail aurait cassé celui-ci.

   On partage donc ce qui est PUR — `regrouperParts`, `fractionsLisibles`,
   `FM_TEINTES` — et on garde deux dessins séparés. La duplication est ici
   moins coûteuse que le couplage.

   ─── LA LÉGENDE EST COURTE PAR CONSTRUCTION ───

   `regrouperParts` a déjà fondu les petites parts dans « Autres ». On affiche
   donc tout ce qu'elle rend, sans troncature supplémentaire : une légende plus
   longue que l'anneau signifierait que le regroupement a mal fait son travail,
   et c'est là qu'il faudrait corriger, pas ici. */
/* ═══ LES ANNEAUX DU RÉSUMÉ NE S'ANIMENT PAS ═══

   Ils se remplissaient au premier affichage de la page. Trois anneaux qui
   s'ouvrent en même temps, c'est trois attentes simultanées pour trois chiffres
   qu'on vient juste consulter — et la page paraît lente alors qu'elle est
   instantanée.

   L'animation garde tout son sens UN CRAN PLUS BAS : quand on touche « Voir
   plus », on a demandé à regarder de près, et l'anneau qui se dessine
   accompagne l'arrivée sur la page. Elle y est déjà, dans `dessinerAnneauEq` et
   ses deux jumelles — je n'y touche pas.

   Le résumé, lui, apparaît complet. `anneauxDejaJoues` disparaît avec : il
   servait à ne jouer qu'une fois ce qui ne joue plus jamais. */

/* ═══ LA LÉGENDE PORTE LE RÉSUMÉ À ELLE SEULE ═══

   Elle nomme chaque part avec sa couleur : c'est tout ce qu'il faut pour lire
   l'anneau. Les lignes détaillées qui la suivaient — « Cuisine · 4 procédures ·
   2 personnes · 27 min » — répétaient les mêmes noms en plus long, juste sous
   les mêmes couleurs.

   Le détail a sa page, derrière « Voir plus ». Le résumé se contente de
   montrer la répartition ; on descend d'un cran quand on veut les chiffres. */
function anneauResume(parts, valeur, nomDe, centreTexte, centreUnite, legende) {
  const T = 168, ep = 14, r = (T - ep) / 2, circ = 2 * Math.PI * r
  const somme = parts.reduce((t, x) => t + valeur(x), 0)
  const bloc = document.createElement('div')
  bloc.className = 'an-resume'
  if (!parts.length || !somme) return bloc

  const ecart = Math.max(1.5, Math.min(5, (circ / 8) / Math.max(1, parts.length)))
  const fracs = fractionsLisibles(parts, valeur, circ, ecart + ep * 1.7)

  let pos = 0
  const arcs = parts.map((x, i) => {
    const brut = circ * fracs[i]
    /* Une part large reçoit des bouts arrondis ; une part fine n'en a pas la
       place — arrondie, elle deviendrait un point au lieu d'un arc. */
    const rond = brut > ecart + ep * 1.6
    const len = rond ? brut - ecart - ep : Math.max(1, brut - ecart)
    const depart = circ * pos + ecart / 2 + (rond ? ep / 2 : 0)
    pos += fracs[i]
    return `<circle class="arc${rond ? '' : ' droit'}" cx="${T / 2}" cy="${T / 2}" r="${r}"
      fill="none" stroke="${x.couleur}" stroke-width="${ep}"
      stroke-dasharray="${len} ${circ}" stroke-dashoffset="${-depart}"/>`
  }).join('')

  const masque = 'an-res-' + Math.random().toString(36).slice(2, 9)
  bloc.innerHTML = `
    <div class="an-resume-anneau">
      <svg width="${T}" height="${T}">
        <defs><mask id="${masque}">
          <circle class="an-resume-aiguille" cx="${T / 2}" cy="${T / 2}" r="${r}" fill="none"
                  stroke="#fff" stroke-width="${ep + 3}"
                  stroke-dasharray="${circ}" stroke-dashoffset="${circ}"/>
        </mask></defs>
        <g mask="url(#${masque})">${arcs}</g>
      </svg>
      <div class="an-resume-centre">
        <span class="v">${escapeHtml(centreTexte)}</span>
        <span class="u">${escapeHtml(centreUnite || '')}</span>
      </div>
    </div>
    ${legende ? `<div class="an-resume-leg">
      ${parts.map(x => `<span><i style="background:${x.couleur}"></i>${escapeHtml(nomDe(x))}</span>`).join('')}
    </div>` : ''}`

  /* Le masque est posé à découvert d'emblée, sans transition ni
     `requestAnimationFrame` : l'anneau est complet dès la première image, sans
     jamais passer par un état vide.

     Le masque reste dans le dessin plutôt que d'être supprimé — il ne coûte
     rien, et c'est lui qui rend l'animation possible si on la veut un jour
     ici. */
  const aiguille = bloc.querySelector('.an-resume-aiguille')
  if (aiguille) {
    aiguille.style.transition = 'none'
    aiguille.style.strokeDashoffset = '0'
  }
  return bloc
}

function renderTopCategories(procedures, validationsPeriode, nbEmployes, periodLabel, cible, tout) {
  const el = cible || document.getElementById('ga-top-categories')
  if (!el) return
  el.innerHTML = ''

  if (!procedures.length) {
    el.innerHTML = vide({
      dessin: NEANT_CATEGORIE,
      titre: 'Aucune cat\u00e9gorie',
      phrase: "Les cat\u00e9gories se cr\u00e9ent toutes seules \u00e0 mesure que vous ajoutez des proc\u00e9dures \u2014 Cuisine, Salle, Bar\u2026",
      action: 'Cr\u00e9er une proc\u00e9dure', geste: 'creer',
    })
    return
  }

  /* À quelle dossier appartient chaque procédure. */
  const catDe = {}
  procedures.forEach(p => { catDe[p.id] = p.categorie || 'Sans cat\u00e9gorie' })

  const parCat = {}
  procedures.forEach(p => {
    const nom = catDe[p.id]
    if (!parCat[nom]) parCat[nom] = { nom, total: 0, nbProcs: 0, lecteurs: new Set() }
    parCat[nom].nbProcs++
  })
  validationsPeriode.forEach(v => {
    const nom = catDe[v.procedure_id]
    if (!nom || !parCat[nom]) return
    parCat[nom].total += Number(v.duree_lecture || 0)
    parCat[nom].lecteurs.add(v.membre_id)
  })

  const classement = Object.values(parCat)
    .sort((a, b) => (b.total - a.total) || a.nom.localeCompare(b.nom, 'fr'))

  if (!classement.some(c => c.total)) {
    el.innerHTML = vide({
      dessin: NEANT_CATEGORIE,
      titre: 'Rien de lu ce mois-ci',
      phrase: "Vos cat\u00e9gories existent, mais personne ne les a encore ouvertes ce mois-ci.",
    })
    return
  }

  /* ═══ SUR LE RÉSUMÉ, L'ANNEAU SUFFIT ═══

     Les lignes détaillées répétaient ce que la légende venait de nommer, avec
     les mêmes couleurs trois centimètres plus haut. Elles gardent leur place
     sur la page complète, où l'on vient chercher les chiffres.

     `tout` distingue les deux : faux sur le résumé, vrai derrière « Voir plus ». */
  const visibles = tout ? classement : []

  /* ═══════════════════════════════════════════════════════════════════════
     L'ANNEAU AVANT LES LIGNES
     ═══════════════════════════════════════════════════════════════════════

     La page ne montrait que des listes : il fallait lire pour comprendre où
     part le temps. Un anneau se saisit en trois secondes — on voit qu'un
     dossier domine sans lire un mot, et les lignes en dessous répondent
     ensuite au « lequel exactement ».

     ─── ON RÉEMPLOIE, ON NE RÉÉCRIT PAS ───

     `regrouperParts`, `fractionsLisibles` et `FM_TEINTES` viennent des pages de
     détail, où cet anneau existe déjà. Le redessiner ici avec ses propres
     calculs aurait donné deux anneaux qui divergent à la première correction —
     et l'un des deux aurait fini par mentir.

     ─── PAS D'ANNEAU SUR LA PAGE COMPLÈTE ───

     `tout` vaut vrai sur la page de détail, qui porte DÉJÀ le sien. Deux
     anneaux l'un au-dessus de l'autre, montrant la même chose, n'apprendraient
     rien de plus. */
  if (!tout) {
    const avecTemps = classement.filter(c => c.total)
    if (avecTemps.length) {
      const vus = regrouperParts(avecTemps, c => c.total)
      let t = 0
      /* ═══ « AUTRES » GARDE SON GRIS ═══

         `regrouperParts` a déjà posé `ANNEAU_GRIS` sur la part de
         regroupement — c'est ce qui la distingue d'un vrai dossier sur les
         pages de détail. Recolorer TOUTES les parts l'écrasait, et « 1 autre »
         recevait une teinte ambre comme s'il nommait quelque chose.

         On ne colore donc que les parts nommées, et le compteur ne s'incrémente
         que pour elles : sinon la dernière couleur ambre serait sautée. */
      vus.forEach(v => { if (!v.estAutres) v.couleur = FM_TEINTES[t++ % FM_TEINTES.length] })
      el.appendChild(anneauResume(vus, c => c.total, c => c.nom,
        dureeLisible(avecTemps.reduce((x, c) => x + c.total, 0)),
        /* « lues » ne disait ni de quoi ni sur quelle période. Le centre porte
           une durée : il doit dire que c'est du temps de lecture, et quand. */
        'de lecture ce mois-ci', true))
    }
  }

  const lignes = document.createElement('div')
  lignes.innerHTML = visibles.map(c => {
    const n = c.lecteurs.size
    return `
      <button type="button" class="an-lig" data-cat="${escapeHtml(c.nom)}">
        <span class="co">
          <span class="nm">${escapeHtml(c.nom)}</span>
          <span class="st">${c.nbProcs} proc\u00e9dure${c.nbProcs > 1 ? 's' : ''}${
            n ? ' \u00b7 ' + n + ' personne' + (n > 1 ? 's' : '') : ''}</span>
        </span>
        ${tempsTotalHtml(c.total, false, periodLabel)}
      </button>`
  }).join('')
  while (lignes.firstChild) el.appendChild(lignes.firstChild)

  /* Le bouton s'affiche même avec trois entrées ou moins : la page complète ne
     se contente plus d'allonger la liste, elle porte l'anneau et le classement
     par période. Il y a donc toujours quelque chose de plus à y voir. */
  if (!tout) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'an-plus'
    b.textContent = 'Voir plus'
    b.addEventListener('click', () => ouvrirAnCategories())
    el.appendChild(b)
  }

  el.querySelectorAll('[data-cat]').forEach(x => {
    x.addEventListener('click', () => openCategory(x.dataset.cat))
  })
}

/* Relit les membres et les lectures, puis repeint si quelque chose a changé.
   Silencieuse : une erreur réseau laisse simplement les chiffres précédents. */
async function rafraichirAnalyse() {
  if (!currentMembre?.entreprise_id) return
  try {
    const procIds = (allGestionProcedures || []).map(p => p.id)
    if (!procIds.length) return

    const [{ data: membres }, { data: validations }] = await Promise.all([
      supabase.from('membres').select('*').eq('entreprise_id', currentMembre.entreprise_id),
      supabase.from('validations').select('*').in('procedure_id', procIds),
    ])
    if (!membres || !validations) return

    cachedMembres = membres
    cachedValidations = validations
    /* Le résumé de l'accueil dépend des membres : c'est ici qu'ils arrivent,
       c'est donc ici qu'on le repeint. Sans `await` — l'accueil n'attend pas
       après ce chargement, et les postes peuvent arriver une seconde plus
       tard sans que ça gêne. */
    peindreResumeEntreprise().catch(() => {})
    const employes = membres.filter(m => m.role === 'equipe')
    currentGaData = { procedures: allGestionProcedures, membres, employes, validations }

    /* On ne repeint que si l'écran d'analyse est encore à l'écran : l'appel est
       asynchrone, l'utilisateur a pu partir ailleurs entre-temps. */
    if (document.getElementById('p-global-analyse')?.classList.contains('active')) {
      renderGaStats()
    }
  } catch (e) {
    console.warn('Standix \u00b7 analyse non rafra\u00eechie :', e?.message || e)
  }
}

window.loadGlobalAnalyse = function() {
  /* On peint d'abord avec ce qui a été préchargé au démarrage : la page
     apparaît instantanément. */
  const procedures = allGestionProcedures
  const membres = cachedMembres
  const validations = cachedValidations

  const employes = membres.filter(m => m.role === 'equipe')
  currentGaData = { procedures, membres, employes, validations }
  currentGaPeriod = 'week'

  /* Le compte de la page. On compte les LECTEURS et les procédures LUES, pas
     les membres ni les procédures existantes : cette page ne parle que de ce
     qui a été lu, et annoncer « 8 procédures » quand une seule a été ouverte
     serait une promesse que le contenu dément aussitôt.

     Volontairement, pas de total de minutes ici : c'est la carte qui a été
     retirée de cette page, et la remettre sous une autre forme reviendrait à
     défaire ce choix. */
  /* Le compte « N personnes · N procédures lues » a quitté l'en-tête, et son
     calcul avec lui : plus rien ne le lisait. Deux ensembles construits à chaque
     rendu pour un texte qui n'existe plus, c'est du travail pour personne. */

  renderGaStats()

  /* ... PUIS on relit la base. Sans ça, la page montrait indéfiniment l'état du
     démarrage : quelqu'un qui lisait une procédure pendant que le gérant avait
     l'app ouverte n'apparaissait jamais, et le temps restait à zéro jusqu'au
     rechargement complet. C'est exactement ce qui se voyait à l'écran. */
  rafraichirAnalyse()

  /* Un vieux bloc remplissait AUSSI `ga-late-list` ici même : il s'exécutait
     après `renderTempsLecture` et écrasait son rendu par des cartes à pastille.
     C'est pour ça que la section Procédures gardait son ancienne présentation
     malgré mes changements. Retiré. */
}

/* Fait disparaître une carte en la repliant, puis rend la main. Les hauteurs
   sont mesurées avant de commencer : une animation ne peut pas partir de
   « la hauteur actuelle » si on ne la lui donne pas. */
function replierCarte(el) {
  return new Promise((resoudre) => {
    if (!el) { resoudre(); return }
    const st = getComputedStyle(el)
    el.style.setProperty('--h', el.offsetHeight + 'px')
    el.style.setProperty('--mb', st.marginBottom)
    el.classList.add('carte-part')
    let fini = false
    const finir = () => { if (fini) return; fini = true; resoudre() }
    el.addEventListener('animationend', finir, { once: true })
    setTimeout(finir, 300)   // filet, si l'animation ne démarre pas
  })
}

/* Retrouve la carte d'une procédure, où qu'elle soit affichée. */
function carteDeProcedure(procId) {
  return document.querySelector(`.proc-rich-card[data-key="${procId}"]`)
}

/* ══════════════════════════════════════════════════════════════════════════════
   MON ACTIVITÉ (espace équipe)

   Tout se calcule sur ce qui est déjà en mémoire : mes validations, avec leur
   date et le temps passé, et la liste des procédures. Aucune requête de plus.

   Une précaution sur le temps : il n'est connu que depuis que l'app le mesure.
   Les lectures antérieures n'ont pas de durée, et on le dit plutôt que
   d'afficher zéro comme si la personne n'avait rien lu.
   ══════════════════════════════════════════════════════════════════════════════ */





/* Dessine la médaille du palier courant. Le disque est un dégradé, ceint d'un
   liseré, avec les branches d'une couronne de laurier de part et d'autre. */
/* La médaille est réutilisée à trois tailles : dans la tuile d'activité, sur la
   ligne d'un membre et sur sa fiche. On produit donc du balisage plutôt que de
   viser un élément précis. Le dégradé porte un identifiant unique : plusieurs
   médailles coexistent sur un même écran. */
let compteurMedaille = 0

/* ═══════════════════════════════════════════════════════════════════════════
   LE TEMPS PASSÉ, À LA PLACE DE LA MÉDAILLE

   Les médailles récompensaient une série de jours consécutifs. Deux défauts,
   et le second est rédhibitoire.

   Une série de trente jours peut vouloir dire « il se forme sérieusement » ou
   « il rouvre la même fiche tous les jours parce qu'il ne retient rien ». La
   médaille ne fait pas la différence et récompense les deux pareil.

   Surtout, elle se joue : ouvrir l'app trente secondes par jour suffisait à
   décrocher le palier le plus haut sans rien apprendre. Une mesure qu'on peut
   satisfaire sans faire le travail finit toujours par être satisfaite sans le
   travail.

   Le temps total ne prétend pas juger. Il dit un fait, et le gérant décide
   lui-même s'il doit s'en inquiéter.
   ═══════════════════════════════════════════════════════════════════════════ */

function tempsTotalHtml(secondes, grand, libelle) {
  /* Le libellé se choisit : « au total » pour une personne, « ce mois-ci » pour
     une procédure filtrée sur la période. Écrire « au total » sous un chiffre
     qui ne l'est pas serait un mensonge discret, donc le pire. */
  const t = Number(secondes) || 0
  const mot = libelle || 'au total'
  return `<span class="temps-total${grand ? ' grand' : ''}">` +
    (t ? `<b>${dureeLisible(t)}</b><i>${escapeHtml(mot)}</i>`
       : `<b>\u2014</b><i>aucune lecture</i>`) +
  `</span>`
}







/* ═══ Liste des membres, triable ═══ */
/* ═══════════════════════════════════════════════════════════════════════════
   LA FICHE D'UN MEMBRE

   Chaque nom de l'onglet Analyse l'ouvre. Elle répond aux questions qu'un
   responsable se pose sur une personne : combien de temps elle passe dans
   l'app, sur quoi, ce qu'elle n'a pas lu, et depuis quels appareils.

   Tout vient de `duree_lecture` sur les validations — la colonne existe déjà.
   Quand elle est absente ou nulle, on n'invente pas de durée : on affiche les
   lectures sans le temps, plutôt qu'un chiffre faux.
   ═══════════════════════════════════════════════════════════════════════════ */

let ficheMembreId = null




window.ouvrirFicheMembre = function(membreId) {
  ficheMembreId = membreId
  showGestionScreen('p-membre')
  peindreFicheMembre()
}

/* Les couleurs des parts. Six teintes distinctes, reprises dans l'ordre au-delà.
   Elles ne signifient rien en soi — elles servent à relier une part à sa ligne,
   rien de plus. */
/* Une ÉCHELLE, pas une palette. Ces teintes ne signifient rien : elles servent
   à relier une part de l'anneau à sa ligne, et rien d'autre. Or l'ancienne
   suite mêlait de l'ambre, du vert et du bleu — et le vert dit « terminé »
   partout ailleurs dans l'app. Une dossier tombait en vert par le seul hasard
   de son rang, et paraissait aller mieux que sa voisine.

   Six ambres du plus clair au plus sombre : on les distingue par la clarté, ce
   qui reste lisible même pour un œil qui confond les teintes. */
/* ═══ AMBRE ET CUIVRE ═══

   La progression va toujours du clair au foncé — c'est ce qui rend l'anneau
   lisible d'un coup d'œil. Ce qui change, c'est l'AMPLEUR : elle part d'un
   crème presque blanc et descend jusqu'au brun cuivré, alors que l'ancienne
   restait dans un même ambre du début à la fin.

   Mesuré : l'écart perceptuel entre deux teintes voisines ne descend plus sous
   22, contre 14 avant — c'est là que la deuxième et la troisième se
   confondaient.

   Le cuivre plutôt que le rouge : le rouge dit « problème » ailleurs dans
   l'app — analyse échouée, accès refusé. Sur un anneau qui ne fait que
   répartir du temps de lecture, il enverrait un signal qui n'existe pas.

   Le gris d'« Autres » vit à part, dans `ANNEAU_GRIS`. */
/* ═══ TROIS TEINTES, ET LE GRIS ═══

   Il y en avait six. Les deux dernières — #7A3A22 et #4A2A1E — sont si sombres
   qu'elles se confondaient avec le fond de la carte : un arc marron foncé sur
   un fond presque noir ne se lit pas, il se devine.

   Trois couleurs plus le gris font quatre parts. C'est peu, et c'est le but :
   au-delà, on retourne à la légende à chaque arc pour savoir lequel est
   lequel. Ce qui déborde va dans le gris, où il est nommé « N autres » — et
   c'est plus honnête que de lui donner une couleur qu'on ne saura pas relire.

   ⚠ CE TABLEAU COMMANDE LE PLAFOND. `regrouperParts` lit sa longueur pour
     savoir combien de parts nommer ; en ajouter une quatrième suffit à élargir
     l'anneau, sans toucher à rien d'autre. */
/* ═══ LES TEINTES D'ORIGINE, REMISES ═══

   Je les avais changées en `#FEC64A · #FDA81E · #EB5201` lors de l'alignement
   général sur le logo. C'était une erreur : ces trois-là servent aux ICÔNES et
   aux TRAITS, où elles sont justes.

   Sur un anneau, l'écart de teinte entre `#FEC64A` et `#FDA81E` ne fait que
   quatre degrés — deux arcs voisins devenaient indiscernables, et le premier
   tirait au jaune.

   Les valeurs d'origine — 36°, 34°, 26° — sont plus espacées en luminosité
   qu'en teinte, ce qui se lit mieux sur un arc fin. Elles ne bougent plus. */
const FM_TEINTES = ['#FFDFA0', '#FFAE2E', '#E8760F']

/* Les deux périodes vivent en parallèle : chacune a son classement, son total
   et son état déplié. On les peint toutes les deux d'un coup — sinon le panneau
   voisin serait vide pendant le glissement, et c'est justement le moment où on
   le regarde. */
let fmVues = {
  month: { classe: [], total: 0, deplie: false },
  all:   { classe: [], total: 0, deplie: false },
}
let fmPeriode = 'month'   // la page visible

async function peindreFicheMembre() {
  if (!ficheMembreId || !currentGaData) return
  const { employes, procedures, validations } = currentGaData
  const m = (employes || []).concat(cachedMembres || []).find(x => x.id === ficheMembreId)
  if (!m) return

  const el = (i) => document.getElementById(i)
  el('fm-nom').textContent = m.nom || 'Sans nom'
  el('fm-poste').textContent = m.poste || ''

  const siennes = (validations || []).filter(v => v.membre_id === ficheMembreId)
  const debutMois = new Date()
  debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0)
  const duMois = siennes.filter(v => new Date(v.validated_at) >= debutMois)

  for (const [cle, lot] of [['month', duMois], ['all', siennes]]) {
    const vue = fmVues[cle]
    vue.total = lot.reduce((s, v) => s + Number(v.duree_lecture || 0), 0)

    /* Une entrée par procédure de l'entreprise, celles qui ont du temps d'abord.
       Les jamais ouvertes restent dans la liste — c'est là qu'on veut les voir —
       mais elles n'ont pas de part dans l'anneau. */
    vue.classe = (procedures || []).map(pr => {
      const dessus = lot.filter(v => v.procedure_id === pr.id)
      return {
        proc: pr,
        secondes: dessus.reduce((s, v) => s + Number(v.duree_lecture || 0), 0),
        fois: dessus.length,
      }
    }).sort((a, b) => b.secondes - a.secondes)

    let t = 0
    vue.classe.forEach(x => { if (x.secondes) x.couleur = FM_TEINTES[t++ % FM_TEINTES.length] })

    vue.deplie = false
    dessinerAnneauMembre(cle)
    peindreClassementMembre(cle)
  }

  majBarrePeriode()

  // ─── L'activité, commune aux deux pages ───

  const derniere = siennes.map(v => new Date(v.validated_at)).sort((a, b) => b - a)[0]
  el('fm-derniere').textContent = derniere ? ilYA(derniere) : 'jamais'
  el('fm-arrivee').textContent = m.created_at
    ? 'le ' + new Date(m.created_at).toLocaleDateString('fr-FR')
    : '\u2014'
}

/* L'anneau d'une période. Chaque part occupe une fraction du tour proportionnelle
   à son temps. Les bouts sont arrondis : une extrémité ronde déborde de la moitié
   de l'épaisseur à chaque bout, on retire donc `ep` à la longueur et on décale le
   départ d'une demi-épaisseur, sinon les parts se chevauchent. */
/* ═══════════════════════════════════════════════════════════════════════
   UN ANNEAU NE PORTE PAS CINQUANTE PARTS
   ═══════════════════════════════════════════════════════════════════════

   À cinquante procédures, chaque part fait deux pour cent : trois pixels de
   couleur. On ne distingue rien, la palette ne compte que huit teintes qui se
   répètent, et les petites parts perdent leurs bouts arrondis faute de place —
   d'où ces segments carrés au milieu des ronds.

   Le problème n'est pas le dessin : c'est qu'un anneau de cinquante parts ne
   dit RIEN. Personne ne lit ça.

   On garde donc les plus grosses, et on réunit le reste sous « Autres ». Sept
   parts se lisent, se distinguent, et gardent chacune leurs arrondis. Le détail
   complet reste dans la liste en dessous, où il est à sa place.
   ═══════════════════════════════════════════════════════════════════════ */

/* ═══ PAS DE CONSTANTE DE PLAFOND ═══

   Il y en avait une, `ANNEAU_PARTS_MAX`. Elle disait « cinq parts au plus, gris
   compris » — un nombre à tenir en accord avec la longueur de `FM_TEINTES`, et
   les deux avaient fini par diverger : cinq places pour six couleurs, puis
   quatre places pour trois couleurs.

   Le plafond est maintenant lu directement dans `FM_TEINTES` là où il sert, une
   seule fois. Un tableau de trois couleurs autorise trois parts nommées ; en
   ajouter une quatrième élargit l'anneau sans qu'aucun autre nombre ne bouge. */
const ANNEAU_GRIS = 'rgba(235,235,245,0.28)'

/* ═══ AUCUNE PART TROP PETITE POUR SES ARRONDIS ═══

   Même regroupées à sept, les parts peuvent rester minuscules : cinquante
   procédures d'égale importance donnent six parts de 2 % et un gros « autres ».
   Sous le seuil, on leur retirait leurs bouts ronds — d'où ces segments carrés
   au milieu des arrondis.

   On donne donc à chacune la longueur MINIMALE qui porte deux arrondis, et on
   reprend le manque sur les plus grosses, au prorata. L'anneau ment légèrement
   sur les proportions — mais un segment de trois pixels ne disait déjà rien de
   juste, et les chiffres exacts sont dans la liste en dessous.

   C'est ce que fait tout logiciel de graphique : on n'affiche pas une part
   qu'on ne peut pas voir. */
function fractionsLisibles(parts, valeur, circ, mini) {
  const somme = parts.reduce((t, x) => t + valeur(x), 0)
  if (!somme) return parts.map(() => 0)

  const brutes = parts.map(x => valeur(x) / somme)
  const fracMini = mini / circ
  /* Impossible de contenter tout le monde : on partage à égalité. */
  if (fracMini * parts.length >= 1) return parts.map(() => 1 / parts.length)

  const petites = brutes.map(f => f < fracMini)
  const manque = brutes.reduce((t, f, i) => t + (petites[i] ? fracMini - f : 0), 0)
  const grosses = brutes.reduce((t, f, i) => t + (petites[i] ? 0 : f), 0)
  if (!grosses) return parts.map(() => 1 / parts.length)

  return brutes.map((f, i) => petites[i] ? fracMini : f - manque * (f / grosses))
}

/* Sous ce seuil, une part ne se lit plus : elle occupe trois pixels et sa
   couleur ne se distingue pas de sa voisine. */
const ANNEAU_SEUIL = 0.03   // trois pour cent du tour

function regrouperParts(vus, valeur) {
  const somme = vus.reduce((t, x) => t + valeur(x), 0)
  if (!somme) return vus

  /* ═══ ON REGROUPE PAR PROPORTION, PAS PAR RANG ═══

     Compter les lignes ne dit rien : cinq procédures dont une minuscule, et
     cette dernière était gardée puis GROSSIE au minimum lisible — elle mentait
     sans raison, parce qu'elles étaient moins de sept.

     Le seuil s'adapte au vrai déséquilibre : ce qui pèse moins de trois pour
     cent part dans le gris, qu'il y ait cinq procédures ou cinquante. Le
     plafond de sept reste, pour le cas où vingt parts dépasseraient le seuil. */
  /* LE SEUIL S'ADAPTE. Fixe à trois pour cent, cinquante procédures d'égale
     importance passaient TOUTES en dessous : l'anneau devenait un disque gris.

     On ne descend donc jamais sous les plus grosses : le seuil est le plus
     petit des deux — trois pour cent, ou la moitié d'une part moyenne. Ainsi il
     y a toujours quelque chose à montrer. */
  const seuil = Math.min(ANNEAU_SEUIL, 0.5 / vus.length)
  const grosses = vus.filter(x => valeur(x) / somme >= seuil)
  const petites = vus.filter(x => valeur(x) / somme < seuil)

  /* ═══ LE PLAFOND PORTE SUR LES PARTS NOMMÉES ═══

     Il était comparé au nombre TOTAL de parts, gris compris. Avec quatre
     procédures et rien à regrouper, la fonction rendait donc quatre parts
     nommées — pour trois couleurs disponibles. La quatrième reprenait la
     première teinte, et deux arcs différents portaient le même ambre.

     Le vrai plafond est celui des couleurs : au-delà, il faut regrouper, qu'il
     y ait des petites parts ou non. */
  const NOMMEES_MAX = FM_TEINTES.length

  /* Rien à regrouper : on rend la liste telle quelle. */
  if (!petites.length && grosses.length <= NOMMEES_MAX) return vus

  const tri = [...grosses].sort((a, b) => valeur(b) - valeur(a))
  /* Une place est réservée à « autres » dès qu'il y aura quelque chose à y
     mettre — des petites écartées, ou des grosses en trop. */
  const gardees = tri.slice(0, NOMMEES_MAX)
  const reste = [...tri.slice(NOMMEES_MAX), ...petites]
  if (!reste.length) return gardees
  const total = reste.reduce((t, x) => t + valeur(x), 0)
  if (!total) return gardees

  /* « Autres » en gris, jamais en couleur : une teinte de plus laisserait croire
     à une dossier réelle. Le gris dit « ceci n'est pas une part, c'est ce qui
     reste ». */
  const modele = reste[0]
  const autres = { ...modele, couleur: ANNEAU_GRIS, estAutres: true, _reste: reste.length }
  if ('total' in modele) autres.total = total
  if ('secondes' in modele) autres.secondes = total
  /* Accordé : « 1 autres » se voit tout de suite et fait bâclé. Le cas se
     produit dès qu'une seule part tombe sous le seuil, ce qui est fréquent. */
  autres.nom = reste.length > 1 ? `${reste.length} autres` : '1 autre'
  autres.titre = autres.nom
  return [...gardees, autres]
}

function dessinerAnneauMembre(cle) {
  const zone = document.getElementById('fm-anneau-' + cle)
  if (!zone) return

  const T = 214, ep = 17, r = (T - ep) / 2, circ = 2 * Math.PI * r
  const ECART = 5
  /* `> 0` explicitement. `filter(x => x.secondes)` écartait déjà le zéro, mais
     pas une valeur d'une fraction de seconde — une procédure ouverte par erreur
     puis refermée comptait comme lue, et se retrouvait dans le gris. Une demi
     seconde n'est pas une lecture. */
  const vus = regrouperParts(
    fmVues[cle].classe.filter(x => x.secondes >= 1), x => x.secondes)
  const somme = vus.reduce((s, x) => s + x.secondes, 0)

  /* L'écart s'adapte au NOMBRE de parts. À vingt dossiers, cinq pixels chacune
     mangeraient un tiers du cercle et les couleurs se bousculeraient. L'ensemble
     ne dépasse jamais le huitième du tour ; chaque écart reste au-dessus de
     1,5 px — en dessous, deux couleurs paraissent se toucher. */
  const ecart = Math.max(1.5, Math.min(ECART, (circ / 8) / Math.max(1, vus.length)))

  let pos = 0
  /* La longueur minimale qui porte deux bouts ronds. */
  const fracs = fractionsLisibles(vus, x => x.secondes, circ, ecart + ep * 1.7)

  const arcs = vus.map((x, i) => {
    const frac = fracs[i]
    const brut = circ * frac          // la part, telle quelle

    /* LES BOUTS ARRONDIS DÉBORDENT.

       Un trait à bout rond dépasse d'une demi-épaisseur de chaque côté : il
       occupe toujours `longueur + épaisseur`. On retranchait donc l'épaisseur —
       correct, sauf pour les petites parts.

       Une part de 10 px demandait une longueur de 10 − 5 − 17 = −12. Le plancher
       la ramenait à 0,1, mais ses deux bouts ronds la faisaient QUAND MÊME
       occuper 17 px : elle mordait sur sa voisine.

       En dessous du seuil, on passe donc à un bout DROIT. La part est plus
       carrée, mais elle reste chez elle. */
    const rond = brut > ecart + ep * 1.6
    const len = rond ? brut - ecart - ep : Math.max(1, brut - ecart)
    const depart = circ * pos + ecart / 2 + (rond ? ep / 2 : 0)
    pos += frac
    return `<circle class="arc${rond ? '' : ' droit'}" data-arc="${i}" cx="${T/2}" cy="${T/2}" r="${r}" fill="none"
      stroke="${x.couleur}" stroke-width="${ep}"
      stroke-dasharray="${len} ${circ}" stroke-dashoffset="${-depart}"/>`
  }).join('')

  /* L'anneau se dévoile d'un seul tour : un masque en forme d'anneau, dessiné par
     une aiguille invisible qui fait le tour du cadran. Les parts sont déjà en
     place dessous — c'est le masque qui bouge. Son bout est DROIT : arrondi, sa
     demi-épaisseur débordait avant midi et laissait voir la dernière couleur. */
  const idMasque = 'fm-masque-' + cle + '-' + Date.now()
  zone.innerHTML = `
    <svg width="${T}" height="${T}">
      <defs>
        <mask id="${idMasque}">
          <circle class="fm-aiguille" cx="${T/2}" cy="${T/2}" r="${r}" fill="none"
                  stroke="#fff" stroke-width="${ep + 3}"
                  stroke-dasharray="${circ}" stroke-dashoffset="${circ}"/>
        </mask>
      </defs>
      <g mask="url(#${idMasque})">${arcs}</g>
    </svg>
    <div class="dedans">
      <span class="v"></span><span class="u"></span><span class="n"></span>
    </div>`

  centreAnneauMembre(cle, null)

  const aiguille = zone.querySelector('.fm-aiguille')
  if (aiguille) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { aiguille.style.strokeDashoffset = '0' })
    })
  }
}

/* Le centre : le total quand rien n'est choisi, la procédure seule sinon.
   Toujours en minutes — « 1,2 » demande une conversion pour être comparé au
   « 31 min » affiché juste en dessous ; « 72 » se compare tout seul. */
function centreAnneauMembre(cle, choix) {
  const zone = document.getElementById('fm-anneau-' + cle)
  if (!zone) return
  const v = zone.querySelector('.v'), u = zone.querySelector('.u'), n = zone.querySelector('.n')
  if (!v) return

  const vue = fmVues[cle]
  if (!choix) {
    const vus = vue.classe.filter(x => x.secondes).length
    v.textContent = String(Math.round(vue.total / 60))
    u.textContent = cle === 'all' ? 'minutes au total' : 'minutes ce mois-ci'
    /* « 2 sur 10 lues » et non « 2 procédures sur 10 » : le trou de l'anneau
       fait 120 px, et la phrase longue passait dessous. */
    n.textContent = `${vus} sur ${vue.classe.length} lues`
    return
  }

  v.textContent = choix.secondes ? String(Math.round(choix.secondes / 60)) : '0'
  u.textContent = choix.secondes ? 'minutes' : 'jamais ouverte'
  n.textContent = escapeHtml(choix.estAutres ? (choix.nom || 'Autres') : (choix.proc?.titre || 'Sans titre')) +
    (choix.fois ? ` \u00b7 ${choix.fois} fois` : '')
}

/* Fait glisser le bouton de son ancienne position à la nouvelle. On le pose
   d'abord là où il était, puis on le libère : le navigateur anime la différence. */
function glisserBouton(cle, ancienHaut) {
  const b = document.querySelector('#fm-top-' + cle + ' .fm-plus')
  if (!b || ancienHaut == null) return
  const ecart = ancienHaut - b.getBoundingClientRect().top
  if (!ecart) return
  b.style.transition = 'none'
  b.style.transform = `translateY(${ecart}px)`
  requestAnimationFrame(() => {
    b.classList.add('glisse')
    b.style.transform = 'translateY(0)'
  })
}

/* La barre de position et le mot sous elle. On écoute le défilement de la piste
   plutôt que la fin du geste : la barre suit le doigt au lieu d'attendre. */
function majBarrePeriode() {
  document.querySelectorAll('#fm-barre [data-va]').forEach(b => {
    b.classList.toggle('on', b.dataset.va === fmPeriode)
  })
  /* Le mot sous les points a disparu avec eux : les boutons portent leur
     libellé, le répéter en dessous n'apprenait plus rien. */
}

;(() => {
  const piste = document.getElementById('fm-piste')
  if (!piste) return

  piste.addEventListener('scroll', () => {
    const page = piste.scrollLeft > piste.clientWidth / 2 ? 'all' : 'month'
    if (page === fmPeriode) return
    fmPeriode = page
    majBarrePeriode()
    if (navigator.vibrate) navigator.vibrate(6)
  }, { passive: true })

  /* On peut aussi toucher un trait de la barre : tout le monde ne pense pas à
     glisser, et un repère qu'on voit sans pouvoir l'utiliser agace. */
  document.querySelectorAll('#fm-barre [data-va]').forEach(b => {
    b.addEventListener('click', () => {
      piste.scrollTo({ left: b.dataset.va === 'all' ? piste.clientWidth : 0, behavior: 'smooth' })
    })
  })
})()

/* Le classement d'une période. Trois lignes, puis un bouton qui déplie le reste. */
function peindreClassementMembre(cle, animerDes) {
  const el = document.getElementById('fm-top-' + cle)
  if (!el) return

  const vue = fmVues[cle]
  if (!vue.classe.length) {
    el.innerHTML = '<div class="an-vide">Aucune proc\u00e9dure dans cette entreprise.</div>'
    return
  }

  const vus = vue.classe.filter(x => x.secondes)
  /* L'ANNEAU ET LA LISTE DOIVENT DIRE LA MÊME CHOSE.

     L'anneau regroupe les plus petites parts sous un gris « N autres », mais la
     liste n'en montrait que trois : on voyait une couleur au cercle sans jamais
     la retrouver en dessous. On ne pouvait pas savoir ce qu'elle valait.

     La liste montre donc autant de lignes que l'anneau a de parts. */
  /* La légende dit exactement ce que l'anneau montre : même calcul, mêmes
  parts, gris compris. Repliée elle suit l'anneau ; dépliée elle montre
  tout le détail. */
  const partsAnneau = regrouperParts(
    vue.classe.filter(x => (x.secondes || x.total || 0) > 0),
    x => x.secondes || x.total || 0)
  /* ═══ CE QUI EST GRIS RESTE GRIS UNE FOIS DÉPLIÉ ═══

     Repliée, la liste montrait « 3 autres » en gris. Dépliée, elle rendait à
     ces trois procédures leurs couleurs d'origine — trois teintes vives qui
     n'existaient nulle part dans l'anneau.

     On promet donc la couleur : ce qui a été réuni sous le gris le garde. Le
     dépliage révèle CE QUE contient la part grise, il ne redistribue pas les
     couleurs. */
  const grises = new Set()
  const partGrise = partsAnneau.find(x => x.estAutres)
  if (partGrise) {
    const montrees = new Set(partsAnneau.filter(x => !x.estAutres))
    vue.classe.forEach(x => { if (!montrees.has(x)) grises.add(x) })
  }
  const visibles = (vue.deplie ? vue.classe : partsAnneau).map(x =>
    grises.has(x) ? { ...x, couleur: ANNEAU_GRIS } : x)

  el.innerHTML = visibles.map((x, rang) => {
    const i = vus.indexOf(x)
    const neuve = animerDes != null && rang >= animerDes
    return `
      <button type="button" class="fm-lg${neuve ? ' neuve' : ''}"
              ${neuve ? `style="animation-delay:${(rang - animerDes) * 0.05}s"` : ''}
              data-part="${i}">
        <span class="pt" style="background:${x.couleur || 'rgba(255,255,255,0.14)'}"></span>
        <span class="co">
          <!-- La part grise ne désigne aucune procédure : elle en réunit plusieurs. -->
          <span class="nm">${x.estAutres ? escapeHtml(x.nom || 'Autres')
            : escapeHtml(x.proc?.titre || 'Sans titre')}</span>
          <span class="st">${(x.estAutres ? 'Les moins consult\u00e9es' : escapeHtml(x.proc?.categorie || 'Sans cat\u00e9gorie'))}${
            x.fois ? ' \u00b7 ' + x.fois + ' consultation' + (x.fois > 1 ? 's' : '') : ''}</span>
        </span>
        <span class="vl"${x.secondes ? '' : ' style="color:var(--label-3)"'}>${
          x.secondes ? dureeLisible(x.secondes) : 'jamais'}</span>
      </button>`
  }).join('')

  if (vue.classe.length > 3) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'fm-plus'
    b.textContent = vue.deplie ? 'Voir moins' : libelleVoirAutres(vue.classe.length - 3)
    b.addEventListener('click', () => {
      const avantBouton = b.getBoundingClientRect().top
      if (vue.deplie) {
        /* On replie : les lignes en trop s'effacent d'abord, on redessine après.
           Les faire disparaître d'un coup donnerait un à-coup. */
        const enTrop = [...el.querySelectorAll('.fm-lg')].slice(3)
        enTrop.forEach((l, k) => {
          l.style.animationDelay = ((enTrop.length - 1 - k) * 0.04) + 's'
          l.classList.add('part')
        })
        setTimeout(() => {
          vue.deplie = false
          peindreClassementMembre(cle)
          glisserBouton(cle, avantBouton)
        }, 240 + enTrop.length * 40)
        return
      }
      vue.deplie = true
      peindreClassementMembre(cle, 3)
      glisserBouton(cle, avantBouton)
    })
    el.appendChild(b)
  }

  el.querySelectorAll('[data-part]').forEach(b => {
    b.addEventListener('click', () => {
      const i = Number(b.dataset.part)
      const actif = b.classList.contains('choisi')
      el.querySelectorAll('[data-part]').forEach(x => x.classList.remove('choisi'))
      const arcs = document.querySelectorAll('#fm-anneau-' + cle + ' [data-arc]')

      /* Toucher à nouveau la même ligne ramène au total. Sans ça, il faudrait
         deviner où appuyer pour sortir de la sélection. */
      if (actif) {
        arcs.forEach(a => a.classList.remove('pale'))
        centreAnneauMembre(cle, null)
        return
      }
      b.classList.add('choisi')
      arcs.forEach((a, k) => a.classList.toggle('pale', k !== i))
      centreAnneauMembre(cle, i >= 0 ? vus[i] : vue.classe.find(x => !x.secondes &&
        x.proc?.titre === b.querySelector('.nm').textContent))
    })
  })
}




/* Un clic sur une procédure de la fiche ouvre cette procédure. */
document.getElementById('p-membre')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-proc]')
  if (b) openAnalyse(b.dataset.proc)
})

let triMembres = 'actifs'
let membresDeplies = false

function renderMembresListe() {
  const el = document.getElementById('ga-top-membres')
  if (!el || !currentGaData) return
  const { employes, procedures, validations } = currentGaData
  el.innerHTML = ''

  if (!employes.length) {
    el.innerHTML = vide({
      dessin: NEANT_EQUIPE,
      titre: 'Personne pour l\'instant',
      phrase: "Invitez votre \u00e9quipe avec le code de l'entreprise. C'est \u00e0 partir de l\u00e0 que vous saurez qui suit vos proc\u00e9dures.",
      action: 'Voir le code d\'invitation', geste: 'inviter',
    })
    return
  }

  /* Le mois en cours, comme les deux autres sections. Elles montraient trois
     fenêtres différentes de la même semaine : Équipe le total depuis toujours,
     Dossiers et Procédures le mois. Trois chiffres qui ne se comparent pas,
     empilés sur le même écran. */
  const debutMois = new Date()
  debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0)

  const stats = employes.map(m => {
    const siennes = (validations || []).filter(v => v.membre_id === m.id)
    const duMois = siennes.filter(v => new Date(v.validated_at) >= debutMois)
    const derniere = siennes.length
      ? Math.max(...siennes.map(v => new Date(v.validated_at).getTime()))
      : 0
    const total = duMois.reduce((s, v) => s + Number(v.duree_lecture || 0), 0)
    return { m, nb: duMois.length, derniere, total,
             arrivee: new Date(m.created_at || 0).getTime() }
  })

  const trie =
    triMembres === 'inactifs' ? stats.sort((a, b) => (a.nb - b.nb) || a.m.nom.localeCompare(b.m.nom, 'fr')) :
    triMembres === 'az'       ? stats.sort((a, b) => a.m.nom.localeCompare(b.m.nom, 'fr')) :
    triMembres === 'recents'  ? stats.sort((a, b) => b.arrivee - a.arrivee) :
                                stats.sort((a, b) => (b.nb - a.nb) || a.m.nom.localeCompare(b.m.nom, 'fr'))

  const total = procedures.length

  /* Trois lignes suffisent à répondre « qui suit ». Le reste se déplie : la page
     reste courte pour tout le monde, et complète pour qui veut vérifier. */
  /* Le troisième axe : par personne. Même anneau, même grammaire.

     Il ne s'affiche que replié — déplié, la page devient une liste complète et
     l'anneau n'y résume plus rien. */
  if (!membresDeplies) {
    const avecTemps = trie.filter(x => x.total)
    if (avecTemps.length) {
      const vus = regrouperParts(avecTemps, x => x.total)
      let t = 0
      /* ═══ « AUTRES » GARDE SON GRIS ═══

         `regrouperParts` a déjà posé `ANNEAU_GRIS` sur la part de
         regroupement — c'est ce qui la distingue d'un vrai dossier sur les
         pages de détail. Recolorer TOUTES les parts l'écrasait, et « 1 autre »
         recevait une teinte ambre comme s'il nommait quelque chose.

         On ne colore donc que les parts nommées, et le compteur ne s'incrémente
         que pour elles : sinon la dernière couleur ambre serait sautée. */
      vus.forEach(v => { if (!v.estAutres) v.couleur = FM_TEINTES[t++ % FM_TEINTES.length] })
      el.appendChild(anneauResume(vus, x => x.total,
        x => x.estAutres ? x.nom : (x.m?.nom || 'Sans nom'),
        dureeLisible(avecTemps.reduce((a, x) => a + x.total, 0)),
        'de lecture ce mois-ci', true))
    }
  }

  /* Même règle : replié, l'anneau et sa légende ; déplié, la liste entière. */
  const visibles = membresDeplies ? trie : []

  visibles.forEach((s, i) => {
    const div = document.createElement('div')
    div.className = 'emp-row'
    div.dataset.membre = s.m.id
    /* Le temps total, et non plus une série de jours : ce que la personne a
       réellement passé sur vos procédures. */
        div.innerHTML = `
      <div class="emp-row-name">${escapeHtml(s.m.nom || 'Sans nom')}
        <span class="emp-row-sous">${s.m.poste ? escapeHtml(s.m.poste) : 'Poste non d\u00e9fini'}</span>
      </div>
      ${tempsTotalHtml(s.total, false, 'ce mois-ci')}`
    el.appendChild(div)
  })

  /* ═══ LE BOUTON EST TOUJOURS LÀ ═══

     La condition était `trie.length > 3` : avec deux membres, il n'y avait
     rien de plus à voir qu'à l'écran, donc pas de bouton.

     Ce n'est plus vrai. Le résumé n'affiche PLUS les lignes — seulement
     l'anneau et sa légende. Sans bouton, la page complète devenait
     inatteignable dès qu'une entreprise avait trois membres ou moins : ni
     temps par personne, ni procédures lues, ni tri.

     Le libellé s'adapte : « Voir les 4 autres » n'a de sens que s'il en reste
     quatre à montrer. En dessous, il dit simplement le détail. */
  if (trie.length) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'an-plus'
    /* ═══ « VOIR PLUS », COMME LES DEUX AUTRES BLOCS ═══

       Le libellé alternait entre « Voir les N autres » et « Voir le détail »
       selon le nombre de membres. Les deux étaient faux depuis que le résumé
       n'affiche plus de lignes : il n'y a pas « N autres » à voir, il y a TOUT
       à voir — l'anneau ne montre que la répartition.

       Et les blocs Dossiers et Procédures disent déjà « Voir plus ». Trois
       boutons côte à côte qui mènent au même genre de page doivent porter le
       même mot. */
    b.textContent = 'Voir plus'
    b.addEventListener('click', () => ouvrirAnEquipe())
    el.appendChild(b)
  }

  /* Seules les nouveautés s'animent. */
  marquerLesNeufs(document.querySelector('.screen.active') || document.body,
                  'renderMembresListe', '.emp-row')
}

/* ═══════════════════════════════════════════════════════════════════════════
   LES TROIS PAGES ENTIÈRES

   Chaque section de l'analyse n'en montre que trois lignes. Ces pages montrent
   tout, avec le même dessin — mêmes lignes, même grammaire — pour qu'on ne se
   demande pas où l'on est arrivé.
   ═══════════════════════════════════════════════════════════════════════════ */

window.ouvrirAnEquipe = function() {
  showGestionScreen('p-an-equipe')
  peindreAnEquipe()
}

/* Le mot d'introduction de la page Équipe. Il ne décrit plus la page — on voit
   bien que c'est une liste — il dit ce que l'équipe a produit. Un gérant qui
   lit « 4 h 20 de formation » comprend en une seconde ce que son abonnement lui
   a rendu ; « touchez une personne » ne lui apprenait rien. */
function peindreIntroEquipe(employes, validations) {
  const t = document.getElementById('an-eq-titre')
  const s = document.getElementById('an-eq-sous')
  if (!t || !s) return

  /* ═══ LE DÉNOMINATEUR NE COMPTE QUE L'ÉQUIPE ═══

     La liste montre tout le monde, mais la MESURE ne porte que sur ceux qui
     ont à lire. Compter les gestionnaires ferait « 2 sur 5 » là où l'équipe
     est de quatre, et le manquant serait quelqu'un à qui l'on ne demande rien.

     `employes` est ici la liste complète — c'est `peindreAnEquipe` qui la
     passe. On refiltre donc sur le rôle, plutôt que de changer ce qu'elle
     envoie : la liste, elle, doit bien rester complète. */
  const aLire = (employes || []).filter(m => m.role !== 'gestion')
  const idsALire = new Set(aLire.map(m => m.id))
  const validALire = (validations || []).filter(v => idsALire.has(v.membre_id))

  const total = validALire.reduce((x, v) => x + Number(v.duree_lecture || 0), 0)
  const actifs = new Set(validALire.filter(v => Number(v.duree_lecture)).map(v => v.membre_id)).size
  /* `jamais` a été retiré : il servait aux trois variantes du sous-titre,
     remplacées par une phrase unique. Le compte de ceux qui n'ont rien lu se
     déduit du titre — « 3 sur 5 ». */

  if (!total) {
    t.textContent = 'Votre \u00e9quipe n\u2019a pas encore commenc\u00e9'
    s.innerHTML = "D\u00e8s la premi\u00e8re lecture, vous verrez ici <b>le temps de formation</b> " +
      "que vos proc\u00e9dures ont fait gagner \u00e0 votre \u00e9tablissement."
    return
  }

  /* « Sans vous » laissait entendre que l'équipe se forme MALGRÉ le responsable.
     Ce qu'il veut savoir, c'est où il en est de sa couverture : combien de gens
     sont à jour, et qui manque à l'appel. On nomme donc la personne quand il
     n'en reste qu'une — un nom est actionnable, un compte ne l'est pas. */
  /* ═══ « SE SONT FORMÉS » COMPTE MAINTENANT TOUT LE MONDE ═══

     La page montre désormais l'établissement entier, gestion comprise. Le
     dénominateur suit forcément : dire « 3 sur 5 » en n'ayant listé que
     l'équipe alors que huit noms s'affichent serait un chiffre qui contredit
     ce qu'on voit juste en dessous.

     Le mot « équipe » disparaît du titre au profit de « membres » : le
     fondateur ne se compte pas dans son équipe, mais il est bien un membre de
     son entreprise. */
  t.textContent = actifs > 1
    ? `${actifs} sur ${aLire.length} se sont form\u00e9s ce mois-ci`
    : `1 sur ${aLire.length} s'est form\u00e9 ce mois-ci`

  /* Le compte de ceux qui n'ont rien ouvert a été retiré : le titre le dit déjà
     — « 3 sur 5 », les deux autres se déduisent. Répéter le manque juste en
     dessous en faisait un reproche là où le chiffre suffisait. */
  /* ═══ UNE SEULE PHRASE, QUEL QUE SOIT LE NOMBRE ═══

     Il y en avait trois : « toute votre équipe est à jour », « il ne manque que
     Untel », « touchez un nom ». Trois formulations pour une seule information
     — comment se servir de la liste.

     Nommer le retardataire posait deux problèmes. Le premier est de ton : « il
     ne manque que Emilien Meifj » désigne quelqu'un du doigt sous le titre,
     alors que la liste le montre déjà, à sa place, sans commentaire. Le second
     est pratique : la phrase changeait de sens d'un mois à l'autre, et on
     relisait à chaque fois un texte qu'on croyait connaître.

     Le sous-titre dit maintenant à quoi sert la liste, et rien d'autre. Le
     chiffre du titre — « 3 sur 5 » — porte déjà l'information sur le manque. */
  s.innerHTML = `Touchez le nom d'un membre pour voir le <b>d\u00e9tail de son activit\u00e9</b>.`
}

let anEqVues = { month: { classe: [], total: 0, deplie: false },
                 all:   { classe: [], total: 0, deplie: false } }
let anEqPeriode = 'month'

function peindreAnEquipe() {
  if (!currentGaData) return
  const { membres, validations } = currentGaData

  /* ═══════════════════════════════════════════════════════════════════════
     TOUS LES MEMBRES, PAS SEULEMENT L'ÉQUIPE
     ═══════════════════════════════════════════════════════════════════════

     Cette page montrait `employes`, c'est-à-dire les seuls comptes de rôle
     `equipe`. Le fondateur et les gestionnaires en étaient absents — alors
     qu'ils lisent des procédures comme les autres, et qu'un responsable veut
     voir son établissement entier.

     ─── ON NE TOUCHE PAS À `cachedEmployes` ───

     Cette variable sert à sept endroits : le compte de places, les quotas,
     le résumé d'accueil. Y ajouter les gestionnaires changerait des chiffres
     de facturation pour un besoin d'affichage. On construit donc la liste
     ICI, depuis `membres`, et rien d'autre ne bouge.

     ─── L'ORDRE : PAR GROUPE, PUIS PAR TEMPS ───

     Trier tout le monde au temps mélangerait les deux rôles, et « séparé »
     n'aurait plus de sens. On trie donc d'abord par groupe — l'équipe en
     premier, c'est elle qu'on vient regarder — puis au temps à l'intérieur. */
  const tous = (membres || []).filter(m => m.role === 'equipe' || m.role === 'gestion')
  peindreIntroEquipe(tous, validations)

  const debutMois = new Date()
  debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0)
  const duMois = (validations || []).filter(v => new Date(v.validated_at) >= debutMois)

  for (const [cle, lot] of [['month', duMois], ['all', validations || []]]) {
    const vue = anEqVues[cle]
    vue.classe = tous.map(m => {
      const siennes = lot.filter(v => v.membre_id === m.id)
      return {
        membre: m, nom: m.nom || 'Sans nom',
        gestion: m.role === 'gestion',
        total: siennes.reduce((t, v) => t + Number(v.duree_lecture || 0), 0),
        lues: new Set(siennes.map(v => v.procedure_id)).size,
      }
    }).sort((a, b) => (a.gestion - b.gestion) || (b.total - a.total))

    /* ═══ LE TOTAL ET L'ANNEAU NE COMPTENT QUE L'ÉQUIPE ═══

       La ligne d'un gestionnaire n'affiche plus son temps ; l'inclure dans le
       total le ferait pourtant apparaître dans le chiffre du haut et dans une
       part de l'anneau. On lirait « 30 min » sans pouvoir retrouver d'où
       viennent les trois dernières.

       Une couleur ne lui est pas attribuée non plus : elle ne servirait qu'à
       une part qui n'existe pas. */
    vue.total = vue.classe.reduce((t, x) => t + (x.gestion ? 0 : x.total), 0)
    let n = 0
    vue.classe.forEach(x => { if (x.total && !x.gestion) x.couleur = FM_TEINTES[n++ % FM_TEINTES.length] })

    vue.deplie = false
    dessinerAnneauEq(cle)
    peindreClassementEq(cle)
  }
  majBarreEq()
}

function dessinerAnneauEq(cle) {
  const zone = document.getElementById('an-anneau-eq-' + cle)
  if (!zone) return

  const T = 214, ep = 17, r = (T - ep) / 2, circ = 2 * Math.PI * r
  const vue = anEqVues[cle]
  /* ═══ LA GESTION N'ENTRE PAS DANS L'ANNEAU ═══

     Quand j'ai retiré les gestionnaires de la mesure, j'ai exclu leur temps du
     TOTAL et de l'attribution des couleurs — mais pas de ce filtre. Un
     gestionnaire qui avait lu quelque chose entrait donc dans l'anneau SANS
     couleur : son arc se dessinait en gris, et on le prenait pour la part
     « Autres ».

     Le gris était juste au mauvais endroit. Trois exclusions étaient
     nécessaires, j'en avais fait deux — et la troisième ne se voit que sur une
     entreprise où un gestionnaire lit, ce qui n'arrive pas tous les jours.

     ⚠ Seul CET anneau est concerné. `dessinerAnneauCat` et `dessinerAnneauProc`
       partagent la même ligne, mais ils classent des dossiers et des
       procédures : `gestion` n'y existe pas. */
  const vus = regrouperParts(vue.classe.filter(x => x.total && !x.gestion), x => x.total)
  const somme = vus.reduce((t, x) => t + x.total, 0)

  if (!vus.length || !somme) {
    zone.innerHTML = ''
    zone.closest('.fm-segm')?.style.setProperty('display', 'none')
    return
  }
  zone.closest('.fm-segm')?.style.removeProperty('display')

  const ecart = Math.max(1.5, Math.min(5, (circ / 8) / Math.max(1, vus.length)))
  const fracs = fractionsLisibles(vus, x => x.total, circ, ecart + ep * 1.7)

  let pos = 0
  const arcs = vus.map((x, i) => {
    const brut = circ * fracs[i]
    const rond = brut > ecart + ep * 1.6
    const len = rond ? brut - ecart - ep : Math.max(1, brut - ecart)
    const depart = circ * pos + ecart / 2 + (rond ? ep / 2 : 0)
    pos += fracs[i]
    return `<circle class="arc${rond ? '' : ' droit'}" data-arc="${i}" cx="${T/2}" cy="${T/2}" r="${r}"
      fill="none" stroke="${x.couleur}" stroke-width="${ep}"
      stroke-dasharray="${len} ${circ}" stroke-dashoffset="${-depart}"/>`
  }).join('')

  const idMasque = 'an-eq-masque-' + cle + '-' + Date.now()
  zone.innerHTML = `
    <svg width="${T}" height="${T}">
      <defs><mask id="${idMasque}">
        <circle class="fm-aiguille" cx="${T/2}" cy="${T/2}" r="${r}" fill="none"
                stroke="#fff" stroke-width="${ep + 3}"
                stroke-dasharray="${circ}" stroke-dashoffset="${circ}"/>
      </mask></defs>
      <g mask="url(#${idMasque})">${arcs}</g>
    </svg>
    <div class="dedans"><span class="v"></span><span class="u"></span><span class="n"></span></div>`

  centreAnneauEq(cle, null)
  const aiguille = zone.querySelector('.fm-aiguille')
  if (aiguille) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { aiguille.style.strokeDashoffset = '0' })
    })
  }
}

function centreAnneauEq(cle, choix) {
  const zone = document.getElementById('an-anneau-eq-' + cle)
  if (!zone) return
  const v = zone.querySelector('.v'), u = zone.querySelector('.u'), n = zone.querySelector('.n')
  if (!v) return
  const vue = anEqVues[cle]
  if (!choix) {
    /* Le compte suit la même règle que l'anneau : sans les gestionnaires.
       Il disait « 3 sur 5 » pendant que le bandeau du dessus disait « 2 sur 3 »
       — deux chiffres contradictoires à trois centimètres d'écart. */
    const mesures = vue.classe.filter(x => !x.gestion)
    const actifs = mesures.filter(x => x.total).length
    v.textContent = String(Math.round(vue.total / 60))
    u.textContent = cle === 'all' ? 'minutes au total' : 'minutes ce mois-ci'
    n.textContent = `${actifs} sur ${mesures.length} personne${mesures.length > 1 ? 's' : ''}`
    return
  }
  v.textContent = String(Math.round(choix.total / 60))
  u.textContent = 'minutes'
  n.textContent = escapeHtml(choix.estAutres ? (choix.nom || 'Autres') : choix.nom)
}

function peindreClassementEq(cle, animerDes) {
  const el = document.getElementById('an-top-eq-' + cle)
  if (!el) return
  const vue = anEqVues[cle]

  if (!vue.classe.length) {
    el.innerHTML = vide({
      dessin: NEANT_EQUIPE,
      titre: 'Personne pour l\u2019instant',
      phrase: "Invitez votre \u00e9quipe avec le code de l'entreprise.",
      action: "Voir le code d'invitation", geste: 'inviter',
    })
    return
  }

  const partsAnneau = regrouperParts(vue.classe.filter(x => x.total > 0 && !x.gestion), x => x.total)
  const grises = new Set()
  if (partsAnneau.find(x => x.estAutres)) {
    const montrees = new Set(partsAnneau.filter(x => !x.estAutres))
    vue.classe.forEach(x => { if (!montrees.has(x)) grises.add(x) })
  }
  const visibles = (vue.deplie ? vue.classe : partsAnneau).map(x =>
    grises.has(x) ? { ...x, couleur: ANNEAU_GRIS } : x)

  /* ═══ LE TRAIT ENTRE LES DEUX GROUPES ═══

     Il n'apparaît QUE dans la liste dépliée. Repliée, l'anneau ne montre que
     les parts les plus grosses — un intertitre y séparerait un extrait, ce qui
     ne veut rien dire.

     `avantGroupe` repère le passage de l'équipe à la gestion : la liste étant
     triée par groupe, il n'y a qu'une frontière, et elle se trouve en comparant
     chaque ligne à la précédente. Si un seul des deux groupes est présent,
     aucune frontière n'est trouvée et rien ne s'affiche — ce qui est juste :
     il n'y a rien à séparer. */
  const avantGroupe = (x, i) => vue.deplie && i > 0 && x.gestion && !visibles[i - 1].gestion

  el.innerHTML = visibles.map((x, rang) => {
    const neuve = animerDes != null && rang >= animerDes
    return (avantGroupe(x, rang)
      ? `<div class="fm-groupe"><span>Espace Gestion</span></div>` : '') + `
      <button type="button" class="fm-lg${neuve ? ' neuve' : ''}"
              ${neuve ? `style="animation-delay:${(rang - animerDes) * 0.05}s"` : ''}
              data-part="${rang}" ${x.estAutres ? '' : `data-membre="${escapeHtml(x.membre.id)}"`}>
        <span class="pt" style="background:${x.couleur || 'rgba(255,255,255,0.14)'}"></span>
        <span class="co">
          <span class="nm">${escapeHtml(x.estAutres ? (x.nom || 'Autres') : x.nom)}</span>
          <!-- ═══ LA GESTION N'EST PAS MESURÉE ═══

               « 0 procédure lue » et « jamais » à côté d'un gestionnaire
               ressemblent à un reproche, alors qu'il n'y a rien à reprocher :
               il ÉCRIT les procédures, il n'a pas à les lire. Le suivi de
               lecture existe pour savoir si l'équipe est formée — pas pour
               noter celui qui forme.

               Sa ligne garde son nom et son rang. Elle est là parce qu'on a
               demandé à voir tous les membres, pas pour être comparée. -->
          <span class="st">${x.estAutres ? 'Les moins actifs'
            : x.gestion ? (x.membre.poste ? escapeHtml(x.membre.poste) : 'Gestion')
            : (x.membre.poste ? escapeHtml(x.membre.poste) + ' \u00b7 ' : '') +
              x.lues + ' proc\u00e9dure' + (x.lues > 1 ? 's' : '') + ' lue' + (x.lues > 1 ? 's' : '')}</span>
        </span>
        ${x.gestion ? '' : `<span class="vl"${x.total ? '' : ' style="color:var(--label-3)"'}>${
          x.total ? dureeLisible(x.total) : 'jamais'}</span>`}
      </button>`
  }).join('')

  if (vue.classe.length > 3) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'fm-plus'
    b.textContent = vue.deplie ? 'Voir moins' : 'Voir plus'
    b.addEventListener('click', () => {
      vue.deplie = !vue.deplie
      peindreClassementEq(cle, vue.deplie ? 3 : null)
    })
    el.appendChild(b)
  }

  /* ═══ UN SIMPLE TOUCHER OUVRE LA FICHE ═══

     Il fallait un appui de 550 ms. Personne ne devine qu'il faut maintenir —
     on touche, rien ne se passe, on recommence. Le profil était donc
     inatteignable en pratique.

     Le geste court ouvre maintenant la fiche : c'est ce qu'on attend d'une
     ligne qui porte un nom. Le dépliage du classement reste sur le bouton
     « Voir les autres », qui n'a pas de `data-membre`. */
  el.querySelectorAll('[data-part]').forEach(b => {
    b.addEventListener('click', () => {
      /* UNE LIGNE QUI PORTE UN NOM OUVRE SA FICHE. Les autres — « Autres »,
         les regroupements — n'ont pas de `data-membre` : elles gardent le
         comportement d'origine, qui éclaire la part dans l'anneau. */
      if (b.dataset.membre) { ouvrirFicheMembre(b.dataset.membre); return }

      const i = Number(b.dataset.part)
      const actif = b.classList.contains('choisi')
      el.querySelectorAll('[data-part]').forEach(x => x.classList.remove('choisi'))
      const arcs = document.querySelectorAll('#an-anneau-eq-' + cle + ' [data-arc]')
      if (actif) {
        arcs.forEach(a => a.classList.remove('pale'))
        centreAnneauEq(cle, null)
        return
      }
      b.classList.add('choisi')
      arcs.forEach((a, k) => a.classList.toggle('pale', k !== i))
      centreAnneauEq(cle, vue.classe[i])
    })
  })
}

function majBarreEq() {
  document.querySelectorAll('#an-barre-eq [data-va]').forEach(b => {
    b.classList.toggle('on', b.dataset.va === anEqPeriode)
  })
  /* Le mot sous les points est parti avec eux : les boutons de période
     portent leur libellé. */
}

;(() => {
  const piste = document.getElementById('an-piste-eq')
  if (!piste) return
  piste.addEventListener('scroll', () => {
    const page = piste.scrollLeft > piste.clientWidth / 2 ? 'all' : 'month'
    if (page === anEqPeriode) return
    anEqPeriode = page
    majBarreEq()
    if (navigator.vibrate) navigator.vibrate(6)
  }, { passive: true })
  document.querySelectorAll('#an-barre-eq [data-va]').forEach(b => {
    b.addEventListener('click', () => {
      piste.scrollTo({ left: b.dataset.va === 'all' ? piste.clientWidth : 0, behavior: 'smooth' })
    })
  })
})()

window.ouvrirAnCategories = function() {
  showGestionScreen('p-an-categories')
  peindreAnCategories()
}

/* Les trois pages partagent le même besoin : la période courante et son
   libellé. On le calcule une fois. */
function periodeCourante() {
  const debut = debutPeriode(currentGaPeriod)
  return {
    dansPeriode: debut
      ? currentGaData.validations.filter(v => new Date(v.validated_at) >= debut)
      : currentGaData.validations,
    libelle: currentGaPeriod === 'week' ? 'cette semaine'
      : currentGaPeriod === 'month' ? 'ce mois-ci' : 'au total',
  }
}





/* La page des dossiers, bâtie exactement comme celle des procédures : deux
   panneaux qu'on fait glisser, un anneau par période, le classement en dessous.
   Deux pages qui répondent à la même question doivent se lire pareil. */

let anCatVues = { month: { classe: [], total: 0, deplie: false },
                  all:   { classe: [], total: 0, deplie: false } }
let anCatPeriode = 'month'

function peindreAnCategories() {
  if (!currentGaData) return
  const { procedures, validations } = currentGaData

  const debutMois = new Date()
  debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0)
  const duMois = (validations || []).filter(v => new Date(v.validated_at) >= debutMois)

  for (const [cle, lot] of [['month', duMois], ['all', validations || []]]) {
    const vue = anCatVues[cle]
    const parCat = {}

    lot.forEach(v => {
      const s = Number(v.duree_lecture || 0)
      if (!s) return
      const pr = (procedures || []).find(x => x.id === v.procedure_id)
      if (!pr) return
      const nom = pr.categorie || 'Sans cat\u00e9gorie'
      if (!parCat[nom]) parCat[nom] = { nom, total: 0, lecteurs: new Set(), procs: new Set() }
      parCat[nom].total += s
      parCat[nom].lecteurs.add(v.membre_id)
      parCat[nom].procs.add(pr.id)
    })

    vue.classe = Object.values(parCat).sort((a, b) => b.total - a.total)
    vue.total = vue.classe.reduce((s, x) => s + x.total, 0)
    vue.classe.forEach((x, n) => { x.couleur = FM_TEINTES[n % FM_TEINTES.length] })

    vue.deplie = false
    dessinerAnneauCat(cle)
    peindreClassementCat(cle)
  }
  majBarreCat()
}

function dessinerAnneauCat(cle) {
  const zone = document.getElementById('an-anneau-cat-' + cle)
  if (!zone) return

  const T = 214, ep = 17, r = (T - ep) / 2, circ = 2 * Math.PI * r
  const ECART = 5
  const vue = anCatVues[cle]
  const vus = regrouperParts(vue.classe.filter(x => x.total), x => x.total)
  const somme = vus.reduce((s, x) => s + x.total, 0)

  if (!vus.length || !somme) {
    zone.innerHTML = ''
    zone.closest('.fm-segm')?.style.setProperty('display', 'none')
    return
  }
  zone.closest('.fm-segm')?.style.removeProperty('display')

  /* L'écart s'adapte au NOMBRE de parts. À vingt dossiers, cinq pixels chacune
     mangeraient un tiers du cercle et les couleurs se bousculeraient. L'ensemble
     ne dépasse jamais le huitième du tour ; chaque écart reste au-dessus de
     1,5 px — en dessous, deux couleurs paraissent se toucher. */
  const ecart = Math.max(1.5, Math.min(ECART, (circ / 8) / Math.max(1, vus.length)))

  let pos = 0
  /* La longueur minimale qui porte deux bouts ronds. */
  const fracs = fractionsLisibles(vus, x => x.total, circ, ecart + ep * 1.7)

  const arcs = vus.map((x, i) => {
    const frac = fracs[i]
    const brut = circ * frac

    /* Un trait à bout rond dépasse d'une demi-épaisseur de chaque côté : il
       occupe toujours `longueur + épaisseur`. Une part trop courte n'a pas la
       place de porter deux arrondis — elle mordrait sur sa voisine. On lui
       donne alors un bout DROIT : plus carré, mais chez elle. */
    const rond = brut > ecart + ep * 1.6
    const len = rond ? brut - ecart - ep : Math.max(1, brut - ecart)
    const depart = circ * pos + ecart / 2 + (rond ? ep / 2 : 0)
    pos += frac
    return `<circle class="arc${rond ? '' : ' droit'}" data-arc="${i}" cx="${T/2}" cy="${T/2}" r="${r}" fill="none"
      stroke="${x.couleur}" stroke-width="${ep}"
      stroke-dasharray="${len} ${circ}" stroke-dashoffset="${-depart}"/>`
  }).join('')

  const idMasque = 'an-cat-masque-' + cle + '-' + Date.now()
  zone.innerHTML = `
    <svg width="${T}" height="${T}">
      <defs>
        <mask id="${idMasque}">
          <circle class="fm-aiguille" cx="${T/2}" cy="${T/2}" r="${r}" fill="none"
                  stroke="#fff" stroke-width="${ep + 3}"
                  stroke-dasharray="${circ}" stroke-dashoffset="${circ}"/>
        </mask>
      </defs>
      <g mask="url(#${idMasque})">${arcs}</g>
    </svg>
    <div class="dedans">
      <span class="v"></span><span class="u"></span><span class="n"></span>
    </div>`

  centreAnneauCat(cle, null)

  const aiguille = zone.querySelector('.fm-aiguille')
  if (aiguille) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { aiguille.style.strokeDashoffset = '0' })
    })
  }
}

function centreAnneauCat(cle, choix) {
  const zone = document.getElementById('an-anneau-cat-' + cle)
  if (!zone) return
  const v = zone.querySelector('.v'), u = zone.querySelector('.u'), n = zone.querySelector('.n')
  if (!v) return

  const vue = anCatVues[cle]
  if (!choix) {
    v.textContent = String(Math.round(vue.total / 60))
    u.textContent = cle === 'all' ? 'minutes au total' : 'minutes ce mois-ci'
    n.textContent = `${vue.classe.length} cat\u00e9gorie${vue.classe.length > 1 ? 's' : ''}`
    return
  }
  v.textContent = String(Math.round(choix.total / 60))
  u.textContent = 'minutes'
  n.textContent = escapeHtml(choix.nom)
}

function peindreClassementCat(cle, animerDes) {
  const el = document.getElementById('an-top-cat-' + cle)
  if (!el) return

  const vue = anCatVues[cle]
  if (!vue.classe.length) {
    el.innerHTML = vide({
      dessin: NEANT_CATEGORIE,
      titre: cle === 'all' ? 'Aucune lecture pour l\u2019instant' : 'Aucune lecture ce mois-ci',
      phrase: "D\u00e8s que quelqu'un ouvrira une proc\u00e9dure, vous verrez ici o\u00f9 part le temps de votre \u00e9quipe.",
    })
    return
  }

  /* ═══ LA LÉGENDE DIT EXACTEMENT CE QUE L'ANNEAU MONTRE ═══

     L'anneau réunit les plus petites parts sous un gris « N autres ». La liste,
     elle, montrait les procédures une à une avec leurs propres couleurs : on
     voyait donc du gris au cercle sans jamais le retrouver en dessous, et des
     couleurs en dessous qui n'existaient pas au cercle.

     Les deux partent maintenant du MÊME calcul. Repliée, la liste montre les
     parts de l'anneau — gris compris. Dépliée, elle montre tout le détail, où
     chaque procédure retrouve son nom et son temps exact. */
  const partsAnneau = regrouperParts(
    vue.classe.filter(x => (x.total || x.secondes || 0) > 0),
    x => x.total || x.secondes || 0)
  /* ═══ CE QUI EST GRIS RESTE GRIS UNE FOIS DÉPLIÉ ═══

     Repliée, la liste montrait « 3 autres » en gris. Dépliée, elle rendait à
     ces trois procédures leurs couleurs d'origine — trois teintes vives qui
     n'existaient nulle part dans l'anneau.

     On promet donc la couleur : ce qui a été réuni sous le gris le garde. Le
     dépliage révèle CE QUE contient la part grise, il ne redistribue pas les
     couleurs. */
  const grises = new Set()
  const partGrise = partsAnneau.find(x => x.estAutres)
  if (partGrise) {
    const montrees = new Set(partsAnneau.filter(x => !x.estAutres))
    vue.classe.forEach(x => { if (!montrees.has(x)) grises.add(x) })
  }
  const visibles = (vue.deplie ? vue.classe : partsAnneau).map(x =>
    grises.has(x) ? { ...x, couleur: ANNEAU_GRIS } : x)

  el.innerHTML = visibles.map((x, rang) => {
    const nb = x.procs.size, gens = x.lecteurs.size
    const neuve = animerDes != null && rang >= animerDes
    return `
      <button type="button" class="fm-lg${neuve ? ' neuve' : ''}"
              ${neuve ? `style="animation-delay:${(rang - animerDes) * 0.05}s"` : ''}
              data-part="${rang}" data-cat-nom="${escapeHtml(x.nom)}">
        <span class="pt" style="background:${x.couleur}"></span>
        <span class="co">
          <span class="nm">${escapeHtml(x.nom)}</span>
          <span class="st">${nb} proc\u00e9dure${nb > 1 ? 's' : ''}${
            gens ? ' \u00b7 ' + gens + ' personne' + (gens > 1 ? 's' : '') : ''}</span>
        </span>
        <span class="vl">${dureeLisible(x.total)}</span>
      </button>`
  }).join('')

  if (vue.classe.length > 3) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'fm-plus'
    b.textContent = vue.deplie ? 'Voir moins' : 'Voir plus'
    b.addEventListener('click', () => {
      const avant = b.getBoundingClientRect().top
      if (vue.deplie) {
        const enTrop = [...el.querySelectorAll('.fm-lg')].slice(3)
        enTrop.forEach((l, k) => {
          l.style.animationDelay = ((enTrop.length - 1 - k) * 0.04) + 's'
          l.classList.add('part')
        })
        setTimeout(() => {
          vue.deplie = false
          peindreClassementCat(cle)
          glisserBoutonCat(cle, avant)
        }, 240 + enTrop.length * 40)
        return
      }
      vue.deplie = true
      peindreClassementCat(cle, 3)
      glisserBoutonCat(cle, avant)
    })
    el.appendChild(b)
  }

  /* Toucher éclaire la part ; un appui long ouvre la dossier. Le geste court
     sert à comparer, le long à aller voir — comme sur la page des procédures. */
  el.querySelectorAll('[data-part]').forEach(b => {
    let minuteur = null, ouverte = false

    b.addEventListener('pointerdown', () => {
      ouverte = false
      minuteur = setTimeout(() => { ouverte = true; openCategory(b.dataset.catNom) }, 550)
    })
    const annuler = () => { if (minuteur) { clearTimeout(minuteur); minuteur = null } }
    b.addEventListener('pointerup', annuler)
    b.addEventListener('pointerleave', annuler)
    b.addEventListener('pointercancel', annuler)

    b.addEventListener('click', () => {
      if (ouverte) return
      const i = Number(b.dataset.part)
      const actif = b.classList.contains('choisi')
      el.querySelectorAll('[data-part]').forEach(x => x.classList.remove('choisi'))
      const arcs = document.querySelectorAll('#an-anneau-cat-' + cle + ' [data-arc]')

      if (actif) {
        arcs.forEach(a => a.classList.remove('pale'))
        centreAnneauCat(cle, null)
        return
      }
      b.classList.add('choisi')
      arcs.forEach((a, k) => a.classList.toggle('pale', k !== i))
      centreAnneauCat(cle, vue.classe[i])
    })
  })
}

function glisserBoutonCat(cle, ancienHaut) {
  const b = document.querySelector('#an-top-cat-' + cle + ' .fm-plus')
  if (!b || ancienHaut == null) return
  const ecart = ancienHaut - b.getBoundingClientRect().top
  if (!ecart) return
  b.style.transition = 'none'
  b.style.transform = `translateY(${ecart}px)`
  requestAnimationFrame(() => {
    b.classList.add('glisse')
    b.style.transform = 'translateY(0)'
  })
}

function majBarreCat() {
  document.querySelectorAll('#an-barre-cat [data-va]').forEach(b => {
    b.classList.toggle('on', b.dataset.va === anCatPeriode)
  })
  /* Le mot sous les points est parti avec eux : les boutons de période
     portent leur libellé. */
}

;(() => {
  const piste = document.getElementById('an-piste-cat')
  if (!piste) return

  piste.addEventListener('scroll', () => {
    const page = piste.scrollLeft > piste.clientWidth / 2 ? 'all' : 'month'
    if (page === anCatPeriode) return
    anCatPeriode = page
    majBarreCat()
    if (navigator.vibrate) navigator.vibrate(6)
  }, { passive: true })

  document.querySelectorAll('#an-barre-cat [data-va]').forEach(b => {
    b.addEventListener('click', () => {
      piste.scrollTo({ left: b.dataset.va === 'all' ? piste.clientWidth : 0, behavior: 'smooth' })
    })
  })
})()


window.ouvrirAnTemps = function() {
  showGestionScreen('p-an-temps')
  peindreAnTemps()
}

/* ═══════════════════════════════════════════════════════════════════════════
   LA PAGE DES PROCÉDURES

   Même construction que la fiche d'un membre : deux panneaux qu'on fait glisser,
   un anneau segmenté par période, et le classement en dessous. Deux pages qui
   montrent la même chose — où part le temps — doivent se lire pareil.
   ═══════════════════════════════════════════════════════════════════════════ */

let anProcVues = { month: { classe: [], total: 0, deplie: false },
                   all:   { classe: [], total: 0, deplie: false } }
let anProcPeriode = 'month'

function peindreAnTemps() {
  if (!currentGaData) return
  const { procedures, validations } = currentGaData

  const debutMois = new Date()
  debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0)
  const duMois = (validations || []).filter(v => new Date(v.validated_at) >= debutMois)

  for (const [cle, lot] of [['month', duMois], ['all', validations || []]]) {
    const vue = anProcVues[cle]
    const parProc = {}
    lot.forEach(v => {
      const s = Number(v.duree_lecture || 0)
      if (!s) return
      if (!parProc[v.procedure_id]) parProc[v.procedure_id] = { total: 0, lecteurs: new Set() }
      parProc[v.procedure_id].total += s
      parProc[v.procedure_id].lecteurs.add(v.membre_id)
    })

    vue.classe = Object.entries(parProc)
      .map(([id, d]) => ({ proc: (procedures || []).find(x => x.id === id), ...d }))
      .filter(x => x.proc)
      .sort((a, b) => b.total - a.total)

    vue.total = vue.classe.reduce((s, x) => s + x.total, 0)
    vue.classe.forEach((x, k) => { x.couleur = FM_TEINTES[k % FM_TEINTES.length] })

    vue.deplie = false
    dessinerAnneauProc(cle)
    peindreClassementProc(cle)
  }
  majBarreProc()
}

/* L'anneau d'une période. Même géométrie que celui de la fiche membre : bouts
   arrondis, donc on retire `ep` à la longueur et on décale d'une demi-épaisseur,
   sinon les parts se chevauchent. */
function dessinerAnneauProc(cle) {
  const zone = document.getElementById('an-anneau-proc-' + cle)
  if (!zone) return

  const T = 214, ep = 17, r = (T - ep) / 2, circ = 2 * Math.PI * r
  const ECART = 5
  const vue = anProcVues[cle]
  const vus = regrouperParts(vue.classe.filter(x => x.total), x => x.total)
  const somme = vus.reduce((s, x) => s + x.total, 0)

  if (!vus.length || !somme) {
    zone.innerHTML = ''
    zone.closest('.fm-segm')?.style.setProperty('display', 'none')
    return
  }
  zone.closest('.fm-segm')?.style.removeProperty('display')

  /* L'écart s'adapte au NOMBRE de parts. À vingt dossiers, cinq pixels chacune
     mangeraient un tiers du cercle et les couleurs se bousculeraient. L'ensemble
     ne dépasse jamais le huitième du tour ; chaque écart reste au-dessus de
     1,5 px — en dessous, deux couleurs paraissent se toucher. */
  const ecart = Math.max(1.5, Math.min(ECART, (circ / 8) / Math.max(1, vus.length)))

  let pos = 0
  /* La longueur minimale qui porte deux bouts ronds. */
  const fracs = fractionsLisibles(vus, x => x.total, circ, ecart + ep * 1.7)

  const arcs = vus.map((x, i) => {
    const frac = fracs[i]
    const brut = circ * frac

    /* Un trait à bout rond dépasse d'une demi-épaisseur de chaque côté : il
       occupe toujours `longueur + épaisseur`. Une part trop courte n'a pas la
       place de porter deux arrondis — elle mordrait sur sa voisine. On lui
       donne alors un bout DROIT : plus carré, mais chez elle. */
    const rond = brut > ecart + ep * 1.6
    const len = rond ? brut - ecart - ep : Math.max(1, brut - ecart)
    const depart = circ * pos + ecart / 2 + (rond ? ep / 2 : 0)
    pos += frac
    return `<circle class="arc${rond ? '' : ' droit'}" data-arc="${i}" cx="${T/2}" cy="${T/2}" r="${r}" fill="none"
      stroke="${x.couleur}" stroke-width="${ep}"
      stroke-dasharray="${len} ${circ}" stroke-dashoffset="${-depart}"/>`
  }).join('')

  /* L'anneau se dévoile d'un seul tour : une aiguille invisible fait le tour du
     cadran et révèle les parts, déjà en place dessous. Son bout est DROIT —
     arrondi, sa demi-épaisseur déborderait avant midi et laisserait voir la
     dernière couleur. */
  const idMasque = 'an-proc-masque-' + cle + '-' + Date.now()
  zone.innerHTML = `
    <svg width="${T}" height="${T}">
      <defs>
        <mask id="${idMasque}">
          <circle class="fm-aiguille" cx="${T/2}" cy="${T/2}" r="${r}" fill="none"
                  stroke="#fff" stroke-width="${ep + 3}"
                  stroke-dasharray="${circ}" stroke-dashoffset="${circ}"/>
        </mask>
      </defs>
      <g mask="url(#${idMasque})">${arcs}</g>
    </svg>
    <div class="dedans">
      <span class="v"></span><span class="u"></span><span class="n"></span>
    </div>`

  centreAnneauProc(cle, null)

  const aiguille = zone.querySelector('.fm-aiguille')
  if (aiguille) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { aiguille.style.strokeDashoffset = '0' })
    })
  }
}

/* Toujours en minutes : « 1,2 » demande une conversion pour être comparé au
   « 31 min » affiché juste en dessous ; « 72 » se compare tout seul. */
function centreAnneauProc(cle, choix) {
  const zone = document.getElementById('an-anneau-proc-' + cle)
  if (!zone) return
  const v = zone.querySelector('.v'), u = zone.querySelector('.u'), n = zone.querySelector('.n')
  if (!v) return

  const vue = anProcVues[cle]
  if (!choix) {
    v.textContent = String(Math.round(vue.total / 60))
    u.textContent = cle === 'all' ? 'minutes au total' : 'minutes ce mois-ci'
    n.textContent = `${vue.classe.length} proc\u00e9dure${vue.classe.length > 1 ? 's' : ''}`
    return
  }
  v.textContent = String(Math.round(choix.total / 60))
  u.textContent = 'minutes'
  n.textContent = escapeHtml(choix.estAutres ? (choix.nom || 'Autres') : (choix.proc?.titre || 'Sans titre'))
}

/* Le classement. Trois lignes, puis un bouton qui déplie le reste — la forme
   exacte de la fiche d'un membre. */
function peindreClassementProc(cle, animerDes) {
  const el = document.getElementById('an-top-proc-' + cle)
  if (!el) return

  const vue = anProcVues[cle]
  if (!vue.classe.length) {
    el.innerHTML = vide({
      dessin: NEANT_PROCEDURE,
      titre: cle === 'all' ? 'Rien de lu pour l\u2019instant' : 'Rien de lu ce mois-ci',
      phrase: "D\u00e8s que quelqu'un ouvrira une proc\u00e9dure, vous verrez ici celles qui occupent le plus votre \u00e9quipe.",
    })
    return
  }

  /* ═══ LA LÉGENDE DIT EXACTEMENT CE QUE L'ANNEAU MONTRE ═══

     L'anneau réunit les plus petites parts sous un gris « N autres ». La liste,
     elle, montrait les procédures une à une avec leurs propres couleurs : on
     voyait donc du gris au cercle sans jamais le retrouver en dessous, et des
     couleurs en dessous qui n'existaient pas au cercle.

     Les deux partent maintenant du MÊME calcul. Repliée, la liste montre les
     parts de l'anneau — gris compris. Dépliée, elle montre tout le détail, où
     chaque procédure retrouve son nom et son temps exact. */
  const partsAnneau = regrouperParts(
    vue.classe.filter(x => (x.total || x.secondes || 0) > 0),
    x => x.total || x.secondes || 0)
  /* ═══ CE QUI EST GRIS RESTE GRIS UNE FOIS DÉPLIÉ ═══

     Repliée, la liste montrait « 3 autres » en gris. Dépliée, elle rendait à
     ces trois procédures leurs couleurs d'origine — trois teintes vives qui
     n'existaient nulle part dans l'anneau.

     On promet donc la couleur : ce qui a été réuni sous le gris le garde. Le
     dépliage révèle CE QUE contient la part grise, il ne redistribue pas les
     couleurs. */
  const grises = new Set()
  const partGrise = partsAnneau.find(x => x.estAutres)
  if (partGrise) {
    const montrees = new Set(partsAnneau.filter(x => !x.estAutres))
    vue.classe.forEach(x => { if (!montrees.has(x)) grises.add(x) })
  }
  const visibles = (vue.deplie ? vue.classe : partsAnneau).map(x =>
    grises.has(x) ? { ...x, couleur: ANNEAU_GRIS } : x)

  el.innerHTML = visibles.map((x, rang) => {
    const n = x.lecteurs.size
    const neuve = animerDes != null && rang >= animerDes
    return `
      <button type="button" class="fm-lg${neuve ? ' neuve' : ''}"
              ${neuve ? `style="animation-delay:${(rang - animerDes) * 0.05}s"` : ''}
              data-part="${rang}" ${x.estAutres ? '' : `data-proc="${escapeHtml(x.proc.id)}"`}>
        <span class="pt" style="background:${x.couleur}"></span>
        <span class="co">
          <!-- La part grise ne désigne aucune procédure : elle en réunit plusieurs. -->
          <span class="nm">${x.estAutres ? escapeHtml(x.nom || 'Autres')
            : escapeHtml(x.proc?.titre || 'Sans titre')}</span>
          <span class="st">${(x.estAutres ? 'Les moins consult\u00e9es' : escapeHtml(x.proc?.categorie || 'Sans cat\u00e9gorie'))}${
            n ? ' \u00b7 ' + n + ' personne' + (n > 1 ? 's' : '') : ''}</span>
        </span>
        <span class="vl">${dureeLisible(x.total)}</span>
      </button>`
  }).join('')

  if (vue.classe.length > 3) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'fm-plus'
    b.textContent = vue.deplie ? 'Voir moins' : 'Voir plus'
    b.addEventListener('click', () => {
      const avant = b.getBoundingClientRect().top
      if (vue.deplie) {
        const enTrop = [...el.querySelectorAll('.fm-lg')].slice(3)
        enTrop.forEach((l, k) => {
          l.style.animationDelay = ((enTrop.length - 1 - k) * 0.04) + 's'
          l.classList.add('part')
        })
        setTimeout(() => {
          vue.deplie = false
          peindreClassementProc(cle)
          glisserBoutonProc(cle, avant)
        }, 240 + enTrop.length * 40)
        return
      }
      vue.deplie = true
      peindreClassementProc(cle, 3)
      glisserBoutonProc(cle, avant)
    })
    el.appendChild(b)
  }

  /* Toucher une ligne éclaire sa part, comme sur la fiche d'un membre. Un appui
     long ouvre la procédure : le geste court sert à comparer, le long à aller
     voir. Deux intentions distinctes, deux gestes distincts. */
  el.querySelectorAll('[data-part]').forEach(b => {
    let minuteur = null
    let ouverte = false

    const ouvrir = () => { ouverte = true; openAnalyse(b.dataset.proc) }
    b.addEventListener('pointerdown', () => {
      ouverte = false
      minuteur = setTimeout(ouvrir, 550)
    })
    const annuler = () => { if (minuteur) { clearTimeout(minuteur); minuteur = null } }
    b.addEventListener('pointerup', annuler)
    b.addEventListener('pointerleave', annuler)
    b.addEventListener('pointercancel', annuler)

    b.addEventListener('click', () => {
      if (ouverte) return
      const i = Number(b.dataset.part)
      const actif = b.classList.contains('choisi')
      el.querySelectorAll('[data-part]').forEach(x => x.classList.remove('choisi'))
      const arcs = document.querySelectorAll('#an-anneau-proc-' + cle + ' [data-arc]')

      if (actif) {
        arcs.forEach(a => a.classList.remove('pale'))
        centreAnneauProc(cle, null)
        return
      }
      b.classList.add('choisi')
      arcs.forEach((a, k) => a.classList.toggle('pale', k !== i))
      centreAnneauProc(cle, vue.classe[i])
    })
  })
}

function glisserBoutonProc(cle, ancienHaut) {
  const b = document.querySelector('#an-top-proc-' + cle + ' .fm-plus')
  if (!b || ancienHaut == null) return
  const ecart = ancienHaut - b.getBoundingClientRect().top
  if (!ecart) return
  b.style.transition = 'none'
  b.style.transform = `translateY(${ecart}px)`
  requestAnimationFrame(() => {
    b.classList.add('glisse')
    b.style.transform = 'translateY(0)'
  })
}

function majBarreProc() {
  document.querySelectorAll('#an-barre-proc [data-va]').forEach(b => {
    b.classList.toggle('on', b.dataset.va === anProcPeriode)
  })
  /* Le mot sous les points est parti avec eux : les boutons de période
     portent leur libellé. */
}

;(() => {
  const piste = document.getElementById('an-piste-proc')
  if (!piste) return

  piste.addEventListener('scroll', () => {
    const page = piste.scrollLeft > piste.clientWidth / 2 ? 'all' : 'month'
    if (page === anProcPeriode) return
    anProcPeriode = page
    majBarreProc()
    if (navigator.vibrate) navigator.vibrate(6)
  }, { passive: true })

  document.querySelectorAll('#an-barre-proc [data-va]').forEach(b => {
    b.addEventListener('click', () => {
      piste.scrollTo({ left: b.dataset.va === 'all' ? piste.clientWidth : 0, behavior: 'smooth' })
    })
  })
})()


/* Le résumé de l'analyse ne s'ouvre plus. C'est un aperçu — trois lignes pour
   savoir où en est l'équipe —, pas un point d'entrée. La fiche d'un membre
   s'ouvre depuis la page Équipe complète, où tout le monde figure. */

function dateCourte(v) {
  return new Date(v).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

/* « il y a 3 jours », « hier », « aujourd'hui » — plus parlant qu'une date. */
function ilYA(ms) {
  const jours = Math.floor((Date.now() - ms) / 86400000)
  if (jours <= 0) return "aujourd'hui"
  if (jours === 1) return 'hier'
  if (jours < 7) return `il y a ${jours} jours`
  if (jours < 31) return `il y a ${Math.floor(jours / 7)} semaine${jours >= 14 ? 's' : ''}`
  return `il y a ${Math.floor(jours / 30)} mois`
}

/* Place la pastille sous l'onglet actif. Sur un écran ouvert sans passer par
   un onglet (détail, création, réglages...), aucun onglet n'est actif : la
   pastille s'efface au lieu de rester posée sous le mauvais bouton. */
function placerPastilleSansAnimation(idBarre) {
  const pastille = document.getElementById(idBarre)?.querySelector('.tab-pill')
  if (!pastille) return
  const memeTransition = pastille.style.transition
  pastille.style.transition = 'none'
  majPastille(idBarre)
  void pastille.offsetWidth
  pastille.style.transition = memeTransition
}

/* Mesure la largeur exacte dont chaque onglet a besoin pour afficher son
   libellé, et l'inscrit dans une variable CSS. On anime ainsi vers une valeur
   juste au pixel, au lieu d'un maximum arbitraire qui donnait un arrêt sec. */
function mesurerOnglets() {
  document.querySelectorAll('#tabbar .tab-round--secondary').forEach(b => {
    const lbl = b.querySelector('.tab-label')
    if (!lbl) return
    const large = lbl.scrollWidth
    if (large > 0) b.style.setProperty('--w', Math.ceil(42 + large + 15) + 'px')
  })
}

/* On remesure quand la police arrive : mesurée avec la police de secours, la
   largeur est fausse de quelques pixels et le libellé se retrouve rogné. */
if (document.fonts?.ready) document.fonts.ready.then(mesurerOnglets)
window.addEventListener('resize', mesurerOnglets)

/* L'espace équipe garde sa pastille glissante ; l'espace gestion n'en a plus,
   son onglet actif se déploie tout seul. La fonction ne fait donc rien quand
   la barre ne contient pas de pastille. */
function majPastille(idBarre) {
  const barre = document.getElementById(idBarre)
  if (!barre) return
  const pastille = barre.querySelector('.tab-pill')
  const actif = barre.querySelector('.tab-round.active')
  if (!pastille) return
  if (!actif || actif.classList.contains('tab-round--primary')) { pastille.style.opacity = '0'; return }
  pastille.style.transform = `translate(${actif.offsetLeft}px, ${actif.offsetTop}px)`
  pastille.style.opacity = '1'
}

// ═══ NAVIGATION (séparée par espace, pas de collision d'ids) ═══
/* À quel onglet correspond chaque écran. Avant, le repère dépendait du bouton
   sur lequel on venait de taper : en revenant d'une sous-page par le bouton
   retour, aucun bouton n'était transmis et le repère disparaissait. Il se
   déduit maintenant de l'écran affiché, quel que soit le chemin emprunté. */
/* Les trois boutons de la barre unique. Leur action dépend de l'espace où l'on
   se trouve, pas de la barre : c'est ce qui permet de n'en avoir qu'une. */
function espaceCourant() {
  return document.getElementById('equipe-app')?.style.display !== 'none' ? 'equipe' : 'gestion'
}

document.getElementById('tb-procedures')?.addEventListener('click', function() {
  if (espaceCourant() === 'equipe') showEquipeScreen('e-list', this)
  else showGestionScreen('p-list', this)
})

document.getElementById('tb-analyse')?.addEventListener('click', function() {
  showGestionScreen('p-global-analyse', this)
  loadGlobalAnalyse()
})

/* L'onglet central de la barre n'existe plus sous cet identifiant : la barre
   du bas gère ses propres clics. Le geste « nouvelle procédure » reste
   accessible par `onTabPrincipal`, appelée ailleurs. */

/* Allume l'onglet correspondant à l'écran, et fait glisser la capsule.

   La capsule se place par la GAUCHE, pas par un `transform` : `left` en
   pourcentage suit la largeur de la barre, qui change entre gestion et
   équipe. Un décalage en pixels aurait fallu être recalculé. */
/* Le repère suit l'écran, pas le bouton touché : en revenant d'une sous-page
   par la flèche de retour, aucun bouton n'est transmis, et c'est pourtant là
   qu'on a le plus besoin de savoir où l'on est. */
/* La barre place elle-même sa capsule au clic. Rien à faire d'ici pour
   l'instant — on la garde parce que le reste du code l'appelle. */
function poserOngletActif(id) {}

const ONGLET_PAR_ECRAN = {
  /* Gestion : Accueil 0, Procédures 1, Analyse 2, Réglages 3.

     `p-list` est rattachée à Accueil, pas à Procédures. Les deux onglets y
     mènent tant que l'écran d'accueil n'existe pas ; il fallait en choisir un,
     et c'est bien l'écran d'ouverture de l'app. */
  'p-home': 0,
  'p-list': 1, 'p-category': 1, 'p-analyse': 1, 'p-edit-procedure': 1,
  'p-create': 1, 'p-create-manual': 1, 'p-create-video': 1,
  'p-create-doc': 1, 'p-create-ai': 1,
  'p-global-analyse': 2, 'p-membre': 2, 'p-membre-fiche': 2,
  'p-an-equipe': 2, 'p-an-categories': 2, 'p-an-temps': 2,
  'p-settings': 3, 'p-reg-poste': 3, 'p-reg-compte': 3, 'p-reg-code': 3,
  'p-reg-postes': 3, 'p-reg-langue': 3, 'p-reg-appareils': 3,
  'p-abonnement': 3, 'p-membres': 3,

  /* ═══ CES DEUX-LÀ MANQUAIENT ═══

     Un écran absent de cette table ne change pas l'onglet : la capsule reste
     sur la page d'où l'on vient. C'est ce qui donnait une barre qui indique
     une page où l'on n'est pas.

     `p-activites` s'ouvre par « Voir plus » depuis l'accueil — c'est la suite
     de l'accueil, l'onglet y reste. `p-scan` est le lecteur de QR code, qui
     appartient aux Réglages. */
  'p-activites': 0,
  /* Comme `p-activites` : ouverte depuis l'accueil, elle en est la suite, et
     l'onglet Accueil doit rester allumé. Sans cette ligne, la capsule
     resterait sur la page d'où l'on vient. */
  'p-recentes': 0,
  'p-scan': 3,
  'p-quota': 3,   // il vit dans les Réglages
}

/* `p-reg-etabs` a été retiré de cette table en même temps que l'écran : la
   liste des établissements vit désormais dans la carte des Réglages. Une
   entrée qui ne désigne plus rien fait douter de toutes les autres. */


/* ═══ D'OÙ L'ÉCRAN DOIT NAÎTRE ═══

   On retient la position de la dernière carte touchée. La mesure se fait ICI,
   au clic — pas dans la fonction d'affichage : à ce moment-là l'ancien écran est
   déjà masqué et la carte n'existe plus dans la page.

   La position est convertie en pourcentage de la fenêtre, parce que c'est
   l'unité qu'attend `transform-origin` sur un élément qui occupe tout l'écran. */
let origineOuverture = null

document.addEventListener('click', (e) => {
  const carte = e.target.closest('.cat-cell, .proc-rich-card, .an-lig, .emp-row, .fm-lg, .cat-recent-item')
  if (!carte) { origineOuverture = null; return }
  const r = carte.getBoundingClientRect()
  origineOuverture = {
    x: ((r.left + r.width / 2) / window.innerWidth * 100).toFixed(1) + '%',
    y: ((r.top + r.height / 2) / window.innerHeight * 100).toFixed(1) + '%',
  }
}, true)   // en capture : on mesure avant que l'écran ne change

/* Pose l'origine sur l'écran qui s'ouvre, et retire la classe quand c'est fini —
   sinon elle resterait et le prochain affichage rejouerait la même naissance
   depuis une position périmée. */
function ouvrirDepuisCarte(ecran) {
  if (!ecran) return
  ecran.classList.remove('nait')
  if (!origineOuverture) return
  ecran.style.setProperty('--ox', origineOuverture.x)
  ecran.style.setProperty('--oy', origineOuverture.y)
  ecran.classList.add('nait')
  origineOuverture = null
  /* On NE retire PAS la classe à la fin de l'animation : les cartes
     reprendraient leur entrée à ce moment-là, et on retomberait sur deux
     mouvements — décalés au lieu de superposés.

     Elle est retirée au changement d'écran suivant, quand celui-ci est déjà
     masqué : plus rien ne peut rejouer. */
}

/* Remet tous les écrans à zéro avant d'en ouvrir un autre. */
function oublierNaissances() {
  document.querySelectorAll('.screen.nait').forEach(s => s.classList.remove('nait'))
  document.querySelectorAll('.screen.fondu').forEach(s => s.classList.remove('fondu'))
}

/* Les deux gestes dans le BON ORDRE : la naissance d'abord, l'activation
   ensuite. C'était tout le problème — ajouter « active » puis « nait »
   laissait le navigateur démarrer l'ancienne animation avant de la remplacer,
   et on voyait les deux l'une par-dessus l'autre.

   Les écrans de l'espace équipe s'activent à la main, sans passer par
   `showEquipeScreen` : ils appellent cette fonction directement. */
/* ═══ LE BOUTON DE CRÉATION SUIT L'ÉCRAN ═══

   Il n'appartient qu'à la liste des procédures. Ailleurs, il se retire derrière
   la barre — sans quoi il proposerait de créer une procédure depuis les
   réglages ou l'analyse, où le geste n'a pas de sens.

   Sa largeur se MESURE sur un onglet, qui fait exactement celle de la capsule.
   Mesurer plutôt que recopier : le jour où l'on passe à trois onglets, le
   bouton suivra tout seul. */
function majBoutonPlus(idEcran) {
  const montre = idEcran === 'p-list'
  const etait = document.body.classList.contains('plus-vu')
  document.body.classList.toggle('plus-vu', montre)

  /* La chute ne peut pas être une transition : elle a sa propre déformation.
     On pose une classe le temps qu'elle dure, et on la retire — sinon elle
     rejouerait au moindre changement d'écran suivant. */
  if (etait && !montre) {
    document.body.classList.remove('plus-part')
    void document.body.offsetWidth
    document.body.classList.add('plus-part')
    clearTimeout(majBoutonPlus._t)
    majBoutonPlus._t = setTimeout(
      () => document.body.classList.remove('plus-part'), 320)
  }
  if (!montre) return

  const barre = document.getElementById('bar')
  const onglet = document.querySelector('#lNorm .tab')
  if (!barre || !onglet) return

  const rb = barre.getBoundingClientRect()
  const ro = onglet.getBoundingClientRect()
  if (!ro.width) return

  const r = document.documentElement.style
  r.setProperty('--plus-larg', Math.round(ro.width) + 'px')
  r.setProperty('--plus-cx', Math.round(rb.left + rb.width / 2) + 'px')
}

addEventListener('resize', () => {
  if (document.body.classList.contains('plus-vu')) majBoutonPlus('p-list')
})

function activerAvecNaissance(ecran) {
  if (!ecran) return

  /* ═══════════════════════════════════════════════════════════════════════
     LES ÉCRANS INACTIFS SONT INERTES
     ═══════════════════════════════════════════════════════════════════════

     L'app compte une trentaine de champs de saisie répartis dans ses écrans.
     Tous existent dès le chargement — seul `display:none` les cache.

     Or masquer retire du rendu, PAS de l'arbre. Safari lit le balisage entier,
     y trouve des champs, et propose un remplissage dès l'ouverture : clavier
     compris, sur un écran qui n'en contient aucun.

     J'avais posé `inert` sur le seul écran de connexion. C'était insuffisant :
     ce sont les trente autres qui parlaient.

     `inert` retire un bloc du focus, du remplissage et de la lecture d'écran.
     On le pose sur tous les écrans et on le lève sur celui qu'on montre — un
     seul endroit, puisque toutes les bascules passent ici. */
  document.querySelectorAll('.screen').forEach(s => {
    if (s === ecran) s.removeAttribute('inert')
    else s.setAttribute('inert', '')
  })

  oublierNaissances()
  ouvrirDepuisCarte(ecran)
  /* DEUX GESTES, DEUX ANIMATIONS.

     Ouvrir une procédure depuis sa carte, c'est entrer dedans : l'écran naît du
     point touché et grandit. Passer d'un onglet à l'autre, c'est remplacer une
     page par une autre — rien n'entre nulle part. Le même zoom aux deux
     endroits donnait à un simple changement d'onglet le poids d'une ouverture.

     Ici, un fondu de 180 ms, sans déplacement. C'est ce que fait iOS entre deux
     onglets, et c'est fait pour ne pas se remarquer. */
  if (navDepuisOnglet && !ecran.classList.contains('nait')) ecran.classList.add('fondu')
  ecran.classList.add('active')
}

/* ═══ LE LOGO, DÉFINI UNE FOIS ═══

   L'image est intégrée dans `index.html` plutôt que déposée à côté : un
   fichier absent du dépôt donnait un point d'interrogation à la place du
   logo, et rien ne le signalait.

   Elle n'y figure qu'UNE fois — les deux autres emplacements la recopient au
   démarrage. Sans ça, les 24 Ko de l'image seraient écrits trois fois dans la
   page. */
/* ═══ LA CARTE D'ABONNEMENT N'EXISTE PAS AU DÉMARRAGE ═══

   `poser()` ne tourne qu'une fois, au chargement du document. La carte
   d'abonnement, elle, est construite bien plus tard — quand on ouvre la page.
   Sa balise `data-logo-or` n'existait pas encore : elle restait donc vide, et
   le logo n'apparaissait jamais.

   `poserLogosOr` est extraite pour être rappelée après chaque construction de
   carte. Elle est idempotente : reposer une source déjà posée ne coûte rien. */
window.poserLogosOr = function () {
  const srcOr = document.getElementById('logo-or')
  if (!srcOr) return
  document.querySelectorAll('img[data-logo-or]').forEach(i => {
    if (i.src !== srcOr.src) i.src = srcOr.src
  })
}

;(() => {
  const poser = () => {
    const src = document.getElementById('logo-src')
    if (!src) return
      document.querySelectorAll('img[data-logo]').forEach(i => { i.src = src.src })
    /* La pastille de la feuille modale lit le logo depuis une variable CSS :
       c'est un pseudo-élément, il ne peut pas porter de balise `img`. */
    document.documentElement.style.setProperty('--logo-src', `url("${src.src}")`)
    /* Le logo ORANGE, pour la carte d'abonnement. Deux sources distinctes
       plutôt qu'une teinte calculée : j'ai perdu quatre essais à recolorer le
       blanc par filtre puis par masque, alors que le fichier orange existait. */
    poserLogosOr()
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', poser)
  } else poser()
})()

/* ═══ LE VOILE, À CHAQUE ARRIVÉE ═══

   Une seule fonction, appelée partout : changement de page dans les deux
   espaces, ouverture d'une fenêtre. On retire la classe puis on force le
   navigateur à recalculer — sans ce temps mort, rejouer la même animation ne
   produit rien du tout. */
function jouerVoile() {
  const v = document.getElementById('voile-arrivee')
  if (!v) return
  v.classList.remove('joue')
  void v.offsetWidth
  v.classList.add('joue')
}

window.showGestionScreen = function(id, btn) {
  /* La page de détail de la Gestion se comporte comme celle de l'Équipe :
     l'en-tête et la vidéo s'y figent. La classe neutralise l'`overflow` du
     body, sans quoi `position:sticky` n'a aucun effet. */

  arreterToutesLesVideos()
  jouerVoile()
  /* Le compte d'analyses se relit à chaque ouverture des Réglages : il change
     dès qu'une analyse est lancée, et un chiffre périmé vaut moins que rien.
     Branché ICI plutôt qu'aux quatre endroits qui ouvrent cette page. */
  if (id === 'p-settings') majLigneQuota()
  window.majBarreEspace?.('gestion')
  /* La capsule suit la page, quel que soit le chemin emprunté pour y venir. */
  window.placerOnglet?.(ONGLET_PAR_ECRAN[id])
  majBoutonPlus(id)
  animerBarreHaut()
  document.querySelectorAll('#gestion-app .screen').forEach(s => s.classList.remove('active'))
  activerAvecNaissance(document.getElementById(id))
  ajusterChampsVisibles()
  /* L'état de l'abonnement se relit à chaque changement d'écran plutôt qu'une
     fois au démarrage : l'essai peut expirer pendant qu'on utilise l'app. */
  lireEtatAbonnement().then(() => {
    dessinerAlerteEssai('essai-reglages')
    peindreDemandesAcces()
    appliquerBlocageEssai()
  })
  poserOngletActif(id)
  document.getElementById('tabbar')?.setAttribute('data-espace', 'gestion')
  majPastille('tabbar')
  if (id === 'p-create') updateModeCardsState()
  // La caméra ne doit jamais tourner sur un écran qu'on a quitté
  if (id !== 'p-scan') stopScanner()
  remonterEnHaut()
  /* Un écran qui vient d'apparaître peut enfin être mesuré : on y pose la
     pastille de période sans animation, pour qu'elle soit déjà en place. */
  requestAnimationFrame(() => reposerPastilles(true))
  /* On redessine à chaque changement d'écran : c'est le seul moment dont on soit
     sûr qu'il arrive, quoi qu'il se passe ailleurs. */
  peindreTiroir()
  peindreBarreEtablissements()
}

// Le document défile d'un seul bloc, tous écrans confondus : sans ça, en
// ouvrant une dossier depuis le bas de la grille, on atterrissait sur un
// écran plus court en gardant la position de défilement — donc sur du vide.
function remonterEnHaut() {
  window.scrollTo({ top: 0, behavior: 'auto' })
}

/* Le navigateur restaure de lui-même la position de défilement d'avant le
   rechargement, et il le fait APRÈS notre affichage : on se retrouvait au
   milieu de la liste. On lui retire cette initiative, et on remonte une
   seconde fois une fois la page posée, au cas où. */
try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual' } catch (e) {}

function atterrirEnHaut() {
  remonterEnHaut()
  requestAnimationFrame(remonterEnHaut)
  setTimeout(remonterEnHaut, 120)
}

/* Une vidéo lancée continuait de jouer après qu'on ait quitté sa page : rien ne
   l'arrêtait, puisqu'on ne change pas réellement de page mais seulement d'écran
   affiché. On entendait donc le son d'une vidéo devenue invisible.
   Toutes les vidéos sont donc mises en pause à chaque changement d'écran, et la
   lecture d'extrait en cours est coupée. */
function arreterToutesLesVideos() {
  document.querySelectorAll('video').forEach(v => {
    if (v.id === 'scan-video' || v.id === 'g-scan-video') return   // la caméra, gérée par stopScanner
    try { if (!v.paused) v.pause() } catch (e) {}
  })
  try { stopClipPlayback?.() } catch (e) {}
}
window.startNewProcedure = function() {
  resetCreateForm()
  showGestionScreen('p-create')
}
/* Comme côté gestion : le repère suit l'écran affiché, pas le bouton tapé.
   Le scanner et les réglages n'allument aucun onglet — le bouton blanc se
   signale à lui seul. */
/* L'espace équipe n'a plus qu'un onglet et son bouton de scan. La page
   « Mon activité » a été retirée : elle montrait à l'employé son propre temps
   mesuré, ce qui ne l'aide pas à travailler et lui rappelle qu'on le compte.
   Ce qui restait d'utile — « il vous reste 3 procédures à lire » — est déjà
   sur la liste, là où il peut agir dessus. */
const ONGLET_EQUIPE_PAR_ECRAN = {
  /* Équipe : Procédures 0, QR code 1, Réglages 2. */
  'e-list': 0, 'e-category': 0, 'e-detail': 0,
  'e-scan': 1,
  'e-settings': 2, 'e-reg-compte': 2,
  /* `reg-appareils` SANS préfixe : c'est bien son nom dans le balisage, seul
     écran de l'espace Équipe à ne pas en porter. J'ai cru à une faute et je
     l'ai « corrigé » en `e-reg-appareils` — ce qui l'aurait privé d'onglet.
     Vérifié dans `index.html` avant de le remettre. */
  'e-reg-poste': 2, 'e-reg-langue': 2, 'reg-appareils': 2,
}

window.showEquipeScreen = function(id, btn) {
  arreterToutesLesVideos()
  jouerVoile()
  window.majBarreEspace?.('equipe')
  window.placerOnglet?.(ONGLET_EQUIPE_PAR_ECRAN[id])
  /* L'espace Équipe ne crée pas de procédures : le bouton n'y a pas sa place. */
  document.body.classList.remove('plus-vu')
  /* ═══ LE STICKY A BESOIN QUE LE BODY LE LAISSE FAIRE ═══

     `body` porte un `overflow`, et un élément collant se cale sur le premier
     ancêtre qui en a un — donc sur le body, qui ne défile pas lui-même. Le
     titre n'avait alors aucune raison de se figer.

     On neutralise cet `overflow` le temps des pages de détail, et on le
     rétablit en sortant : les autres écrans gardent leur comportement.

     La classe vit sur le BODY, qu'un sélecteur CSS ne peut pas atteindre
     depuis l'écran — d'où ce passage par le script. */
  document.querySelectorAll('#equipe-app .screen').forEach(s => s.classList.remove('active'))
  activerAvecNaissance(document.getElementById(id))
  ajusterChampsVisibles()
  /* L'état de l'abonnement se relit à chaque changement d'écran plutôt qu'une
     fois au démarrage : l'essai peut expirer pendant qu'on utilise l'app. */
  lireEtatAbonnement().then(() => {
    dessinerAlerteEssai('essai-reglages')
    peindreDemandesAcces()
    appliquerBlocageEssai()
  })
  /* Le bouton suit l'écran : il n'a de sens que là où la caméra tourne. En
     quittant le scanner on repart caméra allumée — sinon on reviendrait sur un
     écran noir sans se rappeler pourquoi. */
  if (id !== 'e-scan') camEteinte = false
  majBoutonCamera()
  poserOngletActif(id)
  if (id !== 'e-scan') stopScanner()
  if (id !== 'e-detail') quitterLecture()
  remonterEnHaut()

  peindreTiroir()
  peindreBarreEtablissements()
}

// ═══════════ GESTION : liste ═══════════
let allGestionProcedures = []
let cachedEmployes = []
let cachedMembres = []
let cachedEntreprise = null
let cachedValidations = []
let cachedEtapesByProc = {}
let preloadEtapes = null   // promesse du chargement différé des étapes

let allCategoriesData = []
let currentCatSort = 'az'

/* ═══════════════════════════════════════════════════════════════════════════
   LA LISTE EST DÉJÀ LÀ

   À l'ouverture, l'écran restait vide une à deux secondes : le temps de demander
   la liste à la base et d'attendre la réponse.

   On garde donc une copie sur l'appareil à chaque chargement réussi. À
   l'ouverture suivante, on affiche cette copie SANS RIEN DEMANDER — d'où
   l'instantané — puis on interroge la base en arrière-plan. Si rien n'a changé,
   rien ne bouge à l'écran ; sinon la différence apparaît une seconde plus tard.

   Ce qu'on garde, c'est la GRILLE DÉJÀ CALCULÉE, pas les procédures brutes : les
   pourcentages de lecture dépendent d'une seconde requête, et on ne peut donc
   pas les recalculer sans réseau. Les redessiner faux pendant une seconde serait
   pire que d'attendre.

   Deux précautions. La copie est rangée PAR ENTREPRISE — quelqu'un qui bascule
   d'un établissement à l'autre ne doit pas voir les procédures du précédent,
   même une seconde. Et on n'y met que de quoi dessiner : une liste complète
   remplirait les cinq mégaoctets du navigateur, et le rangement échouerait en
   silence.
   ═══════════════════════════════════════════════════════════════════════════ */

/* `v2` : les copies rangées par les versions précédentes ne portent pas
   `publiee_le`. Les relire ferait afficher « Brouillon » sur toutes les
   procédures au premier démarrage après la mise à jour. Changer la clé les
   met de côté ; le navigateur nettoiera les anciennes de lui-même. */
function cleCache(entrepriseId) { return 'procedo_grille_v2_' + entrepriseId }

function rangerGrille(entrepriseId, categories, sous) {
  try {
    const leger = (categories || []).map(c => ({
      nom: c.nom, icone: c.icone, avgPct: c.avgPct,
      latestDate: c.latestDate, earliestDate: c.earliestDate,
      procsInCat: (c.procsInCat || []).map(p => ({
        id: p.id, titre: p.titre, categorie: p.categorie,
        /* Rapportée dès maintenant : sans elle, les écrans qui la liront à
           l'étape 3 recevraient `undefined` et afficheraient tout comme
           « sans sous-dossier », sans qu'aucune erreur ne le signale. */
        sous_categorie: p.sous_categorie || null, statut: p.statut,
        /* ⚠ SANS ELLE, TOUT PARAÎT EN BROUILLON. La copie sert à dessiner la
           grille avant que le réseau réponde ; `etatProcedureHtml` lit
           `publiee_le`, et une colonne absente vaut `undefined` — donc
           « pas publiée ». La pastille s'affichait sur des procédures en
           ligne depuis des semaines, et disparaissait ensuite. */
        publiee_le: p.publiee_le || null,
        created_at: p.created_at, video_url: p.video_url, image_url: p.image_url,
        etapes: p.etapes,
      })),
    }))
    localStorage.setItem(cleCache(entrepriseId), JSON.stringify({ quand: Date.now(), sous, categories: leger }))
  } catch (e) {
    // Mémoire pleine ou navigation privée : on s'en passe, ce n'est qu'un confort.
    console.warn('Standix \u00b7 grille non mise en cache :', e?.message || e)
  }
}

function lireGrille(entrepriseId) {
  try {
    const brut = localStorage.getItem(cleCache(entrepriseId))
    if (!brut) return null
    const { categories, sous } = JSON.parse(brut)
    return Array.isArray(categories) && categories.length ? { categories, sous } : null
  } catch (e) { return null }
}

/* Deux grilles sont-elles identiques à l'œil ? Si oui, on ne redessine pas :
   redessiner ferait clignoter les cartes et perdrait la position de défilement,
   pour aboutir exactement au même écran. */
function memeGrille(a, b) {
  if (!a || !b || a.length !== b.length) return false
  const cle = (c) => c.nom + ':' + c.avgPct + ':' +
    (c.procsInCat || []).map(p => [p.id, p.titre, p.statut, p.image_url,
      /* La publication fait partie de ce qui se VOIT — c'est la pastille
         « Brouillon ». Absente de cette clé, une procédure qu'on venait de
         publier laissait la grille jugée identique, donc non redessinée, et
         la pastille restait. */
      p.publiee_le || '',
      p.etapes?.[0]?.count ?? ''].join('|')).join('~')
  return a.map(cle).join('\u00a7') === b.map(cle).join('\u00a7')
}

async function loadGestionProcedures() {
  // L'en-tête a été retiré de la page : ces deux repères peuvent être absents.
  const subheadEl = document.getElementById('p-list-subhead')
  const catGridEl = document.getElementById('cat-grid')
  const ecrireSous = (t) => { if (subheadEl) subheadEl.textContent = t }
  document.getElementById('greeting-text')?.style.setProperty('display', 'none')

  /* La copie d'abord : l'écran se remplit avant même que la requête parte. */
  const entrepriseId = currentMembre.entreprise_id
  const copie = lireGrille(entrepriseId)
  if (copie) {
    allCategoriesData = copie.categories
    allGestionProcedures = copie.categories.flatMap(c => c.procsInCat || [])
    renderCategoryGrid()
    ecrireSous(copie.sous || '')
    window.jalon?.('grille affich\u00e9e depuis la copie locale')
  }

  // Membres et entreprise ne dépendent pas des procédures : les trois requêtes
  // partent ensemble au lieu de s'attendre. Un aller-retour réseau économisé,
  // c'est autant de gagné avant l'affichage.
  const [
    { data: procedures, error },
    { data: membresFrais },
    { data: entrepriseRow },
  ] = await Promise.all([
    supabase.from('procedures').select('*, etapes(count)').eq('entreprise_id', currentMembre.entreprise_id)
      .order('created_at', { ascending: false }),
    supabase.from('membres').select('*').eq('entreprise_id', currentMembre.entreprise_id),
    supabase.from('entreprises').select('*').eq('id', currentMembre.entreprise_id).maybeSingle(),
  ])
  const fullMembres = membresFrais

  window.jalon?.('procédures + membres reçus')
  if (error) {
    /* Si la copie est déjà à l'écran, une panne réseau ne doit pas l'effacer :
       on garde ce qui est là et on le signale, sans vider la page. */
    if (copie) { toast('Liste non actualis\u00e9e : ' + error.message); return }
    ecrireSous("Erreur : " + error.message); return
  }
  allGestionProcedures = procedures
  cachedMembres = fullMembres || []
  cachedEntreprise = entrepriseRow || null
  cachedEmployes = cachedMembres.filter(m => m.role === 'equipe')

  /* On NE VIDE PAS la grille si la copie est à l'écran : on ne sait pas encore
     si quelque chose a changé. La vider ici la faisait disparaître juste avant
     qu'on décide de ne pas la redessiner — l'écran finissait vide.
     `renderCategoryGrid` vide de toute façon avant de redessiner. */
  if (!copie) catGridEl.innerHTML = ''

  if (procedures.length === 0) {
    renderAccueil()
      ecrireSous(`0 dossier · 0 procédure · accès complet`)
    /* Le compte de la page reste sinon sur son tiret : ce chemin court-circuite
       `renderCategoryGrid`, qui est le seul endroit qui l'écrit. */
    const cpt0 = document.getElementById('proc-compte')
    if (cpt0) cpt0.textContent = '0 dossier · 0 procédure'
    /* Plus rien à mesurer : le CSS déduit la hauteur du bloc dès la première
       image. L'appel qui était ici pointait vers une fonction supprimée — il
       aurait cassé la page à chaque ouverture. */
    catGridEl.innerHTML = `
      <div class="debut">
        <div class="debut-dessin">
          <div class="lueur"></div>
          <svg viewBox="0 0 132 120" fill="none">
            <!-- deux fiches en retrait, puis celle de devant avec son bouton de lecture -->
            <rect class="fond-2" x="30" y="8"  width="72" height="52" rx="11"
                  stroke="rgba(255,255,255,0.16)" stroke-width="1.5"/>
            <rect class="fond-1" x="22" y="20" width="88" height="62" rx="13"
                  stroke="rgba(255,255,255,0.26)" stroke-width="1.5"/>
            <g class="devant">
              <rect x="14" y="34" width="104" height="72" rx="15"
                    fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.42)" stroke-width="1.6"/>
              <circle cx="66" cy="70" r="17" stroke="rgba(255,255,255,0.42)" stroke-width="1.6"/>
              <path d="M61.5 62.5 L76 70 L61.5 77.5 Z" fill="rgba(255,255,255,0.75)"/>
              <line x1="30" y1="95" x2="60" y2="95" stroke="rgba(255,255,255,0.22)" stroke-width="1.6" stroke-linecap="round"/>
              <line x1="66" y1="95" x2="84" y2="95" stroke="rgba(255,255,255,0.14)" stroke-width="1.6" stroke-linecap="round"/>
            </g>
            <!-- Le seul point de couleur de ce dessin : il fait écho au bouton
                 de la carte du haut, et relie les deux d'un coup d'œil. Tout le
                 reste demeure au trait blanc — deux foyers de couleur sur un
                 même écran, et le bouton perdrait sa force. -->
            <g class="signe">
              <circle cx="112" cy="26" r="13" fill="url(#orLibre)"/>
              <line x1="112" y1="20" x2="112" y2="32" stroke="#2A1400" stroke-width="2.6" stroke-linecap="round"/>
              <line x1="106" y1="26" x2="118" y2="26" stroke="#2A1400" stroke-width="2.6" stroke-linecap="round"/>
            </g>
          </svg>
        </div>
        <h3>Votre première procédure</h3>
        <p>Décrivez une tâche étape par étape, ou filmez-la une seule fois — l'IA la découpe pour vous.</p>
        <div class="fleche">Touchez le bouton <b>+</b>, en bas de l’écran</div>
      </div>
    `
    /* On vide TOUT avant de sortir. Sans ça, changer d'établissement vers une
       entreprise sans procédure laissait en mémoire les lectures de la
       précédente : la carte du haut annonçait « 4 min de formation » pendant
       que les trois sections en dessous disaient « aucun membre » et
       « aucune procédure ». Un chiffre venu d'ailleurs. */
    cachedValidations = []
    cachedEtapesByProc = {}
    currentGaData = { procedures: [], membres: cachedMembres || [], employes: [], validations: [] }
    return
  }

  const procIds = procedures.map(p => p.id)

  // ═══ PRÉCHARGEMENT GLOBAL ═══
  // Absolument tout ce dont les autres pages ont besoin est chargé ici, en une
  // seule salve parallèle, pendant que l'écran de chargement est encore affiché.
  // Résultat : une fois l'app ouverte, plus aucune page n'attend le réseau.
  const { data: fullValidations } = await supabase
    .from('validations').select('*').in('procedure_id', procIds)

  // Les étapes sont de loin la plus grosse table et l'écran d'accueil n'en a
  // pas besoin : on les charge en arrière-plan pendant que l'app s'affiche.
  // Les écrans qui en dépendent attendent cette promesse — déjà résolue en
  // pratique le temps qu'on y arrive.
  preloadEtapes = supabase.from('etapes').select('*').in('procedure_id', procIds).order('ordre')
    .then(({ data }) => {
      cachedEtapesByProc = {}
      ;(data || []).forEach(e => {
        if (!cachedEtapesByProc[e.procedure_id]) cachedEtapesByProc[e.procedure_id] = []
        cachedEtapesByProc[e.procedure_id].push(e)
      })
    })
    .catch(() => {})

  cachedValidations = fullValidations || []

  // Page "Analyse générale" : prête d'avance, elle s'affichera instantanément
  currentGaData = {
    procedures, membres: cachedMembres, employes: cachedEmployes, validations: cachedValidations,
  }
  const nbEmployesTotal = cachedEmployes.length
  const validationCountByProc = {}
  cachedValidations.forEach(v => { validationCountByProc[v.procedure_id] = (validationCountByProc[v.procedure_id] || 0) + 1 })

  const categoriesMap = {}
  procedures.forEach(p => {
    const nom = p.categorie || 'Sans dossier'
    if (!categoriesMap[nom]) categoriesMap[nom] = '📁'
  })

  const nbCategories = Object.keys(categoriesMap).length
  ecrireSous(`${nbCategories} dossier${nbCategories > 1 ? 's' : ''} · ${procedures.length} procédure${procedures.length > 1 ? 's' : ''} · accès complet`)

  allCategoriesData = []
  for (const [nom, icone] of Object.entries(categoriesMap)) {
    const procsInCat = procedures.filter(p => (p.categorie || 'Sans dossier') === nom) // déjà trié du plus récent au plus ancien

    // Taux moyen de consultation de la dossier (moyenne des taux de chaque procédure)
    let avgPct = 0
    if (nbEmployesTotal > 0) {
      let totalRatio = 0
      for (const p of procsInCat) {
        const nbVal = validationCountByProc[p.id] || 0
        totalRatio += Math.min(1, nbVal / nbEmployesTotal)
      }
      avgPct = procsInCat.length > 0 ? Math.round((totalRatio / procsInCat.length) * 100) : 0
    }

    allCategoriesData.push({
      nom, icone, procsInCat, avgPct,
      latestDate: new Date(procsInCat[0].created_at).getTime(),
      earliestDate: new Date(procsInCat[procsInCat.length - 1].created_at).getTime()
    })
  }

  window.jalon?.('validations re\u00e7ues, grille pr\u00eate')

  /* Rien n'a bougé depuis la dernière ouverture : l'écran est déjà juste, on le
     laisse tel quel. C'est le cas le plus fréquent — et c'est lui qui rend
     l'ouverture instantanée au lieu de simplement rapide. */
  const inchangee = copie && memeGrille(copie.categories, allCategoriesData)
  rangerGrille(entrepriseId, allCategoriesData, document.getElementById('p-list-subhead')?.textContent || '')

  if (inchangee) {
    /* On ne redessine pas la grille, mais le mot d'accueil doit être écrit :
       il part de « Chargement… » dans le balisage, et restait donc bloqué là
       à chaque ouverture depuis la copie locale — c'est-à-dire presque toujours. */
    renderAccueil()
    window.jalon?.('grille inchang\u00e9e, aucun redessin')
    surveillerAnalyses()
    return
  }

  renderAccueil()
  renderCategoryGrid()
  surveillerAnalyses()
}

/* ═══ Carte d'accueil ═══
   Salutation qui suit l'heure, et un mot qui dépend du suivi réel de l'équipe.
   Tout se calcule sur les données déjà en mémoire, aucune requête de plus. */
/* ═══════════════════════════════════════════════════════════════════════════
   LES TROIS DERNIÈRES PROCÉDURES CRÉÉES

   Trois cartes, avec ce qu'on veut savoir d'une vidéo : combien d'étapes elle a
   produites, quelle durée de film elles couvrent, et quand elle a été faite.

   Celles en cours d'analyse sont écartées : elles occupent déjà le bloc du
   dessus, et les montrer deux fois ferait croire à deux procédures.
   ═══════════════════════════════════════════════════════════════════════════ */
/* `peindreDernieresProcedures` a été retirée : elle dessinait les trois
   dernières procédures sur l'accueil, remplacées par un bouton menant à
   `p-recentes`. Elle n'avait plus d'appelant depuis la refonte de l'accueil,
   et son remplacement rend son retour improbable. */

/* ═══════════════════════════════════════════════════════════════════════════
   LES MOUVEMENTS DE L'ÉQUIPE

   Qui entre, qui change de rang, qui n'a pas pu entrer. RIEN D'AUTRE.

   Les lectures et les créations de procédure ont été retirées : elles se
   comptent par dizaines chaque semaine et noyaient les mouvements, qui eux sont
   rares. Et elles ont déjà leur place — la page Analyse pour les lectures, le
   bloc juste au-dessus pour les créations. Un bloc qui répète ce que deux
   autres disent mieux ne sert qu'à remplir.

   CE QUI MANQUE, ET POURQUOI : les départs et les retraits. Quand on retire
   quelqu'un, la ligne de `membres` est effacée — il ne reste ni son nom, ni la
   date, ni qui l'a retiré. Une information qu'on n'écrit pas ne se retrouve
   pas. Il faudra un journal pour les garder.
   ═══════════════════════════════════════════════════════════════════════════ */
/* Six semaines. Au-delà, une lecture ou une arrivée n'apprend plus rien, et la
   liste deviendrait trop longue pour qu'on la parcoure. */
const ACTIVITES_JOURS = 45

/* La collecte, séparée de l'affichage : l'accueil en montre trois, la page
   dédiée les montre toutes. Une seule source, deux vues — sinon les deux
   finissent par ne plus dire la même chose. */
async function collecterActivites() {
  const membres = cachedMembres || []
  const nomDe = (id) => membres.find(m => m.id === id)?.nom || 'Quelqu\u2019un'
  const depuis = Date.now() - ACTIVITES_JOURS * 86400000
  const faits = []

  /* Les arrivées. On saute la fiche du fondateur : « X a rejoint » le jour de
     la création de l'entreprise n'apprend rien à celui qui l'a créée. */
  membres.forEach(m => {
    if (estFondateur(m)) return
    if (!m.created_at) return
    faits.push({
      quand: Date.parse(m.created_at), genre: 'arrivee',
      texte: `<b>${escapeHtml(m.nom || 'Quelqu\u2019un')}</b> a rejoint l\u2019équipe`,
      detail: m.poste ? escapeHtml(m.poste) : '',
    })
  })

  membres.forEach(m => {
    if (!m.promu_le) return
    faits.push({
      quand: Date.parse(m.promu_le), genre: 'promotion',
      texte: `<b>${escapeHtml(m.nom || 'Quelqu\u2019un')}</b> est passé\u00b7e en gestion`,
      detail: m.promu_par ? 'par ' + escapeHtml(nomDe(m.promu_par)) : '',
    })
  })

  /* ═══ LES DÉPARTS ET LES RETRAITS ═══

     Ils ne peuvent pas se déduire de `membres` : la ligne est effacée. C'est le
     journal `mouvements` qui les garde, écrit au moment du geste. La table peut
     ne pas exister encore — on se tait alors plutôt que d'échouer. */
  {
    const { data } = await supabase
      .from('mouvements')
      .select('genre, nom, poste, par_nom, created_at')
      .eq('entreprise_id', currentMembre?.entreprise_id)
      .order('created_at', { ascending: false })
      .limit(40)
    ;(data || []).forEach(m => {
      const qui = `<b>${escapeHtml(m.nom || 'Quelqu\u2019un')}</b>`
      faits.push({
        quand: Date.parse(m.created_at), genre: m.genre === 'depart' ? 'depart' : 'retrait',
        texte: m.genre === 'depart'
          ? `${qui} a quitté l\u2019équipe`
          : `${qui} a été retiré\u00b7e de l\u2019équipe`,
        detail: [m.poste, m.par_nom ? 'par ' + escapeHtml(m.par_nom) : null]
          .filter(Boolean).map(escapeHtml).join(' \u00b7 '),
      })
    })
  }

  /* Seule source qui demande une requête — la table peut ne pas exister
     encore, on se tait alors plutôt que d'échouer. */
  if (currentMembre?.role === 'gestion') {
    const { data } = await supabase
      .from('demandes_acces')
      .select('nom, email, created_at')
      .eq('entreprise_id', currentMembre.entreprise_id)
      .order('created_at', { ascending: false })
      .limit(40)
    ;(data || []).forEach(d => {
      faits.push({
        quand: Date.parse(d.created_at), genre: 'refus',
        texte: `<b>${escapeHtml(d.nom || d.email || 'Quelqu\u2019un')}</b> n\u2019a pas pu vous rejoindre`,
        detail: 'abonnement complet',
      })
    })
  }

  return faits.filter(f => f.quand && f.quand >= depuis).sort((a, b) => b.quand - a.quand)
}

const ACT_DESSINS = {
  arrivee:   '<circle cx="9.5" cy="8" r="3.8"/><path d="M2.8 20a6.7 6.7 0 0 1 13.4 0"/><line x1="19" y1="7" x2="19" y2="13"/><line x1="16" y1="10" x2="22" y2="10"/>',
  promotion: '<path d="M12 3.2l2.5 5.4 5.9.7-4.4 4 1.2 5.8L12 16.2 6.8 19.1 8 13.3l-4.4-4 5.9-.7z"/>',
  lecture:   '<path d="M13.6 3H7.4A2 2 0 0 0 5.4 5v14a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8Z"/><path d="M13.6 3v5h5"/><path d="M8.8 16.6l2 2 4-4.4"/>',
  creation:  '<path d="M13.6 3H7.4A2 2 0 0 0 5.4 5v14a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8Z"/><path d="M13.6 3v5h5"/><line x1="11.8" y1="12" x2="11.8" y2="17"/><line x1="9.3" y1="14.5" x2="14.3" y2="14.5"/>',
  refus:     '<circle cx="9.5" cy="8" r="3.8"/><path d="M2.8 20a6.7 6.7 0 0 1 13.4 0"/><line x1="16.5" y1="7.5" x2="21.5" y2="12.5"/><line x1="21.5" y1="7.5" x2="16.5" y2="12.5"/>',
  depart:    '<circle cx="9.5" cy="8" r="3.8"/><path d="M2.8 20a6.7 6.7 0 0 1 13.4 0"/><path d="M17.5 9.5 21 13l-3.5 3.5"/><line x1="21" y1="13" x2="15" y2="13"/>',
  retrait:   '<circle cx="9.5" cy="8" r="3.8"/><path d="M2.8 20a6.7 6.7 0 0 1 13.4 0"/><line x1="15.5" y1="11" x2="22" y2="11"/>',
}

/* La MÊME ligne que sur la page Analyse : `an-lig`, avec son nom, son
   sous-titre et sa valeur à droite. Trois blocs qui répondent à la même
   question — que s'est-il passé — doivent se lire de la même façon.

   La pastille d'icône reste : les événements sont de natures différentes, et
   le dessin les distingue sans qu'on ait à lire. C'est le seul ajout. */
function ligneActivite(f) {
  return `
    <div class="an-lig act-lig">
      <span class="act-ic act-${f.genre}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round">${ACT_DESSINS[f.genre]}</svg>
      </span>
      <span class="co">
        <span class="nm">${f.texte}</span>
        ${f.detail ? `<span class="st">${f.detail}</span>` : ''}
      </span>
      <span class="vl">${depuisQuandCourt(f.quand)}</span>
    </div>`
}

async function peindreActivites() {
  const zone = document.getElementById('accueil-activites')
  if (!zone) return

  const faits = await collecterActivites()

  const recents = faits.slice(0, 3)

  /* Même règle que le bloc au-dessus : il reste, avec une phrase à la place
     des lignes. */

  zone.innerHTML = `
    <div class="an-bloc">
      <div class="an-tete">
        <span class="an-ic">
          <svg viewBox="0 0 24 24" fill="none" stroke="url(#logoOrIc)" stroke-width="1.7"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="8.8"/><path d="M12 6.8V12l3.6 2.2"/>
          </svg>
        </span>
        <b>Mouvements de l\u2019équipe</b>
      </div>
      ${!recents.length ? `<div class="an-vide">Les arrivées, les départs et les changements
        de rang s\u2019afficheront ici.</div>` : ''}
      ${recents.map(ligneActivite).join('')}
      ${faits.length > recents.length
        ? `<button type="button" class="an-plus" id="act-plus">Voir plus</button>` : ''}
    </div>`

  document.getElementById('act-plus')?.addEventListener('click', ouvrirActivites)
}

/* La page entière : tout ce que la collecte a trouvé, groupé par jour. Sans ces
   en-têtes, quarante lignes de « 12 mars » se ressemblent toutes. */
window.ouvrirActivites = async function () {
  showGestionScreen('p-activites')
  const zone = document.getElementById('activites-tout')
  if (!zone) return
  zone.innerHTML = '<div class="act-vide">Chargement\u2026</div>'

  const faits = await collecterActivites()
  if (!faits.length) {
    zone.innerHTML = `<div class="act-vide">Rien ne s\u2019est passé ces
      ${Math.round(ACTIVITES_JOURS / 7)} dernières semaines.</div>`
    return
  }

  const jour = (t) => new Date(t).toLocaleDateString('fr-FR',
    { weekday: 'long', day: 'numeric', month: 'long' })
  const aujourdhui = jour(Date.now())
  const hier = jour(Date.now() - 86400000)

  let dernier = null
  const morceaux = []
  faits.forEach(f => {
    const j = jour(f.quand)
    if (j !== dernier) {
      dernier = j
      const nom = j === aujourdhui ? "Aujourd'hui" : j === hier ? 'Hier' : j
      morceaux.push(`<div class="act-jour">${escapeHtml(nom)}</div>`)
    }
    morceaux.push(ligneActivite(f))
  })

  /* ═══ PLUS DE TÊTE DE SECTION ═══

     Il y avait ici « Les mouvements », en petites capitales, juste sous le
     titre de la page. Depuis que celui-ci s'appelle « Mouvements de l'équipe »,
     les deux disaient la même chose à trois centimètres d'écart.

     Une tête de section sert à distinguer plusieurs blocs sur une même page.
     Ici il n'y en a qu'un : elle ne séparait rien, elle répétait. */
  zone.innerHTML = `
    ${morceaux.join('')}
    <div class="fm-periode-mot">${faits.length} activité${faits.length > 1 ? 's' : ''}
      sur ${Math.round(ACTIVITES_JOURS / 7)} semaines</div>`
}

/* « 2 min », « 3 h », « hier », « 12 mars ». Court, parce que cette colonne est
   étroite et qu'on ne la lit qu'en passant. */
function depuisQuandCourt(t) {
  if (!t) return ''
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 2) return 'à l\u2019instant'
  if (m < 60) return m + ' min'
  const h = Math.round(m / 60)
  if (h < 24) return h + ' h'
  const j = Math.round(h / 24)
  if (j === 1) return 'hier'
  if (j < 8) return j + ' j'
  return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

/* ═══════════════════════════════════════════════════════════════════════════
   L'ACCUEIL · QUATRE TUILES

   Un salut, une phrase, un filtre, quatre chiffres. Rien d'autre.

   ─── LA MÊME MATIÈRE QUE LA PAGE ANALYSE ───

   Les tuiles portent `an-bloc`, la classe des trois blocs de l'Analyse. Une
   troisième grammaire de carte dans la même app aurait été une chose de plus à
   apprendre, pour rien.

   ─── UN SEUL ANNEAU ───

   Seule la quatrième tuile en porte un : sa valeur est un RAPPORT — tant
   d'analyses sur tant d'autorisées — et un anneau dit un rapport mieux qu'un
   texte. Les trois autres portent un nombre nu, parce qu'un nombre seul n'a
   rien à comparer et qu'un anneau à 100 % ne veut rien dire.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══ PLUS DE FILTRE : TOUT EST AU TOTAL ═══

   Le sélecteur « Ce mois-ci / Au total » a été retiré. Le titre demandé —
   « Total de procédures créées » — dit le total, et un filtre qui pourrait le
   ramener au mois contredirait son propre libellé.

   La constante reste plutôt que d'être effacée : `peindreTuilesAccueil` la lit
   à trois endroits, et la retirer demanderait de réécrire chaque calcul. Elle
   ne change simplement plus de valeur. */
const accueilPeriode = 'tout'

function renderAccueil() {
  /* ═══ UN ÉCHEC ICI NE DOIT PLUS ÊTRE SILENCIEUX ═══

     La page est restée entièrement vide et rien ne le signalait : une erreur
     dans le calcul des tuiles interrompt la fonction, et l'accueil n'affiche
     alors ni salut, ni phrase, ni tuiles — comme si l'écran n'existait pas.

     Le salut est donc posé AVANT tout calcul, et les tuiles sont enveloppées :
     si elles échouent, la console dit pourquoi et le haut de page reste
     lisible. Un écran à moitié rempli se diagnostique ; un écran vide, non. */
  const prenom = document.getElementById('ac-prenom')
  if (prenom) {
    /* Le prénom seul. « Bonjour Emilien Meifj » sonne comme un courrier
       administratif ; on salue quelqu'un par son prénom. */
    const nom = (currentMembre?.nom || '').trim()
    prenom.textContent = nom ? nom.split(/\s+/)[0] : ''
  }
  try {
    peindreTuilesAccueil()
  } catch (e) {
    console.error('[accueil] les tuiles n\u2019ont pas pu \u00eatre dessin\u00e9es :', e)
  }
}

/* Le premier jour du mois courant. Le mois précédent servait à la comparaison
   d'usage de l'IA, qui a été remplacée par le taux de lecture — plus rien ne
   le lit, donc plus rien ne le calcule. */
function debutDuMois() {
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0)
  return d
}

function peindreTuilesAccueil() {
  const zAnneau = document.getElementById('ac-anneau')
  const zDuo    = document.getElementById('ac-duo')
  const zListes = document.getElementById('ac-listes')
  if (!zAnneau || !zDuo || !zListes) return
  zAnneau.innerHTML = ''; zDuo.innerHTML = ''; zListes.innerHTML = ''

  const procs = allGestionProcedures || []

  /* ═══════════════════════════════════════════════════════════════════════
     L'ACCUEIL SANS AUCUNE PROCÉDURE

     ⚠ ON TESTE `procs.length`, PAS LE COMPTE DU MOIS. Une entreprise qui a
       douze procédures mais aucune ce mois-ci n'est pas vide — elle a juste
       un mois calme. L'état vide ne concerne que le vrai départ.
     ═══════════════════════════════════════════════════════════════════════ */
  const vide = document.getElementById('ac-vide')
  if (!procs.length) {
    if (vide) {
      vide.hidden = false
      const nom = cachedEntreprise?.nom
      vide.querySelector('.acv-t').textContent = nom
        ? nom + ' n\u2019a pas encore de proc\u00e9dure'
        : 'Aucune proc\u00e9dure pour l\u2019instant'
    }
    return
  }
  if (vide) vide.hidden = true

  /* ═══ ① CE QUI EST EN LIGNE ═══════════════════════════════════════════════

     Le seul chiffre qui dise si l'app SERT. Une procédure en brouillon n'existe
     que pour la gestion : l'équipe ne la voit pas, ne la lit pas, ne s'en sert
     pas. Un gérant peut en avoir écrit vingt et n'en avoir publié aucune.

     ⚠ LES ANALYSES EN COURS SONT ÉCARTÉES. Une procédure que l'IA est en train
       d'écrire n'est pas un brouillon oublié : elle n'existe pas encore. La
       compter au dénominateur ferait baisser le taux à chaque nouvelle vidéo,
       c'est-à-dire punirait le fait de travailler. */
  const abouties = procs.filter(p => p.statut !== 'traitement' && p.statut !== 'redaction')
  const enLigne = abouties.filter(p => p.publiee_le).length
  zAnneau.appendChild(anneauPublication(enLigne, abouties.length))

  /* ═══ ② LES DEUX CHIFFRES DU MOIS ════════════════════════════════════════ */
  const debutMois = debutDuMois()
  const debutMoisPrec = new Date(debutMois); debutMoisPrec.setMonth(debutMoisPrec.getMonth() - 1)

  /* ─── LES CONSULTATIONS ───────────────────────────────────────────────────

     ⚠ CE N'EST PAS UN COMPTEUR DE SCANS. Rien n'enregistre le geste de scanner
       un QR code : ce qu'on compte ici, ce sont les lignes de `validations`,
       c'est-à-dire les procédures OUVERTES par un membre, quel que soit le
       chemin — QR code, liste, lien.

       C'est le chiffre le plus proche qu'on ait, et il dit la même chose :
       est-ce que l'équipe consulte. Pour compter les scans séparément, il
       faudrait un journal écrit au moment du scan. */
  const vals = cachedValidations || []
  const quand = v => Date.parse(v.validated_at)
  const ceMois = vals.filter(v => quand(v) >= debutMois.getTime()).length
  const moisPrec = vals.filter(v => {
    const t = quand(v)
    return t >= debutMoisPrec.getTime() && t < debutMois.getTime()
  }).length

  zDuo.appendChild(chiffreAccueil({
    icone: 'lecture',
    titre: 'Consultations ce mois-ci',
    valeur: String(ceMois),
    /* ═══ PAS DE POURCENTAGE SUR DE PETITS NOMBRES ═══

       Passer de 3 à 2 donne « −33 % », ce qui dit surtout que les nombres sont
       petits. En dessous de dix, on annonce l'écart en clair.

       Et le mois en cours n'est pas fini : le comparer au mois précédent
       complet est toujours défavorable. La note le dit plutôt que de laisser
       croire à une chute. */
    note: compareAuMoisPrecedent(ceMois, moisPrec),
    tendance: moisPrec ? (ceMois > moisPrec ? 1 : ceMois < moisPrec ? -1 : 0) : null,
  }))

  /* ─── LES ANALYSES VIDÉO IA ───────────────────────────────────────────────

     `etatAbo.analyses` vient de `reste_analyses`, qui ne consomme rien. Si la
     migration n'est pas passée, il vaut `null` : on dit alors ce qu'on sait,
     sans inventer de plafond. */
  const q = etatAbo?.analyses || null
  const quota = q ? Number(q.quota || 0) : 0
  const reste = q ? Number(q.reste || 0) : 0
  const utilisees = quota ? Math.max(0, quota - reste) : null

  zDuo.appendChild(chiffreAccueil({
    icone: 'ia',
    titre: 'Analyses vid\u00e9o IA ce mois-ci',
    valeur: quota ? `${utilisees} / ${quota}` : (utilisees != null ? String(utilisees) : '\u2014'),
    /* Le forfait n'est pas le même d'une offre à l'autre : sans cette phrase,
       un gérant qui voit « 12 / 30 » ne sait pas d'où sort le 30. */
    note: quota ? 'selon votre abonnement' : 'forfait non renseign\u00e9',
  }))

  /* ═══ ③ LES DEUX LISTES ══════════════════════════════════════════════════ */
  peindreListesAccueil()
}

/* ═══════════════════════════════════════════════════════════════════════════
   LA COMPARAISON AU MOIS PRÉCÉDENT

   Trois cas, trois phrases. Le pourcentage n'apparaît que lorsqu'il veut dire
   quelque chose — c'est-à-dire au-dessus de dix consultations le mois passé.
   ═══════════════════════════════════════════════════════════════════════════ */
function compareAuMoisPrecedent(actuel, precedent) {
  if (!precedent) return actuel ? 'premier mois avec des lectures' : 'rien de lu ce mois-ci'
  const ecart = actuel - precedent
  if (!ecart) return `comme le mois dernier \u00b7 ${precedent}`
  const signe = ecart > 0 ? '+' : '\u2212'
  const abs = Math.abs(ecart)
  if (precedent < 10) return `${signe}${abs} par rapport au mois dernier`
  return `${signe}${Math.round((abs / precedent) * 100)} % \u00b7 ${precedent} le mois dernier`
}

/* ═══════════════════════════════════════════════════════════════════════════
   L'ANNEAU DES PROCÉDURES EN LIGNE

   Le MÊME dessin que `anneauResume`, celui des blocs de la page Analyse :
   168 px de côté, un trait de 14, la valeur au centre et l'unité dessous. On
   apprend à lire un anneau une seule fois dans cette app.

   Deux différences, et une seule est visible :

     · IL N'A QUE DEUX PARTS — publié, pas publié — là où celui de l'Analyse en
       a autant que de dossiers. Une piste sombre pour le reste, un arc pour la
       part faite : c'est une progression, pas une répartition.

     · SA COULEUR EST CELLE DES DESSINS. `orLibre`, le dégradé relatif de
       #FEC64A à #EB5201, celui que portent toutes les icônes de l'app.

   ⚠ PAS `logoOrIc`. Ce dégradé-là est déclaré en `userSpaceOnUse` sur 24 × 24 :
     au-delà, tout reçoit la couleur de fin. Sur un anneau de 168 px, l'arc
     serait uniformément #EB5201 et le dégradé perdu.
   ═══════════════════════════════════════════════════════════════════════════ */
function anneauPublication(enLigne, total) {
  const T = 168, ep = 14, r = (T - ep) / 2, circ = 2 * Math.PI * r
  const pct = total ? Math.round((enLigne / total) * 100) : 0

  const bloc = document.createElement('div')
  /* ⚠ PAS DE CARTE AUTOUR. L'anneau n'est pas un bloc de plus : c'est le sujet
     de la page. Posé sur le fond, il se détache de tout ce qui suit, et les
     deux tuiles du dessous redeviennent ce qu'elles sont — des compléments. */
  bloc.className = 'ac-pub-bloc'

  /* La part dessinée s'arrête juste avant le tour complet quand tout est
     publié : un arc de 360° dont les bouts sont arrondis se recouvre
     lui-même et fait une bosse à midi. */
  const part = Math.min(circ * (pct / 100), circ - 0.1)

  /* ═══ LA PISTE GRISE N'APPARAÎT QU'À ZÉRO ═══

     Un anneau de progression porte d'ordinaire un cercle sombre sous son arc,
     pour montrer le chemin restant. Ici il ajoutait un second cercle complet
     derrière le premier : deux traits concentriques de même épaisseur, dont
     l'un ne dit rien.

     L'anneau de la page Analyse n'en a pas non plus — il ne dessine que ses
     parts. Celui-ci fait pareil.

     Reste le cas de zéro : sans arc ET sans piste, il n'y aurait plus rien à
     l'écran, et le chiffre flotterait au milieu du vide. La piste ne sert donc
     qu'à ça — dire qu'un anneau existe quand il est vide. */
  const piste = pct === 0
    ? `<circle cx="${T / 2}" cy="${T / 2}" r="${r}" fill="none"
               stroke="rgba(255,255,255,0.07)" stroke-width="${ep}"/>`
    : ''

  /* ⚠ À ZÉRO, AUCUN ARC N'EST DESSINÉ. Un `stroke-dasharray` de longueur nulle
     avec des bouts arrondis ne donne pas rien : il donne un POINT ambre à midi,
     du diamètre du trait. Mesuré à l'écran — on croit à une poussière sur la
     dalle. La piste grise suffit à dire que l'anneau est vide. */
  const arcSvg = pct === 0 ? '' : `
          <circle class="arc" cx="${T / 2}" cy="${T / 2}" r="${r}" fill="none"
                  stroke="url(#orLibre)" stroke-width="${ep}" stroke-linecap="round"
                  stroke-dasharray="${part} ${circ}" stroke-dashoffset="${circ}"/>`

  bloc.innerHTML = `
    <div class="an-resume ac-pub">
      <div class="an-resume-anneau">
        <svg width="${T}" height="${T}">
          ${piste}${arcSvg}
        </svg>
        <div class="an-resume-centre">
          <span class="v">${pct} %</span>
          <span class="u">${enLigne} sur ${total} en ligne</span>
        </div>
      </div>
      <div class="ac-pub-txt">${
        pct === 100 ? 'Toutes vos proc\u00e9dures sont accessibles \u00e0 votre \u00e9quipe.'
        : pct === 0 ? 'Aucune proc\u00e9dure n\u2019est encore visible par votre \u00e9quipe.'
        : `${total - enLigne} proc\u00e9dure${total - enLigne > 1 ? 's' : ''} rest${total - enLigne > 1 ? 'ent' : 'e'} en brouillon.`
      }</div>
    </div>`

  /* Le remplissage part de zéro et se dessine. Deux images d'attente : la
     première laisse le navigateur poser l'élément, la seconde déclenche la
     transition. Un seul `requestAnimationFrame` suffit sur ordinateur ; sur un
     téléphone qui compose plus lentement, la mesure et le changement tombaient
     dans la même image et la transition était ignorée. */
  const arc = bloc.querySelector('.arc')
  /* ⚠ IL PEUT NE PAS Y EN AVOIR. À zéro pour cent l'arc n'est pas dessiné du
     tout ; sans ce garde, l'accueil plantait sur `null.getBoundingClientRect`
     — et comme `peindreTuilesAccueil` est enveloppée dans un `try`, la page
     serait restée à moitié vide sans rien dire. */
  if (arc) {
    requestAnimationFrame(() => {
      arc.getBoundingClientRect()
      requestAnimationFrame(() => { arc.style.strokeDashoffset = '0' })
    })
  }
  return bloc
}

/* ═══════════════════════════════════════════════════════════════════════════
   UN CHIFFRE DU MOIS

   La matière des blocs d'Analyse — `an-bloc` — comme les anciennes tuiles. Ce
   qui change : la plaque d'icône passe en tête de ligne avec le titre, et le
   chiffre prend toute la largeur en dessous. Sur une demi-largeur d'écran, un
   titre et un nombre côte à côte se marchaient dessus.
   ═══════════════════════════════════════════════════════════════════════════ */
function chiffreAccueil({ icone, titre, valeur, note, tendance }) {
  const el = document.createElement('div')
  el.className = 'an-bloc ac-tuile ac-chiffre'
  el.innerHTML = `
    <div class="ac-ch-tete">
      ${iconeAccueil(icone)}
      <span class="ac-ch-t">${escapeHtml(titre)}</span>
    </div>
    <div class="ac-ch-v">${escapeHtml(valeur)}</div>
    ${note ? `<div class="ac-ch-n${
      tendance === 1 ? ' haut' : tendance === -1 ? ' bas' : ''
    }">${escapeHtml(note)}</div>` : ''}`
  return el
}

/* ═══════════════════════════════════════════════════════════════════════════
   LES DEUX LISTES DU BAS

   L'accueil montrait deux BOUTONS vers deux pages. Un bouton demande d'y aller
   pour savoir s'il s'y passe quelque chose ; trois lignes le disent tout de
   suite, et le lien reste pour le détail.

   Les mouvements demandent une requête — `collecterActivites` interroge
   `mouvements` et `demandes_acces`. La liste des procédures, elle, est déjà en
   mémoire : elle s'affiche sans attendre, et les mouvements arrivent après.
   Une page qui attend sa partie la plus lente pour tout montrer paraît lente
   en entier.
   ═══════════════════════════════════════════════════════════════════════════ */
function peindreListesAccueil() {
  const zone = document.getElementById('ac-listes')
  if (!zone) return

  const bloc = (id, titre, sous, action) => {
    const el = document.createElement('div')
    el.className = 'an-bloc ac-liste'
    el.innerHTML = `
      <button type="button" class="ac-liste-tete">
        <span class="ac-liste-t">${escapeHtml(titre)}</span>
        <span class="ac-liste-fl">${escapeHtml(sous)} \u203a</span>
      </button>
      <div class="ac-liste-co" id="${id}"></div>`
    el.querySelector('.ac-liste-tete').addEventListener('click', action)
    zone.appendChild(el)
    return el.querySelector('.ac-liste-co')
  }

  /* ─── LES DERNIÈRES PROCÉDURES ─────────────────────────────────────────── */
  const co1 = bloc('ac-l-procs', 'Derni\u00e8res proc\u00e9dures', 'Tout voir',
                   () => ouvrirRecentes())
  const recentes = (allGestionProcedures || [])
    .filter(p => p.statut !== 'traitement' && p.statut !== 'redaction')
    .slice(0, 3)

  co1.innerHTML = recentes.length ? recentes.map(p => `
    <button type="button" class="ac-l-lig" data-proc="${p.id}">
      <span class="co">
        <span class="nm">${escapeHtml(p.titre || 'Sans titre')}</span>
        <span class="st">${escapeHtml(p.categorie || 'Sans dossier')}</span>
      </span>
      ${p.publiee_le ? '' : '<span class="proc-brouillon">Brouillon</span>'}
      <span class="vl">${depuisQuandCourt(Date.parse(p.created_at))}</span>
    </button>`).join('')
    : '<div class="ac-l-rien">Aucune proc\u00e9dure pour l\u2019instant.</div>'

  co1.querySelectorAll('[data-proc]').forEach(b => {
    b.addEventListener('click', () => openAnalyse(b.dataset.proc))
  })

  /* ─── LES DERNIERS MOUVEMENTS ──────────────────────────────────────────── */
  const co2 = bloc('ac-l-mvts', 'Derniers mouvements', 'Tout voir',
                   () => ouvrirActivites())
  co2.innerHTML = '<div class="ac-l-rien">Chargement\u2026</div>'

  /* ⚠ ON REVÉRIFIE QUE LA ZONE EST TOUJOURS LÀ. Entre le départ de la requête
     et sa réponse, l'accueil a pu être repeint — changement d'établissement,
     déconnexion. Écrire dans un élément détaché ne lève aucune erreur : le
     texte part simplement dans le vide, et on cherche longtemps pourquoi la
     liste reste sur « Chargement ». */
  collecterActivites().then(faits => {
    if (!document.body.contains(co2)) return
    const trois = (faits || []).slice(0, 3)
    co2.innerHTML = trois.length ? trois.map(f => `
      <div class="ac-l-lig">
        <span class="act-ic act-${f.genre}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round">${ACT_DESSINS[f.genre]}</svg>
        </span>
        <span class="co">
          <span class="nm">${f.texte}</span>
          ${f.detail ? `<span class="st">${f.detail}</span>` : ''}
        </span>
        <span class="vl">${depuisQuandCourt(f.quand)}</span>
      </div>`).join('')
      : '<div class="ac-l-rien">Aucun mouvement ces derni\u00e8res semaines.</div>'
  }).catch(e => {
    if (!document.body.contains(co2)) return
    /* On dit que ça a échoué plutôt que de laisser « Chargement » indéfiniment.
       Une attente sans fin ressemble à une app cassée ; un message est une
       information. */
    co2.innerHTML = '<div class="ac-l-rien">Mouvements indisponibles.</div>'
    console.warn('[accueil] mouvements :', e?.message || e)
  })
}

/* ⚠ QUATRE FONCTIONS ONT ÉTÉ RETIRÉES ICI.

   `peindreRecentesAccueil`, `lancerAnneauQuota`, `tuileAccueil` et
   `tuileQuota` dessinaient les trois tuiles de l'ancien accueil et les deux
   boutons qui le fermaient. Plus rien ne les appelle depuis la refonte.

   Elles sont supprimées plutôt que laissées en place : ce fichier a déjà payé
   le prix des fonctions mortes — `openEditProcedure` et `ouvrirAnTemps` ont
   coûté des heures à qui croyait modifier un écran vivant.

   `iconeAccueil` et `AC_ICONES`, elles, RESTENT : `chiffreAccueil` s'en sert.
   `vignetteProcedure` aussi, pour la page des procédures récentes. */

/* ═══════════════════════════════════════════════════════════════════════════
   LA PAGE DES PROCÉDURES RÉCENTES

   Quinze jours, pas davantage.

   ─── « SUPPRIMÉ » VEUT DIRE « RETIRÉ DE CETTE LISTE » ───

   Les procédures plus anciennes disparaissent d'ICI, et de nulle part
   ailleurs : elles restent dans l'onglet Procédures, avec leurs étapes et
   leurs vidéos. Cette page est une fenêtre sur les deux dernières semaines,
   pas un dépôt d'où l'on efface.

   Il n'y a donc AUCUNE suppression en base. Si tu voulais réellement effacer
   des procédures passé un délai, ce serait un tout autre chantier — et je te
   le déconseillerais : une procédure écrite ne périme pas, elle sert
   justement d'année en année.
   ═══════════════════════════════════════════════════════════════════════════ */
const RECENTES_JOURS = 14

window.ouvrirRecentes = function () {
  showGestionScreen('p-recentes')
  const zone = document.getElementById('recentes-tout')
  if (!zone) return
  zone.innerHTML = ''

  const depuis = Date.now() - RECENTES_JOURS * 86400000
  const liste = (allGestionProcedures || [])
    .filter(p => p.statut !== 'traitement' && p.statut !== 'redaction')
    .filter(p => p.created_at && new Date(p.created_at).getTime() >= depuis)

  if (!liste.length) {
    zone.innerHTML = vide({
      dessin: NEANT_PROCEDURE,
      titre: 'Aucune procédure ces deux dernières semaines',
      phrase: 'Les procédures créées apparaissent ici pendant quinze jours. Les plus anciennes restent accessibles dans l\u2019onglet Procédures.',
    })
    return
  }

  liste.forEach(p => {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'an-bloc ac-rec'
    el.addEventListener('click', () => openAnalyse(p.id))

    const chemin = [p.categorie || 'Sans dossier', p.sous_categorie].filter(Boolean).join(' \u203a ')
    const n = p.etapes?.[0]?.count ?? 0
    /* La date en clair plutôt qu'un « il y a N jours » : sur quinze jours, on
       retient mieux « mardi 12 » qu'un compte à rebours. */
    const quand = new Date(p.created_at).toLocaleDateString('fr-FR',
      { weekday: 'long', day: 'numeric', month: 'long' })

    el.innerHTML = `
      <span class="ac-rec-vue">${vignetteProcedure(p)}</span>
      <span class="ac-rec-txt">
        <span class="ac-rec-t">${escapeHtml(p.titre || 'Sans titre')}</span>
        <span class="ac-rec-s">${escapeHtml(chemin)}${n ? ` \u00b7 ${n} \u00e9tape${n > 1 ? 's' : ''}` : ''}</span>
        <span class="ac-rec-d">${escapeHtml(quand)}</span>
      </span>
      <span class="ac-rec-fl">\u203a</span>`
    zone.appendChild(el)
    preparerVignetteVideo(el)
  })
}

function vignetteProcedure(p) {
  if (p.image_url) {
    return `<img src="${escapeHtml(p.image_url)}" alt="" loading="lazy">`
  }
  if (p.video_url) {
    /* ═══ POURQUOI `#t=0.1` NE SUFFIT PAS SUR IPHONE ═══

       Sur ordinateur, le fragment de temps dans l'adresse suffit : le
       navigateur télécharge l'en-tête et affiche l'image à cette seconde.

       Safari sur iOS l'ignore. Il charge les métadonnées — durée, dimensions —
       et laisse le cadre VIDE, jusqu'à ce qu'on lui demande explicitement une
       position. C'est pourquoi les vignettes ne s'affichaient pas chez toi
       alors que le dessin était correct.

       Le placement est donc forcé par le code, après `loadedmetadata`. Le
       `data-video` sert à retrouver l'élément une fois posé dans la page. */
    return `<video data-video src="${escapeHtml(p.video_url)}#t=0.1" preload="metadata"
                   muted playsinline></video>
            <span class="ac-rec-play">\u25B6</span>`
  }
  return `<span class="ac-rec-doc">
      <svg viewBox="0 0 24 24" fill="none" stroke="url(#acDegrade)" stroke-width="1.8"
           stroke-linejoin="round">
        <path d="M13.6 3H7.4A2 2 0 0 0 5.4 5v14a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8Z"/>
        <path d="M13.6 3v5h5"/>
      </svg>
    </span>`
}

/* ═══════════════════════════════════════════════════════════════════════════
   LES QUATRE DESSINS

   Même facture que les icônes de dossier et de procédure : `viewBox 0 0 24 24`,
   trait de 1,7, pas de remplissage, et le dégradé `logoOrIc` comme couleur de
   trait. Ce sont ces trois réglages, plus que le motif, qui font qu'une icône
   appartient à la même famille.

   ─── CE QUE CHACUNE DIT ───

   `document`  un feuillet avec son coin plié, et un plus : on en crée.
               C'est déjà l'icône du pied des cartes de dossier.
   `horloge`   un cadran et ses aiguilles. Le temps, sans métaphore.
   `equipe`    deux silhouettes, la seconde en retrait. Reprise de la carte
               « Espace Équipe » : on la reconnaît d'un écran à l'autre.
   La quatrième tuile ne figure pas ici : elle porte l'anneau de l'IA, repris
   de `.ia-fig` et figé. Voir `iconeAccueil`.
   ═══════════════════════════════════════════════════════════════════════════ */
const AC_ICONES = {
  document: `<path d="M13.4 3.2H7.6a2 2 0 0 0-2 2v13.6a2 2 0 0 0 2 2h6.2"/>
             <path d="M13.4 3.2v5h5"/>
             <path d="M18.4 21v-6.2M15.3 17.9h6.2" stroke-linecap="round"/>`,
  horloge:  `<circle cx="12" cy="12" r="8.6"/>
             <path d="M12 6.9V12l3.5 2.1" stroke-linecap="round"/>`,
  /* Deux silhouettes, la seconde en retrait. Le même dessin que la carte
     « Espace Équipe » de l'écran d'accueil — un employé qui reconnaît cette
     icône ailleurs dans l'app sait de quoi la tuile parle. */
  /* ═══ DEUX DESSINS POUR LES TUILES DE LIEN ═══

     Elles ne peuvent pas reprendre `document` et `equipe` : ce sont déjà les
     icônes des tuiles du haut, et deux plaques identiques sur le même écran
     feraient croire à une répétition.

     `pile`      trois feuillets empilés, décalés — une LISTE de procédures,
                 pas une procédure.
     `mouvement` deux flèches opposées — ce qui entre et ce qui sort. */
  pile:     `<rect x="7.4" y="3.2" width="12.4" height="15.6" rx="2"/>
             <path d="M15.6 21.4H6a2 2 0 0 1-2-2V7.6" stroke-opacity="0.5"/>`,
  mouvement:`<path d="M7.4 4.6v13.2M4.2 15l3.2 3.2 3.2-3.2" stroke-linecap="round"/>
             <path d="M16.6 19.4V6.2M13.4 9l3.2-3.2L19.8 9" stroke-linecap="round"
                   stroke-opacity="0.55"/>`,
  equipe:   `<path d="M15.6 20.2v-1.7a3.2 3.2 0 0 0-3.2-3.2H6.6a3.2 3.2 0 0 0-3.2 3.2v1.7"/>
             <circle cx="9.5" cy="7.8" r="3.2"/>
             <path d="M20.6 20.2v-1.7a3.2 3.2 0 0 0-2.4-3.1"/>
             <path d="M15.1 4.9a3.2 3.2 0 0 1 0 6.1"/>`,

  /* Une procédure OUVERTE : le feuillet, et la coche de celui qui l'a lue.
     C'est le même dessin que `ACT_DESSINS.lecture`, dans le journal des
     mouvements — la même chose comptée doit porter le même signe. */
  lecture:  `<path d="M13.4 3.2H7.6a2 2 0 0 0-2 2v13.6a2 2 0 0 0 2 2h8.8a2 2 0 0 0 2-2V8.2Z"/>
             <path d="M13.4 3.2v5h5"/>
             <path d="M8.9 15.6l2 2 4.2-4.6" stroke-linecap="round"/>`,

}

function iconeAccueil(cle) {
  /* ═══ L'ANNEAU IA, FIGÉ ═══

     La tuile des analyses ne porte pas un dessin au trait mais l'anneau de
     l'IA — celui qui tourne pendant une analyse, partout ailleurs dans l'app.
     C'est le signe que l'app emploie déjà pour dire « intelligence
     artificielle » ; en inventer un autre ici aurait fait deux vocabulaires.

     `ac-ia-fige` reprend `.ia-fig` sans ses deux animations. Un anneau qui
     tourne sur l'accueil promettrait un travail en cours alors que rien ne se
     passe — l'animation a un sens pendant une analyse, aucun sur un compteur. */
  if (cle === 'ia') {
    return `<span class="ac-ic"><span class="ia-fig ac-ia-fige"><span class="lum"></span></span></span>`
  }
  return `<span class="ac-ic">
    <svg viewBox="0 0 24 24" fill="none" stroke="url(#logoOrIc)" stroke-width="1.7"
         stroke-linejoin="round">${AC_ICONES[cle] || ''}</svg>
  </span>`
}


/* Un appui sur l'avatar ouvre le support, avec la même fenêtre que partout. */

// Capture la position actuelle de chaque carte (identifiée par data-key) avant de les réordonner
function captureCardPositions(containerEl) {
  const rects = new Map()
  containerEl.querySelectorAll('[data-key]').forEach(el => {
    rects.set(el.dataset.key, el.getBoundingClientRect())
  })
  return rects
}

// Fait "glisser/mélanger" chaque carte depuis son ancienne position vers sa nouvelle position
/* Ce qui a déjà joué son animation d'arrivée, pour ne pas la rejouer. Vidé au
   changement d'établissement : ce sont d'autres dossiers. */
let dejaEntre = new Set()

function playCardShuffle(containerEl, oldRects) {
  // Rien à faire au tout premier remplissage d'une liste : l'écran qui vient
  // de s'ouvrir joue déjà sa propre animation d'entrée. Superposer une
  // animation par carte par-dessus — chacune partant d'une opacité nulle et
  // d'un flou — laissait les cartes bloquées invisibles sur iPhone : deux
  // animations imbriquées avec `filter`, et Safari n'en démarrait qu'une.
  // Cette fonction ne sert donc plus qu'à ce pour quoi elle a été écrite :
  // faire glisser les cartes quand on change le tri.
  const premierRemplissage = oldRects.size === 0
  containerEl.querySelectorAll('[data-key]').forEach((el, i) => {
    const oldRect = oldRects.get(el.dataset.key)
    if (!oldRect) {
      /* « Pas de position précédente » ne veut pas dire « nouvelle » : la grille
         est vidée à chaque changement de page, et une dossier qui existe depuis
         des semaines se retrouvait donc sans passé à chaque retour. Elle rejouait
         son arrivée indéfiniment.

         On tient donc la liste de ce qui a DÉJÀ salué. Une carte n'entre qu'une
         fois, quel que soit le nombre d'allers-retours. */
      const deja = dejaEntre.has(el.dataset.key)
      dejaEntre.add(el.dataset.key)
      if (!deja && !premierRemplissage && !document.body.classList.contains('booting')) {
        el.classList.add('same-as-title-in')
        el.style.animationDelay = (i * 0.04) + 's'
      }
      return
    }
    const newRect = el.getBoundingClientRect()
    const dx = oldRect.left - newRect.left
    const dy = oldRect.top - newRect.top
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
    el.style.zIndex = 5
    el.style.transition = 'none'
    el.style.transform = `translate(${dx}px, ${dy}px)`

    // Filet de sécurité : si l'animation ne démarre pas (onglet en arrière-plan,
    // écran en cours de transition sur iPhone...), on remet la carte à sa vraie
    // place au bout de 700 ms. Sans ça, les cartes restent figées à leur ancienne
    // position et le tri semble ne rien faire alors qu'il a bien eu lieu.
    const cleanup = () => {
      el.style.zIndex = ''
      el.style.transition = ''
      el.style.transform = ''
    }
    const safety = setTimeout(cleanup, 700)

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = 'transform 0.5s cubic-bezier(0.22,1,0.36,1)'
        el.style.transform = ''
        el.addEventListener('transitionend', () => { clearTimeout(safety); cleanup() }, { once: true })
      })
    })
  })
}

/* Cale l'état vide entre ce qui le précède et la barre d'onglets, quelle que
   soit la taille de l'écran. Sans ça, le dessin flottait trop haut sur grand
   écran et se retrouvait sous la barre sur petit. */
/* `ajusterHauteurDebut` et sa surveillance ont été retirées : la hauteur du
   bloc d'accueil est désormais déduite par le CSS (`:has()` + flex). Mesurer
   puis poser une valeur ne pouvait pas être instantané — il y avait toujours
   une image où la valeur de repli s'appliquait. */


function renderCategoryGrid() {
  const catGridEl = document.getElementById('cat-grid')
  const oldRects = captureCardPositions(catGridEl)
  catGridEl.innerHTML = ''

  /* Le compte de la page. On l'écrit ici plutôt qu'ailleurs : c'est la fonction
     qui connaît déjà les deux nombres, et les tenir à jour depuis deux endroits
     est le meilleur moyen qu'ils finissent par diverger. */
  const compte = document.getElementById('proc-compte')
  if (compte) {
    const nbP = (allGestionProcedures || []).length
    const nbC = new Set((allGestionProcedures || [])
      .map(p => (p.categorie || '').trim()).filter(Boolean)).size
    compte.textContent = nbP
      ? `${nbP} procédure${nbP > 1 ? 's' : ''} \u00b7 ${nbC} dossier${nbC > 1 ? 's' : ''}`
      : 'Aucune procédure pour le moment'
  }

  // Départage systématique par ordre alphabétique : sans ça, deux dossiers
  // dont les procédures ont été créées à la même seconde restaient dans
  // l'ordre où la base les avait renvoyées, et changer de tri ne bougeait
  // rien à l'écran — le filtre semblait cassé alors qu'il tournait bien.
  const parNom = (a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' })
  const sorted = [...allCategoriesData].sort((a, b) => {
    if (currentCatSort === 'new') return (b.latestDate - a.latestDate) || parNom(a, b)
    if (currentCatSort === 'old') return (a.earliestDate - b.earliestDate) || parNom(a, b)
    return parNom(a, b)
  })

  const triParDate = currentCatSort === 'new' || currentCatSort === 'old'
  sorted.forEach(({ nom, icone, procsInCat, avgPct, latestDate, earliestDate }) => {
    const recentTitles = procsInCat.slice(0, 3)

    const cell = document.createElement('div')
    cell.className = 'cat-cell'
    cell.dataset.key = nom
    /* Le dossier vit dans une pastille teintée, et la carte se termine par une
       ligne d'appel : combien de procédures, et un chevron qui dit qu'on entre.
       Sans elle, rien n'indiquait que la carte s'ouvrait. */
    cell.innerHTML = `
      <div class="cat-top">
        <span class="cat-ic">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M3 7.4a2 2 0 0 1 2-2h4.2l2 2.4h7.8a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"
                  stroke="url(#logoOrIc)" stroke-width="1.7" stroke-linejoin="round"/>
            <line x1="3" y1="10.6" x2="21" y2="10.6" stroke="url(#logoOrIc)" stroke-opacity="0.5" stroke-width="1.5"/>
          </svg>
        </span>
      </div>
      <div class="cat-name"><span class="txt">${escapeHtml(nom)}</span></div>
      <div class="cat-recent">
        ${recentTitles.map(p => `<div class="cat-recent-item" data-proc="${p.id}"><span class="txt">${escapeHtml(p.titre)}</span>${etatProcedureHtml(p)}</div>`).join('')}
      </div>
      <div class="cat-pied">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M13.6 3H7.4A2 2 0 0 0 5.4 5v14a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8Z"
                stroke="url(#logoOrIc)" stroke-width="1.8" stroke-linejoin="round"/>
          <path d="M13.6 3v5h5" stroke="url(#logoOrIc)" stroke-width="1.8" stroke-linejoin="round"/>
        </svg>
        <span>${procsInCat.length} procédure${procsInCat.length > 1 ? 's' : ''}</span>
        <span class="fl">›</span>
      </div>
    `
    /* Sur la carte d'une dossier, un titre en panne mène directement à la
       reprise : sinon il faudrait ouvrir la dossier pour s'en apercevoir. */
    cell.onclick = (e) => {
      /* ═══ TOUTE LA CARTE OUVRE LE DOSSIER ═══

         J'avais fait l'inverse ce matin : toucher un nom ouvrait la procédure.
         C'était une erreur de raisonnement. Le défaut que je cherchais était
         la coche de fin d'analyse qui ne s'éteignait jamais — elle ne s'efface
         qu'à l'ouverture réelle d'une procédure, et ce chemin n'en ouvrait
         aucune. J'ai traité le symptôme en changeant la navigation, au lieu de
         traiter la cause.

         La carte est un DOSSIER. Les trois titres qu'elle montre sont un
         aperçu de son contenu, pas un menu : ils disent ce qu'il y a dedans,
         ils ne prétendent pas y mener directement. Rendre une partie de la
         carte cliquable autrement que le reste crée deux comportements sur un
         même objet, et on ne sait plus où l'on va sans viser.

         Le cas de l'échec reste à part : une analyse en panne se reprend là où
         on la voit, sinon il faut deviner qu'il faut d'abord ouvrir le dossier.
         C'est une réparation, pas une navigation. */
      const ligne = e.target.closest('.cat-recent-item')
      if (ligne) {
        const p = procsInCat.find(x => x.id === ligne.dataset.proc)
        if (p && (p.statut === 'echec' || analyseBloquee(p))) { proposerReprise(p); return }
      }
      openCategoryProcedures(nom)
    }
    catGridEl.appendChild(cell)
  })

  playCardShuffle(catGridEl, oldRects)
  garantirVisibilite(catGridEl)

  /* Seules les nouveautés s'animent. */
  marquerLesNeufs(document.querySelector('.screen.active') || document.body,
                  'renderCategoryGrid', '.cat-cell')
}

// Un seul gestionnaire pour tous les menus « Trier », posé sur le document.
// Aucun risque qu'un menu ne soit pas branché ou perde son écouteur.
const sortHandlers = {}

function wireSortDropdown(prefix, onSelect) {
  sortHandlers[prefix] = onSelect
}

function closeAllDropdowns() {
  document.querySelectorAll('.dd-menu.open').forEach(m => m.classList.remove('open'))
  document.querySelectorAll('.dd-trigger.open').forEach(t => t.classList.remove('open'))
}

// Applique visuellement un tri à un menu donné (libellé + option cochée)
function setSortUI(prefix, sortValue) {
  const menu = document.getElementById(prefix + '-menu')
  const label = document.getElementById(prefix + '-label')
  if (!menu || !label) return
  menu.querySelectorAll('button').forEach(b => {
    const isIt = b.dataset.sort === sortValue
    b.classList.toggle('selected', isIt)
    if (isIt) label.textContent = b.dataset.label
  })
}

document.addEventListener('click', (e) => {
  const trigger = e.target.closest('.dd-trigger')
  if (trigger) {
    const filter = trigger.closest('.dd-filter')
    const menu = filter?.querySelector('.dd-menu')
    if (!menu) return
    const wasOpen = menu.classList.contains('open')
    closeAllDropdowns()
    if (!wasOpen) { menu.classList.add('open'); trigger.classList.add('open') }
    e.stopPropagation()
    return
  }

  /* ═══ LE FILTRE DE PÉRIODE DE L'ACCUEIL ═══

     Il partage l'ouverture et la fermeture avec les menus de tri — c'est le
     même geste, il doit répondre pareil. Seul le choix diffère : `data-periode`
     au lieu de `data-sort`, et il redessine les tuiles plutôt que la liste. */
  /* Le filtre de la courbe. Même mécanique que les autres menus : l'ouverture
     est commune, seul le choix diffère. */
  const cb = e.target.closest('.dd-menu button[data-courbe]')
  if (cb) {
    courbePeriode = cb.dataset.courbe
    /* L'animation rejoue à chaque changement de période : la courbe est
       entièrement redessinée, et la voir se tracer confirme que le réglage a
       bien été pris. */
    courbeDejaJouee = false
    closeAllDropdowns()
    renderCourbe(currentGaData?.validations || cachedValidations, cachedMembres)
    e.stopPropagation()
    return
  }

  /* L'écouteur du filtre d'accueil a été retiré avec le filtre lui-même.
     `accueilPeriode` est désormais une constante. */

  const option = e.target.closest('.dd-menu button[data-sort]')
  if (option) {
    const filter = option.closest('.dd-filter')
    const prefix = filter?.id
    closeAllDropdowns()
    if (prefix) {
      setSortUI(prefix, option.dataset.sort)
      try {
        sortHandlers[prefix]?.(option.dataset.sort)
      } catch (err) {
        console.error(`[Standix] Erreur au tri "${prefix}" :`, err)
      }
    }
    e.stopPropagation()
    return
  }

  closeAllDropdowns()
})

wireSortDropdown('dd-cat-sort', (sort) => { currentCatSort = sort; renderCategoryGrid() })

/* Les deux tris de l'espace équipe, sur le même mécanisme que ceux de la
   gestion : un seul endroit décide de ce qu'un menu de tri fait. */
wireSortDropdown('dd-e-cat-sort', (sort) => { equipeCatSort = sort; renderEquipeCategories() })
wireSortDropdown('dd-e-proc-sort', (sort) => { equipeProcSort = sort; renderEquipeCatListe() })

wireSortDropdown('dd-membres-sort', (valeur) => {
  triMembres = valeur
  const libelles = {
    actifs: 'les plus actifs', inactifs: 'les moins actifs',
    az: 'nom A → Z', recents: 'arrivés récemment',
  }
  const lbl = document.querySelector('#dd-membres-sort .dd-label')
  if (lbl) lbl.textContent = 'Trier : ' + (libelles[valeur] || valeur)
  renderMembresListe()
})


// Texte tapé dans la recherche de l'écran d'une dossier
let currentCategoryQuery = ''

document.getElementById('category-search-input')?.addEventListener('input', (e) => {
  currentCategoryQuery = e.target.value.trim().toLowerCase()
  renderCategoryProceduresList()
})

let currentCategorySort = 'az'
wireSortDropdown('dd-category-sort', (sort) => { currentCategorySort = sort; renderCategoryProceduresList() })

let currentCategoryProcsData = []

/* ═══ OÙ L'ON SE TROUVE DANS L'ARBRE ═══

   `null` : on est dans le dossier, on voit ses sous-dossiers et ses procédures
   non rangées. Une chaîne : on est DANS ce sous-dossier, on ne voit que son
   contenu.

   On réemploie l'écran `p-category` plutôt que d'en créer un second. Les deux
   vues montrent la même chose — un titre, une recherche, un tri, une liste — et
   deux écrans jumeaux auraient signifié deux boutons retour, deux recherches,
   deux tris à maintenir en parallèle. C'est exactement ce qui a produit le
   retour de modification qui menait au mauvais endroit. */
let sousDossierCourant = null
/* Le nom du DOSSIER, gardé à part : quand on entre dans un sous-dossier,
   le titre affiche ce dernier et ne peut plus servir de source. */
let dossierCourantNom = ''
let toutesProcedures = false   // vrai quand on affiche toutes les procédures

function openCategoryProcedures(nom) {
  try { ouvrirCategorie(nom) }
  catch (e) {
    console.error('Ouverture de la dossier :', e)
    showGestionScreen('p-category')
    const el = document.getElementById('category-procedures-list')
    if (el) el.innerHTML = `<div class="empty-state"><h3>Ouverture impossible</h3><p>${escapeHtml((e && e.message) || 'erreur inconnue')}</p></div>`
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   RENOMMER UNE CATÉGORIE

   La dossier n'est pas une table : c'est une colonne de texte sur chaque
   procédure. La renommer, c'est réécrire ce texte sur toutes celles qui la
   portent — d'un seul appel, filtré sur l'ancien nom.

   Conséquence à connaître : deux dossiers fusionnent si on donne à l'une le
   nom de l'autre. C'est cohérent avec ce qu'est une dossier ici, et c'est même
   le seul moyen de les regrouper. On prévient donc au lieu d'interdire.
   ═══════════════════════════════════════════════════════════════════════════ */

document.getElementById('cat-renommer')?.addEventListener('click', async () => {
  /* Le nom courant se lit dans le titre : c'est la seule source de vérité, la
     page ne le garde nulle part ailleurs. */
  const ancien = (document.getElementById('category-titre')?.textContent || '').trim()
  if (!ancien || toutesProcedures) return

  const nouveau = await demanderTexte({
    titre: 'Renommer la cat\u00e9gorie',
    message: `Toutes les proc\u00e9dures class\u00e9es dans \u00ab ${ancien} \u00bb suivront.`,
    valeur: ancien,
    placeholder: 'Nom de la cat\u00e9gorie',
    confirmer: 'Renommer',
  })
  if (!nouveau || nouveau === ancien) return

  // Une dossier de ce nom existe déjà : on le dit, on ne l'empêche pas.
  const existe = allGestionProcedures.some(p =>
    (p.categorie || '').toLowerCase() === nouveau.toLowerCase())
  if (existe) {
    const ok = await confirmDialog({
      titre: `Fusionner avec ${nouveau} ?`,
      message: `Une cat\u00e9gorie \u00ab ${nouveau} \u00bb existe d\u00e9j\u00e0. Les proc\u00e9dures de \u00ab ${ancien} \u00bb ` +
        `la rejoindront, et \u00ab ${ancien} \u00bb dispara\u00eetra.`,
      confirmer: 'Fusionner', annuler: 'Annuler', danger: false,
    })
    if (!ok) return
  }

  const { data, error } = await supabase.from('procedures')
    .update({ categorie: nouveau })
    .eq('entreprise_id', currentMembre.entreprise_id)
    .eq('categorie', ancien)
    .select('id')

  if (error) { toast('\u00c9chec : ' + error.message); return }
  if (!data || !data.length) { toast('La base a refus\u00e9 la modification.'); return }

  document.getElementById('category-titre').textContent = nouveau
  /* On recharge : les regroupements par dossier sont construits au chargement,
     et c'est le seul endroit qui les construit. */
  await loadGestionProcedures()
  ouvrirCategorie(nouveau)
  toast(`${data.length} proc\u00e9dure${data.length > 1 ? 's' : ''} reclass\u00e9e${data.length > 1 ? 's' : ''}.`)
})

function ouvrirCategorie(nom) {
  toutesProcedures = (nom == null)
  showGestionScreen('p-category')
  document.getElementById('category-titre').textContent = toutesProcedures ? 'Toutes les procédures' : nom
  /* Rien à renommer quand on regarde tout : « Toutes les procédures » n'est pas
     une dossier, c'est une vue. */
  const btnRenommer = document.getElementById('cat-renommer')
  if (btnRenommer) btnRenommer.style.display = toutesProcedures ? 'none' : 'flex'
  document.getElementById('category-search-input').value = ''
  document.getElementById('category-search-input').placeholder = toutesProcedures
    ? 'Rechercher parmi toutes les procédures...'
    : 'Rechercher une procédure...'
  currentCategoryQuery = ''
  setSortUI('dd-category-sort', currentCategorySort)
  const listEl = document.getElementById('category-procedures-list')
  listEl.innerHTML = ''

  /* Entrer dans un dossier ferme le sous-dossier où l'on était : sinon, ouvrir
     « Salle » après « Cuisine › Friteuse » afficherait une liste vide, et rien
     ne dirait pourquoi. */
  sousDossierCourant = null
  dossierCourantNom = nom
  const procsInCategory = toutesProcedures
    ? allGestionProcedures
    : allGestionProcedures.filter(p => (p.categorie || 'Sans dossier') === nom)
  const nbCat = new Set(allGestionProcedures.map(p => p.categorie || 'Sans dossier')).size
  document.getElementById('category-subhead').textContent = toutesProcedures
    ? `${procsInCategory.length} procédure${procsInCategory.length > 1 ? 's' : ''} · ${nbCat} dossier${nbCat > 1 ? 's' : ''}`
    : `${procsInCategory.length} procédure${procsInCategory.length > 1 ? 's' : ''}`

  // Tout est déjà en mémoire (préchargé au démarrage) : affichage instantané, zéro attente réseau.
  const nbEmployes = cachedEmployes.length
  const validationCountByProc = {}
  cachedValidations.forEach(v => { validationCountByProc[v.procedure_id] = (validationCountByProc[v.procedure_id] || 0) + 1 })

  currentCategoryProcsData = []
  for (const proc of procsInCategory) {
    const nbValidations = validationCountByProc[proc.id] || 0
    const nbEtapes = proc.etapes?.[0]?.count ?? 0
    const pct = nbEmployes > 0 ? Math.round(Math.min(1, nbValidations / nbEmployes) * 100) : 0
    currentCategoryProcsData.push({ proc, nbEtapes, pct, createdAt: new Date(proc.created_at).getTime() })
  }

  renderCategoryProceduresList()
}

function renderCategoryProceduresList() {
  try { renderCategoryProceduresListInterne() }
  catch (e) {
    // Plutôt qu'une liste vide sans explication, on affiche ce qui a échoué.
    console.error('Rendu de la liste des procédures :', e)
    const el = document.getElementById('category-procedures-list')
    if (el) el.innerHTML = `<div class="empty-state"><h3>Affichage impossible</h3><p>${escapeHtml((e && e.message) || 'erreur inconnue')}</p></div>`
  }

  /* Seules les nouveautés s'animent. */
  marquerLesNeufs(document.querySelector('.screen.active') || document.body,
                  'renderCategoryProceduresList', '.sop-card, .proc-rich-card')
}

function renderCategoryProceduresListInterne() {
  const listEl = document.getElementById('category-procedures-list')
  const oldRects = captureCardPositions(listEl)
  listEl.innerHTML = ''

  /* ═══ DANS UN SOUS-DOSSIER, ON NE VOIT QUE LUI ═══

     Le filtre s'applique AVANT la recherche : chercher « caisse » depuis
     l'intérieur de « Friteuse » ne doit pas ramener toute la cuisine. */
  const dansLaVue = sousDossierCourant
    ? currentCategoryProcsData.filter(d => (d.proc.sous_categorie || '').trim() === sousDossierCourant)
    : currentCategoryProcsData

  const filtered = currentCategoryQuery
    ? dansLaVue.filter(d => {
        const titre = (d.proc.titre || '').toLowerCase()
        // En vue globale, on peut aussi chercher par nom de dossier
        const cat = toutesProcedures ? (d.proc.categorie || 'sans dossier').toLowerCase() : ''
        /* Le sous-dossier est cherchable partout, pas seulement en vue globale :
           dans un dossier, taper « friteuse » doit ramener son contenu — c'est
           même le premier réflexe une fois qu'on s'est mis à ranger. */
        const sous = (d.proc.sous_categorie || '').toLowerCase()
        return titre.includes(currentCategoryQuery)
            || (cat && cat.includes(currentCategoryQuery))
            || (sous && sous.includes(currentCategoryQuery))
      })
    : dansLaVue

  const parTitre = (a, b) => (a.proc.titre || '').localeCompare(b.proc.titre || '', 'fr', { sensitivity: 'base' })
  const sorted = [...filtered].sort((a, b) => {
    if (currentCategorySort === 'new') return (b.createdAt - a.createdAt) || parTitre(a, b)
    if (currentCategorySort === 'old') return (a.createdAt - b.createdAt) || parTitre(a, b)
    return parTitre(a, b)
  })

  /* ═══════════════════════════════════════════════════════════════════════
     D'ABORD LES SOUS-DOSSIERS, ENSUITE LES PROCÉDURES
     ═══════════════════════════════════════════════════════════════════════

     Les intertitres sont remplacés par de vraies cartes, deux par deux, en
     haut de la page. On les voit d'un coup d'œil avant de descendre dans la
     liste — c'est ce qu'on attend d'un dossier ouvert.

     TROIS CAS OÙ ILS NE S'AFFICHENT PAS :

     ① Quand on est DÉJÀ dans un sous-dossier. Il n'y a pas de troisième
        niveau, et en montrer un serait promettre ce qui n'existe pas.
     ② Pendant une recherche. On cherche des procédures, pas des rangements ;
        des cartes en tête repousseraient les résultats hors de l'écran.
     ③ En vue globale, où les dossiers ne sont plus la structure d'affichage.

     Dans ces trois cas la liste est plate — exactement ce qu'elle était avant
     ce chantier. */
  const montrerSousDossiers = !sousDossierCourant && !currentCategoryQuery && !toutesProcedures

  if (montrerSousDossiers) {
    const groupes = new Map()
    for (const d of sorted) {
      const sd = (d.proc.sous_categorie || '').trim()
      if (!sd) continue
      if (!groupes.has(sd)) groupes.set(sd, [])
      groupes.get(sd).push(d.proc)
    }
    if (groupes.size) {
      /* Par ordre alphabétique, quel que soit le tri des procédures : on
         cherche un rangement par son nom, pas par sa date. */
      const noms = [...groupes.keys()].sort((a, b) =>
        a.localeCompare(b, 'fr', { sensitivity: 'base' }))
      const grille = document.createElement('div')
      grille.className = 'sd-grille'
      noms.forEach(n => grille.appendChild(carteSousDossier(n, groupes.get(n))))
      listEl.appendChild(grille)
    }
  }

  /* Dans un sous-dossier : ses procédures. Dans un dossier : seulement celles
     qui ne sont rangées nulle part — les autres sont déjà accessibles par leur
     carte, et les répéter doublerait la liste. */
  const avecGroupes = montrerSousDossiers
    ? sorted.filter(d => !(d.proc.sous_categorie || '').trim())
    : sorted

  for (const entree of avecGroupes) {
    /* Un intertitre n'est pas une carte : il se dessine et on passe à la
       suivante. Le mettre dans la même boucle garde l'ordre sans avoir à
       reconstruire la liste en deux passes. */
    const { proc, nbEtapes, pct } = entree
    const ringColor = pct >= 70 ? '#30D158' : pct >= 30 ? '#FA8A08' : '#FF453A'
    const circumference = 2 * Math.PI * 20
    const dashoffset = circumference * (1 - pct / 100)

    const enPanne = proc.statut === 'echec' || analyseBloquee(proc)
    // `redaction` est l'étape où l'IA met en forme les étapes : c'est encore une
    // analyse en cours, et la carte doit le dire.
    const enAnalyse = proc.statut === 'traitement' || proc.statut === 'redaction'
    const div = document.createElement('div')
    // Toutes les cartes restent cliquables : une analyse en cours mène à une
    // fenêtre où l'on peut l'abandonner, une analyse en panne à sa reprise.
    div.className = 'card proc-rich-card' + (enAnalyse && !enPanne ? ' proc-en-cours-doux' : '')
    div.dataset.key = proc.id
    div.onclick = () =>
      enPanne ? proposerReprise(proc) :
      enAnalyse ? proposerAbandon(proc) :
      openAnalyse(proc.id)
    /* La même grammaire que la dossier : plaque à gauche, nom, filet, pied.
       Le pied dit ici le suivi de lecture — la seule chose qu'un gérant vient
       vérifier sur cette page. */
    /* ═══ LE SOUS-DOSSIER DANS LE PIED DE CARTE ═══

       Il n'y figure QUE pendant une recherche ou en vue globale — c'est-à-dire
       quand les intertitres ne sont pas là pour le dire.

       Sous son intertitre, le répéter sur chaque carte serait du bruit : on
       vient de lire « Friteuse » deux centimètres plus haut. Mais dans une
       liste de résultats, une procédure sans son rangement laisse la personne
       se demander d'où elle sort. */
    const montrerSous = (currentCategoryQuery || toutesProcedures) && proc.sous_categorie
    const detail = [
      `${nbEtapes} étape${nbEtapes > 1 ? 's' : ''}`,
      toutesProcedures ? escapeHtml(proc.categorie || 'Sans dossier') : '',
      montrerSous ? escapeHtml(proc.sous_categorie) : '',
    ].filter(Boolean).join(' \u00b7 ')

    div.innerHTML = `
      <div class="proc-tete">
        <span class="cat-ic">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M13.6 3H7.4A2 2 0 0 0 5.4 5v14a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8Z"
                  stroke="url(#logoOrIc)" stroke-width="1.7" stroke-linejoin="round"/>
            <path d="M13.6 3v5h5" stroke="url(#logoOrIc)" stroke-width="1.7" stroke-linejoin="round"/>
            <line x1="8.6" y1="12.6" x2="15.4" y2="12.6" stroke="url(#logoOrIc)" stroke-opacity="0.5"
                  stroke-width="1.6" stroke-linecap="round"/>
            <line x1="8.6" y1="16.4" x2="13" y2="16.4" stroke="url(#logoOrIc)" stroke-opacity="0.5"
                  stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </span>
        <span class="proc-co">
          <span class="proc-nom"><span class="txt">${escapeHtml(proc.titre)}</span>${etatProcedureHtml(proc)}</span>
          <span class="proc-meta">${detail}</span>
        </span>
        <span class="proc-fl">\u203a</span>
      </div>
      <div class="proc-pied">
        <span class="proc-jauge"><i style="width:${pct}%; background:${ringColor}"></i></span>
        <span class="proc-taux" style="color:${ringColor};">${pct} %<em> ont lu</em></span>
      </div>
    `
    listEl.appendChild(div)
  }

  if (sorted.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><h3>Aucun résultat</h3><p>Aucune procédure ne correspond à « ${escapeHtml(currentCategoryQuery)} ».</p></div>`
    return
  }

  playCardShuffle(listEl, oldRects)
  garantirVisibilite(listEl)

  // Dernier contrôle : si malgré tout rien n'est arrivé dans la liste alors
  // qu'on avait des procédures, on le dit au lieu de laisser un écran vide.
  if (listEl.children.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><h3>Rien à afficher</h3><p>${sorted.length} procédure(s) trouvée(s) mais aucune n'a pu être affichée. Signalez-le-moi.</p></div>`
  }
}

/* Dernier rempart : au bout d'une seconde, toute carte encore transparente ou
   floutée à cause d'une animation qui n'a pas démarré est remise à l'état
   normal. Une liste vide à l'écran est le pire des défauts — mieux vaut perdre
   une animation que perdre le contenu. */
function garantirVisibilite(containerEl) {
  setTimeout(() => {
    containerEl.querySelectorAll('[data-key]').forEach(el => {
      const style = getComputedStyle(el)
      if (parseFloat(style.opacity) < 0.9) {
        el.classList.remove('same-as-title-in')
        el.style.animationDelay = ''
        el.style.opacity = ''
        el.style.filter = ''
        el.style.transform = ''
      }
    })
  }, 1000)
}

// ═══════════ GESTION : création ═══════════
function resetCreateForm() {
  champManuel('titre').value = ''
  champManuel('categorie').value = ''
  document.getElementById('video-input').value = ''
  document.getElementById('video-player').style.display = 'none'
  document.getElementById('video-placeholder').style.display = 'flex'
  /* Les commandes de lecture suivent la vidéo : sans image, il n'y a rien à
     mettre en pause, et un bouton qui ne fait rien fait douter du reste. */
  const _cmd = document.getElementById('dv-cmd')
  if (_cmd) _cmd.style.display = 'none'
  document.getElementById('dv-travail').style.display = 'none'
  document.getElementById('create-error-manual').textContent = ''
  document.getElementById('create-error-video').textContent = ''
  manualSteps = []
  videoSteps = []
  currentVideoFile = null
  reinitialiserCouverture(null)
  renderManualSteps()
  renderVideoSteps()
  updateModeCardsState()
}

function updateModeCardsState() {
  const titre = champManuel('titre').value.trim()
  const categorie = champManuel('categorie').value.trim()
  const isReady = titre.length > 0 && categorie.length > 0
  document.querySelectorAll('.mode-choice-card').forEach(card => card.classList.toggle('disabled', !isReady))
  document.getElementById('mode-choice-note').style.display = isReady ? 'none' : 'block'
}
/* On écoute les QUATRE champs, pas seulement ceux que `champManuel` désigne à
   cet instant : cette fonction préfère le champ déjà rempli, donc au chargement
   elle renvoyait celui de la page des étapes — l'écouteur se posait sur un champ
   qu'on ne remplit jamais ici, et les quatre modes restaient verrouillés. */
;['new-titre', 'new-categorie', 'man-titre', 'man-categorie', ].forEach(id => {
  document.getElementById(id)?.addEventListener('input', updateModeCardsState)
})

/* ═══════════════════════════════════════════════════════════════════════════
   UNE SEULE PAGE POUR CRÉER ET POUR MODIFIER

   `manEdition` porte l'identifiant de la procédure en cours de modification, ou
   `null` en création. Tout le reste de l'écran s'y adapte : le titre, le bouton
   du bas, ce que fait « Annuler ».

   L'intérêt n'est pas d'économiser du code, c'est qu'il n'existe plus qu'UNE
   façon d'écrire une procédure. Deux écrans qui font la même chose finissent
   toujours par diverger — l'un reçoit une amélioration, l'autre non.
   ═══════════════════════════════════════════════════════════════════════════ */

let manEdition = null      // identifiant de la procédure modifiée, ou null
let manDepart = null       // copie de l'état enregistré, pour pouvoir revenir

window.ouvrirEtapesManuelles = async function(procId) {
  manEdition = procId || null
  showGestionScreen('p-create-manual')

  const el = (i) => document.getElementById(i)
  el('man-titre-page').textContent = manEdition ? 'Modifier la proc\u00e9dure' : '\u00c9tapes manuelles'
  el('man-sous').textContent = manEdition
    ? 'Vos changements ne partent qu\'\u00e0 l\'enregistrement'
    : '\u00c9crivez chaque \u00e9tape dans l\'ordre'
  el('publish-btn-manual').textContent = manEdition
    ? 'Enregistrer les modifications' : 'Publier la proc\u00e9dure'
  el('man-annuler').textContent = manEdition
    ? 'Annuler les modifications' : 'Tout effacer'
  el('create-error-manual').textContent = ''
  el('man-entete').style.display = manEdition ? 'block' : 'none'

  if (!manEdition) {
    /* En création, on reprend ce qui a été saisi sur l'écran précédent. */
    el('man-titre').value = document.getElementById('new-titre')?.value || ''
    el('man-categorie').value = document.getElementById('new-categorie')?.value || ''
    el('man-sous-categorie').value = document.getElementById('new-sous-categorie')?.value || ''
    if (!manualSteps.length) manualSteps = [{ texte: '' }]
    reinitialiserCouverture(null)
    manDepart = etatManuel()
    renderManualSteps()
    return
  }

  el('man-titre').value = '\u2014'
  manualSteps = []
  renderManualSteps()

  const [{ data: proc }, { data: etapes }] = await Promise.all([
    supabase.from('procedures').select('*').eq('id', procId).single(),
    supabase.from('etapes').select('*').eq('procedure_id', procId).order('ordre'),
  ])
  if (!proc) { el('create-error-manual').textContent = 'Proc\u00e9dure introuvable.'; return }

  el('man-titre').value = proc.titre || ''
  el('man-categorie').value = proc.categorie || ''
  el('man-sous-categorie').value = proc.sous_categorie || ''
  reinitialiserCouverture(proc.image_url || null)
  manualSteps = (etapes || []).map(e => ({
    id: e.id, texte: e.texte || '', image_url: e.image_url || null,
  }))
  if (!manualSteps.length) manualSteps = [{ texte: '' }]

  manDepart = etatManuel()
  renderManualSteps()
}

/* Une empreinte de l'état, pour savoir où revenir. */
function etatManuel() {
  return JSON.stringify({
    titre: document.getElementById('man-titre')?.value || '',
    categorie: document.getElementById('man-categorie')?.value || '',
    sous_categorie: lireSousDossier('man-sous-categorie'),
    etapes: manualSteps.map(s => ({ id: s.id || null, texte: s.texte, image_url: s.image_url || null })),
  })
}

document.getElementById('man-annuler')?.addEventListener('click', async () => {
  const ok = await confirmDialog({
    titre: manEdition ? 'Annuler les modifications ?' : 'Tout effacer ?',
    message: manEdition
      ? "La proc\u00e9dure reviendra telle qu'elle est enregistr\u00e9e. Ce que vous venez d'\u00e9crire sera perdu."
      : "Le titre, la cat\u00e9gorie et toutes les \u00e9tapes seront effac\u00e9s.",
    confirmer: manEdition ? 'Annuler les modifications' : 'Tout effacer',
    annuler: 'Continuer \u00e0 \u00e9crire',
    danger: true,
  })
  if (!ok) return

  if (manEdition) {
    /* On relit la base plutôt que de faire confiance à une copie en mémoire :
       c'est la seule source dont on soit sûr. */
    ouvrirEtapesManuelles(manEdition)
  } else {
    document.getElementById('man-titre').value = ''
    document.getElementById('man-categorie').value = ''
    document.getElementById('man-sous-categorie').value = ''
    manualSteps = [{ texte: '' }]
    reinitialiserCouverture(null)
    renderManualSteps()
  }
})

/* Le même retour, en haut et en bas de page. */

document.getElementById('man-retour')?.addEventListener('click', () => {
  showGestionScreen(manEdition ? 'p-analyse' : 'p-create')
})

/* ═══ LE MÊME RETOUR POUR LE MONTAGE VIDÉO ═══

   Son bouton renvoyait TOUJOURS vers « Nouvelle procédure », par un `onclick`
   écrit en dur dans le balisage. C'est juste quand on vient d'y créer une
   procédure ; c'est faux quand on vient d'en modifier une — on repartait
   alors sur l'écran de création au lieu de revenir à la fiche.

   L'écran manuel, lui, faisait déjà la distinction. Le montage vidéo ne l'avait
   jamais reçue, et le défaut ne se voit que sur les procédures AVEC vidéo :
   celles sans vidéo passent par l'écran manuel, qui était correct. C'est
   pourquoi il pouvait sembler intermittent.

   `dvEdition` porte l'identifiant de la procédure en cours de modification, ou
   `null` en création — exactement comme `manEdition`. Les deux écrans se
   comportent maintenant pareil. */
document.getElementById('dv-retour')?.addEventListener('click', () => {
  showGestionScreen(dvEdition ? 'p-analyse' : 'p-create')
})


/* Les trois pages complètes de l'analyse. Elles partagent la même forme : un
   mot d'introduction, un filtre de période, puis des lignes sobres. */

let anPeriodeLongue = 'month'   // 'month' | 'all'

function anLibelle() {
  return anPeriodeLongue === 'all' ? 'depuis le d\u00e9but' : 'ce mois-ci'
}

function anValidationsPeriode() {
  const v = currentGaData?.validations || []
  if (anPeriodeLongue === 'all') return v
  const debut = new Date()
  debut.setDate(1); debut.setHours(0, 0, 0, 0)
  return v.filter(x => new Date(x.validated_at) >= debut)
}

window.ouvrirAnCategories = function() {
  showGestionScreen('p-an-categories')
  peindreAnCategories()
}

window.ouvrirAnProcedures = function() {
  showGestionScreen('p-an-temps')
  peindreAnTemps()
}

/* Le filtre de période a la forme du sélecteur de tri : un déroulant, pas deux
   segments. Deux commandes voisines qui font la même chose — restreindre une
   liste — doivent se ressembler. Et un déroulant accueille une troisième
   période le jour où on en ajoutera une, là où les segments débordent.

   Les trois pages partagent la même valeur : on revient de « Dossiers » vers
   « Équipe » sans que la fenêtre de temps change sous les pieds. */
document.querySelectorAll('[data-an-trigger]').forEach(t => {
  t.addEventListener('click', (e) => {
    e.stopPropagation()
    /* La classe `open` va sur le MENU et sur le déclencheur — c'est ce
       qu'attendent les règles existantes —, pas sur le conteneur. */
    const dd = t.closest('.dd-filter')
    const menu = dd.querySelector('[data-an-menu]')
    const ouvert = menu.classList.contains('open')
    document.querySelectorAll('.dd-menu.open').forEach(x => x.classList.remove('open'))
    document.querySelectorAll('.dd-trigger.open').forEach(x => x.classList.remove('open'))
    if (!ouvert) { menu.classList.add('open'); t.classList.add('open') }
  })
})

document.querySelectorAll('[data-an-periode]').forEach(b => {
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    anPeriodeLongue = b.dataset.anPeriode
    const mot = b.textContent

    document.querySelectorAll('[data-an-periode]').forEach(x => {
      x.classList.toggle('selected', x.dataset.anPeriode === anPeriodeLongue)
    })
    document.querySelectorAll('[data-an-label]').forEach(x => { x.textContent = mot })
    document.querySelectorAll('.dd-menu.open').forEach(x => x.classList.remove('open'))
    document.querySelectorAll('.dd-trigger.open').forEach(x => x.classList.remove('open'))

    peindreAnCategories()
    peindreAnTemps()
    peindreAnEquipe()
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   LES POSTES

   Le patron définit la liste, chaque membre choisit le sien. Une liste fermée
   plutôt qu'un champ libre : « serveur », « Serveur », « serveuse » et
   « svr » rendraient toute analyse par poste inexploitable.

   On stocke le NOM du poste sur le membre, et non un identifiant : si le patron
   supprime un poste, on ne perd pas l'information de ceux qui l'avaient.
   ═══════════════════════════════════════════════════════════════════════════ */

let postesEntreprise = []

/* ═══════════════════════════════════════════════════════════════════════════
   LE SOUS-DOSSIER · LECTURE ET ÉCRITURE

   Quatre écrans portent ce champ : création, étapes manuelles, montage vidéo,
   et l'ancien éditeur. Quatre fois la même règle — couper les espaces, et
   rendre `null` plutôt qu'une chaîne vide.

   Écrite une fois. Recopiée quatre fois, elle aurait divergé à la première
   correction, et le défaut n'apparaîtrait que sur l'écran oublié.

   POURQUOI `null` ET NON `''`. La base refuse la chaîne vide — c'est la
   contrainte posée à l'étape 1. Mais surtout : deux valeurs pour dire « pas de
   sous-dossier » obligeraient chaque lecture à traiter les deux cas, et l'une
   des deux finirait par être oubliée quelque part. */
function lireSousDossier(id) {
  const v = (document.getElementById(id)?.value || '').trim()
  return v || null
}

/* ═══════════════════════════════════════════════════════════════════════════
   GROUPER PAR SOUS-DOSSIER · UNE SEULE FOIS POUR LES DEUX ESPACES

   La Gestion et l'Équipe affichent la même chose et l'affichaient chacune de
   son côté. Deux listes, deux boucles, deux occasions de diverger — et le
   défaut n'apparaîtrait que dans l'espace où l'on ne regarde pas.

   `sujets` est une liste d'objets quelconques ; `dont` dit où trouver la
   procédure dans chacun. La Gestion passe `{ proc, nbEtapes, pct }`, l'Équipe
   passe la procédure elle-même : la fonction s'accommode des deux sans que
   l'une ait à ressembler à l'autre.

   Elle rend une liste plate, entrecoupée de repères `{ intertitre, compte }`.
   L'appelant n'a qu'à les reconnaître dans sa boucle — il garde donc entière
   la main sur le dessin de ses cartes. */
function grouperParSousDossier(sujets, dont, requete) {
  if (requete) return sujets          // en recherche, une liste plate

  const groupes = new Map()
  const sansSous = []
  for (const x of sujets) {
    const sd = (dont(x)?.sous_categorie || '').trim()
    if (!sd) { sansSous.push(x); continue }
    if (!groupes.has(sd)) groupes.set(sd, [])
    groupes.get(sd).push(x)
  }
  /* Les intertitres par ordre alphabétique, quel que soit le tri des cartes :
     on cherche un rangement par son nom, pas par sa date. L'ordre À
     L'INTÉRIEUR de chaque groupe, lui, reste celui que la personne a choisi. */
  const noms = [...groupes.keys()].sort((a, b) =>
    a.localeCompare(b, 'fr', { sensitivity: 'base' }))

  return [...sansSous, ...noms.flatMap(n =>
    [{ intertitre: n, compte: groupes.get(n).length }, ...groupes.get(n)])]
}

/* Le dessin de l'intertitre, partagé lui aussi. */
/* ═══════════════════════════════════════════════════════════════════════════
   LA CARTE D'UN SOUS-DOSSIER

   Même moule que la carte de dossier : `cat-cell`, pastille, nom, aperçu des
   procédures, pied avec le compte et le chevron. Elle hérite donc de tout son
   style, de son animation de réagencement et de son comportement au toucher,
   sans une ligne de CSS en plus.

   SEULE L'ICÔNE CHANGE : un dossier posé DANS un autre, décalé, avec le coin
   du parent visible derrière. C'est la seule différence, et elle suffit — les
   deux objets sont de même nature, il ne faut pas laisser croire le contraire.

   Le pied ne porte pas le chevron des dossiers mais le même : on entre pareil.
   ═══════════════════════════════════════════════════════════════════════════ */
function carteSousDossier(nom, procs) {
  const cell = document.createElement('div')
  cell.className = 'cat-cell cat-cell--sous'
  cell.dataset.key = 'sd:' + nom
  const recents = procs.slice(0, 3)
  cell.innerHTML = `
    <div class="cat-top">
      <span class="cat-ic">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M2.4 6.6a1.7 1.7 0 0 1 1.7-1.7h3.3l1.6 1.9h6"
                stroke="url(#logoOrIc)" stroke-width="1.6" stroke-opacity="0.45"
                stroke-linejoin="round" stroke-linecap="round"/>
          <path d="M6 10.2a2 2 0 0 1 2-2h3.4l1.7 2h6.9a2 2 0 0 1 2 2v6.6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2Z"
                stroke="url(#logoOrIc)" stroke-width="1.7" stroke-linejoin="round"/>
          <line x1="6" y1="13.4" x2="22" y2="13.4"
                stroke="url(#logoOrIc)" stroke-opacity="0.5" stroke-width="1.5"/>
        </svg>
      </span>
    </div>
    <div class="cat-name"><span class="txt">${escapeHtml(nom)}</span></div>
    <div class="cat-recent">
      ${recents.map(p => `<div class="cat-recent-item" data-proc="${p.id}"><span class="txt">${escapeHtml(p.titre)}</span>${etatProcedureHtml(p)}</div>`).join('')}
    </div>
    <div class="cat-pied">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M13.6 3H7.4A2 2 0 0 0 5.4 5v14a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8Z"
              stroke="url(#logoOrIc)" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M13.6 3v5h5" stroke="url(#logoOrIc)" stroke-width="1.8" stroke-linejoin="round"/>
      </svg>
      <span>${procs.length} procédure${procs.length > 1 ? 's' : ''}</span>
      <span class="fl">›</span>
    </div>`

  cell.onclick = (e) => {
    /* Comme la carte de dossier : TOUTE la carte ouvre le sous-dossier. Les
       titres affichés sont un aperçu du contenu, pas un menu.

       Seule exception, la même que sur le dossier : une analyse en panne se
       reprend là où on la voit. C'est une réparation, pas une navigation. */
    const ligne = e.target.closest('.cat-recent-item')
    if (ligne) {
      const p = procs.find(x => x.id === ligne.dataset.proc)
      if (p && (p.statut === 'echec' || analyseBloquee(p))) { proposerReprise(p); return }
    }
    ouvrirSousDossier(nom)
  }
  return cell
}

/* ═══ LE RETOUR REMONTE D'UN NIVEAU ═══

   Depuis un sous-dossier, on revient au dossier — pas à la liste. C'est le
   comportement de tout explorateur de fichiers, et c'est ce qu'attend quelqu'un
   qui vient d'entrer quelque part.

   Rouvrir le dossier plutôt que de simplement vider `sousDossierCourant` :
   `ouvrirCategorie` remet aussi le titre, le sous-titre, la recherche et le
   compte. Les remettre à la main ici, c'est en oublier un. */
document.getElementById('cat-retour')?.addEventListener('click', () => {
  if (sousDossierCourant) { openCategoryProcedures(dossierCourantNom); return }
  showGestionScreen('p-list')
})

function ouvrirSousDossier(nom) {
  sousDossierCourant = nom
  currentCategoryQuery = ''
  const champ = document.getElementById('category-search-input')
  if (champ) champ.value = ''
  majTitreCategorie()
  renderCategoryProceduresList()
}

/* Le titre porte le chemin, et le bouton « renommer le dossier » disparaît
   quand on est dans un sous-dossier : il renommerait le parent, ce que
   personne n'attend à cet endroit. */
function majTitreCategorie() {
  const t = document.getElementById('category-titre')
  const sub = document.getElementById('category-subhead')
  const r = document.getElementById('cat-renommer')

  if (sousDossierCourant) {
    if (t) t.textContent = sousDossierCourant
    /* Le sous-titre porte le chemin : sans lui, on ne sait plus dans quel
       dossier on se trouve — deux entreprises peuvent avoir un « Friteuse ». */
    if (sub) sub.textContent = `${dossierCourantNom} \u203a ${sousDossierCourant}`
    /* Le crayon renommerait le DOSSIER, ce que personne n'attend ici. Le
       sous-dossier se renomme depuis sa carte, dans le dossier parent. */
    if (r) r.style.display = 'none'
  } else {
    if (t) t.textContent = dossierCourantNom
    if (r) r.style.display = ''
  }
}

function elementIntertitre(nom, compte, renommable) {
  const t = document.createElement('div')
  t.className = 'sous-dossier-titre' + (renommable ? ' renommable' : '')
  /* ═══ LE CRAYON N'APPARAÎT QUE CÔTÉ GESTION ═══

     Un employé ne range pas : lui montrer un bouton qu'il n'a pas le droit
     d'utiliser — ou pire, qu'il peut utiliser — n'a aucun sens. Le paramètre
     est explicite plutôt que déduit d'une variable globale : la fonction sert
     les deux espaces, elle ne doit pas avoir à deviner lequel l'appelle. */
  t.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 7.5a2 2 0 0 1 2-2h3.4l1.8 2.2H19a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>
    </svg>
    <span>${escapeHtml(nom)}</span>
    <b>${compte}</b>` + (renommable ? `
    <button type="button" class="sd-renommer" data-sd="${escapeHtml(nom)}"
            aria-label="Renommer le sous-dossier ${escapeHtml(nom)}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M14.5 4.8l4.7 4.7M4 20h4.2L20 8.2a2 2 0 0 0 0-2.8l-1.4-1.4a2 2 0 0 0-2.8 0L4 15.8Z"/>
      </svg>
    </button>` : '')
  return t
}

/* ═══════════════════════════════════════════════════════════════════════════
   RENOMMER UN SOUS-DOSSIER

   Même mécanique que pour un dossier : on réécrit la colonne sur toutes les
   procédures concernées. Il n'y a pas de table à mettre à jour, puisqu'un
   sous-dossier n'existe que par les procédures qui le portent.

   ─── LA PORTÉE EST LIMITÉE AU DOSSIER COURANT ───

   `eq('categorie', ...)` en plus du sous-dossier. Sans cette condition, un
   « Friteuse » rangé sous Cuisine et un autre sous Maintenance seraient
   renommés ensemble — deux rangements distincts qui portent le même nom, ce
   qui est parfaitement légitime.

   ─── LE VIDER LE SUPPRIME ───

   Effacer le nom rend `null`, donc « pas de sous-dossier » : les procédures
   remontent en tête de liste. C'est le seul moyen de défaire un rangement, et
   il est plus naturel qu'un bouton « supprimer » qui ferait craindre pour les
   procédures elles-mêmes. On le dit dans la fenêtre. */
async function renommerSousDossier(ancien) {
  const dossier = (document.getElementById('category-titre')?.textContent || '').trim()
  if (!dossier) return

  /* ═══ POURQUOI UN CHOIX AVANT LA SAISIE ═══

     `demanderTexte` rend `null` DANS DEUX CAS : quand on annule, et quand on
     valide un champ vide. Impossible de les distinguer — et ici les deux
     conséquences sont opposées : ne rien faire, ou sortir les procédures du
     sous-dossier.

     Plutôt que de deviner, on sépare les deux gestes. « Retirer » est une
     action explicite ; « Renommer » ouvre la saisie, où un champ vide ne peut
     plus qu'être une annulation. */
  const quoi = await confirmDialog({
    titre: `\u00ab ${ancien} \u00bb`,
    message: 'Renommer ce sous-dossier, ou en sortir les proc\u00e9dures ? ' +
      'Les sortir ne supprime rien : elles remontent en haut du dossier.',
    confirmer: 'Renommer',
    annuler: 'Retirer le sous-dossier',
    danger: false,
  })

  let propre
  if (quoi) {
    const saisi = await demanderTexte({
      titre: 'Renommer le sous-dossier',
      message: `Les proc\u00e9dures de \u00ab ${ancien} \u00bb dans \u00ab ${dossier} \u00bb suivront.`,
      valeur: ancien,
      placeholder: 'Ex : Friteuse',
      confirmer: 'Renommer',
    })
    if (!saisi || saisi === ancien) return          // annulé, ou rien changé
    propre = saisi
  } else {
    /* `confirmDialog` rend `false` sur le bouton de gauche ET sur la croix.
       Une confirmation ferme la porte au retrait involontaire. */
    const sur = await confirmDialog({
      titre: 'Retirer le sous-dossier ?',
      message: `Les proc\u00e9dures de \u00ab ${ancien} \u00bb remonteront en haut de ` +
        `\u00ab ${dossier} \u00bb. Aucune proc\u00e9dure n'est supprim\u00e9e.`,
      confirmer: 'Retirer', annuler: 'Annuler', danger: false,
    })
    if (!sur) return
    propre = null
  }

  /* ═══ LA PORTÉE EST LIMITÉE AU DOSSIER COURANT ═══

     `eq('categorie', dossier)` en plus du sous-dossier. Sans cette condition,
     un « Friteuse » rangé sous Cuisine et un autre sous Maintenance seraient
     renommés ensemble — deux rangements distincts qui portent le même nom, ce
     qui est parfaitement légitime. */
  const { data, error } = await supabase.from('procedures')
    .update({ sous_categorie: propre })
    .eq('entreprise_id', currentMembre.entreprise_id)
    .eq('categorie', dossier)
    .eq('sous_categorie', ancien)
    .select('id')

  if (error) { toast('\u00c9chec : ' + error.message); return }
  if (!data || !data.length) { toast('La base a refus\u00e9 la modification.'); return }

  /* On met à jour la copie en mémoire plutôt que de tout recharger : la liste
     se redessine aussitôt, sans attendre le réseau. */
  for (const l of [allGestionProcedures, currentCategoryProcsData.map(d => d.proc)]) {
    l.forEach(p => {
      if (p.categorie === dossier && p.sous_categorie === ancien) p.sous_categorie = propre
    })
  }
  renderCategoryProceduresList()
  toast(propre ? `Renomm\u00e9 en \u00ab ${propre} \u00bb` : 'Sous-dossier retir\u00e9')
}

async function chargerPostes() {
  if (!currentMembre?.entreprise_id) return []
  const { data, error } = await supabase.from('postes')
    .select('*').eq('entreprise_id', currentMembre.entreprise_id).order('ordre')
  /* La table peut ne pas exister encore : l'app continue sans les postes plutôt
     que de casser les réglages entiers. */
  if (error) { console.warn('Standix \u00b7 postes indisponibles :', error.message); return [] }
  postesEntreprise = data || []
  return postesEntreprise
}

window.ouvrirPostes = async function() {
  showGestionScreen('p-reg-postes')
  document.getElementById('poste-erreur').textContent = ''
  document.getElementById('postes-liste').innerHTML = '<div class="an-vide">Chargement\u2026</div>'
  await chargerPostes()
  peindrePostes()
}

function peindrePostes() {
  const el = document.getElementById('postes-liste')
  if (!el) return
  if (!postesEntreprise.length) {
    el.innerHTML = '<div class="an-vide">Aucun poste pour le moment. Ajoutez-en un ci-dessous.</div>'
    return
  }
  el.innerHTML = postesEntreprise.map(p => `
    <div class="an-lig">
      <span class="co"><span class="nm">${escapeHtml(p.nom)}</span></span>
      <button type="button" class="oter" data-poste="${escapeHtml(p.id)}">Retirer</button>
    </div>`).join('')

  el.querySelectorAll('[data-poste]').forEach(b => {
    b.addEventListener('click', async () => {
      const nom = postesEntreprise.find(x => x.id === b.dataset.poste)?.nom || 'ce poste'
      const ok = await confirmDialog({
        titre: 'Retirer ' + nom + ' ?',
        message: "Les personnes qui l'ont choisi le gardent : seul le choix dispara\u00eet pour les prochaines.",
        confirmer: 'Retirer', annuler: 'Annuler', danger: true,
      })
      if (!ok) return
      await supabase.from('postes').delete().eq('id', b.dataset.poste)
      await chargerPostes()
      peindrePostes()
    })
  })
}

document.getElementById('poste-ajouter')?.addEventListener('click', async () => {
  const champ = document.getElementById('poste-nouveau')
  const err = document.getElementById('poste-erreur')
  const nom = champ.value.trim()
  err.textContent = ''
  if (!nom) { err.textContent = 'Donnez un nom au poste.'; return }
  if (postesEntreprise.some(p => p.nom.toLowerCase() === nom.toLowerCase())) {
    err.textContent = 'Ce poste existe d\u00e9j\u00e0.'; return
  }
  const { error } = await supabase.from('postes').insert({
    entreprise_id: currentMembre.entreprise_id, nom, ordre: postesEntreprise.length,
  })
  if (error) { err.textContent = 'Enregistrement impossible : ' + error.message; return }
  champ.value = ''
  await chargerPostes()
  peindrePostes()
})

/* ─── Le choix du membre ─── */

window.ouvrirMonPoste = async function() {
  const gestion = currentMembre?.role === 'gestion'
  if (gestion) showGestionScreen('p-reg-poste')
  else showEquipeScreen('e-reg-poste')
  const el = document.getElementById(gestion ? 'mon-poste-liste' : 'e-mon-poste-liste')
  if (el) el.innerHTML = '<div class="an-vide">Chargement\u2026</div>'
  await chargerPostes()
  peindreMonPoste()
}

function peindreMonPoste() {
  /* Chaque espace a son écran : on peint celui de l'espace courant. */
  const gestion = currentMembre?.role === 'gestion'
  const el = document.getElementById(gestion ? 'mon-poste-liste' : 'e-mon-poste-liste')
  const vide = document.getElementById(gestion ? 'mon-poste-vide' : 'e-mon-poste-vide')
  if (!el) return
  vide.style.display = postesEntreprise.length ? 'none' : ''
  el.innerHTML = postesEntreprise.map(p => {
    const choisi = currentMembre?.poste === p.nom
    return `
      <button type="button" class="an-lig" data-choix="${escapeHtml(p.nom)}">
        <span class="co"><span class="nm">${escapeHtml(p.nom)}</span></span>
        ${choisi ? '<span class="vl" style="color:var(--blue);">\u2713</span>' : ''}
      </button>`
  }).join('')

  el.querySelectorAll('[data-choix]').forEach(b => {
    b.addEventListener('click', async () => {
      const nom = b.dataset.choix
      /* On écrit d'abord à l'écran, on enregistre ensuite : le choix doit
         paraître immédiat, même sur un réseau lent. */
      currentMembre.poste = currentMembre.poste === nom ? null : nom
      peindreMonPoste()
      majLignePoste()
      const { error } = await supabase.from('membres')
        .update({ poste: currentMembre.poste }).eq('id', currentMembre.id)
      if (error) toast('Enregistrement impossible : ' + error.message)
    })
  })
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHOISIR SON POSTE EN ARRIVANT

   Un employé qui vient de rejoindre une entreprise choisit son poste tout de
   suite. Plus tard, il ne le fera pas : les réglages sont l'endroit où l'on va
   quand quelque chose ne va pas, pas où l'on passe par curiosité.

   Trois garde-fous :
   • rien ne s'ouvre si le patron n'a pas encore défini de postes ;
   • rien ne s'ouvre si la personne en a déjà un ;
   • on ne redemande pas à quelqu'un qui a déjà refusé — la mémoire locale garde
     la trace du « plus tard », sinon la fenêtre revient à chaque ouverture et
     devient un obstacle plutôt qu'un service.
   ═══════════════════════════════════════════════════════════════════════════ */

async function proposerPosteALArrivee() {
  if (currentMembre?.role !== 'equipe') return
  if (currentMembre?.poste) return
  if (!currentMembre?.entreprise_id) return

  const cle = 'procedo_poste_passe_' + currentMembre.id
  try { if (localStorage.getItem(cle)) return } catch (e) {}

  await chargerPostes()
  if (!postesEntreprise.length) return   // le patron n'en a pas encore défini

  /* Plus de « plus tard » : la fenêtre ne se ferme qu'avec une réponse. La clé
     locale sert donc uniquement à ne pas reposer la question après coup. */
  const choisi = await choisirPosteFenetre()
  try { localStorage.setItem(cle, '1') } catch (e) {}

  currentMembre.poste = choisi
  majLignePoste()
  const { error } = await supabase.from('membres')
    .update({ poste: choisi }).eq('id', currentMembre.id)
  if (error) toast('Poste non enregistr\u00e9 : ' + error.message)
  else toast('Bienvenue \u00b7 ' + choisi)
}

/* La fenêtre elle-même. Elle rend le nom du poste choisi, ou `null` si la
   personne préfère le faire plus tard. */
/* La fenêtre du poste. La réponse est OBLIGATOIRE, mais on ne le dit nulle
   part : le bouton reste éteint tant que rien n'est choisi. C'est plus doux
   qu'un message d'erreur, et tout aussi ferme.

   « Autre » figure toujours en dernier. Sans lui, quelqu'un dont le poste
   n'existe pas dans la liste serait bloqué à l'entrée par une question sans
   réponse possible — et ce n'est pas sa faute si son patron a oublié le sien. */
function choisirPosteFenetre() {
  return new Promise((resolve) => {
    const fond = document.createElement('div')
    fond.className = 'ios-alert-backdrop'
    fond.innerHTML = `
      <div class="ios-alert poste-fen" role="dialog" aria-modal="true">
        <div class="poste-tete">
          <span class="ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7.4" width="18" height="12.6" rx="2.6"/><path d="M9 7.4V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8v1.6"/><line x1="3" y1="12.6" x2="21" y2="12.6"/></svg>
          </span>
          <div class="t">Quel est votre poste ?</div>
          <div class="s">Vous pourrez le changer dans les r\u00e9glages.</div>
        </div>

        <div class="poste-choix">
          ${postesEntreprise.map(p => `
            <button type="button" data-poste-choix="${escapeHtml(p.nom)}">
              <span class="nm">${escapeHtml(p.nom)}</span><span class="r"></span>
            </button>`).join('')}
          <button type="button" data-poste-choix="Autre">
            <span class="nm">Autre</span><span class="r"></span>
          </button>
        </div>

        <div class="poste-pied">
          <button type="button" class="poste-ok" disabled>Continuer</button>
        </div>
      </div>`
    document.body.appendChild(fond)
    requestAnimationFrame(() => fond.classList.add('shown'))

    let choisi = null
    const ok = fond.querySelector('.poste-ok')

    fond.querySelectorAll('[data-poste-choix]').forEach(b => {
      b.addEventListener('click', () => {
        fond.querySelectorAll('[data-poste-choix]').forEach(x => x.classList.remove('on'))
        b.classList.add('on')
        choisi = b.dataset.posteChoix
        ok.disabled = false
        if (navigator.vibrate) navigator.vibrate(6)
      })
    })

    ok.addEventListener('click', () => {
      if (!choisi) return
      fond.classList.remove('shown')
      setTimeout(() => fond.remove(), 220)
      resolve(choisi)
    })

    /* On ne ferme ni en touchant le fond, ni avec la touche Échap : c'est une
       question à laquelle on ne revient pas. */
  })
}

function majLignePoste() {
  const el = document.getElementById('e-mon-poste')
  if (el) el.textContent = currentMembre?.poste || 'Non d\u00e9fini'
}

document.getElementById('poste-retour')?.addEventListener('click', () => {
  if (currentMembre?.role === 'gestion') showGestionScreen('p-settings')
  else showEquipeScreen('e-settings')
})

/* Comment le temps est compté. Trois sections l'affichent, donc trois boutons
   ouvrent la même explication : un chiffre qu'on ne sait pas lire ne sert à
   rien, et celui-ci se prête aux malentendus — on croit facilement qu'il compte
   le temps passé dans l'app, ou qu'il tourne quand le téléphone est en poche. */
function expliquerComptage() {
  confirmDialog({
    titre: 'Comment le temps est compt\u00e9',
    message:
      "Le compteur tourne quand une proc\u00e9dure est OUVERTE \u00e0 l'\u00e9cran, et seulement l\u00e0.\n\n" +
      "\u2022 Il s'arr\u00eate d\u00e8s que l'app passe en arri\u00e8re-plan ou que l'\u00e9cran s'\u00e9teint.\n" +
      "\u2022 Apr\u00e8s une minute sans le moindre geste, il demande \u00ab vous en \u00eates o\u00f9 ? \u00bb " +
      "et cesse de compter tant que personne ne r\u00e9pond \u2014 un t\u00e9l\u00e9phone pos\u00e9 sur le plan " +
      "de travail n'accumule pas des heures.\n" +
      "\u2022 Sous trois secondes, rien n'est retenu : c'est un passage, pas une lecture.\n\n" +
      "Les temps s'additionnent \u00e0 chaque visite. Les classements montrent le mois en cours.",
    confirmer: 'Compris',
    annuler: null,
    danger: false,
  })
}

/* `expliquerDurees` a été retirée avec son bouton : elle décrivait le temps
   affiché sur les blocs Dossiers et Procédures, disparus de la page. */


document.addEventListener('click', (e) => {
  if (e.target.closest('[data-aide-temps]')) expliquerComptage()
})

/* ═══════════════════════════════════════════════════════════════════════════
   COMPLÉTER LES ÉTAPES DÉCOUPÉES

   La personne découpe elle-même — c'est elle qui sait où une étape commence, et
   aucune IA ne le devine mieux qu'elle. L'IA écoute ensuite ce qui a été dit et
   écrit le texte de chacune.

   POURQUOI ON PASSE PAR UNE PROCÉDURE TEMPORAIRE
   Le circuit d'analyse (`ai-start` → Azure → `ai-check`) est bâti autour d'une
   procédure : il lui faut une ligne en base pour y ranger son résultat. Plutôt
   que d'écrire un second circuit qui ferait la même chose, on crée une ligne
   invisible, on récupère ses étapes, et on l'efface.

   Elle porte `statut: 'ia_temp'` : la liste des procédures n'affiche que
   « pret » et « traitement », elle n'apparaît donc nulle part. Et elle est
   effacée même en cas d'échec — c'est le rôle du `finally`.

   CE QU'ON NE FAIT PAS
   On n'écrase jamais un texte déjà saisi. Quelqu'un qui a rédigé trois étapes
   sur huit garde les trois : l'IA ne remplit que les vides.
   ═══════════════════════════════════════════════════════════════════════════ */

let iaCompletionEnCours = false
let docMinuteur = null

/* Vrai pendant les quelques secondes où la coche s'affiche, après une réussite. */
let iaVientDeFinir = false

function majBoutonIA() {
  /* Un seul bouton, juste au-dessus de « Publier ». Celui qui vivait sous les
     étapes a été retiré : deux boutons identiques à deux endroits laissaient
     croire à deux actions différentes. */
  /* ═══ CETTE FONCTION N'A PLUS RIEN À PILOTER ═══

     Le bouton « L'IA rédige mes étapes » a été retiré de la page. Restait la
     note qui l'accompagnait — et elle allait chercher `vid-ia-note`, un
     identifiant porté AUSSI par la note « Cinq minutes maximum » de la page de
     création par l'IA. Elle l'aurait écrasée avec « 3 étapes sans texte ».

     Deux éléments portaient le même identifiant ; en supprimer un a rendu le
     défaut visible. On s'arrête ici. */
}


async function completerEtapesAvecIA() {
  if (iaCompletionEnCours) return
  const note = document.getElementById('vid-ia-note')

  if (!currentVideoFile && !editVideoUrl) {
    note.textContent = 'Importez d\u2019abord une vid\u00e9o.'
    return
  }

  let tempId = null
  /* Vrai une fois qu'`ai-start` a répondu — c'est lui qui décompte. Sert à
     rendre l'analyse si la SUITE échoue : `ai-start` rembourse ses propres
     échecs, mais pas ce qui casse après lui. */
  let analyseConsommee = false
  iaCompletionEnCours = true
  majBoutonIA()

  /* Le déroulé s'affiche étape par étape. Quand ça échoue, on sait OÙ : la
     dernière ligne affichée est le point de rupture. C'est ce qui manquait pour
     corriger la vraie cause plutôt que de deviner. */
  const jalon = (m) => { if (note) { note.classList.remove('erreur'); note.textContent = m } }

  try {
    /* La préparation est la PREMIÈRE étape, pas une attente séparée : elle
       porte donc son numéro comme les autres. */
    jalon('1/5 \u00b7 Pr\u00e9paration de la vid\u00e9o\u2026')
    if (currentVideoFile) {
      currentVideoFile = await comprimerVideo(currentVideoFile, (pct) => {
        jalon(pct >= 100
          ? '1/5 \u00b7 Finalisation de la vid\u00e9o\u2026'
          : `1/5 \u00b7 Pr\u00e9paration de la vid\u00e9o\u2026 ${pct}%`)
      })
    }
    jalon('2/5 \u00b7 Envoi de la vid\u00e9o\u2026')
    /* ═══ ON ENVOIE LA VIDÉO, PLUS SEULEMENT LE SON ═══

       On extrayait la bande son pour l'alléger, en pensant qu'Azure n'avait que
       faire de l'image. Mais on lui demandait le mode `Default`, qui analyse
       AUSSI ce qui est visible : il cherchait des images dans un fichier qui
       n'en contenait aucune. L'analyse n'aboutissait jamais, et le pourcentage
       restait suspendu.

       La vidéo comprimée pèse plus lourd — 94 Mo contre 5 — mais c'est ce que le
       service attend, et c'est ce qui permet de lire les objets, les gestes et
       le texte à l'écran. C'est précisément ce qu'on vend. */
    let urlAnalyse = null
    const base = `${currentMembre.entreprise_id}/${Date.now()}_ia`
    if (currentVideoFile) {
      /* ═══ L'EXTENSION SUIT LE FICHIER, ELLE NE LE PRÉCÈDE PAS ═══

         `.webm` était écrit en dur. Tant que la compression ne tournait que
         sur ordinateur, c'était juste par hasard : Chrome produit du WebM.
         Safari, lui, ne sait produire que du MP4 — une fois la compression
         réparée sur iPhone, on aurait déposé un MP4 sous un nom de WebM.

         Azure devine souvent le format à la lecture, mais pas toujours, et un
         échec d'indexation pour une extension menteuse est le genre de panne
         qu'on cherche pendant deux heures. */
      const t = currentVideoFile.type || ''
      const ext = t.includes('mp4') ? 'mp4'
                : t.includes('webm') ? 'webm'
                : t.includes('quicktime') ? 'mov'
                : (currentVideoFile.name?.split('.').pop() || 'mp4').toLowerCase()
      const chemin = `${base}.${ext}`
      const { error: eUp } = await supabase.storage.from('procedo-videos')
        .upload(chemin, currentVideoFile, {
          contentType: t || 'video/mp4',
          cacheControl: CACHE_LONG,
        })
      if (eUp) throw new Error(eUp.message)
      jalon('3/5 \u00b7 Vid\u00e9o re\u00e7ue\u2026')
      const { data: sig, error: eSig } = await supabase.storage.from('procedo-videos')
        .createSignedUrl(chemin, 60 * 60 * 3)
      if (eSig) throw new Error(eSig.message)
      urlAnalyse = sig.signedUrl
    } else if (editVideoUrl) {
      /* Une vidéo déjà en ligne : on signe simplement son adresse. */
      const { data: sig, error: eSig } = await supabase.storage.from('procedo-videos')
        .createSignedUrl(editVideoUrl, 60 * 60 * 3)
      if (eSig) throw new Error(eSig.message)
      urlAnalyse = sig.signedUrl
      jalon('3/5 \u00b7 Vid\u00e9o retrouv\u00e9e\u2026')
    }
    if (!urlAnalyse) throw new Error("Aucune vid\u00e9o \u00e0 analyser.")

    /* ═══ LE QUOTA, AVANT DE DÉPENSER ═══

       On demande à la base, pas à nous-mêmes : c'est elle qui compte, et son
       compteur ne se contourne pas depuis la console. Elle compte ET consomme
       dans la même opération, si bien que deux analyses lancées à la même
       seconde ne peuvent pas lire le même total.

       ON VÉRIFIE, ON NE CONSOMME PAS. Le décompte réel se fait dans `ai-start`,
       juste avant l'appel à Azure — c'est le seul point de passage qu'on ne
       peut pas contourner. Si l'app consommait aussi, chaque analyse en
       compterait deux.

       Ce contrôle-ci sert à PRÉVENIR : découper une vidéo, l'envoyer, puis
       apprendre que le quota est épuisé serait une perte de temps et de
       données. Placé après le découpage et avant l'envoi. */
    const { data: droit, error: errDroit } = await supabase.rpc('verifier_analyse')
    if (errDroit) {
      /* La fonction n'existe pas encore en base : on laisse passer plutôt que
         de bloquer la création. Le jour où le SQL est posé, le contrôle
         s'active de lui-même. */
      console.warn('[quota] contrôle indisponible :', errDroit.message)
    } else if (droit && droit.autorise === false) {
      if (droit.raison === 'quota') {
        throw new Error(
          `Vous avez utilis\u00e9 vos ${droit.quota} analyses vid\u00e9o de ce mois-ci. `
          + `Elles se renouvellent le 1er du mois prochain \u2014 ou passez \u00e0 l'offre `
          + `sup\u00e9rieure pour en avoir davantage tout de suite.`)
      }
      if (droit.raison === 'role') {
        throw new Error("Seule la gestion peut cr\u00e9er des proc\u00e9dures.")
      }
      throw new Error("Impossible de v\u00e9rifier votre abonnement.")
    }

    jalon('4/5 \u00b7 Ouverture de l\u2019analyse\u2026')

    /* L'analyse serveur n'écrit pas dans le vide : elle dépose ses étapes SUR
       une procédure, et il lui en faut donc une avant de démarrer. Celle-ci ne
       sert que de boîte aux lettres — le `finally` la supprime dès les textes
       récupérés, que l'analyse ait abouti ou non.

       Ces trois lignes avaient disparu lors d'une réécriture, alors que les
       deux qui les suivaient sont restées : `errTemp` et `temp` étaient lus
       sans avoir jamais été créés. Le bouton « Rédiger mes étapes » s'arrêtait
       donc là, à tous les coups. */
    const { data: temp, error: errTemp } = await supabase
      .from('procedures')
      .insert({
        entreprise_id: currentMembre.entreprise_id,
        titre: '\u2014 analyse en cours \u2014',
        created_by: currentMembre.id,
        statut: 'traitement',
      })
      .select().single()
    if (errTemp) throw new Error(errTemp.message)
    if (!temp?.id) throw new Error("La proc\u00e9dure d'analyse n'a pas pu \u00eatre cr\u00e9\u00e9e.")
    tempId = temp.id

    /* 3. L'analyse, puis l'attente. */
    const rep = await fetch(`${SUPABASE_URL}/functions/v1/ai-start`, {
      method: 'POST',
      headers: await enTeteFonction(),
      body: JSON.stringify({ procedure_id: tempId, video_url: urlAnalyse }),
    })
    
    const dep = await rep.json()
    if (!rep.ok || dep.error) throw new Error(dep.error || "L\u2019analyse n\u2019a pas d\u00e9marr\u00e9.")

    /* `ai-start` a répondu : l'analyse est décomptée. À partir d'ici, tout
       échec doit la rendre — c'est ce que fait le bloc d'erreur plus bas.
       Avant ce point, `ai-start` rembourse lui-même. */
    analyseConsommee = true

    jalon('5/5 \u00b7 Analyse du son et de l\u2019image\u2026')
    const textes = await attendreEtapesIA(tempId)
    if (!textes.length) {
      throw new Error("L\u2019IA n\u2019a rien tir\u00e9 de cette vid\u00e9o. V\u00e9rifiez que la parole est audible.")
    }

    /* 4. On répartit. Les deux listes sont dans le même ordre chronologique :
       la première étape vide reçoit le premier texte disponible, et ainsi de
       suite. Quand l'IA en a trouvé moins que de coupures, les dernières
       restent vides plutôt que de recevoir un texte qui ne les concerne pas. */
    let pris = 0
    let remplies = 0
    videoSteps.forEach(s => {
      if (String(s.texte || '').trim()) return
      if (pris >= textes.length) return
      s.texte = textes[pris++]
      remplies++
    })

    renderVideoSteps()

    /* La coche, le temps qu'on la voie. Trois secondes : assez pour remarquer
       que c'est fini, trop peu pour qu'on attende qu'elle parte. */
    iaVientDeFinir = true
    setTimeout(() => { iaVientDeFinir = false; majBoutonIA() }, 3000)

    const reste = videoSteps.filter(s => !String(s.texte || '').trim()).length
    note.textContent = reste
      ? `${remplies} \u00e9tape${remplies > 1 ? 's' : ''} \u00e9crite${remplies > 1 ? 's' : ''}. ` +
        `${reste} sans texte : l\u2019IA n\u2019a pas entendu de parole \u00e0 ces moments-l\u00e0.`
      : `${remplies} \u00e9tape${remplies > 1 ? 's' : ''} \u00e9crite${remplies > 1 ? 's' : ''}. Relisez-les avant de publier.`
    if (navigator.vibrate) navigator.vibrate(10)

  } catch (e) {
    /* ═══ ON REND L'ANALYSE ═══
       Azure indisponible, vidéo muette, réseau coupé : le décompte a eu lieu,
       le client n'a rien reçu. On le lui rembourse.

       Sauf quand c'est le quota lui-même qui a refusé — rien n'a été consommé
       dans ce cas, et rendre reviendrait à en offrir une. */
    if (analyseConsommee) {
      /* ═══ ON PRÉCISE L'ENTREPRISE ═══

         L'appel ne passait que `p_procedure_id`. Deux conséquences.

         ① IL TOMBAIT SUR L'ANCIENNE SIGNATURE. `rendre_analyse` existe en deux
            versions dans la base — une à un argument, une à deux — et PostgREST
            choisit d'après les arguments fournis. Un seul argument menait donc
            à la version d'avant le correctif, celle qui cherche l'entreprise
            avec un `limit 1` sans `order by`.

         ② ELLE REMBOURSAIT AU HASARD. Pour un compte membre de deux
            entreprises, Postgres rendait n'importe laquelle des fiches : le
            crédit pouvait aller à la mauvaise. Le quota de l'une se remplissait
            pendant que l'autre se vidait, sans que rien ne plante. */
      await supabase.rpc('rendre_analyse', {
        p_procedure_id: tempId,
        p_entreprise_id: currentMembre?.entreprise_id ?? null,
      })
        .then(({ error: er }) => { if (er) console.warn('[quota] non rendue :', er.message) })
    }
    /* L'erreur se voit : en rouge, et précédée de sa cause. Elle s'affichait
       dans la même teinte grise que les messages ordinaires, au point de passer
       pour une simple explication. */
    note.textContent = e?.message || String(e)
    note.classList.add('erreur')
    setTimeout(() => note.classList.remove('erreur'), 12000)
  } finally {
    /* La ligne temporaire disparaît quoi qu'il arrive. Une analyse qui échoue
       ne doit pas laisser de trace dans la base. */
    if (tempId) {
      await supabase.from('etapes').delete().eq('procedure_id', tempId)
      await supabase.from('procedures').delete().eq('id', tempId)
    }
    iaCompletionEnCours = false
    majBoutonIA()
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   L'ANALYSE SURVIT À LA FERMETURE DE L'APP

   ═══ CE QUI SE PASSAIT ═══

   Le travail se répartit en deux endroits. `ai-start` envoie la vidéo à Azure,
   qui travaille jusqu'au bout quoi qu'il arrive. Puis une boucle interroge
   `ai-check` toutes les trois secondes pour savoir si c'est prêt.

   Cette boucle vit DANS L'ONGLET. Quitter Chrome la tue. L'analyse aboutissait,
   les étapes étaient écrites en base — et personne n'allait les chercher.

   ═══ DEUX RÉPARATIONS ═══

   La première : on note dans le navigateur qu'une analyse est en cours. Au
   retour sur l'app, on reprend la surveillance là où elle s'était arrêtée.

   La seconde, plus bas dans le fichier : à l'ouverture d'une procédure, si des
   étapes existent en base alors que l'app n'en a pas, on les affiche. Plus rien
   ne se perd, quel que soit ce qui s'est passé entre-temps.
   ═══════════════════════════════════════════════════════════════════════════ */

const CLE_ANALYSE = 'standix-analyse-en-cours'

/* On garde l'identifiant ET l'heure de départ. Sans l'heure, une analyse
   abandonnée il y a trois jours ferait tourner la surveillance au prochain
   lancement. */
function noterAnalyseEnCours(procId) {
  try {
    localStorage.setItem(CLE_ANALYSE, JSON.stringify({ id: procId, debut: Date.now() }))
  } catch (e) {}
}

function oublierAnalyse() {
  try { localStorage.removeItem(CLE_ANALYSE) } catch (e) {}
}

function analyseAbandonnee() {
  try {
    const brut = localStorage.getItem(CLE_ANALYSE)
    if (!brut) return null
    const o = JSON.parse(brut)
    /* Au-delà de quinze minutes, ce n'est plus une analyse en cours : c'est un
       reste. Azure ne met jamais autant, et la surveillance elle-même abandonne
       au bout de huit. */
    if (!o?.id || Date.now() - (o.debut || 0) > 15 * 60000) { oublierAnalyse(); return null }
    return o
  } catch (e) { return null }
}

/* ═══ ① LA REPRISE AU RETOUR ═══

   `visibilitychange` se déclenche quand l'onglet revient au premier plan —
   après un changement d'onglet, un déverrouillage, ou la réouverture de Chrome.

   On ne relance PAS l'analyse : Azure a continué de son côté. On se contente
   de reprendre la surveillance, et le plus souvent la réponse arrive du premier
   coup parce que le travail est déjà fini.

   `iaCompletionEnCours` évite le double emploi : si la boucle tourne encore —
   cas d'un simple changement d'onglet —, on ne la double pas. */
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return
  if (iaCompletionEnCours) return

  const reste = analyseAbandonnee()
  if (!reste) return

  try {
    const textes = await attendreEtapesIA(reste.id)
    if (!textes?.length) return

    /* On répartit comme le fait le chemin normal : chaque texte va dans la
       première coupure encore vide. Réemployer la même logique évite qu'un
       jour l'une des deux dérive par rapport à l'autre. */
    let pris = 0
    videoSteps.forEach(st => {
      if (String(st.texte || '').trim()) return
      if (pris >= textes.length) return
      st.texte = textes[pris++]
    })
    renderVideoSteps()
    toast(`L\u2019analyse est termin\u00e9e : ${textes.length} \u00e9tapes.`)
  } catch (e) {
    /* En silence : la personne n'a rien demandé en revenant sur l'app, un
       message d'erreur surgi de nulle part serait déroutant. Elle retrouvera
       ses étapes en rouvrant la procédure — voir ② plus bas. */
    console.warn('[reprise] analyse non r\u00e9cup\u00e9r\u00e9e :', e?.message || e)
  }
})

/* Interroge le serveur jusqu'à ce que les étapes soient prêtes, puis les lit.
   On espace les demandes : la première minute est celle où ça peut aboutir
   vite, ensuite ça ne sert à rien d'insister toutes les trois secondes. */
async function attendreEtapesIA(procId) {
  const debut = Date.now()
  let tour = 0
  noterAnalyseEnCours(procId)

  while (Date.now() - debut < 8 * 60000) {
    const rep = await fetch(`${SUPABASE_URL}/functions/v1/ai-check`, {
      method: 'POST',
      /* ⚠ 25 SECONDES ÉTAIT TROP COURT, ET C'EST MOI QUI L'AVAIS POSÉ.

         Un sondage ordinaire répond en moins d'une seconde. Mais UN sondage
         sur toute l'analyse fait bien plus : c'est celui qui trouve Azure
         terminé, et qui enchaîne alors le classement puis la rédaction des
         étapes par Claude — trente à quatre-vingt-dix secondes sur une longue
         transcription.

         Ma limite le coupait en plein travail. Pire : quand le client se
         déconnecte, Supabase peut interrompre la fonction — la procédure
         restait alors bloquée en « redaction », et le sondage suivant lisait
         un état qui ne bougeait plus.

         120 secondes. Les autres sondages n'attendent pas pour autant : ils
         répondent en une seconde et n'atteignent jamais ce plafond. */
      signal: AbortSignal.timeout(120000),
      headers: await enTeteFonction(),
      body: JSON.stringify({ procedure_id: procId }),
    })
    const data = await rep.json()

    if (data.status === 'ready') {
      oublierAnalyse()
      const { data: etapes } = await supabase.from('etapes')
        .select('texte').eq('procedure_id', procId).order('ordre')
      return (etapes || []).map(e => String(e.texte || '').trim()).filter(Boolean)
    }
    if (data.status === 'error' || data.error) {
      oublierAnalyse()
      throw new Error(data.error || "L\u2019analyse a \u00e9chou\u00e9.")
    }

    tour++
    const delai = tour < 12 ? 3000 : tour < 30 ? 5000 : 8000
    await new Promise(r => setTimeout(r, delai))
  }
  oublierAnalyse()
  throw new Error("L\u2019analyse prend trop de temps. R\u00e9essayez, ou \u00e9crivez les \u00e9tapes vous-m\u00eame.")
}

/* L'annulation de l'écran de modification. Elle a sa PROPRE pile : les deux
   écrans ne travaillent pas sur la même liste, et partager la pile ferait
   ressurgir les étapes d'une création dans une modification. */
let pileEdition = []

function memoriserEdition() {
  pileEdition.push(JSON.stringify(editStepsData))
  if (pileEdition.length > PILE_MAX) pileEdition.shift()
  majBoutonDefaireEdit()
}

function majBoutonDefaireEdit() {
  const b = document.getElementById('edit-defaire')
  if (b) b.disabled = pileEdition.length === 0
}

document.getElementById('edit-defaire')?.addEventListener('click', () => {
  const avant = pileEdition.pop()
  if (avant === undefined) return
  const ouEtaitOn = window.scrollY
  editStepsData = JSON.parse(avant)
  renderEditSteps()
  window.scrollTo({ top: ouEtaitOn })
  majBoutonDefaireEdit()
  if (navigator.vibrate) navigator.vibrate(6)
})

/* Le code du choix geste/écran est retiré avec ses boutons : l'image est
   toujours analysée, c'est `ai-start` qui le décide désormais. */

function goToCreateMode(mode) {
  if (mode === 'ai') resetAiScreen()
  if (mode === 'doc') { resetDocScreen(); showGestionScreen('p-create-doc'); return }
  if (mode === 'manual') { ouvrirEtapesManuelles(null); return }
  else if (mode === 'video') { ouvrirMontageVideo(null); return }
  else showGestionScreen('p-create-ai')
}
window.goToCreateMode = goToCreateMode

/* ═══════════════════════════════════════════════════════════════════════════
   COLLER PLUSIEURS VIDÉOS EN UNE SEULE

   Un geste filmé en cinq fois donne cinq fichiers, et l'analyse n'en accepte
   qu'un. Cet outil les met bout à bout.

   ─── COMMENT, ET POURQUOI PAS AUTREMENT ───

   On rejoue les vidéos l'une après l'autre dans LE MÊME canevas, capté par LE
   MÊME enregistreur. Celui-ci ne voit qu'un flux continu : il ignore qu'il y a
   eu cinq fichiers.

   L'autre voie était `ffmpeg.wasm` : vingt-cinq mégaoctets à télécharger avant
   de commencer, lent sur téléphone, et rien ne garantit qu'il passe le réseau.
   Écartée.

   ─── CE QUE CETTE MÉTHODE DONNE EN PRIME ───

   Le collage EST une compression. Le canevas fait 1280×720, l'enregistreur
   tourne à 1,4 Mb/s : cinq vidéos 4K de 400 Mo au total ressortent à une
   trentaine de mégaoctets. Il n'y a pas de seconde étape à prévoir.

   C'est pourquoi LE POIDS D'ENTRÉE NE LIMITE RIEN. On l'affiche — c'est
   demandé, et c'est rassurant — mais ce qui décide est la DURÉE CUMULÉE :
   après recompression, le poids n'en dépend plus que d'elle.

   ─── LE SON ───

   Un seul point d'arrivée audio pour tout le collage, et chaque vidéo s'y
   branche à son tour. L'enregistreur voit une piste sonore unique du début à
   la fin — c'est indispensable : lui changer sa piste en cours de route
   produirait un fichier illisible.
   ═══════════════════════════════════════════════════════════════════════════ */

let collageFichiers = []      // { fichier, duree, largeur, hauteur }
let collageResultat = null    // le Blob produit
let collageEnAttente = null   // passée à l'écran IA, consommée une fois

function ouvrirCollage() {
  collageFichiers = []
  collageResultat = null
  document.getElementById('coller-resultat').style.display = 'none'
  document.getElementById('coller-input').value = ''
  dessinerCollage()
  showGestionScreen('p-coller')
}
window.ouvrirCollage = ouvrirCollage

/* Lire durée et dimensions demande de charger les métadonnées, donc d'attendre.
   On le fait UNE FOIS à l'ajout plutôt qu'à chaque affichage de la liste. */
function lireMeta(fichier) {
  return new Promise((ok) => {
    const v = document.createElement('video')
    v.preload = 'metadata'

    const fini = (duree) => {
      ok({ duree: isFinite(duree) && duree > 0 ? duree : 0,
           largeur: v.videoWidth, hauteur: v.videoHeight })
      URL.revokeObjectURL(v.src)
    }

    v.onloadedmetadata = () => {
      /* ═══ CERTAINS FICHIERS NE PORTENT PAS LEUR DURÉE ═══

         `MediaRecorder` écrit des WebM sans durée dans l'en-tête : le lecteur
         rend `Infinity`. Or c'est exactement ce que produit notre propre
         collage — recoller un collage tombait donc dessus, et les totaux
         affichaient « Infinity s ».

         LE CONTOURNEMENT EST CONNU ET LAID : on demande à se placer très loin
         dans la vidéo. Le lecteur va au bout, découvre la vraie fin, et la
         renseigne. On revient ensuite au début.

         Un garde-fou de deux secondes : si le lecteur ne répond pas, on rend
         zéro plutôt que d'attendre indéfiniment. La vidéo sera écartée avec un
         message, ce qui vaut mieux qu'une liste qui ne se remplit jamais. */
      if (isFinite(v.duration) && v.duration > 0) { fini(v.duration); return }

      const secours = setTimeout(() => { v.ontimeupdate = null; fini(0) }, 2000)
      v.ontimeupdate = () => {
        if (!isFinite(v.duration)) return
        clearTimeout(secours)
        v.ontimeupdate = null
        const d = v.duration
        try { v.currentTime = 0 } catch (e) {}
        fini(d)
      }
      try { v.currentTime = 1e101 } catch (e) { clearTimeout(secours); fini(0) }
    }

    v.onerror = () => { ok({ duree: 0, largeur: 0, hauteur: 0 }); URL.revokeObjectURL(v.src) }
    v.src = URL.createObjectURL(fichier)
  })
}

/* ═══ SIX LECTEURS AU PLUS ═══

   Le plafond au-delà duquel Safari sur iPhone cesse d'accorder des lecteurs
   vidéo, silencieusement. Mesuré à sept, lors d'un collage resté bloqué à zéro
   pour cent.

   Déclarée ICI et non près de `DUREE_REFUSEE` : cette dernière vit 1 500 lignes
   plus bas, après la fonction qui l'emploie. Ça marche pour elle — le module
   pose ses `const` avant tout appel — mais placer une constante loin de son
   seul usage oblige à la chercher. */
const COLLAGE_MAX_FICHIERS = 6

function dessinerCollage() {
  const liste = document.getElementById('coller-liste')
  const total = document.getElementById('coller-total')
  const avert = document.getElementById('coller-avert')
  const lancer = document.getElementById('coller-lancer')
  if (!liste) return

  if (collageFichiers.length === 0) {
    liste.innerHTML = ''
    total.style.display = 'none'
    avert.textContent = 'Choisissez au moins deux vidéos. Elles seront collées dans l’ordre où vous les rangez.'
    lancer.disabled = true
    return
  }

  /* Les flèches plutôt qu'un glisser-déposer : sur un téléphone, déplacer un
     élément d'une liste qui défile est le geste le plus raté de toute
     l'interface mobile. Deux boutons ne trompent personne. */
  liste.innerHTML = collageFichiers.map((f, i) => `
    <div class="coller-item">
      <span class="coller-rang">${i + 1}</span>
      <span class="coller-nom">
        <span class="txt">${escapeHtml(f.fichier.name)}</span>
        <span class="coller-meta">${dureeCourte(f.duree)} · ${poidsLisible(f.fichier.size)}</span>
      </span>
      <button class="coller-fleche" onclick="deplacerCollage(${i}, -1)" ${i === 0 ? 'disabled' : ''} aria-label="Monter">↑</button>
      <button class="coller-fleche" onclick="deplacerCollage(${i}, 1)" ${i === collageFichiers.length - 1 ? 'disabled' : ''} aria-label="Descendre">↓</button>
      <button class="coller-fleche retirer" onclick="retirerCollage(${i})" aria-label="Retirer">✕</button>
    </div>`).join('')

  const secondes = collageFichiers.reduce((s, f) => s + f.duree, 0)
  /* ═══ LES DEUX LIGNES DE POIDS ONT ÉTÉ RETIRÉES ═══

     Elles disaient « Poids des vidéos choisies » et « Poids après collage,
     environ ». Deux chiffres pour une question que personne ne se pose : ce
     qui compte est la durée, et le poids en découle.

     Elles avaient un sens quand le poids était la limite. Depuis qu'on a
     mesuré le vrai débit — 1,75 Mb/s au pire — c'est la DURÉE qui plafonne :
     cinq minutes font 63 Mo, très loin des 150 acceptés. Afficher un poids
     laissait croire à une contrainte qui n'existe plus.

     Le calcul du poids attendu part avec elles : plus rien ne le lit. */

  total.style.display = ''
  total.innerHTML = `
    <div class="coller-tot"><span>Durée totale</span><b>${dureeCourte(secondes)}</b></div>
    <div class="coller-tot"><span>Temps de collage, environ</span><b>${attenteLisible(secondes * 1.05)}</b></div>`

  /* ═══ C'EST LA DURÉE QUI REFUSE, PAS LE POIDS ═══

     Cinq clips 4K pesant 400 Mo à eux tous, mais durant deux minutes,
     ressortent à vingt-six mégaoctets. Les refuser sur leur poids d'entrée
     écarterait un montage parfaitement valide. */
  /* ═══ LE NOMBRE COMPTE AUSSI, PAS SEULEMENT LA DURÉE ═══

     Le collage crée TOUS les lecteurs d'un coup — il le faut, c'est ainsi
     qu'iOS accorde sa permission dans un seul geste. Mais sept vidéos ouvertes
     ensemble, ce sont sept décodeurs actifs et sept fichiers en mémoire.

     Sur un iPhone, au-delà de six, Safari commence à refuser des lecteurs sans
     rien dire : ils ne se chargent pas, leurs métadonnées n'arrivent jamais, et
     le collage s'arrête à zéro pour cent. C'est exactement ce que tu as vu.

     La limite est basse et je l'assume : mieux vaut deux collages de cinq que
     l'un de sept qui échoue après trois minutes d'attente. */
  if (collageFichiers.length > COLLAGE_MAX_FICHIERS) {
    avert.innerHTML = `<span style="color:var(--red)">Pas plus de ` +
      `${COLLAGE_MAX_FICHIERS} vidéos à la fois. Collez-en ` +
      `${COLLAGE_MAX_FICHIERS} d’abord, puis ajoutez le reste au résultat.</span>`
    lancer.disabled = true
  } else if (secondes > DUREE_REFUSEE) {
    avert.innerHTML = `<span style="color:var(--red)">Le total dépasse ` +
      `${Math.round(DUREE_REFUSEE / 60)} minutes. Retirez une vidéo, ou coupez-en une.</span>`
    lancer.disabled = true
  } else if (collageFichiers.length < 2) {
    avert.textContent = 'Ajoutez au moins une seconde vidéo.'
    lancer.disabled = true
  } else {
    avert.textContent = secondes > DUREE_CONSEILLEE
      ? `Au-delà de deux minutes, une procédure se suit mal debout entre deux tâches.`
      : ''
    lancer.disabled = false
  }
}

function dureeCourte(s) {
  s = Math.round(s || 0)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`
}

window.deplacerCollage = function (i, sens) {
  const j = i + sens
  if (j < 0 || j >= collageFichiers.length) return
  const t = collageFichiers[i]
  collageFichiers[i] = collageFichiers[j]
  collageFichiers[j] = t
  dessinerCollage()
}

window.retirerCollage = function (i) {
  collageFichiers.splice(i, 1)
  dessinerCollage()
}

/* ═══ LE COLLAGE ═══ */
async function collerLesVideos(surAvancee) {
  if (!peutComprimer()) throw new Error('Votre navigateur ne sait pas assembler de vidéos.')
  const type = formatEnregistrable()
  if (!type) throw new Error('Votre navigateur n’accepte aucun format d’enregistrement.')

  /* Le cadre vient de la PREMIÈRE vidéo, ramenée à 1280 de large. Les suivantes
     s'y inscrivent en gardant leurs proportions, avec des bandes noires si
     elles n'ont pas le même format. Sans cela, une prise en portrait au milieu
     de quatre prises en paysage serait étirée. */
  const p = collageFichiers[0]
  let L = p.largeur || 1280, H = p.hauteur || 720
  if (L > VIDEO_LARGEUR_MAX) { H = Math.round(H * VIDEO_LARGEUR_MAX / L); L = VIDEO_LARGEUR_MAX }
  if (H > VIDEO_HAUTEUR_MAX) { L = Math.round(L * VIDEO_HAUTEUR_MAX / H); H = VIDEO_HAUTEUR_MAX }
  L -= L % 2; H -= H % 2

  const toile = document.createElement('canvas')
  toile.width = L; toile.height = H
  const ctx = toile.getContext('2d', { alpha: false })
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, L, H)

  const flux = (toile.captureStream || toile.webkitCaptureStream).call(toile, VIDEO_IMAGES_S)

  /* ═══════════════════════════════════════════════════════════════════════
     LE DÉVERROUILLAGE · TOUT CE QUI SUIT DOIT RESTER AVANT LE PREMIER `await`
     ═══════════════════════════════════════════════════════════════════════

     ─── LE DÉFAUT ───

     Les lecteurs étaient créés au fur et à mesure, dans la boucle. Le premier
     démarrait dans la foulée du clic et passait ; les suivants arrivaient après
     plusieurs attentes — chargement, lecture de la prise précédente — et iOS
     les refusait :

         NotAllowedError · the user denied permission

     ─── POURQUOI ON NE PEUT PAS SIMPLEMENT LES COUPER ───

     Un élément muet a le droit de démarrer sans geste. Mais MESURÉ :
     `createMediaElementSource` sur un élément muet ne rend QUE DU SILENCE —
     énergie 0,0000 contre 1,0379 pour le même élément audible. Couper les
     lecteurs livrerait donc une vidéo sans son, et Azure n'aurait plus rien à
     transcrire. Le remède serait pire.

     (C'est l'inverse de `captureStream`, où `muted` n'agit que sur la sortie.
     Deux mécanismes, deux comportements opposés — j'ai mesuré les deux.)

     ─── CE QU'ON FAIT À LA PLACE ───

     On crée TOUS les lecteurs maintenant, dans le geste, et on les démarre
     puis les arrête aussitôt. iOS accorde alors sa permission à chacun, une
     fois pour toutes : la boucle pourra les relancer plus tard sans être
     refusée.

     C'est pour cela qu'aucun `await` ne doit s'intercaler au-dessus. */
  const lecteurs = collageFichiers.map((f) => {
    const v = document.createElement('video')
    v.src = URL.createObjectURL(f.fichier)
    v.playsInline = true
    v.setAttribute('playsinline', '')
    v.preload = 'auto'
    /* Audible pour le graphe. Rien ne sort des haut-parleurs : à partir de
       `createMediaElementSource`, le son ne passe plus que par le graphe, et on
       ne le raccorde jamais à la sortie. */
    v.muted = false
    v.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1;'
    document.body.appendChild(v)
    /* ═══ LA PAUSE NE DOIT PAS RATTRAPER LA LECTURE ═══

       `v.play().then(() => v.pause())` semblait suffire. Il ne suffit pas : la
       promesse se résout QUAND ELLE VEUT — parfois plusieurs secondes plus
       tard, le temps que le fichier se charge. Si la boucle a déjà relancé
       cette prise entre-temps, la pause différée l'arrête net. La vidéo ne se
       termine jamais, et le collage reste suspendu indéfiniment.

       Vu sur banc : deux clips de quatre secondes, toujours en cours au bout de
       trois minutes. Le défaut aurait été le même sur un téléphone, en pire —
       les fichiers y sont plus lourds, donc les promesses plus lentes.

       Le drapeau règle la course : dès que la boucle prend la main sur un
       lecteur, la pause de déverrouillage renonce.

       Sans `catch`, un refus remonterait en promesse non traitée. On l'ignore
       volontairement : ce qui compte est que l'APPEL parte du geste, pas qu'il
       aboutisse. */
    v.dataset.enUsage = ''
    /* ═══ LE DÉVERROUILLAGE DOIT ÊTRE SILENCIEUX ═══

       On joue chaque vidéo une fraction de seconde pour qu'iOS accorde sa
       permission. Mais à cet instant, le graphe audio N'EST PAS ENCORE
       branché — `createMediaElementSource` n'est appelé que bien plus tard,
       après le chargement des métadonnées.

       Le son sortait donc des haut-parleurs : sept vidéos qui démarrent
       ensemble, au moment où l'on touche « Coller ». C'est ce vacarme que tu
       entendais.

       On coupe le volume pendant le déverrouillage et on le rend juste après.
       `volume` et non `muted` : un élément muet reste muet pour
       `createMediaElementSource`, qui ne rendrait alors que du silence — c'est
       la mesure notée plus haut. `volume = 0` ne touche que la sortie des
       haut-parleurs, pas ce que le graphe capte. */
    v.volume = 0
    v.play().then(() => {
      if (!v.dataset.enUsage) v.pause()
      v.volume = 1
    }, () => { v.volume = 1 })
    return v
  })

  /* UN SEUL POINT D'ARRIVÉE AUDIO POUR TOUT LE COLLAGE. Chaque vidéo s'y
     branche à son tour ; la piste, elle, ne change jamais. Changer la piste
     d'un enregistrement en cours produit un fichier que rien ne relit. */
  const ctxAudio = new (window.AudioContext || window.webkitAudioContext)()
  /* ═══ `resume()` PEUT NE JAMAIS ABOUTIR ═══

     Sur iOS, un contexte audio ne se réveille que dans un geste utilisateur
     encore valide. Ici il ne l'est plus : les sept `play()` du déverrouillage
     viennent de le consommer, et chacun a pu déclencher une attente réseau.

     `await` sur une promesse qui ne se résout jamais bloque tout — la boucle
     n'atteint pas sa première vidéo, et la progression reste à 0 %. C'est ce
     que tu as vu avec sept prises : à deux ou trois, le geste tenait encore.

     On attend donc trois secondes au plus. Passé ce délai, on continue sans
     réveiller le contexte : le collage se fait, et si le son manque, il vaut
     mieux une vidéo muette qu'un écran figé. */
  if (ctxAudio.state === 'suspended') {
    await Promise.race([
      ctxAudio.resume().catch(() => {}),
      new Promise((ok) => setTimeout(ok, 3000)),
    ])
    if (ctxAudio.state === 'suspended') {
      console.warn('[collage] contexte audio non réveillé — le collage continue sans son')
    }
  }
  const arrivee = ctxAudio.createMediaStreamDestination()
  arrivee.stream.getAudioTracks().forEach((t) => flux.addTrack(t))

  const morceaux = []
  const enr = new MediaRecorder(flux, {
    mimeType: type, videoBitsPerSecond: VIDEO_DEBIT, audioBitsPerSecond: AUDIO_DEBIT,
  })
  enr.ondataavailable = (e) => { if (e.data && e.data.size) morceaux.push(e.data) }
  const fini = new Promise((ok) => { enr.onstop = ok })
  enr.start(1000)

  let courant = null
  let images = 0
  const minuterie = setInterval(() => {
    if (!courant || courant.readyState < 2) return
    /* On inscrit l'image dans le cadre sans la déformer. Le rapport le plus
       contraignant gagne, le reste devient de la bande noire. */
    const r = Math.min(L / courant.videoWidth, H / courant.videoHeight)
    const w = courant.videoWidth * r, h = courant.videoHeight * r
    if (w < L || h < H) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, L, H) }
    ctx.drawImage(courant, (L - w) / 2, (H - h) / 2, w, h)
    images += 1
  }, Math.round(1000 / VIDEO_IMAGES_S))

  const totalSec = collageFichiers.reduce((s, f) => s + f.duree, 0)
  let faites = 0

  try {
    for (let i = 0; i < collageFichiers.length; i++) {
      const f = collageFichiers[i]
      const v = lecteurs[i]

      /* ═══ ET CETTE ATTENTE AUSSI DOIT AVOIR UNE FIN ═══

         `onloadedmetadata` ne se déclenche pas toujours : un fichier corrompu,
         un format que Safari refuse à moitié, une mémoire saturée par sept
         vidéos ouvertes ensemble. Sans limite, la promesse reste en suspens et
         le collage s'arrête là où il en est.

         Quinze secondes : c'est long, et c'est voulu. Une vidéo de trois
         minutes filmée en 4K met plusieurs secondes à livrer ses métadonnées
         sur un iPhone occupé. Abandonner trop tôt ferait échouer un collage
         qui allait aboutir. */
      await new Promise((ok, ko) => {
        if (v.readyState >= 1) { ok(); return }
        const minuteur = setTimeout(
          () => ko(new Error(`« ${f.fichier.name} » n’a pas répondu. Retirez-la et réessayez.`)),
          15000)
        v.onloadedmetadata = () => { clearTimeout(minuteur); ok() }
        v.onerror = () => {
          clearTimeout(minuteur)
          ko(new Error(`« ${f.fichier.name} » n’a pas pu être lue.`))
        }
      })

      try {
        ctxAudio.createMediaElementSource(v).connect(arrivee)
      } catch (e) {
        /* Une vidéo sans piste sonore, ou un navigateur qui refuse : on
           continue sans son POUR CE CLIP plutôt que d'abandonner tout le
           collage. Les autres garderont le leur. */
        console.warn('[collage] son ignoré pour', f.fichier.name, e?.message || e)
      }

      /* Le déverrouillage a pu faire avancer la lecture de quelques images.
         On revient au début, sinon la prise commencerait tronquée. */
      try { v.currentTime = 0 } catch (e) {}

      courant = v
      v.dataset.enUsage = '1'   // la pause de déverrouillage renonce à partir d'ici
      try {
        await v.play()
      } catch (e) {
        /* Le refus d'iOS porte un nom : `NotAllowedError`. Le dire en clair
           vaut mieux que de recopier le message du navigateur, que personne
           ne peut interpréter. */
        throw new Error(e?.name === 'NotAllowedError'
          ? 'Le navigateur a refusé de lire « ' + f.fichier.name + ' ». '
            + 'Relancez le collage sans quitter cette page entre-temps.'
          : (e?.message || String(e)))
      }
      await new Promise((ok) => {
        const finir = () => { clearInterval(garde); ok() }
        v.onended = finir
        const garde = setInterval(() => {
          if (v.ended || (v.duration && v.currentTime >= v.duration - 0.15)) finir()
          if (surAvancee) {
            const avance = (faites + v.currentTime) / (totalSec || 1)
            surAvancee(Math.min(99, Math.round(avance * 100)), i + 1, collageFichiers.length)
          }
        }, 300)
      })

      faites += f.duree
      courant = null
      try { v.pause() } catch (e) {}
    }
  } finally {
    clearInterval(minuterie)
    try { enr.stop() } catch (e) {}
    /* Tous les lecteurs sont défaits ici, y compris sur le chemin d'erreur :
       ils sont créés d'avance, donc la boucle ne peut plus s'en charger. */
    lecteurs.forEach((v) => {
      try { v.pause() } catch (e) {}
      try { URL.revokeObjectURL(v.src) } catch (e) {}
      try { v.remove() } catch (e) {}
    })
  }

  await fini
  try { await ctxAudio.close() } catch (e) {}

  const attendues = totalSec * VIDEO_IMAGES_S
  const part = attendues ? images / attendues : 1
  console.log('[collage] images :', images, 'sur', Math.round(attendues), `(${Math.round(part * 100)} %)`)
  if (attendues > 0 && part < 0.66) {
    throw new Error('Votre téléphone n’a pas suivi la cadence. Fermez les autres applications et réessayez.')
  }

  const ext = type.includes('mp4') ? 'mp4' : 'webm'
  return new File(morceaux, `procedure-collee.${ext}`, { type: type.split(';')[0] })
}

/* ═══ LES BOUTONS ═══ */
document.getElementById('coller-ajouter')?.addEventListener('click', () => {
  document.getElementById('coller-input').click()
})

document.getElementById('coller-input')?.addEventListener('change', async (e) => {
  const choisis = [...(e.target.files || [])]
  if (!choisis.length) return
  /* Les fichiers écartés sont NOMMÉS. Une vidéo qui disparaît de la liste sans
     un mot laisse croire à un bug de l'app. */
  const ignorees = []
  const btn = document.getElementById('coller-ajouter')
  btn.disabled = true; btn.textContent = 'Lecture des vidéos…'
  for (const fichier of choisis) {
    const m = await lireMeta(fichier)
    if (!m.duree) {
      console.warn('[collage] durée illisible :', fichier.name)
      ignorees.push(fichier.name)
      continue
    }
    collageFichiers.push({ fichier, ...m })
  }
  /* Le MÊME libellé que dans le balisage. Deux textes différents pour un
     seul bouton, et il change de nom après le premier ajout. */
  btn.disabled = false; btn.textContent = 'Ajouter des vidéos'
  /* On vide le champ : sans cela, choisir deux fois le même fichier ne
     déclencherait pas d'événement, la valeur n'ayant pas changé. */
  e.target.value = ''
  dessinerCollage()
  if (ignorees.length) {
    document.getElementById('coller-avert').innerHTML =
      `<span style="color:var(--red)">Non ajoutée${ignorees.length > 1 ? 's' : ''} : ` +
      `${ignorees.map(escapeHtml).join(', ')} — durée illisible.</span>`
  }
})

document.getElementById('coller-lancer')?.addEventListener('click', async () => {
  const btn = document.getElementById('coller-lancer')
  const avert = document.getElementById('coller-avert')
  btn.disabled = true
  document.getElementById('coller-resultat').style.display = 'none'
  try {
    collageResultat = await collerLesVideos((pct, n, sur) => {
      btn.textContent = `Collage · ${pct}% · vidéo ${n} sur ${sur}`
    })
    const url = URL.createObjectURL(collageResultat)
    const ap = document.getElementById('coller-apercu')
    ap.src = url
    document.getElementById('coller-resume').innerHTML =
      `Une seule vidéo de <b>${poidsLisible(collageResultat.size)}</b>, ` +
      `à partir de ${collageFichiers.length} prises. Regardez-la avant de la garder : ` +
      `c’est le seul moyen de vérifier que l’ordre est le bon.`
    document.getElementById('coller-resultat').style.display = ''
    avert.textContent = ''
  } catch (err) {
    avert.innerHTML = `<span style="color:var(--red)">${escapeHtml(err?.message || String(err))}</span>`
  } finally {
    btn.textContent = 'Coller les vidéos'
    btn.disabled = false
  }
})

document.getElementById('coller-garder')?.addEventListener('click', () => {
  if (!collageResultat) return
  /* `download` sur une adresse d'objet : c'est ce qui déclenche la feuille de
     partage sur iPhone, d'où l'on enregistre dans Photos ou Fichiers. */
  const a = document.createElement('a')
  a.href = URL.createObjectURL(collageResultat)
  a.download = collageResultat.name
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 4000)
})

document.getElementById('coller-utiliser')?.addEventListener('click', () => {
  if (!collageResultat) return
  /* On repart de l'écran de création avec la vidéo déjà en main : la personne
     n'a plus qu'à nommer sa procédure. Elle n'a pas à la ressortir de ses
     photos, où elle vient à peine d'être rangée. */
  collageEnAttente = collageResultat
  showGestionScreen('p-create')
  toast('Vidéo prête — nommez la procédure, puis lancez l’analyse')
})

/* ═══════════════════════════════════════════════════════════════════════════
   GESTION : L'IA LIT UN DOCUMENT

   Le texte peut venir de trois endroits : collé à la main, extrait d'un PDF, ou
   extrait d'un Word. L'extraction se fait dans le navigateur — le fichier ne
   quitte jamais l'appareil, seul son texte part vers l'IA. C'est plus rapide,
   moins cher, et plus respectueux de ce que contiennent ces documents.

   Le résultat n'est pas publié directement : il remplit l'éditeur d'étapes
   manuelles, où la personne relit, corrige et complète avant de publier.
   ═══════════════════════════════════════════════════════════════════════════ */

const DOC_TAILLE_MAX = 12 * 1024 * 1024      // 12 Mo
const DOC_TEXTE_MAX = 60000                  // au-delà, on tronque avant d'envoyer
let docTexteExtrait = ''
let docNomFichier = ''

/* ═══ LES TROIS VOIES DU DOCUMENT ═══

   La zone montre trois entrées — coller, photo, fichier — et chacune ouvre son
   bloc. Avant, les trois étaient dépliées en même temps, séparées par des « ou » :
   l'écran faisait trois écrans, et la photo se retrouvait tout en bas. */
/* ═══════════════════════════════════════════════════════════════════════
   L'ESSAI GRATUIT
   ═══════════════════════════════════════════════════════════════════════

   Quatorze jours, puis un choix. Trois états seulement : `essai`, `actif`,
   `expire`.

   LE CALCUL VIENT DU SERVEUR, jamais du téléphone. Une horloge se recule ;
   une fonction Postgres, non. C'est la seule raison pour laquelle
   `etat_abonnement` existe côté base plutôt qu'ici.
   ═══════════════════════════════════════════════════════════════════════ */

let etatAbo = null   // { statut, jours_restants, fin_essai }

async function lireEtatAbonnement() {
  if (!currentMembre?.entreprise_id) return null
  const { data, error } = await supabase
    .rpc('etat_abonnement', { p_entreprise: currentMembre.entreprise_id })
  if (error || !data || !data.length) {
    /* Sans réponse, on n'enferme personne : la migration n'est peut-être pas
       passée. Bloquer un client parce qu'une colonne manque serait pire que
       de laisser passer quelques jours de trop. */
    etatAbo = null
    return null
  }
  etatAbo = data[0]

  /* ═══ LE COMPTE D'ANALYSES, LU EN MÊME TEMPS ═══

     Le bandeau annonçait « 13 jours d'essai restants » et rien d'autre. Or
     c'est le QUOTA qui s'épuise en premier : quinze analyses en quatorze
     jours, ça se fait en une après-midi. Un refus qui tombe sans prévenir, au
     moment précis où quelqu'un évalue le produit, est le meilleur moyen de le
     perdre.

     `reste_analyses` ne consomme rien, elle lit. On l'appelle ici plutôt que
     dans le dessin du bandeau : le dessin est synchrone et appelé à plusieurs
     endroits, une requête à chaque fois serait du gaspillage.

     Sans réponse — migration pas encore passée — on n'affiche simplement pas
     la ligne. On n'enferme personne pour une fonction manquante. */
  try {
    const { data: q } = await supabase
      .rpc('reste_analyses', { p_entreprise: currentMembre.entreprise_id })
    etatAbo.analyses = q || null
  } catch (e) { etatAbo.analyses = null }

  return etatAbo
}

function dateLisible(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

/* L'alerte, dans le langage des autres alertes de l'app : tuile de 32 px,
   titre de 14,5, deux boutons de 38. Rien de nouveau à apprendre. */
function dessinerAlerteEssai(hote) {
  const zone = document.getElementById(hote)
  if (!zone) return
  if (!etatAbo || etatAbo.statut === 'actif') { zone.style.display = 'none'; return }

  /* ═══ NI À QUELQU'UN QUI PAIE DÉJÀ AILLEURS ═══

     `etatAbo` ne connaît que l'établissement AFFICHÉ. Un gérant abonné qui crée
     un second établissement bascule dessus, et voyait « 13 jours d'essai » —
     alors qu'il paie. Le message était juste pour l'établissement, faux pour la
     personne.

     On regarde donc tous ses établissements : s'il en paie un, il ne voit plus
     ce bandeau nulle part. */
  const paieAilleurs = (mesEtablissements || [])
    .some(e => e.abonnement_statut === 'actif')
  if (paieAilleurs) { zone.style.display = 'none'; return }

  const fini = etatAbo.statut === 'expire'
  const j = etatAbo.jours_restants
  const nbProc = (allGestionProcedures || []).length
  const nbMembres = (cachedMembres || []).length || 1

  /* Le raisonnement d'origine — bleu, parce qu'un essai qui se termine n'est
     pas une faute — était juste, mais il n'a été appliqué qu'au DESSIN. La
     plaque et le cadre sont ambre depuis le passage à cette palette : un trait
     bleu au milieu ne se lisait plus comme un signal, seulement comme un
     oubli. Le dessin rejoint donc son entourage. */
  zone.className = 'alerte-essai'
  zone.style.display = 'block'
  zone.innerHTML = `
    <div class="tete">
      <span class="pic">
        <svg viewBox="0 0 24 24" fill="none" stroke="url(#logoOrIc)" stroke-width="1.9"
             stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"/><polyline points="12 6.6 12 12 15.8 14.2"/>
        </svg>
      </span>
      <span class="tx">
        <b>${fini ? 'Votre essai est termin\u00e9'
                  : `${j} jour${j > 1 ? 's' : ''} d\u2019essai restant${j > 1 ? 's' : ''}`}</b>
        <i>${fini ? `${nbProc} proc\u00e9dure${nbProc > 1 ? 's' : ''} conserv\u00e9e${nbProc > 1 ? 's' : ''}`
                  : `Jusqu\u2019au ${dateLisible(etatAbo.fin_essai)}`}</i>
      </span>
    </div>
    ${fini ? '' : `<div class="jauge"><i style="width:${Math.round((14 - j) / 14 * 100)}%"></i></div>`}
    ${(!fini && etatAbo.analyses)
      /* Le nombre d'abord, le total ensuite : « 11 analyses » se lit avant
         « sur 15 », et c'est le premier qui compte quand on décide de filmer
         ou non. À zéro on ne dit pas « 0 restantes » mais ce qu'il faut faire. */
      ? (etatAbo.analyses.reste > 0
          ? `<div class="s" style="margin-top:6px">
               <b>${etatAbo.analyses.reste} analyse${etatAbo.analyses.reste > 1 ? 's' : ''} vid\u00e9o</b>
               restante${etatAbo.analyses.reste > 1 ? 's' : ''} sur ${etatAbo.analyses.quota},
               pour toute la dur\u00e9e de l\u2019essai.</div>`
          : `<div class="s" style="margin-top:6px">
               <b>Les ${etatAbo.analyses.quota} analyses de l\u2019essai ont \u00e9t\u00e9 utilis\u00e9es.</b>
               Choisissez une offre pour continuer \u2014 vos proc\u00e9dures sont conserv\u00e9es.</div>`)
      : ''}
    <div class="s">${fini
      ? `Vous \u00eates <b>${nbMembres} membre${nbMembres > 1 ? 's' : ''}</b> : votre formule est \u00e0
         <b>39 \u20ac par mois</b>, ou 29 \u20ac en r\u00e9glant l\u2019ann\u00e9e. Tout revient d\u00e8s le paiement.`
      : `Vous pouvez activer votre abonnement d\u00e8s maintenant :
         <b>les jours restants vous sont offerts</b>.`}</div>
    <div class="actions">
      <button type="button" class="principal" data-abo-ouvrir>${
        fini ? 'Voir les formules' : 'Choisir mon abonnement'}</button>
      <button type="button" class="secondaire" data-abo-plus-tard>Plus tard</button>
    </div>`
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-abo-ouvrir]')) {
    /* DESSINER AVANT D'OUVRIR : l'écran existe mais son contenu est fabriqué à
       la demande. Sans cet appel, on arrivait sur une page vide. */
    renderAbonnements()
    showGestionScreen('p-abonnement'); marquerAboNeuf()
    return
  }
  if (e.target.closest('[data-abo-plus-tard]')) {
    const z = e.target.closest('.alerte-essai')
    if (!z) return
    /* Elle s'en va DEVANT les yeux : disparaître entre deux images laisse
       croire à une fausse manipulation. */
    z.classList.add('part')
    const fin = () => { z.style.display = 'none'; z.classList.remove('part') }
    z.addEventListener('animationend', fin, { once: true })
    setTimeout(fin, 400)
  }
})

/* Ce qui devient impossible une fois l'essai fini. On ne cache pas : on
   désactive et on l'écrit. Un bouton qui disparaît laisse croire à une panne ;
   un bouton éteint qui dit pourquoi laisse comprendre. */
function appliquerBlocageEssai() {
  const expire = etatAbo && etatAbo.statut === 'expire'
  document.body.classList.toggle('abo-expire', !!expire)

  /* Créer une entreprise : fermé. Sans ça, on recommencerait un essai tous
     les quinze jours en changeant de nom. */
  document.querySelectorAll('[data-etab-plus]').forEach(b => {
    b.disabled = !!expire
    b.title = expire ? 'Disponible avec un abonnement' : ''
  })
}

/* ═══════════════════════════════════════════════════════════════════════
   CE QUI EST NOUVEAU, ET CE QUI NE L'EST PLUS
   ═══════════════════════════════════════════════════════════════════════

   Une animation d'apparition dit : « ceci vient d'arriver ». Rejouée à chaque
   retour sur la page, elle ne dit plus rien — elle fatigue, et pire, elle fait
   croire que quelque chose a changé alors que non.

   On retient donc ce qu'on a déjà montré. Un élément ne s'anime qu'à sa
   PREMIÈRE apparition ; ensuite il est simplement là.

   La mémoire vit le temps de la session. Rouvrir l'app remet tout à plat, et
   c'est voulu : une entrée en scène au lancement est agréable, c'est la
   répétition qui lasse.
   ═══════════════════════════════════════════════════════════════════════ */

const dejaMontres = new Map()   // liste -> Set de clés

function marquerLesNeufs(conteneur, liste, selecteur) {
  const zone = typeof conteneur === 'string' ? document.getElementById(conteneur) : conteneur
  if (!zone) return
  if (!dejaMontres.has(liste)) dejaMontres.set(liste, new Set())
  const vus = dejaMontres.get(liste)

  zone.querySelectorAll(selecteur).forEach((el, i) => {
    const cle = el.dataset.key || el.dataset.id || el.textContent.slice(0, 40)
    if (vus.has(cle)) {
      el.classList.add('deja-vu')       // pas d'animation
      return
    }
    vus.add(cle)
    el.classList.add('neuf')
    /* Un léger décalage quand plusieurs arrivent ensemble : au premier
       affichage d'une liste, elles se posent l'une après l'autre plutôt que
       toutes d'un bloc. Plafonné à six — au-delà, l'attente se voit. */
    el.style.animationDelay = Math.min(i, 6) * 0.035 + 's'
  })
}

/* ═══ LA DISPARITION ═══

   Une dossier s'efface quand sa dernière procédure part. Sans animation, elle
   disparaît entre deux images : on doute d'avoir supprimé la bonne chose.

   On la fait partir DEVANT les yeux, puis on redessine. */
function faireDisparaitre(el, ensuite) {
  if (!el) { if (ensuite) ensuite(); return }
  /* On retire `neuf` avant d'ajouter `part` : une cellule qui vient d'apparaître
     et qu'on supprime aussitôt jouait les deux animations à la fois. */
  el.classList.remove('neuf')
  el.classList.add('part')
  /* Une seule fois : `animationend` se déclenche par animation, et le filet
     ci-dessous peut arriver en plus. Sans ce verrou, la suite s'exécutait
     deux fois — et la grille se redessinait deux fois de suite. */
  let clos = false
  const fin = () => {
    if (clos) return
    clos = true
    el.removeEventListener('animationend', fin)
    if (ensuite) ensuite()
  }
  el.addEventListener('animationend', fin)
  /* Filet : si l'animation ne se déclenche pas — onglet en arrière-plan,
     mouvement réduit — on continue quand même. */
  setTimeout(fin, 400)
}

/* Une clé retirée de la mémoire pourra réapparaître en s'animant : c'est juste,
   puisqu'elle aura vraiment été recréée. */
function oublierCle(liste, cle) {
  dejaMontres.get(liste)?.delete(cle)
}

/* ═══════════════════════════════════════════════════════════════════════
   L'ENTREPRISE EST COMPLÈTE
   ═══════════════════════════════════════════════════════════════════════

   L'abonnement plafonne le nombre de membres. Au-delà, on ne referme pas la
   porte en silence : on garde la demande, et on prévient le gérant.

   Refuser sans trace serait doublement mauvais. La personne ne comprend pas et
   réessaie ; le gérant ignore que son équipe s'agrandit, donc il ne passe
   jamais au palier supérieur. Tout le monde perd.

   LE COMPTE SE FAIT EN BASE. Compter côté téléphone reviendrait à demander à
   celui qui veut entrer s'il reste de la place.
   ═══════════════════════════════════════════════════════════════════════ */

/* ═══ RETROUVER UNE ENTREPRISE PAR SON CODE ═══

   La table `entreprises` ne se lit plus : on ne voit que celles dont on est
   membre. C'est ce qui empêche un concurrent de lire la liste de vos clients.

   Mais rejoindre une entreprise consiste justement à la trouver AVANT d'en être
   membre. Cette fonction côté base répond à un code exact, et à rien d'autre :
   elle rend l'identifiant et le nom, jamais une liste. Il faut connaître le
   code pour obtenir quoi que ce soit. */
async function entrepriseParCode(code) {
  const propre = String(code || '').trim().toUpperCase()
  if (!propre) return null
  const { data, error } = await supabase.rpc('entreprise_par_code', { p_code: propre })
  if (error || !data || !data.length) return null
  return data[0]
}

async function placesRestantes(entrepriseId) {
  const { data, error } = await supabase
    .rpc('places_restantes', { p_entreprise: entrepriseId })
  /* Sans réponse — la migration n'est peut-être pas passée — on laisse entrer.
     Bloquer quelqu'un parce qu'une colonne manque serait pire que d'accepter
     un membre de trop. */
  if (error || data == null) return null
  return data
}

/* Renvoie true si la personne peut entrer. Sinon dépose sa demande et le lui
   dit. */
async function verifierPlaceLibre(entrepriseId, nomEntreprise) {
  const places = await placesRestantes(entrepriseId)
  if (places === null || places > 0) return true

  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    /* `upsert` plutôt qu'`insert` : quelqu'un qui réessaie dix fois ne doit pas
       produire dix lignes rouges chez le gérant. */
    await supabase.from('demandes_acces').upsert({
      entreprise_id: entrepriseId,
      user_id: user.id,
      /* Le nom vient du COMPTE de celui qui demande, pas de `currentMembre` —
         cette variable décrit le membre de l'entreprise où l'on se trouve, pas
         le visiteur. Le gérant aurait vu son propre nom dans la liste. */
      nom: user.user_metadata?.nom || user.user_metadata?.full_name || '',
      email: user.email || '',
    }, { onConflict: 'entreprise_id,user_id' })
  }

  await confirmDialog({
    titre: 'Cette entreprise est compl\u00e8te',
    message: `« ${nomEntreprise || 'Cette entreprise'} » a atteint le nombre de membres de son ` +
      `abonnement.\n\nVotre demande a \u00e9t\u00e9 transmise \u00e0 la personne qui la g\u00e8re. ` +
      `Elle vous ouvrira l'acc\u00e8s d\u00e8s qu'une place se lib\u00e8re.`,
    confirmer: 'J\u2019ai compris',
    annuler: 'Fermer',
  })
  return false
}

/* ═══ LE BANDEAU ROUGE CHEZ LE GÉRANT ═══

   Rouge, et non ambre : il y a de l'argent en jeu et quelqu'un attend. C'est
   la seule alerte de l'app qui coûte un client si on l'ignore. */
async function peindreDemandesAcces() {
  const zone = document.getElementById('demandes-acces')
  if (!zone || !currentMembre?.entreprise_id) return
  if (currentMembre.role !== 'gestion') { zone.style.display = 'none'; return }

  const { data, error } = await supabase
    .from('demandes_acces')
    .select('id, nom, email, created_at')
    .eq('entreprise_id', currentMembre.entreprise_id)
    .order('created_at', { ascending: false })

  if (error || !data || !data.length) { zone.style.display = 'none'; return }

  /* On nomme les gens. « 3 personnes attendent » reste une statistique ;
     « Marc, Julie et 1 autre » sont des collègues à qui l'on ferme la porte. */
  const noms = data.map(d => (d.nom || d.email || 'Quelqu\u2019un').split(' ')[0])
  const liste = noms.length === 1 ? noms[0]
    : noms.length === 2 ? `${noms[0]} et ${noms[1]}`
    : `${noms[0]}, ${noms[1]} et ${noms.length - 2} autre${noms.length > 3 ? 's' : ''}`

  zone.style.display = 'block'
  zone.innerHTML = `
    <div class="tete">
      <span class="pic">
        <svg viewBox="0 0 24 24" fill="none" stroke="#FF6961" stroke-width="1.9"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
          <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
        </svg>
      </span>
      <span class="tx">
        <b>${data.length} personne${data.length > 1 ? 's' : ''} ne peu${data.length > 1 ? 'vent' : 't'} pas entrer</b>
        <i>${escapeHtml(liste)}</i>
      </span>
    </div>
    <div class="s">Votre \u00e9quipe a atteint le nombre de membres de votre abonnement.
      Passez \u00e0 l'offre sup\u00e9rieure pour leur ouvrir l'acc\u00e8s.</div>
    <div class="actions">
      <button type="button" class="principal" data-abo-ouvrir>Voir les offres</button>
      <button type="button" class="secondaire" data-demandes-voir>Qui attend ?</button>
    </div>`
}

document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-demandes-voir]')) return
  const { data } = await supabase
    .from('demandes_acces')
    .select('nom, email, created_at')
    .eq('entreprise_id', currentMembre.entreprise_id)
    .order('created_at', { ascending: false })
  await confirmDialog({
    titre: 'En attente d\u2019une place',
    message: (data || []).map(d =>
      `• ${d.nom || d.email || 'Quelqu\u2019un'}`).join('\n') || 'Personne pour l\u2019instant.',
    confirmer: 'Fermer',
    annuler: 'Voir les offres',
  /* ⚠ LE POINT-VIRGULE SÉPARAIT DEUX INSTRUCTIONS. Écrit
       `|| showGestionScreen(...); marquerAboNeuf()`, le second appel
       s'exécutait TOUJOURS — même quand la personne fermait la boîte sans
       vouloir voir les offres. La classe était alors posée sur une page qu'on
       n'ouvre pas, et la cascade ratait sa vraie ouverture.

       Les deux appels tiennent maintenant dans la même branche. */
  }) || (showGestionScreen('p-abonnement'), marquerAboNeuf())
})

function ouvrirVoieDoc(voie) {
  const blocs = { coller: 'doc-bloc-texte', photo: 'doc-bloc-photos', fichier: 'doc-bloc-fichier' }
  Object.entries(blocs).forEach(([v, id]) => {
    const b = document.getElementById(id)
    if (b) b.style.display = v === voie ? 'block' : 'none'
  })
  document.querySelectorAll('.doc-voie').forEach(b => b.classList.toggle('on', b.dataset.voie === voie))

  /* La photo et le fichier ouvrent directement le sélecteur : un bloc qui
     s'affiche pour qu'on y touche encore serait un geste de trop. */
  if (voie === 'photo') document.getElementById('doc-photo-input')?.click()
  if (voie === 'fichier') document.getElementById('doc-fichier')?.click()
  if (voie === 'coller') {
    document.getElementById('doc-texte')?.focus()
    /* Le champ est masqué au chargement, donc `scrollHeight` y vaut zéro : on
       ne peut l'ajuster qu'une fois affiché. */
    ajusterHauteurTexte()
  }
  if (navigator.vibrate) navigator.vibrate(6)
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('.doc-voie')
  if (b) ouvrirVoieDoc(b.dataset.voie)
})

function resetDocScreen() {
  docTexteExtrait = ''
  docNomFichier = ''
  const t = document.getElementById('doc-texte'); if (t) t.value = ''
  ajusterHauteurTexte()
  const f = document.getElementById('doc-fichier'); if (f) f.value = ''
  const e = document.getElementById('doc-fichier-etat'); if (e) e.style.display = 'none'
  const err = document.getElementById('doc-erreur'); if (err) err.textContent = ''
  document.getElementById('doc-saisie-card').style.display = 'block'
  document.getElementById('doc-attente-card').style.display = 'none'
  majBoutonDoc()
  docPages.forEach(p => URL.revokeObjectURL(p.apercu))
  docPages = []
  peindrePages()
}

function texteDocCourant() {
  const saisi = (document.getElementById('doc-texte')?.value || '').trim()
  return saisi || docTexteExtrait
}

/* ═══════════════════════════════════════════════════════════════════════════
   PHOTOGRAPHIER UN TEXTE

   Une recette manuscrite, une fiche plastifiée, une page de classeur : on la
   photographie plutôt que de la retaper. Plusieurs pages sont acceptées, et
   l'ordre compte — c'est lui qui fait la suite des étapes.

   On envoie les images à Claude, qui les lit directement. Un outil de
   reconnaissance de caractères classique bute sur une écriture manuscrite, une
   photo de travers ou un éclairage de cuisine ; Claude s'en accommode, et il
   comprend en même temps ce qu'il lit.
   ═══════════════════════════════════════════════════════════════════════════ */

const DOC_PAGES_MAX = 8
const DOC_PAGE_POIDS_MAX = 4 * 1024 * 1024
let docPages = []   // { fichier, apercu }

document.getElementById('doc-photo-input')?.addEventListener('change', (e) => {
  ajouterPages([...e.target.files])
  e.target.value = ''
})
document.getElementById('doc-photo-plus')?.addEventListener('click', () => {
  document.getElementById('doc-photo-input').click()
})

function ajouterPages(fichiers) {
  const err = document.getElementById('doc-erreur')
  const place = DOC_PAGES_MAX - docPages.length
  if (place <= 0) {
    err.style.color = 'var(--orange)'
    err.textContent = `${DOC_PAGES_MAX} pages au maximum. Au-del\u00e0, c'est un manuel entier : d\u00e9coupez-le en plusieurs proc\u00e9dures.`
    return
  }

  const trop = fichiers.filter(f => f.size > DOC_PAGE_POIDS_MAX)
  const bons = fichiers.filter(f => f.size <= DOC_PAGE_POIDS_MAX).slice(0, place)

  if (trop.length) {
    err.style.color = 'var(--orange)'
    err.textContent = `${trop.length} photo${trop.length > 1 ? 's' : ''} trop lourde${trop.length > 1 ? 's' : ''} (plus de 4 Mo). ` +
      `Sur iPhone : R\u00e9glages \u2192 Appareil photo \u2192 Formats \u2192 Haute efficacit\u00e9.`
  } else if (err.style.color === 'var(--orange)') {
    err.textContent = ''
  }

  bons.forEach(f => docPages.push({ fichier: f, apercu: URL.createObjectURL(f) }))

  /* Une photo remplace le texte collé : on ne mélange pas les sources, sinon
     personne ne sait ce que l'IA a vraiment lu. */
  if (docPages.length) {
    document.getElementById('doc-texte').value = ''
    ajusterHauteurTexte()
    docTexteExtrait = ''
    const e = document.getElementById('doc-fichier-etat'); if (e) e.style.display = 'none'
  }
  peindrePages()
}

function peindrePages() {
  const zone = document.getElementById('doc-photos')
  const vide = document.getElementById('doc-photos-vide')
  const liste = document.getElementById('doc-photos-liste')
  const plus = document.getElementById('doc-photo-plus')
  if (!liste) return

  zone.classList.toggle('remplie', docPages.length > 0)
  vide.style.display = docPages.length ? 'none' : ''
  plus.style.display = (docPages.length && docPages.length < DOC_PAGES_MAX) ? '' : 'none'

  liste.innerHTML = docPages.map((p, i) => `
    <div class="doc-page" data-page="${i}">
      <span class="rg">${i + 1}</span>
      <span class="vg"><img src="${p.apercu}" alt=""></span>
      <span class="nm">${escapeHtml(p.fichier.name)}</span>
      <button type="button" class="oter" data-oter="${i}">Retirer</button>
    </div>`).join('')

  liste.querySelectorAll('[data-oter]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      const i = Number(b.dataset.oter)
      URL.revokeObjectURL(docPages[i].apercu)
      docPages.splice(i, 1)
      peindrePages()
      majBoutonDoc()
    })
  })

  /* L'appui long réordonne, comme les étapes. Même geste, même endroit du
     cerveau — on n'apprend pas deux façons de faire la même chose. */
  activerGlissementEtapes(liste, () => docPages, () => { peindrePages(); majBoutonDoc() })
  majBoutonDoc()
}

/* Les images partent en base64. C'est plus lourd qu'un envoi binaire, mais ça
   traverse la fonction serveur sans manipulation particulière — et à huit pages
   de quatre mégaoctets, on reste très en dessous des limites. */
async function pagesEnBase64() {
  return Promise.all(docPages.map(p => new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve({
      type: p.fichier.type || 'image/jpeg',
      donnees: String(r.result).split(',')[1],
    })
    r.onerror = () => reject(new Error('Photo illisible : ' + p.fichier.name))
    r.readAsDataURL(p.fichier)
  })))
}

function majBoutonDoc() {
  const btn = document.getElementById('doc-generer')
  if (!btn) return
  const t = texteDocCourant()
  /* Des photos suffisent : c'est Claude qui en tirera le texte. */
  btn.disabled = docPages.length === 0 && t.length < 40
  const err = document.getElementById('doc-erreur')
  if (err && t.length > 0 && t.length < 40) {
    err.style.color = 'var(--label-3)'
    err.textContent = 'Encore un peu de texte : il en faut au moins quelques phrases.'
  } else if (err && err.style.color === 'var(--label-3)') {
    err.textContent = ''
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   LA ZONE DE TEXTE SUIT SON CONTENU

   Elle avait `rows="7"` et rien d'autre : sept lignes, quoi qu'on y mette. Une
   note de service en fait trente — on collait, on ne voyait plus qu'un
   septième de ce qu'on venait de coller, et il fallait faire défiler dans un
   champ minuscule pour se relire.

   ─── POURQUOI EN JAVASCRIPT ET PAS EN CSS ───

   Le CSS sait le faire depuis peu, avec `field-sizing: content`. Chrome le
   connaît, Safari pas encore de façon sûre — et c'est Safari qui compte ici.
   On mesure donc à la main.

   ─── LA MÉCANIQUE, ET SON PIÈGE ───

   On remet la hauteur à zéro AVANT de lire `scrollHeight`. Sans cette remise,
   `scrollHeight` ne descend jamais : il rend la hauteur actuelle tant que le
   contenu y tient, et le champ grandirait sans jamais rétrécir quand on
   efface.

   ─── UN PLAFOND, PARCE QU'UN CHAMP SANS FIN EST PIRE ───

   À trente lignes, le bouton « Créer » sortirait de l'écran et personne ne le
   trouverait. Au-delà de 55 % de la hauteur de la fenêtre, le champ garde sa
   taille et défile — on voit toujours où l'on écrit ET ce qu'on doit toucher
   ensuite. */
const TEXTE_MAX_PART = 0.55

function ajusterHauteurTexte() {
  const t = document.getElementById('doc-texte')
  if (!t) return
  const plafond = Math.round(window.innerHeight * TEXTE_MAX_PART)
  t.style.height = 'auto'
  const voulu = t.scrollHeight
  t.style.height = Math.min(voulu, plafond) + 'px'
  t.style.overflowY = voulu > plafond ? 'auto' : 'hidden'
}
window.ajusterHauteurTexte = ajusterHauteurTexte

/* La fenêtre change de hauteur quand le clavier s'ouvre : le plafond bouge
   avec elle, sinon le champ recouvrirait le clavier sur un petit écran. */
window.addEventListener('resize', () => {
  if (document.getElementById('doc-bloc-texte')?.style.display !== 'none') ajusterHauteurTexte()
})

document.getElementById('doc-texte')?.addEventListener('input', () => {
  ajusterHauteurTexte()
  // Un texte collé remplace le fichier : on ne mélange pas les deux sources.
  if (document.getElementById('doc-texte').value.trim()) {
    docTexteExtrait = ''
    const e = document.getElementById('doc-fichier-etat'); if (e) e.style.display = 'none'
  }
  majBoutonDoc()
})

/* ── Extraction du texte selon le type de fichier ────────────────────── */

let mammothLib = null, pdfjsLib = null

async function ensureMammoth() {
  if (mammothLib) return mammothLib
  const m = await import('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/+esm')
  mammothLib = m.default || m
  return mammothLib
}

async function ensurePdfjs() {
  if (pdfjsLib) return pdfjsLib
  const m = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.min.mjs')
  m.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs'
  pdfjsLib = m
  return pdfjsLib
}

async function extraireTexte(fichier) {
  const nom = fichier.name.toLowerCase()

  if (nom.endsWith('.txt') || nom.endsWith('.md') || fichier.type === 'text/plain') {
    return await fichier.text()
  }

  if (nom.endsWith('.docx')) {
    const mammoth = await ensureMammoth()
    const buffer = await fichier.arrayBuffer()
    const res = await mammoth.extractRawText({ arrayBuffer: buffer })
    return res.value || ''
  }

  if (nom.endsWith('.pdf')) {
    const pdfjs = await ensurePdfjs()
    const buffer = await fichier.arrayBuffer()
    const doc = await pdfjs.getDocument({ data: buffer }).promise
    const morceaux = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const contenu = await page.getTextContent()
      morceaux.push(contenu.items.map(x => x.str).join(' '))
    }
    return morceaux.join('\n\n')
  }

  if (nom.endsWith('.doc')) {
    throw new Error("Les fichiers .doc (ancien format Word) ne peuvent pas \u00eatre lus. Enregistrez-le en .docx, ou copiez son texte ci-dessus.")
  }

  throw new Error("Format non reconnu. Acceptés : PDF, Word (.docx), texte (.txt).")
}

document.getElementById('doc-fichier')?.addEventListener('change', async (e) => {
  const fichier = e.target.files[0]
  const etat = document.getElementById('doc-fichier-etat')
  const err = document.getElementById('doc-erreur')
  err.style.color = 'var(--red)'
  err.textContent = ''
  if (!fichier) return

  if (fichier.size > DOC_TAILLE_MAX) {
    err.textContent = 'Fichier trop lourd : 12 Mo maximum.'
    e.target.value = ''
    return
  }

  etat.style.display = 'flex'
  etat.innerHTML = `<span class="ic">\u23F3</span><span class="tx">
    <span class="n">${escapeHtml(fichier.name)}</span>
    <span class="s">Lecture du document\u2026</span></span>`

  try {
    const texte = (await extraireTexte(fichier)).replace(/\s+\n/g, '\n').trim()
    if (texte.length < 40) {
      throw new Error("Ce document ne contient presque pas de texte. S'il s'agit d'un PDF scann\u00e9, l'image du texte ne peut pas \u00eatre lue.")
    }
    docTexteExtrait = texte
    docNomFichier = fichier.name
    document.getElementById('doc-texte').value = ''
    ajusterHauteurTexte()
    const mots = texte.split(/\s+/).length
    etat.innerHTML = `<span class="ic">\u2705</span><span class="tx">
      <span class="n">${escapeHtml(fichier.name)}</span>
      <span class="s">${mots.toLocaleString('fr-FR')} mots lus</span></span>`
  } catch (ex) {
    docTexteExtrait = ''
    etat.style.display = 'none'
    e.target.value = ''
    err.textContent = ex instanceof Error ? ex.message : String(ex)
  }
  majBoutonDoc()
})

/* ── Envoi à l'IA, puis relecture dans l'éditeur manuel ────────────── */

document.getElementById('doc-generer')?.addEventListener('click', async () => {
  const err = document.getElementById('doc-erreur')
  err.style.color = 'var(--red)'
  err.textContent = ''

  const titre = champManuel('titre').value.trim()
  const categorie = champManuel('categorie').value.trim()
  let texte = texteDocCourant()
  if (!titre) { err.textContent = 'Le titre est obligatoire (page pr\u00e9c\u00e9dente).'; return }
  if (texte.length > DOC_TEXTE_MAX) texte = texte.slice(0, DOC_TEXTE_MAX)

  document.getElementById('doc-generer').classList.remove('fini')
  document.getElementById('doc-saisie-card').style.display = 'none'
  document.getElementById('doc-attente-card').style.display = 'block'

  /* Une progression EST attendue dès qu'un anneau tourne avec un chiffre au
     milieu. Ici on ne peut pas la connaître : l'appel à Claude ne rend rien
     avant d'avoir fini. On avance donc régulièrement jusqu'à 90 %, et les dix
     derniers pour cent attendent la vraie réponse — c'est honnête : le chiffre
     dit « ça avance », jamais « c'est bientôt fini ». */
  const figDoc = document.querySelector('#doc-attente-card .ia-fig')
  figDoc?.classList.remove('fini')
  let pctDoc = 0
  const pctDocEl = document.getElementById('doc-attente-pct')
  if (pctDocEl) pctDocEl.textContent = '0%'
  clearInterval(docMinuteur)
  docMinuteur = setInterval(() => {
    pctDoc = Math.min(90, pctDoc + (pctDoc < 60 ? 4 : 1.5))
    if (pctDocEl) pctDocEl.textContent = Math.round(pctDoc) + '%'
  }, 700)

  try {
    const rep = await fetch(`${SUPABASE_URL}/functions/v1/ai-texte`, {
      method: 'POST',
      signal: AbortSignal.timeout(60000),
      headers: await enTeteFonction(),
        body: JSON.stringify({ titre, categorie, texte, images: await pagesEnBase64() }),
    })
    const data = await rep.json()
    if (!rep.ok || data.error) throw new Error(data.error || 'La g\u00e9n\u00e9ration a \u00e9chou\u00e9.')
    if (!Array.isArray(data.etapes) || data.etapes.length === 0) {
      throw new Error("L'IA n'a pas trouv\u00e9 d'\u00e9tapes dans ce document. Il d\u00e9crit peut-\u00eatre une situation plut\u00f4t qu'une marche \u00e0 suivre.")
    }

    /* On remplit l'éditeur manuel plutôt que de publier : la personne relit,
       corrige, ajoute une photo si elle veut, puis publie elle-même. L'IA
       propose, elle ne décide pas. */
    manualSteps = data.etapes.map(e => ({ texte: String(e.texte || e).trim() })).filter(e => e.texte)
    renderManualSteps()
/* On termine à 100 %, la coche prend la place du chiffre, puis on passe à
       la relecture. Sauter cette seconde donnerait l'impression que rien ne
       s'est passé — l'écran changerait avant qu'on ait vu le résultat. */
clearInterval(docMinuteur)
if (pctDocEl) pctDocEl.textContent = '100%'
figDoc?.classList.add('fini')
await new Promise(r => setTimeout(r, 900))

    showGestionScreen('p-create-manual')
    toast(`${manualSteps.length} \u00e9tape${manualSteps.length > 1 ? 's' : ''} propos\u00e9e${manualSteps.length > 1 ? 's' : ''} \u00b7 relisez avant de publier`)
    resetDocScreen()
  } catch (ex) {
    clearInterval(docMinuteur)
    document.getElementById('doc-attente-card').style.display = 'none'
    document.getElementById('doc-saisie-card').style.display = 'block'
    err.textContent = ex instanceof Error ? ex.message : String(ex)
  }
})

// ═══════════ GESTION : L'IA transforme la vidéo en procédure ═══════════
/* Le type d'enregistrement, choisi avant l'analyse.

   `false` — on filme un geste : seule la parole porte le sens. On envoie la
   bande son, l'analyse est rapide et ne coûte presque rien.

   `true` — on enregistre un écran : le sens est ÉCRIT dedans, noms de
   transactions, libellés de champs. On envoie la vidéo pour qu'Azure lise ce
   qui est affiché. Plus lent, plus cher — on ne le paie que quand ça sert. */

let aiVideoFile = null
let aiVideoDuree = 0        // durée de la vidéo, pour estimer le temps d'analyse
let aiDebutAnalyse = 0      // heure de démarrage de l'analyse
/* L'attente totale attendue, en secondes, posée au démarrage. Elle sert à dire
   ce qu'il RESTE plutôt que ce qui s'est écoulé. `null` quand on ne sait pas —
   la durée de la vidéo n'est pas toujours lisible — et on retombe alors sur
   l'ancien affichage du temps passé. */
let aiEstimationTotale = null
/* Azure met la vidéo en file quand aucune machine n'est libre : elle attend
   sans avancer. `majProgressionIA` lit ce drapeau pour le dire. */
let aiEnFile = false
let aiNbSondages = 0
let aiPollTimer = null
let aiProcedureId = null
let aiProgressTimer = null
let aiProgressPct = 0

const AI_RING_CIRCUMFERENCE = 213.6


/* L'ancienne courbe se rapprochait de 90 % sans jamais y arriver : au bout de
   deux minutes elle semblait bloquée, alors que l'analyse tournait toujours.
   On affiche maintenant une progression rapportée à une durée estimée, et
   surtout le temps écoulé en clair — ça se voit tout de suite que ça avance. */
/* ═══ SUIVI DE L'ANALYSE ═══

   L'ancienne version fabriquait un pourcentage à partir d'une estimation : elle
   annonçait « 5 % · environ 170 s restantes » sans rien savoir de ce qui se
   passait réellement. Quand l'analyse prenait plus longtemps, le chiffre mentait,
   et quand elle finissait plus tôt il ne servait à rien.

   On n'affiche plus que ce qu'on sait vraiment :
   • l'étape en cours — envoi, transcription, rédaction ;
   • le pourcentage d'Azure quand il en donne un, et rien sinon ;
   • le temps écoulé, qui lui n'est pas une estimation.

   Sans pourcentage, l'anneau tourne au lieu de se remplir : un mouvement continu
   dit « ça travaille » sans prétendre savoir où ça en est. */

let aiEtapeCourante = 'envoi'      // envoi → transcription → redaction
let aiProgresAzure = null          // le vrai pourcentage, quand Azure en donne un

/* ═══ ON NE DÉCRIT PLUS LA MACHINE ═══

   Les phrases racontaient le fonctionnement : « la vidéo part vers le service
   d'analyse », « l'IA relit la transcription ». C'est vrai, et ça n'intéresse
   personne. Quelqu'un qui attend veut savoir OÙ IL EN EST, pas comment on s'y
   prend.

   Les titres disent maintenant l'étape du point de vue de la personne, à la
   deuxième personne quand c'est possible. Les sous-titres disparaissent : une
   phrase qui n'apprend rien vaut moins qu'une ligne vide — elle occupe la place
   et fait travailler l'œil pour rien.

   Un seul reste, sur la première phase : c'est la plus longue, et savoir qu'on
   peut partir change la façon d'attendre. */
const AI_ETAPES = {
  /* ═══ PLUS DE SOUS-TITRE ICI ═══

     « Vous pouvez quitter cette page, l'analyse continue » s'affichait DEUX
     FOIS : une fois par ce champ, une fois par la ligne qui l'ajoute
     systématiquement en gras à la fin de la phrase. Sur l'écran, cela donnait
     « … l'analyse continue. Vous pouvez quitter cette page — la procédure
     apparaîtra… ». La même information, à trois mots près, dans la même phrase.

     On garde celle du bas : elle est en gras, elle enchaîne sur ce qui se
     passera ensuite, et elle vaut pour toutes les phases. */
  envoi:         { titre: 'Pr\u00e9paration', sous: '' },
  transcription: { titre: 'Lecture de votre vid\u00e9o', sous: '' },
  redaction:     { titre: 'Mise en forme', sous: '' },
}

var aiPalierDepuis = null
function startAiProgressSimulation() {
  aiDebutAnalyse = Date.now()
  /* L'allègement est DÉJÀ fait quand on arrive ici : il ne reste qu'Azure et
     la rédaction. Le compter deux fois annoncerait le double du vrai reste. */
  aiEstimationTotale = estimerAnalyse(aiVideoDuree, false)
  aiPalierDepuis = null
  aiNbSondages = 0
  aiEtapeCourante = 'envoi'
  aiEnFile = false
  aiProgresAzure = null
  if (aiProgressTimer) clearInterval(aiProgressTimer)
  aiProgressTimer = setInterval(majProgressionIA, 1000)
  majProgressionIA()
}

/* Appelée à chaque sondage : l'étape vient de ce que répond le serveur, le
   pourcentage aussi. Rien n'est deviné ici. */
/* ═══ L'ÉCRAN D'ATTENTE, AU BOUT DE CINQ SECONDES ═══

   Les jalons s'écrivaient sous le bouton, en petit, parce qu'on les croyait
   affaire de deux secondes. Une vidéo de téléphone dément : la compression
   seule en prend souvent dix, l'envoi autant.

   Passé cinq secondes, on bascule sur le vrai écran d'attente — celui du
   grand anneau — et les jalons continuent de s'y écrire. La personne voit
   qu'on travaille au lieu de fixer un bouton qui tourne.

   `aiEcranAttente` évite de basculer deux fois : la bascule d'origine, plus
   loin, appelle la même fonction. */
let aiEcranAttente = false

function basculerVersAttente() {
  if (aiEcranAttente) return
  const dépôt = document.getElementById('ai-upload-card')
  const attente = document.getElementById('ai-progress-card')
  if (!dépôt || !attente) return
  aiEcranAttente = true
  dépôt.style.display = 'none'
  attente.style.display = 'block'
  const zone = document.getElementById('ai-error')
  if (zone) zone.textContent = ''
  startAiProgressSimulation()
}

/* Un jalon va là où la personne regarde : sous le bouton tant qu'elle y est,
   sur l'écran d'attente une fois basculée. */
function jalonUI(m) {
  if (aiEcranAttente) { signalerEtapeIA(m); return }
  const zone = document.getElementById('ai-error')
  if (!zone) return
  zone.style.color = 'var(--label-3)'
  zone.textContent = m
}

function signalerEtapeIA(etape, progres) {
  aiEtapeCourante = etape
  aiProgresAzure = (typeof progres === 'number' && progres >= 0 && progres <= 100) ? progres : null
  majProgressionIA()
}

function majProgressionIA() {
  const ecoule = (Date.now() - aiDebutAnalyse) / 1000
  const min = Math.floor(ecoule / 60), sec = Math.floor(ecoule % 60)
  const temps = min > 0 ? `${min} min ${String(sec).padStart(2, '0')}` : `${sec} s`

  /* `info` a été retiré : la phrase n'affiche plus le nom de l'étape, donc
     `AI_ETAPES` n'est plus lu ici. La table reste dans le fichier — elle
     documente les paliers, et `aiEtapeCourante` sert encore ailleurs. */
  /* Le titre ne change plus à chaque étape. « Transcription de la parole · 14 s »
     décrivait la machine et changeait toutes les vingt secondes ; on annonce
     plutôt ce qu'on obtient, une bonne fois. Le détail de l'étape et le temps
     écoulé passent dans la phrase du dessous, où ils ne bousculent rien. */
  const titre = document.getElementById('ai-progress-title')
  /* ═══ « PRESQUE PRÊT » N'ÉTAIT PAS À LA HAUTEUR ═══

     Le mot promet une fin imminente pendant sept minutes, et il ment donc
     pendant six. Passé la deuxième minute, il fait douter de l'app plutôt
     que patienter.

     « Analyse en cours » dit ce qui se passe, sans promettre de date — la date
     est juste en dessous, avec le temps restant, et c'est elle qui rassure.
     Le ton est celui du reste de l'app : on nomme le travail, on ne commente
     pas la machine. */
  if (titre) titre.textContent = t('Analyse en cours')

  /* L'anneau tourne toujours — c'est son mouvement qui dit que ça travaille,
     plus une jauge. On n'affiche le chiffre QUE si Azure en donne un vrai : un
     pourcentage inventé se trahit toujours, et il vaut mieux ne rien dire que
     de mentir sur une attente de deux minutes. */
  const pctEl = document.getElementById('ai-progress-pct')
  if (pctEl) {
    /* Le chiffre est PLAFONNÉ à 98 tant que l'analyse n'est pas rendue.

       Azure annonce 99 % dès qu'il a fini d'écouter, puis reste là pendant
       toute l'indexation — parfois deux ou trois minutes. Un 99 % immobile se
       lit comme un plantage ; 98 % laisse voir qu'il reste quelque chose à
       faire. Le 100 % ne vient qu'avec la procédure. */
    const brut = aiProgresAzure
    pctEl.textContent = brut != null ? Math.min(98, Math.round(brut)) + '%' : ''
  }


  const sous = document.getElementById('ai-progress-sub')
  if (!sous) return

  /* ═══ EN FILE : PAS DE COMPTE À REBOURS ═══

     Tant qu'Azure n'a pas commencé, aucune estimation n'a de sens — le temps
     restant dépend d'une file dont on ne connaît pas la longueur.

     Annoncer « encore 3 min » puis rester dix minutes est pire que de ne rien
     annoncer : on croit à une panne. */
  if (aiEnFile) {
    sous.textContent = 'En attente d\u2019une machine chez notre prestataire d\u2019analyse. ' +
      'Vous pouvez quitter cette page, le travail continue.'
    return
  }

  /* Le repli, quand l'estimation manque — une vidéo dont on n'a pas pu lire la
     durée. On dit alors le temps ÉCOULÉ, faute de pouvoir dire le restant.
     Toujours sans nom d'étape : le titre changeait toutes les quarante
     secondes et brouillait la lecture. */
  let phrase = `${temps} d\u2019analyse.`

  /* ═══ LE TEMPS QUI RESTE, PAS SEULEMENT CELUI QUI PASSE ═══

     « 4 min 12 » écoulées ne disent pas si l'on est au tiers ou à la fin. Le
     reste se déduit de l'estimation faite avant le lancement : Azure suit la
     durée de la vidéo, on sait donc à peu près où l'on en est.

     ON NE L'AFFICHE PAS SI L'ESTIMATION EST DÉPASSÉE. Annoncer « encore 0 min »
     pendant trois minutes serait pire que de ne rien dire — le message du
     palier, plus bas, prend alors le relais et explique ce qui se passe. */
  /* ═══ LE TEMPS TOTAL, PAS L'ÉTAPE EN COURS ═══

     Le message disait « Extraction des images · encore 3 min ». Deux
     informations pour une seule attente : le nom de l'étape change toutes les
     quarante secondes, et il donne l'impression que le compte à rebours
     recommence à chaque fois.

     Il ne reste que le temps jusqu'à la procédure finie. C'est la seule chose
     qu'on veut savoir quand on attend, et c'est ce qui permet de partir faire
     autre chose. */
  if (aiEstimationTotale) {
    const reste = aiEstimationTotale - ecoule
    if (reste > 20) phrase = `Encore ${attenteLisible(reste)} avant votre proc\u00e9dure.`
  }
  /* Le palier de fin a son propre message. Sans lui, on voit un chiffre figé
     sans savoir si quelque chose avance encore — c'est exactement le moment
     où l'on ferme l'onglet. */
  if (aiProgresAzure != null && aiProgresAzure >= 97) {
    if (aiPalierDepuis == null) aiPalierDepuis = Date.now()
    const auPalier = (Date.now() - aiPalierDepuis) / 1000
    if (auPalier > 25) {
      phrase = t('L’écoute est terminée. L’IA met la procédure au propre — ') +
               t('c’est la dernière étape, elle prend souvent une à trois minutes.')
    }
  } else {
    aiPalierDepuis = null
  }
  if (ecoule > 15 * 60) {
    phrase = t("C'est plus long que d'habitude, mais l'analyse tourne toujours.")
  }

  sous.innerHTML = `${phrase} <b style="color:#fff;">${t('Vous pouvez quitter cette page')}</b> \u2014 ` +
    escapeHtml(t("la proc\u00e9dure appara\u00eetra dans votre liste d\u00e8s qu'elle sera pr\u00eate."))
}

function stopAiProgressSimulation(finalPct) {
  if (aiProgressTimer) { clearInterval(aiProgressTimer); aiProgressTimer = null }
  /* L'anneau n'est plus une jauge : à la fin on affiche simplement le chiffre
     s'il y en a un, et la carte cède la place à celle de réussite. */
  const pctEl = document.getElementById('ai-progress-pct')
  if (pctEl && finalPct != null) pctEl.textContent = Math.round(finalPct) + '%'

  /* Fin de l'analyse vidéo : même achèvement que pour le document — le chiffre
     s'efface, la coche prend sa place au centre de l'anneau. */
  const figAi = document.querySelector('#ai-progress-card .ia-fig')
  if (figAi) figAi.classList.toggle('fini', finalPct != null && finalPct >= 100)
}

function resetAiScreen() {
  document.getElementById('ai-video-input').value = ''
  document.getElementById('ai-video-player').style.display = 'none'
  document.getElementById('ai-video-placeholder').style.display = 'block'
  /* Le bouton retrouve son état neuf. Sans ces deux lignes, il gardait la coche
     et l'anneau de l'analyse précédente : on revenait sur la page avec un bouton
     qui disait « c'est fait » alors qu'il n'y avait rien à faire. */
  const bLance = document.getElementById('ai-launch-btn')
  bLance.classList.remove('travaille', 'fini')
  bLance.disabled = true
  document.getElementById('ai-error').textContent = ''

  /* ═══ LA VIDÉO COLLÉE SURVIT À LA REMISE À ZÉRO ═══

     `goToCreateMode('ai')` appelle cette fonction AVANT d'ouvrir l'écran : une
     vidéo posée depuis l'outil de collage y était effacée aussitôt, et la
     personne devait aller la rechercher dans ses photos — là où elle venait
     d'être enregistrée trente secondes plus tôt.

     On la reprend donc après la remise à zéro, et on vide la variable : elle
     ne sert qu'une fois, sinon elle reviendrait à chaque nouvelle procédure. */
  if (collageEnAttente) {
    const v = collageEnAttente
    collageEnAttente = null
    setTimeout(() => chargerVideoPourIA(v), 0)
  }
  const detail = document.getElementById('ai-detail')
  if (detail) detail.style.display = 'none'
  aiEcranAttente = false
      document.getElementById('ai-upload-card').style.display = 'block'
  document.getElementById('ai-progress-card').style.display = 'none'
  document.getElementById('ai-done-card').style.display = 'none'
  aiVideoFile = null
  aiProcedureId = null
  if (aiPollTimer) { clearTimeout(aiPollTimer); aiPollTimer = null }
  stopAiProgressSimulation(0)
}

document.getElementById('ai-video-input')?.addEventListener('change', (e) => {
  const file = e.target.files[0]
  if (!file) return
  chargerVideoPourIA(file)
})

/* ═══ EXTRAIT DU GESTIONNAIRE, POUR QUE LE COLLAGE PUISSE L'EMPRUNTER ═══

   Une vidéo collée doit arriver sur cet écran exactement comme une vidéo
   choisie dans Photos : même lecteur, même durée relevée, même bouton activé,
   même contrôle de durée. Recopier ces lignes ailleurs aurait créé deux chemins
   qui divergeraient à la première correction. */
function chargerVideoPourIA(file) {
  aiVideoFile = file
  const url = URL.createObjectURL(file)
  const player = document.getElementById('ai-video-player')
  player.src = url
  player.style.display = 'block'
  document.getElementById('ai-video-placeholder').style.display = 'none'
  /* ═══ LE BOUTON RESTE FERMÉ TANT QU'ON NE SAIT PAS ═══

     Il était activé ICI, avant que la durée soit connue — `loadedmetadata`
     n'arrive que quelques centaines de millisecondes plus tard, parfois
     davantage sur un gros fichier.

     Quelqu'un de rapide touchait donc « Lancer » pendant cet intervalle, et
     l'analyse partait sans qu'aucun contrôle n'ait eu lieu. C'est ce qui s'est
     passé avec ta vidéo de 5 min 01.

     Le bouton s'ouvre maintenant dans `verifierDureeVideo`, une fois la durée
     lue — et seulement si elle passe. */
  document.getElementById('ai-launch-btn').disabled = true
  aiVideoDuree = 0
  player.addEventListener('loadedmetadata', () => {
    if (isFinite(player.duration)) aiVideoDuree = player.duration
    verifierDureeVideo()
    /* Safari sur iPhone ne peint AUCUNE image tant qu'on n'a pas demandé une
       position. `load()` ne suffit pas : le lecteur reste noir. On avance d'un
       dixième de seconde, ce qui force le rendu d'une vraie image. */
    try { player.currentTime = 0.1 } catch (e) {}
  }, { once: true })
}

/* Deux seuils. Au-delà de 5 minutes on prévient : l'analyse marche encore mais
   elle devient longue et le découpage moins sûr. Au-delà de 20, on refuse : la
   transcription dépasse ce que le modèle peut mettre en forme d'un seul tenant,
   et l'échec est quasi certain. Mieux vaut le dire avant l'envoi qu'après dix
   minutes d'attente. */
/* Cinq minutes passent sans aucune réserve : c'est la durée d'une vraie
   procédure filmée, et l'analyse la traite bien. Au-delà on refuse — la
   transcription dépasse ce que le modèle met en forme d'un seul tenant, et
   l'échec est quasi certain. Mieux vaut le dire avant l'envoi qu'après dix
   minutes d'attente. */
/* DEUX MINUTES, ET C'EST UN CONSEIL. Au-delà l'analyse marche parfaitement —
   Emilien vient d'en passer une de 3 min 30. Mais l'allègement ET Azure suivent
   tous deux la durée : moitié moins de vidéo fait moitié moins d'attente, et
   coûte moitié moins cher en minutes Azure. Le refus, lui, reste à cinq. */
const DUREE_CONSEILLEE = 2 * 60
/* Cinq minutes. Au-delà, l'analyse marcherait encore, mais deux choses la
   déconseillent : le coût Azure suit la durée à la minute près, et surtout une
   procédure de dix minutes ne se suivrait pas — on la regarde une fois, jamais deux. */
const DUREE_REFUSEE = 5 * 60

/* ═══════════════════════════════════════════════════════════════════════════
   COMBIEN DE TEMPS ÇA VA PRENDRE

   Une analyse de sept minutes derrière un compteur qui tourne se lit comme une
   panne. La même attente, annoncée, se lit comme une attente. Rien n'est plus
   rapide — mais on cesse de se demander si c'est cassé.

   ─── LES TROIS COEFFICIENTS SONT MESURÉS, PAS ESTIMÉS ───

   ① L'ALLÈGEMENT COÛTE LE TEMPS RÉEL. `comprimerVideo` LIT la vidéo pour la
      capturer : trois minutes trente de vidéo demandent trois minutes trente.
      Mesuré sur banc : 92,6 s pour 90 s, soit 1,03. On retient 1,05, un
      téléphone étant plus lent qu'un ordinateur.

   ② AZURE TOURNE À PEU PRÈS À 0,8 FOIS LA DURÉE avec le préréglage `Default`,
      qui lit à la fois la parole, le texte à l'écran et les objets. Déduit du
      cas réel d'Emilien : 7 min au total pour 3 min 30 de vidéo, dont 3 min 40
      d'allègement et une minute d'envoi et de rédaction.

   ③ L'ENVOI ET LA RÉDACTION comptent pour une minute forfaitaire. L'envoi
      dépend du réseau, qu'on ne connaît pas ; une minute est une valeur haute
      sur une vidéo allégée à une quarantaine de mégaoctets.

   ON ARRONDIT VERS LE HAUT, toujours. Une attente plus courte qu'annoncée est
   une bonne surprise ; l'inverse est un mensonge. */
const COUT_ALLEGEMENT = 1.05
const COUT_AZURE = 0.8
const COUT_FIXE = 60

function estimerAnalyse(dureeVideo, avecAllegement) {
  if (!dureeVideo || !isFinite(dureeVideo)) return null
  return Math.round(dureeVideo * ((avecAllegement ? COUT_ALLEGEMENT : 0) + COUT_AZURE) + COUT_FIXE)
}

/* `dureeLisible` existe déjà, ligne 2569, et arrondit à la minute. On ne la
   redéfinit pas : deux fonctions du même nom, et c'est la dernière chargée qui
   gagne, au hasard de l'ordre du fichier.

   Une seule différence justifie une fonction à part : ici on arrondit VERS LE
   HAUT. Une attente plus courte qu'annoncée est une bonne surprise ; l'inverse
   est un mensonge. `dureeLisible` arrondit au plus proche, ce qui annoncerait
   4 min pour une attente de 4 min 25. */
function attenteLisible(sec) {
  if (sec == null) return ''
  if (sec < 60) return `${Math.max(10, Math.round(sec / 10) * 10)} s`
  return `${Math.ceil(sec / 60)} min`
}

/* ═══════════════════════════════════════════════════════════════════════════
   LE POIDS DE LA VIDÉO, ET SA BANDE SON

   Deux problèmes distincts, deux réponses.

   1. Supabase refuse les envois au-delà de 50 Mo. Un enregistrement d'écran de
      dix minutes en 1080p en pèse trois cents : l'envoi échouait, et le message
      d'erreur ne disait pas quoi faire. On le dit AVANT, avec la marche à
      suivre.

   2. Azure n'analyse que la parole — `indexingPreset: 'AudioOnly'`. Lui envoyer
      la vidéo entière lui fait télécharger cinquante mégaoctets pour n'en lire
      que la bande son. On extrait donc l'audio dans le navigateur et on ne lui
      donne que ça : l'analyse démarre plus vite, et le trafic sortant de
      Supabase — facturé au gigaoctet — s'effondre.

      La vidéo, elle, reste : c'est elle qu'on rejoue extrait par extrait dans
      la fiche. On ne la remplace pas, on épargne seulement son transport.
   ═══════════════════════════════════════════════════════════════════════════ */

/* 150 Mo.

   Le plafond était à 45 Mo, hérité d'une époque où l'on n'osait pas comprimer.
   Depuis, l'application réduit elle-même en 1080p à 30 images : cinq minutes
   pesent alors 94 Mo. À 45, on refusait donc des vidéos que l'on savait traiter.

   ═══ 90 MO, ET NON 150 ═══

   Le calcul est fermé : cinq minutes au débit de 2,5 Mb/s font exactement
   89 Mo. C'est le plafond que produit NOTRE compression, pas une estimation.

   150 laissait passer des fichiers que la compression aurait dû réduire — soit
   qu'elle ait échoué, soit qu'elle ait été contournée. Ces fichiers-là partent
   sur Azure et coûtent le double sans rien apporter : l'analyse ne lit pas
   mieux une vidéo lourde.

   90 refuse ce qui n'est manifestement pas passé par la compression, et laisse
   passer tout ce qui l'a été. La marge d'un mégaoctet suffit : le calcul est
   déterministe, il n'y a pas de scène « plus détaillée » qui gonflerait le
   résultat — le débit est imposé à l'encodeur. */
const VIDEO_POIDS_MAX = 150 * 1024 * 1024

function poidsLisible(o) {
  return o >= 1024 * 1024 ? Math.round(o / 1024 / 1024) + ' Mo'
       : Math.round(o / 1024) + ' Ko'
}

/* Extrait la bande son et la réécrit en WAV mono à 16 kHz — le format que la
   reconnaissance vocale attend, et le plus léger qui ne perde rien de la parole.
   Renvoie `null` si le navigateur ne sait pas décoder ce format : on retombe
   alors sur la vidéo, comme avant. */
async function extraireBandeSon(fichier) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return null

    const brut = await fichier.arrayBuffer()
    const ctx = new Ctx()
    const decode = await ctx.decodeAudioData(brut)
    ctx.close()

    // Mono, 16 kHz : la voix n'a besoin de rien de plus.
    const secondes = decode.duration
    const hors = new OfflineAudioContext(1, Math.ceil(secondes * 16000), 16000)
    const source = hors.createBufferSource()
    source.buffer = decode
    source.connect(hors.destination)
    source.start()
    const rendu = await hors.startRendering()

    // WAV 16 bits : aucun encodeur à charger, lu partout.
    const ech = rendu.getChannelData(0)
    const octets = new ArrayBuffer(44 + ech.length * 2)
    const vue = new DataView(octets)
    const txt = (pos, s) => { for (let i = 0; i < s.length; i++) vue.setUint8(pos + i, s.charCodeAt(i)) }
    txt(0, 'RIFF'); vue.setUint32(4, 36 + ech.length * 2, true); txt(8, 'WAVE')
    txt(12, 'fmt '); vue.setUint32(16, 16, true); vue.setUint16(20, 1, true)
    vue.setUint16(22, 1, true); vue.setUint32(24, 16000, true)
    vue.setUint32(28, 16000 * 2, true); vue.setUint16(32, 2, true); vue.setUint16(34, 16, true)
    txt(36, 'data'); vue.setUint32(40, ech.length * 2, true)
    for (let i = 0; i < ech.length; i++) {
      const v = Math.max(-1, Math.min(1, ech[i]))
      vue.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7FFF, true)
    }
    /* On mesure au passage le niveau sonore. Ça ne coûte rien — on tient déjà
       tous les échantillons — et ça évite d'envoyer à Azure une bande muette qui
       reviendrait vide après cinq minutes d'attente et une facture.

       On prend la crête plutôt que la moyenne : une vidéo où quelqu'un parle dix
       secondes sur cinq minutes a une moyenne quasi nulle, mais elle contient
       bien de la parole à découper. */
    let crete = 0
    for (let i = 0; i < ech.length; i++) {
      const a = Math.abs(ech[i])
      if (a > crete) crete = a
    }

    return { blob: new Blob([octets], { type: 'audio/wav' }), crete }
  } catch (e) {
    console.warn('Standix \u00b7 bande son non extraite :', e?.message || e)
    return null
  }
}

/* Sous ce seuil, il n'y a rien à transcrire. 0,01 ≈ −40 dB : au-dessus du bruit
   de fond d'un micro, très en dessous d'une voix. */
const SON_SEUIL = 0.01

/* ═══ LA COMPRESSION AVANT L'ENVOI ═══

   Un iPhone filme en 4K à 60 images par seconde. Cinq minutes pèsent alors
   700 Mo, là où le même geste tient dans 150 Mo en 1080p à 30 images.

   Ce n'est pas qu'une question de facture. Chaque lecture par un employé
   retransfère le fichier : une vidéo huit fois plus lourde coûte huit fois plus
   cher À CHAQUE CONSULTATION, et met huit fois plus de temps à s'ouvrir sur le
   téléphone de quelqu'un qui a les mains occupées.

   Trente images par seconde suffisent pour montrer un geste. Le soixante sert
   au sport ; ici il double le poids sans rien montrer de plus — Azure lui-même
   n'échantillonne que quelques images par seconde.

   La compression se fait DANS LE NAVIGATEUR, avant l'envoi. Aucun service à
   ajouter, et la vidéo d'origine ne quitte jamais le téléphone. */
/* ═══ COMBIEN DE TEMPS LE TÉLÉPHONE GARDE LE FICHIER ═══

   Une vidéo de procédure ne change jamais : une fois publiée, elle est figée.
   Rien ne justifie de la retransférer chaque fois qu'un employé la rouvre.

   Sans cette consigne, Supabase demande au navigateur de ne rien garder plus
   d'une heure. Un cuisinier qui revoit la même procédure trois fois dans la
   semaine la télécharge trois fois — et vous la payez trois fois.

   Un an. Si une vidéo devait changer, elle changerait de nom : le chemin porte
   un horodatage, donc l'ancienne adresse ne sert plus à rien. */
const CACHE_LONG = '31536000'   // un an, en secondes


/* ═══════════════════════════════════════════════════════════════════════════
   LES RÉGLAGES DE COMPRESSION

   ═══ 720p ET NON 1080p ═══

   Ce qu'on filme est un GESTE : une main qui fait quelque chose devant un plan
   fixe. Ni paysage, ni mouvement rapide, ni détail fin à examiner. Le 1080p n'y
   apporte rien qu'on puisse voir sur un téléphone, et il double le poids.

   L'employé regarde sur un écran de 390 px de large. Une source en 1280 lui
   donne déjà trois fois sa définition.

   ═══ 24 IMAGES PAR SECONDE ═══

   C'est la cadence du cinéma, et elle suffit largement à suivre une main. 30
   coûte 20 % de données de plus pour une fluidité que personne ne remarque sur
   un geste lent.

   ═══ 1,4 Mb/s ═══

   Le point où le texte d'un écran filmé reste lisible. En dessous, à 1,0, les
   mouvements vifs se brouillent. Au-dessus, on paie pour du détail invisible.

   Cinq minutes tiennent maintenant dans 50 Mo, contre 89 auparavant. */
const VIDEO_LARGEUR_MAX = 1280
const VIDEO_HAUTEUR_MAX = 720
const VIDEO_IMAGES_S = 24
const VIDEO_DEBIT = 1_400_000

/* Le son garde un débit correct : c'est LUI qu'Azure écoute pour rédiger les
   étapes. Économiser dessus coûterait la qualité de l'analyse, pas seulement
   celle de l'écoute. */
const AUDIO_DEBIT = 96_000

/* ═══ LE PLAFOND · POURQUOI 150 ET POURQUOI ON N'Y TOUCHE PAS ═══

   ─── LA MESURE, SUR LE MATÉRIEL RÉEL ───

   Un enregistrement d'écran de 3 min 30 est ressorti de l'iPhone d'Emilien à
   43,81 Mo — soit 1,75 Mb/s tout compris. C'est le PIRE CAS : le texte net et
   les aplats d'un écran sont ce qu'un codec gère le plus mal. Une vidéo filmée
   à la caméra descend trois à dix fois plus bas.

   ─── CE QUE ÇA CHANGE ───

   Au débit mesuré, la limite de DURÉE plafonne déjà tout :

       2 min → 25 Mo      5 min → 63 Mo      12 min → 150 Mo

   `DUREE_REFUSEE` vaut cinq minutes. Une vidéo acceptée ne peut donc pas
   dépasser 63 Mo, et les 150 Mo NE SERONT JAMAIS ATTEINTS. Une marge de 2,4.

   ─── POURQUOI ON LES GARDE QUAND MÊME ───

   Ce n'est plus une politique, c'est un garde-fou. Il attrape ce que la limite
   de durée ne voit pas : une vidéo dont `duration` est illisible, un fichier
   corrompu, un allègement qui n'a pas eu lieu — exactement le cas des 271 Mo.

   Le baisser ne gagnerait rien et rapprocherait le refus de cas légitimes.
   Le monter ne servirait à rien non plus, puisque le seuil n'est pas atteint.

   ⚠ CE NOMBRE DOIT ÉGALER CELUI DE SUPABASE : Storage → bucket `procedo-videos`
   → Edit bucket → File size limit. S'ils diffèrent, l'app accepte ce que le
   serveur refuse, et le refus arrive au milieu de l'envoi. */
const LIMITE_STOCKAGE = 150 * 1024 * 1024

/* Le navigateur sait-il enregistrer ? Safari sur iPhone ne l'a appris que
   récemment. Sans ce test, on planterait au lieu d'envoyer l'original. */
/* ═══ POURQUOI LA COMPRESSION N'A PAS EU LIEU ═══

   `comprimerVideo` avait SEPT sorties qui renvoyaient le fichier d'origine, et
   UNE SEULE laissait une trace. Les six autres étaient muettes : l'app
   annonçait « elle sera allégée », ne l'allégeait pas, et envoyait le fichier
   entier. Mesuré chez Emilien : 271 Mo « après allègement », soit le poids
   d'origine — et un refus de Supabase, qui plafonne à 150.

   On ne devine plus. Chaque sortie inscrit sa raison ici, et l'appelant la lit
   pour dire à la personne ce qui s'est réellement passé. */
let raisonCompression = ''

function peutComprimer() {
  return typeof MediaRecorder !== 'undefined' &&
         (typeof HTMLCanvasElement.prototype.captureStream === 'function' ||
          typeof HTMLCanvasElement.prototype.webkitCaptureStream === 'function')
}

/* ═══ LE FORMAT D'ENREGISTREMENT · LÀ OÙ IPHONE DÉCROCHAIT ═══

   La liste ne comptait que trois entrées : `video/mp4;codecs=avc1`,
   `video/webm;codecs=vp9`, `video/webm`.

   SAFARI NE CONNAÎT PAS WEBM. Pas une variante, pas une version : le format
   n'existe pas pour lui. Les deux dernières entrées ne lui servent donc à
   rien, et tout repose sur la première — une chaîne que Safari refuse souvent,
   parce qu'il attend soit `video/mp4` tout court, soit un profil complet du
   genre `avc1.42E01E`.

   Résultat : sur ordinateur, `video/webm;codecs=vp9` répondait oui et la
   compression tournait. Sur iPhone, les trois répondaient non, la fonction
   sortait par `format`, et le fichier partait intact — 271 Mo, refusés par
   Supabase. Le même code, deux comportements, aucun message.

   La liste couvre maintenant les trois écritures du MP4 avant de passer au
   WebM. L'ordre compte : on demande d'abord le plus précis, car un navigateur
   qui accepte `video/mp4` tout court accepte aussi le profil détaillé, alors
   que l'inverse n'est pas vrai.

   ET SI `isTypeSupported` N'EXISTE PAS ? Les Safari d'avant 2021 ont
   MediaRecorder sans cette méthode. Le `?.` rendait alors `undefined` pour
   tout, et on abandonnait alors que l'enregistrement aurait marché. On tente
   `video/mp4` à l'aveugle : au pire le constructeur lèvera, et le `catch`
   nommera la sortie. */
function formatEnregistrable() {
  const candidats = [
    'video/mp4;codecs=avc1.42E01E',   // profil de base, le plus largement lu
    'video/mp4;codecs=avc1',
    'video/mp4',                       // ce que Safari accepte le plus souvent
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  if (typeof MediaRecorder.isTypeSupported !== 'function') {
    console.warn('[compression] isTypeSupported absent — on tente video/mp4')
    return 'video/mp4'
  }
  for (const t of candidats) {
    if (MediaRecorder.isTypeSupported(t)) {
      console.log('[compression] format retenu :', t)
      return t
    }
  }
  return ''
}

async function comprimerVideo(fichier, surAvancee) {
  /* Remis à zéro à chaque appel : une raison qui traîne d'une vidéo à l'autre
     ferait accuser la mauvaise. */
  raisonCompression = ''
  const abandon = (code, detail) => {
    raisonCompression = code
    console.warn('[compression] non effectuée ·', code, detail || '')
    return fichier
  }

  if (!peutComprimer()) return abandon('navigateur',
    'MediaRecorder ou captureStream absent')

  const type = formatEnregistrable()
  if (!type) return abandon('format',
    'aucun format enregistrable — MediaRecorder.isTypeSupported refuse mp4, vp9 et webm')

  const lecteur = document.createElement('video')
  lecteur.src = URL.createObjectURL(fichier)
  /* ═══ MUET À L'OREILLE, PAS À L'ENREGISTREMENT ═══

     On entendait la vidéo pendant tout l'allègement — quatre minutes de son
     dans le vide, sur un téléphone qu'on tient à la main.

     C'était `muted = false`, hérité de l'époque où le son passait par un
     AudioContext. Dans ce montage-là, couper l'élément coupait TOUTE la chaîne
     et on enregistrait du silence : le commentaire aurait disparu, et Azure
     n'aurait plus rien eu à transcrire. D'où le faux.

     Depuis que le son vient de `captureStream()` sur l'élément lui-même, ce
     n'est plus vrai. MESURÉ : un élément muet capture un signal d'énergie 1,12
     contre 1,08 pour le même élément audible — identique. `muted` agit sur la
     sortie haut-parleurs, pas sur la piste capturée.

     ⚠ LE SECOND CHEMIN, L'AUDIOCONTEXT, EXIGE L'INVERSE. Il remet donc
     `muted = false` chez lui — voir le commentaire à cet endroit. */
  lecteur.muted = true
  lecteur.playsInline = true
  lecteur.setAttribute('playsinline', '')

  /* ═══ L'ÉLÉMENT DOIT ÊTRE DANS LA PAGE · LE DÉFAUT DES 10 SECONDES ═══

     Il ne l'était pas. Sur ordinateur, cela ne change rien : Chrome décode et
     rafraîchit une vidéo détachée comme les autres.

     SUR IPHONE, SAFARI ÉTRANGLE CE QU'IL NE VOIT PAS. Le `requestAnimationFrame`
     qui alimente le canevas tombe alors autour d'une passe par seconde. Sur
     3 min 30, on capture environ 240 images au lieu de 5 000 — et Safari, qui
     écrit ses MP4 à cadence fixe, en fait une vidéo de 10 SECONDES.

     C'est le pire des résultats : rien ne plante, le fichier est valide, léger,
     et il part chez Azure qui rédige trois étapes à partir de 5 % du geste.

     Un pixel, presque transparent, posé en bas de la page suffit à ce que
     Safari le considère visible. Ni `display:none` ni `opacity:0` ne
     conviennent — ils le rendraient invisible à nouveau. */
  lecteur.style.cssText =
    'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.01;' +
    'pointer-events:none;z-index:-1;'
  document.body.appendChild(lecteur)

  /* DÉCLARÉ ICI, ET ARRÊTÉ DANS LE `finally`.

     La boucle qui dessine les images appelle le compteur d'avancement à chaque
     rafraîchissement. Tant qu'elle tourne, elle réécrit « 1/3 · … % » par-dessus
     tout ce qu'on affiche.

     Elle ne s'arrêtait qu'au bout du chemin normal. La moindre erreur en cours
     de route la laissait tourner À VIE : elle recouvrait ensuite chaque message,
     y compris l'erreur elle-même — d'où ce « 99 % » figé, en rouge parce que
     l'erreur avait teinté la zone. On ne voyait pas un blocage, on voyait un
     message masqué. */
  let arret = false
  let minuterie = null

  try {
    await new Promise((ok, non) => {
      lecteur.onloadedmetadata = ok
      lecteur.onerror = () => non(new Error('lecture impossible'))
      setTimeout(() => non(new Error('trop long')), 15000)
    })

    /* ═══ LE RACCOURCI QUI LAISSAIT TOUT PASSER ═══

       La vidéo était renvoyée telle quelle si elle tenait dans 1920×1080 ET
       pesait moins de 100 Mo. Or c'est le cas de presque tout ce que filme un
       iPhone : un enregistrement d'écran de 1 min 30 en 1080p à 60 images fait
       140 Mo... mais mesure 1080 de haut, donc il passait le premier test.

       Le vrai critère n'est pas la définition, c'est le DÉBIT. On le calcule :
       poids divisé par durée. Si la vidéo est déjà plus légère que ce que
       produirait notre compression, la recomprimer ne ferait que dégrader.

       Une marge de 15 % évite de retraiter un fichier qui n'y gagnerait presque
       rien — la compression coûte une minute d'attente à l'utilisateur. */
    const large = lecteur.videoWidth, haut = lecteur.videoHeight
    if (!large || !haut) return abandon('dimensions',
      'le navigateur ne rend pas videoWidth/videoHeight')

    const duree = lecteur.duration
    if (duree && isFinite(duree) && duree > 0) {
      const debitActuel = fichier.size * 8 / duree
      if (debitActuel < VIDEO_DEBIT * 1.15 &&
          large <= VIDEO_LARGEUR_MAX && haut <= VIDEO_HAUTEUR_MAX) {
        return abandon('deja-legere',
          `${(debitActuel / 1e6).toFixed(2)} Mb/s en ${large}×${haut} — recomprimer dégraderait`)
      }
    }

    /* On garde les proportions : une vidéo filmée verticalement le reste. */
    const ratio = Math.min(VIDEO_LARGEUR_MAX / large, VIDEO_HAUTEUR_MAX / haut, 1)
    const L = Math.round(large * ratio / 2) * 2   // pair : exigé par les codecs
    const H = Math.round(haut * ratio / 2) * 2

    const toile = document.createElement('canvas')
    toile.width = L; toile.height = H
    const ctx = toile.getContext('2d')

    const flux = (toile.captureStream || toile.webkitCaptureStream).call(toile, VIDEO_IMAGES_S)

    /* ═══ LE SON · DEUX CHEMINS, LE PLUS SIMPLE D'ABORD ═══

       LE SON DOIT SUIVRE : c'est lui qu'Azure écoute. Une vidéo comprimée sans
       audio rendrait l'analyse inutile.

       ─── POURQUOI CE N'EST PLUS L'AUDIOCONTEXT QUI MÈNE ───

       L'ancienne version passait par `new AudioContext()` puis
       `createMediaElementSource`. Sur Safari iOS, ce chemin est fragile pour
       deux raisons cumulées : un contexte audio n'y démarre qu'à la suite d'un
       geste de l'utilisateur, et le `resume()` posé plus haut ne suffit pas
       toujours quand l'appel vient d'une chaîne asynchrone. Le `createMediaElementSource`
       lève alors, le `catch` renvoyait le fichier d'origine SANS RIEN DIRE, et
       l'app annonçait un allègement qui n'avait pas eu lieu.

       ─── LE CHEMIN DIRECT ───

       `HTMLMediaElement.captureStream()` rend les pistes de l'élément
       lui-même — audio comprise — sans contexte audio, sans geste requis,
       sans graphe à monter. C'est un appel, contre une quinzaine de lignes.

       L'AudioContext reste en second recours pour les navigateurs qui ne
       connaissent pas encore cette méthode. Et si les deux échouent, on ne se
       tait plus : on le dit. */
    let sonOk = false
    try {
      const capt = lecteur.captureStream || lecteur.mozCaptureStream || lecteur.webkitCaptureStream
      if (capt) {
        const pistes = capt.call(lecteur).getAudioTracks()
        if (pistes.length) { pistes.forEach(t => flux.addTrack(t)); sonOk = true }
      }
    } catch (e) { /* on tente l'autre chemin */ }

    if (!sonOk) {
      try {
        /* ═══ ICI, ON REND LE SON À L'ÉLÉMENT ═══

           Ce chemin-ci ne supporte PAS `muted`. `createMediaElementSource`
           détourne tout l'audio de l'élément vers le graphe : un élément muet
           n'y envoie que du silence, et on enregistrerait une piste vide — le
           commentaire disparaîtrait, Azure n'aurait rien à transcrire.

           Le rendre audible ne le rend pas AUDIBLE pour autant : à partir de
           `createMediaElementSource`, le son ne passe plus que par le graphe,
           et on ne raccorde jamais la sortie aux haut-parleurs. Rien ne sort.

           C'est exactement l'inverse du chemin `captureStream`, où `muted`
           n'agit que sur la sortie. Deux mécanismes, deux réglages opposés — et
           c'est pour cela qu'ils sont écrits séparément plutôt qu'une fois pour
           les deux. */
        lecteur.muted = false
        const ctxAudio = new (window.AudioContext || window.webkitAudioContext)()
        if (ctxAudio.state === 'suspended') await ctxAudio.resume()
        const source = ctxAudio.createMediaElementSource(lecteur)
        const dest = ctxAudio.createMediaStreamDestination()
        source.connect(dest)
        /* ON NE BRANCHE PAS LES HAUT-PARLEURS : rien ne doit être audible, et
           couper l'élément reviendrait à n'enregistrer que du silence, car à
           partir de `createMediaElementSource` le son ne passe plus que par le
           graphe. */
        const pistes = dest.stream.getAudioTracks()
        if (pistes.length) { pistes.forEach(t => flux.addTrack(t)); sonOk = true }
      } catch (e) {
        return abandon('audio', e?.message || String(e))
      }
    }

    if (!sonOk) return abandon('audio-vide',
      'aucune piste sonore récupérable — la vidéo en a-t-elle une ?')

    const morceaux = []
    /* Le débit AUDIO était laissé au navigateur, qui prend souvent 128 kb/s ou
       plus. Sur cinq minutes, c'est 5 Mo pour une voix qui commente un geste —
       96 kb/s suffisent amplement et en économisent deux.

       On ne descend pas plus bas : c'est cette piste qu'Azure transcrit pour
       rédiger les étapes. Une voix hachée donne des étapes fausses. */
    const enr = new MediaRecorder(flux, {
      mimeType: type,
      videoBitsPerSecond: VIDEO_DEBIT,
      audioBitsPerSecond: AUDIO_DEBIT,
    })
    enr.ondataavailable = (e) => { if (e.data.size) morceaux.push(e.data) }

    const fini = new Promise((ok) => { enr.onstop = ok })
    enr.start(1000)
    /* Surtout pas de `muted` ici : l'élément alimente le graphe audio, le
       couper reviendrait à enregistrer du silence. Rien n'est audible de toute
       façon — la sortie n'est pas raccordée aux haut-parleurs. */
    await lecteur.play()

    /* ═══ CE N'EST PLUS L'ÉCRAN QUI COMMANDE LA CADENCE ═══

       `requestAnimationFrame` suit le rafraîchissement de l'écran, et un
       navigateur l'étrangle dès qu'il juge le contenu peu visible. La cadence
       de capture dépendait donc de ce que Safari décidait d'accorder à un
       élément d'un pixel — ce qui a donné la vidéo de 10 secondes.

       Une minuterie à 24 images par seconde ne dépend de rien de tout cela.
       Elle peut prendre du retard sur un téléphone chargé, mais elle ne tombe
       pas à une image par seconde.

       ON COMPTE LES IMAGES. C'est la seule façon de savoir, à la fin, si la
       capture a suivi — et de refuser un fichier tronqué au lieu de l'envoyer. */
    let imagesDessinees = 0
    const periode = Math.round(1000 / VIDEO_IMAGES_S)

    const dessiner = () => {
      if (arret) return
      try { ctx.drawImage(lecteur, 0, 0, L, H); imagesDessinees += 1 } catch (e) {}
      if (surAvancee && lecteur.duration) {
        surAvancee(Math.min(99, Math.round(lecteur.currentTime / lecteur.duration * 100)))
      }
    }
    minuterie = setInterval(dessiner, periode)
    dessiner()

    /* LA LECTURE PEUT NE JAMAIS « FINIR ».

       On attendait `onended` seul. Si l'événement ne vient pas — onglet mis en
       arrière-plan, lecture interrompue par le système — la promesse ne se
       résout jamais et le compteur reste figé pour toujours.

       On surveille donc aussi la position : arrivé à la fin, on clôt. */
    await new Promise((ok) => {
      let clos = false
      const finir = () => { if (!clos) { clos = true; ok() } }
      lecteur.onended = finir
      const veille = setInterval(() => {
        if (lecteur.currentTime >= lecteur.duration - 0.15 || lecteur.paused) {
          clearInterval(veille); finir()
        }
      }, 400)
      setTimeout(() => { clearInterval(veille); finir() },
                 (lecteur.duration + 20) * 1000)
    })

    arret = true
    clearInterval(minuterie)
    enr.stop()

    /* ═══ LA CAPTURE A-T-ELLE SUIVI ? ═══

       Sans ce contrôle, une capture étranglée passait inaperçue : le fichier
       produit est valide, léger, et ne ressemble en rien à la vidéo d'origine.
       Il partait chez Azure, qui rédigeait des étapes à partir de ce qu'il
       avait — c'est-à-dire presque rien.

       On attend `duree × 24` images. En dessous des deux tiers, on renonce et
       on renvoie l'original : une vidéo trop lourde qu'on refuse proprement
       vaut mieux qu'une vidéo légère qui ment sur son contenu.

       Le seuil est à deux tiers et non à 95 % : un téléphone occupé perd
       quelques images sans que cela change rien à l'analyse. Ce qu'on traque
       ici est l'effondrement — 5 % au lieu de 100 —, pas la petite perte. */
    const attendues = (lecteur.duration || 0) * VIDEO_IMAGES_S
    const part = attendues ? imagesDessinees / attendues : 1
    console.log('[compression] images captur\u00e9es :', imagesDessinees,
      'sur', Math.round(attendues), `(${Math.round(part * 100)} %)`)

    if (attendues > 0 && part < 0.66) {
      return abandon('images-perdues',
        `${imagesDessinees} images captur\u00e9es sur ${Math.round(attendues)} attendues ` +
        `(${Math.round(part * 100)} %) — la vid\u00e9o produite serait tronqu\u00e9e`)
    }

    /* 99 → 100. Le compteur était plafonné à 99 pour ne pas annoncer la fin
       avant l'heure, mais rien ne le passait à 100 : il restait bloqué là
       pendant que l'encodeur terminait, et on croyait à une panne. */
    if (surAvancee) surAvancee(100)

    await fini

    const sortie = new Blob(morceaux, { type })
    /* Si la compression a grossi le fichier — ça arrive sur une vidéo déjà
       optimisée — on garde l'original. */
    if (sortie.size >= fichier.size) return abandon('plus-lourde',
      `${(sortie.size/1048576).toFixed(1)} Mo contre ${(fichier.size/1048576).toFixed(1)} Mo`)

    const ext = type.includes('mp4') ? 'mp4' : 'webm'
    return new File([sortie], (fichier.name || 'video').replace(/\.[^.]+$/, '') + '.' + ext,
                    { type })
  } catch (e) {
    /* La compression échoue ? On envoie l'original. Elle est un confort, pas une
       condition : refuser la vidéo serait pire que l'envoyer lourde.
       On garde tout de même la raison : c'est elle qui manquait. */
    return abandon('echec', e?.message || String(e))
  } finally {
    /* TOUT EST DÉFAIT ICI, y compris sur le chemin d'erreur. Une minuterie
       laissée en marche continuerait de dessiner dans le vide et de réécrire
       le compteur d'avancement par-dessus les messages ; un élément vidéo
       oublié dans la page garderait le décodeur occupé. */
    arret = true
    try { clearInterval(minuterie) } catch (e) {}
    try { lecteur.pause() } catch (e) {}
    try { lecteur.remove() } catch (e) {}
    URL.revokeObjectURL(lecteur.src)
  }
}

function verifierDureeVideo() {
  const err = document.getElementById('ai-error')
  const btn = document.getElementById('ai-launch-btn')
  if (!err || !btn) return

  /* Le poids d'abord : c'est le refus le plus fréquent, et le seul qui échouait
     jusqu'ici sans rien expliquer. */
  /* Le poids brut ne décide de rien : la vidéo sera recomprimée au lancement,
     en 1080p à 30 images. Une prise de 213 Mo en 60 images retombe couramment
     sous les 60 après ce passage.

     On ne refuse donc PLUS ici. On prévient seulement, quand le fichier est
     assez lourd pour que la compression prenne un moment — une attente qu'on
     n'a pas annoncée passe pour un blocage. */
  if (aiVideoFile && aiVideoFile.size > VIDEO_POIDS_MAX) {
    if (peutComprimer()) {
      err.style.color = 'var(--label-2)'
      /* ═══ ON ANNONCE CE QUI VA SE PASSER, ET CE QUI PEUT RATER ═══

         Le message disait « elle sera allégée » sans réserve. Or la compression
         ne réduit pas tout dans les mêmes proportions : un enregistrement
         d'écran, fait de texte net et d'aplats, résiste — mesuré, 160 Mo n'ont
         donné que 140.

         Au-delà d'un certain poids, on prévient donc que ça peut échouer, et
         on met le bouton d'information à portée de doigt : c'est le moment où
         la question se pose, pas après le refus. */
      /* 1,25 fois la limite et non 1,6. Avec 150 Mo, 1,6 mettait le seuil à
         240 Mo — on prévenait bien trop tard. À 188, on avertit dès que la
         compression risque de ne pas suffire. */
      /* ═══ L'AVERTISSEMENT DE POIDS A ÉTÉ RETIRÉ ═══

         Il annonçait « cette vidéo pèse 540 Mo, elle sera allégée mais risque
         de rester trop lourde », avec un lien « Pourquoi ? ».

         Trois lignes d'inquiétude avant même d'avoir essayé, sur un traitement
         qui réussit la plupart du temps. Si la compression échoue, l'analyse le
         dira — et ce sera un vrai problème, pas une hypothèse.

         Le bouton reste ouvert : c'était déjà le cas, l'avertissement
         n'empêchait rien. */
      err.textContent = ''
      btn.disabled = false
      return
    }
    /* Sans compression possible — navigateur trop ancien — le refus reste, mais
       le conseil devient juste : c'est la définition et la fluidité qui pèsent,
       pas la durée. Filmer plus court ne servirait à rien ici. */
    err.style.color = 'var(--red)'
    err.innerHTML = `Cette vidéo pèse <b>${poidsLisible(aiVideoFile.size)}</b>, ` +
      `au-delà des ${Math.round(VIDEO_POIDS_MAX / 1024 / 1024)} Mo acceptés, ` +
      `et votre navigateur ne sait pas l'alléger.<br>` +
      `Refilmez en <b>1080p à 30 images par seconde</b> : c'est la fluidité qui ` +
      `pèse, pas la durée.`
    btn.disabled = true
    return
  }

  /* Durée encore inconnue : on n'ouvre pas. Le bouton s'ouvrira au prochain
     passage, déclenché par `loadedmetadata`. */
  if (!aiVideoDuree) { err.textContent = ''; return }

  const min = Math.round(aiVideoDuree / 60)
  if (aiVideoDuree > DUREE_REFUSEE) {
    /* ═══ LES SECONDES, PAS L'ARRONDI ═══

       `Math.round` affichait « Cette vidéo dure 5 minutes. L'analyse accepte
       jusqu'à 5 minutes » — un refus qui se contredit lui-même. Une vidéo de
       5 min 01 doit s'annoncer comme telle, sinon le message paraît faux. */
    const m = Math.floor(aiVideoDuree / 60)
    const sc = String(Math.round(aiVideoDuree % 60)).padStart(2, '0')
    err.style.color = 'var(--red)'
    err.textContent = `Cette vidéo dure ${m} min ${sc}. L'analyse accepte jusqu'à 5 minutes.`
    btn.disabled = true
    return
  }
  err.style.color = 'var(--label-2)'

  /* ═══ ON ANNONCE LE TEMPS, ET ON DIT CE QU'IL COÛTE ═══

     Rien n'était dit ici. La personne lançait une analyse sans savoir si elle
     en avait pour trente secondes ou pour dix minutes, et sept minutes de
     silence passent pour une panne.

     AU-DELÀ DE DEUX MINUTES, ON CONSEILLE — ON NE REFUSE PAS. Le refus reste à
     cinq minutes. Entre les deux, la vidéo marche très bien : Emilien vient
     d'en passer une de 3 min 30.

     ⚠ ON NE PROMET PAS DE GAGNER DU TEMPS EN DÉCOUPANT. J'ai failli l'écrire :
     « deux vidéos de moitié prendraient 5 min chacune » — vrai, mais 10 min en
     tout contre 8 pour une seule, parce que le coût fixe se paie deux fois. Le
     découpage ne fait pas gagner de temps total, et le coût Azure ne bouge pas
     non plus : il se compte à la minute de vidéo.

     Ce qu'on gagne est ailleurs, et c'est le vrai argument : une procédure de
     deux minutes se regarde debout entre deux tâches, une de quatre non. */
  const doitAlleger = aiVideoFile && aiVideoFile.size > VIDEO_POIDS_MAX && peutComprimer()
  const estime = estimerAnalyse(aiVideoDuree, doitAlleger)

  if (aiVideoDuree > DUREE_CONSEILLEE) {
    err.innerHTML =
      `Cette vid\u00e9o dure <b>${Math.floor(aiVideoDuree / 60)} min ` +
      `${String(Math.round(aiVideoDuree % 60)).padStart(2, '0')}</b> \u2014 ` +
      `comptez <b>${attenteLisible(estime)}</b> d\u2019analyse.<br>` +
      `Une vid\u00e9o de deux minutes s\u2019analyse en ` +
      `<b>${attenteLisible(estimerAnalyse(DUREE_CONSEILLEE, doitAlleger))}</b>, ` +
      `et se suit mieux debout entre deux t\u00e2ches.`
  } else if (estime) {
    err.innerHTML = `Comptez <b>${attenteLisible(estime)}</b> d\u2019analyse.`
  } else {
    err.textContent = ''
  }
  btn.disabled = false
}

document.getElementById('ai-launch-btn')?.addEventListener('click', async () => {
  const errorEl = document.getElementById('ai-error')
  errorEl.textContent = ''
  const titre = champManuel('titre').value.trim()
  const categorie = champManuel('categorie').value.trim()

  if (!titre) { errorEl.textContent = 'Le titre est obligatoire (en haut de la page précédente).'; return }
  if (!aiVideoFile) { errorEl.textContent = 'Importez une vidéo.'; return }

  /* ═══ ON REVÉRIFIE ICI, MÊME SI LE BOUTON EST CENSÉ ÊTRE FERMÉ ═══

     Un bouton désactivé est une politesse, pas une sécurité : il se rouvre au
     moindre `disabled = false` posé ailleurs, et rien ne le signale.

     Le contrôle au lancement est le seul qui ne peut pas être contourné. Il
     coûte deux lignes et évite une analyse de dix minutes qui finira en
     échec — et des minutes Azure facturées pour rien. */
  if (aiVideoDuree > DUREE_REFUSEE) {
    const min = Math.floor(aiVideoDuree / 60)
    const sec = String(Math.round(aiVideoDuree % 60)).padStart(2, '0')
    errorEl.style.color = 'var(--red)'
    /* Le conseil « découpez-la en deux » a été retiré : quelqu'un qui vient de
       filmer sait quoi faire de sa vidéo, et un refus n'a pas à donner de leçon.
       Le message dit ce qui bloque, rien de plus. */
    errorEl.textContent = `Cette vidéo dure ${min} min ${sec}. L'analyse accepte jusqu'à 5 minutes.`
    return
  }

  const launchBtn = document.getElementById('ai-launch-btn')
  /* PAS de `setButtonLoading` ici : il remplaçait tout le contenu du bouton par
     une roue grise ordinaire, et l'anneau de l'IA disparaissait avec. On garde
     l'anneau, on efface seulement le texte — la même bascule que sur l'écran de
     découpage. */
  launchBtn.classList.add('travaille')
  launchBtn.disabled = true

  /* ═══ DEUX ATTENTES, CHACUNE À SA PLACE ═══

     La préparation et l'envoi durent quelques secondes : ça se passe SUR LE
     BOUTON, l'anneau tourne à la place des lettres. On ne change pas d'écran
     pour trois secondes — la personne verrait la page disparaître et revenir.

     L'analyse, elle, dure plusieurs minutes : on bascule alors sur l'écran
     dédié, avec le grand anneau et son pourcentage. C'est là qu'on accepte
     d'attendre, et l'écran ne fait plus que ça.

     La bascule se fait plus bas, au moment où l'analyse démarre vraiment. */

  /* ═══ LA PROCÉDURE EXISTE AVANT MÊME QU'ON TOUCHE À LA VIDÉO ═══

     Elle était créée après l'envoi, tout à la fin. « Vous pouvez quitter cette
     page » était donc un mensonge pendant les deux premières étapes : en
     partant à ce moment-là, on ne retrouvait rien — la ligne n'existait pas
     encore, et le travail en cours n'avait aucune trace.

     Elle est maintenant écrite tout de suite, en « traitement ». Elle apparaît
     dans la liste dès la première seconde, avec l'anneau de l'IA à côté de son
     nom, et on peut quitter la page sans rien perdre.

     L'adresse de la vidéo viendra la compléter plus loin. */
  try {
    const { data: nouvelle, error: errNouvelle } = await supabase
      .from('procedures')
      .insert({
        entreprise_id: currentMembre.entreprise_id,
        titre, categorie,
        sous_categorie: lireSousDossier('new-sous-categorie'),
        created_by: currentMembre.id,
        statut: 'traitement',
      })
      .select().single()
    if (errNouvelle) throw new Error(errNouvelle.message)
    aiProcedureId = nouvelle.id
    console.log('[procédure créée]', aiProcedureId)
    /* La liste se recharge sans qu'on l'attende : la procédure doit apparaître
       maintenant, pas quand le rechargement daignera finir. */
    loadGestionProcedures().catch(() => {})
  } catch (e) {
    launchBtn.classList.remove('travaille'); launchBtn.disabled = false
    errorEl.style.color = 'var(--red)'
    errorEl.textContent = "Impossible de créer la procédure : " + (e?.message || e)
    return
  }

  /* On comprime MAINTENANT, pas à l'import : l'aperçu doit rester immédiat.
     La personne voit sa vidéo tout de suite, et le travail se fait au moment
     où elle accepte d'attendre. */
  if (aiVideoFile) {
    const avant = aiVideoFile.size
    errorEl.style.color = 'var(--label-3)'
    /* Les trois premières étapes durent quelques secondes : elles s'affichent
       sous le bouton, dont l'anneau tourne. On ne change pas d'écran pour si
       peu — la page disparaîtrait et reviendrait aussitôt. */
    jalonUI('1/3 \u00b7 Pr\u00e9paration de la vid\u00e9o')
    /* Cinq secondes : au-delà, on ne fait plus patienter sous un bouton. */
    const bascule = setTimeout(basculerVersAttente, 5000)
    try {
      aiVideoFile = await comprimerVideo(aiVideoFile, (pct) => {
        jalonUI(pct >= 100
          ? '1/3 \u00b7 Finalisation de la vid\u00e9o\u2026'
          /* LE POURCENTAGE SEUL NE DIT RIEN D'UTILE. « 34 % » sur une opération
             dont on ignore la longueur ne renseigne pas ; « encore 2 min »
             renseigne. L'allègement avance à la vitesse de lecture, donc le
             reste se déduit exactement de la durée restante de la vidéo. */
          : `1/3 \u00b7 All\u00e8gement \u00b7 ${pct}%`
            + (aiVideoDuree
                ? ` \u00b7 encore ${attenteLisible(aiVideoDuree * (100 - pct) / 100 * COUT_ALLEGEMENT)}`
                : ''))
      })
    } finally { clearTimeout(bascule) }
    if (!aiEcranAttente) errorEl.textContent = ''
    /* ON RESTE EN GRIS.

       Cette ligne remettait le rouge tout de suite après la compression. Or les
       étapes 2/3 et 3/3 s'écrivent dans la MÊME zone que les erreurs : elles
       s'affichaient donc en rouge, comme des pannes, alors qu'elles annoncent
       simplement où en est le travail.

       C'est ce « 2/3 · Envoi de la vidéo » écarlate qui passait pour un bug
       depuis le début. Le rouge est désormais posé au seul endroit où il a un
       sens : quand quelque chose échoue vraiment. */
    errorEl.style.color = 'var(--label-3)'
    /* ═══ LE RÉSULTAT DE L'ALLÈGEMENT, VISIBLE ═══

       Il n'allait que dans la console — invisible sur un iPhone sans un Mac
       branché. Emilien a dû ouvrir Supabase pour savoir que sa vidéo pesait
       43,81 Mo, et jusque-là il ne pouvait pas dire si la compression avait
       fonctionné. C'est exactement la question qu'une ligne de texte répond.

       On affiche aussi la PART retirée : « 271 Mo → 44 Mo » ne dit pas grand
       chose seul, « −84 % » se lit d'un coup d'œil et se compare d'une vidéo à
       l'autre. */
    if (aiVideoFile.size < avant) {
      const part = Math.round((1 - aiVideoFile.size / avant) * 100)
      errorEl.innerHTML = `Vid\u00e9o all\u00e9g\u00e9e : ${poidsLisible(avant)} \u2192 ` +
        `<b>${poidsLisible(aiVideoFile.size)}</b> (\u2212${part}\u202f%)`
      console.log('Vid\u00e9o all\u00e9g\u00e9e :', poidsLisible(avant), '\u2192',
        poidsLisible(aiVideoFile.size), `(-${part} %)`)
    }
  }

  /* ═══ ON RECONTRÔLE LE POIDS APRÈS ALLÈGEMENT ═══

     Il n'y avait AUCUN contrôle ici. La vidéo partait vers Supabase quelle que
     soit sa taille, et c'est Supabase qui refusait — un 400 sec, au milieu de
     l'envoi, sans rien dire de compréhensible. Vu chez Emilien : 271 Mo
     « après allègement », donc pas allégés du tout, et l'analyse qui meurt à
     « 2/3 · Envoi de la vidéo ».

     Deux choses le rendaient invisible. La compression a SEPT sorties qui
     renvoient le fichier intact, dont six étaient muettes — l'app annonçait un
     allègement qui n'avait pas eu lieu. Et personne ne revérifiait ensuite.

     Maintenant on arrête avant l'envoi, et on DIT POURQUOI : `raisonCompression`
     porte le nom de la sortie empruntée. */
  if (aiVideoFile && aiVideoFile.size > LIMITE_STOCKAGE) {
    const explications = {
      'navigateur': 'votre navigateur ne sait pas all\u00e9ger les vid\u00e9os',
      'format': 'votre navigateur n\u2019accepte aucun format d\u2019enregistrement',
      'audio': 'le son n\u2019a pas pu \u00eatre repris',
      'audio-vide': 'aucune piste sonore n\u2019a \u00e9t\u00e9 trouv\u00e9e dans la vid\u00e9o',
      'dimensions': 'la vid\u00e9o n\u2019a pas pu \u00eatre lue',
      'deja-legere': 'elle \u00e9tait d\u00e9j\u00e0 au d\u00e9bit le plus bas',
      'echec': 'l\u2019all\u00e8gement s\u2019est interrompu',
      'plus-lourde': 'l\u2019all\u00e8gement l\u2019aurait alourdie',
      'images-perdues': 'votre t\u00e9l\u00e9phone n\u2019a pas suivi la cadence — '
        + 'fermez les autres applications et r\u00e9essayez',
    }
    const pourquoi = explications[raisonCompression]
    errorEl.style.color = 'var(--red)'
    errorEl.innerHTML =
      `Cette vid\u00e9o p\u00e8se encore <b>${poidsLisible(aiVideoFile.size)}</b>, ` +
      `au-del\u00e0 des ${Math.round(LIMITE_STOCKAGE / 1024 / 1024)} Mo accept\u00e9s` +
      (pourquoi ? ` : ${pourquoi}.` : '.') +
      `<br>Refilmez en <b>720p \u00e0 30 images par seconde</b>, ou plus court.`
    launchBtn.disabled = false
    console.warn('[envoi] refus\u00e9 ·', poidsLisible(aiVideoFile.size),
      '· raison de la compression :', raisonCompression || 'aucune (elle a fonctionn\u00e9)')
    return
  }

  /* Même règle pendant l'envoi : cinq secondes sous le bouton, pas plus.
     Déclaré HORS du `try` pour que le rattrapage puisse l'annuler — sinon une
     erreur survenue avant la cinquième seconde verrait quand même l'écran
     d'attente s'ouvrir par-dessus son propre message. */
  const bascule2 = setTimeout(basculerVersAttente, 5000)

  try {
    errorEl.style.color = 'var(--label-3)'
    /* ═══ LE 2/3 SE DÉCOUPE ═══

       Sous ce seul libellé se cachaient quatre opérations : le contrôle du
       poids, l'écoute de la bande son, l'envoi dans le stockage et la
       signature de l'adresse. Bloqué, on ne savait pas laquelle — et deux
       minutes trente pour vingt secondes de vidéo ne ressemblent à aucune.

       Chacune annonce son nom et le temps écoulé. La dernière ligne affichée
       est le point de blocage. */
    const t0 = Date.now()
    const chrono = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`
    const etape = (m) => {
      jalonUI(`2/3 · ${m}`)
      console.log(`[envoi ${chrono()}] ${m}`)
    }
    etape('vérification du poids…')
    // 1. Upload de la vidéo
    /* Dernier rempart sur le poids : le contrôle à la sélection peut être
       contourné si le fichier change sans repasser par l'événement. */
    /* Ce contrôle vient APRÈS la compression : c'est le poids réel de ce qu'on
     s'apprête à envoyer qui compte, pas celui du fichier d'origine. */
  if (aiVideoFile.size > VIDEO_POIDS_MAX) {
    throw new Error(`Même allégée, cette vidéo pèse ${poidsLisible(aiVideoFile.size)}, ` +
      `au-delà des ${Math.round(VIDEO_POIDS_MAX / 1024 / 1024)} Mo acceptés. ` +
      `Baissez la définition de votre caméra, ou filmez plus court.`)
  }


    /* On extrait la bande son AVANT d'envoyer quoi que ce soit. Si elle est
       muette, on refuse tout de suite : transférer 40 Mo puis attendre cinq
       minutes pour annoncer l'échec serait la pire façon de l'apprendre. */
    etape(`écoute de la bande son… (${poidsLisible(aiVideoFile.size)})`)
    const son = await extraireBandeSon(aiVideoFile)
    etape(son ? `son mesuré : crête ${son.crete.toFixed(3)}` : 'son illisible, on continue')

    if (son && son.crete < SON_SEUIL) {
      throw new Error('SANS_SON')
    }

    const base = `${currentMembre.entreprise_id}/${Date.now()}`

    // La vidéo : c'est elle qu'on rejoue, extrait par extrait, dans la fiche.
    /* ═══ LE PLAFOND DU STOCKAGE ═══

       Supabase refuse un fichier au-delà d'une taille fixée par compartiment —
       50 Mo par défaut. Le refus arrive sous forme d'un 400 sec, sans que rien
       ne prévienne : on envoyait soixante mégaoctets pour se les faire jeter.

       On regarde donc avant de partir. Et on le dit dans les termes de la
       personne : ce n'est pas « votre fichier fait 63 millions d'octets »,
       c'est « votre vidéo est trop longue ». */
    if (aiVideoFile.size > LIMITE_STOCKAGE) {
      throw new Error(
        `Cette vidéo pèse ${poidsLisible(aiVideoFile.size)} une fois allégée, ` +
        `au-delà des ${poidsLisible(LIMITE_STOCKAGE)} acceptés. ` +
        `Filmez une séquence plus courte — deux à trois minutes suffisent pour un geste.`)
    }

    const path = `${base}_${aiVideoFile.name}`
    /* ═══ UN ENVOI QUI NE RÉPOND JAMAIS ═══

       Sans limite de temps, une requête qui reste en suspens laisse l'anneau
       tourner indéfiniment : rien à lire, rien à corriger. On lui accorde
       quatre-vingt-dix secondes — trois mégaoctets en prennent deux, même sur
       un réseau médiocre — puis on le dit.

       On trace aussi le fichier : son nom, son type et son poids. Un nom vide
       ou un type inattendu suffisent à faire échouer un dépôt, et c'est
       invisible autrement. */
    console.log('[envoi] fichier', {
      nom: aiVideoFile.name, type: aiVideoFile.type,
      poids: aiVideoFile.size, chemin: path,
    })
    etape(`envoi de ${poidsLisible(aiVideoFile.size)} vers le stockage…`)

    const limite = (promesse, secondes, quoi) => Promise.race([
      promesse,
      new Promise((_, rejeter) => setTimeout(
        () => rejeter(new Error(`${quoi} : aucune réponse après ${secondes} s.`)),
        secondes * 1000)),
    ])

    const { error: uploadError } = await limite(
      supabase.storage.from('procedo-videos')
        .upload(path, aiVideoFile, { cacheControl: CACHE_LONG }),
      90, "L'envoi de la vidéo")
    if (uploadError) {
      /* Le message brut de Supabase est en anglais et parle d'objets et de
         seaux. On traduit le seul cas fréquent, on laisse le reste tel quel. */
      const m = String(uploadError.message || '')
      console.error('[envoi] refus du stockage :', uploadError)
      if (/exceed|too large|maximum/i.test(m)) {
        throw new Error(`Le stockage a refusé un fichier de ${poidsLisible(aiVideoFile.size)}. ` +
          `Filmez une séquence plus courte.`)
      }
      throw new Error("Le stockage a refusé la vidéo : " + m)
    }
    etape(`vidéo envoyée en ${chrono()}`)
    /* On garde le CHEMIN, pas une URL publique. Le bucket est privé depuis le
     passage aux liens signés : `getPublicUrl` rendait une adresse qui ne
     s'ouvre plus. La fiche signera ce chemin au moment de lire la vidéo.

     C'est d'ici que venait « Can't find variable: publicUrlData » : la ligne
     qui créait cette variable a été retirée, son usage est resté. */
  const videoUrl = path

    /* La bande son, pour l'analyse seule. Azure ne lit que la parole : lui
       envoyer la vidéo entière lui ferait télécharger des dizaines de mégaoctets
       pour n'en garder que quelques-uns. Si l'extraction échoue — format
       exotique, navigateur récalcitrant — on lui donne la vidéo, comme avant. */
    /* En mode écran, on envoie la VIDÉO : sans image, Azure n'aurait rien à
       lire, et on paierait le préréglage complet pour le même résultat qu'avant.
       Les deux vont ensemble — le réglage et le fichier. */
    let urlPourAnalyse = videoUrl
    if (son && !true) {
      const cheminSon = `${base}_son.wav`
      const { error: errSon } = await supabase.storage.from('procedo-videos')
        .upload(cheminSon, son.blob, { contentType: 'audio/wav' })
      if (!errSon) {
        /* Azure télécharge le fichier lui-même : il lui faut une adresse valide
           assez longtemps pour toute l'analyse, mais qui finit par expirer.
           Six heures couvrent largement le pire des cas. */
        const { data: sig } = await supabase.storage.from('procedo-videos')
          .createSignedUrl(cheminSon, 6 * 3600)
        urlPourAnalyse = sig?.signedUrl || urlPourAnalyse
        window.jalon?.(`bande son : ${poidsLisible(son.blob.size)} au lieu de ${poidsLisible(aiVideoFile.size)}`)
      }
    }

    /* Si on en est resté au chemin — mode écran, ou extraction du son échouée —
       il faut le signer avant de le donner à Azure. Le bucket est privé : un
       chemin nu ne s'ouvre pas, et l'analyse échouerait sans qu'on sache
       pourquoi. */
    if (urlPourAnalyse === videoUrl) {
      etape('préparation du lien d’analyse…')
      const { data: sigVid } = await limite(supabase.storage.from('procedo-videos')
        .createSignedUrl(videoUrl, 6 * 3600), 30, 'La préparation du lien')
      if (!sigVid?.signedUrl) throw new Error("Impossible de pr\u00e9parer la vid\u00e9o pour l'analyse.")
      urlPourAnalyse = sigVid.signedUrl
    }

    errorEl.style.color = 'var(--label-3)'
    errorEl.textContent = '3/3 \u00b7 Vid\u00e9o re\u00e7ue'
/* ═══ ON BASCULE MAINTENANT ═══
       La vidéo est arrivée ; ce qui suit dure des minutes. C'est le moment de
       quitter la page de dépôt pour l'écran d'attente — pas avant, sinon on
       change d'écran pour trois secondes. */
    clearTimeout(bascule2)
    basculerVersAttente()
    signalerEtapeIA('Vid\u00e9o rattach\u00e9e\u2026')
    /* La procédure existe déjà — elle a été créée avant la compression. On ne
       fait que lui rattacher sa vidéo. */
    const { error: procError } = await supabase
      .from('procedures')
      .update({ video_url: videoUrl })
      .eq('id', aiProcedureId)
    if (procError) throw new Error(procError.message)

    signalerEtapeIA('L\u2019IA \u00e9coute et regarde\u2026')
    // 3. Démarrage de l'analyse Azure
    /* ═══ UN DÉLAI MAXIMAL SUR LE DÉMARRAGE ═══

       Ce `fetch` n'en avait aucun. Si le serveur ne répond pas — Azure
       injoignable, fonction en panne, réseau coupé au mauvais moment — l'attente
       est INFINIE : l'écran reste sur « Préparation » indéfiniment, sans que le
       plafond de douze minutes du sondage ne s'applique, puisque le sondage n'a
       jamais commencé.

       C'est ce qui s'est produit : seize minutes sur une vidéo de 4 min 30.

       Quarante secondes suffisent largement — `ai-start` ne fait que déclarer le
       travail à Azure, il ne l'attend pas. Au-delà, quelque chose ne va pas et
       il vaut mieux le dire. */
    const startRes = await fetch(`${SUPABASE_URL}/functions/v1/ai-start`, {
      method: 'POST',
      signal: AbortSignal.timeout(40000),
      headers: await enTeteFonction(),
      // La bande son pour un geste filmé ; la vidéo entière pour un écran.
      body: JSON.stringify({
        /* `newProc` n'existe plus : la procédure est créée bien plus haut,
           avant même la compression, et son identifiant vit dans
           `aiProcedureId`. Cette ligne était restée en arrière. */
        procedure_id: aiProcedureId,
        video_url: urlPourAnalyse,
        avec_image: true,
        /* ═══ ON DIT DANS QUELLE ENTREPRISE ON TRAVAILLE ═══

           `consommer_analyse` le devinait, en prenant la première fiche membre
           venue. Pour quelqu'un qui appartient à deux entreprises, Postgres
           rendait n'importe laquelle — la fonction voyait tantôt le rôle
           « gestion », tantôt « equipe », et acceptait ou refusait au hasard.

           L'app, elle, SAIT : c'est l'entreprise de l'espace ouvert. Le deviner
           côté base était l'erreur de départ. */
        entreprise_id: currentMembre?.entreprise_id || null,
      }),
    })
    const startData = await startRes.json()
    if (!startRes.ok || startData.error) throw new Error(startData.error || "Erreur au démarrage de l'analyse")

    /* La coche remplace l'anneau. Sans cette classe, l'anneau continuait de
           tourner sous la coche — deux cercles et un point brillant pour dire
           une seule chose. */
    launchBtn.classList.add('fini')
    launchBtn.classList.remove('travaille'); launchBtn.disabled = false
    /* La bascule a eu lieu au clic — il ne reste qu'à sonder. */
    pollAiStatus()

    /* La liste a déjà été rechargée à la création, tout au début. On la
       recharge une seconde fois ici : la vidéo vient d'être rattachée, et
       c'est elle qui donne sa vignette à la carte. */
    loadGestionProcedures().catch(() => {})
  } catch (e) {
    clearTimeout(bascule2)

    /* ═══ UN MESSAGE LISIBLE POUR UNE INTERRUPTION ═══

       `AbortSignal.timeout` lève une erreur dont le message est « signal timed
       out » — du jargon de navigateur, incompréhensible pour qui lit la liste
       des procédures trois jours plus tard.

       On le remplace par ce qui s'est réellement passé. */
    if (e?.name === 'TimeoutError' || /timed out/i.test(String(e?.message || ''))) {
      e = new Error("Le serveur d'analyse n'a pas répondu. Réessayez dans un instant.")
    }

    /* La procédure existe déjà en base : on ne peut plus faire comme si rien
       n'avait commencé. On la marque en échec plutôt que de l'effacer — elle
       reste dans la liste avec son signal rouge, et un appui la relance. Une
       ligne qui disparaît toute seule laisse croire à une erreur de l'app. */
    if (aiProcedureId) {
      supabase.from('procedures')
        .update({ statut: 'echec', erreur_ia: String(e?.message || e).slice(0, 400) })
        .eq('id', aiProcedureId)
        .then(() => loadGestionProcedures().catch(() => {}))
    }

    launchBtn.classList.remove('travaille'); launchBtn.disabled = false
    /* Le rouge n'apparaît qu'ici : c'est le seul endroit où il y a vraiment
       quelque chose qui a échoué. */
    errorEl.style.color = 'var(--red)'

    /* ON REVIENT À LA PAGE DE DÉPÔT. Sans ça, l'échec laissait l'écran
       d'attente ouvert sur un anneau figé : la personne voyait le message
       d'erreur derrière, sans moyen de recommencer. */
    stopAiProgressSimulation()
    document.getElementById('ai-progress-card').style.display = 'none'
    aiEcranAttente = false
      document.getElementById('ai-upload-card').style.display = 'block'


    /* La vidéo muette n'est pas une erreur de l'app : c'est une vidéo qui ne
       convient pas à ce mode. On l'annonce comme une consigne, avec la porte de
       sortie — pas comme une ligne rouge qui dit « ça n'a pas marché ».

       La nuance compte : « l'app ne sait pas faire » décourage, « voilà comment
       obtenir un bon résultat » aide. */
    if (e.message === 'SANS_SON') {
      errorEl.textContent = ''
      const versMontage = await confirmDialog({
        titre: 'Filmez en expliquant \u00e0 voix haute',
        message: "L'IA \u00e9coute ce que vous dites pour d\u00e9couper les \u00e9tapes. " +
          "Cette vid\u00e9o n'a pas de son \u2014 elle ne saurait pas o\u00f9 couper.\n\n" +
          "Refilmez en commentant vos gestes, ou marquez les \u00e9tapes vous-m\u00eame.",
        confirmer: 'Marquer les \u00e9tapes moi-m\u00eame',
        annuler: 'Je refilme',
        danger: false,
      })
      if (versMontage) ouvrirMontageVideo(null)
      return
    }

    errorEl.textContent = e.message
  }
})

/* Affiche la cause exacte, telle que la fonction serveur l'a inscrite sur la
   procédure. Sans ça, il fallait ouvrir Supabase pour la lire — et sans elle on
   ne peut que deviner. */
async function afficherDetailEchec(procId, message) {
  const bloc = document.getElementById('ai-detail')
  const texte = document.getElementById('ai-detail-texte')
  if (!bloc || !texte) return

  let detail = message || ''
  if (procId) {
    const { data } = await supabase.from('procedures')
      .select('erreur_ia, azure_video_id, statut').eq('id', procId).maybeSingle()
    if (data) {
      detail = [
        data.erreur_ia || message || '(aucun d\u00e9tail enregistr\u00e9)',
        '',
        'proc\u00e9dure : ' + procId,
        'statut : ' + (data.statut || '\u2014'),
        'vid\u00e9o Azure : ' + (data.azure_video_id || '\u2014'),
      ].join('\n')
    }
  }
  texte.textContent = detail
  bloc.style.display = detail ? 'block' : 'none'
}

document.getElementById('ai-copier')?.addEventListener('click', async () => {
  const t = document.getElementById('ai-detail-texte')?.textContent || ''
  try { await navigator.clipboard.writeText(t); toast('D\u00e9tail copi\u00e9.') }
  catch (e) { toast("La copie a \u00e9chou\u00e9 \u2014 s\u00e9lectionnez le texte \u00e0 la main.") }
})

/* Échecs consécutifs du serveur. Remis à zéro dès qu'une réponse arrive. */
let aiEchecsSuite = 0

async function pollAiStatus() {
  try {
    const checkRes = await fetch(`${SUPABASE_URL}/functions/v1/ai-check`, {
      method: 'POST',
      /* ⚠ 25 SECONDES ÉTAIT TROP COURT, ET C'EST MOI QUI L'AVAIS POSÉ.

         Un sondage ordinaire répond en moins d'une seconde. Mais UN sondage
         sur toute l'analyse fait bien plus : c'est celui qui trouve Azure
         terminé, et qui enchaîne alors le classement puis la rédaction des
         étapes par Claude — trente à quatre-vingt-dix secondes sur une longue
         transcription.

         Ma limite le coupait en plein travail. Pire : quand le client se
         déconnecte, Supabase peut interrompre la fonction — la procédure
         restait alors bloquée en « redaction », et le sondage suivant lisait
         un état qui ne bougeait plus.

         120 secondes. Les autres sondages n'attendent pas pour autant : ils
         répondent en une seconde et n'atteignent jamais ce plafond. */
      signal: AbortSignal.timeout(120000),
      headers: await enTeteFonction(),
      body: JSON.stringify({ procedure_id: aiProcedureId }),
    })

    /* ═══ UNE PANNE DU SERVEUR N'EST PAS UNE COUPURE RÉSEAU ═══

       Le code réessayait indéfiniment, toutes les cinq secondes, sans jamais
       montrer la raison : l'anneau tournait pour l'éternité pendant que la
       console se remplissait de 500 identiques.

       Une coupure passagère se répare toute seule, on retente. Une fonction qui
       plante répondra pareil au centième essai. On distingue donc les deux : on
       accorde trois tentatives, puis on affiche ce que le serveur a répondu et
       on s'arrête. */
    if (!checkRes.ok) {
      const brut = await checkRes.text().catch(() => '')
      let dit = brut
      try { dit = JSON.parse(brut).error || JSON.parse(brut).message || brut } catch (e) {}
      aiEchecsSuite++
      console.error('[ai-check]', checkRes.status, brut)

      if (aiEchecsSuite < 3) {
        aiPollTimer = setTimeout(pollAiStatus, 4000)
        return
      }
      stopAiProgressSimulation(0)
      document.getElementById('ai-progress-card').style.display = 'none'
      aiEcranAttente = false
      document.getElementById('ai-upload-card').style.display = 'block'
      const zone = document.getElementById('ai-error')
      zone.style.color = 'var(--red)'
      zone.textContent = `Le serveur d'analyse a répondu ${checkRes.status}` +
        (dit ? ' : ' + String(dit).slice(0, 200) : ' sans détail.') +
        ` — procédure interrogée : ${aiProcedureId || '(AUCUNE)'}`
      afficherDetailEchec(aiProcedureId, dit || `HTTP ${checkRes.status}`)
      return
    }
    aiEchecsSuite = 0

    const data = await checkRes.json()
    /* La réponse ENTIÈRE, à chaque sondage. C'est le seul moyen de savoir si le
       serveur suit vraiment Azure ou s'il répond « en cours » par défaut. */
    console.log(`[ai-check ${Math.round((Date.now() - aiDebutAnalyse) / 1000)} s]`, data)

    if (data.status === 'processing') {
      /* ═══ EN FILE D'ATTENTE, OU EN TRAITEMENT ═══

         Azure met la vidéo en file quand aucune machine n'est libre. Elle y
         reste sans avancer d'un pour cent — et l'app affichait pourtant
         « Lecture de votre vidéo », comme si quelque chose se passait.

         Une attente qu'on croit être un travail paraît deux fois plus longue :
         on cherche ce qui ne va pas au lieu de patienter.

         `en_file` vient d'`ai-check` après le correctif `patch-ai-check.ts`.
         Sans lui, `undefined` est faux et le comportement reste l'ancien. */
      /* ⚠ ON POSE UN DRAPEAU, ON N'ÉCRIT PAS. `majProgressionIA` repeint ce
         texte à chaque seconde : un message posé ici directement serait effacé
         au tour suivant. */
      aiEnFile = !!data.en_file
      if (!aiEnFile) signalerEtapeIA('transcription', data.progress)
      // On interroge souvent au début, puis on espace : la première minute
      // était la plus pénalisante, on pouvait attendre 6 s pour rien après la
      // fin réelle de l'analyse.
      /* ═══ UNE ANALYSE NE DURE PAS INDÉFINIMENT ═══

         Rien n'arrêtait le sondage : tant que le serveur disait « en cours »,
         l'anneau tournait, une heure s'il le fallait. L'app ne pouvait donc
         jamais dire ce qu'on veut savoir — que ça dure anormalement.

         Azure indexe une vidéo courte en une à trois minutes. Au-delà de DOUZE,
         quelque chose est resté en travers, et continuer d'attendre n'apprend
         plus rien. */
      const ecoule = (Date.now() - aiDebutAnalyse) / 1000
      if (ecoule > 12 * 60) {
        stopAiProgressSimulation(0)
        document.getElementById('ai-progress-card').style.display = 'none'
        aiEcranAttente = false
        document.getElementById('ai-upload-card').style.display = 'block'
        const zone = document.getElementById('ai-error')
        zone.style.color = 'var(--red)'
        zone.textContent = "L'analyse dure depuis " + Math.round(ecoule / 60) +
          " minutes sans aboutir. Elle est probablement bloquée chez Azure."
        afficherDetailEchec(aiProcedureId,
          `Aucune réponse d'Azure après ${Math.round(ecoule)} s · ${aiNbSondages} sondages`)
        if (aiProcedureId) {
          supabase.from('procedures')
            .update({ statut: 'echec', erreur_ia: `Analyse bloquée après ${Math.round(ecoule / 60)} min` })
            .eq('id', aiProcedureId).then(() => loadGestionProcedures().catch(() => {}))
        }
        return
      }

      aiNbSondages++
      const delai = aiNbSondages < 12 ? 3000 : aiNbSondages < 30 ? 5000 : 8000
      aiPollTimer = setTimeout(pollAiStatus, delai)
      return
    }
    if (data.status === 'redaction') {
      signalerEtapeIA('redaction', null)
      aiPollTimer = setTimeout(pollAiStatus, 2500)
      return
    }

    if (data.status === 'ready') {
      // On inscrit la fin en base : la carte de la liste passera à la coche,
      // même si le gérant n'est plus sur cet écran.
      if (aiProcedureId) {
        supabase.from('procedures').update({ statut: 'pret' }).eq('id', aiProcedureId).then(() => {}, () => {})
        const p = allGestionProcedures.find(x => x.id === aiProcedureId)
        if (p) p.statut = 'pret'
      }
      stopAiProgressSimulation(100)
      document.getElementById('ai-progress-card').style.display = 'none'
      document.getElementById('ai-done-card').style.display = 'block'
      document.getElementById('ai-done-sub').textContent = `${data.nb_etapes} étape${data.nb_etapes > 1 ? 's' : ''} générée${data.nb_etapes > 1 ? 's' : ''} par l'IA — vérifiez et modifiez si besoin avant de publier`
      /* « Vérifier et publier » annonçait deux corvées. « Voir la procédure » dit
         ce qu'on obtient, et la vérification vient d'elle-même une fois qu'on y est. */
      document.getElementById('ai-view-btn').textContent = 'Voir la procédure'
      /* On ouvre la fiche, pas l'éditeur. Arriver directement en mode modification
   suggère qu'il y a du travail à faire alors qu'on vient seulement de demander
   à voir. Le bouton « Modifier » est sur la fiche, à portée de doigt. */
document.getElementById('ai-view-btn').onclick = () => openAnalyse(aiProcedureId)
      return
    }
    // status === 'error'
    stopAiProgressSimulation(0)
    document.getElementById('ai-progress-card').style.display = 'none'
    aiEcranAttente = false
      document.getElementById('ai-upload-card').style.display = 'block'
    document.getElementById('ai-error').style.color = 'var(--red)'
    document.getElementById('ai-error').textContent = data.message || "Une erreur est survenue pendant l'analyse."
    afficherDetailEchec(aiProcedureId, data.message)
  } catch (e) {
    /* Ici, c'est vraiment le réseau : la requête n'est même pas partie, ou la
       réponse n'était pas lisible. On retente — mais pas éternellement. */
    aiNbSondages++
    aiEchecsSuite++
    console.warn('[ai-check] injoignable :', e?.message || e)
    if (aiEchecsSuite >= 6) {
      stopAiProgressSimulation(0)
      document.getElementById('ai-progress-card').style.display = 'none'
      aiEcranAttente = false
      document.getElementById('ai-upload-card').style.display = 'block'
      const zone = document.getElementById('ai-error')
      zone.style.color = 'var(--red)'
      zone.textContent = "Le serveur d'analyse est injoignable. R\u00e9essayez dans un instant."
      return
    }
    aiPollTimer = setTimeout(pollAiStatus, 5000)
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   ÉDITEUR DE CLIP — une seule frise, deux poignées (début / fin) que l'on
   écarte ou resserre pour régler la portion de vidéo d'une étape.
   Le même code sert deux fois : à la création (préfixe "capcut") et à la
   modification d'une procédure existante (préfixe "ecap").
   ═══════════════════════════════════════════════════════════════════════════ */
const MIN_CLIP = 0.3 // durée minimale d'un clip, en secondes

function createClipEditor(ids, api) {
  const g = id => document.getElementById(id)
  const timeline = g(ids.timeline)
  if (!timeline) return null

  let selIndex = null
  let borneActive = 'a'      // la borne que la loupe et l'affichage suivent
  let zoom = 1               // facteur d'agrandissement de la frise
  /* Par défaut, une borne S'ARRÊTE à l'étape voisine : on ne peut pas entrer
     dedans. Le bouton « Étapes liées » permet d'activer le report, où la
     voisine reculerait pour laisser passer — utile, mais ce n'est pas ce
     qu'on attend en premier. */
  let etapesLiees = false
  let refaire = []           // pile de rétablissement
  let histo = []             // pile d'annulation
  const PXS = 42             // pixels par seconde dans la loupe
  let drag = null            // 'start' | 'end' | 'scrub'
  let wasPlaying = false
  let rafId = null
  let clipStopper = null

  const video = () => g(ids.video)
  const steps = () => (api.getSteps() || [])
  const current = () => (selIndex != null ? steps()[selIndex] : null)
  const dur = () => { const v = video(); return (v && isFinite(v.duration) && v.duration > 0) ? v.duration : 0 }
  const pct = t => { const d = dur(); return d ? Math.min(100, Math.max(0, (t / d) * 100)) : 0 }
  const clamp = (t) => Math.min(dur(), Math.max(0, t))

  function clipStart(s) { return s.timestamp_video != null ? s.timestamp_video : 0 }
  function clipEnd(s) { return s.fin_video != null ? s.fin_video : dur() }

  // ── Rendu : bandes des étapes, masques, sélection, poignées ───────────────
  function paintBands() {
    const bandsEl = g(ids.markers)
    if (!bandsEl) return
    bandsEl.innerHTML = ''
    const d = dur()
    if (!d) return
    steps().forEach((s, i) => {
      if (s.timestamp_video == null) return
      const a = pct(clipStart(s)), b = pct(clipEnd(s))
      const div = document.createElement('div')
      div.className = 'clip-band' + (i === selIndex ? ' sel' : '')
      div.style.left = a + '%'
      div.style.width = Math.max(0.6, b - a) + '%'
      // Chaque étape a sa couleur, reprise sur son numéro dans la liste : c'est
      // ce qui relie d'un coup d'œil un morceau de frise à son texte.
      const c = COULEUR_ETAPE(i)
      div.style.background = c + '3A'
      div.style.borderLeftColor = c
      div.style.borderRightColor = c
      div.dataset.i = i     // le vrai rang de l'étape, pas sa place dans le DOM
      div.innerHTML = `<span style="background:${c};color:#0B0B0D">${i + 1}</span>`
      bandsEl.appendChild(div)
    })
  }

  function paintSelection() {
    const d = dur()
    const s = current()
    const on = !!(s && d)
    /* Les outils de montage restent affichés dès qu'une vidéo est chargée, même
       sans étape choisie : on n'a plus à deviner qu'il faut d'abord toucher une
       étape pour les faire apparaître. Seules les poignées et les masques,
       qui n'ont de sens que sur une étape précise, restent conditionnels. */
    const outillageVisible = !!d
    ;[ids.maskL, ids.maskR, ids.sel].forEach(id => g(id)?.classList.toggle('on', on))
    ;[ids.hStart, ids.hEnd].forEach(id => g(id)?.classList.toggle('on', on))
    timeline.classList.toggle('clipmode', on)

    const infoEl = g(ids.info)
    g(ids.tools)?.classList.toggle('on', outillageVisible)
    g(ids.done)?.classList.toggle('on', on)
    if (g(ids.hint)) g(ids.hint).textContent = on
      ? 'Écartez ou resserrez les deux poignées blanches'
      : (ids.prefix === 'capcut'
          ? 'Placez la lecture, puis découpez une étape'
          : 'Touchez une étape pour régler son clip')

    ;[ids.setStart, ids.setEnd, ids.split, ids.playClip].forEach(id => {
      const b = g(id); if (b) b.disabled = !on
    })

    if (!on) { if (infoEl) infoEl.style.display = 'none'; return }

    const a = pct(clipStart(s)), b = pct(clipEnd(s))
    g(ids.sel).style.left = a + '%'
    g(ids.sel).style.width = Math.max(0, b - a) + '%'
    g(ids.maskL).style.left = '0%'
    g(ids.maskL).style.width = a + '%'
    g(ids.maskR).style.left = b + '%'
    g(ids.maskR).style.width = Math.max(0, 100 - b) + '%'
    /* Les poignées se posent À L'INTÉRIEUR de l'étape, pas à cheval sur ses
       bords. À cheval, leur zone tactile de 30 px débordait de part et d'autre :
       appuyer au milieu d'une étape courte — 8 px de large à l'échelle ×1 —
       revenait à saisir sa borne de fin, et l'étape se terminait sous le doigt.
       À l'intérieur, le centre de l'étape reste libre pour l'appui long. */
    const largeurBande = timeline.getBoundingClientRect().width * (b - a) / 100
    const largeurPoignee = Math.min(26, Math.max(10, largeurBande / 2 - 1))
    g(ids.hStart).style.width = largeurPoignee + 'px'
    g(ids.hEnd).style.width = largeurPoignee + 'px'
    g(ids.hStart).style.left = `${a}%`
    g(ids.hEnd).style.left = `calc(${b}% - ${largeurPoignee}px)`

    if (infoEl) {
      infoEl.style.display = 'flex'
      const len = Math.max(0, clipEnd(s) - clipStart(s))
      infoEl.innerHTML = `<span>Étape ${selIndex + 1}</span>` +
        `<span><b>${formatTime(clipStart(s))}</b> → <b>${formatTime(clipEnd(s))}</b> · ${len.toFixed(1).replace('.', ',')} s</span>`
    }
  }

  function paintPlayhead() {
    const v = video()
    if (!v) return
    const p = pct(v.currentTime || 0)
    const ph = g(ids.playhead)
    if (ph) ph.style.left = p + '%'
    if (ids.curTime && g(ids.curTime)) g(ids.curTime).textContent = formatTime(v.currentTime || 0)
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Pièces ajoutées : pastilles de bornes, loupe, couverture, avertissements
     ═══════════════════════════════════════════════════════════════════════ */

  function instantane() {
    return JSON.stringify(steps().map(s => ({ a: s.timestamp_video, b: s.fin_video })))
  }

  function memoriser() {
    histo.push(instantane())
    if (histo.length > 40) histo.shift()
    // Une action neuve rend le rétablissement caduc : on repart de cette branche.
    refaire = []
    const u = g(ids.undo); if (u) u.disabled = false
  }

  function restaurer(etat) {
    const parse = JSON.parse(etat)
    steps().forEach((s, i) => {
      if (!parse[i]) return
      s.timestamp_video = parse[i].a
      s.fin_video = parse[i].b
    })
  }

  function annuler() {
    if (!histo.length) return
    refaire.push(instantane())
    restaurer(histo.pop())
    const u = g(ids.undo); if (u) u.disabled = !histo.length
    repaint()
    api.onChange?.()
  }

  /* Les bornes ne peuvent pas empiéter sur les étapes voisines : on contraint
     plutôt que de laisser fabriquer un chevauchement à corriger ensuite. */
  function limitesBorne() {
    const s = current()
    const liste = steps()
    if (!s) return { min: 0, max: dur() }
    const avant = selIndex > 0 && liste[selIndex - 1].timestamp_video != null ? clipEnd(liste[selIndex - 1]) : 0
    const apres = selIndex < liste.length - 1 && liste[selIndex + 1].timestamp_video != null ? clipStart(liste[selIndex + 1]) : dur()
    if (etapesLiees) {
      // La voisine doit conserver au moins la durée minimale : c'est elle qui
      // fixe la limite, pas sa borne actuelle.
      const pRec = selIndex > 0 ? liste[selIndex - 1] : null
      const sUiv = selIndex < liste.length - 1 ? liste[selIndex + 1] : null
      return borneActive === 'a'
        ? { min: pRec ? clipStart(pRec) + MIN_CLIP : 0, max: clipEnd(s) - MIN_CLIP }
        : { min: clipStart(s) + MIN_CLIP, max: sUiv ? clipEnd(sUiv) - MIN_CLIP : dur() }
    }
    return borneActive === 'a'
      ? { min: avant, max: clipEnd(s) - MIN_CLIP }
      : { min: clipStart(s) + MIN_CLIP, max: apres }
  }

  function valeurBorne() {
    const s = current()
    if (!s) return 0
    return borneActive === 'a' ? clipStart(s) : clipEnd(s)
  }

  /* Pose la borne active, en la contraignant et en l'accrochant éventuellement
     à la borne d'une étape voisine. Renvoie true si l'aimant a mordu. */
  function poserBorne(v, avecAimant) {
    const s = current()
    if (!s) return false
    const l = limitesBorne()
    v = Math.max(l.min, Math.min(l.max, v))
    let colle = false
    if (avecAimant) {
      const cibles = [0, dur()]
      steps().forEach((e, i) => { if (i !== selIndex && e.timestamp_video != null) cibles.push(clipStart(e), clipEnd(e)) })
      for (const c of cibles) {
        if (Math.abs(v - c) < 0.6) { v = c; colle = true; break }
      }
    }
    const arrondi = Math.round(v * 10) / 10
    if (borneActive === 'a') s.timestamp_video = arrondi
    else s.fin_video = arrondi

    /* Montage par report : la borne partagée avec la voisine bouge avec elle.
       C'est ce qui empêche d'ouvrir un trou entre deux étapes — ce que les
       applications de montage appellent un « ripple edit ». */
    if (etapesLiees) {
      const liste = steps()
      const voisine = borneActive === 'a' ? liste[selIndex - 1] : liste[selIndex + 1]
      if (voisine && voisine.timestamp_video != null) {
        if (borneActive === 'a') voisine.fin_video = arrondi
        else voisine.timestamp_video = arrondi
      }
    }
    return colle
  }

  function tcd(s) {
    const m = Math.floor(s / 60), r = Math.floor(s % 60)
    return m + ':' + String(r).padStart(2, '0') + ',' + Math.floor((s % 1) * 10)
  }

  function paintBornes() {
    const s = current()
    const bl = g(ids.bornes), lb = g(ids.loupeBloc)
    bl?.classList.toggle('on', !!s)
    lb?.classList.toggle('on', !!s)
    if (!s) return
    if (g(ids.vd)) g(ids.vd).textContent = tcd(clipStart(s))
    if (g(ids.vf)) g(ids.vf).textContent = tcd(clipEnd(s))
    bl?.querySelectorAll('.ed-borne').forEach(el => {
      el.classList.toggle('actif', el.dataset.borne === borneActive)
    })
  }

  /* La loupe montre les quelques secondes autour de la borne active, avec un
     axe fixe au centre : on fait glisser la bande sous l'axe. */
  function paintLoupe() {
    const s = current()
    const loupe = g(ids.loupe)
    if (!s || !loupe || !dur()) return
    const v = valeurBorne()
    const demi = (loupe.clientWidth || 300) / 2 / PXS
    if (g(ids.loupeFen)) g(ids.loupeFen).textContent = '± ' + demi.toFixed(1) + ' s'
    const de = v - demi
    const bande = g(ids.loupeBande)
    if (bande) {
      bande.style.width = (dur() * PXS) + 'px'
      bande.style.left = (-de * PXS) + 'px'
      if (!bande.dataset.rempli) {
        let h = ''
        const n = Math.max(12, Math.round(dur() / 2))
        for (let i = 0; i < n; i++) {
          const t = 190 + (i / n) * 90
          h += `<i style="flex:1;background:linear-gradient(160deg,hsl(${t},14%,${26 + (i % 3) * 5}%),hsl(${t},12%,15%));border-right:1px solid rgba(0,0,0,.35)"></i>`
        }
        bande.innerHTML = h
        bande.dataset.rempli = '1'
      }
    }
    const z = g(ids.loupeZone)
    if (z) {
      z.style.left = ((clipStart(s) - de) * PXS) + 'px'
      z.style.width = ((clipEnd(s) - clipStart(s)) * PXS) + 'px'
    }
    loupe.querySelectorAll('.grad').forEach(e => e.remove())
    let grad = ''
    for (let t = Math.ceil(de); t <= Math.floor(v + demi); t++) {
      if (t < 0 || t > dur()) continue
      grad += `<span class="grad" style="left:${(t - de) * PXS}px">${formatTime(t)}</span>`
    }
    loupe.insertAdjacentHTML('beforeend', grad)
  }

  function paintCouverture() {
    const couv = g(ids.couv), leg = g(ids.legende), al = g(ids.alertes)
    const d = dur()
    /* On ne juge que ce qui est réellement renseigné. Une étape sans borne de
       fin voyait `clipEnd` lui rendre la fin de la vidéo : plusieurs étapes
       finissaient donc toutes au même endroit, ce qui fabriquait des trous et
       des chevauchements qui n'existaient pas. D'où les « trou de 28 s »
       inexplicables. */
    const clips = steps()
      .filter(s => s.timestamp_video != null && s.fin_video != null && s.fin_video > s.timestamp_video)
      .map(s => ({ a: s.timestamp_video, b: s.fin_video })).sort((x, y) => x.a - y.a)
    const incompletes = steps().filter(s => s.timestamp_video == null || s.fin_video == null).length
    const montrer = !!(d && clips.length)
    couv?.classList.toggle('on', montrer)
    leg?.classList.toggle('on', montrer)
    if (!montrer) { if (al) al.innerHTML = ''; return }

    const seg = []
    let t = 0
    clips.forEach(c => {
      if (c.a > t) seg.push(['trou', t, c.a])
      if (c.a < t) seg.push(['double', c.a, Math.min(t, c.b)])
      seg.push(['ok', Math.max(t, c.a), c.b])
      t = Math.max(t, c.b)
    })
    if (t < d) seg.push(['trou', t, d])
    if (couv) couv.innerHTML = seg.filter(x => x[2] - x[1] > 0.05).map(x => {
      const c = x[0] === 'ok' ? 'var(--green)' : x[0] === 'trou' ? 'rgba(255,255,255,.12)' : 'var(--red)'
      return `<i style="flex:${x[2] - x[1]};background:${c}"></i>`
    }).join('')

    /* On signale, on ne corrige pas : un trou peut être volontaire. */
    const probs = []
    for (let i = 1; i < clips.length; i++) {
      const ecart = clips[i].a - clips[i - 1].b
      if (ecart > 0.5) probs.push({ txt: `Trou de ${ecart.toFixed(1).replace('.', ',')} s avant l'étape ${i + 1}` })
      if (ecart < -0.5) probs.push({ grave: true, txt: `Les étapes ${i} et ${i + 1} se recoupent sur ${(-ecart).toFixed(1).replace('.', ',')} s` })
    }
    if (clips[0].a > 0.5) probs.push({ txt: `${clips[0].a.toFixed(1).replace('.', ',')} s non couvertes au début` })
    const fin = clips[clips.length - 1].b
    if (fin < d - 0.5) probs.push({ txt: `${(d - fin).toFixed(1).replace('.', ',')} s non couvertes à la fin` })

    if (incompletes > 0) {
      probs.unshift({ txt: `${incompletes} étape${incompletes > 1 ? 's' : ''} sans extrait défini` })
    }

    if (al) al.innerHTML = probs.length
      ? probs.map(p => `<div class="ed-alerte${p.grave ? ' grave' : ''}"><span>${p.txt}</span></div>`).join('')
      : '<div class="ed-ok">✓ Toute la vidéo est couverte, sans chevauchement</div>'
  }

  /* ═══ Zoom de la frise ═══
     Tous les enfants de la frise sont positionnés en pourcentage : il suffit
     d'élargir la frise pour que tout s'étire ensemble, sans recalculer une
     seule position. La fenêtre parente se charge du défilement. */
  function appliquerZoom(garderVisible) {
    const fen = g(ids.fenetre)
    if (!fen) return
    timeline.style.width = (zoom * 100) + '%'
    const v = g(ids.zoomVal); if (v) v.textContent = '\u00d7' + zoom
    const m = g(ids.zoomMoins); if (m) m.disabled = zoom <= 1
    const pl = g(ids.zoomPlus); if (pl) pl.disabled = zoom >= 8
    if (garderVisible) centrerSur(garderVisible)
  }

  /* Amener un instant au milieu de la fenêtre. Sans ça, zoomer perdrait de vue
     l'endroit que l'on réglait. */
  function centrerSur(t) {
    const fen = g(ids.fenetre)
    const d = dur()
    if (!fen || !d) return
    const largeur = timeline.scrollWidth || fen.clientWidth * zoom
    fen.scrollLeft = Math.max(0, (t / d) * largeur - fen.clientWidth / 2)
  }

  /* La tête de lecture reste visible pendant la lecture : dès qu'elle approche
     d'un bord, la fenêtre se recale. C'est ce que fait toute app de montage. */
  function suivreTete() {
    const fen = g(ids.fenetre)
    const v = video(), d = dur()
    if (!fen || !v || !d || zoom <= 1) return
    const largeur = timeline.scrollWidth || fen.clientWidth * zoom
    const x = (v.currentTime / d) * largeur
    const marge = fen.clientWidth * 0.15
    if (x < fen.scrollLeft + marge || x > fen.scrollLeft + fen.clientWidth - marge) {
      fen.scrollLeft = Math.max(0, x - fen.clientWidth / 2)
    }
  }

  function repaint() { paintBands(); paintSelection(); paintPlayhead(); paintBornes(); paintLoupe(); paintCouverture() }

  /* ── Boucle d'animation de la tête de lecture ─────────────────────────────
     Elle tournait uniquement pendant la lecture, ce qui la rendait dépendante
     des événements émis par le navigateur — et Safari est capricieux là-dessus :
     lecture depuis les commandes natives, reprise après une recherche, sortie
     de veille, autant d'occasions de ne pas recevoir le `play` attendu.
     Elle tourne donc maintenant en continu tant que l'éditeur est à l'écran.
     Le coût est d'une écriture de style par image, c'est-à-dire rien. */
  function loop() {
    paintPlayhead()
    suivreTete()
    const wrap = ids.wrap ? g(ids.wrap) : null
    const visible = wrap ? wrap.offsetParent !== null : true
    rafId = visible ? requestAnimationFrame(loop) : null
  }
  function startLoop() { if (rafId) cancelAnimationFrame(rafId); rafId = requestAnimationFrame(loop) }
  function stopLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = null } }

  // ── Interaction ──────────────────────────────────────────────────────────
  function timeFromX(clientX) {
    const r = timeline.getBoundingClientRect()
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    return p * dur()
  }

  function seek(t) {
    const v = video()
    if (!v || !dur()) return
    v.currentTime = clamp(t)
    paintPlayhead()
  }

  function beginDrag(kind, e, handleEl) {
    if (!dur()) return
    drag = kind
    const v = video()
    wasPlaying = v && !v.paused
    if (v) v.pause()
    stopClipPlayback()
    if (kind !== 'scrub') memoriser()
    if (handleEl) { handleEl.classList.add('dragging'); handleEl.setPointerCapture?.(e.pointerId) }
    else timeline.setPointerCapture?.(e.pointerId)
    moveDrag(e.clientX)
  }

  function moveDrag(clientX) {
    const t = timeFromX(clientX)
    if (drag === 'scrub') { seek(t); return }
    const s = current()
    if (!s) return
    // La borne suivie devient celle qu'on tire, et l'aimant l'accroche aux
    // bornes voisines : c'est ce qui supprime les trous d'une demi-seconde.
    borneActive = drag === 'start' ? 'a' : 'b'
    const colle = poserBorne(t, true)
    const h = g(drag === 'start' ? ids.hStart : ids.hEnd)
    h?.classList.toggle('colle', colle)
    seek(valeurBorne())
    paintBands(); paintSelection(); paintBornes(); paintLoupe(); paintCouverture()
  }

  function endDrag() {
    if (!drag) return
    const wasHandle = drag !== 'scrub'
    drag = null
    g(ids.hStart)?.classList.remove('dragging', 'colle')
    g(ids.hEnd)?.classList.remove('dragging', 'colle')
    if (wasHandle) api.onChange?.()
    else if (wasPlaying) video()?.play()
  }

  /* Appui long sur la bande d'une étape : on la sélectionne. Un appui court
     reste un déplacement de la tête de lecture — les deux gestes cohabitent.
     Le seuil de 6 pixels évite de déclencher la sélection quand le doigt
     glisse : dans ce cas l'utilisateur cherchait à naviguer. */
  let attente = null, departLong = null
  function annulerAttente() {
    if (attente) { clearTimeout(attente); attente = null }
    departLong = null
  }

  timeline.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.clip-handle')) return
    const bande = e.target.closest('.clip-band')
    departLong = { x: e.clientX, y: e.clientY, surBande: !!bande }
    if (bande) {
      /* Le rang vient de l'attribut posé au dessin, pas de la place dans le
         document : les étapes sans horodatage ne sont pas dessinées, et compter
         les enfants désignait donc la mauvaise étape. */
      const index = parseInt(bande.dataset.i, 10)
      attente = setTimeout(() => {
        attente = null
        drag = null                       // on abandonne le déplacement en cours
        if (Number.isFinite(index)) select(index, { lire: false })
      }, 380)
    }
    beginDrag('scrub', e, null)
  })
  timeline.addEventListener('pointermove', (e) => {
    if (departLong && (Math.abs(e.clientX - departLong.x) > 6 || Math.abs(e.clientY - departLong.y) > 6)) annulerAttente()
  })
  /* Un appui bref dans le vide désélectionne : c'est le geste attendu pour
     « je ne travaille plus sur cette étape ». Sur une bande, l'appui bref reste
     un déplacement de la tête de lecture. */
  timeline.addEventListener('pointerup', (e) => {
    const bref = attente !== null
    const dansLeVide = departLong && !departLong.surBande
    annulerAttente()
    if (bref === false && dansLeVide && selIndex != null) {
      const bougeAPeine = Math.abs(e.clientX - (departLong?.x ?? e.clientX)) < 6
      if (bougeAPeine) select(null)
    }
  })
  timeline.addEventListener('pointercancel', annulerAttente)
  timeline.addEventListener('pointermove', (e) => { if (drag === 'scrub') moveDrag(e.clientX) })
  timeline.addEventListener('pointerup', endDrag)
  timeline.addEventListener('pointercancel', endDrag)

  ;[['start', ids.hStart], ['end', ids.hEnd]].forEach(([kind, id]) => {
    const h = g(id)
    if (!h) return
    h.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); beginDrag(kind, e, h) })
    h.addEventListener('pointermove', (e) => { if (drag === kind) { e.preventDefault(); moveDrag(e.clientX) } })
    h.addEventListener('pointerup', (e) => { e.stopPropagation(); endDrag() })
    h.addEventListener('pointercancel', endDrag)
  })

  // ── Lecture du clip sélectionné uniquement ───────────────────────────────
  function stopClipPlayback() {
    const v = video()
    if (v && clipStopper) { v.removeEventListener('timeupdate', clipStopper); clipStopper = null }
  }

  function playClip() {
    const v = video(), s = current()
    if (!v || !s) return
    stopClipPlayback()
    const end = clipEnd(s)
    v.currentTime = clipStart(s)
    clipStopper = () => {
      paintPlayhead()
      if (v.currentTime >= end - 0.05) { v.pause(); stopClipPlayback() }
    }
    v.addEventListener('timeupdate', clipStopper)
    v.play()
    startLoop()
  }

  // ── Pastilles de bornes : choisir celle que la loupe suit ────────────────
  g(ids.bornes)?.addEventListener('click', (e) => {
    const b = e.target.closest('.ed-borne')
    if (!b) return
    borneActive = b.dataset.borne
    seek(valeurBorne())
    paintBornes(); paintLoupe()
  })

  // ── Loupe : on fait glisser la bande sous l'axe fixe ─────────────────────
  let departLoupe = null
  const loupeEl = g(ids.loupe)
  loupeEl?.addEventListener('pointerdown', (e) => {
    if (!current() || !dur()) return
    e.preventDefault()
    departLoupe = { x: e.clientX, v: valeurBorne() }
    memoriser()
    loupeEl.setPointerCapture?.(e.pointerId)
    video()?.pause()
  })
  loupeEl?.addEventListener('pointermove', (e) => {
    if (!departLoupe) return
    e.preventDefault()
    poserBorne(departLoupe.v - (e.clientX - departLoupe.x) / PXS, false)
    seek(valeurBorne())
    paintBands(); paintSelection(); paintBornes(); paintLoupe(); paintCouverture()
  })
  const finLoupe = () => { if (departLoupe) { departLoupe = null; api.onChange?.() } }
  loupeEl?.addEventListener('pointerup', finLoupe)
  loupeEl?.addEventListener('pointercancel', finLoupe)

  g(ids.undo)?.addEventListener('click', annuler)

  g(ids.zoomMoins)?.addEventListener('click', () => {
    zoom = Math.max(1, zoom - 1); appliquerZoom(valeurBorne() || video()?.currentTime || 0)
  })
  g(ids.zoomPlus)?.addEventListener('click', () => {
    zoom = Math.min(8, zoom + 1); appliquerZoom(valeurBorne() || video()?.currentTime || 0)
  })
  g(ids.lien)?.addEventListener('click', (e) => {
    etapesLiees = !etapesLiees
    e.currentTarget.classList.toggle('active', etapesLiees)
    toast(etapesLiees
      ? "Étapes liées : la voisine suit, aucun trou possible."
      : "Étapes indépendantes : vous pouvez laisser un blanc entre deux étapes.")
  })
  if (g(ids.undo)) g(ids.undo).disabled = true

  g(ids.playClip)?.addEventListener('click', playClip)
  g(ids.done)?.addEventListener('click', () => select(null))

  // ── Commandes façon CapCut ────────────────────────────────────────────────
  // « Début ici » / « Fin ici » : on place la lecture où l'on veut, puis on
  // fixe la borne d'un seul geste — plus précis que de viser une poignée.
  g(ids.setStart)?.addEventListener('click', () => {
    const s = current(), v = video()
    if (!s || !v) return
    memoriser()
    s.timestamp_video = clamp(Math.min(v.currentTime, clipEnd(s) - MIN_CLIP))
    repaint(); api.onChange?.()
  })
  g(ids.setEnd)?.addEventListener('click', () => {
    const s = current(), v = video()
    if (!s || !v) return
    memoriser()
    s.fin_video = clamp(Math.max(v.currentTime, clipStart(s) + MIN_CLIP))
    repaint(); api.onChange?.()
  })

  // « Diviser » : coupe l'étape en deux à l'endroit de la lecture.
  g(ids.split)?.addEventListener('click', () => {
    const s = current(), v = video()
    if (!s || !v) return
    const t = v.currentTime
    if (t <= clipStart(s) + MIN_CLIP || t >= clipEnd(s) - MIN_CLIP) {
      toast("Placez la lecture au milieu du clip pour le diviser.")
      return
    }
    memoriser()
    const finOriginale = clipEnd(s)
    s.fin_video = t
    const nouvelle = { id: null, texte: '', timestamp_video: t, fin_video: finOriginale }
    steps().splice(selIndex + 1, 0, nouvelle)
    api.onChange?.()
    select(selIndex + 1, { lire: false })
  })

  // Champ de texte de l'étape sélectionnée, juste sous la frise :
  // plus besoin de faire défiler la page pour écrire.

  // ── API publique ─────────────────────────────────────────────────────────
  function select(i, options) {
    /* `defiler` sert au réordonnancement : déplacer une étape la sélectionne,
       mais la personne regarde sa liste, pas la frise. Faire remonter l'écran
       à ce moment-là lui fait perdre son geste des yeux. */
    const { lire = true, defiler = true } = options || {}
    borneActive = 'a'
    stopClipPlayback()
    video()?.pause()
    selIndex = (i == null ? null : i)
    const s = current()
    if (s) {
      if (s.timestamp_video == null) s.timestamp_video = 0
      if (s.fin_video == null) s.fin_video = Math.min(dur() || 0, clipStart(s) + 8)
      seek(clipStart(s))
      if (defiler) timeline.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    repaint()
    api.onSelect?.(selIndex)
    // Toucher une étape lance aussitôt son extrait : on voit ce qu'on règle.
    if (s && dur() && lire) playClip()
  }

  function attachVideo() {
    const v = video()
    if (!v || v.dataset.clipWired === '1') return
    v.dataset.clipWired = '1'
    /* La tête de lecture ne suivait pas : la boucle d'animation ne démarrait
       que sur `play`, or Safari émet parfois `playing` sans `play`, et la
       lecture d'un extrait passe par `seeked`. On couvre donc tous les cas, et
       `timeupdate` sert de filet même si la boucle n'a pas démarré. */
    ;['timeupdate', 'seeked', 'seeking', 'loadeddata'].forEach(ev => v.addEventListener(ev, paintPlayhead))
    ;['play', 'playing'].forEach(ev => v.addEventListener(ev, startLoop))
    ;['pause', 'ended'].forEach(ev => v.addEventListener(ev, paintPlayhead))
    startLoop()   // et on la lance tout de suite, sans attendre une lecture
    zoom = 1
    appliquerZoom()
    v.addEventListener('loadedmetadata', () => {
      if (ids.durTime && g(ids.durTime)) g(ids.durTime).textContent = formatTime(v.duration)
      repaint()
    })
  }

  return {
    select,
    deselect: () => select(null),
    selected: () => selIndex,
    repaint,
    attachVideo,
    playClip,
    setDurationLabel: () => {
      const v = video()
      if (v && ids.durTime && g(ids.durTime)) g(ids.durTime).textContent = formatTime(v.duration || 0)
    },
  }
}

// Pellicule de vignettes. Si la vidéo est distante et que le navigateur refuse
// la capture (CORS), on garde simplement une frise noire : les poignées marchent quand même.
async function generateFilmstrip(video, trackEl) {
  const track = typeof trackEl === 'string' ? document.getElementById(trackEl) : trackEl
  if (!track || !video || !isFinite(video.duration) || video.duration <= 0) return
  track.innerHTML = ''
  const nbThumbs = 10
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  canvas.width = 160
  canvas.height = 90
  const originalTime = video.currentTime
  const wasPaused = video.paused
  video.pause()

  try {
    for (let i = 0; i < nbThumbs; i++) {
      const t = (video.duration / nbThumbs) * (i + 0.5)
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { video.removeEventListener('seeked', onSeeked); reject(new Error('timeout')) }, 4000)
        const onSeeked = () => {
          clearTimeout(timer)
          video.removeEventListener('seeked', onSeeked)
          try {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            const img = document.createElement('img')
            img.src = canvas.toDataURL('image/jpeg', 0.6)
            track.appendChild(img)
            resolve()
          } catch (err) { reject(err) }
        }
        video.addEventListener('seeked', onSeeked)
        video.currentTime = t
      })
    }
  } catch (e) {
    console.warn('Pellicule non générée (vidéo protégée ou trop lente) :', e && e.message)
  }
  video.currentTime = originalTime
  if (!wasPaused) video.play()
}

/* L'éditeur de clip de l'écran de création a été retiré : frise à zoom, poignées,
   loupe et barre d'outils demandaient de comprendre le montage avant de pouvoir
   s'en servir. Le découpage se fait désormais d'un seul bouton, pendant la
   lecture. `createClipEditor` reste employé par l'écran de correction. */


// ═══ Instance 2 : écran « Modifier la procédure » ═══
ecapEditor = createClipEditor({
  prefix: 'ecap', wrap: 'ecap-wrap',
  video: 'edit-video-player', timeline: 'ecap-timeline', markers: 'ecap-markers',
  maskL: 'ecap-mask-l', maskR: 'ecap-mask-r', sel: 'ecap-sel',
  hStart: 'ecap-h-start', hEnd: 'ecap-h-end', playhead: 'ecap-playhead',
  info: 'ecap-info', hint: 'ecap-hint', playClip: 'ecap-play-clip', done: 'ecap-done',
  tools: 'ecap-tools', textField: 'ecap-text-field', text: 'ecap-text',
  setStart: 'ecap-set-start', setEnd: 'ecap-set-end', split: 'ecap-split',
  curTime: 'ecap-current-time', durTime: 'ecap-duration',
  fenetre: 'ecap-fenetre', zoomMoins: 'ecap-zoom-moins', zoomPlus: 'ecap-zoom-plus',
  zoomVal: 'ecap-zoom-val', lien: 'ecap-lien',
  bornes: 'ecap-bornes', vd: 'ecap-vd', vf: 'ecap-vf',
  loupeBloc: 'ecap-loupe-bloc', loupe: 'ecap-loupe', loupeBande: 'ecap-loupe-bande',
  loupeZone: 'ecap-loupe-zone', loupeFen: 'ecap-loupe-fen',
  couv: 'ecap-couv', legende: 'ecap-legende', alertes: 'ecap-alertes', undo: 'ecap-undo',
}, {
  getSteps: () => editStepsData,
  onChange: () => renderEditSteps(),
  onSelect: () => renderEditSteps(),
  onTextInput: () => renderEditSteps(),
})

// ═══ Import de la vidéo (création) ═══
/* ═══════════════════════════════════════════════════════════════════════════
   L'IA DÉPOSE SES ÉTAPES DANS LE MONTAGE

   Il y avait deux écrans pour la même chose : le découpage à la main, et la
   « vérification » de ce que l'IA avait produit. Deux écrans qui font le même
   travail finissent toujours par diverger — l'un reçoit une amélioration,
   l'autre non.

   Désormais l'IA dépose ses étapes dans le montage, et l'on continue là où elle
   s'est arrêtée : on peut ajuster une borne, en ajouter une qu'elle a manquée,
   supprimer un doublon. Le bouton dit « Terminer l'étape 4 » alors qu'elle en a
   produit trois — c'est exactement ce qu'un écran séparé interdisait.
   ═══════════════════════════════════════════════════════════════════════════ */

let dvEdition = null      // identifiant de la procédure ouverte, ou null en création

window.ouvrirMontageVideo = async function(procId) {
  dvEdition = procId || null
  showGestionScreen('p-create-video')

  const el = (i) => document.getElementById(i)
  el('create-error-video').textContent = ''
  el('publish-btn-video').textContent = dvEdition
    ? 'Enregistrer les modifications' : 'Publier la proc\u00e9dure'

  /* En modification, l'écran ne parle plus de découpage : on vient corriger une
     procédure qui existe, pas en fabriquer une. */
  /* Les libellés de CRÉATION ne parlent plus de l'IA : ce mode a été retiré de
     l'écran de création, et le bouton qui rédigeait les textes n'existe plus.
     Cette page ne sert qu'à découper — soit une procédure qu'on modifie, soit
     une vidéo qu'on remonte. */
  el('dv-titre-page').textContent = dvEdition
    ? 'Modifier la proc\u00e9dure' : 'D\u00e9couper la vid\u00e9o'
  el('dv-sous').textContent = dvEdition
    ? "Vos changements ne partent qu'\u00e0 l'enregistrement"
    : 'Marquez le d\u00e9but et la fin de chaque \u00e9tape'
  el('dv-entete').style.display = dvEdition ? 'block' : 'none'

  if (!dvEdition) return

  const [{ data: proc }, { data: etapes }] = await Promise.all([
    supabase.from('procedures').select('*').eq('id', procId).single(),
    supabase.from('etapes').select('*').eq('procedure_id', procId).order('ordre'),
  ])
  if (!proc) { el('create-error-video').textContent = 'Proc\u00e9dure introuvable.'; return }


  el('dv-categorie').value = proc.categorie || ''
  el('dv-sous-categorie').value = proc.sous_categorie || ''
  el('dv-titre').value = proc.titre || ''

  currentVideoFile = null
  reinitialiserCouverture(proc.image_url || null)

  const player = el('video-player')
  player.src = (await urlSignee(proc.video_url)) || ''
  player.style.display = proc.video_url ? 'block' : 'none'
  el('video-placeholder').style.display = proc.video_url ? 'none' : 'flex'
  /* Les commandes suivent la vidéo : elles n'apparaissent QUE s'il y en a une.
     À la modification d'une procédure, la vidéo est déjà là — il ne faut pas
     les masquer comme sur un formulaire vide. */
  const _cmd = document.getElementById('dv-cmd')
  if (_cmd) _cmd.style.display = proc.video_url ? 'flex' : 'none'
  el('dv-travail').style.display = 'block'

  /* Les bornes sont déduites quand elles manquent : une étape sans fin prend le
     début de la suivante. C'est ce que fait déjà la fiche. */
  const bornes = calculerBornes(etapes || [], null)
  videoSteps = (etapes || []).map(e => {
    const b = bornes.get(e.id)
    return {
      id: e.id, texte: e.texte || '',
      /* ═══ LE POINT DE VIGILANCE ÉTAIT PERDU ICI ═══

         Cette recopie ne gardait que cinq champs, et `attention` n'en faisait
         pas partie. Le montage vidéo ne le lisait donc pas — et comme il
         réécrit toutes les étapes à l'enregistrement, il l'effaçait en base.

         Le défaut ne se voyait qu'après coup : on modifiait un titre, on
         enregistrait, et un avertissement rédigé par l'IA disparaissait sans
         que rien ne le signale. C'est le pire des trois cas — ni erreur, ni
         message, et une information de sécurité en moins. */
      attention: e.attention || null,
      timestamp_video: b ? b.start : (e.timestamp_video || 0),
      fin_video: b ? b.end : (e.fin_video || 0),
      image_url: e.image_url || null,
    }
  })

  dvDebutEnCours = videoSteps.length ? videoSteps[videoSteps.length - 1].fin_video : 0
  dvSelection = null
  dvMajGeste()
  renderVideoSteps()

  player.addEventListener('loadedmetadata', async () => {
    /* LE BOUTON SE REDESSINE ICI, pas plus tôt.

       `dvMajGeste()` a déjà été appelé juste au-dessus, mais la vidéo n'avait
       pas encore livré sa durée : `v.duration` valait NaN, le test « tout est
       découpé ? » répondait non, et le bouton restait sur « Terminer l'étape 6 »
       alors qu'il n'y avait plus rien à terminer.

       On le redessine une fois la durée connue. */
    dvMajGeste()
    dvMajFrise()
    await generateFilmstrip(player, 'capcut-track')
  }, { once: true })
}

document.getElementById('video-input')?.addEventListener('change', async (e) => {
  const file = e.target.files[0]
  if (!file) return
  currentVideoFile = file
  videoSteps = []
  renderVideoSteps()
  const url = URL.createObjectURL(file)
  const player = document.getElementById('video-player')
  player.src = url
  player.style.display = 'block'
  /* La vidéo s'affiche TOUT DE SUITE, sur sa première image. Elle restait noire
     jusqu'à ce qu'on appuie sur « Lancer » — on croyait l'import raté.
     `load()` demande au navigateur d'aller chercher cette première image. */
  player.load()
  document.getElementById('dv-cmd').style.display = 'flex'
  document.getElementById('video-placeholder').style.display = 'none'
  document.getElementById('dv-travail').style.display = 'block'
  dvDebutEnCours = 0
  dvSelection = null
  dvMajGeste()

  player.addEventListener('loadedmetadata', async () => {
    dvMajFrise()
    await generateFilmstrip(player, 'capcut-track')
  }, { once: true })
})

/* Le bouton ne changeait jamais d'icône : rien ne basculait entre le triangle
   et les deux barres. On écoute donc l'état réel de la vidéo, ce qui reste juste
   même quand la lecture s'arrête d'elle-même en fin de clip. */
function majIconePlay(player, prefix) {
  const play = document.getElementById(prefix + '-play-icon')
  const pause = document.getElementById(prefix + '-pause-icon')
  if (!play || !pause) return
  const enLecture = player && !player.paused && !player.ended
  play.style.display = enLecture ? 'none' : ''
  pause.style.display = enLecture ? '' : 'none'
}

document.getElementById('ecap-play-btn')?.addEventListener('click', () => {
  const player = document.getElementById('edit-video-player')
  if (player.paused) player.play(); else player.pause()
})

/* « Découper une étape ici » sur l'écran de modification : même geste qu'à la
   création — une nouvelle étape de 8 secondes à la position de lecture. */
/* Abandon depuis l'écran de suivi : on arrête le sondage, on supprime, et on
   revient à la liste. */
document.getElementById('ai-annuler')?.addEventListener('click', async () => {
  const proc = allGestionProcedures.find(p => p.id === aiProcedureId) ||
    { id: aiProcedureId, titre: champManuel('titre')?.value || '' }
  if (!proc.id) return

  // On récupère l'adresse de la vidéo si elle n'est pas déjà en mémoire.
  if (!proc.video_url) {
    const { data } = await supabase.from('procedures').select('video_url').eq('id', proc.id).maybeSingle()
    if (data?.video_url) proc.video_url = data.video_url
  }

  const supprime = await abandonnerAnalyse(proc)
  if (!supprime) return

  if (aiPollTimer) { clearTimeout(aiPollTimer); aiPollTimer = null }
  stopAiProgressSimulation(0)
  aiProcedureId = null
  showGestionScreen('p-list')
  loadGestionProcedures()
})

document.getElementById('ecap-add-btn')?.addEventListener('click', () => {
  const player = document.getElementById('edit-video-player')
  const d = isFinite(player?.duration) ? player.duration : 0
  if (!d) { toast("Chargez d'abord la vidéo."); return }
  const debut = player.currentTime || 0
  const fin = Math.min(d, debut + 8)
  const sel = ecapEditor?.selected()
  const nouvelle = { id: null, texte: '', timestamp_video: debut, fin_video: fin }
  const position = sel != null ? sel + 1 : editStepsData.length
  editStepsData.splice(position, 0, nouvelle)
  renderEditSteps()
  ecapEditor?.select(position, { lire: false })
})
;['play', 'pause', 'ended'].forEach(ev => {
  document.getElementById('video-player')?.addEventListener(ev, () => {
    majIconePlay(document.getElementById('video-player'), 'capcut')
  })
  document.getElementById('edit-video-player')?.addEventListener(ev, () => {
    majIconePlay(document.getElementById('edit-video-player'), 'ecap')
  })
})

/* Le bouton « découper une étape ici » a disparu avec l'ancienne barre d'outils :
   le bouton unique fait ce travail pendant la lecture. */





// Petit bloc de boutons ↑ / ↓ commun à toutes les listes d'étapes
/* ═══════════════════════════════════════════════════════════════════════════
   RÉORDONNER LES ÉTAPES AU DOIGT

   Un appui maintenu soulève l'étape, on la déplace, on la pose. Les voisines
   coulissent pour montrer où elle va atterrir.

   Le principe : rien ne bouge dans le document pendant le geste. On mesure la
   position de chaque étape au départ, puis on ne joue que sur des `transform`
   — c'est le processeur graphique qui travaille, la mise en page n'est jamais
   recalculée. L'ordre réel du tableau n'est modifié qu'au relâchement.
   ═══════════════════════════════════════════════════════════════════════════ */
const DELAI_APPUI_LONG = 340

/* Palette des étapes. Elle tourne au-delà de huit étapes, ce qui suffit : deux
   étapes de même couleur seront alors très éloignées sur la frise. */
const PALETTE_ETAPES = ['#30D158', '#FDA81E', '#FA8A08', '#FEB731', '#FF375F', '#64D2FF', '#FFD60A', '#5E5CE6']
const COULEUR_ETAPE = (i) => PALETTE_ETAPES[i % PALETTE_ETAPES.length]

function activerGlissementEtapes(conteneur, donnerTableau, apres) {
  if (!conteneur || conteneur.dataset.glissementPret === '1') return
  conteneur.dataset.glissementPret = '1'

  let attente = null, depart = null, actif = null

  function elements() { return [...conteneur.querySelectorAll('.step-edit-item')] }

  function annulerAttente() {
    if (attente) { clearTimeout(attente); attente = null }
    depart = null
  }

  function souleverPuisSuivre(index, el, yDoigt) {
    const els = elements()
    actif = {
      index, el, yDoigt,
      cible: index,
      mesures: els.map(e => { const r = e.getBoundingClientRect(); return { haut: r.top, hauteur: r.height, milieu: r.top + r.height / 2 } }),
      els,
    }
    conteneur.classList.add('step-liste-en-cours')
    el.classList.add('attrape')
    els.forEach(e => { if (e !== el) e.classList.add('decale') })
    if (navigator.vibrate) { try { navigator.vibrate(12) } catch (e) {} }
  }

  function suivre(y) {
    if (!actif) return
    const dy = y - actif.yDoigt
    actif.el.style.transform = `translateY(${dy}px) scale(1.025)`

    // Où l'étape atterrirait-elle si on relâchait maintenant ?
    const centre = actif.mesures[actif.index].milieu + dy
    let cible = actif.index
    for (let i = 0; i < actif.mesures.length; i++) {
      if (i === actif.index) continue
      if (i < actif.index && centre <= actif.mesures[i].milieu) { cible = Math.min(cible, i) }
      if (i > actif.index && centre >= actif.mesures[i].milieu) { cible = Math.max(cible, i) }
    }
    actif.cible = cible

    // Les voisines coulissent de la hauteur de l'étape soulevée.
    const h = actif.mesures[actif.index].hauteur + 10   // + la marge entre étapes
    actif.els.forEach((e, i) => {
      if (i === actif.index) return
      let d = 0
      if (cible < actif.index && i >= cible && i < actif.index) d = h
      if (cible > actif.index && i > actif.index && i <= cible) d = -h
      e.style.transform = d ? `translateY(${d}px)` : ''
    })
  }

  function relacher() {
    annulerAttente()
    if (!actif) return
    // Le relâchement produit un clic : sans ce garde-fou, poser une étape la
    // sélectionnerait au passage dans l'éditeur, ce qui n'a rien à voir.
    conteneur.dataset.glissementRecent = '1'
    setTimeout(() => { delete conteneur.dataset.glissementRecent }, 60)
    const { index, cible } = actif
    conteneur.classList.remove('step-liste-en-cours')
    actif.els.forEach(e => { e.style.transform = ''; e.classList.remove('attrape', 'decale') })
    actif = null
    if (cible !== index) {
      // On demande le tableau au moment du relâchement : il a pu être remplacé
      // depuis le branchement (réinitialisation du formulaire, par exemple).
      const tableau = donnerTableau()
      const [item] = tableau.splice(index, 1)
      tableau.splice(cible, 0, item)
    }
    apres?.(cible)
  }

  conteneur.addEventListener('pointerdown', (e) => {
    // Le texte, la corbeille et les boutons de photo gardent leur usage normal.
    if (e.target.closest('textarea, button, .del, input, .img-toucher')) return
    const item = e.target.closest('.step-edit-item')
    if (!item) return
    const index = elements().indexOf(item)
    if (index < 0) return
    depart = { x: e.clientX, y: e.clientY }
    /* Plus de poignée : l'appui long sur la carte est le seul geste. */
    attente = setTimeout(() => { attente = null; souleverPuisSuivre(index, item, e.clientY) }, DELAI_APPUI_LONG)
  })

  conteneur.addEventListener('pointermove', (e) => {
    // Un doigt qui glisse avant la fin du délai : la personne fait défiler.
    if (depart && !actif && (Math.abs(e.clientY - depart.y) > 8 || Math.abs(e.clientX - depart.x) > 8)) annulerAttente()
    if (!actif) return
    e.preventDefault()
    suivre(e.clientY)
  })

  ;['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => conteneur.addEventListener(ev, relacher))
}

/* Poignée de déplacement. Elle remplace les deux flèches : trois traits, le
   geste universel du « prends-moi et déplace-moi ». */
/* Les trois barres de déplacement ont été retirées : l'appui long sur la carte
   fait déjà le même travail, et sur un téléphone une poignée de seize pixels se
   manque une fois sur deux. La carte entière est une cible bien plus sûre. */


// ═══ Étapes manuelles (texte seul, pas de vidéo) ═══
/* Les deux dessins du fil, dans la palette des icônes de création : retrait à
   16 %, trait de devant à 42 %, fond à 5 %. */
/* Le numéro d'une étape reprend l'hexagone de la médaille : même forme, mêmes
   facettes, en matière neutre. Toute l'app parle ainsi d'une seule géométrie —
   la fiche empilée pour les procédures, l'hexagone pour ce qui se compte. */
function numeroEtapeDess(n, taille) {
  /* Un rond plutôt qu'un hexagone. La forme à facettes appelait le regard à
     chaque étape : sur une procédure de quinze lignes, quinze petits bijoux
     valent moins qu'un repère discret. Le numéro compte, pas son écrin.

     La taille est écrite DANS le dessin, pas seulement en CSS : un SVG sans
     `width` ni `height` disparaît si la règle censée la lui donner ne
     s'applique pas. */
  const T = taille || 33
  return `<svg viewBox="0 0 30 30" width="${T}" height="${T}" fill="none" style="display:block">
    <circle cx="15" cy="15" r="12.6" fill="rgba(255,255,255,0.05)"
            stroke="rgba(255,255,255,0.30)" stroke-width="1.4"/>
    <text x="15" y="19.4" text-anchor="middle" font-family="Inter,sans-serif" font-size="12"
          font-weight="750" fill="rgba(255,255,255,0.86)">${n}</text>
  </svg>`
}

/* L'hexagone une fois l'étape faite : même forme, matiere bleue, une coche
   dedans. Garder la forme entre les deux états évite le saut visuel — seule la
   couleur change, comme quand on coche une case. */
function cocheFaiteDess(taille) {
  /* Même rond, rempli. Garder la forme entre les deux états évite le saut
     visuel : seule la couleur change, comme quand on coche une case. */
  const T = taille || 33
  return `<svg viewBox="0 0 30 30" width="${T}" height="${T}" fill="none" style="display:block">
    <circle cx="15" cy="15" r="12.6" fill="#FEB731"/>
    <path d="M10 15.2 13.4 18.6 20 11.8" stroke="#2E1B00" stroke-width="2.2"
          stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`
}

function plusEtapeDess(taille) {
  const T = taille || 33
  return `<svg viewBox="0 0 30 30" width="${T}" height="${T}" fill="none" style="display:block">
    <circle cx="15" cy="15" r="12.6" fill="rgba(255,255,255,0.04)"
            stroke="rgba(255,255,255,0.28)" stroke-width="1.4" stroke-dasharray="3.4 3"/>
    <line x1="15" y1="10.6" x2="15" y2="19.4" stroke="rgba(255,255,255,0.45)" stroke-width="1.7" stroke-linecap="round"/>
    <line x1="10.6" y1="15" x2="19.4" y2="15" stroke="rgba(255,255,255,0.45)" stroke-width="1.7" stroke-linecap="round"/>
  </svg>`
}

/* Le rang de l'étape qui vient d'être ajoutée, pour ne l'animer qu'une fois.
   Sans ce garde-fou, toute la liste rejouerait l'animation à chaque frappe. */
let etapeNeuve = -1

/* ═══ Annuler la dernière action ═══
   Le bouton disait « Revenir en arrière » et changeait de page : deux sens pour
   la même formule. Il défait maintenant la dernière manipulation — une étape
   ajoutée, supprimée, réordonnée — et rien d'autre.

   On garde des copies complètes plutôt que des opérations inversées : c'est plus
   coûteux en mémoire, mais une copie ne peut pas se tromper, là où une opération
   inversée mal écrite corrompt silencieusement les données. */
const PILE_MAX = 25
let pileEtats = []

function memoriserEtat() {
  pileEtats.push(JSON.stringify(manualSteps))
  if (pileEtats.length > PILE_MAX) pileEtats.shift()
  majBoutonDefaire()
}

function majBoutonDefaire() {
}


/* Un champ masqué mesure zéro : `scrollHeight` ne vaut rien tant que l'écran
   n'est pas affiché. Les étapes venant de l'IA arrivaient donc coupées à une
   ligne, parce qu'on les dessinait avant de montrer la page. On repasse dessus
   une fois l'écran à l'écran. */
function ajusterChampsVisibles() {
  requestAnimationFrame(() => {
    document.querySelectorAll('.screen.active textarea').forEach(t => autoResizeTextarea(t))
  })
}

function renderManualSteps() {
/* Retirer la photo d'une étape. Il n'y avait aucun moyen de le faire : une
   photo posée par erreur restait là pour toujours. */
document.getElementById('manual-steps-list')?.addEventListener('click', (e) => {
  const croix = e.target.closest('.img-oter')
  if (!croix) return
  e.preventDefault()
  e.stopPropagation()
  const ligne = croix.closest('[data-index]')
  const i = Number(ligne?.dataset.index)
  if (!Number.isInteger(i) || !manualSteps[i]) return
  manualSteps[i].image_url = null
  manualSteps[i].imageFichier = null
  manualSteps[i].imageARetirer = true
  repeindreSansSauter(renderManualSteps)
  if (navigator.vibrate) navigator.vibrate(6)
})

  const listEl = document.getElementById('manual-steps-list')
  listEl.innerHTML = ''
  manualSteps.forEach((step, i) => {
    const div = document.createElement('div')
    div.className = 'step-edit-item'
    div.dataset.index = i
    /* Le numéro est dessiné dans le langage des icônes de création : une fiche en
       profondeur, avec son chiffre dedans. Il se pose sur le fil, à gauche. */
    div.innerHTML = `
      <span class="step-num-dess">${numeroEtapeDess(i + 1)}</span>
      <textarea rows="1" placeholder="Décrire cette étape...">${escapeHtml(step.texte)}</textarea>
      <div class="step-bas">
      <div class="step-img">
        <div class="step-img-vignette${step.image_url || step.imageFichier ? ' pleine' : ''}">${step.image_url
          ? `<img data-fichier="${escapeHtml(cheminFichier(step.image_url))}" alt="">`
          : (step.imageFichier ? `<img src="${URL.createObjectURL(step.imageFichier)}" alt="">` : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m21 16-5-5-6 6-2-2-5 5"/></svg>`)}${step.image_url || step.imageFichier
          ? `<button type="button" class="img-oter" aria-label="Retirer la photo">×</button>`
          : ''}${step.image_url || step.imageFichier
          ? `<button type="button" class="img-oter" aria-label="Retirer la photo">×</button>`
          : ''}</div>
        <button type="button" class="img-toucher"button type="button" class="img-toucher" aria-label="Photo de l'étape">
          <span class="lg">${step.image_url || step.imageFichier ? 'Modifier la photo' : 'Ajouter une photo'}</span>
        </button>
        <input type="file" accept="image/*" class="fichier">
      </div>
      <span class="del">${TRASH_SVG}</span>
      </div>
    `
    const textarea = div.querySelector('textarea')
    textarea.addEventListener('input', (e) => { manualSteps[i].texte = e.target.value; autoResizeTextarea(e.target) })

    /* Le champ ne s'ajustait qu'à LA SAISIE. Rempli par l'IA — ou relu après
       coup —, il gardait sa hauteur d'une ligne et coupait le texte au milieu.
       On l'ajuste donc aussi à l'affichage.

       Au prochain rendu plutôt que tout de suite : `scrollHeight` vaut zéro
       tant que l'élément n'est pas dans la page. */
    requestAnimationFrame(() => autoResizeTextarea(textarea))

    /* La photo n'est pas envoyée tout de suite : on la garde de côté et elle
       part avec la publication, en même temps que le reste. Inutile d'occuper
       le réseau pour une étape qui sera peut-être supprimée. */
    const champFichier = div.querySelector('.fichier')
    /* La vignette EST la commande. Sans photo, elle ouvre directement le
       sélecteur — poser une question quand il n'y a qu'une réponse serait un
       geste de trop. Avec une photo, elle propose de remplacer ou de retirer. */
    const toucherPhoto = async () => {
      if (!(manualSteps[i].image_url || manualSteps[i].imageFichier)) { champFichier.click(); return }
      const choix = await choisirAction({
        titre: `Photo de l'\u00e9tape ${i + 1}`,
        options: [
          { cle: 'changer', libelle: 'Remplacer la photo' },
          { cle: 'retirer', libelle: 'Retirer la photo', danger: true },
        ],
      })
      if (choix === 'changer') champFichier.click()
      if (choix === 'retirer') {
        manualSteps[i].imageFichier = null
        manualSteps[i].image_url = null
        renderManualSteps()
      }
    }
    div.querySelector('.step-img-vignette')?.addEventListener('click', toucherPhoto)
    div.querySelector('.img-toucher')?.addEventListener('click', toucherPhoto)

    champFichier.addEventListener('change', (e) => {
      const f = e.target.files[0]
      if (!f) return
      if (f.size > 6 * 1024 * 1024) { toast('Photo trop lourde : 6 Mo maximum.'); return }
      manualSteps[i].imageFichier = f
      manualSteps[i].image_url = null
      renderManualSteps()
    })
    div.querySelector('.del').addEventListener('click', () => {
      demanderSuppressionEtape(i + 1, manualSteps[i].texte, () => { manualSteps.splice(i, 1); renderManualSteps() })
    })
    if (i === etapeNeuve) div.classList.add('neuve')
    listEl.appendChild(div)
  signerMedias(listEl)
    autoResizeTextarea(textarea)
  })
  etapeNeuve = -1

  /* « Ajouter une étape » devient le dernier maillon du fil, en pointillés : le
     geste se comprend avant qu'on ait lu le texte. */
  const plus = document.createElement('button')
  plus.type = 'button'
  plus.className = 'man-plus'
  plus.innerHTML = `<span class="d">${plusEtapeDess()}</span>Ajouter une \u00e9tape`
  plus.addEventListener('click', () => {
    /* On n'ouvre PAS le clavier sur la nouvelle étape. Il masque la moitié de
       l'écran et fait sauter la page au moment où l'on veut justement voir ce
       qu'on vient d'ajouter. Ajouter et écrire sont deux gestes distincts.

       Vider la liste avant de la reconstruire raccourcit la page d'un coup : le
       navigateur ramène alors le défilement dans les nouvelles limites, et on se
       retrouve en haut. On note où l'on était pour y revenir. */
    const ouEtaitOn = window.scrollY
    memoriserEtat()
    manualSteps.push({ texte: '' })
    etapeNeuve = manualSteps.length - 1
    renderManualSteps()
    window.scrollTo({ top: ouEtaitOn })
    if (navigator.vibrate) navigator.vibrate(6)
  })
  listEl.appendChild(plus)


  activerGlissementEtapes(listEl, () => manualSteps, () => renderManualSteps())
}

// ═══ Étapes issues du découpage vidéo ═══
/* ═══════════════════════════════════════════════════════════════════════════
   DÉCOUPER UNE VIDÉO — UN SEUL GESTE

   On regarde, et on marque la fin de chaque étape au passage. Le bouton fait
   les deux : il lance la lecture, puis il ferme l'étape en cours à chaque
   appui, comme un chronomètre de tours.

   Ce qui a été coupé se corrige ensuite dans la liste — c'est là qu'on relit,
   donc c'est là qu'on rectifie. Aucune poignée à attraper, aucune frise à
   comprendre.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   L'IMAGE DE LA PROCÉDURE

   Une seule image pour l'ensemble, distincte des photos d'étape. Les procédures
   sans vidéo n'avaient rien à montrer sur leur carte, et une liste de titres se
   ressemble toute.

   Comme pour les photos d'étape, le fichier n'est pas envoyé tout de suite : il
   attend la publication. Inutile d'occuper le réseau pour une procédure qui sera
   peut-être abandonnée.
   ═══════════════════════════════════════════════════════════════════════════ */

let couvertureFichier = null    // en attente d'envoi
let couvertureUrl = null        // déjà en ligne
let couvertureARetirer = false

function peindreCouverture() {
  document.querySelectorAll('.couv').forEach(bloc => {
    const vign = bloc.querySelector('.vign')
    const oter = bloc.querySelector('.oter')
    const sous = bloc.querySelector('.tx .s')
    const source = couvertureFichier ? URL.createObjectURL(couvertureFichier) : couvertureUrl

    /* La zone de dépôt devient une ligne dès qu'une photo est là : il n'y a plus
       rien à déposer, seulement quelque chose à montrer. */
    bloc.classList.toggle('remplie', !!source)

    if (source) {
      vign.innerHTML = `<img src="${source}" alt="">`
      oter.style.display = 'block'
      sous.textContent = couvertureFichier ? "Sera envoy\u00e9e \u00e0 la publication." : 'En place.'
    } else {
      /* Le dessin des icônes de création : trois plans, le trait de devant à
         42 %, le fond à 5 %. */
      vign.innerHTML = `<svg viewBox="0 0 52 48" fill="none">
        <rect x="14" y="3" width="26" height="17" rx="5" stroke="rgba(255,255,255,0.16)" stroke-width="2"/>
        <rect x="8" y="10" width="34" height="22" rx="6" stroke="rgba(255,255,255,0.26)" stroke-width="2"/>
        <rect x="3" y="18" width="40" height="27" rx="7" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.42)" stroke-width="2"/>
        <circle cx="12" cy="27" r="2.4" fill="rgba(255,255,255,0.42)"/>
        <path d="m41 40-9-9-7 7-3.5-3.5L3 44" stroke="rgba(255,255,255,0.42)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`
      oter.style.display = 'none'
      sous.textContent = "Elle appara\u00eet sur sa carte et en t\u00eate de la fiche. Facultative."
    }
  })
}

function reinitialiserCouverture(url) {
  couvertureFichier = null
  couvertureUrl = url || null
  couvertureARetirer = false
  document.querySelectorAll('.couv input[type=file]').forEach(c => { c.value = '' })
  peindreCouverture()
}

document.addEventListener('change', (e) => {
  const champ = e.target.closest('.couv input[type=file]')
  if (!champ) return
  const f = champ.files[0]
  if (!f) return
  if (f.size > 6 * 1024 * 1024) {
    toast('Image trop lourde : 6 Mo maximum.')
    champ.value = ''
    return
  }
  couvertureFichier = f
  couvertureARetirer = false
  peindreCouverture()
})

document.addEventListener('click', (e) => {
  const oter = e.target.closest('.couv .oter')
  if (!oter) return
  e.preventDefault()
  /* On note le retrait au lieu d'effacer tout de suite : tant qu'on n'a pas
     enregistré, on peut encore changer d'avis. */
  couvertureARetirer = !!couvertureUrl
  couvertureFichier = null
  couvertureUrl = null
  document.querySelectorAll('.couv input[type=file]').forEach(c => { c.value = '' })
  peindreCouverture()
})

/* Envoie l'image si elle a changé, et renvoie l'adresse à écrire en base.
   Une image qui échoue n'empêche rien : la procédure sera simplement sans elle. */
async function envoyerCouverture(procedureId) {
  if (couvertureARetirer && !couvertureFichier) return null
  if (!couvertureFichier) return couvertureUrl
  try {
    const ext = (couvertureFichier.name.split('.').pop() || 'jpg').toLowerCase()
    const chemin = `${currentMembre.entreprise_id}/${procedureId}/couverture-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('procedo-videos')
      .upload(chemin, couvertureFichier, { upsert: true, cacheControl: CACHE_LONG })
    if (error) throw error
    /* On stocke le CHEMIN, pas une adresse : les adresses signées expirent, une
         adresse gardée en base serait morte au bout d'une heure. */
      return chemin
  } catch (ex) {
    console.warn('Standix \u00b7 image de couverture non envoy\u00e9e :', ex?.message || ex)
    return couvertureUrl
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   DÉCOUPER UNE VIDÉO — UN SEUL GESTE

   On regarde, et on marque la fin de chaque étape au passage : le bouton lance
   la lecture, puis ferme l'étape en cours à chaque appui.
   ════════════════════════════════════════════════════════════════════════════ */

let dvDebutEnCours = 0        // début de l'étape que l'on est en train de vivre
let dvSelection = null

function dvLecteur() { return document.getElementById('video-player') }

function dvFmt(s) {
  if (!isFinite(s)) return '0:00'
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0')
}

/* Une vignette : l'image de la vidéo à l'instant voulu, prise au canevas. Rien
   n'est ré-encodé, c'est un simple dessin. */
function dvVignette(canvas, seconde) {
  const v = dvLecteur()
  if (!v || !v.videoWidth) return
  const clone = document.createElement('video')
  clone.src = v.src
  clone.muted = true
  clone.addEventListener('loadeddata', () => {
    clone.currentTime = Math.min(seconde, (clone.duration || 1) - 0.05)
  }, { once: true })
  clone.addEventListener('seeked', () => {
    try { canvas.getContext('2d').drawImage(clone, 0, 0, canvas.width, canvas.height) } catch (e) {}
    clone.src = ''
  }, { once: true })
}

function dvMajGeste() {
  const v = dvLecteur()
  const b = document.getElementById('dv-bouton')
  const ic = document.getElementById('dv-icone')
  const lib = document.getElementById('dv-libelle')
  const aide = document.getElementById('dv-aide')
  if (!b) return

  /* Le bouton n'annonce « Lancer la vidéo » QUE tant que rien n'a commencé.
     Dès qu'on a dépassé le début, il coupe — en lecture comme en pause — et son
     libellé doit le dire, sinon on croit qu'il faut relancer pour continuer. */
  const rienCommence = !v || (v.paused && !videoSteps.length && v.currentTime < 0.3)

  /* ═══ LA VIDÉO EST ENTIÈREMENT DÉCOUPÉE ═══

     Il ne reste rien à fermer : proposer « Terminer l'étape 7 » serait proposer
     un geste impossible. Le bouton offre alors la seule chose qui ait du sens à
     ce moment-là — tout reprendre.

     Une demi-seconde de tolérance : une vidéo ne s'arrête jamais exactement sur
     sa dernière image. */
  const dureeTot = v && isFinite(v.duration) ? v.duration : 0
  const toutDecoupe = dureeTot > 0 && videoSteps.length > 0 && (dureeTot - dvDebutEnCours) < 0.5

  /* ═══ PLUS DE « RECOMMENCER LE DÉCOUPAGE » ═══

     Quand toute la vidéo était découpée, le bouton devenait « Recommencer » et
     effaçait toutes les étapes d'un coup.

     C'est un geste destructeur logé là où l'on venait de terminer un travail —
     et le seul moyen de le défaire était de tout refaire. Il est retiré.

     Le bouton se désactive à la place : il n'y a plus rien à couper. */
  if (toutDecoupe) {
    b.classList.remove('coupe', 'refaire')
    b.disabled = true
    ic.innerHTML = '<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>'
    lib.textContent = 'D\u00e9coupage termin\u00e9'
    aide.textContent = 'Toute la vid\u00e9o est d\u00e9coup\u00e9e. Corrigez les textes ci-dessous.'
    return
  }
  b.disabled = false
  b.classList.remove('refaire')

  if (rienCommence) {
    b.classList.remove('coupe')
    ic.innerHTML = '<path d="M8 5v14l11-7z"/>'
    lib.textContent = 'Lancer la vid\u00e9o'
    aide.textContent = videoSteps.length
      ? "Corrigez les textes ci-dessous, ou reprenez pour continuer \u00e0 d\u00e9couper."
      : "Regardez, et touchez le bouton chaque fois qu'une \u00e9tape se termine."
  } else {
    b.classList.add('coupe')
    ic.innerHTML = '<rect x="4" y="5" width="16" height="14" rx="3"/>'
    lib.textContent = "Terminer l'\u00e9tape " + (videoSteps.length + 1)
    aide.textContent = "Touchez d\u00e8s que ce geste-l\u00e0 est fini."
  }
}

/* ═══ LE ZOOM DE LA FRISE ═══

   Cinq fois par défaut. À l'échelle de la vidéo entière, une étape de trois
   secondes sur deux minutes fait deux pixels : on ne peut ni la lire, ni
   attraper sa coupure. Le bouton « Tout voir » rend la vue d'ensemble quand on
   veut vérifier le découpage complet. */
let dvZoom = 5

function dvAppliquerZoom() {
  const f = document.getElementById('dv-frise')
  const vue = document.getElementById('dv-vue')
  const b = document.getElementById('dv-zoom')
  if (!f || !vue) return
  /* Largeur visible × zoom, en pixels. À ×1 la frise occupe exactement l'écran ;
     à ×5 elle en fait cinq fois la largeur et défile sous le trait. */
  const large = Math.round(vue.clientWidth * dvZoom)
  if (large > 0) f.style.width = large + 'px'
  if (b) {
    /* Le pincement donne des valeurs continues : on compare à un seuil plutôt
       qu'à l'égalité stricte, sinon le bouton resterait bloqué sur un libellé. */
    const entier = dvZoom <= 1.05
    b.classList.toggle('large', entier)
    const t = document.getElementById('dv-zoom-txt')
    if (t) t.textContent = entier ? 'Rapprocher' : 'Tout voir'
  }
}

/* Le trait étant fixe, il n'y a plus rien à suivre : la piste se replace
   d'elle-même sous lui à chaque image. */
function dvSuivreTete() { dvPistePourTemps() }

document.getElementById('dv-zoom')?.addEventListener('click', () => {
  dvZoom = dvZoom <= 1.05 ? 5 : 1
  dvAppliquerZoom()
  dvMajFrise()
  dvSuivreTete()
  if (navigator.vibrate) navigator.vibrate(6)
})

/* ═══ LE DÉFILEMENT PILOTE LA VIDÉO ═══

   Le trait est fixe au centre : la position de la vidéo, c'est donc la position
   du défilement. Les deux sont liés dans les DEUX sens — la vidéo avance, la
   piste glisse ; on fait glisser la piste, la vidéo suit.

   Le piège est la boucle : écrire dans l'un déclenche l'événement de l'autre, qui
   réécrit dans le premier, et l'image se met à trembler. Le drapeau `pilote`
   dit qui a la main à cet instant, et l'autre se tait.

   On garde le défilement NATIF plutôt qu'un geste à la main : il a l'inertie,
   le rebond, et le pincement du navigateur. Aucun code ne les imite bien. */
let dvPilote = null      // 'doigt' quand la main tient la piste
/* Vrai pendant qu'on règle une coupure : la piste ne suit plus la vidéo. */
let dvFige = false
let dvRelache = null
let dvAttendu = -1       // la position que le code vient d'écrire

/* Le retrait, en pixels : la moitié de la largeur visible de chaque côté. */
function dvPoserRetrait() {
  const vue = document.getElementById('dv-vue')
  const piste = document.getElementById('dv-piste')
  if (!vue || !piste) return
  const moitie = Math.round(vue.clientWidth / 2)
  if (!moitie) return
  piste.style.paddingLeft = moitie + 'px'
  piste.style.paddingRight = moitie + 'px'
}
window.addEventListener('resize', () => { dvPoserRetrait(); dvPistePourTemps() })

function dvPistePourTemps() {
  const piste = document.getElementById('dv-piste')
  const f = document.getElementById('dv-frise')
  const v = dvLecteur()
  if (!piste || !f || !v || dvPilote === 'doigt' || dvFige) return
  const duree = v.duration || 1
  /* On note la position écrite plutôt que de lever un drapeau le temps d'une
     image : l'événement de défilement arrive quand le navigateur veut, souvent
     après. Le drapeau retombait avant lui, et le défilement de la vidéo était
     pris pour un geste — la lecture se mettait en pause toute seule. */
  dvAttendu = (v.currentTime / duree) * f.offsetWidth
  piste.scrollLeft = dvAttendu
}

;(() => {
  const piste = document.getElementById('dv-piste')
  const f = document.getElementById('dv-frise')
  if (!piste || !f) return

  let jouait = false

  piste.addEventListener('scroll', () => {
    const v = dvLecteur()
    if (!v) return
    /* Le défilement que le code vient d'écrire ne compte pas : deux pixels de
       tolérance, car le navigateur arrondit. */
    if (dvPilote !== 'doigt' && Math.abs(piste.scrollLeft - dvAttendu) < 2) return

    /* Premier mouvement du doigt : on met la vidéo en pause, sinon elle
       continuerait d'avancer et lutterait contre la main. */
    if (dvPilote !== 'doigt') {
      dvPilote = 'doigt'
      jouait = !v.paused
      v.pause()
    }

    const duree = v.duration || 1
    const t = (piste.scrollLeft / Math.max(1, f.offsetWidth)) * duree
    v.currentTime = Math.max(0, Math.min(duree, t))
    dvMajFrise()

    /* Le navigateur ne prévient pas de la fin d'un défilement : on la déduit
       d'un silence de 140 ms. */
    clearTimeout(dvRelache)
    dvRelache = setTimeout(() => {
      dvPilote = null
      if (jouait) { jouait = false; dvLecteur()?.play() }
    }, 140)
  }, { passive: true })
})()

/* ═══ ANNULER LA DERNIÈRE COUPURE ═══

   On vient de fermer une étape au mauvais moment : on la retire, et la vidéo
   repart de là où cette étape commençait. C'est le geste qu'on cherche quand on
   a appuyé trop tôt — pas un recul de quelques secondes.

   Une étape qui porte déjà du texte n'est pas effacée sans confirmation : ce
   serait perdre un travail de rédaction pour un geste de découpage. */
function majBoutonAnnuler() {
  const b = document.getElementById('dv-annuler')
  if (b) b.disabled = videoSteps.length === 0
}

document.getElementById('dv-annuler')?.addEventListener('click', async () => {
  if (!videoSteps.length) return
  const derniere = videoSteps[videoSteps.length - 1]

  if (String(derniere.texte || '').trim()) {
    const ok = await confirmDialog({
      titre: 'Retirer cette \u00e9tape ?',
      message: `\u00ab ${derniere.texte.slice(0, 60)} \u00bb sera effac\u00e9e avec sa coupure.`,
      confirmer: 'Retirer',
      annuler: 'Garder',
      danger: true,
    })
    if (!ok) return
  }

  const debut = derniere.timestamp_video
  videoSteps.pop()
  dvDebutEnCours = debut
  dvSelection = videoSteps.length ? videoSteps.length - 1 : null
  const v = dvLecteur()
  if (v) v.currentTime = debut
  dvMajGeste(); renderVideoSteps(); dvMajFrise()
  if (navigator.vibrate) navigator.vibrate(8)
})

function dvMajFrise() {
  const f = document.getElementById('dv-frise')
  const v = dvLecteur()
  if (!f || !v) return
  const duree = v.duration || 1

  f.querySelectorAll('.dv-seg').forEach(s => s.remove())
  videoSteps.forEach((e, i) => {
    const d = document.createElement('div')
    d.className = 'dv-seg' + (i === dvSelection ? ' sel' : '')
    d.style.left = (e.timestamp_video / duree * 100) + '%'
    d.style.width = ((e.fin_video - e.timestamp_video) / duree * 100) + '%'
    d.textContent = i + 1
    d.addEventListener('click', (ev) => {
      ev.stopPropagation()
      dvSelection = i; v.currentTime = e.timestamp_video
      renderVideoSteps(); dvMajFrise()
    })
    /* Les segments vont dans le calque rogné, pas dans la frise : sinon leurs
       coins déborderaient du cadre arrondi. */
    ;(document.getElementById('dv-fond') || f).appendChild(d)
  })

  /* Une poignée par coupure. La dernière étape se termine à la fin de la vidéo :
     sa borne n'est pas déplaçable, elle n'appartient à personne. */
  f.querySelectorAll('.dv-poi').forEach(x => x.remove())
  videoSteps.slice(0, -1).forEach((e, i) => {
    const poi = document.createElement('div')
    poi.className = 'dv-poi'
    poi.style.left = (e.fin_video / duree * 100) + '%'
    poi.innerHTML = `<span class="val">${dvFmt(e.fin_video)}</span>`
    poi.dataset.coupure = i
    f.appendChild(poi)
    brancherPoignee(poi, i)
  })

  /* L'ORDRE compte : la largeur de la frise, puis le retrait de la piste, puis
     seulement la position. Placer la piste avant de connaître la largeur revient
     à diviser par zéro — le trait se retrouvait n'importe où.

     On repose tout à chaque dessin plutôt qu'une fois pour toutes : la frise
     peut apparaître avant que la page ait sa taille définitive. */
  dvAppliquerZoom()
  dvPoserRetrait()
  dvPistePourTemps()
  document.getElementById('dv-t').textContent = dvFmt(v.currentTime)
  document.getElementById('dv-d').textContent = dvFmt(duree)
  majBoutonLecture()
  majBoutonAnnuler()
}

/* ═══ DÉPLACER UNE COUPURE ═══

   On appuie toujours un peu trop tard : le geste vient après ce qu'on a vu.
   Sans moyen de rattraper, il fallait tout refaire pour une demi-seconde.

   La vidéo suit le doigt pendant qu'on tire — c'est ça qui rend le réglage
   précis : on voit l'image exacte où la coupure va tomber, au lieu de viser
   un chiffre. */
const COUPURE_MINI = 1   // une étape d'une seconde ne montre rien

function brancherPoignee(poi, i) {
  const f = document.getElementById('dv-frise')
  const v = dvLecteur()
  if (!f || !v) return

  let tire = false
  let jouaitAvant = false
  let tVise = null
  let attenteImage = false

  const bornes = () => {
    const avant = i > 0 ? videoSteps[i - 1].fin_video : 0
    const apres = videoSteps[i + 1] ? videoSteps[i + 1].fin_video : (v.duration || 0)
    return [avant + COUPURE_MINI, apres - COUPURE_MINI]
  }

  /* ═══ LE DÉCALAGE DE PRISE ═══

     C'est LA différence avec CapCut. On posait la coupure sous le doigt dès le
     premier contact : la poignée sautait, et on perdait le point qu'on visait
     avant même d'avoir commencé à bouger.

     On retient l'écart entre le doigt et la poignée au moment où on l'attrape,
     et on le conserve pendant tout le geste. La poignée ne bouge pas d'un pixel
     tant que le doigt ne bouge pas — exactement comme on tient un objet. */
  let ecartPrise = 0

  const placer = (clientX) => {
    const r = f.getBoundingClientRect()
    const duree = v.duration || 1
    const [min, max] = bornes()
    let t = (clientX - ecartPrise - r.left) / r.width * duree
    t = Math.max(min, Math.min(max, t))

    /* Les deux étapes voisines se partagent l'instant : la fin de l'une EST le
       début de l'autre. Ne bouger qu'une seule des deux ouvrirait un trou. */
    videoSteps[i].fin_video = t
    if (videoSteps[i + 1]) videoSteps[i + 1].timestamp_video = t

    poi.style.left = (t / duree * 100) + '%'
    poi.querySelector('.val').textContent = dvFmt(t)

    /* LA VIDÉO SUIT, MAIS PAS À CHAQUE PIXEL.

       Chaque écriture de `currentTime` demande au décodeur de retrouver une
       image. Un doigt qui glisse produit soixante événements par seconde : le
       décodeur prend du retard, et le geste devient poussif.

       On ne lui demande qu'une image par rafraîchissement, et seulement quand
       il a fini la précédente. Le trait, lui, suit le doigt sans attendre. */
    tVise = t
    if (!attenteImage) {
      attenteImage = true
      requestAnimationFrame(() => {
        attenteImage = false
        if (tVise != null && Math.abs(v.currentTime - tVise) > 0.02) {
          try { v.currentTime = tVise } catch (e) {}
        }
      })
    }
  }

  poi.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    tire = true
    jouaitAvant = !v.paused
    v.pause()
    poi.classList.add('tire')
    poi.setPointerCapture(e.pointerId)

    /* ═══ LA PISTE SE FIGE ═══

       Le trait de lecture est au centre, et la piste se replace sous lui à
       chaque changement d'instant. Or régler une coupure CHANGE l'instant : la
       piste glissait donc sous le doigt pendant qu'on tirait la poignée.

       On tirait vers la droite, tout partait vers la gauche, et la poignée
       semblait fuir. Impossible à viser.

       Pendant le réglage, la piste ne bouge plus : la poignée reste exactement
       où le doigt la pose. */
    dvFige = true
    document.getElementById('dv-piste')?.classList.add('fige')
    if (navigator.vibrate) navigator.vibrate(8)

    /* On note où le doigt s'est posé par rapport à la poignée, et on NE
       DÉPLACE RIEN. Le premier mouvement partira d'ici. */
    const rp = poi.getBoundingClientRect()
    ecartPrise = e.clientX - (rp.left + rp.width / 2)
  })

  poi.addEventListener('pointermove', (e) => {
    if (!tire) return
    e.preventDefault()
    placer(e.clientX)
  })

  const relacher = () => {
    if (!tire) return
    tire = false

    /* La piste retrouve sa liberté, et se replace sous le trait à l'endroit où
       l'on vient de fixer la coupure. À poser APRÈS le test : sans lui, un
       relâchement qui ne nous concerne pas dégelait la piste au milieu du geste
       de quelqu'un d'autre. */
    dvFige = false
    document.getElementById('dv-piste')?.classList.remove('fige')
    dvPistePourTemps()
    poi.classList.remove('tire')
    /* La vidéo rejoint la position finale AVANT le redessin : sinon elle
       continuait de chercher son image pendant qu'on refaisait la frise, et
       l'écran sautait une dernière fois au moment où l'on lâche. */
    if (tVise != null) { try { v.currentTime = tVise } catch (e) {} }
    tVise = null

    /* On redessine : les durées affichées sous chaque étape ont changé. */
    renderVideoSteps()
    dvMajFrise()
    if (jouaitAvant) v.play()
    if (navigator.vibrate) navigator.vibrate(6)
  }
  /* ═══ LE RELÂCHEMENT DOIT TOUJOURS ARRIVER ═══

     Ces écouteurs étaient posés sur la poignée elle-même. Or `dvMajFrise()`
     recrée les poignées : si quoi que ce soit redessinait la frise pendant le
     geste, l'ancienne poignée disparaîssait avec son écouteur, le relâchement
     n'arrivait jamais, et la piste restait FIGÉE POUR DE BON — exactement ce
     qu'on observait : plus moyen de faire glisser quoi que ce soit, même
     pendant la lecture.

     Sur la fenêtre, l'écouteur survit à la disparition de son élément. */
  window.addEventListener('pointerup', relacher)
  window.addEventListener('pointercancel', relacher)
  poi.addEventListener('lostpointercapture', relacher)
}

/* ═══ LE FILET ═══
   Si malgré tout la piste restait figée — un geste interrompu par un appel,
   l'écran qui s'éteint — le premier doigt levé la libère. Un état bloquant
   doit toujours avoir une porte de sortie. */
document.addEventListener('pointerup', () => {
  if (!dvFige) return
  if (document.querySelector('.dv-poi.tire')) return   // un geste est en cours
  dvFige = false
  document.getElementById('dv-piste')?.classList.remove('fige')
}, true)

/* ═══ LECTURE ET PAUSE ═══
   On découpe en regardant : il faut pouvoir s'arrêter pour ajuster sans quitter
   l'écran ni perdre sa position. */
function majBoutonLecture() {
  const b = document.getElementById('dv-play')
  const v = dvLecteur()
  if (!b || !v) return
  b.classList.toggle('joue', !v.paused)
  b.setAttribute('aria-label', v.paused ? 'Lecture' : 'Pause')
}

/* Le bouton suit l'état réel du lecteur, pas seulement nos clics : la vidéo
   démarre aussi depuis le bouton de découpe, ou s'arrête seule à la fin. Sans
   ces écouteurs, l'icône mentirait sur ce qui se passe. */
;(() => {
  const v = document.getElementById('video-player')
  if (!v) return
  ;['play', 'pause', 'ended'].forEach(ev => v.addEventListener(ev, majBoutonLecture))
})()


document.getElementById('dv-play')?.addEventListener('click', () => {
  const v = dvLecteur()
  if (!v) return
  if (v.paused) v.play(); else v.pause()
  majBoutonLecture()
})

/* Le geste unique. */
document.getElementById('dv-bouton')?.addEventListener('click', async () => {
  const v = dvLecteur()
  if (!v || !v.src) return

  /* Tout est découpé : le bouton recommence. On demande confirmation — c'est
     tout le travail qui disparaît, textes déjà écrits compris. */
  /* La confirmation « Recommencer le découpage ? » a été retirée avec le bouton
     qui l'appelait. */
    

  /* Rien n'est encore commencé : ce premier appui lance la vidéo. */
  if (v.paused && !videoSteps.length && v.currentTime < 0.3) {
    dvDebutEnCours = 0
    v.play().catch(() => {})
    dvMajGeste()
    return
  }

  /* À L'ARRÊT, LE BOUTON COUPE QUAND MÊME.

     Avant, en pause il relançait la lecture ET remplaçait le début de l'étape
     en cours par la position courante : le découpage repartait de zéro sans
     rien dire. Depuis qu'il existe un vrai bouton pause, ce n'est plus à lui
     de relancer — chaque bouton fait UNE chose. */
  if (v.currentTime - dvDebutEnCours < 0.5) {
    /* Trop court pour être une étape. On le DIT, au lieu de ne rien faire : un
       bouton qui reste muet donne l'impression d'être cassé, et c'est
       exactement ce qu'on ressentait. */
    const aide = document.getElementById('dv-aide')
    if (aide && !aide.dataset.avant) {
      aide.dataset.avant = aide.textContent
      aide.textContent = 'Une \u00e9tape doit durer au moins une seconde.'
      setTimeout(() => {
        if (aide.dataset.avant) { aide.textContent = aide.dataset.avant; delete aide.dataset.avant }
      }, 2200)
    }
    if (navigator.vibrate) navigator.vibrate([8, 40, 8])
    return
  }

  videoSteps.push({
    texte: '',
    timestamp_video: dvDebutEnCours,
    fin_video: v.currentTime,
  })
  dvDebutEnCours = v.currentTime
  dvSelection = videoSteps.length - 1
  dvMajGeste(); renderVideoSteps(); dvMajFrise()
  if (navigator.vibrate) navigator.vibrate(10)
})

/* La frise et le chronomètre suivent la lecture. On écrit directement dans le
   texte plutôt que de redessiner la liste à chaque image : soixante rendus par
   seconde feraient perdre le curseur de saisie. */
dvLecteur()?.addEventListener('timeupdate', () => {
  dvMajFrise()
  /* La fenêtre suit la tête : zoomée cinq fois, celle-ci sortirait de l'écran
     au bout de vingt secondes et on découperait à l'aveugle. */
  dvSuivreTete()
  const ch = document.getElementById('dv-chrono')
  const v = dvLecteur()
  if (ch && v) ch.textContent = `depuis ${dvFmt(dvDebutEnCours)} \u00b7 ${Math.round(v.currentTime - dvDebutEnCours)} s`
  else if (v && !v.paused && v.currentTime - dvDebutEnCours > 0.3) renderVideoSteps()
})

dvLecteur()?.addEventListener('pause', () => { dvMajGeste(); renderVideoSteps() })
dvLecteur()?.addEventListener('play', dvMajGeste)




function renderVideoSteps(listEl) {
  const el = document.getElementById('video-steps-list')
  if (!el) return
  el.innerHTML = ''

  videoSteps.forEach((step, i) => {
    const div = document.createElement('div')
    /* Le même fil qu'à la création manuelle : numéro dessiné, trait, extrait
       monté sur l'étape. La vignette prend la place de la photo. */
    div.className = 'step-edit-item etape-montage' + (i === dvSelection ? ' sel' : '')
    div.innerHTML = `
      <span class="step-num-dess">${numeroEtapeDess(i + 1)}</span>
      <textarea rows="1" placeholder="D\u00e9crire cette \u00e9tape\u2026">${escapeHtml(step.texte || '')}</textarea>
      <!-- ═══ LE POINT DE VIGILANCE, VISIBLE ET MODIFIABLE ═══

           Il n'apparaissait nulle part sur cet écran. On modifiait une
           procédure vidéo, on enregistrait, et l'avertissement rédigé par l'IA
           disparaissait — sans erreur, sans message.

           Le champ n'est affiché QUE s'il y a quelque chose dedans : ajouter
           une seconde zone de saisie vide à chacune des vingt étapes doublerait
           la hauteur de l'écran pour un cas qui concerne deux ou trois d'entre
           elles. Ce qui existe se voit et se corrige ; ce qui n'existe pas ne
           s'invente pas ici. -->
      ${step.attention ? `<textarea class="et-attention-saisie" rows="1"
          placeholder="Point de vigilance\u2026">${escapeHtml(step.attention)}</textarea>` : ''}
      <div class="step-bas">
        <!-- La vignette du premier plan a été retirée. Posée à côté du texte, elle
             lui laissait moins d'un tiers de la largeur : « Entrer la transaction »
             s'écrivait sur huit lignes. Et elle n'apprenait rien — une image fixe de
             la première demi-seconde ne dit pas ce que l'étape contient. La durée,
             elle, suffit à se repérer, et le bouton la rejoue. -->
        <span class="badge extrait">\u25b6 ${dvFmt(step.timestamp_video)}\u2013${dvFmt(step.fin_video)}</span>
        <button type="button" class="sup del" aria-label="Supprimer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
        </button>
      </div>`


    /* La saisie du point de vigilance, quand elle existe. Vidée, elle rend le
       champ à `null` : c'est le seul moyen de retirer un avertissement, et il
       est plus naturel qu'un bouton de suppression. */
    const av = div.querySelector('.et-attention-saisie')
    if (av) {
      av.addEventListener('input', (e) => {
        step.attention = e.target.value.trim() || null
        autoResizeTextarea(e.target)
      })
      requestAnimationFrame(() => autoResizeTextarea(av))
    }

    const ta = div.querySelector('textarea')
    ta.addEventListener('input', (e) => {
      videoSteps[i].texte = e.target.value; majBoutonIA()
    /* Même correctif que les deux autres fils : le champ s'ajuste à l'affichage,
       pas seulement à la saisie. Les textes écrits par l'IA s'ouvraient coupés
       à la première ligne. */
    requestAnimationFrame(() => autoResizeTextarea(textarea))
      autoResizeTextarea(e.target)
    })
    ta.addEventListener('focus', () => { dvSelection = i; dvMajFrise() })
    setTimeout(() => autoResizeTextarea(ta), 0)

    div.querySelector('.sup').addEventListener('click', (e) => {
      e.stopPropagation()
      demanderSuppressionEtape(i + 1, videoSteps[i].texte, () => {
        videoSteps.splice(i, 1)
        dvSelection = null
        renderVideoSteps(); dvMajFrise(); dvMajGeste()
      })
    })

    div.addEventListener('click', (e) => {
      if (e.target.closest('textarea') || e.target.closest('.sup')) return
      dvSelection = i
      const v = dvLecteur()
      if (v) v.currentTime = step.timestamp_video
      renderVideoSteps(); dvMajFrise()
    })

    el.appendChild(div)
  })

  /* L'\u00e9tape en train de se faire : on voit ce qu'on est en train de d\u00e9couper. */
  const v = dvLecteur()
  if (v && !v.paused && v.currentTime - dvDebutEnCours > 0.3) {
    const c = document.createElement('div')
    c.className = 'dv-encours'
    c.innerHTML = `<span class="vig"><canvas width="160" height="90"></canvas></span>
      <span>\u00c9tape ${videoSteps.length + 1} en cours\u2026
        <i id="dv-chrono">depuis ${dvFmt(dvDebutEnCours)} \u00b7 ${Math.round(v.currentTime - dvDebutEnCours)} s</i></span>`
    dvVignette(c.querySelector('canvas'), dvDebutEnCours)
    el.appendChild(c)
  }

  /* On garde le r\u00e9ordonnancement au doigt : c'est le seul geste de l'ancien
     \u00e9diteur qui servait vraiment. */
  activerGlissementEtapes(el, () => videoSteps, () => {
    dvSelection = null
    renderVideoSteps(); dvMajFrise()
  })
  majBoutonIA()
}


function marquerEtapeEnLecture(el) {
  document.querySelectorAll('.detail-step.en-lecture').forEach(x => x.classList.remove('en-lecture'))
  if (el) el.classList.add('en-lecture')
}

/* Suit la vidéo pendant qu'elle joue et déplace la marque toute seule : quelqu'un
   qui lance l'extrait 3 et laisse tourner voit la marque passer à 4, puis à 5.
   C'est ce qui fait la différence entre un repère et une simple sélection. */
let suiviLecture = null

function attacherSuiviLecture(videoEl, liste) {
  detacherSuiviLecture(videoEl)
  if (!videoEl || !liste) return

  const suivre = () => {
    const t = videoEl.currentTime
    let trouvee = null
    liste.querySelectorAll('.detail-step[data-debut]').forEach(el => {
      const d = parseFloat(el.dataset.debut), f = parseFloat(el.dataset.fin)
      if (t >= d && t < f) trouvee = el
    })
    if (trouvee && !trouvee.classList.contains('en-lecture')) marquerEtapeEnLecture(trouvee)
  }

  suiviLecture = { videoEl, suivre }
  videoEl.addEventListener('timeupdate', suivre)
  // La marque reste à l'arrêt : on vient de regarder cette étape-là.
  videoEl.addEventListener('pause', suivre)
}

function detacherSuiviLecture(videoEl) {
  if (suiviLecture) {
    suiviLecture.videoEl.removeEventListener('timeupdate', suiviLecture.suivre)
    suiviLecture.videoEl.removeEventListener('pause', suiviLecture.suivre)
    suiviLecture = null
  }
  document.querySelectorAll('.detail-step.en-lecture').forEach(x => x.classList.remove('en-lecture'))
}

function lireExtrait(videoEl, debut, fin) {
  if (!videoEl) return
  if (videoEl.__stopExtrait) {
    videoEl.removeEventListener('timeupdate', videoEl.__stopExtrait)
    videoEl.__stopExtrait = null
  }
  videoEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
  videoEl.currentTime = debut
  const stop = () => {
    if (videoEl.currentTime >= fin - 0.05) {
      videoEl.pause()
      videoEl.removeEventListener('timeupdate', stop)
      videoEl.__stopExtrait = null
    }
  }
  videoEl.__stopExtrait = stop
  videoEl.addEventListener('timeupdate', stop)
  const p = videoEl.play()
  if (p && p.catch) p.catch(() => {})
}

function formatTime(sec) {
  const m = Math.floor(sec / 60); const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Insertion des étapes. Si la colonne `fin_video` n'existe pas encore en base,
// on réessaie sans elle : l'app continue de fonctionner (fin déduite comme avant).
async function insertEtapes(rows) {
  let res = await supabase.from('etapes').insert(rows)
  // Replis successifs si la base n'a pas encore les colonnes ajoutées.
  if (res.error && /image_url/i.test(res.error.message || '')) {
    console.warn("Colonne image_url absente en base — insertion sans les photos.")
    res = await supabase.from('etapes').insert(rows.map(({ image_url, ...reste }) => reste))
  }
  if (res.error && /fin_video/i.test(res.error.message || '')) {
    console.warn("Colonne fin_video absente en base — insertion sans la fin de clip.")
    const sansFin = rows.map(({ fin_video, image_url, ...reste }) => reste)
    return await supabase.from('etapes').insert(sansFin)
  }
  return res
}

/* Le titre et la dossier sont saisis sur l'écran des étapes ; l'écran précédent
   les propose aussi, pour qui les remplit avant de choisir son mode. On prend
   celui qui est rempli, en donnant la priorité à la page où l'on se trouve. */
function champManuel(quoi) {
  /* Trois pages peuvent porter ces champs : l'écran de choix, celui des étapes
     manuelles et celui du découpage vidéo. On prend le premier qui est rempli,
     en commençant par l'écran affiché. */
  /* `dv-` s'ajoute pour la modification d'une procédure vidéo : sans lui, la
     publication reprenait le titre de l'écran de création, resté vide. */
  const ordre = ['dv-', 'man-', 'new-'].map(pre => document.getElementById(pre + quoi))
  const visible = ordre.find(e => e && e.offsetParent !== null && e.value.trim())
  if (visible) return visible
  return ordre.find(e => e && e.value.trim()) || ordre.find(Boolean)
}

async function publishProcedure(errorElId, btnId) {
  const errorEl = document.getElementById(errorElId)
  errorEl.textContent = ''
  const titre = champManuel('titre').value.trim()
  const categorie = champManuel('categorie').value.trim()
  /* ═══ PAR `champManuel`, PAS PAR UN IDENTIFIANT EN DUR ═══

     Trois écrans appellent cette fonction — création, étapes manuelles,
     montage vidéo — et chacun a ses propres champs. `champManuel` prend celui
     de l'écran affiché ; écrire `new-sous-categorie` en dur aurait enregistré
     le sous-dossier de la page de création alors qu'on publie depuis le
     montage. C'est le défaut que son propre commentaire décrit pour le titre.

     Le `?.` est nécessaire : `champManuel` peut ne rien rendre si aucun des
     trois champs n'est rempli, ce qui est le cas normal pour un champ
     facultatif. */
  const sousCategorie = (champManuel('sous-categorie')?.value || '').trim() || null
  const categorieIcone = '📁'
  const allSteps = [...manualSteps, ...videoSteps]

  if (!titre) { errorEl.textContent = 'Le titre est obligatoire.'; return }
  if (allSteps.length === 0) { errorEl.textContent = 'Ajoutez au moins une étape (manuelle ou vidéo).'; return }
  if (allSteps.some(s => !s.texte.trim())) { errorEl.textContent = 'Chaque étape doit avoir un texte.'; return }

  const publishBtn = document.getElementById(btnId)
  setButtonLoading(publishBtn, true)

  let videoUrl = null
  if (currentVideoFile) {
    const path = `${currentMembre.entreprise_id}/${Date.now()}_${currentVideoFile.name}`
    const { error: uploadError } = await supabase.storage.from('procedo-videos').upload(path, currentVideoFile, { cacheControl: CACHE_LONG })
    if (uploadError) {
      errorEl.textContent = "Erreur d'upload vidéo : " + uploadError.message
      setButtonLoading(publishBtn, false)
      return
    }
    videoUrl = path
  }

  /* En modification, on met à jour la ligne existante au lieu d'en créer une
     nouvelle. Le reste du parcours — photos, étapes, couverture — est le même :
     c'est ce qui permet à une seule page de servir aux deux. */
  const enCours = manEdition || dvEdition
  const { data: newProc, error: procError } = enCours
    ? await supabase.from('procedures')
        .update({ titre, categorie, sous_categorie: sousCategorie, categorie_icone: categorieIcone })
        .eq('id', enCours).select().single()
    : await supabase.from('procedures')
        .insert({ entreprise_id: currentMembre.entreprise_id, titre, categorie,
                  sous_categorie: sousCategorie, categorie_icone: categorieIcone,
                  video_url: videoUrl, created_by: currentMembre.id })
        .select().single()

  /* Les anciennes étapes sont remplacées : c'est plus sûr que de rapprocher
     ligne à ligne, et l'ordre reste celui de l'écran. */
  if (enCours && !procError) {
    await supabase.from('etapes').delete().eq('procedure_id', enCours)
  }

  if (procError) {
    errorEl.textContent = "Erreur : " + procError.message
    setButtonLoading(publishBtn, false)
    return
  }

  /* Les photos partent maintenant, une fois la procédure créée : on a besoin de
     son identifiant pour ranger les fichiers proprement. Une photo qui échoue
     n'empêche pas la publication — l'étape sera simplement sans image. */
  for (const s of allSteps) {
    if (!s.imageFichier) continue
    const ext = (s.imageFichier.name.split('.').pop() || 'jpg').toLowerCase()
    const chemin = `${currentMembre.entreprise_id}/${newProc.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
    const { error: envoiErr } = await supabase.storage.from('procedo-videos').upload(chemin, s.imageFichier, { cacheControl: CACHE_LONG })
    if (envoiErr) { console.warn('Photo non envoyée :', envoiErr.message); continue }
    s.image_url = chemin
  }

  /* L'image de la procédure part après sa création : on a besoin de son
     identifiant pour ranger le fichier. Si la colonne n'existe pas encore, la
     mise à jour échoue en silence et la procédure reste publiée. */
  const urlCouv = await envoyerCouverture(newProc.id)
  if (urlCouv) {
    const { error: eCouv } = await supabase.from('procedures')
      .update({ image_url: urlCouv }).eq('id', newProc.id)
    if (eCouv) console.warn('Standix \u00b7 image non enregistr\u00e9e :', eCouv.message)
  }

  const etapesToInsert = allSteps.map((s, i) => ({
    procedure_id: newProc.id, ordre: i + 1, texte: s.texte,
    /* Réécrit avec le reste : sans cette ligne, chaque enregistrement d'une
       procédure vidéo effaçait les points de vigilance. */
    attention: s.attention ?? null,
    timestamp_video: s.timestamp_video ?? null, fin_video: s.fin_video ?? null,
    image_url: s.image_url ?? null,
  }))
  const { error: etapesError } = await insertEtapes(etapesToInsert)

  setButtonLoading(publishBtn, false)

  if (etapesError) { errorEl.textContent = "Erreur étapes : " + etapesError.message; return }

  /* Après une modification, on revient sur la fiche : c'est de là qu'on venait,
     et c'est là qu'on veut vérifier le résultat. */
  const modifiait = manEdition || dvEdition
  manEdition = null
  dvEdition = null
  manualSteps = []
  videoSteps = []
  loadGestionProcedures()
  if (modifiait) { openAnalyse(modifiait); toast('Modifications enregistr\u00e9es') }
  else showGestionScreen('p-list')
}
document.getElementById('publish-btn-manual')?.addEventListener('click', () => publishProcedure('create-error-manual', 'publish-btn-manual'))
document.getElementById('publish-btn-video')?.addEventListener('click', () => publishProcedure('create-error-video', 'publish-btn-video'))

// ═══════════ GESTION : analyse ═══════════
let currentAnalyseData = null
/* Figé sur le total : le filtre de période a été retiré de l'écran. La constante
   reste parce que le calcul des statistiques s'en sert. */
const currentAnalysePeriod = 'all'

/* Ouvrir une procédure traverse une douzaine d'attentes : lectures en base,
   préchargement, chargement du QR. Si l'on ouvre A, qu'on revient, puis qu'on
   ouvre B, le rendu de A peut se terminer APRÈS celui de B et écraser sa liste
   d'étapes — qui apparaît alors vide ou fausse. C'est ça, « les étapes ne
   s'affichent pas tout le temps » : ce n'est pas le chargement qui échoue, c'est
   un rendu périmé qui arrive en dernier.

   Chaque ouverture reçoit donc un numéro. Avant d'écrire quoi que ce soit à
   l'écran, on vérifie qu'on est toujours la dernière. */
let ouvertureCourante = 0

/* D'OÙ L'ON VENAIT.

   La suppression renvoyait toujours à `p-list`, puis cherchait la carte de la
   procédure pour la replier. Or cette carte vit sur `p-category` — on la
   cherchait donc là où elle n'est pas, et l'animation ne jouait jamais quand on
   supprimait depuis une dossier. La procédure disparaissait d'un coup, entre
   deux images, et on doutait d'avoir supprimé la bonne.

   On retient l'écran d'où l'on ouvre : c'est là qu'on retournera. */
let retourApresAnalyse = 'p-list'

async function openAnalyse(procId) {
  const monTour = ++ouvertureCourante
  const perime = () => monTour !== ouvertureCourante
  const depuis = document.querySelector('#gestion-app .screen.active')?.id
  if (depuis && depuis !== 'p-analyse') retourApresAnalyse = depuis
  showGestionScreen('p-analyse')

  /* La coche verte ne sert qu'à annoncer « ton analyse est prête ». Une fois la
     procédure ouverte, le message a été reçu : on efface le statut, en base
     pour que ce soit vrai sur tous les appareils. */
  const enAttente = allGestionProcedures.find(p => p.id === procId && p.statut === 'pret')
  if (enAttente) {
    enAttente.statut = null
    /* ═══ ON RETIENT, MÊME SI LA BASE REFUSE ═══

       `allGestionProcedures` est réécrit toutes les quinze secondes par
       `surveillerAnalyses`. Effacer le statut dans cet objet ne survit donc pas
       au prochain rechargement : si l'écriture en base échoue, la coche revient
       toute seule. Cette liste-ci, elle, tient jusqu'à la fermeture. */
    proceduresVues.add(procId)

    /* L'ÉCHEC NE SE TAIT PLUS. C'était `.then(() => {}, () => {})` : deux
       fonctions vides qui avalaient tout. Une règle d'accès trop stricte, une
       colonne `statut` déclarée `not null` — n'importe laquelle de ces causes
       faisait échouer l'écriture en silence, et personne ne pouvait le savoir.

       Si tu vois ce message dans la console, envoie-le-moi : il nomme la
       cause, et elle se corrige en base plutôt qu'ici. */
    supabase.from('procedures').update({ statut: null }).eq('id', procId)
      .then(({ error }) => {
        if (error) console.warn('[coche] statut non effac\u00e9 en base :', error.message)
      }, (e) => console.warn('[coche] \u00e9criture impossible :', e?.message || e))

    renderCategoryGrid()
    if (document.getElementById('p-category')?.classList.contains('active')) renderCategoryProceduresList()
  }

  if (preloadEtapes) await preloadEtapes

  // On utilise en priorité les données déjà préchargées (instantané) ;
  // si jamais elles manquent (cas rare), on retombe sur une requête fraîche.
  let proc = allGestionProcedures.find(p => p.id === procId)
  if (proc?.image_url) reinitialiserCouverture(proc.image_url)
  /* ═══ LE BANDEAU DE PUBLICATION SE PEINT ICI ═══

     Il était branché sur `openEditProcedure` — une fonction que RIEN N'APPELLE.
     C'est `openAnalyse` qui sert de page de détail : le bandeau ne s'affichait
     donc jamais, et toutes les procédures restaient en brouillon sans moyen de
     les publier.

     On peint dès qu'on a la procédure en cache, puis de nouveau plus bas si
     elle vient de la base — sinon l'écran reste vide le temps de la requête. */
  peindrePublication(proc)
  let etapes = cachedEtapesByProc[procId]
  let employes = cachedEmployes
  let validations = cachedValidations.filter(v => v.procedure_id === procId)

  if (!proc) {
    document.getElementById('analyse-titre').textContent = '...'
    document.getElementById('analyse-subhead').textContent = 'Chargement...'
    const res = await supabase.from('procedures').select('*').eq('id', procId).single()
    proc = res.data
    /* La procédure vient d'arriver : on repeint avec sa vraie valeur. */
    peindrePublication(proc)
  }
  /* Le cache pouvait contenir un tableau VIDE — préchargé à un moment où la
     procédure n'avait pas encore d'étapes : analyse terminée depuis, étapes
     ajoutées depuis, procédure créée depuis. Or un tableau vide est vrai en
     JavaScript, donc on ne redemandait jamais rien et la liste restait vide.
     C'est ça, les étapes qui ne s'affichent « pas tout le temps ». */
  if (!etapes || etapes.length === 0) {
    const res = await supabase.from('etapes').select('*').eq('procedure_id', procId).order('ordre')
    etapes = res.data || []
    cachedEtapesByProc[procId] = etapes
  }

  if (perime()) return          // une autre procédure a été ouverte entre-temps

  currentAnalyseData = { proc, etapes: etapes || [], employes: employes || [], validations: validations || [] }

  /* Une procédure sans vidéo se modifie sur la page des étapes manuelles — la
     même qui a servi à l'écrire. Celles qui ont une vidéo gardent leur éditeur :
     régler des bornes au dixième de seconde demande un autre outil. */
  /* Une procédure se modifie là où elle a été écrite : le montage si elle a une
     vidéo, le fil des étapes sinon. Plus d'éditeur à part. */
  document.getElementById('analyse-edit-btn').onclick = () => {
    if (proc.video_url) ouvrirMontageVideo(procId)
    else ouvrirEtapesManuelles(procId)
  }
  document.getElementById('analyse-delete-btn').onclick = async () => {
    const confirmed = await confirmDialog({
      titre: 'Supprimer définitivement ?',
      message: `« ${proc.titre} » et toutes ses étapes seront supprimées. Cette action est irréversible.`,
      confirmer: 'Supprimer',
      annuler: 'Annuler',
    })
    if (!confirmed) return
    const deleteBtn = document.getElementById('analyse-delete-btn')
    setButtonLoading(deleteBtn, true)
    const { error } = await supabase.from('procedures').delete().eq('id', procId)
    setButtonLoading(deleteBtn, false)
    if (error) {
      await confirmDialog({
        titre: 'Suppression impossible',
        message: error.message,
        confirmer: 'Fermer',
        annuler: 'Réessayer',
        danger: false,
      })
      return
    }
    /* On revient à l'écran d'où l'on venait — la dossier, ou la liste — puis
       on replie la carte : la personne voit la procédure qu'elle vient de
       supprimer s'en aller. La ligne est déjà effacée en base, l'animation ne
       fait que raconter ce qui s'est passé. */
    showGestionScreen(retourApresAnalyse)
    const carte = carteDeProcedure(procId)
    if (carte) await replierCarte(carte)

    /* La dossier se vide-t-elle ? Si cette procédure était la dernière, sa
       dossier va disparaître du prochain dessin. On la fait partir DEVANT les
       yeux plutôt qu'entre deux images — sinon on doute d'avoir supprimé la
       bonne chose. */
    const cat = proc?.categorie
    const restantes = allGestionProcedures.filter(
      x => x.id !== procId && x.categorie === cat).length
    if (cat && restantes === 0) {
      const cellule = document.querySelector(`.cat-cell[data-key="${CSS.escape(cat)}"]`)
      if (cellule) {
        await new Promise(r => faireDisparaitre(cellule, r))
        oublierCle('renderCategoryGrid', cat)
      }
    }

    allGestionProcedures = allGestionProcedures.filter(x => x.id !== procId)
    loadGestionProcedures()
  }

  document.getElementById('analyse-titre').textContent = proc.titre
  /* ═══ LE CHEMIN COMPLET SOUS LE TITRE ═══

     « Cuisine › Friteuse › créée le 12 mars ». Le chevron sépare les niveaux
     comme dans un explorateur de fichiers ; le point médian sépare le
     rangement de la date, qui n'en fait pas partie.

     Sans sous-dossier, la ligne est celle d'avant, au caractère près. */
  const cheminProc = [proc.categorie || 'Sans dossier', proc.sous_categorie]
    .filter(Boolean).join(' \u203a ')
  document.getElementById('analyse-subhead').textContent =
    `${cheminProc} · créée le ${new Date(proc.created_at).toLocaleDateString('fr-FR')}`

  renderAnalyseStats()

  // Vidéo (si disponible)
  const videoFrame = document.getElementById('analyse-video-frame')
  const videoEl = document.getElementById('analyse-video')
  /* L'image de la procédure, en tête de la fiche. Elle ne remplace pas la vidéo :
     une procédure peut avoir les deux, et la vidéo vient dessous. */
  const couvEl = document.getElementById('analyse-couverture')
  if (couvEl) {
    couvEl.innerHTML = proc.image_url ? `<img data-fichier="${escapeHtml(cheminFichier(proc.image_url))}" alt="">` : ''
    couvEl.style.display = proc.image_url ? 'flex' : 'none'
    signerMedias(couvEl)
  }

  if (proc.video_url) {
    videoFrame.style.display = 'block'
    videoEl.src = (await urlSignee(proc.video_url)) || ''
  } else {
    videoFrame.style.display = 'none'
  }

  // Étapes : texte, et pour les étapes issues d'une vidéo, un vrai clip borné (début → fin de l'étape)
  const stepsListEl = document.getElementById('analyse-steps-list')
  stepsListEl.innerHTML = ''
  /* Le même fil qu'à la création : le gérant voit sa procédure sous la forme où
     il l'a écrite, et sous celle où son équipe la lira. Trois formes pour la
     même chose en étaient deux de trop. */
  stepsListEl.classList.add('etapes-fil')
  detacherSuiviLecture(videoEl)
  if (currentAnalyseData.etapes.length === 0) {
    stepsListEl.innerHTML = '<div class="note">Aucune étape pour le moment.</div>'
  } else {
    const clipBounds = calculerBornes(currentAnalyseData.etapes, videoEl?.duration)

    currentAnalyseData.etapes.forEach((etape, i) => {
      const div = document.createElement('div')
      div.className = 'detail-step'
      const bounds = clipBounds.get(etape.id)
      const hasClip = bounds && proc.video_url
      div.innerHTML = `
        <span class="step-num-dess">${numeroEtapeDess(i + 1)}</span>
        <div class="et-co">
          <p>${escapeHtml(etape.texte)}</p>
          ${etape.attention ? `<div class="et-attention">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.2 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.2a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17"/></svg>
            <span>${escapeHtml(etape.attention)}</span>
          </div>` : ''}
          ${hasClip ? `<span class="badge extrait" style="cursor:pointer;">\u25b6 ${formatTime(bounds.start)}\u2013${formatTime(bounds.end)}</span>` : ''}
          ${etape.image_url ? `<div class="detail-step-img"><img data-fichier="${escapeHtml(cheminFichier(etape.image_url))}" alt="" loading="lazy"></div>` : ''}
        </div>
      `
      /* Le contour bleu vaut pour TOUTES les étapes, avec ou sans vidéo : c'est
         un repère de lecture, pas une commande de lecteur. Quelqu'un qui suit une
         procédure écrite en a autant besoin — il doit retrouver où il en était
         après avoir levé les yeux sur son plan de travail. */
      div.style.cursor = 'pointer'
      if (hasClip) {
        div.dataset.debut = bounds.start
        div.dataset.fin = bounds.end
      }
      div.onclick = () => {
        marquerEtapeEnLecture(div)
        if (hasClip) lireExtrait(videoEl, bounds.start, bounds.end)
      }
      stepsListEl.appendChild(div)
    })
  signerMedias(stepsListEl)
  }

  attacherSuiviLecture(videoEl, stepsListEl)

  const qrContainer = document.getElementById('qr-container')
  qrContainer.innerHTML = '<div style="font-size:11px; color:rgba(20,21,24,0.45);">Génération...</div>'
  document.getElementById('qr-plaque-title').textContent = proc.titre
  /* ═══ LE QR NE PORTE PLUS DE CODE ═══

     Il embarquait le code permanent de l'entreprise, pour qu'une personne qui
     scanne sans compte puisse s'inscrire dans la foulée.

     ⚠ AVEC UN CODE TEMPORAIRE, C'EST IMPOSSIBLE. Un QR imprimé et collé au mur
       porterait un code mort au bout de deux heures — et il faudrait réimprimer
       toutes les affiches à chaque nouveau code.

     Le QR mène donc à la procédure seule. Une personne sans compte arrive sur
     l'écran d'inscription et saisit le code que son responsable lui donne — ce
     qui est aussi plus sûr : un code au mur est un code public. */
  const codeEnt = ''
  const scanUrl = `${window.location.origin}${window.location.pathname}?proc=${procId}` +
    (codeEnt ? `&e=${codeEnt}` : '')
  /* Le dessin du QR passe par deux attentes. Si l'on ouvre une procédure puis
     une autre rapidement, celui de la première peut se terminer APRÈS celui de
     la seconde et prendre sa place : l'écran affiche alors le titre de B et le
     QR de A. C'est exactement ça, un QR qui mène à une autre procédure.
     On marque donc la procédure en cours de dessin, et on jette le résultat
     s'il arrive alors qu'on regarde déjà autre chose. */
  qrContainer.dataset.pour = procId
  const QRCodeLib = await ensureQRCode()
  if (qrContainer.dataset.pour !== procId) return
  const canvas = document.createElement('canvas')
  await QRCodeLib.toCanvas(canvas, scanUrl, { width: 344, margin: 1, color: { dark: '#0C0D0E', light: '#FFFFFF' } })
  if (qrContainer.dataset.pour !== procId) return
  qrContainer.innerHTML = ''
  qrContainer.appendChild(canvas)

  document.getElementById('qr-download-btn').onclick = async () => {
    const filename = `${proc.titre.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}-qr.png`
    // On n'exporte pas le QR nu mais la fiche entière : titre, consigne et
    // logo. Un carré noir et blanc collé sur un mur sans rien autour ne dit
    // à personne ce qu'il ouvre.
    const dataUrl = composerFicheQR(canvas, proc.titre)
    // Sur mobile (surtout iPhone), le téléchargement direct ne marche pas toujours :
    // on propose d'abord le partage natif (qui permet "Enregistrer l'image"), sinon on retombe sur le téléchargement classique.
    try {
      const blob = await (await fetch(dataUrl)).blob()
      const file = new File([blob], filename, { type: 'image/png' })
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: proc.titre })
        return
      }
    } catch (e) { /* on retombe sur le téléchargement classique ci-dessous */ }

    const link = document.createElement('a')
    link.download = filename
    link.href = dataUrl
    link.click()
  }
}

/* Le tracé de l'ancien « P », dessiné point par point, a été retiré : plus
   personne ne l'appelait depuis que la fiche imprimable emploie la vraie image
   du logo. C'était le dernier endroit où l'ancienne marque survivait. */

/* Dessine la fiche à imprimer : plaque blanche, QR, titre de la procédure,
   consigne de scan et signature Standix avec son logo. Rendue en haute définition pour
   rester nette une fois imprimée. */
function composerFicheQR(qrCanvas, titre) {
  const L = 760, cote = 470
  const marge = 62
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')

  // Mise en page calculée d'abord, pour ajuster la hauteur au titre
  ctx.font = '700 34px Inter, -apple-system, system-ui, sans-serif'
  const lignes = decouperTexte(ctx, titre || '', L - marge * 2)
  const hauteurTitre = lignes.length * 44
  const H = marge + cote + 40 + hauteurTitre + 30 + 34 + 44 + marge

  c.width = L
  c.height = H
  const g = c.getContext('2d')

  // Plaque
  g.fillStyle = '#FFFFFF'
  cheminArrondi(g, 0, 0, L, H, 44)
  g.fill()

  // QR centré
  const x = (L - cote) / 2
  g.imageSmoothingEnabled = false
  g.drawImage(qrCanvas, x, marge, cote, cote)

  // Coins de visée, comme à l'écran
  g.strokeStyle = 'rgba(20,21,24,0.22)'
  g.lineWidth = 6
  g.lineCap = 'round'
  const b = 40, e = 20
  ;[[x - e, marge - e, 1, 1], [x + cote + e, marge - e, -1, 1],
    [x - e, marge + cote + e, 1, -1], [x + cote + e, marge + cote + e, -1, -1]]
    .forEach(([px, py, sx, sy]) => {
      g.beginPath()
      g.moveTo(px, py + sy * b); g.lineTo(px, py); g.lineTo(px + sx * b, py)
      g.stroke()
    })

  // Titre
  let y = marge + cote + 40 + 30
  g.fillStyle = '#0C0D0E'
  g.font = '700 34px Inter, -apple-system, system-ui, sans-serif'
  g.textAlign = 'center'
  lignes.forEach(ligne => { g.fillText(ligne, L / 2, y); y += 44 })

  // Consigne
  g.fillStyle = 'rgba(20,21,24,0.45)'
  g.font = '500 24px Inter, -apple-system, system-ui, sans-serif'
  g.fillText('Scannez pour ouvrir la procédure', L / 2, y + 6)

  // Filet et signature
  y += 44
  g.strokeStyle = 'rgba(20,21,24,0.10)'
  g.lineWidth = 2
  g.beginPath(); g.moveTo(marge, y); g.lineTo(L - marge, y); g.stroke()

  /* ═══ LE LOGO ET LE NOM, EN NOIR ═══

     Deux corrections. Le logo était le TRACÉ de l'ancien « P », dessiné point
     par point — il ne pouvait donc pas suivre le changement d'image. On emploie
     maintenant la vraie image, celle qui est dans la page.

     Et le tout passe en noir franc plutôt qu'en gris à 40 % : cette fiche est
     faite pour être IMPRIMÉE et collée au mur. Un gris pâle sur du papier, vu
     de deux mètres dans une cuisine, ne se lit pas. */
  const NOIR = '#14151A'
  g.fillStyle = NOIR
  g.font = '500 24px Poppins, Inter, -apple-system, system-ui, sans-serif'
  const nom = 'Standix'
  const largeurNom = g.measureText(nom).width
  const hLogo = 26
  const lLogo = hLogo * 0.706          // le rapport du nouveau dessin
  const espace = 9
  const totalL = lLogo + espace + largeurNom
  const xDepart = (L - totalL) / 2
  const yBase = y + 32

  const img = document.getElementById('logo-src')
  if (img && img.complete && img.naturalWidth) {
    g.drawImage(img, xDepart, yBase - hLogo + 3, lLogo, hLogo)
  }

  g.textAlign = 'left'
  g.fillText(nom, xDepart + lLogo + espace, yBase)
  g.textAlign = 'center'

  return c.toDataURL('image/png')
}

function decouperTexte(ctx, texte, largeurMax) {
  const mots = String(texte).split(/\s+/).filter(Boolean)
  const lignes = []
  let courante = ''
  mots.forEach(mot => {
    const essai = courante ? courante + ' ' + mot : mot
    if (ctx.measureText(essai).width > largeurMax && courante) {
      lignes.push(courante); courante = mot
    } else courante = essai
  })
  if (courante) lignes.push(courante)
  return lignes.slice(0, 3)
}

function cheminArrondi(ctx, x, y, l, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + l, y, x + l, y + h, r)
  ctx.arcTo(x + l, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + l, y, r)
  ctx.closePath()
}

function renderAnalyseStats() {
  if (!currentAnalyseData) return
  const { employes, validations } = currentAnalyseData

  const now = new Date()
  let periodStart = null
  if (currentAnalysePeriod === 'week') {
    periodStart = new Date(now)
    const day = (periodStart.getDay() + 6) % 7 // lundi = 0
    periodStart.setDate(periodStart.getDate() - day)
    periodStart.setHours(0, 0, 0, 0)
  } else if (currentAnalysePeriod === 'month') {
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
  }

  const validationsInPeriod = periodStart
    ? validations.filter(v => new Date(v.validated_at) >= periodStart)
    : validations

  const nbEmployes = employes.length
  const nbConsulte = validationsInPeriod.length
  const taux = nbEmployes > 0 ? Math.round((nbConsulte / nbEmployes) * 100) : 0
  const periodLabel = currentAnalysePeriod === 'week' ? 'cette semaine' : currentAnalysePeriod === 'month' ? 'ce mois-ci' : 'au total'


  const empListEl = document.getElementById('analyse-emp-list')
  empListEl.innerHTML = ''

  if (nbEmployes === 0) {
    empListEl.innerHTML = "<div class=\"an-vide\">Aucun employ\u00e9 dans l'entreprise pour le moment. " +
      "Partagez le code d'invitation dans Param\u00e8tres.</div>"
    return
  }

  /* La roue avant la liste. Un pourcentage se lit en un dixième de seconde ;
     compter les coches vertes d'une liste de quinze demande un effort. */
  const vus = employes.filter(e => validations.some(v => v.membre_id === e.id)).length
  const pct = Math.round((vus / nbEmployes) * 100)
  const couleur = pct >= 80 ? 'var(--green)' : pct >= 40 ? 'var(--orange)' : 'var(--red)'

  /* `ga-anneau` n'est pas décoratif : c'est cette classe qui fait pivoter le
     tracé d'un quart de tour et centre le pourcentage dedans. Sans elle, l'arc
     part de trois heures et le texte tombe sous la carte. */
  const tete = document.createElement('div')
  tete.className = 'emp-roue'
  tete.innerHTML = `
    <div class="ga-anneau" id="emp-anneau"></div>
    <div class="tx">
      <div class="t">${vus} sur ${nbEmployes} ${vus > 1 ? 'ont' : 'a'} vu cette proc\u00e9dure</div>
      <div class="s">${pct === 100
        ? "Toute l'\u00e9quipe l'a ouverte au moins une fois."
        : `Il reste <b>${nbEmployes - vus} personne${nbEmployes - vus > 1 ? 's' : ''}</b> \u00e0 relancer.`}</div>
    </div>`
  empListEl.appendChild(tete)
  dessinerAnneau('emp-anneau', pct, couleur, pct + '%')

  /* Ceux qui n'ont pas lu passent devant : c'est eux qui demandent une action. */
  const ordre = [...employes].sort((a, b) => {
    const av = validations.some(v => v.membre_id === a.id)
    const bv = validations.some(v => v.membre_id === b.id)
    return av - bv
  })

  const liste = document.createElement('div')
  liste.className = 'emp-liste'
  liste.innerHTML = ordre.map(e => {
    const v = validations.find(x => x.membre_id === e.id)
    const quand = v ? ilYA(new Date(v.validated_at)) : null
    return `
      <div class="an-lig">
        <span class="pt" style="background:${v ? 'var(--green)' : 'var(--red)'}"></span>
        <span class="co">
          <span class="nm">${escapeHtml(e.nom || 'Membre')}</span>
          <span class="st">${e.poste ? escapeHtml(e.poste) : 'Poste non d\u00e9fini'}</span>
        </span>
        <span class="vl" style="${v ? '' : 'color:var(--red);'}">${v ? quand : 'jamais'}</span>
      </div>`
  }).join('')
  empListEl.appendChild(liste)
}

// ═══════════ ÉQUIPE : liste ═══════════
/* Tant qu'une procédure est en traitement, on redemande la liste toutes les
   quinze secondes : c'est ce qui fait passer la roue à la coche sans que le
   gérant ait à recharger quoi que ce soit. La surveillance s'arrête d'elle-même
   quand plus rien n'est en cours. */
let surveillanceAnalyses = null

let rechargerApresAnalyse = false

function surveillerAnalyses() {
  // Inutile d'interroger indéfiniment une analyse qui n'avance plus : elle est
  // signalée à l'écran, c'est au gérant de la relancer.
  const enCours = allGestionProcedures.some(p =>
    (p.statut === 'traitement' || p.statut === 'redaction') && !analyseBloquee(p))
  if (!enCours) {
    if (surveillanceAnalyses) { clearInterval(surveillanceAnalyses); surveillanceAnalyses = null }
    return
  }
  if (surveillanceAnalyses) return
  surveillanceAnalyses = setInterval(async () => {
    if (document.hidden || !currentMembre) return

    /* On lit TOUS les états, sans filtre. Le filtre précédent ne demandait que
       « traitement » et « prêt » : une procédure passée à « rédaction » n'était
       pas renvoyée, son état local restait « traitement », et la roue tournait
       indéfiniment alors que l'analyse était finie. */
    const { data } = await supabase.from('procedures')
      .select('id, statut').eq('entreprise_id', currentMembre.entreprise_id)
    let change = false
    ;(data || []).forEach(row => {
      const p = allGestionProcedures.find(x => x.id === row.id)
      if (!p || p.statut === row.statut) return
      /* Passage à « prêt » : l'analyse vient d'aboutir. La coche verte remplace
         la roue, et on le dit — le gérant a pu quitter l'écran de suivi. */
      const vientDeFinir = row.statut === 'pret' &&
        (p.statut === 'traitement' || p.statut === 'redaction')
      p.statut = row.statut
      change = true
      if (vientDeFinir) {
        toast(`\u00ab ${p.titre} \u00bb est pr\u00eate.`)
        /* ON RECHARGE DEPUIS LA BASE, on ne se contente pas de modifier l'objet
           en mémoire.

           Les listes de dossiers travaillent sur des copies filtrées : changer
           `p.statut` dans `allGestionProcedures` ne touchait pas la copie que la
           page affichait. L'état était juste en mémoire, faux à l'écran, et la
           roue tournait sur une analyse terminée depuis longtemps. */
        rechargerApresAnalyse = true
      }
    })

    /* On demande aussi à l'analyse où elle en est. C'est indispensable : c'est
       le navigateur qui constate la fin du traitement, et si le gérant a quitté
       l'écran de suivi, plus personne ne le ferait. La surveillance prend donc
       le relais, depuis n'importe quelle page de l'app. */
    for (const row of (data || []).filter(r => r.statut === 'traitement' || r.statut === 'redaction')) {
      const enMemoire = allGestionProcedures.find(x => x.id === row.id)
      if (enMemoire && analyseBloquee(enMemoire)) continue
      try {
        const rep = await fetch(`${SUPABASE_URL}/functions/v1/ai-check`, {
          method: 'POST',
          headers: await enTeteFonction(),
          body: JSON.stringify({ procedure_id: row.id }),
        })
        const etat = await rep.json()
        if (etat?.status === 'ready') {
          await supabase.from('procedures').update({ statut: 'pret' }).eq('id', row.id)
          const p = allGestionProcedures.find(x => x.id === row.id)
          if (p) { p.statut = 'pret'; change = true }
        }
      } catch (e) { /* réseau capricieux : on retentera au tour suivant */ }
    }

    if (change) {
      /* On redécide s'il faut continuer : sans ça, la boucle tournait pour
         toujours dès qu'elle avait démarré une fois. */
      const resteEnCours = allGestionProcedures.some(x =>
        (x.statut === 'traitement' || x.statut === 'redaction') && !analyseBloquee(x))
      if (!resteEnCours && surveillanceAnalyses) {
        clearInterval(surveillanceAnalyses)
        surveillanceAnalyses = null
      }
        /* On repeint TOUT ce qui peut montrer l'état d'une procédure. Ne repeindre
         que la grille laissait la roue tourner sur les autres écrans : la fiche
         ouverte, la recherche, la liste d'une dossier. L'état avait changé en
         mémoire, mais personne ne le redessinait là où on regardait. */
      /* Une analyse vient d'aboutir : on relit tout plutôt que de repeindre des
         copies périmées. C'est un aller-retour de plus, une fois par analyse —
         le prix d'un écran qui dit la vérité. */
      if (rechargerApresAnalyse) {
        rechargerApresAnalyse = false
        loadGestionProcedures().catch(() => {})
        return
      }

      renderCategoryGrid()
      const actif = (id) => document.getElementById(id)?.classList.contains('active')
      if (actif('p-category')) renderCategoryProceduresList()
      if (actif('e-list') || actif('e-category')) renderEquipeCategories()

      /* La fiche ouverte porte elle aussi l'état : si c'est celle qui vient
         d'aboutir, on la recharge pour que ses étapes apparaissent. */
      if (actif('p-analyse') && currentAnalyseData?.procedure) {
        const id = currentAnalyseData.procedure.id
        const misAJour = allGestionProcedures.find(x => x.id === id)
        if (misAJour?.statut === 'pret' && currentAnalyseData.procedure.statut !== 'pret') {
          openAnalyse(id)
        }
      }
    }
    surveillerAnalyses()
  }, 15000)
}

/* Au-delà de ce délai, une analyse encore « en traitement » n'avance
   manifestement plus : Azure a lâché, ou personne n'a constaté la fin. */
const ANALYSE_LIMITE_MIN = 25

function analyseBloquee(proc) {
  if (proc?.statut !== 'traitement') return false
  const depart = new Date(proc.created_at || 0).getTime()
  if (!depart) return false
  return (Date.now() - depart) / 60000 > ANALYSE_LIMITE_MIN
}

/* Renvoie le balisage de l'indicateur d'état d'une procédure, ou une chaîne
   vide si elle est simplement normale.
   · « traitement »          → l'IA travaille, roue qui tourne
   · « traitement » trop long → point d'exclamation orange, l'analyse a lâché
   · « pret »                → analyse finie, pas encore ouverte, coche verte
   · « echec »               → point d'exclamation rouge
   Ouvrir la procédure fait passer le statut à null : la coche disparaît. */
/* ═══ LES PROCÉDURES DÉJÀ OUVERTES ═══

   La coche disparaissait à l'ouverture, puis REVENAIT. Deux mécanismes se
   contredisaient.

   `openAnalyse` efface le statut à deux endroits : dans `allGestionProcedures`,
   pour l'affichage immédiat, et en base, pour que ce soit vrai sur les autres
   appareils. Mais l'écriture en base était posée en `.then(() => {}, () => {})`
   — un échec n'y laissait aucune trace.

   Or `surveillerAnalyses` recharge la liste depuis la base toutes les quinze
   secondes. Si l'écriture a échoué, elle rapporte `statut = 'pret'` et la coche
   revient. D'où le symptôme : elle disparaît, on navigue, elle est de retour.

   Cette liste tient la mémoire de ce qui a été ouvert PENDANT LA SESSION. Elle
   ne remplace pas l'écriture en base — qui reste la bonne source, et qui dit
   maintenant quand elle échoue — mais elle garantit qu'un rechargement ne
   ressuscite pas une coche déjà vue. */
const proceduresVues = new Set()

function etatProcedureHtml(proc) {
  const alerte = (couleur, titre) => `<div class="etat-proc souci" title="${titre}">
      <svg viewBox="0 0 24 24" fill="none" stroke="${couleur}" stroke-width="2.6" stroke-linecap="round">
        <circle cx="12" cy="12" r="9.5"/><line x1="12" y1="7.5" x2="12" y2="13"/><line x1="12" y1="16.5" x2="12" y2="16.6"/>
      </svg></div>`

  /* ═══ LE BROUILLON, AVANT TOUT LE RESTE ═══

     Une procédure non publiée le signale, quel que soit son statut d'analyse.
     Sans cette pastille, il faudrait ouvrir chaque procédure pour savoir ce
     qui est en ligne et ce qui ne l'est pas.

     ⚠ SEULE LA GESTION LA VOIT. L'équipe ne reçoit jamais de brouillon — la
       politique RLS l'en empêche — donc le test ne s'y déclenche jamais. Il
       est écrit quand même : une règle qui dépend d'un filtre distant n'est
       pas une règle. */
  if (proc && !proc.publiee_le && proc.statut !== 'traitement' && proc.statut !== 'redaction') {
    return `<span class="proc-brouillon" title="Pas encore visible par votre équipe">Brouillon</span>`
  }

  if (proc?.statut === 'echec') return alerte('#FF453A', "L'analyse a échoué — touchez pour relancer")
  if (analyseBloquee(proc)) return alerte('#FA8A08', "L'analyse semble bloquée — touchez pour relancer")

  if (proc?.statut === 'traitement' || proc?.statut === 'redaction') {
    /* La marque de l'IA, pas une roue de chargement quelconque : c'est bien
       elle qui travaille, et le même signe la désigne partout dans l'app. */
    return `<div class="etat-proc" title="Analyse en cours">
      <span class="ia-fig s"><span class="lum"></span></span>
    </div>`
  }
  if (proc?.statut === 'pret' && !proceduresVues.has(proc.id)) {
    /* La même famille que l'anneau de l'IA : un cercle fin dans la même
       palette, la coche à l'intérieur. C'est le même travail qui s'achève —
       le passage de l'un à l'autre doit se lire comme une suite, pas comme
       le remplacement d'un signe par un autre. */
    return `<div class="etat-proc prete" title="Analyse terminée">
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10.4" stroke="url(#iaFini)" stroke-width="2.4"/>
        <polyline points="7.8 12.4 10.6 15.2 16.2 9" stroke="url(#iaFini)"
                  stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg></div>`
  }
  return ''
}

/* Abandon d'une analyse : la personne ne veut plus de cette procédure. On
   supprime tout — la ligne, ses étapes, et la vidéo déposée. Azure continuera
   son calcul dans le vide, mais plus rien ne l'attend de notre côté. */
/* `dejaConfirme` : l'appelant a déjà posé la question. Sans ce garde-fou, on
   enchaînait deux fenêtres identiques — celle de l'appelant, puis celle-ci — et
   la seconde donnait l'impression que la première n'avait pas été entendue. */
async function abandonnerAnalyse(proc, dejaConfirme) {
  const ok = dejaConfirme || await confirmDialog({
    titre: 'Abandonner cette procédure ?',
    message: `« ${proc.titre || 'Cette procédure'} » sera supprimée, avec sa vidéo et l'analyse en cours. C'est définitif.`,
    confirmer: 'Supprimer',
    annuler: 'Garder',
    danger: true,
  })
  if (!ok) return false

  try {
    // La vidéo d'abord : une fois la procédure effacée, on n'aurait plus son adresse.
    if (proc.video_url) {
      const chemin = proc.video_url.split('/procedo-videos/')[1]
      if (chemin) await supabase.storage.from('procedo-videos').remove([decodeURIComponent(chemin)])
    }
    await supabase.from('etapes').delete().eq('procedure_id', proc.id)

    /* Le piège des règles d'accès : une suppression refusée ne renvoie PAS
       d'erreur. Elle réussit en ne touchant aucune ligne, et le code croit
       avoir supprimé. On redemande donc les lignes effacées : si le tableau
       revient vide, rien n'a été supprimé et il faut le dire. */
    const { data: effacees, error } = await supabase
      .from('procedures').delete().eq('id', proc.id).select('id')
    if (error) throw new Error(error.message)
    if (!effacees || effacees.length === 0) {
      throw new Error(
        "La base a refusé la suppression. C'est une règle d'accès : votre compte " +
        "n'a pas le droit de supprimer une procédure. Il faut ajouter une règle " +
        "« delete » sur la table procedures dans Supabase.")
    }

    const carte = carteDeProcedure(proc.id)
    if (carte) await replierCarte(carte)
    allGestionProcedures = allGestionProcedures.filter(p => p.id !== proc.id)
    toast('Procédure supprimée.')
    return true
  } catch (e) {
    await confirmDialog({
      titre: 'Suppression impossible',
      message: e instanceof Error ? e.message : String(e),
      confirmer: 'Compris', annuler: 'Fermer', danger: false,
    })
    return false
  }
}

/* Une procédure en cours d'analyse n'est pas consultable — ses étapes n'existent
   pas encore. La toucher propose donc la seule chose utile : y renoncer. */
async function proposerAbandon(proc) {
  const depuis = proc.created_at ? Math.round((Date.now() - new Date(proc.created_at).getTime()) / 60000) : null
  const ok = await confirmDialog({
    titre: 'Analyse en cours',
    message: `« ${proc.titre} » est encore en cours d'analyse` +
      (depuis != null ? ` depuis ${depuis} minute${depuis > 1 ? 's' : ''}` : '') +
      `. Vous ne pouvez pas la consulter avant la fin. Si vous n'en voulez plus, supprimez-la.`,
    confirmer: 'Supprimer',
    annuler: 'Attendre',
    danger: true,
  })
  if (!ok) return
  if (await abandonnerAnalyse(proc)) loadGestionProcedures()
}

/* Reprise d'une analyse en panne. On efface les étapes éventuellement écrites à
   moitié, on remet le compteur à zéro et on redemande une indexation neuve —
   avec un identifiant Azure vierge, sinon `ai-check` interrogerait l'ancienne
   analyse, celle qui a justement échoué. */
async function proposerReprise(proc) {
  const bloquee = analyseBloquee(proc)
  const raison = proc.erreur_ia ? proc.erreur_ia + ' ' : ''

  if (!proc.video_url) {
    /* « Compris » et « Fermer » disaient la même chose : rien. On restait avec
       une procédure inutilisable et aucun moyen de s'en débarrasser depuis ici.
       Le second bouton supprime désormais — c'est la seule chose à faire d'une
       analyse sans vidéo. */
    const supprimer = await confirmDialog({
      titre: 'Aucune vidéo',
      message: raison + "Cette procédure n'a pas de vidéo associée : l'analyse ne peut pas être relancée.",
      confirmer: 'Supprimer',
      annuler: 'Garder',
      danger: true,
    })
    if (supprimer) {
      await abandonnerAnalyse(proc, true)
      loadGestionProcedures()
    }
    return
  }

  const ok = await confirmDialog({
    titre: bloquee ? 'Analyse bloquée' : "L'analyse a échoué",
    message: raison + (bloquee
      ? `L'analyse tourne depuis plus de ${ANALYSE_LIMITE_MIN} minutes, ce qui n'est pas normal. Relancer depuis le début ?`
      : 'Relancer l\'analyse de cette vidéo ?'),
    confirmer: "Relancer l'analyse",
    annuler: 'Supprimer',
    danger: false,
  })
  // « Supprimer » occupe le bouton d'annulation : sur une analyse en panne,
  // renoncer est aussi légitime que réessayer.
  if (!ok) { await abandonnerAnalyse(proc) && loadGestionProcedures(); return }

  try {
    await supabase.from('etapes').delete().eq('procedure_id', proc.id)
    await supabase.from('procedures')
      .update({ statut: 'traitement', erreur_ia: null, azure_video_id: null }).eq('id', proc.id)

    const rep = await fetch(`${SUPABASE_URL}/functions/v1/ai-start`, {
      method: 'POST',
      headers: await enTeteFonction(),
      body: JSON.stringify({ procedure_id: proc.id, video_url: proc.video_url }),
    })
    const data = await rep.json()
    if (!rep.ok || data.error) throw new Error(data.error || "Le démarrage a échoué")

    toast('Analyse relancée.')
    await loadGestionProcedures()
  } catch (e) {
    await confirmDialog({
      titre: 'Impossible de relancer',
      message: e instanceof Error ? e.message : String(e),
      confirmer: 'Compris', annuler: 'Fermer', danger: false,
    })
  }
}

function estVisiteur() { return currentMembre?.role === 'visiteur' }

/* Affiche le bloc du visiteur, avec le nombre de procédures auxquelles il n'a
   pas accès. Ce nombre vient d'un simple comptage : on ne rapatrie aucun titre,
   aucune étape, rien d'autre que le total. */
async function renderBlocVisiteur() {
  const bloc = document.getElementById('e-visiteur')
  const grille = document.getElementById('e-bloc-categories')
  if (!bloc) return

  if (!estVisiteur()) {
    bloc.style.display = 'none'
    if (grille) grille.style.display = ''
    return
  }

  bloc.style.display = 'block'
  // La grille des dossiers n'a pas de sens avec une seule procédure.
  if (grille) grille.style.display = 'none'

  const { count } = await supabase
    .from('procedures').select('id', { count: 'exact', head: true })
    .eq('entreprise_id', currentMembre.entreprise_id)

  const autres = Math.max(0, (count || 0) - 1)
  const titre = document.getElementById('e-visiteur-titre')
  if (titre) {
    titre.textContent = autres > 0
      ? `${autres} autre${autres > 1 ? 's' : ''} procédure${autres > 1 ? 's' : ''} dans cette entreprise`
      : "Les autres procédures ne vous sont pas accessibles"
  }
}

/* Le code transforme l'adhésion visiteur en adhésion d'équipe : c'est la base
   qui change de rôle, pas seulement l'affichage. */
document.getElementById('e-visiteur-valider')?.addEventListener('click', async () => {
  const btn = document.getElementById('e-visiteur-valider')
  const err = document.getElementById('e-visiteur-erreur')
  const code = document.getElementById('e-visiteur-champ').value.trim()
  err.style.color = 'var(--red)'
  err.textContent = ''
  /* ⚠ LE MOTIF REFUSAIT LES LETTRES. Le nouveau code en contient : la
     vérification rejetait tout code valide. La casse est acceptée ici pour ne
     pas refuser quelqu'un qui saisit en minuscules — le serveur la normalise. */
  if (!/^[A-Za-z0-9]{6}$/.test(code)) { err.textContent = 'Le code comporte 6 caractères.'; return }

  setButtonLoading(btn, true)
  const ent = await entrepriseParCode(code)

  if (!ent || ent.id !== currentMembre.entreprise_id) {
    setButtonLoading(btn, false)
    err.textContent = "Ce code ne correspond pas à cette entreprise."
    return
  }

  const { error } = await supabase.from('membres')
    .update({ role: 'equipe', procedure_visitee: null }).eq('id', currentMembre.id)
  setButtonLoading(btn, false)
  if (error) { err.textContent = 'Erreur : ' + error.message; return }

  currentMembre.role = 'equipe'
  currentMembre.procedure_visitee = null
  err.style.color = 'var(--green)'
  err.textContent = 'Accès complet débloqué.'
  loadEquipeProcedures()
})

async function loadEquipeProcedures() {
  /* Un visiteur arrivé par QR n'a accès qu'à la procédure scannée. On ne
     demande donc que celle-là : les autres ne sont jamais chargées, il n'y a
     rien à masquer ni à contourner côté navigateur. */
  const requete = estVisiteur()
    /* ═══ L'ÉQUIPE NE VOIT QUE CE QUI EST PUBLIÉ ═══

       `.not('publiee_le', 'is', null)` écarte les brouillons. Le gérant les
       voit dans son espace, l'équipe non.

       ⚠ CE FILTRE NE PROTÈGE RIEN À LUI SEUL. Quelqu'un qui appelle l'API
         directement peut demander toutes les procédures. C'est la politique
         RLS de `migration-publication.sql` qui fait respecter la règle — celle
         d'ici ne fait qu'éviter un aller-retour inutile. */
    ? supabase.from('procedures').select('*')
        .eq('id', currentMembre.procedure_visitee)
        .not('publiee_le', 'is', null)
    : supabase.from('procedures').select('*')
        .eq('entreprise_id', currentMembre.entreprise_id)
        .not('publiee_le', 'is', null)
        .order('titre')

  const { data: procedures, error } = await requete
  if (error) { console.error(error); return }

  // Une procédure encore en analyse n'a aucune étape : inutile de la proposer.
  const pretes = (procedures || []).filter(p => p.statut !== 'traitement')

  // Étapes de TOUTES les procédures et mes validations, chargées d'un coup :
  // chaque fiche s'ouvrira ensuite instantanément.
  const procIds = pretes.map(p => p.id)
  const [{ data: mesValidations }, { data: toutesEtapes }] = await Promise.all([
    supabase.from('validations').select('procedure_id, validated_at, duree_lecture').eq('membre_id', currentMembre.id),
    supabase.from('etapes').select('*').in('procedure_id', procIds).order('ordre'),
  ])
  /* La colonne `duree_lecture` peut ne pas exister encore en base : dans ce cas
     la requête échoue en entier et on perdait TOUTES les lectures, donc les
     coches de « déjà lu ». On redemande alors sans elle. */
  let lectures = mesValidations
  if (!lectures) {
    const repli = await supabase.from('validations')
      .select('procedure_id, validated_at').eq('membre_id', currentMembre.id)
    lectures = repli.data || []
  }

  equipeLues = new Set(lectures.map(v => v.procedure_id))
  mesLectures = lectures   // avec la date et la durée, pour l'écran d'activité

  equipeEtapesByProc = {}
  ;(toutesEtapes || []).forEach(e => {
    if (!equipeEtapesByProc[e.procedure_id]) equipeEtapesByProc[e.procedure_id] = []
    equipeEtapesByProc[e.procedure_id].push(e)
  })

  allEquipeProcedures = pretes
  renderEquipeAccueil()
  renderEquipeCategories()
  renderBlocVisiteur()
}

/* Salutation et anneaux de l'employé. Les trois chiffres répondent à sa seule
   question : combien j'en ai lu, combien il en reste. */
function renderEquipeAccueil() {
  const h = new Date().getHours()
  /* PAS DE « BONNE NUIT ». On souhaitait la bonne nuit avant 6 h — or celui
     qui ouvre l'app à cette heure-là ne va pas se coucher : il ouvre le
     restaurant, ou il termine le service. Lui dire bonne nuit, c'est le
     saluer comme s'il partait.

     Deux salutations suffisent : « Bonsoir » couvre la nuit et la soirée,
     « Bonjour » le reste. La bascule à 5 h plutôt qu'à 6 : à cinq heures on
     est en début de journée pour une équipe de cuisine. */
  const bonjour = (h >= 5 && h < 18) ? 'Bonjour' : 'Bonsoir'
  const prenom = (currentMembre?.nom || '').trim().split(' ')[0]
  /* Le salut est le TITRE de la page. La main reste : c'est elle qui distingue
     un bonjour d'une simple étiquette. */
  const salut = document.getElementById('e-salut')
  if (salut) salut.textContent = `${bonjour}${prenom ? ' ' + prenom : ''} 👋`

  const total = allEquipeProcedures.length
  const lues = allEquipeProcedures.filter(p => equipeLues.has(p.id)).length
  const reste = total - lues
  const pct = total ? Math.round((lues / total) * 100) : 0

  /* La seconde ligne du titre. `e-mot` a disparu avec la carte : on écrit
     désormais dans `e-compte`, la ligne de compte de la page — c'est le même
     rôle, à la même place que sur les pages de la gestion. */
  const mot = document.getElementById('e-compte')
  if (mot) {
    mot.innerHTML = !total
      ? "Aucune procédure pour l'instant."
      : reste === 0
        ? "Vous avez tout lu. Rien ne vous attend."
        : `Il vous reste <b>${reste} procédure${reste > 1 ? 's' : ''}</b> à lire.`
  }
}

/* Grille des dossiers, exactement celle de l'espace gestion : anneau de
   progression, nom, nombre de procédures et aperçu des titres récents. */
function renderEquipeCategories() {
  const grille = document.getElementById('e-cat-grid')
  if (!grille) return
  grille.innerHTML = ''

  /* Le compte de la page est écrit par `renderEquipeAccueil`, pas ici : deux
     fonctions qui remplissent la même ligne finissent par se contredire. */

  if (!allEquipeProcedures.length) {
    grille.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <h3>Aucune procédure</h3><p>Votre responsable vous prévient dès qu'il en publie une.</p></div>`
    return
  }

  const parCat = {}
  allEquipeProcedures.forEach(p => {
    const nom = p.categorie || 'Sans dossier'
    if (!parCat[nom]) parCat[nom] = []
    parCat[nom].push(p)
  })

  /* Le même tri que côté gestion, plus une entrée propre à l'employé :
     « À lire d'abord » remonte les dossiers où il lui reste le plus à lire. */
  const dateCat = (n) => Math.max(...parCat[n].map(p => new Date(p.created_at || 0).getTime()))
  const resteCat = (n) => parCat[n].filter(p => !equipeLues.has(p.id)).length

  Object.keys(parCat).sort((a, b) => {
    if (equipeCatSort === 'new') return dateCat(b) - dateCat(a)
    if (equipeCatSort === 'old') return dateCat(a) - dateCat(b)
    return a.localeCompare(b, 'fr')
  }).forEach(nom => {
    const procs = parCat[nom]
    const lues = procs.filter(p => equipeLues.has(p.id)).length
    const pct = Math.round((lues / procs.length) * 100)
    const couleur = pct === 100 ? 'var(--green)' : pct >= 34 ? 'var(--orange)' : 'var(--red)'
    const c = 2 * Math.PI * 19

    const cell = document.createElement('div')
    cell.className = 'cat-cell'
    cell.onclick = () => openEquipeCategorie(nom)
    /* ═══ LA MÊME CARTE QUE CÔTÉ GESTION ═══

       Les deux avaient divergé : plaque ambre et pied à chevron d'un côté,
       icône blanche et pastille de comptage de l'autre. Or c'est le même objet
       — une dossier — et l'employé qui devient gérant ne doit pas avoir à
       réapprendre à quoi elle ressemble.

       Le pied dit la MÊME chose des deux côtés : le nombre de procédures de la
       dossier. « Tout est lu » y figurait un temps — mais un pied qui change
       de nature selon l'état ne se compare plus d'une carte à l'autre, et le
       nombre, lui, se lit toujours. Ce qui reste à faire est déjà dit par les
       pastilles sur les titres, juste au-dessus. */
    cell.innerHTML = `
      <div class="cat-top">
        <span class="cat-ic">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M3 7.4a2 2 0 0 1 2-2h4.2l2 2.4h7.8a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"
                  stroke="url(#logoOrIc)" stroke-width="1.7" stroke-linejoin="round"/>
            <line x1="3" y1="10.6" x2="21" y2="10.6" stroke="url(#logoOrIc)" stroke-opacity="0.5" stroke-width="1.5"/>
          </svg>
        </span>
      </div>
      <div class="cat-name"><span class="txt">${escapeHtml(nom)}</span></div>
      <div class="cat-recent">
        ${[...procs]
          .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
          .slice(0, 3)
          /* Plus de pastille « non lu » ici. Trois procédures sur quatre en
             portaient une — sur une carte qui n'en montre que trois, un signal
             qui s'allume presque partout ne distingue plus rien. Le compte à
             lire est déjà dit en haut de la page, en toutes lettres. */
          .map(p => `<div class="cat-recent-item"><span class="txt">${escapeHtml(p.titre)}</span></div>`).join('')}
      </div>
      <div class="cat-pied">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M13.6 3H7.4A2 2 0 0 0 5.4 5v14a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8Z"
                stroke="url(#logoOrIc)" stroke-width="1.8" stroke-linejoin="round"/>
          <path d="M13.6 3v5h5" stroke="url(#logoOrIc)" stroke-width="1.8" stroke-linejoin="round"/>
        </svg>
        <span>${procs.length} procédure${procs.length > 1 ? 's' : ''}</span>
        <span class="fl">\u203a</span>
      </div>
    `
    grille.appendChild(cell)
  })
}

/* Écran d'une dossier : ses procédures, avec sa propre recherche. */
function openEquipeCategorie(nom) {
  equipeCatCourante = nom
  /* Sinon, ouvrir « Salle » après « Cuisine › Friteuse » afficherait une liste
     vide, et rien ne dirait pourquoi. */
  equipeSousDossier = null
  equipeCatQuery = ''
  const champ = document.getElementById('e-cat-recherche')
  if (champ) champ.value = ''
  document.getElementById('e-cat-titre').textContent = nom
  document.querySelectorAll('#equipe-app .screen').forEach(s => s.classList.remove('active'))
  activerAvecNaissance(document.getElementById('e-category'))
  remonterEnHaut()
  renderEquipeCatListe()
}

/* ═══ OÙ L'EMPLOYÉ SE TROUVE DANS L'ARBRE ═══

   Même mécanique que côté Gestion : `null` dans le dossier, une chaîne dans un
   sous-dossier. On réemploie l'écran `e-category` plutôt que d'en créer un
   second, pour la même raison — deux écrans jumeaux, ce sont deux boutons
   retour et deux recherches à maintenir en parallèle. */
let equipeSousDossier = null

/* La carte d'un sous-dossier, côté Équipe. Même moule que la carte de dossier
   de cet espace, seule l'icône change — un dossier posé dans un autre. */
function carteSousDossierEquipe(nom, procs) {
  const cell = document.createElement('div')
  cell.className = 'cat-cell cat-cell--sous'
  cell.onclick = () => ouvrirSousDossierEquipe(nom)
  const apercu = procs.slice(0, 3)
  const lues = procs.filter(p => equipeLues.has(p.id)).length
  cell.innerHTML = `
    <div class="cat-top">
      <span class="cat-ic">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M2.4 6.6a1.7 1.7 0 0 1 1.7-1.7h3.3l1.6 1.9h6" stroke="url(#logoOrIc)"
                stroke-width="1.6" stroke-opacity="0.45" stroke-linejoin="round" stroke-linecap="round"/>
          <path d="M6 10.2a2 2 0 0 1 2-2h3.4l1.7 2h6.9a2 2 0 0 1 2 2v6.6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2Z"
                stroke="url(#logoOrIc)" stroke-width="1.7" stroke-linejoin="round"/>
          <line x1="6" y1="13.4" x2="22" y2="13.4" stroke="url(#logoOrIc)" stroke-opacity="0.5" stroke-width="1.5"/>
        </svg>
      </span>
    </div>
    <div class="cat-name"><span class="txt">${escapeHtml(nom)}</span></div>
    <div class="cat-recent">
      ${apercu.map(p => `<div class="cat-recent-item"><span class="txt">${escapeHtml(p.titre)}</span></div>`).join('')}
    </div>
    <div class="cat-pied">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M13.6 3H7.4A2 2 0 0 0 5.4 5v14a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8Z"
              stroke="url(#logoOrIc)" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M13.6 3v5h5" stroke="url(#logoOrIc)" stroke-width="1.8" stroke-linejoin="round"/>
      </svg>
      <span>${procs.length} procédure${procs.length > 1 ? 's' : ''}${lues ? ` · ${lues} lue${lues > 1 ? 's' : ''}` : ''}</span>
      <span class="fl">\u203a</span>
    </div>`
  return cell
}

/* Le retour remonte d'un niveau, comme côté Gestion. Rouvrir le dossier plutôt
   que de vider la variable : `openEquipeCategorie` remet aussi le titre, le
   sous-titre et la recherche. Les remettre à la main, c'est en oublier un. */
document.getElementById('e-cat-retour')?.addEventListener('click', () => {
  if (equipeSousDossier) { openEquipeCategorie(equipeCatCourante); return }
  showEquipeScreen('e-list', document.querySelector('#tabbar .tab-round'))
})

function ouvrirSousDossierEquipe(nom) {
  equipeSousDossier = nom
  equipeCatQuery = ''
  const champ = document.getElementById('e-cat-recherche')
  if (champ) champ.value = ''
  document.getElementById('e-cat-titre').textContent = nom
  remonterEnHaut()
  renderEquipeCatListe()
}

function renderEquipeCatListe() {
  const listEl = document.getElementById('equipe-procedures-list')
  if (!listEl) return
  const duDossier = allEquipeProcedures.filter(p => (p.categorie || 'Sans dossier') === equipeCatCourante)
  /* Dans un sous-dossier, on ne voit que lui — y compris pour la recherche :
     chercher depuis l'intérieur de « Friteuse » ne doit pas ramener toute la
     cuisine. */
  const dansCat = equipeSousDossier
    ? duDossier.filter(p => (p.sous_categorie || '').trim() === equipeSousDossier)
    : duDossier
  const q = equipeCatQuery
  const vues = q ? dansCat.filter(p => p.titre.toLowerCase().includes(q)) : dansCat

  const lues = dansCat.filter(p => equipeLues.has(p.id)).length
  document.getElementById('e-cat-sous').textContent =
    `${dansCat.length} procédure${dansCat.length > 1 ? 's' : ''} · ${lues} lue${lues > 1 ? 's' : ''}`

  listEl.innerHTML = ''
  if (!vues.length) {
    listEl.innerHTML = `<div class="empty-state"><h3>Aucun résultat</h3><p>Aucune procédure ne correspond à votre recherche.</p></div>`
    return
  }
  /* Le même tri que les dossiers, avec la même entrée propre à l'employé :
     « À lire d'abord » remonte ce qu'il n'a pas encore ouvert. */
  const triees = [...vues].sort((a, b) => {
    if (equipeProcSort === 'new') return new Date(b.created_at || 0) - new Date(a.created_at || 0)
    if (equipeProcSort === 'old') return new Date(a.created_at || 0) - new Date(b.created_at || 0)
    /* Le tri « À lire d'abord » a été retiré du menu : les deux branches qui le
       servaient sont parties avec lui. Un tri qu'aucun bouton ne déclenche est
       un piège pour qui relira ce code. */
    return (a.titre || '').localeCompare(b.titre || '', 'fr')
  })

  /* ═══ LE MÊME REGROUPEMENT CÔTÉ ÉQUIPE ═══

     L'employé range moins que le gérant, mais il LIT dans la même arborescence.
     Voir « Friteuse » dans un espace et pas dans l'autre serait le meilleur
     moyen de lui faire croire à deux applications différentes. */
  /* ═══ LES SOUS-DOSSIERS EN CARTES, COMME CÔTÉ GESTION ═══

     Ils s'affichent même s'il n'y en a qu'un : le chemin doit être le même
     quel que soit le nombre. Un sous-dossier qui disparaît quand il est seul
     obligerait l'employé à apprendre deux parcours pour un seul rangement.

     Trois cas où ils ne s'affichent pas : on est déjà dans un sous-dossier,
     une recherche est en cours, ou il n'y en a aucun. */
  const montrerSD = !equipeSousDossier && !q
  if (montrerSD) {
    const groupes = new Map()
    for (const p of triees) {
      const sd = (p.sous_categorie || '').trim()
      if (!sd) continue
      if (!groupes.has(sd)) groupes.set(sd, [])
      groupes.get(sd).push(p)
    }
    if (groupes.size) {
      const noms = [...groupes.keys()].sort((a, b) =>
        a.localeCompare(b, 'fr', { sensitivity: 'base' }))
      const grille = document.createElement('div')
      grille.className = 'sd-grille'
      noms.forEach(n => grille.appendChild(carteSousDossierEquipe(n, groupes.get(n))))
      listEl.appendChild(grille)
    }
  }

  /* Les procédures rangées ne sont pas répétées : elles sont déjà accessibles
     par leur carte, et les afficher deux fois doublerait la liste. */
  const aLister = montrerSD ? triees.filter(p => !(p.sous_categorie || '').trim()) : triees
  aLister.forEach(p => listEl.appendChild(ficheEquipe(p)))
}

/* Une fiche de procédure, réutilisée par la dossier et par la recherche.
   Même carte que dans l'espace gestion : anneau, nombre d'étapes, titre. Ce que
   l'anneau mesure change de sens — côté gérant, la part de l'équipe qui a
   consulté ; côté employé, sa propre lecture : pleine et verte s'il l'a lue,
   vide sinon. */
function ficheEquipe(proc) {
  const lue = equipeLues.has(proc.id)
  const nbEtapes = (equipeEtapesByProc[proc.id] || []).length

  const div = document.createElement('div')
  div.className = 'card proc-rich-card'
  div.dataset.key = proc.id
  div.onclick = () => openEquipeDetail(proc.id)
  /* L'ICÔNE PORTE LE MÊME DÉGRADÉ QUE CÔTÉ GESTION.

     Le tracé était déjà identique, seule la couleur différait : blanc à 78 %
     ici, le dégradé ambre là-bas. Une procédure est le même objet dans les
     deux espaces — l'employé qui devient gérant ne doit pas avoir à
     réapprendre à quoi elle ressemble.

     Le commentaire est ICI et non dans le gabarit : à l'intérieur, un accent
     grave refermerait la chaîne. C'est ce qui vient de casser le fichier. */
  div.innerHTML = `
    <div class="cat-top">
      <!-- L'anneau coloré est retiré : la coche verte dit déjà que c'est lu, et
             l'anneau gris autour d'une procédure non lue ressemblait à une jauge
             à zéro plutôt qu'à « pas encore ouverte ». -->
        <div class="cat-ring-wrap">
          <div class="cat-icon"><svg viewBox="0 0 24 24" fill="none"><path d="M13.6 3H7.4A2 2 0 0 0 5.4 5v14a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8Z" stroke="url(#logoOrIc)" stroke-width="1.7" stroke-linejoin="round"/><path d="M13.6 3v5h5" stroke="url(#logoOrIc)" stroke-width="1.7" stroke-linejoin="round"/><line x1="8.6" y1="12.6" x2="15.4" y2="12.6" stroke="url(#logoOrIc)" stroke-opacity="0.5" stroke-width="1.6" stroke-linecap="round"/><line x1="8.6" y1="16.4" x2="13" y2="16.4" stroke="url(#logoOrIc)" stroke-opacity="0.5" stroke-width="1.6" stroke-linecap="round"/></svg></div>
      </div>
      ${nbEtapes ? `<div class="cat-badge">${nbEtapes} \u00e9tape${nbEtapes > 1 ? 's' : ''}</div>` : ''}
    </div>
    <div class="cat-name"><span class="txt">${escapeHtml(proc.titre)}</span></div>
    <div class="carte-categorie">${escapeHtml(proc.categorie || 'Sans cat\u00e9gorie')}</div>
    <div class="cat-pct-row">
      <span class="cat-pct" style="color:${lue ? '#30D158' : 'var(--label-3)'};font-size:14px;">
        ${lue ? 'Lue' : '\u00c0 lire'}</span>
    </div>`
  return div
}


/* Recherche de l'accueil : elle cherche dans toutes les procédures, toutes
   dossiers confondues, et remplace la grille par ses résultats le temps de
   la saisie. */

// Recherche à l'intérieur d'une dossier
document.getElementById('e-cat-recherche')?.addEventListener('input', (e) => {
  equipeCatQuery = e.target.value.trim().toLowerCase()
  renderEquipeCatListe()
})

// Le support, joignable depuis l'avatar comme côté gestion

// ═══════════ ÉQUIPE : détail ═══════════
/* ═══════════════════════════════════════════════════════════════════════════
   COCHER LES ÉTAPES

   L'employé coche chaque étape en la réalisant. Deux effets, et le second
   compte plus que le premier.

   Le temps mesuré devient un temps d'EXÉCUTION, pas de lecture. « Fermeture de
   caisse : 22 minutes en moyenne » apprend quelque chose de vrai sur
   l'établissement ; « 40 secondes de lecture » n'apprend rien.

   ═══ LES CASES NE SURVIVENT PAS À LA FERMETURE ═══

   Elles étaient relues à l'ouverture, pour retrouver où l'on en était après une
   interruption. Mais une procédure de travail se REFAIT : celui qui rouvre
   « Fermeture de caisse » le lendemain la refait en entier, et retrouver la
   liste à moitié barrée l'oblige à tout décocher avant de commencer.

   La colonne `validations.etapes_faites` continue d'être écrite — elle ne coûte
   rien et pourra servir un jour à savoir quelles étapes sont systématiquement
   sautées. Mais PLUS PERSONNE NE LA RELIT pour préremplir les cases.

   Ce qui reste enregistré, c'est la LECTURE elle-même et le temps passé : c'est
   ce que la gestion consulte, et ça ne bouge pas.
   ═══════════════════════════════════════════════════════════════════════════ */

let etapesFaites = new Set()
let etapesTotal = 0
let colonneCochesAbsente = false

/* ═══════════════════════════════════════════════════════════════════════════
   COCHER UNE ÉTAPE : TROIS TEMPS, ET RIEN QUI SAUTE

   Le chiffre devient une coche, le texte pâlit — on marque une pause de 420 ms
   pour qu'on VOIE ce qui vient d'être fait — puis l'étape se replie et celles
   du dessous GLISSENT à sa place.

   Le glissement est le point délicat. Replier une étape déplace toutes les
   suivantes d'un coup : elles réapparaissent ailleurs sans qu'on ait vu le
   trajet, et l'œil croit que la liste a été remplacée. On mesure donc leur
   position AVANT, on laisse le navigateur poser la nouvelle, puis on les remet
   optiquement à l'ancienne et on relâche : elles rejoignent leur place en
   glissant. C'est le seul moyen d'animer un déplacement qu'on n'a pas calculé
   soi-même.
   ═══════════════════════════════════════════════════════════════════════════ */
function basculerEtape(etapeId) {
  const dejaFaite = etapesFaites.has(etapeId)

  if (dejaFaite) {
    etapesFaites.delete(etapeId)
    peindreCoches()
    enregistrerCoches()
    return
  }

  etapesFaites.add(etapeId)
  if (navigator.vibrate) navigator.vibrate(8)
  enregistrerCoches()

  /* ═══ L'ÉTAPE NE PART PLUS ═══

     Elle se repliait après 620 ms, et les suivantes remontaient pour combler
     le vide. Deux défauts : on perdait de vue ce qu'on venait de faire, et le
     texte bougeait sous le doigt au moment précis où l'on regardait.

     Maintenant elle RESTE. Le chiffre devient une coche, l'étape pâlit, et
     c'est tout — la liste ne bouge pas. On garde la trace de son avancement
     sous les yeux, et on peut revenir en arrière d'un simple regard.

     `peindreCoches` suffit donc : c'est lui qui pose la classe `faite`, dont
     le style fait le reste. */
  peindreCoches()
}

/* ═══ PLUS DE BANDEAU « 3 ÉTAPES FAITES — REVOIR » ═══

   Il apparaissait dès la première coche et grandissait à chaque suivante. Sur
   une procédure de huit étapes, on finissait avec un bandeau permanent en tête
   de liste et deux étapes en dessous : l'écran parlait davantage de ce qui
   était fini que de ce qui restait à faire.

   Or c'est l'inverse qu'un employé debout en cuisine a besoin de voir. Ce qui
   est fait a disparu, et c'est très bien : le geste suivant est en haut.

   La fonction reste, vidée, plutôt que d'être supprimée : elle est appelée à
   quatre endroits, et retirer chaque appel multiplierait les occasions de me
   tromper. Elle efface la zone, ce qui suffit. */
function peindreRappelFaites() {
  const zone = document.getElementById('etapes-rappel')
  if (!zone) return
  zone.innerHTML = ''
  document.body.classList.remove('etapes-toutes')
  return
  const n = etapesFaites.size
  const ouvert = document.body.classList.contains('etapes-toutes')

  if (!n) { zone.innerHTML = ''; document.body.classList.remove('etapes-toutes'); return }

  /* Pas d'animation d'ouverture sur le rappel : sa hauteur est déjà prise en
     compte dans le glissement des étapes. L'animer en plus le ferait bouger
     deux fois — une fois par lui-même, une fois par le calcul. */
  zone.innerHTML = `
    <button type="button" class="fait-rappel${ouvert ? ' ouvert' : ''}" id="rappel-btn">
      <span class="p">${cocheFaiteDess()}</span>
      <span><b>${n} \u00e9tape${n > 1 ? 's' : ''} faite${n > 1 ? 's' : ''}</b> \u2014 ${
        ouvert ? 'masquer' : 'revoir'}</span>
      <span class="fl">\u203a</span>
    </button>`

  document.getElementById('rappel-btn').addEventListener('click', () => {
    document.body.classList.toggle('etapes-toutes')
    /* `peindreCoches` repeint aussi le rappel : l'appeler seul suffit, et
       l'appeler tous les deux ferait boucler. */
    peindreCoches()
  })
}

function peindreCoches() {
  /* Le rappel se repeint avec les coches : c'est le même état, il ne doit pas
     pouvoir être en retard d'un cran sur la liste. */
  peindreRappelFaites()
  document.querySelectorAll('#detail-steps .detail-step').forEach((div, i) => {
    const b = div.querySelector('.et-coche')
    if (!b) return
    const faite = etapesFaites.has(b.dataset.etape)
    b.classList.toggle('f', faite)
    /* On ne REMPLACE plus le contenu : le chiffre et la coche sont tous deux
       dans le bouton, superposés, et c'est la classe `faite` de l'étape qui
       décide lequel se voit. Un remplacement ne peut pas s'animer — c'était la
       raison pour laquelle le chiffre sautait à la coche. */
    const num = b.querySelector('.num')
    if (!num) b.innerHTML = `<span class="num">${numeroEtapeDess(i + 1)}</span>`
      + `<span class="ok">${cocheFaiteDess()}</span>`
    else num.innerHTML = numeroEtapeDess(i + 1)
    div.classList.toggle('faite', faite)

    /* ═══ L'ÉTAPE NE SE REPLIE PLUS ═══

       `et-part` et `et-repli` la faisaient disparaître : c'était le dispositif
       d'avant. On les retire de force plutôt que de simplement ne plus les
       poser — une étape cochée lors d'une visite précédente les porterait
       encore, et resterait invisible.

       Les styles posés en ligne par l'ancienne animation sont effacés pour la
       même raison : sans ça, une étape figée à hauteur nulle le resterait. */
    div.classList.remove('et-part', 'et-repli')
    div.style.maxHeight = ''
    div.style.transform = ''
    div.style.transition = ''
  })
  majBandeauCoches()
}

/* ═══════════════════════════════════════════════════════════════════════════
   REPEINDRE SANS PERDRE SA PLACE

   Redessiner une liste d'étapes en détruit tout le contenu et le recrée. La
   page devient brièvement plus courte, le navigateur n'a plus assez de matière
   pour tenir le défilement où il était, et il remonte en haut. C'est ce qui se
   passait quand on retirait la photo d'une étape : l'écran sautait au sommet
   et il fallait redescendre chercher où l'on en était.

   On relève la position AVANT, on repeint, et on la remet — dans la même image,
   sans quoi le saut se verrait quand même.
   ═══════════════════════════════════════════════════════════════════════════ */
function repeindreSansSauter(repeindre) {
  /* C'est la FENÊTRE qui défile, pas l'écran : les écrans sont en
     `overflow:visible` et s'étirent, c'est le document qui porte la barre.
     Vérifié — j'avais d'abord sauvegardé aussi le `scrollTop` du conteneur, il
     valait zéro en toutes circonstances. */
  const y = window.scrollY
  repeindre()
  window.scrollTo({ top: y, behavior: 'instant' })
}

/* ═══════════════════════════════════════════════════════════════════════════
   VOS ANALYSES VIDÉO

   On interroge `verifier_analyse`, qui NE CONSOMME RIEN — c'est la fonction de
   lecture, pas celle qui décompte. Ouvrir cette page ne coûte donc aucune
   analyse, ce qui serait le comble.

   Le mode DOCUMENT n'est pas compté : il passe par `ai-texte`, sans Azure, et
   coûte vingt-cinq fois moins. Le dire ici transforme une limite en générosité
   — et évite qu'un client se croie bloqué alors qu'il ne l'est pas.
   ═══════════════════════════════════════════════════════════════════════════ */
let quotaConnu = null

/* Le premier jour du mois PROCHAIN, en toutes lettres. « le mois prochain »
   oblige à calculer ; « le 1er septembre » se retient. */
function dateRenouvellement() {
  const d = new Date()
  const p = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  return p.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
    .replace(/^1 /, '1er ')
}

async function lireQuota() {
  try {
    const { data, error } = await supabase.rpc('verifier_analyse')
    if (error || !data) return null
    quotaConnu = { quota: Number(data.quota) || 0, reste: Number(data.reste) || 0 }
    return quotaConnu
  } catch (e) {
    console.warn('[quota] lecture impossible :', e?.message || e)
    return null
  }
}

/* La ligne des Réglages. Elle affiche le compte SANS ouvrir la page. */
async function majLigneQuota() {
  const el = document.getElementById('reg-quota')
  if (!el) return
  const q = await lireQuota()
  el.textContent = q ? `${q.reste} sur ${q.quota}` : '\u2014'
}

window.ouvrirQuota = async function() {
  showGestionScreen('p-quota')
  const carte = document.getElementById('quota-carte')
  if (!carte) return
  carte.innerHTML = '<div class="quota-attente">Chargement\u2026</div>'

  const q = await lireQuota()
  if (!q) {
    carte.innerHTML = '<div class="quota-attente">Le compte n\u2019a pas pu \u00eatre lu. '
      + 'R\u00e9essayez dans un instant.</div>'
    return
  }

  const { quota, reste } = q
  const R = 92, C = 2 * Math.PI * R
  /* L'ambre montre ce qui RESTE : l'anneau maigrit à mesure du mois. Montrer le
     consommé se lirait à l'envers — un anneau presque plein voudrait dire
     « il ne reste presque rien ». */
  const part = quota > 0 ? (reste / quota) * C : 0
  const s = reste > 1 ? 's' : ''

  carte.innerHTML = `
    <div class="quota-anneau">
      <svg width="220" height="220" viewBox="0 0 220 220">
        <circle class="piste" cx="110" cy="110" r="${R}" fill="none" stroke-width="17"/>
        <circle class="part" cx="110" cy="110" r="${R}" fill="none" stroke="#FDA81E"
          stroke-width="17" stroke-dasharray="${part} ${C - part}" stroke-dashoffset="${C}"/>
      </svg>
      <div class="quota-dedans">
        <div class="gros">${reste}</div>
        <div class="unite">analyse${s} restante${s}</div>
        <div class="sous">sur ${quota} ce mois-ci</div>
      </div>
    </div>
    <div class="quota-illimite">
      <span class="ic">\u221e</span>
      <!-- ═══ LA PHRASE LA PLUS COURTE POSSIBLE ═══

           Deux versions écartées avant celle-ci.

           La première parlait en interne : « Créer depuis un document ou à la
           main reste illimité. Seule l'analyse vidéo est comptée. » Personne ne
           reconnaît de bouton derrière « depuis un document ».

           La seconde nommait les modes exactement — « L'IA découpe un
           document », « Étapes manuelles » — et faisait quatre lignes sur un
           iPhone SE. Exact, mais trop long pour une note sous un compteur : on
           ne lit pas quatre lignes pour comprendre un chiffre.

           Celle-ci tient en une phrase et répond à la seule question qu'on se
           pose devant un compteur : qu'est-ce qui le fait descendre ? Ce qui
           reste gratuit se déduit — et de toute façon rien d'autre n'est
           compté nulle part. -->
      <span>Seules les vid\u00e9os analys\u00e9es par l\u2019IA sont compt\u00e9es.
        <b>Tout le reste est gratuit.</b></span>
    </div>
    ${reste <= 5 ? `<button type="button" class="quota-cta" onclick="ouvrirAbonnementDepuisQuota()">
        ${reste === 0 ? 'Passer \u00e0 l\u2019offre sup\u00e9rieure' : 'Voir les offres'}
      </button>` : ''}
    <div class="quota-pied">
      Renouvellement le <b>${dateRenouvellement()}</b>.
      Les analyses non utilis\u00e9es ne se reportent pas.
    </div>`

  /* L'anneau part de zéro et se remplit : deux images d'attente, sans quoi le
     navigateur pose la valeur finale sans rien animer. */
  const arc = carte.querySelector('.part')
  if (arc) requestAnimationFrame(() => requestAnimationFrame(() => {
    arc.setAttribute('stroke-dashoffset', '0')
  }))
}

window.ouvrirAbonnementDepuisQuota = function() {
  document.getElementById('ouvrir-abonnement')?.click()
}

/* Le bandeau du bas dit où l'on en est, et félicite à la dernière case. */
function majBandeauCoches() {
  const etat = document.getElementById('lecture-etat')
  if (!etat || !etapesTotal) return
  const n = etapesFaites.size
  const fini = n === etapesTotal
  /* Visible dès l'ouverture, même à 0 sur 8 : c'est ce qui dit à quoi servent les
     cases. Un bandeau qui apparaît en cours de route ne s'explique pas. */

  etat.closest('.confirm-bar')?.classList.add('visible')
  etat.style.display = ''
  etat.classList.remove('pointe')
  etat.classList.toggle('faite', fini)
  dessinerAnneauLecture(
    Math.round((n / etapesTotal) * 100),
    fini ? 'var(--green)' : 'var(--blue)',
    fini ? '\u2713' : `${n}/${etapesTotal}`,
  )
  document.getElementById('lecture-titre').textContent = fini
    ? 'Proc\u00e9dure termin\u00e9e' : 'En cours'
  document.getElementById('lecture-sous').textContent = fini
    ? 'Les ' + etapesTotal + ' \u00e9tapes sont faites'
    : 'Cochez chaque \u00e9tape en la r\u00e9alisant'
}

async function enregistrerCoches() {
  if (colonneCochesAbsente || !lectureProcId || !currentMembre) return

  /* Un `upsert` réécrit la LIGNE ENTIÈRE : les colonnes absentes repartent à
     NULL. En omettant `duree_lecture`, cocher une case effaçait tout le temps
     déjà mesuré — et comme la copie locale servait de base à la visite
     suivante, le compteur repartait de zéro à chaque fois.

     On envoie donc aussi le temps courant, exactement comme l'autre écriture. */
  const total = lectureBase + lectureSecondes
  const { error } = await supabase.from('validations').upsert({
    procedure_id: lectureProcId,
    membre_id: currentMembre.id,
    etapes_faites: [...etapesFaites],
    duree_lecture: total,
    validated_at: new Date().toISOString(),
  }, { onConflict: 'procedure_id,membre_id' })

  const l = (mesLectures || []).find(v => v.procedure_id === lectureProcId)
  if (l) l.duree_lecture = total

  /* La colonne peut ne pas exister : on cesse d'essayer plutôt que de répéter
     l'erreur à chaque case cochée. Les cases restent utilisables à l'écran. */
  if (error && /etapes_faites/i.test(error.message || '')) {
    colonneCochesAbsente = true
    console.warn('Standix \u00b7 colonne etapes_faites absente : les coches ne seront pas gard\u00e9es.')
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   LA PROCÉDURE EN PDF

   Une procédure vit sur un téléphone. Mais il y a des murs de plonge sans
   réseau, des classeurs qu'un inspecteur demande, des employés qui préfèrent
   le papier. Le PDF est le format qui passe partout et ne demande rien.

   ─── LE TEXTE EST DU TEXTE, PAS UNE IMAGE ───

   Deux façons de fabriquer un PDF dans un navigateur. On peut photographier
   l'écran et coller l'image dans une page — c'est ce que fait `html2canvas`,
   et c'est ce que je n'ai PAS fait. Une capture d'écran ne se cherche pas, ne
   se copie pas, s'imprime mal, et pèse dix fois plus lourd.

   On écrit donc le texte directement dans le document. Il reste sélectionnable,
   cherchable, et une procédure de dix étapes tient dans une trentaine de
   kilooctets.

   ─── LA VIDÉO N'Y EST PAS, ET NE PEUT PAS Y ÊTRE ───

   Un PDF ne lit pas de vidéo. Les bornes de temps de chaque étape sont
   conservées — « 0:12 – 0:34 » — pour qui voudrait retrouver le passage dans
   l'app. C'est tout ce qu'on peut faire, et le dire vaut mieux que de laisser
   quelqu'un chercher un bouton de lecture sur une feuille.

   ─── LA BIBLIOTHÈQUE EST CHARGÉE À LA DEMANDE ───

   Comme le lecteur de QR et le lecteur de PDF déjà présents : rien n'est
   téléchargé tant que personne ne demande un export.
   ═══════════════════════════════════════════════════════════════════════════ */

let jsPDFModule = null

/* ═══ LE LOGO, TEL QUEL ═══

   Le même ambre que dans l'app. Une procédure imprimée doit se reconnaître au
   premier coup d'œil comme venant de Standix, et une marque qui change de
   couleur selon le support n'est plus tout à fait la même marque.

   Le PDF ne portait auparavant aucune image — seulement le mot « Standix » en
   gris clair au bas de la page, qu'on ne voyait pas.

   ⚠ SUR UNE IMPRIMANTE NOIR ET BLANC, le dégradé ambre sortira en gris. C'est
   le prix de la couleur, et il est modeste : la marque reste lisible, elle
   perd seulement son éclat. Si un jour une impression te déçoit, c'est ici
   qu'on repassera au noir plein — trois lignes.

   ON NE RECOPIE PAS LE FICHIER : le logo est déjà dans la page, en base64,
   posé par l'écran d'accueil. On le repeint sur une toile pour en obtenir une
   adresse que jsPDF accepte. Rien à télécharger, rien à maintenir en double —
   le jour où tu changes de logo, celui du PDF suit. */
/* ═══ POPPINS, LA POLICE DE LA MARQUE ═══

   jsPDF ne connaît que trois familles : Helvetica, Times, Courier. Aucune
   n'est Poppins, et écrire « Standix » en Helvetica donnait un mot qui
   ressemble à la marque sans en être une.

   On apporte donc la police au document. 153 Ko de TTF, chargés UNE FOIS et
   seulement à l'export : personne ne les paie tant qu'il ne demande pas de PDF.

   ─── LE REPLI EST IMPORTANT ───

   Un réseau coupé, un CDN qui bronche : sans repli, l'export entier échouerait
   pour une question de police. On retombe alors sur Helvetica en gras — le mot
   n'est plus tout à fait la marque, mais le document existe. */
let poppinsPret = null

async function chargerPoppins(doc) {
  if (poppinsPret === false) return false
  try {
    if (!poppinsPret) {
      const r = await fetch('https://cdn.jsdelivr.net/npm/@expo-google-fonts/poppins@0.2.3/500Medium/Poppins_500Medium.ttf')
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const buf = new Uint8Array(await r.arrayBuffer())
      /* En morceaux : `String.fromCharCode` sur 153 000 octets d'un coup
         dépasse la taille d'appel autorisée et lève un RangeError. */
      let bin = ''
      for (let i = 0; i < buf.length; i += 8192) {
        bin += String.fromCharCode.apply(null, buf.subarray(i, i + 8192))
      }
      poppinsPret = btoa(bin)
    }
    doc.addFileToVFS('Poppins-Medium.ttf', poppinsPret)
    doc.addFont('Poppins-Medium.ttf', 'Poppins', 'normal')
    return true
  } catch (e) {
    console.warn('[pdf] Poppins indisponible, repli sur Helvetica :', e?.message || e)
    poppinsPret = false
    return false
  }
}

let logoCache = null

function logoPourPdf() {
  if (logoCache !== null) return logoCache
  try {
    const src = document.getElementById('logo-src')
    if (!src || !src.naturalWidth) return (logoCache = false)

    const t = document.createElement('canvas')
    t.width = src.naturalWidth; t.height = src.naturalHeight
    t.getContext('2d').drawImage(src, 0, 0)
    /* PNG et non JPEG : le logo a un fond transparent, et le JPEG ne sait pas
       le garder — il le remplirait de noir. */
    return (logoCache = { data: t.toDataURL('image/png'), l: t.width, h: t.height })
  } catch (e) {
    /* Une toile « salie » par une image d'une autre origine refuse d'être lue.
       Le logo est en base64 dans la page, donc ce cas ne devrait pas se
       produire — mais un PDF sans logo vaut mieux qu'un export qui échoue. */
    console.warn('[pdf] logo indisponible :', e?.message || e)
    return (logoCache = false)
  }
}

async function chargerJsPDF() {
  if (jsPDFModule) return jsPDFModule
  const m = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm')
  jsPDFModule = m.jsPDF || m.default?.jsPDF || m.default
  return jsPDFModule
}

/* « 0:34 », « 1:07 ». Les bornes des étapes, dans le format de la pastille. */
function bornePdf(s) {
  if (s == null || !isFinite(s)) return ''
  const t = Math.round(s)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

async function exporterProcedurePdf(proc, etapes) {
  if (!proc) return
  const jsPDF = await chargerJsPDF()

  /* A4 en millimètres : c'est l'unité des imprimeurs, et elle évite de
     convertir des points à chaque ligne. */
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const L = 210, MARGE = 18, LARGEUR = L - MARGE * 2
  let y = MARGE

  /* On saute une page quand il ne reste plus de quoi écrire trois lignes.
     Vérifié AVANT chaque bloc plutôt qu'après : une étape coupée entre son
     numéro et son texte est illisible. */
  const place = (h) => {
    if (y + h > 297 - MARGE) { doc.addPage(); y = MARGE }
  }

  // ─── L'EN-TÊTE ───────────────────────────────────────────────────────────
  /* La marque en haut à gauche : 11 mm de haut, soit deux fois la hauteur du
     titre. C'est la première chose qu'on voit sur la feuille, et sur un
     document qui circule — un classeur, un contrôle — c'est ce qui dit d'où il
     vient.

     Le MOT reste noir à côté du dessin coloré : c'est du texte sur une page
     blanche, et il doit se lire comme le reste. Dans l'app il est blanc pour
     la même raison — s'accorder au fond, pas au logo. */
  const logo = logoPourPdf()
  const poppins = await chargerPoppins(doc)
  if (logo) {
    /* ═══ L'ÉQUILIBRE ENTRE LE SIGNE ET LE MOT ═══

       Le logo faisait 11 mm pour un mot de 15 points : le dessin écrasait la
       marque au lieu de l'accompagner. Dans l'app, les deux font à peu près la
       même hauteur d'œil.

       On descend le signe à 8,5 mm et on monte le mot à 19 points. Poppins
       ayant une hauteur d'x généreuse, le mot occupe alors la même bande que le
       dessin — c'est ce rapport-là qu'on lit, pas les tailles absolues. */
    const hL = 8.5, lL = hL * (logo.l / logo.h)
    doc.addImage(logo.data, 'PNG', MARGE, y, lL, hL)
    if (poppins) doc.setFont('Poppins', 'normal')
    else doc.setFont('helvetica', 'bold')
    doc.setFontSize(19)
    doc.setTextColor(0, 0, 0)
    /* `baseline: 'middle'` cale le mot sur le MILIEU du signe. Sans cela il
       s'aligne sur sa ligne de pied, et les deux paraissent décalés d'un
       millimètre — assez pour que ça se voie sans qu'on sache pourquoi. */
    doc.text('Standix', MARGE + lL + 3.2, y + hL / 2, { baseline: 'middle' })
    y += hL + 9
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(20, 20, 22)
  const titre = doc.splitTextToSize(proc.titre || 'Procédure', LARGEUR)
  doc.text(titre, MARGE, y + 6)
  y += 6 + titre.length * 8

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(120, 120, 126)
  /* Le chemin complet, comme sous le titre dans l'app : « Cuisine › Friteuse ».
     Une procédure imprimée circule hors de l'app — sur un mur, dans un
     classeur — et cette ligne est la seule qui dise d'où elle vient. */
  const chemin = [proc.categorie || 'Sans dossier', proc.sous_categorie]
    .filter(Boolean).join(' \u203a ')
  const sous = [chemin,
                new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })]
  doc.text(sous.join('  ·  '), MARGE, y)
  y += 5

  /* Un trait ambre : la seule couleur de la page, et la même que dans l'app. */
  doc.setDrawColor(255, 122, 24)
  doc.setLineWidth(0.8)
  doc.line(MARGE, y, MARGE + 26, y)
  y += 10

  // ─── LES ÉTAPES ──────────────────────────────────────────────────────────
  const liste = (etapes || []).slice().sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0))

  if (!liste.length) {
    doc.setFontSize(11)
    doc.setTextColor(120, 120, 126)
    doc.text('Cette procédure n\u2019a pas encore d\u2019étapes.', MARGE, y)
  }

  /* ═══ LE ROND DIT DÉJÀ LE NUMÉRO ═══

     Si le texte commence par « Étape 4 : », « 4. » ou « 4) », on l'a écrit deux
     fois sur la même ligne — une fois dans le rond, une fois à côté.

     Tes étapes actuelles n'ont pas ce préfixe : l'IA écrit « Entrer la
     transaction VA05 ». Mais elle pourrait le prendre un jour, et une
     procédure importée d'un document en portera souvent un. Le retirer ici
     coûte une expression et évite d'y revenir.

     ON NE RETIRE QUE LE PRÉFIXE, jamais un numéro qui appartient à la phrase :
     « 200 g de farine » ou « transaction VA05 » ne commencent pas par un
     numéro d'ordre suivi d'un séparateur. */
  const sansPrefixe = (t) => (t || '')
    .replace(/^\s*(étape|etape|step)\s*n?[°o]?\s*\d+\s*[:.)\-–—]*\s*/i, '')
    .replace(/^\s*\d{1,2}\s*[.)\-–—]\s+/, '')
    .trim()

  liste.forEach((e, i) => {
    doc.setFontSize(11)
    const texte = doc.splitTextToSize(sansPrefixe(e.texte), LARGEUR - 12)
    const att = e.attention ? doc.splitTextToSize(e.attention, LARGEUR - 16) : null
    place(texte.length * 5.6 + (att ? att.length * 5 + 6 : 0) + 12)

    /* Le numéro dans son rond, comme dans l'app. Le même repère d'un support à
       l'autre : on retrouve l'étape 4 au même endroit sur les deux. */
    doc.setFillColor(242, 242, 244)
    doc.circle(MARGE + 3.4, y + 1.4, 3.4, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(60, 60, 66)
    doc.text(String(i + 1), MARGE + 3.4, y + 2.6, { align: 'center' })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(20, 20, 22)
    doc.text(texte, MARGE + 12, y + 3)
    y += texte.length * 5.6 + 2

    /* La borne de temps, discrète : elle ne sert qu'à retrouver le passage
       dans l'app, et n'a aucun sens pour qui lit sur papier. */
    const d = bornePdf(e.timestamp_video), f = bornePdf(e.fin_video)
    if (d) {
      doc.setFontSize(8.5)
      doc.setTextColor(160, 160, 166)
      doc.text(f ? `${d} – ${f}` : d, MARGE + 12, y + 2)
      y += 4
    }

    if (att) {
      /* Le point de vigilance garde son ambre et son filet, comme dans l'app.
         C'est la seule chose de la page qu'on doit voir sans lire. */
      doc.setDrawColor(255, 122, 24)
      doc.setLineWidth(0.6)
      doc.line(MARGE + 12, y + 1, MARGE + 12, y + 1 + att.length * 5)
      doc.setFontSize(9.5)
      doc.setTextColor(150, 80, 10)
      doc.text(att, MARGE + 15, y + 4.4)
      y += att.length * 5 + 4
    }

    y += 6
  })

  // ─── LE PIED DE PAGE ─────────────────────────────────────────────────────
  const pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(170, 170, 176)
    /* Plus de « Standix » ici : la marque est en haut, en noir et lisible.
       La répéter en gris clair en bas ne servait qu'à combler la ligne. */
    doc.text(`${p} / ${pages}`, L - MARGE, 297 - 10, { align: 'right' })
  }

  /* Un nom de fichier tiré du titre : « Fermeture de caisse.pdf » se retrouve
     dans un dossier, « procedure.pdf » non. On retire ce qu'un système de
     fichiers refuse. */
  const nom = (proc.titre || 'procedure')
    .replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60)
  doc.save(`${nom}.pdf`)
}
window.exporterProcedurePdf = exporterProcedurePdf

/* La procédure ouverte côté Équipe, pour l'export. La Gestion a déjà
   `currentAnalyseData` ; l'Équipe n'avait rien d'équivalent. */
let equipeProcCourante = null

async function openEquipeDetail(procId) {
  const monTour = ++ouvertureCourante
  const perime = () => monTour !== ouvertureCourante
  arreterToutesLesVideos()
  document.querySelectorAll('#equipe-app .screen').forEach(s => s.classList.remove('active'))
  activerAvecNaissance(document.getElementById('e-detail'))
  remonterEnHaut()

  /* Les données sont déjà en mémoire dans la plupart des cas. Mais le cache peut
     manquer : procédure créée depuis le dernier chargement, étapes ajoutées
     entre-temps, ou chargement initial encore en cours. On redemande alors à la
     base, ET on garde le résultat en cache pour la prochaine ouverture.
     C'est ce qui manquait : sans mise en cache, chaque ouverture repartait de
     zéro et une lenteur réseau laissait la liste vide. */
  let proc = allEquipeProcedures.find(p => p.id === procId)
  let etapes = equipeEtapesByProc[procId]

  if (!proc || !etapes || etapes.length === 0) {
    const [{ data: p }, { data: e }] = await Promise.all([
      proc ? Promise.resolve({ data: proc })
           : supabase.from('procedures').select('*').eq('id', procId).maybeSingle(),
      supabase.from('etapes').select('*').eq('procedure_id', procId).order('ordre'),
    ])
    proc = p || proc
    etapes = e || []
    equipeEtapesByProc[procId] = etapes
  }

  // Une autre procédure a-t-elle été ouverte pendant qu'on attendait la base ?
  // Si oui, ce rendu est périmé : l'écrire écraserait le bon.
  if (perime()) return

  if (!proc) {
    document.getElementById('detail-titre').textContent = 'Procédure introuvable'
    document.getElementById('detail-steps').innerHTML = ''
    // Sans ça, le bandeau de la procédure précédente restait affiché ici.
    arreterLecture()
    document.getElementById('lecture-etat')?.closest('.confirm-bar')?.classList.remove('visible')
    return
  }

  /* Déjà consultée, et récemment ? Une consultation vieille de plus de douze
     heures ne compte plus : le bandeau disparaît et le décompte repart, ce qui
     invite à relire. C'est l'intérêt d'une procédure de travail — elle se relit,
     elle ne se coche pas une fois pour toutes. */
  let dejaConsultee = false
  if (equipeLues?.has(procId)) {
    const { data: v } = await supabase.from('validations')
      .select('validated_at').eq('procedure_id', procId).eq('membre_id', currentMembre.id).maybeSingle()
    const quand = v?.validated_at ? new Date(v.validated_at).getTime() : 0
    const fraiche = quand > 0 && (Date.now() - quand) < DELAI_RELECTURE
    dejaConsultee = fraiche ? v.validated_at : false
    // Une lecture périmée remet le chronomètre à zéro : on ne valide pas une
    // relecture avec les secondes d'il y a trois jours.
    if (!fraiche) { lectureProcId = null; lectureSecondes = 0 }
  }

  document.getElementById('detail-titre').textContent = proc.titre
  document.getElementById('detail-subhead').textContent =
    [proc.categorie || 'Sans dossier', proc.sous_categorie].filter(Boolean).join(' \u203a ')
  equipeProcCourante = { proc, etapes: etapes || [] }

  const videoFrame = document.getElementById('detail-video-frame')
  const detailVideoEl = document.getElementById('detail-video')
  /* L'image de la procédure, comme côté gestion. Elle était proposée à la
     création mais n'apparaîssait nulle part pour l'équipe — or c'est justement
     eux qui en ont l'usage : elle dit d'un coup d'œil de quoi il s'agit. */
  const couvEq = document.getElementById('detail-couverture')
  if (couvEq) {
    couvEq.innerHTML = proc.image_url ? `<img data-fichier="${escapeHtml(cheminFichier(proc.image_url))}" alt="">` : ''
    couvEq.style.display = proc.image_url ? 'flex' : 'none'
    signerMedias(couvEq)
  }

  if (proc.video_url) {
    videoFrame.style.display = 'block'
    detailVideoEl.src = (await urlSignee(proc.video_url)) || ''
  } else {
    videoFrame.style.display = 'none'
  }

  const stepsEl = document.getElementById('detail-steps')
  detacherSuiviLecture(detailVideoEl)
  /* ═══ LES CASES REPARTENT VIDES À CHAQUE OUVERTURE ═══

     On reprenait les cases cochées lors d'une visite précédente. C'était une
     erreur de nature : une procédure de travail se REFAIT. Un cuisinier qui
     rouvre « Fermeture de caisse » le lendemain soir la refait en entier — il
     n'a que faire de ce qu'il avait coché hier, et retrouver la liste à moitié
     barrée l'oblige à tout décocher avant de commencer.

     Les cases suivent le geste en cours, pas l'historique. Ce qui est
     historique, c'est la LECTURE — qui reste enregistrée, avec le temps passé :
     c'est ce que la gestion consulte, et ça ne bouge pas. */
  etapesFaites = new Set()
  etapesTotal = (etapes || []).length

  stepsEl.innerHTML = ''
  stepsEl.classList.add('etapes-fil')
  const clipBounds = calculerBornes(etapes, detailVideoEl?.duration)

  ;(etapes || []).forEach((etape, i) => {
    const div = document.createElement('div')
    div.className = 'detail-step'
    const bounds = clipBounds.get(etape.id)
    const hasClip = bounds && proc.video_url
    /* L'étape peut porter une photo du résultat attendu. On la met sous le
       texte, en pleine largeur : c'est souvent elle qui dit le mieux à quoi
       l'on doit arriver. */
    /* La case remplace le numéro. Ce n'est pas un détail d'affichage : cocher
       accompagne le TRAVAIL, là où lire n'accompagne que la lecture. On retrouve
       où l'on en était après une interruption — ce qui arrive tout le temps en
       cuisine — et le temps mesuré devient un temps d'exécution. */
    const faite = etapesFaites.has(etape.id)
    if (faite) div.classList.add('faite')
    div.innerHTML = `
      <button type="button" class="et-coche${faite ? ' f' : ''}" data-etape="${escapeHtml(etape.id)}"
              aria-label="\u00c9tape ${i + 1}"><span class="num">${numeroEtapeDess(i + 1)}</span><span class="ok">${cocheFaiteDess()}</span></button>
      <div class="et-co">
        <p>${escapeHtml(sansNumeroDEtape(etape.texte))}</p>
        <!-- La durée est À L'INTÉRIEUR du bloc de texte, après le paragraphe.
             En voisine du texte, elle en rognait la largeur : la ligne étant
             horizontale, chaque phrase perdait la place de la pastille. -->
        ${hasClip ? `<span class="badge extrait" style="cursor:pointer;">▶ ${formatTime(bounds.start)}–${formatTime(bounds.end)}</span>` : ''}
        ${etape.image_url ? `<div class="detail-step-img"><img data-fichier="${escapeHtml(cheminFichier(etape.image_url))}" alt="" loading="lazy"></div>` : ''}
      </div>
    `
    /* Les mêmes repères que côté gestion, et pour TOUTES les étapes : l'employé
       qui apprend un geste doit pouvoir marquer où il en est, que la procédure
       soit filmée ou écrite. */
    div.style.cursor = 'pointer'
    if (hasClip) {
      div.dataset.debut = bounds.start
      div.dataset.fin = bounds.end
    }
    // Toute la ligne est cliquable, sauf la photo : on ne veut pas lancer la
    // vidéo quand quelqu'un cherche simplement à mieux voir l'image.
    div.onclick = (e) => {
      if (e.target.closest('.detail-step-img, .et-coche')) return
      marquerEtapeEnLecture(div)
      if (hasClip) lireExtrait(detailVideoEl, bounds.start, bounds.end)
    }

    div.querySelector('.et-coche')?.addEventListener('click', (e) => {
      e.stopPropagation()
      basculerEtape(etape.id)
    })

    stepsEl.appendChild(div)
  })

  attacherSuiviLecture(detailVideoEl, stepsEl)
  signerMedias(stepsEl)
  majBandeauCoches()

  /* Une procédure sans étape affichait une zone vide, et on ne savait pas si
     c'était un défaut d'affichage ou une procédure incomplète. Elle le dit
     maintenant. Le cas arrive quand une analyse automatique a échoué : la
     procédure existe, ses étapes n'ont jamais été écrites. */
  // On repart du français à chaque ouverture : une traduction est liée à une
  // consultation, pas au compte.
  procCouranteId = procId
  langueProcCourante = 'fr'
  document.getElementById('trad-note')?.remove()
  majBoutonLangueProc()

  if (!etapes || etapes.length === 0) {
    stepsEl.innerHTML = `<div class="empty-state">
      <h3>Aucune étape</h3>
      <p>Cette procédure n'a pas encore d'étapes. Prévenez votre responsable :
      il doit les ajouter avant que la procédure soit utilisable.</p></div>`
  }

  demarrerLecture(procId, dejaConsultee)
}

/* ═══════════════════════════════════════════════════════════════════════════
   RÉGLAGES DE L'ESPACE ÉQUIPE

   Un même compte peut appartenir à plusieurs entreprises : chaque adhésion est
   une ligne dans la table des membres. La liste se déduit donc directement de
   la base, et un code saisi une fois reste acquis — il crée une ligne qui ne
   disparaît plus, sans rien stocker sur le téléphone.
   ═══════════════════════════════════════════════════════════════════════════ */
let mesAdhesions = []

/* Les valeurs à droite de chaque ligne : on sait ce que contient une page sans
   l'ouvrir. C'est tout l'intérêt de cette grammaire, et elle vaut ici comme
   côté gestion — les deux espaces se ressemblent désormais. */
function peindreReglagesEquipe() {
  const el = (i) => document.getElementById(i)
  const nom = currentMembre?.nom || ''
  if (el('es-nom-affiche')) el('es-nom-affiche').textContent = nom || 'Votre compte'
  if (el('es-initiales')) el('es-initiales').textContent = initialesEtab(nom)
  if (el('es-email-affiche')) el('es-email-affiche').textContent = el('es-email')?.value || '\u2014'

  /* Le compteur `es-nb-ent` a disparu avec sa ligne : la carte « Vos
     établissements » montre les entreprises elle-même, une par cercle. */
  const l = LANGUES.find(x => x.code === langueApp)
  if (el('es-langue-val')) el('es-langue-val').textContent = l?.nom || 'Fran\u00e7ais'
}

window.openEquipeSettings = async function() {
  showEquipeScreen('e-settings')
  rendreChoixLangueApp()
  peindreReglagesEquipe()
  peindreAppareils()
  document.getElementById('es-nom').value = currentMembre?.nom || ''
  const { data: { user } } = await supabase.auth.getUser()
  document.getElementById('es-email').value = user?.email || ''
  chargerMesEntreprises()
}

async function chargerMesEntreprises() {
  const el = document.getElementById('es-entreprises')
  if (!el) return
  el.innerHTML = '<div class="note">Chargement…</div>'

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) { el.innerHTML = '<div class="note">Session expirée.</div>'; return }

  const { data, error } = await supabase
    .from('membres').select('*, entreprises(id, nom)').eq('user_id', user.id)

  if (error) { el.innerHTML = `<div class="note">Erreur : ${escapeHtml(error.message)}</div>`; return }
  mesAdhesions = data || []

  if (!mesAdhesions.length) {
    el.innerHTML = "<div class=\"note\">Vous n'appartenez à aucune entreprise.</div>"
    return
  }

  el.innerHTML = mesAdhesions.map(a => {
    const actuelle = a.id === currentMembre?.id
    const nom = a.entreprises?.nom || 'Entreprise'
    const role = a.role === 'gestion' ? 'Gestion' : 'Équipe'
    return `
      <div class="ent-ligne${actuelle ? ' actuelle' : ''}" data-membre="${a.id}">
        <div class="ent-info">
          <div class="ent-nom">${escapeHtml(nom)}</div>
          <div class="ent-role">${role}${actuelle ? ' · entreprise active' : ''}</div>
        </div>
        ${actuelle
          ? '<span class="ent-marque"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>'
          : '<span class="ent-basculer">Basculer</span>'}
      </div>`
  }).join('')
}

/* ═══════════════════════════════════════════════════════════════════════════
   LES OFFRES

   Le prix suit le nombre d'établissements, jamais le nombre de procédures :
   limiter les procédures pousserait à en écrire moins, alors que l'outil ne vaut
   que si l'on en écrit beaucoup. Ce qui monte en gamme, c'est l'analyse vidéo —
   la seule chose qui coûte réellement de l'argent à chaque usage.

   Chaque offre porte une icône dans la langue des quatre modes de création, et
   le nombre de fiches dessinées dit la même chose que le prix.
   ═══════════════════════════════════════════════════════════════════════════ */

const AV_O = 'rgba(255,255,255,0.78)'
const LG_O = 'rgba(255,255,255,0.32)'


/* Les paliers suivent le NOMBRE DE MEMBRES. Chaque offre annonce deux ou trois
   avantages PHARES, détaillés — ce qu'on y gagne, en une phrase — puis le reste
   sur une seule ligne. Une liste à puces de dix lignes ne se lit pas ; deux
   promesses expliquées, oui. */
/* Les avantages sont les MÊMES pour toutes les offres. Elles ne diffèrent que
   par la taille de l'équipe.

   Découper les fonctions par palier obligerait un restaurant de quatre
   personnes à payer le prix d'une chaîne pour traduire ses procédures. Le prix
   suit ce qui coûte vraiment — le nombre de gens qui s'en servent — et rien
   d'autre. C'est aussi plus simple à vendre : il n'y a qu'une question à se
   poser, et c'est celle dont on connaît déjà la réponse. */
/* Mensuel ou annuel. Le choix vit DANS la carte de l'offre, pas au-dessus :
   quand il y aura quatre paliers, chacun portera le sien. Un interrupteur
   unique devrait piloter toutes les offres à la fois, ce qui ne veut rien dire
   quand on n'en regarde qu'une. */
/* ═══ LE MENSUEL EN PREMIER ═══

   Le défaut était `annuel`. On ouvrait donc la page sur un prix engagé pour
   douze mois, sans l'avoir demandé — et le montant affiché n'était pas celui
   qu'on paierait en cliquant sans rien changer.

   Le mensuel est l'offre par défaut : sans engagement, réversible. L'annuel se
   choisit, il ne s'impose pas. */
let rythmeChoisi = 'mensuel'

/* `AVANTAGES`, `PICTOS` et `AUSSI` ont été retirés avec l'ancienne carte : la
   nouvelle liste ses inclus directement, en lignes à coche, sans pictogramme.
   Trois tableaux de données pour un affichage qui n'existe plus, c'était du
   poids mort au milieu du fichier. */



/* ═══════════════════════════════════════════════════════════════════════════
   LES PALIERS SUIVENT LE NOMBRE DE MEMBRES

   LE QUOTA D'ANALYSES EST MENSUEL, ET IL SE RÉINITIALISE. Il était TOTAL — une
   fois épuisé, plus jamais d'IA. Le client continuait de payer pour un produit
   dont la fonction principale s'était arrêtée : au troisième mois, il ne voyait
   plus ce qu'il payait.

   Le coût de ce changement est faible parce que l'usage réel s'effondre après
   le premier mois : un gérant documente tout son établissement en quelques
   semaines, puis deux ou trois procédures par mois. Filmer, relire et corriger
   prend un quart d'heure par fiche — c'est le temps humain qui limite, pas le
   compteur.

   Les analyses non utilisées NE SE REPORTENT PAS. À écrire sur la page, sinon
   quelqu'un viendra réclamer six mois d'un coup.
   ═══════════════════════════════════════════════════════════════════════════ */
const OFFRES = [
  /* Le prix mensuel est celui qu'on affiche ; l'annuel se règle en une fois et
     revient à vingt pour cent de moins.

     Le prix par membre BAISSE à chaque palier — 13,80 €, 8,60 €, 5,97 €, 4,99 €.
     C'est ce qui donne envie de monter : le client y gagne toujours, et nos
     coûts ne suivent pas la même pente puisque le nombre d'analyses double
     quand les membres triplent.

     ═══ POURQUOI ESSENTIEL EST À 69 ET NON 49 ═══

     Une analyse coûte 0,71 € — cinq minutes de vidéo au tarif d'Azure, le
     plafond que l'app accepte. Trente analyses par mois font donc 21,45 € de
     coût variable.

     À 49 € payés à l'année, avec la remise de 20 %, la recette tombait à 39 €
     par mois pendant que le coût restait le même : le pire cas était NÉGATIF
     de 52 € sur l'année. La remise réduit ce qu'on encaisse, jamais ce qu'on
     dépense.

     À 69 €, ce même pire cas rapporte 137 €. L'écart avec Équipe se creuse —
     13,80 € par membre contre 6,60 — et c'est tant mieux : il rend le passage
     à l'offre supérieure évident.

     ═══ ET ÉQUIPE À 129 ═══

     Même raisonnement, un cran plus haut. À 99 € payés à l'année, le pire cas
     ne laissait que 164 € sur douze mois — soit 14 % — parce que la remise de
     vingt pour cent réduit la recette sans toucher aux 60 analyses mensuelles.
     À 129, il remonte à 447 €.

     La remise annuelle reste à 20,2 %, alignée sur les trois autres paliers :
     la grille garde sa logique, seul le niveau change.

     Pro et Réseau ne bougent pas — ils étaient déjà largement positifs. */
  { cle: 'essentiel',  nom: 'Essentiel',  max: 5,   analyses: 30,  prix: 69,  an: 660,  stripe: true },
  { cle: 'equipe',     nom: '\u00c9quipe',     max: 15,  analyses: 60,  prix: 129, an: 1236, stripe: true },
  { cle: 'pro',        nom: 'Pro',        max: 40,  analyses: 120, prix: 239, an: 2268, stripe: true },
  { cle: 'reseau',     nom: 'R\u00e9seau',     max: 100, analyses: 250, prix: 499, an: 4788, stripe: true },
  { cle: 'entreprise', nom: 'Entreprise', max: Infinity, prix: null,
    devis: "Au-del\u00e0 de cent personnes, on en discute : accompagnement \u00e0 la mise " +
           "en place, interlocuteur d\u00e9di\u00e9, engagement de disponibilit\u00e9 \u00e9crit." },
]


function nombreDeMembres() {
  return Math.max(1, (cachedMembres || []).length)
}

/* ═══════════════════════════════════════════════════════════════════════════
   LE PICTOGRAMME DE L'OFFRE

   Une plaque ronde en tête de carte, à gauche du nom. Elle ne décore pas :
   elle dit d'un coup d'œil de quelle TAILLE d'équipe on parle — une personne,
   un binôme, un groupe, un réseau de sites.

   ⚠ Les dessins sont écrits POUR UNE BOÎTE DE 24, mais `logoOrIc` est déclaré
     en `userSpaceOnUse` sur 24 × 24 : au-delà, tout reçoit la couleur de fin.
     La plaque affiche le dessin à 22 px, donc on reste dans les clous. Un jour
     où elle grandirait, il faudra passer à `orLibre`.

   Il vit à côté du tableau des offres plutôt que dedans : `OFFRES` porte des
   prix et des limites, des choses qui se discutent. Un tracé SVG n'a rien à
   y faire. */
function iconeOffre(cle) {
  const t = 'stroke="url(#logoOrIc)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"'
  const dessins = {
    // Une personne : l'offre d'un artisan et de ses quelques mains.
    essentiel: `<circle cx="12" cy="8.2" r="3.4" ${t}/>
                <path d="M5.6 19.4a6.4 6.4 0 0 1 12.8 0" ${t}/>`,
    // Deux personnes côte à côte.
    equipe: `<circle cx="9.2" cy="8.6" r="3.1" ${t}/>
             <path d="M3.6 19.2a5.6 5.6 0 0 1 11.2 0" ${t}/>
             <path d="M16.2 6.2a3 3 0 0 1 0 5.6M17 14.2a5.4 5.4 0 0 1 3.4 5" ${t}/>`,
    // Un groupe : trois têtes, celle du milieu en avant.
    pro: `<circle cx="12" cy="7.4" r="3" ${t}/>
          <path d="M6.8 18.6a5.2 5.2 0 0 1 10.4 0" ${t}/>
          <path d="M5.6 9.4a2.5 2.5 0 1 0 0-.1M2.6 17.4a4.4 4.4 0 0 1 2.6-3.5" ${t}/>
          <path d="M21.4 17.4a4.4 4.4 0 0 0-2.6-3.5" ${t}/>
          <circle cx="18.6" cy="9.3" r="2.5" ${t}/>`,
    /* ═══ LE RÉSEAU, REDESSINÉ ═══

       Le premier essai avait trois anneaux évidés de rayon 2,6 et des traits
       qui leur rentraient dedans : à 22 px, les traits touchaient les cercles
       et l'ensemble faisait une tache. Deux corrections.

       Les nœuds sont PLEINS. Un anneau de 2,6 px de rayon avec un trait de
       1,7 ne laisse qu'un point de vide au centre — autant le remplir : le
       disque se lit, l'anneau bavait.

       Les liaisons S'ARRÊTENT AVANT les nœuds. Elles courent de 8,3 à 15,7
       en ordonnée, soit un vide de deux pixels de part et d'autre. C'est ce
       blanc qui fait qu'on voit trois objets reliés plutôt qu'un Y massif.

       Le nœud du haut est un demi-pixel plus gros : c'est le parent, et la
       hiérarchie se lit sans qu'on ait à l'expliquer. */
    reseau: `<path d="M12 8.6v3.1M12 11.7 7.4 15.2M12 11.7l4.6 3.5" ${t}/>
             <circle cx="12" cy="6.2" r="2.5" fill="url(#logoOrIc)" stroke="none"/>
             <circle cx="6.1" cy="17.3" r="2.2" fill="url(#logoOrIc)" stroke="none"/>
             <circle cx="17.9" cy="17.3" r="2.2" fill="url(#logoOrIc)" stroke="none"/>`,
    // Un bâtiment : au-delà du réseau, c'est une organisation.
    entreprise: `<path d="M4.4 20.4V6.2a1.6 1.6 0 0 1 1.6-1.6h6.4a1.6 1.6 0 0 1 1.6 1.6v14.2" ${t}/>
                 <path d="M14 10.4h4a1.6 1.6 0 0 1 1.6 1.6v8.4M2.6 20.4h18.8" ${t}/>
                 <path d="M7.6 8.6h3M7.6 12.2h3M7.6 15.8h3" ${t}/>`,
  }
  return `<svg viewBox="0 0 24 24" fill="none">${dessins[cle] || dessins.equipe}</svg>`
}

function offrePourTaille(n) {
  return OFFRES.find(o => n <= o.max) || OFFRES[OFFRES.length - 1]
}

function planActuel() {
  /* ═══ DEUX CONDITIONS, PAS UNE ═══

     Cette fonction se rabattait sur la colonne `plan` quand `abonnement_palier`
     était vide. Or `plan` vaut « pro » sur TOUTES les entreprises — c'est un
     vestige qui n'a jamais été mis à jour. Résultat : n'importe quel compte,
     même en essai, se croyait abonné au palier Pro. Et comme il n'a pas de
     client Stripe derrière, « Gérer mon abonnement » échouait en 400.

     On ne lit donc plus que `abonnement_palier`, et seulement si le statut dit
     que l'abonnement est actif. Un palier sans statut actif, c'est un
     abonnement résilié ou jamais payé. */
  if (cachedEntreprise?.abonnement_statut !== 'actif') return ''
  return (cachedEntreprise?.abonnement_palier || '').toLowerCase()
}

/* Le prix ramené au membre : c'est le seul chiffre qu'un restaurateur peut
   comparer à quelque chose qu'il connaît — un café, une heure de main-d'œuvre. */
function prixParMembre(o, n) {
  if (o.prix === null || !n) return null
  return (o.prix / n).toFixed(2).replace('.', ',')
}

/* ═══════════════════════════════════════════════════════════════════════════
   LA CARTE D'UNE OFFRE

   Refondue sur le modèle que tu m'as montré. Cinq changements de fond :

   ① LE NOM PASSE AVANT, EN PETIT. « Équipe » n'est pas un argument, c'est une
      étiquette. Il annonce, il ne vend pas.

   ② LE PRIX EST ÉNORME. 46 px, seul sur sa ligne, avec son unité en petit à
      côté. C'est le premier chiffre qu'on cherche ; le cacher en haut à droite
      obligeait à le chasser du regard.

   ③ TOUT DEVIENT UNE LIGNE À COCHE. Membres, analyses, langues, procédures :
      la même forme pour tout ce qui est inclus. Les pictogrammes et les cadres
      créaient trois niveaux de lecture là où il n'en faut qu'un.

   ④ LE GRAS PORTE LE CHIFFRE, PAS LA PHRASE. « Jusqu'à **5 membres** » plutôt
      que « **Jusqu'à 5 membres** » : l'œil accroche ce qui varie d'une offre à
      l'autre, et saute le reste.

   ⑤ L'ANNUEL DEVIENT UNE LIGNE DE TEXTE. Deux gros boutons radio pour un choix
      qu'on fait une fois occupaient un quart de la carte.
   ═══════════════════════════════════════════════════════════════════════════ */
/* Le rythme affiché diffère-t-il de celui qu'on paie ? C'est la seule
   condition qui réveille le bouton d'une offre déjà souscrite.

   `rythmeActuel` vient de l'abonnement en base ; sans lui, on suppose le
   mensuel — c'est le cas de tous les abonnements existants, et supposer
   l'annuel proposerait à tort de « passer au mensuel ». */
function changementRythme(opts) {
  const paye = opts.rythmeActuel || 'mensuel'
  return rythmeChoisi !== paye
}

function carteOffre(o, opts = {}) {
  const n = opts.membres || 0
  const pm = opts.detaille ? prixParMembre(o, n) : null
  const surDevis = o.prix === null
  /* Le prix mensuel équivalent quand on paie à l'année : vingt pour cent de
     moins. C'est lui qu'on montre en grand si l'annuel est choisi. */
  /* ═══ LE PRIX MENSUEL DÉCOULE DU TARIF ANNUEL RÉEL ═══

     `o.an` porte le vrai montant facturé — 660, 1236, 2268, 4788. Ce sont les
     tarifs de Stripe, pas une remise calculée.

     On divise donc par douze plutôt que d'appliquer −20 % au prix mensuel : les
     deux donnent le même résultat aujourd'hui, mais si tu changes un tarif
     annuel sans toucher au mensuel, seule cette formule reste juste.

     Sans `o.an` — une offre nouvelle, mal renseignée — on retombe sur la
     remise de vingt pour cent. */
  const prixAffiche = surDevis ? null
    : (rythmeChoisi === 'annuel'
        ? Math.round((o.an || o.prix * 0.8 * 12) / 12)
        : o.prix)

  /* Les inclus, dans l'ordre de ce qu'on compare : d'abord ce qui change d'une
     offre à l'autre, ensuite ce qui est commun à toutes. */
  const inclus = [
    o.max === Infinity ? 'Membres <b>illimités</b>' : `Jusqu'à <b>${o.max} membres</b>`,
    o.analyses ? `<b>${o.analyses} analyses vidéo IA</b> par mois` : null,
    'Procédures <b>illimitées</b>',
    /* « Chacun lit dans sa langue » promettait toutes les langues. Nommer les
       trois est plus honnête, et plus vendeur dans le tri-frontière bâlois où
       les trois cohabitent dans la même équipe. */
    'En <b>français, anglais et allemand</b>',
    '<b>Toutes</b> les fonctionnalités',
  ].filter(Boolean)

  return `<div class="offre-carte${opts.classe || ''}">
    <!-- Le ruban a ete retire. « Populaire » n avait pas de sens — on choisit
         son offre sur le nombre de membres, pas par gout — et « En cours »
         doublait le bouton, qui dit deja « Votre abonnement actuel ». -->
    <!-- Le logo en filigrane a ete retire : pose derriere le prix, il faisait
         decoratif plutot que soigne. La carte se tient par sa matiere et sa
         typographie. -->

    <!-- ═══ LA LIGNE DE TÊTE ═══
         Plaque ronde et nom sur la même ligne. Le nom seul flottait en haut
         d'une carte de six cents pixels ; la plaque lui donne un point
         d'appui et dit la taille d'équipe avant qu'on lise le chiffre. -->
    <div class="offre-tete">
      <span class="offre-plaque">${iconeOffre(o.cle)}</span>
      <div class="offre-nom">${o.nom}</div>
    </div>

    <!-- LE PRIX SUIT LE RYTHME CHOISI. Il affichait toujours le tarif MENSUEL :
         basculer sur Annuel ne changeait rien au grand chiffre, on lisait 69
         alors qu on allait payer 55 par mois. Le montant est arrondi a l euro. -->
    <div class="offre-prix">
      ${surDevis ? `<span class="v">Sur devis</span>`
        : `<span class="v">${prixAffiche} €</span>
           <span class="u">/ mois, hors taxes${rythmeChoisi === 'annuel' ? '<br>factur\u00e9 \u00e0 l\u2019ann\u00e9e' : ''}</span>`}
    </div>

    <!-- Un filet, pas une marge : il sépare ce qu'on paie de ce qu'on reçoit.
         Sur une carte aussi haute, un simple blanc laissait les deux blocs
         se confondre. -->
    <div class="offre-filet"></div>
    <!-- ═══ « SOIT X € PAR PERSONNE » A ÉTÉ RETIRÉ ═══

         Il divisait le prix de l'offre par le nombre RÉEL de membres. Sur une
         entreprise de 5 personnes abonnée à Réseau, cela donnait 99,80 € par
         tête — le chiffre qui donne envie de résilier.

         Et il poussait dans le mauvais sens : la même entreprise voyait
         « 13,80 € » sous Essentiel et « 99,80 € » sous Réseau. L'argument
         censé donner envie de MONTER poussait à descendre.

         Il n'a de sens que si l'offre correspond à la taille de l'équipe —
         c'est-à-dire dans le cas où on n'a pas besoin de le dire. -->

    <div class="offre-inclus">
      <!-- Coche ronde et pleine : un caractere de coche nu se lisait comme du
           texte, la pastille en fait un signe. -->
      ${inclus.map(t => `<div class="offre-li">
        <i><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11"
             fill="rgba(4,4,6,0.78)" stroke="rgba(255,173,51,0.46)" stroke-width="1"/>
           <path d="M7.6 12.3l3 3 5.8-6.4" stroke="#FDA81E" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round"/></svg></i>
        <span>${t}</span></div>`).join('')}
    </div>

    <!-- Rappel de l offre annuelle, avec son etiquette. Les onglets du haut
         commandent, cette ligne rappelle ce qu on gagne a basculer. Elle
         disparait quand l annuel est deja choisi. -->
    ${!surDevis && rythmeChoisi === 'mensuel' ? `
    <div class="offre-annuel-note">
      <span class="et"><svg viewBox="0 0 24 24" fill="none" stroke="#FDA81E"
        stroke-width="1.7" stroke-linejoin="round"><path d="M3.4 12.6V4.8a1.4 1.4 0 0 1 1.4-1.4h7.8
        L21 11.8a1.4 1.4 0 0 1 0 2L14 20.8a1.4 1.4 0 0 1-2 0Z"/>
        <circle cx="8" cy="8" r="1.5" fill="#FDA81E" stroke="none"/></svg></span>
      <!-- Le même calcul que le prix de tête : on divise le tarif annuel réel,
           sinon cette ligne annoncerait un montant que la bascule ne donnerait
           pas. -->
      ou <b>${Math.round((o.an || o.prix * 0.8 * 12) / 12)} € par mois</b> en payant à l’année
    </div>` : ''}
    ${surDevis ? `<div class="offre-annuel-fixe">${o.devis || 'Les mêmes fonctionnalités, sans exception.'}</div>` : ''}

    ${opts.cta ? `<button type="button" class="offre-cta${opts.enCours ? ' encours' : ''}"
      ${opts.enCours && !changementRythme(opts) ? 'disabled' : ''} data-offre="${o.cle}">${
      /* ═══ SAUF POUR CHANGER DE RYTHME ═══

         L'offre en cours désactivait son bouton : rien à repayer, en effet.
         Mais depuis que le choix mensuel / annuel s'affiche aussi sur elle,
         quelqu'un peut vouloir passer à l'année SANS changer de formule.

         Le bouton se réveille alors, et annonce le nouveau montant. C'est le
         seul changement qu'un client satisfait veut faire — et vingt pour cent
         de trésorerie d'avance. */
      opts.enCours && changementRythme(opts)
        ? (rythmeChoisi === 'annuel'
            ? `Passer \u00e0 l'ann\u00e9e \u00b7 ${o.an || Math.round(o.prix * 0.8 * 12)} \u20ac`
            : `Passer au mensuel \u00b7 ${o.prix} \u20ac par mois`)
      : opts.enCours ? opts.cta
      : o.prix === null ? opts.cta
      /* Le bouton annonce EXACTEMENT ce qui sera pr\u00e9lev\u00e9. \u00ab Activer \u00bb tout court
         laisse d\u00e9couvrir le montant sur la page de paiement \u2014 c'est l\u00e0 qu'on
         renonce. */
      : rythmeChoisi === 'annuel'
        /* Le total facturé, tel qu'il est déclaré dans l'offre. Le grand prix
           en découle par division : les deux ne peuvent plus diverger. */
        ? `Activer \u00b7 ${o.an || Math.round(o.prix * 0.8 * 12)} \u20ac par an`
        : `Activer \u00b7 ${o.prix} \u20ac par mois`
    }<span class="fl"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12h14"/>
        <polyline points="13.2 6.4 19 12 13.2 17.6"/></svg></span></button>` : ''}
    <!-- ⚠ « GÉRER OU RÉSILIER » N'EST PLUS ICI. C'est devenu une ligne de
         réglage sous la carte, peinte dans abo-gerer par renderAbonnements.
         Sous le bouton d'action, les deux gestes opposés se touchaient.

         ⚠ ET AUCUN ACCENT GRAVE DANS CE COMMENTAIRE. Il est à l'intérieur
           d'un gabarit de chaîne : le premier accent grave le refermerait,
           et le reste de la carte deviendrait du code. -->
  </div>`
}

window.renderAbonnements = function() {
  const n = nombreDeMembres()
  const actuel = planActuel()

  /* ═══ CE QU'ON MONTRE EN PREMIER ═══

     Quand on paie déjà, c'est SON offre qui vient en tête — pas celle que la
     taille de l'équipe suggère. Un client qui a pris « Équipe » et qui voit
     « Essentiel » en vedette croit s'être trompé, ou avoir été rétrogradé.

     Sans abonnement, on revient à la recommandation par la taille : c'est ce
     qu'il y a de plus utile à quelqu'un qui n'a pas encore choisi. */
  const payee = actuel ? OFFRES.find(o => o.cle === actuel) : null
  const mienne = payee || offrePourTaille(n)

  /* ═══ UNE SEULE PHRASE, PAS UN TITRE PLUS UN SOUS-TITRE ═══

     « Vous êtes 5 membres chez M Entreprise » occupait deux lignes en gros, et
     répétait ce que la page Gérer l'équipe dit déjà. Le titre « Abonnement » de
     l'en-tête suffit à nommer l'écran.

     Reste une phrase qui oriente : ce qu'on paie, ou ce qui conviendrait. */
  const sous = document.getElementById('abo-sous')
  if (sous) {
    sous.innerHTML = payee
      ? `Vous \u00eates abonn\u00e9 \u00e0 l'offre <b>${mienne.nom}</b>.`
      : `Choisissez le plan qui correspond<br>\u00e0 la fa\u00e7on dont votre \u00e9quipe travaille.`
  }

  /* Les deux onglets de rythme reflètent le choix courant. */
  document.querySelectorAll('#abo-rythme .abo-ryt').forEach(b => {
    b.classList.toggle('on', b.dataset.rythme === rythmeChoisi)
  })

  const estActuelle = mienne.cle === actuel
  document.getElementById('abo-vedette').innerHTML = carteOffre(mienne, {
    classe: ' vedette' + (estActuelle ? ' actuelle' : ''),
    enCours: estActuelle,
    gerer: estActuelle,
    /* « Choisir <offre> » : le geste, sans le mot argent. « Essayer
       gratuitement » aurait été plus doux mais l'essai n'est pas systématique,
       et « Payer » ferait fuir quelqu'un à qui l'on promet 14 jours d'essai
       trois lignes plus bas. */
    cta: estActuelle ? 'Votre abonnement actuel'
      : (mienne.prix === null ? 'Nous \u00e9crire' : 'Choisir ' + mienne.nom),
    annuel: !estActuelle,
    membres: n,
    detaille: true,
  })

  /* ═══ GÉRER OU RÉSILIER, SOUS LA CARTE ═══

     Une ligne de réglage du même moule que celles des Réglages — `reg-groupe`,
     `reg-ligne`, plaque, libellé, chevron. Aucune classe nouvelle : cette
     ligne fait le même geste que ses cousines, elle doit s'y ressembler.

     Elle n'apparaît que si l'on paie vraiment. Sans abonnement, « résilier »
     n'a rien à résilier, et le portail Stripe répondrait en erreur. */
  const gerer = document.getElementById('abo-gerer')
  if (gerer) {
    gerer.innerHTML = estActuelle ? `
      <div class="reg-groupe">
        <button type="button" class="reg-ligne" data-abo-gerer>
          <span class="reg-ic"><svg viewBox="0 0 24 24" fill="none">
            <path d="M4 7.4h9M17.4 7.4h2.6M4 16.6h2.6M11 16.6h9"
                  stroke="url(#logoOrIc)" stroke-width="1.7" stroke-linecap="round"/>
            <circle cx="15.2" cy="7.4" r="2.4" stroke="url(#logoOrIc)" stroke-width="1.7"/>
            <circle cx="8.8" cy="16.6" r="2.4" stroke="url(#logoOrIc)" stroke-width="1.7"/>
          </svg></span>
          <span class="reg-nm">G\u00e9rer ou r\u00e9silier mon abonnement</span>
          <span class="fl">\u203a</span>
        </button>
      </div>` : ''
  }

  /* UN SEUL ENFANT DANS LA LISTE. Le repli se fait en passant la hauteur de
     `0fr` à `1fr` — une bascule qui suppose une seule piste. Avec une carte par
     enfant, chacune créait sa propre piste et rien ne se refermait. On enveloppe
     donc les cartes. */
  document.getElementById('abo-liste').innerHTML = '<div class="abo-repli">' + OFFRES
    .filter(o => o.cle !== mienne.cle)
    .map(o => carteOffre(o, {
      classe: o.cle === actuel ? ' actuelle' : '',
      cta: o.cle === actuel ? 'Votre abonnement actuel'
        : (o.prix === null ? 'Nous \u00e9crire' : 'Choisir ' + o.nom),
      /* Développées elles aussi : quelqu'un qui déplie les autres offres veut
         comparer, et comparer des titres seuls ne dit rien. */
      membres: n,
    })).join('') + '</div>'

  const rappel = document.getElementById('abo-actuel')
  if (rappel) {
    const o = OFFRES.find(x => x.cle === actuel)
    rappel.textContent = o
      ? (o.prix === null ? `Offre ${o.nom}` : `Offre ${o.nom} \u00b7 ${o.prix} \u20ac par mois`)
      : `${mienne.nom} conseill\u00e9e`
  }

  /* Les cartes viennent d'être construites : on y pose le logo orange. Sans
     cet appel, leurs balises restent vides — la pose initiale a eu lieu au
     chargement du document, quand elles n'existaient pas. */
  poserLogosOr()
}

/* La cascade d'entrée ne joue qu'à l'ouverture : la classe est posée ici, et
   retirée une seconde plus tard — le temps que les cinq blocs soient arrivés. */
function marquerAboNeuf() {
  const p = document.getElementById('p-abonnement')
  if (!p) return
  p.classList.add('abo-neuf')
  setTimeout(() => p.classList.remove('abo-neuf'), 1000)
}

document.getElementById('ouvrir-abonnement')?.addEventListener('click', () => {
  document.getElementById('abo-liste')?.classList.remove('ouvert')
  const b = document.getElementById('abo-autres')
  if (b) {
    /* ═══ DEUX DÉFAUTS CORRIGÉS ICI ═══

       ① `part` n'était pas retirée : le bouton revenait avec son opacité à
          zéro et sa marge négative — invisible, mais occupant sa place.

       ② `textContent` écrasait le chevron SVG posé dans le balisage. Au second
          passage sur la page, le bouton perdait sa flèche. On ne touche plus
          au contenu : le libellé est dans `index.html` et n'a pas à changer. */
    b.classList.remove('part')
    b.style.display = 'flex'
  }
  renderAbonnements()
  showGestionScreen('p-abonnement')
})

document.getElementById('abo-autres')?.addEventListener('click', (e) => {
  document.getElementById('abo-liste')?.classList.add('ouvert')
  /* ═══ LE BOUTON S'EFFACE, IL NE DISPARAÎT PAS ═══

     `display:none` le retirait instantanément : un trou apparaissait là où il
     était, et les cartes montaient dans un espace qui venait de se vider d'un
     coup.

     La classe `part` le fait remonter en s'effaçant, et sa marge négative
     referme progressivement la place qu'il occupait. `display:none` est posé
     après coup — sinon il reste focusable au clavier une fois invisible. */
  const b = e.currentTarget
  b.classList.add('part')
  setTimeout(() => { b.style.display = 'none' }, 340)
})

document.getElementById('p-abonnement')?.addEventListener('click', async (e) => {
  /* ═══ GÉRER OU RÉSILIER ═══

     On ouvre le portail de Stripe : résiliation, changement de carte, factures,
     changement d'offre. Écrire ce formulaire nous-mêmes voudrait dire gérer les
     remboursements au prorata et les factures conformes — un terrain où
     l'erreur coûte cher.

     L'accès reste ouvert jusqu'à la fin de la période payée : c'est ce que
     Stripe fait par défaut, et c'est juste. */
  const g = e.target.closest('[data-abo-gerer]')
  if (g) {
    /* Sans client Stripe, il n'y a pas de portail à ouvrir : la fonction
       serveur répondait 400 et l'app affichait une erreur brute. On le dit
       nous-mêmes, en clair, avant d'appeler. */
    if (!cachedEntreprise?.stripe_client_id) {
      await confirmDialog({
        titre: 'Aucun abonnement à gérer',
        message: "Ce compte n'a pas encore d'abonnement payant. Choisissez une "
          + "offre pour en activer un.",
        confirmer: 'Compris', annuler: 'Fermer', danger: false,
      })
      return
    }
    g.disabled = true
    const av = g.textContent
    g.textContent = 'Ouverture\u2026'
    try {
      const rep = await fetch(`${SUPABASE_URL}/functions/v1/stripe-portail`, {
        method: 'POST',
        headers: await enTeteFonction(),
        body: JSON.stringify({
          entreprise_id: currentMembre.entreprise_id,
          retour: window.location.origin + window.location.pathname,
        }),
      })
      const data = await rep.json()
      if (!rep.ok || !data.url) throw new Error(data.error || 'Le portail n\u2019a pas pu s\u2019ouvrir.')
      window.location.href = data.url
    } catch (err) {
      g.disabled = false
      g.textContent = av
      await confirmDialog({
        titre: 'Gestion indisponible',
        message: String(err?.message || err),
        confirmer: 'Fermer',
        annuler: null,
        danger: false,
      })
    }
    return
  }

  /* Le choix du rythme : on retient et on redessine. Rien d'autre — c'est le
     bouton d'action qui déclenche le paiement. */
  const r = e.target.closest('[data-rythme]')
  if (r) {
    rythmeChoisi = r.dataset.rythme
    renderAbonnements()
    if (navigator.vibrate) navigator.vibrate(6)
    return
  }

  const b = e.target.closest('[data-offre]')
  if (!b) return
  const o = OFFRES.find(x => x.cle === b.dataset.offre)
  if (!o || o.cle === planActuel()) return

  /* ═══ ON NE DESCEND PAS SOUS SA PROPRE ÉQUIPE ═══

     Passer de Pro à Essentiel avec douze personnes mettrait sept d'entre elles
     dehors — sans qu'elles aient rien fait, et sans qu'on les ait prévenues.

     C'est précisément ce que le portail Stripe NE SAIT PAS faire : il ne
     connaît ni vos membres ni leur nombre. C'est pour cela que le changement
     d'offre doit se faire ici, et pas là-bas. */
  const combien = nombreDeMembres()
  if (o.max !== Infinity && combien > o.max) {
    await confirmDialog({
      titre: `Votre \u00e9quipe est trop grande pour ${o.nom}`,
      message: `Vous \u00eates ${combien} membres, et cette offre en autorise ${o.max}.\n\n` +
        `Retirez d'abord ${combien - o.max} personne${combien - o.max > 1 ? 's' : ''} ` +
        `dans Param\u00e8tres \u2192 Votre \u00e9quipe, puis revenez changer d'offre.`,
      confirmer: 'J\u2019ai compris',
      annuler: null,
      danger: false,
    })
    return
  }

  /* Les offres qui n'ont pas encore de tarif Stripe : on écrit, on ne fait pas
     semblant. Un bouton qui ouvre une page de paiement vide coûte plus cher
     qu'un bouton qui dit « écrivez-nous ». */
  if (!o.stripe) {
    const ok = await confirmDialog({
      titre: o.prix === null ? 'Offre Entreprise' : `Offre ${o.nom}`,
      message: o.prix === null
        ? "Cette offre se construit avec vous. \u00c9crivez-nous et nous revenons vers vous rapidement."
        : `${o.nom} \u00e0 ${o.prix} \u20ac par mois. \u00c9crivez-nous pour l'activer, nous r\u00e9pondons dans la journ\u00e9e.`,
      confirmer: 'Nous \u00e9crire',
      annuler: 'Fermer',
    })
    if (ok) window.location.href = 'mailto:Standix.app@gmail.com?subject=' +
      encodeURIComponent('Offre ' + o.nom)
    return
  }

  /* ═══ LE PAIEMENT ═══
     On demande une adresse au serveur, puis on y va. Le montant n'est JAMAIS
     envoyé d'ici : il est écrit dans la fonction Edge. Sinon n'importe qui
     modifierait ce que son téléphone envoie et s'abonnerait à un euro. */
  /* Le rythme est déjà choisi dans la carte : plus de fenêtre ici. Une question
     posée deux fois fait douter de la première réponse. */
  const formule = rythmeChoisi

  /* L'acceptation au moment de payer. Ce que Stripe présente ensuite est SON
     contrat, pas le nôtre : sans ce passage, les conditions de Standix ne
     seraient jamais acceptées par quelqu'un qui paie. */
  const accepte = await confirmDialog({
    titre: 'Avant de continuer',
    message: 'En souscrivant, vous acceptez les conditions d\u2019utilisation de Standix.\n\n' +
      'Elles pr\u00e9cisent notamment que les proc\u00e9dures r\u00e9dig\u00e9es par l\u2019IA doivent \u00eatre ' +
      'relues par vos soins avant d\u2019\u00eatre suivies.',
    confirmer: 'J\u2019accepte et je continue',
    annuler: 'Lire les conditions',
    danger: false,
  })
  /* Chemin ABSOLU, comme les trois liens du balisage : `cgu.html` cherchait le
     fichier dans `app/`, où il n'est pas. */
  if (!accepte) { window.open('/cgu.html', '_blank', 'noopener'); return }

  b.disabled = true
  const libelle = b.textContent
  b.textContent = 'Ouverture du paiement\u2026'

  try {
    const rep = await fetch(`${SUPABASE_URL}/functions/v1/stripe-checkout`, {
      method: 'POST',
      headers: await enTeteFonction(),
      body: JSON.stringify({
        entreprise_id: currentMembre.entreprise_id,
        /* On envoie le NOM de l'offre, jamais son prix. Le serveur seul sait ce
           que coûte « equipe ». */
        offre: o.cle,
        formule,
        retour: window.location.origin + window.location.pathname,
      }),
    })
    const data = await rep.json()
    if (!rep.ok || !data.url) throw new Error(data.error || "Le paiement n'a pas pu s'ouvrir.")
    window.location.href = data.url
  } catch (err) {
    b.disabled = false
    b.textContent = libelle
    await confirmDialog({
      titre: 'Paiement indisponible',
      message: String(err?.message || err),
      confirmer: 'Fermer',
      annuler: 'R\u00e9essayer',
      danger: false,
    })
  }
})

/* Au retour de Stripe. L'adresse dit « paiement=ok », mais on N'ACTIVE RIEN
   ici : n'importe qui peut taper cette adresse. On relit simplement l'état
   depuis la base, où le webhook l'aura posé. */
;(async () => {
  const p = new URLSearchParams(window.location.search).get('paiement')
  if (!p) return
  history.replaceState({}, '', window.location.pathname)
  if (p === 'annule') return
  /* Le webhook arrive en une seconde ou deux : on laisse le temps, puis on
     relit. Si rien n'a changé, l'écran d'essai reste — ce qui est honnête. */
  await new Promise(r => setTimeout(r, 2500))
  await lireEtatAbonnement()
  dessinerAlerteEssai('essai-reglages')
  appliquerBlocageEssai()
  if (etatAbo?.statut === 'actif') toast('Votre abonnement est actif. Merci !')
})()

/* ═══════════════════════════════════════════════════════════════════════════
   LE TIROIR DES ÉTABLISSEMENTS

   Il n'apparaît qu'aux gérants qui en ont plusieurs, ou dont l'offre permet le
   multi-sites. Fermé, il ne montre que l'établissement courant : c'est lui le
   bouton. Ouvert, les autres se rangent à droite et le « + » ferme la marche.

   Le rond montre le logo déposé, ou les initiales du nom à défaut. Un logo se
   dépose à deux endroits — la fenêtre du « + » et celle de modification — mais
   c'est le même écran, donc une seule chose à apprendre et à maintenir.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Trois établissements par compte. Ce n'est pas une contrainte technique mais un
   choix : au-delà, on ne gère plus des restaurants, on gère un groupe — et un
   groupe a besoin d'autre chose qu'un sélecteur dans une barre. */
const ETABLISSEMENTS_MAX = 3

let mesEtablissements = []      // { id, nom, logo_url, membre_id, role }
/* Vrai pendant un changement d'établissement : l'app se recharge, mais son cadre
   ne doit pas se rejouer. */
let basculeSansAnimation = false

/* Fait entrer le contenu de l'écran courant, et lui seul. La barre du haut, la
   barre du bas et le tiroir n'appartiennent pas à l'écran : ils ne bougent donc
   pas. La classe est retirée à la fin, sans quoi elle empêcherait toute nouvelle
   arrivée — une animation ne rejoue pas si la classe est déjà là. */
function rejouerContenu() {
  const ecran = document.querySelector('#gestion-app .screen.active, #equipe-app .screen.active')
  if (!ecran) return
  ecran.classList.remove('contenu-entre')
  void ecran.offsetWidth
  ecran.classList.add('contenu-entre')
  setTimeout(() => ecran.classList.remove('contenu-entre'), 900)
}

/* Certains écrans s'ouvrent AVANT d'avoir leurs données : l'animation d'entrée
   joue alors sur un « Chargement… », et le contenu apparaît ensuite d'un bloc,
   sans mouvement. On le fait entrer à son arrivée, sur l'écran désigné. */
function entreeContenu(idEcran) {
  const ecran = document.getElementById(idEcran)
  if (!ecran || !ecran.classList.contains('active')) return
  ecran.classList.remove('contenu-entre')
  void ecran.offsetWidth
  ecran.classList.add('contenu-entre')
  setTimeout(() => ecran.classList.remove('contenu-entre'), 900)
}
let etabEdite = null            // null = création, sinon l'établissement modifié
let etabLogoTampon = null       // le logo choisi, pas encore enregistré

/* Les initiales : au plus deux lettres, tirées des mots porteurs. « Le Comptoir
   du Port » donne LC, pas LCDP — quatre lettres ne tiennent pas dans 32 pixels. */
function initialesEtab(nom) {
  const mots = String(nom || '?').trim().split(/\s+/)
    .filter(m => m.length > 2 || /^[A-Z\u00C0-\u00DD]/.test(m))
  return mots.map(m => m[0]).slice(0, 2).join('').toUpperCase() || '?'
}

function rondEtabHtml(e, estActif, attributs) {
  /* `urlLogo` et non l'adresse brute : la base peut contenir un chemin seul,
     auquel cas `src` chercherait à la racine du site. */
  const dedans = e.logo_url
    ? `<img src="${escapeHtml(urlLogo(e.logo_url))}" alt="">`
    : (e.nom ? `<span class="ini">${escapeHtml(initialesEtab(e.nom))}</span>` : '')
  const classes = 'rond-ent' + (estActif ? ' actif' : '') + (e.logo_url ? ' a-logo' : '')
  return `<button type="button" class="${classes}" ${attributs}>${dedans}</button>`
}

/* Le tiroir n'a de sens qu'à partir de l'offre Multi-sites. Tant que la
   facturation n'existe pas, la colonne `plan` vaut `pro` par défaut : on montre
   alors le tiroir à quiconque a déjà plusieurs établissements, pour ne bloquer
   personne, et à tous les autres pour qu'ils puissent en ajouter un. */
function multiSitesAutorise() {
  /* Tant que la facturation n'existe pas, la colonne `plan` est absente et vaut
     donc une chaîne vide : le tiroir s'affiche pour tout le monde. C'est
     volontaire — sans lui, personne ne pourrait ajouter un second établissement,
     et la fonction serait invisible à jamais.
     Le jour où vous facturez, mettre `plan` à `solo`, `equipe` ou `pro` réserve
     le tiroir à ceux qui en ont déjà plusieurs. */
  const plan = (cachedEntreprise?.plan || '').toLowerCase()
  // Un employé n'a pas d'offre : c'est celle de son entreprise, et le tiroir lui
  // sert à passer d'un employeur à l'autre. On ne le lui retire jamais.
  if (currentMembre?.role !== 'gestion') return true
  if (plan === 'solo' || plan === 'equipe') return mesEtablissements.length > 1
  return true
}

/* Le tiroir sert dans les deux espaces. La différence est ce que fait le « + » :
   un gérant crée un établissement, un employé en rejoint un avec le code que son
   responsable lui a donné. Le geste est le même, l'action diffère. */
function elementTiroir() {
  return currentMembre?.role === 'gestion'
    ? document.getElementById('tiroir-ent')
    : document.getElementById('tiroir-ent-eq')
}
function elementListeTiroir() {
  return currentMembre?.role === 'gestion'
    ? document.getElementById('tiroir-liste')
    : document.getElementById('tiroir-liste-eq')
}

async function chargerEtablissements() {
  /* ON NE DÉPEND PLUS DU TIROIR.

     Cette fonction sortait aussitôt si le tiroir était absent du balisage. Il a
     été retiré des deux barres du haut : elle ne chargeait donc plus rien, et
     `mesEtablissements` restait vide — la piste n'avait jamais qu'une carte, et
     la bascule d'un établissement à l'autre était devenue impossible sans que
     rien ne le signale.

     Charger des données ne doit pas dépendre de la présence d'un élément qui
     les affiche. Ce sont les fonctions de dessin qui vérifient leur cible. */
  if (!currentMembre) return

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  /* La colonne `logo_url` peut ne pas exister encore : dans ce cas la requête
     échoue EN ENTIER et on n'obtient aucun établissement, donc aucun tiroir.
     C'est ce qui se passe tant que le SQL n'a pas été exécuté. On redemande donc
     sans elle : le tiroir marche alors avec les initiales, ce qui est déjà
     l'essentiel. */
  /* ═══ TOUTES SES ENTREPRISES, QUEL QUE SOIT SON RÔLE ═══

     Cette requête filtrait sur `role = 'gestion'` dès que le membre COURANT
     était gérant. Conséquence : quelqu'un qui est employé chez A et gérant chez
     B voyait les deux depuis A, puis A disparaissait dès qu'il basculait vers
     B — et il ne pouvait plus revenir.

     Le rôle qu'on a dans une entreprise ne dit rien des autres. On les liste
     toutes ; c'est chaque fiche qui porte son propre rôle. */
  let requete = supabase
    /* `abonnement_statut` en plus : il sert à savoir si la PERSONNE paie déjà
       quelque part, indépendamment de l'établissement affiché. */
    .from('membres').select('id, role, promu_par, entreprise_id, entreprises(id, nom, logo_url, abonnement_statut)')
    .eq('user_id', user.id)
  let { data, error } = await requete

  if (error || !data) {
    let repli = supabase
      .from('membres').select('id, role, entreprise_id, entreprises(id, nom)')
      .eq('user_id', user.id)
    /* Le même filtre traînait ici. Il aurait provoqué une erreur — `gerant`
       n'existe plus — le jour où cette requête de secours aurait servi. */
    repli = await repli
    data = repli.data || []
    if (repli.error) {
      console.warn('Standix \u00b7 \u00e9tablissements :', repli.error.message)
    }
  }

  mesEtablissements = (data || [])
    .filter(a => a.entreprises)
    .map(a => ({
      id: a.entreprises.id, nom: a.entreprises.nom,
      logo_url: a.entreprises.logo_url || null,   // absent = initiales
      membre_id: a.id,
      /* Le RÔLE qu'on a dans CETTE entreprise-là. Le commentaire de la
         déclaration l'annonçait depuis toujours, il n'était pas repris : la
         requête le demande pourtant. Il sert à savoir si la personne gère déjà
         quelque part, et à adapter ce qu'on lui explique. */
      role: a.role,
      /* `promu_par` distingue le FONDATEUR d'un gestionnaire invité : le second
         porte le nom de celui qui l'a nommé, le premier non. C'est ce qui
         décide du droit de supprimer l'établissement. */
      promu_par: a.promu_par || null,
      abonnement_statut: a.entreprises.abonnement_statut || null,
    }))

  /* Filet : si la lecture groupée n'a rien donné — relation absente, règle
     d'accès, colonne manquante — on va chercher l'entreprise courante seule.
     Sans ça le tiroir restait invisible, et on ne pouvait même pas en ajouter
     un second : la fonction était inatteignable. */
  if (!mesEtablissements.length && currentMembre?.entreprise_id) {
    const { data: ent, error: eEnt } = await supabase
      .from('entreprises').select('id, nom').eq('id', currentMembre.entreprise_id).maybeSingle()
    if (ent) {
      mesEtablissements = [{
        id: ent.id, nom: ent.nom,
        logo_url: cachedEntreprise?.logo_url || null,
        membre_id: currentMembre.id,
      }]
    } else if (eEnt) {
      console.warn('Standix \u00b7 entreprise courante :', eEnt.message)
    }
  }

  peindreTiroir()
  peindreBarreEtablissements()
  peindreListeEtab()
}

/* La même liste dans les réglages, pour changer un logo plus tard. Chaque ligne
   ouvre la fenêtre déjà remplie : c'est le même écran que la création. */
/* ═══════════════════════════════════════════════════════════════════════════
   LES ÉTABLISSEMENTS, DANS LA CARTE DES RÉGLAGES

   Une rangée de cercles et un « + » au bout. Plus de page séparée : la liste
   tenait sur trois lignes, elle ne méritait pas un écran.

   Le cercle de l'établissement COURANT porte l'ambre ; les autres restent en
   retrait. Sans cela, rien ne dirait où l'on est — et toucher un cercle
   bascule vers cet établissement.
   ═══════════════════════════════════════════════════════════════════════════ */
/* Les DEUX espaces portent cette carte. On peint celle qui est présente —
   les identifiants diffèrent d'un préfixe, le reste est identique. */
function peindreListeEtab() {
  peindreRangEtab('etab-rang', 'etab-ajouter', 'etab-note')
  peindreRangEtab('e-etab-rang', 'e-etab-ajouter', 'e-etab-note')
}

function peindreRangEtab(idRang, idPlus, idNote) {
  const rang = document.getElementById(idRang)
  const plus = document.getElementById(idPlus)
  const note = document.getElementById(idNote)
  if (!rang || !plus) return

  const liste = mesEtablissements || []
  const courant = currentMembre?.entreprise_id

  /* On efface les cercles, jamais le « + » : il est dans le balisage, et le
     recréer à chaque peinture lui ferait perdre son écouteur. */
  rang.querySelectorAll('[data-etab]').forEach(n => n.remove())

  liste.forEach(e => {
    const init = (e.nom || '?').trim().split(/\s+/).slice(0, 2)
      .map(m => m[0]).join('').toUpperCase()
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'etab-rond' + (e.id === courant ? ' actif' : '')
    b.dataset.etab = e.id
    b.title = e.nom || ''
    b.setAttribute('aria-label', e.nom || 'Établissement')
    /* `data-fichier` et NON `src`. Les fichiers du dépôt sont privés : leur
       adresse doit être signée, ce que fait `signerMedias` après coup. J'avais
       posé le chemin brut dans `src` — le navigateur cherchait un fichier à la
       racine du site, ne trouvait rien, et le cercle restait vide. */
    /* PAS DE `data-fichier` ICI. Ce mécanisme signe les adresses en cherchant
       dans `procedo-videos` — le dépôt privé des vidéos. Le logo vit dans
       `procedo-logos`, qui est PUBLIC : la signature n'y trouvait rien, et mon
       repli affichait les initiales à la place de l'image.

       Un dépôt public sert son adresse telle quelle. On la pose directement. */
    b.innerHTML = e.logo_url
      ? `<img src="${escapeHtml(urlLogo(e.logo_url))}" alt="">`
      : `<span>${escapeHtml(init)}</span>`
    /* Un appui bascule ; un appui LONG ouvre la fiche pour renommer ou changer
       le logo. Le geste court est celui qu'on fait vingt fois, le long celui
       qu'on fait une fois. */
    let minuteur = null, longue = false
    b.addEventListener('pointerdown', () => {
      longue = false
      minuteur = setTimeout(() => { longue = true; ouvrirFenetreEtab(e.id) }, 550)
    })
    const stop = () => { if (minuteur) { clearTimeout(minuteur); minuteur = null } }
    b.addEventListener('pointerup', stop)
    b.addEventListener('pointerleave', stop)
    b.addEventListener('pointercancel', stop)
    b.addEventListener('click', () => {
      if (longue) return
      if (e.id !== courant) basculerVersEtablissement(e.id)
    })
    rang.insertBefore(b, plus)
  })

  /* Le « + » disparaît au plafond : proposer une création qu'on refusera
     ensuite est pire que ne rien proposer. */
  const plein = liste.length >= ETABLISSEMENTS_MAX
  plus.style.display = plein ? 'none' : ''
  if (note) {
    /* ═══ DEUX PHRASES, SELON QUI LIT ═══

       Un GÉRANT sait déjà ce qu'est un abonnement : ce qu'il ignore, c'est que
       les membres de ses établissements se comptent ENSEMBLE. C'est la seule
       chose qui puisse le surprendre, et elle coûte cher — le jour où plus
       personne ne peut entrer.

       Un EMPLOYÉ, lui, ignore qu'il peut devenir gérant. C'est ça qu'il faut
       lui dire, pas une règle de facturation qui ne le concerne pas encore.

       On regarde s'il est gérant QUELQUE PART, pas seulement ici : celui qui
       gère une entreprise et travaille dans une autre relève du premier cas,
       où qu'il se trouve au moment de lire. */
    const dejaGerant = (mesEtablissements || []).some(e => e.role === 'gestion')
      || currentMembre?.role === 'gestion'

    note.innerHTML = plein
      ? `Vous \u00eates dans ${ETABLISSEMENTS_MAX} entreprises, le maximum par compte.`
      : dejaGerant
        ? 'Cr\u00e9er un \u00e9tablissement est <b>gratuit</b>. Les membres des deux '
          + '\u00e9tablissements s\u2019additionnent sur votre abonnement : une fois le '
          + 'nombre atteint, plus personne ne peut rejoindre l\u2019un ou l\u2019autre.'
        : 'Cr\u00e9ez une entreprise et vous en \u00eates le <b>g\u00e9rant</b>, avec '
          + '<b>14 jours d\u2019essai gratuit</b>. Touchez un logo pour basculer '
          + 'd\u2019une entreprise \u00e0 l\u2019autre.'
  }
}

;['etab-ajouter', 'e-etab-ajouter'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', () => ouvrirFenetreEtab(null))
})


function peindreTiroir() {
  const tiroir = elementTiroir()
  const liste = elementListeTiroir()
  if (!tiroir || !liste || !currentMembre) return

  /* On dessine À PARTIR DE CE QU'ON A, tout de suite. L'entreprise courante est
     toujours connue — elle est dans la fiche membre — donc le tiroir peut
     toujours s'afficher. La lecture en base ne fait qu'ajouter les autres et les
     logos. C'est l'inverse d'avant, où tout attendait la requête : il suffisait
     qu'elle échoue pour que rien n'apparaisse jamais. */
  const courantId = currentMembre.entreprise_id
  let courant = mesEtablissements.find(e => e.id === courantId)
  if (!courant) {
    /* Nom encore inconnu : on n'invente pas d'initiales. Le rond de verre
       s'affiche seul — comme le bouton des réglages — et se remplit dès que le
       nom arrive. Afficher « ME » puis basculer sur « LC » aurait été un
       clignotement de fausse donnée. */
    courant = {
      id: courantId,
      nom: cachedEntreprise?.nom || currentMembre.entreprise_nom || '',
      logo_url: cachedEntreprise?.logo_url || null,
      membre_id: currentMembre.id,
    }
  }

  if (!multiSitesAutorise()) { tiroir.classList.add('masque'); return }
  tiroir.classList.remove('masque')

  /* Fermé par défaut, toujours : on ne voit que l'établissement courant, et c'est
     lui le bouton. L'appui déplie, découvre les autres et le « + ». */
  /* Tout est écrit d'un coup : le rond courant, puis les autres dans leur
     enveloppe. Rien n'est ajouté ni retiré à l'ouverture — c'est le CSS qui
     révèle, ce qui permet d'animer la fermeture aussi. */
  const autres = mesEtablissements
    .filter(e => e.id && e.id !== courant.id)
    .map(e => rondEtabHtml(e, false, `data-etab="${e.id}"`)).join('')

  /* Le « + » disparaît quand la limite est atteinte. Proposer un geste qu'on
     refusera ensuite est la façon la plus sûre d'agacer quelqu'un. */
  const peutAjouter = mesEtablissements.length < ETABLISSEMENTS_MAX

  liste.innerHTML = rondEtabHtml(courant, true, 'data-etab-decl') +
    '<span class="tiroir-autres">' + autres +
    (peutAjouter
      ? '<button type="button" class="rond-ent plus" data-etab-plus><span class="ini">+</span></button>'
      : '') +
    '</span>'
}

function fermerTiroir() {
  const tiroir = elementTiroir()
  if (tiroir?.classList.contains('ouvert')) { tiroir.classList.remove('ouvert'); peindreTiroir() }
}

/* Un seul gestionnaire, posé sur le document. L'ordre compte : les cas précis
   d'abord, puis la fermeture. On ne pose PAS de voile invisible par-dessus la
   page — un voile avalerait le premier appui, et il faudrait toucher deux fois
   pour atteindre ce qu'on visait. Ici le même geste referme et agit. */
document.addEventListener('click', (e) => {
  const tiroir = elementTiroir()
  if (!tiroir || tiroir.style.display === 'none') return

  if (e.target.closest('[data-etab-decl]')) {
    tiroir.classList.toggle('ouvert'); peindreTiroir(); return
  }
  const choix = e.target.closest('[data-etab]')
  if (choix) { fermerTiroir(); basculerVersEtablissement(choix.dataset.etab); return }
  if (e.target.closest('[data-etab-plus]')) {
    fermerTiroir()
    /* Un gérant crée ; un employé rejoint avec un code. Deux actions distinctes
       derrière le même bouton, parce que c'est la même intention : « j'en veux
       un de plus ». */
    /* Côté gestion, le « + » ne crée plus directement : il demande d'abord LEQUEL
       des deux gestes on veut. Créer une entreprise et en rejoindre une sont
       deux choses opposées — responsable d'un côté, lecteur de l'autre — et un
       gestionnaire peut très bien vouloir la seconde.
       Côté équipe la question ne se pose pas : on ne crée pas d'entreprise
       depuis là. */
    /* On ne rejoint plus une entreprise depuis l'app : on la crée. Rejoindre se
       fait à l'inscription, avec le code reçu de son responsable — c'est le seul
       moment où la question se pose vraiment. */
    ouvrirFenetreEtab(null)
    return
  }
  if (e.target.closest('#tiroir-ent')) return

  fermerTiroir()
})

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermerTiroir() })

/* ═══════════════════════════════════════════════════════════════════════════
   LA BARRE DU HAUT

   Un cercle par établissement, dans une pilule de la matière de la barre du
   bas. Le plafond étant de trois, ils tiennent tous côte à côte : on touche
   celui qu'on veut au lieu de faire glisser pour atteindre un voisin déjà
   visible.

   Le « + » reste gris. Ajouter un établissement n'est pas le geste courant ;
   s'il portait l'ambre, il pèserait autant que l'entreprise elle-même.
   ═══════════════════════════════════════════════════════════════════════════ */
/* L'APPROCHE, À CHAQUE CHANGEMENT DE PAGE.

   280 ms, depuis 90 % — la même profondeur que le fondu des pages, et sans
   déplacement : la pilule ne vient de nulle part, elle est déjà là.

   On retire la classe avant de la remettre, avec une lecture forcée entre les
   deux : sans elle le navigateur ne voit aucun changement et l'animation ne
   rejoue pas. */
function animerBarreHaut() {
  /* La PISTE entière, pas la seule pilule : la carte du logo doit marquer le
     changement elle aussi, et c'est elle qu'on voit en premier. */
  const p = document.getElementById('haut-piste')
  if (!p) return
  p.classList.remove('approche')
  void p.offsetWidth
  p.classList.add('approche')
}

function peindreBarreEtablissements() {
  const zone = document.getElementById('etab-ronds')
  const plus = document.getElementById('etab-plus')
  if (!zone) return

  const liste = mesEtablissements || []
  if (plus) {
    plus.style.display = (liste.length < ETABLISSEMENTS_MAX && multiSitesAutorise())
      ? '' : 'none'
  }
  if (!liste.length) return

  const courant = currentMembre?.entreprise_id
  zone.innerHTML = liste.map(e => {
    const init = (e.nom || '?').trim().split(/\s+/).slice(0, 2)
      .map(m => m[0]).join('').toUpperCase()
    /* `cheminFichier` rendait le chemin NU, pas une adresse : le navigateur
       cherchait le fichier à la racine du site. Le dépôt des logos est public,
       `urlLogo` en construit l'adresse complète. */
    const dedans = e.logo_url
      ? `<img src="${escapeHtml(urlLogo(e.logo_url))}" alt="">`
      : `<span class="rond-init">${escapeHtml(init)}</span>`
    return `
      <button type="button" class="rond-etab${e.id === courant ? ' actif' : ''}"
              data-etab="${escapeHtml(e.id)}" title="${escapeHtml(e.nom || '')}"
              aria-label="${escapeHtml(e.nom || 'Établissement')}">${dedans}</button>`
  }).join('')

  zone.querySelectorAll('[data-etab]').forEach(b => {
    b.addEventListener('click', () => basculerVersEtablissement(b.dataset.etab))
  })
}

document.getElementById('etab-plus')?.addEventListener('click', () => ouvrirFenetreEtab(null))

/* Les deux points suivent le panneau visible. On lit la position du défilement
   plutôt que de tenir un compteur : c'est la piste qui fait autorité, et elle
   reste juste même si le doigt s'arrête entre deux. */
;(() => {
  const piste = document.getElementById('haut-piste')
  const points = document.getElementById('haut-points')
  if (!piste || !points) return
  piste.addEventListener('scroll', () => {
    const i = piste.scrollLeft > piste.clientWidth / 2 ? 1 : 0
    ;[...points.children].forEach((p, k) => p.classList.toggle('on', k === i))
  }, { passive: true })
})()

/* Changer d'établissement, c'est changer de fiche membre : on relance l'app avec
   celle qui a été choisie, ce qui recharge procédures, équipe et droits. */
async function basculerVersEtablissement(entrepriseId) {
  const e = mesEtablissements.find(x => x.id === entrepriseId)
  if (!e || e.id === currentMembre?.entreprise_id) return

  const { data: membre } = await supabase
    .from('membres').select('*').eq('id', e.membre_id).maybeSingle()
  if (!membre) return

  currentMembre = membre

  /* ═══════════════════════════════════════════════════════════════════════
     ON VIDE TOUS LES CACHES, PAS SEULEMENT L'ENTREPRISE
     ═══════════════════════════════════════════════════════════════════════

     Seul `cachedEntreprise` l'était. Les autres gardaient le contenu de
     l'établissement qu'on venait de quitter jusqu'à la fin du rechargement —
     et l'app peint AVANT que les requêtes reviennent, c'est même le but de la
     copie locale.

     Résultat visible sur la page Mouvements : elle lit `cachedMembres`, et
     affichait donc les arrivées et les promotions de l'AUTRE entreprise. Le
     journal `mouvements`, lui, était bien filtré — c'est ce qui rendait le
     défaut déroutant : une partie de la page était juste, l'autre non.

     Vider coûte un affichage vide de quelques centaines de millisecondes.
     Ne pas vider coûte des informations d'une entreprise montrées dans une
     autre, ce qui n'est pas un défaut d'affichage mais une fuite.

     LA LISTE EST VOLONTAIREMENT LARGE. Chacun de ces caches est propre à une
     entreprise ; en oublier un, c'est laisser exactement le même défaut sur
     une autre page, et il ne se verra que le jour où quelqu'un aura deux
     établissements. */
  cachedEntreprise = null
  cachedMembres = []
  cachedEmployes = []
  cachedValidations = []
  allGestionProcedures = []
  allCategoriesData = []
  allEquipeProcedures = []
  currentGaData = null
  /* Les deux vues de l'arbre repartent à la racine : rester dans « Cuisine ›
     Friteuse » d'une entreprise qu'on vient de quitter n'a aucun sens. */
  sousDossierCourant = null
  equipeSousDossier = null

  /* On ne masque plus l'app avant de recharger. Le faire rejouait l'animation
     d'entrée : la barre du haut et celle du bas repartaient de zéro, alors qu'on
     change seulement de contenu. Ce sont les procédures qui changent, pas le
     cadre — le cadre doit rester immobile. */
  /* ═══ LA BASCULE, EN DEUX TEMPS ═══

     Le contenu s'efface AVANT le chargement, revient APRÈS. Sans le premier
     temps, on voyait l'ancienne entreprise jusqu'à la dernière milliseconde,
     puis la nouvelle d'un coup — un remplacement, pas un passage.

     Seul le CONTENU bouge. Les deux barres restent immobiles : elles ne
     changent pas d'entreprise, elles encadrent celle qu'on regarde. */
  const ecran = document.querySelector('#gestion-app .screen.active, #equipe-app .screen.active')
  if (ecran) {
    /* La transition de retour n'est active que pendant la bascule — voir
       `.bascule-en-cours` dans le style. Posée en permanence, elle se
       superposait à l'animation d'arrivée de chaque page. */
    document.body.classList.add('bascule-en-cours')
    ecran.classList.add('bascule-part')
    /* 180 ms : le temps que l'effacement se voie, pas plus. Au-delà on attend
       devant un écran vide, et l'attente réelle du réseau s'y ajoute. */
    await new Promise(r => setTimeout(r, 180))
  }

  dejaEntre = new Set()
  basculeSansAnimation = true
  await enterApp(membre)
  basculeSansAnimation = false

  /* On retire l'état de départ AVANT de rejouer l'entrée : les deux classes
     ensemble s'annuleraient, et le contenu resterait pâle. */
  document.querySelectorAll('.bascule-part').forEach(x => x.classList.remove('bascule-part'))
  /* On laisse la transition finir avant de la retirer, sinon l'écran reviendrait
     à sa taille d'un coup. */
  setTimeout(() => document.body.classList.remove('bascule-en-cours'), 260)
  rejouerContenu()
  toast(e.nom)
}

/* ── La fenêtre, la même pour créer et pour modifier ──────────────── */

/* « Créer une entreprise », dans les réglages de l'espace équipe. Le bouton
   existait mais n'était branché nulle part : on appuyait, rien ne se passait.

   On réutilise la même fenêtre que la gestion — elle vit dans l'app de gestion,
   mais c'est une fenêtre superposée, elle s'affiche par-dessus n'importe quel
   espace. */
document.getElementById('es-ajouter')?.addEventListener('click', () => {
  ouvrirFenetreEtab(null)
})

window.ouvrirFenetreEtab = function(entrepriseId) {
  etabEdite = entrepriseId ? mesEtablissements.find(e => e.id === entrepriseId) : null
  etabLogoTampon = etabEdite?.logo_url || null

  document.getElementById('etab-titre').textContent =
    etabEdite ? etabEdite.nom : 'Nouvel \u00e9tablissement'
  document.getElementById('etab-sous').textContent = etabEdite
    ? 'Changez son nom ou son logo.'
    : "Son logo appara\u00eetra dans la barre, \u00e0 c\u00f4t\u00e9 du vôtre."
  document.getElementById('etab-nom').value = etabEdite?.nom || ''
  document.getElementById('etab-ok').textContent = etabEdite ? 'Enregistrer' : 'Ajouter'
  /* ═══ SEUL LE FONDATEUR SUPPRIME ═══

     Trois conditions, et la troisième manquait : l'établissement doit exister,
     ne pas être le dernier, et la personne doit en être LE FONDATEUR.

     Sans ce contrôle, n'importe qui — y compris un employé en lecture seule —
     pouvait effacer une entreprise entière avec ses procédures, ses vidéos et
     son équipe. Rien ne permet de revenir en arrière.

     `estFondateur` distingue celui qui a créé l'entreprise d'un gestionnaire
     invité ensuite : le second porte un `promu_par`, le premier non. Un
     associé nommé la semaine dernière ne doit pas pouvoir tout effacer. */
  const boutonSuppr = document.getElementById('etab-supprimer')
  if (boutonSuppr) {
    const monRole = (mesEtablissements || []).find(x => x.id === etabEdite?.id)
    const jeSuisFondateur = monRole
      /* Par la fonction, pas par une copie de sa règle : elle vient de
         changer, et les copies, elles, ne changent pas. */
      ? estFondateur(monRole)
      : estFondateur(currentMembre)
    boutonSuppr.style.display =
      (etabEdite && mesEtablissements.length > 1 && jeSuisFondateur) ? 'block' : 'none'
  }
  document.getElementById('etab-erreur').textContent = ''
  majFenetreEtab()
  document.getElementById('fond-etab').classList.add('on')
}

function majFenetreEtab() {
  const nom = document.getElementById('etab-nom').value.trim()
  const depot = document.getElementById('etab-depot')
  depot.querySelector('img')?.remove()
  depot.classList.toggle('rempli', !!etabLogoTampon)
  if (etabLogoTampon) {
    const img = document.createElement('img')
    img.src = etabLogoTampon
    depot.insertBefore(img, depot.firstChild)
  }
  /* Le monogramme se met à jour pendant la frappe : on voit tout de suite ce qui
     s'affichera si aucun logo n'est déposé. */
  const mono = document.getElementById('etab-mono')
  mono.textContent = initialesEtab(nom)
  mono.style.display = etabLogoTampon ? 'none' : 'block'
  document.getElementById('etab-legende').innerHTML = etabLogoTampon
    ? '<button type="button" data-etab-retirer>Retirer le logo</button>'
    : 'Facultatif \u00b7 les initiales serviront sinon'
  document.getElementById('etab-ok').disabled = nom.length < 2
}

function fermerFenetreEtab() {
  document.getElementById('fond-etab').classList.remove('on')
}

document.getElementById('etab-nom')?.addEventListener('input', majFenetreEtab)
document.getElementById('etab-annuler')?.addEventListener('click', fermerFenetreEtab)
document.getElementById('fond-etab')?.addEventListener('click', (e) => {
  if (e.target.id === 'fond-etab') fermerFenetreEtab()
  if (e.target.closest('[data-etab-retirer]')) { etabLogoTampon = null; majFenetreEtab() }
})
document.getElementById('etab-depot')?.addEventListener('click', () => {
  document.getElementById('etab-fichier').click()
})

/* Le fichier est recadré en carré et réduit à 192 pixels avant d'être envoyé :
   un logo de quatre mégaoctets n'a aucun intérêt pour un rond de 32 pixels, et
   il ralentirait la barre à chaque affichage. */
document.getElementById('etab-fichier')?.addEventListener('change', (ev) => {
  const f = ev.target.files[0]
  ev.target.value = ''
  if (!f) return

  const lecteur = new FileReader()
  lecteur.onload = () => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = c.height = 192
      const ctx = c.getContext('2d')
      const cote = Math.min(img.width, img.height)
      ctx.drawImage(img, (img.width - cote) / 2, (img.height - cote) / 2, cote, cote, 0, 0, 192, 192)
      etabLogoTampon = c.toDataURL('image/webp', 0.85)
      majFenetreEtab()
    }
    img.onerror = () => {
      document.getElementById('etab-erreur').textContent = "Ce fichier n'est pas une image lisible."
    }
    img.src = lecteur.result
  }
  lecteur.readAsDataURL(f)
})

document.getElementById('etab-supprimer')?.addEventListener('click', async () => {
  if (!etabEdite) return
  const nom = etabEdite.nom || 'cet \u00e9tablissement'

  /* On revérifie AU CLIC, pas seulement à l'affichage. Masquer un bouton ne
     protège de rien : il suffit de le réafficher depuis la console. Le contrôle
     doit être là où l'action se déclenche. */
  const _mien = (mesEtablissements || []).find(x => x.id === etabEdite.id)
  const _fondateur = _mien
    ? estFondateur(_mien)
    : estFondateur(currentMembre)
  if (!_fondateur) {
    toast('Seul le fondateur peut supprimer un \u00e9tablissement.')
    return
  }

  const ok = await confirmDialog({
    titre: `Supprimer ${nom} ?`,
    message: `Toutes ses proc\u00e9dures, ses \u00e9tapes et son \u00e9quipe seront effac\u00e9es. ` +
      `C'est d\u00e9finitif : rien ne permet de revenir en arri\u00e8re.`,
    confirmer: 'Supprimer',
    annuler: 'Annuler',
    danger: true,
  })
  if (!ok) return

  const btn = document.getElementById('etab-supprimer')
  btn.disabled = true
  btn.textContent = 'Suppression\u2026'

  try {
    /* On efface dans l'ordre des dépendances : les étapes tiennent aux
       procédures, les procédures à l'entreprise. Si la base est configurée en
       cascade, ces trois appels sont redondants — mais inoffensifs, et ils
       garantissent le résultat quand elle ne l'est pas. */
    const { data: procs } = await supabase.from('procedures')
      .select('id').eq('entreprise_id', etabEdite.id)
    for (const pr of (procs || [])) {
      await supabase.from('etapes').delete().eq('procedure_id', pr.id)
    }
    await supabase.from('procedures').delete().eq('entreprise_id', etabEdite.id)
    await supabase.from('membres').delete().eq('entreprise_id', etabEdite.id)

    const { data, error } = await supabase.from('entreprises')
      .delete().eq('id', etabEdite.id).select('id')
    if (error) throw new Error(error.message)
    if (!data || !data.length) {
      throw new Error("La base a refus\u00e9 la suppression. Ex\u00e9cutez migration-etablissements.sql : " +
        "il manque la r\u00e8gle d'acc\u00e8s \u00ab delete \u00bb sur la table entreprises.")
    }

    const partait = etabEdite.id === currentMembre?.entreprise_id

    /* ═══ LA LIGNE S'EN VA DEVANT LES YEUX ═══

       La base a effacé, la fenêtre se ferme, et la liste se redessine sans elle :
       entre deux images, l'établissement disparaît sans qu'on l'ait vu partir. On
       se demande alors si c'est bien le bon qu'on a supprimé.

       On le fait donc partir AVANT de fermer. Trois cents millisecondes suffisent
       à lever le doute. */
    const ligne = document.querySelector(`[data-etab="${etabEdite.id}"]`)
    if (ligne) {
      await new Promise(r => {
        ligne.classList.add('part')
        const fin = () => r()
        ligne.addEventListener('animationend', fin, { once: true })
        setTimeout(fin, 400)
      })
    }

    fermerFenetreEtab()
    try { localStorage.removeItem('procedo_membre') } catch (e) {}

    if (partait) {
      // On était dedans : il faut aller ailleurs avant que l'écran ne parle du vide.
      const { data: { user } } = await supabase.auth.getUser()
      const { fiches } = await lireFichesMembre(user?.id)
      const suivante = choisirFicheMembre(fiches)
      cachedEntreprise = null
      if (suivante) {
        /* On passe dans l'autre entreprise. Le fondu évite le clignotement d'un
           écran qui se vide puis se remplit — on comprend qu'on CHANGE d'endroit,
           au lieu de croire que l'application a bugué. */
        document.body.classList.add('bascule-etab')
        await new Promise(r => setTimeout(r, 220))
        await enterApp(suivante)
        document.body.classList.remove('bascule-etab')
        toast(`${nom} a \u00e9t\u00e9 supprim\u00e9. Vous \u00eates maintenant dans ${suivante.entreprise_nom || 'votre autre \u00e9tablissement'}.`)
        return
      }
      document.getElementById('gestion-app').style.display = 'none'
      document.getElementById('equipe-app').style.display = 'none'
      afficherBarre(false)
      afficherBarre(false)
      document.getElementById('choice-screen').style.display = 'flex'
    } else {
      await chargerEtablissements()
    }
    toast(`${nom} a \u00e9t\u00e9 supprim\u00e9.`)
  } catch (ex) {
    document.getElementById('etab-erreur').textContent =
      ex instanceof Error ? ex.message : String(ex)
  } finally {
    btn.disabled = false
    btn.textContent = 'Supprimer cet \u00e9tablissement'
  }
})

document.getElementById('etab-ok')?.addEventListener('click', async () => {
  const btn = document.getElementById('etab-ok')
  const err = document.getElementById('etab-erreur')
  const nom = document.getElementById('etab-nom').value.trim()
  err.textContent = ''
  btn.disabled = true
  btn.textContent = 'Enregistrement\u2026'

  try {
    let entrepriseId = etabEdite?.id
    let logoUrl = etabEdite?.logo_url || null

    /* On refuse AVANT d'écrire quoi que ce soit : créer la ligne puis
       s'apercevoir qu'elle est en trop laisserait une entreprise orpheline. */
    if (!entrepriseId && mesEtablissements.length >= ETABLISSEMENTS_MAX) {
      throw new Error(
        `Vous g\u00e9rez d\u00e9j\u00e0 ${ETABLISSEMENTS_MAX} \u00e9tablissements, le maximum par compte. ` +
        `Retirez-en un pour en cr\u00e9er un autre, ou \u00e9crivez-nous si vous g\u00e9rez un groupe.`
      )
    }

    /* ═══ 1. L'ENTREPRISE ET SON GÉRANT, EN UNE SEULE OPÉRATION ═══

       On appelait `insert(...).select('id')` : créer la ligne, puis la relire
       pour son identifiant. L'insertion passait ; c'est la RELECTURE qui
       échouait, parce que la règle de lecture exige d'être membre — et le
       membre n'existe pas encore, il est créé juste après.

       Supabase renvoyait une erreur mentionnant « row-level security », et
       l'app en concluait qu'il manquait la règle « insert ». Elle se trompait
       de coupable, et le message envoyait chercher au mauvais endroit.

       La base fait maintenant les deux écritures ensemble. Elle règle du même
       coup un risque qui existait avant : si la création du membre échouait,
       il restait une entreprise que personne ne pouvait voir ni supprimer. */
    if (!entrepriseId) {
      const { data: res, error } = await supabase.rpc('creer_etablissement', { p_nom: nom })
      if (error) {
        throw new Error(/function .* does not exist|not find the function/i.test(error.message)
          ? "La base ne sait pas encore cr\u00e9er un \u00e9tablissement. "
            + "Ex\u00e9cutez migration-creer-etablissement.sql."
          : error.message)
      }
      if (!res?.ok) {
        throw new Error(res?.raison === 'non connecte'
          ? "Votre session a expir\u00e9. Reconnectez-vous."
          : "L'entreprise n'a pas \u00e9t\u00e9 cr\u00e9\u00e9e : " + (res?.raison || 'raison inconnue'))
      }
      entrepriseId = res.id
    }

    // 2. Le logo, s'il a changé. Il a besoin de l'identifiant, d'où son rang.
    let logoAChange = false
    if (etabLogoTampon && etabLogoTampon !== etabEdite?.logo_url) {
      const blob = await (await fetch(etabLogoTampon)).blob()
      const chemin = `${entrepriseId}/logo-${Date.now()}.webp`
      const { error: eU } = await supabase.storage.from('procedo-logos')
        .upload(chemin, blob, { contentType: 'image/webp', upsert: true, cacheControl: CACHE_LONG })
      if (eU) throw new Error("D\u00e9p\u00f4t du logo refus\u00e9 : " + eU.message)
      const { data: pub } = supabase.storage.from('procedo-logos').getPublicUrl(chemin)
      logoUrl = pub?.publicUrl || null
      logoAChange = true
    } else if (!etabLogoTampon && etabEdite?.logo_url) {
      logoUrl = null
      logoAChange = true
    }

    /* 3. La mise à jour n'a lieu QUE si elle a quelque chose à dire. Elle était
          jusqu'ici systématique : une création sans logo réécrivait un nom qu'on
          venait d'écrire, et si la règle d'accès « update » manquait, tout
          échouait APRÈS que l'entreprise ait été créée. On se retrouvait avec une
          entreprise en base, un message d'erreur à l'écran, et rien qui marche. */
    const aMettreAJour = etabEdite
      ? { ...(nom !== etabEdite.nom ? { nom } : {}), ...(logoAChange ? { logo_url: logoUrl } : {}) }
      : (logoAChange ? { logo_url: logoUrl } : {})

    if (Object.keys(aMettreAJour).length) {
      const { data: maj, error: eMaj } = await supabase.from('entreprises')
        .update(aMettreAJour).eq('id', entrepriseId).select('id')
      if (eMaj) throw new Error(eMaj.message)
      if (!maj || maj.length === 0) {
        throw new Error("La base a refus\u00e9 la modification. Ex\u00e9cutez migration-etablissements.sql : " +
          "il manque la r\u00e8gle d'acc\u00e8s \u00ab update \u00bb sur la table entreprises.")
      }
    }

    fermerFenetreEtab()

    /* Créé depuis l'espace équipe : la personne devient responsable de cette
       entreprise-là. On l'y emmène, sinon elle vient de fonder quelque chose
       qu'elle ne voit nulle part. */
    if (!etabEdite && currentMembre?.role !== 'gestion') {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: fiche } = await supabase.from('membres').select('*')
        .eq('user_id', user.id).eq('entreprise_id', entrepriseId).maybeSingle()
      if (fiche) {
        cachedEntreprise = null
        await enterApp(fiche)
        toast(`${nom} est cr\u00e9\u00e9e. Vous en \u00eates responsable.`)
        return
      }
    }

    await chargerEtablissements()
    if (entrepriseId === currentMembre?.entreprise_id && cachedEntreprise) cachedEntreprise.nom = nom
    toast(etabEdite ? '\u00c9tablissement modifi\u00e9.' : '\u00c9tablissement ajout\u00e9.')
  } catch (ex) {
    err.textContent = ex instanceof Error ? ex.message : String(ex)
  } finally {
    btn.disabled = false
    btn.textContent = etabEdite ? 'Enregistrer' : 'Ajouter'
  }
})

/* Basculer d'entreprise revient à changer de fiche membre : on relance l'app
   avec celle qui a été choisie, ce qui recharge procédures, équipe et droits. */
document.getElementById('es-entreprises')?.addEventListener('click', async (e) => {
  const ligne = e.target.closest('.ent-ligne')
  if (!ligne || ligne.classList.contains('actuelle')) return
  const adhesion = mesAdhesions.find(a => a.id === ligne.dataset.membre)
  if (!adhesion) return

  const ok = await confirmDialog({
    titre: "Changer d'entreprise",
    message: `Basculer vers « ${adhesion.entreprises?.nom || 'cette entreprise'} » ? L'app va se recharger avec ses procédures.`,
    confirmer: 'Basculer',
    annuler: 'Annuler',
    danger: false,
  })
  if (!ok) return

  document.getElementById('gestion-app').style.display = 'none'
  document.getElementById('equipe-app').style.display = 'none'
  afficherBarre(false)
  afficherBarre(false)
  await enterApp(adhesion)
})

document.getElementById('es-save')?.addEventListener('click', async () => {
  const btn = document.getElementById('es-save')
  const err = document.getElementById('es-error')
  const nom = document.getElementById('es-nom').value.trim()
  err.style.color = 'var(--red)'
  err.textContent = ''
  if (!nom) { err.textContent = 'Le nom ne peut pas être vide.'; return }
  setButtonLoading(btn, true)
  const { error } = await supabase.from('membres').update({ nom }).eq('id', currentMembre.id)
  setButtonLoading(btn, false)
  if (error) { err.textContent = 'Erreur : ' + error.message; return }
  currentMembre.nom = nom
  err.style.color = 'var(--green)'
  err.textContent = 'Enregistré.'
})

document.getElementById('es-rejoindre')?.addEventListener('click', async () => {
  const btn = document.getElementById('es-rejoindre')
  const err = document.getElementById('es-code-error')
  const code = document.getElementById('es-code').value.trim()
  err.style.color = 'var(--red)'
  err.textContent = ''
  if (!/^[A-Za-z0-9]{6}$/.test(code)) { err.textContent = 'Le code comporte 6 caractères.'; return }

  setButtonLoading(btn, true)
  const ent = await entrepriseParCode(code)

  if (!ent) { setButtonLoading(btn, false); err.textContent = 'Aucune entreprise avec ce code.'; return }
  if (mesAdhesions.some(a => a.entreprise_id === ent.id)) {
    setButtonLoading(btn, false)
    err.textContent = 'Vous appartenez déjà à cette entreprise.'
    return
  }

  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('membres').insert({
    user_id: user.id, nom: currentMembre?.nom || '', role: 'equipe', entreprise_id: ent.id,
  })
  setButtonLoading(btn, false)
  if (error) { err.textContent = 'Erreur : ' + error.message; return }

  document.getElementById('es-code').value = ''
  err.style.color = 'var(--green)'
  err.textContent = `« ${ent.nom} » ajoutée. Elle restera dans votre liste.`
  chargerMesEntreprises()
})

/* ═══════════════════════════════════════════════════════════════════════════
   L'ARRIVÉE D'UN PROMU

   Quelqu'un qui vient d'être promu ne l'apprend pas en cherchant : on le lui dit
   à sa prochaine ouverture, une fois, et on l'emmène où il doit aller.

   La mention du bas n'est pas décorative. Passer en gestion FERME l'espace
   Équipe : quelqu'un qui ne le sait pas croira à une panne le jour où il
   cherchera ses procédures à lire.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   QUITTER UNE ENTREPRISE, ET N'EN AVOIR AUCUNE

   Partir doit être aussi simple qu'entrer. Et quelqu'un qui se reconnecte sans
   entreprise ne doit pas tomber sur un écran vide : on lui dit ce qui manque et
   on lui donne le champ pour le réparer, là où il est.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══ ON NE LAISSE PAS UNE ENTREPRISE SANS GESTIONNAIRE ═══

   Si le dernier gestionnaire part, l'entreprise devient ORPHELINE : les
   employés gardent leur accès en lecture, mais plus personne ne peut créer une
   procédure, gérer l'équipe, ni même supprimer l'entreprise. Elle reste là,
   définitivement, avec ses vidéos et son stockage.

   On compte donc avant de laisser partir. Le compte se fait en base et non sur
   la liste chargée : celle-ci peut dater de plusieurs minutes, et quelqu'un a
   pu être rétrogradé entre-temps. */
async function jeSuisLeDernierGestionnaire() {
  if (currentMembre?.role !== 'gestion') return false
  const { count, error } = await supabase
    .from('membres')
    .select('id', { count: 'exact', head: true })
    .eq('entreprise_id', currentMembre.entreprise_id)
    .eq('role', 'gestion')
  /* En cas d'erreur on RETIENT la personne plutôt que de la laisser partir :
     mieux vaut un départ empêché à tort qu'une entreprise orpheline. */
  if (error) return true
  return (count ?? 0) <= 1
}

document.getElementById('es-quitter')?.addEventListener('click', async () => {
  const nom = cachedEntreprise?.nom || 'cette entreprise'

  if (await jeSuisLeDernierGestionnaire()) {
    await confirmDialog({
      titre: 'Vous \u00eates le seul gestionnaire',
      message: `Si vous partez, plus personne ne pourra cr\u00e9er de proc\u00e9dure ` +
        `ni g\u00e9rer l'\u00e9quipe de ${nom}. Nommez d'abord quelqu'un d'autre ` +
        `dans « G\u00e9rer l'\u00e9quipe », ou supprimez l'entreprise.`,
      confirmer: 'Compris',
      annuler: '',
      danger: false,
    })
    return
  }

  const ok = await confirmDialog({
    titre: `Quitter ${nom} ?`,
    message: `Vous perdrez l'acc\u00e8s \u00e0 ses proc\u00e9dures et votre historique de lectures. ` +
      `Votre compte Standix reste actif : vous pourrez rejoindre une autre entreprise avec un code.`,
    confirmer: 'Quitter',
    annuler: 'Rester',
    danger: true,
  })
  if (!ok) return

  const { data, error } = await supabase.from('membres')
    .delete().eq('id', currentMembre.id).select('id')

  if (error) { toast('\u00c9chec : ' + error.message); return }
  if (!data || !data.length) {
    toast("La base a refus\u00e9 le d\u00e9part. V\u00e9rifiez la r\u00e8gle \u00ab delete \u00bb sur la table membres.")
    return
  }

  /* On efface le repère du dernier établissement : il désigne une fiche qui
     n'existe plus, et rouvrirait sur une entreprise qu'on vient de quitter. */
  try { localStorage.removeItem('procedo_membre') } catch (e) {}

  const restantes = await lireFichesMembre((await supabase.auth.getUser()).data.user?.id)
  const suivante = choisirFicheMembre(restantes.fiches)

  currentMembre = null
  cachedEntreprise = null

  if (suivante) {
    // Il lui reste une autre entreprise : on l'y emmène plutôt que de le sortir.
    await enterApp(suivante)
    toast(`Vous avez quitt\u00e9 ${nom}.`)
    return
  }

  document.getElementById('gestion-app').style.display = 'none'
  document.getElementById('equipe-app').style.display = 'none'
  afficherBarre(false)
  afficherBarre(false)
  document.getElementById('choice-screen').style.display = 'flex'
  toast(`Vous avez quitt\u00e9 ${nom}.`)
})

/* ── Un compte sans entreprise ───────────────────────────────── */

/* La même fenêtre sert à deux moments : un compte sans entreprise, et quelqu'un
   qui veut en rejoindre une de plus. Le besoin est le même — un code à saisir —
   seule la sortie diffère : se déconnecter dans un cas, annuler dans l'autre. */
function montrerOrphelin(enPlus) {
  const f = document.getElementById('fond-orphelin')
  if (!f) return

  const el = (i) => document.getElementById(i)
  el('orph-erreur').textContent = ''
  el('orph-code').value = ''

  if (enPlus) {
    el('orph-titre').textContent = 'Rejoindre une entreprise'
    el('orph-texte').textContent =
      "Entrez le code \u00e0 6 caract\u00e8res que son responsable vous a communiqu\u00e9. " +
      "Elle s'ajoutera \u00e0 celles que vous avez d\u00e9j\u00e0."
    el('orph-sortir').style.display = 'none'
    el('orph-annuler').style.display = 'block'
  } else {
    el('orph-titre').textContent = 'Aucune entreprise'
    el('orph-texte').textContent =
      "Votre compte n'est rattach\u00e9 \u00e0 aucune entreprise. Entrez le code \u00e0 6 caract\u00e8res " +
      "que votre responsable vous a communiqu\u00e9."
    el('orph-sortir').style.display = 'block'
    el('orph-annuler').style.display = 'none'
  }

  f.classList.add('on')
  setTimeout(() => el('orph-code')?.focus(), 320)
}

document.getElementById('orph-annuler')?.addEventListener('click', () => {
  document.getElementById('fond-orphelin')?.classList.remove('on')
})

document.getElementById('orph-sortir')?.addEventListener('click', () => {
  document.getElementById('fond-orphelin')?.classList.remove('on')
  signOut()
})

document.getElementById('orph-entrer')?.addEventListener('click', async () => {
  const btn = document.getElementById('orph-entrer')
  const err = document.getElementById('orph-erreur')
  const code = (document.getElementById('orph-code').value || '').trim()
  err.textContent = ''

  if (!/^[A-Za-z0-9]{6}$/.test(code)) { err.textContent = 'Le code compte 6 caractères.'; return }
  btn.disabled = true
  btn.textContent = 'V\u00e9rification\u2026'

  try {
    const ent = await entrepriseParCode(code)
    if (!ent) throw new Error("Aucune entreprise ne correspond \u00e0 ce code.")

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Session expir\u00e9e. Reconnectez-vous.')

    // Déjà dedans ? On le dit plutôt que de créer une seconde fiche.
    const { data: dejaLa } = await supabase.from('membres')
      .select('id').eq('user_id', user.id).eq('entreprise_id', ent.id).maybeSingle()
    if (dejaLa) throw new Error(`Vous faites d\u00e9j\u00e0 partie de ${ent.nom}.`)

    /* La place est-elle libre ? Si l'entreprise est complète, la demande est
       déposée et l'on s'arrête ici. */
    if (!(await verifierPlaceLibre(ent.id, ent.nom))) return
    const { data: cree, error } = await supabase.from('membres')
      .insert({ user_id: user.id, entreprise_id: ent.id, nom: '', role: 'equipe' })
      .select('*').maybeSingle()
    if (error) throw new Error(error.message)
    if (!cree) throw new Error("La base a refus\u00e9 l'adh\u00e9sion.")

    document.getElementById('fond-orphelin').classList.remove('on')

    /* On entre dans la nouvelle entreprise comme MEMBRE D'ÉQUIPE, quel que soit
       le rang qu'on occupe ailleurs. Être gestionnaire chez l'un ne donne aucun
       droit chez l'autre — c'est à son responsable de promouvoir, s'il le veut. */
    await enterApp(cree)
    toast(`Bienvenue chez ${ent.nom}. Vous y \u00eates membre d'\u00e9quipe.`)
  } catch (ex) {
    err.textContent = ex instanceof Error ? ex.message : String(ex)
  } finally {
    btn.disabled = false
    btn.textContent = 'Rejoindre'
  }
})

async function verifierPromotion(membre) {
  if (!membre) return

  /* Deux annonces, une seule fenêtre. On les distingue avec les colonnes qu'on
     a déjà : `promu_le` marque le dernier changement de rang, `promu_vu` dit si
     la personne en a été avertie. Le rôle actuel donne le sens du changement.

     Pourquoi annoncer une rétrogradation ? Parce que sans elle, quelqu'un
     rouvre l'app, ne retrouve plus la gestion, et croit à une panne. Un
     changement subi se dit ; c'est le minimum. */
  if (membre.promu_vu) return
  if (!membre.promu_le) return

  const promu = membre.role === 'gestion'
  const ent = cachedEntreprise?.nom || 'votre entreprise'
  const el = (i) => document.getElementById(i)

  if (promu) {
    /* Ni félicitations ni bravo : l'app n'est pas en position de féliciter
       quelqu'un pour une décision prise par son patron. Elle annonce le fait, et
       c'est tout ce qu'on attend d'elle. */
    el('promu-titre').textContent = 'Vous passez en espace Gestion'
    el('promu-texte').innerHTML =
      `Vous \u00eates d\u00e9sormais <b>gestionnaire</b> de ${escapeHtml(ent)}. ` +
      `Cr\u00e9ez des proc\u00e9dures, suivez l'\u00e9quipe, g\u00e9rez les acc\u00e8s.`
    el('promu-entrer').textContent = "Acc\u00e9der \u00e0 l'espace Gestion"
    el('promu-avert').textContent =
      "L'espace \u00c9quipe ne vous sera plus accessible : vous \u00eates maintenant de l'autre c\u00f4t\u00e9."
  } else {
    el('promu-titre').textContent = 'Vous repassez en espace \u00c9quipe'
    el('promu-texte').innerHTML =
      `Votre r\u00f4le a chang\u00e9 chez ${escapeHtml(ent)} : vous faites de nouveau partie de <b>l'\u00e9quipe</b>. ` +
      `Vous retrouvez les proc\u00e9dures \u00e0 lire et le scanner de QR codes.`
    el('promu-entrer').textContent = "Acc\u00e9der \u00e0 l'espace \u00c9quipe"
    el('promu-avert').textContent =
      "L'espace Gestion ne vous est plus accessible. Vos proc\u00e9dures cr\u00e9\u00e9es restent en place."
  }

  const fond = document.getElementById('fond-promu')
  if (!fond) return
  fond.classList.add('on')

  /* On marque comme vue TOUT DE SUITE, pas à la fermeture : si la personne
     ferme l'app sans toucher au bouton, l'annonce ne doit pas revenir à chaque
     ouverture. */
  membre.promu_vu = true
  supabase.from('membres').update({ promu_vu: true }).eq('id', membre.id)
    .then(({ error }) => { if (error) console.warn('Standix \u00b7 promu_vu :', error.message) })
}

document.getElementById('promu-entrer')?.addEventListener('click', () => {
  document.getElementById('fond-promu')?.classList.remove('on')
})
document.getElementById('fond-promu')?.addEventListener('click', (e) => {
  if (e.target.id === 'fond-promu') e.currentTarget.classList.remove('on')
})

/* ═══════════════════════════════════════════════════════════════════════════
   GÉRER L'ÉQUIPE (espace gestion)
   ═══════════════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════════════════
   GÉRER L'ÉQUIPE

   Deux rangs de gestionnaire, et un seul les distingue vraiment : le FONDATEUR
   est celui dont `promu_par` est vide. Lui seul promeut. Un promu peut retirer
   des gens — c'est du quotidien — mais pas en faire entrer d'autres dans la
   gestion : donner ses propres droits n'est pas une décision délégable.
   ═══════════════════════════════════════════════════════════════════════════ */

let membresEquipe = []
let filtreEquipe = ''
let triEquipe = 'az'

/* Le fondateur : le gestionnaire qui n'a été promu par personne. Tant que la
   colonne n'existe pas, tous les gestionnaires en sont — l'app reste utilisable
   avant l'exécution du SQL, simplement sans la distinction. */
/* ═══ QUI EST LE FONDATEUR ═══

   On le reconnaissait à l'absence de `promu_par`. Un seul champ, et il suffit
   qu'une écriture le manque pour qu'un gestionnaire promu passe pour le
   créateur de l'entreprise — c'est arrivé.

   `promu_le` est le second garde-fou : il est posé à CHAQUE changement de rang,
   promotion comme rétrogradation. Quelqu'un qui le porte a forcément vu son
   rôle changer un jour, donc n'est pas celui qui a créé l'entreprise.

   Deux champs valent mieux qu'un, mais ce n'en est pas moins un contournement :
   la vraie réponse serait une colonne qui dit « celui-ci a créé l'entreprise ».
   Tant qu'elle n'existe pas, on déduit. */
function estFondateur(m) {
  return m?.role === 'gestion' && !m?.promu_par && !m?.promu_le
}

function initialesMembre(nom) {
  return (nom || '?').trim().split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase()
}

window.openMembres = async function() {
  showGestionScreen('p-membres')
  const liste = document.getElementById('pm-liste')
  liste.innerHTML = '<div class="note">Chargement\u2026</div>'
  filtreEquipe = ''
  const champ = document.getElementById('pm-chercher')
  if (champ) champ.value = ''
  document.querySelector('.pm-recherche')?.classList.remove('remplie')

  const { data, error } = await supabase
    .from('membres').select('*').eq('entreprise_id', currentMembre.entreprise_id)
    .order('created_at', { ascending: true })

  if (error) { liste.innerHTML = `<div class="note">Erreur : ${escapeHtml(error.message)}</div>`; return }

  membresEquipe = data || []
  peindreEquipe()
  entreeContenu('p-membres')
}

function peindreEquipe() {
  const liste = document.getElementById('pm-liste')
  const sous = document.getElementById('pm-subhead')
  if (!liste) return

  const gerants = membresEquipe.filter(m => m.role === 'gestion').length
  if (sous) {
    /* Le détail — combien en gestion, combien en équipe — est passé dans les
       trois sections, où il se compte tout seul. Le sous-titre ne garde que le
       total, la seule chose qu'aucune section ne dit. */
    sous.textContent = `${membresEquipe.length} personne${membresEquipe.length > 1 ? 's' : ''}`
  }

  /* La recherche ignore les accents et la casse : on cherche « lea » et on trouve
     « Léa », ce qui est la moindre des choses sur un clavier de téléphone. */
  const sansAccent = (t) => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const q = sansAccent(filtreEquipe).trim()
  const vus = q ? membresEquipe.filter(m => sansAccent(m.nom).includes(q)) : membresEquipe

  if (!vus.length) {
    liste.innerHTML = q
      ? `<div class="note">Personne ne correspond \u00e0 \u00ab ${escapeHtml(filtreEquipe)} \u00bb.</div>`
      : '<div class="note">Votre \u00e9quipe est vide.</div>'
    return
  }

  /* Le tri s'applique après le filtre : on trie ce qu'on voit, pas ce qu'on
     cherche. À nom égal, l'ancienneté départage — sans quoi deux homéonymes
     changeraient de place à chaque affichage. */
  const parNom = (a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' })
  const parDate = (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)
  const tries = [...vus].sort((a, b) =>
    triEquipe === 'neuf' ? (parDate(b, a) || parNom(a, b))
    : triEquipe === 'vieux' ? (parDate(a, b) || parNom(a, b))
    : (parNom(a, b) || parDate(a, b)))

  const jePeuxChangerLeRang = estFondateur(currentMembre)

  /* ═══════════════════════════════════════════════════════════════════════
     TROIS GROUPES, PAS UNE LISTE

     Une liste unique mélangeait tout le monde : il fallait lire le rôle sous
     chaque nom pour savoir qui pouvait quoi.

     Trois sections désormais — le fondateur seul, la gestion, l'équipe. On
     voit d'un regard qui a les clés.

     ⚠ L'ORDRE N'EST PAS UNE HIÉRARCHIE. Le fondateur vient en premier parce
       qu'il est unique et qu'on le cherche en premier, pas parce qu'il vaut
       mieux. Les intitulés disent des ACCÈS, pas des rangs.
     ═══════════════════════════════════════════════════════════════════════ */
  const ligne = (m) => {
    const soi = m.id === currentMembre.id
    const promouvable = jePeuxChangerLeRang && !soi && m.role !== 'gestion'
    /* On ne rétrograde pas un fondateur : ce serait se retirer soi-même la
       dernière clé de l'entreprise. */
    const retrogradable = jePeuxChangerLeRang && !soi && m.role === 'gestion' && !estFondateur(m)

    /* Qui peut retirer qui.
       Le fondateur retire n'importe qui. Un gestionnaire promu ne retire que
       des membres d'équipe : il ne doit pas pouvoir écarter ses pairs, encore
       moins celui qui l'a nommé. */
    const supprimable = !soi && (jePeuxChangerLeRang || m.role !== 'gestion')
    const date = m.created_at
      ? new Date(m.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
      : '\u2014'

    return `
      <div class="pm-ligne">
        <div class="pm-av${m.role === 'gestion' ? ' chef' : ''}">${escapeHtml(initialesMembre(m.nom))}</div>
        <div class="pm-info">
          <div class="pm-nom">${escapeHtml(m.nom || 'Sans nom')}${soi ? ' <span class="pm-soi">vous</span>' : ''}</div>
          <div class="pm-role">Depuis le ${date}</div>
        </div>
        ${promouvable ? `<button type="button" class="pm-rang" data-promo="${m.id}"
          data-nom="${escapeHtml(m.nom || '')}" aria-label="Donner l\u2019acc\u00e8s \u00e0 la gestion"
          title="Donner l\u2019acc\u00e8s \u00e0 la gestion">
          <!-- ═══ UNE SILHOUETTE AVEC UN PLUS ═══

               Ni flèche montante — qui dirait « monter en grade » et placerait
               l'un au-dessus de l'autre — ni clé, qui dit « ouvrir » sans dire
               à qui.

               On ajoute quelqu'un à un groupe. C'est le sujet de cette page :
               des personnes, pas des serrures. -->
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="9.4" cy="8" r="3.6"/>
            <path d="M3.4 20.2a6 6 0 0 1 12 0"/>
            <path d="M18.6 8.4v5.2M16 11h5.2"/>
          </svg>
        </button>` : ''}
        ${retrogradable ? `<button type="button" class="pm-rang" data-retro="${m.id}"
          data-nom="${escapeHtml(m.nom || '')}" aria-label="Retirer l\u2019acc\u00e8s \u00e0 la gestion"
          title="Retirer l\u2019acc\u00e8s \u00e0 la gestion">
          <!-- La même silhouette, avec un moins : on retire de ce groupe. Le
               geste inverse du précédent, dans le même vocabulaire. -->
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="9.4" cy="8" r="3.6"/>
            <path d="M3.4 20.2a6 6 0 0 1 12 0"/>
            <path d="M16 11h5.2"/>
          </svg>
        </button>` : ''}
        ${!supprimable ? '' : `<button type="button" class="pm-suppr" data-membre="${m.id}"
          data-nom="${escapeHtml(m.nom || '')}" aria-label="Retirer de l\u2019entreprise">
          <!-- Une SORTIE, pas une poubelle. On ne jette pas quelqu'un : on lui
               retire un accès. La porte avec la flèche dit exactement ça, et
               c'est le signe employé partout pour « se déconnecter ». -->
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M14.4 20.4H6.6a2 2 0 0 1-2-2V5.6a2 2 0 0 1 2-2h7.8"/>
            <path d="M17.6 15.6L21 12l-3.4-3.6M21 12H9.6"/>
          </svg>
        </button>`}
      </div>`
  }

  const parGroupe = (l) => l.map(ligne).join('')
  const fondateurs = tries.filter(m => m.role === 'gestion' && estFondateur(m))
  const gestion    = tries.filter(m => m.role === 'gestion' && !estFondateur(m))
  const equipe     = tries.filter(m => m.role !== 'gestion')

  /* Une section vide ne s'affiche pas : un intitulé « Gestion » suivi de rien
     laisse croire à un chargement en cours. */
  const section = (titre, aide, l) => !l.length ? '' : `
    <div class="pm-groupe">
      <div class="pm-gtete">
        <span class="pm-gt">${titre}</span>
        <span class="pm-gn">${l.length}</span>
      </div>
      <div class="pm-gaide">${aide}</div>
      ${parGroupe(l)}
    </div>`

  liste.innerHTML =
    section('Fondateur', 'A cr\u00e9\u00e9 l\u2019entreprise. Son acc\u00e8s ne peut pas \u00eatre retir\u00e9.', fondateurs) +
    section('Espace gestion', 'Cr\u00e9ent les proc\u00e9dures, voient l\u2019analyse, invitent du monde.', gestion) +
    section('Espace \u00e9quipe', 'Consultent les proc\u00e9dures publi\u00e9es.', equipe)
}

/* ── La recherche ────────────────────────────────────────── */
document.getElementById('pm-chercher')?.addEventListener('input', (e) => {
  filtreEquipe = e.target.value
  document.querySelector('.pm-recherche')?.classList.toggle('remplie', !!filtreEquipe)
  peindreEquipe()
})
/* ═══ LE TRI PASSE EN MENU DÉROULANT ═══

   L'ancien écouteur gérait trois pastilles : il déplaçait une bille de fond
   avec `placerPastille` et basculait la classe `active`. Le menu déroulant a
   sa propre mécanique — ouverture commune, option marquée `selected`, libellé
   du bouton mis à jour.

   `placerPastille` n'est plus appelée ici : elle servait à animer un fond qui
   n'existe plus. */
document.getElementById('dd-pm-tri-menu')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-tri]')
  if (!b) return
  triEquipe = b.dataset.tri
  document.querySelectorAll('#dd-pm-tri-menu button')
    .forEach(x => x.classList.toggle('selected', x === b))
  const lbl = document.getElementById('dd-pm-tri-label')
  if (lbl) lbl.textContent = b.dataset.label || b.textContent.trim()
  closeAllDropdowns()
  peindreEquipe()
})

/* ═══ À QUOI SERVENT LES DEUX BOUTONS DE CHAQUE LIGNE ═══

   Une flèche et une poubelle, sans libellé. La flèche surtout : elle monte ou
   descend selon le rôle, et rien ne dit qu'elle fait passer quelqu'un en
   gestion. */
document.getElementById('p-membres')?.addEventListener('click', (e) => {
  if (!e.target.closest('[data-aide-actions]')) return
  confirmDialog({
    titre: 'Les boutons de chaque ligne',
    message:
      "\u2022 La FL\u00c8CHE change le r\u00f4le d\u2019une personne.\n" +
      "  Vers le haut : elle passe en gestion et pourra cr\u00e9er des proc\u00e9dures, " +
      "voir l\u2019analyse et inviter du monde.\n" +
      "  Vers le bas : elle repasse en \u00e9quipe et ne fait plus que lire.\n\n" +
      "\u2022 La CROIX retire la personne de l\u2019entreprise. Son compte reste, " +
      "mais elle perd l\u2019acc\u00e8s \u00e0 vos proc\u00e9dures. Ses lectures pass\u00e9es " +
      "restent dans l\u2019analyse.\n\n" +
      "Vous ne pouvez ni vous r\u00e9trograder, ni vous retirer vous-m\u00eame : " +
      "une entreprise sans gestionnaire serait inaccessible.",
    confirmer: 'Compris', annuler: '', danger: false,
  })
})

document.getElementById('pm-vider')?.addEventListener('click', () => {
  filtreEquipe = ''
  const champ = document.getElementById('pm-chercher')
  if (champ) { champ.value = ''; champ.focus() }
  document.querySelector('.pm-recherche')?.classList.remove('remplie')
  peindreEquipe()
})

/* ── La promotion ───────────────────────────────────────── */
/* La ligne n'a plus `role="button"`, ni `tabindex`, ni `data-fiche` : elle
   n'est plus cliquable. J'avais gardé l'attribut en pensant qu'il ne coûtait
   rien — mais le style s'en servait comme sélecteur pour poser un curseur en
   main et un effet d'enfoncement. La ligne réagissait donc au doigt sans rien
   faire, ce qui est pire qu'une ligne inerte. */

/* ═══ « GÉRER L'ÉQUIPE » NE MÈNE PLUS À LA FICHE ═══

   Toucher une ligne y ouvrait le profil. Mais cette page est une page
   d'ADMINISTRATION : on y change un rôle, on y retire quelqu'un. Ses lignes
   portent des boutons dangereux, et un appui à côté ouvrait une page —
   déroutant quand on venait pour promouvoir quelqu'un.

   La consultation se fait depuis l'Analyse → Équipe, dont c'est le rôle.
   Ici, seuls les boutons agissent. */

document.getElementById('pm-liste')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-promo]')
  if (!btn) return

  // Deuxième verrou, côté app : le bouton n'est déjà pas affiché, mais un droit
  // ne se garde pas sur la seule absence d'un bouton.
  if (!estFondateur(currentMembre)) return

  const nom = btn.dataset.nom || 'cette personne'
  const ok = await confirmDialog({
    titre: `Promouvoir ${nom} ?`,
    message: `${nom} rejoindra la gestion : cr\u00e9ation de proc\u00e9dures, suivi de l'\u00e9quipe, retrait de membres. ` +
      `Elle perdra en revanche l'acc\u00e8s \u00e0 l'espace \u00c9quipe. Vous restez le seul \u00e0 pouvoir promouvoir.`,
    confirmer: 'Promouvoir',
    annuler: 'Annuler',
    danger: false,
  })
  if (!ok) return

  const maj = {
    role: 'gestion',
    promu_par: currentMembre.id,
    promu_le: new Date().toISOString(),
    promu_vu: false,
  }
  let { data, error } = await supabase.from('membres')
    .update(maj).eq('id', btn.dataset.promo).select('id')

  /* ═══ LE REPLI FABRIQUAIT DE FAUX FONDATEURS ═══

     Il ne posait que `role`. Or `estFondateur` reconnaît le fondateur à
     l'ABSENCE de `promu_par` : un gestionnaire promu par ce chemin devenait
     donc indiscernable de celui qui a créé l'entreprise. Vu en base — deux
     « fondateurs » sur la même entreprise, dont un promu le 19 août.

     Ce n'était pas visible parce que le repli ne sert qu'en cas d'échec de la
     première écriture : il se déclenche rarement, et sans un mot.

     Maintenant on descend PAR PALIERS. On retente d'abord sans `promu_par`,
     qui est le seul champ pouvant tomber sur une contrainte de clé étrangère ;
     on garde ainsi `promu_le`, qui suffit à dire que la personne a été promue.
     Le rôle seul reste le dernier recours, et il se signale. */
  if (error) {
    console.warn('[promotion] écriture complète refusée :', error.message)
    const p2 = await supabase.from('membres')
      .update({ role: 'gestion', promu_le: maj.promu_le, promu_vu: false })
      .eq('id', btn.dataset.promo).select('id')
    data = p2.data; error = p2.error

    if (error) {
      console.warn('[promotion] repli partiel refusé aussi :', error.message)
      const p3 = await supabase.from('membres')
        .update({ role: 'gestion' }).eq('id', btn.dataset.promo).select('id')
      data = p3.data; error = p3.error
      if (!error) toast('Promotion faite, mais la date n\u2019a pas pu être enregistrée')
    }
  }

  if (error) { toast('\u00c9chec : ' + error.message); return }
  if (!data || !data.length) {
    toast("La base a refus\u00e9 la modification. Ex\u00e9cutez migration-promotion.sql.")
    return
  }

  const m = membresEquipe.find(x => x.id === btn.dataset.promo)
  if (m) { m.role = 'gestion'; m.promu_par = currentMembre.id }
  peindreEquipe()
  toast(`${nom} est d\u00e9sormais en gestion.`)
})

document.getElementById('pm-liste')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-retro]')
  if (!btn) return
  if (!estFondateur(currentMembre)) return

  const nom = btn.dataset.nom || 'cette personne'
  const ok = await confirmDialog({
    titre: `Repasser ${nom} en \u00e9quipe ?`,
    message: `${nom} perdra l'acc\u00e8s \u00e0 la gestion et retrouvera l'espace \u00c9quipe. ` +
      `Les proc\u00e9dures qu'elle a cr\u00e9\u00e9es restent en place.`,
    confirmer: 'Repasser en \u00e9quipe',
    annuler: 'Annuler',
    danger: true,
    /* La teinte rouge reste — le geste retire un accès, il mérite qu'on
       s'arrête. Mais l'icône dit ce qui se passe vraiment. */
    icone: ICONE_ROLE,
  })
  if (!ok) return

  /* On efface aussi la trace de promotion : si cette personne est promue à
     nouveau plus tard, elle doit revoir les félicitations. */
  let { data, error } = await supabase.from('membres')
    .update({ role: 'equipe', promu_par: null, promu_le: new Date().toISOString(), promu_vu: false })
    .eq('id', btn.dataset.retro).select('id')

  if (error) {
    const repli = await supabase.from('membres')
      .update({ role: 'equipe' }).eq('id', btn.dataset.retro).select('id')
    data = repli.data; error = repli.error
  }

  if (error) { toast('\u00c9chec : ' + error.message); return }
  if (!data || !data.length) {
    toast("La base a refus\u00e9 la modification. Ex\u00e9cutez migration-promotion.sql.")
    return
  }

  const m = membresEquipe.find(x => x.id === btn.dataset.retro)
  if (m) { m.role = 'equipe'; m.promu_par = null }
  peindreEquipe()
  toast(`${nom} est repass\u00e9 en \u00e9quipe.`)
})

document.getElementById('pm-liste')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('.pm-suppr')
  if (!btn) return

  /* Deuxième verrou : le bouton n'est déjà pas affiché, mais un droit ne se garde
     pas sur la seule absence d'un bouton. */
  const cible = membresEquipe.find(x => x.id === btn.dataset.membre)
  if (cible?.role === 'gestion' && !estFondateur(currentMembre)) {
    toast("Seul le fondateur peut retirer un gestionnaire.")
    return
  }

  const ok = await confirmDialog({
    titre: 'Retirer cet utilisateur ?',
    message: `${btn.dataset.nom || 'Cette personne'} perdra l'accès aux procédures de l'entreprise. Son compte Standix n'est pas supprimé : elle pourra rejoindre une autre entreprise.`,
    confirmer: 'Retirer',
    annuler: 'Annuler',
    danger: true,
  })
  if (!ok) return

  /* ═══ ON ÉCRIT AVANT D'EFFACER ═══

     La ligne de `membres` va disparaître : après, il ne reste ni le nom, ni la
     date, ni qui a retiré. Une information qu'on n'écrit pas ne se retrouve
     pas. On la consigne donc d'abord — si le journal n'existe pas encore en
     base, on n'empêche pas le retrait pour autant. */
  await supabase.from('mouvements').insert({
    entreprise_id: currentMembre.entreprise_id,
    genre: 'retrait',
    nom: btn.dataset.nom || cible?.nom || null,
    poste: cible?.poste || null,
    par_nom: currentMembre.nom || null,
  }).then(({ error: e }) => {
    if (e) console.warn('[mouvements] non consigné :', e.message)
  })

  const { error } = await supabase.from('membres').delete().eq('id', btn.dataset.membre)
  /* `alert()` ouvre la boîte du navigateur : elle porte le nom du site, ne suit
     pas le thème sombre, et casse net l'impression d'application. Le toast dit
     la même chose sans sortir de l'app. */
  if (error) { toast('Retrait impossible : ' + error.message); return }
  openMembres()
})

/* ═══════════════════════════════════════════════════════════════════════════
   TEMPS DE LECTURE

   Ce n'est plus l'employé qui déclare avoir compris : l'app constate qu'il est
   resté 30 secondes sur la fiche, puis enregistre la consultation elle-même.
   Un bouton ne prouvait rien — on pouvait le taper en arrivant.

   Le décompte se met en pause si la fiche est quittée ou l'app mise en veille,
   et reprend là où il s'était arrêté : lire en deux fois reste lire.
   ═══════════════════════════════════════════════════════════════════════════ */
/* Au bout d'une minute sans un geste, on s'assure que quelqu'un est bien là. */
const INACTIVITE_MAX = 60 * 1000
let derniereActivite = 0
let lectureBase = 0            // temps déjà en base avant cette visite
let veilleAvertie = false

const DUREE_LECTURE_MIN = 30

/* Au-delà de ce délai, une procédure repasse « à relire » : le bandeau
   « Procédure consultée » disparaît et le décompte se relance. Douze heures,
   c'est-à-dire d'un service à l'autre. */
const DELAI_RELECTURE = 12 * 60 * 60 * 1000
let lectureTimer = null
let lectureSecondes = 0
let lectureProcId = null
let lectureEnregistree = false

function demarrerLecture(procId, dejaConsultee) {
  arreterLecture()

  if (lectureProcId !== procId) {
    lectureProcId = procId
    lectureSecondes = 0
    const precedent = (mesLectures || []).find(v => v.procedure_id === procId)
    lectureBase = Number(precedent?.duree_lecture || 0)
  }
  lectureEnregistree = !!dejaConsultee

  const bandeau = document.getElementById('lecture-etat')?.closest('.confirm-bar')
  const err = document.getElementById('confirm-error')
  if (err) err.textContent = ''

  /* Le bandeau reste ouvert en permanence : il montre l'avancement des cases,
     dès 0 sur 8. Il ne dit plus rien de la consultation enregistrée — le membre
     n'a pas à savoir qu'un seuil a été franchi. */
  bandeau?.classList.add('visible')
  majBandeauCoches()
  derniereActivite = Date.now()
  veilleAvertie = false

  lectureTimer = setInterval(() => {
    if (document.hidden) return          // app en arrière-plan : on ne compte pas

    /* L'écran n'a pas bougé depuis une minute : on demande une confirmation avant
       de continuer à compter. Sans ça, un téléphone posé sur le plan de travail
       accumulerait des heures que personne n'a passées à lire. */
    if (Date.now() - derniereActivite > INACTIVITE_MAX) {
      if (!veilleAvertie) { veilleAvertie = true; demanderSiPresent() }
      return
    }

    lectureSecondes++

    /* On enregistre toutes les trente secondes, sans attendre la sortie. Fermer
       l'onglet, verrouiller le téléphone ou perdre le réseau ne déclenche pas
       toujours la sortie propre : sans ça, une lecture de dix minutes pouvait
       ne rien laisser. */
    if (lectureSecondes % 30 === 0) ecrireTempsLecture()

    /* La consultation s'enregistre au seuil, mais le compteur CONTINUE : c'est le
       temps total passé sur la fiche qu'on veut, pas le temps jusqu'à validation.
       Il s'arrêtait ici, d'où les trente secondes partout. */
    if (lectureSecondes >= DUREE_LECTURE_MIN && !lectureEnregistree) enregistrerConsultation()
  }, 1000)
}

/* ═══════════════════════════════════════════════════════════════════════════
   « VOUS ÊTES TOUJOURS LÀ ? »

   Un téléphone posé sur le plan de travail, écran allumé sur une procédure,
   accumulerait des heures que personne n'a passées à lire. Le temps affiché au
   responsable perdrait alors tout sens.

   Au bout d'une minute sans un seul geste, on pose donc la question. Le
   décompte reprend dès qu'on répond, et rien ne se perd.

   Ce que la fenêtre ne dit PAS, et c'est délibéré : qu'un chronomètre tourne.
   Personne ne doit lire une procédure en se sachant chronométré — on lirait
   vite au lieu de lire bien, et la mesure deviendrait fausse pour la raison
   même qui la rend utile. La question porte sur la lecture, pas sur le temps.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Tout geste compte : toucher, faire défiler, appuyer sur une touche. */
;['pointerdown', 'touchstart', 'keydown', 'scroll', 'wheel'].forEach(ev => {
  document.addEventListener(ev, () => { derniereActivite = Date.now() }, { passive: true, capture: true })
})

async function demanderSiPresent() {
  const ok = await confirmDialog({
    titre: 'Vous en \u00eates o\u00f9 ?',
    message: "Cette proc\u00e9dure est ouverte depuis un moment sans que rien ne bouge. " +
      "Reprenez o\u00f9 vous en \u00e9tiez, ou revenez-y plus tard.",
    confirmer: 'Je continue',
    annuler: 'Je reviendrai',
    danger: false,
  })

  derniereActivite = Date.now()
  veilleAvertie = false

  /* « Je reviendrai » : on écrit ce qui a été lu et on ferme la fiche. Rien
     n'est perdu, et le temps resté à l'écran ensuite ne sera pas compté. */
  if (!ok) {
    quitterLecture()
    if (currentMembre?.role === 'gestion') showGestionScreen('p-list')
    else showEquipeScreen('e-list')
  }
}

function arreterLecture() {
  if (lectureTimer) { clearInterval(lectureTimer); lectureTimer = null }
}

/* Quitter la fiche : on écrit le temps de la visite.

   C'est ce qui manquait. Le temps n'était inscrit qu'une fois, au seuil de
   trente secondes, et plus jamais ensuite : toutes les lectures finissaient
   donc à trente secondes, quelle que soit leur durée réelle. */
function quitterLecture() {
  arreterLecture()
  if (!lectureProcId || !currentMembre || lectureSecondes < 3) return
  /* Sous trois secondes, on ne retient rien : c'est un passage, pas une
     lecture. Écrire une seconde salirait la moyenne pour rien. */
  ecrireTempsLecture()
}

async function ecrireTempsLecture() {
  const total = lectureBase + lectureSecondes
  try {
    /* Le défaut symétrique de l'autre écriture : sans `etapes_faites`, l'upsert
       remettait les cases cochées à NULL. Les deux écritures envoient désormais
       la ligne complète, quel que soit ce qui les a déclenchées. */
    const ligne = {
      procedure_id: lectureProcId,
      membre_id: currentMembre.id,
      duree_lecture: total,
      validated_at: new Date().toISOString(),
    }
    if (!colonneCochesAbsente) ligne.etapes_faites = [...etapesFaites]
    await supabase.from('validations').upsert(ligne, { onConflict: 'procedure_id,membre_id' })
    /* On tient la copie locale à jour : sans ça, rouvrir la fiche dans la foulée
       repartirait de l'ancienne base et perdrait ce qu'on vient d'écrire. */
    const l = (mesLectures || []).find(v => v.procedure_id === lectureProcId)
    if (l) {
      l.duree_lecture = total
      if (!colonneCochesAbsente) l.etapes_faites = [...etapesFaites]
    }
    lectureBase = total
    lectureSecondes = 0
  } catch (e) {
    console.warn('Standix \u00b7 temps de lecture non \u00e9crit :', e?.message || e)
  }
}

/* L'enregistrement de la consultation ne se voit plus.

   Le membre n'a pas à savoir qu'un seuil a été franchi à trente secondes : cette
   information ne l'aide pas à travailler, et savoir qu'on est mesuré change la
   façon de lire — on parcourt au lieu de lire, et la mesure devient fausse pour
   la raison même qui la rend utile.

   Ce qu'il voit à la place, en permanence : où il en est dans ses étapes. */
function afficherLectureFaite() {
  majBandeauCoches()
}

function dessinerAnneauLecture(pct, couleur, texte) {
  const el = document.getElementById('lecture-anneau')
  if (!el) return
  const t = 44, ep = 4, r = (t - ep) / 2, c = 2 * Math.PI * r
  const offset = c * (1 - Math.min(100, Math.max(0, pct)) / 100)

  /* On ne redessine PLUS le cercle à chaque coche : on déplace seulement son
     tracé. Un élément qui vient de naître n'a pas d'état précédent, donc rien à
     animer — la transition CSS était écrite depuis toujours, elle ne pouvait
     simplement jamais s'appliquer. Le cercle sautait d'une position à l'autre. */
  const dejaLa = el.querySelector('.valeur')
  if (dejaLa) {
    dejaLa.setAttribute('stroke', couleur)
    dejaLa.style.strokeDashoffset = offset
    const dedans = el.querySelector('.dedans')
    if (dedans) {
      dedans.style.color = couleur
      /* Le chiffre change au milieu du parcours du trait, pas au début : sinon
         il annonce un résultat que le cercle n'a pas encore atteint. */
      if (dedans.textContent !== texte) {
        dedans.classList.remove('bascule')
        void dedans.offsetWidth
        dedans.classList.add('bascule')
        setTimeout(() => { dedans.textContent = texte }, 130)
      }
    }
    return
  }

  el.innerHTML = `
    <svg width="${t}" height="${t}">
      <circle class="piste" cx="${t/2}" cy="${t/2}" r="${r}" fill="none" stroke-width="${ep}"/>
      <circle class="valeur" cx="${t/2}" cy="${t/2}" r="${r}" fill="none" stroke-width="${ep}"
              stroke="${couleur}" stroke-dasharray="${c}"
              style="stroke-dashoffset:${offset}"/>
    </svg>
    <div class="dedans" style="color:${couleur}">${escapeHtml(texte)}</div>`
}

/* C'est l'app qui enregistre, sans rien demander. */
async function enregistrerConsultation() {
  /* On n'arrête PAS le compteur : la personne continue peut-être à lire, et son
     temps réel nous intéresse. Le décompte s'arrêtera en quittant la fiche, et
     `quitterLecture` écrira le total. */
  if (lectureEnregistree || !lectureProcId || !currentMembre) return
  lectureEnregistree = true

  /* On inscrit le temps réellement passé sur la fiche. C'est la seule mesure
     honnête dont on dispose : le décompte s'arrête dès que l'app passe en
     arrière-plan, donc ces secondes ont vraiment été passées devant l'écran. */
  /* On rafraîchit explicitement la date : sans elle, une relecture mettrait à
     jour la ligne sans changer `validated_at`, et la procédure resterait
     éternellement périmée. Et le temps s'ajoute au précédent, puisque c'est bien
     le total passé sur cette procédure que l'on veut connaître. */
  /* `lectureBase` est le total déjà en base au début de cette visite. On écrit
     toujours `base + secondes de la visite` : l'écriture peut donc être répétée
     sans jamais compter deux fois. C'est ce qui permet de sauver aussi à la
     sortie de la fiche. */
  const cumul = lectureBase + lectureSecondes

  const { error } = await supabase.from('validations').upsert(
    {
      procedure_id: lectureProcId,
      membre_id: currentMembre.id,
      duree_lecture: cumul,
      validated_at: new Date().toISOString(),
    },
    { onConflict: 'procedure_id,membre_id' }
  )
  // Si la colonne n'existe pas encore en base, on réessaie sans elle.
  if (error && /duree_lecture/i.test(error.message || '')) {
    const repli = await supabase.from('validations').upsert(
      { procedure_id: lectureProcId, membre_id: currentMembre.id, validated_at: new Date().toISOString() },
      { onConflict: 'procedure_id,membre_id' }
    )
    if (!repli.error) { afficherLectureFaite(true); loadEquipeProcedures(); return }
  }

  if (error) {
    // On ne bloque pas la lecture : on signale et on laissera une autre visite retenter.
    lectureEnregistree = false
    const err = document.getElementById('confirm-error')
    if (err) {
      err.textContent = "La consultation n'a pas pu être enregistrée : " + error.message
      // On déplie le bandeau uniquement pour que le message soit lisible.
      err.closest('.confirm-bar')?.classList.add('visible')
      document.getElementById('lecture-etat').style.display = 'none'
    }
    return
  }

  afficherLectureFaite(true)
  const etat = document.getElementById('lecture-etat')
  if (etat) { etat.classList.remove('pointe'); void etat.offsetWidth; etat.classList.add('pointe') }
  loadEquipeProcedures()
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHOIX DES LANGUES
   ═══════════════════════════════════════════════════════════════════════════ */

/* Le même sélecteur dans les deux espaces : le gérant a autant de raisons de
   changer de langue que ses équipiers. */
function rendreChoixLangueApp() {
  const balisage = LANGUES.map(l => `
    <button type="button" class="langue-choix${l.code === langueApp ? ' actif' : ''}" data-langue="${l.code}">
      <span class="dr">${l.drapeau}</span>
      <span class="nm">${l.nom}</span>
      ${l.code === langueApp ? '<span class="coche">\u2713</span>' : ''}
    </button>`).join('')

  for (const id of ['langue-app', 'langue-app-gestion']) {
    const zone = document.getElementById(id)
    if (zone) zone.innerHTML = balisage
  }
}

for (const id of ['langue-app', 'langue-app-gestion']) {
  document.getElementById(id)?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-langue]')
    if (!b) return
    definirLangue(b.dataset.langue)
    rendreChoixLangueApp()
    peindreReglages()
    peindreReglagesEquipe()
    toast(LANGUES.find(l => l.code === langueApp)?.nom || '')
  })
}

/* ── Traduction d'une procédure ───────────────────────────────────

   Les traductions sont gardées en mémoire le temps de la session : relire la
   même procédure dans la même langue ne recoute rien et ne fait pas attendre.
   Rien n'est écrit en base : l'original reste la référence. */
const traductionsEnCache = {}
let langueProcCourante = 'fr'
let procCouranteId = null

/* Le globe, dans la langue des icônes de création : trait blanc, aucun aplat. */
const ICONE_TERRE = `<svg class="terre" viewBox="0 0 24 24" fill="none"
  stroke="rgba(255,255,255,0.88)" stroke-width="1.7" stroke-linecap="round">
  <circle cx="12" cy="12" r="9"/>
  <ellipse cx="12" cy="12" rx="3.8" ry="9"/>
  <line x1="3.4" y1="9" x2="20.6" y2="9"/>
  <line x1="3.4" y1="15" x2="20.6" y2="15"/>
</svg>`

function rondLangueHtml(code, estTete) {
  const l = LANGUES.find(x => x.code === code)
  const dedans = (estTete && langueProcCourante === 'fr')
    ? ICONE_TERRE
    : `<span class="code">${(l?.code || '').toUpperCase()}</span>`
  // La tête porte déjà la langue lue : les autres sont toutes des choix.
  const classes = 'rond-ent'
  const attr = estTete ? 'data-langue-decl' : `data-langue-choix="${code}"`
  return `<button type="button" class="${classes}" ${attr}
    aria-label="${escapeHtml(l?.nom || code)}">${dedans}</button>`
}

/* Le tiroir ne se dessine que sur la fiche d'une procédure, et seulement pour
   quelqu'un qui lit — traduire n'a de sens que là. */
function peindreTiroirLangue() {
  const liste = document.getElementById('tiroir-langue-liste')
  if (!liste) return

  const autres = LANGUES.filter(l => l.code !== langueProcCourante)
    .map(l => rondLangueHtml(l.code, false)).join('')

  liste.innerHTML = rondLangueHtml(langueProcCourante, true) +
    '<span class="tiroir-autres">' + autres + '</span>'
}

/* On ne REDESSINE PAS à l'ouverture ni à la fermeture : c'était la cause de
   l'absence d'animation. `peindreTiroirLangue` remplace tout le contenu, donc
   les ronds sont des éléments neufs — et une transition CSS ne joue pas sur un
   élément qui vient d'apparaître : le navigateur n'a pas d'état précédent d'où
   partir. Il suffit de basculer la classe et de laisser le CSS travailler, comme
   le fait le tiroir des entreprises. */
function fermerTiroirLangue() {
  const t = document.getElementById('tiroir-langue')
  if (t?.classList.contains('ouvert')) t.classList.remove('ouvert')
}

document.addEventListener('click', (e) => {
  const t = document.getElementById('tiroir-langue')
  if (!t || t.offsetParent === null) return          // fiche non affichée

  if (e.target.closest('[data-langue-decl]')) {
    t.classList.toggle('ouvert')
    return
  }
  const choix = e.target.closest('[data-langue-choix]')
  if (choix) { fermerTiroirLangue(); traduireProcedure(choix.dataset.langueChoix); return }
  if (e.target.closest('#tiroir-langue')) return

  fermerTiroirLangue()
})

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermerTiroirLangue() })

async function traduireProcedure(choix) {
  if (!choix || choix === langueProcCourante) return

  if (choix === 'fr') {
    langueProcCourante = 'fr'
    openEquipeDetail(procCouranteId)
    return
  }

  const cle = procCouranteId + ':' + choix
  const tete = document.querySelector('#tiroir-langue-liste > .rond-ent')

  if (!traductionsEnCache[cle]) {
    /* Pendant l'attente, le rond de tête tourne : on ne fige pas l'écran pour
       une traduction, et on ne prétend pas non plus connaître sa durée. */
    tete?.classList.add('patiente')
    try {
      const etapes = [...document.querySelectorAll('#detail-steps .detail-step p')].map(e => e.textContent)
      const rep = await fetch(`${SUPABASE_URL}/functions/v1/ai-traduire`, {
        method: 'POST',
        headers: await enTeteFonction(),
        body: JSON.stringify({
          langue: choix,
          titre: document.getElementById('detail-titre').textContent,
          etapes,
        }),
      })
      const data = await rep.json()
      if (!rep.ok || data.error) throw new Error(data.error || 'La traduction a \u00e9chou\u00e9.')
      traductionsEnCache[cle] = data
    } catch (ex) {
      tete?.classList.remove('patiente')
      await confirmDialog({
        titre: 'Traduction impossible',
        message: ex instanceof Error ? ex.message : String(ex),
        confirmer: 'Compris', annuler: 'Fermer', danger: false,
      })
      return
    }
    tete?.classList.remove('patiente')
  }

  langueProcCourante = choix
  appliquerTraduction(traductionsEnCache[cle])
  peindreTiroirLangue()
}

function appliquerTraduction(trad) {
  document.getElementById('detail-titre').textContent = trad.titre
  const lignes = [...document.querySelectorAll('#detail-steps .detail-step p')]
  trad.etapes.forEach((texte, i) => { if (lignes[i]) lignes[i].textContent = texte })
  majBoutonLangueProc()

  /* Un bandeau rappelle qu'on lit une traduction, avec le retour à l'original à
     portée de doigt. Une consigne de travail traduite automatiquement peut
     comporter une nuance perdue : autant que ce soit dit. */
  /* LE BANDEAU A ÉTÉ RETIRÉ.

     Il disait « traduction automatique, l'original français fait foi » et
     offrait un retour au français. Trois raisons de le supprimer :

     La langue choisie est déjà visible en haut, dans le rond des langues — on
     sait qu'on lit une traduction, on vient de la demander.

     Revenir au français se fait au même endroit, en un geste. Un second chemin
     vers la même action encombre sans rien apporter.

     Et surtout : un employé qui ne lit pas le français n'a que faire de savoir
     que l'original fait foi. On lui rappelle sa dépendance sans lui donner de
     moyen d'agir. */
}

/* Conservé sous son ancien nom : la fiche l'appelle à chaque ouverture. */
function majBoutonLangueProc() {
  peindreTiroirLangue()
}

// ═══════════ ÉQUIPE : scanner ═══════════
/* Le même scanner sert aux deux espaces : côté équipe il ouvre la fiche à
   consulter, côté gestion la page d'analyse de la procédure. Les éléments
   sont dupliqués avec un préfixe pour éviter deux identifiants identiques. */
let scanEspace = 'equipe'
const scanEl = (nom) => document.getElementById((scanEspace === 'gestion' ? 'g-' : '') + nom)

window.startScanner = async function(espace) {
  scanEspace = espace === 'gestion' ? 'gestion' : 'equipe'
  const hintEl = scanEl('scan-hint')
  const video = scanEl('scan-video')
  const zone = scanEl('scan-result-zone')
  zone.innerHTML = ''

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    echecScanner(hintEl, zone, "Ce navigateur ne donne pas accès à la caméra.",
      "La caméra n'est accessible qu'en HTTPS. Ouvrez l'app depuis son adresse habituelle plutôt qu'un fichier local.")
    return
  }

  try {
    // On ouvre la caméra AVANT de charger le lecteur de codes : l'autorisation
    // est demandée tout de suite et l'aperçu s'affiche, même si la
    // bibliothèque met du temps à arriver. Dans l'autre sens, un réseau lent
    // laissait l'écran bloqué sur « Chargement » sans rien montrer.
    hintEl.textContent = 'Ouverture de la caméra...'
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }, audio: false,
    })
    video.srcObject = scanStream
    brancherLampe(scanStream)
    try { await video.play() } catch (e) { /* l'attribut autoplay prend le relais */ }

    hintEl.textContent = 'Préparation du lecteur...'
    await ensureJsQR()

    /* Le lecteur tourne : on revient au texte d'origine, complet. */
    remettreConsigne(hintEl)
    scanLoopActive = true
    requestAnimationFrame(scanLoop)
  } catch (e) {
    stopScanner()
    const nom = e && e.name
    if (nom === 'NotAllowedError' || nom === 'SecurityError') {
      /* Le cinquième argument déclenche la marche à suivre détaillée. */
      echecScanner(hintEl, zone, '', '', true)
    } else if (nom === 'NotFoundError' || nom === 'OverconstrainedError') {
      echecScanner(hintEl, zone, "Aucune caméra détectée sur cet appareil.", '')
    } else if (nom === 'NotReadableError') {
      echecScanner(hintEl, zone, "La caméra est déjà utilisée par une autre application.",
        "Fermez l'app qui l'utilise, puis réessayez.")
    } else {
      echecScanner(hintEl, zone, "Le scanner n'a pas pu démarrer.",
        (nom ? nom + ' — ' : '') + ((e && e.message) || 'raison inconnue'))
    }
  }
}

// Message d'échec lisible, avec un bouton pour retenter
/* Le chemin exact pour rendre la caméra, selon l'appareil et le navigateur.

   Un message générique — « autorisez la caméra » — ne sert à rien : une fois
   refusée, l'autorisation ne se redemande plus. Le navigateur ne la reposera
   pas, il faut aller la changer dans les réglages, et personne ne sait où.

   On détecte donc l'appareil et on donne les touches à suivre, dans l'ordre. */
/* La consigne sous le titre, dans l'image. Elle sert aussi à dire où en est
   l'ouverture de la caméra — mais elle revient toujours à son texte d'origine. */
const CONSIGNE = 'Visez le QR code'

function remettreConsigne(el) {
  if (el) el.textContent = CONSIGNE
}

/* ═══════════════════════════════════════════════════════════════════════════
   OÙ RÉTABLIR L'ACCÈS À LA CAMÉRA

   Un navigateur qui a refusé la caméra ne la redemande jamais tout seul. Il
   faut aller la rétablir dans ses réglages — et le chemin diffère selon
   l'appareil ET le navigateur.

   ⚠ SUR iOS, LE MOTEUR EST LE MÊME MAIS PAS L'INTERFACE. Chrome et Firefox
     pour iPhone emploient bien WebKit, mais ils ont leur propre barre
     d'adresse : le menu `ᴀA` de Safari n'y existe pas. L'ancienne version
     donnait donc une consigne impossible à suivre pour eux.

   ⚠ ET LE `ᴀA` EST EN BAS DEPUIS iOS 15, pas en haut. On ne dit plus où il
     se trouve : « dans la barre d'adresse » vaut pour les deux dispositions,
     et personne ne cherche longtemps un bouton sur une barre.
   ═══════════════════════════════════════════════════════════════════════════ */
function cheminReglagesCamera() {
  const ua = navigator.userAgent
  const iOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const android = /Android/.test(ua)

  /* L'ordre des tests compte : Chrome sur iOS contient « CriOS » ET « Safari »
     dans son identifiant. Chercher Safari en premier le classerait mal. */
  const criOS = /CriOS/.test(ua)
  const fxiOS = /FxiOS/.test(ua)
  const edgiOS = /EdgiOS/.test(ua)

  if (iOS) {
    /* Chrome, Firefox et Edge sur iPhone : pas de menu `ᴀA`. Leur autorisation
       se règle dans les réglages du système, sous le nom de l'app. */
    if (criOS || fxiOS || edgiOS) {
      const nom = criOS ? 'Chrome' : fxiOS ? 'Firefox' : 'Edge'
      return {
        appareil: `${nom} sur iPhone`,
        etapes: [
          `Ouvrez <b>R\u00e9glages</b> \u2192 <b>${nom}</b>`,
          'Activez <b>Cam\u00e9ra</b>',
          `Revenez dans ${nom} et touchez <b>R\u00e9essayer</b>`,
        ],
        repli: `Si l\u2019app n\u2019appara\u00eet pas dans R\u00e9glages : R\u00e9glages \u2192 ` +
               `Confidentialit\u00e9 et s\u00e9curit\u00e9 \u2192 Cam\u00e9ra \u2192 ${nom}.`,
      }
    }

    /* Safari. Le `ᴀA` est en bas depuis iOS 15, en haut avant : on ne dit pas
       où, seulement dans quelle barre. */
    return {
      appareil: 'Safari sur iPhone',
      etapes: [
        'Touchez le <b>\u1d00A</b> dans la barre d\u2019adresse',
        'Choisissez <b>R\u00e9glages du site web</b>',
        'Mettez <b>Cam\u00e9ra</b> sur <b>Autoriser</b>',
        'Touchez <b>R\u00e9essayer</b>',
      ],
      repli: 'Si le menu n\u2019appara\u00eet pas : R\u00e9glages \u2192 Safari \u2192 Cam\u00e9ra \u2192 Autoriser.',
    }
  }

  if (android) {
    const samsung = /SamsungBrowser/.test(ua)
    const firefox = /Firefox|FxiOS/.test(ua)
    const edge = /EdgA/.test(ua)

    if (samsung) {
      return {
        appareil: 'Samsung Internet',
        etapes: [
          'Touchez le <b>cadenas</b> dans la barre d\u2019adresse',
          'Ouvrez <b>Autorisations</b>',
          'Mettez <b>Cam\u00e9ra</b> sur <b>Autoriser</b>',
          'Touchez <b>R\u00e9essayer</b>',
        ],
        repli: 'Ou : menu \u2261 \u2192 Param\u00e8tres \u2192 Sites et t\u00e9l\u00e9chargements \u2192 ' +
               'Autorisations des sites \u2192 Cam\u00e9ra.',
      }
    }

    if (firefox) {
      return {
        appareil: 'Firefox sur Android',
        etapes: [
          'Touchez le <b>cadenas</b> \u00e0 gauche de l\u2019adresse',
          'Ouvrez <b>Autorisations du site</b>',
          'Mettez <b>Cam\u00e9ra</b> sur <b>Autoris\u00e9</b>',
          'Touchez <b>R\u00e9essayer</b>',
        ],
        repli: '',
      }
    }

    /* Chrome et Edge partagent la même interface sur Android. */
    return {
      appareil: edge ? 'Edge sur Android' : 'Chrome sur Android',
      etapes: [
        'Touchez le <b>cadenas</b> \u00e0 gauche de l\u2019adresse',
        'Ouvrez <b>Autorisations</b> ou <b>Param\u00e8tres du site</b>',
        'Mettez <b>Cam\u00e9ra</b> sur <b>Autoriser</b>',
        'Touchez <b>R\u00e9essayer</b>',
      ],
      repli: 'Si la cam\u00e9ra n\u2019appara\u00eet pas : R\u00e9glages du t\u00e9l\u00e9phone \u2192 Applications ' +
             '\u2192 le navigateur \u2192 Autorisations \u2192 Appareil photo.',
    }
  }

  /* Ordinateur. Le cadenas est universel — Chrome, Firefox, Edge et Safari le
     portent tous, au même endroit. */
  const safariMac = /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)
  if (safariMac) {
    return {
      appareil: 'Safari sur Mac',
      etapes: [
        'Menu <b>Safari</b> \u2192 <b>R\u00e9glages pour ce site web</b>',
        'Mettez <b>Cam\u00e9ra</b> sur <b>Autoriser</b>',
        'Rechargez la page, puis touchez <b>R\u00e9essayer</b>',
      ],
      repli: '',
    }
  }

  return {
    appareil: 'votre navigateur',
    etapes: [
      'Cliquez sur le <b>cadenas</b> \u00e0 gauche de l\u2019adresse',
      'Mettez <b>Cam\u00e9ra</b> sur <b>Autoriser</b>',
      'Rechargez la page, puis cliquez sur <b>R\u00e9essayer</b>',
    ],
    repli: '',
  }
}

function echecScanner(hintEl, zone, titre, detail, refus) {
  /* On NE VIDE PLUS la consigne. « Scanner un code / Visez le QR code » reste
     affiché quoi qu'il arrive : c'est le titre de la page, pas un indicateur
     d'état. Le vider laissait un cadre noir sans le moindre mot. */
  remettreConsigne(hintEl)

  /* Sans le refus explicite, on garde le message court : inutile d'expliquer
     comment rétablir une autorisation quand le problème vient d'ailleurs. */
  if (!refus) {
    zone.innerHTML = `
      <div class="scan-echec">
        <div class="t">${escapeHtml(titre)}</div>
        ${detail ? `<div class="s">${escapeHtml(detail)}</div>` : ''}
        <button type="button" class="btn block" id="scan-retry">R\u00e9essayer</button>
      </div>`
    zone.querySelector('#scan-retry').addEventListener('click', () => startScanner(scanEspace))
    return
  }

  const c = cheminReglagesCamera()
  zone.innerHTML = `
    <div class="scan-echec">
      <span class="ic">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 7.6A2.5 2.5 0 0 1 5 5.1h2.4l1.5-2h6.2l1.5 2H19a2.5 2.5 0 0 1 2.5 2.5v9.3A2.5 2.5 0 0 1 19 19.4H5a2.5 2.5 0 0 1-2.5-2.5z"/><line x1="3" y1="3" x2="21" y2="21"/></svg>
      </span>
      <div class="t">La cam\u00e9ra est bloqu\u00e9e</div>
      <!-- Le nom du navigateur DANS la phrase : « voici comment le rétablir sur
           Chrome sur iPhone » confirme qu'on parle bien de celui qu'on a sous
           les yeux. Sans ce nom, on doute que les étapes s'appliquent. -->
      <div class="s">Votre navigateur a refus\u00e9 l\u2019acc\u00e8s et ne le redemandera pas tout seul.<br>Voici comment le r\u00e9tablir sur <b>${escapeHtml(c.appareil)}</b>.</div>
      <ol class="pas">
        ${c.etapes.map(e => `<li>${e}</li>`).join('')}
      </ol>
      ${c.repli ? `<div class="repli">${c.repli}</div>` : ''}
      <button type="button" class="btn block" id="scan-retry">R\u00e9essayer</button>
    </div>`
  zone.querySelector('#scan-retry').addEventListener('click', () => startScanner(scanEspace))
}
/* ═══ LE BOUTON QUI ÉTEINT LA CAMÉRA ═══

   Il n'apparaît que sur l'écran du scanner, côté équipe. Partout ailleurs il
   n'y a pas de caméra à éteindre, et un bouton qui ne fait rien inquiète plus
   qu'il ne sert.

   Éteindre libère vraiment le capteur : la pastille verte de l'iPhone s'éteint.
   C'est le point important — masquer l'image sans couper le flux laisserait
   croire que la caméra est arrêtée alors qu'elle filme encore. */
let camEteinte = false

function majBoutonCamera() {
  /* Les deux espaces ont leur propre viseur, donc leur propre bouton. */
  document.querySelectorAll('.scan-cam').forEach(b => {
    b.classList.toggle('eteinte', camEteinte)
    b.setAttribute('aria-label', camEteinte ? 'Rallumer la cam\u00e9ra' : '\u00c9teindre la cam\u00e9ra')
  })
}

/* On écoute le document plutôt que chaque bouton : ils sont deux, et le
   viseur est redessiné à chaque ouverture. */
document.addEventListener('click', (e) => {
  if (!e.target.closest('.scan-cam')) return
  ;(() => {
  camEteinte = !camEteinte
  if (camEteinte) {
    stopScanner()
    const z = scanEl('scan-result-zone')
    if (z) z.innerHTML = ''
    const h = scanEl('scan-hint')
    if (h) h.textContent = 'Cam\u00e9ra \u00e9teinte'
  } else {
    startScanner(scanEspace || 'equipe')
  }
  majBoutonCamera()
  if (navigator.vibrate) navigator.vibrate(6)
  })()
})

function stopScanner() {
  scanLoopActive = false
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null }
}
const scanCanvas = document.createElement('canvas')
const scanCtx = scanCanvas.getContext('2d')
function scanLoop() {
  if (!scanLoopActive) return
  const video = scanEl('scan-video')
  if (!video || !jsQRLib) return
  if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
    scanCanvas.width = video.videoWidth; scanCanvas.height = video.videoHeight
    scanCtx.drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height)
    const imageData = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height)
    const code = jsQRLib(imageData.data, imageData.width, imageData.height)
    if (code) { handleScanResult(code.data); return }
  }
  requestAnimationFrame(scanLoop)
}
/* Après un scan, on ne saute pas dans la procédure : on la nomme et on demande
   confirmation. La personne voit ce qu'elle a scanné avant d'y entrer — et si
   le code n'était pas le bon, elle s'en aperçoit tout de suite. */
async function confirmerOuvertureScan(procId, espace) {
  let titre = null, categorie = null
  const enMemoire = (espace === 'gestion' ? allGestionProcedures : allEquipeProcedures)
    .find(p => p.id === procId)
  if (enMemoire) { titre = enMemoire.titre; categorie = enMemoire.categorie }
  else {
    const { data } = await supabase.from('procedures')
      .select('titre, categorie').eq('id', procId).maybeSingle()
    if (data) { titre = data.titre; categorie = data.categorie }
  }

  if (!titre) {
    await confirmDialog({
      titre: 'Proc\u00e9dure introuvable',
      message: "Ce code correspond \u00e0 une proc\u00e9dure qui n'existe plus, ou qui appartient \u00e0 une autre entreprise.",
      confirmer: 'Compris', annuler: 'Fermer', danger: false,
    })
    return
  }

  /* La fenêtre de bienvenue est un moment de découverte : elle n'a de sens que
     la première fois. Un employé qui scanne son dixième QR de la semaine n'a pas
     besoin qu'on lui souhaite la bienvenue — il veut sa procédure. */
  if (espace !== 'gestion') {
    /* Personne n'entre dans une procédure sans l'avoir confirmé : c'était trop
       direct, et un QR peut être mal visé. Les nouveaux ont l'accueil complet
       avec le Memoji, les autres une confirmation sobre. */
    const nouveau = estNouvelUtilisateur()
    if (nouveau) marquerBienvenueVue()
    const ok = await fenetreBienvenue(titre, categorie, nouveau)
    if (!ok) return
  }

  if (espace === 'gestion') openAnalyse(procId)
  else openEquipeDetail(procId)
}

/* Nouvel utilisateur : quelqu'un qui n'a encore consulté aucune procédure, et
   à qui l'on n'a pas déjà souhaité la bienvenue sur cet appareil. Les deux
   conditions se complètent : la première vient de la base et vaut partout, la
   seconde évite de répéter l'accueil à quelqu'un qui scanne deux fois avant
   d'avoir lu quoi que ce soit. */
function estNouvelUtilisateur() {
  if (currentMembre?.role === 'gestion') return false
  try { if (localStorage.getItem('procedo_bienvenue') === '1') return false } catch (e) {}
  const aDejaLu = (mesLectures || []).length > 0 || (equipeLues && equipeLues.size > 0)
  return !aDejaLu
}

function marquerBienvenueVue() {
  try { localStorage.setItem('procedo_bienvenue', '1') } catch (e) {}
}

/* Fenêtre d'accueil : le Memoji salue, la procédure est nommée, un bouton pour
   y entrer. On voit ce qu'on a scanné avant d'y aller — et si le code n'était
   pas le bon, on s'en aperçoit tout de suite. */
/* Pose le nom de la procédure dans une fenêtre déjà ouverte : la fenêtre apparaît
   avant que le nom soit lu en base, il se met en place ensuite. */
function majFenetreBienvenue(titre, categorie) {
  const f = document.querySelector('.bienvenue-fond')
  if (!f) return
  const t = f.querySelector('.proc .t')
  if (t) t.textContent = titre || ''
  const c = f.querySelector('.proc .c')
  if (c) c.textContent = categorie || ''
  else if (categorie) {
    f.querySelector('.proc')?.insertAdjacentHTML('beforeend',
      `<div class="c">${escapeHtml(categorie)}</div>`)
  }
}

function fermerFenetreBienvenue() {
  document.querySelector('.bienvenue-fond')?.remove()
}

function fenetreBienvenue(titre, categorie, avecAccueil) {
  return new Promise((resoudre) => {
    const prenom = (currentMembre?.nom || '').trim().split(' ')[0]
    const fond = document.createElement('div')
    fond.className = 'bienvenue-fond' + (avecAccueil ? '' : ' sobre')
    fond.innerHTML = `
      <div class="bienvenue" role="dialog" aria-modal="true">
        ${avecAccueil ? '<div class="salut"></div>' : '<div class="code-ic">\u2713</div>'}
        <h3>Code reconnu</h3>
        <div class="intro">Ce code correspond \u00e0 la proc\u00e9dure suivante.</div>
        <div class="proc">
          <div class="t">${escapeHtml(titre || '\u2026')}</div>
          ${categorie ? `<div class="c">${escapeHtml(categorie)}</div>` : ''}
        </div>
        <button type="button" class="btn block ouvrir">Acc\u00e9der \u00e0 la proc\u00e9dure</button>
        <button type="button" class="refus">Ce n'est pas celle-l\u00e0</button>
      </div>`
    document.body.appendChild(fond)
    requestAnimationFrame(() => fond.classList.add('shown'))

    let fait = false
    const fermer = (valeur) => {
      if (fait) return
      fait = true
      fond.classList.remove('shown')
      setTimeout(() => { fond.remove(); resoudre(valeur) }, 300)
    }
    fond.querySelector('.ouvrir').addEventListener('click', () => fermer(true))
    fond.querySelector('.refus').addEventListener('click', () => fermer(false))
    fond.addEventListener('click', (e) => { if (e.target === fond) fermer(false) })
  })
}

function handleScanResult(text) {
  const espace = scanEspace
  stopScanner()
  scanEl('scan-hint').textContent = 'Code reconnu'
  let procId = null
  try { const url = new URL(text); procId = url.searchParams.get('proc') } catch (e) {}
  const resultZone = scanEl('scan-result-zone')
  if (procId) {
    resultZone.innerHTML = `
      <div class="scan-result">
        <div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
        <div><div style="font-weight:300; font-size:14px;">Code reconnu</div><div style="font-size:12.5px; color:var(--label-2);">Ouverture de la procédure...</div></div>
      </div>`
    setTimeout(() => confirmerOuvertureScan(procId, espace), 400)
  } else {
    resultZone.innerHTML = `<div class="error-msg">Ce code ne correspond à aucune procédure Standix.</div>`
  }
}

/* La lampe du téléphone. Une cuisine est souvent sombre, et un QR code collé
   sur un plan de travail inox renvoie mal la lumière ambiante.

   Toutes les caméras ne l'exposent pas : sur celles qui ne savent pas, le
   bouton disparaît plutôt que de rester là sans rien faire. */
let fluxScan = null

function brancherLampe(flux) {
  fluxScan = flux
  const piste = flux?.getVideoTracks?.()[0]
  const possible = !!piste?.getCapabilities?.().torch

  document.querySelectorAll('.scan-lampe').forEach(b => {
    b.style.display = possible ? 'flex' : 'none'
    b.classList.remove('on')
  })
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('.scan-lampe')
  if (!b) return
  const piste = fluxScan?.getVideoTracks?.()[0]
  if (!piste) return
  const allumee = !b.classList.contains('on')
  try {
    await piste.applyConstraints({ advanced: [{ torch: allumee }] })
    b.classList.toggle('on', allumee)
  } catch (err) {
    console.warn('Standix \u00b7 lampe indisponible :', err?.message || err)
    b.style.display = 'none'
  }
})

function setButtonLoading(btn, isLoading, loadingText) {
  if (isLoading) {
    btn.dataset.originalText = btn.innerHTML
    btn.dataset.loading = 'true'
    btn.innerHTML = `<span class="btn-spinner"></span>${loadingText ? ' ' + loadingText : ''}`
  } else {
    btn.innerHTML = btn.dataset.originalText || btn.innerHTML
    btn.dataset.loading = 'false'
  }
}

// ═══════════ GESTION : Modifier une procédure (aussi utilisé pour valider la génération IA) ═══════════
let editProcedureId = null
let editMode = 'edit' // 'edit' | 'ai-review'
let editStepsData = [] // { id: uuid|null, texte, timestamp_video }
let editVideoUrl = null
let conventionClips = 'fin'   // sens de lecture des horodatages : 'debut' | 'fin'
let clipsDeduits = false      // vrai si les bornes ont été déduites, pas lues en base

/* ═══════════════════════════════════════════════════════════════════════════
   LE BANDEAU DE PUBLICATION

   Une procédure naît en brouillon. Ce bandeau dit où elle en est et porte le
   bouton qui la met en ligne.

   ⚠ IL N'APPARAÎT QUE POUR LA GESTION. Un membre en équipe ne voit jamais un
     brouillon — la politique RLS l'en empêche — donc il n'a pas à voir ce
     bandeau non plus. */
/* L'état affiché la dernière fois, pour savoir s'il y a BASCULEMENT ou simple
   affichage. Sans cette mémoire, on ne peut pas faire la différence entre
   « la procédure vient d'être publiée » et « on ouvre une procédure publiée ». */
let dernierEtatPub = { id: null, publiee: null }
let minuteurPubAnim = null

function peindrePublication(proc) {
  const b = document.getElementById('pub-bandeau')
  if (!b) return
  if (!proc || currentMembre?.role !== 'gestion') { b.hidden = true; return }

  /* ⚠ LE BOUTON PUBLIE `editProcedureId`. Cette variable n'était posée que par
     `openEditProcedure`, qui n'est appelée nulle part : le bouton n'aurait rien
     eu à publier.

     On la pose ici, au moment où l'on peint. Le bandeau et le bouton parlent
     ainsi toujours de la même procédure. */
  editProcedureId = proc.id

  const publiee = !!proc.publiee_le

  /* ═══ L'ANIMATION DU BASCULEMENT ═══

     Elle ne doit jouer QUE sur un vrai changement, vu à l'écran. Trois
     conditions, et chacune corrige un cas où elle se déclenchait à tort :

       · même procédure — sinon ouvrir une procédure publiée après une en
         brouillon aurait animé un basculement qui n'a pas eu lieu ;
       · bandeau déjà visible — à l'ouverture d'une fiche, il n'y a rien à
         faire basculer, il y a un état à afficher ;
       · état réellement différent — `peindrePublication` est appelée deux
         fois à chaque ouverture, une fois depuis le cache et une fois avec
         la réponse de la base.

     La classe est posée AVANT le basculement : c'est elle qui autorise la
     transition de couleur du fond. Posée après, la couleur serait déjà à sa
     valeur d'arrivée et il n'y aurait rien à animer. */
  const bascule = dernierEtatPub.id === proc.id &&
                  dernierEtatPub.publiee !== null &&
                  dernierEtatPub.publiee !== publiee &&
                  !b.hidden
  dernierEtatPub = { id: proc.id, publiee }

  if (bascule && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    b.classList.remove('pub-anim')
    void b.offsetWidth        // force la reprise à zéro si l'on rebascule vite
    b.classList.add('pub-anim')
    clearTimeout(minuteurPubAnim)
    minuteurPubAnim = setTimeout(() => b.classList.remove('pub-anim'), 700)
  }

  b.hidden = false
  b.classList.toggle('pub-bandeau--ok', publiee)

  const ic = document.getElementById('pub-ic')
  const ti = document.getElementById('pub-titre')
  const so = document.getElementById('pub-sous')
  const bt = document.getElementById('pub-btn')

  if (publiee) {
    ic.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9"/><path d="M8.4 12.2l2.6 2.6 4.6-5.2"/></svg>`
    /* ⚠ « EN LIGNE », PAS « EN LIGNE POUR VOTRE ÉQUIPE ». Le titre long se
       cassait en deux lignes entre la pastille et le bouton, et la carte
       montait d'un cran. Pour qui : le bouton « Retirer » juste à côté et la
       page entière le disent déjà. */
    ti.textContent = 'En ligne'
    /* La date, pas seulement le fait : « publiée » sans quand laisse penser
       que c'est peut-être ancien, ou peut-être à l'instant. */
    so.textContent = 'Depuis le ' + dateEnClair(proc.publiee_le)
    bt.textContent = 'Retirer'
    bt.className = 'pub-btn pub-btn--retirer'
  } else {
    ic.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9"/><path d="M12 7.6v5"/>
      <circle cx="12" cy="16.4" r="0.9" fill="currentColor" stroke="none"/></svg>`
    /* ═══ CE QUE VOIT QUI ═══

       « Vous seul la voyez » était faux : tous les membres de la gestion la
       voient, pas seulement celui qui l'a créée.

       Ta phrase, allégée : « seuls ceux qui ont accès à l'espace gestion
       peuvent y accéder » répétait « accès » deux fois en six mots. */
    ti.textContent = 'Brouillon'
    /* ═══ UNE LIGNE, PAS TROIS ═══

       « Visible par l'espace gestion uniquement. Publiez-la pour que votre
       équipe puisse la lire. » disait deux fois la même chose et faisait
       monter la carte à trois lignes de texte.

       Ce qui compte tient en six mots : l'équipe ne la voit pas. Le bouton
       juste à côté dit déjà quoi faire — le répéter en toutes lettres, c'est
       expliquer un bouton qui n'en a pas besoin. */
    so.textContent = 'Votre équipe ne la voit pas'
    bt.textContent = 'Publier'
    bt.className = 'pub-btn'
  }
}

/* La date en toutes lettres : « 12 août » plutôt qu'une date technique. */
function dateEnClair(iso) {
  try {
    return new Date(iso).toLocaleDateString('fr-FR',
      { day: 'numeric', month: 'long', year: 'numeric' })
  } catch { return '—' }
}

/* ═══ PUBLIER, OU RETIRER ═══

   Une seule fonction pour les deux sens : on pose une date, ou on l'efface.

   Le retrait demande confirmation, pas la publication. Publier est réversible
   en un clic ; retirer coupe l'accès à des gens qui l'avaient — c'est le geste
   qui mérite qu'on s'arrête. */
document.getElementById('pub-btn')?.addEventListener('click', async () => {
  if (!editProcedureId) return
  const bt = document.getElementById('pub-btn')
  const retrait = bt.classList.contains('pub-btn--retirer')

  if (retrait) {
    const ok = await confirmDialog({
      titre: 'Retirer de l\u2019espace \u00e9quipe ?',
      message: 'Vos membres ne la verront plus. Vous pourrez la republier \u00e0 tout moment ; ' +
               'les lectures d\u00e9j\u00e0 enregistr\u00e9es restent dans l\u2019analyse.',
      confirmer: 'Retirer', annuler: 'Annuler', danger: true,
    })
    if (!ok) return
  }

  bt.disabled = true
  const { data, error } = await supabase.from('procedures')
    .update({ publiee_le: retrait ? null : new Date().toISOString() })
    .eq('id', editProcedureId)
    .select('*')
    .single()
  bt.disabled = false

  if (error) { toast('\u00c9chec : ' + error.message); return }
  peindrePublication(data)

  /* ═══ RÉPERCUTER LE CHANGEMENT PARTOUT ═══

     La base était à jour, l'écran de détail aussi — et rien d'autre. Les
     listes se dessinent depuis `allGestionProcedures`, `allCategoriesData` et
     `currentCategoryProcsData`, qui gardaient tous l'ancienne valeur. On
     revenait à la liste et la pastille « Brouillon » y était encore, ou
     l'inverse pour un retrait.

     On corrige les trois mémoires, la copie locale, puis on redessine. */
  const enMemoire = allGestionProcedures.find(p => p.id === editProcedureId)
  if (enMemoire) enMemoire.publiee_le = data.publiee_le
  for (const d of (currentCategoryProcsData || [])) {
    if (d.proc?.id === editProcedureId) d.proc.publiee_le = data.publiee_le
  }
  for (const c of (allCategoriesData || [])) {
    for (const p of (c.procsInCat || [])) {
      if (p.id === editProcedureId) p.publiee_le = data.publiee_le
    }
  }
  /* La copie locale aussi : sans elle, la pastille redevenait fausse au
     prochain démarrage, le temps que la requête réponde. */
  if (currentMembre?.entreprise_id && allCategoriesData?.length) {
    rangerGrille(currentMembre.entreprise_id, allCategoriesData,
                 document.getElementById('p-list-subhead')?.textContent || '')
  }
  renderCategoryGrid()
  if (document.getElementById('p-category')?.classList.contains('active')) {
    renderCategoryProceduresList()
  }
  toast(retrait ? 'Retir\u00e9e de l\u2019espace \u00e9quipe'
                : 'Publi\u00e9e \u2014 votre \u00e9quipe peut la lire')
  if (navigator.vibrate) navigator.vibrate(8)
})

window.openEditProcedure = async function(procId, mode) {
  pileEdition = []
  editProcedureId = procId
  editMode = mode || 'edit'
  showGestionScreen('p-edit-procedure')
  document.getElementById('edit-error').textContent = ''
  document.getElementById('edit-titre-header').textContent = editMode === 'ai-review' ? 'Vérifier les étapes' : 'Modifier la procédure'
  document.getElementById('edit-subhead').textContent = editMode === 'ai-review'
    ? "L'IA a généré ces étapes — corrigez le texte ou le moment du clip si besoin"
    : 'Modifiez le titre, la dossier ou les étapes'
  /* ⚠ LE BOUTON D'ENREGISTREMENT NE PUBLIE PLUS. Il disait « Publier la
     procédure » à la fin d'une analyse IA — un mot devenu faux, puisque la
     publication est maintenant un geste distinct, plus bas dans la page.

     Il dit ce qu'il fait : il enregistre. */
  document.getElementById('edit-save-btn').textContent = editMode === 'ai-review'
    ? 'Enregistrer les étapes' : 'Enregistrer les modifications'

  const bande = document.getElementById('edit-bande-ia')
  if (bande) {
    bande.style.display = editMode === 'ai-review' ? 'flex' : 'none'
    document.getElementById('edit-bande-txt').innerHTML =
      "L'IA a d\u00e9coup\u00e9 la proc\u00e9dure. <b>Relisez chaque \u00e9tape</b> avant de publier : " +
      "c'est vous qui connaissez le geste."
  }
  reinitialiserCouverture(null)

  if (preloadEtapes) await preloadEtapes
  // Priorité aux données préchargées : l'écran s'ouvre sans attendre le réseau.
  let proc = allGestionProcedures.find(p => p.id === procId)
  let etapes = cachedEtapesByProc[procId]
  if (!proc || !etapes) {
    const [{ data: p }, { data: e }] = await Promise.all([
      supabase.from('procedures').select('*').eq('id', procId).single(),
      supabase.from('etapes').select('*').eq('procedure_id', procId).order('ordre'),
    ])
    proc = p || proc
    etapes = e || []
  }
  if (!proc) { document.getElementById('edit-error').textContent = 'Procédure introuvable.'; return }

  /* Le bandeau se peint dès que la procédure est chargée : il lit
     `proc.publiee_le`, qui vient d'arriver. */
  peindrePublication(proc)

  document.getElementById('edit-titre').value = proc.titre || ''
  document.getElementById('edit-categorie').value = proc.categorie || ''
  document.getElementById('edit-sous-categorie').value = proc.sous_categorie || ''

  const videoFrame = document.getElementById('edit-video-frame')
  const videoEl = document.getElementById('edit-video-player')
  const ecapWrap = document.getElementById('ecap-wrap')
  editVideoUrl = proc.video_url
  if (proc.video_url) {
    videoFrame.style.display = 'block'
    // crossOrigin permet de fabriquer la pellicule de vignettes. Si le serveur
    // le refuse, on recharge la vidéo sans : lecture OK, frise simplement noire.
    videoEl.crossOrigin = 'anonymous'
    videoEl.src = (await urlSignee(proc.video_url)) || ''
    videoEl.onerror = async () => {
      if (videoEl.crossOrigin) {
        videoEl.removeAttribute('crossorigin')
        videoEl.crossOrigin = null
        videoEl.src = (await urlSignee(proc.video_url)) || ''
      }
    }
    ecapWrap.style.display = 'block'
    ecapEditor?.attachVideo()
    videoEl.addEventListener('loadedmetadata', async () => {
      editStepsData = normaliserClips(editStepsData, videoEl.duration)
      renderEditSteps()
      ecapEditor?.repaint()
      await generateFilmstrip(videoEl, 'ecap-track')
      ecapEditor?.repaint()
    }, { once: true })
  } else {
    videoFrame.style.display = 'none'
    ecapWrap.style.display = 'none'
  }

  clipsDeduits = false
  let brutes = (etapes || []).map(e => ({
    id: e.id, texte: e.texte,
    timestamp_video: e.timestamp_video,
    fin_video: e.fin_video != null ? e.fin_video : null,
    /* La photo de l'étape était oubliée ici : ouvrir la modification l'effaçait
       de l'écran, et l'enregistrement la perdait pour de bon. */
    image_url: e.image_url || null,
    _t: e.timestamp_video,   // horodatage brut conservé pour pouvoir recaler
  }))

  /* À la première vérification d'une découpe automatique, on rapproche les
     doublons. Une procédure déjà vérifiée n'y passe pas : ses étapes sont
     celles que l'utilisateur a validées, on n'y touche plus. */
  if (mode === 'ai-review') {
    const avant = brutes.length
    brutes = nettoyerEtapesIA(brutes, document.getElementById('edit-video-player')?.duration)
    if (brutes.length < avant) {
      toast(`${avant - brutes.length} doublon${avant - brutes.length > 1 ? 's' : ''} rapproché${avant - brutes.length > 1 ? 's' : ''} · vérifiez le découpage`)
    }
  }

  editStepsData = brutes
  renderEditSteps()

  /* On sélectionne la première étape dès l'ouverture. Sans elle, les pastilles
     de bornes et la loupe s'afficheraient vides, ce qui est plus déroutant
     qu'utile. `lire: false` pour ne pas lancer la vidéo dans la figure. */
  if (editVideoUrl && editStepsData.length) ecapEditor?.select(0, { lire: false })
  else ecapEditor?.deselect()
}



// Calcule début et fin de chaque étape à partir des horodatages bruts
function deriverClips(steps, duree, convention) {
  const avecVideo = steps.filter(s => s._t != null)
  avecVideo.forEach((s, idx) => {
    if (convention === 'debut') {
      s.timestamp_video = s._t
      const suivante = avecVideo[idx + 1]
      s.fin_video = suivante ? suivante._t : (isFinite(duree) ? duree : s._t + 8)
    } else {
      const precedente = avecVideo[idx - 1]
      s.timestamp_video = precedente ? precedente._t : 0
      s.fin_video = s._t
    }
    if (s.fin_video <= s.timestamp_video) s.fin_video = s.timestamp_video + 1
  })
  return steps
}

// Prépare les étapes chargées : on garde l'horodatage brut de côté pour pouvoir
// recalculer dans l'autre sens si besoin, puis on déduit les bornes manquantes.
/* ═══════════════════════════════════════════════════════════════════════════
   NETTOYAGE DES ÉTAPES PRODUITES PAR L'IA

   L'analyse renvoie souvent deux fois la même action, formulée autrement :
   « Ajouter une cuillère de moutarde » puis « Ajouter une cuillère de moutarde
   dans le bol ». Elle produit aussi des extraits d'une seconde, parfois
   plusieurs sur le même instant. Ces doublons se retrouvaient tels quels dans
   l'écran de vérification, et c'est à l'utilisateur qu'il revenait de faire le
   ménage.

   On les rapproche donc avant affichage. Le nettoyage est prudent : il ne
   fusionne que ce qui se ressemble vraiment et se suit dans le temps, et il ne
   supprime jamais de texte — il garde la formulation la plus complète.
   ═══════════════════════════════════════════════════════════════════════════ */

const MOTS_NOMBRES = {
  un: '1', une: '1', deux: '2', trois: '3', quatre: '4', cinq: '5',
  six: '6', sept: '7', huit: '8', neuf: '9', dix: '10', demi: '0.5',
}

/* Réduit une phrase à ses mots porteurs de sens : sans accents, sans
   ponctuation, sans articles ni prépositions, et avec les nombres écrits en
   chiffres — c'est ce qui rapproche « 2 grosses cuillères » de « deux grosses
   cuillères ». */
const MOTS_VIDES = new Set(['le','la','les','un','une','des','du','de','d','au','aux','a','à','dans','sur','sous',
  'et','ou','puis','ensuite','avec','pour','en','par','son','sa','ses','ce','cet','cette','il','elle','on',
  'jusqu','jusque','que','qui','quo','selon','bien','tout','toute','plus','moins'])

function motsUtiles(texte) {
  const brut = (texte || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // on retire les accents
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(Boolean)
  const mots = []
  for (const m of brut) {
    const n = MOTS_NOMBRES[m] || m
    if (MOTS_VIDES.has(n)) continue
    mots.push(n)
  }
  return mots
}

/* Proportion de mots communs (indice de Jaccard). Deux formulations d'une même
   action partagent l'essentiel de leur vocabulaire. */
function ressemblance(a, b) {
  const A = new Set(motsUtiles(a)), B = new Set(motsUtiles(b))
  if (!A.size || !B.size) return 0
  let communs = 0
  A.forEach(m => { if (B.has(m)) communs++ })
  return communs / (A.size + B.size - communs)
}

/* Vrai si l'une des deux phrases dit tout ce que dit l'autre, en plus long :
   c'est le cas typique du doublon enrichi. */
function contient(a, b) {
  const A = motsUtiles(a), B = motsUtiles(b)
  const [court, long] = A.length <= B.length ? [A, new Set(B)] : [B, new Set(A)]
  if (!court.length) return false
  return court.every(m => long.has(m))
}

function nettoyerEtapesIA(etapes, duree) {
  if (!etapes || etapes.length < 2) return etapes || []

  // On travaille dans l'ordre du temps, sinon deux doublons éloignés dans la
  // liste ne se verraient jamais.
  const tri = etapes.slice().sort((a, b) => (a.timestamp_video ?? 0) - (b.timestamp_video ?? 0))
  const sortie = []

  for (const e of tri) {
    const prec = sortie[sortie.length - 1]
    if (!prec) { sortie.push({ ...e }); continue }

    const debut = e.timestamp_video ?? 0
    const finPrec = prec.fin_video ?? prec.timestamp_video ?? 0
    const proches = Math.abs(debut - (prec.timestamp_video ?? 0)) < 6 || debut <= finPrec + 1

    const memeAction = contient(prec.texte, e.texte) || ressemblance(prec.texte, e.texte) >= 0.62

    if (proches && memeAction) {
      // Fusion : on garde la formulation la plus riche et l'étendue des deux.
      const plusComplet = motsUtiles(e.texte).length > motsUtiles(prec.texte).length ? e.texte : prec.texte
      prec.texte = plusComplet
      prec.timestamp_video = Math.min(prec.timestamp_video ?? debut, debut)
      prec.fin_video = Math.max(prec.fin_video ?? 0, e.fin_video ?? debut)
      continue
    }
    sortie.push({ ...e })
  }

  /* Plusieurs étapes annoncées au même instant : l'analyse a repéré les actions
     mais pas su les situer. Aucune ne peut alors avoir de durée, puisque la
     suivante commence là où la précédente débute. On partage donc l'intervalle
     jusqu'au prochain instant distinct, à parts égales. */
  let g = 0
  while (g < sortie.length) {
    let fin = g
    while (fin + 1 < sortie.length &&
           Math.abs((sortie[fin + 1].timestamp_video ?? 0) - (sortie[g].timestamp_video ?? 0)) < 0.5) fin++
    if (fin > g) {
      const debutGroupe = sortie[g].timestamp_video ?? 0
      const nb = fin - g + 1
      const finGroupe = sortie[fin + 1]?.timestamp_video ?? duree ?? (debutGroupe + nb * 3)
      const pas = Math.max(1, (finGroupe - debutGroupe) / nb)
      for (let k = g; k <= fin; k++) {
        sortie[k].timestamp_video = debutGroupe + pas * (k - g)
        sortie[k].fin_video = debutGroupe + pas * (k - g + 1)
      }
    }
    g = fin + 1
  }

  /* Les extraits d'une seconde ne montrent rien. Quand la borne de fin est
     manifestement fausse, on l'étire jusqu'au début de l'étape suivante —
     c'est ce que l'utilisateur aurait fait à la main. */
  const DUREE_MINI = 2
  for (let i = 0; i < sortie.length; i++) {
    const s = sortie[i]
    if (s.timestamp_video == null) continue
    const suivante = sortie[i + 1]
    const plafond = suivante?.timestamp_video ?? duree ?? null
    if (s.fin_video == null || s.fin_video - s.timestamp_video < DUREE_MINI) {
      s.fin_video = plafond != null ? Math.max(s.timestamp_video + 0.5, plafond) : s.timestamp_video + DUREE_MINI
    }
    // Jamais au-delà de la suivante : on ne fabrique pas de chevauchement.
    if (plafond != null && s.fin_video > plafond) s.fin_video = plafond
    s.timestamp_video = Math.round(s.timestamp_video * 10) / 10
    s.fin_video = Math.round(s.fin_video * 10) / 10
  }

  return sortie
}

function normaliserClips(steps, duree) {
  const aDeduire = steps.filter(s => s.timestamp_video != null && s.fin_video == null)
  if (aDeduire.length === 0) return steps
  steps.forEach(s => { if (s._t == null && s.timestamp_video != null) s._t = s.timestamp_video })
  conventionClips = detecterConvention(aDeduire.map(s => s._t), duree)
  clipsDeduits = true
  return deriverClips(steps, duree, conventionClips)
}

// Même logique, en lecture seule, pour les écrans qui se contentent d'afficher
function calculerBornes(etapes, duree) {
  const bornes = new Map()
  const avecVideo = (etapes || []).filter(e => e.timestamp_video != null)
    .sort((a, b) => a.timestamp_video - b.timestamp_video)
  if (!avecVideo.length) return bornes

  const manquantes = avecVideo.filter(e => e.fin_video == null)
  const convention = manquantes.length
    ? detecterConvention(manquantes.map(e => e.timestamp_video), duree)
    : 'debut'

  avecVideo.forEach((e, idx) => {
    let debut, fin
    if (e.fin_video != null) {
      debut = e.timestamp_video
      fin = e.fin_video
    } else if (convention === 'debut') {
      debut = e.timestamp_video
      fin = avecVideo[idx + 1] ? avecVideo[idx + 1].timestamp_video : (isFinite(duree) ? duree : debut + 15)
    } else {
      debut = avecVideo[idx - 1] ? avecVideo[idx - 1].timestamp_video : 0
      fin = e.timestamp_video
    }
    if (fin <= debut) fin = debut + 1
    bornes.set(e.id, { start: debut, end: fin })
  })
  return bornes
}

/* ═══════════════════════════════════════════════════════════════════════════
   Boîte de confirmation façon iOS. Renvoie une promesse : true si l'action est
   confirmée, false si elle est annulée. Animation identique à celle d'Apple :
   le panneau apparaît légèrement agrandi puis se pose à sa taille normale.
   ═══════════════════════════════════════════════════════════════════════════ */
/* Une fenêtre pour SAISIR quelque chose, sur le modèle de la fenêtre de
   confirmation. `prompt()` du navigateur aurait suffi techniquement, mais il
   ouvre une boîte système grise au milieu d'une app soignée — et sur iPhone,
   il peut être bloqué sans prévenir. */
/* Une fenêtre à deux ou trois choix, sur le modèle des fenêtres de confirmation.
   Renvoie la clé choisie, ou `null` si l'on ferme. */
function choisirAction({ titre, options }) {
  return new Promise((resoudre) => {
    const fond = document.createElement('div')
    fond.className = 'ios-alert-backdrop'
    /* Une liste de choix : pas de dessin, pas de halo coloré. Un pictogramme
       devrait représenter plusieurs actions à la fois — il n'en existe pas. Le
       halo reste bleu, comme toute question ouverte. */
    fond.innerHTML = `
      <div class="fen-pro" role="dialog" aria-modal="true">
        <span class="fen-halo bleu"></span>
        <div class="fen-co" style="padding-bottom:6px;">
          <div class="fen-t">${escapeHtml(titre)}</div>
        </div>
        <div class="fen-ac">
          ${options.map(o => `<button type="button"
            class="${o.danger ? 'fen-p rouge' : 'fen-p'}"
            data-cle="${escapeHtml(o.cle)}">${escapeHtml(o.libelle)}</button>`).join('')}
          <button type="button" class="fen-a annuler" data-cle="">Annuler</button>
        </div>
      </div>`
    document.body.appendChild(fond)
    requestAnimationFrame(() => fond.classList.add('shown'))

    const fermer = (v) => {
      fond.classList.add('closing')
      setTimeout(() => { fond.remove(); resoudre(v) }, 180)
    }
    fond.querySelectorAll('[data-cle]').forEach(b => {
      b.addEventListener('click', () => fermer(b.dataset.cle || null))
    })
    fond.addEventListener('click', (e) => { if (e.target === fond) fermer(null) })
  })
}

function demanderTexte({ titre, message, valeur = '', placeholder = '', confirmer = 'Valider', annuler = 'Annuler' }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div')
    backdrop.className = 'ios-alert-backdrop'
    /* Une saisie : le champ prend la place du dessin. Une tuile au-dessus d'un
       champ ferait deux points d'attention là où il n'y a qu'une chose à faire. */
    backdrop.innerHTML = `
      <div class="fen-pro" role="dialog" aria-modal="true">
        <span class="fen-halo bleu"></span>
        <div class="fen-co">
          <div class="fen-t">${escapeHtml(titre)}</div>
          ${message ? `<div class="fen-s">${escapeHtml(message)}</div>` : ''}
          <input type="text" class="fen-champ" value="${escapeHtml(valeur)}"
                 placeholder="${escapeHtml(placeholder)}" maxlength="60">
        </div>
        <div class="fen-ac">
          <button type="button" class="fen-p ok">${escapeHtml(confirmer)}</button>
          <button type="button" class="fen-a cancel">${escapeHtml(annuler)}</button>
        </div>
      </div>`
    document.body.appendChild(backdrop)
    requestAnimationFrame(() => backdrop.classList.add('shown'))

    const champ = backdrop.querySelector('.ios-alert-champ')
    setTimeout(() => { champ?.focus(); champ?.select() }, 220)

    const fermer = (v) => {
      backdrop.classList.add('closing')
      setTimeout(() => { backdrop.remove(); resolve(v) }, 180)
    }
    backdrop.querySelector('.cancel').onclick = () => fermer(null)
    backdrop.querySelector('.ok').onclick = () => fermer((champ.value || '').trim() || null)
    champ.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); fermer((champ.value || '').trim() || null) }
      if (e.key === 'Escape') fermer(null)
    })
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) fermer(null) })
  })
}

/* `accompli` : la fenêtre annonce une réussite plutôt qu'une question. Vert,
   coche ronde, et généralement un seul bouton. */
/* ═══ CHANGER DE RÔLE N'EST PAS SUPPRIMER ═══

   La fenêtre « Repasser en équipe » portait une poubelle : elle annonçait donc
   une suppression alors qu'on ne fait que changer un rôle. La personne reste
   dans l'entreprise, ses procédures restent en place — la phrase le dit, mais
   l'icône disait le contraire, et c'est elle qu'on lit en premier.

   Deux flèches qui se croisent : l'une monte, l'autre descend. Le geste est
   réversible, et le dessin le montre. */
const ICONE_ROLE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
  <path d="M7.5 20.5V5"></path><path d="M3.6 8.9 7.5 5l3.9 3.9"></path>
  <path d="M16.5 3.5V19"></path><path d="M20.4 15.1 16.5 19l-3.9-3.9"></path>
</svg>`

const ICONE_POUBELLE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="3.5 6.2 20.5 6.2"/>
  <path d="M8.5 6.2V4.4a1.6 1.6 0 0 1 1.6-1.6h3.8a1.6 1.6 0 0 1 1.6 1.6v1.8"/>
  <path d="M18.2 6.2V19a2 2 0 0 1-2 2H7.8a2 2 0 0 1-2-2V6.2"/>
  <line x1="10.4" y1="11" x2="10.4" y2="16.6"/><line x1="13.6" y1="11" x2="13.6" y2="16.6"/></svg>`

const ICONE_COCHE_RONDE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9"/><polyline points="8 12.4 11 15.4 16.2 9.2"/></svg>`

const ICONE_QUESTION = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9"/><path d="M9.5 9.4a2.6 2.6 0 1 1 3.4 2.5c-.7.3-.9.8-.9 1.5v.4"/>
  <line x1="12" y1="16.8" x2="12" y2="16.8"/></svg>`

function confirmDialog({ titre, message, confirmer = 'Supprimer', annuler = 'Annuler',
                         danger = true, accompli = false, icone = null,
                         html = '' }) {
  /* `html` n'est PAS échappé, contrairement à `message`. Il n'est employé que
     pour des contenus écrits dans CE fichier — jamais pour du texte venu de la
     base ou saisi par quelqu'un. */
  return new Promise((resolve) => {
    const backdrop = document.createElement('div')
    backdrop.className = 'ios-alert-backdrop'
    /* ═══ LA FENÊTRE PROCÉDO ═══

     Elle ne ressemble plus à une boîte de dialogue du système. Le halo est ce
     qu'on ne trouve nulle part ailleurs — c'est lui qui fait qu'on reconnaît
     l'application, même sur une question aussi banale qu'une suppression.

     Sa couleur suit la nature de l'acte : rouge quand c'est irréversible, vert
     quand c'est accompli, bleu le reste du temps. On sait ce qui se joue avant
     d'avoir lu le titre.

     LES BOUTONS SONT EMPILÉS. Côte à côte, on tape à côté une fois sur dix — et
     une fois sur dix, ici, c'est une procédure effacée par erreur. L'action
     principale est en haut, sous le pouce ; l'annulation en dessous, plus
     discrète et plus basse. */
  const teinte = danger ? 'rouge' : (accompli ? 'vert' : 'bleu')

  backdrop.innerHTML = `
      <div class="fen-pro" role="alertdialog" aria-modal="true">
        <span class="fen-halo ${teinte}"></span>
        <div class="fen-co">
          <span class="fen-ic ${teinte}">${icone || (danger ? ICONE_POUBELLE
            : accompli ? ICONE_COCHE_RONDE : ICONE_QUESTION)}</span>
          <div class="fen-t">${escapeHtml(titre)}</div>
          ${message ? `<div class="fen-s">${escapeHtml(message)}</div>` : ''}
          ${html ? `<div class="fen-html">${html}</div>` : ''}
        </div>
        <div class="fen-ac">
          <button type="button" class="fen-p ${danger ? 'rouge' : ''} ok">${escapeHtml(confirmer)}</button>
          <!-- Le bouton d'annulation disparaît si on ne lui donne pas de nom :
               une fenêtre qui ne fait qu'expliquer n'a rien à annuler, et un
               bouton vide à côté de « Compris » n'appelle que le doute. -->
          ${annuler ? `<button type="button" class="fen-a cancel">${escapeHtml(annuler)}</button>` : ''}
        </div>
      </div>`
    document.body.appendChild(backdrop)
    requestAnimationFrame(() => backdrop.classList.add('shown'))

    let done = false
    const close = (valeur) => {
      if (done) return
      done = true
      backdrop.classList.add('closing')
      backdrop.classList.remove('shown')
      setTimeout(() => { backdrop.remove(); resolve(valeur) }, 180)
    }
    backdrop.querySelector('.cancel')?.addEventListener('click', () => close(false))
    backdrop.querySelector('.ok').addEventListener('click', () => close(true))
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(false) })
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', esc); close(false) }
    })
  })
}

// Petit message flottant, pour les informations qui ne méritent pas une alerte
let toastTimer = null
function toast(texte) {
  let el = document.getElementById('mini-toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'mini-toast'
    el.style.cssText = 'position:fixed; left:50%; bottom:118px; transform:translateX(-50%) translateY(10px);' +
      'z-index:150; background:rgba(44,44,48,0.92); -webkit-backdrop-filter:blur(18px); backdrop-filter:blur(18px);' +
      'border:0.5px solid rgba(255,255,255,0.18); border-radius:100px; padding:11px 20px; font-size:13px;' +
      'font-weight:300; color:#fff; max-width:88vw; text-align:center; opacity:0;' +
      'transition:opacity 0.25s ease, transform 0.25s cubic-bezier(0.22,1,0.36,1); pointer-events:none;'
    document.body.appendChild(el)
  }
  el.textContent = texte
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(0)' })
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    el.style.opacity = '0'
    el.style.transform = 'translateX(-50%) translateY(10px)'
  }, 2400)
}

// Icône corbeille commune à toutes les listes d'étapes
const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'

// Demande confirmation avant de retirer une étape, puis exécute la suppression
async function demanderSuppressionEtape(numero, texte, onConfirme) {
  const extrait = (texte || '').trim()
  const ok = await confirmDialog({
    titre: `Supprimer l'étape ${numero} ?`,
    message: extrait
      ? `« ${extrait.length > 60 ? extrait.slice(0, 60) + '…' : extrait} » sera retirée de la procédure.`
      : 'Cette étape sera retirée de la procédure.',
    confirmer: 'Supprimer',
    annuler: 'Annuler',
  })
  if (ok) onConfirme()
}

function autoResizeTextarea(el) {
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

function renderEditSteps() {
/* Retirer la photo d'une étape. Il n'y avait aucun moyen de le faire : une
   photo posée par erreur restait là pour toujours. */
document.getElementById('edit-steps-list')?.addEventListener('click', (e) => {
  const croix = e.target.closest('.img-oter')
  if (!croix) return
  e.preventDefault()
  e.stopPropagation()
  const ligne = croix.closest('[data-index]')
  const i = Number(ligne?.dataset.index)
  if (!Number.isInteger(i) || !editStepsData[i]) return
  editStepsData[i].image_url = null
  editStepsData[i].imageFichier = null
  editStepsData[i].imageARetirer = true
  repeindreSansSauter(renderEditSteps)
  if (navigator.vibrate) navigator.vibrate(6)
})

  const listEl = document.getElementById('edit-steps-list')
  listEl.innerHTML = ''
  const sel = ecapEditor ? ecapEditor.selected() : null
  editStepsData.forEach((step, i) => {
    const div = document.createElement('div')
    div.className = 'step-edit-item' + (i === sel ? ' selected' : '')
    div.dataset.index = i
    const hasClip = step.timestamp_video != null && editVideoUrl
    const debut = step.timestamp_video != null ? step.timestamp_video : 0
    const fin = step.fin_video != null ? step.fin_video : debut
    div.innerHTML = `
      <span class="step-num-dess">${numeroEtapeDess(i + 1)}</span>
      <textarea rows="1" placeholder="Décrire cette étape...">${escapeHtml(step.texte || '')}</textarea>
      ${hasClip ? '' : `<div class="step-img">
          <div class="step-img-vignette${step.image_url || step.imageFichier ? ' pleine' : ''}">${step.image_url
            ? `<img data-fichier="${escapeHtml(cheminFichier(step.image_url))}" alt="">`
            : (step.imageFichier ? `<img src="${URL.createObjectURL(step.imageFichier)}" alt="">` : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m21 16-5-5-6 6-2-2-5 5"/></svg>`)}${step.image_url || step.imageFichier
            ? `<button type="button" class="img-oter" aria-label="Retirer la photo">×</button>`
            : ''}</div>
          <button type="button" class="img-toucher" aria-label="Photo de l'étape">
            <span class="lg">${step.image_url || step.imageFichier ? 'Modifier la photo' : 'Ajouter une photo'}</span>
          </button>
          <input type="file" accept="image/*" class="fichier">
      </div>`}
      <div class="step-row-bottom">
        ${hasClip ? `<span class="range">${formatTime(debut)} → ${formatTime(fin)}</span>` : ''}
                <span class="del">${TRASH_SVG}</span>
      </div>
    `
    const textarea = div.querySelector('textarea')
    textarea.addEventListener('input', (e) => { editStepsData[i].texte = e.target.value; majBoutonIA(); autoResizeTextarea(e.target) })
    /* Même correctif qu'à la création : le champ s'ajuste aussi à l'affichage,
       sinon une étape longue s'ouvre coupée à la première ligne. */
    requestAnimationFrame(() => autoResizeTextarea(textarea))

    /* La photo, pour les étapes sans extrait vidéo. Les mêmes gestes qu'à la
       création : la vignette est la commande, et elle propose de remplacer ou de
       retirer quand une photo est déjà là. */
    const champFichier = div.querySelector('.fichier')
    if (champFichier) {
      const toucherPhoto = async () => {
        if (!(editStepsData[i].image_url || editStepsData[i].imageFichier)) { champFichier.click(); return }
        const choix = await choisirAction({
          titre: `Photo de l'\u00e9tape ${i + 1}`,
          options: [
            { cle: 'changer', libelle: 'Remplacer la photo' },
            { cle: 'retirer', libelle: 'Retirer la photo', danger: true },
          ],
        })
        if (choix === 'changer') champFichier.click()
        if (choix === 'retirer') {
          /* On note le retrait au lieu d'effacer tout de suite : tant qu'on n'a
             pas enregistré, on peut encore changer d'avis. */
          editStepsData[i].imageARetirer = !!editStepsData[i].image_url
          editStepsData[i].image_url = null
          editStepsData[i].imageFichier = null
          renderEditSteps()
        }
      }
      div.querySelector('.step-img-vignette')?.addEventListener('click', toucherPhoto)
      div.querySelector('.img-toucher')?.addEventListener('click', toucherPhoto)

      champFichier.addEventListener('change', (e) => {
        const f = e.target.files[0]
        if (!f) return
        if (f.size > 6 * 1024 * 1024) { toast('Photo trop lourde : 6 Mo maximum.'); return }
        editStepsData[i].imageFichier = f
        editStepsData[i].image_url = null
        editStepsData[i].imageARetirer = false
        renderEditSteps()
      })
    }
    div.querySelector('.del').addEventListener('click', (e) => {
      e.stopPropagation()
      demanderSuppressionEtape(i + 1, editStepsData[i].texte, () => {
        memoriserEdition()
      editStepsData.splice(i, 1)
        ecapEditor?.deselect()
        renderEditSteps()
        ecapEditor?.repaint()
      })
    })
    if (editVideoUrl) {
      div.addEventListener('click', (e) => {
        if (e.target.closest('textarea, button, .del, .img-toucher')) return
        if (listEl.dataset.glissementRecent) return
        ecapEditor?.select(i)
      })
    }
    listEl.appendChild(div)
    autoResizeTextarea(textarea)
  })

  activerGlissementEtapes(listEl, () => editStepsData, (nouvelIndex) => {
    renderEditSteps()
    if (editVideoUrl) ecapEditor?.select(nouvelIndex, { lire: false, defiler: false })
  })
  majBoutonDefaireEdit()
}

document.getElementById('edit-add-step-btn')?.addEventListener('click', () => {
  memoriserEdition()
  const videoEl = document.getElementById('edit-video-player')
  const d = (videoEl && isFinite(videoEl.duration)) ? videoEl.duration : 0
  const start = editVideoUrl ? (videoEl.currentTime || 0) : null
  const newStep = {
    id: null, texte: '',
    timestamp_video: start,
    fin_video: editVideoUrl ? Math.min(d || start + 8, start + 8) : null,
  }
  // La nouvelle étape se glisse juste après celle qui est sélectionnée, sinon à la fin.
  const sel = ecapEditor ? ecapEditor.selected() : null
  const insertAt = (sel != null) ? sel + 1 : editStepsData.length
  editStepsData.splice(insertAt, 0, newStep)
  renderEditSteps()
  if (editVideoUrl) ecapEditor?.select(insertAt, { lire: false })
})

document.getElementById('edit-save-btn')?.addEventListener('click', async () => {
  const errorEl = document.getElementById('edit-error')
  errorEl.textContent = ''
  const titre = document.getElementById('edit-titre').value.trim()
  const categorie = document.getElementById('edit-categorie').value.trim()
  const sousCategorie = lireSousDossier('edit-sous-categorie')

  if (!titre) { errorEl.textContent = 'Le titre est obligatoire.'; return }
  if (editStepsData.length === 0) { errorEl.textContent = 'Ajoutez au moins une étape.'; return }
  if (editStepsData.some(s => !s.texte.trim())) { errorEl.textContent = 'Chaque étape doit avoir un texte.'; return }

  const saveBtn = document.getElementById('edit-save-btn')
  setButtonLoading(saveBtn, true)

  /* L'image de la procédure part avec le reste. Si la colonne n'existe pas
     encore, la mise à jour échoue entièrement : on retente alors sans elle,
     plutôt que de perdre le titre et la dossier pour une image. */
  const urlCouv = await envoyerCouverture(editProcedureId)

  let { error: updateError } = await supabase
    .from('procedures')
    .update({ titre, categorie, sous_categorie: sousCategorie, image_url: urlCouv })
    .eq('id', editProcedureId)
  if (updateError && /image_url/i.test(updateError.message || '')) {
    console.warn('Standix \u00b7 colonne image_url absente sur procedures.')
    const repli = await supabase.from('procedures')
      /* Le repli garde le sous-dossier : seule l'image posait problème. */
      .update({ titre, categorie, sous_categorie: sousCategorie }).eq('id', editProcedureId)
    updateError = repli.error
  }
  if (updateError) { setButtonLoading(saveBtn, false); errorEl.textContent = updateError.message; return }

  // On repart d'une liste propre : on supprime les anciennes étapes et on réinsère la version modifiée
  await supabase.from('etapes').delete().eq('procedure_id', editProcedureId)
  const etapesToInsert = editStepsData.map((s, i) => ({
    procedure_id: editProcedureId, ordre: i + 1, texte: s.texte,
    /* Même oubli que sur l'autre chemin d'écriture. Cet écran est aujourd'hui
       inatteignable — `openEditProcedure` n'est appelée nulle part — mais le
       corriger coûte une ligne, et laisser un effacement silencieux dans du
       code qu'on rebranchera peut-être serait un piège posé pour plus tard. */
    attention: s.attention ?? null,
    timestamp_video: s.timestamp_video ?? null, fin_video: s.fin_video ?? null,
  }))
  const { error: insertError } = await insertEtapes(etapesToInsert)
  if (insertError) { setButtonLoading(saveBtn, false); errorEl.textContent = insertError.message; return }

  if (editMode === 'ai-review') {
    await supabase.from('procedures').update({ statut: 'pret' }).eq('id', editProcedureId)
  }

  setButtonLoading(saveBtn, false)
  showGestionScreen('p-list')
  await loadGestionProcedures()
  openAnalyse(editProcedureId)
})

/* ═══════════════════════════════════════════════════════════════════════════
   LES FICHIERS SONT PRIVÉS

   Avant, chaque vidéo et chaque photo était servie par une adresse PUBLIQUE :
   n'importe qui la connaissant pouvait la regarder, sans compte, sans
   appartenir à l'entreprise. Les adresses ne sont pas devinables, mais elles
   circulent — historique du navigateur, journaux serveur, lien partagé par
   erreur. C'est une sécurité par obscurité, et elle ne tient pas devant un
   client qui pose la question.

   Désormais : le compartiment est privé, et chaque affichage demande une
   adresse SIGNÉE, valable une heure, délivrée uniquement à quelqu'un que
   Supabase reconnaît comme membre de l'entreprise.

   Les anciennes lignes contiennent une URL complète, les nouvelles un chemin :
   `cheminFichier` accepte les deux, pour que rien ne se casse au passage.
   ═══════════════════════════════════════════════════════════════════════════ */

const SIGNATURE_DUREE = 3600            // une heure
const signatures = new Map()            // chemin → { url, expire }

/* ═══ L'ADRESSE D'UN LOGO ═══

   `procedo-logos` est PUBLIC, contrairement à `procedo-videos` : son adresse
   se construit et ne se signe pas. On accepte les deux formes stockées en
   base — une adresse complète héritée, ou un simple chemin. */
function urlLogo(valeur) {
  if (!valeur) return ''
  const v = String(valeur)
  if (v.startsWith('http')) return v
  const { data } = supabase.storage.from('procedo-logos').getPublicUrl(v)
  return data?.publicUrl || ''
}

function cheminFichier(valeur) {
  if (!valeur) return null
  const v = String(valeur)
  if (!v.startsWith('http')) return v
  /* Une ancienne adresse publique. On en extrait le chemin, quelle que soit la
     forme exacte de l'URL. */
  const m = v.match(/\/procedo-videos\/(.+?)(?:\?|$)/)
  return m ? decodeURIComponent(m[1]) : null
}

async function urlSignee(valeur) {
  const chemin = cheminFichier(valeur)
  if (!chemin) return null

  /* On garde les signatures en mémoire : une fiche de quinze étapes avec photo
     ferait sinon quinze allers-retours au serveur à chaque ouverture. On les
     renouvelle une minute avant l'échéance, pour qu'une vidéo commencée ne
     s'interrompe pas en cours de lecture. */
  const connue = signatures.get(chemin)
  if (connue && connue.expire > Date.now() + 60000) return connue.url

  try {
    const { data, error } = await supabase.storage.from('procedo-videos')
      .createSignedUrl(chemin, SIGNATURE_DUREE)
    if (error || !data?.signedUrl) throw error || new Error('sans adresse')
    signatures.set(chemin, { url: data.signedUrl, expire: Date.now() + SIGNATURE_DUREE * 1000 })
    return data.signedUrl
  } catch (e) {
    console.warn('Standix \u00b7 adresse non sign\u00e9e :', e?.message || e)
    return null
  }
}

/* Les gabarits sont écrits d'un seul tenant et ne peuvent pas attendre. Ils
   posent donc `data-fichier`, et cette fonction remplit les `src` une fois le
   contenu en place. Les images arrivent avec un léger retard, invisible en
   pratique, et la page ne bloque jamais. */
async function signerMedias(racine) {
  const cibles = (racine || document).querySelectorAll('[data-fichier]:not([data-signe])')
  await Promise.all([...cibles].map(async el => {
    el.setAttribute('data-signe', '1')
    const url = await urlSignee(el.getAttribute('data-fichier'))
    if (url) el.src = url
    else {
      /* Le fichier a disparu du dépôt : on retire le cadre qui l'entourait. */
      el.closest('.detail-step-img, .analyse-couv, .step-img-vignette')?.remove()
    }
  }))
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str || ''
  return div.innerHTML
}

// ═══ RESTER CONNECTÉ : vérifie s'il existe déjà une session au chargement ═══
try {
  ;(async function checkExistingSession() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      window.jalon?.('session vérifiée')
      if (session) {
        // Une session existe : l'app va s'ouvrir, on en montre l'ossature
        // pendant que la base répond, au lieu de laisser l'écran nu.
        let dernierEspace = null
        try { dernierEspace = localStorage.getItem('procedo_espace') } catch (e) {}
        afficherCoquille(dernierEspace || 'gestion')
        document.body.classList.remove('booting')
        window.jalon?.('ossature affichée')
        /* Deux mesures côte à côte pour savoir d'où vient la lenteur :
           - un appel direct à l'API, sans passer par la bibliothèque ;
           - la même chose via la bibliothèque, qui rafraîchit le jeton au passage.
           Si le premier est rapide et le second lent, le coupable est le
           rafraîchissement du jeton d'authentification, pas le réseau. */
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/membres?select=id&limit=1`, {
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
          })
          window.jalon?.('test : appel direct à la base')
        } catch (e) { window.jalon?.('test : appel direct échoué') }

        /* Une session existe : on le signale tout de suite. Le filet de secours
           des six secondes s'en sert pour ne PAS afficher l'écran de choix
           pendant que la fiche membre arrive — sur une connexion lente, il
           passait devant et recouvrait l'app. */
        window.__procedoSessionEnCours = true
        const { data: fiches } = await supabase
          .from('membres').select('*').eq('user_id', session.user.id)
        const membre = choisirFicheMembre(fiches)
        if (!membre && (fiches || []).length === 0) {
          window.__procedoLoaded = true
          montrerOrphelin()
          return
        }
        window.jalon?.('fiche membre reçue (via la bibliothèque)')
        if (membre) {
          enterApp(membre)
          window.__procedoLoaded = true
          return
        }
      }
    } catch (e) {
      console.error('Erreur de vérification de session :', e)
    }
    // Pas de session valide (ou erreur) : afficher l'écran de choix d'espace.
    // Le drapeau est posé AVANT l'attente, sinon le filet de secours des 6 s
    // pourrait afficher l'écran de choix pendant qu'on laisse finir l'animation.
    // Aucune attente ici : l'écran de choix des espaces s'affiche tout de suite.
    // Le maintien du logo n'a de sens que quand on entre réellement dans l'app.
    window.__procedoLoaded = true
    afficherEcranChoix()
    document.body.classList.remove('booting')
  })()
} catch (e) {
  console.error('Erreur au chargement :', e)
  afficherEcranChoix()
  document.body.classList.remove('booting')
}


/* ═══ LES DEUX BOUTONS D'EXPORT ═══

   Un par espace, car les deux gardent la procédure ouverte dans une variable
   différente : la Gestion dans `currentAnalyseData`, l'Équipe dans
   `equipeProcCourante`. Le PDF, lui, est le même — c'est la même procédure,
   et rien ne justifierait que le papier diffère selon qui l'imprime. */
async function exporterDepuis(source, bouton) {
  if (!source?.proc) { toast('Ouvrez d\u2019abord une procédure'); return }
  const avant = bouton.textContent
  bouton.disabled = true
  bouton.textContent = 'Préparation du PDF…'
  try {
    await exporterProcedurePdf(source.proc, source.etapes)
  } catch (e) {
    console.warn('[pdf]', e?.message || e)
    toast('Le PDF n\u2019a pas pu être créé')
  } finally {
    bouton.textContent = avant
    bouton.disabled = false
  }
}

document.getElementById('pdf-gestion')?.addEventListener('click', (e) =>
  exporterDepuis(currentAnalyseData, e.currentTarget))
document.getElementById('pdf-equipe')?.addEventListener('click', (e) =>
  exporterDepuis(equipeProcCourante, e.currentTarget))
