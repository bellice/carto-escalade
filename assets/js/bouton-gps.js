// bouton-gps.js — Custom Element <bouton-gps lat="…" lon="…"> : copie des
// coordonnées GPS d'une fiche.
//
// Sans Shadow DOM (README, « Composants ») : le composant dépend des feuilles
// globales (.gps-copie, .popup). Il ENVELOPPE un vrai <button>, écrit dans le
// HTML par boutonGps() (liens-acces.js) : tant que ce module n'est pas chargé,
// ou s'il échoue, le bouton reste un <button> natif, focusable et activable au
// clavier, mais sans copie. Le composant ajoute le comportement :
//  - copie « lat, lon » (5 décimales) dans le presse-papiers ;
//  - confirmation visible, qui bascule le mot d'action et jamais la valeur :
//    la laisser affichée permet de relire ce qu'on vient de copier ;
//  - annonce pour les lecteurs d'écran, dans une région role="status" : le
//    nom accessible du bouton est fixé par aria-label, donc un changement de
//    son texte n'est pas annoncé.
//
// Entrée et Espace n'ont rien de spécifique : un <button> les traduit en clic.
//
// Chargé par import() depuis demarrer-sortie.js, sans bloquer la carte. Une
// fiche créée avant la définition est mise à niveau par le navigateur à la
// définition (customElements.define), sans appel à customElements.upgrade.

const DUREE_CONFIRMATION = 1500;

// Presse-papiers asynchrone, puis repli sur execCommand : le premier exige un
// contexte sécurisé et peut être refusé, le second fonctionne dans un geste de
// l'utilisateur sans permission. Rend true si la copie a eu lieu.
async function copierTexte(texte) {
  try {
    await navigator.clipboard.writeText(texte);
    return true;
  } catch { /* indisponible ou refusé : repli ci-dessous */ }

  const precedent = document.activeElement;
  const zone = document.createElement('textarea');
  zone.value = texte;
  zone.setAttribute('readonly', '');
  zone.style.position = 'fixed';
  zone.style.opacity = '0';
  document.body.appendChild(zone);
  zone.select();
  let copie = false;
  try { copie = document.execCommand('copy'); } catch { copie = false; }
  zone.remove();
  // La sélection a pris le focus : on le rend au bouton.
  if (precedent && precedent.focus) precedent.focus();
  return copie;
}

// Absent en dehors d'un navigateur (les tests statiques importent popups.js sous Node).
if (typeof customElements !== 'undefined' && !customElements.get('bouton-gps')) {
  customElements.define('bouton-gps', class BoutonGps extends HTMLElement {
    connectedCallback() {
      if (this.annonce) return; // déjà amélioré (nœud reconnecté)
      this.bouton = this.querySelector('button');
      if (!this.bouton) return; // rien à améliorer sans bouton
      // La région existe avant tout changement de texte : sans cela, certains
      // lecteurs d'écran n'annoncent pas le premier message.
      this.annonce = document.createElement('span');
      this.annonce.className = 'visuellement-cache';
      this.annonce.setAttribute('role', 'status');
      this.append(this.annonce);
      this.bouton.addEventListener('click', () => this.copier());
    }

    disconnectedCallback() {
      clearTimeout(this.minuteur);
    }

    // Même format qu'avant : « lat, lon », 5 décimales (~1 m).
    get coordonnees() {
      const lat = Number(this.getAttribute('lat'));
      const lon = Number(this.getAttribute('lon'));
      return Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : null;
    }

    async copier() {
      const action = this.querySelector('.gps-action');
      const texte = this.coordonnees;
      const copie = texte !== null && await copierTexte(texte);
      clearTimeout(this.minuteur);
      if (action) action.textContent = copie ? 'Copié !' : 'Échec';
      this.bouton.classList.toggle('copied', copie);
      this.annoncer(copie ? `Coordonnées GPS copiées : ${texte}` : 'Copie impossible, les coordonnées restent affichées');
      this.minuteur = setTimeout(() => {
        if (action) action.textContent = 'Copier';
        this.bouton.classList.remove('copied');
        this.annonce.textContent = '';
      }, DUREE_CONFIRMATION);
    }

    // Vider puis remplir : un message identique au précédent est ré-annoncé.
    annoncer(message) {
      this.annonce.textContent = '';
      setTimeout(() => { this.annonce.textContent = message; }, 50);
    }
  });
}
