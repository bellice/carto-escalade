// poignee-fiche.js — Custom Element <poignee-fiche> : la poignée qui replie et
// déplie la fiche mobile.
//
// Sans Shadow DOM (README, « Composants ») : le composant dépend des feuilles
// globales (.popup .poignee-fiche). Il ENVELOPPE un vrai <button>, écrit dans
// le HTML par popups.js : Entrée et Espace sont ceux du bouton natif. Tant que
// ce module n'est pas chargé, ou s'il échoue, la poignée reste un <button>
// natif, focusable, qui ne replie pas.
//
// Le composant NE DÉCIDE PAS de l'état :
//  - un clic émet l'événement « basculer-fiche » (il bouillonne jusqu'au
//    document) ; actions-fiche.js bascule l'état replié/déplié, partagé avec
//    le reste de la carte (etat.js, ficheReduite), et la classe fiche-reduite
//    de la feuille ;
//  - l'application lui rend l'état par l'attribut `reduite` (voir
//    synchroniserPoignee, marqueurs.js, appelée aussi à l'ouverture d'une fiche
//    et à la sortie du détail des voies) ; le composant l'observe et en tire
//    aria-expanded, le nom accessible et le texte.
//
// Chargé par import() depuis demarrer-sortie.js, sans bloquer la carte. Un
// attribut posé avant la définition est lu à la mise à niveau : le navigateur
// appelle alors attributeChangedCallback pour chaque attribut observé présent.

// Absent en dehors d'un navigateur.
if (typeof customElements !== 'undefined' && !customElements.get('poignee-fiche')) {
  customElements.define('poignee-fiche', class PoigneeFiche extends HTMLElement {
    static get observedAttributes() {
      return ['reduite'];
    }

    connectedCallback() {
      if (this.ecoute) return; // déjà amélioré (nœud reconnecté)
      const bouton = this.querySelector('button');
      if (!bouton) return; // rien à améliorer sans bouton
      this.ecoute = true;
      bouton.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('basculer-fiche', { bubbles: true }));
      });
      this.afficher();
    }

    attributeChangedCallback() {
      this.afficher();
    }

    // Même rendu qu'avant : état déplié par défaut (attribut absent).
    afficher() {
      const bouton = this.querySelector('button');
      if (!bouton) return; // avant connectedCallback, à la mise à niveau
      const reduite = this.hasAttribute('reduite');
      const texte = reduite ? 'Agrandir' : 'Réduire';
      bouton.setAttribute('aria-expanded', String(!reduite));
      bouton.setAttribute('aria-label', `${texte} la fiche`);
      const mot = bouton.querySelector('.poignee-texte');
      if (mot) mot.textContent = texte;
    }
  });
}
