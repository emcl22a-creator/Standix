/* ============================================================
   VERRE — code EXACT de archisvaze/liquid-glass (index.html)
   https://github.com/archisvaze/liquid-glass
   ============================================================ */
const SURFACE_FNS = {
            convex_squircle: (x) => Math.pow(1 - Math.pow(1 - x, 4), 0.25),
            convex_circle: (x) => Math.sqrt(1 - (1 - x) * (1 - x)),
            concave: (x) => 1 - Math.sqrt(1 - (1 - x) * (1 - x)),
            lip: (x) => {
                const convex = Math.pow(1 - Math.pow(1 - Math.min(x * 2, 1), 4), 0.25);
                const concave = 1 - Math.sqrt(1 - (1 - x) * (1 - x)) + 0.1;
                const t = 6 * x ** 5 - 15 * x ** 4 + 10 * x ** 3;
                return convex * (1 - t) + concave * t;
            },
        };

        function calculateRefractionProfile(glassThickness, bezelWidth, heightFn, ior, samples) {
            samples = samples || 128;
            const eta = 1 / ior;
            function refract(nx, ny) {
                const dot = ny;
                const k = 1 - eta * eta * (1 - dot * dot);
                if (k < 0) return null;
                const sq = Math.sqrt(k);
                return [-(eta * dot + sq) * nx, eta - (eta * dot + sq) * ny];
            }
            const profile = new Float64Array(samples);
            for (let i = 0; i < samples; i++) {
                const x = i / samples;
                const y = heightFn(x);
                const dx = x < 1 ? 0.0001 : -0.0001;
                const y2 = heightFn(x + dx);
                const deriv = (y2 - y) / dx;
                const mag = Math.sqrt(deriv * deriv + 1);
                const ref = refract(-deriv / mag, -1 / mag);
                if (!ref) {
                    profile[i] = 0;
                    continue;
                }
                profile[i] = ref[0] * ((y * bezelWidth + glassThickness) / ref[1]);
            }
            return profile;
        }

        function generateDisplacementMap(w, h, radius, bezelWidth, profile, maxDisp) {
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            const ctx = c.getContext('2d');
            const img = ctx.createImageData(w, h);
            const d = img.data;
            for (let i = 0; i < d.length; i += 4) {
                d[i] = 128;
                d[i + 1] = 128;
                d[i + 2] = 0;
                d[i + 3] = 255;
            }

            const r = radius,
                rSq = r * r,
                r1Sq = (r + 1) ** 2;
            const rBSq = Math.max(r - bezelWidth, 0) ** 2;
            const wB = w - r * 2,
                hB = h - r * 2,
                S = profile.length;

            for (let y1 = 0; y1 < h; y1++) {
                for (let x1 = 0; x1 < w; x1++) {
                    const x = x1 < r ? x1 - r : x1 >= w - r ? x1 - r - wB : 0;
                    const y = y1 < r ? y1 - r : y1 >= h - r ? y1 - r - hB : 0;
                    const dSq = x * x + y * y;
                    if (dSq > r1Sq || dSq < rBSq) continue;
                    const dist = Math.sqrt(dSq);
                    const fromSide = r - dist;
                    const op = dSq < rSq ? 1 : 1 - (dist - Math.sqrt(rSq)) / (Math.sqrt(r1Sq) - Math.sqrt(rSq));
                    if (op <= 0 || dist === 0) continue;
                    const cos = x / dist,
                        sin = y / dist;
                    const bi = Math.min(((fromSide / bezelWidth) * S) | 0, S - 1);
                    const disp = profile[bi] || 0;
                    const dX = (-cos * disp) / maxDisp,
                        dY = (-sin * disp) / maxDisp;
                    const idx = (y1 * w + x1) * 4;
                    d[idx] = (128 + dX * 127 * op + 0.5) | 0;
                    d[idx + 1] = (128 + dY * 127 * op + 0.5) | 0;
                }
            }
            ctx.putImageData(img, 0, 0);
            return c.toDataURL();
        }

        function generateSpecularMap(w, h, radius, bezelWidth, angle) {
            angle = angle != null ? angle : Math.PI / 3;
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            const ctx = c.getContext('2d');
            const img = ctx.createImageData(w, h);
            const d = img.data;
            d.fill(0);

            const r = radius,
                rSq = r * r,
                r1Sq = (r + 1) ** 2;
            const rBSq = Math.max(r - bezelWidth, 0) ** 2;
            const wB = w - r * 2,
                hB = h - r * 2;
            const sv = [Math.cos(angle), Math.sin(angle)];

            for (let y1 = 0; y1 < h; y1++) {
                for (let x1 = 0; x1 < w; x1++) {
                    const x = x1 < r ? x1 - r : x1 >= w - r ? x1 - r - wB : 0;
                    const y = y1 < r ? y1 - r : y1 >= h - r ? y1 - r - hB : 0;
                    const dSq = x * x + y * y;
                    if (dSq > r1Sq || dSq < rBSq) continue;
                    const dist = Math.sqrt(dSq);
                    const fromSide = r - dist;
                    const op = dSq < rSq ? 1 : 1 - (dist - Math.sqrt(rSq)) / (Math.sqrt(r1Sq) - Math.sqrt(rSq));
                    if (op <= 0 || dist === 0) continue;
                    const cos = x / dist,
                        sin = -y / dist;
                    const dot = Math.abs(cos * sv[0] + sin * sv[1]);
                    const edge = Math.sqrt(Math.max(0, 1 - (1 - fromSide) ** 2));
                    const coeff = dot * edge;
                    const col = (255 * coeff) | 0;
                    const alpha = (col * coeff * op) | 0;
                    const idx = (y1 * w + x1) * 4;
                    d[idx] = col;
                    d[idx + 1] = col;
                    d[idx + 2] = col;
                    d[idx + 3] = alpha;
                }
            }
            ctx.putImageData(img, 0, 0);
            return c.toDataURL();
        }

        

/* ---- Vos reglages du panneau ---- */
const AV = {
  surface:      'convex_squircle',
  thickness:    200,    // Glass Thickness
  bezel:        24,     // Bezel Width
  ior:          2.10,   // Refractive Index
  scaleRatio:   0.90,   // Scale Ratio
  blur:         4.4,    // Blur
  specOpacity:  0.50,   // Specular Opacity
  specSat:      12,     // Specular Saturation
};

function buildFilter(id, w, h, radius, blurOverride, scaleMul) {
  if (w < 2 || h < 2) return;
  const heightFn = SURFACE_FNS[AV.surface];
  const clampedBezel = Math.min(AV.bezel, radius - 1, Math.min(w, h) / 2 - 1);
  const profile = calculateRefractionProfile(AV.thickness, clampedBezel, heightFn, AV.ior, 128);
  const maxDisp = Math.max(...Array.from(profile).map(Math.abs)) || 1;
  const dispUrl = generateDisplacementMap(w, h, radius, clampedBezel, profile, maxDisp);
  const specUrl = generateSpecularMap(w, h, radius, clampedBezel * 2.5);
  const scale = maxDisp * AV.scaleRatio * (scaleMul !== undefined ? scaleMul : 1);
  let d = document.getElementById(id + '-defs');
  if (!d) {
    d = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    d.id = id + '-defs';
    document.getElementById('svg-defs').appendChild(d);
  }
  d.innerHTML = `
    <filter id="${id}" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="${blurOverride !== undefined ? blurOverride : AV.blur}" result="blurred_source" />
      <feImage href="${dispUrl}" x="0" y="0" width="${w}" height="${h}" result="disp_map" />
      <feDisplacementMap in="blurred_source" in2="disp_map"
        scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="displaced" />
      <feColorMatrix in="displaced" type="saturate" values="${AV.specSat}" result="displaced_sat" />
      <feImage href="${specUrl}" x="0" y="0" width="${w}" height="${h}" result="spec_layer" />
      <feComposite in="displaced_sat" in2="spec_layer" operator="in" result="spec_masked" />
      <feComponentTransfer in="spec_layer" result="spec_faded">
        <feFuncA type="linear" slope="${AV.specOpacity}" />
      </feComponentTransfer>
      <feBlend in="spec_masked" in2="displaced" mode="normal" result="with_sat" />
      <feBlend in="spec_faded" in2="with_sat" mode="normal" />
    </filter>`;
}

/* ============================================================
   ANIMATION — activeLens.js, identique au v7
   ============================================================ */
// ============================================================
// activeLens — capsule active de la navbar.
// UNE seule geometrie, UNE seule boucle, UNE seule machine d'etats.
// Aucun code repris de l'ancien systeme.
// ============================================================





const LENS = {
  BASE_W: 62,        // largeur de reference
  REST_W: 74,        // largeur au repos : 62 + 6 px de chaque cote
  REST_H: 46,
  // Ressort de position : la lentille a une vraie inertie.
  STIFFNESS: 120,   // accorde avec TRAVEL_MS : le ressort finit seul
  DAMPING: 22,      // legerement sur-amorti : aucun rebond de position
  // Fenetre d'observation de la vitesse, comme accelerationWindowDuration
  // dans LiquidLensView (0.3 s).
  WINDOW_MS: 300,
  // Deformation maximale, equivalent de maxScaleDeviation (0.3).
  MAX_DEVIATION: 0.3,
  // Bornes issues de la timeline : 70 % de large, 165 % de haut.
  // ---- Trajet, mesure sur la video de reference ----
  // La capsule ne retrecit PAS : elle S'ETIRE pour relier les deux
  // onglets, comme une goutte. Largeur mesuree : 541 -> 783 px, soit
  // +45 % au maximum de l'etirement, puis contraction a l'arrivee.
  // Forme pendant le trajet, en deux temps :
  //   1. le rectangle se contracte vers un CARRE a cotes arrondis
  //   2. le carre s'etire en RECTANGLE a cotes arrondis
  WIDE_AT: 0.24,     // instant de l'etirement maximal
  WIDE_SIG: 0.17,    // largeur de la phase etiree
  SQUARE_AT: 0.66,   // instant du carre
  SQUARE_SIG: 0.15,  // largeur de la phase carree
  STRETCH: 0.45,     // etirement horizontal maximal
  SQUASH_H: 0.06,    // leger aplatissement pendant l'etirement
  OVERFLOW_V: 26,    // 50.5 + 26 = 76.5 : la capsule sort de 7 px en
                     // haut et en bas, comme sur la navbar Apple
  OVERFLOW_AT: 0.62, // instant du depassement maximal
  OVERFLOW_SIG: 0.3, // etalement du depassement

  // ---- Atterrissage : trois rebonds decroissants ----
  // fort, moyen, faible. Oscillation amortie sur les DEUX axes.
  LAND_A1: 0.14,     // 1er rebond : moyen
  LAND_A2: 0.10,     // 2e rebond : entre moyen et faible
  LAND_A3: 0.06,     // 3e rebond : faible
  LAND_A4: 0.03,     // 4e rebond : faible
  LAND_PERIOD: 150,  // duree d'un rebond, en ms
  TRAVEL_MS: 560,    // > temps de convergence du ressort (450 ms)
  LAND_MS: 600,      // exactement 4 x LAND_PERIOD : fin a zero
  GLASS_HOLD: 0,     // le gris monte des la premiere frame du rebond
  GLASS_FADE: 0.62,  // conserve pour compatibilite, non utilise
  GLASS_LEAD: 0.3,   // part FINALE du trajet consacree au fondu.
                     // Le verre est totalement remplace par le gris AVANT
                     // le contact : les rebonds se jouent donc sur une
                     // capsule deja grise, en un seul mouvement continu.
  NAVBAR_H: 55,      // hauteur de la navbar
  INNER_PAD: 2,      // marge interieure haut et bas
  // hauteur max = interieur de la barre : (55 - 2*2) / 46
  MAX_H: (55 - 2 * 2) / 46,
  PAD: 2.5,
  ARRIVE_PX: 3,      // tolerance pour considerer la capsule posee
  SETTLE_PX: 0.15,
  SETTLE_V: 6,
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const smoothRange = (a, b, x) => smooth((x - a) / (b - a || 1));

/** La matiere ne change jamais : Liquid Glass au repos comme en mouvement. */
function travelGlass() {
  return 1;
}

/**
 * Lentille active.
 *
 * Principes repris de LiquidLensView (DnV1eX/LiquidGlassKit) :
 *  - la deformation n'est PAS keyframee, elle derive du mouvement reel ;
 *  - on observe la position sur une fenetre glissante, on en tire la
 *    vitesse puis l'acceleration ;
 *  - squash et stretch sont OPPOSES (scaleX = 1 + s, scaleY = 1 - s),
 *    ce qui conserve le volume apparent ;
 *  - la deviation est bornee (maxScaleDeviation) pour rester stable.
 *
 * Seule inversion volontaire : ici l'acceleration compacte la lentille
 * en largeur et l'etire en hauteur, conformement a la timeline voulue.
 */
class ActiveLens {
  phase = 'rest';
  x;
  v = 0;
  targetX;
  history = [];
  contacted = false;
  contained = false;
  /** deformation courante, 0 = REST, 1 = deviation maximale */
  deform = 0;
  travelStart = 0;
  landT0 = 0;   // instant du contact, 0 = pas de rebond en cours
  startX = 0;   // position au depart du trajet
  landW = 0;    // largeur au moment du contact
  landH = 0;    // hauteur au moment du contact
  lastW = LENS.REST_W;  // derniere forme calculee
  lastH = LENS.REST_H;
  progMax = 0;  // progression atteinte, jamais decroissante


  constructor(x) {
    this.x = x;
    this.targetX = x;
  }

  snapTo(x) {
    this.phase = 'rest';
    this.x = x;
    this.targetX = x;
    this.v = 0;
    this.deform = 0;
    this.history.length = 0;
  }

  goTo(x) {
    if (Math.abs(x - this.targetX) < 0.01) return false;
    this.targetX = x;
    this.phase = 'travel';
    this.travelStart = performance.now();
    this.startX = this.x;
    this.progMax = 0;
    this.landT0 = 0;
    this.contacted = false;
    this.contained = false;
    return true;
  }

  /** Vitesse de pic theorique du ressort, sert a normaliser la deformation. */
  peakV(dist) {
    return Math.max(1, dist * Math.sqrt(LENS.STIFFNESS) * 0.4);
  }

  step(dt, now, containedNow) {
    if (this.phase === 'travel') {
      // --- integration du ressort : position, vitesse, acceleration ---
      const step = Math.min(dt, 1 / 45);
      const a = (this.targetX - this.x) * LENS.STIFFNESS - this.v * LENS.DAMPING;
      this.v += a * step;
      this.x += this.v * step;

      // --- fenetre glissante d'observation, comme dans LiquidLensView ---
      this.history.push({ x: this.x, t: now });
      const cutoff = now - LENS.WINDOW_MS;
      while (this.history.length && this.history[0].t < cutoff) this.history.shift();

      // vitesse observee sur la fenetre
      let vObs = Math.abs(this.v);
      if (this.history.length >= 2) {
        const f = this.history[0];
        const l = this.history[this.history.length - 1];
        const span = (l.t - f.t) / 1000;
        if (span > 0) vObs = Math.max(vObs, Math.abs(l.x - f.x) / span);
      }

      // deviation bornee, exactement l'esprit de maxScaleDeviation
      const dist = Math.abs(this.targetX - this.history[0].x) || 1;
      const raw = vObs / this.peakV(dist);
      // La deformation s'eteint a l'approche de la cible : elle ne peut
      // donc pas rester active une fois la lentille posee sur l'onglet.
      const remaining = Math.abs(this.targetX - this.x);
      const prox = Math.min(1, remaining / 10);
      this.deform = Math.max(0, Math.min(1, raw)) * prox;

      // Securite : au-dela de MAX_TRAVEL_MS, la lentille est posee d'office.
      // Sans cela un dt aberrant peut empecher le ressort de converger.
      // Au-dela de la duree prevue, on ne TELEPORTE pas la capsule sur la
      // cible : cela produisait un a-coup en fin de trajet. On la fait
      // converger doucement, et on ne cloture qu'une fois posee.
      if (now - this.travelStart > (LENS.TRAVEL_MS || 380)) {
        const rest = this.targetX - this.x;
        if (Math.abs(rest) > 0.4) {
          // convergence douce, la forme continue d'etre calculee plus bas
          this.x += rest * Math.min(1, 6 * Math.min(dt, 1 / 45));
          this.v = 0;
          this.deform = Math.max(0, this.deform * 0.85);
        } else {
        this.x = this.targetX;
        this.v = 0;
        this.deform = 0;
        this.phase = 'rest';
        this.history.length = 0;
        if (!this.landT0) {
          this.landT0 = now;
          this.landW = this.lastW;
          this.landH = this.lastH;
        }
        }
        return this.geom(this.x, LENS.REST_W, LENS.REST_H);
      }

      // arret : proche de la cible ET quasi immobile
      if (
        Math.abs(this.targetX - this.x) < LENS.SETTLE_PX &&
        Math.abs(this.v) < LENS.SETTLE_V
      ) {
        // La forme est deja pilotee par le rebond : on ne fait que
        // cloturer le deplacement, sans rien reinitialiser d'autre.
        this.x = this.targetX;
        this.v = 0;
        this.deform = 0;
        this.phase = 'rest';
        this.history.length = 0;
        if (!this.landT0) {
          this.landT0 = now;
          this.landW = this.lastW;
          this.landH = this.lastH;
        }
      }
    }

    // squash / stretch opposes, bornes
    const d = this.deform * LENS.MAX_DEVIATION;
    const k = d / LENS.MAX_DEVIATION;

    // Progression reelle du trajet, 0 au depart, 1 a l'arrivee.
    const total = Math.abs(this.targetX - this.startX) || 1;
    // Le ressort depasse la cible puis revient : la distance restante
    // remonte, et une progression brute reculerait — la forme se
    // retracterait puis repartirait. On garde donc le maximum atteint.
    const rawProg = Math.max(0, Math.min(1, 1 - Math.abs(this.targetX - this.x) / total));
    if (this.phase === 'travel') this.progMax = Math.max(this.progMax, rawProg);
    const prog = this.progMax;

    // ---- Trois etats successifs, une seule courbe continue ----
    //   1. la capsule s'ETIRE en partant       (large, prog ~0.24)
    //   2. elle se ramasse en CARRE arrondi    (prog ~0.66)
    //   3. elle s'ouvre en CAPSULE a l'arrivee (retour a REST)
    // Somme de deux cloches gaussiennes : aucun raccord, aucun arret,
    // la forme respire d'un seul geste.
    const wide = LENS.REST_W * (1 + LENS.STRETCH);
    const square = LENS.REST_H;
    const P1 = LENS.WIDE_AT;
    const P2 = LENS.SQUARE_AT;
    const S1 = LENS.WIDE_SIG;
    const S2 = LENS.SQUARE_SIG;
    const gs = (u, c, sg) => Math.exp(-Math.pow((u - c) / sg, 2));
    const nb = (u, c, sg) => {
      const r0 = Math.max(gs(0, c, sg), gs(1, c, sg));
      return Math.max(0, (gs(u, c, sg) - r0) / (1 - r0));
    };
    // amplitudes resolues pour passer exactement par wide en P1 et square en P2
    const a11 = nb(P1, P1, S1);
    const a12 = -nb(P1, P2, S2);
    const a21 = nb(P2, P1, S1);
    const a22 = -nb(P2, P2, S2);
    const det = a11 * a22 - a12 * a21 || 1;
    const A = ((wide - LENS.REST_W) * a22 - a12 * (square - LENS.REST_W)) / det;
    const B = (a11 * (square - LENS.REST_W) - (wide - LENS.REST_W) * a21) / det;
    // ---- Hauteur : la capsule deborde legerement de la navbar ----
    // Elle depasse en haut et en bas pendant le trajet, puis revient
    // exactement a REST_H a l'arrivee.
    const hOver = nb(prog, LENS.OVERFLOW_AT, LENS.OVERFLOW_SIG);
    const hTravel = LENS.REST_H + LENS.OVERFLOW_V * hOver;

    // Le CARRE vise la hauteur du moment, sinon la forme serait plus
    // haute que large et ne ressemblerait plus a un carre.
    const squareNow =
      LENS.REST_H + LENS.OVERFLOW_V * nb(P2, LENS.OVERFLOW_AT, LENS.OVERFLOW_SIG);
    const A2 = ((wide - LENS.REST_W) * a22 - a12 * (squareNow - LENS.REST_W)) / det;
    const B2 = (a11 * (squareNow - LENS.REST_W) - (wide - LENS.REST_W) * a21) / det;
    const w = LENS.REST_W + A2 * nb(prog, P1, S1) - B2 * nb(prog, P2, S2);

    const h = hTravel * (1 - LENS.SQUASH_H * k * 0.3);

    this.lastW = w;
    this.lastH = h;
    const g = this.geom(this.x, w, h);
    // ---- DECLENCHEUR DU REBOND ----
    // Deux conditions simultanees :
    //   1. la capsule est POSEE sur l'onglet cible
    //   2. elle englobe entierement l'icone ET le texte
    // La premiere evite qu'un simple survol, capsule etiree, ne le
    // declenche en plein trajet.
    const settled = Math.abs(this.targetX - this.x) <= LENS.ARRIVE_PX;
    if (this.phase === 'travel' && !this.contained && settled && containedNow(g)) {
      this.contained = true;
      // La position n'est pas figee : le ressort finit de porter la
      // capsule pendant que la forme rebondit.
      this.landT0 = performance.now();
      // Le rebond part de la forme REELLE, donc sans aucun saut.
      this.landW = w;
      this.landH = h;
      return this.geom(this.x, w, h);
    }
    return g;
  }

  geom(x, w, h) {
    // Le rebond ne pilote la forme qu'une fois ARME, c'est-a-dire une
    // fois la capsule posee sur l'onglet. Avant, c'est la courbe de
    // trajet qui commande.
    if (this.phase !== 'travel' || this.landT0) {
      if (!this.landT0) {
        w = LENS.REST_W;
        h = LENS.REST_H;
      } else {
        const t = performance.now() - this.landT0;
        if (t >= LENS.LAND_MS) {
          this.landT0 = 0;
          w = LENS.REST_W;
          h = LENS.REST_H;
        } else {
          const p = t / LENS.LAND_MS;
          // 1. la forme rejoint le REST depuis sa taille au contact.
          //    smoothstep demarre a vitesse nulle : le raccord avec le
          //    trajet est doux, sans a-coup.
          const ease = p * p * (3 - 2 * p);
          const baseW = this.landW + (LENS.REST_W - this.landW) * ease;
          const baseH = this.landH + (LENS.REST_H - this.landH) * ease;
          // 2. quatre rebonds decroissants s'y superposent, d'amplitude
          //    nulle au depart et eteinte a l'arrivee.
          const n = Math.min(3, Math.floor(t / LENS.LAND_PERIOD));
          const amps = [LENS.LAND_A1, LENS.LAND_A2, LENS.LAND_A3, LENS.LAND_A4];
          const amp = amps[n] * (1 - p);
          const ph = (t % LENS.LAND_PERIOD) / LENS.LAND_PERIOD;
          const wave = Math.sin(ph * Math.PI) * (n % 2 === 0 ? 1 : -1);
          w = baseW * (1 + amp * wave);
          h = baseH * (1 - amp * wave * 0.7);
        }
      }
    }

    // Les bornes doivent couvrir l'aplatissement ET les rebonds, sinon
    // la hauteur est ecretee en plein rebond et le mouvement se coupe.
    const hSwing =
      Math.max(LENS.SQUASH_H, LENS.LAND_A1) + 0.02 + LENS.OVERFLOW_V / LENS.REST_H;
    h = Math.max(LENS.REST_H * (1 - hSwing),
                 Math.min(h, LENS.REST_H * (1 + hSwing)));
    w = Math.max(LENS.REST_H * 0.9,
                 Math.min(LENS.REST_W * (1 + LENS.STRETCH) * (1 + LENS.LAND_A1) + 2, w));
    // Cotes gauche et droit en demi-cercle parfait : le rayon vaut
    // la demi-hauteur, borne par la demi-largeur.
    const radius = Math.min(h / 2, w / 2);
    return {
      x,
      y: 0,
      width: w,
      height: h,
      radius,
      // 0 au repos, 1 en plein mouvement. Base sur la vitesse et non
      // sur la largeur, qui passe sous REST pendant la phase carree.
      bulge: this.phase === 'travel' ? Math.max(0, Math.min(1, this.deform)) : 0,
      // Verre plein pendant le trajet, puis fondu vers le gris pendant
      // les rebonds : la matiere se depose naturellement.
      // Le verre reste PLEIN pendant le debut des rebonds : la capsule a
      // le temps de s'installer. Le fondu vers le gris vient ensuite.
      // ---- Etat de matiere ----
      // Le fondu verre -> gris se joue ENTIEREMENT sur la fin du trajet.
      // A l'instant du contact il est deja termine : les rebonds se
      // deroulent sur une capsule grise, sans changement de matiere
      // simultane. smootherstep : demarrage et arrivee imperceptibles.
      glass: (() => {
        if (this.phase !== 'travel') return 0;
        const start = 1 - LENS.GLASS_LEAD;
        const u = Math.max(
          0,
          Math.min(1, (this.progMax - start) / Math.max(0.001, LENS.GLASS_LEAD)),
        );
        const sS = u * u * u * (u * (u * 6 - 15) + 10);
        return 1 - sS;
      })(),
      top: -h / 2,
      bottom: h / 2,
      left: x - w / 2,
      right: x + w / 2,
    };
  }
}


/* ============================================================
   NAVBAR
   ============================================================ */
// La largeur est lue sur le DOM : elle suit la taille de l'ecran.
let BAR_W = 298;
const BAR_H = 62;
const SIDE_PAD = 5.5;   // marge entre la capsule et le bord interieur
let CENTERS = [];

// ---- Geometrie de la capsule ----
// Une SEULE marge, identique en haut, en bas, a gauche et a droite.
// La capsule occupe donc tout l'espace interieur disponible :
//   hauteur = BAR_H - 2 x PAD
//   largeur = (BAR_W - 2 x PAD) / 4   (les 4 onglets sont jointifs)
const PAD = 5.75;      // marge identique dans les quatre directions
// Marge HAUTE reduite d'un huitieme : la capsule gagne cet espace
// vers le haut, son centre remonte donc legerement.
// Marge IDENTIQUE dans les quatre directions : le haut, le bas et les
// deux cotes ont exactement le meme espace jusqu'au bord de la barre.
const PAD_TOP = PAD;
const Y_SHIFT = (PAD - PAD_TOP) / 2;


const LABELS = ['Accueil', 'Procédures', '', 'Analyse', 'Réglages']
  /* L'entrée centrale n'a pas de libellé : c'est le bouton « + », il
     déclenche une action et ne désigne pas une page. */
  const CENTRE = 2;

function layout() {
  const bar = document.getElementById('bar');
  BAR_W = bar.getBoundingClientRect().width;

  // La capsule remplit l'interieur de la barre, marge PAD partout.
  LENS.REST_H = BAR_H - PAD_TOP - PAD;
  /* Le nombre d'onglets vient de LABELS, il n'est plus écrit en dur.
     Avec 4 figé ici, la cinquième entrée — Réglages — tombait hors de la
     barre : elle existait, mais personne ne la voyait. */
  const N = LABELS.length;
  LENS.REST_W = (BAR_W - 2 * PAD) / N;
  LENS.BASE_W = LENS.REST_W;
  const half = LENS.REST_W / 2;
  CENTERS = Array.from({length: N}, (_, i) => PAD + half + LENS.REST_W * i);
}
const ICONS = [
  {line:'M3.2 10.7 12 3.4l8.8 7.3V19.6a2.2 2.2 0 0 1-2.2 2.2h-3.9v-6.4H9.3v6.4H5.4a2.2 2.2 0 0 1-2.2-2.2z',
   fill:'M3.2 10.7 12 3.4l8.8 7.3V19.6a2.2 2.2 0 0 1-2.2 2.2H5.4a2.2 2.2 0 0 1-2.2-2.2z M9.3 21.8v-6.4h5.4v6.4z'},
  {line:'M9.2 2.6h5.6a1.2 1.2 0 0 1 1.2 1.2v1.4H8V3.8a1.2 1.2 0 0 1 1.2-1.2z M6.8 5.2h10.4A2.8 2.8 0 0 1 20 8v11.2a2.8 2.8 0 0 1-2.8 2.8H6.8A2.8 2.8 0 0 1 4 19.2V8a2.8 2.8 0 0 1 2.8-2.8z M8.8 10.9h6.4M8.8 14.4h6.4M8.8 17.9h3.6',
   fill:'M6.8 5.2h10.4A2.8 2.8 0 0 1 20 8v11.2a2.8 2.8 0 0 1-2.8 2.8H6.8A2.8 2.8 0 0 1 4 19.2V8a2.8 2.8 0 0 1 2.8-2.8z M8.9 10h6.2a.9.9 0 1 1 0 1.8H8.9a.9.9 0 1 1 0-1.8z M8.9 13.5h6.2a.9.9 0 1 1 0 1.8H8.9a.9.9 0 1 1 0-1.8z M8.9 17h3.4a.9.9 0 1 1 0 1.8H8.9a.9.9 0 1 1 0-1.8z M9.2 2.6h5.6a1.2 1.2 0 0 1 1.2 1.2v1.4H8V3.8a1.2 1.2 0 0 1 1.2-1.2z'},
    /* Le « + » : deux traits, sans version pleine — il ne s'allume jamais. */
    {line:'M12 5.2v13.6 M5.2 12h13.6', fill:'M12 5.2v13.6 M5.2 12h13.6'},
  {line:'M3.4 3.4v15.4a2 2 0 0 0 2 2h15.2 M8.2 17.2v-3.4M13 17.2V8.6M17.8 17.2v-6',
   fill:'M3.4 3.4h2v15.4h15.2v2H5.4a2 2 0 0 1-2-2z M7.1 13.3h2.4v5.5H7.1z M11.8 8.1h2.4v10.7h-2.4z M16.5 10.6h2.4v8.2h-2.4z'},
  {line:'M12.2 2.4h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7v-.2a2 2 0 0 0-2-2z M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0z',
   fill:'M12.2 2.4h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7v-.2a2 2 0 0 0-2-2zM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0z'},
];
const ZOOM_ICON = 1.35, ZOOM_LABEL = 1.28;

const barEl = document.getElementById('bar');
// ---- Impulsion de la barre au changement de page ----
// Elle enfle puis revient AUSSITOT : une impulsion, pas un palier.
// Independante du trajet, qui lui dure bien plus longtemps.
// ---- La barre SUIT le cercle ----
// Elle ne part pas au clic : elle reagit au mouvement reel de la
// capsule, filtre par un lissage. Elle enfle donc APRES elle et se
// repose APRES elle, a son propre rythme.
const BAR_SWELL = 0.032;   // +3,2 % : le grossissement se voit franchement
// Ressort critique plutot qu'un lissage exponentiel : sa VITESSE est
// continue, donc le basculement de cible ne produit aucune saccade.
const BAR_GLOW   = 0.075;  // teinte ajoutee au sommet : la barre s'eclaircit
const BAR_BRIGHT = 0.10;   // eclat general au sommet
// La cible est 1 tant que la capsule n'a pas touche, puis 0. Avec une
// raideur elevee, la barre atteint quasiment son maximum meme sur le
// trajet le plus court : le grossissement est donc le MEME que les
// pages soient voisines ou opposees.
const BAR_K = 1000;        // raideur elevee : montee et retour rapides,
                           // et amplitude quasi identique quelle que
                           // soit la distance parcourue
// Duree minimale de montee. Entre deux onglets voisins, la capsule
// touche la cible des le depart : sans ce plancher, la barre n'aurait
// pas le temps de grossir et l'amplitude dependrait de la distance.
const BAR_MIN_UP = 200;
let swellStart = 0;
const BAR_D = 2 * Math.sqrt(BAR_K);   // amortissement critique, zero rebond
let barFollow = 0;
let barVel = 0;
// avant tout clic, la barre reste au repos
swellStart = -1e9;
const lensEl = document.getElementById('lens');
const grayEl = document.getElementById('lensGray');
let lensGlassOn = true;
const lNorm = document.getElementById('lNorm');
const lLens = document.getElementById('lLens');
let active = 0;
const contentW = [];

function row(el, filled) {
  el.innerHTML = CENTERS.map((c, i) => `
    <div class="tab" data-i="${i}" style="left:${c - LENS.REST_W / 2}px;width:${LENS.REST_W}px">
      <svg width="22" height="22" viewBox="0 0 24 24"
        fill="${filled ? 'currentColor' : 'none'}"
        stroke="${filled ? 'none' : 'currentColor'}"
        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill-rule="evenodd">
        <path d="${ICONS[i][filled ? 'fill' : 'line']}"/></svg>
      <span>${LABELS[i]}</span>
    </div>`).join('');
}
row(lNorm, false);
row(lLens, true);
requestAnimationFrame(() => {
  lNorm.querySelectorAll('.tab').forEach((t, i) => {
    contentW[i] = t.querySelector('span').getBoundingClientRect().width;
  });
});

layout();
const lens = new ActiveLens(CENTERS[0] - BAR_W / 2);
lNorm.addEventListener('click', (e) => {
  const t = e.target.closest('.tab');
  if (!t) return;
  active = +t.dataset.i;
  lens.goTo(CENTERS[active] - BAR_W / 2);
  swellStart = performance.now();
  if (typeof onNavigate === 'function') onNavigate(active);
});

const CONTENT_H = 36;
// Premier contact : la capsule touche l'icone ou le texte de la cible,
// sans forcement les recouvrir encore.
function touches(g) {
  const cw = contentW[active] || 22;
  const c = CENTERS[active] - BAR_W / 2;
  return g.right >= c - cw / 2 && g.left <= c + cw / 2;
}

function contains(g) {
  const cw = contentW[active] || 22;
  const c = CENTERS[active] - BAR_W / 2;
  return g.left <= c - cw / 2 - LENS.PAD && g.right >= c + cw / 2 + LENS.PAD &&
         g.top <= -CONTENT_H / 2 - LENS.PAD && g.bottom >= CONTENT_H / 2 + LENS.PAD;
}

function rebuild() {
  layout();
  row(lNorm, false);
  row(lLens, true);
  buildFilter('bar-filter', Math.round(BAR_W), BAR_H, BAR_H / 2);
  lens.snapTo(CENTERS[active] - BAR_W / 2);
  requestAnimationFrame(() => {
    lNorm.querySelectorAll('.tab').forEach((t, i) => {
      contentW[i] = t.querySelector('span').getBoundingClientRect().width;
    });
  });
}
rebuild();
let rt = 0;
addEventListener('resize', () => {
  clearTimeout(rt);
  rt = setTimeout(rebuild, 120);
});
let lastKey = '';
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000) || 1 / 60;
  last = now;
  const g = lens.step(dt, now, contains);
  const cx = BAR_W / 2 + g.x;

  lensEl.style.width = g.width + 'px';
  lensEl.style.height = g.height + 'px';
  lensEl.style.left = (cx - g.width / 2) + 'px';
  lensEl.style.marginTop = (-g.height / 2 - Y_SHIFT) + 'px';
  lensEl.style.setProperty('--glass-radius', g.radius + 'px');

  // ---- Matiere : verre en mouvement, gris au repos ----
  // g.glass vaut 1 pendant le trajet et retombe a 0 AVANT le contact.
  const G = g.glass;
  grayEl.style.opacity = (1 - G).toFixed(3);
  // le verre s'efface en meme temps que le gris monte
  lensEl.style.setProperty('--tint-opacity', (0.06 * G).toFixed(4));
  const afterOn = G > 0.01;
  if (afterOn !== lensGlassOn) {
    lensGlassOn = afterOn;
    lensEl.style.setProperty('--lens-filter',
      afterOn ? 'url(#lens-filter)' : 'none');
  }

  const key = Math.round(g.width) + '|' + Math.round(g.height) + '|' + Math.round(g.radius);
  if (key !== lastKey) {
    lastKey = key;
    // Meme matiere que la barre, flou en moins : le contenu reste net
    // sous la capsule alors que la barre, elle, floute le fond.
    buildFilter('lens-filter', Math.round(g.width), Math.round(g.height), Math.round(g.radius), 0);
  }

  const OVF = 40, E = 4, F = 3;
  const mx = cx - g.width / 2 - E,
        my = OVF + BAR_H / 2 - g.height / 2 - E - Y_SHIFT;
  const svg = (fill, base) =>
    `<svg xmlns='http://www.w3.org/2000/svg' width='${BAR_W}' height='${BAR_H + 2 * OVF}'>` +
    `<filter id='f'><feGaussianBlur stdDeviation='${F / 3}'/></filter>` +
    `<rect width='100%' height='100%' fill='${base}'/>` +
    `<rect x='${mx.toFixed(2)}' y='${my.toFixed(2)}' width='${(g.width + E * 2).toFixed(2)}' ` +
    `height='${(g.height + E * 2).toFixed(2)}' rx='${(g.radius + E).toFixed(2)}' ` +
    `fill='${fill}' filter='url(#f)'/></svg>`;
  const url = (m) => `url("data:image/svg+xml,${encodeURIComponent(m)}")`;
  const pos = `0px ${-OVF}px`, size = `${BAR_W}px ${BAR_H + 2 * OVF}px`;
  for (const [el, m] of [[lNorm, svg('#000', '#fff')], [lLens, svg('#fff', '#000')]]) {
    const u = url(m);
    el.style.webkitMaskImage = u; el.style.maskImage = u;
    el.style.webkitMaskPosition = pos; el.style.maskPosition = pos;
    el.style.webkitMaskSize = size; el.style.maskSize = size;
  }

  // ---- Le contenu subit TOUS les effets du verre ----
  // Le calque magnifie est masque par la capsule : les icones et les
  // textes qu'elle survole sont donc grossis, refractes, satures et
  // eclaires exactement comme le fond derriere la barre.
  // ---- La barre respire pendant le changement de page ----
  // Meme courbe que la capsule : elle enfle tres legerement au
  // depart, atteint son maximum a mi-parcours, puis revient.
  // transform-origin en bas : elle grandit vers le haut, sa base
  // ne bouge pas.
  // ---- La barre suit le cercle, puis se repose ----
  // Des que la capsule englobe entierement l'icone et le texte de la
  // page choisie, la cible tombe a zero : la barre revient a sa taille
  // normale, avec une constante de temps plus courte pour que le
  // retour soit franc mais toujours doux.
  // Le retour s'amorce au PREMIER CONTACT : des que la capsule touche
  // l'icone ou le texte de la page choisie, sans attendre qu'elle les
  // recouvre entierement.
  const posee = touches(g) || lens.phase !== 'travel';
  // 1 en plein, pas g.bulge : sinon l'amplitude dependrait de la
  // vitesse du cercle, donc de la distance parcourue.
  const assezMonte = now - swellStart >= BAR_MIN_UP;
  const cible = posee && assezMonte ? 0 : 1;
  const st = Math.min(dt, 1 / 45);
  barVel += ((cible - barFollow) * BAR_K - barVel * BAR_D) * st;
  barFollow += barVel * st;
  // ---- Pourquoi on ne revient JAMAIS a scale(1) exactement ----
  // A l'echelle 1 pile, Chrome considere la transformation comme
  // l'identite : il abandonne la couche composee et re-rasterise le
  // backdrop-filter a sa taille native. Ce changement de mode de rendu
  // decale l'image d'un pixel — c'est le saut visible en fin de course.
  // On garde donc un residu infime, invisible a l'oeil mais suffisant
  // pour que la couche et le filtre restent stables en permanence.
  const REST_EPS = 0.0006;   // scale au repos : 1.00002
  if (Math.abs(barFollow) < 0.0006 && Math.abs(barVel) < 0.004) {
    barFollow = REST_EPS; barVel = 0;
  }
  barEl.style.transform =
    `translateX(-50%) scale(${(1 + BAR_SWELL * barFollow).toFixed(6)}) translateZ(0)`;
  // Illumination : elle arrive et repart exactement avec le
  // grossissement, puisqu'elle est pilotee par la meme valeur.
  barEl.style.setProperty('--tint-opacity',
    (0.06 + BAR_GLOW * barFollow).toFixed(4));
  const br = 1 + BAR_BRIGHT * barFollow;
  barEl.style.filter = `brightness(${br.toFixed(4)})`;
  // La capsule et les onglets sont ENFANTS de la barre : ils heritent
  // de son filtre et de sa teinte. On annule les deux sur eux, pour
  // que seule la barre s'illumine.
  const inv = `brightness(${(1 / br).toFixed(4)})`;
  lensEl.style.filter = inv;
  lensEl.style.setProperty('--tint-opacity', '0.06');
  lNorm.style.filter = inv;

  const mv = g.bulge;
  const si = 1 + (ZOOM_ICON - 1) * mv, sl = 1 + (ZOOM_LABEL - 1) * mv;
  lLens.querySelectorAll('svg').forEach((s) => (s.style.transform = `scale(${si})`));
  lLens.querySelectorAll('span').forEach((s) => (s.style.transform = `scale(${sl})`));

  // Pas de filtre SVG ici : il s'appliquerait au calque ENTIER, avec une
  // carte calee sur la capsule, ce qui deplace le contenu hors de la
  // zone. Les effets du verre sont donc portes en CSS, calibres sur les
  // memes valeurs que le filtre : Specular Opacity, Specular Saturation,
  // et la teinte a 6 %.
  // Ni eclat ni halo : le texte et les icones brillaient trop.
  // Seuls restent le grossissement et un leger gain de contraste.
  lLens.style.filter = `${inv} contrast(${(1 + 0.10 * mv).toFixed(3)})`;
  lLens.style.opacity = String(1 - 0.06 * mv);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ============================================================
   VOTRE NAVIGATION
   Appelee a chaque changement d'onglet, avec son index 0 a 3.
   ============================================================ */
function onNavigate(index) {
  /* Le centre ouvre la création et ne change pas d'onglet : la barre garde
     sa capsule là où elle était. */
  if (index === CENTRE) {
    if (typeof onTabPrincipal === 'function') onTabPrincipal()
    else document.getElementById('tb-principal')?.click()
    return
  }
  const equipe = (typeof espaceCourant === 'function') && espaceCourant() === 'equipe'
  const vers = equipe
    ? { 0:'e-list', 1:'e-list', 3:'e-list', 4:'e-settings' }
    : { 0:'p-list', 1:'p-list', 3:'p-global-analyse', 4:'p-settings' }
  const ecran = vers[index]
  if (!ecran) return
  if (equipe && typeof showEquipeScreen === 'function') showEquipeScreen(ecran)
  else if (typeof showGestionScreen === 'function') showGestionScreen(ecran)
}

/* ─── Le lien avec le reste de l'application ───

   `poserOngletActif` est appelée à chaque changement d'écran par le code
   existant. Elle allume désormais l'onglet de CETTE barre. */
window.poserOngletActif = function (id) {
  const table = (typeof ONGLET_PAR_ECRAN === 'object') ? ONGLET_PAR_ECRAN : {}
  const idx = table[id]
  if (idx == null) return
  if (typeof allerOnglet === 'function') allerOnglet(idx, true)
}