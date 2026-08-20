/* app.js — logique carte partagée par toutes les sorties.
   Chaque page sortie appelle initCarte(dataUrl) avec le chemin
   vers son propre data.geojson. */

// Réserve la place occupée par le header + la recherche (haut) et la légende
// (bas), pour qu'un marqueur centré ou un cadrage ajusté ne finisse pas
// caché dessous. Padding asymétrique passé à flyTo/fitBounds.
const MARGE_UI = { top: 120, bottom: 170, left: 70, right: 70 };

// Rayon min/max des cercles proportionnels (falaises) — taille VISUELLE
// réelle, cf. CIBLE_TACTILE_MIN ci-dessous pour la zone cliquable (les deux
// sont découplés : réduire RAYON_MIN n'affecte pas la cible tactile).
// Diamètre 14px → 52px (ratio ~3.7, ~14x en surface) : nettement plus
// contrasté que l'ancien 24px → 52px (ratio ~2, ~4.7x), hérité d'une époque
// où RAYON_MIN devait lui-même garantir une cible tactile correcte — ce
// n'est plus le cas depuis poserTailleMarqueur().
const RAYON_MIN = 7;
const RAYON_MAX = 26;

// Cible tactile minimale (repère Apple/Google), indépendante de la taille
// visuelle du marqueur (cercle proportionnel, losange gîte, rond parking) —
// un petit cercle proportionnel doit rester facile à taper du doigt.
const CIBLE_TACTILE_MIN = 44;

// Seuil de zoom en dessous duquel les falaises sont simplifiées en petit
// point uniforme (voir appliquerSimplificationZoom dans initCarte) — à
// ajuster après un premier test réel sur le terrain.
const ZOOM_SIMPLIFICATION = 13;

// Pose la taille d'un marqueur : la zone tactile (el, l'élément externe posé
// par MapLibre) fait au moins CIBLE_TACTILE_MIN, le disque/losange visuel
// (visuel, l'enfant centré dedans) garde sa vraie taille, potentiellement
// plus petite.
function poserTailleMarqueur(el, visuel, diametre) {
  const cote = Math.max(CIBLE_TACTILE_MIN, diametre);
  el.style.width = cote + 'px';
  el.style.height = cote + 'px';
  visuel.style.width = diametre + 'px';
  visuel.style.height = diametre + 'px';
}

// Contrôle MapLibre custom (interface IControl : onAdd/onRemove) pour le
// bouton "Tout voir" — s'empile proprement avec NavigationControl dans le
// même coin via l'API native, sans positionnement en dur à ajuster à l'œil.
function creerControleToutVoir(onClick) {
  return {
    onAdd() {
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.className = 'btn-tout-voir';
      bouton.setAttribute('aria-label', "Revenir à la vue d'ensemble");
      bouton.textContent = 'Tout voir';
      bouton.addEventListener('click', onClick);
      this._conteneur = document.createElement('div');
      this._conteneur.className = 'maplibregl-ctrl';
      this._conteneur.appendChild(bouton);
      return this._conteneur;
    },
    onRemove() {
      this._conteneur.remove();
    },
  };
}

function initCarte(dataUrl) {
  // --- Style de fond : OpenFreeMap (vecteur, libre, gratuit, sans clé) ---
  // Pour passer en offline total : générer un fichier .pmtiles pour la zone
  // (voir README) puis remplacer l'URL du style ci-dessous par une source
  // "raster"/"vector" pointant vers pmtiles://./tuiles.pmtiles
  const map = new maplibregl.Map({
    container: 'map',
    // "positron" (fond neutre, peu de POI/labels) plutôt que "liberty" (style
    // généraliste chargé) : le fond doit rester discret pour que les
    // marqueurs falaise/parking/gîte restent la figure dominante (principe
    // figure-fond) — et un style plus simple charge/peint aussi plus vite.
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: [5.03, 44.74],
    zoom: 12,
    attributionControl: false,
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  // Contrôle "Tout voir" ajouté via l'API de contrôles MapLibre (pas un
  // bouton positionné en absolu à la main) : la carte gère elle-même
  // l'empilement des contrôles partageant un coin, donc pas de collision
  // possible avec NavigationControl au-dessus, quelle que soit sa hauteur
  // réelle (icônes zoom+boussole, variable selon les options).
  map.addControl(creerControleToutVoir(() => {
    if (borneGlobale) map.fitBounds(borneGlobale, { padding: MARGE_UI, maxZoom: 15 });
    // "Vue d'ensemble" signifie repartir à zéro : aucune sélection ni
    // recherche active — sinon la caméra revient mais les marqueurs restent
    // restreints, contradiction avec "tout voir".
    falaiseSelectionneeCle = null;
    reinitialiserRecherche();
    appliquerFiltres(entries, filtres, modeFigureActuel, falaiseSelectionneeCle);
  }), 'top-right');

  // Le contrôle d'attribution démarre parfois "déplié" (classe posée avant que
  // notre config compact ne s'applique pleinement) — on force l'état replié
  // une fois la carte chargée, sans empêcher l'utilisateur de le rouvrir ensuite.
  map.on('load', () => {
    const attrib = document.querySelector('.maplibregl-ctrl-attrib');
    if (attrib) attrib.classList.remove('maplibregl-compact-show');
  });

  const entries = []; // { marker, cat, nom, secteur, cle, recherche, parkingAssocie, nbVoies, nbFaciles, nbGrandeVoie, nbCouenne }
  const index = new Map(); // cle -> entree, pour naviguer vers un marqueur lié
  const filtres = { recherche: '' };
  let modeFigureActuel = 'aucun'; // mode courant du sélecteur "Cercles" — voir appliquerFiltres()
  let falaiseSelectionneeCle = null; // falaise dont la popup est ouverte (ou origine/cible d'une navigation) — voir appliquerFiltres()

  // Déclarés tôt (référencés par allerVers/reinitialiserRecherche ci-dessous,
  // câblés plus bas dans la fonction).
  const recherche = document.querySelector('.recherche input');
  const btnCentrer = document.querySelector('.btn-centrer');
  const btnEffacer = document.querySelector('.btn-effacer');

  // Remet la recherche à zéro (texte, filtre, boutons dépendants) — utilisé
  // par allerVers() et par "Tout voir", qui doivent tous les deux repartir
  // d'un état neutre.
  function reinitialiserRecherche() {
    filtres.recherche = '';
    if (recherche) recherche.value = '';
    if (btnCentrer) btnCentrer.disabled = true;
    if (btnEffacer) btnEffacer.hidden = true;
  }
  let borneGlobale = null; // étendue de tous les marqueurs, pour le bouton "Tout voir"
  let maxima = { total: 0, couenne: 0, gv: 0 }; // pour la taille des cercles proportionnels

  // Ne garde en pleine opacité que les marqueurs de "cles" (estompe les
  // autres) ; cles=null remet tout le monde à l'opacité normale (popup fermée).
  function enSurbrillance(cles) {
    const actifs = cles ? new Set(cles) : null;
    entries.forEach((e) => {
      e.marker.getElement().style.opacity = (!actifs || actifs.has(e.cle)) ? '1' : '0.25';
    });
  }

  // Change la falaise "active" (popup ouverte) : ses parkings associés
  // deviennent pertinents (voir appliquerFiltres, les parkings sont masqués
  // par défaut — on cherche d'abord le secteur, le parking en découle).
  function definirFalaiseSelectionnee(cle) {
    falaiseSelectionneeCle = cle;
    appliquerFiltres(entries, filtres, modeFigureActuel, falaiseSelectionneeCle);
  }

  // Garde la trace de la popup actuellement ouverte, uniquement pour la
  // fermer via la touche Échap (au clavier, absence d'équivalent au clic
  // ailleurs sur la carte que MapLibre gère déjà nativement).
  let popupOuverte = null;
  function suivrePopup(popup, ouverte) {
    popupOuverte = ouverte ? popup : (popupOuverte === popup ? null : popupOuverte);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popupOuverte) popupOuverte.remove();
  });

  // Simplifie TOUS les marqueurs en petit point uniforme sous
  // ZOOM_SIMPLIFICATION (vue d'ensemble) : à cette échelle, les cercles
  // proportionnels se chevauchent trop entre eux pour rester lisibles
  // (certains sommets ont leurs secteurs à quelques dizaines de mètres les
  // uns des autres). Les parkings/gîte suivent la même règle — un parking à
  // 22px à côté de falaises réduites à 7px jurerait visuellement, même si
  // eux n'ont pas de recouvrement à résoudre en soi. Restaurés dès qu'on
  // zoome sur un site — cf. .zoom-eloigne dans le CSS.
  let modeSimplifieActuel = null;
  function appliquerSimplificationZoom() {
    const simplifie = map.getZoom() < ZOOM_SIMPLIFICATION;
    if (simplifie === modeSimplifieActuel) return;
    modeSimplifieActuel = simplifie;
    entries.forEach((entree) => {
      entree.marker.getElement().classList.toggle('zoom-eloigne', simplifie);
    });
    rafraichirLegendeFalaises();
  }
  map.on('zoom', appliquerSimplificationZoom);

  // Reconstruit la mini-légende falaises selon le mode "Cercles" courant ET
  // l'état de simplification par zoom — sinon la légende continuerait de
  // montrer des cercles de référence à une échelle où seuls des points
  // uniformes sont réellement affichés (trompeur).
  function rafraichirLegendeFalaises() {
    const { max, median, titre, couleurs, remplissage } = infosLegendePourMode(modeFigureActuel, maxima);
    construireLegendeFalaises(max, median, titre, couleurs, remplissage, modeSimplifieActuel, maxima.total);
  }

  // Change le mode "Cercles" et redessine tout ce qui en dépend — utilisé
  // par le sélecteur lui-même ET par allerVers (voir plus bas) : naviguer
  // vers une falaise doit garantir qu'elle reste visible, quitte à sortir
  // d'un thème qui l'aurait masquée (voir estFalaiseVideDansMode).
  function definirModeFigure(nouveauMode) {
    modeFigureActuel = nouveauMode;
    if (selectFigure) selectFigure.value = nouveauMode;
    entries.forEach((entree) => {
      if (entree.cat === 'falaise') dessinerFalaise(entree, modeFigureActuel, maxima);
    });
    rafraichirLegendeFalaises();
  }

  // Navigue vers le marqueur "cle" (falaise ou parking lié depuis une popup),
  // en levant les filtres actifs si besoin pour garantir qu'il soit visible.
  // "origineCle" (facultatif) : la popup depuis laquelle on clique un lien
  // croisé — dans ce cas on cadre sur les DEUX points plutôt que de voler
  // uniquement vers la cible, pour garder la relation spatiale visible.
  // "conserverRecherche" (facultatif) : ne pas effacer le champ de recherche
  // — utilisé par centrerSurRecherche(), où la recherche vient de motiver
  // l'action elle-même (l'effacer serait perdre ce qu'on vient de taper).
  function allerVers(cle, origineCle, conserverRecherche) {
    const cible = index.get(cle);
    if (!cible) return;

    if (!conserverRecherche) reinitialiserRecherche();

    const origine = origineCle ? index.get(origineCle) : null;

    // Naviguer vers une falaise garantit qu'elle reste visible : si le mode
    // "Cercles" actif la masquerait (aucune donnée pour ce thème — voir
    // estFalaiseVideDansMode), on repasse sur "Voies" plutôt que de laisser
    // une popup s'ouvrir sans aucun figuré en dessous. Même vérification
    // pour l'origine d'un lien croisé (cas plus rare, mais même risque).
    const cibleSeraitMasquee = cible.cat === 'falaise' && estFalaiseVideDansMode(cible, modeFigureActuel);
    const origineSeraitMasquee = origine && origine.cat === 'falaise' && estFalaiseVideDansMode(origine, modeFigureActuel);
    if (cibleSeraitMasquee || origineSeraitMasquee) definirModeFigure('aucun');

    // Cible falaise -> elle devient la sélection (ses parkings deviennent
    // pertinents). Sinon (cible parking/gîte), on garde l'origine si c'est
    // une falaise (ex. lien "Parking" depuis une falaise) pour que son
    // parking reste visible ; sans ça le close de la popup d'origine (juste
    // avant cet appel, voir attachPopupActions) masquerait la cible qu'on
    // est justement en train de rejoindre.
    falaiseSelectionneeCle = cible.cat === 'falaise' ? cible.cle
      : (origine && origine.cat === 'falaise') ? origine.cle
      : null;
    appliquerFiltres(entries, filtres, modeFigureActuel, falaiseSelectionneeCle);

    if (origine) {
      const bounds = new maplibregl.LngLatBounds();
      bounds.extend(origine.marker.getLngLat());
      bounds.extend(cible.marker.getLngLat());
      map.fitBounds(bounds, { padding: MARGE_UI, maxZoom: 16 });
    } else {
      map.flyTo({ center: cible.marker.getLngLat(), zoom: Math.max(map.getZoom(), 15), padding: MARGE_UI });
    }

    cible.marker.togglePopup();
    enSurbrillance(origine ? [origine.cle, cible.cle] : [cible.cle]);
  }

  const etatChargement = document.getElementById('etat-chargement');

  fetch(dataUrl)
    .then(r => r.json())
    .then(geojson => {
      const parkingInfos = indexerParkingInfos(geojson);
      maxima = calculerMaxima(geojson);

      geojson.features.forEach(f => {
        const entree = addMarker(map, f, parkingInfos, maxima, allerVers, enSurbrillance, definirFalaiseSelectionnee, suivrePopup);
        entries.push(entree);
        index.set(entree.cle, entree);
      });

      // Clic sur un label de site : cadre sur l'étendue de toutes ses
      // falaises — pas de popup (ce n'est pas une entité unique), juste la
      // caméra. La recherche se réinitialise (même logique qu'allerVers :
      // une recherche active pourrait sinon masquer des falaises du site
      // qu'on vient justement de rejoindre) ; la sélection courante n'a pas
      // besoin d'être touchée, elle ne cache rien ici.
      ajouterLabelsSites(map, geojson, (site) => {
        const falaisesDuSite = geojson.features.filter(f =>
          f.properties.categorie === 'falaise' && f.properties.site === site
        );
        if (!falaisesDuSite.length) return;
        reinitialiserRecherche();
        appliquerFiltres(entries, filtres, modeFigureActuel, falaiseSelectionneeCle);
        const bounds = new maplibregl.LngLatBounds();
        falaisesDuSite.forEach(f => bounds.extend(f.geometry.coordinates));
        map.fitBounds(bounds, { padding: MARGE_UI, maxZoom: 16 });
      });
      appliquerSimplificationZoom();

      borneGlobale = fitToMarkers(map, geojson);
      remplirAutocompletion(geojson);
      // La légende initiale est déjà construite par appliquerSimplificationZoom()
      // ci-dessus (state changed depuis null au premier appel).

      // Les modes liés au type de voie (couenne / grande voie / répartition)
      // n'ont de sens que si au moins une falaise a nb_gv/nb_couenne
      // renseignés — sinon ces options restent masquées.
      const auMoinsUneAvecType = geojson.features.some(f =>
        f.properties.categorie === 'falaise' &&
        ((f.properties.nb_gv ?? 0) > 0 || (f.properties.nb_couenne ?? 0) > 0)
      );
      if (!auMoinsUneAvecType) {
        ['option-couenne', 'option-gv', 'option-type'].forEach((id) => {
          const opt = document.getElementById(id);
          if (opt) opt.remove();
        });
      }

      // La clé "Gîte" de la légende n'a de sens que si la sortie en a un.
      const aGite = geojson.features.some(f => f.properties.categorie === 'hébergement');
      if (!aGite) {
        const legendeGite = document.getElementById('legende-gite');
        if (legendeGite) legendeGite.remove();
      }

      appliquerFiltres(entries, filtres, modeFigureActuel, falaiseSelectionneeCle);
      if (etatChargement) etatChargement.remove();
    })
    .catch(err => {
      console.error('Erreur de chargement des données', err);
      if (etatChargement) {
        etatChargement.textContent = 'Impossible de charger les données de la sortie.';
        etatChargement.classList.add('erreur');
      }
    });

  // --- Recherche par nom (et secteur) ---
  if (recherche) {
    recherche.addEventListener('input', () => {
      filtres.recherche = recherche.value.trim().toLowerCase();
      appliquerFiltres(entries, filtres, modeFigureActuel, falaiseSelectionneeCle);
      if (btnCentrer) btnCentrer.disabled = !filtres.recherche;
      if (btnEffacer) btnEffacer.hidden = !recherche.value;
    });
    recherche.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        centrerSurRecherche();
      }
    });
  }

  // --- Effacer la recherche ---
  if (btnEffacer) {
    btnEffacer.addEventListener('click', () => {
      reinitialiserRecherche();
      appliquerFiltres(entries, filtres, modeFigureActuel, falaiseSelectionneeCle);
      if (recherche) recherche.focus();
    });
  }

  // --- Centrer sur le(s) résultat(s) de recherche ---
  // Action explicite (bouton ou Entrée), jamais automatique pendant la frappe :
  // on ne veut pas faire sauter la carte à chaque caractère tapé.
  function centrerSurRecherche() {
    const q = filtres.recherche;
    if (!q) return;
    const correspondances = entries.filter((e) => e.cat === 'falaise' && e.recherche.includes(q));
    if (!correspondances.length) return;

    if (correspondances.length === 1) {
      allerVers(correspondances[0].cle, undefined, true);
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    correspondances.forEach((e) => bounds.extend(e.marker.getLngLat()));
    map.fitBounds(bounds, { padding: MARGE_UI, maxZoom: 16 });
  }

  if (btnCentrer) {
    btnCentrer.disabled = true; // rien à centrer tant que le champ est vide
    btnCentrer.addEventListener('click', centrerSurRecherche);
  }

  // --- Repli/déploiement du panneau légende (fermé par défaut, cf. HTML) ---
  const legendeToggle = document.querySelector('.legende-toggle');
  const legendeContenu = document.getElementById('legende-contenu');
  if (legendeToggle && legendeContenu) {
    legendeToggle.addEventListener('click', () => {
      const vaOuvrir = legendeContenu.hidden;
      legendeContenu.hidden = !vaOuvrir;
      legendeToggle.setAttribute('aria-expanded', String(vaOuvrir));
      // Le texte porte l'état (repli/déploiement) — pas d'icône/chevron,
      // cohérent avec le reste du site (contrôles en texte mono sobre).
      legendeToggle.textContent = vaOuvrir ? 'Masquer' : 'Légende';
    });
  }

  // --- Sélecteur de figuré (cercles proportionnels) ---
  const selectFigure = document.getElementById('mode-figure');
  if (selectFigure) {
    selectFigure.addEventListener('change', () => {
      definirModeFigure(selectFigure.value);
      // Une falaise sans donnée pour ce thème disparaît (dessinerFalaise) —
      // son parking ne doit pas rester affiché seul, sans rien à proposer.
      appliquerFiltres(entries, filtres, modeFigureActuel, falaiseSelectionneeCle);
    });
  }
}

function appliquerFiltres(entries, filtres, mode, falaiseSelectionneeCle) {
  // Le mode "Cercles" masque les falaises vides pour ce thème
  // (estFalaiseVideDansMode) mais n'autorise PAS à lui seul l'affichage de
  // leurs parkings — sinon changer de thème réafficherait tous les parkings
  // d'un coup (le mode est un figuré, pas une recherche). Seuls deux
  // déclencheurs positifs autorisent des parkings :
  // - une recherche active (choix explicite) -> tous les parkings des
  //   falaises qui la passent ;
  // - la falaise sélectionnée (popup ouverte / cible d'une navigation), si
  //   elle reste effectivement visible sous le mode/la recherche courants.
  const parkingsAutorises = new Set();

  entries.forEach((entree) => {
    if (entree.cat !== 'falaise') return;
    const visible =
      (!filtres.recherche || entree.recherche.includes(filtres.recherche)) &&
      !estFalaiseVideDansMode(entree, mode);
    entree.marker.getElement().style.display = visible ? '' : 'none';
    if (visible && filtres.recherche) entree.parkingAssocie.forEach((nom) => parkingsAutorises.add(nom));
  });

  // La falaise sélectionnée ne compte que si elle est toujours effectivement
  // visible (recherche/mode compris, cf. display posé juste au-dessus) —
  // sinon son parking ne doit pas rester affiché seul, sans qu'aucune
  // falaise visible ne le justifie.
  if (falaiseSelectionneeCle) {
    const falaise = entries.find((e) => e.cat === 'falaise' && e.cle === falaiseSelectionneeCle);
    if (falaise && falaise.marker.getElement().style.display !== 'none') {
      falaise.parkingAssocie.forEach((nom) => parkingsAutorises.add(nom));
    }
  }

  // Masqués par défaut : visibles seulement si une recherche est active ou
  // si une falaise est sélectionnée.
  const montrerParkings = Boolean(filtres.recherche) || Boolean(falaiseSelectionneeCle);

  entries.forEach((entree) => {
    if (entree.cat !== 'parking') return;
    entree.marker.getElement().style.display = (montrerParkings && parkingsAutorises.has(entree.nom)) ? '' : 'none';
  });
}

function remplirAutocompletion(geojson) {
  const datalist = document.getElementById('falaises-liste');
  if (!datalist) return;
  const libelles = geojson.features
    .filter(f => f.properties.categorie === 'falaise')
    .map(f => libelleFalaise(f.properties))
    .sort((a, b) => a.localeCompare(b, 'fr'));
  datalist.innerHTML = libelles.map(txt => `<option value="${escapeHtml(txt)}"></option>`).join('');
}

// Le secteur n'est affiché/utilisé que s'il apporte une info distincte du nom
// (les falaises à secteur unique ont souvent secteur === nom dans les données).
function secteurDistinct(p) {
  return p.secteur && p.secteur !== p.nom ? p.secteur : null;
}

// Identifiant unique d'une falaise. Depuis l'ajout des secteurs, plusieurs
// features peuvent partager le même "nom" (un même sommet, plusieurs
// secteurs) — nom seul ne suffit plus, d'où nom+secteur quand ils diffèrent.
function cleFalaise(p) {
  const s = secteurDistinct(p);
  return s ? `${p.nom}::${s}` : p.nom;
}

// Texte affiché pour une falaise (titre de popup sur une ligne, autocomplétion,
// liens croisés) : "nom" seul, ou "nom · secteur" quand le secteur distingue.
function libelleFalaise(p) {
  const s = secteurDistinct(p);
  return s ? `${p.nom} · ${s}` : p.nom;
}

// Pour chaque parking : les falaises (secteurs) qui le référencent — clé,
// sommet (nom) et secteur distinct séparément (pour pouvoir les regrouper
// par sommet dans la popup, voir champLiensFalaises) — et l'ensemble des
// "site" de ces falaises, pour le badge affiché sur la popup parking.
function indexerParkingInfos(geojson) {
  const infos = new Map();
  geojson.features.forEach(f => {
    const p = f.properties;
    if (p.categorie !== 'falaise' || !p.parking_associe) return;
    const cle = cleFalaise(p);
    const secteur = secteurDistinct(p);
    p.parking_associe.split('|').map(s => s.trim()).filter(Boolean).forEach(nomParking => {
      if (!infos.has(nomParking)) infos.set(nomParking, { falaises: [], sites: new Set() });
      const info = infos.get(nomParking);
      info.falaises.push({ cle, nom: p.nom, secteur });
      if (p.site) info.sites.add(p.site);
    });
  });
  return infos;
}

function calculerMaxima(geojson) {
  const totaux = [], couennes = [], gvs = [], faciles = [];
  geojson.features.forEach(f => {
    if (f.properties.categorie !== 'falaise') return;
    const p = f.properties;
    totaux.push(p.nb_voies || 0);
    couennes.push(p.nb_couenne || 0);
    gvs.push(p.nb_gv || 0);
    faciles.push((p.nb_voies_cot5 || 0) + (p.nb_voies_cot6a || 0));
  });
  return {
    total: Math.max(0, ...totaux), totalMedian: mediane(totaux),
    couenne: Math.max(0, ...couennes), couenneMedian: mediane(couennes),
    gv: Math.max(0, ...gvs), gvMedian: mediane(gvs),
    faciles: Math.max(0, ...faciles), facilesMedian: mediane(faciles),
  };
}

function mediane(valeurs) {
  const tri = [...valeurs].sort((a, b) => a - b);
  const n = tri.length;
  if (!n) return 0;
  const milieu = Math.floor(n / 2);
  return n % 2 ? tri[milieu] : Math.round((tri[milieu - 1] + tri[milieu]) / 2);
}

// Remplissage représentatif d'un mode (couleur unie, ou un dégradé 50/50
// pour "type" — il n'y a pas de répartition "typique" à représenter, un
// exemple neutre suffit). Utilisée à la fois par dessinerFalaise() pour les
// vrais marqueurs ET par construireLegendeFalaises() pour les cercles de
// référence : une seule source de vérité, sinon la légende peut afficher une
// couleur différente de ce qui est réellement sur la carte.
function remplissagePourMode(mode) {
  if (mode === 'couenne') return 'var(--couenne)';
  if (mode === 'gv') return 'var(--gv)';
  if (mode === 'faciles') return 'var(--forest)'; // vert = facile, convention courante en sports outdoor
  if (mode === 'type') return 'conic-gradient(var(--gv) 0% 50%, var(--couenne) 50% 100%)';
  return 'var(--clay)';
}

// Quelle grandeur (max + médiane) affiche la mini-légende selon le mode
// courant, plus la clé de couleurs quand le remplissage encode une variable
// catégorielle (mode "type" : conic-gradient grande voie/couenne) — sans ça
// rien n'indique quelle couleur correspond à quelle catégorie.
function infosLegendePourMode(mode, maxima) {
  const remplissage = remplissagePourMode(mode);
  if (mode === 'couenne') return { max: maxima.couenne, median: maxima.couenneMedian, titre: 'Falaises (couenne)', remplissage };
  if (mode === 'gv') return { max: maxima.gv, median: maxima.gvMedian, titre: 'Falaises (grande voie)', remplissage };
  if (mode === 'faciles') return { max: maxima.faciles, median: maxima.facilesMedian, titre: 'Falaises (voies 5-6a+)', remplissage };
  if (mode === 'type') return {
    max: maxima.total, median: maxima.totalMedian, titre: 'Falaises (voies)', remplissage,
    couleurs: [{ nom: 'Grande voie', variable: '--gv' }, { nom: 'Couenne', variable: '--couenne' }],
  };
  return { max: maxima.total, median: maxima.totalMedian, titre: 'Falaises (voies)', remplissage };
}

function addMarker(map, feature, parkingInfos, maxima, allerVers, enSurbrillance, onSelectionFalaise, suivrePopup) {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;
  const cat = p.categorie;
  const cle = cat === 'falaise' ? cleFalaise(p) : p.nom;
  const parkingAssocie = cat === 'falaise'
    ? (p.parking_associe || '').split('|').map(s => s.trim()).filter(Boolean)
    : [];

  // "el" est la zone tactile (taille garantie par poserTailleMarqueur, voir
  // plus bas) — MapLibre réécrit intégralement son style.transform à chaque
  // repositionnement, donc AUCUN style visuel dépendant d'un transform (la
  // rotation du losange gîte) ne doit vivre ici, seulement sur "visuel".
  const el = document.createElement('div');
  el.className = 'marqueur marqueur-' + cat;

  // Accessibilité : un <div> seul n'est ni focusable ni annoncé par un
  // lecteur d'écran — sans ça les marqueurs ne sont atteignables qu'à la
  // souris/au doigt.
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  const etiquette = cat === 'falaise' ? `Falaise : ${libelleFalaise(p)}`
    : cat === 'parking' ? `Parking : ${p.nom}`
    : `Gîte : ${p.nom}`;
  el.setAttribute('aria-label', etiquette);

  const visuel = document.createElement('div');
  visuel.className = 'marqueur-visuel';
  el.appendChild(visuel);

  if (cat === 'hébergement') {
    poserTailleMarqueur(el, visuel, 16);
    visuel.style.background = 'var(--ink)';
    visuel.style.transform = 'rotate(45deg)'; // losange : se distingue des ronds falaise/parking
  } else if (cat === 'parking') {
    poserTailleMarqueur(el, visuel, 22);
    visuel.style.borderRadius = '50%';
    visuel.style.background = 'var(--teal)';
  } else {
    visuel.style.borderRadius = '50%'; // taille + couleur posées par dessinerFalaise() ci-dessous
  }

  const popupHtml =
    cat === 'falaise' ? popupFalaise(p, lat, lon) :
    cat === 'parking' ? popupParking(p, lat, lon, parkingInfos) :
    popupGite(p, lat, lon);

  // closeOnClick (par défaut, true) : ferme la popup ouverte au clic
  // ailleurs sur la carte, y compris sur un autre marqueur — comportement
  // volontairement gardé (voir suivrePopup plus bas pour Échap) : la
  // fermeture ne touche plus falaiseSelectionneeCle, donc plus de risque de
  // masquer par erreur le parking qu'on vient de rejoindre.
  const popup = new maplibregl.Popup({ offset: 14 }).setHTML(popupHtml);

  const marker = new maplibregl.Marker({ element: el })
    .setLngLat([lon, lat])
    .setPopup(popup)
    .addTo(map);

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      marker.togglePopup();
    }
  });

  popup.on('open', () => {
    if (suivrePopup) suivrePopup(popup, true);
    document.body.classList.add('fiche-ouverte');
    attachPopupActions(popup, lat, lon, allerVers, cle);
    // La mise en surbrillance suit la relation falaise<->parking dans les
    // deux sens : sélectionner l'un éclaire l'autre, cohérent et symétrique.
    if (cat === 'falaise') {
      if (onSelectionFalaise) onSelectionFalaise(cle);
      enSurbrillance([cle, ...parkingAssocie]);
    } else if (cat === 'parking') {
      const info = parkingInfos.get(p.nom);
      enSurbrillance([cle, ...(info ? info.falaises.map(f => f.cle) : [])]);
    } else {
      enSurbrillance([cle]);
    }
  });
  popup.on('close', () => {
    if (suivrePopup) suivrePopup(popup, false);
    document.body.classList.remove('fiche-ouverte');
    enSurbrillance(null);
    // La sélection (falaiseSelectionneeCle) n'est PAS effacée ici : fermer
    // une fiche (× ou clic sur un autre marqueur) garde le parking associé
    // à la dernière falaise choisie visible, plutôt que de tout re-masquer
    // aussitôt. Seuls "Tout voir" ou le choix d'une NOUVELLE falaise (voir
    // onSelectionFalaise à l'ouverture) réinitialisent la sélection.
    // La feuille du bas mobile peut avoir été réduite (poignée) : repartir
    // dépliée à la prochaine ouverture, sinon l'état fuiterait d'une fiche
    // à l'autre (le conteneur DOM persiste entre ouvertures/fermetures).
    // getElement() peut renvoyer undefined ici (conteneur déjà détruit par
    // remove() au moment où 'close' se déclenche) — d'où la garde.
    const elPopup = popup.getElement();
    const contenu = elPopup && elPopup.querySelector('.maplibregl-popup-content');
    if (contenu) contenu.classList.remove('fiche-reduite');
  });

  const cot5 = p.nb_voies_cot5 ?? 0;
  const cot6a = p.nb_voies_cot6a ?? 0;
  const secteur = cat === 'falaise' ? secteurDistinct(p) : null;
  const rechercheTexte = cat === 'falaise' ? libelleFalaise(p).toLowerCase() : p.nom.toLowerCase();

  const entree = {
    marker, cat, nom: p.nom, secteur, cle, recherche: rechercheTexte,
    parkingAssocie,
    nbVoies: p.nb_voies ?? 0,
    nbFaciles: cot5 + cot6a,
    nbGrandeVoie: p.nb_gv ?? 0,
    nbCouenne: p.nb_couenne ?? 0,
  };

  if (cat === 'falaise') dessinerFalaise(entree, 'aucun', maxima);

  return entree;
}

// Rayon proportionnel à la valeur (donc à la surface, pas au rayon, comme la
// racine carrée classique) — mais avec la correction de Flannery : James
// Flannery (1971) a montré empiriquement que les lecteurs de carte
// sous-estiment perceptuellement la taille des grands cercles par rapport
// aux petits sous un exposant 0.5 strict. Son exposant empirique (0.5716)
// accentue légèrement l'écart entre petites et grandes valeurs pour mieux
// correspondre à la perception réelle.
const EXPOSANT_FLANNERY = 0.5716;

function calculerRayon(valeur, max) {
  if (!max) return RAYON_MIN;
  return RAYON_MIN + (RAYON_MAX - RAYON_MIN) * Math.pow((valeur || 0) / max, EXPOSANT_FLANNERY);
}

// Redessine une falaise selon le mode choisi dans le sélecteur "Cercles".
// La taille encode toujours UNE seule grandeur quantitative à la fois (cf.
// sémiologie graphique) — laquelle dépend du mode : nb_voies total, ou
// nb_couenne/nb_gv/nb_voies en 5-6a+ seuls quand on veut comparer
// spécifiquement une sous-catégorie entre falaises (comptage brut, pas une
// proportion — plus lisible et plus actionnable pour la logistique que "part
// de voies faciles", qui masquait la taille réelle du secteur). Le
// remplissage suit la même logique : uni / teinte dédiée par sous-catégorie
// / teinte répartie (grande voie-couenne, catégorielle donc couleur, pas
// taille).
// En mode thématique (tout sauf "aucun"), une falaise sans donnée pour la
// grandeur affichée (0 ou absente) n'a rien à montrer sur ce thème : un
// petit cercle laisserait croire à une petite quantité plutôt qu'à une
// absence. Utilisée à la fois pour masquer le marqueur (dessinerFalaise) et
// pour exclure ces falaises de la cascade de visibilité des parkings
// (appliquerFiltres) — sinon un parking reste affiché seul, sans qu'aucune
// falaise visible ne justifie sa présence sur ce thème.
function estFalaiseVideDansMode(entree, mode) {
  if (mode === 'type') return (entree.nbGrandeVoie + entree.nbCouenne) === 0;
  if (mode === 'couenne') return !entree.nbCouenne;
  if (mode === 'gv') return !entree.nbGrandeVoie;
  if (mode === 'faciles') return !entree.nbFaciles;
  return false;
}

function dessinerFalaise(entree, mode, maxima) {
  const el = entree.marker.getElement();
  const visuel = el.querySelector('.marqueur-visuel');

  const valeur = mode === 'couenne' ? entree.nbCouenne
    : mode === 'gv' ? entree.nbGrandeVoie
    : mode === 'faciles' ? entree.nbFaciles
    : entree.nbVoies;

  const estVide = estFalaiseVideDansMode(entree, mode);
  el.classList.toggle('marqueur-invisible', estVide); // cache la cible tactile entière
  if (estVide) return;

  // Échelle commune à tous les modes (maxima.total, jamais le max du thème
  // affiché) : une même falaise garde une taille comparable d'un mode à
  // l'autre. Contrepartie assumée pour un thème peu présent au global (ex.
  // grande voie) : même sa meilleure falaise reste visuellement modeste —
  // c'est une lecture honnête ("peu présent ici"), pas un défaut.
  const rayon = calculerRayon(valeur, maxima.total);
  poserTailleMarqueur(el, visuel, rayon * 2);

  if (mode === 'type') {
    const pctGV = Math.round((entree.nbGrandeVoie / (entree.nbGrandeVoie + entree.nbCouenne)) * 100);
    visuel.style.background = `conic-gradient(var(--gv) 0% ${pctGV}%, var(--couenne) ${pctGV}% 100%)`;
  } else {
    visuel.style.background = remplissagePourMode(mode);
  }
}

// Mini-légende à cercles de référence (min / médiane / max de la grandeur
// affichée — 3 repères, pas 2, pour pouvoir interpoler une valeur intermédiaire
// à l'œil), convention standard pour une carte à symboles proportionnels.
// Le rayon de chaque repère passe par calculerRayon(), la même formule que
// pour les marqueurs réels : sinon le repère "1" ne correspondrait pas à la
// taille qu'aurait une vraie falaise à 1 voie sur la carte.
function construireLegendeFalaises(max, median, titre, couleurs, remplissage, simplifie, echelle) {
  // Chip(s) de catégorie "Falaises" (à côté de Parkings/Gîte dans
  // .legende-cats). Cas normal : une seule pastille "Falaises", couleur du
  // mode actif. Mode "Type de voie" : le remplissage réel est un dégradé à
  // deux teintes propre à CHAQUE falaise (sa répartition grande voie/couenne),
  // qu'une seule pastille ne peut pas représenter honnêtement — on affiche
  // alors les deux catégories séparément (couleurs vient d'infosLegendePourMode).
  // Remplace l'ancien double affichage (une pastille "Falaises" ET une clé
  // couleurs séparée plus bas) qui montrait 3 couleurs pour 2 informations.
  const zoneFalaises = document.getElementById('cle-falaises-zone');
  if (zoneFalaises) {
    zoneFalaises.innerHTML = (couleurs && couleurs.length)
      ? couleurs.map(c => `<span class="cle"><span class="dot" style="background:var(${c.variable})"></span> ${escapeHtml(c.nom)}</span>`).join('')
      : `<span class="cle"><span class="dot" style="background:${remplissage}"></span> Falaises</span>`;
  }

  const conteneur = document.getElementById('legende-falaises');
  if (!conteneur) return;
  if (!max) { conteneur.innerHTML = ''; return; }
  // Sous ZOOM_SIMPLIFICATION, les falaises sont de petits points uniformes
  // (voir .zoom-eloigne) : des cercles de référence proportionnels seraient
  // trompeurs puisque rien de tel n'est réellement affiché à cette échelle.
  if (simplifie) {
    conteneur.innerHTML = `
      <span class="legende-titre">Falaises</span>
      <span class="legende-note">Zoomez pour voir la taille proportionnelle</span>`;
    return;
  }
  // "max"/"median" restent propres au thème affiché (1/médiane/max réels de
  // ce thème, pour des repères parlants) — mais leur RAYON se calcule sur
  // "echelle" (toujours maxima.total) : même une falaise au max de son
  // thème peut donc rester visuellement modeste si ce thème est peu présent
  // au global (ex. grande voie) — cohérent avec dessinerFalaise().
  const repere = (valeur) => `
    <span class="repere-taille">
      <span class="cercle-repere" style="width:${calculerRayon(valeur, echelle) * 2}px; height:${calculerRayon(valeur, echelle) * 2}px;"></span>
      <span>${valeur}</span>
    </span>`;
  const valeurs = (median > 0 && median < max) ? [1, median, max] : [1, max];
  conteneur.innerHTML = `
    <span class="legende-titre">${escapeHtml(titre)}</span>
    <div class="reperes-taille">
      ${valeurs.map(repere).join('')}
    </div>`;
}

function popupFalaise(p, lat, lon) {
  const rows = [];
  if (p.type_roche) rows.push(champ('Roche', p.type_roche));
  if (p.orientation) rows.push(champ('Orientation', p.orientation.replaceAll('|', ' / ')));
  if (p.cotation_min || p.cotation_max) {
    rows.push(champCotation(p.cotation_min, p.cotation_max));
  }
  if (p.nb_voies) {
    const cot5 = p.nb_voies_cot5 ?? 0;
    const cot6a = p.nb_voies_cot6a ?? 0;
    rows.push(champVoies(p.nb_voies, cot5, cot6a));
  }
  if (p.parking_associe) {
    const noms = p.parking_associe.split('|').map(s => s.trim()).filter(Boolean);
    rows.push(champLiens('Parking', noms));
  }
  if (p.approche_min) rows.push(champ('Approche', `${p.approche_min} min` + (p.approche_metre ? ` (${p.approche_metre} m)` : '')));

  const secteur = secteurDistinct(p);

  return `
    <div class="popup">
      <button type="button" class="poignee-fiche" aria-expanded="true" aria-label="Réduire la fiche"></button>
      <span class="cat-tag falaise">Falaise</span>
      <h3>${escapeHtml(p.nom)}</h3>
      ${secteur ? `<p class="sous-titre">${escapeHtml(secteur)}</p>` : ''}
      <dl>${rows.join('')}</dl>
      <div class="actions">
        <a class="btn btn-primary" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}" target="_blank" rel="noopener">Itinéraire</a>
        <button class="btn-copy" data-lat="${lat}" data-lon="${lon}">Copier coordonnées</button>
        <a class="btn" href="geo:${lat},${lon}">Ouvrir dans Maps</a>
        ${p.lien_oblyk ? `<a class="btn" href="${escapeHtml(p.lien_oblyk)}" target="_blank" rel="noopener">Voir sur Oblyk</a>` : ''}
      </div>
    </div>`;
}

function popupParking(p, lat, lon, parkingInfos) {
  const rows = [];
  if (p.trajet_gite_min) rows.push(champ('Depuis le gîte', `${p.trajet_gite_min} min en voiture`));

  const info = parkingInfos.get(p.nom);
  if (info && info.falaises.length) {
    rows.push(champLiensFalaises(info.falaises));
  }
  const site = info && info.sites.size ? Array.from(info.sites).join(' / ') : '';

  return `
    <div class="popup">
      <button type="button" class="poignee-fiche" aria-expanded="true" aria-label="Réduire la fiche"></button>
      <span class="cat-tag parking">Parking</span>
      ${site ? `<span class="badge-site">${escapeHtml(site)}</span>` : ''}
      <h3>${escapeHtml(p.nom)}</h3>
      <dl>${rows.join('')}</dl>
      <div class="actions">
        <a class="btn btn-primary" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}" target="_blank" rel="noopener">Itinéraire</a>
        <button class="btn-copy" data-lat="${lat}" data-lon="${lon}">Copier coordonnées</button>
        <a class="btn" href="geo:${lat},${lon}">Ouvrir dans Maps</a>
      </div>
    </div>`;
}

function popupGite(p, lat, lon) {
  return `
    <div class="popup">
      <button type="button" class="poignee-fiche" aria-expanded="true" aria-label="Réduire la fiche"></button>
      <span class="cat-tag gite">Gîte</span>
      <h3>${escapeHtml(p.nom)}</h3>
      <div class="actions">
        <a class="btn btn-primary" href="geo:${lat},${lon}">Ouvrir dans Maps</a>
        <button class="btn-copy" data-lat="${lat}" data-lon="${lon}">Copier coordonnées</button>
      </div>
    </div>`;
}

function champ(label, valeur) {
  return `<dt>${label}</dt><dd>${escapeHtml(String(valeur))}</dd>`;
}

// Comme champ(), mais chaque valeur devient un bouton qui navigue vers le
// marqueur correspondant (voir allerVers dans initCarte). Cas simple : une
// liste de noms déjà uniques (les parkings référencés depuis une falaise —
// une falaise n'a jamais qu'une poignée de parkings, pas de regroupement
// nécessaire ici, contrairement à champLiensFalaises ci-dessous).
function champLiens(label, noms) {
  const liens = noms
    .map(nom => `<button type="button" class="lien-secteur" data-nom="${escapeHtml(nom)}">${escapeHtml(nom)}</button>`)
    .join(' · ');
  return `<dt>${label}</dt><dd>${liens}</dd>`;
}

// Liste des falaises desservies par un parking, regroupées par sommet (nom).
// Un même sommet peut apporter jusqu'à une dizaine de secteurs (vu en
// pratique) : un bouton par secteur qui répète à chaque fois le nom du
// sommet devient un mur illisible. On affiche donc le nom une seule fois en
// en-tête de groupe, seulement s'il y a plus d'un sommet desservi (avec un
// seul sommet, le badge de site au-dessus de la popup le montre déjà).
function champLiensFalaises(falaises) {
  const parNom = new Map();
  falaises.forEach(f => {
    if (!parNom.has(f.nom)) parNom.set(f.nom, []);
    parNom.get(f.nom).push(f);
  });

  const bouton = (f, texte) => `<button type="button" class="lien-secteur" data-nom="${escapeHtml(f.cle)}">${escapeHtml(texte)}</button>`;

  const groupes = Array.from(parNom.entries()).map(([nom, items]) => {
    const liens = items.map(f => bouton(f, f.secteur || nom)).join(' · ');
    const seulUnSommet = parNom.size === 1;
    const seulSecteurEtSansNomDistinct = items.length === 1 && !items[0].secteur;
    const afficherEntete = !seulUnSommet && !seulSecteurEtSansNomDistinct;
    return afficherEntete
      ? `<div class="groupe-falaises"><span class="nom-falaise">${escapeHtml(nom)}</span>${liens}</div>`
      : `<div class="groupe-falaises">${liens}</div>`;
  }).join('');

  return `<dt>Falaises</dt><dd>${groupes}</dd>`;
}

// nb_voies_cot5/cot6a ne couvrent que les grades 5 et 6a-6a+ : il peut y avoir
// des voies encore plus faciles (3, 4) non comptées ailleurs. Le solde de la
// barre n'est donc pas forcément "plus dur" — on le laisse muet, sans légende.
function champVoies(total, cot5, cot6a) {
  const barre = (cot5 || cot6a) ? barreCotations(total, cot5, cot6a) : '';
  return `<dt>Voies sportives</dt><dd>${total} au total${barre}</dd>`;
}

function barreCotations(total, cot5, cot6a) {
  const pct = (n) => Math.round((n / total) * 1000) / 10;
  const reste = Math.max(0, 100 - pct(cot5) - pct(cot6a));

  return `
    <div class="barre-cotations" role="img" aria-label="${cot5} voies en 5, ${cot6a} en 6a/6a+, sur ${total} voies au total">
      <span class="segment segment-5" style="width:${pct(cot5)}%"></span>
      <span class="segment segment-6a" style="width:${pct(cot6a)}%"></span>
      <span class="segment segment-reste" style="width:${reste}%"></span>
    </div>
    <span class="legende-barre">dont ${cot5} en 5 · ${cot6a} en 6a/6a+</span>`;
}

// Cotation française -> position numérique continue sur une échelle 3a→9c+
// (0 à 20.5), pour placer la jauge min→max. Repli silencieux (jauge omise)
// si le texte ne correspond pas au format attendu.
function cotationVersValeur(cotation) {
  if (!cotation) return null;
  const m = /^(\d)([abc])(\+)?$/.exec(String(cotation).trim());
  if (!m) return null;
  const chiffre = Number(m[1]);
  const lettre = { a: 0, b: 1, c: 2 }[m[2]];
  const plus = m[3] ? 0.5 : 0;
  return (chiffre - 3) * 3 + lettre + plus;
}

const COTATION_ECHELLE_MAX = 21; // couvre jusqu'à 9c+
const COTATION_LABEL_MIN = '3a';
const COTATION_LABEL_MAX = '9c+';

// Bornes d'échelle affichées de part et d'autre de la jauge : sans elles, le
// segment coloré n'a aucun repère et sa position/largeur n'est pas décodable.
function jaugeCotation(min, max) {
  const vMin = cotationVersValeur(min);
  const vMax = cotationVersValeur(max);
  if (vMin == null || vMax == null) return '';
  const debut = (vMin / COTATION_ECHELLE_MAX) * 100;
  const largeur = Math.max(((vMax - vMin) / COTATION_ECHELLE_MAX) * 100, 3);
  return `
    <div class="jauge-cotation" role="img" aria-label="Cotation de ${escapeHtml(min)} à ${escapeHtml(max)} sur l'échelle ${COTATION_LABEL_MIN} à ${COTATION_LABEL_MAX}">
      <span class="jauge-segment" style="left:${debut}%; width:${largeur}%"></span>
    </div>
    <div class="jauge-echelle"><span>${COTATION_LABEL_MIN}</span><span>${COTATION_LABEL_MAX}</span></div>`;
}

function champCotation(min, max) {
  const jauge = jaugeCotation(min, max);
  return `<dt>Cotation</dt><dd>${escapeHtml(min ?? '?')} → ${escapeHtml(max ?? '?')}${jauge}</dd>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function attachPopupActions(popup, lat, lon, allerVers, origineCle) {
  const el = popup.getElement();

  // Poignée de la feuille du bas mobile : replie/déplie entre une hauteur
  // "aperçu" et la hauteur normale (voir .fiche-reduite dans le CSS).
  const poignee = el.querySelector('.poignee-fiche');
  const contenu = el.querySelector('.maplibregl-popup-content');
  if (poignee && contenu) {
    poignee.addEventListener('click', () => {
      const reduite = contenu.classList.toggle('fiche-reduite');
      poignee.setAttribute('aria-expanded', String(!reduite));
      poignee.setAttribute('aria-label', reduite ? 'Déplier la fiche' : 'Réduire la fiche');
    });
  }

  const btnCopy = el.querySelector('.btn-copy');
  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      const coords = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
      navigator.clipboard.writeText(coords).then(() => {
        btnCopy.textContent = 'Copié !';
        btnCopy.classList.add('copied');
        setTimeout(() => {
          btnCopy.textContent = 'Copier coordonnées';
          btnCopy.classList.remove('copied');
        }, 1500);
      });
    });
  }

  el.querySelectorAll('.lien-secteur').forEach(btn => {
    btn.addEventListener('click', () => {
      popup.remove();
      allerVers(btn.dataset.nom, origineCle);
    });
  });
}

// Un point par "site" distinct (centroïde de ses falaises, pas la 1ʳᵉ
// feature — certains sites s'étalent sur ~2km, un centroïde est nettement
// mieux placé) — sert de source aux labels ajoutés ci-dessous.
function construireGeojsonSites(geojson) {
  const groupes = new Map();
  geojson.features.forEach(f => {
    const p = f.properties;
    if (p.categorie !== 'falaise' || !p.site) return;
    const [lon, lat] = f.geometry.coordinates;
    if (!groupes.has(p.site)) groupes.set(p.site, { sumLon: 0, sumLat: 0, n: 0 });
    const g = groupes.get(p.site);
    g.sumLon += lon; g.sumLat += lat; g.n += 1;
  });
  return {
    type: 'FeatureCollection',
    features: Array.from(groupes, ([site, g]) => ({
      type: 'Feature',
      properties: { site },
      geometry: { type: 'Point', coordinates: [g.sumLon / g.n, g.sumLat / g.n] },
    })),
  };
}

// Noms de site affichés par défaut, en marqueurs DOM (pas une couche GL,
// contrairement au premier jet) : une couche GL est TOUJOURS rendue sous les
// marqueurs/popups DOM (le canvas WebGL est une seule surface en dessous de
// la superposition DOM, par construction) — le texte disparaissait donc
// derrière un figuré ponctuel dès qu'il le chevauchait. En DOM, on récupère
// l'empilement standard : ajoutés après les marqueurs falaise/parking/gîte
// (voir l'appel dans initCarte), ils passent naturellement au-dessus.
// Contrepartie assumée : pas de moteur de décollision automatique entre eux
// (comme le ferait une couche GL) — un non-problème ici, seulement une
// dizaine de sites répartis sur tout le département.
//
// Cliquables (cadrage sur l'étendue du site, voir onClicSite) : ils
// redeviennent donc réceptifs aux clics, ce qui peut occasionnellement
// intercepter un clic destiné à un marqueur juste en dessous s'ils se
// chevauchent pile — accepté pour la même raison que ci-dessus (peu de
// sites, chevauchement pile au pixel près improbable en pratique).
function ajouterLabelsSites(map, geojson, onClicSite) {
  const sitesGeojson = construireGeojsonSites(geojson);
  sitesGeojson.features.forEach((f) => {
    const site = f.properties.site;
    const el = document.createElement('div');
    el.className = 'label-site';
    el.textContent = site;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', `Centrer sur ${site}`);
    const activer = () => onClicSite(site);
    el.addEventListener('click', activer);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activer();
      }
    });
    new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, 2] })
      .setLngLat(f.geometry.coordinates)
      .addTo(map);
  });
}

function fitToMarkers(map, geojson) {
  if (!geojson.features.length) return null;
  const bounds = new maplibregl.LngLatBounds();
  geojson.features.forEach(f => bounds.extend(f.geometry.coordinates));
  map.fitBounds(bounds, { padding: MARGE_UI, maxZoom: 15 });
  limiterZoneCarte(map, bounds);
  return bounds;
}

// Empêche de dériver la carte loin de la sortie (Allemagne, Asie...) en
// glissant/zoomant : verrouille le pan/zoom à une marge autour des marqueurs.
function limiterZoneCarte(map, bounds) {
  // Doit rester nettement plus large que ce que fitBounds+MARGE_UI affiche
  // réellement à l'écran (le padding en pixels "mange" une plus grande part
  // d'un viewport mobile étroit, donc la zone visible dépasse vite une marge
  // trop serrée) — sinon setMaxBounds force un zoom arrière... ou avant,
  // au-delà de ce que le cadrage avait calculé.
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const margeLng = (ne.lng - sw.lng) * 1.5 || 0.8;
  const margeLat = (ne.lat - sw.lat) * 1.5 || 0.8;
  map.setMaxBounds([
    [sw.lng - margeLng, sw.lat - margeLat],
    [ne.lng + margeLng, ne.lat + margeLat],
  ]);
}
