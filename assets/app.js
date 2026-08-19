/* app.js — logique carte partagée par toutes les sorties.
   Chaque page sortie appelle initCarte(dataUrl) avec le chemin
   vers son propre data.geojson. */

// Réserve la place occupée par le header + la recherche (haut) et la légende
// (bas), pour qu'un marqueur centré ou un cadrage ajusté ne finisse pas
// caché dessous. Padding asymétrique passé à flyTo/fitBounds.
const MARGE_UI = { top: 120, bottom: 170, left: 70, right: 70 };

function initCarte(dataUrl) {
  // --- Style de fond : OpenFreeMap (vecteur, libre, gratuit, sans clé) ---
  // Pour passer en offline total : générer un fichier .pmtiles pour la zone
  // (voir README) puis remplacer l'URL du style ci-dessous par une source
  // "raster"/"vector" pointant vers pmtiles://./tuiles.pmtiles
  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [5.03, 44.74],
    zoom: 12,
    attributionControl: false,
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

  const entries = []; // { marker, cat, nom, faciles, parkingAssocie, trajetGiteMin }
  const index = new Map(); // nom -> entree, pour naviguer vers un marqueur lié
  const filtres = { facilesSeulement: false, gitesProche: false, recherche: '' };
  let borneGlobale = null; // étendue de tous les marqueurs, pour le bouton "Tout voir"

  // Navigue vers le marqueur "nom" (falaise ou parking lié depuis une popup),
  // en levant les filtres actifs si besoin pour garantir qu'il soit visible.
  function allerVers(nom) {
    const cible = index.get(nom);
    if (!cible) return;

    filtres.recherche = '';
    filtres.facilesSeulement = false;
    filtres.gitesProche = false;
    const champRecherche = document.querySelector('.recherche input');
    if (champRecherche) champRecherche.value = '';
    document.querySelectorAll('.legende input[data-filter]').forEach((cb) => { cb.checked = false; });
    appliquerFiltres(entries, filtres);

    map.flyTo({ center: cible.marker.getLngLat(), zoom: Math.max(map.getZoom(), 15), padding: MARGE_UI });
    cible.marker.togglePopup();
  }

  fetch(dataUrl)
    .then(r => r.json())
    .then(geojson => {
      const falaisesParParking = indexerFalaisesParParking(geojson);
      geojson.features.forEach(f => {
        const entree = addMarker(map, f, falaisesParParking, allerVers);
        entries.push(entree);
        index.set(entree.nom, entree);
      });
      borneGlobale = fitToMarkers(map, geojson);
      remplirAutocompletion(geojson);
      appliquerFiltres(entries, filtres);
    })
    .catch(err => {
      console.error('Erreur de chargement des données', err);
    });

  // --- Filtre "faciles seulement" ---
  const filtreFaciles = document.querySelector('.legende input[data-filter="faciles"]');
  if (filtreFaciles) {
    filtreFaciles.addEventListener('change', () => {
      filtres.facilesSeulement = filtreFaciles.checked;
      appliquerFiltres(entries, filtres);
    });
  }

  // --- Filtre "proche du gîte" ---
  const filtreGite = document.querySelector('.legende input[data-filter="gite"]');
  if (filtreGite) {
    filtreGite.addEventListener('change', () => {
      filtres.gitesProche = filtreGite.checked;
      appliquerFiltres(entries, filtres);
    });
  }

  // --- Recherche par nom ---
  const recherche = document.querySelector('.recherche input');
  if (recherche) {
    recherche.addEventListener('input', () => {
      filtres.recherche = recherche.value.trim().toLowerCase();
      appliquerFiltres(entries, filtres);
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
    const correspondances = entries.filter((e) => e.cat === 'falaise' && e.nom.toLowerCase().includes(q));
    if (!correspondances.length) return;

    if (correspondances.length === 1) {
      allerVers(correspondances[0].nom);
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    correspondances.forEach((e) => bounds.extend(e.marker.getLngLat()));
    map.fitBounds(bounds, { padding: MARGE_UI, maxZoom: 16 });
  }

  const btnCentrer = document.querySelector('.recherche button');
  if (btnCentrer) btnCentrer.addEventListener('click', centrerSurRecherche);

  // --- Revenir à la vue d'ensemble ---
  const btnToutVoir = document.querySelector('.btn-tout-voir');
  if (btnToutVoir) {
    btnToutVoir.addEventListener('click', () => {
      if (borneGlobale) map.fitBounds(borneGlobale, { padding: MARGE_UI, maxZoom: 15 });
    });
  }
}

const SEUIL_GITE_MIN = 20; // doit matcher le libellé "≤ 20 min" dans le HTML des sorties

function appliquerFiltres(entries, filtres) {
  // Deux filtres, deux sens de cascade :
  // - recherche / faciles portent sur les falaises -> un parking reste affiché
  //   tant qu'au moins une falaise qui lui est associée les passe.
  // - "proche du gîte" porte sur les parkings -> une falaise reste affichée
  //   tant qu'au moins un de ses parkings associés passe ce seuil.
  const restrictionFalaises = Boolean(filtres.recherche) || filtres.facilesSeulement;

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
      (!filtres.recherche || entree.nom.toLowerCase().includes(filtres.recherche)) &&
      (!filtres.facilesSeulement || entree.faciles) &&
      (!filtres.gitesProche || entree.parkingAssocie.some((nom) => parkingProche.get(nom)));
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
  const noms = geojson.features
    .filter(f => f.properties.categorie === 'falaise')
    .map(f => f.properties.nom)
    .sort((a, b) => a.localeCompare(b, 'fr'));
  datalist.innerHTML = noms.map(nom => `<option value="${escapeHtml(nom)}"></option>`).join('');
}

// Associe à chaque nom de parking la liste des falaises qui le référencent,
// pour afficher "Falaises desservies" dans la popup parking (relation inverse
// de parking_associe, qui n'existe que côté falaise dans les données).
function indexerFalaisesParParking(geojson) {
  const parFalaise = new Map();
  geojson.features.forEach(f => {
    const p = f.properties;
    if (p.categorie !== 'falaise' || !p.parking_associe) return;
    p.parking_associe.split('|').map(s => s.trim()).filter(Boolean).forEach(nomParking => {
      if (!parFalaise.has(nomParking)) parFalaise.set(nomParking, []);
      parFalaise.get(nomParking).push(p.nom);
    });
  });
  return parFalaise;
}

function addMarker(map, feature, falaisesParParking, allerVers) {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;
  const cat = p.categorie;

  const el = document.createElement('div');
  el.className = 'marqueur marqueur-' + cat;
  el.style.cursor = 'pointer';
  if (cat === 'hébergement') {
    el.style.width = '16px';
    el.style.height = '16px';
    el.style.border = '2px solid white';
    el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.4)';
    el.style.background = 'var(--ink)';
    el.style.transform = 'rotate(45deg)'; // losange : se distingue des ronds falaise/parking
  } else {
    el.style.width = '22px';
    el.style.height = '22px';
    el.style.borderRadius = '50%';
    el.style.border = '2px solid white';
    el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.4)';
    el.style.background = cat === 'falaise' ? '#a8452f' : '#2f6e6a';
  }

  const popupHtml =
    cat === 'falaise' ? popupFalaise(p, lat, lon) :
    cat === 'parking' ? popupParking(p, lat, lon, falaisesParParking) :
    popupGite(p, lat, lon);

  const popup = new maplibregl.Popup({ offset: 14 }).setHTML(popupHtml);

  const marker = new maplibregl.Marker({ element: el })
    .setLngLat([lon, lat])
    .setPopup(popup)
    .addTo(map);

  popup.on('open', () => attachPopupActions(popup, lat, lon, allerVers));

  const cot5 = p.nb_voies_cot5 ?? 0;
  const cot6a = p.nb_voies_cot6a ?? 0;
  const parkingAssocie = cat === 'falaise'
    ? (p.parking_associe || '').split('|').map(s => s.trim()).filter(Boolean)
    : [];
  const trajetGiteMin = cat === 'parking' ? (p.trajet_gite_min ?? null) : null;
  return { marker, cat, nom: p.nom, faciles: (cot5 + cot6a) > 0, parkingAssocie, trajetGiteMin };
}

function popupFalaise(p, lat, lon) {
  const rows = [];
  if (p.type_roche) rows.push(champ('Roche', p.type_roche));
  if (p.orientation) rows.push(champ('Orientation', p.orientation.replaceAll('|', ' / ')));
  if (p.cotation_min || p.cotation_max) {
    rows.push(champ('Cotation', `${p.cotation_min ?? '?'} → ${p.cotation_max ?? '?'}`));
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

  return `
    <div class="popup">
      <span class="cat-tag falaise">Falaise</span>
      <h3>${escapeHtml(p.nom)}</h3>
      <dl>${rows.join('')}</dl>
      <div class="actions">
        <button class="btn-copy" data-lat="${lat}" data-lon="${lon}">Copier coordonnées</button>
        <a class="btn" href="geo:${lat},${lon}">Ouvrir dans Maps</a>
        ${p.lien_oblyk ? `<a class="btn" href="${escapeHtml(p.lien_oblyk)}" target="_blank" rel="noopener">Voir sur Oblyk</a>` : ''}
      </div>
    </div>`;
}

function popupParking(p, lat, lon, falaisesParParking) {
  const rows = [];
  if (p.trajet_gite_min) rows.push(champ('Depuis le gîte', `${p.trajet_gite_min} min en voiture`));
  const falaises = falaisesParParking.get(p.nom) || [];
  if (falaises.length) rows.push(champLiens('Falaises', falaises));

  return `
    <div class="popup">
      <span class="cat-tag parking">Parking</span>
      <h3>${escapeHtml(p.nom)}</h3>
      <dl>${rows.join('')}</dl>
      <div class="actions">
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
        <button class="btn-copy" data-lat="${lat}" data-lon="${lon}">Copier coordonnées</button>
        <a class="btn" href="geo:${lat},${lon}">Ouvrir dans Maps</a>
      </div>
    </div>`;
}

function champ(label, valeur) {
  return `<dt>${label}</dt><dd>${escapeHtml(String(valeur))}</dd>`;
}

// Comme champ(), mais chaque valeur devient un bouton qui navigue vers le
// marqueur correspondant (voir allerVers dans initCarte).
function champLiens(label, noms) {
  const liens = noms
    .map(nom => `<button type="button" class="lien-secteur" data-nom="${escapeHtml(nom)}">${escapeHtml(nom)}</button>`)
    .join(' · ');
  return `<dt>${label}</dt><dd>${liens}</dd>`;
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function attachPopupActions(popup, lat, lon, allerVers) {
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
      allerVers(btn.dataset.nom);
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
