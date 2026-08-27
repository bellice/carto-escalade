// utils.js — petites fonctions sans dépendance, réutilisées partout.

// Échappe pour insertion dans du HTML, ATTRIBUTS COMPRIS.
//
// La 1re version passait par textContent -> innerHTML, ce qui n'échappe que
// &, < et > : suffisant pour un nœud texte, mais PAS pour une valeur
// d'attribut, où un guillemet referme l'attribut et laisse injecter du
// balisage. Or escapeHtml est justement utilisé dans une douzaine
// d'attributs (data-cle, data-nom, href, data-route...). Une falaise nommée
// `Falaise" onmouseover="…` produisait un vrai gestionnaire d'évènement.
// Les données sont aujourd'hui auto-produites (CSV maintenu à la main), donc
// le risque était latent et non actif — corrigé quand même : rien ne garantit
// qu'une source tierce (contribution, import) ne rentre pas un jour.
//
// Table explicite plutôt que le détour par le DOM : plus rapide, et surtout
// le comportement ne dépend plus du contexte d'insertion.
const ECHAPPEMENTS = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ECHAPPEMENTS[c]);
}

// Neutralise une URL issue des DONNÉES avant de la poser dans un href.
// escapeHtml ne protège pas de ça : `javascript:alert(1)` ne contient aucun
// caractère à échapper et s'exécuterait au clic. Liste blanche de schémas
// plutôt que liste noire (une liste noire se contourne : `JaVaScRiPt:`,
// espaces insécables, encodages...). Les schémas retenus sont ceux que le
// site produit réellement : http/https (topo, Oblyk, Camptocamp) et geo:
// (lien d'itinéraire mobile, voir lienItineraire dans popups.js).
// Une URL RELATIVE reste acceptée (résolue contre la page courante).
// Renvoie '' si le schéma n'est pas autorisé : l'appelant n'affiche alors
// pas de lien du tout, plutôt qu'un lien inerte qui aurait l'air cliquable.
const SCHEMAS_AUTORISES = new Set(['http:', 'https:', 'geo:', 'mailto:']);

export function urlSure(url) {
  if (!url) return '';
  try {
    // base = page courante : sans elle, une URL relative lèverait une
    // exception et serait rejetée à tort.
    const analysee = new URL(String(url).trim(), document.baseURI);
    return SCHEMAS_AUTORISES.has(analysee.protocol) ? String(url).trim() : '';
  } catch {
    return '';
  }
}
