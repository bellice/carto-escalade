/* app.js — logique carte partagée par toutes les sorties.
   Chaque page sortie appelle initCarte(dataUrl) avec le chemin
   vers son propre data.geojson. */

// Réserve la place occupée par le header + la recherche (haut) et la légende
// (bas), pour qu'un marqueur centré ou un cadrage ajusté ne finisse pas
// caché dessous. Padding asymétrique passé à flyTo/fitBounds.
const MARGE_UI = { top: 120, bottom: 170, left: 70, right: 70 };

// Rayon min/max des cercles proportionnels (falaises). Le minimum garantit
// une cible tactile correcte (~24px de diamètre) même pour 0 voie.
const RAYON_MIN = 12;
const RAYON_MAX = 26;

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

  // Le contrôle d'attribution démarre parfois "déplié" (classe posée avant que
  // notre config compact ne s'applique pleinement) — on force l'état replié
  // une fois la carte chargée, sans empêcher l'utilisateur de le rouvrir ensuite.
  map.on('load', () => {
    const attrib = document.querySelector('.maplibregl-ctrl-attrib');
    if (attrib) attrib.classList.remove('maplibregl-compact-show');
  });

  const entries = []; // { marker, cat, nom, secteur, cle, recherche, parkingAssocie, trajetGiteMin, nbVoies, nbFaciles, nbGrandeVoie, nbCouenne }
  const index = new Map(); // cle -> entree, pour naviguer vers un marqueur lié
  const filtres = { gitesProche: false, recherche: '' };
  let modeFigureActuel = 'aucun'; // mode courant du sélecteur "Cercles" — voir appliquerFiltres()
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

  // Navigue vers le marqueur "cle" (falaise ou parking lié depuis une popup),
  // en levant les filtres actifs si besoin pour garantir qu'il soit visible.
  // "origineCle" (facultatif) : la popup depuis laquelle on clique un lien
  // croisé — dans ce cas on cadre sur les DEUX points plutôt que de voler
  // uniquement vers la cible, pour garder la relation spatiale visible.
  function allerVers(cle, origineCle) {
    const cible = index.get(cle);
    if (!cible) return;

    filtres.recherche = '';
    filtres.gitesProche = false;
    const champRecherche = document.querySelector('.recherche input');
    if (champRecherche) champRecherche.value = '';
    document.querySelectorAll('.legende input[data-filter]').forEach((cb) => { cb.checked = false; });
    appliquerFiltres(entries, filtres, modeFigureActuel);

    const origine = origineCle ? index.get(origineCle) : null;
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
        const entree = addMarker(map, f, parkingInfos, maxima, allerVers, enSurbrillance);
        entries.push(entree);
        index.set(entree.cle, entree);
      });

      borneGlobale = fitToMarkers(map, geojson);
      remplirAutocompletion(geojson);
      const initiale = infosLegendePourMode('aucun', maxima);
      construireLegendeFalaises(initiale.max, initiale.median, initiale.titre, initiale.couleurs, initiale.remplissage);

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

      appliquerFiltres(entries, filtres, modeFigureActuel);
      if (etatChargement) etatChargement.remove();
    })
    .catch(err => {
      console.error('Erreur de chargement des données', err);
      if (etatChargement) {
        etatChargement.textContent = 'Impossible de charger les données de la sortie.';
        etatChargement.classList.add('erreur');
      }
    });

  // --- Filtre "proche du gîte" ---
  const filtreGite = document.querySelector('.legende input[data-filter="gite"]');
  if (filtreGite) {
    filtreGite.addEventListener('change', () => {
      filtres.gitesProche = filtreGite.checked;
      appliquerFiltres(entries, filtres, modeFigureActuel);
    });
  }

  // --- Recherche par nom (et secteur) ---
  const recherche = document.querySelector('.recherche input');
  if (recherche) {
    recherche.addEventListener('input', () => {
      filtres.recherche = recherche.value.trim().toLowerCase();
      appliquerFiltres(entries, filtres, modeFigureActuel);
    });
    recherche.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        centrerSurRecherche();
      }
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
      allerVers(correspondances[0].cle);
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    correspondances.forEach((e) => bounds.extend(e.marker.getLngLat()));
    map.fitBounds(bounds, { padding: MARGE_UI, maxZoom: 16 });
  }

  const btnCentrer = document.querySelector('.recherche button');
  if (btnCentrer) btnCentrer.addEventListener('click', centrerSurRecherche);

  // --- Repli/déploiement du panneau légende (fermé par défaut, cf. HTML) ---
  const legendeToggle = document.querySelector('.legende-toggle');
  const legendeContenu = document.getElementById('legende-contenu');
  if (legendeToggle && legendeContenu) {
    legendeToggle.addEventListener('click', () => {
      const vaOuvrir = legendeContenu.hidden;
      legendeContenu.hidden = !vaOuvrir;
      legendeToggle.setAttribute('aria-expanded', String(vaOuvrir));
    });
  }

  // --- Revenir à la vue d'ensemble ---
  const btnToutVoir = document.querySelector('.btn-tout-voir');
  if (btnToutVoir) {
    btnToutVoir.addEventListener('click', () => {
      if (borneGlobale) map.fitBounds(borneGlobale, { padding: MARGE_UI, maxZoom: 15 });
    });
  }

  // --- Sélecteur de figuré (cercles proportionnels) ---
  const selectFigure = document.getElementById('mode-figure');
  if (selectFigure) {
    selectFigure.addEventListener('change', () => {
      modeFigureActuel = selectFigure.value;
      entries.forEach((entree) => {
        if (entree.cat === 'falaise') dessinerFalaise(entree, modeFigureActuel, maxima);
      });
      const { max, median, titre, couleurs, remplissage } = infosLegendePourMode(modeFigureActuel, maxima);
      construireLegendeFalaises(max, median, titre, couleurs, remplissage);
      // Une falaise sans donnée pour ce thème disparaît (dessinerFalaise) —
      // son parking ne doit pas rester affiché seul, sans rien à proposer.
      appliquerFiltres(entries, filtres, modeFigureActuel);
    });
  }
}

const SEUIL_GITE_MIN = 20; // doit matcher le libellé "≤ 20 min" dans le HTML des sorties

function appliquerFiltres(entries, filtres, mode) {
  // Deux sources de restriction, deux sens de cascade :
  // - recherche / mode thématique du sélecteur "Cercles" portent sur les
  //   falaises -> un parking reste affiché tant qu'au moins une falaise qui
  //   lui est associée les passe (voir estFalaiseVideDansMode : une falaise
  //   sans donnée pour le thème affiché n'a rien à montrer, son parking ne
  //   doit pas rester affiché seul).
  // - "proche du gîte" porte sur les parkings -> une falaise reste affichée
  //   tant qu'au moins un de ses parkings associés passe ce seuil.
  const restrictionFalaises = Boolean(filtres.recherche) || mode !== 'aucun';

  const parkingProche = new Map();
  entries.forEach((entree) => {
    if (entree.cat !== 'parking') return;
    const proche = !filtres.gitesProche || entree.trajetGiteMin == null || entree.trajetGiteMin <= SEUIL_GITE_MIN;
    parkingProche.set(entree.nom, proche);
  });

  const parkingsAutorises = new Set();

  entries.forEach((entree) => {
    if (entree.cat !== 'falaise') return;
    const visible =
      (!filtres.recherche || entree.recherche.includes(filtres.recherche)) &&
      (!filtres.gitesProche || entree.parkingAssocie.some((nom) => parkingProche.get(nom))) &&
      !estFalaiseVideDansMode(entree, mode);
    entree.marker.getElement().style.display = visible ? '' : 'none';
    if (visible) entree.parkingAssocie.forEach((nom) => parkingsAutorises.add(nom));
  });

  entries.forEach((entree) => {
    if (entree.cat !== 'parking') return;
    const visible =
      parkingProche.get(entree.nom) &&
      (!restrictionFalaises || parkingsAutorises.has(entree.nom));
    entree.marker.getElement().style.display = visible ? '' : 'none';
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
  if (mode === 'couenne') return { max: maxima.couenne, median: maxima.couenneMedian, titre: 'Falaises (nb. couenne)', remplissage };
  if (mode === 'gv') return { max: maxima.gv, median: maxima.gvMedian, titre: 'Falaises (nb. grande voie)', remplissage };
  if (mode === 'faciles') return { max: maxima.faciles, median: maxima.facilesMedian, titre: 'Falaises (nb. voies 5-6a+)', remplissage };
  if (mode === 'type') return {
    max: maxima.total, median: maxima.totalMedian, titre: 'Falaises (nb. voies)', remplissage,
    couleurs: [{ nom: 'Grande voie', variable: '--gv' }, { nom: 'Couenne', variable: '--couenne' }],
  };
  return { max: maxima.total, median: maxima.totalMedian, titre: 'Falaises (nb. voies)', remplissage };
}

function addMarker(map, feature, parkingInfos, maxima, allerVers, enSurbrillance) {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;
  const cat = p.categorie;
  const cle = cat === 'falaise' ? cleFalaise(p) : p.nom;

  const el = document.createElement('div');
  el.className = 'marqueur marqueur-' + cat;
  el.style.cursor = 'pointer';
  el.style.border = '2px solid white';
  el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.4)';

  // Accessibilité : un <div> seul n'est ni focusable ni annoncé par un
  // lecteur d'écran — sans ça les marqueurs ne sont atteignables qu'à la
  // souris/au doigt.
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  const etiquette = cat === 'falaise' ? `Falaise : ${libelleFalaise(p)}`
    : cat === 'parking' ? `Parking : ${p.nom}`
    : `Gîte : ${p.nom}`;
  el.setAttribute('aria-label', etiquette);

  if (cat === 'hébergement') {
    el.style.width = '16px';
    el.style.height = '16px';
    el.style.background = 'var(--ink)';
    el.style.transform = 'rotate(45deg)'; // losange : se distingue des ronds falaise/parking
  } else if (cat === 'parking') {
    el.style.width = '22px';
    el.style.height = '22px';
    el.style.borderRadius = '50%';
    el.style.background = 'var(--teal)';
  } else {
    el.style.borderRadius = '50%'; // taille + couleur posées par dessinerFalaise() ci-dessous
  }

  const popupHtml =
    cat === 'falaise' ? popupFalaise(p, lat, lon) :
    cat === 'parking' ? popupParking(p, lat, lon, parkingInfos) :
    popupGite(p, lat, lon);

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
    document.body.classList.add('fiche-ouverte');
    attachPopupActions(popup, lat, lon, allerVers, cle);
    enSurbrillance([cle]);
  });
  popup.on('close', () => {
    document.body.classList.remove('fiche-ouverte');
    enSurbrillance(null);
  });

  const cot5 = p.nb_voies_cot5 ?? 0;
  const cot6a = p.nb_voies_cot6a ?? 0;
  const parkingAssocie = cat === 'falaise'
    ? (p.parking_associe || '').split('|').map(s => s.trim()).filter(Boolean)
    : [];
  const trajetGiteMin = cat === 'parking' ? (p.trajet_gite_min ?? null) : null;
  const secteur = cat === 'falaise' ? secteurDistinct(p) : null;
  const rechercheTexte = cat === 'falaise' ? libelleFalaise(p).toLowerCase() : p.nom.toLowerCase();

  const entree = {
    marker, cat, nom: p.nom, secteur, cle, recherche: rechercheTexte,
    parkingAssocie, trajetGiteMin,
    nbVoies: p.nb_voies ?? 0,
    nbFaciles: cot5 + cot6a,
    nbGrandeVoie: p.nb_gv ?? 0,
    nbCouenne: p.nb_couenne ?? 0,
  };

  if (cat === 'falaise') dessinerFalaise(entree, 'aucun', maxima);

  return entree;
}

// Rayon proportionnel à la RACINE CARRÉE de la valeur (donc à la surface, pas
// au rayon) — convention cartographique standard pour ne pas surestimer
// visuellement les grandes valeurs.
function calculerRayon(valeur, max) {
  if (!max) return RAYON_MIN;
  return RAYON_MIN + (RAYON_MAX - RAYON_MIN) * Math.sqrt((valeur || 0) / max);
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

  const valeur = mode === 'couenne' ? entree.nbCouenne
    : mode === 'gv' ? entree.nbGrandeVoie
    : mode === 'faciles' ? entree.nbFaciles
    : entree.nbVoies;
  const max = mode === 'couenne' ? maxima.couenne
    : mode === 'gv' ? maxima.gv
    : mode === 'faciles' ? maxima.faciles
    : maxima.total;

  const estVide = estFalaiseVideDansMode(entree, mode);
  el.classList.toggle('marqueur-invisible', estVide);
  if (estVide) return;

  const rayon = calculerRayon(valeur, max);
  el.style.width = (rayon * 2) + 'px';
  el.style.height = (rayon * 2) + 'px';

  if (mode === 'type') {
    const pctGV = Math.round((entree.nbGrandeVoie / (entree.nbGrandeVoie + entree.nbCouenne)) * 100);
    el.style.background = `conic-gradient(var(--gv) 0% ${pctGV}%, var(--couenne) ${pctGV}% 100%)`;
  } else {
    el.style.background = remplissagePourMode(mode);
  }
}

// Mini-légende à cercles de référence (min / médiane / max de la grandeur
// affichée — 3 repères, pas 2, pour pouvoir interpoler une valeur intermédiaire
// à l'œil), convention standard pour une carte à symboles proportionnels.
// Le rayon de chaque repère passe par calculerRayon(), la même formule que
// pour les marqueurs réels : sinon le repère "1" ne correspondrait pas à la
// taille qu'aurait une vraie falaise à 1 voie sur la carte.
function construireLegendeFalaises(max, median, titre, couleurs, remplissage) {
  const conteneur = document.getElementById('legende-falaises');
  if (!conteneur) return;
  if (!max) { conteneur.innerHTML = ''; return; }
  const repere = (valeur) => `
    <span class="repere-taille">
      <span class="cercle-repere" style="width:${calculerRayon(valeur, max) * 2}px; height:${calculerRayon(valeur, max) * 2}px; background:${remplissage};"></span>
      <span>${valeur}</span>
    </span>`;
  const valeurs = (median > 0 && median < max) ? [1, median, max] : [1, max];
  const cle = (couleurs || []).map(c => `
      <span class="cle-couleur"><span class="pastille" style="background:var(${c.variable})"></span>${escapeHtml(c.nom)}</span>`).join('');
  conteneur.innerHTML = `
    <span class="legende-titre">${escapeHtml(titre)}</span>
    <div class="reperes-taille">
      ${valeurs.map(repere).join('')}
    </div>
    ${cle ? `<div class="legende-couleurs">${cle}</div>` : ''}`;
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

function jaugeCotation(min, max) {
  const vMin = cotationVersValeur(min);
  const vMax = cotationVersValeur(max);
  if (vMin == null || vMax == null) return '';
  const debut = (vMin / COTATION_ECHELLE_MAX) * 100;
  const largeur = Math.max(((vMax - vMin) / COTATION_ECHELLE_MAX) * 100, 3);
  return `<div class="jauge-cotation" role="img" aria-label="Cotation de ${escapeHtml(min)} à ${escapeHtml(max)}">
      <span class="jauge-segment" style="left:${debut}%; width:${largeur}%"></span>
    </div>`;
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
