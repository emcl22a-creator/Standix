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
    <div style="position:fixed; inset:0; z-index:9999; background:#0C0D0E; display:flex; align-items:center; justify-content:center; padding:24px;">
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

let currentMembre = null
let manualSteps = []
let videoSteps = []
let ecapEditor = null     // éditeur de clip de l'écran de modification
let currentVideoFile = null
let allEquipeProcedures = []
let equipeEtapesByProc = {}
let equipeLues = new Set()      // identifiants des procédures que j'ai lues
let mesLectures = []            // mes validations, avec date et durée
/* Les deux tris de l'espace équipe. Ils vivent à côté de la catégorie courante :
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
    "Envoi de la vidéo": "Uploading the video",
    "La vidéo part vers le service d'analyse.": "The video is being sent to the analysis service.",
    "Analyse de la vidéo": "Analysing the video",
    "Rédaction des étapes": "Writing the steps",
    "L'IA relit la transcription et en tire les étapes.": "The AI reads the transcript and draws the steps from it.",
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
    "Ancien → nouveau": "Oldest → newest",
    "Annuler": "Cancel",
    "Arrivés récemment": "Recently joined",
    "Aucune vidéo importée": "No video imported",
    "Autorisez la caméra pour scanner": "Allow the camera to scan",
    "Bonjour 👋": "Hello 👋",
    "Catégorie": "Category",
    "Catégories les plus consultées": "Most viewed categories",
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
    "Complétez le titre et la catégorie ci-dessus pour continuer.": "Fill in the title and category above to continue.",
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
    "Filmez une fois, l'IA repère les étapes · 5 min maximum": "Film once, the AI finds the steps · 5 min maximum",
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
    "L'IA découpe la vidéo": "The AI cuts the video",
    "L'IA découpe un document": "The AI cuts a document",
    "L'IA lit votre document…": "The AI is reading your document…",
    "L'IA travaille au mieux sur des vidéos de": "The AI works best on videos of",
    "L'analyse tourne sur nos serveurs.": "The analysis runs on our servers.",
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
    "Retirer une personne lui coupe immédiatement l'accès aux procédures de l'entreprise. Son compte Procédo reste actif : elle pourra rejoindre une autre entreprise avec un nouveau code.": "Removing someone immediately cuts their access to the company procedures. Their Procédo account stays active: they can join another company with a new code.",
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
    "Un souci, une idée, une question sur Procédo ? Nous lisons tout et nous répondons au plus vite.": "A problem, an idea, a question about Procédo? We read everything and reply as soon as we can.",
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
    "À imprimer et afficher sur le poste de travail": "Print and display at the workstation",
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
    "Entrez le code \u00e0 5 chiffres que votre responsable vous a communiqu\u00e9. Il sera retenu : l'entreprise appara\u00eetra dans la liste au-dessus.":
      'Enter the 5-digit code your manager gave you. It will be remembered: the company will appear in the list above.',
    'Une question ?': 'A question?',
    '\u00c9crivez-nous': 'Write to us',
    'Un souci, une id\u00e9e, une question sur Proc\u00e9do ? Nous lisons tout et nous r\u00e9pondons au plus vite.':
      'A problem, an idea, a question about Proc\u00e9do? We read everything and reply as soon as we can.',
    'Compte': 'Account',
    'Se d\u00e9connecter': 'Sign out',
  },

  es: {
    // ── espace gestion ──
    "Envoi de la vidéo": "Envío del vídeo",
    "La vidéo part vers le service d'analyse.": "El vídeo se envía al servicio de análisis.",
    "Analyse de la vidéo": "Análisis del vídeo",
    "Rédaction des étapes": "Redacción de los pasos",
    "L'IA relit la transcription et en tire les étapes.": "La IA relee la transcripción y extrae los pasos.",
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
    "Ancien → nouveau": "Antiguo → nuevo",
    "Annuler": "Cancelar",
    "Arrivés récemment": "Incorporados recientemente",
    "Aucune vidéo importée": "Ningún vídeo importado",
    "Autorisez la caméra pour scanner": "Autoriza la cámara para escanear",
    "Bonjour 👋": "Hola 👋",
    "Catégorie": "Categoría",
    "Catégories les plus consultées": "Categorías más consultadas",
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
    "Complétez le titre et la catégorie ci-dessus pour continuer.": "Completa el título y la categoría de arriba para continuar.",
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
    "Filmez une fois, l'IA repère les étapes · 5 min maximum": "Graba una vez, la IA detecta los pasos · 5 min máximo",
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
    "L'IA découpe la vidéo": "La IA corta el vídeo",
    "L'IA découpe un document": "La IA corta un documento",
    "L'IA lit votre document…": "La IA está leyendo tu documento…",
    "L'IA travaille au mieux sur des vidéos de": "La IA funciona mejor con vídeos de",
    "L'analyse tourne sur nos serveurs.": "El análisis se ejecuta en nuestros servidores.",
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
    "Retirer une personne lui coupe immédiatement l'accès aux procédures de l'entreprise. Son compte Procédo reste actif : elle pourra rejoindre une autre entreprise avec un nouveau code.": "Quitar a una persona le corta inmediatamente el acceso a los procedimientos de la empresa. Su cuenta Procédo sigue activa: podrá unirse a otra empresa con un nuevo código.",
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
    "Un souci, une idée, une question sur Procédo ? Nous lisons tout et nous répondons au plus vite.": "¿Un problema, una idea, una duda sobre Procédo? Lo leemos todo y respondemos lo antes posible.",
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
    "À imprimer et afficher sur le poste de travail": "Para imprimir y colocar en el puesto de trabajo",
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
    "Entrez le code \u00e0 5 chiffres que votre responsable vous a communiqu\u00e9. Il sera retenu : l'entreprise appara\u00eetra dans la liste au-dessus.":
      'Introduce el c\u00f3digo de 5 cifras que te dio tu responsable. Se guardar\u00e1: la empresa aparecer\u00e1 en la lista de arriba.',
    'Une question ?': '\u00bfUna pregunta?',
    '\u00c9crivez-nous': 'Escr\u00edbenos',
    'Un souci, une id\u00e9e, une question sur Proc\u00e9do ? Nous lisons tout et nous r\u00e9pondons au plus vite.':
      '\u00bfUn problema, una idea, una duda sobre Proc\u00e9do? Lo leemos todo y respondemos lo antes posible.',
    'Compte': 'Cuenta',
    'Se d\u00e9connecter': 'Cerrar sesi\u00f3n',
  },

  pt: {
    // ── espace gestion ──
    "Envoi de la vidéo": "Envio do vídeo",
    "La vidéo part vers le service d'analyse.": "O vídeo está a ser enviado para o serviço de análise.",
    "Analyse de la vidéo": "Análise do vídeo",
    "Rédaction des étapes": "Redação das etapas",
    "L'IA relit la transcription et en tire les étapes.": "A IA relê a transcrição e extrai as etapas.",
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
    "Ancien → nouveau": "Antigo → novo",
    "Annuler": "Cancelar",
    "Arrivés récemment": "Entraram recentemente",
    "Aucune vidéo importée": "Nenhum vídeo importado",
    "Autorisez la caméra pour scanner": "Autorize a câmara para ler",
    "Bonjour 👋": "Olá 👋",
    "Catégorie": "Categoria",
    "Catégories les plus consultées": "Categorias mais consultadas",
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
    "Complétez le titre et la catégorie ci-dessus pour continuer.": "Preencha o título e a categoria acima para continuar.",
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
    "Filmez une fois, l'IA repère les étapes · 5 min maximum": "Filme uma vez, a IA deteta as etapas · 5 min no máximo",
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
    "L'IA découpe la vidéo": "A IA corta o vídeo",
    "L'IA découpe un document": "A IA corta um documento",
    "L'IA lit votre document…": "A IA está a ler o seu documento…",
    "L'IA travaille au mieux sur des vidéos de": "A IA funciona melhor com vídeos de",
    "L'analyse tourne sur nos serveurs.": "A análise corre nos nossos servidores.",
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
    "Retirer une personne lui coupe immédiatement l'accès aux procédures de l'entreprise. Son compte Procédo reste actif : elle pourra rejoindre une autre entreprise avec un nouveau code.": "Remover uma pessoa corta-lhe imediatamente o acesso aos procedimentos da empresa. A conta Procédo mantém-se ativa: poderá aderir a outra empresa com um novo código.",
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
    "Un souci, une idée, une question sur Procédo ? Nous lisons tout et nous répondons au plus vite.": "Um problema, uma ideia, uma dúvida sobre o Procédo? Lemos tudo e respondemos o mais depressa possível.",
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
    "À imprimer et afficher sur le poste de travail": "Para imprimir e afixar no posto de trabalho",
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
    "Entrez le code \u00e0 5 chiffres que votre responsable vous a communiqu\u00e9. Il sera retenu : l'entreprise appara\u00eetra dans la liste au-dessus.":
      'Introduza o c\u00f3digo de 5 algarismos que o seu respons\u00e1vel lhe deu. Ser\u00e1 guardado: a empresa aparecer\u00e1 na lista acima.',
    'Une question ?': 'Uma pergunta?',
    '\u00c9crivez-nous': 'Escreva-nos',
    'Un souci, une id\u00e9e, une question sur Proc\u00e9do ? Nous lisons tout et nous r\u00e9pondons au plus vite.':
      'Um problema, uma ideia, uma d\u00favida sobre o Proc\u00e9do? Lemos tudo e respondemos o mais depressa poss\u00edvel.',
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
   ou un nom de catégorie ne figure pas dans le dictionnaire, il ne risque donc
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
function afficherBarre(montrer) {
  const b = document.getElementById('bar')
  if (b) b.style.display = montrer ? '' : 'none'
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

window.onNavigate = function (index) {
  if (index === 0) showGestionScreen('p-home')
  else if (index === 1) showGestionScreen('p-list')
  else if (index === 2) { showGestionScreen('p-global-analyse'); loadGlobalAnalyse() }
  else if (index === 3) openSettings()
}

function afficherCoquille(espace) {
  const appEl = document.getElementById(espace === 'equipe' ? 'equipe-app' : 'gestion-app')
  if (!appEl || appEl.style.display === 'block') return
  appEl.style.display = 'block'
  afficherBarre(true)

  if (espace === 'equipe') {
    const liste = document.getElementById('e-cat-grid')
    if (liste && !liste.children.length) {
      liste.innerHTML = Array.from({ length: 5 }).map(() => `
        <div class="sop-card squelette">
          <div style="flex:1;">
            <div class="sq-bloc" style="height:15px; width:62%;"></div>
            <div class="sq-bloc" style="height:11px; width:38%; margin-top:7px;"></div>
          </div>
          <div class="sq-bloc" style="width:24px; height:24px; border-radius:50%;"></div>
        </div>`).join('')
    }
    return
  }

  const grille = document.getElementById('cat-grid')
  if (grille && !grille.children.length) {
    grille.innerHTML = Array.from({ length: 4 }).map(() => `
      <div class="cat-cell squelette">
        <div class="cat-top">
          <div class="sq-bloc" style="width:46px; height:46px; border-radius:50%;"></div>
          <div class="sq-bloc" style="width:26px; height:18px; border-radius:100px;"></div>
        </div>
        <div class="sq-bloc" style="height:15px; width:70%; margin-top:12px;"></div>
        <div class="sq-bloc" style="height:12px; width:45%; margin-top:9px;"></div>
        <div class="sq-bloc" style="height:11px; width:85%; margin-top:14px;"></div>
        <div class="sq-bloc" style="height:11px; width:65%; margin-top:6px;"></div>
      </div>`).join('')
  }
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
  document.getElementById('choice-screen').style.display = 'none'
  document.getElementById('login-screen').style.display = 'flex'
  document.getElementById('auth-title').textContent = space === 'gestion' ? 'Espace Gestion' : 'Espace Équipe'
  document.getElementById('signup-gestion-field').style.display = space === 'gestion' ? 'block' : 'none'
  document.getElementById('signup-equipe-field').style.display = space === 'equipe' ? 'block' : 'none'
  switchAuthTab('login')
  document.getElementById('login-error').textContent = ''
}
window.backToChoice = function() {
  document.getElementById('login-screen').style.display = 'none'
  afficherEcranChoix()
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
  if (selectedSpace === 'equipe' && !/^\d{5}$/.test(codeAcces)) { errorEl.textContent = 'Le code entreprise doit contenir exactement 5 chiffres.'; return }

  // Pour l'équipe : vérifier que le code correspond bien à une entreprise AVANT de créer le compte
  let targetEntrepriseId = null
  if (selectedSpace === 'equipe') {
    const entreprise = await entrepriseParCode(codeAcces)
    const entrepriseError = null
    if (entrepriseError || !entreprise) {
      errorEl.textContent = "Ce code entreprise n'existe pas. Vérifiez-le auprès de votre gestionnaire."
      return
    }
    targetEntrepriseId = entreprise.id
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
    // Espace équipe : on rejoint une entreprise existante, il n'y a rien à créer.
    const { data: fiche, error: membreError } = await supabase
      .from('membres')
      .insert({
        user_id: data.user.id,
        nom: `${prenom} ${nom}`,
        role: selectedSpace,
        entreprise_id: targetEntrepriseId
      })
      .select().single()

    if (membreError) {
      errorEl.style.color = 'var(--red)'
      errorEl.textContent = "Compte créé mais erreur de profil : " + membreError.message
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
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ membre_id: membre.id, entreprise_id: membre.entreprise_id }),
    })
    const data = await rep.json()
    return !data?.bloque
  } catch (ex) {
    /* Fonction non déployée, réseau coupé : on laisse passer. Mieux vaut ne pas
       compter que de bloquer quelqu'un de légitime. */
    console.warn('Proc\u00e9do \u00b7 pr\u00e9sence :', ex?.message || ex)
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
      `Proc\u00e9do compte les lectures par personne : si votre \u00e9quipe partage un seul ` +
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
  const parAppareil = new Map()
  for (const a of brut) {
    const cle = String(a.nom || 'Appareil').trim().toLowerCase()
    const connu = parAppareil.get(cle)
    if (!connu) {
      parAppareil.set(cle, { ...a, lignes: [a.id], reseaux: a.reseau ? [a.reseau] : [] })
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
    document.getElementById('login-screen').style.display = 'flex'
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
    await loadGestionProcedures()
    document.getElementById('login-screen').style.display = 'none'
    document.getElementById('choice-screen').style.display = 'none'
    const appEl = document.getElementById('gestion-app')
    appEl.style.display = 'block'
    if (basculeSansAnimation) {
      // On retire la classe sans la remettre : aucune animation ne peut rejouer.
      appEl.classList.remove('app-shell-in')
    } else {
      appEl.classList.remove('app-shell-in'); void appEl.offsetWidth; appEl.classList.add('app-shell-in')
    }
    afficherBarre(true)
    mesurerOnglets()
    window.jalon?.('APP AFFICHÉE')
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

  // Le code se lit aussi depuis la liste, sans entrer dans sa page.
  const code = cachedEntreprise?.code_acces || ''
  if (el('reg-code-val')) el('reg-code-val').textContent = code || '\u2014'
  if (el('settings-code')) el('settings-code').textContent = code || '\u2014'

  /* La ligne des établissements n'apparaît qu'à ceux qui en ont plusieurs, ou
     dont l'offre le permet : ailleurs elle n'aurait rien à montrer. */
  const ne = (mesEtablissements || []).length
  const montrer = ne > 0 && multiSitesAutorise()
  if (el('reg-ligne-etabs')) el('reg-ligne-etabs').style.display = montrer ? 'flex' : 'none'
  if (el('reg-filet-etabs')) el('reg-filet-etabs').style.display = montrer ? 'block' : 'none'
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

  if (entreprise && entreprise.code_acces) {
    document.getElementById('settings-code').textContent = entreprise.code_acces
  } else {
    // Cette entreprise n'a pas encore de code (créée avant l'ajout de cette fonctionnalité) : on en génère un
    let nouveauCode = null
    for (let tentative = 0; tentative < 5 && !nouveauCode; tentative++) {
      const code = String(Math.floor(10000 + Math.random() * 90000))
      const { error: updateError } = await supabase
        .from('entreprises').update({ code_acces: code }).eq('id', currentMembre.entreprise_id)
      if (!updateError) nouveauCode = code
    }
    if (nouveauCode && cachedEntreprise) cachedEntreprise.code_acces = nouveauCode
    document.getElementById('settings-code').textContent = nouveauCode || '—'
  }
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
  const sujet = encodeURIComponent('Procédo · ' + espace)
  const corps = encodeURIComponent(
    '\n\n\u2014\n' + (currentMembre?.nom || '') + ' \u00b7 espace ' + espace)
  window.location.href = `mailto:Procedo.off@gmail.com?subject=${sujet}&body=${corps}`
}
/* Les avatars de l'accueil ouvrent la MÊME fenêtre que la carte « Écrivez-nous »
   des réglages. Ils avaient chacun leur texte, plus court et différent : deux
   portes vers le même endroit doivent dire la même chose, sinon on croit
   arriver ailleurs. */
;['contact-gestion', 'contact-equipe', 'accueil-avatar', 'e-avatar'].forEach(id => {
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

/* Les bascules vivent dans des écrans masqués au chargement : rien n'est
   mesurable tant qu'ils ne sont pas visibles. On repose donc la pastille à
   chaque affichage d'écran, et au redimensionnement. */
function reposerPastilles(immediat) {
  placerPastille(document.getElementById('pm-tri'), immediat)
}
window.addEventListener('resize', () => reposerPastilles(true))

window.setGaPeriod = function(period) {
  currentGaPeriod = period
  renderGaStats()
}

/* ═══════════════════════════════════════════════════════════════════════════
   L'ANALYSE

   Le taux d'abord, en grand : c'est la réponse à la question qu'on se pose en
   ouvrant la page. Puis ce qu'il manque, en une phrase. Puis l'équipe, les
   catégories, et ce qu'il reste à traiter.

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
  renderTopCategories(procedures, dansPeriode, nbEmployes, libelle)
  renderMembresListe()
  renderGainTemps(validations, procedures)
  renderTempsLecture(procedures, dansPeriode, libelle)
}

/* Ce qu'il reste à faire. Chaque ligne est elle-même l'action : on la touche, on
   arrive là où l'on peut régler le problème. Un bouton unique « relancer
   l'équipe » ne disait ni qui relancer, ni pourquoi. */
/* ═══════════════════════════════════════════════════════════════════════════
   OÙ L'ÉQUIPE PASSE SON TEMPS

   Le classement des procédures par temps de lecture cumulé. C'est le troisième
   axe de la page : qui lit, dans quelle catégorie, et sur quoi.

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
    el.innerHTML = vide({
      dessin: NEANT_PROCEDURE,
      titre: 'Rien de lu ce mois-ci',
      phrase: "D\u00e8s que quelqu'un ouvrira une proc\u00e9dure, vous verrez ici celles qui occupent le plus votre \u00e9quipe.",
    })
    return
  }

  const visibles = tout ? classement : classement.slice(0, 3)

  /* La même forme que la section Équipe : une ligne nue, le nom au-dessus de
     son sous-titre, la valeur à droite. Pas de cadre, pas de flèche — deux
     sections voisines qui présentent la même chose doivent se ressembler. */
  el.innerHTML = ''
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

/* Classement des catégories par taux de consultation.
   Le taux d'une catégorie = consultations réellement enregistrées, divisé par
   le nombre de consultations possibles, soit ses procédures x ses employés.
   On raisonne en pourcentage et non en volume brut, sinon une catégorie de
   dix procédures écraserait systématiquement une catégorie de deux. */
/* `cible` et `tout` permettent de réutiliser ce rendu sur la page entière :
   mêmes lignes, même grammaire, un seul endroit qui les dessine. */
/* Les catégories où l'équipe passe le plus de temps.

   Avant, on classait par taux de consultation. Mais un taux élevé sur une
   catégorie d'une seule procédure ne dit rien ; le temps, lui, se compare
   d'une catégorie à l'autre quelle que soit leur taille. */
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

  /* À quelle catégorie appartient chaque procédure. */
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

  const visibles = tout ? classement : classement.slice(0, 3)

  el.innerHTML = visibles.map(c => {
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
    const employes = membres.filter(m => m.role === 'equipe')
    currentGaData = { procedures: allGestionProcedures, membres, employes, validations }

    /* On ne repeint que si l'écran d'analyse est encore à l'écran : l'appel est
       asynchrone, l'utilisateur a pu partir ailleurs entre-temps. */
    if (document.getElementById('p-global-analyse')?.classList.contains('active')) {
      renderGaStats()
    }
  } catch (e) {
    console.warn('Proc\u00e9do \u00b7 analyse non rafra\u00eechie :', e?.message || e)
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
   partout ailleurs dans l'app. Une catégorie tombait en vert par le seul hasard
   de son rang, et paraissait aller mieux que sa voisine.

   Six ambres du plus clair au plus sombre : on les distingue par la clarté, ce
   qui reste lisible même pour un œil qui confond les teintes. */
const FM_TEINTES = ['#FFC46B', '#FF9A1F', '#E07A12', '#B85E0C', '#8A4508', '#FFDCA8']

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

/* CINQ PARTS AU PLUS, le gris compris.

   Sept étaient encore trop : à sept couleurs, on ne distingue plus laquelle est
   laquelle sans revenir à la légende à chaque fois. Quatre couleurs et un gris
   se lisent d'un regard — c'est à peu près la limite de ce qu'on retient.

   Le gris ne paraît QUE s'il rassemble quelque chose : avec trois procédures,
   il n'y a rien à regrouper et l'anneau n'en montre que trois. */
const ANNEAU_PARTS_MAX = 5
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

  /* Rien à regrouper : on rend la liste telle quelle. */
  if (!petites.length && grosses.length <= ANNEAU_PARTS_MAX) return vus

  const tri = [...grosses].sort((a, b) => valeur(b) - valeur(a))
  /* Une place est réservée à « autres » dès qu'il y aura quelque chose à y
     mettre — des petites écartées, ou des grosses en trop. Sinon le plafond de
     sept devenait huit avec le gris. */
  const deborde = petites.length > 0 || tri.length > ANNEAU_PARTS_MAX
  const place = deborde ? ANNEAU_PARTS_MAX - 1 : ANNEAU_PARTS_MAX
  const gardees = tri.slice(0, place)
  const reste = [...tri.slice(place), ...petites]
  if (!reste.length) return gardees
  const total = reste.reduce((t, x) => t + valeur(x), 0)
  if (!total) return gardees

  /* « Autres » en gris, jamais en couleur : une teinte de plus laisserait croire
     à une catégorie réelle. Le gris dit « ceci n'est pas une part, c'est ce qui
     reste ». */
  const modele = reste[0]
  const autres = { ...modele, couleur: ANNEAU_GRIS, estAutres: true, _reste: reste.length }
  if ('total' in modele) autres.total = total
  if ('secondes' in modele) autres.secondes = total
  autres.nom = `${reste.length} autres`
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

  /* L'écart s'adapte au NOMBRE de parts. À vingt catégories, cinq pixels chacune
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
    n.textContent = `${vus} proc\u00e9dure${vus > 1 ? 's' : ''} sur ${vue.classe.length}`
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
  const mot = document.getElementById('fm-periode-mot')
  if (mot) mot.textContent = fmPeriode === 'all' ? 'Depuis le d\u00e9but' : 'Ce mois-ci'
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
     Catégories et Procédures le mois. Trois chiffres qui ne se comparent pas,
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
  const visibles = membresDeplies ? trie : trie.slice(0, 3)

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

  /* Le bouton ouvre une page entière plutôt que de déplier sur place : au-delà
     de trois lignes, on ne consulte plus, on cherche — et chercher demande une
     page à soi, avec son tri et son compte. */
  if (trie.length > 3) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'an-plus'
    b.textContent = libelleVoirAutres(trie.length - 3)
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

  const total = validations.reduce((x, v) => x + Number(v.duree_lecture || 0), 0)
  const actifs = new Set(validations.filter(v => Number(v.duree_lecture)).map(v => v.membre_id)).size
  const jamais = employes.length - actifs

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
  t.textContent = actifs > 1
    ? `${actifs} sur ${employes.length} se sont form\u00e9s ce mois-ci`
    : `1 sur ${employes.length} s'est form\u00e9 ce mois-ci`

  /* Le compte de ceux qui n'ont rien ouvert a été retiré : le titre le dit déjà
     — « 3 sur 5 », les deux autres se déduisent. Répéter le manque juste en
     dessous en faisait un reproche là où le chiffre suffisait. */
  if (jamais === 0) {
    const moyenne = Math.round(total / Math.max(1, actifs))
    s.innerHTML = `Toute votre \u00e9quipe est \u00e0 jour, <b>${dureeLisible(moyenne)} par personne</b> en moyenne. ` +
      `Votre \u00e9tablissement peut le prouver.`
  } else if (jamais === 1) {
    const seul = employes.find(e => !validations.some(v =>
      v.membre_id === e.id && Number(v.duree_lecture)))
    s.innerHTML = seul?.nom
      ? `Il ne manque que <b>${escapeHtml(seul.nom)}</b>. Touchez son nom pour le d\u00e9tail de son activit\u00e9.`
      : `Il ne manque qu'<b>une personne</b>. Touchez son nom pour le d\u00e9tail de son activit\u00e9.`
  } else {
    s.innerHTML = `Touchez un nom pour le <b>d\u00e9tail de son activit\u00e9</b> : ` +
      `ce qui l'occupe et ce qu'il n'a pas ouvert.`
  }
}

let anEqVues = { month: { classe: [], total: 0, deplie: false },
                 all:   { classe: [], total: 0, deplie: false } }
let anEqPeriode = 'month'

function peindreAnEquipe() {
  if (!currentGaData) return
  const { employes, validations } = currentGaData
  peindreIntroEquipe(employes, validations)

  const debutMois = new Date()
  debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0)
  const duMois = (validations || []).filter(v => new Date(v.validated_at) >= debutMois)

  for (const [cle, lot] of [['month', duMois], ['all', validations || []]]) {
    const vue = anEqVues[cle]
    vue.classe = (employes || []).map(m => {
      const siennes = lot.filter(v => v.membre_id === m.id)
      return {
        membre: m, nom: m.nom || 'Sans nom',
        total: siennes.reduce((t, v) => t + Number(v.duree_lecture || 0), 0),
        lues: new Set(siennes.map(v => v.procedure_id)).size,
      }
    }).sort((a, b) => b.total - a.total)

    vue.total = vue.classe.reduce((t, x) => t + x.total, 0)
    let n = 0
    vue.classe.forEach(x => { if (x.total) x.couleur = FM_TEINTES[n++ % FM_TEINTES.length] })

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
  const vus = regrouperParts(vue.classe.filter(x => x.total), x => x.total)
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
    const actifs = vue.classe.filter(x => x.total).length
    v.textContent = String(Math.round(vue.total / 60))
    u.textContent = cle === 'all' ? 'minutes au total' : 'minutes ce mois-ci'
    n.textContent = `${actifs} sur ${vue.classe.length} personne${vue.classe.length > 1 ? 's' : ''}`
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

  const partsAnneau = regrouperParts(vue.classe.filter(x => x.total > 0), x => x.total)
  const grises = new Set()
  if (partsAnneau.find(x => x.estAutres)) {
    const montrees = new Set(partsAnneau.filter(x => !x.estAutres))
    vue.classe.forEach(x => { if (!montrees.has(x)) grises.add(x) })
  }
  const visibles = (vue.deplie ? vue.classe : partsAnneau).map(x =>
    grises.has(x) ? { ...x, couleur: ANNEAU_GRIS } : x)

  el.innerHTML = visibles.map((x, rang) => {
    const neuve = animerDes != null && rang >= animerDes
    return `
      <button type="button" class="fm-lg${neuve ? ' neuve' : ''}"
              ${neuve ? `style="animation-delay:${(rang - animerDes) * 0.05}s"` : ''}
              data-part="${rang}" ${x.estAutres ? '' : `data-membre="${escapeHtml(x.membre.id)}"`}>
        <span class="pt" style="background:${x.couleur || 'rgba(255,255,255,0.14)'}"></span>
        <span class="co">
          <span class="nm">${escapeHtml(x.estAutres ? (x.nom || 'Autres') : x.nom)}</span>
          <span class="st">${x.estAutres ? 'Les moins actifs'
            : (x.membre.poste ? escapeHtml(x.membre.poste) + ' \u00b7 ' : '') +
              x.lues + ' proc\u00e9dure' + (x.lues > 1 ? 's' : '') + ' lue' + (x.lues > 1 ? 's' : '')}</span>
        </span>
        <span class="vl"${x.total ? '' : ' style="color:var(--label-3)"'}>${
          x.total ? dureeLisible(x.total) : 'jamais'}</span>
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

  /* Toucher éclaire la part ; un appui long ouvre la fiche. Le geste court sert
     à comparer, le long à aller voir — comme sur les deux autres pages. */
  el.querySelectorAll('[data-part]').forEach(b => {
    let minuteur = null, ouverte = false
    b.addEventListener('pointerdown', () => {
      ouverte = false
      if (!b.dataset.membre) return
      minuteur = setTimeout(() => { ouverte = true; ouvrirFicheMembre(b.dataset.membre) }, 550)
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
  const mot = document.getElementById('an-mot-eq')
  if (mot) mot.textContent = anEqPeriode === 'all' ? 'Depuis le d\u00e9but' : 'Ce mois-ci'
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





/* La page des catégories, bâtie exactement comme celle des procédures : deux
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

  /* L'écart s'adapte au NOMBRE de parts. À vingt catégories, cinq pixels chacune
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

  /* Toucher éclaire la part ; un appui long ouvre la catégorie. Le geste court
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
  const mot = document.getElementById('an-mot-cat')
  if (mot) mot.textContent = anCatPeriode === 'all' ? 'Depuis le d\u00e9but' : 'Ce mois-ci'
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

  /* L'écart s'adapte au NOMBRE de parts. À vingt catégories, cinq pixels chacune
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
  const mot = document.getElementById('an-mot-proc')
  if (mot) mot.textContent = anProcPeriode === 'all' ? 'Depuis le d\u00e9but' : 'Ce mois-ci'
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
  'p-reg-postes': 3, 'p-reg-etabs': 3, 'p-reg-langue': 3, 'p-reg-appareils': 3,
  'p-abonnement': 3, 'p-membres': 3,
}


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
}

/* Les deux gestes dans le BON ORDRE : la naissance d'abord, l'activation
   ensuite. C'était tout le problème — ajouter « active » puis « nait »
   laissait le navigateur démarrer l'ancienne animation avant de la remplacer,
   et on voyait les deux l'une par-dessus l'autre.

   Les écrans de l'espace équipe s'activent à la main, sans passer par
   `showEquipeScreen` : ils appellent cette fonction directement. */
function activerAvecNaissance(ecran) {
  if (!ecran) return
  oublierNaissances()
  ouvrirDepuisCarte(ecran)
  ecran.classList.add('active')
}

window.showGestionScreen = function(id, btn) {
  arreterToutesLesVideos()
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
}

// Le document défile d'un seul bloc, tous écrans confondus : sans ça, en
// ouvrant une catégorie depuis le bas de la grille, on atterrissait sur un
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
  'e-settings': 2, 'e-reg-compte': 2, 'e-reg-entreprises': 2,
  'e-reg-poste': 2, 'e-reg-langue': 2, 'reg-appareils': 2,
}

window.showEquipeScreen = function(id, btn) {
  arreterToutesLesVideos()
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

function cleCache(entrepriseId) { return 'procedo_grille_' + entrepriseId }

function rangerGrille(entrepriseId, categories, sous) {
  try {
    const leger = (categories || []).map(c => ({
      nom: c.nom, icone: c.icone, avgPct: c.avgPct,
      latestDate: c.latestDate, earliestDate: c.earliestDate,
      procsInCat: (c.procsInCat || []).map(p => ({
        id: p.id, titre: p.titre, categorie: p.categorie, statut: p.statut,
        created_at: p.created_at, video_url: p.video_url, image_url: p.image_url,
        etapes: p.etapes,
      })),
    }))
    localStorage.setItem(cleCache(entrepriseId), JSON.stringify({ quand: Date.now(), sous, categories: leger }))
  } catch (e) {
    // Mémoire pleine ou navigation privée : on s'en passe, ce n'est qu'un confort.
    console.warn('Proc\u00e9do \u00b7 grille non mise en cache :', e?.message || e)
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
      ecrireSous(`0 catégorie · 0 procédure · accès complet`)
    // On mesure APRÈS avoir écrit : la grille doit exister pour être située.
    requestAnimationFrame(() => ajusterHauteurDebut())
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
              <circle cx="112" cy="26" r="13" fill="url(#logoOrIc)"/>
              <line x1="112" y1="20" x2="112" y2="32" stroke="#2A1400" stroke-width="2.6" stroke-linecap="round"/>
              <line x1="106" y1="26" x2="118" y2="26" stroke="#2A1400" stroke-width="2.6" stroke-linecap="round"/>
            </g>
          </svg>
        </div>
        <h3>Votre première procédure</h3>
        <p>Décrivez une tâche étape par étape, ou filmez-la une seule fois — l'IA la découpe pour vous.</p>
        <div class="fleche">Touchez « Créer une procédure », en haut de la page</div>
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
    const nom = p.categorie || 'Sans catégorie'
    if (!categoriesMap[nom]) categoriesMap[nom] = '📁'
  })

  const nbCategories = Object.keys(categoriesMap).length
  ecrireSous(`${nbCategories} catégorie${nbCategories > 1 ? 's' : ''} · ${procedures.length} procédure${procedures.length > 1 ? 's' : ''} · accès complet`)

  allCategoriesData = []
  for (const [nom, icone] of Object.entries(categoriesMap)) {
    const procsInCat = procedures.filter(p => (p.categorie || 'Sans catégorie') === nom) // déjà trié du plus récent au plus ancien

    // Taux moyen de consultation de la catégorie (moyenne des taux de chaque procédure)
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
function renderAccueil() {
  const salut = document.getElementById('accueil-salut')
  const mot = document.getElementById('accueil-mot')
  if (!salut || !mot) return

  const h = new Date().getHours()
  const bonjour = h < 6 ? 'Bonne nuit' : h < 18 ? 'Bonjour' : 'Bonsoir'
  const prenom = (currentMembre?.nom || '').trim().split(' ')[0]
  salut.textContent = `${bonjour}${prenom ? ' ' + prenom : ''} 👋`

  const nbProcs = allGestionProcedures.length
  const nbEmp = cachedEmployes.length

  if (!nbProcs) {
    mot.innerHTML = "Vous n'avez pas encore de procédure. Commencez quand vous voulez, ça prend quelques minutes."
    return
  }
  if (!nbEmp) {
    mot.innerHTML = "Votre équipe est vide. Partagez votre code d'invitation dans les Paramètres pour suivre les lectures."
    return
  }

  const possible = nbProcs * nbEmp
  const taux = possible ? Math.round((cachedValidations.length / possible) * 100) : 0
  const phrase =
    /* « VOS procédures » ne vaut que pour le fondateur. Un gestionnaire promu
       n'en est pas propriétaire : lui dire « vos » sonne faux, et laisse croire
       qu'il porte une responsabilité qui n'est pas la sienne. */
    taux >= 80 ? `L'équipe suit très bien. <b>${taux} %</b> des procédures ont été lues.` :
    taux >= 50 ? `Ça avance. <b>${taux} %</b> des procédures ont été lues par l'équipe.` :
    taux >= 20 ? `<b>${taux} %</b> des procédures ont été lues. Un rappel à l'équipe ne ferait pas de mal.` :
                 `Seulement <b>${taux} %</b> des procédures ont été lues. Affichez les QR codes sur les postes.`
  mot.innerHTML = phrase
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
   changement d'établissement : ce sont d'autres catégories. */
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
         est vidée à chaque changement de page, et une catégorie qui existe depuis
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
function ajusterHauteurDebut() {
  const debut = document.querySelector('#cat-grid .debut, #e-cat-grid .debut')
  if (!debut) return
  const haut = Math.round(debut.getBoundingClientRect().top + window.scrollY)
  const barre = document.getElementById('tabbar')?.offsetHeight
    || document.getElementById('tabbar')?.offsetHeight || 88
  // 22 px de respiration sous le texte, pour qu'il ne touche pas la barre.
  debut.style.setProperty('--debut-h', `calc(100dvh - ${haut}px - ${barre + 22}px)`)
}
window.addEventListener('resize', ajusterHauteurDebut)
window.addEventListener('orientationchange', () => setTimeout(ajusterHauteurDebut, 120))

function renderCategoryGrid() {
  const catGridEl = document.getElementById('cat-grid')
  const oldRects = captureCardPositions(catGridEl)
  catGridEl.innerHTML = ''

  // Départage systématique par ordre alphabétique : sans ça, deux catégories
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
        ${recentTitles.map(p => `<div class="cat-recent-item"><span class="txt">${escapeHtml(p.titre)}</span>${etatProcedureHtml(p)}</div>`).join('')}
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
    /* Sur la carte d'une catégorie, un titre en panne mène directement à la
       reprise : sinon il faudrait ouvrir la catégorie pour s'en apercevoir. */
    cell.onclick = (e) => {
      const ligne = e.target.closest('.cat-recent-item')
      if (ligne) {
        const titre = ligne.querySelector('.txt')?.textContent
        const p = procsInCat.find(x => x.titre === titre)
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
        console.error(`[Procédo] Erreur au tri "${prefix}" :`, err)
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


// Texte tapé dans la recherche de l'écran d'une catégorie
let currentCategoryQuery = ''

document.getElementById('category-search-input')?.addEventListener('input', (e) => {
  currentCategoryQuery = e.target.value.trim().toLowerCase()
  renderCategoryProceduresList()
})

let currentCategorySort = 'az'
wireSortDropdown('dd-category-sort', (sort) => { currentCategorySort = sort; renderCategoryProceduresList() })

let currentCategoryProcsData = []
let toutesProcedures = false   // vrai quand on affiche toutes les procédures

function openCategoryProcedures(nom) {
  try { ouvrirCategorie(nom) }
  catch (e) {
    console.error('Ouverture de la catégorie :', e)
    showGestionScreen('p-category')
    const el = document.getElementById('category-procedures-list')
    if (el) el.innerHTML = `<div class="empty-state"><h3>Ouverture impossible</h3><p>${escapeHtml((e && e.message) || 'erreur inconnue')}</p></div>`
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   RENOMMER UNE CATÉGORIE

   La catégorie n'est pas une table : c'est une colonne de texte sur chaque
   procédure. La renommer, c'est réécrire ce texte sur toutes celles qui la
   portent — d'un seul appel, filtré sur l'ancien nom.

   Conséquence à connaître : deux catégories fusionnent si on donne à l'une le
   nom de l'autre. C'est cohérent avec ce qu'est une catégorie ici, et c'est même
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

  // Une catégorie de ce nom existe déjà : on le dit, on ne l'empêche pas.
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
  /* On recharge : les regroupements par catégorie sont construits au chargement,
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
     une catégorie, c'est une vue. */
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

  const procsInCategory = toutesProcedures
    ? allGestionProcedures
    : allGestionProcedures.filter(p => (p.categorie || 'Sans catégorie') === nom)
  const nbCat = new Set(allGestionProcedures.map(p => p.categorie || 'Sans catégorie')).size
  document.getElementById('category-subhead').textContent = toutesProcedures
    ? `${procsInCategory.length} procédure${procsInCategory.length > 1 ? 's' : ''} · ${nbCat} catégorie${nbCat > 1 ? 's' : ''}`
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

  const filtered = currentCategoryQuery
    ? currentCategoryProcsData.filter(d => {
        const titre = (d.proc.titre || '').toLowerCase()
        // En vue globale, on peut aussi chercher par nom de catégorie
        const cat = toutesProcedures ? (d.proc.categorie || 'sans catégorie').toLowerCase() : ''
        return titre.includes(currentCategoryQuery) || (cat && cat.includes(currentCategoryQuery))
      })
    : currentCategoryProcsData

  const parTitre = (a, b) => (a.proc.titre || '').localeCompare(b.proc.titre || '', 'fr', { sensitivity: 'base' })
  const sorted = [...filtered].sort((a, b) => {
    if (currentCategorySort === 'new') return (b.createdAt - a.createdAt) || parTitre(a, b)
    if (currentCategorySort === 'old') return (a.createdAt - b.createdAt) || parTitre(a, b)
    return parTitre(a, b)
  })

  for (const { proc, nbEtapes, pct } of sorted) {
    const ringColor = pct >= 70 ? '#30D158' : pct >= 30 ? '#FF9F0A' : '#FF453A'
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
    /* La même grammaire que la catégorie : plaque à gauche, nom, filet, pied.
       Le pied dit ici le suivi de lecture — la seule chose qu'un gérant vient
       vérifier sur cette page. */
    const detail = [
      `${nbEtapes} étape${nbEtapes > 1 ? 's' : ''}`,
      toutesProcedures ? escapeHtml(proc.categorie || 'Sans catégorie') : '',
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
    manualSteps = [{ texte: '' }]
    reinitialiserCouverture(null)
    renderManualSteps()
  }
})

/* Le même retour, en haut et en bas de page. */

document.getElementById('man-retour')?.addEventListener('click', () => {
  showGestionScreen(manEdition ? 'p-analyse' : 'p-create')
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

   Les trois pages partagent la même valeur : on revient de « Catégories » vers
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

async function chargerPostes() {
  if (!currentMembre?.entreprise_id) return []
  const { data, error } = await supabase.from('postes')
    .select('*').eq('entreprise_id', currentMembre.entreprise_id).order('ordre')
  /* La table peut ne pas exister encore : l'app continue sans les postes plutôt
     que de casser les réglages entiers. */
  if (error) { console.warn('Proc\u00e9do \u00b7 postes indisponibles :', error.message); return [] }
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
  const bas = document.getElementById('vid-ia-bas')
  if (bas) {
    const nbTot = videoSteps.length
    const videsTot = videoSteps.filter(s => !String(s.texte || '').trim()).length
    bas.style.display = nbTot ? 'flex' : 'none'
    /* Le bouton reste ACTIF tant qu'il y a des étapes. Être éteint sans rien
       dire de plus qu'une phrase grise laissait croire à une panne — et quand
       on vidait un texte, il ne se réveillait pas.

       Son libellé ne change plus non plus : « Compléter les étapes avec l'IA »,
       toujours. C'est la note du dessous qui dit où l'on en est. */
    bas.disabled = iaCompletionEnCours || iaVientDeFinir
    /* Pendant le travail : l'anneau seul. À la fin : la coche. Le texte
       disparaît dans les deux cas — il n'y a plus rien à décider, et une phrase
       sous un bouton éteint donne envie d'appuyer encore. */
    bas.classList.toggle('travaille', iaCompletionEnCours)
    bas.classList.toggle('fini', iaVientDeFinir && !iaCompletionEnCours)
    const txt = document.getElementById('vid-ia-bas-txt')
    /* « Compléter les étapes avec l'IA » ne disait pas qui fait quoi : on croyait
       devoir compléter soi-même, avec son aide. Le titre de la page annonce
       « Vous découpez, l'IA rédige » — le bouton reprend ces mots. */
    /* Sans le mot « IA » : la marque AI est déjà dans le bouton, juste à
       gauche. L'écrire deux fois dans le même bouton le dit moins fort, pas
       plus. */
    if (txt) txt.textContent = 'R\u00e9diger mes \u00e9tapes'
  }

  /* La note explicative reste : elle dit combien d'étapes attendent un texte,
     et elle est utile juste au-dessus du bouton du bas. */
  const note = document.getElementById('vid-ia-note')
  if (!note) return
  const nb = videoSteps.length
  const vides = videoSteps.filter(s => !String(s.texte || '').trim()).length
  if (!nb) { note.textContent = ''; return }
  if (iaCompletionEnCours) {
    note.textContent = 'Une \u00e0 deux minutes. Vous pouvez continuer \u00e0 d\u00e9couper.'
  } else if (!vides) {
    note.textContent = 'Toutes vos \u00e9tapes ont d\u00e9j\u00e0 un texte.'
  } else {
    note.textContent = `${vides} \u00e9tape${vides > 1 ? 's' : ''} sans texte. ` +
      `L\u2019IA \u00e9crira \u00e0 partir de ce que vous avez dit pendant chacune.`
  }
}

document.getElementById('vid-ia-bas')?.addEventListener('click', completerEtapesAvecIA)

async function completerEtapesAvecIA() {
  if (iaCompletionEnCours) return
  const note = document.getElementById('vid-ia-note')

  if (!currentVideoFile && !editVideoUrl) {
    note.textContent = 'Importez d\u2019abord une vid\u00e9o.'
    return
  }

  let tempId = null
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
      const chemin = `${base}.webm`
      const { error: eUp } = await supabase.storage.from('procedo-videos')
        .upload(chemin, currentVideoFile, {
          contentType: currentVideoFile.type || 'video/webm',
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
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ procedure_id: tempId, video_url: urlAnalyse }),
    })
    
    const dep = await rep.json()
    if (!rep.ok || dep.error) throw new Error(dep.error || "L\u2019analyse n\u2019a pas d\u00e9marr\u00e9.")

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

/* Interroge le serveur jusqu'à ce que les étapes soient prêtes, puis les lit.
   On espace les demandes : la première minute est celle où ça peut aboutir
   vite, ensuite ça ne sert à rien d'insister toutes les trois secondes. */
async function attendreEtapesIA(procId) {
  const debut = Date.now()
  let tour = 0

  while (Date.now() - debut < 8 * 60000) {
    const rep = await fetch(`${SUPABASE_URL}/functions/v1/ai-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ procedure_id: procId }),
    })
    const data = await rep.json()

    if (data.status === 'ready') {
      const { data: etapes } = await supabase.from('etapes')
        .select('texte').eq('procedure_id', procId).order('ordre')
      return (etapes || []).map(e => String(e.texte || '').trim()).filter(Boolean)
    }
    if (data.status === 'error' || data.error) {
      throw new Error(data.error || "L\u2019analyse a \u00e9chou\u00e9.")
    }

    tour++
    const delai = tour < 12 ? 3000 : tour < 30 ? 5000 : 8000
    await new Promise(r => setTimeout(r, delai))
  }
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

  const fini = etatAbo.statut === 'expire'
  const j = etatAbo.jours_restants
  const nbProc = (allGestionProcedures || []).length
  const nbMembres = (cachedMembres || []).length || 1

  /* BLEU, PAS AMBRE. L'ambre signale une faute — un compte partagé en est une.
     La fin d'un essai n'en est pas une : c'était prévu depuis le premier jour,
     et le client n'a rien fait de mal. Un ambre employé partout ne signalerait
     plus rien. */
  zone.className = 'alerte-essai'
  zone.style.display = 'block'
  zone.innerHTML = `
    <div class="tete">
      <span class="pic">
        <svg viewBox="0 0 24 24" fill="none" stroke="#4DA3FF" stroke-width="1.9"
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
    showGestionScreen('p-abonnement')
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

   Une catégorie s'efface quand sa dernière procédure part. Sans animation, elle
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
  }) || showGestionScreen('p-abonnement')
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
  if (voie === 'coller') document.getElementById('doc-texte')?.focus()
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

document.getElementById('doc-texte')?.addEventListener('input', () => {
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
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
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

// ═══════════ GESTION : L'IA découpe la vidéo ═══════════
/* Le type d'enregistrement, choisi avant l'analyse.

   `false` — on filme un geste : seule la parole porte le sens. On envoie la
   bande son, l'analyse est rapide et ne coûte presque rien.

   `true` — on enregistre un écran : le sens est ÉCRIT dedans, noms de
   transactions, libellés de champs. On envoie la vidéo pour qu'Azure lise ce
   qui est affiché. Plus lent, plus cher — on ne le paie que quand ça sert. */

let aiVideoFile = null
let aiVideoDuree = 0        // durée de la vidéo, pour estimer le temps d'analyse
let aiDebutAnalyse = 0      // heure de démarrage de l'analyse
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

const AI_ETAPES = {
  envoi:         { titre: 'Envoi de la vid\u00e9o', sous: "La vid\u00e9o part vers le service d'analyse." },
  /* « Transcription de la parole » ne dit plus ce qui se passe : l'image est
     analysée en même temps que le son. Et la phrase du dessous décrivait la
     machine — elle occupait une ligne sans rien apprendre. */
  transcription: { titre: 'Analyse de la vid\u00e9o', sous: '' },
  redaction:     { titre: 'R\u00e9daction des \u00e9tapes', sous: "L'IA relit la transcription et en tire les \u00e9tapes." },
}

var aiPalierDepuis = null
function startAiProgressSimulation() {
  aiDebutAnalyse = Date.now()
  aiPalierDepuis = null
  aiNbSondages = 0
  aiEtapeCourante = 'envoi'
  aiProgresAzure = null
  if (aiProgressTimer) clearInterval(aiProgressTimer)
  aiProgressTimer = setInterval(majProgressionIA, 1000)
  majProgressionIA()
}

/* Appelée à chaque sondage : l'étape vient de ce que répond le serveur, le
   pourcentage aussi. Rien n'est deviné ici. */
function signalerEtapeIA(etape, progres) {
  aiEtapeCourante = etape
  aiProgresAzure = (typeof progres === 'number' && progres >= 0 && progres <= 100) ? progres : null
  majProgressionIA()
}

function majProgressionIA() {
  const ecoule = (Date.now() - aiDebutAnalyse) / 1000
  const min = Math.floor(ecoule / 60), sec = Math.floor(ecoule % 60)
  const temps = min > 0 ? `${min} min ${String(sec).padStart(2, '0')}` : `${sec} s`

  const info = AI_ETAPES[aiEtapeCourante] || AI_ETAPES.envoi
  /* Le titre ne change plus à chaque étape. « Transcription de la parole · 14 s »
     décrivait la machine et changeait toutes les vingt secondes ; on annonce
     plutôt ce qu'on obtient, une bonne fois. Le détail de l'étape et le temps
     écoulé passent dans la phrase du dessous, où ils ne bousculent rien. */
  const titre = document.getElementById('ai-progress-title')
  if (titre) titre.textContent = t('Votre proc\u00e9dure s\u2019\u00e9crit')

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

  /* La phrase du dessous peut être vide : on ne laisse alors ni point orphelin
     ni espace en trop. */
  let phrase = `${t(info.titre)} \u00b7 ${temps}.`
  if (info.sous) phrase += ' ' + t(info.sous)
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
  const detail = document.getElementById('ai-detail')
  if (detail) detail.style.display = 'none'
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
  aiVideoFile = file
  const url = URL.createObjectURL(file)
  const player = document.getElementById('ai-video-player')
  player.src = url
  player.style.display = 'block'
  document.getElementById('ai-video-placeholder').style.display = 'none'
  document.getElementById('ai-launch-btn').disabled = false
  aiVideoDuree = 0
  player.addEventListener('loadedmetadata', () => {
    if (isFinite(player.duration)) aiVideoDuree = player.duration
    verifierDureeVideo()
    /* Safari sur iPhone ne peint AUCUNE image tant qu'on n'a pas demandé une
       position. `load()` ne suffit pas : le lecteur reste noir. On avance d'un
       dixième de seconde, ce qui force le rendu d'une vraie image. */
    try { player.currentTime = 0.1 } catch (e) {}
  }, { once: true })
})

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
const DUREE_CONSEILLEE = 5 * 60
/* Cinq minutes. Au-delà, l'analyse marcherait encore, mais deux choses la
   déconseillent : le coût Azure suit la durée à la minute près, et surtout une
   procédure de dix minutes ne se suivrait pas — on la regarde une fois, jamais deux. */
const DUREE_REFUSEE = 5 * 60

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

   150 laisse la marge nécessaire — une scène très détaillée se comprime moins
   bien qu'un plan fixe — tout en écartant ce qui n'a manifestement pas été
   comprimé : une 4K brute de cinq minutes en fait sept cents. */
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
    console.warn('Proc\u00e9do \u00b7 bande son non extraite :', e?.message || e)
    return null
  }
}

/* Sous ce seuil, il n'y a rien à transcrire. 0,01 ≈ −40 dB : au-dessus du bruit
   de fond d'un micro, très en dessous d'une voix. */
const SON_SEUIL = 0.01

/* ═══ LA COMPRESSION AVANT L'ENVOI ═══

   Un iPhone filme en 4K à 60 images par seconde. Cinq minutes pèsent alors
   700 Mo, là où le même geste tient dans 90 Mo en 1080p à 30 images.

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

const VIDEO_LARGEUR_MAX = 1920
const VIDEO_HAUTEUR_MAX = 1080
const VIDEO_IMAGES_S = 30
/* 2,5 Mb/s. À 4, cinq minutes pèsent encore 150 Mo — trop pour un fichier qu'un
   employé retransfère à chaque consultation. À 2,5 on tombe à 90 Mo, et la
   différence ne se voit pas sur un geste filmé : ce n'est ni un paysage ni un
   mouvement rapide, c'est une main qui fait quelque chose devant un plan fixe. */
const VIDEO_DEBIT = 2_500_000

/* Le navigateur sait-il enregistrer ? Safari sur iPhone ne l'a appris que
   récemment. Sans ce test, on planterait au lieu d'envoyer l'original. */
function peutComprimer() {
  return typeof MediaRecorder !== 'undefined' &&
         typeof HTMLCanvasElement.prototype.captureStream === 'function'
}

function formatEnregistrable() {
  for (const t of ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm']) {
    if (MediaRecorder.isTypeSupported?.(t)) return t
  }
  return ''
}

async function comprimerVideo(fichier, surAvancee) {
  if (!peutComprimer()) return fichier
  const type = formatEnregistrable()
  if (!type) return fichier

  const lecteur = document.createElement('video')
  lecteur.src = URL.createObjectURL(fichier)
  lecteur.muted = false
  lecteur.playsInline = true

  try {
    await new Promise((ok, non) => {
      lecteur.onloadedmetadata = ok
      lecteur.onerror = () => non(new Error('lecture impossible'))
      setTimeout(() => non(new Error('trop long')), 15000)
    })

    /* Déjà raisonnable : on n'y touche pas. Recomprimer une vidéo déjà
       compressée ne fait que perdre de la qualité. */
    const large = lecteur.videoWidth, haut = lecteur.videoHeight
    if (!large || !haut) return fichier
    if (large <= VIDEO_LARGEUR_MAX && haut <= VIDEO_HAUTEUR_MAX &&
        fichier.size < 100 * 1024 * 1024) {
      return fichier
    }

    /* On garde les proportions : une vidéo filmée verticalement le reste. */
    const ratio = Math.min(VIDEO_LARGEUR_MAX / large, VIDEO_HAUTEUR_MAX / haut, 1)
    const L = Math.round(large * ratio / 2) * 2   // pair : exigé par les codecs
    const H = Math.round(haut * ratio / 2) * 2

    const toile = document.createElement('canvas')
    toile.width = L; toile.height = H
    const ctx = toile.getContext('2d')

    const flux = toile.captureStream(VIDEO_IMAGES_S)

    /* LE SON DOIT SUIVRE. C'est lui qu'Azure écoute : une vidéo comprimée sans
       audio rendrait l'analyse inutile. */
    try {
      const ctxAudio = new (window.AudioContext || window.webkitAudioContext)()
      /* Le contexte naît parfois suspendu : sans ce réveil, il ne produirait
         aucun échantillon et l'enregistrement serait muet. */
      if (ctxAudio.state === 'suspended') await ctxAudio.resume()
      const source = ctxAudio.createMediaElementSource(lecteur)
      const dest = ctxAudio.createMediaStreamDestination()
      source.connect(dest)

      /* ON NE BRANCHE PAS LES HAUT-PARLEURS.

         Le son partait vers deux endroits : l'enregistrement ET la sortie
         audio. Comme on ne veut pas faire écouter la vidéo à la personne, la
         ligne `lecteur.muted = true` la coupait quinze lignes plus bas.

         Sauf que couper l'élément coupe TOUTE la chaîne : à partir de
         `createMediaElementSource`, l'audio ne passe plus que par le graphe, et
         un élément muet n'y envoie que du silence. On enregistrait donc une
         piste audio parfaitement vide.

         D'où le message « cette vidéo n'a pas de son » sur des vidéos qui en
         avaient : l'app rendait muette la vidéo qu'elle s'apprêtait à juger.

         En ne raccordant pas la sortie, rien n'est audible — sans avoir à
         couper quoi que ce soit. */
      dest.stream.getAudioTracks().forEach(t => flux.addTrack(t))
    } catch (e) {
      /* Sans son, la compression n'a plus d'intérêt : on renvoie l'original. */
      return fichier
    }

    const morceaux = []
    const enr = new MediaRecorder(flux, { mimeType: type, videoBitsPerSecond: VIDEO_DEBIT })
    enr.ondataavailable = (e) => { if (e.data.size) morceaux.push(e.data) }

    const fini = new Promise((ok) => { enr.onstop = ok })
    enr.start(1000)
    /* Surtout pas de `muted` ici : l'élément alimente le graphe audio, le
       couper reviendrait à enregistrer du silence. Rien n'est audible de toute
       façon — la sortie n'est pas raccordée aux haut-parleurs. */
    await lecteur.play()

    let arret = false
    const dessiner = () => {
      if (arret) return
      ctx.drawImage(lecteur, 0, 0, L, H)
      if (surAvancee && lecteur.duration) {
        surAvancee(Math.min(99, Math.round(lecteur.currentTime / lecteur.duration * 100)))
      }
      requestAnimationFrame(dessiner)
    }
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
    enr.stop()

    /* 99 → 100. Le compteur était plafonné à 99 pour ne pas annoncer la fin
       avant l'heure, mais rien ne le passait à 100 : il restait bloqué là
       pendant que l'encodeur terminait, et on croyait à une panne. */
    if (surAvancee) surAvancee(100)

    await fini

    const sortie = new Blob(morceaux, { type })
    /* Si la compression a grossi le fichier — ça arrive sur une vidéo déjà
       optimisée — on garde l'original. */
    if (sortie.size >= fichier.size) return fichier

    const ext = type.includes('mp4') ? 'mp4' : 'webm'
    return new File([sortie], (fichier.name || 'video').replace(/\.[^.]+$/, '') + '.' + ext,
                    { type })
  } catch (e) {
    /* La compression échoue ? On envoie l'original. Elle est un confort, pas une
       condition : refuser la vidéo serait pire que l'envoyer lourde. */
    return fichier
  } finally {
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
      err.innerHTML = `Cette vidéo pèse <b>${poidsLisible(aiVideoFile.size)}</b>. ` +
        `Elle sera allégée avant l'envoi — comptez une minute de plus au lancement.`
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

  if (!aiVideoDuree) { err.textContent = ''; btn.disabled = false; return }

  const min = Math.round(aiVideoDuree / 60)
  if (aiVideoDuree > DUREE_REFUSEE) {
    err.style.color = 'var(--red)'
    err.textContent = `Cette vidéo dure ${min} minutes. L'analyse accepte jusqu'à 5 minutes : ` +
      `filmez une procédure par vidéo, ou découpez celle-ci en deux.`
    btn.disabled = true
    return
  }
  err.textContent = ''
  btn.disabled = false
}

document.getElementById('ai-launch-btn')?.addEventListener('click', async () => {
  const errorEl = document.getElementById('ai-error')
  errorEl.textContent = ''
  const titre = champManuel('titre').value.trim()
  const categorie = champManuel('categorie').value.trim()

  if (!titre) { errorEl.textContent = 'Le titre est obligatoire (en haut de la page précédente).'; return }
  if (!aiVideoFile) { errorEl.textContent = 'Importez une vidéo.'; return }

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

  /* On comprime MAINTENANT, pas à l'import : l'aperçu doit rester immédiat.
     La personne voit sa vidéo tout de suite, et le travail se fait au moment
     où elle accepte d'attendre. */
  if (aiVideoFile) {
    const avant = aiVideoFile.size
    errorEl.style.color = 'var(--label-3)'
    /* Les trois premières étapes durent quelques secondes : elles s'affichent
       sous le bouton, dont l'anneau tourne. On ne change pas d'écran pour si
       peu — la page disparaîtrait et reviendrait aussitôt. */
    errorEl.textContent = '1/3 \u00b7 Pr\u00e9paration de la vid\u00e9o'
    aiVideoFile = await comprimerVideo(aiVideoFile, (pct) => {
      errorEl.textContent = pct >= 100
        ? '1/3 \u00b7 Finalisation de la vid\u00e9o\u2026'
        : `1/3 \u00b7 Pr\u00e9paration de la vid\u00e9o\u2026 ${pct}%`
    })
    errorEl.textContent = ''
    errorEl.style.color = 'var(--red)'
    if (aiVideoFile.size < avant) {
      console.log('Vid\u00e9o all\u00e9g\u00e9e :', poidsLisible(avant), '\u2192', poidsLisible(aiVideoFile.size))
    }
  }

  try {
    errorEl.textContent = '2/3 \u00b7 Envoi de la vid\u00e9o'
    // 1. Upload de la vidéo
    /* Dernier rempart sur le poids : le contrôle à la sélection peut être
       contourné si le fichier change sans repasser par l'événement. */
    /* Ce contrôle vient APRÈS la compression : c'est le poids réel de ce qu'on
     s'apprête à envoyer qui compte, pas celui du fichier d'origine. */
  if (aiVideoFile.size > VIDEO_POIDS_MAX) {
    throw new Error(`Même allégée, cette vidéo pèse ${poidsLisible(aiVideoFile.size)}, ` +
      `au-delà des ${Math.round(VIDEO_POIDS_MAX / 1024 / 1024)} Mo acceptés. ` +
      `Filmez une séquence plus courte.`)
  }


    /* On extrait la bande son AVANT d'envoyer quoi que ce soit. Si elle est
       muette, on refuse tout de suite : transférer 40 Mo puis attendre cinq
       minutes pour annoncer l'échec serait la pire façon de l'apprendre. */
    const son = await extraireBandeSon(aiVideoFile)

    if (son && son.crete < SON_SEUIL) {
      throw new Error('SANS_SON')
    }

    const base = `${currentMembre.entreprise_id}/${Date.now()}`

    // La vidéo : c'est elle qu'on rejoue, extrait par extrait, dans la fiche.
    const path = `${base}_${aiVideoFile.name}`
    const { error: uploadError } = await supabase.storage.from('procedo-videos').upload(path, aiVideoFile, { cacheControl: CACHE_LONG })
    if (uploadError) throw new Error("Erreur d'upload vidéo : " + uploadError.message)
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
      const { data: sigVid } = await supabase.storage.from('procedo-videos')
        .createSignedUrl(videoUrl, 6 * 3600)
      if (!sigVid?.signedUrl) throw new Error("Impossible de pr\u00e9parer la vid\u00e9o pour l'analyse.")
      urlPourAnalyse = sigVid.signedUrl
    }

    errorEl.textContent = '3/3 \u00b7 Vid\u00e9o re\u00e7ue'
/* ═══ ON BASCULE MAINTENANT ═══
       La vidéo est arrivée ; ce qui suit dure des minutes. C'est le moment de
       quitter la page de dépôt pour l'écran d'attente — pas avant, sinon on
       change d'écran pour trois secondes. */
    document.getElementById('ai-upload-card').style.display = 'none'
    document.getElementById('ai-progress-card').style.display = 'block'
    startAiProgressSimulation()
    signalerEtapeIA('Cr\u00e9ation de la proc\u00e9dure\u2026')
    // 2. Création de la procédure (vide pour l'instant, l'IA va remplir les étapes)
    const { data: newProc, error: procError } = await supabase
      .from('procedures')
      .insert({ entreprise_id: currentMembre.entreprise_id, titre, categorie, video_url: videoUrl, created_by: currentMembre.id, statut: 'traitement' })
      .select().single()
    if (procError) throw new Error(procError.message)
    aiProcedureId = newProc.id

    signalerEtapeIA('L\u2019IA \u00e9coute et regarde\u2026')
    // 3. Démarrage de l'analyse Azure
    const startRes = await fetch(`${SUPABASE_URL}/functions/v1/ai-start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      // La bande son pour un geste filmé ; la vidéo entière pour un écran.
      body: JSON.stringify({
        procedure_id: newProc.id,
        video_url: urlPourAnalyse,
        avec_image: true,
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

    /* La procédure existe en base, mais rien en mémoire ne le savait : en allant
       tout de suite dans les catégories, elle n'apparaissait pas. La grille est
       construite à partir de `allCategoriesData`, qui n'est reconstruit que par
       le chargement complet — on le relance donc, sans attendre sa fin pour ne
       pas retarder l'affichage de la progression. */
    loadGestionProcedures().catch(() => {})
  } catch (e) {
    launchBtn.classList.remove('travaille'); launchBtn.disabled = false

    /* ON REVIENT À LA PAGE DE DÉPÔT. Sans ça, l'échec laissait l'écran
       d'attente ouvert sur un anneau figé : la personne voyait le message
       d'erreur derrière, sans moyen de recommencer. */
    stopAiProgressSimulation()
    document.getElementById('ai-progress-card').style.display = 'none'
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
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
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
      document.getElementById('ai-upload-card').style.display = 'block'
      const zone = document.getElementById('ai-error')
      zone.style.color = 'var(--red)'
      zone.textContent = `Le serveur d'analyse a répondu ${checkRes.status}` +
        (dit ? ' : ' + String(dit).slice(0, 300) : ' sans détail.')
      afficherDetailEchec(aiProcedureId, dit || `HTTP ${checkRes.status}`)
      return
    }
    aiEchecsSuite = 0

    const data = await checkRes.json()

    if (data.status === 'processing') {
      /* Le serveur nous dit où il en est : dès qu'il répond « en traitement »,
         c'est que la vidéo est arrivée et qu'Azure l'écoute. Le pourcentage vient
         d'Azure quand il en fournit un ; sinon l'anneau tourne. */
      signalerEtapeIA('transcription', data.progress)
      // On interroge souvent au début, puis on espace : la première minute
      // était la plus pénalisante, on pouvait attendre 6 s pour rien après la
      // fin réelle de l'analyse.
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
  el('dv-titre-page').textContent = dvEdition
    ? 'Modifier la proc\u00e9dure' : 'Vous d\u00e9coupez, l\u2019IA r\u00e9dige'
  el('dv-sous').textContent = dvEdition
    ? "Vos changements ne partent qu'\u00e0 l'enregistrement"
    : 'Marquez les coupures, l\u2019IA r\u00e9dige ensuite'
  el('dv-entete').style.display = dvEdition ? 'block' : 'none'

  if (!dvEdition) return

  const [{ data: proc }, { data: etapes }] = await Promise.all([
    supabase.from('procedures').select('*').eq('id', procId).single(),
    supabase.from('etapes').select('*').eq('procedure_id', procId).order('ordre'),
  ])
  if (!proc) { el('create-error-video').textContent = 'Proc\u00e9dure introuvable.'; return }


  el('dv-categorie').value = proc.categorie || ''
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
const PALETTE_ETAPES = ['#30D158', '#F5A623', '#FF9F0A', '#E8A33D', '#FF375F', '#64D2FF', '#FFD60A', '#5E5CE6']
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
    <circle cx="15" cy="15" r="12.6" fill="#FFB340"/>
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
  renderManualSteps()
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
    console.warn('Proc\u00e9do \u00b7 image de couverture non envoy\u00e9e :', ex?.message || ex)
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

  if (toutDecoupe) {
    b.classList.remove('coupe')
    b.classList.add('refaire')
    ic.innerHTML = '<path d="M12 4V1L8 5l4 4V6a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/>'
    lib.textContent = 'Recommencer le d\u00e9coupage'
    aide.textContent = "Toute la vid\u00e9o est d\u00e9coup\u00e9e. Corrigez les textes ci-dessous, " +
      "ou reprenez le d\u00e9coupage depuis le d\u00e9but."
    return
  }
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
  if (document.getElementById('dv-bouton').classList.contains('refaire')) {
    const ok = await confirmDialog({
      titre: 'Recommencer le d\u00e9coupage ?',
      message: `Vos ${videoSteps.length} \u00e9tapes seront effac\u00e9es, textes compris.`,
      confirmer: 'Recommencer',
      annuler: 'Garder',
      danger: true,
    })
    if (!ok) return
    videoSteps = []
    dvDebutEnCours = 0
    dvSelection = null
    v.currentTime = 0
    v.pause()
    dvMajGeste(); renderVideoSteps(); dvMajFrise()
    if (navigator.vibrate) navigator.vibrate(10)
    return
  }

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

/* Le titre et la catégorie sont saisis sur l'écran des étapes ; l'écran précédent
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
        .update({ titre, categorie, categorie_icone: categorieIcone })
        .eq('id', enCours).select().single()
    : await supabase.from('procedures')
        .insert({ entreprise_id: currentMembre.entreprise_id, titre, categorie, categorie_icone: categorieIcone, video_url: videoUrl, created_by: currentMembre.id })
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
    if (eCouv) console.warn('Proc\u00e9do \u00b7 image non enregistr\u00e9e :', eCouv.message)
  }

  const etapesToInsert = allSteps.map((s, i) => ({
    procedure_id: newProc.id, ordre: i + 1, texte: s.texte,
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

async function openAnalyse(procId) {
  const monTour = ++ouvertureCourante
  const perime = () => monTour !== ouvertureCourante
  showGestionScreen('p-analyse')

  /* La coche verte ne sert qu'à annoncer « ton analyse est prête ». Une fois la
     procédure ouverte, le message a été reçu : on efface le statut, en base
     pour que ce soit vrai sur tous les appareils. */
  const enAttente = allGestionProcedures.find(p => p.id === procId && p.statut === 'pret')
  if (enAttente) {
    enAttente.statut = null
    supabase.from('procedures').update({ statut: null }).eq('id', procId).then(() => {}, () => {})
    renderCategoryGrid()
    if (document.getElementById('p-category')?.classList.contains('active')) renderCategoryProceduresList()
  }

  if (preloadEtapes) await preloadEtapes

  // On utilise en priorité les données déjà préchargées (instantané) ;
  // si jamais elles manquent (cas rare), on retombe sur une requête fraîche.
  let proc = allGestionProcedures.find(p => p.id === procId)
  if (proc?.image_url) reinitialiserCouverture(proc.image_url)
  let etapes = cachedEtapesByProc[procId]
  let employes = cachedEmployes
  let validations = cachedValidations.filter(v => v.procedure_id === procId)

  if (!proc) {
    document.getElementById('analyse-titre').textContent = '...'
    document.getElementById('analyse-subhead').textContent = 'Chargement...'
    const res = await supabase.from('procedures').select('*').eq('id', procId).single()
    proc = res.data
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
    /* On revient d'abord à la liste, puis on replie la carte : la personne voit
       la procédure qu'elle vient de supprimer s'en aller. La ligne est déjà
       effacée en base, l'animation ne fait que raconter ce qui s'est passé. */
    showGestionScreen('p-list')
    const carte = carteDeProcedure(procId)
    if (carte) await replierCarte(carte)

    /* La catégorie se vide-t-elle ? Si cette procédure était la dernière, sa
       catégorie va disparaître du prochain dessin. On la fait partir DEVANT les
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
  document.getElementById('analyse-subhead').textContent = `${proc.categorie || 'Sans catégorie'} · créée le ${new Date(proc.created_at).toLocaleDateString('fr-FR')}`

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
  /* Le QR porte le code de l'entreprise en plus de la procédure : une personne
     qui scanne sans compte peut ainsi s'inscrire sans avoir à le demander.
     Sans ce code, il faudrait lire la table des procédures sans être connecté,
     ce que les règles d'accès de la base interdisent — à raison. */
  const codeEnt = cachedEntreprise?.code_acces || ''
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

/* Tracé du logo Procédo en unités 85 x 100. Le logo n'est qu'une suite de
   segments droits : on le dessine point par point plutôt que via Path2D,
   dont le constructeur à partir d'une chaîne SVG n'est pas garanti partout. */
const LOGO_POINTS = [65.78,3.86,60.26,1.43,53.42,0.00,1.77,0.00,0.00,1.32,0.00,6.62,2.10,13.69,6.18,19.87,11.15,23.95,20.31,26.82,52.10,27.04,56.51,29.80,58.50,34.77,57.17,40.51,53.20,43.71,23.18,44.70,15.56,47.90,9.38,53.42,5.63,59.93,3.86,67.44,3.75,96.91,4.97,99.34,8.28,100.00,15.12,99.34,19.76,97.13,23.62,93.60,27.59,85.10,28.04,70.97,54.19,70.97,60.71,69.76,70.86,64.46,78.81,55.74,82.34,48.57,84.11,41.50,84.44,34.22,83.22,26.27,80.57,19.21,77.37,14.02,71.96,8.17]

function dessinerLogo(ctx, x, y, hauteur, couleur) {
  const e = hauteur / 100          // le tracé fait 100 unités de haut
  ctx.save()
  ctx.fillStyle = couleur
  ctx.beginPath()
  for (let i = 0; i < LOGO_POINTS.length; i += 2) {
    const px = x + LOGO_POINTS[i] * e
    const py = y + LOGO_POINTS[i + 1] * e
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/* Dessine la fiche à imprimer : plaque blanche, QR, titre de la procédure,
   consigne de scan et signature Procédo avec son logo. Rendue en haute définition pour
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

  // Logo + nom, centrés ensemble. Le logo est le même tracé que partout
  // ailleurs dans l'app, dessiné directement dans le canvas — il manquait
  // à l'export, seul le mot « Procédo » était écrit.
  g.fillStyle = 'rgba(20,21,24,0.4)'
  g.font = '700 22px Inter, -apple-system, system-ui, sans-serif'
  const nom = 'Procédo'
  const largeurNom = g.measureText(nom).width
  const hLogo = 22
  const lLogo = hLogo * 0.85          // le tracé fait 85 x 100 unités
  const espace = 8
  const totalL = lLogo + espace + largeurNom
  const xDepart = (L - totalL) / 2
  const yBase = y + 30

  dessinerLogo(g, xDepart, yBase - hLogo + 2, hLogo, 'rgba(20,21,24,0.4)')

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

           Les listes de catégories travaillent sur des copies filtrées : changer
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
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
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
         ouverte, la recherche, la liste d'une catégorie. L'état avait changé en
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
function etatProcedureHtml(proc) {
  const alerte = (couleur, titre) => `<div class="etat-proc souci" title="${titre}">
      <svg viewBox="0 0 24 24" fill="none" stroke="${couleur}" stroke-width="2.6" stroke-linecap="round">
        <circle cx="12" cy="12" r="9.5"/><line x1="12" y1="7.5" x2="12" y2="13"/><line x1="12" y1="16.5" x2="12" y2="16.6"/>
      </svg></div>`

  if (proc?.statut === 'echec') return alerte('#FF453A', "L'analyse a échoué — touchez pour relancer")
  if (analyseBloquee(proc)) return alerte('#FF9F0A', "L'analyse semble bloquée — touchez pour relancer")

  if (proc?.statut === 'traitement' || proc?.statut === 'redaction') {
    /* La marque de l'IA, pas une roue de chargement quelconque : c'est bien
       elle qui travaille, et le même signe la désigne partout dans l'app. */
    return `<div class="etat-proc" title="Analyse en cours">
      <span class="ia-fig s"><span class="lum"></span></span>
    </div>`
  }
  if (proc?.statut === 'pret') {
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
async function abandonnerAnalyse(proc) {
  const ok = await confirmDialog({
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
    await confirmDialog({
      titre: 'Aucune vidéo',
      message: raison + "Cette procédure n'a pas de vidéo associée : l'analyse ne peut pas être relancée. Modifiez-la à la main ou supprimez-la.",
      confirmer: 'Compris', annuler: 'Fermer', danger: false,
    })
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
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
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
  // La grille des catégories n'a pas de sens avec une seule procédure.
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
  if (!/^\d{5}$/.test(code)) { err.textContent = 'Le code comporte 5 chiffres.'; return }

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
    ? supabase.from('procedures').select('*').eq('id', currentMembre.procedure_visitee)
    : supabase.from('procedures').select('*').eq('entreprise_id', currentMembre.entreprise_id).order('titre')

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
  const bonjour = h < 6 ? 'Bonne nuit' : h < 18 ? 'Bonjour' : 'Bonsoir'
  const prenom = (currentMembre?.nom || '').trim().split(' ')[0]
  const salut = document.getElementById('e-salut')
  if (salut) salut.textContent = `${bonjour}${prenom ? ' ' + prenom : ''} 👋`

  const total = allEquipeProcedures.length
  const lues = allEquipeProcedures.filter(p => equipeLues.has(p.id)).length
  const reste = total - lues
  const pct = total ? Math.round((lues / total) * 100) : 0

  const mot = document.getElementById('e-mot')
  if (mot) {
    mot.innerHTML = !total
      ? "Aucune procédure pour l'instant. Votre responsable vous prévient dès qu'il en publie une."
      : reste === 0
        ? "Vous avez tout lu. Rien ne vous attend."
        : `Il vous reste <b>${reste} procédure${reste > 1 ? 's' : ''}</b> à lire.`
  }

  const couleur = pct >= 70 ? 'var(--green)' : pct >= 30 ? 'var(--orange)' : 'var(--red)'
}

/* Grille des catégories, exactement celle de l'espace gestion : anneau de
   progression, nom, nombre de procédures et aperçu des titres récents. */
function renderEquipeCategories() {
  const grille = document.getElementById('e-cat-grid')
  if (!grille) return
  grille.innerHTML = ''

  if (!allEquipeProcedures.length) {
    grille.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <h3>Aucune procédure</h3><p>Votre responsable vous prévient dès qu'il en publie une.</p></div>`
    return
  }

  const parCat = {}
  allEquipeProcedures.forEach(p => {
    const nom = p.categorie || 'Sans catégorie'
    if (!parCat[nom]) parCat[nom] = []
    parCat[nom].push(p)
  })

  /* Le même tri que côté gestion, plus une entrée propre à l'employé :
     « À lire d'abord » remonte les catégories où il lui reste le plus à lire. */
  const dateCat = (n) => Math.max(...parCat[n].map(p => new Date(p.created_at || 0).getTime()))
  const resteCat = (n) => parCat[n].filter(p => !equipeLues.has(p.id)).length

  Object.keys(parCat).sort((a, b) => {
    if (equipeCatSort === 'new') return dateCat(b) - dateCat(a)
    if (equipeCatSort === 'old') return dateCat(a) - dateCat(b)
    if (equipeCatSort === 'reste') {
      const d = resteCat(b) - resteCat(a)
      if (d) return d
    }
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
    cell.innerHTML = `
      <div class="cat-top">
        <!-- Même carte que l'espace gestion : pas d'anneau coloré. Vert, orange ou
             rouge selon le taux de lecture, il faisait d'une catégorie un bulletin
             de notes — et le rouge disait « problème » là où il n'y avait qu'une
             procédure récente. -->
          <div class="cat-ring-wrap">
            <span class="cat-icon"><svg viewBox="0 0 24 24" fill="none"><path d="M3 7.4a2 2 0 0 1 2-2h4.2l2 2.4h7.8a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" stroke="rgba(255,255,255,0.78)" stroke-width="1.7" stroke-linejoin="round"/><line x1="3" y1="10.6" x2="21" y2="10.6" stroke="rgba(255,255,255,0.34)" stroke-width="1.5"/></svg></span>
        </div>
        <div class="cat-badge">${procs.length}</div>
      </div>
      <div class="cat-name"><span class="txt">${escapeHtml(nom)}</span></div>
            <div class="cat-recent">${[...procs]
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 3).map(p =>
        /* Le titre dans un `.txt` comme côté gestion : sans lui, la règle de
                 coupure ne s'applique pas et un nom long passe à la ligne. */
              `<div class="cat-recent-item"><span class="txt">${escapeHtml(p.titre)}</span></div>`).join('')}</div>`
    grille.appendChild(cell)
  })
}

/* Écran d'une catégorie : ses procédures, avec sa propre recherche. */
function openEquipeCategorie(nom) {
  equipeCatCourante = nom
  equipeCatQuery = ''
  const champ = document.getElementById('e-cat-recherche')
  if (champ) champ.value = ''
  document.getElementById('e-cat-titre').textContent = nom
  document.querySelectorAll('#equipe-app .screen').forEach(s => s.classList.remove('active'))
  activerAvecNaissance(document.getElementById('e-category'))
  remonterEnHaut()
  renderEquipeCatListe()
}

function renderEquipeCatListe() {
  const listEl = document.getElementById('equipe-procedures-list')
  if (!listEl) return
  const dansCat = allEquipeProcedures.filter(p => (p.categorie || 'Sans catégorie') === equipeCatCourante)
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
  /* Le même tri que les catégories, avec la même entrée propre à l'employé :
     « À lire d'abord » remonte ce qu'il n'a pas encore ouvert. */
  const triees = [...vues].sort((a, b) => {
    if (equipeProcSort === 'new') return new Date(b.created_at || 0) - new Date(a.created_at || 0)
    if (equipeProcSort === 'old') return new Date(a.created_at || 0) - new Date(b.created_at || 0)
    if (equipeProcSort === 'reste') {
      const d = (equipeLues.has(a.id) ? 1 : 0) - (equipeLues.has(b.id) ? 1 : 0)
      if (d) return d
    }
    return (a.titre || '').localeCompare(b.titre || '', 'fr')
  })

  triees.forEach(proc => listEl.appendChild(ficheEquipe(proc)))
}

/* Une fiche de procédure, réutilisée par la catégorie et par la recherche.
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
  div.innerHTML = `
    <div class="cat-top">
      <!-- L'anneau coloré est retiré : la coche verte dit déjà que c'est lu, et
             l'anneau gris autour d'une procédure non lue ressemblait à une jauge
             à zéro plutôt qu'à « pas encore ouverte ». -->
        <div class="cat-ring-wrap">
          <div class="cat-icon"><svg viewBox="0 0 24 24" fill="none"><path d="M13.6 3H7.4A2 2 0 0 0 5.4 5v14a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8Z" stroke="rgba(255,255,255,0.78)" stroke-width="1.7" stroke-linejoin="round"/><path d="M13.6 3v5h5" stroke="rgba(255,255,255,0.78)" stroke-width="1.7" stroke-linejoin="round"/><line x1="8.6" y1="12.6" x2="15.4" y2="12.6" stroke="rgba(255,255,255,0.34)" stroke-width="1.6" stroke-linecap="round"/><line x1="8.6" y1="16.4" x2="13" y2="16.4" stroke="rgba(255,255,255,0.34)" stroke-width="1.6" stroke-linecap="round"/></svg></div>
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
   catégories confondues, et remplace la grille par ses résultats le temps de
   la saisie. */

// Recherche à l'intérieur d'une catégorie
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

   Il retrouve où il en était après une interruption — en cuisine, on est
   interrompu tout le temps, et relire trois étapes pour savoir laquelle on
   venait de finir est exactement ce qui décourage d'ouvrir l'app.

   Et le temps mesuré devient un temps d'EXÉCUTION, pas de lecture. « Fermeture
   de caisse : 22 minutes en moyenne » apprend quelque chose de vrai sur
   l'établissement ; « 40 secondes de lecture » n'apprend rien.

   Les cases vivent dans `validations.etapes_faites`, une colonne JSON. Si elle
   n'existe pas encore en base, tout continue de fonctionner : les cases sont
   simplement oubliées à la fermeture.
   ═══════════════════════════════════════════════════════════════════════════ */

let etapesFaites = new Set()
let etapesTotal = 0
let colonneCochesAbsente = false

function basculerEtape(etapeId) {
  if (etapesFaites.has(etapeId)) etapesFaites.delete(etapeId)
  else {
    etapesFaites.add(etapeId)
    if (navigator.vibrate) navigator.vibrate(8)
  }
  peindreCoches()
  enregistrerCoches()
}

function peindreCoches() {
  document.querySelectorAll('#detail-steps .detail-step').forEach((div, i) => {
    const b = div.querySelector('.et-coche')
    if (!b) return
    const faite = etapesFaites.has(b.dataset.etape)
    b.classList.toggle('f', faite)
    b.innerHTML = faite ? cocheFaiteDess() : numeroEtapeDess(i + 1)
    div.classList.toggle('faite', faite)
  })
  majBandeauCoches()
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
    console.warn('Proc\u00e9do \u00b7 colonne etapes_faites absente : les coches ne seront pas gard\u00e9es.')
  }
}

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
  document.getElementById('detail-subhead').textContent = proc.categorie || 'Sans catégorie'

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
  /* On reprend les cases déjà cochées lors d'une visite précédente. */
  const dejaLu = (mesLectures || []).find(v => v.procedure_id === procId)
  etapesFaites = new Set(Array.isArray(dejaLu?.etapes_faites) ? dejaLu.etapes_faites : [])
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
              aria-label="\u00c9tape ${i + 1}">${faite ? cocheFaiteDess() : numeroEtapeDess(i + 1)}</button>
      <div class="et-co">
        <p>${escapeHtml(etape.texte)}</p>
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

  const n = (mesAdhesions || []).length
  if (el('es-nb-ent')) {
    el('es-nb-ent').textContent = n > 1 ? `${n} entreprises` : (n === 1 ? '1 entreprise' : '\u2014')
  }
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

/* Un pictogramme par avantage phare, dans la langue des icônes de création. */
const PICTOS = {
  /* Pas un dessin : les deux lettres, avec le dégradé de l'anneau. C'est la
     même marque que sur les boutons — l'œil la reconnaît d'un écran à l'autre.
     Un œil stylisé aurait dit « regarder » ; « AI » dit ce que c'est. */
  marqueAI: `<span class="ia-mot" style="font-size:14px;">AI</span>`,
  video: `<svg viewBox="0 0 24 24" fill="none"><rect x="2.6" y="5.4" width="18.8" height="13.2" rx="3" stroke="${AV_O}" stroke-width="1.7"/><path d="M10 9.6 15.4 12 10 14.4Z" fill="${AV_O}"/></svg>`,
  monde: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.8" stroke="${AV_O}" stroke-width="1.7"/><ellipse cx="12" cy="12" rx="3.7" ry="8.8" stroke="${LG_O}" stroke-width="1.6"/><line x1="3.5" y1="9.2" x2="20.5" y2="9.2" stroke="${LG_O}" stroke-width="1.6" stroke-linecap="round"/><line x1="3.5" y1="14.8" x2="20.5" y2="14.8" stroke="${LG_O}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  infini: `<svg viewBox="0 0 24 24" fill="none"><path d="M6.6 8.6a3.4 3.4 0 1 0 0 6.8c2.5 0 3.3-2.4 5.4-3.4s2.9-3.4 5.4-3.4a3.4 3.4 0 1 1 0 6.8c-2.5 0-3.3-2.4-5.4-3.4S9.1 8.6 6.6 8.6Z" stroke="${AV_O}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  suivi: `<svg viewBox="0 0 24 24" fill="none"><line x1="5.4" y1="19.4" x2="5.4" y2="12.6" stroke="${LG_O}" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="19.4" x2="12" y2="7.6" stroke="${AV_O}" stroke-width="2" stroke-linecap="round"/><line x1="18.6" y1="19.4" x2="18.6" y2="10.4" stroke="${LG_O}" stroke-width="2" stroke-linecap="round"/></svg>`,
  sites: `<svg viewBox="0 0 24 24" fill="none"><rect x="2.6" y="10.4" width="6.4" height="10.2" rx="2" stroke="${LG_O}" stroke-width="1.6"/><rect x="15" y="10.4" width="6.4" height="10.2" rx="2" stroke="${LG_O}" stroke-width="1.6"/><rect x="8.4" y="4.2" width="7.2" height="16.4" rx="2.2" stroke="${AV_O}" stroke-width="1.7"/></svg>`,
  main: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3.4v9.2M8.4 7l3.6-3.6L15.6 7" stroke="${AV_O}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.6 14.4v3.4a2.6 2.6 0 0 0 2.6 2.6h9.6a2.6 2.6 0 0 0 2.6-2.6v-3.4" stroke="${LG_O}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
}

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
let rythmeChoisi = 'annuel'

const AVANTAGES = [
  /* L'argument de tête porte la marque AI plutôt qu'un dessin : c'est le nom de
     ce qu'on vend, et il se lit même de loin. */
  /* « L'IA écoute et regarde » décrivait la machine ; ce titre-ci dit ce qu'on
     y gagne. Deux minutes est un chiffre vérifiable, pas une promesse creuse —
     c'est à peu près ce que dure une démonstration de geste. */
  /* Sobre : l'IA est un outil de création, pas un numéro de magie. Annoncer
     « deux minutes » promettait un temps qu'on ne maîtrise pas. */
  { p: 'marqueAI', vedette: true, t: 'L\'IA \u00e9crit vos proc\u00e9dures',
    s: "Elle entend ce que vous expliquez et lit ce qui est visible \u2014 objets, gestes, " +
       "texte \u00e0 l'\u00e9cran. Elle en tire des \u00e9tapes num\u00e9rot\u00e9es que vous relisez." },
  { p: 'infini', t: 'Proc\u00e9dures illimit\u00e9es',
    s: "\u00c9crivez-en dix ou deux cents, le prix ne bouge pas." },
  /* QUATRE, et non trois. On les nomme : « trois façons de créer » ne dit ni
     lesquelles ni pourquoi on en aurait besoin. */
  { p: 'main', t: 'Quatre fa\u00e7ons de cr\u00e9er une proc\u00e9dure',
    s: "\u00c9crivez \u00e0 la main, filmez et d\u00e9coupez vous-m\u00eame, laissez l'IA d\u00e9couper, " +
       "ou partez d'un document existant." },
  { p: 'monde', t: 'Chacun lit dans sa langue',
    s: "Vos proc\u00e9dures se traduisent \u00e0 la demande, sans que vous les r\u00e9\u00e9criviez." },
  { p: 'suivi', t: 'Vous savez qui a lu quoi',
    s: "Par personne, par cat\u00e9gorie, avec le temps pass\u00e9 sur chaque proc\u00e9dure." },
  { p: 'sites', t: 'Plusieurs \u00e9tablissements',
    s: "Un compte, plusieurs enseignes, chacune avec son logo et son \u00e9quipe." },
]

const AUSSI = '\u00c9tapes \u00e9crites et photos, QR code \u00e0 afficher au poste, m\u00e9dailles ' +
  'd\'assiduit\u00e9, relance des retardataires, vue consolid\u00e9e de vos sites.'

/* Les paliers suivent le NOMBRE DE MEMBRES, et c'est tout ce qui les sépare. */
const OFFRES = [
  /* Le prix mensuel est celui qu'on affiche ; l'annuel se règle en une fois et
     revient à vingt pour cent de moins.

     Le prix par membre BAISSE à chaque palier — 9,80 €, 6,60 €, 5,97 €, 4,99 €.
     C'est ce qui donne envie de monter : le client y gagne toujours, et nos
     coûts ne suivent pas la même pente puisque le nombre d'analyses double
     quand les membres triplent. */
  { cle: 'essentiel',  nom: 'Essentiel',  max: 5,   analyses: 30,  prix: 49,  an: 468,  stripe: true },
  { cle: 'equipe',     nom: '\u00c9quipe',     max: 15,  analyses: 60,  prix: 99,  an: 948,  stripe: true },
  { cle: 'pro',        nom: 'Pro',        max: 40,  analyses: 120, prix: 239, an: 2268, stripe: true },
  { cle: 'reseau',     nom: 'R\u00e9seau',     max: 100, analyses: 250, prix: 499, an: 4788, stripe: true },
  { cle: 'entreprise', nom: 'Entreprise', max: Infinity, prix: null,
    devis: "Au-del\u00e0 de cent personnes, on en discute : accompagnement \u00e0 la mise " +
           "en place, interlocuteur d\u00e9di\u00e9, engagement de disponibilit\u00e9 \u00e9crit." },
]


function nombreDeMembres() {
  return Math.max(1, (cachedMembres || []).length)
}

function offrePourTaille(n) {
  return OFFRES.find(o => n <= o.max) || OFFRES[OFFRES.length - 1]
}

function planActuel() {
  /* `abonnement_palier` d'abord : c'est la colonne que le webhook Stripe
     renseigne au paiement. `plan` est l'ancien nom, gardé en second pour les
     entreprises créées avant. */
  return (cachedEntreprise?.abonnement_palier || cachedEntreprise?.plan || '').toLowerCase()
}

/* Le prix ramené au membre : c'est le seul chiffre qu'un restaurateur peut
   comparer à quelque chose qu'il connaît — un café, une heure de main-d'œuvre. */
function prixParMembre(o, n) {
  if (o.prix === null || !n) return null
  return (o.prix / n).toFixed(2).replace('.', ',')
}

function carteOffre(o, opts = {}) {
  const n = opts.membres || 0
  const p = o.prix === null ? 'Sur devis' : o.prix + '\u20ac'
  const u = o.prix === null ? '' : 'par mois'
  const pm = opts.detaille ? prixParMembre(o, n) : null

  return `<div class="offre-carte${opts.classe || ''}">
    ${opts.ruban ? `<span class="offre-ruban">${opts.ruban}</span>` : ''}
    <div class="offre-tete">
      <span class="offre-txt">
        <span class="offre-nom">${o.nom}</span>
        <span class="offre-taille">${o.max === Infinity ? 'Membres illimit\u00e9s' : `Jusqu'\u00e0 ${o.max} membres`}</span>
      </span>
      <span class="offre-prix"><span class="v">${p}</span><span class="u">${u}</span></span>
    </div>
    ${pm ? `<div class="offre-parmembre">Pour vos ${n} membres, cela fait <b>${pm} \u20ac personne / mois</b>.</div>` : ''}
    ${opts.detaille ? `<div class="offre-etiq">Tout est compris</div>
    <div class="offre-phares">
      ${AVANTAGES.map(f => `<div class="offre-phare${f.vedette ? ' vedette' : ''}">
        <span class="p">${PICTOS[f.p]}</span>
        <!-- Les explications ont été retirées. Six titres se lisent d'un regard ;
             six titres suivis chacun d'une phrase deviennent un paragraphe qu'on
             saute. Le titre dit déjà ce qu'on achète. -->
        <span><span class="t">${f.t}</span></span>
      </div>`).join('')}
    </div>
    <div class="offre-aussi">${AUSSI}</div>`
    : `<div class="offre-aussi">${o.devis || 'Les m\u00eames fonctionnalit\u00e9s, sans exception.'}</div>`}
    ${opts.cta && o.prix !== null && !opts.enCours ? `
    <div class="offre-rythme">
      <button type="button" class="rlg${rythmeChoisi === 'mensuel' ? ' on' : ''}" data-rythme="mensuel">
        <span class="rd"><i></i></span>
        <span class="tx"><b>${o.prix} \u20ac / mois</b><span>Sans engagement</span></span>
      </button>
      <button type="button" class="rlg${rythmeChoisi === 'annuel' ? ' on' : ''}" data-rythme="annuel">
        <span class="rd"><i></i></span>
        <span class="tx"><b>${Math.round(o.prix * 0.8)} \u20ac / mois</b><span>${o.an || Math.round(o.prix * 0.8 * 12)} \u20ac par an</span></span>
      </button>
    </div>` : ''}
    ${opts.cta ? `<button type="button" class="offre-cta${opts.enCours ? ' encours' : ''}"
      ${opts.enCours ? 'disabled' : ''} data-offre="${o.cle}">${
      /* L'offre déjà payée ne propose pas de la repayer : le bouton dit ce
         qu'elle est, et ne fait rien. */
      opts.enCours ? opts.cta
      : o.prix === null ? opts.cta
      /* Le bouton annonce EXACTEMENT ce qui sera pr\u00e9lev\u00e9. \u00ab Activer \u00bb tout court
         laisse d\u00e9couvrir le montant sur la page de paiement \u2014 c'est l\u00e0 qu'on
         renonce. */
      : rythmeChoisi === 'annuel'
        ? `Activer \u00b7 ${o.an || Math.round(o.prix * 0.8 * 12)} \u20ac par an`
        : `Activer \u00b7 ${o.prix} \u20ac par mois`
    }</button>` : ''}
    ${opts.gerer ? `
    <!-- Résilier doit être aussi simple que souscrire : le lien est ICI, sous
         l'offre, pas caché dans un recoin des paramètres. -->
    <button type="button" class="offre-gerer" data-abo-gerer>G\u00e9rer ou r\u00e9silier mon abonnement</button>` : ''}
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

  const titre = document.getElementById('abo-titre')
  const sous = document.getElementById('abo-sous')
  const nomEnt = cachedEntreprise?.nom || 'votre \u00e9tablissement'
  if (titre) {
    titre.innerHTML = n > 1
      ? `Vous \u00eates <b>${n} membres</b><br>chez ${escapeHtml(nomEnt)}`
      : `Vous d\u00e9marrez seul<br>chez ${escapeHtml(nomEnt)}`
  }
  if (sous) {
    sous.innerHTML = payee
      ? `Vous \u00eates abonn\u00e9 \u00e0 l'offre <b>${mienne.nom}</b>.`
      : `L'offre <b>${mienne.nom}</b> est faite pour une \u00e9quipe de cette taille.`
  }

  const estActuelle = mienne.cle === actuel
  document.getElementById('abo-vedette').innerHTML = carteOffre(mienne, {
    classe: ' vedette' + (estActuelle ? ' actuelle' : ''),
    ruban: estActuelle ? 'En cours' : 'Recommandée',
    enCours: estActuelle,
    gerer: estActuelle,
    cta: estActuelle ? 'Votre abonnement actuel'
      : (mienne.prix === null ? 'Nous \u00e9crire' : 'Commencer avec ' + mienne.nom),
    annuel: !estActuelle,
    membres: n,
    detaille: true,
  })

  document.getElementById('abo-liste').innerHTML = OFFRES
    .filter(o => o.cle !== mienne.cle)
    .map(o => carteOffre(o, {
      classe: o.cle === actuel ? ' actuelle' : '',
      ruban: o.cle === actuel ? 'En cours' : '',
      cta: o.cle === actuel ? 'Votre abonnement actuel'
        : (o.prix === null ? 'Nous \u00e9crire' : 'Choisir ' + o.nom),
      /* Développées elles aussi : quelqu'un qui déplie les autres offres veut
         comparer, et comparer des titres seuls ne dit rien. */
      membres: n,
    })).join('')

  const rappel = document.getElementById('abo-actuel')
  if (rappel) {
    const o = OFFRES.find(x => x.cle === actuel)
    rappel.textContent = o
      ? (o.prix === null ? `Offre ${o.nom}` : `Offre ${o.nom} \u00b7 ${o.prix} \u20ac par mois`)
      : `${mienne.nom} conseill\u00e9e`
  }
}

document.getElementById('ouvrir-abonnement')?.addEventListener('click', () => {
  document.getElementById('abo-liste')?.classList.remove('ouvert')
  const b = document.getElementById('abo-autres')
  if (b) { b.style.display = 'block'; b.textContent = 'Voir les autres offres' }
  renderAbonnements()
  showGestionScreen('p-abonnement')
})

document.getElementById('abo-autres')?.addEventListener('click', (e) => {
  document.getElementById('abo-liste')?.classList.add('ouvert')
  e.currentTarget.style.display = 'none'
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
    g.disabled = true
    const av = g.textContent
    g.textContent = 'Ouverture\u2026'
    try {
      const rep = await fetch(`${SUPABASE_URL}/functions/v1/stripe-portail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
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
    if (ok) window.location.href = 'mailto:Procedo.off@gmail.com?subject=' +
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
     contrat, pas le nôtre : sans ce passage, les conditions de Procédo ne
     seraient jamais acceptées par quelqu'un qui paie. */
  const accepte = await confirmDialog({
    titre: 'Avant de continuer',
    message: 'En souscrivant, vous acceptez les conditions d\u2019utilisation de Proc\u00e9do.\n\n' +
      'Elles pr\u00e9cisent notamment que les proc\u00e9dures r\u00e9dig\u00e9es par l\u2019IA doivent \u00eatre ' +
      'relues par vos soins avant d\u2019\u00eatre suivies.',
    confirmer: 'J\u2019accepte et je continue',
    annuler: 'Lire les conditions',
    danger: false,
  })
  if (!accepte) { window.open('cgu.html', '_blank', 'noopener'); return }

  b.disabled = true
  const libelle = b.textContent
  b.textContent = 'Ouverture du paiement\u2026'

  try {
    const rep = await fetch(`${SUPABASE_URL}/functions/v1/stripe-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
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
  const dedans = e.logo_url
    ? `<img src="${escapeHtml(e.logo_url)}" alt="">`
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
  const tiroir = elementTiroir()
  if (!tiroir || !currentMembre) return

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  /* La colonne `logo_url` peut ne pas exister encore : dans ce cas la requête
     échoue EN ENTIER et on n'obtient aucun établissement, donc aucun tiroir.
     C'est ce qui se passe tant que le SQL n'a pas été exécuté. On redemande donc
     sans elle : le tiroir marche alors avec les initiales, ce qui est déjà
     l'essentiel. */
  const gerant = currentMembre.role === 'gestion'

  let requete = supabase
    .from('membres').select('id, role, entreprise_id, entreprises(id, nom, logo_url)')
    .eq('user_id', user.id)
  if (gerant) requete = requete.eq('role', 'gestion')
  let { data, error } = await requete

  if (error || !data) {
    let repli = supabase
      .from('membres').select('id, role, entreprise_id, entreprises(id, nom)')
      .eq('user_id', user.id)
    if (gerant) repli = repli.eq('role', 'gestion')
    repli = await repli
    data = repli.data || []
    if (repli.error) {
      console.warn('Proc\u00e9do \u00b7 \u00e9tablissements :', repli.error.message)
    }
  }

  mesEtablissements = (data || [])
    .filter(a => a.entreprises)
    .map(a => ({
      id: a.entreprises.id, nom: a.entreprises.nom,
      logo_url: a.entreprises.logo_url || null,   // absent = initiales
      membre_id: a.id,
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
      console.warn('Proc\u00e9do \u00b7 entreprise courante :', eEnt.message)
    }
  }

  peindreTiroir()
  peindreListeEtab()
}

/* La même liste dans les réglages, pour changer un logo plus tard. Chaque ligne
   ouvre la fenêtre déjà remplie : c'est le même écran que la création. */
function peindreListeEtab() {
  const el = document.getElementById('etab-liste')
  if (!el) return

  if (!multiSitesAutorise() || !mesEtablissements.length) {
    el.innerHTML = ''
    return
  }

  el.innerHTML = mesEtablissements.map(e => {
    const actif = e.id === currentMembre?.entreprise_id
    const rond = rondEtabHtml(e, false, '')
      .replace('<button type="button"', '<span').replace('</button>', '</span>')
    return `
    <button type="button" class="etab-ligne" data-etab-edit="${e.id}">
      ${rond}
      <span class="tx">
        <span class="nm">${escapeHtml(e.nom)}${actif ? '<span class="ici">actif</span>' : ''}</span>
        <span class="st">${e.logo_url
          ? 'Logo d\u00e9pos\u00e9 \u00b7 <b>le remplacer</b>'
          : `Initiales <b>${escapeHtml(initialesEtab(e.nom))}</b> \u00b7 <b>ajouter un logo</b>`}</span>
      </span>
      <span class="fl">\u203a</span>
    </button>`
  }).join('') + `
    <button type="button" class="etab-ligne ajout" data-etab-plus>
      <span class="rond-ent plus"><span class="ini">+</span></span>
      <span class="tx"><span class="nm">Ajouter un \u00e9tablissement</span>
      <span class="st">Son nom et son logo</span></span>
    </button>`
}

document.getElementById('etab-liste')?.addEventListener('click', (e) => {
  const l = e.target.closest('[data-etab-edit]')
  if (l) { ouvrirFenetreEtab(l.dataset.etabEdit); return }
  if (e.target.closest('[data-etab-plus]')) ouvrirFenetreEtab(null)
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

/* Changer d'établissement, c'est changer de fiche membre : on relance l'app avec
   celle qui a été choisie, ce qui recharge procédures, équipe et droits. */
async function basculerVersEtablissement(entrepriseId) {
  const e = mesEtablissements.find(x => x.id === entrepriseId)
  if (!e || e.id === currentMembre?.entreprise_id) return

  const { data: membre } = await supabase
    .from('membres').select('*').eq('id', e.membre_id).maybeSingle()
  if (!membre) return

  currentMembre = membre
  cachedEntreprise = null

  /* On ne masque plus l'app avant de recharger. Le faire rejouait l'animation
     d'entrée : la barre du haut et celle du bas repartaient de zéro, alors qu'on
     change seulement de contenu. Ce sont les procédures qui changent, pas le
     cadre — le cadre doit rester immobile. */
  dejaEntre = new Set()
  basculeSansAnimation = true
  await enterApp(membre)
  basculeSansAnimation = false
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
  /* On ne supprime qu'un établissement existant, et jamais le dernier : quelqu'un
     sans entreprise se retrouverait devant une app vide. */
  const boutonSuppr = document.getElementById('etab-supprimer')
  if (boutonSuppr) {
    boutonSuppr.style.display = (etabEdite && mesEtablissements.length > 1) ? 'block' : 'none'
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

    // 1. La ligne d'abord : on a besoin de son identifiant pour nommer le logo.
    if (!entrepriseId) {
      const code = String(Math.floor(10000 + Math.random() * 90000))
      const { data, error } = await supabase.from('entreprises')
        .insert({ nom, code_acces: code }).select('id').single()
      if (error) {
        throw new Error(/row-level security|permission|policy/i.test(error.message)
          ? "La base refuse la cr\u00e9ation. Ex\u00e9cutez migration-etablissements.sql : " +
            "il manque la r\u00e8gle d'acc\u00e8s \u00ab insert \u00bb sur la table entreprises."
          : error.message)
      }
      if (!data?.id) throw new Error("L'entreprise n'a pas \u00e9t\u00e9 cr\u00e9\u00e9e : la base n'a rien renvoy\u00e9.")
      entrepriseId = data.id

      // Le créateur en devient gérant, sinon il ne pourrait pas y entrer.
      const { data: { user } } = await supabase.auth.getUser()
      const { error: eM } = await supabase.from('membres')
        .insert({ user_id: user.id, entreprise_id: entrepriseId, nom: currentMembre?.nom || '', role: 'gestion' })
      if (eM) {
        throw new Error(/row-level security|permission|policy/i.test(eM.message)
          ? "L'entreprise est cr\u00e9\u00e9e mais vous n'y \u00eates pas rattach\u00e9 : il manque la r\u00e8gle " +
            "d'acc\u00e8s \u00ab insert \u00bb sur la table membres. Ex\u00e9cutez migration-promotion.sql."
          : eM.message)
      }
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
  if (!/^\d{5}$/.test(code)) { err.textContent = 'Le code comporte 5 chiffres.'; return }

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

document.getElementById('es-quitter')?.addEventListener('click', async () => {
  const nom = cachedEntreprise?.nom || 'cette entreprise'
  const ok = await confirmDialog({
    titre: `Quitter ${nom} ?`,
    message: `Vous perdrez l'acc\u00e8s \u00e0 ses proc\u00e9dures et votre historique de lectures. ` +
      `Votre compte Proc\u00e9do reste actif : vous pourrez rejoindre une autre entreprise avec un code.`,
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
      "Entrez le code \u00e0 5 chiffres que son responsable vous a communiqu\u00e9. " +
      "Elle s'ajoutera \u00e0 celles que vous avez d\u00e9j\u00e0."
    el('orph-sortir').style.display = 'none'
    el('orph-annuler').style.display = 'block'
  } else {
    el('orph-titre').textContent = 'Aucune entreprise'
    el('orph-texte').textContent =
      "Votre compte n'est rattach\u00e9 \u00e0 aucune entreprise. Entrez le code \u00e0 5 chiffres " +
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

  if (code.length !== 5) { err.textContent = 'Le code compte 5 chiffres.'; return }
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
    .then(({ error }) => { if (error) console.warn('Proc\u00e9do \u00b7 promu_vu :', error.message) })
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
function estFondateur(m) {
  return m?.role === 'gestion' && !m?.promu_par
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
    sous.textContent = `${membresEquipe.length} utilisateur${membresEquipe.length > 1 ? 's' : ''} \u00b7 ` +
      `${gerants} en gestion \u00b7 ${membresEquipe.length - gerants} en \u00e9quipe`
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

  liste.innerHTML = tries.map(m => {
    const soi = m.id === currentMembre.id
    const promouvable = jePeuxChangerLeRang && !soi && m.role !== 'gestion'
    /* On ne rétrograde pas un fondateur : ce serait se retirer soi-même la
       dernière clé de l'entreprise. */
    const retrogradable = jePeuxChangerLeRang && !soi && m.role === 'gestion' && !estFondateur(m)

    /* Qui peut retirer qui.
       Le fondateur retire n'importe qui, des deux espaces. Un gestionnaire promu
       ne retire que des membres d'équipe : il ne doit pas pouvoir écarter ses
       pairs, encore moins celui qui l'a nommé. Un pouvoir reçu ne sert pas à
       défaire celui qui l'a donné. */
    const supprimable = !soi && (jePeuxChangerLeRang || m.role !== 'gestion')
    const date = m.created_at
      ? new Date(m.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
      : '\u2014'
    const rang = m.role === 'gestion'
      ? (estFondateur(m) ? 'Gestion \u00b7 fondateur' : 'Gestion')
      : '\u00c9quipe'

    return `
      <div class="pm-ligne" data-fiche="${escapeHtml(m.id)}" role="button" tabindex="0">
        <div class="pm-av${m.role === 'gestion' ? ' chef' : ''}">${escapeHtml(initialesMembre(m.nom))}</div>
        <div class="pm-info">
          <div class="pm-nom">${escapeHtml(m.nom || 'Sans nom')}${soi ? ' <span class="pm-soi">vous</span>' : ''}</div>
          <div class="pm-role">${rang} \u00b7 depuis le ${date}</div>
        </div>
        ${promouvable ? `<button type="button" class="pm-rang" data-promo="${m.id}"
          data-nom="${escapeHtml(m.nom || '')}" aria-label="Passer en gestion" title="Passer en gestion">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 19.4V5.6" stroke="rgba(255,255,255,0.78)" stroke-width="1.8" stroke-linecap="round"/>
            <path d="M6.6 11 12 5.6 17.4 11" stroke="rgba(255,255,255,0.78)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>` : ''}
        ${retrogradable ? `<button type="button" class="pm-rang" data-retro="${m.id}"
          data-nom="${escapeHtml(m.nom || '')}" aria-label="Repasser en \u00e9quipe" title="Repasser en \u00e9quipe">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 4.6v13.8" stroke="rgba(255,255,255,0.78)" stroke-width="1.8" stroke-linecap="round"/>
            <path d="M17.4 13 12 18.4 6.6 13" stroke="rgba(255,255,255,0.78)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>` : ''}
        ${!supprimable ? '' : `<button type="button" class="pm-suppr" data-membre="${m.id}" data-nom="${escapeHtml(m.nom || '')}" aria-label="Retirer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>`}
      </div>`
  }).join('')
}

/* ── La recherche ────────────────────────────────────────── */
document.getElementById('pm-chercher')?.addEventListener('input', (e) => {
  filtreEquipe = e.target.value
  document.querySelector('.pm-recherche')?.classList.toggle('remplie', !!filtreEquipe)
  peindreEquipe()
})
document.getElementById('pm-tri')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-tri]')
  if (!b) return
  triEquipe = b.dataset.tri
  document.querySelectorAll('#pm-tri button').forEach(x => x.classList.toggle('active', x === b))
  placerPastille(document.getElementById('pm-tri'))
  peindreEquipe()
})

document.getElementById('pm-vider')?.addEventListener('click', () => {
  filtreEquipe = ''
  const champ = document.getElementById('pm-chercher')
  if (champ) { champ.value = ''; champ.focus() }
  document.querySelector('.pm-recherche')?.classList.remove('remplie')
  peindreEquipe()
})

/* ── La promotion ───────────────────────────────────────── */
document.getElementById('pm-liste')?.addEventListener('click', (e) => {
  /* Toute la ligne ouvre la fiche, sauf les boutons de rôle et de retrait : ce
     sont des actions, pas une consultation. */
  if (e.target.closest('button')) return
  const ligne = e.target.closest('[data-fiche]')
  if (ligne) ouvrirFicheMembre(ligne.dataset.fiche)
})

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

  /* Repli : si les colonnes de promotion n'existent pas encore, on change au
     moins le rôle. La personne aura ses droits ; il lui manquera seulement la
     fête d'accueil, et l'app ne saura pas qu'elle a été promue. */
  if (error) {
    const repli = await supabase.from('membres')
      .update({ role: 'gestion' }).eq('id', btn.dataset.promo).select('id')
    data = repli.data; error = repli.error
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
    message: `${btn.dataset.nom || 'Cette personne'} perdra l'accès aux procédures de l'entreprise. Son compte Procédo n'est pas supprimé : elle pourra rejoindre une autre entreprise.`,
    confirmer: 'Retirer',
    annuler: 'Annuler',
    danger: true,
  })
  if (!ok) return
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
    console.warn('Proc\u00e9do \u00b7 temps de lecture non \u00e9crit :', e?.message || e)
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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
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

function cheminReglagesCamera() {
  const ua = navigator.userAgent
  const iOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const android = /Android/.test(ua)

  /* Sur iOS, TOUS les navigateurs utilisent le moteur de Safari : le chemin est
     le même quel que soit celui qu'on a installé. */
  if (iOS) {
    return {
      appareil: 'iPhone',
      etapes: [
        'Touchez le <b>\u1d00A</b> \u00e0 gauche de la barre d\u2019adresse, en haut',
        'Choisissez <b>R\u00e9glages du site web</b>',
        'Mettez <b>Cam\u00e9ra</b> sur <b>Autoriser</b>',
        'Revenez ici et touchez <b>R\u00e9essayer</b>',
      ],
      repli: 'Si le menu n\u2019appara\u00eet pas : R\u00e9glages \u2192 Safari \u2192 Cam\u00e9ra \u2192 Demander ou Autoriser.',
    }
  }

  if (android) {
    const chrome = /Chrome|CriOS/.test(ua) && !/EdgA|OPR|SamsungBrowser/.test(ua)
    const samsung = /SamsungBrowser/.test(ua)
    if (samsung) {
      return {
        appareil: 'Samsung Internet',
        etapes: [
          'Touchez le <b>cadenas</b> \u00e0 gauche de l\u2019adresse',
          'Choisissez <b>Autorisations</b>',
          'Activez <b>Cam\u00e9ra</b>',
          'Revenez ici et touchez <b>R\u00e9essayer</b>',
        ],
        repli: 'Ou : Param\u00e8tres du t\u00e9l\u00e9phone \u2192 Applications \u2192 Samsung Internet \u2192 Autorisations \u2192 Appareil photo.',
      }
    }
    return {
      appareil: chrome ? 'Chrome' : 'votre navigateur',
      etapes: [
        'Touchez le <b>cadenas</b> \u00e0 gauche de l\u2019adresse',
        'Choisissez <b>Autorisations</b> ou <b>Param\u00e8tres du site</b>',
        'Mettez <b>Cam\u00e9ra</b> sur <b>Autoriser</b>',
        'Revenez ici et touchez <b>R\u00e9essayer</b>',
      ],
      repli: 'Ou : Param\u00e8tres du t\u00e9l\u00e9phone \u2192 Applications \u2192 Chrome \u2192 Autorisations \u2192 Appareil photo.',
    }
  }

  return {
    appareil: 'ordinateur',
    etapes: [
      'Touchez l\u2019ic\u00f4ne \u00e0 gauche de la barre d\u2019adresse',
      'Mettez <b>Cam\u00e9ra</b> sur <b>Autoriser</b>',
      'Rechargez la page',
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
      <div class="s">Votre navigateur a refus\u00e9 l\u2019acc\u00e8s. Il ne le redemandera pas tout seul \u2014 voici comment le r\u00e9tablir sur ${escapeHtml(c.appareil)}.</div>
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
    resultZone.innerHTML = `<div class="error-msg">Ce code ne correspond à aucune procédure Procédo.</div>`
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
    console.warn('Proc\u00e9do \u00b7 lampe indisponible :', err?.message || err)
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

window.openEditProcedure = async function(procId, mode) {
  pileEdition = []
  editProcedureId = procId
  editMode = mode || 'edit'
  showGestionScreen('p-edit-procedure')
  document.getElementById('edit-error').textContent = ''
  document.getElementById('edit-titre-header').textContent = editMode === 'ai-review' ? 'Vérifier les étapes' : 'Modifier la procédure'
  document.getElementById('edit-subhead').textContent = editMode === 'ai-review'
    ? "L'IA a généré ces étapes — corrigez le texte ou le moment du clip si besoin"
    : 'Modifiez le titre, la catégorie ou les étapes'
  document.getElementById('edit-save-btn').textContent = editMode === 'ai-review' ? 'Publier la procédure' : 'Enregistrer les modifications'

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

  document.getElementById('edit-titre').value = proc.titre || ''
  document.getElementById('edit-categorie').value = proc.categorie || ''

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
                         danger = true, accompli = false }) {
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
          <span class="fen-ic ${teinte}">${danger ? ICONE_POUBELLE
            : accompli ? ICONE_COCHE_RONDE : ICONE_QUESTION}</span>
          <div class="fen-t">${escapeHtml(titre)}</div>
          ${message ? `<div class="fen-s">${escapeHtml(message)}</div>` : ''}
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
  renderEditSteps()
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

  if (!titre) { errorEl.textContent = 'Le titre est obligatoire.'; return }
  if (editStepsData.length === 0) { errorEl.textContent = 'Ajoutez au moins une étape.'; return }
  if (editStepsData.some(s => !s.texte.trim())) { errorEl.textContent = 'Chaque étape doit avoir un texte.'; return }

  const saveBtn = document.getElementById('edit-save-btn')
  setButtonLoading(saveBtn, true)

  /* L'image de la procédure part avec le reste. Si la colonne n'existe pas
     encore, la mise à jour échoue entièrement : on retente alors sans elle,
     plutôt que de perdre le titre et la catégorie pour une image. */
  const urlCouv = await envoyerCouverture(editProcedureId)

  let { error: updateError } = await supabase
    .from('procedures').update({ titre, categorie, image_url: urlCouv }).eq('id', editProcedureId)
  if (updateError && /image_url/i.test(updateError.message || '')) {
    console.warn('Proc\u00e9do \u00b7 colonne image_url absente sur procedures.')
    const repli = await supabase.from('procedures')
      .update({ titre, categorie }).eq('id', editProcedureId)
    updateError = repli.error
  }
  if (updateError) { setButtonLoading(saveBtn, false); errorEl.textContent = updateError.message; return }

  // On repart d'une liste propre : on supprime les anciennes étapes et on réinsère la version modifiée
  await supabase.from('etapes').delete().eq('procedure_id', editProcedureId)
  const etapesToInsert = editStepsData.map((s, i) => ({
    procedure_id: editProcedureId, ordre: i + 1, texte: s.texte,
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
    console.warn('Proc\u00e9do \u00b7 adresse non sign\u00e9e :', e?.message || e)
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
    else el.closest('.detail-step-img, .analyse-couv, .step-img-vignette')?.remove()
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
