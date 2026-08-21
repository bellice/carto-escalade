// utils.js — petites fonctions sans dépendance, réutilisées partout.

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
