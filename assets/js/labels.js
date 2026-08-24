// labels.js — libellés de site et de secteur affichés sur la carte
// (marqueurs DOM non-figurés, indépendants des marqueurs falaise/parking/gîte).

import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.4.1/dist/maplibre-gl.mjs';
import { secteurDistinct, cleFalaise } from './donnees.js';

// Un point par "site" distinct (centroïde de ses falaises, pas la 1ʳᵉ
// feature — certains sites s'étalent sur ~2km, un centroïde est nettement
// mieux placé) — sert de source aux labels ajoutés ci-dessous.
function construireGeojsonSites(geojson) {
  const groupes = new Map();
  geojson.features.forEach(f => {
    const p = f.properties;
    if (p.categorie !== 'falaise' || !p.site) return;
    const [lon, lat] = f.geometry.coordinates;
    if (!groupes.has(p.site)) groupes.set(p.site, { sumLon: 0, sumLat: 0, n: 0, nbVoies: 0 });
    const g = groupes.get(p.site);
    g.sumLon += lon; g.sumLat += lat; g.n += 1;
    g.nbVoies += p.nb_voie_total ?? 0;
  });
  return Array.from(groupes, ([site, g]) => ({
    site,
    nbVoies: g.nbVoies,
    coordinates: [g.sumLon / g.n, g.sumLat / g.n],
  })).sort((a, b) => b.nbVoies - a.nbVoies);
}

// Noms de site affichés par défaut, en marqueurs DOM (pas une couche GL,
// contrairement au premier jet) : une couche GL est TOUJOURS rendue sous les
// marqueurs/popups DOM (le canvas WebGL est une seule surface en dessous de
// la superposition DOM, par construction) — le texte disparaissait donc
// derrière un figuré ponctuel dès qu'il le chevauchait. En DOM, on récupère
// l'empilement standard : ajoutés après les marqueurs falaise/parking/gîte
// (voir l'appel dans carte.js), ils passent naturellement au-dessus.
// nbVoies sert de priorité d'affichage (voir appliquerAntiCollisionSites
// dans carte.js) : en cas de conflit à l'écran, le site le plus fourni
// l'emporte — une vraie décollision au pixel est appliquée (même algorithme
// que pour les secteurs, voir appliquerAntiCollision dans carte.js).
//
// Cliquables (cadrage sur l'étendue du site, voir onClicSite) : ils
// redeviennent donc réceptifs aux clics, ce qui peut occasionnellement
// intercepter un clic destiné à un marqueur juste en dessous s'ils se
// chevauchent pile — accepté (peu de sites, chevauchement pile au pixel
// près improbable en pratique).
//
// Renvoie {el, marker, site} par site (pas juste les éléments) :
// appliquerAntiCollisionSites (carte.js) a besoin de la position de chaque
// marqueur pour son anti-collision à l'écran, en plus de masquer l'étiquette
// d'un site qui n'a plus aucune falaise visible sous le mode "Cercles"/la
// recherche courants — sans ça, un thème vidant entièrement un site (ex.
// "Grande voie" sur un site 100% couenne) laissait son nom affiché seul,
// sans plus aucun marqueur en dessous à quoi il puisse renvoyer.
export function ajouterLabelsSites(map, geojson, onClicSite) {
  return construireGeojsonSites(geojson).map(({ site, coordinates }) => {
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
    const marker = new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, 2] })
      .setLngLat(coordinates)
      .addTo(map);
    return { el, marker, site };
  });
}

// Seuil de zoom à partir duquel les noms de secteur apparaissent : à cette
// échelle, les cercles proportionnels affichent enfin leur taille réelle
// (au-delà de ZOOM_SIMPLIFICATION) et les secteurs sont assez espacés à
// l'écran pour rester lisibles — affichés systématiquement en-deçà, ils se
// chevaucheraient sur une vue d'ensemble.
export const ZOOM_LABELS_SECTEUR = 15;

// Un point par secteur DISTINCT (centroïde de ses falaises), même principe
// que construireGeojsonSites — indispensable ici : un secteur peut regrouper
// plusieurs falaises (plusieurs features), sans ce regroupement chaque
// falaise posait sa propre étiquette avec le MÊME nom de secteur, quasiment
// à la même position (chevauchement/doublons visibles constatés au test).
// nbVoies sert de priorité d'affichage (voir appliquerAntiCollisionSecteurs
// dans carte.js) : en cas de conflit à l'écran, le secteur le plus fourni
// l'emporte.
//
// La clé de regroupement est cleFalaise(p) (nom+secteur), PAS le nom du
// secteur seul (bug constaté en réel) : des noms de secteur génériques
// comme "Principal" sont réutilisés par plusieurs sommets différents (ex.
// "Le Devès" ET "Valcroissant" ont chacun un secteur "Principal") — les
// fusionner sous une même clé plaçait une seule étiquette au centroïde des
// deux, loin de chacun des deux vrais emplacements.
function construireGeojsonSecteurs(geojson) {
  const groupes = new Map();
  geojson.features.forEach(f => {
    const p = f.properties;
    if (p.categorie !== 'falaise') return;
    const cle = cleFalaise(p);
    const label = secteurDistinct(p) || p.nom;
    const [lon, lat] = f.geometry.coordinates;
    if (!groupes.has(cle)) groupes.set(cle, { sumLon: 0, sumLat: 0, n: 0, nbVoies: 0, label });
    const g = groupes.get(cle);
    g.sumLon += lon; g.sumLat += lat; g.n += 1;
    g.nbVoies += p.nb_voie_total ?? 0;
  });
  return Array.from(groupes.values(), (g) => ({
    nom: g.label,
    nbVoies: g.nbVoies,
    coordinates: [g.sumLon / g.n, g.sumLat / g.n],
  })).sort((a, b) => b.nbVoies - a.nbVoies);
}

// Labels de secteur : même technique que ajouterLabelsSites (marqueurs DOM,
// ajoutés après pour passer au-dessus dans l'empilement), mais NON
// cliquables — contrairement aux labels de site, le marqueur falaise en
// dessous est déjà cliquable à ce niveau de zoom, un second point
// d'interaction si proche n'apporterait rien et risquerait d'intercepter des
// clics destinés au marqueur. Renvoie {el, marker, nom} (pas juste l'élément)
// : appliquerAntiCollisionSecteurs (carte.js) a besoin de la position de
// chaque marqueur pour son anti-collision à l'écran.
export function ajouterLabelsSecteurs(map, geojson) {
  return construireGeojsonSecteurs(geojson).map((secteur) => {
    const el = document.createElement('div');
    el.className = 'label-secteur';
    el.textContent = secteur.nom;
    const marker = new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, 14] })
      .setLngLat(secteur.coordinates)
      .addTo(map);
    return { el, marker, nom: secteur.nom };
  });
}
